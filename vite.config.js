import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  return {
    base: './',
    plugins: [vue(), {
      name: 'runtime-meta',
      transformIndexHtml(html) {
        const tags = ['API_BASE', 'BACKGROUND_IMAGE', 'CSP_API', 'CSP_STATIC'].map(key => ({
          tag: 'meta', attrs: { name: { API_BASE: 'apiBase', BACKGROUND_IMAGE: 'backgroundImage', CSP_API: 'cspApi', CSP_STATIC: 'cspStatic' }[key], content: env[key] || '' }, injectTo: 'head'
        }))
        const sources = value => String(value || '').split(/[\s,]+/).filter(Boolean).map(value => {
          if (['https:', 'http:', 'wss:', 'ws:'].includes(value)) return value
          const url = new URL(value)
          if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid CSP source')
          return url.origin
        })
        const api = [...new Set(sources(env.API_BASE).flatMap(origin => [origin, origin.replace(/^http/, 'ws')]).concat(sources(env.CSP_API)))]
        const backgroundOrigins = /^https?:\/\//.test(env.BACKGROUND_IMAGE || '') ? sources(new URL(env.BACKGROUND_IMAGE).origin) : []
        const staticSources = [...new Set(sources(env.CSP_STATIC).concat(backgroundOrigins))]
        const policy = `default-src 'self'; connect-src 'self' ${api.join(' ')} https://challenges.cloudflare.com; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com ${staticSources.join(' ')}; style-src 'self' 'unsafe-inline' ${staticSources.join(' ')}; img-src 'self' data: ${[...api.filter(s => s.startsWith('http')), ...staticSources].join(' ')}; font-src 'self' data: ${staticSources.join(' ')}; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'`
        tags.push({ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' })
        return { html: env.TITLE ? html.replace('<title>CF-Server-Monitor</title>', `<title>${escape(env.TITLE)}</title>`) : html, tags }
      }
    }],
    build: { assetsDir: 'assets', emptyOutDir: true },
    test: { environment: 'node', include: ['tests/**/*.test.js'] }
  }
})
