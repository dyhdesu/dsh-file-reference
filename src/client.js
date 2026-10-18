// 工作区文件右键引用 Client 半区：纯前端 DOM 插件。
// 在侧栏「工作区文件」树（官方 @deepseek-ai/dsh-client-ui-sidebar-files 的
// [data-files-body]）上拦 contextmenu，弹自绘菜单，把所选文件/文件夹以
// 宿主拖拽入文件的同一通道（conversation.input.shell(id).addFiles）插入
// 当前会话输入框为真正的 @引用 chip。
// 以 DSH client-modules 自注册格式发布：__ModuleLoader__.load({id, factory})。
// 纯逻辑段在 LOGIC 标记之间，与 src/logic.mjs 逐字同源（剥 export 后），
// 由 test/parity.test.mjs 保证；句柄挂 window 代际槽，HMR 重评估先拆上一代。

window.__ModuleLoader__.load({
  id: 'dsh-file-reference',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports

    /* LOGIC-BEGIN */
    /** 反斜杠归一为 /（宿主接受混合分隔符，树内一律以 / 拼接）。 */
    function normalizePath(path) {
      return String(path).replace(/\\/g, '/')
    }

    /** 把绝对路径折算为相对 cwd 的路径；不在 cwd 下或 cwd 未知时原样返回绝对路径。 */
    function relativize(path, cwd) {
      const p = normalizePath(path)
      if (cwd === undefined || cwd === null || cwd === '') return p
      const root = normalizePath(cwd).replace(/\/+$/u, '')
      if (root !== '' && p.startsWith(`${root}/`)) return p.slice(root.length + 1)
      return p
    }

    /**
     * 生成 @引用提及文本：无空白裸写 @path，含空白用 @"path"；目录尾随 /。
     * 含控制字符或双引号的路径编辑器语法无法安全表达，返回 undefined。
     */
    function formatMention(path, isDirectory) {
      const trimmed = normalizePath(path).replace(/\/+$/u, '')
      const p = isDirectory ? `${trimmed}/` : trimmed
      if (/[\u0000-\u001f\u007f-\u009f"]/u.test(p)) return undefined
      if (!/\s/u.test(p)) return `@${p}`
      return `@"${p}"`
    }

    /**
     * 构造一条引用 chip 载荷（宿主 SessionInputShell.addFiles 的元素形态）。
     * @returns chip 载荷；路径不可表达时为 undefined。
     */
    function buildReference(absPath, entryType, cwd) {
      const isDirectory = entryType === 'directory'
      const rel = relativize(absPath, cwd)
      const trimmed = rel.replace(/\/+$/u, '')
      const slash = trimmed.lastIndexOf('/')
      const name = trimmed.slice(slash + 1) || trimmed
      const mention = formatMention(trimmed, isDirectory)
      if (mention === undefined || name === '') return undefined
      return {
        source: 'reference',
        ref: mention,
        label: isDirectory ? `${name}/` : name,
        appearance: isDirectory ? 'folder' : 'file',
        clipboardText: mention,
      }
    }

    /** 会话归属判定：当前主会话 cwd 与树根一致（或树根未知）时取主会话——侧栏树属于本窗口主会话；仅不一致时才按根扫描其余会话（同工作区多会话共 cwd，盲扫首个匹配会选中无 binding 的旧会话）。 */
    function pickSessionId(byId, currentId, treeRoot) {
      const root = treeRoot === undefined || treeRoot === null ? '' : normalizePath(treeRoot).replace(/\/+$/u, '')
      const cwdOf = (row) => (row?.cwd === undefined || row?.cwd === null ? '' : normalizePath(row.cwd).replace(/\/+$/u, ''))
      if (currentId !== undefined && currentId !== null && (root === '' || cwdOf(byId?.[currentId]) === root)) return currentId
      if (root !== '') {
        for (const [id, row] of Object.entries(byId ?? {})) {
          const cwd = cwdOf(row)
          if (cwd !== '' && cwd === root) return id
        }
      }
      return currentId
    }
    /* LOGIC-END */

    // ---- 文案（跟随宿主 locale 服务，缺服务时按浏览器语言兜底） ----
    const NS = 'fileReference'
    const zh = {
      'menu.insert': '引用到会话',
      'menu.copy': '复制引用文本',
      'toast.inserted': '已插入 {mention}',
      'toast.copied': '已复制 {mention}',
      'toast.noSession': '没有活动会话，先进一个会话再引用',
      'toast.noComposer': '输入框暂不可用（会话输入通道未挂载），请刷新页面再试',
      'toast.admissionLocked': '输入框正在发送中，发送完再试',
      'toast.badPath': '这个路径含不支持的字符，没法引用',
      'toast.copyFailed': '复制失败，请手动输入 {mention}',
    }
    const en = {
      'menu.insert': 'Reference in session',
      'menu.copy': 'Copy reference text',
      'toast.inserted': 'Inserted {mention}',
      'toast.copied': 'Copied {mention}',
      'toast.noSession': 'No active session — open one first',
      'toast.noComposer': 'Composer unavailable (session input channel not mounted) — reload the page',
      'toast.admissionLocked': 'Composer is sending right now — try again once it settles',
      'toast.badPath': 'This path contains characters the reference grammar cannot express',
      'toast.copyFailed': 'Copy failed — type {mention} manually',
    }
    const fallbackT = (key, vars) => {
      const dict = (typeof navigator !== 'undefined' && String(navigator.language).toLowerCase().startsWith('zh')) ? zh : en
      return (dict[key] ?? key).replace(/\{(\w+)\}/gu, (_, name) => vars?.[name] ?? '')
    }

    // ---- 样式（全取宿主令牌，亮暗主题跟随） ----
    const STYLE_ID = 'dsh-file-reference/style'
    const CSS = `
.dsh-fileref-menu{position:fixed;z-index:2147483000;min-width:176px;max-width:min(420px,calc(100vw - 16px));box-sizing:border-box;padding:4px;background:var(--dsw-alias-bg-base,#fff);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:var(--dsw-radius-md,8px);box-shadow:0 8px 28px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary,#222);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5}
.dsh-fileref-menu .dsh-fileref-item{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:6px 10px;border:0;border-radius:var(--dsw-radius-sm,5px);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsh-fileref-menu .dsh-fileref-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dsh-fileref-menu .dsh-fileref-path{padding:2px 10px 6px;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;word-break:break-all;user-select:text}
.dsh-fileref-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483000;max-width:min(520px,calc(100vw - 32px));box-sizing:border-box;padding:7px 14px;background:var(--dsw-alias-bg-base,#fff);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:var(--dsw-radius-md,8px);box-shadow:0 8px 28px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary,#222);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5;word-break:break-all}
.dsh-fileref-toast[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#c00)}
`

    // window 代际槽：HMR/重复评估先拆掉上一代，保证装卸无残留。
    const SLOT = '__dshFileReferenceDispose'

    function apply(ctx) {
      if (typeof window[SLOT] === 'function') {
        try { window[SLOT]() } catch (_error) { /* 上一代拆除失败不阻塞新一代 */ }
        window[SLOT] = undefined
      }

      const t = ctx?.locale?.bind ? ctx.locale.bind(NS) : fallbackT
      if (ctx?.locale?.register && ctx?.effect) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'file-reference: dictionaries')
      }
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) === null) {
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        document.head.appendChild(style)
      }

      let menu = null
      let toastTimer = 0

      const closeMenu = () => {
        menu?.remove()
        menu = null
      }

      const toast = (text, tone) => {
        document.querySelectorAll('.dsh-fileref-toast').forEach((el) => el.remove())
        const el = document.createElement('div')
        el.className = 'dsh-fileref-toast'
        el.setAttribute('role', 'status')
        if (tone !== undefined) el.dataset.tone = tone
        el.textContent = text
        document.body.appendChild(el)
        clearTimeout(toastTimer)
        toastTimer = setTimeout(() => el.remove(), 1800)
      }

      // 当前树归属的会话：根路径匹配会话 cwd 优先（主会话优先），否则用主会话。
      const resolveSessionId = (treeRoot) => {
        const currentId = ctx?.uiSession?.current?.value?.key
        const byId = ctx?.sessions?.list?.getSnapshot?.()?.byId
        return pickSessionId(byId, currentId, treeRoot)
      }

      const resolveShell = (sessionId) => {
        try {
          const shell = ctx?.conversation?.input?.shell?.(sessionId)
          return shell !== undefined && shell !== null && typeof shell.addFiles === 'function' ? shell : undefined
        } catch (error) {
          console.debug('[dsh-file-reference] shell 解析失败', { sessionId, error: String(error) })
          return undefined
        }
      }

      const insertReference = (target) => {
        const picked = resolveSessionId(target.root)
        const currentId = ctx?.uiSession?.current?.value?.key
        // 候选序列：归属判定结果 + 主会话兜底（归属命中的会话无 binding 时退化到主会话）
        const candidates = [...new Set([picked, currentId].filter((id) => id !== undefined && id !== null))]
        if (candidates.length === 0) {
          console.debug('[dsh-file-reference] 无活动会话', { root: target.root })
          toast(t('toast.noSession'), 'error')
          return
        }
        let shell
        let usedId
        for (const id of candidates) {
          const resolved = resolveShell(id)
          if (resolved !== undefined) {
            shell = resolved
            usedId = id
            break
          }
        }
        if (shell === undefined) {
          console.debug('[dsh-file-reference] 候选会话均无 shell', { candidates })
          toast(t('toast.noComposer'), 'error')
          return
        }
        const cwd = ctx?.sessions?.list?.getSnapshot?.()?.byId?.[usedId]?.cwd ?? target.root
        const reference = buildReference(target.path, target.kind, cwd)
        if (reference === undefined) {
          toast(t('toast.badPath'), 'error')
          return
        }
        let applied = false
        try {
          applied = shell.addFiles([reference], []) === true
        } catch (error) {
          console.debug('[dsh-file-reference] addFiles 抛错', { sessionId: usedId, error: String(error) })
          applied = false
        }
        if (!applied) {
          console.debug('[dsh-file-reference] addFiles 被拒（发送中或编辑器拒绝）', { sessionId: usedId })
          toast(t('toast.admissionLocked'), 'error')
          return
        }
        console.debug('[dsh-file-reference] 已插入', { sessionId: usedId, ref: reference.ref })
        try { shell.focus?.() } catch (_error) { /* 输入框未挂载时聚焦跳过 */ }
        toast(t('toast.inserted', { mention: reference.ref }))
      }

      const copyReference = (target) => {
        const cwd = ctx?.sessions?.list?.getSnapshot?.()?.byId?.[resolveSessionId(target.root)]?.cwd ?? target.root
        const reference = buildReference(target.path, target.kind, cwd)
        if (reference === undefined) {
          toast(t('toast.badPath'), 'error')
          return
        }
        navigator.clipboard?.writeText(reference.ref).then(
          () => toast(t('toast.copied', { mention: reference.ref })),
          () => toast(t('toast.copyFailed', { mention: reference.ref }), 'error'),
        )
      }

      const openMenu = (x, y, target) => {
        closeMenu()
        const el = document.createElement('div')
        el.className = 'dsh-fileref-menu'
        el.setAttribute('role', 'menu')
        const makeItem = (label, run) => {
          const item = document.createElement('button')
          item.type = 'button'
          item.className = 'dsh-fileref-item'
          item.setAttribute('role', 'menuitem')
          item.textContent = label
          item.addEventListener('click', () => {
            closeMenu()
            run()
          })
          return item
        }
        el.appendChild(makeItem(t('menu.insert'), () => insertReference(target)))
        el.appendChild(makeItem(t('menu.copy'), () => copyReference(target)))
        const preview = document.createElement('div')
        preview.className = 'dsh-fileref-path'
        preview.textContent = target.path
        el.appendChild(preview)
        document.body.appendChild(el)
        const rect = el.getBoundingClientRect()
        el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`
        el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`
        menu = el
      }

      const onContextMenu = (event) => {
        const row = event.target instanceof Element ? event.target.closest('[data-files-entry]') : null
        if (row === null || row.closest('[data-files-body]') === null) return
        const kind = row.getAttribute('data-files-entry')
        if (kind !== 'file' && kind !== 'directory') return
        const path = row.getAttribute('data-files-path')
        if (path === null || path === '') return
        event.preventDefault()
        event.stopPropagation()
        const root = row.closest('[data-files-root]')?.getAttribute('data-files-root')
          ?? document.querySelector('[data-files-root]')?.getAttribute('data-files-root')
          ?? undefined
        openMenu(event.clientX, event.clientY, { path, kind, root })
      }

      const onPointerDown = (event) => {
        if (menu !== null && !menu.contains(event.target)) closeMenu()
      }
      const onKeyDown = (event) => {
        if (event.key === 'Escape') closeMenu()
      }
      const onPassiveClose = () => closeMenu()

      document.addEventListener('contextmenu', onContextMenu, true)
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('keydown', onKeyDown, true)
      document.addEventListener('scroll', onPassiveClose, true)
      window.addEventListener('blur', onPassiveClose)
      window.addEventListener('resize', onPassiveClose)

      const dispose = () => {
        document.removeEventListener('contextmenu', onContextMenu, true)
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
        document.removeEventListener('scroll', onPassiveClose, true)
        window.removeEventListener('blur', onPassiveClose)
        window.removeEventListener('resize', onPassiveClose)
        clearTimeout(toastTimer)
        closeMenu()
        document.querySelectorAll('.dsh-fileref-toast').forEach((el) => el.remove())
        document.getElementById(STYLE_ID)?.remove()
        if (window[SLOT] === dispose) window[SLOT] = undefined
      }
      window[SLOT] = dispose
      ctx?.effect?.(() => dispose, 'file-reference: context menu')
    }

    exports.apply = apply
    exports.inject = ['conversation', 'uiSession', 'sessions', 'locale']
    return module.exports
  },
})
