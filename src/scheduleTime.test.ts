import { describe, expect, it } from 'vitest'
import {
  clockTimeAtOffset,
  getBookingDurationMinutes,
  getBookingRoundCount,
  normalizeClockTime,
  roundTimeRange,
} from './scheduleTime'

describe('schedule time', () => {
  it('converts a booking window into 15-minute rounds', () => {
    expect(getBookingDurationMinutes('18:00', '21:00')).toBe(180)
    expect(getBookingRoundCount('18:00', '21:00')).toBe(12)
    expect(roundTimeRange('18:00', 9)).toBe('20:00–20:15')
  })

  it('supports bookings that pass midnight', () => {
    expect(getBookingDurationMinutes('22:00', '01:00')).toBe(180)
    expect(clockTimeAtOffset('22:00', 180)).toBe('01:00')
  })

  it('normalizes clock inputs to the nearest slot', () => {
    expect(normalizeClockTime('18:08', '18:00')).toBe('18:15')
    expect(normalizeClockTime('invalid', '18:00')).toBe('18:00')
  })
})
