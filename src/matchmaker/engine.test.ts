import { describe, expect, it } from 'vitest'
import {
  defaultMatchConditionOptions,
  defaultSettings,
  samplePlayers,
} from '../defaultData'
import type { MatchSettings, Player } from '../types'
import {
  generateMeetingScheduleV2,
  generateMeetingScheduleV2WithWaitResolution,
  planMeetingSlotsV2,
} from './engine'
import { resolveMeetingRuleProfile } from './rules'
import { analyzeMeetingScheduleV2 } from './validation'

const makePlayers = (
  regularCount: number,
  guestCount = 0,
): Player[] => [
  ...Array.from({ length: guestCount }, (_, index): Player => ({
    id: `guest-${index + 1}`,
    name: `스페셜 ${index + 1}`,
    level: '스페셜',
    ageGroup: '무관',
    gender: 'none',
    active: true,
    specialRequired: false,
    isGuest: true,
    guestGameLimit: 0,
  })),
  ...Array.from({ length: regularCount }, (_, index): Player => ({
    id: `regular-${index + 1}`,
    name: `${index + 1}번`,
    level: index % 5 === 0
      ? 'A'
      : index % 5 === 1
        ? 'B'
        : index % 5 === 2
          ? 'C'
          : index % 5 === 3
            ? 'D'
            : 'E',
    ageGroup: index % 3 === 0 ? '30대' : index % 3 === 1 ? '40대' : '50대',
    gender: index % 3 === 0 ? 'female' : 'male',
    active: true,
    specialRequired: guestCount > 0,
    isGuest: false,
    guestGameLimit: 0,
  })),
]

const largeSettings: MatchSettings = {
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

describe('meeting V2 rules', () => {
  it('keeps structural and success rules separate from ordered preferences', () => {
    const profile = resolveMeetingRuleProfile({
      ...defaultSettings,
      shuffleDirection: 'wait',
      conditionOptions: {
        ...defaultMatchConditionOptions,
        fairGames: false,
        waitPriority: false,
        strictSkillLimit: true,
        levelBalance: false,
      },
    })

    expect(profile.conditions.fairGames).toBe(true)
    expect(profile.conditions.waitPriority).toBe(true)
    expect(profile.conditions.levelBalance).toBe(true)
    expect(profile.hard.strictSkillLimit).toBe(true)
    expect(profile.success).toMatchObject({
      requireEveryStandardPlayer: true,
      maxStandardGameSpread: 1,
      maxWaitMinutes: 25,
    })
    expect(profile.priorityOrder.slice(0, 3)).toEqual([
      'wait',
      'games',
      'skill',
    ])
  })
})

describe('meeting V2 slot planning', () => {
  it('plans 12-minute general games around eight 15-minute special games without waste', () => {
    const slots = planMeetingSlotsV2(makePlayers(56, 1), largeSettings)
    expect(slots.filter((slot) => slot.kind === 'special')).toHaveLength(8)
    expect(slots.filter((slot) => slot.kind === 'general')).toHaveLength(80)

    for (let court = 1; court <= largeSettings.courtCount; court += 1) {
      const courtSlots = slots
        .filter((slot) => slot.court === court)
        .sort((left, right) => left.start - right.start)
      for (let index = 1; index < courtSlots.length; index += 1) {
        expect(
          courtSlots[index - 1].start + courtSlots[index - 1].duration,
        ).toBeLessThanOrEqual(courtSlots[index].start)
      }
    }
  })
})

describe('meeting V2 generation', () => {
  it('satisfies structural, fairness, and wait requirements for a normal meeting', () => {
    const players = makePlayers(16)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 3,
      startTime: '18:00',
      endTime: '19:00',
      normalGameMinutes: 10,
      targetRoundCount: 6,
      pacingRoundCount: 6,
      roundCountLocked: true,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        specialMatchCreation: false,
      },
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)

    expect(metrics.structuralIssues).toEqual([])
    expect(metrics.zeroGameStandardParticipants).toBe(0)
    expect(metrics.standardGameSpread).toBeLessThanOrEqual(1)
    expect(metrics.maximumWaitMinutes).toBeLessThanOrEqual(25)
  })

  it('fills the mixed-duration large schedule and reaches the special target', () => {
    const players = makePlayers(56, 1)
    const schedule = generateMeetingScheduleV2(players, largeSettings)
    const metrics = analyzeMeetingScheduleV2(schedule, players, largeSettings)
    const matches = schedule.rounds.flatMap((round) => round.matches)

    expect(metrics.structuralIssues).toEqual([])
    expect(matches).toHaveLength(88)
    expect(matches.filter((match) => match.isSpecial)).toHaveLength(8)
    expect(schedule.specialCompletedIds).toHaveLength(24)
    expect(metrics.zeroGameStandardParticipants).toBe(0)
    expect(metrics.standardGameSpread).toBeLessThanOrEqual(1)
    expect(metrics.maximumWaitMinutes).toBeLessThanOrEqual(25)
  }, 20000)

  it('returns the same schedule for the same input and seed', () => {
    const players = makePlayers(20, 1)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 4,
      startTime: '18:00',
      endTime: '19:30',
      specialLimitEnabled: true,
      specialGameLimit: 4,
      specialParticipantTarget: 12,
      specialTimeLimitEnabled: false,
    }
    const first = generateMeetingScheduleV2(players, settings)
    const second = generateMeetingScheduleV2(players, settings)
    expect(second).toEqual(first)
  })

  it('reports an operational failure without recalculating every alternative', () => {
    const players = makePlayers(47)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 4,
      startTime: '18:00',
      endTime: '19:00',
      conditionOptions: {
        ...defaultMatchConditionOptions,
        specialMatchCreation: false,
      },
    }
    const result = generateMeetingScheduleV2WithWaitResolution(
      players,
      settings,
      3,
    )

    expect(result.waitLimitFailure).not.toBeNull()
    expect(result.waitLimitFailure?.searchedScheduleCount).toBeLessThanOrEqual(3)
    expect(
      result.waitLimitFailure?.recommendations.every(
        (recommendation) => !recommendation.verified,
      ),
    ).toBe(true)
  })

  it('treats strict skill danger as a hard candidate constraint', () => {
    const players = [
      ...makePlayers(2).map((player) => ({ ...player, level: 'A' as const })),
      ...makePlayers(2).map((player, index) => ({
        ...player,
        id: `strict-e-${index + 1}`,
        level: 'E' as const,
      })),
    ]
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:15',
      targetRoundCount: 1,
      pacingRoundCount: 1,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        strictSkillLimit: true,
      },
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    expect(schedule.rounds.flatMap((round) => round.matches)).toHaveLength(0)
  })

  it('keeps a large strict meeting within skill, fairness, and wait limits', () => {
    const players = makePlayers(40)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 5,
      startTime: '18:00',
      endTime: '20:00',
      normalGameMinutes: 12,
      targetRoundCount: 10,
      pacingRoundCount: 10,
      roundCountLocked: true,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        specialMatchCreation: false,
        strictSkillLimit: true,
      },
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)

    expect(metrics.structuralIssues).toEqual([])
    expect(metrics.skillDangerMatches).toBe(0)
    expect(metrics.skillCautionMatches).toBeLessThanOrEqual(5)
    expect(metrics.standardGameSpread).toBeLessThanOrEqual(1)
    expect(metrics.maximumWaitMinutes).toBeLessThanOrEqual(25)
  }, 20000)

  it('stops at two identical four-player meetings when repetition protection is on', () => {
    const players = makePlayers(4)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '19:00',
      targetRoundCount: 3,
      pacingRoundCount: 3,
      roundCountLocked: true,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        specialMatchCreation: false,
        levelBalance: false,
      },
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    expect(schedule.rounds.flatMap((round) => round.matches)).toHaveLength(2)
    expect(schedule.warnings).toContain(
      '동일 4인 2회 제한으로 일부 코트가 비었습니다.',
    )
  })

  it('can place multiple guests together only when the setting allows it', () => {
    const players = makePlayers(2, 2)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:30',
      targetRoundCount: 2,
      pacingRoundCount: 2,
      singleGuestPerMatch: false,
      specialLimitEnabled: true,
      specialGameLimit: 1,
      specialParticipantTarget: 3,
      specialTimeLimitEnabled: false,
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const firstMatch = schedule.rounds.flatMap((round) => round.matches)[0]
    expect([...firstMatch.teamA, ...firstMatch.teamB].filter((player) => player.isGuest))
      .toHaveLength(2)
  })

  it('generates the built-in operational sample without a hard failure', () => {
    expect(
      planMeetingSlotsV2(samplePlayers, defaultSettings).filter(
        (slot) => slot.kind === 'special',
      ),
    ).toHaveLength(14)
    const result = generateMeetingScheduleV2WithWaitResolution(
      samplePlayers,
      defaultSettings,
      3,
    )
    const metrics = analyzeMeetingScheduleV2(
      result.schedule,
      samplePlayers,
      defaultSettings,
    )
    expect(metrics.structuralIssues).toEqual([])
    expect(metrics.zeroGameStandardParticipants).toBe(0)
    expect(metrics.standardGameSpread).toBeLessThanOrEqual(1)
    expect(result.failureIssues).toEqual([])
  }, 20000)
})
