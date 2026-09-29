/**
 * Host-half unit tests: TOS envelope protocol (apiVersion 4), response
 * unwrapping, catalog normalization and the panel-facing label helpers.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { apply } from '../lib/index.js'
import {
  flattenForSign,
  buildTosEnvelope,
  md5Hex,
  sortKeysDeep,
  maskSecret,
  maskApiKey,
  isAuthErrorCode,
  isSuccessCode,
  unwrapResponse,
  pickPlatformApiKey,
  isKeyEnabled,
  keyStatusLabel,
  huashuProviderPatch,
  modelRowsForProvider,
  prettyModelName,
  classifyModelKind,
  catalogModelKind,
  normalizeGatewayModels,
  normalizeCatalogModels,
  catalogPriceRows,
  parsePromotionPoints,
  packageFeatures,
  packagePrice,
  packageQrUrl,
  consoleUrl,
  packageTypeLabel,
  creditStatusLabel,
  settlementLabel,
  messageTypeLabel,
  formatBytes,
  normalizeDriveUsage,
  normalizeCreationTask,
  HUASHU_PROVIDER_ID,
  HUASHU_DISPLAY_NAME,
  HUASHU_BASE_URL,
  HUASHU_MODEL_ID,
  HUASHU_MODEL_NAME,
  CONSOLE_BASE_URL,
} from '../lib/index.js'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Hermetic state: never read (or write) the developer's real
 * `~/.dsh/tokenplan-bill-state.json`. Without this the route-surface tests
 * silently depend on whether the machine happens to be logged in.
 */
const HERMETIC_STATE = join(mkdtempSync(join(tmpdir(), 'tokenplan-host-')), 'state.json')
process.env.TOKENPLAN_BILL_STATE = HERMETIC_STATE
process.on('exit', () => { try { rmSync(HERMETIC_STATE, { force: true }) } catch { /* best effort */ } })

const DEFAULT_SECRET = 'fd0fbc3194ef00f5e132d8604ae04bf5'

/** Seed / clear the state file the plugin reads on first use. */
function seedState(value) {
  if (value === null) rmSync(HERMETIC_STATE, { force: true })
  else writeFileSync(HERMETIC_STATE, JSON.stringify(value), { mode: 0o600 })
}

/** Run `fn` with `globalThis.fetch` replaced by `stub`, always restoring it. */
async function withFetch(stub, fn) {
  const original = globalThis.fetch
  globalThis.fetch = stub
  try { return await fn() } finally { globalThis.fetch = original }
}

/**
 * Independent re-implementation of the site's sign algorithm (`kr` + `Or`),
 * written straight from the shipped bundle so a drift in our envelope shows up.
 */
function referenceSign(system, params, secret) {
  const sortDeep = (e) => {
    const keys = Object.keys(e).sort()
    const out = Array.isArray(e) ? [] : {}
    for (const k of keys) {
      const v = e[k]
      if (v instanceof Object && Object.keys(v).length) out[k] = sortDeep(v)
      else if (!(v instanceof Object)) out[k] = v
    }
    return out
  }
  const flatten = (input) => {
    if (input == null || !Object.keys(input).length) return ''
    const e = JSON.parse(JSON.stringify(input))
    delete e.sign
    const parts = []
    for (const r in e) {
      if (e[r] instanceof Object && Object.keys(e[r]).length) e[r] = JSON.stringify(sortDeep(e[r]))
      if (e[r] != null && e[r] !== '') {
        if (e[r] instanceof Object) {
          if (Object.keys(e[r]).length) parts.push(r + '=' + e[r])
        } else parts.push(r + '=' + e[r])
      }
    }
    parts.sort()
    return parts.join('||')
  }
  const s = flatten({ ...system })
  const p = flatten({ ...(params || {}) })
  const raw = p ? s + '||' + p + '||' + secret : s + '||' + secret
  return createHash('md5').update(raw, 'utf8').digest('hex')
}

describe('tos signing (site rewrite: apiVersion 4)', () => {
  it('sortKeysDeep sorts nested keys', () => {
    assert.deepEqual(sortKeysDeep({ b: 1, a: { d: 2, c: 3 } }), { a: { c: 3, d: 2 }, b: 1 })
  })

  it('flattenForSign skips empty sign and sorts', () => {
    const s = flattenForSign({ ts: 1, accessToken: 't', sign: '', clientId: 'c' })
    assert.equal(s, 'accessToken=t||clientId=c||ts=1')
  })

  it('emits apiVersion/signVersion 4 and the site client id', () => {
    const env = buildTosEnvelope({}, 'tok')
    assert.equal(env.system.clientId, 'wasu.client.web.df82951b6d545955')
    assert.equal(env.system.apiVersion, 4)
    assert.equal(env.system.signVersion, 4)
    assert.equal(env.system.accessToken, 'tok')
    assert.equal(env.system.sign.length, 32)
    assert.deepEqual(env.params, {})
  })

  it('omits accessToken (and accessKey) when empty, like the SPA envelope', () => {
    const env = buildTosEnvelope({ page: 1 })
    assert.ok(!Object.prototype.hasOwnProperty.call(env.system, 'accessToken'))
    assert.ok(!Object.prototype.hasOwnProperty.call(env.system, 'accessKey'))
    assert.deepEqual(env.params, { page: 1 })
  })

  it('carries an accessKey for cloud-drive calls', () => {
    const env = buildTosEnvelope({ p: 1 }, { accessKey: 'ak-1', secret: 'business' })
    assert.equal(env.system.accessKey, 'ak-1')
    assert.ok(!Object.prototype.hasOwnProperty.call(env.system, 'accessToken'))
  })

  it('signs exactly like the shipped SPA algorithm', () => {
    const cases = [
      [{}, 'tok', undefined, 'fd0fbc3194ef00f5e132d8604ae04bf5'],
      [{ page: 1, size: 100 }, '', undefined, 'fd0fbc3194ef00f5e132d8604ae04bf5'],
      [{ a: 1, nested: { z: 2, y: [1, 2] } }, 'tok', 'ak', 'fd0fbc3194ef00f5e132d8604ae04bf5'],
      [{ keyId: 12 }, '', 'ak', 'account-token-as-secret'],
    ]
    for (const [params, accessToken, accessKey, secret] of cases) {
      const env = buildTosEnvelope(params, { accessToken, accessKey, secret })
      const expected = referenceSign({ ...env.system }, env.params, secret)
      assert.equal(env.system.sign, expected, 'sign mismatch for ' + JSON.stringify(params))
    }
  })

  it('signs with the account token as cloud-drive business secret', () => {
    const env = buildTosEnvelope({ x: 1 }, { accessKey: 'ak', secret: 'JWT.TOKEN.VALUE' })
    const withDefaultSecret = referenceSign({ ...env.system }, env.params, 'fd0fbc3194ef00f5e132d8604ae04bf5')
    assert.notEqual(env.system.sign, withDefaultSecret)
    assert.equal(env.system.sign, referenceSign({ ...env.system }, env.params, 'JWT.TOKEN.VALUE'))
  })

  it('md5Hex is stable', () => {
    assert.equal(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72')
  })
})

describe('upstream response unwrapping', () => {
  it('accepts the rewritten { system, result } success envelope', () => {
    const r = unwrapResponse({ system: { code: '0', msg: 'success' }, result: { data: [1, 2] } })
    assert.equal(r.ok, true)
    assert.deepEqual(r.data, { data: [1, 2] })
  })

  it('accepts numeric and string success codes', () => {
    assert.equal(unwrapResponse({ system: { code: 0 }, result: 7 }).ok, true)
    assert.equal(unwrapResponse({ system: { code: 200 }, result: 7 }).ok, true)
    assert.equal(unwrapResponse({ code: '0', data: 7 }).ok, true)
  })

  it('reports the rewritten auth code 1103 as a failure with its message', () => {
    const r = unwrapResponse({ system: { code: '1103', msg: '授权校验失败' } })
    assert.equal(r.ok, false)
    assert.equal(r.code, '1103')
    assert.equal(r.error, '授权校验失败')
  })

  it('normalizes hyyw ret/retinfo payloads', () => {
    const ok = unwrapResponse({ ret: 0, retinfo: 'success', data: { list: [1] } })
    assert.equal(ok.ok, true)
    assert.deepEqual(ok.data, { list: [1] })
    const bad = unwrapResponse({ ret: 500, retinfo: '系统繁忙' })
    assert.equal(bad.ok, false)
    assert.equal(bad.error, '系统繁忙')
  })

  it('unwraps a nested retCode payload', () => {
    const ok = unwrapResponse({ code: 200, data: { retCode: '1000', retMsg: 'ok', list: [1] } })
    assert.equal(ok.ok, true)
    assert.equal(ok.data.retCode, '1000')
    // an envelope success code still validates the payload (legacy leniency)
    assert.equal(unwrapResponse({ code: 200, data: { retCode: '2001' } }).ok, true)
    const bad = unwrapResponse({ code: 500, data: { retCode: '2001', retMsg: '无权限' } })
    assert.equal(bad.ok, false)
    assert.equal(bad.error, '无权限')
    assert.equal(bad.code, '2001')
  })

  it('accepts bare arrays and rejects non-JSON', () => {
    assert.deepEqual(unwrapResponse([1, 2]).data, [1, 2])
    assert.equal(unwrapResponse('nope').ok, false)
  })

  it('classifies auth-expired codes the SPA refreshes on', () => {
    for (const code of [401, 1002, 14, 1103, '1103', '401']) {
      assert.equal(isAuthErrorCode(code), true, 'code ' + code)
    }
    assert.equal(isAuthErrorCode(0), false)
    assert.equal(isSuccessCode(0), true)
    assert.equal(isSuccessCode('200'), true)
    assert.equal(isSuccessCode('0000'), true)
    assert.equal(isSuccessCode(1103), false)
    assert.equal(isSuccessCode(undefined), false)
  })

  it('surfaces a non-zero hyyw business code with its message', () => {
    const r = unwrapResponse({ code: 601, msg: '无效的验证码', data: null })
    assert.equal(r.ok, false)
    assert.equal(r.error, '无效的验证码')
    assert.equal(r.code, 601)
  })

  it('accepts the observed hyyw success shape', () => {
    const r = unwrapResponse({
      code: 200,
      msg: '',
      data: { retCode: '1000', retMsg: '验证码发送成功' },
    })
    assert.equal(r.ok, true)
    assert.equal(r.data.retCode, '1000')
  })
})

describe('secret masking', () => {
  it('maskSecret hides the middle', () => {
    assert.equal(maskSecret('abcdefghijklmnop'), 'abcd…(16)')
    assert.equal(maskSecret('short'), 'sh…')
    assert.equal(maskSecret(''), '')
  })

  it('maskApiKey follows the site first8/last4 rule', () => {
    assert.equal(maskApiKey('sk-abcdefghijklmnop'), 'sk-abcde...mnop')
    assert.equal(maskApiKey('short'), '****')
    assert.equal(maskApiKey(''), '****')
  })
})

describe('api key helpers', () => {
  it('isKeyEnabled handles numeric and word statuses', () => {
    assert.equal(isKeyEnabled({ status: 1 }), true)
    assert.equal(isKeyEnabled({ status: 2 }), false)
    assert.equal(isKeyEnabled({ status: 'ENABLED' }), true)
    assert.equal(isKeyEnabled({ status: '启用' }), true)
    assert.equal(isKeyEnabled({}), true)
    assert.equal(isKeyEnabled({ status: 'DISABLED' }), false)
  })

  it('keyStatusLabel mirrors the site 启用/已停用 wording', () => {
    assert.equal(keyStatusLabel({ status: 1 }), '启用')
    assert.equal(keyStatusLabel({ status: 2 }), '已停用')
  })

  it('pickPlatformApiKey prefers default enabled key', () => {
    const key = pickPlatformApiKey([
      { keyName: 'other', apiKey: 'sk-other', status: 1 },
      { keyName: 'default', apiKey: 'sk-default', status: 1 },
      { keyName: 'dead', apiKey: 'sk-dead', status: 2 },
    ])
    assert.equal(key, 'sk-default')
  })

  it('pickPlatformApiKey prefers dsh-chat over an arbitrary enabled key', () => {
    assert.equal(pickPlatformApiKey([
      { keyName: 'other', apiKey: 'sk-other', status: 1 },
      { keyName: 'dsh-chat', apiKey: 'sk-dsh', status: 1 },
    ]), 'sk-dsh')
  })

  it('pickPlatformApiKey falls back when no enabled keys', () => {
    assert.equal(pickPlatformApiKey([{ name: 'x', apiKey: 'sk-x', status: 2 }]), 'sk-x')
    assert.equal(pickPlatformApiKey([]), '')
    assert.equal(pickPlatformApiKey(null), '')
  })
})

describe('model catalog helpers', () => {
  it('prettyModelName keeps versions readable', () => {
    assert.equal(prettyModelName('deepseek-v4.1-flash'), 'DeepSeek-V4.1-Flash')
    assert.equal(prettyModelName('deepseek-v4-flash'), 'DeepSeek-V4-Flash')
    assert.equal(prettyModelName('doubao-seedream-5.0-pro'), 'Doubao-Seedream-5.0-Pro')
    assert.equal(prettyModelName('fun-asr'), 'Fun-ASR')
    assert.equal(prettyModelName('MiniMax-M2.5'), 'MiniMax-M2.5')
    assert.equal(prettyModelName(''), '')
  })

  it('classifyModelKind buckets gateway rows', () => {
    assert.equal(classifyModelKind({ id: 'deepseek-v4.1-flash', supported_endpoint_types: ['openai'] }), 'chat')
    assert.equal(classifyModelKind({ id: 'doubao-seedream-5.0-pro', supported_endpoint_types: ['image-generation'] }), 'image')
    assert.equal(classifyModelKind({ id: 'wan2.7-t2v', supported_endpoint_types: ['openai-video'] }), 'video')
    assert.equal(classifyModelKind({ id: 'fun-asr', supported_endpoint_types: [] }), 'audio')
    assert.equal(classifyModelKind({ id: 'text-embedding-3' }), 'other')
    assert.equal(classifyModelKind(null), 'other')
  })

  it('catalogModelKind reads the platform modelType', () => {
    assert.equal(catalogModelKind('text', ''), 'chat')
    assert.equal(catalogModelKind('multimodal', ''), 'chat')
    assert.equal(catalogModelKind('image', ''), 'image')
    assert.equal(catalogModelKind('video', ''), 'video')
    assert.equal(catalogModelKind('audio', ''), 'audio')
    assert.equal(catalogModelKind('', '图片生成'), 'image')
    assert.equal(catalogModelKind('', '语音合成'), 'audio')
    assert.equal(catalogModelKind('weird', ''), 'other')
  })

  it('normalizeCatalogModels maps the 模型广场 payload', () => {
    const rows = normalizeCatalogModels({
      data: [{
        id: 128,
        modelName: 'deepseek-v4.1-flash',
        modelType: 'text',
        vendor: '百炼',
        capabilityTags: '深度思考,文本生成',
        operationBadges: ['hot', 'new'],
        billingType: '按Token量单价',
        inputQuotaPerTokens: 2000,
        outputQuotaPerTokens: 8000,
        status: 1,
      }, {
        id: 114,
        modelName: 'doubao-seedream-5.0-pro',
        modelType: 'image',
        capabilityTags: '图片生成',
        imageQuotaPerUnit: 300,
        operationBadges: [],
      }],
    })
    assert.equal(rows.length, 2)
    const chat = rows.find((r) => r.id === 'deepseek-v4.1-flash')
    assert.equal(chat.kind, 'chat')
    assert.equal(chat.selectable, true)
    assert.equal(chat.vendor, '百炼')
    assert.deepEqual(chat.badges, ['热门', '新上'])
    assert.deepEqual(chat.capabilities, ['深度思考', '文本生成'])
    assert.deepEqual(chat.price, [
      { label: '输入', value: '2,000积分/百万tokens' },
      { label: '输出', value: '8,000积分/百万tokens' },
    ])
    const image = rows.find((r) => r.id === 'doubao-seedream-5.0-pro')
    assert.equal(image.kind, 'image')
    assert.equal(image.selectable, false)
    assert.deepEqual(image.price, [{ label: '图片', value: '300积分/张' }])
  })

  it('catalogPriceRows skips zero and missing prices', () => {
    assert.deepEqual(catalogPriceRows({ inputQuotaPerTokens: 0, videoQuotaPerSecond: 6350 }), [
      { label: '视频', value: '6,350积分/秒' },
    ])
    assert.deepEqual(catalogPriceRows(null), [])
  })

  it('normalizeGatewayModels maps OpenAI-style rows', () => {
    const rows = normalizeGatewayModels({
      data: [{ id: HUASHU_MODEL_ID, supported_endpoint_types: ['openai'] }],
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].selectable, true)
    assert.equal(rows[0].name, 'DeepSeek-V4.1-Flash')
  })

  it('huashuProviderPatch targets the wasu-tokenplan route', () => {
    const patch = huashuProviderPatch([{ id: 'glm-5.3', name: 'GLM-5.3' }])
    const p = patch.providers[HUASHU_PROVIDER_ID]
    assert.equal(p.displayName, HUASHU_DISPLAY_NAME)
    assert.equal(p.baseURL, HUASHU_BASE_URL)
    assert.equal(p.apiKeyEnv, 'WASU_TOKENPLAN_API_KEY')
    assert.equal(p.api, 'openai-completions')
    assert.deepEqual(p.models, [{ id: 'glm-5.3', name: 'GLM-5.3' }])
  })

  it('modelRowsForProvider seeds the rewritten flagship model', () => {
    assert.deepEqual(modelRowsForProvider([]), [{ id: HUASHU_MODEL_ID, name: HUASHU_MODEL_NAME }])
    assert.equal(HUASHU_MODEL_ID, 'deepseek-v4.1-flash')
    assert.deepEqual(modelRowsForProvider(['glm-5.3']), [{ id: 'glm-5.3', name: 'GLM-5.3' }])
  })
})

describe('pricing helpers', () => {
  it('parsePromotionPoints reads the JSON blob and falls back to text', () => {
    assert.deepEqual(parsePromotionPoints('{"title":"限时特惠","detail":"赠 5 万积分"}'),
      { title: '限时特惠', detail: '赠 5 万积分' })
    assert.deepEqual(parsePromotionPoints('直接送积分'), { title: '直接送积分', detail: '' })
    assert.deepEqual(parsePromotionPoints(''), { title: '', detail: '' })
  })

  it('packageFeatures mirrors the official pricing page (yearly × 12)', () => {
    assert.deepEqual(packageFeatures({
      creditValue: 1000,
      renewalType: '1',
      packageValidDuration: '1年',
      promotionPoints: '{"title":"t","detail":"d"}',
    }), ['包含 12,000 积分', '积分有效期 1年', 'd'])
    assert.deepEqual(packageFeatures({ creditValue: 500, renewalType: '2' }), ['包含 500 积分'])
    assert.deepEqual(packageFeatures({ promotionPoints: 200 }), ['赠 200 积分'])
    assert.deepEqual(packageFeatures(null), [])
  })

  it('packagePrice prefers promoPrice then originalPrice', () => {
    assert.equal(packagePrice({ promoPrice: 99, originalPrice: 129 }), 99)
    assert.equal(packagePrice({ originalPrice: 129 }), 129)
    assert.equal(packagePrice({}), null)
  })

  it('packageQrUrl builds the site QR link including boost packages', () => {
    const url = packageQrUrl({ productId: 42, renewalType: '2' })
    assert.ok(url.startsWith('https://ups.wasu.cn/msm-local-biz/local/fission/getminiqrQr?url='))
    const detail = decodeURIComponent(url.split('url=')[1])
    assert.match(detail, /packageDetail\?id=42$/)
    const boost = decodeURIComponent(packageQrUrl({ productId: 42, renewalType: '-1', goodsDetailRelationId: 9 }).split('url=')[1])
    assert.match(boost, /goodsDetailRelationId=9$/)
    assert.equal(packageQrUrl({}), '')
  })

  it('consoleUrl targets the rewritten hash routes', () => {
    assert.equal(consoleUrl('workspace/apikeys'), CONSOLE_BASE_URL + '#/workspace/apikeys')
    assert.equal(consoleUrl('#/ai-gen/image'), CONSOLE_BASE_URL + '#/ai-gen/image')
  })
})

describe('label helpers', () => {
  it('maps rewritten enum labels', () => {
    assert.equal(packageTypeLabel('MONTHLY'), '包月')
    assert.equal(packageTypeLabel('CONTINUOUS_MONTHLY'), '连续包月')
    assert.equal(packageTypeLabel(''), '—')
    assert.equal(creditStatusLabel('COMPLETED'), '正常')
    assert.equal(creditStatusLabel('EXPIRED'), '过期')
    assert.equal(settlementLabel('ordered'), '充值')
    assert.equal(settlementLabel('settled'), '消费')
    assert.equal(messageTypeLabel('maint'), '系统维护')
    assert.equal(messageTypeLabel(''), '系统消息')
  })
})

describe('cloud drive helpers', () => {
  it('formatBytes scales units', () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(1024), '1 KB')
    assert.equal(formatBytes(1073741824), '1 GB')
    assert.equal(formatBytes(536870912), '512 MB')
    assert.equal(formatBytes('x'), '0 B')
  })

  it('normalizeDriveUsage turns file/home into panel numbers', () => {
    const usage = normalizeDriveUsage({
      total: 1073741824, used: 536870912, diskSpace: 536870912, albumSpace: 0, free: 536870912,
    })
    assert.equal(usage.percent, 50)
    assert.equal(usage.totalText, '1 GB')
    assert.equal(usage.filesText, '512 MB')
    assert.equal(usage.albumsText, '0 B')
    assert.equal(normalizeDriveUsage(null), null)
  })
})

describe('ai creation helpers', () => {
  it('normalizeCreationTask decodes JSON-encoded urls and params', () => {
    const task = normalizeCreationTask({
      taskId: 't1',
      templateType: 'VIDEO',
      status: 'succeeded',
      modelName: 'doubao-seedance-2.5',
      prompt: '一只猫在跑',
      resultUrls: '["`https://cdn/a.mp4`"]',
      paramsConfig: '{"ratio":"16:9","resolutionLabel":"1080p","duration":5}',
      createdTime: '2026-09-28 12:00:00',
    })
    assert.equal(task.kind, 'video')
    assert.deepEqual(task.urls, ['https://cdn/a.mp4'])
    assert.equal(task.cover, 'https://cdn/a.mp4')
    assert.equal(task.ratio, '16:9')
    assert.equal(task.resolution, '1080p')
    assert.equal(task.duration, '5')
    assert.equal(normalizeCreationTask(null), null)
  })

  it('normalizeCreationTask tolerates malformed payloads', () => {
    const task = normalizeCreationTask({ taskId: 9, resultUrls: 'not-json', paramsConfig: '{' })
    assert.deepEqual(task.urls, [])
    assert.equal(task.cover, '')
    assert.equal(task.kind, 'image')
  })
})
describe('host route surface (apply + webServer registration)', () => {
  /** A minimal IncomingMessage/ServerResponse pair for the plugin handler. */
  function makeReq(method, url, body) {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req = {
      method,
      url,
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk
      },
    }
    return req
  }
  function makeRes() {
    const res = {
      statusCode: 200,
      headers: null,
      body: '',
      writableEnded: false,
      writeHead(status, headers) {
        res.statusCode = status
        res.headers = headers
        return res
      },
      end(text) {
        res.body = text
        res.writableEnded = true
        return res
      },
    }
    return res
  }

  async function call(handler, method, url, body) {
    const res = makeRes()
    await handler(makeReq(method, url, body), res)
    let json = null
    try { json = JSON.parse(res.body) } catch { /* non-JSON */ }
    return { status: res.statusCode, headers: res.headers, body: res.body, json }
  }

  function bootHost() {
    const registered = []
    const effects = []
    const ctx = {
      get: () => undefined,
      effect: (fn, label) => { effects.push(label); const d = fn(); return d },
      emit: () => {},
      logger: { warn: () => {}, error: () => {} },
      webServer: {
        register(route) {
          registered.push(route)
          return () => {}
        },
      },
    }
    apply(ctx)
    assert.equal(registered.length, 1)
    assert.equal(registered[0].kind, 'prefix')
    assert.equal(registered[0].path, '/dsh-tokenplan-bill')
    return registered[0].handler
  }

  it('registers one prefix route and answers /manifest', async () => {
    const handler = bootHost()
    const r = await call(handler, 'GET', '/dsh-tokenplan-bill/manifest')
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.session.loggedIn, false)
    assert.equal(r.headers['cache-control'], 'no-store')
    assert.equal(typeof r.json.version, 'string')
  })

  it('rejects unauthenticated console reads with 401', async () => {
    const handler = bootHost()
    for (const path of ['/models', '/keys', '/dashboard', '/messages', '/drive', '/creation/tasks']) {
      const r = await call(handler, 'GET', '/dsh-tokenplan-bill' + path)
      assert.equal(r.status, 401, path)
      assert.equal(r.json.ok, false)
    }
  })

  it('validates login input before calling upstream', async () => {
    const handler = bootHost()
    const bad = await call(handler, 'POST', '/dsh-tokenplan-bill/auth/login', { phone: '123' })
    assert.equal(bad.status, 400)
    assert.match(bad.json.error, /手机号/)
    const sms = await call(handler, 'POST', '/dsh-tokenplan-bill/auth/sms', { phone: '123' })
    assert.equal(sms.status, 400)
  })

  it('answers unknown plugin paths with 404 JSON', async () => {
    const handler = bootHost()
    const r = await call(handler, 'GET', '/dsh-tokenplan-bill/nope')
    assert.equal(r.status, 404)
    assert.equal(r.json.ok, false)
  })

  it('treats a wrong method as not found', async () => {
    const handler = bootHost()
    const r = await call(handler, 'DELETE', '/dsh-tokenplan-bill/manifest')
    assert.equal(r.status, 404)
  })

  it('reports an unauthenticated unread count without failing', async () => {
    const handler = bootHost()
    const r = await call(handler, 'GET', '/dsh-tokenplan-bill/messages/unread')
    assert.equal(r.status, 200)
    assert.equal(r.json.unread, 0)
    assert.equal(r.json.loggedIn, false)
  })

  /**
   * The authenticated envelope, end to end through the route layer.
 *
 * Regression cover for the post-login bounce: signing a `pcweb/*` call with the
 * fixed default secret (instead of the account token) plus omitting the cloud
 * `accessKey`/CSRF made the gateway answer `1103 授权校验失败`, which the panel
 * read as "logged out" and threw the user back to the login form.
 */
describe('authenticated envelope (post-login session)', () => {
  const TOKEN = 'JWT.ACCOUNT.TOKEN'
  const ACCESS_KEY = 'cloud-access-key-64'
  const CSRF = 'cloud-csrf-64'

  const OK = (result) => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ system: { code: '0', msg: 'success' }, result }),
  })

  /**
   * Stub upstream: records every signed request and answers `pcweb/auth/init`
   * with the cloud pair, everything else from `replies`.
   */
  function makeUpstream(replies = {}) {
    const seen = []
    const stub = async (url, init) => {
      const path = String(url).replace('https://api-gateway.wasu.cn/tos/api/v1/open/', '')
      const envelope = JSON.parse(init.body)
      seen.push({ path, envelope, headers: init.headers })
      if (path === 'pcweb/auth/init') return OK({ accessKey: ACCESS_KEY, csrfToken: CSRF, uid: 'U1' })
      const reply = replies[path]
      if (typeof reply === 'function') return reply(seen.filter((s) => s.path === path).length)
      return OK(reply === undefined ? {} : reply)
    }
    return { stub, seen }
  }

  it('signs authenticated pcweb calls with the token and carries accessKey + CSRF', async () => {
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} })
    const { stub, seen } = makeUpstream({
      'pcweb/dashboard/overview': { availableQuota: 120, totalQuota: 200, usedQuota: 80, planName: 'Token Plan' },
      'pcweb/dashboard/daily-usage': [],
      'pcweb/dashboard/model-distribution': [],
      'pcweb/dashboard/top-models': [],
      'pcweb/user/detail': { nickname: '测试账号' },
    })
    const handler = bootHost()
    const r = await withFetch(stub, () => call(handler, 'GET', '/dsh-tokenplan-bill/dashboard'))
    assert.equal(r.status, 200, r.body)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.loggedIn, true)

    // `pcweb/auth/init` is the bootstrap: token in the system block, DEFAULT
    // secret, and deliberately no accessKey/CSRF (it is what mints them).
    const inits = seen.filter((s) => s.path === 'pcweb/auth/init')
    assert.equal(inits.length, 1, 'parallel dashboard reads must share one cloud bootstrap')
    assert.equal(inits[0].envelope.system.accessToken, TOKEN)
    assert.equal(inits[0].envelope.system.accessKey, undefined)
    assert.equal(inits[0].headers['X-CSRF-TOKEN'], undefined)
    assert.equal(inits[0].envelope.system.sign, referenceSign(inits[0].envelope.system, inits[0].envelope.params, DEFAULT_SECRET))

    const overview = seen.find((s) => s.path === 'pcweb/dashboard/overview')
    assert.ok(overview, 'overview must have been requested')
    assert.equal(overview.envelope.system.accessToken, TOKEN)
    assert.equal(overview.envelope.system.accessKey, ACCESS_KEY)
    assert.equal(overview.headers['X-CSRF-TOKEN'], CSRF)
    // The whole point: the sign secret is the ACCOUNT TOKEN, not the default.
    assert.equal(overview.envelope.system.sign, referenceSign(overview.envelope.system, overview.envelope.params, TOKEN))
    assert.notEqual(overview.envelope.system.sign, referenceSign(overview.envelope.system, overview.envelope.params, DEFAULT_SECRET))
    for (const row of seen.filter((s) => s.path !== 'pcweb/auth/init')) {
      assert.equal(row.envelope.system.accessKey, ACCESS_KEY, row.path)
      assert.equal(row.headers['X-CSRF-TOKEN'], CSRF, row.path)
      assert.equal(row.envelope.system.sign, referenceSign(row.envelope.system, row.envelope.params, TOKEN), row.path)
    }
    seedState(null)
  })

  it('re-bootstraps the cloud pair instead of reporting an expired session on 1103', async () => {
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', cloud: { accessKey: 'stale', csrf: 'stale', secret: TOKEN, at: Date.now() }, prefs: {} })
    let overviewCalls = 0
    const stub = async (url, init) => {
      const path = String(url).replace('https://api-gateway.wasu.cn/tos/api/v1/open/', '')
      const envelope = JSON.parse(init.body)
      if (path === 'pcweb/auth/init') return OK({ accessKey: ACCESS_KEY, csrfToken: CSRF, uid: 'U1' })
      if (path === 'pcweb/dashboard/overview') {
        overviewCalls += 1
        // The stale pair is rejected once; the refreshed pair then succeeds.
        if (envelope.system.accessKey === 'stale') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () => JSON.stringify({ system: { code: '1103', msg: '授权校验失败' }, result: null }),
          }
        }
        return OK({ availableQuota: 1, totalQuota: 2, usedQuota: 1 })
      }
      return OK([])
    }
    const handler = bootHost()
    const r = await withFetch(stub, () => call(handler, 'GET', '/dsh-tokenplan-bill/dashboard'))
    assert.equal(r.status, 200, r.body)
    assert.equal(r.json.loggedIn, true, 'a stale cloud pair must not log the user out')
    assert.equal(overviewCalls, 2, 'the call is retried once after re-bootstrapping')
    seedState(null)
  })

  it('keeps anonymous catalog reads on the default secret with no cloud bootstrap', async () => {
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} })
    const { stub, seen } = makeUpstream({ 'pcweb/creation/models': [] })
    const handler = bootHost()
    const r = await withFetch(stub, () => call(handler, 'GET', '/dsh-tokenplan-bill/creation/models'))
    assert.equal(r.status, 200, r.body)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].path, 'pcweb/creation/models')
    assert.equal(seen[0].envelope.system.accessToken, undefined)
    assert.equal(seen[0].envelope.system.accessKey, undefined)
    assert.equal(seen[0].envelope.system.sign, referenceSign(seen[0].envelope.system, seen[0].envelope.params, DEFAULT_SECRET))
    seedState(null)
  })

  it('signs cloud-drive calls with accessKey + token secret and no accessToken', async () => {
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} })
    const { stub, seen } = makeUpstream({ 'pcweb/clouddisk/file/home': { total: 100, used: 20, free: 80 } })
    const handler = bootHost()
    const r = await withFetch(stub, () => call(handler, 'GET', '/dsh-tokenplan-bill/drive'))
    assert.equal(r.status, 200, r.body)
    const drive = seen.find((s) => s.path.startsWith('pcweb/clouddisk/'))
    assert.ok(drive, 'cloud call must have been made')
    assert.equal(drive.headers['ri-pay-channel'], 'pcweb-yunpan')
    assert.equal(drive.envelope.system.accessToken, undefined)
    assert.equal(drive.envelope.system.accessKey, ACCESS_KEY)
    assert.equal(drive.headers['X-CSRF-TOKEN'], CSRF)
    assert.equal(drive.envelope.system.sign, referenceSign(drive.envelope.system, drive.envelope.params, TOKEN))
    seedState(null)
  })

  it('reports 登录已过期 only when the refresh token is also rejected', async () => {
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} })
    const stub = async (url, init) => {
      const path = String(url).replace('https://api-gateway.wasu.cn/tos/api/v1/open/', '')
      if (path.startsWith('pcweb/')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ system: { code: '1103', msg: '授权校验失败' }, result: null }),
        }
      }
      if (String(url).includes('refreshToken')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ code: 601, msg: '刷新失败', data: null }),
        }
      }
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => '{}' }
    }
    const handler = bootHost()
    const r = await withFetch(stub, () => call(handler, 'GET', '/dsh-tokenplan-bill/keys'))
    assert.equal(r.status, 401)
    assert.equal(r.json.error, '登录已过期')
    seedState(null)
  })

  it('reports 未登录 when there is no stored session at all', async () => {
    seedState(null)
    const handler = bootHost()
    const r = await call(handler, 'GET', '/dsh-tokenplan-bill/keys')
    assert.equal(r.status, 401)
    assert.equal(r.json.error, '未登录')
  })
  })
})
