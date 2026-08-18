/**
 * Crop stage — the host's own avatar resizer (Lumiverse frontend
 * `ImageCropModal.tsx` + `lib/cropImage.ts`, react-easy-crop based) is
 * host-internal React and is NOT exposed through Spindle, so this mirrors
 * its exact pipeline in vanilla DOM:
 *
 *   pan + zoom a cover-scaled preview (round mask for avatars like the
 *   host modal's cropShape: 'round'; a wide 17:6 rect for banners —
 *   Discord's documented profile-banner geometry, 680×240 minimum, which
 *   we render at 1360×480 for HiDPI) → canvas drawImage crop → PNG
 *   Blob → raw BYTES (never base64) → staged via uploads.ts → stored via
 *   spindle.images.upload (whose sm/lg thumbnails do the display resizing).
 *
 * The pane carries data-action buttons so it rides the same
 * ctx.ui.events.bindActionHandlers delegation as the rest of the picker —
 * mount it inside an already-bound, connected root.
 */

const ZOOM_MIN = 1
const ZOOM_MAX = 3
const ZOOM_STEP = 0.05 // host modal's slider values, verbatim

export interface CropStageOptions {
  /** The picked file; rendered from an object URL, never a data URL. */
  file: { bytes: Uint8Array; name: string; mimeType: string }
  /** 'round' matches the host avatar modal's mask; 'rect' for banners etc. */
  shape?: 'round' | 'rect'
  /** Stage aspect ratio (width / height). 1 for avatars, 17/6 for banners. */
  aspect?: number
  /** Output edge in px — the host crops avatars to 512×512. Ignored when `output` is set. */
  outputSize?: number
  /**
   * Explicit output dimensions. Banner: 1360×480 — 2× Discord's documented
   * 680×240 minimum (17:6), so HiDPI displays stay sharp.
   */
  output?: { width: number; height: number }
}

export interface CropStage {
  el: HTMLElement
  /**
   * Render the crop to a fresh 512×512 (outputSize) PNG and return its
   * bytes plus a `.png` file name derived from the original.
   */
  render(): Promise<{ bytes: Uint8Array; fileName: string; mimeType: 'image/png' }>
  /** Release the object URL. Safe to call twice. */
  dispose(): void
  /** Signal an image-decode failure to the caller. */
  onError(handler: (message: string) => void): void
}

export function mountCropStage(options: CropStageOptions): CropStage {
  const { file } = options
  const shape = options.shape ?? 'round'
  const aspect = options.aspect ?? (shape === 'round' ? 1 : 1)
  const outW = options.output?.width ?? options.outputSize ?? 512
  const outH = options.output?.height ?? options.outputSize ?? 512

  const objectUrl = URL.createObjectURL(
    new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: file.mimeType }),
  )

  // img is positioned with explicit px left/top/width/height so the exact
  // same numbers feed the canvas crop math (no getBoundingClientRect drift).
  const img = document.createElement('img')
  img.className = 'lx-crop-img'
  img.alt = ''
  img.draggable = false
  img.src = objectUrl

  const stageEl = document.createElement('div')
  stageEl.className = 'lx-crop-stage'
  if (Math.abs(aspect - 1) > 1e-6) {
    // Wide stages (banner): the CSS default is square, so the ratio must be
    // applied here. aspect-ratio keeps the height derived from the width.
    stageEl.classList.add('lx-crop-stage-wide')
    stageEl.style.aspectRatio = `${aspect}`
  }
  stageEl.appendChild(img)
  const mask = document.createElement('div')
  mask.className = `lx-crop-mask${shape === 'round' ? ' lx-crop-mask-round' : ''}`
  mask.setAttribute('aria-hidden', 'true')
  stageEl.appendChild(mask)

  const zoomInput = document.createElement('input')
  zoomInput.type = 'range'
  zoomInput.className = 'lx-crop-zoom'
  zoomInput.min = String(ZOOM_MIN)
  zoomInput.max = String(ZOOM_MAX)
  zoomInput.step = String(ZOOM_STEP)
  zoomInput.value = '1'
  zoomInput.setAttribute('aria-label', 'Zoom')

  const controls = document.createElement('div')
  controls.className = 'lx-crop-controls'
  const zoomLabel = document.createElement('label')
  zoomLabel.className = 'lx-crop-zoom-label'
  const zoomText = document.createElement('span')
  zoomText.textContent = 'Zoom'
  zoomLabel.append(zoomText, zoomInput)
  controls.appendChild(zoomLabel)

  const actions = document.createElement('div')
  actions.className = 'lx-crop-actions'
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'lx-modal-btn lx-crop-cancel'
  cancelBtn.dataset.action = 'crop-cancel'
  cancelBtn.textContent = 'Cancel'
  const confirmBtn = document.createElement('button')
  confirmBtn.type = 'button'
  confirmBtn.className = 'lx-modal-btn lx-modal-btn-primary lx-crop-confirm'
  confirmBtn.dataset.action = 'crop-confirm'
  confirmBtn.textContent = 'Apply'
  actions.append(cancelBtn, confirmBtn)

  const root = document.createElement('div')
  root.className = 'lx-crop'
  root.append(stageEl, controls, actions)

  // ── cover-scaled pan/zoom state (react-easy-crop math, 1:1) ──
  let iw = 0 // natural width
  let ih = 0
  let zoom = 1
  let ox = 0 // pan offset in stage px (0 = centered)
  let oy = 0
  let ready = false
  let errorHandler: ((message: string) => void) | null = null

  const stageW = () => stageEl.clientWidth || 0
  const stageH = () => stageEl.clientHeight || stageW() / aspect || 0
  const coverScale = () => {
    const w = stageW()
    const h = stageH()
    return w > 0 && h > 0 && iw > 0 && ih > 0 ? Math.max(w / iw, h / ih) : 1
  }
  /** Displayed size at the current zoom. */
  const dims = () => {
    const s = coverScale() * zoom
    return { dw: iw * s, dh: ih * s }
  }
  const clampOffsets = () => {
    const w = stageW()
    const h = stageH()
    const { dw, dh } = dims()
    const mx = Math.max(0, (dw - w) / 2)
    const my = Math.max(0, (dh - h) / 2)
    ox = Math.min(mx, Math.max(-mx, ox))
    oy = Math.min(my, Math.max(-my, oy))
  }
  const applyLayout = () => {
    if (!ready) return
    clampOffsets()
    const w = stageW()
    const h = stageH()
    const { dw, dh } = dims()
    img.style.width = `${dw}px`
    img.style.height = `${dh}px`
    img.style.left = `${(w - dw) / 2 + ox}px`
    img.style.top = `${(h - dh) / 2 + oy}px`
  }

  img.addEventListener('load', () => {
    iw = img.naturalWidth
    ih = img.naturalHeight
    if (iw > 0 && ih > 0) {
      ready = true
      applyLayout()
    } else {
      errorHandler?.('Could not decode that image — try another file.')
    }
  })
  img.addEventListener('error', () => {
    errorHandler?.('Could not decode that image — try another file.')
  })

  // Drag to pan (capture keeps the gesture alive outside the stage).
  let dragStart: { px: number; py: number; ox: number; oy: number } | null = null
  stageEl.addEventListener('pointerdown', (event) => {
    if (!ready) return
    dragStart = { px: event.clientX, py: event.clientY, ox, oy }
    stageEl.setPointerCapture(event.pointerId)
    stageEl.classList.add('lx-crop-dragging')
  })
  stageEl.addEventListener('pointermove', (event) => {
    if (!dragStart) return
    ox = dragStart.ox + (event.clientX - dragStart.px)
    oy = dragStart.oy + (event.clientY - dragStart.py)
    applyLayout()
  })
  const endDrag = (event: PointerEvent) => {
    if (!dragStart) return
    dragStart = null
    if (stageEl.hasPointerCapture(event.pointerId)) stageEl.releasePointerCapture(event.pointerId)
    stageEl.classList.remove('lx-crop-dragging')
  }
  stageEl.addEventListener('pointerup', endDrag)
  stageEl.addEventListener('pointercancel', endDrag)

  zoomInput.addEventListener('input', () => {
    zoom = Number(zoomInput.value) || 1
    applyLayout()
  })

  let disposed = false

  return {
    el: root,
    async render() {
      if (!ready) throw new Error('Image is still loading — give it a moment.')
      // canvas.toBlob emits real bytes — the host's cropImage.ts does the
      // same drawImage crop at the same 512 default; nothing base64 here.
      const w = stageW()
      const h = stageH()
      const s = coverScale() * zoom
      const { dw, dh } = dims()
      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const g = canvas.getContext('2d')
      if (!g) throw new Error('Canvas is unavailable in this browser.')
      const sx = ((dw - w) / 2 - ox) / s // viewport left in natural px
      const sy = ((dh - h) / 2 - oy) / s
      const sw = w / s
      const sh = h / s
      g.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not encode the cropped image.')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const base = file.name.replace(/\.[^.]+$/, '') || 'image'
      return { bytes, fileName: `${base}-crop.png`, mimeType: 'image/png' as const }
    },
    dispose() {
      if (disposed) return
      disposed = true
      URL.revokeObjectURL(objectUrl)
    },
    onError(handler) {
      errorHandler = handler
    },
  }
}
