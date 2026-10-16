import { describe, expect, it } from 'vitest'
import { contentHeight, imageScale, maxStripPixels, PAGE_HEIGHT } from '../src/export/layout'
import { matchAdvance, scrollAdvance } from '../src/export/stitch'

function ramp(start: number, length: number): number[] {
  return Array.from({ length }, (_, index) => start + index)
}

describe('склейка ленты', () => {
  it('по прокрутке оставляет только новый низ кадра', () => {
    const advance = scrollAdvance(
      { scrollTop: 0, viewHeight: 500, imageHeight: 1000 },
      { scrollTop: 410, viewHeight: 500, imageHeight: 1000 },
    )
    expect(advance).toBe(820)
  })

  it('нулевая прокрутка не добавляет повтор', () => {
    expect(
      scrollAdvance(
        { scrollTop: 40, viewHeight: 500, imageHeight: 1000 },
        { scrollTop: 41, viewHeight: 500, imageHeight: 1000 },
      ),
    ).toBe(0)
  })

  it('находит шов по совпавшим строкам и не берёт весь следующий кадр', () => {
    const previous = ramp(0, 200)
    const next = ramp(160, 200)
    expect(matchAdvance(previous, next, 164)).toBe(160)
  })

  it('кусок ленты умещается на лист А4', () => {
    const width = 1000
    const scale = imageScale(width)
    const drawn = maxStripPixels(width) * scale
    expect(PAGE_HEIGHT).toBeCloseTo(841.89, 2)
    expect(drawn).toBeLessThanOrEqual(contentHeight() + 0.01)
    expect(drawn).toBeGreaterThan(contentHeight() - scale)
  })

  it('при слабом совпадении доверяет оценке прокрутки', () => {
    const noise = Array.from({ length: 200 }, () => 40)
    const other = Array.from({ length: 200 }, (_, index) => (index * 17) % 90)
    expect(matchAdvance(noise, other, 150)).toBe(150)
  })
})
