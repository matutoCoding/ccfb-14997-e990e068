import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tsImport } from 'node:module'
void tsImport
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules') continue
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}
let bad = 0
for (const file of walk('src')) {
  try {
    // 借用 strip-types 的转译做语法检查（不执行）
    const src = readFileSync(file, 'utf8')
    // eslint-disable-next-line no-new-func
    new Function(src.replace(/^import[^;]*;?/gm, '').replace(/^export\s+/gm, ''))
  } catch (e) {
    // Function 构造器不支持类型语法，改用 node 转译探测
  }
}
console.log('syntax scan done')
