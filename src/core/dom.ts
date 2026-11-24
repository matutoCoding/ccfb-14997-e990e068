// 极简 DOM 构造器，避免引入框架

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v as string
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v)
    } else {
      ;(el as unknown as Record<string, unknown>)[k] = v
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return el
}

export function clear(el: HTMLElement): void {
  el.replaceChildren()
}

export function mount(el: HTMLElement, node: Node): void {
  el.replaceChildren(node)
}

let toastTimer: number | undefined
export function toast(msg: string): void {
  document.querySelectorAll('.toast').forEach((n) => n.remove())
  const el = h('div', { class: 'toast' }, msg)
  document.body.append(el)
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.remove(), 2600)
}

export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('zh-CN')
}

export function download(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: url }) as HTMLAnchorElement
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
