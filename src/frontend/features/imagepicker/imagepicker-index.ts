/**
 * Image-picker popup — the shared "Select an Image" modal for every
 * image the extension shows (vault avatar, avatar decoration, vault
 * nameplate, widget icon/decoration, and settings banner). Nameplates and
 * banners use the same current/upload/remove conventions without recents;
 * banner stills receive the dedicated wide crop stage.
 *
 * Structure mirrors the mockup one-to-one and is fully scoped for styling:
 *
 *   .lx-popup-root > .lx-lm-body-inner > .lx-lm-content
 *     .lx-lm-select > .lx-lm-current (preview)
 *                   > .lx-lm-select-side (.lx-lm-select-title/-desc/-actions)
 *     .lx-crop (avatar/banner stills — pan/zoom crop stage, see cropper.ts)
 *     .lx-lm-container > .lx-lm-recents-header (h2 + p; optional)
 *                      > .lx-lm-recents > .lx-lm-slots > button.lx-lm-slot ×6
 *
 * Pipeline (all documented Lumiverse surfaces, no fallbacks, no base64):
 * the picked file streams as raw bytes to the host's tus staging endpoint
 * (frontend/uploads.ts), the backend consumes it by id with
 * `spindle.uploads.get()` and stores it via `spindle.images.upload()`,
 * which generates the sm/lg thumbnails that do all display resizing.
 * Avatar-like slots (vault avatar, widget icon) pass through a 512×512 crop;
 * banner stills use a 1360×480 17:6 crop. This mirrors the host's avatar
 * resizer while staying inside extension-owned DOM. Animated GIFs and videos
 * skip canvas cropping so animation survives.
 *
 * Interactions ride the host's `ctx.ui.events.bindActionHandlers` helper,
 * bound AFTER the popup root is appended — the documented contract is
 * "the target must be connected and live when binding"
 * (developer-docs/frontend-api/ui-events-helper.md).
 *
 * Recents semantics: the last 6 uploads per slot, MRU first; picking a
 * recent RE-USES the hosted URL — it never re-uploads and never
 * duplicates the list (the backend bumps it to the front instead).
 */
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { ImageSlot, RecentImageSlot } from '../../../shared/model'
import { ART_ACCEPT_LABEL, normalizeArtMime } from '../../../shared/media-types'
import { mountCropStage, type CropStage } from '../../cropper'
import { ART_ACCEPT, ART_MAX_BYTES, mediaThumbEl } from '../../media'
import { el } from '../../dom'
import { icon } from '../../icons'
import type { RpcClient } from '../../rpc'
import { stageUpload } from '../../uploads'

/** Slots displayed square/circle get the avatar crop stage (Discord-style). */
const AVATAR_CROP_SLOTS: ReadonlySet<ImageSlot> = new Set(['vault-pfp', 'widget-icon'])
const WIDE_PREVIEW_SLOTS: ReadonlySet<ImageSlot> = new Set(['vault-nameplate', 'banner'])

export interface ImagePickerOptions {
  slot: ImageSlot
  /** Required for vault-* slots. */
  vaultId?: string
  currentUrl: string | null
  /** Backend-tracked MIME for the current asset (video → <video> preview). */
  currentMime?: string | null
  title: string
  /** Recents heading; only used when showRecents is true. */
  recentsTitle?: string
  /** Nameplates and the settings banner deliberately omit the recents grid. */
  showRecents?: boolean
}

export async function openImagePicker(
  ctx: SpindleFrontendContext,
  rpc: RpcClient,
  options: ImagePickerOptions,
): Promise<void> {
  const { slot, vaultId, title } = options
  const supportsRecents = slot !== 'banner' && slot !== 'vault-nameplate'
  const showRecents = supportsRecents && (options.showRecents ?? true)
  const recentsTitle = options.recentsTitle ?? 'Recent Uploads'
  const widePreview = WIDE_PREVIEW_SLOTS.has(slot)

  const modal = ctx.ui.showModal({ title: 'Select an Image', width: widePreview ? 540 : 480 })
  let busy = false
  let dismissed = false
  let cropStage: CropStage | null = null
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => { resolveDone = resolve })

  const errorEl = el('div', { class: 'lx-lm-error lx-hidden', attrs: { role: 'alert' } })
  const showError = (message: string) => {
    errorEl.textContent = message
    errorEl.classList.remove('lx-hidden')
  }

  // ── Current selection pane ──
  const currentEl = el('div', { class: `lx-lm-current${widePreview ? ' lx-lm-current-wide' : ''}` })
  const syncCurrent = (url: string | null, mime: string | null) => {
    currentEl.replaceChildren()
    if (url) {
      currentEl.appendChild(mediaThumbEl('lx-lm-current-img', url, mime, { alt: title }))
      currentEl.classList.remove('lx-lm-current-empty')
    } else {
      currentEl.appendChild(el('span', { class: 'lx-lm-current-placeholder' }, icon('imagePlus', 26)))
      currentEl.classList.add('lx-lm-current-empty')
    }
  }
  syncCurrent(options.currentUrl, options.currentMime ?? null)

  const uploadBtn = el('button', {
    class: 'lx-modal-btn lx-lm-upload',
    attrs: { 'data-action': 'upload', type: 'button' },
  }, icon('imagePlus', 14), el('span', { text: 'Upload Image' }))
  const removeBtn = el('button', {
    class: `lx-modal-btn lx-lm-remove${options.currentUrl ? '' : ' lx-hidden'}`,
    attrs: { 'data-action': 'remove', type: 'button' },
  }, el('span', { text: 'Remove' }))

  const cropKind: 'avatar' | 'banner' | null = slot === 'banner'
    ? 'banner'
    : AVATAR_CROP_SLOTS.has(slot) ? 'avatar' : null
  const croppable = cropKind !== null
  const selectPane = el('div', { class: 'lx-lm-select' },
    currentEl,
    el('div', { class: 'lx-lm-select-side' },
      el('div', { class: 'lx-lm-select-title', text: title }),
      el('div', {
        class: 'lx-lm-select-desc',
        text: cropKind === 'banner'
          ? `${ART_ACCEPT_LABEL} up to 32 MB. Stills use a 17:6 crop; GIFs and videos stay animated.`
          : croppable
            ? `${ART_ACCEPT_LABEL} up to 32 MB. Stills can be cropped after picking; GIFs and videos stay animated.`
            : `${ART_ACCEPT_LABEL} up to 32 MB.`,
      }),
      el('div', { class: 'lx-lm-select-actions' }, uploadBtn, removeBtn),
    ),
  )
  const cropHost = el('div', { class: 'lx-lm-crop-host lx-hidden' })

  const closeCrop = () => {
    cropStage?.dispose()
    cropStage = null
    cropHost.replaceChildren()
    cropHost.classList.add('lx-hidden')
    selectPane.classList.remove('lx-hidden')
  }

  // ── Recents grid: always six slots, empties are placeholders ──
  const slotsWrap = el('div', { class: 'lx-lm-slots' })
  let recents: string[] = []
  /** Backend MIME index for the recents (video → <video> poster thumbs). */
  let mimes: Record<string, string> = {}
  function syncSlots(): void {
    slotsWrap.replaceChildren()
    for (let i = 0; i < 6; i += 1) {
      const url = recents[i]
      if (url) {
        slotsWrap.appendChild(el('button', {
          class: 'lx-lm-slot-btn',
          attrs: { 'data-action': `pick:${i}`, type: 'button', title: 'Use this media' },
        }, el('span', { class: 'lx-lm-slot' }, mediaThumbEl('lx-lm-slot-media', url, mimes[url] ?? null, { autoplay: false }))))
      } else {
        slotsWrap.appendChild(el('button', {
          class: 'lx-lm-slot-btn',
          attrs: { type: 'button', disabled: 'true', 'aria-hidden': 'true', tabindex: '-1' },
        }, el('span', { class: 'lx-lm-slot lx-lm-slot-empty' })))
      }
    }
    slotsWrap.classList.toggle('lx-lm-slots-empty', recents.length === 0)
  }
  syncSlots()

  const content = el('div', { class: 'lx-lm-content' },
    selectPane,
    cropHost,
    errorEl,
  )
  if (showRecents) {
    content.appendChild(el('div', { class: 'lx-lm-container' },
      el('div', { class: 'lx-lm-recents-header' },
        el('h2', { text: recentsTitle }),
        el('p', { text: 'Access your 6 most recent uploads.' }),
      ),
      el('div', { class: 'lx-lm-recents' }, slotsWrap),
    ))
  }
  const popupRoot = el('div', { class: `lx-popup-root${widePreview ? ' lx-lm-wide-picker' : ''}` },
    el('div', { class: 'lx-lm-body-inner' }, content),
  )
  modal.root.appendChild(popupRoot)

  const setBusy = (next: boolean) => {
    busy = next
    popupRoot.classList.toggle('lx-lm-busy', next)
  }

  /** Stage raw bytes with the host (tus), then hand the id to the backend. */
  async function commit(bytes: Uint8Array, fileName: string, mimeType: string): Promise<void> {
    setBusy(true)
    errorEl.classList.add('lx-hidden')
    try {
      // The IPC hop carries only the small upload id — the image pipeline's
      // host-generated thumbnails do every display resize from here.
      const uploadId = await stageUpload(ctx, bytes, fileName)
      const res = await rpc.call<{ url: string; mime: string; recents?: string[]; mimes?: Record<string, string> }>('image.set', {
        slot, vaultId, uploadId, fileName, mimeType,
      })
      recents = res.recents ?? recents
      mimes = res.mimes ?? mimes
      syncSlots()
      modal.dismiss()
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Upload failed')
      setBusy(false)
    }
  }

  async function upload(): Promise<void> {
    if (busy) return
    const files = await ctx.uploads.pickFile({
      accept: [...ART_ACCEPT],
      multiple: false,
      maxSizeBytes: ART_MAX_BYTES,
    })
    const file = files[0]
    if (!file) return
    const mimeType = normalizeArtMime(file.mimeType, file.name)
    if (!mimeType) {
      showError(`Choose a ${ART_ACCEPT_LABEL} file.`)
      return
    }
    const normalizedFile = { ...file, mimeType }
    // GIFs and videos bypass the crop stage: canvas would flatten the frames.
    if (croppable && mimeType !== 'image/gif' && !mimeType.startsWith('video/')) {
      errorEl.classList.add('lx-hidden')
      selectPane.classList.add('lx-hidden')
      cropHost.classList.remove('lx-hidden')
      cropStage = cropKind === 'banner'
        ? mountCropStage({ file: normalizedFile, shape: 'rect', aspect: 17 / 6, output: { width: 1360, height: 480 } })
        : mountCropStage({ file: normalizedFile, shape: 'round', outputSize: 512 })
      cropStage.onError((message) => {
        closeCrop()
        showError(message)
      })
      cropHost.appendChild(cropStage.el)
      return
    }
    await commit(file.bytes, file.name, mimeType)
  }

  async function confirmCrop(): Promise<void> {
    if (busy || !cropStage) return
    setBusy(true)
    errorEl.classList.add('lx-hidden')
    try {
      const cropped = await cropStage.render()
      closeCrop()
      await commit(cropped.bytes, cropped.fileName, cropped.mimeType)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Crop failed')
      setBusy(false)
    }
  }

  async function pickRecent(index: number): Promise<void> {
    if (busy) return
    const url = recents[index]
    if (!url) return
    setBusy(true)
    errorEl.classList.add('lx-hidden')
    try {
      const res = await rpc.call<{ recents: string[]; mimes: Record<string, string> }>('image.select', {
        slot, vaultId, url, mime: mimes[url],
      })
      recents = res.recents
      mimes = res.mimes
      syncSlots()
      modal.dismiss()
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not apply image')
      setBusy(false)
    }
  }

  async function clear(): Promise<void> {
    if (busy) return
    setBusy(true)
    errorEl.classList.add('lx-hidden')
    try {
      await rpc.call('image.clear', { slot, vaultId })
      modal.dismiss()
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not remove image')
      setBusy(false)
    }
  }

  // Lumiverse UI-events convention: ONE delegating listener on the popup
  // root maps data-action attributes to handlers. The root was appended
  // above, so the documented "connected and live" precondition holds.
  const unbind = ctx.ui.events.bindActionHandlers(popupRoot, {
    upload: () => { void upload() },
    remove: () => { void clear() },
    'crop-confirm': () => { void confirmCrop() },
    'crop-cancel': () => { closeCrop() },
    ...Object.fromEntries(
      [0, 1, 2, 3, 4, 5].map((i) => [`pick:${i}`, () => { void pickRecent(i) }]),
    ),
  }, { attribute: 'data-action' })

  modal.onDismiss(() => {
    unbind()
    cropStage?.dispose()
    cropStage = null
    if (!dismissed) {
      dismissed = true
      resolveDone()
    }
  })

  // Warm the recents grid only for slots that expose it. Banner is rejected
  // by the backend's recent-slot schema, and nameplate intentionally hides
  // its historical bucket in this surface.
  if (showRecents) {
    void rpc.call<{ recents: string[]; mimes: Record<string, string> }>('image.recents', { slot: slot as RecentImageSlot })
      .then((res) => {
        if (dismissed) return
        recents = res.recents
        mimes = res.mimes ?? {}
        syncSlots()
      })
      .catch(() => undefined)
  }

  return done
}
