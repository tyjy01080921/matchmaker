export type Gender = 'male' | 'female' | 'none'

export type Level = 'A' | 'B' | 'C' | 'D' | '스페셜'

export type AgeGroup = '20대' | '30대' | '40대' | '45대' | '50대' | '55대이상'

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

export type MatchResult = {
  teamAScore: string
  teamBScore: string
  completed: boolean
  note: string
}

export type ResultsByMatch = Record<string, MatchResult>

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
