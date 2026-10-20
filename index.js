/**
 * dsh-image-lite — Host half.
 *
 * Bundle entry `image-gen-lite` (self-contained model library):
 *   - `providers`     the model library: openai-images (and, stored for
 *                     later) other image providers with their models.
 *   - `active`        the single selected model the tool and the 生图工作台
 *                     panel use, resolved from the library and persisted here.
 *   - `activeAspect`  the remembered aspect stop (7 stops + auto).
 *
 * All three fields are volatile: the client's configuration forms hot-commit
 * writes into the running fiber's references, so a settings-card or panel
 * write takes effect on the next tool call without a restart.
 *
 * P1 scope: the `openai-images` API format only (gpt-image-1 and
 * compatible gateways). The 出图 fetch layer, the RPC channel, the tool,
 * and the system-prompt section are all written from scratch against the
 * DSH services (attachments / credentials / tools / system-prompt); this
 * plugin is self-contained — no other image plugin is required.
 */
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { AttachmentId, admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'

import {
  ASPECTS,
  DEFAULT_ASPECT,
  IMAGE_MEDIA_TYPES,
  MAX_REFS,
  buildEditFormData,
  buildEditJsonBody,
  buildImg2ImgBody,
  buildOpenAiImagesBody,
  decodeDataUrl,
  errorDetail,
  extensionForMediaType,
  hasSizeFallback,
  HttpStatusError,
  imageLiteText,
  isGeneratedImagePath,
  isImageInDir,
  isValidImageRef,
  normalizeRefs,
  omitResponseFormat,
  pathForResult,
  resolveOutputDir,
  sizeForAspect,
  sniffImageMediaType,
} from './wire.js'

export const name = 'dsh-image-lite'
export const inject = ['tools']

/** This entry, owned by this package (self-contained model library). */
export const ENTRY_NS = 'image-gen-lite'
/** Loopback RPC channel for the client half. */
export const RPC_CHANNEL = '/image-gen-lite'

const USER_AGENT = 'dsh-image-lite/0.1.0'
const SUPPORTED_FORMAT = 'openai-images'

/**
 * Mark a schema field volatile when the runtime's schemastery supports it
 * (DSH >= 0.1.6); older runtimes keep the fields as plain defaults.
 */
const maybeVolatile = (schema) => (schema && typeof schema.volatile === 'function' ? schema.volatile() : schema)

/**
 * Unwrap one config field that may be a live Volatile reference (DSH >= 0.1.6
 * hot-commits volatile writes into the box) or a plain value.
 */
export function unwrapVolatile(value) {
  if (value && typeof value === 'object' && typeof value.get === 'function') {
    try { return value.get() } catch { return undefined }
  }
  return value
}

export function emptyActive() {
  return { providerId: '', modelId: '', baseUrl: '', model: '', apiKeyEnv: '', apiFormat: '' }
}

// Every field carries a default so the settings form's schema validation
// always passes and the entry form reaches `status: 'ready'` from first
// install (a value that fails validation would deadlock the pickers).
const modelSchema = z.object({
  id: z.string().default(''),
  name: z.string().default(''),
})

const providerSchema = z.object({
  id: z.string().default(''),
  name: z.string().default(''),
  baseUrl: z.string().default(''),
  apiFormat: z.string().default('openai-images'),
  apiKeyEnv: z.string().default(''),
  // Masked preview of a key stored through the credentials service
  // (`sk-0****32d`); the secret itself never enters the config.
  apiKeyHint: z.string().default(''),
  models: z.array(modelSchema).default([]),
})

/**
 * All three fields carry schema defaults and are volatile: the client's form
 * decoder validates the described value against this schema, and a form whose
 * value does not pass validation never reaches `status: 'ready'` — which would
 * deadlock first use (a disabled model picker can never set `active`).
 */
export const Config = z.object({
  providers: maybeVolatile(z.array(providerSchema).default([])),
  active: maybeVolatile(z.object({
    providerId: z.string().default(''),
    modelId: z.string().default(''),
    baseUrl: z.string().default(''),
    model: z.string().default(''),
    apiKeyEnv: z.string().default(''),
    apiFormat: z.string().default(''),
  }).default(emptyActive())),
  activeAspect: maybeVolatile(z.string().default(DEFAULT_ASPECT)),
  // Where generated images are written. Empty means the default of
  // `<session workspace>/generate/image`, so clearing the field restores it.
  outputDir: maybeVolatile(z.string().default('')),
  // Whether the sidebar studio (tab + header button) is offered at all.
  sidebarEnabled: maybeVolatile(z.boolean().default(true)),
})

/** Project a raw `providers` config value onto the provider shape. */
export function providersFromConfig(config) {
  const raw = unwrapVolatile(config?.providers)
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p) => p && typeof p === 'object' && typeof p.id === 'string' && p.id.length > 0)
    .map((p) => ({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : p.id,
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
      apiFormat: typeof p.apiFormat === 'string' && p.apiFormat ? p.apiFormat : 'openai-images',
      apiKeyEnv: typeof p.apiKeyEnv === 'string' ? p.apiKeyEnv : '',
      apiKeyHint: typeof p.apiKeyHint === 'string' ? p.apiKeyHint : '',
      models: Array.isArray(p.models)
        ? p.models
          .filter((m) => m && typeof m === 'object' && typeof m.id === 'string' && m.id.length > 0)
          .map((m) => ({ id: m.id, name: typeof m.name === 'string' ? m.name : m.id }))
        : [],
    }))
}

/** Project a raw `active` config value onto the six-field shape. */
export function activeFromConfig(config) {
  const raw = unwrapVolatile(config?.active)
  const out = emptyActive()
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(out)) {
      out[key] = typeof raw[key] === 'string' ? raw[key] : ''
    }
  }
  return out
}

/** True when the active model is a fully specified openai-images target. */
export function activeComplete(active) {
  const a = active ?? emptyActive()
  return !!(a.providerId && a.modelId && a.baseUrl && a.model && a.apiKeyEnv
    && a.apiFormat === SUPPORTED_FORMAT)
}

/** The panel's remembered aspect stop, clamped to known stops. */
export function aspectFromConfig(config) {
  const raw = unwrapVolatile(config?.activeAspect)
  const value = typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_ASPECT
  return ASPECTS[value] !== undefined ? value : DEFAULT_ASPECT
}

/** The configured image directory, or '' when the default should be used. */
export function outputDirFromConfig(config) {
  const raw = unwrapVolatile(config?.outputDir)
  return typeof raw === 'string' ? raw.trim() : ''
}

function abortedError(signal, fallback) {
  const err = new Error('image_generate_lite: aborted')
  err.name = 'AbortError'
  err.cause = signal?.aborted === true ? signal.reason : fallback
  return err
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError'
}

function trimSlash(url) {
  return String(url ?? '').trim().replace(/\/+$/, '')
}

function joinEndpoint(base, suffix) {
  const b = trimSlash(base)
  if (!b) throw new Error('image_generate_lite: provider has no Base URL')
  if (b.endsWith(suffix)) return b
  return `${b}${suffix}`
}

async function resolveApiKey(ctx, apiKeyEnv, signal) {
  if (signal?.aborted === true) throw abortedError(signal)
  if (!apiKeyEnv) throw new Error('image_generate_lite: no API key reference; pick a model in the 生图工作台 panel')
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new Error(`image_generate_lite: no credentials service; store the key for "${apiKeyEnv}"`)
  }
  const resolved = await credentials.resolve(credentialRef(apiKeyEnv))
  if (resolved !== undefined && resolved.value.length > 0) return resolved.value
  throw new Error(`image_generate_lite: no API key for "${apiKeyEnv}"; paste it on the Plugins page under dsh-image-lite`)
}

function collectOpenAiImages(payload, out) {
  const entries = Array.isArray(payload?.data) ? payload.data : []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    if (typeof entry.b64_json === 'string' && entry.b64_json.length > 0) {
      // No mime assumption: materializeImages sniffs the real bytes
      // (gateways may return JPEG/WebP despite the PNG convention).
      out.push({ data: Buffer.from(entry.b64_json, 'base64') })
      continue
    }
    if (typeof entry.url === 'string' && entry.url.length > 0) {
      out.push({ url: entry.url })
    }
  }
}

async function fetchToBuffer(url, signal) {
  const response = await fetch(url, { redirect: 'follow', signal })
  if (!response.ok) throw new Error(`image_generate_lite: image download failed (HTTP ${response.status})`)
  return Buffer.from(await response.arrayBuffer())
}

async function materializeImages(raw, signal) {
  const images = []
  for (const item of raw) {
    if (item.data) {
      images.push({ data: item.data, mime: item.mime ?? sniffImageMediaType(item.data) })
      continue
    }
    if (item.url) {
      const decoded = decodeDataUrl(item.url)
      if (decoded) {
        images.push({ data: Buffer.from(decoded.data), mime: decoded.mime })
        continue
      }
      const data = await fetchToBuffer(item.url, signal)
      images.push({ data, mime: sniffImageMediaType(data) })
    }
  }
  if (images.length === 0) throw new Error('image_generate_lite: the response carried no image data')
  return images
}

async function postOpenAiImages({ url, apiKey, body, signal }) {
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        ...multipart ? {} : { 'content-type': 'application/json' },
        accept: 'application/json',
        'user-agent': USER_AGENT,
        authorization: `Bearer ${apiKey}`,
      },
      body: multipart ? body : JSON.stringify(body),
      ...signal !== undefined ? { signal } : {},
    })
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw abortedError(signal, error)
    throw new Error(`image_generate_lite: request failed: ${String(error)}`)
  }
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw abortedError(signal, error)
    throw new Error(`image_generate_lite: unprocessable response (HTTP ${response.status})`)
  }
  if (!response.ok) throw new HttpStatusError(response.status, errorDetail(payload, response.status), payload)
  return payload
}

/** Failures that name a request field are more useful than a generic 5xx. */
function pickEditError(shapes) {
  const parameter = shapes.find((s) => s.error instanceof HttpStatusError
    && (s.error.status === 400 || s.error.status === 415 || s.error.status === 422)
    && /image|multipart|required|field/i.test(String(s.error.message ?? '')))
  if (parameter !== undefined) return parameter.error
  const last = shapes[shapes.length - 1].error
  return last ?? shapes.find((s) => s.error !== undefined)?.error
    ?? new Error('image_generate_lite: every edit body shape was rejected')
}

/** One edit attempt, retried once without `response_format` when a gateway rejects it. */
async function sendEditAttempt({ url, apiKey, build, signal }) {
  try {
    return await postOpenAiImages({ url, apiKey, body: build(true), signal })
  } catch (error) {
    if (!(error instanceof HttpStatusError) || !/response_format/i.test(String(error?.message ?? error))) throw error
    return await postOpenAiImages({ url, apiKey, body: build(false), signal })
  }
}

/**
 * An edit call. Providers disagree about the request shape, so try the three
 * sane ones in turn: inline JSON `image` (Agnes and similar), OpenAI-spec
 * multipart, then the legacy JSON `images` array. Only transport-ish failures
 * move on to the next shape; auth and rate limits are reported as-is.
 */
async function postEdit({ editsUrl, generationsUrl, apiKey, fields, refs, body, signal }) {
  const shapes = [
    {
      url: editsUrl,
      build: (includeResponseFormat) => buildEditJsonBody({ ...fields, references: refs, includeResponseFormat }),
    },
    // Providers (Agnes among them) serve image-to-image from generations with the
    // source inline as `image`. When that is the house style it answers 2xx and
    // the remaining shapes never run.
    { url: generationsUrl, build: () => buildImg2ImgBody({ ...fields, references: refs }) },
    {
      url: editsUrl,
      build: (includeResponseFormat) => buildEditFormData({ ...fields, references: refs, includeResponseFormat }),
    },
    { url: editsUrl, build: () => body },
  ]
  for (const [index, shape] of shapes.entries()) {
    try {
      return await sendEditAttempt({ url: shape.url, apiKey, build: shape.build, signal })
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw error
      const status = error instanceof HttpStatusError ? error.status : undefined
      // Auth, rate limits and "server too busy" are real answers, not shape
      // complaints: keep them instead of reshuffling the request.
      if (status === undefined || status === 401 || status === 403 || status === 429 || status === 502 || status === 503 || status === 504) throw error
      shape.error = error
      if (index === shapes.length - 1) throw pickEditError(shapes)
    }
  }
  throw new Error('image_generate_lite: the edit request was rejected by every supported body shape')
}

/**
 * One openai-images call with: the optional `response_format` gateway retry,
 * and the single 400 → next-size retry for aspect stops that declare one.
 */
async function generateImages({ active, aspect, prompt, quality, refs, apiKey, signal }) {
  const editing = refs.length > 0
  const url = joinEndpoint(active.baseUrl, editing ? '/images/edits' : '/images/generations')
  let lastError = null
  for (let attempt = 0; attempt <= 1; attempt++) {
    const size = sizeForAspect(aspect, attempt)
    const fields = { model: active.model, prompt, size, quality }
    const body = buildOpenAiImagesBody({ ...fields, references: editing ? refs : undefined })
    try {
      let payload
      if (!editing) {
        try {
          payload = await postOpenAiImages({ url, apiKey, body, signal })
        } catch (error) {
          // Gateways that reject `response_format`: strip it and resend once.
          if (!(error instanceof HttpStatusError) || !/response_format/i.test(String(error?.message ?? error))) throw error
          payload = await postOpenAiImages({ url, apiKey, body: omitResponseFormat(body), signal })
        }
      } else {
        payload = await postEdit({
          editsUrl: url,
          generationsUrl: joinEndpoint(active.baseUrl, '/images/generations'),
          apiKey,
          fields,
          refs,
          body,
          signal,
        })
      }
      const raw = []
      collectOpenAiImages(payload, raw)
      return await materializeImages(raw, signal)
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw error
      const retryable = error instanceof HttpStatusError && error.status === 400
        && attempt === 0 && hasSizeFallback(aspect, 0)
      lastError = error
      if (!retryable) throw error
      // otherwise fall through to attempt 1 with the fallback size
    }
  }
  throw lastError
}

function refToImageRef(ref) {
  return {
    attachmentId: AttachmentId(ref.attachmentId),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...ref.name === undefined ? {} : { name: ref.name },
    ...ref.originalDimensions === undefined ? {} : { originalDimensions: ref.originalDimensions },
  }
}

function plainRef(ref) {
  return {
    attachmentId: ref.attachmentId,
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...ref.name === undefined ? {} : { name: ref.name },
  }
}

/**
 * The shared 出图 pipeline for the tool and the RPC `generate` endpoint.
 * @returns {Promise<{ paths: string[], images: unknown[], provider: string, model: string, aspect: string }>}
 */
async function runGeneration(ctx, active, rememberedAspect, { cwd, outputDir, aspect, prompt, quality, refs, signal }, attachments) {
  const trimmed = String(prompt ?? '').trim()
  if (trimmed.length === 0) throw new Error('image_generate_lite: prompt must be a non-empty string')
  const stop = aspect !== undefined && ASPECTS[aspect] !== undefined ? aspect : rememberedAspect

  // Reference images → data URLs (the { image_url } object array the gateway takes).
  const dataUrls = []
  if (refs !== undefined && refs.length > 0) {
    if (attachments === undefined) throw new Error('image_generate_lite: editing requires the DSH attachment service')
    for (const ref of refs) {
      signal?.throwIfAborted?.()
      const stored = await attachments.readImage(refToImageRef(ref), signal)
      dataUrls.push(`data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`)
    }
  }

  const apiKey = await resolveApiKey(ctx, active.apiKeyEnv, signal)
  const images = await generateImages({
    active,
    aspect: stop,
    prompt: trimmed,
    quality,
    refs: dataUrls,
    apiKey,
    signal,
  })

  const root = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : process.cwd()
  // An empty setting always means the default; a set one is used verbatim.
  const directory = resolveOutputDir(root, outputDir)
  try {
    await mkdir(directory, { recursive: true })
  } catch (error) {
    throw new Error(`image_generate_lite: cannot create the image directory "${directory}": ${error instanceof Error ? error.message : String(error)}`)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const paths = []
  const mediaTypes = []
  for (const [index, image] of images.entries()) {
    const mediaType = image.mime ?? sniffImageMediaType(image.data)
    const name = `lite-image-${stamp}-${Math.random().toString(36).slice(2, 8)}-${index}.${extensionForMediaType(mediaType)}`
    const absolute = join(directory, name)
    try {
      await writeFile(absolute, image.data)
    } catch (error) {
      throw new Error(`image_generate_lite: cannot write "${absolute}": ${error instanceof Error ? error.message : String(error)}`)
    }
    paths.push(pathForResult(root, absolute))
    mediaTypes.push(mediaType)
  }

  const refsOut = []
  if (attachments !== undefined) {
    for (let index = 0; index < images.length; index++) {
      try {
        const ref = await attachments.saveImage({
          data: images[index].data,
          mediaType: mediaTypes[index],
          name: basename(paths[index]),
        })
        refsOut.push(plainRef(ref))
      } catch (error) {
        ctx.logger?.warn?.(`dsh-image-lite: could not attach ${paths[index]}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  return {
    paths,
    images: refsOut,
    provider: active.providerId,
    model: active.model,
    aspect: stop,
  }
}

function createLiteTool(ctx, readActive, readAspect, readOutputDir) {
  return defineTool({
    name: 'image_generate_lite',
    description: 'Generate an image (or edit existing ones) with the openai-images model chosen in the '
      + "生图工作台 panel, and save it under the plugin's image directory (by default generate/image in the session "
      + 'workspace; the settings card can point it elsewhere). '
      + 'The image is shown inline in the conversation and the result text carries fresh image references '
      + 'you can pass back as referenceImages to keep editing the same picture.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'What the image should show, or how to change the reference images.',
      },
      size: {
        type: 'string',
        enum: Object.keys(ASPECTS),
        description: 'Aspect stop — 1:1, 3:2, 2:3, 3:4, 4:3, 16:9, 9:16, or auto. Omit to use the panel\'s remembered stop.',
      },
      quality: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'auto'],
        description: 'Rendering quality; omit for the gateway default.',
      },
      referenceImages: {
        type: 'array',
        description: 'Optional 1–5 ordered complete DSH image references to edit or use as source images. Not file paths or URLs. Copy them from a previous image_generate_lite result text; omit for a new image.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            attachmentId: { type: 'string', required: true },
            mediaType: { type: 'string', enum: IMAGE_MEDIA_TYPES, required: true },
            bytes: { type: 'integer', required: true },
            width: { type: 'integer', required: true },
            height: { type: 'integer', required: true },
            name: { type: 'string' },
            originalDimensions: {
              type: 'object',
              additionalProperties: false,
              properties: {
                width: { type: 'integer', required: true },
                height: { type: 'integer', required: true },
              },
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          paths: { type: 'array', items: { type: 'string' }, required: true },
          provider: { type: 'string' },
          model: { type: 'string' },
          aspect: { type: 'string' },
          images: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attachmentId: { type: 'string', required: true },
                mediaType: { type: 'string', enum: IMAGE_MEDIA_TYPES, required: true },
                bytes: { type: 'integer', required: true },
                width: { type: 'integer', required: true },
                height: { type: 'integer', required: true },
                name: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: imageLiteText(value) },
        ...(Array.isArray(value.images) ? value.images : []).map((image) => ({
          type: 'image',
          attachment: refToImageRef(image),
        })),
      ],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `image_generate_lite${Array.isArray(args.referenceImages) && args.referenceImages.length > 0 ? ` (edit, ${args.referenceImages.length} refs)` : ''}: ${String(args.prompt ?? '').slice(0, 60)}`,
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      content: (result.content ?? []).filter((block) => block.type === 'text'),
    }),
    async execute(args, exec) {
      const active = readActive()
      if (!activeComplete(active)) {
        throw new Error('image_generate_lite: no active model yet. Open the 生图工作台 (header corner button) and pick an openai-images model first — providers are managed on the Plugins page under dsh-image-lite.')
      }
      const normalized = normalizeRefs(args.referenceImages)
      if (normalized.error) throw new Error(`image_generate_lite: ${normalized.error}`)
      const result = await runGeneration(ctx, active, readAspect(), {
        cwd: exec.agent?.session.header.cwd,
        outputDir: readOutputDir(),
        aspect: typeof args.size === 'string' && args.size !== '' ? args.size : undefined,
        prompt: args.prompt,
        quality: args.quality,
        refs: normalized.refs.length > 0 ? normalized.refs : undefined,
        signal: exec.signal,
      }, ctx.get('attachments'))
      return {
        paths: result.paths,
        provider: result.provider,
        model: result.model,
        aspect: result.aspect,
        ...result.images.length > 0 ? { images: result.images } : {},
      }
    },
  })
}

class BadRequest extends Error {
  constructor(message) {
    super(message)
    this.name = 'BadRequest'
  }
}

function ok(value) {
  return { ok: true, value }
}

function failure(error) {
  return {
    ok: false,
    error: {
      code: error instanceof BadRequest ? 'bad-request' : 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}

/**
 * Minimal RPC transport on a route of our own: `connection.rpc.handle` binds the
 * channel to a service context that cannot read `webServer` here, so it throws
 * "cannot get property webServer without inject" and no route is mounted.
 * The wire format is the same client-request / server-response pair.
 */
async function serveRpc(req, res, admit, handle) {
  let rejection
  try {
    rejection = admit(req)
  } catch {
    rejection = 500
  }
  if (rejection !== undefined) {
    res.writeHead(rejection)
    res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
    return
  }
  const url = new URL(req.url ?? '/', 'http://x')
  const endpoint = url.pathname.startsWith(`${RPC_CHANNEL}/`) ? url.pathname.slice(RPC_CHANNEL.length + 1) : ''
  if (req.method !== 'POST' || endpoint === '') {
    res.writeHead(req.method === 'POST' ? 404 : 405)
    res.end()
    return
  }
  if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    res.writeHead(415)
    res.end('content type must be application/json')
    return
  }
  let raw = ''
  for await (const chunk of req) raw += chunk
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    res.writeHead(400)
    res.end('body is not JSON')
    return
  }
  const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request'
  const reply = (result) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'server-response', rpcId, result }))
  }
  if (message?.type !== 'client-request' || message.method !== endpoint) {
    reply({ ok: false, error: { code: 'gateway/bad-request', message: 'method does not match endpoint', details: {} } })
    return
  }
  try {
    reply(await handle(endpoint, message.payload))
  } catch (error) {
    reply({ ok: false, error: { code: 'gateway/internal', message: error instanceof Error ? error.message : String(error), details: {} } })
  }
}

function registerRpc(ctx, readActive, readAspect, readOutputDir) {
  ctx.inject(['connection', 'webServer'], (scoped) => {
    const connection = scoped.get('connection')
    const webServer = scoped.get('webServer')
    if (connection === undefined || webServer === undefined) return
    const admit = (request) => (typeof connection.requestRejection === 'function' ? connection.requestRejection(request) : undefined)
    scoped.effect(() => webServer.register({
      kind: 'prefix',
      path: RPC_CHANNEL,
      handler: (req, res) => serveRpc(req, res, admit, handleRpc),
    }), 'dsh-image-lite: rpc route')
    async function handleRpc(endpoint, payload, signal) {
      try {
        if (typeof payload !== 'object' || payload === null) throw new BadRequest('payload must be an object')
        if (endpoint === 'generate') {
          if (typeof payload.prompt !== 'string' || payload.prompt.trim().length === 0) {
            throw new BadRequest('payload.prompt must be a non-empty string')
          }
          const active = readActive()
          if (!activeComplete(active)) {
            throw new BadRequest('no active image model; pick one in the 生图工作台 panel first')
          }
          let refs
          if (payload.refs !== undefined) {
            const normalized = normalizeRefs(payload.refs)
            if (normalized.error) throw new BadRequest(normalized.error)
            refs = normalized.refs
          }
          let aspect
          if (payload.aspect !== undefined) {
            if (typeof payload.aspect !== 'string' || ASPECTS[payload.aspect] === undefined) {
              throw new BadRequest(`payload.aspect must be one of: ${Object.keys(ASPECTS).join(', ')}`)
            }
            aspect = payload.aspect
          }
          const result = await runGeneration(ctx, active, readAspect(), {
            cwd: payload.cwd,
            outputDir: readOutputDir(),
            aspect,
            prompt: payload.prompt,
            refs,
            signal,
          }, ctx.get('attachments'))
          return ok({
            paths: result.paths,
            images: result.images,
            provider: result.provider,
            model: result.model,
            aspect: result.aspect,
          })
        }
        if (endpoint === 'admitImages') {
          const items = payload.items
          if (!Array.isArray(items) || items.length < 1 || items.length > MAX_REFS) {
            throw new BadRequest(`payload.items must hold 1–${MAX_REFS} images`)
          }
          for (const item of items) {
            if (item === null || typeof item !== 'object') throw new BadRequest('payload.items entries must be objects')
            if (typeof item.data !== 'string' || item.data.length === 0) {
              throw new BadRequest('payload.items[].data must be non-empty base64')
            }
            if (typeof item.mediaType !== 'string' || !IMAGE_MEDIA_TYPES.includes(item.mediaType)) {
              throw new BadRequest(`payload.items[].mediaType must be one of: ${IMAGE_MEDIA_TYPES.join(', ')}`)
            }
          }
          const attachments = ctx.get('attachments')
          if (attachments === undefined) throw new BadRequest('no attachment service is mounted; uploads are unavailable')
          const stored = await admitEncodedImages(attachments, items.map((item) => ({
            data: item.data,
            mediaType: item.mediaType,
            ...typeof item.name === 'string' ? { name: item.name } : {},
          })))
          return ok({ refs: stored.map(plainRef) })
        }
        if (endpoint === 'image') {
          if (!isValidImageRef(payload)) {
            throw new BadRequest('payload must be a complete DSH image reference')
          }
          const attachments = ctx.get('attachments')
          if (attachments === undefined) throw new BadRequest('no attachment service is mounted; generated-image bytes are unavailable')
          const stored = await attachments.readImage(refToImageRef(payload), signal)
          return ok({
            mediaType: stored.ref.mediaType,
            dataBase64: Buffer.from(stored.data).toString('base64'),
          })
        }
        if (endpoint === 'file') {
          const raw = payload.path
          if (typeof raw !== 'string' || raw.length === 0) {
            throw new BadRequest('payload.path must be a non-empty string')
          }
          const cwd = typeof payload.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : process.cwd()
          const abs = resolve(isAbsolute(raw) ? raw : join(cwd, raw))
          // Either the classic generate/image seat or whatever directory the
          // user pointed the plugin at.
          if (!isGeneratedImagePath(abs) && !isImageInDir(abs, resolveOutputDir(cwd, readOutputDir()))) {
            throw new BadRequest('path is not a generated image file')
          }
          const data = await readFile(abs, signal !== undefined ? { signal } : {})
          return ok({
            mediaType: sniffImageMediaType(data),
            dataBase64: data.toString('base64'),
          })
        }
        throw new BadRequest(`unknown ${RPC_CHANNEL} endpoint "${endpoint}"`)
      } catch (error) {
        return failure(error)
      }
    }
  })
}

const SYSTEM_PROMPT_TEXT = [
  'To create an image, call image_generate_lite with a prompt; add size (aspect stop) or quality when the user names one.',
  'When the user wants to change an image they already have ("改这张"、"继续"、"基于刚才那张"), copy the most recent',
  'image_generate_lite result\'s `Image references (for image_generate_lite.referenceImages): [...]` line and pass',
  'it as referenceImages — that makes the call image-to-image, and every new result carries fresh references, so the',
  'edit loop can continue without leaving the conversation.',
  'The model and image spec come from the dsh-image-lite card on the Plugins page (model library plus a quick',
  'default-model / aspect pick), or can be adjusted live in the 生图工作台 panel (conversation header corner button).',
  'When no model is selected yet, tell the user to open that card on the Plugins page and pick one, instead of',
  'failing silently.',
].join(' ')

export function apply(ctx, config) {
  // Read at call time so a hot-committed volatile write takes effect on the
  // next tool call / RPC.
  const readActive = () => activeFromConfig(config)
  const readAspect = () => aspectFromConfig(config)
  const readOutputDir = () => outputDirFromConfig(config)

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'tool:image-gen-lite',
      order: 122,
      text: SYSTEM_PROMPT_TEXT,
    })
  })

  ctx.tools.register(createLiteTool(ctx, readActive, readAspect, readOutputDir))
  registerRpc(ctx, readActive, readAspect, readOutputDir)
}