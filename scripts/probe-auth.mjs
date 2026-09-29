/**
 * Signature matrix probe: the site signs authenticated pcweb calls with the
 * access token as the HMAC secret (site helper `Ur`), while anonymous calls and
 * `pcweb/auth/init` use the fixed default secret. This script proves which
 * combination the gateway accepts. Read-only: it never writes plugin state.
 *
 * Usage: node scripts/probe-auth.mjs [state-file]
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildTosEnvelope } from '../lib/index.js'

const STATE = process.argv[2] || join(homedir(), '.dsh', 'tokenplan-bill-state.json')
const state = JSON.parse(readFileSync(STATE, 'utf8'))
const token = String(state.accessToken || '')
const DEFAULT_SECRET = 'fd0fbc3194ef00f5e132d8604ae04bf5'
const TOS = 'https://api-gateway.wasu.cn/tos/api/v1/open/'

if (!token) {
  console.error('no accessToken in', STATE)
  process.exit(1)
}

async function call(path, params, opts = {}) {
  const envelope = buildTosEnvelope(params, {
    accessToken: opts.anon ? '' : token,
    accessKey: opts.accessKey,
    secret: opts.secret,
  })
  const headers = {
    'ri-pay-channel': opts.channel || 'wasuAIToken',
    'content-type': 'application/json',
    accept: 'application/json, text/plain, */*',
  }
  if (!opts.anon) headers.accessToken = token
  if (opts.csrf) headers['X-CSRF-TOKEN'] = opts.csrf
  let status = 0
  let text = ''
  try {
    const res = await fetch(TOS + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(20_000),
    })
    status = res.status
    text = await res.text()
  } catch (err) {
    text = 'FETCH ERROR: ' + String((err && err.message) || err)
  }
  let summary = text.slice(0, 160)
  try {
    const j = JSON.parse(text)
    const code = j?.system?.code ?? j?.code
    const msg = j?.system?.msg ?? j?.msg
    summary = `code=${JSON.stringify(code)} msg=${JSON.stringify(msg)}`
    if (code === 0 || code === '0' || code === 200 || code === '200') {
      const r = j.result
      summary += r && typeof r === 'object'
        ? ` keys=[${Object.keys(r).slice(0, 8).join(',')}]`
        : ` result=${JSON.stringify(r).slice(0, 80)}`
    }
  } catch { /* non-JSON */ }
  console.log(`  ${path.padEnd(34)} accessKey=${opts.accessKey ? 'yes' : 'no '} secret=${opts.secret === DEFAULT_SECRET ? 'default' : opts.secret === token ? 'token  ' : String(opts.secret).slice(0, 8)} -> ${summary}`)
  return text
}

console.log('token len=%d uid=%s', token.length, state.uid)
console.log('\n[1] overview signed with the DEFAULT secret (current plugin behaviour)')
await call('pcweb/dashboard/overview', {}, { secret: DEFAULT_SECRET })

console.log('\n[2] overview signed with the TOKEN as secret (site `Ur` behaviour)')
await call('pcweb/dashboard/overview', {}, { secret: token })

console.log('\n[3] pcweb/auth/init (token in system, DEFAULT secret — site `Mr`)')
const initRaw = await call('pcweb/auth/init', {}, { secret: DEFAULT_SECRET })
let accessKey = ''
try {
  const j = JSON.parse(initRaw)
  accessKey = String(j?.result?.accessKey || '')
  console.log('  -> accessKey len=%d csrf=%s', accessKey.length, j?.result?.csrfToken ?? j?.result?.csrf ?? '(none in body)')
} catch { /* ignore */ }

if (accessKey) {
  console.log('\n[4] overview with accessKey + token secret (site `Ur` after cloud init)')
  await call('pcweb/dashboard/overview', {}, { secret: token, accessKey })
  console.log('\n[5] cloud-drive style: accessKey, NO accessToken, token secret (site `Br`)')
  await call('pcweb/dashboard/overview', {}, { secret: token, accessKey, anon: true })
}