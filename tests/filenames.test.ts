import { describe, expect, it } from 'vitest'
import { archiveBaseName, frameFileName, partSuffix, safeFileName } from '../src/filenames'

describe('имена файлов Windows', () => {
  it('убирает запрещённые символы и хвостовые точки', () => {
    expect(safeFileName('чат: Анна/Иван*?. ')).toBe('чат Анна Иван')
    expect(safeFileName('   ')).toBe('WhatsApp-chat')
  })

  it('нумерует PNG и помечает неполный архив', () => {
    expect(frameFileName(1)).toBe('0001.png')
    expect(frameFileName(12)).toBe('0012.png')
    expect(archiveBaseName('Переписка', true)).toBe('Переписка-неполный')
    expect(partSuffix(2, 3)).toBe('-часть-02')
    expect(partSuffix(1, 1)).toBe('')
  })
})
