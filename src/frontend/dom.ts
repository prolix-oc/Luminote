/**
 * Micro DOM builder used across feature modules. The host provides
 * `ctx.dom.createElement(tag, attrs)` for loose elements; feature UIs are
 * dense trees, so this tiny `el()` keeps construction legible. It does not
 * replace any host placement API — it only builds nodes that modules then
 * attach to their host-provided roots.
 */

export type ElChild = Node | string | null | undefined | false

export interface ElProps {
  class?: string
  text?: string
  title?: string
  dataset?: Record<string, string>
  attrs?: Record<string, string>
  style?: Partial<CSSStyleDeclaration>
  children?: ElChild[]
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: ElChild[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.class) node.className = props.class
  if (props.text !== undefined) node.textContent = props.text
  if (props.title !== undefined) node.title = props.title
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (k === 'value' && node instanceof HTMLInputElement) node.value = v
      else node.setAttribute(k, v)
    }
  }
  if (props.style) Object.assign(node.style, props.style)
  for (const child of [...(props.children ?? []), ...children]) {
    if (child === null || child === undefined || child === false) continue
    node.append(child)
  }
  return node
}

/** Register a listener and return an idempotent disposer. */
export function listen<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | Document | Window,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void {
  const wrapped = handler as EventListener
  target.addEventListener(type, wrapped, options)
  let active = true
  return () => {
    if (!active) return
    active = false
    target.removeEventListener(type, wrapped, options)
  }
}

/** Chainable teardown bucket — feature modules collect their disposers here. */
export function createDisposer(): { push: (...fns: Array<(() => void) | undefined>) => void; dispose: () => void } {
  const fns: Array<() => void> = []
  let disposed = false
  return {
    push(...fnsToAdd) {
      for (const fn of fnsToAdd) if (fn) fns.push(fn)
    },
    dispose() {
      if (disposed) return
      disposed = true
      while (fns.length > 0) {
        const fn = fns.pop()
        try {
          fn?.()
        } catch {
          // Teardown is best effort by contract.
        }
      }
    },
  }
}
