// 同源校验：src/client.js 的 LOGIC 段与 src/logic.mjs 必须逐字一致
// （logic.mjs 剥掉 export 前缀后）。client.js 是单文件自注册模块，无法
// import 同级文件，逻辑只能内联；本测试防止两份漂移。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function logicBlock(clientSource) {
  const match = clientSource.match(/\/\* LOGIC-BEGIN \*\/([\s\S]*?)\/\* LOGIC-END \*\//u)
  assert.ok(match !== null, 'client.js 缺少 LOGIC 标记段')
  return match[1]
}

function normalize(source) {
  const lines = source
    .split('\n')
    .map((line) => line.replace(/^(\s*)export /u, '$1'))
    .map((line) => line.replace(/[ \t]+$/u, ''))
  // 去公共缩进：client.js 的 LOGIC 段嵌在 factory 里，比 logic.mjs 多四层
  const indents = lines.filter((line) => line.trim() !== '').map((line) => line.match(/^[ \t]*/u)[0].length)
  const min = indents.length === 0 ? 0 : Math.min(...indents)
  return lines
    .map((line) => line.slice(min))
    .join('\n')
    .replace(/^\s*\n/u, '')
    .replace(/\s*\n$/u, '')
}

test('client.js LOGIC 段与 logic.mjs 同源', () => {
  const client = readFileSync(join(here, '../src/client.js'), 'utf8')
  const logic = readFileSync(join(here, '../src/logic.mjs'), 'utf8')
  const fromClient = normalize(logicBlock(client))
  const fromLogic = normalize(logic)
  // logic.mjs 头部注释（前 4 行）不进 client.js，比对时剥到第一个函数起
  const logicBody = fromLogic.slice(fromLogic.indexOf('/**'))
  assert.equal(fromClient.trim(), logicBody.trim())
})
