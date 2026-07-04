import type {
  Gender,
  Level,
  Match,
  MatchConditionOptions,
  MatchNameOverrides,
  MatchSettings,
  Player,
  PlayerStat,
  ResultsByMatch,
  Round,
  Schedule,
  Team,
  TournamentGroup,
  TournamentLineup,
  TournamentLineupsByMatch,
  TournamentMatch,
  TournamentParticipant,
  TournamentResultsByMatch,
  TournamentSchedule,
  TournamentSettings,
  TournamentStanding,
  TournamentTeam,
  TournamentTeamBattleStanding,
  TournamentTeamBattleTie,
} from './types'
import { defaultMatchConditionOptions } from './defaultData'

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

type TournamentParticipantWithTeam = TournamentParticipant & {
  teamId: string
  teamName: string
}

type TournamentTeamDraft = {
  index: number
  members: Player[]
}

type RoundPacing = {
  roundNumber: number
  targetRoundCount: number
}

const DEFAULT_TARGET_ROUND_COUNT = 8
const GUEST_REPEAT_PARTNER_PENALTY = 50000
const SPECIAL_TIMING_WEIGHT = 110

const matchConditions = (settings: MatchSettings): MatchConditionOptions => ({
  ...defaultMatchConditionOptions,
  ...(settings.conditionOptions ?? {}),
})

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

const ageGroups = ['20대', '30대', '40대', '45대', '50대', '55대이상'] as const

const maleMatchScores = {
  A: [100, 96, 88, 84, 78, 72],
  B: [90, 86, 82, 78, 72, 68],
  C: [70, 66, 60, 56, 50, 46],
} as const

const femaleMatchScores = {
  A: [82, 78, 72, 68, 62, 58],
  B: [72, 68, 62, 58, 52, 48],
  C: [54, 50, 44, 40, 36, 32],
} as const

const dMatchScores = [26, 23, 20, 18, 15, 12] as const

const ageIndex = (player: Player) =>
  player.ageGroup === '무관'
    ? 1
    : Math.max(0, ageGroups.indexOf(player.ageGroup))

export const getPlayerMatchScore = (player: Player) => {
  const index = ageIndex(player)
  if (player.level === '스페셜') return 108
  if (player.level === 'OA' || player.level === 'O') return 94
  if (player.level === 'D') return dMatchScores[index]

  const maleScore = maleMatchScores[player.level][index]
  const femaleScore = femaleMatchScores[player.level][index]
  if (player.gender === 'male') return maleScore
  if (player.gender === 'female') return femaleScore
  return Math.round((maleScore + femaleScore) / 2)
}

const tournamentParticipantAsPlayer = (
  participant: TournamentParticipant,
): Player => ({
  id: participant.id,
  name: participant.name,
  level: participant.level,
  ageGroup: participant.ageGroup,
  gender: participant.gender,
  active: true,
  specialRequired: false,
  isGuest: false,
  guestGameLimit: 0,
})

const tournamentParticipantScore = (participant: TournamentParticipant) =>
  getPlayerMatchScore(tournamentParticipantAsPlayer(participant))

const tournamentPlayerName = (player: Player, index: number) =>
  player.name.trim() || `${index + 1}번`

const playerAsTournamentParticipant = (
  player: Player,
  index: number,
): TournamentParticipant => ({
  id: player.id,
  name: tournamentPlayerName(player, index),
  level: player.level === '스페셜' ? 'OA' : player.level,
  ageGroup: player.ageGroup,
  gender: player.isGuest ? 'none' : player.gender,
})

const scoreTournamentDraft = (draft: TournamentTeamDraft) =>
  draft.members.reduce((sum, player) => sum + getPlayerMatchScore(player), 0)

const draftGenderBalance = (draft: TournamentTeamDraft) =>
  draft.members.reduce((sum, player) => {
    if (player.gender === 'male') return sum + 1
    if (player.gender === 'female') return sum - 1
    return sum
  }, 0)

const balancedTournamentDraftScore = (drafts: TournamentTeamDraft[]) => {
  const scores = drafts.map(scoreTournamentDraft)
  const sizes = drafts.map((draft) => draft.members.length)
  const genderValues = drafts.map(draftGenderBalance)
  const scoreSpread = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0
  const sizeSpread = sizes.length > 1 ? Math.max(...sizes) - Math.min(...sizes) : 0
  const genderSpread =
    genderValues.length > 1 ? Math.max(...genderValues) - Math.min(...genderValues) : 0

  return scoreSpread * 18 + sizeSpread * 700 + genderSpread * 28
}

const levelSortValue: Record<Level, number> = {
  스페셜: 0,
  OA: 1,
  A: 2,
  B: 3,
  C: 4,
  D: 5,
  O: 6,
}

const representativeTournamentLevel = (members: Player[]): Level => {
  if (members.length === 0) return 'B'

  const counts = new Map<Level, number>()
  for (const member of members) {
    const level = member.level === '스페셜' ? 'OA' : member.level
    counts.set(level, (counts.get(level) ?? 0) + 1)
  }

  return [...counts.entries()].sort((a, b) => {
    const countDiff = b[1] - a[1]
    if (countDiff !== 0) return countDiff
    return levelSortValue[a[0]] - levelSortValue[b[0]]
  })[0][0]
}

const representativeTournamentGender = (members: Player[]): Gender => {
  const genders = new Set(
    members
      .map((member) => (member.isGuest ? 'none' : member.gender))
      .filter((gender) => gender !== 'none'),
  )
  if (genders.size !== 1) return 'none'
  return [...genders][0] as Gender
}

export const generateBalancedTournamentTeams = (
  players: Player[],
  requestedTeamCount: number,
) => {
  const warnings: string[] = []
  const activePlayers = players
    .filter((player) => player.active && !player.isGuest)
    .map((player, index) => ({
      ...player,
      name: tournamentPlayerName(player, index),
      isGuest: false,
      level: player.level === '스페셜' ? 'OA' : player.level,
      gender: player.isGuest ? 'none' : player.gender,
    }))

  if (activePlayers.length === 0) {
    return {
      teams: [] as TournamentTeam[],
      warnings: ['편성할 참가자가 없습니다.'],
    }
  }

  const numericTeamCount = Number(requestedTeamCount)
  const normalizedTeamCount = Number.isFinite(numericTeamCount)
    ? Math.max(1, Math.floor(numericTeamCount))
    : 2
  const teamCount = Math.min(normalizedTeamCount, activePlayers.length)

  if (teamCount !== normalizedTeamCount) {
    warnings.push(`참가자 수 기준 ${teamCount}팀으로 편성되었습니다.`)
  }

  if (teamCount < 2) {
    warnings.push('단체전 대진은 2팀 이상 필요합니다.')
  }

  const totalScore = activePlayers.reduce(
    (sum, player) => sum + getPlayerMatchScore(player),
    0,
  )
  const totalGenderBalance = activePlayers.reduce((sum, player) => {
    if (player.gender === 'male') return sum + 1
    if (player.gender === 'female') return sum - 1
    return sum
  }, 0)
  const targetScore = totalScore / teamCount
  const targetSize = activePlayers.length / teamCount
  const targetGenderBalance = totalGenderBalance / teamCount
  const maxTeamSize = Math.ceil(targetSize)
  const drafts: TournamentTeamDraft[] = Array.from({ length: teamCount }, (_, index) => ({
    index,
    members: [],
  }))
  const sortedPlayers = [...activePlayers].sort((a, b) => {
    const scoreDiff = getPlayerMatchScore(b) - getPlayerMatchScore(a)
    if (scoreDiff !== 0) return scoreDiff
    const genderDiff = a.gender.localeCompare(b.gender)
    if (genderDiff !== 0) return genderDiff
    return a.name.localeCompare(b.name)
  })

  for (const player of sortedPlayers) {
    const playerScore = getPlayerMatchScore(player)
    const genderValue = player.gender === 'male' ? 1 : player.gender === 'female' ? -1 : 0
    const candidates = drafts.filter((draft) => draft.members.length < maxTeamSize)

    const targetDraft = candidates
      .map((draft) => {
        const nextScore = scoreTournamentDraft(draft) + playerScore
        const nextSize = draft.members.length + 1
        const nextGenderBalance = draftGenderBalance(draft) + genderValue
        return {
          draft,
          score:
            Math.abs(nextScore - targetScore) * 10 +
            Math.abs(nextSize - targetSize) * 120 +
            Math.abs(nextGenderBalance - targetGenderBalance) * 16 +
            draft.members.length * 2,
        }
      })
      .sort((a, b) => {
        const scoreDiff = a.score - b.score
        if (scoreDiff !== 0) return scoreDiff
        const sizeDiff = a.draft.members.length - b.draft.members.length
        if (sizeDiff !== 0) return sizeDiff
        return a.draft.index - b.draft.index
      })[0].draft

    targetDraft.members.push(player)
  }

  let improved = true
  for (let pass = 0; pass < 40 && improved; pass += 1) {
    improved = false
    const currentScore = balancedTournamentDraftScore(drafts)

    for (let leftIndex = 0; leftIndex < drafts.length - 1; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < drafts.length; rightIndex += 1) {
        const left = drafts[leftIndex]
        const right = drafts[rightIndex]

        for (let leftMemberIndex = 0; leftMemberIndex < left.members.length; leftMemberIndex += 1) {
          for (let rightMemberIndex = 0; rightMemberIndex < right.members.length; rightMemberIndex += 1) {
            const leftMember = left.members[leftMemberIndex]
            const rightMember = right.members[rightMemberIndex]

            left.members[leftMemberIndex] = rightMember
            right.members[rightMemberIndex] = leftMember
            const nextScore = balancedTournamentDraftScore(drafts)

            if (nextScore + 0.0001 < currentScore) {
              improved = true
              break
            }

            left.members[leftMemberIndex] = leftMember
            right.members[rightMemberIndex] = rightMember
          }
          if (improved) break
        }
        if (improved) break
      }
      if (improved) break
    }
  }

  const teams = drafts.map<TournamentTeam>((draft) => {
    const members = draft.members.map(playerAsTournamentParticipant)
    return {
      id: `auto-team-${draft.index + 1}`,
      name: `${draft.index + 1}팀`,
      playerNames: members.map((member) => member.name).join(', '),
      level: representativeTournamentLevel(draft.members),
      gender: representativeTournamentGender(draft.members),
      seed: null,
      active: true,
      members,
    }
  })

  return { teams, warnings }
}

const isOpenLevel = (player: Player) => player.level === 'O'

const matchLevelValue = (player: Player) => getPlayerMatchScore(player)

const scoreDistanceToTarget = (player: Player, target: number) =>
  isOpenLevel(player) ? 0 : Math.abs(matchLevelValue(player) - target)

const scoreDistanceBetweenPlayers = (left: Player, right: Player) =>
  isOpenLevel(left) || isOpenLevel(right)
    ? 0
    : Math.abs(matchLevelValue(left) - matchLevelValue(right))

const ageValue = (player: Player) => {
  if (player.ageGroup === '무관') return 3.75
  if (player.ageGroup === '20대') return 2
  if (player.ageGroup === '30대') return 3
  if (player.ageGroup === '40대') return 4
  if (player.ageGroup === '45대') return 4.5
  if (player.ageGroup === '50대') return 5
  return 5.5
}

const teamComparableValue = (
  team: Team,
  valueForPlayer: (player: Player) => number,
) => {
  const fixedPlayers = team.filter((player) => !isOpenLevel(player))
  const fixedValues = fixedPlayers.map(valueForPlayer)
  const fallback =
    fixedValues.length > 0
      ? fixedValues.reduce((sum, value) => sum + value, 0) / fixedValues.length
      : team.reduce((sum, player) => sum + valueForPlayer(player), 0) / team.length

  return team.reduce(
    (sum, player) => sum + (isOpenLevel(player) ? fallback : valueForPlayer(player)),
    0,
  )
}

const teamLevel = (team: Team) =>
  teamComparableValue(team, (player) => getPlayerMatchScore(player))

const teamAge = (team: Team) =>
  teamComparableValue(team, ageValue)

const playerScoreSpread = (players: Player[]) => {
  const scores = players
    .filter((player) => !isOpenLevel(player))
    .map((player) => getPlayerMatchScore(player))
  if (scores.length <= 1) return 0
  return Math.max(...scores) - Math.min(...scores)
}

const averageMatchScore = (players: Player[]) => {
  const scores = players
    .filter((player) => !isOpenLevel(player))
    .map((player) => getPlayerMatchScore(player))
  if (scores.length === 0) return 0
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

const teamLevelSpread = (team: Team) =>
  playerScoreSpread(team)

const levelMatchGroup = (player: Player) => {
  if (player.level === 'O') return null
  if (player.level === 'OA') return 'A'
  return player.level
}

const teamLevelMismatchPenalty = (team: Team) => {
  const groups = new Set(team.map(levelMatchGroup).filter(Boolean))
  return Math.max(0, groups.size - 1) * 120
}

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
  const sameGenderPenalty = (team: Team) =>
    isMixedRegularTeam(team) ? 140 : 0

  return sameGenderPenalty(teamA) + sameGenderPenalty(teamB)
}

const groupGenderMixPenalty = (players: Player[]) => {
  const counts = genderCounts(players)
  const genderedCount = counts.men + counts.women
  if (genderedCount < 2 || counts.men === 0 || counts.women === 0) return 0

  return Math.min(counts.men, counts.women) * 180
}

const femaleMaleLevelPenalty = (female: Player, male: Player) => {
  const scoreGap = scoreDistanceBetweenPlayers(female, male)
  if (scoreGap <= 3) return 0
  if (scoreGap <= 8) return scoreGap * 2
  return 20 + scoreGap * 4
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

const roundProgress = (pacing: RoundPacing) => {
  if (pacing.targetRoundCount <= 1) return 1
  return Math.min(1, Math.max(0, (pacing.roundNumber - 1) / (pacing.targetRoundCount - 1)))
}

const lateBalanceMultiplier = (pacing: RoundPacing) =>
  1 + roundProgress(pacing) ** 2 * 6

const pairingTeamLevelGap = (pairing: Pick<Pairing, 'teamA' | 'teamB'>) =>
  Math.abs(teamLevel(pairing.teamA) - teamLevel(pairing.teamB))

const specialTargetAverageScore = (pacing: RoundPacing) => {
  if (pacing.roundNumber >= Math.max(1, pacing.targetRoundCount - 1)) return 46

  const progress = roundProgress(pacing)
  const middlePeak = 1 - Math.min(1, Math.abs(progress - 0.5) * 2)
  return 72 + middlePeak * 22
}

const specialTimingPenalty = (
  players: Player[],
  pacing: RoundPacing,
  conditions: MatchConditionOptions,
) => {
  if (!conditions.levelBalance) return 0

  const regulars = players.filter((player) => !player.isGuest)
  if (regulars.length === 0) return 0

  return (
    Math.abs(averageMatchScore(regulars) - specialTargetAverageScore(pacing)) *
    SPECIAL_TIMING_WEIGHT
  )
}

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
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
) => {
  const balanceMultiplier = lateBalanceMultiplier(pacing)
  const partnerPenalty = conditions.partnerRepeat
    ? (history.partners[pairKey(teamA[0].id, teamA[1].id)] ?? 0) * 16 +
      (history.partners[pairKey(teamB[0].id, teamB[1].id)] ?? 0) * 16
    : 0
  let opponentPenalty = 0
  if (conditions.opponentRepeat) {
    for (const left of teamA) {
      for (const right of teamB) {
        opponentPenalty += (history.opponents[pairKey(left.id, right.id)] ?? 0) * 8
      }
    }
  }

  const levelPenalty = conditions.levelBalance
    ? Math.abs(teamLevel(teamA) - teamLevel(teamB)) * 32 * balanceMultiplier
    : 0
  const agePenalty = conditions.ageBalance
    ? Math.abs(teamAge(teamA) - teamAge(teamB)) * 1.5
    : 0
  const genderPenalty = conditions.genderBalance
    ? Math.abs(genderBalance(teamA) - genderBalance(teamB)) * 6
    : 0
  const mixedPairPenalty = conditions.femaleLevelFit
    ? mixedGenderLevelPenalty(teamA) + mixedGenderLevelPenalty(teamB)
    : 0
  const mixedDoublesTeamPenalty = conditions.genderBalance
    ? mixedDoublesPenalty(teamA, teamB)
    : 0
  const teamShapePenalty = conditions.levelBalance
    ? ((teamLevelSpread(teamA) + teamLevelSpread(teamB)) * 70 +
        Math.abs(teamLevelSpread(teamA) - teamLevelSpread(teamB)) * 12 +
        teamLevelMismatchPenalty(teamA) +
        teamLevelMismatchPenalty(teamB)) *
      balanceMultiplier
    : 0
  const guestPenalty = conditions.specialPriority
    ? Math.abs(teamA.filter((player) => player.isGuest).length - teamB.filter((player) => player.isGuest).length) *
      12
    : 0
  const guestPartnerPenalty = conditions.guestPartnerRepeat
    ? guestRepeatPartnerPenalty(teamA, history) +
      guestRepeatPartnerPenalty(teamB, history)
    : 0

  return (
    levelPenalty +
    agePenalty +
    genderPenalty +
    mixedPairPenalty +
    mixedDoublesTeamPenalty +
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
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
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
      score: scorePairing(teamA, teamB, history, random, conditions, pacing),
    }))
    .sort((a, b) => a.score - b.score)[0]
}

const createMatch = (
  round: number,
  court: number,
  players: [Player, Player, Player, Player],
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
  isSpecial: boolean,
): Match => {
  const pairing = bestPairing(players, history, random, conditions, pacing)
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

const groupConsecutivePlayPenalty = (
  players: Player[],
  history: HistoryState,
  conditions: MatchConditionOptions,
) =>
  conditions.restBalance
    ? players.reduce(
        (sum, player) => sum + consecutivePlayPenalty(player, history),
        0,
      )
    : 0

const playerPriority = (
  player: Player,
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
) =>
  (conditions.fairGames ? (history.games[player.id] ?? 0) * 24 : 0) -
  (conditions.restBalance ? (history.restStreaks[player.id] ?? 0) * 18 : 0) -
  (conditions.restBalance ? (history.rests[player.id] ?? 0) * 4 : 0) +
  (conditions.restBalance ? consecutivePlayPenalty(player, history) : 0) +
  (conditions.levelBalance ? getPlayerMatchScore(player) * 0.015 : 0) +
  random()

const uniquePlayers = (players: Player[]) =>
  Array.from(new Map(players.map((player) => [player.id, player])).values())

const guestPriority = (
  guest: Player,
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
) =>
  (conditions.fairGames ? (history.guestGameCounts[guest.id] ?? 0) * 100 : 0) +
  (conditions.fairGames ? (history.games[guest.id] ?? 0) * 10 : 0) +
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
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
) => {
  const targetLevel = matchLevelValue(guest)
  const pendingCount = regulars.filter((player) => pendingIds.has(player.id)).length
  const levelWeight = hasPending ? 48 : 8
  const levelPenalty = conditions.levelBalance
    ? regulars.reduce(
        (sum, player) => sum + scoreDistanceToTarget(player, targetLevel) * levelWeight,
        0,
      )
    : 0
  const levelSpread = playerScoreSpread(regulars)
  const specialCounts = regulars.map((player) => specialGameCount(player, history))
  const historyPenalty = regulars.reduce(
    (sum, player) =>
      sum +
      (conditions.fairGames ? (history.games[player.id] ?? 0) * 8 : 0) -
      (conditions.restBalance ? (history.restStreaks[player.id] ?? 0) * 9 : 0) -
      (conditions.restBalance ? (history.rests[player.id] ?? 0) * 3 : 0),
    0,
  )
  const pendingPenalty =
    conditions.specialPriority && hasPending ? (3 - pendingCount) * 90 : 0
  const repeatGuestPenalty = conditions.specialPriority
    ? hasPending
      ? specialCounts.reduce((sum, count) => sum + count, 0) * 4
      : specialCounts.reduce((sum, count) => sum + count, 0) * 900 +
        Math.max(...specialCounts) * 360
    : 0

  return (
    levelPenalty +
    (conditions.levelBalance ? levelSpread * (hasPending ? 45 : 8) : 0) +
    (conditions.femaleLevelFit ? mixedGenderLevelPenalty(regulars) * 4 : 0) +
    (conditions.genderBalance ? groupGenderMixPenalty(regulars) : 0) +
    historyPenalty +
    pendingPenalty +
    repeatGuestPenalty +
    specialTimingPenalty([guest, ...regulars], pacing, conditions) +
    groupConsecutivePlayPenalty(regulars, history, conditions) +
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
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
): [Player, Player, Player] | null => {
  const availableRegulars = activePlayers.filter(
    (player) => !player.isGuest && !usedIds.has(player.id),
  )
  if (availableRegulars.length < 3) return null

  const pendingIds = new Set(pending.map((player) => player.id))
  const hasPending = pending.length > 0
  const expectedPendingCount = hasPending ? Math.min(3, pendingIds.size) : 0
  const targetLevel = matchLevelValue(guest)
  const levelFit = [...availableRegulars]
    .sort((a, b) => {
      if (conditions.specialPriority && !hasPending) {
        const specialGameDiff =
          specialGameCount(a, history) - specialGameCount(b, history)
        if (specialGameDiff !== 0) return specialGameDiff
      }
      if (conditions.levelBalance) {
        const levelDiff =
          scoreDistanceToTarget(a, targetLevel) -
          scoreDistanceToTarget(b, targetLevel)
        if (levelDiff !== 0) return levelDiff
      }
      return (
        playerPriority(a, history, random, conditions) -
        playerPriority(b, history, random, conditions)
      )
    })
    .slice(0, 18)
  const preferredMenForWomen = conditions.femaleLevelFit
    ? pending
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
    : []
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
        if (
          hasPending &&
          regulars.filter((player) => pendingIds.has(player.id)).length <
            expectedPendingCount
        ) {
          continue
        }

        const score = scoreSpecialRegulars(
          guest,
          regulars,
          pendingIds,
          hasPending,
          history,
          random,
          conditions,
          pacing,
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
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
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
    .sort(
      (a, b) =>
        playerPriority(a, history, random, conditions) -
        playerPriority(b, history, random, conditions),
    )

  const needsGuestFirstMatch = candidateGuests.some(
    (guest) => (history.guestGameCounts[guest.id] ?? 0) === 0,
  )
  const isExtraSpecialMatch = pending.length === 0 && !needsGuestFirstMatch
  if (isExtraSpecialMatch && !allowExtraSpecial) return null

  const guests = (isExtraSpecialMatch
    ? candidateGuests.filter((guest) => guestHasRemainingExtraGames(guest, history))
    : candidateGuests
  ).sort(
    (a, b) =>
      guestPriority(a, history, random, conditions) -
      guestPriority(b, history, random, conditions),
  )

  if (guests.length === 0) return null

  for (const guest of guests) {
    const selectedPlayers = pickSpecialRegulars(
      guest,
      activePlayers,
      usedIds,
      pending,
      history,
      random,
      conditions,
      pacing,
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
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
) => {
  const pairing = bestPairing(group, history, random, conditions, pacing)
  const guests = group.filter((player) => player.isGuest)
  const regulars = group.filter((player) => !player.isGuest)
  const averageGuestLevel =
    guests.reduce((sum, guest) => sum + matchLevelValue(guest), 0) / guests.length
  const pendingCount = regulars.filter((player) => pendingIds.has(player.id)).length
  const expectedPendingCount =
    conditions.specialPriority && hasPending
      ? Math.min(regulars.length, Math.max(1, pendingIds.size))
      : 0
  const firstGuestCount = guests.filter(
    (guest) => (history.guestGameCounts[guest.id] ?? 0) === 0,
  ).length
  const regularLevelPenalty = conditions.levelBalance
    ? regulars.reduce(
        (sum, player) =>
          sum +
          scoreDistanceToTarget(player, averageGuestLevel) * (hasPending ? 36 : 8),
        0,
      )
    : 0
  const specialCounts = regulars.map((player) => specialGameCount(player, history))
  const historyPenalty = group.reduce(
    (sum, player) =>
      sum +
      (conditions.fairGames ? (history.games[player.id] ?? 0) * 7 : 0) -
      (conditions.restBalance ? (history.restStreaks[player.id] ?? 0) * 8 : 0) -
      (conditions.restBalance ? (history.rests[player.id] ?? 0) * 2 : 0),
    0,
  )
  const repeatGuestPenalty = conditions.specialPriority
    ? hasPending
      ? specialCounts.reduce((sum, count) => sum + count, 0) * 4
      : specialCounts.reduce((sum, count) => sum + count, 0) * 850 +
        Math.max(...specialCounts) * 340
    : 0
  const pendingPriorityPenalty = conditions.specialPriority
    ? (expectedPendingCount - pendingCount) * 110
    : 0

  return (
    pairing.score +
    regularLevelPenalty +
    (conditions.levelBalance ? playerScoreSpread(group) * (hasPending ? 36 : 8) : 0) +
    (conditions.femaleLevelFit ? mixedGenderLevelPenalty(regulars) * 4 : 0) +
    (conditions.genderBalance ? groupGenderMixPenalty(regulars) : 0) +
    historyPenalty +
    pendingPriorityPenalty -
    (conditions.specialPriority ? firstGuestCount * 40 : 0) +
    repeatGuestPenalty +
    specialTimingPenalty(group, pacing, conditions) +
    groupConsecutivePlayPenalty(group, history, conditions) +
    Math.max(0, guests.length - 1) * 14 +
    random()
  )
}

const pickAdaptiveSpecialGroup = (
  activePlayers: Player[],
  usedIds: Set<string>,
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
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
    .sort(
      (a, b) =>
        playerPriority(a, history, random, conditions) -
        playerPriority(b, history, random, conditions),
    )
  const needsGuestFirstMatch = candidateGuests.some(
    (guest) => (history.guestGameCounts[guest.id] ?? 0) === 0,
  )
  const isExtraSpecialMatch = pending.length === 0 && !needsGuestFirstMatch
  if (isExtraSpecialMatch && !allowExtraSpecial) return null

  const guests = (isExtraSpecialMatch
    ? candidateGuests.filter((guest) => guestHasRemainingExtraGames(guest, history))
    : candidateGuests
  ).sort(
    (a, b) =>
      guestPriority(a, history, random, conditions) -
      guestPriority(b, history, random, conditions),
  )

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
      if (conditions.specialPriority && !hasPending) {
        const specialGameDiff =
          specialGameCount(a, history) - specialGameCount(b, history)
        if (specialGameDiff !== 0) return specialGameDiff
      }
      if (conditions.levelBalance) {
        const levelDiff =
          scoreDistanceToTarget(a, targetLevel) -
          scoreDistanceToTarget(b, targetLevel)
        if (levelDiff !== 0) return levelDiff
      }
      return (
        playerPriority(a, history, random, conditions) -
        playerPriority(b, history, random, conditions)
      )
    })
    .slice(0, 18)
  const preferredMenForWomen = conditions.femaleLevelFit
    ? pending
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
    : []
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
            conditions,
            pacing,
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
  conditions: MatchConditionOptions,
  allowExtraSpecial: boolean,
  pacing: RoundPacing,
): [Player, Player, Player, Player] | null => {
  if (settings.singleGuestPerMatch) {
    return pickSingleGuestSpecialGroup(
      activePlayers,
      usedIds,
      history,
      random,
      conditions,
      pacing,
      allowExtraSpecial,
    )
  }

  return pickAdaptiveSpecialGroup(
    activePlayers,
    usedIds,
    history,
    random,
    conditions,
    pacing,
    allowExtraSpecial,
  )
}

const scoreGroup = (
  group: [Player, Player, Player, Player],
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
) => {
  const pairing = bestPairing(group, history, random, conditions, pacing)
  const gameCounts = group.map((player) => history.games[player.id] ?? 0)
  const restStreaks = group.map((player) => history.restStreaks[player.id] ?? 0)
  const levelSpread = playerScoreSpread(group)
  const guestCount = group.filter((player) => player.isGuest).length
  const balanceMultiplier = lateBalanceMultiplier(pacing)

  return (
    pairing.score +
    (conditions.fairGames ? Math.max(...gameCounts) * 3 : 0) +
    (conditions.levelBalance ? levelSpread * 150 * balanceMultiplier : 0) -
    (conditions.levelBalance
      ? pairingTeamLevelGap(pairing) * 64 * roundProgress(pacing) ** 2
      : 0) +
    (conditions.restBalance
      ? restStreaks.reduce((sum, streak) => sum + streak, 0) * 8
      : 0) +
    (conditions.genderBalance ? groupGenderMixPenalty(group) : 0) +
    groupConsecutivePlayPenalty(group, history, conditions) +
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
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
): [Player, Player, Player, Player] | null => {
  const candidates = activePlayers
    .filter((player) => {
      if (usedIds.has(player.id)) return false
      return !player.isGuest
    })
    .sort(
      (a, b) =>
        playerPriority(a, history, random, conditions) -
        playerPriority(b, history, random, conditions),
    )
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

          const score = scoreGroup(group, history, random, conditions, pacing)
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

const normalizeTournamentCourtCount = (settings: TournamentSettings) => {
  const numeric = Number(settings.courtCount)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(1, Math.floor(numeric))
}

const normalizeTournamentCount = (value: unknown, min: number, max: number) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return min
  return Math.min(max, Math.max(min, Math.floor(numeric)))
}

const tournamentSeedValue = (team: TournamentTeam) => {
  const seed = Number(team.seed)
  return Number.isFinite(seed) && seed > 0 ? seed : Number.MAX_SAFE_INTEGER
}

const activeTournamentTeams = (teams: TournamentTeam[]) =>
  teams
    .filter((team) => team.active && team.name.trim())
    .sort((a, b) => {
      const seedDiff = tournamentSeedValue(a) - tournamentSeedValue(b)
      if (seedDiff !== 0) return seedDiff
      return a.name.localeCompare(b.name)
    })

const isTeamBattleTournamentFormat = (format: TournamentSettings['format']) =>
  format === 'team-battle' || format === 'friendly-team-battle'

const tournamentTeamMap = (teams: TournamentTeam[]) =>
  new Map(teams.map((team) => [team.id, team]))

const tournamentNameParts = (value: string) =>
  value
    .split(/[,\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)

const fallbackTournamentMembers = (team: TournamentTeam): TournamentParticipant[] =>
  tournamentNameParts(team.playerNames).map((name, index) => ({
    id: `${team.id}-member-${index + 1}`,
    name,
    level: team.level,
    ageGroup: '무관',
    gender: team.gender,
  }))

export const tournamentMembersForTeam = (
  team: TournamentTeam,
): TournamentParticipant[] => {
  const members = team.members?.filter((member) => member.name.trim()) ?? []
  return members.length > 0 ? members : fallbackTournamentMembers(team)
}

export const tournamentParticipantsFromTeams = (
  teams: TournamentTeam[],
): TournamentParticipantWithTeam[] =>
  teams
    .filter((team) => team.active && team.name.trim())
    .flatMap((team) =>
      tournamentMembersForTeam(team).map((member) => ({
        ...member,
        teamId: team.id,
        teamName: team.name,
      })),
    )

const emptyTournamentLineup = (): TournamentLineup => ({
  teamAPlayerIds: ['', ''],
  teamBPlayerIds: ['', ''],
})

const normalizeLineupIds = (ids: string[] | undefined) => [
  ids?.[0] ?? '',
  ids?.[1] ?? '',
]

const participantUsage = (
  participant: TournamentParticipantWithTeam,
  usageCounts: Map<string, number>,
) => usageCounts.get(participant.id) ?? 0

const averageTournamentTeamScore = (
  teamId: string,
  participants: TournamentParticipantWithTeam[],
) => {
  const members = participants.filter((participant) => participant.teamId === teamId)
  if (members.length === 0) return 0
  return (
    members.reduce(
      (sum, participant) => sum + tournamentParticipantScore(participant),
      0,
    ) / members.length
  )
}

const sortLineupCandidates = (
  candidates: TournamentParticipantWithTeam[],
  usageCounts: Map<string, number>,
  targetScore: number,
) =>
  [...candidates].sort((a, b) => {
    const usageDiff = participantUsage(a, usageCounts) - participantUsage(b, usageCounts)
    if (usageDiff !== 0) return usageDiff
    const scoreDiff =
      Math.abs(tournamentParticipantScore(a) - targetScore) -
      Math.abs(tournamentParticipantScore(b) - targetScore)
    if (scoreDiff !== 0) return scoreDiff
    const teamDiff = a.teamName.localeCompare(b.teamName)
    if (teamDiff !== 0) return teamDiff
    return a.name.localeCompare(b.name)
  })

const pickLineupSide = (
  teamId: string,
  opponentTeamId: string,
  tieId: string,
  participants: TournamentParticipantWithTeam[],
  usageCounts: Map<string, number>,
  usedByTieTeam: Map<string, Set<string>>,
  unavailableIds: Set<string>,
) => {
  const sideUsedKey = `${tieId}:${teamId}`
  const usedInTie = usedByTieTeam.get(sideUsedKey) ?? new Set<string>()
  const selected: string[] = []
  const targetScore = averageTournamentTeamScore(teamId, participants)

  const addCandidates = (candidates: TournamentParticipantWithTeam[]) => {
    for (const candidate of sortLineupCandidates(candidates, usageCounts, targetScore)) {
      if (selected.length >= 2) break
      if (unavailableIds.has(candidate.id) || selected.includes(candidate.id)) continue
      selected.push(candidate.id)
      unavailableIds.add(candidate.id)
    }
  }

  const teamMembers = participants.filter((participant) => participant.teamId === teamId)
  addCandidates(teamMembers.filter((participant) => !usedInTie.has(participant.id)))

  if (selected.length < 2) {
    addCandidates(
      participants.filter(
        (participant) =>
          participant.teamId !== teamId && participant.teamId !== opponentTeamId,
      ),
    )
  }

  if (selected.length < 2) {
    addCandidates(
      participants.filter(
        (participant) =>
          participant.teamId !== teamId && participant.teamId === opponentTeamId,
      ),
    )
  }

  if (selected.length < 2) {
    addCandidates(teamMembers)
  }

  while (selected.length < 2) selected.push('')

  usedByTieTeam.set(sideUsedKey, new Set([...usedInTie, ...selected.filter(Boolean)]))
  for (const playerId of selected.filter(Boolean)) {
    usageCounts.set(playerId, (usageCounts.get(playerId) ?? 0) + 1)
  }

  return selected
}

const tournamentLineupStrength = (
  lineup: TournamentLineup,
  participantsById: Map<string, TournamentParticipantWithTeam>,
) =>
  [...lineup.teamAPlayerIds, ...lineup.teamBPlayerIds].reduce((sum, playerId) => {
    const participant = participantsById.get(playerId)
    return participant ? sum + tournamentParticipantScore(participant) : sum
  }, 0)

const orderLineupsByStrengthWithinTies = (
  matches: TournamentMatch[],
  lineups: TournamentLineupsByMatch,
  participants: TournamentParticipantWithTeam[],
): TournamentLineupsByMatch => {
  const participantsById = new Map(
    participants.map((participant) => [participant.id, participant]),
  )
  const matchesByTie = new Map<string, TournamentMatch[]>()

  for (const match of matches) {
    if (
      match.phase !== 'team-battle' ||
      !match.teamAId ||
      !match.teamBId ||
      match.isBye
    ) {
      continue
    }

    const tieId = match.teamBattleTieId ?? match.id
    matchesByTie.set(tieId, [...(matchesByTie.get(tieId) ?? []), match])
  }

  const orderedLineups = { ...lineups }

  for (const tieMatches of matchesByTie.values()) {
    if (tieMatches.length <= 1) continue

    const orderedMatches = [...tieMatches].sort((a, b) => a.order - b.order)
    const sortedLineups = orderedMatches
      .map((match, index) => ({
        index,
        lineup: lineups[match.id] ?? emptyTournamentLineup(),
      }))
      .sort((a, b) => {
        const strengthDiff =
          tournamentLineupStrength(a.lineup, participantsById) -
          tournamentLineupStrength(b.lineup, participantsById)
        if (strengthDiff !== 0) return strengthDiff
        return a.index - b.index
      })

    orderedMatches.forEach((match, index) => {
      orderedLineups[match.id] = sortedLineups[index].lineup
    })
  }

  return orderedLineups
}

export const generateTournamentLineups = (
  matches: TournamentMatch[],
  teams: TournamentTeam[],
): TournamentLineupsByMatch => {
  const participants = tournamentParticipantsFromTeams(teams)
  const usageCounts = new Map<string, number>()
  const usedByTieTeam = new Map<string, Set<string>>()
  const lineups: TournamentLineupsByMatch = {}

  for (const match of [...matches].sort((a, b) => a.order - b.order)) {
    if (
      match.phase !== 'team-battle' ||
      !match.teamAId ||
      !match.teamBId ||
      match.isBye
    ) {
      continue
    }

    const tieId = match.teamBattleTieId ?? match.id
    const unavailableIds = new Set<string>()
    const teamAPlayerIds = pickLineupSide(
      match.teamAId,
      match.teamBId,
      tieId,
      participants,
      usageCounts,
      usedByTieTeam,
      unavailableIds,
    )
    const teamBPlayerIds = pickLineupSide(
      match.teamBId,
      match.teamAId,
      tieId,
      participants,
      usageCounts,
      usedByTieTeam,
      unavailableIds,
    )

    lineups[match.id] = {
      ...emptyTournamentLineup(),
      teamAPlayerIds: normalizeLineupIds(teamAPlayerIds),
      teamBPlayerIds: normalizeLineupIds(teamBPlayerIds),
    }
  }

  return orderLineupsByStrengthWithinTies(matches, lineups, participants)
}

const completedTournamentScores = (
  result: TournamentResultsByMatch[string] | undefined,
) => {
  const teamAScore = result ? numericScore(result.teamAScore) : null
  const teamBScore = result ? numericScore(result.teamBScore) : null
  if (
    !result?.completed ||
    teamAScore === null ||
    teamBScore === null ||
    teamAScore === teamBScore
  ) {
    return null
  }

  return { teamAScore, teamBScore }
}

const tournamentMatchWinnerId = (
  match: TournamentMatch,
  result: TournamentResultsByMatch[string] | undefined,
) => {
  if (match.isBye) return match.teamAId ?? match.teamBId
  if (!match.teamAId || !match.teamBId) return undefined

  const scores = completedTournamentScores(result)
  if (!scores) return undefined

  return scores.teamAScore > scores.teamBScore ? match.teamAId : match.teamBId
}

const tournamentMatchLoserId = (
  match: TournamentMatch,
  result: TournamentResultsByMatch[string] | undefined,
) => {
  if (!match.teamAId || !match.teamBId) return undefined

  const scores = completedTournamentScores(result)
  if (!scores) return undefined

  return scores.teamAScore > scores.teamBScore ? match.teamBId : match.teamAId
}

const assignTournamentOrder = (
  matches: TournamentMatch[],
  settings: TournamentSettings,
  startOrder = 1,
) => {
  const courtCount = normalizeTournamentCourtCount(settings)
  return matches.map((match, index) => {
    const order = startOrder + index
    return {
      ...match,
      order,
      round: Math.ceil(order / courtCount),
      court: ((order - 1) % courtCount) + 1,
    }
  })
}

const makeTournamentGroups = (
  teams: TournamentTeam[],
  settings: TournamentSettings,
  warnings: string[],
): TournamentGroup[] => {
  if (teams.length < 3) return []

  const maxGroups = Math.max(1, Math.floor(teams.length / 3))
  const requestedGroups = normalizeTournamentCount(
    settings.groupCount,
    1,
    Math.max(1, teams.length),
  )
  const groupCount = Math.min(requestedGroups, maxGroups)

  if (requestedGroups > maxGroups) {
    warnings.push(`1개 조 최소 3팀 기준으로 ${groupCount}개 조로 조정되었습니다.`)
  }

  const groups = Array.from({ length: groupCount }, (_, index) => ({
    id: `group-${index + 1}`,
    name: `${String.fromCharCode(65 + index)}조`,
    teamIds: [] as string[],
  }))

  teams.forEach((team, index) => {
    const block = Math.floor(index / groupCount)
    const offset = index % groupCount
    const groupIndex = block % 2 === 0 ? offset : groupCount - 1 - offset
    groups[groupIndex].teamIds.push(team.id)
  })

  return groups
}

const makeGroupRoundRobinMatches = (
  groups: TournamentGroup[],
): TournamentMatch[] => {
  const matches: TournamentMatch[] = []

  for (const group of groups) {
    for (let a = 0; a < group.teamIds.length - 1; a += 1) {
      for (let b = a + 1; b < group.teamIds.length; b += 1) {
        const matchNumber = matches.filter((match) => match.groupId === group.id).length + 1
        matches.push({
          id: `${group.id}-m${a + 1}-${b + 1}`,
          phase: 'group',
          order: 0,
          round: 0,
          court: 0,
          label: `${group.name} ${matchNumber}경기`,
          teamAId: group.teamIds[a],
          teamBId: group.teamIds[b],
          groupId: group.id,
        })
      }
    }
  }

  return matches
}

const compareHeadToHead = (
  teamAId: string,
  teamBId: string,
  matches: TournamentMatch[],
  results: TournamentResultsByMatch,
) => {
  const directMatch = matches.find(
    (match) =>
      match.groupId &&
      ((match.teamAId === teamAId && match.teamBId === teamBId) ||
        (match.teamAId === teamBId && match.teamBId === teamAId)),
  )
  if (!directMatch) return 0

  const winnerId = tournamentMatchWinnerId(directMatch, results[directMatch.id])
  if (winnerId === teamAId) return -1
  if (winnerId === teamBId) return 1
  return 0
}

const calculateTournamentGroupStandings = (
  groups: TournamentGroup[],
  teamsById: Map<string, TournamentTeam>,
  matches: TournamentMatch[],
  results: TournamentResultsByMatch,
): TournamentStanding[] => {
  const allStandings: TournamentStanding[] = []

  for (const group of groups) {
    const groupMatches = matches.filter((match) => match.groupId === group.id)
    const standings = group.teamIds
      .map((teamId) => teamsById.get(teamId))
      .filter((team): team is TournamentTeam => Boolean(team))
      .map<TournamentStanding>((team) => ({
        team,
        groupId: group.id,
        rank: 0,
        played: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDiff: 0,
        seed: tournamentSeedValue(team),
      }))
    const byTeamId = new Map(standings.map((standing) => [standing.team.id, standing]))

    for (const match of groupMatches) {
      if (!match.teamAId || !match.teamBId) continue

      const scores = completedTournamentScores(results[match.id])
      if (!scores) continue

      const teamA = byTeamId.get(match.teamAId)
      const teamB = byTeamId.get(match.teamBId)
      if (!teamA || !teamB) continue

      teamA.played += 1
      teamB.played += 1
      teamA.pointsFor += scores.teamAScore
      teamA.pointsAgainst += scores.teamBScore
      teamB.pointsFor += scores.teamBScore
      teamB.pointsAgainst += scores.teamAScore

      if (scores.teamAScore > scores.teamBScore) {
        teamA.wins += 1
        teamB.losses += 1
      } else {
        teamB.wins += 1
        teamA.losses += 1
      }
    }

    standings.forEach((standing) => {
      standing.pointDiff = standing.pointsFor - standing.pointsAgainst
    })

    standings.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor

      const direct = compareHeadToHead(a.team.id, b.team.id, groupMatches, results)
      if (direct !== 0) return direct

      if (a.seed !== b.seed) return a.seed - b.seed
      return a.team.name.localeCompare(b.team.name)
    })

    standings.forEach((standing, index) => {
      standing.rank = index + 1
    })

    allStandings.push(...standings)
  }

  return allStandings
}

const nextPowerOfTwo = (value: number) => {
  let size = 1
  while (size < value) size *= 2
  return Math.max(2, size)
}

const seedOrder = (size: number): number[] => {
  if (size <= 2) return [1, 2]

  return seedOrder(size / 2).flatMap((seed) => [seed, size + 1 - seed])
}

type BracketEntry = {
  teamId?: string
  source?: string
}

const bracketRoundName = (participantCount: number) => {
  if (participantCount <= 2) return '결승'
  if (participantCount === 4) return '4강'
  return `${participantCount}강`
}

const makeKnockoutMatches = (
  teams: TournamentTeam[],
  settings: TournamentSettings,
  results: TournamentResultsByMatch,
  prefix: string,
  startOrder: number,
  includeThirdPlace: boolean,
): TournamentMatch[] => {
  if (teams.length < 2) return []

  const bracketSize = nextPowerOfTwo(teams.length)
  let entries: BracketEntry[] = seedOrder(bracketSize).map((seed) => ({
    teamId: teams[seed - 1]?.id,
  }))
  const matches: TournamentMatch[] = []
  const semifinalMatches: TournamentMatch[] = []

  for (
    let bracketRound = 1, participantCount = bracketSize;
    entries.length >= 2;
    bracketRound += 1, participantCount /= 2
  ) {
    const nextEntries: BracketEntry[] = []
    const roundName = bracketRoundName(participantCount)

    for (let index = 0; index < entries.length; index += 2) {
      const left = entries[index]
      const right = entries[index + 1]
      const slot = index / 2 + 1
      const id = `${prefix}-r${bracketRound}-m${slot}`
      const isBye =
        Boolean(left.teamId) !== Boolean(right.teamId) &&
        !left.source &&
        !right.source
      const label =
        roundName === '결승' ? '결승' : `${roundName} ${slot}경기`
      const match: TournamentMatch = {
        id,
        phase: 'knockout',
        order: 0,
        round: 0,
        court: 0,
        label,
        teamAId: left.teamId,
        teamBId: right.teamId,
        sourceA: left.source,
        sourceB: right.source,
        bracketRound,
        bracketSlot: slot,
        isBye,
      }

      matches.push(match)
      if (participantCount === 4) semifinalMatches.push(match)

      const winnerId = tournamentMatchWinnerId(match, results[id])
      nextEntries.push({
        teamId: winnerId,
        source: winnerId ? undefined : `${label} 승자`,
      })
    }

    entries = nextEntries
  }

  const orderedMatches = assignTournamentOrder(matches, settings, startOrder)

  if (!includeThirdPlace || semifinalMatches.length !== 2) return orderedMatches

  const thirdPlaceEntries = semifinalMatches.map<BracketEntry>((match) => {
    const loserId = tournamentMatchLoserId(match, results[match.id])
    return {
      teamId: loserId,
      source: loserId ? undefined : `${match.label} 패자`,
    }
  })
  const thirdPlaceMatch: TournamentMatch = {
    id: `${prefix}-third-place`,
    phase: 'third-place',
    order: 0,
    round: 0,
    court: 0,
    label: '3·4위전',
    teamAId: thirdPlaceEntries[0]?.teamId,
    teamBId: thirdPlaceEntries[1]?.teamId,
    sourceA: thirdPlaceEntries[0]?.source,
    sourceB: thirdPlaceEntries[1]?.source,
    bracketRound: Math.max(1, Math.log2(nextPowerOfTwo(teams.length))),
  }

  return [
    ...orderedMatches,
    ...assignTournamentOrder([thirdPlaceMatch], settings, startOrder + orderedMatches.length),
  ]
}

const makeTeamBattleMatches = (
  teams: TournamentTeam[],
  settings: TournamentSettings,
): TournamentMatch[] => {
  const matchCount = normalizeTournamentCount(settings.teamBattleMatchCount, 1, 5)
  const slotLabels = settings.teamBattleSlots.length
    ? settings.teamBattleSlots
    : ['남복', '여복', '혼복', '자유복식', '에이스전']
  const matches: TournamentMatch[] = []

  for (let a = 0; a < teams.length - 1; a += 1) {
    for (let b = a + 1; b < teams.length; b += 1) {
      const teamA = teams[a]
      const teamB = teams[b]
      const tieId = `tb-${teamA.id}-${teamB.id}`

      for (let slot = 0; slot < matchCount; slot += 1) {
        const slotLabel = slotLabels[slot] ?? `${slot + 1}경기`
        matches.push({
          id: `${tieId}-s${slot + 1}`,
          phase: 'team-battle',
          order: 0,
          round: 0,
          court: 0,
          label: `${teamA.name} vs ${teamB.name}`,
          teamAId: teamA.id,
          teamBId: teamB.id,
          teamBattleTieId: tieId,
          teamBattleSlot: slotLabel,
        })
      }
    }
  }

  return assignTournamentOrder(matches, settings)
}

const calculateTeamBattleTies = (
  teams: TournamentTeam[],
  matches: TournamentMatch[],
  results: TournamentResultsByMatch,
): TournamentTeamBattleTie[] => {
  const ties = new Map<string, TournamentTeamBattleTie>()
  const teamsById = tournamentTeamMap(teams)

  for (const match of matches.filter((item) => item.phase === 'team-battle')) {
    if (!match.teamBattleTieId || !match.teamAId || !match.teamBId) continue

    const tie =
      ties.get(match.teamBattleTieId) ??
      ({
        id: match.teamBattleTieId,
        label: `${teamsById.get(match.teamAId)?.name ?? 'A팀'} vs ${
          teamsById.get(match.teamBId)?.name ?? 'B팀'
        }`,
        teamAId: match.teamAId,
        teamBId: match.teamBId,
        teamAWins: 0,
        teamBWins: 0,
      } satisfies TournamentTeamBattleTie)

    const winnerId = tournamentMatchWinnerId(match, results[match.id])
    if (winnerId === match.teamAId) tie.teamAWins += 1
    if (winnerId === match.teamBId) tie.teamBWins += 1
    ties.set(match.teamBattleTieId, tie)
  }

  for (const tie of ties.values()) {
    if (tie.teamAWins > tie.teamBWins) tie.winnerTeamId = tie.teamAId
    if (tie.teamBWins > tie.teamAWins) tie.winnerTeamId = tie.teamBId
  }

  return Array.from(ties.values())
}

const calculateTeamBattleStandings = (
  teams: TournamentTeam[],
  ties: TournamentTeamBattleTie[],
): TournamentTeamBattleStanding[] => {
  const standings = teams.map<TournamentTeamBattleStanding>((team) => ({
    team,
    rank: 0,
    tiesPlayed: 0,
    tiesWon: 0,
    tiesLost: 0,
    matchWins: 0,
    matchLosses: 0,
  }))
  const byTeamId = new Map(standings.map((standing) => [standing.team.id, standing]))

  for (const tie of ties) {
    const teamA = byTeamId.get(tie.teamAId)
    const teamB = byTeamId.get(tie.teamBId)
    if (!teamA || !teamB) continue

    teamA.matchWins += tie.teamAWins
    teamA.matchLosses += tie.teamBWins
    teamB.matchWins += tie.teamBWins
    teamB.matchLosses += tie.teamAWins

    if (!tie.winnerTeamId) continue

    teamA.tiesPlayed += 1
    teamB.tiesPlayed += 1
    if (tie.winnerTeamId === tie.teamAId) {
      teamA.tiesWon += 1
      teamB.tiesLost += 1
    } else {
      teamB.tiesWon += 1
      teamA.tiesLost += 1
    }
  }

  standings.sort((a, b) => {
    if (b.tiesWon !== a.tiesWon) return b.tiesWon - a.tiesWon
    const matchDiff =
      b.matchWins - b.matchLosses - (a.matchWins - a.matchLosses)
    if (matchDiff !== 0) return matchDiff
    if (b.matchWins !== a.matchWins) return b.matchWins - a.matchWins
    return tournamentSeedValue(a.team) - tournamentSeedValue(b.team)
  })

  standings.forEach((standing, index) => {
    standing.rank = index + 1
  })

  return standings
}

const emptyTournamentSchedule = (warnings: string[]): TournamentSchedule => ({
  groups: [],
  matches: [],
  standings: [],
  knockoutMatches: [],
  teamBattleTies: [],
  teamBattleStandings: [],
  qualifiedTeamIds: [],
  warnings,
})

export const generateTournamentSchedule = (
  teams: TournamentTeam[],
  settings: TournamentSettings,
  results: TournamentResultsByMatch,
): TournamentSchedule => {
  const activeTeams = activeTournamentTeams(teams)
  const teamsById = tournamentTeamMap(activeTeams)
  const warnings: string[] = []

  if (settings.format === 'group-knockout') {
    if (activeTeams.length < 3) {
      return emptyTournamentSchedule(['조별리그는 참가 팀이 3팀 이상 필요합니다.'])
    }

    const groups = makeTournamentGroups(activeTeams, settings, warnings)
    const groupMatches = assignTournamentOrder(
      makeGroupRoundRobinMatches(groups),
      settings,
    )
    const standings = calculateTournamentGroupStandings(
      groups,
      teamsById,
      groupMatches,
      results,
    )
    const incompleteGroups = groups.filter((group) =>
      groupMatches.some(
        (match) =>
          match.groupId === group.id &&
          !tournamentMatchWinnerId(match, results[match.id]),
      ),
    )

    if (incompleteGroups.length > 0) {
      warnings.push(
        `조별 경기 미완료: ${incompleteGroups.map((group) => group.name).join(', ')}`,
      )
    }
    const advancePerGroup = normalizeTournamentCount(
      settings.advancePerGroup,
      1,
      Math.max(1, activeTeams.length),
    )
    const qualifiedTeamIds =
      incompleteGroups.length > 0
        ? []
        : groups.flatMap((group) =>
            standings
              .filter((standing) => standing.groupId === group.id)
              .filter((standing) => standing.rank <= advancePerGroup)
              .map((standing) => standing.team.id),
          )
    const qualifiedTeams = qualifiedTeamIds
      .map((teamId) => teamsById.get(teamId))
      .filter((team): team is TournamentTeam => Boolean(team))

    const knockoutMatches = makeKnockoutMatches(
      qualifiedTeams,
      settings,
      results,
      'gk-ko',
      groupMatches.length + 1,
      settings.includeThirdPlace,
    )

    return {
      groups,
      matches: [...groupMatches, ...knockoutMatches],
      standings,
      knockoutMatches,
      teamBattleTies: [],
      teamBattleStandings: [],
      qualifiedTeamIds,
      warnings,
    }
  }

  if (isTeamBattleTournamentFormat(settings.format)) {
    if (activeTeams.length < 2) {
      return emptyTournamentSchedule([
        settings.format === 'friendly-team-battle'
          ? '친목전은 참가 팀이 2팀 이상 필요합니다.'
          : '단체전은 참가 팀이 2팀 이상 필요합니다.',
      ])
    }

    const matches = makeTeamBattleMatches(activeTeams, settings)
    const teamBattleTies = calculateTeamBattleTies(activeTeams, matches, results)

    return {
      groups: [],
      matches,
      standings: [],
      knockoutMatches: [],
      teamBattleTies,
      teamBattleStandings: calculateTeamBattleStandings(activeTeams, teamBattleTies),
      qualifiedTeamIds: [],
      warnings,
    }
  }

  if (activeTeams.length < 2) {
    return emptyTournamentSchedule(['넉아웃은 참가 팀이 2팀 이상 필요합니다.'])
  }

  const knockoutMatches = makeKnockoutMatches(
    activeTeams,
    settings,
    results,
    'ko',
    1,
    settings.includeThirdPlace,
  )

  return {
    groups: [],
    matches: knockoutMatches,
    standings: [],
    knockoutMatches,
    teamBattleTies: [],
    teamBattleStandings: [],
    qualifiedTeamIds: activeTeams.map((team) => team.id),
    warnings,
  }
}

export const generateSchedule = (
  players: Player[],
  settings: MatchSettings,
): Schedule => {
  const activePlayers = players.filter((player) => player.active)
  const activeRegulars = activePlayers.filter((player) => !player.isGuest)
  const activeGuests = activePlayers.filter((player) => player.isGuest)
  const history = makeHistory(activePlayers)
  const rounds: Round[] = []
  const warnings: string[] = []
  const random = makeRandom(settings.seed)
  const conditions = matchConditions(settings)

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
    const pacing = { roundNumber, targetRoundCount }

    const courtLimit = Math.min(settings.courtCount, Math.floor(activePlayers.length / 4))

    const addSpecialMatches = (startCourt: number) => {
      for (let court = startCourt; court <= courtLimit; court += 1) {
        const group = pickSpecialGroup(
          activePlayers,
          usedIds,
          history,
          random,
          settings,
          conditions,
          allowExtraSpecial,
          pacing,
        )
        if (!group) break

        const match = createMatch(
          roundNumber,
          court,
          group,
          history,
          random,
          conditions,
          pacing,
          true,
        )
        matches.push(match)
        for (const player of group) usedIds.add(player.id)
        updateHistoryForMatch(history, match)
      }
    }

    const addGeneralMatches = (startCourt: number) => {
      for (let court = startCourt; court <= courtLimit; court += 1) {
        const group = pickGeneralGroup(
          activePlayers,
          usedIds,
          history,
          random,
          settings,
          conditions,
          pacing,
        )
        if (!group) break

        const match = createMatch(
          roundNumber,
          court,
          group,
          history,
          random,
          conditions,
          pacing,
          hasGuest(group),
        )
        matches.push(match)
        for (const player of group) usedIds.add(player.id)
        updateHistoryForMatch(history, match)
      }
    }

    if (conditions.specialPriority) {
      addSpecialMatches(1)
      addGeneralMatches(matches.length + 1)
    } else {
      addGeneralMatches(1)
      addSpecialMatches(matches.length + 1)
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

  for (const player of players.filter((item) => item.active)) {
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
      const winnerSide = result?.winnerSide ?? null
      const completed = Boolean(result?.completed) && winnerSide !== null
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

      if (!completed) continue

      const teamAWon = winnerSide === 'A'
      for (const player of teamA) {
        const stat = ensureStat(player)
        if (teamAScore !== null && teamBScore !== null) {
          stat.pointsFor += teamAScore
          stat.pointsAgainst += teamBScore
        }
        if (teamAWon) stat.wins += 1
        else stat.losses += 1
      }
      for (const player of teamB) {
        const stat = ensureStat(player)
        if (teamAScore !== null && teamBScore !== null) {
          stat.pointsFor += teamBScore
          stat.pointsAgainst += teamAScore
        }
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
