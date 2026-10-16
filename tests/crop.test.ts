import { describe, expect, it } from 'vitest'
import { computeEdgeTrim, scrollDelta } from '../src/archive/scroll-logic'
import { computeCropRect, geometryChanged } from '../src/crop'
import { LIMITS } from '../src/limits'
import type { Geometry } from '../src/types'

describe('обрезка снимка', () => {
  it('переводит CSS-прямоугольник в пиксели снимка с дробным масштабом', () => {
    const crop = computeCropRect({
      imageWidth: 1250,
      imageHeight: 1000,
      viewportWidth: 1000,
      viewportHeight: 800,
      rect: { x: 300, y: 100, width: 640, height: 560 },
    })
    expect(crop).toMatchObject({ x: 375, y: 125, width: 800, height: 700 })
    expect(crop.scaleX).toBeCloseTo(1.25)
    expect(crop.scaleY).toBeCloseTo(1.25)
  })

  it('учитывает обрезку краёв и не выходит за снимок', () => {
    const crop = computeCropRect({
      imageWidth: 1000,
      imageHeight: 800,
      viewportWidth: 1000,
      viewportHeight: 800,
      rect: { x: 100, y: 50, width: 400, height: 300 },
      trimTop: 20,
      trimBottom: 30,
    })
    expect(crop).toMatchObject({ x: 100, y: 70, width: 400, height: 250 })
  })

  it('останавливается, если масштаб по осям разошёлся', () => {
    expect(() =>
      computeCropRect({
        imageWidth: 2000,
        imageHeight: 800,
        viewportWidth: 1000,
        viewportHeight: 800,
        rect: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ).toThrow(/Масштаб/)
  })

  it('замечает смену размера окна и масштаба', () => {
    const base: Geometry = {
      viewportWidth: 1200,
      viewportHeight: 800,
      devicePixelRatio: 1,
      rect: { x: 10, y: 20, width: 700, height: 500 },
    }
    expect(geometryChanged(base, base)).toBe(false)
    expect(geometryChanged(base, { ...base, devicePixelRatio: 1.25 })).toBe(true)
    expect(geometryChanged(base, { ...base, viewportWidth: 900 })).toBe(true)
  })
})

describe('края периода и шаг прокрутки', () => {
  it('прокручивает на 80–85% высоты', () => {
    expect(LIMITS.scrollPortion).toBeGreaterThanOrEqual(0.8)
    expect(LIMITS.scrollPortion).toBeLessThanOrEqual(0.85)
    expect(scrollDelta(1000) / 1000).toBeGreaterThanOrEqual(0.8)
    expect(scrollDelta(1000) / 1000).toBeLessThanOrEqual(0.85)
  })

  it('срезает только надёжные сообщения до и после периода', () => {
    const trim = computeEdgeTrim(
      [
        { top: 0, bottom: 40, status: 'before' },
        { top: 48, bottom: 120, status: 'in' },
        { top: 130, bottom: 180, status: 'after' },
      ],
      200,
      { leading: true, trailing: true },
    )
    expect(trim.trimTop).toBe(48)
    expect(trim.trimBottom).toBe(80)
    expect(trim.reliable).toBe(true)
  })

  it('не срезает край, если рядом есть сообщение без понятной даты', () => {
    const trim = computeEdgeTrim(
      [
        { top: 0, bottom: 30, status: 'unknown' },
        { top: 40, bottom: 100, status: 'in' },
      ],
      120,
      { leading: true, trailing: false },
    )
    expect(trim.trimTop).toBe(0)
    expect(trim.reliable).toBe(false)
    expect(trim.warning).toBeTruthy()
  })
})
