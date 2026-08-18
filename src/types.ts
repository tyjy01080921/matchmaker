export type Gender = 'male' | 'female' | 'none'

export type Level = 'OA' | 'A' | 'B' | 'C' | 'D' | 'E' | 'O' | '스페셜'

export type AgeGroup =
  | '무관'
  | '20대'
  | '30대'
  | '40대'
  | '45대'
  | '50대'
  | '55대이상'

export type MatchAgeGroup = Exclude<AgeGroup, '무관'>
export type MatchLevel = Extract<Level, 'A' | 'B' | 'C' | 'D' | 'E'>
export type MatchGender = Extract<Gender, 'male' | 'female'>
export type LevelTierTable = Record<
  MatchAgeGroup,
  Record<MatchGender, Record<MatchLevel, number>>
>

export type AppMode = 'meeting' | 'tournament'

export type MeetingShuffleDirection =
  | 'balanced'
  | 'variety'
  | 'skill'
  | 'wait'

export type CourtAssignmentMode = 'fixed' | 'available'

export type SpecialScheduleMode = 'continuous' | 'spread'

export type EventMatchParticipant = {
  name: string
  playerId?: string
}

export type EventMatchSettings = {
  enabled: boolean
  startTime: string
  court: number
  participants: [
    EventMatchParticipant,
    EventMatchParticipant,
    EventMatchParticipant,
    EventMatchParticipant,
  ]
}

export type TournamentFormat =
  | 'group-knockout'
  | 'knockout'
  | 'team-battle'
  | 'friendly-team-battle'

export type MatchConditionKey =
  | 'fairGames'
  | 'restBalance'
  | 'waitPriority'
  | 'levelBalance'
  | 'ageBalance'
  | 'genderBalance'
  | 'partnerRepeat'
  | 'opponentRepeat'
  | 'groupRepeat'
  | 'specialMatchCreation'
  | 'specialPriority'
  | 'guestPartnerRepeat'
  | 'femaleLevelFit'
  | 'strictSkillLimit'

export type MatchConditionOptions = Record<MatchConditionKey, boolean>

export type Player = {
  id: string
  name: string
  level: Level
  ageGroup: AgeGroup
  gender: Gender
  active: boolean
  specialRequired: boolean
  specialMatchEligible?: boolean
  matchLevelTier?: number
  isGuest: boolean
  guestGameLimit: number
  gameCountFlexible?: boolean
  waitTimeFlexible?: boolean
  arrivalOffsetMinutes?: number
  departureOffsetMinutes?: number
  attendancePriority?: boolean
  preferredPartnerIds?: string[]
}

export type MatchSettings = {
  eventName: string
  courtCount: number
  courtAssignmentMode: CourtAssignmentMode
  startTime: string
  endTime: string
  normalGameMinutes: 10 | 12 | 15
  seed: number
  shuffleDirection: MeetingShuffleDirection
  singleGuestPerMatch: boolean
  specialLimitEnabled: boolean
  specialScheduleMode: SpecialScheduleMode
  specialGameLimitEnabled: boolean
  specialGameLimit: number
  specialParticipantTarget: number
  specialTimeLimitEnabled: boolean
  specialTimeLimitMinutes: number
  specialLowPriorityEnabled: boolean
  specialLowPriorityPercent: number
  specialHighPriorityEnabled: boolean
  specialHighPriorityPercent: number
  levelTiers: LevelTierTable
  targetRoundCount: number
  pacingRoundCount: number
  roundCountLocked: boolean
  eventMatch: EventMatchSettings
  earlyPhaseEndPercent: number
  middlePhaseEndPercent: number
  conditionOptions: MatchConditionOptions
}

export type TournamentSettings = {
  format: TournamentFormat
  courtCount: number
  startTime: string
  endTime: string
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
  isEventMatch?: boolean
  startOffsetMinutes?: number
  durationMinutes?: number
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

export type WaitLimitRecommendationKind =
  | 'shorter-game'
  | 'more-courts'
  | 'extend-time'

export type WaitLimitRecommendationOutcome = {
  maximumWaitMinutes: number
  maximumInitialWaitMinutes: number
  maximumBetweenWaitMinutes: number
  maximumFinalIdleMinutes: number
  participantsOverLimit: number
}

export type WaitLimitRecommendation = {
  kind: WaitLimitRecommendationKind
  title: string
  detail: string
  verified: boolean
  settings: MatchSettings
  outcome: WaitLimitRecommendationOutcome
}

export type WaitLimitViolationPhase =
  | 'initial'
  | 'between'
  | 'final'
  | 'unassigned'

export type WaitLimitParticipantViolation = {
  playerId: string
  waitMinutes: number
  phase: WaitLimitViolationPhase
  previousMatchId?: string
  nextMatchId?: string
}

export type MeetingWaitLimitFailure = {
  maximumWaitMinutes: number
  maximumInitialWaitMinutes: number
  maximumBetweenWaitMinutes: number
  maximumFinalIdleMinutes: number
  participantsOverLimit: number
  recommendedParticipantCount: number
  searchedScheduleCount: number
  recommendations: WaitLimitRecommendation[]
  participantViolations: WaitLimitParticipantViolation[]
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

export type MeetingCourtAssignment = {
  court: number
  dispatchOrder: number
}

export type MeetingCourtAssignments = Record<string, MeetingCourtAssignment>

export type MeetingContinuationMode = 'standard' | 'late-special-unlimited'

export type MeetingContinuationPlayerState = {
  eligibleFromOffsetMinutes: number
  fairnessGameCredit: number
  guestGameCredit: number
}

export type MeetingContinuationState = {
  version: 1
  revision: number
  mode: MeetingContinuationMode
  activatedAtOffsetMinutes?: number
  players: Record<string, MeetingContinuationPlayerState>
}

export type MeetingReplanResolution = {
  schedule: Schedule
  continuation: MeetingContinuationState
  lockedMatchIds: string[]
  replacedMatchIds: string[]
  createdMatchIds: string[]
  progressOffsetMinutes: number
  warnings: string[]
  failureIssues: string[]
}

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

export type MeetingLineup = {
  teamAPlayerIds: string[]
  teamBPlayerIds: string[]
}

export type MeetingLineupsByMatch = Record<string, MeetingLineup>

export type PlayerStat = {
  player: Player
  games: number
  averageWaitMinutes: number | null
  maxWaitMinutes: number | null
  firstWaitMinutes: number | null
  lastMatchEndMinutes: number | null
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  specialDone: boolean
  guestGames: number
}
