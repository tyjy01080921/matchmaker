import { describe, expect, it } from 'vitest'
import {
  defaultMatchConditionOptions,
  defaultSettings,
  samplePlayers,
} from '../defaultData'
import type { MatchSettings, Player, Schedule } from '../types'
import {
  generateMeetingScheduleV2,
  generateMeetingScheduleV2WithWaitResolution,
  insertConfiguredEventMatch,
  planMeetingSlotsV2,
} from './engine'
import {
  balancedParticipantGameTarget,
  MEETING_MAX_WAIT_MINUTES,
  plannedGuestGames,
  resolveMeetingRuleProfile,
} from './rules'
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
  it('inserts an event match while keeping other courts active and rests its players next', () => {
    const players = makePlayers(14, 2)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 4,
      courtAssignmentMode: 'available',
      startTime: '18:00',
      endTime: '20:00',
      normalGameMinutes: 12,
      seed: 13,
      targetRoundCount: 10,
      pacingRoundCount: 10,
      eventMatch: {
        enabled: true,
        startTime: '19:00',
        court: 1,
        participants: players.slice(0, 4).map((player) => ({
          name: player.name,
          playerId: player.id,
        })) as MatchSettings['eventMatch']['participants'],
      },
    }

    const slots = planMeetingSlotsV2(players, settings)
    expect(slots.some((slot) => slot.court === 1 && slot.start === 60)).toBe(false)
    expect(slots.some((slot) => slot.court === 2 && slot.start === 60)).toBe(true)

    const schedule = generateMeetingScheduleV2(players, settings)
    const matches = schedule.rounds.flatMap((round) => round.matches)
    const eventMatch = matches.find((match) => match.isEventMatch)
    expect(eventMatch).toMatchObject({
      court: 1,
      startOffsetMinutes: 60,
      durationMinutes: 12,
    })
    expect(
      matches.some(
        (match) =>
          !match.isEventMatch &&
          match.court === 2 &&
          match.startOffsetMinutes === 60,
      ),
    ).toBe(true)

    const eventPlayerIds = new Set(players.slice(0, 4).map((player) => player.id))
    const immediateAssignments = matches.filter(
      (match) =>
        !match.isEventMatch &&
        (match.startOffsetMinutes === 60 || match.startOffsetMinutes === 72),
    )
    expect(
      immediateAssignments.every((match) =>
        [...match.teamA, ...match.teamB].every(
          (player) => !eventPlayerIds.has(player.id),
        ),
      ),
    ).toBe(true)

    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)
    expect(
      Object.values(metrics.gameCounts).reduce((sum, count) => sum + count, 0),
    ).toBe(matches.length * 4)
    expect(metrics.structuralIssues).toEqual([])
  })

  it('counts every linked event participant as having played a special match', () => {
    const players = makePlayers(8, 1)
    const eventPlayers = players.slice(0, 4)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '20:00',
      normalGameMinutes: 12,
      eventMatch: {
        enabled: true,
        startTime: '19:00',
        court: 1,
        participants: eventPlayers.map((player) => ({
          name: player.name,
          playerId: player.id,
        })) as MatchSettings['eventMatch']['participants'],
      },
    }
    const baseSchedule: Schedule = {
      rounds: [{
        id: 'base-round',
        number: 1,
        matches: [{
          id: 'base-match',
          round: 1,
          court: 1,
          teamA: [players[4], players[5]],
          teamB: [players[6], players[7]],
          isSpecial: false,
          startOffsetMinutes: 0,
          durationMinutes: 12,
        }],
        resting: [],
      }],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: { [players[0].id]: 0 },
    }

    const inserted = insertConfiguredEventMatch(baseSchedule, settings, players)
    const reinserted = insertConfiguredEventMatch(inserted, settings, players)

    expect(reinserted.guestGameCounts[players[0].id]).toBe(1)
    expect(reinserted.specialCompletedIds).toEqual(
      expect.arrayContaining(eventPlayers.slice(1).map((player) => player.id)),
    )
    expect(reinserted.specialCompletedIds).not.toContain(players[4].id)
  })

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
      finalIdleLimitMinutes: 30,
    })
    expect(profile.priorityOrder.slice(0, 3)).toEqual([
      'games',
      'wait',
      'skill',
    ])
  })
})

describe('meeting V2 slot planning', () => {
  it('keeps each guest on one court in consecutive fixed-court slots', () => {
    const players = makePlayers(26, 2)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 3,
      courtAssignmentMode: 'fixed',
      startTime: '18:00',
      endTime: '21:00',
      normalGameMinutes: 10,
      singleGuestPerMatch: true,
      specialLimitEnabled: false,
    }
    const specialSlots = planMeetingSlotsV2(players, settings)
      .filter((slot) => slot.kind === 'special')

    expect(specialSlots).toHaveLength(36)
    for (const [guestIndex, guestId] of ['guest-1', 'guest-2'].entries()) {
      const guestSlots = specialSlots.filter((slot) => slot.guestId === guestId)
      expect(guestSlots.map((slot) => slot.court)).toEqual(
        Array.from({ length: 18 }, () => guestIndex + 1),
      )
      expect(guestSlots.map((slot) => slot.start)).toEqual(
        Array.from({ length: 18 }, (_, index) => index * 10),
      )
      expect(guestSlots.every((slot) => !slot.roamingGuestId)).toBe(true)
    }
    expect(specialSlots.some((slot) => slot.court === 3)).toBe(false)
  })

  it('uses the configured 12-minute duration for general and special slots without waste', () => {
    const slots = planMeetingSlotsV2(makePlayers(56, 1), largeSettings)
    expect(slots.filter((slot) => slot.kind === 'special')).toHaveLength(8)
    expect(slots.filter((slot) => slot.kind === 'general')).toHaveLength(82)
    expect(slots.every((slot) => slot.duration === 12)).toBe(true)

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
  it('rotates an overflow guest through fixed guest courts as two-plus-two matches', () => {
    const players = makePlayers(30, 4)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 3,
      courtAssignmentMode: 'fixed',
      startTime: '18:00',
      endTime: '20:00',
      normalGameMinutes: 10,
      singleGuestPerMatch: true,
      specialLimitEnabled: false,
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const matches = schedule.rounds.flatMap((round) => round.matches)
    const guestMatches = (guestId: string) => matches.filter((match) =>
      [...match.teamA, ...match.teamB].some((player) => player.id === guestId),
    )

    expect(schedule.guestGameCounts).toMatchObject({
      'guest-1': 12,
      'guest-2': 12,
      'guest-3': 12,
      'guest-4': 12,
    })
    for (const [guestIndex, guestId] of [
      'guest-1',
      'guest-2',
      'guest-3',
    ].entries()) {
      expect(guestMatches(guestId).map((match) => match.court)).toEqual(
        Array.from({ length: 12 }, () => guestIndex + 1),
      )
      expect(guestMatches(guestId).map(
        (match) => match.startOffsetMinutes,
      )).toEqual(Array.from({ length: 12 }, (_, index) => index * 10))
    }
    const roamingMatches = guestMatches('guest-4')
    expect(roamingMatches).toHaveLength(12)
    expect(new Set(roamingMatches.map((match) => match.court))).toEqual(
      new Set([1, 2, 3]),
    )
    expect(roamingMatches.every((match) => {
      const assigned = [...match.teamA, ...match.teamB]
      return (
        assigned.filter((player) => player.isGuest).length === 2 &&
        assigned.filter((player) => !player.isGuest).length === 2
      )
    })).toBe(true)
    expect(
      analyzeMeetingScheduleV2(schedule, players, settings).structuralIssues,
    ).toEqual([])
  }, 20000)

  it.each([10, 12] as const)(
    'prioritizes wait intervals before game-count balance with $normalGameMinutes-minute games',
    (normalGameMinutes) => {
      const players = makePlayers(26, 2)
      const settings: MatchSettings = {
        ...defaultSettings,
        courtCount: 3,
        courtAssignmentMode: 'available',
        startTime: '18:00',
        endTime: '21:00',
        normalGameMinutes,
        specialLimitEnabled: false,
        specialGameLimitEnabled: true,
        specialGameLimit: 1,
        specialTimeLimitEnabled: true,
        specialTimeLimitMinutes: 30,
      }
      const guests = players.filter((player) => player.isGuest)
      const schedule = generateMeetingScheduleV2(players, settings)
      const matchCounts = new Map(
        players.map((player) => [
          player.id,
          schedule.rounds
            .flatMap((round) => round.matches)
            .filter((match) =>
              [...match.teamA, ...match.teamB].some(
                (candidate) => candidate.id === player.id,
              ),
            ).length,
        ]),
      )
      const regularCounts = players
        .filter((player) => !player.isGuest)
        .map((player) => matchCounts.get(player.id) ?? 0)
      const metrics = analyzeMeetingScheduleV2(schedule, players, settings)
      const expectedGuestGames = Math.floor(180 / normalGameMinutes)

      expect(balancedParticipantGameTarget(players, settings)).toBe(
        normalGameMinutes === 10 ? 7 : 6,
      )
      expect(
        guests.map((guest) => plannedGuestGames(guest, players, settings)),
      ).toEqual([expectedGuestGames, expectedGuestGames])
      expect(
        guests.map((guest) => schedule.guestGameCounts[guest.id]),
      ).toEqual([expectedGuestGames, expectedGuestGames])
      expect(Math.min(...regularCounts)).toBeGreaterThan(0)
      expect(
        Math.max(...regularCounts) - Math.min(...regularCounts),
      ).toBeLessThanOrEqual(1)
      expect(metrics.maximumInitialWaitMinutes).toBeLessThanOrEqual(
        MEETING_MAX_WAIT_MINUTES,
      )
      expect(metrics.maximumBetweenWaitMinutes).toBeLessThanOrEqual(
        MEETING_MAX_WAIT_MINUTES,
      )
      expect(metrics.participantsOverWaitLimit).toBe(0)
    },
    30000,
  )

  it('excludes unrestricted special participants from final idle policy', () => {
    const players = makePlayers(26, 2)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 3,
      courtAssignmentMode: 'fixed',
      startTime: '18:00',
      endTime: '21:00',
      normalGameMinutes: 12,
      targetRoundCount: 15,
      pacingRoundCount: 15,
      roundCountLocked: true,
      singleGuestPerMatch: true,
      specialLimitEnabled: false,
    }

    const result = generateMeetingScheduleV2WithWaitResolution(
      players,
      settings,
      3,
    )
    const metrics = analyzeMeetingScheduleV2(result.schedule, players, settings)

    expect(metrics.maximumFinalIdleMinutes).toBeLessThan(30)
    expect(
      metrics.participantViolations.some(
        (violation) =>
          violation.phase === 'final' &&
          players.find((player) => player.id === violation.playerId)?.isGuest,
      ),
    ).toBe(false)
  }, 30000)

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

  it('never schedules regular participants before arrival or after departure', () => {
    const players = makeClubPlayers(12).map((player, index) =>
      index === 0
        ? { ...player, arrivalOffsetMinutes: 30 }
        : index === 1
          ? { ...player, departureOffsetMinutes: 60 }
          : player,
    )
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '19:30',
      normalGameMinutes: 15,
      targetRoundCount: 6,
      pacingRoundCount: 6,
      roundCountLocked: true,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        specialMatchCreation: false,
      },
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const matches = schedule.rounds.flatMap((round) => round.matches)
    const lateMatches = matches.filter((match) =>
      [...match.teamA, ...match.teamB].some((player) => player.id === players[0].id),
    )
    const earlyMatches = matches.filter((match) =>
      [...match.teamA, ...match.teamB].some((player) => player.id === players[1].id),
    )

    expect(lateMatches.length).toBeGreaterThan(0)
    expect(lateMatches.every((match) => (match.startOffsetMinutes ?? 0) >= 30))
      .toBe(true)
    expect(earlyMatches.length).toBeGreaterThan(0)
    expect(earlyMatches.every((match) =>
      (match.startOffsetMinutes ?? 0) + (match.durationMinutes ?? 0) <= 60,
    )).toBe(true)
    expect(analyzeMeetingScheduleV2(schedule, players, settings).structuralIssues)
      .toEqual([])
  })

  it('allows three consecutive priority games while regular players stop at two', () => {
    const basePlayers = makeClubPlayers(12).map((player, index) =>
      index === 0
        ? {
            ...player,
            arrivalOffsetMinutes: 15,
            departureOffsetMinutes: 75,
          }
        : player,
    )
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '19:30',
      normalGameMinutes: 15,
      targetRoundCount: 6,
      pacingRoundCount: 6,
      roundCountLocked: true,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        specialMatchCreation: false,
      },
    }
    const starts = (priority: boolean) => {
      const players = basePlayers.map((player, index) =>
        index === 0 ? { ...player, attendancePriority: priority } : player,
      )
      const schedule = generateMeetingScheduleV2(players, settings)
      return schedule.rounds
        .flatMap((round) => round.matches)
        .filter((match) =>
          [...match.teamA, ...match.teamB].some(
            (player) => player.id === players[0].id,
          ),
        )
        .map((match) => match.startOffsetMinutes ?? 0)
        .sort((left, right) => left - right)
    }

    const normalStarts = starts(false)
    const priorityStarts = starts(true)
    const longestStreak = (matchStarts: number[]) => matchStarts.reduce(
      (result, start, index) => {
        const current = index > 0 && start - matchStarts[index - 1] === 15
          ? result.current + 1
          : 1
        return { current, maximum: Math.max(result.maximum, current) }
      },
      { current: 0, maximum: 0 },
    ).maximum
    expect(priorityStarts).toHaveLength(3)
    expect(longestStreak(normalStarts)).toBeLessThanOrEqual(2)
    expect(longestStreak(priorityStarts)).toBe(3)
  })

  it('keeps a special participant inside their own attendance window', () => {
    const players = makePlayers(12, 1).map((player) =>
      player.isGuest
        ? {
            ...player,
            arrivalOffsetMinutes: 30,
            departureOffsetMinutes: 75,
            attendancePriority: true,
          }
        : player,
    )
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '19:30',
      normalGameMinutes: 15,
      targetRoundCount: 6,
      pacingRoundCount: 6,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 4,
      specialParticipantTarget: 8,
      specialTimeLimitEnabled: false,
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const guest = players.find((player) => player.isGuest)!
    const guestMatches = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) =>
        [...match.teamA, ...match.teamB].some((player) => player.id === guest.id),
      )

    expect(guestMatches.length).toBeGreaterThan(0)
    expect(guestMatches.every((match) =>
      (match.startOffsetMinutes ?? 0) >= 30 &&
      (match.startOffsetMinutes ?? 0) + (match.durationMinutes ?? 0) <= 75,
    )).toBe(true)
  })

  it('treats 30 minutes or more after the final match as a failure', () => {
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
    expect(metrics.participantsOverWaitLimit).toBe(8)
    expect(metrics.participantViolations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'final' }),
      ]),
    )
    expect(metrics.successIssues).toEqual([
      `마지막 경기 후 ${metrics.maximumFinalIdleMinutes}분`,
    ])
  })

  it('allows 29 final idle minutes and rejects 30 minutes in V2 validation', () => {
    const players = makeClubPlayers(4)
    const rejectedSettings: MatchSettings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:45',
      normalGameMinutes: 15,
      targetRoundCount: 1,
      pacingRoundCount: 1,
      roundCountLocked: true,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        specialMatchCreation: false,
      },
    }
    const schedule = generateMeetingScheduleV2(players, rejectedSettings)
    const allowed = analyzeMeetingScheduleV2(schedule, players, {
      ...rejectedSettings,
      endTime: '18:44',
    })
    const rejected = analyzeMeetingScheduleV2(
      schedule,
      players,
      rejectedSettings,
    )

    expect(allowed.maximumFinalIdleMinutes).toBe(29)
    expect(allowed.participantsOverWaitLimit).toBe(0)
    expect(allowed.successIssues).toEqual([])
    expect(rejected.maximumFinalIdleMinutes).toBe(30)
    expect(rejected.participantsOverWaitLimit).toBe(4)
    expect(rejected.participantViolations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          waitMinutes: 30,
          phase: 'final',
        }),
      ]),
    )
    expect(rejected.successIssues).toEqual(['마지막 경기 후 30분'])
  })

  it('excludes a limited special participant from final-idle wait analysis', () => {
    const players = makePlayers(4, 1)
    const [guest, first, second, third, fourth] = players
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '19:00',
      normalGameMinutes: 15,
      specialLimitEnabled: true,
      specialScheduleMode: 'spread',
      specialGameLimitEnabled: true,
      specialGameLimit: 1,
      specialTimeLimitEnabled: false,
    }
    const schedule: Schedule = {
      rounds: [
        {
          id: 'special-final-idle-round-1',
          number: 1,
          resting: [fourth],
          matches: [
            {
              id: 'special-final-idle-match-1',
              round: 1,
              court: 1,
              teamA: [guest, first],
              teamB: [second, third],
              isSpecial: true,
              startOffsetMinutes: 0,
              durationMinutes: 15,
            },
          ],
        },
        {
          id: 'special-final-idle-round-2',
          number: 2,
          resting: [guest],
          matches: [
            {
              id: 'special-final-idle-match-2',
              round: 2,
              court: 1,
              teamA: [first, second],
              teamB: [third, fourth],
              isSpecial: false,
              startOffsetMinutes: 45,
              durationMinutes: 15,
            },
          ],
        },
      ],
      warnings: [],
      specialCompletedIds: [first.id, second.id, third.id],
      guestGameCounts: { [guest.id]: 1 },
    }

    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)

    expect(metrics.maximumFinalIdleMinutes).toBe(0)
    expect(metrics.participantViolations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: guest.id, phase: 'final' }),
      ]),
    )
  })

  it('fills the unified-duration large schedule and reaches the special target', () => {
    const players = makePlayers(56, 1)
    const schedule = generateMeetingScheduleV2(players, largeSettings)
    const metrics = analyzeMeetingScheduleV2(schedule, players, largeSettings)
    const matches = schedule.rounds.flatMap((round) => round.matches)

    expect(metrics.structuralIssues).toEqual([])
    expect(matches).toHaveLength(90)
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

  it('uses each configured-duration special match for available unplayed participants', () => {
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
    const firstFollowupSpecial = matches.find(
      (match) =>
        match.isSpecial &&
        match.startOffsetMinutes === settings.normalGameMinutes,
    )
    const playedBeforeFollowup = new Set(
      matches
        .filter(
          (match) =>
            (match.startOffsetMinutes ?? 0) < settings.normalGameMinutes,
        )
        .flatMap((match) => [...match.teamA, ...match.teamB])
        .filter((player) => !player.isGuest)
        .map((player) => player.id),
    )
    const unplayedBeforeFollowup = players.filter(
      (player) =>
        !player.isGuest &&
        !playedBeforeFollowup.has(player.id),
    )
    const specialRegularIds = new Set(
      firstFollowupSpecial
        ? [...firstFollowupSpecial.teamA, ...firstFollowupSpecial.teamB]
            .filter((player) => !player.isGuest)
            .map((player) => player.id)
        : [],
    )

    expect(matches).toHaveLength(60)
    expect(matches.filter((match) => match.isSpecial)).toHaveLength(8)
    expect(schedule.specialCompletedIds).toHaveLength(24)
    expect(firstFollowupSpecial).toBeDefined()
    expect(unplayedBeforeFollowup.length).toBeGreaterThan(0)
    expect(specialRegularIds.size).toBe(3)
    expect(
      [...specialRegularIds].every((playerId) =>
        unplayedBeforeFollowup.some((player) => player.id === playerId),
      ),
    ).toBe(true)
    expect(metrics.structuralIssues).toEqual([])
    expect(metrics.successIssues).toEqual([])
    expect(metrics.maximumInitialWaitMinutes).toBeLessThanOrEqual(
      settings.normalGameMinutes,
    )
    expect(metrics.maximumBetweenWaitMinutes).toBeLessThanOrEqual(25)
    expect(metrics.participantsOverWaitLimit).toBe(0)
    expect(metrics.standardGameSpread).toBeLessThanOrEqual(1)
    expect(metrics.maximumGroupMeetings).toBeLessThanOrEqual(2)
  }, 20000)

  it('fills the remaining special seat with a previously played participant', () => {
    const players = makePlayers(5, 1)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '21:00',
      normalGameMinutes: 12,
      targetRoundCount: 12,
      pacingRoundCount: 12,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialScheduleMode: 'continuous',
      specialGameLimitEnabled: true,
      specialGameLimit: 2,
      specialParticipantTarget: 6,
      specialTimeLimitEnabled: true,
      specialTimeLimitMinutes: 24,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        strictSkillLimit: false,
      },
    }
    const schedule = generateMeetingScheduleV2(players, settings)
    const matches = schedule.rounds.flatMap((round) => round.matches)
    const firstFollowupSpecial = matches.find(
      (match) =>
        match.isSpecial &&
        match.startOffsetMinutes === settings.normalGameMinutes,
    )
    const playedBeforeFollowup = new Set(
      matches
        .filter(
          (match) =>
            (match.startOffsetMinutes ?? 0) < settings.normalGameMinutes,
        )
        .flatMap((match) => [...match.teamA, ...match.teamB])
        .filter((player) => !player.isGuest)
        .map((player) => player.id),
    )
    const unplayedBeforeFollowup = players.filter(
      (player) =>
        !player.isGuest &&
        !playedBeforeFollowup.has(player.id),
    )
    const followupSpecialRegulars = firstFollowupSpecial
      ? [...firstFollowupSpecial.teamA, ...firstFollowupSpecial.teamB].filter(
          (player) => !player.isGuest,
        )
      : []
    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)

    expect(unplayedBeforeFollowup).toHaveLength(2)
    expect(
      unplayedBeforeFollowup.every((player) =>
        followupSpecialRegulars.some((candidate) => candidate.id === player.id),
      ),
    ).toBe(true)
    expect(
      followupSpecialRegulars.filter((player) =>
        playedBeforeFollowup.has(player.id),
      ),
    ).toHaveLength(1)
    expect(matches.filter((match) => match.isSpecial)).toHaveLength(2)
    expect(schedule.specialCompletedIds).toHaveLength(5)
    expect(metrics.maximumInitialWaitMinutes).toBeLessThanOrEqual(
      settings.normalGameMinutes,
    )
    expect(metrics.maximumBetweenWaitMinutes).toBeLessThanOrEqual(25)
    expect(metrics.standardGameSpread).toBeLessThanOrEqual(1)
    expect(metrics.maximumGroupMeetings).toBeLessThanOrEqual(2)
    expect(metrics.structuralIssues).toEqual([])
    expect(metrics.maximumFinalIdleMinutes).toBeGreaterThanOrEqual(30)
    expect(metrics.successIssues).toContain(
      `마지막 경기 후 ${metrics.maximumFinalIdleMinutes}분`,
    )
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
    ).toHaveLength(24)
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
