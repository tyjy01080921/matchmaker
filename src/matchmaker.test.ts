import { describe, expect, it } from 'vitest'
import {
  defaultMatchConditionOptions,
  defaultPlayers,
  samplePlayers,
  defaultSettings,
  defaultTournamentSettings,
} from './defaultData'
import {
  analyzeParticipantWaitLimitViolations,
  analyzeScheduleQuality,
  analyzeScheduleWait,
  appendGeneralCourtGames,
  applyMeetingLineups,
  calculateTournamentMvpCandidates,
  calculateStats,
  cycleMeetingMatchPartners,
  deferSkillWarningMatches,
  generateBalancedTournamentTeams,
  generateSchedule,
  generateScheduleWithWaitResolution,
  generateScheduleWithWaitOptimization,
  getMeetingPhaseWeights,
  getMatchGenderCompositionReview,
  getMatchIndividualSkillSpread,
  getMatchSkillWarningLevel,
  isMatchGenderImbalanceReview,
  findScheduleOverlap,
  swapMeetingPlayers,
  validateMeetingFairness,
  validateMeetingSchedule,
  generateTournamentLineups,
  generateTournamentSchedule,
  getTournamentMatchWinnerId,
  getPlayerMatchTier,
  getPlayerMatchScore,
  makeNumberedTournamentPlayers,
  rankMeetingSwapCandidates,
} from './matchmaker'
import { makePlayerNameLookup, playerDisplayName } from './playerNames'
import type {
  AgeGroup,
  Gender,
  Level,
  Match,
  MatchSettings,
  Player,
  Schedule,
  TournamentParticipant,
  TournamentTeam,
} from './types'

const makeTestPlayer = (
  id: string,
  level: Level,
  gender: Gender = 'male',
  specialRequired = false,
  isGuest = false,
  ageGroup: AgeGroup = '30대',
): Player => ({
  id,
  name: id,
  level,
  ageGroup,
  gender: isGuest ? 'none' : gender,
  active: true,
  specialRequired: isGuest ? false : specialRequired,
  isGuest,
  guestGameLimit: isGuest ? 3 : 0,
})

const makeTournamentTeam = (id: string, seed: number | null): TournamentTeam => ({
  id,
  name: id,
  playerNames: '',
  level: 'B',
  gender: 'none',
  seed,
  active: true,
})

const makeTournamentMember = (
  id: string,
  level: Level = 'B',
  gender: Gender = 'male',
): TournamentParticipant => ({
  id,
  name: id,
  level,
  ageGroup: '30대',
  gender,
})

const average = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

const matchRegularAverageScore = (
  match: ReturnType<typeof generateSchedule>['rounds'][number]['matches'][number],
) => {
  const regularScores = [...match.teamA, ...match.teamB]
    .filter((player) => !player.isGuest)
    .map((player) => getPlayerMatchScore(player))
  return average(regularScores)
}

const matchTeamScoreGap = (
  match: ReturnType<typeof generateSchedule>['rounds'][number]['matches'][number],
) => {
  const teamScore = (team: typeof match.teamA) =>
    team.reduce((sum, player) => sum + getPlayerMatchScore(player), 0)
  return Math.abs(teamScore(match.teamA) - teamScore(match.teamB))
}

describe('getMatchSkillWarningLevel', () => {
  const playerAtTier = (id: string, tier: number) => ({
    ...makeTestPlayer(id, 'A'),
    matchLevelTier: tier,
  })
  const matchWithTiers = (opponentTier: number, isSpecial = false): Match => ({
    id: 'skill-gap',
    round: 1,
    court: 1,
    teamA: [playerAtTier('a1', 1), playerAtTier('a2', 1)],
    teamB: [playerAtTier('b1', opponentTier), playerAtTier('b2', opponentTier)],
    isSpecial,
  })

  it('classifies general matches without exposing the internal score', () => {
    expect(getMatchSkillWarningLevel(matchWithTiers(1))).toBe('none')
    expect(getMatchSkillWarningLevel(matchWithTiers(2.5))).toBe('caution')
    expect(getMatchSkillWarningLevel(matchWithTiers(3))).toBe('caution')
    expect(getMatchSkillWarningLevel(matchWithTiers(4))).toBe('danger')
  })

  it('does not flag intentionally asymmetric special matches', () => {
    expect(getMatchSkillWarningLevel(matchWithTiers(4, true))).toBe('none')
  })

  it('does not let O hide a large individual gap between A and E players', () => {
    const high = { ...makeTestPlayer('high', 'A'), matchLevelTier: 1 }
    const low1 = { ...makeTestPlayer('low-1', 'E'), matchLevelTier: 11 }
    const low2 = { ...makeTestPlayer('low-2', 'E'), matchLevelTier: 11 }
    const open = makeTestPlayer('open', 'O')
    const withoutOpen: Match = {
      id: 'without-open',
      round: 1,
      court: 1,
      teamA: [high, low1],
      teamB: [low2, { ...low2, id: 'low-3' }],
      isSpecial: false,
    }
    const withOpen: Match = {
      ...withoutOpen,
      id: 'with-open',
      teamB: [open, low2],
    }

    expect(getMatchSkillWarningLevel(withoutOpen)).toBe('danger')
    expect(getMatchSkillWarningLevel(withOpen)).toBe('danger')
    expect(getMatchIndividualSkillSpread(withOpen)).toBe(100)
  })
})

describe('getMeetingPhaseWeights', () => {
  it('peaks composition intensity in the middle of the meeting', () => {
    expect(getMeetingPhaseWeights(0)).toMatchObject({
      warmupDiversity: 1,
      middleIntensity: 0,
      composition: 0.35,
    })
    expect(getMeetingPhaseWeights(0.5)).toMatchObject({
      warmupDiversity: 0,
      middleIntensity: 1,
      composition: 11,
    })
    expect(getMeetingPhaseWeights(1)).toMatchObject({
      warmupDiversity: 0,
      middleIntensity: 0,
      composition: 0.35,
    })
  })

  it('moves the soft phase peak with the configured boundaries', () => {
    expect(getMeetingPhaseWeights(0.2, 20, 60)).toMatchObject({
      warmupDiversity: 0,
      middleIntensity: 0,
      composition: 1,
    })
    expect(getMeetingPhaseWeights(0.4, 20, 60)).toMatchObject({
      warmupDiversity: 0,
      middleIntensity: 1,
      composition: 11,
    })
    expect(getMeetingPhaseWeights(0.8, 20, 60).composition).toBeLessThan(1)
  })
})

describe('defaultPlayers', () => {
  it('starts meeting player list empty', () => {
    expect(defaultPlayers).toEqual([])
  })
})

describe('samplePlayers', () => {
  it('uses generic sample labels for meeting players', () => {
    expect(samplePlayers.filter((player) => player.isGuest).map((player) => player.name))
      .toEqual(['1번', '2번', '3번'])
    expect(samplePlayers.filter((player) => !player.isGuest).map((player) => player.name))
      .toEqual(Array.from({ length: 12 }, (_, index) => `${index + 4}번`))
  })

  it('labels unnamed meeting players by number', () => {
    const players = [
      { ...makeTestPlayer('regular-1', 'B'), name: '' },
      { ...makeTestPlayer('regular-2', 'B'), name: '' },
      { ...makeTestPlayer('guest-1', '스페셜', 'none', false, true), name: '' },
    ]
    const names = makePlayerNameLookup(players)

    expect(playerDisplayName(players[0], names)).toBe('1번')
    expect(playerDisplayName(players[1], names)).toBe('2번')
    expect(playerDisplayName(players[2], names)).toBe('스페셜 1번')
  })
})

describe('getMatchGenderCompositionReview', () => {
  const makeGenderMatch = (
    genders: [Gender, Gender, Gender, Gender],
    isSpecial = false,
  ): Match => {
    const players = genders.map((gender, index) =>
      makeTestPlayer(`gender-${genders.join('-')}-${index}`, 'B', gender),
    ) as [Player, Player, Player, Player]
    return {
      id: `gender-match-${genders.join('-')}`,
      round: 1,
      court: 1,
      teamA: [players[0], players[1]],
      teamB: [players[2], players[3]],
      isSpecial,
    }
  }

  it('labels the three mixed-gender combinations for review', () => {
    expect(getMatchGenderCompositionReview(
      makeGenderMatch(['female', 'male', 'male', 'male']),
    )?.label).toBe('여1·남3')
    expect(getMatchGenderCompositionReview(
      makeGenderMatch(['female', 'female', 'female', 'male']),
    )?.label).toBe('남1·여3')
    expect(getMatchGenderCompositionReview(
      makeGenderMatch(['female', 'male', 'female', 'male']),
    )?.label).toBe('남2·여2')
  })

  it('excludes same-gender, unknown-gender, and special matches', () => {
    expect(getMatchGenderCompositionReview(
      makeGenderMatch(['male', 'male', 'male', 'male']),
    )).toBeNull()
    expect(getMatchGenderCompositionReview(
      makeGenderMatch(['female', 'male', 'male', 'none']),
    )).toBeNull()
    expect(getMatchGenderCompositionReview(
      makeGenderMatch(['female', 'male', 'male', 'male'], true),
    )).toBeNull()
  })

  it('counts only reviewable general matches in schedule quality', () => {
    const matches = [
      makeGenderMatch(['female', 'male', 'male', 'male']),
      makeGenderMatch(['female', 'male', 'female', 'male']),
      makeGenderMatch(['female', 'female', 'female', 'female']),
      makeGenderMatch(['female', 'male', 'male', 'male'], true),
    ].map((match, index) => ({ ...match, id: `gender-count-${index}` }))
    const players = [...new Map(
      matches.flatMap((match) => [...match.teamA, ...match.teamB])
        .map((player) => [player.id, player] as const),
    ).values()]
    const schedule: Schedule = {
      rounds: [{ id: 'gender-round', number: 1, matches, resting: [] }],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }

    const quality = analyzeScheduleQuality(schedule, players)
    expect(quality.genderCompositionReviewMatches).toBe(2)
    expect(quality.genderImbalanceReviewMatches).toBe(1)
  })
})

describe('generateSchedule', () => {
  it.each(['variety', 'skill', 'wait'] as const)(
    '%s shuffle direction keeps the schedule valid',
    (shuffleDirection) => {
      const levels: Level[] = ['A', 'B', 'C', 'D']
      const players = Array.from({ length: 16 }, (_, index) =>
        makeTestPlayer(
          `shuffle-${index + 1}`,
          levels[index % levels.length],
          index % 3 === 0 ? 'female' : 'male',
        ),
      )
      const settings = {
        ...defaultSettings,
        courtCount: 2,
        startTime: '18:00',
        endTime: '19:00',
        normalGameMinutes: 10 as const,
        targetRoundCount: 6,
        pacingRoundCount: 6,
        roundCountLocked: true,
        shuffleDirection,
      }

      const schedule = generateScheduleWithWaitOptimization(
        players,
        settings,
        5,
      )

      expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
      expect(schedule.rounds.flatMap((round) => round.matches)).toHaveLength(12)
    },
  )

  it('gives everyone a first game within the first two court games when capacity allows', () => {
    const players = Array.from({ length: 16 }, (_, index) =>
      makeTestPlayer(`first-game-${index + 1}`, 'B'),
    )
    const settings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '19:00',
      targetRoundCount: 4,
      pacingRoundCount: 4,
      roundCountLocked: true,
    }

    const schedule = generateSchedule(players, settings)
    const firstTwoCourtGames = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => (match.startOffsetMinutes ?? 0) < 30)
    const firstGameCounts = new Map(players.map((player) => [player.id, 0]))
    for (const match of firstTwoCourtGames) {
      for (const player of [...match.teamA, ...match.teamB]) {
        firstGameCounts.set(player.id, (firstGameCounts.get(player.id) ?? 0) + 1)
      }
    }

    expect(firstTwoCourtGames).toHaveLength(4)
    expect([...firstGameCounts.values()].every((count) => count === 1)).toBe(true)
  })

  it('avoids 1+3 gender groups when a 2+2 general match is possible', () => {
    const players = [
      makeTestPlayer('female-1', 'B', 'female'),
      makeTestPlayer('female-2', 'B', 'female'),
      ...Array.from({ length: 6 }, (_, index) =>
        makeTestPlayer(`male-${index + 1}`, 'B', 'male'),
      ),
    ]
    const settings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '19:00',
      normalGameMinutes: 15 as const,
      targetRoundCount: 4,
      pacingRoundCount: 4,
      roundCountLocked: true,
    }

    const schedule = generateScheduleWithWaitOptimization(players, settings, 5)
    const matches = schedule.rounds.flatMap((round) => round.matches)

    expect(matches).toHaveLength(8)
    expect(matches.filter(isMatchGenderImbalanceReview)).toHaveLength(0)
    expect(matches.map(getMatchGenderCompositionReview)
      .filter((review) => review?.label === '남2·여2')).toHaveLength(4)
    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
  })

  it('coordinates simultaneous courts to avoid leaving a 1+3 gender group', () => {
    const players = [
      ...Array.from({ length: 3 }, (_, index) =>
        makeTestPlayer(`batch-female-${index + 1}`, 'B', 'female'),
      ),
      ...Array.from({ length: 9 }, (_, index) =>
        makeTestPlayer(`batch-male-${index + 1}`, 'B', 'male'),
      ),
    ]
    const settings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '18:40',
      normalGameMinutes: 10 as const,
      targetRoundCount: 4,
      pacingRoundCount: 4,
      roundCountLocked: true,
    }

    const schedule = generateScheduleWithWaitOptimization(players, settings, 5)
    const matches = schedule.rounds.flatMap((round) => round.matches)

    expect(matches).toHaveLength(8)
    expect(matches.filter(isMatchGenderImbalanceReview)).toHaveLength(0)
    expect(matches.map(getMatchGenderCompositionReview)
      .filter((review) => review?.label === '남2·여2')).toHaveLength(4)
    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
  })

  it('keeps an unavoidable 1+3 general match valid', () => {
    const players = [
      makeTestPlayer('only-female', 'B', 'female'),
      ...Array.from({ length: 7 }, (_, index) =>
        makeTestPlayer(`male-${index + 1}`, 'B', 'male'),
      ),
    ]
    const settings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '18:15',
      normalGameMinutes: 15 as const,
      targetRoundCount: 1,
      pacingRoundCount: 1,
      roundCountLocked: true,
    }

    const schedule = generateScheduleWithWaitOptimization(players, settings, 5)
    const matches = schedule.rounds.flatMap((round) => round.matches)

    expect(matches).toHaveLength(2)
    expect(matches.filter(isMatchGenderImbalanceReview)).toHaveLength(1)
    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
  })

  it('moves an unavoidable skill warning to the latest safe match slot', () => {
    const high = { ...makeTestPlayer('late-A', 'A'), matchLevelTier: 1 }
    const low1 = { ...makeTestPlayer('late-E1', 'E'), matchLevelTier: 11 }
    const low2 = { ...makeTestPlayer('late-E2', 'E'), matchLevelTier: 11 }
    const low3 = { ...makeTestPlayer('late-E3', 'E'), matchLevelTier: 11 }
    const balanced = Array.from({ length: 4 }, (_, index) => ({
      ...makeTestPlayer(`late-B${index + 1}`, 'B'),
      matchLevelTier: 3,
    }))
    const players = [high, low1, low2, low3, ...balanced]
    const settings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:20',
      normalGameMinutes: 10 as const,
    }
    const schedule = {
      rounds: [
        {
          id: 'round-1', number: 1, resting: balanced,
          matches: [{
            id: 'warning', round: 1, court: 1,
            teamA: [high, low1] as [Player, Player],
            teamB: [low2, low3] as [Player, Player],
            isSpecial: false, startOffsetMinutes: 0, durationMinutes: 10,
          }],
        },
        {
          id: 'round-2', number: 2, resting: [high, low1, low2, low3],
          matches: [{
            id: 'balanced', round: 2, court: 1,
            teamA: [balanced[0], balanced[1]] as [Player, Player],
            teamB: [balanced[2], balanced[3]] as [Player, Player],
            isSpecial: false, startOffsetMinutes: 10, durationMinutes: 10,
          }],
        },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }

    const deferred = deferSkillWarningMatches(schedule, players, settings)
    const warning = deferred.rounds
      .flatMap((round) => round.matches)
      .find((match) => match.id === 'warning')!

    expect(warning.startOffsetMinutes).toBe(10)
    expect(validateMeetingSchedule(deferred, players, settings)).toEqual([])
  })

  it('still flags an A-E-E-O match even when its team totals can be balanced', () => {
    const players = [
      { ...makeTestPlayer('A', 'A'), matchLevelTier: 1 },
      { ...makeTestPlayer('E-1', 'E'), matchLevelTier: 11 },
      { ...makeTestPlayer('E-2', 'E'), matchLevelTier: 11 },
      makeTestPlayer('O', 'O'),
    ]
    const settings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:15',
      normalGameMinutes: 15 as const,
      targetRoundCount: 1,
      pacingRoundCount: 1,
      roundCountLocked: true,
      seed: 11,
    }
    const schedule = generateSchedule(players, settings)
    const match = schedule.rounds[0].matches[0]
    const teamWithA = [match.teamA, match.teamB].find((team) =>
      team.some((player) => player.id === 'A'),
    )!

    expect(teamWithA.some((player) => player.id === 'O')).toBe(false)
    expect(getMatchSkillWarningLevel(match)).toBe('danger')
  })

  it('uses O to complete a cohesive three-player level cohort', () => {
    const players = [
      makeTestPlayer('O', 'O'),
      ...Array.from({ length: 3 }, (_, index) =>
        makeTestPlayer(`D-${index + 1}`, 'D'),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        makeTestPlayer(`E-${index + 1}`, 'E'),
      ),
    ]
    const settings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:15',
      normalGameMinutes: 15 as const,
      targetRoundCount: 1,
      pacingRoundCount: 1,
      roundCountLocked: true,
      seed: 11,
    }
    const schedule = generateSchedule(players, settings)
    const match = schedule.rounds[0].matches[0]
    const fixedLevels = new Set(
      [...match.teamA, ...match.teamB]
        .filter((player) => player.level !== 'O')
        .map((player) => player.level),
    )

    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
    expect([...match.teamA, ...match.teamB].some((player) => player.level === 'O'))
      .toBe(true)
    expect(fixedLevels.size).toBe(1)
    expect(getMatchSkillWarningLevel(match)).toBe('none')
  })

  it('pairs preferred partners when fairness and wait conditions allow it', () => {
    const players = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`선호-${index + 1}`, 'B'),
    )
    players[0].preferredPartnerIds = [players[7].id]
    players[7].preferredPartnerIds = [players[0].id]
    const settings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '19:00',
      normalGameMinutes: 10 as const,
      targetRoundCount: 6,
      pacingRoundCount: 6,
      roundCountLocked: true,
      seed: 11,
    }

    const schedule = generateSchedule(players, settings)
    const preferredPairGames = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) =>
        [match.teamA, match.teamB].some((team) =>
          team.some((player) => player.id === players[0].id) &&
          team.some((player) => player.id === players[7].id),
        ),
      ).length

    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
    expect(preferredPairGames).toBeGreaterThanOrEqual(1)
    expect(analyzeScheduleQuality(schedule, players)).toMatchObject({
      preferredPartnerRequests: 1,
      preferredPartnerFulfilled: 1,
      preferredPartnerUnfulfilled: 0,
    })
  })

  it('excludes a one-sided preferred pair from partner repetition metrics', () => {
    const players = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`반복-${index + 1}`, 'B'),
    )
    players[0].preferredPartnerIds = [players[1].id]
    const opponentPairs = [
      [players[2], players[3]],
      [players[4], players[5]],
      [players[6], players[7]],
    ] as const
    const schedule: Schedule = {
      rounds: opponentPairs.map((opponents, index) => ({
        id: `preferred-repeat-round-${index + 1}`,
        number: index + 1,
        resting: players.filter(
          (player) =>
            ![players[0], players[1], ...opponents].some(
              (playing) => playing.id === player.id,
            ),
        ),
        matches: [{
          id: `preferred-repeat-${index + 1}`,
          round: index + 1,
          court: 1,
          teamA: [players[0], players[1]],
          teamB: [opponents[0], opponents[1]],
          isSpecial: false,
          startOffsetMinutes: index * 15,
          durationMinutes: 15,
        }],
      })),
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }

    expect(analyzeScheduleQuality(schedule, players)).toMatchObject({
      maximumPartnerMeetings: 1,
      repeatedPartnerAssignments: 0,
      preferredPartnerRequests: 1,
      preferredPartnerFulfilled: 1,
      preferredPartnerUnfulfilled: 0,
    })
  })

  it('adds one general game after the last game on every court when time is extended', () => {
    const players = Array.from({ length: 12 }, (_, index) =>
      makeTestPlayer(`extension-${index + 1}`, 'B'),
    )
    const settings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '18:12',
      normalGameMinutes: 12 as const,
      targetRoundCount: 1,
      pacingRoundCount: 1,
      roundCountLocked: true,
      seed: 11,
    }
    const original = generateScheduleWithWaitOptimization(players, settings, 5)
    const originalSnapshot = structuredClone(original)
    const extendedSettings = {
      ...settings,
      endTime: '18:24',
      targetRoundCount: settings.targetRoundCount + 1,
    }
    const appended = appendGeneralCourtGames(
      original,
      players,
      extendedSettings,
    )
    const extended = appended.schedule

    const matchesOnCourt = (schedule: typeof original, court: number) =>
      schedule.rounds
        .flatMap((round) => round.matches)
        .filter((match) => match.court === court)
        .sort(
          (left, right) =>
            (left.startOffsetMinutes ?? 0) - (right.startOffsetMinutes ?? 0),
        )

    for (const court of [1, 2]) {
      const before = matchesOnCourt(original, court)
      const after = matchesOnCourt(extended, court)
      const previousLast = before.at(-1)!
      const added = after.at(-1)!
      const lineup = (match: (typeof before)[number]) => [
        ...match.teamA.map((player) => player.id),
        ...match.teamB.map((player) => player.id),
      ]

      expect(after).toHaveLength(before.length + 1)
      expect(after.slice(0, -1).map(lineup)).toEqual(before.map(lineup))
      expect(added.startOffsetMinutes).toBe(
        (previousLast.startOffsetMinutes ?? 0) +
          (previousLast.durationMinutes ?? 12),
      )
    }
    expect(original).toEqual(originalSnapshot)
    expect(appended.addedMatchIds).toHaveLength(2)
    const originalGameCounts = new Map(
      players.map((player) => [
        player.id,
        original.rounds.flatMap((round) => round.matches).filter((match) =>
          [...match.teamA, ...match.teamB].some(
            (matchPlayer) => matchPlayer.id === player.id,
          )).length,
      ]),
    )
    const minimumOriginalGames = Math.min(...originalGameCounts.values())
    const firstAddedMatch = extended.rounds
      .flatMap((round) => round.matches)
      .find((match) => match.id === appended.addedMatchIds[0])!
    expect([...firstAddedMatch.teamA, ...firstAddedMatch.teamB].every(
      (player) => originalGameCounts.get(player.id) === minimumOriginalGames,
    )).toBe(true)
    expect(validateMeetingSchedule(extended, players, extendedSettings)).toEqual([])
  })

  it('swaps two participants across simultaneous matches without overlap', () => {
    const players = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`swap-${index + 1}`, 'B'),
    )
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 2,
      targetRoundCount: 1,
    })
    const [left, right] = schedule.rounds[0].matches
    const outgoing = left.teamA[0]
    const incoming = right.teamA[0]
    const swapped = swapMeetingPlayers(schedule, left.id, outgoing.id, incoming.id)

    expect(swapped).not.toBeNull()
    expect(swapped?.changedMatchIds).toEqual([left.id, right.id])
    const changedMatches = swapped!.schedule.rounds[0].matches
    expect([...changedMatches[0].teamA, ...changedMatches[0].teamB]
      .some((player) => player.id === incoming.id)).toBe(true)
    expect([...changedMatches[1].teamA, ...changedMatches[1].teamB]
      .some((player) => player.id === outgoing.id)).toBe(true)
    expect(findScheduleOverlap(swapped!.schedule)).toBeNull()

    const lineups = Object.fromEntries(
      swapped!.changedMatchIds.map((matchId) => {
        const match = swapped!.schedule.rounds
          .flatMap((round) => round.matches)
          .find((candidate) => candidate.id === matchId)!
        return [matchId, {
          teamAPlayerIds: match.teamA.map((player) => player.id),
          teamBPlayerIds: match.teamB.map((player) => player.id),
        }]
      }),
    )
    const reapplied = applyMeetingLineups(schedule, players, lineups)
    const findMatch = (candidate: typeof reapplied, matchId: string) =>
      candidate.rounds
        .flatMap((round) => round.matches)
        .find((match) => match.id === matchId)!
    for (const matchId of swapped!.changedMatchIds) {
      expect([
        ...findMatch(reapplied, matchId).teamA,
        ...findMatch(reapplied, matchId).teamB,
      ].map((player) => player.id)).toEqual([
        ...findMatch(swapped!.schedule, matchId).teamA,
        ...findMatch(swapped!.schedule, matchId).teamB,
      ].map((player) => player.id))
    }
  })

  it('cycles all three partner combinations for a manually edited match', () => {
    const players = Array.from({ length: 4 }, (_, index) =>
      makeTestPlayer(`mix-${index + 1}`, 'B'),
    )
    const original: Match = {
      id: 'manual-mix',
      round: 1,
      court: 1,
      teamA: [players[2], players[0]],
      teamB: [players[3], players[1]],
      isSpecial: false,
    }
    const pairingKey = (match: Match) => [match.teamA, match.teamB]
      .map((team) => team.map((player) => player.id).sort().join('__'))
      .sort()
      .join('::')

    const first = cycleMeetingMatchPartners(original)
    const second = cycleMeetingMatchPartners(first)
    const third = cycleMeetingMatchPartners(second)

    expect(new Set([
      pairingKey(original),
      pairingKey(first),
      pairingKey(second),
    ]).size).toBe(3)
    expect(pairingKey(third)).toBe(pairingKey(original))
    expect([...third.teamA, ...third.teamB].map((player) => player.id).sort()).toEqual(
      players.map((player) => player.id).sort(),
    )
  })

  it('ranks only safe and selectable manual swap candidates', () => {
    const players = Array.from({ length: 12 }, (_, index) =>
      makeTestPlayer(`recommend-${index + 1}`, 'B'),
    )
    const settings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '18:15',
      targetRoundCount: 1,
      pacingRoundCount: 1,
      roundCountLocked: true,
    }
    const schedule = generateSchedule(players, settings)
    const sourceMatch = schedule.rounds[0].matches[0]
    const outgoing = sourceMatch.teamA[0]
    const sourcePlayerIds = new Set(
      [...sourceMatch.teamA, ...sourceMatch.teamB].map((player) => player.id),
    )
    const simultaneousPlayerIds = new Set(
      schedule.rounds[0].matches
        .filter((match) => match.id !== sourceMatch.id)
        .flatMap((match) => [...match.teamA, ...match.teamB])
        .map((player) => player.id),
    )
    const restingPlayerIds = new Set(
      schedule.rounds[0].resting.map((player) => player.id),
    )
    const recommendations = rankMeetingSwapCandidates(
      schedule,
      players,
      settings,
      sourceMatch.id,
      outgoing.id,
    )

    expect(recommendations).toHaveLength(8)
    expect(recommendations.every(
      (recommendation) => !sourcePlayerIds.has(recommendation.player.id),
    )).toBe(true)
    const waitingRecommendations = recommendations.filter(
      (recommendation) => recommendation.swapType === 'waiting-replacement',
    )
    const simultaneousRecommendations = recommendations.filter(
      (recommendation) => recommendation.swapType === 'simultaneous-swap',
    )
    expect(waitingRecommendations).toHaveLength(4)
    expect(waitingRecommendations.every(
      (recommendation) => restingPlayerIds.has(recommendation.player.id),
    )).toBe(true)
    expect(waitingRecommendations.every(
      (recommendation) => recommendation.changedMatchIds.length === 1,
    )).toBe(true)
    expect(simultaneousRecommendations).toHaveLength(4)
    expect(simultaneousRecommendations.every(
      (recommendation) => simultaneousPlayerIds.has(recommendation.player.id),
    )).toBe(true)
    expect(simultaneousRecommendations.every(
      (recommendation) =>
        recommendation.changedMatchIds.length === 2 &&
        recommendation.conflictCourt !== undefined,
    )).toBe(true)
    for (const recommendation of recommendations) {
      const swapped = swapMeetingPlayers(
        schedule,
        sourceMatch.id,
        outgoing.id,
        recommendation.player.id,
      )
      expect(swapped).not.toBeNull()
      expect(validateMeetingSchedule(swapped!.schedule, players, settings)).toEqual([])
      if (recommendation.swapType === 'waiting-replacement') {
        const changedRound = swapped!.schedule.rounds[0]
        expect(changedRound.resting.some(
          (player) => player.id === outgoing.id,
        )).toBe(true)
        expect(changedRound.resting.some(
          (player) => player.id === recommendation.player.id,
        )).toBe(false)
      }
      expect(recommendation.reasons.length).toBeGreaterThan(0)
    }
  })

  it('keeps recommendations when an existing validation warning is not worsened', () => {
    const standardPlayers = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`existing-warning-${index + 1}`, 'B'),
    )
    const flexiblePlayer = {
      ...makeTestPlayer('existing-warning-flexible', 'B'),
      gameCountFlexible: true,
    }
    const players = [...standardPlayers, flexiblePlayer]
    const makeMatch = (
      id: string,
      round: number,
      court: number,
      startOffsetMinutes: number,
      playerIndexes: [number, number, number, number],
    ): Match => ({
      id,
      round,
      court,
      startOffsetMinutes,
      durationMinutes: 15,
      teamA: [standardPlayers[playerIndexes[0]], standardPlayers[playerIndexes[1]]],
      teamB: [standardPlayers[playerIndexes[2]], standardPlayers[playerIndexes[3]]],
      isSpecial: false,
    })
    const schedule: Schedule = {
      rounds: [
        {
          id: 'existing-warning-round-1',
          number: 1,
          matches: [
            makeMatch('existing-warning-1-1', 1, 1, 0, [0, 1, 2, 3]),
            makeMatch('existing-warning-1-2', 1, 2, 0, [4, 5, 6, 7]),
          ],
          resting: [flexiblePlayer],
        },
        {
          id: 'existing-warning-round-2',
          number: 2,
          matches: [
            makeMatch('existing-warning-2-1', 2, 1, 15, [0, 1, 2, 3]),
            makeMatch('existing-warning-2-2', 2, 2, 15, [4, 5, 6, 7]),
          ],
          resting: [flexiblePlayer],
        },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }
    const settings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '18:30',
      targetRoundCount: 2,
      pacingRoundCount: 2,
    }
    expect(validateMeetingSchedule(schedule, players, settings)).toContain(
      '경기 수 양보 1경기 초과',
    )

    const sourceMatch = schedule.rounds[0].matches[0]
    const recommendations = rankMeetingSwapCandidates(
      schedule,
      players,
      settings,
      sourceMatch.id,
      sourceMatch.teamA[0].id,
    )

    expect(recommendations.length).toBeGreaterThan(0)
    expect(recommendations.some(
      (recommendation) => recommendation.player.id === flexiblePlayer.id,
    )).toBe(true)
  })

  it('ignores a stale manual lineup that creates a simultaneous overlap', () => {
    const players = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`stale-${index + 1}`, 'B'),
    )
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 2,
      targetRoundCount: 1,
    })
    const [left, right] = schedule.rounds[0].matches
    const duplicatedPlayer = right.teamA[0]
    const applied = applyMeetingLineups(schedule, players, {
      [left.id]: {
        teamAPlayerIds: [duplicatedPlayer.id, left.teamA[1].id],
        teamBPlayerIds: left.teamB.map((player) => player.id),
      },
    })

    expect(findScheduleOverlap(applied)).toBeNull()
    expect(applied.rounds[0].matches[0]).toEqual(left)
  })

  it('recalculates special metadata after a manual lineup change', () => {
    const guest = makeTestPlayer('metadata-guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 4 }, (_, index) =>
      makeTestPlayer(`metadata-regular-${index + 1}`, 'B'),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 1,
      targetRoundCount: 1,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 1,
      specialTimeLimitEnabled: false,
    })
    const match = schedule.rounds[0].matches[0]
    const originalRegular = [...match.teamA, ...match.teamB]
      .find((player) => !player.isGuest)!
    const replacement = regulars.find((player) =>
      ![...match.teamA, ...match.teamB].some(
        (scheduled) => scheduled.id === player.id,
      ),
    )!
    const replaceId = (id: string) =>
      id === originalRegular.id ? replacement.id : id
    const applied = applyMeetingLineups(
      {
        ...schedule,
        specialCompletedIds: [],
        guestGameCounts: {},
      },
      [guest, ...regulars],
      {
        [match.id]: {
          teamAPlayerIds: match.teamA.map((player) => replaceId(player.id)),
          teamBPlayerIds: match.teamB.map((player) => replaceId(player.id)),
        },
      },
    )

    expect(applied.guestGameCounts[guest.id]).toBe(1)
    expect(applied.specialCompletedIds).toContain(replacement.id)
    expect(applied.specialCompletedIds).not.toContain(originalRegular.id)
  })

  it('reports participant and court overlaps during schedule validation', () => {
    const players = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`validation-${index + 1}`, 'B'),
    )
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 2,
      targetRoundCount: 1,
    })
    const [left, right] = schedule.rounds[0].matches
    right.court = left.court
    right.teamA = [left.teamA[0], right.teamA[1]]

    expect(validateMeetingSchedule(schedule, players, {
      ...defaultSettings,
      courtCount: 2,
      targetRoundCount: 1,
    })).toEqual(expect.arrayContaining([
      '참가자 동시간 중복',
      '코트 시간 중복',
    ]))
  })

  it('reports a wait longer than 25 minutes as an operational warning', () => {
    const players = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`wait-validation-${index + 1}`, 'B'),
    )
    const settings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '19:00',
      targetRoundCount: 2,
      pacingRoundCount: 2,
      roundCountLocked: true,
    }
    const schedule = generateSchedule(players, settings)
    for (const match of schedule.rounds[1].matches) {
      match.startOffsetMinutes = 45
    }

    const analysis = analyzeScheduleWait(schedule, players, settings)
    const participantViolations = analyzeParticipantWaitLimitViolations(
      schedule,
      players,
      settings,
    )

    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
    expect(analysis).toMatchObject({
      maximumWaitMinutes: 30,
      maximumBetweenWaitMinutes: 30,
      exceedsLimit: true,
      recommendedParticipantCount: 6,
    })
    expect(analysis.warning).toContain('권장 참가 6명 이하')
    expect(participantViolations).toHaveLength(8)
    expect(participantViolations[0]).toMatchObject({
      waitMinutes: 30,
      phase: 'between',
    })
    expect(participantViolations[0].previousMatchId).toBeTruthy()
    expect(participantViolations[0].nextMatchId).toBeTruthy()
  })

  it('reports final idle time without treating it as an operational wait failure', () => {
    const players = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`wait-range-${index + 1}`, 'B'),
    )
    const settings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '20:00',
      targetRoundCount: 1,
      pacingRoundCount: 1,
      roundCountLocked: true,
    }
    const schedule = generateSchedule(players, settings)
    for (const match of schedule.rounds[0].matches) {
      match.startOffsetMinutes = 0
      match.durationMinutes = 15
    }

    const analysis = analyzeScheduleWait(schedule, players, settings)
    const quality = analyzeScheduleQuality(schedule, players, settings)

    expect(analysis.maximumWaitMinutes).toBe(0)
    expect(analysis.maximumInitialWaitMinutes).toBe(0)
    expect(analysis.maximumBetweenWaitMinutes).toBe(0)
    expect(analysis.maximumFinalIdleMinutes).toBe(105)
    expect(analysis.zeroGameParticipantCount).toBe(0)
    expect(analysis.exceedsLimit).toBe(false)
    expect(quality.participantsOverWaitLimit).toBe(0)
  })

  it('links an excessive first-game wait to the participant first match', () => {
    const players = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`wait-initial-${index + 1}`, 'B'),
    )
    const settings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '19:30',
      targetRoundCount: 1,
      pacingRoundCount: 1,
      roundCountLocked: true,
    }
    const schedule = generateSchedule(players, settings)
    for (const match of schedule.rounds[0].matches) {
      match.startOffsetMinutes = 45
      match.durationMinutes = 15
    }

    const violations = analyzeParticipantWaitLimitViolations(
      schedule,
      players,
      settings,
    )

    expect(violations).toHaveLength(8)
    expect(violations[0]).toMatchObject({
      waitMinutes: 45,
      phase: 'initial',
    })
    expect(violations[0].nextMatchId).toBeTruthy()
  })

  it('accepts only a valid schedule within every 25-minute wait boundary', () => {
    const players = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`wait-resolution-pass-${index + 1}`, 'B'),
    )
    const settings = {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '18:30',
      targetRoundCount: 2,
      pacingRoundCount: 2,
      roundCountLocked: true,
    }

    const result = generateScheduleWithWaitResolution(players, settings, 1)
    const wait = analyzeScheduleWait(result.schedule, players, settings)

    expect(result.waitLimitFailure).toBeNull()
    expect(validateMeetingSchedule(result.schedule, players, settings)).toEqual([])
    expect(validateMeetingFairness(result.schedule, players)).toEqual([])
    expect(wait.maximumInitialWaitMinutes).toBeLessThanOrEqual(25)
    expect(wait.maximumBetweenWaitMinutes).toBeLessThanOrEqual(25)
    expect(wait.maximumFinalIdleMinutes).toBeLessThanOrEqual(25)
  })

  it('blocks an over-limit plan and returns only verified resolution options', () => {
    const players = Array.from({ length: 16 }, (_, index) =>
      makeTestPlayer(`wait-resolution-fail-${index + 1}`, 'B'),
    )
    const settings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:30',
      targetRoundCount: 2,
      pacingRoundCount: 2,
      roundCountLocked: true,
    }

    const result = generateScheduleWithWaitResolution(players, settings, 1)

    expect(result.waitLimitFailure).toMatchObject({
      maximumWaitMinutes: 30,
      maximumInitialWaitMinutes: 30,
      participantsOverLimit: 8,
    })
    expect(result.waitLimitFailure?.participantViolations).toHaveLength(8)
    expect(result.waitLimitFailure?.participantViolations[0]).toMatchObject({
      waitMinutes: 30,
      phase: 'unassigned',
    })
    expect(result.waitLimitFailure?.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'more-courts',
          verified: true,
          settings: expect.objectContaining({ courtCount: 2 }),
          outcome: expect.objectContaining({
            participantsOverLimit: 0,
            maximumWaitMinutes: 15,
          }),
        }),
      ]),
    )
    expect(
      result.waitLimitFailure?.recommendations.some(
        (recommendation) => recommendation.kind === 'shorter-game',
      ),
    ).toBe(false)
  })

  it('blocks zero-game participants and a standard game spread over one', () => {
    const players = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`fairness-validation-${index + 1}`, 'B'),
    )
    const settings = {
      ...defaultSettings,
      courtCount: 1,
      targetRoundCount: 1,
      pacingRoundCount: 1,
      roundCountLocked: true,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        groupRepeat: false,
      },
    }
    const schedule = generateSchedule(players, settings)
    const first = schedule.rounds[0].matches[0]
    schedule.rounds.push({
      id: 'fairness-validation-round-2',
      number: 2,
      matches: [{
        ...first,
        id: `${first.id}-repeat`,
        round: 2,
        startOffsetMinutes: 15,
      }],
      resting: schedule.rounds[0].resting,
    })

    expect(validateMeetingFairness(schedule, players)).toEqual([
      '0경기 일반 참가자 4명',
      '일반 참가자 경기 수 차 2경기',
    ])
  })

  it('keeps booking-time overflow as an operational warning, not a failure', () => {
    const players = Array.from({ length: 4 }, (_, index) =>
      makeTestPlayer(`overflow-${index + 1}`, 'B'),
    )
    const settings = {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:15',
      targetRoundCount: 1,
      pacingRoundCount: 1,
      roundCountLocked: true,
    }
    const schedule = generateSchedule(players, settings)
    schedule.rounds[0].matches[0].startOffsetMinutes = 30

    expect(validateMeetingSchedule(schedule, players, settings)).toEqual([])
    expect(validateMeetingFairness(schedule, players)).toEqual([])
  })

  it.each([10, 12, 15] as const)('applies a %d-minute duration to regular matches', (minutes) => {
    const players = Array.from({ length: 12 }, (_, index) =>
      makeTestPlayer(`duration-${index}`, 'B'),
    )
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      normalGameMinutes: minutes,
    })

    expect(schedule.rounds.flatMap((round) => round.matches)
      .filter((match) => !match.isSpecial)
      .every((match) => match.durationMinutes === minutes)).toBe(true)
  })

  it('keeps special matches at 15 minutes and prevents overlapping assignments', () => {
    const guest = makeTestPlayer('timed-guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 16 }, (_, index) =>
      makeTestPlayer(`timed-${index}`, 'B'),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 3,
      normalGameMinutes: 10,
    })
    const matches = schedule.rounds.flatMap((round) => round.matches)

    expect(matches.filter((match) => match.isSpecial)
      .every((match) => match.durationMinutes === 15)).toBe(true)
    for (let left = 0; left < matches.length; left += 1) {
      for (let right = left + 1; right < matches.length; right += 1) {
        const a = matches[left]
        const b = matches[right]
        const sharesPlayer = [...a.teamA, ...a.teamB].some((player) =>
          [...b.teamA, ...b.teamB].some((other) => other.id === player.id),
        )
        if (!sharesPlayer) continue
        const aStart = a.startOffsetMinutes ?? 0
        const bStart = b.startOffsetMinutes ?? 0
        expect(aStart + (a.durationMinutes ?? 15) <= bStart ||
          bStart + (b.durationMinutes ?? 15) <= aStart).toBe(true)
      }
    }
  })
  it('creates court-limited doubles matches without round duplicates', () => {
    const schedule = generateSchedule(samplePlayers, defaultSettings)

    expect(schedule.rounds.length).toBeGreaterThan(0)
    for (const round of schedule.rounds) {
      expect(round.matches.length).toBeLessThanOrEqual(defaultSettings.courtCount)
      const ids = round.matches.flatMap((match) => [
        ...match.teamA.map((player) => player.id),
        ...match.teamB.map((player) => player.id),
      ])
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('creates regular matches when there are no special guests', () => {
    const players = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`regular-${index + 1}`, index < 4 ? 'A' : 'B'),
    )
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 2,
      singleGuestPerMatch: true,
      targetRoundCount: 4,
    })

    expect(schedule.rounds).toHaveLength(4)
    expect(schedule.warnings).toHaveLength(0)
    expect(schedule.specialCompletedIds).toHaveLength(0)
    expect(
      schedule.rounds
        .flatMap((round) => round.matches)
        .every((match) => !match.isSpecial),
    ).toBe(true)
  })

  it('keeps participant game counts equal before optimizing other conditions', () => {
    const players = Array.from({ length: 10 }, (_, index) =>
      makeTestPlayer(
        `regular-${index + 1}`,
        index < 5 ? 'A' : 'D',
        index % 3 === 0 ? 'female' : 'male',
      ),
    )
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 2,
      targetRoundCount: 7,
      seed: 91,
    })
    const gameCounts = Object.fromEntries(players.map((player) => [player.id, 0]))

    for (const round of schedule.rounds) {
      for (const match of round.matches) {
        for (const player of [...match.teamA, ...match.teamB]) {
          gameCounts[player.id] += 1
        }
      }

      const counts = Object.values(gameCounts)
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    }
  })

  it('creates matches from count-only unnamed participants', () => {
    const players = Array.from({ length: 8 }, (_, index) => ({
      ...makeTestPlayer(`regular-${index + 1}`, 'B', index % 2 === 0 ? 'male' : 'female'),
      name: '',
    }))
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 2,
      targetRoundCount: 4,
    })
    const names = makePlayerNameLookup(players)
    const firstMatchDisplayNames = [
      ...schedule.rounds[0].matches[0].teamA,
      ...schedule.rounds[0].matches[0].teamB,
    ].map((player) => playerDisplayName(player, names))

    expect(schedule.rounds).toHaveLength(4)
    expect(schedule.rounds[0].matches).toHaveLength(2)
    expect(firstMatchDisplayNames.every((name) => /^\d+번$/.test(name))).toBe(true)
    expect(schedule.warnings).toHaveLength(0)
  })

  it('balances team strength before keeping same levels together', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('a-1', 'A'),
        makeTestPlayer('a-2', 'A'),
        makeTestPlayer('e-1', 'E'),
        makeTestPlayer('e-2', 'E'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        targetRoundCount: 1,
      },
    )
    const match = schedule.rounds[0].matches[0]

    expect(matchTeamScoreGap(match)).toBe(0)
    expect(match.teamA.map((player) => player.level).sort()).toEqual(['A', 'E'])
    expect(match.teamB.map((player) => player.level).sort()).toEqual(['A', 'E'])
  })

  it('prioritizes a cohesive same-level group even during warmup', () => {
    const preferred = Array.from({ length: 4 }, (_, index) =>
      makeTestPlayer(`preferred-${index + 1}`, 'B', 'male', false, false, '30대'),
    )
    const alternatives = [
      makeTestPlayer('alternative-1', 'A', 'female', false, false, '20대'),
      makeTestPlayer('alternative-2', 'C', 'female', false, false, '40대'),
      makeTestPlayer('alternative-3', 'D', 'female', false, false, '50대'),
      makeTestPlayer('alternative-4', 'E', 'female', false, false, '55대이상'),
    ]
    const schedule = generateSchedule([...preferred, ...alternatives], {
      ...defaultSettings,
      courtCount: 1,
      targetRoundCount: 1,
    })
    const matchPlayers = [
      ...schedule.rounds[0].matches[0].teamA,
      ...schedule.rounds[0].matches[0].teamB,
    ]

    expect(new Set(matchPlayers.map((player) => player.level)).size).toBe(1)
    expect(matchTeamScoreGap(schedule.rounds[0].matches[0])).toBeLessThan(30)
  })

  it('pairs D and E players with stronger partners when possible', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('b-player', 'B'),
        makeTestPlayer('c-player', 'C'),
        makeTestPlayer('d-player', 'D'),
        makeTestPlayer('e-player', 'E'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        targetRoundCount: 1,
      },
    )
    const match = schedule.rounds[0].matches[0]

    for (const team of [match.teamA, match.teamB]) {
      const lowPlayer = team.find(
        (player) => player.level === 'D' || player.level === 'E',
      )
      const partner = team.find((player) => player.id !== lowPlayer?.id)
      expect(lowPlayer).toBeDefined()
      expect(getPlayerMatchScore(partner!)).toBeGreaterThan(
        getPlayerMatchScore(lowPlayer!),
      )
    }
  })

  it('does not pair two E-level players together in an imbalanced special match', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('guest', '스페셜', 'none', false, true),
        makeTestPlayer('d-player', 'D', 'female'),
        makeTestPlayer('e-1', 'E', 'female'),
        makeTestPlayer('e-2', 'E', 'female'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        targetRoundCount: 1,
        pacingRoundCount: 1,
      },
    )
    const match = schedule.rounds[0].matches[0]
    const ePlayersTogether = [match.teamA, match.teamB].some(
      (team) => team.every((player) => player.level === 'E'),
    )
    const guestTeam = [match.teamA, match.teamB].find((team) =>
      team.some((player) => player.isGuest),
    )

    expect(match.isSpecial).toBe(true)
    expect(ePlayersTogether).toBe(false)
    expect(guestTeam?.some((player) => player.level === 'E')).toBe(true)
  })

  it('keeps a valid schedule when the same-gender condition is unchecked', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('male-a', 'A', 'male'),
        makeTestPlayer('female-a', 'A', 'female'),
        makeTestPlayer('male-b', 'B', 'male'),
        makeTestPlayer('female-b', 'B', 'female'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        targetRoundCount: 1,
        conditionOptions: {
          ...defaultMatchConditionOptions,
          genderBalance: false,
        },
      },
    )
    const match = schedule.rounds[0].matches[0]
    const playerIds = [...match.teamA, ...match.teamB].map((player) => player.id)

    expect(new Set(playerIds)).toHaveLength(4)
    expect(schedule.warnings).toHaveLength(0)
  })

  it('scores age, gender, and level according to meeting rules', () => {
    const male20A = makeTestPlayer('male-20-a', 'A', 'male', false, false, '20대')
    const male30A = makeTestPlayer('male-30-a', 'A', 'male', false, false, '30대')
    const female20A = makeTestPlayer('female-20-a', 'A', 'female', false, false, '20대')
    const male40B = makeTestPlayer('male-40-b', 'B', 'male', false, false, '40대')
    const male20B = makeTestPlayer('male-20-b', 'B', 'male', false, false, '20대')
    const male30B = makeTestPlayer('male-30-b', 'B', 'male', false, false, '30대')
    const male40A = makeTestPlayer('male-40-a', 'A', 'male', false, false, '40대')
    const male20C = makeTestPlayer('male-20-c', 'C', 'male', false, false, '20대')
    const male30C = makeTestPlayer('male-30-c', 'C', 'male', false, false, '30대')
    const male40C = makeTestPlayer('male-40-c', 'C', 'male', false, false, '40대')
    const female55C = makeTestPlayer(
      'female-55-c',
      'C',
      'female',
      false,
      false,
      '55대이상',
    )
    const d20 = makeTestPlayer('d-20', 'D', 'male', false, false, '20대')
    const d55 = makeTestPlayer('d-55', 'D', 'female', false, false, '55대이상')
    const e20 = makeTestPlayer('e-20', 'E', 'male', false, false, '20대')
    const e55 = makeTestPlayer('e-55', 'E', 'female', false, false, '55대이상')
    const oa20 = makeTestPlayer('oa-20', 'OA', 'female', false, false, '20대')
    const oa55 = makeTestPlayer('oa-55', 'OA', 'male', false, false, '55대이상')
    const o20 = makeTestPlayer('o-20', 'O', 'female', false, false, '20대')

    expect(getPlayerMatchScore(male20A)).toBe(getPlayerMatchScore(male30A))
    expect(getPlayerMatchScore(male20B)).toBe(getPlayerMatchScore(male30B))
    expect(getPlayerMatchScore(male20B)).toBe(getPlayerMatchScore(male40A))
    expect(getPlayerMatchScore(male20C)).toBe(getPlayerMatchScore(male30C))
    expect(getPlayerMatchScore(male20C)).toBe(getPlayerMatchScore(male40C))
    expect(getPlayerMatchScore(female20A)).toBe(getPlayerMatchScore(male40B))
    expect(getPlayerMatchScore(female20A)).toBeGreaterThan(getPlayerMatchScore(male30C))
    expect(getPlayerMatchScore(d20)).toBeGreaterThan(getPlayerMatchScore(female55C))
    expect(getPlayerMatchScore(d20)).toBeGreaterThan(getPlayerMatchScore(d55))
    expect(getPlayerMatchScore(e20)).toBe(getPlayerMatchScore(e55))
    expect(getPlayerMatchScore(d55)).toBeGreaterThan(getPlayerMatchScore(e20))
    expect(getPlayerMatchScore(oa20)).toBe(getPlayerMatchScore(oa55))
    expect(getPlayerMatchScore(o20)).toBe(getPlayerMatchScore(oa20))
  })

  it('uses a customized level tier table', () => {
    const customLevelTiers = structuredClone(defaultSettings.levelTiers)
    customLevelTiers['20대'].female.A = 4
    const female20A = makeTestPlayer('female-20-a', 'A', 'female', false, false, '20대')
    const male30C = makeTestPlayer('male-30-c', 'C', 'male', false, false, '30대')

    expect(getPlayerMatchTier(female20A, customLevelTiers)).toBe(
      getPlayerMatchTier(male30C, customLevelTiers),
    )

    const schedule = generateSchedule(
      [
        makeTestPlayer('guest', '스페셜', 'none', false, true),
        female20A,
        male30C,
        makeTestPlayer('male-30-b', 'B', 'male', false, false, '30대'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        targetRoundCount: 1,
        pacingRoundCount: 1,
        roundCountLocked: true,
        levelTiers: customLevelTiers,
      },
    )
    const scheduledFemale = schedule.rounds[0].matches[0].teamA
      .concat(schedule.rounds[0].matches[0].teamB)
      .find((player) => player.id === female20A.id)

    expect(scheduledFemale?.matchLevelTier).toBe(4)
  })

  it('auto-generates enough order slots for every regular participant to play with a guest', () => {
    const schedule = generateSchedule(samplePlayers, {
      ...defaultSettings,
      courtCount: 3,
      seed: 33,
    })
    const regularIds = samplePlayers
      .filter((player) => player.active && !player.isGuest)
      .map((player) => player.id)

    expect(schedule.specialCompletedIds).toEqual(expect.arrayContaining(regularIds))
    expect(schedule.warnings).toHaveLength(0)
  })

  it('keeps a 24-player single-guest meeting within the default round target', () => {
    const guest = makeTestPlayer('guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 24 }, (_, index) =>
      makeTestPlayer(
        `regular-${index + 1}`,
        index % 3 === 0 ? 'A' : index % 3 === 1 ? 'B' : 'C',
        index % 2 === 0 ? 'male' : 'female',
      ),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 4,
      seed: 17,
      singleGuestPerMatch: true,
      targetRoundCount: 8,
    })
    const specialMatches = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => match.isSpecial)

    expect(schedule.rounds).toHaveLength(8)
    expect(specialMatches).toHaveLength(8)
    expect(schedule.specialCompletedIds).toHaveLength(24)
    expect(schedule.specialCompletedIds).toEqual(
      expect.arrayContaining(regulars.map((player) => player.id)),
    )
    expect(schedule.guestGameCounts.guest).toBe(8)
    expect(schedule.warnings).toHaveLength(0)
  })

  it('keeps special trios same-gender throughout a balanced meeting', () => {
    const guest = makeTestPlayer('guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 24 }, (_, index) => {
      const level = index < 8 ? 'A' : index < 16 ? 'B' : index < 20 ? 'C' : 'D'
      const ageGroup = index < 8 ? '20대' : index < 16 ? '30대' : '50대'
      return makeTestPlayer(
        `regular-${index + 1}`,
        level,
        index % 2 === 0 ? 'male' : 'female',
        false,
        false,
        ageGroup,
      )
    })
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 4,
      seed: 17,
      singleGuestPerMatch: true,
      targetRoundCount: 8,
    })
    const specialRegularGroups = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => match.isSpecial)
      .map((match) =>
        [...match.teamA, ...match.teamB].filter((player) => !player.isGuest),
      )

    expect(specialRegularGroups).toHaveLength(8)
    expect(
      specialRegularGroups.every(
        (regulars) => new Set(regulars.map((player) => player.gender)).size === 1,
      ),
    ).toBe(true)
  })

  it('tightens general match team gaps around the middle rounds', () => {
    const players = Array.from({ length: 16 }, (_, index) => {
      const level = index < 4 ? 'A' : index < 8 ? 'B' : index < 12 ? 'C' : 'D'
      const ageGroup = index < 4 ? '20대' : index < 8 ? '30대' : index < 12 ? '40대' : '55대이상'
      return makeTestPlayer(
        `regular-${index + 1}`,
        level,
        index % 2 === 0 ? 'male' : 'female',
        false,
        false,
        ageGroup,
      )
    })
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 2,
      seed: 41,
      targetRoundCount: 8,
    })
    const roundGaps = schedule.rounds.map((round) =>
      average(round.matches.map(matchTeamScoreGap)),
    )
    const roundSpreads = schedule.rounds.map((round) =>
      average(round.matches.map((match) => {
        const scores = [...match.teamA, ...match.teamB].map(getPlayerMatchScore)
        return Math.max(...scores) - Math.min(...scores)
      })),
    )

    expect(schedule.warnings).toHaveLength(0)
    expect(roundGaps.every((gap) => gap <= 30)).toBe(true)
    expect(Math.max(...roundSpreads.slice(3, 5))).toBeLessThanOrEqual(
      Math.max(...roundSpreads.slice(-2)),
    )
  })

  it('fills the configured two-hour round target after special matches are complete', () => {
    const schedule = generateSchedule(samplePlayers, {
      ...defaultSettings,
      courtCount: 3,
      seed: 33,
    })

    expect(schedule.rounds).toHaveLength(defaultSettings.targetRoundCount)
    expect(schedule.warnings).toHaveLength(0)
  })

  it('extends the schedule when more rounds are requested', () => {
    const schedule = generateSchedule(samplePlayers, {
      ...defaultSettings,
      courtCount: 3,
      seed: 33,
      targetRoundCount: defaultSettings.targetRoundCount + 2,
    })

    expect(schedule.rounds).toHaveLength(defaultSettings.targetRoundCount + 2)
    expect(schedule.warnings).toHaveLength(0)
  })

  it('keeps existing round IDs stable when rounds are added or removed', () => {
    const baseSettings = {
      ...defaultSettings,
      courtCount: 3,
      seed: 33,
      targetRoundCount: 8,
      pacingRoundCount: 8,
      roundCountLocked: true,
    }
    const baseSchedule = generateSchedule(samplePlayers, baseSettings)
    const extendedSchedule = generateSchedule(samplePlayers, {
      ...baseSettings,
      targetRoundCount: 9,
    })
    const trimmedSchedule = generateSchedule(samplePlayers, {
      ...baseSettings,
      targetRoundCount: 7,
    })
    const roundMatchIds = (round: (typeof baseSchedule.rounds)[number]) =>
      round.matches.map((match) => match.id)

    expect(extendedSchedule.rounds.slice(0, 8).map(roundMatchIds)).toEqual(
      baseSchedule.rounds.map(roundMatchIds),
    )
    expect(trimmedSchedule.rounds.map(roundMatchIds)).toEqual(
      baseSchedule.rounds.slice(0, 7).map(roundMatchIds),
    )
  })

  it('honors a locked round count even when special meetings remain', () => {
    const guest = makeTestPlayer('guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 24 }, (_, index) =>
      makeTestPlayer(`regular-${index + 1}`, index < 12 ? 'B' : 'C'),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 2,
      targetRoundCount: 3,
      pacingRoundCount: 8,
      roundCountLocked: true,
    })

    expect(schedule.rounds).toHaveLength(3)
    expect(schedule.warnings.some((warning) => warning.includes('미완료'))).toBe(true)
  })

  it('allows participants to play multiple guest matches within the target window', () => {
    const schedule = generateSchedule(samplePlayers, {
      ...defaultSettings,
      courtCount: 3,
      seed: 33,
    })
    const regularStats = calculateStats(samplePlayers, schedule, {}).filter(
      (stat) => !stat.player.isGuest,
    )
    const specialMatches = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => match.isSpecial)

    expect(specialMatches.length).toBeGreaterThan(
      Math.ceil(regularStats.length / 3),
    )
    expect(regularStats.every((stat) => stat.guestGames >= 1)).toBe(true)
    expect(regularStats.some((stat) => stat.guestGames >= 2)).toBe(true)
  })

  it('keeps available courts filled while applying streak penalties', () => {
    const schedule = generateSchedule(samplePlayers, defaultSettings)
    const availableCourts = Math.min(
      defaultSettings.courtCount,
      Math.floor(samplePlayers.filter((player) => player.active).length / 4),
    )

    for (const round of schedule.rounds) {
      expect(round.matches).toHaveLength(availableCourts)
    }
  })

  it('moves a guest partner to the opposite team when they meet that guest again', () => {
    const players = [
      makeTestPlayer('guest', '스페셜', 'none', false, true),
      makeTestPlayer('regular-1', 'B', 'male', true),
      makeTestPlayer('regular-2', 'B', 'male', true),
      makeTestPlayer('regular-3', 'B', 'male', true),
    ]
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 1,
      seed: 7,
      targetRoundCount: 2,
    })
    const [firstMatch, secondMatch] = schedule.rounds.map((round) => round.matches[0])
    const firstGuestTeam = firstMatch.teamA.some((player) => player.id === 'guest')
      ? firstMatch.teamA
      : firstMatch.teamB
    const secondGuestTeam = secondMatch.teamA.some((player) => player.id === 'guest')
      ? secondMatch.teamA
      : secondMatch.teamB
    const secondOpponents =
      secondGuestTeam === secondMatch.teamA ? secondMatch.teamB : secondMatch.teamA
    const firstGuestPartner = firstGuestTeam.find((player) => player.id !== 'guest')

    expect(schedule.rounds).toHaveLength(2)
    expect(firstGuestPartner).toBeDefined()
    expect(secondGuestTeam.map((player) => player.id)).not.toContain(
      firstGuestPartner?.id,
    )
    expect(secondOpponents.map((player) => player.id)).toContain(firstGuestPartner?.id)
  })

  it('keeps generating past a small target when required special matches remain', () => {
    const players = [
      makeTestPlayer('guest', '스페셜', 'none', false, true),
      makeTestPlayer('regular-1', 'A', 'male', true),
      makeTestPlayer('regular-2', 'A', 'female', true),
      makeTestPlayer('regular-3', 'B', 'male', true),
      makeTestPlayer('regular-4', 'B', 'female', true),
      makeTestPlayer('regular-5', 'C', 'male', true),
      makeTestPlayer('regular-6', 'C', 'female', true),
      makeTestPlayer('regular-7', 'D', 'male', true),
      makeTestPlayer('regular-8', 'D', 'female', true),
    ]
    const schedule = generateSchedule(
      players,
      {
        ...defaultSettings,
        courtCount: 1,
        seed: 19,
        targetRoundCount: 1,
        roundCountLocked: false,
      },
    )
    const regularIds = players
      .filter((player) => !player.isGuest)
      .map((player) => player.id)

    expect(schedule.rounds.length).toBeGreaterThan(1)
    expect(schedule.specialCompletedIds).toEqual(expect.arrayContaining(regularIds))
    expect(schedule.warnings).toHaveLength(0)
  })

  it('prioritizes required special matches when capacity is available', () => {
    const schedule = generateSchedule(samplePlayers, {
      ...defaultSettings,
      courtCount: 4,
      seed: 33,
    })
    const requiredIds = samplePlayers
      .filter((player) => player.active && !player.isGuest)
      .map((player) => player.id)

    expect(schedule.specialCompletedIds).toEqual(expect.arrayContaining(requiredIds))
    expect(schedule.warnings).toHaveLength(0)
  })

  it('builds special matches with one guest and three regular participants', () => {
    const schedule = generateSchedule(samplePlayers, {
      ...defaultSettings,
      courtCount: 3,
      seed: 17,
    })

    for (const match of schedule.rounds[0].matches.filter((item) => item.isSpecial)) {
      const players = [...match.teamA, ...match.teamB]
      expect(players.filter((player) => player.isGuest)).toHaveLength(1)
      expect(players.filter((player) => !player.isGuest)).toHaveLength(3)
    }
  })

  it('allows multiple guests in a match when the single guest option is off', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('guest-1', '스페셜', 'none', false, true),
        makeTestPlayer('guest-2', '스페셜', 'none', false, true),
        makeTestPlayer('regular-1', 'A', 'male', true),
        makeTestPlayer('regular-2', 'A', 'female', true),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        singleGuestPerMatch: false,
      },
    )

    const players = [
      ...schedule.rounds[0].matches[0].teamA,
      ...schedule.rounds[0].matches[0].teamB,
    ]

    expect(players.filter((player) => player.isGuest)).toHaveLength(2)
    expect(players.filter((player) => !player.isGuest)).toHaveLength(2)
  })

  it('requires three regular participants for guest matches when the single guest option is on', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('guest-1', '스페셜', 'none', false, true),
        makeTestPlayer('guest-2', '스페셜', 'none', false, true),
        makeTestPlayer('regular-1', 'A', 'male', true),
        makeTestPlayer('regular-2', 'A', 'female', true),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        singleGuestPerMatch: true,
      },
    )

    expect(schedule.rounds).toHaveLength(0)
    expect(schedule.warnings).toContain(
      '스페셜 1명 옵션에서는 일반 참가자가 3명 이상 필요합니다.',
    )
  })

  it('builds a special match from the closest regular levels', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('guest', '스페셜', 'none', false, true),
        makeTestPlayer('a1', 'A'),
        makeTestPlayer('a2', 'A'),
        makeTestPlayer('a3', 'A'),
        makeTestPlayer('c1', 'C'),
        makeTestPlayer('d1', 'D'),
        makeTestPlayer('e1', 'E'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        seed: 5,
      },
    )

    const match = schedule.rounds[0].matches[0]
    const regularLevels = [...match.teamA, ...match.teamB]
      .filter((player) => !player.isGuest)
      .map((player) => player.level)

    expect(regularLevels).toEqual(['A', 'A', 'A'])
  })

  it('prioritizes a same-gender special trio before the low-level allocation', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('guest', '스페셜', 'none', false, true),
        makeTestPlayer('male-d1', 'D'),
        makeTestPlayer('male-d2', 'D'),
        makeTestPlayer('male-d3', 'D'),
        makeTestPlayer('male-e', 'E'),
        makeTestPlayer('female-e1', 'E', 'female'),
        makeTestPlayer('female-e2', 'E', 'female'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        targetRoundCount: 1,
        pacingRoundCount: 1,
        specialLimitEnabled: true,
        specialGameLimitEnabled: true,
        specialGameLimit: 1,
        specialTimeLimitEnabled: false,
        specialLowPriorityEnabled: true,
        specialLowPriorityPercent: 100,
        specialHighPriorityEnabled: false,
        specialHighPriorityPercent: 0,
      },
    )
    const regulars = [
      ...schedule.rounds[0].matches[0].teamA,
      ...schedule.rounds[0].matches[0].teamB,
    ].filter((player) => !player.isGuest)

    expect(regulars.every((player) => player.gender === 'male')).toBe(true)
    expect(regulars.every((player) => player.level === 'D')).toBe(true)
  })

  it('uses the smallest age gap after special gender and level match', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('guest', '스페셜', 'none', false, true),
        makeTestPlayer('age-30-1', 'C', 'male', false, false, '30대'),
        makeTestPlayer('age-30-2', 'C', 'male', false, false, '30대'),
        makeTestPlayer('age-30-3', 'C', 'male', false, false, '30대'),
        makeTestPlayer('age-20', 'C', 'male', false, false, '20대'),
        makeTestPlayer('age-40', 'C', 'male', false, false, '40대'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        targetRoundCount: 1,
        pacingRoundCount: 1,
        specialLimitEnabled: true,
        specialGameLimitEnabled: true,
        specialGameLimit: 1,
        specialTimeLimitEnabled: false,
      },
    )
    const regulars = [
      ...schedule.rounds[0].matches[0].teamA,
      ...schedule.rounds[0].matches[0].teamB,
    ].filter((player) => !player.isGuest)

    expect(regulars.every((player) => player.ageGroup === '30대')).toBe(true)
  })

  it('keeps the opposing special team same-gender when a mixed trio is unavoidable', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('guest', '스페셜', 'none', false, true),
        makeTestPlayer('female-a', 'A', 'female'),
        makeTestPlayer('male-d', 'D'),
        makeTestPlayer('male-e', 'E'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        targetRoundCount: 1,
        pacingRoundCount: 1,
      },
    )
    const match = schedule.rounds[0].matches[0]
    const opposingTeam = [match.teamA, match.teamB].find(
      (team) => team.every((player) => !player.isGuest),
    )!

    expect(new Set(opposingTeam.map((player) => player.gender))).toHaveLength(1)
    expect(opposingTeam.every((player) => player.gender === 'male')).toBe(true)
  })

  it('uses same-gender before adjusted level similarity for special trios', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('guest', '스페셜', 'none', false, true),
        makeTestPlayer('female-a1', 'A', 'female', true),
        makeTestPlayer('female-a2', 'A', 'female', true),
        makeTestPlayer('male-40-b', 'B', 'male', true, false, '40대'),
        makeTestPlayer('male-a1', 'A'),
        makeTestPlayer('male-a2', 'A'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        seed: 9,
      },
    )

    const regulars = [
      ...schedule.rounds[0].matches[0].teamA,
      ...schedule.rounds[0].matches[0].teamB,
    ].filter((player) => !player.isGuest)

    expect(regulars.every((player) => player.gender === 'male')).toBe(true)
  })

  it('fills every court when enough active players are available', () => {
    const schedule = generateSchedule(
      [
        ...samplePlayers,
        {
          id: 'p-extra',
          name: '추가참가자',
          level: 'C',
          ageGroup: '40대',
          gender: 'none',
          active: true,
          specialRequired: false,
          isGuest: false,
          guestGameLimit: 0,
        },
      ],
      {
        ...defaultSettings,
        courtCount: 4,
      },
    )

    expect(schedule.rounds[0].matches).toHaveLength(4)
  })

  it('removes a special from every match after the game limit', () => {
    const guest = makeTestPlayer('guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 24 }, (_, index) =>
      makeTestPlayer(`regular-${index + 1}`, index < 12 ? 'B' : 'C'),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 4,
      targetRoundCount: 10,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 4,
      specialTimeLimitEnabled: false,
    })
    const guestRounds = schedule.rounds
      .filter((round) =>
        round.matches.some((match) =>
          [...match.teamA, ...match.teamB].some((player) => player.id === guest.id),
        ),
      )
      .map((round) => round.number)

    expect(schedule.rounds).toHaveLength(10)
    expect(schedule.guestGameCounts[guest.id]).toBe(4)
    expect(guestRounds).toEqual([2, 4, 6, 8])
  })

  it('removes a special after the time limit', () => {
    const guest = makeTestPlayer('guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 16 }, (_, index) =>
      makeTestPlayer(`regular-${index + 1}`, index < 8 ? 'B' : 'C'),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 3,
      targetRoundCount: 6,
      specialLimitEnabled: true,
      specialGameLimitEnabled: false,
      specialTimeLimitEnabled: true,
      specialTimeLimitMinutes: 45,
    })

    expect(schedule.guestGameCounts[guest.id]).toBe(3)
    expect(
      schedule.rounds.slice(3).flatMap((round) => round.matches).some((match) =>
        [...match.teamA, ...match.teamB].some((player) => player.id === guest.id),
      ),
    ).toBe(false)
  })

  it('fills every available court with general matches after the special time limit', () => {
    const guest = makeTestPlayer('guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 55 }, (_, index) =>
      makeTestPlayer(
        `regular-${index + 1}`,
        index < 18 ? 'B' : index < 37 ? 'C' : 'D',
        index % 3 === 0 ? 'female' : 'male',
      ),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 6,
      startTime: '18:00',
      endTime: '21:00',
      targetRoundCount: 12,
      pacingRoundCount: 12,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialGameLimitEnabled: false,
      specialTimeLimitEnabled: true,
      specialTimeLimitMinutes: 120,
    })

    expect(schedule.rounds).toHaveLength(12)
    expect(schedule.guestGameCounts[guest.id]).toBe(8)
    expect(schedule.specialCompletedIds).toHaveLength(24)
    for (const round of schedule.rounds.slice(8)) {
      expect(round.matches).toHaveLength(6)
      expect(round.matches.every((match) => !match.isSpecial)).toBe(true)
      expect(
        round.matches.some((match) =>
          [...match.teamA, ...match.teamB].some((player) => player.isGuest),
        ),
      ).toBe(false)
    }
  }, 30000)

  it('caps repeated four-player groups in a 56-player meeting', () => {
    const guest = makeTestPlayer('repeat-guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 55 }, (_, index) =>
      makeTestPlayer(
        `repeat-regular-${index + 1}`,
        index < 18 ? 'B' : index < 37 ? 'C' : 'D',
        index % 3 === 0 ? 'female' : 'male',
      ),
    )
    const settings = {
      ...defaultSettings,
      courtCount: 6,
      startTime: '18:00',
      endTime: '21:00',
      targetRoundCount: 12,
      pacingRoundCount: 12,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 8,
      specialTimeLimitEnabled: false,
    }
    const repeatedGroupCount = (enabled: boolean) => {
      const schedule = generateSchedule([guest, ...regulars], {
        ...settings,
        conditionOptions: {
          ...defaultMatchConditionOptions,
          groupRepeat: enabled,
        },
      })
      const counts = new Map<string, number>()
      for (const match of schedule.rounds.flatMap((round) => round.matches)) {
        if (match.isSpecial) continue
        const key = [...match.teamA, ...match.teamB]
          .map((player) => player.id)
          .sort()
          .join('|')
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return {
        schedule,
        maxMeetings: Math.max(0, ...counts.values()),
        duplicates: [...counts.values()].reduce(
          (sum, count) => sum + Math.max(0, count - 1),
          0,
        ),
      }
    }

    const enabled = repeatedGroupCount(true)
    const disabled = repeatedGroupCount(false)
    const regularGameCounts = regulars.map((player) =>
      enabled.schedule.rounds
        .flatMap((round) => round.matches)
        .filter((match) =>
          [...match.teamA, ...match.teamB].some((candidate) => candidate.id === player.id),
        ).length,
    )

    expect(enabled.maxMeetings).toBeLessThanOrEqual(2)
    expect(enabled.duplicates).toBeLessThanOrEqual(disabled.duplicates)
    expect(findScheduleOverlap(enabled.schedule)).toBeNull()
    expect(enabled.schedule.rounds).toHaveLength(12)
    expect(enabled.schedule.rounds.every((round) => round.matches.length === 6)).toBe(true)
    expect(Math.max(...regularGameCounts) - Math.min(...regularGameCounts)).toBeLessThanOrEqual(3)
    expect(
      analyzeScheduleWait(enabled.schedule, [guest, ...regulars], settings)
        .maximumWaitMinutes,
    ).toBeLessThanOrEqual(30)
  }, 30000)

  it('uses whichever special limit is reached first', () => {
    const guest = makeTestPlayer('guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 16 }, (_, index) =>
      makeTestPlayer(`regular-${index + 1}`, index < 8 ? 'B' : 'C'),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 3,
      targetRoundCount: 8,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 7,
      specialTimeLimitEnabled: true,
      specialTimeLimitMinutes: 45,
    })

    expect(schedule.guestGameCounts[guest.id]).toBe(3)
  })

  it('completes an eight-game, 24-participant focused special block within two hours', () => {
    const guest = makeTestPlayer('focused-guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 37 }, (_, index) =>
      makeTestPlayer(
        `focused-regular-${index + 1}`,
        index < 19 ? 'B' : 'C',
        index % 2 === 0 ? 'male' : 'female',
      ),
    )
    const settings: MatchSettings = {
      ...defaultSettings,
      courtCount: 6,
      startTime: '18:00',
      endTime: '21:00',
      normalGameMinutes: 12,
      targetRoundCount: 12,
      pacingRoundCount: 12,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialScheduleMode: 'continuous',
      specialGameLimitEnabled: true,
      specialGameLimit: 8,
      specialParticipantTarget: 24,
      specialTimeLimitEnabled: true,
      specialTimeLimitMinutes: 120,
    }

    const schedule = generateSchedule([guest, ...regulars], settings)
    const specialMatches = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => match.isSpecial)
    const specialParticipantIds = new Set(
      specialMatches.flatMap((match) =>
        [...match.teamA, ...match.teamB]
          .filter((player) => !player.isGuest)
          .map((player) => player.id),
      ),
    )
    const lastSpecialEnd = Math.max(
      ...specialMatches.map(
        (match) =>
          (match.startOffsetMinutes ?? 0) +
          (match.durationMinutes ?? 15),
      ),
    )
    const wait = analyzeScheduleWait(schedule, [guest, ...regulars], settings)

    expect(specialMatches).toHaveLength(8)
    expect(specialParticipantIds.size).toBe(24)
    expect(lastSpecialEnd).toBeLessThanOrEqual(120)
    expect(wait.maximumFinalIdleMinutes).toBeLessThan(60)
    expect(
      schedule.rounds
        .flatMap((round) => round.matches)
        .filter((match) => (match.startOffsetMinutes ?? 0) >= 120)
        .every((match) => !match.isSpecial),
    ).toBe(true)
  }, 15_000)

  it('spreads the same special target across the full booking when requested', () => {
    const guest = makeTestPlayer('spread-guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 30 }, (_, index) =>
      makeTestPlayer(`spread-regular-${index + 1}`, index < 15 ? 'B' : 'C'),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 6,
      startTime: '18:00',
      endTime: '21:00',
      normalGameMinutes: 12,
      targetRoundCount: 12,
      pacingRoundCount: 12,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialScheduleMode: 'spread',
      specialGameLimitEnabled: true,
      specialGameLimit: 8,
      specialParticipantTarget: 24,
      specialTimeLimitEnabled: false,
    })
    const specialMatches = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => match.isSpecial)
    const specialParticipantIds = new Set(
      specialMatches.flatMap((match) =>
        [...match.teamA, ...match.teamB]
          .filter((player) => !player.isGuest)
          .map((player) => player.id),
      ),
    )
    const lastSpecialEnd = Math.max(
      ...specialMatches.map(
        (match) =>
          (match.startOffsetMinutes ?? 0) +
          (match.durationMinutes ?? 15),
      ),
    )

    expect(specialMatches).toHaveLength(8)
    expect(specialParticipantIds.size).toBe(24)
    expect(lastSpecialEnd).toBeGreaterThan(120)
    expect(lastSpecialEnd).toBeLessThanOrEqual(180)
  })

  it('caps unique special participants while completing the match target', () => {
    const guest = makeTestPlayer('coverage-guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 12 }, (_, index) =>
      makeTestPlayer(`coverage-regular-${index + 1}`, 'B'),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 3,
      startTime: '18:00',
      endTime: '19:00',
      targetRoundCount: 4,
      pacingRoundCount: 4,
      roundCountLocked: true,
      specialLimitEnabled: true,
      specialScheduleMode: 'continuous',
      specialGameLimitEnabled: true,
      specialGameLimit: 3,
      specialParticipantTarget: 6,
      specialTimeLimitEnabled: true,
      specialTimeLimitMinutes: 45,
    })
    const specialMatches = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => match.isSpecial)
    const participantIds = new Set(
      specialMatches.flatMap((match) =>
        [...match.teamA, ...match.teamB]
          .filter((player) => !player.isGuest)
          .map((player) => player.id),
      ),
    )

    expect(specialMatches).toHaveLength(3)
    expect(participantIds.size).toBe(6)
    expect(schedule.specialCompletedIds).toHaveLength(6)
  })

  it('keeps creating special matches when only special-first placement is off', () => {
    const guest = makeTestPlayer('priority-guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 15 }, (_, index) =>
      makeTestPlayer(
        `priority-regular-${index + 1}`,
        index < 8 ? 'B' : 'C',
        index % 3 === 0 ? 'female' : 'male',
      ),
    )
    const makeSchedule = (specialPriority: boolean) => generateSchedule(
      [guest, ...regulars],
      {
        ...defaultSettings,
        courtCount: 3,
        startTime: '18:00',
        endTime: '19:00',
        normalGameMinutes: 12,
        specialLimitEnabled: true,
        specialGameLimitEnabled: true,
        specialGameLimit: 4,
        specialTimeLimitEnabled: false,
        conditionOptions: {
          ...defaultMatchConditionOptions,
          specialMatchCreation: true,
          specialPriority,
        },
      },
    )
    const prioritized = makeSchedule(true)
    const deferred = makeSchedule(false)
    const specialMatches = (schedule: ReturnType<typeof makeSchedule>) =>
      schedule.rounds.flatMap((round) => round.matches)
        .filter((match) => match.isSpecial).length

    expect(specialMatches(prioritized)).toBeGreaterThan(0)
    expect(specialMatches(deferred)).toBe(specialMatches(prioritized))
    expect(deferred.guestGameCounts[guest.id]).toBe(
      prioritized.guestGameCounts[guest.id],
    )
  })

  it('turns off special creation without emitting missing-special warnings', () => {
    const guest = makeTestPlayer('disabled-guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`disabled-regular-${index + 1}`, 'B'),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 2,
      startTime: '18:00',
      endTime: '19:00',
      normalGameMinutes: 12,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        specialMatchCreation: false,
      },
    })

    expect(
      schedule.rounds.flatMap((round) => round.matches)
        .some((match) => match.isSpecial),
    ).toBe(false)
    expect(schedule.guestGameCounts[guest.id]).toBe(0)
    expect(schedule.warnings.some((warning) => warning.includes('스페셜 경기')))
      .toBe(false)
  })

  it('makes strict skill protection imply level balance', () => {
    const players = [
      makeTestPlayer('strict-a-1', 'A'),
      makeTestPlayer('strict-a-2', 'A'),
      makeTestPlayer('strict-e-1', 'E'),
      makeTestPlayer('strict-e-2', 'E'),
    ]
    const strictSchedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:15',
      targetRoundCount: 1,
      pacingRoundCount: 1,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        levelBalance: false,
        strictSkillLimit: true,
      },
    })
    const unrestrictedSchedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 1,
      startTime: '18:00',
      endTime: '18:15',
      targetRoundCount: 1,
      pacingRoundCount: 1,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        levelBalance: false,
        strictSkillLimit: false,
      },
    })

    expect(strictSchedule.rounds.flatMap((round) => round.matches)).toHaveLength(0)
    expect(unrestrictedSchedule.rounds.flatMap((round) => round.matches)).toHaveLength(1)
  })

  it('rotates partners independently when same-four protection is off', () => {
    const players = Array.from({ length: 4 }, (_, index) =>
      makeTestPlayer(`partner-${index + 1}`, 'B'),
    )
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 1,
      targetRoundCount: 3,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        groupRepeat: false,
        partnerRepeat: true,
        opponentRepeat: false,
      },
    })
    const partnerCounts = new Map<string, number>()
    for (const match of schedule.rounds.flatMap((round) => round.matches)) {
      for (const team of [match.teamA, match.teamB]) {
        const key = team.map((player) => player.id).sort().join('|')
        partnerCounts.set(key, (partnerCounts.get(key) ?? 0) + 1)
      }
    }

    expect(schedule.rounds).toHaveLength(3)
    expect(Math.max(...partnerCounts.values())).toBe(1)
  })

  it('rotates opponents independently when same-four protection is off', () => {
    const players = Array.from({ length: 4 }, (_, index) =>
      makeTestPlayer(`opponent-${index + 1}`, 'B'),
    )
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 1,
      targetRoundCount: 3,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        groupRepeat: false,
        partnerRepeat: false,
        opponentRepeat: true,
      },
    })
    const opponentCounts = new Map<string, number>()
    for (const match of schedule.rounds.flatMap((round) => round.matches)) {
      for (const left of match.teamA) {
        for (const right of match.teamB) {
          const key = [left.id, right.id].sort().join('|')
          opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)
        }
      }
    }

    expect(schedule.rounds).toHaveLength(3)
    expect(Math.max(...opponentCounts.values())).toBe(2)
  })

  it('rotates the guest partner through the dedicated special option', () => {
    const guest = makeTestPlayer('repeat-option-guest', '스페셜', 'none', false, true)
    const regulars = Array.from({ length: 8 }, (_, index) =>
      makeTestPlayer(`repeat-option-${index + 1}`, 'B'),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 2,
      targetRoundCount: 3,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 3,
      specialTimeLimitEnabled: false,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        guestPartnerRepeat: true,
      },
    })
    const guestPartnerCounts = new Map<string, number>()
    for (const match of schedule.rounds.flatMap((round) => round.matches)) {
      const guestTeam = [match.teamA, match.teamB].find((team) =>
        team.some((player) => player.id === guest.id),
      )
      const partner = guestTeam?.find((player) => player.id !== guest.id)
      if (partner) {
        guestPartnerCounts.set(
          partner.id,
          (guestPartnerCounts.get(partner.id) ?? 0) + 1,
        )
      }
    }

    expect(schedule.guestGameCounts[guest.id]).toBe(3)
    expect(Math.max(...guestPartnerCounts.values())).toBe(1)
  })

  it('keeps an opted-out participant in general matches only', () => {
    const guest = makeTestPlayer('guest', '스페셜', 'none', false, true)
    const optedOut = {
      ...makeTestPlayer('opted-out', 'B'),
      specialMatchEligible: false,
    }
    const regulars = [
      optedOut,
      ...Array.from({ length: 11 }, (_, index) =>
        makeTestPlayer(`regular-${index + 1}`, index < 6 ? 'B' : 'C'),
      ),
    ]
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 3,
      targetRoundCount: 5,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 3,
      specialTimeLimitEnabled: false,
    })
    const optedOutMatches = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) =>
        [...match.teamA, ...match.teamB].some((player) => player.id === optedOut.id),
      )

    expect(optedOutMatches.length).toBeGreaterThan(0)
    expect(optedOutMatches.every((match) => !match.isSpecial)).toBe(true)
  })

  it('allocates low and high priorities without repeating before coverage', () => {
    const guest = makeTestPlayer('guest', '스페셜', 'none', false, true)
    const regulars = [
      ...Array.from({ length: 12 }, (_, index) =>
        makeTestPlayer(`low-${index + 1}`, 'D'),
      ),
      ...Array.from({ length: 12 }, (_, index) =>
        makeTestPlayer(`high-${index + 1}`, 'A'),
      ),
    ]
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 4,
      targetRoundCount: 10,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 10,
      specialTimeLimitEnabled: false,
      specialLowPriorityEnabled: true,
      specialLowPriorityPercent: 10,
      specialHighPriorityEnabled: true,
      specialHighPriorityPercent: 90,
    })
    const specialMatches = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => match.isSpecial)
    const firstAverage = matchRegularAverageScore(specialMatches[0])
    const laterAverages = specialMatches.slice(1).map(matchRegularAverageScore)

    expect(specialMatches).toHaveLength(10)
    expect(schedule.specialCompletedIds).toHaveLength(24)
    expect(firstAverage).toBe(getPlayerMatchScore(regulars[0]))
    expect(
      laterAverages.slice(0, 4).every(
        (score) => score === getPlayerMatchScore(regulars[12]),
      ),
    ).toBe(true)
  })

  it('falls back from high to middle levels before low levels', () => {
    const guest = makeTestPlayer('guest', '스페셜', 'none', false, true)
    const regulars = (['A', 'B', 'C', 'D'] as const).flatMap((level) =>
      Array.from({ length: 3 }, (_, index) =>
        makeTestPlayer(`${level.toLowerCase()}-${index + 1}`, level),
      ),
    )
    const schedule = generateSchedule([guest, ...regulars], {
      ...defaultSettings,
      courtCount: 1,
      targetRoundCount: 4,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 4,
      specialTimeLimitEnabled: false,
      specialLowPriorityEnabled: false,
      specialLowPriorityPercent: 0,
      specialHighPriorityEnabled: true,
      specialHighPriorityPercent: 100,
    })
    const specialLevels = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => match.isSpecial)
      .map((match) =>
        [...match.teamA, ...match.teamB]
          .filter((player) => !player.isGuest)
          .map((player) => player.level),
      )

    expect(specialLevels).toEqual([
      ['A', 'A', 'A'],
      ['B', 'B', 'B'],
      ['C', 'C', 'C'],
      ['D', 'D', 'D'],
    ])
    expect(schedule.specialCompletedIds).toHaveLength(12)
  })

  it('applies the game limit to each special separately', () => {
    const guests = [
      makeTestPlayer('guest-1', '스페셜', 'none', false, true),
      makeTestPlayer('guest-2', '스페셜', 'none', false, true),
    ]
    const regulars = Array.from({ length: 16 }, (_, index) =>
      makeTestPlayer(`regular-${index + 1}`, index < 8 ? 'B' : 'C'),
    )
    const schedule = generateSchedule([...guests, ...regulars], {
      ...defaultSettings,
      courtCount: 4,
      targetRoundCount: 5,
      specialLimitEnabled: true,
      specialGameLimitEnabled: true,
      specialGameLimit: 2,
      specialTimeLimitEnabled: false,
    })

    expect(schedule.guestGameCounts['guest-1']).toBe(2)
    expect(schedule.guestGameCounts['guest-2']).toBe(2)
    for (const guest of guests) {
      const guestMatches = schedule.rounds
        .flatMap((round) => round.matches)
        .filter((match) =>
          [...match.teamA, ...match.teamB].some(
            (player) => player.id === guest.id,
          ),
        )
      expect(matchRegularAverageScore(guestMatches[0])).toBeLessThan(
        matchRegularAverageScore(guestMatches[1]),
      )
    }
  })

  it('calculates wins and point difference from a selected winner with scores', () => {
    const schedule = generateSchedule(samplePlayers, defaultSettings)
    const firstMatch = schedule.rounds[0].matches[0]
    const stats = calculateStats(samplePlayers, schedule, {
      [firstMatch.id]: {
        teamAScore: '21',
        teamBScore: '18',
        completed: true,
        note: '',
        winnerSide: 'A',
      },
    })

    for (const player of firstMatch.teamA) {
      const stat = stats.find((item) => item.player.id === player.id)
      expect(stat?.wins).toBe(1)
      expect((stat?.pointsFor ?? 0) - (stat?.pointsAgainst ?? 0)).toBe(3)
    }
  })

  it('does not infer wins from scores without a selected winner', () => {
    const schedule = generateSchedule(samplePlayers, defaultSettings)
    const firstMatch = schedule.rounds[0].matches[0]
    const stats = calculateStats(samplePlayers, schedule, {
      [firstMatch.id]: {
        teamAScore: '21',
        teamBScore: '18',
        completed: true,
        note: '',
      },
    })

    for (const player of firstMatch.teamA) {
      const stat = stats.find((item) => item.player.id === player.id)
      expect(stat?.wins).toBe(0)
      expect(stat?.losses).toBe(0)
      expect((stat?.pointsFor ?? 0) - (stat?.pointsAgainst ?? 0)).toBe(0)
    }
    for (const player of firstMatch.teamB) {
      const stat = stats.find((item) => item.player.id === player.id)
      expect(stat?.wins).toBe(0)
      expect(stat?.losses).toBe(0)
      expect((stat?.pointsFor ?? 0) - (stat?.pointsAgainst ?? 0)).toBe(0)
    }
  })

  it('calculates wins and losses from a winner button result without scores', () => {
    const schedule = generateSchedule(samplePlayers, defaultSettings)
    const firstMatch = schedule.rounds[0].matches[0]
    const stats = calculateStats(samplePlayers, schedule, {
      [firstMatch.id]: {
        teamAScore: '',
        teamBScore: '',
        completed: true,
        note: '',
        winnerSide: 'B',
      },
    })

    for (const player of firstMatch.teamA) {
      const stat = stats.find((item) => item.player.id === player.id)
      expect(stat?.losses).toBe(1)
      expect((stat?.pointsFor ?? 0) - (stat?.pointsAgainst ?? 0)).toBe(0)
    }
    for (const player of firstMatch.teamB) {
      const stat = stats.find((item) => item.player.id === player.id)
      expect(stat?.wins).toBe(1)
      expect((stat?.pointsFor ?? 0) - (stat?.pointsAgainst ?? 0)).toBe(0)
    }
  })

  it('counts match-level renamed participants in stats', () => {
    const players = [
      makeTestPlayer('regular-1', 'A'),
      makeTestPlayer('regular-2', 'B'),
      makeTestPlayer('regular-3', 'C'),
      makeTestPlayer('regular-4', 'D'),
    ]
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 1,
      targetRoundCount: 1,
    })
    const firstMatch = schedule.rounds[0].matches[0]
    const replacedPlayer = firstMatch.teamA[0]
    const stats = calculateStats(players, schedule, {}, {
      [firstMatch.id]: {
        [replacedPlayer.id]: '현장참가자',
      },
    })
    const originalStat = stats.find((item) => item.player.id === replacedPlayer.id)
    const manualStat = stats.find((item) => item.player.name === '현장참가자')

    expect(originalStat?.games).toBe(0)
    expect(originalStat?.averageWaitMinutes).toBeNull()
    expect(manualStat?.games).toBe(1)
    expect(manualStat?.averageWaitMinutes).toBeNull()
  })

  it('calculates average and maximum waits between matches', () => {
    const players = Array.from({ length: 4 }, (_, index) =>
      makeTestPlayer(`wait-${index + 1}`, 'B'),
    )
    const schedule = generateSchedule(players, {
      ...defaultSettings,
      courtCount: 1,
      targetRoundCount: 3,
      conditionOptions: {
        ...defaultMatchConditionOptions,
        groupRepeat: false,
      },
    })
    const starts = [0, 15, 45]
    schedule.rounds.forEach((round, index) => {
      round.matches[0].startOffsetMinutes = starts[index]
      round.matches[0].durationMinutes = 15
    })

    const stats = calculateStats(players, schedule, {})

    expect(stats.every((stat) => stat.averageWaitMinutes === 7.5)).toBe(true)
    expect(stats.every((stat) => stat.maxWaitMinutes === 15)).toBe(true)
  })
})

describe('generateBalancedTournamentTeams', () => {
  it('builds friendly tournament teams from numbered participants only', () => {
    const players = makeNumberedTournamentPlayers(8)
    const result = generateBalancedTournamentTeams(players, 4)
    const memberNames = result.teams.flatMap((team) =>
      (team.members ?? []).map((member) => member.name),
    )

    expect(result.teams).toHaveLength(4)
    expect(memberNames).toEqual(
      expect.arrayContaining(['1번', '2번', '3번', '4번', '5번', '6번', '7번', '8번']),
    )
    expect(result.teams.every((team) => (team.members?.length ?? 0) === 2)).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('splits bulk players into the requested number of balanced teams', () => {
    const players = [
      makeTestPlayer('a-1', 'A', 'male'),
      makeTestPlayer('a-2', 'A', 'female'),
      makeTestPlayer('b-1', 'B', 'male'),
      makeTestPlayer('b-2', 'B', 'female'),
      makeTestPlayer('b-3', 'B', 'male'),
      makeTestPlayer('c-1', 'C', 'female'),
      makeTestPlayer('c-2', 'C', 'male'),
      makeTestPlayer('c-3', 'C', 'female'),
      makeTestPlayer('d-1', 'D', 'male'),
      makeTestPlayer('d-2', 'D', 'female'),
      makeTestPlayer('d-3', 'D', 'male'),
      makeTestPlayer('d-4', 'D', 'female'),
    ]

    const result = generateBalancedTournamentTeams(players, 4)
    const assignedIds = result.teams.flatMap((team) =>
      (team.members ?? []).map((member) => member.id),
    )
    const teamSizes = result.teams.map((team) => team.members?.length ?? 0)
    const scoreByPlayerId = new Map(
      players.map((player) => [player.id, getPlayerMatchScore(player)]),
    )
    const teamScores = result.teams.map((team) =>
      (team.members ?? []).reduce(
        (sum, member) => sum + (scoreByPlayerId.get(member.id) ?? 0),
        0,
      ),
    )

    expect(result.teams).toHaveLength(4)
    expect(new Set(assignedIds).size).toBe(players.length)
    expect(assignedIds).toEqual(expect.arrayContaining(players.map((player) => player.id)))
    expect(Math.max(...teamSizes) - Math.min(...teamSizes)).toBeLessThanOrEqual(1)
    expect(Math.max(...teamScores) - Math.min(...teamScores)).toBeLessThan(45)
    expect(result.warnings).toHaveLength(0)
  })
})

describe('generateTournamentSchedule', () => {
  it('avoids assigning the same competition team to two courts at once', () => {
    const teams = Array.from({ length: 6 }, (_, index) =>
      makeTournamentTeam(`team-${index + 1}`, index + 1),
    )
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'group-knockout',
        courtCount: 4,
        groupCount: 2,
      },
      {},
    )

    const matchesByRound = new Map<number, typeof schedule.matches>()
    for (const match of schedule.matches) {
      matchesByRound.set(match.round, [
        ...(matchesByRound.get(match.round) ?? []),
        match,
      ])
    }
    for (const matches of matchesByRound.values()) {
      const teamIds = matches.flatMap((match) =>
        [match.teamAId, match.teamBId].filter(Boolean),
      )
      expect(new Set(teamIds).size).toBe(teamIds.length)
    }
  })

  it('places a knockout final after the semifinal time slot', () => {
    const teams = Array.from({ length: 4 }, (_, index) =>
      makeTournamentTeam(`team-${index + 1}`, index + 1),
    )
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'knockout',
        courtCount: 4,
        includeThirdPlace: true,
      },
      {},
    )
    const semifinals = schedule.matches.filter((match) => match.bracketRound === 1)
    const final = schedule.matches.find(
      (match) => match.label === '결승' && match.phase === 'knockout',
    )

    expect(final?.round).toBeGreaterThan(
      Math.max(...semifinals.map((match) => match.round)),
    )
  })

  it('keeps reserved knockout slots fixed while results are entered', () => {
    const teams = Array.from({ length: 8 }, (_, index) =>
      makeTournamentTeam(`stable-team-${index + 1}`, index + 1),
    )
    const settings = {
      ...defaultTournamentSettings,
      format: 'knockout' as const,
      courtCount: 4,
      includeThirdPlace: true,
    }
    const initial = generateTournamentSchedule(teams, settings, {})
    const initialSlots = new Map(
      initial.knockoutMatches.map((match) => [
        match.id,
        { round: match.round, court: match.court, order: match.order },
      ]),
    )
    const quarterfinalResults = Object.fromEntries(
      initial.knockoutMatches
        .filter((match) => match.bracketRound === 1 && !match.isBye)
        .map((match) => [
          match.id,
          {
            teamAScore: '21',
            teamBScore: '10',
            completed: true,
            note: '',
            winnerSide: 'A' as const,
          },
        ]),
    )
    const afterQuarterfinals = generateTournamentSchedule(
      teams,
      settings,
      quarterfinalResults,
    )
    const semifinalResults = Object.fromEntries(
      afterQuarterfinals.knockoutMatches
        .filter((match) => match.bracketRound === 2 && !match.isBye)
        .map((match) => [
          match.id,
          {
            teamAScore: '21',
            teamBScore: '15',
            completed: true,
            note: '',
            winnerSide: 'A' as const,
          },
        ]),
    )
    const completed = generateTournamentSchedule(teams, settings, {
      ...quarterfinalResults,
      ...semifinalResults,
    })

    for (const schedule of [afterQuarterfinals, completed]) {
      expect(
        schedule.knockoutMatches.map((match) => [
          match.id,
          { round: match.round, court: match.court, order: match.order },
        ]),
      ).toEqual(
        initial.knockoutMatches.map((match) => [
          match.id,
          initialSlots.get(match.id),
        ]),
      )
    }
    const quarterfinalRound = Math.max(
      ...initial.knockoutMatches
        .filter((match) => match.bracketRound === 1)
        .map((match) => match.round),
    )
    const semifinalRound = Math.min(
      ...initial.knockoutMatches
        .filter((match) => match.bracketRound === 2)
        .map((match) => match.round),
    )
    const finalRound = Math.min(
      ...initial.knockoutMatches
        .filter((match) => match.bracketRound === 3)
        .map((match) => match.round),
    )
    expect(semifinalRound - quarterfinalRound).toBeGreaterThanOrEqual(2)
    expect(finalRound - semifinalRound).toBeGreaterThanOrEqual(2)
  })

  it('advances a bye team into the next knockout round', () => {
    const teams = [
      makeTournamentTeam('seed-1', 1),
      makeTournamentTeam('seed-2', 2),
      makeTournamentTeam('seed-3', 3),
    ]
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'knockout',
        includeThirdPlace: false,
      },
      {},
    )
    const byeMatch = schedule.knockoutMatches.find((match) => match.isBye)
    const final = schedule.knockoutMatches.find((match) => match.label === '결승')

    expect(byeMatch?.teamAId).toBe('seed-1')
    expect(final?.teamAId).toBe('seed-1')
  })

  it('keeps unseeded teams behind seeded teams in knockout placement', () => {
    const teams = [
      makeTournamentTeam('unseeded-b', null),
      makeTournamentTeam('seed-1', 1),
      makeTournamentTeam('unseeded-a', null),
      makeTournamentTeam('seed-2', 2),
    ]
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'knockout',
        includeThirdPlace: false,
      },
      {},
    )
    const semifinals = schedule.knockoutMatches.filter(
      (match) => match.label !== '결승',
    )

    expect(semifinals[0].teamAId).toBe('seed-1')
    expect(semifinals[1].teamAId).toBe('seed-2')
  })

  it('fills the final after semifinal results are entered', () => {
    const teams = Array.from({ length: 4 }, (_, index) =>
      makeTournamentTeam(`team-${index + 1}`, index + 1),
    )
    const initial = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'knockout',
        includeThirdPlace: true,
      },
      {},
    )
    const semifinals = initial.knockoutMatches.filter(
      (match) => match.label !== '결승' && match.phase === 'knockout',
    )
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'knockout',
        includeThirdPlace: true,
      },
      {
        [semifinals[0].id]: {
          teamAScore: '21',
          teamBScore: '12',
          completed: true,
          note: '',
        },
        [semifinals[1].id]: {
          teamAScore: '17',
          teamBScore: '21',
          completed: true,
          note: '',
        },
      },
    )
    const final = schedule.knockoutMatches.find((match) => match.label === '결승')
    const thirdPlace = schedule.knockoutMatches.find(
      (match) => match.phase === 'third-place',
    )

    expect(final?.teamAId).toBe(semifinals[0].teamAId)
    expect(final?.teamBId).toBe(semifinals[1].teamBId)
    expect(thirdPlace?.teamAId).toBe(semifinals[0].teamBId)
    expect(thirdPlace?.teamBId).toBe(semifinals[1].teamAId)
  })

  it('advances a selected winner without requiring tournament scores', () => {
    const teams = Array.from({ length: 4 }, (_, index) =>
      makeTournamentTeam(`winner-only-${index + 1}`, index + 1),
    )
    const settings = {
      ...defaultTournamentSettings,
      format: 'knockout' as const,
      includeThirdPlace: false,
    }
    const initial = generateTournamentSchedule(teams, settings, {})
    const semifinals = initial.knockoutMatches.filter(
      (match) => match.label !== '결승' && match.phase === 'knockout',
    )
    const results = {
      [semifinals[0].id]: {
        teamAScore: '',
        teamBScore: '',
        completed: true,
        note: '',
        winnerSide: 'A' as const,
      },
      [semifinals[1].id]: {
        teamAScore: '',
        teamBScore: '',
        completed: true,
        note: '',
        winnerSide: 'B' as const,
      },
    }
    const schedule = generateTournamentSchedule(teams, settings, results)
    const final = schedule.knockoutMatches.find((match) => match.label === '결승')

    expect(getTournamentMatchWinnerId(semifinals[0], results[semifinals[0].id]))
      .toBe(semifinals[0].teamAId)
    expect(getTournamentMatchWinnerId(semifinals[1], results[semifinals[1].id]))
      .toBe(semifinals[1].teamBId)
    expect(final?.teamAId).toBe(semifinals[0].teamAId)
    expect(final?.teamBId).toBe(semifinals[1].teamBId)
  })

  it('records a selected group winner without inventing points', () => {
    const teams = Array.from({ length: 4 }, (_, index) =>
      makeTournamentTeam(`group-winner-${index + 1}`, index + 1),
    )
    const settings = {
      ...defaultTournamentSettings,
      format: 'group-knockout' as const,
      groupCount: 2,
      advancePerGroup: 1,
      includeThirdPlace: false,
    }
    const initial = generateTournamentSchedule(teams, settings, {})
    const groupMatch = initial.matches.find(
      (match) => match.phase === 'group' && match.teamAId && match.teamBId,
    )
    expect(groupMatch).toBeDefined()
    if (!groupMatch?.teamAId || !groupMatch.teamBId) return

    const schedule = generateTournamentSchedule(teams, settings, {
      [groupMatch.id]: {
        teamAScore: '',
        teamBScore: '',
        completed: true,
        note: '',
        winnerSide: 'A',
      },
    })
    const winner = schedule.standings.find(
      (standing) => standing.team.id === groupMatch.teamAId,
    )
    const loser = schedule.standings.find(
      (standing) => standing.team.id === groupMatch.teamBId,
    )

    expect(winner).toMatchObject({ wins: 1, pointsFor: 0, pointsAgainst: 0 })
    expect(loser).toMatchObject({ losses: 1, pointsFor: 0, pointsAgainst: 0 })
  })

  it('ranks group teams by wins, point difference, points, head-to-head, then seed', () => {
    const teams = [
      makeTournamentTeam('team-a', 1),
      makeTournamentTeam('team-b', 2),
      makeTournamentTeam('team-c', 3),
    ]
    const initial = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'group-knockout',
        groupCount: 1,
        advancePerGroup: 1,
        includeThirdPlace: false,
      },
      {},
    )
    const matchByTeams = (left: string, right: string) => {
      const match = initial.matches.find(
        (item) =>
          item.phase === 'group' &&
          ((item.teamAId === left && item.teamBId === right) ||
            (item.teamAId === right && item.teamBId === left)),
      )
      expect(match).toBeDefined()
      return match
    }
    const ab = matchByTeams('team-a', 'team-b')
    const ac = matchByTeams('team-a', 'team-c')
    const bc = matchByTeams('team-b', 'team-c')
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'group-knockout',
        groupCount: 1,
        advancePerGroup: 1,
        includeThirdPlace: false,
      },
      {
        [ab!.id]: {
          teamAScore: ab!.teamAId === 'team-a' ? '21' : '10',
          teamBScore: ab!.teamAId === 'team-a' ? '10' : '21',
          completed: true,
          note: '',
        },
        [bc!.id]: {
          teamAScore: bc!.teamAId === 'team-b' ? '21' : '10',
          teamBScore: bc!.teamAId === 'team-b' ? '10' : '21',
          completed: true,
          note: '',
        },
        [ac!.id]: {
          teamAScore: ac!.teamAId === 'team-c' ? '21' : '20',
          teamBScore: ac!.teamAId === 'team-c' ? '20' : '21',
          completed: true,
          note: '',
        },
      },
    )

    expect(schedule.standings.map((standing) => standing.team.id)).toEqual([
      'team-a',
      'team-b',
      'team-c',
    ])
    expect(schedule.qualifiedTeamIds).toEqual(['team-a'])
  })

  it('creates knockout matches from group qualifiers', () => {
    const teams = Array.from({ length: 6 }, (_, index) =>
      makeTournamentTeam(`team-${index + 1}`, index + 1),
    )
    const initial = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'group-knockout',
        groupCount: 2,
        advancePerGroup: 1,
        includeThirdPlace: false,
      },
      {},
    )
    const groupResults = Object.fromEntries(
      initial.matches
        .filter((match) => match.phase === 'group')
        .map((match) => [
          match.id,
          {
            teamAScore: '21',
            teamBScore: '10',
            completed: true,
            note: '',
          },
        ]),
    )
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'group-knockout',
        groupCount: 2,
        advancePerGroup: 1,
        includeThirdPlace: false,
      },
      groupResults,
    )

    expect(schedule.qualifiedTeamIds).toHaveLength(2)
    expect(schedule.knockoutMatches).toHaveLength(1)
    expect(schedule.knockoutMatches[0].label).toBe('결승')
  })

  it('reserves knockout time slots until every group match is completed', () => {
    const teams = Array.from({ length: 6 }, (_, index) =>
      makeTournamentTeam(`team-${index + 1}`, index + 1),
    )
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'group-knockout',
        groupCount: 2,
        advancePerGroup: 1,
        includeThirdPlace: false,
      },
      {},
    )

    expect(schedule.qualifiedTeamIds).toHaveLength(0)
    expect(schedule.knockoutMatches).toHaveLength(1)
    expect(schedule.knockoutMatches[0]).toMatchObject({
      label: '결승',
      teamAId: undefined,
      teamBId: undefined,
      sourceA: '1번 진출팀',
      sourceB: '2번 진출팀',
    })
    expect(schedule.warnings.some((warning) => warning.includes('조별 경기 미완료'))).toBe(
      true,
    )
  })

  it('calculates team battle winners from sub-match wins', () => {
    const teams = [makeTournamentTeam('alpha', 1), makeTournamentTeam('beta', 2)]
    const initial = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'team-battle',
        teamBattleMatchCount: 3,
      },
      {},
    )
    const [first, second, third] = initial.matches
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'team-battle',
        teamBattleMatchCount: 3,
      },
      {
        [first.id]: {
          teamAScore: '21',
          teamBScore: '12',
          completed: true,
          note: '',
        },
        [second.id]: {
          teamAScore: '18',
          teamBScore: '21',
          completed: true,
          note: '',
        },
        [third.id]: {
          teamAScore: '21',
          teamBScore: '19',
          completed: true,
          note: '',
        },
      },
    )

    expect(schedule.teamBattleTies[0].winnerTeamId).toBe('alpha')
    expect(schedule.teamBattleStandings[0].team.id).toBe('alpha')
    expect(schedule.teamBattleStandings[0].matchWins).toBe(2)
    expect(schedule.teamBattleStandings[0].pointsFor).toBe(60)
    expect(schedule.teamBattleStandings[0].pointsAgainst).toBe(52)
    expect(schedule.teamBattleStandings[0].pointDiff).toBe(8)
  })

  it('uses generic doubles slots for friendly team battles', () => {
    const schedule = generateTournamentSchedule(
      [makeTournamentTeam('alpha', 1), makeTournamentTeam('beta', 2)],
      {
        ...defaultTournamentSettings,
        format: 'friendly-team-battle',
        teamBattleMatchCount: 3,
        teamBattleSlots: ['남복', '혼복', '여복'],
      },
      {},
    )

    expect(schedule.matches.map((match) => match.teamBattleSlot)).toEqual([
      '복식 1',
      '복식 2',
      '복식 3',
    ])
  })

  it('picks the friendly MVP candidate by wins then point difference', () => {
    const teams: TournamentTeam[] = [
      {
        ...makeTournamentTeam('alpha', 1),
        members: [
          makeTournamentMember('a-1'),
          makeTournamentMember('a-2'),
          makeTournamentMember('a-3'),
        ],
      },
      {
        ...makeTournamentTeam('beta', 2),
        members: [
          makeTournamentMember('b-1'),
          makeTournamentMember('b-2'),
          makeTournamentMember('b-3'),
        ],
      },
    ]
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'friendly-team-battle',
        teamBattleMatchCount: 3,
      },
      {},
    )
    const [first, second, third] = schedule.matches
    const lineups = {
      [first.id]: {
        teamAPlayerIds: ['a-1', 'a-3'],
        teamBPlayerIds: ['b-1', 'b-3'],
      },
      [second.id]: {
        teamAPlayerIds: ['a-2', 'a-3'],
        teamBPlayerIds: ['b-2', 'b-3'],
      },
      [third.id]: {
        teamAPlayerIds: ['a-1', 'a-2'],
        teamBPlayerIds: ['b-1', 'b-2'],
      },
    }
    const candidates = calculateTournamentMvpCandidates(
      schedule.matches,
      teams,
      {
        [first.id]: {
          teamAScore: '21',
          teamBScore: '20',
          completed: true,
          note: '',
        },
        [second.id]: {
          teamAScore: '21',
          teamBScore: '10',
          completed: true,
          note: '',
        },
        [third.id]: {
          teamAScore: '21',
          teamBScore: '19',
          completed: true,
          note: '',
        },
      },
      lineups,
    )

    expect(candidates.alpha).toBe('a-2')
  })

  it('builds friendly doubles lineups from each team roster when a team has an odd roster', () => {
    const teams: TournamentTeam[] = [
      {
        ...makeTournamentTeam('alpha', 1),
        name: 'A팀',
        playerNames: '',
        members: [
          makeTournamentMember('a-1', 'A', 'male'),
          makeTournamentMember('a-2', 'B', 'female'),
          makeTournamentMember('a-3', 'C', 'male'),
        ],
      },
      {
        ...makeTournamentTeam('beta', 2),
        name: 'B팀',
        playerNames: '',
        members: [
          makeTournamentMember('b-1', 'A', 'female'),
          makeTournamentMember('b-2', 'B', 'male'),
          makeTournamentMember('b-3', 'B', 'female'),
          makeTournamentMember('b-4', 'C', 'male'),
          makeTournamentMember('b-5', 'C', 'female'),
        ],
      },
    ]
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'friendly-team-battle',
        teamBattleMatchCount: 2,
      },
      {},
    )
    const lineups = generateTournamentLineups(schedule.matches, teams)
    const alphaPlayerIds = schedule.matches.flatMap(
      (match) => lineups[match.id]?.teamAPlayerIds ?? [],
    )

    expect(Object.keys(lineups)).toHaveLength(2)
    expect(alphaPlayerIds.every((playerId) => playerId.startsWith('a-'))).toBe(true)
    expect(new Set(alphaPlayerIds).size).toBeGreaterThan(2)
    expect(
      Object.values(lineups).every(
        (lineup) =>
          lineup.teamAPlayerIds.filter(Boolean).length === 2 &&
          lineup.teamBPlayerIds.filter(Boolean).length === 2,
      ),
    ).toBe(true)
  })

  it('rotates friendly doubles lineups evenly within each team', () => {
    const teams: TournamentTeam[] = [
      {
        ...makeTournamentTeam('alpha', 1),
        name: 'A팀',
        playerNames: '',
        members: [
          makeTournamentMember('a-d', 'D', 'male'),
          makeTournamentMember('a-c', 'C', 'female'),
          makeTournamentMember('a-b', 'B', 'male'),
          makeTournamentMember('a-a', 'A', 'female'),
          makeTournamentMember('a-oa', 'OA', 'male'),
        ],
      },
      {
        ...makeTournamentTeam('beta', 2),
        name: 'B팀',
        playerNames: '',
        members: [
          makeTournamentMember('b-d', 'D', 'female'),
          makeTournamentMember('b-c', 'C', 'male'),
          makeTournamentMember('b-b', 'B', 'female'),
          makeTournamentMember('b-a', 'A', 'male'),
          makeTournamentMember('b-oa', 'OA', 'female'),
        ],
      },
    ]
    const schedule = generateTournamentSchedule(
      teams,
      {
        ...defaultTournamentSettings,
        format: 'friendly-team-battle',
        teamBattleMatchCount: 5,
      },
      {},
    )
    const lineups = generateTournamentLineups(schedule.matches, teams)
    const playCounts = (teamIdPrefix: string, side: 'teamAPlayerIds' | 'teamBPlayerIds') => {
      const counts = new Map(
        teams
          .flatMap((team) => team.members ?? [])
          .filter((member) => member.id.startsWith(teamIdPrefix))
          .map((member) => [member.id, 0]),
      )

      for (const lineup of Object.values(lineups)) {
        for (const playerId of lineup[side]) {
          counts.set(playerId, (counts.get(playerId) ?? 0) + 1)
        }
      }

      return [...counts.values()]
    }
    const alphaCounts = playCounts('a-', 'teamAPlayerIds')
    const betaCounts = playCounts('b-', 'teamBPlayerIds')

    expect(Math.max(...alphaCounts) - Math.min(...alphaCounts)).toBeLessThanOrEqual(1)
    expect(Math.max(...betaCounts) - Math.min(...betaCounts)).toBeLessThanOrEqual(1)
    expect(alphaCounts.every((count) => count > 0)).toBe(true)
    expect(betaCounts.every((count) => count > 0)).toBe(true)
  })
})
