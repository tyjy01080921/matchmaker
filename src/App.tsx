import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import './App.css'
import amaLogo from './assets/ama-logo.png'
import {
  defaultMatchConditionOptions,
  defaultLevelTiers,
  defaultPlayers,
  defaultSettings,
  defaultTournamentSettings,
  defaultTournamentTeams,
  samplePlayers,
} from './defaultData'
import {
  analyzeParticipantWaitLimitViolations,
  analyzeScheduleQuality,
  analyzeScheduleWait,
  appendGeneralCourtGames,
  calculateTournamentMvpCandidates,
  calculateStats,
  applyMeetingLineups,
  cycleMeetingMatchPartners,
  findScheduleOverlap,
  findMeetingPlayerTimeConflict,
  generateBalancedTournamentTeams,
  getMatchGenderCompositionReview,
  getMatchSkillWarningLevel,
  generateTournamentLineups,
  generateTournamentSchedule,
  makeDefaultMeetingContinuationState,
  makeNumberedTournamentPlayers,
  getTournamentMatchWinnerId as tournamentWinnerTeamId,
  rankMeetingSwapCandidates,
  swapMeetingPlayers,
  tournamentParticipantsFromTeams,
  validateMeetingFairness,
  validateMeetingSchedule,
} from './matchmaker'
import {
  decodeSharePayload,
  getShareTokenFromLocation,
  getShortShareIdFromLocation,
  makeShareUrl,
  SHARE_MODE_PARAM,
  SHARE_PARAM,
  SHORT_SHARE_PARAM,
  type SharePayload,
} from './shareLink'
import { createShortShareUrl, loadShortShare, ShortShareError } from './shortShare'
import {
  AvailableMeetingProgressMode,
  MeetingProgressMode,
  TournamentProgressMode,
} from './ProgressModeView'
import { analyzeMeetingScheduleV2 } from './matchmaker/validation'
import {
  findMeetingConsecutiveGameLimitViolations,
  isPlayerAvailableForMeetingSlot,
  meetingClockTimeToOffset,
  meetingAttendanceTimeLabel,
  normalizeAttendanceOffset,
  resolveMeetingAttendanceWindow,
} from './meetingAvailability'
import { SharedScheduleFinder } from './SharedScheduleFinder'
import type { SharedScheduleCandidate } from './sharedSchedule'
import {
  assignNextAvailableMeetingMatch,
  buildAvailableMeetingCourtLanes,
  buildMeetingCourtLanes,
  buildTournamentCourtLanes,
  canUndoAvailableMeetingMatch,
  getMeetingMatchSequence,
  getMeetingReplanLockedMatchIds,
  getMeetingSequenceNumber,
  getNextAvailableMeetingMatch,
  getProgressWinnerSide,
  getUndoableTournamentMatchId,
  initializeAvailableMeetingAssignments,
  toggleMeetingWinner,
  toggleProgressWinner,
  updateProgressScore,
} from './progressMode'
import {
  makePlayerNameLookup,
  playerDisplayName,
  type PlayerNameLookup,
} from './playerNames'
import { parseBulkPlayerDrafts } from './playerInput'
import {
  preferredPartnerNames,
  resolvePreferredPartnerNames,
} from './preferredPartners'
import {
  A4_IMAGE_HEIGHT,
  A4_IMAGE_WIDTH,
  createSchedulePrintImages,
  createTournamentPrintImages,
} from './printSchedule'
import {
  drawPrizeWinners,
  getNextPrizeDrawLabel,
  getNextPrizeDrawLabels,
  parseMissionList,
  parsePrizeList,
} from './prizeDraw'
import type {
  AgeGroup,
  AppMode,
  Gender,
  Level,
  LevelTierTable,
  MatchAgeGroup,
  Match,
  MatchConditionKey,
  MatchConditionOptions,
  MatchNameOverrides,
  MatchResult,
  MatchWinnerSide,
  MatchSettings,
  MeetingContinuationState,
  MeetingCourtAssignments,
  MeetingWaitLimitFailure,
  MeetingLineupsByMatch,
  MeetingReplanResolution,
  Player,
  PrizeDrawState,
  ResultsByMatch,
  Round,
  Schedule,
  Team,
  TournamentFormat,
  TournamentLineup,
  TournamentLineupsByMatch,
  TournamentMatch,
  TournamentMatchResult,
  TournamentParticipant,
  TournamentResultsByMatch,
  TournamentSettings,
  TournamentTeam,
  WaitLimitParticipantViolation,
} from './types'
import {
  DEFAULT_START_TIME,
  GAME_SLOT_MINUTES,
  MAX_BOOKING_MINUTES,
  clockTimeAtOffset,
  getBookingDurationMinutes,
  getBookingRoundCount,
  normalizeClockTime,
  roundTimeRange,
} from './scheduleTime'

const STORAGE_KEY = 'badminton-matchmaker-v1'
const LAST_MEETING_SCHEDULE_KEY = 'badminton-matchmaker-last-meeting-v1'
const LAST_MEETING_SCHEDULE_BACKUP_KEY =
  'badminton-matchmaker-last-meeting-backup-v2'
const PARTICIPANT_REPLAN_HELP =
  '진행 중 참가자 명단을 변경한 뒤 남은 대진을 재생성할 수 있습니다.'
const CONTACT_EMAIL = 'ama_official@naver.com'
const APP_VERSION = '0.0.1'
const meetingDefaultSettings: MatchSettings = {
  ...defaultSettings,
  normalGameMinutes: 12,
}
const LAST_UPDATED = '2026.07.17'
const SPECIAL_TIME_LIMIT_OPTIONS = [60, 90, 120, 150, 180] as const
const SHARE_LINK_SAVED_MESSAGE = '현재 생성된 이벤트의 링크를 저장하였습니다.'
type FeatureHelpKey = 'shared-edit' | 'shared-new' | 'browser-save'
const featureHelpContent: Record<FeatureHelpKey, { title: string; body: string }> = {
  'shared-edit': {
    title: '편집 기능',
    body: '공유받은 대진을 이 브라우저에 복사하고 편집 모드로 전환합니다. 수정 내용은 원본 공유 대진에 영향을 주지 않습니다.',
  },
  'shared-new': {
    title: '새로 기능',
    body: '공유본을 닫고 앱 기본 화면으로 이동합니다. 이 브라우저에 저장된 대진이 있으면 해당 대진이 다시 열릴 수 있습니다.',
  },
  'browser-save': {
    title: '브라우저 저장',
    body: '현재 친목 대진을 이 기기와 이 브라우저에 최신 1개만 보관합니다. 계정이나 클라우드에 저장되지 않으며, 브라우저 데이터를 삭제하면 함께 사라집니다.',
  },
}
const MEETING_GENERATION_MESSAGES = [
  '고성현이 만든 첫번째 라켓, 마티라',
  '신백철의 라켓 시리즈 스매셔',
  '스매셔는 기가 막히게 멋진 사람이라는 뜻입니다.',
  'A.M.A는 Athlete Meets Artisans. 선수가 장인을 만나다의 약자입니다.',
  'GOKO는 고성현 선수의 별명입니다.',
  '에이엠에이라고 부르셔도 좋고, 아마라고 불러주셔도 좋습니다. 그냥 기억만이라도 해주세요.',
  '준비운동 중요한 거 아시죠?! 꼭 하세요!',
  '즐거운 배드민턴, 고성현&신백철의 A.M.A와 함께 하세요!',
] as const
const MEETING_GENERATION_ATTEMPTS = 3

type MeetingGenerationWorkerResponse = {
  requestId: number
  schedule?: Schedule
  waitLimitFailure?: MeetingWaitLimitFailure
  replan?: MeetingReplanResolution
  progress?: string
  error?: string
}
const MIN_MEETING_PHASE_PERCENT = 15
const MEETING_PHASE_STEP = 5
const meetingSwapRecommendationKey = (matchId: string, playerId: string) =>
  `${matchId}::${playerId}`

const getTargetRoundCount = (settings: MatchSettings) => {
  const numeric = Number(settings.targetRoundCount)
  if (!Number.isFinite(numeric)) {
    return getBookingRoundCount(settings.startTime, settings.endTime)
  }
  return Math.max(1, Math.floor(numeric))
}

const prizeDrawCountOptions = [1, 2, 3, 5] as const

const normalizePrizeDrawCount = (value: unknown) => {
  const count = Number(value)
  return prizeDrawCountOptions.includes(count as (typeof prizeDrawCountOptions)[number])
    ? count
    : 1
}

const defaultPrizeDrawState: PrizeDrawState = {
  mode: 'people',
  prizesText: '',
  prizesConfirmed: false,
  missionsText: '',
  allowDuplicateWinners: false,
  drawCount: 1,
  results: [],
  missionResults: [],
  matchMissions: {},
}

type StoredState = {
  appMode: AppMode
  progressMode: boolean
  players: Player[]
  settings: MatchSettings
  generatedMeetingPlayers: Player[]
  generatedMeetingSettings: MatchSettings
  results: ResultsByMatch
  meetingCourtAssignments: MeetingCourtAssignments
  pairMixes: Record<string, number>
  matchNameOverrides: MatchNameOverrides
  meetingLineups: MeetingLineupsByMatch
  meetingContinuation: MeetingContinuationState
  prizeDraw: PrizeDrawState
  tournamentTeams: TournamentTeam[]
  tournamentSettings: TournamentSettings
  tournamentResults: TournamentResultsByMatch
  tournamentLineups: TournamentLineupsByMatch
  cachedMeetingSchedule: Schedule | null
}

type StoredMeetingSchedule = {
  version: 1 | 2
  savedAt: string
  players: Player[]
  settings: MatchSettings
  schedule: Schedule
  results: ResultsByMatch
  meetingCourtAssignments?: MeetingCourtAssignments
  pairMixes: Record<string, number>
  matchNameOverrides: MatchNameOverrides
  meetingLineups: MeetingLineupsByMatch
  meetingContinuation?: MeetingContinuationState
  prizeDraw: PrizeDrawState
}

const levelLabels: Record<Level, string> = {
  OA: 'OA',
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  E: 'E',
  O: 'O',
  스페셜: '스페셜',
}

const levelOptions: Level[] = ['OA', 'A', 'B', 'C', 'D', 'E', 'O', '스페셜']

const ageGroups: AgeGroup[] = ['무관', '20대', '30대', '40대', '45대', '50대', '55대이상']
const matchAgeGroups: MatchAgeGroup[] = ['20대', '30대', '40대', '45대', '50대', '55대이상']
const matchLevels = ['A', 'B', 'C', 'D', 'E'] as const
const matchGenders = ['male', 'female'] as const
const specialPriorityPercentOptions = Array.from(
  { length: 10 },
  (_, index) => (index + 1) * 10,
)

const genderLabels: Record<Gender, string> = {
  male: '남',
  female: '여',
  none: '무관',
}

const matchConditionKeys: MatchConditionKey[] = [
  'fairGames',
  'restBalance',
  'waitPriority',
  'levelBalance',
  'ageBalance',
  'genderBalance',
  'partnerRepeat',
  'opponentRepeat',
  'groupRepeat',
  'specialMatchCreation',
  'specialPriority',
  'guestPartnerRepeat',
  'femaleLevelFit',
  'strictSkillLimit',
]

const tournamentFormatLabels: Record<TournamentFormat, string> = {
  'group-knockout': '조별+넉아웃',
  knockout: '넉아웃',
  'team-battle': '단체전',
  'friendly-team-battle': '친목전',
}

const tournamentFormatDescriptions: Record<TournamentFormat, string> = {
  'group-knockout': '조별 풀리그 후 상위 팀 진출',
  knockout: '시드와 부전승 기반 토너먼트',
  'team-battle': '팀 대 팀 세부 경기 합산',
  'friendly-team-battle': '개인 명단 자동 편성 후 복식 진행',
}

const tournamentPhaseLabels: Record<TournamentMatch['phase'], string> = {
  group: '조별',
  knockout: '넉아웃',
  'third-place': '3·4위',
  'team-battle': '단체전',
}

const signedNumber = (value: number) => (value > 0 ? `+${value}` : String(value))

const legacySampleNames: Record<string, string> = {
  'guest-ko': '참가자 1',
  'guest-shin': '참가자 2',
  'guest-special': '참가자 3',
  'p-minsu': '참가자 4',
  'p-jiyeon': '참가자 5',
  'p-taeho': '참가자 6',
  'p-soobin': '참가자 7',
  'p-hyunwoo': '참가자 8',
  'p-nayoung': '참가자 9',
  'p-junho': '참가자 10',
  'p-eunji': '참가자 11',
  'p-doyoon': '참가자 12',
  'p-yuna': '참가자 13',
  'p-chulsoo': '참가자 14',
  'p-harin': '참가자 15',
}

const legacySampleNameSet = new Set([
  '고성현',
  '신백철',
  '스페셜 1',
  '스페셜 게스트',
  '스페셜 선수',
  '김민수',
  '이지연',
  '박태호',
  '최수빈',
  '정현우',
  '강나영',
  '오준호',
  '한은지',
  '윤도윤',
  '서유나',
  '이철수',
  '문하린',
])

const legacySamplePlayerIds = new Set(samplePlayers.map((player) => player.id))
const samplePlayerNames = new Map(samplePlayers.map((player) => [player.id, player.name]))

const isLegacySamplePlayer = (player: Partial<Player>) => {
  const id = typeof player.id === 'string' ? player.id : ''
  const name = typeof player.name === 'string' ? player.name.trim() : ''
  return (
    legacySamplePlayerIds.has(id) &&
    (name === legacySampleNames[id] || legacySampleNameSet.has(name))
  )
}

const isLegacySamplePlayerList = (players: Partial<Player>[] | undefined) =>
  Array.isArray(players) &&
  players.length === legacySamplePlayerIds.size &&
  players.every((player) => isLegacySamplePlayer(player))

const normalizeLevel = (value: unknown): Level => {
  if (
    value === 'OA' ||
    value === 'A' ||
    value === 'B' ||
    value === 'C' ||
    value === 'D' ||
    value === 'E' ||
    value === 'O' ||
    value === '스페셜'
  ) {
    return value
  }
  if (value === 'S' || value === 's') return 'OA'
  if (value === 'oa' || value === 'Oa' || value === 'oA') return 'OA'
  if (value === 'o') return 'O'
  if (value === 'SPECIAL' || value === 'special' || value === 'Special') {
    return '스페셜'
  }
  const numeric = Number(value)
  if (numeric >= 4) return 'A'
  if (numeric === 3) return 'B'
  if (numeric === 2) return 'C'
  return 'D'
}

const normalizeAgeGroup = (value: unknown): AgeGroup => {
  if (ageGroups.includes(value as AgeGroup)) return value as AgeGroup
  return '무관'
}

const normalizeGender = (value: unknown): Gender => {
  if (value === 'male' || value === 'female' || value === 'none') return value
  if (value === '남' || value === '남자' || value === 'M' || value === 'm') return 'male'
  if (value === '여' || value === '여자' || value === 'F' || value === 'f') return 'female'
  return 'none'
}

const normalizePlayer = (player: Partial<Player>): Player => {
  const normalizedLevel = normalizeLevel(player.level)
  const isGuest = (player.isGuest ?? false) || normalizedLevel === '스페셜'
  const level = isGuest ? '스페셜' : normalizedLevel
  const isSpecialLevel = level === '스페셜'
  const attendancePriority = Boolean(player.attendancePriority)
  return {
    id: player.id ?? makeId(),
    name: typeof player.name === 'string' ? player.name.trim() : '',
    level,
    ageGroup: normalizeAgeGroup(player.ageGroup),
    gender: isGuest || isSpecialLevel ? 'none' : normalizeGender(player.gender),
    active: player.active ?? true,
    specialRequired:
      isGuest || isSpecialLevel ? false : (player.specialRequired ?? true),
    specialMatchEligible:
      isGuest || isSpecialLevel ? false : (player.specialMatchEligible ?? true),
    isGuest,
    guestGameLimit: player.guestGameLimit ?? 0,
    gameCountFlexible:
      !isGuest && !attendancePriority && (player.gameCountFlexible ?? false),
    waitTimeFlexible: !isGuest && (player.waitTimeFlexible ?? false),
    arrivalOffsetMinutes: normalizeAttendanceOffset(
      player.arrivalOffsetMinutes,
    ),
    departureOffsetMinutes: normalizeAttendanceOffset(
      player.departureOffsetMinutes,
    ),
    attendancePriority,
    preferredPartnerIds: !isGuest && Array.isArray(player.preferredPartnerIds)
      ? [...new Set(
          player.preferredPartnerIds.filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
        )].slice(0, 3)
      : [],
  }
}

const normalizeStoredPlayer = (player: Partial<Player>): Player => {
  const normalized = normalizePlayer(player)
  const legacyAutoName = normalized.name.match(/^게스트\s+(\d+)$/)
  const legacySampleName = legacySampleNames[normalized.id]
  if (legacySampleName && legacySampleNameSet.has(normalized.name)) {
    return { ...normalized, name: samplePlayerNames.get(normalized.id) ?? normalized.name }
  }
  if (normalized.isGuest && legacyAutoName) {
    return { ...normalized, name: `스페셜 ${legacyAutoName[1]}번` }
  }
  return normalized
}

const normalizeAppMode = (value: unknown): AppMode =>
  value === 'tournament' ? 'tournament' : 'meeting'

const normalizeMeetingShuffleDirection = (
  _value: unknown,
): MatchSettings['shuffleDirection'] => 'balanced'

const normalizeTournamentFormat = (value: unknown): TournamentFormat => {
  if (
    value === 'group-knockout' ||
    value === 'knockout' ||
    value === 'team-battle' ||
    value === 'friendly-team-battle'
  ) {
    return value
  }

  return 'knockout'
}

const isTeamBattleTournamentFormat = (format: TournamentFormat) =>
  format === 'team-battle' || format === 'friendly-team-battle'

const isFriendlyTournamentFormat = (format: TournamentFormat) =>
  format === 'friendly-team-battle'

const normalizePositiveInteger = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.floor(numeric)))
}

const normalizeSpecialTimeLimit = (
  value: unknown,
  bookingMinutes: number,
) => {
  const availableOptions = SPECIAL_TIME_LIMIT_OPTIONS.filter(
    (minutes) => minutes <= bookingMinutes,
  )
  if (availableOptions.length === 0) return bookingMinutes
  const numeric = Number(value)
  const requested = Number.isFinite(numeric)
    ? numeric
    : defaultSettings.specialTimeLimitMinutes
  return availableOptions.find((minutes) => minutes >= requested) ??
    availableOptions[availableOptions.length - 1]
}

const normalizeMeetingPhasePercent = (value: unknown, fallback: number) => {
  const numeric = Number(value)
  const safeValue = Number.isFinite(numeric) ? numeric : fallback
  return Math.round(safeValue / MEETING_PHASE_STEP) * MEETING_PHASE_STEP
}

const normalizeMeetingPhaseBoundaries = (
  earlyValue: unknown,
  middleValue: unknown,
) => {
  const earlyPhaseEndPercent = Math.min(
    100 - MIN_MEETING_PHASE_PERCENT * 2,
    Math.max(
      MIN_MEETING_PHASE_PERCENT,
      normalizeMeetingPhasePercent(
        earlyValue,
        defaultSettings.earlyPhaseEndPercent,
      ),
    ),
  )
  const middlePhaseEndPercent = Math.min(
    100 - MIN_MEETING_PHASE_PERCENT,
    Math.max(
      earlyPhaseEndPercent + MIN_MEETING_PHASE_PERCENT,
      normalizeMeetingPhasePercent(
        middleValue,
        defaultSettings.middlePhaseEndPercent,
      ),
    ),
  )

  return { earlyPhaseEndPercent, middlePhaseEndPercent }
}

const normalizeMatchConditionOptions = (
  value: unknown,
): MatchConditionOptions => {
  const raw =
    value && typeof value === 'object'
      ? (value as Partial<Record<MatchConditionKey, unknown>>)
      : {}

  const normalized = Object.fromEntries(
    matchConditionKeys.map((key) => [
      key,
      key === 'waitPriority' || key === 'fairGames'
        ? true
        : typeof raw[key] === 'boolean'
          ? raw[key]
          : defaultMatchConditionOptions[key],
    ]),
  ) as MatchConditionOptions

  return {
    ...normalized,
    fairGames: true,
    restBalance: true,
    waitPriority: true,
    levelBalance: true,
    ageBalance: true,
    genderBalance: true,
    partnerRepeat: true,
    opponentRepeat: true,
    groupRepeat: true,
    specialMatchCreation: true,
    specialPriority: true,
    guestPartnerRepeat: true,
    femaleLevelFit: false,
    strictSkillLimit: false,
  }
}

const normalizeLevelTiers = (value: unknown): LevelTierTable => {
  const raw = value && typeof value === 'object'
    ? value as Partial<LevelTierTable>
    : {}
  const rawCommonETier = matchAgeGroups
    .flatMap((ageGroup) =>
      matchGenders.map((gender) => raw[ageGroup]?.[gender]?.E),
    )
    .find((tier) => Number.isFinite(Number(tier)))
  const commonETier = normalizePositiveInteger(
    rawCommonETier,
    defaultLevelTiers['20대'].male.E,
    1,
    20,
  )

  return Object.fromEntries(
    matchAgeGroups.map((ageGroup) => [
      ageGroup,
      Object.fromEntries(
        matchGenders.map((gender) => [
          gender,
          Object.fromEntries(
            matchLevels.map((level) => [
              level,
              level === 'E'
                ? commonETier
                : normalizePositiveInteger(
                    raw[ageGroup]?.[gender]?.[level],
                    defaultLevelTiers[ageGroup][gender][level],
                    1,
                    20,
                  ),
            ]),
          ),
        ]),
      ),
    ]),
  ) as LevelTierTable
}

const normalizeBookingWindow = (
  startValue: unknown,
  endValue: unknown,
  fallbackMinutes: number,
) => {
  const startTime = normalizeClockTime(startValue, DEFAULT_START_TIME)
  const fallbackDuration = Math.min(
    MAX_BOOKING_MINUTES,
    Math.max(GAME_SLOT_MINUTES, fallbackMinutes),
  )
  const fallbackEndTime = clockTimeAtOffset(startTime, fallbackDuration)
  const endTime = normalizeClockTime(endValue, fallbackEndTime)
  const durationMinutes = getBookingDurationMinutes(startTime, endTime, 0)

  return durationMinutes > 0
    ? { startTime, endTime, durationMinutes }
    : {
        startTime,
        endTime: fallbackEndTime,
        durationMinutes: fallbackDuration,
      }
}

const normalizeMatchSettings = (
  settings: Partial<MatchSettings> | undefined,
): MatchSettings => {
  const legacyTargetRoundCount = normalizePositiveInteger(
    settings?.targetRoundCount,
    defaultSettings.targetRoundCount,
    1,
    99,
  )
  const booking = normalizeBookingWindow(
    settings?.startTime,
    settings?.endTime,
    legacyTargetRoundCount * GAME_SLOT_MINUTES,
  )
  const bookingRoundCount = Math.floor(
    booking.durationMinutes / GAME_SLOT_MINUTES,
  )
  const specialLowPriorityEnabled = settings?.specialLowPriorityEnabled ?? true
  const specialHighPriorityEnabled = settings?.specialHighPriorityEnabled ?? true
  const specialLowPriorityPercent = specialLowPriorityEnabled
    ? normalizePositiveInteger(
        settings?.specialLowPriorityPercent,
        defaultSettings.specialLowPriorityPercent,
        10,
        100,
      )
    : 0
  const specialHighPriorityPercent = specialHighPriorityEnabled
    ? Math.min(
        100 - specialLowPriorityPercent,
        normalizePositiveInteger(
          settings?.specialHighPriorityPercent,
          defaultSettings.specialHighPriorityPercent,
          10,
          100,
        ),
      )
    : 0
  const phaseBoundaries = normalizeMeetingPhaseBoundaries(
    settings?.earlyPhaseEndPercent,
    settings?.middlePhaseEndPercent,
  )
  const specialGameLimit = normalizePositiveInteger(
    settings?.specialGameLimit,
    defaultSettings.specialGameLimit,
    1,
    99,
  )
  const rawSpecialParticipantTarget = normalizePositiveInteger(
    settings?.specialParticipantTarget,
    specialGameLimit * 3,
    3,
    297,
  )
  const specialParticipantTarget = Math.max(
    3,
    Math.floor(rawSpecialParticipantTarget / 3) * 3,
  )

  return {
    ...meetingDefaultSettings,
    ...settings,
    courtCount: normalizePositiveInteger(
      settings?.courtCount,
      defaultSettings.courtCount,
      1,
      12,
    ),
    courtAssignmentMode:
      settings?.courtAssignmentMode === 'available' ? 'available' : 'fixed',
    startTime: booking.startTime,
    endTime: booking.endTime,
    normalGameMinutes: [10, 12, 15].includes(Number(settings?.normalGameMinutes))
      ? Number(settings?.normalGameMinutes) as 10 | 12 | 15
      : meetingDefaultSettings.normalGameMinutes,
    seed: normalizePositiveInteger(settings?.seed, defaultSettings.seed, 1, 999999),
    shuffleDirection: normalizeMeetingShuffleDirection(
      settings?.shuffleDirection,
    ),
    singleGuestPerMatch: settings?.singleGuestPerMatch ?? true,
    specialLimitEnabled: settings?.specialLimitEnabled ?? false,
    specialScheduleMode: settings?.specialScheduleMode === 'spread' ||
      (!settings?.specialScheduleMode && settings?.specialTimeLimitEnabled === false)
      ? 'spread'
      : 'continuous',
    specialGameLimitEnabled: settings?.specialGameLimitEnabled ?? true,
    specialGameLimit,
    specialParticipantTarget,
    specialTimeLimitEnabled: settings?.specialTimeLimitEnabled ?? true,
    specialTimeLimitMinutes: normalizeSpecialTimeLimit(
      settings?.specialTimeLimitMinutes,
      booking.durationMinutes,
    ),
    specialLowPriorityEnabled,
    specialLowPriorityPercent,
    specialHighPriorityEnabled:
      specialHighPriorityEnabled && specialHighPriorityPercent >= 10,
    specialHighPriorityPercent:
      specialHighPriorityPercent >= 10 ? specialHighPriorityPercent : 0,
    levelTiers: normalizeLevelTiers(settings?.levelTiers),
    targetRoundCount: normalizePositiveInteger(
      settings?.targetRoundCount,
      bookingRoundCount,
      1,
      99,
    ),
    pacingRoundCount: normalizePositiveInteger(
      settings?.pacingRoundCount,
      settings?.targetRoundCount ?? bookingRoundCount,
      1,
      99,
    ),
    roundCountLocked:
      settings?.startTime && settings?.endTime
        ? (settings.roundCountLocked ?? true)
        : true,
    ...phaseBoundaries,
    conditionOptions: normalizeMatchConditionOptions(settings?.conditionOptions),
  }
}

const normalizeMeetingCourtAssignments = (
  value: MeetingCourtAssignments | undefined,
): MeetingCourtAssignments => {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([matchId, assignment]) => {
      const court = Number(assignment?.court)
      const dispatchOrder = Number(assignment?.dispatchOrder)
      if (
        !matchId ||
        !Number.isInteger(court) ||
        court < 1 ||
        court > 12 ||
        !Number.isInteger(dispatchOrder) ||
        dispatchOrder < 1
      ) return []
      return [[matchId, { court, dispatchOrder }]]
    }),
  )
}

const normalizeTournamentSeed = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.min(999, Math.floor(numeric))
}

const normalizeTournamentSettings = (
  settings: Partial<TournamentSettings> | undefined,
): TournamentSettings => {
  const rawSlots = Array.isArray(settings?.teamBattleSlots)
    ? settings.teamBattleSlots
    : defaultTournamentSettings.teamBattleSlots
  const teamBattleSlots = [...rawSlots, ...defaultTournamentSettings.teamBattleSlots]
    .map((slot) => String(slot).trim())
    .filter(Boolean)
    .slice(0, 5)
  const booking = normalizeBookingWindow(
    settings?.startTime,
    settings?.endTime,
    getBookingDurationMinutes(
      defaultTournamentSettings.startTime,
      defaultTournamentSettings.endTime,
    ),
  )

  return {
    ...defaultTournamentSettings,
    ...settings,
    format: normalizeTournamentFormat(settings?.format),
    courtCount: normalizePositiveInteger(
      settings?.courtCount,
      defaultTournamentSettings.courtCount,
      1,
      12,
    ),
    startTime: booking.startTime,
    endTime: booking.endTime,
    groupCount: normalizePositiveInteger(
      settings?.groupCount,
      defaultTournamentSettings.groupCount,
      1,
      16,
    ),
    advancePerGroup: normalizePositiveInteger(
      settings?.advancePerGroup,
      defaultTournamentSettings.advancePerGroup,
      1,
      8,
    ),
    includeThirdPlace: settings?.includeThirdPlace ?? true,
    teamBattleMatchCount: normalizePositiveInteger(
      settings?.teamBattleMatchCount,
      defaultTournamentSettings.teamBattleMatchCount,
      1,
      5,
    ),
    teamBattleSlots,
    friendlyParticipantCount: normalizePositiveInteger(
      settings?.friendlyParticipantCount,
      defaultTournamentSettings.friendlyParticipantCount,
      0,
      256,
    ),
  }
}

const normalizeTournamentParticipant = (
  participant: Partial<TournamentParticipant>,
  index: number,
): TournamentParticipant => ({
  id: participant.id ?? makeId(),
  name: participant.name?.trim() || `${index + 1}번`,
  level: normalizeLevel(participant.level),
  ageGroup: normalizeAgeGroup(participant.ageGroup),
  gender: normalizeGender(participant.gender),
})

const normalizeTournamentTeam = (
  team: Partial<TournamentTeam>,
  index: number,
): TournamentTeam => {
  const members = Array.isArray(team.members)
    ? team.members
        .map((member, memberIndex) =>
          normalizeTournamentParticipant(member, memberIndex),
        )
        .filter((member) => member.name.trim())
    : undefined

  return {
    id: team.id ?? makeId(),
    name: team.name?.trim() || `${index + 1}팀`,
    playerNames:
      team.playerNames?.trim() ||
      members?.map((member) => member.name).join(', ') ||
      '',
    level: normalizeLevel(team.level),
    gender: normalizeGender(team.gender),
    seed: normalizeTournamentSeed(team.seed),
    active: team.active ?? true,
    members,
  }
}

const normalizeTournamentLineup = (
  lineup: Partial<TournamentLineup> | undefined,
): TournamentLineup => ({
  teamAPlayerIds: [lineup?.teamAPlayerIds?.[0] ?? '', lineup?.teamAPlayerIds?.[1] ?? ''],
  teamBPlayerIds: [lineup?.teamBPlayerIds?.[0] ?? '', lineup?.teamBPlayerIds?.[1] ?? ''],
})

const normalizeTournamentLineups = (value: unknown): TournamentLineupsByMatch => {
  if (!value || typeof value !== 'object') return {}

  return Object.fromEntries(
    Object.entries(value as Record<string, Partial<TournamentLineup>>).map(
      ([matchId, lineup]) => [matchId, normalizeTournamentLineup(lineup)],
    ),
  )
}

const normalizePrizeDrawResults = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((rawResult) => {
          const result = rawResult as Partial<PrizeDrawState['results'][number]>
          return {
            prize: String(result.prize ?? '').trim(),
            winnerId: String(result.winnerId ?? ''),
            winnerName: String(result.winnerName ?? '').trim(),
            reward:
              result.reward === undefined ? undefined : String(result.reward).trim(),
            done: Boolean(result.done),
          }
        })
        .filter((result) => result.prize && result.winnerId && result.winnerName)
    : []

const normalizePrizeDrawResultMap = (value: unknown) => {
  if (!value || typeof value !== 'object') return {}

  const entries: Array<[string, PrizeDrawState['results'][number]]> = []
  for (const [matchId, rawResult] of Object.entries(value as Record<string, unknown>)) {
    const [result] = normalizePrizeDrawResults([rawResult])
    if (result) entries.push([matchId, result])
  }

  return Object.fromEntries(entries)
}

const normalizePrizeDrawState = (
  value: Partial<PrizeDrawState> | undefined,
): PrizeDrawState => {
  const prizesText = typeof value?.prizesText === 'string' ? value.prizesText : ''
  const results = normalizePrizeDrawResults(value?.results)
  const hasPrizeEntries = parsePrizeList(prizesText).length > 0

  return {
    mode: value?.mode === 'mission' ? 'mission' : 'people',
    prizesText,
    prizesConfirmed:
      hasPrizeEntries && (value?.prizesConfirmed ?? results.length > 0),
    missionsText: typeof value?.missionsText === 'string' ? value.missionsText : '',
    allowDuplicateWinners: value?.allowDuplicateWinners ?? false,
    drawCount: normalizePrizeDrawCount(value?.drawCount),
    results,
    missionResults: normalizePrizeDrawResults(value?.missionResults),
    matchMissions: normalizePrizeDrawResultMap(value?.matchMissions),
  }
}

const legacyEnglishTitleCodes = [
  83,
  72,
  73,
  78,
  69,
  32,
  79,
  78,
  32,
  84,
  72,
  69,
  32,
  67,
  79,
  85,
  82,
  84,
]

const legacyEnglishTitle = legacyEnglishTitleCodes
  .map((code) => String.fromCharCode(code))
  .join('')

const legacyMeetingEventNames = new Set([
  '스페셜 배드민턴 데이',
  legacyEnglishTitle,
])

const normalizeMeetingContinuationState = (
  value: Partial<MeetingContinuationState> | undefined,
): MeetingContinuationState => {
  const fallback = makeDefaultMeetingContinuationState()
  if (!value || value.version !== 1) return fallback
  return {
    version: 1,
    revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
    mode: value.mode === 'late-special-unlimited'
      ? 'late-special-unlimited'
      : 'standard',
    ...(typeof value.activatedAtOffsetMinutes === 'number'
      ? {
          activatedAtOffsetMinutes: Math.max(
            0,
            Math.floor(value.activatedAtOffsetMinutes),
          ),
        }
      : {}),
    players: Object.fromEntries(
      Object.entries(value.players ?? {}).map(([playerId, state]) => [
        playerId,
        {
          eligibleFromOffsetMinutes: Math.max(
            0,
            Math.floor(Number(state?.eligibleFromOffsetMinutes) || 0),
          ),
          fairnessGameCredit: Math.max(
            0,
            Math.floor(Number(state?.fairnessGameCredit) || 0),
          ),
          guestGameCredit: Math.max(
            0,
            Math.floor(Number(state?.guestGameCredit) || 0),
          ),
        },
      ]),
    ),
  }
}

const readStoredMeetingSchedule = (
  storageKey = LAST_MEETING_SCHEDULE_KEY,
): Partial<StoredMeetingSchedule> | null => {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredMeetingSchedule>
    return (parsed.version === 1 || parsed.version === 2) &&
      Array.isArray(parsed.players)
      ? parsed
      : null
  } catch {
    return null
  }
}

const normalizeStoredSchedule = (
  value: Partial<Schedule> | undefined,
  players: Player[],
): Schedule | null => {
  if (!value || !Array.isArray(value.rounds)) return null
  const playersById = new Map(players.map((player) => [player.id, player]))
  const restorePlayer = (player: Player) =>
    playersById.get(player.id) ?? normalizeStoredPlayer(player)

  try {
    return {
      rounds: value.rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => ({
          ...match,
          teamA: match.teamA.map(restorePlayer) as Team,
          teamB: match.teamB.map(restorePlayer) as Team,
        })),
        resting: round.resting.map(restorePlayer),
      })),
      warnings: Array.isArray(value.warnings) ? value.warnings : [],
      specialCompletedIds: Array.isArray(value.specialCompletedIds)
        ? value.specialCompletedIds
        : [],
      guestGameCounts:
        value.guestGameCounts && typeof value.guestGameCounts === 'object'
          ? value.guestGameCounts
          : {},
    }
  } catch {
    return null
  }
}

const readStoredState = (): StoredState => {
  if (typeof window === 'undefined') {
    return {
      appMode: 'meeting',
      progressMode: false,
      players: defaultPlayers,
      settings: meetingDefaultSettings,
      generatedMeetingPlayers: defaultPlayers,
      generatedMeetingSettings: meetingDefaultSettings,
      results: {},
      meetingCourtAssignments: {},
      pairMixes: {},
      matchNameOverrides: {},
      meetingLineups: {},
      meetingContinuation: makeDefaultMeetingContinuationState(),
      prizeDraw: defaultPrizeDrawState,
      tournamentTeams: defaultTournamentTeams,
      tournamentSettings: defaultTournamentSettings,
      tournamentResults: {},
      tournamentLineups: {},
      cachedMeetingSchedule: null,
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw
      ? JSON.parse(raw) as Partial<StoredState>
      : {}
    const savedMeetingSchedule = readStoredMeetingSchedule()
    const settings = normalizeMatchSettings(parsed.settings)
    const storedPlayersAreLegacySample = isLegacySamplePlayerList(parsed.players)
    if (legacyMeetingEventNames.has(settings.eventName)) {
      settings.eventName = defaultSettings.eventName
    }
    const players = storedPlayersAreLegacySample
      ? defaultPlayers
      : parsed.players?.length
        ? parsed.players.map((player) => normalizeStoredPlayer(player))
        : defaultPlayers
    const savedMeetingPlayers = savedMeetingSchedule?.players?.length
      ? savedMeetingSchedule.players.map((player) => normalizeStoredPlayer(player))
      : null
    const savedMeetingSettings = savedMeetingPlayers
      ? normalizeMatchSettings(savedMeetingSchedule?.settings)
      : null
    const cachedMeetingSchedule = savedMeetingPlayers
      ? normalizeStoredSchedule(savedMeetingSchedule?.schedule, savedMeetingPlayers)
      : null
    return {
      appMode: normalizeAppMode(parsed.appMode),
      progressMode: Boolean(
        parsed.progressMode &&
        (normalizeAppMode(parsed.appMode) === 'tournament' || cachedMeetingSchedule),
      ),
      players: savedMeetingPlayers ?? players,
      settings: savedMeetingSettings ?? settings,
      // 자동 저장 데이터는 참가자와 설정만 복원한다. 사용자가 명시적으로
      // 브라우저에 저장한 대진표가 있을 때만 마지막 대진과 결과를 복원한다.
      generatedMeetingPlayers: savedMeetingPlayers ?? defaultPlayers,
      generatedMeetingSettings: savedMeetingSettings ?? settings,
      results: savedMeetingPlayers ? (savedMeetingSchedule?.results ?? {}) : {},
      meetingCourtAssignments: savedMeetingPlayers
        ? normalizeMeetingCourtAssignments(
            savedMeetingSchedule?.meetingCourtAssignments,
          )
        : {},
      pairMixes: savedMeetingPlayers ? (savedMeetingSchedule?.pairMixes ?? {}) : {},
      matchNameOverrides: savedMeetingPlayers
        ? (savedMeetingSchedule?.matchNameOverrides ?? {})
        : {},
      meetingLineups: savedMeetingPlayers
        ? (savedMeetingSchedule?.meetingLineups ?? {})
        : {},
      meetingContinuation: savedMeetingPlayers
        ? normalizeMeetingContinuationState(
            savedMeetingSchedule?.meetingContinuation,
          )
        : normalizeMeetingContinuationState(parsed.meetingContinuation),
      prizeDraw: savedMeetingPlayers
        ? normalizePrizeDrawState(savedMeetingSchedule?.prizeDraw)
        : storedPlayersAreLegacySample
          ? defaultPrizeDrawState
          : normalizePrizeDrawState(parsed.prizeDraw),
      tournamentTeams: parsed.tournamentTeams?.length
        ? parsed.tournamentTeams.map((team, index) =>
            normalizeTournamentTeam(team, index),
          )
        : defaultTournamentTeams,
      tournamentSettings: normalizeTournamentSettings(parsed.tournamentSettings),
      tournamentResults: parsed.tournamentResults ?? {},
      tournamentLineups: normalizeTournamentLineups(parsed.tournamentLineups),
      cachedMeetingSchedule,
    }
  } catch {
    return {
      appMode: 'meeting',
      progressMode: false,
      players: defaultPlayers,
      settings: meetingDefaultSettings,
      generatedMeetingPlayers: defaultPlayers,
      generatedMeetingSettings: meetingDefaultSettings,
      results: {},
      meetingCourtAssignments: {},
      pairMixes: {},
      matchNameOverrides: {},
      meetingLineups: {},
      meetingContinuation: makeDefaultMeetingContinuationState(),
      prizeDraw: defaultPrizeDrawState,
      tournamentTeams: defaultTournamentTeams,
      tournamentSettings: defaultTournamentSettings,
      tournamentResults: {},
      tournamentLineups: {},
      cachedMeetingSchedule: null,
    }
  }
}

const storedStateFromSharePayload = (payload: SharePayload): StoredState => {
  const meetingPlayers = payload.players.length
    ? payload.players.map((player) => normalizeStoredPlayer(player))
    : defaultPlayers
  const cachedMeetingSchedule = normalizeStoredSchedule(
    payload.meetingSchedule,
    meetingPlayers,
  )
  return {
    appMode: normalizeAppMode(payload.appMode),
    progressMode: false,
    players: meetingPlayers,
    settings: normalizeMatchSettings(payload.settings),
    generatedMeetingPlayers: meetingPlayers,
    generatedMeetingSettings: normalizeMatchSettings(payload.settings),
    results: payload.results ?? {},
    meetingCourtAssignments: normalizeMeetingCourtAssignments(
      payload.meetingCourtAssignments,
    ),
    pairMixes: cachedMeetingSchedule ? {} : (payload.pairMixes ?? {}),
    matchNameOverrides: payload.matchNameOverrides ?? {},
    meetingLineups: cachedMeetingSchedule ? {} : (payload.meetingLineups ?? {}),
    meetingContinuation: makeDefaultMeetingContinuationState(),
    prizeDraw: normalizePrizeDrawState(payload.prizeDraw),
    tournamentTeams: payload.tournamentTeams?.length
      ? payload.tournamentTeams.map((team, index) =>
          normalizeTournamentTeam(team, index),
        )
      : defaultTournamentTeams,
    tournamentSettings: normalizeTournamentSettings(payload.tournamentSettings),
    tournamentResults: payload.tournamentResults ?? {},
    tournamentLineups: normalizeTournamentLineups(payload.tournamentLineups),
    cachedMeetingSchedule,
  }
}

const readSharedState = (): StoredState | null => {
  if (typeof window === 'undefined') return null

  const token = getShareTokenFromLocation(window.location)
  if (!token) return null

  const payload = decodeSharePayload(token)
  return payload ? storedStateFromSharePayload(payload) : null
}

const getBaseUrl = () => {
  const url = new URL(window.location.href)
  url.searchParams.delete(SHARE_PARAM)
  url.searchParams.delete(SHARE_MODE_PARAM)
  url.searchParams.delete(SHORT_SHARE_PARAM)
  url.hash = ''
  return url.toString()
}

const makeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `player-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

const makeRegularPlayer = (_index: number): Player => ({
  id: makeId(),
  name: '',
  level: 'O',
  ageGroup: '무관',
  gender: 'none',
  active: true,
  specialRequired: true,
  isGuest: false,
  guestGameLimit: 0,
  gameCountFlexible: false,
  waitTimeFlexible: false,
})

const makeGuestPlayer = (_index: number): Player => ({
  id: makeId(),
  name: '',
  level: '스페셜',
  ageGroup: '무관',
  gender: 'none',
  active: true,
  specialRequired: false,
  isGuest: true,
  guestGameLimit: 0,
  gameCountFlexible: false,
  waitTimeFlexible: false,
})

const makeTournamentTeam = (index: number): TournamentTeam => ({
  id: makeId(),
  name: `${index}팀`,
  playerNames: '',
  level: 'B',
  gender: 'none',
  seed: null,
  active: true,
})

const isAutoGeneratedPlayerName = (name: string) =>
  /^(참가자|스페셜)\s*\d+번?$/.test(name.trim())

const resultWinnerSide = (result?: MatchResult): MatchWinnerSide | undefined =>
  result?.winnerSide

const winnerLabel = (
  match: Match,
  result: MatchResult | undefined,
  names: PlayerNameLookup,
  nameOverrides: Record<string, string> = {},
) => {
  const matchTeamDisplayName = (team: Team) =>
    team
      .map((player) => nameOverrides[player.id]?.trim() || playerDisplayName(player, names))
      .join(' + ')
  const winnerSide = result?.completed ? resultWinnerSide(result) : undefined
  if (!winnerSide) return '대기'
  return winnerSide === 'A'
    ? matchTeamDisplayName(match.teamA)
    : matchTeamDisplayName(match.teamB)
}

const tournamentHasScore = (result?: TournamentMatchResult) =>
  Boolean(result?.teamAScore || result?.teamBScore || result?.winnerSide)

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}시간 ${remainingMinutes}분`
  }
  if (hours > 0) return `${hours}시간`
  return `${minutes}분`
}

const omitRecordKeys = <T,>(record: Record<string, T>, keys: Set<string>) =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.has(key)),
  ) as Record<string, T>

const copyToClipboard = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // 권한이 막힌 브라우저에서는 아래 입력 선택 방식으로 다시 시도합니다.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('copy failed')
}

const sanitizeFilename = (value: string) =>
  (value.trim() || '대진표')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')

const triggerDownload = (imageUrl: string, filename: string) => {
  const link = document.createElement('a')
  link.href = imageUrl
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

const printImageUrlToPngObjectUrl = (imageUrl: string) =>
  new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth || A4_IMAGE_WIDTH
      canvas.height = image.naturalHeight || A4_IMAGE_HEIGHT

      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('canvas unavailable'))
        return
      }

      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('png unavailable'))
          return
        }

        resolve(URL.createObjectURL(blob))
      }, 'image/png')
    }
    image.onerror = () => reject(new Error('image unavailable'))
    image.src = imageUrl
  })

const downloadPrintImage = async (imageUrl: string, filename: string) => {
  const pngUrl = await printImageUrlToPngObjectUrl(imageUrl)
  triggerDownload(pngUrl, filename)
  window.setTimeout(() => URL.revokeObjectURL(pngUrl), 2000)
}

const mixedMatch = (match: Match, mixIndex: number): Match => {
  const players = [match.teamA[0], match.teamA[1], match.teamB[0], match.teamB[1]]
  const options: Array<Pick<Match, 'teamA' | 'teamB'>> = [
    {
      teamA: [players[0], players[1]],
      teamB: [players[2], players[3]],
    },
    {
      teamA: [players[0], players[2]],
      teamB: [players[1], players[3]],
    },
    {
      teamA: [players[0], players[3]],
      teamB: [players[1], players[2]],
    },
  ]
  return {
    ...match,
    ...options[mixIndex % options.length],
  }
}

const emptyMeetingSchedule: Schedule = {
  rounds: [],
  warnings: [],
  specialCompletedIds: [],
  guestGameCounts: {},
}

const applyPairMixes = (
  schedule: Schedule,
  pairMixes: Record<string, number>,
): Schedule => ({
  ...schedule,
  rounds: schedule.rounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) => mixedMatch(match, pairMixes[match.id] ?? 0)),
  })),
})

const parseBulkPlayers = (text: string): Player[] =>
  parseBulkPlayerDrafts(text).map((player) =>
    normalizePlayer({
      ...player,
      id: makeId(),
    }),
  )

const mergeParsedPlayersWithRosterDraft = (
  currentPlayers: Player[],
  parsedPlayers: Player[],
) => {
  if (currentPlayers.length === 0) return parsedPlayers

  const currentGuests = currentPlayers.filter((player) => player.isGuest)
  const currentRegulars = currentPlayers.filter((player) => !player.isGuest)
  const parsedGuests = parsedPlayers.filter((player) => player.isGuest)
  const parsedRegulars = parsedPlayers.filter((player) => !player.isGuest)
  const mergeGroup = (draftPlayers: Player[], nextPlayers: Player[]) => [
    ...draftPlayers.map((draftPlayer, index) =>
      nextPlayers[index] ? { ...nextPlayers[index], id: draftPlayer.id } : draftPlayer,
    ),
    ...nextPlayers.slice(draftPlayers.length),
  ]

  return [
    ...mergeGroup(currentGuests, parsedGuests),
    ...mergeGroup(currentRegulars, parsedRegulars),
  ]
}

const bulkPlayerPlaceholder = [
  '이름 또는 번호는 첫 순서에 작성',
  '이후 레벨 · 성별 · 연령은 순서 무관',
  '김민수',
  '이지연',
  '박태호 남 30 B',
  '최수빈 40 여 A',
  '홍길동 B 경기양보 대기양보',
  '스페셜1 스페셜',
].join('\n')

const tournamentGenderTokens = ['남', '남자', '여', '여자', 'male', 'female', '무관', '혼복', 'mixed']

const normalizeTournamentTeamGender = (value: unknown): Gender => {
  if (value === '혼복' || value === 'mixed') return 'none'
  return normalizeGender(value)
}

const parseBulkTournamentTeams = (text: string): TournamentTeam[] =>
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const commaParts = line.split(',').map((part) => part.trim()).filter(Boolean)
      const fields =
        commaParts.length > 1
          ? commaParts
          : line.split(/[\s,\t]+/).map((part) => part.trim()).filter(Boolean)
      const metadataFields = fields.slice(1)
      const seedIndex = metadataFields.findIndex((field) => /^\d+$/.test(field))
      const levelIndex = metadataFields.findIndex((field) =>
        (['OA', 'S', 'A', 'B', 'C', 'D', 'E', 'O'] as string[]).includes(
          field.toUpperCase(),
        ),
      )
      const genderIndex = metadataFields.findIndex((field) =>
        tournamentGenderTokens.includes(field.toLowerCase()),
      )
      const roster = metadataFields
        .filter(
          (_, fieldIndex) =>
            fieldIndex !== seedIndex &&
            fieldIndex !== levelIndex &&
            fieldIndex !== genderIndex,
        )
        .join(', ')

      return normalizeTournamentTeam(
        {
          id: makeId(),
          name: fields[0],
          playerNames: roster,
          level:
            levelIndex >= 0
              ? normalizeLevel(metadataFields[levelIndex].toUpperCase())
              : 'B',
          gender:
            genderIndex >= 0
              ? normalizeTournamentTeamGender(metadataFields[genderIndex].toLowerCase())
              : 'none',
          seed:
            seedIndex >= 0 ? normalizeTournamentSeed(metadataFields[seedIndex]) : null,
          active: true,
        },
        index,
      )
    })

type NumberStepperProps = {
  ariaLabel?: string
  label: ReactNode
  max: number
  min: number
  onChange: (value: number) => void
  value: number
}

function NumberStepper({
  ariaLabel,
  label,
  max,
  min,
  onChange,
  value,
}: NumberStepperProps) {
  const accessibleLabel = ariaLabel ?? (typeof label === 'string' ? label : '수량')
  const commitValue = (rawValue: string) => {
    const next = Number(rawValue)
    if (!Number.isFinite(next)) return
    onChange(Math.min(max, Math.max(min, Math.floor(next))))
  }

  return (
    <label className="number-control">
      <span>{label}</span>
      <div className="stepper-control">
        <button
          type="button"
          aria-label={`${accessibleLabel} 줄이기`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <input
          aria-label={accessibleLabel}
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(event) => commitValue(event.target.value)}
        />
        <button
          type="button"
          aria-label={`${accessibleLabel} 늘리기`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </div>
    </label>
  )
}

function App() {
  const initialContext = useMemo(() => {
    const sharedState = readSharedState()
    const shortShareId = getShortShareIdFromLocation(window.location)
    return {
      isShared: Boolean(sharedState || shortShareId),
      shortShareId,
      state: sharedState ?? readStoredState(),
    }
  }, [])
  const initialState = initialContext.state
  const [appMode, setAppMode] = useState<AppMode>(initialState.appMode)
  const [progressMode, setProgressMode] = useState(initialState.progressMode)
  const [players, setPlayers] = useState<Player[]>(initialState.players)
  const [settings, setSettings] = useState<MatchSettings>(initialState.settings)
  const [generatedMeetingPlayers, setGeneratedMeetingPlayers] = useState<Player[]>(
    initialState.generatedMeetingPlayers,
  )
  const [generatedMeetingSettings, setGeneratedMeetingSettings] =
    useState<MatchSettings>(initialState.generatedMeetingSettings)
  const [scheduleOverride, setScheduleOverride] = useState<Schedule | null>(
    initialState.cachedMeetingSchedule,
  )
  const [results, setResults] = useState<ResultsByMatch>(initialState.results)
  const [meetingCourtAssignments, setMeetingCourtAssignments] =
    useState<MeetingCourtAssignments>(initialState.meetingCourtAssignments)
  const [pairMixes, setPairMixes] = useState<Record<string, number>>(
    initialState.pairMixes,
  )
  const [matchNameOverrides, setMatchNameOverrides] = useState<MatchNameOverrides>(
    initialState.matchNameOverrides,
  )
  const [meetingLineups, setMeetingLineups] = useState<MeetingLineupsByMatch>(
    initialState.meetingLineups,
  )
  const [meetingContinuation, setMeetingContinuation] =
    useState<MeetingContinuationState>(initialState.meetingContinuation)
  const [prizeDraw, setPrizeDraw] = useState<PrizeDrawState>(
    initialState.prizeDraw,
  )
  const [prizeListOpen, setPrizeListOpen] = useState(false)
  const [tournamentTeams, setTournamentTeams] = useState<TournamentTeam[]>(
    initialState.tournamentTeams,
  )
  const [tournamentSettings, setTournamentSettings] = useState<TournamentSettings>(
    initialState.tournamentSettings,
  )
  const [tournamentResults, setTournamentResults] = useState<TournamentResultsByMatch>(
    initialState.tournamentResults,
  )
  const [tournamentLineups, setTournamentLineups] = useState<TournamentLineupsByMatch>(
    initialState.tournamentLineups,
  )
  const restoredMeetingNoticePendingRef = useRef(
    Boolean(initialState.cachedMeetingSchedule),
  )
  const [isSharedMode, setIsSharedMode] = useState(initialContext.isShared)
  const [view, setView] = useState<'schedule' | 'stats'>('schedule')
  const [tournamentView, setTournamentView] = useState<'progress' | 'board'>('progress')
  const [notice, setNotice] = useState(
    initialContext.isShared
      ? '공유본'
      : initialState.cachedMeetingSchedule
        ? '마지막 대진 복원됨'
        : '저장됨',
  )
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [customBookingTime, setCustomBookingTime] = useState(false)
  const [playersOpen, setPlayersOpen] = useState(true)
  const [prizeOpen, setPrizeOpen] = useState(true)
  const [tournamentSettingsOpen, setTournamentSettingsOpen] = useState(true)
  const [tournamentTeamsOpen, setTournamentTeamsOpen] = useState(true)
  const [conditionsOpen, setConditionsOpen] = useState(false)
  const [levelHelpOpen, setLevelHelpOpen] = useState(false)
  const [participantReplanHelpOpen, setParticipantReplanHelpOpen] = useState<
    'add' | 'input' | null
  >(null)
  const [attendanceEditorOpenIds, setAttendanceEditorOpenIds] = useState<
    Record<string, boolean>
  >({})
  const [levelTierEditorOpen, setLevelTierEditorOpen] = useState(false)
  const [levelTierDraft, setLevelTierDraft] = useState<LevelTierTable>(
    () => normalizeLevelTiers(initialState.settings.levelTiers),
  )
  const [contactOpen, setContactOpen] = useState(false)
  const [featureHelpOpen, setFeatureHelpOpen] = useState<FeatureHelpKey | null>(null)
  const [contactCopied, setContactCopied] = useState(false)
  const [playerDetailsOpen, setPlayerDetailsOpen] = useState(
    initialState.players.length > 0,
  )
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [tournamentBulkOpen, setTournamentBulkOpen] = useState(false)
  const [tournamentBulkText, setTournamentBulkText] = useState('')
  const [printImageUrls, setPrintImageUrls] = useState<string[]>([])
  const [tournamentPrintImageUrls, setTournamentPrintImageUrls] = useState<string[]>([])
  const [editingMatchIds, setEditingMatchIds] = useState<Record<string, boolean>>({})
  const [matchEditorErrors, setMatchEditorErrors] = useState<Record<string, string>>({})
  const [matchNameDrafts, setMatchNameDrafts] = useState<MatchNameOverrides>({})
  const [preferredPartnerDrafts, setPreferredPartnerDrafts] = useState<
    Record<string, string>
  >({})
  const [collapsedMatchIds, setCollapsedMatchIds] = useState<Record<string, boolean>>({})
  const [tournamentRoundOpen, setTournamentRoundOpen] = useState<Record<number, boolean>>({})
  const [rouletteRotation, setRouletteRotation] = useState(0)
  const [rouletteWinnerName, setRouletteWinnerName] = useState('')
  const [isRouletteSpinning, setIsRouletteSpinning] = useState(false)
  const [isMeetingGenerating, setIsMeetingGenerating] = useState(false)
  const [isMeetingReplanning, setIsMeetingReplanning] = useState(false)
  const [hasMeetingBackup, setHasMeetingBackup] = useState(
    () => Boolean(window.localStorage.getItem(LAST_MEETING_SCHEDULE_BACKUP_KEY)),
  )
  const [isMeetingStatusRefreshing, setIsMeetingStatusRefreshing] = useState(false)
  const [isShortShareLoading, setIsShortShareLoading] = useState(
    Boolean(initialContext.shortShareId),
  )
  const [shortShareError, setShortShareError] = useState('')
  const [browserSaveToast, setBrowserSaveToast] = useState<{
    message: string
    error: boolean
  } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [meetingWarningsReconciled, setMeetingWarningsReconciled] = useState(false)
  const [meetingGenerationMessage, setMeetingGenerationMessage] = useState('')
  const [meetingOperationLabel, setMeetingOperationLabel] = useState('대진 생성 중')
  const [meetingWaitLimitFailure, setMeetingWaitLimitFailure] =
    useState<MeetingWaitLimitFailure | null>(null)
  const meetingPrintPreviewRef = useRef<HTMLElement | null>(null)
  const tournamentPrintPreviewRef = useRef<HTMLElement | null>(null)
  const contactCopyTimerRef = useRef<number | null>(null)
  const rouletteTimerRef = useRef<number | null>(null)
  const meetingGenerationStartTimerRef = useRef<number | null>(null)
  const meetingGenerationEndTimerRef = useRef<number | null>(null)
  const meetingGenerationWorkerRef = useRef<Worker | null>(null)
  const meetingGenerationRequestRef = useRef(0)
  const meetingStatusRefreshTimerRef = useRef<number | null>(null)
  const browserSaveToastTimerRef = useRef<number | null>(null)
  const meetingGenerationCompletedNoticeRef = useRef('대진 완료')
  const isRosterDrafting = !playerDetailsOpen || players.length === 0
  const showBulkPlayerInput = bulkOpen || isRosterDrafting
  const hasPlayerDraftChanges = useMemo(
    () => JSON.stringify(players) !== JSON.stringify(generatedMeetingPlayers),
    [generatedMeetingPlayers, players],
  )
  const hasMeetingSettingsDraftChanges = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(generatedMeetingSettings),
    [generatedMeetingSettings, settings],
  )
  const hasMeetingDraftChanges =
    hasPlayerDraftChanges || hasMeetingSettingsDraftChanges

  const rawSchedule = scheduleOverride ?? emptyMeetingSchedule
  const schedule = useMemo(() => applyMeetingLineups(
    applyPairMixes(rawSchedule, pairMixes),
    generatedMeetingPlayers,
    meetingLineups,
  ), [generatedMeetingPlayers, meetingLineups, pairMixes, rawSchedule])
  const storedMeetingScheduleSnapshot = useMemo<StoredMeetingSchedule>(() => ({
    version: 2,
    savedAt: new Date().toISOString(),
    players: generatedMeetingPlayers,
    settings: generatedMeetingSettings,
    schedule,
    results,
    meetingCourtAssignments,
    // 최종 화면 대진을 저장하므로 이미 적용한 수동 조합은 다시 적용하지 않는다.
    pairMixes: {},
    matchNameOverrides,
    meetingLineups: {},
    meetingContinuation,
    prizeDraw,
  }), [
    generatedMeetingPlayers,
    generatedMeetingSettings,
    matchNameOverrides,
    meetingCourtAssignments,
    meetingContinuation,
    prizeDraw,
    results,
    schedule,
  ])
  useEffect(() => {
    setMeetingWarningsReconciled(false)
  }, [generatedMeetingPlayers, generatedMeetingSettings])
  const meetingAnalysisOptions = useMemo(() => ({
    eligibleFromOffsetMinutesByPlayer: Object.fromEntries(
      generatedMeetingPlayers.map((player) => {
        const attendance = resolveMeetingAttendanceWindow(
          player,
          generatedMeetingSettings,
        )
        return [
          player.id,
          Math.max(
            attendance.start,
            meetingContinuation.players[player.id]?.eligibleFromOffsetMinutes ?? 0,
          ),
        ]
      }),
    ),
    eligibleUntilOffsetMinutesByPlayer: Object.fromEntries(
      generatedMeetingPlayers.map((player) => [
        player.id,
        resolveMeetingAttendanceWindow(player, generatedMeetingSettings).end,
      ]),
    ),
    fairnessGameCreditsByPlayer: Object.fromEntries(
      Object.entries(meetingContinuation.players).map(([playerId, state]) => [
        playerId,
        state.fairnessGameCredit,
      ]),
    ),
  }), [
    generatedMeetingPlayers,
    generatedMeetingSettings,
    meetingContinuation.players,
  ])
  const scheduleWaitAnalysis = useMemo(
    () => analyzeScheduleWait(
      schedule,
      generatedMeetingPlayers,
      generatedMeetingSettings,
      meetingAnalysisOptions,
    ),
    [
      generatedMeetingPlayers,
      generatedMeetingSettings,
      meetingAnalysisOptions,
      schedule,
    ],
  )
  const participantWaitLimitViolations = useMemo(
    () => analyzeParticipantWaitLimitViolations(
      schedule,
      generatedMeetingPlayers,
      generatedMeetingSettings,
      meetingAnalysisOptions,
    ),
    [
      generatedMeetingPlayers,
      generatedMeetingSettings,
      meetingAnalysisOptions,
      schedule,
    ],
  )
  const scheduleQualityAnalysis = useMemo(
    () => analyzeScheduleQuality(
      schedule,
      generatedMeetingPlayers,
      generatedMeetingSettings,
      meetingAnalysisOptions,
    ),
    [
      generatedMeetingPlayers,
      generatedMeetingSettings,
      meetingAnalysisOptions,
      schedule,
    ],
  )
  const meetingReplanLockedMatchIds = useMemo(
    () => getMeetingReplanLockedMatchIds(
      schedule,
      results,
      meetingCourtAssignments,
      generatedMeetingSettings.courtAssignmentMode,
    ),
    [
      generatedMeetingSettings.courtAssignmentMode,
      meetingCourtAssignments,
      results,
      schedule,
    ],
  )
  const meetingV2Metrics = useMemo(
    () => analyzeMeetingScheduleV2(
      schedule,
      generatedMeetingPlayers,
      generatedMeetingSettings,
      {
        allowedAttendanceMatchIds: meetingReplanLockedMatchIds,
        allowedConsecutiveMatchIds: meetingReplanLockedMatchIds,
      },
    ),
    [
      generatedMeetingPlayers,
      generatedMeetingSettings,
      meetingReplanLockedMatchIds,
      schedule,
    ],
  )
  const meetingUsesClubQuality =
    meetingContinuation.revision === 0 &&
    generatedMeetingPlayers.filter(
      (player) => player.active && !player.isGuest,
    ).length <= 35 &&
    !generatedMeetingPlayers.some(
      (player) => player.active && player.isGuest,
    )
  const meetingSwapRecommendations = useMemo(() => {
    const recommendations = new Map<
      string,
      ReturnType<typeof rankMeetingSwapCandidates>
    >()
    const editingMatches = schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => editingMatchIds[match.id])

    for (const match of editingMatches) {
      for (const player of [...match.teamA, ...match.teamB]) {
        recommendations.set(
          meetingSwapRecommendationKey(match.id, player.id),
          rankMeetingSwapCandidates(
            schedule,
            generatedMeetingPlayers,
            generatedMeetingSettings,
            match.id,
            player.id,
          ),
        )
      }
    }
    return recommendations
  }, [
    editingMatchIds,
    generatedMeetingPlayers,
    generatedMeetingSettings,
    schedule,
  ])
  const displayNames = useMemo(() => makePlayerNameLookup(players), [players])
  const scheduleDisplayNames = useMemo(
    () => makePlayerNameLookup(generatedMeetingPlayers),
    [generatedMeetingPlayers],
  )
  const scheduleWarningsForStatus = useMemo(() => {
    if (!meetingWarningsReconciled) return schedule.warnings
    return schedule.warnings.filter(
      (warning) =>
        !warning.startsWith('동시 품질조건 후보 없음') &&
        !warning.startsWith('스페셜 경기 미완료:') &&
        !warning.startsWith('스페셜 경기 미배정:'),
    )
  }, [meetingWarningsReconciled, schedule.warnings])
  const reconciledSpecialWarnings = useMemo(() => {
    if (!meetingWarningsReconciled) return []
    const conditions = {
      ...defaultMatchConditionOptions,
      ...generatedMeetingSettings.conditionOptions,
    }
    if (!conditions.specialMatchCreation) return []
    const matches = schedule.rounds.flatMap((round) => round.matches)
    const specialRegularIds = new Set(
      matches
        .filter((match) => match.isSpecial)
        .flatMap((match) => [...match.teamA, ...match.teamB])
        .filter((player) => !player.isGuest)
        .map((player) => player.id),
    )
    const warnings: string[] = []
    if (!generatedMeetingSettings.specialLimitEnabled) {
      const pending = generatedMeetingPlayers.filter(
        (player) =>
          player.active &&
          !player.isGuest &&
          (player.specialMatchEligible ?? true) &&
          !specialRegularIds.has(player.id),
      )
      if (pending.length > 0) {
        warnings.push(
          `스페셜 경기 미완료: ${pending
            .map((player) => playerDisplayName(player, scheduleDisplayNames))
            .join(', ')}`,
        )
      }
    }
    const unplayedGuests = generatedMeetingPlayers.filter(
      (player) =>
        player.active &&
        player.isGuest &&
        (schedule.guestGameCounts[player.id] ?? 0) === 0,
    )
    if (unplayedGuests.length > 0) {
      warnings.push(
        `스페셜 경기 미배정: ${unplayedGuests
          .map((player) => playerDisplayName(player, scheduleDisplayNames))
          .join(', ')}`,
      )
    }
    return warnings
  }, [
    generatedMeetingPlayers,
    generatedMeetingSettings.conditionOptions,
    generatedMeetingSettings.specialLimitEnabled,
    meetingWarningsReconciled,
    schedule,
    scheduleDisplayNames,
  ])
  const reviewedSkillWarningMatches = meetingUsesClubQuality
    ? meetingV2Metrics.postWarmupSkillCautionMatches
    : scheduleQualityAnalysis.teamSkillWarningMatches
  const skillBalanceWarning = reviewedSkillWarningMatches > 0
    ? `실력 차 주의 ${reviewedSkillWarningMatches}경기 · 대진 카드 확인`
    : null
  const genderCompositionReviewNotice =
    (
      meetingUsesClubQuality
        ? meetingV2Metrics.postWarmupGenderExceptionMatches
        : scheduleQualityAnalysis.genderCompositionReviewMatches
    ) > 0
      ? `성별 조합 확인 ${
          meetingUsesClubQuality
            ? meetingV2Metrics.postWarmupGenderExceptionMatches
            : scheduleQualityAnalysis.genderCompositionReviewMatches
        }경기 · 보라색 카드 확인`
      : null
  const gameSpreadWarning = scheduleQualityAnalysis.standardGameSpread > 1
    ? `일반 참가자 경기 수 차 ${scheduleQualityAnalysis.standardGameSpread}경기`
    : null
  const groupRepeatWarning = scheduleQualityAnalysis.maximumGroupMeetings > 2
    ? `동일 4인 최대 ${scheduleQualityAnalysis.maximumGroupMeetings}경기`
    : null
  const opponentRepeatWarning = scheduleQualityAnalysis.maximumOpponentMeetings > 6
    ? `같은 상대 최대 ${scheduleQualityAnalysis.maximumOpponentMeetings}회`
    : null
  const candidateQualityWarning = scheduleWarningsForStatus.find((warning) =>
    warning.startsWith('동시 품질조건 후보 없음'),
  ) ?? null
  const hasMeetingQualityWarning = Boolean(
    scheduleWaitAnalysis.exceedsLimit ||
    gameSpreadWarning ||
    groupRepeatWarning ||
    opponentRepeatWarning ||
    skillBalanceWarning ||
    (
      meetingUsesClubQuality &&
      meetingV2Metrics.participantsBelowTightMinimum > 0
    ) ||
    (
      meetingUsesClubQuality &&
      meetingV2Metrics.postWarmupGenderExceptionMatches > 0
    ) ||
    candidateQualityWarning,
  )
  const meetingWarnings = useMemo(
    () => [
      ...scheduleWarningsForStatus,
      ...reconciledSpecialWarnings,
      ...(scheduleWaitAnalysis.warning ? [scheduleWaitAnalysis.warning] : []),
      ...(skillBalanceWarning ? [skillBalanceWarning] : []),
      ...(genderCompositionReviewNotice ? [genderCompositionReviewNotice] : []),
      ...(gameSpreadWarning ? [gameSpreadWarning] : []),
      ...(groupRepeatWarning ? [groupRepeatWarning] : []),
      ...(opponentRepeatWarning ? [opponentRepeatWarning] : []),
    ],
    [
      gameSpreadWarning,
      genderCompositionReviewNotice,
      groupRepeatWarning,
      opponentRepeatWarning,
      reconciledSpecialWarnings,
      scheduleWaitAnalysis.warning,
      scheduleWarningsForStatus,
      skillBalanceWarning,
    ],
  )
  useEffect(() => {
    if (!isMeetingGenerating || meetingOperationLabel !== '대진 검증 중') return
    if (meetingGenerationEndTimerRef.current !== null) {
      window.clearTimeout(meetingGenerationEndTimerRef.current)
    }

    meetingGenerationEndTimerRef.current = window.setTimeout(() => {
      const issues = [
        ...validateMeetingSchedule(
          schedule,
          generatedMeetingPlayers,
          generatedMeetingSettings,
          meetingAnalysisOptions,
        ),
        ...validateMeetingFairness(
          schedule,
          generatedMeetingPlayers,
          meetingAnalysisOptions,
        ),
      ]
      if (issues.length > 0) {
        setMeetingOperationLabel('대진 검증 실패')
        setMeetingGenerationMessage(issues.join(' · '))
        setNotice('대진 검증 실패')
        meetingGenerationEndTimerRef.current = null
        return
      }

      setMeetingOperationLabel('대진 완료')
      setMeetingGenerationMessage(
        [
          candidateQualityWarning,
          scheduleWaitAnalysis.warning,
          gameSpreadWarning,
          groupRepeatWarning,
          opponentRepeatWarning,
          skillBalanceWarning,
          genderCompositionReviewNotice,
        ]
          .filter(Boolean)
          .join(' · ') ||
        '중복·0경기·경기 수 균형 검증을 마쳤습니다.',
      )
      setNotice(
        hasMeetingQualityWarning
          ? '대진 완료 · 품질 경고'
          : '대진 검증 완료',
      )
      meetingGenerationEndTimerRef.current = null
    }, 500)
  }, [
    generatedMeetingPlayers,
    generatedMeetingSettings,
    isMeetingGenerating,
    meetingOperationLabel,
    meetingAnalysisOptions,
    schedule,
    gameSpreadWarning,
    genderCompositionReviewNotice,
    groupRepeatWarning,
    opponentRepeatWarning,
    candidateQualityWarning,
    hasMeetingQualityWarning,
    skillBalanceWarning,
    scheduleWaitAnalysis,
  ])
  const stats = useMemo(
    () =>
      calculateStats(
        generatedMeetingPlayers,
        schedule,
        results,
        matchNameOverrides,
      ),
    [generatedMeetingPlayers, schedule, results, matchNameOverrides],
  )
  const playerScheduleWindows = useMemo(() => {
    const windows = new Map<string, { firstStart: number; lastEnd: number; games: number }>()
    for (const round of schedule.rounds) {
      for (const match of round.matches) {
        const startsAt = match.startOffsetMinutes ??
          (round.number - 1) * GAME_SLOT_MINUTES
        const endsAt = startsAt +
          (match.durationMinutes ?? GAME_SLOT_MINUTES)
        for (const player of [...match.teamA, ...match.teamB]) {
          const current = windows.get(player.id)
          windows.set(player.id, {
            firstStart: Math.min(current?.firstStart ?? startsAt, startsAt),
            lastEnd: Math.max(current?.lastEnd ?? endsAt, endsAt),
            games: (current?.games ?? 0) + 1,
          })
        }
      }
    }
    return windows
  }, [schedule])
  const friendlyTeamsGenerated =
    isFriendlyTournamentFormat(tournamentSettings.format) &&
    tournamentTeams.some((team) => (team.members?.length ?? 0) > 0)
  const tournamentScheduleTeams = useMemo(
    () =>
      friendlyTeamsGenerated
        ? tournamentTeams
        : isFriendlyTournamentFormat(tournamentSettings.format)
          ? []
          : tournamentTeams,
    [friendlyTeamsGenerated, tournamentSettings.format, tournamentTeams],
  )
  const tournamentSchedule = useMemo(
    () =>
      generateTournamentSchedule(
        tournamentScheduleTeams,
        tournamentSettings,
        tournamentResults,
      ),
    [tournamentScheduleTeams, tournamentSettings, tournamentResults],
  )
  const meetingProgressLanes = useMemo(
    () => buildMeetingCourtLanes(schedule, results),
    [results, schedule],
  )
  const availableMeetingProgressLanes = useMemo(
    () => buildAvailableMeetingCourtLanes(
      schedule,
      generatedMeetingSettings.courtCount,
      meetingCourtAssignments,
      results,
    ),
    [
      generatedMeetingSettings.courtCount,
      meetingCourtAssignments,
      results,
      schedule,
    ],
  )
  const tournamentProgressLanes = useMemo(
    () => buildTournamentCourtLanes(
      tournamentSchedule.matches,
      tournamentResults,
    ),
    [tournamentResults, tournamentSchedule.matches],
  )
  const tournamentProgressCompletedCount = tournamentProgressLanes.reduce(
    (sum, lane) => sum + lane.completed.length,
    0,
  )
  const tournamentProgressTotalCount = tournamentProgressLanes.reduce(
    (sum, lane) =>
      sum + lane.ready.length + lane.waiting.length + lane.completed.length,
    0,
  )
  const undoableTournamentMatchId = useMemo(
    () => getUndoableTournamentMatchId(
      tournamentSchedule.matches,
      tournamentResults,
    ),
    [tournamentResults, tournamentSchedule.matches],
  )
  const tournamentTeamLookup = useMemo(
    () => new Map(tournamentScheduleTeams.map((team) => [team.id, team])),
    [tournamentScheduleTeams],
  )
  const tournamentParticipants = useMemo(
    () => tournamentParticipantsFromTeams(tournamentScheduleTeams),
    [tournamentScheduleTeams],
  )
  const tournamentParticipantsById = useMemo(
    () =>
      new Map(
        tournamentParticipants.map((participant) => [participant.id, participant]),
      ),
    [tournamentParticipants],
  )
  const generatedTournamentLineups = useMemo(
    () =>
      isFriendlyTournamentFormat(tournamentSettings.format)
        ? generateTournamentLineups(
            tournamentSchedule.matches,
            tournamentScheduleTeams,
            settings.levelTiers,
          )
        : {},
    [
      settings.levelTiers,
      tournamentSchedule.matches,
      tournamentSettings.format,
      tournamentScheduleTeams,
    ],
  )
  const effectiveTournamentLineups = useMemo(
    () => ({
      ...generatedTournamentLineups,
      ...tournamentLineups,
    }),
    [generatedTournamentLineups, tournamentLineups],
  )
  const tournamentMvpCandidates = useMemo(
    () =>
      isFriendlyTournamentFormat(tournamentSettings.format)
        ? calculateTournamentMvpCandidates(
            tournamentSchedule.matches,
            tournamentScheduleTeams,
            tournamentResults,
            effectiveTournamentLineups,
          )
        : {},
    [
      effectiveTournamentLineups,
      tournamentResults,
      tournamentSchedule.matches,
      tournamentScheduleTeams,
      tournamentSettings.format,
    ],
  )
  const playerNamePlaceholders = useMemo(() => {
    let regularCount = 0
    let guestCount = 0

    return Object.fromEntries(
      players.map((player) => {
        if (player.isGuest) {
          guestCount += 1
          return [player.id, `스페셜 ${guestCount}번`]
        }

        regularCount += 1
        return [player.id, `${regularCount}번`]
      }),
    )
  }, [players])

  const activePlayers = players.filter((player) => player.active)
  const prizeCandidates = activePlayers.map((player) => ({
    id: player.id,
    name: playerDisplayName(player, displayNames),
  }))
  const prizeList = parsePrizeList(prizeDraw.prizesText)
  const missionList = parseMissionList(prizeDraw.missionsText)
  const hasNamedPrizes = prizeList.length > 0
  const isPeoplePrizeReady = !hasNamedPrizes || prizeDraw.prizesConfirmed
  const nextPrizeDrawLabel = getNextPrizeDrawLabel(
    prizeList,
    prizeDraw.results.length,
  )
  const nextPrizeDrawLabels = getNextPrizeDrawLabels(
    prizeList,
    prizeDraw.results.length,
    prizeDraw.drawCount,
  )
  const remainingNamedPrizeCount = Math.max(
    0,
    prizeList.length - prizeDraw.results.length,
  )
  const activePrizeResults =
    prizeDraw.mode === 'mission' ? prizeDraw.missionResults : prizeDraw.results
  const drawnPrizeWinnerIds = new Set(
    prizeDraw.results.map((result) => result.winnerId),
  )
  const drawnMissionIds = new Set(
    prizeDraw.missionResults.map((result) => result.winnerId),
  )
  const availableRouletteCandidates = prizeDraw.allowDuplicateWinners
    ? prizeCandidates
    : prizeCandidates.filter((candidate) => !drawnPrizeWinnerIds.has(candidate.id))
  const availableMissions = missionList.filter((mission) => !drawnMissionIds.has(mission.id))
  const isRouletteMode = prizeDraw.mode === 'people' && isPeoplePrizeReady
  const rouletteItems =
    prizeDraw.mode === 'mission'
      ? missionList.map((mission) => ({ id: mission.id, name: mission.number }))
      : prizeCandidates
  const availableRouletteCount =
    prizeDraw.mode === 'mission'
      ? availableMissions.length
      : availableRouletteCandidates.length
  const prizeStatusText =
    prizeDraw.mode === 'mission'
      ? `미션 ${availableMissions.length}/${missionList.length}개`
      : hasNamedPrizes
        ? prizeDraw.prizesConfirmed
          ? `남은 경품 ${remainingNamedPrizeCount}/${prizeList.length}개 · ${prizeDraw.drawCount}명씩`
          : `입력 ${prizeList.length}개`
        : `룰렛 ${availableRouletteCandidates.length}/${prizeCandidates.length}명 · ${prizeDraw.drawCount}명씩`
  const prizeActionLabel =
    prizeDraw.mode === 'people' && hasNamedPrizes && !prizeDraw.prizesConfirmed
      ? '입력 완료'
      : '추첨'
  const rouletteWheelStyle = {
    '--roulette-rotation': `${rouletteRotation}deg`,
  } as CSSProperties
  const regularPlayers = players.filter((player) => !player.isGuest)
  const guestPlayers = players.filter((player) => player.isGuest)
  const activeMembers = activePlayers.filter((player) => !player.isGuest)
  const activeGuests = activePlayers.filter((player) => player.isGuest)
  const scheduledActivePlayers = generatedMeetingPlayers.filter(
    (player) => player.active,
  )
  const scheduledActiveMembers = scheduledActivePlayers.filter(
    (player) => !player.isGuest,
  )
  const scheduledActiveGuests = scheduledActivePlayers.filter(
    (player) => player.isGuest,
  )
  const hasScheduledActiveGuests = scheduledActiveGuests.length > 0
  const scheduledSpecialEligibleMembers = scheduledActiveMembers.filter(
    (player) => player.specialMatchEligible ?? true,
  )
  const specialLimitLabels = generatedMeetingSettings.specialLimitEnabled
    ? [
        generatedMeetingSettings.specialScheduleMode === 'spread'
          ? '전체 시간 분산'
          : '초반 집중',
        generatedMeetingSettings.specialGameLimitEnabled
          ? `목표 ${generatedMeetingSettings.specialGameLimit}경기`
          : '',
        `참가 ${generatedMeetingSettings.specialParticipantTarget}명`,
        generatedMeetingSettings.specialScheduleMode === 'continuous' &&
        generatedMeetingSettings.specialTimeLimitEnabled
          ? `${generatedMeetingSettings.specialTimeLimitMinutes}분`
          : '',
      ].filter(Boolean)
    : []
  const specialLimitText = generatedMeetingSettings.specialLimitEnabled
    ? specialLimitLabels.length > 0
      ? specialLimitLabels.join(' · ')
      : '제한 조건 선택 필요'
    : '제한 없음'
  const specialLowPriorityPercent = settings.specialLowPriorityEnabled
    ? settings.specialLowPriorityPercent
    : 0
  const specialHighPriorityPercent = settings.specialHighPriorityEnabled
    ? settings.specialHighPriorityPercent
    : 0
  const specialRandomPriorityPercent = Math.max(
    0,
    100 - specialLowPriorityPercent - specialHighPriorityPercent,
  )
  const scheduledSpecialLowPriorityPercent =
    generatedMeetingSettings.specialLowPriorityEnabled
      ? generatedMeetingSettings.specialLowPriorityPercent
      : 0
  const scheduledSpecialHighPriorityPercent =
    generatedMeetingSettings.specialHighPriorityEnabled
      ? generatedMeetingSettings.specialHighPriorityPercent
      : 0
  const scheduledSpecialRandomPriorityPercent = Math.max(
    0,
    100 -
      scheduledSpecialLowPriorityPercent -
      scheduledSpecialHighPriorityPercent,
  )
  const specialAllocationText =
    `저 ${scheduledSpecialLowPriorityPercent}% · ` +
    `무작위 ${scheduledSpecialRandomPriorityPercent}% · ` +
    `고 ${scheduledSpecialHighPriorityPercent}%`
  const requiredPlayers = hasScheduledActiveGuests
    ? scheduledSpecialEligibleMembers
    : []
  const completedMatches = schedule.rounds
    .flatMap((round) => round.matches)
    .filter((match) => results[match.id]?.completed).length
  const allScheduledMatches = getMeetingMatchSequence(schedule)
  const totalMatches = allScheduledMatches.length
  const canReplanMeeting =
    hasPlayerDraftChanges &&
    !hasMeetingSettingsDraftChanges &&
    completedMatches > 0 &&
    completedMatches < totalMatches &&
    !isMeetingGenerating &&
    !isMeetingReplanning
  const courtSchedules: Round[] = Array.from(
    { length: generatedMeetingSettings.courtCount },
    (_, index) => {
      const court = index + 1
      return {
        id: `court-${court}`,
        number: court,
        matches: schedule.rounds
          .flatMap((round) => round.matches)
          .filter((match) => match.court === court)
          .sort(
            (left, right) =>
              (left.startOffsetMinutes ?? 0) - (right.startOffsetMinutes ?? 0),
          ),
        resting: [],
      }
    },
  ).filter((court) => court.matches.length > 0)
  const meetingScheduleSections: Round[] =
    generatedMeetingSettings.courtAssignmentMode === 'available'
      ? allScheduledMatches.length > 0
        ? [{
            id: 'available-court-sequence',
            number: 0,
            matches: allScheduledMatches,
            resting: [],
          }]
        : []
      : courtSchedules
  const meetingMatchLocationById = new Map(
    meetingScheduleSections.flatMap((section) =>
      section.matches.map((match, index) => [
        match.id,
        generatedMeetingSettings.courtAssignmentMode === 'available'
          ? `${index + 1}번 경기`
          : `${section.number}코트 ${index + 1}번 경기`,
      ] as const),
    ),
  )
  const waitViolationDetail = (violation: WaitLimitParticipantViolation) => {
    const previous = violation.previousMatchId
      ? meetingMatchLocationById.get(violation.previousMatchId)
      : null
    const next = violation.nextMatchId
      ? meetingMatchLocationById.get(violation.nextMatchId)
      : null
    if (violation.phase === 'initial') {
      return `첫 경기 전 ${violation.waitMinutes}분${next ? ` · ${next} 전` : ''}`
    }
    if (violation.phase === 'between') {
      return `경기 간 ${violation.waitMinutes}분${
        previous && next ? ` · ${previous} → ${next}` : ''
      }`
    }
    if (violation.phase === 'final') {
      return `마지막 경기 후 ${violation.waitMinutes}분${
        previous ? ` · ${previous} 후` : ''
      }`
    }
    return `경기 미배정 · ${violation.waitMinutes}분 대기`
  }
  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
  )
  const scheduledBookingMinutes = getBookingDurationMinutes(
    generatedMeetingSettings.startTime,
    generatedMeetingSettings.endTime,
  )
  const scheduledBookingRoundCount = getBookingRoundCount(
    generatedMeetingSettings.startTime,
    generatedMeetingSettings.endTime,
  )
  const matchStartOffset = (match: Match) =>
    match.startOffsetMinutes ?? (match.round - 1) * GAME_SLOT_MINUTES
  const matchEndOffset = (match: Match) =>
    matchStartOffset(match) + (match.durationMinutes ?? GAME_SLOT_MINUTES)
  const estimatedMinutes = allScheduledMatches.reduce(
    (latest, match) => Math.max(latest, matchEndOffset(match)),
    0,
  )
  const estimatedEndTime = clockTimeAtOffset(
    generatedMeetingSettings.startTime,
    estimatedMinutes,
  )
  const overtimeMatches = allScheduledMatches.filter(
    (match) => matchEndOffset(match) > scheduledBookingMinutes,
  )
  const specialCutoffTime = clockTimeAtOffset(
    generatedMeetingSettings.startTime,
    generatedMeetingSettings.specialScheduleMode === 'continuous'
      ? Math.min(
          generatedMeetingSettings.specialTimeLimitMinutes,
          scheduledBookingMinutes,
        )
      : scheduledBookingMinutes,
  )
  const actualSpecialEndOffset = allScheduledMatches
    .filter((match) => match.isSpecial)
    .reduce((latest, match) => Math.max(latest, matchEndOffset(match)), 0)
  const actualSpecialEndTime = actualSpecialEndOffset > 0
    ? clockTimeAtOffset(
        generatedMeetingSettings.startTime,
        actualSpecialEndOffset,
      )
    : ''
  const generalOnlyAfterLimitMatches =
    generatedMeetingSettings.specialLimitEnabled &&
    generatedMeetingSettings.specialScheduleMode === 'continuous' &&
    generatedMeetingSettings.specialTimeLimitEnabled
    ? allScheduledMatches.filter(
        (match) =>
          matchStartOffset(match) >= generatedMeetingSettings.specialTimeLimitMinutes &&
          !match.isSpecial,
      ).length
    : 0
  const specialMinimumMatchCount = hasScheduledActiveGuests
    ? Math.ceil(requiredPlayers.length / 3)
    : 0
  const specialMatchesPerRound = hasScheduledActiveGuests
    ? Math.max(
        1,
        Math.min(
          generatedMeetingSettings.courtCount,
          scheduledActiveGuests.length,
          Math.floor(scheduledActivePlayers.length / 4),
        ),
      )
    : 0
  const specialMinimumRoundCount =
    specialMatchesPerRound > 0
      ? Math.ceil(specialMinimumMatchCount / specialMatchesPerRound)
      : 0
  const specialMinimumMinutes = specialMinimumRoundCount * GAME_SLOT_MINUTES
  const specialLimitRoundCount = generatedMeetingSettings.specialLimitEnabled
    ? generatedMeetingSettings.specialScheduleMode === 'continuous' &&
      generatedMeetingSettings.specialTimeLimitEnabled
      ? Math.min(
          scheduledBookingRoundCount,
          Math.floor(
            generatedMeetingSettings.specialTimeLimitMinutes / GAME_SLOT_MINUTES,
          ),
        )
      : scheduledBookingRoundCount
    : specialMinimumRoundCount
  const specialCapacityByTime = specialLimitRoundCount * specialMatchesPerRound
  const specialCapacityByGames = generatedMeetingSettings.specialLimitEnabled &&
    generatedMeetingSettings.specialGameLimitEnabled
    ? generatedMeetingSettings.specialGameLimit * scheduledActiveGuests.length
    : Number.POSITIVE_INFINITY
  const specialLimitMatchCapacity = generatedMeetingSettings.specialLimitEnabled
    ? Math.min(specialCapacityByTime, specialCapacityByGames)
    : specialMinimumMatchCount
  const specialLimitParticipantCapacity = Math.min(
    scheduledSpecialEligibleMembers.length,
    specialLimitMatchCapacity * 3,
    generatedMeetingSettings.specialLimitEnabled
      ? generatedMeetingSettings.specialParticipantTarget
      : Number.POSITIVE_INFINITY,
  )
  const scheduledSpecialParticipantIds = new Set(
    schedule.rounds
      .flatMap((round) => round.matches)
      .filter((match) => match.isSpecial)
      .flatMap((match) => [...match.teamA, ...match.teamB])
      .filter((player) => !player.isGuest)
      .map((player) => player.id),
  )
  const assignedSpecialParticipantCount = scheduledSpecialEligibleMembers.filter(
    (player) => scheduledSpecialParticipantIds.has(player.id),
  ).length
  const progressPercent =
    totalMatches > 0 ? Math.round((completedMatches / totalMatches) * 100) : 0
  const remainingMatches = Math.max(totalMatches - completedMatches, 0)
  const courtGameCounts = courtSchedules.map((court) => court.matches.length)
  const minimumCourtGames = courtGameCounts.length ? Math.min(...courtGameCounts) : 0
  const maximumCourtGames = courtGameCounts.length ? Math.max(...courtGameCounts) : 0
  const scheduleParticipantStats = stats.filter((stat) =>
    !stat.player.isGuest &&
    scheduledActivePlayers.some((player) => player.id === stat.player.id),
  )
  const averageGames = scheduleParticipantStats.length
    ? scheduleParticipantStats.reduce((sum, stat) => sum + stat.games, 0) /
      scheduleParticipantStats.length
    : 0
  const maximumParticipantGames = scheduleParticipantStats.length
    ? Math.max(...scheduleParticipantStats.map((stat) => stat.games))
    : 0
  const minimumParticipantGames = scheduleParticipantStats.length
    ? Math.min(...scheduleParticipantStats.map((stat) => stat.games))
    : 0
  const maximumParticipants = scheduleParticipantStats
    .filter((stat) => stat.games === maximumParticipantGames)
    .map((stat) => playerDisplayName(stat.player, scheduleDisplayNames))
    .join(', ')
  const minimumParticipants = scheduleParticipantStats
    .filter((stat) => stat.games === minimumParticipantGames)
    .map((stat) => playerDisplayName(stat.player, scheduleDisplayNames))
    .join(', ')
  const maximumParticipantCount = scheduleParticipantStats.filter(
    (stat) => stat.games === maximumParticipantGames,
  ).length
  const minimumParticipantCount = scheduleParticipantStats.filter(
    (stat) => stat.games === minimumParticipantGames,
  ).length
  const meetingAverageWaitMinutes = Math.round(
    scheduleQualityAnalysis.averageWaitMinutes,
  )
  const meetingMaximumWaitMinutes = scheduleWaitAnalysis.maximumWaitMinutes
  const gameCountFlexibleParticipantCount = scheduledActiveMembers.filter(
    (player) => player.gameCountFlexible,
  ).length
  const waitTimeFlexibleParticipantCount = scheduledActiveMembers.filter(
    (player) => player.waitTimeFlexible,
  ).length
  const meetingGroupCounts = new Map<string, number>()
  for (const match of allScheduledMatches) {
    const key = [...match.teamA, ...match.teamB]
      .map((player) => player.id)
      .sort()
      .join('|')
    meetingGroupCounts.set(key, (meetingGroupCounts.get(key) ?? 0) + 1)
  }
  const maximumMeetingGroupCount = Math.max(0, ...meetingGroupCounts.values())
  const scheduledSpecialMatchCount = allScheduledMatches.filter(
    (match) => match.isSpecial,
  ).length
  const activeTournamentTeams = tournamentTeams.filter(
    (team) => team.active && team.name.trim(),
  )
  const seededTournamentTeams = tournamentTeams.filter((team) => team.seed !== null)
  const completedTournamentMatches = tournamentSchedule.matches.filter(
    (match) => tournamentWinnerTeamId(match, tournamentResults[match.id]),
  ).length
  const totalTournamentMatches = tournamentSchedule.matches.length
  const tournamentBookingMinutes = getBookingDurationMinutes(
    tournamentSettings.startTime,
    tournamentSettings.endTime,
  )
  const tournamentBookingRoundCount = getBookingRoundCount(
    tournamentSettings.startTime,
    tournamentSettings.endTime,
  )
  const tournamentScheduledRoundCount = tournamentSchedule.matches.reduce(
    (maximum, match) => match.isBye ? maximum : Math.max(maximum, match.round),
    0,
  )
  const tournamentEstimatedMinutes =
    tournamentScheduledRoundCount * GAME_SLOT_MINUTES
  const tournamentEstimatedEndTime = clockTimeAtOffset(
    tournamentSettings.startTime,
    tournamentEstimatedMinutes,
  )
  const tournamentOvertimeRounds = Math.max(
    0,
    tournamentScheduledRoundCount - tournamentBookingRoundCount,
  )
  const tournamentLineupWarnings = useMemo(() => {
    if (!isFriendlyTournamentFormat(tournamentSettings.format)) return []

    let supportSlots = 0
    let incompleteMatches = 0

    for (const match of tournamentSchedule.matches) {
      if (match.phase !== 'team-battle' || !match.teamAId || !match.teamBId) continue

      const lineup = effectiveTournamentLineups[match.id]
      const sides = [
        { teamId: match.teamAId, ids: lineup?.teamAPlayerIds ?? [] },
        { teamId: match.teamBId, ids: lineup?.teamBPlayerIds ?? [] },
      ]
      let incomplete = false

      for (const side of sides) {
        for (const playerId of [side.ids[0] ?? '', side.ids[1] ?? '']) {
          if (!playerId) {
            incomplete = true
            continue
          }

          const participant = tournamentParticipantsById.get(playerId)
          if (!participant) {
            incomplete = true
            continue
          }

          if (participant.teamId !== side.teamId) supportSlots += 1
        }
      }

      if (incomplete) incompleteMatches += 1
    }

    return [
      supportSlots > 0 ? `지원 선수 ${supportSlots}자리 배정됨` : '',
      incompleteMatches > 0 ? `출전 조 확인 ${incompleteMatches}경기` : '',
    ].filter(Boolean)
  }, [
    effectiveTournamentLineups,
    tournamentParticipantsById,
    tournamentSchedule.matches,
    tournamentSettings.format,
  ])
  const tournamentWarnings = [
    ...(isFriendlyTournamentFormat(tournamentSettings.format) && !friendlyTeamsGenerated
      ? []
      : tournamentSchedule.warnings),
    ...tournamentLineupWarnings,
    tournamentOvertimeRounds > 0
      ? `대관 시간 ${formatDuration(tournamentOvertimeRounds * GAME_SLOT_MINUTES)} 초과 예상`
      : '',
  ].filter(Boolean)
  const nextTournamentMatch = tournamentSchedule.matches.find(
    (match) =>
      !match.isBye &&
      match.teamAId &&
      match.teamBId &&
      !tournamentWinnerTeamId(match, tournamentResults[match.id]),
  )
  const tournamentRounds = useMemo(() => {
    const grouped = new Map<number, TournamentMatch[]>()
    for (const match of tournamentSchedule.matches) {
      grouped.set(match.round, [...(grouped.get(match.round) ?? []), match])
    }

    return Array.from(grouped.entries())
      .sort(([left], [right]) => left - right)
      .map(([round, matches]) => ({
        round,
        matches: [...matches].sort((a, b) => a.order - b.order),
      }))
  }, [tournamentSchedule.matches])
  const tournamentTeamScheduleWindows = useMemo(() => {
    const windows = new Map<string, { firstRound: number; lastRound: number; games: number }>()
    for (const match of tournamentSchedule.matches) {
      if (match.isBye) continue
      for (const teamId of [match.teamAId, match.teamBId]) {
        if (!teamId) continue
        const current = windows.get(teamId)
        windows.set(teamId, {
          firstRound: current?.firstRound ?? match.round,
          lastRound: Math.max(current?.lastRound ?? 0, match.round),
          games: (current?.games ?? 0) + 1,
        })
      }
    }
    return windows
  }, [tournamentSchedule.matches])

  useEffect(() => {
    if (isSharedMode) return

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        appMode,
        progressMode,
        players,
        settings,
        generatedMeetingPlayers,
        generatedMeetingSettings,
        results,
        meetingCourtAssignments,
        pairMixes,
        matchNameOverrides,
        meetingLineups,
        meetingContinuation,
        prizeDraw,
        tournamentTeams,
        tournamentSettings,
        tournamentResults,
        tournamentLineups,
      }),
    )
    if (restoredMeetingNoticePendingRef.current) {
      restoredMeetingNoticePendingRef.current = false
      return
    }
    setNotice(
      appMode === 'meeting' && hasMeetingDraftChanges
        ? '변경 저장됨 · 생성 필요'
        : '저장됨',
    )
  }, [
    appMode,
    generatedMeetingPlayers,
    generatedMeetingSettings,
    hasMeetingDraftChanges,
    isSharedMode,
    players,
    settings,
    results,
    meetingCourtAssignments,
    pairMixes,
    progressMode,
    matchNameOverrides,
    meetingLineups,
    meetingContinuation,
    prizeDraw,
    tournamentTeams,
    tournamentSettings,
    tournamentResults,
    tournamentLineups,
  ])

  useEffect(() => {
    if (
      !progressMode ||
      appMode !== 'meeting' ||
      isSharedMode ||
      !schedule.rounds.some((round) => round.matches.length > 0)
    ) {
      return
    }

    try {
      window.localStorage.setItem(
        LAST_MEETING_SCHEDULE_KEY,
        JSON.stringify(storedMeetingScheduleSnapshot),
      )
    } catch {
      setNotice('진행 저장 실패 · 브라우저 저장 공간을 확인하세요.')
    }
  }, [
    appMode,
    isSharedMode,
    progressMode,
    schedule.rounds,
    storedMeetingScheduleSnapshot,
  ])

  useEffect(() => {
    let currentShareToken = getShareTokenFromLocation(window.location)

    const applySharedStateFromUrl = () => {
      const nextShareToken = getShareTokenFromLocation(window.location)
      if (!nextShareToken) {
        currentShareToken = null
        return
      }
      if (nextShareToken === currentShareToken) return

      const sharedState = readSharedState()
      if (!sharedState) return

      currentShareToken = nextShareToken
      setIsSharedMode(true)
      setProgressMode(false)
      setAppMode(sharedState.appMode)
      setPlayers(sharedState.players)
      setSettings(sharedState.settings)
      setGeneratedMeetingPlayers(sharedState.generatedMeetingPlayers)
      setGeneratedMeetingSettings(sharedState.generatedMeetingSettings)
      setScheduleOverride(sharedState.cachedMeetingSchedule)
      setResults(sharedState.results)
      setMeetingCourtAssignments(sharedState.meetingCourtAssignments)
      setPairMixes(sharedState.pairMixes)
      setMatchNameOverrides(sharedState.matchNameOverrides)
      setMeetingLineups(sharedState.meetingLineups)
      setMeetingContinuation(sharedState.meetingContinuation)
      setPrizeDraw(sharedState.prizeDraw)
      setTournamentTeams(sharedState.tournamentTeams)
      setTournamentSettings(sharedState.tournamentSettings)
      setTournamentResults(sharedState.tournamentResults)
      setTournamentLineups(sharedState.tournamentLineups)
      setPlayerDetailsOpen(sharedState.players.length > 0)
      setBulkOpen(false)
      setBulkText('')
      setView('schedule')
      setTournamentView('progress')
      setNotice('공유본')
    }

    window.addEventListener('hashchange', applySharedStateFromUrl)
    window.addEventListener('popstate', applySharedStateFromUrl)
    const shareUrlCheck = window.setInterval(applySharedStateFromUrl, 500)

    return () => {
      window.removeEventListener('hashchange', applySharedStateFromUrl)
      window.removeEventListener('popstate', applySharedStateFromUrl)
      window.clearInterval(shareUrlCheck)
    }
  }, [])

  useEffect(() => {
    const shareId = initialContext.shortShareId
    if (!shareId) return
    let active = true

    void (async () => {
      try {
        const payload = await loadShortShare(shareId)
        if (!active) return
        const sharedState = storedStateFromSharePayload(payload)
        setIsSharedMode(true)
        setProgressMode(false)
        setAppMode(sharedState.appMode)
        setPlayers(sharedState.players)
        setSettings(sharedState.settings)
        setGeneratedMeetingPlayers(sharedState.generatedMeetingPlayers)
        setGeneratedMeetingSettings(sharedState.generatedMeetingSettings)
        setScheduleOverride(sharedState.cachedMeetingSchedule)
        setResults(sharedState.results)
        setMeetingCourtAssignments(sharedState.meetingCourtAssignments)
        setPairMixes(sharedState.pairMixes)
        setMatchNameOverrides(sharedState.matchNameOverrides)
        setMeetingLineups(sharedState.meetingLineups)
        setMeetingContinuation(sharedState.meetingContinuation)
        setPrizeDraw(sharedState.prizeDraw)
        setTournamentTeams(sharedState.tournamentTeams)
        setTournamentSettings(sharedState.tournamentSettings)
        setTournamentResults(sharedState.tournamentResults)
        setTournamentLineups(sharedState.tournamentLineups)
        setPlayerDetailsOpen(sharedState.players.length > 0)
        setBulkOpen(false)
        setBulkText('')
        setView('schedule')
        setTournamentView('progress')
        setShortShareError('')
        setNotice('24시간 공유본')
      } catch (error) {
        if (!active) return
        setShortShareError(
          error instanceof ShortShareError && error.code === 'expired'
            ? '공유 링크가 만료되었습니다.'
            : '공유 대진을 불러오지 못했습니다.',
        )
      } finally {
        if (active) setIsShortShareLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [initialContext.shortShareId])

  useEffect(() => {
    const updateFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', updateFullscreenState)
    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenState)
    }
  }, [])

  useEffect(
    () => () => {
      if (rouletteTimerRef.current !== null) {
        window.clearTimeout(rouletteTimerRef.current)
      }
      if (contactCopyTimerRef.current !== null) {
        window.clearTimeout(contactCopyTimerRef.current)
      }
      if (meetingGenerationStartTimerRef.current !== null) {
        window.clearTimeout(meetingGenerationStartTimerRef.current)
      }
      if (meetingGenerationEndTimerRef.current !== null) {
        window.clearTimeout(meetingGenerationEndTimerRef.current)
      }
      meetingGenerationWorkerRef.current?.terminate()
      meetingGenerationWorkerRef.current = null
      meetingGenerationRequestRef.current += 1
      if (meetingStatusRefreshTimerRef.current !== null) {
        window.clearTimeout(meetingStatusRefreshTimerRef.current)
      }
      if (browserSaveToastTimerRef.current !== null) {
        window.clearTimeout(browserSaveToastTimerRef.current)
      }
    },
    [],
  )

  const updatePlayer = (id: string, patch: Partial<Player>) => {
    setPlayers((current) =>
      current.map((player) => (player.id === id ? { ...player, ...patch } : player)),
    )
  }

  const updatePlayerAttendanceTime = (
    player: Player,
    field: 'arrivalOffsetMinutes' | 'departureOffsetMinutes',
    value: string,
  ) => {
    const offset = meetingClockTimeToOffset(value, settings)
    if (offset === null) {
      setNotice('참석 시간은 모임 시간 안에서 선택해 주세요.')
      return
    }

    const currentWindow = resolveMeetingAttendanceWindow(player, settings)
    const nextStart = field === 'arrivalOffsetMinutes' ? offset : currentWindow.start
    const nextEnd = field === 'departureOffsetMinutes' ? offset : currentWindow.end
    const minimumDuration = player.isGuest
      ? GAME_SLOT_MINUTES
      : settings.normalGameMinutes
    if (nextEnd - nextStart < minimumDuration) {
      setNotice(`참석 시간은 최소 ${minimumDuration}분이어야 합니다.`)
      return
    }

    const bookingMinutes = getBookingDurationMinutes(
      settings.startTime,
      settings.endTime,
    )
    updatePlayer(player.id, {
      [field]: field === 'arrivalOffsetMinutes'
        ? offset === 0 ? undefined : offset
        : offset === bookingMinutes ? undefined : offset,
    })
    resetMeetingTargetRoundsForRosterChange()
    setNotice('참석 시간 변경됨 · 대진 생성 필요')
  }

  const resetPlayerAttendanceTime = (player: Player) => {
    updatePlayer(player.id, {
      arrivalOffsetMinutes: undefined,
      departureOffsetMinutes: undefined,
    })
    resetMeetingTargetRoundsForRosterChange()
    setNotice('모임 전체 시간 참석으로 변경됨')
  }

  const updatePreferredPartnerDraft = (player: Player, value: string) => {
    setPreferredPartnerDrafts((current) => ({ ...current, [player.id]: value }))
    const resolution = resolvePreferredPartnerNames(value, player, players)
    if (!resolution.error) {
      updatePlayer(player.id, { preferredPartnerIds: resolution.ids })
    }
  }

  const commitPreferredPartnerDraft = (player: Player) => {
    const value = preferredPartnerDrafts[player.id] ??
      preferredPartnerNames(player, players)
    const resolution = resolvePreferredPartnerNames(value, player, players)
    if (resolution.error) {
      setNotice(resolution.error)
      return
    }
    updatePlayer(player.id, { preferredPartnerIds: resolution.ids })
    setPreferredPartnerDrafts((current) => {
      const next = { ...current }
      delete next[player.id]
      return next
    })
    setNotice(
      resolution.ids.length > 0
        ? `선호 파트너 ${resolution.ids.length}명 저장됨`
        : '선호 파트너 해제됨',
    )
  }

  const clearMeetingScheduleState = () => {
    setResults({})
    setMeetingCourtAssignments({})
    setPairMixes({})
    setMatchNameOverrides({})
    setMeetingLineups({})
    setMeetingContinuation(makeDefaultMeetingContinuationState())
    setMatchNameDrafts({})
    setEditingMatchIds({})
    setMatchEditorErrors({})
    setCollapsedMatchIds({})
    setPrizeDraw((current) => ({ ...current, matchMissions: {} }))
    setPrintImageUrls([])
    setMeetingWarningsReconciled(false)
    window.localStorage.removeItem(LAST_MEETING_SCHEDULE_BACKUP_KEY)
    setHasMeetingBackup(false)
  }

  const resetMeetingTargetRounds = () => {
    setSettings((current) => {
      const targetRoundCount = getBookingRoundCount(
        current.startTime,
        current.endTime,
      )
      return getTargetRoundCount(current) === targetRoundCount &&
        current.pacingRoundCount === targetRoundCount &&
        current.roundCountLocked
        ? current
        : {
            ...current,
            targetRoundCount,
            pacingRoundCount: targetRoundCount,
            roundCountLocked: true,
          }
    })
  }

  const resetMeetingTargetRoundsForRosterChange = () => {
    if (completedMatches > 0) return
    resetMeetingTargetRounds()
  }

  const updateMeetingStartTime = (value: string) => {
    setSettings((current) => {
      const duration = getBookingDurationMinutes(
        current.startTime,
        current.endTime,
      )
      const startTime = normalizeClockTime(value, current.startTime)
      const endTime = clockTimeAtOffset(startTime, duration)
      const targetRoundCount = Math.floor(duration / GAME_SLOT_MINUTES)
      return {
        ...current,
        startTime,
        endTime,
        targetRoundCount,
        pacingRoundCount: targetRoundCount,
        roundCountLocked: true,
      }
    })
    setNotice('예약 시작 변경됨 · 생성 필요')
  }

  const updateMeetingEndTime = (value: string) => {
    const endTime = normalizeClockTime(value, settings.endTime)
    const duration = getBookingDurationMinutes(settings.startTime, endTime, 0)
    if (duration <= 0) {
      setNotice('종료 시간 확인 필요 · 최대 12시간')
      return
    }
    const targetRoundCount = Math.floor(duration / GAME_SLOT_MINUTES)
    setSettings((current) => ({
      ...current,
      endTime,
      specialTimeLimitMinutes: normalizeSpecialTimeLimit(
        current.specialTimeLimitMinutes,
        duration,
      ),
      targetRoundCount,
      pacingRoundCount: targetRoundCount,
      roundCountLocked: true,
    }))
    setNotice('예약 종료 변경됨 · 생성 필요')
  }

  const updateMeetingDuration = (duration: number) => {
    const safeDuration = Math.min(MAX_BOOKING_MINUTES, Math.max(GAME_SLOT_MINUTES, duration))
    const targetRoundCount = Math.floor(safeDuration / GAME_SLOT_MINUTES)
    setSettings((current) => ({
      ...current,
      endTime: clockTimeAtOffset(current.startTime, safeDuration),
      specialTimeLimitMinutes: Math.min(current.specialTimeLimitMinutes, safeDuration),
      targetRoundCount,
      pacingRoundCount: targetRoundCount,
      roundCountLocked: true,
    }))
    setCustomBookingTime(false)
    setNotice(`대관 ${formatDuration(safeDuration)} · 생성 필요`)
  }

  const setAppModeAndNotice = (mode: AppMode) => {
    setProgressMode(false)
    setAppMode(mode)
    setNotice(mode === 'meeting' ? '친목 모드' : '경쟁 모드')
  }

  const enterProgressMode = () => {
    if (isSharedMode) {
      setNotice('공유본은 진행할 수 없습니다.')
      return
    }
    if (appMode === 'meeting') {
      if (hasMeetingDraftChanges) {
        setNotice('변경사항 반영 후 대진을 다시 생성해 주세요.')
        return
      }
      if (totalMatches === 0) {
        setNotice('먼저 친목 대진을 생성해 주세요.')
        return
      }
      if (generatedMeetingSettings.courtAssignmentMode === 'available') {
        setMeetingCourtAssignments((current) =>
          initializeAvailableMeetingAssignments(
            schedule,
            generatedMeetingSettings.courtCount,
            current,
            results,
          ),
        )
      }
      try {
        window.localStorage.setItem(
          LAST_MEETING_SCHEDULE_KEY,
          JSON.stringify(storedMeetingScheduleSnapshot),
        )
      } catch {
        setNotice('진행 저장 실패 · 브라우저 저장 공간을 확인하세요.')
      }
    } else if (tournamentProgressTotalCount === 0) {
      setNotice('먼저 경쟁 대진을 생성해 주세요.')
      return
    }

    setProgressMode(true)
    setNotice(appMode === 'meeting' ? '친목 진행 중' : '경쟁 진행 중')
    window.scrollTo({ top: 0 })
  }

  const exitProgressMode = () => {
    setProgressMode(false)
    setNotice('진행 모드 종료')
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    }
  }

  const manageProgressParticipants = () => {
    setProgressMode(false)
    setPlayersOpen(true)
    setPlayerDetailsOpen(true)
    setNotice('참가자 변경 후 남은 대진을 다시 생성하세요.')
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    }
    window.setTimeout(() => scrollToSection('meeting-players'), 0)
  }

  const toggleProgressFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {
        setNotice('전체 화면 종료 실패')
      })
      return
    }
    if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
      setNotice('이 브라우저에서는 전체 화면을 사용할 수 없습니다.')
      return
    }
    void document.documentElement.requestFullscreen().catch(() => {
      setNotice('이 브라우저에서는 전체 화면을 사용할 수 없습니다.')
    })
  }

  const updateTournamentSettings = (patch: Partial<TournamentSettings>) => {
    setTournamentSettings((current) => normalizeTournamentSettings({ ...current, ...patch }))
    setTournamentResults({})
    if (patch.format !== undefined || patch.teamBattleMatchCount !== undefined) {
      setTournamentLineups({})
    }
    setNotice('경쟁 설정 변경됨')
  }

  const updateTournamentStartTime = (value: string) => {
    setTournamentSettings((current) => {
      const duration = getBookingDurationMinutes(
        current.startTime,
        current.endTime,
      )
      const startTime = normalizeClockTime(value, current.startTime)
      return {
        ...current,
        startTime,
        endTime: clockTimeAtOffset(startTime, duration),
      }
    })
    setTournamentPrintImageUrls([])
    setNotice('경쟁 시작 시간 변경됨')
  }

  const updateTournamentEndTime = (value: string) => {
    const endTime = normalizeClockTime(value, tournamentSettings.endTime)
    const duration = getBookingDurationMinutes(
      tournamentSettings.startTime,
      endTime,
      0,
    )
    if (duration <= 0) {
      setNotice('종료 시간 확인 필요 · 최대 12시간')
      return
    }
    setTournamentSettings((current) => ({ ...current, endTime }))
    setTournamentPrintImageUrls([])
    setNotice('경쟁 종료 시간 변경됨')
  }

  const openLevelTierEditor = () => {
    setLevelTierDraft(normalizeLevelTiers(settings.levelTiers))
    setLevelHelpOpen(false)
    setLevelTierEditorOpen(true)
  }

  const updateLevelTierDraft = (
    ageGroup: MatchAgeGroup,
    gender: 'male' | 'female',
    level: (typeof matchLevels)[number],
    value: unknown,
  ) => {
    const tier = normalizePositiveInteger(
      value,
      levelTierDraft[ageGroup][gender][level],
      1,
      20,
    )
    if (level === 'E') {
      setLevelTierDraft((current) =>
        Object.fromEntries(
          matchAgeGroups.map((currentAgeGroup) => [
            currentAgeGroup,
            Object.fromEntries(
              matchGenders.map((currentGender) => [
                currentGender,
                {
                  ...current[currentAgeGroup][currentGender],
                  E: tier,
                },
              ]),
            ),
          ]),
        ) as LevelTierTable,
      )
      return
    }
    setLevelTierDraft((current) => ({
      ...current,
      [ageGroup]: {
        ...current[ageGroup],
        [gender]: {
          ...current[ageGroup][gender],
          [level]: tier,
        },
      },
    }))
  }

  const applyLevelTierDraft = () => {
    setSettings((current) => ({
      ...current,
      levelTiers: normalizeLevelTiers(levelTierDraft),
    }))
    setLevelTierEditorOpen(false)
    setNotice('레벨 기준 변경됨 · 생성 필요')
  }

  const toggleMeetingMatch = (matchId: string) => {
    setCollapsedMatchIds((current) => ({
      ...current,
      [matchId]: !current[matchId],
    }))
  }

  const isTournamentRoundOpen = (roundNumber: number) =>
    tournamentRoundOpen[roundNumber] ?? true

  const toggleTournamentRound = (roundNumber: number) => {
    setTournamentRoundOpen((current) => ({
      ...current,
      [roundNumber]: !(current[roundNumber] ?? true),
    }))
  }

  const updateTournamentTeam = (id: string, patch: Partial<TournamentTeam>) => {
    setTournamentTeams((current) =>
      current.map((team, index) => {
        if (team.id !== id) return team

        const nextTeam: Partial<TournamentTeam> = { ...team, ...patch }
        if (patch.playerNames !== undefined && patch.members === undefined) {
          nextTeam.members = undefined
        }
        return normalizeTournamentTeam(nextTeam, index)
      }),
    )
    if (patch.seed !== undefined || patch.active !== undefined) {
      setTournamentResults({})
    }
    if (
      patch.playerNames !== undefined ||
      patch.members !== undefined ||
      patch.active !== undefined
    ) {
      setTournamentLineups({})
    }
  }

  const setTournamentTeamCount = (targetCount: number) => {
    setTournamentTeams((current) => {
      if (targetCount === current.length) return current

      if (isFriendlyTournamentFormat(tournamentSettings.format)) {
        return Array.from({ length: targetCount }, (_, index) =>
          makeTournamentTeam(index + 1),
        )
      }

      return targetCount > current.length
        ? [
            ...current,
            ...Array.from({ length: targetCount - current.length }, (_, index) =>
              makeTournamentTeam(current.length + index + 1),
            ),
          ]
        : current.slice(0, targetCount)
    })
    setTournamentResults({})
    setTournamentLineups({})
    setNotice('팀 수 변경됨')
  }

  const setTournamentSeedCount = (targetCount: number) => {
    setTournamentTeams((current) => {
      const normalizedCount = Math.min(targetCount, current.length)
      return current.map((team, index) => ({
        ...team,
        seed: index < normalizedCount ? index + 1 : null,
      }))
    })
    setTournamentResults({})
    setNotice('시드 수 변경됨')
  }

  const addTournamentTeam = () => {
    setTournamentTeamCount(tournamentTeams.length + 1)
  }

  const removeTournamentTeam = (id: string) => {
    setTournamentTeams((current) => current.filter((team) => team.id !== id))
    setTournamentResults({})
    setTournamentLineups({})
    setNotice('팀 삭제됨')
  }

  const updateTournamentResult = (
    matchId: string,
    patch: Partial<TournamentMatchResult>,
  ) => {
    setTournamentResults((current) => {
      const previous = current[matchId] ?? {
        teamAScore: '',
        teamBScore: '',
        completed: false,
        note: '',
      }
      const next = { ...previous, ...patch }
      const a = Number(next.teamAScore)
      const b = Number(next.teamBScore)
      const scoreChanged =
        patch.teamAScore !== undefined || patch.teamBScore !== undefined
      if (
        scoreChanged &&
        next.teamAScore !== '' &&
        next.teamBScore !== '' &&
        Number.isFinite(a) &&
        Number.isFinite(b) &&
        a !== b
      ) {
        next.completed = true
        next.winnerSide = a > b ? 'A' : 'B'
      } else if (scoreChanged) {
        next.completed = false
        next.winnerSide = undefined
      }
      return { ...current, [matchId]: next }
    })
  }

  const updateTournamentProgressScore = (
    matchId: string,
    side: MatchWinnerSide,
    value: string,
  ) => {
    setTournamentResults((current) => ({
      ...current,
      [matchId]: updateProgressScore(current[matchId], side, value),
    }))
  }

  const selectTournamentProgressWinner = (
    matchId: string,
    winnerSide: MatchWinnerSide,
  ) => {
    setTournamentResults((current) => ({
      ...current,
      [matchId]: toggleProgressWinner(current[matchId], winnerSide),
    }))
  }

  const completeTournamentProgressMatch = (matchId: string) => {
    const winnerSide = getProgressWinnerSide(tournamentResults[matchId])
    if (!winnerSide) {
      setNotice('승리 팀을 먼저 선택해 주세요.')
      return
    }
    setTournamentResults((current) => {
      const previous = current[matchId] ?? {
        teamAScore: '',
        teamBScore: '',
        completed: false,
        note: '',
      }
      return {
        ...current,
        [matchId]: {
          ...previous,
          completed: true,
          winnerSide,
        },
      }
    })
    setNotice('경쟁 경기 완료')
  }

  const undoTournamentProgressMatch = (matchId: string) => {
    if (matchId !== undoableTournamentMatchId) {
      setNotice('뒤 경기부터 완료를 취소해 주세요.')
      return
    }
    setTournamentResults((current) => {
      const previous = current[matchId]
      if (!previous) return current
      return {
        ...current,
        [matchId]: {
          ...previous,
          completed: false,
        },
      }
    })
    setNotice('경쟁 완료 취소')
  }

  const resetTournament = () => {
    const confirmed = window.confirm(
      '경쟁 팀, 설정, 결과가 기본값으로 돌아갑니다.\n계속 초기화할까요?',
    )
    if (!confirmed) return

    setTournamentTeams(defaultTournamentTeams)
    setProgressMode(false)
    setTournamentSettings(defaultTournamentSettings)
    setTournamentResults({})
    setTournamentLineups({})
    setTournamentView('progress')
    setNotice('경쟁 초기화됨')
  }

  const matchPlayerName = (match: Match, player: Player) =>
    matchNameOverrides[match.id]?.[player.id]?.trim() ||
    playerDisplayName(player, scheduleDisplayNames)

  const matchTeamName = (match: Match, team: Team) =>
    team.map((player) => matchPlayerName(match, player)).join(' + ')

  const tournamentTeamName = (teamId: string | undefined) =>
    teamId ? tournamentTeamLookup.get(teamId)?.name ?? '팀 없음' : '대기'

  const tournamentTeamRoster = (teamId: string | undefined) =>
    teamId ? tournamentTeamLookup.get(teamId)?.playerNames.trim() ?? '' : ''

  const tournamentLineupForMatch = (match: TournamentMatch): TournamentLineup =>
    effectiveTournamentLineups[match.id] ?? normalizeTournamentLineup(undefined)

  const tournamentLineupPlayerLabel = (
    playerId: string,
    teamId: string | undefined,
  ) => {
    const participant = tournamentParticipantsById.get(playerId)
    if (!participant) return ''

    return participant.teamId === teamId
      ? participant.name
      : `${participant.name}(지원)`
  }

  const tournamentLineupText = (match: TournamentMatch, side: 'A' | 'B') => {
    if (!isFriendlyTournamentFormat(tournamentSettings.format)) return ''
    if (match.phase !== 'team-battle') return ''

    const teamId = side === 'A' ? match.teamAId : match.teamBId
    const lineup = tournamentLineupForMatch(match)
    const playerIds = side === 'A' ? lineup.teamAPlayerIds : lineup.teamBPlayerIds
    return [playerIds[0] ?? '', playerIds[1] ?? '']
      .map((playerId) => tournamentLineupPlayerLabel(playerId, teamId))
      .filter(Boolean)
      .join(' + ')
  }

  const updateTournamentLineupPlayer = (
    match: TournamentMatch,
    side: 'A' | 'B',
    playerIndex: number,
    playerId: string,
  ) => {
    const field = side === 'A' ? 'teamAPlayerIds' : 'teamBPlayerIds'
    const baseLineup = normalizeTournamentLineup(tournamentLineupForMatch(match))
    const nextIds = [...baseLineup[field]]
    nextIds[playerIndex] = playerId

    setTournamentLineups((current) => ({
      ...current,
      [match.id]: {
        ...baseLineup,
        [field]: nextIds,
      },
    }))
    setNotice('출전 조 수정됨')
  }

  const resetTournamentLineup = (matchId: string) => {
    setTournamentLineups((current) => {
      const next = { ...current }
      delete next[matchId]
      return next
    })
    setNotice('자동 배정됨')
  }

  const tournamentSideName = (
    match: TournamentMatch,
    side: 'A' | 'B',
  ) => {
    const teamId = side === 'A' ? match.teamAId : match.teamBId
    const source = side === 'A' ? match.sourceA : match.sourceB
    if (teamId) return tournamentTeamName(teamId)
    return source ?? '대기'
  }

  const tournamentWinnerLabel = (
    match: TournamentMatch,
    result: TournamentMatchResult | undefined,
  ) => {
    const winnerId = tournamentWinnerTeamId(match, result)
    if (winnerId) return tournamentTeamName(winnerId)
    return match.isBye ? '부전승' : '대기'
  }

  const tournamentMatchPhaseLabel = (match: TournamentMatch) =>
    match.phase === 'team-battle'
      ? tournamentFormatLabels[tournamentSettings.format]
      : tournamentPhaseLabels[match.phase]

  const updateMatchNameDraft = (
    matchId: string,
    playerId: string,
    value: string,
  ) => {
    setMatchNameDrafts((current) => ({
      ...current,
      [matchId]: {
        ...(current[matchId] ?? {}),
        [playerId]: value,
      },
    }))
    setMatchEditorErrors((current) => {
      if (!current[matchId]) return current
      const next = { ...current }
      delete next[matchId]
      return next
    })
  }

  const openMatchEditor = (match: Match) => {
    setMatchNameDrafts((current) => {
      const next = { ...current }
      const matchDraft = { ...(next[match.id] ?? {}) }
      for (const player of [...match.teamA, ...match.teamB]) {
        matchDraft[player.id] = matchDraft[player.id] ?? player.id
      }
      next[match.id] = matchDraft
      return next
    })
    setMatchEditorErrors((current) => {
      if (!current[match.id]) return current
      const next = { ...current }
      delete next[match.id]
      return next
    })
    setEditingMatchIds((current) => ({ ...current, [match.id]: true }))
  }

  const saveMatchEditor = (match: Match) => {
    const showEditorError = (message: string) => {
      setMatchEditorErrors((current) => ({ ...current, [match.id]: message }))
      setNotice(message)
    }
    const matchDraft = matchNameDrafts[match.id] ?? {}
    const changes = [...match.teamA, ...match.teamB]
      .map((player) => ({ outgoingId: player.id, incomingId: matchDraft[player.id] ?? player.id }))
      .filter(({ outgoingId, incomingId }) => outgoingId !== incomingId)
    if (changes.length === 0) {
      setEditingMatchIds((current) => ({ ...current, [match.id]: false }))
      setMatchNameDrafts((current) => {
        const next = { ...current }
        delete next[match.id]
        return next
      })
      setMatchEditorErrors((current) => {
        const next = { ...current }
        delete next[match.id]
        return next
      })
      setNotice('수정 완료 · 변경 없음')
      return
    }
    if (changes.length > 1) {
      showEditorError('교체 불가 · 한 번에 참가자 1명만 선택해 주세요.')
      return
    }
    const change = changes[0]
    const incomingPlayer = generatedMeetingPlayers.find(
      (player) => player.id === change.incomingId,
    )
    if (!incomingPlayer?.active) {
      showEditorError('교체 불가 · 선택한 참가자가 현재 참가 명단에 없습니다.')
      return
    }
    const conflictMatch = findMeetingPlayerTimeConflict(
      schedule,
      match.id,
      change.incomingId,
    )
    const outgoingPlayer = generatedMeetingPlayers.find(
      (player) => player.id === change.outgoingId,
    )
    const recommendedCandidates = meetingSwapRecommendations.get(
      meetingSwapRecommendationKey(match.id, change.outgoingId),
    ) ?? []
    const isForcedSelection = !recommendedCandidates.some(
      (recommendation) => recommendation.player.id === change.incomingId,
    )
    const swapped = swapMeetingPlayers(
      schedule,
      match.id,
      change.outgoingId,
      change.incomingId,
    )
    if (!swapped) {
      showEditorError(
        '교체 불가 · 대진표에서 참가자 위치를 확인할 수 없습니다. 현황 업데이트 후 다시 시도하세요.',
      )
      return
    }
    const overlapPlayerId = findScheduleOverlap(swapped.schedule)
    if (overlapPlayerId) {
      const overlapPlayer = generatedMeetingPlayers.find(
        (player) => player.id === overlapPlayerId,
      )
      showEditorError(
        `교체 불가 · ${overlapPlayer
          ? playerDisplayName(overlapPlayer, scheduleDisplayNames)
          : '참가자'}의 동시간 중복이 발생합니다.`,
      )
      return
    }
    const changedAttendanceViolation = swapped.schedule.rounds
      .flatMap((round) => round.matches)
      .filter((changedMatch) => swapped.changedMatchIds.includes(changedMatch.id))
      .some((changedMatch) => {
        const start = changedMatch.startOffsetMinutes ??
          (changedMatch.round - 1) * GAME_SLOT_MINUTES
        const duration = changedMatch.durationMinutes ?? GAME_SLOT_MINUTES
        return [...changedMatch.teamA, ...changedMatch.teamB].some(
          (player) => !isPlayerAvailableForMeetingSlot(
            player,
            generatedMeetingSettings,
            start,
            duration,
          ),
        )
      })
    if (changedAttendanceViolation) {
      showEditorError('교체 불가 · 참석 시간 외 배정')
      return
    }
    const baseConsecutiveViolationKeys = new Set(
      findMeetingConsecutiveGameLimitViolations(schedule).map(
        (violation) => `${violation.matchId}:${violation.playerId}`,
      ),
    )
    const introducedConsecutiveViolation =
      findMeetingConsecutiveGameLimitViolations(swapped.schedule).some(
        (violation) => !baseConsecutiveViolationKeys.has(
          `${violation.matchId}:${violation.playerId}`,
        ),
      )
    if (introducedConsecutiveViolation) {
      showEditorError('교체 불가 · 연속 경기 제한 위반')
      return
    }
    const validationIssues = validateMeetingSchedule(
      swapped.schedule,
      generatedMeetingPlayers,
      generatedMeetingSettings,
      {
        ...meetingAnalysisOptions,
        allowedInactiveMatchIds: meetingReplanLockedMatchIds,
      },
    )
    const baseValidationIssues = new Set(validateMeetingSchedule(
      schedule,
      generatedMeetingPlayers,
      generatedMeetingSettings,
      {
        ...meetingAnalysisOptions,
        allowedInactiveMatchIds: meetingReplanLockedMatchIds,
      },
    ))
    const introducedValidationIssues = validationIssues.filter(
      (issue) => !baseValidationIssues.has(issue),
    )
    const blockingIssueSet = new Set<string>([
      '참가자 동시간 중복',
      '경기 인원 구성 오류',
      '비활성 참가자 배정',
      '코트 번호 오류',
      '코트 시간 중복',
      '참석 시간 외 배정',
      '연속 경기 제한 위반',
    ])
    const blockingValidationIssues = introducedValidationIssues.filter((issue) =>
      blockingIssueSet.has(issue),
    )
    if (blockingValidationIssues.length > 0) {
      showEditorError(`교체 불가 · ${blockingValidationIssues.join(' · ')}`)
      return
    }
    const baseQuality = analyzeScheduleQuality(
      schedule,
      generatedMeetingPlayers,
      generatedMeetingSettings,
      meetingAnalysisOptions,
    )
    const nextQuality = analyzeScheduleQuality(
      swapped.schedule,
      generatedMeetingPlayers,
      generatedMeetingSettings,
      meetingAnalysisOptions,
    )
    const baseWait = analyzeScheduleWait(
      schedule,
      generatedMeetingPlayers,
      generatedMeetingSettings,
      meetingAnalysisOptions,
    )
    const nextWait = analyzeScheduleWait(
      swapped.schedule,
      generatedMeetingPlayers,
      generatedMeetingSettings,
      meetingAnalysisOptions,
    )
    const forcedWarnings = [
      ...introducedValidationIssues.filter(
        (issue) => !blockingIssueSet.has(issue),
      ),
      nextQuality.standardGameSpread > Math.max(1, baseQuality.standardGameSpread)
        ? `일반 참가자 경기 수 차 ${nextQuality.standardGameSpread}경기`
        : '',
      nextQuality.participantsOverWaitLimit > baseQuality.participantsOverWaitLimit
        ? `25분 초과 ${nextQuality.participantsOverWaitLimit}명`
        : '',
      nextQuality.teamSkillDangerMatches > baseQuality.teamSkillDangerMatches
        ? `큰 실력 차 ${nextQuality.teamSkillDangerMatches}경기`
        : '',
      nextQuality.maximumGroupMeetings > Math.max(2, baseQuality.maximumGroupMeetings)
        ? `동일 4인 최대 ${nextQuality.maximumGroupMeetings}경기`
        : '',
      nextWait.maximumWaitMinutes > baseWait.maximumWaitMinutes
        ? `최장 대기 ${nextWait.maximumWaitMinutes}분`
        : '',
    ].filter(Boolean)
    if (isForcedSelection || conflictMatch || forcedWarnings.length > 0) {
      const confirmationLines = [
        isForcedSelection ? '권장 조건 밖의 강제 교체입니다.' : '',
        conflictMatch
          ? `${playerDisplayName(incomingPlayer, scheduleDisplayNames)}님은 같은 시간 ` +
            `${conflictMatch.court}코트에 참가 중이며, 확인하면 ` +
            `${outgoingPlayer
              ? playerDisplayName(outgoingPlayer, scheduleDisplayNames)
              : '현재 참가자'}님과 서로 자리를 바꿉니다.`
          : '',
        forcedWarnings.length > 0
          ? `예상 경고: ${forcedWarnings.join(' · ')}`
          : '',
        '이 변경을 적용하시겠습니까?',
      ].filter(Boolean)
      if (!window.confirm(confirmationLines.join('\n\n'))) {
        showEditorError('변경 취소 · 다른 참가자를 선택하거나 다시 완료해 주세요.')
        return
      }
    }

    setMeetingOperationLabel('교체 확인 중')
    setMeetingGenerationMessage('참가자 중복과 필수 대진 조건을 확인하고 있습니다.')
    setIsMeetingGenerating(true)
    setMeetingWarningsReconciled(false)
    setNotice('교체 확인 중')
    setMatchEditorErrors((current) => {
      const next = { ...current }
      delete next[match.id]
      return next
    })
    if (meetingGenerationEndTimerRef.current !== null) {
      window.clearTimeout(meetingGenerationEndTimerRef.current)
    }
    meetingGenerationEndTimerRef.current = window.setTimeout(() => {
      setMeetingLineups((current) => {
        const next = { ...current }
        for (const changedMatchId of swapped.changedMatchIds) {
          const changedMatch = swapped.schedule.rounds
            .flatMap((round) => round.matches)
            .find((item) => item.id === changedMatchId)
          if (!changedMatch) continue
          next[changedMatchId] = {
            teamAPlayerIds: changedMatch.teamA.map((player) => player.id),
            teamBPlayerIds: changedMatch.teamB.map((player) => player.id),
          }
        }
        return next
      })
      setMatchNameOverrides((current) => {
        const next = { ...current }
        for (const changedMatchId of swapped.changedMatchIds) delete next[changedMatchId]
        return next
      })
      setEditingMatchIds((current) => ({ ...current, [match.id]: false }))
      setMatchNameDrafts((current) => {
        const next = { ...current }
        delete next[match.id]
        return next
      })
      setIsMeetingGenerating(false)
      setNotice(swapped.changedMatchIds.length > 1 ? '맞교환 완료' : '교체 완료')
      meetingGenerationEndTimerRef.current = null
    }, 800)
  }

  const refreshMeetingStatus = () => {
    if (isMeetingStatusRefreshing) return
    const changedCompletedMatchIds = Object.keys(meetingLineups).filter(
      (matchId) => {
        const result = results[matchId]
        return Boolean(result?.completed || result?.winnerSide)
      },
    )
    const resetChangedResults =
      changedCompletedMatchIds.length > 0 &&
      window.confirm(
        `수동 수정된 완료 경기 ${changedCompletedMatchIds.length}개의 결과가 있습니다.\n` +
        '실제 참가자가 교체됐다면 확인을 눌러 결과를 초기화하세요.\n' +
        '명단 입력 오류 수정이었다면 취소를 눌러 결과를 유지합니다.',
      )

    if (meetingStatusRefreshTimerRef.current !== null) {
      window.clearTimeout(meetingStatusRefreshTimerRef.current)
    }
    setIsMeetingStatusRefreshing(true)
    setNotice('대진 분석 중')
    meetingStatusRefreshTimerRef.current = window.setTimeout(() => {
      if (resetChangedResults) {
        const resetIds = new Set(changedCompletedMatchIds)
        setResults((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([matchId]) => !resetIds.has(matchId)),
          ),
        )
      }
      setPrintImageUrls([])
      setMeetingWarningsReconciled(true)
      const issues = [
        ...validateMeetingSchedule(
          schedule,
          generatedMeetingPlayers,
          generatedMeetingSettings,
          {
            ...meetingAnalysisOptions,
            allowedInactiveMatchIds: meetingReplanLockedMatchIds,
            allowedAttendanceMatchIds: meetingReplanLockedMatchIds,
            allowedConsecutiveMatchIds: meetingReplanLockedMatchIds,
          },
        ),
        ...validateMeetingFairness(
          schedule,
          generatedMeetingPlayers,
          meetingAnalysisOptions,
        ),
      ]
      const qualityWarningCount = [
        scheduleWaitAnalysis.exceedsLimit,
        scheduleQualityAnalysis.standardGameSpread > 1,
        scheduleQualityAnalysis.maximumGroupMeetings > 2,
        scheduleQualityAnalysis.maximumOpponentMeetings > 6,
        scheduleQualityAnalysis.teamSkillWarningMatches > 0,
        scheduleQualityAnalysis.genderCompositionReviewMatches > 0,
      ].filter(Boolean).length
      setIsMeetingStatusRefreshing(false)
      setNotice(
        issues.length > 0
          ? `현황 업데이트 완료 · 검증 문제 ${issues.length}건`
          : qualityWarningCount > 0
            ? `현황 업데이트 완료 · 품질 확인 ${qualityWarningCount}건`
            : resetChangedResults
              ? '현황 업데이트 완료 · 변경 경기 결과 초기화'
              : '현황 업데이트 완료',
      )
      meetingStatusRefreshTimerRef.current = null
    }, 450)
  }

  const setRegularPlayerCount = (
    targetCount: number,
    keepDetailsVisible = false,
  ) => {
    const countChanged = targetCount !== regularPlayers.length
    setPlayers((current) => {
      const regulars = current.filter((player) => !player.isGuest)
      const guests = current.filter((player) => player.isGuest)
      if (targetCount === regulars.length) return current

      const nextRegulars =
        targetCount > regulars.length
          ? [
              ...regulars,
              ...Array.from({ length: targetCount - regulars.length }, (_, index) =>
                makeRegularPlayer(regulars.length + index + 1),
              ),
            ]
          : regulars.slice(0, targetCount)

      return [...guests, ...nextRegulars]
    })
    if (countChanged) {
      setPlayerDetailsOpen(keepDetailsVisible)
      setBulkOpen(!keepDetailsVisible)
      resetMeetingTargetRoundsForRosterChange()
    }
  }

  const setGuestCount = (targetCount: number, keepDetailsVisible = false) => {
    const countChanged = targetCount !== guestPlayers.length
    setPlayers((current) => {
      const guests = current.filter((player) => player.isGuest)
      const regulars = current.filter((player) => !player.isGuest)
      if (targetCount === guests.length) return current

      const nextGuests =
        targetCount > guests.length
          ? [
              ...guests,
              ...Array.from({ length: targetCount - guests.length }, (_, index) =>
                makeGuestPlayer(guests.length + index + 1),
              ),
            ]
          : guests.slice(0, targetCount)

      return [...nextGuests, ...regulars]
    })
    if (countChanged) {
      setPlayerDetailsOpen(keepDetailsVisible)
      setBulkOpen(!keepDetailsVisible)
      resetMeetingTargetRoundsForRosterChange()
    }
  }

  const addPlayer = () => {
    setRegularPlayerCount(regularPlayers.length + 1, true)
  }

  const addGuest = () => {
    setGuestCount(guestPlayers.length + 1, true)
  }

  const removePlayer = (id: string) => {
    setPlayers((current) => current
      .filter((player) => player.id !== id)
      .map((player) => ({
        ...player,
        preferredPartnerIds: (player.preferredPartnerIds ?? []).filter(
          (preferredId) => preferredId !== id,
        ),
      })))
    setPreferredPartnerDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setAttendanceEditorOpenIds((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    resetMeetingTargetRoundsForRosterChange()
  }

  const resetParticipants = () => {
    if (players.length === 0) {
      setNotice('초기화할 참가자 없음')
      return
    }
    const confirmed = window.confirm(
      '참가자 명단을 모두 비울까요?\n현재 대진표, 설정과 경품 정보는 유지됩니다.',
    )
    if (!confirmed) return

    setPlayers(defaultPlayers)
    setPlayerDetailsOpen(false)
    setBulkOpen(false)
    setBulkText('')
    setPreferredPartnerDrafts({})
    setAttendanceEditorOpenIds({})
    setNotice('참가자 초기화됨 · 생성 필요')
  }

  const handleReset = () => {
    const confirmed = window.confirm(
      '참가자, 설정, 대진표, 경기 결과, 수동 수정과 경품 정보가 모두 삭제됩니다.\n전체 초기화할까요?',
    )
    if (!confirmed) return

    if (rouletteTimerRef.current !== null) {
      window.clearTimeout(rouletteTimerRef.current)
      rouletteTimerRef.current = null
    }

    setPlayers(defaultPlayers)
    setSettings(meetingDefaultSettings)
    setGeneratedMeetingPlayers(defaultPlayers)
    setGeneratedMeetingSettings(meetingDefaultSettings)
    setProgressMode(false)
    setScheduleOverride(null)
    setResults({})
    setMeetingCourtAssignments({})
    setPairMixes({})
    setMatchNameOverrides({})
    setMeetingLineups({})
    setMeetingContinuation(makeDefaultMeetingContinuationState())
    setPrizeDraw({
      ...defaultPrizeDrawState,
      results: [],
      missionResults: [],
      matchMissions: {},
    })
    setIsRouletteSpinning(false)
    setRouletteWinnerName('')
    setPlayerDetailsOpen(false)
    setBulkOpen(false)
    setBulkText('')
    setPreferredPartnerDrafts({})
    setAttendanceEditorOpenIds({})
    setMatchEditorErrors({})
    window.localStorage.removeItem(LAST_MEETING_SCHEDULE_KEY)
    window.localStorage.removeItem(LAST_MEETING_SCHEDULE_BACKUP_KEY)
    setHasMeetingBackup(false)
    setNotice('초기화됨')
  }

  const startMeetingGeneration = (
    nextSettings: MatchSettings,
    completedNotice: string,
    force = false,
  ) => {
    if (isMeetingGenerating && !force) return
    setMeetingOperationLabel('대진 생성 중')
    setMeetingWaitLimitFailure(null)
    meetingGenerationCompletedNoticeRef.current = completedNotice

    if (meetingGenerationStartTimerRef.current !== null) {
      window.clearTimeout(meetingGenerationStartTimerRef.current)
    }
    if (meetingGenerationEndTimerRef.current !== null) {
      window.clearTimeout(meetingGenerationEndTimerRef.current)
    }
    meetingGenerationWorkerRef.current?.terminate()
    meetingGenerationWorkerRef.current = null
    const requestId = meetingGenerationRequestRef.current + 1
    meetingGenerationRequestRef.current = requestId

    const playerSnapshot = players
    setMeetingGenerationMessage((currentMessage) => {
      const availableMessages = MEETING_GENERATION_MESSAGES.filter(
        (message) => message !== currentMessage,
      )
      return availableMessages[
        Math.floor(Math.random() * availableMessages.length)
      ]
    })
    setIsMeetingGenerating(true)
    setNotice('대진 생성 중')
    meetingGenerationStartTimerRef.current = window.setTimeout(() => {
      setSettings(nextSettings)
      setGeneratedMeetingPlayers(playerSnapshot)
      setGeneratedMeetingSettings(nextSettings)
      setScheduleOverride(null)
      clearMeetingScheduleState()
      setMeetingOperationLabel('대진 생성 중')
      setMeetingGenerationMessage('참가자 조합과 경기 순서를 계산하고 있습니다.')
      meetingGenerationStartTimerRef.current = null

      const worker = new Worker(
        new URL('./meetingGeneration.worker.ts', import.meta.url),
        { type: 'module' },
      )
      meetingGenerationWorkerRef.current = worker

      const finishWorker = () => {
        worker.terminate()
        if (meetingGenerationWorkerRef.current === worker) {
          meetingGenerationWorkerRef.current = null
        }
      }
      const failGeneration = (message: string) => {
        if (meetingGenerationRequestRef.current !== requestId) return
        finishWorker()
        setMeetingOperationLabel('대진 검증 실패')
        setMeetingGenerationMessage(message)
        setNotice('대진 생성 실패')
      }

      worker.onmessage = (
        event: MessageEvent<MeetingGenerationWorkerResponse>,
      ) => {
        const response = event.data
        if (
          response.requestId !== requestId ||
          meetingGenerationRequestRef.current !== requestId
        ) return
        if (response.progress) {
          setMeetingGenerationMessage(response.progress)
          return
        }
        if (response.waitLimitFailure) {
          if (!response.schedule) {
            failGeneration('검토할 대진을 생성하지 못했습니다.')
            return
          }
          const unassignedCount = response.waitLimitFailure.participantViolations
            .filter((violation) => violation.phase === 'unassigned').length
          finishWorker()
          setScheduleOverride(response.schedule)
          setMeetingWaitLimitFailure(response.waitLimitFailure)
          setMeetingOperationLabel('대진 검증 실패')
          setMeetingGenerationMessage(
            unassignedCount > 0
              ? `0경기 ${unassignedCount}명 · 현재 운영 조건에서 전원 배정 불가`
              : `운영 중 최장 대기 ${response.waitLimitFailure.maximumWaitMinutes}분 · ` +
                `조정 필요 ${response.waitLimitFailure.participantsOverLimit}명`,
          )
          setNotice('25분 제한으로 대진 생성 불가')
          return
        }
        if (!response.schedule) {
          failGeneration(response.error || '대진을 생성하지 못했습니다.')
          return
        }
        finishWorker()
        setMeetingWaitLimitFailure(null)
        setScheduleOverride(response.schedule)
        setMeetingOperationLabel('대진 검증 중')
        setMeetingGenerationMessage(
          '참가자 중복, 코트, 전체 대기 25분을 확인하고 있습니다.',
        )
      }
      worker.onerror = () => {
        failGeneration('대진 계산 중 오류가 발생했습니다. 다시 생성해 주세요.')
      }
      worker.postMessage({
        requestId,
        players: playerSnapshot,
        settings: nextSettings,
        attemptCount: MEETING_GENERATION_ATTEMPTS,
      })
    }, 60)
  }

  const acceptGeneratedMeeting = () => {
    if (meetingGenerationEndTimerRef.current !== null) {
      window.clearTimeout(meetingGenerationEndTimerRef.current)
      meetingGenerationEndTimerRef.current = null
    }
    setIsMeetingGenerating(false)
    setMeetingWaitLimitFailure(null)
    setView('schedule')
    setNotice(meetingGenerationCompletedNoticeRef.current)
  }

  const generateAlternativeMeeting = () => {
    startMeetingGeneration(
      {
        ...generatedMeetingSettings,
        seed: generatedMeetingSettings.seed + MEETING_GENERATION_ATTEMPTS,
      },
      '다른 대진 생성됨',
      true,
    )
  }

  const returnToMeetingSettings = () => {
    if (meetingGenerationEndTimerRef.current !== null) {
      window.clearTimeout(meetingGenerationEndTimerRef.current)
      meetingGenerationEndTimerRef.current = null
    }
    meetingGenerationWorkerRef.current?.terminate()
    meetingGenerationWorkerRef.current = null
    meetingGenerationRequestRef.current += 1
    setIsMeetingGenerating(false)
    setMeetingWaitLimitFailure(null)
    setScheduleOverride(null)
    setSettingsOpen(true)
    setNotice('설정 확인 필요')
    window.setTimeout(() => scrollToSection('meeting-settings'), 0)
  }

  const generateBookingSchedule = () => {
    const bookingRoundTarget = getBookingRoundCount(
      settings.startTime,
      settings.endTime,
    )
    startMeetingGeneration(
      {
        ...settings,
        seed: settings.seed + 1,
        shuffleDirection: 'balanced',
        targetRoundCount: bookingRoundTarget,
        pacingRoundCount: bookingRoundTarget,
        roundCountLocked: true,
      },
      '예약 시간 대진 생성됨',
    )
  }

  const startMeetingReplan = () => {
    if (!canReplanMeeting) {
      if (hasMeetingSettingsDraftChanges) {
        setNotice('설정 변경은 전체 대진을 다시 생성해 주세요.')
      } else if (completedMatches === 0) {
        setNotice('완료 경기 1개부터 남은 대진을 다시 생성할 수 있습니다.')
      } else if (!hasPlayerDraftChanges) {
        setNotice('변경된 참가자 명단이 없습니다.')
      } else {
        setNotice('다시 생성할 예정 경기가 없습니다.')
      }
      return
    }

    const lockedCount = meetingReplanLockedMatchIds.length
    const currentCount = Math.max(0, lockedCount - completedMatches)
    const replacementCount = Math.max(0, totalMatches - lockedCount)
    const previousActiveGuestIds = new Set(
      generatedMeetingPlayers
        .filter((player) => player.active && player.isGuest)
        .map((player) => player.id),
    )
    const lateGuestCount = players.filter(
      (player) =>
        player.active &&
        player.isGuest &&
        !previousActiveGuestIds.has(player.id),
    ).length
    const confirmed = window.confirm(
      [
        `완료 ${completedMatches}경기와 현재 ${currentCount}경기를 유지합니다.`,
        `예정 ${replacementCount}경기를 변경된 명단으로 다시 생성할까요?`,
        lateGuestCount > 0
          ? `스페셜 ${lateGuestCount}명 추가 · 남은 모든 경기에 일반 경기 시간을 적용합니다.`
          : '',
      ].filter(Boolean).join('\n'),
    )
    if (!confirmed) return

    try {
      window.localStorage.setItem(
        LAST_MEETING_SCHEDULE_BACKUP_KEY,
        JSON.stringify(storedMeetingScheduleSnapshot),
      )
      setHasMeetingBackup(true)
    } catch {
      setNotice('자동 백업 실패 · 브라우저 저장 공간을 확인하세요.')
      window.alert('자동 백업을 만들지 못해 재생성을 중단했습니다.')
      return
    }

    meetingGenerationWorkerRef.current?.terminate()
    const requestId = meetingGenerationRequestRef.current + 1
    meetingGenerationRequestRef.current = requestId
    const worker = new Worker(
      new URL('./meetingGeneration.worker.ts', import.meta.url),
      { type: 'module' },
    )
    meetingGenerationWorkerRef.current = worker
    setIsMeetingReplanning(true)
    setNotice('남은 대진 재생성 중')

    const finishWorker = () => {
      worker.terminate()
      if (meetingGenerationWorkerRef.current === worker) {
        meetingGenerationWorkerRef.current = null
      }
    }
    const failReplan = (message: string) => {
      if (meetingGenerationRequestRef.current !== requestId) return
      finishWorker()
      window.localStorage.removeItem(LAST_MEETING_SCHEDULE_BACKUP_KEY)
      setHasMeetingBackup(false)
      setIsMeetingReplanning(false)
      setNotice(`기존 대진 유지 · ${message}`)
      window.alert(`남은 대진을 변경하지 않았습니다.\n${message}`)
    }

    worker.onmessage = (
      event: MessageEvent<MeetingGenerationWorkerResponse>,
    ) => {
      const response = event.data
      if (
        response.requestId !== requestId ||
        meetingGenerationRequestRef.current !== requestId
      ) return
      if (!response.replan) {
        failReplan(response.error || '재생성 결과를 받지 못했습니다.')
        return
      }
      if (response.replan.failureIssues.length > 0) {
        failReplan(response.replan.failureIssues.join(' · '))
        return
      }

      finishWorker()
      const replan = response.replan
      const lockedIds = new Set(replan.lockedMatchIds)
      const nextResults = Object.fromEntries(
        Object.entries(results).filter(([matchId]) => lockedIds.has(matchId)),
      )
      const nextAssignments = Object.fromEntries(
        Object.entries(meetingCourtAssignments)
          .filter(([matchId]) => lockedIds.has(matchId)),
      )
      const nextMatchNameOverrides = Object.fromEntries(
        Object.entries(matchNameOverrides)
          .filter(([matchId]) => lockedIds.has(matchId)),
      )
      const nextPrizeDraw: PrizeDrawState = {
        ...prizeDraw,
        matchMissions: Object.fromEntries(
          Object.entries(prizeDraw.matchMissions)
            .filter(([matchId]) => lockedIds.has(matchId)),
        ),
      }
      const nextSnapshot: StoredMeetingSchedule = {
        version: 2,
        savedAt: new Date().toISOString(),
        players,
        settings: generatedMeetingSettings,
        schedule: replan.schedule,
        results: nextResults,
        meetingCourtAssignments: nextAssignments,
        pairMixes: {},
        matchNameOverrides: nextMatchNameOverrides,
        meetingLineups: {},
        meetingContinuation: replan.continuation,
        prizeDraw: nextPrizeDraw,
      }

      setGeneratedMeetingPlayers(players)
      setScheduleOverride(replan.schedule)
      setResults(nextResults)
      setMeetingCourtAssignments(nextAssignments)
      setPairMixes({})
      setMatchNameOverrides(nextMatchNameOverrides)
      setMeetingLineups({})
      setMeetingContinuation(replan.continuation)
      setPrizeDraw(nextPrizeDraw)
      setMatchNameDrafts({})
      setEditingMatchIds({})
      setMatchEditorErrors({})
      setCollapsedMatchIds({})
      setPrintImageUrls([])
      setMeetingWarningsReconciled(false)
      setView('schedule')
      setIsMeetingReplanning(false)

      try {
        window.localStorage.setItem(
          LAST_MEETING_SCHEDULE_KEY,
          JSON.stringify(nextSnapshot),
        )
        setNotice(
          `완료 ${completedMatches}경기 유지 · 남은 ${replan.createdMatchIds.length}경기 재생성됨`,
        )
      } catch {
        setNotice('남은 대진 재생성됨 · 브라우저 저장 실패')
      }
    }
    worker.onerror = () => {
      failReplan('계산 중 오류가 발생했습니다.')
    }
    worker.postMessage({
      kind: 'replan',
      requestId,
      schedule,
      players,
      previousPlayers: generatedMeetingPlayers,
      settings: generatedMeetingSettings,
      results,
      assignments: meetingCourtAssignments,
      lockedMatchIds: meetingReplanLockedMatchIds,
      continuation: meetingContinuation,
    })
  }

  const restoreMeetingBackup = () => {
    const backup = readStoredMeetingSchedule(LAST_MEETING_SCHEDULE_BACKUP_KEY)
    if (!backup?.players?.length) {
      setHasMeetingBackup(false)
      setNotice('복원할 이전 대진이 없습니다.')
      return
    }
    const confirmed = window.confirm(
      '남은 대진 재생성 전 상태로 복원할까요?\n현재 재생성 대진은 교체됩니다.',
    )
    if (!confirmed) return

    const restoredPlayers = backup.players.map((player) =>
      normalizeStoredPlayer(player),
    )
    const restoredSettings = normalizeMatchSettings(backup.settings)
    const restoredSchedule = normalizeStoredSchedule(
      backup.schedule,
      restoredPlayers,
    )
    if (!restoredSchedule) {
      setNotice('이전 대진 복원 실패')
      return
    }

    setProgressMode(false)
    setPlayers(restoredPlayers)
    setSettings(restoredSettings)
    setGeneratedMeetingPlayers(restoredPlayers)
    setGeneratedMeetingSettings(restoredSettings)
    setScheduleOverride(restoredSchedule)
    setResults(backup.results ?? {})
    setMeetingCourtAssignments(normalizeMeetingCourtAssignments(
      backup.meetingCourtAssignments,
    ))
    setPairMixes(backup.pairMixes ?? {})
    setMatchNameOverrides(backup.matchNameOverrides ?? {})
    setMeetingLineups(backup.meetingLineups ?? {})
    setMeetingContinuation(normalizeMeetingContinuationState(
      backup.meetingContinuation,
    ))
    setPrizeDraw(normalizePrizeDrawState(backup.prizeDraw))
    setPrintImageUrls([])
    setMeetingWarningsReconciled(false)
    try {
      window.localStorage.setItem(
        LAST_MEETING_SCHEDULE_KEY,
        JSON.stringify(backup),
      )
      window.localStorage.removeItem(LAST_MEETING_SCHEDULE_BACKUP_KEY)
    } catch {
      setNotice('이전 대진 복원됨 · 브라우저 저장 실패')
      return
    }
    setHasMeetingBackup(false)
    setNotice('남은 대진 재생성 전 상태로 복원됨')
  }

  const addCourtGames = () => {
    const extensionMinutes = generatedMeetingSettings.normalGameMinutes
    const currentDuration = getBookingDurationMinutes(
      generatedMeetingSettings.startTime,
      generatedMeetingSettings.endTime,
      0,
    )
    if (
      currentDuration <= 0 ||
      currentDuration + extensionMinutes > MAX_BOOKING_MINUTES
    ) {
      setNotice('경기 추가 불가 · 대관 시간은 최대 12시간입니다.')
      return
    }

    const endTime = clockTimeAtOffset(
      generatedMeetingSettings.startTime,
      currentDuration + extensionMinutes,
    )
    const targetRoundCount = Math.max(
      getTargetRoundCount(generatedMeetingSettings),
      schedule.rounds.length,
    ) + 1
    const nextSettings: MatchSettings = {
      ...generatedMeetingSettings,
      endTime,
      targetRoundCount,
      roundCountLocked: true,
    }
    const appended = appendGeneralCourtGames(
      schedule,
      generatedMeetingPlayers,
      nextSettings,
    )
    if (appended.addedMatchIds.length === 0) {
      setNotice('경기 추가 불가 · 배정 가능한 일반 참가자가 부족합니다.')
      return
    }

    // 현재 화면의 수동 수정·믹스가 모두 반영된 대진을 새 기준표로 고정한다.
    // 이후에는 추가된 경기만 붙고 기존 경기 조합은 다시 생성하지 않는다.
    setScheduleOverride(appended.schedule)
    setPairMixes({})
    setMeetingLineups({})
    setMatchNameDrafts({})
    setEditingMatchIds({})
    setMatchEditorErrors({})
    setGeneratedMeetingSettings(nextSettings)
    setSettings(nextSettings)
    setPrintImageUrls([])
    setMeetingWarningsReconciled(false)
    setNotice(
      `기존 대진 유지 · 경기 ${appended.addedMatchIds.length}개 추가 · 종료 ${endTime}`,
    )
  }

  const removeLastCourtGames = () => {
    const reductionMinutes = generatedMeetingSettings.normalGameMinutes
    const currentDuration = getBookingDurationMinutes(
      generatedMeetingSettings.startTime,
      generatedMeetingSettings.endTime,
      0,
    )
    const nextDuration = currentDuration - reductionMinutes
    if (nextDuration < GAME_SLOT_MINUTES) return

    const removedMatches = allScheduledMatches.filter(
      (match) => matchEndOffset(match) > nextDuration,
    )
    if (removedMatches.length === 0) {
      setNotice('삭제할 마지막 경기가 없습니다.')
      return
    }

    const matchIds = new Set(removedMatches.map((match) => match.id))
    const hasRecordedData = removedMatches.some((match) => {
      const result = results[match.id]
      return Boolean(
        result?.completed ||
        result?.teamAScore?.trim() ||
        result?.teamBScore?.trim() ||
        result?.note?.trim() ||
        result?.winnerSide ||
        pairMixes[match.id] ||
        meetingCourtAssignments[match.id] ||
        Object.keys(matchNameOverrides[match.id] ?? {}).length > 0 ||
        prizeDraw.matchMissions[match.id],
      )
    })
    const message = hasRecordedData
      ? `마지막 ${removedMatches.length}경기의 점수, 메모, 수정, 미션도 함께 삭제됩니다. 계속할까요?`
      : generatedMeetingSettings.courtAssignmentMode === 'available'
        ? `전체 순번의 마지막 경기 ${removedMatches.length}개를 삭제할까요?`
        : `코트별 마지막 경기 ${removedMatches.length}개를 삭제할까요?`
    if (!window.confirm(message)) return

    const endTime = clockTimeAtOffset(
      generatedMeetingSettings.startTime,
      nextDuration,
    )
    const targetRoundCount = Math.max(
      1,
      getTargetRoundCount(generatedMeetingSettings) - 1,
    )
    const trimmedSchedule = applyMeetingLineups(
      {
        ...schedule,
        rounds: schedule.rounds
          .map((round) => ({
            ...round,
            matches: round.matches.filter((match) => !matchIds.has(match.id)),
          }))
          .filter((round) => round.matches.length > 0),
        warnings: schedule.warnings.filter(
          (warning) => !warning.startsWith('경기 추가 미배정'),
        ),
      },
      generatedMeetingPlayers,
      {},
    )
    setScheduleOverride(trimmedSchedule)
    setSettings((current) => ({
      ...current,
      endTime,
      targetRoundCount,
      roundCountLocked: true,
    }))
    setGeneratedMeetingSettings((current) => ({
      ...current,
      endTime,
      targetRoundCount,
      roundCountLocked: true,
    }))
    setResults((current) => omitRecordKeys(current, matchIds))
    setMeetingCourtAssignments((current) => omitRecordKeys(current, matchIds))
    setPairMixes({})
    setMeetingLineups({})
    setMatchNameOverrides((current) => omitRecordKeys(current, matchIds))
    setMatchNameDrafts((current) => omitRecordKeys(current, matchIds))
    setEditingMatchIds((current) => omitRecordKeys(current, matchIds))
    setPrizeDraw((current) => ({
      ...current,
      matchMissions: omitRecordKeys(current.matchMissions, matchIds),
    }))
    setCollapsedMatchIds((current) => omitRecordKeys(current, matchIds))
    setPrintImageUrls([])
    setNotice(`마지막 경기 ${removedMatches.length}개 삭제됨 · 종료 ${endTime}`)
  }

  const updateResult = (
    matchId: string,
    patch: Partial<MatchResult>,
  ) => {
    setResults((current) => {
      const previous = current[matchId] ?? {
        teamAScore: '',
        teamBScore: '',
        completed: false,
        note: '',
      }
      return { ...current, [matchId]: { ...previous, ...patch } }
    })
  }

  const completeMeetingProgressMatch = (matchId: string) => {
    updateResult(matchId, { completed: true })
    setNotice(
      generatedMeetingSettings.courtAssignmentMode === 'available'
        ? '경기 완료 · 빈 코트에 다음 경기를 배정하세요.'
        : '친목 경기 완료',
    )
  }

  const updateMeetingProgressScore = (
    matchId: string,
    side: MatchWinnerSide,
    value: string,
  ) => {
    setResults((current) => ({
      ...current,
      [matchId]: updateProgressScore(current[matchId], side, value),
    }))
  }

  const selectMeetingProgressWinner = (
    matchId: string,
    winnerSide: MatchWinnerSide,
  ) => {
    setResults((current) => ({
      ...current,
      [matchId]: toggleProgressWinner(current[matchId], winnerSide),
    }))
  }

  const undoMeetingProgressMatch = (matchId: string) => {
    if (
      generatedMeetingSettings.courtAssignmentMode === 'available' &&
      !canUndoAvailableMeetingMatch(
        schedule,
        matchId,
        meetingCourtAssignments,
        results,
      )
    ) {
      setNotice('이후 코트 배정을 먼저 취소해 주세요.')
      return
    }
    updateResult(matchId, { completed: false })
    setNotice('친목 완료 취소')
  }

  const assignNextMeetingMatch = (court: number) => {
    const nextMatch = getNextAvailableMeetingMatch(
      schedule,
      meetingCourtAssignments,
      results,
    )
    if (!nextMatch) {
      setNotice('현재 배정 가능한 대진이 없습니다.')
      return
    }
    setMeetingCourtAssignments((current) =>
      assignNextAvailableMeetingMatch(schedule, current, results, court),
    )
    setNotice(
      `${court}코트 · 전체 ${getMeetingSequenceNumber(schedule, nextMatch.id)}번 배정`,
    )
  }

  const cancelMeetingCourtAssignment = (matchId: string) => {
    if (results[matchId]?.completed) {
      setNotice('완료를 먼저 취소해 주세요.')
      return
    }
    const assignment = meetingCourtAssignments[matchId]
    if (!assignment) return
    setMeetingCourtAssignments((current) => {
      const next = { ...current }
      delete next[matchId]
      return next
    })
    setNotice(`${assignment.court}코트 배정 취소됨`)
  }

  const updateMatchWinner = (matchId: string, winnerSide: MatchWinnerSide) => {
    setResults((current) => ({
      ...current,
      [matchId]: toggleMeetingWinner(current[matchId], winnerSide),
    }))
  }

  const applyBulkPlayers = (mode: 'append' | 'replace') => {
    const parsedPlayers = parseBulkPlayers(bulkText)
    if (parsedPlayers.length === 0) {
      setNotice('추가할 명단 없음')
      return
    }

    setPlayers((current) =>
      mode === 'replace' ? parsedPlayers : [...current, ...parsedPlayers],
    )
    resetMeetingTargetRoundsForRosterChange()
    setPlayerDetailsOpen(true)
    setNotice(`${parsedPlayers.length}명 입력됨`)
  }

  const completePlayerRoster = () => {
    const parsedPlayers = parseBulkPlayers(bulkText)
    if (parsedPlayers.length === 0 && players.length === 0) {
      setNotice('입력할 명단 없음')
      return
    }

    if (parsedPlayers.length > 0) {
      setPlayers((current) =>
        mergeParsedPlayersWithRosterDraft(current, parsedPlayers),
      )
      resetMeetingTargetRoundsForRosterChange()
    }

    setPlayerDetailsOpen(true)
    setBulkOpen(false)
    setNotice(
      parsedPlayers.length > 0
        ? `${Math.max(players.length, parsedPlayers.length)}명 입력 완료`
        : '명단 입력 완료',
    )
  }

  const applyBulkTournamentTeams = (mode: 'append' | 'replace') => {
    const parsedTeams = parseBulkTournamentTeams(tournamentBulkText)
    if (parsedTeams.length === 0) {
      setNotice('추가할 팀 없음')
      return
    }

    setTournamentTeams((current) =>
      mode === 'replace' ? parsedTeams : [...current, ...parsedTeams],
    )
    setTournamentResults({})
    setTournamentLineups({})
    setTournamentBulkText('')
    setNotice(`${parsedTeams.length}팀 입력됨`)
  }

  const applyBulkTournamentPlayers = () => {
    const hasRosterInput = tournamentBulkText.trim().length > 0
    const parsedPlayers = parseBulkPlayers(tournamentBulkText)
    const expectedParticipantCount = tournamentSettings.friendlyParticipantCount
    const playersForGeneration =
      parsedPlayers.length > 0
        ? parsedPlayers
        : makeNumberedTournamentPlayers(expectedParticipantCount)

    if (playersForGeneration.length === 0) {
      setNotice(hasRosterInput ? '편성할 명단 없음' : '참가 수 확인 필요')
      return false
    }

    if (
      expectedParticipantCount > 0 &&
      parsedPlayers.length > 0 &&
      parsedPlayers.length !== expectedParticipantCount
    ) {
      setNotice(`참가자 수 확인: 설정 ${expectedParticipantCount}명 · 입력 ${parsedPlayers.length}명`)
      return false
    }

    if (tournamentTeams.length < 2) {
      setNotice('팀 수 2팀 이상 필요')
      return false
    }

    const result = generateBalancedTournamentTeams(
      playersForGeneration,
      tournamentTeams.length,
      settings.levelTiers,
    )
    if (result.teams.length === 0) {
      setNotice(result.warnings[0] ?? '편성 실패')
      return false
    }

    setTournamentSettings((current) =>
      current.format === 'friendly-team-battle'
        ? current
        : normalizeTournamentSettings({ ...current, format: 'friendly-team-battle' }),
    )
    setTournamentTeams(result.teams)
    setTournamentResults({})
    setTournamentLineups({})
    setTournamentBulkText('')
    setTournamentView('progress')
    setNotice(
      result.warnings.length > 0
        ? `${result.teams.length}팀 편성 · 확인 필요`
        : parsedPlayers.length > 0
          ? `${result.teams.length}팀 편성됨`
          : `${playersForGeneration.length}명 번호 편성됨`,
    )
    return true
  }

  const handleGenerateTournament = () => {
    if (isFriendlyTournamentFormat(tournamentSettings.format)) {
      if (applyBulkTournamentPlayers()) {
        scrollToSectionAfterRender('tournament-progress')
      }
      return
    }

    setTournamentView('progress')
    scrollToSectionAfterRender('tournament-progress')
    setNotice('경쟁 대진 생성됨')
  }

  const confirmPrizeEntries = () => {
    if (prizeList.length === 0) {
      setPrizeDraw((current) => ({ ...current, prizesConfirmed: false }))
      setNotice('경품 없음')
      return
    }

    setPrizeDraw((current) => ({
      ...current,
      prizesConfirmed: true,
      results: current.results.slice(0, prizeList.length),
    }))
    setRouletteWinnerName('')
    setPrizeListOpen(false)
    setNotice(`${prizeList.length}개 준비됨`)
  }

  const editPrizeEntries = () => {
    setPrizeDraw((current) => ({
      ...current,
      prizesConfirmed: false,
      results: [],
    }))
    setRouletteWinnerName('')
    setPrizeListOpen(false)
    setNotice('경품 수정')
  }

  const runRouletteDraw = () => {
    if (isRouletteSpinning) return
    if (prizeDraw.mode === 'mission') {
      if (missionList.length === 0) {
        setNotice('미션 없음')
        return
      }
      if (availableMissions.length === 0) {
        setNotice('미션 완료')
        return
      }

      const mission =
        availableMissions[
          Math.min(
            availableMissions.length - 1,
            Math.floor(Math.random() * availableMissions.length),
          )
        ]
      const missionIndex = Math.max(
        0,
        missionList.findIndex((item) => item.id === mission.id),
      )
      const itemAngle = missionList.length > 0 ? 360 / missionList.length : 0
      const targetRotation = (360 - missionIndex * itemAngle) % 360

      if (rouletteTimerRef.current !== null) {
        window.clearTimeout(rouletteTimerRef.current)
      }

      setIsRouletteSpinning(true)
      setRouletteWinnerName('')
      setRouletteRotation((current) => {
        const normalizedCurrent = ((current % 360) + 360) % 360
        const offset = (targetRotation - normalizedCurrent + 360) % 360
        return current + 1440 + offset
      })

      rouletteTimerRef.current = window.setTimeout(() => {
        const result = {
          prize: `${mission.number}번`,
          winnerId: mission.id,
          winnerName: mission.mission,
          reward: mission.reward,
          done: false,
        }
        setPrizeDraw((current) => ({
          ...current,
          missionResults: [...current.missionResults, result],
        }))
        setRouletteWinnerName(mission.number)
        setIsRouletteSpinning(false)
        setNotice('미션 당첨')
        rouletteTimerRef.current = null
      }, 2200)
      return
    }

    if (prizeCandidates.length === 0) {
      setNotice('추첨 대상 없음')
      return
    }
    if (nextPrizeDrawLabels.length === 0) {
      setNotice('경품 추첨 완료')
      return
    }
    if (availableRouletteCandidates.length === 0) {
      setNotice('전원 추첨 완료')
      return
    }

    const results = drawPrizeWinners(
      nextPrizeDrawLabels,
      availableRouletteCandidates,
      prizeDraw.allowDuplicateWinners,
    )
    const [firstResult] = results
    if (!firstResult) return

    const winnerIndex = Math.max(
      0,
      rouletteItems.findIndex((candidate) => candidate.id === firstResult.winnerId),
    )
    const itemAngle = rouletteItems.length > 0 ? 360 / rouletteItems.length : 0
    const targetRotation = (360 - winnerIndex * itemAngle) % 360

    if (rouletteTimerRef.current !== null) {
      window.clearTimeout(rouletteTimerRef.current)
    }

    setIsRouletteSpinning(true)
    setRouletteWinnerName('')
    setRouletteRotation((current) => {
      const normalizedCurrent = ((current % 360) + 360) % 360
      const offset = (targetRotation - normalizedCurrent + 360) % 360
      return current + 1440 + offset
    })

    rouletteTimerRef.current = window.setTimeout(() => {
      setPrizeDraw((current) => ({
        ...current,
        results: [...current.results, ...results],
      }))
      setRouletteWinnerName(
        results.length === 1
          ? firstResult.winnerName
          : `${firstResult.winnerName} 외 ${results.length - 1}명`,
      )
      setIsRouletteSpinning(false)
      setNotice(
        results.length === 1
          ? `${firstResult.winnerName} 당첨`
          : `${results.length}명 당첨`,
      )
      rouletteTimerRef.current = null
    }, 2200)
  }

  const runPrizeDraw = () => {
    if (
      prizeDraw.mode === 'people' &&
      hasNamedPrizes &&
      !prizeDraw.prizesConfirmed
    ) {
      confirmPrizeEntries()
      return
    }
    runRouletteDraw()
  }

  const resetPrizeDrawResults = () => {
    if (rouletteTimerRef.current !== null) {
      window.clearTimeout(rouletteTimerRef.current)
      rouletteTimerRef.current = null
    }
    setPrizeDraw((current) =>
      current.mode === 'mission'
        ? { ...current, missionResults: [] }
        : { ...current, results: [] },
    )
    setIsRouletteSpinning(false)
    setRouletteWinnerName('')
    setNotice('추첨 초기화됨')
  }

  const copyPrizeDrawResults = async () => {
    if (activePrizeResults.length === 0) {
      setNotice('복사할 결과 없음')
      return
    }

    try {
      await copyToClipboard(
        activePrizeResults
          .map((result) =>
            prizeDraw.mode === 'mission'
              ? `${result.prize} - ${result.winnerName} - ${result.reward ?? '상품'} - ${
                  result.done ? '지급' : '대기'
                }`
              : `${result.prize} - ${result.winnerName}`,
          )
          .join('\n'),
      )
      setNotice('추첨 결과 복사됨')
    } catch {
      setNotice('결과 복사 실패')
    }
  }

  const toggleMissionPrizeDone = (index: number) => {
    setPrizeDraw((current) => ({
      ...current,
      missionResults: current.missionResults.map((result, resultIndex) =>
        resultIndex === index ? { ...result, done: !result.done } : result,
      ),
    }))
  }

  const drawMissionForMatch = (matchId: string) => {
    if (missionList.length === 0) {
      setNotice('미션 없음')
      return
    }

    const mission =
      missionList[
        Math.min(missionList.length - 1, Math.floor(Math.random() * missionList.length))
      ]
    setPrizeDraw((current) => ({
      ...current,
      matchMissions: {
        ...current.matchMissions,
        [matchId]: {
          prize: `${mission.number}번`,
          winnerId: mission.id,
          winnerName: mission.mission,
          reward: mission.reward,
          done: false,
        },
      },
    }))
    setNotice(`${mission.number}번 미션`)
  }

  const toggleMatchMissionDone = (matchId: string) => {
    setPrizeDraw((current) => {
      const mission = current.matchMissions[matchId]
      if (!mission) return current

      return {
        ...current,
        matchMissions: {
          ...current.matchMissions,
          [matchId]: { ...mission, done: !mission.done },
        },
      }
    })
  }

  const mixMatch = (matchId: string) => {
    const currentMatch = schedule.rounds
      .flatMap((round) => round.matches)
      .find((match) => match.id === matchId)
    if (!currentMatch) {
      setNotice('파트너 변경 실패 · 경기를 찾을 수 없습니다.')
      return
    }

    setMeetingWarningsReconciled(false)
    if (meetingLineups[matchId]) {
      const nextMatch = cycleMeetingMatchPartners(currentMatch)
      setMeetingLineups((current) => ({
        ...current,
        [matchId]: {
          teamAPlayerIds: nextMatch.teamA.map((player) => player.id),
          teamBPlayerIds: nextMatch.teamB.map((player) => player.id),
        },
      }))
      setPairMixes((current) => {
        if (current[matchId] === undefined) return current
        const next = { ...current }
        delete next[matchId]
        return next
      })
    } else {
      setPairMixes((current) => ({
        ...current,
        [matchId]: ((current[matchId] ?? 0) + 1) % 3,
      }))
    }
    setResults((current) => {
      const next = { ...current }
      delete next[matchId]
      return next
    })
    setMatchEditorErrors((current) => {
      if (!current[matchId]) return current
      const next = { ...current }
      delete next[matchId]
      return next
    })
    setPrintImageUrls([])
    setNotice('파트너 변경됨')
  }

  const handleCopyShareLink = async () => {
    try {
      const legacyPayload: SharePayload = {
        version: 1,
        generatedAt: new Date().toISOString(),
        appMode,
        players: appMode === 'meeting' ? generatedMeetingPlayers : players,
        settings: appMode === 'meeting' ? generatedMeetingSettings : settings,
        results,
        meetingCourtAssignments,
        pairMixes,
        matchNameOverrides,
        meetingLineups,
        prizeDraw,
        tournamentTeams,
        tournamentSettings,
        tournamentResults,
        tournamentLineups,
      }
      let shareUrl: string
      let savedMessage: string
      try {
        shareUrl = await createShortShareUrl(
          {
            ...legacyPayload,
            pairMixes: appMode === 'meeting' ? {} : pairMixes,
            meetingLineups: appMode === 'meeting' ? {} : meetingLineups,
            meetingSchedule: appMode === 'meeting' ? schedule : undefined,
          },
          getBaseUrl(),
        )
        savedMessage = '24시간 짧은 공유 링크를 복사했습니다.'
      } catch {
        shareUrl = makeShareUrl(getBaseUrl(), legacyPayload)
        savedMessage = `${SHARE_LINK_SAVED_MESSAGE}\n짧은 링크 연결 실패로 기존 링크를 복사했습니다.`
      }
      await copyToClipboard(shareUrl)
      window.alert(savedMessage)
      setNotice(savedMessage.split('\n')[0])
    } catch {
      setNotice('공유 링크 실패')
    }
  }

  const saveScheduleImages = async (imageUrls: string[]) => {
    const baseName = sanitizeFilename(generatedMeetingSettings.eventName)
    await Promise.all(
      imageUrls.map((imageUrl, index) =>
        downloadPrintImage(imageUrl, `${baseName}-대진표-${index + 1}.png`),
      ),
    )
    setNotice(`대진표 저장 ${imageUrls.length}장`)
  }

  const saveScheduleImage = async (imageUrl: string, index: number) => {
    try {
      const baseName = sanitizeFilename(generatedMeetingSettings.eventName)
      await downloadPrintImage(imageUrl, `${baseName}-대진표-${index + 1}.png`)
      setNotice(`대진표 저장 ${index + 1}쪽`)
    } catch {
      setNotice('대진표 저장 실패')
    }
  }

  const handlePrintSchedule = async () => {
    try {
      const imageUrls = createSchedulePrintImages({
        generatedAt: new Date(),
        names: scheduleDisplayNames,
        results,
        schedule,
        summary: {
          averageGames,
          estimatedMinutes,
          maximumGames: maximumParticipantGames,
          maximumParticipants,
          minimumGames: minimumParticipantGames,
          minimumParticipants,
          participantCount: scheduledActivePlayers.length,
          specialCount: scheduledActiveGuests.length,
          specialStatus: hasScheduledActiveGuests
            ? `스페셜 배정 ${assignedSpecialParticipantCount}/${scheduledActiveMembers.length}명 · 대상 ${scheduledSpecialEligibleMembers.length}명 · ${specialAllocationText} · ${specialLimitText}${actualSpecialEndTime ? ` · 마지막 ${actualSpecialEndTime}` : ''}`
            : '스페셜 없음',
        },
        settings: generatedMeetingSettings,
        matchNameOverrides,
      })

      setPrintImageUrls(imageUrls)
      await saveScheduleImages(imageUrls)
      scrollToPrintPreview(meetingPrintPreviewRef)
    } catch {
      setNotice('대진표 저장 실패')
    }
  }

  const savePreparedScheduleImages = async () => {
    if (printImageUrls.length === 0) {
      await handlePrintSchedule()
      return
    }

    try {
      await saveScheduleImages(printImageUrls)
    } catch {
      setNotice('대진표 저장 실패')
    }
  }

  const saveTournamentScheduleImages = async (imageUrls: string[]) => {
    const baseName = sanitizeFilename(`${defaultSettings.eventName}-경쟁`)
    await Promise.all(
      imageUrls.map((imageUrl, index) =>
        downloadPrintImage(imageUrl, `${baseName}-대진표-${index + 1}.png`),
      ),
    )
    setNotice(`경쟁 대진표 저장 ${imageUrls.length}장`)
  }

  const saveTournamentScheduleImage = async (imageUrl: string, index: number) => {
    try {
      const baseName = sanitizeFilename(`${defaultSettings.eventName}-경쟁`)
      await downloadPrintImage(imageUrl, `${baseName}-대진표-${index + 1}.png`)
      setNotice(`경쟁 대진표 저장 ${index + 1}쪽`)
    } catch {
      setNotice('경쟁 대진표 저장 실패')
    }
  }

  const handlePrintTournament = async () => {
    try {
      const imageUrls = createTournamentPrintImages({
        generatedAt: new Date(),
        results: tournamentResults,
        schedule: tournamentSchedule,
        settings: tournamentSettings,
        teams: tournamentScheduleTeams,
        lineups: isFriendlyTournamentFormat(tournamentSettings.format)
          ? effectiveTournamentLineups
          : undefined,
        title: defaultSettings.eventName,
      })

      setTournamentPrintImageUrls(imageUrls)
      await saveTournamentScheduleImages(imageUrls)
      scrollToPrintPreview(tournamentPrintPreviewRef)
    } catch {
      setNotice('경쟁 대진표 저장 실패')
    }
  }

  const savePreparedTournamentScheduleImages = async () => {
    if (tournamentPrintImageUrls.length === 0) {
      await handlePrintTournament()
      return
    }

    try {
      await saveTournamentScheduleImages(tournamentPrintImageUrls)
    } catch {
      setNotice('경쟁 대진표 저장 실패')
    }
  }

  const saveMeetingScheduleToBrowser = () => {
    const showBrowserSaveToast = (message: string, error = false) => {
      if (browserSaveToastTimerRef.current !== null) {
        window.clearTimeout(browserSaveToastTimerRef.current)
      }
      setBrowserSaveToast({ message, error })
      browserSaveToastTimerRef.current = window.setTimeout(() => {
        setBrowserSaveToast(null)
        browserSaveToastTimerRef.current = null
      }, 3000)
    }
    const hasMatches = schedule.rounds.some((round) => round.matches.length > 0)
    if (!hasMatches) {
      setNotice('브라우저에 저장할 대진표가 없습니다.')
      showBrowserSaveToast('저장할 대진표가 없습니다.', true)
      return
    }

    try {
      window.localStorage.setItem(
        LAST_MEETING_SCHEDULE_KEY,
        JSON.stringify(storedMeetingScheduleSnapshot),
      )
      setNotice('대진표가 브라우저에 저장됨')
      showBrowserSaveToast('대진표가 브라우저에 저장되었습니다.')
    } catch {
      setNotice('브라우저 저장 실패 · 저장 공간을 확인하세요.')
      showBrowserSaveToast('브라우저 저장에 실패했습니다.', true)
    }
  }

  const useSharedCopy = () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        appMode,
        progressMode: false,
        players,
        settings,
        generatedMeetingPlayers,
        generatedMeetingSettings,
        results,
        meetingCourtAssignments,
        pairMixes,
        matchNameOverrides,
        meetingLineups,
        prizeDraw,
        tournamentTeams,
        tournamentSettings,
        tournamentResults,
        tournamentLineups,
      }),
    )
    window.history.replaceState(null, '', getBaseUrl())
    setIsSharedMode(false)
    setProgressMode(false)
    setPlayerDetailsOpen(players.length > 0)
    setBulkOpen(false)
    setNotice('편집 모드')
  }

  const openMySchedule = () => {
    window.location.href = getBaseUrl()
  }

  const scrollToElement = (element: HTMLElement | null) => {
    if (!element) return

    const header = document.querySelector<HTMLElement>('.app-header')
    const headerHeight = header?.offsetHeight ?? 0
    const top = element.getBoundingClientRect().top + window.scrollY - headerHeight - 12
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId)
    if (!element) return

    scrollToElement(element)
  }

  const scrollToSectionAfterRender = (sectionId: string) => {
    window.setTimeout(() => scrollToSection(sectionId), 0)
  }

  const openWaitLimitManualEdit = (
    selectedViolation?: WaitLimitParticipantViolation,
  ) => {
    const violation = selectedViolation ??
      meetingWaitLimitFailure?.participantViolations[0] ??
      participantWaitLimitViolations[0]
    const targetMatchId =
      violation?.nextMatchId ??
      violation?.previousMatchId ??
      allScheduledMatches[0]?.id
    const targetMatch = allScheduledMatches.find(
      (match) => match.id === targetMatchId,
    )

    setIsMeetingGenerating(false)
    setMeetingWaitLimitFailure(null)
    setView('schedule')
    if (targetMatch) {
      setCollapsedMatchIds((current) => ({
        ...current,
        [targetMatch.id]: false,
      }))
      openMatchEditor(targetMatch)
      window.setTimeout(() => {
        scrollToElement(document.getElementById(`meeting-match-${targetMatch.id}`))
      }, 0)
    } else {
      scrollToSectionAfterRender('wait-limit-review')
    }
    setNotice(
      violation
        ? `${waitViolationDetail(violation)} · 참가자 교체 후 현황을 확인하세요.`
        : '25분 초과 대진 · 수동 수정 후 현황을 확인하세요.',
    )
  }

  const applyWaitLimitRecommendation = (
    recommendation: MeetingWaitLimitFailure['recommendations'][number],
  ) => {
    startMeetingGeneration(
      recommendation.settings,
      `${recommendation.title} 적용됨`,
      true,
    )
  }

  const acceptWaitLimitOverride = () => {
    const failure = meetingWaitLimitFailure
    if (!failure) return
    const confirmed = window.confirm(
      `최장 대기 ${failure.maximumWaitMinutes}분 · ` +
      `${failure.participantsOverLimit}명이 25분을 초과합니다.\n` +
      '현장 조정을 전제로 이 대진을 사용하시겠습니까?',
    )
    if (!confirmed) return

    setIsMeetingGenerating(false)
    setMeetingWaitLimitFailure(null)
    setView('schedule')
    setNotice(`25분 초과 ${failure.participantsOverLimit}명 · 확인 후 사용`)
    scrollToSectionAfterRender('wait-limit-review')
  }

  const scrollToPrintPreview = (previewRef: RefObject<HTMLElement | null>) => {
    window.setTimeout(() => scrollToElement(previewRef.current), 0)
  }

  const openContactNotice = () => {
    setContactOpen(true)
    setContactCopied(false)
  }

  const copyContactEmail = async () => {
    try {
      await copyToClipboard(CONTACT_EMAIL)
      setContactCopied(true)
      setNotice('이메일 복사됨')
      if (contactCopyTimerRef.current !== null) {
        window.clearTimeout(contactCopyTimerRef.current)
      }
      contactCopyTimerRef.current = window.setTimeout(() => {
        setContactCopied(false)
        contactCopyTimerRef.current = null
      }, 1800)
    } catch {
      setNotice('이메일 복사 실패')
    }
  }

  const renderTournamentSide = (match: TournamentMatch, side: 'A' | 'B') => {
    const teamId = side === 'A' ? match.teamAId : match.teamBId
    const roster = tournamentTeamRoster(teamId)
    const lineup = tournamentLineupText(match, side)

    return (
      <div className={`tournament-side ${teamId ? '' : 'pending-side'}`}>
        <strong>{tournamentSideName(match, side)}</strong>
        {lineup ? <span>{lineup}</span> : roster ? <span>{roster}</span> : null}
      </div>
    )
  }

  const renderTournamentLineupEditor = (
    match: TournamentMatch,
    canEditResult: boolean,
  ) => {
    if (!isFriendlyTournamentFormat(tournamentSettings.format)) return null
    if (!canEditResult || match.phase !== 'team-battle') return null

    const lineup = tournamentLineupForMatch(match)
    const manual = Boolean(tournamentLineups[match.id])
    const renderSide = (side: 'A' | 'B') => {
      const teamId = side === 'A' ? match.teamAId : match.teamBId
      const playerIds = side === 'A' ? lineup.teamAPlayerIds : lineup.teamBPlayerIds

      return (
        <div className="lineup-side-editor" key={side}>
          <span>{side === 'A' ? 'A팀' : 'B팀'}</span>
          {[0, 1].map((playerIndex) => (
            <select
              aria-label={`${tournamentSideName(match, side)} ${playerIndex + 1}선수`}
              key={playerIndex}
              value={playerIds[playerIndex] ?? ''}
              onChange={(event) =>
                updateTournamentLineupPlayer(
                  match,
                  side,
                  playerIndex,
                  event.target.value,
                )
              }
            >
              <option value="">미정</option>
              {tournamentParticipants.map((participant) => (
                <option value={participant.id} key={participant.id}>
                  {participant.teamId === teamId
                    ? participant.name
                    : `${participant.name} (${participant.teamName})`}
                </option>
              ))}
            </select>
          ))}
        </div>
      )
    }

    return (
      <div className="lineup-editor">
        <div className="lineup-editor-heading">
          <span>{manual ? '수동 조' : '자동 조'}</span>
          {manual ? (
            <button type="button" onClick={() => resetTournamentLineup(match.id)}>
              자동
            </button>
          ) : null}
        </div>
        <div className="lineup-editor-grid">
          {renderSide('A')}
          {renderSide('B')}
        </div>
      </div>
    )
  }

  const meetingSharedScheduleCandidates: SharedScheduleCandidate[] =
    isSharedMode ? generatedMeetingPlayers
      .filter((player) => player.active)
      .map((player) => {
        const playerMatches = allScheduledMatches
          .filter((match) =>
            [...match.teamA, ...match.teamB].some(
              (matchPlayer) => matchPlayer.id === player.id,
            ),
          )
          .sort((left, right) =>
            matchStartOffset(left) - matchStartOffset(right) ||
            left.court - right.court,
          )
        const aliases = playerMatches
          .map((match) => {
            const matchPlayer = [...match.teamA, ...match.teamB].find(
              (candidate) => candidate.id === player.id,
            )
            return matchPlayer ? matchPlayerName(match, matchPlayer) : ''
          })
          .filter(Boolean)

        return {
          id: `meeting-${player.id}`,
          name: playerDisplayName(player, scheduleDisplayNames),
          searchTerms: aliases,
          subtitle: `${playerMatches.length}경기 배정`,
          items: playerMatches.map((match) => {
            const isTeamA = match.teamA.some(
              (matchPlayer) => matchPlayer.id === player.id,
            )
            const ownTeam = isTeamA ? match.teamA : match.teamB
            const opponentTeam = isTeamA ? match.teamB : match.teamA
            const startsAt = matchStartOffset(match)
            const courtMatches = courtSchedules.find(
              (court) => court.number === match.court,
            )?.matches ?? []
            const courtMatchNumber = courtMatches.findIndex(
              (courtMatch) => courtMatch.id === match.id,
            ) + 1
            const sequenceNumber = getMeetingSequenceNumber(schedule, match.id)
            const actualCourt = meetingCourtAssignments[match.id]?.court
            const availableAssignment =
              generatedMeetingSettings.courtAssignmentMode === 'available'

            return {
              id: match.id,
              time: availableAssignment
                ? '전체 순번대로 진행'
                : `${clockTimeAtOffset(
                    generatedMeetingSettings.startTime,
                    startsAt,
                  )}–${clockTimeAtOffset(
                    generatedMeetingSettings.startTime,
                    startsAt + (match.durationMinutes ?? GAME_SLOT_MINUTES),
                  )}`,
              court: availableAssignment ? actualCourt ?? null : match.court,
              label: availableAssignment
                ? `${sequenceNumber}번`
                : `${courtMatchNumber}경기`,
              detail: [
                match.isSpecial ? '스페셜' : '',
                availableAssignment && !actualCourt ? '코트 현장 배정' : '',
              ].filter(Boolean).join(' · ') || undefined,
              team: ownTeam
                .filter((matchPlayer) => matchPlayer.id !== player.id)
                .map((matchPlayer) => matchPlayerName(match, matchPlayer))
                .join(' + ') || '파트너 확인',
              opponent: matchTeamName(match, opponentTeam),
              status: results[match.id]?.completed ? '완료' as const : '예정' as const,
            }
          }),
        }
      }) : []

  const tournamentSharedScheduleCandidates: SharedScheduleCandidate[] =
    isSharedMode ? tournamentParticipants.map((participant) => {
      const playerMatches = tournamentSchedule.matches
        .filter((match) => {
          if (match.isBye) return false
          if (
            isFriendlyTournamentFormat(tournamentSettings.format) &&
            match.phase === 'team-battle'
          ) {
            const lineup = tournamentLineupForMatch(match)
            return [
              ...lineup.teamAPlayerIds,
              ...lineup.teamBPlayerIds,
            ].includes(participant.id)
          }
          return match.teamAId === participant.teamId ||
            match.teamBId === participant.teamId
        })
        .sort((left, right) => left.round - right.round || left.order - right.order)

      return {
        id: `tournament-${participant.id}`,
        name: participant.name,
        subtitle: participant.teamName,
        items: playerMatches.map((match) => {
          const lineup = tournamentLineupForMatch(match)
          const participantInA = lineup.teamAPlayerIds.includes(participant.id)
          const participantInB = lineup.teamBPlayerIds.includes(participant.id)
          const isFriendlyLineup =
            isFriendlyTournamentFormat(tournamentSettings.format) &&
            match.phase === 'team-battle' &&
            (participantInA || participantInB)
          const isTeamA = isFriendlyLineup
            ? participantInA
            : match.teamAId === participant.teamId
          const ownSide = isTeamA ? 'A' as const : 'B' as const
          const opponentSide = isTeamA ? 'B' as const : 'A' as const
          const ownPlayerIds = ownSide === 'A'
            ? lineup.teamAPlayerIds
            : lineup.teamBPlayerIds
          const partnerNames = isFriendlyLineup
            ? ownPlayerIds
                .filter((playerId) => playerId && playerId !== participant.id)
                .map((playerId) => tournamentLineupPlayerLabel(
                  playerId,
                  ownSide === 'A' ? match.teamAId : match.teamBId,
                ))
                .filter(Boolean)
            : []
          const opponentLineup = isFriendlyLineup
            ? tournamentLineupText(match, opponentSide)
            : ''

          return {
            id: match.id,
            time: roundTimeRange(tournamentSettings.startTime, match.round),
            court: match.court,
            label: match.label,
            detail: [
              tournamentMatchPhaseLabel(match),
              match.teamBattleSlot,
            ].filter(Boolean).join(' · '),
            team: partnerNames.join(' + ') || tournamentSideName(match, ownSide),
            opponent: [
              tournamentSideName(match, opponentSide),
              opponentLineup,
            ].filter(Boolean).join(' · '),
            status: tournamentResults[match.id]?.completed
              ? '완료' as const
              : '예정' as const,
          }
        }),
      }
    }) : []

  if (progressMode && !isSharedMode) {
    if (appMode === 'meeting') {
      if (generatedMeetingSettings.courtAssignmentMode === 'available') {
        return (
          <div className="app progress-mode-app">
            <AvailableMeetingProgressMode
              eventName={generatedMeetingSettings.eventName}
              schedule={schedule}
              lanes={availableMeetingProgressLanes}
              assignments={meetingCourtAssignments}
              results={results}
              completedCount={completedMatches}
              totalCount={totalMatches}
              isFullscreen={isFullscreen}
              fullscreenSupported={Boolean(
                document.fullscreenEnabled && document.documentElement.requestFullscreen
              )}
              teamName={(match, side) =>
                matchTeamName(match, side === 'A' ? match.teamA : match.teamB)}
              canUndo={(matchId) => canUndoAvailableMeetingMatch(
                schedule,
                matchId,
                meetingCourtAssignments,
                results,
              )}
              onScoreChange={updateMeetingProgressScore}
              onWinner={selectMeetingProgressWinner}
              onComplete={completeMeetingProgressMatch}
              onUndo={undoMeetingProgressMatch}
              onAssignNext={assignNextMeetingMatch}
              onCancelAssignment={cancelMeetingCourtAssignment}
              onToggleFullscreen={toggleProgressFullscreen}
              onManageParticipants={manageProgressParticipants}
              onExit={exitProgressMode}
            />
          </div>
        )
      }
      return (
        <div className="app progress-mode-app">
          <MeetingProgressMode
            eventName={generatedMeetingSettings.eventName}
            startTime={generatedMeetingSettings.startTime}
            lanes={meetingProgressLanes}
            results={results}
            completedCount={completedMatches}
            totalCount={totalMatches}
            isFullscreen={isFullscreen}
            fullscreenSupported={Boolean(
              document.fullscreenEnabled && document.documentElement.requestFullscreen
            )}
            teamName={(match, side) =>
              matchTeamName(match, side === 'A' ? match.teamA : match.teamB)}
            onScoreChange={updateMeetingProgressScore}
            onWinner={selectMeetingProgressWinner}
            onComplete={completeMeetingProgressMatch}
            onUndo={undoMeetingProgressMatch}
            onToggleFullscreen={toggleProgressFullscreen}
            onManageParticipants={manageProgressParticipants}
            onExit={exitProgressMode}
          />
        </div>
      )
    }

    return (
      <div className="app progress-mode-app">
        <TournamentProgressMode
          eventName={`${tournamentFormatLabels[tournamentSettings.format]} 대진`}
          startTime={tournamentSettings.startTime}
          lanes={tournamentProgressLanes}
          results={tournamentResults}
          completedCount={tournamentProgressCompletedCount}
          totalCount={tournamentProgressTotalCount}
          isFullscreen={isFullscreen}
          fullscreenSupported={Boolean(
            document.fullscreenEnabled && document.documentElement.requestFullscreen
          )}
          sideName={tournamentSideName}
          phaseLabel={tournamentMatchPhaseLabel}
          winnerName={(match) =>
            tournamentWinnerLabel(match, tournamentResults[match.id])}
          undoableMatchId={undoableTournamentMatchId}
          onScoreChange={updateTournamentProgressScore}
          onWinner={selectTournamentProgressWinner}
          onComplete={completeTournamentProgressMatch}
          onUndo={undoTournamentProgressMatch}
          onToggleFullscreen={toggleProgressFullscreen}
          onExit={exitProgressMode}
        />
      </div>
    )
  }

  return (
    <div className={`app ${isSharedMode ? 'shared-app' : ''}`}>
      {browserSaveToast ? (
        <div
          className={`browser-save-toast ${browserSaveToast.error ? 'error' : ''}`}
          role={browserSaveToast.error ? 'alert' : 'status'}
          aria-live="polite"
        >
          {browserSaveToast.message}
        </div>
      ) : null}
      {isShortShareLoading || shortShareError ? (
        <div
          className="generation-overlay"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          aria-label={shortShareError ? '공유 링크 만료' : '공유 대진 불러오는 중'}
        >
          <div className={`generation-card ${shortShareError ? 'failure-review' : ''}`}>
            <img src={amaLogo} alt="A.M.A" />
            {shortShareError ? (
              <span className="generation-result-icon failure" aria-hidden="true">!</span>
            ) : (
              <span className="generation-spinner" aria-hidden="true" />
            )}
            <strong>{shortShareError ? '공유 링크 확인' : '공유 대진 불러오는 중'}</strong>
            <p>{shortShareError || '잠시만 기다려 주세요.'}</p>
            {shortShareError ? (
              <div className="generation-review-actions">
                <button type="button" className="primary-action" onClick={openMySchedule}>
                  내 대진 열기
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {isMeetingReplanning ? (
        <div
          className="generation-overlay"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          aria-label="남은 대진 재생성 중"
        >
          <div className="generation-card">
            <img src={amaLogo} alt="A.M.A" />
            <span className="generation-spinner" aria-hidden="true" />
            <strong>남은 대진 재생성 중</strong>
            <p>완료 경기와 현재 경기를 보존하고 새 명단을 배정하고 있습니다.</p>
          </div>
        </div>
      ) : null}
      {isMeetingGenerating ? (
        <div
          className="generation-overlay"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          aria-label={meetingOperationLabel}
        >
          <div className={`generation-card ${
            meetingOperationLabel === '대진 완료' ||
            meetingOperationLabel === '대진 검증 실패'
              ? `review ${
                  meetingOperationLabel === '대진 검증 실패'
                    ? 'failure-review'
                    : ''
                }`
              : ''
          }`}>
            <img src={amaLogo} alt="A.M.A" />
            {meetingOperationLabel === '대진 완료' ||
            meetingOperationLabel === '대진 검증 실패' ? (
              <span
                className={`generation-result-icon ${
                  meetingOperationLabel === '대진 완료'
                    ? hasMeetingQualityWarning
                      ? 'warning'
                      : 'success'
                    : 'failure'
                }`}
                aria-hidden="true"
              >
                {meetingOperationLabel === '대진 완료' &&
                !hasMeetingQualityWarning
                  ? '✓'
                  : '!'}
              </span>
            ) : (
              <span className="generation-spinner" aria-hidden="true" />
            )}
            <strong>{meetingOperationLabel}</strong>
            <p>{meetingGenerationMessage}</p>
            {meetingOperationLabel === '대진 검증 실패' &&
            meetingWaitLimitFailure ? (
              <div className="generation-wait-failure">
                <div className="generation-wait-metrics">
                  <span className={
                    meetingWaitLimitFailure.maximumInitialWaitMinutes > 25
                      ? 'over-limit'
                      : ''
                  }>
                    첫 경기 전
                    <strong>
                      {meetingWaitLimitFailure.maximumInitialWaitMinutes}분
                    </strong>
                  </span>
                  <span className={
                    meetingWaitLimitFailure.maximumBetweenWaitMinutes > 25
                      ? 'over-limit'
                      : ''
                  }>
                    경기 간
                    <strong>
                      {meetingWaitLimitFailure.maximumBetweenWaitMinutes}분
                    </strong>
                  </span>
                  <span>
                    종료 후 여유
                    <strong>
                      {meetingWaitLimitFailure.maximumFinalIdleMinutes}분
                    </strong>
                  </span>
                </div>
                <div className="generation-wait-reasons">
                  <strong>실패 원인</strong>
                  <div>
                    {meetingWaitLimitFailure.participantViolations.some(
                      (violation) => violation.phase === 'unassigned',
                    ) ? (
                      <span>
                        <b>0경기</b>{' '}
                        {meetingWaitLimitFailure.participantViolations.filter(
                          (violation) => violation.phase === 'unassigned',
                        ).length}명
                      </span>
                    ) : null}
                    {meetingWaitLimitFailure.participantViolations.some(
                      (violation) => violation.phase === 'initial',
                    ) ? (
                      <span>
                        <b>첫 경기 지연</b>{' '}
                        {meetingWaitLimitFailure.participantViolations.filter(
                          (violation) => violation.phase === 'initial',
                        ).length}명
                      </span>
                    ) : null}
                    {meetingWaitLimitFailure.participantViolations.some(
                      (violation) => violation.phase === 'between',
                    ) ? (
                      <span>
                        <b>경기 간 대기</b>{' '}
                        {meetingWaitLimitFailure.participantViolations.filter(
                          (violation) => violation.phase === 'between',
                        ).length}명
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="generation-wait-participants">
                  <strong>
                    조정 필요 참가자 {meetingWaitLimitFailure.participantViolations.length}명
                  </strong>
                  <div>
                    {meetingWaitLimitFailure.participantViolations.map(
                      (violation) => {
                        const player = generatedMeetingPlayers.find(
                          (candidate) => candidate.id === violation.playerId,
                        )
                        return (
                          <button
                            type="button"
                            key={violation.playerId}
                            onClick={() => openWaitLimitManualEdit(violation)}
                          >
                            <span>
                              <b>
                                {player
                                  ? playerDisplayName(player, scheduleDisplayNames)
                                  : '참가자'}
                              </b>
                              <small>{waitViolationDetail(violation)}</small>
                            </span>
                            <em>관련 경기 수정</em>
                          </button>
                        )
                      },
                    )}
                  </div>
                </div>
                <div className="generation-wait-recommendations">
                  <strong>재계산 통과 변경안</strong>
                  {meetingWaitLimitFailure.recommendations.length > 0 ? (
                    meetingWaitLimitFailure.recommendations.map(
                      (recommendation) => (
                        <article key={recommendation.kind}>
                          <div>
                            <b>{recommendation.title}</b>
                            <span>{recommendation.detail}</span>
                          </div>
                          <em className="verified">재계산 통과</em>
                          <button
                            type="button"
                            onClick={() => applyWaitLimitRecommendation(recommendation)}
                          >
                            적용 후 생성
                          </button>
                        </article>
                      ),
                    )
                  ) : (
                    <div className="generation-wait-no-resolution">
                      <b>자동으로 통과하는 변경안을 찾지 못했습니다.</b>
                      <small>
                        참가 인원 조정은 마지막 수단으로 검토하고, 먼저 수동 수정이나
                        직접 설정을 이용해 주세요.
                      </small>
                    </div>
                  )}
                </div>
                <small className="generation-search-count">
                  변경안마다 새 대진을 만들어 25분 제한을 다시 검증했습니다.
                </small>
              </div>
            ) : null}
            {meetingOperationLabel === '대진 완료' ? (
              <div className="generation-review-summary">
                <span>중복 <strong>0건</strong></span>
                <span className={scheduleQualityAnalysis.standardGameSpread > 1 ? 'wait-warning' : ''}>
                  경기 <strong>{minimumParticipantGames}~{maximumParticipantGames}경기</strong>
                </span>
                <span>동일 4인 최대 <strong>{maximumMeetingGroupCount}경기</strong></span>
                <span className={scheduleQualityAnalysis.maximumOpponentMeetings > 6 ? 'wait-warning' : ''}>
                  상대 반복 최대 <strong>{scheduleQualityAnalysis.maximumOpponentMeetings}회</strong>
                </span>
                <span className={reviewedSkillWarningMatches > 0 ? 'wait-warning' : ''}>
                  실력 차{' '}
                  <strong>{reviewedSkillWarningMatches}경기</strong>
                </span>
                <span className={
                  (
                    meetingUsesClubQuality
                      ? meetingV2Metrics.postWarmupGenderExceptionMatches
                      : scheduleQualityAnalysis.genderCompositionReviewMatches
                  ) > 0
                    ? 'gender-review-summary'
                    : ''
                }>
                  성별 조합 확인{' '}
                  <strong>
                    {meetingUsesClubQuality
                      ? meetingV2Metrics.postWarmupGenderExceptionMatches
                      : scheduleQualityAnalysis.genderCompositionReviewMatches}
                    경기
                  </strong>
                </span>
                <span>
                  스페셜 <strong>
                    {hasScheduledActiveGuests
                      ? `${scheduledSpecialMatchCount}${
                          generatedMeetingSettings.specialLimitEnabled
                            ? `/${specialLimitMatchCapacity}`
                            : ''
                        }경기`
                      : '없음'}
                  </strong>
                </span>
                <span>평균 대기 <strong>{meetingAverageWaitMinutes}분</strong></span>
                <span className={scheduleWaitAnalysis.exceedsLimit ? 'wait-warning' : ''}>
                  최장 대기 <strong>{meetingMaximumWaitMinutes}분</strong>
                </span>
                <span className={
                  scheduleWaitAnalysis.maximumInitialWaitMinutes > 25
                    ? 'wait-warning'
                    : ''
                }>
                  첫 경기 대기 <strong>{scheduleWaitAnalysis.maximumInitialWaitMinutes}분</strong>
                </span>
                <span className={
                  scheduleWaitAnalysis.maximumBetweenWaitMinutes > 25
                    ? 'wait-warning'
                    : ''
                }>
                  경기 간 대기 <strong>{scheduleWaitAnalysis.maximumBetweenWaitMinutes}분</strong>
                </span>
                <span>
                  종료 후 여유 <strong>{scheduleWaitAnalysis.maximumFinalIdleMinutes}분</strong>
                </span>
                <span className={scheduleQualityAnalysis.participantsOverWaitLimit > 0 ? 'wait-warning' : ''}>
                  25분 초과 <strong>{scheduleQualityAnalysis.participantsOverWaitLimit}명</strong>
                </span>
                <span>
                  양보 설정 <strong>
                    경기 {gameCountFlexibleParticipantCount} · 대기 {waitTimeFlexibleParticipantCount}
                  </strong>
                </span>
                {meetingUsesClubQuality ? (
                  <>
                    <span className={
                      meetingV2Metrics.participantsBelowTightMinimum > 0
                        ? 'wait-warning'
                        : ''
                    }>
                      타이트 2회 미달 <strong>
                        {meetingV2Metrics.participantsBelowTightMinimum}명
                      </strong>
                    </span>
                    <span>
                      타이트 3회 <strong>
                        {meetingV2Metrics.participantsAtTightTarget}/
                        {scheduledActiveMembers.length}명
                      </strong>
                    </span>
                  </>
                ) : null}
                <span>총 <strong>{totalMatches}경기</strong></span>
              </div>
            ) : null}
            {meetingOperationLabel === '대진 완료' ? (
              <div className="generation-review-actions">
                <button type="button" className="primary-action" onClick={acceptGeneratedMeeting}>
                  이 대진 사용
                </button>
                <button type="button" onClick={generateAlternativeMeeting}>
                  다른 대진 보기
                </button>
              </div>
            ) : meetingOperationLabel === '대진 검증 실패' ? (
              <div className="generation-review-actions wait-limit-actions">
                <button type="button" onClick={returnToMeetingSettings}>
                  다시 설정
                </button>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => openWaitLimitManualEdit()}
                >
                  수동 수정
                </button>
                <button type="button" onClick={acceptWaitLimitOverride}>
                  초과 확인 후 사용
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {levelHelpOpen ? (
        <div className="dialog-backdrop" onClick={() => setLevelHelpOpen(false)}>
          <section
            className="info-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="level-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <h2 id="level-help-title">레벨 분류</h2>
              <button type="button" onClick={() => setLevelHelpOpen(false)}>
                닫기
              </button>
            </div>
            <div className="level-help-list">
              <p>A가 가장 높고 E가 가장 낮습니다.</p>
              <p>E는 연령과 성별에 관계없이 같은 수준으로 적용합니다.</p>
              <p>같은 단계의 참가자는 비슷한 경기 수준으로 배정합니다.</p>
              <p>대진 카드에서 수동으로 수정 가능합니다.</p>
              <p>OA는 연령 상관없이 A레벨 우선 조합을 원하는 참가자입니다.</p>
              <p>O는 모든 레벨을 커버하며, 실력 불균형 완충에 우선 활용합니다.</p>
              <p>스페셜은 초청/게스트 경기 배정용입니다.</p>
            </div>
            <div className="level-help-replan-note">
              <strong>진행 중 참가자 변경</strong>
              <p>
                참가자를 추가하거나 참석 여부를 변경하면 완료·현재 경기는
                유지하고 남은 대진을 재생성할 수 있습니다.
              </p>
            </div>
            <button type="button" onClick={openLevelTierEditor}>
              레벨 기준 수정
            </button>
          </section>
        </div>
      ) : null}

      {levelTierEditorOpen ? (
        <div className="dialog-backdrop" onClick={() => setLevelTierEditorOpen(false)}>
          <section
            className="info-dialog level-tier-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="level-tier-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <div>
                <h2 id="level-tier-title">레벨 기준 수정</h2>
                <span>숫자가 작을수록 높은 수준 · 같은 숫자는 동급</span>
              </div>
              <button type="button" onClick={() => setLevelTierEditorOpen(false)}>
                닫기
              </button>
            </div>
            <div className="level-tier-table-wrap">
              <table className="level-tier-table">
                <thead>
                  <tr>
                    <th>연령</th>
                    {matchGenders.flatMap((gender) =>
                      matchLevels.filter((level) => level !== 'E').map((level) => (
                        <th key={`${gender}-${level}`}>
                          {genderLabels[gender]} {level}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {matchAgeGroups.map((ageGroup) => (
                    <tr key={ageGroup}>
                      <th>{ageGroup}</th>
                      {matchGenders.flatMap((gender) =>
                        matchLevels.filter((level) => level !== 'E').map((level) => (
                          <td key={`${ageGroup}-${gender}-${level}`}>
                            <input
                              type="number"
                              min="1"
                              max="20"
                              aria-label={`${ageGroup} ${genderLabels[gender]} ${level} 단계`}
                              value={levelTierDraft[ageGroup][gender][level]}
                              onChange={(event) =>
                                updateLevelTierDraft(
                                  ageGroup,
                                  gender,
                                  level,
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                        )),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="common-tier-control">
              <span>
                <strong>E 공통 단계</strong>
                <small>모든 연령·성별에 동일 적용</small>
              </span>
              <input
                type="number"
                min="1"
                max="20"
                aria-label="E 공통 단계"
                value={levelTierDraft['20대'].male.E}
                onChange={(event) =>
                  updateLevelTierDraft('20대', 'male', 'E', event.target.value)
                }
              />
            </label>
            <div className="level-tier-actions">
              <button
                type="button"
                onClick={() => setLevelTierDraft(normalizeLevelTiers(defaultLevelTiers))}
              >
                기본값
              </button>
              <button type="button" className="primary-action" onClick={applyLevelTierDraft}>
                적용
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {contactOpen ? (
        <div className="dialog-backdrop" onClick={() => setContactOpen(false)}>
          <section
            className="info-dialog contact-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <h2 id="contact-title">제안</h2>
              <button type="button" onClick={() => setContactOpen(false)}>
                닫기
              </button>
            </div>
            <p>아래 이메일로 제안 주세요.</p>
            <div className="contact-copy-row">
              <strong>{CONTACT_EMAIL}</strong>
              <button
                type="button"
                className="emoji-copy-button"
                aria-label="이메일 복사"
                title="복사"
                onClick={copyContactEmail}
              >
                📋
              </button>
            </div>
            <span className="copy-status">{contactCopied ? '복사됨' : '복사 가능'}</span>
          </section>
        </div>
      ) : null}

      {featureHelpOpen ? (
        <div className="dialog-backdrop" onClick={() => setFeatureHelpOpen(null)}>
          <section
            className="info-dialog feature-help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feature-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <h2 id="feature-help-title">
                {featureHelpContent[featureHelpOpen].title}
              </h2>
              <button type="button" onClick={() => setFeatureHelpOpen(null)}>
                닫기
              </button>
            </div>
            <p>{featureHelpContent[featureHelpOpen].body}</p>
          </section>
        </div>
      ) : null}

      <header className="app-header">
        <div className="header-main">
          <div className="brand-block">
            <img className="brand-logo" src={amaLogo} alt="" aria-hidden="true" />
            <div>
              <h1 className="app-title">A.M.A Match Maker Pro</h1>
            </div>
          </div>

          <div className="mode-switch" aria-label="운영 모드">
            <button
              type="button"
              className={appMode === 'meeting' ? 'active' : ''}
              onClick={() => setAppModeAndNotice('meeting')}
            >
              친목
            </button>
            <button
              type="button"
              className={appMode === 'tournament' ? 'active' : ''}
              onClick={() => setAppModeAndNotice('tournament')}
            >
              경쟁
            </button>
          </div>

          <div
            className={`header-actions ${
              isSharedMode ? '' : `operator-actions ${appMode}-operator-actions`
            }`}
          >
            {isSharedMode ? (
              <>
                <div className="header-action-with-help">
                  <button type="button" className="primary-action" onClick={useSharedCopy}>
                    편집
                  </button>
                  <button
                    type="button"
                    className="round-help-button"
                    aria-label="편집 기능 설명"
                    onClick={() => setFeatureHelpOpen('shared-edit')}
                  >
                    ?
                  </button>
                </div>
                <div className="header-action-with-help">
                  <button type="button" onClick={openMySchedule}>
                    새로
                  </button>
                  <button
                    type="button"
                    className="round-help-button"
                    aria-label="새로 기능 설명"
                    onClick={() => setFeatureHelpOpen('shared-new')}
                  >
                    ?
                  </button>
                </div>
                <button type="button" onClick={handleCopyShareLink}>
                  공유
                </button>
                <button
                  type="button"
                  onClick={appMode === 'meeting' ? handlePrintSchedule : handlePrintTournament}
                >
                  저장
                </button>
                <span className="header-status">{notice}</span>
              </>
            ) : appMode === 'meeting' ? (
              <>
                <button
                  type="button"
                  className="primary-action"
                  disabled={isMeetingGenerating || isMeetingReplanning}
                  onClick={generateBookingSchedule}
                >
                  {isMeetingGenerating ? '생성 중' : '생성'}
                </button>
                <button
                  type="button"
                  className="progress-entry-button"
                  disabled={
                    isMeetingGenerating ||
                    isMeetingReplanning ||
                    hasMeetingDraftChanges ||
                    totalMatches === 0
                  }
                  title={
                    hasMeetingDraftChanges
                      ? '변경사항을 반영해 대진을 다시 생성해 주세요.'
                      : totalMatches === 0
                        ? '먼저 대진을 생성해 주세요.'
                        : '친목 진행 화면 열기'
                  }
                  onClick={enterProgressMode}
                >
                  진행
                </button>
                <button type="button" onClick={handleCopyShareLink}>
                  공유
                </button>
                <button type="button" onClick={handlePrintSchedule}>
                  저장
                </button>
                <button
                  type="button"
                  className="danger-action"
                  disabled={isMeetingGenerating || isMeetingReplanning}
                  title="참가자, 설정, 대진표, 경기 결과와 경품 정보 전체 삭제"
                  onClick={handleReset}
                >
                  전체 초기화
                </button>
                {hasMeetingDraftChanges ? (
                  <span className="header-status draft-status">변경사항 있음</span>
                ) : null}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="primary-action"
                  onClick={handleGenerateTournament}
                >
                  생성
                </button>
                <button
                  type="button"
                  className="progress-entry-button"
                  disabled={tournamentProgressTotalCount === 0}
                  title={
                    tournamentProgressTotalCount === 0
                      ? '먼저 대진을 생성해 주세요.'
                      : '경쟁 진행 화면 열기'
                  }
                  onClick={enterProgressMode}
                >
                  진행
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTournamentResults({})
                    setNotice('경쟁 결과 초기화됨')
                  }}
                >
                  초기화
                </button>
                <button type="button" onClick={handleCopyShareLink}>
                  공유
                </button>
                <button type="button" onClick={handlePrintTournament}>
                  저장
                </button>
              </>
            )}
          </div>
        </div>
        <nav className="shortcut-row" aria-label="바로가기">
          {appMode === 'meeting' ? (
            <>
              {!isSharedMode ? (
                <button type="button" onClick={() => scrollToSection('meeting-prizes')}>
                  경품
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setView('schedule')
                  scrollToSectionAfterRender('meeting-schedule')
                }}
              >
                대진표
              </button>
              <button type="button" onClick={() => scrollToSection('meeting-progress')}>
                현황
              </button>
              <button type="button" onClick={openContactNotice}>
                제안
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setTournamentView('progress')
                  scrollToSectionAfterRender('tournament-progress')
                }}
              >
                현황
              </button>
              <button
                type="button"
                onClick={() => {
                  setTournamentView('board')
                  scrollToSectionAfterRender('tournament-board')
                }}
              >
                {isFriendlyTournamentFormat(tournamentSettings.format)
                  ? '결과'
                  : '보드'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (tournamentPrintImageUrls.length === 0) {
                    setNotice('저장 후 이미지 확인')
                    return
                  }
                  scrollToSection('tournament-image')
                }}
              >
                이미지
              </button>
            </>
          )}
        </nav>
      </header>

      {appMode === 'meeting' ? (
      <main className={`app-shell ${isSharedMode ? 'shared-shell' : ''}`}>
        {!isSharedMode ? (
        <aside className="control-panel">
          <section className="panel-section" id="meeting-settings">
            <div className="section-heading">
              <div className="section-title-stack">
                <div className="title-with-controls">
                  <h2>설정</h2>
                  <button
                    type="button"
                    className="section-toggle-button"
                    onClick={() => setSettingsOpen((open) => !open)}
                  >
                    {settingsOpen ? '접기' : '펼치기'}
                  </button>
                </div>
                <span>{notice}</span>
              </div>
              <div className="compact-actions">
                <span>{activeMembers.length}명 · 코트 {settings.courtCount}</span>
              </div>
            </div>
            {settingsOpen ? (
              <>
                <div className="settings-grid">
                  <NumberStepper
                    label="참가"
                    min={0}
                    max={80}
                    value={regularPlayers.length}
                    onChange={setRegularPlayerCount}
                  />
                  <NumberStepper
                    ariaLabel="스페셜"
                    label={(
                      <span className="label-with-help">
                        스페셜
                        <span
                          className="help-tooltip"
                          role="img"
                          tabIndex={0}
                          aria-label="스페셜은 선수, 코치 등 특별히 초청한 게스트입니다."
                          data-tooltip="선수, 코치 등 특별히 초청한 게스트"
                        >
                          ?
                        </span>
                      </span>
                    )}
                    min={0}
                    max={12}
                    value={guestPlayers.length}
                    onChange={setGuestCount}
                  />
                  <NumberStepper
                    label="코트"
                    min={1}
                    max={12}
                    value={settings.courtCount}
                    onChange={(courtCount) => {
                      setSettings((current) => ({
                        ...current,
                        courtCount,
                        targetRoundCount: getBookingRoundCount(
                          current.startTime,
                          current.endTime,
                        ),
                        pacingRoundCount: getBookingRoundCount(
                          current.startTime,
                          current.endTime,
                        ),
                        roundCountLocked: true,
                      }))
                    }}
                  />
                  <label>
                    일반 경기 시간
                    <select
                      value={settings.normalGameMinutes}
                      onChange={(event) => {
                        setSettings((current) => ({
                          ...current,
                          normalGameMinutes: Number(event.target.value) as 10 | 12 | 15,
                        }))
                        setNotice('일반 경기 시간 변경됨 · 생성 필요')
                      }}
                    >
                      <option value={10}>10분</option>
                      <option value={12}>12분</option>
                      <option value={15}>15분</option>
                    </select>
                  </label>
                  <div className="court-assignment-settings">
                    <span>코트 배정</span>
                    <div role="group" aria-label="코트 배정 방식">
                      <button
                        type="button"
                        className={
                          settings.courtAssignmentMode === 'fixed' ? 'active' : ''
                        }
                        aria-pressed={settings.courtAssignmentMode === 'fixed'}
                        onClick={() => {
                          setSettings((current) => ({
                            ...current,
                            courtAssignmentMode: 'fixed',
                          }))
                          setNotice('코트 고정 배정 · 생성 필요')
                        }}
                      >
                        <strong>코트 고정 배정</strong>
                        <small>경기별 코트를 미리 정합니다.</small>
                      </button>
                      <button
                        type="button"
                        className={
                          settings.courtAssignmentMode === 'available' ? 'active' : ''
                        }
                        aria-pressed={settings.courtAssignmentMode === 'available'}
                        onClick={() => {
                          setSettings((current) => ({
                            ...current,
                            courtAssignmentMode: 'available',
                          }))
                          setNotice('빈 코트 순차 배정 · 생성 필요')
                        }}
                      >
                        <strong>빈 코트 순차 배정</strong>
                        <small>전체 순번대로 빈 코트에 배정합니다.</small>
                      </button>
                    </div>
                  </div>
                  <div className="booking-time-controls" aria-label="대관 시간">
                    <div className="booking-start-control">
                      <span>시작</span>
                      <button
                        type="button"
                        aria-label="시작 30분 당기기"
                        onClick={() => updateMeetingStartTime(clockTimeAtOffset(settings.startTime, -30))}
                      >
                        −30
                      </button>
                      <select
                        aria-label="시작 시각"
                        value={settings.startTime}
                        onChange={(event) => updateMeetingStartTime(event.target.value)}
                      >
                        {!Array.from({ length: 48 }, (_, index) =>
                          clockTimeAtOffset('00:00', index * 30),
                        ).includes(settings.startTime) ? (
                          <option value={settings.startTime}>{settings.startTime}</option>
                        ) : null}
                        {Array.from({ length: 48 }, (_, index) => {
                          const time = clockTimeAtOffset('00:00', index * 30)
                          return <option value={time} key={time}>{time}</option>
                        })}
                      </select>
                      <button
                        type="button"
                        aria-label="시작 30분 늦추기"
                        onClick={() => updateMeetingStartTime(clockTimeAtOffset(settings.startTime, 30))}
                      >
                        +30
                      </button>
                    </div>
                    <div className="booking-duration-control">
                      <span>대관</span>
                      {[120, 180, 240].map((minutes) => (
                        <button
                          type="button"
                          className={!customBookingTime && bookingMinutes === minutes ? 'active' : ''}
                          onClick={() => updateMeetingDuration(minutes)}
                          key={minutes}
                        >
                          {minutes / 60}시간
                        </button>
                      ))}
                      <button
                        type="button"
                        className={customBookingTime ? 'active' : ''}
                        onClick={() => setCustomBookingTime(true)}
                      >
                        직접
                      </button>
                    </div>
                    <div className="booking-result">
                      <strong>{settings.startTime}–{settings.endTime}</strong>
                      <span>{formatDuration(bookingMinutes)}</span>
                    </div>
                    {customBookingTime ? (
                      <div className="booking-custom-control">
                        <span>종료 조정</span>
                        <button
                          type="button"
                          onClick={() => updateMeetingEndTime(clockTimeAtOffset(settings.endTime, -10))}
                        >
                          −10분
                        </button>
                        <input
                          type="time"
                          step={10 * 60}
                          value={settings.endTime}
                          onChange={(event) => updateMeetingEndTime(event.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => updateMeetingEndTime(clockTimeAtOffset(settings.endTime, 10))}
                        >
                          +10분
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {guestPlayers.length > 0 ? (
                    <div className="special-settings-card expanded">
                      <div className="special-settings-toggles">
                        <label className="settings-checkbox">
                          <input
                            type="checkbox"
                            checked={settings.singleGuestPerMatch}
                            onChange={(event) => {
                              setSettings((current) => ({
                                ...current,
                                singleGuestPerMatch: event.target.checked,
                                targetRoundCount: getBookingRoundCount(
                                  current.startTime,
                                  current.endTime,
                                ),
                                pacingRoundCount: getBookingRoundCount(
                                  current.startTime,
                                  current.endTime,
                                ),
                                roundCountLocked: true,
                              }))
                            }}
                          />
                          스페셜 1 + 참가자 3
                        </label>
                        <label className="settings-checkbox">
                          <input
                            type="checkbox"
                            checked={settings.specialLimitEnabled}
                            onChange={(event) => {
                              setSettings((current) => ({
                                ...current,
                                specialLimitEnabled: event.target.checked,
                              }))
                            }}
                          />
                          스페셜 제한 사용
                        </label>
                      </div>
                      <div className="special-allocation-options">
                        <label>
                          <input
                            type="checkbox"
                            checked={settings.specialLowPriorityEnabled}
                            onChange={(event) => {
                              const enabled = event.target.checked
                              setSettings((current) => {
                                if (!enabled) {
                                  return {
                                    ...current,
                                    specialLowPriorityEnabled: false,
                                  }
                                }
                                const highPercent = current.specialHighPriorityEnabled
                                  ? Math.min(current.specialHighPriorityPercent, 90)
                                  : 0
                                return {
                                  ...current,
                                  specialLowPriorityEnabled: true,
                                  specialLowPriorityPercent: Math.max(
                                    10,
                                    Math.min(
                                      current.specialLowPriorityPercent || 10,
                                      100 - highPercent,
                                    ),
                                  ),
                                  specialHighPriorityPercent: highPercent,
                                }
                              })
                            }}
                          />
                          저레벨 우선
                          <select
                            aria-label="스페셜 저레벨 우선 비율"
                            disabled={!settings.specialLowPriorityEnabled}
                            value={settings.specialLowPriorityPercent}
                            onChange={(event) => {
                              setSettings((current) => ({
                                ...current,
                                specialLowPriorityPercent: Number(event.target.value),
                              }))
                            }}
                          >
                            {specialPriorityPercentOptions
                              .filter(
                                (percent) =>
                                  percent <= 100 - specialHighPriorityPercent,
                              )
                              .map((percent) => (
                                <option value={percent} key={percent}>
                                  {percent}%
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={settings.specialHighPriorityEnabled}
                            onChange={(event) => {
                              const enabled = event.target.checked
                              setSettings((current) => {
                                if (!enabled) {
                                  return {
                                    ...current,
                                    specialHighPriorityEnabled: false,
                                  }
                                }
                                const lowPercent = current.specialLowPriorityEnabled
                                  ? Math.min(current.specialLowPriorityPercent, 90)
                                  : 0
                                return {
                                  ...current,
                                  specialLowPriorityPercent: lowPercent,
                                  specialHighPriorityEnabled: true,
                                  specialHighPriorityPercent: Math.max(
                                    10,
                                    Math.min(
                                      current.specialHighPriorityPercent || 10,
                                      100 - lowPercent,
                                    ),
                                  ),
                                }
                              })
                            }}
                          />
                          고레벨 우선
                          <select
                            aria-label="스페셜 고레벨 우선 비율"
                            disabled={!settings.specialHighPriorityEnabled}
                            value={settings.specialHighPriorityPercent}
                            onChange={(event) => {
                              setSettings((current) => ({
                                ...current,
                                specialHighPriorityPercent: Number(event.target.value),
                              }))
                            }}
                          >
                            {specialPriorityPercentOptions
                              .filter(
                                (percent) =>
                                  percent <= 100 - specialLowPriorityPercent,
                              )
                              .map((percent) => (
                                <option value={percent} key={percent}>
                                  {percent}%
                                </option>
                              ))}
                          </select>
                        </label>
                        <span className="special-allocation-summary">
                          나머지 {specialRandomPriorityPercent}% 무작위 · 동일 성별 → 레벨 → 연령 우선
                        </span>
                      </div>
                      {settings.specialLimitEnabled ? (
                        <div className="special-limit-options">
                          <div className="special-limit-row">
                            <label htmlFor="special-schedule-mode">운영 방식</label>
                            <select
                              id="special-schedule-mode"
                              aria-label="스페셜 운영 방식"
                              value={settings.specialScheduleMode}
                              onChange={(event) => {
                                const specialScheduleMode = event.target.value === 'spread'
                                  ? 'spread'
                                  : 'continuous'
                                setSettings((current) => ({
                                  ...current,
                                  specialScheduleMode,
                                  specialGameLimitEnabled: true,
                                  specialTimeLimitEnabled:
                                    specialScheduleMode === 'continuous',
                                }))
                              }}
                            >
                              <option value="continuous">초반 집중 운영</option>
                              <option value="spread">전체 시간 분산 운영</option>
                            </select>
                          </div>
                          <div className="special-limit-row">
                            <span>목표 경기</span>
                            <div className="limit-stepper">
                              <button
                                type="button"
                                aria-label="스페셜 경기 수 줄이기"
                                disabled={settings.specialGameLimit <= 1}
                                onClick={() => setSettings((current) => {
                                  const specialGameLimit = Math.max(
                                    1,
                                    current.specialGameLimit - 1,
                                  )
                                  const participantCapacity =
                                    specialGameLimit * Math.max(1, activeGuests.length) * 3
                                  return {
                                    ...current,
                                    specialGameLimit,
                                    specialGameLimitEnabled: true,
                                    specialParticipantTarget: Math.min(
                                      current.specialParticipantTarget,
                                      participantCapacity,
                                    ),
                                  }
                                })}
                              >
                                −
                              </button>
                              <input
                                type="number"
                                inputMode="numeric"
                                min="1"
                                max="99"
                                aria-label="스페셜 목표 경기 수"
                                value={settings.specialGameLimit}
                                onChange={(event) => {
                                  const specialGameLimit = normalizePositiveInteger(
                                    event.target.value,
                                    settings.specialGameLimit,
                                    1,
                                    99,
                                  )
                                  setSettings((current) => ({
                                    ...current,
                                    specialGameLimit,
                                    specialGameLimitEnabled: true,
                                    specialParticipantTarget: Math.min(
                                      current.specialParticipantTarget,
                                      specialGameLimit * Math.max(1, activeGuests.length) * 3,
                                    ),
                                  }))
                                }}
                              />
                              <button
                                type="button"
                                aria-label="스페셜 경기 수 늘리기"
                                disabled={settings.specialGameLimit >= 99}
                                onClick={() => setSettings((current) => ({
                                  ...current,
                                  specialGameLimit: Math.min(99, current.specialGameLimit + 1),
                                  specialGameLimitEnabled: true,
                                }))}
                              >
                                +
                              </button>
                              <span>경기</span>
                            </div>
                          </div>
                          <div className="special-limit-row">
                            <span>참가 목표</span>
                            <div className="limit-stepper">
                              <button
                                type="button"
                                aria-label="스페셜 참가 목표 줄이기"
                                disabled={settings.specialParticipantTarget <= 3}
                                onClick={() => setSettings((current) => ({
                                  ...current,
                                  specialParticipantTarget: Math.max(
                                    3,
                                    current.specialParticipantTarget - 3,
                                  ),
                                }))}
                              >
                                −
                              </button>
                              <input
                                type="number"
                                inputMode="numeric"
                                min="3"
                                max={settings.specialGameLimit * Math.max(1, activeGuests.length) * 3}
                                step="3"
                                aria-label="스페셜 참가 목표 인원"
                                value={settings.specialParticipantTarget}
                                onChange={(event) => {
                                  const capacity =
                                    settings.specialGameLimit * Math.max(1, activeGuests.length) * 3
                                  const requested = normalizePositiveInteger(
                                    event.target.value,
                                    settings.specialParticipantTarget,
                                    3,
                                    capacity,
                                  )
                                  const specialParticipantTarget = Math.max(
                                    3,
                                    Math.floor(requested / 3) * 3,
                                  )
                                  setSettings((current) => ({
                                    ...current,
                                    specialParticipantTarget,
                                  }))
                                }}
                              />
                              <button
                                type="button"
                                aria-label="스페셜 참가 목표 늘리기"
                                disabled={
                                  settings.specialParticipantTarget >=
                                  settings.specialGameLimit * Math.max(1, activeGuests.length) * 3
                                }
                                onClick={() => setSettings((current) => ({
                                  ...current,
                                  specialParticipantTarget: Math.min(
                                    current.specialGameLimit * Math.max(1, activeGuests.length) * 3,
                                    current.specialParticipantTarget + 3,
                                  ),
                                }))}
                              >
                                +
                              </button>
                              <span>명</span>
                            </div>
                          </div>
                          {settings.specialScheduleMode === 'continuous' ? (
                            <div className="special-limit-row">
                              <label htmlFor="special-time-limit">운영 상한</label>
                              <select
                                id="special-time-limit"
                                aria-label="스페셜 운영 상한"
                                value={settings.specialTimeLimitMinutes}
                                onChange={(event) => {
                                  setSettings((current) => ({
                                    ...current,
                                    specialTimeLimitEnabled: true,
                                    specialTimeLimitMinutes: Number(event.target.value),
                                  }))
                                }}
                              >
                                {SPECIAL_TIME_LIMIT_OPTIONS
                                  .filter((minutes) => minutes <= bookingMinutes)
                                  .map((minutes) => (
                                  <option value={minutes} key={minutes}>
                                    {minutes}분
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <span className="special-allocation-summary">
                              대관 시간 전체에 목표 경기를 나눠 배치합니다.
                            </span>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="metric-grid">
                  <div>
                    <strong>{activeMembers.length}</strong>
                    <span>참가</span>
                  </div>
                  <div>
                    <strong>{activeGuests.length}</strong>
                    <span>스페셜</span>
                  </div>
                  <div>
                    <strong>{totalMatches}</strong>
                    <span>총 경기</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="collapsed-summary">
                참가 {activeMembers.length}명 · 스페셜 {activeGuests.length}명 · 코트 {settings.courtCount}개 · {settings.startTime}–{settings.endTime}
              </div>
            )}
          </section>

          <section className="panel-section" id="meeting-players">
            <div className="section-heading">
              <div className="section-title-stack">
                <div className="title-with-controls">
                  <h2>참가자</h2>
                  <button
                    type="button"
                    className="help-button"
                    aria-label="레벨 분류 설명"
                    onClick={() => setLevelHelpOpen(true)}
                  >
                    ?
                  </button>
                  <button
                    type="button"
                    className="section-toggle-button"
                    onClick={() => setPlayersOpen((open) => !open)}
                  >
                    {playersOpen ? '접기' : '펼치기'}
                  </button>
                </div>
                <span>
                  참가 {activeMembers.length}명 · 스페셜 {activeGuests.length}명 · 생성 {totalMatches}경기
                  {hasPlayerDraftChanges ? ' · 명단 변경됨' : ''}
                </span>
              </div>
              <div className="compact-actions">
                <div className="participant-action-with-help">
                  <button
                    type="button"
                    className="participant-action-main"
                    onClick={() => {
                      setParticipantReplanHelpOpen(null)
                      addPlayer()
                    }}
                  >
                    추가
                  </button>
                  <button
                    type="button"
                    className="participant-action-help"
                    aria-label="진행 중 참가자 변경 안내"
                    aria-expanded={participantReplanHelpOpen === 'add'}
                    aria-controls="participant-add-replan-help"
                    onClick={() => setParticipantReplanHelpOpen((current) =>
                      current === 'add' ? null : 'add'
                    )}
                  >
                    ?
                  </button>
                  {participantReplanHelpOpen === 'add' ? (
                    <span
                      className="participant-action-tooltip"
                      id="participant-add-replan-help"
                      role="status"
                    >
                      {PARTICIPANT_REPLAN_HELP}
                    </span>
                  ) : null}
                </div>
                <button type="button" onClick={addGuest}>
                  스페셜
                </button>
                <button
                  type="button"
                  className={canReplanMeeting ? 'primary-action' : ''}
                  disabled={!canReplanMeeting}
                  title={
                    hasMeetingSettingsDraftChanges
                      ? '설정 변경은 전체 대진을 다시 생성해 주세요.'
                      : completedMatches === 0
                        ? '완료 경기 1개부터 사용할 수 있습니다.'
                        : !hasPlayerDraftChanges
                          ? '참가자 명단을 변경하면 활성화됩니다.'
                          : completedMatches >= totalMatches
                            ? '다시 생성할 예정 경기가 없습니다.'
                            : '완료와 현재 경기를 유지하고 남은 대진만 다시 생성합니다.'
                  }
                  onClick={startMeetingReplan}
                >
                  {isMeetingReplanning ? '재생성 중' : '남은 대진 재생성'}
                </button>
                {hasMeetingBackup ? (
                  <button type="button" onClick={restoreMeetingBackup}>
                    이전 대진 복원
                  </button>
                ) : null}
                <button type="button" onClick={() => setBulkOpen((open) => !open)}>
                  {bulkOpen && players.length > 0 ? '닫기' : '명단'}
                </button>
                <button type="button" onClick={resetParticipants}>
                  초기화
                </button>
                <button
                  type="button"
                  onClick={() => setConditionsOpen((open) => !open)}
                >
                  대진 안내
                </button>
              </div>
            </div>

            {conditionsOpen ? (
              <div className="match-condition-panel">
                <div className="fixed-condition-summary">
                  <strong>자동 운영 기준</strong>
                  <span>
                    비슷한 실력과 동일 성별 우선
                  </span>
                </div>
                <p className="automatic-condition-note">
                  *참가자들의 연령과 실력이 다양할 경우, 실력차가 큰 대진이
                  조합될 수 있습니다. 대진 생성 후, "실력차"라고 표시된 대진
                  카드를 직접 수정을 하셔서 최적의 조합을 만드시길
                  부탁드립니다.
                </p>
              </div>
            ) : null}

            {playersOpen ? (
              <>
                {showBulkPlayerInput ? (
                  <div
                    className={`bulk-panel ${
                      isRosterDrafting ? 'initial-bulk-panel' : ''
                    }`}
                  >
                    <div className="bulk-help">
                      이름만 입력 시 O · 무관 · 무관
                    </div>
                    <textarea
                      aria-label="참가자 명단 입력"
                      value={bulkText}
                      onChange={(event) => setBulkText(event.target.value)}
                      placeholder={bulkPlayerPlaceholder}
                    />
                    <div className="bulk-actions">
                      <div className="participant-action-with-help">
                        <button
                          type="button"
                          className="participant-action-main"
                          onClick={() => {
                            setParticipantReplanHelpOpen(null)
                            if (isRosterDrafting) completePlayerRoster()
                            else applyBulkPlayers('append')
                          }}
                        >
                          {isRosterDrafting ? '명단 입력 완료' : '입력'}
                        </button>
                        <button
                          type="button"
                          className="participant-action-help"
                          aria-label="진행 중 참가자 명단 입력 안내"
                          aria-expanded={participantReplanHelpOpen === 'input'}
                          aria-controls="participant-input-replan-help"
                          onClick={() => setParticipantReplanHelpOpen((current) =>
                            current === 'input' ? null : 'input'
                          )}
                        >
                          ?
                        </button>
                        {participantReplanHelpOpen === 'input' ? (
                          <span
                            className="participant-action-tooltip"
                            id="participant-input-replan-help"
                            role="status"
                          >
                            {PARTICIPANT_REPLAN_HELP}
                          </span>
                        ) : null}
                      </div>
                      {playerDetailsOpen && players.length > 0 ? (
                        <button type="button" onClick={() => applyBulkPlayers('replace')}>
                          전체 교체
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {playerDetailsOpen && players.length > 0 ? (
                  <div className="player-list">
                    {players.map((player) => {
                      const isSpecialLevel = player.level === '스페셜'
                      const displayName = playerDisplayName(player, displayNames)
                      const rawName = player.name.trim()
                      const namePlaceholder =
                        playerNamePlaceholders[player.id] ??
                        (player.isGuest ? '스페셜 1번' : '1번')
                      const scheduleWindow = playerScheduleWindows.get(player.id)
                      const attendanceWindow = resolveMeetingAttendanceWindow(
                        player,
                        settings,
                      )
                      const attendanceMinimumMinutes = player.isGuest
                        ? GAME_SLOT_MINUTES
                        : settings.normalGameMinutes
                      const attendanceWindowInvalid =
                        attendanceWindow.duration < attendanceMinimumMinutes
                      const attendanceEditorOpen = Boolean(
                        attendanceEditorOpenIds[player.id],
                      )

                      return (
                        <article
                          className={`player-row ${player.isGuest ? 'special-row' : ''}`}
                          key={player.id}
                        >
                        <div className="row-top">
                          <div className="row-status">
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={player.active}
                                onChange={(event) => {
                                  updatePlayer(player.id, { active: event.target.checked })
                                  resetMeetingTargetRoundsForRosterChange()
                                }}
                              />
                              참석
                            </label>
                            {player.isGuest ? <span className="status-chip">스페셜</span> : null}
                            {scheduleWindow ? (
                              <span className="status-chip schedule-time-chip">
                                첫 {clockTimeAtOffset(
                                  generatedMeetingSettings.startTime,
                                  scheduleWindow.firstStart,
                                )} · 마지막 {clockTimeAtOffset(
                                  generatedMeetingSettings.startTime,
                                  scheduleWindow.lastEnd,
                                )} · {scheduleWindow.games}경기
                              </span>
                            ) : null}
                            {!player.isGuest && guestPlayers.length > 0 ? (
                              <label className="checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={player.specialMatchEligible ?? true}
                                  onChange={(event) => {
                                    updatePlayer(player.id, {
                                      specialMatchEligible: event.target.checked,
                                    })
                                  }}
                                />
                                스페셜 매치
                                <span
                                  className="inline-help-tooltip"
                                  role="img"
                                  tabIndex={0}
                                  aria-label="해제 시, 스페셜과 경기를 하지 않습니다."
                                  data-tooltip="해제 시, 스페셜과 경기를 하지 않습니다."
                                  onClick={(event) => event.preventDefault()}
                                >
                                  ?
                                </span>
                              </label>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="icon-button"
                            title="삭제"
                            onClick={() => removePlayer(player.id)}
                          >
                            ×
                          </button>
                        </div>
                        <div className={`player-name-fields ${isSpecialLevel ? 'single-field' : ''}`}>
                          <input
                            className="name-input"
                            aria-label={`${namePlaceholder} 이름`}
                            placeholder={namePlaceholder}
                            value={player.name}
                            onFocus={() => {
                              if (isAutoGeneratedPlayerName(player.name)) {
                                updatePlayer(player.id, { name: '' })
                              }
                            }}
                            onChange={(event) =>
                              updatePlayer(player.id, { name: event.target.value })
                            }
                          />
                          {!isSpecialLevel ? (
                            <input
                              className="preferred-partner-input"
                              aria-label={`${displayName} 선호 파트너`}
                              placeholder="선호 파트너 최대 3명 · 쉼표 구분"
                              value={
                                preferredPartnerDrafts[player.id] ??
                                preferredPartnerNames(player, players)
                              }
                              onChange={(event) =>
                                updatePreferredPartnerDraft(player, event.target.value)
                              }
                              onBlur={() => commitPreferredPartnerDraft(player)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                              }}
                            />
                          ) : null}
                        </div>
                        {rawName && displayName !== rawName ? (
                          <div className="name-display-hint">표시명 {displayName}</div>
                        ) : null}
                        <div
                          className={`player-attendance-panel ${
                            attendanceWindowInvalid ? 'invalid' : ''
                          }`}
                        >
                          <div className="player-attendance-heading">
                            <strong>참석 시간</strong>
                            <span>{meetingAttendanceTimeLabel(player, settings)}</span>
                            {!attendanceWindow.isCustom ? (
                              <span className="attendance-default-chip">기본</span>
                            ) : null}
                            <label
                              className="checkbox-label attendance-priority-option"
                              title="참석 시간 안에서 평균 경기 수에 최대한 맞추며 연속 3경기까지 배정합니다."
                            >
                              <input
                                type="checkbox"
                                aria-label={`${displayName} 우선 배정`}
                                checked={player.attendancePriority ?? false}
                                onChange={(event) => {
                                  updatePlayer(player.id, {
                                    attendancePriority: event.target.checked,
                                    ...(event.target.checked
                                      ? { gameCountFlexible: false }
                                      : {}),
                                  })
                                  resetMeetingTargetRoundsForRosterChange()
                                }}
                              />
                              우선 배정
                            </label>
                            <button
                              type="button"
                              className="attendance-editor-toggle"
                              aria-expanded={attendanceEditorOpen}
                              onClick={() => setAttendanceEditorOpenIds((current) => ({
                                ...current,
                                [player.id]: !current[player.id],
                              }))}
                            >
                              {attendanceEditorOpen ? '닫기' : '변경'}
                            </button>
                          </div>
                          {attendanceEditorOpen ? (
                            <div className="player-attendance-fields">
                              <label>
                                도착
                                <input
                                  type="time"
                                  step={300}
                                  aria-label={`${displayName} 도착 시간`}
                                  value={clockTimeAtOffset(
                                    settings.startTime,
                                    attendanceWindow.start,
                                  )}
                                  onChange={(event) =>
                                    updatePlayerAttendanceTime(
                                      player,
                                      'arrivalOffsetMinutes',
                                      event.target.value,
                                    )
                                  }
                                />
                              </label>
                              <span className="attendance-time-separator">–</span>
                              <label>
                                출발
                                <input
                                  type="time"
                                  step={300}
                                  aria-label={`${displayName} 출발 시간`}
                                  value={clockTimeAtOffset(
                                    settings.startTime,
                                    attendanceWindow.end,
                                  )}
                                  onChange={(event) =>
                                    updatePlayerAttendanceTime(
                                      player,
                                      'departureOffsetMinutes',
                                      event.target.value,
                                    )
                                  }
                                />
                              </label>
                              {attendanceWindow.isCustom ? (
                                <button
                                  type="button"
                                  className="attendance-reset-button"
                                  onClick={() => resetPlayerAttendanceTime(player)}
                                >
                                  전체 시간
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {attendanceWindowInvalid ? (
                            <span className="attendance-window-error">
                              최소 {attendanceMinimumMinutes}분 필요
                            </span>
                          ) : null}
                        </div>
                        {!isSpecialLevel ? (
                          <div className="player-flex-options">
                            <label
                              className="checkbox-label"
                              title="일반 참가자보다 최대 1경기 적게 배정할 수 있습니다."
                            >
                              <input
                                type="checkbox"
                                checked={player.gameCountFlexible ?? false}
                                onChange={(event) =>
                                  updatePlayer(player.id, {
                                    gameCountFlexible: event.target.checked,
                                    ...(event.target.checked
                                      ? { attendancePriority: false }
                                      : {}),
                                  })
                                }
                              />
                              경기 수 양보 가능
                            </label>
                            <label
                              className="checkbox-label"
                              title="25분을 넘지 않는 범위에서 긴 대기를 우선 부담합니다."
                            >
                              <input
                                type="checkbox"
                                checked={player.waitTimeFlexible ?? false}
                                onChange={(event) =>
                                  updatePlayer(player.id, {
                                    waitTimeFlexible: event.target.checked,
                                  })
                                }
                              />
                              25분 내 긴 대기 가능
                            </label>
                          </div>
                        ) : null}
                        <div className={isSpecialLevel ? 'row-fields single-field' : 'row-fields'}>
                          <label>
                            레벨
                            <select
                              value={player.level}
                              onChange={(event) => {
                                const level = event.target.value as Level
                                const guestStateChanged = (level === '스페셜') !== player.isGuest
                                updatePlayer(player.id, {
                                  level,
                                  ...(level === '스페셜'
                                    ? {
                                        isGuest: true,
                                        gender: 'none' as Gender,
                                        specialRequired: false,
                                        specialMatchEligible: false,
                                        gameCountFlexible: false,
                                        waitTimeFlexible: false,
                                      }
                                    : {
                                        isGuest: false,
                                        specialRequired: true,
                                        specialMatchEligible: true,
                                      }),
                                })
                                if (guestStateChanged) {
                                  resetMeetingTargetRoundsForRosterChange()
                                }
                              }}
                            >
                              {levelOptions.map((level) => (
                                <option value={level} key={level}>
                                  {levelLabels[level]}
                                </option>
                              ))}
                            </select>
                          </label>
                          {!isSpecialLevel ? (
                            <>
                              <label>
                                연령대
                                <select
                                  value={player.ageGroup}
                                  onChange={(event) => {
                                    updatePlayer(player.id, {
                                      ageGroup: event.target.value as AgeGroup,
                                    })
                                  }}
                                >
                                  {ageGroups.map((ageGroup) => (
                                    <option value={ageGroup} key={ageGroup}>
                                      {ageGroup}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                성별
                                <select
                                  value={player.gender}
                                  onChange={(event) => {
                                    updatePlayer(player.id, {
                                      gender: event.target.value as Gender,
                                    })
                                  }}
                                >
                                  <option value="male">남</option>
                                  <option value="female">여</option>
                                  <option value="none">무관</option>
                                </select>
                              </label>
                            </>
                          ) : null}
                        </div>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <div className="collapsed-summary">
                    명단 입력 완료 후 정보 표시
                  </div>
                )}
              </>
            ) : (
              <div className="collapsed-summary">
                참가자 목록이 접혀 있습니다. 펼치기를 누르면 명단을 편집할 수 있습니다.
              </div>
            )}
          </section>

          <section className="panel-section prize-panel" id="meeting-prizes">
            <div className="section-heading">
              <div className="section-title-stack">
                <div className="title-with-controls">
                  <h2>경품 추첨</h2>
                  <button
                    type="button"
                    className="section-toggle-button"
                    onClick={() => setPrizeOpen((open) => !open)}
                  >
                    {prizeOpen ? '접기' : '펼치기'}
                  </button>
                </div>
                <span>{prizeStatusText}</span>
              </div>
              <div className="compact-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={isRouletteSpinning}
                  onClick={runPrizeDraw}
                >
                  {isRouletteSpinning ? '회전중' : prizeActionLabel}
                </button>
                <button type="button" onClick={copyPrizeDrawResults}>
                  복사
                </button>
                <button type="button" onClick={resetPrizeDrawResults}>
                  초기화
                </button>
              </div>
            </div>

            {prizeOpen ? (
            <div className="prize-draw-box">
              <div className="prize-mode-switch" aria-label="추첨 종류">
                <button
                  type="button"
                  className={prizeDraw.mode === 'people' ? 'active' : ''}
                  onClick={() =>
                    setPrizeDraw((current) => ({ ...current, mode: 'people' }))
                  }
                >
                  사람
                </button>
                <button
                  type="button"
                  className={prizeDraw.mode === 'mission' ? 'active' : ''}
                  onClick={() =>
                    setPrizeDraw((current) => ({ ...current, mode: 'mission' }))
                  }
                >
                  미션
                </button>
              </div>
              {prizeDraw.mode === 'people' ? (
                <div className="prize-count-row">
                  <span>추첨 인원</span>
                  <div className="prize-count-switch" aria-label="추첨 인원">
                    {prizeDrawCountOptions.map((count) => (
                      <button
                        type="button"
                        className={prizeDraw.drawCount === count ? 'active' : ''}
                        disabled={isRouletteSpinning}
                        onClick={() =>
                          setPrizeDraw((current) => ({
                            ...current,
                            drawCount: count,
                          }))
                        }
                        key={count}
                      >
                        {count}명
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="bulk-help">
                {prizeDraw.mode === 'mission'
                  ? '입력 안내: 번호 / 미션 / 상품 순'
                  : hasNamedPrizes && !prizeDraw.prizesConfirmed
                    ? '입력 완료 후 룰렛 시작'
                    : '경품은 한 줄에 하나씩 · 비우면 참가자 룰렛'}
              </div>
              {(prizeDraw.mode === 'mission' || isRouletteMode) ? (
                <div className="prize-roulette" aria-live="polite">
                  <div className="prize-roulette-pointer" />
                  <div
                    className={`prize-roulette-wheel ${
                      isRouletteSpinning ? 'spinning' : ''
                    }`}
                    style={rouletteWheelStyle}
                  >
                    {rouletteItems.map((candidate, index) => (
                      <span
                        className="prize-roulette-name"
                        key={candidate.id}
                        style={
                          {
                            '--name-angle': `${
                              (360 / Math.max(rouletteItems.length, 1)) * index
                            }deg`,
                            '--name-angle-reverse': `${
                              (-360 / Math.max(rouletteItems.length, 1)) * index
                            }deg`,
                          } as CSSProperties
                        }
                      >
                        {candidate.name}
                      </span>
                    ))}
                  </div>
                  <div className="prize-roulette-center">
                    <span>
                      {isRouletteSpinning
                        ? '회전중'
                        : rouletteWinnerName
                          ? '당첨'
                          : '대기'}
                    </span>
                    <strong>
                      {isRouletteSpinning
                        ? '...'
                        : rouletteWinnerName ||
                          (prizeDraw.mode === 'mission'
                            ? `${availableRouletteCount}개`
                            : hasNamedPrizes
                              ? nextPrizeDrawLabel ?? '완료'
                              : `${availableRouletteCount}명`)}
                    </strong>
                  </div>
                </div>
              ) : null}
              {prizeDraw.mode === 'mission' ? (
                <textarea
                  className="prize-textarea"
                  value={prizeDraw.missionsText}
                  onChange={(event) =>
                    setPrizeDraw((current) => ({
                      ...current,
                      missionsText: event.target.value,
                    }))
                  }
                  placeholder="번호 / 미션 / 상품"
                />
              ) : (
                <>
                  {hasNamedPrizes && prizeDraw.prizesConfirmed ? (
                    <>
                      <div className="prize-entry-summary">
                        <strong>경품 {prizeList.length}개 준비</strong>
                        <div>
                          <button
                            type="button"
                            onClick={() => setPrizeListOpen((open) => !open)}
                          >
                            {prizeListOpen ? '접기' : '펼치기'}
                          </button>
                          <button type="button" onClick={editPrizeEntries}>
                            수정
                          </button>
                        </div>
                      </div>
                      {prizeListOpen ? (
                        <ol className="prize-entry-list">
                          {prizeList.map((prize, index) => (
                            <li key={`${prize}-${index}`}>{prize}</li>
                          ))}
                        </ol>
                      ) : null}
                    </>
                  ) : (
                    <textarea
                      className="prize-textarea"
                      value={prizeDraw.prizesText}
                      onChange={(event) =>
                        setPrizeDraw((current) => ({
                          ...current,
                          prizesText: event.target.value,
                          prizesConfirmed: false,
                          results: current.results.length > 0 ? [] : current.results,
                        }))
                      }
                      onFocus={() => setPrizeListOpen(false)}
                      placeholder="경품 입력창"
                    />
                  )}
                  <label className="settings-checkbox prize-duplicate-option">
                    <input
                      type="checkbox"
                      checked={prizeDraw.allowDuplicateWinners}
                      onChange={(event) =>
                        setPrizeDraw((current) => ({
                          ...current,
                          allowDuplicateWinners: event.target.checked,
                        }))
                      }
                    />
                    중복 허용
                  </label>
                </>
              )}
              {activePrizeResults.length > 0 ? (
                <div className="prize-result-list">
                  {activePrizeResults.map((result, index) => (
                    <div
                      className={`prize-result-row ${
                        prizeDraw.mode === 'mission' ? 'mission-result-row' : ''
                      }`}
                      key={`${result.prize}-${index}`}
                    >
                      {prizeDraw.mode === 'mission' ? (
                        <>
                          <div className="mission-result-text">
                            <strong>{result.prize}</strong>
                            <span>{result.winnerName}</span>
                            {result.reward ? <em>{result.reward}</em> : null}
                          </div>
                          <button
                            type="button"
                            className={
                              result.done
                                ? 'mission-done-button active'
                                : 'mission-done-button'
                            }
                            onClick={() => toggleMissionPrizeDone(index)}
                          >
                            {result.done ? '지급' : '대기'}
                          </button>
                        </>
                      ) : (
                        <>
                          <strong>{result.prize}</strong>
                          <span>{result.winnerName}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="collapsed-summary">
                  {prizeDraw.mode === 'mission'
                    ? '미션 입력 후 대진 카드의 미션 버튼을 누르세요.'
                    : '참석 중인 참가자와 스페셜 전체가 추첨 대상입니다.'}
                </div>
              )}
            </div>
            ) : (
              <div className="collapsed-summary">
                {prizeStatusText}
              </div>
            )}
          </section>
        </aside>
        ) : null}

        <section className="workspace">
          {isSharedMode ? (
            <SharedScheduleFinder candidates={meetingSharedScheduleCandidates} />
          ) : null}
          {hasScheduledActiveGuests ? (
            <section className="special-bar">
              <div>
                <span className="eyebrow">스페셜 현황</span>
                <h2>
                  {generatedMeetingSettings.specialLimitEnabled
                    ? `배정 ${assignedSpecialParticipantCount}/${specialLimitParticipantCapacity}명`
                    : `최소 ${specialMinimumMatchCount}경기`}
                </h2>
                <p className="metric-subtext">
                  {generatedMeetingSettings.specialLimitEnabled
                    ? `목표 ${specialLimitMatchCapacity}경기 · 참가 ${specialLimitParticipantCapacity}명`
                    : `예상 ${formatDuration(specialMinimumMinutes)}`}
                </p>
              </div>
              <div className="special-summary">
                <span>
                  스페셜 대상 {scheduledSpecialEligibleMembers.length}/
                  {scheduledActiveMembers.length}명
                </span>
                <span>{specialLimitText}</span>
                <span>배정 {specialAllocationText}</span>
                {generatedMeetingSettings.specialLimitEnabled &&
                generatedMeetingSettings.specialScheduleMode === 'continuous' &&
                generatedMeetingSettings.specialTimeLimitEnabled ? (
                  <span>{specialCutoffTime}부터 일반 대진</span>
                ) : null}
                {actualSpecialEndTime ? <span>마지막 배정 {actualSpecialEndTime}</span> : null}
                <span>
                  {generatedMeetingSettings.specialLimitEnabled
                    ? generatedMeetingSettings.specialScheduleMode === 'continuous'
                      ? `집중 운영 ${formatDuration(Math.min(
                          generatedMeetingSettings.specialTimeLimitMinutes,
                          scheduledBookingMinutes,
                        ))}`
                      : `전체 시간 분산 ${formatDuration(scheduledBookingMinutes)}`
                    : `최소 필요 ${specialMinimumMatchCount}경기`}
                </span>
                {scheduledActiveGuests.map((guest) => (
                  <span key={guest.id}>
                    {playerDisplayName(guest, scheduleDisplayNames)} · 전체 대진 중{' '}
                    {schedule.guestGameCounts[guest.id] ?? 0}경기 배정
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {meetingWarnings.length > 0 ? (
            <div className="warning-strip">
              {meetingWarnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}

          {!isSharedMode &&
          totalMatches > 0 &&
          participantWaitLimitViolations.length > 0 ? (
            <section className="wait-limit-operator-panel" id="wait-limit-review">
              <div className="wait-limit-operator-heading">
                <div>
                  <span className="eyebrow">운영자 확인</span>
                  <h2>25분 초과 참가자 {participantWaitLimitViolations.length}명</h2>
                </div>
                <span>교체 후 목록이 자동으로 다시 계산됩니다.</span>
              </div>
              <div className="wait-limit-participant-list">
                {participantWaitLimitViolations.map((violation) => {
                  const player = generatedMeetingPlayers.find(
                    (candidate) => candidate.id === violation.playerId,
                  )
                  return (
                    <button
                      type="button"
                      key={violation.playerId}
                      onClick={() => openWaitLimitManualEdit(violation)}
                    >
                      <span>
                        <strong>
                          {player
                            ? playerDisplayName(player, scheduleDisplayNames)
                            : '참가자'}
                        </strong>
                        <small>{waitViolationDetail(violation)}</small>
                      </span>
                      <em>관련 경기 수정</em>
                    </button>
                  )
                })}
              </div>
            </section>
          ) : null}

          <section className={`time-bar ${overtimeMatches.length > 0 ? 'time-overrun' : ''}`}>
            <div className="schedule-overview-heading">
              <span className="eyebrow">대진표 요약</span>
              <h2>{scheduledActivePlayers.length}명 참가</h2>
              <span>스페셜 {scheduledActiveGuests.length}명 포함</span>
              <div className={overtimeMatches.length > 0 ? 'time-alert' : 'time-ok'}>
                {overtimeMatches.length > 0
                  ? `${overtimeMatches.length}경기 예약 종료 초과`
                  : `${generatedMeetingSettings.endTime} 내 완료`}
              </div>
              {!isSharedMode ? (
                <button
                  type="button"
                  className="status-refresh-button summary-refresh-button"
                  disabled={isMeetingStatusRefreshing}
                  onClick={refreshMeetingStatus}
                >
                  {isMeetingStatusRefreshing ? '대진 분석 중' : '현황 업데이트'}
                </button>
              ) : null}
            </div>
            <div className="schedule-summary-grid">
              <div>
                <span>운영 시간</span>
                <strong>
                  {generatedMeetingSettings.startTime}–{generatedMeetingSettings.endTime}
                </strong>
                <small>{formatDuration(scheduledBookingMinutes)} · 실제 종료 {estimatedEndTime}</small>
              </div>
              <div>
                <span>총 경기</span>
                <strong>{totalMatches}경기</strong>
              </div>
              <div className={
                scheduleQualityAnalysis.genderCompositionReviewMatches > 0
                  ? 'gender-review-summary'
                  : ''
              }>
                <span>성별 조합 확인</span>
                <strong>
                  {scheduleQualityAnalysis.genderCompositionReviewMatches}경기
                </strong>
                <small>여1·남3 · 남1·여3 · 남2·여2</small>
              </div>
              <div>
                <span>
                  {generatedMeetingSettings.courtAssignmentMode === 'available'
                    ? '운영 방식'
                    : '코트별 경기'}
                </span>
                <strong>
                  {generatedMeetingSettings.courtAssignmentMode === 'available'
                    ? '빈 코트 순차 배정'
                    : `${minimumCourtGames}–${maximumCourtGames}경기`}
                </strong>
                <small>
                  {generatedMeetingSettings.courtAssignmentMode === 'available'
                    ? `전체 ${totalMatches}개 순번 · 코트 ${generatedMeetingSettings.courtCount}개`
                    : `${courtSchedules.length}개 코트 사용`}
                </small>
              </div>
              <div>
                <span>참가자 평균</span>
                <strong>{averageGames.toFixed(1)}경기</strong>
              </div>
              <div className="schedule-summary-wide">
                <span>최다 배정</span>
                <strong>{maximumParticipantGames}경기 · {maximumParticipantCount}명</strong>
                <small>{maximumParticipants || '해당 참가자 없음'}</small>
              </div>
              <div className="schedule-summary-wide">
                <span>최소 배정</span>
                <strong>{minimumParticipantGames}경기 · {minimumParticipantCount}명</strong>
                <small>{minimumParticipants || '해당 참가자 없음'}</small>
              </div>
              {generatedMeetingSettings.specialLimitEnabled &&
              generatedMeetingSettings.specialScheduleMode === 'continuous' &&
              generatedMeetingSettings.specialTimeLimitEnabled ? (
                <div className="schedule-summary-wide">
                  <span>스페셜 운영 종료 후</span>
                  <strong>
                    {specialCutoffTime}부터 · 일반 {generalOnlyAfterLimitMatches}경기
                  </strong>
                </div>
              ) : null}
            </div>
          </section>

          <section className="progress-panel" id="meeting-progress">
            <div className="progress-heading">
              <span className="eyebrow">진행 상황</span>
              <h2>{progressPercent}%</h2>
              {!isSharedMode ? (
                <button
                  type="button"
                  className="status-refresh-button"
                  disabled={isMeetingStatusRefreshing}
                  onClick={refreshMeetingStatus}
                >
                  {isMeetingStatusRefreshing ? '대진 분석 중' : '현황 업데이트'}
                </button>
              ) : null}
            </div>
            <div className="progress-meter" aria-label={`경기 진행률 ${progressPercent}%`}>
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="progress-grid">
              <div>
                <span>남은 경기</span>
                <strong>{remainingMatches}경기</strong>
              </div>
              <div>
                <span>완료 경기</span>
                <strong>{completedMatches}/{totalMatches}경기</strong>
              </div>
              <div>
                <span>전체 경기</span>
                <strong>{totalMatches}경기</strong>
              </div>
            </div>
          </section>

          {printImageUrls.length > 0 ? (
            <section
              className="print-preview-panel"
              id="meeting-image"
              ref={meetingPrintPreviewRef}
            >
              <div className="section-heading">
                <div>
                  <h2>대진표 이미지</h2>
                  <span>A4 {printImageUrls.length}장 생성됨</span>
                </div>
                <div className="compact-actions">
                  <button type="button" onClick={savePreparedScheduleImages}>
                    저장
                  </button>
                  <button type="button" onClick={() => setPrintImageUrls([])}>
                    닫기
                  </button>
                </div>
              </div>
              <div className="print-preview-list">
                {printImageUrls.map((imageUrl, index) => (
                  <article className="print-preview-page" key={imageUrl}>
                    <img src={imageUrl} alt={`대진표 ${index + 1}쪽`} />
                    <button
                      type="button"
                      onClick={() => void saveScheduleImage(imageUrl, index)}
                    >
                      {index + 1}쪽 저장
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <nav className="tab-row" id="meeting-schedule" aria-label="보기 선택">
            <button
              type="button"
              className={view === 'schedule' ? 'active' : ''}
              onClick={() => setView('schedule')}
            >
              대진표
            </button>
            <button
              type="button"
              className={view === 'stats' ? 'active' : ''}
              onClick={() => setView('stats')}
            >
              통계
            </button>
            <button type="button" onClick={handlePrintSchedule}>
              저장
            </button>
            {!isSharedMode ? (
              <div className="browser-save-action">
                <button
                  type="button"
                  className="browser-save-button"
                  onClick={saveMeetingScheduleToBrowser}
                >
                  브라우저에 저장
                </button>
                <button
                  type="button"
                  className="round-help-button"
                  aria-label="브라우저 저장 설명"
                  onClick={() => setFeatureHelpOpen('browser-save')}
                >
                  ?
                </button>
              </div>
            ) : null}
            <span>
              {completedMatches}/{totalMatches} 경기 완료
            </span>
          </nav>

          {view === 'schedule' ? (
            <>
              <div className={`round-list court-schedule-list ${
                generatedMeetingSettings.courtAssignmentMode === 'available'
                  ? 'available-schedule-list'
                  : ''
              }`}>
              {meetingScheduleSections.map((round) => {
                const availableAssignment =
                  generatedMeetingSettings.courtAssignmentMode === 'available'
                const startsAt = round.matches[0]?.startOffsetMinutes ??
                  (round.number - 1) * GAME_SLOT_MINUTES
                const isOvertimeRound = round.matches.some(
                  (match) =>
                    (match.startOffsetMinutes ?? 0) +
                      (match.durationMinutes ?? GAME_SLOT_MINUTES) >
                    scheduledBookingMinutes,
                )
                return (
                  <section
                    className={`round-section ${
                      isOvertimeRound ? 'overtime-round' : ''
                    }`}
                    key={round.id}
                  >
                    <div className="round-heading">
                      <div className="round-title">
                        <h2>
                          {availableAssignment ? '전체 대진 순서' : `${round.number}코트`}
                        </h2>
                        <span className={`time-chip ${isOvertimeRound ? 'over' : ''}`}>
                          {availableAssignment
                            ? '빈 코트 배정'
                            : isOvertimeRound ? '예약 초과' : '예약 내'}
                        </span>
                      </div>
                      <div className="round-meta-actions">
                        <span>
                          {round.matches.length}경기 · 시간순
                          {availableAssignment ? ' · 순번대로 호출' : ''}
                        </span>
                      </div>
                    </div>
                    <div className="match-grid">
                      {round.matches.map((match, matchIndex) => {
                        const skillWarningLevel = getMatchSkillWarningLevel(match)
                        const skillWarningClass = skillWarningLevel === 'danger'
                          ? 'skill-balance-danger'
                          : skillWarningLevel === 'caution'
                            ? 'skill-balance-caution'
                            : ''
                        const genderCompositionReview =
                          getMatchGenderCompositionReview(match)
                        const genderReviewClass = genderCompositionReview
                          ? 'gender-composition-review'
                          : ''
                        if (collapsedMatchIds[match.id]) {
                          return (
                            <article
                              id={`meeting-match-${match.id}`}
                              className={`match-card collapsed-match-card ${
                                availableAssignment ? 'available-assignment-match' : ''
                              } ${skillWarningClass} ${genderReviewClass}`}
                              key={match.id}
                            >
                              {availableAssignment ? (
                                <span className="available-collapsed-match-number">
                                  <b>{matchIndex + 1}</b>
                                  <small>번</small>
                                </span>
                              ) : (
                                <strong>{matchIndex + 1}번</strong>
                              )}
                              <button
                                type="button"
                                onClick={() => toggleMeetingMatch(match.id)}
                              >
                                펼치기
                              </button>
                            </article>
                          )
                        }
                        const result = results[match.id] ?? {
                          teamAScore: '',
                          teamBScore: '',
                          completed: false,
                          note: '',
                        }
                        const isEditingMatch = Boolean(editingMatchIds[match.id])
                        const matchOverrides = matchNameOverrides[match.id] ?? {}
                        const matchMission = prizeDraw.matchMissions[match.id]
                        const selectedWinnerSide = resultWinnerSide(result)
                        const assignmentLocked = Boolean(
                          availableAssignment && meetingCourtAssignments[match.id],
                        )
                        const assignmentPending = Boolean(
                          availableAssignment && !meetingCourtAssignments[match.id],
                        )
                        const renderTeamName = (team: Team, teamLabel: string) =>
                          isEditingMatch && !isSharedMode ? (
                            <div className="team-name-edit">
                              {team.map((player, playerIndex) => {
                                const recommendations =
                                  meetingSwapRecommendations.get(
                                    meetingSwapRecommendationKey(match.id, player.id),
                                  ) ?? []
                                const waitingRecommendations = recommendations.filter(
                                  (recommendation) =>
                                    recommendation.swapType === 'waiting-replacement',
                                )
                                const simultaneousRecommendations = recommendations.filter(
                                  (recommendation) =>
                                    recommendation.swapType === 'simultaneous-swap',
                                )
                                const sourcePlayerIds = new Set(
                                  [...match.teamA, ...match.teamB].map(
                                    (matchPlayer) => matchPlayer.id,
                                  ),
                                )
                                const recommendationIds = new Set(
                                  recommendations.map(
                                    (recommendation) => recommendation.player.id,
                                  ),
                                )
                                const forcedCandidates = generatedMeetingPlayers
                                  .filter(
                                    (candidate) =>
                                      candidate.active &&
                                      !sourcePlayerIds.has(candidate.id) &&
                                      !recommendationIds.has(candidate.id),
                                  )
                                  .map((candidate) => ({
                                    player: candidate,
                                    conflictMatch: findMeetingPlayerTimeConflict(
                                      schedule,
                                      match.id,
                                      candidate.id,
                                    ),
                                  }))
                                  .sort((left, right) =>
                                    Number(left.player.isGuest !== player.isGuest) -
                                      Number(right.player.isGuest !== player.isGuest) ||
                                    Number(Boolean(left.conflictMatch)) -
                                      Number(Boolean(right.conflictMatch)) ||
                                    left.player.name.localeCompare(
                                      right.player.name,
                                      'ko',
                                    ),
                                  )
                                return (
                                  <select
                                    key={player.id}
                                    aria-label={`${teamLabel} ${playerIndex + 1} 참가자 교체`}
                                    value={
                                      matchNameDrafts[match.id]?.[player.id] ??
                                      player.id
                                    }
                                    onChange={(event) =>
                                      updateMatchNameDraft(
                                        match.id,
                                        player.id,
                                        event.target.value,
                                      )
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') saveMatchEditor(match)
                                    }}
                                  >
                                    <option value={player.id}>
                                      {playerDisplayName(player, scheduleDisplayNames)} · 현재
                                    </option>
                                    {waitingRecommendations.length > 0 ? (
                                      <optgroup label="대기 참가자 · 교체 추천 순">
                                        {waitingRecommendations.map((recommendation, index) => (
                                          <option
                                            value={recommendation.player.id}
                                            key={recommendation.player.id}
                                          >
                                            {index < 3 ? `추천 ${index + 1} · ` : ''}
                                            {playerDisplayName(
                                              recommendation.player,
                                              scheduleDisplayNames,
                                            )}
                                            {' · '}
                                            {recommendation.reasons.join(' · ')}
                                          </option>
                                        ))}
                                      </optgroup>
                                    ) : null}
                                    {simultaneousRecommendations.length > 0 ? (
                                      <optgroup label="동시간 참가자 · 확인 후 맞교환">
                                        {simultaneousRecommendations.map((recommendation) => (
                                          <option
                                            value={recommendation.player.id}
                                            key={recommendation.player.id}
                                          >
                                            {playerDisplayName(
                                              recommendation.player,
                                              scheduleDisplayNames,
                                            )}
                                            {' · '}
                                            {recommendation.conflictCourt}코트와 맞교환
                                          </option>
                                        ))}
                                      </optgroup>
                                    ) : null}
                                    {recommendations.length === 0 &&
                                    forcedCandidates.length > 0 ? (
                                      <option disabled>
                                        권장 후보 없음 · 강제 선택 가능
                                      </option>
                                    ) : null}
                                    {forcedCandidates.length > 0 ? (
                                      <optgroup label="강제 선택 · 완료 시 경고 확인">
                                        {forcedCandidates.map((candidate) => (
                                          <option
                                            value={candidate.player.id}
                                            key={candidate.player.id}
                                          >
                                            {playerDisplayName(
                                              candidate.player,
                                              scheduleDisplayNames,
                                            )}
                                            {' · '}
                                            {candidate.player.isGuest !== player.isGuest
                                              ? '스페셜 구분 변경 · '
                                              : ''}
                                            {candidate.conflictMatch
                                              ? `${candidate.conflictMatch.court}코트 맞교환`
                                              : '강제 교체'}
                                          </option>
                                        ))}
                                      </optgroup>
                                    ) : null}
                                    {recommendations.length === 0 &&
                                    forcedCandidates.length === 0 ? (
                                      <option disabled>선택 가능한 참가자 없음</option>
                                    ) : null}
                                  </select>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="team-name">
                              {matchTeamName(match, team)}
                            </div>
                          )
                        const renderResultButtons = (
                          teamSide: MatchWinnerSide,
                          teamName: string,
                        ) => {
                          const otherSide = teamSide === 'A' ? 'B' : 'A'
                          return (
                            <div className="result-toggle-group" aria-label={`${teamName} 승패`}>
                              <button
                                type="button"
                                disabled={assignmentPending}
                                className={selectedWinnerSide === teamSide ? 'active win' : ''}
                                aria-pressed={selectedWinnerSide === teamSide}
                                onClick={() => updateMatchWinner(match.id, teamSide)}
                              >
                                승
                              </button>
                              <button
                                type="button"
                                disabled={assignmentPending}
                                className={selectedWinnerSide === otherSide ? 'active loss' : ''}
                                aria-pressed={selectedWinnerSide === otherSide}
                                onClick={() => updateMatchWinner(match.id, otherSide)}
                              >
                                패
                              </button>
                            </div>
                          )
                        }

                        return (
                          <article
                            id={`meeting-match-${match.id}`}
                            className={`match-card ${
                              match.isSpecial ? 'special-match' : ''
                            } ${
                              availableAssignment ? 'available-assignment-match' : ''
                            } ${skillWarningClass} ${genderReviewClass}`}
                            key={match.id}
                          >
                            <header>
                              {availableAssignment ? (
                                <span className="available-match-heading">
                                  <span className="available-match-number">
                                    <b>{matchIndex + 1}</b>
                                    <small>번</small>
                                  </span>
                                  <span className="available-match-detail">
                                    {meetingCourtAssignments[match.id]
                                      ? `${meetingCourtAssignments[match.id].court}코트 배정`
                                      : '코트 현장 배정'}
                                    {' · '}
                                    {match.durationMinutes ?? GAME_SLOT_MINUTES}분
                                  </span>
                                </span>
                              ) : (
                                <span>
                                  {`${matchIndex + 1}번 · ${clockTimeAtOffset(
                                      generatedMeetingSettings.startTime,
                                      match.startOffsetMinutes ?? startsAt,
                                    )}–${clockTimeAtOffset(
                                      generatedMeetingSettings.startTime,
                                      (match.startOffsetMinutes ?? startsAt) +
                                        (match.durationMinutes ?? GAME_SLOT_MINUTES),
                                    )} · ${match.durationMinutes ?? GAME_SLOT_MINUTES}분`}
                                </span>
                              )}
                              <div className="match-card-actions">
                                {!isSharedMode ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={assignmentLocked}
                                      title={
                                        assignmentLocked
                                          ? '코트 배정 후에는 참가자를 수정할 수 없습니다.'
                                          : ''
                                      }
                                      onClick={() =>
                                        isEditingMatch
                                          ? saveMatchEditor(match)
                                          : openMatchEditor(match)
                                      }
                                    >
                                      {isEditingMatch ? '완료' : '수정'}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={assignmentLocked}
                                      title={
                                        assignmentLocked
                                          ? '코트 배정 후에는 조합을 바꿀 수 없습니다.'
                                          : ''
                                      }
                                      onClick={() => mixMatch(match.id)}
                                    >
                                      믹스
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => drawMissionForMatch(match.id)}
                                    >
                                      미션
                                    </button>
                                  </>
                                ) : null}
                                {skillWarningLevel !== 'none' ? (
                                  <strong className={`skill-balance-badge ${skillWarningClass}`}>
                                    {skillWarningLevel === 'danger'
                                      ? '실력 차 큼'
                                      : '실력 차 주의'}
                                  </strong>
                                ) : null}
                                {match.isSpecial ? <strong>스페셜</strong> : null}
                              </div>
                            </header>
                            {genderCompositionReview ? (
                              <strong className="gender-composition-badge">
                                성별 조합 확인 · {genderCompositionReview.label}
                              </strong>
                            ) : null}
                            {matchMission ? (
                              <div className="match-mission-box">
                                <div>
                                  <strong>{matchMission.prize}</strong>
                                  <span>{matchMission.winnerName}</span>
                                  {matchMission.reward ? (
                                    <em>{matchMission.reward}</em>
                                  ) : null}
                                </div>
                                {!isSharedMode ? (
                                  <button
                                    type="button"
                                    className={
                                      matchMission.done
                                        ? 'mission-done-button active'
                                        : 'mission-done-button'
                                    }
                                    onClick={() => toggleMatchMissionDone(match.id)}
                                  >
                                    {matchMission.done ? '지급' : '대기'}
                                  </button>
                                ) : (
                                  <span>{matchMission.done ? '지급' : '대기'}</span>
                                )}
                              </div>
                            ) : null}
                            <div
                              className={`score-row ${
                                isSharedMode ? 'read-only-score' : 'meeting-score-row'
                              }`}
                            >
                              {renderTeamName(match.teamA, 'A팀')}
                              {isSharedMode ? (
                                <span className="score-value">{result.teamAScore || '-'}</span>
                              ) : (
                                <input
                                  className="score-input"
                                  aria-label={`${matchTeamName(match, match.teamA)} 점수`}
                                  type="number"
                                  min="0"
                                  disabled={assignmentPending}
                                  value={result.teamAScore}
                                  onChange={(event) =>
                                    updateResult(match.id, {
                                      teamAScore: event.target.value,
                                    })
                                  }
                                />
                              )}
                              {!isSharedMode
                                ? renderResultButtons('A', matchTeamName(match, match.teamA))
                                : null}
                            </div>
                            <div
                              className={`score-row ${
                                isSharedMode ? 'read-only-score' : 'meeting-score-row'
                              }`}
                            >
                              {renderTeamName(match.teamB, 'B팀')}
                              {isSharedMode ? (
                                <span className="score-value">{result.teamBScore || '-'}</span>
                              ) : (
                                <input
                                  className="score-input"
                                  aria-label={`${matchTeamName(match, match.teamB)} 점수`}
                                  type="number"
                                  min="0"
                                  disabled={assignmentPending}
                                  value={result.teamBScore}
                                  onChange={(event) =>
                                    updateResult(match.id, {
                                      teamBScore: event.target.value,
                                    })
                                  }
                                />
                              )}
                              {!isSharedMode
                                ? renderResultButtons('B', matchTeamName(match, match.teamB))
                                : null}
                            </div>
                            {isEditingMatch && matchEditorErrors[match.id] ? (
                              <p className="match-editor-error" role="alert">
                                {matchEditorErrors[match.id]}
                              </p>
                            ) : null}
                            <div className="match-footer">
                              <div className="match-footer-actions">
                                {isSharedMode ? (
                                  <span>{result.completed ? '완료' : '대기'}</span>
                                ) : (
                                  <label className="checkbox-label">
                                    <input
                                      type="checkbox"
                                      checked={result.completed}
                                      disabled={
                                        availableAssignment &&
                                        !meetingCourtAssignments[match.id] &&
                                        !result.completed
                                      }
                                      onChange={(event) => {
                                        if (!availableAssignment) {
                                          updateResult(match.id, {
                                            completed: event.target.checked,
                                          })
                                          return
                                        }
                                        if (event.target.checked) {
                                          completeMeetingProgressMatch(match.id)
                                        } else {
                                          undoMeetingProgressMatch(match.id)
                                        }
                                      }}
                                    />
                                    완료
                                  </label>
                                )}
                                <button
                                  type="button"
                                  className="match-collapse-button"
                                  onClick={() => toggleMeetingMatch(match.id)}
                                >
                                  접기
                                </button>
                              </div>
                              <span>
                                {winnerLabel(
                                  match,
                                  result,
                                  scheduleDisplayNames,
                                  matchOverrides,
                                )}
                              </span>
                            </div>
                            {isSharedMode ? (
                              result.note ? (
                                <div className="note-readonly">{result.note}</div>
                              ) : null
                            ) : (
                              <input
                                className="note-input"
                                placeholder="메모"
                                value={result.note}
                                onChange={(event) =>
                                  updateResult(match.id, { note: event.target.value })
                                }
                              />
                            )}
                          </article>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
              {!isSharedMode && schedule.rounds.length > 0 ? (
                <div className="add-round-panel">
                  <div className="round-count-actions">
                    <button
                      type="button"
                      className="round-delete-button"
                      disabled={
                        scheduledBookingMinutes -
                          generatedMeetingSettings.normalGameMinutes <
                        GAME_SLOT_MINUTES
                      }
                      onClick={removeLastCourtGames}
                    >
                      마지막 경기 삭제
                    </button>
                    <button type="button" onClick={addCourtGames}>
                      경기 추가
                    </button>
                  </div>
                  <span>
                    현재 {totalMatches}경기 · 예약 종료 {generatedMeetingSettings.endTime}
                  </span>
                </div>
              ) : null}
              </div>
            </>
          ) : (
            <section className="stats-section">
              <div className="stats-table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>레벨</th>
                      <th>연령대</th>
                      <th>성별</th>
                      <th>경기</th>
                      <th>대기</th>
                      <th>승</th>
                      <th>패</th>
                      <th>승률</th>
                      <th>득실</th>
                      <th>스페셜 경기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((stat) => {
                      const decided = stat.wins + stat.losses
                      const winRate =
                        decided > 0 ? Math.round((stat.wins / decided) * 100) : 0
                      return (
                        <tr key={stat.player.id}>
                          <td>
                            {playerDisplayName(stat.player, scheduleDisplayNames)}
                          </td>
                          <td>{stat.player.level}</td>
                          <td>
                            {stat.player.level === '스페셜' ? '-' : stat.player.ageGroup}
                          </td>
                          <td>
                            {stat.player.level === '스페셜'
                              ? '-'
                              : genderLabels[stat.player.gender]}
                          </td>
                          <td>{stat.games}</td>
                          <td>
                            {stat.firstWaitMinutes === null
                              ? '-'
                              : `첫 ${stat.firstWaitMinutes}분${
                                  stat.averageWaitMinutes === null || stat.maxWaitMinutes === null
                                    ? ''
                                    : ` · 평균 ${Math.round(stat.averageWaitMinutes)}분 · 최장 ${stat.maxWaitMinutes}분`
                                }`}
                          </td>
                          <td>{stat.wins}</td>
                          <td>{stat.losses}</td>
                          <td>{winRate}%</td>
                          <td>{stat.pointsFor - stat.pointsAgainst}</td>
                          <td>
                            {stat.player.isGuest
                              ? `${schedule.guestGameCounts[stat.player.id] ?? 0}경기`
                              : `${stat.guestGames}경기`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </section>
      </main>
      ) : (
        <main className={`app-shell tournament-shell ${isSharedMode ? 'shared-shell' : ''}`}>
          {!isSharedMode ? (
            <aside className="control-panel tournament-panel">
              <section className="panel-section">
                <div className="section-heading">
                  <div className="section-title-stack">
                    <div className="title-with-controls">
                      <h2>경쟁 설정</h2>
                      <button
                        type="button"
                        className="section-toggle-button"
                        onClick={() => setTournamentSettingsOpen((open) => !open)}
                      >
                        {tournamentSettingsOpen ? '접기' : '펼치기'}
                      </button>
                    </div>
                    <span>{notice}</span>
                  </div>
                  <div className="compact-actions">
                    <span>{tournamentFormatLabels[tournamentSettings.format]}</span>
                  </div>
                </div>

                {tournamentSettingsOpen ? (
                  <>
                <div className="format-list" aria-label="경쟁 진행 방식">
                  {(Object.keys(tournamentFormatLabels) as TournamentFormat[]).map(
                    (format) => (
                      <button
                        type="button"
                        className={
                          tournamentSettings.format === format ? 'active' : ''
                        }
                        key={format}
                        onClick={() => updateTournamentSettings({ format })}
                      >
                        <strong>{tournamentFormatLabels[format]}</strong>
                        <span>{tournamentFormatDescriptions[format]}</span>
                      </button>
                    ),
                  )}
                </div>

                <div className="settings-grid tournament-settings-grid">
                  <NumberStepper
                    label="코트"
                    min={1}
                    max={12}
                    value={tournamentSettings.courtCount}
                    onChange={(courtCount) => updateTournamentSettings({ courtCount })}
                  />
                  <div className="booking-time-controls tournament-booking-time" aria-label="경쟁 대관 시간">
                    <label>
                      시작
                      <input
                        type="time"
                        step={GAME_SLOT_MINUTES * 60}
                        value={tournamentSettings.startTime}
                        onChange={(event) => updateTournamentStartTime(event.target.value)}
                      />
                    </label>
                    <label>
                      종료
                      <input
                        type="time"
                        step={GAME_SLOT_MINUTES * 60}
                        value={tournamentSettings.endTime}
                        onChange={(event) => updateTournamentEndTime(event.target.value)}
                      />
                    </label>
                    <span>{formatDuration(tournamentBookingMinutes)}</span>
                  </div>
                  <NumberStepper
                    label="팀 수"
                    min={isFriendlyTournamentFormat(tournamentSettings.format) ? 2 : 0}
                    max={64}
                    value={tournamentTeams.length}
                    onChange={setTournamentTeamCount}
                  />
                  {!isFriendlyTournamentFormat(tournamentSettings.format) ? (
                    <NumberStepper
                      label="시드"
                      min={0}
                      max={tournamentTeams.length}
                      value={seededTournamentTeams.length}
                      onChange={setTournamentSeedCount}
                    />
                  ) : (
                    <NumberStepper
                      label="참가"
                      min={0}
                      max={256}
                      value={tournamentSettings.friendlyParticipantCount}
                      onChange={(friendlyParticipantCount) =>
                        updateTournamentSettings({ friendlyParticipantCount })
                      }
                    />
                  )}
                  {tournamentSettings.format === 'group-knockout' ? (
                    <>
                      <NumberStepper
                        label="조"
                        min={1}
                        max={16}
                        value={tournamentSettings.groupCount}
                        onChange={(groupCount) =>
                          updateTournamentSettings({ groupCount })
                        }
                      />
                      <NumberStepper
                        label="진출"
                        min={1}
                        max={8}
                        value={tournamentSettings.advancePerGroup}
                        onChange={(advancePerGroup) =>
                          updateTournamentSettings({ advancePerGroup })
                        }
                      />
                    </>
                  ) : null}
                  {tournamentSettings.format === 'team-battle' ? (
                    <NumberStepper
                      label="세부"
                      min={1}
                      max={5}
                      value={tournamentSettings.teamBattleMatchCount}
                      onChange={(teamBattleMatchCount) =>
                        updateTournamentSettings({ teamBattleMatchCount })
                      }
                    />
                  ) : null}
                  {!isTeamBattleTournamentFormat(tournamentSettings.format) ? (
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={tournamentSettings.includeThirdPlace}
                        onChange={(event) =>
                          updateTournamentSettings({
                            includeThirdPlace: event.target.checked,
                          })
                        }
                      />
                      3·4위전
                    </label>
                  ) : null}
                </div>

                {tournamentSettings.format === 'team-battle' ? (
                  <div className="slot-editor">
                    {Array.from(
                      { length: tournamentSettings.teamBattleMatchCount },
                      (_, index) => {
                        const value =
                          tournamentSettings.teamBattleSlots[index] ??
                          `${index + 1}경기`

                        return (
                          <label key={index}>
                            {index + 1}경기
                            <input
                              value={value}
                              onChange={(event) => {
                                const teamBattleSlots = [
                                  ...tournamentSettings.teamBattleSlots,
                                ]
                                teamBattleSlots[index] = event.target.value
                                updateTournamentSettings({ teamBattleSlots })
                              }}
                            />
                          </label>
                        )
                      },
                    )}
                  </div>
                ) : null}
                  </>
                ) : (
                  <div className="collapsed-summary">
                    {tournamentFormatLabels[tournamentSettings.format]} · 팀 {tournamentTeams.length} · 코트 {tournamentSettings.courtCount}
                    {` · ${tournamentSettings.startTime}–${tournamentSettings.endTime}`}
                    {isFriendlyTournamentFormat(tournamentSettings.format)
                      ? ` · 참가 ${tournamentSettings.friendlyParticipantCount}명`
                      : ''}
                  </div>
                )}
              </section>

              <section className="panel-section">
                <div className="section-heading">
                  <div className="section-title-stack">
                    <div className="title-with-controls">
                      <h2>
                        {isFriendlyTournamentFormat(tournamentSettings.format)
                          ? '참가자 입력'
                          : '팀 등록'}
                      </h2>
                      <button
                        type="button"
                        className="section-toggle-button"
                        onClick={() => setTournamentTeamsOpen((open) => !open)}
                      >
                        {tournamentTeamsOpen ? '접기' : '펼치기'}
                      </button>
                    </div>
                    <span>
                      {isFriendlyTournamentFormat(tournamentSettings.format)
                        ? `설정 ${tournamentSettings.friendlyParticipantCount}명`
                        : `참가 ${activeTournamentTeams.length}팀`}
                    </span>
                  </div>
                  <div className="compact-actions">
                    {!isFriendlyTournamentFormat(tournamentSettings.format) ? (
                      <button type="button" onClick={addTournamentTeam}>
                        추가
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setTournamentBulkOpen((open) => !open)}
                    >
                      {isFriendlyTournamentFormat(tournamentSettings.format)
                        ? '명단'
                        : '일괄'}
                    </button>
                    <button type="button" onClick={resetTournament}>
                      초기화
                    </button>
                  </div>
                </div>

                {tournamentTeamsOpen ? (
                  <>
                {tournamentBulkOpen ? (
                  <div className="bulk-panel">
                    <div className="bulk-help">
                      {isFriendlyTournamentFormat(tournamentSettings.format)
                        ? `입력 순서: 이름 레벨 성별 연령 · ${tournamentSettings.friendlyParticipantCount}명 입력 후 생성`
                        : tournamentSettings.format === 'team-battle'
                          ? '입력 순서: 팀명 시드(선택) 선수명 · 숫자가 없으면 시드 없음'
                          : '입력 순서: 팀명 시드(선택) 레벨(선택) 성별(선택) 선수명 · 숫자가 없으면 시드 없음'}
                    </div>
                    <textarea
                      value={tournamentBulkText}
                      onChange={(event) => setTournamentBulkText(event.target.value)}
                      placeholder={
                        isFriendlyTournamentFormat(tournamentSettings.format)
                          ? '김민수 A 남 30대\n이지연 B 여 30대\n박태호 C 남 40대\n최수빈 B 여 20대'
                          : tournamentSettings.format === 'team-battle'
                          ? 'A팀 1 김철수 이영희\nB팀 박민지 최수진\nC팀, 3, 홍길동, 김하나'
                          : 'A팀 1 A 남 김철수 이영희\nB팀, 2, B, 여, 박민지, 최수진\nC팀 혼복 홍길동 김하나'
                      }
                    />
                    <div className="bulk-actions">
                      {isFriendlyTournamentFormat(tournamentSettings.format) ? (
                        <button type="button" onClick={applyBulkTournamentPlayers}>
                          입력 완료
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => applyBulkTournamentTeams('append')}
                          >
                            추가
                          </button>
                          <button
                            type="button"
                            onClick={() => applyBulkTournamentTeams('replace')}
                          >
                            교체
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}

                {isFriendlyTournamentFormat(tournamentSettings.format) ? (
                  friendlyTeamsGenerated ? (
                    <div className="player-list tournament-team-list">
                      {tournamentTeams.map((team) => (
                        <article className="player-row tournament-team-row" key={team.id}>
                          <div className="row-top">
                            <div className="row-status">
                              <span className="status-chip">편성팀</span>
                              {tournamentTeamScheduleWindows.get(team.id) ? (
                                <span className="status-chip schedule-time-chip">
                                  첫 {clockTimeAtOffset(
                                    tournamentSettings.startTime,
                                    ((tournamentTeamScheduleWindows.get(team.id)?.firstRound ?? 1) - 1) * GAME_SLOT_MINUTES,
                                  )} · {tournamentTeamScheduleWindows.get(team.id)?.games}경기
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="friendly-team-summary">
                            <strong>{team.name}</strong>
                            <span>{team.playerNames || '배정 없음'}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="collapsed-summary">
                      참가자 명단 입력 후 생성
                    </div>
                  )
                ) : (
                <div className="player-list tournament-team-list">
                  {tournamentTeams.map((team, index) => (
                    <article className="player-row tournament-team-row" key={team.id}>
                      <div className="row-top">
                        <div className="row-status">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={team.active}
                              onChange={(event) =>
                                updateTournamentTeam(team.id, {
                                  active: event.target.checked,
                                })
                              }
                            />
                            참가
                          </label>
                          {team.seed ? (
                            <span className="status-chip">{team.seed}번 시드</span>
                          ) : null}
                          {tournamentTeamScheduleWindows.get(team.id) ? (
                            <span className="status-chip schedule-time-chip">
                              첫 {clockTimeAtOffset(
                                tournamentSettings.startTime,
                                ((tournamentTeamScheduleWindows.get(team.id)?.firstRound ?? 1) - 1) * GAME_SLOT_MINUTES,
                              )}
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="icon-button"
                          title="삭제"
                          onClick={() => removeTournamentTeam(team.id)}
                        >
                          ×
                        </button>
                      </div>
                      <input
                        className="name-input"
                        value={team.name}
                        onChange={(event) =>
                          updateTournamentTeam(team.id, { name: event.target.value })
                        }
                      />
                      <textarea
                        className="team-roster-input"
                        value={team.playerNames}
                        placeholder="선수명"
                        onChange={(event) =>
                          updateTournamentTeam(team.id, {
                            playerNames: event.target.value,
                          })
                        }
                      />
                      <div
                        className={
                          isTeamBattleTournamentFormat(tournamentSettings.format)
                            ? 'row-fields seed-row-fields'
                            : 'row-fields tournament-team-fields'
                        }
                      >
                        <label className="settings-checkbox seed-toggle">
                          <input
                            type="checkbox"
                            checked={team.seed !== null}
                            onChange={(event) =>
                              updateTournamentTeam(team.id, {
                                seed: event.target.checked ? index + 1 : null,
                              })
                            }
                          />
                          시드 지정
                        </label>
                        {team.seed !== null ? (
                          <label>
                            시드
                            <input
                              type="number"
                              min="1"
                              value={team.seed}
                              onChange={(event) =>
                                updateTournamentTeam(team.id, {
                                  seed: normalizeTournamentSeed(event.target.value),
                                })
                              }
                            />
                          </label>
                        ) : null}
                        {!isTeamBattleTournamentFormat(tournamentSettings.format) ? (
                          <>
                            <label>
                              레벨
                              <select
                                value={team.level}
                                onChange={(event) =>
                                  updateTournamentTeam(team.id, {
                                    level: event.target.value as Level,
                                  })
                                }
                              >
                                {levelOptions
                                  .filter((level) => level !== '스페셜')
                                  .map((level) => (
                                    <option value={level} key={level}>
                                      {levelLabels[level]}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <label>
                              성별
                              <select
                                value={team.gender}
                                onChange={(event) =>
                                  updateTournamentTeam(team.id, {
                                    gender: event.target.value as Gender,
                                  })
                                }
                              >
                                <option value="male">남</option>
                                <option value="female">여</option>
                                <option value="none">무관</option>
                              </select>
                            </label>
                          </>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
                )}
                  </>
                ) : (
                  <div className="collapsed-summary">
                    {isFriendlyTournamentFormat(tournamentSettings.format)
                      ? `팀 ${tournamentTeams.length} · 참가자 ${tournamentSettings.friendlyParticipantCount}명`
                      : `참가 ${activeTournamentTeams.length}팀 · 전체 ${tournamentTeams.length}팀`}
                  </div>
                )}
              </section>
            </aside>
          ) : null}

          <section className="workspace tournament-workspace">
            {isSharedMode ? (
              <SharedScheduleFinder candidates={tournamentSharedScheduleCandidates} />
            ) : null}
            <section className="tournament-summary-bar" id="tournament-progress">
              <div>
                <span className="eyebrow">경쟁 진행</span>
                <h2>{tournamentFormatLabels[tournamentSettings.format]}</h2>
              </div>
              <div className="time-summary">
                <span>팀 {activeTournamentTeams.length}</span>
                <span>코트 {tournamentSettings.courtCount}</span>
                <span>
                  예약 {tournamentSettings.startTime}–{tournamentSettings.endTime}
                </span>
                <span>예상 종료 {tournamentEstimatedEndTime}</span>
                <span>
                  완료 {completedTournamentMatches}/{totalTournamentMatches}
                </span>
                <span>
                  {isFriendlyTournamentFormat(tournamentSettings.format)
                    ? `참가 ${tournamentSettings.friendlyParticipantCount}명`
                    : seededTournamentTeams.length > 0
                    ? `시드 ${seededTournamentTeams.length}`
                    : '시드 없음'}
                </span>
              </div>
              <div className={tournamentOvertimeRounds > 0 ? 'time-alert' : 'time-ok'}>
                {tournamentOvertimeRounds > 0
                  ? `${formatDuration(tournamentOvertimeRounds * GAME_SLOT_MINUTES)} 초과 예상`
                  : nextTournamentMatch
                    ? `${nextTournamentMatch.label} 대기`
                    : totalTournamentMatches > 0
                      ? '전체 완료'
                      : '대진 없음'}
              </div>
            </section>

            {tournamentWarnings.length > 0 ? (
              <div className="warning-strip">
                {tournamentWarnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}

            {tournamentPrintImageUrls.length > 0 ? (
              <section
                className="print-preview-panel"
                id="tournament-image"
                ref={tournamentPrintPreviewRef}
              >
                <div className="section-heading">
                  <div>
                    <h2>경쟁 대진표 이미지</h2>
                    <span>A4 {tournamentPrintImageUrls.length}장 생성됨</span>
                  </div>
                  <div className="compact-actions">
                    <button type="button" onClick={savePreparedTournamentScheduleImages}>
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={() => setTournamentPrintImageUrls([])}
                    >
                      닫기
                    </button>
                  </div>
                </div>
                <div className="print-preview-list">
                  {tournamentPrintImageUrls.map((imageUrl, index) => (
                    <article className="print-preview-page" key={imageUrl}>
                      <img src={imageUrl} alt={`경쟁 대진표 ${index + 1}쪽`} />
                      <button
                        type="button"
                        onClick={() =>
                          void saveTournamentScheduleImage(imageUrl, index)
                        }
                      >
                        {index + 1}쪽 저장
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <nav className="tab-row" aria-label="경쟁 보기 선택">
              <button
                type="button"
                className={tournamentView === 'progress' ? 'active' : ''}
                onClick={() => setTournamentView('progress')}
              >
                현황
              </button>
              <button
                type="button"
                className={tournamentView === 'board' ? 'active' : ''}
                onClick={() => setTournamentView('board')}
              >
                {isFriendlyTournamentFormat(tournamentSettings.format)
                  ? '결과'
                  : '순위/브래킷'}
              </button>
              <button type="button" onClick={handlePrintTournament}>
                저장
              </button>
              <span>
                {completedTournamentMatches}/{totalTournamentMatches} 경기 완료
              </span>
            </nav>

            {tournamentView === 'progress' ? (
              <div className="round-list">
                {tournamentRounds.map(({ round, matches }) => {
                  const roundOpen = isTournamentRoundOpen(round)
                  const isOvertimeRound = round > tournamentBookingRoundCount

                  return (
                  <section
                    className={`round-section ${isOvertimeRound ? 'overtime-round' : ''}`}
                    key={round}
                  >
                    <div className="round-heading">
                      <div className="round-title">
                        <h2>{round}R</h2>
                        <button
                          type="button"
                          className="section-toggle-button"
                          onClick={() => toggleTournamentRound(round)}
                        >
                          {roundOpen ? '접기' : '펼치기'}
                        </button>
                        <span className={`time-chip ${isOvertimeRound ? 'over' : ''}`}>
                          {roundTimeRange(tournamentSettings.startTime, round)}
                          {isOvertimeRound ? ' · 초과' : ''}
                        </span>
                      </div>
                      <div className="round-meta-actions">
                        <span>
                          {matches
                            .map((match) => `${match.court}코트 ${match.label}`)
                            .join(' · ')}
                        </span>
                      </div>
                    </div>
                    {roundOpen ? (
                    <div className="match-grid">
                      {matches.map((match) => {
                        const result = tournamentResults[match.id] ?? {
                          teamAScore: '',
                          teamBScore: '',
                          completed: false,
                          note: '',
                        }
                        const canEditResult =
                          !isSharedMode &&
                          !match.isBye &&
                          Boolean(match.teamAId && match.teamBId)

                        return (
                          <article
                            className={`match-card tournament-match-card ${
                              match.isBye ? 'bye-match' : ''
                            }`}
                            key={match.id}
                          >
                            <header>
                              <span>
                                {roundTimeRange(tournamentSettings.startTime, match.round)} ·{' '}
                                {match.court}코트 · {match.label}
                                {match.teamBattleSlot
                                  ? ` · ${match.teamBattleSlot}`
                                  : ''}
                              </span>
                              <div className="match-card-actions">
                                <strong>{tournamentMatchPhaseLabel(match)}</strong>
                                {match.isBye ? <strong>부전승</strong> : null}
                              </div>
                            </header>
                            <div
                              className={`score-row ${
                                !canEditResult ? 'read-only-score' : ''
                              }`}
                            >
                              {renderTournamentSide(match, 'A')}
                              {canEditResult ? (
                                <input
                                  className="score-input"
                                  aria-label={`${tournamentSideName(match, 'A')} 점수`}
                                  type="number"
                                  min="0"
                                  value={result.teamAScore}
                                  onChange={(event) =>
                                    updateTournamentResult(match.id, {
                                      teamAScore: event.target.value,
                                    })
                                  }
                                />
                              ) : (
                                <span className="score-value">
                                  {match.isBye ? 'BYE' : result.teamAScore || '-'}
                                </span>
                              )}
                            </div>
                            <div
                              className={`score-row ${
                                !canEditResult ? 'read-only-score' : ''
                              }`}
                            >
                              {renderTournamentSide(match, 'B')}
                              {canEditResult ? (
                                <input
                                  className="score-input"
                                  aria-label={`${tournamentSideName(match, 'B')} 점수`}
                                  type="number"
                                  min="0"
                                  value={result.teamBScore}
                                  onChange={(event) =>
                                    updateTournamentResult(match.id, {
                                      teamBScore: event.target.value,
                                    })
                                  }
                                />
                              ) : (
                                <span className="score-value">
                                  {match.isBye ? '-' : result.teamBScore || '-'}
                                </span>
                              )}
                            </div>
                            {renderTournamentLineupEditor(match, canEditResult)}
                            <div className="match-footer">
                              {canEditResult ? (
                                <label className="checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={result.completed}
                                    disabled={!tournamentHasScore(result)}
                                    onChange={(event) =>
                                      updateTournamentResult(match.id, {
                                        completed: event.target.checked,
                                      })
                                    }
                                  />
                                  완료
                                </label>
                              ) : (
                                <span>
                                  {tournamentWinnerTeamId(match, result)
                                    ? '완료'
                                    : '대기'}
                                </span>
                              )}
                              <span>{tournamentWinnerLabel(match, result)}</span>
                            </div>
                            {canEditResult ? (
                              <input
                                className="note-input"
                                placeholder="메모"
                                value={result.note}
                                onChange={(event) =>
                                  updateTournamentResult(match.id, {
                                    note: event.target.value,
                                  })
                                }
                              />
                            ) : result.note ? (
                              <div className="note-readonly">{result.note}</div>
                            ) : null}
                          </article>
                        )
                      })}
                    </div>
                    ) : (
                      <div className="collapsed-summary">
                        경기 {matches.length}개 · 코트 {new Set(matches.map((match) => match.court)).size}개
                      </div>
                    )}
                  </section>
                  )
                })}
              </div>
            ) : (
              <section className="tournament-board" id="tournament-board">
                {tournamentSettings.format === 'group-knockout' ? (
                  <div className="board-section">
                    <div className="section-heading">
                      <h2>조별 순위</h2>
                      <span>
                        상위 {tournamentSettings.advancePerGroup}팀 넉아웃 진출
                      </span>
                    </div>
                    <div className="standings-grid">
                      {tournamentSchedule.groups.map((group) => (
                        <div className="stats-table-wrap" key={group.id}>
                          <table className="stats-table compact-table">
                            <thead>
                              <tr>
                                <th>{group.name}</th>
                                <th>승</th>
                                <th>패</th>
                                <th>득실</th>
                                <th>득점</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tournamentSchedule.standings
                                .filter((standing) => standing.groupId === group.id)
                                .map((standing) => (
                                  <tr key={standing.team.id}>
                                    <td>
                                      {standing.rank}. {standing.team.name}
                                    </td>
                                    <td>{standing.wins}</td>
                                    <td>{standing.losses}</td>
                                    <td>{standing.pointDiff}</td>
                                    <td>{standing.pointsFor}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {tournamentSchedule.knockoutMatches.length > 0 ? (
                  <div className="board-section">
                    <div className="section-heading">
                      <h2>브래킷</h2>
                      <span>결과 입력 시 다음 경기 자동 배정</span>
                    </div>
                    <div className="bracket-list">
                      {tournamentSchedule.knockoutMatches.map((match) => {
                        const result = tournamentResults[match.id]

                        return (
                          <article className="bracket-item" key={match.id}>
                            <strong>{match.label}</strong>
                            <span>
                              {tournamentSideName(match, 'A')} vs{' '}
                              {tournamentSideName(match, 'B')}
                            </span>
                            <em>{tournamentWinnerLabel(match, result)}</em>
                          </article>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                {isTeamBattleTournamentFormat(tournamentSettings.format) ? (
                  <>
                    <div className="board-section">
                      <div className="section-heading">
                        <h2>{tournamentFormatLabels[tournamentSettings.format]} 순위</h2>
                        <span>
                          {isFriendlyTournamentFormat(tournamentSettings.format)
                            ? '세부 승패 · 총 득실 · MVP 후보'
                            : '세부 경기 승수 합산'}
                        </span>
                      </div>
                      <div className="stats-table-wrap">
                        <table className="stats-table">
                          <thead>
                            {isFriendlyTournamentFormat(tournamentSettings.format) ? (
                              <tr>
                                <th>팀</th>
                                <th>세부승</th>
                                <th>세부패</th>
                                <th>총 득점</th>
                                <th>총 실점</th>
                                <th>득실차</th>
                                <th>MVP 후보</th>
                              </tr>
                            ) : (
                              <tr>
                                <th>팀</th>
                                <th>단체승</th>
                                <th>단체패</th>
                                <th>세부승</th>
                                <th>세부패</th>
                                <th>득실</th>
                              </tr>
                            )}
                          </thead>
                          <tbody>
                            {tournamentSchedule.teamBattleStandings.map((standing) => (
                              <tr key={standing.team.id}>
                                <td>
                                  {standing.rank}. {standing.team.name}
                                </td>
                                {isFriendlyTournamentFormat(tournamentSettings.format) ? (
                                  <>
                                    <td>{standing.matchWins}</td>
                                    <td>{standing.matchLosses}</td>
                                    <td>{standing.pointsFor}</td>
                                    <td>{standing.pointsAgainst}</td>
                                    <td>{signedNumber(standing.pointDiff)}</td>
                                    <td>{tournamentMvpCandidates[standing.team.id] ?? '대기'}</td>
                                  </>
                                ) : (
                                  <>
                                    <td>{standing.tiesWon}</td>
                                    <td>{standing.tiesLost}</td>
                                    <td>{standing.matchWins}</td>
                                    <td>{standing.matchLosses}</td>
                                    <td>{signedNumber(standing.pointDiff)}</td>
                                  </>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="board-section">
                      <div className="section-heading">
                        <h2>팀 대전</h2>
                        <span>{tournamentSettings.teamBattleMatchCount}경기제</span>
                      </div>
                      <div className="bracket-list">
                        {tournamentSchedule.teamBattleTies.map((tie) => (
                          <article className="bracket-item" key={tie.id}>
                            <strong>{tie.label}</strong>
                            <span>
                              {tie.teamAWins} - {tie.teamBWins}
                            </span>
                            <em>
                              {tie.winnerTeamId
                                ? tournamentTeamName(tie.winnerTeamId)
                                : '대기'}
                            </em>
                          </article>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
              </section>
            )}
          </section>
        </main>
      )}
      <footer className="app-footer">
        <p>© 2026 ROUM S &amp; E Co., Ltd. All rights reserved.</p>
        <span>
          최종 수정일 {LAST_UPDATED} · 버전 {APP_VERSION}
        </span>
      </footer>
    </div>
  )
}

export default App
