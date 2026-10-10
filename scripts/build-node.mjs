// scripts/build-node.mjs — Koyeb Node 版构建脚本（对齐 CF Pages 项目的「静态资源外链化」架构）
//
//   1. 从 src/pages.css.ts / src/shared.js.ts / src/admin.script.ts 抽出 CSS 与客户端脚本；
//   2. 压缩（保留顶层函数名 —— 页面里有大量内联 onclick="foo()" 依赖全局名）；
//   3. 按内容哈希命名写入 dist/assets/，并通过 esbuild --define 把 URL 注入 server bundle；
//   4. src/node.ts 在运行时直接从 dist/assets/ 提供这些文件（immutable 一年期缓存）。
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const assetsDir = join(dist, 'assets')

const esbuild = await import('esbuild').catch(() =>
  import(pathToFileURL(join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href))

/** 把 TS 模块求值，取出其中的字符串导出（它们在源码里是模板字符串） */
async function evalExport(relPath, exportName) {
  const source = readFileSync(join(root, relPath), 'utf8')
  const { code } = await esbuild.transform(source, { loader: 'ts', format: 'esm' })
  const tmp = join(tmpdir(), 'ai-gateway-koyeb-build-' + Math.random().toString(36).slice(2) + '.mjs')
  writeFileSync(tmp, code, 'utf8')
  try {
    const mod = await import(pathToFileURL(tmp).href)
    const value = mod[exportName]
    if (typeof value !== 'string' || !value) throw new Error(relPath + ' 的导出 ' + exportName + ' 不是非空字符串')
    return value
  } finally {
    rmSync(tmp, { force: true })
  }
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10)

/** 写一个带内容哈希的资源，返回它的 URL */
function emitAsset(name, ext, content) {
  const file = name + '.' + hash(content) + '.' + ext
  writeFileSync(join(assetsDir, file), content, 'utf8')
  return { url: '/assets/' + file, bytes: Buffer.byteLength(content) }
}

mkdirSync(dist, { recursive: true })
rmSync(assetsDir, { recursive: true, force: true })
mkdirSync(assetsDir, { recursive: true })

// ── 1) 抽取 + 压缩 ──────────────────────────────────────────────────────────
const rawCss = await evalExport('src/pages.css.ts', 'CSS_CONTENT')
const rawShared = await evalExport('src/shared.js.ts', 'SHARED_JS')
const rawAdmin = await evalExport('src/admin.script.ts', 'ADMIN_CLIENT_SCRIPT')

const css = (await esbuild.transform(rawCss, { loader: 'css', minify: true })).code
// 关键：minifyIdentifiers 必须关掉 —— 页面里 88 处内联 onclick="fn()" 依赖顶层函数名
const jsOpts = { loader: 'js', minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false }
const sharedJs = (await esbuild.transform(rawShared, jsOpts)).code
const adminJs = (await esbuild.transform(rawAdmin, jsOpts)).code

const cssAsset = emitAsset('app', 'css', css)
const sharedAsset = emitAsset('shared', 'js', sharedJs)
const adminAsset = emitAsset('admin', 'js', adminJs)
copyFileSync(join(root, 'index.html'), join(dist, 'index.html'))

// ── 2) 打包 Node server，注入资源 URL ────────────────────────────────────────
await esbuild.build({
  entryPoints: [join(root, 'src', 'node.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  inject: [join(root, 'src', 'polyfill.ts')],
  outfile: join(dist, 'server.js'),
  define: {
    __ASSET_CSS__: JSON.stringify(cssAsset.url),
    __ASSET_SHARED_JS__: JSON.stringify(sharedAsset.url),
    __ASSET_ADMIN_JS__: JSON.stringify(adminAsset.url),
  },
  logLevel: 'warning',
})

const kb = (n) => (n / 1024).toFixed(1) + ' KiB'
console.log('资源   ' + cssAsset.url + '  ' + kb(cssAsset.bytes) + '  (原始 ' + kb(Buffer.byteLength(rawCss)) + ')')
console.log('       ' + sharedAsset.url + '  ' + kb(sharedAsset.bytes))
console.log('       ' + adminAsset.url + '  ' + kb(adminAsset.bytes) + '  (原始 ' + kb(Buffer.byteLength(rawAdmin)) + ')')
console.log('server ' + kb(readFileSync(join(dist, 'server.js')).length))
console.log('构建完成 -> ' + dist)