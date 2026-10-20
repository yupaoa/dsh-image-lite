/**
 * Client-half wiring test: run the module factory and apply() against a
 * stubbed client context; assert the registration shapes.
 *
 * This is the Node-runnable slice of the P0 smoke: it proves the client
 * module activates, its inject list is well-formed, and every slot seat
 * registers under the right keys. It does not render (no DOM) and does
 * not touch the real services.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const clientSource = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')
const hostSourceForSwitch = readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8')

function makeReactStub() {
  // Just enough surface for the module's top-level usage; components are
  // only defined here, never rendered.
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'Fragment') return 'Fragment'
      if (prop === 'createElement' || prop === 'useState' || prop === 'useEffect' || prop === 'useCallback' || prop === 'useMemo') {
        return (..._args) => undefined
      }
      return undefined
    },
  })
}

function inertForm(value) {
  return {
    getSnapshot: () => ({ status: 'ready', value, writable: true, revision: 1 }),
    subscribe: () => () => {},
    mutate: async () => true,
  }
}

function runClient(options = {}) {
  const failSeat = options.failSeat
  const registrations = []
  const effects = []
  const typeRegistrations = []
  const openTabCalls = []
  const loaded = []

  const stubWindow = {
    __ModuleLoader__: {
      load(entry) { loaded.push(entry) },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }

  // Client modules are plain scripts; evaluate in a scope that provides
  // `window` and a capturing require.
  const factoryRegistry = {}
  const require = (id) => {
    if (id === 'react') return makeReactStub()
    if (id.startsWith('@deepseek-ai/')) return {}
    return {}
  }
  const fn = new Function('window', 'require', clientSource)
  fn(stubWindow, require)

  assert.equal(loaded.length, 1)
  const module = loaded[0].factory(require)

  const completeActive = {
    providerId: 'agnes', modelId: 'agnes-image', baseUrl: 'https://api.example/v1',
    model: 'agnes-image', apiKeyEnv: 'IMAGE_GEN_AGNES_API_KEY', apiFormat: 'openai-images',
  }
  const providers = [{
    id: 'agnes', name: 'agnes', baseUrl: 'https://api.example/v1',
    apiFormat: 'openai-images', apiKeyEnv: 'IMAGE_GEN_AGNES_API_KEY',
    models: [{ id: 'agnes-image', name: 'agnes image' }],
  }]
  const entryValue = { providers, active: completeActive, activeAspect: '1:1' }
  const configForms = {
    get: (ns) => (ns === 'image-gen-lite' ? inertForm(entryValue) : inertForm({})),
  }
  const rpcStub = { call: async () => ({ ok: true, value: {} }) }
  const connectionStub = { rpc: rpcStub }
  const sidebarRightStub = { openTab: (kind) => openTabCalls.push(kind) }

  const ctx = {
    get(name) {
      if (name === 'configForms') return configForms
      if (name === 'connection') return connectionStub
      if (name === 'sidebarRight') return sidebarRightStub
      return undefined
    },
    locale: {
      bind: () => (key, params) => (params ? `${key} ${params}` : key),
      register: () => {},
    },
    slots: {
      inject(name, factory) {
        const record = { name, descriptor: null }
        registrations.push(record)
        record.disposer = factory()
        record.factory = factory
        return () => {}
      },
      register(descriptor, Component) {
        if (failSeat !== undefined && descriptor.name === failSeat) {
          throw new Error(`slot "${descriptor.name}" is already taken`)
        }
        const last = registrations[registrations.length - 1]
        if (last && last.descriptor === null) last.descriptor = descriptor
        descriptor.component = Component
        return () => {}
      },
    },
    effect(fn, label) {
      const result = fn()
      effects.push({ label, result })
      return () => {}
    },
    reflect: { provide: () => () => {} },
    connection: connectionStub,
    sidebarRight: sidebarRightStub,
    sidebarRightTabs: {
      register(definition) {
        typeRegistrations.push(definition)
        return () => {}
      },
    },
    uiConversation: { imageUrl: (sessionId, ref) => `url:${sessionId}:${ref.attachmentId}` },
    remote: { credentials: { describe: async () => ({ ok: true, value: {} }) } },
  }

  module.apply(ctx)
  return { module, registrations, effects, typeRegistrations, openTabCalls, ctx, completeActive, entryValue }
}

test('client module id and factory', () => {
  const { module } = runClient()
  assert.equal(typeof module.apply, 'function')
  assert.deepEqual(module.inject, [
    'slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'connection',
    'remote', 'remote.credentials', 'configForms', 'uiConversation', 'sessions',
  ])
})

test('tab type registers under the right id/kind with keepMounted', () => {
  const { typeRegistrations } = runClient()
  assert.equal(typeRegistrations.length, 1)
  const def = typeRegistrations[0]
  assert.equal(def.id, 'dsh-image-lite')
  assert.equal(def.kind, 'image-gen-lite')
  assert.equal(def.keepMounted, true)
  assert.equal(typeof def.title, 'function')
  assert.ok(Array.isArray(def.guide) && def.guide.length === 1)
  assert.equal(def.guide[0].id, 'dsh-image-lite')
})

test('the five slot seats register under the right keys', () => {
  const { registrations } = runClient()
  const find = (name) => registrations.find((r) => r.name === name)
  const pane = find('sidebar.right.pane.tab')
  const title = find('sidebar.right.pane.tab.title')
  const header = find('conversation.session.header.utilities')
  const card = find('plugins.bundle.config')
  const toolview = find('tool.call.toolview')
  assert.ok(pane && title && header && card && toolview)
  // The header button lives in the list seat: `...header.corner` is a single
  // seat already owned by the shell, and registering there fails the entry.
  assert.equal(find('conversation.session.header.corner'), undefined)
  assert.equal(header.descriptor.id, 'dsh-image-lite')
  assert.equal(typeof header.descriptor.order, 'number')
  assert.equal(pane.descriptor.key, 'dsh-image-lite')
  assert.equal(title.descriptor.key, 'dsh-image-lite')
  assert.equal(card.descriptor.key, 'dsh-image-lite')
  assert.equal(toolview.descriptor.key, 'image_generate_lite')
  assert.equal(typeof pane.descriptor.inject, 'function')
  assert.equal(typeof pane.descriptor.component, 'function')
  assert.equal(typeof card.descriptor.component, 'function')
})

test('studio body inject yields session-scoped props with the live entry form', () => {
  const { registrations, completeActive, entryValue } = runClient()
  const pane = registrations.find((r) => r.name === 'sidebar.right.pane.tab')
  const values = pane.descriptor.inject('sess-1')
  assert.equal(values.sessionId, 'sess-1')
  assert.equal(typeof values.rpc?.call, 'function')
  assert.equal(typeof values.liteForm.getSnapshot, 'function')
  assert.deepEqual(values.liteForm.getSnapshot().value.active, completeActive)
  assert.deepEqual(values.liteForm.getSnapshot().value.providers, entryValue.providers)
})

test('settings card inject exposes the entry form', () => {
  const { registrations, entryValue } = runClient()
  const card = registrations.find((r) => r.name === 'plugins.bundle.config')
  const values = card.descriptor.inject()
  assert.equal(typeof values.liteForm.getSnapshot, 'function')
  assert.deepEqual(values.liteForm.getSnapshot().value.providers, entryValue.providers)
})

test('pure model-library helpers (lib)', () => {
  const { module } = runClient()
  const lib = module.lib
  assert.ok(lib, 'lib exposed for tests')
  const providers = [{
    id: 'agnes', name: 'agnes', baseUrl: 'https://api.example/v1',
    apiFormat: 'openai-images', apiKeyEnv: 'IMAGE_GEN_AGNES_API_KEY',
    models: [{ id: 'agnes-image', name: 'agnes image' }],
  }]
  const unsupported = [{
    id: 'grok', name: 'grok', baseUrl: 'https://x.example/v1',
    apiFormat: 'xai-images', apiKeyEnv: 'XAI_KEY',
    models: [{ id: 'grok-image', name: 'grok image' }],
  }]
  // parseModelLines: `id` and `id  display name`, blank/# lines skipped, dedup
  assert.deepEqual(lib.parseModelLines('gpt-image-1\ngpt-image-2  GPT Image 2\n\n#x\ngpt-image-1\n'), [
    { id: 'gpt-image-1', name: 'gpt-image-1' },
    { id: 'gpt-image-2', name: 'GPT Image 2' },
  ])
  // modelOptionsFrom filters to the supported format only
  const options = lib.modelOptionsFrom([...providers, ...unsupported])
  assert.equal(options.length, 1)
  assert.equal(options[0].value, 'agnes::agnes-image')
  assert.equal(options[0].apiFormat, 'openai-images')
  // buildActiveFromOption resolves the six fields
  const active = lib.buildActiveFromOption({ ...options[0], baseUrl: providers[0].baseUrl, apiKeyEnv: providers[0].apiKeyEnv })
  assert.deepEqual(active, {
    providerId: 'agnes', modelId: 'agnes-image', baseUrl: 'https://api.example/v1',
    model: 'agnes-image', apiKeyEnv: 'IMAGE_GEN_AGNES_API_KEY', apiFormat: 'openai-images',
  })
  // activeChoiceFor matches only real options
  assert.equal(lib.activeChoiceFor(active, options), 'agnes::agnes-image')
  assert.equal(lib.activeChoiceFor({ ...active, providerId: 'nope' }, options), '')
  // syncActiveWithProviders clears a stale selection, refreshes edits otherwise
  assert.equal(lib.activeLooksComplete(active), true)
  // the model id is required too (mirrors the host's activeComplete)
  assert.equal(lib.activeLooksComplete({ ...active, model: '' }), false)
  assert.equal(lib.activeLooksComplete(lib.syncActiveWithProviders(active, [{ ...providers[0], models: [] }])), false)
  const kept = lib.syncActiveWithProviders(active, providers.map((p) => ({ ...p, baseUrl: 'https://new.example/v1' })))
  assert.equal(kept.baseUrl, 'https://new.example/v1')
  assert.equal(lib.activeLooksComplete(kept), true)
  // an incomplete active stays empty
  assert.equal(lib.activeLooksComplete(lib.syncActiveWithProviders(lib.emptyActiveValue(), providers)), false)
  // slugForProvider
  assert.equal(lib.slugForProvider('My Provider', new Set()), 'my-provider')
  assert.equal(lib.slugForProvider('My Provider', new Set(['my-provider'])), 'my-provider-2')
})

test('header entry opens the studio kind through the sidebar controller', () => {
  const { registrations, openTabCalls } = runClient()
  const header = registrations.find((r) => r.name === 'conversation.session.header.utilities')
  const values = header.descriptor.inject()
  values.openStudio()
  assert.deepEqual(openTabCalls, ['image-gen-lite'])
})

test('apply runs its effects without throwing', () => {
  const { effects } = runClient()
  assert.ok(effects.length >= 4)
  const labels = effects.map((e) => e.label)
  // The four studio seats live inside one gated effect now.
  assert.ok(labels.some((l) => l?.includes('sidebar studio')))
  assert.ok(labels.some((l) => l?.includes('toolview')))
  assert.ok(labels.some((l) => l?.includes('copy dictionaries')))
  assert.ok(labels.some((l) => l?.includes('settings card')))
})

test('one rejected seat costs that seat only, never the whole entry', () => {
  // The web shell reports "entry did not activate" for any throw inside a
  // client entry and refuses to boot the UI, so a seat this build no longer
  // declares (or another plugin already owns) must degrade to a warning.
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.map((a) => String(a)).join(' '))
  try {
    const { registrations } = runClient({ failSeat: 'plugins.bundle.config' })
    const live = registrations.filter((r) => r.descriptor !== null)
    assert.ok(live.some((r) => r.name === 'sidebar.right.pane.tab'))
    assert.ok(live.some((r) => r.name === 'conversation.session.header.utilities'))
    assert.ok(live.some((r) => r.name === 'tool.call.toolview'))
    assert.equal(live.some((r) => r.name === 'plugins.bundle.config'), false)
    assert.ok(warnings.some((w) => w.includes('settings card')))
  } finally {
    console.warn = originalWarn
  }
})



test('a typed provider draft saves into the library', () => {
  const { module } = runClient()
  // Exactly what the editor holds after typing into a fresh "add provider" form.
  const draft = {
    isNew: true, id: '', name: 'Agnes', baseUrl: 'https://api.agnes-ai.cn/v1',
    apiFormat: 'openai-images', apiKeyEnv: 'MY_IMAGE_API_KEY',
    modelsText: 'agnes-image-2.5-flash',
  }
  const out = module.lib.providerFromDraft(draft, [])
  assert.equal(out.error, undefined)
  assert.equal(out.provider.id, 'agnes')
  assert.equal(out.provider.name, 'Agnes')
  assert.equal(out.provider.apiKeyEnv, 'MY_IMAGE_API_KEY')
  assert.deepEqual(out.provider.models.map((m) => m.id), ['agnes-image-2.5-flash'])
  assert.equal(out.nextProviders.length, 1)
})

test('an untouched form explains why saving did nothing', () => {
  const { module } = runClient()
  const out = module.lib.providerFromDraft({ isNew: true, name: '', id: '' }, [])
  assert.equal(out.error, 'nameRequired')
})

test('a new provider may not reuse an existing id', () => {
  const { module, entryValue } = runClient()
  const out = module.lib.providerFromDraft({ isNew: true, id: 'agnes', name: '' }, entryValue.providers)
  assert.equal(out.error, 'idTaken')
})

test('editing an existing provider replaces it in place', () => {
  const { module, entryValue } = runClient()
  const out = module.lib.providerFromDraft(
    { isNew: false, id: 'agnes', name: 'agnes 2', baseUrl: 'https://api.example/v2', modelsText: 'm1' },
    entryValue.providers,
  )
  assert.equal(out.nextProviders.length, 1)
  assert.equal(out.nextProviders[0].name, 'agnes 2')
  assert.equal(out.nextProviders[0].baseUrl, 'https://api.example/v2')
})

test('the editor forwards its typed values to save', () => {
  // The regression: the save button used to hand over the outer draft, which
  // never receives keystrokes, so every save was a silent no-op.
  assert.match(clientSource, /onClick:\s*\(\)\s*=>\s*onSave\(value\)/)
  assert.match(clientSource, /onSave:\s*\(values\)\s*=>\s*saveProvider\(values\s*\?\?\s*editing\)/)
})
test('a colliding name is reported, never silently renamed', () => {
  const { module, entryValue } = runClient()
  const out = module.lib.providerFromDraft({ isNew: true, id: '', name: 'Agnes' }, entryValue.providers)
  assert.equal(out.error, 'nameTaken')
  assert.equal(out.nextProviders, undefined)
})

test('a typed id that collides is reported as an id clash', () => {
  const { module, entryValue } = runClient()
  const out = module.lib.providerFromDraft({ isNew: true, id: 'agnes', name: 'Agnes CN' }, entryValue.providers)
  assert.equal(out.error, 'idTaken')
})

test('editing a provider is not a clash with itself', () => {
  const { module, entryValue } = runClient()
  const out = module.lib.providerFromDraft(
    { isNew: false, id: 'agnes', name: 'agnes', baseUrl: 'https://api.example/v1', modelsText: 'm1' },
    entryValue.providers,
  )
  assert.equal(out.error, undefined)
  assert.equal(out.nextProviders.length, 1)
})
test('maskSecret keeps only the ends of a key', () => {
  const { module } = runClient()
  assert.equal(module.lib.maskSecret('sk-0abcdef1234567890'), 'sk-0****7890')
  assert.equal(module.lib.maskSecret('short'), '*****')
  assert.equal(module.lib.maskSecret(''), '')
  assert.equal(module.lib.maskSecret(undefined), '')
})

test('credentialNameFor builds an env-style name from the provider id', () => {
  const { module } = runClient()
  assert.equal(module.lib.credentialNameFor('agnes'), 'IMAGE_GEN_AGNES_API_KEY')
  assert.equal(module.lib.credentialNameFor('agnes-2'), 'IMAGE_GEN_AGNES_2_API_KEY')
  assert.equal(module.lib.credentialNameFor(''), 'IMAGE_GEN_PROVIDER_API_KEY')
})

test('draftFromProvider opens in paste-key mode with an empty secret', () => {
  const { module } = runClient()
  const fresh = module.lib.draftFromProvider(null, [])
  assert.equal(fresh.apiKeyMode, 'key')
  assert.equal(fresh.apiKey, '')
  const stored = module.lib.draftFromProvider({ id: 'a', name: 'A', apiKeyEnv: 'IMAGE_GEN_A_API_KEY', apiKeyHint: 'sk-0****7890' }, [])
  assert.equal(stored.apiKeyMode, 'key')
  assert.equal(stored.apiKey, '')
  assert.equal(stored.apiKeyHint, 'sk-0****7890')
  const envOnly = module.lib.draftFromProvider({ id: 'b', name: 'B', apiKeyEnv: 'MY_IMAGE_API_KEY' }, [])
  assert.equal(envOnly.apiKeyMode, 'env')
})

test('the provider row keeps its masked hint across a re-save', () => {
  const { module, entryValue } = runClient()
  const out = module.lib.providerFromDraft(
    { isNew: false, id: 'agnes', name: 'agnes', apiKeyEnv: 'IMAGE_GEN_AGNES_API_KEY', apiKeyHint: 'sk-0****7890', modelsText: 'm1' },
    entryValue.providers,
  )
  assert.equal(out.error, undefined)
  assert.equal(out.provider.apiKeyHint, 'sk-0****7890')
})

test('saving stores the secret through credentials and keeps only a mask', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(source, /await writeCredential\(ctx, provider\.apiKeyEnv, secret\)/)
  assert.match(source, /provider\.apiKeyHint = maskSecret\(secret\)/)
  assert.match(source, /credentialNameFor\(provider\.id\)/)
  assert.match(source, /type: 'password'/)
})
test('a legacy duplicate stays editable as long as its name is unchanged', () => {
  const { module } = runClient()
  const providers = [
    { id: 'agnes', name: 'Agnes', baseUrl: 'https://x/v1', apiKeyEnv: 'K', models: [] },
    { id: 'agnes-2', name: 'Agnes', baseUrl: 'https://x/v1', apiKeyEnv: 'K', models: [] },
  ]
  const out = module.lib.providerFromDraft(
    { isNew: false, id: 'agnes-2', name: 'Agnes', baseUrl: 'https://x/v1', apiKeyEnv: 'K', apiKeyHint: 'sk-0****7890', modelsText: 'm1' },
    providers,
  )
  assert.equal(out.error, undefined)
  assert.equal(out.nextProviders.length, 2)
  const renamed = module.lib.providerFromDraft(
    { isNew: false, id: 'agnes-2', name: 'Agnes B', baseUrl: 'https://x/v1', modelsText: 'm1' },
    providers,
  )
  assert.equal(renamed.error, undefined)
  const clash = module.lib.providerFromDraft(
    { isNew: true, id: '', name: 'Agnes', baseUrl: 'https://x/v1', modelsText: 'm1' },
    providers,
  )
  assert.equal(clash.error, 'nameTaken')
})
test('a secret-looking value is not mistaken for a credential name', () => {
  const { module } = runClient()
  assert.equal(module.lib.looksLikeCredentialName('MY_IMAGE_API_KEY'), true)
  assert.equal(module.lib.looksLikeCredentialName('image_gen_agnes'), false)
  assert.equal(module.lib.looksLikeCredentialName('sk-0abcdef1234567890'), false)
  const legacy = module.lib.draftFromProvider({ id: 'a', name: 'A', apiKeyEnv: 'sk-0abcdef1234567890' }, [])
  assert.equal(legacy.apiKeyMode, 'key')
})
test('the image folder field saves on its own buttons, empty meaning default', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(source, /path: \['outputDir'\], value/)
  assert.match(source, /onFocus: \(\) => setEditing\(true\)/)
  assert.match(source, /const cancel = \(\) => \{ setText\(value\); setEditing\(false\); inputRef\.current\?\.blur\(\) \}/)
  assert.match(source, /ref: inputRef,/)
  assert.match(source, /if \(trimmed !== value\) onCommit\(trimmed\)/)
  assert.match(source, /style: css\.danger/)
  assert.match(source, /onMouseDown: hold/)
  assert.match(source, /'aria-label': t\('storage'\)/)
  // the reset affordance is gone, and the hint no longer promises it
  assert.ok(!source.includes('storageReset'))
  assert.ok(!source.includes('清空并保存即恢复默认'))
})
test('the studio has a red clear button that wipes refs, prompt and results', () => {
  assert.match(clientSource, /const clearPanel = \(\) => \{[\s\S]{0,200}refs: \[\], prompt: '', recent: \[\]/)
  assert.match(clientSource, /setPrompt\(''\)/)
  assert.match(clientSource, /const nothingToClear = store\.refs\.length === 0 && prompt\.trim\(\)\.length === 0 && store\.recent\.length === 0/)
  assert.match(clientSource, /'aria-label': t\('clear'\)/)
  assert.match(clientSource, /disabled: busy \|\| nothingToClear/)
  assert.match(clientSource, /onClick: clearPanel/)
  assert.match(clientSource, /style: \{ \.\.\.css\.danger, \.\.\.\(busy \|\| nothingToClear \? css\.idle : null\) \}/)
  assert.match(clientSource, /clear: '清空'/)
  assert.match(clientSource, /clear: 'Clear'/)
})

test('the image folder field can open the native directory picker', () => {
  assert.match(clientSource, /async function pickFolderPath\(ctx\) \{/)
  assert.match(clientSource, /globalThis\.__DSH_DIRECTORY_PICKER__/)
  assert.match(clientSource, /typeof bridge\.pick === 'function'/)
  assert.match(clientSource, /ctx\?\.uiWorkspace \?\? ctx\?\.get\?\.\('uiWorkspace'\)/)
  assert.match(clientSource, /typeof ui\.pickDirectory === 'function'/)
  assert.match(clientSource, /function OutputDirField\(\{ t, value, disabled, onCommit, onError, ctx \}\)/)
  assert.match(clientSource, /const picked = await pickFolderPath\(ctx\)/)
  assert.match(clientSource, /if \(next !== value\) onCommit\(next\)/)
  assert.match(clientSource, /onError\?\.\(t\('pickFailed'\)/)
  assert.match(clientSource, /'aria-label': t\('browse'\)/)
  assert.match(clientSource, /browse: '打开文件夹'/)
  assert.match(clientSource, /browse: 'Open folder…'/)
})

test('the sidebar studio can be switched off from the settings card', () => {
  // The card switch writes one boolean; the studio seats live behind a gate that
  // reads it, so turning it off unregisters the tab, its guide card and the
  // header button (turning it back on restores them on the next window refresh).
  assert.match(hostSourceForSwitch, /sidebarEnabled: maybeVolatile\(z\.boolean\(\)\.default\(true\)\)/)
  assert.match(clientSource, /function sidebarStudioEnabled\(lite\) \{/)
  assert.match(clientSource, /return value\?\.sidebarEnabled !== false/)
  assert.match(clientSource, /if \(!sidebarStudioEnabled\(lite\)\) return/)
  assert.match(clientSource, /const sync = \(\) => \{ release\(\); mount\(\) \}/)
  assert.match(clientSource, /const stop = typeof lite\.subscribe === 'function' \? lite\.subscribe\(sync\) : undefined/)
  assert.match(clientSource, /\{ op: 'set', path: \['sidebarEnabled'\], value: next \}/)
  assert.match(clientSource, /role: 'switch'/)
  assert.match(clientSource, /'aria-checked': checked/)
  assert.match(clientSource, /sidebarStudio: '在侧边栏中使用生图工作台'/)
  assert.match(clientSource, /sidebarStudio: 'Use the image studio from the sidebar'/)
  assert.match(clientSource, /重新开启后刷新窗口即可恢复标签与按钮/)
})
