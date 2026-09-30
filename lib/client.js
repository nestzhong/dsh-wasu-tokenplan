/**
 * dsh-tokenplan-bill client half: sidebar entry + 华数 AI Store / Token Plan console panel.
 *
 * Mirrors the redesigned site (https://tokenplan.wasu.cn/web/index.html, hash
 * routing): 工作台 / 消息中心 / 我的云盘 / AI创作 / AI电商 / AI语音 / 模型广场 /
 * 智能体广场. Console data comes from the host half under /dsh-tokenplan-bill/*.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tokenplan-bill',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;
    const useMemo = React.useMemo;

    const API = '/dsh-tokenplan-bill';
    /** Host tool names that own an inline conversation result card. */
    const TOOL_VIEW_KEYS = ['generate_image', 'generate_video'];
    const SITE = 'https://tokenplan.wasu.cn/web/index.html';
    const API_ENDPOINT = 'https://token.wasu.cn/v1';
    const ACCENT = '#7C3AED';

    /** Hash-routed site link. */
    const siteUrl = (p) => SITE + '#/' + String(p || '').replace(/^[#/]+/, '');
    /** Console link. */
    const consoleUrl = (p) => siteUrl('console/' + String(p || '').replace(/^[#/]+/, ''));

    const store = {
      open: false,
      nav: 'dashboard',
      loggedIn: false,
      nickname: '',
      availableQuota: null,
      unread: 0,
      drivePercent: null,
      alert: null,
    };
    const listeners = new Set();
    const setStore = (patch) => {
      Object.assign(store, patch);
      for (const fn of listeners) { try { fn() } catch { /* listener errors stay contained */ } }
    };
    const useStore = () => {
      const [, force] = useState(0);
      useEffect(() => {
        const fn = () => force((n) => n + 1);
        listeners.add(fn);
        return () => listeners.delete(fn);
      }, []);
      return store;
    };

    const jsonGet = async (path) => {
      try {
        const res = await fetch(path, { cache: 'no-store' });
        return await res.json();
      } catch { return null }
    };
    const jsonPost = async (path, body) => {
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        });
        return await res.json();
      } catch { return null }
    };

    const fmt = (n) => {
      if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
      return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 3 });
    };
    const fmtMoney = (n) => {
      if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
      return '¥' + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const fmtDate = (s) => (s ? String(s).replace('T', ' ').slice(0, 19) : '—');
    const fmtDay = (s) => (s ? String(s).replace('T', ' ').slice(0, 10) : '—');
    const pad2 = (n) => String(n).padStart(2, '0');
    const dayStr = (dt) => dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
    const logDefaultRange = () => {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 6);
      return { startTime: dayStr(start) + ' 00:00:00', endTime: dayStr(end) + ' 23:59:59' };
    };
    const relTime = (s) => {
      if (!s) return '—';
      const t = new Date(String(s).replace(/-/g, '/')).getTime();
      if (!Number.isFinite(t)) return String(s);
      const diff = Date.now() - t;
      if (diff < 60_000) return '刚刚';
      if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前';
      if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前';
      if (diff < 2_592_000_000) return Math.floor(diff / 86_400_000) + ' 天前';
      return fmtDate(s).slice(0, 16);
    };
    const copyText = async (text) => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch { /* fall through to execCommand */ }
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch { return false }
    };
    const openUrl = (url) => { if (url) window.open(url, '_blank', 'noopener,noreferrer'); };

    const DONUT_COLORS = ['#7C3AED', '#3B82F6', '#06B6D4', '#EC4899', '#F59E0B'];
    const BADGE = ['purple', 'blue', 'green', 'pink', 'orange'];
    const KIND_LABELS = { chat: '对话', image: '图像', video: '视频', audio: '语音', other: '其他' };

    /** Console pages mirrored from the redesigned site IA. */
    const CONSOLE_PAGES = {
      dashboard: 'workspace/dashboard',
      pricing: 'workspace/pricing',
      apikeys: 'workspace/apikeys',
      credits: 'workspace/credits',
      orders: 'workspace/orders',
      usage: 'workspace/usage',
      messages: 'message-center',
      profile: 'profile',
      agents: 'agent-square',
      drive: 'cloud-drive/overview',
      driveFiles: 'cloud-drive/files',
      driveAlbums: 'cloud-drive/albums',
      driveAssets: 'cloud-drive/ai-assets',
      drivePlans: 'cloud-drive/plans',
      driveRecycle: 'cloud-drive/recycle',
      imageGen: 'ai-gen/image',
      videoGen: 'ai-gen/video',
      myAssets: 'ai-gen/assets',
      ecomHome: 'ai-ecommerce/overview',
    };

    const NAV = [
      { id: 'dashboard', label: '控制台', icon: '◉' },
      { id: 'packages', label: 'Token套餐', icon: '▣' },
      { id: 'keys', label: 'API密钥', icon: '⚿' },
      { id: 'credits', label: '积分用量', icon: '◎' },
      { id: 'orders', label: '订单中心', icon: '☰' },
      { id: 'logs', label: '使用记录', icon: '≡' },
      { id: 'messages', label: '消息中心', icon: '✉' },
      { id: 'drive', label: '我的云盘', icon: '☁' },
      {
        id: 'creation', label: 'AI创作', icon: '✦', children: [
          { id: 'c-image', label: '图片生成', href: consoleUrl('ai-gen/image') },
          { id: 'c-video', label: '视频生成', href: consoleUrl('ai-gen/video') },
          { id: 'c-assets', label: '我的资产', href: consoleUrl('ai-gen/assets') },
        ],
      },
      {
        id: 'ecommerce', label: 'AI电商', icon: '◈', children: [
          { id: 'ec-showcase', label: '商品套图', href: consoleUrl('ai-ecommerce/product-showcase') },
          { id: 'ec-detail', label: '电商详情页', href: consoleUrl('ai-ecommerce/product-detail-page') },
          { id: 'ec-var', label: '图裂变', href: consoleUrl('ai-ecommerce/image-variation') },
          { id: 'ec-cutout', label: 'AI抠图', href: consoleUrl('ai-ecommerce/cutout') },
          { id: 'ec-tryon', label: '服装上身', href: consoleUrl('ai-ecommerce/tryon') },
          { id: 'ec-extract', label: '服装提取', href: consoleUrl('ai-ecommerce/garment-extract') },
          { id: 'ec-3d', label: '3D服装图', href: consoleUrl('ai-ecommerce/garment-3d') },
          { id: 'ec-dewrinkle', label: '服装去皱', href: consoleUrl('ai-ecommerce/dewrinkle') },
          { id: 'ec-title', label: '标题生成', href: consoleUrl('ai-ecommerce/title-gen') },
          { id: 'ec-pattern', label: '印花提取', href: consoleUrl('ai-ecommerce/pattern-extract') },
        ],
      },
      {
        id: 'voice', label: 'AI语音', icon: '☊', children: [
          { id: 'v-tts', label: '语音合成', href: consoleUrl('ai-voice/tts') },
          { id: 'v-realtime', label: '实时对话', href: consoleUrl('ai-voice/realtime') },
          { id: 'v-asr', label: '语音识别', href: consoleUrl('ai-voice/asr') },
          { id: 'v-records', label: '语音记录', href: consoleUrl('ai-voice/records') },
        ],
      },
      { id: 'agents', label: '智能体广场', icon: '◇' },
      { id: 'dsh-models', label: 'DSH模型配置', icon: '⚙' },
    ];

    /** Agent square entries mirrored from the site (2026-09 revision). */
    const AGENTS = [
      { name: '漫剧创作', desc: 'AI 驱动的动漫内容创作，支持角色设计、场景生成与动画制作', url: 'https://iot-test.wasumedia.cn/waoowaoo/', tag: '内容创作' },
      { name: '网文写手', desc: '网文创作平台：大纲、人设、章节撰写与剧情优化', url: 'https://static-gateway.wasu.cn/upload/h5-test/openSource/aiWriting/index.html#/', tag: '内容创作' },
      { name: 'AI造镜师', desc: '华数 AIGC 多媒体创作平台，支持无限画布与多媒体内容创作', url: 'https://zaojingshi.930827.xyz/', tag: '内容创作' },
      { name: '自媒体运营', desc: '一键分发到抖音、小红书、视频号等平台，内容变现', url: 'http://125.210.50.207:7070/', tag: '营销' },
      { name: '即客来', desc: 'AI 助力全球业务增长：内容管理、渠道运营与团队协作', url: 'https://k.digmind.ai?entry=huashu', tag: '营销' },
      { name: '完美简历', desc: 'AI 写简历、JD 智能匹配、模拟面试', url: 'http://125.210.50.207:3001', tag: '办公效率' },
      { name: '职业证件照', desc: 'AI 证件照：合规模板、智能修图换装换底色', url: 'https://idphoto.930827.xyz/', tag: '办公效率' },
    ];

    function EntryButton(props) {
      const st = useStore();
      const hasWide = !!(props && Object.prototype.hasOwnProperty.call(props, 'wide'));
      const wide = hasWide ? !!props.wide : true;
      const pill = st.loggedIn && st.availableQuota != null
        ? fmt(st.availableQuota)
        : (st.loggedIn ? '已登录' : null);
      const btnProps = {
        type: 'button',
        className: 'dsh-tp-entry' + (st.open ? ' active' : '') + (wide ? '' : ' rail'),
        'aria-label': '华数 AI Store 费用中心',
        title: '华数 AI Store · 费用中心',
        onClick: () => setStore({ open: !st.open }),
      };
      if (hasWide) btnProps['data-wide'] = wide ? '1' : '0';
      const icon = h('span', { className: 'dsh-tp-entry-icon', 'aria-hidden': true },
        h('svg', { width: wide ? 16 : 18, height: wide ? 16 : 18, viewBox: '0 0 24 24', fill: 'none' },
          h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.8 }),
          h('path', { d: 'M8 12h8M12 8v8', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
        ),
        (st.unread > 0 || st.alert)
          ? h('span', { className: 'dsh-tp-entry-dot' + (st.unread > 0 ? '' : ' warn') })
          : null,
      );
      return h('button', btnProps,
        wide
          ? h('span', { className: 'dsh-tp-entry-left' },
              icon,
              h('span', { className: 'dsh-tp-entry-name' }, 'AI Store'),
            )
          : icon,
        wide && pill
          ? h('span', { className: 'dsh-tp-entry-bal' + (st.alert ? ' alert' : '') }, pill)
          : null,
      );
    }

    function LoginView({ onLoggedIn }) {
      const [phone, setPhone] = useState('');
      const [smscode, setCode] = useState('');
      const [type, setType] = useState('personal');
      const [agree, setAgree] = useState(true);
      const [busy, setBusy] = useState(false);
      const [cooldown, setCooldown] = useState(0);
      const [err, setErr] = useState('');
      const [msg, setMsg] = useState('');

      useEffect(() => {
        if (cooldown <= 0) return undefined;
        const t = setTimeout(() => setCooldown((n) => n - 1), 1000);
        return () => clearTimeout(t);
      }, [cooldown]);

      const sendSms = async () => {
        setErr(''); setMsg('');
        if (!/^1[3-9]\d{9}$/.test(phone)) { setErr('手机号格式不正确'); return }
        setBusy(true);
        const r = await jsonPost(API + '/auth/sms', { phone });
        setBusy(false);
        if (!r || !r.ok) { setErr((r && r.error) || '发送失败'); return }
        setMsg('验证码已发送');
        setCooldown(60);
      };

      const login = async () => {
        setErr(''); setMsg('');
        if (!phone || !smscode) { setErr('请填写手机号和验证码'); return }
        if (!agree) { setErr('请先同意服务协议与隐私政策'); return }
        setBusy(true);
        const r = await jsonPost(API + '/auth/login', { phone, smscode, type });
        setBusy(false);
        if (!r || !r.ok) { setErr((r && r.error) || '登录失败'); return }
        const sync = r.modelSync;
        if (sync && sync.ok) {
          setMsg('登录成功，已写入聊天模型「' + (sync.displayName || '华数模型') + '」');
        } else if (sync && sync.error) {
          setMsg('登录成功（华数模型同步失败：' + sync.error + '）');
        } else {
          setMsg('登录成功');
        }
        if (typeof onLoggedIn === 'function') onLoggedIn(r.session);
      };

      return h('div', { className: 'dsh-tp-login' },
        h('div', { className: 'dsh-tp-login-title' }, '登录华数 AI Store'),
        h('p', { className: 'dsh-tp-login-sub' }, '手机号 + 短信验证码；与官网 ' + SITE.replace('/web/index.html', '') + ' 同一账号'),
        h('div', { className: 'dsh-tp-tabs login-tabs' },
          ['personal', 'enterprise'].map((t) => h('button', {
            key: t, type: 'button',
            className: 'dsh-tp-tab' + (type === t ? ' active' : ''),
            onClick: () => setType(t),
          }, t === 'personal' ? '个人用户' : '企业用户')),
        ),
        h('label', { className: 'dsh-tp-field' },
          h('span', null, '手机号'),
          h('input', {
            value: phone, maxLength: 11, inputMode: 'numeric',
            onChange: (e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11)),
            placeholder: '11 位手机号',
          }),
        ),
        h('label', { className: 'dsh-tp-field' },
          h('span', null, '验证码'),
          h('div', { className: 'dsh-tp-code-row' },
            h('input', {
              value: smscode, maxLength: 6, inputMode: 'numeric',
              onChange: (e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6)),
              placeholder: '短信验证码',
            }),
            h('button', {
              type: 'button', className: 'dsh-tp-btn outline', disabled: busy || cooldown > 0,
              onClick: sendSms,
            }, cooldown > 0 ? cooldown + 's' : '发送验证码'),
          ),
        ),
        h('label', { className: 'dsh-tp-check agree' },
          h('input', { type: 'checkbox', checked: agree, onChange: (e) => setAgree(e.target.checked) }),
          '我已阅读并同意《服务协议》与《隐私政策》',
        ),
        err ? h('div', { className: 'dsh-tp-err' }, err) : null,
        msg ? h('div', { className: 'dsh-tp-ok' }, msg) : null,
        h('button', {
          type: 'button', className: 'dsh-tp-btn primary block', disabled: busy,
          onClick: login,
        }, busy ? '登录中…' : '登录'),
      );
    }

    function StatCard({ label, children, footer }) {
      return h('div', { className: 'dsh-tp-stat' },
        h('div', { className: 'dsh-tp-stat-label' }, label),
        h('div', { className: 'dsh-tp-stat-body' }, children),
        footer || null,
      );
    }

    function Pagination({ page, size, total, onPage }) {
      const pages = Math.max(1, Math.ceil((total || 0) / (size || 10)));
      if (pages <= 1) return null;
      return h('div', { className: 'dsh-tp-pager' },
        h('button', {
          type: 'button', className: 'dsh-tp-btn outline small', disabled: page <= 1,
          onClick: () => onPage(page - 1),
        }, '上一页'),
        h('span', { className: 'dsh-tp-pager-info' }, page + ' / ' + pages + '（共 ' + (total || 0) + ' 条）'),
        h('button', {
          type: 'button', className: 'dsh-tp-btn outline small', disabled: page >= pages,
          onClick: () => onPage(page + 1),
        }, '下一页'),
      );
    }

    function QrModal({ url, title, onClose }) {
      if (!url) return null;
      return h('div', { className: 'dsh-tp-modal-backdrop', onClick: onClose },
        h('div', { className: 'dsh-tp-modal', onClick: (e) => e.stopPropagation() },
          h('div', { className: 'dsh-tp-modal-head' },
            h('span', null, title || '扫码购买'),
            h('button', { type: 'button', className: 'dsh-tp-btn ghost small', onClick: onClose }, '关闭'),
          ),
          h('img', { className: 'dsh-tp-qr', src: url, alt: '购买二维码' }),
          h('p', { className: 'dsh-tp-modal-hint' }, '使用微信扫码完成购买'),
        ),
      );
    }

    function ViewHead({ title, sub, actions }) {
      return h('div', { className: 'dsh-tp-view-head' },
        h('div', null,
          h('h2', null, title),
          sub ? h('p', { className: 'dsh-tp-view-sub' }, sub) : null,
        ),
        actions ? h('div', { className: 'dsh-tp-view-head-actions' }, actions) : null,
      );
    }

    function DashboardView({ data, range, onRange, onRefresh, refreshing }) {
      const ov = (data && data.overview) || {};
      const used = Number(ov.usedQuota) || 0;
      const total = Number(ov.totalQuota) || 0;
      const pct = total > 0 ? Math.min(Math.round((used / total) * 100), 100) : 0;
      const daily = Array.isArray(data.dailyUsage) ? data.dailyUsage : [];
      const dist = Array.isArray(data.distribution) ? data.distribution : [];
      const tops = Array.isArray(data.topModels) ? data.topModels : [];
      const change = Number(ov.todayChangePercent);
      const nick = (data.accountInfo && (data.accountInfo.nickname || data.accountInfo.phone))
        || data.phoneHint || data.phone || '用户';
      const models = Array.isArray(ov.activeModels) ? ov.activeModels : [];
      const tags = Array.isArray(ov.planTags) ? ov.planTags : [];
      const distSum = dist.reduce((s, d) => s + (Number(d.percentage) || 0), 0) || 1;
      let dashOffset = 0;
      const arcs = dist.map((d, i) => {
        const share = ((Number(d.percentage) || 0) / distSum) * 440;
        const item = {
          color: DONUT_COLORS[i % DONUT_COLORS.length],
          dasharray: share + ' 440',
          dashoffset: -dashOffset,
        };
        dashOffset += share;
        return item;
      });
      return h('div', { className: 'dsh-tp-dash' },
        h('div', { className: 'dsh-tp-dash-head' },
          h('div', null,
            h('h2', null, '欢迎回来，' + nick),
            h('p', null, 'Token、API、AI 任务与云盘使用概览'),
          ),
          h('div', { className: 'dsh-tp-view-head-actions' },
            h('button', {
              type: 'button', className: 'dsh-tp-btn outline small',
              onClick: () => openUrl(consoleUrl(CONSOLE_PAGES.drive)),
            }, '进入我的云盘'),
            h('button', {
              type: 'button', className: 'dsh-tp-btn outline small', disabled: refreshing, onClick: onRefresh,
            }, refreshing ? '刷新中…' : '刷新'),
          ),
        ),
        h('div', { className: 'dsh-tp-stats' },
          h(StatCard, {
            label: '本月可用积分',
            footer: h('div', { className: 'dsh-tp-progress' },
              h('div', { className: 'dsh-tp-progress-bar' },
                h('div', { className: 'fill', style: { width: pct + '%' } }),
              ),
              h('div', { className: 'dsh-tp-progress-info' },
                h('span', null, '已用 ' + fmt(used) + ' 积分'),
                h('span', null, pct + '%'),
              ),
            ),
          },
            h('span', { className: 'val' }, fmt(ov.availableQuota)),
            h('span', { className: 'unit' }, ' / ' + fmt(total) + ' 积分'),
          ),
          h(StatCard, { label: '今日消耗' },
            h('span', { className: 'val green' }, fmt(ov.todayConsumed)),
            h('span', { className: 'unit' }, ' 积分'),
            h('div', { className: 'dsh-tp-change ' + (change >= 0 ? 'up' : 'down') },
              (change >= 0 ? '↗ +' : '↙ ') + (Number.isFinite(change) ? change : 0) + '% 较昨日'),
          ),
          h(StatCard, { label: '套餐类型' },
            h('div', { className: 'dsh-tp-tags' },
              tags.length
                ? tags.map((t, i) => h('div', { key: i, className: 'dsh-tp-tag' },
                    h('div', null, t.name || ''),
                    h('div', { className: 'sub' }, t.quotaText || ''),
                  ))
                : h('div', { className: 'dsh-tp-tag' },
                    h('div', null, ov.planShortName || '暂无套餐'),
                    h('div', { className: 'sub' }, '—'),
                  ),
            ),
          ),
          h(StatCard, { label: '已调用模型数（本月）' },
            h('span', { className: 'val' }, String(models.length)),
            h('span', { className: 'unit' }, ' 个模型'),
            h('div', { className: 'dsh-tp-badges' },
              models.slice(0, 4).map((m, i) => h('span', {
                key: i, className: 'dsh-tp-badge ' + BADGE[i % BADGE.length],
              }, m)),
              models.length > 4 ? h('span', { className: 'dsh-tp-badge orange' }, '+' + (models.length - 4)) : null,
            ),
          ),
        ),
        h('div', { className: 'dsh-tp-charts' },
          h('div', { className: 'dsh-tp-chart-card' },
            h('div', { className: 'dsh-tp-chart-head' },
              h('div', { className: 'title' }, '每日积分消耗趋势'),
              h('div', { className: 'dsh-tp-toggle' },
                h('button', { type: 'button', className: range === 7 ? 'active' : '', onClick: () => onRange(7) }, '近7天'),
                h('button', { type: 'button', className: range === 30 ? 'active' : '', onClick: () => onRange(30) }, '近30天'),
              ),
            ),
            daily.length
              ? h('div', { className: 'dsh-tp-bars' },
                  daily.map((d, i) => h('div', { className: 'bar-item', key: i },
                    h('div', { className: 'bar-value' }, fmt(d.totalQuota)),
                    h('div', { className: 'bar-wrap' },
                      h('div', { className: 'bar', style: { height: Math.max(4, d.percent || 0) + '%' } }),
                    ),
                    h('div', { className: 'bar-label' }, d.dateLabel || ''),
                  )),
                )
              : h('div', { className: 'dsh-tp-empty' }, '暂无数据'),
          ),
          h('div', { className: 'dsh-tp-chart-card' },
            h('div', { className: 'dsh-tp-chart-head' },
              h('div', { className: 'title' }, '积分消耗分布（按类型）'),
              h('div', { className: 'dsh-tp-toggle' },
                h('button', { type: 'button', className: range === 7 ? 'active' : '', onClick: () => onRange(7) }, '近7天'),
                h('button', { type: 'button', className: range === 30 ? 'active' : '', onClick: () => onRange(30) }, '近30天'),
              ),
            ),
            dist.length
              ? h('div', { className: 'dsh-tp-donut-row' },
                  h('div', { className: 'dsh-tp-donut' },
                    h('svg', { width: 140, height: 140, viewBox: '0 0 180 180' },
                      h('circle', { cx: 90, cy: 90, r: 70, fill: 'none', stroke: 'rgba(124,58,237,0.12)', strokeWidth: 22 }),
                      arcs.map((a, i) => h('circle', {
                        key: i, cx: 90, cy: 90, r: 70, fill: 'none', stroke: a.color, strokeWidth: 22,
                        strokeDasharray: a.dasharray, strokeDashoffset: a.dashoffset, strokeLinecap: 'round',
                        transform: 'rotate(-90 90 90)',
                      })),
                    ),
                    h('div', { className: 'center' },
                      h('div', { className: 'num' }, '100%'),
                      h('div', { className: 'txt' }, '总消耗'),
                    ),
                  ),
                  h('div', { className: 'dsh-tp-legend' },
                    dist.map((d, i) => h('div', { key: i, className: 'item' },
                      h('span', { className: 'dot', style: { background: DONUT_COLORS[i % DONUT_COLORS.length] } }),
                      h('span', { className: 'name' }, d.modelName || '—'),
                      h('span', { className: 'pct' }, (d.percentage || 0) + '%'),
                    )),
                  ),
                )
              : h('div', { className: 'dsh-tp-empty' }, '暂无数据'),
          ),
        ),
        h('div', { className: 'dsh-tp-rank' },
          h('div', { className: 'dsh-tp-section-title' }, '本月积分消耗最大模型'),
          tops.length
            ? h('div', { className: 'dsh-tp-rank-list' },
                tops.map((t, i) => h('div', { className: 'dsh-tp-rank-item', key: i },
                  h('div', { className: 'num' + (i < 3 ? ' top' : '') }, t.rank || (i + 1)),
                  h('div', {
                    className: 'avatar',
                    style: { background: t.avatarColor || DONUT_COLORS[i % DONUT_COLORS.length] },
                  }, t.avatarLetter || String(t.modelName || '?').slice(0, 1).toUpperCase()),
                  h('div', { className: 'info' },
                    h('div', { className: 'name' }, t.modelName || '—'),
                  ),
                  h('div', { className: 'credits' }, fmt(t.consumedQuota) + ' 积分'),
                )),
              )
            : h('div', { className: 'dsh-tp-empty' }, '暂无排行数据'),
        ),
      );
    }

    function PackagesView({ isEnterprise }) {
      const [tab, setTab] = useState('2');
      const [list, setList] = useState([]);
      const [loading, setLoading] = useState(false);
      const [err, setErr] = useState('');
      const [qrUrl, setQrUrl] = useState(null);
      const [qrTitle, setQrTitle] = useState('');

      const load = async (rt) => {
        setLoading(true); setErr('');
        const r = await jsonGet(API + '/packages?renewalType=' + rt);
        setLoading(false);
        if (!r || !r.ok) { setErr((r && r.error) || '加载失败'); setList([]); return }
        setList(Array.isArray(r.list) ? r.list : []);
      };

      useEffect(() => { load(tab); }, [tab]);

      const buy = (pkg) => {
        const productId = pkg.productId || pkg.id;
        if (productId === undefined || productId === null || productId === '') {
          openUrl(consoleUrl(CONSOLE_PAGES.pricing));
          return;
        }
        let detail = 'https://static-gateway.wasu.cn/upload/public/tokenMall/index.html#/pages/packageDetail'
          + '?id=' + encodeURIComponent(String(productId));
        if (String(pkg.renewalType) === '-1' && pkg.goodsDetailRelationId) {
          detail += '&goodsDetailRelationId=' + encodeURIComponent(String(pkg.goodsDetailRelationId));
        }
        setQrTitle(pkg.packageName || '购买套餐');
        setQrUrl('https://ups.wasu.cn/msm-local-biz/local/fission/getminiqrQr?url=' + encodeURIComponent(detail));
      };

      const tabs = [{ id: '2', label: '月付' }, { id: '1', label: '年付' }];
      if (!isEnterprise) tabs.push({ id: '-1', label: '加油包' });

      return h('div', { className: 'dsh-tp-view' },
        h(ViewHead, {
          title: 'Token套餐',
          sub: isEnterprise ? '企业账号请联系客户经理订购' : '月付 / 年付 / 加油包，微信扫码订购',
          actions: h('div', { className: 'dsh-tp-tabs' },
            tabs.map((t) => h('button', {
              key: t.id, type: 'button',
              className: 'dsh-tp-tab' + (tab === t.id ? ' active' : ''),
              onClick: () => setTab(t.id),
            }, t.label)),
          ),
        }),
        err ? h('div', { className: 'dsh-tp-err' }, err) : null,
        loading ? h('div', { className: 'dsh-tp-empty' }, '加载中…') : null,
        h('div', { className: 'dsh-tp-pkg-grid' },
          list.map((pkg, i) => {
            const price = pkg.priceValue != null ? pkg.priceValue : (pkg.promoPrice ?? pkg.originalPrice);
            const original = Number(pkg.originalPrice);
            const subscribed = !!pkg.subscribed;
            const canBuy = pkg.canSubscribe !== false;
            return h('div', { key: i, className: 'dsh-tp-pkg-card' + (subscribed ? ' subscribed' : '') },
              subscribed ? h('div', { className: 'dsh-tp-pkg-flag' }, '已购买') : null,
              h('div', { className: 'dsh-tp-pkg-name' }, pkg.packageName || '套餐'),
              h('div', { className: 'dsh-tp-pkg-sub' }, pkg.promoTitle || pkg.subtitle || '—'),
              Array.isArray(pkg.features) && pkg.features.length
                ? h('ul', { className: 'dsh-tp-pkg-feats' }, pkg.features.map((f, j) => h('li', { key: j }, f)))
                : null,
              h('div', { className: 'dsh-tp-pkg-price' },
                h('span', { className: 'promo' }, price != null ? fmtMoney(price) : '—'),
                Number.isFinite(original) && price != null && original > Number(price)
                  ? h('span', { className: 'orig' }, fmtMoney(original))
                  : null,
              ),
              h('button', {
                type: 'button', className: 'dsh-tp-btn primary block',
                disabled: subscribed || !canBuy || isEnterprise,
                onClick: () => buy(pkg),
              }, subscribed ? '已订购' : (isEnterprise ? '联系客户经理' : (canBuy ? '立即订购' : '不可订购'))),
            );
          }),
        ),
        !loading && !list.length ? h('div', { className: 'dsh-tp-empty' }, '暂无套餐') : null,
        h('div', { className: 'dsh-tp-note' },
          '订购与支付在官网完成：',
          h('button', {
            type: 'button', className: 'dsh-tp-link',
            onClick: () => openUrl(consoleUrl(CONSOLE_PAGES.pricing)),
          }, '打开 Token 套餐页'),
        ),
        h(QrModal, { url: qrUrl, title: qrTitle, onClose: () => setQrUrl(null) }),
      );
    }

    function KeysView() {
      const [list, setList] = useState([]);
      const [endpoint, setEndpoint] = useState(API_ENDPOINT);
      const [loading, setLoading] = useState(false);
      const [err, setErr] = useState('');
      const [msg, setMsg] = useState('');
      const [newName, setNewName] = useState('');
      const [busy, setBusy] = useState(false);
      const [visible, setVisible] = useState({});

      const load = async () => {
        setLoading(true); setErr('');
        const r = await jsonGet(API + '/keys');
        setLoading(false);
        if (!r || !r.ok) { setErr((r && r.error) || '加载失败'); return }
        setList(Array.isArray(r.list) ? r.list : []);
        if (r.endpoint) setEndpoint(r.endpoint);
      };

      useEffect(() => { load(); }, []);

      const createKey = async () => {
        const name = newName.trim();
        if (!name) { setErr('请输入密钥名称'); return }
        if (name.length > 30) { setErr('密钥名称最长 30 个字符'); return }
        setBusy(true); setErr(''); setMsg('');
        const r = await jsonPost(API + '/keys/create', { keyName: name });
        setBusy(false);
        if (!r || !r.ok) { setErr((r && r.error) || '创建失败'); return }
        setMsg('创建成功'); setNewName(''); load();
      };

      const deleteKey = async (keyId) => {
        if (!window.confirm('确定删除该密钥？此操作不可恢复。')) return;
        setBusy(true); setErr('');
        const r = await jsonPost(API + '/keys/delete', { keyId });
        setBusy(false);
        if (!r || !r.ok) { setErr((r && r.error) || '删除失败'); return }
        load();
      };

      const resetKey = async (row) => {
        if (!window.confirm('确定重置密钥「' + (row.keyName || '') + '」？重置后旧密钥将立即失效。')) return;
        setBusy(true); setErr(''); setMsg('');
        const r = await jsonPost(API + '/keys/reset', { keyId: row.keyId || row.id });
        setBusy(false);
        if (!r || !r.ok) { setErr((r && r.error) || '重置失败'); return }
        setMsg('重置成功，旧密钥已失效'); load();
      };

      const toggleKey = async (row) => {
        const enabled = Number(row.status) === 1 || row.status === true || row.status === 'ENABLED';
        const action = enabled ? 'DISABLED' : 'ENABLED';
        setBusy(true); setErr('');
        const r = await jsonPost(API + '/keys/status', { keyId: row.keyId || row.id, action });
        setBusy(false);
        if (!r || !r.ok) { setErr((r && r.error) || '状态更新失败'); return }
        load();
      };

      const copyKey = async (text) => {
        const ok = await copyText(text);
        setMsg(ok ? '已复制到剪贴板' : '复制失败');
      };

      return h('div', { className: 'dsh-tp-view' },
        h(ViewHead, {
          title: 'API密钥',
          sub: '用于调用 TokenPlan 平台的 AI 模型接口',
          actions: h('button', { type: 'button', className: 'dsh-tp-btn outline small', onClick: load, disabled: loading }, '刷新'),
        }),
        h('div', { className: 'dsh-tp-banner' },
          h('span', null, '接口地址：'),
          h('code', null, endpoint),
          h('button', {
            type: 'button', className: 'dsh-tp-btn outline small',
            onClick: () => copyKey(endpoint),
          }, '复制'),
        ),
        h('div', { className: 'dsh-tp-create-row' },
          h('input', {
            value: newName, placeholder: '新密钥名称（最长 30 字）', maxLength: 30,
            onChange: (e) => setNewName(e.target.value),
          }),
          h('button', {
            type: 'button', className: 'dsh-tp-btn primary', disabled: busy, onClick: createKey,
          }, '创建密钥'),
        ),
        err ? h('div', { className: 'dsh-tp-err' }, err) : null,
        msg ? h('div', { className: 'dsh-tp-ok' }, msg) : null,
        loading ? h('div', { className: 'dsh-tp-empty' }, '加载中…') : null,
        h('table', { className: 'dsh-tp-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, '名称'),
              h('th', null, '密钥'),
              h('th', null, '状态'),
              h('th', null, '创建时间'),
              h('th', null, '操作'),
            ),
          ),
          h('tbody', null,
            list.map((row, i) => {
              const kid = row.keyId || row.id || i;
              const show = !!visible[kid];
              const full = row.apiKey || '';
              const masked = row.apiKeyMasked || '****';
              const enabled = row.statusLabel
                ? row.statusLabel === '启用'
                : (Number(row.status) === 1 || row.status === 'ENABLED');
              const deletable = row.deletable !== false;
              return h('tr', { key: kid },
                h('td', null, row.keyName || '—'),
                h('td', { className: 'mono' },
                  show ? full : masked,
                  full ? h('button', {
                    type: 'button', className: 'dsh-tp-link', onClick: () => setVisible((v) => ({ ...v, [kid]: !show })),
                  }, show ? '隐藏' : '显示') : null,
                  full ? h('button', {
                    type: 'button', className: 'dsh-tp-link', onClick: () => copyKey(full),
                  }, '复制') : null,
                ),
                h('td', null,
                  h('span', { className: 'dsh-tp-status ' + (enabled ? 'on' : 'off') },
                    row.statusLabel || (enabled ? '启用' : '已停用')),
                ),
                h('td', null, fmtDate(row.createdTime)),
                h('td', { className: 'dsh-tp-actions' },
                  h('button', {
                    type: 'button', className: 'dsh-tp-btn outline small', disabled: busy,
                    onClick: () => toggleKey(row),
                  }, enabled ? '禁用' : '启用'),
                  h('button', {
                    type: 'button', className: 'dsh-tp-btn outline small warn', disabled: busy,
                    onClick: () => resetKey(row),
                  }, '重置'),
                  deletable
                    ? h('button', {
                      type: 'button', className: 'dsh-tp-btn ghost small', disabled: busy,
                      onClick: () => deleteKey(kid),
                    }, '删除')
                    : null,
                ),
              );
            }),
          ),
        ),
        !loading && !list.length ? h('div', { className: 'dsh-tp-empty' }, '暂无密钥') : null,
      );
    }

    function CreditsView() {
      const [credit, setCredit] = useState(null);
      const [orders, setOrders] = useState({ list: [], total: 0, page: 1, size: 10 });
      const [page, setPage] = useState(1);
      const [loading, setLoading] = useState(false);
      const [err, setErr] = useState('');
      const size = 10;

      const load = async (p) => {
        setLoading(true); setErr('');
        const r = await jsonGet(API + '/credits?page=' + p + '&size=' + size);
        setLoading(false);
        if (!r || !r.ok) { setErr((r && r.error) || '加载失败'); return }
        setCredit(r.credit || {});
        setOrders(r.orders || { list: [], total: 0, page: p, size });
        setPage(p);
      };

      useEffect(() => { load(1); }, []);

      const pkgs = (credit && Array.isArray(credit.packages)) ? credit.packages : [];
      const typeLabel = (t) => ({ MONTHLY: '包月', YEARLY: '包年', CONTINUOUS_MONTHLY: '连续包月' }[String(t).toUpperCase()] || t || '—');
      const statusLabel = (s) => ({ COMPLETED: '正常', EXPIRED: '过期', PENDING: '处理中' }[String(s).toUpperCase()] || s || '—');

      return h('div', { className: 'dsh-tp-view' },
        h(ViewHead, { title: '积分用量', sub: '积分（Credits）· 文本、图片、视频模型通用' }),
        err ? h('div', { className: 'dsh-tp-err' }, err) : null,
        h('div', { className: 'dsh-tp-section-title' }, '可用积分包'),
        h('div', { className: 'dsh-tp-credit-grid' },
          pkgs.map((p, i) => {
            const avail = Number(p.availableCredit) || 0;
            const total = Number(p.creditValue) || 0;
            const consumed = Number(p.consumedCredit) || Math.max(0, total - avail);
            const pct = total > 0 ? Math.min(100, Math.round((consumed / total) * 100)) : 0;
            return h('div', { key: i, className: 'dsh-tp-credit-card' },
              h('div', { className: 'name' },
                p.packageName || '积分包',
                pct >= 90 ? h('span', { className: 'dsh-tp-badge orange' }, avail === consumed ? '已用尽' : '即将用尽') : null,
              ),
              h('div', { className: 'nums' }, fmt(avail) + ' / ' + fmt(total)),
              h('div', { className: 'dsh-tp-progress-bar' },
                h('div', { className: 'fill' + (pct >= 90 ? ' warn' : ''), style: { width: pct + '%' } }),
              ),
              h('div', { className: 'dsh-tp-progress-info' },
                h('span', null, '已用 ' + fmt(consumed) + '（' + pct + '%）'),
                h('span', null, '剩余 ' + fmt(avail)),
              ),
              h('div', { className: 'expire' }, '到期：' + fmtDate(p.expireTime)),
            );
          }),
        ),
        !pkgs.length ? h('div', { className: 'dsh-tp-empty' }, '暂无积分包') : null,
        h('div', { className: 'dsh-tp-section-title' }, '积分订单'),
        loading ? h('div', { className: 'dsh-tp-empty' }, '加载中…') : null,
        h('table', { className: 'dsh-tp-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, '订单编号'),
              h('th', null, '套餐名称'),
              h('th', null, '类型'),
              h('th', null, '积分额度'),
              h('th', null, '有效期'),
              h('th', null, '状态'),
              h('th', null, '创建时间'),
            ),
          ),
          h('tbody', null,
            (orders.list || []).map((o, i) => h('tr', { key: i },
              h('td', { className: 'mono' }, o.orderNo || '—'),
              h('td', null, o.packageName || '—'),
              h('td', null, typeLabel(o.packageType)),
              h('td', null, fmt(o.quotaValue)),
              h('td', { className: 'small' }, fmtDay(o.startTime) + ' ~ ' + fmtDay(o.expireTime)),
              h('td', null, h('span', {
                className: 'dsh-tp-status ' + (String(o.status).toUpperCase() === 'COMPLETED' ? 'on' : 'off'),
              }, statusLabel(o.status))),
              h('td', null, fmtDate(o.createdTime)),
            )),
          ),
        ),
        h(Pagination, { page, size, total: orders.total || 0, onPage: load }),
      );
    }

    function OrdersView() {
      const [list, setList] = useState([]);
      const [total, setTotal] = useState(0);
      const [page, setPage] = useState(1);
      const [loading, setLoading] = useState(false);
      const [err, setErr] = useState('');
      const size = 10;

      const load = async (p) => {
        setLoading(true); setErr('');
        const r = await jsonGet(API + '/orders?page=' + p + '&size=' + size);
        setLoading(false);
        if (!r || !r.ok) { setErr((r && r.error) || '加载失败'); return }
        setList(Array.isArray(r.list) ? r.list : []);
        setTotal(Number(r.total) || 0);
        setPage(p);
      };

      useEffect(() => { load(1); }, []);

      return h('div', { className: 'dsh-tp-view' },
        h(ViewHead, {
          title: '订单中心',
          sub: '查看和管理您的所有订单记录',
          actions: h('button', { type: 'button', className: 'dsh-tp-btn outline small', onClick: () => load(page) }, '刷新'),
        }),
        err ? h('div', { className: 'dsh-tp-err' }, err) : null,
        loading ? h('div', { className: 'dsh-tp-empty' }, '加载中…') : null,
        h('table', { className: 'dsh-tp-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, '订单编号'),
              h('th', null, '套餐名称'),
              h('th', null, '规格信息'),
              h('th', null, '订单类型'),
              h('th', null, '下单时间'),
              h('th', null, '订单金额'),
              h('th', null, '状态'),
            ),
          ),
          h('tbody', null,
            list.map((o, i) => h('tr', { key: i },
              h('td', { className: 'mono' }, o.tradeSn || '—'),
              h('td', null, o.packageName || '—'),
              h('td', null, o.specInfo || '—'),
              h('td', null, o.orderType || '—'),
              h('td', null, fmtDate(o.orderTime)),
              h('td', null, fmtMoney(o.amount)),
              h('td', null, h('span', {
                className: 'dsh-tp-status ' + ([1, 2].includes(Number(o.status)) ? 'on' : 'off'),
              }, o.statusDesc || '—')),
            )),
          ),
        ),
        !loading && !list.length ? h('div', { className: 'dsh-tp-empty' }, '暂无订单') : null,
        h(Pagination, { page, size, total, onPage: load }),
      );
    }

    function LogsView() {
      const def = logDefaultRange();
      const [list, setList] = useState([]);
      const [total, setTotal] = useState(0);
      const [page, setPage] = useState(1);
      const [startTime, setStart] = useState(def.startTime);
      const [endTime, setEnd] = useState(def.endTime);
      const [loading, setLoading] = useState(false);
      const [err, setErr] = useState('');
      const size = 10;

      const load = async (p, overrides) => {
        const start = (overrides && overrides.start) || startTime;
        const end = (overrides && overrides.end) || endTime;
        setLoading(true); setErr('');
        const q = 'page=' + p + '&size=' + size
          + '&startTime=' + encodeURIComponent(start)
          + '&endTime=' + encodeURIComponent(end);
        const r = await jsonGet(API + '/logs?' + q);
        setLoading(false);
        if (!r || !r.ok) { setErr((r && r.error) || '加载失败'); return }
        setList(Array.isArray(r.list) ? r.list : []);
        setTotal(Number(r.total) || 0);
        setPage(p);
      };

      useEffect(() => { load(1); }, []);

      const quickRange = () => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 6);
        const s = dayStr(start) + ' 00:00:00';
        const e = dayStr(end) + ' 23:59:59';
        setStart(s); setEnd(e);
        load(1, { start: s, end: e });
      };

      return h('div', { className: 'dsh-tp-view' },
        h(ViewHead, { title: '使用记录', sub: '查看 API 调用与积分消耗统计' }),
        h('div', { className: 'dsh-tp-filters' },
          h('label', null, '开始',
            h('input', {
              type: 'datetime-local', value: startTime.slice(0, 16).replace(' ', 'T'),
              onChange: (e) => setStart(e.target.value.replace('T', ' ') + ':00'),
            }),
          ),
          h('label', null, '结束',
            h('input', {
              type: 'datetime-local', value: endTime.slice(0, 16).replace(' ', 'T'),
              onChange: (e) => setEnd(e.target.value.replace('T', ' ') + ':59'),
            }),
          ),
          h('button', {
            type: 'button', className: 'dsh-tp-btn primary small', onClick: () => load(1),
          }, '查询'),
          h('button', {
            type: 'button', className: 'dsh-tp-btn outline small', onClick: quickRange,
          }, '最近7天'),
        ),
        err ? h('div', { className: 'dsh-tp-err' }, err) : null,
        loading ? h('div', { className: 'dsh-tp-empty' }, '加载中…') : null,
        h('table', { className: 'dsh-tp-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, '调用时间'),
              h('th', null, '模型'),
              h('th', null, '结算类型'),
              h('th', null, '消耗积分'),
              h('th', null, '状态码'),
              h('th', null, '耗时(ms)'),
            ),
          ),
          h('tbody', null,
            list.map((row, i) => h('tr', { key: i },
              h('td', null, fmtDate(row.createdAt)),
              h('td', null, row.model || '—'),
              h('td', null, String(row.settlementStatus || '').toLowerCase() === 'ordered' ? '充值' : '消费'),
              h('td', null, fmt(row.usedCredit)),
              h('td', null, h('span', {
                className: 'dsh-tp-status ' + (Number(row.statusCode) === 200 ? 'on' : 'off'),
              }, row.statusCode != null ? String(row.statusCode) : '—')),
              h('td', null, row.latency != null ? String(row.latency) : '—'),
            )),
          ),
        ),
        !loading && !list.length ? h('div', { className: 'dsh-tp-empty' }, '暂无记录') : null,
        h(Pagination, { page, size, total, onPage: load }),
      );
    }

    function MessagesView({ onUnreadChange }) {
      const [list, setList] = useState([]);
      const [total, setTotal] = useState(0);
      const [page, setPage] = useState(1);
      const [readStatus, setReadStatus] = useState('');
      const [sortBy, setSortBy] = useState('delivered');
      const [loading, setLoading] = useState(false);
      const [err, setErr] = useState('');
      const [detail, setDetail] = useState(null);
      const size = 10;

      const load = async (p, overrides) => {
        const rs = overrides && Object.prototype.hasOwnProperty.call(overrides, 'readStatus')
          ? overrides.readStatus : readStatus;
        const sb = (overrides && overrides.sortBy) || sortBy;
        setLoading(true); setErr('');
        let q = 'page=' + p + '&size=' + size + '&sortBy=' + sb;
        if (rs === '0' || rs === '1') q += '&readStatus=' + rs;
        const r = await jsonGet(API + '/messages?' + q);
        setLoading(false);
        if (!r || !r.ok) { setErr((r && r.error) || '加载失败'); return }
        setList(Array.isArray(r.list) ? r.list : []);
        setTotal(Number(r.total) || 0);
        setPage(p);
      };

      const refreshUnread = async () => {
        const u = await jsonGet(API + '/messages/unread');
        if (u && u.ok && typeof onUnreadChange === 'function') onUnreadChange(Number(u.unread) || 0);
      };

      useEffect(() => { load(1); refreshUnread(); }, [readStatus, sortBy]);

      const open = async (row) => {
        setDetail(row);
        if (Number(row.readStatus) === 0) {
          const r = await jsonPost(API + '/messages/read', { ids: [row.id] });
          if (r && r.ok) {
            setList((prev) => prev.map((x) => (x.id === row.id
              ? { ...x, readStatus: 1, readTime: new Date().toISOString() }
              : x)));
            refreshUnread();
          }
        }
      };

      const readAll = async () => {
        setErr('');
        const r = await jsonPost(API + '/messages/read', { ids: [] });
        if (!r || !r.ok) { setErr((r && r.error) || '标记失败'); return }
        await load(page);
        refreshUnread();
      };

      const unreadCount = list.filter((m) => Number(m.readStatus) === 0).length;

      return h('div', { className: 'dsh-tp-view' },
        h(ViewHead, {
          title: '消息中心',
          sub: unreadCount > 0 ? ('本页 ' + unreadCount + ' 条未读') : '来自 Token Space 团队的通知',
          actions: h('div', { className: 'dsh-tp-view-head-actions' },
            h('button', {
              type: 'button', className: 'dsh-tp-btn outline small', onClick: readAll,
            }, '全部标记已读'),
            h('button', {
              type: 'button', className: 'dsh-tp-btn outline small', onClick: () => load(page),
            }, '刷新'),
          ),
        }),
        h('div', { className: 'dsh-tp-toolbar' },
          h('div', { className: 'dsh-tp-tabs' },
            [['', '全部'], ['0', '未读'], ['1', '已读']].map(([v, label]) =>
              h('button', {
                key: label, type: 'button',
                className: 'dsh-tp-tab' + (readStatus === v ? ' active' : ''),
                onClick: () => { setReadStatus(v); setPage(1); },
              }, label)),
          ),
          h('select', {
            className: 'dsh-tp-select', value: sortBy,
            onChange: (e) => setSortBy(e.target.value),
          },
            h('option', { value: 'delivered' }, '按时间排序'),
            h('option', { value: 'priority' }, '按优先级排序'),
          ),
        ),
        err ? h('div', { className: 'dsh-tp-err' }, err) : null,
        loading ? h('div', { className: 'dsh-tp-empty' }, '加载中…') : null,
        h('div', { className: 'dsh-tp-msg-list' },
          list.map((m) => h('div', {
            key: m.id, className: 'dsh-tp-msg' + (Number(m.readStatus) === 0 ? ' unread' : ''),
            onClick: () => open(m),
          },
            h('div', { className: 'head' },
              h('span', { className: 'dsh-tp-badge' }, m.typeLabel || '系统消息'),
              String(m.priority).toUpperCase() === 'IMPORTANT'
                ? h('span', { className: 'dsh-tp-badge orange' }, '重要')
                : null,
              Number(m.recalled) === 1 ? h('span', { className: 'dsh-tp-badge' }, '已撤回') : null,
              h('span', { className: 'time' }, relTime(m.deliveredTime)),
            ),
            h('div', { className: 'title' },
              Number(m.readStatus) === 0 ? h('span', { className: 'dot' }) : null,
              m.title || '(无标题)',
            ),
            h('div', { className: 'body' }, m.content || ''),
          )),
        ),
        !loading && !list.length ? h('div', { className: 'dsh-tp-empty' }, '暂无消息') : null,
        h(Pagination, { page, size, total, onPage: load }),
        detail
          ? h('div', { className: 'dsh-tp-modal-backdrop', onClick: () => setDetail(null) },
              h('div', { className: 'dsh-tp-modal wide', onClick: (e) => e.stopPropagation() },
                h('div', { className: 'dsh-tp-modal-head' },
                  h('span', null, detail.title || '消息详情'),
                  h('button', {
                    type: 'button', className: 'dsh-tp-btn ghost small', onClick: () => setDetail(null),
                  }, '关闭'),
                ),
                h('div', { className: 'dsh-tp-modal-meta' },
                  h('span', null, detail.typeLabel || '系统消息'),
                  h('span', null, relTime(detail.deliveredTime)),
                  Number(detail.readStatus) === 1 && detail.readTime
                    ? h('span', null, '已读于 ' + relTime(detail.readTime))
                    : null,
                ),
                h('div', { className: 'dsh-tp-modal-body' }, detail.content || ''),
                detail.jumpUrl && Number(detail.recalled) !== 1
                  ? h('button', {
                    type: 'button', className: 'dsh-tp-btn primary',
                    onClick: () => openUrl(detail.jumpUrl),
                  }, '去处理')
                  : null,
              ),
            )
          : null,
      );
    }

    function DriveView() {
      const [usage, setUsage] = useState(null);
      const [loading, setLoading] = useState(false);
      const [err, setErr] = useState('');

      const load = async () => {
        setLoading(true); setErr('');
        const r = await jsonGet(API + '/drive');
        setLoading(false);
        if (!r || !r.ok) { setErr((r && r.error) || '加载失败'); return }
        setUsage(r.usage || null);
      };

      useEffect(() => { load(); }, []);

      const links = [
        ['个人云盘', CONSOLE_PAGES.drive],
        ['文件', CONSOLE_PAGES.driveFiles],
        ['相册', CONSOLE_PAGES.driveAlbums],
        ['AI作品', CONSOLE_PAGES.driveAssets],
        ['云盘套餐', CONSOLE_PAGES.drivePlans],
        ['回收站', CONSOLE_PAGES.driveRecycle],
      ];

      return h('div', { className: 'dsh-tp-view' },
        h(ViewHead, {
          title: '我的云盘',
          sub: 'AI 生成内容自动归档到云盘',
          actions: h('button', { type: 'button', className: 'dsh-tp-btn outline small', onClick: load, disabled: loading }, '刷新'),
        }),
        err ? h('div', { className: 'dsh-tp-err' }, err) : null,
        loading && !usage ? h('div', { className: 'dsh-tp-empty' }, '加载中…') : null,
        usage
          ? h('div', { className: 'dsh-tp-stat drive-stat' },
              h('div', { className: 'dsh-tp-stat-label' }, '云盘空间'),
              h('div', { className: 'dsh-tp-stat-body' },
                h('span', { className: 'val' }, usage.usedText),
                h('span', { className: 'unit' }, ' / ' + usage.totalText),
              ),
              h('div', { className: 'dsh-tp-progress' },
                h('div', { className: 'dsh-tp-progress-bar' },
                  h('div', { className: 'fill' + (usage.percent >= 80 ? ' warn' : ''), style: { width: usage.percent + '%' } }),
                ),
                h('div', { className: 'dsh-tp-progress-info' },
                  h('span', null, '剩余 ' + usage.freeText),
                  h('span', null, usage.percent + '%'),
                ),
              ),
              h('div', { className: 'dsh-tp-progress-info drive-split' },
                h('span', null, '文件 ' + usage.filesText),
                h('span', null, '相册 ' + usage.albumsText),
              ),
            )
          : null,
        usage && usage.percent >= 80
          ? h('div', { className: 'dsh-tp-note warn' }, '云盘空间接近上限，可在官网「云盘套餐」页扩容。')
          : null,
        h('div', { className: 'dsh-tp-section-title' }, '云盘页面'),
        h('div', { className: 'dsh-tp-tool-grid' },
          links.map(([label, page]) => h('button', {
            key: label, type: 'button', className: 'dsh-tp-tool-card',
            onClick: () => openUrl(consoleUrl(page)),
          },
            h('div', { className: 'title' }, label),
            h('div', { className: 'sub' }, '在官网打开'),
          )),
        ),
      );
    }

    /** Read a browser File as a base64 data URL (no prefix stripping here). */
    const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
        reader.readAsDataURL(file);
      } catch (err) { reject(err); }
    });

    /** Lightbox for one gallery item: image preview or video playback. */
    function MediaLightbox({ item, onClose }) {
      useEffect(() => {
        if (!item) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [item]);
      if (!item) return null;
      const url = item.url || (item.urls && item.urls[0]) || '';
      return h('div', { className: 'dsh-tp-lightbox', onClick: onClose },
        h('div', { className: 'dsh-tp-lightbox-body', onClick: (e) => e.stopPropagation() },
          url
            ? (item.kind === 'video'
              ? h('video', { src: url, controls: true, autoPlay: true, playsInline: true, className: 'dsh-tp-lightbox-media' })
              : h('img', { src: url, alt: item.title || '', className: 'dsh-tp-lightbox-media' }))
            : h('div', { className: 'dsh-tp-lightbox-missing' }, '该作品暂无可预览地址'),
          h('div', { className: 'dsh-tp-lightbox-meta' },
            h('div', { className: 'title' }, item.title || item.model || '作品'),
            h('div', { className: 'sub' },
              [item.source === 'drive' ? '我的云盘·AI作品' : '生成记录', item.model, relTime(item.createdAt)]
                .filter(Boolean).join(' · ')),
            item.meta ? h('div', { className: 'sub' }, item.meta) : null,
          ),
          h('div', { className: 'dsh-tp-lightbox-actions' },
            url ? h('button', { type: 'button', className: 'dsh-tp-btn small', onClick: () => openUrl(url) }, '新标签打开') : null,
            url ? h('a', { className: 'dsh-tp-btn outline small', href: url, download: '', target: '_blank', rel: 'noreferrer' }, '下载') : null,
            h('button', { type: 'button', className: 'dsh-tp-btn outline small', onClick: onClose }, '关闭'),
          ),
        ),
      );
    }

    /** One tile in a media grid. */
    function MediaTile({ item, onOpen }) {
      const url = item.url || (item.urls && item.urls[0]) || '';
      const failed = !url && (item.status === 'failed' || item.error);
      return h('div', {
        className: 'dsh-tp-media' + (item.pending ? ' pending' : '') + (failed ? ' failed' : ''),
        onClick: () => { if (url) onOpen(item); },
        title: item.prompt || item.title || '',
      },
        h('div', { className: 'thumb' },
          url && item.kind === 'video'
            ? h('video', { src: url, muted: true, playsInline: true, preload: 'metadata' })
            : null,
          url && item.kind !== 'video'
            ? h('img', { src: url, alt: item.title || '', loading: 'lazy' })
            : null,
          !url
            ? h('div', { className: 'ph' },
                item.pending ? '生成中…' : failed ? '生成失败' : (item.kind === 'video' ? '视频' : '图片'))
            : null,
          item.kind === 'video' && url ? h('span', { className: 'badge-video' }, '▶ ' + (item.duration ? item.duration + 's' : '视频')) : null,
          item.pending && url ? h('span', { className: 'badge-state' }, item.progress || '生成中') : null,
        ),
        h('div', { className: 'meta' },
          h('div', { className: 'model' },
            (item.source === 'drive' ? '☁ ' : '✦ ') + (item.model || item.title || '作品')),
          h('div', { className: 'time' }, relTime(item.createdAt)),
          h('div', { className: 'params' }, item.meta || (item.prompt ? String(item.prompt).slice(0, 40) : '—')),
        ),
      );
    }

    /**
     * Session-authorized URL for one durable attachment produced by a tool call.
     * Images come from the conversation's own loader (cached per session, so a
     * replayed call is a cache hit); the upstream CDN URL is the fallback for
     * everything the loader does not serve.
     */
    function useAttachmentMediaUrl(attachment, loadImage, fallback) {
      const id = attachment ? String(attachment.attachmentId || '') : '';
      const [url, setUrl] = useState('');
      useEffect(() => {
        let dead = false;
        const fb = fallback || '';
        if (!id) { setUrl(fb); return undefined; }
        let peeked = '';
        try {
          if (typeof loadImage === 'function' && typeof loadImage.peek === 'function') {
            peeked = loadImage.peek(attachment) || '';
          }
        } catch { peeked = ''; }
        if (peeked) { setUrl(peeked); return undefined; }
        setUrl(fb);
        if (typeof loadImage === 'function') {
          try {
            Promise.resolve(loadImage(attachment))
              .then((loaded) => { if (!dead && typeof loaded === 'string' && loaded) setUrl(loaded); })
              .catch(() => { /* the CDN fallback stays in place */ });
          } catch { /* a throwing loader keeps the CDN fallback */ }
        }
        return () => { dead = true; };
      }, [id, fallback]);
      return url;
    }

    /** One produced medium inside the inline tool card. */
    function ToolMediaThumb({ attachment, loadImage, fallback, kind, onOpen }) {
      const url = useAttachmentMediaUrl(attachment, loadImage, fallback);
      const label = (attachment && attachment.name) || (kind === 'video' ? '生成视频' : '生成图片');
      return h('div', {
        className: 'dsh-tp-toolcard-thumb' + (url ? '' : ' pending'),
        onClick: () => { if (url) onOpen({ kind, url, title: label, model: '', source: 'tasks' }); },
      },
        url && kind === 'video' ? h('video', { src: url, controls: true, playsInline: true, preload: 'metadata' }) : null,
        url && kind !== 'video' ? h('img', { src: url, alt: label, loading: 'lazy' }) : null,
        !url ? h('span', { className: 'ph' }, kind === 'video' ? '视频加载中…' : '图片加载中…') : null,
      );
    }

    /** Best-effort prompt from a call's raw arguments; never throws. */
    const argsPrompt = (call) => {
      try {
        const raw = call && call.argsRaw
        if (typeof raw !== 'string' || !raw) return ''
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed.prompt === 'string' ? parsed.prompt : ''
      } catch { return '' }
    }

    /**
     * Upstream links carried by the summary text. `presentationMeta` is only
     * projected for top-level calls, so a nested (run_code) call has no `meta`
     * and this is what still gives the card a playable link.
     */
    const urlsFromText = (texts) => {
      const out = []
      for (const text of texts || []) {
        const hits = String(text).match(/https?:\/\/[^\s)"']+/g)
        if (!hits) continue
        for (const hit of hits) if (!out.includes(hit)) out.push(hit)
      }
      return out
    }

    /**
     * Inline card for one `generate_image` / `generate_video` call in the
     * conversation (the DSH `tool.call.toolview` keyed seat). The model-facing
     * content carries the produced media as attachment blocks, so the card just
     * lifts them out and renders them; `meta` supplies the prompt/model/link.
     */
    function GeneratedMediaCard(props) {
      const block = (props && props.block) || {};
      const settled = block && typeof block === 'object' && 'kind' in block ? block : null;
      const [open, setOpen] = useState(null);
      const meta = (settled && settled.meta) || {};
      const content = settled && Array.isArray(settled.content) ? settled.content : [];
      const texts = content
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text);
      const toolName = (props && props.toolName) || '';
      const kind = meta.kind || (toolName === 'generate_video' ? 'video' : 'image');
      const urls = (Array.isArray(meta.urls) && meta.urls.length) ? meta.urls : urlsFromText(texts);
      const failed = Boolean(settled && settled.isError);
      const title = (kind === 'video' ? '视频生成' : '图片生成') + (meta.model ? ' · ' + meta.model : '');
      const prompt = String(meta.prompt || argsPrompt(settled ? settled.call : block) || '');
      const head = h('div', { className: 'dsh-tp-toolcard-head' },
        h('span', { className: 'dsh-tp-toolcard-title' }, title),
        h('span', { className: 'dsh-tp-toolcard-state' + (failed ? ' failed' : '') },
          failed ? '失败' : (settled ? (meta.status === 'succeeded' || !meta.status ? '完成' : meta.status) : '生成中')),
      );

      if (!settled) {
        return h('section', { className: 'dsh-tp-toolcard pending' }, head,
          h('div', { className: 'dsh-tp-toolcard-note' },
            kind === 'video' ? '视频生成中，通常需要几分钟…' : '图片生成中…'),
          prompt ? h('div', { className: 'dsh-tp-toolcard-prompt' }, prompt.slice(0, 200)) : null);
      }

      if (failed) {
        return h('section', { className: 'dsh-tp-toolcard failed' }, head,
          h('div', { className: 'dsh-tp-toolcard-note err' }, texts.join('\n') || '生成失败'),
          prompt ? h('div', { className: 'dsh-tp-toolcard-prompt' }, prompt.slice(0, 200)) : null);
      }

      const media = content.filter((b) => b && (b.type === 'image' || b.type === 'file') && b.attachment);
      // A settled call persisted before the result projection carried media (or
      // meta) has nothing to show; render no card rather than a wrong one.
      if (!media.length && !meta.kind && !meta.taskId && !meta.status) return null;
      return h('section', { className: 'dsh-tp-toolcard' },
        head,
        media.length
          ? h('div', { className: 'dsh-tp-toolcard-media' },
              media.map((b, index) => h(ToolMediaThumb, {
                key: String((b.attachment && b.attachment.attachmentId) || index),
                attachment: b.attachment,
                // Only image refs resolve through the conversation's loader; a
                // video/audio ref plays straight from the upstream link.
                loadImage: b.type === 'image' ? (props && props.loadImage) : null,
                fallback: urls[index] || urls[0] || '',
                kind,
                onOpen: setOpen,
              })))
          : h('div', { className: 'dsh-tp-toolcard-note' },
              urls.length ? '成品已生成，点下方链接查看（未能内联预览）' : '上游未返回可访问的作品地址'),
        meta.prompt || prompt ? h('div', { className: 'dsh-tp-toolcard-prompt' }, prompt.slice(0, 200)) : null,
        urls.length
          ? h('div', { className: 'dsh-tp-toolcard-actions' },
              h('button', {
                type: 'button', className: 'dsh-tp-btn outline small',
                onClick: () => openUrl(urls[0]),
              }, '新标签打开'),
              h('a', {
                className: 'dsh-tp-btn outline small', href: urls[0], download: '', target: '_blank', rel: 'noreferrer',
              }, '下载'))
          : null,
        h(MediaLightbox, { item: open, onClose: () => setOpen(null) }),
      );
    }

    /**
     * Shared gallery feed: 我的云盘-AI作品 + 生成记录, merged by the host under
     * `GET /gallery`. Used by the conversation-view 画廊 tab and by the panel.
     */
    function useGalleryFeed(options) {
      const { kind, source, size } = options || {};
      const [state, setState] = useState({ items: [], counts: null, sources: null, total: 0, loading: true, err: '' });
      const [tick, setTick] = useState(0);
      const reload = () => setTick((n) => n + 1);
      useEffect(() => {
        let dead = false;
        setState((s) => ({ ...s, loading: true }));
        const qs = new URLSearchParams({ page: '1', size: String(size || 48) });
        if (kind && kind !== 'all') qs.set('kind', kind);
        if (source && source !== 'all') qs.set('source', source);
        jsonGet(API + '/gallery?' + qs.toString()).then((r) => {
          if (dead) return;
          if (!r || !r.ok) {
            setState({ items: [], counts: null, sources: null, total: 0, loading: false, err: (r && r.error) || '画廊加载失败' });
            return;
          }
          setState({
            items: Array.isArray(r.items) ? r.items : [],
            counts: r.counts || null,
            sources: r.sources || null,
            total: Number(r.total) || 0,
            loading: false,
            err: '',
            loggedIn: r.loggedIn !== false,
          });
        });
        return () => { dead = true; };
      }, [kind, source, size, tick]);
      const pending = state.items.some((i) => i.pending);
      useEffect(() => {
        if (!pending) return undefined;
        const t = setInterval(reload, 5000);
        return () => clearInterval(t);
      }, [pending, tick]);
      return { ...state, reload };
    }

    function GalleryToolbar({ value, onChange, source, onSource, counts, onRefresh, loading }) {
      const tabs = [['all', '全部'], ['image', '图片'], ['video', '视频']];
      const sources = [['all', '全部来源'], ['drive', '我的云盘·AI作品'], ['tasks', '生成记录']];
      return h('div', { className: 'dsh-tp-gallery-bar' },
        h('div', { className: 'dsh-tp-tabs' },
          tabs.map(([v, label]) => h('button', {
            key: v, type: 'button',
            className: 'dsh-tp-tab' + (value === v ? ' active' : ''),
            onClick: () => onChange(v),
          }, label + (counts && counts[v] !== undefined ? ' ' + counts[v] : '')))),
        h('div', { className: 'dsh-tp-gallery-bar-right' },
          h('select', {
            className: 'dsh-tp-select small',
            value: source,
            onChange: (e) => onSource(e.target.value),
          }, sources.map(([v, label]) => h('option', { key: v, value: v }, label))),
          h('button', { type: 'button', className: 'dsh-tp-btn outline small', onClick: onRefresh, disabled: !!loading }, '刷新'),
        ),
      );
    }

    /** The conversation-window 画廊 tab (DSH `conversation.view` seat). */
    function GalleryView() {
      const st = useStore();
      const [kind, setKind] = useState('all');
      const [source, setSource] = useState('all');
      const [open, setOpen] = useState(null);
      const feed = useGalleryFeed({ kind, source, size: 48 });
      return h('div', { className: 'dsh-tp-gallery-view' },
        h('div', { className: 'dsh-tp-gallery-head' },
          h('div', null,
            h('div', { className: 'dsh-tp-gallery-title' }, '华数 AI 画廊'),
            h('div', { className: 'dsh-tp-gallery-sub' }, '「我的云盘 · AI作品」与生成记录自动同步')),
          h('div', { className: 'dsh-tp-gallery-head-actions' },
            h('span', { className: 'dsh-tp-gallery-quota' },
              st.loggedIn ? ('可用积分 ' + fmt(st.availableQuota)) : '未登录'),
            h('button', {
              type: 'button', className: 'dsh-tp-btn small',
              onClick: () => setStore({ open: true, nav: 'creation' }),
            }, '去生成'),
          ),
        ),
        h(GalleryToolbar, {
          value: kind, onChange: setKind,
          source, onSource: setSource,
          counts: feed.counts, onRefresh: feed.reload, loading: feed.loading,
        }),
        feed.err ? h('div', { className: 'dsh-tp-err' }, feed.err) : null,
        feed.loggedIn === false
          ? h('div', { className: 'dsh-tp-empty' },
              '尚未登录华数 AI Store。',
              h('button', {
                type: 'button', className: 'dsh-tp-link',
                onClick: () => setStore({ open: true, nav: 'dashboard' }),
              }, '打开 AI Store 面板登录'))
          : null,
        feed.loading && !feed.items.length ? h('div', { className: 'dsh-tp-empty' }, '加载中…') : null,
        h('div', { className: 'dsh-tp-media-grid' },
          feed.items.map((item) => h(MediaTile, { key: item.id, item, onOpen: setOpen }))),
        !feed.loading && feed.loggedIn !== false && !feed.items.length
          ? h('div', { className: 'dsh-tp-empty' },
              '暂无作品。在对话里让助手「生成一张图 / 生成一段视频」，或在 AI Store 面板的 AI创作 页提交任务。')
          : null,
        feed.sources && feed.sources.drive && feed.sources.drive.ok === false
          ? h('div', { className: 'dsh-tp-note' }, '云盘 AI作品 暂时不可用：' + (feed.sources.drive.error || '未知错误') + '（已展示生成记录）')
          : null,
        h(MediaLightbox, { item: open, onClose: () => setOpen(null) }),
      );
    }

    /** The panel's AI创作 page: generation form + live task history. */
    function CreationView() {
      const store = useStore();
      const [kind, setKind] = useState('image');
      const [models, setModels] = useState([]);
      const [model, setModel] = useState('');
      const [prompt, setPrompt] = useState('');
      const [ratio, setRatio] = useState('');
      const [resolution, setResolution] = useState('');
      const [duration, setDuration] = useState('');
      const [imageCount, setImageCount] = useState(1);
      const [watermark, setWatermark] = useState(false);
      const [negative, setNegative] = useState('');
      const [busy, setBusy] = useState(false);
      const [optimizing, setOptimizing] = useState(false);
      const [refs, setRefs] = useState([]);
      const [uploading, setUploading] = useState(false);
      const [notice, setNotice] = useState(null);
      const [open, setOpen] = useState(null);
      const [version, setVersion] = useState(0);
      const feed = useGalleryFeed({ kind: 'all', source: 'tasks', size: 24 });

      useEffect(() => {
        let dead = false;
        jsonGet(API + '/creation/models').then((r) => {
          if (dead || !r || !r.ok) return;
          setModels(Array.isArray(r.list) ? r.list : []);
        });
        return () => { dead = true; };
      }, []);

      const pool = useMemo(() => models.filter((m) => m.kind === kind), [models, kind]);
      const active = useMemo(() => pool.find((m) => m.id === model) || pool[0] || null, [pool, model]);

      // Keep the option fields legal for whichever model is selected.
      useEffect(() => {
        if (!active) return;
        if (!active.ratios.includes(ratio)) setRatio(active.ratios[0] || '');
        if (!active.resolutions.includes(resolution)) setResolution(active.resolutions[0] || '');
        if (kind === 'video' && !active.durations.map(String).includes(String(duration))) {
          setDuration(String(active.durations[0] || 5));
        }
        setImageCount((n) => Math.min(Math.max(1, Number(active.maxImages) || 1), Math.max(1, n)));
      }, [active, kind, version]);

      const cost = active
        ? (kind === 'video'
          ? (active.videoPrice || 0) * (Number(duration) || 0)
          : (active.imagePrice || 0) * Math.max(1, Number(imageCount) || 1))
        : 0;

      const submit = async () => {
        if (!prompt.trim()) { setNotice({ kind: 'err', text: '请填写提示词' }); return; }
        if (!active) { setNotice({ kind: 'err', text: '没有可用的模型' }); return; }
        setBusy(true); setNotice(null);
        const body = {
          kind, model: active.id, prompt: prompt.trim(),
          ratio, resolution, watermark, negativePrompt: negative.trim(),
        };
        if (refs.length) body.referenceFiles = refs.map((f) => ({ type: f.type, url: f.filePath }));
        if (kind === 'video') body.duration = Number(duration) || undefined;
        else body.imageCount = Number(imageCount) || 1;
        const r = await jsonPost(API + '/creation/submit', body);
        setBusy(false);
        if (!r || !r.ok) { setNotice({ kind: 'err', text: (r && r.error) || '提交失败' }); return; }
        setNotice({ kind: 'ok', text: '任务已提交，正在生成…（预计消耗 ' + fmt(r.request && r.request.estimatedCost) + ' 积分）' });
        feed.reload();
      };

      /**
       * Reference material for image-to-image / image-to-video. The bytes go to
       * the host, which uploads them to `pcweb/creation/upload` and hands back
       * the object key the submit payload needs.
       */
      const addReferences = async (fileList) => {
        const picked = Array.from(fileList || []);
        if (!picked.length) return;
        setUploading(true); setNotice(null);
        const added = [];
        for (const file of picked) {
          try {
            const dataUrl = await readFileAsDataUrl(file);
            const r = await jsonPost(API + '/creation/upload', {
              name: file.name,
              contentType: file.type || '',
              data: dataUrl,
            });
            if (!r || !r.ok) { setNotice({ kind: 'err', text: (file.name || '文件') + '：' + ((r && r.error) || '上传失败') }); continue; }
            const type = String(file.type || '').startsWith('audio/')
              ? 'audio'
              : String(file.type || '').startsWith('video/')
                ? 'file'
                : 'reference';
            added.push({ name: file.name, filePath: r.filePath, type, size: r.size });
          } catch (err) {
            setNotice({ kind: 'err', text: (file.name || '文件') + '：读取失败' });
          }
        }
        setUploading(false);
        if (added.length) setRefs((list) => [...list, ...added]);
      };

      const removeReference = (path) => setRefs((list) => list.filter((f) => f.filePath !== path));

      const optimize = async () => {
        if (!prompt.trim()) { setNotice({ kind: 'err', text: '请先填写提示词' }); return; }
        setOptimizing(true);
        const r = await jsonPost(API + '/creation/optimize-prompt', { prompt: prompt.trim(), kind });
        setOptimizing(false);
        if (!r || !r.ok) { setNotice({ kind: 'err', text: (r && r.error) || '优化失败' }); return; }
        if (r.prompt) setPrompt(r.prompt);
      };

      const opt = (label, value, onChange, options, hint) => h('label', { className: 'dsh-tp-field' },
        h('span', null, label),
        h('select', { className: 'dsh-tp-select', value, onChange: (e) => onChange(e.target.value) },
          options.map((o) => h('option', { key: String(o), value: String(o) }, String(o)))),
        hint ? h('em', null, hint) : null,
      );

      return h('div', { className: 'dsh-tp-view' },
        h(ViewHead, {
          title: 'AI创作',
          sub: '直接调用华数 AI Store 图片/视频生成，作品自动进入我的云盘-AI作品',
          actions: h('div', { className: 'dsh-tp-view-head-actions' },
            h('button', { type: 'button', className: 'dsh-tp-btn outline small', onClick: () => openUrl(consoleUrl(CONSOLE_PAGES.imageGen)) }, '官网图片生成'),
            h('button', { type: 'button', className: 'dsh-tp-btn outline small', onClick: () => openUrl(consoleUrl(CONSOLE_PAGES.videoGen)) }, '官网视频生成'),
          ),
        }),
        h('div', { className: 'dsh-tp-studio' },
          h('div', { className: 'dsh-tp-tabs' },
            [['image', '图片生成'], ['video', '视频生成']].map(([v, label]) => h('button', {
              key: v, type: 'button',
              className: 'dsh-tp-tab' + (kind === v ? ' active' : ''),
              onClick: () => { setKind(v); setModel(''); setVersion((n) => n + 1); },
            }, label))),

          h('label', { className: 'dsh-tp-field' },
            h('span', null, '模型'),
            h('select', {
              className: 'dsh-tp-select', value: active ? active.id : '',
              onChange: (e) => { setModel(e.target.value); setVersion((n) => n + 1); },
            }, (pool.length ? pool : [{ id: '', name: '加载中…' }]).map((m) => h('option', { key: m.id, value: m.id },
              m.name + (m.kind === 'video'
                ? (m.videoPrice ? '（' + m.videoPrice + ' 积分/秒）' : '')
                : (m.imagePrice ? '（' + m.imagePrice + ' 积分/张）' : ''))))),
            active && active.description ? h('em', null, String(active.description).slice(0, 70)) : null,
          ),

          h('label', { className: 'dsh-tp-field wide' },
            h('span', null, '提示词'),
            h('textarea', {
              className: 'dsh-tp-textarea', rows: 4, value: prompt,
              placeholder: kind === 'video' ? '描述想要的画面、运镜与氛围…' : '描述想要的画面…',
              onChange: (e) => setPrompt(e.target.value),
            }),
            h('div', { className: 'dsh-tp-field-actions' },
              h('button', { type: 'button', className: 'dsh-tp-btn outline small', onClick: optimize, disabled: optimizing },
                optimizing ? '优化中…' : 'AI 优化提示词'),
            ),
          ),

          h('div', { className: 'dsh-tp-field-row' },
            opt('比例', ratio, setRatio, active && active.ratios.length ? active.ratios : ['1:1']),
            opt('分辨率', resolution, setResolution, active && active.resolutions.length ? active.resolutions : ['1k']),
            kind === 'video'
              ? opt('时长（秒）', String(duration), setDuration, (active && active.durations.length ? active.durations : [5]).map(String))
              : h('label', { className: 'dsh-tp-field' },
                  h('span', null, '张数'),
                  h('input', {
                    className: 'dsh-tp-input', type: 'number', min: 1,
                    max: (active && active.maxImages) || 4, value: imageCount,
                    onChange: (e) => setImageCount(Number(e.target.value) || 1),
                  })),
            h('label', { className: 'dsh-tp-field checkbox' },
              h('span', null, '水印'),
              h('input', { type: 'checkbox', checked: watermark, onChange: (e) => setWatermark(e.target.checked) }),
            ),
          ),

          h('label', { className: 'dsh-tp-field wide' },
            h('span', null, '负向提示词'),
            h('input', {
              className: 'dsh-tp-input', value: negative,
              placeholder: '不希望出现的内容（可选）',
              onChange: (e) => setNegative(e.target.value),
            }),
          ),

          h('label', { className: 'dsh-tp-field wide' },
            h('span', null, '参考素材（图生图 / 图生视频 / 首尾帧）'),
            h('input', {
              className: 'dsh-tp-input dsh-tp-file', type: 'file', multiple: true,
              accept: 'image/*,video/*,audio/*',
              disabled: uploading,
              onChange: (e) => { addReferences(e.target.files); e.target.value = ''; },
            }),
            uploading ? h('em', null, '上传中…') : null,
            refs.length
              ? h('div', { className: 'dsh-tp-refs' }, refs.map((f) => h('span', { key: f.filePath, className: 'dsh-tp-ref' },
                  f.type === 'audio' ? '♪ ' : f.type === 'file' ? '▶ ' : '🖼 ',
                  String(f.name).slice(0, 24),
                  h('button', { type: 'button', onClick: () => removeReference(f.filePath), title: '移除' }, '×'),
                )))
              : null,
          ),

          h('div', { className: 'dsh-tp-studio-foot' },
            h('div', { className: 'dsh-tp-cost' },
              '预计消耗 ',
              h('b', null, fmt(cost)),
              ' 积分（可用 ' + fmt(store.availableQuota) + '）'),
            h('button', { type: 'button', className: 'dsh-tp-btn', onClick: submit, disabled: busy || !active },
              busy ? '提交中…' : (kind === 'video' ? '生成视频' : '生成图片')),
          ),
          notice ? h('div', { className: 'dsh-tp-note ' + (notice.kind === 'err' ? 'warn' : 'ok') }, notice.text) : null,
        ),

        h('div', { className: 'dsh-tp-gallery-sec' },
          h(GalleryToolbar, {
            value: 'all', onChange: () => {},
            source: 'tasks', onSource: () => {},
            counts: feed.counts, onRefresh: feed.reload, loading: feed.loading,
          }),
          feed.err ? h('div', { className: 'dsh-tp-err' }, feed.err) : null,
          feed.loading && !feed.items.length ? h('div', { className: 'dsh-tp-empty' }, '加载中…') : null,
          h('div', { className: 'dsh-tp-media-grid' },
            feed.items.map((item) => h(MediaTile, { key: item.id, item, onOpen: setOpen }))),
          !feed.loading && !feed.items.length ? h('div', { className: 'dsh-tp-empty' }, '暂无作品') : null,
        ),
        h(MediaLightbox, { item: open, onClose: () => setOpen(null) }),
      );
    }

    function LinkCards({ items, title, sub }) {
      return h('div', { className: 'dsh-tp-view' },
        h(ViewHead, { title, sub }),
        h('div', { className: 'dsh-tp-tool-grid' },
          items.map((item) => h('button', {
            key: item.id, type: 'button', className: 'dsh-tp-tool-card',
            onClick: () => openUrl(item.href),
          },
            h('div', { className: 'title' }, item.label),
            h('div', { className: 'sub' }, '在官网打开'),
          )),
        ),
      );
    }

    function AgentsView() {
      const [q, setQ] = useState('');
      const [cat, setCat] = useState('全部');
      const cats = ['全部', ...new Set(AGENTS.map((a) => a.tag))];
      const filtered = AGENTS.filter((a) => {
        if (cat !== '全部' && a.tag !== cat) return false;
        if (!q.trim()) return true;
        const s = q.trim().toLowerCase();
        return a.name.toLowerCase().includes(s) || a.desc.toLowerCase().includes(s);
      });
      return h('div', { className: 'dsh-tp-view' },
        h(ViewHead, {
          title: '智能体广场',
          sub: '发现和使用各种 AI 智能体',
          actions: h('input', {
            className: 'dsh-tp-search', placeholder: '搜索智能体…', value: q,
            onChange: (e) => setQ(e.target.value),
          }),
        }),
        h('div', { className: 'dsh-tp-tabs' },
          cats.map((c) => h('button', {
            key: c, type: 'button',
            className: 'dsh-tp-tab' + (cat === c ? ' active' : ''),
            onClick: () => setCat(c),
          }, c)),
        ),
        h('div', { className: 'dsh-tp-agent-grid' },
          filtered.map((a, i) => h('button', {
            key: i, type: 'button', className: 'dsh-tp-agent-card',
            onClick: () => openUrl(a.url),
          },
            h('span', { className: 'tag' }, a.tag),
            h('div', { className: 'title' }, a.name),
            h('div', { className: 'desc' }, a.desc),
          )),
        ),
        !filtered.length ? h('div', { className: 'dsh-tp-empty' }, '无匹配智能体') : null,
        h('div', { className: 'dsh-tp-note' },
          h('button', {
            type: 'button', className: 'dsh-tp-link',
            onClick: () => openUrl(consoleUrl(CONSOLE_PAGES.agents)),
          }, '在官网打开智能体广场'),
        ),
      );
    }

    function DshModelsView() {
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState('');
      const [msg, setMsg] = useState('');
      const [models, setModels] = useState([]);
      const [configured, setConfigured] = useState([]);
      const [defaultModel, setDefaultModel] = useState('');
      const [seedModel, setSeedModel] = useState('deepseek-v4.1-flash');
      const [apiKeyError, setApiKeyError] = useState('');
      const [apiKeyHint, setApiKeyHint] = useState('');
      const [selected, setSelected] = useState(() => new Set());
      const [setAsDefault, setSetAsDefault] = useState(false);
      const [filter, setFilter] = useState('chat');
      const [q, setQ] = useState('');

      const configuredIds = useMemo(() => {
        const s = new Set();
        for (const m of configured) if (m && m.id) s.add(m.id);
        return s;
      }, [configured]);

      const selectedList = useMemo(() => [...selected], [selected]);

      const load = async () => {
        setLoading(true); setErr('');
        const r = await jsonGet(API + '/models');
        setLoading(false);
        if (!r || !r.ok) {
          setErr((r && r.error) || '加载模型目录失败');
          return;
        }
        setModels(Array.isArray(r.models) ? r.models : []);
        setConfigured(Array.isArray(r.configured) ? r.configured : []);
        setDefaultModel(r.defaultModel || '');
        setSeedModel(r.seedModel || 'deepseek-v4.1-flash');
        setApiKeyError(r.apiKeyError || '');
        setApiKeyHint(r.apiKeyHint || '');
      };

      useEffect(() => { load(); }, []);

      const filtered = models.filter((m) => {
        if (!m) return false;
        if (filter === 'configured' && !configuredIds.has(m.id)) return false;
        if (filter !== 'all' && filter !== 'configured' && m.kind !== filter) return false;
        if (!q.trim()) return true;
        const s = q.trim().toLowerCase();
        return String(m.id).toLowerCase().includes(s)
          || String(m.name || '').toLowerCase().includes(s)
          || String(m.vendor || '').toLowerCase().includes(s)
          || (m.capabilities || []).some((c) => c.toLowerCase().includes(s));
      });

      const toggleOne = (id, on) => {
        setSelected((prev) => {
          const next = new Set(prev);
          if (on) next.add(id); else next.delete(id);
          return next;
        });
      };

      const selectVisible = () => {
        setSelected((prev) => {
          const next = new Set(prev);
          for (const m of filtered) if (m.selectable !== false && m.id) next.add(m.id);
          return next;
        });
      };

      const addToDsh = async () => {
        setErr(''); setMsg('');
        if (!selectedList.length) { setErr('请先勾选要添加的模型（可多选）'); return }
        const blocked = selectedList.filter((id) => {
          const row = models.find((m) => m && m.id === id);
          return row && row.selectable === false;
        });
        const ids = selectedList.filter((id) => {
          const row = models.find((m) => m && m.id === id);
          return !row || row.selectable !== false;
        });
        if (blocked.length) setErr('含非对话模型，已跳过：' + blocked.join(', '));
        if (!ids.length) { setErr('没有可写入的对话模型'); return }
        const modelNames = {};
        for (const id of ids) {
          const row = models.find((m) => m && m.id === id);
          modelNames[id] = (row && row.name) || id;
        }
        setBusy(true);
        const r = await jsonPost(API + '/model/sync', {
          modelIds: ids,
          modelNames,
          setDefault: !!setAsDefault,
          applyToSessions: !!setAsDefault,
        });
        setBusy(false);
        if (!r || !r.ok) {
          setErr((r && r.modelSync && r.modelSync.error) || (r && r.error) || '写入 DSH 失败');
          return;
        }
        const sync = r.modelSync || {};
        const nextConfigured = Array.isArray(sync.models) ? sync.models : configured;
        setConfigured(nextConfigured);
        setDefaultModel(sync.defaultModel || defaultModel);
        setSelected(new Set());
        setMsg('已累加写入「华数模型」' + ids.length + ' 个（当前共 ' + nextConfigured.length + ' 个）。'
          + '官方 DeepSeek 分组不受影响。' + (sync.hint ? ' ' + sync.hint : ''));
      };

      return h('div', { className: 'dsh-tp-view' },
        h(ViewHead, {
          title: 'DSH模型配置',
          sub: '模型目录来自官网「模型广场」；勾选后累加写入 dsh chat「华数模型」',
          actions: h('div', { className: 'dsh-tp-view-head-actions' },
            h('button', {
              type: 'button', className: 'dsh-tp-btn outline', disabled: loading || busy,
              onClick: async () => {
                setBusy(true); setErr(''); setMsg('');
                const r = await jsonPost(API + '/model/refresh-catalog', {});
                setBusy(false);
                if (!r || !r.ok) { setErr((r && r.error) || '刷新聊天目录失败'); return }
                setMsg('已通知聊天刷新模型目录，请重新打开「模型」菜单');
                await load();
              },
            }, '刷新聊天目录'),
            h('button', {
              type: 'button', className: 'dsh-tp-btn outline', disabled: loading || busy,
              onClick: load,
            }, loading ? '加载中…' : '刷新列表'),
            h('button', {
              type: 'button', className: 'dsh-tp-btn ghost', disabled: loading || busy,
              onClick: () => openUrl(siteUrl('marketplace')),
            }, '模型广场'),
          ),
        }),
        h('div', { className: 'dsh-tp-banner' },
          h('span', null, '供应商：华数模型（wasu-tokenplan）· ' + API_ENDPOINT),
          h('span', { className: 'dsh-tp-badge' }, '已写入 ' + configuredIds.size),
          defaultModel ? h('span', { className: 'dsh-tp-badge green' }, '华数默认 ' + defaultModel) : null,
          apiKeyHint ? h('span', { className: 'dsh-tp-badge purple' }, 'Key ' + apiKeyHint) : null,
        ),
        apiKeyError
          ? h('div', { className: 'dsh-tp-note warn' }, 'API Key：' + apiKeyError)
          : null,
        h('div', { className: 'dsh-tp-toolbar' },
          h('div', { className: 'dsh-tp-tabs' },
            [['chat', '对话'], ['image', '图像'], ['video', '视频'], ['audio', '语音'],
              ['configured', '已写入 DSH'], ['all', '全部']].map(([id, label]) =>
              h('button', {
                key: id, type: 'button',
                className: 'dsh-tp-tab' + (filter === id ? ' active' : ''),
                onClick: () => setFilter(id),
              }, label)),
          ),
          h('input', {
            className: 'dsh-tp-search', placeholder: '搜索模型 / 厂商 / 能力…', value: q,
            onChange: (e) => setQ(e.target.value),
          }),
        ),
        h('div', { className: 'dsh-tp-toolbar-actions' },
          h('button', {
            type: 'button', className: 'dsh-tp-btn ghost small', disabled: loading || busy,
            onClick: selectVisible,
          }, '全选当前列表'),
          h('button', {
            type: 'button', className: 'dsh-tp-btn ghost small',
            disabled: loading || busy || !selectedList.length,
            onClick: () => setSelected(new Set()),
          }, '清空勾选'),
          h('span', { className: 'dsh-tp-muted' }, '已勾选 ' + selectedList.length + ' / 共 ' + models.length + ' 个模型'),
        ),
        err ? h('div', { className: 'dsh-tp-err' }, err) : null,
        msg ? h('div', { className: 'dsh-tp-ok' }, msg) : null,
        loading
          ? h('div', { className: 'dsh-tp-empty' }, '加载中…')
          : h('div', { className: 'dsh-tp-model-list' },
              filtered.map((m) => {
                const inDsh = configuredIds.has(m.id);
                const isDefault = defaultModel === m.id;
                const checked = selected.has(m.id);
                return h('label', {
                  key: m.id,
                  className: 'dsh-tp-model-row'
                    + (checked ? ' selected' : '')
                    + (m.selectable === false ? ' muted' : ''),
                },
                  h('input', {
                    type: 'checkbox',
                    checked,
                    disabled: m.selectable === false,
                    onChange: (e) => toggleOne(m.id, e.target.checked),
                  }),
                  h('div', { className: 'meta' },
                    h('div', { className: 'name' },
                      m.name || m.id,
                      m.vendor ? h('span', { className: 'vendor' }, m.vendor) : null,
                    ),
                    h('div', { className: 'id mono' }, m.id),
                    (m.capabilities || []).length
                      ? h('div', { className: 'caps' }, m.capabilities.slice(0, 6).join(' · '))
                      : null,
                    (m.price || []).length
                      ? h('div', { className: 'price' },
                          m.price.map((p) => p.label + ' ' + p.value).join('　'))
                      : null,
                  ),
                  h('div', { className: 'flags' },
                    (m.badges || []).map((b, i) => h('span', { key: i, className: 'dsh-tp-badge orange' }, b)),
                    h('span', { className: 'dsh-tp-badge' }, KIND_LABELS[m.kind] || m.kind),
                    inDsh ? h('span', { className: 'dsh-tp-badge green' }, '已在 DSH') : null,
                    isDefault ? h('span', { className: 'dsh-tp-badge purple' }, '默认') : null,
                    m.selectable === false
                      ? h('span', { className: 'dsh-tp-badge' }, '非对话')
                      : null,
                  ),
                );
              }),
              !filtered.length ? h('div', { className: 'dsh-tp-empty' }, '无匹配模型') : null,
            ),
        h('div', { className: 'dsh-tp-footer-actions' },
          h('label', { className: 'dsh-tp-check' },
            h('input', {
              type: 'checkbox', checked: setAsDefault,
              onChange: (e) => setSetAsDefault(e.target.checked),
            }),
            '同时把勾选的第一个设为默认并切换当前会话' + (seedModel ? '（推荐 ' + seedModel + '）' : ''),
          ),
          h('button', {
            type: 'button', className: 'dsh-tp-btn primary',
            disabled: busy || loading || !selectedList.length,
            onClick: addToDsh,
          }, busy ? '写入中…' : ('累加到 DSH' + (selectedList.length ? '（' + selectedList.length + '）' : ''))),
        ),
      );
    }

    function SidebarNav({ active, expanded, onNav, onToggle, unread }) {
      const isChildActive = (item) => {
        if (Array.isArray(item.children)) {
          return item.children.some((c) => c.id === active) || active === item.id;
        }
        return active === item.id;
      };
      return h('nav', { className: 'dsh-tp-sidebar' },
        NAV.map((item) => {
          const hasKids = Array.isArray(item.children) && item.children.length;
          const open = expanded[item.id];
          const activeCls = isChildActive(item) ? ' active' : '';
          return h('div', { key: item.id, className: 'dsh-tp-nav-group' },
            h('button', {
              type: 'button',
              className: 'dsh-tp-nav-item' + activeCls + (hasKids ? ' has-children' : ''),
              onClick: () => {
                if (hasKids) onToggle(item.id);
                else onNav(item.id);
              },
            },
              h('span', { className: 'icon' }, item.icon),
              h('span', { className: 'label' }, item.label),
              item.id === 'messages' && unread > 0
                ? h('span', { className: 'count' }, unread > 99 ? '99+' : String(unread))
                : null,
              hasKids ? h('span', { className: 'chev' }, open ? '▾' : '▸') : null,
            ),
            hasKids && open
              ? h('div', { className: 'dsh-tp-nav-children' },
                  item.children.map((ch) => h('button', {
                    key: ch.id, type: 'button',
                    className: 'dsh-tp-nav-child' + (active === ch.id ? ' active' : ''),
                    onClick: () => {
                      if (ch.href) openUrl(ch.href);
                      else onNav(ch.id);
                    },
                  }, ch.label)),
                )
              : null,
          );
        }),
        h('div', { className: 'dsh-tp-nav-foot' },
          h('button', {
            type: 'button', className: 'dsh-tp-nav-mini',
            onClick: () => openUrl(siteUrl('marketplace')),
          }, '模型广场'),
          h('button', {
            type: 'button', className: 'dsh-tp-nav-mini',
            onClick: () => openUrl(consoleUrl(CONSOLE_PAGES.profile)),
          }, '个人中心'),
          h('button', {
            type: 'button', className: 'dsh-tp-nav-mini',
            onClick: () => openUrl(siteUrl('')),
          }, '官网首页'),
        ),
      );
    }

    function ConsoleBody(props) {
      const { nav } = props;
      if (nav === 'dashboard') {
        return h(DashboardView, {
          data: props.dash || {},
          range: props.range,
          onRange: props.setRange,
          refreshing: props.loading,
          onRefresh: () => props.loadDash(props.range, props.session),
        });
      }
      if (nav === 'packages') return h(PackagesView, { isEnterprise: !!(props.session && props.session.isEnterprise) });
      if (nav === 'keys') return h(KeysView);
      if (nav === 'credits') return h(CreditsView);
      if (nav === 'orders') return h(OrdersView);
      if (nav === 'logs') return h(LogsView);
      if (nav === 'messages') return h(MessagesView, { onUnreadChange: props.onUnreadChange });
      if (nav === 'drive') return h(DriveView);
      if (nav === 'creation') return h(CreationView);
      if (nav === 'ecommerce') {
        const item = NAV.find((n) => n.id === 'ecommerce');
        return h(LinkCards, {
          title: 'AI电商',
          sub: '商品套图、抠图、上身、印花提取等（官网运行）',
          items: item.children,
        });
      }
      if (nav === 'voice') {
        const item = NAV.find((n) => n.id === 'voice');
        return h(LinkCards, { title: 'AI语音', sub: '语音合成、实时对话、语音识别（官网运行）', items: item.children });
      }
      if (nav === 'agents') return h(AgentsView);
      if (nav === 'dsh-models') return h(DshModelsView);
      return h(DashboardView, {
        data: props.dash || {}, range: props.range, onRange: props.setRange, refreshing: props.loading,
        onRefresh: () => props.loadDash(props.range, props.session),
      });
    }

    function Panel() {
      const st = useStore();
      const [session, setSession] = useState(null);
      const [dash, setDash] = useState(null);
      const [range, setRange] = useState(7);
      const [loading, setLoading] = useState(false);
      const [err, setErr] = useState('');
      // The panel's active page lives in the shared store so other surfaces
      // (the conversation-window gallery) can open it on a given page.
      const setNav = (id) => setStore({ nav: id });
      const nav = st.nav || 'dashboard';
      const [expanded, setExpanded] = useState({});
      const dragRef = useRef(null);
      const [pos, setPos] = useState({ x: null, y: null, w: 960, h: 640 });

      const applyManifest = (m) => {
        if (!m || !m.ok) return null;
        if (m.session) {
          setSession(m.session);
          setStore({
            loggedIn: !!m.session.loggedIn,
            nickname: m.session.nickname || '',
            unread: Number(m.unread) || 0,
            drivePercent: m.drive ? m.drive.percent : null,
          });
        }
        return m.session || null;
      };

      const syncSession = async () => applyManifest(await jsonGet(API + '/manifest'));

      const loadDash = async (days, sess) => {
        const logged = sess || session;
        if (!logged || !logged.loggedIn) { setDash(null); return }
        setLoading(true); setErr('');
        const d = await jsonGet(API + '/dashboard?range=' + (days === 30 ? '30' : '7'));
        setLoading(false);
        if (!d || !d.ok) {
          setErr((d && d.error) || '加载失败');
          if (d && d.loggedIn === false) {
            setSession({ loggedIn: false });
            setStore({ loggedIn: false, availableQuota: null, unread: 0 });
          }
          return;
        }
        setDash(d);
        const avail = d.overview && d.overview.availableQuota;
        setStore({
          loggedIn: true,
          availableQuota: avail != null ? Number(avail) : null,
          nickname: (d.accountInfo && (d.accountInfo.nickname || d.accountInfo.phone)) || '',
        });
      };

      useEffect(() => {
        if (!st.open) return undefined;
        let cancelled = false;
        (async () => {
          const p = await jsonGet(API + '/prefs');
          if (!cancelled && p && p.ok && p.prefs && p.prefs.panel) {
            setPos((cur) => ({ ...cur, ...p.prefs.panel }));
          }
          const sess = await syncSession();
          if (cancelled) return;
          if (sess && sess.loggedIn) await loadDash(range, sess);
        })();
        return () => { cancelled = true };
      }, [st.open]);

      useEffect(() => {
        if (!st.open || !session || !session.loggedIn || nav !== 'dashboard') return undefined;
        loadDash(range, session);
        return undefined;
      }, [range, nav]);

      const onPointerDown = (e) => {
        if (e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = pos.x == null ? Math.max(24, (window.innerWidth - pos.w) / 2) : pos.x;
        const origY = pos.y == null ? Math.max(24, (window.innerHeight - pos.h) / 2) : pos.y;
        const move = (ev) => {
          const nx = Math.max(8, origX + (ev.clientX - startX));
          const ny = Math.max(8, origY + (ev.clientY - startY));
          setPos((cur) => ({ ...cur, x: nx, y: ny }));
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          setPos((cur) => {
            const next = { ...cur, x: cur.x == null ? origX : cur.x, y: cur.y == null ? origY : cur.y };
            jsonPost(API + '/prefs', { prefs: { panel: { x: next.x, y: next.y, w: next.w, h: next.h } } });
            return next;
          });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      };

      if (!st.open) return null;

      const left = pos.x == null ? '50%' : pos.x + 'px';
      const top = pos.y == null ? '50%' : pos.y + 'px';
      const transform = pos.x == null ? 'translate(-50%, -50%)' : 'none';
      const loggedIn = session && session.loggedIn;

      return h('div', {
        className: 'dsh-tp-panel',
        ref: dragRef,
        style: { left, top, width: pos.w, height: pos.h, transform },
      },
        h('div', { className: 'dsh-tp-titlebar', onPointerDown },
          h('div', { className: 'dsh-tp-brand' },
            h('span', { className: 'dsh-tp-brand-mark' }, '◎'),
            h('span', null, '华数 AI Store · 费用中心'),
            session && session.isEnterprise
              ? h('span', { className: 'dsh-tp-badge purple' }, '企业版')
              : null,
          ),
          h('div', { className: 'dsh-tp-title-actions' },
            loggedIn
              ? h('button', {
                type: 'button', className: 'dsh-tp-btn ghost small',
                onClick: async (e) => {
                  e.stopPropagation();
                  await jsonPost(API + '/auth/logout', {});
                  setDash(null);
                  setSession({ loggedIn: false });
                  setNav('dashboard');
                  setStore({ loggedIn: false, availableQuota: null, unread: 0, drivePercent: null, nickname: '' });
                },
              }, '退出')
              : null,
            h('button', {
              type: 'button', className: 'dsh-tp-btn ghost small',
              onClick: (e) => { e.stopPropagation(); setStore({ open: false }); },
            }, '关闭'),
          ),
        ),
        h('div', { className: 'dsh-tp-body' + (loggedIn ? ' with-nav' : '') },
          !loggedIn
            ? h(LoginView, {
              onLoggedIn: async (sess) => {
                setSession(sess || { loggedIn: true });
                setStore({ loggedIn: true, nickname: (sess && sess.nickname) || '' });
                setNav('dashboard');
                await loadDash(range, sess || { loggedIn: true });
              },
            })
            : h('div', { className: 'dsh-tp-layout' },
                h(SidebarNav, {
                  active: nav,
                  expanded,
                  unread: st.unread,
                  onNav: setNav,
                  onToggle: (id) => setExpanded((ex) => ({ ...ex, [id]: !ex[id] })),
                }),
                h('main', { className: 'dsh-tp-main' },
                  h(ConsoleBody, {
                    nav, dash, range, setRange, loadDash, loading, session,
                    onUnreadChange: (n) => setStore({ unread: n }),
                  }),
                  err ? h('div', { className: 'dsh-tp-err foot' }, err) : null,
                ),
              ),
        ),
      );
    }

    const inject = ['slots'];
    function apply(ctx) {
      const slots = ctx.get('slots');
      if (slots === undefined) return;

      ctx.effect(() => {
        const styleEl = document.createElement('style');
        styleEl.setAttribute('data-plugin', 'dsh-tokenplan-bill');
        styleEl.textContent = PANEL_CSS;
        document.head.appendChild(styleEl);
        return () => { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl); };
      });

      ctx.effect(() => {
        let timer = null;
        let stopped = false;
        const check = async () => {
          if (stopped) return;
          const m = await jsonGet(API + '/manifest');
          if (!m || !m.ok || !m.session || !m.session.loggedIn) {
            setStore({ loggedIn: false, availableQuota: null, unread: 0, drivePercent: null, nickname: '' });
            return;
          }
          setStore({
            loggedIn: true,
            nickname: m.session.nickname || '',
            unread: Number(m.unread) || 0,
            drivePercent: m.drive ? m.drive.percent : null,
          });
          const d = await jsonGet(API + '/dashboard?range=7');
          if (d && d.ok && d.overview) {
            const avail = Number(d.overview.availableQuota);
            setStore({ availableQuota: avail, alert: Number.isFinite(avail) && avail < 1000 });
          }
        };
        check();
        timer = setInterval(check, 5 * 60 * 1000);
        return () => { stopped = true; if (timer !== null) clearInterval(timer); };
      }, 'tokenplan-bill: poll');

      ctx.effect(() => slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'tokenplan-bill-entry', order: 12 },
        (props) => React.createElement(EntryButton, props),
      )), 'tokenplan-bill: sidebar entry');

      ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'tokenplan-bill-panel', order: 32 },
        () => React.createElement(Panel),
      )), 'tokenplan-bill: overlay panel');

      // Conversation-window 画廊 tab: the native `conversation.view` seat, next
      // to 对话 / 轨迹. Same seat dsh-image-gen uses. Older hosts that do not
      // declare the seat simply never show the tab; nothing else changes.
      ctx.effect(() => slots.inject('conversation.view', () => slots.register(
        {
          name: 'conversation.view',
          id: 'tokenplan-bill-gallery',
          order: 20,
          label: () => '画廊',
        },
        () => React.createElement(GalleryView),
      )), 'tokenplan-bill: conversation gallery');

      // Inline result cards for the agent tools. The `tool.call.toolview` seat is
      // keyed by wire tool name and replaces the generic row, which would
      // otherwise flatten the produced media blocks into JSON text. Another
      // generation plugin can hold the same key, so a clash is contained instead
      // of aborting this bundle's remaining registrations.
      for (const toolName of TOOL_VIEW_KEYS) {
        ctx.effect(() => {
          try {
            return slots.inject('tool.call.toolview', () => slots.register(
              { name: 'tool.call.toolview', key: toolName },
              (props) => React.createElement(GeneratedMediaCard, { ...props, toolName }),
            ));
          } catch (err) {
            console.warn('dsh-tokenplan-bill: tool view "' + toolName + '" not registered', err);
            return () => {};
          }
        }, 'tokenplan-bill: ' + toolName + ' card');
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    // Test seam: the views and the entry store are otherwise module-private.
    exports.__views = {
      EntryButton,
      Panel,
      LoginView,
      DashboardView,
      PackagesView,
      KeysView,
      CreditsView,
      OrdersView,
      LogsView,
      MessagesView,
      DriveView,
      CreationView,
      GalleryView,
      GeneratedMediaCard,
      ToolMediaThumb,
      useAttachmentMediaUrl,
      MediaLightbox,
      MediaTile,
      useGalleryFeed,
      TOOL_VIEW_KEYS,
      AgentsView,
      DshModelsView,
      NAV,
      AGENTS,
      store,
      setStore,
    };

    const PANEL_CSS = `
      [data-slot="sidebar.footer.action"]{
        display:flex!important;flex-direction:column;align-items:stretch;width:100%;min-width:0;
      }
      .dsh-tp-panel,.dsh-tp-entry{
        --tp-font:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);
        --tp-fg:var(--dsw-alias-text-primary,#1f2937);
        --tp-sub:var(--dsw-alias-text-secondary,#6b7280);
        --tp-soft:var(--dsw-alias-fill-tsp-gray-main,rgba(15,17,21,.06));
        --tp-border:var(--dsw-alias-border-default,rgba(124,58,237,0.18));
        --tp-accent:${ACCENT};
        --tp-accent-soft:rgba(124,58,237,0.12);
        --tp-ok:#059669;
        --tp-warn:#d97706;
        --tp-err:#dc2626;
        --tp-panelBg:var(--dsw-alias-bg-elevated,#fff);
        --tp-ease:var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1));
        --tp-fast:var(--ds-transition-duration-fast,.1s);
        font-family:var(--tp-font);color:var(--tp-fg);
      }
      .dsh-tp-entry{position:relative;box-sizing:border-box;display:flex;align-items:center;gap:8px;
        flex:none;width:calc(100% + 4px);min-width:0;height:42px;margin:4px -2px 0;padding:0 10px 0 8px;
        cursor:pointer;border:none;border-radius:12px;text-align:left;background:transparent;color:var(--tp-fg);
        font-size:14px;font-weight:400;line-height:22px;transition:background-color var(--tp-fast) var(--tp-ease)}
      .dsh-tp-entry:hover,.dsh-tp-entry.active{background:var(--tp-soft)}
      .dsh-tp-entry-icon{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--tp-accent)}
      .dsh-tp-entry-icon svg{display:block}
      .dsh-tp-entry-left{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 auto}
      .dsh-tp-entry-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .dsh-tp-entry-bal{margin-left:auto;flex:none;padding:3px 9px;border-radius:999px;font-variant-numeric:tabular-nums;
        color:var(--tp-accent);font-size:12px;font-weight:600;white-space:nowrap;background:var(--tp-accent-soft)}
      .dsh-tp-entry-bal.alert{color:#dd8629;background:rgba(245,158,11,.15)}
      .dsh-tp-entry-dot{position:absolute;top:-2px;right:-3px;width:7px;height:7px;border-radius:50%;background:#ef4444}
      .dsh-tp-entry-dot.warn{background:#f59e0b}
      .dsh-tp-entry[data-wide="0"]{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;min-width:0;padding:0;margin:8px auto 0}
      .dsh-tp-entry[data-wide="0"] .dsh-tp-entry-icon{width:18px;height:18px}
      .dsh-tp-entry[data-wide="0"] .dsh-tp-entry-bal{display:none}
      .dsh-tp-panel{position:fixed;z-index:10000;display:flex;flex-direction:column;min-width:720px;min-height:480px;
        max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);background:var(--tp-panelBg);
        border:1px solid var(--dsw-alias-border-inverted,rgba(0,0,0,.06));border-radius:16px;
        box-shadow:0 24px 64px rgba(0,0,0,.28);overflow:hidden;pointer-events:auto}
      .dsh-tp-titlebar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;
        border-bottom:1px solid rgba(127,127,127,.18);cursor:grab;user-select:none;flex:none}
      .dsh-tp-brand{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:650}
      .dsh-tp-brand-mark{color:var(--tp-accent)}
      .dsh-tp-title-actions{display:flex;gap:6px;align-items:center}
      .dsh-tp-body{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0}
      .dsh-tp-body.with-nav{padding:0}
      .dsh-tp-body:not(.with-nav){overflow:auto;padding:14px 16px 18px}
      .dsh-tp-layout{display:flex;flex:1;min-height:0}
      .dsh-tp-sidebar{width:176px;flex:none;border-right:1px solid rgba(127,127,127,.15);background:rgba(124,58,237,.03);
        overflow:auto;padding:8px 6px;display:flex;flex-direction:column;gap:2px}
      .dsh-tp-nav-item{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:none;border-radius:8px;
        background:transparent;color:var(--tp-fg);font-size:12px;cursor:pointer;text-align:left}
      .dsh-tp-nav-item:hover{background:rgba(124,58,237,.08)}
      .dsh-tp-nav-item.active{background:rgba(124,58,237,.14);color:var(--tp-accent);font-weight:600}
      .dsh-tp-nav-item .icon{width:16px;text-align:center;opacity:.85}
      .dsh-tp-nav-item .label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-tp-nav-item .count{flex:none;min-width:16px;padding:0 5px;border-radius:999px;background:#ef4444;color:#fff;
        font-size:10px;font-weight:700;text-align:center;line-height:16px}
      .dsh-tp-nav-item .chev{font-size:10px;color:var(--tp-sub)}
      .dsh-tp-nav-children{padding-left:12px;margin-bottom:4px}
      .dsh-tp-nav-child{display:block;width:100%;padding:6px 10px 6px 24px;border:none;border-radius:6px;background:transparent;
        color:var(--tp-sub);font-size:11px;text-align:left;cursor:pointer}
      .dsh-tp-nav-child:hover,.dsh-tp-nav-child.active{color:var(--tp-accent);background:rgba(124,58,237,.08)}
      .dsh-tp-nav-foot{margin-top:auto;padding:10px 8px 4px;display:flex;flex-wrap:wrap;gap:4px}
      .dsh-tp-nav-mini{border:none;background:transparent;color:var(--tp-sub);font-size:10px;cursor:pointer;
        padding:3px 6px;border-radius:6px}
      .dsh-tp-nav-mini:hover{color:var(--tp-accent);background:rgba(124,58,237,.08)}
      .dsh-tp-main{flex:1;overflow:auto;padding:14px 16px 18px;min-width:0}
      .dsh-tp-btn{border:1px solid var(--tp-border);background:transparent;color:var(--tp-fg);border-radius:8px;
        padding:7px 12px;font-size:12px;cursor:pointer}
      .dsh-tp-btn:disabled{opacity:.55;cursor:not-allowed}
      .dsh-tp-btn.primary{background:linear-gradient(135deg,#8B5CF6,#6D28D9);border-color:transparent;color:#fff;font-weight:600}
      .dsh-tp-btn.outline{background:var(--tp-accent-soft);border-color:rgba(124,58,237,0.28);color:var(--tp-accent)}
      .dsh-tp-btn.outline.warn{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.3);color:var(--tp-warn)}
      .dsh-tp-btn.ghost{border-color:transparent}
      .dsh-tp-btn.small{padding:4px 8px;font-size:11px}
      .dsh-tp-btn.block{width:100%;margin-top:8px}
      .dsh-tp-link{border:none;background:none;color:var(--tp-accent);font-size:11px;cursor:pointer;margin-left:6px;padding:0}
      .dsh-tp-login{max-width:380px;margin:24px auto}
      .dsh-tp-login-title{font-size:18px;font-weight:700;margin:0 0 4px}
      .dsh-tp-login-sub{margin:0 0 14px;color:var(--tp-sub);font-size:12px;word-break:break-all}
      .dsh-tp-tabs.login-tabs{margin-bottom:14px;width:fit-content}
      .dsh-tp-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;font-size:12px;color:var(--tp-sub)}
      .dsh-tp-field input,.dsh-tp-create-row input,.dsh-tp-search,.dsh-tp-filters input,.dsh-tp-select{
        border:1px solid var(--tp-border);border-radius:8px;padding:9px 10px;font-size:13px;background:transparent;color:var(--tp-fg)}
      .dsh-tp-code-row{display:flex;gap:8px}
      .dsh-tp-code-row input{flex:1}
      .dsh-tp-err{color:var(--tp-err);font-size:12px;margin:6px 0}
      .dsh-tp-err.foot{margin-top:10px}
      .dsh-tp-ok{color:var(--tp-ok);font-size:12px;margin:6px 0}
      .dsh-tp-view-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}
      .dsh-tp-view-head h2{margin:0;font-size:16px;font-weight:700}
      .dsh-tp-view-sub{margin:4px 0 0;font-size:12px;color:var(--tp-sub)}
      .dsh-tp-view-head-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .dsh-tp-tabs,.dsh-tp-toggle{display:flex;gap:4px;background:rgba(124,58,237,0.08);border-radius:8px;padding:2px;flex-wrap:wrap}
      .dsh-tp-tab,.dsh-tp-toggle button{border:0;background:transparent;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;color:var(--tp-sub)}
      .dsh-tp-tab.active,.dsh-tp-toggle button.active{background:#fff;color:var(--tp-accent);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.06)}
      .dsh-tp-dash-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;flex-wrap:wrap}
      .dsh-tp-dash-head h2{margin:0;font-size:18px}
      .dsh-tp-dash-head p{margin:4px 0 0;color:var(--tp-sub);font-size:12px}
      .dsh-tp-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}
      .dsh-tp-stat{border:1px solid var(--tp-border);border-radius:12px;padding:12px;background:rgba(124,58,237,0.03)}
      .dsh-tp-stat.drive-stat{max-width:520px}
      .dsh-tp-stat-label{font-size:11px;color:var(--tp-sub);margin-bottom:6px}
      .dsh-tp-stat-body .val{font-size:22px;font-weight:700}
      .dsh-tp-stat-body .val.green{color:var(--tp-ok)}
      .dsh-tp-stat-body .unit{font-size:12px;color:var(--tp-sub)}
      .dsh-tp-progress{margin-top:10px}
      .dsh-tp-progress-bar{height:6px;border-radius:999px;background:rgba(124,58,237,0.12);overflow:hidden}
      .dsh-tp-progress-bar .fill{height:100%;background:linear-gradient(90deg,#A78BFA,#7C3AED)}
      .dsh-tp-progress-bar .fill.warn{background:linear-gradient(90deg,#F59E0B,#DC2626)}
      .dsh-tp-progress-info{display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:var(--tp-sub)}
      .dsh-tp-progress-info.drive-split{margin-top:4px}
      .dsh-tp-change{margin-top:8px;font-size:11px}
      .dsh-tp-change.up{color:var(--tp-err)}
      .dsh-tp-change.down{color:var(--tp-ok)}
      .dsh-tp-tags{display:flex;flex-wrap:wrap;gap:6px}
      .dsh-tp-tag{background:linear-gradient(135deg,#8B5CF6,#6D28D9);color:#fff;border-radius:8px;padding:8px 10px;min-width:110px}
      .dsh-tp-tag .sub{font-size:10px;opacity:.85;margin-top:2px}
      .dsh-tp-badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
      .dsh-tp-badge{font-size:10px;border-radius:6px;padding:2px 6px;background:var(--tp-accent-soft);color:var(--tp-accent);
        white-space:nowrap}
      .dsh-tp-badge.blue{background:rgba(59,130,246,.12);color:#2563eb}
      .dsh-tp-badge.green{background:rgba(5,150,105,.12);color:#059669}
      .dsh-tp-badge.pink{background:rgba(236,72,153,.12);color:#db2777}
      .dsh-tp-badge.orange{background:rgba(245,158,11,.15);color:#d97706}
      .dsh-tp-charts{display:grid;grid-template-columns:1.2fr 1fr;gap:10px;margin-bottom:12px}
      .dsh-tp-chart-card{border:1px solid var(--tp-border);border-radius:12px;padding:12px;min-height:210px}
      .dsh-tp-chart-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}
      .dsh-tp-chart-head .title{font-size:13px;font-weight:650}
      .dsh-tp-bars{display:flex;align-items:flex-end;gap:6px;height:150px;padding-top:8px}
      .dsh-tp-bars .bar-item{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;min-width:0}
      .dsh-tp-bars .bar-value{font-size:9px;color:var(--tp-sub);margin-bottom:4px;white-space:nowrap}
      .dsh-tp-bars .bar-wrap{flex:1;width:100%;display:flex;align-items:flex-end;justify-content:center}
      .dsh-tp-bars .bar{width:70%;min-height:4px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,#A78BFA,#7C3AED)}
      .dsh-tp-bars .bar-label{font-size:9px;color:var(--tp-sub);margin-top:4px}
      .dsh-tp-donut-row{display:flex;gap:12px;align-items:center}
      .dsh-tp-donut{position:relative;width:140px;height:140px;flex:none}
      .dsh-tp-donut .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
      .dsh-tp-donut .center .num{font-weight:700;font-size:14px}
      .dsh-tp-donut .center .txt{font-size:10px;color:var(--tp-sub)}
      .dsh-tp-legend{flex:1;display:flex;flex-direction:column;gap:6px;min-width:0}
      .dsh-tp-legend .item{display:flex;align-items:center;gap:6px;font-size:11px}
      .dsh-tp-legend .dot{width:8px;height:8px;border-radius:50%;flex:none}
      .dsh-tp-legend .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-tp-legend .pct{color:var(--tp-sub)}
      .dsh-tp-section-title{font-size:13px;font-weight:650;margin:12px 0 8px}
      .dsh-tp-rank-list{display:flex;flex-direction:column;gap:8px}
      .dsh-tp-rank-item{display:flex;align-items:center;gap:10px;border:1px solid var(--tp-border);border-radius:10px;padding:8px 10px}
      .dsh-tp-rank-item .num{width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:rgba(124,58,237,0.08)}
      .dsh-tp-rank-item .num.top{background:var(--tp-accent);color:#fff}
      .dsh-tp-rank-item .avatar{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12px}
      .dsh-tp-rank-item .info{flex:1;min-width:0}
      .dsh-tp-rank-item .name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-tp-rank-item .credits{font-size:12px;font-weight:650;color:var(--tp-accent)}
      .dsh-tp-empty{color:var(--tp-sub);font-size:12px;padding:24px 0;text-align:center}
      .dsh-tp-table{width:100%;border-collapse:collapse;font-size:12px}
      .dsh-tp-table th,.dsh-tp-table td{padding:8px 10px;border-bottom:1px solid rgba(127,127,127,.15);text-align:left;vertical-align:top}
      .dsh-tp-table th{color:var(--tp-sub);font-weight:600;font-size:11px}
      .dsh-tp-table td.mono{font-family:ui-monospace,monospace;font-size:11px}
      .dsh-tp-table td.small{font-size:10px;line-height:1.4}
      .dsh-tp-actions{display:flex;gap:4px;flex-wrap:wrap}
      .dsh-tp-banner{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;margin-bottom:12px;
        border:1px solid var(--tp-border);border-radius:10px;background:rgba(124,58,237,.04);font-size:12px}
      .dsh-tp-banner code{font-family:ui-monospace,monospace;font-size:11px}
      .dsh-tp-note{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--tp-sub);margin:10px 0 0}
      .dsh-tp-note.warn{color:var(--tp-warn)}
      .dsh-tp-create-row{display:flex;gap:8px;margin-bottom:12px}
      .dsh-tp-create-row input{flex:1}
      .dsh-tp-status.on{color:var(--tp-ok);font-weight:600}
      .dsh-tp-status.off{color:var(--tp-sub)}
      .dsh-tp-pkg-grid,.dsh-tp-credit-grid,.dsh-tp-tool-grid,.dsh-tp-agent-grid,.dsh-tp-asset-grid{
        display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
      .dsh-tp-pkg-card,.dsh-tp-credit-card,.dsh-tp-tool-card,.dsh-tp-agent-card,.dsh-tp-asset{
        border:1px solid var(--tp-border);border-radius:12px;padding:14px;background:rgba(124,58,237,.02);text-align:left}
      .dsh-tp-pkg-card{position:relative;display:flex;flex-direction:column}
      .dsh-tp-pkg-card.subscribed{border-color:rgba(5,150,105,.4);background:rgba(5,150,105,.05)}
      .dsh-tp-pkg-flag{position:absolute;top:10px;right:10px;font-size:10px;padding:2px 6px;border-radius:6px;
        background:rgba(5,150,105,.12);color:#059669}
      .dsh-tp-pkg-name,.dsh-tp-tool-card .title,.dsh-tp-agent-card .title{font-size:14px;font-weight:700;margin-bottom:4px}
      .dsh-tp-pkg-sub,.dsh-tp-tool-card .sub,.dsh-tp-agent-card .desc{font-size:11px;color:var(--tp-sub)}
      .dsh-tp-pkg-feats{margin:8px 0 0;padding-left:16px;font-size:11px;color:var(--tp-sub);flex:1}
      .dsh-tp-pkg-price{margin:10px 0}
      .dsh-tp-pkg-price .promo{font-size:20px;font-weight:700;color:var(--tp-accent)}
      .dsh-tp-pkg-price .orig{font-size:12px;color:var(--tp-sub);text-decoration:line-through;margin-left:8px}
      .dsh-tp-tool-card,.dsh-tp-agent-card{cursor:pointer;border:1px solid var(--tp-border);font:inherit;color:inherit;transition:box-shadow .15s}
      .dsh-tp-tool-card:hover,.dsh-tp-agent-card:hover{box-shadow:0 4px 16px rgba(124,58,237,.15)}
      .dsh-tp-agent-card .tag{display:inline-block;font-size:10px;padding:2px 6px;border-radius:4px;
        background:var(--tp-accent-soft);color:var(--tp-accent);margin-bottom:6px}
      .dsh-tp-credit-card .name{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:650}
      .dsh-tp-credit-card .nums{font-size:16px;font-weight:700;margin:6px 0}
      .dsh-tp-credit-card .expire{font-size:10px;color:var(--tp-sub);margin-top:6px}
      .dsh-tp-search{min-width:180px;padding:6px 10px!important;font-size:12px!important}
      .dsh-tp-select{padding:6px 10px;font-size:12px}
      .dsh-tp-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}
      .dsh-tp-toolbar-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px}
      .dsh-tp-muted{font-size:11px;color:var(--tp-sub)}
      .dsh-tp-check{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--tp-sub)}
      .dsh-tp-check.agree{margin:2px 0 12px}
      .dsh-tp-footer-actions{display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:14px;padding-top:10px;
        border-top:1px solid rgba(127,127,127,.12);flex-wrap:wrap}
      .dsh-tp-footer-actions .dsh-tp-check{margin-right:auto}
      .dsh-tp-model-list{display:flex;flex-direction:column;gap:6px;max-height:min(420px,52vh);overflow:auto;padding-right:2px}
      .dsh-tp-model-row{display:flex;align-items:center;gap:10px;border:1px solid var(--tp-border);border-radius:10px;
        padding:10px 12px;cursor:pointer;background:rgba(124,58,237,.02)}
      .dsh-tp-model-row.selected{border-color:var(--tp-accent);background:rgba(124,58,237,.08)}
      .dsh-tp-model-row.muted{opacity:.72}
      .dsh-tp-model-row .meta{flex:1;min-width:0}
      .dsh-tp-model-row .name{font-size:13px;font-weight:650;display:flex;align-items:center;gap:6px}
      .dsh-tp-model-row .name .vendor{font-size:10px;font-weight:400;color:var(--tp-sub)}
      .dsh-tp-model-row .id{font-size:11px;color:var(--tp-sub);margin-top:2px;font-family:ui-monospace,monospace}
      .dsh-tp-model-row .caps{font-size:10px;color:var(--tp-sub);margin-top:3px}
      .dsh-tp-model-row .price{font-size:10px;color:var(--tp-accent);margin-top:3px}
      .dsh-tp-model-row .flags{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:220px}
      .dsh-tp-badge.purple{background:rgba(124,58,237,.16);color:#6d28d9}
      .dsh-tp-msg-list{display:flex;flex-direction:column;gap:8px}
      .dsh-tp-msg{border:1px solid var(--tp-border);border-radius:10px;padding:10px 12px;cursor:pointer;background:rgba(124,58,237,.02)}
      .dsh-tp-msg:hover{border-color:rgba(124,58,237,.35)}
      .dsh-tp-msg.unread{background:rgba(124,58,237,.07)}
      .dsh-tp-msg .head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10px;color:var(--tp-sub)}
      .dsh-tp-msg .head .time{margin-left:auto}
      .dsh-tp-msg .title{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:650;margin:6px 0 4px}
      .dsh-tp-msg .title .dot{width:6px;height:6px;border-radius:50%;background:#ef4444;flex:none}
      .dsh-tp-msg .body{font-size:11px;color:var(--tp-sub);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .dsh-tp-modal-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--tp-sub);margin-bottom:8px}
      .dsh-tp-modal-body{font-size:12px;line-height:1.6;white-space:pre-wrap;max-height:min(320px,40vh);overflow:auto;margin-bottom:12px}
      .dsh-tp-modal.wide{max-width:520px}
      .dsh-tp-asset{padding:10px;display:flex;flex-direction:column;gap:8px}
      .dsh-tp-asset img{width:100%;height:120px;object-fit:cover;border-radius:8px;cursor:pointer;background:rgba(124,58,237,.06)}
      .dsh-tp-asset .ph{width:100%;height:120px;border-radius:8px;display:flex;align-items:center;justify-content:center;
        background:rgba(124,58,237,.08);color:var(--tp-sub);font-size:12px}
      .dsh-tp-asset .meta{font-size:11px;color:var(--tp-sub)}
      .dsh-tp-asset .meta .model{font-size:12px;font-weight:650;color:var(--tp-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-tp-asset .meta .params{margin-top:2px}
      .dsh-tp-filters{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:12px}
      .dsh-tp-filters label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--tp-sub)}
      .dsh-tp-pager{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px}
      .dsh-tp-pager-info{font-size:11px;color:var(--tp-sub)}
      .dsh-tp-modal-backdrop{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
      .dsh-tp-modal{background:var(--tp-panelBg);border-radius:14px;padding:16px;max-width:320px;width:90%;box-shadow:0 20px 48px rgba(0,0,0,.3)}
      .dsh-tp-modal-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;font-weight:600}
      .dsh-tp-qr{display:block;width:220px;height:220px;margin:0 auto;border-radius:8px}
      .dsh-tp-modal-hint{text-align:center;font-size:11px;color:var(--tp-sub);margin:10px 0 0}

      /* ---- 画廊 (conversation.view seat) ---- */
      /* The token block is repeated here because the gallery renders inside the
         conversation column, outside the panel's scope. */
      .dsh-tp-gallery-view{
        --tp-font:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);
        --tp-fg:var(--dsw-alias-text-primary,#1f2937);
        --tp-sub:var(--dsw-alias-text-secondary,#6b7280);
        --tp-soft:var(--dsw-alias-fill-tsp-gray-main,rgba(15,17,21,.06));
        --tp-border:var(--dsw-alias-border-default,rgba(124,58,237,0.18));
        --tp-accent:${ACCENT};
        --tp-accent-soft:rgba(124,58,237,0.12);
        --tp-ok:#059669;
        --tp-warn:#d97706;
        --tp-err:#dc2626;
        --tp-panelBg:var(--dsw-alias-bg-elevated,#fff);
        font-family:var(--tp-font);color:var(--tp-fg);
        box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:16px 20px 28px;
      }
      .dsh-tp-gallery-view *,.dsh-tp-studio *{box-sizing:border-box}
      .dsh-tp-gallery-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap}
      .dsh-tp-gallery-title{font-size:15px;font-weight:650}
      .dsh-tp-gallery-sub{font-size:11px;color:var(--tp-sub);margin-top:2px}
      .dsh-tp-gallery-head-actions{display:flex;align-items:center;gap:8px}
      .dsh-tp-gallery-quota{font-size:11px;color:var(--tp-sub)}
      .dsh-tp-gallery-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}
      .dsh-tp-gallery-bar-right{display:flex;align-items:center;gap:8px}
      .dsh-tp-gallery-view .dsh-tp-tabs{margin-bottom:0}
      .dsh-tp-select.small{padding:4px 8px;font-size:11px}

      .dsh-tp-media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
      .dsh-tp-media{border:1px solid var(--tp-border);border-radius:12px;overflow:hidden;background:var(--tp-panelBg);
        display:flex;flex-direction:column;min-width:0}
      .dsh-tp-media .thumb{position:relative;width:100%;aspect-ratio:1/1;background:var(--tp-accent-soft);
        display:flex;align-items:center;justify-content:center;overflow:hidden}
      .dsh-tp-media .thumb img,.dsh-tp-media .thumb video{width:100%;height:100%;object-fit:cover;display:block}
      .dsh-tp-media:not(.pending):not(.failed) .thumb{cursor:zoom-in}
      .dsh-tp-media .ph{font-size:12px;color:var(--tp-sub)}
      .dsh-tp-media .badge-video,.dsh-tp-media .badge-state{position:absolute;left:6px;bottom:6px;padding:1px 6px;border-radius:999px;
        font-size:10px;background:rgba(0,0,0,.6);color:#fff;line-height:16px}
      .dsh-tp-media .badge-state{left:auto;right:6px;background:rgba(124,58,237,.85)}
      .dsh-tp-media .meta{padding:8px 9px;display:flex;flex-direction:column;gap:2px;min-width:0}
      .dsh-tp-media .meta .model{font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-tp-media .meta .time,.dsh-tp-media .meta .params{font-size:11px;color:var(--tp-sub);
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-tp-media.failed{border-color:rgba(220,38,38,.35)}

      .dsh-tp-lightbox{position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,.72);
        display:flex;align-items:center;justify-content:center;padding:24px}
      .dsh-tp-lightbox-body{max-width:min(1040px,94vw);max-height:92vh;display:flex;flex-direction:column;gap:10px;
        background:var(--tp-panelBg);border-radius:14px;padding:14px}
      .dsh-tp-lightbox-media{max-width:min(1000px,90vw);max-height:70vh;border-radius:10px;display:block;margin:0 auto;object-fit:contain}
      .dsh-tp-lightbox-missing{padding:40px 60px;text-align:center;color:var(--tp-sub);font-size:12px}
      .dsh-tp-lightbox-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
      .dsh-tp-lightbox-meta .title{font-size:13px;font-weight:650}
      .dsh-tp-lightbox-meta .sub{font-size:11px;color:var(--tp-sub)}
      .dsh-tp-lightbox-actions{display:flex;gap:8px;justify-content:flex-end}
      .dsh-tp-lightbox-actions .dsh-tp-btn{text-decoration:none;display:inline-flex;align-items:center}

      /* ---- inline tool result card (conversation) ---- */
      .dsh-tp-toolcard{
        --tp-font:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);
        --tp-fg:var(--dsw-alias-text-primary,#1f2937);
        --tp-sub:var(--dsw-alias-text-secondary,#6b7280);
        --tp-soft:var(--dsw-alias-fill-tsp-gray-main,rgba(15,17,21,.06));
        --tp-border:var(--dsw-alias-border-default,rgba(124,58,237,0.18));
        --tp-accent:${ACCENT};
        --tp-accent-soft:rgba(124,58,237,0.12);
        --tp-err:#dc2626;
        --tp-panelBg:var(--dsw-alias-bg-elevated,#fff);
        font-family:var(--tp-font);color:var(--tp-fg);box-sizing:border-box;
        display:flex;flex-direction:column;gap:8px;margin:2px 0;padding:10px 12px;
        border:1px solid var(--tp-border);border-radius:12px;background:var(--tp-panelBg);max-width:100%}
      .dsh-tp-toolcard *{box-sizing:border-box}
      .dsh-tp-toolcard.failed{border-color:rgba(220,38,38,.35)}
      .dsh-tp-toolcard-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
      .dsh-tp-toolcard-title{font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-tp-toolcard-state{flex:none;font-size:11px;color:var(--tp-sub)}
      .dsh-tp-toolcard-state.failed{color:var(--tp-err)}
      .dsh-tp-toolcard-note{font-size:11px;color:var(--tp-sub);white-space:pre-wrap;word-break:break-word}
      .dsh-tp-toolcard-note.err{color:var(--tp-err)}
      .dsh-tp-toolcard-prompt{font-size:11px;color:var(--tp-sub);overflow:hidden;text-overflow:ellipsis;
        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      .dsh-tp-toolcard-media{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
      .dsh-tp-toolcard-thumb{position:relative;border:1px solid var(--tp-border);border-radius:10px;overflow:hidden;
        background:var(--tp-accent-soft);min-height:96px;display:flex;align-items:center;justify-content:center}
      .dsh-tp-toolcard-thumb img,.dsh-tp-toolcard-thumb video{width:100%;height:auto;max-height:320px;
        object-fit:contain;display:block;background:#000}
      .dsh-tp-toolcard-thumb.pending{cursor:default}
      .dsh-tp-toolcard-thumb:not(.pending){cursor:zoom-in}
      .dsh-tp-toolcard-thumb .ph{font-size:11px;color:var(--tp-sub);padding:24px 8px}
      .dsh-tp-toolcard-actions{display:flex;gap:8px;flex-wrap:wrap}
      .dsh-tp-toolcard-actions .dsh-tp-btn{text-decoration:none;display:inline-flex;align-items:center}

      /* ---- AI创作 生成器 ---- */
      .dsh-tp-studio{display:flex;flex-direction:column;gap:10px;border:1px solid var(--tp-border);border-radius:12px;
        padding:12px;margin-bottom:16px;background:var(--tp-panelBg)}
      .dsh-tp-field{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--tp-sub);min-width:0}
      .dsh-tp-field.wide{width:100%}
      .dsh-tp-field em{font-style:normal;font-size:10px;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-tp-field-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
      .dsh-tp-field-row .dsh-tp-field{flex:1 1 110px}
      .dsh-tp-field.checkbox{flex-direction:row;align-items:center;gap:6px;flex:0 0 auto}
      .dsh-tp-select,.dsh-tp-input,.dsh-tp-textarea{
        font:inherit;font-size:12px;color:var(--tp-fg);background:var(--dsw-alias-bg-base,transparent);
        border:1px solid var(--tp-border);border-radius:8px;padding:6px 8px;min-width:0;width:100%}
      .dsh-tp-textarea{resize:vertical;line-height:1.5}
      .dsh-tp-field-actions{display:flex;justify-content:flex-end;margin-top:2px}
      .dsh-tp-studio-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:2px}
      .dsh-tp-cost{font-size:11px;color:var(--tp-sub)}
      .dsh-tp-cost b{color:var(--tp-fg)}
      .dsh-tp-note.ok{color:var(--tp-ok)}
      .dsh-tp-gallery-sec{display:flex;flex-direction:column;gap:8px}
      .dsh-tp-file{padding:5px 6px;font-size:11px}
      .dsh-tp-refs{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
      .dsh-tp-ref{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--tp-fg);
        background:var(--tp-accent-soft);border-radius:999px;padding:2px 8px;max-width:220px;overflow:hidden}
      .dsh-tp-ref button{border:0;background:transparent;color:var(--tp-sub);cursor:pointer;font-size:13px;line-height:1;padding:0}
      .dsh-tp-ref button:hover{color:var(--tp-err)}

      @media (max-width:900px){
        .dsh-tp-stats,.dsh-tp-charts{grid-template-columns:1fr}
        .dsh-tp-panel{min-width:0;width:calc(100vw - 16px)!important}
        .dsh-tp-sidebar{width:140px}
        .dsh-tp-media-grid{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}
      }
    `;

    return module.exports;
  }
});