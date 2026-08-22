/**
 * Media rendering helpers — every art surface (banner, avatar, nameplate,
 * widget icon/decoration, picker recents) accepts stills, animated GIFs and
 * MP4/WebM videos. The host image store persists all three mime families
 * (developer-docs/backend-api/images.md: `mime_type` accepts `video/*`) and
 * serves them from one URL shape, so the backend records the mime alongside
 * each slot and these helpers pick the right element at render time.
 *
 * Video surfaces always autoplay muted+looping+playsinline (decorative —
 * matching Discord's animated-banner behavior); picker thumbnails use
 * `preload="metadata"` so a poster frame renders without streaming it all.
 */
import { el } from './dom'

/** Every file type the pickers stage (and the host image store persists). */
export { ART_ACCEPT } from '../shared/media-types'

/** Pickers buffer bytes in memory pre-staging, so keep videos sane. */
export const ART_MAX_BYTES = 32 * 1024 * 1024

export function isVideoMime(mime: string | null | undefined): boolean {
  return typeof mime === 'string' && mime.startsWith('video/')
}

function videoEl(className: string, src: string, autoplay: boolean): HTMLVideoElement {
  const video = el('video', {
    class: className,
    attrs: {
      src,
      muted: 'true',
      playsinline: 'true',
      'aria-hidden': 'true',
      draggable: 'false',
      // preload="metadata" mirrors the host's WallpaperLayer: buffer lazily,
      // let autoplay+loop pull frames on demand instead of downloading the
      // whole asset up front (fewer stuck decoders, faster first paint).
      ...(autoplay ? { autoplay: 'true', loop: 'true', preload: 'metadata' } : { preload: 'metadata' }),
    },
  }) as HTMLVideoElement
  video.muted = true // property too — the attribute alone can lose to defaults
  return video
}

/**
 * An <img> or <video> fill element for a slot URL. Cover-fit by default —
 * callers supply sizing/object-fit through the class.
 */
export function mediaThumbEl(
  className: string,
  src: string,
  mime: string | null | undefined,
  opts: { autoplay?: boolean; alt?: string } = {},
): HTMLElement {
  const video = isVideoMime(mime)
  if (!video) {
    return el('img', { class: className, attrs: { src, alt: opts.alt ?? '', draggable: 'false' } })
  }
  const node = videoEl(className, src, opts.autoplay ?? true)
  if (opts.alt) node.setAttribute('aria-label', opts.alt)
  return node
}
