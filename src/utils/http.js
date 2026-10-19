import { reactive } from 'vue'
import { adminUrl } from './config.js'

export const security = reactive({ challenge: null, error: '' })
const configs = new Map()
const proofs = new Map()
const verifyJobs = new Map()
let scriptPromise
let challengeQueue = Promise.resolve()
let redirecting = false
export const proofKey = base => `cfsm.turnstile:${base}`
export const authToken = () => localStorage.getItem('jwt_token') || ''
export function login(base) {
  localStorage.removeItem('jwt_token')
  if (!redirecting) { redirecting = true; location.assign(adminUrl(base)) }
}
export function clearProof(base) { proofs.delete(base); localStorage.removeItem(proofKey(base)) }
export function cachedProof(base) {
  if (proofs.has(base)) return proofs.get(base)
  try {
    const saved = JSON.parse(localStorage.getItem(proofKey(base)))
    if (saved?.expires > Date.now()) { proofs.set(base, saved.token); return saved.token }
  } catch { /* Invalid stored values are discarded. */ }
  localStorage.removeItem(proofKey(base))
  return ''
}
function saveProof(base, token) {
  proofs.set(base, token)
  localStorage.setItem(proofKey(base), JSON.stringify({ token, expires: Date.now() + 55 * 60000 }))
}
export function turnstileScript() {
  if (window.turnstile) return Promise.resolve()
  return scriptPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = resolve
    script.onerror = () => { scriptPromise = null; reject(new Error('Turnstile script failed to load')) }
    document.head.append(script)
  })
}
async function fetchJson(base, path, { method = 'GET', body, proof, token } = {}) {
  const headers = {}
  if (authToken()) headers.Authorization = `Bearer ${authToken()}`
  if (proof) headers['X-Turnstile-Verified'] = proof
  else if (token) headers['X-Turnstile-Token'] = token
  if (body) headers['Content-Type'] = 'application/json'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(`${base}${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers, credentials: 'include', signal: controller.signal })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401) login(base)
      if (response.status === 403) clearProof(base)
      throw Object.assign(new Error(data.error || data.message || `HTTP ${response.status}`), { status: response.status })
    }
    if (data?.turnstile_verified) saveProof(base, data.turnstile_verified)
    return data
  } finally { clearTimeout(timer) }
}
// One bootstrap request per backend; route/component changes share this promise.
export function getConfig(base) {
  if (!configs.has(base)) configs.set(base, fetchJson(base, '/api/config'))
  return configs.get(base)
}
export function ensureProof(base, config) {
  if (config.turnstile_enabled !== true) return Promise.resolve('')
  if (cachedProof(base)) return Promise.resolve(cachedProof(base))
  if (verifyJobs.has(base)) return verifyJobs.get(base)
  const job = challengeQueue.catch(() => {}).then(async () => {
    const token = await new Promise((resolve, reject) => {
      security.challenge = { base, siteKey: config.turnstile_site_key, resolve, reject }
    })
    // Explicitly authorized exception: exchange a successful challenge for a reusable proof.
    const result = await fetchJson(base, '/api/config', { token })
    if (!result.turnstile_verified) throw new Error('Turnstile verification did not return a reusable credential')
    return result.turnstile_verified
  }).finally(() => { security.challenge = null; verifyJobs.delete(base) })
  verifyJobs.set(base, job)
  challengeQueue = job
  return job
}
export async function request(base, config, path, options = {}) {
  if (config.is_public !== true && !config.authorization && !authToken()) { login(base); throw new Error('Login required') }
  for (let attempt = 0; attempt < 2; attempt++) {
    const proof = await ensureProof(base, config)
    try { return await fetchJson(base, path, { ...options, proof }) }
    catch (error) {
      if (error.status !== 403 || config.turnstile_enabled !== true || attempt === 1) throw error
    }
  }
}
