/**
 * Canonical media acceptance shared by the frontend picker and backend gate.
 * JPG and JPEG both use the standard image/jpeg MIME type.
 */
export const ART_ACCEPT = [
  'video/webm',
  'image/webp',
  'video/mp4',
  'image/gif',
  'image/png',
  'image/jpeg',
] as const

export type AcceptedArtMime = typeof ART_ACCEPT[number]

export const ART_ACCEPT_LABEL = 'WEBM, WEBP, MP4, GIF, PNG, JPG, or JPEG'

const ACCEPTED_MIMES = new Set<string>(ART_ACCEPT)
const MIME_ALIASES: Readonly<Record<string, AcceptedArtMime>> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
}
const EXTENSION_MIMES: Readonly<Record<string, AcceptedArtMime>> = {
  webm: 'video/webm',
  webp: 'image/webp',
  mp4: 'video/mp4',
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

/**
 * Normalize a picker/upload MIME and fall back to its extension when hosts
 * report application/octet-stream. Returns null for every unsupported type.
 */
export function normalizeArtMime(mime: string | null | undefined, fileName: string | null | undefined): AcceptedArtMime | null {
  const normalized = mime?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const aliased = MIME_ALIASES[normalized]
  if (aliased) return aliased
  if (ACCEPTED_MIMES.has(normalized)) return normalized as AcceptedArtMime

  const extension = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return extension ? (EXTENSION_MIMES[extension] ?? null) : null
}
