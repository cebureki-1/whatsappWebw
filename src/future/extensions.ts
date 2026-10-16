/**
 * Точки расширения второго этапа. Кнопок и реализации нет:
 * скрытие номеров должно закрашивать пиксели в экспортируемых PNG
 * и давать предпросмотр с ручной правкой; OCR и Word остаются локальными.
 */

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PhoneRedaction {
  id: 'phone-redaction'
  suggest(png: Uint8Array): Promise<PixelRect[]>
  apply(png: Uint8Array, regions: PixelRect[]): Promise<Uint8Array>
}

export interface OcrHit {
  frameIndex: number
}

export interface LocalOcrIndex {
  id: 'local-ocr'
  indexFrame(frameIndex: number, png: Uint8Array): Promise<void>
  search(query: string): Promise<OcrHit[]>
}

export interface WordExporter {
  id: 'docx'
  exportArchive(input: { title: string; frames: { index: number; png: Uint8Array }[] }): Promise<Uint8Array>
}
