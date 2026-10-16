import { describe, expect, it } from 'vitest'
import { createJob } from '../src/job'
import { applyMachine, isRunningPhase } from '../src/state-machine'

function job() {
  return createJob({
    now: '2026-10-08T00:00:00.000Z',
    tabId: 1,
    windowId: 1,
    start: '2026-10-01',
    end: null,
    format: 'pdf',
    archiveName: 'Чат',
  })
}

describe('переходы задачи', () => {
  it('проходит основной путь до готового архива', () => {
    let current = job()
    expect(current.phase).toBe('validating')
    current = applyMachine(current, { type: 'VALIDATION_OK' }).job
    current = applyMachine(current, { type: 'START_FOUND' }).job
    current = applyMachine(current, { type: 'POSITIONED' }).job
    current = { ...current, frameCount: 2 }
    current = applyMachine(current, { type: 'FRAME_SAVED' }).job
    current = applyMachine(current, { type: 'CAPTURE_FINISHED' }).job
    expect(current.phase).toBe('completed')
    expect(current.captureComplete).toBe(true)
    expect(current.exportAvailable).toBe(true)
    expect(isRunningPhase(current.phase)).toBe(false)
  })

  it('ставит паузу при смене вкладки и не продолжает другой чат', () => {
    let current = applyMachine(job(), { type: 'VALIDATION_OK' }).job
    current = applyMachine(current, { type: 'PAUSE', reason: 'tab' }).job
    expect(current.phase).toBe('paused')
    expect(current.resumePhase).toBe('scrolling_to_start')
    current = applyMachine(current, { type: 'RESUME' }).job
    expect(current.phase).toBe('scrolling_to_start')

    current = applyMachine(current, { type: 'PAUSE', reason: 'chat' }).job
    const resumed = applyMachine(current, { type: 'RESUME' })
    expect(resumed.accepted).toBe(false)
    expect(resumed.job.phase).toBe('paused')
  })

  it('после перезапуска service worker ждёт продолжения', () => {
    const scrolling = applyMachine(job(), { type: 'VALIDATION_OK' }).job
    const restarted = applyMachine(scrolling, { type: 'WORKER_RESTART' })
    expect(restarted.job.phase).toBe('paused')
    expect(restarted.job.pauseReason).toBe('worker_restarted')
    expect(restarted.job.statusHint).toMatch(/перезапуст/)
  })

  it('останавливает задачу и оставляет кадры для неполного экспорта', () => {
    let current = applyMachine(job(), { type: 'VALIDATION_OK' }).job
    current = applyMachine(current, { type: 'START_FOUND' }).job
    current = applyMachine(current, { type: 'POSITIONED' }).job
    current = { ...current, frameCount: 3 }
    const stopped = applyMachine(current, { type: 'STOP' }).job
    expect(stopped.phase).toBe('stopped')
    expect(stopped.incomplete).toBe(true)
    expect(stopped.exportAvailable).toBe(true)
    expect(stopped.frameCount).toBe(3)
  })

  it('предлагает доступный диапазон, если начало не найдено', () => {
    let current = applyMachine(job(), { type: 'VALIDATION_OK' }).job
    current = applyMachine(current, { type: 'START_MISSING' }).job
    expect(current.phase).toBe('awaiting_partial_decision')
    expect(current.incomplete).toBe(true)
    current = applyMachine(current, { type: 'RESUME' }).job
    expect(current.phase).toBe('positioning')
  })

  it('не принимает съёмку из посторонней фазы', () => {
    const idle = { ...job(), phase: 'idle' as const }
    expect(applyMachine(idle, { type: 'CAPTURE_FINISHED' }).accepted).toBe(false)
    expect(applyMachine(idle, { type: 'FRAME_SAVED' }).accepted).toBe(false)
  })
})
