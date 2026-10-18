import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePath, isWindowsPath, samePath, relativize, formatMention, buildReference, pickSessionId } from '../src/logic.mjs'

test('normalizePath 反斜杠归一', () => {
  assert.equal(normalizePath('a\\b\\c'), 'a/b/c')
  assert.equal(normalizePath('/a/b'), '/a/b')
})

test('relativize cwd 内路径变相对', () => {
  assert.equal(relativize('/w/root/sub/a.txt', '/w/root'), 'sub/a.txt')
  assert.equal(relativize('/w/root/a.txt', '/w/root/'), 'a.txt')
})

test('relativize cwd 外或未知 cwd 保持原样', () => {
  assert.equal(relativize('/other/a.txt', '/w/root'), '/other/a.txt')
  assert.equal(relativize('/w/root2/a.txt', '/w/root'), '/w/root2/a.txt')
  assert.equal(relativize('/w/root/a.txt', ''), '/w/root/a.txt')
  assert.equal(relativize('/w/root/a.txt', undefined), '/w/root/a.txt')
})

test('relativize 边界：cwd 兄弟前缀不误判', () => {
  assert.equal(relativize('/w/rootx/a.txt', '/w/root'), '/w/rootx/a.txt')
})

test('formatMention 裸路径与空白引用', () => {
  assert.equal(formatMention('sub/a.txt', false), '@sub/a.txt')
  assert.equal(formatMention('a b/c.txt', false), '@"a b/c.txt"')
})

test('formatMention 目录尾随斜杠', () => {
  assert.equal(formatMention('dir', true), '@dir/')
  assert.equal(formatMention('dir/sub', true), '@dir/sub/')
  assert.equal(formatMention('my dir', true), '@"my dir/"')
})

test('formatMention 不支持字符返回 undefined', () => {
  assert.equal(formatMention('a\u001fb', false), undefined)
  assert.equal(formatMention('a\u007fb', false), undefined)
})

test('buildReference 文件 chip', () => {
  assert.deepEqual(buildReference('/w/root/sub/a.txt', 'file', '/w/root'), {
    source: 'reference',
    ref: '@sub/a.txt',
    label: 'a.txt',
    appearance: 'file',
    clipboardText: '@sub/a.txt',
  })
})

test('buildReference 目录 chip', () => {
  assert.deepEqual(buildReference('/w/root/my dir', 'directory', '/w/root'), {
    source: 'reference',
    ref: '@"my dir/"',
    label: 'my dir/',
    appearance: 'folder',
    clipboardText: '@"my dir/"',
  })
})

test('buildReference cwd 未知时用绝对路径', () => {
  const ref = buildReference('/w/root/a.txt', 'file', undefined)
  assert.equal(ref.ref, '@/w/root/a.txt')
  assert.equal(ref.label, 'a.txt')
})

test('buildReference 非法路径返回 undefined', () => {
  assert.equal(buildReference('/w/root/a"b.txt', 'file', '/w/root'), undefined)
})

test('pickSessionId 同 cwd 多会话时主会话优先', () => {
  // 同工作区多个会话共 cwd：先扫到的旧会话可能没有 binding，
  // 主会话（侧栏树所属）必须赢，无论 byId 插入顺序。
  const byId = {
    old: { cwd: '/w/root' },
    main: { cwd: '/w/root' },
  }
  assert.equal(pickSessionId(byId, 'main', '/w/root'), 'main')
  assert.equal(pickSessionId(byId, 'old', '/w/root'), 'old')
})

test('pickSessionId 主会话 cwd 与树根不一致时才扫描', () => {
  const byId = {
    s1: { cwd: '/w/one' },
    s2: { cwd: '/w/two' },
  }
  assert.equal(pickSessionId(byId, 's1', '/w/two'), 's2')
  assert.equal(pickSessionId(byId, 's1', '/w/unknown'), 's1')
  assert.equal(pickSessionId(byId, 's1', ''), 's1')
  assert.equal(pickSessionId(undefined, 's1', '/w/two'), 's1')
  assert.equal(pickSessionId(byId, undefined, '/w/none'), undefined)
})

// ---- Windows 形态：盘符、混合分隔符、UNC ----
// 依据官方 dsh-client-ui-sidebar-files 的 childPath：行路径以 `/` 拼接，
// 宿主解析混合分隔符；根路径可能仍是反斜杠形态（C:\Users\x\proj）。

test('normalizePath Windows 盘符与反斜杠', () => {
  assert.equal(normalizePath('C:\\Users\\Foo\\proj'), 'C:/Users/Foo/proj')
  assert.equal(normalizePath('C:\\w\\root\\'), 'C:/w/root/')
})

test('isWindowsPath 只认盘符与 UNC', () => {
  assert.equal(isWindowsPath('C:/w'), true)
  assert.equal(isWindowsPath('c:/w'), true)
  assert.equal(isWindowsPath('//srv/share'), true)
  assert.equal(isWindowsPath('/w/root'), false)
  assert.equal(isWindowsPath('w/root'), false)
})

test('samePath 仅 Windows 形态忽略大小写', () => {
  assert.equal(samePath('C:/W/Root', 'c:/w/root'), true)
  assert.equal(samePath('//SRV/Share', '//srv/share'), true)
  assert.equal(samePath('/w/Root', '/w/root'), false)
  assert.equal(samePath('C:/w/root', '/w/root'), false)
  assert.equal(samePath('C:/w/root', 'C:/w/root/sub'), false)
})

test('relativize Windows 混合分隔符与反斜杠 cwd', () => {
  assert.equal(relativize('C:\\w\\root\\src\\a.txt', 'C:/w/root'), 'src/a.txt')
  assert.equal(relativize('C:\\w\\root/a.txt', 'C:\\w\\root'), 'a.txt')
  assert.equal(relativize('C:\\w\\root\\sub\\', 'C:/w/root'), 'sub/')
})

test('relativize Windows 盘符大小写不一致仍相对化，且保留原大小写', () => {
  assert.equal(relativize('c:/w/root/src/a.txt', 'C:/W/Root'), 'src/a.txt')
  assert.equal(relativize('C:/W/Root/Src/A.txt', 'c:/w/root'), 'Src/A.txt')
})

test('relativize UNC 根', () => {
  assert.equal(relativize('//srv/share/dir/a.txt', '//SRV/share'), 'dir/a.txt')
})

test('relativize Windows 根前缀兄弟目录不误判', () => {
  assert.equal(relativize('C:/w/rootx/a.txt', 'C:/w/root'), 'C:/w/rootx/a.txt')
})

test('relativize POSIX 仍严格区分大小写', () => {
  assert.equal(relativize('/w/Root/a.txt', '/w/root'), '/w/Root/a.txt')
})

test('buildReference Windows 路径出相对 chip', () => {
  assert.deepEqual(buildReference('C:\\w\\root\\my dir\\a.txt', 'file', 'c:/w/root'), {
    source: 'reference',
    ref: '@"my dir/a.txt"',
    label: 'a.txt',
    appearance: 'file',
    clipboardText: '@"my dir/a.txt"',
  })
})

test('buildReference Windows 目录 chip', () => {
  assert.deepEqual(buildReference('C:\\w\\root\\src', 'directory', 'C:/w/root'), {
    source: 'reference',
    ref: '@src/',
    label: 'src/',
    appearance: 'folder',
    clipboardText: '@src/',
  })
})

test('pickSessionId Windows 盘符大小写不一致仍能归属', () => {
  const byId = {
    s1: { cwd: 'C:\\w\\one' },
    s2: { cwd: 'c:/W/two' },
  }
  assert.equal(pickSessionId(byId, 's1', 'C:/w/two'), 's2')
  assert.equal(pickSessionId(byId, 's1', 'C:\\W\\ONE'), 's1')
})
