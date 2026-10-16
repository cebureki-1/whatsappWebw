import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { ArchiveError } from '../src/errors'
import { assertReady, findMessageScroller, pageContextFromWindow, readPageStatus } from '../src/whatsapp/adapter'

function box(element: HTMLElement, x: number, y: number, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      x,
      y,
      left: x,
      top: y,
      width,
      height,
      right: x + width,
      bottom: y + height,
      toJSON: () => ({}),
    }) as DOMRect
}

describe('адаптер разметки', () => {
  it('находит переписку в похожей разметке и не копирует текст сообщения в диагностику', () => {
    const win = new Window({ url: 'https://web.whatsapp.com/', width: 1280, height: 800 })
    win.document.documentElement.lang = 'ru'
    win.document.body.innerHTML = `
      <div id="pane-side"><div data-id="chat-list-row">Список</div></div>
      <div id="main">
        <header><span title="Анна" dir="auto">Анна</span><span>в сети</span></header>
        <div id="log">
          <div role="row"><span>8 октября 2026 г.</span></div>
          <div data-id="m1"><span data-pre-plain-text="[09:00, 08.10.2026] Анна: ">СЕКРЕТНОЕ-СООБЩЕНИЕ</span></div>
        </div>
        <footer>поле ввода</footer>
      </div>
    `
    const log = win.document.getElementById('log') as unknown as HTMLElement
    const main = win.document.getElementById('main') as unknown as HTMLElement
    const header = main.querySelector('header') as unknown as HTMLElement
    const footer = main.querySelector('footer') as unknown as HTMLElement
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1800 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 500 })
    box(log, 320, 100, 700, 500)
    box(header, 320, 40, 700, 50)
    box(footer, 320, 680, 700, 80)
    const status = readPageStatus(pageContextFromWindow(win as unknown as globalThis.Window))
    expect(status.compatible).toBe(true)
    expect(status.chatTitle).toBe('Анна')
    expect(status.readableDates).toBeGreaterThan(0)
    expect(JSON.stringify(status.diagnostics)).not.toContain('СЕКРЕТНОЕ-СООБЩЕНИЕ')
    const scroller = findMessageScroller(main, win.document.getElementById('pane-side') as unknown as HTMLElement | null)
    expect(scroller?.id).toBe('log')
    expect(assertReady(status)).toBeUndefined()
  })

  it('не считает пустую страницу чатом и не предлагает пустой архив', () => {
    const win = new Window({ url: 'https://web.whatsapp.com/', width: 1280, height: 800 })
    win.document.body.innerHTML = '<div id="app"></div>'
    const status = readPageStatus(pageContextFromWindow(win as unknown as globalThis.Window))
    expect(status.compatible).toBe(false)
    expect(() => assertReady(status)).toThrow(ArchiveError)
  })

  it('в коротком чате без переполнения берёт список сообщений, а не одну строку', () => {
    const win = new Window({ url: 'https://web.whatsapp.com/', width: 1280, height: 800 })
    win.document.body.innerHTML = `
      <div id="pane-side"></div>
      <div id="main">
        <header><span title="Борис">Борис</span></header>
        <div id="log">
          <div><div data-id="m1"><span data-pre-plain-text="[09:00, 08.10.2026] Борис: ">один</span></div></div>
          <div><div data-id="m2"><span data-pre-plain-text="[09:05, 08.10.2026] Борис: ">два</span></div></div>
        </div>
      </div>
    `
    const main = win.document.getElementById('main') as unknown as HTMLElement
    const log = win.document.getElementById('log') as unknown as HTMLElement
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 400 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 })
    const scroller = findMessageScroller(main, win.document.getElementById('pane-side') as unknown as HTMLElement | null)
    expect(scroller?.id).toBe('log')
  })

  it('отличает чужой сайт', () => {
    const win = new Window({ url: 'https://example.com/', width: 800, height: 600 })
    const status = readPageStatus(pageContextFromWindow(win as unknown as globalThis.Window))
    expect(status.onWhatsapp).toBe(false)
    expect(status.compatible).toBe(false)
  })
})
