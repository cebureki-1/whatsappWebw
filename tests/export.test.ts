import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildPdf } from '../src/export/pdf'
import { buildZip } from '../src/export/zip'
import type { ArchiveMeta } from '../src/types'

const regular = new Uint8Array(readFileSync('assets/fonts/NotoSans-Regular.ttf'))
const bold = new Uint8Array(readFileSync('assets/fonts/NotoSans-Bold.ttf'))

const meta: ArchiveMeta = {
  archiveName: 'Переписка с Анной',
  chatTitle: 'Анна',
  requestedStart: '2026-10-01',
  requestedEnd: '2026-10-08',
  actualStart: '2026-10-02',
  actualEnd: '2026-10-08',
  exportedAt: '08.10.2026, 12:00:00',
  complete: false,
  incompleteReason: 'Остановлено пользователем.',
  warnings: ['Проверьте фактический охват.'],
  frameCount: 1,
}

describe('экспорт PDF и ZIP', () => {
  it('собирает PDF с кириллицей и страницей снимка', async () => {
    const bytes = await buildPdf({
      fontRegular: regular,
      fontBold: bold,
      meta,
      frames: [{ index: 1, png: tinyPng() }],
      part: 1,
      parts: 1,
    })
    expect(Buffer.from(bytes.subarray(0, 5)).toString('utf8')).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(1).getWidth()).toBeCloseTo(595.28, 1)
    expect(doc.getPage(1).getHeight()).toBeCloseTo(841.89, 1)
  })

  it('кладёт нумерованные PNG и manifest неполного архива', async () => {
    const bytes = await buildZip({
      meta,
      frames: [{ index: 1, capturedAt: '2026-10-08T12:00:00.000Z', scrollTop: 20, png: tinyPng() }],
      part: 1,
      parts: 1,
    })
    const zip = await JSZip.loadAsync(bytes)
    expect(Object.keys(zip.files)).toContain('0001.png')
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as {
      complete: boolean
      incompleteReason: string
      frames: { file: string }[]
      chatTitle: string
    }
    expect(manifest.complete).toBe(false)
    expect(manifest.incompleteReason).toMatch(/Остановлено/)
    expect(manifest.frames[0]?.file).toBe('0001.png')
    expect(manifest.chatTitle).toBe('Анна')
    expect(JSON.stringify(manifest)).not.toContain('СЕКРЕТНОЕ')
  })
})

function tinyPng(): Uint8Array {
  const raw = Buffer.from([0, 20, 140, 110])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}

function crc32(buf: Buffer): number {
  let crc = ~0
  for (let index = 0; index < buf.length; index += 1) {
    crc ^= buf[index]!
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return ~crc >>> 0
}
