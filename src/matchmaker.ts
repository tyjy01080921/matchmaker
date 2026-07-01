import type {
  Match,
  MatchNameOverrides,
  MatchSettings,
  Player,
  PlayerStat,
  ResultsByMatch,
  Round,
  Schedule,
  Team,
} from './types'

type HistoryState = {
  games: Record<string, number>
  rests: Record<string, number>
  restStreaks: Record<string, number>
  playStreaks: Record<string, number>
  partners: Record<string, number>
  opponents: Record<string, number>
  specialCompleted: Set<string>
  specialGameCounts: Record<string, number>
  guestGameCounts: Record<string, number>
}

type Pairing = {
  teamA: Team
  teamB: Team
  score: number
}

const DEFAULT_TARGET_ROUND_COUNT = 8
const GUEST_REPEAT_PARTNER_PENALTY = 5000

const pairKey = (a: string, b: string) => [a, b].sort().join('__')

const makeRandom = (seed: number) => {
  let value = seed || 1
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

const emptyCounts = (players: Player[]) =>
  Object.fromEntries(players.map((player) => [player.id, 0]))

const makeHistory = (players: Player[]): HistoryState => ({
  games: emptyCounts(players),
  rests: emptyCounts(players),
  restStreaks: emptyCounts(players),
  playStreaks: emptyCounts(players),
  partners: {},
  opponents: {},
  specialCompleted: new Set<string>(),
  specialGameCounts: emptyCounts(players),
  guestGameCounts: Object.fromEntries(
    players.filter((player) => player.isGuest).map((player) => [player.id, 0]),
  ),
})

const normalizeTargetRoundCount = (value: unknown) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_TARGET_ROUND_COUNT
  return Math.max(1, Math.floor(numeric))
}

const guestHasRemainingExtraGames = (guest: Player, history: HistoryState) => {
  const limit = Math.floor(Number(guest.guestGameLimit) || 0)
  return limit <= 0 || (history.guestGameCounts[guest.id] ?? 0) < limit
}

const specialGameCount = (player: Player, history: HistoryState) =>
  history.specialGameCounts[player.id] ?? 0

const hasGuest = (players: Player[]) => players.some((player) => player.isGuest)

const levelValue = (player: Player) => {
  if (player.level === '스페셜') return 8
  if (player.level === 'A') return 4
  if (player.level === 'B') return 3
  if (player.level === 'C') return 2
  return 1
}

const matchLevelValue = (player: Player) => levelValue(player)

const ageValue = (player: Player) => {
  if (player.ageGroup === '20대') return 2
  if (player.ageGroup === '30대') return 3
  if (player.ageGroup === '40대') return 4
  if (player.ageGroup === '45대') return 4.5
  if (player.ageGroup === '50대') return 5
  return 5.5
}

const teamLevel = (team: Team) =>
  team.reduce((sum, player) => sum + levelValue(player), 0)

const teamAge = (team: Team) =>
  team.reduce((sum, player) => sum + ageValue(player), 0)

const teamLevelSpread = (team: Team) =>
  Math.abs(levelValue(team[0]) - levelValue(team[1]))

const genderBalance = (team: Team) =>
  team.reduce((sum, player) => {
    if (player.gender === 'male') return sum + 1
    if (player.gender === 'female') return sum - 1
    return sum
  }, 0)

const genderCounts = (players: Player[]) => ({
  men: players.filter((player) => !player.isGuest && player.gender === 'male').length,
  women: players.filter((player) => !player.isGuest && player.gender === 'female').length,
})

const isMixedRegularTeam = (team: Team) => {
  const counts = genderCounts(team)
  return counts.men > 0 && counts.women > 0
}

const mixedDoublesPenalty = (teamA: Team, teamB: Team) => {
  const counts = genderCounts([...teamA, ...teamB])
  const canMakeTwoMixedTeams = counts.men === 2 && counts.women === 2
  if (!canMakeTwoMixedTeams) return 0

  return (
    Number(!isMixedRegularTeam(teamA)) +
    Number(!isMixedRegularTeam(teamB))
  ) * 80
}

const groupGenderMixPenalty = (players: Player[]) => {
  const counts = genderCounts(players)
  const genderedCount = counts.men + counts.women
  if (genderedCount < 3 || counts.men === 0 || counts.women === 0) {
    return genderedCount >= 3 ? 80 : 0
  }

  return Math.abs(counts.men - counts.women) * 18
}

const femaleMaleLevelPenalty = (female: Player, male: Player) => {
  const femaleLevel = matchLevelValue(female)
  const maleLevel = matchLevelValue(male)
  const preferredMaleLevel = Math.max(1, femaleLevel - 1)

  if (maleLevel === preferredMaleLevel) return 0
  if (maleLevel === femaleLevel) return 12

  return (
    40 +
    Math.abs(maleLevel - preferredMaleLevel) * 24 +
    (maleLevel > femaleLevel ? 16 : 0)
  )
}

const mixedGenderLevelPenalty = (players: Player[]) => {
  const women = players.filter((player) => !player.isGuest && player.gender === 'female')
  const men = players.filter((player) => !player.isGuest && player.gender === 'male')
  if (women.length === 0 || men.length === 0) return 0

  return women.reduce(
    (sum, woman) =>
      sum + Math.min(...men.map((man) => femaleMaleLevelPenalty(woman, man))),
    0,
  )
}

const matchPlayers = (match: Match) => [
  ...match.teamA,
  ...match.teamB,
]

const guestRepeatPartnerPenalty = (team: Team, history: HistoryState) => {
  const guests = team.filter((player) => player.isGuest)
  const regulars = team.filter((player) => !player.isGuest)
  if (guests.length === 0 || regulars.length === 0) return 0

  return guests.reduce(
    (sum, guest) =>
      sum +
      regulars.reduce(
        (regularSum, regular) =>
          regularSum +
          (history.partners[pairKey(guest.id, regular.id)] ?? 0) *
            GUEST_REPEAT_PARTNER_PENALTY,
        0,
      ),
    0,
  )
}

const scorePairing = (
  teamA: Team,
  teamB: Team,
  history: HistoryState,
  random: () => number,
) => {
  const partnerPenalty =
    (history.partners[pairKey(teamA[0].id, teamA[1].id)] ?? 0) * 16 +
    (history.partners[pairKey(teamB[0].id, teamB[1].id)] ?? 0) * 16
  let opponentPenalty = 0
  for (const left of teamA) {
    for (const right of teamB) {
      opponentPenalty += (history.opponents[pairKey(left.id, right.id)] ?? 0) * 8
    }
  }

  const levelPenalty = Math.abs(teamLevel(teamA) - teamLevel(teamB)) * 7
  const agePenalty = Math.abs(teamAge(teamA) - teamAge(teamB)) * 1.5
  const genderPenalty = Math.abs(genderBalance(teamA) - genderBalance(teamB)) * 6
  const mixedPairPenalty =
    mixedGenderLevelPenalty(teamA) + mixedGenderLevelPenalty(teamB)
  const teamShapePenalty =
    Math.abs(teamLevelSpread(teamA) - teamLevelSpread(teamB)) * 3
  const guestPenalty =
    Math.abs(teamA.filter((player) => player.isGuest).length - teamB.filter((player) => player.isGuest).length) *
    12
  const guestPartnerPenalty =
    guestRepeatPartnerPenalty(teamA, history) +
    guestRepeatPartnerPenalty(teamB, history)

  return (
    levelPenalty +
    agePenalty +
    genderPenalty +
    mixedPairPenalty +
    mixedDoublesPenalty(teamA, teamB) +
    teamShapePenalty +
    partnerPenalty +
    opponentPenalty +
    guestPenalty +
    guestPartnerPenalty +
    random()
  )
}

const bestPairing = (
  players: [Player, Player, Player, Player],
  history: HistoryState,
  random: () => number,
): Pairing => {
  const options: Array<[Team, Team]> = [
    [
      [players[0], players[1]],
      [players[2], players[3]],
    ],
    [
      [players[0], players[2]],
      [players[1], players[3]],
    ],
    [
      [players[0], players[3]],
      [players[1], players[2]],
    ],
  ]

  return options
    .map(([teamA, teamB]) => ({
      teamA,
      teamB,
      score: scorePairing(teamA, teamB, history, random),
    }))
    .sort((a, b) => a.score - b.score)[0]
}

const createMatch = (
  round: number,
  court: number,
  players: [Player, Player, Player, Player],
  history: HistoryState,
  random: () => number,
  isSpecial: boolean,
): Match => {
  const pairing = bestPairing(players, history, random)
  return {
    id: `r${round}-c${court}-${players.map((player) => player.id).join('-')}`,
    round,
    court,
    teamA: pairing.teamA,
    teamB: pairing.teamB,
    isSpecial,
  }
}

const updateHistoryForMatch = (history: HistoryState, match: Match) => {
  const players = matchPlayers(match)
  const guestInMatch = hasGuest(players)

  for (const player of players) {
    history.games[player.id] = (history.games[player.id] ?? 0) + 1
    history.restStreaks[player.id] = 0
    history.playStreaks[player.id] = (history.playStreaks[player.id] ?? 0) + 1
    if (player.isGuest) {
      history.guestGameCounts[player.id] = (history.guestGameCounts[player.id] ?? 0) + 1
    } else if (guestInMatch) {
      history.specialCompleted.add(player.id)
      history.specialGameCounts[player.id] =
        (history.specialGameCounts[player.id] ?? 0) + 1
    }
  }

  history.partners[pairKey(match.teamA[0].id, match.teamA[1].id)] =
    (history.partners[pairKey(match.teamA[0].id, match.teamA[1].id)] ?? 0) + 1
  history.partners[pairKey(match.teamB[0].id, match.teamB[1].id)] =
    (history.partners[pairKey(match.teamB[0].id, match.teamB[1].id)] ?? 0) + 1

  for (const left of match.teamA) {
    for (const right of match.teamB) {
      history.opponents[pairKey(left.id, right.id)] =
        (history.opponents[pairKey(left.id, right.id)] ?? 0) + 1
    }
  }
}

const updateHistoryForRests = (
  history: HistoryState,
  activePlayers: Player[],
  usedIds: Set<string>,
) => {
  for (const player of activePlayers) {
    if (!usedIds.has(player.id)) {
      history.rests[player.id] = (history.rests[player.id] ?? 0) + 1
      history.restStreaks[player.id] = (history.restStreaks[player.id] ?? 0) + 1
      history.playStreaks[player.id] = 0
    }
  }
}

const consecutivePlayPenalty = (player: Player, history: HistoryState) => {
  const streak = history.playStreaks[player.id] ?? 0
  if (streak <= 0) return 0
  if (streak === 1) return 90
  if (streak === 2) return 320
  return 780 + (streak - 3) * 360
}

const groupConsecutivePlayPenalty = (players: Player[], history: HistoryState) =>
  players.reduce(
    (sum, player) => sum + consecutivePlayPenalty(player, history),
    0,
  )

const playerPriority = (player: Player, history: HistoryState, random: () => number) =>
  (history.games[player.id] ?? 0) * 24 -
  (history.restStreaks[player.id] ?? 0) * 18 -
  (history.rests[player.id] ?? 0) * 4 +
  consecutivePlayPenalty(player, history) +
  levelValue(player) * 0.35 +
  random()

const uniquePlayers = (players: Player[]) =>
  Array.from(new Map(players.map((player) => [player.id, player])).values())

const guestPriority = (guest: Player, history: HistoryState, random: () => number) =>
  (history.guestGameCounts[guest.id] ?? 0) * 100 +
  (history.games[guest.id] ?? 0) * 10 +
  random()

const isValidGuestGroup = (
  group: [Player, Player, Player, Player],
  singleGuestPerMatch: boolean,
) => {
  const guestCount = group.filter((player) => player.isGuest).length
  if (guestCount === 0) return true
  if (guestCount === group.length) return false
  if (singleGuestPerMatch) return guestCount === 1
  return true
}

const scoreSpecialRegulars = (
  guest: Player,
  regulars: [Player, Player, Player],
  pendingIds: Set<string>,
  hasPending: boolean,
  history: HistoryState,
  random: () => number,
) => {
  const targetLevel = matchLevelValue(guest)
  const levels = regulars.map((player) => matchLevelValue(player))
  const pendingCount = regulars.filter((player) => pendingIds.has(player.id)).length
  const levelPenalty = regulars.reduce(
    (sum, player) => sum + Math.abs(matchLevelValue(player) - targetLevel) * 36,
    0,
  )
  const levelSpread = Math.max(...levels) - Math.min(...levels)
  const specialCounts = regulars.map((player) => specialGameCount(player, history))
  const historyPenalty = regulars.reduce(
    (sum, player) =>
      sum +
      (history.games[player.id] ?? 0) * 8 -
      (history.restStreaks[player.id] ?? 0) * 9 -
      (history.rests[player.id] ?? 0) * 3,
    0,
  )
  const pendingPenalty = hasPending ? (3 - pendingCount) * 90 : 0
  const repeatGuestPenalty = hasPending
    ? specialCounts.reduce((sum, count) => sum + count, 0) * 4
    : specialCounts.reduce((sum, count) => sum + count, 0) * 80 +
      Math.max(...specialCounts) * 36

  return (
    levelPenalty +
    levelSpread * 10 +
    mixedGenderLevelPenalty(regulars) * 4 +
    groupGenderMixPenalty(regulars) +
    historyPenalty +
    pendingPenalty +
    repeatGuestPenalty +
    groupConsecutivePlayPenalty(regulars, history) +
    random()
  )
}

const pickSpecialRegulars = (
  guest: Player,
  activePlayers: Player[],
  usedIds: Set<string>,
  pending: Player[],
  history: HistoryState,
  random: () => number,
): [Player, Player, Player] | null => {
  const availableRegulars = activePlayers.filter(
    (player) => !player.isGuest && !usedIds.has(player.id),
  )
  if (availableRegulars.length < 3) return null

  const pendingIds = new Set(pending.map((player) => player.id))
  const hasPending = pending.length > 0
  const targetLevel = matchLevelValue(guest)
  const levelFit = [...availableRegulars]
    .sort((a, b) => {
      if (!hasPending) {
        const specialGameDiff =
          specialGameCount(a, history) - specialGameCount(b, history)
        if (specialGameDiff !== 0) return specialGameDiff
      }
      const levelDiff =
        Math.abs(matchLevelValue(a) - targetLevel) -
        Math.abs(matchLevelValue(b) - targetLevel)
      if (levelDiff !== 0) return levelDiff
      return playerPriority(a, history, random) - playerPriority(b, history, random)
    })
    .slice(0, 18)
  const preferredMenForWomen = pending
    .filter((player) => player.gender === 'female')
    .flatMap((woman) =>
      availableRegulars
        .filter((player) => player.gender === 'male')
        .sort(
          (a, b) =>
            femaleMaleLevelPenalty(woman, a) - femaleMaleLevelPenalty(woman, b),
        )
        .slice(0, 6),
    )
  const candidatePool = uniquePlayers([
    ...pending.slice(0, 18),
    ...preferredMenForWomen,
    ...levelFit,
  ]).slice(0, 26)

  let bestGroup: [Player, Player, Player] | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (let a = 0; a < candidatePool.length - 2; a += 1) {
    for (let b = a + 1; b < candidatePool.length - 1; b += 1) {
      for (let c = b + 1; c < candidatePool.length; c += 1) {
        const regulars: [Player, Player, Player] = [
          candidatePool[a],
          candidatePool[b],
          candidatePool[c],
        ]
        if (hasPending && !regulars.some((player) => pendingIds.has(player.id))) {
          continue
        }

        const score = scoreSpecialRegulars(
          guest,
          regulars,
          pendingIds,
          hasPending,
          history,
          random,
        )
        if (score < bestScore) {
          bestScore = score
          bestGroup = regulars
        }
      }
    }
  }

  return bestGroup
}

const pickSingleGuestSpecialGroup = (
  activePlayers: Player[],
  usedIds: Set<string>,
  history: HistoryState,
  random: () => number,
  allowExtraSpecial: boolean,
): [Player, Player, Player, Player] | null => {
  const candidateGuests = activePlayers.filter(
    (player) => player.isGuest && !usedIds.has(player.id),
  )
  if (candidateGuests.length === 0) return null

  const pending = activePlayers
    .filter(
      (player) =>
        !player.isGuest &&
        !history.specialCompleted.has(player.id) &&
        !usedIds.has(player.id),
    )
    .sort((a, b) => playerPriority(a, history, random) - playerPriority(b, history, random))

  const needsGuestFirstMatch = candidateGuests.some(
    (guest) => (history.guestGameCounts[guest.id] ?? 0) === 0,
  )
  const isExtraSpecialMatch = pending.length === 0 && !needsGuestFirstMatch
  if (isExtraSpecialMatch && !allowExtraSpecial) return null

  const guests = (isExtraSpecialMatch
    ? candidateGuests.filter((guest) => guestHasRemainingExtraGames(guest, history))
    : candidateGuests
  ).sort((a, b) => guestPriority(a, history, random) - guestPriority(b, history, random))

  if (guests.length === 0) return null

  for (const guest of guests) {
    const selectedPlayers = pickSpecialRegulars(
      guest,
      activePlayers,
      usedIds,
      pending,
      history,
      random,
    )
    if (selectedPlayers) return [guest, ...selectedPlayers]
  }

  return null
}

const scoreAdaptiveSpecialGroup = (
  group: [Player, Player, Player, Player],
  pendingIds: Set<string>,
  hasPending: boolean,
  history: HistoryState,
  random: () => number,
) => {
  const pairing = bestPairing(group, history, random)
  const guests = group.filter((player) => player.isGuest)
  const regulars = group.filter((player) => !player.isGuest)
  const averageGuestLevel =
    guests.reduce((sum, guest) => sum + matchLevelValue(guest), 0) / guests.length
  const levels = group.map((player) => matchLevelValue(player))
  const pendingCount = regulars.filter((player) => pendingIds.has(player.id)).length
  const expectedPendingCount = hasPending
    ? Math.min(regulars.length, Math.max(1, pendingIds.size))
    : 0
  const firstGuestCount = guests.filter(
    (guest) => (history.guestGameCounts[guest.id] ?? 0) === 0,
  ).length
  const regularLevelPenalty = regulars.reduce(
    (sum, player) => sum + Math.abs(matchLevelValue(player) - averageGuestLevel) * 24,
    0,
  )
  const specialCounts = regulars.map((player) => specialGameCount(player, history))
  const historyPenalty = group.reduce(
    (sum, player) =>
      sum +
      (history.games[player.id] ?? 0) * 7 -
      (history.restStreaks[player.id] ?? 0) * 8 -
      (history.rests[player.id] ?? 0) * 2,
    0,
  )
  const repeatGuestPenalty = hasPending
    ? specialCounts.reduce((sum, count) => sum + count, 0) * 4
    : specialCounts.reduce((sum, count) => sum + count, 0) * 72 +
      Math.max(...specialCounts) * 32

  return (
    pairing.score +
    regularLevelPenalty +
    (Math.max(...levels) - Math.min(...levels)) * 6 +
    mixedGenderLevelPenalty(regulars) * 4 +
    groupGenderMixPenalty(regulars) +
    historyPenalty +
    (expectedPendingCount - pendingCount) * 110 -
    firstGuestCount * 40 +
    repeatGuestPenalty +
    groupConsecutivePlayPenalty(group, history) +
    Math.max(0, guests.length - 1) * 14 +
    random()
  )
}

const pickAdaptiveSpecialGroup = (
  activePlayers: Player[],
  usedIds: Set<string>,
  history: HistoryState,
  random: () => number,
  allowExtraSpecial: boolean,
): [Player, Player, Player, Player] | null => {
  const candidateGuests = activePlayers.filter(
    (player) => player.isGuest && !usedIds.has(player.id),
  )
  if (candidateGuests.length === 0) return null

  const pending = activePlayers
    .filter(
      (player) =>
        !player.isGuest &&
        !history.specialCompleted.has(player.id) &&
        !usedIds.has(player.id),
    )
    .sort((a, b) => playerPriority(a, history, random) - playerPriority(b, history, random))
  const needsGuestFirstMatch = candidateGuests.some(
    (guest) => (history.guestGameCounts[guest.id] ?? 0) === 0,
  )
  const isExtraSpecialMatch = pending.length === 0 && !needsGuestFirstMatch
  if (isExtraSpecialMatch && !allowExtraSpecial) return null

  const guests = (isExtraSpecialMatch
    ? candidateGuests.filter((guest) => guestHasRemainingExtraGames(guest, history))
    : candidateGuests
  ).sort((a, b) => guestPriority(a, history, random) - guestPriority(b, history, random))

  if (guests.length === 0) return null

  const availableRegulars = activePlayers.filter(
    (player) => !player.isGuest && !usedIds.has(player.id),
  )
  if (availableRegulars.length === 0) return null

  const pendingIds = new Set(pending.map((player) => player.id))
  const hasPending = pending.length > 0
  const targetLevel =
    guests.reduce((sum, guest) => sum + matchLevelValue(guest), 0) / guests.length
  const levelFit = [...availableRegulars]
    .sort((a, b) => {
      if (!hasPending) {
        const specialGameDiff =
          specialGameCount(a, history) - specialGameCount(b, history)
        if (specialGameDiff !== 0) return specialGameDiff
      }
      const levelDiff =
        Math.abs(matchLevelValue(a) - targetLevel) -
        Math.abs(matchLevelValue(b) - targetLevel)
      if (levelDiff !== 0) return levelDiff
      return playerPriority(a, history, random) - playerPriority(b, history, random)
    })
    .slice(0, 18)
  const preferredMenForWomen = pending
    .filter((player) => player.gender === 'female')
    .flatMap((woman) =>
      availableRegulars
        .filter((player) => player.gender === 'male')
        .sort(
          (a, b) =>
            femaleMaleLevelPenalty(woman, a) - femaleMaleLevelPenalty(woman, b),
        )
        .slice(0, 6),
    )
  const candidatePool = uniquePlayers([
    ...guests,
    ...pending.slice(0, 18),
    ...preferredMenForWomen,
    ...levelFit,
  ]).slice(0, 28)

  if (candidatePool.length < 4) return null

  let bestGroup: [Player, Player, Player, Player] | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (let a = 0; a < candidatePool.length - 3; a += 1) {
    for (let b = a + 1; b < candidatePool.length - 2; b += 1) {
      for (let c = b + 1; c < candidatePool.length - 1; c += 1) {
        for (let d = c + 1; d < candidatePool.length; d += 1) {
          const group: [Player, Player, Player, Player] = [
            candidatePool[a],
            candidatePool[b],
            candidatePool[c],
            candidatePool[d],
          ]
          const guestsInGroup = group.filter((player) => player.isGuest)
          const regularsInGroup = group.filter((player) => !player.isGuest)
          if (guestsInGroup.length === 0 || regularsInGroup.length === 0) continue
          if (hasPending && !regularsInGroup.some((player) => pendingIds.has(player.id))) {
            continue
          }
          if (
            !hasPending &&
            needsGuestFirstMatch &&
            !guestsInGroup.some((guest) => (history.guestGameCounts[guest.id] ?? 0) === 0)
          ) {
            continue
          }

          const score = scoreAdaptiveSpecialGroup(
            group,
            pendingIds,
            hasPending,
            history,
            random,
          )
          if (score < bestScore) {
            bestScore = score
            bestGroup = group
          }
        }
      }
    }
  }

  return bestGroup
}

const pickSpecialGroup = (
  activePlayers: Player[],
  usedIds: Set<string>,
  history: HistoryState,
  random: () => number,
  settings: MatchSettings,
  allowExtraSpecial: boolean,
): [Player, Player, Player, Player] | null => {
  if (settings.singleGuestPerMatch) {
    return pickSingleGuestSpecialGroup(
      activePlayers,
      usedIds,
      history,
      random,
      allowExtraSpecial,
    )
  }

  return pickAdaptiveSpecialGroup(
    activePlayers,
    usedIds,
    history,
    random,
    allowExtraSpecial,
  )
}

const scoreGroup = (
  group: [Player, Player, Player, Player],
  history: HistoryState,
  random: () => number,
) => {
  const pairing = bestPairing(group, history, random)
  const gameCounts = group.map((player) => history.games[player.id] ?? 0)
  const restStreaks = group.map((player) => history.restStreaks[player.id] ?? 0)
  const levelSpread =
    Math.max(...group.map((player) => levelValue(player))) -
    Math.min(...group.map((player) => levelValue(player)))
  const guestCount = group.filter((player) => player.isGuest).length

  return (
    pairing.score +
    Math.max(...gameCounts) * 3 +
    levelSpread * 4 -
    restStreaks.reduce((sum, streak) => sum + streak, 0) * 8 +
    groupGenderMixPenalty(group) +
    groupConsecutivePlayPenalty(group, history) +
    Math.max(0, guestCount - 1) * 50 +
    random()
  )
}

const pickGeneralGroup = (
  activePlayers: Player[],
  usedIds: Set<string>,
  history: HistoryState,
  random: () => number,
  settings: MatchSettings,
): [Player, Player, Player, Player] | null => {
  const candidates = activePlayers
    .filter((player) => {
      if (usedIds.has(player.id)) return false
      return !player.isGuest
    })
    .sort((a, b) => playerPriority(a, history, random) - playerPriority(b, history, random))
    .slice(0, 18)

  if (candidates.length < 4) return null

  let bestGroup: [Player, Player, Player, Player] | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (let a = 0; a < candidates.length - 3; a += 1) {
    for (let b = a + 1; b < candidates.length - 2; b += 1) {
      for (let c = b + 1; c < candidates.length - 1; c += 1) {
        for (let d = c + 1; d < candidates.length; d += 1) {
          const group: [Player, Player, Player, Player] = [
            candidates[a],
            candidates[b],
            candidates[c],
            candidates[d],
          ]
          if (!isValidGuestGroup(group, settings.singleGuestPerMatch)) continue

          const score = scoreGroup(group, history, random)
          if (score < bestScore) {
            bestScore = score
            bestGroup = group
          }
        }
      }
    }
  }

  return bestGroup
}

export const generateSchedule = (
  players: Player[],
  settings: MatchSettings,
): Schedule => {
  const activePlayers = players.filter((player) => player.active && player.name.trim())
  const activeRegulars = activePlayers.filter((player) => !player.isGuest)
  const activeGuests = activePlayers.filter((player) => player.isGuest)
  const history = makeHistory(activePlayers)
  const rounds: Round[] = []
  const warnings: string[] = []
  const random = makeRandom(settings.seed)

  if (activePlayers.length < 4) {
    return {
      rounds: [],
      warnings: ['참가자가 4명 이상이어야 대진을 만들 수 있습니다.'],
      specialCompletedIds: [],
      guestGameCounts: history.guestGameCounts,
    }
  }
  if (activeGuests.length > 0 && settings.singleGuestPerMatch && activeRegulars.length < 3) {
    return {
      rounds: [],
      warnings: ['스페셜 1명 옵션에서는 일반 참가자가 3명 이상 필요합니다.'],
      specialCompletedIds: [],
      guestGameCounts: history.guestGameCounts,
    }
  }

  const targetRoundCount = normalizeTargetRoundCount(settings.targetRoundCount)
  const requiredCompletionRoundLimit = activePlayers.length * 2 + activeGuests.length + 4
  const maxAutoRounds = Math.max(targetRoundCount, requiredCompletionRoundLimit)
  let stalledRounds = 0

  for (let roundNumber = 1; roundNumber <= maxAutoRounds; roundNumber += 1) {
    const usedIds = new Set<string>()
    const matches: Match[] = []
    const completedBeforeRound = history.specialCompleted.size
    const allowExtraSpecial = roundNumber <= targetRoundCount

    const courtLimit = Math.min(settings.courtCount, Math.floor(activePlayers.length / 4))

    for (let court = 1; court <= courtLimit; court += 1) {
      const group = pickSpecialGroup(
        activePlayers,
        usedIds,
        history,
        random,
        settings,
        allowExtraSpecial,
      )
      if (!group) break

      const match = createMatch(roundNumber, court, group, history, random, true)
      matches.push(match)
      for (const player of group) usedIds.add(player.id)
      updateHistoryForMatch(history, match)
    }

    for (let court = matches.length + 1; court <= courtLimit; court += 1) {
      const group = pickGeneralGroup(activePlayers, usedIds, history, random, settings)
      if (!group) break

      const match = createMatch(roundNumber, court, group, history, random, hasGuest(group))
      matches.push(match)
      for (const player of group) usedIds.add(player.id)
      updateHistoryForMatch(history, match)
    }

    if (matches.length === 0) break

    updateHistoryForRests(history, activePlayers, usedIds)
    rounds.push({
      id: `round-${roundNumber}`,
      number: roundNumber,
      matches,
      resting: activePlayers.filter((player) => !usedIds.has(player.id)),
    })

    const allRegularsCompleted = activeRegulars.every((player) =>
      history.specialCompleted.has(player.id),
    )
    const allGuestsPlayed = activeGuests.every(
      (guest) => (history.guestGameCounts[guest.id] ?? 0) > 0,
    )
    const reachedTargetRounds = roundNumber >= targetRoundCount
    const completedMinimumSpecial =
      activeGuests.length === 0 || (allRegularsCompleted && allGuestsPlayed)
    if (reachedTargetRounds && completedMinimumSpecial) break

    if (
      !completedMinimumSpecial &&
      history.specialCompleted.size === completedBeforeRound
    ) {
      stalledRounds += 1
      if (stalledRounds >= 2) break
    } else {
      stalledRounds = 0
    }
  }

  const pendingSpecial =
    activeGuests.length > 0
      ? activePlayers.filter(
          (player) =>
            !player.isGuest &&
            !history.specialCompleted.has(player.id),
        )
      : []
  if (pendingSpecial.length > 0) {
    warnings.push(
      `스페셜 경기 미완료: ${pendingSpecial.map((player) => player.name).join(', ')}`,
    )
  }
  const unplayedGuests = activePlayers.filter(
    (player) => player.isGuest && (history.guestGameCounts[player.id] ?? 0) === 0,
  )
  if (unplayedGuests.length > 0) {
    warnings.push(
      `스페셜 경기 미배정: ${unplayedGuests.map((player) => player.name).join(', ')}`,
    )
  }

  return {
    rounds,
    warnings,
    specialCompletedIds: Array.from(history.specialCompleted),
    guestGameCounts: history.guestGameCounts,
  }
}

const numericScore = (score: string) => {
  if (score.trim() === '') return null
  const parsed = Number(score)
  return Number.isFinite(parsed) ? parsed : null
}

export const calculateStats = (
  players: Player[],
  schedule: Schedule,
  results: ResultsByMatch,
  matchNameOverrides: MatchNameOverrides = {},
): PlayerStat[] => {
  const stats = new Map<string, PlayerStat>()

  const makeManualPlayer = (match: Match, player: Player): Player => {
    const overrideName = matchNameOverrides[match.id]?.[player.id]?.trim()
    if (!overrideName) return player

    return {
      ...player,
      id: `manual:${overrideName}`,
      name: overrideName,
    }
  }

  const matchStatPlayers = (match: Match) =>
    matchPlayers(match).map((player) => makeManualPlayer(match, player))

  const replacedPlayersForRound = (round: Round) =>
    round.matches.flatMap((match) =>
      matchPlayers(match).filter((player) =>
        Boolean(matchNameOverrides[match.id]?.[player.id]?.trim()),
      ),
    )

  const ensureStat = (player: Player) => {
    const existing = stats.get(player.id)
    if (existing) return existing

    const next: PlayerStat = {
      player,
      games: 0,
      rests: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      specialDone: schedule.specialCompletedIds.includes(player.id),
      guestGames: 0,
    }
    stats.set(player.id, next)
    return next
  }

  for (const player of players.filter((item) => item.active && item.name.trim())) {
    ensureStat(player)
  }

  for (const round of schedule.rounds) {
    const restingPlayers = uniquePlayers([
      ...round.resting,
      ...replacedPlayersForRound(round),
    ])

    for (const player of restingPlayers) {
      const stat = stats.get(player.id)
      if (stat) stat.rests += 1
    }

    for (const match of round.matches) {
      const result = results[match.id]
      const teamAScore = result ? numericScore(result.teamAScore) : null
      const teamBScore = result ? numericScore(result.teamBScore) : null
      const completed =
        Boolean(result?.completed) &&
        teamAScore !== null &&
        teamBScore !== null &&
        teamAScore !== teamBScore
      const playersInMatch = matchStatPlayers(match)
      const [teamA0, teamA1, teamB0, teamB1] = playersInMatch
      const teamA: Team = [teamA0, teamA1]
      const teamB: Team = [teamB0, teamB1]
      const guestMatch = hasGuest(playersInMatch)

      for (const player of playersInMatch) {
        const stat = ensureStat(player)
        stat.games += 1
        if (!player.isGuest && guestMatch) stat.guestGames += 1
      }

      if (!completed || teamAScore === null || teamBScore === null) continue

      const teamAWon = teamAScore > teamBScore
      for (const player of teamA) {
        const stat = ensureStat(player)
        stat.pointsFor += teamAScore
        stat.pointsAgainst += teamBScore
        if (teamAWon) stat.wins += 1
        else stat.losses += 1
      }
      for (const player of teamB) {
        const stat = ensureStat(player)
        stat.pointsFor += teamBScore
        stat.pointsAgainst += teamAScore
        if (teamAWon) stat.losses += 1
        else stat.wins += 1
      }
    }
  }

  return Array.from(stats.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    const pointDiff = b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst)
    if (pointDiff !== 0) return pointDiff
    return a.player.name.localeCompare(b.player.name)
  })
}
