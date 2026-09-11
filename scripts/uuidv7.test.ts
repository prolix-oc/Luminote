import { describe, expect, test } from 'bun:test'

import { uuidv7 } from '../src/shared/uuid'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuidv7', () => {
  test('encodes the current Unix timestamp', () => {
    const before = Date.now()
    const id = uuidv7()
    const after = Date.now()
    const encodedTimestamp = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)

    expect(encodedTimestamp).toBeGreaterThanOrEqual(before)
    expect(encodedTimestamp).toBeLessThanOrEqual(after)
  })

  test('generates valid, unique, ordered IDs within one millisecond', () => {
    const originalNow = Date.now
    const fixedNow = originalNow()
    Date.now = () => fixedNow

    try {
      const ids = Array.from({ length: 10_000 }, () => uuidv7())
      expect(ids.every((id) => UUID_V7.test(id))).toBe(true)
      expect(new Set(ids).size).toBe(ids.length)
      expect([...ids].sort()).toEqual(ids)
    } finally {
      Date.now = originalNow
    }
  })
})
