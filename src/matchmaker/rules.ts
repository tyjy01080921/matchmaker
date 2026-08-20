import { getBookingDurationMinutes } from '../scheduleTime'
import type {
  MatchConditionOptions,
  MatchSettings,
  MeetingShuffleDirection,
  Player,
} from '../types'
import {
  attendanceWindowIssue,
  resolveMeetingAttendanceWindow,
} from '../meetingAvailability'

export const MEETING_MAX_WAIT_MINUTES = 24
export const MEETING_ABSOLUTE_MAX_WAIT_MINUTES = 36
export const MEETING_FINAL_IDLE_LIMIT_MINUTES = 30
export const MEETING_MAX_STANDARD_GAME_SPREAD = 1
export const MEETING_MAX_GROUP_MEETINGS = 2
export const MEETING_SKILL_CAUTION_GAP = 30
export const MEETING_SKILL_DANGER_GAP = 40
export const MEETING_STRICT_CAUTION_LIMIT = 5
export const MEETING_TIGHT_GAME_MINIMUM = 2
export const MEETING_TIGHT_GAME_TARGET = 3

export type MeetingHardRules = {
  singleGuestPerMatch: boolean
  maxGroupMeetings: number | null
  strictSkillLimit: boolean
  maxStrictCautionMatches: number
}

export type MeetingSuccessRules = {
  requireEveryStandardPlayer: boolean
  maxStandardGameSpread: number
  maxWaitMinutes: number
  finalIdleLimitMinutes: number
}

export type MeetingPreferenceKey =
  | 'games'
  | 'wait'
  | 'skill'
  | 'groupRepeat'
  | 'partnerRepeat'
  | 'opponentRepeat'
  | 'preferredPartner'
  | 'gender'
  | 'age'
  | 'rest'

export type MeetingRuleProfile = {
  conditions: MatchConditionOptions
  hard: MeetingHardRules
  success: MeetingSuccessRules
  priorityOrder: MeetingPreferenceKey[]
}

export type MeetingPreflightIssueCode =
  | 'not-enough-players'
  | 'not-enough-regulars-for-special'
  | 'no-courts'
  | 'no-booking-time'
  | 'no-playable-slot'
  | 'invalid-attendance-window'
  | 'insufficient-standard-capacity'
  | 'insufficient-special-capacity'

export type MeetingPreflightIssue = {
  code: MeetingPreflightIssueCode
  message: string
}

const priorityOrder = (
  direction: MeetingShuffleDirection,
): MeetingPreferenceKey[] => {
  const tail: MeetingPreferenceKey[] = [
    'preferredPartner',
    'gender',
    'age',
    'rest',
  ]
  if (direction === 'wait') {
    return [
      'wait',
      'games',
      'skill',
      'groupRepeat',
      'partnerRepeat',
      'opponentRepeat',
      ...tail,
    ]
  }
  if (direction === 'skill') {
    return [
      'skill',
      'games',
      'wait',
      'groupRepeat',
      'partnerRepeat',
      'opponentRepeat',
      ...tail,
    ]
  }
  if (direction === 'variety') {
    return [
      'groupRepeat',
      'partnerRepeat',
      'opponentRepeat',
      'games',
      'wait',
      'skill',
      ...tail,
    ]
  }
  return [
    'games',
    'wait',
    'skill',
    'groupRepeat',
    'partnerRepeat',
    'opponentRepeat',
    ...tail,
  ]
}

export const resolveMeetingRuleProfile = (
  settings: MatchSettings,
): MeetingRuleProfile => {
  const conditions: MatchConditionOptions = {
    ...settings.conditionOptions,
    fairGames: true,
    waitPriority: true,
    levelBalance: true,
    ageBalance: true,
    genderBalance: true,
    restBalance: true,
    partnerRepeat: true,
    opponentRepeat: true,
    groupRepeat: true,
    specialMatchCreation: true,
    specialPriority: true,
    guestPartnerRepeat: true,
    femaleLevelFit: false,
    strictSkillLimit: false,
  }
  return {
    conditions,
    hard: {
      singleGuestPerMatch: settings.singleGuestPerMatch,
      maxGroupMeetings: conditions.groupRepeat
        ? MEETING_MAX_GROUP_MEETINGS
        : null,
      strictSkillLimit: false,
      maxStrictCautionMatches: MEETING_STRICT_CAUTION_LIMIT,
    },
    success: {
      requireEveryStandardPlayer: true,
      maxStandardGameSpread: MEETING_MAX_STANDARD_GAME_SPREAD,
      maxWaitMinutes: MEETING_MAX_WAIT_MINUTES,
      finalIdleLimitMinutes: MEETING_FINAL_IDLE_LIMIT_MINUTES,
    },
    priorityOrder: priorityOrder('balanced'),
  }
}

const normalizedRoundCount = (settings: MatchSettings) => {
  const value = Number(settings.targetRoundCount)
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 8
}

export const meetingSchedulingMinutes = (settings: MatchSettings) => {
  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
  )
  return settings.roundCountLocked && settings.normalGameMinutes === 15
    ? Math.min(bookingMinutes, normalizedRoundCount(settings) * 15)
    : bookingMinutes
}

const configuredSpecialTarget = (settings: MatchSettings) => {
  const target = Math.floor(Number(settings.specialParticipantTarget) || 0)
  return Math.max(3, Math.floor(target / 3) * 3)
}

export const balancedParticipantGameTarget = (
  activePlayers: Player[],
  settings: MatchSettings,
) => {
  const participantCount = activePlayers.filter((player) => player.active).length
  if (participantCount === 0) return 0
  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
  )
  const matchCapacity = Math.max(
    0,
    settings.courtCount * Math.floor(
      bookingMinutes / settings.normalGameMinutes,
    ),
  )
  return Math.floor(matchCapacity * 4 / participantCount)
}

export const plannedGuestGames = (
  guest: Player,
  _activePlayers: Player[],
  settings: MatchSettings,
) => {
  const schedulingMinutes = meetingSchedulingMinutes(settings)
  const timeLimit =
    settings.specialLimitEnabled &&
    settings.specialScheduleMode !== 'spread' &&
    settings.specialTimeLimitEnabled
      ? Math.min(schedulingMinutes, settings.specialTimeLimitMinutes)
      : schedulingMinutes
  const attendance = resolveMeetingAttendanceWindow(guest, settings)
  const availableMinutes = Math.max(
    0,
    Math.min(attendance.end, timeLimit) - attendance.start,
  )
  const timeCapacity = Math.max(
    0,
    Math.floor(availableMinutes / settings.normalGameMinutes),
  )

  if (settings.specialLimitEnabled) {
    const configuredLimit = settings.specialGameLimitEnabled
      ? Math.max(1, Math.floor(settings.specialGameLimit))
      : timeCapacity
    return Math.min(timeCapacity, configuredLimit)
  }

  return timeCapacity
}

export const eventMatchParticipantIds = (settings: MatchSettings) =>
  new Set(
    settings.eventMatch.enabled
      ? settings.eventMatch.participants.flatMap((participant) =>
          participant.playerId ? [participant.playerId] : [],
        )
      : [],
  )

export const plannedOrdinaryGuestGames = (
  guest: Player,
  activePlayers: Player[],
  settings: MatchSettings,
) => plannedGuestGames(guest, activePlayers, settings)

export const plannedGuestScheduleGames = (
  guest: Player,
  activePlayers: Player[],
  settings: MatchSettings,
) => {
  const target = plannedGuestGames(guest, activePlayers, settings)
  return eventMatchParticipantIds(settings).has(guest.id) ? target + 1 : target
}

export const specialParticipantTarget = (
  activePlayers: Player[],
  settings: MatchSettings,
) => {
  const eligibleCount = activePlayers.filter(
    (player) => !player.isGuest && (player.specialMatchEligible ?? true),
  ).length
  return settings.specialLimitEnabled
    ? Math.min(eligibleCount, configuredSpecialTarget(settings))
    : eligibleCount
}

export const allowsFixedCourtGuestOverflow = (
  activePlayers: Player[],
  settings: MatchSettings,
) => settings.singleGuestPerMatch &&
  settings.courtAssignmentMode === 'fixed' &&
  activePlayers.filter((player) => player.active && player.isGuest).length >
    settings.courtCount

export type TwoGuestDistinctCoverageRule = {
  guestIds: [string, string]
  participantTarget: number
}

export const twoGuestDistinctCoverageRule = (
  activePlayers: Player[],
  settings: MatchSettings,
): TwoGuestDistinctCoverageRule | null => {
  const players = activePlayers.filter((player) => player.active)
  const guests = players.filter((player) => player.isGuest)
  if (
    !settings.specialLimitEnabled ||
    !settings.singleGuestPerMatch ||
    guests.length !== 2 ||
    allowsFixedCourtGuestOverflow(players, settings)
  ) {
    return null
  }

  const participantTarget = specialParticipantTarget(players, settings)
  if (participantTarget <= 0) return null

  return {
    guestIds: [guests[0].id, guests[1].id],
    participantTarget,
  }
}

export const preflightMeetingGeneration = (
  players: Player[],
  settings: MatchSettings,
): MeetingPreflightIssue[] => {
  const activePlayers = players.filter((player) => player.active)
  const activeRegulars = activePlayers.filter((player) => !player.isGuest)
  const activeGuests = activePlayers.filter((player) => player.isGuest)
  const specialEnabled = activeGuests.length > 0
  const issues: MeetingPreflightIssue[] = []

  if (activePlayers.length < 4) {
    issues.push({
      code: 'not-enough-players',
      message: '참가자가 4명 이상이어야 대진을 만들 수 있습니다.',
    })
  }
  if (settings.courtCount < 1) {
    issues.push({ code: 'no-courts', message: '사용 가능한 코트가 없습니다.' })
  }
  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
    0,
  )
  if (bookingMinutes <= 0) {
    issues.push({
      code: 'no-booking-time',
      message: '운영 시작·종료 시간을 확인해 주세요.',
    })
  }
  const schedulingMinutes = meetingSchedulingMinutes(settings)
  if (schedulingMinutes < settings.normalGameMinutes) {
    issues.push({
      code: 'no-playable-slot',
      message: '운영 시간 안에 경기를 배치할 수 없습니다.',
    })
  }
  for (const player of activePlayers) {
    const issue = attendanceWindowIssue(
      player,
      settings,
      settings.normalGameMinutes,
    )
    if (issue) {
      issues.push({ code: 'invalid-attendance-window', message: issue })
    }
  }
  if (
    activeGuests.length > 0 &&
    settings.singleGuestPerMatch &&
    activeRegulars.length < 3
  ) {
    issues.push({
      code: 'not-enough-regulars-for-special',
      message: '스페셜 1명 옵션에서는 일반 참가자가 3명 이상 필요합니다.',
    })
  }

  const totalCourtMinutes = Math.max(0, settings.courtCount * schedulingMinutes)
  const maximumPlayerAppearances = Math.floor(
    totalCourtMinutes / settings.normalGameMinutes,
  ) * 4
  if (activeRegulars.length > maximumPlayerAppearances) {
    issues.push({
      code: 'insufficient-standard-capacity',
      message: '운영 시간과 코트 수가 일반 참가자 전원 배정에 부족합니다.',
    })
  }

  if (specialEnabled && settings.specialLimitEnabled) {
    const plannedSpecialGames = activeGuests.reduce(
      (sum, guest) =>
        sum + plannedOrdinaryGuestGames(guest, activePlayers, settings),
      0,
    )
    const maximumSpecialGames =
      settings.courtCount *
        Math.floor(schedulingMinutes / settings.normalGameMinutes) *
        (allowsFixedCourtGuestOverflow(activePlayers, settings) ? 2 : 1)
    if (plannedSpecialGames > maximumSpecialGames) {
      issues.push({
        code: 'insufficient-special-capacity',
        message: '운영 시간과 코트 수가 설정한 스페셜 경기 수에 부족합니다.',
      })
    }
  }

  return issues
}
