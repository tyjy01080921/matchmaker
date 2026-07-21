import { generateScheduleWithWaitResolution } from './matchmaker'
import type {
  MatchSettings,
  MeetingWaitLimitFailure,
  Player,
  Schedule,
} from './types'

type MeetingGenerationWorkerRequest = {
  requestId: number
  players: Player[]
  settings: MatchSettings
  attemptCount: number
}

type MeetingGenerationWorkerResponse = {
  requestId: number
  schedule?: Schedule
  waitLimitFailure?: MeetingWaitLimitFailure
  progress?: string
  error?: string
}

self.onmessage = (event: MessageEvent<MeetingGenerationWorkerRequest>) => {
  const { requestId, players, settings, attemptCount } = event.data
  try {
    const result = generateScheduleWithWaitResolution(
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
    const response: MeetingGenerationWorkerResponse = result.waitLimitFailure
      ? {
          requestId,
          schedule: result.schedule,
          waitLimitFailure: result.waitLimitFailure,
        }
      : { requestId, schedule: result.schedule }
    self.postMessage(response)
  } catch (error) {
    const response: MeetingGenerationWorkerResponse = {
      requestId,
      error: error instanceof Error ? error.message : '대진 생성 실패',
    }
    self.postMessage(response)
  }
}
