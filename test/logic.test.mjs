import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePath, relativize, formatMention, buildReference, pickSessionId } from '../src/logic.mjs'

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
