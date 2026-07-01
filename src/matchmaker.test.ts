import { describe, expect, it } from 'vitest'
import { defaultPlayers, defaultSettings } from './defaultData'
import { calculateStats, generateSchedule } from './matchmaker'
import type { Gender, Level, Player } from './types'

const makeTestPlayer = (
  id: string,
  level: Level,
  gender: Gender = 'male',
  specialRequired = false,
  isGuest = false,
): Player => ({
  id,
  name: id,
  level,
  ageGroup: '30대',
  gender: isGuest ? 'none' : gender,
  active: true,
  specialRequired: isGuest ? false : specialRequired,
  isGuest,
  guestGameLimit: isGuest ? 3 : 0,
})

describe('defaultPlayers', () => {
  it('uses generic sample labels except for the named guest players', () => {
    expect(defaultPlayers.filter((player) => player.isGuest).map((player) => player.name))
      .toEqual(['고성현', '신백철', '스페셜 1'])
    expect(defaultPlayers.filter((player) => !player.isGuest).map((player) => player.name))
      .toEqual(Array.from({ length: 12 }, (_, index) => `참가자 ${index + 1}`))
  })
})

describe('generateSchedule', () => {
  it('creates court-limited doubles matches without round duplicates', () => {
    const schedule = generateSchedule(defaultPlayers, defaultSettings)

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

  it('pairs two men and two women as mixed doubles when available', () => {
    const schedule = generateSchedule(
      [
        makeTestPlayer('male-a', 'A', 'male'),
        makeTestPlayer('male-b', 'B', 'male'),
        makeTestPlayer('female-a', 'A', 'female'),
        makeTestPlayer('female-b', 'B', 'female'),
      ],
      {
        ...defaultSettings,
        courtCount: 1,
        targetRoundCount: 1,
      },
    )
    const match = schedule.rounds[0].matches[0]

    expect(match.teamA.filter((player) => player.gender === 'male')).toHaveLength(1)
    expect(match.teamA.filter((player) => player.gender === 'female')).toHaveLength(1)
    expect(match.teamB.filter((player) => player.gender === 'male')).toHaveLength(1)
    expect(match.teamB.filter((player) => player.gender === 'female')).toHaveLength(1)
  })

  it('auto-generates enough order slots for every regular participant to play with a guest', () => {
    const schedule = generateSchedule(defaultPlayers, {
      ...defaultSettings,
      courtCount: 3,
      seed: 33,
    })
    const regularIds = defaultPlayers
      .filter((player) => player.active && !player.isGuest)
      .map((player) => player.id)

    expect(schedule.specialCompletedIds).toEqual(expect.arrayContaining(regularIds))
    expect(schedule.warnings).toHaveLength(0)
  })

  it('fills the configured two-hour round target after special matches are complete', () => {
    const schedule = generateSchedule(defaultPlayers, {
      ...defaultSettings,
      courtCount: 3,
      seed: 33,
    })

    expect(schedule.rounds).toHaveLength(defaultSettings.targetRoundCount)
    expect(schedule.warnings).toHaveLength(0)
  })

  it('extends the schedule when more rounds are requested', () => {
    const schedule = generateSchedule(defaultPlayers, {
      ...defaultSettings,
      courtCount: 3,
      seed: 33,
      targetRoundCount: defaultSettings.targetRoundCount + 2,
    })

    expect(schedule.rounds).toHaveLength(defaultSettings.targetRoundCount + 2)
    expect(schedule.warnings).toHaveLength(0)
  })

  it('allows participants to play multiple guest matches within the target window', () => {
    const schedule = generateSchedule(defaultPlayers, {
      ...defaultSettings,
      courtCount: 3,
      seed: 33,
    })
    const regularStats = calculateStats(defaultPlayers, schedule, {}).filter(
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
    const schedule = generateSchedule(defaultPlayers, defaultSettings)
    const availableCourts = Math.min(
      defaultSettings.courtCount,
      Math.floor(defaultPlayers.filter((player) => player.active).length / 4),
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
    const schedule = generateSchedule(defaultPlayers, {
      ...defaultSettings,
      courtCount: 4,
      seed: 33,
    })
    const requiredIds = defaultPlayers
      .filter((player) => player.active && !player.isGuest)
      .map((player) => player.id)

    expect(schedule.specialCompletedIds).toEqual(expect.arrayContaining(requiredIds))
    expect(schedule.warnings).toHaveLength(0)
  })

  it('builds special matches with one guest and three regular participants', () => {
    const schedule = generateSchedule(defaultPlayers, {
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

  it('prefers male participants one level below a female participant in special matches', () => {
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
      expect.arrayContaining(['female-a', 'male-b']),
    )
  })

  it('fills every court when enough active players are available', () => {
    const schedule = generateSchedule(
      [
        ...defaultPlayers,
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

  it('calculates wins and point difference from entered results', () => {
    const schedule = generateSchedule(defaultPlayers, defaultSettings)
    const firstMatch = schedule.rounds[0].matches[0]
    const stats = calculateStats(defaultPlayers, schedule, {
      [firstMatch.id]: {
        teamAScore: '21',
        teamBScore: '18',
        completed: true,
        note: '',
      },
    })

    for (const player of firstMatch.teamA) {
      const stat = stats.find((item) => item.player.id === player.id)
      expect(stat?.wins).toBe(1)
      expect((stat?.pointsFor ?? 0) - (stat?.pointsAgainst ?? 0)).toBe(3)
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
