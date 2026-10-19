import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]) }
describe('theme boundaries', () => {
  it('uses only the six permitted API paths and no REST polling', () => {
    const source = files('src').map(path => readFileSync(path, 'utf8')).join('\n')
    const paths = [...new Set(source.match(/\/api\/[a-z_]+(?:\/[a-z_]+)?/g))].sort()
    expect(paths).toEqual(['/api/config', '/api/history/all', '/api/server', '/api/servers', '/api/theme_options', '/api/ws'].sort())
    expect(source).not.toContain('setInterval')
    expect(source).not.toMatch(/location\.reload/)
    expect(source).not.toMatch(/\/admin\/api|save_settings|updateDatabase|clearHistory/)
  })
  it('uses hash routes, the built-in admin path, and relative build assets', () => {
    expect(readFileSync('src/router/index.js', 'utf8')).toContain('createWebHashHistory')
    expect(readFileSync('src/utils/config.js', 'utf8')).toContain('/admin#/admin')
    expect(readFileSync('vite.config.js', 'utf8')).toContain("base: './'")
  })
  it('preserves dist branch history without force push', () => {
    const workflow = readFileSync('.github/workflows/pages.yml', 'utf8')
    expect(workflow).toContain('concurrency:')
    expect(workflow).toContain('git log -1 --format=%B "$GITHUB_SHA"')
    expect(workflow).toContain('git commit --allow-empty -F "$message_file"')
    expect(workflow).toContain('git push origin HEAD:dist')
    expect(workflow).not.toMatch(/push\s+.*(?:--force|\s-f\b)|git init/)
    for (const key of ['API_BASE', 'TITLE', 'BACKGROUND_IMAGE', 'CSP_API', 'CSP_STATIC']) expect(workflow).toContain(`secrets.${key}`)
  })
})
