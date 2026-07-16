import { describe, expect, it } from 'vitest'
import { defaultMatchConditionOptions, defaultSettings } from './defaultData'
import {
  analyzeScheduleQuality,
  analyzeScheduleWait,
  calculateStats,
  findScheduleOverlap,
  generateSchedule,
  generateScheduleWithWaitOptimization,
  getMatchSkillWarningLevel,
  getPlayerMatchScore,
  validateMeetingSchedule,
} from './matchmaker'
import { getBookingDurationMinutes } from './scheduleTime'
import { parseBulkPlayerDrafts } from './playerInput'
import type { MatchConditionOptions, MatchSettings, Player, Schedule } from './types'

const userSampleText = `이동근 스페셜
김태우 남 A
윤건 남 A
최철성 남 A
장지훈 남 A
신기성 남 A
최호웅 남 A
이경진 남 A
정명훈 남 A
박덕규 남 A
이태준 남 A
노태선 남 A
문평수 남 B
금대석 남 B
이승후 남 B
민경국 남 O
홍형기 남 B
권정택 남 C
김미선 여 A
신은정 여 A
문모다 여 A
손미선 여 A
김희진 여 E
류한철 남 E
민경아 여 D
하윤서 남 D
이기수 남 E
박병주 남 D
정해룡 여 E
임창현 남 E
홍성태 남 C
김태환 남 D
황주경 여 C
서경아 여 E
전완채 남 E
김형일 남 A
김철완 남 A
이현아 여 A
서동인 남 B
성영미 여 A
박지은 여 E
전아영 여 D
이미자 여 A
신현혜 여 A
황미영 여 A
정성일 남 A
김인 남 C
임세준 남 B
지미영 여 B
이경선 여 B
허성민 남 B
강명화 여 D
허홍수 남 D
이재욱 남 C
권오용 남 A
최시훈 남 B
장지유 여 E`

const makeUserSamplePlayers = (): Player[] =>
  parseBulkPlayerDrafts(userSampleText).map((player, index) => ({
    ...player,
    id: `user-sample-${index + 1}`,
  }))

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

const allOptionalConditionsDisabled = {
  ...Object.fromEntries(
    Object.keys(defaultMatchConditionOptions).map((key) => [key, false]),
  ),
  fairGames: true,
  waitPriority: true,
} as MatchConditionOptions

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
    name: '필수 25분 조건 false 입력도 내부 고정',
    normalGameMinutes: 15,
    conditionOptions: {
      ...defaultMatchConditionOptions,
      waitPriority: false,
    },
  },
  {
    name: '선택 균형 조건 해제',
    normalGameMinutes: 15,
    conditionOptions: {
      ...defaultMatchConditionOptions,
      restBalance: false,
      levelBalance: false,
      ageBalance: false,
      genderBalance: false,
    },
  },
  {
    name: '모든 선택 조건 해제',
    normalGameMinutes: 15,
    conditionOptions: allOptionalConditionsDisabled,
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

  it('keeps the same four-player group at two meetings even without alternatives', () => {
    const players = makeSimulationPlayers()
      .filter((player) => !player.isGuest)
      .slice(0, 5)
    const makeSchedule = (targetRoundCount: number) =>
      generateScheduleWithWaitOptimization(players, {
        ...defaultSettings,
        courtCount: 1,
        startTime: '18:00',
        endTime: '21:00',
        targetRoundCount,
        pacingRoundCount: targetRoundCount,
        roundCountLocked: true,
      }, 1)
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
    expect(beyondCapacity.rounds).toHaveLength(10)
    expect(Math.max(...groupCounts(beyondCapacity))).toBe(2)
    expect(beyondCapacity.warnings).toContain(
      '동일 4인 2회 제한으로 일부 코트가 비었습니다.',
    )
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
    const schedule = generateScheduleWithWaitOptimization(players, settings, 3)
    const regularStats = calculateStats(players, schedule, {})
      .filter((stat) => !stat.player.isGuest)
    const waits = regularStats.map((stat) => stat.maxWaitMinutes ?? 0)
    const games = regularStats.map((stat) => stat.games)
    const quality = analyzeScheduleQuality(schedule, players)
    const specialParticipantIds = new Set(
      schedule.rounds.flatMap((round) =>
        round.matches
          .filter((match) => match.isSpecial)
          .flatMap((match) => [...match.teamA, ...match.teamB])
          .filter((player) => !player.isGuest)
          .map((player) => player.id),
      ),
    )
    const generalGames = (playerId: string) => schedule.rounds.reduce(
      (count, round) => count + round.matches.filter(
        (match) =>
          !match.isSpecial &&
          [...match.teamA, ...match.teamB].some((player) => player.id === playerId),
      ).length,
      0,
    )
    const averageGeneralGames = (selected: Player[]) =>
      selected.reduce((sum, player) => sum + generalGames(player.id), 0) /
      selected.length
    const specialRegulars = players.filter((player) => specialParticipantIds.has(player.id))
    const nonSpecialRegulars = players.filter(
      (player) => !player.isGuest && !specialParticipantIds.has(player.id),
    )

    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
    expect(Math.max(...waits)).toBeLessThanOrEqual(25)
    expect([Math.min(...games), Math.max(...games)]).toEqual([7, 8])
    expect(quality.standardGameSpread).toBeLessThanOrEqual(1)
    expect(quality.maximumPartnerMeetings).toBeLessThanOrEqual(3)
    expect(averageGeneralGames(nonSpecialRegulars))
      .toBeGreaterThan(averageGeneralGames(specialRegulars))
  }, 15000)

  it('keeps the user 57-player sample within 25 minutes with 12-minute games', () => {
    const players = makeUserSamplePlayers()
    const maximumWaits = [11].map((seed) => {
      const settings: MatchSettings = {
        ...defaultSettings,
        courtCount: 6,
        startTime: '08:30',
        endTime: '11:30',
        normalGameMinutes: 12,
        seed,
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

      expect(
        validateMeetingSchedule(schedule, players, settings),
        `seed ${seed}`,
      )
        .toEqual([])
      return Math.max(
        ...regularStats.map((stat) => stat.maxWaitMinutes ?? 0),
      )
    })

    expect(players).toHaveLength(57)
    expect(maximumWaits.every((wait) => wait <= 25)).toBe(true)
  }, 15000)

  it('creates a warmup, peak, and completion flow for the 57-player sample', () => {
    const players = makeUserSamplePlayers()
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
      specialTimeLimitEnabled: false,
    }
    const schedule = generateScheduleWithWaitOptimization(players, settings, 5)
    const matches = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => !match.isSpecial)
    const phases = {
      early: matches.filter((match) => (match.startOffsetMinutes ?? 0) < 54),
      middle: matches.filter((match) => {
        const start = match.startOffsetMinutes ?? 0
        return start >= 54 && start < 126
      }),
      late: matches.filter((match) => (match.startOffsetMinutes ?? 0) >= 126),
    }
    const metrics = Object.fromEntries(
      Object.entries(phases).map(([phase, phaseMatches]) => {
        const average = (values: number[]) => values.length > 0
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : 0
        const allPlayers = (match: (typeof phaseMatches)[number]) =>
          [...match.teamA, ...match.teamB]
        return [phase, {
          matches: phaseMatches.length,
          partnerGap: average(phaseMatches.flatMap((match) =>
            [match.teamA, match.teamB].map((team) =>
              Math.abs(
                getPlayerMatchScore(team[0]) - getPlayerMatchScore(team[1]),
              ),
            ),
          )),
          sameLevelRate: average(phaseMatches.map((match) =>
            new Set(allPlayers(match).map((player) => player.level)).size === 1
              ? 100
              : 0,
          )),
          sameGenderRate: average(phaseMatches.map((match) =>
            new Set(allPlayers(match).map((player) => player.gender)).size === 1
              ? 100
              : 0,
          )),
          sameAgeRate: average(phaseMatches.map((match) =>
            new Set(allPlayers(match).map((player) => player.ageGroup)).size === 1
              ? 100
              : 0,
          )),
          skillWarnings: phaseMatches.filter(
            (match) => getMatchSkillWarningLevel(match) !== 'none',
          ).length,
        }]
      }),
    )
    const regularStats = calculateStats(players, schedule, {})
      .filter((stat) => !stat.player.isGuest)
    const quality = analyzeScheduleQuality(schedule, players)
    const wait = analyzeScheduleWait(schedule, players, settings)
    const summary = {
      totalMatches: schedule.rounds.flatMap((round) => round.matches).length,
      games: [
        Math.min(...regularStats.map((stat) => stat.games)),
        Math.max(...regularStats.map((stat) => stat.games)),
      ],
      averageGames:
        regularStats.reduce((sum, stat) => sum + stat.games, 0) /
        regularStats.length,
      averageWait:
        regularStats.reduce(
          (sum, stat) => sum + (stat.averageWaitMinutes ?? 0),
          0,
        ) / regularStats.length,
      maximumWait: wait.maximumWaitMinutes,
      over25: quality.participantsOverWaitLimit,
      sameFourMax: quality.maximumGroupMeetings,
      partnerMax: quality.maximumPartnerMeetings,
      skillWarnings: quality.teamSkillWarningMatches,
      skillDanger: quality.teamSkillDangerMatches,
      fallback: schedule.warnings.some((warning) =>
        warning.startsWith('동시 품질조건 후보 없음'),
      ),
    }
    expect(players).toHaveLength(57)
    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
    expect(summary.totalMatches).toBe(88)
    expect(summary.games[1] - summary.games[0]).toBeLessThanOrEqual(1)
    expect(summary.maximumWait).toBeLessThanOrEqual(25)
    expect(summary.over25).toBe(0)
    expect(summary.sameFourMax).toBeLessThanOrEqual(2)
    expect(metrics.early.partnerGap + 1).toBeGreaterThanOrEqual(
      metrics.middle.partnerGap,
    )
    const totalPhaseMatches = Object.values(metrics).reduce(
      (sum, phase) => sum + phase.matches,
      0,
    )
    const overallSameLevelRate = Object.values(metrics).reduce(
      (sum, phase) => sum + phase.sameLevelRate * phase.matches,
      0,
    ) / totalPhaseMatches
    expect(overallSameLevelRate).toBeGreaterThanOrEqual(50)
    expect(metrics.middle.sameLevelRate).toBeGreaterThanOrEqual(50)
    expect(metrics.middle.sameGenderRate).toBeGreaterThanOrEqual(35)
    expect(metrics.early.skillWarnings).toBeLessThanOrEqual(
      metrics.middle.skillWarnings,
    )
    expect(quality.averageSkillWarningStartMinutes ?? 0).toBeGreaterThanOrEqual(81)
    expect(summary.skillWarnings).toBeLessThanOrEqual(20)
    expect(summary.skillDanger).toBeLessThanOrEqual(10)
    expect(quality.individualSkillWarningMatches).toBe(summary.skillWarnings)
  }, 60000)

  it('keeps the annotated 57-player meeting within the strict skill limit', () => {
    const specialDisabled = new Set(
      '김태우 윤건 최철성 장지훈 신기성 최호웅 이경진 정명훈 박덕규 이태준 문평수 금대석 이승후 민경국 홍형기 권정택 김미선 신은정 문모다 손미선 김희진 류한철 하윤서 정해룡'.split(' '),
    )
    const flexible = new Set(['이승후', '민경국', '권정택', '김미선'])
    const players = makeUserSamplePlayers().map((player) => ({
      ...player,
      specialMatchEligible:
        !player.isGuest && !specialDisabled.has(player.name),
      gameCountFlexible: !player.isGuest && flexible.has(player.name),
      waitTimeFlexible: !player.isGuest && flexible.has(player.name),
    }))
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 6,
      startTime: '08:30',
      endTime: '11:30',
      normalGameMinutes: 12,
      targetRoundCount: 12,
      pacingRoundCount: 12,
      roundCountLocked: true,
      earlyPhaseEndPercent: 15,
      middlePhaseEndPercent: 85,
      seed: 12,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 8,
      specialTimeLimitEnabled: false,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        strictSkillLimit: true,
      },
    }
    const schedule = generateScheduleWithWaitOptimization(players, settings, 5)
    const matches = schedule.rounds.flatMap((round) => round.matches)
    const quality = analyzeScheduleQuality(schedule, players)
    const wait = analyzeScheduleWait(schedule, players, settings)

    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
    expect(matches).toHaveLength(88)
    expect(matches.filter((match) => !match.isSpecial)).toHaveLength(80)
    expect(quality.individualSkillDangerMatches).toBe(0)
    expect(quality.individualSkillWarningMatches).toBeLessThanOrEqual(5)
    expect(quality.standardGameSpread).toBeLessThanOrEqual(1)
    expect(quality.maximumGroupMeetings).toBeLessThanOrEqual(2)
    expect(wait.maximumWaitMinutes).toBeLessThanOrEqual(25)
  }, 30000)

  it('keeps a 15-minute schedule usable and recommends a participant limit', () => {
    const players = makeUserSamplePlayers()
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 6,
      startTime: '08:30',
      endTime: '11:30',
      normalGameMinutes: 15,
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
    const analysis = analyzeScheduleWait(schedule, players, settings)

    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
    expect(schedule.rounds.length).toBeGreaterThan(0)
    expect(analysis).toMatchObject({
      exceedsLimit: true,
      recommendedParticipantCount: 47,
    })
  }, 20000)

  it('updates the recommended participant count when 47 players still exceed 25 minutes', () => {
    const players = makeUserSamplePlayers().slice(0, 47)
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 6,
      startTime: '08:30',
      endTime: '11:30',
      normalGameMinutes: 15,
      seed: 11,
      targetRoundCount: 12,
      pacingRoundCount: 12,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 8,
      specialTimeLimitEnabled: false,
    }
    const schedule = generateScheduleWithWaitOptimization(players, settings, 1)
    const analysis = analyzeScheduleWait(schedule, players, settings)

    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
    expect(analysis.maximumWaitMinutes).toBe(30)
    expect(analysis.recommendedParticipantCount).toBe(39)
    expect(analysis.warning).toContain('권장 참가 39명 이하')
    expect(schedule.warnings).toContain(
      '동시 품질조건 후보 없음 · 가장 가까운 대진을 표시했습니다.',
    )
  }, 20000)

  it('uses selected officials for one-game and within-25-minute flexibility', () => {
    const players = makeSimulationPlayers().map((player, index) => ({
      ...player,
      gameCountFlexible: index >= 1 && index <= 2,
      waitTimeFlexible: index >= 3 && index <= 4,
    }))
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 3,
      startTime: '18:00',
      endTime: '19:00',
      normalGameMinutes: 10,
      seed: 11,
      targetRoundCount: 6,
      pacingRoundCount: 6,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 4,
      specialTimeLimitEnabled: false,
    }
    const schedule = generateSchedule(players, settings)
    const regularStats = calculateStats(players, schedule, {})
      .filter((stat) => !stat.player.isGuest)
    const flexibleStats = regularStats.filter(
      (stat) => stat.player.gameCountFlexible,
    )
    const standardStats = regularStats.filter(
      (stat) => !stat.player.gameCountFlexible,
    )
    const waitFlexibleStats = regularStats.filter(
      (stat) => stat.player.waitTimeFlexible,
    )
    const standardWaitStats = regularStats.filter(
      (stat) => !stat.player.waitTimeFlexible,
    )
    const averageGames = (stats: typeof regularStats) =>
      stats.reduce((sum, stat) => sum + stat.games, 0) / stats.length
    const averageMaximumWait = (stats: typeof regularStats) =>
      stats.reduce((sum, stat) => sum + (stat.maxWaitMinutes ?? 0), 0) /
      stats.length

    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
    expect(Math.max(...regularStats.map((stat) => stat.maxWaitMinutes ?? 0)))
      .toBeLessThanOrEqual(25)
    expect(averageGames(flexibleStats)).toBeLessThan(averageGames(standardStats))
    expect(averageMaximumWait(waitFlexibleStats)).toBeLessThanOrEqual(25)
    expect(averageMaximumWait(standardWaitStats)).toBeLessThanOrEqual(25)
  })
})
