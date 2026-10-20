/**
 * dsh-image-lite — pure wire helpers (no DSH runtime deps; unit-testable).
 *
 * Kept separate from index.js so the aspect mapping, body building, and
 * reference validation can be exercised without a running DSH host.
 * Only Node builtins are used, so plain `node --test` works.
 */
import { basename, dirname, extname, isAbsolute, join, normalize, relative } from 'node:path'

/**
 * The 7 UI aspect stops + `auto`, mapped to openai-images `size` (first
 * choice + optional 4xx fallback). `≈` marks the two nearest-neighbor stops.
 */
export const ASPECTS = Object.freeze({
  '1:1': { primary: '1024x1024' },
  '3:2': { primary: '1536x1024' },
  '2:3': { primary: '1024x1536' },
  '4:3': { primary: '1536x1024', approx: true },
  '3:4': { primary: '1024x1536', approx: true },
  '16:9': { primary: '1792x1024', fallback: '1536x1024' },
  '9:16': { primary: '1024x1792', fallback: '1024x1536' },
  auto: {},
})

export const DEFAULT_ASPECT = '1:1'

/** Accepted media types for reference images (the DSH image set). */
export const IMAGE_MEDIA_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** How many reference images a single call may carry. */
export const MAX_REFS = 5

/**
 * Resolve the `size` to send for a given aspect and attempt index.
 * attempt 0 → primary (or undefined for `auto`/unknown); attempt 1 → the
 * 4xx fallback when the aspect declares one, otherwise undefined.
 * @param {string} aspect one of ASPECTS or 'auto'
 * @param {number} attempt 0-based
 * @returns {string|undefined}
 */
export function sizeForAspect(aspect, attempt = 0) {
  const plan = ASPECTS[aspect] ?? {}
  if (attempt === 0) return plan.primary
  if (attempt !== 1) return undefined
  // `auto` and unknown aspects fall back to square on the single retry;
  // declared aspects use their own fallback only when they have one.
  return plan.fallback ?? (aspect === 'auto' || ASPECTS[aspect] === undefined ? '1024x1024' : undefined)
}

/** Whether a given attempt still has a fallback size to try next. */
export function hasSizeFallback(aspect, attempt) {
  return sizeForAspect(aspect, attempt + 1) !== undefined
}

/**
 * Build the openai-images request body for /images/generations or
 * /images/edits. `references` are data URLs; when editing, each is wrapped
 * as `{ image_url }` (the object-array shape the gateway accepts).
 */
export function buildOpenAiImagesBody({ model, prompt, size, quality, references }) {
  const editing = Array.isArray(references) && references.length > 0
  const body = {
    model,
    prompt: String(prompt ?? '').trim(),
    n: 1,
  }
  if (size) body.size = size
  if (quality && quality !== 'auto') body.quality = quality
  body.response_format = 'b64_json'
  if (editing) body.images = references.map((image_url) => ({ image_url }))
  return body
}

/**
 * Edit bodies that carry the source image inline as JSON — the shape Agnes-style
 * gateways expose (`image` is the first reference, `images` the full list).
 */
export function buildEditJsonBody({ model, prompt, size, quality, references, includeResponseFormat = true }) {
  const body = {
    model,
    prompt: String(prompt ?? '').trim(),
    n: 1,
    image: references[0],
  }
  if (references.length > 1) body.images = references.map((image_url) => ({ image_url }))
  if (size) body.size = size
  if (quality && quality !== 'auto') body.quality = quality
  if (includeResponseFormat) body.response_format = 'b64_json'
  return body
}

/**
 * Some providers do image-to-image on the generations endpoint with the source
 * picture inline as `image` (Agnes returns a task URL for it).
 */
export function buildImg2ImgBody({ model, prompt, size, quality, references }) {
  const body = {
    model,
    prompt: String(prompt ?? '').trim(),
    n: 1,
    image: references[0],
  }
  if (size) body.size = size
  if (quality && quality !== 'auto') body.quality = quality
  if (references.length > 1) body.images = references.map((image_url) => ({ image_url }))
  return body
}

/**
 * The OpenAI edit endpoint takes multipart form data, not JSON: a file part per
 * reference plus the plain fields. JSON bodies with an `images` array only work
 * on gateways that invented that shape, so this is the first attempt.
 */
export function buildEditFormData({ model, prompt, size, quality, references, includeResponseFormat = true }) {
  const form = new FormData()
  form.set('model', model)
  form.set('prompt', String(prompt ?? '').trim())
  form.set('n', '1')
  if (size) form.set('size', size)
  if (quality && quality !== 'auto') form.set('quality', quality)
  if (includeResponseFormat) form.set('response_format', 'b64_json')
  const field = references.length > 1 ? 'image[]' : 'image'
  references.forEach((imageUrl, index) => {
    const decoded = decodeDataUrl(imageUrl)
    if (decoded === null) throw new Error('image_generate_lite: reference image is not a data URL')
    const ext = decoded.mime === 'image/jpeg' ? 'jpg' : (decoded.mime.split('/')[1] ?? 'png')
    form.append(field, new Blob([decoded.data], { type: decoded.mime }), 'reference-' + index + '.' + ext)
  })
  return form
}

/** Drop `response_format` (gateways that reject it) and keep the rest. */
export function omitResponseFormat(body) {
  const { response_format: _omit, ...rest } = body
  return rest
}

/**
 * Decode a `data:<mime>;base64,<...>` URL.
 * @returns {{ mime: string, data: Uint8Array } | null}
 */
export function decodeDataUrl(value) {
  const match = String(value).match(/^data:([^;,]+);base64,(.+)$/s)
  if (!match) return null
  const bytes = base64ToBytes(match[2])
  if (bytes === null) return null
  return { mime: match[1], data: bytes }
}

/**
 * Base64 → Uint8Array, canonical only (no whitespace, valid charset, length
 * a multiple of 4). Both the host (Node) and the test runner have Buffer.
 * @returns {Uint8Array|null}
 */
export function base64ToBytes(b64) {
  const clean = String(b64)
  if (clean.length === 0) return null
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null
  if (clean.length % 4 !== 0) return null
  if (clean.length < 4) return null
  // Buffer here is the Node global (host and tests both run on Node).
  const { Buffer: Buf } = globalThis
  const bytes = Buf.from(clean, 'base64')
  // Node's base64 decoder is lenient; re-encode and compare for canonicity.
  if (bytes.toString('base64') !== clean) return null
  return new Uint8Array(bytes)
}

/** Sniff a common image media type from raw bytes. */
export function sniffImageMediaType(data) {
  const d = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (d.length >= 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return 'image/jpeg'
  const ascii = (i, n) => {
    let s = ''
    for (let k = 0; k < n && i + k < d.length; k++) s += String.fromCharCode(d[i + k])
    return s
  }
  if (d.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  const gif = d.length >= 6 ? ascii(0, 6) : ''
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'
  return 'image/png'
}

/** Map a media type to its conventional file extension. */
export function extensionForMediaType(mediaType) {
  return ({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  })[mediaType] ?? 'png'
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

/** Strip the quotes a pasted Windows path often carries. */
function unquote(value) {
  const text = String(value ?? '').trim()
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1).trim()
  }
  return text
}

/**
 * Absolute on any platform: `path.isAbsolute` only knows the host's own syntax, so
 * a Windows drive (`E:/pics`, `E:\pics`) or UNC (`\\host\share`) path has to be
 * recognised explicitly — otherwise a config written on Windows is treated as
 * relative when read anywhere else (and vice versa), and CI on Linux disagrees
 * with the desktop build.
 */
export function isAbsoluteAnywhere(value) {
  const text = String(value ?? '')
  if (isAbsolute(text)) return true
  return /^[A-Za-z]:[\\/]/.test(text) || /^\\\\/.test(text)
}

/**
 * Where a session's images go: the configured directory when it is set,
 * otherwise `<cwd>/generate/image`. A relative setting resolves against the
 * session workspace, an absolute one is used as-is; an empty setting always
 * falls back to the default, so clearing the field restores it.
 */
export function resolveOutputDir(cwd, configured) {
  const root = typeof cwd === 'string' && cwd.trim() ? unquote(cwd) : process.cwd()
  const raw = unquote(configured)
  if (!raw) return join(root, 'generate', 'image')
  const expanded = raw.startsWith('~/') || raw.startsWith('~\\')
    ? join(process.env.USERPROFILE ?? process.env.HOME ?? root, raw.slice(2))
    : raw
  return normalize(isAbsoluteAnywhere(expanded) ? expanded : join(root, expanded))
}

/**
 * The path to hand back to the client: relative to the workspace when the
 * image lives inside it (so the existing join(cwd, path) keeps working),
 * absolute otherwise.
 */
export function pathForResult(cwd, absolute) {
  const root = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : process.cwd()
  const rel = relative(root, absolute)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : absolute
}

/** True when `abs` points inside a `generate/image` directory. */
export function isGeneratedImagePath(abs) {
  const parent = basename(dirname(abs))
  const grand = basename(dirname(dirname(abs)))
  return parent === 'image' && grand === 'generate' && IMAGE_EXTENSIONS.has(extname(abs).toLowerCase())
}

/** True when `abs` is an image written into `dir` (any configured directory). */
export function isImageInDir(abs, dir) {
  if (!IMAGE_EXTENSIONS.has(extname(abs).toLowerCase())) return false
  const rel = relative(normalize(dir), abs)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Validate one DSH image reference value (the 5+2 field set) against the
 * expected shape. Pure; used by both the tool's referenceImages and the
 * RPC `image` endpoint.
 */
export function isValidImageRef(ref) {
  if (ref === null || typeof ref !== 'object') return false
  if (typeof ref.attachmentId !== 'string' || ref.attachmentId.length === 0) return false
  if (!IMAGE_MEDIA_TYPES.includes(ref.mediaType)) return false
  for (const key of ['bytes', 'width', 'height']) {
    if (!Number.isSafeInteger(ref[key]) || ref[key] <= 0) return false
  }
  return true
}

/**
 * Normalize a `referenceImages` value to an ordered dedup list of refs.
 * @returns {{ refs: unknown[], error?: string }}
 */
export function normalizeRefs(refs) {
  if (refs === undefined || refs === null) return { refs: [] }
  if (!Array.isArray(refs)) return { refs: [], error: 'referenceImages must be an array' }
  if (refs.length < 1) return { refs: [], error: 'referenceImages must contain 1–5 images; omit for a new image' }
  if (refs.length > MAX_REFS) return { refs: [], error: `referenceImages holds at most ${MAX_REFS} images` }
  const seen = new Set()
  for (const ref of refs) {
    if (!isValidImageRef(ref)) {
      return { refs: [], error: 'referenceImages entry is not a complete DSH image reference; copy one from a previous image_generate_lite result' }
    }
    if (seen.has(ref.attachmentId)) return { refs: [], error: 'referenceImages contains duplicate images' }
    seen.add(ref.attachmentId)
  }
  return { refs }
}

/**
 * Format the tool/RPC result text. The embedded refs JSON is what makes the
 * "keep editing" loop possible: the next turn passes it back as referenceImages.
 */
export function imageLiteText(value) {
  const paths = Array.isArray(value.paths) ? value.paths : []
  let text = `Saved ${paths.length} image(s):\n${paths.map((p) => `- ${p}`).join('\n')}`
  if (Array.isArray(value.images) && value.images.length > 0) {
    text += `\n\nImage references (for image_generate_lite.referenceImages): ${JSON.stringify(value.images)}`
  }
  return text
}

/** A status-carrying error so the retry loop can tell 400s from 401s. */
export class HttpStatusError extends Error {
  constructor(status, message, payload) {
    super(message)
    this.name = 'HttpStatusError'
    this.status = status
    this.payload = payload
  }
}

/** Extract a human message from an error payload (mirror of the gateway shape). */
export function errorDetail(payload, status) {
  const detail = typeof payload?.error === 'string'
    ? payload.error
    : payload?.error?.message ?? payload?.message ?? payload?.error?.status
  return detail && String(detail).length > 0 ? String(detail) : `image API error (HTTP ${status})`
}
