/**
 * Capture live API samples for every console page of the rewritten site.
 * Usage: node scripts/capture-all.mjs
 *
 * Requires a logged-in state file at $DSH_HOME/tokenplan-bill-state.json
 * (run `node scripts/live-probe.mjs login <phone> <code>` first).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { buildTosEnvelope, unwrapResponse } from '../lib/index.js'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const st = JSON.parse(readFileSync(join(DSH_HOME, 'tokenplan-bill-state.json'), 'utf8'))
const HYYW = 'https://api-gateway.wasu.cn/hyyw/'
const TOS = 'https://api-gateway.wasu.cn/tos/api/v1/open/'
const channel = st.userType === 'enterprise' ? 'wasuAITokenEnterprise' : 'wasuAIToken'

async function tosPost(path, params = {}, opts = {}) {
  const envelope = buildTosEnvelope(params, {
    accessToken: opts.noAuth ? '' : st.accessToken,
    accessKey: opts.accessKey,
    secret: opts.secret,
  })
  const res = await fetch(TOS + path, {
    method: 'POST',
    headers: {
      'ri-pay-channel': opts.channel || channel,
      'content-type': 'application/json',
      accessToken: opts.noAuth ? '' : st.accessToken,
      ...(opts.csrf ? { 'X-CSRF-TOKEN': opts.csrf } : {}),
    },
    body: JSON.stringify(envelope),
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 400) } }
}

async function hyywGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(HYYW + path + (qs ? '?' + qs : ''), {
    headers: { 'ri-user-agent': 'MOB-WEB', 'ri-pay-channel': channel, 'ri-token': st.accessToken },
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { raw: text.slice(0, 400) } }
}

const end = new Date()
const start = new Date()
start.setDate(end.getDate() - 7)
const iso = (d) => d.toISOString().slice(0, 10)
const startTime = iso(start) + ' 00:00:00'
const endTime = iso(end) + ' 23:59:59'
const monthStart = new Date(end.getFullYear(), end.getMonth(), 1).toISOString().slice(0, 10)

const init = await tosPost('pcweb/auth/init', {})
const initData = unwrapResponse(init).ok ? unwrapResponse(init).data : {}
const cloud = initData?.accessKey
  ? { accessKey: initData.accessKey, csrf: initData.csrfToken || initData.csrf || initData.token, secret: st.accessToken }
  : null

const sample = {
  catalog: await tosPost('pcweb/models/list', { page: 1, size: 200 }, { noAuth: true }),
  creationModels: await tosPost('pcweb/creation/models', {}, { noAuth: true }),
  overview: await tosPost('pcweb/dashboard/overview', {}),
  daily: await tosPost('pcweb/dashboard/daily-usage', { startDate: iso(start), endDate: iso(end) }),
  distribution: await tosPost('pcweb/dashboard/model-distribution', { startDate: iso(start), endDate: iso(end) }),
  topModels: await tosPost('pcweb/dashboard/top-models', { startDate: monthStart, endDate: iso(end), topN: 5 }),
  userDetail: await tosPost('pcweb/user/detail', {}),
  keys: await tosPost('pcweb/keys/list', {}),
  credit: await tosPost('pcweb/credit/detail', {}),
  ordersPc: await tosPost('pcweb/orders/list', { page: 1, size: 10 }),
  ordersMember: await hyywGet('changShi-member-sdk/wasuAI/token/queryOrderList', { pageNum: 1, pageSize: 10 }),
  packages: await hyywGet('changShi-member-sdk/wasuAI/token/queryPackageList', { renewalType: '2' }),
  packagesBoost: await hyywGet('changShi-member-sdk/wasuAI/token/queryPackageList', { renewalType: '-1' }),
  logs: await tosPost('pcweb/logs/list', { page: 1, size: 10, startTime, endTime }),
  messages: await tosPost('pcweb/sys-messages/list', { page: 1, size: 10 }),
  unread: await tosPost('pcweb/sys-messages/unread-count', {}),
  tasks: await tosPost('pcweb/creation/tasks', { page: 1, size: 12, status: 'succeeded' }),
  templates: await tosPost('pcweb/templates/page', { page: 1, size: 3 }, { noAuth: true }),
  driveHome: cloud
    ? await tosPost('pcweb/clouddisk/file/home', {}, { accessToken: '', accessKey: cloud.accessKey, secret: cloud.secret, csrf: cloud.csrf, channel: 'pcweb-yunpan' })
    : null,
}

mkdirSync(DSH_HOME, { recursive: true })
const out = join(DSH_HOME, 'tokenplan-bill-all-sample.json')
writeFileSync(out, JSON.stringify(sample, null, 2))
for (const [k, v] of Object.entries(sample)) {
  if (v === null) {
    console.log(k, '(skipped: no cloud authorization)')
    continue
  }
  const unwrapped = unwrapResponse(v)
  const shape = unwrapped.ok ? unwrapped.data : v
  const preview = Array.isArray(shape)
    ? `array(${shape.length}) ` + JSON.stringify(shape[0] || null).slice(0, 160)
    : shape && typeof shape === 'object'
      ? `keys=${Object.keys(shape).slice(0, 12).join(',')} ` + JSON.stringify(shape).slice(0, 200)
      : String(shape).slice(0, 120)
  console.log(k, 'ok=' + unwrapped.ok, preview)
}
console.log('wrote', out)