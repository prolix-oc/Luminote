/**
 * Overlay feature — the Obsidian-style workspace window.
 *
 * Mounted through `ctx.ui.mountApp` (app_manipulation permission) so it
 * persists across routes. The window is draggable by its title bar,
 * resizable from the right edge, bottom edge and corner, and supports three
 * window states:
 *
 *   regular    minimize · maximize · close controls
 *   maximized  fills the viewport — restore-down · close controls
 *   minimized  titlebar only (vault name shown) — restore-up · close controls
 *
 * Layout regions (sidebar / editor / status bar) are exposed as roots for
 * the other feature modules; hiding only toggles visibility so editor state
 * and in-flight edits survive.
 */
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { OverlayGeometry, OverlayWindowState } from '../../../shared/model'
import { el, createDisposer } from '../../dom'
import { icon } from '../../icons'
import type { Store } from '../../state'

export interface OverlayFeature {
  /** Shell regions other features render into. */
  sidebarRoot: HTMLElement
  editorRoot: HTMLElement
  statusbarRoot: HTMLElement
  /**
   * The sidebar toggle, created here (it owns collapse state syncing) but
   * PLACED by the editor feature, which pins it next to the firstmost tab
   * of the left-most split after every pane re-render.
   */
  sideToggleEl: HTMLElement
  setVisible(visible: boolean): void
  toggle(): void
  /** Settings → Overlay: back to default centered bounds + regular state. */
  resetWindowSize(): void
  destroy(): void
}

const MIN_W = 560
const MIN_H = 360
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 460

function clampGeometry(geo: OverlayGeometry): OverlayGeometry {
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const w = Math.min(Math.max(geo.w, MIN_W), Math.max(vw - 16, MIN_W))
  const h = Math.min(Math.max(geo.h, MIN_H), Math.max(vh - 16, MIN_H))
  return {
    w,
    h,
    x: Math.min(Math.max(geo.x, 8), Math.max(vw - w - 8, 8)),
    y: Math.min(Math.max(geo.y, 8), Math.max(vh - h - 8, 8)),
  }
}

export function createOverlayFeature(
  ctx: SpindleFrontendContext,
  store: Store,
  onGeometryCommitted: (geo: OverlayGeometry) => void,
  onSidebarWidthCommitted: (width: number) => void,
  onSidebarCollapsedCommitted?: (collapsed: boolean) => void,
): OverlayFeature {
  const disposer = createDisposer()
  const ac = new AbortController()
  disposer.push(() => ac.abort())
  const signal = ac.signal

  // Named mount: the host wrapper carries this class, so host-level tooling
  // (and the user) can scope rules to the workspace window specifically.
  const mount = ctx.ui.mountApp({ className: 'luminote-app-mount lx-app-mount', position: 'end' })
  disposer.push(() => mount.destroy())

  // ── Sidebar toggle: owned here (collapse sync), pinned INTO the left-most
  // pane's tab strip by the editor feature — Obsidian/Discord-style, it sits
  // beside the firstmost tab where the strip has breathing room. ──
  // Scoped as .lx-side-toggle-wrap > .lx-side-toggle; both toggle states
  // share one class (variants only swap the glyph + aria-pressed).
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

  const vaultNameEl = el('span', { class: 'lx-vault-name', text: 'No vault' })
  const spacer = el('span', { class: 'lx-spacer', attrs: { 'aria-hidden': 'true' } })

  const minimizeBtn = el('button', {
    class: 'lx-icon-btn lx-titlebar-btn lx-titlebar-minimize',
    title: 'Minimize',
    attrs: { 'aria-label': 'Minimize to titlebar' },
  }, icon('minus', 14))
  const maximizeBtn = el('button', {
    class: 'lx-icon-btn lx-titlebar-btn lx-titlebar-maximize',
    title: 'Maximize',
    attrs: { 'aria-label': 'Maximize' },
  }, icon('maximize', 13))
  const restoreDownBtn = el('button', {
    class: 'lx-icon-btn lx-titlebar-btn lx-titlebar-restore-down',
    title: 'Restore down',
    attrs: { 'aria-label': 'Restore down' },
  }, icon('restoreDown', 13))
  const restoreUpBtn = el('button', {
    class: 'lx-icon-btn lx-titlebar-btn lx-titlebar-restore-up',
    title: 'Restore up',
    attrs: { 'aria-label': 'Restore up' },
  }, icon('maximize2', 13))
  const closeBtn = el('button', {
    class: 'lx-icon-btn lx-titlebar-btn lx-titlebar-close',
    title: 'Close (Ctrl+Shift+L)',
    attrs: { 'aria-label': 'Close Luminote' },
  }, icon('x', 15))

  const titlebar = el('div', { class: 'lx-titlebar' },
    vaultNameEl,
    spacer,
    minimizeBtn, maximizeBtn, restoreDownBtn, restoreUpBtn, closeBtn,
  )

  const sidebarRoot = el('aside', { class: 'lx-sidebar' })
  const editorRoot = el('main', { class: 'lx-editor-region' })
  // Overlaid on the sidebar seam (see CSS) — consumes no layout width and
  // tracks the sidebar edge automatically as its width changes.
  const sidebarHandle = el('div', { class: 'lx-sidebar-handle', title: 'Drag to resize sidebar', attrs: { 'aria-hidden': 'true' } })
  sidebarRoot.appendChild(sidebarHandle)
  const body = el('div', { class: 'lx-body' }, sidebarRoot, editorRoot)
  const statusbarRoot = el('footer', { class: 'lx-statusbar' })

  const resizeRight = el('div', { class: 'lx-resizer lx-resizer-right', attrs: { 'aria-hidden': 'true' } })
  const resizeBottom = el('div', { class: 'lx-resizer lx-resizer-bottom', attrs: { 'aria-hidden': 'true' } })
  const resizeCorner = el('div', { class: 'lx-resizer lx-resizer-corner' }, icon('cornerGrip', 12))

  const overlay = el('section', { class: 'lx-overlay', attrs: { role: 'dialog', 'aria-label': 'Luminote workspace' } },
    titlebar, body, statusbarRoot, resizeRight, resizeBottom, resizeCorner,
  )

  mount.root.appendChild(overlay)

  // ── Window state machine ──
  let winState: OverlayWindowState = 'regular'
  /** Regular bounds — always meaningful, even while maximized/minimized. */
  let regularGeometry: OverlayGeometry = initialGeometry()

  /** Fresh-window bounds: centered, ~86% of the viewport, clamped. */
  function defaultGeometry(): OverlayGeometry {
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const w = Math.min(1120, Math.max(MIN_W, Math.round(vw * 0.86)))
    const h = Math.min(760, Math.max(MIN_H, Math.round(vh * 0.86)))
    return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(8, Math.round((vh - h) / 2)) }
  }

  function initialGeometry(): OverlayGeometry {
    const saved = store.get().settings.ui.overlay
    if (saved) {
      winState = saved.state ?? 'regular'
      return clampGeometry(saved)
    }
    return defaultGeometry()
  }

  function currentRegularGeometryFromDom(): OverlayGeometry {
    return clampGeometry({
      x: overlay.offsetLeft,
      y: overlay.offsetTop,
      w: overlay.offsetWidth,
      h: winState === 'minimized' ? regularGeometry.h : overlay.offsetHeight,
    })
  }

  function applyRegularGeometry(): void {
    overlay.style.left = `${regularGeometry.x}px`
    overlay.style.top = `${regularGeometry.y}px`
    overlay.style.width = `${regularGeometry.w}px`
    overlay.style.height = `${regularGeometry.h}px`
  }

  function syncWindowControls(): void {
    minimizeBtn.hidden = winState !== 'regular'
    maximizeBtn.hidden = winState !== 'regular'
    restoreDownBtn.hidden = winState !== 'maximized'
    restoreUpBtn.hidden = winState !== 'minimized'
  }

  function applyState(): void {
    overlay.classList.toggle('lx-maximized', winState === 'maximized')
    overlay.classList.toggle('lx-minimized', winState === 'minimized')
    if (winState === 'maximized') {
      overlay.style.left = '0px'
      overlay.style.top = '0px'
      overlay.style.width = '100vw'
      overlay.style.height = '100vh'
    } else {
      // In minimized state the CSS collapses height to the titlebar;
      // width/position stay the regular bounds.
      overlay.style.left = `${regularGeometry.x}px`
      overlay.style.top = `${regularGeometry.y}px`
      overlay.style.width = `${regularGeometry.w}px`
      overlay.style.height = winState === 'minimized' ? '' : `${regularGeometry.h}px`
    }
    syncWindowControls()
  }

  function commitState(): void {
    onGeometryCommitted({ ...regularGeometry, state: winState })
  }

  function setWinState(next: OverlayWindowState): void {
    if (winState === next) return
    if (winState === 'regular') regularGeometry = currentRegularGeometryFromDom()
    winState = next
    applyState()
    commitState()
  }

  minimizeBtn.addEventListener('click', (event) => { event.stopPropagation(); setWinState('minimized') }, { signal })
  maximizeBtn.addEventListener('click', (event) => { event.stopPropagation(); setWinState('maximized') }, { signal })
  restoreDownBtn.addEventListener('click', (event) => { event.stopPropagation(); setWinState('regular') }, { signal })
  restoreUpBtn.addEventListener('click', (event) => { event.stopPropagation(); setWinState('regular') }, { signal })

  // ── Drag & resize gestures ──
  /** Pointer-drag loop shared by the title bar and the three resizers. */
  function bindDrag(
    handle: HTMLElement,
    onMove: (dx: number, dy: number, start: OverlayGeometry) => void,
    shouldStart?: (event: PointerEvent) => boolean,
  ): void {
    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return
      if (shouldStart && !shouldStart(event)) return
      event.preventDefault()
      const start = { x: overlay.offsetLeft, y: overlay.offsetTop, w: overlay.offsetWidth, h: overlay.offsetHeight }
      const startX = event.clientX
      const startY = event.clientY
      try {
        handle.setPointerCapture(event.pointerId)
      } catch {
        // Pointer may already be released; fall through — 'up' will still fire.
      }

      // Listen on window: drags must not depend on pointer-capture timing.
      const move = (ev: PointerEvent) => onMove(ev.clientX - startX, ev.clientY - startY, start)
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        regularGeometry = currentRegularGeometryFromDom()
        commitState()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }, { signal })
  }

  function applyRegularGeometryWith(geo: OverlayGeometry): void {
    regularGeometry = clampGeometry(geo)
    // While minimized, only position tracks the drag; size stays stored.
    if (winState === 'minimized') {
      overlay.style.left = `${regularGeometry.x}px`
      overlay.style.top = `${regularGeometry.y}px`
      return
    }
    applyRegularGeometry()
  }

  bindDrag(
    titlebar,
    (dx, dy, start) => applyRegularGeometryWith({ ...start, x: start.x + dx, y: start.y + dy }),
    // Button targets may be SVG nodes (not HTMLElements) — use Element.closest
    // so clicks on window controls never start a drag or get preventDefault'd.
    (event) => winState !== 'maximized'
      && !(event.target instanceof Element && event.target.closest('button')),
  )
  bindDrag(resizeRight, (dx, _dy, start) => applyRegularGeometryWith({ ...start, w: start.w + dx }), () => winState === 'regular')
  bindDrag(resizeBottom, (_dx, dy, start) => applyRegularGeometryWith({ ...start, h: start.h + dy }), () => winState === 'regular')
  bindDrag(resizeCorner, (dx, dy, start) => applyRegularGeometryWith({ ...start, w: start.w + dx, h: start.h + dy }), () => winState === 'regular')

  closeBtn.addEventListener('click', () => store.set({ overlayVisible: false }), { signal })

  applyState()

  // ── Sidebar resize handle (overlaid; see CSS) ──
  function clampSidebar(width: number): number {
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)))
  }

  // Last width committed/applied — the settings subscriber compares against
  // this instead of the live inline style so drags never fight our own sync.
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

    // Window-level listeners: a dropped pointer capture must not strand
    // the drag mid-flight. Mid-drag only the inline style moves; the
    // committed width (store + persistence) is updated on release.
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

  // ── Store wiring: visibility, sidebar width, vault name label ──
  function applyVisible(visible: boolean): void {
    overlay.classList.toggle('lx-hidden', !visible)
    if (visible) applyState()
  }

  applyVisible(store.get().overlayVisible)
  disposer.push(store.subscribeKey('overlayVisible', () => applyVisible(store.get().overlayVisible)))
  disposer.push(store.subscribeKey('vaults', syncVaultLabel))
  disposer.push(store.subscribeKey('activeVaultId', syncVaultLabel))

  function syncVaultLabel(): void {
    const { vaults, activeVaultId } = store.get()
    const vault = vaults.find((v) => v.id === activeVaultId)
    vaultNameEl.textContent = vault ? vault.name : 'No vault'
    vaultNameEl.title = vault?.name ?? ''
  }
  syncVaultLabel()

  // External settings changes sync the sidebar width — but only when the
  // committed value actually differs from ours. Comparing against the last
  // applied width (not the live inline style) keeps an in-progress drag or
  // our own commit echo from fighting the user.
  disposer.push(store.subscribeKey('settings', () => {
    const next = clampSidebar(store.get().settings.ui.sidebarWidth)
    if (next !== appliedSidebarWidth) {
      appliedSidebarWidth = next
      sidebarRoot.style.width = `${next}px`
    }
    syncSidebarToggle()
    syncOpacity()
    syncVaultLabel() // vault-name font size lives in settings
  }))

  /** Settings → Overlay → Window opacity: applied to the whole window. */
  function syncOpacity(): void {
    overlay.style.opacity = String(store.get().settings.ui.overlayOpacity)
  }
  syncOpacity()

  /** Sidebar collapse state: overlay class + toggle glyph both follow settings. */
  function syncSidebarToggle(): void {
    const collapsed = store.get().settings.ui.sidebarCollapsed
    overlay.classList.toggle('lx-side-collapsed', collapsed)
    sidebarToggle.setAttribute('aria-pressed', String(collapsed))
    sidebarToggle.title = collapsed ? 'Show sidebar' : 'Hide sidebar'
    sidebarToggle.replaceChildren(icon(collapsed ? 'panelRightOpen' : 'panelRightClose', 15))
  }
  syncSidebarToggle()

  // Keep the window inside the viewport on browser resizes.
  window.addEventListener('resize', () => {
    regularGeometry = clampGeometry(regularGeometry)
    applyState()
  }, { signal })

  return {
    sidebarRoot,
    editorRoot,
    statusbarRoot,
    sideToggleEl: sidebarToggleWrap,
    setVisible(visible: boolean) {
      store.set({ overlayVisible: visible })
    },
    toggle() {
      store.set({ overlayVisible: !store.get().overlayVisible })
    },
    resetWindowSize() {
      winState = 'regular'
      regularGeometry = defaultGeometry()
      applyState()
      commitState()
    },
    destroy() {
      disposer.dispose()
    },
  }
}
