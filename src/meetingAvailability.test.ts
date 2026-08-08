import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaultData'
import {
  attendanceTargetGameCount,
  attendanceWindowIssue,
  isPlayerAvailableForMeetingSlot,
  meetingAttendanceTimeLabel,
  meetingClockTimeToOffset,
  resolveMeetingAttendanceWindow,
} from './meetingAvailability'
import type { Player } from './types'

const player = (overrides: Partial<Player> = {}): Player => ({
  id: 'p1',
  name: '참가자',
  level: 'B',
  ageGroup: '30대',
  gender: 'male',
  active: true,
  specialRequired: false,
  isGuest: false,
  guestGameLimit: 0,
  ...overrides,
})

describe('meeting participant attendance window', () => {
  it('uses the whole meeting when no participant time is stored', () => {
    const settings = {
      ...defaultSettings,
      startTime: '18:00',
      endTime: '20:00',
    }

    expect(resolveMeetingAttendanceWindow(player(), settings)).toEqual({
      start: 0,
      end: 120,
      duration: 120,
      isCustom: false,
      priority: false,
    })
    expect(meetingAttendanceTimeLabel(player(), settings)).toBe('18:00–20:00')
  })

  it('converts clock input safely inside a meeting that crosses midnight', () => {
    const settings = {
      ...defaultSettings,
      startTime: '23:00',
      endTime: '01:00',
    }

    expect(meetingClockTimeToOffset('23:30', settings)).toBe(30)
    expect(meetingClockTimeToOffset('00:30', settings)).toBe(90)
    expect(meetingClockTimeToOffset('02:00', settings)).toBeNull()
  })

  it('scales a normal target and lets priority aim for the full average', () => {
    const settings = {
      ...defaultSettings,
      startTime: '18:00',
      endTime: '20:00',
      normalGameMinutes: 15 as const,
    }
    const partial = player({
      arrivalOffsetMinutes: 30,
      departureOffsetMinutes: 90,
    })

    expect(attendanceTargetGameCount(partial, settings, 6, 4)).toBe(3)
    expect(attendanceTargetGameCount(
      { ...partial, attendancePriority: true },
      settings,
      6,
      4,
    )).toBe(4)
  })

  it('reports an attendance window shorter than one match', () => {
    const settings = {
      ...defaultSettings,
      normalGameMinutes: 15 as const,
    }
    expect(attendanceWindowIssue(player({ departureOffsetMinutes: 10 }), settings))
      .toBe('참가자 참석 시간이 15분보다 짧습니다.')
  })

  it('only turns an explicit participant window into a hard boundary', () => {
    const settings = {
      ...defaultSettings,
      startTime: '18:00',
      endTime: '18:30',
    }
    expect(resolveMeetingAttendanceWindow(player(), settings).isCustom).toBe(false)
    expect(resolveMeetingAttendanceWindow(
      player({ departureOffsetMinutes: 20 }),
      settings,
    ).isCustom).toBe(true)
    expect(isPlayerAvailableForMeetingSlot(player(), settings, 30, 15)).toBe(true)
    expect(isPlayerAvailableForMeetingSlot(
      player({ departureOffsetMinutes: 20 }),
      settings,
      15,
      15,
    )).toBe(false)
  })
})
