import type {
  CourtAssignmentMode,
  Match,
  MatchResult,
  MatchWinnerSide,
  MeetingCourtAssignments,
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

export const toggleMeetingWinner = (
  result: MatchResult | undefined,
  winnerSide: MatchWinnerSide,
): MatchResult => {
  const current = result ?? emptyProgressResult()
  return {
    ...current,
    winnerSide: current.winnerSide === winnerSide ? undefined : winnerSide,
  }
}

export type MeetingCourtLane = {
  court: number
  pending: Match[]
  completed: Match[]
}

export type AvailableMeetingCourtLane = {
  court: number
  active?: Match
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
  left.court - right.court ||
  left.id.localeCompare(right.id)

export const getMeetingMatchSequence = (schedule: Schedule) =>
  schedule.rounds
    .flatMap((round) => round.matches)
    .sort(compareMeetingMatches)

export const getMeetingReplanLockedMatchIds = (
  schedule: Schedule,
  results: ResultsByMatch,
  assignments: MeetingCourtAssignments,
  courtAssignmentMode: CourtAssignmentMode,
) => {
  const sequence = getMeetingMatchSequence(schedule)
  const lockedIds = new Set(
    sequence
      .filter((match) => results[match.id]?.completed)
      .map((match) => match.id),
  )

  if (courtAssignmentMode === 'available') {
    for (const matchId of Object.keys(assignments)) {
      if (!results[matchId]?.completed) lockedIds.add(matchId)
    }
  } else {
    const courts = [...new Set(sequence.map((match) => match.court))]
    for (const court of courts) {
      const current = sequence.find(
        (match) => match.court === court && !results[match.id]?.completed,
      )
      if (current) lockedIds.add(current.id)
    }
  }

  return sequence
    .filter((match) => lockedIds.has(match.id))
    .map((match) => match.id)
}

export const getMeetingSequenceNumber = (
  schedule: Schedule,
  matchId: string,
) => {
  const index = getMeetingMatchSequence(schedule)
    .findIndex((match) => match.id === matchId)
  return index >= 0 ? index + 1 : 0
}

const meetingMatchPlayerIds = (match: Match) =>
  [...match.teamA, ...match.teamB].map((player) => player.id)

const activeAvailableMeetingMatches = (
  schedule: Schedule,
  assignments: MeetingCourtAssignments,
  results: ResultsByMatch,
) => {
  const matchesById = new Map(
    getMeetingMatchSequence(schedule).map((match) => [match.id, match]),
  )
  return Object.entries(assignments)
    .filter(([matchId]) => !results[matchId]?.completed)
    .map(([matchId]) => matchesById.get(matchId))
    .filter((match): match is Match => Boolean(match))
}

export const getNextAvailableMeetingMatch = (
  schedule: Schedule,
  assignments: MeetingCourtAssignments,
  results: ResultsByMatch,
  court?: number,
) => {
  const activePlayerIds = new Set(
    activeAvailableMeetingMatches(schedule, assignments, results)
      .flatMap(meetingMatchPlayerIds),
  )

  return getMeetingMatchSequence(schedule).find((match) =>
    !assignments[match.id] &&
    !results[match.id]?.completed &&
    (!match.isEventMatch || court === undefined || match.court === court) &&
    meetingMatchPlayerIds(match).every((playerId) => !activePlayerIds.has(playerId)),
  )
}

export const canAssignAvailableMeetingMatch = (
  schedule: Schedule,
  assignments: MeetingCourtAssignments,
  results: ResultsByMatch,
  matchId: string,
) => {
  const match = getMeetingMatchSequence(schedule)
    .find((candidate) => candidate.id === matchId)
  if (!match || assignments[matchId] || results[matchId]?.completed) return false
  const activePlayerIds = new Set(
    activeAvailableMeetingMatches(schedule, assignments, results)
      .flatMap(meetingMatchPlayerIds),
  )
  return meetingMatchPlayerIds(match)
    .every((playerId) => !activePlayerIds.has(playerId))
}

export const assignAvailableMeetingMatch = (
  schedule: Schedule,
  assignments: MeetingCourtAssignments,
  results: ResultsByMatch,
  court: number,
  matchId: string,
): MeetingCourtAssignments => {
  const courtOccupied = Object.entries(assignments).some(
    ([assignedMatchId, assignment]) =>
      assignment.court === court && !results[assignedMatchId]?.completed,
  )
  const match = getMeetingMatchSequence(schedule)
    .find((candidate) => candidate.id === matchId)
  if (
    courtOccupied ||
    !match ||
    (match.isEventMatch && match.court !== court) ||
    !canAssignAvailableMeetingMatch(schedule, assignments, results, matchId)
  ) return assignments

  const dispatchOrder = Math.max(
    0,
    ...Object.values(assignments).map((assignment) => assignment.dispatchOrder),
  ) + 1
  return {
    ...assignments,
    [matchId]: { court, dispatchOrder },
  }
}

export const assignAvailableMeetingMatchToFirstEmptyCourt = (
  schedule: Schedule,
  courtCount: number,
  assignments: MeetingCourtAssignments,
  results: ResultsByMatch,
  matchId: string,
) => {
  const match = getMeetingMatchSequence(schedule)
    .find((candidate) => candidate.id === matchId)
  const courtCandidates = match?.isEventMatch
    ? [match.court]
    : Array.from({ length: courtCount }, (_, index) => index + 1)
  const court = courtCandidates
    .find((candidateCourt) =>
      !Object.entries(assignments).some(
        ([assignedMatchId, assignment]) =>
          assignment.court === candidateCourt &&
          !results[assignedMatchId]?.completed,
      ),
    )
  if (!court) return { assignments, court: undefined }

  const nextAssignments = assignAvailableMeetingMatch(
    schedule,
    assignments,
    results,
    court,
    matchId,
  )
  return {
    assignments: nextAssignments,
    court: nextAssignments === assignments ? undefined : court,
  }
}

export const assignNextAvailableMeetingMatch = (
  schedule: Schedule,
  assignments: MeetingCourtAssignments,
  results: ResultsByMatch,
  court: number,
): MeetingCourtAssignments => {
  const nextMatch = getNextAvailableMeetingMatch(
    schedule,
    assignments,
    results,
    court,
  )
  if (!nextMatch) return assignments
  return assignAvailableMeetingMatch(
    schedule,
    assignments,
    results,
    court,
    nextMatch.id,
  )
}

export const initializeAvailableMeetingAssignments = (
  schedule: Schedule,
  courtCount: number,
  assignments: MeetingCourtAssignments = {},
  results: ResultsByMatch = {},
) => {
  let nextAssignments = assignments
  for (let court = 1; court <= courtCount; court += 1) {
    nextAssignments = assignNextAvailableMeetingMatch(
      schedule,
      nextAssignments,
      results,
      court,
    )
  }
  return nextAssignments
}

export const buildAvailableMeetingCourtLanes = (
  schedule: Schedule,
  courtCount: number,
  assignments: MeetingCourtAssignments,
  results: ResultsByMatch,
): AvailableMeetingCourtLane[] => {
  const matchesById = new Map(
    getMeetingMatchSequence(schedule).map((match) => [match.id, match]),
  )

  return Array.from({ length: courtCount }, (_, index) => {
    const court = index + 1
    const courtMatches = Object.entries(assignments)
      .filter(([, assignment]) => assignment.court === court)
      .sort((left, right) => left[1].dispatchOrder - right[1].dispatchOrder)
      .map(([matchId]) => matchesById.get(matchId))
      .filter((match): match is Match => Boolean(match))
    return {
      court,
      active: courtMatches.find((match) => !results[match.id]?.completed),
      completed: courtMatches.filter((match) => results[match.id]?.completed),
    }
  })
}

export const canUndoAvailableMeetingMatch = (
  schedule: Schedule,
  matchId: string,
  assignments: MeetingCourtAssignments,
  results: ResultsByMatch,
) => {
  const assignment = assignments[matchId]
  if (!assignment || !results[matchId]?.completed) return false
  const hasLaterCourtAssignment = Object.entries(assignments).some(
    ([otherMatchId, otherAssignment]) =>
      otherMatchId !== matchId &&
      otherAssignment.court === assignment.court &&
      otherAssignment.dispatchOrder > assignment.dispatchOrder,
  )
  if (hasLaterCourtAssignment) return false

  const match = getMeetingMatchSequence(schedule)
    .find((candidate) => candidate.id === matchId)
  if (!match) return false
  const playerIds = new Set(meetingMatchPlayerIds(match))
  return activeAvailableMeetingMatches(schedule, assignments, results)
    .every((activeMatch) =>
      meetingMatchPlayerIds(activeMatch)
        .every((playerId) => !playerIds.has(playerId)),
    )
}

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
