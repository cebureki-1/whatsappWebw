import { computeEdgeTrim, downProgress, scrollDelta, upProgress, type ScrollSnapshot, type TrimItem } from '../archive/scroll-logic'
import {
  compareDays,
  dateSamplesFromText,
  formatIsoDate,
  inspectSlashOrder,
  localTimeZone,
  parseDateLabel,
  parseIsoDate,
  parsePrePlainText,
  rangeStatus,
  type ParseContext,
  type SlashOrder,
} from '../dates'
import { ArchiveError, ErrorCodes } from '../errors'
import { LIMITS } from '../limits'
import type { BoundaryVisibility, CaptureContext, DiagnosticCheck, Geometry, PageStatus } from '../types'

/**
 * Адаптер читает только отрисованную страницу.
 * Ориентиры (#main, #pane-side, data-id, data-pre-plain-text) взяты из публично
 * наблюдаемой разметки и не проверялись на живом WhatsApp Web в этой среде.
 * Если структура не сходится, адаптер возвращает ошибку и диагностику.
 */

export interface PageContext {
  document: Document
  href: string
  innerWidth: number
  innerHeight: number
  devicePixelRatio: number
  now: Date
  timeZone: string
  locale: string
  visibilityState: DocumentVisibilityState
}

export function pageContextFromWindow(win: Window): PageContext {
  return {
    document: win.document,
    href: win.location.href,
    innerWidth: win.innerWidth,
    innerHeight: win.innerHeight,
    devicePixelRatio: win.devicePixelRatio || 1,
    now: new Date(),
    timeZone: localTimeZone(),
    locale: win.document.documentElement.lang || win.navigator.language || 'ru',
    visibilityState: win.document.visibilityState,
  }
}

export function isWhatsAppUrl(href: string): boolean {
  try {
    const url = new URL(href)
    return url.protocol === 'https:' && url.hostname === 'web.whatsapp.com'
  } catch {
    return false
  }
}

export function readPageStatus(ctx: PageContext): PageStatus {
  const diagnostics: DiagnosticCheck[] = []
  const onWhatsapp = isWhatsAppUrl(ctx.href)
  diagnostics.push({
    name: 'Адрес WhatsApp Web',
    ok: onWhatsapp,
    note: onWhatsapp ? ctx.href : 'нужен https://web.whatsapp.com/',
  })
  if (!onWhatsapp) {
    return {
      onWhatsapp: false,
      loggedIn: false,
      chatOpen: false,
      compatible: false,
      chatKey: null,
      chatTitle: null,
      readableDates: 0,
      messageCount: 0,
      diagnostics,
    }
  }

  const chatList = findChatList(ctx.document)
  const qr = ctx.document.querySelector('[data-testid="qrcode"]')
  const panel = findConversationPanel(ctx.document)
  const loggedIn = Boolean(chatList) && !qr
  diagnostics.push({
    name: 'Вход в аккаунт',
    ok: loggedIn,
    note: qr ? 'на странице виден блок QR' : chatList ? 'список чатов найден' : 'список чатов не найден',
  })
  diagnostics.push({
    name: 'Панель переписки',
    ok: Boolean(panel),
    note: panel ? 'ориентир #main или эквивалент найден' : 'панель #main не найдена — селектор не подтверждён на этой странице',
  })

  const title = panel ? readChatTitle(panel) : null
  const scroller = panel ? findMessageScroller(panel, chatList) : null
  const view = scroller ? collectView(scroller, ctx) : null
  diagnostics.push({
    name: 'Название чата',
    ok: Boolean(title),
    note: title ? 'заголовок прочитан' : 'устойчивый заголовок не найден',
  })
  diagnostics.push({
    name: 'Прокрутка сообщений',
    ok: Boolean(scroller),
    note: scroller
      ? `высота прокрутки ${scroller.scrollHeight}, окно ${scroller.clientHeight}`
      : 'прокручиваемый контейнер сообщений не найден',
  })
  diagnostics.push({
    name: 'Сообщения',
    ok: (view?.messageCount ?? 0) > 0,
    note: `элементов с data-id: ${view?.messageCount ?? 0}`,
  })
  diagnostics.push({
    name: 'Даты',
    ok: (view?.readableDates ?? 0) > 0,
    note:
      view && view.ambiguousCount > 0
        ? `понятных дат: ${view.readableDates}, неоднозначных: ${view.ambiguousCount}`
        : `понятных дат: ${view?.readableDates ?? 0}`,
  })
  if (view && view.unparsedSamples.length > 0) {
    diagnostics.push({
      name: 'Неразобранные подписи дат',
      ok: false,
      note: view.unparsedSamples.join(' | '),
    })
  }

  const chatOpen = Boolean(panel && title && scroller && (view?.messageCount ?? 0) > 0)
  const compatible = loggedIn && chatOpen && (view?.readableDates ?? 0) > 0
  return {
    onWhatsapp,
    loggedIn,
    chatOpen,
    compatible,
    chatKey: title ? normalizeKey(title) : null,
    chatTitle: title,
    readableDates: view?.readableDates ?? 0,
    messageCount: view?.messageCount ?? 0,
    diagnostics,
  }
}

export function assertReady(status: PageStatus): void {
  if (!status.onWhatsapp) throw new ArchiveError(ErrorCodes.NOT_WHATSAPP, undefined, status.diagnostics)
  if (!status.loggedIn) throw new ArchiveError(ErrorCodes.NOT_LOGGED_IN, undefined, status.diagnostics)
  if (!status.chatOpen) throw new ArchiveError(ErrorCodes.NO_CHAT, undefined, status.diagnostics)
  if (status.readableDates < 1) {
    const ambiguous = status.diagnostics.some((item) => item.name === 'Даты' && (item.note?.includes('неоднознач') ?? false))
    throw new ArchiveError(ambiguous ? ErrorCodes.AMBIGUOUS_DATE : ErrorCodes.DATE_UNREADABLE, undefined, status.diagnostics)
  }
  if (!status.compatible || !status.chatKey || !status.chatTitle) {
    throw new ArchiveError(ErrorCodes.MARKUP_INCOMPATIBLE, undefined, status.diagnostics)
  }
}

export function readBoundary(ctx: PageContext): {
  boundaryId: string
  chatKey: string
  chatTitle: string
  geometry: Geometry
  oldest: string | null
  newest: string | null
  fingerprint: string
} {
  const located = requireChat(ctx)
  const messages = outermostMessages(located.scroller)
  const last = messages[messages.length - 1]
  const boundaryId = last?.getAttribute('data-id')?.trim() ?? ''
  if (!boundaryId) {
    throw new ArchiveError(
      ErrorCodes.MARKUP_INCOMPATIBLE,
      'Не найден устойчивый признак последнего сообщения (data-id). Съёмка не начата, пустой архив не создаётся.',
      located.status.diagnostics,
    )
  }
  return {
    boundaryId,
    chatKey: located.chatKey,
    chatTitle: located.chatTitle,
    geometry: located.geometry,
    oldest: located.view.oldest,
    newest: located.view.newest,
    fingerprint: fingerprintOf(located.scroller, messages),
  }
}

export async function scrollUpAndSettle(ctx: PageContext, startIso: string): Promise<{
  reachedStart: boolean
  historyExhausted: boolean
  progressed: boolean
  oldest: string | null
  newest: string | null
  chatKey: string
  fingerprint: string
  ambiguousCount: number
  settled: boolean
}> {
  const start = requireDate(startIso)
  const located = requireChat(ctx)
  const before = snapshot(located.scroller, located.view)
  const delta = scrollDelta(located.scroller.clientHeight)
  located.scroller.scrollTop = Math.max(0, located.scroller.scrollTop - delta)
  if (located.scroller.scrollTop < 40) located.scroller.scrollTop = 0
  const settled = await waitStable(located.scroller)
  const fresh = pageContextFromWindow(ctx.document.defaultView ?? window)
  const next = requireChat(fresh)
  const after = snapshot(next.scroller, next.view)
  const progressed = upProgress(before, after)
  const reachedStart = Boolean(next.view.oldestDate && compareDays(next.view.oldestDate, start) <= 0)
  const historyExhausted = !progressed && next.scroller.scrollTop <= 1
  return {
    reachedStart,
    historyExhausted,
    progressed,
    oldest: next.view.oldest,
    newest: next.view.newest,
    chatKey: next.chatKey,
    fingerprint: fingerprintOf(next.scroller, outermostMessages(next.scroller)),
    ambiguousCount: next.view.ambiguousCount,
    settled,
  }
}

export async function alignToStart(ctx: PageContext, startIso: string): Promise<{
  chatKey: string
  fingerprint: string
  warning: string | null
  geometry: Geometry
  settled: boolean
}> {
  const start = requireDate(startIso)
  const located = requireChat(ctx)
  const target = firstInRangeElement(located.scroller, start, null, located.view.context)
  let warning: string | null = null
  if (!target) {
    warning = 'Первое сообщение периода не удалось выделить. Съёмка начнётся с текущей позиции, охват нужно проверить.'
  } else {
    const pane = located.scroller.getBoundingClientRect()
    const box = target.getBoundingClientRect()
    located.scroller.scrollTop += box.top - pane.top - 8
  }
  const settled = await waitStable(located.scroller)
  const fresh = pageContextFromWindow(ctx.document.defaultView ?? window)
  const next = requireChat(fresh)
  return {
    chatKey: next.chatKey,
    fingerprint: fingerprintOf(next.scroller, outermostMessages(next.scroller)),
    warning,
    geometry: next.geometry,
    settled,
  }
}

export async function scrollDown(ctx: PageContext): Promise<{
  progressed: boolean
  fingerprint: string
  chatKey: string
  settled: boolean
}> {
  const located = requireChat(ctx)
  const before = snapshot(located.scroller, located.view)
  located.scroller.scrollTop += scrollDelta(located.scroller.clientHeight)
  const settled = await waitStable(located.scroller)
  const fresh = pageContextFromWindow(ctx.document.defaultView ?? window)
  const next = requireChat(fresh)
  const after = snapshot(next.scroller, next.view)
  return {
    progressed: downProgress(before, after),
    fingerprint: fingerprintOf(next.scroller, outermostMessages(next.scroller)),
    chatKey: next.chatKey,
    settled,
  }
}

export function captureContext(
  ctx: PageContext,
  input: { start: string; end: string | null; boundaryId: string; trimLeading: boolean },
): CaptureContext {
  const start = requireDate(input.start)
  const end = input.end ? requireDate(input.end) : null
  const located = requireChat(ctx)
  const paneTop = located.geometry.rect.y
  const paneBottom = paneTop + located.geometry.rect.height
  const paneHeight = located.geometry.rect.height
  const items: TrimItem[] = []
  let containsBoundary: BoundaryVisibility = 'absent'
  let afterBoundary = false
  for (const message of outermostMessages(located.scroller)) {
    const box = message.getBoundingClientRect()
    const top = box.top - paneTop
    const bottom = box.bottom - paneTop
    const isBoundary = (message.getAttribute('data-id') ?? '') === input.boundaryId
    if (bottom > 0 && top < paneHeight) {
      const parsed = messageDate(message, located.view.context)
      let status: TrimItem['status'] =
        parsed.kind === 'date' ? rangeStatus(parsed.date, false, start, end) : 'unknown'
      if (afterBoundary) status = 'after'
      items.push({ top, bottom, status })
      if (isBoundary) {
        const fully = box.top >= paneTop - 2 && box.bottom <= paneBottom + 2
        containsBoundary = fully ? 'full' : 'partial'
      }
    }
    if (isBoundary) afterBoundary = true
  }
  const trailing = Boolean(end) || containsBoundary !== 'absent'
  const trim = computeEdgeTrim(items, paneHeight, {
    leading: input.trimLeading,
    trailing,
  })
  const passedEnd = Boolean(end && located.view.newestDate && rangeStatus(located.view.newestDate, false, start, end) === 'after' && items.some((item) => item.status === 'in'))
  const atBottom = located.scroller.scrollTop + located.scroller.clientHeight >= located.scroller.scrollHeight - 4
  return {
    chatKey: located.chatKey,
    geometry: located.geometry,
    fingerprint: fingerprintOf(located.scroller, outermostMessages(located.scroller)),
    scrollTop: located.scroller.scrollTop,
    oldest: located.view.oldest,
    newest: located.view.newest,
    containsBoundary,
    passedEnd,
    atBottom,
    trimTop: trim.reliable ? trim.trimTop : 0,
    trimBottom: trim.reliable ? trim.trimBottom : 0,
    trimReliable: trim.reliable,
    coverageWarning: trim.warning,
    ambiguousCount: located.view.ambiguousCount,
    leadingClear: trim.leadingClear,
    settled: true,
  }
}

export function probe(ctx: PageContext): {
  chatKey: string
  geometry: Geometry
  fingerprint: string
  visibility: 'visible' | 'hidden'
} {
  const located = requireChat(ctx)
  return {
    chatKey: located.chatKey,
    geometry: located.geometry,
    fingerprint: fingerprintOf(located.scroller, outermostMessages(located.scroller)),
    visibility: ctx.visibilityState === 'visible' ? 'visible' : 'hidden',
  }
}

export function findChatList(doc: Document): HTMLElement | null {
  const byId = doc.getElementById('pane-side') ?? doc.getElementById('side')
  if (byId) return byId
  for (const label of ['Chat list', 'Список чатов', 'Чаты', 'Chats']) {
    const el = doc.querySelector(`[aria-label="${label}"]`)
    if (isHtmlElement(el)) return el
  }
  return null
}

export function findConversationPanel(doc: Document): HTMLElement | null {
  return doc.getElementById('main')
}

export function findMessageScroller(panel: HTMLElement, chatList: HTMLElement | null): HTMLElement | null {
  const scrollable: HTMLElement[] = []
  const holders: HTMLElement[] = []
  const nodes = panel.querySelectorAll('div')
  const limit = Math.min(nodes.length, 5000)
  for (let index = 0; index < limit; index++) {
    const node = nodes[index]
    if (!isHtmlElement(node)) continue
    if (chatList && (node === chatList || chatList.contains(node))) continue
    if (!node.querySelector('[data-id]')) continue
    holders.push(node)
    if (node.scrollHeight > node.clientHeight + 8) scrollable.push(node)
  }
  return pickMessageScroller(scrollable.length > 0 ? scrollable : holders)
}

function pickMessageScroller(candidates: HTMLElement[]): HTMLElement | null {
  if (candidates.length === 0) return null
  const ranked = [...candidates].sort((left, right) => {
    const byMessages = right.querySelectorAll('[data-id]').length - left.querySelectorAll('[data-id]').length
    if (byMessages !== 0) return byMessages
    return left.querySelectorAll('*').length - right.querySelectorAll('*').length
  })
  return ranked[0] ?? null
}

function requireChat(ctx: PageContext): {
  status: PageStatus
  panel: HTMLElement
  scroller: HTMLElement
  chatKey: string
  chatTitle: string
  geometry: Geometry
  view: ViewData
} {
  const status = readPageStatus(ctx)
  assertReady(status)
  const panel = findConversationPanel(ctx.document)
  const scroller = panel ? findMessageScroller(panel, findChatList(ctx.document)) : null
  if (!panel || !scroller || !status.chatKey || !status.chatTitle) {
    throw new ArchiveError(ErrorCodes.MARKUP_INCOMPATIBLE, undefined, status.diagnostics)
  }
  const geometry = measureGeometry(ctx, panel, scroller)
  return {
    status,
    panel,
    scroller,
    chatKey: status.chatKey,
    chatTitle: status.chatTitle,
    geometry,
    view: collectView(scroller, ctx),
  }
}

function measureGeometry(ctx: PageContext, panel: HTMLElement, scroller: HTMLElement): Geometry {
  const rect = scroller.getBoundingClientRect()
  let top = Math.max(rect.top, 0)
  let bottom = Math.min(rect.bottom, ctx.innerHeight)
  const left = Math.max(rect.left, 0)
  const right = Math.min(rect.right, ctx.innerWidth)
  const header = panel.querySelector('header')
  const footer = panel.querySelector('footer')
  if (isHtmlElement(header)) {
    const headerRect = header.getBoundingClientRect()
    if (headerRect.bottom > top && headerRect.top < bottom) top = Math.max(top, headerRect.bottom)
  }
  if (isHtmlElement(footer)) {
    const footerRect = footer.getBoundingClientRect()
    if (footerRect.top < bottom && footerRect.bottom > top) bottom = Math.min(bottom, footerRect.top)
  }
  const width = right - left
  const height = bottom - top
  if (width < 40 || height < 40) {
    throw new ArchiveError('CROP_FAILED', 'Видимая область сообщений слишком мала. Разверните окно WhatsApp.')
  }
  return {
    viewportWidth: ctx.innerWidth,
    viewportHeight: ctx.innerHeight,
    devicePixelRatio: ctx.devicePixelRatio,
    rect: { x: left, y: top, width, height },
  }
}

interface ViewData {
  messageCount: number
  readableDates: number
  ambiguousCount: number
  oldest: string | null
  newest: string | null
  oldestDate: ReturnType<typeof parseIsoDate>
  newestDate: ReturnType<typeof parseIsoDate>
  context: ParseContext
  unparsedSamples: string[]
}

function collectView(scroller: HTMLElement, ctx: PageContext): ViewData {
  const samples: string[] = []
  for (const node of scroller.querySelectorAll('[data-pre-plain-text]')) {
    const raw = node.getAttribute('data-pre-plain-text') ?? ''
    samples.push(...dateSamplesFromText(raw))
  }
  for (const sample of separatorSamples(scroller)) samples.push(sample)
  const learned = inspectSlashOrder(samples)
  const slashOrder: SlashOrder = learned === 'conflict' ? 'unknown' : learned
  const parseContext: ParseContext = {
    now: ctx.now,
    timeZone: ctx.timeZone,
    locale: ctx.locale,
    slashOrder,
  }
  const dates: { iso: string; date: NonNullable<ReturnType<typeof parseIsoDate>> }[] = []
  let ambiguousCount = 0
  const unparsedSamples: string[] = []
  for (const message of outermostMessages(scroller)) {
    const parsed = messageDate(message, parseContext)
    if (parsed.kind === 'date') dates.push({ iso: formatIsoDate(parsed.date), date: parsed.date })
    else if (parsed.kind === 'ambiguous') ambiguousCount += 1
  }
  for (const text of separatorSamples(scroller)) {
    const parsed = parseDateLabel(text, parseContext)
    if (parsed.kind === 'date') dates.push({ iso: formatIsoDate(parsed.date), date: parsed.date })
    else if (parsed.kind === 'ambiguous') ambiguousCount += 1
    else if (text.length <= 40) unparsedSamples.push(text)
  }
  dates.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0))
  return {
    messageCount: outermostMessages(scroller).length,
    readableDates: dates.length,
    ambiguousCount,
    oldest: dates[0]?.iso ?? null,
    newest: dates[dates.length - 1]?.iso ?? null,
    oldestDate: dates[0]?.date ?? null,
    newestDate: dates[dates.length - 1]?.date ?? null,
    context: parseContext,
    unparsedSamples: unparsedSamples.slice(0, 3),
  }
}

function separatorSamples(scroller: HTMLElement): string[] {
  const result: string[] = []
  const rows = scroller.querySelectorAll('[role="row"], span')
  const limit = Math.min(rows.length, 2000)
  for (let index = 0; index < limit; index++) {
    const node = rows[index]
    if (!isHtmlElement(node)) continue
    if (node.closest('[data-id], [data-pre-plain-text]')) continue
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!looksLikeDateChip(text)) continue
    result.push(text)
  }
  return result
}

function looksLikeDateChip(text: string): boolean {
  if (text.length < 4 || text.length > 40) return false
  if (/^(сегодня|вчера|today|yesterday)$/i.test(text)) return true
  if (/^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(text)) return true
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return true
  if (/^\d{1,2}\s+\p{L}{3,}\s+\d{2,4}/u.test(text)) return true
  if (/^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{2,4}$/.test(text)) return true
  return false
}

function messageDate(message: HTMLElement, context: ParseContext) {
  const host = message.querySelector('[data-pre-plain-text]') ?? message
  const raw = host.getAttribute('data-pre-plain-text')
  if (!raw) return { kind: 'none' } as const
  return parsePrePlainText(raw, context)
}

function firstInRangeElement(
  scroller: HTMLElement,
  start: NonNullable<ReturnType<typeof parseIsoDate>>,
  end: NonNullable<ReturnType<typeof parseIsoDate>> | null,
  context: ParseContext,
): HTMLElement | null {
  const messages = outermostMessages(scroller)
  for (const message of messages) {
    const parsed = messageDate(message, context)
    if (parsed.kind === 'date' && rangeStatus(parsed.date, false, start, end) === 'in') return message
  }
  return null
}

function outermostMessages(scroller: HTMLElement): HTMLElement[] {
  return [...scroller.querySelectorAll('[data-id]')].filter(
    (element): element is HTMLElement => isHtmlElement(element) && !element.parentElement?.closest('[data-id]'),
  )
}

function snapshot(scroller: HTMLElement, view: ViewData): ScrollSnapshot {
  const messages = outermostMessages(scroller)
  return {
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    firstId: messages[0]?.getAttribute('data-id') ?? null,
    lastId: messages[messages.length - 1]?.getAttribute('data-id') ?? null,
    oldest: view.oldestDate,
  }
}

function fingerprintOf(scroller: HTMLElement, messages: HTMLElement[]): string {
  const first = messages[0]?.getAttribute('data-id') ?? ''
  const last = messages[messages.length - 1]?.getAttribute('data-id') ?? ''
  return `${first}|${last}|${messages.length}|${Math.round(scroller.scrollTop)}|${scroller.scrollHeight}`
}

function readChatTitle(panel: HTMLElement): string | null {
  const header = panel.querySelector('header')
  if (!header) return null
  const nodes = header.querySelectorAll('span[title], [dir="auto"]')
  for (const node of nodes) {
    const title = (node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim()
    if (title && !isStatusText(title)) return title
  }
  return null
}

function isStatusText(text: string): boolean {
  const value = text.toLowerCase()
  return ['online', 'offline', 'typing…', 'typing...', 'в сети', 'не в сети', 'печатает'].some((token) => value === token || value.startsWith(`${token} `))
}

function normalizeKey(title: string): string {
  return title.replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim()
}

function requireDate(iso: string) {
  const date = parseIsoDate(iso)
  if (!date) throw new ArchiveError(ErrorCodes.INVALID_RANGE, 'Дата указана в непонятном формате.')
  return date
}

async function waitStable(scroller: HTMLElement): Promise<boolean> {
  let previous = fingerprintOf(scroller, outermostMessages(scroller))
  let stablePasses = 0
  const started = Date.now()
  while (Date.now() - started < LIMITS.stableTimeoutMs) {
    await sleep(LIMITS.stablePollMs)
    const next = fingerprintOf(scroller, outermostMessages(scroller))
    if (next === previous) stablePasses += 1
    else stablePasses = 0
    previous = next
    if (stablePasses >= LIMITS.stablePasses) return true
  }
  return false
}

function isHtmlElement(value: unknown): value is HTMLElement {
  if (!value || typeof value !== 'object') return false
  return (value as { nodeType?: number }).nodeType === 1
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function statusError(status: PageStatus): ArchiveError {
  try {
    assertReady(status)
  } catch (error) {
    if (error instanceof ArchiveError) return error
  }
  return new ArchiveError(ErrorCodes.MARKUP_INCOMPATIBLE, undefined, status.diagnostics)
}
