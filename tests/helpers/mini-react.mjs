/**
 * Minimal React renderer used to exercise the plugin's browser half in Node.
 *
 * It is not React: it implements just enough of the hook model
 * (useState/useEffect/useRef/useMemo with stable per-component keys) to run the
 * real client bundle, await its data effects against a stubbed `fetch`, and
 * re-render until the tree settles. That catches render-time crashes and lets
 * tests assert on the rendered text.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function createMiniReact() {
  const runtime = {
    states: new Map(),
    refs: new Map(),
    memo: new Map(),
    effectSlots: new Map(),
    pending: [],
    dirty: false,
    current: null,
  }

  const createElement = (type, props, ...children) => {
    const kids = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
    return { __el: true, type, props: { ...(props || {}), children: kids } }
  }

  const hookKey = (i) => runtime.current.path + '#' + i

  const useState = (init) => {
    const cur = runtime.current
    const key = hookKey(cur.i++)
    if (!runtime.states.has(key)) {
      runtime.states.set(key, typeof init === 'function' ? init() : init)
    }
    const set = (value) => {
      const prev = runtime.states.get(key)
      const next = typeof value === 'function' ? value(prev) : value
      if (!Object.is(next, prev)) {
        runtime.states.set(key, next)
        runtime.dirty = true
      }
    }
    return [runtime.states.get(key), set]
  }

  const useEffect = (fn, deps) => {
    const cur = runtime.current
    const key = hookKey(cur.i++)
    const prev = runtime.effectSlots.get(key)
    const changed = !prev || deps === undefined || prev.deps === undefined
      || deps.length !== prev.deps.length
      || deps.some((d, i) => !Object.is(d, prev.deps[i]))
    if (changed) runtime.pending.push({ key, fn, deps })
  }

  const useRef = (init) => {
    const cur = runtime.current
    const key = hookKey(cur.i++)
    if (!runtime.refs.has(key)) runtime.refs.set(key, { current: init })
    return runtime.refs.get(key)
  }

  const useMemo = (fn, deps) => {
    const cur = runtime.current
    const key = hookKey(cur.i++)
    const prev = runtime.memo.get(key)
    const changed = !prev || deps === undefined || prev.deps === undefined
      || deps.length !== prev.deps.length
      || deps.some((d, i) => !Object.is(d, prev.deps[i]))
    if (changed) runtime.memo.set(key, { deps, value: fn() })
    return runtime.memo.get(key).value
  }

  const React = {
    createElement,
    useState,
    useEffect,
    useRef,
    useMemo,
    Fragment: Symbol('Fragment'),
  }

  function renderTree(node, path) {
    if (node === null || node === undefined || node === false || node === true) return null
    if (typeof node === 'string' || typeof node === 'number') return { kind: 'text', value: String(node) }
    if (Array.isArray(node)) {
      return {
        kind: 'fragment',
        children: node.map((child, i) => renderTree(child, path + '/' + i)),
      }
    }
    if (!node.__el) return null
    const { type, props } = node
    if (typeof type === 'function') {
      const prev = runtime.current
      runtime.current = { path, i: 0 }
      let out
      try {
        out = type(props)
      } finally {
        runtime.current = prev
      }
      return {
        kind: 'component',
        name: type.name || 'Anonymous',
        props,
        children: [renderTree(out, path + '/' + (type.name || 'c'))].filter(Boolean),
      }
    }
    if (typeof type === 'symbol') {
      // Fragment
      return { kind: 'fragment', children: [renderTree(props.children, path + '/frag')].filter(Boolean) }
    }
    const kids = props.children
    return {
      kind: 'element',
      type: String(type),
      props,
      children: kids === undefined ? [] : [renderTree(kids, path + '>' + String(type))].filter(Boolean),
    }
  }

  function runEffect(eff) {
    const prev = runtime.effectSlots.get(eff.key)
    if (prev && typeof prev.cleanup === 'function') {
      try { prev.cleanup() } catch { /* cleanup errors are contained */ }
    }
    let cleanup
    try {
      cleanup = eff.fn()
    } catch (err) {
      runtime.effectSlots.set(eff.key, { deps: eff.deps, cleanup: undefined, error: err })
      throw err
    }
    runtime.effectSlots.set(eff.key, {
      deps: eff.deps,
      cleanup: typeof cleanup === 'function' ? cleanup : undefined,
    })
  }

  /**
   * Render `element`, run its effects (awaiting a macrotask so promise chains
   * settle), and re-render until the tree stops changing.
   */
  async function mount(element, options = {}) {
    const passes = options.passes || 12
    let tree = null
    for (let pass = 0; pass < passes; pass += 1) {
      runtime.dirty = false
      runtime.pending = []
      tree = renderTree(element, 'root')
      const pending = runtime.pending
      runtime.pending = []
      for (const eff of pending) runEffect(eff)
      await sleep(options.tickMs === undefined ? 1 : options.tickMs)
      if (!runtime.dirty && pending.length === 0) break
    }
    return tree
  }

  function unmount() {
    for (const slot of runtime.effectSlots.values()) {
      if (typeof slot.cleanup === 'function') {
        try { slot.cleanup() } catch { /* ignore */ }
      }
    }
    runtime.effectSlots.clear()
    runtime.states.clear()
    runtime.refs.clear()
    runtime.memo.clear()
  }

  return { React, runtime, mount, unmount, renderTree }
}

/** Concatenate every text node under a rendered tree. */
export function textOf(tree) {
  if (!tree) return ''
  if (tree.kind === 'text') return tree.value
  if (!tree.children || tree.children.length === 0) return ''
  return tree.children.map(textOf).join(' ')
}

/** Collect rendered host element types (for structural assertions). */
export function typesOf(tree, out = []) {
  if (!tree) return out
  if (tree.kind === 'element') out.push(tree.type)
  for (const child of tree.children || []) typesOf(child, out)
  return out
}

/** Find the first element node of a given host type. */
export function findElement(tree, type) {
  if (!tree) return null
  if (tree.kind === 'element' && tree.type === type) return tree
  for (const child of tree.children || []) {
    const hit = findElement(child, type)
    if (hit) return hit
  }
  return null
}

/** All element nodes of a given host type. */
export function findAll(tree, type, out = []) {
  if (!tree) return out
  if (tree.kind === 'element' && tree.type === type) out.push(tree)
  for (const child of tree.children || []) findAll(child, type, out)
  return out
}