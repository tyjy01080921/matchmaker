import { describe, expect, it } from 'vitest'
import { defaultMatchConditionOptions, defaultSettings } from './defaultData'
import {
  calculateStats,
  findScheduleOverlap,
  generateSchedule,
  validateMeetingSchedule,
} from './matchmaker'
import { getBookingDurationMinutes } from './scheduleTime'
import type { MatchConditionOptions, MatchSettings, Player, Schedule } from './types'

const makeSimulationPlayers = (): Player[] => [
  {
    id: 'simulation-guest',
    name: '스페셜',
    level: '스페셜',
    ageGroup: '무관',
    gender: 'none',
    active: true,
    specialRequired: false,
    isGuest: true,
    guestGameLimit: 0,
  },
  ...Array.from({ length: 15 }, (_, index): Player => ({
    id: `simulation-${index + 1}`,
    name: `${index + 1}번`,
    level: index < 5 ? 'B' : index < 10 ? 'C' : 'D',
    ageGroup: index % 2 === 0 ? '30대' : '40대',
    gender: index % 3 === 0 ? 'female' : 'male',
    active: true,
    specialRequired: true,
    isGuest: false,
    guestGameLimit: 0,
  })),
]

const matchWindow = (match: Schedule['rounds'][number]['matches'][number]) => {
  const start = match.startOffsetMinutes ?? (match.round - 1) * 15
  return { start, end: start + (match.durationMinutes ?? 15) }
}

const expectHardScheduleInvariants = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
) => {
  expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
  expect(findScheduleOverlap(schedule)).toBeNull()
  const activeIds = new Set(players.filter((player) => player.active).map((player) => player.id))
  const matches = schedule.rounds.flatMap((round) => round.matches)
  const bookingMinutes = getBookingDurationMinutes(settings.startTime, settings.endTime)
  expect(matches.length).toBeGreaterThan(0)

  for (const match of matches) {
    const matchPlayers = [...match.teamA, ...match.teamB]
    const window = matchWindow(match)
    expect(matchPlayers).toHaveLength(4)
    expect(new Set(matchPlayers.map((player) => player.id)).size).toBe(4)
    expect(matchPlayers.every((player) => activeIds.has(player.id))).toBe(true)
    expect(match.court).toBeGreaterThanOrEqual(1)
    expect(match.court).toBeLessThanOrEqual(settings.courtCount)
    expect(window.start).toBeGreaterThanOrEqual(0)
    expect(window.end).toBeLessThanOrEqual(bookingMinutes)
    if (settings.singleGuestPerMatch) {
      expect(matchPlayers.filter((player) => player.isGuest).length).toBeLessThanOrEqual(1)
    }
  }

  for (let court = 1; court <= settings.courtCount; court += 1) {
    const windows = matches
      .filter((match) => match.court === court)
      .map(matchWindow)
      .sort((left, right) => left.start - right.start)
    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index - 1].end).toBeLessThanOrEqual(windows[index].start)
    }
  }
}

const allConditionsDisabled = Object.fromEntries(
  Object.keys(defaultMatchConditionOptions).map((key) => [key, false]),
) as MatchConditionOptions

const simulationProfiles: Array<{
  name: string
  normalGameMinutes: 10 | 12 | 15
  conditionOptions: MatchConditionOptions
}> = [
  {
    name: '기본 조건',
    normalGameMinutes: 15,
    conditionOptions: defaultMatchConditionOptions,
  },
  {
    name: '10분 일반 경기',
    normalGameMinutes: 10,
    conditionOptions: defaultMatchConditionOptions,
  },
  {
    name: '12분 일반 경기',
    normalGameMinutes: 12,
    conditionOptions: defaultMatchConditionOptions,
  },
  {
    name: '반복 최소 해제',
    normalGameMinutes: 15,
    conditionOptions: {
      ...defaultMatchConditionOptions,
      partnerRepeat: false,
      opponentRepeat: false,
      groupRepeat: false,
    },
  },
  {
    name: '25분 대기 우선 해제',
    normalGameMinutes: 15,
    conditionOptions: {
      ...defaultMatchConditionOptions,
      waitPriority: false,
    },
  },
  {
    name: '균형 조건 해제',
    normalGameMinutes: 15,
    conditionOptions: {
      ...defaultMatchConditionOptions,
      fairGames: false,
      restBalance: false,
      levelBalance: false,
      ageBalance: false,
      genderBalance: false,
    },
  },
  {
    name: '모든 선호 조건 해제',
    normalGameMinutes: 15,
    conditionOptions: allConditionsDisabled,
  },
]

describe('matchmaker condition simulation', () => {
  // 선호 조건을 어떻게 조합해도 아래 절대 제약은 항상 유지되어야 한다.
  it.each(simulationProfiles)('$name keeps hard schedule invariants', (profile) => {
    const players = makeSimulationPlayers()
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 3,
      startTime: '18:00',
      endTime: '19:00',
      normalGameMinutes: profile.normalGameMinutes,
      targetRoundCount: 4,
      pacingRoundCount: 4,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 4,
      specialTimeLimitEnabled: false,
      conditionOptions: profile.conditionOptions,
    }

    const schedule = generateSchedule(players, settings)

    expectHardScheduleInvariants(schedule, players, settings)
  })

  it('allows two meetings for the same four and uses a third only without alternatives', () => {
    const players = makeSimulationPlayers()
      .filter((player) => !player.isGuest)
      .slice(0, 5)
    const makeSchedule = (targetRoundCount: number) => generateSchedule(players, {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '21:00',
      targetRoundCount,
      pacingRoundCount: targetRoundCount,
      roundCountLocked: true,
    })
    const groupCounts = (schedule: Schedule) => {
      const counts = new Map<string, number>()
      for (const match of schedule.rounds.flatMap((round) => round.matches)) {
        const key = [...match.teamA, ...match.teamB]
          .map((player) => player.id)
          .sort()
          .join('|')
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return [...counts.values()]
    }

    const withinCapacity = makeSchedule(10)
    const beyondCapacity = makeSchedule(11)

    expect(withinCapacity.rounds).toHaveLength(10)
    expect(Math.max(...groupCounts(withinCapacity))).toBe(2)
    expect(beyondCapacity.rounds).toHaveLength(11)
    expect(Math.max(...groupCounts(beyondCapacity))).toBe(3)
  })

  it('keeps the 57-player maximum wait within 25 minutes', () => {
    const players: Player[] = [
      {
        id: 'wait-guest', name: '스페셜', level: '스페셜', ageGroup: '무관',
        gender: 'none', active: true, specialRequired: false,
        isGuest: true, guestGameLimit: 0,
      },
      ...Array.from({ length: 56 }, (_, index): Player => ({
        id: `wait-${index + 1}`, name: `${index + 1}번`,
        level: index < 19 ? 'B' : index < 38 ? 'C' : 'D',
        ageGroup: index % 2 === 0 ? '30대' : '40대',
        gender: index % 3 === 0 ? 'female' : 'male', active: true,
        specialRequired: true, isGuest: false, guestGameLimit: 0,
      })),
    ]
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 6,
      startTime: '08:30',
      endTime: '11:30',
      normalGameMinutes: 10,
      seed: 11,
      targetRoundCount: 12,
      pacingRoundCount: 12,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 8,
      specialTimeLimitEnabled: false,
    }
    const schedule = generateSchedule(players, settings)
    const regularStats = calculateStats(players, schedule, {})
      .filter((stat) => !stat.player.isGuest)
    const waits = regularStats.map((stat) => stat.maxWaitMinutes ?? 0)
    const games = regularStats.map((stat) => stat.games)

    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
    expect(Math.max(...waits)).toBeLessThanOrEqual(25)
    expect([Math.min(...games), Math.max(...games)]).toEqual([7, 8])
  }, 15000)
})
