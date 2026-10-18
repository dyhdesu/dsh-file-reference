// 纯逻辑层：路径归一化、@引用语法、chip 载荷构造。
// 与 src/client.js 的 LOGIC 段保持逐字同源，由 test/parity.test.mjs 保证。
// 语法依据宿主 @deepseek-ai/dsh-client-ui-reference 的 formatFileMention 与
// ui-conversation 拖拽入文件的 addFiles 路径（提及文本 = 相对 cwd 的 @路径）。

/** 反斜杠归一为 /（宿主接受混合分隔符，树内一律以 / 拼接）。 */
export function normalizePath(path) {
  return String(path).replace(/\\/g, '/')
}

/** 是否 Windows 形态路径（盘符 C:/… 或 UNC //server/share）；仅用于决定比较时是否忽略大小写。 */
export function isWindowsPath(path) {
  return /^[A-Za-z]:\//u.test(path) || path.startsWith('//')
}

/** 同一路径判定：先按字面比；两边都是 Windows 形态时再忽略大小写比（Windows 文件系统不区分大小写，POSIX 形态保持严格）。 */
export function samePath(a, b) {
  return a === b || (isWindowsPath(a) && isWindowsPath(b) && a.toLowerCase() === b.toLowerCase())
}

/** 把绝对路径折算为相对 cwd 的路径；不在 cwd 下或 cwd 未知时原样返回绝对路径。Windows 形态下前缀按大小写不敏感比对，切片仍取原串以保留用户大小写。 */
export function relativize(path, cwd) {
  const p = normalizePath(path)
  if (cwd === undefined || cwd === null || cwd === '') return p
  const root = normalizePath(cwd).replace(/\/+$/u, '')
  if (root === '') return p
  if (p.startsWith(`${root}/`)) return p.slice(root.length + 1)
  if (samePath(root, p.slice(0, root.length)) && p.charAt(root.length) === '/') return p.slice(root.length + 1)
  return p
}

/**
 * 生成 @引用提及文本：无空白裸写 @path，含空白用 @"path"；目录尾随 /。
 * 含控制字符或双引号的路径编辑器语法无法安全表达，返回 undefined。
 */
export function formatMention(path, isDirectory) {
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
export function buildReference(absPath, entryType, cwd) {
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
export function pickSessionId(byId, currentId, treeRoot) {
  const root = treeRoot === undefined || treeRoot === null ? '' : normalizePath(treeRoot).replace(/\/+$/u, '')
  const cwdOf = (row) => (row?.cwd === undefined || row?.cwd === null ? '' : normalizePath(row.cwd).replace(/\/+$/u, ''))
  if (currentId !== undefined && currentId !== null && (root === '' || samePath(cwdOf(byId?.[currentId]), root))) return currentId
  if (root !== '') {
    for (const [id, row] of Object.entries(byId ?? {})) {
      const cwd = cwdOf(row)
      if (cwd !== '' && samePath(cwd, root)) return id
    }
  }
  return currentId
}

/** 按文档顺序找节点内第一个非空 title 属性：官方把交付文件的绝对路径放在卡片预览按钮（首个子节点）的 title 上；后续兄弟节点（如 ⋯ 操作菜单）可能另有 title，故顺序敏感。 */
export function firstTitleWithin(node) {
  const stack = [node]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined || current === null) continue
    const title = typeof current.getAttribute === 'function' ? current.getAttribute('title') : null
    if (title !== null && title !== undefined && String(title).trim() !== '') return String(title)
    const children = current.children
    if (children === undefined || children === null) continue
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index])
  }
  return undefined
}

/**
 * 命中右键目标，返回 { path, kind, root }；未命中或官方结构变化取不到路径时返回 undefined
 * （调用方据此不拦截右键，让浏览器默认行为继续）。
 * - 侧栏文件树行：data-files-entry(type) + data-files-path(绝对)，树根 data-files-root 用于会话纠偏。
 * - 交付文件卡片：data-presented-file 只作标记，路径在预览按钮 title 上（官方内部契约，非公开 API）；
 *   归属即当前会话，故 root 留空。
 */
export function contextTarget(element) {
  if (element === undefined || element === null || typeof element.closest !== 'function') return undefined
  const row = element.closest('[data-files-entry]')
  if (row !== null && row !== undefined && typeof row.closest === 'function' && row.closest('[data-files-body]') !== null) {
    const kind = row.getAttribute('data-files-entry')
    const path = row.getAttribute('data-files-path')
    if ((kind === 'file' || kind === 'directory') && path !== null && path !== undefined && path !== '') {
      const rootNode = row.closest('[data-files-root]')
      const fallback = typeof document !== 'undefined' && typeof document.querySelector === 'function' ? document.querySelector('[data-files-root]') : null
      const rootValue = (rootNode ?? fallback)?.getAttribute?.('data-files-root')
      return { path, kind, root: rootValue === null || rootValue === undefined ? undefined : rootValue }
    }
  }
  const card = element.closest('[data-presented-file]')
  if (card !== null && card !== undefined) {
    const path = firstTitleWithin(card)
    if (path !== undefined) return { path, kind: 'file', root: undefined }
  }
  return undefined
}
