import {
  generateMeetingScheduleV2WithWaitResolution,
  replanMeetingSchedule,
} from './matchmaker'
import {
  makeMeetingGenerationWorkerResponse,
  type MeetingGenerationWorkerResponse,
} from './meetingGenerationResult'
import type {
  MeetingContinuationState,
  MeetingCourtAssignments,
  MatchSettings,
  Player,
  Schedule,
} from './types'

type MeetingGenerationWorkerRequest = {
  kind?: 'generate'
  requestId: number
  players: Player[]
  settings: MatchSettings
  attemptCount: number
}

type MeetingReplanWorkerRequest = {
  kind: 'replan'
  requestId: number
  schedule: Schedule
  players: Player[]
  previousPlayers: Player[]
  settings: MatchSettings
  results: Record<string, {
    teamAScore: string
    teamBScore: string
    completed: boolean
    note: string
    winnerSide?: 'A' | 'B'
  }>
  assignments: MeetingCourtAssignments
  lockedMatchIds: string[]
  continuation: MeetingContinuationState
}

self.onmessage = (
  event: MessageEvent<MeetingGenerationWorkerRequest | MeetingReplanWorkerRequest>,
) => {
  const request = event.data
  const { requestId } = request
  try {
    if (request.kind === 'replan') {
      const replan = replanMeetingSchedule({
        schedule: request.schedule,
        players: request.players,
        previousPlayers: request.previousPlayers,
        settings: request.settings,
        results: request.results,
        assignments: request.assignments,
        lockedMatchIds: request.lockedMatchIds,
        continuation: request.continuation,
      })
      const response: MeetingGenerationWorkerResponse = { requestId, replan }
      self.postMessage(response)
      return
    }
    const { players, settings, attemptCount } = request
    const result = generateMeetingScheduleV2WithWaitResolution(
      players,
      settings,
      attemptCount,
      (progress) => {
        const response: MeetingGenerationWorkerResponse = {
          requestId,
          progress,
        }
        self.postMessage(response)
      },
    )
    const response = makeMeetingGenerationWorkerResponse(requestId, result)
    self.postMessage(response)
  } catch (error) {
    const response: MeetingGenerationWorkerResponse = {
      requestId,
      error: error instanceof Error ? error.message : '대진 생성 실패',
    }
    self.postMessage(response)
  }
}
