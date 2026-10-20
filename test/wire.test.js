/**
 * Unit tests for the dsh-image-lite pure wire helpers.
 * Run: node --test test/wire.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join, normalize } from 'node:path'

import {
  ASPECTS,
  DEFAULT_ASPECT,
  IMAGE_MEDIA_TYPES,
  MAX_REFS,
  sizeForAspect,
  hasSizeFallback,
  buildOpenAiImagesBody,
  buildEditFormData,
  buildEditJsonBody,
  omitResponseFormat,
  decodeDataUrl,
  base64ToBytes,
  sniffImageMediaType,
  extensionForMediaType,
  isGeneratedImagePath,
  isImageInDir,
  pathForResult,
  resolveOutputDir,
  isValidImageRef,
  normalizeRefs,
  imageLiteText,
  HttpStatusError,
  errorDetail,
} from '../wire.js'

test('aspect map: all 7 stops + auto, first-choice sizes', () => {
  assert.equal(sizeForAspect('1:1', 0), '1024x1024')
  assert.equal(sizeForAspect('3:2', 0), '1536x1024')
  assert.equal(sizeForAspect('2:3', 0), '1024x1536')
  assert.equal(sizeForAspect('4:3', 0), '1536x1024')
  assert.equal(sizeForAspect('3:4', 0), '1024x1536')
  assert.equal(sizeForAspect('16:9', 0), '1792x1024')
  assert.equal(sizeForAspect('9:16', 0), '1024x1792')
  assert.equal(sizeForAspect('auto', 0), undefined)
  assert.equal(sizeForAspect('nope', 0), undefined)
})

test('aspect map: 4xx fallbacks only where declared (16:9, 9:16, auto/unknown)', () => {
  assert.equal(sizeForAspect('16:9', 1), '1536x1024')
  assert.equal(sizeForAspect('9:16', 1), '1024x1536')
  assert.equal(sizeForAspect('auto', 1), '1024x1024')
  assert.equal(sizeForAspect('nope', 1), '1024x1024')
  assert.equal(sizeForAspect('1:1', 1), undefined)
  assert.equal(sizeForAspect('3:2', 1), undefined)
  assert.equal(sizeForAspect('4:3', 1), undefined)
  // the retry happens exactly once
  assert.equal(sizeForAspect('16:9', 2), undefined)
  assert.equal(sizeForAspect('auto', 2), undefined)
})

test('hasSizeFallback gates the single retry', () => {
  assert.equal(hasSizeFallback('16:9', 0), true)
  assert.equal(hasSizeFallback('auto', 0), true)
  assert.equal(hasSizeFallback('1:1', 0), false)
  assert.equal(hasSizeFallback('16:9', 1), false)
})

test('defaults', () => {
  assert.equal(DEFAULT_ASPECT, '1:1')
  assert.equal(MAX_REFS, 5)
  assert.deepEqual(IMAGE_MEDIA_TYPES, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  assert.ok(Object.keys(ASPECTS).length === 8)
})

test('buildOpenAiImagesBody: text-to-image omits quality=auto and images', () => {
  const body = buildOpenAiImagesBody({ model: 'm', prompt: '  hello world  ', size: '1024x1024', quality: 'auto', references: undefined })
  assert.deepEqual(body, {
    model: 'm',
    prompt: 'hello world',
    n: 1,
    size: '1024x1024',
    response_format: 'b64_json',
  })
})

test('buildOpenAiImagesBody: explicit quality passes through; absent size omitted', () => {
  const body = buildOpenAiImagesBody({ model: 'm', prompt: 'p', size: undefined, quality: 'high', references: undefined })
  assert.equal(body.quality, 'high')
  assert.ok(!('size' in body))
})

test('buildOpenAiImagesBody: editing wraps refs as { image_url } object array', () => {
  const refs = ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB=']
  const body = buildOpenAiImagesBody({ model: 'm', prompt: 'edit', size: '1024x1024', quality: 'auto', references: refs })
  assert.deepEqual(body.images, [
    { image_url: 'data:image/png;base64,AAA=' },
    { image_url: 'data:image/png;base64,BBB=' },
  ])
})

test('buildOpenAiImagesBody: empty refs array is not editing', () => {
  const body = buildOpenAiImagesBody({ model: 'm', prompt: 'p', size: undefined, quality: undefined, references: [] })
  assert.ok(!('images' in body))
  assert.ok(!('quality' in body))
})

test('omitResponseFormat keeps the rest of the body', () => {
  const body = buildOpenAiImagesBody({ model: 'm', prompt: 'p', size: '1024x1024', quality: 'auto', references: undefined })
  const stripped = omitResponseFormat(body)
  assert.ok(!('response_format' in stripped))
  assert.equal(stripped.model, 'm')
})

test('decodeDataUrl: valid b64 data URL, invalid shapes', () => {
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
  const decoded = decodeDataUrl(`data:image/png;base64,${payload}`)
  assert.equal(decoded.mime, 'image/png')
  assert.deepEqual(Array.from(decoded.data), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(decodeDataUrl(`https://example.com/a.png`), null)
  assert.equal(decodeDataUrl('not a url'), null)
})

test('base64ToBytes: canonical accepts, rejects non-canonical', () => {
  const good = base64ToBytes('aGVsbG8=')
  assert.deepEqual(Array.from(good), [104, 101, 108, 108, 111])
  assert.equal(base64ToBytes('aGVsbG8'), null) // missing padding
  assert.equal(base64ToBytes('aG vs bG8='), null) // whitespace
  assert.equal(base64ToBytes(''), null)
})

test('sniffImageMediaType: jpeg/webp/gif, png default', () => {
  assert.equal(sniffImageMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  const webp = new Uint8Array(16)
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
  assert.equal(sniffImageMediaType(webp), 'image/webp')
  const gif = Buffer.from('GIF89a')
  assert.equal(sniffImageMediaType(new Uint8Array(gif)), 'image/gif')
  assert.equal(sniffImageMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'image/png')
  assert.equal(sniffImageMediaType(new Uint8Array([1, 2, 3])), 'image/png')
})

test('extensionForMediaType', () => {
  assert.equal(extensionForMediaType('image/jpeg'), 'jpg')
  assert.equal(extensionForMediaType('image/webp'), 'webp')
  assert.equal(extensionForMediaType('image/x-bogus'), 'png')
})

test('isGeneratedImagePath', () => {
  assert.equal(isGeneratedImagePath('D:/ws/generate/image/image-1.png'), true)
  assert.equal(isGeneratedImagePath('D:/ws/generate/image/a.jpg'), true)
  assert.equal(isGeneratedImagePath('D:/ws/image/a.png'), false)
  assert.equal(isGeneratedImagePath('D:/ws/generate/images/a.png'), false)
  assert.equal(isGeneratedImagePath('D:/ws/generate/image/a.txt'), false)
  assert.equal(isGeneratedImagePath('D:/ws/generate/image/../../etc/passwd.png'), false)
})

test('isValidImageRef + normalizeRefs', () => {
  const ref = {
    attachmentId: 'att-1',
    mediaType: 'image/png',
    bytes: 12,
    width: 4,
    height: 4,
  }
  assert.equal(isValidImageRef(ref), true)
  assert.equal(isValidImageRef({ ...ref, bytes: 0 }), false)
  assert.equal(isValidImageRef({ ...ref, mediaType: 'image/x-bmp' }), false)
  assert.equal(isValidImageRef(null), false)
  assert.equal(isValidImageRef({ ...ref, width: 4.5 }), false)

  assert.deepEqual(normalizeRefs([ref]), { refs: [ref] })
  assert.equal(normalizeRefs(undefined).refs.length, 0)
  assert.match(normalizeRefs([]).error, /1–5/)
  assert.match(normalizeRefs([ref, ref]).error, /duplicate/)
  assert.match(normalizeRefs([{ ...ref, bytes: 0 }]).error, /complete/)
  assert.match(normalizeRefs('x').error, /array/)
  const five = Array.from({ length: 5 }, (_, i) => ({ ...ref, attachmentId: `att-${i}` }))
  assert.equal(normalizeRefs(five).error, undefined)
  assert.match(normalizeRefs([...five, ref]).error, /at most 5/)
})

test('imageLiteText embeds refs JSON for the keep-editing loop', () => {
  const noImages = imageLiteText({ paths: ['generate/image/a.png'], images: [] })
  assert.match(noImages, /Saved 1 image\(s\):/)
  assert.match(noImages, /- generate\/image\/a\.png/)
  assert.ok(!noImages.includes('Image references'))

  const refs = [{ attachmentId: 'att-9', mediaType: 'image/png', bytes: 3, width: 1, height: 1 }]
  const withImages = imageLiteText({ paths: ['generate/image/a.png'], images: refs })
  assert.match(withImages, /Image references \(for image_generate_lite\.referenceImages\): \[.*att-9.*\]/)
})

test('HttpStatusError + errorDetail', () => {
  const err = new HttpStatusError(400, 'boom')
  assert.equal(err.status, 400)
  assert.equal(err.name, 'HttpStatusError')
  assert.match(err.message, /boom/)
  assert.equal(errorDetail({ error: { message: 'bad size' } }, 400), 'bad size')
  assert.equal(errorDetail({ message: 'nope' }, 404), 'nope')
  assert.equal(errorDetail({}, 500), 'image API error (HTTP 500)')
})

test('resolveOutputDir: empty falls back to the workspace generate/image', () => {
  assert.equal(resolveOutputDir('D:/ws', ''), join('D:/ws', 'generate', 'image'))
  assert.equal(resolveOutputDir('D:/ws', '   '), join('D:/ws', 'generate', 'image'))
  assert.equal(resolveOutputDir('D:/ws', undefined), join('D:/ws', 'generate', 'image'))
})

test('resolveOutputDir: absolute, relative, quoted and tilde paths', () => {
  assert.equal(resolveOutputDir('D:/ws', 'E:/pics'), normalize('E:/pics'))
  assert.equal(resolveOutputDir('D:/ws', 'pics'), join('D:/ws', 'pics'))
  assert.equal(resolveOutputDir('D:/ws', '"E:/pics wall"'), normalize('E:/pics wall'))
  assert.equal(resolveOutputDir('D:/ws', '~/pics'), normalize(join(process.env.USERPROFILE ?? process.env.HOME ?? 'D:/ws', 'pics')))
})

test('pathForResult: relative inside the workspace, absolute outside', () => {
  assert.equal(pathForResult('D:/ws', join('D:/ws', 'generate', 'image', 'a.png')), join('generate', 'image', 'a.png'))
  assert.equal(pathForResult('D:/ws', 'E:/pics/a.png'), 'E:/pics/a.png')
})

test('isImageInDir: accepts images directly inside the folder only', () => {
  assert.equal(isImageInDir(join('E:/pics', 'a.png'), 'E:/pics'), true)
  assert.equal(isImageInDir(join('E:/pics', 'sub', 'a.png'), 'E:/pics'), true)
  assert.equal(isImageInDir('E:/pics/a.txt', 'E:/pics'), false)
  assert.equal(isImageInDir('E:/other/a.png', 'E:/pics'), false)
})
const REF_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAI0wB0cOZ1xQAAAAASUVORK5CYII='

test('buildEditFormData: multipart with an image file part, not a JSON images array', async () => {
  const form = buildEditFormData({ model: 'm', prompt: ' edit me ', size: '1024x1024', quality: 'high', references: [REF_PNG] })
  assert.equal(form.get('model'), 'm')
  assert.equal(form.get('prompt'), 'edit me')
  assert.equal(form.get('n'), '1')
  assert.equal(form.get('size'), '1024x1024')
  assert.equal(form.get('quality'), 'high')
  assert.equal(form.get('response_format'), 'b64_json')
  const part = form.get('image')
  assert.equal(part.type, 'image/png')
  assert.equal(part.name, 'reference-0.png')
  assert.ok(part.size > 40)
  assert.equal(form.get('image[]'), null)
})

test('buildEditFormData: several refs use the image[] field; auto quality and response_format are optional', () => {
  const form = buildEditFormData({
    model: 'm', prompt: 'p', size: undefined, quality: 'auto',
    references: [REF_PNG, REF_PNG], includeResponseFormat: false,
  })
  assert.equal(form.getAll('image[]').length, 2)
  assert.equal(form.get('image'), null)
  assert.equal(form.get('quality'), null)
  assert.equal(form.get('size'), null)
  assert.equal(form.get('response_format'), null)
})

test('buildEditFormData: a non data URL reference is rejected', () => {
  assert.throws(() => buildEditFormData({ model: 'm', prompt: 'p', references: ['https://example.com/a.png'] }), /reference image is not a data URL/)
})

test('buildEditJsonBody: sends the single source image inline as `image`', () => {
  const body = buildEditJsonBody({ model: 'm', prompt: ' cool it down ', size: '1024x1024', quality: 'auto', references: [REF_PNG] })
  assert.deepEqual(body, {
    model: 'm', prompt: 'cool it down', n: 1, image: REF_PNG, size: '1024x1024', response_format: 'b64_json',
  })
  assert.equal(body.images, undefined)
  assert.equal(body.quality, undefined)
})

test('buildEditJsonBody: several refs also carry the legacy images array; response_format is optional', () => {
  const body = buildEditJsonBody({ model: 'm', prompt: 'p', references: [REF_PNG, REF_PNG], includeResponseFormat: false })
  assert.equal(body.image, REF_PNG)
  assert.equal(body.images.length, 2)
  assert.equal(body.images[0].image_url, REF_PNG)
  assert.equal(body.response_format, undefined)
  assert.equal(body.size, undefined)
})
