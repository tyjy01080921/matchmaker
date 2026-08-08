import {
  clockTimeAtOffset,
  getBookingDurationMinutes,
  parseClockTime,
} from './scheduleTime'
import type { MatchSettings, Player, Schedule } from './types'

export type MeetingAttendanceWindow = {
  start: number
  end: number
  duration: number
  isCustom: boolean
  priority: boolean
}

export type MeetingConsecutiveGameLimitViolation = {
  playerId: string
  matchId: string
  streak: number
  maximum: number
}

const optionalOffset = (value: unknown) => {
  if (value === undefined || value === null || value === '') return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric)
    ? Math.max(0, Math.floor(numeric))
    : undefined
}

export const normalizeAttendanceOffset = (value: unknown) =>
  optionalOffset(value)

export const usesMeetingAttendanceGameLimit = (
  player: Pick<
    Player,
    'arrivalOffsetMinutes' | 'departureOffsetMinutes' | 'attendancePriority'
  >,
) => Boolean(player.attendancePriority) ||
  player.arrivalOffsetMinutes !== undefined ||
  player.departureOffsetMinutes !== undefined

export const maximumConsecutiveMeetingGames = (
  player: Pick<Player, 'attendancePriority'>,
) => player.attendancePriority ? 3 : 2

export const findMeetingConsecutiveGameLimitViolations = (
  schedule: Schedule,
): MeetingConsecutiveGameLimitViolation[] => {
  const state = new Map<string, { end: number; streak: number }>()
  const violations: MeetingConsecutiveGameLimitViolation[] = []
  const matches = schedule.rounds
    .flatMap((round) => round.matches)
    .sort((left, right) =>
      (left.startOffsetMinutes ?? (left.round - 1) * 15) -
        (right.startOffsetMinutes ?? (right.round - 1) * 15) ||
      left.court - right.court ||
      left.id.localeCompare(right.id),
    )

  for (const match of matches) {
    const start = match.startOffsetMinutes ?? (match.round - 1) * 15
    const end = start + (match.durationMinutes ?? 15)
    for (const player of [...match.teamA, ...match.teamB]) {
      if (!usesMeetingAttendanceGameLimit(player)) continue
      const previous = state.get(player.id)
      const streak = previous?.end === start ? previous.streak + 1 : 1
      const maximum = maximumConsecutiveMeetingGames(player)
      if (streak > maximum) {
        violations.push({
          playerId: player.id,
          matchId: match.id,
          streak,
          maximum,
        })
      }
      state.set(player.id, { end, streak })
    }
  }
  return violations
}

export const meetingClockTimeToOffset = (
  value: unknown,
  settings: Pick<MatchSettings, 'startTime' | 'endTime'>,
) => {
  const start = parseClockTime(settings.startTime)
  const clock = parseClockTime(value)
  if (start === null || clock === null) return null

  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
  )
  const offset = (clock - start + 24 * 60) % (24 * 60)
  return offset <= bookingMinutes ? offset : null
}

export const resolveMeetingAttendanceWindow = (
  player: Pick<
    Player,
    'arrivalOffsetMinutes' | 'departureOffsetMinutes' | 'attendancePriority'
  >,
  settings: Pick<MatchSettings, 'startTime' | 'endTime'>,
): MeetingAttendanceWindow => {
  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
  )
  const rawStart = optionalOffset(player.arrivalOffsetMinutes)
  const rawEnd = optionalOffset(player.departureOffsetMinutes)
  const start = Math.min(bookingMinutes, rawStart ?? 0)
  const end = Math.max(
    start,
    Math.min(bookingMinutes, rawEnd ?? bookingMinutes),
  )
  return {
    start,
    end,
    duration: Math.max(0, end - start),
    isCustom: rawStart !== undefined || rawEnd !== undefined,
    priority: Boolean(player.attendancePriority),
  }
}

export const isPlayerAvailableForMeetingSlot = (
  player: Player,
  settings: MatchSettings,
  start: number,
  duration: number,
) => {
  const window = resolveMeetingAttendanceWindow(player, settings)
  if (!window.isCustom) return true
  return start >= window.start && start + duration <= window.end
}

export const attendanceWindowIssue = (
  player: Player,
  settings: MatchSettings,
  minimumDuration = settings.normalGameMinutes,
) => {
  const window = resolveMeetingAttendanceWindow(player, settings)
  if (window.duration >= minimumDuration) return null
  const name = player.name.trim() || player.id
  return `${name} 참석 시간이 ${minimumDuration}분보다 짧습니다.`
}

export const meetingAttendanceTimeLabel = (
  player: Player,
  settings: MatchSettings,
) => {
  const window = resolveMeetingAttendanceWindow(player, settings)
  return `${clockTimeAtOffset(settings.startTime, window.start)}–${clockTimeAtOffset(
    settings.startTime,
    window.end,
  )}`
}

export const attendanceTargetGameCount = (
  player: Player,
  settings: MatchSettings,
  fullAttendanceTarget: number,
  maximumOpportunities: number,
) => {
  const window = resolveMeetingAttendanceWindow(player, settings)
  if (maximumOpportunities <= 0 || window.duration < settings.normalGameMinutes) {
    return 0
  }
  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
  )
  const desired = window.priority
    ? Math.round(fullAttendanceTarget)
    : Math.round(fullAttendanceTarget * window.duration / bookingMinutes)
  const flexibleCredit = !player.isGuest && player.gameCountFlexible ? 1 : 0
  return Math.min(
    maximumOpportunities,
    Math.max(1, desired - flexibleCredit),
  )
}
