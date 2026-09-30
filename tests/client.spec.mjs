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
    ['/dsh-tokenplan-bill/creation/models', {
      ok: true,
      list: [
        {
          id: 'doubao-seedream-5.0-pro',
          name: 'Doubao-Seedream-5.0-Pro',
          kind: 'image',
          vendor: '豆包AI',
          description: '图像创作模型',
          imagePrice: 300,
          videoPrice: 0,
          ratios: ['1:1', '16:9'],
          resolutions: ['1k', '2K'],
          durations: [],
          maxImages: 4,
          capabilities: ['layer_split'],
          supports: { layerSplit: true },
        },
        {
          id: 'doubao-seedance-2.5',
          name: 'Doubao-Seedance-2.5',
          kind: 'video',
          vendor: '豆包AI',
          description: '视频创作模型',
          imagePrice: 0,
          videoPrice: 6350,
          ratios: ['16:9', '9:16'],
          resolutions: ['720p', '1080p'],
          durations: [5, 10],
          maxImages: 0,
          capabilities: ['text_to_video', 'image_to_video'],
          supports: { textToVideo: true, imageToVideo: true },
        },
      ],
    }],
    ['/dsh-tokenplan-bill/gallery', {
      ok: true,
      items: [
        {
          id: 'asset:1',
          source: 'drive',
          kind: 'image',
          url: 'https://example.com/asset.png',
          title: '云盘作品',
          model: 'qwen-image-2.0-pro',
          createdAt: '2026-09-29 10:00:00',
          meta: '1:1 · 2K',
          pending: false,
        },
        {
          id: 'task:t2',
          taskId: 't2',
          source: 'tasks',
          kind: 'video',
          url: 'https://example.com/b.mp4',
          title: '一段视频',
          model: 'doubao-seedance-2.5',
          createdAt: '2026-09-28 09:00:00',
          meta: '16:9 · 720p · 5秒',
          duration: '5',
          pending: false,
        },
      ],
      total: 2,
      counts: { all: 2, image: 1, video: 1, file: 0, pending: 0 },
      sources: { drive: { ok: true, total: 1 }, tasks: { ok: true, total: 1 } },
    }],
    ['/dsh-tokenplan-bill/creation/submit', {
      ok: true,
      submitted: true,
      request: { kind: 'image', model: 'doubao-seedream-5.0-pro', estimatedCost: 300 },
    }],
    ['/dsh-tokenplan-bill/creation/upload', {
      ok: true,
      filePath: 'app/U1/ref.png',
      fileName: 'ref.png',
      size: 12,
    }],
    ['/dsh-tokenplan-bill/creation/optimize-prompt', {
      ok: true,
      prompt: '一只坐在窗台上的猫，柔和晨光',
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

  it('registers the sidebar entry, the overlay panel, the conversation gallery and both tool cards', () => {
    const { exports } = loadClient({ routes: routes() })
    const { slots, registered } = createSlotsStub()
    const ctx = createContextStub(slots)
    exports.apply(ctx)
    const names = registered.map((r) => r.descriptor.name)
    assert.deepEqual(names, [
      'sidebar.footer.action',
      'shell.overlay',
      'conversation.view',
      'tool.call.toolview',
      'tool.call.toolview',
    ])
    assert.equal(registered[0].descriptor.id, 'tokenplan-bill-entry')
    assert.equal(registered[1].descriptor.id, 'tokenplan-bill-panel')
    assert.equal(registered[2].descriptor.id, 'tokenplan-bill-gallery')
    assert.equal(registered[2].descriptor.order, 20)
    assert.equal(registered[2].descriptor.label(), '画廊')
    // Keyed by wire tool name: the seat dispatches one tool call to one card.
    assert.deepEqual(
      registered.slice(3).map((r) => r.descriptor.key),
      ['generate_image', 'generate_video'],
    )
    // style + poll + four slot effects
    assert.equal(ctx.effects.length, 7)
  })

  it('keeps its other slots when a tool-view key is already taken', () => {
    const { exports } = loadClient({ routes: routes() })
    const names = []
    const slots = {
      inject(key, callback) {
        callback()
        return () => {}
      },
      register(descriptor) {
        if (descriptor.name === 'tool.call.toolview') throw new Error('keyed slot already has an entry for key "' + descriptor.key + '"')
        names.push(descriptor.name)
        return () => {}
      },
    }
    const ctx = createContextStub(slots)
    exports.apply(ctx)
    assert.deepEqual(names, ['sidebar.footer.action', 'shell.overlay', 'conversation.view'])
    assert.equal(ctx.effects.length, 7)
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

  it('renders the AI创作 generator with model-derived options and cost', async () => {
    const { text } = await mountView('CreationView')
    assert.match(text, /AI创作/)
    // Pretty model label plus its per-image price drives the picker row.
    assert.match(text, /Doubao-Seedream-5\.0-Pro/)
    assert.match(text, /300 积分\/张/)
    // Ratio/resolution options come from the selected model only.
    assert.match(text, /1:1/)
    assert.match(text, /2K/)
    assert.match(text, /AI 优化提示词/)
    assert.match(text, /预计消耗/)
    // The history grid is the shared gallery feed.
    assert.match(text, /qwen-image-2\.0-pro/)
    assert.match(text, /doubao-seedance-2\.5/)
  })

  it('renders the conversation-window gallery with both sources', async () => {
    const { text } = await mountView('GalleryView')
    assert.match(text, /华数 AI 画廊/)
    assert.match(text, /我的云盘 · AI作品/)
    assert.match(text, /全部来源/)
    assert.match(text, /我的云盘·AI作品/)
    assert.match(text, /生成记录/)
    // A drive item and a task item, each labelled by its source glyph.
    assert.match(text, /☁ qwen-image-2\.0-pro/)
    assert.match(text, /✦ doubao-seedance-2\.5/)
    // Videos carry a duration badge.
    assert.match(text, /▶ 5s/)
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
describe('AI创作 generator interactions', () => {
  const settle = async (harness, el) => {
    await new Promise((r) => setTimeout(r, 5))
    return harness.mini.mount(el)
  }
  // Exact label first: the header also renders "官网图片生成 / 官网视频生成".
  const buttonWith = (tree, label) => findAll(tree, 'button').find((b) => textOf(b).trim() === label)
    || findAll(tree, 'button').find((b) => textOf(b).includes(label))
  const postBody = (harness, path) => {
    const hit = [...harness.calls].reverse().find((c) => c.url === path && c.method === 'POST')
    return hit ? JSON.parse(hit.body) : null
  }

  it('posts the image generation request built from the form', async () => {
    const harness = loadClient({ routes: routes() })
    const { CreationView } = harness.exports.__views
    const el = harness.mini.React.createElement(CreationView, {})
    let tree = await harness.mini.mount(el)

    // Model options come from /creation/models; the image model is preselected.
    const modelSelect = findAll(tree, 'select')[0]
    assert.equal(modelSelect.props.value, 'doubao-seedream-5.0-pro')

    findAll(tree, 'textarea')[0].props.onChange({ target: { value: '一只猫' } })
    tree = await harness.mini.mount(el)

    const submit = buttonWith(tree, '生成图片')
    assert.ok(submit, 'the generator must offer a submit button')
    submit.props.onClick()
    tree = await settle(harness, el)

    const body = postBody(harness, '/dsh-tokenplan-bill/creation/submit')
    assert.ok(body, 'submitting must POST to the creation endpoint')
    assert.equal(body.kind, 'image')
    assert.equal(body.model, 'doubao-seedream-5.0-pro')
    assert.equal(body.prompt, '一只猫')
    assert.equal(body.ratio, '1:1')
    assert.equal(body.resolution, '1k')
    assert.equal(body.imageCount, 1)
    assert.equal(body.watermark, false)
    assert.equal(body.referenceFiles, undefined, 'no reference material was picked')
    assert.match(textOf(tree), /任务已提交/)
  })

  it('uploads a picked reference file and sends it with the request', async () => {
    const harness = loadClient({ routes: routes() })
    const { CreationView } = harness.exports.__views
    const el = harness.mini.React.createElement(CreationView, {})
    let tree = await harness.mini.mount(el)

    const fileInput = findAll(tree, 'input').find((i) => i.props.type === 'file')
    assert.ok(fileInput, 'the generator must offer a reference picker')
    assert.equal(fileInput.props.accept, 'image/*,video/*,audio/*')

    const target = { files: [{ name: 'ref.png', type: 'image/png' }], value: 'ref.png' }
    fileInput.props.onChange({ target })
    tree = await settle(harness, el)

    // The picked file is uploaded through the host, and only the object key
    // travels with the generation request.
    const upload = JSON.parse(harness.calls.find((c) => c.url === '/dsh-tokenplan-bill/creation/upload').body)
    assert.equal(upload.name, 'ref.png')
    assert.equal(upload.contentType, 'image/png')
    assert.match(upload.data, /^data:image\/png;base64,/)
    assert.match(textOf(tree), /ref\.png/)

    findAll(tree, 'textarea')[0].props.onChange({ target: { value: '改成水彩' } })
    tree = await harness.mini.mount(el)
    buttonWith(tree, '生成图片').props.onClick()
    tree = await settle(harness, el)

    const body = postBody(harness, '/dsh-tokenplan-bill/creation/submit')
    assert.deepEqual(body.referenceFiles, [{ type: 'reference', url: 'app/U1/ref.png' }])
  })

  it('switches to the video model options and submits a duration', async () => {
    const harness = loadClient({ routes: routes() })
    const { CreationView } = harness.exports.__views
    const el = harness.mini.React.createElement(CreationView, {})
    let tree = await harness.mini.mount(el)

    buttonWith(tree, '视频生成').props.onClick()
    tree = await settle(harness, el)
    assert.match(textOf(tree), /6350 积分\/秒/)

    findAll(tree, 'textarea')[0].props.onChange({ target: { value: '日落延时' } })
    tree = await harness.mini.mount(el)
    buttonWith(tree, '生成视频').props.onClick()
    tree = await settle(harness, el)

    const body = postBody(harness, '/dsh-tokenplan-bill/creation/submit')
    assert.equal(body.kind, 'video')
    assert.equal(body.model, 'doubao-seedance-2.5')
    assert.equal(body.duration, 5)
    assert.equal(body.imageCount, undefined)
  })

  it('optimizes the prompt through the host route', async () => {
    const harness = loadClient({ routes: routes() })
    const { CreationView } = harness.exports.__views
    const el = harness.mini.React.createElement(CreationView, {})
    let tree = await harness.mini.mount(el)

    findAll(tree, 'textarea')[0].props.onChange({ target: { value: '猫' } })
    tree = await harness.mini.mount(el)
    buttonWith(tree, 'AI 优化提示词').props.onClick()
    tree = await settle(harness, el)

    const body = postBody(harness, '/dsh-tokenplan-bill/creation/optimize-prompt')
    assert.deepEqual(body, { prompt: '猫', kind: 'image' })
    assert.equal(findAll(tree, 'textarea')[0].props.value, '一只坐在窗台上的猫，柔和晨光')
  })
})

describe('gallery to panel navigation', () => {
  it('opens the panel on the AI创作 page from the gallery', async () => {
    const harness = loadClient({ routes: routes() })
    const { GalleryView, Panel, setStore } = harness.exports.__views
    setStore({ open: false, nav: 'dashboard', loggedIn: true })
    const tree = await harness.mini.mount(harness.mini.React.createElement(GalleryView, {}))

    const go = findAll(tree, 'button').find((b) => textOf(b).trim() === '去生成')
    assert.ok(go, 'the gallery must offer a shortcut into the generator')
    go.props.onClick()
    assert.equal(setStoreCheck(harness), 'creation')
    assert.equal(harness.exports.__views.store.open, true)

    // The panel reads the shared nav, so it lands on AI创作 rather than 控制台.
    const panel = await harness.mini.mount(harness.mini.React.createElement(Panel, {}))
    assert.match(textOf(panel), /AI创作/)
    assert.match(textOf(panel), /图片生成/)
  })

  function setStoreCheck(harness) {
    return harness.exports.__views.store.nav
  }
})

describe('inline generation result card', () => {
  const ATTACHMENT = {
    attachmentId: 'sha256:abc',
    mediaType: 'image/png',
    bytes: 2048,
    width: 1024,
    height: 1024,
    name: 'tokenplan-gen_1-1',
  }

  /** A settled tool block exactly as the session log carries one. */
  const settledBlock = (overrides = {}) => ({
    kind: 'tool-result',
    seq: 1,
    callId: 'call-1',
    call: { name: 'generate_image', argsRaw: '{"prompt":"一只猫"}' },
    isError: false,
    subCalls: [],
    content: [
      { type: 'text', text: '图片生成完成（doubao-seedream-5.0-pro）' },
      { type: 'image', attachment: ATTACHMENT },
    ],
    meta: {
      kind: 'image',
      taskId: 'gen_1',
      model: 'doubao-seedream-5.0-pro',
      status: 'succeeded',
      prompt: '一只猫',
      urls: ['https://file.smartlink.wasu.cn/group1/out.png'],
    },
    ...overrides,
  })

  /** `loadImage` as the conversation exposes it: a session image-URL loader. */
  const loadImage = Object.assign(
    async (attachment) => 'blob:session/' + attachment.attachmentId,
    { peek: () => '' },
  )

  it('renders the settled image through the session image loader', async () => {
    const harness = loadClient({ routes: routes() })
    const { GeneratedMediaCard } = harness.exports.__views
    const tree = await harness.mini.mount(harness.mini.React.createElement(GeneratedMediaCard, {
      toolName: 'generate_image',
      phase: 'result',
      block: settledBlock(),
      loadImage,
    }))

    const text = textOf(tree)
    assert.match(text, /图片生成/)
    assert.match(text, /doubao-seedream-5.0-pro/)
    assert.match(text, /完成/)
    const img = findElement(tree, 'img')
    assert.ok(img, 'the produced image must render inline in the conversation')
    assert.equal(img.props.src, 'blob:session/sha256:abc')
    const links = findAll(tree, 'a').map((a) => a.props.href)
    assert.deepEqual(links, ['https://file.smartlink.wasu.cn/group1/out.png'])
  })

  it('falls back to the upstream link when no loader is provided', async () => {
    const harness = loadClient({ routes: routes() })
    const { GeneratedMediaCard } = harness.exports.__views
    const tree = await harness.mini.mount(harness.mini.React.createElement(GeneratedMediaCard, {
      toolName: 'generate_image',
      phase: 'result',
      block: settledBlock(),
    }))
    const img = findElement(tree, 'img')
    assert.equal(img.props.src, 'https://file.smartlink.wasu.cn/group1/out.png')
  })

  it('reads the link out of the summary text when presentation meta is absent', async () => {
    // A nested (run_code) call persists no `presentationMeta`, so the card has
    // only the rendered content to work with.
    const harness = loadClient({ routes: routes() })
    const { GeneratedMediaCard } = harness.exports.__views
    const block = settledBlock({
      meta: undefined,
      content: [
        { type: 'text', text: '图片生成完成\n作品链接:\n- https://file.smartlink.wasu.cn/group1/nested.png' },
        { type: 'image', attachment: ATTACHMENT },
      ],
    })
    const tree = await harness.mini.mount(harness.mini.React.createElement(GeneratedMediaCard, {
      toolName: 'generate_image',
      phase: 'result',
      block,
    }))
    assert.deepEqual(findAll(tree, 'a').map((a) => a.props.href), [
      'https://file.smartlink.wasu.cn/group1/nested.png',
    ])
    const img = findElement(tree, 'img')
    assert.equal(img.props.src, 'https://file.smartlink.wasu.cn/group1/nested.png')
  })

  it('renders a video result with playback controls', async () => {
    const harness = loadClient({ routes: routes() })
    const { GeneratedMediaCard } = harness.exports.__views
    const tree = await harness.mini.mount(harness.mini.React.createElement(GeneratedMediaCard, {
      toolName: 'generate_video',
      phase: 'result',
      block: settledBlock({
        call: { name: 'generate_video', argsRaw: '{"prompt":"动起来"}' },
        content: [
          { type: 'text', text: '视频生成完成' },
          { type: 'file', attachment: { attachmentId: 'sha256:vid', name: 'tokenplan-gen_2.mp4', bytes: 4096 } },
        ],
        meta: {
          kind: 'video',
          taskId: 'gen_2',
          model: 'doubao-seedance-2.5',
          status: 'succeeded',
          prompt: '动起来',
          urls: ['https://file.smartlink.wasu.cn/group1/out.mp4'],
        },
      }),
    }))
    assert.match(textOf(tree), /视频生成/)
    const video = findElement(tree, 'video')
    assert.ok(video, 'the produced video must render inline')
    assert.equal(video.props.src, 'https://file.smartlink.wasu.cn/group1/out.mp4')
    assert.equal(video.props.controls, true)
  })

  it('renders nothing for a legacy call that persisted neither media nor meta', async () => {
    // Rows written before the render projection carried the media: an empty
    // result with no meta. A card would only invent a wrong story.
    const harness = loadClient({ routes: routes() })
    const { GeneratedMediaCard } = harness.exports.__views
    const tree = await harness.mini.mount(harness.mini.React.createElement(GeneratedMediaCard, {
      toolName: 'generate_image',
      phase: 'result',
      block: settledBlock({ content: [], meta: undefined }),
    }))
    assert.equal(textOf(tree).trim(), '')
    assert.equal(findElement(tree, 'section'), null)
    assert.equal(findElement(tree, 'img'), null)
  })

  it('shows progress while the call is still running and the error when it failed', async () => {
    const harness = loadClient({ routes: routes() })
    const { GeneratedMediaCard } = harness.exports.__views
    const pending = await harness.mini.mount(harness.mini.React.createElement(GeneratedMediaCard, {
      toolName: 'generate_image',
      phase: 'start',
      block: { name: 'generate_image' },
    }))
    assert.match(textOf(pending), /生成中/)

    const failed = await harness.mini.mount(harness.mini.React.createElement(GeneratedMediaCard, {
      toolName: 'generate_image',
      phase: 'result',
      block: settledBlock({
        isError: true,
        content: [{ type: 'text', text: '生成失败（failed）' }],
        meta: { kind: 'image', status: 'failed' },
      }),
    }))
    assert.match(textOf(failed), /失败/)
    assert.equal(findElement(failed, 'img'), null)
  })
})
