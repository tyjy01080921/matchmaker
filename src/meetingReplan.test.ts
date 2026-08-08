import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaultData'
import {
  analyzeScheduleQuality,
  analyzeScheduleWait,
  makeDefaultMeetingContinuationState,
  replanMeetingSchedule,
  validateMeetingSchedule,
} from './matchmaker'
import { getMeetingReplanLockedMatchIds } from './progressMode'
import { analyzeMeetingScheduleV2 } from './matchmaker/validation'
import type {
  Match,
  MatchSettings,
  Player,
  ResultsByMatch,
  Round,
  Schedule,
} from './types'

const player = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: id,
  level: 'B',
  ageGroup: '30대',
  gender: 'male',
  active: true,
  specialRequired: false,
  specialMatchEligible: true,
  isGuest: false,
  guestGameLimit: 0,
  ...overrides,
})

const makeMatch = (
  id: string,
  round: number,
  court: number,
  start: number,
  players: [Player, Player, Player, Player],
): Match => ({
  id,
  round,
  court,
  startOffsetMinutes: start,
  durationMinutes: 12,
  teamA: [players[0], players[1]],
  teamB: [players[2], players[3]],
  isSpecial: players.some((candidate) => candidate.isGuest),
})

const makeSchedule = (players: Player[]): Schedule => {
  const groups: Array<[[number, number, number, number], [number, number, number, number]]> = [
    [[0, 1, 2, 3], [4, 5, 6, 7]],
    [[0, 4, 5, 6], [1, 2, 3, 7]],
    [[0, 2, 4, 6], [1, 3, 5, 7]],
    [[0, 3, 4, 7], [1, 2, 5, 6]],
    [[0, 1, 6, 7], [2, 3, 4, 5]],
  ]
  const rounds: Round[] = groups.map(([left, right], index) => ({
    id: `round-${index + 1}`,
    number: index + 1,
    matches: [
      makeMatch(
        `m-${index + 1}-1`,
        index + 1,
        1,
        index * 12,
        left.map((playerIndex) => players[playerIndex]) as [Player, Player, Player, Player],
      ),
      makeMatch(
        `m-${index + 1}-2`,
        index + 1,
        2,
        index * 12,
        right.map((playerIndex) => players[playerIndex]) as [Player, Player, Player, Player],
      ),
    ],
    resting: [],
  }))
  return {
    rounds,
    warnings: [],
    specialCompletedIds: [],
    guestGameCounts: {},
  }
}

const completedResult = {
  teamAScore: '21',
  teamBScore: '17',
  completed: true,
  note: '',
  winnerSide: 'A' as const,
}

const settings: MatchSettings = {
  ...defaultSettings,
  courtCount: 2,
  startTime: '18:00',
  endTime: '19:00',
  normalGameMinutes: 12,
  targetRoundCount: 5,
  pacingRoundCount: 5,
  roundCountLocked: true,
  singleGuestPerMatch: true,
}

const lockedSignature = (match: Match) => JSON.stringify({
  id: match.id,
  court: match.court,
  start: match.startOffsetMinutes,
  duration: match.durationMinutes,
  teamA: match.teamA.map((candidate) => candidate.id),
  teamB: match.teamB.map((candidate) => candidate.id),
})

describe('meeting continuation replanning', () => {
  it('preserves completed and current fixed-court matches while replacing only future players', () => {
    const previousPlayers = Array.from({ length: 8 }, (_, index) =>
      player(`p${index + 1}`),
    )
    const schedule = makeSchedule(previousPlayers)
    const results: ResultsByMatch = {
      'm-1-1': completedResult,
      'm-1-2': completedResult,
    }
    const players = [
      ...previousPlayers.map((candidate) =>
        candidate.id === 'p8' ? { ...candidate, active: false } : candidate,
      ),
      player('late'),
    ]
    const lockedMatchIds = getMeetingReplanLockedMatchIds(
      schedule,
      results,
      {},
      'fixed',
    )
    const lockedBefore = new Map(
      schedule.rounds
        .flatMap((round) => round.matches)
        .filter((match) => lockedMatchIds.includes(match.id))
        .map((match) => [match.id, lockedSignature(match)]),
    )

    const result = replanMeetingSchedule({
      schedule,
      players,
      previousPlayers,
      settings,
      results,
      assignments: {},
      lockedMatchIds,
      continuation: makeDefaultMeetingContinuationState(),
    })

    expect(result.failureIssues).toEqual([])
    expect(result.lockedMatchIds).toEqual([
      'm-1-1',
      'm-1-2',
      'm-2-1',
      'm-2-2',
    ])
    const matches = result.schedule.rounds.flatMap((round) => round.matches)
    for (const [matchId, signature] of lockedBefore) {
      expect(lockedSignature(matches.find((match) => match.id === matchId)!))
        .toBe(signature)
    }
    const created = matches.filter((match) => result.createdMatchIds.includes(match.id))
    expect(created.length).toBeGreaterThan(0)
    expect(created.flatMap((match) => [...match.teamA, ...match.teamB])
      .some((candidate) => candidate.id === 'p8')).toBe(false)
    expect(created.flatMap((match) => [...match.teamA, ...match.teamB])
      .some((candidate) => candidate.id === 'late')).toBe(true)
    expect(result.continuation.players.late.fairnessGameCredit)
      .toBeGreaterThan(0)

    const gameCounts = new Map<string, number>()
    for (const match of matches) {
      for (const candidate of [...match.teamA, ...match.teamB]) {
        gameCounts.set(candidate.id, (gameCounts.get(candidate.id) ?? 0) + 1)
      }
    }
    expect(gameCounts.get('late')).toBeLessThan(gameCounts.get('p1')!)
  })

  it('replans a priority late entrant only inside their arrival and departure time', () => {
    const previousPlayers = Array.from({ length: 8 }, (_, index) =>
      player(`p${index + 1}`),
    )
    const schedule = makeSchedule(previousPlayers)
    const results: ResultsByMatch = {
      'm-1-1': completedResult,
      'm-1-2': completedResult,
    }
    const late = player('timed-late', {
      arrivalOffsetMinutes: 36,
      departureOffsetMinutes: 60,
      attendancePriority: true,
    })
    const players = [...previousPlayers, late]
    const lockedMatchIds = getMeetingReplanLockedMatchIds(
      schedule,
      results,
      {},
      'fixed',
    )

    const result = replanMeetingSchedule({
      schedule,
      players,
      previousPlayers,
      settings,
      results,
      assignments: {},
      lockedMatchIds,
      continuation: makeDefaultMeetingContinuationState(),
    })

    expect(result.failureIssues).toEqual([])
    const lateMatches = result.schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) =>
        result.createdMatchIds.includes(match.id) &&
        [...match.teamA, ...match.teamB].some(
          (candidate) => candidate.id === late.id,
        ),
      )
    expect(lateMatches.length).toBeGreaterThan(0)
    expect(lateMatches.every((match) =>
      (match.startOffsetMinutes ?? 0) >= 36 &&
      (match.startOffsetMinutes ?? 0) + (match.durationMinutes ?? 0) <= 60,
    )).toBe(true)
    expect(result.continuation.players[late.id].fairnessGameCredit).toBe(0)
  })

  it('uses normal match duration and no guest limit after a late special player joins', () => {
    const previousPlayers = Array.from({ length: 8 }, (_, index) =>
      player(`p${index + 1}`),
    )
    const schedule = makeSchedule(previousPlayers)
    const results: ResultsByMatch = {
      'm-1-1': completedResult,
      'm-1-2': completedResult,
    }
    const guest = player('late-special', {
      name: '지각 스페셜',
      level: '스페셜',
      gender: 'none',
      isGuest: true,
      specialMatchEligible: false,
      guestGameLimit: 1,
      arrivalOffsetMinutes: 36,
      departureOffsetMinutes: 60,
    })
    const players = [...previousPlayers, guest]
    const lockedMatchIds = getMeetingReplanLockedMatchIds(
      schedule,
      results,
      {},
      'fixed',
    )

    const result = replanMeetingSchedule({
      schedule,
      players,
      previousPlayers,
      settings: {
        ...settings,
        specialLimitEnabled: true,
        specialGameLimitEnabled: true,
        specialGameLimit: 1,
        specialTimeLimitEnabled: true,
        specialTimeLimitMinutes: 15,
      },
      results,
      assignments: {},
      lockedMatchIds,
      continuation: makeDefaultMeetingContinuationState(),
    })

    expect(result.failureIssues).toEqual([])
    expect(result.continuation.mode).toBe('late-special-unlimited')
    const created = result.schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => result.createdMatchIds.includes(match.id))
    expect(created.every((match) => match.durationMinutes === 12)).toBe(true)
    expect(created.every((match) =>
      (match.startOffsetMinutes ?? 0) + (match.durationMinutes ?? 0) <= 60,
    )).toBe(true)
    const guestMatches = created.filter((match) =>
      [...match.teamA, ...match.teamB].some((candidate) => candidate.id === guest.id),
    )
    expect(guestMatches.length).toBeGreaterThan(1)
    expect(guestMatches.map((match) => match.startOffsetMinutes))
      .toEqual([...new Set(guestMatches.map((match) => match.startOffsetMinutes))])
    expect(guestMatches.every((match) =>
      (match.startOffsetMinutes ?? 0) >= 36 &&
      (match.startOffsetMinutes ?? 0) + (match.durationMinutes ?? 0) <= 60,
    )).toBe(true)
  })

  it('caps continuation streaks at three for priority and two otherwise', () => {
    const previousPlayers = Array.from({ length: 8 }, (_, index) =>
      player(`p${index + 1}`),
    )
    const schedule = makeSchedule(previousPlayers)
    const results: ResultsByMatch = {
      'm-1-1': completedResult,
      'm-1-2': completedResult,
    }
    const replanGuestStarts = (attendancePriority: boolean) => {
      const guest = player(`streak-guest-${attendancePriority}`, {
        level: '스페셜',
        gender: 'none',
        isGuest: true,
        specialMatchEligible: false,
        guestGameLimit: 1,
        arrivalOffsetMinutes: 24,
        departureOffsetMinutes: 84,
        attendancePriority,
      })
      const players = [...previousPlayers, guest]
      const lockedMatchIds = getMeetingReplanLockedMatchIds(
        schedule,
        results,
        {},
        'fixed',
      )
      const result = replanMeetingSchedule({
        schedule,
        players,
        previousPlayers,
        settings: {
          ...settings,
          endTime: '19:24',
          targetRoundCount: 7,
          pacingRoundCount: 7,
        },
        results,
        assignments: {},
        lockedMatchIds,
        continuation: makeDefaultMeetingContinuationState(),
      })
      expect(result.failureIssues).toEqual([])
      return result.schedule.rounds
        .flatMap((round) => round.matches)
        .filter((match) =>
          result.createdMatchIds.includes(match.id) &&
          [...match.teamA, ...match.teamB].some(
            (candidate) => candidate.id === guest.id,
          ),
        )
        .map((match) => match.startOffsetMinutes ?? 0)
        .sort((left, right) => left - right)
    }
    const longestStreak = (starts: number[]) => starts.reduce(
      (result, start, index) => {
        const current = index > 0 && start - starts[index - 1] === 12
          ? result.current + 1
          : 1
        return { current, maximum: Math.max(result.maximum, current) }
      },
      { current: 0, maximum: 0 },
    ).maximum

    const normalStarts = replanGuestStarts(false)
    const priorityStarts = replanGuestStarts(true)
    expect(normalStarts.length).toBeGreaterThan(2)
    expect(priorityStarts.length).toBeGreaterThan(3)
    expect(longestStreak(normalStarts)).toBeLessThanOrEqual(2)
    expect(longestStreak(priorityStarts)).toBe(3)
  })

  it('preserves the actual assigned court and replans unassigned matches in available mode', () => {
    const previousPlayers = Array.from({ length: 8 }, (_, index) =>
      player(`p${index + 1}`),
    )
    const schedule = makeSchedule(previousPlayers)
    const results: ResultsByMatch = { 'm-1-1': completedResult }
    const assignments = {
      'm-1-1': { court: 2, dispatchOrder: 1 },
      'm-2-2': { court: 1, dispatchOrder: 2 },
    }
    const players = [...previousPlayers, player('late')]
    const lockedMatchIds = getMeetingReplanLockedMatchIds(
      schedule,
      results,
      assignments,
      'available',
    )

    const result = replanMeetingSchedule({
      schedule,
      players,
      previousPlayers,
      settings: { ...settings, courtAssignmentMode: 'available' },
      results,
      assignments,
      lockedMatchIds,
      continuation: makeDefaultMeetingContinuationState(),
    })

    expect(result.failureIssues).toEqual([])
    const matches = result.schedule.rounds.flatMap((round) => round.matches)
    expect(matches.find((match) => match.id === 'm-1-1')?.court).toBe(2)
    expect(matches.find((match) => match.id === 'm-2-2')?.court).toBe(1)
    expect(result.createdMatchIds.length).toBeGreaterThan(0)
  })

  it('keeps continuation credits and increments the revision on repeated replans', () => {
    const previousPlayers = Array.from({ length: 8 }, (_, index) =>
      player(`p${index + 1}`),
    )
    const schedule = makeSchedule(previousPlayers)
    const results: ResultsByMatch = {
      'm-1-1': completedResult,
      'm-1-2': completedResult,
    }
    const firstPlayers = [...previousPlayers, player('late')]
    const firstLocked = getMeetingReplanLockedMatchIds(
      schedule,
      results,
      {},
      'fixed',
    )
    const first = replanMeetingSchedule({
      schedule,
      players: firstPlayers,
      previousPlayers,
      settings,
      results,
      assignments: {},
      lockedMatchIds: firstLocked,
      continuation: makeDefaultMeetingContinuationState(),
    })
    expect(first.failureIssues).toEqual([])

    const secondPlayers = [...firstPlayers, player('later')]
    const secondLocked = getMeetingReplanLockedMatchIds(
      first.schedule,
      results,
      {},
      'fixed',
    )
    const second = replanMeetingSchedule({
      schedule: first.schedule,
      players: secondPlayers,
      previousPlayers: firstPlayers,
      settings,
      results,
      assignments: {},
      lockedMatchIds: secondLocked,
      continuation: first.continuation,
    })

    expect(second.failureIssues).toEqual([])
    expect(second.continuation.revision).toBe(2)
    expect(second.continuation.players.late.fairnessGameCredit)
      .toBe(first.continuation.players.late.fairnessGameCredit)
    expect(second.continuation.players.later.eligibleFromOffsetMinutes)
      .toBeGreaterThanOrEqual(first.progressOffsetMinutes)
  })

  it('returns failure issues without mutating the input when too few players attend', () => {
    const previousPlayers = Array.from({ length: 8 }, (_, index) =>
      player(`p${index + 1}`),
    )
    const schedule = makeSchedule(previousPlayers)
    const original = JSON.stringify(schedule)
    const results: ResultsByMatch = { 'm-1-1': completedResult }
    const players = previousPlayers.map((candidate, index) => ({
      ...candidate,
      active: index < 3,
    }))
    const lockedMatchIds = getMeetingReplanLockedMatchIds(
      schedule,
      results,
      {},
      'fixed',
    )

    const result = replanMeetingSchedule({
      schedule,
      players,
      previousPlayers,
      settings,
      results,
      assignments: {},
      lockedMatchIds,
      continuation: makeDefaultMeetingContinuationState(),
    })

    expect(result.failureIssues).toContain('참석 참가자가 4명 이상이어야 합니다.')
    expect(JSON.stringify(schedule)).toBe(original)
  })

  it('measures late entrants from their attendance time and honors fairness credits', () => {
    const players = Array.from({ length: 5 }, (_, index) =>
      player(`p${index + 1}`),
    )
    const lateMatch = makeMatch(
      'late-match',
      3,
      1,
      24,
      players.slice(0, 4) as [Player, Player, Player, Player],
    )
    const schedule: Schedule = {
      rounds: [{
        id: 'late-round',
        number: 3,
        matches: [lateMatch],
        resting: [players[4]],
      }],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }

    expect(analyzeScheduleWait(schedule, [players[0]], settings)
      .maximumInitialWaitMinutes).toBe(24)
    expect(analyzeScheduleWait(schedule, [players[0]], settings, {
      eligibleFromOffsetMinutesByPlayer: { p1: 24 },
    }).maximumInitialWaitMinutes).toBe(0)
    expect(analyzeScheduleQuality(schedule, players, settings)
      .standardGameSpread).toBe(1)
    expect(analyzeScheduleQuality(schedule, players, settings, {
      fairnessGameCreditsByPlayer: { p5: 1 },
    }).standardGameSpread).toBe(0)
  })

  it('allows an inactive participant only inside an explicitly locked match', () => {
    const players = Array.from({ length: 4 }, (_, index) =>
      player(`p${index + 1}`),
    )
    const lockedMatch = makeMatch(
      'locked-match',
      1,
      1,
      0,
      players as [Player, Player, Player, Player],
    )
    const schedule: Schedule = {
      rounds: [{
        id: 'locked-round',
        number: 1,
        matches: [lockedMatch],
        resting: [],
      }],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }
    const currentPlayers = players.map((candidate) =>
      candidate.id === 'p4' ? { ...candidate, active: false } : candidate,
    )

    expect(validateMeetingSchedule(schedule, currentPlayers, settings))
      .toContain('비활성 참가자 배정')
    expect(validateMeetingSchedule(schedule, currentPlayers, settings, {
      allowedInactiveMatchIds: ['locked-match'],
    })).not.toContain('비활성 참가자 배정')
  })

  it('rejects a manual schedule that places a participant outside attendance time', () => {
    const players = Array.from({ length: 4 }, (_, index) =>
      player(`p${index + 1}`, index === 0
        ? { arrivalOffsetMinutes: 24 }
        : {}),
    )
    const schedule: Schedule = {
      rounds: [{
        id: 'round-1',
        number: 1,
        matches: [makeMatch(
          'outside-attendance',
          1,
          1,
          12,
          players as [Player, Player, Player, Player],
        )],
        resting: [],
      }],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }

    expect(validateMeetingSchedule(schedule, players, settings))
      .toContain('참석 시간 외 배정')
    expect(validateMeetingSchedule(schedule, players, settings, {
      allowedAttendanceMatchIds: ['outside-attendance'],
    })).not.toContain('참석 시간 외 배정')
    expect(analyzeMeetingScheduleV2(schedule, players, settings).structuralIssues)
      .toContain('참석 시간 외 배정')
    expect(analyzeMeetingScheduleV2(schedule, players, settings, {
      allowedAttendanceMatchIds: ['outside-attendance'],
    }).structuralIssues).not.toContain('참석 시간 외 배정')
  })

  it('validates two-game regular and three-game priority streak limits', () => {
    const players = Array.from({ length: 4 }, (_, index) =>
      player(`p${index + 1}`, index === 0
        ? { departureOffsetMinutes: 60 }
        : {}),
    )
    const matches = Array.from({ length: 4 }, (_, index) => makeMatch(
      `streak-${index + 1}`,
      index + 1,
      1,
      index * 12,
      players as [Player, Player, Player, Player],
    ))
    const makeStreakSchedule = (count: number): Schedule => ({
      rounds: matches.slice(0, count).map((match, index) => ({
        id: `streak-round-${index + 1}`,
        number: index + 1,
        matches: [match],
        resting: [],
      })),
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    })

    expect(validateMeetingSchedule(makeStreakSchedule(2), players, settings))
      .not.toContain('연속 경기 제한 위반')
    expect(validateMeetingSchedule(makeStreakSchedule(3), players, settings))
      .toContain('연속 경기 제한 위반')

    const priorityPlayers = players.map((candidate, index) =>
      index === 0 ? { ...candidate, attendancePriority: true } : candidate,
    )
    const prioritySchedule = makeStreakSchedule(4)
    prioritySchedule.rounds = prioritySchedule.rounds.map((round) => ({
      ...round,
      matches: round.matches.map((match) => ({
        ...match,
        teamA: match.teamA.map((candidate) =>
          priorityPlayers.find((player) => player.id === candidate.id)!,
        ) as [Player, Player],
        teamB: match.teamB.map((candidate) =>
          priorityPlayers.find((player) => player.id === candidate.id)!,
        ) as [Player, Player],
      })),
    }))
    expect(validateMeetingSchedule(
      { ...prioritySchedule, rounds: prioritySchedule.rounds.slice(0, 3) },
      priorityPlayers,
      settings,
    )).not.toContain('연속 경기 제한 위반')
    expect(validateMeetingSchedule(prioritySchedule, priorityPlayers, settings))
      .toContain('연속 경기 제한 위반')
    expect(validateMeetingSchedule(prioritySchedule, priorityPlayers, settings, {
      allowedConsecutiveMatchIds: ['streak-4'],
    })).not.toContain('연속 경기 제한 위반')
  })
})
