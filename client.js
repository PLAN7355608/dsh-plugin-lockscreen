/**
 * 锁屏插件 · 「界面」那一半（Client）—— 0.1.0-dev.8
 *
 * ═══════════════ 这一版能干什么 ═══════════════
 *
 *   Ctrl+Shift+L  → 打开 / 关闭「锁屏画面」预览
 *   Esc           → 关掉预览
 *   1 / 2 / 3     → 切换三种时钟样式（预览时有效，选完会记住）
 *
 *   画面：铺满整个窗口（顶着窗口上下边缘，不是中间一个小框）。
 *   内容：大号时钟、日期星期、留言区、待输入行、底部状态条、四角标记、扫描线。
 *
 *   注意：这一版**还不是真锁**——按 Esc 就能走，不验口令。真锁是下一步。
 *
 * ═══════════════ 为什么代码都在一个文件里 ═══════════════
 *
 *   计划里原本要拆 lib/tui.js、lib/screen.js。但界面插件的 require 是 DSH
 *   递进来的，只保证拿得到 react 这类"库"，能不能相对路径 require 自己的
 *   文件没验证过；为了不引入打包工具，先全部放这一个文件，用「小节」分区。
 *
 * ═══════════════ 为什么外框不用字符拼（重要） ═══════════════
 *
 *   汉字在等宽字体里"大约"占 2 个字母宽，但浏览器里不保证正好 2 倍
 *   （Consolas 字母约 0.55em，新宋体全角 1em，比例 1.82），所以用字符
 *   一格一格补右边框，混排中文时一定会歪。
 *   解法：外框/分隔线用 CSS 画，中文只出现在左对齐整行里，两端对齐用 flex。
 *   另外：方块字符 █ 在 Consolas 里没有，会 fallback 到别的字体、宽度不可控，
 *   所以大号时钟改用纯 ASCII 的 # 拼（# 和字母同一个字体，宽度绝对可控）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-lockscreen',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement

    /** 版本号：和 package.json 保持一致（打包后读不到 package.json）。 */
    const VERSION = '0.1.4'

    /** 浮层在 DSH 里的身份证。 */
    const OVERLAY_ID = 'dsh-plugin-lockscreen'

    /** 等宽字体栈：Windows 优先 Consolas + 新宋体，Linux 用 DejaVu / Noto。 */
    const MONO =
      "Consolas, 'NSimSun', '新宋体', 'DejaVu Sans Mono', 'Noto Sans Mono CJK SC', ui-monospace, monospace"

    /* ══════════════════════════════════════════════════════════════════
     * 小节 1：调色板（配色）
     *
     * 用户已定：跟随 DSH 深浅色。做法是"猜"：看网页根元素的 class / data-theme
     * 有没有 dark|light，没有就看系统偏好。想固定某一种，改 FORCE_THEME。
     * ══════════════════════════════════════════════════════════════════ */
    const FORCE_THEME = 'auto' // 'auto' | 'dark' | 'light'

    const PALETTES = {
      dark: {
        bg: '#06060a',
        border: '#2b2b37',
        text: '#d8d8d0',
        dim: '#71717e',
        accent: '#8fd3bd',
        clock: '#c9f2e2',
        warn: '#e2b567',
        scanline: 'rgba(255, 255, 255, 0.030)',
        toastBg: '#101016',
        // 偏振片数显用的笔画色（只留亮着的笔画，不画面板/暗影，见 ClockPolar 注释）
        polarOn: '#b6f0d2',
      },
      light: {
        bg: '#f5f5f0',
        border: '#c8c8bf',
        text: '#1b1b21',
        dim: '#6f6f78',
        accent: '#0d7a5f',
        clock: '#12372d',
        warn: '#8a5a00',
        scanline: 'rgba(0, 0, 0, 0.026)',
        toastBg: '#fbfbf7',
        // 偏振片数显：浅色主题下笔画是墨黑（老计算器那种）
        polarOn: '#14211c',
      },
    }

    /** 猜当前是不是深色。 */
    function detectDark() {
      if (FORCE_THEME === 'dark') return true
      if (FORCE_THEME === 'light') return false
      try {
        const root = document.documentElement
        const hint = String(root.getAttribute('data-theme') || root.getAttribute('data-color-scheme') || '')
        if (/dark/i.test(hint)) return true
        if (/light/i.test(hint)) return false
        const cls = root.className || ''
        if (/(^|\s)(dark|theme-dark)(\s|$)/.test(cls)) return true
        if (/(^|\s)(light|theme-light)(\s|$)/.test(cls)) return false
        if (window.matchMedia) return !window.matchMedia('(prefers-color-scheme: light)').matches
      } catch {
        /* 猜不出来就当深色 */
      }
      return true
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 2：字符宽度小工具（以后画进度条、对齐表格要用）
     * ══════════════════════════════════════════════════════════════════ */
    function isWideCode(code) {
      return (
        (code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0x303e) ||
        (code >= 0x3041 && code <= 0x33ff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0xa000 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1f9ff)
      )
    }

    /** 一串字占几格（汉字 2 格，其他 1 格）。 */
    function strWidth(text) {
      let width = 0
      for (const ch of String(text)) width += isWideCode(ch.codePointAt(0)) ? 2 : 1
      return width
    }

    function repeat(ch, n) {
      return n > 0 ? ch.repeat(n) : ''
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 3：TUI 零件
     * ══════════════════════════════════════════════════════════════════ */

    /** 内容区宽度（单位：字母格数）。 */
    const CONTENT_CH = 62

    /**
     * 锁屏上"除时钟以外"的文字字号（2026-10-24 用户批注"除了时钟以外其他的字小了点"）。
     *
     * 为什么用 vh 而不是固定 px：这块屏 2048×1152 时是 20.2px，笔记本 1280×720 时
     * 自动降到 15px 下限，4K 屏上到 30px 封顶——不管换什么屏幕，字和画面的比例都差不多。
     */
    const BODY_FS = 'clamp(15px, 1.75vh, 30px)'

    /** 一条纯字符分隔线。这些字符彼此等宽，所以绝对不歪。 */
    function rule(ch) {
      return repeat(ch || '-', CONTENT_CH)
    }

    /** 小节标题，例如 "| 留言"。用 ASCII 竖线，避免制表符字体 fallback。 */
    function sectionTitle(text) {
      return '| ' + text
    }

    const pad2 = (n) => (n < 10 ? '0' + n : '' + n)

    const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

    function formatDate(date) {
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${WEEKDAYS[date.getDay()]}`
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 4：时钟（只有一款：偏振片数显）
     *
     * 历史：这里原来并排放着三种款式（辉光管 / 超大字号 / 偏振片），
     * 2026-10-24 用户拍板「只保留这一个数字时钟，剩下那两个先不要了」，
     * 于是另外两款连同字符拼的点阵一起删掉，只留偏振片这一款。
     * ══════════════════════════════════════════════════════════════════ */

    /**
     * 七段笔画和数字的对应表：哪几段亮，就显示哪个数字。
     * a=上横 b=右上竖 c=右下竖 d=下横 e=左下竖 f=左上竖 g=中横
     */
    const SEG_ON = {
      '0': 'abcdef',
      '1': 'bc',
      '2': 'abged',
      '3': 'abgcd',
      '4': 'fgbc',
      '5': 'afgcd',
      '6': 'afgedc',
      '7': 'abc',
      '8': 'abcdefg',
      '9': 'abfgcd',
    }

    /**
     * 偏振片数显里的一个数字：不是用字符拼，而是用 7 个"玻璃片"叠出来的。
     *
     * 只画亮着的笔画——用户 2026-10-23 的要求：面板和没点亮的淡影都去掉，
     * 屏幕上只留"显示出来的数字"，所以这里不再画未点亮的段。
     *
     * 尺寸全部用 em，跟着外部字号缩放，所以窗口大小变化时不会错位。
     */
    function SegDigit(props) {
      const { ch, P } = props
      const on = SEG_ON[ch] || ''
      // 每个笔画的位置（em 为单位）：横向的 a/d/g 和纵向的 f/b/e/c
      const place = {
        a: { top: 0 },
        d: { top: '1.77em' },
        g: { top: '0.885em' },
        f: { left: 0, top: '0.16em' },
        b: { right: 0, top: '0.16em' },
        e: { left: 0, top: '1.02em' },
        c: { right: 0, top: '1.02em' },
      }
      // 数字 1 只有竖笔画，分**上下两节**（跟别的数字的竖笔画一样在中间断开），
      // 不是一根画到底——这是用户 2026-10-23 明确的要求："1 应该是分成上下两节的"。
      // 另外：① 不带面板之后贴着格子右边会显得"数字被推到一边"，所以挪到格子里居中；
      // ② 格子收窄到 0.62em（数字钟本来 1 就比别的数字窄），"1 9" 中间才不会空一大块。
      if (ch === '1') {
        const piece = (top) => h('b', {
          key: top,
          style: {
            position: 'absolute',
            display: 'block',
            left: '0.245em',
            top,
            width: '0.13em',
            height: '0.72em',
            borderRadius: '0.02em',
            background: P.polarOn,
            clipPath: 'polygon(0 8%, 50% 0, 100% 8%, 100% 92%, 50% 100%, 0 92%)',
          },
        })
        return h('div', { style: { position: 'relative', width: '0.62em', height: '1.9em' } },
          piece('0.16em'), piece('1.02em'))
      }
      // 笔画两端削成斜面（clip-path），才像真的玻璃段，不是方积木。
      // 横笔画左右各缩进 0.12em：用户 2026-10-23 看过"铺满格子"的对照版之后，
      // 明确选了这个"留一点边"的版本（`m02134`：「旧版的行」），所以这里保持原样。
      const shapeH = {
        left: '0.12em',
        width: '0.76em',
        height: '0.13em',
        clipPath: 'polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%)',
      }
      const shapeV = {
        width: '0.13em',
        height: '0.72em',
        clipPath: 'polygon(0 8%, 50% 0, 100% 8%, 100% 92%, 50% 100%, 0 92%)',
      }
      return h(
        'div',
        { style: { position: 'relative', width: '1em', height: '1.9em' } },
        ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((seg) => {
          if (on.indexOf(seg) < 0) return null
          const shape = 'adg'.indexOf(seg) >= 0 ? shapeH : shapeV
          return h('b', {
            key: seg,
            style: Object.assign(
              {
                position: 'absolute',
                display: 'block',
                borderRadius: '0.02em',
                background: P.polarOn,
              },
              shape,
              place[seg],
            ),
          })
        }),
      )
    }

    /**
     * 偏振片数显（像老计算器 / 电子表的液晶笔画）。
     *
     * 2026-10-23 用户定稿：**不要面板、不要没点亮笔画的淡影**，
     * 只把"显示出来的数字"留在屏幕上——所以这里没有背景、没有反光、
     * 没有外框，四个数字直接浮在锁屏底色上，靠薄荷色和削角的笔画保持
     * "液晶段"的观感。
     */
    function ClockPolar(props) {
      const { now, P } = props
      const hh = pad2(now.getHours())
      const mm = pad2(now.getMinutes())
      const dot = {
        width: '0.18em',
        height: '0.18em',
        borderRadius: '0.02em',
        background: P.polarOn,
      }
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.20em',
            padding: '0.06em 0.10em',
            // 字号定在这里，里面所有尺寸都是 em，跟着一起放大
            fontSize: 'clamp(38px, 5.6vw, 100px)',
          },
        },
        h(SegDigit, { ch: hh[0], P }),
        h(SegDigit, { ch: hh[1], P }),
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.85em',
              padding: '0 0.20em',
            },
          },
          h('div', { style: dot }),
          h('div', { style: dot }),
        ),
        h(SegDigit, { ch: mm[0], P }),
        h(SegDigit, { ch: mm[1], P }),
      )
    }

    /**
     * 老版本的"时钟款式"记忆键。
     * 2026-10-24 起只剩偏振片一款，这个键不再需要；留着这个名字是为了在启动时把它清掉，
     * 免得浏览器里存着 'nixie' / 'huge' 之类的旧值让人困惑。
     */
    const CLOCK_STYLE_KEY = 'lockscreen.clockStyle'

    function forgetOldClockStyle() {
      try {
        localStorage.removeItem(CLOCK_STYLE_KEY)
      } catch {
        /* localStorage 不可用就算了 */
      }
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 4.5：口令（只存"加盐摘要"，绝不存明文）
     *
     * 为什么这样存：锁屏口令放在浏览器本地，如果直接存明文，谁打开开发者
     * 工具都能看到。所以存的是"口令 + 一次性随机盐"经过很多轮迭代算出来的
     * 摘要（用浏览器自带的 PBKDF2-SHA256，21 万轮）。解锁时把用户输入用
     * 同一把盐重算一遍，摘要对得上就算通过——原文从头到尾不落盘。
     *
     * 忘了口令怎么办：这个插件不改系统设置，口令只管这一层遮罩。清掉浏览器
     * 本地存储里的 lockscreen.cred、lockscreen.fails、lockscreen.cooldownUntil
     * 三项就相当于"没设过"（具体步骤写在 README 里）。
     * ══════════════════════════════════════════════════════════════════ */

    const CRED_KEY = 'lockscreen.cred'
    const FAIL_KEY = 'lockscreen.fails'
    const COOLDOWN_KEY = 'lockscreen.cooldownUntil'

    const PIN_LEN = 4 // PIN 必须正好 4 位数字
    const TEXT_MIN = 6 // 文字口令最短 6 位（用户定下的）
    const TEXT_MAX = 64 // 再长就没必要了，也防止误粘一大段
    const ITERATIONS = 210000 // PBKDF2 迭代轮数（越大越难暴力猜，也越慢一丢丢）

    /* ── 连错几次进冷却 / 冷却多久：0.1.4 起改成设置项（用户定的区间） ──
     * 以前是写死的"连错 5 次、冷却 30 秒"，现在两样都能在设置页里选。
     * 没存过就用默认值，存的值不在候选里也回默认（防止手改坏）。
     */
    const MAX_FAILS_CHOICES = [3, 5, 7]
    const DEFAULT_MAX_FAILS = 5
    const COOLDOWN_SEC_CHOICES = [30, 45, 60]
    const DEFAULT_COOLDOWN_SEC = 30
    const MAX_FAILS_KEY = 'lockscreen.maxFails'
    const COOLDOWN_SEC_KEY = 'lockscreen.cooldownSeconds'

    function loadMaxFails() {
      const n = parseInt(readRaw(MAX_FAILS_KEY) || '', 10)
      return MAX_FAILS_CHOICES.indexOf(n) >= 0 ? n : DEFAULT_MAX_FAILS
    }

    function saveMaxFails(n) {
      writeRaw(MAX_FAILS_KEY, String(n))
    }

    function loadCooldownSec() {
      const n = parseInt(readRaw(COOLDOWN_SEC_KEY) || '', 10)
      return COOLDOWN_SEC_CHOICES.indexOf(n) >= 0 ? n : DEFAULT_COOLDOWN_SEC
    }

    function saveCooldownSec(n) {
      writeRaw(COOLDOWN_SEC_KEY, String(n))
    }

    /** 当前生效的冷却时长（毫秒）。 */
    function cooldownMs() {
      return loadCooldownSec() * 1000
    }

    function readRaw(key) {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    }

    function writeRaw(key, value) {
      try {
        localStorage.setItem(key, value)
      } catch {
        /* 存不了不影响这一屏的使用 */
      }
    }

    function dropKey(key) {
      try {
        localStorage.removeItem(key)
      } catch {
        /* 同上 */
      }
    }

    function readJSON(key) {
      try {
        return JSON.parse(readRaw(key) || 'null')
      } catch {
        return null
      }
    }

    function writeJSON(key, value) {
      writeRaw(key, JSON.stringify(value))
    }

    function toB64(bytes) {
      let s = ''
      for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i])
      return btoa(s)
    }

    function fromB64(text) {
      const s = atob(text)
      const out = new Uint8Array(s.length)
      for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i)
      return out
    }

    /** 读出已保存的口令记录；没有或不认识就返回 null。 */
    function getCredential() {
      const cred = readJSON(CRED_KEY)
      if (!cred || cred.v !== 1 || !cred.salt || !cred.hash) return null
      if (cred.kind !== 'pin' && cred.kind !== 'text') return null
      return cred
    }

    /** 浏览器自带的加密接口（只在 https 或 127.0.0.1 这类安全上下文里有）。 */
    function getSubtleCrypto() {
      const c = typeof crypto !== 'undefined' ? crypto : null
      return c && c.subtle && typeof c.subtle.importKey === 'function' ? c.subtle : null
    }

    async function deriveDigest(secret, saltBytes, iterations) {
      const subtle = getSubtleCrypto()
      if (!subtle) {
        throw new Error('当前界面不是安全上下文（需 https 或 127.0.0.1），无法加密口令')
      }
      const raw = new TextEncoder().encode(String(secret))
      const key = await subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveBits'])
      const bits = await subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
        key,
        256,
      )
      return new Uint8Array(bits)
    }

    /** 保存口令。kind 是 'pin' 或 'text'。 */
    async function saveCredential(kind, secret) {
      const c = typeof crypto !== 'undefined' ? crypto : null
      if (!c || typeof c.getRandomValues !== 'function') {
        throw new Error('这台机器取不到随机数，无法安全保存口令')
      }
      const salt = new Uint8Array(16)
      c.getRandomValues(salt)
      const digest = await deriveDigest(secret, salt, ITERATIONS)
      const cred = {
        v: 1,
        kind,
        iter: ITERATIONS,
        salt: toB64(salt),
        hash: toB64(digest),
        at: new Date().toISOString(), // 只记"什么时候设的"，不记口令本身
      }
      writeJSON(CRED_KEY, cred)
      clearFailState()
      return cred
    }

    /**
     * 校验一次输入。
     * 比对用固定长度的循环（不提前 return），避免从耗时上猜"前几位对了"。
     */
    async function checkCredential(cred, input) {
      if (!cred) return false
      const salt = fromB64(cred.salt)
      const digest = await deriveDigest(input, salt, cred.iter || ITERATIONS)
      const want = fromB64(cred.hash)
      if (digest.length !== want.length) return false
      let diff = 0
      for (let i = 0; i < digest.length; i += 1) diff |= digest[i] ^ want[i]
      return diff === 0
    }

    function clearCredential() {
      dropKey(CRED_KEY)
      clearFailState()
    }

    function readFails() {
      const n = parseInt(readRaw(FAIL_KEY) || '0', 10)
      return Number.isFinite(n) && n > 0 ? n : 0
    }

    /** 冷却还剩多少毫秒（0 = 可以试）。 */
    function cooldownLeftMs() {
      const until = parseInt(readRaw(COOLDOWN_KEY) || '0', 10)
      return Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0
    }

    /** 记一次输错；返回 { fails, cooldownMs, maxFails }，连错到上限就进冷却。 */
    function noteFailure() {
      const maxFails = loadMaxFails()
      const cd = cooldownMs()
      let fails = readFails() + 1
      let cooldown = 0
      if (fails >= maxFails) {
        fails = 0
        cooldown = cd
        writeRaw(COOLDOWN_KEY, String(Date.now() + cd))
      }
      writeRaw(FAIL_KEY, String(fails))
      return { fails, cooldownMs: cooldown, maxFails }
    }

    /**
     * 只把"连错次数"清零，冷却（`COOLDOWN_KEY`）不动。
     * 用在出错页返回输入页的那一刻：用户回来了，次数重新从 0 开始，
     * 但冷却还在走，所以这段时间输入框仍然是禁用状态。
     */
    function resetFailCount() {
      writeRaw(FAIL_KEY, '0')
    }

    function clearFailState() {
      dropKey(FAIL_KEY)
      dropKey(COOLDOWN_KEY)
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 4.6：解锁面板 / 首次设置口令面板
     *
     * 两个面板都是"一行提示 + 一行输入"，跟整屏的 TUI 风格对齐：
     * 输入框不要边框、只留一条下划线，光标自己会闪。
     * ══════════════════════════════════════════════════════════════════ */

    /** 输入框的公共样式（等宽、透明底、只有下划线）。 */
    function tuiInputStyle(P, widthCh) {
      return {
        width: widthCh ? `${widthCh}ch` : '100%',
        maxWidth: '100%',
        background: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${P.border}`,
        borderRadius: 0,
        outline: 'none',
        color: P.clock,
        fontFamily: MONO,
        fontSize: '1.1em',
        letterSpacing: '0.20em',
        padding: '2px 4px 4px',
        caretColor: P.clock,
      }
    }

    /** 一个"标签 + 内容"的行，面板里复用。 */
    function panelLine(P, label, children) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 } },
        h('span', { style: { color: P.accent, flex: '0 0 auto' } }, '>'),
        h('span', { style: { color: P.dim, flex: '0 0 auto', minWidth: '5.5em' } }, label),
        children,
      )
    }

    /** 解锁面板：输口令 → 校验 → 通过就解锁。 */
    function UnlockPanel(props) {
      const { P, cred, onUnlocked } = props
      const kind = cred && cred.kind === 'pin' ? 'pin' : 'text'

      const [value, setValue] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [cooldown, setCooldown] = React.useState(() => Math.ceil(cooldownLeftMs() / 1000))
      const inputRef = React.useRef(null)

      // 一进来就聚焦，用户不用先点一下。
      React.useEffect(() => {
        if (inputRef.current) inputRef.current.focus()
      }, [])

      // 冷却倒计时：每 0.5 秒对一次表，到 0 自动解开。
      React.useEffect(() => {
        if (cooldown <= 0) return undefined
        const timer = setInterval(() => {
          const left = Math.ceil(cooldownLeftMs() / 1000)
          if (left <= 0) {
            setCooldown(0)
            setError('冷却结束，可以再试了')
            return
          }
          setCooldown(left)
        }, 500)
        return () => clearInterval(timer)
      }, [cooldown])

      const blocked = cooldown > 0

      // 输入框在校验中会临时 disabled（禁用会让浏览器把光标丢掉），
      // 所以等它重新可用之后再把光标放回去，用户输错不用自己再点一下。
      React.useEffect(() => {
        if (!busy && !blocked && inputRef.current) inputRef.current.focus()
      }, [busy, blocked])

      const submit = async () => {
        if (busy || blocked) return
        const input = kind === 'pin' ? value.replace(/\D/g, '') : value
        if (!input) {
          setError('还没输入')
          return
        }
        setBusy(true)
        setError('')
        try {
          if (await checkCredential(cred, input)) {
            clearFailState()
            setValue('')
            onUnlocked()
            return
          }
          const result = noteFailure()
          setValue('')
          if (result.cooldownMs > 0) {
            // 连错到上限：不再停在输入页，交给上层切到"出错页"（0.1.4）
            setCooldown(Math.ceil(result.cooldownMs / 1000))
            if (props.onLockout) props.onLockout(result.cooldownMs)
          } else {
            const left = result.maxFails - result.fails
            setError(`${kind === 'pin' ? 'PIN' : '口令'}不对，还能试 ${left} 次`)
          }
        } catch (err) {
          setError('校验出错：' + (err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      const onKeyDown = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          submit()
        }
      }

      const shown = kind === 'pin' ? value.replace(/\D/g, '').slice(0, PIN_LEN) : value

      return h(
        'div',
        { style: { marginTop: 4 } },
        panelLine(
          P,
          kind === 'pin' ? 'PIN' : '口令',
          h('input', {
            ref: inputRef,
            type: 'password',
            inputMode: kind === 'pin' ? 'numeric' : 'text',
            autoComplete: 'off',
            spellCheck: false,
            maxLength: kind === 'pin' ? PIN_LEN : TEXT_MAX,
            value: kind === 'pin' ? shown : value,
            disabled: blocked || busy,
            placeholder: kind === 'pin' ? '4 位数字' : `至少 ${TEXT_MIN} 位`,
            onChange: (event) => {
              const raw = event.target.value
              setValue(kind === 'pin' ? raw.replace(/\D/g, '').slice(0, PIN_LEN) : raw)
              if (error) setError('')
            },
            onKeyDown,
            style: tuiInputStyle(P, kind === 'pin' ? 8 : 32),
          }),
        ),
        // PIN 只显示"已经点了几位"，不显示具体数字（防旁边有人看）。
        kind === 'pin' && shown
          ? h(
              'div',
              { style: { marginTop: 4, color: P.dim, fontSize: '0.9em', letterSpacing: '0.3em' } },
              `已输入 ${shown.length} / ${PIN_LEN} 位`,
            )
          : null,
        blocked
          ? h(
              'div',
              { style: { marginTop: 8, color: P.warn, fontSize: '0.9em' } },
              `冷却中，还剩 ${cooldown} 秒（数到 0 会自动恢复）`,
            )
          : null,
        error
          ? h('div', { style: { marginTop: 8, color: P.warn, fontSize: '0.9em' } }, error)
          : null,
        // 这里原来还有一行"输完按 Enter 解锁（…）"，2026-10-24 用户要求删掉，
        // 只保留冷却时的必要提示（那不是说明文字，是当下状态的告知）。
        blocked
          ? h(
              'div',
              { style: { marginTop: 8, fontSize: '0.9em', color: P.dim } },
              '冷却期间不接受输入',
            )
          : null,
      )
    }

    /** 首次使用时的设置面板：先让用户设一个口令。 */
    function SetupPanel(props) {
      const { P, onCredSaved } = props
      const [kind, setKind] = React.useState('pin')
      const [first, setFirst] = React.useState('')
      const [again, setAgain] = React.useState('')
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const firstRef = React.useRef(null)

      React.useEffect(() => {
        if (firstRef.current) firstRef.current.focus()
      }, [kind])

      const submit = async () => {
        if (busy) return
        const a = kind === 'pin' ? first.replace(/\D/g, '') : first
        const b = kind === 'pin' ? again.replace(/\D/g, '') : again
        if (kind === 'pin' && !/^\d{4}$/.test(a)) {
          setError(`PIN 必须正好 ${PIN_LEN} 位数字`)
          return
        }
        if (kind === 'text' && (a.length < TEXT_MIN || a.length > TEXT_MAX)) {
          setError(`文字口令要 ${TEXT_MIN}–${TEXT_MAX} 位`)
          return
        }
        if (a !== b) {
          setError('两次输入不一样，再确认一下')
          return
        }
        setBusy(true)
        setError('')
        try {
          const cred = await saveCredential(kind, a)
          setFirst('')
          setAgain('')
          onCredSaved(cred)
        } catch (err) {
          setError('保存失败：' + (err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      const onKeyDown = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          submit()
        }
      }

      const tab = (id, text) =>
        h(
          'span',
          {
            key: id,
            onClick: () => {
              setKind(id)
              setError('')
            },
            style: {
              cursor: 'pointer',
              padding: '2px 8px',
              border: `1px solid ${kind === id ? P.accent : P.border}`,
              color: kind === id ? P.accent : P.dim,
              fontSize: '0.9em',
            },
          },
          text,
        )

      const input = (ref, value, setValue, placeholder) =>
        h('input', {
          ref,
          type: 'password',
          autoComplete: 'off',
          spellCheck: false,
          maxLength: kind === 'pin' ? PIN_LEN : TEXT_MAX,
          value,
          disabled: busy,
          placeholder,
          onChange: (event) => {
            const raw = event.target.value
            setValue(kind === 'pin' ? raw.replace(/\D/g, '').slice(0, PIN_LEN) : raw)
            if (error) setError('')
          },
          onKeyDown,
          style: tuiInputStyle(P, kind === 'pin' ? 8 : 32),
        })

      return h(
        'div',
        { style: { marginTop: 4 } },
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 } },
          tab('pin', '数字 PIN'),
          tab('text', '文字口令'),
          h(
            'span',
            { style: { color: P.dim, fontSize: '0.9em' } },
            kind === 'pin' ? `正好 ${PIN_LEN} 位数字` : `至少 ${TEXT_MIN} 位，中文也行`,
          ),
        ),
        panelLine(P, '新口令', input(firstRef, first, setFirst, kind === 'pin' ? '例如 0823' : '至少 6 位')),
        panelLine(P, '再输一遍', input(null, again, setAgain, '再输一遍确认')),
        h(
          'div',
          { style: { marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 10 } },
          h(
            'span',
            {
              onClick: busy ? undefined : submit,
              style: {
                cursor: busy ? 'default' : 'pointer',
                padding: '3px 14px',
                border: `1px solid ${P.accent}`,
                color: P.accent,
                fontSize: '1em',
                letterSpacing: '0.08em',
                opacity: busy ? 0.5 : 1,
              },
            },
            busy ? '[ 保存中... ]' : '[ 保存口令 ]',
          ),
          h('span', { style: { color: P.dim, fontSize: '0.9em' } }, '（回车也可以）'),
        ),
        error ? h('div', { style: { marginTop: 8, color: P.warn, fontSize: '0.9em' } }, error) : null,
        h(
          'div',
          { style: { marginTop: 10, fontSize: '0.85em', color: P.dim } },
          '口令只存"加盐摘要"，不存原文；忘了只能清本地存储重置（步骤见 README）。',
          h('br', null),
          '保存之后仍然是锁着的，要再输一遍刚才设的口令才能解开（这是故意的，顺便验证一遍）。',
        ),
      )
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 5：锁屏画面
     * ══════════════════════════════════════════════════════════════════ */

    /** 预览时用的示例留言；没设过留言时锁屏上就显示这句。 */
    const DEFAULT_MESSAGE = '这里以后是你自己写的留言，可以在设置里改。'

    /* ── 留言：存在浏览器本地（键 lockscreen.message），和口令一样不进代码 ── */

    const MESSAGE_KEY = 'lockscreen.message'

    /* ── 已锁定时长显示：默认关（'0'），开了之后锁屏画面会多一行"已锁定 03:12" ── */

    const SHOW_LOCKED_FOR_KEY = 'lockscreen.showLockedFor'

    function loadShowLockedFor() {
      return readRaw(SHOW_LOCKED_FOR_KEY) === '1'
    }

    function saveShowLockedFor(on) {
      writeRaw(SHOW_LOCKED_FOR_KEY, on ? '1' : '0')
    }

    /** 把"锁了多久"格式化成 00:12 / 1:02:03（不足 1 小时只显示 分:秒）。 */
    function formatElapsed(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      return hours > 0
        ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
        : `${pad2(minutes)}:${pad2(seconds)}`
    }

    /* ── 锁屏时禁用鼠标：默认开（'1'）。开了之后指针隐藏、点击/右键/滚轮/拖拽全拦掉 ── */

    const BLOCK_MOUSE_KEY = 'lockscreen.blockMouse'

    function loadBlockMouse() {
      // 没写过的老用户也按"开"处理：锁屏本来就该像 ATM，键盘才是正路
      return readRaw(BLOCK_MOUSE_KEY) !== '0'
    }

    function saveBlockMouse(on) {
      writeRaw(BLOCK_MOUSE_KEY, on ? '1' : '0')
    }

    /* ── 打开应用就锁屏：默认开（'1'）。开着时页面一加载就立刻锁上 ── */

    const LOCK_ON_START_KEY = 'lockscreen.lockOnStart'

    function loadLockOnStart() {
      // 只有明确写成 '0' 才算关；从没设过的（包括老用户）默认开
      return readRaw(LOCK_ON_START_KEY) !== '0'
    }

    function saveLockOnStart(on) {
      writeRaw(LOCK_ON_START_KEY, on ? '1' : '0')
    }

    /* ── 自动落锁（0.1.3）：多久没动就自己锁上 ──
     *
     * 能看到的"活动"只有 DSH 这个窗口里的键盘、鼠标、滚轮、触摸；
     * 你在别的软件里怎么敲，插件是看不见的（浏览器安全限制，没法读全局输入）。
     * 所以"没动"= 在 DSH 里没动。切到别的软件时窗口会失焦，想更保险可以开
     * 「切走 DSH 就锁」，那条是按"失去焦点多久"算的，不依赖全局输入。
     */

    const AUTO_LOCK_KEY = 'lockscreen.autoLock'
    const IDLE_MINUTES_KEY = 'lockscreen.idleMinutes'
    const BLUR_LOCK_KEY = 'lockscreen.blurLock'
    const BLUR_SECONDS_KEY = 'lockscreen.blurSeconds'
    const AUTO_LOCK_WARN_KEY = 'lockscreen.autoLockWarn'

    /** 设置页里能选的空闲时长（分钟）。给区间，用户自己挑。 */
    const IDLE_CHOICES = [1, 3, 5, 10, 15, 30, 60]
    /** 设置页里能选的"失焦多久就锁"（秒）；0 = 立刻。 */
    const BLUR_CHOICES = [0, 30, 60, 120]

    function loadAutoLock() {
      // 新功能默认关：升级上来的人不该一觉醒来发现自己被锁在外面
      return readRaw(AUTO_LOCK_KEY) === '1'
    }

    function saveAutoLock(on) {
      writeRaw(AUTO_LOCK_KEY, on ? '1' : '0')
    }

    function loadIdleMinutes() {
      const value = Number(readRaw(IDLE_MINUTES_KEY))
      return IDLE_CHOICES.includes(value) ? value : 5
    }

    function saveIdleMinutes(minutes) {
      writeRaw(IDLE_MINUTES_KEY, String(minutes))
    }

    function loadBlurLock() {
      return readRaw(BLUR_LOCK_KEY) === '1'
    }

    function saveBlurLock(on) {
      writeRaw(BLUR_LOCK_KEY, on ? '1' : '0')
    }

    function loadBlurSeconds() {
      const value = Number(readRaw(BLUR_SECONDS_KEY))
      return BLUR_CHOICES.includes(value) ? value : 30
    }

    function saveBlurSeconds(seconds) {
      writeRaw(BLUR_SECONDS_KEY, String(seconds))
    }

    function loadAutoLockWarn() {
      // 默认开：快锁之前先在角落提示几秒，免得你正想事情就被锁
      return readRaw(AUTO_LOCK_WARN_KEY) !== '0'
    }

    function saveAutoLockWarn(on) {
      writeRaw(AUTO_LOCK_WARN_KEY, on ? '1' : '0')
    }

    /**
     * 空闲多久算"该锁了"（毫秒）。
     * 测试台可以用 window.__LS_IDLE_MS 压到几秒，方便验证；真机读设置页那个分钟数。
     */
    function autoLockIdleMs() {
      if (typeof window !== 'undefined' && Number(window.__LS_IDLE_MS) > 0) {
        return Number(window.__LS_IDLE_MS)
      }
      return loadIdleMinutes() * 60000
    }

    /** 开锁前提前多久开始提示：取空闲时长的 20%，最多 10 秒、最少 1 秒。 */
    function autoLockWarnMs(idleMs) {
      return Math.min(10000, Math.max(1000, Math.round(idleMs * 0.2)))
    }

    /** 把自动落锁的几项设置读成一个包，交给界面拿去跑计时器。 */
    function readAutoCfg() {
      return {
        on: loadAutoLock(),
        idleMs: autoLockIdleMs(),
        warn: loadAutoLockWarn(),
        blur: loadBlurLock(),
        blurMs: loadBlurSeconds() * 1000,
      }
    }

    /** 设置页改完东西后发一个事件，锁屏画面那边收到就刷新，不用重启 DSH。 */
    const SETTINGS_EVENT = 'lockscreen:changed'

    function notifySettingsChanged() {
      try {
        window.dispatchEvent(new CustomEvent(SETTINGS_EVENT))
      } catch {
        /* 老浏览器不支持 CustomEvent 就算了，反正下次刷新也会读到新值 */
      }
    }

    /** 读留言：没设过（或空）就返回默认那句。 */
    function loadMessage() {
      const saved = readRaw(MESSAGE_KEY)
      if (saved === null) return DEFAULT_MESSAGE
      const text = String(saved).trim()
      return text ? text : DEFAULT_MESSAGE
    }

    /** 存留言：传空字符串 = 恢复默认（把键删掉）。 */
    function saveMessage(text) {
      const value = String(text === null || text === undefined ? '' : text).replace(/[\r\n]+/g, ' ').trim()
      if (value) writeRaw(MESSAGE_KEY, value)
      else dropKey(MESSAGE_KEY)
      return loadMessage()
    }

    /* ── 留言的显示方式（0.1.4 新增）：滚动字幕 / 速度 / 字号 / RGB 逐字变色 ──
     * 四个都是设置项，默认：不滚、速度中、字号中、RGB 关。
     * 滚动只在"文字比一行长"的时候才真的滚，短留言保持静止（不然看着像在抖）。
     */
    const MSG_MARQUEE_KEY = 'lockscreen.messageMarquee'
    const MSG_SPEED_KEY = 'lockscreen.messageSpeed'
    const MSG_SIZE_KEY = 'lockscreen.messageSize'
    const MSG_RGB_KEY = 'lockscreen.messageRgb'

    /** 滚动速度：每秒走过多少个字（按字数算，跟屏幕宽度无关）。 */
    const MSG_SPEEDS = [
      { id: 'slow', name: '慢', cps: 6 },
      { id: 'normal', name: '中', cps: 10 },
      { id: 'fast', name: '快', cps: 16 },
    ]

    /** 字号三档：相对于锁屏正文（BODY_FS）的倍数。 */
    const MSG_SIZES = [
      { id: 's', name: '小', em: 0.9 },
      { id: 'm', name: '中', em: 1 },
      { id: 'l', name: '大', em: 1.35 },
    ]

    function loadMsgMarquee() {
      return readRaw(MSG_MARQUEE_KEY) === '1'
    }

    function saveMsgMarquee(on) {
      writeRaw(MSG_MARQUEE_KEY, on ? '1' : '0')
    }

    function loadMsgRgb() {
      return readRaw(MSG_RGB_KEY) === '1'
    }

    function saveMsgRgb(on) {
      writeRaw(MSG_RGB_KEY, on ? '1' : '0')
    }

    function loadMsgSpeedId() {
      const id = readRaw(MSG_SPEED_KEY)
      return MSG_SPEEDS.some((s) => s.id === id) ? id : 'normal'
    }

    function saveMsgSpeedId(id) {
      writeRaw(MSG_SPEED_KEY, id)
    }

    function loadMsgSizeId() {
      const id = readRaw(MSG_SIZE_KEY)
      return MSG_SIZES.some((s) => s.id === id) ? id : 'm'
    }

    function saveMsgSizeId(id) {
      writeRaw(MSG_SIZE_KEY, id)
    }

    /** 一次性把留言的四个开关读成一个包，传给 LockScreen 用。 */
    function loadMsgCfg() {
      const speed = MSG_SPEEDS.find((s) => s.id === loadMsgSpeedId()) || MSG_SPEEDS[1]
      const size = MSG_SIZES.find((s) => s.id === loadMsgSizeId()) || MSG_SIZES[1]
      return {
        marquee: loadMsgMarquee(),
        rgb: loadMsgRgb(),
        speedId: speed.id,
        cps: speed.cps,
        sizeId: size.id,
        sizeEm: size.em,
      }
    }

    /**
     * 留言行：静态一行 / 滚动字幕 / 逐字变色，三种能力可以叠加。
     *
     * 滚动用 `element.animate` 平移（不注入 `<style>`，跟扫描线那套做法一致）：
     * 文字比容器宽才动，一圈的时长 = 字数 ÷ 每秒字数。
     * RGB 用"逐字 span + hsl 上色"，颜色随时间整体转动（每帧算一次颜色）。
     */
    function MessageLine(props) {
      const { P, message, cfg } = props
      const wrapRef = React.useRef(null)
      const innerRef = React.useRef(null)
      const [phase, setPhase] = React.useState(0)

      // RGB：每 90ms 转一次色相，眼睛看着就是"彩色的字在流动"。
      React.useEffect(() => {
        if (!cfg.rgb) return undefined
        let raf = 0
        let last = 0
        const tick = (t) => {
          if (typeof t === 'number' && t - last > 90) {
            last = t
            setPhase((p) => (p + 6) % 360)
          }
          raf = window.requestAnimationFrame(tick)
        }
        raf = window.requestAnimationFrame(tick)
        return () => window.cancelAnimationFrame(raf)
      }, [cfg.rgb])

      // 滚动：容器放不下才动；文字变了/速度变了就重算。
      React.useEffect(() => {
        if (!cfg.marquee) return undefined
        const wrap = wrapRef.current
        const inner = innerRef.current
        if (!wrap || !inner) return undefined
        const overflow = inner.scrollWidth - wrap.clientWidth
        if (overflow <= 4) return undefined
        const chars = Array.from(String(message)).length
        const duration = Math.max(4000, Math.round((chars / cfg.cps) * 1000))
        const anim = inner.animate(
          [{ transform: 'translateX(0)' }, { transform: `translateX(-${overflow}px)` }],
          { duration, iterations: Infinity, easing: 'linear' },
        )
        return () => anim.cancel()
      }, [cfg.marquee, cfg.cps, message])

      const text = Array.from(String(message))
      const body = cfg.rgb
        ? text.map((ch, i) =>
            h(
              'span',
              { key: i, style: { color: `hsl(${(phase + i * 26) % 360}, 92%, 62%)` } },
              ch === ' ' ? '\u00a0' : ch,
            ),
          )
        : message

      return h(
        'div',
        {
          ref: wrapRef,
          style: {
            marginTop: 6,
            overflow: 'hidden',
            fontSize: `${cfg.sizeEm}em`,
            lineHeight: 1.5,
            color: P.text,
          },
        },
        h('div', { ref: innerRef, style: { whiteSpace: 'nowrap', display: 'inline-block' } }, body),
      )
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 4.7：出错页 = 谢幕表式滚动警告（连错到上限后顶掉整个锁屏内容）
     *
     * 用户 0.1.4 的要求与拍板：
     *   - 输错到上限不要停在解锁界面上，而是切到一个单独的页面；
     *   - 页面做成电影片尾谢幕表那样：字幕从下往上一直滚；
     *   - 语言顺序：中文 → English (US) → English (UK) → Français → Русский → Español → العربية；
     *     每块都是「黄色警告三角 + 红底白字警告 + 一句带法条与处罚的警告词」；
     *   - 冷却一共 N 秒，走到 3/4 才出现「返回再试」；点了就回输入页并清零连错次数；
     *   - 冷却到点**不自动跳回**（用户 2026-10-25 明确要求："变相当屏保，让它一直滚"），
     *     字幕继续循环，只把底部倒计时换成「冷却已结束 · 按 Enter 返回」。
     * ══════════════════════════════════════════════════════════════════ */

    /**
     * 七段警告词：法条 + 处罚都写进句子里（用户 2026-10-25："法条往具体了写就好，
     * 不然太短唬不住人"）。改文案只需要动这个数组，界面会自己重新排。
     */
    const WARNING_BLOCKS = [
      {
        dir: 'ltr',
        warn: '警告',
        line:
          '未经系统管理员或有权授权者的明确授权，访问、控制或干扰本计算机信息系统，可能构成违法犯罪。依据《中华人民共和国刑法》第二百八十五条，非法侵入国家事务、国防建设、尖端科学技术领域的计算机信息系统，或未经授权、超越授权获取计算机信息系统数据、实施非法控制，情节严重的，处三年以下有期徒刑或者拘役，并处或者单处罚金；情节特别严重的，处三年以上七年以下有期徒刑，并处罚金。依据第二百八十六条第一款，对计算机信息系统功能或数据实施删除、修改、增加、干扰，后果严重的，处五年以下有期徒刑或者拘役；后果特别严重的，处五年以上有期徒刑。尚不构成犯罪的，依据《治安管理处罚法》可处行政拘留。系统访问日志已留存，越权行为将被依法追究。',
      },
      {
        dir: 'ltr',
        warn: 'WARNING',
        line:
          'Intentionally accessing this computer without authorisation, or exceeding the access that has been authorised, may violate 18 U.S.C. § 1030(a)(2). The statute criminalises access "without authorization" as well as conduct that "exceeds authorized access". A first offence is generally a misdemeanour carrying up to one year; where the offence is committed for commercial advantage or private financial gain, in furtherance of another criminal or tortious act, or where the value of the information obtained exceeds $5,000, the maximum rises to five years (18 U.S.C. § 1030(c)(2)(B)). Unauthorised access will be referred to law enforcement.',
      },
      {
        dir: 'ltr',
        warn: 'WARNING',
        line:
          'Access to this computer system without the authorisation of the system administrator is a criminal offence under section 1 of the Computer Misuse Act 1990. Section 1 requires only that the access be unauthorised and that the person knows it is unauthorised; the offence does not depend on the identity of the owner. On conviction on indictment the maximum penalty is two years\u2019 imprisonment, or a fine, or both (s. 1(3)). Access logs are retained and any unauthorised access will be reported.',
      },
      {
        dir: 'ltr',
        warn: 'AVERTISSEMENT',
        line:
          "L\u2019accès ou le maintien dans ce système de traitement automatisé de données sans l\u2019autorisation de l\u2019administrateur système est puni par l\u2019article 323-1 du Code pénal. Le texte vise le fait d\u2019accéder ou de se maintenir « frauduleusement » dans tout ou partie d\u2019un tel système : deux ans d\u2019emprisonnement et 60 000 € d\u2019amende. Si l\u2019accès entraîne la suppression ou la modification de données, ou une altération du fonctionnement du système, la peine est portée à trois ans d\u2019emprisonnement et 100 000 € d\u2019amende ; l\u2019entrave au fonctionnement du système est punie par l\u2019article 323-2 de cinq ans d\u2019emprisonnement et 150 000 € d\u2019amende. Les journaux d\u2019accès sont conservés.",
      },
      {
        dir: 'ltr',
        warn: 'ПРЕДУПРЕЖДЕНИЕ',
        line:
          'Неправомерный доступ к компьютерной информации, находящейся в данном информационном ресурсе, то есть доступ без разрешения администратора системы, образует состав преступления, предусмотренного статьёй 272 Уголовного кодекса Российской Федерации. Санкция части 1 предусматривает штраф до 200 000 рублей, исправительные работы, ограничение свободы либо лишение свободы на срок до двух лет; при квалифицирующих признаках срок достигает четырёх лет, а при тяжких последствиях — семи лет лишения свободы (часть 4). Все попытки доступа фиксируются.',
      },
      {
        dir: 'ltr',
        warn: 'ADVERTENCIA',
        line:
          'El acceso a este sistema informático sin la debida autorización del administrador, o mantenerse en él en contra de la voluntad de quien tiene el legítimo derecho a excluirlo, está castigado por el artículo 197 bis, apartado 1, del Código Penal con pena de prisión de seis meses a dos años. Si se causan daños a los datos o al funcionamiento del sistema, resulta aplicable además el artículo 264, castigado en su tipo básico con prisión de seis meses a tres años. Los registros de acceso se conservan y se pondrán a disposición de las autoridades competentes.',
      },
      {
        dir: 'rtl',
        warn: 'تحذير',
        line:
          'الدخول إلى هذا النظام المعلوماتي أو البقاء فيه بدون تصريح من المسؤول عن النظام يُعد جريمة وفقاً لأحكام نظام مكافحة الجرائم المعلوماتية في المملكة العربية السعودية الصادر بالمرسوم الملكي رقم م/17 وتاريخ 8/3/1428هـ. وتنص المادة الثالثة على معاقبة كل من دخل غير مشروع إلى نظام حاسوبي أو موقع إلكتروني، أو تجاوز حدود الدخول المشروع، بالسجن مدة لا تزيد على سنة وبغرامة لا تزيد على خمسمائة ألف ريال، أو بإحدى هاتين العقوبتين. وإذا اقترن الدخول بقصد إلغاء أو تغيير أو إتلاف أو نقل أو حذف أو إفشاء البيانات أو ترتب عليه ذلك، تُشدَّد العقوبة وفقاً للمادة الخامسة إلى السجن مدة لا تزيد على ثلاث سنوات وغرامة لا تزيد على مليوني ريال، أو بإحدى هاتين العقوبتين. وسيتم الاحتفاظ بسجلات الدخول وإبلاغ الجهات المختصة.',
      },
    ]

    /** 黄色警告三角：用 SVG 画，不用 emoji（emoji 在不少字体里会变成彩色方块） */
    function WarnTriangle(props) {
      const color = props.color
      const hole = '#1a1300'
      return h(
        'svg',
        { viewBox: '0 0 16 16', 'aria-hidden': 'true', style: { width: '1.7em', height: '1.7em', flex: '0 0 auto' } },
        h('path', { d: 'M8 1.5 15 14.3H1Z', fill: color }),
        h('rect', { x: 7.25, y: 5.4, width: 1.5, height: 4.6, rx: 0.4, fill: hole }),
        h('circle', { cx: 8, cy: 11.9, r: 0.95, fill: hole }),
      )
    }

    /** 一块警告：三角 + 红底白字 + 一句警告词（三种语言方向都按 dir 排） */
    function WarningBlock(props) {
      const { P, block } = props
      return h(
        'div',
        { dir: block.dir, style: { textAlign: 'center', padding: '1.6em 0 2.0em' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.7em' } },
          h(WarnTriangle, { color: P.warn }),
          h(
            'span',
            {
              style: {
                background: '#b3131b',
                color: '#ffffff',
                fontSize: '1.55em',
                fontWeight: 700,
                letterSpacing: '0.18em',
                padding: '0.10em 0.55em 0.16em',
              },
            },
            block.warn,
          ),
          h(WarnTriangle, { color: P.warn }),
        ),
        h(
          'div',
          {
            style: {
              marginTop: '0.75em',
              fontSize: '0.95em',
              lineHeight: 1.75,
              letterSpacing: '0.02em',
              color: P.text,
              // 两端对齐：左右两边都顶到边（中文按字撑开，西文按词撑开）
              textAlign: 'justify',
              textJustify: 'inter-character',
              // 最后一行贴"起始边"：中文/英文是左边，阿拉伯语（RTL）自动是右边
              textAlignLast: 'start',
              maxWidth: '58em',
              marginLeft: 'auto',
              marginRight: 'auto',
            },
          },
          block.line,
        ),
      )
    }

    function LockoutScreen(props) {
      const { P, startedAt, totalMs, onBack, preview } = props
      const [now, setNow] = React.useState(() => Date.now())
      const btnRef = React.useRef(null)
      const rollRef = React.useRef(null)
      const innerRef = React.useRef(null)

      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 250)
        return () => clearInterval(timer)
      }, [])

      // 字幕分两段跑：
      //   ① 入场：从画面底下升上来，只跑一次；
      //   ② 循环：升到位后位移**正好一个副本高度**（里面放了两份一模一样的内容），
      //      所以首帧和末帧长得完全一样 —— 接缝就在画面上看不出来，不会"跳回开头"。
      React.useEffect(() => {
        const roll = rollRef.current
        const inner = innerRef.current
        if (!roll || !inner) return undefined
        const copyH = inner.scrollHeight / 2
        const rollH = roll.clientHeight
        if (!copyH || !rollH) return undefined
        // 内容还没一屏长就不滚（否则会滚出一大段空白）
        if (copyH <= rollH + 8) return undefined
        const SPEED = 78 // 像素/秒：字大屏大时一轮自然长一点，但观感一致
        // 入场只从"稍微偏下"开始（最多 160px），第一帧就有字，不至于先空白好几秒
        const enterFrom = Math.min(rollH, 160)
        let loop = null
        const intro = inner.animate(
          [{ transform: `translateY(${enterFrom}px)` }, { transform: 'translateY(0px)' }],
          { duration: Math.max(400, (enterFrom / SPEED) * 1000), easing: 'linear', fill: 'forwards' },
        )
        intro.onfinish = () => {
          loop = inner.animate(
            [{ transform: 'translateY(0px)' }, { transform: `translateY(${-copyH}px)` }],
            { duration: (copyH / SPEED) * 1000, iterations: Infinity, easing: 'linear' },
          )
        }
        return () => {
          if (intro) intro.cancel()
          if (loop) loop.cancel()
        }
      }, [])

      const leftMs = Math.max(0, startedAt + totalMs - now)
      const leftSec = Math.ceil(leftMs / 1000)
      const totalSec = Math.max(1, Math.round(totalMs / 1000))
      const backAtMs = Math.round(totalMs * 0.75) // 走过 3/4 才允许返回
      // 预览模式（从锁屏上那个"隐形按钮"进来的）：不用等 3/4，随时能退。
      // 但画面文案跟真出错时一模一样——预览也是"唬人"的一部分，自己知道 Esc 能退就行。
      const canBack = preview || now - startedAt >= backAtMs || leftMs <= 0
      const cooledDown = leftMs <= 0

      // 注意：这里**故意不做**"冷却到点自动回输入页"——
      // 用户要求让字幕一直滚下去（变相当屏保），回不回去由用户按返回决定。

      // 按钮一出现就把光标交给它，Enter 直接可用（锁屏时鼠标是禁用的）
      React.useEffect(() => {
        if (canBack && btnRef.current) btnRef.current.focus()
      }, [canBack])

      React.useEffect(() => {
        const onKey = (event) => {
          if (preview) {
            // 预览里随时能退：Enter / 空格 / Esc 都算
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
              event.preventDefault()
              onBack()
            }
            return
          }
          if (!canBack) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onBack()
          }
        }
        // 晚一帧再挂：这一页是被 Enter 打开的话，同一个 keydown 还在冒泡，
        // 立刻挂监听会把它自己也一起关掉（打开又秒关）。
        let raf = 0
        if (typeof requestAnimationFrame === 'function') {
          raf = requestAnimationFrame(() => window.addEventListener('keydown', onKey))
        } else {
          window.addEventListener('keydown', onKey)
        }
        return () => {
          if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
          window.removeEventListener('keydown', onKey)
        }
      }, [canBack, onBack, preview])

      // 进度条：已经等了多久 / 一共多久
      const barChars = 40
      const doneChars = Math.round(((totalMs - leftMs) / totalMs) * barChars)
      const bar =
        '[' +
        '#'.repeat(Math.max(0, Math.min(barChars, doneChars))) +
        '-'.repeat(Math.max(0, barChars - doneChars)) +
        ']'

      const scrollContent = h(
        'div',
        null,
        // 两份一模一样的内容，动画位移一份的高度 → 首尾相接看不出接缝
        h(
          'div',
          { style: { padding: '0 4.2em' } },
          WARNING_BLOCKS.map((block, index) =>
            h(WarningBlock, { key: 'a' + index, P: P, block: block }),
          ),
        ),
        h(
          'div',
          { style: { padding: '0 4.2em' } },
          WARNING_BLOCKS.map((block, index) =>
            h(WarningBlock, { key: 'b' + index, P: P, block: block }),
          ),
        ),
      )

      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 12000,
            background: P.bg,
            color: P.text,
            fontFamily: MONO,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        },
        // 顶部那条状态栏，跟锁屏画面保持同一套视觉
        h(
          'div',
          {
            style: {
              flex: '0 0 auto',
              display: 'flex',
              alignItems: 'center',
              height: '3.1em',
              padding: '0 1.1em',
              borderBottom: `1px solid ${P.border}`,
              color: P.accent,
              fontSize: '0.78em',
              letterSpacing: '0.10em',
            },
          },
          h('span', { style: { flex: '0 0 150px' } }, ''),
          '[ LOCKSCREEN ]',
        ),
        // 中间：只有这块在滚
        h(
          'div',
          { ref: rollRef, style: { position: 'relative', flex: '1 1 auto', overflow: 'hidden' } },
          h('div', { ref: innerRef, style: { position: 'absolute', left: 0, right: 0, top: 0 } }, scrollContent),
        ),
        // 底部：倒计时 + 进度条 + 返回按钮，固定不动
        h(
          'div',
          {
            style: {
              flex: '0 0 auto',
              borderTop: `1px solid ${P.border}`,
              padding: '0.7em 1.2em 0.8em',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.35em',
            },
          },
          h(
            'div',
            { style: { color: P.clock, fontSize: '1.2em', letterSpacing: '0.18em' } },
            cooledDown
              ? '冷却已结束 · 按 Enter 返回'
              : `RESUME IN ${String(leftSec).padStart(2, '0')}s`,
          ),
          h('div', { style: { color: P.dim, fontSize: '0.72em', letterSpacing: '0.10em' } }, bar),
          canBack
            ? h(
                'button',
                {
                  ref: btnRef,
                  onClick: onBack,
                  style: {
                    background: 'transparent',
                    color: P.accent,
                    border: `1px solid ${P.accent}`,
                    fontFamily: MONO,
                    fontSize: '1em',
                    letterSpacing: '0.16em',
                    padding: '0.28em 1.1em',
                    cursor: 'pointer',
                  },
                },
                '[ 返回再试 ]',
              )
            : h('div', { style: { height: '1.55em' } }, ''),
        ),
      )
    }

    /**
     * 锁屏画面本体。
     *
     * 布局是"顶天立地"式的：上边缘一条状态条、下边缘一条状态条，
     * 中间整块空间放时钟和内容——像 ATM 屏幕那样占满整屏，而不是中间一个小窗。
     *
     * @param {object} props.palette     配色
     * @param {string} props.message     留言
     * @param {Function} props.onClose   预览模式下按 Esc 调它（真锁时不会传）
     * @param {boolean} props.preview    是不是预览模式（真锁时为 false）
     * @param {object|null} props.cred   已保存的口令记录（null = 还没设过）
     * @param {Function} props.onUnlocked  解锁成功时调它
     * @param {Function} props.onCredSaved 首次设好口令时调它
     */
    function LockScreen(props) {
      const {
        palette: P,
        message,
        onClose,
        preview,
        cred,
        onUnlocked,
        onCredSaved,
        showLockedFor,
        blockMouse,
        msgCfg,
      } = props

      // 出错页状态：null = 正常解锁界面；有值时 = 正在显示"输错太多次"那一页。
      // 记 { startedAt, totalMs }，冷却总长取用户设置（30/45/60 秒）。
      const [lockout, setLockout] = React.useState(null)

      // 「隐形按钮」：锁屏画面上一格看不见的键盘按钮。
      // Tab 回到它才亮起（TUI 那种反色光标），Enter 直接预览出错页——
      // 调样式时不用真的连错 3 次、不用等冷却。
      const [peekLockout, setPeekLockout] = React.useState(false)
      const [peekFocus, setPeekFocus] = React.useState(false)
      const peekStartRef = React.useRef(0)
      const openPeek = () => {
        peekStartRef.current = Date.now()
        setPeekLockout(true)
      }
      const backFromLockout = React.useCallback(() => {
        // 回到输入页时把"连错次数"清零，冷却继续走完剩下的 1/4（用户定的规则）
        resetFailCount()
        setLockout(null)
      }, [])

      // 锁屏开始的时刻：用来算"已锁定多久"（组件每次锁屏都是重新挂载，所以会自动归零）
      const lockedAtRef = React.useRef(Date.now())

      // 真锁屏 + 开了"禁用鼠标"时，鼠标就彻底不管用了：指针藏起来，
      // 点击 / 右键 / 滚轮 / 拖拽 / 选中 全都拦掉（键盘才是唯一通道）。
      // 注意：只在真锁屏时拦，开发用的"预览模式"照旧，免得自己调试都点不了。
      const mouseBlocked = !preview && blockMouse !== false

      React.useEffect(() => {
        if (!mouseBlocked) return undefined
        // 这些事件必须在"捕获阶段"拦，而且 wheel 要用 passive:false 才拦得住。
        const block = (event) => {
          event.preventDefault()
          event.stopPropagation()
        }
        const names = [
          'mousedown',
          'mouseup',
          'click',
          'dblclick',
          'auxclick',
          'contextmenu',
          'wheel',
          'dragstart',
          'selectstart',
        ]
        names.forEach((name) => window.addEventListener(name, block, { capture: true, passive: false }))
        return () => {
          names.forEach((name) => window.removeEventListener(name, block, { capture: true }))
        }
      }, [mouseBlocked])

      // 每秒重画一次，时钟才会走。
      const [now, setNow] = React.useState(() => new Date())
      React.useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000)
        return () => clearInterval(timer)
      }, [])

      /* ── 分钟一跳时的"扫描线刷新" ──────────────────────────────
       * 用户要的效果：时间变了，屏幕上像老显像管那样被一条亮线刷一遍，
       * 数字趁机换掉。做法是：
       * 1) 记住"上一分钟"；只有分钟真的变了才动画（刚打开时不动）；
       * 2) 用浏览器自带的 Web Animations（element.animate）让一条亮线
       *    从上往下扫过时钟区域；
       * 3) 同时让时钟本体亮度抖一下，像是重新点亮。
       * 用 element.animate 而不是 CSS 动画：插件里不方便注入 <style> 标签。
       */
      const clockBoxRef = React.useRef(null)
      const sweepRef = React.useRef(null)
      const minuteKey = `${now.getHours()}:${now.getMinutes()}`
      const lastMinuteRef = React.useRef(minuteKey)

      React.useEffect(() => {
        const changed = lastMinuteRef.current !== minuteKey
        lastMinuteRef.current = minuteKey
        if (!changed) return undefined

        const box = clockBoxRef.current
        const band = sweepRef.current
        const animations = []

        try {
          if (box && typeof box.animate === 'function') {
            animations.push(
              box.animate(
                [
                  { opacity: 1, filter: 'brightness(1)' },
                  { opacity: 0.55, filter: 'brightness(1.6)', offset: 0.25 },
                  { opacity: 1, filter: 'brightness(1)' },
                ],
                { duration: 420, easing: 'ease-out' },
              ),
            )
          }
          if (band && typeof band.animate === 'function') {
            const travel = box ? box.offsetHeight : 200
            animations.push(
              band.animate(
                [
                  { transform: 'translateY(0px)', opacity: 0 },
                  { transform: 'translateY(0px)', opacity: 1, offset: 0.15 },
                  { transform: `translateY(${travel}px)`, opacity: 1, offset: 0.85 },
                  { transform: `translateY(${travel}px)`, opacity: 0 },
                ],
                { duration: 620, easing: 'cubic-bezier(0.25, 0.6, 0.3, 1)' },
              ),
            )
          }
        } catch {
          /* 老浏览器不支持动画就算了，时钟照常走 */
        }

        return () => animations.forEach((a) => { try { a.cancel() } catch { /* 忽略 */ } })
      }, [minuteKey])

      // 真·全屏的试验结果（按 F 触发时用来显示"成没成"）。
      const [fullscreenNote, setFullscreenNote] = React.useState('')

      /**
       * 试着让整个网页进"真全屏"（连窗口标题栏和任务栏一起盖住）。
       *
       * 这是浏览器的标准能力（Fullscreen API），能不能成取决于 DSH 有没有允许；
       * 所以这里只做"试一试 + 如实报告"，不假设它一定行。
       */
      const toggleFullscreen = () => {
        try {
          if (document.fullscreenElement) {
            document.exitFullscreen()
            setFullscreenNote('已退出真全屏')
            return
          }
          const el = document.documentElement
          if (!el.requestFullscreen) {
            setFullscreenNote('这台机器/这个界面不支持真全屏')
            return
          }
          Promise.resolve(el.requestFullscreen())
            .then(() => setFullscreenNote('真全屏成功：连任务栏一起盖住了'))
            .catch((err) => setFullscreenNote('真全屏被拒绝：' + (err && err.message ? err.message : err)))
        } catch (err) {
          setFullscreenNote('真全屏出错：' + (err && err.message ? err.message : err))
        }
      }

      // 锁屏时的按键：F 试真全屏；Esc 只在预览模式下有效。
      //
      // 顺序很重要：
      // 1) 正在输入框里打字 → 全部放行（口令里可能就有 f）；
      // 2) 我们自己的几个快捷键 → 先处理掉；
      // 3) 剩下的按键：真锁屏时如果焦点不在我们浮层里（比如点了一下背景、
      //    焦点落到 body 或 DSH 那边），一律拦掉，免得在锁屏背后偷偷打字。
      React.useEffect(() => {
        const onKeyDown = (event) => {
          const target = event.target
          const tag = (target && target.tagName) || ''

          // 1) 输入框里的按键不抢
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

          // 只有"焦点在锁屏画面里"的时候才响应我们的快捷键。
          const inside = !!(rootRef.current && target && rootRef.current.contains(target))

          // 2) 自己的快捷键
          if (inside || preview) {
            if (event.key === 'Escape') {
              if (preview && typeof onClose === 'function') onClose()
              return
            }
            if (String(event.key).toLowerCase() === 'f') {
              event.preventDefault()
              toggleFullscreen()
              return
            }
          }

          // 3) 不在浮层里的按键一律拦掉（预览模式不拦）
          if (!preview && rootRef.current && target && !rootRef.current.contains(target)) {
            event.preventDefault()
            event.stopPropagation()
          }
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
      }, [preview, onClose])

      // 四角的小标记：让画面有"屏幕边缘"的感觉（纯装饰，不挡鼠标）。
      const cornerStyle = (vertical, horizontal) => ({
        position: 'absolute',
        [vertical]: 6,
        [horizontal]: 10,
        color: P.border,
        fontSize: 14,
        lineHeight: 1,
        pointerEvents: 'none',
        fontFamily: MONO,
      })

      // 整块锁屏的根节点：用来判断"这次按键是不是落在我们自己的输入框里"。
      const rootRef = React.useRef(null)

      return h(
        'div',
        {
          ref: rootRef,
          // 点画面空白处时把焦点收回口令框：这样点完照样能直接打字，
          // 也不会再往锁屏背后的 DSH 里漏键。
          tabIndex: -1,
          onMouseDown: (event) => {
            const tag = (event.target && event.target.tagName) || ''
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
            // 必须拦掉默认动作，否则浏览器会在我们 focus 之后又把焦点挪走
            event.preventDefault()
            const node = rootRef.current
            if (!node) return
            const input = node.querySelector('input')
            if (input && typeof input.focus === 'function') input.focus()
            else if (typeof node.focus === 'function') node.focus()
          },
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 2147483647, // 拉到最大：要压住 DSH 自己的浮层和挂件
            background: P.bg, // 完全不透明：这是"保护敏感内容"的底线
            color: P.text,
            fontFamily: MONO,
            fontSize: BODY_FS, // 除时钟外的所有字都用这个大小（2026-10-24 放大）
            lineHeight: 1.8,
            display: 'flex',
            flexDirection: 'column', // 上中下三段，撑满整屏
            userSelect: 'none',
            // 禁用鼠标时连指针都不显示：屏幕上看不到光标，无处可点
            cursor: mouseBlocked ? 'none' : 'default',
            overflow: 'hidden',
          },
          'data-lockscreen': preview ? 'preview' : 'locked',
        },

        // ① 扫描线（装饰层，不挡鼠标事件）
        h('div', {
          style: {
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            backgroundImage: `repeating-linear-gradient(0deg, ${P.scanline} 0px, ${P.scanline} 1px, transparent 1px, transparent 3px)`,
            opacity: 0.8,
          },
        }),

        // ② 四角标记（用 '+'，避免制表符在等宽字体里缺字被 fallback）
        h('div', { style: cornerStyle('top', 'left') }, '+'),
        h('div', { style: cornerStyle('top', 'right') }, '+'),
        h('div', { style: cornerStyle('bottom', 'left') }, '+'),
        h('div', { style: cornerStyle('bottom', 'right') }, '+'),

        // ③ 顶部状态条（贴着窗口上边缘）
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start', // 右上那行状态删掉之后就没有右侧内容了
              padding: '10px 20px',
              borderBottom: `1px solid ${P.border}`,
              background: P.bg,
              color: P.accent,
              fontSize: '0.78em',
              letterSpacing: '0.10em',
            },
          },
          /* 左边留出的空位：DSH 自己的菜单（应用/编辑）是浏览器外壳画上去的，
             它永远盖在网页上面、插件盖不掉，所以这里主动让开，别让文字打架。 */
          h('span', { style: { flex: '0 0 150px' } }, ''),
          h('span', null, '[ LOCKSCREEN ]'),
        ),

        // ④ 中间：时钟 + 日期 + 留言 + 解锁
        h(
          'div',
          {
            style: {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px 24px',
              overflow: 'hidden',
            },
          },

          // 时钟外面套一层：给"扫描线刷新"当画布（亮线在这一层里从上往下走）
          h(
            'div',
            {
              ref: clockBoxRef,
              style: { position: 'relative', padding: '10px 8px' },
            },
            h(ClockPolar, { now, P }),
            h('div', {
              ref: sweepRef,
              style: {
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                height: 2,
                opacity: 0,
                pointerEvents: 'none',
                background: `linear-gradient(90deg, transparent, ${P.clock}, transparent)`,
                boxShadow: `0 0 14px ${P.clock}`,
              },
            }),
          ),

          h(
            'div',
            {
              style: {
                marginTop: 18,
                color: P.dim,
                fontSize: '1em',
                letterSpacing: '0.22em',
              },
            },
            formatDate(now),
          ),

          // 「已锁定 03:12」——默认不显示，在设置页里打开才出现（第 5 步）
          showLockedFor
            ? h(
                'div',
                {
                  style: {
                    marginTop: 8,
                    color: P.dim,
                    fontSize: '0.86em',
                    letterSpacing: '0.16em',
                  },
                },
                `已锁定 ${formatElapsed(now.getTime() - lockedAtRef.current)}`,
              )
            : null,

          // 内容区（固定宽度，左对齐）
          h(
            'div',
            { style: { width: `min(${CONTENT_CH}ch, 92vw)`, marginTop: 30 } },

            h('div', { style: { color: P.border } }, rule()),

            h(
              'div',
              { style: { color: P.accent, marginTop: 12, fontSize: '0.9em', letterSpacing: '0.08em' } },
              sectionTitle('留言'),
            ),
            h(MessageLine, { P, message, cfg: msgCfg || loadMsgCfg() }),

            h('div', { style: { color: P.border, margin: '18px 0 0' } }, rule()),

            h(
              'div',
              { style: { color: P.accent, marginTop: 12, fontSize: '0.9em', letterSpacing: '0.08em' } },
              sectionTitle('解锁'),
            ),

            // 真正的解锁入口：还没设过口令就先让用户设一个，设好了才是输入框。
            // 出错页显示期间把输入面板整个卸掉，免得隐藏的输入框把键抢走。
            cred
              ? lockout
                ? h(
                    'div',
                    { style: { marginTop: 10, color: P.warn, letterSpacing: '0.08em' } },
                    '> 冷却中（等上面那一页放开）',
                  )
                : h(UnlockPanel, {
                    P,
                    cred,
                    onUnlocked,
                    onLockout: (ms) => setLockout({ startedAt: Date.now(), totalMs: ms }),
                  })
              : h(SetupPanel, { P, onCredSaved }),

            // 隐形按钮：平时 opacity 0 完全看不见；Tab 聚焦后变成一条反色高亮（TUI 光标）
            h(
              'button',
              {
                type: 'button',
                'aria-label': '预览出错页',
                onFocus: () => setPeekFocus(true),
                onBlur: () => setPeekFocus(false),
                onClick: openPeek,
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openPeek()
                  }
                },
                style: {
                  alignSelf: 'flex-start',
                  marginTop: '1.7em',
                  background: peekFocus ? P.accent : 'transparent',
                  color: peekFocus ? P.bg : P.border,
                  border: `1px solid ${peekFocus ? P.accent : 'transparent'}`,
                  fontFamily: MONO,
                  fontSize: '0.82em',
                  letterSpacing: '0.14em',
                  padding: '0.16em 0.7em',
                  cursor: 'default',
                  outline: 'none',
                  opacity: peekFocus ? 1 : 0,
                  transition: 'opacity 80ms linear',
                  whiteSpace: 'nowrap',
                },
              },
              '> 预览出错页  [Enter]',
            ),
          ),
        ),

        // ⑤ 真全屏的结果（按过 F 才出现这一行，平时不占地方）
        fullscreenNote
          ? h(
              'div',
              {
                style: {
                  padding: '6px 20px',
                  borderTop: `1px dashed ${P.border}`,
                  background: P.bg,
                  color: P.warn,
                  fontSize: 12,
                  letterSpacing: '0.03em',
                },
              },
              '真全屏 -> ' + fullscreenNote,
            )
          : null,

        // ⑥ 底部状态条已经删掉（2026-10-24 用户要求删掉版本号那一行）

        // ⑦ 出错页（连错到上限才出现，整页盖在最上面）
        lockout
          ? h(LockoutScreen, {
              P,
              startedAt: lockout.startedAt,
              totalMs: lockout.totalMs,
              onBack: backFromLockout,
            })
          : null,

        // ⑦之二 预览用的出错页（隐形按钮进来，Esc / Enter 随时退出，不动连错计数）
        peekLockout
          ? h(LockoutScreen, {
              P,
              startedAt: peekStartRef.current || Date.now(),
              totalMs: cooldownMs(),
              preview: true,
              onBack: () => {
                setPeekLockout(false)
                // 退回来之后把光标还给口令框，接着就能输（不用再按 Tab）
                if (typeof requestAnimationFrame === 'function') {
                  requestAnimationFrame(() => {
                    const node = rootRef.current
                    const input = node && node.querySelector('input')
                    if (input && typeof input.focus === 'function') input.focus()
                  })
                }
              },
            })
          : null,
      )
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 6：就绪提示（小浮条）
     * ══════════════════════════════════════════════════════════════════ */
    function ReadyToast(props) {
      const { palette: P } = props
      return h(
        'div',
        {
          style: {
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: 2147483646,
            pointerEvents: 'none',
            padding: '8px 12px',
            border: `1px solid ${P.border}`,
            borderRadius: 2,
            background: P.toastBg,
            color: P.dim,
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: '0.04em',
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
            opacity: 0.96,
          },
        },
        '[ lockscreen ] 锁屏插件已就绪 · 按 Ctrl+Shift+L 锁屏',
      )
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 7：总控（挂在 shell.overlay 上的那一层）
     * ══════════════════════════════════════════════════════════════════ */
    /** 试着让整个网页进真全屏（拿不到或被拒绝都静默失败，不影响锁屏）。 */
    function enterFullscreen() {
      try {
        const el = document.documentElement
        if (el && !document.fullscreenElement && typeof el.requestFullscreen === 'function') {
          Promise.resolve(el.requestFullscreen()).catch(() => {
            /* 有的环境不允许，那就普通窗口锁着 */
          })
        }
      } catch {
        /* 同上 */
      }
    }

    function leaveFullscreen() {
      try {
        if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
          Promise.resolve(document.exitFullscreen()).catch(() => {})
        }
      } catch {
        /* 同上 */
      }
    }

    /* ── 启动遮罩（0.1.1 新增）─────────────────────────────────────────
     * "打开应用就锁屏"开着的时候，我们的代码一执行（apply）就先往页面上盖
     * 一层纯 DOM 的黑幕，等 React 那边的锁屏画面挂好再撤掉。
     * 为什么不等 React：这样底下 DSH 的界面连一帧都闪不出来。
     * 这层没有任何交互，只是块色板，撤不掉也不影响功能。 */
    const BOOT_COVER_ID = 'lockscreen-boot-cover'

    function installBootCover() {
      try {
        if (!loadLockOnStart()) return
        if (!getCredential()) return // 还没设口令就不盖，免得把人关在门外
        if (document.getElementById(BOOT_COVER_ID)) return
        const palette = detectDark() ? PALETTES.dark : PALETTES.light
        const el = document.createElement('div')
        el.id = BOOT_COVER_ID
        el.setAttribute('data-lockscreen-cover', '1')
        el.style.cssText = [
          'position:fixed',
          'inset:0',
          'z-index:2147483647',
          `background:${palette.bg}`,
          'display:flex',
          'align-items:center',
          'justify-content:center',
          `color:${palette.dim}`,
          `font-family:${MONO}`,
          'font-size:13px',
          'letter-spacing:0.14em',
          'user-select:none',
        ].join(';')
        el.textContent = '[ LOCKSCREEN ] 正在进入锁屏…'
        document.body.appendChild(el)
      } catch {
        /* 盖不上就算了，React 那一层马上也会盖 */
      }
    }

    function removeBootCover() {
      try {
        const el = document.getElementById(BOOT_COVER_ID)
        if (el) el.remove()
      } catch {
        /* ignore */
      }
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 8.6：启动自检画面（0.1.2 改版：全英文 / 逐项 READY / 不可跳过）
     *
     * 分工：
     *   · 第一帧由后台半边（index.js）直接写进首页 HTML，浏览器解析到就画出来；
     *   · 界面这半边一挂上就把首帧接过来接着演（window.__lsBootElapsed 是首帧已经
     *     演了多少毫秒），这样进度条不会"回退"，中间也不会闪一下。
     *
     * 老实交代哪些是真的、哪些是演的（写在这里，免得以后自己也忘了）：
     *   · 真的：模块总数来自 DSH 自己注入的 window.__DSH_BOOT__（这台机器 89 条）；
     *   · 演的：那 5 条检查项没有真的检测，进度按时间走 —— 因为插件必然排在最后
     *     一个包里执行，等我们醒来时别人早就加载完了。
     *   · 用户明确要求：**不许跳过**（键鼠都不响应）、每个 DSH 会话只演一次。
     * ══════════════════════════════════════════════════════════════════ */

    /**
     * 自检动画总时长（毫秒）。用户要"像开机动画"，所以给到 5 秒。
     * 测试台可以用 window.__LS_BOOT_MS 覆盖（只为截图/慢放，真机不设就是 5000）。
     */
    const BOOT_ANIM_MS =
      typeof window !== 'undefined' && Number(window.__LS_BOOT_MS) > 0
        ? Number(window.__LS_BOOT_MS)
        : 5000

    /** 那几条"假装自检"的检查项（纯装饰，别当真）。 */
    const BOOT_SELF_CHECKS = [
      'charset grid',
      'clock module',
      'input channel',
      'passphrase digest',
      'display buffer',
    ]

    /**
     * 读 DSH 注入的启动图，拿"一共登记了多少个前端模块"。
     * 结构见 PLAN 6.13：{ rev, release, entries: [...], batches: [...] }，
     * 每条形如 { id, url, rev, inject, immediately }。容忍数组形态。
     */
    function readBootRoster() {
      try {
        const raw = window.__DSH_BOOT__
        if (!raw) return 0
        const rows = Array.isArray(raw) ? raw : Array.isArray(raw.entries) ? raw.entries : []
        let n = 0
        for (const row of rows) {
          const id = row && (row.id || row.name)
          if (typeof id === 'string' && id) n += 1
        }
        return n
      } catch {
        return 0
      }
    }

    /**
     * 启动自检画面：盖满窗口，播 5 秒，然后交给锁屏。
     *
     * 键盘鼠标一律不响应（用户要求：用来看的开机动画，不要"点一下就跳过"）。
     */
    function BootScreen({ palette, onDone }) {
      const P = palette
      const total = React.useMemo(() => readBootRoster(), [])
      const [elapsed, setElapsed] = React.useState(0)
      const [barChars, setBarChars] = React.useState(62)
      const boxRef = React.useRef(null)
      const doneRef = React.useRef(false)

      const finish = React.useCallback(() => {
        if (doneRef.current) return
        doneRef.current = true
        onDone()
      }, [onDone])

      // React 这一层一画出来就把 apply() 盖的纯色幕撤掉（同一块底色，看不出接缝），
      // 同时向"宿主机注入的首帧"打招呼要它退场（它会把"已经演了多少"留给我们）。
      React.useEffect(() => {
        removeBootCover()
        try {
          const handoff = window.__lsIndexSplash
          if (handoff && typeof handoff.done === 'function') handoff.done()
        } catch {
          /* ignore */
        }
      }, [])

      // 量"一行能放几个字符"：进度条要和上面状态列的右端对齐，只能靠真实字符宽度算。
      React.useEffect(() => {
        const measure = () => {
          const box = boxRef.current
          if (!box) return
          try {
            const probe = document.createElement('span')
            probe.style.cssText =
              'position:absolute;visibility:hidden;white-space:pre;pointer-events:none'
            probe.textContent = 'MMMMMMMMMM'
            box.appendChild(probe)
            const ch = probe.getBoundingClientRect().width / 10
            probe.remove()
            const boxW = box.getBoundingClientRect().width
            if (ch > 0 && boxW > 0) setBarChars(Math.max(20, Math.round(boxW / ch) - 2))
          } catch {
            /* 量不出来就用默认值 */
          }
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [])

      // 时间轴：用 requestAnimationFrame 跑。
      // 首帧那层可能已经演了一段（window.__lsBootElapsed），接上接着演，不从头来。
      React.useEffect(() => {
        let raf = 0
        const handed =
          typeof window !== 'undefined' && Number(window.__lsBootElapsed) > 0
            ? Math.min(Number(window.__lsBootElapsed), BOOT_ANIM_MS)
            : 0
        const started = performance.now() - handed
        const tick = () => {
          const now = performance.now() - started
          setElapsed(now)
          if (now >= BOOT_ANIM_MS) {
            finish()
            return
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
      }, [finish])

      const pct = Math.min(1, Math.max(0, elapsed / BOOT_ANIM_MS))
      const filled = Math.round(pct * barChars)
      const bar = '[' + '#'.repeat(filled) + '-'.repeat(Math.max(0, barChars - filled)) + ']'
      const readyCount = Math.min(
        BOOT_SELF_CHECKS.length,
        Math.floor(elapsed / (BOOT_ANIM_MS / (BOOT_SELF_CHECKS.length + 1))),
      )
      const loaded = total > 0 ? Math.round(pct * total) : 0
      const pctText = String(Math.round(pct * 100)).padStart(3, ' ') + '%'

      // 一条"检查项"：左边名字、中间点线、右边状态（READY / OFFLINE）。
      // 用 flex 分三栏而不是数点号 —— 中文字宽不是 1ch，数点号永远对不齐。
      const checkRow = (key, label, ok) =>
        h(
          'div',
          { key, style: { display: 'flex', alignItems: 'center', gap: '0.7em', lineHeight: 1.9 } },
          h('span', { style: { whiteSpace: 'pre' } }, '> ' + label),
          h('span', {
            style: {
              flex: 1,
              borderBottom: `1px dotted ${P.border}`,
              transform: 'translateY(2px)',
              minWidth: '2em',
            },
          }),
          h('span', { style: { color: ok ? P.accent : P.dim } }, ok ? 'READY' : 'OFFLINE'),
        )

      return h(
        'div',
        {
          'data-lockscreen': 'booting',
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 2147483647,
            background: P.bg,
            color: P.text,
            fontFamily: MONO,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'clamp(14px, 2.6vh, 52px)',
            lineHeight: 1.9,
            letterSpacing: '0.06em',
            userSelect: 'none',
            cursor: 'none',
          },
        },
        h(
          'div',
          { ref: boxRef, style: { width: 'min(64ch, 88vw)' } },
          h('div', { style: { color: P.accent } }, '[ LOCKSCREEN ] BOOT SELF-CHECK'),
          h(
            'div',
            { style: { color: P.border, whiteSpace: 'pre', overflow: 'hidden' } },
            '-'.repeat(barChars + 2),
          ),
          ...BOOT_SELF_CHECKS.map((name, i) => checkRow('check' + i, name, i < readyCount)),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', color: P.dim } },
            h('span', {}, total > 0 ? `modules loaded ${loaded}/${total}` : 'modules loaded …'),
            h('span', { style: { color: P.accent } }, pctText),
          ),
          h('div', { style: { color: P.clock, whiteSpace: 'pre', overflow: 'hidden' } }, bar),
          h(
            'div',
            { style: { color: P.dim, minHeight: '1.9em' } },
            pct >= 1 ? 'starting lock screen…' : '',
          ),
        ),
      )
    }


    /* ══════════════════════════════════════════════════════════════════
     * 小节 8.5（临时，2026-10-23）：启动加载探针
     *
     * 目的：回答"能不能做一个插件加载进度条"。只读、不上报、不改任何东西，
     * 只在页面里显示一张报告卡片，看完点关闭就再也不弹。
     *
     * 它收集四路证据：
     * 1) window.__DSH_BOOT__：DSH 自己注入的"启动图"，里面应该列着所有要加载的
     *    插件前端代码 —— 这是"总数"的来源；
     * 2) performance 资源时间线：每一个前端 bundle 被下载/执行的时间点 ——
     *    这是"每一条什么时候真的到了"的来源；
     * 3) window.__ModuleLoader__.load：我们挂一个钩子，记录在我们之后还有谁被加载
     *    （我们排最后一个，所以只能看到尾巴）；
     * 4) 我们的 apply() 拿到的 ctx 里有哪些服务（modules / clientModules / loader）。
     *
     * 试验完把这一节和 LockscreenRoot 里的 showProbe 一起删掉即可。
     * ══════════════════════════════════════════════════════════════════ */

    const BOOT_PROBE = false // 临时探针：试验结束已关（代码先留着，真要再查启动图就改成 true）
    const BOOT_PROBE_SEEN = 'lockscreen.bootProbeSeen'

    /** apply() 里记下来的 ctx 情况（探针报告要用）。 */
    let probeCtxInfo = null

    /** ctx 本体（probeModules 要拿它问 ClientModuleSystem 的进度）。 */
    let probeCtxRef = null

    /** 我们自己挂的 __ModuleLoader__.load 钩子记录（只有"我们之后"的加载）。 */
    const probeLateLoads = []
    let probeHooked = false
    let probeSelfTs = null

    /** 把 ctx 里能看的服务都问一遍，问不到就记下错误原因。 */
    function probeCtx(ctx) {
      probeCtxRef = ctx
      const info = { keys: [], proto: [], services: {} }
      try {
        info.keys = Object.keys(ctx || {})
      } catch (error) {
        info.keys = ['ERR ' + error.message]
      }
      try {
        info.proto = Object.getOwnPropertyNames(Object.getPrototypeOf(ctx) || {})
      } catch {
        info.proto = []
      }
      const names = ['slots', 'modules', 'clientModules', 'loader', 'root', 'registry', 'webPlugins']
      for (const name of names) {
        try {
          let value = null
          if (typeof ctx.get === 'function') value = ctx.get(name)
          else if (ctx[name] !== undefined) value = ctx[name]
          if (value === null || value === undefined) {
            info.services[name] = null
            continue
          }
          const shown = {
            type: typeof value,
            ctor: (value.constructor && value.constructor.name) || '',
            keys: [],
          }
          try {
            shown.keys = Object.keys(value).slice(0, 24)
          } catch {
            shown.keys = ['ERR']
          }
          // 有些服务把数据藏在 Map/Set 里，顺手数一下
          for (const field of ['entries', 'factories', 'modules', 'items', 'map', 'registry']) {
            try {
              const v = value[field]
              if (v && typeof v.size === 'number') shown[field + '.size'] = v.size
              else if (v && typeof v === 'object') shown[field + '.keys'] = Object.keys(v).length
            } catch {
              /* 读不到就算了 */
            }
          }
          info.services[name] = shown
        } catch (error) {
          info.services[name] = 'ERR ' + String(error && error.message)
        }
      }
      return info
    }

    /** 挂 __ModuleLoader__.load 钩子：记录我们自己之后还有谁被加载。 */
    function probeInstallHook() {
      if (probeHooked || typeof window === 'undefined') return
      probeHooked = true
      probeSelfTs = Math.round(performance.now())
      const loader = window.__ModuleLoader__
      if (!loader || typeof loader.load !== 'function') return
      const original = loader.load.bind(loader)
      loader.load = function patchedLoad(bundle) {
        try {
          probeLateLoads.push({
            id: (bundle && bundle.id) || '(no id)',
            t: Math.round(performance.now()),
          })
        } catch {
          /* 记录失败不影响加载 */
        }
        return original(bundle)
      }
    }

    /** 解析启动图：容忍是数组，或者 { rev, entries/plugins } 这种对象。 */
    function probeBootGraph() {
      const boot = typeof window === 'undefined' ? undefined : window.__DSH_BOOT__
      const out = {
        type: typeof boot,
        isArray: Array.isArray(boot),
        rev: null,
        keys: [],
        count: null,
        ids: [],
      }
      if (!boot || typeof boot !== 'object') return out
      try {
        out.keys = Object.keys(boot).slice(0, 12)
      } catch {
        /* ignore */
      }
      if (typeof boot.rev !== 'undefined') out.rev = boot.rev
      const list = Array.isArray(boot)
        ? boot
        : (Array.isArray(boot.entries) && boot.entries) ||
          (Array.isArray(boot.plugins) && boot.plugins) ||
          (Array.isArray(boot.modules) && boot.modules) ||
          null
      if (list) {
        out.count = list.length
        out.entryKeys =
          list.length && list[0] && typeof list[0] === 'object'
            ? Object.keys(list[0]).slice(0, 12)
            : []
        out.ids = list
          .map((row) => (row && (row.id || row.name || row.specifier || row.key)) || null)
          .filter(Boolean)
          .slice(0, 40)
        // 追加：给"能不能做进度条"判断用的紧凑明细
        try {
          out.firstEntryJson = JSON.stringify(list[0] || null).slice(0, 420)
          const batches = boot && boot.batches
          if (batches && typeof batches === 'object') {
            const bkeys = Object.keys(batches)
            const rows = Array.isArray(batches) ? batches : bkeys.map((k) => batches[k])
            out.batches = {
              type: Array.isArray(batches) ? 'array' : typeof batches,
              keys: bkeys.slice(0, 6),
              count: bkeys.length,
              firstJson: JSON.stringify(batches[bkeys[0]]).slice(0, 320),
              lengths: (Array.isArray(batches) ? batches : bkeys.map((k) => batches[k]))
                .slice(0, 12)
                .map((b) => (Array.isArray(b) ? b.length : typeof b)),
              // 每个批次的阶段名 + 条目数（这才是"进度条能不能分阶段"的关键）
              detail: rows.slice(0, 8).map((b) => ({
                phase: b && b.phase,
                url: b && b.url,
                rev: b && b.rev,
                items: Array.isArray(b && b.entries)
                  ? b.entries.length
                  : Array.isArray(b && b.items)
                    ? b.items.length
                    : null,
                first: Array.isArray(b && b.entries) ? b.entries.slice(0, 4) : null,
              })),
            }
          } else {
            out.batches = { type: typeof batches, count: null }
          }
          const ids = out.ids
          const clientIds = ids.filter((id) => /client|ui|web|browser|view/i.test(id))
          out.idScopes = {}
          ids.forEach((id) => {
            const m = String(id).match(/^(@[^/]+\/[^/]+|[^/@][^/]*)/)
            const key = m ? m[1] : '(other)'
            out.idScopes[key] = (out.idScopes[key] || 0) + 1
          })
          out.clientish = { count: clientIds.length, first: clientIds.slice(0, 12) }
        } catch {
          /* 明细失败不影响主报告 */
        }
      }
      return out
    }

    /**
     * 客户端模块系统的现状：这是"进度条"真正的心跳源。
     * ClientModuleSystem 里有 manifest（清单）、factories（已注册工厂）、
     * executedBundleUrls（已跑完的 bundle）、pendingArrival（在路上的）等字段。
     */
    function probeModules() {
      const out = { available: false }
      try {
        const ctx = probeCtxRef
        const mods = ctx && typeof ctx.get === 'function' ? ctx.get('modules') : null
        if (!mods) return out
        out.available = true
        const man = mods.manifest
        out.manifestKeys = man && typeof man === 'object' ? Object.keys(man).slice(0, 12) : []
        out.manifestCount = man && typeof man === 'object' ? Object.keys(man).length : null
        const ent = mods.entries
        out.entriesCount = ent && typeof ent === 'object' ? Object.keys(ent).length : null
        out.entriesKeys = ent && typeof ent === 'object' ? Object.keys(ent).slice(0, 15) : []
        out.factoriesSize =
          mods.factories && typeof mods.factories.size === 'number' ? mods.factories.size : null
        out.executed = Array.isArray(mods.executedBundleUrls) ? mods.executedBundleUrls.length : null
        out.failed = Array.isArray(mods.failedBundleUrls) ? mods.failedBundleUrls.length : null
        out.importErrors = Array.isArray(mods.importErrors) ? mods.importErrors.length : null
        out.pending =
          mods.pendingArrival && typeof mods.pendingArrival.size === 'number'
            ? mods.pendingArrival.size
            : null
        out.bootstrapIds = Array.isArray(mods.bootstrapIds) ? mods.bootstrapIds.slice(0, 8) : null
      } catch (error) {
        out.error = String(error && error.message)
      }
      return out
    }

    /** 资源时间线：哪些 bundle 什么时候到的（只挑看起来像插件前端的）。 */
    function probeResourceTimeline() {
      if (typeof performance === 'undefined' || !performance.getEntriesByType) return []
      try {
        return performance
          .getEntriesByType('resource')
          .filter((entry) => /client|bundle|plugin|modules/i.test(entry.name))
          .map((entry) => ({
            name: String(entry.name).split('/').filter(Boolean).slice(-2).join('/').slice(0, 80),
            start: Math.round(entry.startTime),
            dur: Math.round(entry.duration),
            bytes: entry.transferSize || 0,
          }))
          .slice(0, 60)
      } catch {
        return []
      }
    }

    /** 汇总成一份报告（JSON 友好，方便复制出来）。 */
    function probeCollect() {
      const report = {
        at: new Date().toISOString(),
        ua: typeof navigator === 'undefined' ? '' : String(navigator.userAgent).slice(0, 90),
        selfApplyAtMs: probeSelfTs,
        bootGraph: probeBootGraph(),
        loader: {
          type: typeof window.__ModuleLoader__,
          keys:
            typeof window.__ModuleLoader__ === 'object' && window.__ModuleLoader__
              ? Object.keys(window.__ModuleLoader__).slice(0, 12)
              : [],
          hooked: probeHooked,
          lateLoads: probeLateLoads.slice(0, 40),
        },
        ctx: probeCtxInfo,
        modules: probeModules(),
        resources: probeResourceTimeline(),
      }
      // 一句话摘要：给画面顶部用
      const boot = report.bootGraph
      const res = report.resources
      const summary = [
        `启动图：${boot.count === null ? '读不到' : boot.count + ' 条'}`,
        `资源：${res.length} 条（含 client/plugin 字样）`,
        `我们 apply 于 ${probeSelfTs === null ? '?' : probeSelfTs + ' ms'}`,
        `之后又加载：${probeLateLoads.length} 个`,
      ].join(' · ')
      return { report, summary }
    }

    /** 报告卡片：只读、一次性，关掉就记住不再弹。 */
    function BootProbePanel(props) {
      const { palette, onClose } = props
      const [data] = React.useState(() => probeCollect())
      const [copied, setCopied] = React.useState(false)
      const text = JSON.stringify(data.report, null, 1)

      // 临时：弹出来就自动复制一次，方便外面直接读剪贴板（正经版本不需要这段）
      React.useEffect(() => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
              () => setCopied(true),
              () => {},
            )
          }
        } catch {
          /* 剪贴板不可用就算了，还有"复制 JSON"按钮 */
        }
      }, [text])

      const copy = () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        } catch {
          setCopied(false)
        }
      }

      return h(
        'div',
        {
          'data-boot-probe': '1',
          style: {
            position: 'fixed',
            right: 16,
            bottom: 16,
            width: 620,
            maxWidth: '92vw',
            maxHeight: '82vh',
            display: 'flex',
            flexDirection: 'column',
            background: palette.toastBg,
            color: palette.text,
            border: `1px solid ${palette.border}`,
            borderRadius: 6,
            boxShadow: '0 10px 40px rgba(0,0,0,0.55)',
            fontFamily: MONO,
            fontSize: 12,
            zIndex: 2147483647,
            overflow: 'hidden',
          },
        },
        h(
          'div',
          {
            style: {
              padding: '10px 12px',
              borderBottom: `1px dashed ${palette.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            },
          },
          h('span', { style: { color: palette.accent } }, '[ 启动探针 ]'),
          h('span', { style: { flex: 1 } }),
          h(
            'button',
            { type: 'button', onClick: copy, style: probeButton(palette) },
            copied ? '已复制' : '复制 JSON',
          ),
          h('button', { type: 'button', onClick: onClose, style: probeButton(palette) }, '关闭'),
        ),
        h(
          'div',
          { style: { padding: '8px 12px', color: palette.accent, lineHeight: 1.6 } },
          data.summary,
        ),
        h(
          'pre',
          {
            style: {
              margin: 0,
              padding: '8px 12px 12px',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              lineHeight: 1.45,
              color: palette.text,
            },
          },
          text.slice(0, 12000),
        ),
      )
    }

    /** 探针面板上的小按钮样式（不跟 DSH 组件库耦合，自己画）。 */
    function probeButton(palette) {
      return {
        fontFamily: MONO,
        fontSize: 12,
        padding: '4px 10px',
        color: palette.text,
        background: 'transparent',
        border: `1px solid ${palette.border}`,
        borderRadius: 4,
        cursor: 'pointer',
      }
    }

    function LockscreenRoot() {
      const [dark, setDark] = React.useState(() => detectDark())
      // 打开应用就锁屏（默认开）：页面一加载就是"已锁"状态；没设过口令时不锁，
      // 否则谁也没法给它设口令（会被关在门外）。
      const [locked, setLocked] = React.useState(
        () => loadLockOnStart() && Boolean(getCredential()),
      )
      const [toastVisible, setToastVisible] = React.useState(true)
      const [cred, setCred] = React.useState(() => getCredential())
      const [message, setMessage] = React.useState(() => loadMessage())
      // 留言怎么显示（滚动 / 速度 / 字号 / RGB）——0.1.4 新增，打包成一个快照
      const [msgCfg, setMsgCfg] = React.useState(() => loadMsgCfg())
      const [showLockedFor, setShowLockedFor] = React.useState(() => loadShowLockedFor())
      const [blockMouse, setBlockMouse] = React.useState(() => loadBlockMouse())
      // 自动落锁的全部设置打成一个快照：设置页那边改完会发事件，这里整套换掉，
      // 免得给每个开关单开一个 state（也避免计时器读到半新半旧的值）。
      const [autoCfg, setAutoCfg] = React.useState(() => readAutoCfg())
      // 距离自动锁屏还剩几秒（0 = 没在提示）
      const [autoLeft, setAutoLeft] = React.useState(0)
      // 启动自检动画：只在"打开应用就锁屏"真的会锁的时候演；手动锁屏不演。
      // 首帧那层（index.js 注入的）会留个记号：这个会话已经演过了就别再演
      // （用户要求：开机只看一次，F5 不重播）。
      const [booting, setBooting] = React.useState(
        () =>
          loadLockOnStart() &&
          Boolean(getCredential()) &&
          (typeof window === 'undefined' || window.__lsBootPlayed !== false),
      )
      const finishBoot = React.useCallback(() => setBooting(false), [])
      // 启动探针（临时）：每次刷新都弹，方便反复试验（看完把这段删掉）
      const [showProbe, setShowProbe] = React.useState(() => BOOT_PROBE)

      const palette = dark ? PALETTES.dark : PALETTES.light

      // 设置页里改了留言 / 款式 / 口令，这里跟着刷新（同一次页面里不用重启）。
      React.useEffect(() => {
        const sync = () => {
          setMessage(loadMessage())
          setMsgCfg(loadMsgCfg())
          setCred(getCredential())
          setShowLockedFor(loadShowLockedFor())
          setBlockMouse(loadBlockMouse())
          setAutoCfg(readAutoCfg())
        }
        window.addEventListener(SETTINGS_EVENT, sync)
        return () => window.removeEventListener(SETTINGS_EVENT, sync)
      }, [])

      // 启动即锁：React 这边的锁屏挂上之后，把 apply() 时盖的那层黑幕撤掉。
      // 顺带把"宿主机注入的首帧"也撤掉（不锁屏的时候同样要撤，否则它会一直盖着）。
      React.useEffect(() => {
        if (locked) removeBootCover()
        try {
          const handoff = window.__lsIndexSplash
          if (handoff && typeof handoff.done === 'function') handoff.done()
        } catch {
          /* ignore */
        }
      }, [locked])

      // 深浅色跟随：DSH 切主题时跟着重画。
      React.useEffect(() => {
        const root = document.documentElement
        const observer = new MutationObserver(() => setDark(detectDark()))
        observer.observe(root, {
          attributes: true,
          attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'style'],
        })
        const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
        const onMedia = () => setDark(detectDark())
        if (media && media.addEventListener) media.addEventListener('change', onMedia)
        return () => {
          observer.disconnect()
          if (media && media.removeEventListener) media.removeEventListener('change', onMedia)
        }
      }, [])

      /**
       * 快捷键 Ctrl+Shift+L = 锁屏。
       *
       * 锁上之后这个快捷键不解锁（否则等于没锁），必须输对口令。
       * 刷新页面会解除锁屏 —— 这是"防偷看"级别的软锁，不是系统登录锁，
       * 这条限制写在 README 和 PLAN 里，别当成 bug。
       */
      React.useEffect(() => {
        const onKeyDown = (event) => {
          const isL = event.code === 'KeyL' || String(event.key).toLowerCase() === 'l'
          if (!(event.ctrlKey && event.shiftKey && isL && !event.altKey && !event.metaKey)) return
          event.preventDefault()
          event.stopPropagation()
          if (locked) return
          setLocked(true)
          enterFullscreen()
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
      }, [locked])

      // 就绪提示 8 秒后自动消失。
      React.useEffect(() => {
        const timer = setTimeout(() => setToastVisible(false), 8000)
        return () => clearTimeout(timer)
      }, [])

      /* ── 自动落锁（0.1.3）──
       *
       * 规则：
       *   1) 空闲锁：在 DSH 窗口里连续 idleMs 没有任何键鼠/滚轮/触摸 → 锁；
       *   2) 切走锁（可选）：DSH 窗口失去焦点超过 blurMs → 锁（0 = 立刻）；
       *   3) 锁前提示（可选）：最后 warnMs（默认空闲时长的 20%，最多 10 秒）在角落倒计时，
       *      期间动一下键鼠就取消，重新计时。
       *
       * 只在"已解锁 + 没在播自检动画 + 已经设过口令"时才跑：
       * 没口令就锁 = 把用户永久关在门外，不能干这种事。
       */
      React.useEffect(() => {
        if (locked || booting) return undefined
        if (!cred) return undefined
        if (!autoCfg.on && !autoCfg.blur) return undefined

        let lastActivity = Date.now()
        let blurAt = 0
        let warned = false

        const clearWarn = () => {
          if (!warned) return
          warned = false
          setAutoLeft(0)
        }

        const bump = () => {
          lastActivity = Date.now()
          clearWarn()
        }

        // 这些事件都算"人还在"；放在捕获阶段，免得被 DSH 自己的处理拦掉
        const ACTIVITY_EVENTS = ['keydown', 'mousedown', 'wheel', 'touchstart', 'pointerdown']
        ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, bump, true))

        const onBlur = () => {
          blurAt = Date.now()
        }
        const onFocus = () => {
          blurAt = 0
          bump()
        }
        window.addEventListener('blur', onBlur)
        window.addEventListener('focus', onFocus)

        const doLock = () => {
          clearWarn()
          setLocked(true)
          enterFullscreen()
        }

        const warnMs = autoLockWarnMs(autoCfg.idleMs)

        const timer = setInterval(() => {
          const now = Date.now()

          // 切走锁：不依赖窗口内有没有输入
          if (autoCfg.blur && blurAt) {
            const away = now - blurAt
            if (autoCfg.blurMs <= 0 || away >= autoCfg.blurMs) {
              doLock()
              return
            }
            if (autoCfg.on && autoCfg.warn) {
              // 两条规则都在跑时，提示优先显示"更早会发生的那条"
              const leftIdle = autoCfg.idleMs - (now - lastActivity)
              const leftBlur = autoCfg.blurMs - away
              const left = Math.min(leftIdle, leftBlur)
              warned = true
              setAutoLeft(Math.max(1, Math.ceil(left / 1000)))
              return
            }
          }

          if (!autoCfg.on) return

          const idle = now - lastActivity
          const left = autoCfg.idleMs - idle
          if (left <= 0) {
            doLock()
            return
          }
          if (autoCfg.warn && left <= warnMs) {
            warned = true
            setAutoLeft(Math.max(1, Math.ceil(left / 1000)))
          } else {
            clearWarn()
          }
        }, 250)

        return () => {
          clearInterval(timer)
          ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, bump, true))
          window.removeEventListener('blur', onBlur)
          window.removeEventListener('focus', onFocus)
          setAutoLeft(0)
        }
      }, [locked, booting, cred, autoCfg])

      // 解锁：撤掉遮罩 + 退出真全屏。
      const unlock = React.useCallback(() => {
        setLocked(false)
        leaveFullscreen()
      }, [])

      // 第一次设好口令后，立刻把凭据接上（此时仍停在锁屏，用户接着输一次就解锁）。
      const handleCredSaved = React.useCallback((next) => setCred(next), [])

      return h(
        React.Fragment,
        null,
        !locked && toastVisible ? h(ReadyToast, { palette }) : null,
        showProbe
          ? h(BootProbePanel, {
              palette,
              onClose: () => {
                writeRaw(BOOT_PROBE_SEEN, '1')
                setShowProbe(false)
              },
            })
          : null,
        // 自检画面在最前面：演完（或被跳过）才轮到锁屏出场
        booting && locked ? h(BootScreen, { palette, onDone: finishBoot }) : null,
        // 自动落锁的倒计时：只在快锁的那几秒出现，动一下键鼠就消失
        !locked && autoLeft > 0
          ? h(
              'div',
              {
                style: {
                  position: 'fixed',
                  left: 0,
                  right: 0,
                  bottom: 'clamp(14px, 2.2vh, 34px)',
                  display: 'flex',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  zIndex: 2147483646,
                  fontFamily: MONO,
                  fontSize: 'clamp(12px, 1.4vh, 18px)',
                  letterSpacing: '0.12em',
                },
              },
              h(
                'div',
                {
                  style: {
                    border: `1px solid ${palette.border}`,
                    background: palette.bg,
                    color: palette.accent,
                    padding: '0.45em 1em',
                  },
                },
                'AUTO-LOCK ' + String(autoLeft).padStart(2, '0') + 's · 动一下键鼠就取消',
              ),
            )
          : null,
        locked && !booting
          ? h(LockScreen, {
              palette,
              message,
              preview: false,
              cred,
              onUnlocked: unlock,
              onCredSaved: handleCredSaved,
              showLockedFor,
              blockMouse,
              msgCfg,
            })
          : null,
      )
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 7：DSH 设置页里的「锁屏」面板
     *
     * 为什么放在 DSH 的设置页、而不是锁屏画面上：
     * 锁屏的时候屏幕上多一个按钮，就等于给路过的人一次改口令的机会。
     * 所以所有"能改设置"的东西都放在"已经解锁、能进 DSH 设置"的地方；
     * 而且改口令还要再输一次现在的口令，防止你离开座位时被人顺手改掉。
     *
     * 这一节只动三样东西：口令、留言、时钟款式。全是浏览器本地存储，
     * 不联网、不写系统设置。
     * ══════════════════════════════════════════════════════════════════ */

    function LockscreenSettings() {
      const [dark, setDark] = React.useState(() => detectDark())
      const P = dark ? PALETTES.dark : PALETTES.light

      const [cred, setCred] = React.useState(() => getCredential())
      const [draft, setDraft] = React.useState(() => loadMessage())
      const [showLockedFor, setShowLockedFor] = React.useState(() => loadShowLockedFor())
      const [blockMouse, setBlockMouse] = React.useState(() => loadBlockMouse())
      const [lockOnStart, setLockOnStart] = React.useState(() => loadLockOnStart())
      // 自动落锁（0.1.3）
      const [autoLock, setAutoLock] = React.useState(() => loadAutoLock())
      const [idleMinutes, setIdleMinutes] = React.useState(() => loadIdleMinutes())
      const [blurLock, setBlurLock] = React.useState(() => loadBlurLock())
      const [blurSeconds, setBlurSeconds] = React.useState(() => loadBlurSeconds())
      const [autoWarn, setAutoWarn] = React.useState(() => loadAutoLockWarn())
      // 解锁与错误（0.1.4）
      const [maxFails, setMaxFails] = React.useState(() => loadMaxFails())
      const [cooldownSec, setCooldownSec] = React.useState(() => loadCooldownSec())
      // 留言的显示方式（0.1.4）
      const [msgMarquee, setMsgMarquee] = React.useState(() => loadMsgMarquee())
      const [msgRgb, setMsgRgb] = React.useState(() => loadMsgRgb())
      const [msgSpeedId, setMsgSpeedId] = React.useState(() => loadMsgSpeedId())
      const [msgSizeId, setMsgSizeId] = React.useState(() => loadMsgSizeId())

      // 口令区的流程：null（平时）→ 'verify'（先输旧口令）→ 'set'（设新口令）；'clear' = 清除确认
      const [mode, setMode] = React.useState(null)
      const [kind, setKind] = React.useState('pin')
      const [oldSecret, setOldSecret] = React.useState('')
      const [newSecret, setNewSecret] = React.useState('')
      const [newAgain, setNewAgain] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')

      // 深浅色跟随（和锁屏画面同一套判断）
      React.useEffect(() => {
        const root = document.documentElement
        const observer = new MutationObserver(() => setDark(detectDark()))
        observer.observe(root, {
          attributes: true,
          attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'style'],
        })
        const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
        const onMedia = () => setDark(detectDark())
        if (media && media.addEventListener) media.addEventListener('change', onMedia)
        return () => {
          observer.disconnect()
          if (media && media.removeEventListener) media.removeEventListener('change', onMedia)
        }
      }, [])

      // 别的窗口/锁屏画面改了东西，这里跟着刷新
      React.useEffect(() => {
        const sync = () => {
          setCred(getCredential())
          setDraft(loadMessage())
          setShowLockedFor(loadShowLockedFor())
          setBlockMouse(loadBlockMouse())
          setLockOnStart(loadLockOnStart())
          setAutoLock(loadAutoLock())
          setIdleMinutes(loadIdleMinutes())
          setBlurLock(loadBlurLock())
          setBlurSeconds(loadBlurSeconds())
          setAutoWarn(loadAutoLockWarn())
          setMaxFails(loadMaxFails())
          setCooldownSec(loadCooldownSec())
          setMsgMarquee(loadMsgMarquee())
          setMsgRgb(loadMsgRgb())
          setMsgSpeedId(loadMsgSpeedId())
          setMsgSizeId(loadMsgSizeId())
        }
        window.addEventListener(SETTINGS_EVENT, sync)
        return () => window.removeEventListener(SETTINGS_EVENT, sync)
      }, [])

      const resetForm = () => {
        setMode(null)
        setOldSecret('')
        setNewSecret('')
        setNewAgain('')
        setError('')
        setBusy(false)
      }

      const startChange = () => {
        setError('')
        setNotice('')
        setNewSecret('')
        setNewAgain('')
        setKind(cred && cred.kind === 'text' ? 'text' : 'pin')
        // 没设过口令就直接设；设过就先验一下现在的
        setMode(cred ? 'verify' : 'set')
      }

      const submitOld = async () => {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          const current = getCredential()
          if (!current) {
            setMode('set')
            return
          }
          const ok = await checkCredential(current, oldSecret)
          if (!ok) {
            setError('现在的口令不对，请重新输入')
            return
          }
          setOldSecret('')
          setMode('set')
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      const submitNew = async () => {
        if (busy) return
        const raw = kind === 'pin' ? String(newSecret).replace(/\D/g, '') : String(newSecret)
        if (kind === 'pin' && raw.length !== PIN_LEN) {
          setError(`数字 PIN 要正好 ${PIN_LEN} 位数字`)
          return
        }
        const textLength = Array.from(raw.trim()).length
        if (kind === 'text' && textLength < TEXT_MIN) {
          setError(`文字口令至少 ${TEXT_MIN} 位（现在 ${textLength} 位）`)
          return
        }
        if (kind === 'text' && textLength > TEXT_MAX) {
          setError(`文字口令最多 ${TEXT_MAX} 位（现在 ${textLength} 位）`)
          return
        }
        if (raw !== String(newAgain)) {
          setError('两次输入不一致，请再输一遍确认')
          return
        }
        setBusy(true)
        setError('')
        try {
          const next = await saveCredential(kind, raw)
          setCred(next)
          resetForm()
          setNotice('口令已更新。下次锁屏就用新口令。')
          notifySettingsChanged()
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      const doClear = () => {
        clearCredential()
        setCred(null)
        resetForm()
        setNotice('口令已清除。下次锁屏会重新让你设一个。')
        notifySettingsChanged()
      }

      const saveDraft = () => {
        const text = saveMessage(draft)
        setDraft(text)
        setNotice(text === DEFAULT_MESSAGE ? '留言已恢复成默认那句。' : '留言已保存。')
        notifySettingsChanged()
      }

      const resetDraft = () => {
        const text = saveMessage('')
        setDraft(text)
        setNotice('留言已恢复成默认那句。')
        notifySettingsChanged()
      }

      // ── 解锁与错误（0.1.4）：连错几次、冷却多久 ──
      const pickMaxFails = (n) => {
        saveMaxFails(n)
        setMaxFails(n)
        setNotice(`改成"连错 ${n} 次"就进冷却。`)
        notifySettingsChanged()
      }

      const pickCooldownSec = (sec) => {
        saveCooldownSec(sec)
        setCooldownSec(sec)
        setNotice(`冷却改成 ${sec} 秒（其中前 ${Math.round(sec * 0.75)} 秒停在出错页）。`)
        notifySettingsChanged()
      }

      // ── 留言的显示方式（0.1.4）：滚动 / 速度 / 字号 / RGB ──
      const toggleMsgMarquee = () => {
        const next = !msgMarquee
        saveMsgMarquee(next)
        setMsgMarquee(next)
        setNotice(next ? '留言比一行长时会从右往左慢慢滚。' : '留言不再滚动，老老实实待在一行里。')
        notifySettingsChanged()
      }

      const pickMsgSpeed = (id) => {
        saveMsgSpeedId(id)
        setMsgSpeedId(id)
        const speed = MSG_SPEEDS.find((s) => s.id === id)
        setNotice(`滚动速度改成「${speed ? speed.name : id}」（每秒 ${speed ? speed.cps : '?'} 个字）。`)
        notifySettingsChanged()
      }

      const pickMsgSize = (id) => {
        saveMsgSizeId(id)
        setMsgSizeId(id)
        const size = MSG_SIZES.find((s) => s.id === id)
        setNotice(`留言字号改成「${size ? size.name : id}」。`)
        notifySettingsChanged()
      }

      const toggleMsgRgb = () => {
        const next = !msgRgb
        saveMsgRgb(next)
        setMsgRgb(next)
        setNotice(next ? '留言变成逐字彩色的了（想关掉就再点一下）。' : '留言恢复成普通的单色。')
        notifySettingsChanged()
      }

      const toggleLockedFor = () => {        const next = !showLockedFor
        saveShowLockedFor(next)
        setShowLockedFor(next)
        setNotice(next ? '锁屏画面上会显示"已锁定 分:秒"。' : '已关掉锁屏画面上的时长显示。')
        notifySettingsChanged()
      }

      const toggleBlockMouse = () => {
        const next = !blockMouse
        saveBlockMouse(next)
        setBlockMouse(next)
        setNotice(
          next
            ? '锁屏时鼠标会完全不起作用（指针隐藏、点击无反应），只能用键盘。'
            : '锁屏时可以正常用鼠标了（点击口令框、选中文字都恢复正常）。',
        )
        notifySettingsChanged()
      }

      const toggleLockOnStart = () => {
        const next = !lockOnStart
        saveLockOnStart(next)
        setLockOnStart(next)
        setNotice(
          next
            ? '已经开了：下次打开（或刷新）DSH 会直接进锁屏，输对口令才能进去。'
            : '已经关了：打开 DSH 就是正常界面，想锁的时候按 Ctrl+Shift+L。',
        )
        notifySettingsChanged()
      }

      const toggleAutoLock = () => {
        if (!cred) {
          setNotice('还没设过口令，先在上面设一个——没有口令就自动锁，会把你关在门外。')
          return
        }
        const next = !autoLock
        saveAutoLock(next)
        setAutoLock(next)
        setNotice(
          next
            ? '已经开了：' + idleMinutes + ' 分钟没动就自动锁屏。'
            : '已经关了：不会再自动锁，想锁的时候按 Ctrl+Shift+L。',
        )
        notifySettingsChanged()
      }

      const pickIdleMinutes = (minutes) => {
        saveIdleMinutes(minutes)
        setIdleMinutes(minutes)
        setNotice('空闲 ' + minutes + ' 分钟就自动锁屏。')
        notifySettingsChanged()
      }

      const toggleBlurLock = () => {
        if (!blurLock && !cred) {
          setNotice('还没设过口令，先在上面设一个——没有口令就自动锁，会把你关在门外。')
          return
        }
        const next = !blurLock
        saveBlurLock(next)
        setBlurLock(next)
        setNotice(
          next
            ? blurSeconds > 0
              ? '已经开了：切到别的软件（DSH 失去焦点）超过 ' + blurSeconds + ' 秒就锁。'
              : '已经开了：一切到别的软件就立刻锁。'
            : '已经关了：切走不会锁，只按空闲时长判断。',
        )
        notifySettingsChanged()
      }

      const pickBlurSeconds = (seconds) => {
        saveBlurSeconds(seconds)
        setBlurSeconds(seconds)
        setNotice(seconds > 0 ? '切走后 ' + seconds + ' 秒锁屏。' : '一切走就立刻锁屏。')
        notifySettingsChanged()
      }

      const toggleAutoWarn = () => {
        const next = !autoWarn
        saveAutoLockWarn(next)
        setAutoWarn(next)
        setNotice(next ? '快锁之前在画面底部显示倒计时。' : '不再提前提示，时间到直接锁。')
        notifySettingsChanged()
      }

      /* ── 下面都是"怎么看"的样子，样式跟着 DSH 的深浅色走 ── */

      const H2 = (text) =>
        h(
          'div',
          {
            style: {
              fontFamily: MONO,
              fontSize: 12,
              letterSpacing: '0.08em',
              color: P.accent,
              margin: '18px 0 6px',
              paddingBottom: 4,
              borderBottom: `1px dashed ${P.border}`,
            },
          },
          text,
        )

      const hint = (text) => h('div', { style: { fontSize: 12, color: P.dim, lineHeight: 1.7 } }, text)

      const button = (text, onClick, primary) =>
        h(
          'button',
          {
            type: 'button',
            onClick,
            disabled: busy,
            style: {
              fontFamily: MONO,
              fontSize: 13,
              padding: '5px 12px',
              borderRadius: 4,
              cursor: busy ? 'default' : 'pointer',
              background: 'transparent',
              color: primary ? P.accent : P.text,
              border: `1px solid ${primary ? P.accent : P.border}`,
              opacity: busy ? 0.6 : 1,
            },
          },
          text,
        )

      // 一排"选一个"的小按钮（选中的填色），用于自动落锁的分钟/秒数
      const chip = (text, active, onClick) =>
        h(
          'button',
          {
            type: 'button',
            onClick,
            style: {
              fontFamily: MONO,
              fontSize: 13,
              padding: '4px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              background: active ? P.accent : 'transparent',
              color: active ? (dark ? '#0b0b10' : '#ffffff') : P.text,
              border: `1px solid ${active ? P.accent : P.border}`,
            },
          },
          text,
        )

      const input = (value, onChange, placeholder, opts) => {
        const options = opts || {}
        return h('input', {
          value,
          placeholder,
          type: options.password ? 'password' : 'text',
          inputMode: options.numeric ? 'numeric' : undefined,
          onChange: (event) => onChange(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && typeof options.onEnter === 'function') options.onEnter()
          },
          style: {
            fontFamily: MONO,
            fontSize: 13,
            padding: '5px 8px',
            borderRadius: 4,
            background: 'transparent',
            color: P.text,
            border: `1px solid ${P.border}`,
            width: options.width || 260,
            letterSpacing: options.password ? '0.12em' : undefined,
          },
        })
      }

      const line = (children, extra) =>
        h('div', { style: Object.assign({ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' }, extra || {}) }, children)

      const feedback = () =>
        h(
          React.Fragment,
          null,
          error ? h('div', { style: { color: P.warn, fontSize: 12, marginTop: 6 } }, error) : null,
          notice && !error ? h('div', { style: { color: P.accent, fontSize: 12, marginTop: 6 } }, notice) : null,
        )

      const credText = cred
        ? `已设 —— ${cred.kind === 'pin' ? `4 位数字 PIN` : '文字口令'}（${cred.at ? String(cred.at).slice(0, 10) : '日期不详'} 设的）`
        : '还没设过。第一次按 Ctrl+Shift+L 锁屏时会让你设一个。'

      const credArea = () => {
        if (mode === 'verify') {
          return h(
            'div',
            null,
            hint('先输一次现在的口令，确认是你本人在改。'),
            line([input(oldSecret, setOldSecret, '现在的口令', { password: true, width: 240, onEnter: submitOld })]),
            line([button('确认', submitOld, true), button('取消', resetForm)]),
            feedback(),
          )
        }
        if (mode === 'set') {
          const kindButton = (id, text) =>
            h(
              'button',
              {
                type: 'button',
                onClick: () => {
                  setKind(id)
                  setNewSecret('')
                  setNewAgain('')
                  setError('')
                },
                style: {
                  fontFamily: MONO,
                  fontSize: 13,
                  padding: '5px 12px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: kind === id ? P.accent : 'transparent',
                  color: kind === id ? (dark ? '#0b0b10' : '#ffffff') : P.text,
                  border: `1px solid ${kind === id ? P.accent : P.border}`,
                },
              },
              text,
            )
          const placeholder = kind === 'pin' ? `例如 0823（正好 ${PIN_LEN} 位数字）` : `至少 ${TEXT_MIN} 位，中文也行`
          return h(
            'div',
            null,
            line([kindButton('pin', '数字 PIN'), kindButton('text', '文字口令')]),
            line([input(newSecret, setNewSecret, placeholder, { password: true, numeric: kind === 'pin', width: 240 })]),
            line([input(newAgain, setNewAgain, '再输一遍确认', { password: true, width: 240, onEnter: submitNew })]),
            line([button('保存口令', submitNew, true), button('取消', resetForm)]),
            hint('口令只存"加盐摘要"，不存原文；忘了只能清掉重设（README 里有三步）。'),
            feedback(),
          )
        }
        if (mode === 'clear') {
          return h(
            'div',
            null,
            hint('清除之后，下次锁屏会让你重新设一个口令。确定吗？'),
            line([button('确定清除', doClear, true), button('取消', resetForm)]),
            feedback(),
          )
        }
        return h(
          'div',
          null,
          line([
            button(cred ? '修改口令' : '设置口令', startChange, true),
            cred
              ? button('清除口令', () => {
                  setError('')
                  setNotice('')
                  setMode('clear')
                })
              : null,
          ]),
          hint('改口令要先输一次现在的口令；这是为了防止你离开座位时被人顺手改掉。'),
          feedback(),
        )
      }

      return h(
        'div',
        { style: { fontFamily: MONO, color: P.text, padding: '4px 2px 24px', maxWidth: 720 } },

        // 标题
        h('div', { style: { fontSize: 14, letterSpacing: '0.10em', color: P.text } }, '[ 锁屏插件 ]'),
        h('div', { style: { fontSize: 12, color: P.dim, marginTop: 4 } },
          `v${VERSION} · 快捷键 Ctrl+Shift+L 锁屏，锁屏后输口令解锁`),

        // 口令
        H2('口令'),
        hint(`当前：${credText}`),
        credArea(),

        // 解锁与错误（0.1.4）：连错几次进冷却、冷却多久
        H2('解锁与错误'),
        hint('连错几次之后强制停一会儿。停的时候会切到一个单独的出错页，不让它一直停在输入框上。'),
        line([h('span', { style: { color: P.dim, fontSize: 12 } }, '连错几次就锁：')]),
        line(MAX_FAILS_CHOICES.map((n) => chip(`${n} 次`, maxFails === n, () => pickMaxFails(n)))),
        line([h('span', { style: { color: P.dim, fontSize: 12 } }, '锁多久：')]),
        line(COOLDOWN_SEC_CHOICES.map((sec) => chip(`${sec} 秒`, cooldownSec === sec, () => pickCooldownSec(sec)))),
        hint(
          `出错页占冷却的前 3/4（${Math.round(cooldownSec * 0.75)} 秒），走到那儿会出现「返回再试」；` +
            '点返回后连错次数清零，冷却继续走完最后那一小段。',
        ),

        // 留言
        H2('留言'),
        hint('锁屏画面上"留言"那一行显示的文字（只显示一行）。'),
        line([input(draft, setDraft, DEFAULT_MESSAGE, { width: 420, onEnter: saveDraft })]),
        line([button('保存留言', saveDraft, true), button('恢复默认', resetDraft)]),
        line([
          h(
            'button',
            {
              type: 'button',
              onClick: toggleMsgMarquee,
              style: {
                fontFamily: MONO,
                fontSize: 13,
                padding: '5px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                background: msgMarquee ? P.accent : 'transparent',
                color: msgMarquee ? (dark ? '#0b0b10' : '#ffffff') : P.text,
                border: `1px solid ${msgMarquee ? P.accent : P.border}`,
              },
            },
            msgMarquee ? '滚动字幕：已开启（点一下关掉）' : '滚动字幕：已关闭（点一下开启）',
          ),
        ]),
        hint('打开滚动之后，留言比一行长才会滚动；短留言还是一动不动（不然看着像在抖）。'),
        hint('滚动速度：'),
        line(MSG_SPEEDS.map((s) => chip(s.name, msgSpeedId === s.id, () => pickMsgSpeed(s.id)))),
        hint('留言字号：'),
        line(MSG_SIZES.map((s) => chip(s.name, msgSizeId === s.id, () => pickMsgSize(s.id)))),
        line([
          h(
            'button',
            {
              type: 'button',
              onClick: toggleMsgRgb,
              style: {
                fontFamily: MONO,
                fontSize: 13,
                padding: '5px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                background: msgRgb ? P.accent : 'transparent',
                color: msgRgb ? (dark ? '#0b0b10' : '#ffffff') : P.text,
                border: `1px solid ${msgRgb ? P.accent : P.border}`,
              },
            },
            msgRgb ? '逐字变色：已开启（点一下关掉）' : '逐字变色：已关闭（点一下开启）',
          ),
        ]),
        hint('逐字变色就是每个字颜色都不一样、还会慢慢转色。默认关——这跟整套终端风不太搭，想玩再开。'),

        // 时钟款式这一节已经整节删掉：2026-10-24 起只剩偏振片一款（用户拍板），
        // 没有可选的款式了，就不用再放三个按钮。

        // 已锁定时长（第 5 步；默认关）
        H2('已锁定时长'),
        hint('锁屏画面日期下面显示"已锁定 03:12"这样的一行，默认关闭。'),
        line([
          h(
            'button',
            {
              type: 'button',
              onClick: toggleLockedFor,
              style: {
                fontFamily: MONO,
                fontSize: 13,
                padding: '5px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                background: showLockedFor ? P.accent : 'transparent',
                color: showLockedFor ? (dark ? '#0b0b10' : '#ffffff') : P.text,
                border: `1px solid ${showLockedFor ? P.accent : P.border}`,
              },
            },
            showLockedFor ? '已开启（点一下关掉）' : '已关闭（点一下开启）',
          ),
        ]),

        // 锁屏时禁用鼠标（默认开；用户 2026-10-23 要求"像 ATM 那样"）
        H2('锁屏时禁用鼠标'),
        hint('打开后锁屏画面上看不到鼠标指针，点击 / 右键 / 滚轮 / 拖拽全都不起作用，只能用键盘。默认打开。'),
        line([
          h(
            'button',
            {
              type: 'button',
              onClick: toggleBlockMouse,
              style: {
                fontFamily: MONO,
                fontSize: 13,
                padding: '5px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                background: blockMouse ? P.accent : 'transparent',
                color: blockMouse ? (dark ? '#0b0b10' : '#ffffff') : P.text,
                border: `1px solid ${blockMouse ? P.accent : P.border}`,
              },
            },
            blockMouse ? '已开启（点一下关掉）' : '已关闭（点一下开启）',
          ),
        ]),

        // 打开应用就锁屏（0.1.1 新增；默认开）
        H2('打开应用就锁屏'),
        hint('打开后每次启动或刷新 DSH 都直接进锁屏，输对口令才能进；默认打开。还没设过口令时不会锁（不然进不去）。'),
        line([
          h(
            'button',
            {
              type: 'button',
              onClick: toggleLockOnStart,
              style: {
                fontFamily: MONO,
                fontSize: 13,
                padding: '5px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                background: lockOnStart ? P.accent : 'transparent',
                color: lockOnStart ? (dark ? '#0b0b10' : '#ffffff') : P.text,
                border: `1px solid ${lockOnStart ? P.accent : P.border}`,
              },
            },
            lockOnStart ? '已开启（点一下关掉）' : '已关闭（点一下开启）',
          ),
        ]),

        // 自动落锁（0.1.3 新增；默认关，三项都能自己调）
        H2('自动落锁'),
        hint(
          '打开后：在 DSH 里连续这么久没有键盘 / 鼠标 / 滚轮动作，就自动锁屏。' +
            '（只能看见 DSH 窗口里的操作，别的软件里怎么敲插件看不到。）',
        ),
        line([
          h(
            'button',
            {
              type: 'button',
              onClick: toggleAutoLock,
              style: {
                fontFamily: MONO,
                fontSize: 13,
                padding: '5px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                background: autoLock ? P.accent : 'transparent',
                color: autoLock ? (dark ? '#0b0b10' : '#ffffff') : P.text,
                border: `1px solid ${autoLock ? P.accent : P.border}`,
              },
            },
            autoLock ? '已开启（点一下关掉）' : '已关闭（点一下开启）',
          ),
        ]),
        hint('空闲多久算"该锁了"（分钟）：'),
        line(
          IDLE_CHOICES.map((minutes) =>
            chip(minutes + ' 分钟', idleMinutes === minutes, () => pickIdleMinutes(minutes)),
          ),
        ),
        hint(
          '切到别的软件（DSH 失去焦点）也要锁吗？默认关——切窗口频繁时开了会很烦；开了之后默认 30 秒才锁。',
        ),
        line([
          h(
            'button',
            {
              type: 'button',
              onClick: toggleBlurLock,
              style: {
                fontFamily: MONO,
                fontSize: 13,
                padding: '5px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                background: blurLock ? P.accent : 'transparent',
                color: blurLock ? (dark ? '#0b0b10' : '#ffffff') : P.text,
                border: `1px solid ${blurLock ? P.accent : P.border}`,
              },
            },
            blurLock ? '已开启（点一下关掉）' : '已关闭（点一下开启）',
          ),
        ]),
        hint('切走后多久锁：'),
        line(
          BLUR_CHOICES.map((seconds) =>
            chip(
              seconds > 0 ? seconds + ' 秒' : '立刻',
              blurSeconds === seconds,
              () => pickBlurSeconds(seconds),
            ),
          ),
        ),
        hint('快锁之前，在画面底部先倒计时几秒（动一下键鼠就取消）：'),
        line([
          h(
            'button',
            {
              type: 'button',
              onClick: toggleAutoWarn,
              style: {
                fontFamily: MONO,
                fontSize: 13,
                padding: '5px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                background: autoWarn ? P.accent : 'transparent',
                color: autoWarn ? (dark ? '#0b0b10' : '#ffffff') : P.text,
                border: `1px solid ${autoWarn ? P.accent : P.border}`,
              },
            },
            autoWarn ? '已开启（点一下关掉）' : '已关闭（点一下开启）',
          ),
        ]),

        // 说明
        H2('几个要知道的事'),
        hint('· 这是"防偷看"级别的软锁：盖住 DSH 窗口、拦住键盘和鼠标，Alt+Tab 切走或任务管理器强杀都绕得过去。'),
        hint('·「打开应用就锁屏」开着的时候，按 F5 刷新会重新锁上（刷新不再是绕过去的口子）。'),
        hint('· 真忘口令了：F12 打开控制台，执行 localStorage.removeItem(\'lockscreen.cred\') 再刷新，然后重新设一个。'),
        hint('· 锁屏时鼠标默认不起作用、光标在口令框里，直接输口令就行（只能从浮层里打字）。'),
      )
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 8.4：设置页左边那把小锁
     *
     * 为什么需要这个：DSH 的 settings.section 只投影 id / order / label，
     * **没有 icon 字段**；设置页左边每个第三方分区一律被画成同一个"齿轮"。
     * 装着的 dshmarket、dsh-better-sidebar 也是这么绕的：等设置对话框挂上之后，
     * 认出文字正好是本插件那一行，打个标记，再用一段 CSS 把齿轮换成自己的图标。
     *
     * 范围卡得很死：只碰"文字 == 锁屏"的那一行，别的一概不动；样式和标记都挂在
     * 一个 effect 里，插件卸载时一起撤掉；语言/文字变了会被 MutationObserver 重新认。
     * ══════════════════════════════════════════════════════════════════ */
    const NAV_MARKER = 'data-lockscreen-nav-icon'
    const NAV_ROW_SELECTOR = '[role="dialog"] nav button'
    const NAV_LABEL = '锁屏'

    /** 16×16 的小锁，画成纯黑：CSS mask 只读透明通道，颜色由 currentColor 给 */
    const NAV_GLYPH_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4.9 7.1V5.5a3.1 3.1 0 0 1 6.2 0V7.1"/>' +
      '<rect x="3" y="7" width="10" height="6.6" rx="2"/>' +
      '<circle cx="8" cy="10.3" r="1.1" fill="#000" stroke="none"/>' +
      '</svg>'

    function navMaskUrl() {
      return 'data:image/svg+xml,' + encodeURIComponent(NAV_GLYPH_SVG)
    }

    /** 盖掉 shell 的齿轮，改成我们的小锁（跟随导航文字颜色，hover/选中会自动变色） */
    function navIconCss(maskUrl) {
      return [
        `[${NAV_MARKER}] > svg { display: none !important; }`,
        `[${NAV_MARKER}]::before {`,
        `  content: '';`,
        `  flex: none;`,
        `  display: inline-block;`,
        `  width: 16px;`,
        `  height: 16px;`,
        `  background-color: currentColor;`,
        `  -webkit-mask-image: url("${maskUrl}");`,
        `  mask-image: url("${maskUrl}");`,
        `  -webkit-mask-repeat: no-repeat;`,
        `  mask-repeat: no-repeat;`,
        `  -webkit-mask-position: center;`,
        `  mask-position: center;`,
        `  -webkit-mask-size: 16px 16px;`,
        `  mask-size: 16px 16px;`,
        `}`,
      ].join('\n')
    }

    /**
     * 装上"小锁"图标。
     * 设置对话框是点开才渲染的，所以用 MutationObserver 盯着 body；
     * 每次变化后重新认一遍"哪一行是我们的"。
     */
    function installSettingsNavIcon(ctx) {
      if (typeof document === 'undefined') return
      const boot = () => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-plugin-lockscreen'
        tag.textContent = navIconCss(navMaskUrl())
        document.head.appendChild(tag)

        let disposed = false
        let scheduled = false

        const sync = () => {
          scheduled = false
          if (disposed) return
          const rows = document.querySelectorAll(NAV_ROW_SELECTOR)
          for (const row of rows) {
            const own = row.textContent.trim() === NAV_LABEL
            if (own) row.setAttribute(NAV_MARKER, '')
            else if (row.hasAttribute(NAV_MARKER)) row.removeAttribute(NAV_MARKER)
          }
        }
        const schedule = () => {
          if (scheduled || disposed) return
          scheduled = true
          queueMicrotask(sync)
        }

        sync()
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })

        return () => {
          disposed = true
          observer.disconnect()
          for (const row of document.querySelectorAll(`[${NAV_MARKER}]`)) row.removeAttribute(NAV_MARKER)
          tag.remove()
        }
      }
      if (typeof ctx.effect === 'function') ctx.effect(boot, 'lockscreen: 设置页图标')
      else boot()
    }

    /* ══════════════════════════════════════════════════════════════════
     * 小节 8：交给 DSH
     * ══════════════════════════════════════════════════════════════════ */
    function apply(ctx) {
      try {
        console.info('[lockscreen] 界面半边加载中（v%s）', VERSION)

        // 启动即锁：先盖一层纯 DOM 的黑幕，别让 DSH 界面先闪一下（首帧那层会同时撤掉）
        installBootCover()

        // 只剩一款时钟了：把老版本存在浏览器里的"时钟款式"记忆键清掉，免得留下 nixie/huge 的旧值
        forgetOldClockStyle()

        // 启动探针（临时）：尽早挂钩子、把 ctx 能看到的服务记下来
        if (BOOT_PROBE) {
          probeInstallHook()
          probeCtxInfo = probeCtx(ctx)
        }

        const slots = pickSlots(ctx)
        if (!slots) {
          console.warn('[lockscreen] 没有 slots 服务，无法挂浮层')
          return
        }

        // 锁屏本体：挂在"全屏最上层"这个插槽上，锁上时盖住整个 DSH 窗口。
        const occupy = () =>
          slots.inject('shell.overlay', () =>
            slots.register(
              {
                name: 'shell.overlay',
                id: OVERLAY_ID,
                order: 9000,
                label: () => '锁屏插件',
              },
              LockscreenRoot,
            ),
          )

        // 设置面板：挂在 DSH 设置页里，显示成一个叫「锁屏」的分区。
        // 注意：设置页是在"已经解锁"的状态下才进得去，锁屏时看不到它。
        const settings = () =>
          slots.inject('settings.section', () =>
            slots.register(
              {
                name: 'settings.section',
                id: 'lockscreen',
                order: 60,
                label: '锁屏',
              },
              LockscreenSettings,
            ),
          )

        const tasks = [
          [occupy, 'lockscreen: 锁屏浮层'],
          [settings, 'lockscreen: 设置分区'],
        ]

        for (const [fn, label] of tasks) {
          try {
            if (typeof ctx.effect === 'function') ctx.effect(fn, label)
            else fn()
          } catch (error) {
            console.error('[lockscreen] 挂 %s 失败：', label, error)
          }
        }

        console.info('[lockscreen] 已登记：shell.overlay + settings.section（id=%s）', OVERLAY_ID)

        // 设置页左边那一行的"齿轮"换成小锁（不影响其它分区）
        installSettingsNavIcon(ctx)
      } catch (error) {
        console.error('[lockscreen] 挂浮层失败：', error)
      }
    }

    /**
     * 拿到插槽服务。
     * 不同版本的内核给的入口不一样：有的直接 ctx.slots，有的要 ctx.get('slots')
     * （装着的 dsh-meme 就是用 ctx.get('slots')），两种都试一下。
     */
    function pickSlots(ctx) {
      if (!ctx) return null
      const direct = ctx.slots
      if (direct && typeof direct.inject === 'function' && typeof direct.register === 'function') return direct
      if (typeof ctx.get === 'function') {
        try {
          const viaGet = ctx.get('slots')
          if (viaGet && typeof viaGet.inject === 'function' && typeof viaGet.register === 'function') return viaGet
        } catch {
          /* ctx.get 可能不认识 'slots'，忽略 */
        }
      }
      return null
    }

    exports.inject = ['slots']
    exports.apply = apply

    return module.exports
  },
})
