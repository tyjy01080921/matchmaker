import { getBookingDurationMinutes } from '../scheduleTime'
import { isPreferredPartnerPair } from '../preferredPartners'
import type {
  Match,
  MatchSettings,
  Player,
  Schedule,
  WaitLimitParticipantViolation,
} from '../types'
import {
  MEETING_MAX_GROUP_MEETINGS,
  MEETING_MAX_STANDARD_GAME_SPREAD,
  MEETING_MAX_WAIT_MINUTES,
  MEETING_SKILL_CAUTION_GAP,
  MEETING_SKILL_DANGER_GAP,
  MEETING_TIGHT_GAME_MINIMUM,
  MEETING_TIGHT_GAME_TARGET,
} from './rules'
import {
  attendanceTargetGameCount,
  findMeetingConsecutiveGameLimitViolations,
  isPlayerAvailableForMeetingSlot,
  resolveMeetingAttendanceWindow,
} from '../meetingAvailability'

type TimeWindow = { start: number; end: number }

export type MeetingV2Metrics = {
  structuralIssues: string[]
  successIssues: string[]
  qualityIssues: string[]
  gameCounts: Record<string, number>
  tightGameCounts: Record<string, number>
  standardGameSpread: number
  zeroGameStandardParticipants: number
  warmupMatches: number
  tightMatches: number
  participantsBelowTightMinimum: number
  participantsAtTightTarget: number
  postWarmupSameGenderMatches: number
  postWarmupBalancedMixedMatches: number
  postWarmupGenderExceptionMatches: number
  genderUnknownParticipants: number
  maximumWaitMinutes: number
  maximumInitialWaitMinutes: number
  maximumBetweenWaitMinutes: number
  maximumFinalIdleMinutes: number
  participantsOverWaitLimit: number
  participantViolations: WaitLimitParticipantViolation[]
  maximumGroupMeetings: number
  repeatedGroupAssignments: number
  maximumPartnerMeetings: number
  repeatedPartnerAssignments: number
  maximumOpponentMeetings: number
  repeatedOpponentAssignments: number
  skillCautionMatches: number
  skillDangerMatches: number
  postWarmupSkillCautionMatches: number
  postWarmupSkillDangerMatches: number
  averageWaitMinutes: number
  attendanceTargetDeficitCount: number
  priorityAttendanceTargetDeficitCount: number
}

const matchPlayers = (match: Match) => [...match.teamA, ...match.teamB]

const matchWindow = (match: Match): TimeWindow => {
  const start = match.startOffsetMinutes ?? (match.round - 1) * 15
  return { start, end: start + (match.durationMinutes ?? 15) }
}

const windowsOverlap = (left: TimeWindow, right: TimeWindow) =>
  left.start < right.end && right.start < left.end

const pairKey = (left: string, right: string) =>
  [left, right].sort().join('__')

const groupKey = (players: Player[]) =>
  players.map((player) => player.id).sort().join('__')

const increment = (counts: Map<string, number>, key: string) => {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

const repeatMetrics = (counts: Map<string, number>) => {
  const values = [...counts.values()]
  return {
    maximum: Math.max(0, ...values),
    repeated: values.reduce((sum, count) => sum + Math.max(0, count - 1), 0),
  }
}

const playerTierScore = (player: Player, settings: MatchSettings) => {
  if (player.level === '스페셜') return 108
  if (player.level === 'OA' || player.level === 'O') return 94
  if (typeof player.matchLevelTier === 'number') {
    return 110 - player.matchLevelTier * 10
  }
  const ageGroup = player.ageGroup === '무관' ? '30대' : player.ageGroup
  const tierTable = settings.levelTiers[ageGroup]
  if (player.gender === 'male' || player.gender === 'female') {
    return 110 - tierTable[player.gender][player.level] * 10
  }
  const averageTier =
    (tierTable.male[player.level] + tierTable.female[player.level]) / 2
  return 110 - averageTier * 10
}

const fixedSkillSpread = (match: Match, settings: MatchSettings) => {
  if (match.isSpecial) return 0
  const scores = matchPlayers(match)
    .filter((player) => player.level !== 'O')
    .map((player) => playerTierScore(player, settings))
  return scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0
}

const teamRange = (team: Match['teamA'], settings: MatchSettings) => {
  let minimum = 0
  let maximum = 0
  for (const player of team) {
    if (player.level === 'O') {
      maximum += 100
    } else {
      const score = playerTierScore(player, settings)
      minimum += score
      maximum += score
    }
  }
  return { minimum, maximum }
}

const teamSkillGap = (match: Match, settings: MatchSettings) => {
  if (match.isSpecial) return 0
  const left = teamRange(match.teamA, settings)
  const right = teamRange(match.teamB, settings)
  if (left.maximum < right.minimum) return right.minimum - left.maximum
  if (right.maximum < left.minimum) return left.minimum - right.maximum
  return 0
}

const matchSkillGap = (match: Match, settings: MatchSettings) =>
  Math.max(fixedSkillSpread(match, settings), teamSkillGap(match, settings))

type MeetingGenderKind = 'same' | 'mixed' | 'exception' | 'unknown'

const teamIsMixed = (team: Match['teamA']) =>
  team.some((player) => player.gender === 'male') &&
  team.some((player) => player.gender === 'female')

const matchGenderKind = (match: Match): MeetingGenderKind => {
  const regulars = matchPlayers(match).filter((player) => !player.isGuest)
  if (regulars.some((player) => player.gender === 'none')) return 'unknown'
  const men = regulars.filter((player) => player.gender === 'male').length
  const women = regulars.filter((player) => player.gender === 'female').length
  if (men === 0 || women === 0) return 'same'
  if (
    regulars.length === 4 &&
    men === 2 &&
    women === 2 &&
    teamIsMixed(match.teamA) &&
    teamIsMixed(match.teamB)
  ) {
    return 'mixed'
  }
  return 'exception'
}

const playerAnalysisEnd = (
  player: Player,
  windows: TimeWindow[],
  bookingMinutes: number,
  settings: MatchSettings,
) => {
  const continuousSpecialWindow = Boolean(
    player.isGuest &&
      settings.specialLimitEnabled &&
      settings.specialScheduleMode !== 'spread' &&
      settings.specialTimeLimitEnabled,
  )
  return continuousSpecialWindow && windows.length > 0
    ? windows[windows.length - 1].end
    : bookingMinutes
}

const waitDetails = (
  player: Player,
  matches: Match[],
  bookingMinutes: number,
  settings: MatchSettings,
) => {
  const attendance = resolveMeetingAttendanceWindow(player, settings)
  const playerMatches = matches
    .filter((match) => matchPlayers(match).some((candidate) => candidate.id === player.id))
    .sort(
      (left, right) =>
        matchWindow(left).start - matchWindow(right).start ||
        left.id.localeCompare(right.id),
    )
  const windows = playerMatches.map(matchWindow)
  const analysisEnd = Math.min(
    attendance.end,
    playerAnalysisEnd(
      player,
      windows,
      bookingMinutes,
      settings,
    ),
  )
  if (windows.length === 0) {
    const unattendedMinutes = Math.max(0, analysisEnd - attendance.start)
    return {
      initial: unattendedMinutes,
      between: 0,
      final: unattendedMinutes,
      maximum: unattendedMinutes,
      average: unattendedMinutes,
      violation:
        unattendedMinutes > MEETING_MAX_WAIT_MINUTES
          ? ({
              playerId: player.id,
              waitMinutes: unattendedMinutes,
              phase: 'unassigned',
            } satisfies WaitLimitParticipantViolation)
          : null,
    }
  }

  const operationalGaps: Array<{
    waitMinutes: number
    phase: WaitLimitParticipantViolation['phase']
    previousMatchId?: string
    nextMatchId?: string
  }> = [
    {
      waitMinutes: Math.max(0, windows[0].start - attendance.start),
      phase: 'initial',
      nextMatchId: playerMatches[0].id,
    },
  ]
  for (let index = 1; index < windows.length; index += 1) {
    operationalGaps.push({
      waitMinutes: Math.max(0, windows[index].start - windows[index - 1].end),
      phase: 'between',
      previousMatchId: playerMatches[index - 1].id,
      nextMatchId: playerMatches[index].id,
    })
  }
  const finalIdleMinutes = Math.max(
    0,
    analysisEnd - windows[windows.length - 1].end,
  )
  const maximumGap = [...operationalGaps].sort(
    (left, right) => right.waitMinutes - left.waitMinutes,
  )[0]
  return {
    initial: operationalGaps[0].waitMinutes,
    between: Math.max(
      0,
      ...operationalGaps
        .filter((gap) => gap.phase === 'between')
        .map((gap) => gap.waitMinutes),
    ),
    final: finalIdleMinutes,
    maximum: maximumGap.waitMinutes,
    average:
      operationalGaps.reduce((sum, gap) => sum + gap.waitMinutes, 0) /
      operationalGaps.length,
    violation:
      maximumGap.waitMinutes > MEETING_MAX_WAIT_MINUTES
        ? ({
            playerId: player.id,
            waitMinutes: maximumGap.waitMinutes,
            phase: maximumGap.phase,
            previousMatchId: maximumGap.previousMatchId,
            nextMatchId: maximumGap.nextMatchId,
          } satisfies WaitLimitParticipantViolation)
        : null,
  }
}

export const analyzeMeetingScheduleV2 = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
  options: {
    allowedAttendanceMatchIds?: Iterable<string>
    allowedConsecutiveMatchIds?: Iterable<string>
  } = {},
): MeetingV2Metrics => {
  const matches = schedule.rounds.flatMap((round) => round.matches)
  const activePlayers = players.filter((player) => player.active)
  const activeIds = new Set(activePlayers.map((player) => player.id))
  const allowedAttendanceMatchIds = new Set(
    options.allowedAttendanceMatchIds ?? [],
  )
  const allowedConsecutiveMatchIds = new Set(
    options.allowedConsecutiveMatchIds ?? [],
  )
  const structuralIssues = new Set<string>()
  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
  )

  for (const match of matches) {
    const assignedPlayers = matchPlayers(match)
    const window = matchWindow(match)
    if (
      assignedPlayers.length !== 4 ||
      new Set(assignedPlayers.map((player) => player.id)).size !== 4
    ) {
      structuralIssues.add('경기 인원 구성 오류')
    }
    if (assignedPlayers.some((player) => !activeIds.has(player.id))) {
      structuralIssues.add('비활성 참가자 배정')
    }
    if (match.court < 1 || match.court > settings.courtCount) {
      structuralIssues.add('코트 번호 오류')
    }
    if (window.start < 0 || window.end > bookingMinutes) {
      structuralIssues.add('운영 시간 초과')
    }
    if (
      settings.singleGuestPerMatch &&
      assignedPlayers.filter((player) => player.isGuest).length > 1
    ) {
      structuralIssues.add('스페셜 인원 제한 위반')
    }
    if (
      !allowedAttendanceMatchIds.has(match.id) &&
      assignedPlayers.some((player) =>
        !isPlayerAvailableForMeetingSlot(
          player,
          settings,
          window.start,
          window.end - window.start,
        ),
      )
    ) {
      structuralIssues.add('참석 시간 외 배정')
    }
  }

  for (let left = 0; left < matches.length; left += 1) {
    const leftPlayers = new Set(matchPlayers(matches[left]).map((player) => player.id))
    for (let right = left + 1; right < matches.length; right += 1) {
      if (!windowsOverlap(matchWindow(matches[left]), matchWindow(matches[right]))) {
        continue
      }
      if (matches[left].court === matches[right].court) {
        structuralIssues.add('코트 시간 중복')
      }
      if (matchPlayers(matches[right]).some((player) => leftPlayers.has(player.id))) {
        structuralIssues.add('참가자 동시간 중복')
      }
    }
  }
  if (
    findMeetingConsecutiveGameLimitViolations(schedule).some(
      (violation) => !allowedConsecutiveMatchIds.has(violation.matchId),
    )
  ) {
    structuralIssues.add('연속 경기 제한 위반')
  }

  const gameCounts = Object.fromEntries(activePlayers.map((player) => [player.id, 0]))
  const tightGameCounts = Object.fromEntries(
    activePlayers.map((player) => [player.id, 0]),
  )
  const groupCounts = new Map<string, number>()
  const partnerCounts = new Map<string, number>()
  const opponentCounts = new Map<string, number>()
  let skillCautionMatches = 0
  let skillDangerMatches = 0
  let postWarmupSkillCautionMatches = 0
  let postWarmupSkillDangerMatches = 0
  let warmupMatches = 0
  let tightMatches = 0
  let postWarmupSameGenderMatches = 0
  let postWarmupBalancedMixedMatches = 0
  let postWarmupGenderExceptionMatches = 0
  const orderedMatches = [...matches].sort(
    (left, right) =>
      matchWindow(left).start - matchWindow(right).start ||
      left.court - right.court ||
      left.id.localeCompare(right.id),
  )
  for (const match of orderedMatches) {
    const assignedPlayers = matchPlayers(match)
    const regulars = assignedPlayers.filter((player) => !player.isGuest)
    const isWarmup =
      !match.isSpecial &&
      regulars.some((player) => (gameCounts[player.id] ?? 0) === 0)
    const genderKind = matchGenderKind(match)
    const skillGap = matchSkillGap(match, settings)
    const isTight =
      !match.isSpecial &&
      !isWarmup &&
      skillGap < MEETING_SKILL_CAUTION_GAP &&
      genderKind !== 'exception'
    if (isWarmup) warmupMatches += 1
    if (!match.isSpecial && !isWarmup) {
      if (genderKind === 'same') postWarmupSameGenderMatches += 1
      if (genderKind === 'mixed') postWarmupBalancedMixedMatches += 1
      if (genderKind === 'exception') postWarmupGenderExceptionMatches += 1
    }
    if (isTight) {
      tightMatches += 1
      for (const player of regulars) {
        tightGameCounts[player.id] = (tightGameCounts[player.id] ?? 0) + 1
      }
    }
    for (const player of assignedPlayers) {
      gameCounts[player.id] = (gameCounts[player.id] ?? 0) + 1
    }
    increment(groupCounts, groupKey(assignedPlayers))
    if (!isPreferredPartnerPair(match.teamA[0], match.teamA[1])) {
      increment(partnerCounts, pairKey(match.teamA[0].id, match.teamA[1].id))
    }
    if (!isPreferredPartnerPair(match.teamB[0], match.teamB[1])) {
      increment(partnerCounts, pairKey(match.teamB[0].id, match.teamB[1].id))
    }
    for (const left of match.teamA) {
      for (const right of match.teamB) {
        increment(opponentCounts, pairKey(left.id, right.id))
      }
    }
    if (skillGap >= MEETING_SKILL_CAUTION_GAP) skillCautionMatches += 1
    if (skillGap > MEETING_SKILL_DANGER_GAP) skillDangerMatches += 1
    if (!match.isSpecial && !isWarmup) {
      if (skillGap >= MEETING_SKILL_CAUTION_GAP) {
        postWarmupSkillCautionMatches += 1
      }
      if (skillGap > MEETING_SKILL_DANGER_GAP) {
        postWarmupSkillDangerMatches += 1
      }
    }
  }

  const standardPlayers = activePlayers.filter(
    (player) =>
      !player.isGuest &&
      !player.gameCountFlexible &&
      !resolveMeetingAttendanceWindow(player, settings).isCustom,
  )
  const standardCounts = standardPlayers.map((player) => gameCounts[player.id] ?? 0)
  const standardGameSpread = standardCounts.length > 0
    ? Math.max(...standardCounts) - Math.min(...standardCounts)
    : 0
  const zeroGameStandardParticipants = standardCounts.filter((count) => count === 0).length
  const standardTightCounts = standardPlayers.map(
    (player) => tightGameCounts[player.id] ?? 0,
  )
  const participantsBelowTightMinimum = standardTightCounts.filter(
    (count) => count < MEETING_TIGHT_GAME_MINIMUM,
  ).length
  const participantsAtTightTarget = standardTightCounts.filter(
    (count) => count >= MEETING_TIGHT_GAME_TARGET,
  ).length
  const genderUnknownParticipants = standardPlayers.filter(
    (player) => player.gender === 'none',
  ).length
  const activeRegulars = activePlayers.filter((player) => !player.isGuest)
  const regularAppearances = activeRegulars.reduce(
    (sum, player) => sum + (gameCounts[player.id] ?? 0),
    0,
  )
  const fullAttendanceTarget = activeRegulars.length > 0
    ? regularAppearances / activeRegulars.length
    : 0
  const timedTargets = activeRegulars
    .filter((player) => {
      const attendance = resolveMeetingAttendanceWindow(player, settings)
      return attendance.isCustom || attendance.priority
    })
    .map((player) => {
      const attendance = resolveMeetingAttendanceWindow(player, settings)
      const maximumOpportunities = Math.max(
        0,
        Math.floor(attendance.duration / settings.normalGameMinutes),
      )
      const target = attendanceTargetGameCount(
        player,
        settings,
        fullAttendanceTarget,
        maximumOpportunities,
      )
      return {
        player,
        target,
        deficit: Math.max(0, target - (gameCounts[player.id] ?? 0)),
      }
    })
  const attendanceTargetDeficitCount = timedTargets.filter(
    (item) => item.deficit > 0,
  ).length
  const priorityAttendanceTargetDeficitCount = timedTargets.filter(
    (item) => item.player.attendancePriority && item.deficit > 0,
  ).length
  const waits = activePlayers.map((player) =>
    waitDetails(player, matches, bookingMinutes, settings),
  )
  const participantViolations = waits
    .map((wait) => wait.violation)
    .filter(
      (violation): violation is WaitLimitParticipantViolation =>
        violation !== null,
    )
    .sort(
      (left, right) =>
        right.waitMinutes - left.waitMinutes ||
        left.playerId.localeCompare(right.playerId),
    )
  const groupMetrics = repeatMetrics(groupCounts)
  const partnerMetrics = repeatMetrics(partnerCounts)
  const opponentMetrics = repeatMetrics(opponentCounts)
  const successIssues: string[] = []
  const qualityIssues: string[] = []
  if (zeroGameStandardParticipants > 0) {
    successIssues.push(`0경기 일반 참가자 ${zeroGameStandardParticipants}명`)
  }
  if (standardGameSpread > MEETING_MAX_STANDARD_GAME_SPREAD) {
    successIssues.push(`일반 참가자 경기 수 차 ${standardGameSpread}경기`)
  }
  if (participantViolations.length > 0) {
    successIssues.push(
      `최장 대기 ${Math.max(...participantViolations.map((item) => item.waitMinutes))}분`,
    )
  }
  if (groupMetrics.maximum > MEETING_MAX_GROUP_MEETINGS) {
    successIssues.push(`동일 4인 최대 ${groupMetrics.maximum}경기`)
  }
  if (participantsBelowTightMinimum > 0) {
    qualityIssues.push(
      `타이트 경기 ${MEETING_TIGHT_GAME_MINIMUM}회 미달 ${participantsBelowTightMinimum}명`,
    )
  }
  if (postWarmupGenderExceptionMatches > 0) {
    qualityIssues.push(
      `워밍업 이후 성별 예외 ${postWarmupGenderExceptionMatches}경기`,
    )
  }
  if (genderUnknownParticipants > 0) {
    qualityIssues.push(`성별 정보 없음 ${genderUnknownParticipants}명`)
  }
  if (attendanceTargetDeficitCount > 0) {
    qualityIssues.push(`참석 시간 목표 미달 ${attendanceTargetDeficitCount}명`)
  }
  if (priorityAttendanceTargetDeficitCount > 0) {
    qualityIssues.push(
      `우선 배정 목표 미달 ${priorityAttendanceTargetDeficitCount}명`,
    )
  }

  return {
    structuralIssues: [...structuralIssues],
    successIssues,
    qualityIssues,
    gameCounts,
    tightGameCounts,
    standardGameSpread,
    zeroGameStandardParticipants,
    warmupMatches,
    tightMatches,
    participantsBelowTightMinimum,
    participantsAtTightTarget,
    postWarmupSameGenderMatches,
    postWarmupBalancedMixedMatches,
    postWarmupGenderExceptionMatches,
    genderUnknownParticipants,
    maximumWaitMinutes: Math.max(0, ...waits.map((wait) => wait.maximum)),
    maximumInitialWaitMinutes: Math.max(0, ...waits.map((wait) => wait.initial)),
    maximumBetweenWaitMinutes: Math.max(0, ...waits.map((wait) => wait.between)),
    maximumFinalIdleMinutes: Math.max(0, ...waits.map((wait) => wait.final)),
    participantsOverWaitLimit: participantViolations.length,
    participantViolations,
    maximumGroupMeetings: groupMetrics.maximum,
    repeatedGroupAssignments: groupMetrics.repeated,
    maximumPartnerMeetings: partnerMetrics.maximum,
    repeatedPartnerAssignments: partnerMetrics.repeated,
    maximumOpponentMeetings: opponentMetrics.maximum,
    repeatedOpponentAssignments: opponentMetrics.repeated,
    skillCautionMatches,
    skillDangerMatches,
    postWarmupSkillCautionMatches,
    postWarmupSkillDangerMatches,
    averageWaitMinutes:
      waits.length > 0
        ? waits.reduce((sum, wait) => sum + wait.average, 0) / waits.length
        : 0,
    attendanceTargetDeficitCount,
    priorityAttendanceTargetDeficitCount,
  }
}

export const validateMeetingScheduleV2 = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
) => analyzeMeetingScheduleV2(schedule, players, settings).structuralIssues

export const validateMeetingSuccessV2 = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
) => analyzeMeetingScheduleV2(schedule, players, settings).successIssues
