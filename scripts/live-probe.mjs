/**
 * One-shot live probe for the rewritten 华数 AI Store / Token Plan gateways.
 *
 * Usage:
 *   node scripts/live-probe.mjs sms <phone>
 *   node scripts/live-probe.mjs login <phone> <code> [personal|enterprise]
 *   node scripts/live-probe.mjs dash
 *   node scripts/live-probe.mjs models          # public platform catalog
 *   node scripts/live-probe.mjs keys
 *   node scripts/live-probe.mjs drive
 *   node scripts/live-probe.mjs signcheck
 *
 * Auth state is read from (and written to) $DSH_HOME/tokenplan-bill-state.json,
 * the same file the plugin uses.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { buildTosEnvelope, unwrapResponse } from '../lib/index.js'

const HYYW = 'https://api-gateway.wasu.cn/hyyw/'
const TOS = 'https://api-gateway.wasu.cn/tos/api/v1/open/'
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STATE = join(DSH_HOME, 'tokenplan-bill-state.json')

const cmd = process.argv[2] || 'help'
const phone = process.argv[3] || ''
const code = process.argv[4] || ''
const userType = process.argv[5] === 'enterprise' ? 'enterprise' : 'personal'

const payChannel = () => (userType === 'enterprise' ? 'wasuAITokenEnterprise' : 'wasuAIToken')

async function hyywGet(path, params = {}, opts = {}) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(HYYW + path + (qs ? '?' + qs : ''), {
    headers: {
      'ri-user-agent': 'MOB-WEB',
      'ri-pay-channel': payChannel(),
      ...(opts.auth ? { 'ri-token': loadAuth()?.accessToken || '' } : {}),
    },
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { raw: text } }
}

async function hyywForm(path, fields) {
  const body = new URLSearchParams(fields)
  const res = await fetch(HYYW + path, {
    method: 'POST',
    headers: {
      'ri-user-agent': 'MOB-WEB',
      'ri-pay-channel': payChannel(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { raw: text } }
}

async function tosPost(path, params = {}, opts = {}) {
  const token = opts.accessToken !== undefined ? opts.accessToken : (loadAuth()?.accessToken || '')
  const envelope = buildTosEnvelope(params, {
    accessToken: opts.noAuth ? '' : token,
    accessKey: opts.accessKey,
    secret: opts.secret,
  })
  const res = await fetch(TOS + path, {
    method: 'POST',
    headers: {
      'ri-pay-channel': opts.channel || payChannel(),
      'content-type': 'application/json',
      accessToken: token,
      ...(opts.csrf ? { 'X-CSRF-TOKEN': opts.csrf } : {}),
    },
    body: JSON.stringify(envelope),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json, envelope, unwrapped: unwrapResponse(json) }
}

function saveAuth(data, phoneNum, type) {
  mkdirSync(DSH_HOME, { recursive: true })
  const prev = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
  const next = {
    ...prev,
    accessToken: data.access_token || data.accessToken || '',
    refreshToken: data.refresh_token || data.refreshToken || '',
    uid: data.uid || '',
    phone: phoneNum,
    userType: type,
    cloud: null,
    savedAt: Date.now(),
  }
  writeFileSync(STATE, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  return next
}

function loadAuth() {
  if (!existsSync(STATE)) return null
  try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch { return null }
}

function show(label, value, chars = 1200) {
  console.log('--- ' + label)
  console.log(JSON.stringify(value, null, 2).slice(0, chars))
}

if (cmd === 'signcheck') {
  const r = await tosPost('pcweb/dashboard/overview', {}, { accessToken: '' })
  show('system', r.json?.system)
  console.log('sign', r.envelope.system.sign, 'apiVersion', r.envelope.system.apiVersion)
} else if (cmd === 'sms') {
  show('sms', await hyywGet('rights-interests-sdk/login/sendLoginSMSCode', { phone }))
} else if (cmd === 'login') {
  if (!code) {
    console.error('need smscode')
    process.exit(1)
  }
  const j = await hyywForm('rights-interests-sdk/login/login', { phone, smscode: code, type: userType })
  show('login', j)
  const unwrapped = unwrapResponse(j)
  const data = unwrapped.ok ? unwrapped.data : (j?.data ?? j)
  if (data?.access_token || data?.accessToken) {
    const st = saveAuth(data, phone, userType)
    console.log('saved token hint', (st.accessToken || '').slice(0, 8) + '…')
  }
} else if (cmd === 'dash') {
  const st = loadAuth()
  if (!st?.accessToken) {
    console.error('no saved auth — run login first')
    process.exit(1)
  }
  const r = await tosPost('pcweb/dashboard/overview', {}, { accessToken: st.accessToken })
  show('overview', r.unwrapped.ok ? r.unwrapped.data : r.json)
} else if (cmd === 'models') {
  const r = await tosPost('pcweb/models/list', { page: 1, size: 200 }, { noAuth: true })
  const rows = r.unwrapped.ok && Array.isArray(r.unwrapped.data?.data) ? r.unwrapped.data.data : []
  console.log('catalog total', r.unwrapped.data?.total, 'rows', rows.length)
  for (const row of rows.slice(0, 15)) {
    console.log([row.modelName, row.modelType, row.vendor, row.billingType].join(' | '))
  }
  const gen = await tosPost('pcweb/creation/models', {}, { noAuth: true })
  const genRows = Array.isArray(gen.unwrapped.data) ? gen.unwrapped.data : []
  console.log('creation models', genRows.length, genRows.slice(0, 8).map((m) => m.modelName).join(', '))
} else if (cmd === 'keys') {
  const r = await tosPost('pcweb/keys/list', {})
  show('keys', r.unwrapped.ok ? r.unwrapped.data : r.json)
} else if (cmd === 'drive') {
  const st = loadAuth()
  if (!st?.accessToken) {
    console.error('no saved auth — run login first')
    process.exit(1)
  }
  const init = await tosPost('pcweb/auth/init', {}, { accessToken: st.accessToken })
  show('auth/init', init.unwrapped.ok ? init.unwrapped.data : init.json)
  const accessKey = init.unwrapped.ok ? init.unwrapped.data?.accessKey : ''
  if (!accessKey) {
    console.error('no accessKey — cannot query cloud drive')
    process.exit(1)
  }
  const home = await tosPost('pcweb/clouddisk/file/home', {}, {
    accessToken: '',
    accessKey,
    secret: st.accessToken,
    channel: 'pcweb-yunpan',
  })
  show('file/home', home.unwrapped.ok ? home.unwrapped.data : home.json)
} else if (cmd === 'creation-catalog') {
  const r = await tosPost('pcweb/creation/models', {}, { noAuth: true })
  const rows = Array.isArray(r.unwrapped.data) ? r.unwrapped.data : []
  console.log('creation models', rows.length)
  for (const m of rows) {
    const p = m.modelParams || {}
    console.log([
      m.modelName,
      m.modelType,
      m.imageQuotaPerUnit ? m.imageQuotaPerUnit + '/张' : '',
      m.videoQuotaPerSecond ? m.videoQuotaPerSecond + '/秒' : '',
      'ratio=' + (p.ratios || []).join(','),
      'res=' + (p.resolutions || []).join(','),
      'dur=' + (p.durations || []).join(','),
      'caps=' + (p.capabilities || []).join(','),
    ].filter(Boolean).join(' | '))
  }
} else if (cmd === 'gallery') {
  const st = loadAuth()
  if (!st?.accessToken) {
    console.error('no saved auth — run login first')
    process.exit(1)
  }
  const init = await tosPost('pcweb/auth/init', {}, { accessToken: st.accessToken })
  const accessKey = init.unwrapped.ok ? init.unwrapped.data?.accessKey : ''
  const csrf = init.unwrapped.ok ? (init.unwrapped.data?.csrfToken || init.unwrapped.data?.csrf || '') : ''
  const cloudOpts = { accessToken: '', accessKey, secret: st.accessToken, csrf, channel: 'pcweb-yunpan' }

  const ai = await tosPost('pcweb/clouddisk/file/ai-assets', { pageNum: 1, pageSize: 20 }, cloudOpts)
  const aiData = ai.unwrapped.ok ? ai.unwrapped.data : {}
  const aiList = aiData?.files?.list || []
  console.log('AI作品 (clouddisk/file/ai-assets): ok=%s counts=%s list=%d',
    ai.unwrapped.ok, JSON.stringify(aiData?.counts), aiList.length)
  for (const row of aiList.slice(0, 5)) {
    console.log('  ', row.fileId, 'type=' + row.fileType, row.name, row.fileAddress)
  }

  // Authenticated `pcweb/*` calls sign with the ACCOUNT TOKEN as the secret.
  const tasks = await tosPost('pcweb/creation/tasks', { page: 1, size: 20 }, {
    accessToken: st.accessToken, accessKey, csrf, secret: st.accessToken,
  })
  const rows = tasks.unwrapped.ok && Array.isArray(tasks.unwrapped.data?.data) ? tasks.unwrapped.data.data : []
  console.log('生成记录 (creation/tasks): ok=%s rows=%d', tasks.unwrapped.ok, rows.length)
  for (const row of rows.slice(0, 5)) {
    const local = (() => { try { return JSON.parse(row.localResultUrls || '[]') } catch { return [] } })()
    console.log('  ', row.taskId, row.templateType, row.status, row.progress, row.modelName,
      'local=' + (local[0] ? local[0].slice(0, 60) : '(none)'))
  }
} else {
  console.log('usage: sms|login|dash|models|keys|drive|creation-catalog|gallery|signcheck')
}