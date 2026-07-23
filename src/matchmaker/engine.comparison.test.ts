import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../defaultData'
import {
  analyzeScheduleQuality,
  analyzeScheduleWait,
  generateScheduleWithWaitOptimization,
} from '../matchmaker'
import type { MatchSettings, Player } from '../types'
import { generateMeetingScheduleV2Optimized } from './engine'
import { analyzeMeetingScheduleV2 } from './validation'

const makeComparisonPlayers = (): Player[] => [
  {
    id: 'comparison-guest',
    name: '스페셜',
    level: '스페셜',
    ageGroup: '무관',
    gender: 'none',
    active: true,
    specialRequired: false,
    isGuest: true,
    guestGameLimit: 0,
  },
  ...Array.from({ length: 56 }, (_, index): Player => ({
    id: `comparison-${index + 1}`,
    name: `${index + 1}번`,
    level: index < 12
      ? 'A'
      : index < 24
        ? 'B'
        : index < 36
          ? 'C'
          : index < 46
            ? 'D'
            : 'E',
    ageGroup: index % 3 === 0 ? '30대' : index % 3 === 1 ? '40대' : '50대',
    gender: index % 3 === 0 ? 'female' : 'male',
    active: true,
    specialRequired: true,
    isGuest: false,
    guestGameLimit: 0,
  })),
]

const settings: MatchSettings = {
  ...defaultSettings,
  courtCount: 6,
  startTime: '08:30',
  endTime: '11:30',
  normalGameMinutes: 12,
  targetRoundCount: 12,
  pacingRoundCount: 12,
  roundCountLocked: true,
  specialLimitEnabled: true,
  specialGameLimitEnabled: true,
  specialGameLimit: 8,
  specialParticipantTarget: 24,
  specialTimeLimitEnabled: false,
}

describe('meeting V2 comparison gate', () => {
  it('matches the legacy capacity while preserving required quality bounds', () => {
    const players = makeComparisonPlayers()
    const legacy = generateScheduleWithWaitOptimization(players, settings, 1)
    const legacyQuality = analyzeScheduleQuality(legacy, players, settings)
    const legacyWait = analyzeScheduleWait(legacy, players, settings)
    const selected = generateMeetingScheduleV2Optimized(players, settings, 3)
    const v2 = selected.schedule
    const v2Quality = analyzeScheduleQuality(v2, players, settings)
    const v2Wait = analyzeScheduleWait(v2, players, settings)
    const v2Independent = analyzeMeetingScheduleV2(v2, players, settings)
    const legacyMatches = legacy.rounds.flatMap((round) => round.matches)
    const v2Matches = v2.rounds.flatMap((round) => round.matches)

    expect(v2Independent.structuralIssues).toEqual([])
    expect(v2Matches).toHaveLength(legacyMatches.length)
    expect(v2Quality.zeroGameStandardParticipants).toBe(0)
    expect(v2Quality.standardGameSpread).toBeLessThanOrEqual(
      Math.max(1, legacyQuality.standardGameSpread),
    )
    expect(v2Wait.maximumWaitMinutes).toBeLessThanOrEqual(
      Math.max(25, legacyWait.maximumWaitMinutes),
    )
    expect(v2Quality.maximumGroupMeetings).toBeLessThanOrEqual(2)
    expect(v2Quality.teamSkillDangerMatches).toBeLessThanOrEqual(
      legacyQuality.teamSkillDangerMatches,
    )
  }, 30000)
})
