import { ArchiveError } from '../errors'
import type { ContentRequest, ContentResponse } from '../protocol'
import {
  alignToStart,
  captureContext,
  pageContextFromWindow,
  probe,
  readBoundary,
  readPageStatus,
  scrollDown,
  scrollUpAndSettle,
} from '../whatsapp/adapter'

const FLAG = '__waChatArchiveInstalled'
const globalScope = globalThis as typeof globalThis & Record<string, boolean>

if (!globalScope[FLAG]) {
  globalScope[FLAG] = true
  chrome.runtime.onMessage.addListener((message: { source?: string; target?: string; request?: ContentRequest }, _sender, sendResponse) => {
    if (message?.source !== 'wa-archive' || message.target !== 'content' || !message.request) return undefined
    void handle(message.request)
      .then((response) => sendResponse(response))
      .catch((error: unknown) => {
        const archive = error instanceof ArchiveError ? error : null
        const response: ContentResponse = {
          ok: false,
          errorCode: archive?.code ?? 'INTERNAL',
          message: archive?.message ?? 'Не удалось прочитать страницу WhatsApp.',
          diagnostics: archive?.diagnostics,
        }
        sendResponse(response)
      })
    return true
  })
}

async function handle(request: ContentRequest): Promise<ContentResponse> {
  const ctx = pageContextFromWindow(window)
  switch (request.type) {
    case 'STATUS':
      return { ok: true, type: 'STATUS', status: readPageStatus(ctx) }
    case 'READ_BOUNDARY': {
      const boundary = readBoundary(ctx)
      return { ok: true, type: 'READ_BOUNDARY', ...boundary }
    }
    case 'SCROLL_UP':
      return { ok: true, type: 'SCROLL_UP', ...(await scrollUpAndSettle(ctx, request.start)) }
    case 'ALIGN_START':
      return { ok: true, type: 'ALIGN_START', ...(await alignToStart(ctx, request.start)) }
    case 'CAPTURE_CONTEXT':
      return {
        ok: true,
        type: 'CAPTURE_CONTEXT',
        context: captureContext(ctx, request),
      }
    case 'SCROLL_DOWN':
      return { ok: true, type: 'SCROLL_DOWN', ...(await scrollDown(ctx)) }
    case 'PROBE':
      return { ok: true, type: 'PROBE', ...probe(ctx) }
    default:
      return { ok: false, errorCode: 'INTERNAL', message: 'Неизвестная команда страницы.' }
  }
}
