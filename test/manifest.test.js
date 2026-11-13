/**
 * Display-metadata manifest test: the plugin row's icon and the title and
 * description Plugin Manager reads without activating the plugin.
 *
 * Sources are DSH's own shipped specs (app.asar, `@deepseek-ai/dsh-agent-preset/
 * skills/dsh-doc/references/`): `host-plugin.md` §"Display metadata, detail
 * document, and icon" for the manifest contract and `artwork.md` for what the
 * drawing may contain.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const path = (relative) => fileURLToPath(new URL(relative, root))
const read = (relative) => readFileSync(path(relative), 'utf8')
const manifest = JSON.parse(read('package.json'))

test('icon: declared at the package root, exported, packaged and drawable', () => {
  // A package-root plugin may declare a top-level `icon`, which takes priority
  // over the `./icon` export; declare both so either resolution finds it.
  assert.equal(manifest.icon, './assets/icon.svg')
  assert.equal(manifest.exports['./icon'], './assets/icon.svg')
  assert.ok(manifest.files.includes('assets/icon.svg'))

  const svg = read('assets/icon.svg')
  assert.ok(statSync(path('assets/icon.svg')).size <= 256 * 1024, 'icons are limited to 256 KiB')
  assert.match(svg, /width="36" height="36" viewBox="0 0 36 36"/)
  // artwork.md: one self-contained drawing; the panel draws the tile around it.
  for (const forbidden of ['<script', '<style', '<image', '<text', 'foreignObject']) {
    assert.ok(!svg.includes(forbidden), `icon must stay self-contained: ${forbidden}`)
  }
  assert.ok(!/url\(\s*'?https?:/.test(svg), 'icon must not reference outside resources')
  // No tile or background: nothing paints the whole 36x36 canvas.
  assert.ok(!/<rect[^>]*width="36"[^>]*height="36"/.test(svg), 'Plugin Manager draws the tile')
})

test('locales: meta.title and meta.description in every shipped language', () => {
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.ok(manifest.files.includes('locale/*.json'))
  for (const language of ['en', 'zh']) {
    const { meta } = JSON.parse(read(`locale/${language}.json`))
    assert.equal(typeof meta.title, 'string', `${language}: meta.title`)
    assert.ok(meta.title.trim().length > 0, `${language}: meta.title is not empty`)
    assert.equal(typeof meta.description, 'string', `${language}: meta.description`)
    assert.ok(meta.description.trim().length > 0, `${language}: meta.description is not empty`)
  }
})
