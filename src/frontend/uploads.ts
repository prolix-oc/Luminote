/**
 * Staged uploads — Lumiverse's documented way to get large files from an
 * extension frontend to its backend (developer-docs/backend-api/uploads.md):
 * the browser streams the file to the host's tus endpoint
 * `/api/v1/spindle-uploads`, the worker pulls it by id with
 * `spindle.uploads.get()`.
 *
 * Why: the extension messaging channel is JSON with a 4 MB cap
 * (SPINDLE_BACKEND_MSG). Streaming keeps the channel tiny (a 36-char id),
 * dodges base64 inflation, and keeps worker heartbeats healthy.
 *
 * Minimal tus 1.0.0 core+creation client in two requests — POST create
 * (Upload-Length + Upload-Metadata) then one PATCH with the full body at
 * offset 0. Chunking/resume is unnecessary for ≤16 MB images on a local hop,
 * and adding tus-js-client for that alone isn't worth the dependency.
 */
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

const TUS_ENDPOINT = '/api/v1/spindle-uploads'
const TUS_VERSION = '1.0.0'

/** `key base64(value)` pairs, UTF-8 safe (Upload-Metadata spec). */
function tusMetadata(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([key, value]) => `${key} ${btoa(unescape(encodeURIComponent(value)))}`)
    .join(',')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Stream `bytes` to the host and return the staged upload id for the
 * backend to consume (via spindle.uploads.get). Throws with a readable
 * message on any transport failure.
 */
export async function stageUpload(
  ctx: SpindleFrontendContext,
  bytes: Uint8Array,
  filename: string,
): Promise<string> {
  const extension = isRecord(ctx.manifest) && typeof ctx.manifest.identifier === 'string'
    ? ctx.manifest.identifier
    : 'luminote'

  const create = await fetch(TUS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Tus-Resumable-Version': TUS_VERSION,
      'Upload-Length': String(bytes.byteLength),
      'Upload-Metadata': tusMetadata({ filename, extension }),
    },
  }).catch((err) => {
    throw new Error(`Upload staging failed: ${err instanceof Error ? err.message : String(err)}`)
  })
  if (!create.ok) throw new Error(`Upload staging failed (HTTP ${create.status})`)

  const location = create.headers.get('Location')
  if (!location) throw new Error('Upload staging failed (host returned no upload location)')
  const uploadUrl = new URL(location, window.location.href).toString()

  const patch = await fetch(uploadUrl, {
    method: 'PATCH',
    headers: {
      'Tus-Resumable-Version': TUS_VERSION,
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
    },
    body: bytes.slice().buffer as ArrayBuffer,
  }).catch((err) => {
    throw new Error(`Upload staging failed: ${err instanceof Error ? err.message : String(err)}`)
  })
  if (!patch.ok) throw new Error(`Upload staging failed (HTTP ${patch.status})`)

  const uploadId = uploadUrl.split('/').filter(Boolean).pop()
  if (!uploadId) throw new Error('Upload staging failed (no upload id)')
  return uploadId
}
