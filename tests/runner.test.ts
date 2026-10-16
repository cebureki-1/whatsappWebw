import { describe, expect, it } from 'vitest'
import { runOneStep, type ArchivePorts } from '../src/archive/runner'
import { createJob } from '../src/job'
import type { ContentRequest, ContentResponse } from '../src/protocol'
import type { Geometry, JobCheckpoint } from '../src/types'

const geometry: Geometry = {
  viewportWidth: 1000,
  viewportHeight: 800,
  devicePixelRatio: 1,
  rect: { x: 280, y: 70, width: 680, height: 560 },
}

const items = [
  { id: 'a', date: '2026-10-01' },
  { id: 'b', date: '2026-10-02' },
  { id: 'c', date: '2026-10-03' },
  { id: 'd', date: '2026-10-04' },
]

function createFake(options?: { chatKey?: string; switchChatOnProbe?: boolean; oldestOnly?: boolean }) {
  let index = 2
  let probes = 0
  const size = 2
  const chatKey = options?.chatKey ?? 'Анна'
  const visible = () => items.slice(index, index + size)
  const fingerprint = () => {
    const rows = visible()
    return `${rows[0]?.id ?? ''}|${rows[rows.length - 1]?.id ?? ''}|${index}`
  }
  const respond = (request: ContentRequest): ContentResponse => {
    if (request.type === 'STATUS') {
      return {
        ok: true,
        type: 'STATUS',
        status: {
          onWhatsapp: true,
          loggedIn: true,
          chatOpen: true,
          compatible: true,
          chatKey,
          chatTitle: chatKey,
          readableDates: 2,
          messageCount: 2,
          diagnostics: [{ name: 'Сообщения', ok: true, note: 'элементов с data-id: 2' }],
        },
      }
    }
    if (request.type === 'READ_BOUNDARY') {
      return {
        ok: true,
        type: 'READ_BOUNDARY',
        boundaryId: 'd',
        chatKey,
        chatTitle: chatKey,
        geometry,
        oldest: visible()[0]?.date ?? null,
        newest: visible()[visible().length - 1]?.date ?? null,
        fingerprint: fingerprint(),
      }
    }
    if (request.type === 'PROBE') {
      probes += 1
      const key = options?.switchChatOnProbe && probes > 0 ? 'Другой чат' : chatKey
      return { ok: true, type: 'PROBE', chatKey: key, geometry, fingerprint: fingerprint(), visibility: 'visible' }
    }
    if (request.type === 'SCROLL_UP') {
      const before = index
      index = options?.oldestOnly ? 0 : 0
      const oldest = visible()[0]?.date ?? null
      const reachedStart = Boolean(oldest && oldest <= request.start)
      return {
        ok: true,
        type: 'SCROLL_UP',
        reachedStart,
        historyExhausted: index === before,
        progressed: index !== before,
        oldest,
        newest: visible()[visible().length - 1]?.date ?? null,
        chatKey,
        fingerprint: fingerprint(),
        ambiguousCount: 0,
        settled: true,
      }
    }
    if (request.type === 'ALIGN_START') {
      return { ok: true, type: 'ALIGN_START', chatKey, fingerprint: fingerprint(), warning: null, geometry, settled: true }
    }
    if (request.type === 'CAPTURE_CONTEXT') {
      const rows = visible()
      const boundary = rows.some((row) => row.id === 'd') ? 'full' : 'absent'
      return {
        ok: true,
        type: 'CAPTURE_CONTEXT',
        context: {
          chatKey,
          geometry,
          fingerprint: fingerprint(),
          scrollTop: index * 100,
          oldest: rows[0]?.date ?? null,
          newest: rows[rows.length - 1]?.date ?? null,
          containsBoundary: boundary,
          passedEnd: false,
          atBottom: index + size >= items.length,
          trimTop: 0,
          trimBottom: 0,
          trimReliable: true,
          coverageWarning: null,
          ambiguousCount: 0,
          leadingClear: (rows[0]?.date ?? '') >= request.start,
          settled: true,
        },
      }
    }
    if (request.type === 'SCROLL_DOWN') {
      const before = index
      index = Math.min(items.length - size, index + 1)
      return { ok: true, type: 'SCROLL_DOWN', progressed: index !== before, fingerprint: fingerprint(), chatKey, settled: true }
    }
    return { ok: false, errorCode: 'INTERNAL', message: 'Неизвестная команда' }
  }
  return { respond }
}

function portsFor(respond: (request: ContentRequest) => ContentResponse, visibility: 'visible' | 'other_tab' = 'visible') {
  const saved: number[] = []
  const ports: ArchivePorts = {
    now: () => '2026-10-08T12:00:00.000Z',
    sleep: async () => undefined,
    isTargetVisible: async () => visibility,
    send: async (_tabId, request) => respond(request),
    capture: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }),
    crop: async (input) => input.png,
    saveFrame: async (frame) => {
      saved.push(frame.index)
    },
  }
  return { ports, saved }
}

async function drive(job: JobCheckpoint, ports: ArchivePorts): Promise<JobCheckpoint> {
  let current = job
  for (let step = 0; step < 30; step += 1) {
    const result = await runOneStep(current, ports)
    current = result.job
    if (result.outcome !== 'continue') return current
  }
  return current
}

function newJob(): JobCheckpoint {
  return createJob({
    now: '2026-10-08T12:00:00.000Z',
    tabId: 7,
    windowId: 3,
    start: '2026-10-02',
    end: '2026-10-04',
    format: 'both',
    archiveName: 'Анна',
  })
}

describe('сценарий архивации без браузера', () => {
  it('сначала ищет дату, затем сохраняет кадры по порядку до границы', async () => {
    const fake = createFake()
    const { ports, saved } = portsFor(fake.respond)
    const done = await drive(newJob(), ports)
    expect(done.phase).toBe('completed')
    expect(done.captureComplete).toBe(true)
    expect(saved).toEqual([1, 2, 3])
    expect(done.chatKey).toBe('Анна')
    expect(done.boundaryMessageId).toBe('d')
    expect(done.actualStart).toBe('2026-10-02')
  })

  it('не снимает другую вкладку', async () => {
    const fake = createFake()
    const { ports, saved } = portsFor(fake.respond, 'other_tab')
    const done = await drive(newJob(), ports)
    expect(done.phase).toBe('paused')
    expect(done.pauseReason).toBe('tab')
    expect(saved).toEqual([])
  })

  it('не продолжает автоматически, если чат сменился', async () => {
    const fake = createFake({ switchChatOnProbe: true })
    const { ports, saved } = portsFor(fake.respond)
    const done = await drive(newJob(), ports)
    expect(done.phase).toBe('paused')
    expect(done.pauseReason).toBe('chat')
    expect(saved).toEqual([])
  })

  it('сообщает, что выбранной даты нет, и не создаёт пустой архив', async () => {
    const respond = (request: ContentRequest): ContentResponse => {
      if (request.type === 'STATUS') {
        return {
          ok: true,
          type: 'STATUS',
          status: {
            onWhatsapp: true,
            loggedIn: true,
            chatOpen: true,
            compatible: true,
            chatKey: 'Анна',
            chatTitle: 'Анна',
            readableDates: 1,
            messageCount: 1,
            diagnostics: [],
          },
        }
      }
      if (request.type === 'READ_BOUNDARY') {
        return {
          ok: true,
          type: 'READ_BOUNDARY',
          boundaryId: 'd',
          chatKey: 'Анна',
          chatTitle: 'Анна',
          geometry,
          oldest: '2026-10-10',
          newest: '2026-10-10',
          fingerprint: 'same',
        }
      }
      if (request.type === 'PROBE') {
        return { ok: true, type: 'PROBE', chatKey: 'Анна', geometry, fingerprint: 'same', visibility: 'visible' }
      }
      if (request.type === 'SCROLL_UP') {
        return {
          ok: true,
          type: 'SCROLL_UP',
          reachedStart: false,
          historyExhausted: true,
          progressed: false,
          oldest: '2026-10-10',
          newest: '2026-10-10',
          chatKey: 'Анна',
          fingerprint: 'same',
          ambiguousCount: 0,
          settled: true,
        }
      }
      return { ok: false, errorCode: 'INTERNAL', message: 'Лишний вызов' }
    }
    const { ports, saved } = portsFor(respond)
    const done = await drive(newJob(), ports)
    expect(done.phase).toBe('awaiting_partial_decision')
    expect(done.frameCount).toBe(0)
    expect(saved).toEqual([])
    expect(done.statusHint).toMatch(/не найдена/)
  })
})
