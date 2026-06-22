import { describe, it, expect } from 'vitest'
import { mapDbVerdictToFork } from '@/lib/diagnostics/diagram/verdict-vocab'

describe('mapDbVerdictToFork', () => {
  it("maps 'ok' to 'pass'", () => {
    expect(mapDbVerdictToFork('ok')).toBe('pass')
  })

  it("maps 'fail' to 'fail'", () => {
    expect(mapDbVerdictToFork('fail')).toBe('fail')
  })

  it("maps 'warn' to 'neutral'", () => {
    expect(mapDbVerdictToFork('warn')).toBe('neutral')
  })

  it("maps 'impossible' to 'neutral'", () => {
    expect(mapDbVerdictToFork('impossible')).toBe('neutral')
  })

  it("maps '' (empty string) to 'neutral'", () => {
    expect(mapDbVerdictToFork('')).toBe('neutral')
  })

  it("maps 'garbage' to 'neutral'", () => {
    expect(mapDbVerdictToFork('garbage')).toBe('neutral')
  })

  it("maps ' OK ' (padded, uppercase) to 'pass'", () => {
    expect(mapDbVerdictToFork(' OK ')).toBe('pass')
  })
})
