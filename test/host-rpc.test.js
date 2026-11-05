/**
 * Host-half RPC wiring.
 *
 * The panel channel is mounted through Connection's generic registry using
 * `connection.register(owner, channel, handler)`, with this plugin's inject
 * scope passed as the owner. Connection's `rpc.handle` sugar cannot be used:
 * it takes the owner from Connection's own context, where `owner.webServer`
 * throws "cannot get property webServer without inject" and the route never
 * mounts (reproduced against cordis 4.1.0 — this is what produced HTTP 405 in
 * the panel). The handler must also forward the bridge's abort signal.
 *
 * index.js imports peer packages this repo does not vendor, so the test pulls
 * the `registerRpc` definition out of the source and evaluates it with only
 * the helpers that path touches stubbed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const hostSource = readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8')

const CHANNEL = '/image-gen-lite'
const ASPECTS = { '1:1': '1024x1024' }

class BadRequest extends Error {}

const ok = (value) => ({ ok: true, value })

const failure = (error) => ({
  ok: false,
  error: {
    code: error instanceof BadRequest ? 'bad-request' : 'internal',
    message: error instanceof Error ? error.message : String(error),
    details: {},
  },
})

function loadRegisterRpc(overrides = {}) {
  const match = hostSource.match(/function registerRpc\([\s\S]*?\n\}\n/)
  assert.ok(match, 'index.js still defines registerRpc')
  const factory = new Function(
    'RPC_CHANNEL', 'BadRequest', 'activeComplete', 'normalizeRefs', 'ASPECTS',
    'runGeneration', 'ok', 'failure',
    `${match[0]}; return registerRpc`,
  )
  return factory(
    CHANNEL,
    BadRequest,
    overrides.activeComplete ?? (() => true),
    overrides.normalizeRefs ?? ((refs) => ({ refs })),
    ASPECTS,
    overrides.runGeneration ?? (async () => ({})),
    ok,
    failure,
  )
}

/**
 * A Context/scope pair that records what the channel registry was told. The
 * `rpc` getter throws on purpose: reaching for it is the bug this test exists
 * to prevent, so a regression fails loudly instead of returning 405 in the
 * panel.
 */
function makeHost(connection) {
  const mounted = []
  const warns = []
  const injected = []
  const registry = connection ?? {
    register(owner, channel, handler) {
      mounted.push({ owner, channel, handler })
      return () => {}
    },
    get rpc() {
      throw new Error('connection.rpc.handle must not be used: it binds the channel to Connection\'s own context')
    },
  }
  const scoped = {
    get: (name) => (name === 'connection' ? registry : undefined),
    logger: { warn: (message) => warns.push(message) },
  }
  const ctx = {
    inject(dependencies, factory) {
      injected.push(dependencies)
      factory(scoped)
    },
    get: () => undefined,
  }
  return { ctx, scoped, mounted, warns, injected }
}

function mount(overrides = {}, connection) {
  const host = makeHost(connection)
  const registerRpc = loadRegisterRpc(overrides)
  registerRpc(host.ctx, () => ({ providerId: 'p', modelId: 'm' }), () => '1:1', () => '')
  return host
}

test('the channel is mounted through connection.register with our own scope as owner', () => {
  const { mounted, scoped } = mount()
  assert.equal(mounted.length, 1)
  assert.equal(mounted[0].channel, CHANNEL)
  assert.equal(mounted[0].owner, scoped, 'the owner must be the inject scope that can read webServer')
  assert.equal(typeof mounted[0].handler, 'function')
})

test('the source keeps no hand-rolled transport and no rpc.handle sugar', () => {
  assert.doesNotMatch(hostSource, /serveRpc/)
  assert.doesNotMatch(hostSource, /webServer\.register/)
  assert.doesNotMatch(hostSource, /requestRejection/)
  assert.doesNotMatch(hostSource, /connection\.rpc\.handle\(/)
  assert.match(hostSource, /connection\.register\(scoped, RPC_CHANNEL, handleRpc\)/)
  // The registry mounts through the owner's webServer, so it must stay
  // resolvable in this scope.
  assert.match(hostSource, /ctx\.inject\(\['connection', 'webServer'\]/)
})

test('the bridge abort signal reaches the generation workload', async () => {
  let seen
  const { mounted } = mount({
    runGeneration: async (ctx, active, aspect, options) => {
      seen = { ctx, active, aspect, options }
      return { paths: ['a.png'], images: [], provider: 'p', model: 'm', aspect: '1:1' }
    },
  })
  const controller = new AbortController()
  const result = await mounted[0].handler('generate', { prompt: 'a cat' }, controller.signal)
  assert.equal(seen.options.signal, controller.signal)
  assert.equal(seen.options.prompt, 'a cat')
  assert.equal(seen.aspect, '1:1')
  assert.deepEqual(result, {
    ok: true,
    value: { paths: ['a.png'], images: [], provider: 'p', model: 'm', aspect: '1:1' },
  })
})

test('payload and model rejections come back as bad-request results', async () => {
  const { mounted } = mount()
  const blank = await mounted[0].handler('generate', { prompt: '   ' })
  assert.equal(blank.ok, false)
  assert.equal(blank.error.code, 'bad-request')

  const noModel = await mount({ activeComplete: () => false }).mounted[0]
    .handler('generate', { prompt: 'a cat' })
  assert.equal(noModel.ok, false)
  assert.match(noModel.error.message, /no active image model/)

  const unknown = await mounted[0].handler('nope', {})
  assert.equal(unknown.ok, false)
  assert.match(unknown.error.message, /unknown \/image-gen-lite endpoint/)
})

test('a host without the channel registry warns instead of throwing', () => {
  const { mounted, warns, injected } = mount({}, {})
  assert.equal(mounted.length, 0)
  assert.equal(injected.length, 1)
  assert.equal(warns.length, 1)
  assert.match(warns[0], /no connection\.register/)
})
