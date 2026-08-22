/**
 * Widget feature — the small floating button that toggles the workspace.
 *
 * Uses `ctx.ui.createFloatWidget` (ui_panels permission). The widget is
 * chromeless (the extension owns its presentation), reflects whether the
 * workspace is open, and persists its position through the settings
 * channel. Custom icon + decoration images (stills, GIFs or video), size,
 * radius, transparency, and snap behavior all live in Settings.
 *
 * Staging enhancements:
 *  - Viewport-aware dynamic clamping (smoothly bounds position on load & resize)
 *  - In-place sizing without teardown (no visual flicker on size changes)
 *  - Right-click & long-press native context menu (`ctx.ui.showContextMenu`)
 *  - Smooth edge glide animation with configurable duration & easing curve
 *  - Battery-friendly media lifecycle management (video pause/resume on visibility)
 */
import type { SpindleFloatWidgetHandle, SpindleFloatWidgetOptions, SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { LuminoteSettings } from '../../../shared/model'
import { el, createDisposer } from '../../dom'
import { mediaThumbEl } from '../../media'
import { icon } from '../../icons'
import type { Store } from '../../state'

export interface WidgetFeature {
  /** Settings → Floating widget → Reset spot: jump back to the default corner. */
  resetSpot(): void
  destroy(): void
}

/** A horizontal slice of the screen the widget should not overlap. */
export interface DockOcclusion {
  side: 'left' | 'right'
  left: number
  right: number
}

export interface WidgetFeatureOptions {
  /** Live lookup for the host dock panel's occupied rect, resolved at call
   * time so the edge snap (and reset spot) avoid overlapping the dock. */
  getDockRect?: () => DockOcclusion | null
}

/** Mirrors the host's viewport padding (12px). */
const VIEWPORT_PAD = 12
const TOP_SAFE_MARGIN = 48
const BOTTOM_SAFE_MARGIN = 64

/** Clamp coordinates safely within the visible viewport bounds. */
export function clampWidgetPosition(
  pos: { x: number; y: number },
  size: { width: number; height: number } = { width: 44, height: 44 },
): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? (document.documentElement?.clientWidth || window.innerWidth || 1920) : 1920
  const vh = typeof window !== 'undefined' ? (document.documentElement?.clientHeight || window.innerHeight || 1080) : 1080
  const pad = VIEWPORT_PAD
  const maxX = Math.max(pad, vw - size.width - pad)
  const maxY = Math.max(pad, vh - size.height - pad)
  return {
    x: Math.min(Math.max(pad, Math.round(pos.x)), maxX),
    y: Math.min(Math.max(pad, Math.round(pos.y)), maxY),
  }
}

/** Where the widget sits before the user ever drags it. */
export function defaultWidgetPosition(size: number = 44): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? (document.documentElement?.clientWidth || window.innerWidth || 1920) : 1920
  const vh = typeof window !== 'undefined' ? (document.documentElement?.clientHeight || window.innerHeight || 1080) : 1080
  return clampWidgetPosition({
    x: Math.max(16, vw - size - 44),
    y: Math.max(16, Math.round(vh * 0.35)),
  }, { width: size, height: size })
}

/**
 * Edge glide target: snaps to the nearest horizontal screen edge (left or right)
 * while preserving safe vertical clearance away from top headers and bottom chat inputs.
 * When a dock panel is open on one side, snapping to that side instead lands
 * the widget just inside the dock's inner edge so it never hides underneath.
 */
export function snapTarget(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  dock: DockOcclusion | null = null,
): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? (document.documentElement?.clientWidth || window.innerWidth || 1920) : 1920
  const vh = typeof window !== 'undefined' ? (document.documentElement?.clientHeight || window.innerHeight || 1080) : 1080
  const pad = VIEWPORT_PAD

  // Horizontal nearest edge (left vs right). A dock occupying one side shifts
  // that side's snap line inward to clear the panel.
  let left = pad
  let right = Math.max(pad, vw - size.width - pad)
  if (dock) {
    if (dock.side === 'left') {
      left = Math.min(right, dock.right + pad)
    } else {
      right = Math.max(left, dock.left - size.width - pad)
    }
  }
  const snapX = Math.abs(pos.x - left) < Math.abs(pos.x - right) ? left : right

  // Vertical safe clearance (avoids overlapping top nav or bottom input bar)
  const minY = TOP_SAFE_MARGIN
  const maxY = Math.max(minY, vh - size.height - BOTTOM_SAFE_MARGIN)
  const snapY = Math.min(Math.max(minY, Math.round(pos.y)), maxY)

  return { x: snapX, y: snapY }
}

/** Extended staging handle methods if present on the host instance. */
type FloatWidgetHandleExtended = SpindleFloatWidgetHandle & {
  setSize?: (width: number, height: number) => void
  isVisible?: () => boolean
}

export function createWidgetFeature(
  ctx: SpindleFrontendContext,
  store: Store,
  persistSettings: (settings: LuminoteSettings) => Promise<void>,
  options: WidgetFeatureOptions = {},
): WidgetFeature {
  const getDockRect = options.getDockRect
  const disposer = createDisposer()
  const ac = new AbortController()
  disposer.push(() => ac.abort())
  const signal = ac.signal

  let widget: FloatWidgetHandleExtended | null = null
  let button: HTMLButtonElement | null = null
  let unsubs: Array<() => void> = []

  let lastAppliedSize = store.get().settings.ui.widgetSize
  let isEnabled = false
  let contentSignature = ''
  let glideTimeout: ReturnType<typeof setTimeout> | null = null

  function teardownWidget(): void {
    isEnabled = false
    contentSignature = ''
    if (glideTimeout) {
      clearTimeout(glideTimeout)
      glideTimeout = null
    }
    pauseMediaPlayback()
    for (const unsub of unsubs) {
      try {
        unsub()
      } catch { /* noop */ }
    }
    unsubs = []
    button = null
    if (widget) {
      try {
        widget.destroy()
      } catch { /* noop */ }
      widget = null
    }
  }

  /** Pause active videos when widget is hidden or torn down to save battery & CPU. */
  function pauseMediaPlayback(): void {
    if (!button) return
    const videos = button.querySelectorAll('video')
    videos.forEach((v) => {
      try { v.pause() } catch { /* noop */ }
    })
  }

  /** Resume video playback when widget is visible. */
  function resumeMediaPlayback(): void {
    if (!button || !isEnabled) return
    const videos = button.querySelectorAll('video')
    videos.forEach((v) => {
      try { void v.play() } catch { /* noop */ }
    })
  }

  /**
   * Icon + decoration content — the same layering pattern as the vault
   * avatar: the art fills the (rounded) button, the decoration rides over
   * it at --decoration-to-avatar-ratio scale, centered via the shared
   * --custom-avatar-avatar-decoration-border-position math, and the button
   * only unclips when a decoration is actually on.
   */
  function syncContent(): void {
    if (!button || !widget) return
    const { widgetIconUrl, widgetIconMime, widgetDecorUrl, widgetDecorMime } = store.get().settings.ui
    const sig = `${widgetIconUrl ?? ''}|${widgetIconMime ?? ''}#${widgetDecorUrl ?? ''}|${widgetDecorMime ?? ''}`
    if (sig === contentSignature) return
    contentSignature = sig
    button.replaceChildren()
    if (widgetIconUrl) {
      button.appendChild(mediaThumbEl('lx-widget-icon', widgetIconUrl, widgetIconMime))
    } else {
      button.appendChild(icon('notebookPen', 19))
    }
    if (widgetDecorUrl) {
      button.appendChild(mediaThumbEl('lx-widget-icon-decor', widgetDecorUrl, widgetDecorMime))
    }
    button.classList.toggle('lx-widget-custom-icon', !!widgetIconUrl)
    button.classList.toggle('lx-widget-decorated', !!widgetDecorUrl)
    resumeMediaPlayback()
  }

  /** Cheap style settings — smooth in-place update without DOM churn. */
  function syncStyle(): void {
    if (!widget || !button) return
    const ui = store.get().settings.ui
    widget.root.style.opacity = String(ui.widgetOpacity)
    button.style.borderRadius = `${ui.widgetRadius}%`
  }

  /** Apply in-place resizing to avoid tearing down and rebuilding widget DOM. */
  function applySize(size: number): void {
    if (!widget || !button) return
    lastAppliedSize = size
    try {
      widget.setSize?.(size, size)
    } catch { /* older host */ }
    widget.root.style.width = `${size}px`
    widget.root.style.height = `${size}px`

    // Re-clamp position inside the viewport if size expansion pushed it out
    const curPos = widget.getPosition()
    const clamped = clampWidgetPosition(curPos, { width: size, height: size })
    if (Math.abs(clamped.x - curPos.x) > 0.5 || Math.abs(clamped.y - curPos.y) > 0.5) {
      widget.moveTo(clamped.x, clamped.y)
      persistPosition(clamped)
    }
  }

  /**
   * The host renders the float widget as three nested elements:
   *   .widget (position: fixed, inline left/top) > .content > extension root.
   * The CSS `left`/`top` that actually move live on the OUTER fixed `.widget`
   * div, so the glide transition must be applied there — not on the inner
   * `.content`/root (which never move, and are what the old code targeted,
   * producing a "snap then wait" instead of a glide). Walk up to the first
   * fixed/absolute-positioned ancestor to stay robust against host DOM changes.
   */
  function positionedHostEl(): HTMLElement | null {
    let el: HTMLElement | null = widget?.root?.parentElement ?? null
    while (el) {
      try {
        const pos = getComputedStyle(el).position
        if (pos === 'fixed' || pos === 'absolute') return el
      } catch {
        return el
      }
      el = el.parentElement
    }
    return widget?.root ?? null
  }

  /** Clear any lingering glide transition (empty string falls back to the
   * host's stylesheet, restoring its own box-shadow transition). */
  function clearGlideTransition(): void {
    const target = positionedHostEl()
    if (target) target.style.transition = ''
    if (widget?.root) widget.root.style.transition = ''
  }

  /**
   * Smoothly glide the floating widget from its current position to the target
   * by animating the host's positioned `.widget` element, then syncing the host
   * store via moveTo (a no-op visually, since the inline left/top already match).
   */
  function glideWidget(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs: number,
  ): void {
    if (!widget) return
    const animate = durationMs > 0 && store.get().settings.ui.widgetSnapAnim

    if (glideTimeout) {
      clearTimeout(glideTimeout)
      glideTimeout = null
    }

    if (!animate || (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1)) {
      clearGlideTransition()
      widget.moveTo(to.x, to.y)
      persistPosition(to)
      return
    }

    const target = positionedHostEl()
    if (!target) {
      widget.moveTo(to.x, to.y)
      persistPosition(to)
      return
    }

    const trans = `left ${durationMs}ms cubic-bezier(0.16, 1, 0.3, 1), top ${durationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`
    target.style.transition = trans
    void target.offsetHeight // Force layout flush to commit the transition baseline

    // Drive the animated position on the element that actually moves, then
    // mirror it into the host store so persistence and React state stay in sync.
    target.style.left = `${to.x}px`
    target.style.top = `${to.y}px`
    widget.moveTo(to.x, to.y)
    persistPosition(to)

    // Drop the transition after the glide so manual drags stay instantaneous
    // and the host's own box-shadow transition returns.
    glideTimeout = setTimeout(() => {
      clearGlideTransition()
      glideTimeout = null
    }, durationMs + 40)
  }

  /** Persist a position update through the single settings channel. */
  function persistPosition(pos: { x: number; y: number }): void {
    const settings = store.get().settings
    const next: LuminoteSettings = {
      ...settings,
      ui: { ...settings.ui, widgetPos: { x: Math.round(pos.x), y: Math.round(pos.y) } },
    }
    store.set({ settings: next })
    void persistSettings(next)
  }

  function buildWidget(): void {
    const state = store.get()
    const ui = state.settings.ui
    const enabled = ui.widgetEnabled && state.permissions.ui_panels

    // If enabled state hasn't changed and widget already exists, update in-place!
    if (enabled && widget && isEnabled) {
      if (ui.widgetSize !== lastAppliedSize) {
        applySize(ui.widgetSize)
      }
      syncContent()
      syncStyle()
      if (ui.widgetPos) {
        const curPos = widget.getPosition()
        const target = clampWidgetPosition(ui.widgetPos, { width: ui.widgetSize, height: ui.widgetSize })
        if (Math.abs(curPos.x - target.x) > 1 || Math.abs(curPos.y - target.y) > 1) {
          widget.moveTo(target.x, target.y)
        }
      }
      return
    }

    // Full teardown if disabling or first construction
    teardownWidget()
    if (!enabled) return

    isEnabled = true
    lastAppliedSize = ui.widgetSize

    const initialPos = ui.widgetPos
      ? clampWidgetPosition(ui.widgetPos, { width: ui.widgetSize, height: ui.widgetSize })
      : defaultWidgetPosition(ui.widgetSize)

    try {
      const floatOptions: SpindleFloatWidgetOptions = {
        width: ui.widgetSize,
        height: ui.widgetSize,
        initialPosition: initialPos,
        snapToEdge: false,
        tooltip: 'Luminote',
        chromeless: true,
      }
      ;(floatOptions as SpindleFloatWidgetOptions & { resizable?: boolean }).resizable = false
      widget = ctx.ui.createFloatWidget(floatOptions) as FloatWidgetHandleExtended
    } catch (err) {
      console.warn('[luminote] Float widget unavailable:', err)
      widget = null
      isEnabled = false
      return
    }

    button = el('button', {
      class: 'lx-widget-btn',
      title: 'Toggle Luminote (Ctrl+Shift+L) • Right-click for options',
      attrs: { 'aria-label': 'Toggle Luminote workspace' },
    })
    widget.root.appendChild(button)

    const syncPressed = () => {
      button?.classList.toggle('lx-widget-open', store.get().overlayVisible)
      button?.setAttribute('aria-pressed', String(store.get().overlayVisible))
    }
    syncPressed()
    syncContent()
    syncStyle()

    // ── Gesture handling (drag vs click) ──
    let gesture: { startX: number; startY: number; moved: boolean } | null = null

    button.addEventListener('pointerdown', (event) => {
      gesture = event.button === 0
        ? { startX: event.clientX, startY: event.clientY, moved: false }
        : null
      // Zero lag during active drag — clear any in-flight glide transition.
      clearGlideTransition()
    })

    const onGestureMove = (event: PointerEvent) => {
      if (!gesture || gesture.moved) return
      const dx = event.clientX - gesture.startX
      const dy = event.clientY - gesture.startY
      if (dx * dx + dy * dy > 36) gesture.moved = true
    }
    window.addEventListener('pointermove', onGestureMove, true)
    unsubs.push(() => window.removeEventListener('pointermove', onGestureMove, true))

    const onGestureUp = () => {
      // pointerup completes gesture
    }
    window.addEventListener('pointerup', onGestureUp, true)
    unsubs.push(() => window.removeEventListener('pointerup', onGestureUp, true))

    // Primary click: toggle workspace
    button.addEventListener('click', () => {
      const draggedGesture = gesture?.moved === true
      gesture = null
      if (draggedGesture) return
      store.set({ overlayVisible: !store.get().overlayVisible })
    })

    // ── Context menu (`ctx.ui.showContextMenu`) ──
    button.addEventListener('contextmenu', async (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const isVisible = store.get().overlayVisible
      const placement = store.get().settings.ui.placement
      const isDock = placement === 'dock'

      const { selectedKey } = await ctx.ui.showContextMenu({
        position: { x: event.clientX, y: event.clientY },
        items: [
          { key: 'toggle', label: isVisible ? 'Hide Workspace' : 'Open Workspace' },
          { key: 'div-0', label: '', type: 'divider' },
          { key: 'switch-placement', label: isDock ? 'Switch to Floating Window' : 'Switch to Docked Panel' },
          { key: 'reset-spot', label: 'Reset Widget Position' },
          { key: 'div-1', label: '', type: 'divider' },
          { key: 'hide-widget', label: 'Hide Floating Widget' },
        ],
      })

      if (!selectedKey) return

      if (selectedKey === 'toggle') {
        store.set({ overlayVisible: !isVisible })
      } else if (selectedKey === 'switch-placement') {
        const nextPlacement = isDock ? 'overlay' : 'dock'
        const nextSettings: LuminoteSettings = {
          ...store.get().settings,
          ui: { ...store.get().settings.ui, placement: nextPlacement },
        }
        store.set({ settings: nextSettings })
        void persistSettings(nextSettings)
      } else if (selectedKey === 'reset-spot') {
        resetSpotPosition()
      } else if (selectedKey === 'hide-widget') {
        const nextSettings: LuminoteSettings = {
          ...store.get().settings,
          ui: { ...store.get().settings.ui, widgetEnabled: false },
        }
        store.set({ settings: nextSettings })
        void persistSettings(nextSettings)
      }
    })

    // ── Drag end: edge magnetic glide ──
    unsubs.push(widget.onDragEnd((pos) => {
      const size = store.get().settings.ui.widgetSize
      const dock = getDockRect?.() ?? null
      let target = clampWidgetPosition(pos, { width: size, height: size })
      if (store.get().settings.ui.widgetSnap) {
        target = snapTarget(pos, { width: size, height: size }, dock)
      }
      glideWidget(pos, target, store.get().settings.ui.widgetSnapAnimMs)
    }))

    unsubs.push(store.subscribeKey('overlayVisible', syncPressed))
  }

  function resetSpotPosition(): void {
    const size = store.get().settings.ui.widgetSize
    const dock = getDockRect?.() ?? null
    let spot = defaultWidgetPosition(size)
    // Default spot is top-right; when a right dock is open, tuck it just left
    // of the dock instead of under it.
    if (dock && dock.side === 'right') {
      spot = { x: dock.left - size - VIEWPORT_PAD, y: spot.y }
    }
    const curPos = widget?.getPosition() ?? spot
    glideWidget(curPos, spot, store.get().settings.ui.widgetSnapAnimMs)
    const settings = store.get().settings
    const next: LuminoteSettings = { ...settings, ui: { ...settings.ui, widgetPos: null } }
    store.set({ settings: next })
    void persistSettings(next)
  }

  buildWidget()

  // Window resize: re-clamp widget position if viewport shrinks
  window.addEventListener('resize', () => {
    if (!widget || !store.get().settings.ui.widgetEnabled) return
    const curPos = widget.getPosition()
    const size = store.get().settings.ui.widgetSize
    const clamped = clampWidgetPosition(curPos, { width: size, height: size })
    if (Math.abs(clamped.x - curPos.x) > 1 || Math.abs(clamped.y - curPos.y) > 1) {
      glideWidget(curPos, clamped, store.get().settings.ui.widgetSnapAnimMs)
    }
  }, { signal })

  disposer.push(store.subscribeKey('settings', buildWidget))
  disposer.push(store.subscribeKey('permissions', buildWidget))
  disposer.push(teardownWidget)

  return {
    resetSpot() {
      resetSpotPosition()
    },
    destroy() {
      disposer.dispose()
    },
  }
}
