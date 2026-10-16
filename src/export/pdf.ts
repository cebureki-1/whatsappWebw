import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { formatDay, parseIsoDate } from '../dates'
import type { ArchiveMeta } from '../types'
import { contentHeight, imageScale, MARGIN_TOP, MARGIN_X, PAGE_HEIGHT, PAGE_WIDTH } from './layout'

export interface PdfFrame {
  index: number
  png: Uint8Array
}

const A4: [number, number] = [PAGE_WIDTH, PAGE_HEIGHT]
const MARGIN = 36

export async function buildPdf(input: {
  fontRegular: Uint8Array
  fontBold: Uint8Array
  meta: ArchiveMeta
  frames: PdfFrame[]
  part: number
  parts: number
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const regular = await doc.embedFont(input.fontRegular, { subset: true })
  const bold = await doc.embedFont(input.fontBold, { subset: true })
  const totalPages = 1 + input.frames.length
  drawTitle(doc.addPage(A4), regular, bold, input, totalPages)
  for (const frame of input.frames) {
    const image = await doc.embedPng(frame.png)
    const scale = Math.min(imageScale(image.width), contentHeight() / image.height)
    const width = image.width * scale
    const height = image.height * scale
    const page = doc.addPage(A4)
    page.drawImage(image, {
      x: MARGIN_X,
      y: PAGE_HEIGHT - MARGIN_TOP - height,
      width,
      height,
    })
    drawFooter(page, regular, frame.index + 1, totalPages)
  }
  doc.setTitle(input.meta.archiveName)
  doc.setAuthor('WhatsApp Chat Archive')
  doc.setCreationDate(new Date(input.meta.exportedAt))
  return doc.save()
}

function drawTitle(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  input: { meta: ArchiveMeta; part: number; parts: number },
  totalPages: number,
): void {
  const meta = input.meta
  let y = A4[1] - MARGIN
  y = line(page, bold, 20, 'Архив чата WhatsApp', MARGIN, y, A4[0] - MARGIN * 2)
  y -= 8
  const rows = [
    `Чат: ${meta.chatTitle || 'без названия'}`,
    `Запрошенный период: ${showDay(meta.requestedStart)} — ${meta.requestedEnd ? showDay(meta.requestedEnd) : 'до последнего сообщения на момент запуска'}`,
    `Фактический охват: ${meta.actualStart ? showDay(meta.actualStart) : 'не определён'} — ${meta.actualEnd ? showDay(meta.actualEnd) : 'не определён'}`,
    `Время экспорта: ${meta.exportedAt}`,
    `Кадров в этой части: ${meta.frameCount}`,
    'Соседние снимки склеены без повтора. Лента разрезана на листы А4: низ страницы продолжается наверху следующей.',
    input.parts > 1 ? `Часть ${input.part} из ${input.parts}` : '',
    `Полнота: ${meta.complete ? 'полный архив запрошенного доступного диапазона' : 'неполный архив'}`,
    meta.incompleteReason ? `Причина: ${meta.incompleteReason}` : '',
    ...meta.warnings.slice(0, 8).map((warning) => `Предупреждение: ${warning}`),
    'Архив собран локально из скриншотов экрана. Он не подтверждает подлинность переписки и не имеет юридической силы.',
  ].filter(Boolean)
  for (const row of rows) {
    y = paragraph(page, regular, 11, row, MARGIN, y, A4[0] - MARGIN * 2)
    y -= 6
  }
  drawFooter(page, regular, 1, totalPages)
}

function showDay(iso: string): string {
  const day = parseIsoDate(iso)
  return day ? formatDay(day) : iso
}

function paragraph(page: PDFPage, font: PDFFont, size: number, text: string, x: number, y: number, width: number): number {
  for (const row of wrap(text, font, size, width)) {
    page.drawText(row, { x, y: y - size, size, font, color: rgb(0.1, 0.16, 0.15) })
    y -= size + 4
  }
  return y
}

function line(page: PDFPage, font: PDFFont, size: number, text: string, x: number, y: number, width: number): number {
  return paragraph(page, font, size, text, x, y, width)
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next
    else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

function drawFooter(page: PDFPage, font: PDFFont, pageNumber: number, total: number): void {
  const label = `Стр. ${pageNumber} из ${total}`
  const width = font.widthOfTextAtSize(label, 10)
  page.drawText(label, {
    x: (A4[0] - width) / 2,
    y: 18,
    size: 10,
    font,
    color: rgb(0.2, 0.35, 0.32),
  })
}
