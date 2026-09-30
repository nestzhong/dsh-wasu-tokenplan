/**
 * dsh-tokenplan-bill host half: Cordis plugin in the DSH host process.
 *
 * Proxies 华数 AI Store / Token Plan (https://tokenplan.wasu.cn/) gateways and
 * answers the browser half over webServer under /dsh-tokenplan-bill/*:
 *
 *   GET  /manifest               session + unread messages + cloud-drive usage (masked)
 *   POST /auth/sms               send login SMS { phone }
 *   POST /auth/login             login { phone, smscode, type? } (+ 华数模型 upsert)
 *   POST /auth/logout            clear tokens
 *   GET  /dashboard?range=7|30   overview + charts
 *   GET  /models                 platform model catalog (pcweb/models/list)
 *   GET  /models/gateway         live GET https://token.wasu.cn/v1/models
 *   POST /model/sync             add selected model(s) into DSH「华数模型」
 *   POST /model/refresh-catalog  nudge chat model catalogs to re-read
 *   GET  /packages?renewalType=2|1|-1
 *   GET  /keys                   API key list (masked rows)
 *   POST /keys/create|delete|status|reset
 *   GET  /credits                credit packages + credit orders
 *   GET  /orders                 order center
 *   GET  /logs                   usage records
 *   GET  /messages               message center list
 *   GET  /messages/unread        unread count
 *   POST /messages/read          mark messages read { ids }
 *   GET  /drive                  cloud-drive usage (pcweb/clouddisk/file/home)
 *   GET  /creation/models        generation model catalog (pcweb/creation/models)
 *   GET  /creation/tasks         generation task list (pcweb/creation/tasks)
 *   GET  /creation/task          one generation task by taskId
 *   POST /creation/submit        submit an image/video generation task
 *   POST /creation/upload        upload a reference image/video (multipart)
 *   POST /creation/optimize-prompt  rewrite a prompt (pcweb/creation/optimize-prompt)
 *   POST /creation/task-delete   delete a generation task
 *   GET  /gallery                我的云盘-AI作品 + 生成记录 merged gallery
 *   GET  /debug/llm-catalog      live host LLM view
 *   GET  /prefs  POST /prefs     panel geometry
 *
 * Agent tools (ctx.tools): `generate_image` and `generate_video`. Both read
 * reference material straight out of the conversation — images arrive as
 * `{ type: 'image' }` content blocks and videos/audio as `{ type: 'file' }`
 * blocks — upload it through `pcweb/creation/upload`, then submit and poll
 * `pcweb/creation/tasks` until the task settles.
 *
 * Wire protocol (site rewrite, Sep 2026): TOS envelope carries apiVersion 4 /
 * signVersion 4, `accessToken` only when non-empty, and an optional
 * `accessKey` (cloud-drive authorization). Success code is 0/200; the payload
 * is `result`. Tokens live only in ~/.dsh/tokenplan-bill-state.json (0600).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import * as os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PKG_VERSION = (() => {
  try { return String(require('../package.json').version || '') } catch { return '' }
})()

const HYYW_BASE = 'https://api-gateway.wasu.cn/hyyw/'
const TOS_BASE = 'https://api-gateway.wasu.cn/tos/api/v1/open/'
const CLIENT_ID = 'wasu.client.web.df82951b6d545955'
const SIGN_SECRET = 'fd0fbc3194ef00f5e132d8604ae04bf5'
/** Site rewrite bumped both protocol revisions (was signVersion 4 / apiVersion 1). */
const SIGN_VERSION = 4
const API_VERSION = 4
const PAY_CHANNEL_PERSONAL = 'wasuAIToken'
const PAY_CHANNEL_ENTERPRISE = 'wasuAITokenEnterprise'
const PAY_CHANNEL_CLOUD = 'pcweb-yunpan'
const UPSTREAM_TIMEOUT_MS = 20_000
/** TOS answers HTTP 200 with a business code; 0/200 are both accepted by the SPA. */
const SUCCESS_CODES = new Set([200, 0, '0', '200'])
/** Session-expired business codes the SPA refreshes on (Tt = [401,1002,14,1103]). */
const AUTH_ERROR_CODES = new Set([401, 1002, 14, 1103, '401', '1002', '14', '1103'])
const DASH_TTL_MS = 60_000
const CLOUD_AUTH_TTL_MS = 30 * 60_000
const MAX_UPSTREAM_BYTES = 1_000_000
/** Reference-material upload cap for `pcweb/creation/upload` (byte length of decoded payload). */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024
/** Gallery feed page size requested from each upstream before local paging. */
const GALLERY_FETCH_SIZE = 60
/** Generation polling: image tasks settle in seconds, video tasks in minutes. */
const CREATION_POLL_INTERVAL_MS = 5_000
const CREATION_POLL_TIMEOUT_MS = 10 * 60_000
/** Reference material can be a large video: uploads and result fetches need room. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000
const MEDIA_FETCH_TIMEOUT_MS = 2 * 60_000
/**
 * Produced media is inlined into the tool result as DSH attachments: the model
 * sees it and the conversation renders it. Bounded per item and in total so one
 * 4-image batch cannot blow up the session log.
 */
const MAX_RESULT_ATTACHMENT_BYTES = 24 * 1024 * 1024
const MAX_RESULT_ATTACHMENTS = 4

/** OpenAI-compatible chat endpoint shown in Token Plan → API 密钥. */
export const HUASHU_BASE_URL = 'https://token.wasu.cn/v1'
/** Provider route id under llm-pi-ai.providers (hyphenated). */
export const HUASHU_PROVIDER_ID = 'wasu-tokenplan'
/** Model picker label in dsh chat. */
export const HUASHU_DISPLAY_NAME = '华数模型'
/** Credential ref written into ~/.dsh/.credentials.yaml. */
export const HUASHU_API_KEY_ENV = 'WASU_TOKENPLAN_API_KEY'
/** Catalog flagship at the time of the rewrite (deepseek-v4-flash was retired). */
export const HUASHU_MODEL_ID = 'deepseek-v4.1-flash'
/** List/trigger label under the 华数模型 provider group. */
export const HUASHU_MODEL_NAME = 'DeepSeek-V4.1-Flash'
const HUASHU_AUTO_KEY_NAME = 'dsh-chat'

/** Site root; hash routing, so deep links append `#/console/...`. */
export const CONSOLE_BASE_URL = 'https://tokenplan.wasu.cn/web/index.html'
/** Package purchase detail page reached by the 立即订购 QR code. */
export const PKG_DETAIL_URL = 'https://static-gateway.wasu.cn/upload/public/tokenMall/index.html#/pages/packageDetail'
/** Mini-program QR renderer used by the official pricing page. */
export const QR_API_URL = 'https://ups.wasu.cn/msm-local-biz/local/fission/getminiqrQr?url='

export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function asStr(v) {
  return typeof v === 'string' ? v.trim() : ''
}

export function maskSecret(s) {
  const t = asStr(s)
  if (t === '') return ''
  if (t.length <= 8) return t.slice(0, 2) + '…'
  return t.slice(0, 4) + '…(' + t.length + ')'
}

/** Mask an API key for panel display (site shows first 8 + last 4). */
export function maskApiKey(key) {
  const k = asStr(key)
  if (!k) return '****'
  if (k.length < 10) return '****'
  return k.slice(0, 8) + '...' + k.slice(-4)
}

/** Mirror SPA `Sr`: recursively sort object keys (arrays keep index keys). */
export function sortKeysDeep(e) {
  if (e === null || typeof e !== 'object') return e
  const keys = Object.keys(e).sort()
  const out = Array.isArray(e) ? [] : {}
  for (const k of keys) {
    const v = e[k]
    if (v instanceof Object && Object.keys(v).length) out[k] = sortKeysDeep(v)
    else if (!(v instanceof Object)) out[k] = v
  }
  return out
}

/** Mirror SPA `kr`: flatten for MD5 sign; clones input so callers stay immutable. */
export function flattenForSign(input) {
  if (input == null || typeof input !== 'object' || !Object.keys(input).length) return ''
  const e = JSON.parse(JSON.stringify(input))
  if (Object.prototype.hasOwnProperty.call(e, 'sign')) delete e.sign
  const parts = []
  for (const r of Object.keys(e)) {
    let val = e[r]
    if (val instanceof Object && Object.keys(val).length) {
      val = JSON.stringify(sortKeysDeep(val))
      e[r] = val
    }
    if (val != null && val !== '') {
      if (val instanceof Object) {
        if (Object.keys(val).length) parts.push(r + '=' + val)
      } else {
        parts.push(r + '=' + val)
      }
    }
  }
  return parts.sort().join('||')
}

export function md5Hex(text) {
  return createHash('md5').update(String(text), 'utf8').digest('hex')
}

/**
 * Build the TOS signed envelope `{ system, params }` (site helper `Tr`).
 *
 * `accessToken` / `accessKey` are only emitted when non-empty, the sign covers
 * the system block plus flattened params, and `secret` may be overridden —
 * cloud-drive calls sign with the account access token as business secret.
 *
 * @param {object} [params]
 * @param {string | { accessToken?: string, accessKey?: string, secret?: string }} [auth]
 *   A bare string keeps the pre-rewrite `(params, accessToken)` call shape.
 */
export function buildTosEnvelope(params, auth) {
  const bodyParams = isObj(params) ? { ...params } : {}
  const opts = typeof auth === 'string' ? { accessToken: auth } : (isObj(auth) ? auth : {})
  const accessToken = asStr(opts.accessToken)
  const accessKey = asStr(opts.accessKey)
  const secret = asStr(opts.secret) || SIGN_SECRET
  const system = {
    requestId: randomUUID(),
    clientId: CLIENT_ID,
    signVersion: SIGN_VERSION,
    apiVersion: API_VERSION,
    ts: Date.now(),
  }
  if (accessToken) system.accessToken = accessToken
  if (accessKey) system.accessKey = accessKey
  const forSign = { system: { ...system }, params: { ...bodyParams } }
  const s = flattenForSign(forSign.system)
  const a = flattenForSign(forSign.params)
  const raw = a ? s + '||' + a + '||' + secret : s + '||' + secret
  system.sign = md5Hex(raw)
  return { system, params: bodyParams }
}

/** Whether an upstream business code means "session expired, refresh me". */
export function isAuthErrorCode(code) {
  return AUTH_ERROR_CODES.has(code) || AUTH_ERROR_CODES.has(String(code))
}

/** Whether an upstream business code means success. */
export function isSuccessCode(code) {
  if (SUCCESS_CODES.has(code)) return true
  const s = String(code)
  if (SUCCESS_CODES.has(s)) return true
  // Zero-padded spellings ('0', '00', '0000') all mean success on this gateway.
  return /^0+$/.test(s)
}

/**
 * Normalize a TOS/hyyw response body.
 * New gateway shape is `{ system: { code, msg }, result }`; hyyw keeps
 * `{ ret, retinfo, data }` and some legacy endpoints nest retCode in `data`.
 */
export function unwrapResponse(json) {
  if (Array.isArray(json)) return { ok: true, data: json, raw: json }
  if (!isObj(json)) return { ok: false, error: '非 JSON 响应', raw: json }

  let body = json
  if (body.ret !== undefined && body.code === undefined) {
    body = { ...body, code: body.ret, msg: body.retinfo ?? body.msg }
  }
  const system = isObj(body.system) ? body.system : null
  const code = system ? (system.code ?? system.ret) : body.code
  const msg = system
    ? (system.msg ?? system.message)
    : (body.msg ?? body.message ?? body.retinfo)

  // Legacy hyyw endpoints nest their own business code in `data.retCode`;
  // '1000' plus any envelope success code means the payload is valid.
  if (isObj(body.data) && body.data.retCode !== undefined) {
    const rc = String(body.data.retCode)
    if (rc === '1000' || isSuccessCode(rc) || isSuccessCode(code)) {
      return { ok: true, data: body.data, raw: body, code }
    }
    return { ok: false, error: String(body.data.retMsg || msg || '上游失败'), raw: body, code: rc }
  }

  if (code !== undefined && code !== null && isSuccessCode(code)) {
    return { ok: true, data: body.result ?? body.data ?? body, raw: body, code }
  }

  if (code === undefined || code === null) {
    // Legacy gateways answered with a bare payload and no envelope code.
    if (body.result !== undefined || body.data !== undefined) {
      return { ok: true, data: body.result ?? body.data, raw: body }
    }
  }
  return { ok: false, error: String(msg || ('上游 code ' + code)), raw: body, code }
}

/** Whether a Token Plan key row looks enabled (empty status counts as enabled). */
export function isKeyEnabled(row) {
  if (!isObj(row)) return false
  const raw = row.status ?? row.keyStatus ?? row.state ?? row.enableStatus
  if (typeof raw === 'number') return raw === 1
  const s = asStr(raw).toUpperCase()
  if (s === '') return true
  return s === 'ENABLED' || s === 'ENABLE' || s === '1' || s === 'TRUE' || s === '启用' || s === 'ACTIVE'
}

/** Panel label for a key row status (site uses 1 = 启用, 2 = 已停用). */
export function keyStatusLabel(row) {
  if (!isObj(row)) return '未知'
  const raw = row.status
  if (typeof raw === 'number') return raw === 1 ? '启用' : '已停用'
  return isKeyEnabled(row) ? '启用' : '已停用'
}

/**
 * Pick one usable platform API key from pcweb/keys/list rows.
 * Prefers enabled keys, then name "default" / "dsh-chat", then first with apiKey.
 * @param {unknown} list
 * @returns {string}
 */
export function pickPlatformApiKey(list) {
  const rows = (Array.isArray(list) ? list : []).filter(isObj)
  const withKey = rows.filter((r) => asStr(r.apiKey).length > 0)
  const enabled = withKey.filter(isKeyEnabled)
  const pool = enabled.length > 0 ? enabled : withKey
  const nameOf = (r) => asStr(r.keyName || r.name).toLowerCase()
  const preferred = pool.find((r) => nameOf(r) === 'default')
    || pool.find((r) => nameOf(r) === HUASHU_AUTO_KEY_NAME)
    || pool.find((r) => nameOf(r).includes('dsh'))
    || pool[0]
  return preferred ? asStr(preferred.apiKey) : ''
}

const BRAND_WORDS = {
  deepseek: 'DeepSeek',
  glm: 'GLM',
  kimi: 'Kimi',
  qwen: 'Qwen',
  doubao: 'Doubao',
  minimax: 'MiniMax',
  wan: 'Wan',
  happyhorse: 'HappyHorse',
  fun: 'Fun',
}
const UPPER_WORDS = new Set(['ai', 'asr', 'tts', 'r2v', 't2v', 'i2v', 'ocr'])

/** Human label for a model id (deepseek-v4.1-flash → DeepSeek-V4.1-Flash). */
export function prettyModelName(id) {
  const s = asStr(id)
  if (!s) return s
  return s.split(/[-_]/).filter(Boolean).map((part, i) => {
    const lower = part.toLowerCase()
    if (UPPER_WORDS.has(lower)) return lower.toUpperCase()
    if (i === 0 && BRAND_WORDS[lower]) return BRAND_WORDS[lower]
    if (/^v\d/.test(lower)) return 'V' + part.slice(1)
    if (/^\d/.test(part)) return part
    return part.charAt(0).toUpperCase() + part.slice(1)
  }).join('-')
}

/**
 * Bucket an OpenAI-style /v1/models row for the DSH config UI.
 * @returns {'chat'|'image'|'video'|'audio'|'other'}
 */
export function classifyModelKind(row) {
  if (!isObj(row)) return 'other'
  const id = asStr(row.id).toLowerCase()
  const types = Array.isArray(row.supported_endpoint_types)
    ? row.supported_endpoint_types.map((t) => String(t).toLowerCase())
    : []
  const hasType = (re) => types.some((t) => re.test(t))
  if (/embed|rerank/.test(id)) return 'other'
  if (hasType(/audio|tts|asr|voice|speech/) || /tts|asr|cosyvoice|voice|whisper|speech|fun-asr/.test(id)) return 'audio'
  if (hasType(/image/) || /seedream|(^|-)image($|-)|image-|wan[\d.]*-image/.test(id)) return 'image'
  if (hasType(/video/) || /seedance|video|wan[\d.]*-[tri]2v|happyhorse/.test(id)) return 'video'
  if (hasType(/openai/) || types.length === 0) return 'chat'
  return 'other'
}

/**
 * Bucket a platform-catalog row (pcweb/models/list) by its declared modelType.
 * @returns {'chat'|'image'|'video'|'audio'|'other'}
 */
export function catalogModelKind(modelType, capabilityTags) {
  const t = asStr(modelType).toLowerCase()
  if (t === 'text' || t === 'llm' || t === 'multimodal') return 'chat'
  if (t === 'image') return 'image'
  if (t === 'video') return 'video'
  if (t === 'audio' || t === 'voice' || t === 'speech') return 'audio'
  const caps = asStr(capabilityTags)
  if (/图片生成/.test(caps)) return 'image'
  if (/视频生成/.test(caps)) return 'video'
  if (/语音|音频/.test(caps)) return 'audio'
  if (/文本生成|大语言|AI编程/.test(caps)) return 'chat'
  return 'other'
}

const PRICE_UNITS = {
  inputQuotaPerTokens: '输入',
  outputQuotaPerTokens: '输出',
  imageQuotaPerUnit: '图片',
  videoQuotaPerSecond: '视频',
  audioQuotaPerSecond: '音频',
}

/**
 * Price rows for a catalog model, mirroring the site's 模型广场 labels.
 * @returns {{ label: string, value: string }[]}
 */
export function catalogPriceRows(row) {
  if (!isObj(row)) return []
  const out = []
  for (const [key, label] of Object.entries(PRICE_UNITS)) {
    const n = Number(row[key])
    if (!Number.isFinite(n) || n === 0) continue
    const unit = key === 'inputQuotaPerTokens' || key === 'outputQuotaPerTokens'
      ? '积分/百万tokens'
      : key === 'imageQuotaPerUnit' ? '积分/张'
        : key === 'videoQuotaPerSecond' ? '积分/秒' : '积分/秒'
    out.push({ label, value: n.toLocaleString('zh-CN') + unit })
  }
  return out
}

const BADGE_LABELS = { hot: '热门', recommend: '推荐', new: '新上' }

/** Normalize a platform-catalog payload into UI rows. */
export function normalizeCatalogModels(payload) {
  const raw = isObj(payload) && Array.isArray(payload.data)
    ? payload.data
    : (Array.isArray(payload) ? payload : [])
  return raw.filter(isObj).map((row) => {
    const id = asStr(row.modelName || row.displayName || row.id)
    const modelType = asStr(row.modelType).toLowerCase()
    const kind = catalogModelKind(modelType, row.capabilityTags)
    return {
      id,
      name: prettyModelName(id),
      kind,
      modelType,
      vendor: asStr(row.vendor),
      capabilities: asStr(row.capabilityTags).split(',').map((s) => s.trim()).filter(Boolean),
      description: asStr(row.description),
      icon: asStr(row.modelIcon),
      badges: Array.isArray(row.operationBadges)
        ? row.operationBadges.map((b) => BADGE_LABELS[String(b)] || String(b))
        : [],
      billingType: asStr(row.billingType),
      price: catalogPriceRows(row),
      status: Number(row.status) || 0,
      catalogId: row.id ?? null,
      selectable: kind === 'chat',
    }
  }).filter((m) => m.id).sort((a, b) => a.id.localeCompare(b.id))
}

/** Normalize OpenAI-style /v1/models payload into UI rows. */
export function normalizeGatewayModels(payload) {
  const raw = isObj(payload) && Array.isArray(payload.data)
    ? payload.data
    : (Array.isArray(payload) ? payload : [])
  return raw.filter(isObj).map((row) => {
    const id = asStr(row.id)
    const kind = classifyModelKind(row)
    return {
      id,
      name: prettyModelName(id),
      kind,
      ownedBy: asStr(row.owned_by) || 'tokenplan',
      endpoints: Array.isArray(row.supported_endpoint_types)
        ? row.supported_endpoint_types.map(String)
        : [],
      selectable: kind === 'chat',
    }
  }).filter((m) => m.id).sort((a, b) => a.id.localeCompare(b.id))
}

/** Split an OpenAI-compatible model list into provider/model rows for DSH. */
export function modelRowsForProvider(models) {
  const list = Array.isArray(models) && models.length > 0
    ? models.map((m) => {
      const id = asStr(isObj(m) ? m.id : m)
      const name = asStr(isObj(m) ? m.name : '') || prettyModelName(id)
      return { id, name }
    }).filter((m) => m.id)
    : [{ id: HUASHU_MODEL_ID, name: HUASHU_MODEL_NAME }]
  return list
}

/** llm-pi-ai user-layer patch for the 华数模型 route (one or more models). */
export function huashuProviderPatch(models) {
  return {
    providers: {
      [HUASHU_PROVIDER_ID]: {
        displayName: HUASHU_DISPLAY_NAME,
        apiKeyEnv: HUASHU_API_KEY_ENV,
        api: 'openai-completions',
        baseURL: HUASHU_BASE_URL,
        compat: {
          supportsDeveloperRole: false,
          maxTokensField: 'max_tokens',
        },
        models: modelRowsForProvider(models),
      },
    },
  }
}

/**
 * Parse the `promotionPoints` JSON blob the pricing page carries
 * (`{"title":"...","detail":"..."}`, sometimes plain text).
 * @returns {{ title: string, detail: string }}
 */
export function parsePromotionPoints(value) {
  const raw = asStr(value)
  if (!raw) return { title: '', detail: '' }
  try {
    const parsed = JSON.parse(raw)
    if (isObj(parsed)) {
      return { title: asStr(parsed.title), detail: asStr(parsed.detail) }
    }
  } catch { /* plain text promotion */ }
  return { title: raw, detail: '' }
}

/**
 * Feature bullets for one package row, matching the official pricing page:
 * yearly plans carry 12× the monthly credit grant.
 */
export function packageFeatures(pkg) {
  if (!isObj(pkg)) return []
  const feats = []
  const credit = Number(pkg.creditValue) || 0
  const isYearly = String(pkg.renewalType) === '1' || asStr(pkg.packageType).toUpperCase() === 'YEARLY'
  if (credit > 0) feats.push('包含 ' + (isYearly ? credit * 12 : credit).toLocaleString('zh-CN') + ' 积分')
  if (asStr(pkg.packageValidDuration)) feats.push('积分有效期 ' + asStr(pkg.packageValidDuration))
  const promo = parsePromotionPoints(pkg.promotionPoints)
  if (promo.detail) feats.push(promo.detail)
  else if (pkg.promotionPoints && Number(pkg.promotionPoints) > 0) {
    feats.push('赠 ' + Number(pkg.promotionPoints).toLocaleString('zh-CN') + ' 积分')
  }
  return feats
}

/** Effective price of a package row (promoPrice wins, then originalPrice). */
export function packagePrice(pkg) {
  if (!isObj(pkg)) return null
  const v = pkg.promoPrice ?? pkg.originalPrice ?? pkg.price
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** QR purchase link for a package row (site's 立即订购 → 扫码购买 flow). */
export function packageQrUrl(pkg) {
  if (!isObj(pkg)) return ''
  const productId = pkg.productId ?? pkg.id
  if (productId === undefined || productId === null || productId === '') return ''
  let detail = PKG_DETAIL_URL + '?id=' + encodeURIComponent(String(productId))
  if (String(pkg.renewalType) === '-1' && pkg.goodsDetailRelationId) {
    detail += '&goodsDetailRelationId=' + encodeURIComponent(String(pkg.goodsDetailRelationId))
  }
  return QR_API_URL + encodeURIComponent(detail)
}

/** Console deep link (hash routing). */
export function consoleUrl(hashPath) {
  const p = asStr(hashPath)
  if (!p) return CONSOLE_BASE_URL
  return CONSOLE_BASE_URL + '#/' + p.replace(/^[#/]+/, '')
}

const PKG_TYPE_LABELS = { MONTHLY: '包月', YEARLY: '包年', CONTINUOUS_MONTHLY: '连续包月' }
const CREDIT_STATUS_LABELS = { COMPLETED: '正常', EXPIRED: '过期', PENDING: '处理中' }

/** Package/order type label shared by the credits page. */
export function packageTypeLabel(type) {
  const t = asStr(type).toUpperCase()
  return PKG_TYPE_LABELS[t] || t || '—'
}

/** Credit-order status label (site shows 正常/过期). */
export function creditStatusLabel(status) {
  const s = asStr(status).toUpperCase()
  return CREDIT_STATUS_LABELS[s] || s || '—'
}

/** Usage-log settlement label (`ordered` = 充值, everything else 消费). */
export function settlementLabel(status) {
  return asStr(status).toLowerCase() === 'ordered' ? '充值' : '消费'
}

/** Message type label used by the message center. */
export function messageTypeLabel(msgType) {
  const map = { notice: '服务公告', maint: '系统维护', feature: '新功能', ops: '运营通知', warn: '安全提醒' }
  const t = asStr(msgType).toLowerCase()
  return map[t] || t || '系统消息'
}

/** Extension vocabulary the AI创作 pages classify reference material by. */
const MEDIA_TYPES = {
  'image/png': { ext: '.png', reference: 'reference', kind: 'image' },
  'image/jpeg': { ext: '.jpg', reference: 'reference', kind: 'image' },
  'image/webp': { ext: '.webp', reference: 'reference', kind: 'image' },
  'image/gif': { ext: '.gif', reference: 'reference', kind: 'image' },
  'video/mp4': { ext: '.mp4', reference: 'file', kind: 'video' },
  'video/quicktime': { ext: '.mov', reference: 'file', kind: 'video' },
  'video/webm': { ext: '.webm', reference: 'file', kind: 'video' },
  'audio/mpeg': { ext: '.mp3', reference: 'audio', kind: 'audio' },
  'audio/wav': { ext: '.wav', reference: 'audio', kind: 'audio' },
  'audio/mp4': { ext: '.m4a', reference: 'audio', kind: 'audio' },
}

const EXT_MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/mp4', '.avi': 'video/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/mp4', '.flac': 'audio/wav',
}

/** Lowercase extension of a URL or file name, query string stripped. */
export function fileExtension(value) {
  const clean = cleanMediaUrl(value).split('?')[0].split('#')[0]
  const match = /\.[A-Za-z0-9]{1,5}$/.exec(clean)
  return match ? match[0].toLowerCase() : ''
}

/**
 * Strict base64 decode for the browser half's `POST /creation/upload` body.
 *
 * `Buffer.from(x, 'base64')` silently skips invalid characters, so a garbage
 * payload would otherwise reach the upstream as a corrupt file. A bare
 * `data:<mime>;base64,` prefix (what `FileReader.readAsDataURL` returns) is
 * accepted.
 */
export function decodeBase64Payload(value) {
  const raw = asStr(value)
  if (!raw) return { ok: false, error: '缺少文件数据' }
  const body = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw
  const clean = body.replace(/\s+/g, '')
  if (!clean) return { ok: false, error: '缺少文件数据' }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 === 1) {
    return { ok: false, error: '文件数据不是合法的 base64' }
  }
  const bytes = Buffer.from(clean, 'base64')
  if (!bytes.length) return { ok: false, error: '文件为空' }
  return { ok: true, bytes }
}

/** Best-effort content type for an uploaded conversation file. */
export function guessContentType(name) {
  return EXT_MEDIA_TYPES[fileExtension(name)] || 'application/octet-stream'
}

/** Reference-material `type` the AI创作 video page assigns to one file. */
export function guessReferenceType(name, contentType) {
  const byMime = MEDIA_TYPES[asStr(contentType)]
  if (byMime) return byMime.reference
  const ext = fileExtension(name)
  const mime = EXT_MEDIA_TYPES[ext]
  if (mime && MEDIA_TYPES[mime]) return MEDIA_TYPES[mime].reference
  if (['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext)) return 'file'
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac'].includes(ext)) return 'audio'
  return 'reference'
}

/** Extension to store a produced video under. */
export function guessExtension(url) {
  return fileExtension(url) || '.mp4'
}

/** Sniff a raster media type from magic bytes (the site's `Up` helper). */
export function imageMediaTypeFrom(data) {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data || [])
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 6 && String.fromCharCode(...buf.subarray(0, 6)).startsWith('GIF8')) return 'image/gif'
  if (buf.length >= 12 && String.fromCharCode(...buf.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...buf.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return ''
}

/** Human byte size for cloud-drive usage (site helper `ei`). */export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return (Math.round(v * 100) / 100) + ' ' + units[i]
}

/** Normalize `pcweb/clouddisk/file/home` into a panel-friendly usage row. */
export function normalizeDriveUsage(home) {
  if (!isObj(home)) return null
  const total = Number(home.total) || 0
  const files = Number(home.diskSpace) || 0
  const albums = Number(home.albumSpace) || 0
  const used = Number(home.used) || (files + albums)
  const free = home.free != null ? Number(home.free) : Math.max(0, total - used)
  return {
    total,
    used,
    free,
    files,
    albums,
    percent: total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0,
    totalText: formatBytes(total),
    usedText: formatBytes(used),
    freeText: formatBytes(free),
    filesText: formatBytes(files),
    albumsText: formatBytes(albums),
    benefit: home.benefit ?? null,
  }
}

/**
 * Parse a value the site ships either already decoded or as a JSON string.
 * Creation rows JSON-encode `resultUrls` / `paramsConfig` / `referenceFiles`.
 */
export function parseJsonField(value, fallback) {
  if (Array.isArray(value) || isObj(value)) return value
  const raw = asStr(value)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return parsed === null || parsed === undefined ? fallback : parsed
  } catch { return fallback }
}

/** Strip the backticks the site wraps stored object names in. */
export function cleanMediaUrl(value) {
  return String(value === null || value === undefined ? '' : value).replace(/`/g, '').trim()
}

/** Creation statuses the site polls on before a task settles. */
export const CREATION_PENDING_STATUSES = new Set(['pending', 'processing', 'running', 'queued', 'submitted'])

export function isCreationPending(status) {
  return CREATION_PENDING_STATUSES.has(asStr(status).toLowerCase())
}

/** Video modes the AI创作-视频生成 page submits (`pcweb/creation/submit`). */
export const VIDEO_MODES = [
  'text_to_video', 'image_to_video', 'first_last_frame',
  'full_reference', 'file_upload', 'url_input', 'video_edit', 'smart_edit',
]

/**
 * Derive the video mode from the reference material, mirroring the AI创作视频生成
 * page: frames first, then a URL input, then an uploaded video file, then any
 * image/audio reference, and plain text-to-video when nothing is attached.
 */
export function deriveVideoMode(references) {
  const list = Array.isArray(references) ? references : []
  const has = (type) => list.some((r) => isObj(r) && asStr(r.type) === type)
  if (has('first_frame') || has('last_frame')) return 'first_last_frame'
  if (has('url')) return 'url_input'
  if (has('file') || has('video')) return 'file_upload'
  if (has('audio') || has('reference')) return 'full_reference'
  return 'text_to_video'
}

/**
 * Decode one creation task row.
 *
 * Media URLs: the site prefers `localResultUrls` (the permanent
 * `file.smartlink.wasu.cn` CDN copy) over `resultUrls` (a signed third-party
 * OSS URL that expires within hours). Verified live: an expired `resultUrls`
 * entry answers 403 while its `localResultUrls` twin still answers 200.
 */
export function normalizeCreationTask(row) {
  if (!isObj(row)) return null
  const parse = parseJsonField
  const kind = asStr(row.templateType).toUpperCase() === 'VIDEO' || asStr(row.modelType).toLowerCase() === 'video'
    ? 'video'
    : 'image'
  // Prefer the permanent local copy; fall back to the (possibly signed) remote one.
  const local = parse(row.localResultUrls, []).map(cleanMediaUrl).filter(Boolean)
  const remote = parse(row.resultUrls, []).map(cleanMediaUrl).filter(Boolean)
  const urls = local.length ? local : remote
  const params = parse(row.paramsConfig, {})
  const status = asStr(row.status)
  return {
    id: String(row.taskId ?? row.id ?? ''),
    kind,
    status,
    pending: isCreationPending(status),
    progress: asStr(row.progress),
    model: asStr(row.modelName),
    prompt: asStr(row.prompt),
    negativePrompt: asStr(row.negativePrompt),
    videoMode: asStr(row.videoMode),
    createdAt: asStr(row.createdTime || row.createdAt),
    finishedAt: asStr(row.finishTime),
    error: asStr(row.errorMessageUser || row.errorMessage),
    urls,
    media: urls.map((url) => ({ url, kind })),
    cover: urls[0] || '',
    localUrls: local,
    expiredRemote: local.length === 0 && remote.length > 0,
    ratio: asStr(params.ratio),
    resolution: asStr(params.resolutionLabel || params.resolution || row.resolutionLabel),
    duration: params.duration != null ? String(params.duration) : '',
    imageCount: params.imageCount != null ? String(params.imageCount) : '',
    watermark: params.watermark === undefined ? null : params.watermark === true,
    referenceFiles: Array.isArray(params.referenceFiles)
      ? params.referenceFiles
      : parse(row.referenceFiles, []),
  }
}

/** Map a task row onto the shared gallery item shape. */
export function creationTaskToGalleryItem(task) {
  const t = isObj(task) ? task : normalizeCreationTask(task)
  if (!t) return null
  return {
    id: 'task:' + t.id,
    taskId: t.id,
    source: 'tasks',
    kind: t.kind,
    url: t.urls[0] || '',
    urls: t.urls,
    thumb: '',
    title: t.prompt ? t.prompt.slice(0, 80) : t.model || t.id,
    prompt: t.prompt,
    model: t.model,
    createdAt: t.createdAt,
    status: t.status,
    pending: t.pending === true,
    progress: t.progress,
    error: t.error,
    meta: [t.ratio, t.resolution, t.duration && t.duration + '秒', t.imageCount && t.imageCount + '张']
      .filter(Boolean).join(' · '),
  }
}

/**
 * Cloud-drive rows carry epoch milliseconds while creation records carry
 * `YYYY-MM-DD HH:mm:ss` strings. Normalize both, so the merged gallery sorts by
 * real time instead of comparing a number to a date.
 */
export function assetTime(value) {
  if (value === null || value === undefined || value === '') return ''
  const numeric = typeof value === 'number' || /^\d{10,}$/.test(String(value).trim())
  if (!numeric) return asStr(value)
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return asStr(value)
  const date = new Date(ms < 1e12 ? ms * 1000 : ms)
  if (Number.isNaN(date.getTime())) return asStr(value)
  const pad = (n) => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
}

/**
 * Decode one `pcweb/clouddisk/file/ai-assets` row (我的云盘 → AI作品).
 *
 * `fileType` is the site's numeric discriminator: 1 = image, 2 = video,
 * anything else = file. `fileAddress` is an object name that needs a signed
 * URL, which the host obtains through `pcweb/clouddisk/file/download/url`.
 */
export function normalizeAiAsset(row) {
  if (!isObj(row)) return null
  const fileType = Number(row.fileType)
  const kind = fileType === 1 ? 'image' : fileType === 2 ? 'video' : 'file'
  const key = cleanMediaUrl(row.fileAddress || row.fileAddr || row.objectName)
  const id = String(row.fileId ?? row.id ?? key)
  if (!id && !key) return null
  const size = Number(row.fileSize)
  return {
    id: 'asset:' + id,
    assetId: id,
    source: 'drive',
    kind,
    key,
    url: cleanMediaUrl(row.fileUrl || row.url),
    thumb: '',
    title: asStr(row.name || row.localName) || key.split('/').pop() || '未命名作品',
    prompt: asStr(row.prompt),
    model: asStr(row.modelName),
    createdAt: assetTime(row.createTime || row.updateTime || row.localTime),
    size: Number.isFinite(size) ? size : 0,
    duration: kind === 'video' && Number(row.videoTime) > 0 ? String(row.videoTime) : '',
    meta: [Number.isFinite(size) && size > 0 ? formatBytes(size) : '',
      asStr(row.resolutionLabel)].filter(Boolean).join(' · '),
  }
}

/** Normalize `pcweb/clouddisk/file/ai-assets` envelope (`{counts, files:{list,total,pageNum}}`). */
export function normalizeAiAssetPage(payload) {
  const data = isObj(payload) ? payload : {}
  const files = isObj(data.files) ? data.files : {}
  const list = Array.isArray(files.list) ? files.list
    : (Array.isArray(data.list) ? data.list : [])
  const counts = isObj(data.counts) ? data.counts : {}
  return {
    items: list.map(normalizeAiAsset).filter(Boolean),
    total: Number(files.total) || list.length,
    page: Number(files.pageNum) || 1,
    counts: {
      all: Number(counts.total) || Number(files.total) || list.length,
      image: Number(counts.photos) || 0,
      video: Number(counts.videos) || 0,
      file: Number(counts.doc) || 0,
    },
  }
}

/** Normalize one `pcweb/creation/models` row for the generator form. */
export function normalizeCreationModel(row) {
  if (!isObj(row)) return null
  const id = asStr(row.modelName || row.modelId)
  if (!id) return null
  const params = isObj(row.modelParams) ? row.modelParams : {}
  const capabilities = Array.isArray(params.capabilities)
    ? params.capabilities.map((c) => asStr(c)).filter(Boolean)
    : []
  const kind = asStr(row.modelType).toLowerCase() === 'video' ? 'video' : 'image'
  const supports = (...keys) => keys.some((key) => params[key] === 1 || params[key] === true)
  return {
    id,
    name: prettyModelName(id),
    kind,
    vendor: asStr(row.vendor),
    icon: asStr(row.modelIcon),
    description: asStr(row.description),
    imagePrice: Number(row.imageQuotaPerUnit) || 0,
    videoPrice: Number(row.videoQuotaPerSecond) || 0,
    resolutions: Array.isArray(params.resolutions) ? params.resolutions.map((v) => String(v)) : [],
    ratios: Array.isArray(params.ratios) ? params.ratios.map((v) => String(v)) : [],
    durations: Array.isArray(params.durations) ? params.durations.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [],
    maxImages: Number(params.maxImages) || 0,
    capabilities,
    extraConfig: isObj(params.extraConfig) ? params.extraConfig : null,
    supports: {
      textToVideo: supports('supportsTextToVideo') || capabilities.includes('text_to_video'),
      imageToVideo: supports('supportsImageToVideo') || capabilities.includes('image_to_video'),
      firstLastFrame: supports('supportsFirstLastFrame') || capabilities.includes('first_last_frame'),
      fullReference: supports('supportsFullReference') || capabilities.includes('full_reference'),
      smartEdit: capabilities.includes('smart_edit'),
      layerSplit: capabilities.includes('layer_split'),
      audio: Number(params.extraConfig && params.extraConfig.supports_audio) === 1,
    },
    params: params,
  }
}

/** Estimated credit cost of one request against a normalized model row. */
export function creationCost(model, options = {}) {
  const m = isObj(model) ? model : {}
  if (asStr(m.kind) === 'video') {
    const seconds = Number(options.duration) || 0
    return (Number(m.videoPrice) || 0) * seconds
  }
  const count = Number(options.imageCount) || 1
  return (Number(m.imagePrice) || 0) * Math.max(1, count)
}

function isoDate(d) {
  return d.toISOString().split('T')[0]
}

function dateRange(days) {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  return { startDate: isoDate(start), endDate: isoDate(end) }
}

function monthRange() {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth(), 1)
  return { startDate: isoDate(start), endDate: isoDate(end) }
}

export const name = 'dsh-tokenplan-bill'
export const inject = ['webServer', 'tools', 'attachments']

export function apply(ctx) {
  const dshDir = () => (process.env.DSH_HOME && String(process.env.DSH_HOME))
    || (typeof os.homedir === 'function' ? join(os.homedir(), '.dsh') : null)
  const statePath = () => {
    if (asStr(process.env.TOKENPLAN_BILL_STATE)) return asStr(process.env.TOKENPLAN_BILL_STATE)
    const d = dshDir()
    return d === null ? null : join(d, 'tokenplan-bill-state.json')
  }

  let stateLoaded = false
  let state = {
    accessToken: '',
    refreshToken: '',
    uid: '',
    phone: '',
    userType: 'personal',
    accountInfo: null,
    cloud: null,
    prefs: {},
  }

  const loadState = () => {
    if (stateLoaded) return state
    stateLoaded = true
    const file = statePath()
    if (file === null || !existsSync(file)) return state
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      if (!isObj(data)) return state
      state.accessToken = asStr(data.accessToken)
      state.refreshToken = asStr(data.refreshToken)
      state.uid = asStr(data.uid)
      state.phone = asStr(data.phone)
      state.userType = asStr(data.userType) || 'personal'
      if (isObj(data.accountInfo)) state.accountInfo = data.accountInfo
      if (isObj(data.cloud)) state.cloud = data.cloud
      if (isObj(data.prefs)) state.prefs = data.prefs
    } catch { /* corrupt state is treated as logged out */ }
    return state
  }

  /** Atomic publish: temp file in the same directory, then rename. */
  const saveState = () => {
    const file = statePath()
    if (file === null) return
    const payload = JSON.stringify({
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      uid: state.uid,
      phone: state.phone,
      userType: state.userType,
      accountInfo: state.accountInfo,
      cloud: state.cloud,
      prefs: state.prefs,
      savedAt: Date.now(),
      version: PKG_VERSION,
    }, null, 2) + '\n'
    try {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = file + '.' + process.pid + '.tmp'
      writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600 })
      renameSync(tmp, file)
    } catch (err) {
      if (ctx.logger && typeof ctx.logger.warn === 'function') {
        ctx.logger.warn('tokenplan-bill: 状态保存失败: %s', String((err && err.message) || err))
      }
    }
  }

  const clearAuth = () => {
    state.accessToken = ''
    state.refreshToken = ''
    state.uid = ''
    state.accountInfo = null
    state.cloud = null
    saveState()
    dashCache = null
  }

  const sanitizePrefs = (input) => {
    const out = {}
    if (!isObj(input)) return out
    if (isObj(input.panel)) {
      const panel = {}
      for (const k of ['x', 'y', 'w', 'h']) {
        const n = Number(input.panel[k])
        if (Number.isFinite(n)) panel[k] = n
      }
      if (Object.keys(panel).length) out.panel = panel
    }
    return out
  }

  const writeJson = (res, value, status) => {
    res.writeHead(status || 200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(value))
  }

  async function readBody(req) {
    let text = ''
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_UPSTREAM_BYTES) throw new Error('请求体过大')
      text += chunk
    }
    if (text === '') return {}
    try {
      const parsed = JSON.parse(text)
      return isObj(parsed) ? parsed : {}
    } catch { return {} }
  }

  /**
   * One upstream call with a deadline.
   *
   * `init.signal` is fused rather than replaced: the caller's cancellation must
   * still abort the request, and the budget only adds an upper bound on top.
   */
  const fetchWithTimeout = async (url, init = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) => {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    const external = init.signal
    const onAbort = () => ac.abort()
    if (external) {
      if (external.aborted) ac.abort()
      else if (typeof external.addEventListener === 'function') external.addEventListener('abort', onAbort, { once: true })
    }
    try {
      return await fetch(url, { ...init, signal: ac.signal })
    } finally {
      clearTimeout(timer)
      if (external && typeof external.removeEventListener === 'function') external.removeEventListener('abort', onAbort)
    }
  }

  const payChannel = () => (state.userType === 'enterprise'
    ? PAY_CHANNEL_ENTERPRISE
    : PAY_CHANNEL_PERSONAL)

  const hyywHeaders = (withToken, channel) => {
    const h = {
      'ri-user-agent': 'MOB-WEB',
      'ri-pay-channel': channel || payChannel(),
      accept: 'application/json, text/plain, */*',
    }
    if (withToken && state.accessToken) h['ri-token'] = state.accessToken
    return h
  }

  const hyywGet = async (path, params, opts = {}) => {
    const qs = new URLSearchParams(params || {}).toString()
    const url = HYYW_BASE + path.replace(/^\//, '') + (qs ? '?' + qs : '')
    const headers = hyywHeaders(opts.auth !== false, opts.channel)
    const res = await fetchWithTimeout(url, { method: 'GET', headers })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* non-JSON upstream */ }
    return { status: res.status, ...unwrapResponse(json), text }
  }

  const hyywFormPost = async (path, fields, opts = {}) => {
    const body = new URLSearchParams()
    for (const [k, v] of Object.entries(fields || {})) {
      if (v !== undefined && v !== null) body.set(k, String(v))
    }
    const url = HYYW_BASE + path.replace(/^\//, '')
    const headers = {
      ...hyywHeaders(opts.auth !== false, opts.channel),
      'content-type': 'application/x-www-form-urlencoded',
    }
    const res = await fetchWithTimeout(url, { method: 'POST', headers, body: body.toString() })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* non-JSON upstream */ }
    return { status: res.status, ...unwrapResponse(json), text }
  }

  /**
   * CSRF token for the cloud-drive namespace. The browser half reads the
   * `XSRF-CLOUD-TOKEN` cookie; the host has no cookie jar, so it takes the
   * token from the response headers (`Set-Cookie` included) instead.
   */
  const readCsrfHeader = (res) => {
    try {
      const entries = typeof res.headers.entries === 'function' ? [...res.headers.entries()] : []
      for (const [k, v] of entries) {
        if (/^set-cookie$/i.test(k)) continue
        if (/csrf|xsrf/i.test(k) && asStr(v)) return asStr(v)
      }
      const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
      for (const cookie of cookies) {
        const m = String(cookie).match(/(?:^|;\s*)(XSRF-CLOUD-TOKEN|XSRF-TOKEN|CSRF-TOKEN)=([^;]+)/i)
        if (m && m[2]) return decodeURIComponent(m[2])
      }
    } catch { /* header access is best-effort */ }
    return ''
  }

  /**
   * One signed TOS call.
   *
   * The site signs each family differently (SPA helpers `Ur` / `Br` / `Mr`):
   *   - anonymous (`custom.auth === false`) → fixed default secret, no extras;
   *   - authenticated `pcweb/*`  → the ACCOUNT TOKEN is the sign secret and the
   *     envelope also carries the cloud `accessKey` from `pcweb/auth/init`,
   *     with the matching `X-CSRF-TOKEN` header;
   *   - `pcweb/auth/init` itself → token in the system block but signed with the
   *     DEFAULT secret and no `accessKey`/CSRF (it is what mints them);
   *   - `pcweb/clouddisk/*` → `accessKey` + token secret, no `accessToken`.
   *
   * Signing an authenticated call with the default secret makes the gateway
   * answer `1103 授权校验失败`, so the derivation below is not optional.
   *
   * @param {string} path e.g. `pcweb/dashboard/overview`
   * @param {object} [params]
   * @param {{ accessToken?: string, accessKey?: string, secret?: string, csrf?: string, channel?: string, noAuth?: boolean }} [opts]
   *   `undefined` means "derive from the cached cloud authorization"; pass `''`
   *   to force the field empty (used by the `pcweb/auth/init` bootstrap).
   */
  const tosRequest = async (path, params, opts = {}) => {
    loadState()
    const authed = opts.noAuth !== true
    const token = !authed ? '' : (opts.accessToken !== undefined ? asStr(opts.accessToken) : state.accessToken)
    const cloud = isObj(state.cloud) ? state.cloud : {}
    const accessKey = opts.accessKey !== undefined
      ? asStr(opts.accessKey)
      : (token ? asStr(cloud.accessKey) : '')
    const csrf = opts.csrf !== undefined
      ? asStr(opts.csrf)
      : (token && asStr(cloud.secret) === token ? asStr(cloud.csrf) : '')
    const secret = opts.secret !== undefined
      ? asStr(opts.secret)
      : (token || SIGN_SECRET)
    const envelope = buildTosEnvelope(params || {}, {
      accessToken: token,
      accessKey,
      secret,
    })
    const headers = {
      'ri-pay-channel': opts.channel || payChannel(),
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      accessToken: token,
    }
    // The cloud CSRF token travels as a header; it comes from `pcweb/auth/init`
    // (or from the response of the call that minted it), never from a jar.
    if (csrf) headers['X-CSRF-TOKEN'] = csrf
    const res = await fetchWithTimeout(TOS_BASE + path.replace(/^\//, ''), {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* non-JSON upstream */ }
    const unwrapped = unwrapResponse(json)
    return {
      status: res.status,
      ...unwrapped,
      text,
      envelope,
      csrf: readCsrfHeader(res),
    }
  }

  // One in-flight refresh shared by every request that hit an expired session
  // (the SPA does the same), so a burst of 401/1103 answers cannot fan out
  // into concurrent refresh calls that clear the session mid-flight.
  let refreshInFlight = null

  const tryRefresh = async () => {
    loadState()
    if (!state.refreshToken) return false
    if (refreshInFlight) return refreshInFlight
    refreshInFlight = (async () => {
      const r = await hyywFormPost('changShi-member-sdk/wasuAI/token/refreshToken', {
        refreshToken: state.refreshToken,
      }, { auth: false })
      const data = r.data
      const access = isObj(data) ? asStr(data.accessToken || data.access_token) : ''
      if (!r.ok || !access) {
        clearAuth()
        return false
      }
      state.accessToken = access
      const nextRefresh = asStr(data.refreshToken || data.refresh_token)
      if (nextRefresh) state.refreshToken = nextRefresh
      // The cloud-drive accessKey is bound to one access token.
      state.cloud = null
      saveState()
      return true
    })().finally(() => { refreshInFlight = null })
    return refreshInFlight
  }

  /**
   * Authenticated `pcweb/*` call.
   *
   * `1103 授权校验失败` has three distinct causes, so the retry ladder escalates
   * instead of treating every one as an expired session:
   *   1. a stale/rotated cloud `accessKey`/CSRF → re-run `pcweb/auth/init`;
   *   2. a genuinely expired account token → refresh, then re-init cloud auth;
   *   3. anything still failing → real session expiry (`登录已过期`).
   */
  const tosAuthed = async (path, params, opts = {}) => {
    loadState()
    if (!state.accessToken) return { ok: false, error: '未登录', status: 401, code: 401 }
    await ensureCloudAuth(false)
    let r = await tosRequest(path, params, opts)
    if (r.ok || !isAuthErrorCode(r.code)) return r

    let again = await ensureCloudAuth(true)
    if (again.ok) r = await tosRequest(path, params, opts)
    if (r.ok || !isAuthErrorCode(r.code)) return r

    const refreshed = await tryRefresh()
    if (!refreshed) return { ok: false, error: '登录已过期', status: 401, code: 401 }
    await ensureCloudAuth(true)
    return tosRequest(path, params, opts)
  }

  const hyywAuthed = async (path, params, opts = {}) => {
    loadState()
    if (!state.accessToken) return { ok: false, error: '未登录', status: 401, code: 401 }
    let r = await hyywGet(path, params, opts)
    if (!r.ok && isAuthErrorCode(r.code)) {
      const refreshed = await tryRefresh()
      if (refreshed) r = await hyywGet(path, params, opts)
      else return { ok: false, error: '登录已过期', status: 401, code: 401 }
    }
    return r
  }

  const requireAuth = (res) => {
    loadState()
    if (!state.accessToken) {
      writeJson(res, { ok: false, error: '未登录', loggedIn: false }, 401)
      return false
    }
    return true
  }

  /**
   * Cloud authorization bootstrap, shared by every authenticated `pcweb/*` call.
   *
   * `POST pcweb/auth/init` is the one authenticated call that is signed with the
   * DEFAULT secret and carries neither `accessKey` nor CSRF — it is what mints
   * them. Its `accessKey` is bound to the current account token (the SPA stores
   * the token as the cloud business secret and invalidates the pair whenever the
   * token changes), which is exactly the cache key used here.
   *
   * Concurrent callers share one in-flight bootstrap, mirroring the SPA's `gn`
   * guard, so a burst of parallel dashboard requests cannot fan out into a burst
   * of `auth/init` calls.
   *
   * @param {boolean} [force] ignore (and replace) the cached pair
   */
  let cloudAuthInFlight = null

  const ensureCloudAuth = async (force) => {
    loadState()
    if (!state.accessToken) return { ok: false, error: '未登录', code: 401 }
    const cached = state.cloud
    if (!force && isObj(cached) && asStr(cached.accessKey)
      && asStr(cached.secret) === state.accessToken
      && Date.now() - (Number(cached.at) || 0) < CLOUD_AUTH_TTL_MS) {
      return { ok: true, ...cached }
    }
    if (cloudAuthInFlight) return cloudAuthInFlight
    cloudAuthInFlight = (async () => {
      const token = state.accessToken
      const r = await tosRequest('pcweb/auth/init', {}, {
        secret: SIGN_SECRET,
        accessKey: '',
        csrf: '',
      })
      if (!r.ok) return { ok: false, error: r.error || '云盘授权失败', code: r.code }
      const data = isObj(r.data) ? r.data : {}
      const accessKey = asStr(data.accessKey || data.accesskey)
      if (!accessKey) return { ok: false, error: '云盘授权未返回 accessKey', code: r.code }
      const csrf = asStr(data.csrfToken || data.csrfTokenValue || data.csrf || data.token) || asStr(r.csrf)
      // A refresh may have swapped the token while this was in flight: the pair
      // only belongs to the token it was minted for.
      if (state.accessToken !== token) return { ok: false, error: '授权已变更', code: 401 }
      state.cloud = { accessKey, csrf, secret: token, at: Date.now() }
      if (isObj(data) && asStr(data.uid) && !state.uid) state.uid = asStr(data.uid)
      saveState()
      return { ok: true, ...state.cloud }
    })().finally(() => { cloudAuthInFlight = null })
    return cloudAuthInFlight
  }

  const cloudPost = async (path, params) => {
    const auth = await ensureCloudAuth(false)
    if (!auth.ok) return auth
    const call = (a) => tosRequest('pcweb/clouddisk/' + path.replace(/^\//, ''), params, {
      accessToken: '',
      accessKey: a.accessKey,
      secret: a.secret,
      csrf: a.csrf,
      channel: PAY_CHANNEL_CLOUD,
    })
    let r = await call(auth)
    if (!r.ok && isAuthErrorCode(r.code)) {
      const again = await ensureCloudAuth(true)
      if (again.ok) r = await call(again)
      else return { ok: false, error: again.error || '云盘授权失效', code: again.code }
    }
    return r
  }

  const maskKeyRow = (row) => {
    if (!isObj(row)) return row
    const key = asStr(row.apiKey)
    return {
      ...row,
      apiKey: key,
      apiKeyMasked: maskApiKey(key),
      apiKeyHint: maskSecret(key),
      statusLabel: keyStatusLabel(row),
      deletable: row.deletable !== false,
    }
  }

  /**
   * Resolve a platform API key for gateway calls and DSH credentials.
   * @returns {Promise<{ ok: true, apiKey: string } | { ok: false, error: string }>}
   */
  const resolvePlatformApiKey = async () => {
    let listRes = await tosAuthed('pcweb/keys/list', {})
    if (!listRes.ok) {
      return { ok: false, error: listRes.error || '拉取 API 密钥失败' }
    }
    let list = Array.isArray(listRes.data) ? listRes.data : []
    let apiKey = pickPlatformApiKey(list)

    if (!apiKey) {
      const created = await tosAuthed('pcweb/keys/create', { keyName: HUASHU_AUTO_KEY_NAME })
      if (created.ok && isObj(created.data)) {
        apiKey = asStr(created.data.apiKey || created.data.key || created.data.secret)
      }
      if (!apiKey) {
        listRes = await tosAuthed('pcweb/keys/list', {})
        if (listRes.ok && Array.isArray(listRes.data)) {
          list = listRes.data
          apiKey = pickPlatformApiKey(list)
        }
      }
    }

    if (!apiKey) {
      return { ok: false, error: '账号下没有可用 API 密钥，请先在「API密钥」页创建' }
    }
    return { ok: true, apiKey }
  }

  /** Read currently configured 华数模型 ids from DSH settings. */
  const readConfiguredHuashu = () => {
    const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
    if (!settings || typeof settings.describe !== 'function') {
      return { models: [], defaultModel: '', provider: HUASHU_PROVIDER_ID }
    }
    const desc = settings.describe().find((d) => d && d.ns === 'llm-pi-ai')
    const providers = isObj(desc?.value) && isObj(desc.value.providers) ? desc.value.providers : {}
    const profile = isObj(providers[HUASHU_PROVIDER_ID]) ? providers[HUASHU_PROVIDER_ID] : {}
    const models = Array.isArray(profile.models)
      ? profile.models.filter(isObj).map((m) => ({
        id: asStr(m.id),
        name: asStr(m.name) || prettyModelName(asStr(m.id)),
      })).filter((m) => m.id)
      : []
    const defDesc = settings.describe().find((d) => d && d.ns === 'agent-default-model')
    const def = isObj(defDesc?.value) ? defDesc.value : {}
    const defaultModel = asStr(def.provider) === HUASHU_PROVIDER_ID ? asStr(def.model) : ''
    return { models, defaultModel, provider: HUASHU_PROVIDER_ID, displayName: HUASHU_DISPLAY_NAME }
  }

  /** GET https://token.wasu.cn/v1/models with a platform key. */
  const fetchGatewayModels = async (apiKey) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS)
    try {
      const res = await fetch(HUASHU_BASE_URL + '/models', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          Accept: 'application/json',
        },
        signal: ctrl.signal,
      })
      const text = await res.text()
      let json = null
      try { json = text ? JSON.parse(text) : null } catch { json = null }
      if (!res.ok) {
        const msg = isObj(json) ? asStr(json.error?.message || json.msg || json.message) : ''
        return { ok: false, error: msg || ('models HTTP ' + res.status), status: res.status }
      }
      return { ok: true, models: normalizeGatewayModels(json) }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Platform model catalog (no API key required; `custom:{auth:false}` upstream). */
  const fetchCatalogModels = async () => {
    const r = await tosRequest('pcweb/models/list', { page: 1, size: 200 }, { noAuth: true })
    if (!r.ok) return { ok: false, error: r.error || '模型目录拉取失败', code: r.code }
    const models = normalizeCatalogModels(r.data)
    return { ok: true, models, total: isObj(r.data) ? Number(r.data.total) || models.length : models.length }
  }

  /**
   * Upsert 华数模型 into DSH: ensure provider + credential, merge selected models,
   * optionally set agent-default-model to the first selected id.
   * @param {{ modelIds?: string[], modelNames?: Record<string,string>, setDefault?: boolean, applyToSessions?: boolean }} [opts]
   */
  const syncHuashuModel = async (opts = {}) => {
    const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
    if (!settings || typeof settings.update !== 'function') {
      return { ok: false, error: 'settings 服务不可用，无法写入华数模型' }
    }
    if (!credentials || typeof credentials.set !== 'function') {
      return { ok: false, error: 'credentials 服务不可用，无法写入 API Key' }
    }

    const keyRes = await resolvePlatformApiKey()
    if (!keyRes.ok) return keyRes
    const apiKey = keyRes.apiKey

    const requestedIds = Array.isArray(opts.modelIds)
      ? opts.modelIds.map(asStr).filter(Boolean)
      : []
    const nameMap = isObj(opts.modelNames) ? opts.modelNames : {}
    const setDefault = opts.setDefault !== false

    const configured = readConfiguredHuashu()
    const byId = new Map()
    for (const m of configured.models) byId.set(m.id, m)
    if (requestedIds.length === 0 && byId.size === 0) {
      byId.set(HUASHU_MODEL_ID, { id: HUASHU_MODEL_ID, name: HUASHU_MODEL_NAME })
    }
    for (const id of requestedIds) {
      byId.set(id, {
        id,
        name: asStr(nameMap[id]) || prettyModelName(id),
      })
    }
    const models = [...byId.values()]
    const primaryId = requestedIds[0] || configured.defaultModel || HUASHU_MODEL_ID
    // Only change the Agent default when the caller picked a model, or nothing is set yet.
    // Login re-sync must not clobber a user-chosen default back to the seed model.
    const shouldSetDefault = setDefault && (requestedIds.length > 0 || !configured.defaultModel)
    let appliedSessions = 0

    // Force chat selectors to drop cached catalogs. registrationFacts in
    // dsh-llm-pi-ai only covers provider/displayName/retryPolicy, so a
    // model-list-only settings write does not re-register the route.
    const notifyChatCatalog = () => {
      try {
        if (typeof ctx.emit === 'function') {
          ctx.emit('llm/adapters-updated')
          ctx.emit('settings/document-updated', 'llm-pi-ai', Date.now())
        }
      } catch { /* event emit is best-effort */ }
    }

    try {
      const patch = huashuProviderPatch(models)
      patch.providers[HUASHU_PROVIDER_ID].displayName = HUASHU_DISPLAY_NAME + '\u200b'
      await settings.update('llm-pi-ai', patch)
      patch.providers[HUASHU_PROVIDER_ID].displayName = HUASHU_DISPLAY_NAME
      await settings.update('llm-pi-ai', patch)
      await credentials.set(HUASHU_API_KEY_ENV, apiKey)
      if (shouldSetDefault) {
        if (typeof settings.replace === 'function') {
          await settings.replace('agent-default-model', {
            provider: HUASHU_PROVIDER_ID,
            model: primaryId,
          })
        } else {
          await settings.update('agent-default-model', {
            provider: HUASHU_PROVIDER_ID,
            model: primaryId,
          })
        }
      }
      notifyChatCatalog()
      // Optionally switch live chat sessions onto the newly added model so the
      // composer trigger updates without a manual re-pick.
      if (requestedIds.length > 0 && opts.applyToSessions !== false) {
        try {
          const sessionCtrl = typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined
          const agentDefault = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined
          const pick = shouldSetDefault ? primaryId : requestedIds[0]
          if (agentDefault && typeof agentDefault.saveSelection === 'function' && shouldSetDefault) {
            await agentDefault.saveSelection({
              provider: HUASHU_PROVIDER_ID,
              model: pick,
            })
          }
          const sessionIds = await listLiveSessionIds(ctx, sessionCtrl)
          if (sessionCtrl && typeof sessionCtrl.selectModel === 'function') {
            for (const sessionId of sessionIds) {
              try {
                await sessionCtrl.selectModel({
                  sessionId,
                  provider: HUASHU_PROVIDER_ID,
                  model: pick,
                })
                appliedSessions += 1
              } catch (err) {
                if (ctx.logger && typeof ctx.logger.warn === 'function') {
                  ctx.logger.warn(
                    'tokenplan-bill: selectModel for %s failed: %s',
                    String(sessionId),
                    String((err && err.message) || err),
                  )
                }
              }
            }
          }
        } catch (err) {
          if (ctx.logger && typeof ctx.logger.warn === 'function') {
            ctx.logger.warn('tokenplan-bill: apply live sessions failed: %s', String((err && err.message) || err))
          }
        }
      }
    } catch (err) {
      const message = String((err && err.message) || err)
      if (ctx.logger && typeof ctx.logger.warn === 'function') {
        ctx.logger.warn('tokenplan-bill: 华数模型同步失败: %s', message)
      }
      return { ok: false, error: message }
    }

    const after = readConfiguredHuashu()
    return {
      ok: true,
      provider: HUASHU_PROVIDER_ID,
      displayName: HUASHU_DISPLAY_NAME,
      model: shouldSetDefault ? primaryId : (after.defaultModel || primaryId),
      models: after.models.length ? after.models : models,
      defaultModel: after.defaultModel || (shouldSetDefault ? primaryId : ''),
      appliedSessions,
      baseURL: HUASHU_BASE_URL,
      apiKeyEnv: HUASHU_API_KEY_ENV,
      apiKeyHint: maskSecret(apiKey),
      hint: '聊天「模型」里应同时有 DeepSeek 与「华数模型」分组；华数下为累加列表。',
    }
  }

  let dashCache = null // { key, ts, data }

  const fetchDashboard = async (rangeDays) => {
    loadState()
    if (!state.accessToken) return { ok: false, error: '未登录', loggedIn: false }
    const days = rangeDays === 30 ? 30 : 7
    const cacheKey = days + ':' + state.uid
    if (dashCache && dashCache.key === cacheKey && Date.now() - dashCache.ts < DASH_TTL_MS) {
      return { ok: true, loggedIn: true, ...dashCache.data, cached: true }
    }

    const range = dateRange(days)
    const month = monthRange()
    const [overview, daily, dist, top, user] = await Promise.all([
      tosAuthed('pcweb/dashboard/overview', {}),
      tosAuthed('pcweb/dashboard/daily-usage', { startDate: range.startDate, endDate: range.endDate }),
      tosAuthed('pcweb/dashboard/model-distribution', { startDate: range.startDate, endDate: range.endDate }),
      tosAuthed('pcweb/dashboard/top-models', { startDate: month.startDate, endDate: month.endDate, topN: 5 }),
      tosAuthed('pcweb/user/detail', {}),
    ])

    if (!overview.ok && isAuthErrorCode(overview.code)) {
      return { ok: false, error: overview.error || '登录已过期', loggedIn: false }
    }
    if (!overview.ok) {
      return { ok: false, error: overview.error || '概览拉取失败', loggedIn: true }
    }

    if (user.ok && isObj(user.data)) {
      state.accountInfo = { ...(state.accountInfo || {}), ...user.data }
      saveState()
    }

    const dailyRows = Array.isArray(daily.data) ? daily.data : []
    const maxDaily = Math.max(...dailyRows.map((d) => Number(d.totalQuota) || 0), 1)
    const dailyUsage = dailyRows.map((d) => ({
      date: asStr(d.date),
      dateLabel: asStr(d.date).slice(5),
      totalQuota: Number(d.totalQuota) || 0,
      percent: maxDaily > 0 ? ((Number(d.totalQuota) || 0) / maxDaily) * 100 : 0,
    }))

    const data = {
      overview: overview.data,
      dailyUsage,
      distribution: Array.isArray(dist.data) ? dist.data : [],
      topModels: Array.isArray(top.data) ? top.data : [],
      accountInfo: state.accountInfo,
      phone: state.phone,
      rangeDays: days,
      fetchedAt: Date.now(),
    }
    dashCache = { key: cacheKey, ts: Date.now(), data }
    return { ok: true, loggedIn: true, ...data }
  }

  const sessionPublic = () => {
    loadState()
    const loggedIn = state.accessToken !== ''
    const info = isObj(state.accountInfo) ? state.accountInfo : null
    const phoneHint = state.phone ? state.phone.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2') : ''
    const nick = info && (info.nickname || info.phone)
      ? String(info.nickname || info.phone)
      : phoneHint
    return {
      loggedIn,
      phone: phoneHint,
      phoneHint,
      nickname: nick,
      email: info ? asStr(info.email) : '',
      userType: state.userType,
      isEnterprise: state.userType === 'enterprise',
      tokenHint: maskSecret(state.accessToken),
      uid: state.uid || null,
    }
  }

  const fetchUnread = async () => {
    if (!state.accessToken) return { ok: true, unread: 0, loggedIn: false }
    const r = await tosAuthed('pcweb/sys-messages/unread-count', {})
    if (!r.ok) return { ok: false, unread: 0, error: r.error, code: r.code }
    const data = isObj(r.data) ? r.data : {}
    return { ok: true, unread: Number(data.unreadCount ?? r.data) || 0 }
  }

  const fetchDriveUsage = async () => {
    if (!state.accessToken) return { ok: false, error: '未登录', loggedIn: false }
    const r = await cloudPost('file/home', {})
    if (!r.ok) {
      return { ok: false, error: r.error || '云盘空间读取失败', loggedIn: true, code: r.code }
    }
    const usage = normalizeDriveUsage(r.data)
    if (!usage) return { ok: false, error: '云盘返回格式异常', loggedIn: true }
    return { ok: true, usage }
  }

  const paginate = (url, defaults) => {
    const page = Number(url.searchParams.get('page') || defaults.page) || defaults.page
    const size = Number(url.searchParams.get('size') || defaults.size) || defaults.size
    return { page: Math.max(1, page), size: Math.min(100, Math.max(1, size)) }
  }

  // ---------------------------------------------------------------------
  // AI创作 (pcweb/creation/*) + 我的云盘-AI作品 (pcweb/clouddisk/file/ai-assets)
  // ---------------------------------------------------------------------

  /** Anonymous generation-model catalog, cached briefly (it is a public list). */
  let creationModelsCache = null
  /** Poll cadence; `TOKENPLAN_BILL_POLL_MS` shortens it for tests and probes. */
  const creationPollMs = Number(process.env.TOKENPLAN_BILL_POLL_MS) > 0
    ? Number(process.env.TOKENPLAN_BILL_POLL_MS)
    : CREATION_POLL_INTERVAL_MS
  const fetchCreationModels = async (force) => {
    if (!force && creationModelsCache && Date.now() - creationModelsCache.at < 5 * 60_000) {
      return creationModelsCache.list
    }
    const r = await tosRequest('pcweb/creation/models', {}, { noAuth: true })
    if (!r.ok) return []
    const list = (Array.isArray(r.data) ? r.data : []).map(normalizeCreationModel).filter(Boolean)
    if (list.length) creationModelsCache = { at: Date.now(), list }
    return list
  }

  /** Newest-first page of raw creation rows (both template types unless filtered). */
  const fetchCreationRows = async (params) => {
    const r = await tosAuthed('pcweb/creation/tasks', { page: 1, size: 50, ...params })
    if (!r.ok) return { ok: false, error: r.error || '创作任务拉取失败', code: r.code }
    const data = isObj(r.data) ? r.data : {}
    const rows = Array.isArray(data.data) ? data.data
      : (Array.isArray(data.list) ? data.list : (Array.isArray(r.data) ? r.data : []))
    return { ok: true, rows, total: Number(data.total) || rows.length }
  }

  /** Locate one task by id; the site has no single-task endpoint. */
  const findCreationTask = async (taskId) => {
    const r = await fetchCreationRows({ page: 1, size: 50 })
    if (!r.ok) return r
    const row = r.rows.find((candidate) => isObj(candidate) && String(candidate.taskId) === String(taskId))
    return { ok: true, task: row ? normalizeCreationTask(row) : null }
  }

  /**
   * Submit a generation task and wait for it to settle.
   *
   * `pcweb/creation/submit` does not reliably return the new task id (the site
   * itself ignores the response), so the caller snapshots the task list first
   * and then watches for the new row — matched by `taskId` novelty plus the
   * prompt/model pair, which makes a concurrent submission by the same account
   * unable to steal the result.
   */
  const submitAndAwait = async (payload, options = {}) => {
    const before = await fetchCreationRows({ templateType: payload.templateType, page: 1, size: 50 })
    const known = new Set(before.ok ? before.rows.map((row) => String(row.taskId)) : [])

    const submitted = await tosAuthed('pcweb/creation/submit', payload)
    if (!submitted.ok) {
      return { ok: false, error: submitted.error || '提交生成任务失败', code: submitted.code }
    }
    const inlineId = asStr(isObj(submitted.data) ? (submitted.data.taskId || submitted.data.id) : submitted.data)

    const deadline = Date.now() + (Number(options.timeoutMs) || CREATION_POLL_TIMEOUT_MS)
    const signal = options.signal
    let last = null
    while (Date.now() < deadline) {
      if (signal && signal.aborted) return { ok: false, error: '已取消', aborted: true }
      await delay(Number(options.intervalMs) || CREATION_POLL_INTERVAL_MS, signal)
      const page = await fetchCreationRows({ templateType: payload.templateType, page: 1, size: 50 })
      if (!page.ok) { last = null; continue }
      const fresh = page.rows
        .map(normalizeCreationTask)
        .filter(Boolean)
        .filter((task) => !known.has(task.id))
        .filter((task) => (inlineId && task.id === inlineId)
          || (!inlineId && task.model === asStr(payload.modelName) && task.prompt === asStr(payload.prompt)))
      if (!fresh.length) continue
      const task = fresh[0]
      last = task
      if (task.status === 'succeeded' || task.status === 'success') {
        return { ok: true, task, timedOut: false }
      }
      if (!task.pending && task.status !== 'succeeded') {
        return { ok: false, error: task.error || ('生成失败（' + (task.status || 'unknown') + '）'), task }
      }
    }
    return { ok: false, error: '生成超时，任务可能仍在后台执行', task: last, timedOut: true }
  }

  /** Multipart upload of one reference asset; returns the object key. */
  const creationUpload = async (bytes, name, contentType) => {
    loadState()
    if (!state.accessToken) return { ok: false, error: '未登录' }
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: contentType }), name)
    let res
    try {
      res = await fetchWithTimeout(TOS_BASE + 'pcweb/creation/upload', {
        method: 'POST',
        headers: {
          'ri-pay-channel': payChannel(),
          accessToken: state.accessToken,
          accept: 'application/json, text/plain, */*',
        },
        body: form,
      }, UPLOAD_TIMEOUT_MS)
    } catch (err) {
      return { ok: false, error: '参考素材上传失败: ' + String((err && err.message) || err) }
    }
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* non-JSON upstream */ }
    const unwrapped = unwrapResponse(json)
    if (!unwrapped.ok) return { ok: false, error: unwrapped.error || '参考素材上传失败', code: unwrapped.code }
    const data = isObj(unwrapped.data) ? unwrapped.data : {}
    const filePath = asStr(data.filePath || data.url || (typeof unwrapped.data === 'string' ? unwrapped.data : ''))
    if (!filePath) return { ok: false, error: '上传未返回文件路径' }
    return { ok: true, filePath, fileName: asStr(data.fileName) || name }
  }

  /** Sign one cloud-drive object name into a temporary download URL. */
  const signDriveObject = async (objectName) => {
    const key = cleanMediaUrl(objectName)
    if (!key) return ''
    if (/^https?:\/\//i.test(key)) return key
    const r = await cloudPost('file/download/url', { objectName: key })
    if (!r.ok) return ''
    return typeof r.data === 'string' ? asStr(r.data) : asStr(isObj(r.data) ? (r.data.url || r.data.downloadUrl) : '')
  }

  /** 我的云盘 → AI作品 page (`pcweb/clouddisk/file/ai-assets`). */
  const fetchDriveAiAssets = async (options = {}) => {
    const kind = asStr(options.kind).toLowerCase()
    const type = kind === 'image' ? 'photo' : kind === 'video' ? 'video' : kind === 'file' ? 'doc' : ''
    const params = { pageNum: 1, pageSize: Number(options.size) || GALLERY_FETCH_SIZE }
    if (type) params.type = type
    const r = await cloudPost('file/ai-assets', params)
    if (!r.ok) {
      return {
        ok: false,
        error: r.error || 'AI作品拉取失败',
        code: r.code,
        loggedIn: !isAuthErrorCode(r.code),
        items: [],
        total: 0,
      }
    }
    const norm = normalizeAiAssetPage(r.data)
    const items = await Promise.all(norm.items.map(async (item) => {
      const url = await signDriveObject(item.key)
      return {
        ...item,
        url: url || item.url,
        thumb: url || item.url,
        pending: false,
      }
    }))
    return { ok: true, items, total: norm.total, counts: norm.counts }
  }

  /** 生成记录 page, mapped to gallery items. */
  const fetchGalleryTasks = async (options = {}) => {
    const kind = asStr(options.kind).toLowerCase()
    const templateType = kind === 'image' ? 'IMAGE' : kind === 'video' ? 'VIDEO' : ''
    const params = { page: 1, size: Number(options.size) || GALLERY_FETCH_SIZE }
    if (templateType) params.templateType = templateType
    const r = await fetchCreationRows(params)
    if (!r.ok) return { ok: false, error: r.error, code: r.code, items: [], total: 0 }
    return { ok: true, items: r.rows.map(normalizeCreationTask).filter(Boolean), total: r.total }
  }

  /** Last path segment of an object key or media URL — the work's file name. */
  const galleryLeaf = (value) => {
    const raw = cleanMediaUrl(value)
    if (!raw) return ''
    const bare = raw.split('?')[0].split('#')[0]
    // Decode BEFORE splitting: an OSS object key arrives percent-encoded, so
    // `%2F` separators only become real path separators after decoding.
    let decoded = bare
    try { decoded = decodeURIComponent(bare) } catch { decoded = bare }
    return (decoded.split('/').filter(Boolean).pop() || '').toLowerCase()
  }

  /**
   * Collapse the same generation seen through both sources.
   *
   * URL equality alone is not enough: the drive row carries the durable object
   * key and a freshly signed URL, while the task row carries whatever the
   * creation backend returned — for some models a short-lived OSS STS link whose
   * path *does* end in the same object name. Those two must still be one entry,
   * or the gallery shows the archived copy next to an expired one.
   */
  const dedupeGallery = (items) => {
    const out = []
    const seenUrls = new Set()
    const seenTitles = new Set()
    const seenDriveLeaves = new Set()
    // Drive rows win: they carry the durable object key and the archive copy.
    const ordered = [...items].sort((a, b) => (a.source === 'drive' ? -1 : 0) - (b.source === 'drive' ? -1 : 0))
    for (const item of ordered) {
      const url = cleanMediaUrl(item.url)
      if (url && seenUrls.has(url)) continue
      const title = asStr(item.title)
      if (!url && title && item.kind !== 'file' && seenTitles.has(item.kind + '|' + title)) continue
      const leaf = galleryLeaf(item.source === 'drive' ? item.key : (url || (Array.isArray(item.urls) ? item.urls[0] : '')))
      // A task row whose file name is already archived in the drive is the same work.
      if (item.source !== 'drive' && leaf && seenDriveLeaves.has(leaf)) continue
      if (url) seenUrls.add(url)
      if (title) seenTitles.add(item.kind + '|' + title)
      if (item.source === 'drive' && leaf) seenDriveLeaves.add(leaf)
      out.push(item)
    }
    return out
  }

  /**
   * Validate and translate one panel/tool submission into the exact body the
   * AI创作 pages post to `pcweb/creation/submit`.
   */
  const buildCreationSubmission = async (input) => {
    const raw = isObj(input) ? input : {}
    const kind = asStr(raw.kind).toLowerCase() === 'video' ? 'video' : 'image'
    const prompt = asStr(raw.prompt)
    if (!prompt) return { ok: false, status: 400, error: '请填写提示词' }

    const models = await fetchCreationModels()
    const wanted = asStr(raw.model)
    const model = want => {
      const pool = models.filter(want)
      if (wanted) return pool.find((m) => m.id === wanted) || null
      return pool[0] || null
    }
    const chosen = wanted
      ? models.find((m) => m.id === wanted) || null
      : (kind === 'video' ? model((m) => m.kind === 'video') : model((m) => m.kind === 'image'))
    if (!chosen) {
      return { ok: false, status: 400, error: wanted ? ('未知模型: ' + wanted) : (kind === 'video' ? '没有可用的视频模型' : '没有可用的图片模型') }
    }
    if (chosen.kind !== kind) {
      return { ok: false, status: 400, error: '模型 ' + chosen.id + ' 不支持' + (kind === 'video' ? '视频' : '图片') + '生成' }
    }

    const references = normalizeReferenceFiles(raw.referenceFiles)
    const payload = { modelName: chosen.id, prompt, templateType: kind === 'video' ? 'VIDEO' : 'IMAGE' }

    if (kind === 'video') {
      // An explicit, supported mode wins; otherwise mirror the site and infer
      // it from whatever reference material the caller supplied.
      const mode = VIDEO_MODES.includes(asStr(raw.videoMode))
        ? asStr(raw.videoMode)
        : deriveVideoMode(references)
      payload.videoMode = mode
      payload.ratio = pickFrom(raw.ratio, chosen.ratios, '16:9')
      payload.duration = pickDuration(raw.duration, chosen.durations)
      const resolution = pickFrom(raw.resolution, chosen.resolutions, chosen.resolutions[0] || '720p')
      payload.resolution = resolution
      payload.resolutionLabel = asStr(raw.resolutionLabel) || resolution
      payload.watermark = raw.watermark === true
    } else {
      payload.ratio = pickFrom(raw.ratio, chosen.ratios, '1:1')
      const count = Math.max(1, Math.min(Number(chosen.maxImages) || 4, Number(raw.imageCount) || 1))
      payload.imageCount = count
      payload.watermark = raw.watermark === true
      const resolution = asStr(raw.resolution)
      if (resolution) {
        payload.resolution = resolution
        payload.resolutionLabel = asStr(raw.resolutionLabel) || resolution
      }
    }

    const negative = asStr(raw.negativePrompt)
    if (negative) payload.negativePrompt = negative
    if (references.length) payload.referenceFiles = references
    if (raw.layerSplit === true) payload.layerSplit = true

    const cost = creationCost(chosen, { duration: payload.duration, imageCount: payload.imageCount })
    return {
      ok: true,
      payload,
      model: chosen,
      cost,
      summary: {
        kind,
        model: chosen.id,
        prompt,
        ratio: payload.ratio,
        resolution: payload.resolution || '',
        duration: payload.duration || null,
        imageCount: payload.imageCount || null,
        referenceCount: references.length,
        videoMode: payload.videoMode || null,
        estimatedCost: cost,
      },
    }
  }

  /** Validate the untrusted `referenceFiles` array from a panel/tool caller. */
  const normalizeReferenceFiles = (value) => {
    if (!Array.isArray(value)) return []
    const allowed = new Set(['reference', 'first_frame', 'last_frame', 'audio', 'file', 'url', 'video'])
    const out = []
    for (const entry of value) {
      if (!isObj(entry)) continue
      const url = cleanMediaUrl(entry.url)
      if (!url) continue
      const type = asStr(entry.type) || 'reference'
      out.push({ type: allowed.has(type) ? type : 'reference', url })
    }
    return out
  }

  /** Pick an allowed option, preferring the caller's value when it is legal. */
  const pickFrom = (value, allowed, fallback) => {
    const wanted = asStr(value)
    if (wanted && Array.isArray(allowed) && allowed.includes(wanted)) return wanted
    if (Array.isArray(allowed) && allowed.length) return allowed.includes(fallback) ? fallback : allowed[0]
    return wanted || fallback
  }

  const pickDuration = (value, allowed) => {
    const wanted = Number(value)
    if (Number.isFinite(wanted) && wanted > 0 && Array.isArray(allowed) && allowed.includes(wanted)) return wanted
    if (Array.isArray(allowed) && allowed.length) return allowed[0]
    return Number.isFinite(wanted) && wanted > 0 ? wanted : 5
  }

  const delay = (ms, signal) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (timer && typeof timer.unref === 'function') timer.unref()
    if (signal && typeof signal.addEventListener === 'function') {
      const onAbort = () => { clearTimeout(timer); resolve() }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })

  /**
   * Route table: [method, path (relative to the plugin prefix), handler].
   * A handler receives `{ req, res, url, body }` and returns a JSON payload,
   * optionally as `{ status, body }`.
   */
  const routes = [
    ['GET', '/manifest', async () => {
      loadState()
      const session = sessionPublic()
      let unread = 0
      let drive = null
      if (session.loggedIn) {
        const [u, d] = await Promise.all([
          fetchUnread().catch(() => null),
          fetchDriveUsage().catch(() => null),
        ])
        if (u && u.ok) unread = u.unread
        if (d && d.ok) drive = d.usage
      }
      return { ok: true, version: PKG_VERSION, session, unread, drive }
    }],

    ['POST', '/auth/sms', async ({ body }) => {
      const phone = asStr(body.phone)
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return { status: 400, body: { ok: false, error: '手机号格式不正确' } }
      }
      const r = await hyywGet('rights-interests-sdk/login/sendLoginSMSCode', { phone }, { auth: false })
      if (!r.ok) {
        return { status: 502, body: { ok: false, error: r.error || '发送失败', upstream: r.raw } }
      }
      return { ok: true, message: '验证码已发送' }
    }],

    ['POST', '/auth/login', async ({ body }) => {
      const phone = asStr(body.phone)
      const smscode = asStr(body.smscode)
      const type = asStr(body.type) === 'enterprise' ? 'enterprise' : 'personal'
      if (!/^1[3-9]\d{9}$/.test(phone) || smscode.length < 4) {
        return { status: 400, body: { ok: false, error: '请填写手机号和验证码' } }
      }
      const r = await hyywFormPost('rights-interests-sdk/login/login', { phone, smscode, type }, { auth: false })
      const data = r.data
      if (!r.ok || !isObj(data)) {
        return { status: 502, body: { ok: false, error: r.error || '登录失败', upstream: r.raw } }
      }
      const access = asStr(data.access_token || data.accessToken)
      const refresh = asStr(data.refresh_token || data.refreshToken)
      if (!access) {
        return { status: 502, body: { ok: false, error: '登录响应缺少 access_token', upstream: r.raw } }
      }
      state.accessToken = access
      state.refreshToken = refresh
      state.uid = asStr(data.uid)
      state.phone = phone
      state.userType = type
      state.accountInfo = null
      state.cloud = null
      saveState()
      dashCache = null
      // best-effort account detail
      try {
        const u = await tosAuthed('pcweb/user/detail', {})
        if (u.ok && isObj(u.data)) {
          state.accountInfo = u.data
          saveState()
        }
      } catch { /* account detail is optional */ }
      let modelSync = null
      try {
        // Seed provider + key on login; do not reset an existing default model.
        modelSync = await syncHuashuModel({ setDefault: false, applyToSessions: false })
      } catch (err) {
        modelSync = { ok: false, error: String((err && err.message) || err) }
      }
      return { ok: true, session: sessionPublic(), modelSync }
    }],

    ['POST', '/auth/logout', async () => {
      loadState()
      clearAuth()
      return { ok: true, session: sessionPublic() }
    }],

    ['GET', '/dashboard', async ({ url, res }) => {
      const days = url.searchParams.get('range') === '30' ? 30 : 7
      const data = await fetchDashboard(days)
      const status = data.ok ? 200 : (data.loggedIn === false ? 401 : 502)
      return { status, body: data }
    }],

    ['GET', '/models', async ({ res }) => {
      if (!requireAuth(res)) return undefined
      const [catalog, keyRes] = await Promise.all([
        fetchCatalogModels(),
        resolvePlatformApiKey(),
      ])
      if (!catalog.ok) {
        return { status: 502, body: { ok: false, error: catalog.error, loggedIn: true } }
      }
      const configured = readConfiguredHuashu()
      return {
        ok: true,
        endpoint: HUASHU_BASE_URL,
        provider: HUASHU_PROVIDER_ID,
        displayName: HUASHU_DISPLAY_NAME,
        models: catalog.models,
        total: catalog.total,
        configured: configured.models,
        defaultModel: configured.defaultModel,
        seedModel: HUASHU_MODEL_ID,
        apiKeyAvailable: !!keyRes.ok,
        apiKeyError: keyRes.ok ? null : keyRes.error,
        apiKeyHint: keyRes.ok ? maskSecret(keyRes.apiKey) : '',
      }
    }],

    ['GET', '/models/gateway', async ({ res }) => {
      if (!requireAuth(res)) return undefined
      const keyRes = await resolvePlatformApiKey()
      if (!keyRes.ok) {
        return { status: 502, body: { ok: false, error: keyRes.error, loggedIn: true } }
      }
      const fetched = await fetchGatewayModels(keyRes.apiKey)
      if (!fetched.ok) {
        return { status: 502, body: { ok: false, error: fetched.error || '模型列表失败', loggedIn: true } }
      }
      return {
        ok: true,
        endpoint: HUASHU_BASE_URL,
        models: fetched.models,
        configured: readConfiguredHuashu().models,
      }
    }],

    ['POST', '/model/sync', async ({ body, res }) => {
      if (!requireAuth(res)) return undefined
      const modelIds = Array.isArray(body.modelIds)
        ? body.modelIds
        : (asStr(body.modelId) ? [asStr(body.modelId)] : [])
      const modelNames = isObj(body.modelNames) ? body.modelNames : undefined
      let modelSync = null
      try {
        modelSync = await syncHuashuModel({
          modelIds,
          modelNames,
          setDefault: body.setDefault === true,
          applyToSessions: body.applyToSessions === true,
        })
      } catch (err) {
        modelSync = { ok: false, error: String((err && err.message) || err) }
      }
      return {
        status: modelSync?.ok ? 200 : 502,
        body: { ok: !!modelSync?.ok, modelSync },
      }
    }],

    ['POST', '/model/refresh-catalog', async () => {
      try {
        const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
        const configured = readConfiguredHuashu()
        if (settings && typeof settings.update === 'function' && configured.models.length) {
          // Nudge displayName so dsh-llm-pi-ai re-registers the route.
          const patch = huashuProviderPatch(configured.models)
          patch.providers[HUASHU_PROVIDER_ID].displayName = HUASHU_DISPLAY_NAME + '\u200b'
          await settings.update('llm-pi-ai', patch)
          patch.providers[HUASHU_PROVIDER_ID].displayName = HUASHU_DISPLAY_NAME
          await settings.update('llm-pi-ai', patch)
        }
        if (typeof ctx.emit === 'function') {
          ctx.emit('llm/adapters-updated')
          ctx.emit('settings/document-updated', 'llm-pi-ai', Date.now())
        }
        return { ok: true, message: '已通知聊天刷新模型目录' }
      } catch (err) {
        return { status: 500, body: { ok: false, error: String((err && err.message) || err) } }
      }
    }],

    ['GET', '/debug/llm-catalog', async () => {
      const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
      if (!llm || typeof llm.listProviders !== 'function') {
        return { status: 503, body: { ok: false, error: 'llm 服务不可用' } }
      }
      try {
        const providers = llm.listProviders()
        const groups = []
        const failures = []
        for (const p of providers) {
          try {
            const models = await llm.listModels(p.id)
            const detailed = []
            for (const m of models) {
              try {
                const info = typeof llm.resolveModelInfo === 'function'
                  ? await llm.resolveModelInfo(p.id, m.id)
                  : m
                detailed.push({ id: m.id, name: m.name, resolvedName: info && info.name, ok: true })
              } catch (err) {
                detailed.push({
                  id: m.id,
                  name: m.name,
                  ok: false,
                  error: String((err && err.message) || err),
                })
              }
            }
            groups.push({ id: p.id, name: p.name, models: detailed, allOk: detailed.every((d) => d.ok) })
          } catch (err) {
            failures.push({ id: p.id, name: p.name, error: String((err && err.message) || err) })
          }
        }
        return {
          ok: true,
          providers: providers.map((p) => ({ id: p.id, name: p.name })),
          groups,
          failures,
          configured: readConfiguredHuashu(),
        }
      } catch (err) {
        return { status: 500, body: { ok: false, error: String((err && err.message) || err) } }
      }
    }],

    ['GET', '/packages', async ({ url, res }) => {
      if (!requireAuth(res)) return undefined
      const renewalType = asStr(url.searchParams.get('renewalType')) || '2'
      const r = await hyywAuthed('changShi-member-sdk/wasuAI/token/queryPackageList', { renewalType })
      if (!r.ok) {
        const status = isAuthErrorCode(r.code) ? 401 : 502
        return { status, body: { ok: false, error: r.error || '套餐拉取失败', loggedIn: status !== 401 } }
      }
      const rows = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.data) ? r.data.data : [])
      const list = rows.filter(isObj).map((pkg) => ({
        ...pkg,
        features: packageFeatures(pkg),
        promoTitle: parsePromotionPoints(pkg.promotionPoints).title,
        priceValue: packagePrice(pkg),
      }))
      return {
        ok: true,
        renewalType,
        isEnterprise: state.userType === 'enterprise',
        canBuyBoost: state.userType !== 'enterprise',
        list,
      }
    }],

    ['GET', '/keys', async ({ res }) => {
      if (!requireAuth(res)) return undefined
      const r = await tosAuthed('pcweb/keys/list', {})
      if (!r.ok) {
        const status = isAuthErrorCode(r.code) ? 401 : 502
        return { status, body: { ok: false, error: r.error || '密钥列表失败', loggedIn: status !== 401 } }
      }
      const list = Array.isArray(r.data) ? r.data.map(maskKeyRow) : []
      return { ok: true, list, endpoint: HUASHU_BASE_URL }
    }],

    ['POST', '/keys/create', async ({ body, res }) => {
      if (!requireAuth(res)) return undefined
      const keyName = asStr(body.keyName)
      if (!keyName) return { status: 400, body: { ok: false, error: '请输入密钥名称' } }
      if (keyName.length > 30) return { status: 400, body: { ok: false, error: '密钥名称最长 30 个字符' } }
      const r = await tosAuthed('pcweb/keys/create', { keyName })
      return r.ok
        ? { ok: true, data: r.data }
        : { status: 502, body: { ok: false, error: r.error || '创建失败' } }
    }],

    ['POST', '/keys/delete', async ({ body, res }) => {
      if (!requireAuth(res)) return undefined
      const keyId = asStr(body.keyId)
      if (!keyId) return { status: 400, body: { ok: false, error: '缺少 keyId' } }
      const r = await tosAuthed('pcweb/keys/delete', { keyId })
      return r.ok ? { ok: true } : { status: 502, body: { ok: false, error: r.error || '删除失败' } }
    }],

    ['POST', '/keys/status', async ({ body, res }) => {
      if (!requireAuth(res)) return undefined
      const keyId = asStr(body.keyId)
      const action = asStr(body.action).toUpperCase() === 'DISABLED' ? 'DISABLED' : 'ENABLED'
      if (!keyId) return { status: 400, body: { ok: false, error: '缺少 keyId' } }
      const r = await tosAuthed('pcweb/keys/status', { keyId, action })
      return r.ok ? { ok: true } : { status: 502, body: { ok: false, error: r.error || '状态更新失败' } }
    }],

    // New in the rewrite: 重置密钥 (old key is invalidated immediately).
    ['POST', '/keys/reset', async ({ body, res }) => {
      if (!requireAuth(res)) return undefined
      const keyId = asStr(body.keyId)
      if (!keyId) return { status: 400, body: { ok: false, error: '缺少 keyId' } }
      const r = await tosAuthed('pcweb/keys/update', { keyId })
      return r.ok
        ? { ok: true, data: r.data }
        : { status: 502, body: { ok: false, error: r.error || '重置失败' } }
    }],

    ['GET', '/credits', async ({ url, res }) => {
      if (!requireAuth(res)) return undefined
      const { page, size } = paginate(url, { page: 1, size: 10 })
      const [credit, orders] = await Promise.all([
        tosAuthed('pcweb/credit/detail', {}),
        tosAuthed('pcweb/orders/list', { page, size }),
      ])
      if (!credit.ok) {
        const status = isAuthErrorCode(credit.code) ? 401 : 502
        return { status, body: { ok: false, error: credit.error || '积分详情失败', loggedIn: status !== 401 } }
      }
      const orderData = isObj(orders.data) ? orders.data : {}
      return {
        ok: true,
        credit: isObj(credit.data) ? credit.data : {},
        orders: {
          list: Array.isArray(orderData.list) ? orderData.list : [],
          total: Number(orderData.total) || 0,
          page,
          size,
        },
      }
    }],

    ['GET', '/orders', async ({ url, res }) => {
      if (!requireAuth(res)) return undefined
      const { page, size } = paginate(url, { page: 1, size: 10 })
      const r = await hyywAuthed('changShi-member-sdk/wasuAI/token/queryOrderList', {
        pageNum: String(page),
        pageSize: String(size),
      })
      if (!r.ok) {
        const status = isAuthErrorCode(r.code) ? 401 : 502
        return { status, body: { ok: false, error: r.error || '订单拉取失败', loggedIn: status !== 401 } }
      }
      const data = isObj(r.data) ? r.data : {}
      return {
        ok: true,
        list: Array.isArray(data.list) ? data.list : [],
        total: Number(data.total) || 0,
        page: Number(data.pageNum) || page,
        size: Number(data.pageSize) || size,
      }
    }],

    ['GET', '/logs', async ({ url, res }) => {
      if (!requireAuth(res)) return undefined
      const { page, size } = paginate(url, { page: 1, size: 10 })
      const startTime = asStr(url.searchParams.get('startTime'))
      const endTime = asStr(url.searchParams.get('endTime'))
      const params = { page, size }
      if (startTime) params.startTime = startTime
      if (endTime) params.endTime = endTime
      const r = await tosAuthed('pcweb/logs/list', params)
      if (!r.ok) {
        const status = isAuthErrorCode(r.code) ? 401 : 502
        return { status, body: { ok: false, error: r.error || '使用记录失败', loggedIn: status !== 401 } }
      }
      const data = isObj(r.data) ? r.data : {}
      return {
        ok: true,
        list: Array.isArray(data.data) ? data.data : (Array.isArray(data.list) ? data.list : []),
        total: Number(data.total) || 0,
        page: Number(data.page) || page,
        size: Number(data.size) || size,
      }
    }],

    ['GET', '/messages', async ({ url, res }) => {
      if (!requireAuth(res)) return undefined
      const { page, size } = paginate(url, { page: 1, size: 10 })
      const params = { page, size }
      const readStatus = url.searchParams.get('readStatus')
      if (readStatus === '0' || readStatus === '1') params.readStatus = Number(readStatus)
      const sortBy = asStr(url.searchParams.get('sortBy'))
      if (sortBy) params.sortBy = sortBy
      const sortOrder = asStr(url.searchParams.get('sortOrder'))
      if (sortOrder) params.sortOrder = sortOrder
      const r = await tosAuthed('pcweb/sys-messages/list', params)
      if (!r.ok) {
        const status = isAuthErrorCode(r.code) ? 401 : 502
        return { status, body: { ok: false, error: r.error || '消息拉取失败', loggedIn: status !== 401 } }
      }
      const data = isObj(r.data) ? r.data : {}
      const list = Array.isArray(data.data) ? data.data
        : (Array.isArray(data.rows) ? data.rows : (Array.isArray(data.list) ? data.list : []))
      return {
        ok: true,
        list: list.map((row) => (isObj(row) ? { ...row, typeLabel: messageTypeLabel(row.msgType) } : row)),
        total: Number(data.total) || 0,
        page,
        size,
      }
    }],

    ['GET', '/messages/unread', async () => fetchUnread()],

    ['POST', '/messages/read', async ({ body, res }) => {
      if (!requireAuth(res)) return undefined
      const ids = Array.isArray(body.ids) ? body.ids.filter((v) => v !== null && v !== undefined) : []
      const r = await tosAuthed('pcweb/sys-messages/read', { ids })
      return r.ok ? { ok: true } : { status: 502, body: { ok: false, error: r.error || '标记已读失败' } }
    }],

    ['GET', '/drive', async () => {
      const r = await fetchDriveUsage()
      if (!r.ok) return { status: r.loggedIn === false ? 401 : 502, body: r }
      return r
    }],

    ['GET', '/creation/models', async () => {
      const r = await tosRequest('pcweb/creation/models', {}, { noAuth: true })
      if (!r.ok) return { status: 502, body: { ok: false, error: r.error || '创作模型拉取失败' } }
      const list = (Array.isArray(r.data) ? r.data : []).map(normalizeCreationModel).filter(Boolean)
      if (list.length) creationModelsCache = { at: Date.now(), list }
      return { ok: true, list }
    }],

    ['GET', '/creation/tasks', async ({ url, res }) => {
      if (!requireAuth(res)) return undefined
      const { page, size } = paginate(url, { page: 1, size: 12 })
      const params = { page, size }
      const status = asStr(url.searchParams.get('status'))
      if (status) params.status = status
      const templateType = asStr(url.searchParams.get('templateType')).toUpperCase()
      if (templateType === 'IMAGE' || templateType === 'VIDEO') params.templateType = templateType
      const r = await tosAuthed('pcweb/creation/tasks', params)
      if (!r.ok) {
        const s = isAuthErrorCode(r.code) ? 401 : 502
        return { status: s, body: { ok: false, error: r.error || '创作任务拉取失败', loggedIn: s !== 401 } }
      }
      const data = isObj(r.data) ? r.data : {}
      const list = Array.isArray(data.data) ? data.data
        : (Array.isArray(data.list) ? data.list : (Array.isArray(r.data) ? r.data : []))
      return {
        ok: true,
        list: list.map(normalizeCreationTask).filter(Boolean),
        total: Number(data.total) || list.length,
        page,
        size,
      }
    }],

    ['GET', '/creation/task', async ({ url, res }) => {
      if (!requireAuth(res)) return undefined
      const taskId = asStr(url.searchParams.get('taskId') || url.searchParams.get('id'))
      if (!taskId) return { status: 400, body: { ok: false, error: '缺少 taskId' } }
      const found = await findCreationTask(taskId)
      if (!found.ok) {
        const s = isAuthErrorCode(found.code) ? 401 : 502
        return { status: s, body: { ok: false, error: found.error || '任务查询失败', loggedIn: s !== 401 } }
      }
      if (!found.task) return { status: 404, body: { ok: false, error: '未找到该任务' } }
      return { ok: true, task: found.task }
    }],

    ['POST', '/creation/submit', async ({ body, res }) => {
      if (!requireAuth(res)) return undefined
      const built = await buildCreationSubmission(body)
      if (!built.ok) return { status: built.status || 400, body: { ok: false, error: built.error } }
      const r = await tosAuthed('pcweb/creation/submit', built.payload)
      if (!r.ok) {
        const s = isAuthErrorCode(r.code) ? 401 : 502
        return { status: s, body: { ok: false, error: r.error || '提交生成任务失败', loggedIn: s !== 401 } }
      }
      return { ok: true, submitted: true, request: built.summary, result: isObj(r.data) ? r.data : (r.data ?? null) }
    }],

    ['POST', '/creation/optimize-prompt', async ({ body, res }) => {
      if (!requireAuth(res)) return undefined
      const prompt = asStr(body.prompt)
      if (!prompt) return { status: 400, body: { ok: false, error: '请先填写提示词' } }
      const r = await tosAuthed('pcweb/creation/optimize-prompt', {
        prompt,
        templateType: asStr(body.kind).toLowerCase() === 'video' ? 'VIDEO' : 'IMAGE',
      })
      if (!r.ok) return { status: 502, body: { ok: false, error: r.error || '提示词优化失败' } }
      const data = r.data
      const text = typeof data === 'string' ? data : asStr(isObj(data) ? (data.prompt || data.result || data.content) : '')
      return { ok: true, prompt: text || prompt }
    }],

    ['POST', '/creation/task-delete', async ({ body, res }) => {
      if (!requireAuth(res)) return undefined
      const id = asStr(body.taskId || body.id)
      if (!id) return { status: 400, body: { ok: false, error: '缺少 taskId' } }
      const r = await tosAuthed('pcweb/creation/task-delete', { taskId: id })
      if (!r.ok) return { status: 502, body: { ok: false, error: r.error || '删除任务失败' } }
      return { ok: true }
    }],

    /**
     * Reference-material upload. The site posts a plain multipart body to the
     * `creation/upload` path with only the account token as a header — no TOS
     * envelope, no signature, no CSRF — and gets back an object key
     * (`result.filePath`) that later travels inside `referenceFiles`.
     */
    ['POST', '/creation/upload', async ({ body, res }) => {
      if (!requireAuth(res)) return undefined
      const decoded = decodeBase64Payload(body.data)
      if (!decoded.ok) return { status: 400, body: { ok: false, error: decoded.error } }
      const bytes = decoded.bytes
      if (bytes.length > MAX_UPLOAD_BYTES) {
        return { status: 413, body: { ok: false, error: '文件过大（上限 ' + formatBytes(MAX_UPLOAD_BYTES) + '）' } }
      }
      const name = asStr(body.name) || 'reference'
      const r = await creationUpload(bytes, name, asStr(body.contentType) || guessContentType(name))
      if (!r.ok) return { status: 502, body: { ok: false, error: r.error || '参考素材上传失败' } }
      return { ok: true, filePath: r.filePath, fileName: r.fileName, size: bytes.length }
    }],

    /**
     * Merged gallery feed. Two sources with different shapes and auth families
     * are flattened into one item list so the conversation-view gallery (and
     * the panel) never need to know which upstream answered:
     *   - `drive`  我的云盘-AI作品 (`pcweb/clouddisk/file/ai-assets`, cloud family)
     *   - `tasks`  生成记录 (`pcweb/creation/tasks`, logged-in pcweb family)
     */
    ['GET', '/gallery', async ({ url, res }) => {
      if (!requireAuth(res)) return undefined
      const kind = asStr(url.searchParams.get('kind')).toLowerCase()
      const source = asStr(url.searchParams.get('source')).toLowerCase()
      const { page, size } = paginate(url, { page: 1, size: 24 })

      const wantDrive = source === '' || source === 'all' || source === 'drive'
      const wantTasks = source === '' || source === 'all' || source === 'tasks'

      const [driveRes, tasksRes] = await Promise.all([
        wantDrive ? fetchDriveAiAssets({ kind, size: GALLERY_FETCH_SIZE }) : Promise.resolve(null),
        wantTasks ? fetchGalleryTasks({ kind, size: GALLERY_FETCH_SIZE }) : Promise.resolve(null),
      ])

      const items = []
      const sources = {}
      if (driveRes) {
        sources.drive = { ok: driveRes.ok, error: driveRes.error || '', total: driveRes.total || 0, counts: driveRes.counts || null }
        if (driveRes.ok) items.push(...driveRes.items)
      }
      if (tasksRes) {
        sources.tasks = { ok: tasksRes.ok, error: tasksRes.error || '', total: tasksRes.total || 0 }
        if (tasksRes.ok) items.push(...tasksRes.items.map(creationTaskToGalleryItem).filter(Boolean))
      }

      const filtered = items.filter((item) => !kind || kind === 'all' || item.kind === kind)
      // Drive items and task items can describe the same generation once the
      // cloud has archived it; keep the drive row (it carries the durable key).
      const deduped = dedupeGallery(filtered)
      deduped.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

      const loggedOut = !wantDrive && !wantTasks
      const start = (page - 1) * size
      return {
        ok: true,
        items: deduped.slice(start, start + size),
        total: deduped.length,
        page,
        size,
        counts: {
          all: deduped.length,
          image: deduped.filter((i) => i.kind === 'image').length,
          video: deduped.filter((i) => i.kind === 'video').length,
          file: deduped.filter((i) => i.kind === 'file').length,
          pending: deduped.filter((i) => i.pending).length,
        },
        sources,
        loggedOut,
      }
    }],

    ['GET', '/prefs', async () => {
      loadState()
      return { ok: true, prefs: state.prefs || {} }
    }],

    ['POST', '/prefs', async ({ body }) => {
      loadState()
      state.prefs = { ...state.prefs, ...sanitizePrefs(body && body.prefs) }
      saveState()
      return { ok: true, prefs: state.prefs }
    }],
  ]

  /** Live sessions we may switch onto the newly added model (best-effort). */
  async function listLiveSessionIds(context, sessionCtrl) {
    if (!sessionCtrl) return []
    try {
      if (typeof sessionCtrl.list === 'function') {
        const value = await sessionCtrl.list({}, undefined)
        const items = Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : [])
        const ids = items
          .map((row) => (isObj(row) ? (row.sessionId ?? row.id) : row))
          .filter((id) => id !== undefined && id !== null)
        if (ids.length) return ids
      }
    } catch (err) {
      if (context.logger && typeof context.logger.warn === 'function') {
        context.logger.warn('tokenplan-bill: session list failed: %s', String((err && err.message) || err))
      }
    }
    try {
      const agents = typeof context.get === 'function' ? context.get('agents') : undefined
      const list = agents && (typeof agents.roots === 'function' ? agents.roots() : (typeof agents.list === 'function' ? agents.list() : null))
      if (Array.isArray(list)) {
        return list.map((a) => (isObj(a) ? (a.id ?? a.sessionId) : a)).filter((id) => id !== undefined && id !== null)
      }
    } catch { /* agent discovery is best-effort */ }
    return []
  }

  const BASE = '/dsh-tokenplan-bill'
  const table = new Map(routes.map(([method, path, handler]) => [method + ' ' + path, handler]))

  const serve = async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://x')
      const rest = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname
      const handler = table.get(String(req.method).toUpperCase() + ' ' + rest)
      if (!handler) {
        writeJson(res, { ok: false, error: 'not found' }, 404)
        return
      }
      const body = req.method === 'POST' ? await readBody(req) : {}
      // Every route may read the session (directly or via a fetcher), and the
      // state file is loaded lazily on first use: guarantee it is loaded before
      // any handler runs, so the first request after a restart is not answered
      // as "未登录" while a valid session sits on disk.
      loadState()
      const out = await handler({ req, res, url, body })
      if (out === undefined || res.writableEnded) return
      if (isObj(out) && (out.status !== undefined || out.body !== undefined)) {
        writeJson(res, out.body ?? { ok: true }, out.status || 200)
      } else {
        writeJson(res, out)
      }
    } catch (err) {
      try {
        writeJson(res, { ok: false, error: String((err && err.message) || err) }, 500)
      } catch { /* response already gone */ }
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: BASE, handler: serve }), 'tokenplan-bill: routes')

  // ---------------------------------------------------------------------
  // Agent tools: generate_image / generate_video
  // ---------------------------------------------------------------------

  /**
   * Conversation reference material.
   *
   * DSH carries user uploads as durable content blocks on the human message:
   * `{ type: 'image', attachment: ImageAttachmentRef }` for rasters and
   * `{ type: 'file', attachment: FileAttachmentRef }` for verbatim files
   * (videos, audio). Explicit selectors win; otherwise every attachment of the
   * newest message that carries any is used, matching the reference plugin.
   */
  const collectConversationReferences = (agent, selectors = {}) => {
    const images = []
    const files = []
    const messages = agent && agent.session && typeof agent.session.deriveMessages === 'function'
      ? agent.session.deriveMessages()
      : []
    const wantedImages = Array.isArray(selectors.attachmentIds) ? new Set(selectors.attachmentIds.map(String)) : null
    const wantedFiles = Array.isArray(selectors.fileIds) ? new Set(selectors.fileIds.map(String)) : null
    if (wantedImages || wantedFiles) {
      for (const message of messages) {
        for (const block of (message && message.content) || []) {
          if (!isObj(block) || !isObj(block.attachment)) continue
          const id = String(block.attachment.attachmentId || '')
          if (block.type === 'image' && wantedImages && wantedImages.has(id)) images.push(block.attachment)
          if (block.type === 'file' && wantedFiles && wantedFiles.has(id)) files.push(block.attachment)
        }
      }
      return { images, files }
    }
    const newest = [...messages].reverse().find((message) => {
      if (!message || !Array.isArray(message.content)) return false
      return message.content.some((block) => isObj(block) && (block.type === 'image' || block.type === 'file'))
    })
    for (const block of (newest && newest.content) || []) {
      if (!isObj(block) || !isObj(block.attachment)) continue
      if (block.type === 'image') images.push(block.attachment)
      else if (block.type === 'file') files.push(block.attachment)
    }
    return { images, files }
  }

  const readImageBytes = async (ref) => {
    const stored = await ctx.attachments.readImage(ref)
    return { data: stored.data, name: asStr(ref.name) || 'reference.png', contentType: ref.mediaType || 'image/png' }
  }

  const readFileBytes = async (ref) => {
    const chunks = []
    let total = 0
    for await (const chunk of ctx.attachments.readFileStream(ref)) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
      total += bytes.byteLength
      if (total > MAX_UPLOAD_BYTES) throw new Error('对话附件过大，无法作为参考素材上传')
      chunks.push(bytes)
    }
    return {
      data: Buffer.concat(chunks.map((c) => Buffer.from(c))),
      name: asStr(ref.name) || 'reference',
      contentType: guessContentType(asStr(ref.name)),
    }
  }

  /** Upload every resolved conversation attachment and return `referenceFiles`. */
  const uploadConversationReferences = async (agent, selectors) => {
    if (!agent) return { ok: true, references: [], uploaded: 0, skipped: true }
    const { images, files } = collectConversationReferences(agent, selectors)
    if (!images.length && !files.length) return { ok: true, references: [], uploaded: 0 }
    const references = []
    for (const ref of images) {
      const asset = await readImageBytes(ref)
      const r = await creationUpload(asset.data, asset.name, asset.contentType)
      if (!r.ok) return { ok: false, error: r.error }
      references.push({ type: 'reference', url: r.filePath })
    }
    for (const ref of files) {
      const asset = await readFileBytes(ref)
      const r = await creationUpload(asset.data, asset.name, asset.contentType)
      if (!r.ok) return { ok: false, error: r.error }
      // Audio and video travel as distinct reference types; the site's video
      // page uses `audio` for audio tracks and `file` for video material.
      references.push({ type: guessReferenceType(asset.name, asset.contentType), url: r.filePath })
    }
    return { ok: true, references, uploaded: references.length }
  }

  /**
   * Turn settled task media into model-facing content. Every produced medium
   * that fits is committed as a DSH attachment and emitted as an `image`/`file`
   * content block, so the conversation renders it inline next to the call and
   * the model can look at it — the gallery is a separate, additional surface.
   */
  const renderCreationResult = async (label, task, signal) => {
    const blocks = [{
      type: 'text',
      text: [
        label + '完成' + (task.model ? '（' + task.model + '）' : ''),
        '任务: ' + task.id,
        task.urls.length ? '作品链接:\n' + task.urls.map((u) => '- ' + u).join('\n') : '（上游未返回可访问链接）',
        '提示词: ' + (task.prompt || '').slice(0, 300),
      ].join('\n'),
    }]
    if (!task.urls.length) return blocks
    let budget = MAX_RESULT_ATTACHMENT_BYTES
    for (const url of task.urls.slice(0, MAX_RESULT_ATTACHMENTS)) {
      if (budget <= 0) break
      try {
        const res = await fetchWithTimeout(url, { method: 'GET', signal }, MEDIA_FETCH_TIMEOUT_MS)
        if (!res.ok) continue
        const buffer = Buffer.from(await res.arrayBuffer())
        if (!buffer.byteLength || buffer.byteLength > budget) continue
        budget -= buffer.byteLength
        if (task.kind === 'image') {
          const attachment = await ctx.attachments.saveImage({
            data: new Uint8Array(buffer),
            mediaType: imageMediaTypeFrom(buffer) || 'image/png',
            name: 'tokenplan-' + task.id + '-' + (blocks.filter((b) => b.type === 'image').length + 1),
          })
          blocks.push({ type: 'image', attachment })
        } else {
          const attachment = await ctx.attachments.saveFile({
            data: new Uint8Array(buffer),
            name: 'tokenplan-' + task.id + guessExtension(url),
          })
          blocks.push({ type: 'file', attachment })
        }
      } catch { /* the URL stays in the text block either way */ }
    }
    return blocks
  }

  const toolOutputSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
      ok: { type: 'boolean', description: 'Whether the generation settled successfully.' },
      taskId: { type: 'string' },
      kind: { type: 'string' },
      model: { type: 'string' },
      prompt: { type: 'string' },
      status: { type: 'string' },
      urls: { type: 'array', items: { type: 'string' } },
      elapsedMs: { type: 'number' },
      error: { type: 'string' },
      content: {
        type: 'array',
        description: 'Model-facing result: the summary text plus one block per attached medium.',
        items: { type: 'object', additionalProperties: true },
      },
    },
  }

  /**
   * The registry derives the model-facing content from `output.render`, not from
   * the returned value's own shape — an empty projection is an empty tool
   * result. The media blocks are prepared asynchronously by `execute`, so they
   * travel through the canonical value and this pure projection lifts them out.
   */
  const renderToolContent = (_args, value) => {
    const content = value && Array.isArray(value.content) ? value.content : []
    if (content.length) return content
    return [{ type: 'text', text: (value && value.ok === false ? value.error : '') || '生成完成' }]
  }


  /**
   * Shared body for both generation tools: resolve conversation reference
   * material, submit, poll until settled, then attach the produced media.
   */
  const runGeneration = async (exec, kind, args) => {
    // Tools are dispatched by the registry, not through `serve()`, so the
    // lazy state load that every route gets for free must happen here too.
    loadState()
    if (!state.accessToken) return { ok: false, error: '华数 AI Store 未登录：请先在侧栏 AI Store 面板登录' }
    const prompt = asStr(args.prompt)
    if (!prompt) return { ok: false, error: 'prompt 不能为空' }

    const uploads = await uploadConversationReferences(exec.agent, {
      attachmentIds: args.source_attachment_ids,
      fileIds: args.source_file_ids,
    })
    if (!uploads.ok) return { ok: false, error: uploads.error }

    const references = normalizeReferenceFiles(uploads.references)
      .concat(normalizeReferenceFiles(Array.isArray(args.reference_urls)
        ? args.reference_urls.map((url) => ({ type: 'reference', url }))
        : []))

    const request = {
      kind,
      model: asStr(args.model),
      prompt,
      ratio: asStr(args.aspect_ratio || args.ratio),
      resolution: asStr(args.resolution),
      negativePrompt: asStr(args.negative_prompt),
      watermark: args.watermark === true,
      referenceFiles: references,
    }
    if (kind === 'video') {
      request.duration = Number(args.duration) || undefined
      request.videoMode = VIDEO_MODES.includes(asStr(args.mode)) ? asStr(args.mode) : deriveVideoMode(references)
    } else {
      request.imageCount = Number(args.image_count) || 1
      request.layerSplit = args.layer_split === true
    }

    const built = await buildCreationSubmission(request)
    if (!built.ok) return { ok: false, error: built.error }

    const startedAt = Date.now()
    const settled = await submitAndAwait(built.payload, {
      signal: exec.signal,
      intervalMs: creationPollMs,
      timeoutMs: kind === 'video' ? CREATION_POLL_TIMEOUT_MS : 5 * 60_000,
    })
    const elapsedMs = Date.now() - startedAt
    if (!settled.ok) {
      return {
        ok: false,
        error: settled.error,
        taskId: settled.task ? settled.task.id : '',
        status: settled.task ? settled.task.status : '',
        elapsedMs,
      }
    }
    const task = settled.task
    const content = await renderCreationResult(kind === 'video' ? '视频生成' : '图片生成', task, exec.signal)
    return {
      ok: true,
      content,
      value: {
        ok: true,
        taskId: task.id,
        kind: task.kind,
        model: task.model,
        prompt: task.prompt,
        status: task.status,
        urls: task.urls,
        elapsedMs,
        content,
      },
    }
  }

  /** Replayable client-facing summary of one settled generation call. */
  const toolPresentationMeta = (_args, value) => ({
    kind: asStr(value && value.kind),
    taskId: asStr(value && value.taskId),
    model: asStr(value && value.model),
    status: asStr(value && value.status),
    prompt: asStr(value && value.prompt).slice(0, 300),
    urls: Array.isArray(value && value.urls) ? value.urls.slice(0, 8) : [],
  })

  /**
   * Register one agent tool without letting a name clash take the whole plugin
   * down. Another installed generation plugin (e.g. dsh-image-gen) registers a
   * tool called `generate_image` too, and DSH's registry rejects the second one.
   */
  const registerTool = (definition) => {
    try {
      ctx.tools.register(definition)
    } catch (err) {
      if (ctx.logger && typeof ctx.logger.warn === 'function') {
        ctx.logger.warn('tokenplan-bill: tool "%s" not registered: %s', definition.name, String((err && err.message) || err))
      }
    }
    return () => {}
  }

  if (ctx.tools && typeof ctx.tools.register === 'function') {
    ctx.effect(() => registerTool({
      name: 'generate_image',
      description:
        'Generate an image through 华数 AI Store (AI创作-图片生成). Reference images the user attached to the conversation are picked up automatically and used as image-to-image references; pass source_attachment_ids to select specific ones. Every produced image is attached to the conversation and shown inline; it also lands in 我的云盘-AI作品 and in the conversation 画廊 tab. Do not call read/glob to look for the files.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', description: 'Image description / instruction. Required.' },
          model: { type: 'string', description: 'Optional model id from the 图片生成 catalog; the cheapest-capable default is used otherwise.' },
          aspect_ratio: { type: 'string', description: 'Aspect ratio such as 1:1, 16:9, 9:16, 3:4. Must be supported by the model.' },
          resolution: { type: 'string', description: 'Resolution label such as 1k, 1.5k, 2K, or an explicit W*H like 1024*1024.' },
          image_count: { type: 'integer', description: 'How many images to produce (default 1, capped by the model).' },
          negative_prompt: { type: 'string', description: 'What to avoid in the image.' },
          watermark: { type: 'boolean', description: 'Whether the provider should bake in a watermark (default false).' },
          layer_split: { type: 'boolean', description: 'Split the image into layers (models that advertise layer_split only; needs exactly one reference image).' },
          source_attachment_ids: { type: 'array', items: { type: 'string' }, description: 'Optional conversation image attachment ids to use as references, in order.' },
          reference_urls: { type: 'array', items: { type: 'string' }, description: 'Optional already-uploaded reference URLs.' },
        },
        required: ['prompt'],
      },
      output: {
        schema: toolOutputSchema,
        render: renderToolContent,
        presentationMeta: toolPresentationMeta,
      },
      async execute(args, exec) {
        const out = await runGeneration(exec, 'image', isObj(args) ? args : {})
        if (!out.ok) throw new Error(out.error)
        return out.value
      },
      presentCall(args) {
        return { card: 'generic', title: '生成图片', input: { prompt: asStr(isObj(args) ? args.prompt : '') } }
      },
    }), 'tokenplan-bill: generate_image tool')

    ctx.effect(() => registerTool({
      name: 'generate_video',
      description:
        'Generate a video through 华数 AI Store (AI创作-视频生成). Images, videos and audio the user attached to the conversation are uploaded automatically and become the reference material; the video mode is derived from them (text_to_video, image_to_video, first_last_frame, full_reference, file_upload) unless `mode` is given. Video rendering takes minutes. The produced video is attached to the conversation and shown inline; it also lands in 我的云盘-AI作品 and in the conversation 画廊 tab.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', description: 'Video description / instruction. Required.' },
          model: { type: 'string', description: 'Optional model id from the 视频生成 catalog.' },
          mode: { type: 'string', enum: VIDEO_MODES, description: 'Explicit video mode; omit to derive it from the attached reference material.' },
          aspect_ratio: { type: 'string', description: 'Aspect ratio such as 16:9, 9:16, 1:1.' },
          resolution: { type: 'string', description: 'Resolution label such as 480p, 720p, 1080p.' },
          duration: { type: 'integer', description: 'Clip length in seconds; must be one of the model durations.' },
          negative_prompt: { type: 'string', description: 'What to avoid in the video.' },
          watermark: { type: 'boolean', description: 'Whether the provider should bake in a watermark (default false).' },
          source_attachment_ids: { type: 'array', items: { type: 'string' }, description: 'Optional conversation image attachment ids to use, in order.' },
          source_file_ids: { type: 'array', items: { type: 'string' }, description: 'Optional conversation file attachment ids (video/audio) to use, in order.' },
          reference_urls: { type: 'array', items: { type: 'string' }, description: 'Optional already-uploaded reference URLs.' },
        },
        required: ['prompt'],
      },
      output: {
        schema: toolOutputSchema,
        render: renderToolContent,
        presentationMeta: toolPresentationMeta,
      },
      async execute(args, exec) {
        const out = await runGeneration(exec, 'video', isObj(args) ? args : {})
        if (!out.ok) throw new Error(out.error)
        return out.value
      },
      presentCall(args) {
        return { card: 'generic', title: '生成视频', input: { prompt: asStr(isObj(args) ? args.prompt : '') } }
      },
    }), 'tokenplan-bill: generate_video tool')
  }
}