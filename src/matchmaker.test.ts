import { describe, expect, it } from 'vitest'
import {
  defaultMatchConditionOptions,
  defaultPlayers,
  samplePlayers,
  defaultSettings,
  defaultTournamentSettings,
} from './defaultData'
import {
  calculateStats,
  generateSchedule,
  generateTournamentSchedule,
  getPlayerMatchScore,
} from './matchmaker'
import { makePlayerNameLookup, playerDisplayName } from './playerNames'
import type { AgeGroup, Gender, Level, Player, TournamentTeam } from './types'

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

describe('generateSchedule', () => {
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

  it('prioritizes same-level same-gender teams when available', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('male-a1', 'A', 'male'),
        makeTestPlayer('male-a2', 'A', 'male'),
        makeTestPlayer('female-b1', 'B', 'female'),
        makeTestPlayer('female-b2', 'B', 'female'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        targetRoundCount: 1,
      },
    )
    const match = schedule.rounds[0].matches[0]

    const teamAKeys = match.teamA.map((player) => `${player.gender}-${player.level}`)
    const teamBKeys = match.teamB.map((player) => `${player.gender}-${player.level}`)

    expect(new Set(teamAKeys).size).toBe(1)
    expect(new Set(teamBKeys).size).toBe(1)
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
    const oa20 = makeTestPlayer('oa-20', 'OA', 'female', false, false, '20대')
    const oa55 = makeTestPlayer('oa-55', 'OA', 'male', false, false, '55대이상')
    const o20 = makeTestPlayer('o-20', 'O', 'female', false, false, '20대')

    expect(getPlayerMatchScore(male20A)).toBeGreaterThan(getPlayerMatchScore(male30A))
    expect(getPlayerMatchScore(female20A)).toBe(getPlayerMatchScore(male40B))
    expect(getPlayerMatchScore(d20)).toBeLessThan(getPlayerMatchScore(female55C))
    expect(getPlayerMatchScore(d20)).toBeGreaterThan(getPlayerMatchScore(d55))
    expect(getPlayerMatchScore(oa20)).toBe(getPlayerMatchScore(oa55))
    expect(getPlayerMatchScore(o20)).toBe(getPlayerMatchScore(oa20))
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
    expect(regularStats.every((stat) => stat.guestGames >= 2)).toBe(true)
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
      makeTestPlayer('regular-1', 'A', 'male', true),
      makeTestPlayer('regular-2', 'B', 'female', true),
      makeTestPlayer('regular-3', 'C', 'male', true),
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

  it('prefers regular participants near the special guest level', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('guest', '스페셜', 'none', false, true),
        makeTestPlayer('a1', 'A'),
        makeTestPlayer('a2', 'A'),
        makeTestPlayer('b1', 'B'),
        makeTestPlayer('c1', 'C'),
        makeTestPlayer('d1', 'D'),
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

    expect(regularLevels).toEqual(expect.arrayContaining(['A', 'A', 'B']))
    expect(regularLevels).not.toContain('D')
  })

  it('prefers same-gender regulars in the first special match', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('guest', '스페셜', 'none', false, true),
        makeTestPlayer('female-a', 'A', 'female', true),
        makeTestPlayer('male-a1', 'A'),
        makeTestPlayer('male-a2', 'A'),
        makeTestPlayer('male-b', 'B'),
        makeTestPlayer('male-c', 'C'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        seed: 9,
      },
    )

    const matchPlayers = [...schedule.rounds[0].matches[0].teamA, ...schedule.rounds[0].matches[0].teamB]

    expect(matchPlayers.map((player) => player.id)).toEqual(
      expect.arrayContaining(['male-a1', 'male-a2', 'male-b']),
    )
    expect(matchPlayers.map((player) => player.id)).not.toContain('female-a')
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
    expect(originalStat?.rests).toBeGreaterThan(0)
    expect(manualStat?.games).toBe(1)
    expect(manualStat?.rests).toBe(0)
  })
})

describe('generateTournamentSchedule', () => {
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

  it('keeps knockout closed until every group match is completed', () => {
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
    expect(schedule.knockoutMatches).toHaveLength(0)
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
  })
})
