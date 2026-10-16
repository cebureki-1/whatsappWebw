import regularUrl from '../../assets/fonts/NotoSans-Regular.ttf?url'
import boldUrl from '../../assets/fonts/NotoSans-Bold.ttf?url'
import { exportJobFiles } from '../export/run-export'
import { PHASE_LABELS } from '../limits'
import { isRunningPhase } from '../state-machine'
import { listFrameRecords } from '../storage/db'
import type { ExportFormat, JobCheckpoint, Settings } from '../types'

const form = document.querySelector<HTMLFormElement>('#form')!
const startInput = document.querySelector<HTMLInputElement>('#start')!
const endInput = document.querySelector<HTMLInputElement>('#end')!
const formatInput = document.querySelector<HTMLSelectElement>('#format')!
const nameInput = document.querySelector<HTMLInputElement>('#name')!
const startButton = document.querySelector<HTMLButtonElement>('#start-btn')!
const pauseButton = document.querySelector<HTMLButtonElement>('#pause-btn')!
const resumeButton = document.querySelector<HTMLButtonElement>('#resume-btn')!
const stopButton = document.querySelector<HTMLButtonElement>('#stop-btn')!
const downloadButton = document.querySelector<HTMLButtonElement>('#download-btn')!
const deleteButton = document.querySelector<HTMLButtonElement>('#delete-btn')!
const tabButton = document.querySelector<HTMLButtonElement>('#tab-btn')!
const phaseNode = document.querySelector<HTMLElement>('#phase')!
const framesNode = document.querySelector<HTMLElement>('#frames')!
const hintNode = document.querySelector<HTMLElement>('#hint')!
const errorNode = document.querySelector<HTMLElement>('#error')!
const warningsNode = document.querySelector<HTMLElement>('#warnings')!
const diagnostics = document.querySelector<HTMLDetailsElement>('#diagnostics')!
const diagnosticsList = document.querySelector<HTMLElement>('#diagnostics-list')!

const params = new URLSearchParams(location.search)
const standalone = params.get('view') === 'tab'
if (standalone) document.body.classList.add('tab')

let currentJob: JobCheckpoint | null = null
let exporting = false

form.addEventListener('submit', (event) => {
  event.preventDefault()
  void startArchive()
})
pauseButton.addEventListener('click', () => void send({ source: 'wa-archive', target: 'worker', type: 'PAUSE' }))
resumeButton.addEventListener('click', () => void send({ source: 'wa-archive', target: 'worker', type: 'RESUME' }))
stopButton.addEventListener('click', () => void send({ source: 'wa-archive', target: 'worker', type: 'STOP' }))
downloadButton.addEventListener('click', () => void downloadResult())
deleteButton.addEventListener('click', () => void removeData())
tabButton.addEventListener('click', () => {
  void chrome.tabs.create({ url: pageUrl('?view=tab') })
})

chrome.storage.onChanged.addListener(() => {
  void refresh()
})

void refresh().then(() => {
  if (params.get('download') === '1') void downloadResult()
})

async function refresh(): Promise<void> {
  const response = await send({ source: 'wa-archive', target: 'worker', type: 'GET_STATE' }, false)
  if (!response.ok) {
    showError(response.message)
    return
  }
  currentJob = response.job
  applySettings(response.settings)
  render(response.job)
}

function applySettings(settings: Settings): void {
  if (document.activeElement === formatInput || document.activeElement === nameInput) return
  formatInput.value = settings.format
  if (!nameInput.value) nameInput.value = settings.archiveName
}

function render(job: JobCheckpoint | null): void {
  const running = Boolean(job && isRunningPhase(job.phase))
  phaseNode.textContent = job ? PHASE_LABELS[job.phase] : PHASE_LABELS.idle
  framesNode.textContent = String(job?.frameCount ?? 0)
  startButton.disabled = running || exporting
  pauseButton.disabled = !running || exporting
  resumeButton.disabled = exporting || !canResume(job)
  stopButton.disabled = exporting || !(job && (running || job.phase === 'paused' || job.phase === 'awaiting_partial_decision' || job.phase === 'needs_restart'))
  downloadButton.disabled = exporting || !(job && job.exportAvailable && job.frameCount > 0 && !running)
  deleteButton.disabled = running || exporting
  startInput.disabled = running
  endInput.disabled = running
  showText(hintNode, job?.statusHint ?? '')
  showText(errorNode, job?.phase === 'error' ? job.errorDetail ?? 'Ошибка' : '')
  warningsNode.replaceChildren()
  for (const warning of job?.warnings ?? []) {
    const item = document.createElement('li')
    item.textContent = warning
    warningsNode.append(item)
  }
  const checks = job?.diagnostics ?? []
  diagnostics.hidden = checks.length === 0
  diagnosticsList.replaceChildren()
  for (const check of checks) {
    const item = document.createElement('li')
    item.textContent = `${check.ok ? '✓' : '✗'} ${check.name}${check.note ? `: ${check.note}` : ''}`
    diagnosticsList.append(item)
  }
}

function canResume(job: JobCheckpoint | null): boolean {
  if (!job) return false
  if (job.pauseReason === 'chat') return false
  return job.phase === 'paused' || job.phase === 'needs_restart' || job.phase === 'awaiting_partial_decision'
}

async function startArchive(): Promise<void> {
  showText(errorNode, '')
  if (!startInput.value) {
    showText(errorNode, 'Укажите дату начала.')
    return
  }
  if (endInput.value && endInput.value < startInput.value) {
    showText(errorNode, 'Дата окончания раньше даты начала.')
    return
  }
  if ((currentJob?.frameCount ?? 0) > 0) {
    const agreed = confirm('Уже сохранённые кадры будут удалены перед новым архивом. Продолжить?')
    if (!agreed) return
  }
  const response = await send({
    source: 'wa-archive',
    target: 'worker',
    type: 'START',
    start: startInput.value,
    end: endInput.value || null,
    format: formatInput.value as ExportFormat,
    archiveName: nameInput.value || 'WhatsApp-чат',
  })
  if (!response.ok) showText(errorNode, response.message)
  else if (response.job) render(response.job)
}

async function downloadResult(): Promise<void> {
  const job = currentJob
  if (!job || job.frameCount < 1) {
    showText(errorNode, 'Нет кадров для скачивания.')
    return
  }
  exporting = true
  render(job)
  showText(hintNode, 'Склейка снимков в одну ленту и сборка файла. Не закрывайте это окно.')
  let outcome = ''
  let failure = ''
  try {
    const frames = await listFrameRecords(job.jobId)
    const [fontRegular, fontBold] = await Promise.all([loadFont(regularUrl), loadFont(boldUrl)])
    const files = await exportJobFiles({
      job,
      frames,
      fontRegular,
      fontBold,
      exportedAt: new Date().toLocaleString('ru-RU'),
    })
    for (const file of files) triggerDownload(file.bytes, file.filename, file.mime)
    outcome = job.incomplete || !job.captureComplete ? 'Скачан неполный архив. Причина указана в PDF и в manifest.json.' : 'Файл скачан.'
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Не удалось собрать файл.'
  } finally {
    exporting = false
    render(currentJob)
    if (failure) showText(errorNode, failure)
    else if (outcome) showText(hintNode, outcome)
  }
}

async function removeData(): Promise<void> {
  if (!confirm('Удалить временные кадры и состояние задачи с этого компьютера?')) return
  const response = await send({ source: 'wa-archive', target: 'worker', type: 'DELETE_DATA' })
  if (!response.ok) showText(errorNode, response.message)
  else {
    currentJob = null
    showText(hintNode, 'Временные данные удалены.')
    render(null)
  }
}

async function send(
  message: { source: 'wa-archive'; target: 'worker'; type: string; start?: string; end?: string | null; format?: ExportFormat; archiveName?: string },
  renderState = true,
): Promise<{ ok: true; job: JobCheckpoint | null; settings: Settings } | { ok: false; message: string }> {
  const response = (await chrome.runtime.sendMessage(message)) as
    | { ok: true; job: JobCheckpoint | null; settings: Settings }
    | { ok: false; message: string }
    | undefined
  if (!response) return { ok: false, message: 'Расширение не ответило. Откройте окно ещё раз.' }
  if (response.ok && renderState) {
    currentJob = response.job
    render(response.job)
  }
  return response
}

async function loadFont(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Не удалось прочитать встроенный шрифт.')
  return new Uint8Array(await response.arrayBuffer())
}

function pageUrl(query: string): string {
  const popup = chrome.runtime.getManifest().action?.default_popup ?? 'popup.html'
  const file = popup.split('?')[0] || 'popup.html'
  return chrome.runtime.getURL(`${file}${query}`)
}

function triggerDownload(bytes: Uint8Array, filename: string, mime: string): void {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  const blob = new Blob([copy], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function showText(node: HTMLElement, text: string): void {
  node.hidden = text.length === 0
  node.textContent = text
}

function showError(message: string): void {
  showText(errorNode, message)
}
