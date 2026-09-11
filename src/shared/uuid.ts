/**
 * Generate a time-ordered UUIDv7 (RFC 9562).
 *
 * `crypto.getRandomValues()` is intentionally used because browsers expose it
 * in insecure contexts as well as secure ones. Calls in the same millisecond
 * increment the random payload so IDs remain unique and lexicographically
 * ordered.
 */

const RANDOM_BITS = 74n
const RANDOM_MASK = (1n << RANDOM_BITS) - 1n
const RAND_B_MASK = (1n << 62n) - 1n
const MAX_TIMESTAMP = 0xffffffffffff

let lastTimestamp = -1
let lastRandom = 0n

function random74Bits(): bigint {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('UUIDv7 generation requires crypto.getRandomValues()')
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(10))
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value & RANDOM_MASK
}

export function uuidv7(): string {
  let timestamp = Date.now()
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > MAX_TIMESTAMP) {
    throw new Error('UUIDv7 timestamp is outside the supported 48-bit range')
  }

  let random: bigint
  if (timestamp > lastTimestamp) {
    random = random74Bits()
  } else {
    timestamp = lastTimestamp
    random = lastRandom + 1n

    // Practically unreachable, but preserve uniqueness if all 74 values in a
    // millisecond are exhausted or the clock remains behind for that long.
    if (random > RANDOM_MASK) {
      timestamp += 1
      if (timestamp > MAX_TIMESTAMP) throw new Error('UUIDv7 timestamp overflow')
      random = random74Bits()
    }
  }

  lastTimestamp = timestamp
  lastRandom = random

  const randA = random >> 62n
  const randB = random & RAND_B_MASK
  const value = (BigInt(timestamp) << 80n)
    | (0x7n << 76n)
    | (randA << 64n)
    | (0x2n << 62n)
    | randB
  const hex = value.toString(16).padStart(32, '0')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
