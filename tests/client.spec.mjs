/**
 * Browser-half contract tests: the real lib/client.js bundle is loaded in a vm
 * with a stubbed DOM/fetch and mounted with a minimal React runtime.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, createSlotsStub, createContextStub } from './helpers/client-harness.mjs'
import { textOf, findAll, findElement } from './helpers/mini-react.mjs'

const MANIFEST = {
  ok: true,
  version: '0.5.0',
  session: { loggedIn: true, nickname: '测试用户', phone: '192****7055', isEnterprise: false },
  unread: 3,
  drive: { percent: 42, usedText: '512 MB', totalText: '1 GB' },
}

const DASHBOARD = {
  ok: true,
  loggedIn: true,
  overview: {
    availableQuota: 123456,
    totalQuota: 200000,
    usedQuota: 76544,
    todayConsumed: 321,
    todayChangePercent: -12,
    planTags: [{ name: '月付套餐', quotaText: '20 万积分' }],
    activeModels: ['deepseek-v4.1-flash', 'glm-5.3'],
  },
  dailyUsage: [{ dateLabel: '09-01', totalQuota: 120, percent: 60 }],
  distribution: [{ modelName: 'deepseek-v4.1-flash', percentage: 100 }],
  topModels: [{ rank: 1, modelName: 'deepseek-v4.1-flash', consumedQuota: 4321, avatarLetter: 'D' }],
  accountInfo: { nickname: '测试用户' },
  rangeDays: 7,
}

const MODELS = {
  ok: true,
  endpoint: 'https://token.wasu.cn/v1',
  models: [
    {
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek-V4.1-Flash',
      kind: 'chat',
      modelType: 'text',
      vendor: '百炼',
      capabilities: ['深度思考', '文本生成'],
      badges: ['热门', '推荐'],
      price: [{ label: '输入', value: '2,000积分/百万tokens' }],
      selectable: true,
    },
    {
      id: 'doubao-seedream-5.0-pro',
      name: 'Doubao-Seedream-5.0-Pro',
      kind: 'image',
      vendor: '豆包AI',
      capabilities: ['图片生成'],
      badges: [],
      price: [{ label: '图片', value: '300积分/张' }],
      selectable: false,
    },
  ],
  configured: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash' }],
  defaultModel: 'deepseek-v4.1-flash',
  seedModel: 'deepseek-v4.1-flash',
  apiKeyHint: 'sk-a…(64)',
}

function routes(extra = []) {
  // Extras come first so an override wins over the default route.
  return [
    ...extra,
    ['/dsh-tokenplan-bill/manifest', MANIFEST],
    ['/dsh-tokenplan-bill/prefs', { ok: true, prefs: {} }],
    ['/dsh-tokenplan-bill/dashboard', DASHBOARD],
    ['/dsh-tokenplan-bill/packages', {
      ok: true,
      isEnterprise: false,
      canBuyBoost: true,
      list: [{
        packageName: '词元月付套餐',
        promoTitle: '限时优惠',
        features: ['包含 200,000 积分', '积分有效期 1个月'],
        priceValue: 99,
        originalPrice: 129,
        productId: 42,
        renewalType: '2',
        subscribed: false,
        canSubscribe: true,
      }],
    }],
    ['/dsh-tokenplan-bill/keys', {
      ok: true,
      endpoint: 'https://token.wasu.cn/v1',
      list: [{
        keyId: 7,
        keyName: 'dsh-chat',
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
        apiKeyMasked: 'sk-abcde...wxyz',
        status: 1,
        statusLabel: '启用',
        deletable: false,
        createdTime: '2026-09-01 10:00:00',
      }],
    }],
    ['/dsh-tokenplan-bill/credits', {
      ok: true,
      credit: {
        packages: [{
          packageName: '词元月付套餐',
          availableCredit: 120000,
          creditValue: 200000,
          consumedCredit: 80000,
          expireTime: '2026-10-01 00:00:00',
        }],
      },
      orders: {
        list: [{
          orderNo: 'C20260901001',
          packageName: '词元月付套餐',
          packageType: 'CONTINUOUS_MONTHLY',
          quotaValue: 200000,
          startTime: '2026-09-01 00:00:00',
          expireTime: '2026-10-01 00:00:00',
          status: 'COMPLETED',
          createdTime: '2026-09-01 09:00:00',
        }],
        total: 1,
        page: 1,
        size: 10,
      },
    }],
    ['/dsh-tokenplan-bill/orders', {
      ok: true,
      list: [{
        tradeSn: 'T20260901001',
        packageName: '词元月付套餐',
        specInfo: '200,000 积分',
        orderType: '订购',
        orderTime: '2026-09-01 09:00:00',
        amount: 99,
        status: 1,
        statusDesc: '已支付',
      }],
      total: 1,
      page: 1,
      size: 10,
    }],
    ['/dsh-tokenplan-bill/logs', {
      ok: true,
      list: [{
        createdAt: '2026-09-28 12:00:00',
        model: 'deepseek-v4.1-flash',
        settlementStatus: 'settled',
        usedCredit: 12,
        statusCode: 200,
        latency: 880,
      }],
      total: 1,
      page: 1,
      size: 10,
    }],
    ['/dsh-tokenplan-bill/messages/unread', { ok: true, unread: 3 }],
    ['/dsh-tokenplan-bill/messages', {
      ok: true,
      list: [{
        id: 11,
        title: '积分到账提醒',
        content: '您的套餐积分已到账',
        msgType: 'notice',
        typeLabel: '服务公告',
        priority: 'IMPORTANT',
        readStatus: 0,
        deliveredTime: '2026-09-28 12:00:00',
        recalled: 0,
      }],
      total: 1,
      page: 1,
      size: 10,
    }],
    ['/dsh-tokenplan-bill/drive', {
      ok: true,
      usage: {
        total: 1073741824,
        used: 536870912,
        free: 536870912,
        files: 536870912,
        albums: 0,
        percent: 50,
        totalText: '1 GB',
        usedText: '512 MB',
        freeText: '512 MB',
        filesText: '512 MB',
        albumsText: '0 B',
      },
    }],
    ['/dsh-tokenplan-bill/creation/tasks', {
      ok: true,
      list: [{
        id: 't1',
        kind: 'image',
        status: 'succeeded',
        model: 'doubao-seedream-5.0-pro',
        prompt: '一只猫',
        createdAt: '2026-09-28 12:00:00',
        urls: ['https://example.com/a.png'],
        cover: 'https://example.com/a.png',
        ratio: '1:1',
        resolution: '2K',
        duration: '',
        imageCount: '1',
      }],
      total: 1,
      page: 1,
      size: 24,
    }],
    ['/dsh-tokenplan-bill/models', MODELS],
  ]
}

function mountView(name, props) {
  const harness = loadClient({ routes: routes() })
  const View = harness.exports.__views[name]
  assert.ok(View, 'view not exported: ' + name)
  return harness.mini.mount(harness.mini.React.createElement(View, props || {}))
    .then((tree) => ({ tree, text: textOf(tree), harness }))
}

describe('client bundle contract', () => {
  it('loads through the module loader and exports apply/inject', () => {
    const { exports } = loadClient({ routes: routes() })
    assert.equal(typeof exports.apply, 'function')
    assert.deepEqual([...exports.inject], ['slots'])
  })

  it('registers the sidebar entry and the overlay panel', () => {
    const { exports } = loadClient({ routes: routes() })
    const { slots, registered } = createSlotsStub()
    const ctx = createContextStub(slots)
    exports.apply(ctx)
    const names = registered.map((r) => r.descriptor.name)
    assert.deepEqual(names, ['sidebar.footer.action', 'shell.overlay'])
    assert.equal(registered[0].descriptor.id, 'tokenplan-bill-entry')
    assert.equal(registered[1].descriptor.id, 'tokenplan-bill-panel')
    // style + poll + two slot effects
    assert.equal(ctx.effects.length, 4)
  })

  it('injects its stylesheet and removes it on dispose', () => {
    const { exports, appended, removed } = loadClient({ routes: routes() })
    const { slots } = createSlotsStub()
    const ctx = createContextStub(slots)
    exports.apply(ctx)
    assert.equal(appended.length, 1)
    assert.equal(appended[0].attrs['data-plugin'], 'dsh-tokenplan-bill')
    assert.match(appended[0].textContent, /\.dsh-tp-panel/)
    ctx.effects[0].dispose()
    assert.deepEqual(removed, appended)
  })
})

describe('entry button', () => {
  it('renders the label and quota pill when logged in', async () => {
    const harness = loadClient({ routes: routes() })
    const { EntryButton, setStore } = harness.exports.__views
    setStore({ loggedIn: true, availableQuota: 123456, unread: 2 })
    const rendered = await harness.mini.mount(
      harness.mini.React.createElement(EntryButton, { wide: true }),
    )
    const text = textOf(rendered)
    assert.match(text, /AI Store/)
    assert.match(text, /123,456/)
    const button = findElement(rendered, 'button')
    assert.ok(button)
    assert.equal(button.props['data-wide'], '1')
  })

  it('hides the quota pill in the collapsed rail', async () => {
    const harness = loadClient({ routes: routes() })
    const { EntryButton, setStore } = harness.exports.__views
    setStore({ loggedIn: true, availableQuota: 123456 })
    const rendered = await harness.mini.mount(
      harness.mini.React.createElement(EntryButton, { wide: false }),
    )
    assert.equal(textOf(rendered).trim(), '')
    assert.equal(findElement(rendered, 'button').props['data-wide'], '0')
  })
})

describe('panel', () => {
  it('renders nothing while closed', async () => {
    const harness = loadClient({ routes: routes() })
    const { Panel, setStore } = harness.exports.__views
    setStore({ open: false })
    const tree = await harness.mini.mount(harness.mini.React.createElement(Panel, {}))
    assert.equal(textOf(tree), '')
    assert.equal(findElement(tree, 'div'), null)
  })

  it('renders the console navigation and dashboard when open and logged in', async () => {
    const harness = loadClient({ routes: routes() })
    const { Panel, setStore } = harness.exports.__views
    setStore({ open: true })
    const tree = await harness.mini.mount(harness.mini.React.createElement(Panel, {}))
    const text = textOf(tree)
    assert.match(text, /华数 AI Store · 费用中心/)
    for (const label of ['控制台', 'Token套餐', 'API密钥', '积分用量', '订单中心', '使用记录',
      '消息中心', '我的云盘', 'AI创作', 'AI电商', 'AI语音', '智能体广场', 'DSH模型配置']) {
      assert.ok(text.includes(label), 'missing nav label: ' + label)
    }
    assert.match(text, /欢迎回来，测试用户/)
    assert.match(text, /123,456/)
    assert.match(text, /deepseek-v4\.1-flash/)
  })

  it('shows the login form when logged out', async () => {
    const harness = loadClient({
      routes: routes([['/dsh-tokenplan-bill/manifest', {
        ok: true, version: '0.5.0', session: { loggedIn: false }, unread: 0, drive: null,
      }]]),
    })
    const { Panel, setStore } = harness.exports.__views
    setStore({ open: true, loggedIn: false, availableQuota: null })
    const tree = await harness.mini.mount(harness.mini.React.createElement(Panel, {}))
    const text = textOf(tree)
    assert.match(text, /登录华数 AI Store/)
    assert.match(text, /个人用户/)
    assert.match(text, /企业用户/)
    assert.match(text, /服务协议/)
  })
})

describe('console views', () => {
  it('renders the packages page with features and price', async () => {
    const { text } = await mountView('PackagesView', { isEnterprise: false })
    assert.match(text, /Token套餐/)
    assert.match(text, /词元月付套餐/)
    assert.match(text, /包含 200,000 积分/)
    assert.match(text, /¥99\.00/)
    assert.match(text, /限时优惠/)
    assert.match(text, /加油包/)
  })

  it('hides the boost tab for enterprise accounts', async () => {
    const { text } = await mountView('PackagesView', { isEnterprise: true })
    assert.ok(!text.includes('加油包'))
    assert.match(text, /联系客户经理/)
  })

  it('renders the API key page with reset and masked keys', async () => {
    const { text, tree } = await mountView('KeysView')
    assert.match(text, /API密钥/)
    assert.match(text, /dsh-chat/)
    assert.match(text, /sk-abcde\.\.\.wxyz/)
    assert.match(text, /重置/)
    // deletable:false hides the 删除 button
    assert.ok(!text.includes('删除'))
    assert.ok(findAll(tree, 'table').length >= 1)
  })

  it('renders credits with consumed/available and order labels', async () => {
    const { text } = await mountView('CreditsView')
    assert.match(text, /可用积分包/)
    assert.match(text, /120,000 \/ 200,000/)
    assert.match(text, /连续包月/)
    assert.match(text, /正常/)
  })

  it('renders the order center', async () => {
    const { text } = await mountView('OrdersView')
    assert.match(text, /订单中心/)
    assert.match(text, /T20260901001/)
    assert.match(text, /¥99\.00/)
  })

  it('renders usage records with latency', async () => {
    const { text } = await mountView('LogsView')
    assert.match(text, /使用记录/)
    assert.match(text, /deepseek-v4\.1-flash/)
    assert.match(text, /耗时\(ms\)/)
    assert.match(text, /880/)
  })

  it('renders the message center', async () => {
    const { text } = await mountView('MessagesView', { onUnreadChange: () => {} })
    assert.match(text, /消息中心/)
    assert.match(text, /积分到账提醒/)
    assert.match(text, /重要/)
    assert.match(text, /全部标记已读/)
  })

  it('renders cloud-drive usage', async () => {
    const { text } = await mountView('DriveView')
    assert.match(text, /我的云盘/)
    assert.match(text, /512 MB/)
    assert.match(text, /云盘套餐/)
  })

  it('renders recent AI creations', async () => {
    const { text } = await mountView('CreationView')
    assert.match(text, /AI创作/)
    assert.match(text, /doubao-seedream-5\.0-pro/)
    assert.match(text, /1:1/)
  })

  it('renders the agent square', async () => {
    const { text } = await mountView('AgentsView')
    assert.match(text, /智能体广场/)
    assert.match(text, /漫剧创作/)
    assert.match(text, /网文写手/)
    assert.match(text, /职业证件照/)
  })

  it('renders the model catalog with vendor, badges and prices', async () => {
    const { text } = await mountView('DshModelsView')
    assert.match(text, /DSH模型配置/)
    assert.match(text, /DeepSeek-V4\.1-Flash/)
    assert.match(text, /百炼/)
    assert.match(text, /热门/)
    assert.match(text, /已在 DSH/)
    assert.match(text, /累加到 DSH/)
  })
})