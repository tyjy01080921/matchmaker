import type {
  Match,
  MatchSettings,
  MeetingWaitLimitFailure,
  Player,
  Round,
  Schedule,
  Team,
} from '../types'
import {
  isPreferredPartnerPair,
  preferredPartnerBonusStage,
  preferredPartnerStrength,
} from '../preferredPartners'
import {
  MEETING_MAX_GROUP_MEETINGS,
  MEETING_MAX_WAIT_MINUTES,
  MEETING_SKILL_CAUTION_GAP,
  MEETING_SKILL_DANGER_GAP,
  MEETING_TIGHT_GAME_MINIMUM,
  meetingSchedulingMinutes,
  plannedGuestGames,
  preflightMeetingGeneration,
  resolveMeetingRuleProfile,
  specialParticipantTarget,
  type MeetingPreferenceKey,
  type MeetingRuleProfile,
} from './rules'
import {
  analyzeMeetingScheduleV2,
  type MeetingV2Metrics,
} from './validation'
import {
  MAX_BOOKING_MINUTES,
  clockTimeAtOffset,
  getBookingDurationMinutes,
  getBookingRoundCount,
} from '../scheduleTime'
import {
  attendanceTargetGameCount,
  isPlayerAvailableForMeetingSlot,
  maximumConsecutiveMeetingGames,
  resolveMeetingAttendanceWindow,
  usesMeetingAttendanceGameLimit,
  type MeetingAttendanceWindow,
} from '../meetingAvailability'

export type MeetingSlotKind = 'general' | 'special'

export type PlannedMeetingSlot = {
  id: string
  court: number
  start: number
  duration: number
  kind: MeetingSlotKind
  guestId?: string
  roamingGuestId?: string
  plannedPlayerIds?: string[]
}

type SpecialReservation = PlannedMeetingSlot & {
  kind: 'special'
  guestId: string
  roamingGuestId?: string
}

type EngineState = {
  clubQualityEnabled: boolean
  games: Map<string, number>
  tightGames: Map<string, number>
  generalGames: Map<string, number>
  specialGames: Map<string, number>
  guestGames: Map<string, number>
  availableAt: Map<string, number>
  lastEnd: Map<string, number>
  consecutiveGames: Map<string, number>
  groups: Map<string, number>
  partners: Map<string, number>
  opponents: Map<string, number>
  specialParticipantIds: Set<string>
  plannedSpecialStarts: Map<string, number[]>
  remainingPlannedSpecials: Map<string, number>
  initialSpecialReservedIds: Set<string>
  initialSpecialFillerIds: Set<string>
  playOpportunityStarts: Map<string, number[]>
  attendanceWindows: Map<string, MeetingAttendanceWindow>
  attendanceTargets: Map<string, number>
  maximumStandardGames: number | null
  strictCautionMatches: number
}

type PairingChoice = {
  teamA: Team
  teamB: Team
  teamSkillGap: number
  fixedSkillSpread: number
  partnerRepeats: number
  opponentRepeats: number
  preferredPartners: number
}

type GroupCandidate = {
  players: [Player, Player, Player, Player]
  pairing: PairingChoice
  score: number[]
  skillGap: number
  isWarmup: boolean
  isTight: boolean
  genderTier: 0 | 1 | 2
}

type BatchSelection = {
  slot: PlannedMeetingSlot
  candidate: GroupCandidate
}

type BatchBeam = {
  selections: BatchSelection[]
  usedIds: Set<string>
  score: number[]
  cautionMatches: number
}

type GenerationCandidate = {
  schedule: Schedule
  metrics: MeetingV2Metrics
  index: number
}

const MAX_GROUP_CANDIDATES = 8
const MAX_PLAYER_POOL = 12
const MAX_BATCH_BEAM = 4

const pairKey = (left: string, right: string) =>
  [left, right].sort().join('__')

const groupKey = (players: Player[]) =>
  players.map((player) => player.id).sort().join('__')

const compareNumberTuples = (left: number[], right: number[]) => {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

const addNumberTuples = (left: number[], right: number[]) => {
  const length = Math.max(left.length, right.length)
  return Array.from(
    { length },
    (_, index) => (left[index] ?? 0) + (right[index] ?? 0),
  )
}

const stableNoise = (seed: number, value: string) => {
  let hash = Math.floor(seed) | 0
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  }
  hash ^= hash >>> 16
  return (hash >>> 0) / 4294967296
}

const increment = (counts: Map<string, number>, key: string) => {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

const hasOverlap = (
  left: Pick<PlannedMeetingSlot, 'start' | 'duration'>,
  right: Pick<PlannedMeetingSlot, 'start' | 'duration'>,
) =>
  left.start < right.start + right.duration &&
  right.start < left.start + left.duration

const distributeSpecialChunks = (
  activePlayers: Player[],
  settings: MatchSettings,
  specialCourtCount: number,
  specialWindowMinutes: number,
): SpecialReservation[] => {
  const gameMinutes = settings.normalGameMinutes
  const guests = activePlayers.filter((player) => player.isGuest)
  const requests = guests.flatMap((guest) => {
    const attendance = resolveMeetingAttendanceWindow(guest, settings)
    const guestWindowEnd = Math.min(attendance.end, specialWindowMinutes)
    const target = Math.min(
      plannedGuestGames(guest, activePlayers, settings),
      Math.max(
        0,
        Math.floor((guestWindowEnd - attendance.start) / gameMinutes),
      ),
    )
    return Array.from({ length: target }, (_, index) => ({
      guest,
      windowEnd: guestWindowEnd,
      desiredStart: target <= 1
        ? attendance.start
        : Math.round(
            attendance.start +
            (guestWindowEnd - attendance.start - gameMinutes) *
              index /
              (target - 1),
          ),
    }))
  })
    .sort(
      (left, right) =>
        left.desiredStart - right.desiredStart ||
        left.guest.id.localeCompare(right.guest.id),
    )
  if (requests.length === 0 || specialCourtCount === 0) return []

  const courtAvailableAt = Array.from({ length: specialCourtCount }, () => 0)
  const courtAssignedCount = Array.from({ length: specialCourtCount }, () => 0)
  const courtQuotas = Array.from(
    { length: specialCourtCount },
    (_, index) =>
      Math.floor(requests.length / specialCourtCount) +
      Number(index < requests.length % specialCourtCount),
  )
  const guestAvailableAt = new Map(
    guests.map((guest) => [
      guest.id,
      resolveMeetingAttendanceWindow(guest, settings).start,
    ]),
  )
  const reservations: SpecialReservation[] = []

  requests.forEach((request) => {
    const courtChoice = courtAvailableAt
      .flatMap((availableAt, courtIndex) => {
        if (courtAssignedCount[courtIndex] >= courtQuotas[courtIndex]) return []
        const minimumStart = Math.max(
          availableAt,
          guestAvailableAt.get(request.guest.id) ?? 0,
        )
        const minimumStep = Math.max(
          0,
          Math.ceil((minimumStart - availableAt) / settings.normalGameMinutes),
        )
        const requestedStep = Math.max(
          minimumStep,
          Math.round(
            (request.desiredStart - availableAt) / settings.normalGameMinutes,
          ),
        )
        const guestLastEnd = guestAvailableAt.get(request.guest.id) ?? 0
        const maximumWaitStep = Math.floor(
          (guestLastEnd + MEETING_MAX_WAIT_MINUTES - availableAt) /
            settings.normalGameMinutes,
        )
        if (maximumWaitStep < minimumStep) return []
        const start = availableAt +
          Math.min(requestedStep, maximumWaitStep) * settings.normalGameMinutes
        const remainingOnCourt =
          courtQuotas[courtIndex] - courtAssignedCount[courtIndex] - 1
        if (
          start + gameMinutes > request.windowEnd ||
          start + gameMinutes * (remainingOnCourt + 1) >
            specialWindowMinutes
        ) {
          return []
        }
        return [{
          courtIndex,
          start,
          distance: Math.abs(start - request.desiredStart),
        }]
      })
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          courtAssignedCount[left.courtIndex] -
            courtAssignedCount[right.courtIndex] ||
          left.start - right.start ||
          left.courtIndex - right.courtIndex,
      )[0]
    if (!courtChoice) return

    reservations.push({
      id: `special-c${courtChoice.courtIndex + 1}-s${courtChoice.start}-${request.guest.id}`,
      court: courtChoice.courtIndex + 1,
      start: courtChoice.start,
      duration: gameMinutes,
      kind: 'special',
      guestId: request.guest.id,
    })
    const endsAt = courtChoice.start + gameMinutes
    courtAvailableAt[courtChoice.courtIndex] = endsAt
    courtAssignedCount[courtChoice.courtIndex] += 1
    guestAvailableAt.set(request.guest.id, endsAt)
  })

  return reservations
}

const distributeFixedSpecialCourts = (
  activePlayers: Player[],
  settings: MatchSettings,
  specialWindowMinutes: number,
): SpecialReservation[] => {
  const gameMinutes = settings.normalGameMinutes
  const guests = activePlayers.filter((player) => player.isGuest)
  const fixedGuestCount = Math.min(settings.courtCount, guests.length)
  const fixedGuests = guests.slice(0, fixedGuestCount)
  const roamingGuests = guests.slice(fixedGuestCount)
  const reservations = fixedGuests.flatMap((guest, courtIndex) => {
    const attendance = resolveMeetingAttendanceWindow(guest, settings)
    const windowEnd = Math.min(attendance.end, specialWindowMinutes)
    const target = Math.min(
      plannedGuestGames(guest, activePlayers, settings),
      Math.max(0, Math.floor((windowEnd - attendance.start) / gameMinutes)),
    )
    return Array.from({ length: target }, (_, index): SpecialReservation => {
      const start = attendance.start + index * gameMinutes
      return {
        id: `fixed-special-c${courtIndex + 1}-s${start}-${guest.id}`,
        court: courtIndex + 1,
        start,
        duration: gameMinutes,
        kind: 'special',
        guestId: guest.id,
      }
    })
  })
  if (roamingGuests.length === 0 || reservations.length === 0) {
    return reservations
  }

  const remainingGames = new Map(
    roamingGuests.map((guest) => {
      const attendance = resolveMeetingAttendanceWindow(guest, settings)
      const windowEnd = Math.min(attendance.end, specialWindowMinutes)
      return [
        guest.id,
        Math.min(
          plannedGuestGames(guest, activePlayers, settings),
          Math.max(0, Math.floor((windowEnd - attendance.start) / gameMinutes)),
        ),
      ]
    }),
  )
  const assignedGames = new Map(roamingGuests.map((guest) => [guest.id, 0]))
  const availableAt = new Map(
    roamingGuests.map((guest) => [
      guest.id,
      resolveMeetingAttendanceWindow(guest, settings).start,
    ]),
  )
  const starts = [...new Set(reservations.map((slot) => slot.start))]
    .sort((left, right) => left - right)

  starts.forEach((start, startIndex) => {
    const slots = reservations
      .filter((slot) => slot.start === start)
      .sort((left, right) => {
        const leftRotation = (
          left.court - 1 - startIndex + fixedGuestCount
        ) % fixedGuestCount
        const rightRotation = (
          right.court - 1 - startIndex + fixedGuestCount
        ) % fixedGuestCount
        return leftRotation - rightRotation
      })
    const assignedAtStart = new Set<string>()

    for (const slot of slots) {
      const roamingGuest = roamingGuests
        .filter((guest) => {
          const attendance = resolveMeetingAttendanceWindow(guest, settings)
          return (
            !assignedAtStart.has(guest.id) &&
            (remainingGames.get(guest.id) ?? 0) > 0 &&
            (availableAt.get(guest.id) ?? 0) <= start &&
            start >= attendance.start &&
            start + gameMinutes <= Math.min(
              attendance.end,
              specialWindowMinutes,
            )
          )
        })
        .sort(
          (left, right) =>
            (assignedGames.get(left.id) ?? 0) -
              (assignedGames.get(right.id) ?? 0) ||
            stableNoise(settings.seed, `${start}:${slot.court}:${left.id}`) -
              stableNoise(settings.seed, `${start}:${slot.court}:${right.id}`),
        )[0]
      if (!roamingGuest) continue

      slot.roamingGuestId = roamingGuest.id
      slot.id = `${slot.id}-roaming-${roamingGuest.id}`
      assignedAtStart.add(roamingGuest.id)
      remainingGames.set(
        roamingGuest.id,
        (remainingGames.get(roamingGuest.id) ?? 0) - 1,
      )
      assignedGames.set(
        roamingGuest.id,
        (assignedGames.get(roamingGuest.id) ?? 0) + 1,
      )
      availableAt.set(roamingGuest.id, start + gameMinutes)
    }
  })

  return reservations
}

export const planMeetingSlotsV2 = (
  players: Player[],
  settings: MatchSettings,
): PlannedMeetingSlot[] => {
  const activePlayers = players.filter((player) => player.active)
  const activeGuests = activePlayers.filter((player) => player.isGuest)
  const schedulingMinutes = meetingSchedulingMinutes(settings)
  const specialEnabled = activeGuests.length > 0
  const totalSpecialGames = specialEnabled
    ? activeGuests.reduce(
        (sum, guest) => sum + plannedGuestGames(guest, activePlayers, settings),
        0,
      )
    : 0
  const specialCourtCount = totalSpecialGames > 0
    ? Math.min(settings.courtCount, totalSpecialGames)
    : 0
  const specialWindowMinutes =
    settings.specialLimitEnabled &&
    settings.specialScheduleMode !== 'spread' &&
    settings.specialTimeLimitEnabled
      ? Math.min(schedulingMinutes, settings.specialTimeLimitMinutes)
      : schedulingMinutes
  const reservations =
    settings.courtAssignmentMode === 'fixed' && settings.singleGuestPerMatch
      ? distributeFixedSpecialCourts(
          activePlayers,
          settings,
          specialWindowMinutes,
        )
      : distributeSpecialChunks(
          activePlayers,
          settings,
          specialCourtCount,
          specialWindowMinutes,
        )
  const slots: PlannedMeetingSlot[] = [...reservations]

  for (let court = 1; court <= settings.courtCount; court += 1) {
    const courtReservations = reservations
      .filter((slot) => slot.court === court)
      .sort((left, right) => left.start - right.start)
    let cursor = 0
    for (const reservation of courtReservations) {
      while (cursor + settings.normalGameMinutes <= reservation.start) {
        slots.push({
          id: `general-c${court}-s${cursor}`,
          court,
          start: cursor,
          duration: settings.normalGameMinutes,
          kind: 'general',
        })
        cursor += settings.normalGameMinutes
      }
      cursor = Math.max(cursor, reservation.start + reservation.duration)
    }
    while (cursor + settings.normalGameMinutes <= schedulingMinutes) {
      slots.push({
        id: `general-c${court}-s${cursor}`,
        court,
        start: cursor,
        duration: settings.normalGameMinutes,
        kind: 'general',
      })
      cursor += settings.normalGameMinutes
    }
  }

  return slots.sort(
    (left, right) =>
      left.start - right.start ||
      Number(right.kind === 'special') - Number(left.kind === 'special') ||
      left.court - right.court,
  )
}

const initializeState = (
  activePlayers: Player[],
  plannedSlots: PlannedMeetingSlot[],
  settings: MatchSettings,
): EngineState => {
  const plannedSpecialStarts = new Map<string, number[]>()
  for (const slot of plannedSlots.filter(
    (candidate) => candidate.kind === 'special',
  )) {
    const plannedIds = [
      ...(slot.plannedPlayerIds ?? []),
      ...(slot.guestId ? [slot.guestId] : []),
      ...(slot.roamingGuestId ? [slot.roamingGuestId] : []),
    ]
    for (const playerId of plannedIds) {
      plannedSpecialStarts.set(playerId, [
        ...(plannedSpecialStarts.get(playerId) ?? []),
        slot.start,
      ])
    }
  }
  for (const starts of plannedSpecialStarts.values()) {
    starts.sort((left, right) => left - right)
  }
  const generalSlots = plannedSlots.filter((slot) => slot.kind === 'general')
  const playOpportunityStarts = new Map<string, number[]>()
  for (const player of activePlayers.filter((candidate) => !candidate.isGuest)) {
    const plannedStarts = (plannedSpecialStarts.get(player.id) ?? [])
      .filter((start) =>
        isPlayerAvailableForMeetingSlot(
          player,
          settings,
          start,
          settings.normalGameMinutes,
        ),
      )
    const generalStarts = generalSlots
      .filter(
        (slot) =>
          isPlayerAvailableForMeetingSlot(
            player,
            settings,
            slot.start,
            slot.duration,
          ) &&
          !plannedStarts.some(
            (start) =>
              start < slot.start + slot.duration &&
              slot.start < start + settings.normalGameMinutes,
          ),
      )
      .map((slot) => slot.start)
    playOpportunityStarts.set(
      player.id,
      [...new Set([...generalStarts, ...plannedStarts])]
        .sort((left, right) => left - right),
    )
  }
  const standardPlayerCount = activePlayers.filter(
    (player) => !player.isGuest && !player.gameCountFlexible,
  ).length
  const plannedRegularAppearances = plannedSlots.reduce(
    (sum, slot) =>
      sum + (slot.kind === 'general' ? 4 : slot.plannedPlayerIds?.length ?? 0),
    0,
  )
  const firstFollowupSpecial = plannedSlots
    .filter((slot) => slot.kind === 'special' && slot.start > 0)
    .sort((left, right) => left.start - right.start)[0]
  const followupPlannedIds = firstFollowupSpecial?.plannedPlayerIds ?? []
  const regularCount = activePlayers.filter((player) => !player.isGuest).length
  const regularCapacityBeforeFollowup = firstFollowupSpecial
    ? plannedSlots
        .filter((slot) => slot.start < firstFollowupSpecial.start)
        .reduce(
          (sum, slot) =>
            sum + (
              slot.kind === 'general'
                ? 4
                : slot.plannedPlayerIds?.length ?? 0
            ),
          0,
        )
    : regularCount
  const requiredFollowupFirstGames = Math.min(
    followupPlannedIds.length,
    Math.max(0, regularCount - regularCapacityBeforeFollowup),
  )
  const fullAttendanceTarget = regularCount > 0
    ? plannedRegularAppearances / regularCount
    : 0
  const attendanceWindows = new Map(
    activePlayers.map((player) => [
      player.id,
      resolveMeetingAttendanceWindow(player, settings),
    ]),
  )
  const attendanceTargets = new Map(
    activePlayers.map((player) => {
      const opportunities = player.isGuest
        ? plannedSpecialStarts.get(player.id) ?? []
        : playOpportunityStarts.get(player.id) ?? []
      const target = player.isGuest
        ? opportunities.length
        : attendanceTargetGameCount(
            player,
            settings,
            fullAttendanceTarget,
            opportunities.length,
          )
      return [player.id, target]
    }),
  )
  return {
    clubQualityEnabled:
      activePlayers.filter((player) => !player.isGuest).length <= 35 &&
      !activePlayers.some((player) => player.isGuest),
    games: new Map(activePlayers.map((player) => [player.id, 0])),
    tightGames: new Map(activePlayers.map((player) => [player.id, 0])),
    generalGames: new Map(activePlayers.map((player) => [player.id, 0])),
    specialGames: new Map(activePlayers.map((player) => [player.id, 0])),
    guestGames: new Map(
      activePlayers
        .filter((player) => player.isGuest)
        .map((player) => [player.id, 0]),
    ),
    availableAt: new Map(
      activePlayers.map((player) => [
        player.id,
        attendanceWindows.get(player.id)?.start ?? 0,
      ]),
    ),
    lastEnd: new Map(
      activePlayers
        .filter((player) =>
          (attendanceWindows.get(player.id)?.start ?? 0) > 0,
        )
        .map((player) => [
          player.id,
          attendanceWindows.get(player.id)?.start ?? 0,
        ]),
    ),
    consecutiveGames: new Map(activePlayers.map((player) => [player.id, 0])),
    groups: new Map(),
    partners: new Map(),
    opponents: new Map(),
    specialParticipantIds: new Set(),
    plannedSpecialStarts,
    remainingPlannedSpecials: new Map(
      [...plannedSpecialStarts].map(([playerId, starts]) => [
        playerId,
        starts.length,
      ]),
    ),
    initialSpecialReservedIds: new Set(
      followupPlannedIds.slice(0, requiredFollowupFirstGames),
    ),
    initialSpecialFillerIds: new Set(
      followupPlannedIds.slice(requiredFollowupFirstGames),
    ),
    playOpportunityStarts,
    attendanceWindows,
    attendanceTargets,
    maximumStandardGames: standardPlayerCount > 0
      ? Math.ceil(plannedRegularAppearances / standardPlayerCount)
      : null,
    strictCautionMatches: 0,
  }
}

const playerScore = (player: Player, settings: MatchSettings) => {
  if (player.level === '스페셜') return 108
  if (player.level === 'OA' || player.level === 'O') return 94
  if (typeof player.matchLevelTier === 'number') {
    return 110 - player.matchLevelTier * 10
  }
  const ageGroup = player.ageGroup === '무관' ? '30대' : player.ageGroup
  const tiers = settings.levelTiers[ageGroup]
  if (player.gender === 'male' || player.gender === 'female') {
    return 110 - tiers[player.gender][player.level] * 10
  }
  return 110 -
    (tiers.male[player.level] + tiers.female[player.level]) * 5
}

const teamRange = (team: Team, settings: MatchSettings) => {
  let minimum = 0
  let maximum = 0
  for (const player of team) {
    if (player.level === 'O') {
      maximum += 100
    } else {
      const score = playerScore(player, settings)
      minimum += score
      maximum += score
    }
  }
  return { minimum, maximum }
}

const adaptiveTeamGap = (
  teamA: Team,
  teamB: Team,
  settings: MatchSettings,
) => {
  const left = teamRange(teamA, settings)
  const right = teamRange(teamB, settings)
  if (left.maximum < right.minimum) return right.minimum - left.maximum
  if (right.maximum < left.minimum) return left.minimum - right.maximum
  return 0
}

const fixedSkillSpread = (players: Player[], settings: MatchSettings) => {
  const scores = players
    .filter((player) => player.level !== 'O' && !player.isGuest)
    .map((player) => playerScore(player, settings))
  return scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0
}

const teamOptions = (
  players: [Player, Player, Player, Player],
): Array<[Team, Team]> => [
  [[players[0], players[1]], [players[2], players[3]]],
  [[players[0], players[2]], [players[1], players[3]]],
  [[players[0], players[3]], [players[1], players[2]]],
]

const preferredPartnerPriority = (
  teamA: Team,
  teamB: Team,
  state: EngineState,
) =>
  [teamA, teamB].reduce((priority, team) => {
    const [left, right] = team
    const strength = preferredPartnerStrength(left, right)
    if (strength === 0) return priority
    const previousGames = state.partners.get(pairKey(left.id, right.id)) ?? 0
    const stage = preferredPartnerBonusStage(left, right, previousGames)
    if (stage === 'none') return priority
    const basePriority = stage === 'first' ? 2 : 1
    return priority + basePriority * (strength === 2 ? 1.25 : 1)
  }, 0)

const teamIsMixed = (team: Team) =>
  team.some((player) => player.gender === 'male') &&
  team.some((player) => player.gender === 'female')

const genderTierForPairing = (
  players: Player[],
  teamA: Team,
  teamB: Team,
): 0 | 1 | 2 => {
  const regulars = players.filter((player) => !player.isGuest)
  if (regulars.some((player) => player.gender === 'none')) return 1
  const men = regulars.filter((player) => player.gender === 'male').length
  const women = regulars.filter((player) => player.gender === 'female').length
  if (men === 0 || women === 0) return 0
  if (
    regulars.length === 4 &&
    men === 2 &&
    women === 2 &&
    teamIsMixed(teamA) &&
    teamIsMixed(teamB)
  ) {
    return 1
  }
  return 2
}

const pickPairing = (
  players: [Player, Player, Player, Player],
  state: EngineState,
  settings: MatchSettings,
  profile: MeetingRuleProfile,
  isSpecial: boolean,
): PairingChoice => {
  const options = teamOptions(players).map(([teamA, teamB]) => {
    const partnerRepeats =
      (isPreferredPartnerPair(teamA[0], teamA[1])
        ? 0
        : state.partners.get(pairKey(teamA[0].id, teamA[1].id)) ?? 0) +
      (isPreferredPartnerPair(teamB[0], teamB[1])
        ? 0
        : state.partners.get(pairKey(teamB[0].id, teamB[1].id)) ?? 0)
    const opponentRepeats = teamA.reduce(
      (sum, left) =>
        sum + teamB.reduce(
          (inner, right) =>
            inner + (state.opponents.get(pairKey(left.id, right.id)) ?? 0),
          0,
        ),
      0,
    )
    const guestPartnerRepeats = [teamA, teamB].reduce((sum, team) => {
      if (
        !team.some((player) => player.isGuest) ||
        isPreferredPartnerPair(team[0], team[1])
      ) {
        return sum
      }
      return sum + (state.partners.get(pairKey(team[0].id, team[1].id)) ?? 0)
    }, 0)
    const teamSkillGap = adaptiveTeamGap(teamA, teamB, settings)
    const fixedSpread = fixedSkillSpread(players, settings)
    const preferredPartners = preferredPartnerPriority(teamA, teamB, state)
    const genderTier = genderTierForPairing(players, teamA, teamB)
    const score = isSpecial
      ? [
          profile.conditions.guestPartnerRepeat ? guestPartnerRepeats : 0,
          teamSkillGap,
          -preferredPartners,
          profile.conditions.partnerRepeat ? partnerRepeats : 0,
          profile.conditions.opponentRepeat ? opponentRepeats : 0,
        ]
      : [
          state.clubQualityEnabled ? genderTier : 0,
          profile.conditions.levelBalance ? teamSkillGap : 0,
          -preferredPartners,
          profile.conditions.partnerRepeat ? partnerRepeats : 0,
          profile.conditions.opponentRepeat ? opponentRepeats : 0,
        ]
    return {
      teamA,
      teamB,
      teamSkillGap,
      fixedSkillSpread: fixedSpread,
      partnerRepeats,
      opponentRepeats,
      preferredPartners,
      score,
    }
  })
  const selected = options.sort(
    (left, right) => compareNumberTuples(left.score, right.score),
  )[0]
  const { score: _score, ...pairing } = selected
  return pairing
}

const playerWait = (player: Player, state: EngineState, start: number) => {
  const lastEnd = state.lastEnd.get(player.id)
  return Math.max(0, start - (lastEnd ?? 0))
}

const hasImminentFirstSpecial = (
  player: Player,
  state: EngineState,
  slot: PlannedMeetingSlot,
) =>
  slot.kind === 'general' &&
  (state.games.get(player.id) ?? 0) === 0 &&
  state.initialSpecialReservedIds.has(player.id) &&
  (state.plannedSpecialStarts.get(player.id) ?? []).some(
    (start) =>
      start >= slot.start + slot.duration &&
      start <= MEETING_MAX_WAIT_MINUTES,
  )

const isInitialSpecialFiller = (
  player: Player,
  state: EngineState,
  slot: PlannedMeetingSlot,
) =>
  slot.kind === 'general' &&
  (state.games.get(player.id) ?? 0) === 0 &&
  state.initialSpecialFillerIds.has(player.id)

const projectedGameCount = (player: Player, state: EngineState) =>
  (state.games.get(player.id) ?? 0) +
  (!player.isGuest && player.gameCountFlexible ? 1 : 0)
  + (!player.isGuest
    ? state.remainingPlannedSpecials.get(player.id) ?? 0
    : 0)

const attendanceSelectionScore = (
  player: Player,
  state: EngineState,
  slot: PlannedMeetingSlot,
) => {
  const window = state.attendanceWindows.get(player.id)
  if (!window || (!window.isCustom && !window.priority)) {
    return [0, 0] as const
  }
  const target = state.attendanceTargets.get(player.id) ?? 0
  const games = state.games.get(player.id) ?? 0
  const opportunities = player.isGuest
    ? state.plannedSpecialStarts.get(player.id) ?? []
    : state.playOpportunityStarts.get(player.id) ?? []
  const remainingOpportunities = opportunities.filter(
    (start) => start >= slot.start && start < window.end,
  ).length
  const remainingTarget = Math.max(0, target - games)
  const mustPlay = remainingTarget > 0 &&
    remainingOpportunities <= remainingTarget
  return [
    -Number(mustPlay),
    Number(games >= target),
  ] as const
}

const requiredPlayerIdsForBatch = (
  activePlayers: Player[],
  state: EngineState,
  start: number,
  settings: MatchSettings,
) => {
  const schedulingMinutes = meetingSchedulingMinutes(settings)
  return new Set(
    activePlayers
      .filter(
        (player) =>
          !player.isGuest &&
          (state.availableAt.get(player.id) ?? 0) <= start &&
          start + settings.normalGameMinutes <=
            (state.attendanceWindows.get(player.id)?.end ?? schedulingMinutes),
      )
      .filter((player) => {
        const lastEnd = state.lastEnd.get(player.id) ?? 0
        const nextStart = (state.playOpportunityStarts.get(player.id) ?? [])
          .find((opportunityStart) => opportunityStart > start)
        return (nextStart ?? schedulingMinutes) - lastEnd >
          MEETING_MAX_WAIT_MINUTES
      })
      .map((player) => player.id),
  )
}

const slotPriorityOrder = (
  profile: MeetingRuleProfile,
  state: EngineState,
  slot: PlannedMeetingSlot,
  settings: MatchSettings,
): MeetingPreferenceKey[] => {
  if (
    state.clubQualityEnabled ||
    settings.shuffleDirection !== 'balanced'
  ) {
    return profile.priorityOrder
  }
  const progress = slot.start / Math.max(1, meetingSchedulingMinutes(settings))
  if (progress < settings.earlyPhaseEndPercent / 100) {
    return [
      'games',
      'wait',
      'groupRepeat',
      'partnerRepeat',
      'skill',
      'opponentRepeat',
      'preferredPartner',
      'gender',
      'age',
      'rest',
    ]
  }
  if (progress < settings.middlePhaseEndPercent / 100) {
    return [
      'games',
      'wait',
      'skill',
      'gender',
      'age',
      'groupRepeat',
      'partnerRepeat',
      'opponentRepeat',
      'preferredPartner',
      'rest',
    ]
  }
  return [
    'games',
    'wait',
    'rest',
    'skill',
    'groupRepeat',
    'partnerRepeat',
    'opponentRepeat',
    'preferredPartner',
    'gender',
    'age',
  ]
}

const individualPriority = (
  player: Player,
  state: EngineState,
  slot: PlannedMeetingSlot,
  profile: MeetingRuleProfile,
  settings: MatchSettings,
  requiredIds: Set<string>,
) => {
  const categories: Record<MeetingPreferenceKey, number> = {
    games: projectedGameCount(player, state),
    wait: -playerWait(player, state, slot.start),
    skill: 0,
    groupRepeat: 0,
    partnerRepeat: 0,
    opponentRepeat: 0,
    preferredPartner: -(player.preferredPartnerIds?.length ?? 0),
    gender: 0,
    age: 0,
    rest: state.lastEnd.get(player.id) === slot.start
      ? state.consecutiveGames.get(player.id) ?? 0
      : 0,
  }
  return [
    -Number(requiredIds.has(player.id)),
    ...attendanceSelectionScore(player, state, slot),
    Number((state.games.get(player.id) ?? 0) > 0),
    -Number(isInitialSpecialFiller(player, state, slot)),
    Number(hasImminentFirstSpecial(player, state, slot)),
    state.clubQualityEnabled
      ? Math.min(2, state.tightGames.get(player.id) ?? 0)
      : 0,
    state.clubQualityEnabled
      ? Math.min(3, state.tightGames.get(player.id) ?? 0)
      : 0,
    ...slotPriorityOrder(profile, state, slot, settings).map(
      (key) => categories[key],
    ),
    stableNoise(settings.seed, `${slot.id}:${player.id}`),
  ]
}

const availablePlayers = (
  players: Player[],
  state: EngineState,
  slot: PlannedMeetingSlot,
  usedIds: Set<string>,
) => players.filter((player) => {
  const attendance = state.attendanceWindows.get(player.id)
  if (
    usedIds.has(player.id) ||
    (state.availableAt.get(player.id) ?? 0) > slot.start ||
    (attendance && (
      slot.start < attendance.start ||
      slot.start + slot.duration > attendance.end
    ))
  ) {
    return false
  }
  if (slot.kind !== 'general') return true
  return !(state.plannedSpecialStarts.get(player.id) ?? []).some(
    (start) =>
      start < slot.start + slot.duration &&
      slot.start < start + slot.duration,
  )
})

const uniquePlayers = (players: Player[]) =>
  [...new Map(players.map((player) => [player.id, player])).values()]

const combinations = <T,>(items: T[], count: number): T[][] => {
  if (count === 0) return [[]]
  if (items.length < count) return []
  return items.flatMap((item, index) =>
    combinations(items.slice(index + 1), count - 1).map((tail) => [item, ...tail]),
  )
}

const candidatePool = (
  players: Player[],
  state: EngineState,
  slot: PlannedMeetingSlot,
  profile: MeetingRuleProfile,
  settings: MatchSettings,
  requiredIds: Set<string>,
) => {
  const ranked = [...players].sort((left, right) =>
    compareNumberTuples(
      individualPriority(left, state, slot, profile, settings, requiredIds),
      individualPriority(right, state, slot, profile, settings, requiredIds),
    ),
  )
  const anchors = ranked.slice(0, 2)
  const complements = anchors.flatMap((anchor) => [
    ...ranked
      .filter((player) => player.id !== anchor.id)
      .sort(
        (left, right) =>
          Math.abs(playerScore(left, settings) - playerScore(anchor, settings)) -
            Math.abs(playerScore(right, settings) - playerScore(anchor, settings)) ||
          compareNumberTuples(
            individualPriority(
              left,
              state,
              slot,
              profile,
              settings,
              requiredIds,
            ),
            individualPriority(
              right,
              state,
              slot,
              profile,
              settings,
              requiredIds,
            ),
          ),
      )
      .slice(0, 3),
    ...ranked.filter((player) =>
      (anchor.preferredPartnerIds ?? []).includes(player.id) ||
      (player.preferredPartnerIds ?? []).includes(anchor.id),
    ),
  ])
  const unplayed = ranked.filter(
    (player) => (state.games.get(player.id) ?? 0) === 0,
  )
  return uniquePlayers([
    ...unplayed.slice(0, MAX_PLAYER_POOL),
    ...ranked.slice(0, 10),
    ...complements,
  ])
    .slice(0, MAX_PLAYER_POOL)
}

const ageValue = (player: Player) => {
  const values: Record<Player['ageGroup'], number> = {
    무관: 37,
    '20대': 25,
    '30대': 35,
    '40대': 42,
    '45대': 47,
    '50대': 52,
    '55대이상': 58,
  }
  return values[player.ageGroup]
}

const genderPenalty = (players: Player[]) => {
  const regulars = players.filter((player) => !player.isGuest)
  const men = regulars.filter((player) => player.gender === 'male').length
  const women = regulars.filter((player) => player.gender === 'female').length
  if (men === 0 || women === 0) return 0
  if (regulars.length === 4 && Math.min(men, women) === 1) return 4
  return Math.min(men, women)
}

const attachSpecialParticipantPlans = (
  slots: PlannedMeetingSlot[],
  activePlayers: Player[],
  settings: MatchSettings,
) => {
  const eligibleRegulars = activePlayers.filter(
    (player) => !player.isGuest && (player.specialMatchEligible ?? true),
  )
  const target = specialParticipantTarget(activePlayers, settings)
  const selectedIds = new Set<string>()
  const plannedCounts = new Map(
    eligibleRegulars.map((player) => [player.id, 0]),
  )
  const plannedWindows = new Map<string, Array<{ start: number; end: number }>>()
  const plannedGroupCounts = new Map<string, number>()
  const guestSlotIndex = new Map<string, number>()
  const playersById = new Map(activePlayers.map((player) => [player.id, player]))

  return slots.map((slot) => {
    if (slot.kind !== 'special' || !slot.guestId) return slot
    const guest = playersById.get(slot.guestId)
    if (!guest) return slot
    const currentGuestIndex = guestSlotIndex.get(guest.id) ?? 0
    guestSlotIndex.set(guest.id, currentGuestIndex + 1)
    const guestTarget = Math.max(
      1,
      plannedGuestGames(guest, activePlayers, settings),
    )
    const lowCount = settings.specialLowPriorityEnabled
      ? Math.round(guestTarget * settings.specialLowPriorityPercent / 100)
      : 0
    const highCount = settings.specialHighPriorityEnabled
      ? Math.round(guestTarget * settings.specialHighPriorityPercent / 100)
      : 0
    const segment = currentGuestIndex < lowCount
      ? 'low'
      : currentGuestIndex >= Math.max(lowCount, guestTarget - highCount)
        ? 'high'
        : 'random'
    const available = eligibleRegulars.filter((player) =>
      isPlayerAvailableForMeetingSlot(
        player,
        settings,
        slot.start,
        slot.duration,
      ) &&
      !(plannedWindows.get(player.id) ?? []).some(
        (window) =>
          window.start < slot.start + slot.duration &&
          slot.start < window.end,
      ),
    )
    const ranked = [...available].sort((left, right) => {
      const coverageDifference =
        Number(selectedIds.has(left.id)) - Number(selectedIds.has(right.id))
      if (coverageDifference !== 0) return coverageDifference
      const countDifference =
        (plannedCounts.get(left.id) ?? 0) - (plannedCounts.get(right.id) ?? 0)
      if (countDifference !== 0) return countDifference
      const directionDifference =
        playerScore(left, settings) - playerScore(right, settings)
      if (segment === 'low' && directionDifference !== 0) {
        return directionDifference
      }
      if (segment === 'high' && directionDifference !== 0) {
        return -directionDifference
      }
      return stableNoise(settings.seed, `${slot.id}:${left.id}`) -
        stableNoise(settings.seed, `${slot.id}:${right.id}`)
    })
    const pool = uniquePlayers([
      ...ranked.slice(0, 14),
      ...ranked.filter((player) => player.gender === 'male').slice(0, 6),
      ...ranked.filter((player) => player.gender === 'female').slice(0, 6),
    ]).slice(0, 20)
    const regularSeatCount = slot.roamingGuestId ? 2 : 3
    let best: { players: Player[]; score: number[] } | null = null
    for (const regulars of combinations(pool, regularSeatCount)) {
      const plannedGroupKey = [
        guest.id,
        ...(slot.roamingGuestId ? [slot.roamingGuestId] : []),
        ...regulars.map((player) => player.id),
      ].sort().join('__')
      if (
        settings.conditionOptions.groupRepeat &&
        (plannedGroupCounts.get(plannedGroupKey) ?? 0) >=
          MEETING_MAX_GROUP_MEETINGS
      ) {
        continue
      }
      const newIds = regulars.filter((player) => !selectedIds.has(player.id))
      if (
        settings.specialLimitEnabled &&
        selectedIds.size + newIds.length > target
      ) {
        continue
      }
      const requiredNewCount = Math.min(
        regularSeatCount,
        Math.max(0, target - selectedIds.size),
      )
      const scores = regulars.map((player) => playerScore(player, settings))
      const ages = regulars
        .filter((player) => player.ageGroup !== '무관')
        .map(ageValue)
      const directionalScore = segment === 'low'
        ? scores.reduce((sum, score) => sum + score, 0)
        : segment === 'high'
          ? -scores.reduce((sum, score) => sum + score, 0)
          : 0
      const score = [
        Math.max(0, requiredNewCount - newIds.length),
        Math.max(...regulars.map((player) => plannedCounts.get(player.id) ?? 0)),
        regulars.reduce(
          (sum, player) => sum + (plannedCounts.get(player.id) ?? 0),
          0,
        ),
        genderPenalty(regulars),
        directionalScore,
        Math.max(...scores) - Math.min(...scores),
        ages.length > 1 ? Math.max(...ages) - Math.min(...ages) : 0,
        stableNoise(
          settings.seed,
          `${slot.id}:${regulars.map((player) => player.id).sort().join(':')}`,
        ),
      ]
      if (best === null || compareNumberTuples(score, best.score) < 0) {
        best = { players: regulars, score }
      }
    }
    if (!best) return slot
    const bestGroupKey = [
      guest.id,
      ...(slot.roamingGuestId ? [slot.roamingGuestId] : []),
      ...best.players.map((player) => player.id),
    ].sort().join('__')
    plannedGroupCounts.set(
      bestGroupKey,
      (plannedGroupCounts.get(bestGroupKey) ?? 0) + 1,
    )
    for (const player of best.players) {
      selectedIds.add(player.id)
      plannedCounts.set(player.id, (plannedCounts.get(player.id) ?? 0) + 1)
      plannedWindows.set(player.id, [
        ...(plannedWindows.get(player.id) ?? []),
        { start: slot.start, end: slot.start + slot.duration },
      ])
    }
    return {
      ...slot,
      plannedPlayerIds: best.players.map((player) => player.id),
    }
  })
}

const specialAllocationSegment = (
  guest: Player,
  state: EngineState,
  activePlayers: Player[],
  settings: MatchSettings,
) => {
  const target = Math.max(1, plannedGuestGames(guest, activePlayers, settings))
  const lowCount = settings.specialLowPriorityEnabled
    ? Math.round(target * settings.specialLowPriorityPercent / 100)
    : 0
  const highCount = settings.specialHighPriorityEnabled
    ? Math.round(target * settings.specialHighPriorityPercent / 100)
    : 0
  const index = state.guestGames.get(guest.id) ?? 0
  if (index < lowCount) return 'low' as const
  if (index >= Math.max(lowCount, target - highCount)) return 'high' as const
  return 'random' as const
}

const categoryValues = (
  players: [Player, Player, Player, Player],
  pairing: PairingChoice,
  state: EngineState,
  slot: PlannedMeetingSlot,
  settings: MatchSettings,
  activePlayers: Player[],
) => {
  const gameCounts = players.map((player) => projectedGameCount(player, state))
  const waits = players.map((player) => playerWait(player, state, slot.start))
  const ages = players
    .filter((player) => !player.isGuest && player.ageGroup !== '무관')
    .map(ageValue)
  const consecutive = players.reduce(
    (sum, player) =>
      sum +
      (state.lastEnd.get(player.id) === slot.start
        ? state.consecutiveGames.get(player.id) ?? 0
        : 0),
    0,
  )
  const specialGuest = slot.guestId
    ? activePlayers.find((player) => player.id === slot.guestId)
    : undefined
  const segment = specialGuest
    ? specialAllocationSegment(
        specialGuest,
        state,
        activePlayers,
        settings,
      )
    : null
  const regularScores = players
    .filter((player) => !player.isGuest)
    .map((player) => playerScore(player, settings))
  const directionalSpecialSkill = segment === 'low'
    ? regularScores.reduce((sum, score) => sum + score, 0)
    : segment === 'high'
      ? -regularScores.reduce((sum, score) => sum + score, 0)
      : 0
  const categories: Record<MeetingPreferenceKey, number> = {
    games: Math.max(...gameCounts) * 100 +
      gameCounts.reduce((sum, count) => sum + count, 0),
    wait: -(
      waits.filter((wait) => wait >= 15).length * 1000 +
      waits.reduce((sum, wait) => sum + wait, 0)
    ),
    skill: slot.kind === 'special'
      ? directionalSpecialSkill + fixedSkillSpread(players, settings)
      : Math.max(pairing.teamSkillGap, pairing.fixedSkillSpread),
    groupRepeat: state.groups.get(groupKey(players)) ?? 0,
    partnerRepeat: pairing.partnerRepeats,
    opponentRepeat: pairing.opponentRepeats,
    preferredPartner: -pairing.preferredPartners,
    gender: genderPenalty(players),
    age: ages.length > 1 ? Math.max(...ages) - Math.min(...ages) : 0,
    rest: consecutive,
  }
  return categories
}

const scoreCandidate = (
  players: [Player, Player, Player, Player],
  pairing: PairingChoice,
  state: EngineState,
  slot: PlannedMeetingSlot,
  profile: MeetingRuleProfile,
  settings: MatchSettings,
  activePlayers: Player[],
) => {
  const categories = categoryValues(
    players,
    pairing,
    state,
    slot,
    settings,
    activePlayers,
  )
  const target = specialParticipantTarget(activePlayers, settings)
  const specialRegulars = players.filter((player) => !player.isGuest)
  const newSpecialParticipants = slot.kind === 'special'
    ? specialRegulars.filter(
        (player) => !state.specialParticipantIds.has(player.id),
      ).length
    : 0
  const coveragePenalty = slot.kind === 'special'
    ? Math.max(
        0,
        Math.min(3, target - state.specialParticipantIds.size) -
          newSpecialParticipants,
      )
    : 0
  const imminentFirstSpecialPenalty = slot.kind === 'general'
    ? players.filter((player) =>
        hasImminentFirstSpecial(player, state, slot),
      ).length
    : 0
  const initialSpecialFillerReward = slot.kind === 'general'
    ? -players.filter((player) =>
        isInitialSpecialFiller(player, state, slot),
      ).length
    : 0
  const generalSkillGap = Math.max(
    pairing.teamSkillGap,
    pairing.fixedSkillSpread,
  )
  const isWarmup =
    slot.kind === 'general' &&
    players.some((player) => (state.games.get(player.id) ?? 0) === 0)
  const genderTier = genderTierForPairing(
    players,
    pairing.teamA,
    pairing.teamB,
  )
  const isTight =
    state.clubQualityEnabled &&
    slot.kind === 'general' &&
    !isWarmup &&
    generalSkillGap < MEETING_SKILL_CAUTION_GAP &&
    genderTier < 2
  const unplayedRegularsRemain = activePlayers.some(
    (player) =>
      !player.isGuest && (state.games.get(player.id) ?? 0) === 0,
  )
  const warmupFillerPenalty =
    slot.kind === 'general' && unplayedRegularsRemain
      ? players.filter(
          (player) => (state.games.get(player.id) ?? 0) > 0,
        ).length
      : 0
  const tightCounts = players
    .filter((player) => !player.isGuest)
    .map((player) => state.tightGames.get(player.id) ?? 0)
  const tightMinimumPriority =
    Math.max(0, ...tightCounts.map((count) => Math.min(2, count))) * 100 +
    tightCounts.reduce((sum, count) => sum + Math.min(2, count), 0)
  const tightTargetPriority =
    Math.max(0, ...tightCounts.map((count) => Math.min(3, count))) * 100 +
    tightCounts.reduce((sum, count) => sum + Math.min(3, count), 0)
  const skillSafetyTier = slot.kind === 'special' || !profile.conditions.levelBalance
    ? 0
    : generalSkillGap > MEETING_SKILL_DANGER_GAP
      ? 2
      : generalSkillGap >= MEETING_SKILL_CAUTION_GAP
        ? 1
        : 0
  const skillDangerTier = skillSafetyTier === 2 ? 1 : 0
  const skillCautionTier = skillSafetyTier === 1 ? 1 : 0
  const criticalWaitStart = Math.max(
    0,
    MEETING_MAX_WAIT_MINUTES - slot.duration,
  )
  const criticalWaits = players
    .map((player) => {
      const currentWait = playerWait(player, state, slot.start)
      if (slot.kind !== 'general') return currentWait
      const nextPlannedStart = (state.plannedSpecialStarts.get(player.id) ?? [])
        .find((start) => start >= slot.start + slot.duration)
      if (
        nextPlannedStart === undefined ||
        nextPlannedStart >= slot.start + slot.duration * 2
      ) {
        return currentWait
      }
      const lastEnd = state.lastEnd.get(player.id) ?? 0
      return Math.max(currentWait, nextPlannedStart - lastEnd)
    })
    .filter((wait) => wait >= criticalWaitStart)
  const waitDeadlinePriority = -(
    criticalWaits.length * 1000 +
    criticalWaits.reduce((sum, wait) => sum + wait, 0)
  )
  const attendanceScores = players.map((player) =>
    attendanceSelectionScore(player, state, slot),
  )
  const attendanceScore = Array.from({ length: 2 }, (_, index) =>
    attendanceScores.reduce((sum, score) => sum + score[index], 0),
  )
  return [
    0,
    coveragePenalty,
    initialSpecialFillerReward,
    imminentFirstSpecialPenalty,
    warmupFillerPenalty,
    waitDeadlinePriority,
    ...attendanceScore,
    Number(
      state.clubQualityEnabled &&
      slot.kind === 'general' &&
      !isWarmup &&
      !isTight,
    ),
    tightMinimumPriority,
    tightTargetPriority,
    categories.games,
    state.clubQualityEnabled && slot.kind === 'general' && !isWarmup
      ? genderTier
      : 0,
    skillDangerTier,
    skillCautionTier,
    ...slotPriorityOrder(profile, state, slot, settings).map((key) => {
      if (key === 'skill' && !profile.conditions.levelBalance) return 0
      if (key === 'groupRepeat' && !profile.conditions.groupRepeat) return 0
      if (key === 'partnerRepeat' && !profile.conditions.partnerRepeat) return 0
      if (key === 'opponentRepeat' && !profile.conditions.opponentRepeat) return 0
      if (key === 'gender' && !profile.conditions.genderBalance) return 0
      if (key === 'age' && !profile.conditions.ageBalance) return 0
      if (key === 'rest' && !profile.conditions.restBalance) return 0
      return categories[key]
    }),
    stableNoise(
      settings.seed,
      `${slot.id}:${players.map((player) => player.id).sort().join(':')}`,
    ),
  ]
}

const hardCandidateAllowed = (
  players: [Player, Player, Player, Player],
  pairing: PairingChoice,
  state: EngineState,
  profile: MeetingRuleProfile,
  isSpecial: boolean,
  isWarmup: boolean,
  allowDanger: boolean,
  allowGuestOverflow: boolean,
) => {
  const maximumStandardGames = state.maximumStandardGames
  if (new Set(players.map((player) => player.id)).size !== 4) return false
  const guestCount = players.filter((player) => player.isGuest).length
  if (isSpecial) {
    if (guestCount === 0 || guestCount === 4) return false
  } else if (guestCount > 0) {
    return false
  }
  if (
    profile.hard.singleGuestPerMatch &&
    guestCount > 1 &&
    !(allowGuestOverflow && guestCount === 2)
  ) return false
  if (
    profile.hard.maxGroupMeetings !== null &&
    (state.groups.get(groupKey(players)) ?? 0) >=
      profile.hard.maxGroupMeetings
  ) {
    return false
  }
  if (
    !isSpecial &&
    maximumStandardGames !== null &&
    players.some(
      (player) =>
        !player.isGuest &&
        !player.gameCountFlexible &&
        !state.attendanceWindows.get(player.id)?.isCustom &&
        projectedGameCount(player, state) >= maximumStandardGames,
    )
  ) {
    return false
  }
  if (profile.hard.strictSkillLimit && !isSpecial && !isWarmup) {
    const skillGap = Math.max(pairing.teamSkillGap, pairing.fixedSkillSpread)
    if (skillGap > MEETING_SKILL_DANGER_GAP) return false
    if (
      skillGap >= MEETING_SKILL_CAUTION_GAP &&
      state.strictCautionMatches >= profile.hard.maxStrictCautionMatches
    ) {
      return false
    }
  }
  if (
    !allowDanger &&
    !isSpecial &&
    profile.conditions.levelBalance &&
    !isWarmup &&
    Math.max(pairing.teamSkillGap, pairing.fixedSkillSpread) >
      MEETING_SKILL_DANGER_GAP
  ) {
    return false
  }
  return true
}

const exceedsConsecutiveGameLimit = (
  player: Player,
  state: EngineState,
  slot: PlannedMeetingSlot,
) => {
  if (!usesMeetingAttendanceGameLimit(player)) return false
  if (state.lastEnd.get(player.id) !== slot.start) return false
  const maximum = maximumConsecutiveMeetingGames(player)
  return (state.consecutiveGames.get(player.id) ?? 0) >= maximum
}

const makeCandidate = (
  players: [Player, Player, Player, Player],
  state: EngineState,
  slot: PlannedMeetingSlot,
  profile: MeetingRuleProfile,
  settings: MatchSettings,
  activePlayers: Player[],
  allowDanger = false,
) => {
  if (players.some((player) => exceedsConsecutiveGameLimit(player, state, slot))) {
    return null
  }
  const pairing = pickPairing(
    players,
    state,
    settings,
    profile,
    slot.kind === 'special',
  )
  const isWarmup =
    slot.kind === 'general' &&
    players.some((player) => (state.games.get(player.id) ?? 0) === 0)
  if (
    !hardCandidateAllowed(
      players,
      pairing,
      state,
      profile,
      slot.kind === 'special',
      isWarmup,
      allowDanger,
      slot.kind === 'special' && Boolean(slot.roamingGuestId),
    )
  ) {
    return null
  }
  const skillGap = slot.kind === 'special'
    ? 0
    : Math.max(pairing.teamSkillGap, pairing.fixedSkillSpread)
  const genderTier = genderTierForPairing(
    players,
    pairing.teamA,
    pairing.teamB,
  )
  const isTight =
    state.clubQualityEnabled &&
    slot.kind === 'general' &&
    !isWarmup &&
    skillGap < MEETING_SKILL_CAUTION_GAP &&
    genderTier < 2
  return {
    players,
    pairing,
    score: scoreCandidate(
      players,
      pairing,
      state,
      slot,
      profile,
      settings,
      activePlayers,
    ),
    skillGap,
    isWarmup,
    isTight,
    genderTier,
  } satisfies GroupCandidate
}

const requiredCoverageCount = (
  candidate: GroupCandidate,
  requiredIds: Set<string>,
) => candidate.players.filter((player) => requiredIds.has(player.id)).length

const limitCandidateFrontier = (
  candidates: GroupCandidate[],
  requiredIds: Set<string>,
) => {
  const sorted = [...candidates].sort(
    (left, right) => compareNumberTuples(left.score, right.score),
  )
  const representatives = new Map<string, GroupCandidate>()
  for (const candidate of sorted) {
    const coveredRequiredIds = candidate.players
      .filter((player) => requiredIds.has(player.id))
      .map((player) => player.id)
      .sort()
      .join(':')
    const skillTier = candidate.skillGap > MEETING_SKILL_DANGER_GAP
      ? 2
      : candidate.skillGap >= MEETING_SKILL_CAUTION_GAP
        ? 1
        : 0
    const key = [
      coveredRequiredIds,
      skillTier,
      Number(candidate.isWarmup),
      Number(candidate.isTight),
      candidate.genderTier,
    ].join(':')
    if (!representatives.has(key)) representatives.set(key, candidate)
  }
  return [...new Map(
    [...sorted.slice(0, 7), ...representatives.values()].map((candidate) => [
      groupKey(candidate.players),
      candidate,
    ]),
  ).values()].slice(0, MAX_GROUP_CANDIDATES)
}

const generalCandidates = (
  activePlayers: Player[],
  state: EngineState,
  slot: PlannedMeetingSlot,
  usedIds: Set<string>,
  profile: MeetingRuleProfile,
  settings: MatchSettings,
  requiredIds: Set<string>,
) => {
  const regulars = availablePlayers(
    activePlayers.filter((player) => !player.isGuest),
    state,
    slot,
    usedIds,
  )
  if (regulars.length < 4) return []
  const pool = candidatePool(
    regulars,
    state,
    slot,
    profile,
    settings,
    requiredIds,
  )
  const safeCandidates: GroupCandidate[] = []
  const fallbackCandidates: GroupCandidate[] = []
  const candidateKeys = new Set<string>()
  const addCandidate = (candidate: GroupCandidate | null) => {
    if (!candidate) return
    const key = groupKey(candidate.players)
    if (candidateKeys.has(key)) return
    candidateKeys.add(key)
    if (candidate.skillGap <= MEETING_SKILL_DANGER_GAP) {
      safeCandidates.push(candidate)
    } else {
      fallbackCandidates.push(candidate)
    }
  }
  for (let a = 0; a < pool.length - 3; a += 1) {
    for (let b = a + 1; b < pool.length - 2; b += 1) {
      for (let c = b + 1; c < pool.length - 1; c += 1) {
        for (let d = c + 1; d < pool.length; d += 1) {
          addCandidate(makeCandidate(
            [pool[a], pool[b], pool[c], pool[d]],
            state,
            slot,
            profile,
            settings,
            activePlayers,
            true,
          ))
        }
      }
    }
  }
  const initiallySafeRequiredIds = new Set(
    safeCandidates.flatMap((candidate) =>
      candidate.players
        .filter((player) => requiredIds.has(player.id))
        .map((player) => player.id),
    ),
  )
  const uncoveredRequiredPlayers = regulars.filter(
    (player) =>
      requiredIds.has(player.id) && !initiallySafeRequiredIds.has(player.id),
  )
  for (const anchor of uncoveredRequiredPlayers) {
    const companions = regulars
      .filter((player) => player.id !== anchor.id)
      .sort(
        (left, right) =>
          Math.abs(playerScore(left, settings) - playerScore(anchor, settings)) -
            Math.abs(playerScore(right, settings) - playerScore(anchor, settings)) ||
          compareNumberTuples(
            individualPriority(
              left,
              state,
              slot,
              profile,
              settings,
              requiredIds,
            ),
            individualPriority(
              right,
              state,
              slot,
              profile,
              settings,
              requiredIds,
            ),
          ),
      )
      .slice(0, 7)
    for (let a = 0; a < companions.length - 2; a += 1) {
      for (let b = a + 1; b < companions.length - 1; b += 1) {
        for (let c = b + 1; c < companions.length; c += 1) {
          addCandidate(makeCandidate(
            [anchor, companions[a], companions[b], companions[c]],
            state,
            slot,
            profile,
            settings,
            activePlayers,
            true,
          ))
        }
      }
    }
  }
  const hasUnplayedRegulars = regulars.some(
    (player) => (state.games.get(player.id) ?? 0) === 0,
  )
  const preferredCandidates = hasUnplayedRegulars
    ? [...safeCandidates, ...fallbackCandidates]
    : safeCandidates.length > 0
      ? safeCandidates
      : fallbackCandidates
  const safelyCoveredRequiredIds = new Set(
    safeCandidates.flatMap((candidate) =>
      candidate.players
        .filter((player) => requiredIds.has(player.id))
        .map((player) => player.id),
    ),
  )
  const uncoveredRequiredIds = new Set(
    [...requiredIds].filter(
      (playerId) => !safelyCoveredRequiredIds.has(playerId),
    ),
  )
  const requiredCandidates = [
    ...safeCandidates.filter(
      (candidate) => requiredCoverageCount(candidate, requiredIds) > 0,
    ),
    ...fallbackCandidates.filter(
      (candidate) =>
        candidate.players.some((player) => uncoveredRequiredIds.has(player.id)),
    ),
  ]
  return limitCandidateFrontier(
    requiredCandidates.length > 0
      ? [...requiredCandidates, ...preferredCandidates]
      : preferredCandidates,
    requiredIds,
  )
}

const specialCandidates = (
  activePlayers: Player[],
  state: EngineState,
  slot: PlannedMeetingSlot,
  usedIds: Set<string>,
  profile: MeetingRuleProfile,
  settings: MatchSettings,
  requiredIds: Set<string>,
) => {
  const fixedGuest = activePlayers.find((player) => player.id === slot.guestId)
  const roamingGuest = slot.roamingGuestId
    ? activePlayers.find((player) => player.id === slot.roamingGuestId)
    : undefined
  if (!fixedGuest || (slot.roamingGuestId && !roamingGuest)) return []
  const guests = [fixedGuest, ...(roamingGuest ? [roamingGuest] : [])]
  const guestIds = new Set(guests.map((guest) => guest.id))
  if (guests.some((guest) => usedIds.has(guest.id))) return []
  if (guests.some((guest) => (state.availableAt.get(guest.id) ?? 0) > slot.start)) {
    return []
  }
  if (guests.some((guest) => {
    const attendance = state.attendanceWindows.get(guest.id)
    return attendance && (
      slot.start < attendance.start ||
      slot.start + slot.duration > attendance.end
    )
  })) {
    return []
  }
  if (guests.some((guest) =>
    (state.guestGames.get(guest.id) ?? 0) >=
      plannedGuestGames(guest, activePlayers, settings)
  )) {
    return []
  }

  const regularSeatCount = 4 - guests.length
  if ((slot.plannedPlayerIds?.length ?? 0) === regularSeatCount) {
    const playersById = new Map(
      activePlayers.map((player) => [player.id, player]),
    )
    const plannedRegulars = slot.plannedPlayerIds
      ?.map((playerId) => playersById.get(playerId))
      .filter((player): player is Player => Boolean(player)) ?? []
    if (
      plannedRegulars.length === regularSeatCount &&
      plannedRegulars.every(
        (player) =>
          !usedIds.has(player.id) &&
          (state.availableAt.get(player.id) ?? 0) <= slot.start &&
          slot.start + slot.duration <=
            (state.attendanceWindows.get(player.id)?.end ?? Number.MAX_SAFE_INTEGER),
      )
    ) {
      const candidate = makeCandidate(
        [...guests, ...plannedRegulars] as [Player, Player, Player, Player],
        state,
        slot,
        profile,
        settings,
        activePlayers,
      )
      if (candidate) return [candidate]
    }
  }

  const target = specialParticipantTarget(activePlayers, settings)
  const targetReached = state.specialParticipantIds.size >= target
  const candidates = availablePlayers(
    activePlayers.filter(
      (player) =>
        !guestIds.has(player.id) &&
        (
          !player.isGuest
            ? (player.specialMatchEligible ?? true) &&
              (!targetReached ||
                !settings.specialLimitEnabled ||
                state.specialParticipantIds.has(player.id))
            : !settings.singleGuestPerMatch &&
              (state.guestGames.get(player.id) ?? 0) <
                plannedGuestGames(player, activePlayers, settings)
        ),
    ),
    state,
    slot,
    usedIds,
  )
  if (candidates.length < regularSeatCount) return []

  const ranked = [...candidates].sort((left, right) => {
    const firstGameDifference =
      Number((state.games.get(left.id) ?? 0) > 0) -
      Number((state.games.get(right.id) ?? 0) > 0)
    if (firstGameDifference !== 0) return firstGameDifference
    const leftCoverage = Number(
      !left.isGuest && !state.specialParticipantIds.has(left.id),
    )
    const rightCoverage = Number(
      !right.isGuest && !state.specialParticipantIds.has(right.id),
    )
    if (leftCoverage !== rightCoverage) return rightCoverage - leftCoverage
    const genderDifference =
      Number(left.gender === 'none') - Number(right.gender === 'none')
    if (genderDifference !== 0) return genderDifference
    return compareNumberTuples(
      individualPriority(left, state, slot, profile, settings, requiredIds),
      individualPriority(right, state, slot, profile, settings, requiredIds),
    )
  })
  const pool = uniquePlayers([
    ...ranked.slice(0, 12),
    ...ranked
      .filter((player) => !player.isGuest && player.gender === 'male')
      .slice(0, 4),
    ...ranked
      .filter((player) => !player.isGuest && player.gender === 'female')
      .slice(0, 4),
  ]).slice(0, MAX_PLAYER_POOL)
  const groups: GroupCandidate[] = []
  for (const companions of combinations(pool, regularSeatCount)) {
    const players = [...guests, ...companions] as [
      Player,
      Player,
      Player,
      Player,
    ]
    const regulars = players.filter((player) => !player.isGuest)
    if (regulars.length === 0) continue
    if (settings.specialLimitEnabled) {
      const newIds = regulars.filter(
        (player) => !state.specialParticipantIds.has(player.id),
      )
      if (state.specialParticipantIds.size + newIds.length > target) continue
    }
    const candidate = makeCandidate(
      players,
      state,
      slot,
      profile,
      settings,
      activePlayers,
    )
    if (candidate) groups.push(candidate)
  }
  return limitCandidateFrontier(groups, requiredIds)
}

const candidatesForSlot = (
  activePlayers: Player[],
  state: EngineState,
  slot: PlannedMeetingSlot,
  usedIds: Set<string>,
  profile: MeetingRuleProfile,
  settings: MatchSettings,
  requiredIds: Set<string>,
) => slot.kind === 'special'
  ? specialCandidates(
      activePlayers,
      state,
      slot,
      usedIds,
      profile,
      settings,
      requiredIds,
    )
  : generalCandidates(
      activePlayers,
      state,
      slot,
      usedIds,
      profile,
      settings,
      requiredIds,
    )

const chooseBatch = (
  slots: PlannedMeetingSlot[],
  activePlayers: Player[],
  state: EngineState,
  profile: MeetingRuleProfile,
  settings: MatchSettings,
) => {
  const start = slots[0]?.start ?? 0
  const requiredIds = requiredPlayerIdsForBatch(
    activePlayers,
    state,
    start,
    settings,
  )
  const scoreLength = profile.priorityOrder.length + 16
  let beams: BatchBeam[] = [{
    selections: [],
    usedIds: new Set(),
    score: Array.from({ length: scoreLength }, () => 0),
    cautionMatches: 0,
  }]

  const requiredIdsMissingFrom = (beam: BatchBeam) =>
    [...requiredIds].filter((playerId) => !beam.usedIds.has(playerId)).length
  const remainingRegularCapacity = (slotIndex: number) =>
    slots
      .slice(slotIndex + 1)
      .reduce(
        (sum, slot) => sum + (
          slot.kind === 'general' ? 4 : slot.roamingGuestId ? 2 : 3
        ),
        0,
      )

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex]
    const expanded: BatchBeam[] = []
    for (const beam of beams) {
      const candidates = candidatesForSlot(
        activePlayers,
        state,
        slot,
        beam.usedIds,
        profile,
        settings,
        requiredIds,
      )
      for (const candidate of candidates) {
        const cautionAdded =
          candidate.skillGap >= MEETING_SKILL_CAUTION_GAP ? 1 : 0
        if (
          profile.hard.strictSkillLimit &&
          state.strictCautionMatches + beam.cautionMatches + cautionAdded >
            profile.hard.maxStrictCautionMatches
        ) {
          continue
        }
        expanded.push({
          selections: [...beam.selections, { slot, candidate }],
          usedIds: new Set([
            ...beam.usedIds,
            ...candidate.players.map((player) => player.id),
          ]),
          score: addNumberTuples(beam.score, candidate.score),
          cautionMatches: beam.cautionMatches + cautionAdded,
        })
      }
      if (candidates.length === 0) {
        const skipScore = Array.from({ length: scoreLength }, () => 0)
        skipScore[0] = 1
        expanded.push({
          ...beam,
          score: addNumberTuples(beam.score, skipScore),
        })
      }
    }
    const remainingCapacity = remainingRegularCapacity(slotIndex)
    beams = expanded
      .sort((left, right) =>
        compareNumberTuples(
          [
            Math.max(
              0,
              requiredIdsMissingFrom(left) - remainingCapacity,
            ),
            ...left.score,
          ],
          [
            Math.max(
              0,
              requiredIdsMissingFrom(right) - remainingCapacity,
            ),
            ...right.score,
          ],
        ),
      )
      .slice(0, MAX_BATCH_BEAM)
  }
  return [...beams]
    .sort((left, right) =>
      compareNumberTuples(
        [requiredIdsMissingFrom(left), ...left.score],
        [requiredIdsMissingFrom(right), ...right.score],
      ),
    )[0]?.selections ?? []
}

const updateState = (
  state: EngineState,
  match: Match,
  candidate: GroupCandidate,
) => {
  const players = [...match.teamA, ...match.teamB]
  const start = match.startOffsetMinutes ?? 0
  const end = start + (match.durationMinutes ?? 15)
  increment(state.groups, groupKey(players))
  increment(state.partners, pairKey(match.teamA[0].id, match.teamA[1].id))
  increment(state.partners, pairKey(match.teamB[0].id, match.teamB[1].id))
  for (const left of match.teamA) {
    for (const right of match.teamB) {
      increment(state.opponents, pairKey(left.id, right.id))
    }
  }
  for (const player of players) {
    increment(state.games, player.id)
    if (candidate.isTight && !player.isGuest) {
      increment(state.tightGames, player.id)
    }
    if (match.isSpecial) {
      increment(state.specialGames, player.id)
      if (player.isGuest) increment(state.guestGames, player.id)
      else {
        state.specialParticipantIds.add(player.id)
        state.remainingPlannedSpecials.set(
          player.id,
          Math.max(0, (state.remainingPlannedSpecials.get(player.id) ?? 0) - 1),
        )
      }
    } else {
      increment(state.generalGames, player.id)
    }
    const consecutive = state.lastEnd.get(player.id) === start
      ? (state.consecutiveGames.get(player.id) ?? 0) + 1
      : 1
    state.consecutiveGames.set(player.id, consecutive)
    state.lastEnd.set(player.id, end)
    state.availableAt.set(player.id, end)
  }
  if (!match.isSpecial && candidate.skillGap >= MEETING_SKILL_CAUTION_GAP) {
    state.strictCautionMatches += 1
  }
}

const refreshRestingPlayers = (
  rounds: Round[],
  activePlayers: Player[],
) => {
  const allMatches = rounds.flatMap((round) => round.matches)
  return rounds.map((round) => {
    const roundMatches = round.matches
    const overlapping = allMatches.filter((match) =>
      roundMatches.some((candidate) =>
        hasOverlap(
          {
            start: match.startOffsetMinutes ?? 0,
            duration: match.durationMinutes ?? 15,
          },
          {
            start: candidate.startOffsetMinutes ?? 0,
            duration: candidate.durationMinutes ?? 15,
          },
        ),
      ),
    )
    const playingIds = new Set(
      overlapping.flatMap((match) =>
        [...match.teamA, ...match.teamB].map((player) => player.id),
      ),
    )
    return {
      ...round,
      resting: activePlayers.filter((player) => !playingIds.has(player.id)),
    }
  })
}

const rePairGeneralGroup = (
  players: [Player, Player, Player, Player],
  settings: MatchSettings,
) => teamOptions(players)
  .map(([teamA, teamB]) => ({
    teamA,
    teamB,
    score: [
      Math.max(
        adaptiveTeamGap(teamA, teamB, settings),
        fixedSkillSpread(players, settings),
      ) > MEETING_SKILL_DANGER_GAP
        ? 1
        : 0,
      Math.max(
        adaptiveTeamGap(teamA, teamB, settings),
        fixedSkillSpread(players, settings),
      ),
    ],
  }))
  .sort((left, right) => compareNumberTuples(left.score, right.score))[0]

const replaceGeneralMatchPlayer = (
  match: Match,
  outgoingId: string,
  incoming: Player,
  settings: MatchSettings,
) => {
  const players = [...match.teamA, ...match.teamB].map((player) =>
    player.id === outgoingId ? incoming : player,
  ) as [Player, Player, Player, Player]
  const pairing = rePairGeneralGroup(players, settings)
  return { ...match, teamA: pairing.teamA, teamB: pairing.teamB }
}

const repairStandardGameSpread = (
  schedule: Schedule,
  players: Player[],
  settings: MatchSettings,
) => {
  const standardPlayers = players.filter(
    (player) => player.active && !player.isGuest && !player.gameCountFlexible,
  )
  if (standardPlayers.length < 2) return schedule
  let repaired = schedule
  const initialWaitLimit = analyzeMeetingScheduleV2(
    schedule,
    players,
    settings,
  ).maximumInitialWaitMinutes
  let allowSkillDangerIncrease = false
  let pass = 0
  const maximumPasses = Math.min(12, standardPlayers.length)
  const balanceScore = (metrics: MeetingV2Metrics) => {
    const counts = standardPlayers.map(
      (player) => metrics.gameCounts[player.id] ?? 0,
    )
    const total = counts.reduce((sum, count) => sum + count, 0)
    const deviation = counts.reduce(
      (sum, count) => sum + (count * counts.length - total) ** 2,
      0,
    )
    return [metrics.standardGameSpread, deviation]
  }

  while (pass < maximumPasses) {
    const base = analyzeMeetingScheduleV2(repaired, players, settings)
    if (base.standardGameSpread <= 1) break
    const counts = standardPlayers.map(
      (player) => base.gameCounts[player.id] ?? 0,
    )
    const minimum = Math.min(...counts)
    const maximum = Math.max(...counts)
    const underplayed = standardPlayers.filter(
      (player) => (base.gameCounts[player.id] ?? 0) === minimum,
    )
    const overplayed = standardPlayers.filter(
      (player) => (base.gameCounts[player.id] ?? 0) === maximum,
    )
    const specialAppearances = new Map(
      standardPlayers.map((player) => [
        player.id,
        repaired.rounds
          .flatMap((round) => round.matches)
          .filter(
            (match) =>
              match.isSpecial &&
              [...match.teamA, ...match.teamB].some(
                (candidate) => candidate.id === player.id,
              ),
          ).length,
      ]),
    )
    let best: { schedule: Schedule; score: number[] } | null = null

    for (const incoming of underplayed) {
      for (const outgoing of overplayed) {
        for (const match of repaired.rounds.flatMap((round) => round.matches)) {
          const assigned = [...match.teamA, ...match.teamB]
          if (!assigned.some((player) => player.id === outgoing.id)) continue
          if (assigned.some((player) => player.id === incoming.id)) continue
          if (
            match.isSpecial &&
            (
              !(incoming.specialMatchEligible ?? true) ||
              !repaired.specialCompletedIds.includes(incoming.id) ||
              (specialAppearances.get(outgoing.id) ?? 0) <= 1
            )
          ) {
            continue
          }
          const replacement = replaceGeneralMatchPlayer(
            match,
            outgoing.id,
            incoming,
            settings,
          )
          const candidate: Schedule = {
            ...repaired,
            rounds: repaired.rounds.map((round) => ({
              ...round,
              matches: round.matches.map((candidateMatch) =>
                candidateMatch.id === match.id ? replacement : candidateMatch,
              ),
            })),
          }
          const candidateWithRests = {
            ...candidate,
            rounds: refreshRestingPlayers(candidate.rounds, players.filter(
              (player) => player.active,
            )),
          }
          const metrics = analyzeMeetingScheduleV2(
            candidateWithRests,
            players,
            settings,
          )
          if (metrics.structuralIssues.length > 0) continue
          if (
            compareNumberTuples(balanceScore(metrics), balanceScore(base)) >= 0
          ) {
            continue
          }
          if (metrics.zeroGameStandardParticipants > 0) continue
          if (metrics.maximumInitialWaitMinutes > initialWaitLimit) continue
          if (metrics.maximumWaitMinutes > MEETING_MAX_WAIT_MINUTES) continue
          if (metrics.maximumGroupMeetings > 2) {
            continue
          }
          if (
            !allowSkillDangerIncrease &&
            metrics.skillDangerMatches > base.skillDangerMatches
          ) {
            continue
          }
          const score = [
            ...balanceScore(metrics),
            metrics.skillDangerMatches,
            metrics.skillCautionMatches,
            metrics.maximumWaitMinutes,
            metrics.repeatedGroupAssignments,
            metrics.repeatedPartnerAssignments,
            metrics.repeatedOpponentAssignments,
            metrics.averageWaitMinutes,
          ]
          if (best === null || compareNumberTuples(score, best.score) < 0) {
            best = { schedule: candidateWithRests, score }
          }
        }
      }
    }
    if (best === null) {
      if (!allowSkillDangerIncrease) {
        allowSkillDangerIncrease = true
        continue
      }
      break
    }
    repaired = best.schedule
    pass += 1
  }
  return repaired
}

const scheduleWarnings = (
  schedule: Schedule,
  state: EngineState,
  activePlayers: Player[],
  settings: MatchSettings,
  plannedSlots: PlannedMeetingSlot[],
) => {
  const warnings: string[] = []
  const regularCount = activePlayers.filter((player) => !player.isGuest).length
  if (regularCount > 35) {
    warnings.push('35명 초과 · 대규모 모임은 최선 배치로 생성했습니다.')
  }
  const specialEnabled = activePlayers.some((player) => player.isGuest)
  if (!specialEnabled && regularCount <= 35) {
    const earliestFirstStart =
      (Math.ceil(regularCount / Math.max(4, settings.courtCount * 4)) - 1) *
      settings.normalGameMinutes
    if (earliestFirstStart > MEETING_MAX_WAIT_MINUTES) {
      warnings.push(
        `첫 경기 최단 예상 ${earliestFirstStart}분 · 12분 경기 권장`,
      )
    }
  }
  if (specialEnabled) {
    const target = specialParticipantTarget(activePlayers, settings)
    const eligibleCount = activePlayers.filter(
      (player) => !player.isGuest && (player.specialMatchEligible ?? true),
    ).length
    if (settings.specialLimitEnabled && eligibleCount < target) {
      warnings.push(`스페셜 참가 대상 부족: ${eligibleCount}/${target}명`)
    } else if (state.specialParticipantIds.size < target) {
      warnings.push(
        `스페셜 참가 목표 미달: ${state.specialParticipantIds.size}/${target}명`,
      )
    }
    const plannedGames = activePlayers
      .filter((player) => player.isGuest)
      .reduce(
        (sum, guest) => sum + plannedGuestGames(guest, activePlayers, settings),
        0,
      )
    const achievedGames = [...state.guestGames.values()].reduce(
      (sum, count) => sum + count,
      0,
    )
    if (achievedGames < plannedGames) {
      warnings.push(`스페셜 경기 목표 미달: ${achievedGames}/${plannedGames}경기`)
    }
    const unplayedGuests = activePlayers.filter(
      (player) => player.isGuest && (state.guestGames.get(player.id) ?? 0) === 0,
    )
    if (unplayedGuests.length > 0) {
      warnings.push(
        `스페셜 경기 미배정: ${unplayedGuests.map((player) => player.name).join(', ')}`,
      )
    }
  }
  const scheduledMatchCount = schedule.rounds.reduce(
    (sum, round) => sum + round.matches.length,
    0,
  )
  const uniqueFourPlayerGroups = regularCount < 4
    ? 0
    : regularCount * (regularCount - 1) * (regularCount - 2) *
      (regularCount - 3) / 24
  const plannedGeneralMatchCount = plannedSlots.filter(
    (slot) => slot.kind === 'general',
  ).length
  const maximumProtectedGeneralMatches =
    uniqueFourPlayerGroups * 2
  if (
    scheduledMatchCount < plannedSlots.length &&
    plannedGeneralMatchCount > maximumProtectedGeneralMatches
  ) {
    warnings.push('동일 4인 2회 제한으로 일부 코트가 비었습니다.')
  }
  return warnings
}

export const generateMeetingScheduleV2 = (
  players: Player[],
  settings: MatchSettings,
  seedOffset = 0,
): Schedule => {
  const activePlayers = players
    .filter((player) => player.active)
    .map((player) => ({ ...player }))
  const effectiveSettings = { ...settings, seed: settings.seed + seedOffset }
  const preflightIssues = preflightMeetingGeneration(activePlayers, effectiveSettings)
  if (preflightIssues.some((issue) =>
    issue.code === 'not-enough-players' ||
    issue.code === 'not-enough-regulars-for-special' ||
    issue.code === 'no-courts' ||
    issue.code === 'no-booking-time' ||
    issue.code === 'no-playable-slot' ||
    issue.code === 'invalid-attendance-window'
  )) {
    return {
      rounds: [],
      warnings: preflightIssues.map((issue) => issue.message),
      specialCompletedIds: [],
      guestGameCounts: Object.fromEntries(
        activePlayers
          .filter((player) => player.isGuest)
          .map((player) => [player.id, 0]),
      ),
    }
  }

  const profile = resolveMeetingRuleProfile(effectiveSettings)
  const slots = attachSpecialParticipantPlans(
    planMeetingSlotsV2(activePlayers, effectiveSettings),
    activePlayers,
    effectiveSettings,
  )
  const state = initializeState(activePlayers, slots, effectiveSettings)
  const slotsByStart = new Map<number, PlannedMeetingSlot[]>()
  for (const slot of slots) {
    slotsByStart.set(slot.start, [...(slotsByStart.get(slot.start) ?? []), slot])
  }
  const rounds: Round[] = []
  const starts = [...slotsByStart.keys()].sort((left, right) => left - right)
  for (let startIndex = 0; startIndex < starts.length; startIndex += 1) {
    const start = starts[startIndex]
    const roundNumber = startIndex + 1
    const selections = chooseBatch(
      slotsByStart.get(start) ?? [],
      activePlayers,
      state,
      profile,
      effectiveSettings,
    )
    const matches = selections.map(({ slot, candidate }) => {
      const match: Match = {
        id: `v2-${slot.id}-${candidate.players
          .map((player) => player.id)
          .sort()
          .join('-')}`,
        round: roundNumber,
        court: slot.court,
        teamA: candidate.pairing.teamA,
        teamB: candidate.pairing.teamB,
        isSpecial: slot.kind === 'special',
        startOffsetMinutes: slot.start,
        durationMinutes: slot.duration,
      }
      updateState(state, match, candidate)
      return match
    })
    if (matches.length > 0) {
      rounds.push({
        id: `round-${roundNumber}`,
        number: roundNumber,
        matches,
        resting: [],
      })
    }
  }

  let schedule: Schedule = {
    rounds: refreshRestingPlayers(rounds, activePlayers),
    warnings: [],
    specialCompletedIds: [...state.specialParticipantIds],
    guestGameCounts: Object.fromEntries(state.guestGames),
  }
  schedule = repairStandardGameSpread(
    schedule,
    activePlayers,
    effectiveSettings,
  )
  const qualityMetrics = analyzeMeetingScheduleV2(
    schedule,
    activePlayers,
    effectiveSettings,
  )
  const tightMinimumPendingNames = activePlayers
    .filter(
      (player) =>
        !player.isGuest &&
        !player.gameCountFlexible &&
        (qualityMetrics.tightGameCounts[player.id] ?? 0) <
          MEETING_TIGHT_GAME_MINIMUM,
    )
    .map((player) => player.name.trim() || player.id)
  const clubQualityWarnings = state.clubQualityEnabled
    ? [
        ...qualityMetrics.qualityIssues.filter(
          (issue) =>
            !issue.startsWith(
              `타이트 경기 ${MEETING_TIGHT_GAME_MINIMUM}회 미달`,
            ),
        ),
        ...(tightMinimumPendingNames.length > 0
          ? [
              `타이트 경기 ${MEETING_TIGHT_GAME_MINIMUM}회 미달: ` +
              `${tightMinimumPendingNames.join(', ')} · ` +
              '유사 실력·성별 또는 운영 여건 확인',
            ]
          : []),
      ]
    : []
  schedule.warnings = [
    ...preflightIssues
      .filter((issue) =>
        issue.code === 'insufficient-standard-capacity' ||
        issue.code === 'insufficient-special-capacity',
      )
      .map((issue) => issue.message),
    ...scheduleWarnings(
      schedule,
      state,
      activePlayers,
      effectiveSettings,
      slots,
    ),
    ...clubQualityWarnings,
  ]
  return schedule
}

const candidateScore = (candidate: GenerationCandidate) => [
  candidate.metrics.structuralIssues.length,
  candidate.metrics.successIssues.length,
  candidate.metrics.zeroGameStandardParticipants,
  candidate.metrics.standardGameSpread,
  candidate.metrics.maximumWaitMinutes,
  candidate.metrics.participantsBelowTightMinimum,
  -candidate.metrics.participantsAtTightTarget,
  candidate.metrics.postWarmupGenderExceptionMatches,
  candidate.metrics.skillDangerMatches,
  candidate.metrics.skillCautionMatches,
  candidate.metrics.repeatedGroupAssignments,
  candidate.metrics.repeatedPartnerAssignments,
  candidate.metrics.repeatedOpponentAssignments,
  candidate.metrics.averageWaitMinutes,
  candidate.index,
]

const isSuccessfulCandidate = (candidate: GenerationCandidate) =>
  candidate.metrics.structuralIssues.length === 0 &&
  candidate.metrics.successIssues.length === 0 &&
  !candidate.schedule.warnings.some((warning) =>
    warning.startsWith('스페셜 참가 목표 미달:') ||
    warning.startsWith('스페셜 경기 목표 미달:') ||
    warning.startsWith('스페셜 경기 미배정:'),
  )

const meetsClubQualityTarget = (
  candidate: GenerationCandidate,
  players: Player[],
) => {
  const activePlayers = players.filter((player) => player.active)
  if (
    activePlayers.some((player) => player.isGuest) ||
    activePlayers.filter((player) => !player.isGuest).length > 35
  ) {
    return true
  }
  const standardPlayerCount = players.filter(
    (player) =>
      player.active && !player.isGuest && !player.gameCountFlexible,
  ).length
  return candidate.metrics.participantsBelowTightMinimum === 0 &&
    candidate.metrics.participantsAtTightTarget >=
      Math.ceil(standardPlayerCount * 0.8)
}

export const generateMeetingScheduleV2Optimized = (
  players: Player[],
  settings: MatchSettings,
  attemptCount = 3,
) => {
  const maximumAttempts = Math.min(3, Math.max(1, Math.floor(attemptCount)))
  const candidates: GenerationCandidate[] = []
  for (let index = 0; index < maximumAttempts; index += 1) {
    const schedule = generateMeetingScheduleV2(players, settings, index)
    const candidate = {
      schedule,
      metrics: analyzeMeetingScheduleV2(schedule, players, settings),
      index,
    }
    candidates.push(candidate)
    if (
      isSuccessfulCandidate(candidate) &&
      meetsClubQualityTarget(candidate, players)
    ) {
      break
    }
  }
  return [...candidates].sort((left, right) =>
    compareNumberTuples(candidateScore(left), candidateScore(right)),
  )[0]
}

const recommendedParticipantCount = (
  players: Player[],
  settings: MatchSettings,
  metrics: MeetingV2Metrics,
) => {
  const activeCount = players.filter((player) => player.active).length
  const rotationRounds =
    Math.floor(MEETING_MAX_WAIT_MINUTES / settings.normalGameMinutes) + 1
  const capacity = Math.max(4, settings.courtCount * rotationRounds * 4)
  const waitRatio = metrics.maximumWaitMinutes > MEETING_MAX_WAIT_MINUTES
    ? Math.max(
        4,
        Math.floor(
          activeCount * MEETING_MAX_WAIT_MINUTES / metrics.maximumWaitMinutes,
        ),
      )
    : activeCount
  return metrics.maximumWaitMinutes > MEETING_MAX_WAIT_MINUTES
    ? Math.min(capacity, waitRatio)
    : capacity
}

const recommendationOutcome = (
  metrics: MeetingV2Metrics,
) => ({
  maximumWaitMinutes: metrics.maximumWaitMinutes,
  maximumInitialWaitMinutes: metrics.maximumInitialWaitMinutes,
  maximumBetweenWaitMinutes: metrics.maximumBetweenWaitMinutes,
  participantsOverLimit: metrics.participantsOverWaitLimit,
})

const verifyRecommendation = (
  players: Player[],
  settings: MatchSettings,
  kind: MeetingWaitLimitFailure['recommendations'][number]['kind'],
  title: string,
  context: string,
): MeetingWaitLimitFailure['recommendations'][number] | null => {
  const candidate = generateMeetingScheduleV2Optimized(players, settings, 1)
  if (!isSuccessfulCandidate(candidate)) return null
  return {
    kind,
    title,
    detail:
      `${context} · 재계산 결과 첫 경기 최대 ` +
      `${candidate.metrics.maximumInitialWaitMinutes}분, 경기 간 최대 ` +
      `${candidate.metrics.maximumBetweenWaitMinutes}분`,
    verified: true,
    settings,
    outcome: recommendationOutcome(candidate.metrics),
  }
}

const verifiedRecommendations = (
  players: Player[],
  settings: MatchSettings,
): MeetingWaitLimitFailure['recommendations'] => {
  const recommendations: MeetingWaitLimitFailure['recommendations'] = []

  for (const duration of [12, 10] as const) {
    if (duration >= settings.normalGameMinutes) continue
    const verified = verifyRecommendation(
      players,
      { ...settings, normalGameMinutes: duration },
      'shorter-game',
      `일반 경기를 ${duration}분으로 운영`,
      '경기 시간을 줄일 수 있을 때 적용',
    )
    if (verified) {
      recommendations.push(verified)
      break
    }
  }

  const bookingMinutes = getBookingDurationMinutes(
    settings.startTime,
    settings.endTime,
  )
  for (const extensionMinutes of [10, 20, 30]) {
    if (bookingMinutes + extensionMinutes > MAX_BOOKING_MINUTES) break
    const endTime = clockTimeAtOffset(settings.endTime, extensionMinutes)
    const targetRoundCount = getBookingRoundCount(settings.startTime, endTime)
    const verified = verifyRecommendation(
      players,
      {
        ...settings,
        endTime,
        targetRoundCount,
        pacingRoundCount: targetRoundCount,
        roundCountLocked: true,
      },
      'extend-time',
      `운영 종료를 ${extensionMinutes}분 연장`,
      `${endTime} 종료가 가능할 때 적용`,
    )
    if (verified) {
      recommendations.push(verified)
      break
    }
  }

  if (settings.courtCount < 12) {
    const courtCount = settings.courtCount + 1
    const verified = verifyRecommendation(
      players,
      { ...settings, courtCount },
      'more-courts',
      `코트를 ${courtCount}개로 운영`,
      '추가 코트를 확보할 수 있을 때 적용',
    )
    if (verified) recommendations.push(verified)
  }

  return recommendations
}

export type MeetingGenerationV2Resolution = {
  schedule: Schedule
  waitLimitFailure: MeetingWaitLimitFailure | null
  failureIssues: string[]
}

export const generateMeetingScheduleV2WithWaitResolution = (
  players: Player[],
  settings: MatchSettings,
  attemptCount = 3,
  onProgress?: (message: string) => void,
): MeetingGenerationV2Resolution => {
  onProgress?.('필수 조건을 확인하고 경기 슬롯을 계획하고 있습니다.')
  const selected = generateMeetingScheduleV2Optimized(
    players,
    settings,
    attemptCount,
  )
  if (isSuccessfulCandidate(selected)) {
    return {
      schedule: selected.schedule,
      waitLimitFailure: null,
      failureIssues: [],
    }
  }

  const scheduleFailureIssues = [
    ...selected.metrics.structuralIssues,
    ...selected.metrics.successIssues.filter(
      (issue) => !issue.startsWith('최장 대기 '),
    ),
    ...selected.schedule.warnings.filter((warning) =>
      warning.includes('부족') ||
      warning.includes('미달') ||
      warning.includes('미배정'),
    ),
  ]
  if (
    selected.metrics.participantsOverWaitLimit === 0 ||
    selected.schedule.rounds.length === 0
  ) {
    return {
      schedule: selected.schedule,
      waitLimitFailure: null,
      failureIssues: [...new Set(scheduleFailureIssues)],
    }
  }

  onProgress?.('설정 변경안을 다시 계산해 통과 여부를 확인하고 있습니다.')
  const recommendedCount = recommendedParticipantCount(
    players,
    settings,
    selected.metrics,
  )
  return {
    schedule: selected.schedule,
    waitLimitFailure: {
      maximumWaitMinutes: selected.metrics.maximumWaitMinutes,
      maximumInitialWaitMinutes: selected.metrics.maximumInitialWaitMinutes,
      maximumBetweenWaitMinutes: selected.metrics.maximumBetweenWaitMinutes,
      maximumFinalIdleMinutes: selected.metrics.maximumFinalIdleMinutes,
      participantsOverLimit: selected.metrics.participantsOverWaitLimit,
      recommendedParticipantCount: recommendedCount,
      searchedScheduleCount: selected.index + 1,
      recommendations: verifiedRecommendations(players, settings),
      participantViolations: selected.metrics.participantViolations,
    },
    failureIssues: [...new Set(scheduleFailureIssues)],
  }
}
