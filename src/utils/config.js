export const meta = name => document.querySelector(`meta[name="${name}"]`)?.content || ''
export function getApiBases() {
  const values = (meta('apiBase') || location.origin).split(',').map(s => s.trim()).filter(Boolean)
  return [...new Set(values.map(value => {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('apiBase must contain HTTP(S) origins only')
    return url.origin
  }))]
}
export const adminUrl = base => `${base}/admin#/admin`
export const assetUrl = (base, path) => `${base}${path}`
