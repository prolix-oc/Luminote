/**
 * Dock-shell feature — the workspace mounted into a host dock panel
 * (`ctx.ui.requestDockPanel`, ui_panels permission) instead of the floating
 * overlay window. Selected via settings.ui.placement === 'dock'.
 *
 * The host SpindleDockPanel owns the outer chrome (edge pinning, collapse
 * chevron, and the native edge resize handle `_resizeHandle_*`); this shell
 * frames the shared regions — body (sidebar + editor) and statusbar.
 *
 * Performance architecture:
 *  - Live dragging (`onResize`) updates local dimensions without firing
 *    store mutation cascades or calling `setSize` mid-flight.
 *  - Drag completion (`onGeometryCommit`) commits the final width once.
 *  - Programmatic moves & slider drags are batched via `requestAnimationFrame`.
 *
 * Visibility semantics: the shared `overlayVisible` store key drives
 * expand()/collapse(); the host's own collapse affordance reports back
 * through onVisibilityChange, so the widget, hotkey and dock chrome never
 * disagree.
 */
import type { SpindleDockPanelHandle, SpindleDockPanelOptions, SpindleFrontendContext } from 'lumiverse-spindle-types'
import { el, createDisposer } from '../../dom'
import { icon } from '../../icons'
import type { Store } from '../../state'
import { getDockBounds, clampDockWidth, DEFAULT_SETTINGS } from '../../../shared/model'

export interface DockShellFeature {
  sidebarRoot: HTMLElement
  editorRoot: HTMLElement
  statusbarRoot: HTMLElement
  /** Sidebar toggle (created here, pinned into the first pane's tab strip by the editor). */
  sideToggleEl: HTMLElement
  /** Dock only: restore default dock panel width. */
  resetDockWidth?(): void
  /** Parity alias with OverlayFeature. */
  resetWindowSize?(): void
  destroy(): void
}

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 460

/** Staging extends the dock handle with sizing APIs and lifecycle methods the
 * published lumiverse-spindle-types package doesn't declare yet. Everything is
 * optional-chained so older hosts degrade cleanly to static defaults. */
export type DockHandle = SpindleDockPanelHandle & {
  setSize?: (size: number) => void
  getSize?: () => number
  isCollapsed?: () => boolean
  expand?: () => void
  collapse?: () => void
  toggle?: () => void
  setMinSize?: (min: number) => void
  setMaxSize?: (max: number) => void
  onVisibilityChange?: (cb: (visible: boolean) => void) => (() => void)
  onGeometryCommit?: (cb: (rect: { width?: number; height?: number }) => void) => (() => void)
  onResize?: (cb: (rect: { width?: number; height?: number }) => void) => (() => void)
}

export function createDockShellFeature(
  ctx: SpindleFrontendContext,
  store: Store,
  onSidebarWidthCommitted: (width: number) => void,
  onDockWidthCommitted: (width: number) => void,
  onSidebarCollapsedCommitted?: (collapsed: boolean) => void,
): DockShellFeature {
  const disposer = createDisposer()
  const ac = new AbortController()
  disposer.push(() => ac.abort())
  const signal = ac.signal

  const initialBounds = getDockBounds()

  let applyingSize = false
  let appliedDockWidth = clampDockWidth(store.get().settings.ui.dockWidth)
  let rafId = 0

  // Live drag: track local width only; do NOT fire full store notifications
  // or dispatch setSize while the host pointer loop is active.
  function handleLiveResize(width?: number): void {
    if (applyingSize) return
    if (typeof width === 'number' && width > 0) {
      appliedDockWidth = clampDockWidth(width)
    }
  }

  // Drag settled: commit to store & persistence once on release.
  function handleGeometryCommit(width?: number): void {
    if (applyingSize) return
    if (typeof width === 'number' && width > 0) {
      const clamped = clampDockWidth(width)
      appliedDockWidth = clamped
      onDockWidthCommitted(clamped)
    }
  }

  const panel: SpindleDockPanelHandle = ctx.ui.requestDockPanel({
    edge: 'right',
    title: 'Luminote',
    size: appliedDockWidth,
    minSize: initialBounds.min,
    maxSize: initialBounds.max,
    resizable: true,
    startCollapsed: !store.get().overlayVisible,
    onGeometryCommit: (rect: { width?: number }) => handleGeometryCommit(rect?.width),
    onResize: (rect: { width?: number }) => handleLiveResize(rect?.width),
  } as SpindleDockPanelOptions & {
    onGeometryCommit?: (rect: { width?: number }) => void
    onResize?: (rect: { width?: number }) => void
  })
  const dockHandle = panel as DockHandle
  disposer.push(() => {
    if (rafId) cancelAnimationFrame(rafId)
    panel.destroy()
  })

  // Staging handle listener subscriptions
  if (typeof dockHandle.onGeometryCommit === 'function') {
    const unsub = dockHandle.onGeometryCommit((rect) => handleGeometryCommit(rect?.width))
    if (typeof unsub === 'function') disposer.push(unsub)
  }
  if (typeof dockHandle.onResize === 'function') {
    const unsub = dockHandle.onResize((rect) => handleLiveResize(rect?.width))
    if (typeof unsub === 'function') disposer.push(unsub)
  }

  // ── Sidebar toggle: created here, pinned beside the firstmost tab
  // of the left-most split by the editor feature. ──
  const sidebarToggle = el('button', {
    class: 'lx-icon-btn lx-side-toggle',
    title: 'Toggle sidebar',
    attrs: { 'aria-label': 'Toggle file tree sidebar', 'aria-pressed': 'false' },
  }, icon('panelRightClose', 15))
  const sidebarToggleWrap = el('span', { class: 'lx-side-toggle-wrap' }, sidebarToggle)
  sidebarToggle.addEventListener('click', (event) => {
    event.stopPropagation()
    const next = !store.get().settings.ui.sidebarCollapsed
    const settings = store.get().settings
    store.set({ settings: { ...settings, ui: { ...settings.ui, sidebarCollapsed: next } } })
    onSidebarCollapsedCommitted?.(next)
  }, { signal })

  // ── Shared regions ──
  const sidebarRoot = el('aside', { class: 'lx-sidebar' })
  const editorRoot = el('main', { class: 'lx-editor-region' })
  const sidebarHandle = el('div', { class: 'lx-sidebar-handle', title: 'Drag to resize sidebar', attrs: { 'aria-hidden': 'true' } })
  sidebarRoot.appendChild(sidebarHandle)
  const body = el('div', { class: 'lx-body' }, sidebarRoot, editorRoot)
  const statusbarRoot = el('footer', { class: 'lx-statusbar' })

  const shell = el('section', { class: 'lx-shell lx-dock-shell', attrs: { 'aria-label': 'Luminote workspace' } },
    body, statusbarRoot,
  )

  // Named mount: the panel's content root is ours to class, so both host
  // tooling and the user's theming can scope the dock placement directly.
  panel.root.classList.add('luminote-dock-root')
  panel.root.appendChild(shell)

  // ── Sidebar resize (same overlaid-handle pattern as the overlay) ──
  const clampSidebar = (width: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)))
  let appliedSidebarWidth = clampSidebar(store.get().settings.ui.sidebarWidth)
  sidebarRoot.style.width = `${appliedSidebarWidth}px`

  sidebarHandle.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startWidth = sidebarRoot.offsetWidth
    const startX = event.clientX
    try {
      sidebarHandle.setPointerCapture(event.pointerId)
    } catch { /* noop */ }
    const move = (ev: PointerEvent) => {
      sidebarRoot.style.width = `${clampSidebar(startWidth + (ev.clientX - startX))}px`
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const nextWidth = clampSidebar(startWidth + (ev.clientX - startX))
      sidebarRoot.style.width = `${nextWidth}px`
      appliedSidebarWidth = nextWidth
      onSidebarWidthCommitted(nextWidth)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, { signal })

  // ── Visibility: overlayVisible ⇄ dock expand/collapse ──
  let applyingVisibility = false
  disposer.push(store.subscribeKey('overlayVisible', () => {
    const visible = store.get().overlayVisible
    applyingVisibility = true
    try {
      if (visible) panel.expand()
      else panel.collapse()
    } catch {
      // Older hosts without collapse support — leave the panel as-is.
    } finally {
      applyingVisibility = false
    }
  }))
  disposer.push(panel.onVisibilityChange((visible) => {
    if (applyingVisibility) return
    if (store.get().overlayVisible !== visible) store.set({ overlayVisible: visible })
    // Expanding re-applies the host's stale width snapshot; re-assert ours.
    if (visible) {
      setTimeout(() => {
        applyDockWidth(store.get().settings.ui.dockWidth)
      }, 0)
    }
  }))
  if (store.get().overlayVisible) {
    try {
      panel.expand()
    } catch { /* noop */ }
  }

  function syncSidebarToggle(): void {
    const collapsed = store.get().settings.ui.sidebarCollapsed
    shell.classList.toggle('lx-side-collapsed', collapsed)
    sidebarToggle.setAttribute('aria-pressed', String(collapsed))
    sidebarToggle.title = collapsed ? 'Show sidebar' : 'Hide sidebar'
    sidebarToggle.replaceChildren(icon(collapsed ? 'panelRightOpen' : 'panelRightClose', 15))
  }
  syncSidebarToggle()

  /**
   * Apply the dock width live (e.g. from Settings Drawer slider or reset actions).
   * Batched through requestAnimationFrame for smooth 60/120 FPS rendering.
   */
  function applyDockWidth(width: number): void {
    const w = clampDockWidth(width)
    appliedDockWidth = w
    applyingSize = true

    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      try {
        dockHandle.setSize?.(w)
        const bounds = getDockBounds()
        dockHandle.setMinSize?.(bounds.min)
        dockHandle.setMaxSize?.(bounds.max)
      } catch {
        // Older host
      } finally {
        applyingSize = false
      }
      const hostPanel = panel.root.parentElement?.parentElement
      if (hostPanel) hostPanel.style.width = `${w}px`
      rafId = 0
    })
  }

  disposer.push(store.subscribeKey('settings', () => {
    const next = clampSidebar(store.get().settings.ui.sidebarWidth)
    if (next !== appliedSidebarWidth) {
      appliedSidebarWidth = next
      sidebarRoot.style.width = `${next}px`
    }
    const nextDock = clampDockWidth(store.get().settings.ui.dockWidth)
    if (nextDock !== appliedDockWidth) {
      appliedDockWidth = nextDock
      applyDockWidth(nextDock)
    }
    syncSidebarToggle()
  }))

  // Viewport-aware dynamic adaptation: when the window resizes, update
  // dynamic min/max bounds and ensure the dock width remains valid.
  window.addEventListener('resize', () => {
    const bounds = getDockBounds()
    try {
      dockHandle.setMinSize?.(bounds.min)
      dockHandle.setMaxSize?.(bounds.max)
    } catch { /* noop */ }
    const current = store.get().settings.ui.dockWidth
    const clamped = clampDockWidth(current)
    if (clamped !== appliedDockWidth) {
      appliedDockWidth = clamped
      applyDockWidth(clamped)
      onDockWidthCommitted(clamped)
    }
  }, { signal })

  return {
    sidebarRoot,
    editorRoot,
    statusbarRoot,
    sideToggleEl: sidebarToggleWrap,
    resetDockWidth() {
      const defaultWidth = DEFAULT_SETTINGS.ui.dockWidth
      appliedDockWidth = defaultWidth
      applyDockWidth(defaultWidth)
      onDockWidthCommitted(defaultWidth)
    },
    resetWindowSize() {
      const defaultWidth = DEFAULT_SETTINGS.ui.dockWidth
      appliedDockWidth = defaultWidth
      applyDockWidth(defaultWidth)
      onDockWidthCommitted(defaultWidth)
    },
    destroy() {
      disposer.dispose()
    },
  }
}
