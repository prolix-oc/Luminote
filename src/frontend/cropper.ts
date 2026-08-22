/**
 * Crop stage — the host's own avatar resizer (Lumiverse frontend
 * `ImageCropModal.tsx` + `lib/cropImage.ts`, react-easy-crop based) is
 * host-internal React and is NOT exposed through Spindle, so this mirrors
 * its exact pipeline in vanilla DOM:
 *
 * Mirrors react-easy-crop's model:
 *   - the media is contain-fitted into the stage (`objectFit: 'contain'`,
 *     react-easy-crop's default) so the whole image is visible, centered,
 *     and zoom/pan cut into it;
 *   - the crop window (mask) is sized to be contained within the media
 *     (`getCropSize`: window = min(media, container) at the target aspect),
 *     centered, with a white border + a darkened outside shadow.
 *
 * Then: canvas drawImage crop → PNG Blob → raw BYTES (never base64) →
 * staged via uploads.ts → stored via spindle.images.upload (whose sm/lg
 * thumbnails do the display resizing).
 *
 * Only static images reach this stage: animated GIFs/videos skip it (canvas
 * drawImage would flatten them to a still) and upload directly.
 *
 * Extensions over the host modal (Discord-parity quality of life):
 *   - 90° rotation (both directions) + horizontal/vertical flips, applied
 *     to both the preview and the canvas render (WYSIWYG);
 *   - a Reset button restoring scale, position, rotation and flips;
 *   - a zoom slider flanked by small/large image glyphs.
 *
 * The pane carries data-action buttons so it rides the same
 * ctx.ui.events.bindActionHandlers delegation as the rest of the picker —
 * mount it inside an already-bound, connected root.
 */
import { icon } from './icons'

const ZOOM_MIN = 1
const ZOOM_MAX = 3
const ZOOM_STEP = 0.05 // host modal's slider values, verbatim

export interface CropStageOptions {
  /** The picked file; rendered from an object URL, never a data URL. */
  file: { bytes: Uint8Array; name: string; mimeType: string }
  /** 'round' matches the host avatar modal's mask; 'rect' for banners etc. */
  shape?: 'round' | 'rect'
  /** Window aspect ratio (width / height). 1 for avatars, 17/6 for banners. */
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
   * Render the crop to a fresh PNG and return its bytes plus a `.png` file
   * name derived from the original. Rotation and flips are baked into the
   * output exactly as previewed. Animated sources flatten to a still frame.
   */
  render(): Promise<{ bytes: Uint8Array; fileName: string; mimeType: 'image/png' }>
  /** Release the object URL. Safe to call twice. */
  dispose(): void
  /** Signal a decode failure to the caller. */
  onError(handler: (message: string) => void): void
}

export function mountCropStage(options: CropStageOptions): CropStage {
  const { file } = options
  const shape = options.shape ?? 'round'
  const aspect = options.aspect ?? 1
  const outW = options.output?.width ?? options.outputSize ?? 512
  const outH = options.output?.height ?? options.outputSize ?? 512

  const objectUrl = URL.createObjectURL(
    new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: file.mimeType }),
  )

  // Positioned with explicit px so the same numbers feed the canvas crop math.
  const media = document.createElement('img')
  media.className = 'lx-crop-media'
  media.alt = ''
  media.draggable = false
  media.src = objectUrl

  const stageEl = document.createElement('div')
  stageEl.className = 'lx-crop-stage'
  if (Math.abs(aspect - 1) > 1e-6) {
    stageEl.classList.add('lx-crop-stage-wide')
  }
  stageEl.appendChild(media)
  const mask = document.createElement('div')
  mask.className = `lx-crop-mask lx-crop-mask-${shape}`
  mask.style.visibility = 'hidden'
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

  //  Toolbar: rotate, flip, zoom, reset
  const toolbar = document.createElement('div')
  toolbar.className = 'lx-crop-toolbar'
  const toolBtn = (name: Parameters<typeof icon>[0], title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'lx-icon-btn lx-crop-tool'
    b.title = title
    b.setAttribute('aria-label', title)
    b.appendChild(icon(name, 15))
    b.addEventListener('click', onClick)
    return b
  }
  const resetBtn = document.createElement('button')
  resetBtn.type = 'button'
  resetBtn.className = 'lx-crop-reset'
  resetBtn.textContent = 'Reset'
  const zoomLabel = document.createElement('label')
  zoomLabel.className = 'lx-crop-zoom-label'
  zoomLabel.append(icon('image', 14), zoomInput, icon('image', 20))
  toolbar.append(
    toolBtn('rotateCcwSquare', 'Rotate 90° counter-clockwise', rotateCcw),
    toolBtn('rotateCwSquare', 'Rotate 90° clockwise', rotateCw),
    toolBtn('flipHorizontal2', 'Flip horizontal', toggleFlipH),
    toolBtn('flipVertical2', 'Flip vertical', toggleFlipV),
    zoomLabel,
    resetBtn,
  )

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
  root.append(stageEl, toolbar, actions)

  //  contain-scaled pan/zoom/rotate/flip state (react-easy-crop math)
  let iw = 0 // natural width
  let ih = 0
  let zoom = 1
  let ox = 0 // pan offset in stage px (0 = centered)
  let oy = 0
  let rotation = 0 // 0 | 90 | 180 | 270 (CW)
  let flipH = false
  let flipV = false
  let ready = false
  let errorHandler: ((message: string) => void) | null = null

  const stageW = () => stageEl.clientWidth || 0
  const stageH = () => stageEl.clientHeight || stageW() / aspect || 0
  /** Natural dimensions after rotation (90/270 swap the axes). */
  const eff = () => (rotation % 180 !== 0 ? { ew: ih, eh: iw } : { ew: iw, eh: ih })
  /** CONTAIN fit: the whole (post-rotation) image fits inside the stage. */
  const containScale = () => {
    const w = stageW()
    const h = stageH()
    const { ew, eh } = eff()
    return w > 0 && h > 0 && ew > 0 && eh > 0 ? Math.min(w / ew, h / eh) : 1
  }
  /** Displayed size of the contained image at the current zoom. */
  const dims = () => {
    const s = containScale() * zoom
    const { ew, eh } = eff()
    return { dw: ew * s, dh: eh * s, s }
  }
  /** Crop-window dimensions - The region that becomes the output, kept within
   * the contained image (react-easy-crop getCropSize). Round = inscribed
   * square; rect = the target aspect fitted inside the image. */
  const windowSize = () => {
    const s = containScale()
    const { ew, eh } = eff()
    const baseW = ew * s
    const baseH = eh * s
    if (shape === 'rect') {
      const w = Math.min(baseW, baseH * aspect)
      return { w, h: w / aspect }
    }
    const side = Math.min(baseW, baseH)
    return { w: side, h: side }
  }
  const clampOffsets = () => {
    const { w, h } = windowSize()
    const { dw, dh } = dims()
    const mx = Math.max(0, (dw - w) / 2)
    const my = Math.max(0, (dh - h) / 2)
    ox = Math.min(mx, Math.max(-mx, ox))
    oy = Math.min(my, Math.max(-my, oy))
  }
  const applyLayout = () => {
    if (!ready) return
    clampOffsets()
    const sw = stageW()
    const sh = stageH()
    const { dw, dh } = dims()
    // Media: natural-aspect box centered in the stage plus pan; the rotation
    // and flips ride a CSS transform around the box center.
    media.style.width = `${dw}px`
    media.style.height = `${dh}px`
    media.style.left = `${(sw - dw) / 2 + ox}px`
    media.style.top = `${(sh - dh) / 2 + oy}px`
    const parts: string[] = []
    if (rotation) parts.push(`rotate(${rotation}deg)`)
    if (flipH || flipV) parts.push(`scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`)
    media.style.transform = parts.length ? parts.join(' ') : 'none'
    // Mask: the crop window, centered (CSS handles centering), sized to the
    // window so it never extends beyond the image.
    const { w, h } = windowSize()
    mask.style.width = `${w}px`
    mask.style.height = `${h}px`
    mask.style.visibility = 'visible'
  }

  function rotateCw(): void {
    rotation = (rotation + 90) % 360
    applyLayout()
  }
  function rotateCcw(): void {
    rotation = (rotation - 90 + 360) % 360
    applyLayout()
  }
  function toggleFlipH(): void {
    flipH = !flipH
    applyLayout()
  }
  function toggleFlipV(): void {
    flipV = !flipV
    applyLayout()
  }
  function resetCrop(): void {
    zoom = 1
    ox = 0
    oy = 0
    rotation = 0
    flipH = false
    flipV = false
    zoomInput.value = '1'
    applyLayout()
  }
  resetBtn.addEventListener('click', resetCrop)

  const onMediaReady = () => {
    iw = media.naturalWidth
    ih = media.naturalHeight
    if (iw > 0 && ih > 0) {
      ready = true
      applyLayout()
    } else {
      errorHandler?.('Could not decode that image — try another file.')
    }
  }
  const onMediaError = () => {
    errorHandler?.('Could not decode that image — try another file.')
  }
  media.addEventListener('load', onMediaReady)
  media.addEventListener('error', onMediaError)

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
      // Map the crop window (centered, pan offset ox/oy, scale s) to the
      // output canvas, drawing the natural image with flip + rotation baked
      // in — byte-for-byte what the preview showed.
      const { w, h } = windowSize()
      const s = containScale() * zoom
      const { ew, eh } = eff()
      const exLeft = ew / 2 - w / (2 * s) - ox / s
      const eyTop = eh / 2 - h / (2 * s) - oy / s

      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const g = canvas.getContext('2d')
      if (!g) throw new Error('Canvas is unavailable in this browser.')
      const kx = (outW * s) / w
      const ky = (outH * s) / h
      g.translate(-exLeft * kx, -eyTop * ky)
      g.scale(kx, ky)
      g.translate(ew / 2, eh / 2)
      if (rotation) g.rotate((rotation * Math.PI) / 180)
      if (flipH || flipV) g.scale(flipH ? -1 : 1, flipV ? -1 : 1)
      g.drawImage(media, -iw / 2, -ih / 2, iw, ih)

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
