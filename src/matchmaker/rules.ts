import { getBookingDurationMinutes } from '../scheduleTime'
import type {
  MatchConditionOptions,
  MatchSettings,
  MeetingShuffleDirection,
  Player,
} from '../types'
import { attendanceWindowIssue } from '../meetingAvailability'

export const MEETING_MAX_WAIT_MINUTES = 25
export const MEETING_MAX_STANDARD_GAME_SPREAD = 1
export const MEETING_MAX_GROUP_MEETINGS = 2
export const MEETING_SKILL_CAUTION_GAP = 30
export const MEETING_SKILL_DANGER_GAP = 40
export const MEETING_STRICT_CAUTION_LIMIT = 5
export const MEETING_TIGHT_GAME_MINIMUM = 2
export const MEETING_TIGHT_GAME_TARGET = 3
export const SPECIAL_GAME_MINUTES = 15

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

export const plannedGuestGames = (
  guest: Player,
  activePlayers: Player[],
  settings: MatchSettings,
) => {
  const schedulingMinutes = meetingSchedulingMinutes(settings)
  const timeLimit =
    settings.specialScheduleMode !== 'spread' &&
    settings.specialTimeLimitEnabled
      ? Math.min(schedulingMinutes, settings.specialTimeLimitMinutes)
      : schedulingMinutes
  const timeCapacity = Math.max(0, Math.floor(timeLimit / SPECIAL_GAME_MINUTES))

  if (settings.specialLimitEnabled) {
    const configuredLimit = settings.specialGameLimitEnabled
      ? Math.max(1, Math.floor(settings.specialGameLimit))
      : timeCapacity
    return Math.min(timeCapacity, configuredLimit)
  }

  const eligibleRegularCount = activePlayers.filter(
    (player) => !player.isGuest && (player.specialMatchEligible ?? true),
  ).length
  const guestCount = Math.max(
    1,
    activePlayers.filter((player) => player.isGuest).length,
  )
  const coverageGames = Math.ceil(eligibleRegularCount / 3 / guestCount)
  const playerLimit = Math.max(0, Math.floor(guest.guestGameLimit || 0))
  return Math.min(timeCapacity, Math.max(coverageGames, playerLimit))
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
  if (schedulingMinutes < Math.min(settings.normalGameMinutes, SPECIAL_GAME_MINUTES)) {
    issues.push({
      code: 'no-playable-slot',
      message: '운영 시간 안에 경기를 배치할 수 없습니다.',
    })
  }
  for (const player of activePlayers) {
    const issue = attendanceWindowIssue(
      player,
      settings,
      player.isGuest ? SPECIAL_GAME_MINUTES : settings.normalGameMinutes,
    )
    if (issue) {
      issues.push({ code: 'invalid-attendance-window', message: issue })
    }
  }
  if (
    specialEnabled &&
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
    totalCourtMinutes / Math.min(settings.normalGameMinutes, SPECIAL_GAME_MINUTES),
  ) * 4
  if (activeRegulars.length > maximumPlayerAppearances) {
    issues.push({
      code: 'insufficient-standard-capacity',
      message: '운영 시간과 코트 수가 일반 참가자 전원 배정에 부족합니다.',
    })
  }

  if (specialEnabled && settings.specialLimitEnabled) {
    const plannedSpecialGames = activeGuests.reduce(
      (sum, guest) => sum + plannedGuestGames(guest, activePlayers, settings),
      0,
    )
    const maximumSpecialGames =
      settings.courtCount * Math.floor(schedulingMinutes / SPECIAL_GAME_MINUTES)
    if (plannedSpecialGames > maximumSpecialGames) {
      issues.push({
        code: 'insufficient-special-capacity',
        message: '운영 시간과 코트 수가 설정한 스페셜 경기 수에 부족합니다.',
      })
    }
  }

  return issues
}
