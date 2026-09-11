/**
 * Typed request/response client over `ctx.sendToBackend` /
 * `ctx.onBackendMessage`. One shared subscription demultiplexes pending
 * requests by id; `changed` events from the backend are fanned out to
 * topic subscribers.
 */
import { isIpcEnvelope, type IpcEvent, type IpcRequest, type IpcResponse, type OpName } from '../shared/model'
import { uuidv7 } from '../shared/uuid'
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

interface PendingRequest {
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface RpcClient {
  call<T>(op: OpName, payload?: unknown, timeoutMs?: number): Promise<T>
  onChanged(handler: (topic: string, vaultId?: string) => void): () => void
  destroy(): void
}

export function createRpc(ctx: SpindleFrontendContext): RpcClient {
  const pending = new Map<string, PendingRequest>()
  const changeHandlers = new Set<(topic: string, vaultId?: string) => void>()
  let destroyed = false

  const unsubscribe = ctx.onBackendMessage((payload: unknown) => {
    if (!isIpcEnvelope(payload)) return

    if (payload.kind === 'res') {
      const res = payload as IpcResponse
      const waiter = pending.get(res.id)
      if (!waiter) return
      pending.delete(res.id)
      clearTimeout(waiter.timer)
      if (typeof res.error === 'string') waiter.reject(new Error(res.error))
      else waiter.resolve(res.payload)
      return
    }

    if (payload.kind === 'event') {
      const event = payload as IpcEvent
      if (event.event !== 'changed') return
      const data = event.payload as { topic?: unknown; vaultId?: unknown }
      const topic = typeof data?.topic === 'string' ? data.topic : ''
      const vaultId = typeof data?.vaultId === 'string' ? data.vaultId : undefined
      if (!topic) return
      for (const handler of changeHandlers) {
        try {
          handler(topic, vaultId)
        } catch {
          // Subscriber errors must not break the fanout.
        }
      }
    }
  })

  return {
    call<T>(op: OpName, payload: unknown = {}, timeoutMs = 30_000): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (destroyed) {
          reject(new Error('RPC client destroyed'))
          return
        }
        const id = uuidv7()
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`${op} timed out — is the Luminote backend running?`))
        }, timeoutMs)

        pending.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
          timer,
        })

        const request: IpcRequest = { $luminote: 1, kind: 'req', id, op, payload }
        try {
          ctx.sendToBackend(request)
        } catch (err) {
          clearTimeout(timer)
          pending.delete(id)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    },

    onChanged(handler) {
      changeHandlers.add(handler)
      return () => changeHandlers.delete(handler)
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      unsubscribe()
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error('Extension torn down'))
      }
      pending.clear()
      changeHandlers.clear()
    },
  }
}
