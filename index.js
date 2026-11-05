/**
 * 锁屏插件 · 「后台」那一半（Host）。
 *
 * 插件分两半：
 *   - 这半边跑在 DSH 的主体进程里（node），负责后台的事；
 *   - 另半边 client.js 跑在界面里（浏览器），负责画画面 —— 锁屏本身在那边。
 *
 * 这半边只干一件事：**往 DSH 返回的首页 HTML 里塞一段"开机自检画面"**。
 *
 * 为什么非要在这一半做：界面那半边要等"插件模块加载完"才能跑，那时候 DSH 自己的
 * 骨架屏/加载卡片已经露过脸了。想让"打开应用第一眼就是动画"，只能在 HTML 还没到浏览器
 * 手里之前就把它写进去 —— 这正是 DSH 给插件留的 `webServer.tapIndex()` 口子
 * （另一个同类插件 dsh-550c-boot 的 README 也写着"首帧由宿主半边注入，Loading 卡片不露脸"）。
 *
 * 塞进去的那段是纯 HTML + 内联 <style>/<script>：不依赖 React、不依赖任何模块，
 * 浏览器解析到就立刻画出来。它会自己演 5 秒，然后交给界面那半边接着演/结束
 * （约定见下面的 window.__lsIndexSplash 与 window.__lsBootElapsed）。
 *
 * 这一版画面按用户 2026-10-24 的批注改过：
 *   · 全英文；每项随进度条依次从 OFFLINE 变 READY；
 *   · `modules loaded N/89`，不写"倒序"；
 *   · 进度条右端与上面状态列的右端对齐（靠数清楚字符宽度做到）；
 *   · **不提供跳过**：键盘鼠标都不响应，5 秒放完才进锁屏；
 *   · 同一个 DSH 会话只演一次（sessionStorage 记一笔，F5 不重播）。
 *
 * 拿不到 webServer（例如某些 Electron 走 file:// 的部署）时这段静默跳过，
 * 界面那半边 apply() 时盖的纯色幕仍然会挡住内容，不会漏。
 */

/** 插件名。必须和 package.json 里的 name 完全一样，否则 DSH 找不到它。 */
export const name = 'dsh-plugin-lockscreen'

/** 自检画面在 DOM 里的 id（client.js 那边不直接用它，用 window.__lsIndexSplash 更稳）。 */
const SPLASH_ID = 'lockscreen-boot-splash'

/** 自检动画时长（毫秒）。改这里要和 client.js 的 BOOT_ANIM_MS 保持一致。 */
const SPLASH_MS = 5000

/** 同一个会话里"已经演过一次"的记号（sessionStorage 只在当前窗口生命周期内有效）。 */
const PLAYED_KEY = 'lockscreen.bootPlayed'

/**
 * 生成要插进 index.html 的那段标记。
 *
 * 注意：这段字符串会被原样塞进 HTML，所以里面不能有裸的 `</script>`；
 * 我们只用一个外链都没有的内联脚本，断网也能演。
 */
function buildSplashMarkup() {
  // 内联脚本里所有 `</` 都换成 `<\/`，防止提前终止 <script>。
  const script = String.raw`
(function () {
  var ID = '${SPLASH_ID}'
  var MS = ${SPLASH_MS}
  var PLAYED_KEY = '${PLAYED_KEY}'
  var root = document.getElementById(ID)
  if (!root) return

  function drop() {
    if (root && root.parentNode) root.parentNode.removeChild(root)
  }

  // 同一会话已经演过：立刻撤掉，并告诉界面那半边"别再演"。
  try {
    if (sessionStorage.getItem(PLAYED_KEY) === '1') {
      window.__lsBootPlayed = false
      window.__lsBootElapsed = MS
      drop()
      return
    }
  } catch (e) {
    /* 读不到 sessionStorage 就照演 */
  }

  // 关掉了"打开应用就锁屏" / 没设过口令 —— 都不演，直接撤掉。
  function skippedBySettings() {
    try {
      if (localStorage.getItem('lockscreen.lockOnStart') === '0') return true
      if (!localStorage.getItem('lockscreen.cred')) return true
    } catch (e) {
      /* localStorage 读不到就照演 */
    }
    return false
  }

  if (skippedBySettings()) {
    window.__lsBootPlayed = false
    window.__lsBootElapsed = MS
    drop()
    return
  }

  window.__lsBootPlayed = true
  try {
    sessionStorage.setItem(PLAYED_KEY, '1')
  } catch (e) {
    /* ignore */
  }

  var box = root.querySelector('.ls-box')
  var ruleEl = root.querySelector('.ls-rule')
  var checksEl = root.querySelector('.ls-checks')
  var metaEl = root.querySelector('.ls-meta')
  var barEl = root.querySelector('.ls-bar')
  var pctEl = root.querySelector('.ls-pct')
  var footEl = root.querySelector('.ls-foot')

  var CHECKS = ['charset grid', 'clock module', 'input channel', 'passphrase digest', 'display buffer']
  var STEP = MS / (CHECKS.length + 1) // 每过这么长时间，就有一项变 READY
  var BAR = 62 // 进度条里的字符数，量出来会覆盖它
  var started = performance.now()
  var raf = 0
  var finished = false
  var total = 0

  // 模块总数：DSH 注入的启动图（在 <head> 里，比我们早）
  try {
    var graph = globalThis.__DSH_BOOT__
    var rows = graph && (Array.isArray(graph.entries) ? graph.entries : null)
    if (rows) total = rows.length
  } catch (e) {
    total = 0
  }

  /**
   * 量出"一行能放多少个字符"。
   *
   * 用户要求进度条右端和上面状态列的右端对齐。状态列是 flex 顶到容器右边缘的，
   * 所以进度条只有在"正好占满一行字符"时才对齐 —— 字符宽度不是整数像素，
   * 只能真量一次：拿 10 个 M 的宽度除以 10，再用容器宽度去除。
   */
  function measureBar() {
    try {
      var probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;pointer-events:none'
      probe.textContent = 'MMMMMMMMMM'
      box.appendChild(probe)
      var ch = probe.getBoundingClientRect().width / 10
      probe.parentNode.removeChild(probe)
      var boxW = box.getBoundingClientRect().width
      if (ch > 0 && boxW > 0) BAR = Math.max(20, Math.round(boxW / ch) - 2)
      // 上面那条横线也照进度条的字符数来，三行（标题线 / 状态列 / 进度条）右端才齐
      if (ruleEl) ruleEl.textContent = '-'.repeat(BAR + 2)
    } catch (e) {
      /* 量不出来就用默认 62 */
    }
  }

  function rowMarkup(label, ok) {
    return (
      '<div class="ls-row"><span class="ls-name">&gt; ' +
      label +
      '</span><span class="ls-dots"></span><span class="ls-' +
      (ok ? 'ok' : 'wait') +
      '">' +
      (ok ? 'READY' : 'OFFLINE') +
      '</span></div>'
    )
  }

  function paint(elapsed) {
    var pct = Math.min(1, elapsed / MS)
    var ready = Math.min(CHECKS.length, Math.floor(elapsed / STEP))

    var html = ''
    for (var i = 0; i < CHECKS.length; i += 1) html += rowMarkup(CHECKS[i], i < ready)
    checksEl.innerHTML = html

    var loaded = total > 0 ? Math.round(pct * total) : 0
    metaEl.innerHTML =
      '<span>modules loaded ' +
      (total > 0 ? loaded + '/' + total : '…') +
      '</span><span class="ls-pct">' +
      String(Math.round(pct * 100)).padStart(3, ' ') +
      '%</span>'

    var filled = Math.round(pct * BAR)
    barEl.textContent = '[' + '#'.repeat(filled) + '-'.repeat(BAR - filled) + ']'
    if (footEl) footEl.textContent = pct >= 1 ? 'starting lock screen…' : ''
  }

  function handoff() {
    if (finished) return
    finished = true
    if (raf) cancelAnimationFrame(raf)
    var elapsed = performance.now() - started
    try {
      window.__lsBootElapsed = Math.min(elapsed, MS)
    } catch (e) {
      /* ignore */
    }
    try {
      root.style.opacity = '0'
      setTimeout(drop, 280)
    } catch (e) {
      drop()
    }
  }

  // 给界面那半边调用的"退场"入口
  window.__lsIndexSplash = { done: function () { handoff() } }

  function tick() {
    var elapsed = performance.now() - started
    paint(elapsed)
    if (elapsed >= MS) {
      handoff()
      return
    }
    raf = requestAnimationFrame(tick)
  }

  // 万一界面那半边一直没起来（插件没装上/崩了），到点自己撤，别挡住用户。
  // 这**不是**给用户的跳过键，只是出错兜底（用户明确要求不许跳过）。
  setTimeout(handoff, MS + 6000)

  window.addEventListener('resize', function () {
    measureBar()
    paint(performance.now() - started)
  })

  measureBar()
  paint(0)
  raf = requestAnimationFrame(tick)
})()
`.replace(/<\/script/gi, '<\\/script')

  const style = `
#${SPLASH_ID}{position:fixed;inset:0;z-index:2147483647;background:#06060a;color:#d8d8d0;
  font-family:ui-monospace,Consolas,"Courier New",monospace;
  font-size:clamp(14px,2.6vh,52px);line-height:1.9;letter-spacing:.06em;
  display:flex;align-items:center;justify-content:center;user-select:none;cursor:none;
  opacity:1;transition:opacity .28s ease}
#${SPLASH_ID} .ls-box{width:min(64ch,88vw)}
#${SPLASH_ID} .ls-title{color:#b6f0d2}
#${SPLASH_ID} .ls-rule{color:#2b2b37;white-space:pre;overflow:hidden}
#${SPLASH_ID} .ls-row{display:flex;align-items:center;gap:.7em;line-height:1.9}
#${SPLASH_ID} .ls-name{white-space:pre}
#${SPLASH_ID} .ls-dots{flex:1;min-width:2em;border-bottom:1px dotted #2b2b37;transform:translateY(2px)}
#${SPLASH_ID} .ls-ok{color:#b6f0d2}
#${SPLASH_ID} .ls-wait{color:#6b6b60}
#${SPLASH_ID} .ls-meta{display:flex;justify-content:space-between;color:#6b6b60}
#${SPLASH_ID} .ls-meta .ls-pct{color:#b6f0d2}
#${SPLASH_ID} .ls-bar{color:#b6f0d2;white-space:pre;overflow:hidden}
#${SPLASH_ID} .ls-foot{color:#6b6b60;min-height:1.9em}
@media (prefers-color-scheme: light){
  #${SPLASH_ID}{background:#f5f5f0;color:#1b1b21}
  #${SPLASH_ID} .ls-title,#${SPLASH_ID} .ls-ok,#${SPLASH_ID} .ls-bar,#${SPLASH_ID} .ls-meta .ls-pct{color:#14211c}
  #${SPLASH_ID} .ls-rule,#${SPLASH_ID} .ls-dots{border-color:#c8c8bf;color:#c8c8bf}
  #${SPLASH_ID} .ls-wait,#${SPLASH_ID} .ls-meta,#${SPLASH_ID} .ls-foot{color:#6b6b60}
}`

  const rule = '-'.repeat(58)

  return `<style>${style}</style><div id="${SPLASH_ID}"><div class="ls-box"><div class="ls-title">[ LOCKSCREEN ] BOOT SELF-CHECK</div><div class="ls-rule">${rule}</div><div class="ls-checks"></div><div class="ls-meta"><span>modules loaded …</span><span class="ls-pct">  0%</span></div><div class="ls-bar">[${'-'.repeat(62)}]</div><div class="ls-foot"></div></div></div><script>${script}</script>`
}

/**
 * 把自检画面插进一份 index.html（纯函数，方便单测）。
 *
 * **插在 `</body>` 的前面**（不是 `<body>` 后面），这一点很关键：
 *
 * 浏览器里两个 `position: fixed`、`z-index` 一样大的元素，谁在 DOM 里靠后谁在上面。
 * DSH 自己的"加载卡片（圆圈）"就是 `fixed` + 最大 z-index，而且它排在 `#root` 里、
 * 也就是排在"`<body>` 后面"这个位置的**后面** —— 早先插在 `<body>` 后面时，
 * 第一帧会被 DSH 的圆圈盖住（实测：`_lab/z1.png` 被盖、`_lab/z2.png` 盖住它）。
 * 改插到 `</body>` 前之后，我们在 DOM 里排在最后，同样的 z-index 下就由我们盖住它。
 *
 * 另：`<head>` 里的 `__DSH_BOOT__` 这时已经就位，脚本照样能读到。
 *
 * @param {string} html 原始 index.html 文本
 * @returns {string} 插好自检画面的 html
 */
export function buildIndexSplash(html) {
  if (typeof html !== 'string' || !html) return html
  // 只插一次（同一份 html 被重复过一遍也不会插两段）
  if (html.includes(`id="${SPLASH_ID}"`)) return html
  const markup = buildSplashMarkup()

  // 首选：插在 </body> 之前（DOM 里排最后，压过 DSH 自己的加载卡片）
  const close = html.toLowerCase().lastIndexOf('</body>')
  if (close >= 0) return html.slice(0, close) + markup + html.slice(close)

  // 退路：有些模板没有 </body>，那就插在 <body ...> 后面
  const open = /<body(?:\s[^>]*)?>/i.exec(html)
  if (open !== null) {
    const at = open.index + open[0].length
    return html.slice(0, at) + markup + html.slice(at)
  }

  // 再退一步：连 body 都没有，接在最后
  return html + markup
}

/**
 * DSH 加载插件时会调这个函数。ctx 是 DSH 给的"遥控器"，config 来自 cordis.patch.yml。
 *
 * @param {object} ctx
 * @param {object} config
 */
export function apply(ctx, config) {
  const idleLockMinutes = Number(config && config.idleLockMinutes) || 0

  try {
    const logger = ctx && ctx.logger
    if (logger && typeof logger.info === 'function') {
      logger.info(
        '[lockscreen] 后台半边已加载：idleLockMinutes=%d（0 表示不自动锁，本版不生效）',
        idleLockMinutes,
      )
    }
  } catch {
    /* 日志打不出来不影响功能 */
  }

  // 首帧注入：只有"用 HTTP 提供界面的部署"才有 webServer（桌面端的 web 模式就有）。
  // 用 ctx.inject 声明依赖，服务没就位时这个回调永远不会跑 —— 也就是安静跳过，不报错。
  try {
    ctx.inject(['webServer'], (httpCtx) => {
      httpCtx.effect(
        () => httpCtx.webServer.tapIndex((html) => buildIndexSplash(html)),
        'lockscreen: index splash',
      )
      try {
        const logger = httpCtx && httpCtx.logger
        if (logger && typeof logger.info === 'function') {
          logger.info('[lockscreen] 首帧自检画面已挂到首页 HTML 上（%d ms）', SPLASH_MS)
        }
      } catch {
        /* ignore */
      }
    })
  } catch (error) {
    try {
      const logger = ctx && ctx.logger
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[lockscreen] 首帧注入没挂上：%s', String(error && error.message))
      }
    } catch {
      /* ignore */
    }
  }
}
