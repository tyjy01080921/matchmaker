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

const makeClubPlayers = (regularCount: number): Player[] =>
  Array.from({ length: regularCount }, (_, index): Player => ({
    id: `club-${index + 1}`,
    name: `동호인 ${index + 1}`,
    level: 'C',
    ageGroup: '30대',
    gender: index % 2 === 0 ? 'male' : 'female',
    active: true,
    specialRequired: false,
    isGuest: false,
    guestGameLimit: 0,
  }))

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
    expect(profile.conditions.genderBalance).toBe(true)
    expect(profile.conditions.groupRepeat).toBe(true)
    expect(profile.hard.strictSkillLimit).toBe(false)
    expect(profile.success).toMatchObject({
      requireEveryStandardPlayer: true,
      maxStandardGameSpread: 1,
      maxWaitMinutes: 25,
    })
    expect(profile.priorityOrder.slice(0, 3)).toEqual([
      'games',
      'wait',
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
  it.each([
    { regularCount: 20, courtCount: 3 },
    { regularCount: 30, courtCount: 4 },
    { regularCount: 35, courtCount: 3 },
  ])(
    'automatically moves $regularCount players from warmup to tight matches on $courtCount courts',
    ({ regularCount, courtCount }) => {
      const players = makeClubPlayers(regularCount)
      const settings: MatchSettings = {
        ...defaultSettings,
        courtCount,
        startTime: '18:00',
        endTime: '21:00',
        normalGameMinutes: 12,
        targetRoundCount: 15,
        pacingRoundCount: 15,
        roundCountLocked: true,
        conditionOptions: {
          ...defaultMatchConditionOptions,
          specialMatchCreation: false,
        },
      }
      const schedule = generateMeetingScheduleV2(players, settings)
      const metrics = analyzeMeetingScheduleV2(schedule, players, settings)
      const earliestCompleteStart =
        (Math.ceil(regularCount / (courtCount * 4)) - 1) *
        settings.normalGameMinutes

      expect(metrics.structuralIssues).toEqual([])
      expect(metrics.maximumInitialWaitMinutes).toBeLessThanOrEqual(
        earliestCompleteStart,
      )
      expect(metrics.participantsBelowTightMinimum).toBe(0)
      expect(metrics.participantsAtTightTarget).toBeGreaterThanOrEqual(
        Math.ceil(regularCount * 0.8),
      )
      expect(metrics.postWarmupGenderExceptionMatches).toBe(0)
      expect(metrics.standardGameSpread).toBeLessThanOrEqual(1)
    },
    20000,
  )

  it('uses the first match as warmup even when strict skill limits are enabled', () => {
    const players = [
      ...makePlayers(2).map((player) => ({
        ...player,
        level: 'A' as const,
        gender: 'male' as const,
      })),
      ...makePlayers(2).map((player, index) => ({
        ...player,
        id: `warmup-e-${index + 1}`,
        level: 'E' as const,
        gender: 'female' as const,
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
    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)

    expect(schedule.rounds.flatMap((round) => round.matches)).toHaveLength(1)
    expect(metrics.warmupMatches).toBe(1)
    expect(metrics.tightMatches).toBe(0)
  })

  it('names a participant when two tight matches are impossible', () => {
    const players = makeClubPlayers(20).map((player, index) => ({
      ...player,
      level: index === 0 ? ('A' as const) : ('C' as const),
      matchLevelTier: index === 0 ? 1 : 6,
    }))
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 3,
      startTime: '18:00',
      endTime: '21:00',
      normalGameMinutes: 12,
      targetRoundCount: 15,
      pacingRoundCount: 15,
      roundCountLocked: true,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        specialMatchCreation: false,
      },
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)

    expect(metrics.maximumInitialWaitMinutes).toBeLessThanOrEqual(12)
    expect(metrics.tightGameCounts[players[0].id]).toBeLessThan(2)
    expect(schedule.warnings).toContain(
      '타이트 경기 2회 미달: 동호인 1 · 유사 실력·성별 또는 운영 여건 확인',
    )
  }, 20000)

  it('pairs balanced mixed matches as one man and one woman per team', () => {
    const players = makeClubPlayers(4)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:30',
      normalGameMinutes: 15,
      targetRoundCount: 2,
      pacingRoundCount: 2,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        specialMatchCreation: false,
      },
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const matches = schedule.rounds.flatMap((round) => round.matches)
    const second = matches[1]
    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)

    expect(second.teamA.map((player) => player.gender).sort()).toEqual([
      'female',
      'male',
    ])
    expect(second.teamB.map((player) => player.gender).sort()).toEqual([
      'female',
      'male',
    ])
    expect(metrics.postWarmupBalancedMixedMatches).toBe(1)
    expect(metrics.postWarmupGenderExceptionMatches).toBe(0)
  })

  it('prioritizes two preferred pairings without counting their repetition', () => {
    const players = makeClubPlayers(4).map((player) => ({ ...player }))
    players[0].preferredPartnerIds = [players[1].id]
    players[2].preferredPartnerIds = [players[3].id]
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:30',
      normalGameMinutes: 15,
      targetRoundCount: 2,
      pacingRoundCount: 2,
      roundCountLocked: true,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        specialMatchCreation: false,
      },
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const matches = schedule.rounds.flatMap((round) => round.matches)
    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)

    const usesBothPreferredTeams = (match: (typeof matches)[number]) =>
      [match.teamA, match.teamB].every((team) =>
        (
          team.some((player) => player.id === players[0].id) &&
          team.some((player) => player.id === players[1].id)
        ) ||
        (
          team.some((player) => player.id === players[2].id) &&
          team.some((player) => player.id === players[3].id)
        ),
      )

    expect(matches).toHaveLength(2)
    expect(matches.every(usesBothPreferredTeams)).toBe(true)
    expect(metrics.maximumPartnerMeetings).toBe(0)
    expect(metrics.repeatedPartnerAssignments).toBe(0)
  })

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

  it('keeps final idle as information instead of an operational failure', () => {
    const players = makeClubPlayers(8)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '20:00',
      targetRoundCount: 1,
      pacingRoundCount: 1,
      roundCountLocked: true,
    }
    const generated = generateMeetingScheduleV2(players, settings)
    const schedule = { ...generated, rounds: generated.rounds.slice(0, 2) }
    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)

    expect(metrics.maximumFinalIdleMinutes).toBeGreaterThan(25)
    expect(metrics.maximumWaitMinutes).toBe(0)
    expect(metrics.participantsOverWaitLimit).toBe(0)
    expect(metrics.successIssues).toEqual([])
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

  it('reports an operational failure with recalculated alternatives only', () => {
    const players = makePlayers(47)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 4,
      startTime: '18:00',
      endTime: '19:00',
      normalGameMinutes: 15,
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
    expect(result.waitLimitFailure?.recommendations.length).toBeGreaterThan(0)
    expect(
      result.waitLimitFailure?.recommendations.every(
        (recommendation) =>
          recommendation.verified &&
          recommendation.outcome.participantsOverLimit === 0,
      ),
    ).toBe(true)
  }, 20000)

  it('keeps a large legacy meeting within fairness and wait limits', () => {
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
    expect(metrics.standardGameSpread).toBeLessThanOrEqual(1)
    expect(metrics.maximumWaitMinutes).toBeLessThanOrEqual(25)
  }, 20000)

  it('uses the 15-minute special match for every available unplayed participant', () => {
    let regularIndex = 0
    const players = makePlayers(30, 1).map((player) => {
      if (player.isGuest) return player
      const index = regularIndex
      regularIndex += 1
      return {
        ...player,
        level: index < 2
          ? 'A' as const
          : index >= 28
            ? 'E' as const
            : 'C' as const,
      }
    })
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 4,
      startTime: '18:00',
      endTime: '21:00',
      normalGameMinutes: 12,
      seed: 1,
      targetRoundCount: 12,
      pacingRoundCount: 12,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 8,
      specialParticipantTarget: 24,
      specialTimeLimitEnabled: true,
      specialTimeLimitMinutes: 120,
      specialLowPriorityEnabled: false,
      specialHighPriorityEnabled: true,
      specialHighPriorityPercent: 70,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        strictSkillLimit: false,
      },
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const matches = schedule.rounds.flatMap((round) => round.matches)
    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)
    const firstFifteenMinuteSpecial = matches.find(
      (match) =>
        match.isSpecial &&
        match.startOffsetMinutes === 15,
    )
    const playedBeforeFifteen = new Set(
      matches
        .filter((match) => (match.startOffsetMinutes ?? 0) < 15)
        .flatMap((match) => [...match.teamA, ...match.teamB])
        .filter((player) => !player.isGuest)
        .map((player) => player.id),
    )
    const unplayedBeforeFifteen = players.filter(
      (player) =>
        !player.isGuest &&
        !playedBeforeFifteen.has(player.id),
    )
    const specialRegularIds = new Set(
      firstFifteenMinuteSpecial
        ? [...firstFifteenMinuteSpecial.teamA, ...firstFifteenMinuteSpecial.teamB]
            .filter((player) => !player.isGuest)
            .map((player) => player.id)
        : [],
    )

    expect(matches).toHaveLength(58)
    expect(matches.filter((match) => match.isSpecial)).toHaveLength(8)
    expect(schedule.specialCompletedIds).toHaveLength(24)
    expect(firstFifteenMinuteSpecial).toBeDefined()
    expect(unplayedBeforeFifteen.length).toBeGreaterThan(0)
    expect(unplayedBeforeFifteen.length).toBeLessThanOrEqual(3)
    expect(
      unplayedBeforeFifteen.every((player) =>
        specialRegularIds.has(player.id),
      ),
    ).toBe(true)
    expect(metrics.structuralIssues).toEqual([])
    expect(metrics.successIssues).toEqual([])
    expect(metrics.maximumInitialWaitMinutes).toBeLessThanOrEqual(15)
    expect(metrics.maximumBetweenWaitMinutes).toBeLessThanOrEqual(25)
    expect(metrics.maximumFinalIdleMinutes).toBeLessThanOrEqual(25)
    expect(metrics.participantsOverWaitLimit).toBe(0)
    expect(metrics.standardGameSpread).toBeLessThanOrEqual(1)
    expect(metrics.maximumGroupMeetings).toBeLessThanOrEqual(2)
  }, 20000)

  it('fills the remaining special seat with a previously played participant', () => {
    const players = makePlayers(29, 1)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 4,
      startTime: '18:00',
      endTime: '21:00',
      normalGameMinutes: 12,
      targetRoundCount: 12,
      pacingRoundCount: 12,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 8,
      specialParticipantTarget: 24,
      specialTimeLimitEnabled: true,
      specialTimeLimitMinutes: 120,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        strictSkillLimit: false,
      },
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const matches = schedule.rounds.flatMap((round) => round.matches)
    const secondSpecial = matches.find(
      (match) =>
        match.isSpecial &&
        match.startOffsetMinutes === 15,
    )
    const playedBeforeFifteen = new Set(
      matches
        .filter((match) => (match.startOffsetMinutes ?? 0) < 15)
        .flatMap((match) => [...match.teamA, ...match.teamB])
        .filter((player) => !player.isGuest)
        .map((player) => player.id),
    )
    const unplayedBeforeFifteen = players.filter(
      (player) =>
        !player.isGuest &&
        !playedBeforeFifteen.has(player.id),
    )
    const secondSpecialRegulars = secondSpecial
      ? [...secondSpecial.teamA, ...secondSpecial.teamB].filter(
          (player) => !player.isGuest,
        )
      : []
    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)

    expect(unplayedBeforeFifteen).toHaveLength(2)
    expect(
      unplayedBeforeFifteen.every((player) =>
        secondSpecialRegulars.some((candidate) => candidate.id === player.id),
      ),
    ).toBe(true)
    expect(
      secondSpecialRegulars.filter((player) =>
        playedBeforeFifteen.has(player.id),
      ),
    ).toHaveLength(1)
    expect(matches.filter((match) => match.isSpecial)).toHaveLength(8)
    expect(schedule.specialCompletedIds).toHaveLength(24)
    expect(metrics.maximumInitialWaitMinutes).toBeLessThanOrEqual(15)
    expect(metrics.maximumBetweenWaitMinutes).toBeLessThanOrEqual(25)
    expect(metrics.maximumFinalIdleMinutes).toBeLessThanOrEqual(25)
    expect(metrics.standardGameSpread).toBeLessThanOrEqual(1)
    expect(metrics.maximumGroupMeetings).toBeLessThanOrEqual(2)
    expect(metrics.structuralIssues).toEqual([])
    expect(metrics.successIssues).toEqual([])
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
