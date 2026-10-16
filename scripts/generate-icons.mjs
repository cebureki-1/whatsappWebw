import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'public', 'icons')
mkdirSync(dir, { recursive: true })

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size)
      const i = row + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function iconPixel(x, y, size) {
  const px = x + 0.5
  const py = y + 0.5
  const radius = size * 0.22
  const inset = size * 0.04
  const left = inset
  const top = inset
  const right = size - inset
  const bottom = size - inset
  const inside = rounded(px, py, left, top, right, bottom, radius)
  if (!inside) return [0, 0, 0, 0]
  const green = px > left + size * 0.08 && py > top + size * 0.55
  if (page(px, py, size) || bubble(px, py, size)) return [255, 255, 255, 255]
  return green ? [18, 140, 126, 255] : [14, 122, 110, 255]
}

function rounded(x, y, l, t, r, b, rad) {
  if (x < l || y < t || x > r || y > b) return false
  const cx = x < l + rad ? l + rad : x > r - rad ? r - rad : x
  const cy = y < t + rad ? t + rad : y > b - rad ? b - rad : y
  if (cx === x || cy === y) return true
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= rad * rad
}

function page(x, y, size) {
  const l = size * 0.28
  const t = size * 0.22
  const r = size * 0.62
  const b = size * 0.78
  if (x < l || x > r || y < t || y > b) return false
  const fold = size * 0.12
  if (x > r - fold && y < t + fold) {
    return y > t + (x - (r - fold))
  }
  const line = size * 0.045
  const gap = size * 0.11
  for (let i = 0; i < 3; i++) {
    const ly = t + size * 0.28 + i * gap
    if (y > ly && y < ly + line && x > l + size * 0.08 && x < r - size * 0.1) return false
  }
  return true
}

function bubble(x, y, size) {
  const cx = size * 0.68
  const cy = size * 0.68
  const rx = size * 0.16
  const ry = size * 0.12
  const nx = (x - cx) / rx
  const ny = (y - cy) / ry
  if (nx * nx + ny * ny <= 1) return true
  const tx = size * 0.56
  const ty = size * 0.78
  return x > tx && x < tx + size * 0.08 && y > cy && y < ty && y < cy + (x - tx) * 1.8
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(dir, `icon${size}.png`), png(size, iconPixel))
}
