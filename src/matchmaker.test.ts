import { describe, expect, it } from 'vitest'
import {
  defaultMatchConditionOptions,
  defaultPlayers,
  samplePlayers,
  defaultSettings,
  defaultTournamentSettings,
} from './defaultData'
import {
  calculateTournamentMvpCandidates,
  calculateStats,
  generateBalancedTournamentTeams,
  generateSchedule,
  findScheduleOverlap,
  swapMeetingPlayers,
  generateTournamentLineups,
  generateTournamentSchedule,
  getPlayerMatchTier,
  getPlayerMatchScore,
  makeNumberedTournamentPlayers,
} from './matchmaker'
import { makePlayerNameLookup, playerDisplayName } from './playerNames'
import type {
  AgeGroup,
  Gender,
  Level,
  Player,
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

  it('selects a same-gender, same-level, close-age general group when available', () => {
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
    const playerIds = [
      ...schedule.rounds[0].matches[0].teamA,
      ...schedule.rounds[0].matches[0].teamB,
    ].map((player) => player.id)

    expect(playerIds.every((playerId) => playerId.startsWith('preferred-'))).toBe(true)
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

  it('tightens general match team gaps toward the final rounds', () => {
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

    expect(schedule.warnings).toHaveLength(0)
    expect(average(roundGaps.slice(-2))).toBeLessThanOrEqual(
      average(roundGaps.slice(0, 2)),
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
    expect(guestRounds).toEqual([1, 2, 3, 4])
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
  })

  it('reduces repeated four-player groups in a 56-player meeting', () => {
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

    expect(enabled.duplicates).toBe(0)
    expect(enabled.duplicates).toBeLessThan(disabled.duplicates)
    expect(enabled.schedule.rounds).toHaveLength(12)
    expect(enabled.schedule.rounds.every((round) => round.matches.length === 6)).toBe(true)
    expect(Math.max(...regularGameCounts) - Math.min(...regularGameCounts)).toBeLessThanOrEqual(1)
  })

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
