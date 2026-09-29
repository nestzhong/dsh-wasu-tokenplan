/**
 * Loads the real browser half (lib/client.js) into a Node vm with a stubbed
 * DOM, module loader and fetch, so tests can mount its slots and views.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import { createMiniReact } from './mini-react.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT_PATH = join(here, '..', '..', 'lib', 'client.js')

/** URL → payload routing table used by the fake fetch. */
export function createFetchStub(routes) {
  const calls = []
  const fetchStub = async (url, init) => {
    const path = String(url)
    calls.push({ url: path, method: (init && init.method) || 'GET', body: init && init.body })
    for (const [pattern, handler] of routes) {
      const matched = typeof pattern === 'string' ? path.startsWith(pattern) : pattern.test(path)
      if (!matched) continue
      const value = typeof handler === 'function' ? await handler(path, init) : handler
      if (value === undefined) continue
      return {
        ok: true,
        status: 200,
        json: async () => value,
      }
    }
    throw new Error('unexpected fetch: ' + path)
  }
  return { fetchStub, calls }
}

/**
 * @param {{ routes?: Array, routes2?: never }} [options]
 */
export function loadClient(options = {}) {
  const source = readFileSync(CLIENT_PATH, 'utf8')
  const mini = createMiniReact()
  const appended = []
  const removed = []
  const head = {
    appendChild(el) { el.parentNode = head; appended.push(el); return el },
    removeChild(el) { removed.push(el); el.parentNode = null; return el },
  }
  const documentStub = {
    head,
    createElement: () => ({
      attrs: {},
      textContent: '',
      parentNode: null,
      setAttribute(name, value) { this.attrs[name] = value },
    }),
    body: {
      appendChild() {},
      removeChild() {},
    },
  }
  const { fetchStub, calls } = createFetchStub(options.routes || [])

  let loaded = null
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    Promise,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    Boolean,
    Error,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    AbortController,
    Symbol,
    fetch: fetchStub,
    document: documentStub,
    navigator: { clipboard: { writeText: async () => {} } },
    window: {
      __ModuleLoader__: {
        load: (entry) => {
          const result = entry.factory((name) => {
            if (name === 'react') return mini.React
            throw new Error('unexpected require: ' + name)
          })
          loaded = result && typeof result === 'object' ? result : { exports: {} }
        },
      },
      open() {},
      confirm: () => true,
      addEventListener() {},
      removeEventListener() {},
      innerWidth: 1440,
      innerHeight: 900,
    },
  }
  sandbox.window.document = documentStub
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: CLIENT_PATH })

  if (loaded === null) throw new Error('client bundle did not call window.__ModuleLoader__.load')
  return { exports: loaded, mini, calls, appended, removed, documentStub }
}

/** A slots service double that records registrations and returns disposers. */
export function createSlotsStub() {
  const registered = []
  const disposers = []
  const slots = {
    inject(key, callback) {
      const dispose = callback()
      disposers.push(dispose)
      return () => { if (typeof dispose === 'function') dispose() }
    },
    register(descriptor, Component) {
      registered.push({ descriptor, Component })
      return () => {}
    },
  }
  return { slots, registered, disposers }
}

/** A Cordis-ish host context double. */
export function createContextStub(slots) {
  const effects = []
  return {
    effects,
    get: (key) => (key === 'slots' ? slots : undefined),
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose })
      return dispose
    },
    emit() {},
    logger: { warn() {}, error() {} },
  }
}