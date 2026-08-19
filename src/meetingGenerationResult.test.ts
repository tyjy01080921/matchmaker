import { describe, expect, it } from 'vitest'
import {
  canConfirmMeetingGenerationFailure,
  makeMeetingGenerationWorkerResponse,
} from './meetingGenerationResult'
import { defaultSettings } from './defaultData'
import type { MeetingGenerationV2Resolution } from './matchmaker/engine'
import type { Schedule } from './types'

const failedSchedule: Schedule = {
  rounds: [
    {
      id: 'round-1',
      number: 1,
      matches: [],
      resting: [],
    },
  ],
  warnings: ['스페셜 참가 목표 미달: 23/24명'],
  specialCompletedIds: [],
  guestGameCounts: {},
}

describe('meeting generation failure result', () => {
  it('preserves a special target shortfall schedule for review', () => {
    const result: MeetingGenerationV2Resolution = {
      schedule: failedSchedule,
      resolvedSettings: defaultSettings,
      waitLimitFailure: null,
      failureIssues: ['스페셜 참가 목표 미달: 23/24명'],
    }

    expect(makeMeetingGenerationWorkerResponse(7, result)).toEqual({
      requestId: 7,
      schedule: failedSchedule,
      resolvedSettings: defaultSettings,
      failureIssues: ['스페셜 참가 목표 미달: 23/24명'],
      error: '스페셜 참가 목표 미달: 23/24명',
    })
  })

  it('allows confirmation only for reviewable operational failures', () => {
    expect(canConfirmMeetingGenerationFailure(
      ['스페셜 참가 목표 미달: 23/24명'],
      false,
    )).toBe(true)
    expect(canConfirmMeetingGenerationFailure(
      ['스페셜 참가 대상 부족: 23/24명'],
      false,
    )).toBe(true)
    expect(canConfirmMeetingGenerationFailure(
      ['연속 경기 제한 위반'],
      false,
    )).toBe(false)
    expect(canConfirmMeetingGenerationFailure([], true)).toBe(true)
    expect(canConfirmMeetingGenerationFailure([], true, 36)).toBe(true)
    expect(canConfirmMeetingGenerationFailure([], true, 48)).toBe(false)
    expect(canConfirmMeetingGenerationFailure(
      ['경기 인원 구성 오류'],
      true,
    )).toBe(false)
  })
})
