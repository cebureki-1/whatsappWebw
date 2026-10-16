import { runOneStep, type ArchivePorts, type CropInput, type Visibility } from '../archive/runner'
import { computeCropRect } from '../crop'
import { ArchiveError, userMessage } from '../errors'
import { safeFileName } from '../filenames'
import { createJob } from '../job'
import { LIMITS } from '../limits'
import type { ContentRequest, ContentResponse, CropMessage, CropResponse } from '../protocol'
import { applyMachine, isRunningPhase } from '../state-machine'
import { deleteAllFrames, deleteJobFrames, saveFrameRecord } from '../storage/db'
import { clearJob, loadJob, loadSettings, saveJob, saveSettings } from '../storage/checkpoint'
import { compareDays, parseIsoDate } from '../dates'
import type { ExportFormat, JobCheckpoint, PauseReason, Settings } from '../types'

type UiRequest =
  | { source: 'wa-archive'; target: 'worker'; type: 'GET_STATE' }
  | {
      source: 'wa-archive'
      target: 'worker'
      type: 'START'
      start: string
      end: string | null
      format: ExportFormat
      archiveName: string
    }
  | { source: 'wa-archive'; target: 'worker'; type: 'PAUSE' | 'RESUME' | 'STOP' | 'DELETE_DATA' }

type UiResponse = { ok: true; job: JobCheckpoint | null; settings: Settings } | { ok: false; message: string }

let resumedHiddenPause = false
let loopActive = false
let loopPromise: Promise<void> | null = null
let externalPause: { reason: PauseReason; hint: string } | null = null

const ready = reconcile()

const ports: ArchivePorts = {
  now: () => new Date().toISOString(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  isTargetVisible,
  send: sendToContent,
  capture: captureVisible,
  crop: cropShot,
  saveFrame: saveFrameRecord,
}

chrome.runtime.onMessage.addListener((message: UiRequest, _sender, sendResponse: (response: UiResponse) => void) => {
  if (message?.source !== 'wa-archive' || message.target !== 'worker') return undefined
  void handleUi(message)
    .then((response) => sendResponse(response))
    .catch(() => sendResponse({ ok: false, message: userMessage('INTERNAL') }))
  return true
})

chrome.tabs.onActivated.addListener((info) => {
  void noteEnvironment(async () => {
    const job = await loadJob()
    if (!job || !isRunningPhase(job.phase) || info.tabId === job.tabId) return
    externalPause = {
      reason: 'tab',
      hint: 'Активна другая вкладка. Вернитесь к чату WhatsApp, снова откройте значок расширения и нажмите «Продолжить».',
    }
  })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'archive-heartbeat') return
  void reconcile()
})

void chrome.alarms.get('archive-heartbeat').then((alarm) => {
  if (!alarm) void chrome.alarms.create('archive-heartbeat', { periodInMinutes: 1 })
})

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create('archive-heartbeat', { periodInMinutes: 1 })
})

async function noteEnvironment(action: () => Promise<void>): Promise<void> {
  await ready
  await action()
}

async function handleUi(message: UiRequest): Promise<UiResponse> {
  await ready
  switch (message.type) {
    case 'GET_STATE':
      await resumeIfPopupStoleFocus()
      return stateResponse()
    case 'START':
      return startJob(message)
    case 'PAUSE':
      return pauseJob()
    case 'RESUME':
      return resumeJob()
    case 'STOP':
      return stopJob()
    case 'DELETE_DATA':
      return deleteData()
    default:
      return { ok: false, message: userMessage('INTERNAL') }
  }
}

async function startJob(message: Extract<UiRequest, { type: 'START' }>): Promise<UiResponse> {
  const start = parseIsoDate(message.start)
  const end = message.end ? parseIsoDate(message.end) : null
  if (!start) return { ok: false, message: 'Укажите дату начала.' }
  if (message.end && !end) return { ok: false, message: 'Дата окончания указана неверно.' }
  if (end && compareDays(end, start) < 0) return { ok: false, message: userMessage('INVALID_RANGE') }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || tab.windowId === undefined || !tab.url?.startsWith('https://web.whatsapp.com/')) {
    return { ok: false, message: userMessage('NOT_WHATSAPP') }
  }
  const existing = await loadJob()
  if (existing && isRunningPhase(existing.phase)) {
    return { ok: false, message: 'Архивирование уже выполняется.' }
  }
  if (existing?.jobId) await deleteJobFrames(existing.jobId).catch(() => undefined)
  const archiveName = safeFileName(message.archiveName.trim() || 'WhatsApp-чат')
  const job = createJob({
    now: new Date().toISOString(),
    tabId: tab.id,
    windowId: tab.windowId,
    start: message.start,
    end: message.end,
    format: message.format,
    archiveName,
  })
  externalPause = null
  await saveSettings({ format: message.format, archiveName })
  await saveJob(job)
  console.info('[whatsapp-chat-archive]', 'start', job.jobId)
  await pump()
  return stateResponse()
}

async function pauseJob(): Promise<UiResponse> {
  externalPause = { reason: 'user', hint: 'Пауза. Нажмите «Продолжить», чтобы снять задачу с паузы.' }
  const job = await loadJob()
  if (!job) return { ok: false, message: 'Нет активной задачи.' }
  const moved = applyMachine(job, { type: 'PAUSE', reason: 'user' })
  if (!moved.accepted) return { ok: false, message: 'Сейчас поставить на паузу нельзя.' }
  await saveJob({ ...moved.job, statusHint: externalPause.hint, updatedAt: new Date().toISOString() })
  return stateResponse()
}

async function resumeJob(): Promise<UiResponse> {
  const job = await loadJob()
  if (!job) return { ok: false, message: 'Нет задачи для продолжения.' }
  if (job.pauseReason === 'chat') {
    return {
      ok: false,
      message: 'Чат изменился. Автоматически продолжать нельзя. Скачайте сохранённые кадры или начните заново.',
    }
  }
  const moved = applyMachine(job, { type: 'RESUME' })
  if (!moved.accepted) return { ok: false, message: 'Продолжить с этого места нельзя. Запустите архивирование заново или скачайте кадры.' }
  externalPause = null
  await saveJob({ ...moved.job, updatedAt: new Date().toISOString() })
  await pump()
  return stateResponse()
}

async function stopJob(): Promise<UiResponse> {
  externalPause = { reason: 'user', hint: 'Остановлено.' }
  const job = await loadJob()
  if (!job) return { ok: false, message: 'Нет активной задачи.' }
  const moved = applyMachine(job, { type: 'STOP' })
  if (!moved.accepted) return { ok: false, message: 'Останавливать сейчас нечего.' }
  await saveJob({
    ...moved.job,
    statusHint: moved.job.frameCount > 0 ? 'Остановлено. Можно скачать уже сохранённые кадры.' : 'Остановлено.',
    updatedAt: new Date().toISOString(),
  })
  return stateResponse()
}

async function deleteData(): Promise<UiResponse> {
  const job = await loadJob()
  if (job && isRunningPhase(job.phase)) return { ok: false, message: 'Сначала остановите архивирование.' }
  await deleteAllFrames()
  await clearJob()
  externalPause = null
  return stateResponse()
}

async function stateResponse(): Promise<UiResponse> {
  return { ok: true, job: await loadJob(), settings: await loadSettings() }
}

async function pump(): Promise<void> {
  if (loopPromise) return loopPromise
  loopPromise = (async () => {
    loopActive = true
    try {
      while (true) {
        const current = await loadJob()
        if (!current || !isRunningPhase(current.phase)) return
        const pauseBefore = takeExternalPause()
        if (pauseBefore) {
          const moved = applyMachine(current, { type: 'PAUSE', reason: pauseBefore.reason })
          if (moved.accepted) {
            await saveJob({
              ...moved.job,
              statusHint: pauseBefore.hint,
              exportAvailable: current.frameCount > 0,
              updatedAt: new Date().toISOString(),
            })
          }
          return
        }
        const result = await runOneStep(current, ports)
        const pauseAfter = takeExternalPause()
        if (pauseAfter && isRunningPhase(result.job.phase)) {
          const moved = applyMachine(result.job, { type: 'PAUSE', reason: pauseAfter.reason })
          await saveJob({
            ...(moved.accepted ? moved.job : result.job),
            statusHint: pauseAfter.hint,
            exportAvailable: result.job.frameCount > 0,
            updatedAt: new Date().toISOString(),
          })
          return
        }
        await saveJob(result.job)
        if (result.outcome !== 'continue') return
      }
    } catch (error) {
      const current = await loadJob()
      if (current && current.phase !== 'idle') {
        const message = error instanceof ArchiveError ? error.message : userMessage('INTERNAL')
        await saveJob({
          ...current,
          phase: 'error',
          errorCode: error instanceof ArchiveError ? error.code : 'INTERNAL',
          errorDetail: message,
          incomplete: true,
          incompleteReason: message,
          exportAvailable: current.frameCount > 0,
          updatedAt: new Date().toISOString(),
        })
      }
      console.info('[whatsapp-chat-archive]', 'loop-error')
    } finally {
      loopActive = false
      loopPromise = null
    }
  })()
  return loopPromise
}

function takeExternalPause(): { reason: PauseReason; hint: string } | null {
  const pause = externalPause
  externalPause = null
  return pause
}

async function reconcile(): Promise<void> {
  if (loopActive) return
  const job = await loadJob()
  if (!job || !isRunningPhase(job.phase)) return
  const moved = applyMachine(job, { type: 'WORKER_RESTART' })
  if (!moved.accepted) return
  await saveJob({ ...moved.job, updatedAt: new Date().toISOString() })
  console.info('[whatsapp-chat-archive]', 'worker-restart')
}

async function isTargetVisible(tabId: number, windowId: number): Promise<Visibility> {
  if (externalPause?.reason === 'tab') return 'other_tab'
  try {
    const tab = await chrome.tabs.get(tabId)
    if (!tab) return 'closed'
    const [active] = await chrome.tabs.query({ active: true, windowId })
    if (!active || active.id !== tabId) return 'other_tab'
    return 'visible'
  } catch {
    return 'closed'
  }
}

async function resumeIfPopupStoleFocus(): Promise<void> {
  if (resumedHiddenPause) return
  const job = await loadJob()
  if (!job || job.phase !== 'paused' || job.pauseReason !== 'hidden') return
  resumedHiddenPause = true
  if ((await isTargetVisible(job.tabId, job.windowId)) !== 'visible') return
  const moved = applyMachine(job, { type: 'RESUME' })
  if (!moved.accepted) return
  externalPause = null
  await saveJob({ ...moved.job, statusHint: null, updatedAt: new Date().toISOString() })
  await pump()
}

async function sendToContent(tabId: number, request: ContentRequest): Promise<ContentResponse> {
  return withTimeout(deliver(tabId, request), LIMITS.contentTimeoutMs)
}

async function deliver(tabId: number, request: ContentRequest): Promise<ContentResponse> {
  const payload = { source: 'wa-archive', target: 'content', request }
  try {
    const response = (await chrome.tabs.sendMessage(tabId, payload)) as ContentResponse | undefined
    if (!response) throw new Error('empty')
    return response
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: [bundled('content-script.js')] })
    const response = (await chrome.tabs.sendMessage(tabId, payload)) as ContentResponse | undefined
    if (!response) throw new ArchiveError('INTERNAL', 'Страница WhatsApp не ответила. Обновите вкладку.')
    return response
  }
}

async function captureVisible(windowId: number): Promise<Blob> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
  return dataUrlToBlob(dataUrl)
}

async function cropShot(input: CropInput): Promise<Blob> {
  try {
    if (typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function') {
      return await cropInWorker(input)
    }
    return await cropViaOffscreen(input)
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown'
    console.error('[whatsapp-chat-archive] crop', detail)
    throw error
  }
}

async function cropInWorker(input: CropInput): Promise<Blob> {
  const bitmap = await createImageBitmap(input.png)
  try {
    const crop = computeCropRect({
      imageWidth: bitmap.width,
      imageHeight: bitmap.height,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      rect: input.rect,
      trimTop: input.trimTop,
      trimBottom: input.trimBottom,
    })
    const canvas = new OffscreenCanvas(crop.width, crop.height)
    const context = canvas.getContext('2d')
    if (!context) throw new ArchiveError('CROP_FAILED', 'Браузер не дал холст для обрезки.')
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    if (!blob || blob.size < 32) throw new ArchiveError('CROP_FAILED', 'Обрезанный кадр получился пустым.')
    return blob
  } finally {
    bitmap.close()
  }
}

async function cropViaOffscreen(input: CropInput): Promise<Blob> {
  await ensureOffscreen()
  const bytes = new Uint8Array(await input.png.arrayBuffer())
  const response = await sendCrop(bytes, input)
  if (!response || response.ok !== true || !response.buffer) {
    const code = response && response.ok === false && response.code === 'GEOMETRY_CHANGED' ? 'GEOMETRY_CHANGED' : 'CROP_FAILED'
    const message = response && response.ok === false ? response.message : 'Фоновая страница не вернула обрезанный снимок.'
    throw new ArchiveError(code, message)
  }
  return new Blob([new Uint8Array(response.buffer)], { type: 'image/png' })
}

async function sendCrop(bytes: Uint8Array, input: CropInput): Promise<CropResponse | undefined> {
  const message = (): CropMessage => ({
    source: 'wa-archive',
    target: 'offscreen',
    type: 'CROP',
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    rect: input.rect,
    trimTop: input.trimTop,
    trimBottom: input.trimBottom,
  })
  let response = (await chrome.runtime.sendMessage(message())) as CropResponse | undefined
  if (!response?.ok) {
    await sleep(300)
    response = (await chrome.runtime.sendMessage(message())) as CropResponse | undefined
  }
  return response
}

let offscreenPromise: Promise<void> | null = null

function bundled(file: string): string {
  const background = chrome.runtime.getManifest().background
  const worker = background && 'service_worker' in background ? background.service_worker : ''
  const slash = worker.lastIndexOf('/')
  const prefix = slash >= 0 ? worker.slice(0, slash + 1) : ''
  return `${prefix}${file}`
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return
  if (!offscreenPromise) {
    offscreenPromise = chrome.offscreen
      .createDocument({
        url: bundled('offscreen.html'),
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: 'Локальная обрезка скриншотов до области сообщений.',
      })
      .then(() => undefined)
      .catch(async (error: unknown) => {
        if (await chrome.offscreen.hasDocument()) return
        throw error
      })
      .finally(() => {
        offscreenPromise = null
      })
  }
  await offscreenPromise
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const header = dataUrl.slice(0, comma)
  const body = dataUrl.slice(comma + 1)
  const mime = /data:(.*?);/.exec(header)?.[1] ?? 'image/png'
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ArchiveError('INTERNAL', 'Страница WhatsApp не ответила вовремя.')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
