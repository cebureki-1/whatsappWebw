import { describe, expect, it } from 'vitest'
import { coverDownward, scrollWindow } from '../src/archive/scroll-logic'

describe('виртуализированная лента', () => {
  it('движением вниз с перекрытием показывает каждое сообщение хотя бы один раз', () => {
    const total = 50
    const frames = coverDownward(total, 10)
    const seen = new Set(frames.flat())
    expect(seen.size).toBe(total)
    expect(frames.length).toBeGreaterThan(1)
    const step = frames[1]![0]! - frames[0]![0]!
    expect(step / 10).toBeGreaterThanOrEqual(0.8)
    expect(step / 10).toBeLessThanOrEqual(0.85)
  })

  it('вверх доходит до начала истории и останавливается без ложного прогресса', () => {
    let current = { start: 40, size: 10 }
    let guard = 0
    while (guard < 20) {
      const moved = scrollWindow(50, current, 'up')
      if (!moved.progressed) {
        expect(moved.hitEdge).toBe(true)
        expect(moved.window.start).toBe(0)
        break
      }
      current = moved.window
      guard += 1
    }
    expect(current.start).toBe(0)
  })

  it('не отбрасывает сообщения только из-за одинакового текста: модель хранит разные id', () => {
    const frames = coverDownward(4, 2)
    const ids = frames.flat()
    expect(ids.filter((id) => id === 1).length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(4)
  })
})
