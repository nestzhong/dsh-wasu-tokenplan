# dsh-tokenplan-bill

**华数 AI Store / Token Plan 费用中心** —— DeepSeek Harness（DSH）插件，把
[华数 AI Store 创作中心](https://tokenplan.wasu.cn/web/index.html#/) 的工作台能力集中到侧栏底部可拖拽面板，
并把「模型广场」的模型目录写进 dsh chat 的「华数模型」分组。

> v0.5.1 针对 2026-09 官网改版重写：TOS 协议升级到 `apiVersion 4`、控制台改为
> `/console/workspace/*` 等新路由、新增消息中心 / 我的云盘 / AI创作 / 模型广场目录。

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
| AI创作 | 最近成功的图片/视频作品（含参数与预览），一键跳图片/视频生成 |
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
# 本地目录
dsh plugin --profile web add link:/path/to/dsh-tokenplan-bill

# 或 tarball
npm pack
dsh plugin --profile web add ./dsh-tokenplan-bill-0.5.0.tgz
```

安装后 `dsh-tokenplan-bill` 会被写入 profile 的 `dsh.profile.bundles`，重启 `dsh web` 生效。

## 使用

1. 侧栏底部点 **AI Store**
2. 手机号 + 短信验证码登录（可选个人 / 企业），凭据存 `~/.dsh/tokenplan-bill-state.json`（0600）
3. 登录成功后检查聊天区模型选择是否出现「华数模型」
4. 左侧切换各功能页；`DSH模型配置` 页勾选模型后「累加到 DSH」

企业账号会自动使用 `wasuAITokenEnterprise` 通道，并隐藏加油包。

## Host 路由

浏览器侧只与本机 host 通信，前缀 `/dsh-tokenplan-bill`：

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
GET  /creation/models       生成模型目录
GET  /creation/tasks        生成任务
GET  /debug/llm-catalog     当前 host LLM 目录（排障）
GET/POST /prefs             面板位置尺寸
```

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

## 开发

```sh
node --test "tests/*.spec.mjs"   # host 单测 + client bundle 渲染测试
node scripts/live-probe.mjs models            # 线上只读探针（无需登录）
node scripts/live-probe.mjs login <手机号> <验证码>
node scripts/probe-auth.mjs                   # 用已存会话逐族验证签名密钥（只读，不改状态）
node scripts/capture-all.mjs                  # 抓取各页响应样本
```

## 隐私

账号 token 只保存在本机 host（`~/.dsh/tokenplan-bill-state.json`，0600），
浏览器只见掩码状态；完整 API Key 仅在你主动显示/复制时使用。同步到 DSH 的 Key
写入 `~/.dsh/.credentials.yaml`，不经浏览器。

`/dsh-tokenplan-bill/*` 与 DSH 面板同机同源，但**不走 DSH 的浏览器信任围栏**：
默认 `webserver.host` 为 `127.0.0.1`，请勿把该端口暴露到公网，否则本机 API Key
列表与模型配置写入接口会对网络开放。需要异地访问时，请改用反向代理加认证，
并在代理层只放行 `/api/*` 等必要前缀。