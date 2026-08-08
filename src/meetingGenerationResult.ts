import type { MeetingGenerationV2Resolution } from './matchmaker/engine'
import type {
  MeetingReplanResolution,
  MeetingWaitLimitFailure,
  Schedule,
} from './types'

export type MeetingGenerationWorkerResponse = {
  requestId: number
  schedule?: Schedule
  failureIssues?: string[]
  waitLimitFailure?: MeetingWaitLimitFailure
  replan?: MeetingReplanResolution
  progress?: string
  error?: string
}

const SPECIAL_TARGET_FAILURE_PREFIXES = [
  '스페셜 참가 대상 부족:',
  '스페셜 참가 목표 미달:',
  '스페셜 경기 목표 미달:',
  '스페셜 경기 미배정:',
] as const

export const isSpecialTargetFailureIssue = (issue: string) =>
  SPECIAL_TARGET_FAILURE_PREFIXES.some((prefix) => issue.startsWith(prefix))

export const canConfirmMeetingGenerationFailure = (
  failureIssues: string[],
  hasWaitLimitFailure: boolean,
) => hasWaitLimitFailure
  ? failureIssues.length === 0
  : failureIssues.length > 0 && failureIssues.every(isSpecialTargetFailureIssue)

export const makeMeetingGenerationWorkerResponse = (
  requestId: number,
  result: MeetingGenerationV2Resolution,
): MeetingGenerationWorkerResponse => {
  if (result.waitLimitFailure) {
    return {
      requestId,
      schedule: result.schedule,
      failureIssues: result.failureIssues,
      waitLimitFailure: result.waitLimitFailure,
    }
  }
  if (result.failureIssues.length > 0) {
    return {
      requestId,
      schedule: result.schedule,
      failureIssues: result.failureIssues,
      error: result.failureIssues.join(' · '),
    }
  }
  return { requestId, schedule: result.schedule, failureIssues: [] }
}
