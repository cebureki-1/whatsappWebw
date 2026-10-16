import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
rmSync(resolve(root, 'dist'), { recursive: true, force: true })

await build({ configFile: resolve(root, 'vite.config.ts') })
await build({ configFile: resolve(root, 'vite.content.config.ts') })
await build({ configFile: resolve(root, 'vite.sw.config.ts') })
writeFileSync(resolve(root, 'dist', 'manifest.json'), distManifest(resolve(root, 'manifest.json')))
console.log('Сборка готова: dist/')

function distManifest(sourcePath) {
  const manifest = JSON.parse(readFileSync(sourcePath, 'utf8'))
  return `${JSON.stringify(stripDistPrefix(manifest), null, 2)}\n`
}

function stripDistPrefix(value) {
  if (typeof value === 'string') return value.startsWith('dist/') ? value.slice('dist/'.length) : value
  if (Array.isArray(value)) return value.map(stripDistPrefix)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripDistPrefix(item)]))
  }
  return value
}
