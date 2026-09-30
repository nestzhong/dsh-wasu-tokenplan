/**
 * Host-half unit tests: TOS envelope protocol (apiVersion 4), response
 * unwrapping, catalog normalization and the panel-facing label helpers.
 */
import { afterEach, beforeEach, describe, it } from 'node:test'
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
  normalizeCreationModel,
  normalizeAiAsset,
  normalizeAiAssetPage,
  assetTime,
  creationTaskToGalleryItem,
  creationCost,
  isCreationPending,
  parseJsonField,
  cleanMediaUrl,
  guessReferenceType,
  guessContentType,
  guessExtension,
  imageMediaTypeFrom,
  fileExtension,
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
 * `~/.dsh/wasu-tokenplan-state.json`. Without this the route-surface tests
 * silently depend on whether the machine happens to be logged in.
 */
const HERMETIC_STATE = join(mkdtempSync(join(tmpdir(), 'wasu-tokenplan-host-')), 'state.json')
process.env.WASU_TOKENPLAN_STATE = HERMETIC_STATE
process.on('exit', () => { try { rmSync(HERMETIC_STATE, { force: true }) } catch { /* best effort */ } })

/**
 * `assetTime` renders epoch timestamps in the *local* timezone, exactly like the
 * site does. Pin the timezone so assertions on wall-clock strings do not drift
 * with the runner (CI is UTC, dev machines here are +08:00).
 */
process.env.TZ = 'Asia/Shanghai'

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
    assert.equal(registered[0].path, '/dsh-wasu-tokenplan')
    return registered[0].handler
  }

  it('registers one prefix route and answers /manifest', async () => {
    const handler = bootHost()
    const r = await call(handler, 'GET', '/dsh-wasu-tokenplan/manifest')
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.session.loggedIn, false)
    assert.equal(r.headers['cache-control'], 'no-store')
    assert.equal(typeof r.json.version, 'string')
  })

  it('rejects unauthenticated console reads with 401', async () => {
    const handler = bootHost()
    for (const path of ['/models', '/keys', '/dashboard', '/messages', '/drive', '/creation/tasks']) {
      const r = await call(handler, 'GET', '/dsh-wasu-tokenplan' + path)
      assert.equal(r.status, 401, path)
      assert.equal(r.json.ok, false)
    }
  })

  it('validates login input before calling upstream', async () => {
    const handler = bootHost()
    const bad = await call(handler, 'POST', '/dsh-wasu-tokenplan/auth/login', { phone: '123' })
    assert.equal(bad.status, 400)
    assert.match(bad.json.error, /手机号/)
    const sms = await call(handler, 'POST', '/dsh-wasu-tokenplan/auth/sms', { phone: '123' })
    assert.equal(sms.status, 400)
  })

  it('answers unknown plugin paths with 404 JSON', async () => {
    const handler = bootHost()
    const r = await call(handler, 'GET', '/dsh-wasu-tokenplan/nope')
    assert.equal(r.status, 404)
    assert.equal(r.json.ok, false)
  })

  it('treats a wrong method as not found', async () => {
    const handler = bootHost()
    const r = await call(handler, 'DELETE', '/dsh-wasu-tokenplan/manifest')
    assert.equal(r.status, 404)
  })

  it('reports an unauthenticated unread count without failing', async () => {
    const handler = bootHost()
    const r = await call(handler, 'GET', '/dsh-wasu-tokenplan/messages/unread')
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
    const r = await withFetch(stub, () => call(handler, 'GET', '/dsh-wasu-tokenplan/dashboard'))
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
    const r = await withFetch(stub, () => call(handler, 'GET', '/dsh-wasu-tokenplan/dashboard'))
    assert.equal(r.status, 200, r.body)
    assert.equal(r.json.loggedIn, true, 'a stale cloud pair must not log the user out')
    assert.equal(overviewCalls, 2, 'the call is retried once after re-bootstrapping')
    seedState(null)
  })

  it('keeps anonymous catalog reads on the default secret with no cloud bootstrap', async () => {
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} })
    const { stub, seen } = makeUpstream({ 'pcweb/creation/models': [] })
    const handler = bootHost()
    const r = await withFetch(stub, () => call(handler, 'GET', '/dsh-wasu-tokenplan/creation/models'))
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
    const r = await withFetch(stub, () => call(handler, 'GET', '/dsh-wasu-tokenplan/drive'))
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
    const r = await withFetch(stub, () => call(handler, 'GET', '/dsh-wasu-tokenplan/keys'))
    assert.equal(r.status, 401)
    assert.equal(r.json.error, '登录已过期')
    seedState(null)
  })

  it('reports 未登录 when there is no stored session at all', async () => {
    seedState(null)
    const handler = bootHost()
    const r = await call(handler, 'GET', '/dsh-wasu-tokenplan/keys')
    assert.equal(r.status, 401)
    assert.equal(r.json.error, '未登录')
  })
  })
})

/**
 * AI创作 (pcweb/creation/*) and 我的云盘-AI作品 (pcweb/clouddisk/file/ai-assets).
 */
describe('ai creation model catalog', () => {
  const ROW = {
    modelId: 96,
    modelName: 'doubao-seedream-5.0-pro',
    modelType: 'image',
    vendor: '豆包AI',
    modelIcon: 'https://cdn/icon.png',
    description: '图像创作模型',
    imageQuotaPerUnit: 300,
    modelParams: {
      resolutions: ['1k', '2K'],
      ratios: ['1:1', '16:9'],
      maxImages: 4,
      durations: [],
      capabilities: ['layer_split', 'smart_edit'],
      extraConfig: { supports_reference: true },
    },
  }

  it('normalizes the model row into generator form options', () => {
    const m = normalizeCreationModel(ROW)
    assert.equal(m.id, 'doubao-seedream-5.0-pro')
    assert.equal(m.kind, 'image')
    assert.equal(m.imagePrice, 300)
    assert.deepEqual(m.ratios, ['1:1', '16:9'])
    assert.deepEqual(m.resolutions, ['1k', '2K'])
    assert.equal(m.maxImages, 4)
    assert.equal(m.supports.layerSplit, true)
    assert.equal(m.supports.smartEdit, true)
    // A model that never advertises video support stays false, not undefined.
    assert.equal(m.supports.textToVideo, false)
  })

  it('reads video capability flags from either the boolean or the capability list', () => {
    const m = normalizeCreationModel({
      modelName: 'doubao-seedance-2.5',
      modelType: 'video',
      videoQuotaPerSecond: 6350,
      modelParams: { durations: [5, 10, 15], capabilities: ['text_to_video', 'image_to_video'], extraConfig: { supports_audio: 1 } },
    })
    assert.equal(m.kind, 'video')
    assert.equal(m.videoPrice, 6350)
    assert.deepEqual(m.durations, [5, 10, 15])
    assert.equal(m.supports.imageToVideo, true)
    assert.equal(m.supports.firstLastFrame, false)
    assert.equal(m.supports.audio, true)
  })

  it('drops rows without an id and prices images against a count', () => {
    assert.equal(normalizeCreationModel({ modelId: 1 }), null)
    assert.equal(normalizeCreationModel(null), null)
    const m = normalizeCreationModel(ROW)
    assert.equal(creationCost(m, { imageCount: 3 }), 900)
    assert.equal(creationCost(m, {}), 300, 'one image is the default')
    const v = normalizeCreationModel({ modelName: 'v', modelType: 'video', videoQuotaPerSecond: 6350, modelParams: {} })
    assert.equal(creationCost(v, { duration: 10 }), 63500)
  })
})

describe('ai creation task normalization', () => {
  it('prefers the permanent local copy over the signed remote URL', () => {
    const t = normalizeCreationTask({
      taskId: 'gen_1',
      templateType: 'VIDEO',
      status: 'succeeded',
      modelName: 'doubao-seedance-2.5',
      prompt: '一只猫在跑',
      resultUrls: '["https://dashscope.oss-accelerate.aliyuncs.com/a.mp4?Expires=1&Signature=x"]',
      localResultUrls: '["`https://file.smartlink.wasu.cn/group1/M00/a.mp4`"]',
      paramsConfig: '{"ratio":"16:9","resolutionLabel":"1080p","duration":5,"watermark":false}',
      createdTime: '2026-09-28 12:00:00',
    })
    assert.equal(t.kind, 'video')
    assert.deepEqual(t.urls, ['https://file.smartlink.wasu.cn/group1/M00/a.mp4'])
    assert.equal(t.cover, 'https://file.smartlink.wasu.cn/group1/M00/a.mp4')
    assert.equal(t.expiredRemote, false)
    assert.equal(t.localUrls.length, 1)
    assert.equal(t.ratio, '16:9')
    assert.equal(t.resolution, '1080p')
    assert.equal(t.duration, '5')
    assert.equal(t.watermark, false)
    assert.equal(t.pending, false)
    assert.deepEqual(t.media, [{ url: 'https://file.smartlink.wasu.cn/group1/M00/a.mp4', kind: 'video' }])
  })

  it('flags a row that only carries the expiring remote URL', () => {
    const t = normalizeCreationTask({ taskId: 'gen_2', resultUrls: '["https://x.aliyuncs.com/a.png"]' })
    assert.equal(t.expiredRemote, true)
    assert.deepEqual(t.urls, ['https://x.aliyuncs.com/a.png'])
  })

  it('marks in-flight tasks pending and surfaces the failure reason', () => {
    const running = normalizeCreationTask({ taskId: 'g3', status: 'processing', progress: '40%' })
    assert.equal(running.pending, true)
    assert.equal(running.progress, '40%')
    const failed = normalizeCreationTask({ taskId: 'g4', status: 'failed', errorMessageUser: '内容审核未通过' })
    assert.equal(failed.pending, false)
    assert.equal(failed.error, '内容审核未通过')
  })

  it('tolerates malformed payloads', () => {
    const t = normalizeCreationTask({ taskId: 9, resultUrls: 'not-json', paramsConfig: '{' })
    assert.deepEqual(t.urls, [])
    assert.equal(t.cover, '')
    assert.equal(t.kind, 'image')
    assert.equal(normalizeCreationTask(null), null)
    assert.equal(isCreationPending('SUCCEEDED'), false)
    assert.equal(isCreationPending('pending'), true)
  })

  it('projects a task onto the shared gallery item shape', () => {
    const item = creationTaskToGalleryItem(normalizeCreationTask({
      taskId: 'gen_5',
      status: 'succeeded',
      modelName: 'qwen-image-2.0-pro',
      prompt: '一只猫',
      localResultUrls: '["https://file.smartlink.wasu.cn/a.png"]',
      paramsConfig: '{"ratio":"1:1","imageCount":2}',
      createdTime: '2026-09-28 12:00:00',
    }))
    assert.equal(item.id, 'task:gen_5')
    assert.equal(item.source, 'tasks')
    assert.equal(item.kind, 'image')
    assert.equal(item.url, 'https://file.smartlink.wasu.cn/a.png')
    assert.equal(item.meta, '1:1 · 2张')
  })

  it('parses both pre-decoded and JSON-encoded fields', () => {
    assert.deepEqual(parseJsonField(['a'], []), ['a'])
    assert.deepEqual(parseJsonField('["a"]', []), ['a'])
    assert.deepEqual(parseJsonField('nope', []), [])
    assert.deepEqual(parseJsonField('', ['fallback']), ['fallback'])
    assert.equal(cleanMediaUrl('`https://x/a.png`'), 'https://x/a.png')
  })
})

describe('cloud-drive AI作品 rows', () => {
  it('decodes fileType into image/video/file and keeps the object key', () => {
    const image = normalizeAiAsset({
      fileId: 7,
      name: '创意图-01.png',
      fileType: 1,
      fileAddress: 'app/U1/20260930/ali/a.png',
      fileSize: 2_097_152,
      createTime: '2026-09-30 09:00:00',
    })
    assert.equal(image.id, 'asset:7')
    assert.equal(image.source, 'drive')
    assert.equal(image.kind, 'image')
    assert.equal(image.key, 'app/U1/20260930/ali/a.png')
    assert.equal(image.meta, '2 MB')
    assert.equal(image.title, '创意图-01.png')

    const video = normalizeAiAsset({ fileId: 8, fileType: 2, fileAddress: 'app/U1/v.mp4', videoTime: 12 })
    assert.equal(video.kind, 'video')
    assert.equal(video.duration, '12')

    const doc = normalizeAiAsset({ fileId: 9, fileType: 9, fileAddress: 'app/U1/d.pdf' })
    assert.equal(doc.kind, 'file')
    assert.equal(normalizeAiAsset(null), null)
  })

  it('turns the drive epoch timestamp into the same shape creation records use', () => {
    // Live rows carry epoch milliseconds; without this the merged gallery
    // compares "1790731602000" against "2026-09-30 09:00:00" and renders the
    // raw number as the item's time.
    const epoch = new Date(2026, 8, 30, 9, 26, 42).getTime()
    const item = normalizeAiAsset({ fileId: 7, fileType: 1, fileAddress: 'app/U1/a.png', createTime: epoch })
    assert.equal(item.createdAt, '2026-09-30 09:26:42')
    assert.equal(normalizeAiAsset({ fileId: 8, fileType: 1, fileAddress: 'app/U1/b.png', createTime: '2026-09-30 09:00:00' }).createdAt, '2026-09-30 09:00:00')
    assert.equal(normalizeAiAsset({ fileId: 9, fileType: 1, fileAddress: 'app/U1/c.png' }).createdAt, '')
    assert.equal(assetTime(1790731602), '2026-09-30 09:26:42')
  })

  it('normalizes the {counts, files:{list,total,pageNum}} envelope', () => {
    const page = normalizeAiAssetPage({
      counts: { doc: 1, photos: 2, videos: 3 },
      files: { pageNum: 1, total: 6, list: [{ fileId: 1, fileType: 1, fileAddress: 'a/b.png' }] },
    })
    assert.equal(page.items.length, 1)
    assert.equal(page.total, 6)
    assert.deepEqual(page.counts, { all: 6, image: 2, video: 3, file: 1 })
    const empty = normalizeAiAssetPage({ counts: { total: null, doc: 0, photos: 0, videos: 0 }, files: { pageNum: 1, total: 0, list: [] } })
    assert.deepEqual(empty.items, [])
    assert.equal(empty.total, 0)
  })
})

describe('reference material helpers', () => {
  it('classifies conversation attachments the way the AI创作 video page does', () => {
    assert.equal(guessReferenceType('a.png', 'image/png'), 'reference')
    assert.equal(guessReferenceType('clip.mp4', 'video/mp4'), 'file')
    assert.equal(guessReferenceType('song.mp3', ''), 'audio')
    assert.equal(guessReferenceType('mystery.bin', ''), 'reference')
    assert.equal(guessContentType('clip.mov'), 'video/quicktime')
    assert.equal(guessContentType('mystery.bin'), 'application/octet-stream')
    assert.equal(guessExtension('https://x/a.webm?x=1'), '.webm')
    assert.equal(guessExtension('https://x/noext'), '.mp4')
    assert.equal(fileExtension('a/b.PNG?v=2'), '.png')
  })

  it('sniffs raster media types from magic bytes', () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    assert.equal(imageMediaTypeFrom(png), 'image/png')
    assert.equal(imageMediaTypeFrom(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg')
    assert.equal(imageMediaTypeFrom(Buffer.from('GIF89a....')), 'image/gif')
    assert.equal(imageMediaTypeFrom(Buffer.from([1, 2, 3])), '')
  })
})

/**
 * Route-level cover for the creation/gallery surface: what the panel and the
 * generation tools actually put on the wire.
 */
describe('ai creation routes', () => {
  const TOKEN = 'JWT.ACCOUNT.TOKEN'
  const ACCESS_KEY = 'cloud-access-key-64'
  const CSRF = 'cloud-csrf-64'
  const IMAGE_MODEL = {
    modelName: 'doubao-seedream-5.0-pro',
    modelType: 'image',
    imageQuotaPerUnit: 300,
    modelParams: { ratios: ['1:1', '16:9'], resolutions: ['1k', '2K'], maxImages: 4, capabilities: [] },
  }
  const VIDEO_MODEL = {
    modelName: 'doubao-seedance-2.5',
    modelType: 'video',
    videoQuotaPerSecond: 6350,
    modelParams: { ratios: ['16:9'], resolutions: ['720p'], durations: [5, 10], capabilities: ['text_to_video', 'image_to_video'] },
  }

  const OK = (result) => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ system: { code: '0', msg: 'success' }, result }),
  })

  function makeUpstream(replies = {}) {
    const seen = []
    const stub = async (url, init) => {
      const path = String(url).replace('https://api-gateway.wasu.cn/tos/api/v1/open/', '')
      if (path === 'pcweb/creation/upload') {
        seen.push({ path, headers: init.headers, form: init.body })
        return OK({ fileName: 'ref.png', filePath: 'app/U1/20260930/ali/ref.png', mimeType: 'image/png' })
      }
      const envelope = JSON.parse(init.body)
      seen.push({ path, envelope, headers: init.headers })
      if (path === 'pcweb/auth/init') return OK({ accessKey: ACCESS_KEY, csrfToken: CSRF, uid: 'U1' })
      const reply = replies[path]
      if (typeof reply === 'function') return reply(seen.filter((s) => s.path === path))
      return OK(reply === undefined ? {} : reply)
    }
    return { stub, seen }
  }

  function bootHost(context = {}) {
    const registered = []
    const tools = []
    const ctx = {
      get: () => undefined,
      effect: (fn) => { fn(); return () => {} },
      emit: () => {},
      logger: { warn: () => {}, error: () => {} },
      webServer: { register(route) { registered.push(route); return () => {} } },
      tools: { register(definition) { tools.push(definition); return () => {} } },
      attachments: {
        readImage: async () => { throw new Error('no image') },
        readFileStream: async function * () {},
        saveImage: async () => ({ attachmentId: 'a1' }),
        saveFile: async () => ({ attachmentId: 'f1' }),
        ...context.attachments,
      },
    }
    apply(ctx)
    return { handler: registered[0].handler, tools }
  }

  const makeReq = (method, url, body) => ({
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    },
  })
  const makeRes = () => ({
    statusCode: 200, headers: null, body: '', writableEnded: false,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; return this },
    end(text) { this.body = text; this.writableEnded = true; return this },
  })
  const call = async (handler, method, path, body) => {
    const res = makeRes()
    await handler(makeReq(method, '/dsh-wasu-tokenplan' + path, body), res)
    let json = null
    try { json = JSON.parse(res.body) } catch { /* non-JSON */ }
    return { status: res.statusCode, json, body: res.body }
  }

  const LOGGED_IN = { accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} }

  it('registers both generation tools with the tool-registry contract', () => {
    const { tools } = bootHost()
    assert.deepEqual(tools.map((t) => t.name), ['generate_image', 'generate_video'])
    for (const tool of tools) {
      assert.equal(typeof tool.description, 'string')
      assert.equal(tool.parameters.type, 'object')
      assert.equal(tool.parameters.additionalProperties, false)
      assert.deepEqual(tool.parameters.required, ['prompt'])
      // The registry rejects a definition whose output lacks a render function.
      assert.equal(typeof tool.output.render, 'function')
      assert.equal(tool.output.schema.type, 'object')
      assert.equal(typeof tool.execute, 'function')
    }
    const video = tools[1]
    assert.ok(video.parameters.properties.mode.enum.includes('first_last_frame'))
    assert.ok(video.parameters.properties.source_file_ids, 'video tools accept conversation video/audio files')
  })

  it('survives a tool-name clash with another generation plugin', () => {
    // dsh-image-gen registers `generate_image` too; the registry rejects the
    // second definition. That must not take the console panel down with it.
    const warnings = []
    const registered = []
    const routes = []
    apply({
      get: () => undefined,
      effect: (fn) => { fn(); return () => {} },
      emit: () => {},
      logger: { warn: (...args) => warnings.push(args), error: () => {} },
      webServer: { register: (route) => { routes.push(route); return () => {} } },
      tools: { register: (definition) => { registered.push(definition.name); throw new Error('tool "' + definition.name + '" is already registered') } },
      attachments: { saveImage: async () => ({}), saveFile: async () => ({}) },
    })
    assert.deepEqual(registered, ['generate_image', 'generate_video'])
    assert.equal(routes.length, 1, 'the HTTP routes still register')
    assert.equal(warnings.length, 2)
    assert.match(String(warnings[0][0]), /not registered/)
  })

  it('maps an image submission onto the AI创作 payload', async () => {
    seedState(LOGGED_IN)
    const { stub, seen } = makeUpstream({ 'pcweb/creation/models': [IMAGE_MODEL, VIDEO_MODEL] })
    const { handler } = bootHost()
    const r = await withFetch(stub, () => call(handler, 'POST', '/creation/submit', {
      kind: 'image',
      model: 'doubao-seedream-5.0-pro',
      prompt: '一只猫',
      ratio: '16:9',
      resolution: '2K',
      imageCount: 2,
      watermark: true,
      negativePrompt: '模糊',
    }))
    assert.equal(r.status, 200, r.body)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.request.estimatedCost, 600)
    const submit = seen.find((s) => s.path === 'pcweb/creation/submit')
    assert.ok(submit, 'submit must reach the gateway page endpoint')
    assert.deepEqual(submit.envelope.params, {
      modelName: 'doubao-seedream-5.0-pro',
      prompt: '一只猫',
      templateType: 'IMAGE',
      ratio: '16:9',
      imageCount: 2,
      watermark: true,
      resolution: '2K',
      resolutionLabel: '2K',
      negativePrompt: '模糊',
    })
    seedState(null)
  })

  it('maps a video submission and derives the payload mode', async () => {
    seedState(LOGGED_IN)
    const { stub, seen } = makeUpstream({ 'pcweb/creation/models': [IMAGE_MODEL, VIDEO_MODEL] })
    const { handler } = bootHost()
    const r = await withFetch(stub, () => call(handler, 'POST', '/creation/submit', {
      kind: 'video',
      prompt: '日落延时',
      videoMode: 'image_to_video',
      duration: 10,
      referenceFiles: [{ type: 'reference', url: 'app/U1/ref.png' }, { type: 'bogus', url: 'app/U1/x.png' }, { url: '' }],
    }))
    assert.equal(r.status, 200, r.body)
    assert.equal(r.json.request.estimatedCost, 63500)
    const submit = seen.find((s) => s.path === 'pcweb/creation/submit')
    assert.equal(submit.envelope.params.templateType, 'VIDEO')
    assert.equal(submit.envelope.params.videoMode, 'image_to_video')
    assert.equal(submit.envelope.params.duration, 10)
    assert.equal(submit.envelope.params.ratio, '16:9', 'falls back to a model-supported ratio')
    assert.equal(submit.envelope.params.resolution, '720p')
    // Unknown reference types degrade to `reference`, empty urls are dropped.
    assert.deepEqual(submit.envelope.params.referenceFiles, [
      { type: 'reference', url: 'app/U1/ref.png' },
      { type: 'reference', url: 'app/U1/x.png' },
    ])
    seedState(null)
  })

  it('rejects a prompt-less submission and a model/kind mismatch before calling upstream', async () => {
    seedState(LOGGED_IN)
    const { stub, seen } = makeUpstream({ 'pcweb/creation/models': [IMAGE_MODEL, VIDEO_MODEL] })
    const { handler } = bootHost()
    await withFetch(stub, async () => {
      const empty = await call(handler, 'POST', '/creation/submit', { kind: 'image', prompt: '  ' })
      assert.equal(empty.status, 400)
      assert.match(empty.json.error, /提示词/)
      const mismatch = await call(handler, 'POST', '/creation/submit', {
        kind: 'video', model: 'doubao-seedream-5.0-pro', prompt: 'x',
      })
      assert.equal(mismatch.status, 400)
      assert.match(mismatch.json.error, /不支持视频/)
      const unknown = await call(handler, 'POST', '/creation/submit', { kind: 'image', model: 'nope', prompt: 'x' })
      assert.equal(unknown.status, 400)
      assert.match(unknown.json.error, /未知模型/)
    })
    assert.equal(seen.filter((s) => s.path === 'pcweb/creation/submit').length, 0)
    seedState(null)
  })

  it('merges drive AI作品 with generation records and dedupes by media URL', async () => {
    seedState(LOGGED_IN)
    const shared = 'https://file.smartlink.wasu.cn/group1/dup.png'
    const { stub, seen } = makeUpstream({
      'pcweb/clouddisk/file/ai-assets': {
        counts: { doc: 0, photos: 1, videos: 0 },
        files: {
          pageNum: 1,
          total: 1,
          list: [{ fileId: 1, name: '云盘作品', fileType: 1, fileAddress: 'app/U1/dup.png', createTime: '2026-09-30 10:00:00' }],
        },
      },
      'pcweb/clouddisk/file/download/url': shared,
      'pcweb/creation/tasks': {
        data: [
          { taskId: 'dup', status: 'succeeded', templateType: 'IMAGE', prompt: '同一张', localResultUrls: JSON.stringify([shared]), createdTime: '2026-09-30 09:00:00' },
          { taskId: 'other', status: 'succeeded', templateType: 'VIDEO', prompt: '另一段', localResultUrls: '["https://file.smartlink.wasu.cn/group1/b.mp4"]', paramsConfig: '{"duration":5}', createdTime: '2026-09-29 09:00:00' },
        ],
        total: 2,
      },
    })
    const { handler } = bootHost()
    const r = await withFetch(stub, () => call(handler, 'GET', '/gallery?page=1&size=10'))
    assert.equal(r.status, 200, r.body)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.total, 2, 'the duplicated generation collapses into the drive row')
    assert.deepEqual(r.json.items.map((i) => i.id), ['asset:1', 'task:other'])
    assert.deepEqual(r.json.counts, { all: 2, image: 1, video: 1, file: 0, pending: 0 })
    assert.equal(r.json.sources.drive.ok, true)
    assert.equal(r.json.sources.tasks.ok, true)
    // The drive row carries the signed URL from the cloud namespace.
    assert.equal(r.json.items[0].url, shared)
    // The cloud read uses the cloud signature family: accessKey, no accessToken.
    const cloud = seen.find((s) => s.path === 'pcweb/clouddisk/file/ai-assets')
    assert.equal(cloud.envelope.system.accessToken, undefined)
    assert.equal(cloud.envelope.system.accessKey, ACCESS_KEY)
    seedState(null)
  })

  it('collapses an archived work whose task link is a differently signed URL', async () => {
    // Real-world shape: the drive holds the object key, while the task row
    // carries a short-lived OSS STS link to the same file name.
    seedState(LOGGED_IN)
    const signed = 'https://ihomeapp-cloudalbum-oss.oss-cn-hangzhou.aliyuncs.com/app%2FU1%2F20260930%2Fali%2Faigc_1_0.jpg?Expires=1&Signature=x'
    const { stub } = makeUpstream({
      'pcweb/clouddisk/file/ai-assets': {
        counts: { doc: 0, photos: 1, videos: 0 },
        files: {
          pageNum: 1,
          total: 1,
          list: [{ fileId: 7, name: 'aigc_1_0.jpg', fileType: 1, fileAddress: 'app/U1/20260930/ali/aigc_1_0.jpg', createTime: '2026-09-30 10:00:00' }],
        },
      },
      'pcweb/clouddisk/file/download/url': 'https://file.smartlink.wasu.cn/group1/signed.jpg?e=1',
      'pcweb/creation/tasks': {
        data: [{ taskId: 'gen_1', status: 'succeeded', templateType: 'IMAGE', prompt: '同一张', localResultUrls: JSON.stringify([signed]), createdTime: '2026-09-30 09:00:00' }],
        total: 1,
      },
    })
    const { handler } = bootHost()
    const r = await withFetch(stub, () => call(handler, 'GET', '/gallery?page=1&size=10'))
    assert.equal(r.json.total, 1, 'the expiring task link must not duplicate the archived copy')
    assert.deepEqual(r.json.items.map((i) => i.id), ['asset:7'])
    seedState(null)
  })

  it('honours the gallery source and kind filters', async () => {
    seedState(LOGGED_IN)
    const { stub, seen } = makeUpstream({
      'pcweb/clouddisk/file/ai-assets': { counts: {}, files: { pageNum: 1, total: 0, list: [] } },
      'pcweb/creation/tasks': { data: [], total: 0 },
    })
    const { handler } = bootHost()
    await withFetch(stub, async () => {
      const driveOnly = await call(handler, 'GET', '/gallery?source=drive')
      assert.equal(driveOnly.json.sources.tasks, undefined)
      assert.equal(driveOnly.json.sources.drive.ok, true)
      seen.length = 0
      await call(handler, 'GET', '/gallery?source=tasks&kind=video')
      const tasks = seen.find((s) => s.path === 'pcweb/creation/tasks')
      assert.equal(tasks.envelope.params.templateType, 'VIDEO')
      assert.equal(seen.find((s) => s.path === 'pcweb/clouddisk/file/ai-assets'), undefined)
      seen.length = 0
      await call(handler, 'GET', '/gallery?kind=image')
      assert.equal(seen.find((s) => s.path === 'pcweb/clouddisk/file/ai-assets').envelope.params.type, 'photo')
      assert.equal(seen.find((s) => s.path === 'pcweb/creation/tasks').envelope.params.templateType, 'IMAGE')
    })
    seedState(null)
  })

  it('rejects an unauthenticated gallery read', async () => {
    seedState(null)
    const { handler } = bootHost()
    const r = await call(handler, 'GET', '/gallery')
    assert.equal(r.status, 401)
  })

  it('uploads reference material as a header-only multipart POST', async () => {
    seedState(LOGGED_IN)
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const { stub, seen } = makeUpstream({})
    const { handler } = bootHost()
    const r = await withFetch(stub, () => call(handler, 'POST', '/creation/upload', {
      name: 'ref.png', contentType: 'image/png', data: png,
    }))
    assert.equal(r.status, 200, r.body)
    assert.equal(r.json.filePath, 'app/U1/20260930/ali/ref.png')
    const upload = seen.find((s) => s.path === 'pcweb/creation/upload')
    assert.ok(upload, 'upload must not go through the signed envelope path')
    assert.equal(upload.envelope, undefined)
    assert.equal(upload.headers.accessToken, TOKEN)
    assert.equal(upload.headers['X-CSRF-TOKEN'], undefined)
    assert.ok(upload.form instanceof FormData)
    seedState(null)
  })

  it('validates the upload payload before touching the network', async () => {
    seedState(LOGGED_IN)
    const { stub, seen } = makeUpstream({})
    const { handler } = bootHost()
    await withFetch(stub, async () => {
      assert.equal((await call(handler, 'POST', '/creation/upload', {})).status, 400)
      assert.equal((await call(handler, 'POST', '/creation/upload', { data: '!!!not-base64!!!' })).status, 400)
      const empty = await call(handler, 'POST', '/creation/upload', { data: '' })
      assert.equal(empty.status, 400)
      assert.match(empty.json.error, /缺少文件数据/)
    })
    assert.equal(seen.filter((s) => s.path === 'pcweb/creation/upload').length, 0)
    seedState(null)
  })

  it('serves one task by id and reports a miss as 404', async () => {
    seedState(LOGGED_IN)
    const { stub } = makeUpstream({
      'pcweb/creation/tasks': {
        data: [{ taskId: 'gen_9', status: 'processing', progress: '30%', templateType: 'IMAGE', prompt: 'x' }],
        total: 1,
      },
    })
    const { handler } = bootHost()
    await withFetch(stub, async () => {
      const found = await call(handler, 'GET', '/creation/task?taskId=gen_9')
      assert.equal(found.status, 200)
      assert.equal(found.json.task.pending, true)
      assert.equal(found.json.task.progress, '30%')
      const missing = await call(handler, 'GET', '/creation/task?taskId=gen_x')
      assert.equal(missing.status, 404)
      const noId = await call(handler, 'GET', '/creation/task')
      assert.equal(noId.status, 400)
    })
    seedState(null)
  })
})

/**
 * Generation tools, end to end: conversation attachments become uploaded
 * reference material, the task is submitted, polled and attached back.
 */
describe('generation tools', () => {
  const TOKEN = 'JWT.ACCOUNT.TOKEN'
  const ACCESS_KEY = 'cloud-access-key-64'
  const CSRF = 'cloud-csrf-64'

  /**
   * The creation poll loop sleeps through an unref'd setTimeout, on purpose: a
   * long video poll must not keep the host process alive. Under node:test that
   * same timer is the *only* pending work, so Node 20/22 declares the event
   * loop finished and cancels the still-pending test ("Promise resolution is
   * still pending but the event loop has already resolved"). Hold one ref'd
   * interval per test so the loop stays alive while the poll is awaited.
   */
  let keepAlive
  beforeEach(() => { keepAlive = setInterval(() => {}, 5) })
  afterEach(() => { clearInterval(keepAlive) })
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const MODEL = {
    modelName: 'doubao-seedream-5.0-pro',
    modelType: 'image',
    imageQuotaPerUnit: 300,
    modelParams: { ratios: ['1:1'], resolutions: ['1k'], maxImages: 4, capabilities: [] },
  }

  const OK = (result) => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ system: { code: '0', msg: 'success' }, result }),
  })
  const binary = (bytes) => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })

  /**
   * Upstream stub where the task only becomes visible on the Nth tasks read,
   * which is exactly how a real submission surfaces through `creation/tasks`.
   */
  function makeUpstream(options = {}) {
    const seen = []
    let taskReads = 0
    const stub = async (url, init) => {
      const path = String(url).replace('https://api-gateway.wasu.cn/tos/api/v1/open/', '')
      if (path === 'pcweb/creation/upload') {
        seen.push({ path, headers: init.headers, form: init.body })
        return OK({ fileName: 'ref.png', filePath: 'app/U1/ref.png' })
      }
      if (/^https:\/\/file\.smartlink\.wasu\.cn\//.test(path)) {
        seen.push({ path })
        return binary(options.resultBytes || PNG)
      }
      const envelope = JSON.parse(init.body)
      seen.push({ path, envelope, headers: init.headers })
      if (path === 'pcweb/auth/init') return OK({ accessKey: ACCESS_KEY, csrfToken: CSRF, uid: 'U1' })
      if (path === 'pcweb/creation/tasks') {
        taskReads += 1
        // First read is the pre-submit snapshot; the task appears afterwards.
        if (taskReads === 1) return OK({ data: [], total: 0 })
        return OK({
          data: [{
            taskId: 'gen_new',
            status: options.status || 'succeeded',
            templateType: options.taskTemplateType || 'IMAGE',
            modelName: options.taskModel || 'doubao-seedream-5.0-pro',
            prompt: options.prompt || '一只猫',
            localResultUrls: '["https://file.smartlink.wasu.cn/group1/out.png"]',
            createdTime: '2026-09-30 09:00:00',
          }],
          total: 1,
        })
      }
      if (path === 'pcweb/creation/models') return OK(options.models || [MODEL])
      return OK({})
    }
    return { stub, seen }
  }

  function bootHost(overrides = {}) {
    const registered = []
    const tools = []
    const saved = []
    const ctx = {
      get: () => undefined,
      effect: (fn) => { fn(); return () => {} },
      emit: () => {},
      logger: { warn: () => {}, error: () => {} },
      webServer: { register(route) { registered.push(route); return () => {} } },
      tools: { register(definition) { tools.push(definition); return () => {} } },
      attachments: {
        readImage: async () => ({ ref: { attachmentId: 'img-1', mediaType: 'image/png' }, data: PNG }),
        readFileStream: async function * () { yield PNG },
        saveImage: async (input) => { saved.push({ kind: 'image', input }); return { attachmentId: 'saved-img' } },
        saveFile: async (input) => { saved.push({ kind: 'file', input }); return { attachmentId: 'saved-file' } },
        ...overrides.attachments,
      },
    }
    apply(ctx)
    return { tools, saved, handler: registered[0].handler }
  }

  /** Minimal DSH agent surface: deriveMessages() plus a human message. */
  const agentWith = (content) => ({
    session: { deriveMessages: () => [{ source: { kind: 'user' }, content }] },
  })

  const exec = (agent) => ({ agent, signal: new AbortController().signal, callId: 'c1', name: 'x', arguments: {} })

  it('uploads conversation images, submits, polls and attaches the result', async () => {
    process.env.WASU_TOKENPLAN_POLL_MS = '1'
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} })
    const { stub, seen } = makeUpstream({ prompt: '一只猫' })
    const { tools, saved } = bootHost()
    const tool = tools.find((t) => t.name === 'generate_image')

    const value = await withFetch(stub, () => tool.execute(
      { prompt: '一只猫' },
      exec(agentWith([{ type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png' } }])),
    ))

    assert.equal(value.ok, true)
    assert.equal(value.taskId, 'gen_new')
    assert.deepEqual(value.urls, ['https://file.smartlink.wasu.cn/group1/out.png'])
    assert.equal(typeof value.elapsedMs, 'number')

    // The conversation image reached the upstream as uploaded reference material.
    const upload = seen.find((s) => s.path === 'pcweb/creation/upload')
    assert.ok(upload, 'the attached conversation image must be uploaded first')
    assert.equal(upload.headers.accessToken, TOKEN)
    const submit = seen.find((s) => s.path === 'pcweb/creation/submit')
    assert.deepEqual(submit.envelope.params.referenceFiles, [{ type: 'reference', url: 'app/U1/ref.png' }])
    assert.equal(submit.envelope.params.templateType, 'IMAGE')

    // The produced media is attached back for inline rendering.
    assert.equal(saved.length, 1)
    assert.equal(saved[0].kind, 'image')
    assert.equal(saved[0].input.mediaType, 'image/png')
    const imageBlocks = value.content.filter((b) => b.type === 'image')
    assert.equal(imageBlocks.length, 1)
    assert.equal(imageBlocks[0].attachment.attachmentId, 'saved-img')
    assert.match(value.content[0].text, /图片生成完成/)

    // The registry derives the model-facing content from `output.render`, not
    // from the returned value's own shape: a projection that drops the media
    // makes the tool result empty — the model sees nothing and the conversation
    // shows nothing. That is exactly the regression this assertion pins down.
    const projected = tool.output.render({ prompt: '一只猫' }, value)
    assert.deepEqual(projected, value.content)
    assert.equal(projected.filter((b) => b.type === 'image').length, 1)
    const meta = tool.output.presentationMeta({ prompt: '一只猫' }, value)
    assert.equal(meta.kind, 'image')
    assert.equal(meta.taskId, 'gen_new')
    assert.deepEqual(meta.urls, ['https://file.smartlink.wasu.cn/group1/out.png'])
    seedState(null)
    delete process.env.WASU_TOKENPLAN_POLL_MS
  })

  it('attaches every produced image of a multi-image batch', async () => {
    process.env.WASU_TOKENPLAN_POLL_MS = '1'
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} })
    let tasksRead = 0
    const stub = async (url, init) => {
      const path = String(url).replace('https://api-gateway.wasu.cn/tos/api/v1/open/', '')
      if (/^https:\/\/file\.smartlink\.wasu\.cn\//.test(path)) return binary(PNG)
      const envelope = JSON.parse(init.body)
      if (path === 'pcweb/auth/init') return OK({ accessKey: ACCESS_KEY, csrfToken: CSRF, uid: 'U1' })
      if (path === 'pcweb/creation/tasks') {
        // The first read is the pre-submit snapshot; the batch appears after it.
        if (tasksRead < 1) { tasksRead += 1; return OK({ data: [], total: 0 }) }
        tasksRead += 1
        return OK({
          data: [{
            taskId: 'gen_batch',
            status: 'succeeded',
            templateType: 'IMAGE',
            modelName: 'doubao-seedream-5.0-pro',
            prompt: '四张猫',
            localResultUrls: JSON.stringify([
              'https://file.smartlink.wasu.cn/group1/a.png',
              'https://file.smartlink.wasu.cn/group1/b.png',
              'https://file.smartlink.wasu.cn/group1/c.png',
            ]),
            createdTime: '2026-09-30 09:00:00',
          }],
          total: 1,
        })
      }
      if (path === 'pcweb/creation/models') return OK([MODEL])
      return OK({})
    }
    const { tools, saved } = bootHost()
    const tool = tools.find((t) => t.name === 'generate_image')

    const value = await withFetch(stub, () => tool.execute({ prompt: '四张猫' }, exec(agentWith([]))))
    assert.equal(saved.length, 3)
    assert.deepEqual(
      value.content.filter((b) => b.type === 'image').map((b) => b.attachment.attachmentId),
      ['saved-img', 'saved-img', 'saved-img'],
    )
    assert.deepEqual(value.urls, [
      'https://file.smartlink.wasu.cn/group1/a.png',
      'https://file.smartlink.wasu.cn/group1/b.png',
      'https://file.smartlink.wasu.cn/group1/c.png',
    ])
    seedState(null)
    delete process.env.WASU_TOKENPLAN_POLL_MS
  })

  it('submits without references when the conversation carries no attachment', async () => {
    process.env.WASU_TOKENPLAN_POLL_MS = '1'
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} })
    const { stub, seen } = makeUpstream({ prompt: '一只猫' })
    const { tools } = bootHost()
    const tool = tools.find((t) => t.name === 'generate_image')

    const value = await withFetch(stub, () => tool.execute({ prompt: '一只猫' }, exec(agentWith([{ type: 'text', text: 'hi' }]))))
    assert.equal(value.ok, true)
    assert.equal(seen.find((s) => s.path === 'pcweb/creation/upload'), undefined)
    const submit = seen.find((s) => s.path === 'pcweb/creation/submit')
    assert.equal(submit.envelope.params.referenceFiles, undefined)
    seedState(null)
    delete process.env.WASU_TOKENPLAN_POLL_MS
  })

  it('surfaces a failed task instead of a bogus success', async () => {
    process.env.WASU_TOKENPLAN_POLL_MS = '1'
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} })
    const { stub } = makeUpstream({ status: 'failed', prompt: '一只猫' })
    const { tools } = bootHost()
    const tool = tools.find((t) => t.name === 'generate_image')
    await withFetch(stub, async () => {
      await assert.rejects(
        () => tool.execute({ prompt: '一只猫' }, exec(agentWith([]))),
        /生成失败/,
      )
    })
    seedState(null)
    delete process.env.WASU_TOKENPLAN_POLL_MS
  })

  it('refuses to generate while the AI Store session is absent', async () => {
    seedState(null)
    const { tools } = bootHost()
    const tool = tools.find((t) => t.name === 'generate_image')
    await assert.rejects(() => tool.execute({ prompt: 'x' }, exec(agentWith([]))), /未登录/)
  })

  it('derives the video mode from the reference material the user attached', async () => {
    process.env.WASU_TOKENPLAN_POLL_MS = '1'
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} })
    const { stub, seen } = makeUpstream({
      prompt: '动起来',
      status: 'succeeded',
      taskModel: 'doubao-seedance-2.5',
      taskTemplateType: 'VIDEO',
      models: [MODEL, {
        modelName: 'doubao-seedance-2.5',
        modelType: 'video',
        videoQuotaPerSecond: 6350,
        modelParams: { ratios: ['16:9'], resolutions: ['720p'], durations: [5, 10], capabilities: ['text_to_video', 'image_to_video'] },
      }],
    })
    const { tools } = bootHost({
      attachments: { readFileStream: async function * () { yield Buffer.from('fake-mp4-bytes') } },
    })
    const tool = tools.find((t) => t.name === 'generate_video')

    await withFetch(stub, () => tool.execute(
      { prompt: '动起来' },
      exec(agentWith([{ type: 'file', attachment: { attachmentId: 'vid-1', name: 'clip.mp4', bytes: 14 } }])),
    ))

    const submit = seen.find((s) => s.path === 'pcweb/creation/submit')
    assert.equal(submit.envelope.params.templateType, 'VIDEO')
    assert.equal(submit.envelope.params.videoMode, 'file_upload')
    assert.deepEqual(submit.envelope.params.referenceFiles, [{ type: 'file', url: 'app/U1/ref.png' }])
    seedState(null)
    delete process.env.WASU_TOKENPLAN_POLL_MS
  })
})

describe('generation tool cancellation', () => {
  const TOKEN = 'JWT.ACCOUNT.TOKEN'

  // Same unref'd polling timer as in 'generation tools': keep the loop alive.
  let keepAlive
  beforeEach(() => { keepAlive = setInterval(() => {}, 5) })
  afterEach(() => { clearInterval(keepAlive) })
  const MODEL = {
    modelName: 'doubao-seedream-5.0-pro',
    modelType: 'image',
    imageQuotaPerUnit: 300,
    modelParams: { ratios: ['1:1'], resolutions: ['1k'], maxImages: 4, capabilities: [] },
  }
  const OK = (result) => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ system: { code: '0', msg: 'success' }, result }),
  })

  it('stops polling and reports cancellation when the caller signal is already aborted', async () => {
    seedState({ accessToken: TOKEN, refreshToken: 'R', uid: 'U1', prefs: {} })
    const tools = []
    const registered = []
    apply({
      get: () => undefined,
      effect: (fn) => { fn(); return () => {} },
      emit: () => {},
      logger: { warn: () => {}, error: () => {} },
      webServer: { register: (route) => { registered.push(route); return () => {} } },
      tools: { register: (definition) => { tools.push(definition); return () => {} } },
      attachments: {
        readImage: async () => ({ ref: {}, data: Buffer.from([1]) }),
        readFileStream: async function * () {},
        saveImage: async () => ({}),
        saveFile: async () => ({}),
      },
    })
    let submitCalls = 0
    const stub = async (url, init) => {
      const path = String(url).replace('https://api-gateway.wasu.cn/tos/api/v1/open/', '')
      if (path === 'pcweb/auth/init') return OK({ accessKey: 'k', csrfToken: 'c' })
      if (path === 'pcweb/creation/models') return OK([MODEL])
      if (path === 'pcweb/creation/tasks') return OK({ data: [], total: 0 })
      if (path === 'pcweb/creation/submit') { submitCalls += 1; return OK({}) }
      return OK({})
    }
    const controller = new AbortController()
    controller.abort()
    const tool = tools.find((t) => t.name === 'generate_image')
    await withFetch(stub, async () => {
      await assert.rejects(
        () => tool.execute({ prompt: '一只猫' }, {
          agent: { session: { deriveMessages: () => [] } },
          signal: controller.signal,
          callId: 'c1',
          name: 'generate_image',
          arguments: {},
        }),
        /已取消/,
      )
    })
    // The submission itself still went out (cancellation is checked in the poll
    // loop), but the call must not report a bogus success afterwards.
    assert.equal(submitCalls, 1)
    seedState(null)
  })
})
