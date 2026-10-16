export interface ShotPlacement {
  scrollTop: number
  viewHeight: number
  imageHeight: number
}

/**
 * How many pixels at the bottom of the next shot are new.
 * Null when the scroll position was not stored and the caller should match pixels.
 */
export function scrollAdvance(previous: ShotPlacement, next: ShotPlacement): number | null {
  if (previous.viewHeight < 2 || next.viewHeight < 2 || next.imageHeight < 2) return null
  const delta = next.scrollTop - previous.scrollTop
  if (delta < -2) return next.imageHeight
  if (delta <= 2) return 0
  const advance = Math.round(delta * (next.imageHeight / next.viewHeight))
  if (advance < 1) return 0
  if (advance >= next.imageHeight - 1) return next.imageHeight
  return advance
}

/**
 * Pick the vertical shift whose overlapping rows agree.
 * `advance` is the height of the new strip at the bottom of the next shot.
 * A weak match falls back to the scroll estimate, or the whole frame when there is no estimate.
 */
export function matchAdvance(prevRows: number[], nextRows: number[], estimate: number | null): number {
  const height = nextRows.length
  if (height < 2 || prevRows.length < 2) return Math.max(height, 0)
  const guess = clamp(Math.round(estimate ?? height * 0.82), 0, height)
  const radius = estimate === null ? Math.round(height * 0.35) : Math.max(16, Math.round(height * 0.18))
  let best = guess
  let bestScore = Number.POSITIVE_INFINITY
  const from = Math.max(0, guess - radius)
  const to = Math.min(height - 12, guess + radius)
  for (let advance = from; advance <= to; advance += 2) {
    const value = seamScore(prevRows, nextRows, advance) + Math.abs(advance - guess) * 0.015
    if (value < bestScore) {
      bestScore = value
      best = advance
    }
  }
  for (let advance = Math.max(0, best - 2); advance <= Math.min(height - 12, best + 2); advance += 1) {
    const value = seamScore(prevRows, nextRows, advance) + Math.abs(advance - guess) * 0.015
    if (value < bestScore) {
      bestScore = value
      best = advance
    }
  }
  if (!Number.isFinite(bestScore) || bestScore > 12) {
    return estimate === null ? height : clamp(Math.round(estimate), 0, height)
  }
  return best
}

export function seamScore(prevRows: number[], nextRows: number[], advance: number): number {
  const overlap = nextRows.length - advance
  if (overlap < 12 || advance < 0) return Number.POSITIVE_INFINITY
  const skip = Math.min(80, Math.max(8, Math.floor(overlap * 0.2)))
  let diff = 0
  let count = 0
  for (let row = skip; row < overlap - 2; row += 3) {
    const prev = prevRows[row + advance]
    const next = nextRows[row]
    if (prev === undefined || next === undefined) continue
    diff += Math.abs(prev - next)
    count += 1
  }
  if (count < 4) return Number.POSITIVE_INFINITY
  return diff / count
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
