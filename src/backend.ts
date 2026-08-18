/**
 * Luminote backend entry point.
 *
 * Runs in an isolated Bun worker. All persistence lives behind
 * `spindle.storage.*`; all client traffic is zod-validated in the router.
 * This entry is intentionally thin — logic lives in `src/backend/`.
 */
import { registerIpc } from './backend/router'

declare const spindle: import('lumiverse-spindle-types').SpindleAPI

registerIpc()

spindle.log.info('Luminote backend loaded')
