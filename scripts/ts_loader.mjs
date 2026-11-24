// 仅用于 node 原生跑 TS 校验：给无扩展名的相对导入补 .ts
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
    const base = new URL(specifier, context.parentURL)
    const tsPath = fileURLToPath(base) + '.ts'
    if (existsSync(tsPath)) {
      return nextResolve(pathToFileURL(tsPath).href, context)
    }
  }
  return nextResolve(specifier, context)
}
