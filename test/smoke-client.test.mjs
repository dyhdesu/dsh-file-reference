// 冒烟：在 Node 里以迷你 DOM + 模拟 ctx 执行 client.js 的注册与 apply，
// 走通「右键 → 菜单 → 点击插入 → addFiles 收到正确 chip」全链路，
// 以及无会话/忙碌/非法路径三条失败支路与 dispose 拆卸。
// 目的：重启前拦截属性名笔误与运行时异常（加载器对单模块故障隔离，
// 但本测试把故障在本地暴露）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const clientSource = readFileSync(join(here, '../src/client.js'), 'utf8')

// ---- 迷你 DOM ----
class FakeClassList {
  constructor(el) { this.el = el }
  add(name) { this.el._classes.add(name) }
  remove(name) { this.el._classes.delete(name) }
  contains(name) { return this.el._classes.has(name) }
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.listeners = {}
    this.style = {}
    this.dataset = {}
    this._classes = new Set()
    this.textContent = ''
    this.removed = false
  }
  get classList() { return new FakeClassList(this) }
  set className(value) { this._classes = new Set(String(value).split(/\s+/u).filter(Boolean)) }
  get className() { return [...this._classes].join(' ') }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child }
  remove() { this.removed = true; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this) }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn) }
  dispatch(type, event) { for (const fn of this.listeners[type] ?? []) fn(event) }
  contains(other) { for (let node = other; node; node = node.parentNode) if (node === this) return true; return false }
  closest(selector) {
    const match = selector.match(/^\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]$/u)
    const attr = match?.[1]
    const value = match?.[2]
    for (let node = this; node; node = node.parentNode) {
      if (!(node instanceof FakeElement)) continue
      if (!(attr in node.attributes)) continue
      if (value !== undefined && node.attributes[attr] !== value) continue
      return node
    }
    return null
  }
  getBoundingClientRect() { return { width: 200, height: 100 } }
  click() { this.dispatch('click', {}) }
}

function makeHarness() {
  const registered = new Map()
  const listeners = { document: {}, window: {} }
  const documentEl = {
    head: new FakeElement('head'),
    body: new FakeElement('body'),
    getElementById(id) {
      let found = null
      const walk = (el) => { if (el.id === id) found = el; el.children.forEach(walk) }
      walk(this.head); walk(this.body)
      return found
    },
    createElement: (tag) => new FakeElement(tag),
    querySelectorAll(selector) {
      const klass = selector.replace(/^\.|^\[\]/u, '')
      const out = []
      const walk = (el) => { if (el._classes?.has(klass)) out.push(el); el.children.forEach(walk) }
      walk(this.head); walk(this.body)
      return out
    },
    addEventListener: (t, f) => { (listeners.document[t] ??= []).push(f) },
    removeEventListener: (t, f) => { listeners.document[t] = (listeners.document[t] ?? []).filter((x) => x !== f) },
  }
  const windowEl = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: (t, f) => { (listeners.window[t] ??= []).push(f) },
    removeEventListener: (t, f) => { listeners.window[t] = (listeners.window[t] ?? []).filter((x) => x !== f) },
  }
  const navigatorEl = { language: 'zh-CN', clipboard: { writeText: (text) => { navigatorEl.copied = text; return Promise.resolve() } } }
  return { registered, listeners, documentEl, windowEl, navigatorEl }
}

function loadClient(harness) {
  const modules = []
  const loader = { load: (def) => modules.push(def) }
  // client.js 顶层引用 window.__ModuleLoader__ 与浏览器全局 Element，经参数注入
  const fn = new Function('window', 'document', 'navigator', 'Element', '__ModuleLoader__', `
    const w = window
    w.__ModuleLoader__ = __ModuleLoader__
    ${clientSource}
    return window.__dshFileReferenceDispose
  `)
  fn(harness.windowEl, harness.documentEl, harness.navigatorEl, FakeElement, loader)
  assert.equal(modules.length, 1)
  assert.equal(modules[0].id, 'dsh-file-reference')
  return modules[0]
}

function makeCtx(overrides = {}) {
  const effects = []
  const addFilesCalls = []
  const ctx = {
    locale: {
      register: () => () => {},
      bind: () => (key, vars) => (overrides.dict?.[key] ?? key).replace(/\{(\w+)\}/gu, (_, n) => vars?.[n] ?? ''),
    },
    effect: (fn) => effects.push(fn),
    uiSession: { current: { value: { key: 'sess-1' } } },
    sessions: { list: { getSnapshot: () => ({ byId: { 'sess-1': { cwd: '/w/root' } } }) } },
    conversation: {
      input: {
        shell: (id) => ({
          addFiles: (refs, ids) => { addFilesCalls.push({ id, refs, ids }); return overrides.addFilesResult ?? true },
          focus: () => { overrides.focused ? overrides.focused() : null },
        }),
      },
    },
  }
  return { ctx, effects, addFilesCalls }
}

function fireContextMenu(harness, row) {
  const event = {
    target: row,
    clientX: 100,
    clientY: 100,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.stopped = true },
  }
  for (const fn of harness.listeners.document.contextmenu ?? []) fn(event)
  return event
}

function fileRow(path, kind = 'file') {
  const root = new FakeElement('div')
  root.setAttribute('data-files-root', '/w/root')
  const body = new FakeElement('div')
  body.setAttribute('data-files-body', 'true')
  const li = new FakeElement('li')
  li.setAttribute('data-files-entry', kind)
  li.setAttribute('data-files-path', path)
  root.appendChild(body); body.appendChild(li)
  return li
}

test('client.js 注册模块并挂 apply/inject', () => {
  const harness = makeHarness()
  const mod = loadClient(harness)
  assert.equal(typeof mod.factory, 'function')
  const exports = mod.factory(() => ({}))
  assert.equal(typeof exports.apply, 'function')
  assert.ok(Array.isArray(exports.inject))
})

test('右键文件行 → 菜单 → 引用到会话插入正确 chip', () => {
  const harness = makeHarness()
  const mod = loadClient(harness)
  const exports = mod.factory(() => ({}))
  let focused = false
  const { ctx, addFilesCalls } = makeCtx({ focused: () => { focused = true } })
  exports.apply(ctx)

  const row = fileRow('/w/root/sub/a b.txt')
  const event = fireContextMenu(harness, row)
  assert.equal(event.defaultPrevented, true)

  const menus = harness.documentEl.querySelectorAll('.dsh-fileref-menu')
  assert.equal(menus.length, 1)
  const [insertItem, copyItem] = menus[0].children
  assert.equal(insertItem.textContent, 'menu.insert')
  insertItem.click()

  assert.equal(addFilesCalls.length, 1)
  assert.equal(addFilesCalls[0].id, 'sess-1')
  assert.deepEqual(addFilesCalls[0].refs, [{
    source: 'reference',
    ref: '@"sub/a b.txt"',
    label: 'a b.txt',
    appearance: 'file',
    clipboardText: '@"sub/a b.txt"',
  }])
  assert.deepEqual(addFilesCalls[0].ids, [])
  assert.equal(focused, true)
})

test('右键文件夹 → appearance folder 且尾随斜杠', () => {
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  const { ctx, addFilesCalls } = makeCtx()
  exports.apply(ctx)
  fireContextMenu(harness, fileRow('/w/root/my dir', 'directory'))
  harness.documentEl.querySelectorAll('.dsh-fileref-menu')[0].children[0].click()
  assert.equal(addFilesCalls[0].refs[0].ref, '@"my dir/"')
  assert.equal(addFilesCalls[0].refs[0].appearance, 'folder')
  assert.equal(addFilesCalls[0].refs[0].label, 'my dir/')
})

test('无活动会话 → 报错 toast 且不调用 addFiles', () => {
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  const { ctx, addFilesCalls } = makeCtx()
  ctx.uiSession.current.value.key = undefined
  ctx.sessions.list.getSnapshot = () => ({ byId: {} })
  exports.apply(ctx)
  fireContextMenu(harness, fileRow('/w/root/a.txt'))
  harness.documentEl.querySelectorAll('.dsh-fileref-menu')[0].children[0].click()
  assert.equal(addFilesCalls.length, 0)
  const toasts = harness.documentEl.querySelectorAll('.dsh-fileref-toast')
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].dataset.tone, 'error')
})

test('addFiles 返回 false（发送中）→ 报错且不聚焦', () => {
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  const { ctx, addFilesCalls } = makeCtx({ addFilesResult: false })
  exports.apply(ctx)
  fireContextMenu(harness, fileRow('/w/root/a.txt'))
  harness.documentEl.querySelectorAll('.dsh-fileref-menu')[0].children[0].click()
  assert.equal(addFilesCalls.length, 1)
  assert.equal(harness.documentEl.querySelectorAll('.dsh-fileref-toast')[0].dataset.tone, 'error')
})

test('shell 抛错（会话无 binding）→ 报错 toast', () => {
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  const { ctx } = makeCtx()
  ctx.conversation.input.shell = () => { throw new Error('no binding') }
  exports.apply(ctx)
  fireContextMenu(harness, fileRow('/w/root/a.txt'))
  harness.documentEl.querySelectorAll('.dsh-fileref-menu')[0].children[0].click()
  assert.equal(harness.documentEl.querySelectorAll('.dsh-fileref-toast')[0].dataset.tone, 'error')
})

test('归属会话无 binding 时退化到主会话插入', () => {
  // 回归：同 cwd 旧会话先被 pickSessionId 选中（主会话不一致才会发生），
  // 其 shell 解析抛错时必须退化到主会话，而不是直接报不可用。
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  const { ctx, addFilesCalls } = makeCtx()
  ctx.sessions.list.getSnapshot = () => ({
    byId: { stale: { cwd: '/w/root' }, 'sess-1': { cwd: '/w/root' } },
  })
  const realShell = ctx.conversation.input.shell
  ctx.conversation.input.shell = (id) => {
    if (id === 'stale') throw new Error('no binding')
    return realShell(id)
  }
  exports.apply(ctx)
  // 强制归属命中 stale：把树根指到一个主会话 cwd 不匹配的根做不到（主会话优先），
  // 这里直接验证候选退化链：picked=stale 由 pickSessionId 在主会话 cwd 不一致时产生。
  ctx.sessions.list.getSnapshot = () => ({
    byId: { stale: { cwd: '/w/elsewhere' }, 'sess-1': { cwd: '/w/root' } },
  })
  fireContextMenu(harness, fileRow('/w/elsewhere/a.txt'))
  harness.documentEl.querySelectorAll('.dsh-fileref-menu')[0].children[0].click()
  assert.equal(addFilesCalls.length, 1)
  assert.equal(addFilesCalls[0].id, 'sess-1')
})

test('other 条目类型与树外区域不拦截', () => {
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  const { ctx } = makeCtx()
  exports.apply(ctx)
  const other = fileRow('/w/root/pipe', 'other')
  assert.equal(fireContextMenu(harness, other).defaultPrevented, false)
  const outside = new FakeElement('div')
  assert.equal(fireContextMenu(harness, outside).defaultPrevented, false)
  assert.equal(harness.documentEl.querySelectorAll('.dsh-fileref-menu').length, 0)
})

test('复制引用文本写入剪贴板', async () => {
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  const { ctx } = makeCtx()
  exports.apply(ctx)
  fireContextMenu(harness, fileRow('/w/root/sub/a.txt'))
  harness.documentEl.querySelectorAll('.dsh-fileref-menu')[0].children[1].click()
  await new Promise((r) => setImmediate(r))
  assert.equal(harness.navigatorEl.copied, '@sub/a.txt')
})

test('dispose 拆卸：监听器移除、菜单清理、代际槽清空', () => {
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  const { ctx, effects } = makeCtx()
  exports.apply(ctx)
  fireContextMenu(harness, fileRow('/w/root/a.txt'))
  assert.equal(harness.documentEl.querySelectorAll('.dsh-fileref-menu').length, 1)
  assert.ok(typeof harness.windowEl.__dshFileReferenceDispose === 'function')
  harness.windowEl.__dshFileReferenceDispose()
  assert.equal(harness.documentEl.querySelectorAll('.dsh-fileref-menu').length, 0)
  assert.equal(harness.windowEl.__dshFileReferenceDispose, undefined)
  assert.equal((harness.listeners.document.contextmenu ?? []).length, 0)
  assert.ok(effects.length >= 1)
})

test('apply 在服务全缺时不抛异常（降级兜底）', () => {
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  assert.doesNotThrow(() => exports.apply({}))
  fireContextMenu(harness, fileRow('/w/root/a.txt'))
  assert.doesNotThrow(() => harness.documentEl.querySelectorAll('.dsh-fileref-menu')[0].children[0].click())
  assert.equal(harness.documentEl.querySelectorAll('.dsh-fileref-toast')[0].dataset.tone, 'error')
})

// 交付文件卡片：官方结构为 div[data-presented-file] 内首个 button 的 title=绝对路径
function presentedCardName(path, withTitle = true) {
  const card = new FakeElement('div')
  card.setAttribute('data-presented-file', 'true')
  const preview = new FakeElement('button')
  if (withTitle) preview.setAttribute('title', path)
  const body = new FakeElement('div')
  const name = new FakeElement('span')
  card.appendChild(preview); card.appendChild(body); body.appendChild(name)
  return name
}

test('右键交付文件卡片 → 菜单 → 插入相对 chip', () => {
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  const { ctx, addFilesCalls } = makeCtx()
  exports.apply(ctx)

  const name = presentedCardName('/w/root/out/combo_index.html')
  const event = fireContextMenu(harness, name)
  assert.equal(event.defaultPrevented, true)

  const menus = harness.documentEl.querySelectorAll('.dsh-fileref-menu')
  assert.equal(menus.length, 1)
  menus[0].children[0].click()
  assert.deepEqual(addFilesCalls[0].refs, [{
    source: 'reference',
    ref: '@out/combo_index.html',
    label: 'combo_index.html',
    appearance: 'file',
    clipboardText: '@out/combo_index.html',
  }])
})

test('交付卡片无 title 时不拦截右键（不吞默认行为、不弹菜单）', () => {
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  exports.apply(makeCtx().ctx)
  const name = presentedCardName('/w/root/out/x.html', false)
  assert.equal(fireContextMenu(harness, name).defaultPrevented, false)
  assert.equal(harness.documentEl.querySelectorAll('.dsh-fileref-menu').length, 0)
})

test('交付卡片复制引用文本写入剪贴板', async () => {
  const harness = makeHarness()
  const exports = loadClient(harness).factory(() => ({}))
  exports.apply(makeCtx().ctx)
  fireContextMenu(harness, presentedCardName('/w/root/out/combo_index.html'))
  harness.documentEl.querySelectorAll('.dsh-fileref-menu')[0].children[1].click()
  await new Promise((r) => setImmediate(r))
  assert.equal(harness.navigatorEl.copied, '@out/combo_index.html')
})
