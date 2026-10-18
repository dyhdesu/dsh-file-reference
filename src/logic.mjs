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
