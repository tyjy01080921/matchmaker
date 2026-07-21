import type {
  Gender,
  Level,
  LevelTierTable,
  MatchAgeGroup,
  MatchLevel,
  Match,
  MatchConditionOptions,
  MatchNameOverrides,
  MeetingLineupsByMatch,
  MeetingShuffleDirection,
  MatchSettings,
  MeetingWaitLimitFailure,
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
  WaitLimitParticipantViolation,
} from './types'
import { defaultLevelTiers, defaultMatchConditionOptions } from './defaultData'
import { getBookingDurationMinutes, getBookingRoundCount } from './scheduleTime'

type HistoryState = {
  games: Record<string, number>
  rests: Record<string, number>
  restStreaks: Record<string, number>
  playStreaks: Record<string, number>
  partners: Record<string, number>
  opponents: Record<string, number>
  groups: Record<string, number>
  lastMatchEnd: Record<string, number>
  currentStartOffset: number
  plannedSpecialIds: Set<string>
  specialCompleted: Set<string>
  specialGameCounts: Record<string, number>
  guestGameCounts: Record<string, number>
  skillWarningMatches: number
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
  earlyPhaseEndPercent?: number
  middlePhaseEndPercent?: number
}

const DEFAULT_TARGET_ROUND_COUNT = 8
const GUEST_REPEAT_PARTNER_PENALTY = 50000
const PARTNER_REPEAT_WEIGHT = 60000
const OPPONENT_REPEAT_WEIGHT = 10000
const SPECIAL_TIMING_WEIGHT = 110
const FAIR_GAME_MAX_WEIGHT = 10000000
const FAIR_GAME_TOTAL_WEIGHT = 100000
const REPEATED_GROUP_WEIGHT = 100000
const MAX_GROUP_MEETINGS = 2
const WAIT_PRIORITY_MINUTES = 25
const WAIT_PRIORITY_WEIGHT = 5000
const WAIT_DEADLINE_MINUTES = 15
const WAIT_DEADLINE_WEIGHT = 12000000
const WAIT_PRIORITY_MAX_VALUE = FAIR_GAME_MAX_WEIGHT * 1.5
const STANDARD_WAIT_SOFT_START_MINUTES = 5
const TEAM_SKILL_PREFERRED_GAP = 30
const TEAM_SKILL_WARNING_GAP = 40
const TEAM_SKILL_EXCESS_WEIGHT = 250
const OPEN_LEVEL_MIN_SCORE = 0
const OPEN_LEVEL_MAX_SCORE = 100
const OPEN_LEVEL_WIDE_GROUP_WEIGHT = 3000000
const GLOBAL_LEVEL_COHESION_WEIGHT = 900000
const MIDDLE_LEVEL_COHESION_WEIGHT = 1500000
const GENERAL_GLOBAL_LEVEL_COHESION_WEIGHT = 2000000
const GENERAL_MIDDLE_LEVEL_COHESION_WEIGHT = 2200000
const GLOBAL_GENDER_COHESION_WEIGHT = 900
const OPTIMIZED_GENDER_COMPOSITION_WEIGHT = 300000
const MIDDLE_PARTNER_LEVEL_WEIGHT = 50000
const WARMUP_PARTNER_DIVERSITY_WEIGHT = 3000
const STRICT_WARMUP_PARTNER_DIVERSITY_WEIGHT = 150
const SPECIAL_GENERAL_GAME_OFFSET = 1
const PREFERRED_PARTNER_FIRST_GAME_BONUS = 60000
const PREFERRED_PARTNER_SECOND_GAME_BONUS = 10000
const MAX_PREFERRED_PARTNER_GAMES = 2
const GAME_SLOT_MINUTES = 15

const replaceMatchPlayer = (match: Match, outgoingId: string, incoming: Player): Match => ({
  ...match,
  teamA: match.teamA.map((player) =>
    player.id === outgoingId ? incoming : player) as Team,
  teamB: match.teamB.map((player) =>
    player.id === outgoingId ? incoming : player) as Team,
})

const matchPairingKey = (match: Match) => [match.teamA, match.teamB]
  .map((team) => team.map((player) => player.id).sort().join('__'))
  .sort()
  .join('::')

export const cycleMeetingMatchPartners = (match: Match): Match => {
  const players = [...match.teamA, ...match.teamB]
    .sort((left, right) => left.id.localeCompare(right.id))
  if (players.length !== 4 || new Set(players.map((player) => player.id)).size !== 4) {
    return match
  }

  const options: Array<Pick<Match, 'teamA' | 'teamB'>> = [
    { teamA: [players[0], players[1]], teamB: [players[2], players[3]] },
    { teamA: [players[0], players[2]], teamB: [players[1], players[3]] },
    { teamA: [players[0], players[3]], teamB: [players[1], players[2]] },
  ]
  const currentPairingKey = matchPairingKey(match)
  const currentIndex = options.findIndex((option) =>
    matchPairingKey({ ...match, ...option }) === currentPairingKey,
  )
  const nextOption = options[(Math.max(0, currentIndex) + 1) % options.length]
  return { ...match, ...nextOption }
}

const matchTimeWindow = (match: Match) => {
  const start = match.startOffsetMinutes ?? (match.round - 1) * GAME_SLOT_MINUTES
  return { start, end: start + (match.durationMinutes ?? GAME_SLOT_MINUTES) }
}

const windowsOverlap = (left: Match, right: Match) => {
  const a = matchTimeWindow(left)
  const b = matchTimeWindow(right)
  return a.start < b.end && b.start < a.end
}

export const findMeetingPlayerTimeConflict = (
  schedule: Schedule,
  sourceMatchId: string,
  playerId: string,
): Match | null => {
  const matches = schedule.rounds.flatMap((round) => round.matches)
  const sourceMatch = matches.find((match) => match.id === sourceMatchId)
  if (!sourceMatch) return null

  return matches.find(
    (match) =>
      match.id !== sourceMatch.id &&
      windowsOverlap(sourceMatch, match) &&
      [...match.teamA, ...match.teamB].some((player) => player.id === playerId),
  ) ?? null
}

const refreshScheduleRestingPlayers = (
  schedule: Schedule,
  players: Player[],
): Schedule => {
  const activePlayers = players.filter((player) => player.active)
  const matches = schedule.rounds.flatMap((round) => round.matches)
  return {
    ...schedule,
    rounds: schedule.rounds.map((round) => {
      const overlappingMatches = matches.filter((match) =>
        round.matches.some((roundMatch) => windowsOverlap(roundMatch, match)),
      )
      const playingIds = new Set(
        overlappingMatches.flatMap((match) =>
          [...match.teamA, ...match.teamB].map((player) => player.id),
        ),
      )
      return {
        ...round,
        resting: activePlayers.filter((player) => !playingIds.has(player.id)),
      }
    }),
  }
}

const playerMatchWindows = (matches: Match[], playerId: string) =>
  matches
    .filter((match) =>
      [...match.teamA, ...match.teamB].some((player) => player.id === playerId),
    )
    .map(matchTimeWindow)
    .sort((left, right) => left.start - right.start)

const playerScheduledMatches = (matches: Match[], playerId: string) =>
  matches
    .filter((match) =>
      [...match.teamA, ...match.teamB].some((player) => player.id === playerId),
    )
    .sort((left, right) =>
      matchTimeWindow(left).start - matchTimeWindow(right).start ||
      left.id.localeCompare(right.id),
    )

const playerWaitGaps = (matches: Match[], playerId: string) => {
  const windows = playerMatchWindows(matches, playerId)
  const gaps: number[] = []
  for (let index = 1; index < windows.length; index += 1) {
    gaps.push(Math.max(0, windows[index].start - windows[index - 1].end))
  }
  return gaps
}

const scheduleEndMinutes = (matches: Match[]) => Math.max(
  0,
  ...matches.map((match) => matchTimeWindow(match).end),
)

const playerCompleteWaitGaps = (
  matches: Match[],
  playerId: string,
  endMinutes: number,
) => {
  const windows = playerMatchWindows(matches, playerId)
  if (windows.length === 0) return [Math.max(0, endMinutes)]
  return [
    Math.max(0, windows[0].start),
    ...playerWaitGaps(matches, playerId),
    Math.max(0, endMinutes - windows[windows.length - 1].end),
  ]
}

const playerMaximumWaitMinutes = (
  matches: Match[],
  playerId: string,
  endMinutes = scheduleEndMinutes(matches),
) => Math.max(0, ...playerCompleteWaitGaps(matches, playerId, endMinutes))

const playerWaitAnalysisEndMinutes = (
  player: Player,
  matches: Match[],
  bookingMinutes: number,
  settings?: MatchSettings,
) => {
  if (!player.isGuest) return bookingMinutes
  const continuousSpecialWindow = Boolean(
    settings?.specialLimitEnabled &&
    settings.specialScheduleMode !== 'spread' &&
    settings.specialTimeLimitEnabled,
  )
  if (!continuousSpecialWindow) return bookingMinutes
  const windows = playerMatchWindows(matches, player.id)
  return windows.length > 0 ? windows[windows.length - 1].end : 0
}

export const getScheduleMaximumWaitMinutes = (
  schedule: Schedule,
  players: Player[],
  endMinutes?: number,
) => {
  const matches = schedule.rounds.flatMap((round) => round.matches)
  const effectiveEndMinutes = endMinutes ?? scheduleEndMinutes(matches)
  return Math.max(
    0,
    ...players
      .filter((player) => player.active)
      .map((player) =>
        playerMaximumWaitMinutes(matches, player.id, effectiveEndMinutes),
      ),
  )
}

export type ScheduleWaitAnalysis = {
  maximumWaitMinutes: number
  maximumInitialWaitMinutes: number
  maximumBetweenWaitMinutes: number
  maximumFinalIdleMinutes: number
  zeroGameParticipantCount: number
  exceedsLimit: boolean
  recommendedParticipantCount: number
  warning: string | null
}

export type ScheduleQualityAnalysis = {
  standardGameSpread: number
  effectiveGameSpread: number
  zeroGameStandardParticipants: number
  maximumInitialWaitMinutes: number
  genderCompositionReviewMatches: number
  genderImbalanceReviewMatches: number
  teamSkillWarningMatches: number
  teamSkillDangerMatches: number
  maximumTeamSkillGap: number
  individualSkillWarningMatches: number
  individualSkillDangerMatches: number
  maximumIndividualSkillSpread: number
  participantsOverWaitLimit: number
  maximumPartnerMeetings: number
  averageWaitMinutes: number
  maximumGroupMeetings: number
  repeatedGroupAssignments: number
  repeatedPartnerAssignments: number
  maximumOpponentMeetings: number
  repeatedOpponentAssignments: number
  preferredPartnerRequests: number
  preferredPartnerFulfilled: number
  preferredPartnerUnfulfilled: number
  earliestSkillWarningStartMinutes: number | null
  averageSkillWarningStartMinutes: number | null
}

export const analyzeScheduleWait = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
): ScheduleWaitAnalysis => {
  const activePlayers = players.filter((player) => player.active)
  const matches = schedule.rounds.flatMap((round) => round.matches)
  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
  )
  const windowsByPlayer = activePlayers.map((player) =>
    playerMatchWindows(matches, player.id),
  )
  const analysisEndByPlayer = new Map(
    activePlayers.map((player) => [
      player.id,
      playerWaitAnalysisEndMinutes(player, matches, bookingMinutes, settings),
    ]),
  )
  const zeroGameParticipantCount = windowsByPlayer.filter(
    (windows) => windows.length === 0,
  ).length
  const maximumInitialWaitMinutes = Math.max(
    0,
    ...activePlayers.map((player, index) =>
      windowsByPlayer[index][0]?.start ??
        (analysisEndByPlayer.get(player.id) ?? bookingMinutes),
    ),
  )
  const maximumFinalIdleMinutes = Math.max(
    0,
    ...activePlayers.map((player, index) => {
      const windows = windowsByPlayer[index]
      const analysisEndMinutes =
        analysisEndByPlayer.get(player.id) ?? bookingMinutes
      return windows.length > 0
        ? Math.max(0, analysisEndMinutes - windows[windows.length - 1].end)
        : analysisEndMinutes
    }),
  )
  const maximumBetweenWaitMinutes = Math.max(
    0,
    ...activePlayers.flatMap((player) => playerWaitGaps(matches, player.id)),
  )
  const maximumWaitMinutes = Math.max(
    0,
    ...activePlayers.map((player) =>
      playerMaximumWaitMinutes(
        matches,
        player.id,
        analysisEndByPlayer.get(player.id) ?? bookingMinutes,
      ),
    ),
  )
  const exceedsLimit = maximumWaitMinutes > WAIT_PRIORITY_MINUTES
  const normalGameMinutes = [10, 12, 15].includes(settings.normalGameMinutes)
    ? settings.normalGameMinutes
    : GAME_SLOT_MINUTES
  const rotationRounds = Math.floor(WAIT_PRIORITY_MINUTES / normalGameMinutes) + 1
  const participantSlotsPerCourt = rotationRounds * 4
  const rotationWindowMinutes = rotationRounds * normalGameMinutes
  const repeatingGuestCount = activePlayers.filter(
    (player) =>
      player.isGuest && (schedule.guestGameCounts[player.id] ?? 0) > 1,
  ).length
  const guestAppearancesPerWindow = Math.max(
    1,
    Math.ceil(rotationWindowMinutes / GAME_SLOT_MINUTES),
  )
  const repeatedGuestSlots =
    repeatingGuestCount * Math.max(0, guestAppearancesPerWindow - 1)
  const capacityParticipantCount = Math.max(
    4,
    settings.courtCount * participantSlotsPerCourt - repeatedGuestSlots,
  )
  const waitRatioParticipantCount = exceedsLimit
    ? Math.max(
        4,
        Math.floor(
          activePlayers.length * WAIT_PRIORITY_MINUTES / maximumWaitMinutes,
        ),
      )
    : activePlayers.length
  const recommendedParticipantCount = exceedsLimit
    ? Math.min(capacityParticipantCount, waitRatioParticipantCount)
    : capacityParticipantCount
  const warning = zeroGameParticipantCount > 0
    ? `0경기 참가자 ${zeroGameParticipantCount}명 · 대진을 다시 생성해 주세요.`
    : exceedsLimit
      ? `최장 대기 ${maximumWaitMinutes}분 · 권장 참가 ${recommendedParticipantCount}명 이하`
    : null

  return {
    maximumWaitMinutes,
    maximumInitialWaitMinutes,
    maximumBetweenWaitMinutes,
    maximumFinalIdleMinutes,
    zeroGameParticipantCount,
    exceedsLimit,
    recommendedParticipantCount,
    warning,
  }
}

export const analyzeParticipantWaitLimitViolations = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
): WaitLimitParticipantViolation[] => {
  const matches = schedule.rounds.flatMap((round) => round.matches)
  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
  )
  const violations: WaitLimitParticipantViolation[] = []

  for (const player of players.filter((candidate) => candidate.active)) {
    const scheduledMatches = playerScheduledMatches(matches, player.id)
    const analysisEndMinutes = playerWaitAnalysisEndMinutes(
      player,
      matches,
      bookingMinutes,
      settings,
    )
    if (scheduledMatches.length === 0) {
      if (analysisEndMinutes > WAIT_PRIORITY_MINUTES) {
        violations.push({
          playerId: player.id,
          waitMinutes: analysisEndMinutes,
          phase: 'unassigned',
        })
      }
      continue
    }

    const candidates: WaitLimitParticipantViolation[] = []
    const firstMatch = scheduledMatches[0]
    const initialWait = matchTimeWindow(firstMatch).start
    if (initialWait > WAIT_PRIORITY_MINUTES) {
      candidates.push({
        playerId: player.id,
        waitMinutes: initialWait,
        phase: 'initial',
        nextMatchId: firstMatch.id,
      })
    }
    for (let index = 1; index < scheduledMatches.length; index += 1) {
      const previousMatch = scheduledMatches[index - 1]
      const nextMatch = scheduledMatches[index]
      const waitMinutes = Math.max(
        0,
        matchTimeWindow(nextMatch).start - matchTimeWindow(previousMatch).end,
      )
      if (waitMinutes <= WAIT_PRIORITY_MINUTES) continue
      candidates.push({
        playerId: player.id,
        waitMinutes,
        phase: 'between',
        previousMatchId: previousMatch.id,
        nextMatchId: nextMatch.id,
      })
    }
    const lastMatch = scheduledMatches[scheduledMatches.length - 1]
    const finalWait = Math.max(
      0,
      analysisEndMinutes - matchTimeWindow(lastMatch).end,
    )
    if (finalWait > WAIT_PRIORITY_MINUTES) {
      candidates.push({
        playerId: player.id,
        waitMinutes: finalWait,
        phase: 'final',
        previousMatchId: lastMatch.id,
      })
    }
    const maximumViolation = candidates.sort(
      (left, right) => right.waitMinutes - left.waitMinutes,
    )[0]
    if (maximumViolation) violations.push(maximumViolation)
  }

  return violations.sort(
    (left, right) =>
      right.waitMinutes - left.waitMinutes ||
      left.playerId.localeCompare(right.playerId),
  )
}

const countValues = (values: string[]) => {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.values()]
}

const repeatedAssignments = (counts: number[]) =>
  counts.reduce((sum, count) => sum + Math.max(0, count - 1), 0)

const qualityPairKey = (left: string, right: string) =>
  [left, right].sort().join('__')

const teamSkillRange = (team: Team) => {
  const fixedScore = team
    .filter((player) => player.level !== 'O')
    .reduce((sum, player) => sum + getPlayerMatchScore(player), 0)
  const openLevelCount = team.filter((player) => player.level === 'O').length
  return {
    minimum: fixedScore + openLevelCount * OPEN_LEVEL_MIN_SCORE,
    maximum: fixedScore + openLevelCount * OPEN_LEVEL_MAX_SCORE,
  }
}

const adaptiveTeamSkillGap = (teamA: Team, teamB: Team) => {
  const left = teamSkillRange(teamA)
  const right = teamSkillRange(teamB)
  if (left.maximum < right.minimum) return right.minimum - left.maximum
  if (right.maximum < left.minimum) return left.minimum - right.maximum
  return 0
}

const matchTeamSkillGap = (match: Match) =>
  adaptiveTeamSkillGap(match.teamA, match.teamB)

export const getMatchIndividualSkillSpread = (match: Match) => {
  if (match.isSpecial) return 0
  const fixedScores = [...match.teamA, ...match.teamB]
    .filter((player) => player.level !== 'O')
    .map(getPlayerMatchScore)
  if (fixedScores.length <= 1) return 0
  return Math.max(...fixedScores) - Math.min(...fixedScores)
}

const matchOverallSkillGap = (match: Match) =>
  Math.max(matchTeamSkillGap(match), getMatchIndividualSkillSpread(match))

export type MatchGenderCompositionReview = {
  maleCount: number
  femaleCount: number
  label: string
}

export const getMatchGenderCompositionReview = (
  match: Match,
): MatchGenderCompositionReview | null => {
  if (match.isSpecial) return null
  const players = [...match.teamA, ...match.teamB]
  if (players.length !== 4 || players.some((player) => player.gender === 'none')) {
    return null
  }

  const maleCount = players.filter((player) => player.gender === 'male').length
  const femaleCount = players.filter((player) => player.gender === 'female').length
  const label = femaleCount === 1 && maleCount === 3
    ? '여1·남3'
    : femaleCount === 3 && maleCount === 1
      ? '남1·여3'
      : femaleCount === 2 && maleCount === 2
        ? '남2·여2'
        : ''

  return label ? { maleCount, femaleCount, label } : null
}

export const isMatchGenderImbalanceReview = (match: Match) => {
  const review = getMatchGenderCompositionReview(match)
  return review !== null && Math.min(review.maleCount, review.femaleCount) === 1
}

export type MatchSkillWarningLevel = 'none' | 'caution' | 'danger'

export const getMatchSkillWarningLevel = (
  match: Match,
): MatchSkillWarningLevel => {
  if (match.isSpecial) return 'none'
  const gap = matchOverallSkillGap(match)
  if (gap > TEAM_SKILL_WARNING_GAP) return 'danger'
  if (gap >= TEAM_SKILL_PREFERRED_GAP) return 'caution'
  return 'none'
}

export const analyzeScheduleQuality = (
  schedule: Schedule,
  players: Player[],
  settings?: MatchSettings,
): ScheduleQualityAnalysis => {
  const matches = schedule.rounds.flatMap((round) => round.matches)
  const activePlayers = players.filter((player) => player.active)
  const regulars = activePlayers.filter((player) => !player.isGuest)
  const gameCounts = new Map(
    regulars.map((player) => [
      player.id,
      matches.filter((match) =>
        [...match.teamA, ...match.teamB].some(
          (matchPlayer) => matchPlayer.id === player.id,
        ),
      ).length,
    ]),
  )
  const standardCounts = regulars
    .filter((player) => !player.gameCountFlexible)
    .map((player) => gameCounts.get(player.id) ?? 0)
  const effectiveCounts = regulars.map(
    (player) =>
      (gameCounts.get(player.id) ?? 0) + (player.gameCountFlexible ? 1 : 0),
  )
  const spread = (counts: number[]) =>
    counts.length > 0 ? Math.max(...counts) - Math.min(...counts) : 0
  const teamSkillGaps = matches
    .filter((match) => !match.isSpecial)
    .map(matchOverallSkillGap)
  const genderCompositionReviewMatches = matches.filter(
    (match) => getMatchGenderCompositionReview(match) !== null,
  ).length
  const genderImbalanceReviewMatches = matches.filter(
    isMatchGenderImbalanceReview,
  ).length
  const individualSkillSpreads = matches
    .filter((match) => !match.isSpecial)
    .map(getMatchIndividualSkillSpread)
  const skillWarningStarts = matches
    .filter(
      (match) =>
        !match.isSpecial &&
        matchOverallSkillGap(match) >= TEAM_SKILL_PREFERRED_GAP,
    )
    .map((match) => match.startOffsetMinutes ?? 0)
  const analysisEndMinutes = settings
    ? getBookingDurationMinutes(settings.startTime, settings.endTime)
    : scheduleEndMinutes(matches)
  const analysisEndByPlayer = new Map(
    activePlayers.map((player) => [
      player.id,
      playerWaitAnalysisEndMinutes(
        player,
        matches,
        analysisEndMinutes,
        settings,
      ),
    ]),
  )
  const waitsByPlayer = activePlayers.map((player) =>
    playerCompleteWaitGaps(
      matches,
      player.id,
      analysisEndByPlayer.get(player.id) ?? analysisEndMinutes,
    ),
  )
  const windowsByPlayer = activePlayers.map((player) =>
    playerMatchWindows(matches, player.id),
  )
  const participantAverageWaits = waitsByPlayer
    .filter((gaps) => gaps.length > 0)
    .map((gaps) => gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length)
  const partnerCounts = countValues(
    matches.flatMap((match) => [
      [match.teamA[0].id, match.teamA[1].id].sort().join('__'),
      [match.teamB[0].id, match.teamB[1].id].sort().join('__'),
    ]),
  )
  const opponentCounts = countValues(
    matches.flatMap((match) =>
      match.teamA.flatMap((left) =>
        match.teamB.map((right) => [left.id, right.id].sort().join('__')),
      ),
    ),
  )
  const groupCounts = countValues(
    matches.map((match) =>
      [...match.teamA, ...match.teamB]
        .map((player) => player.id)
        .sort()
        .join('__'),
    ),
  )
  const activeRegularIds = new Set(regulars.map((player) => player.id))
  const preferredPartnerKeys = new Set(
    regulars.flatMap((player) =>
      (player.preferredPartnerIds ?? [])
        .filter(
          (preferredId) =>
            preferredId !== player.id && activeRegularIds.has(preferredId),
        )
        .map((preferredId) => qualityPairKey(player.id, preferredId)),
    ),
  )
  const scheduledPartnerKeys = new Set(
    matches.flatMap((match) => [
      qualityPairKey(match.teamA[0].id, match.teamA[1].id),
      qualityPairKey(match.teamB[0].id, match.teamB[1].id),
    ]),
  )
  const preferredPartnerFulfilled = [...preferredPartnerKeys].filter((key) =>
    scheduledPartnerKeys.has(key),
  ).length

  return {
    standardGameSpread: spread(standardCounts),
    effectiveGameSpread: spread(effectiveCounts),
    zeroGameStandardParticipants: standardCounts.filter((count) => count === 0).length,
    maximumInitialWaitMinutes: Math.max(
      0,
      ...activePlayers.map(
        (player, index) => windowsByPlayer[index][0]?.start ??
          (analysisEndByPlayer.get(player.id) ?? analysisEndMinutes),
      ),
    ),
    genderCompositionReviewMatches,
    genderImbalanceReviewMatches,
    teamSkillWarningMatches: teamSkillGaps.filter(
      (gap) => gap >= TEAM_SKILL_PREFERRED_GAP,
    ).length,
    teamSkillDangerMatches: teamSkillGaps.filter(
      (gap) => gap > TEAM_SKILL_WARNING_GAP,
    ).length,
    maximumTeamSkillGap: Math.max(0, ...teamSkillGaps),
    individualSkillWarningMatches: individualSkillSpreads.filter(
      (spread) => spread >= TEAM_SKILL_PREFERRED_GAP,
    ).length,
    individualSkillDangerMatches: individualSkillSpreads.filter(
      (spread) => spread > TEAM_SKILL_WARNING_GAP,
    ).length,
    maximumIndividualSkillSpread: Math.max(0, ...individualSkillSpreads),
    participantsOverWaitLimit: activePlayers.filter(
      (player) =>
        playerMaximumWaitMinutes(
          matches,
          player.id,
          analysisEndByPlayer.get(player.id) ?? analysisEndMinutes,
        ) >
          WAIT_PRIORITY_MINUTES,
    ).length,
    maximumPartnerMeetings: Math.max(0, ...partnerCounts),
    averageWaitMinutes: participantAverageWaits.length > 0
      ? participantAverageWaits.reduce((sum, wait) => sum + wait, 0) /
        participantAverageWaits.length
      : 0,
    maximumGroupMeetings: Math.max(0, ...groupCounts),
    repeatedGroupAssignments: repeatedAssignments(groupCounts),
    repeatedPartnerAssignments: repeatedAssignments(partnerCounts),
    maximumOpponentMeetings: Math.max(0, ...opponentCounts),
    repeatedOpponentAssignments: repeatedAssignments(opponentCounts),
    preferredPartnerRequests: preferredPartnerKeys.size,
    preferredPartnerFulfilled,
    preferredPartnerUnfulfilled:
      preferredPartnerKeys.size - preferredPartnerFulfilled,
    earliestSkillWarningStartMinutes: skillWarningStarts.length > 0
      ? Math.min(...skillWarningStarts)
      : null,
    averageSkillWarningStartMinutes: skillWarningStarts.length > 0
      ? skillWarningStarts.reduce((sum, start) => sum + start, 0) /
        skillWarningStarts.length
      : null,
  }
}

type ScheduleOverlap = {
  playerId: string
  matchIds: [string, string]
}

const findScheduleOverlapDetail = (schedule: Schedule): ScheduleOverlap | null => {
  const matches = schedule.rounds.flatMap((round) => round.matches)
  for (const match of matches) {
    const ids = [...match.teamA, ...match.teamB].map((player) => player.id)
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
    if (duplicate) {
      return { playerId: duplicate, matchIds: [match.id, match.id] }
    }
  }
  for (let left = 0; left < matches.length; left += 1) {
    for (let right = left + 1; right < matches.length; right += 1) {
      if (!windowsOverlap(matches[left], matches[right])) continue
      const rightIds = new Set(
        [...matches[right].teamA, ...matches[right].teamB].map((player) => player.id),
      )
      const duplicate = [...matches[left].teamA, ...matches[left].teamB]
        .find((player) => rightIds.has(player.id))
      if (duplicate) {
        return {
          playerId: duplicate.id,
          matchIds: [matches[left].id, matches[right].id],
        }
      }
    }
  }
  return null
}

export const applyMeetingLineups = (
  schedule: Schedule,
  players: Player[],
  lineups: MeetingLineupsByMatch,
): Schedule => {
  const refreshMetadata = (currentSchedule: Schedule): Schedule => {
    const scheduleWithResting = refreshScheduleRestingPlayers(
      currentSchedule,
      players,
    )
    const matches = scheduleWithResting.rounds.flatMap((round) => round.matches)
    const activeGuestIds = players
      .filter((player) => player.active && player.isGuest)
      .map((player) => player.id)
    const guestGameCounts = Object.fromEntries(
      activeGuestIds.map((guestId) => [
        guestId,
        matches.filter((match) =>
          [...match.teamA, ...match.teamB].some(
            (player) => player.id === guestId,
          ),
        ).length,
      ]),
    )
    const specialCompletedIds = Array.from(new Set(
      matches
        .filter((match) => match.isSpecial)
        .flatMap((match) => [...match.teamA, ...match.teamB])
        .filter((player) => !player.isGuest)
        .map((player) => player.id),
    ))
    return {
      ...scheduleWithResting,
      specialCompletedIds,
      guestGameCounts,
    }
  }
  const playersById = new Map(
    players.filter((player) => player.active).map((player) => [player.id, player]),
  )
  const activeLineupIds = new Set(Object.keys(lineups))
  const applyActiveLineups = (): Schedule => ({
    ...schedule,
    rounds: schedule.rounds.map((round) => ({
      ...round,
      matches: round.matches.map((match) => {
        const lineup = activeLineupIds.has(match.id) ? lineups[match.id] : undefined
        if (!lineup) return match
        const teamA = lineup.teamAPlayerIds.map((id) => playersById.get(id)).filter(Boolean)
        const teamB = lineup.teamBPlayerIds.map((id) => playersById.get(id)).filter(Boolean)
        return teamA.length === 2 && teamB.length === 2
          ? { ...match, teamA: teamA as Team, teamB: teamB as Team }
          : match
      }),
    })),
  })

  while (activeLineupIds.size > 0) {
    const nextSchedule = applyActiveLineups()
    const overlap = findScheduleOverlapDetail(nextSchedule)
    if (!overlap) return refreshMetadata(nextSchedule)
    const invalidLineupIds = overlap.matchIds.filter((matchId) =>
      activeLineupIds.has(matchId),
    )
    if (invalidLineupIds.length === 0) return refreshMetadata(schedule)
    for (const matchId of invalidLineupIds) activeLineupIds.delete(matchId)
  }

  return refreshMetadata(schedule)
}

export const findScheduleOverlap = (schedule: Schedule): string | null =>
  findScheduleOverlapDetail(schedule)?.playerId ?? null

export const validateMeetingSchedule = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
): string[] => {
  const issues = new Set<string>()
  const matches = schedule.rounds.flatMap((round) => round.matches)
  const activeIds = new Set(
    players.filter((player) => player.active).map((player) => player.id),
  )

  if (findScheduleOverlapDetail(schedule)) issues.add('참가자 동시간 중복')

  for (const match of matches) {
    const matchPlayers = [...match.teamA, ...match.teamB]
    if (
      matchPlayers.length !== 4 ||
      new Set(matchPlayers.map((player) => player.id)).size !== 4
    ) {
      issues.add('경기 인원 구성 오류')
    }
    if (matchPlayers.some((player) => !activeIds.has(player.id))) {
      issues.add('비활성 참가자 배정')
    }
    if (match.court < 1 || match.court > settings.courtCount) {
      issues.add('코트 번호 오류')
    }
    if (
      settings.singleGuestPerMatch &&
      matchPlayers.filter((player) => player.isGuest).length > 1
    ) {
      issues.add('스페셜 인원 제한 위반')
    }
  }

  for (let left = 0; left < matches.length; left += 1) {
    for (let right = left + 1; right < matches.length; right += 1) {
      if (
        matches[left].court === matches[right].court &&
        windowsOverlap(matches[left], matches[right])
      ) {
        issues.add('코트 시간 중복')
      }
    }
  }

  const gameCountByPlayer = new Map(
    players
      .filter((player) => player.active && !player.isGuest)
      .map((player) => [
        player.id,
        matches.filter((match) =>
          [...match.teamA, ...match.teamB].some(
            (matchPlayer) => matchPlayer.id === player.id,
          ),
        ).length,
      ]),
  )
  const standardGameCounts = players
    .filter(
      (player) =>
        player.active && !player.isGuest && !player.gameCountFlexible,
    )
    .map((player) => gameCountByPlayer.get(player.id) ?? 0)
  if (standardGameCounts.length > 0) {
    const standardMinimumGames = Math.min(...standardGameCounts)
    const excessiveSacrifice = players.some(
      (player) =>
        player.active &&
        !player.isGuest &&
        player.gameCountFlexible &&
        (gameCountByPlayer.get(player.id) ?? 0) < standardMinimumGames - 1,
    )
    if (excessiveSacrifice) issues.add('경기 수 양보 1경기 초과')
  }

  return [...issues]
}

export const validateMeetingFairness = (
  schedule: Schedule,
  players: Player[],
): string[] => {
  const matches = schedule.rounds.flatMap((round) => round.matches)
  const gameCountByPlayer = new Map(
    players
      .filter((player) => player.active && !player.isGuest)
      .map((player) => [
        player.id,
        matches.filter((match) =>
          [...match.teamA, ...match.teamB].some(
            (matchPlayer) => matchPlayer.id === player.id,
          ),
        ).length,
      ]),
  )
  const zeroGameCount = [...gameCountByPlayer.values()].filter(
    (count) => count === 0,
  ).length
  const standardCounts = players
    .filter(
      (player) =>
        player.active && !player.isGuest && !player.gameCountFlexible,
    )
    .map((player) => gameCountByPlayer.get(player.id) ?? 0)
  const standardSpread = standardCounts.length > 0
    ? Math.max(...standardCounts) - Math.min(...standardCounts)
    : 0
  const issues: string[] = []
  if (zeroGameCount > 0) issues.push(`0경기 일반 참가자 ${zeroGameCount}명`)
  if (standardSpread > 1) {
    issues.push(`일반 참가자 경기 수 차 ${standardSpread}경기`)
  }
  return issues
}

export const swapMeetingPlayers = (
  schedule: Schedule,
  matchId: string,
  outgoingId: string,
  incomingId: string,
): { schedule: Schedule; changedMatchIds: string[] } | null => {
  if (outgoingId === incomingId) return { schedule, changedMatchIds: [] }
  const matches = schedule.rounds.flatMap((round) => round.matches)
  const sourceMatch = matches.find((match) => match.id === matchId)
  const outgoing = sourceMatch && [...sourceMatch.teamA, ...sourceMatch.teamB]
    .find((player) => player.id === outgoingId)
  const schedulePlayers = Array.from(new Map(
    schedule.rounds
      .flatMap((round) => [
        ...round.resting,
        ...round.matches.flatMap((match) => [...match.teamA, ...match.teamB]),
      ])
      .map((player) => [player.id, player]),
  ).values())
  const incoming = schedulePlayers.find((player) => player.id === incomingId)
  if (!sourceMatch || !outgoing || !incoming) return null

  const targetMatch = findMeetingPlayerTimeConflict(
    schedule,
    sourceMatch.id,
    incomingId,
  )
  const changedMatchIds = [sourceMatch.id]
  const nextSchedule = refreshScheduleRestingPlayers({
    ...schedule,
    rounds: schedule.rounds.map((round) => ({
      ...round,
      matches: round.matches.map((match) => {
        if (match.id === sourceMatch.id) {
          return replaceMatchPlayer(match, outgoingId, incoming)
        }
        if (targetMatch && match.id === targetMatch.id) {
          changedMatchIds.push(match.id)
          return replaceMatchPlayer(match, incomingId, outgoing)
        }
        return match
      }),
    })),
  }, schedulePlayers)
  return findScheduleOverlap(nextSchedule) ? null : { schedule: nextSchedule, changedMatchIds }
}

export type MeetingSwapRecommendation = {
  player: Player
  changedMatchIds: string[]
  reasons: string[]
  swapType: 'waiting-replacement' | 'simultaneous-swap'
  conflictMatchId?: string
  conflictCourt?: number
}

type ScoredMeetingSwapRecommendation = MeetingSwapRecommendation & {
  score: number[]
}

const compareRecommendationScores = (left: number[], right: number[]) => {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export const rankMeetingSwapCandidates = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
  matchId: string,
  outgoingId: string,
): MeetingSwapRecommendation[] => {
  const matches = schedule.rounds.flatMap((round) => round.matches)
  const sourceMatch = matches.find((match) => match.id === matchId)
  const outgoing = sourceMatch && [...sourceMatch.teamA, ...sourceMatch.teamB]
    .find((player) => player.id === outgoingId)
  if (!sourceMatch || !outgoing) return []

  const sourcePlayerIds = new Set(
    [...sourceMatch.teamA, ...sourceMatch.teamB].map((player) => player.id),
  )
  const baseQuality = analyzeScheduleQuality(schedule, players, settings)
  const baseWait = analyzeScheduleWait(schedule, players, settings)
  const baseValidationIssues = new Set(
    validateMeetingSchedule(schedule, players, settings),
  )

  const recommendations = players
    .filter(
      (candidate) =>
        candidate.active &&
        candidate.id !== outgoing.id &&
        !sourcePlayerIds.has(candidate.id) &&
        candidate.isGuest === outgoing.isGuest,
    )
    .flatMap((candidate): ScoredMeetingSwapRecommendation[] => {
      const conflictMatch = findMeetingPlayerTimeConflict(
        schedule,
        sourceMatch.id,
        candidate.id,
      )
      const swapped = swapMeetingPlayers(
        schedule,
        sourceMatch.id,
        outgoing.id,
        candidate.id,
      )
      if (!swapped) {
        return []
      }
      const introducedValidationIssues = validateMeetingSchedule(
        swapped.schedule,
        players,
        settings,
      ).filter((issue) => !baseValidationIssues.has(issue))
      if (introducedValidationIssues.length > 0) {
        return []
      }

      const quality = analyzeScheduleQuality(swapped.schedule, players, settings)
      const wait = analyzeScheduleWait(swapped.schedule, players, settings)
      if (
        quality.standardGameSpread > Math.max(1, baseQuality.standardGameSpread) ||
        quality.participantsOverWaitLimit > baseQuality.participantsOverWaitLimit ||
        quality.teamSkillDangerMatches > baseQuality.teamSkillDangerMatches ||
        quality.maximumGroupMeetings > Math.max(
          MAX_GROUP_MEETINGS,
          baseQuality.maximumGroupMeetings,
        )
      ) {
        return []
      }
      const changedMatches = swapped.schedule.rounds
        .flatMap((round) => round.matches)
        .filter((match) => swapped.changedMatchIds.includes(match.id))
      const changedWarnings = changedMatches.filter(
        (match) => getMatchSkillWarningLevel(match) !== 'none',
      ).length
      const changedDangers = changedMatches.filter(
        (match) => getMatchSkillWarningLevel(match) === 'danger',
      ).length
      const changedMaximumSkillGap = Math.max(
        0,
        ...changedMatches.map(matchTeamSkillGap),
      )
      const reasons: string[] = []

      reasons.push(conflictMatch ? '동시간 맞교환' : '해당 시간 대기')

      if (
        quality.teamSkillDangerMatches < baseQuality.teamSkillDangerMatches ||
        quality.teamSkillWarningMatches < baseQuality.teamSkillWarningMatches
      ) {
        reasons.push('실력 균형 개선')
      } else if (changedWarnings === 0) {
        reasons.push('실력 균형 적합')
      }
      if (quality.standardGameSpread < baseQuality.standardGameSpread) {
        reasons.push('경기 수 균형 개선')
      } else if (swapped.changedMatchIds.length > 1) {
        reasons.push('경기 수 유지')
      }
      if (
        quality.repeatedGroupAssignments < baseQuality.repeatedGroupAssignments ||
        quality.repeatedPartnerAssignments < baseQuality.repeatedPartnerAssignments
      ) {
        reasons.push('반복 조합 감소')
      }
      if (quality.preferredPartnerUnfulfilled < baseQuality.preferredPartnerUnfulfilled) {
        reasons.push('선호 파트너 반영')
      }
      if (wait.maximumWaitMinutes < baseWait.maximumWaitMinutes) {
        reasons.push('대기 균형 개선')
      }
      if (reasons.length === 1) reasons.push('필수 조건 유지')

      return [{
        player: candidate,
        changedMatchIds: swapped.changedMatchIds,
        reasons: reasons.slice(0, 2),
        swapType: conflictMatch ? 'simultaneous-swap' : 'waiting-replacement',
        conflictMatchId: conflictMatch?.id,
        conflictCourt: conflictMatch?.court,
        score: [
          Number(wait.exceedsLimit),
          quality.participantsOverWaitLimit,
          Math.max(0, quality.standardGameSpread - 1),
          quality.teamSkillDangerMatches,
          quality.teamSkillWarningMatches,
          changedDangers,
          changedWarnings,
          changedMaximumSkillGap,
          Math.max(0, quality.maximumGroupMeetings - MAX_GROUP_MEETINGS),
          quality.repeatedGroupAssignments,
          quality.maximumPartnerMeetings,
          quality.repeatedPartnerAssignments,
          quality.maximumOpponentMeetings,
          quality.repeatedOpponentAssignments,
          quality.preferredPartnerUnfulfilled,
          wait.maximumWaitMinutes,
          quality.averageWaitMinutes,
        ],
      }]
    })

  return recommendations
    .sort((left, right) =>
      compareRecommendationScores(left.score, right.score) ||
      left.player.name.localeCompare(right.player.name, 'ko'),
    )
    .map(({ score: _score, ...recommendation }) => recommendation)
}

type SpecialAllocationSegment = 'low' | 'random' | 'high'

const matchConditions = (settings: MatchSettings): MatchConditionOptions => {
  const conditions = {
    ...defaultMatchConditionOptions,
    ...(settings.conditionOptions ?? {}),
    fairGames: true,
    waitPriority: true,
  }
  if (conditions.strictSkillLimit) conditions.levelBalance = true
  return conditions
}

const pairKey = (a: string, b: string) => [a, b].sort().join('__')

const preferredPartnerStrength = (left: Player, right: Player) =>
  Number((left.preferredPartnerIds ?? []).includes(right.id)) +
  Number((right.preferredPartnerIds ?? []).includes(left.id))

const preferredPartnerBonus = (
  team: Team,
  history: HistoryState,
) => {
  const [left, right] = team
  const strength = preferredPartnerStrength(left, right)
  if (strength === 0) return 0
  const previousGames = history.partners[pairKey(left.id, right.id)] ?? 0
  if (previousGames >= MAX_PREFERRED_PARTNER_GAMES) return 0
  const baseBonus = previousGames === 0
    ? PREFERRED_PARTNER_FIRST_GAME_BONUS
    : PREFERRED_PARTNER_SECOND_GAME_BONUS
  return baseBonus * (strength === 2 ? 1.25 : 1)
}

const groupKey = (players: Player[]) =>
  players.map((player) => player.id).sort().join('__')

const makeRandom = (seed: number) => {
  let value = seed || 1
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

const emptyCounts = (players: Player[]) =>
  Object.fromEntries(players.map((player) => [player.id, 0]))

const makeHistory = (
  players: Player[],
  plannedSpecialIds: Set<string> = new Set<string>(),
): HistoryState => ({
  games: emptyCounts(players),
  rests: emptyCounts(players),
  restStreaks: emptyCounts(players),
  playStreaks: emptyCounts(players),
  partners: {},
  opponents: {},
  groups: {},
  lastMatchEnd: {},
  currentStartOffset: 0,
  plannedSpecialIds,
  specialCompleted: new Set<string>(),
  specialGameCounts: emptyCounts(players),
  guestGameCounts: Object.fromEntries(
    players.filter((player) => player.isGuest).map((player) => [player.id, 0]),
  ),
  skillWarningMatches: 0,
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

const usesContinuousSpecialWindow = (settings: MatchSettings) =>
  settings.specialScheduleMode !== 'spread' &&
  settings.specialTimeLimitEnabled

const configuredSpecialParticipantTarget = (settings: MatchSettings) => {
  const numeric = Math.floor(Number(settings.specialParticipantTarget) || 0)
  return Math.max(3, Math.floor(numeric / 3) * 3)
}

const specialParticipantCoverageTarget = (
  activePlayers: Player[],
  settings: MatchSettings,
) => {
  const eligibleCount = activePlayers.filter(
    (player) =>
      !player.isGuest &&
      (player.specialMatchEligible ?? true),
  ).length
  return settings.specialLimitEnabled
    ? Math.min(eligibleCount, configuredSpecialParticipantTarget(settings))
    : eligibleCount
}

const hasReachedSpecialParticipantTarget = (
  activePlayers: Player[],
  history: HistoryState,
  settings: MatchSettings,
) => history.specialCompleted.size >=
  specialParticipantCoverageTarget(activePlayers, settings)

const remainingSpecialParticipantTarget = (
  activePlayers: Player[],
  history: HistoryState,
  settings: MatchSettings,
) => Math.max(
  0,
  specialParticipantCoverageTarget(activePlayers, settings) -
    history.specialCompleted.size,
)

const specialParticipantTargetRequiresCap = (
  activePlayers: Player[],
  settings: MatchSettings,
) => {
  if (!settings.specialLimitEnabled) return false
  const maximumParticipantCapacity = activePlayers
    .filter((player) => player.isGuest)
    .reduce(
      (sum, guest) =>
        sum + specialPlannedGameTarget(guest, activePlayers, settings) * 3,
      0,
    )
  return configuredSpecialParticipantTarget(settings) <
    maximumParticipantCapacity
}

const specialLimitGameTarget = (settings: MatchSettings) => {
  const limits: number[] = []
  if (settings.specialGameLimitEnabled) {
    limits.push(Math.max(1, Math.floor(settings.specialGameLimit)))
  }
  if (
    usesContinuousSpecialWindow(settings) &&
    settings.specialTimeLimitEnabled
  ) {
    limits.push(
      Math.max(1, Math.floor(settings.specialTimeLimitMinutes / GAME_SLOT_MINUTES)),
    )
  }
  return limits.length > 0 ? Math.min(...limits) : Number.POSITIVE_INFINITY
}

const specialPlannedGameTarget = (
  guest: Player,
  activePlayers: Player[],
  settings: MatchSettings,
) => {
  if (settings.specialLimitEnabled) {
    const limitedTarget = specialLimitGameTarget(settings)
    return Number.isFinite(limitedTarget)
      ? limitedTarget
      : getBookingRoundCount(settings.startTime, settings.endTime)
  }

  const eligibleCount = activePlayers.filter(
    (player) =>
      !player.isGuest &&
      (player.specialMatchEligible ?? true),
  ).length
  const guestCount = Math.max(
    1,
    activePlayers.filter((player) => player.isGuest).length,
  )
  const coverageTarget = Math.max(1, Math.ceil(eligibleCount / 3 / guestCount))
  const configuredTarget = Math.max(0, Math.floor(guest.guestGameLimit || 0))
  return Math.max(coverageTarget, configuredTarget)
}

const specialAllocationCounts = (
  targetGames: number,
  settings: MatchSettings,
) => {
  const target = Math.max(1, Math.floor(targetGames))
  const lowPercent = settings.specialLowPriorityEnabled
    ? settings.specialLowPriorityPercent
    : 0
  const highPercent = settings.specialHighPriorityEnabled
    ? Math.min(settings.specialHighPriorityPercent, 100 - lowPercent)
    : 0
  const randomPercent = Math.max(0, 100 - lowPercent - highPercent)
  const shares = [
    { key: 'low' as const, exact: target * lowPercent / 100 },
    { key: 'random' as const, exact: target * randomPercent / 100 },
    { key: 'high' as const, exact: target * highPercent / 100 },
  ]
  const counts = Object.fromEntries(
    shares.map(({ key, exact }) => [key, Math.floor(exact)]),
  ) as Record<SpecialAllocationSegment, number>
  let remaining = target - Object.values(counts).reduce((sum, count) => sum + count, 0)

  for (const share of [...shares].sort((left, right) => {
    const remainderDiff =
      (right.exact - Math.floor(right.exact)) -
      (left.exact - Math.floor(left.exact))
    if (remainderDiff !== 0) return remainderDiff
    return ['low', 'random', 'high'].indexOf(left.key) -
      ['low', 'random', 'high'].indexOf(right.key)
  })) {
    if (remaining <= 0) break
    counts[share.key] += 1
    remaining -= 1
  }

  const enabledShares = shares.filter((share) => share.exact > 0)
  if (target >= enabledShares.length) {
    for (const share of enabledShares) {
      if (counts[share.key] > 0) continue
      const donor = [...enabledShares]
        .filter((candidate) => counts[candidate.key] > 1)
        .sort(
          (left, right) =>
            counts[right.key] - counts[left.key] || right.exact - left.exact,
        )[0]
      if (!donor) continue
      counts[donor.key] -= 1
      counts[share.key] += 1
    }
  }

  return counts
}

const specialAllocationSegment = (
  guest: Player,
  activePlayers: Player[],
  history: HistoryState,
  settings: MatchSettings,
): SpecialAllocationSegment => {
  const counts = specialAllocationCounts(
    specialPlannedGameTarget(guest, activePlayers, settings),
    settings,
  )
  const gameIndex = history.guestGameCounts[guest.id] ?? 0
  if (gameIndex < counts.low) return 'low'
  if (gameIndex < counts.low + counts.random) return 'random'
  return 'high'
}

const guestWithinSpecialLimit = (
  guest: Player,
  history: HistoryState,
  settings: MatchSettings,
) => {
  if (!settings.specialLimitEnabled) return true
  const completedGames = history.guestGameCounts[guest.id] ?? 0
  if (
    settings.specialGameLimitEnabled &&
    completedGames >= settings.specialGameLimit
  ) {
    return false
  }
  if (
    usesContinuousSpecialWindow(settings) &&
    settings.specialTimeLimitEnabled &&
    history.currentStartOffset + GAME_SLOT_MINUTES >
      settings.specialTimeLimitMinutes
  ) {
    return false
  }
  if (settings.specialGameLimitEnabled) {
    const bookingMinutes = getBookingDurationMinutes(
      settings.startTime,
      settings.endTime,
    )
    const scheduledBookingMinutes =
      settings.roundCountLocked && settings.normalGameMinutes === GAME_SLOT_MINUTES
        ? Math.min(
            bookingMinutes,
            normalizeTargetRoundCount(settings.targetRoundCount) *
              GAME_SLOT_MINUTES,
          )
        : bookingMinutes
    const allocationMinutes =
      usesContinuousSpecialWindow(settings) && settings.specialTimeLimitEnabled
      ? Math.min(scheduledBookingMinutes, settings.specialTimeLimitMinutes)
      : scheduledBookingMinutes
    const targetGames = Math.min(
      Math.max(1, Math.floor(allocationMinutes / GAME_SLOT_MINUTES)),
      Math.max(1, Math.floor(settings.specialGameLimit)),
    )
    const nextGameNumber = completedGames + 1
    const idleMinutes = Math.max(
      0,
      allocationMinutes - targetGames * GAME_SLOT_MINUTES,
    )
    const plannedStart = Math.round(
      nextGameNumber * idleMinutes / (targetGames + 1) +
        (nextGameNumber - 1) * GAME_SLOT_MINUTES,
    )
    if (history.currentStartOffset < plannedStart) return false
  }
  return true
}

const specialGameCount = (player: Player, history: HistoryState) =>
  history.specialGameCounts[player.id] ?? 0

const hasGuest = (players: Player[]) => players.some((player) => player.isGuest)

export const getPlayerMatchTier = (
  player: Player,
  levelTiers: LevelTierTable = defaultLevelTiers,
) => {
  if (player.level === '스페셜' || player.level === 'OA' || player.level === 'O') {
    return 1
  }
  const ageGroup: MatchAgeGroup =
    player.ageGroup === '무관' ? '30대' : player.ageGroup
  const level = player.level as MatchLevel
  if (player.gender === 'male' || player.gender === 'female') {
    return levelTiers[ageGroup][player.gender][level]
  }
  return (
    levelTiers[ageGroup].male[level] + levelTiers[ageGroup].female[level]
  ) / 2
}

export const getPlayerMatchScore = (player: Player) => {
  if (player.level === '스페셜') return 108
  if (player.level === 'OA' || player.level === 'O') return 94
  const tier = player.matchLevelTier ?? getPlayerMatchTier(player)
  return 110 - tier * 10
}

const tournamentParticipantAsPlayer = (
  participant: TournamentParticipant,
  levelTiers: LevelTierTable = defaultLevelTiers,
): Player => ({
  id: participant.id,
  name: participant.name,
  level: participant.level,
  ageGroup: participant.ageGroup,
  gender: participant.gender,
  active: true,
  specialRequired: false,
  matchLevelTier: getPlayerMatchTier(
    {
      ...participant,
      active: true,
      specialRequired: false,
      isGuest: false,
      guestGameLimit: 0,
    },
    levelTiers,
  ),
  isGuest: false,
  guestGameLimit: 0,
})

const tournamentPlayerName = (player: Player, index: number) =>
  player.name.trim() || `${index + 1}번`

export const makeNumberedTournamentPlayers = (count: number): Player[] => {
  const normalizedCount = Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 0

  return Array.from({ length: normalizedCount }, (_, index) => ({
    id: `numbered-player-${index + 1}`,
    name: `${index + 1}번`,
    level: 'O',
    ageGroup: '무관',
    gender: 'none',
    active: true,
    specialRequired: true,
    isGuest: false,
    guestGameLimit: 0,
  }))
}

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
  E: 6,
  O: 7,
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
  levelTiers: LevelTierTable = defaultLevelTiers,
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
      matchLevelTier: getPlayerMatchTier(player, levelTiers),
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

const teamAge = (team: Team) =>
  teamComparableValue(team, ageValue)

const fixedPlayerScoreSpread = (players: Player[]) => {
  const scores = players
    .filter((player) => !isOpenLevel(player))
    .map((player) => getPlayerMatchScore(player))
  if (scores.length <= 1) return 0
  return Math.max(...scores) - Math.min(...scores)
}

const playerScoreSpread = (players: Player[]) =>
  fixedPlayerScoreSpread(players)

const openLevelWideGroupPenalty = (players: Player[]) => {
  const openLevelCount = players.filter(isOpenLevel).length
  if (openLevelCount === 0) return 0
  return fixedPlayerScoreSpread(players) >= TEAM_SKILL_PREFERRED_GAP
    ? openLevelCount * OPEN_LEVEL_WIDE_GROUP_WEIGHT
    : 0
}

const playerAgeSpread = (players: Player[]) => {
  const ages = players
    .filter((player) => player.ageGroup !== '무관')
    .map(ageValue)
  if (ages.length <= 1) return 0
  return Math.max(...ages) - Math.min(...ages)
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

const groupLevelCohesionPenalty = (players: Player[]) => {
  const groups = new Set(players.map(levelMatchGroup).filter(Boolean))
  return Math.max(0, groups.size - 1)
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

const isMixedRegularTeam = (players: Player[]) => {
  const counts = genderCounts(players)
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

const optimizedGenderCompositionPenalty = (players: Player[]) => {
  const counts = genderCounts(players)
  const genderedCount = counts.men + counts.women
  if (genderedCount !== 4 || counts.men === 0 || counts.women === 0) return 0

  return Math.min(counts.men, counts.women) === 2 ? 1 : 4
}

type GenderBatchPlan = {
  targetMen: number
  targetWomen: number
  selectedMen: number
  selectedWomen: number
  remainingMatches: number
}

const makeGenderBatchPlan = (
  players: Player[],
  maximumMatchCount: number,
): GenderBatchPlan | null => {
  const counts = genderCounts(players)
  const genderedCount = counts.men + counts.women
  const matchCount = Math.min(maximumMatchCount, Math.floor(genderedCount / 4))
  const capacity = matchCount * 4
  if (capacity === 0 || genderedCount !== players.length) return null

  const minimumWomen = Math.max(0, capacity - counts.men)
  const maximumWomen = Math.min(capacity, counts.women)
  const targetWomen = Array.from(
    { length: maximumWomen - minimumWomen + 1 },
    (_, index) => minimumWomen + index,
  ).sort((left, right) =>
    Number(left % 2 !== 0) - Number(right % 2 !== 0) ||
    Math.abs(left * genderedCount - capacity * counts.women) -
      Math.abs(right * genderedCount - capacity * counts.women),
  )[0]

  return {
    targetMen: capacity - targetWomen,
    targetWomen,
    selectedMen: 0,
    selectedWomen: 0,
    remainingMatches: matchCount,
  }
}

const genderBatchReachabilityPenalty = (
  players: Player[],
  plan: GenderBatchPlan | null,
) => {
  if (plan === null) return 0
  const counts = genderCounts(players)
  const nextMen = plan.selectedMen + counts.men
  const nextWomen = plan.selectedWomen + counts.women
  const remainingSeats = Math.max(0, plan.remainingMatches - 1) * 4

  return (
    Math.max(0, nextMen - plan.targetMen) +
    Math.max(0, nextWomen - plan.targetWomen) +
    Math.max(0, plan.targetMen - nextMen - remainingSeats) +
    Math.max(0, plan.targetWomen - nextWomen - remainingSeats)
  )
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

export const getMeetingPhaseWeights = (
  rawProgress: number,
  rawEarlyPhaseEndPercent = 30,
  rawMiddlePhaseEndPercent = 70,
) => {
  const progress = Math.min(1, Math.max(0, rawProgress))
  const earlyBoundary = Math.min(
    0.7,
    Math.max(0.15, rawEarlyPhaseEndPercent / 100),
  )
  const middleBoundary = Math.min(
    0.85,
    Math.max(earlyBoundary + 0.15, rawMiddlePhaseEndPercent / 100),
  )
  const middleCenter = (earlyBoundary + middleBoundary) / 2
  const warmupDiversity = progress < earlyBoundary
    ? 1 - progress / earlyBoundary
    : 0
  const middleIntensity = progress < earlyBoundary || progress > middleBoundary
    ? 0
    : progress <= middleCenter
      ? (progress - earlyBoundary) / (middleCenter - earlyBoundary)
      : (middleBoundary - progress) / (middleBoundary - middleCenter)
  const composition = progress < earlyBoundary
    ? 0.35 + progress / earlyBoundary * 0.65
    : progress <= middleBoundary
      ? 1 + middleIntensity * 10
      : Math.max(
          0.35,
          1 - (progress - middleBoundary) / (1 - middleBoundary) * 0.65,
        )
  return { warmupDiversity, middleIntensity, composition }
}

const getPacedMeetingPhaseWeights = (pacing: RoundPacing) =>
  getMeetingPhaseWeights(
    roundProgress(pacing),
    pacing.earlyPhaseEndPercent,
    pacing.middlePhaseEndPercent,
  )

const partnerLevelDiversity = (team: Team) => {
  if (team.some(isOpenLevel)) return 0
  return Math.abs(
    getPlayerMatchScore(team[0]) - getPlayerMatchScore(team[1]),
  )
}

const pairingTeamLevelGap = (pairing: Pick<Pairing, 'teamA' | 'teamB'>) =>
  adaptiveTeamSkillGap(pairing.teamA, pairing.teamB)

const isProtectedLowLevel = (player: Player) =>
  !player.isGuest && (player.level === 'D' || player.level === 'E')

const pairingLowLevelSupportPenalty = (
  pairing: Pick<Pairing, 'teamA' | 'teamB'>,
) => {
  const regulars = [...pairing.teamA, ...pairing.teamB].filter(
    (player) => !player.isGuest,
  )

  return [pairing.teamA, pairing.teamB].reduce((total, team) => {
    const [left, right] = team
    return total + [
      [left, right],
      [right, left],
    ].reduce((teamPenalty, [player, partner]) => {
      if (!isProtectedLowLevel(player)) return teamPenalty
      const playerScore = getPlayerMatchScore(player)
      const hasStrongerOption = regulars.some(
        (candidate) => getPlayerMatchScore(candidate) > playerScore,
      )
      const hasStrongerPartner =
        !partner.isGuest && getPlayerMatchScore(partner) > playerScore
      return teamPenalty + (hasStrongerOption && !hasStrongerPartner ? 1 : 0)
    }, 0)
  }, 0)
}

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
  useMeetingPhaseFlow = true,
) => {
  const phaseWeights = useMeetingPhaseFlow
    ? getPacedMeetingPhaseWeights(pacing)
    : {
        warmupDiversity: 0,
        middleIntensity: 0,
        composition: lateBalanceMultiplier(pacing),
      }
  const middlePreferenceMultiplier = useMeetingPhaseFlow
    ? phaseWeights.middleIntensity * 12
    : phaseWeights.composition
  const regularPartnerRepeatPenalty = (team: Team) =>
    conditions.strictSkillLimit
      ? (history.partners[pairKey(team[0].id, team[1].id)] ?? 0) * 16
      : team.every((player) => !player.isGuest)
        ? (history.partners[pairKey(team[0].id, team[1].id)] ?? 0) *
          PARTNER_REPEAT_WEIGHT
        : 0
  const partnerPenalty = conditions.partnerRepeat
    ? regularPartnerRepeatPenalty(teamA) + regularPartnerRepeatPenalty(teamB)
    : 0
  let opponentPenalty = 0
  if (conditions.opponentRepeat) {
    for (const left of teamA) {
      for (const right of teamB) {
        opponentPenalty +=
          (history.opponents[pairKey(left.id, right.id)] ?? 0) *
          (conditions.strictSkillLimit ? 8 : OPPONENT_REPEAT_WEIGHT)
      }
    }
  }

  const teamSkillGap = adaptiveTeamSkillGap(teamA, teamB)
  const levelPenalty = conditions.levelBalance
    ? teamSkillGap * 32
    : 0
  const teamSkillExcessPenalty = conditions.levelBalance
    ? Math.max(0, teamSkillGap - TEAM_SKILL_PREFERRED_GAP) ** 2 *
      TEAM_SKILL_EXCESS_WEIGHT
    : 0
  const agePenalty = conditions.ageBalance
    ? Math.abs(teamAge(teamA) - teamAge(teamB)) * 1.5 *
      middlePreferenceMultiplier
    : 0
  const genderPenalty = conditions.genderBalance
    ? Math.abs(genderBalance(teamA) - genderBalance(teamB)) * 6 *
      middlePreferenceMultiplier
    : 0
  const mixedPairPenalty = conditions.femaleLevelFit
    ? (mixedGenderLevelPenalty(teamA) + mixedGenderLevelPenalty(teamB)) *
      middlePreferenceMultiplier
    : 0
  const mixedDoublesTeamPenalty = conditions.genderBalance
    ? mixedDoublesPenalty(teamA, teamB) * middlePreferenceMultiplier
    : 0
  const teamShapePenalty = conditions.levelBalance
    ? ((teamLevelSpread(teamA) + teamLevelSpread(teamB)) * 70 +
        Math.abs(teamLevelSpread(teamA) - teamLevelSpread(teamB)) * 12 +
        teamLevelMismatchPenalty(teamA) +
        teamLevelMismatchPenalty(teamB)) *
        phaseWeights.composition +
      (teamLevelSpread(teamA) + teamLevelSpread(teamB)) *
        phaseWeights.middleIntensity *
        (conditions.strictSkillLimit ? 0 : MIDDLE_PARTNER_LEVEL_WEIGHT)
    : 0
  const warmupDiversityBonus = conditions.levelBalance
      ? (partnerLevelDiversity(teamA) + partnerLevelDiversity(teamB)) *
      phaseWeights.warmupDiversity *
      (conditions.strictSkillLimit
        ? STRICT_WARMUP_PARTNER_DIVERSITY_WEIGHT
        : WARMUP_PARTNER_DIVERSITY_WEIGHT)
    : 0
  const guestPenalty = conditions.specialMatchCreation
    ? Math.abs(teamA.filter((player) => player.isGuest).length - teamB.filter((player) => player.isGuest).length) *
      12
    : 0
  const guestPartnerPenalty = conditions.guestPartnerRepeat
    ? guestRepeatPartnerPenalty(teamA, history) +
      guestRepeatPartnerPenalty(teamB, history)
    : 0

  return (
    levelPenalty +
    teamSkillExcessPenalty +
    agePenalty +
    genderPenalty +
    mixedPairPenalty +
    mixedDoublesTeamPenalty +
    teamShapePenalty +
    partnerPenalty +
    opponentPenalty +
    guestPenalty +
    guestPartnerPenalty -
    warmupDiversityBonus -
    preferredPartnerBonus(teamA, history) -
    preferredPartnerBonus(teamB, history) +
    random()
  )
}

const teamPairingOptions = (
  players: [Player, Player, Player, Player],
): Array<[Team, Team]> => [
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

const minimumGroupTeamSkillGap = (
  players: [Player, Player, Player, Player],
) => Math.min(
  ...teamPairingOptions(players).map(([teamA, teamB]) =>
    adaptiveTeamSkillGap(teamA, teamB),
  ),
)

const bestPairing = (
  players: [Player, Player, Player, Player],
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
): Pairing => {
  const options = teamPairingOptions(players)

  return options
    .map(([teamA, teamB]) => ({
      teamA,
      teamB,
      score: scorePairing(teamA, teamB, history, random, conditions, pacing),
    }))
    .sort((a, b) => {
      if (conditions.levelBalance) {
        const balanceGap = pairingTeamLevelGap(a) - pairingTeamLevelGap(b)
        if (balanceGap !== 0) return balanceGap

        const lowLevelSupportGap =
          pairingLowLevelSupportPenalty(a) - pairingLowLevelSupportPenalty(b)
        if (lowLevelSupportGap !== 0) return lowLevelSupportGap
      }

      return a.score - b.score
    })[0]
}

const bestSingleGuestPairing = (
  players: [Player, Player, Player, Player],
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
): Pairing | null => {
  const guest = players.find((player) => player.isGuest)
  const regulars = players.filter((player) => !player.isGuest)
  if (!guest || regulars.length !== 3) return null

  const partner = regulars
    .map((player) => ({
      player,
      teamSkillGap: adaptiveTeamSkillGap(
        [guest, player],
        regulars.filter((opponent) => opponent.id !== player.id) as Team,
      ),
      opponentGenderPenalty:
        conditions.genderBalance &&
        isMixedRegularTeam(
          regulars.filter((opponent) => opponent.id !== player.id),
        )
          ? 1
          : 0,
      playerScore: getPlayerMatchScore(player),
      score:
        (conditions.guestPartnerRepeat
          ? (history.partners[pairKey(guest.id, player.id)] ?? 0) *
            GUEST_REPEAT_PARTNER_PENALTY
          : 0) +
        (conditions.partnerRepeat
          ? regulars.reduce(
              (sum, other) =>
                sum + (history.partners[pairKey(player.id, other.id)] ?? 0),
              0,
            )
          : 0) +
        random(),
    }))
    .sort((left, right) => {
      const comparisons = [
        left.opponentGenderPenalty - right.opponentGenderPenalty,
        left.teamSkillGap - right.teamSkillGap,
        left.playerScore - right.playerScore,
        left.score - right.score,
      ]
      return comparisons.find((difference) => difference !== 0) ?? 0
    })[0].player
  const opponents = regulars.filter((player) => player.id !== partner.id)

  return {
    teamA: [guest, partner],
    teamB: [opponents[0], opponents[1]],
    score: 0,
  }
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
  const pairing = isSpecial
    ? bestSingleGuestPairing(players, history, random, conditions) ??
      bestPairing(players, history, random, conditions, pacing)
    : bestPairing(players, history, random, conditions, pacing)
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
  const matchEnd = matchTimeWindow(match).end

  if (getMatchSkillWarningLevel(match) !== 'none') {
    history.skillWarningMatches += 1
  }

  for (const player of players) {
    history.games[player.id] = (history.games[player.id] ?? 0) + 1
    history.restStreaks[player.id] = 0
    history.playStreaks[player.id] = (history.playStreaks[player.id] ?? 0) + 1
    history.lastMatchEnd[player.id] = matchEnd
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

  history.groups[groupKey(players)] =
    (history.groups[groupKey(players)] ?? 0) + 1
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

const playerWaitMinutes = (player: Player, history: HistoryState) => {
  const lastMatchEnd = history.lastMatchEnd[player.id]
  if (lastMatchEnd === undefined) return Math.max(0, history.currentStartOffset)
  return Math.max(0, history.currentStartOffset - lastMatchEnd)
}

const hasWaitDeadline = (player: Player, history: HistoryState) =>
  playerWaitMinutes(player, history) >= WAIT_DEADLINE_MINUTES

const waitPriorityValue = (player: Player, history: HistoryState) => {
  const waitMinutes = playerWaitMinutes(player, history)
  const softStartMinutes = player.waitTimeFlexible
    ? WAIT_DEADLINE_MINUTES
    : STANDARD_WAIT_SOFT_START_MINUTES
  const softUrgency = Math.max(0, waitMinutes - softStartMinutes)
  const deadlineUrgency = Math.max(0, waitMinutes - WAIT_DEADLINE_MINUTES)
  return Math.min(
    WAIT_PRIORITY_MAX_VALUE,
    softUrgency * softUrgency * WAIT_PRIORITY_WEIGHT +
    (waitMinutes >= WAIT_DEADLINE_MINUTES
      ? WAIT_DEADLINE_WEIGHT +
        deadlineUrgency * deadlineUrgency * WAIT_PRIORITY_WEIGHT
      : 0),
  )
}

const fairGameCount = (player: Player, history: HistoryState) =>
  (history.games[player.id] ?? 0) +
  (!player.isGuest && player.gameCountFlexible ? 1 : 0)

const generalFairGameCount = (player: Player, history: HistoryState) =>
  fairGameCount(player, history) +
  (!player.isGuest &&
  history.plannedSpecialIds.has(player.id) &&
  !history.specialCompleted.has(player.id)
    ? SPECIAL_GENERAL_GAME_OFFSET
    : 0)

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

const fairGamePenalty = (
  players: Player[],
  history: HistoryState,
  conditions: MatchConditionOptions,
  gameCount: (player: Player, history: HistoryState) => number = fairGameCount,
) => {
  if (!conditions.fairGames || players.length === 0) return 0
  const counts = players.map((player) => gameCount(player, history))
  return (
    Math.max(...counts) * FAIR_GAME_MAX_WEIGHT +
    counts.reduce((sum, count) => sum + count, 0) * FAIR_GAME_TOTAL_WEIGHT
  )
}

const playerPriorityWithGameCount = (
  player: Player,
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
  gameCount: (player: Player, history: HistoryState) => number,
) =>
  (conditions.fairGames
    ? gameCount(player, history) * FAIR_GAME_MAX_WEIGHT
    : 0) -
  (conditions.waitPriority ? waitPriorityValue(player, history) : 0) -
  (conditions.restBalance ? (history.restStreaks[player.id] ?? 0) * 18 : 0) -
  (conditions.restBalance ? (history.rests[player.id] ?? 0) * 4 : 0) +
  (conditions.restBalance ? consecutivePlayPenalty(player, history) : 0) +
  random()

const playerPriority = (
  player: Player,
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
) => playerPriorityWithGameCount(
  player,
  history,
  random,
  conditions,
  fairGameCount,
)

const generalPlayerPriority = (
  player: Player,
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
) => playerPriorityWithGameCount(
  player,
  history,
  random,
  conditions,
  generalFairGameCount,
)

const uniquePlayers = (players: Player[]) =>
  Array.from(new Map(players.map((player) => [player.id, player])).values())

const groupMeetingCount = (players: Player[], history: HistoryState) =>
  history.groups[groupKey(players)] ?? 0

const groupHasMeetingCapacity = (players: Player[], history: HistoryState) =>
  groupMeetingCount(players, history) < MAX_GROUP_MEETINGS

const groupRepeatPenalty = (
  players: Player[],
  history: HistoryState,
  conditions: MatchConditionOptions,
) => {
  if (!conditions.groupRepeat) return 0

  return groupMeetingCount(players, history) * REPEATED_GROUP_WEIGHT
}

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

type SpecialRegularScore = {
  firstGameCount: number
  waitDeadlineCount: number
  waitPriorityTotal: number
  genderPenalty: number
  levelSpread: number
  ageSpread: number
  levelDirection: number
  groupRepeatPenalty: number
  pendingPenalty: number
  maximumSpecialGames: number
  totalSpecialGames: number
  maximumGames: number
  totalGames: number
  restPenalty: number
  guestPartnerPenalty: number
  randomValue: number
}

const scoreSpecialRegulars = (
  guest: Player,
  regulars: [Player, Player, Player],
  pendingIds: Set<string>,
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
  segment: SpecialAllocationSegment,
): SpecialRegularScore => {
  const pendingCount = regulars.filter((player) => pendingIds.has(player.id)).length
  const specialCounts = regulars.map((player) => specialGameCount(player, history))
  const gameCounts = regulars.map((player) => fairGameCount(player, history))
  const regularScoreSum = regulars.reduce(
    (sum, player) => sum + getPlayerMatchScore(player),
    0,
  )
  const weakestScore = Math.min(
    ...regulars.map((player) => getPlayerMatchScore(player)),
  )
  const guestPartnerPenalty = conditions.guestPartnerRepeat
    ? Math.min(
        ...regulars
          .filter((player) => getPlayerMatchScore(player) === weakestScore)
          .map((player) => history.partners[pairKey(guest.id, player.id)] ?? 0),
      )
    : 0

  return {
    firstGameCount: regulars.filter(
      (player) => (history.games[player.id] ?? 0) === 0,
    ).length,
    waitDeadlineCount: conditions.waitPriority
      ? regulars.filter((player) => hasWaitDeadline(player, history)).length
      : 0,
    waitPriorityTotal: conditions.waitPriority
      ? regulars.reduce(
          (sum, player) => sum + waitPriorityValue(player, history),
          0,
        )
      : 0,
    genderPenalty: conditions.genderBalance
      ? Math.min(...Object.values(genderCounts(regulars)))
      : 0,
    levelSpread: conditions.levelBalance ? playerScoreSpread(regulars) : 0,
    ageSpread: conditions.ageBalance ? playerAgeSpread(regulars) : 0,
    levelDirection:
      segment === 'low'
        ? regularScoreSum
        : segment === 'high'
          ? -regularScoreSum
          : 0,
    groupRepeatPenalty: groupRepeatPenalty(
      [guest, ...regulars],
      history,
      conditions,
    ),
    pendingPenalty: 3 - pendingCount,
    maximumSpecialGames: Math.max(...specialCounts),
    totalSpecialGames: specialCounts.reduce((sum, count) => sum + count, 0),
    maximumGames: conditions.fairGames ? Math.max(...gameCounts) : 0,
    totalGames: conditions.fairGames
      ? gameCounts.reduce((sum, count) => sum + count, 0)
      : 0,
    restPenalty: regulars.reduce(
      (sum, player) =>
        sum -
        (conditions.restBalance
          ? (history.restStreaks[player.id] ?? 0) * 9
          : 0) -
        (conditions.restBalance ? (history.rests[player.id] ?? 0) * 3 : 0),
      0,
    ),
    guestPartnerPenalty,
    randomValue: random(),
  }
}

const hasWaitCapacityPressure = (
  activePlayers: Player[],
  settings: MatchSettings,
) => {
  const rotationRounds =
    Math.floor(WAIT_PRIORITY_MINUTES / settings.normalGameMinutes) + 1
  const rotationWindowMinutes = rotationRounds * settings.normalGameMinutes
  const guestAppearancesPerWindow = Math.max(
    1,
    Math.ceil(rotationWindowMinutes / GAME_SLOT_MINUTES),
  )
  const activeGuestCount = activePlayers.filter((player) => player.isGuest).length
  const participantCapacity = Math.max(
    4,
    settings.courtCount * rotationRounds * 4 -
      activeGuestCount * Math.max(0, guestAppearancesPerWindow - 1),
  )
  return activePlayers.length >= participantCapacity * 0.9
}

const compareSpecialRegularScores = (
  left: SpecialRegularScore,
  right: SpecialRegularScore,
  segment: SpecialAllocationSegment,
  prioritizeWait: boolean,
) => {
  const commonComparisons = [
    right.firstGameCount - left.firstGameCount,
    ...(prioritizeWait
      ? [
          right.waitDeadlineCount - left.waitDeadlineCount,
          right.waitPriorityTotal - left.waitPriorityTotal,
        ]
      : []),
    left.genderPenalty - right.genderPenalty,
    left.levelSpread - right.levelSpread,
    left.ageSpread - right.ageSpread,
    segment === 'random' ? 0 : left.levelDirection - right.levelDirection,
    left.groupRepeatPenalty - right.groupRepeatPenalty,
    left.maximumSpecialGames - right.maximumSpecialGames,
    left.totalSpecialGames - right.totalSpecialGames,
    left.pendingPenalty - right.pendingPenalty,
    ...(!prioritizeWait
      ? [
          right.waitDeadlineCount - left.waitDeadlineCount,
          right.waitPriorityTotal - left.waitPriorityTotal,
        ]
      : []),
    left.maximumGames - right.maximumGames,
    left.totalGames - right.totalGames,
    left.guestPartnerPenalty - right.guestPartnerPenalty,
    left.restPenalty - right.restPenalty,
    left.randomValue - right.randomValue,
  ]
  return commonComparisons.find((difference) => difference !== 0) ?? 0
}

const pickSpecialRegulars = (
  guest: Player,
  activePlayers: Player[],
  usedIds: Set<string>,
  pending: Player[],
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
  settings: MatchSettings,
): [Player, Player, Player] | null => {
  const enforceParticipantCap = specialParticipantTargetRequiresCap(
    activePlayers,
    settings,
  )
  const remainingCoverage = remainingSpecialParticipantTarget(
    activePlayers,
    history,
    settings,
  )
  const availableRegulars = activePlayers.filter(
    (player) =>
      !player.isGuest &&
      (player.specialMatchEligible ?? true) &&
      (
        !enforceParticipantCap ||
        remainingCoverage > 0 ||
        history.specialCompleted.has(player.id)
      ) &&
      !usedIds.has(player.id),
  )
  if (availableRegulars.length < 3) return null

  const plannedPending = pending.filter((player) =>
    history.plannedSpecialIds.has(player.id),
  )
  const cappedPendingCount = Math.min(3, remainingCoverage)
  const allocationPending =
    history.plannedSpecialIds.size > 0 &&
    plannedPending.length >= (enforceParticipantCap ? cappedPendingCount : 1)
      ? plannedPending
      : pending
  const pendingIds = new Set(allocationPending.map((player) => player.id))
  const expectedPendingCount = enforceParticipantCap
    ? cappedPendingCount
    : allocationPending.length > 0
      ? Math.min(3, pendingIds.size)
      : 0
  const hasPending = expectedPendingCount > 0
  if (allocationPending.length < expectedPendingCount) return null
  const requirePending = hasPending
  const prioritizeWait =
    conditions.waitPriority && hasWaitCapacityPressure(activePlayers, settings)
  const segment = specialAllocationSegment(
    guest,
    activePlayers,
    history,
    settings,
  )
  const rankedRegulars = availableRegulars
    .map((player) => ({ player, randomValue: random() }))
    .sort((left, right) => {
      if (requirePending) {
        const pendingDiff =
          Number(pendingIds.has(right.player.id)) -
          Number(pendingIds.has(left.player.id))
        if (pendingDiff !== 0) return pendingDiff
      }
      if (prioritizeWait) {
        const deadlineDiff =
          Number(hasWaitDeadline(right.player, history)) -
          Number(hasWaitDeadline(left.player, history))
        if (deadlineDiff !== 0) return deadlineDiff
        const waitPriorityDiff =
          waitPriorityValue(right.player, history) -
          waitPriorityValue(left.player, history)
        if (waitPriorityDiff !== 0) return waitPriorityDiff
      }
      if (segment !== 'random') {
        const levelDiff =
          getPlayerMatchScore(left.player) - getPlayerMatchScore(right.player)
        if (levelDiff !== 0) return segment === 'low' ? levelDiff : -levelDiff
      }
      const specialGameDiff =
        specialGameCount(left.player, history) -
        specialGameCount(right.player, history)
      if (specialGameDiff !== 0) return specialGameDiff
      const gameDiff =
        fairGameCount(left.player, history) -
        fairGameCount(right.player, history)
      if (gameDiff !== 0) return gameDiff
      if (conditions.waitPriority && !prioritizeWait) {
        const deadlineDiff =
          Number(hasWaitDeadline(right.player, history)) -
          Number(hasWaitDeadline(left.player, history))
        if (deadlineDiff !== 0) return deadlineDiff
        const waitPriorityDiff =
          waitPriorityValue(right.player, history) -
          waitPriorityValue(left.player, history)
        if (waitPriorityDiff !== 0) return waitPriorityDiff
      }
      return left.randomValue - right.randomValue
    })
    .map(({ player }) => player)
  const candidatePool = uniquePlayers([
    ...rankedRegulars.filter((player) => player.gender === 'male').slice(0, 10),
    ...rankedRegulars.filter((player) => player.gender === 'female').slice(0, 10),
    ...rankedRegulars.filter((player) => player.gender === 'none').slice(0, 4),
  ])

  let bestGroup: [Player, Player, Player] | null = null
  let bestScore: SpecialRegularScore | null = null
  let fallbackGroup: [Player, Player, Player] | null = null
  let fallbackScore: SpecialRegularScore | null = null

  for (let a = 0; a < candidatePool.length - 2; a += 1) {
    for (let b = a + 1; b < candidatePool.length - 1; b += 1) {
      for (let c = b + 1; c < candidatePool.length; c += 1) {
        const regulars: [Player, Player, Player] = [
          candidatePool[a],
          candidatePool[b],
          candidatePool[c],
        ]
        if (
          requirePending &&
          regulars.filter((player) => pendingIds.has(player.id)).length <
            expectedPendingCount
        ) {
          continue
        }

        const score = scoreSpecialRegulars(
          guest,
          regulars,
          pendingIds,
          history,
          random,
          conditions,
          segment,
        )
        if (
          fallbackScore === null ||
          compareSpecialRegularScores(
            score,
            fallbackScore,
            segment,
            prioritizeWait,
          ) < 0
        ) {
          fallbackScore = score
          fallbackGroup = regulars
        }
        if (
          conditions.groupRepeat &&
          !groupHasMeetingCapacity([guest, ...regulars], history)
        ) {
          continue
        }
        if (
          bestScore === null ||
          compareSpecialRegularScores(
            score,
            bestScore,
            segment,
            prioritizeWait,
          ) < 0
        ) {
          bestScore = score
          bestGroup = regulars
        }
      }
    }
  }

  return bestGroup ?? (conditions.groupRepeat ? null : fallbackGroup)
}

const pickSingleGuestSpecialGroup = (
  activePlayers: Player[],
  usedIds: Set<string>,
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
  allowExtraSpecial: boolean,
  settings: MatchSettings,
): [Player, Player, Player, Player] | null => {
  const candidateGuests = activePlayers.filter(
    (player) =>
      player.isGuest &&
      !usedIds.has(player.id) &&
      guestWithinSpecialLimit(player, history, settings),
  )
  if (candidateGuests.length === 0) return null

  const rawPending = (hasReachedSpecialParticipantTarget(
    activePlayers,
    history,
    settings,
  ) ? [] : activePlayers)
    .filter(
      (player) =>
        !player.isGuest &&
        (player.specialMatchEligible ?? true) &&
        !history.specialCompleted.has(player.id) &&
        !usedIds.has(player.id),
    )
    .sort((a, b) => {
      if (history.plannedSpecialIds.size > 0) {
        const plannedDifference =
          Number(history.plannedSpecialIds.has(b.id)) -
          Number(history.plannedSpecialIds.has(a.id))
        if (plannedDifference !== 0) return plannedDifference
      }
      return (
        playerPriority(a, history, random, conditions) -
        playerPriority(b, history, random, conditions)
      )
    })
  const pending = rawPending

  const needsGuestFirstMatch = candidateGuests.some(
    (guest) => (history.guestGameCounts[guest.id] ?? 0) === 0,
  )
  const isExtraSpecialMatch = pending.length === 0 && !needsGuestFirstMatch
  if (isExtraSpecialMatch && !allowExtraSpecial) return null

  const guests = (isExtraSpecialMatch && !settings.specialLimitEnabled
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
      settings,
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
  const expectedPendingCount = hasPending
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
      sum -
      (conditions.restBalance ? (history.restStreaks[player.id] ?? 0) * 8 : 0) -
      (conditions.restBalance ? (history.rests[player.id] ?? 0) * 2 : 0),
    0,
  )
  const repeatGuestPenalty = hasPending
    ? specialCounts.reduce((sum, count) => sum + count, 0) * 4
    : specialCounts.reduce((sum, count) => sum + count, 0) * 850 +
      Math.max(...specialCounts) * 340
  const pendingPriorityPenalty = (expectedPendingCount - pendingCount) * 110

  return (
    pairing.score +
    groupRepeatPenalty(group, history, conditions) +
    regularLevelPenalty +
    (conditions.levelBalance ? playerScoreSpread(group) * (hasPending ? 36 : 8) : 0) +
    (conditions.femaleLevelFit ? mixedGenderLevelPenalty(regulars) * 4 : 0) +
    (conditions.genderBalance ? groupGenderMixPenalty(regulars) : 0) +
    historyPenalty +
    fairGamePenalty(group, history, conditions) +
    (conditions.waitPriority
      ? -group.reduce(
          (sum, player) => sum + waitPriorityValue(player, history),
          0,
        )
      : 0) +
    pendingPriorityPenalty -
    firstGuestCount * 40 +
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
  settings: MatchSettings,
): [Player, Player, Player, Player] | null => {
  const candidateGuests = activePlayers.filter(
    (player) =>
      player.isGuest &&
      !usedIds.has(player.id) &&
      guestWithinSpecialLimit(player, history, settings),
  )
  if (candidateGuests.length === 0) return null

  const remainingCoverage = remainingSpecialParticipantTarget(
    activePlayers,
    history,
    settings,
  )
  const rawPending = (hasReachedSpecialParticipantTarget(
    activePlayers,
    history,
    settings,
  ) ? [] : activePlayers)
    .filter(
      (player) =>
        !player.isGuest &&
        (player.specialMatchEligible ?? true) &&
        !history.specialCompleted.has(player.id) &&
        !usedIds.has(player.id),
    )
    .sort(
      (a, b) =>
        playerPriority(a, history, random, conditions) -
        playerPriority(b, history, random, conditions),
    )
  const pending = rawPending
  const needsGuestFirstMatch = candidateGuests.some(
    (guest) => (history.guestGameCounts[guest.id] ?? 0) === 0,
  )
  const isExtraSpecialMatch = pending.length === 0 && !needsGuestFirstMatch
  if (isExtraSpecialMatch && !allowExtraSpecial) return null

  const guests = (isExtraSpecialMatch && !settings.specialLimitEnabled
    ? candidateGuests.filter((guest) => guestHasRemainingExtraGames(guest, history))
    : candidateGuests
  ).sort(
    (a, b) =>
      guestPriority(a, history, random, conditions) -
      guestPriority(b, history, random, conditions),
  )

  if (guests.length === 0) return null

  const availableRegulars = activePlayers.filter(
    (player) =>
      !player.isGuest &&
      (player.specialMatchEligible ?? true) &&
      (remainingCoverage > 0 || history.specialCompleted.has(player.id)) &&
      !usedIds.has(player.id),
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
  let fallbackGroup: [Player, Player, Player, Player] | null = null
  let fallbackScore = Number.POSITIVE_INFINITY

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
          const expectedPendingCount = Math.min(
            regularsInGroup.length,
            remainingCoverage,
          )
          if (
            expectedPendingCount > 0 &&
            regularsInGroup.filter((player) => pendingIds.has(player.id)).length <
              expectedPendingCount
          ) {
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
          if (score < fallbackScore) {
            fallbackScore = score
            fallbackGroup = group
          }
          if (
            conditions.levelBalance &&
            minimumGroupTeamSkillGap(group) >= TEAM_SKILL_PREFERRED_GAP
          ) {
            continue
          }
          if (
            conditions.groupRepeat &&
            !groupHasMeetingCapacity(group, history)
          ) {
            continue
          }
          if (score < bestScore) {
            bestScore = score
            bestGroup = group
          }
        }
      }
    }
  }

  return bestGroup ?? (conditions.groupRepeat ? null : fallbackGroup)
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
      allowExtraSpecial,
      settings,
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
    settings,
  )
}

const scoreGroup = (
  group: [Player, Player, Player, Player],
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
  preferBalancedGenderComposition = false,
) => {
  const pairing = bestPairing(group, history, random, conditions, pacing)
  const restStreaks = group.map((player) => history.restStreaks[player.id] ?? 0)
  const levelSpread = playerScoreSpread(group)
  const ageSpread = playerAgeSpread(group)
  const guestCount = group.filter((player) => player.isGuest).length
  const phaseWeights = getPacedMeetingPhaseWeights(pacing)
  const middlePreferenceMultiplier = phaseWeights.middleIntensity * 12
  const globalCompositionMultiplier = 1 + phaseWeights.middleIntensity * 2

  return (
    pairing.score +
    fairGamePenalty(group, history, conditions, generalFairGameCount) +
    (conditions.waitPriority
      ? -group.reduce(
          (sum, player) => sum + waitPriorityValue(player, history),
          0,
        )
      : 0) +
    groupRepeatPenalty(group, history, conditions) +
    (conditions.levelBalance ? openLevelWideGroupPenalty(group) : 0) +
    (conditions.levelBalance
      ? groupLevelCohesionPenalty(group) *
        ((conditions.strictSkillLimit
          ? GLOBAL_LEVEL_COHESION_WEIGHT
          : GENERAL_GLOBAL_LEVEL_COHESION_WEIGHT) +
          (conditions.strictSkillLimit
            ? MIDDLE_LEVEL_COHESION_WEIGHT
            : GENERAL_MIDDLE_LEVEL_COHESION_WEIGHT) *
            phaseWeights.middleIntensity)
      : 0) +
    (conditions.levelBalance
      ? levelSpread * 5000 * globalCompositionMultiplier
      : 0) +
    (conditions.ageBalance ? ageSpread * 900 * middlePreferenceMultiplier : 0) +
    (conditions.restBalance
      ? restStreaks.reduce((sum, streak) => sum + streak, 0) * 8
      : 0) +
    (conditions.genderBalance
      ? (preferBalancedGenderComposition
          ? optimizedGenderCompositionPenalty(group) *
            OPTIMIZED_GENDER_COMPOSITION_WEIGHT
          : groupGenderMixPenalty(group) * GLOBAL_GENDER_COHESION_WEIGHT) *
        globalCompositionMultiplier
      : 0) +
    groupConsecutivePlayPenalty(group, history, conditions) +
    Math.max(0, guestCount - 1) * 50 +
    random()
  )
}

const groupSkillCompatibilityTier = (
  players: [Player, Player, Player, Player],
) => {
  const spread = Math.max(
    fixedPlayerScoreSpread(players),
    minimumGroupTeamSkillGap(players),
  )
  if (spread < TEAM_SKILL_PREFERRED_GAP) return 0
  if (spread <= TEAM_SKILL_WARNING_GAP) return 1
  if (spread <= 60) return 2
  return 3
}

const pickGeneralGroup = (
  activePlayers: Player[],
  usedIds: Set<string>,
  history: HistoryState,
  random: () => number,
  settings: MatchSettings,
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
  preferBalancedGenderComposition = false,
  genderBatchPlan: GenderBatchPlan | null = null,
): [Player, Player, Player, Player] | null => {
  const selectionConditions = conditions
  const phaseWeights = getPacedMeetingPhaseWeights(pacing)
  const concentratedPhase = phaseWeights.composition >= 1
  const availablePlayerEntries = activePlayers
    .filter((player) => {
      if (usedIds.has(player.id)) return false
      return !player.isGuest
    })
    .map((player) => ({
      player,
      priority: generalPlayerPriority(
        player,
        history,
        random,
        selectionConditions,
      ),
    }))
    .sort((left, right) => left.priority - right.priority)
  const availablePlayers = availablePlayerEntries.map(({ player }) => player)
  const priorityByPlayerId = new Map(
    availablePlayerEntries.map(({ player, priority }) => [player.id, priority]),
  )

  if (availablePlayers.length < 4) return null

  const minimumGameCount = Math.min(
    ...availablePlayers.map((player) => generalFairGameCount(player, history)),
  )
  const fairAnchorPool = conditions.fairGames
    ? availablePlayers.filter(
        (player) => generalFairGameCount(player, history) === minimumGameCount,
      )
    : availablePlayers
  const ageDataCount = fairAnchorPool.filter(
    (player) => player.ageGroup !== '무관',
  ).length
  const cohortKeyStages: Array<(player: Player) => string | null> = []
  if (conditions.levelBalance) {
    cohortKeyStages.push((player) => `${getPlayerMatchScore(player)}`)
  }
  if (conditions.genderBalance) {
    cohortKeyStages.push((player) => [
      conditions.levelBalance ? getPlayerMatchScore(player) : '*',
      player.gender,
    ].join(':'))
  }
  if (conditions.ageBalance && ageDataCount >= 4) {
    cohortKeyStages.push((player) =>
      player.ageGroup === '무관'
        ? null
        : [
            conditions.levelBalance ? getPlayerMatchScore(player) : '*',
            conditions.genderBalance ? player.gender : '*',
            player.ageGroup,
          ].join(':'),
    )
  }
  const hierarchicalCohesiveAnchors = cohortKeyStages.flatMap((makeKey) => {
    const cohorts = new Map<string, Player[]>()
    for (const player of fairAnchorPool) {
      const key = makeKey(player)
      if (key === null) continue
      cohorts.set(key, [...(cohorts.get(key) ?? []), player])
    }
    const largestCohort = [...cohorts.values()]
      .filter((cohort) => cohort.length >= 2)
      .sort((left, right) => right.length - left.length)[0]
    return largestCohort ? [largestCohort[0]] : []
  })
  const strictCohesiveAnchors = (() => {
    if (!conditions.strictSkillLimit) return []
    const cohorts = new Map<string, Player[]>()
    for (const player of fairAnchorPool) {
      const key = [
        conditions.genderBalance ? player.gender : '*',
        getPlayerMatchScore(player),
        conditions.ageBalance ? player.ageGroup : '*',
      ].join(':')
      cohorts.set(key, [...(cohorts.get(key) ?? []), player])
    }
    return [...cohorts.values()]
      .sort((left, right) => right.length - left.length)
      .map((cohort) => cohort[0])
      .slice(0, 2)
  })()
  const cohesiveAnchors = conditions.strictSkillLimit
    ? strictCohesiveAnchors
    : hierarchicalCohesiveAnchors
  const urgentAnchors = conditions.waitPriority
    ? availablePlayers
        .filter((player) => hasWaitDeadline(player, history))
        .slice(0, 1)
    : []
  const anchorCandidates = uniquePlayers([
    availablePlayers[0],
    ...urgentAnchors,
    ...cohesiveAnchors,
  ]).slice(0, conditions.strictSkillLimit ? 4 : 3)

  const makeGroupMatrix = () => Array.from(
    { length: 10 },
    () => Array.from(
      { length: 4 },
      (): [Player, Player, Player, Player] | null => null,
    ),
  )
  const makeScoreMatrix = () => Array.from(
    { length: 10 },
    () => Array.from({ length: 4 }, () => Number.POSITIVE_INFINITY),
  )
  const bestGroups = makeGroupMatrix()
  const bestScores = makeScoreMatrix()
  const requiredWaitDeadlineCount = conditions.waitPriority
    ? Math.min(
        4,
        availablePlayers.filter((player) => hasWaitDeadline(player, history)).length,
      )
    : 0
  const standardPlayers = activePlayers.filter(
    (player) => !player.isGuest && !player.gameCountFlexible,
  )
  const standardGameCounts = new Map(
    standardPlayers.map((player) => [
      player.id,
      generalFairGameCount(player, history),
    ]),
  )
  const standardCountFrequency = new Map<number, number>()
  for (const count of standardGameCounts.values()) {
    standardCountFrequency.set(
      count,
      (standardCountFrequency.get(count) ?? 0) + 1,
    )
  }
  const currentStandardCounts = [...standardCountFrequency.keys()]
  const currentStandardSpread = currentStandardCounts.length > 0
    ? Math.max(...currentStandardCounts) - Math.min(...currentStandardCounts)
    : 0
  const projectedStandardSpread = (
    group: [Player, Player, Player, Player],
  ) => {
    if (standardCountFrequency.size === 0) return 0
    const selectedByCount = new Map<number, number>()
    for (const player of group) {
      const count = standardGameCounts.get(player.id)
      if (count === undefined) continue
      selectedByCount.set(count, (selectedByCount.get(count) ?? 0) + 1)
    }
    let projectedMinimum = Number.POSITIVE_INFINITY
    let projectedMaximum = Number.NEGATIVE_INFINITY
    for (const [count, frequency] of standardCountFrequency) {
      const selected = selectedByCount.get(count) ?? 0
      if (selected < frequency) {
        projectedMinimum = Math.min(projectedMinimum, count)
        projectedMaximum = Math.max(projectedMaximum, count)
      }
      if (selected > 0) {
        projectedMinimum = Math.min(projectedMinimum, count + 1)
        projectedMaximum = Math.max(projectedMaximum, count + 1)
      }
    }
    return projectedMaximum - projectedMinimum
  }
  const seenGroupKeys = new Set<string>()
  const availableStandardPlayers = availablePlayers.filter((player) =>
    standardGameCounts.has(player.id),
  )
  const minimumAvailableStandardCount = availableStandardPlayers.length > 0
    ? Math.min(
        ...availableStandardPlayers.map(
          (player) => standardGameCounts.get(player.id) ?? 0,
        ),
      )
    : 0
  const minimumStandardIds = new Set(
    availableStandardPlayers
      .filter(
        (player) =>
          standardGameCounts.get(player.id) === minimumAvailableStandardCount,
      )
      .map((player) => player.id),
  )
  const requiredMinimumStandardCount = Math.min(2, minimumStandardIds.size)
  const firstGameIds = new Set(
    availablePlayers
      .filter((player) => (history.games[player.id] ?? 0) === 0)
      .map((player) => player.id),
  )
  const requiredFirstGameCount = Math.min(4, firstGameIds.size)

  for (const anchor of anchorCandidates) {
    const preferredCompanions = uniquePlayers([
      ...availablePlayers.filter((player) =>
        (anchor.preferredPartnerIds ?? []).includes(player.id),
      ),
      ...availablePlayers.filter((player) =>
        (player.preferredPartnerIds ?? []).includes(anchor.id),
      ),
    ])
      .filter(
        (player) =>
          player.id !== anchor.id &&
          (history.partners[pairKey(anchor.id, player.id)] ?? 0) <
            MAX_PREFERRED_PARTNER_GAMES,
      )
      .slice(0, 6)
    const openBridgeCompanions = isOpenLevel(anchor)
      ? [...availablePlayers
          .filter((player) => player.id !== anchor.id && !isOpenLevel(player))
          .reduce((cohorts, player) => {
            const key = `${levelMatchGroup(player)}:${player.gender}`
            cohorts.set(key, [...(cohorts.get(key) ?? []), player])
            return cohorts
          }, new Map<string, Player[]>())
          .values()]
          .filter((cohort) => cohort.length >= 3)
          .sort((left, right) => left.length - right.length)
          .flatMap((cohort) => cohort.slice(0, 4))
      : availablePlayers.filter(isOpenLevel)
    const middleCohesiveCompanions =
      !conditions.strictSkillLimit && phaseWeights.middleIntensity > 0
      ? availablePlayers
          .filter(
            (player) =>
              player.id !== anchor.id &&
              player.level === anchor.level,
          )
          .sort((left, right) => {
            if (conditions.genderBalance) {
              const genderDifference =
                Number(left.gender !== anchor.gender) -
                Number(right.gender !== anchor.gender)
              if (genderDifference !== 0) return genderDifference
            }
            if (conditions.ageBalance && anchor.ageGroup !== '무관') {
              const ageDifference =
                Number(left.ageGroup !== anchor.ageGroup) -
                Number(right.ageGroup !== anchor.ageGroup)
              if (ageDifference !== 0) return ageDifference
            }
            return (
              (priorityByPlayerId.get(left.id) ?? 0) -
              (priorityByPlayerId.get(right.id) ?? 0)
            )
          })
          .slice(0, 8)
      : []
    const rankedCompanions = availablePlayers
      .filter((player) => player.id !== anchor.id)
      .map((player) => ({
        player,
        priority: priorityByPlayerId.get(player.id) ?? 0,
        randomValue: random(),
      }))
      .sort((left, right) => {
        if (conditions.fairGames) {
          const gameDiff =
            generalFairGameCount(left.player, history) -
            generalFairGameCount(right.player, history)
          if (gameDiff !== 0) return gameDiff
        }
        if (selectionConditions.waitPriority) {
          const deadlineDiff =
            Number(hasWaitDeadline(right.player, history)) -
            Number(hasWaitDeadline(left.player, history))
          if (deadlineDiff !== 0) return deadlineDiff
          const waitPriorityDiff =
            waitPriorityValue(right.player, history) -
            waitPriorityValue(left.player, history)
          if (waitPriorityDiff !== 0) return waitPriorityDiff
        }
        if (
          conditions.genderBalance &&
          concentratedPhase &&
          anchor.gender !== 'none'
        ) {
          const genderDiff =
            Number(left.player.gender !== anchor.gender) -
            Number(right.player.gender !== anchor.gender)
          if (genderDiff !== 0) return genderDiff
        }
        if (conditions.levelBalance) {
          const leftDistance = scoreDistanceBetweenPlayers(anchor, left.player)
          const rightDistance = scoreDistanceBetweenPlayers(anchor, right.player)
          const levelDiff = leftDistance - rightDistance
          if (levelDiff !== 0) {
            return phaseWeights.warmupDiversity > 0 ? -levelDiff : levelDiff
          }
        }
        if (
          conditions.ageBalance &&
          concentratedPhase &&
          anchor.ageGroup !== '무관'
        ) {
          const ageDiff =
            Math.abs(ageValue(anchor) - ageValue(left.player)) -
            Math.abs(ageValue(anchor) - ageValue(right.player))
          if (ageDiff !== 0) return ageDiff
        }
        const priorityDiff = left.priority - right.priority
        if (priorityDiff !== 0) return priorityDiff
        return left.randomValue - right.randomValue
      })
      .map(({ player }) => player)
    const companionCandidates = uniquePlayers([
      ...preferredCompanions,
      ...middleCohesiveCompanions,
      ...openBridgeCompanions,
      ...rankedCompanions,
    ]).slice(0, conditions.strictSkillLimit ? 16 : 14)

    for (let a = 0; a < companionCandidates.length - 2; a += 1) {
      for (let b = a + 1; b < companionCandidates.length - 1; b += 1) {
        for (let c = b + 1; c < companionCandidates.length; c += 1) {
          const group: [Player, Player, Player, Player] = [
            anchor,
            companionCandidates[a],
            companionCandidates[b],
            companionCandidates[c],
          ]
          if (!isValidGuestGroup(group, settings.singleGuestPerMatch)) continue
          const currentGroupKey = groupKey(group)
          if (seenGroupKeys.has(currentGroupKey)) continue
          seenGroupKeys.add(currentGroupKey)
          if (
            conditions.groupRepeat &&
            !groupHasMeetingCapacity(group, history)
          ) {
            continue
          }
          const spreadTier = conditions.levelBalance
            ? groupSkillCompatibilityTier(group)
            : 0
          const maximumSkillTier = conditions.strictSkillLimit
            ? (history.skillWarningMatches < 5 ? 1 : 0)
            : 3
          if (spreadTier > maximumSkillTier) continue
          const missedWaitDeadlineCount = Math.max(
            0,
            requiredWaitDeadlineCount -
              group.filter((player) => hasWaitDeadline(player, history)).length,
          )
          const missedMinimumStandardCount = Math.max(
            0,
            requiredMinimumStandardCount -
              group.filter((player) => minimumStandardIds.has(player.id)).length,
          )
          const missedFirstGameCount = Math.max(
            0,
            requiredFirstGameCount -
              group.filter((player) => firstGameIds.has(player.id)).length,
          )
          let worsensFairGameSpread = false
          if (conditions.fairGames && standardPlayers.length > 0) {
            worsensFairGameSpread =
              projectedStandardSpread(group) >
                Math.max(1, currentStandardSpread)
          }
          const operationalTier = Math.min(
            9,
            missedFirstGameCount * 3 +
              missedWaitDeadlineCount * 4 +
              missedMinimumStandardCount * 2 +
              Number(worsensFairGameSpread),
          )

          const score = scoreGroup(
            group,
            history,
            random,
            selectionConditions,
            pacing,
            preferBalancedGenderComposition,
          ) + genderBatchReachabilityPenalty(group, genderBatchPlan) *
            FAIR_GAME_MAX_WEIGHT
          if (score < bestScores[operationalTier][spreadTier]) {
            bestScores[operationalTier][spreadTier] = score
            bestGroups[operationalTier][spreadTier] = group
          }
        }
      }
    }
  }

  if (!conditions.strictSkillLimit) {
    const middleEnd = (pacing.middlePhaseEndPercent ?? 70) / 100
    const skillTierWeight =
      activePlayers.length <= 24 || roundProgress(pacing) <= middleEnd
        ? 2
        : 1
    let selectedGroup: [Player, Player, Player, Player] | null = null
    let selectedScore = Number.POSITIVE_INFINITY
    let selectedTier: number[] | null = null
    for (let operationalTier = 0; operationalTier < bestGroups.length; operationalTier += 1) {
      for (let skillTier = 0; skillTier < bestGroups[operationalTier].length; skillTier += 1) {
        const group = bestGroups[operationalTier][skillTier]
        if (!group) continue
        const tier = [
          operationalTier + skillTier * skillTierWeight,
          skillTier,
          operationalTier,
        ]
        if (
          selectedTier === null ||
          compareNumberTuples(tier, selectedTier) < 0 ||
          (compareNumberTuples(tier, selectedTier) === 0 &&
            bestScores[operationalTier][skillTier] < selectedScore)
        ) {
          selectedGroup = group
          selectedScore = bestScores[operationalTier][skillTier]
          selectedTier = tier
        }
      }
    }
    return selectedGroup
  }

  for (let operationalTier = 0; operationalTier < bestGroups.length; operationalTier += 1) {
    const maximumSkillTier = conditions.strictSkillLimit
      ? (history.skillWarningMatches < 5 ? 1 : 0)
      : 3
    const best = bestGroups[operationalTier]
      .slice(0, maximumSkillTier + 1)
      .find(
      (group): group is [Player, Player, Player, Player] => group !== null,
    )
    if (best) return best
  }

  const maximumRecoverySkillTier = history.skillWarningMatches < 5 ? 1 : 0
  let recoveryGroup: [Player, Player, Player, Player] | null = null
  let recoveryTier = Number.POSITIVE_INFINITY
  let recoveryScore = Number.POSITIVE_INFINITY
  const considerRecoveryGroup = (
    group: [Player, Player, Player, Player],
  ) => {
    if (conditions.groupRepeat && !groupHasMeetingCapacity(group, history)) return
    if (groupSkillCompatibilityTier(group) > maximumRecoverySkillTier) return
    const missedWaitDeadlineCount = Math.max(
      0,
      requiredWaitDeadlineCount -
        group.filter((player) => hasWaitDeadline(player, history)).length,
    )
    const missedMinimumStandardCount = Math.max(
      0,
      requiredMinimumStandardCount -
        group.filter((player) => minimumStandardIds.has(player.id)).length,
    )
    const missedFirstGameCount = Math.max(
      0,
      requiredFirstGameCount -
        group.filter((player) => firstGameIds.has(player.id)).length,
    )
    const worsensFairGameSpread =
      projectedStandardSpread(group) > Math.max(1, currentStandardSpread)
    const operationalTier = Math.min(
      9,
      missedFirstGameCount * 3 +
        missedWaitDeadlineCount * 4 +
        missedMinimumStandardCount * 2 +
        Number(worsensFairGameSpread),
    )
    const score = scoreGroup(
      group,
      history,
      random,
      selectionConditions,
      pacing,
      preferBalancedGenderComposition,
    ) + genderBatchReachabilityPenalty(group, genderBatchPlan) *
      FAIR_GAME_MAX_WEIGHT
    if (
      operationalTier < recoveryTier ||
      (operationalTier === recoveryTier && score < recoveryScore)
    ) {
      recoveryGroup = group
      recoveryTier = operationalTier
      recoveryScore = score
    }
  }
  const recoveryCohorts = new Map<string, Player[]>()
  const openPlayers: Player[] = []
  for (const player of availablePlayers) {
    if (isOpenLevel(player)) {
      openPlayers.push(player)
      continue
    }
    recoveryCohorts.set(
      player.level,
      [...(recoveryCohorts.get(player.level) ?? []), player],
    )
  }
  for (const cohort of recoveryCohorts.values()) {
    const candidates = cohort.slice(0, 18)
    for (let a = 0; a < candidates.length - 3; a += 1) {
      for (let b = a + 1; b < candidates.length - 2; b += 1) {
        for (let c = b + 1; c < candidates.length - 1; c += 1) {
          for (let d = c + 1; d < candidates.length; d += 1) {
            considerRecoveryGroup([
              candidates[a],
              candidates[b],
              candidates[c],
              candidates[d],
            ])
          }
        }
      }
    }
    for (const openPlayer of openPlayers.slice(0, 3)) {
      for (let a = 0; a < candidates.length - 2; a += 1) {
        for (let b = a + 1; b < candidates.length - 1; b += 1) {
          for (let c = b + 1; c < candidates.length; c += 1) {
            considerRecoveryGroup([
              openPlayer,
              candidates[a],
              candidates[b],
              candidates[c],
            ])
          }
        }
      }
    }
  }
  if (recoveryGroup) return recoveryGroup
  return null
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

type TournamentPairCandidate = {
  playerIds: [string, string]
  players: Team
  rotationScore: number
}

const tournamentPairCandidates = (
  teamId: string,
  playersByTeam: Map<string, Player[]>,
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
): TournamentPairCandidate[] => {
  const teamPlayers = playersByTeam.get(teamId) ?? []
  const teamMinGames =
    teamPlayers.length > 0
      ? Math.min(...teamPlayers.map((player) => history.games[player.id] ?? 0))
      : 0
  const players = [...teamPlayers]
    .sort(
      (a, b) =>
        playerPriority(a, history, random, conditions) -
        playerPriority(b, history, random, conditions),
    )
    .slice(0, 16)

  const rotationScore = (pair: Team) =>
    pair.reduce((sum, player) => {
      const gameGap = (history.games[player.id] ?? 0) - teamMinGames
      return (
        sum +
        (conditions.fairGames ? gameGap * 100000 : 0) +
        (conditions.restBalance
          ? consecutivePlayPenalty(player, history) * 12 -
            (history.restStreaks[player.id] ?? 0) * 240 -
            (history.rests[player.id] ?? 0) * 40
          : 0)
      )
    }, 0)

  const candidates: TournamentPairCandidate[] = []
  for (let left = 0; left < players.length - 1; left += 1) {
    for (let right = left + 1; right < players.length; right += 1) {
      const pair: Team = [players[left], players[right]]
      candidates.push({
        playerIds: [players[left].id, players[right].id],
        players: pair,
        rotationScore: rotationScore(pair),
      })
    }
  }

  return candidates
}

const scoreFixedDoublesLineup = (
  teamA: Team,
  teamB: Team,
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
) => {
  const group = [...teamA, ...teamB]
  const gameCounts = group.map((player) => history.games[player.id] ?? 0)
  const restStreaks = group.map((player) => history.restStreaks[player.id] ?? 0)
  const levelSpread = playerScoreSpread(group)
  const balanceMultiplier = lateBalanceMultiplier(pacing)

  return (
    scorePairing(teamA, teamB, history, random, conditions, pacing, false) +
    group.reduce(
      (sum, player) => sum + playerPriority(player, history, random, conditions),
      0,
    ) *
      4 +
    (conditions.fairGames ? Math.max(...gameCounts) * 3 : 0) +
    (conditions.levelBalance ? levelSpread * 150 * balanceMultiplier : 0) +
    (conditions.restBalance
      ? restStreaks.reduce((sum, streak) => sum + streak, 0) * 8
      : 0) +
    (conditions.genderBalance ? groupGenderMixPenalty(group) : 0) +
    groupConsecutivePlayPenalty(group, history, conditions) +
    random()
  )
}

const pickFriendlyTournamentLineup = (
  match: TournamentMatch,
  playersByTeam: Map<string, Player[]>,
  history: HistoryState,
  random: () => number,
  conditions: MatchConditionOptions,
  pacing: RoundPacing,
): TournamentLineup | null => {
  if (!match.teamAId || !match.teamBId) return null

  const teamACandidates = tournamentPairCandidates(
    match.teamAId,
    playersByTeam,
    history,
    random,
    conditions,
  )
  const teamBCandidates = tournamentPairCandidates(
    match.teamBId,
    playersByTeam,
    history,
    random,
    conditions,
  )
  if (teamACandidates.length === 0 || teamBCandidates.length === 0) return null

  let best:
    | {
        teamA: TournamentPairCandidate
        teamB: TournamentPairCandidate
        score: number
      }
    | null = null

  for (const teamA of teamACandidates) {
    for (const teamB of teamBCandidates) {
      const score = scoreFixedDoublesLineup(
        teamA.players,
        teamB.players,
        history,
        random,
        conditions,
        pacing,
      ) +
        teamA.rotationScore +
        teamB.rotationScore

      if (!best || score < best.score) {
        best = { teamA, teamB, score }
      }
    }
  }

  if (!best) return null

  return {
    ...emptyTournamentLineup(),
    teamAPlayerIds: normalizeLineupIds(best.teamA.playerIds),
    teamBPlayerIds: normalizeLineupIds(best.teamB.playerIds),
  }
}

export const generateTournamentLineups = (
  matches: TournamentMatch[],
  teams: TournamentTeam[],
  levelTiers: LevelTierTable = defaultLevelTiers,
): TournamentLineupsByMatch => {
  const participants = tournamentParticipantsFromTeams(teams)
  const playersByTeam = new Map<string, Player[]>()
  for (const participant of participants) {
    const players = playersByTeam.get(participant.teamId) ?? []
    players.push(tournamentParticipantAsPlayer(participant, levelTiers))
    playersByTeam.set(participant.teamId, players)
  }
  const activePlayers = participants.map((participant) =>
    tournamentParticipantAsPlayer(participant, levelTiers),
  )
  const history = makeHistory(activePlayers)
  const random = makeRandom(17)
  const conditions = defaultMatchConditionOptions
  const orderedMatches = [...matches]
    .filter(
      (match) =>
        match.phase === 'team-battle' &&
        match.teamAId &&
        match.teamBId &&
        !match.isBye,
    )
    .sort((a, b) => a.order - b.order)
  const lineups: TournamentLineupsByMatch = {}

  orderedMatches.forEach((match, index) => {
    const pacing = {
      roundNumber: index + 1,
      targetRoundCount: Math.max(1, orderedMatches.length),
    }
    const lineup = pickFriendlyTournamentLineup(
      match,
      playersByTeam,
      history,
      random,
      conditions,
      pacing,
    )
    if (!lineup) return

    lineups[match.id] = lineup
    const selectedIds = new Set([
      ...lineup.teamAPlayerIds.filter(Boolean),
      ...lineup.teamBPlayerIds.filter(Boolean),
    ])
    updateHistoryForMatch(history, {
      id: match.id,
      round: match.round,
      court: match.court,
      teamA: lineup.teamAPlayerIds
        .map((playerId) => activePlayers.find((player) => player.id === playerId))
        .filter((player): player is Player => Boolean(player)) as Team,
      teamB: lineup.teamBPlayerIds
        .map((playerId) => activePlayers.find((player) => player.id === playerId))
        .filter((player): player is Player => Boolean(player)) as Team,
      isSpecial: false,
    })
    updateHistoryForRests(
      history,
      [
        ...(playersByTeam.get(match.teamAId ?? '') ?? []),
        ...(playersByTeam.get(match.teamBId ?? '') ?? []),
      ],
      selectedIds,
    )
  })

  return lineups
}

const completedTournamentScores = (
  result: TournamentResultsByMatch[string] | undefined,
) => {
  if (!result?.completed) return null

  const teamAScore = result ? numericScore(result.teamAScore) : null
  const teamBScore = result ? numericScore(result.teamBScore) : null
  if (
    teamAScore !== null &&
    teamBScore !== null &&
    teamAScore !== teamBScore
  ) {
    return {
      teamAScore,
      teamBScore,
      winnerSide: teamAScore > teamBScore ? 'A' as const : 'B' as const,
    }
  }

  if (result.winnerSide === 'A' || result.winnerSide === 'B') {
    return {
      teamAScore: 0,
      teamBScore: 0,
      winnerSide: result.winnerSide,
    }
  }
  return null
}

export const calculateTournamentMvpCandidates = (
  matches: TournamentMatch[],
  teams: TournamentTeam[],
  results: TournamentResultsByMatch,
  lineups: TournamentLineupsByMatch,
) => {
  const participants = tournamentParticipantsFromTeams(teams)
  const stats = new Map(
    participants.map((participant) => [
      participant.id,
      {
        participant,
        games: 0,
        wins: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      },
    ]),
  )

  const addSideStats = (
    playerIds: string[] | undefined,
    won: boolean,
    pointsFor: number,
    pointsAgainst: number,
  ) => {
    for (const playerId of new Set(playerIds?.filter(Boolean) ?? [])) {
      const stat = stats.get(playerId)
      if (!stat) continue

      stat.games += 1
      if (won) stat.wins += 1
      stat.pointsFor += pointsFor
      stat.pointsAgainst += pointsAgainst
    }
  }

  for (const match of matches) {
    if (match.phase !== 'team-battle') continue

    const scores = completedTournamentScores(results[match.id])
    const lineup = lineups[match.id]
    if (!scores || !lineup) continue

    const teamAWon = scores.winnerSide === 'A'
    addSideStats(
      lineup.teamAPlayerIds,
      teamAWon,
      scores.teamAScore,
      scores.teamBScore,
    )
    addSideStats(
      lineup.teamBPlayerIds,
      !teamAWon,
      scores.teamBScore,
      scores.teamAScore,
    )
  }

  return Object.fromEntries(
    teams
      .filter((team) => team.active && team.name.trim())
      .map((team) => {
        const candidate = [...stats.values()]
          .filter(
            (stat) =>
              stat.participant.teamId === team.id &&
              stat.games > 0,
          )
          .sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins
            const pointDiff =
              b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst)
            if (pointDiff !== 0) return pointDiff
            if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
            return a.participant.name.localeCompare(b.participant.name)
          })[0]

        return [team.id, candidate?.participant.name ?? '대기']
      }),
  )
}

export const getTournamentMatchWinnerId = (
  match: TournamentMatch,
  result: TournamentResultsByMatch[string] | undefined,
) => {
  if (match.isBye) return match.teamAId ?? match.teamBId
  if (!match.teamAId || !match.teamBId) return undefined

  const scores = completedTournamentScores(result)
  if (!scores) return undefined

  return scores.winnerSide === 'A' ? match.teamAId : match.teamBId
}

const tournamentMatchLoserId = (
  match: TournamentMatch,
  result: TournamentResultsByMatch[string] | undefined,
) => {
  if (!match.teamAId || !match.teamBId) return undefined

  const scores = completedTournamentScores(result)
  if (!scores) return undefined

  return scores.winnerSide === 'A' ? match.teamBId : match.teamAId
}

const assignTournamentOrder = (
  matches: TournamentMatch[],
  settings: TournamentSettings,
  startOrder = 1,
) => {
  const courtCount = normalizeTournamentCourtCount(settings)
  const firstRound = Math.max(1, Math.ceil(startOrder / courtCount))
  const matchesByRound = new Map<number, TournamentMatch[]>()
  const lastRoundByTeam = new Map<string, number>()
  const lastRoundByBracketStage = new Map<number, number>()

  const teamsForMatch = (match: TournamentMatch) =>
    [match.teamAId, match.teamBId].filter(
      (teamId): teamId is string => Boolean(teamId),
    )

  const canUseRound = (
    match: TournamentMatch,
    round: number,
    requireRest: boolean,
  ) => {
    const placed = matchesByRound.get(round) ?? []
    if (placed.length >= courtCount) return false

    const teams = teamsForMatch(match)
    const occupiedTeams = new Set(placed.flatMap(teamsForMatch))
    if (teams.some((teamId) => occupiedTeams.has(teamId))) return false
    if (
      requireRest &&
      teams.some((teamId) => (lastRoundByTeam.get(teamId) ?? -2) >= round - 1)
    ) {
      return false
    }

    if ((match.bracketRound ?? 0) > 1) {
      const previousStageRound = lastRoundByBracketStage.get(
        (match.bracketRound ?? 1) - 1,
      )
      // 결과가 아직 없어 진출 팀을 알 수 없는 경우에도 앞 단계 뒤에
      // 한 타임을 비워 둔다. 이렇게 예약한 시간은 결과 입력 후에도 같아서
      // 공유된 토너먼트 일정이 진행 중에 뒤로 밀리지 않는다.
      if (previousStageRound !== undefined && round <= previousStageRound + 1) {
        return false
      }
    }
    return true
  }

  const scheduledMatches = matches.map((match) => {
    const findRound = (requireRest: boolean) => {
      for (let round = firstRound; round <= firstRound + matches.length * 2; round += 1) {
        if (canUseRound(match, round, requireRest)) return round
      }
      return firstRound + matches.length * 2
    }
    const preferredRound = findRound(true)
    // 대관시간을 넘더라도 휴식·의존 관계를 깨지 않는다. 초과 시간은
    // 현장에서 조정할 운영 경고이며, 대진 안정성을 훼손하는 실패 조건이 아니다.
    const round = preferredRound
    const placed = matchesByRound.get(round) ?? []
    const scheduled = {
      ...match,
      order: 0,
      round,
      court: placed.length + 1,
    }
    matchesByRound.set(round, [...placed, scheduled])
    for (const teamId of teamsForMatch(match)) {
      lastRoundByTeam.set(teamId, round)
    }
    if (match.bracketRound) {
      lastRoundByBracketStage.set(
        match.bracketRound,
        Math.max(lastRoundByBracketStage.get(match.bracketRound) ?? 0, round),
      )
    }
    return scheduled
  })

  return scheduledMatches
    .sort((left, right) =>
      left.round - right.round || left.court - right.court,
    )
    .map((match, index) => ({ ...match, order: startOrder + index }))
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

  const winnerId = getTournamentMatchWinnerId(directMatch, results[directMatch.id])
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

      if (scores.winnerSide === 'A') {
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

      const winnerId = getTournamentMatchWinnerId(match, results[id])
      nextEntries.push({
        teamId: winnerId,
        source: winnerId ? undefined : `${label} 승자`,
      })
    }

    entries = nextEntries
  }

  if (!includeThirdPlace || semifinalMatches.length !== 2) {
    return assignTournamentOrder(matches, settings, startOrder)
  }

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

  return assignTournamentOrder([...matches, thirdPlaceMatch], settings, startOrder)
}

const makePlannedKnockoutMatches = (
  qualifierCount: number,
  settings: TournamentSettings,
  prefix: string,
  startOrder: number,
) => {
  if (qualifierCount < 2) return []
  const placeholders = Array.from({ length: qualifierCount }, (_, index) => ({
    id: `planned-qualifier-${index + 1}`,
    name: `${index + 1}번 진출팀`,
    playerNames: '',
    level: 'O' as const,
    gender: 'none' as const,
    seed: index + 1,
    active: true,
  }))

  return makeKnockoutMatches(
    placeholders,
    settings,
    {},
    prefix,
    startOrder,
    settings.includeThirdPlace,
  ).map((match) => {
    const plannedSource = (teamId: string | undefined, fallback: string | undefined) => {
      if (!teamId?.startsWith('planned-qualifier-')) return fallback
      const number = teamId.replace('planned-qualifier-', '')
      return `${number}번 진출팀`
    }
    return {
      ...match,
      sourceA: plannedSource(match.teamAId, match.sourceA),
      sourceB: plannedSource(match.teamBId, match.sourceB),
      teamAId: match.teamAId?.startsWith('planned-qualifier-')
        ? undefined
        : match.teamAId,
      teamBId: match.teamBId?.startsWith('planned-qualifier-')
        ? undefined
        : match.teamBId,
    }
  })
}

const makeTeamBattleMatches = (
  teams: TournamentTeam[],
  settings: TournamentSettings,
): TournamentMatch[] => {
  const matchCount = normalizeTournamentCount(settings.teamBattleMatchCount, 1, 5)
  const slotLabels =
    settings.format === 'friendly-team-battle'
      ? Array.from({ length: matchCount }, (_, index) => `복식 ${index + 1}`)
      : settings.teamBattleSlots.length
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

    const winnerId = getTournamentMatchWinnerId(match, results[match.id])
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
  matches: TournamentMatch[],
  results: TournamentResultsByMatch,
): TournamentTeamBattleStanding[] => {
  const standings = teams.map<TournamentTeamBattleStanding>((team) => ({
    team,
    rank: 0,
    tiesPlayed: 0,
    tiesWon: 0,
    tiesLost: 0,
    matchWins: 0,
    matchLosses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDiff: 0,
  }))
  const byTeamId = new Map(standings.map((standing) => [standing.team.id, standing]))

  for (const match of matches.filter((item) => item.phase === 'team-battle')) {
    if (!match.teamAId || !match.teamBId) continue

    const teamA = byTeamId.get(match.teamAId)
    const teamB = byTeamId.get(match.teamBId)
    const scores = completedTournamentScores(results[match.id])
    if (!teamA || !teamB || !scores) continue

    teamA.pointsFor += scores.teamAScore
    teamA.pointsAgainst += scores.teamBScore
    teamB.pointsFor += scores.teamBScore
    teamB.pointsAgainst += scores.teamAScore
  }

  standings.forEach((standing) => {
    standing.pointDiff = standing.pointsFor - standing.pointsAgainst
  })

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
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
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
          !getTournamentMatchWinnerId(match, results[match.id]),
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

    const knockoutStartOrder =
      (groupMatches.reduce(
        (maximum, match) => Math.max(maximum, match.round),
        0,
      ) * normalizeTournamentCourtCount(settings)) + 1

    const knockoutMatches = incompleteGroups.length > 0
      ? makePlannedKnockoutMatches(
          groups.reduce(
            (sum, group) => sum + Math.min(advancePerGroup, group.teamIds.length),
            0,
          ),
          settings,
          'gk-ko',
          knockoutStartOrder,
        )
      : makeKnockoutMatches(
          qualifiedTeams,
          settings,
          results,
          'gk-ko',
          knockoutStartOrder,
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
      teamBattleStandings: calculateTeamBattleStandings(
        activeTeams,
        teamBattleTies,
        matches,
        results,
      ),
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

const generateSchedulePass = (
  players: Player[],
  settings: MatchSettings,
  plannedSpecialIds = new Set<string>(),
  preferBalancedGenderComposition = false,
): Schedule => {
  const activePlayers = players
    .filter((player) => player.active)
    .map((player) => ({
      ...player,
      matchLevelTier: getPlayerMatchTier(player, settings.levelTiers),
    }))
  const activeRegulars = activePlayers.filter((player) => !player.isGuest)
  const activeGuests = activePlayers.filter((player) => player.isGuest)
  const history = makeHistory(activePlayers, plannedSpecialIds)
  const rounds: Round[] = []
  const warnings: string[] = []
  const random = makeRandom(settings.seed)
  const conditions = matchConditions(settings)
  const specialMatchesEnabled =
    conditions.specialMatchCreation && activeGuests.length > 0

  if (activePlayers.length < 4) {
    return {
      rounds: [],
      warnings: ['참가자가 4명 이상이어야 대진을 만들 수 있습니다.'],
      specialCompletedIds: [],
      guestGameCounts: history.guestGameCounts,
    }
  }
  if (
    specialMatchesEnabled &&
    settings.singleGuestPerMatch &&
    activeRegulars.length < 3
  ) {
    return {
      rounds: [],
      warnings: ['스페셜 1명 옵션에서는 일반 참가자가 3명 이상 필요합니다.'],
      specialCompletedIds: [],
      guestGameCounts: history.guestGameCounts,
    }
  }

  const targetRoundCount = normalizeTargetRoundCount(settings.targetRoundCount)
  const pacingRoundCount = normalizeTargetRoundCount(
    settings.pacingRoundCount ?? targetRoundCount,
  )
  const requiredCompletionRoundLimit = activePlayers.length * 2 + activeGuests.length + 4
  const bookingMinutes = getBookingDurationMinutes(settings.startTime, settings.endTime)
  const normalGameMinutes = [10, 12, 15].includes(settings.normalGameMinutes)
    ? settings.normalGameMinutes
    : GAME_SLOT_MINUTES
  const greatestCommonDivisor = (left: number, right: number) => {
    let a = Math.abs(Math.floor(left))
    let b = Math.abs(Math.floor(right))
    while (b > 0) [a, b] = [b, a % b]
    return Math.max(1, a)
  }
  const specialGamesPerCourt = normalGameMinutes /
    greatestCommonDivisor(normalGameMinutes, GAME_SLOT_MINUTES)
  const plannedSpecialMatchCount = specialMatchesEnabled
    ? activeGuests.reduce(
        (sum, guest) => sum + specialPlannedGameTarget(
          guest,
          activePlayers,
          settings,
        ),
        0,
      )
    : 0
  const specialCourtCount = Math.min(
    settings.courtCount,
    Math.max(1, Math.ceil(plannedSpecialMatchCount / specialGamesPerCourt)),
  )
  const specialCourtIds = new Set(
    Array.from({ length: specialCourtCount }, (_, index) => index + 1),
  )
  const schedulingMinutes = normalGameMinutes === GAME_SLOT_MINUTES
    ? Math.max(bookingMinutes, targetRoundCount * GAME_SLOT_MINUTES)
    : bookingMinutes
  const courtAvailableAt = Array.from({ length: settings.courtCount }, () => 0)
  const playerAvailableAt = Object.fromEntries(activePlayers.map((player) => [player.id, 0]))
  const maxAutoRounds = Math.max(
    targetRoundCount,
    requiredCompletionRoundLimit,
    settings.courtCount *
      Math.ceil(bookingMinutes / Math.min(normalGameMinutes, GAME_SLOT_MINUTES)) +
      (conditions.strictSkillLimit ? bookingMinutes : 0),
  )
  let stalledRounds = 0

  for (let roundNumber = 1; roundNumber <= maxAutoRounds; roundNumber += 1) {
    if (settings.roundCountLocked && normalGameMinutes === GAME_SLOT_MINUTES && roundNumber > targetRoundCount) break
    const startOffset = Math.min(...courtAvailableAt)
    history.currentStartOffset = startOffset
    if (startOffset >= schedulingMinutes) break
    const openCourts = courtAvailableAt
      .map((availableAt, index) => ({ availableAt, court: index + 1 }))
      .filter(({ availableAt }) => availableAt === startOffset)
    const usedIds = new Set(
      activePlayers
        .filter((player) => (playerAvailableAt[player.id] ?? 0) > startOffset)
        .map((player) => player.id),
    )
    const matches: Match[] = []
    const completedBeforeRound = history.specialCompleted.size
    const allowExtraSpecial =
      settings.specialLimitEnabled || startOffset < pacingRoundCount * GAME_SLOT_MINUTES
    const timeRoundNumber = Math.floor(startOffset / GAME_SLOT_MINUTES) + 1
    const pacing = {
      roundNumber: timeRoundNumber,
      targetRoundCount: pacingRoundCount,
      earlyPhaseEndPercent: settings.earlyPhaseEndPercent,
      middlePhaseEndPercent: settings.middlePhaseEndPercent,
    }

    const addSpecialMatches = (courts: number[]) => {
      for (const court of courts) {
        if (!specialCourtIds.has(court)) continue
        if (matches.some((match) => match.court === court)) continue
        if (startOffset + GAME_SLOT_MINUTES > schedulingMinutes) continue
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
        match.startOffsetMinutes = startOffset
        match.durationMinutes = GAME_SLOT_MINUTES
        matches.push(match)
        for (const player of group) usedIds.add(player.id)
        updateHistoryForMatch(history, match)
      }
    }

    const addGeneralMatches = (courts: number[]) => {
      const genderBatchPlan = preferBalancedGenderComposition
        ? makeGenderBatchPlan(
            activeRegulars.filter((player) => !usedIds.has(player.id)),
            courts.length,
          )
        : null
      for (const court of courts) {
        if (matches.some((match) => match.court === court)) continue
        if (startOffset + normalGameMinutes > schedulingMinutes) continue
        const group = pickGeneralGroup(
          activePlayers,
          usedIds,
          history,
          random,
          settings,
          conditions,
          pacing,
          preferBalancedGenderComposition,
          genderBatchPlan,
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
        match.startOffsetMinutes = startOffset
        match.durationMinutes = normalGameMinutes
        matches.push(match)
        for (const player of group) usedIds.add(player.id)
        if (genderBatchPlan) {
          const counts = genderCounts(group)
          genderBatchPlan.selectedMen += counts.men
          genderBatchPlan.selectedWomen += counts.women
          genderBatchPlan.remainingMatches = Math.max(
            0,
            genderBatchPlan.remainingMatches - 1,
          )
        }
        updateHistoryForMatch(history, match)
      }
    }

    const openCourtIds = openCourts.map(({ court }) => court)
    if (!conditions.specialMatchCreation) {
      addGeneralMatches(openCourtIds)
    } else if (conditions.specialPriority) {
      addSpecialMatches(openCourtIds)
      addGeneralMatches(openCourtIds)
    } else {
      const availableGuestCount = activeGuests.filter(
        (guest) =>
          !usedIds.has(guest.id) &&
          guestWithinSpecialLimit(guest, history, settings),
      ).length
      const eligibleSpecialCourtIds = openCourtIds.filter((court) =>
        specialCourtIds.has(court),
      )
      const reservedCourtCount = Math.min(
        eligibleSpecialCourtIds.length,
        availableGuestCount,
      )
      const reservedCourtIds = eligibleSpecialCourtIds.slice(
        0,
        reservedCourtCount,
      )
      const reservedCourtSet = new Set(reservedCourtIds)
      const generalCourtIds = openCourtIds.filter(
        (court) => !reservedCourtSet.has(court),
      )
      addGeneralMatches(generalCourtIds)
      addSpecialMatches(reservedCourtIds)
      addGeneralMatches(reservedCourtIds)
    }

    if (matches.length === 0) {
      for (const { court } of openCourts) {
        courtAvailableAt[court - 1] = conditions.strictSkillLimit
          ? Math.min(
              schedulingMinutes,
              ...Object.values(playerAvailableAt).filter(
                (availableAt) => availableAt > startOffset,
              ),
            )
          : schedulingMinutes
      }
      continue
    }

    for (const match of matches) {
      const endsAt = startOffset + (match.durationMinutes ?? normalGameMinutes)
      courtAvailableAt[match.court - 1] = endsAt
      for (const player of [...match.teamA, ...match.teamB]) {
        playerAvailableAt[player.id] = endsAt
      }
    }
    for (const { court } of openCourts) {
      if (!matches.some((match) => match.court === court)) {
        courtAvailableAt[court - 1] = conditions.strictSkillLimit
          ? Math.min(
              schedulingMinutes,
              ...Object.values(playerAvailableAt).filter(
                (availableAt) => availableAt > startOffset,
              ),
            )
          : Math.min(schedulingMinutes, startOffset + 1)
      }
    }

    updateHistoryForRests(history, activePlayers, usedIds)
    rounds.push({
      id: `round-${roundNumber}`,
      number: roundNumber,
      matches,
      resting: activePlayers.filter((player) => !usedIds.has(player.id)),
    })

    const eligibleRegulars = activeRegulars.filter(
      (player) => player.specialMatchEligible ?? true,
    )
    const allRegularsCompleted = eligibleRegulars.every((player) =>
      history.specialCompleted.has(player.id),
    )
    const allGuestsPlayed = activeGuests.every(
      (guest) => (history.guestGameCounts[guest.id] ?? 0) > 0,
    )
    const reachedTargetRounds = startOffset + normalGameMinutes >= schedulingMinutes
    const completedMinimumSpecial = !specialMatchesEnabled || settings.specialLimitEnabled
      ? true
      : allRegularsCompleted && allGuestsPlayed
    if (
      reachedTargetRounds && completedMinimumSpecial
    ) break

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
    specialMatchesEnabled
      ? activePlayers.filter(
          (player) =>
            !player.isGuest &&
            (player.specialMatchEligible ?? true) &&
            !history.specialCompleted.has(player.id),
        )
      : []
  const eligibleSpecialParticipantCount = activeRegulars.filter(
    (player) => player.specialMatchEligible ?? true,
  ).length
  const requestedSpecialParticipantTarget = settings.specialLimitEnabled
    ? configuredSpecialParticipantTarget(settings)
    : eligibleSpecialParticipantCount
  const achievedSpecialParticipantCount = history.specialCompleted.size
  if (
    specialMatchesEnabled &&
    settings.specialLimitEnabled &&
    eligibleSpecialParticipantCount < requestedSpecialParticipantTarget
  ) {
    warnings.push(
      `스페셜 참가 대상 부족: ${eligibleSpecialParticipantCount}/${requestedSpecialParticipantTarget}명`,
    )
  } else if (
    specialMatchesEnabled &&
    settings.specialLimitEnabled &&
    achievedSpecialParticipantCount < requestedSpecialParticipantTarget
  ) {
    warnings.push(
      `스페셜 참가 목표 미달: ${achievedSpecialParticipantCount}/${requestedSpecialParticipantTarget}명`,
    )
  }
  if (specialMatchesEnabled && settings.specialLimitEnabled) {
    const achievedGuestGames = Object.values(history.guestGameCounts)
      .reduce((sum, count) => sum + count, 0)
    if (achievedGuestGames < plannedSpecialMatchCount) {
      warnings.push(
        `스페셜 경기 목표 미달: ${achievedGuestGames}/${plannedSpecialMatchCount}경기`,
      )
    }
  }
  if (pendingSpecial.length > 0 && !settings.specialLimitEnabled) {
    warnings.push(
      `스페셜 경기 미완료: ${pendingSpecial.map((player) => player.name).join(', ')}`,
    )
  }
  const unplayedGuests = activePlayers.filter(
    (player) =>
      specialMatchesEnabled &&
      player.isGuest &&
      (history.guestGameCounts[player.id] ?? 0) === 0,
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

const enforceSpecialParticipantTarget = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
  preferredParticipantIds: Set<string>,
): Schedule => {
  if (!settings.specialLimitEnabled) return schedule

  const eligiblePlayers = players.filter(
    (player) =>
      player.active &&
      !player.isGuest &&
      (player.specialMatchEligible ?? true),
  )
  const eligibleIds = new Set(eligiblePlayers.map((player) => player.id))
  const requestedTarget = configuredSpecialParticipantTarget(settings)
  let matches = schedule.rounds.flatMap((round) => round.matches)
  const specialRegularAppearances = matches
    .filter((match) => match.isSpecial)
    .flatMap((match) => matchPlayers(match).filter((player) => !player.isGuest))
  const targetCount = Math.min(
    requestedTarget,
    eligiblePlayers.length,
    specialRegularAppearances.length,
  )
  if (targetCount === 0) return schedule

  const playerById = new Map(players.map((player) => [player.id, player]))
  for (const match of matches) {
    for (const player of matchPlayers(match)) playerById.set(player.id, player)
  }
  const scheduledSpecialIds = specialRegularAppearances.map((player) => player.id)
  const targetIds = new Set(
    [...new Set([
      ...preferredParticipantIds,
      ...scheduledSpecialIds,
      ...eligiblePlayers.map((player) => player.id),
    ])]
      .filter((id) => eligibleIds.has(id))
      .slice(0, targetCount),
  )

  const specialCounts = () => {
    const counts = new Map<string, number>()
    for (const match of matches.filter((candidate) => candidate.isSpecial)) {
      for (const player of matchPlayers(match).filter((candidate) => !candidate.isGuest)) {
        counts.set(player.id, (counts.get(player.id) ?? 0) + 1)
      }
    }
    return counts
  }
  const canUsePlayer = (playerId: string, match: Match) =>
    !matchPlayers(match).some((player) => player.id === playerId) &&
    !matches.some(
      (other) =>
        other.id !== match.id &&
        windowsOverlap(match, other) &&
        matchPlayers(other).some((player) => player.id === playerId),
    )
  const replacementFit = (incoming: Player, outgoing: Player) => [
    Number(incoming.gender !== outgoing.gender),
    scoreDistanceBetweenPlayers(incoming, outgoing),
    Math.abs(ageValue(incoming) - ageValue(outgoing)),
  ]
  const replaceAppearance = (
    matchIndex: number,
    outgoingId: string,
    incoming: Player,
  ) => {
    matches = matches.map((match, index) =>
      index === matchIndex
        ? replaceMatchPlayer(match, outgoingId, incoming)
        : match,
    )
  }

  for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
    const match = matches[matchIndex]
    if (!match.isSpecial) continue
    for (const outgoing of matchPlayers(match).filter(
      (player) => !player.isGuest && !targetIds.has(player.id),
    )) {
      const counts = specialCounts()
      const incoming = [...targetIds]
        .map((id) => playerById.get(id))
        .filter((player): player is Player => Boolean(player))
        .filter((player) => canUsePlayer(player.id, matches[matchIndex]))
        .sort((left, right) => compareNumberTuples(
          [
            counts.get(left.id) ?? 0,
            ...replacementFit(left, outgoing),
          ],
          [
            counts.get(right.id) ?? 0,
            ...replacementFit(right, outgoing),
          ],
        ))[0]
      if (incoming) replaceAppearance(matchIndex, outgoing.id, incoming)
    }
  }

  for (const missingId of targetIds) {
    const counts = specialCounts()
    if ((counts.get(missingId) ?? 0) > 0) continue
    const incoming = playerById.get(missingId)
    if (!incoming) continue

    const replacementOptions = matches.flatMap((match, matchIndex) =>
      !match.isSpecial || !canUsePlayer(missingId, match)
        ? []
        : matchPlayers(match)
            .filter(
              (player) =>
                !player.isGuest &&
                targetIds.has(player.id) &&
                (counts.get(player.id) ?? 0) > 1,
            )
            .map((outgoing) => ({ matchIndex, outgoing })),
    )
    const replacement = replacementOptions.sort((left, right) =>
      compareNumberTuples(
        replacementFit(incoming, left.outgoing),
        replacementFit(incoming, right.outgoing),
      ),
    )[0]
    if (replacement) {
      replaceAppearance(
        replacement.matchIndex,
        replacement.outgoing.id,
        incoming,
      )
    }
  }

  const matchById = new Map(matches.map((match) => [match.id, match]))
  const specialCompletedIds = [...new Set(
    matches
      .filter((match) => match.isSpecial)
      .flatMap((match) =>
        matchPlayers(match)
          .filter((player) => !player.isGuest)
          .map((player) => player.id),
      ),
  )]
  const warnings = schedule.warnings.filter(
    (warning) =>
      !warning.startsWith('스페셜 참가 대상 부족:') &&
      !warning.startsWith('스페셜 참가 목표 미달:'),
  )
  if (eligiblePlayers.length < requestedTarget) {
    warnings.push(
      `스페셜 참가 대상 부족: ${eligiblePlayers.length}/${requestedTarget}명`,
    )
  } else if (specialCompletedIds.length < requestedTarget) {
    warnings.push(
      `스페셜 참가 목표 미달: ${specialCompletedIds.length}/${requestedTarget}명`,
    )
  }

  return refreshScheduleRestingPlayers(
    {
      ...schedule,
      rounds: schedule.rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => matchById.get(match.id) ?? match),
      })),
      warnings,
      specialCompletedIds,
    },
    players,
  )
}

const generateScheduleCandidate = (
  players: Player[],
  settings: MatchSettings,
  preferBalancedGenderComposition: boolean,
): Schedule => {
  const initialSchedule = generateSchedulePass(
    players,
    settings,
    new Set<string>(),
    preferBalancedGenderComposition,
  )
  const plannedSpecialIds = new Set(
    initialSchedule.rounds.flatMap((round) =>
      round.matches
        .filter((match) => match.isSpecial)
        .flatMap((match) => [...match.teamA, ...match.teamB])
        .filter((player) => !player.isGuest)
        .map((player) => player.id),
    ),
  )

  if (plannedSpecialIds.size === 0) return initialSchedule

  const plannedSchedule = generateSchedulePass(
    players,
    settings,
    plannedSpecialIds,
    preferBalancedGenderComposition,
  )
  const participantTargetEnabled =
    settings.specialScheduleMode === 'spread' ||
    usesContinuousSpecialWindow(settings)
  if (!participantTargetEnabled) return plannedSchedule

  const targetedPlannedSchedule = enforceSpecialParticipantTarget(
    plannedSchedule,
    players,
    settings,
    plannedSpecialIds,
  )
  if (!settings.specialLimitEnabled) {
    return targetedPlannedSchedule
  }

  const targetedInitialSchedule = enforceSpecialParticipantTarget(
    initialSchedule,
    players,
    settings,
    plannedSpecialIds,
  )
  return targetedInitialSchedule.specialCompletedIds.length >
    targetedPlannedSchedule.specialCompletedIds.length
    ? targetedInitialSchedule
    : targetedPlannedSchedule
}

export const generateSchedule = (
  players: Player[],
  settings: MatchSettings,
): Schedule => generateScheduleCandidate(players, settings, false)

export const appendGeneralCourtGames = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
): { schedule: Schedule; addedMatchIds: string[] } => {
  const activePlayers = players.filter((player) => player.active)
  const activeRegulars = activePlayers.filter((player) => !player.isGuest)
  if (activeRegulars.length < 4) {
    return {
      schedule: {
        ...schedule,
        warnings: [...schedule.warnings, '경기 추가는 일반 참가자 4명 이상 필요합니다.'],
      },
      addedMatchIds: [],
    }
  }

  const existingMatches = schedule.rounds
    .flatMap((round) => round.matches)
    .sort((left, right) =>
      (left.startOffsetMinutes ?? 0) - (right.startOffsetMinutes ?? 0) ||
      left.court - right.court,
    )
  const plannedSpecialIds = new Set(
    existingMatches
      .filter((match) => match.isSpecial)
      .flatMap((match) => [...match.teamA, ...match.teamB])
      .filter((player) => !player.isGuest)
      .map((player) => player.id),
  )
  const history = makeHistory(activePlayers, plannedSpecialIds)
  for (const match of existingMatches) {
    history.currentStartOffset = match.startOffsetMinutes ?? 0
    updateHistoryForMatch(history, match)
  }

  const normalGameMinutes = [10, 12, 15].includes(settings.normalGameMinutes)
    ? settings.normalGameMinutes
    : GAME_SLOT_MINUTES
  const startsByCourt = Array.from({ length: settings.courtCount }, (_, index) => {
    const court = index + 1
    const courtMatches = existingMatches.filter((match) => match.court === court)
    const startOffset = courtMatches.reduce(
      (maximum, match) => Math.max(maximum, matchTimeWindow(match).end),
      0,
    )
    return { court, startOffset }
  })
  const courtsByStart = new Map<number, number[]>()
  for (const { court, startOffset } of startsByCourt) {
    courtsByStart.set(startOffset, [
      ...(courtsByStart.get(startOffset) ?? []),
      court,
    ])
  }

  const conditions = matchConditions(settings)
  const random = makeRandom(settings.seed + existingMatches.length + 101)
  const addedMatches: Match[] = []
  const addedRounds: Round[] = []
  let nextRoundNumber = schedule.rounds.reduce(
    (maximum, round) => Math.max(maximum, round.number),
    0,
  ) + 1
  const sortedStarts = [...courtsByStart.keys()].sort((left, right) => left - right)

  for (const startOffset of sortedStarts) {
    const roundMatches: Match[] = []
    const windowEnd = startOffset + normalGameMinutes
    const usedIds = new Set(
      [...existingMatches, ...addedMatches]
        .filter((match) => {
          const window = matchTimeWindow(match)
          return window.start < windowEnd && startOffset < window.end
        })
        .flatMap((match) => [...match.teamA, ...match.teamB])
        .map((player) => player.id),
    )
    history.currentStartOffset = startOffset

    for (const court of courtsByStart.get(startOffset) ?? []) {
      const availableRegulars = activeRegulars
        .filter((player) => !usedIds.has(player.id))
        .sort((left, right) =>
          (history.games[left.id] ?? 0) - (history.games[right.id] ?? 0) ||
          left.name.localeCompare(right.name, 'ko'),
        )
      if (availableRegulars.length < 4) continue
      const pacing = {
        roundNumber: Math.max(1, settings.pacingRoundCount),
        targetRoundCount: Math.max(1, settings.pacingRoundCount),
        earlyPhaseEndPercent: settings.earlyPhaseEndPercent,
        middlePhaseEndPercent: settings.middlePhaseEndPercent,
      }
      const gameCountThresholds = [...new Set(
        availableRegulars.map((player) => history.games[player.id] ?? 0),
      )].sort((left, right) => left - right)
      let group: [Player, Player, Player, Player] | null = null
      for (const threshold of gameCountThresholds) {
        const lowGamePoolIds = new Set(
          availableRegulars
            .filter((player) => (history.games[player.id] ?? 0) <= threshold)
            .map((player) => player.id),
        )
        if (lowGamePoolIds.size < 4) continue
        const lowGamePool = activeRegulars.filter((player) =>
          lowGamePoolIds.has(player.id),
        )
        group = pickGeneralGroup(
          lowGamePool,
          usedIds,
          history,
          random,
          settings,
          conditions,
          pacing,
          true,
        )
        if (group) break
      }
      if (!group) continue

      const match = createMatch(
        nextRoundNumber,
        court,
        group,
        history,
        random,
        conditions,
        pacing,
        false,
      )
      match.startOffsetMinutes = startOffset
      match.durationMinutes = normalGameMinutes
      roundMatches.push(match)
      addedMatches.push(match)
      for (const player of group) usedIds.add(player.id)
      updateHistoryForMatch(history, match)
    }

    if (roundMatches.length > 0) {
      addedRounds.push({
        id: `added-round-${nextRoundNumber}-${startOffset}`,
        number: nextRoundNumber,
        matches: roundMatches,
        resting: [],
      })
      nextRoundNumber += 1
    }
  }

  const missingCourtCount = settings.courtCount - addedMatches.length
  const nextSchedule = refreshScheduleRestingPlayers({
    ...schedule,
    rounds: [...schedule.rounds, ...addedRounds],
    warnings: missingCourtCount > 0
      ? [...schedule.warnings, `경기 추가 미배정 ${missingCourtCount}코트`]
      : schedule.warnings,
  }, activePlayers)
  return {
    schedule: nextSchedule,
    addedMatchIds: addedMatches.map((match) => match.id),
  }
}

const swapScheduleMatchSlots = (
  schedule: Schedule,
  left: Match,
  right: Match,
): Schedule => ({
  ...schedule,
  rounds: schedule.rounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) => {
      if (match.id === left.id) {
        return {
          ...match,
          court: right.court,
          startOffsetMinutes: right.startOffsetMinutes,
        }
      }
      if (match.id === right.id) {
        return {
          ...match,
          court: left.court,
          startOffsetMinutes: left.startOffsetMinutes,
        }
      }
      return match
    }),
  })),
})

const swapScheduleMatchBlocks = (
  schedule: Schedule,
  leftMatches: Match[],
  rightMatches: Match[],
) => {
  const replacements = new Map<string, { court: number; start: number | undefined }>()
  const left = [...leftMatches].sort((a, b) => a.court - b.court)
  const right = [...rightMatches].sort((a, b) => a.court - b.court)
  for (let index = 0; index < left.length; index += 1) {
    replacements.set(left[index].id, {
      court: right[index].court,
      start: right[index].startOffsetMinutes,
    })
    replacements.set(right[index].id, {
      court: left[index].court,
      start: left[index].startOffsetMinutes,
    })
  }
  return {
    ...schedule,
    rounds: schedule.rounds.map((round) => ({
      ...round,
      matches: round.matches.map((match) => {
        const replacement = replacements.get(match.id)
        return replacement
          ? {
              ...match,
              court: replacement.court,
              startOffsetMinutes: replacement.start,
            }
          : match
      }),
    })),
  }
}

export const deferSkillWarningMatches = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
) => {
  let current = schedule
  const maximumAllowedWait = Math.max(
    WAIT_PRIORITY_MINUTES,
    analyzeScheduleWait(schedule, players, settings).maximumWaitMinutes,
  )
  const initialWarnings = schedule.rounds
    .flatMap((round) => round.matches)
    .filter((match) => getMatchSkillWarningLevel(match) !== 'none')
    .sort(
      (left, right) =>
        (left.startOffsetMinutes ?? 0) - (right.startOffsetMinutes ?? 0),
    )

  for (const initialWarning of initialWarnings) {
    const matches = current.rounds.flatMap((round) => round.matches)
    const warning = matches.find((match) => match.id === initialWarning.id)
    if (!warning) continue
    const warningStart = warning.startOffsetMinutes ?? 0
    const warningDuration = warning.durationMinutes ?? GAME_SLOT_MINUTES
    const warningBlock = matches.filter(
      (match) =>
        !match.isSpecial &&
        (match.startOffsetMinutes ?? 0) === warningStart &&
        (match.durationMinutes ?? GAME_SLOT_MINUTES) === warningDuration,
    )
    const balancedBlocks = [...new Set(
      matches
        .filter(
          (match) =>
            !match.isSpecial &&
            getMatchSkillWarningLevel(match) === 'none' &&
            (match.durationMinutes ?? GAME_SLOT_MINUTES) === warningDuration &&
            (match.startOffsetMinutes ?? 0) > warningStart,
        )
        .map((match) => match.startOffsetMinutes ?? 0),
    )]
      .sort((left, right) => right - left)
      .map((start) => matches.filter(
        (match) =>
          !match.isSpecial &&
          getMatchSkillWarningLevel(match) === 'none' &&
          (match.durationMinutes ?? GAME_SLOT_MINUTES) === warningDuration &&
          (match.startOffsetMinutes ?? 0) === start,
      ))
      .filter((block) => block.length === warningBlock.length)

    let movedAsBlock = false
    for (const balancedBlock of balancedBlocks) {
      const swapped = swapScheduleMatchBlocks(current, warningBlock, balancedBlock)
      if (validateMeetingSchedule(swapped, players, settings).length > 0) continue
      if (
        analyzeScheduleWait(swapped, players, settings).maximumWaitMinutes >
        maximumAllowedWait
      ) continue
      current = swapped
      movedAsBlock = true
      break
    }
    if (movedAsBlock) continue

    const laterBalancedMatches = matches
      .filter(
        (match) =>
          !match.isSpecial &&
          getMatchSkillWarningLevel(match) === 'none' &&
          (match.durationMinutes ?? GAME_SLOT_MINUTES) ===
            (warning.durationMinutes ?? GAME_SLOT_MINUTES) &&
          (match.startOffsetMinutes ?? 0) > warningStart,
      )
      .sort(
        (left, right) =>
          (right.startOffsetMinutes ?? 0) - (left.startOffsetMinutes ?? 0),
      )
      .slice(0, 24)

    for (const balanced of laterBalancedMatches) {
      const swapped = swapScheduleMatchSlots(current, warning, balanced)
      if (validateMeetingSchedule(swapped, players, settings).length > 0) continue
      if (
        analyzeScheduleWait(swapped, players, settings).maximumWaitMinutes >
        maximumAllowedWait
      ) continue
      current = swapped
      break
    }
  }

  return current
}

type ScheduleCandidate = {
  schedule: Schedule
  wait: ScheduleWaitAnalysis
  quality: ScheduleQualityAnalysis
  safetyIssues: string[]
  qualityFailureCount: number
  qualityFailureMagnitude: number
  index: number
}

const scheduleCourtCapacityMinutes = (
  settings: MatchSettings,
  normalGameMinutes: number,
) => {
  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
  )
  const schedulingMinutes =
    settings.roundCountLocked && normalGameMinutes === GAME_SLOT_MINUTES
      ? Math.min(
          bookingMinutes,
          normalizeTargetRoundCount(settings.targetRoundCount) * GAME_SLOT_MINUTES,
        )
      : bookingMinutes
  return schedulingMinutes * settings.courtCount
}

const compareNumberTuples = (left: number[], right: number[]) => {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

type GenderImbalanceSwapCandidate = {
  leftId: string
  rightId: string
  nextLeft: Match
  nextRight: Match
  score: number[]
}

const applyGenderImbalanceSwap = (
  schedule: Schedule,
  swap: GenderImbalanceSwapCandidate,
): Schedule => ({
  ...schedule,
  rounds: schedule.rounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) =>
      match.id === swap.leftId
        ? swap.nextLeft
        : match.id === swap.rightId
          ? swap.nextRight
          : match,
    ),
  })),
})

const generalMatchTimeKey = (match: Match, settings: MatchSettings) => [
  match.round,
  match.startOffsetMinutes ?? (match.round - 1) * GAME_SLOT_MINUTES,
  match.durationMinutes ?? settings.normalGameMinutes,
].join(':')

const matchGroupAssignmentKeys = (match: Match) => [
  matchPlayers(match).map((player) => player.id).sort().join('__'),
]

const matchPartnerAssignmentKeys = (match: Match) => [
  match.teamA.map((player) => player.id).sort().join('__'),
  match.teamB.map((player) => player.id).sort().join('__'),
]

const matchOpponentAssignmentKeys = (match: Match) =>
  match.teamA.flatMap((left) =>
    match.teamB.map((right) => [left.id, right.id].sort().join('__')),
  )

const assignmentCounts = (keys: string[]) => {
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return counts
}

const projectedAssignmentStats = (
  counts: Map<string, number>,
  removedKeys: string[],
  addedKeys: string[],
) => {
  const removed = assignmentCounts(removedKeys)
  const added = assignmentCounts(addedKeys)
  let maximum = Math.max(0, ...counts.values())
  let repeated = [...counts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  )
  const affectedKeys = new Set([...removed.keys(), ...added.keys()])
  for (const key of affectedKeys) {
    const current = counts.get(key) ?? 0
    const projected = Math.max(
      0,
      current -
        (removed.get(key) ?? 0) +
        (added.get(key) ?? 0),
    )
    maximum = Math.max(maximum, projected)
    repeated +=
      Math.max(0, projected - 1) - Math.max(0, current - 1)
  }
  return { maximum, repeated }
}

const matchSkillWarningCounts = (matches: Match[]) => ({
  danger: matches.filter(
    (match) => getMatchSkillWarningLevel(match) === 'danger',
  ).length,
  warning: matches.filter(
    (match) => getMatchSkillWarningLevel(match) !== 'none',
  ).length,
  individualDanger: matches.filter(
    (match) => getMatchIndividualSkillSpread(match) > TEAM_SKILL_WARNING_GAP,
  ).length,
  individualWarning: matches.filter(
    (match) => getMatchIndividualSkillSpread(match) >= TEAM_SKILL_PREFERRED_GAP,
  ).length,
})

const isSameLevelMatch = (match: Match) =>
  new Set(matchPlayers(match).map((player) => player.level)).size === 1

const sameLevelMatchCount = (matches: Match[]) =>
  matches.filter(isSameLevelMatch).length

const matchPartnerLevelGap = (match: Match) =>
  [match.teamA, match.teamB].reduce(
    (sum, team) =>
      sum + Math.abs(
        getPlayerMatchScore(team[0]) - getPlayerMatchScore(team[1]),
      ),
    0,
  )

const partnerLevelGapTotal = (matches: Match[]) => matches.reduce(
  (sum, match) => sum + matchPartnerLevelGap(match),
  0,
)

export const reduceGeneralGenderImbalanceMatches = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
): Schedule => {
  const conditions = matchConditions(settings)
  if (!conditions.genderBalance) return schedule

  let optimized = schedule
  const timeKeys = [...new Set(
    schedule.rounds.flatMap((round) =>
      round.matches
        .filter((match) => !match.isSpecial)
        .map((match) => generalMatchTimeKey(match, settings)),
    ),
  )]

  for (const timeKey of timeKeys) {
    const maximumSwaps = Math.max(
      1,
      Math.floor(
        optimized.rounds
          .flatMap((round) => round.matches)
          .filter(
            (match) =>
              !match.isSpecial &&
              generalMatchTimeKey(match, settings) === timeKey,
          ).length / 2,
      ),
    )

    for (let step = 0; step < maximumSwaps; step += 1) {
      const currentMatches = optimized.rounds
        .flatMap((round) => round.matches)
        .filter(
          (match) =>
            !match.isSpecial &&
            generalMatchTimeKey(match, settings) === timeKey,
        )
      const imbalancedMatches = currentMatches.filter(
        isMatchGenderImbalanceReview,
      )
      if (imbalancedMatches.length < 2) break

      const allMatches = optimized.rounds.flatMap((round) => round.matches)
      const groupCounts = assignmentCounts(
        allMatches.flatMap(matchGroupAssignmentKeys),
      )
      const partnerCounts = assignmentCounts(
        allMatches.flatMap(matchPartnerAssignmentKeys),
      )
      const opponentCounts = assignmentCounts(
        allMatches.flatMap(matchOpponentAssignmentKeys),
      )
      let best: GenderImbalanceSwapCandidate | null = null

      for (let leftIndex = 0; leftIndex < imbalancedMatches.length - 1; leftIndex += 1) {
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < imbalancedMatches.length;
          rightIndex += 1
        ) {
          const left = imbalancedMatches[leftIndex]
          const right = imbalancedMatches[rightIndex]
          const originalMatches = [left, right]
          const originalPairImbalance = Number(isMatchGenderImbalanceReview(left)) +
            Number(isMatchGenderImbalanceReview(right))
          const originalSkill = matchSkillWarningCounts(originalMatches)
          const originalSameLevelCount = sameLevelMatchCount(originalMatches)
          const originalPartnerLevelGap = partnerLevelGapTotal(originalMatches)
          const removedGroupKeys = originalMatches.flatMap(matchGroupAssignmentKeys)
          const removedPartnerKeys = originalMatches.flatMap(matchPartnerAssignmentKeys)
          const removedOpponentKeys = originalMatches.flatMap(matchOpponentAssignmentKeys)

          for (const leftPlayer of matchPlayers(left)) {
            for (const rightPlayer of matchPlayers(right)) {
              if (
                leftPlayer.gender === 'none' ||
                rightPlayer.gender === 'none' ||
                leftPlayer.gender === rightPlayer.gender
              ) {
                continue
              }
              const nextLeft = replaceMatchPlayer(
                left,
                leftPlayer.id,
                rightPlayer,
              )
              const nextRight = replaceMatchPlayer(
                right,
                rightPlayer.id,
                leftPlayer,
              )
              const nextPairImbalance =
                Number(isMatchGenderImbalanceReview(nextLeft)) +
                Number(isMatchGenderImbalanceReview(nextRight))
              if (nextPairImbalance >= originalPairImbalance) continue
              const nextMatches = [nextLeft, nextRight]
              const nextSkill = matchSkillWarningCounts(nextMatches)
              if (
                sameLevelMatchCount(nextMatches) < originalSameLevelCount ||
                partnerLevelGapTotal(nextMatches) > originalPartnerLevelGap ||
                nextSkill.warning - nextSkill.individualWarning !==
                  originalSkill.warning - originalSkill.individualWarning ||
                nextSkill.danger > originalSkill.danger ||
                nextSkill.warning > originalSkill.warning ||
                nextSkill.individualDanger > originalSkill.individualDanger ||
                nextSkill.individualWarning > originalSkill.individualWarning
              ) {
                continue
              }
              const groupStats = projectedAssignmentStats(
                groupCounts,
                removedGroupKeys,
                nextMatches.flatMap(matchGroupAssignmentKeys),
              )
              if (
                conditions.groupRepeat &&
                groupStats.maximum > MAX_GROUP_MEETINGS
              ) {
                continue
              }
              const partnerStats = projectedAssignmentStats(
                partnerCounts,
                removedPartnerKeys,
                nextMatches.flatMap(matchPartnerAssignmentKeys),
              )
              const opponentStats = projectedAssignmentStats(
                opponentCounts,
                removedOpponentKeys,
                nextMatches.flatMap(matchOpponentAssignmentKeys),
              )
              const score = [
                nextPairImbalance,
                groupStats.repeated,
                partnerStats.maximum,
                partnerStats.repeated,
                opponentStats.maximum,
                opponentStats.repeated,
                matchOverallSkillGap(nextLeft) + matchOverallSkillGap(nextRight),
              ]
              if (best === null || compareNumberTuples(score, best.score) < 0) {
                best = {
                  leftId: left.id,
                  rightId: right.id,
                  nextLeft,
                  nextRight,
                  score,
                }
              }
            }
          }
        }
      }

      if (best === null) break
      optimized = applyGenderImbalanceSwap(optimized, best)
    }
  }

  const remainingImbalanceCount = optimized.rounds
    .flatMap((round) => round.matches)
    .filter(isMatchGenderImbalanceReview).length
  for (let step = 0; step < Math.floor(remainingImbalanceCount / 2); step += 1) {
    const allMatches = optimized.rounds.flatMap((round) => round.matches)
    const imbalancedMatches = allMatches.filter(isMatchGenderImbalanceReview)
    if (imbalancedMatches.length < 2) break

    const groupCounts = assignmentCounts(
      allMatches.flatMap(matchGroupAssignmentKeys),
    )
    const partnerCounts = assignmentCounts(
      allMatches.flatMap(matchPartnerAssignmentKeys),
    )
    const opponentCounts = assignmentCounts(
      allMatches.flatMap(matchOpponentAssignmentKeys),
    )
    const maximumWaitMinutes = analyzeScheduleWait(
      optimized,
      players,
      settings,
    ).maximumWaitMinutes
    const candidates: GenderImbalanceSwapCandidate[] = []

    for (let leftIndex = 0; leftIndex < imbalancedMatches.length - 1; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < imbalancedMatches.length;
        rightIndex += 1
      ) {
        const left = imbalancedMatches[leftIndex]
        const right = imbalancedMatches[rightIndex]
        if (
          generalMatchTimeKey(left, settings) ===
            generalMatchTimeKey(right, settings) ||
          (left.durationMinutes ?? settings.normalGameMinutes) !==
            (right.durationMinutes ?? settings.normalGameMinutes)
        ) {
          continue
        }
        const originalMatches = [left, right]
        const originalSkill = matchSkillWarningCounts(originalMatches)
        const removedGroupKeys = originalMatches.flatMap(matchGroupAssignmentKeys)
        const removedPartnerKeys = originalMatches.flatMap(matchPartnerAssignmentKeys)
        const removedOpponentKeys = originalMatches.flatMap(matchOpponentAssignmentKeys)
        const conflictsAtTarget = (playerId: string, target: Match) =>
          allMatches.some(
            (match) =>
              match.id !== left.id &&
              match.id !== right.id &&
              windowsOverlap(match, target) &&
              matchPlayers(match).some((player) => player.id === playerId),
          )

        for (const leftPlayer of matchPlayers(left)) {
          for (const rightPlayer of matchPlayers(right)) {
            if (
              leftPlayer.gender === 'none' ||
              rightPlayer.gender === 'none' ||
              leftPlayer.gender === rightPlayer.gender ||
              matchPlayers(left).some(
                (player) => player.id === rightPlayer.id,
              ) ||
              matchPlayers(right).some(
                (player) => player.id === leftPlayer.id,
              ) ||
              conflictsAtTarget(leftPlayer.id, right) ||
              conflictsAtTarget(rightPlayer.id, left)
            ) {
              continue
            }
            const nextLeft = replaceMatchPlayer(
              left,
              leftPlayer.id,
              rightPlayer,
            )
            const nextRight = replaceMatchPlayer(
              right,
              rightPlayer.id,
              leftPlayer,
            )
            const nextMatches = [nextLeft, nextRight]
            if (nextMatches.some(isMatchGenderImbalanceReview)) continue
            const nextSkill = matchSkillWarningCounts(nextMatches)
            if (
              Number(isSameLevelMatch(nextLeft)) <
                Number(isSameLevelMatch(left)) ||
              Number(isSameLevelMatch(nextRight)) <
                Number(isSameLevelMatch(right)) ||
              matchPartnerLevelGap(nextLeft) > matchPartnerLevelGap(left) ||
              matchPartnerLevelGap(nextRight) > matchPartnerLevelGap(right) ||
              nextSkill.warning - nextSkill.individualWarning !==
                originalSkill.warning - originalSkill.individualWarning ||
              nextSkill.danger > originalSkill.danger ||
              nextSkill.warning > originalSkill.warning ||
              nextSkill.individualDanger > originalSkill.individualDanger ||
              nextSkill.individualWarning > originalSkill.individualWarning
            ) {
              continue
            }
            const groupStats = projectedAssignmentStats(
              groupCounts,
              removedGroupKeys,
              nextMatches.flatMap(matchGroupAssignmentKeys),
            )
            if (
              conditions.groupRepeat &&
              groupStats.maximum > MAX_GROUP_MEETINGS
            ) {
              continue
            }
            const partnerStats = projectedAssignmentStats(
              partnerCounts,
              removedPartnerKeys,
              nextMatches.flatMap(matchPartnerAssignmentKeys),
            )
            const opponentStats = projectedAssignmentStats(
              opponentCounts,
              removedOpponentKeys,
              nextMatches.flatMap(matchOpponentAssignmentKeys),
            )
            candidates.push({
              leftId: left.id,
              rightId: right.id,
              nextLeft,
              nextRight,
              score: [
                groupStats.repeated,
                partnerStats.maximum,
                partnerStats.repeated,
                opponentStats.maximum,
                opponentStats.repeated,
                Math.abs(
                  matchTimeWindow(left).start - matchTimeWindow(right).start,
                ),
                matchOverallSkillGap(nextLeft) + matchOverallSkillGap(nextRight),
              ],
            })
          }
        }
      }
    }

    let best: GenderImbalanceSwapCandidate | null = null
    for (const candidate of candidates
      .sort((left, right) => compareNumberTuples(left.score, right.score))
      .slice(0, 16)) {
      const candidateSchedule = applyGenderImbalanceSwap(optimized, candidate)
      if (
        validateMeetingSchedule(candidateSchedule, players, settings).length > 0
      ) {
        continue
      }
      if (
        analyzeScheduleWait(candidateSchedule, players, settings)
          .maximumWaitMinutes > maximumWaitMinutes
      ) {
        continue
      }
      best = candidate
      break
    }

    if (best === null) break
    optimized = applyGenderImbalanceSwap(optimized, best)
  }

  return refreshScheduleRestingPlayers(optimized, players)
}

const candidateQualityFailure = (
  schedule: Schedule,
  wait: ScheduleWaitAnalysis,
  quality: ScheduleQualityAnalysis,
  settings: MatchSettings,
) => {
  const normalGameMinutes = [10, 12, 15].includes(settings.normalGameMinutes)
    ? settings.normalGameMinutes
    : GAME_SLOT_MINUTES
  const conditions = matchConditions(settings)
  const scheduledMinutes = schedule.rounds
    .flatMap((round) => round.matches)
    .reduce(
      (sum, match) => sum + (match.durationMinutes ?? normalGameMinutes),
      0,
    )
  const unusedCourtMinutes = Math.max(
    0,
    scheduleCourtCapacityMinutes(settings, normalGameMinutes) - scheduledMinutes,
  )
  const missingMatchCapacity = Math.floor(
    unusedCourtMinutes / normalGameMinutes,
  )
  const skillFailure = !conditions.levelBalance
    ? 0
    : conditions.strictSkillLimit
      ? quality.teamSkillDangerMatches +
        Math.max(0, quality.teamSkillWarningMatches - 5)
      : Math.max(0, quality.teamSkillDangerMatches - 10) +
        Math.max(0, quality.teamSkillWarningMatches - 20)
  const failures = [
    quality.zeroGameStandardParticipants,
    Math.max(0, quality.standardGameSpread - 1),
    Math.max(0, wait.maximumWaitMinutes - WAIT_PRIORITY_MINUTES) /
      normalGameMinutes,
    missingMatchCapacity,
    conditions.groupRepeat
      ? Math.max(0, quality.maximumGroupMeetings - MAX_GROUP_MEETINGS)
      : 0,
    skillFailure,
  ]
  return {
    count: failures.filter((failure) => failure > 0).length,
    magnitude: failures.reduce((sum, failure) => sum + failure, 0),
  }
}

const skillCategoryComparison = (
  left: ScheduleCandidate,
  right: ScheduleCandidate,
) => compareNumberTuples(
  [
    left.quality.teamSkillWarningMatches,
    left.quality.teamSkillDangerMatches,
    -(left.quality.earliestSkillWarningStartMinutes ?? Number.MAX_SAFE_INTEGER),
    -(left.quality.averageSkillWarningStartMinutes ?? Number.MAX_SAFE_INTEGER),
    left.quality.maximumTeamSkillGap,
  ],
  [
    right.quality.teamSkillWarningMatches,
    right.quality.teamSkillDangerMatches,
    -(right.quality.earliestSkillWarningStartMinutes ?? Number.MAX_SAFE_INTEGER),
    -(right.quality.averageSkillWarningStartMinutes ?? Number.MAX_SAFE_INTEGER),
    right.quality.maximumTeamSkillGap,
  ],
)

const repetitionCategoryComparison = (
  left: ScheduleCandidate,
  right: ScheduleCandidate,
  conditions: MatchConditionOptions,
) => compareNumberTuples(
  [
    conditions.groupRepeat ? left.quality.repeatedGroupAssignments : 0,
    conditions.partnerRepeat ? left.quality.maximumPartnerMeetings : 0,
    conditions.partnerRepeat ? left.quality.repeatedPartnerAssignments : 0,
    conditions.opponentRepeat ? left.quality.maximumOpponentMeetings : 0,
    conditions.opponentRepeat ? left.quality.repeatedOpponentAssignments : 0,
  ],
  [
    conditions.groupRepeat ? right.quality.repeatedGroupAssignments : 0,
    conditions.partnerRepeat ? right.quality.maximumPartnerMeetings : 0,
    conditions.partnerRepeat ? right.quality.repeatedPartnerAssignments : 0,
    conditions.opponentRepeat ? right.quality.maximumOpponentMeetings : 0,
    conditions.opponentRepeat ? right.quality.repeatedOpponentAssignments : 0,
  ],
)

const preferenceCategoryComparison = (
  left: ScheduleCandidate,
  right: ScheduleCandidate,
) => compareNumberTuples(
  [left.quality.preferredPartnerUnfulfilled],
  [right.quality.preferredPartnerUnfulfilled],
)

const rebalanceStandardGameCounts = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
): Schedule => {
  const conditions = matchConditions(settings)
  const standardPlayers = players.filter(
    (player) => player.active && !player.isGuest && !player.gameCountFlexible,
  )
  if (standardPlayers.length < 2) return schedule

  let balancedSchedule = schedule
  const maximumPasses = Math.min(32, standardPlayers.length * 2)
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const matches = balancedSchedule.rounds.flatMap((round) => round.matches)
    const gameCounts = new Map(
      standardPlayers.map((player) => [
        player.id,
        matches.filter((match) =>
          [...match.teamA, ...match.teamB].some(
            (candidate) => candidate.id === player.id,
          ),
        ).length,
      ]),
    )
    const counts = [...gameCounts.values()]
    const minimum = Math.min(...counts)
    const maximum = Math.max(...counts)
    if (maximum - minimum <= 1) break

    const underplayed = standardPlayers.filter(
      (player) => gameCounts.get(player.id) === minimum,
    )
    const overplayed = standardPlayers.filter(
      (player) => gameCounts.get(player.id) === maximum,
    )
    const baseQuality = analyzeScheduleQuality(balancedSchedule, players, settings)
    const baseWait = analyzeScheduleWait(balancedSchedule, players, settings)
    let bestCandidate: {
      schedule: Schedule
      score: number[]
    } | null = null

    for (const incoming of underplayed) {
      for (const outgoing of overplayed) {
        for (const match of matches) {
          if (match.isSpecial) continue
          const matchPlayers = [...match.teamA, ...match.teamB]
          if (!matchPlayers.some((player) => player.id === outgoing.id)) continue
          if (matchPlayers.some((player) => player.id === incoming.id)) continue
          if (
            matches.some(
              (other) =>
                other.id !== match.id &&
                [...other.teamA, ...other.teamB].some(
                  (player) => player.id === incoming.id,
                ) &&
                windowsOverlap(match, other),
            )
          ) {
            continue
          }

          const replacementGroup = matchPlayers.map((player) =>
            player.id === outgoing.id ? incoming : player,
          ) as [Player, Player, Player, Player]
          for (const [teamA, teamB] of teamPairingOptions(replacementGroup)) {
            const replacementMatch = { ...match, teamA, teamB }
            const candidateSchedule: Schedule = {
              ...balancedSchedule,
              rounds: balancedSchedule.rounds.map((round) => ({
                ...round,
                matches: round.matches.map((candidateMatch) =>
                  candidateMatch.id === match.id
                    ? replacementMatch
                    : candidateMatch,
                ),
              })),
            }
            if (validateMeetingSchedule(candidateSchedule, players, settings).length > 0) {
              continue
            }
            const quality = analyzeScheduleQuality(candidateSchedule, players, settings)
            if (quality.standardGameSpread > baseQuality.standardGameSpread) {
              continue
            }
            if (
              conditions.groupRepeat &&
              quality.maximumGroupMeetings > MAX_GROUP_MEETINGS
            ) {
              continue
            }
            if (
              conditions.strictSkillLimit &&
              (quality.teamSkillDangerMatches > 0 ||
                quality.teamSkillWarningMatches > 5)
            ) {
              continue
            }
            const wait = analyzeScheduleWait(candidateSchedule, players, settings)
            if (
              wait.maximumWaitMinutes > Math.max(
                WAIT_PRIORITY_MINUTES,
                baseWait.maximumWaitMinutes,
              ) ||
              wait.zeroGameParticipantCount > baseWait.zeroGameParticipantCount
            ) {
              continue
            }

            const score = [
              quality.zeroGameStandardParticipants,
              quality.standardGameSpread,
              Math.max(
                0,
                new Set(replacementGroup.map((player) => player.level)).size -
                  new Set(matchPlayers.map((player) => player.level)).size,
              ),
              new Set(replacementGroup.map((player) => player.level)).size,
              quality.teamSkillDangerMatches,
              quality.teamSkillWarningMatches,
              quality.repeatedGroupAssignments,
              quality.repeatedPartnerAssignments,
              quality.repeatedOpponentAssignments,
              wait.maximumWaitMinutes,
              quality.averageWaitMinutes,
            ]
            if (
              bestCandidate === null ||
              compareNumberTuples(score, bestCandidate.score) < 0
            ) {
              bestCandidate = { schedule: candidateSchedule, score }
            }
          }
        }
      }
    }

    if (bestCandidate === null) break
    balancedSchedule = bestCandidate.schedule
  }
  return balancedSchedule
}

const categoryRank = (
  candidate: ScheduleCandidate,
  candidates: ScheduleCandidate[],
  compare: (left: ScheduleCandidate, right: ScheduleCandidate) => number,
) => candidates.filter((other) => compare(other, candidate) < 0).length

const compareMultiObjectiveCandidates = (
  left: ScheduleCandidate,
  right: ScheduleCandidate,
  candidates: ScheduleCandidate[],
  conditions: MatchConditionOptions,
  shuffleDirection: MeetingShuffleDirection,
) => {
  const comparisons = [
    left.qualityFailureCount - right.qualityFailureCount,
    left.qualityFailureMagnitude - right.qualityFailureMagnitude,
  ]
  const qualityDifference = comparisons.find((difference) => difference !== 0)
  if (qualityDifference !== undefined) return qualityDifference

  if (conditions.genderBalance) {
    const genderImbalanceDifference =
      left.quality.genderImbalanceReviewMatches -
      right.quality.genderImbalanceReviewMatches
    if (genderImbalanceDifference !== 0) return genderImbalanceDifference
  }

  if (shuffleDirection === 'variety') {
    const varietyDifference = compareNumberTuples(
      [
        left.quality.repeatedGroupAssignments,
        left.quality.maximumGroupMeetings,
        left.quality.maximumPartnerMeetings,
        left.quality.repeatedPartnerAssignments,
        left.quality.maximumOpponentMeetings,
        left.quality.repeatedOpponentAssignments,
      ],
      [
        right.quality.repeatedGroupAssignments,
        right.quality.maximumGroupMeetings,
        right.quality.maximumPartnerMeetings,
        right.quality.repeatedPartnerAssignments,
        right.quality.maximumOpponentMeetings,
        right.quality.repeatedOpponentAssignments,
      ],
    )
    if (varietyDifference !== 0) return varietyDifference
  }

  if (shuffleDirection === 'skill') {
    const skillDifference = compareNumberTuples(
      [
        left.quality.teamSkillDangerMatches,
        left.quality.teamSkillWarningMatches,
        left.quality.individualSkillDangerMatches,
        left.quality.individualSkillWarningMatches,
        left.quality.maximumTeamSkillGap,
        left.quality.maximumIndividualSkillSpread,
      ],
      [
        right.quality.teamSkillDangerMatches,
        right.quality.teamSkillWarningMatches,
        right.quality.individualSkillDangerMatches,
        right.quality.individualSkillWarningMatches,
        right.quality.maximumTeamSkillGap,
        right.quality.maximumIndividualSkillSpread,
      ],
    )
    if (skillDifference !== 0) return skillDifference
  }

  if (shuffleDirection === 'wait') {
    const waitDifference = compareNumberTuples(
      [
        left.wait.maximumWaitMinutes,
        left.quality.averageWaitMinutes,
        left.quality.participantsOverWaitLimit,
      ],
      [
        right.wait.maximumWaitMinutes,
        right.quality.averageWaitMinutes,
        right.quality.participantsOverWaitLimit,
      ],
    )
    if (waitDifference !== 0) return waitDifference
  }

  const categoryComparisons = [
    ...(conditions.levelBalance ? [skillCategoryComparison] : []),
    (candidate: ScheduleCandidate, other: ScheduleCandidate) =>
      repetitionCategoryComparison(candidate, other, conditions),
    preferenceCategoryComparison,
  ]
  const leftRank = categoryComparisons.reduce(
    (sum, compare) => sum + categoryRank(left, candidates, compare),
    0,
  )
  const rightRank = categoryComparisons.reduce(
    (sum, compare) => sum + categoryRank(right, candidates, compare),
    0,
  )
  return compareNumberTuples(
    [
      leftRank,
      left.quality.averageWaitMinutes,
      left.schedule.warnings.length,
      left.index,
    ],
    [
      rightRank,
      right.quality.averageWaitMinutes,
      right.schedule.warnings.length,
      right.index,
    ],
  )
}

export const generateScheduleWithWaitOptimization = (
  players: Player[],
  settings: MatchSettings,
  attemptCount = 3,
): Schedule => {
  const conditions = matchConditions(settings)
  const shuffleDirection = settings.shuffleDirection ?? 'balanced'
  const largeMeeting = players.filter((player) => player.active).length >= 40
  const strictSkillLimit = conditions.strictSkillLimit
  const requestedAttempts = Math.min(5, Math.max(1, Math.floor(attemptCount)))
  const maximumAttempts = largeMeeting && !strictSkillLimit
    ? Math.min(3, requestedAttempts)
    : requestedAttempts
  const minimumAttempts = conditions.strictSkillLimit
    ? 1
    : Math.min(largeMeeting ? 2 : 3, maximumAttempts)
  const candidates: ScheduleCandidate[] = []
  const strictSeeds = [17, 13, 12, 11, 15]
  for (let index = 0; index < maximumAttempts; index += 1) {
    const generatedSchedule = generateScheduleCandidate(
      players,
      {
        ...settings,
        seed: strictSkillLimit
          ? strictSeeds[index] ?? 17 + index
          : settings.seed + index,
      },
      true,
    )
    const schedule = rebalanceStandardGameCounts(
      generatedSchedule,
      players,
      settings,
    )
    const wait = analyzeScheduleWait(schedule, players, settings)
    const quality = analyzeScheduleQuality(schedule, players, settings)
    const failure = candidateQualityFailure(schedule, wait, quality, settings)
    candidates.push({
      schedule,
      wait,
      quality,
      safetyIssues: validateMeetingSchedule(schedule, players, settings),
      qualityFailureCount: failure.count,
      qualityFailureMagnitude: failure.magnitude,
      index,
    })
    if (
      shuffleDirection === 'balanced' &&
      candidates.length >= minimumAttempts &&
      candidates.some(
        (candidate) =>
          candidate.safetyIssues.length === 0 &&
          candidate.qualityFailureCount === 0,
      )
    ) break
  }

  const safeCandidates = candidates.filter(
    (candidate) => candidate.safetyIssues.length === 0,
  )
  const safePool = safeCandidates.length > 0 ? safeCandidates : candidates
  const qualifiedCandidates = safePool.filter(
    (candidate) => candidate.qualityFailureCount === 0,
  )
  const selectionPool = qualifiedCandidates.length > 0
    ? qualifiedCandidates
    : safePool
  const selected = [...selectionPool].sort((left, right) =>
    compareMultiObjectiveCandidates(
      left,
      right,
      selectionPool,
      conditions,
      shuffleDirection,
    ),
  )[0]
  const genderOptimizedSchedule = reduceGeneralGenderImbalanceMatches(
    selected.schedule,
    players,
    settings,
  )
  const deferredSchedule = conditions.levelBalance
    ? deferSkillWarningMatches(genderOptimizedSchedule, players, settings)
    : genderOptimizedSchedule
  const finalQuality = analyzeScheduleQuality(deferredSchedule, players, settings)
  const finalScheduledMinutes = deferredSchedule.rounds
    .flatMap((round) => round.matches)
    .reduce(
      (sum, match) =>
        sum + (match.durationMinutes ?? settings.normalGameMinutes),
      0,
    )
  const unusedCourtMinutes = Math.max(
    0,
    scheduleCourtCapacityMinutes(
      settings,
      [10, 12, 15].includes(settings.normalGameMinutes)
        ? settings.normalGameMinutes
        : GAME_SLOT_MINUTES,
    ) -
      finalScheduledMinutes,
  )
  const groupCapacityWarning =
    conditions.groupRepeat &&
    finalQuality.maximumGroupMeetings >= MAX_GROUP_MEETINGS &&
    unusedCourtMinutes >= settings.normalGameMinutes
      ? '동일 4인 2회 제한으로 일부 코트가 비었습니다.'
      : null
  const completedSchedule = groupCapacityWarning
    ? {
        ...deferredSchedule,
        warnings: [...deferredSchedule.warnings, groupCapacityWarning],
      }
    : deferredSchedule

  if (qualifiedCandidates.length > 0 || safeCandidates.length === 0) {
    return completedSchedule
  }
  return {
    ...completedSchedule,
    warnings: [
      ...completedSchedule.warnings,
      '동시 품질조건 후보 없음 · 가장 가까운 대진을 표시했습니다.',
    ],
  }
}

export type ScheduleGenerationResolution = {
  schedule: Schedule
  waitLimitFailure: MeetingWaitLimitFailure | null
}

const waitResolutionScore = (analysis: ScheduleWaitAnalysis) => [
  analysis.maximumWaitMinutes,
  analysis.maximumInitialWaitMinutes +
    analysis.maximumBetweenWaitMinutes +
    analysis.maximumFinalIdleMinutes,
]

const waitResolutionAlternative = (
  players: Player[],
  settings: MatchSettings,
) => {
  const schedule = generateScheduleWithWaitOptimization(players, settings, 1)
  const wait = analyzeScheduleWait(schedule, players, settings)
  const valid =
    !wait.exceedsLimit &&
    validateMeetingSchedule(schedule, players, settings).length === 0 &&
    validateMeetingFairness(schedule, players).length === 0
  return { schedule, wait, valid }
}

export const generateScheduleWithWaitResolution = (
  players: Player[],
  settings: MatchSettings,
  attemptCount = 5,
  onProgress?: (message: string) => void,
): ScheduleGenerationResolution => {
  const activePlayerCount = players.filter((player) => player.active).length
  const requestedAttempts = Math.min(5, Math.max(1, Math.floor(attemptCount)))
  const attemptsPerBatch =
    activePlayerCount >= 40 && !settings.conditionOptions.strictSkillLimit
      ? Math.min(3, requestedAttempts)
      : requestedAttempts
  const searchBatchCount = 3
  let searchedScheduleCount = 0
  let bestSchedule: Schedule | null = null
  let bestWait: ScheduleWaitAnalysis | null = null

  for (let batchIndex = 0; batchIndex < searchBatchCount; batchIndex += 1) {
    if (batchIndex > 0) {
      onProgress?.(
        `25분 이내 대진을 추가 탐색하고 있습니다. ${batchIndex + 1}/${searchBatchCount}`,
      )
    }
    const candidateSettings = {
      ...settings,
      seed: settings.seed + batchIndex * requestedAttempts,
    }
    const candidate = generateScheduleWithWaitOptimization(
      players,
      candidateSettings,
      requestedAttempts,
    )
    const wait = analyzeScheduleWait(candidate, players, candidateSettings)
    searchedScheduleCount += attemptsPerBatch
    if (
      bestWait === null ||
      compareNumberTuples(
        waitResolutionScore(wait),
        waitResolutionScore(bestWait),
      ) < 0
    ) {
      bestSchedule = candidate
      bestWait = wait
    }
    const valid =
      !wait.exceedsLimit &&
      validateMeetingSchedule(candidate, players, candidateSettings).length === 0 &&
      validateMeetingFairness(candidate, players).length === 0
    if (valid) {
      return { schedule: candidate, waitLimitFailure: null }
    }
  }

  const schedule = bestSchedule ?? generateSchedule(players, settings)
  const wait = bestWait ?? analyzeScheduleWait(schedule, players, settings)
  const participantViolations = analyzeParticipantWaitLimitViolations(
    schedule,
    players,
    settings,
  )
  const recommendations: MeetingWaitLimitFailure['recommendations'] = []

  onProgress?.('25분 제한을 충족하는 운영 대안을 계산하고 있습니다.')

  const shorterDurations = ([10, 12, 15] as const).filter(
    (duration) => duration < settings.normalGameMinutes,
  )
  for (const duration of shorterDurations) {
    const alternative = waitResolutionAlternative(players, {
      ...settings,
      normalGameMinutes: duration,
      seed: settings.seed + 101 + duration,
    })
    if (!alternative.valid) continue
    recommendations.push({
      kind: 'shorter-game',
      title: `경기 시간을 ${duration}분으로 단축`,
      detail: `재계산 최장 대기 ${alternative.wait.maximumWaitMinutes}분`,
      verified: true,
    })
    break
  }

  for (
    let courtCount = settings.courtCount + 1;
    courtCount <= Math.min(12, settings.courtCount + 2);
    courtCount += 1
  ) {
    const alternative = waitResolutionAlternative(players, {
      ...settings,
      courtCount,
      seed: settings.seed + 200 + courtCount,
    })
    if (!alternative.valid) continue
    recommendations.push({
      kind: 'more-courts',
      title: `코트를 ${courtCount}개로 확대`,
      detail: `재계산 최장 대기 ${alternative.wait.maximumWaitMinutes}분`,
      verified: true,
    })
    break
  }

  const relaxedConditions: MatchConditionOptions = {
    ...settings.conditionOptions,
    restBalance: false,
    levelBalance: false,
    ageBalance: false,
    genderBalance: false,
    partnerRepeat: false,
    opponentRepeat: false,
    groupRepeat: false,
    specialPriority: false,
    guestPartnerRepeat: false,
    femaleLevelFit: false,
    strictSkillLimit: false,
  }
  const relaxedAlternative = waitResolutionAlternative(players, {
    ...settings,
    conditionOptions: relaxedConditions,
    seed: settings.seed + 301,
  })
  if (relaxedAlternative.valid) {
    recommendations.push({
      kind: 'relax-conditions',
      title: '선택 균형 조건 완화',
      detail: `재계산 최장 대기 ${relaxedAlternative.wait.maximumWaitMinutes}분`,
      verified: true,
    })
  }

  if (wait.recommendedParticipantCount < activePlayerCount) {
    recommendations.push({
      kind: 'reduce-participants',
      title: `참가 인원 ${wait.recommendedParticipantCount}명 이하 검토`,
      detail: '현재 코트 회전율을 기준으로 계산한 권장 인원입니다.',
      verified: false,
    })
  }

  return {
    schedule,
    waitLimitFailure: {
      maximumWaitMinutes: wait.maximumWaitMinutes,
      maximumInitialWaitMinutes: wait.maximumInitialWaitMinutes,
      maximumBetweenWaitMinutes: wait.maximumBetweenWaitMinutes,
      maximumFinalIdleMinutes: wait.maximumFinalIdleMinutes,
      participantsOverLimit: participantViolations.length,
      recommendedParticipantCount: wait.recommendedParticipantCount,
      searchedScheduleCount,
      recommendations,
      participantViolations,
    },
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
  const matchWindowsByPlayer = new Map<string, Array<{ start: number; end: number }>>()

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

  const ensureStat = (player: Player) => {
    const existing = stats.get(player.id)
    if (existing) return existing

    const next: PlayerStat = {
      player,
      games: 0,
      averageWaitMinutes: null,
      maxWaitMinutes: null,
      firstWaitMinutes: null,
      lastMatchEndMinutes: null,
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
        const windows = matchWindowsByPlayer.get(player.id) ?? []
        windows.push(matchTimeWindow(match))
        matchWindowsByPlayer.set(player.id, windows)
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

  for (const [playerId, windows] of matchWindowsByPlayer) {
    const ordered = [...windows].sort((a, b) => a.start - b.start || a.end - b.end)
    const stat = stats.get(playerId)
    if (!stat || ordered.length === 0) continue
    stat.firstWaitMinutes = ordered[0].start
    stat.lastMatchEndMinutes = Math.max(...ordered.map((window) => window.end))
    if (ordered.length < 2) continue
    const waits: number[] = []
    let previousEnd = ordered[0].end
    for (const window of ordered.slice(1)) {
      waits.push(Math.max(0, window.start - previousEnd))
      previousEnd = Math.max(previousEnd, window.end)
    }
    stat.averageWaitMinutes = waits.reduce((sum, wait) => sum + wait, 0) / waits.length
    stat.maxWaitMinutes = Math.max(...waits)
  }

  return Array.from(stats.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    const pointDiff = b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst)
    if (pointDiff !== 0) return pointDiff
    return a.player.name.localeCompare(b.player.name)
  })
}
