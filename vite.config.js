import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  return {
    base: './',
    plugins: [vue(), {
      name: 'runtime-meta',
      transformIndexHtml: () => {
        const tags = Object.entries({ apiBase: env.API_BASE, siteTitle: env.TITLE, backgroundImage: env.BACKGROUND_IMAGE }).filter(([, value]) => value).map(([name, value]) => ({ tag: 'meta', attrs: { name, content: escape(value) }, injectTo: 'head' }))
        if (env.CSP_API || env.CSP_STATIC) {
          const origins = value => String(value || '').split(/[\s,]+/).filter(Boolean).map(value => new URL(value).origin)
          const api = [...new Set([...origins(env.API_BASE), ...origins(env.CSP_API)])]
          const statics = origins(env.CSP_STATIC)
          const ws = api.map(origin => origin.replace(/^http/, 'ws'))
          const csp = `default-src 'self'; connect-src 'self' ${[...api, ...ws].join(' ')} https://challenges.cloudflare.com; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com ${statics.join(' ')}; style-src 'self' 'unsafe-inline' ${statics.join(' ')}; img-src 'self' data: ${[...api, ...statics].join(' ')}; font-src 'self' ${statics.join(' ')}; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'`
          tags.push({ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' })
        }
        return tags
      }
    }],
    build: { assetsDir: 'assets', emptyOutDir: true }
  }
})
