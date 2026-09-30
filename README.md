# dsh-wasu-tokenplan

**华数 AI Store / Token Plan 费用中心** —— DeepSeek Harness（DSH）插件，把
[华数 AI Store 创作中心](https://tokenplan.wasu.cn/web/index.html#/) 的工作台能力集中到侧栏底部可拖拽面板，
把「模型广场」的模型目录写进 dsh chat 的「华数模型」分组，并让对话窗口多出一个
「画廊」页签 + 两个可直接生图/生视频的 Agent 工具。

> v0.7.0 项目更名为 `dsh-wasu-tokenplan`（原 `dsh-tokenplan-bill`）。包名、插件行 id
> （`wasu-tokenplan`）、浏览器路由前缀（`/dsh-wasu-tokenplan`）、侧栏 / 浮层 / 画廊槽位 id、
> 状态文件（`~/.dsh/wasu-tokenplan-state.json`）与环境变量（`WASU_TOKENPLAN_STATE`、
> `WASU_TOKENPLAN_POLL_MS`）全部换新，**不做旧名兼容**：升级后需重新登录一次华数账号，
> 首次安装请先卸载旧包（`dsh plugin --profile web remove dsh-tokenplan-bill`）。
> 上游站点 `tokenplan.wasu.cn` 与模型 provider id `wasu-tokenplan` 保持不变。
>
> v0.6.1 修复：`generate_image` / `generate_video` 的结果此前只进画廊、对话里看不到
> （工具结果的 `output.render` 投影为空数组），现在成品会内联回填对话，并带一张结果卡片。
>
> v0.6.0 新增 AI 创作能力：`pcweb/creation/*` 生图/生视频、
> `pcweb/clouddisk/file/ai-assets`「我的云盘-AI作品」画廊、
> `generate_image` / `generate_video` 工具（支持把对话里上传的图片、视频、音频作为参考素材）。
>
> v0.5.1 针对 2026-09 官网改版重写：TOS 协议升级到 `apiVersion 4`、控制台改为
> `/console/workspace/*` 等新路由、新增消息中心 / 我的云盘 / AI创作 / 模型广场目录。

## 生图 / 生视频

三条入口，全部走同一套华数 AI Store 创作接口，作品都会归档到「我的云盘-AI作品」：

### 1. 对话里让助手直接生成（Agent 工具）

| 工具 | 说明 |
|---|---|
| `generate_image` | 文生图 / 图生图 / 图层拆分；返回作品链接，并把图片直接挂进对话 |
| `generate_video` | 文生视频 / 图生视频 / 首尾帧 / 全参考 / 文件上传 / 智能编辑 |

- **对话里上传的素材会被自动使用**：DSH 把用户上传的图片存成 `image` 内容块，视频与音频
  存成 `file` 内容块；两个工具读取**最新一条带附件的用户消息**，上传到
  `pcweb/creation/upload`，再作为 `referenceFiles` 提交。也可以显式指定
  `source_attachment_ids`（图片）或 `source_file_ids`（视频 / 音频）。
- 视频模式由素材自动推导（与官网一致）：首尾帧 → `first_last_frame`，URL → `url_input`，
  视频文件 → `file_upload`，图片 / 音频 → `full_reference`，都没有 → `text_to_video`；
  也可以用 `mode` 显式指定。
- 提交后按 `pcweb/creation/tasks` 轮询（默认 5 秒一次；图片上限 5 分钟、视频上限 10 分钟），
  成功后把成品下载下来存进 DSH 附件，图片以 `image` 块、视频以 `file` 块**内联回填对话**
  （单个上限 24 MB、一次最多 4 个成品），对话里还会渲染一张结果卡片（DSH
  `tool.call.toolview` 槽位按工具名注册），缩略图点开即灯箱预览。
- **注意**：DSH 的模型可见内容来自 `output.render(args, value)`，**不是** `execute` 的返回值本身
  ——`render` 必须把媒体块投影出来。`render: () => []` 会让工具结果变成空数组，表现为
  「图片只出现在画廊、对话里什么都没有，模型还说结果是空的」。因此媒体块随
  `value.content` 走一遍规范化值，再由纯函数 `render` 取出；卡片需要的链接 / 模型 / 提示词
  走 `presentationMeta`（即 `tool/result` 事件里的 `meta`，客户端可读）。
- 未登录华数 AI Store 时工具直接报错，不会扣费。

### 2. 面板「AI创作」页 = 生成器

模型、比例、分辨率、张数 / 时长、水印、负向提示词全部按所选模型的 `modelParams` 动态渲染，
并实时显示**预计消耗积分**；支持上传参考图 / 视频 / 音频（图生图、图生视频、首尾帧）、
AI 优化提示词、提交后实时轮询进度、缩略图预览与灯箱、删除任务。

### 3. 对话窗口「画廊」页签

注册在 DSH 官方 `conversation.view` 槽位（`id: wasu-tokenplan-gallery`、`order: 20`、标签「画廊」），
数据来自 host 的 `GET /gallery`，它把两个上游合并成一份列表：

| 来源 | 上游 |
|---|---|
| 我的云盘 · AI作品 | `pcweb/clouddisk/file/ai-assets`（云盘签名族 + `file/download/url` 换签名 URL） |
| 生成记录 | `pcweb/creation/tasks`（已登录 `pcweb/*` 族） |

支持 全部 / 图片 / 视频 与来源筛选、懒加载网格、灯箱（图片原图 / 视频播放）、下载；
存在未完成任务时每 5 秒自动刷新。

> 结果 URL 优先 `localResultUrls`，只有它缺失时才回退到 `resultUrls`。
> 但 `localResultUrls` **不保证是永久地址**：实测老作品指向 `file.smartlink.wasu.cn`
> 公开 CDN（无 `Expires`，长期可用），而 2026-09 新生成的 `doubao-seedream` 作品指向
> `ihomeapp-cloudalbum-oss` 的 STS 签名地址（带 `Expires`，几十分钟后 403），
> 且上游**不会**在下次读取时重新签名。
>
> 因此：
> - 工具的成品在生成当时就下载并落成 DSH 附件，会话里的图片走持久附件（`loadImage`），
>   不受上游签名过期影响；视频因 DSH 只对图片提供会话级 URL，仍按上游链接播放。
> - 画廊里的作品来自云盘时，host 每次读取都重新调 `clouddisk/file/download/url` 换签名，
>   所以永远拿到新鲜地址；`creation/tasks` 那一行则可能带过期链接 ——
>   合并时按**文件名**（对象名最后一段）去重，云盘行优先，避免「同一张图一张能看一张裂开」。
> - 云盘行的时间戳是**毫秒整数**，与生成记录的 `YYYY-MM-DD HH:mm:ss` 字符串不同，
>   host 会统一成后者，否则画廊排序会把云盘作品排到最后、并显示成一串数字。

### 生成成本（实测目录）

| 类别 | 计费 | 例子 |
|---|---|---|
| 图片 | `imageQuotaPerUnit` × 张数 | `doubao-seedream-5.0-pro` 300 积分/张、`qwen-image-3.0` 200 积分/张 |
| 视频 | `videoQuotaPerSecond` × 秒数 | `doubao-seedance-2.0-mini` 1220 积分/秒、`doubao-seedance-2.5` 6350 积分/秒 |

面板与 `POST /creation/submit` 都会在提交前给出预估消耗；工具会随结果返回实际耗时。

## 功能

面板左侧导航对齐改版后的官网 IA：

| 页 | 能力 |
|---|---|
| 控制台 | 本月积分、今日消耗、日趋势、类型分布、Top 模型 |
| Token套餐 | 月付 / 年付 / 加油包（企业账号自动隐藏）；微信扫码订购 |
| API密钥 | 列表、创建、启用/禁用、重置、删除（`deletable=false` 的行不显示删除） |
| 积分用量 | 积分包（含已用/剩余/到期）+ 积分订单（类型、状态、有效期） |
| 订单中心 | 订购记录（编号、套餐、规格、金额、状态） |
| 使用记录 | 按时间段筛选的调用记录（模型、结算类型、积分、状态码、耗时） |
| 消息中心 | 未读筛选、优先级排序、详情、单条/全部标记已读、跳转处理 |
| 我的云盘 | 云盘空间用量（总量/已用/剩余、文件与相册拆分）+ 云盘各页入口 |
| AI创作 | 内置生图/生视频生成器（模型/比例/分辨率/时长/参考素材/提示词优化）+ 作品画廊 |
| AI电商 / AI语音 | 商品套图、电商详情页、抠图、服装上身、印花提取、语音合成等官网子页入口 |
| 智能体广场 | 官网 7 个智能体（漫剧创作、网文写手、AI造镜师、自媒体运营、即客来、完美简历、职业证件照） |
| DSH模型配置 | 官网「模型广场」38+ 模型（厂商/类型/能力/价格/角标），多选累加写入 dsh chat |

侧栏入口会显示可用积分，并在有未读消息或积分偏低时打点。

### 登录后同步华数模型

登录成功后，host 会把平台 API Key 写入 DSH 凭据，并 upsert `llm-pi-ai` 供应商：

| 项 | 值 |
|---|---|
| 显示名 | 华数模型 |
| provider | `wasu-tokenplan` |
| baseURL | `https://token.wasu.cn/v1` |
| 种子模型 | `deepseek-v4.1-flash` |
| apiKeyEnv | `WASU_TOKENPLAN_API_KEY` |

同时把 `agent-default-model` 指向上述路由，聊天输入栏模型选择器会出现「华数模型」。
若账号下没有密钥，会自动创建名为 `dsh-chat` 的密钥。已有默认模型不会被登录流程覆盖。

## 安装

本仓库以已构建的 `lib/` 提交分发（无需安装期构建脚本）：

```sh
# npm（已发布版本）
dsh plugin --profile web add dsh-wasu-tokenplan

# GitHub（私有仓库，走本机 git 凭据）
dsh plugin --profile web add github:nestzhong/dsh-wasu-tokenplan

# 本地目录
dsh plugin --profile web add link:/path/to/dsh-wasu-tokenplan

# 或 tarball
npm pack
dsh plugin --profile web add ./dsh-wasu-tokenplan-0.7.0.tgz
```

安装后 `dsh-wasu-tokenplan` 会被写入 profile 的 `dsh.profile.bundles`，重启 `dsh web` 生效。

## 发布到 npm（维护者）

发布走 GitHub Actions 手动触发，工作流见 [`.github/workflows/publish.yml`](.github/workflows/publish.yml)：

1. 在 `package.json` 里提升 `version` 并提交到 `main`
2. GitHub → **Actions** → **Publish to npm** → **Run workflow**
   - `npm_tag`：正式版 `latest`，预发布 `next` / `beta`
   - `dry_run`：只跑测试 + `npm publish --dry-run`，不真正发版
   - `create_release`：发布成功后自动打 `v<version>` tag 并建 GitHub Release
3. 工作流按顺序执行：`npm test`（不过不发版）→ 校验 `NPM_TOKEN` → 检查该版本是否已存在于
   npm（存在则直接失败，避免 403/覆盖）→ `npm publish --access public` → 建 Release

前置条件：仓库 secret `NPM_TOKEN`（npm 账号开了 2FA 时必须用 **Automation** token，或
Granular access token 且勾选 *Bypass 2FA*）。本仓库是私有仓库，因此不能用 npm provenance；
若将来仓库转公开，可给 `npm publish` 加 `--provenance` 并声明 `id-token: write`。

## 使用

1. 侧栏底部点 **AI Store**
2. 手机号 + 短信验证码登录（可选个人 / 企业），凭据存 `~/.dsh/wasu-tokenplan-state.json`（0600）
3. 登录成功后检查聊天区模型选择是否出现「华数模型」
4. 左侧切换各功能页；`DSH模型配置` 页勾选模型后「累加到 DSH」
5. `AI创作` 页直接生图 / 生视频；或在对话里直接说「生成一张…」「生成一段…视频」，
   需要参考素材时先把图片 / 视频拖进输入框再提问
6. 对话窗口顶部切到 **画廊** 查看「我的云盘 · AI作品」与生成记录

企业账号会自动使用 `wasuAITokenEnterprise` 通道，并隐藏加油包。

## Host 路由

浏览器侧只与本机 host 通信，前缀 `/dsh-wasu-tokenplan`：

```
GET  /manifest              会话 + 未读消息数 + 云盘用量（脱敏）
POST /auth/sms              发送登录验证码
POST /auth/login            登录（并写入华数模型）
POST /auth/logout           退出
GET  /dashboard?range=7|30  控制台概览与图表
GET  /models                平台模型目录（pcweb/models/list）
GET  /models/gateway        网关 /v1/models 实测列表
POST /model/sync            累加写入 dsh chat「华数模型」
POST /model/refresh-catalog 通知聊天刷新模型目录
GET  /packages              套餐（renewalType=2|1|-1）
GET  /keys                  密钥列表（脱敏）
POST /keys/create|delete|status|reset
GET  /credits               积分包 + 积分订单
GET  /orders                订单中心
GET  /logs                  使用记录
GET  /messages              消息列表
GET  /messages/unread       未读数
POST /messages/read         标记已读
GET  /drive                 云盘空间（pcweb/clouddisk/file/home）
GET  /creation/models       生成模型目录（含 ratios/resolutions/durations/能力/单价）
GET  /creation/tasks        生成任务（page/size/status/templateType，优先 localResultUrls）
GET  /creation/task         单个生成任务（?taskId=）
POST /creation/submit       提交生图/生视频任务（服务端组装官网载荷）
POST /creation/upload       参考素材上传（multipart，base64 入参）
POST /creation/optimize-prompt  AI 优化提示词
POST /creation/task-delete  删除生成任务
GET  /gallery               画廊聚合（云盘 AI作品 + 生成记录，?kind=&source=&page=&size=）
GET  /debug/llm-catalog     当前 host LLM 目录（排障）
GET/POST /prefs             面板位置尺寸
```

### Agent 工具

随 host 一起注册到 `ctx.tools`：

| 工具 | 关键参数 |
|---|---|
| `generate_image` | `prompt`(必填)、`model`、`aspect_ratio`、`resolution`、`image_count`、`negative_prompt`、`watermark`、`layer_split`、`source_attachment_ids`、`reference_urls` |
| `generate_video` | `prompt`(必填)、`model`、`mode`、`aspect_ratio`、`resolution`、`duration`、`negative_prompt`、`watermark`、`source_attachment_ids`、`source_file_ids`、`reference_urls` |

`WASU_TOKENPLAN_POLL_MS` 可覆盖轮询间隔（默认 5000ms），仅用于测试与探针。

契约要点（踩过的坑）：工具定义里 **`output.render(args, value)` 才是模型可见内容**，
`execute` 的返回值只是规范化值（会按 `output.schema` 校验），它本身不会变成工具结果。
媒体块因此放在 `value.content` 里，由 `render` 原样投影；客户端卡片读 `block.content`
（附件块）与 `block.meta`（`presentationMeta` 的产物）。注册到客户端的可视卡片走
`tool.call.toolview` 键控槽位，`key` 就是工具名 —— 没注册的话媒体块会被通用卡片
按 JSON 文本展开。

客户端侧另有一个细节：图片用对话自己的会话级加载器 `loadImage`（`props.loadImage`，
带 `.peek` 同步命中缓存）取，因此**只有当图片附件确实出现在该会话的某个事件里**
（`tool/result` 的 `content` 就会被扫到）才允许读取；视频不走这个加载器，
直接用 `localResultUrls` 公开链接播放。

## 协议说明（改版后）

TOS 签名信封：`signVersion=4`、`apiVersion=4`，签名 = `md5(flatten(system) || flatten(params) || secret)`，
成功码 `0` / `200`，`accessToken` / `accessKey` 为空时不下发。**四类调用的签名密钥与附带字段各不相同**
（对应站点 SPA 里的 `Ur` / `Br` / `Mr` 三个拦截器）：

| 调用族 | `system.accessToken` | `system.accessKey` | 签名 secret | `X-CSRF-TOKEN` |
| --- | --- | --- | --- | --- |
| 匿名读（如 `pcweb/models/list`、`pcweb/creation/models`） | 无 | 无 | 固定默认密钥 | 无 |
| `pcweb/auth/init`（换取云盘凭据） | 有 | 无 | **固定默认密钥** | 无 |
| 已登录 `pcweb/*`（控制台全部接口） | 有 | 有 | **账号 accessToken** | 有 |
| `pcweb/clouddisk/*`（我的云盘） | 无 | 有 | **账号 accessToken** | 有 |

- 云盘凭据由 `POST pcweb/auth/init` 下发（`result.accessKey` + `result.csrfToken`），与当前
  accessToken 绑定；token 变更即失效，需重新换取。并发调用共享同一次换取，避免打爆上游。
- 已登录接口如果用默认密钥签名、或漏掉 `accessKey` / CSRF 头，网关会返回
  `1103 授权校验失败`；插件据此**先重换云盘凭据、再尝试 refresh**，只有 refresh 也被拒绝才判定
  `登录已过期` 并清空凭据、让面板回到登录页。
- **创作接口族**（`pcweb/creation/*`）属于已登录 `pcweb/*` 族；`pcweb/creation/models` 例外，
  它是匿名读。`pcweb/creation/upload` 是唯一一个**不走签名信封**的接口：裸 multipart
  POST，只带 `accessToken` 请求头，返回 `result.filePath`（对象 key），供 `referenceFiles` 引用。
- **云盘 AI作品**（`pcweb/clouddisk/file/ai-assets`）属于云盘族，返回
  `{ counts:{doc,photos,videos}, files:{list,total,pageNum} }`；`fileType` 为 1/2 分别代表图片/视频，
  `fileAddress` 是对象 key，需要再调 `pcweb/clouddisk/file/download/url` 换取签名 URL。
- **生成任务**（`pcweb/creation/tasks`）返回的 `resultUrls` 是第三方 OSS 签名地址（会过期），
  `localResultUrls` 优先使用；注意它本身也可能是短时效的 STS 签名地址（见上文画廊小节），
  真正持久的副本是云盘对象与工具落下的 DSH 附件。
- `pcweb/creation/submit` 的响应不保证带 `taskId`（官网自己也不读它），插件改用
  **提交前后任务列表 diff + prompt/model 匹配**定位新任务。
- **与 dsh-image-gen 不共存**：两者都注册名为 `generate_image` 的 host 工具与同名
  `tool.call.toolview` 卡片键。DSH 的工具注册表会拒绝第二个同名工具，本插件对这种冲突做了
  降级（记一条 warning 并继续注册其余能力），但同一 profile 里请只启用其中一个。

## 开发

```sh
node --test "tests/*.spec.mjs"   # host 单测 + client bundle 渲染测试
node scripts/live-probe.mjs models            # 线上只读探针（无需登录）
node scripts/live-probe.mjs creation-catalog  # 生图/生视频模型目录（无需登录）
node scripts/live-probe.mjs login <手机号> <验证码>
node scripts/live-probe.mjs gallery           # 云盘 AI作品 + 生成记录（只读）
node scripts/probe-auth.mjs                   # 用已存会话逐族验证签名密钥（只读，不改状态）
node scripts/capture-all.mjs                  # 抓取各页响应样本
```

`tests/host.spec.mjs` 覆盖创作目录/任务/画廊的归一化、提交载荷映射、上传校验与两个工具的
端到端流程（含对话附件 → 上传 → 提交 → 轮询 → 回填附件）；`tests/client.spec.mjs` 覆盖
画廊页签注册与渲染、生成器表单交互（含参考素材上传）。

## 隐私

账号 token 只保存在本机 host（`~/.dsh/wasu-tokenplan-state.json`，0600），
浏览器只见掩码状态；完整 API Key 仅在你主动显示/复制时使用。同步到 DSH 的 Key
写入 `~/.dsh/.credentials.yaml`，不经浏览器。

生图 / 生视频只在你主动调用时才会上传素材：对话里作为参考的图片、视频、音频会经本机 host
转发到华数 `pcweb/creation/upload`，生成结果则通过 `pcweb/creation/tasks` 取回。
两者都不会在未被要求时上传任何本地文件。

`/dsh-wasu-tokenplan/*` 与 DSH 面板同机同源，但**不走 DSH 的浏览器信任围栏**：
默认 `webserver.host` 为 `127.0.0.1`，请勿把该端口暴露到公网，否则本机 API Key
列表、模型配置写入接口，以及 `POST /creation/submit`（会消耗积分）都会对网络开放。
需要异地访问时，请改用反向代理加认证，并在代理层只放行 `/api/*` 等必要前缀。