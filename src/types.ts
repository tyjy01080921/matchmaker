export type Gender = 'male' | 'female' | 'none'

export type Level = 'OA' | 'A' | 'B' | 'C' | 'D' | 'O' | '스페셜'

export type AgeGroup =
  | '무관'
  | '20대'
  | '30대'
  | '40대'
  | '45대'
  | '50대'
  | '55대이상'

export type AppMode = 'meeting' | 'tournament'

export type TournamentFormat =
  | 'group-knockout'
  | 'knockout'
  | 'team-battle'
  | 'friendly-team-battle'

export type MatchConditionKey =
  | 'fairGames'
  | 'restBalance'
  | 'levelBalance'
  | 'ageBalance'
  | 'genderBalance'
  | 'partnerRepeat'
  | 'opponentRepeat'
  | 'specialPriority'
  | 'guestPartnerRepeat'
  | 'femaleLevelFit'

export type MatchConditionOptions = Record<MatchConditionKey, boolean>

export type Player = {
  id: string
  name: string
  level: Level
  ageGroup: AgeGroup
  gender: Gender
  active: boolean
  specialRequired: boolean
  isGuest: boolean
  guestGameLimit: number
}

export type MatchSettings = {
  eventName: string
  courtCount: number
  seed: number
  singleGuestPerMatch: boolean
  targetRoundCount: number
  conditionOptions: MatchConditionOptions
}

export type TournamentSettings = {
  format: TournamentFormat
  courtCount: number
  groupCount: number
  advancePerGroup: number
  includeThirdPlace: boolean
  teamBattleMatchCount: number
  teamBattleSlots: string[]
  friendlyParticipantCount: number
}

export type TournamentTeam = {
  id: string
  name: string
  playerNames: string
  level: Level
  gender: Gender
  seed: number | null
  active: boolean
  members?: TournamentParticipant[]
}

export type Team = [Player, Player]

export type Match = {
  id: string
  round: number
  court: number
  teamA: Team
  teamB: Team
  isSpecial: boolean
}

export type Round = {
  id: string
  number: number
  matches: Match[]
  resting: Player[]
}

export type Schedule = {
  rounds: Round[]
  warnings: string[]
  specialCompletedIds: string[]
  guestGameCounts: Record<string, number>
}

export type MatchWinnerSide = 'A' | 'B'

export type MatchResult = {
  teamAScore: string
  teamBScore: string
  completed: boolean
  note: string
  winnerSide?: MatchWinnerSide
}

export type ResultsByMatch = Record<string, MatchResult>

export type PrizeDrawResult = {
  prize: string
  winnerId: string
  winnerName: string
  reward?: string
  done?: boolean
}

export type PrizeDrawState = {
  mode: 'people' | 'mission'
  prizesText: string
  prizesConfirmed: boolean
  missionsText: string
  allowDuplicateWinners: boolean
  drawCount: number
  results: PrizeDrawResult[]
  missionResults: PrizeDrawResult[]
  matchMissions: Record<string, PrizeDrawResult>
}

export type TournamentPhase = 'group' | 'knockout' | 'third-place' | 'team-battle'

export type TournamentMatch = {
  id: string
  phase: TournamentPhase
  order: number
  round: number
  court: number
  label: string
  teamAId?: string
  teamBId?: string
  sourceA?: string
  sourceB?: string
  groupId?: string
  bracketRound?: number
  bracketSlot?: number
  teamBattleTieId?: string
  teamBattleSlot?: string
  isBye?: boolean
}

export type TournamentMatchResult = MatchResult

export type TournamentResultsByMatch = Record<string, TournamentMatchResult>

export type TournamentParticipant = {
  id: string
  name: string
  level: Level
  ageGroup: AgeGroup
  gender: Gender
}

export type TournamentLineup = {
  teamAPlayerIds: string[]
  teamBPlayerIds: string[]
}

export type TournamentLineupsByMatch = Record<string, TournamentLineup>

export type TournamentGroup = {
  id: string
  name: string
  teamIds: string[]
}

export type TournamentStanding = {
  team: TournamentTeam
  groupId?: string
  rank: number
  played: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  pointDiff: number
  seed: number
}

export type TournamentTeamBattleTie = {
  id: string
  label: string
  teamAId: string
  teamBId: string
  teamAWins: number
  teamBWins: number
  winnerTeamId?: string
}

export type TournamentTeamBattleStanding = {
  team: TournamentTeam
  rank: number
  tiesPlayed: number
  tiesWon: number
  tiesLost: number
  matchWins: number
  matchLosses: number
  pointsFor: number
  pointsAgainst: number
  pointDiff: number
}

export type TournamentSchedule = {
  groups: TournamentGroup[]
  matches: TournamentMatch[]
  standings: TournamentStanding[]
  knockoutMatches: TournamentMatch[]
  teamBattleTies: TournamentTeamBattleTie[]
  teamBattleStandings: TournamentTeamBattleStanding[]
  qualifiedTeamIds: string[]
  warnings: string[]
}

export type MatchNameOverrides = Record<string, Record<string, string>>

export type PlayerStat = {
  player: Player
  games: number
  rests: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  specialDone: boolean
  guestGames: number
}
