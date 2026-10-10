/**
 * 静态资源 URL（构建时由 esbuild --define 注入带内容哈希的文件名，见 scripts/build-node.mjs）。
 *
 * 为什么不再内联 CSS/JS：
 *   1. HTML 是 no-store 的，内联意味着每次访问后台都要重传同一份 CSS/脚本（合计约 120KB）；
 *   2. 外链文件可被浏览器长期缓存（immutable 一年期），重复访问零传输；
 *   3. 未注入 define 的构建路径（如历史 build:pages）回退为空串，页面模板自动改回内联，保证任何构建方式都能跑。
 */
declare const __ASSET_CSS__: string | undefined
declare const __ASSET_SHARED_JS__: string | undefined
declare const __ASSET_ADMIN_JS__: string | undefined

export const ASSET_CSS: string = typeof __ASSET_CSS__ !== 'undefined' ? __ASSET_CSS__ : ''
export const ASSET_SHARED_JS: string = typeof __ASSET_SHARED_JS__ !== 'undefined' ? __ASSET_SHARED_JS__ : ''
export const ASSET_ADMIN_JS: string = typeof __ASSET_ADMIN_JS__ !== 'undefined' ? __ASSET_ADMIN_JS__ : ''

/** 样式注入：有外链文件用 <link>（可缓存），否则回退内联 */
export function cssTag(fallbackCss: string): string {
  return ASSET_CSS
    ? `<link rel="stylesheet" href="${ASSET_CSS}">`
    : `<style>${fallbackCss}</style>`
}

/** 脚本注入：有外链文件用 <script src>，否则回退内联（保留顶层函数名，页面大量内联 onclick 依赖它们） */
export function scriptTag(url: string, inlineJs: string): string {
  return url
    ? `<script src="${url}"></script>`
    : `<script>${inlineJs}</script>`
}
