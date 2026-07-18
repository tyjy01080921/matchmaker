import type {
  Match,
  MatchResult,
  MatchWinnerSide,
  ResultsByMatch,
  Schedule,
  TournamentMatch,
  TournamentMatchResult,
  TournamentResultsByMatch,
} from './types'

const emptyProgressResult = (): MatchResult => ({
  teamAScore: '',
  teamBScore: '',
  completed: false,
  note: '',
})

const progressScoreNumber = (value: string) => {
  if (!value.trim()) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

export const hasProgressScorePair = (result: MatchResult | undefined) =>
  progressScoreNumber(result?.teamAScore ?? '') !== null &&
  progressScoreNumber(result?.teamBScore ?? '') !== null

export const getProgressScoreWinnerSide = (
  result: MatchResult | undefined,
): MatchWinnerSide | undefined => {
  if (!hasProgressScorePair(result)) return undefined
  const teamAScore = Number(result?.teamAScore)
  const teamBScore = Number(result?.teamBScore)
  if (teamAScore === teamBScore) return undefined
  return teamAScore > teamBScore ? 'A' : 'B'
}

export const getProgressWinnerSide = (result: MatchResult | undefined) =>
  getProgressScoreWinnerSide(result) ?? result?.winnerSide

export const updateProgressScore = (
  result: MatchResult | undefined,
  side: MatchWinnerSide,
  value: string,
): MatchResult => {
  const next = {
    ...(result ?? emptyProgressResult()),
    [side === 'A' ? 'teamAScore' : 'teamBScore']: value,
    completed: false,
  }
  return {
    ...next,
    winnerSide: getProgressScoreWinnerSide(next),
  }
}

export const toggleProgressWinner = (
  result: MatchResult | undefined,
  winnerSide: MatchWinnerSide,
): MatchResult => {
  const current = result ?? emptyProgressResult()
  if (hasProgressScorePair(current)) return { ...current, completed: false }
  return {
    ...current,
    completed: false,
    winnerSide: current.winnerSide === winnerSide ? undefined : winnerSide,
  }
}

export type MeetingCourtLane = {
  court: number
  pending: Match[]
  completed: Match[]
}

export type TournamentCourtLane = {
  court: number
  ready: TournamentMatch[]
  waiting: TournamentMatch[]
  completed: TournamentMatch[]
}

export const getProgressCourtPageSize = (
  viewportWidth: number,
  viewportHeight: number,
) => {
  const isLandscape = viewportWidth > viewportHeight
  if (isLandscape && viewportHeight <= 620) return 4
  if (isLandscape && viewportWidth >= 1100) return 6
  if (viewportWidth >= 620) return 2
  return 1
}

const meetingStartOffset = (match: Match) =>
  match.startOffsetMinutes ?? (match.round - 1) * 15

const compareMeetingMatches = (left: Match, right: Match) =>
  meetingStartOffset(left) - meetingStartOffset(right) ||
  left.round - right.round ||
  left.id.localeCompare(right.id)

const compareTournamentMatches = (
  left: TournamentMatch,
  right: TournamentMatch,
) =>
  left.round - right.round ||
  left.order - right.order ||
  left.id.localeCompare(right.id)

export const getMeetingCourtMatchNumber = (
  lane: MeetingCourtLane,
  matchId: string,
) => {
  const index = [...lane.pending, ...lane.completed]
    .sort(compareMeetingMatches)
    .findIndex((match) => match.id === matchId)
  return index >= 0 ? index + 1 : 0
}

export const getTournamentCourtMatchNumber = (
  lane: TournamentCourtLane,
  matchId: string,
) => {
  const index = [...lane.ready, ...lane.waiting, ...lane.completed]
    .sort(compareTournamentMatches)
    .findIndex((match) => match.id === matchId)
  return index >= 0 ? index + 1 : 0
}

export const hasTournamentWinner = (
  result: TournamentMatchResult | undefined,
) => {
  if (!result?.completed) return false
  if (result.winnerSide === 'A' || result.winnerSide === 'B') return true

  const teamAScoreText = result.teamAScore.trim()
  const teamBScoreText = result.teamBScore.trim()
  if (!teamAScoreText || !teamBScoreText) return false

  const teamAScore = Number(teamAScoreText)
  const teamBScore = Number(teamBScoreText)
  return Number.isFinite(teamAScore) &&
    Number.isFinite(teamBScore) &&
    teamAScore !== teamBScore
}

export const isTournamentMatchCompleted = (
  match: TournamentMatch,
  result: TournamentMatchResult | undefined,
) => match.isBye || Boolean(
  match.teamAId &&
  match.teamBId &&
  hasTournamentWinner(result),
)

export const buildMeetingCourtLanes = (
  schedule: Schedule,
  results: ResultsByMatch,
): MeetingCourtLane[] => {
  const matches = schedule.rounds
    .flatMap((round) => round.matches)
    .sort(compareMeetingMatches)
  const courts = [...new Set(matches.map((match) => match.court))]
    .sort((left, right) => left - right)

  return courts.map((court) => {
    const courtMatches = matches.filter((match) => match.court === court)
    return {
      court,
      pending: courtMatches.filter((match) => !results[match.id]?.completed),
      completed: courtMatches.filter((match) => results[match.id]?.completed),
    }
  })
}

export const buildTournamentCourtLanes = (
  matches: TournamentMatch[],
  results: TournamentResultsByMatch,
): TournamentCourtLane[] => {
  const playableMatches = matches
    .filter((match) => !match.isBye)
    .sort(compareTournamentMatches)
  const courts = [...new Set(playableMatches.map((match) => match.court))]
    .sort((left, right) => left - right)

  return courts.map((court) => {
    const courtMatches = playableMatches.filter((match) => match.court === court)
    return {
      court,
      ready: courtMatches.filter(
        (match) =>
          Boolean(match.teamAId && match.teamBId) &&
          !isTournamentMatchCompleted(match, results[match.id]),
      ),
      waiting: courtMatches.filter(
        (match) =>
          !match.teamAId ||
          !match.teamBId,
      ),
      completed: courtMatches.filter((match) =>
        isTournamentMatchCompleted(match, results[match.id]),
      ),
    }
  })
}

export const getUndoableTournamentMatchId = (
  matches: TournamentMatch[],
  results: TournamentResultsByMatch,
) =>
  matches
    .filter(
      (match) =>
        !match.isBye &&
        isTournamentMatchCompleted(match, results[match.id]),
    )
    .sort(compareTournamentMatches)
    .at(-1)?.id
