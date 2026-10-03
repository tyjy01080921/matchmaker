import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaultData'
import { planTwoGuestReservations, twoGuestShortageReasons, validateMeetingSchedule, replanMeetingSchedule, makeDefaultMeetingContinuationState } from './matchmaker'
import { generateMeetingScheduleV2, generateMeetingScheduleV2WithWaitResolution } from './matchmaker/engine'
import { analyzeMeetingScheduleV2 } from './matchmaker/validation'
import type { MatchSettings, Player } from './types'

const players = (guests = 2, regulars = 8): Player[] => Array.from(
  { length: guests + regulars }, (_, index) => ({
    id: `p${index}`, name: `선수 ${index}`, level: index < guests ? '스페셜' : 'C',
    ageGroup: '30대', gender: 'male', active: true, isGuest: index < guests,
    specialRequired: index >= guests, specialMatchEligible: true, guestGameLimit: 0,
  }),
)
const settings: MatchSettings = {
  ...defaultSettings, startTime: '09:00', endTime: '10:00', normalGameMinutes: 12,
  courtCount: 2, singleGuestPerMatch: false, specialComposition: 'two-plus-two',
  specialShortagePolicy: 'strict', specialLimitEnabled: true,
  specialGameLimitEnabled: true, specialGameLimit: 2, specialParticipantTarget: 4,
  specialTimeLimitEnabled: false, specialLowPriorityEnabled: false,
  specialHighPriorityEnabled: false, eventMatch: { ...defaultSettings.eventMatch, enabled: false },
}

describe('스페셜 2 + 참가자 2', () => {
  it('reserves both guests together and counts each appearance once', () => {
    const slots = planTwoGuestReservations(players(), settings)
    expect(slots).toHaveLength(2)
    expect(slots.every((slot) => slot.guestId && slot.roamingGuestId)).toBe(true)
    expect(twoGuestShortageReasons(players(), settings)).toEqual([])
  })

  it('generates exactly 2+2 with a special player on each team', () => {
    const roster = players()
    const schedule = generateMeetingScheduleV2(roster, settings)
    const special = schedule.rounds.flatMap((round) => round.matches).filter((match) => match.isSpecial)
    expect(special).toHaveLength(2)
    for (const match of special) {
      expect(match.teamA.filter((player) => player.isGuest)).toHaveLength(1)
      expect(match.teamB.filter((player) => player.isGuest)).toHaveLength(1)
      expect(new Set([...match.teamA, ...match.teamB].map((player) => player.id)).size).toBe(4)
    }
    expect(schedule.guestGameCounts.p0).toBe(2)
    expect(schedule.guestGameCounts.p1).toBe(2)
    expect(analyzeMeetingScheduleV2(schedule, roster, settings).structuralIssues).toEqual([])
  })

  it('reports missing people and never silently substitutes in strict mode', () => {
    const roster = players(1)
    expect(twoGuestShortageReasons(roster, settings).join(' ')).toContain('스페셜 1명')
    const schedule = generateMeetingScheduleV2(roster, settings)
    expect(schedule.rounds.flatMap((round) => round.matches).filter((match) => match.isSpecial)).toHaveLength(0)
    expect(schedule.warnings.some((warning) => warning.includes('미배정'))).toBe(true)
  })

  it('uses 1+3 only after explicit flexible selection and reports replacements', () => {
    const flexible = { ...settings, specialShortagePolicy: 'flexible' as const }
    const roster = players(1)
    const schedule = generateMeetingScheduleV2(roster, flexible)
    const special = schedule.rounds.flatMap((round) => round.matches).filter((match) => match.isSpecial)
    expect(special.length).toBeGreaterThan(0)
    expect(special.every((match) => [...match.teamA, ...match.teamB].filter((player) => player.isGuest).length === 1)).toBe(true)
    expect(schedule.warnings.join(' ')).toContain('2+2 대체 구성')
    expect(analyzeMeetingScheduleV2(schedule, roster, flexible).structuralIssues).toEqual([])
  })

  it('keeps two special players when flexible mode has enough people', () => {
    const schedule = generateMeetingScheduleV2(players(), { ...settings, specialShortagePolicy: 'flexible' })
    const special = schedule.rounds.flatMap((round) => round.matches).filter((match) => match.isSpecial)
    expect(special).toHaveLength(2)
    expect(special.every((match) => [...match.teamA, ...match.teamB].filter((player) => player.isGuest).length === 2)).toBe(true)
  })

  it('reports non-overlapping attendance and excludes unavailable players', () => {
    const roster = players()
    roster[0].departureOffsetMinutes = 24
    roster[1].arrivalOffsetMinutes = 24
    expect(twoGuestShortageReasons(roster, settings).length).toBeGreaterThan(0)
    expect(planTwoGuestReservations(roster, settings)).toEqual([])
    const flexible = { ...settings, specialShortagePolicy: 'flexible' as const }
    const schedule = generateMeetingScheduleV2(roster, flexible)
    expect(analyzeMeetingScheduleV2(schedule, roster, flexible).structuralIssues).toEqual([])
  })

  it('rejects a manually changed 1+3 game under strict settings', () => {
    const roster = players()
    const schedule = generateMeetingScheduleV2(roster, settings)
    const match = schedule.rounds.flatMap((round) => round.matches).find((match) => match.isSpecial)!
    const assigned = new Set([...match.teamA, ...match.teamB].map((player) => player.id))
    const replacement = roster.find((player) => !player.isGuest && !assigned.has(player.id))!
    match.teamA = match.teamA.map((player) => player.isGuest ? replacement : player) as typeof match.teamA
    expect(analyzeMeetingScheduleV2(schedule, roster, settings).structuralIssues).toContain('스페셜 2+2 구성 위반')
    expect(validateMeetingSchedule(schedule, roster, settings)).toContain('스페셜 2+2 구성 위반')
  })

  it('spreads paired appearances through the booking when spread is selected', () => {
    const slots = planTwoGuestReservations(players(), { ...settings, specialScheduleMode: 'spread' })
    expect(slots).toHaveLength(2)
    expect(slots[1].start - slots[0].start).toBeGreaterThan(settings.normalGameMinutes)
  })

  it('supports the minimum two guests and two participants', () => {
    const roster = players(2, 2)
    const schedule = generateMeetingScheduleV2(roster, { ...settings, courtCount: 1, endTime: '09:24', specialParticipantTarget: 2 })
    const matches = schedule.rounds.flatMap((round) => round.matches)
    expect(matches).toHaveLength(2)
    expect(matches.every((match) => match.isSpecial)).toBe(true)
  })

  it('keeps event reservations and the following rest clear', () => {
    const roster = players()
    const eventSettings: MatchSettings = { ...settings, specialGameLimit: 3,
      eventMatch: { ...settings.eventMatch, enabled: true, scheduleMode: 'fixed', startTime: '09:12', court: 1,
        participants: roster.slice(0, 4).map((player) => ({ name: player.name, playerId: player.id })) as MatchSettings['eventMatch']['participants'],
      },
    }
    const slots = planTwoGuestReservations(roster, eventSettings)
    expect(slots.some((slot) => slot.start === 12 || slot.start === 24)).toBe(false)
    const schedule = generateMeetingScheduleV2(roster, eventSettings)
    expect(schedule.rounds.flatMap((round) => round.matches).filter((match) => match.isEventMatch)).toHaveLength(1)
    expect(analyzeMeetingScheduleV2(schedule, roster, eventSettings).structuralIssues).toEqual([])
  })

  it('preserves completed matches and enforces 2+2 when replanning', () => {
    const roster = players()
    const replanSettings = { ...settings, specialGameLimit: 4, specialParticipantTarget: 8 }
    const schedule = generateMeetingScheduleV2(roster, replanSettings)
    const locked = schedule.rounds[0].matches
    const result = replanMeetingSchedule({
      schedule, players: roster, previousPlayers: roster, settings: replanSettings,
      results: Object.fromEntries(locked.map((match) => [match.id, {
        teamAScore: '21', teamBScore: '12', completed: true, note: '',
      }])), assignments: {}, lockedMatchIds: locked.map((match) => match.id),
      continuation: makeDefaultMeetingContinuationState(),
    })
    expect(result.failureIssues).toEqual([])
    expect(result.createdMatchIds.length).toBeGreaterThan(0)
    const matches = result.schedule.rounds.flatMap((round) => round.matches)
    for (const original of locked) expect(matches.find((match) => match.id === original.id)).toEqual(original)
    const special = matches.filter((match) => result.createdMatchIds.includes(match.id) && match.isSpecial)
    expect(special.length).toBeGreaterThan(0)
    expect(special.every((match) => match.teamA.filter((player) => player.isGuest).length === 1 && match.teamB.filter((player) => player.isGuest).length === 1)).toBe(true)
  })


  it('lets an explicitly accepted unassigned special remain an operational warning', () => {
    const roster = players(1)
    const accepted = { ...settings, specialShortageAccepted: true }
    const result = generateMeetingScheduleV2WithWaitResolution(roster, accepted, 1)
    expect(result.schedule.rounds.length).toBeGreaterThan(0)
    expect(result.waitLimitFailure).toBeNull()
    expect(result.failureIssues.length).toBeGreaterThan(0)
    expect(result.failureIssues.every((issue) => issue.startsWith('스페셜'))).toBe(true)
    expect(result.schedule.warnings.some((warning) => warning.includes('미배정'))).toBe(true)
    const unaccepted = analyzeMeetingScheduleV2(result.schedule, roster, settings)
    expect(unaccepted.participantViolations.some((violation) => violation.playerId === 'p0' && violation.phase === 'unassigned')).toBe(true)
  })

})

describe('전체 시간에서 2+2 우선 배정', () => {
  const flexible: MatchSettings = { ...settings, specialShortagePolicy: 'flexible' }
  const specialMatches = (schedule: ReturnType<typeof generateMeetingScheduleV2>) =>
    schedule.rounds.flatMap((round) => round.matches).filter((match) => match.isSpecial && !match.isEventMatch)
  const guestCount = (match: ReturnType<typeof specialMatches>[number]) =>
    [...match.teamA, ...match.teamB].filter((player) => player.isGuest).length

  it('waits for the later guest instead of spending the early guest budget on 1+3', () => {
    const roster = players()
    roster[1].arrivalOffsetMinutes = 24
    const strictPlan = planTwoGuestReservations(roster, settings)
    const flexiblePlan = planTwoGuestReservations(roster, flexible)
    expect(strictPlan).toHaveLength(2)
    expect(flexiblePlan).toEqual(strictPlan)
    expect(flexiblePlan.every((slot) => slot.start >= 24 && slot.roamingGuestId)).toBe(true)
    const schedule = generateMeetingScheduleV2(roster, flexible)
    expect(specialMatches(schedule)).toHaveLength(2)
    expect(specialMatches(schedule).every((match) => guestCount(match) === 2)).toBe(true)
    expect(analyzeMeetingScheduleV2(schedule, roster, flexible).structuralIssues).toEqual([])
  })

  it('reserves the shared time first and uses only residual appearances outside it', () => {
    const roster = players()
    roster[0].departureOffsetMinutes = 36
    roster[1].arrivalOffsetMinutes = 24
    const slots = planTwoGuestReservations(roster, flexible)
    const pairs = slots.filter((slot) => slot.roamingGuestId)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].start).toBe(24)
    expect(slots.filter((slot) => !slot.roamingGuestId)).toHaveLength(2)
    const schedule = generateMeetingScheduleV2(roster, flexible)
    expect(specialMatches(schedule).filter((match) => guestCount(match) === 2)).toHaveLength(1)
    expect(specialMatches(schedule).filter((match) => guestCount(match) === 1)).toHaveLength(2)
    expect(schedule.guestGameCounts).toMatchObject({ p0: 2, p1: 2 })
    expect(analyzeMeetingScheduleV2(schedule, roster, flexible).structuralIssues).toEqual([])
  })

  it('does not insert an early fallback that would exhaust the rest allowance before a pair', () => {
    const roster = players()
    roster[0].arrivalOffsetMinutes = 0
    roster[1].arrivalOffsetMinutes = 24
    const constrained = { ...flexible, specialGameLimit: 3, specialParticipantTarget: 8 }
    const slots = planTwoGuestReservations(roster, constrained)
    expect(slots.filter((slot) => slot.roamingGuestId).map((slot) => slot.start)).toEqual([24, 36])
    expect(slots.filter((slot) => !slot.roamingGuestId).map((slot) => slot.start)).toEqual([0])
    const schedule = generateMeetingScheduleV2(roster, constrained)
    expect(specialMatches(schedule).filter((match) => guestCount(match) === 2)).toHaveLength(2)
    expect(analyzeMeetingScheduleV2(schedule, roster, constrained).structuralIssues).toEqual([])
  })

  it('does not treat spread preferences as a reason to replace a feasible 2+2', () => {
    const roster = players()
    roster[0].departureOffsetMinutes = 24
    const slots = planTwoGuestReservations(roster, { ...flexible, specialScheduleMode: 'spread' })
    expect(slots).toHaveLength(2)
    expect(slots.every((slot) => slot.roamingGuestId)).toBe(true)
    expect(slots.map((slot) => slot.start)).toEqual([0, 12])
  })

  it('pairs guests with short attendance windows before spending flexible guests', () => {
    const roster = players(4)
    roster[2].departureOffsetMinutes = 12
    roster[3].arrivalOffsetMinutes = 12
    const slots = planTwoGuestReservations(roster, { ...flexible, specialGameLimit: 1 })
    expect(slots).toHaveLength(2)
    expect(slots.every((slot) => slot.roamingGuestId)).toBe(true)
    expect(new Set(slots.flatMap((slot) => [slot.guestId, slot.roamingGuestId])).size).toBe(4)
  })

  it('allows 1+3 when no attendance overlap remains', () => {
    const roster = players()
    roster[0].departureOffsetMinutes = 24
    roster[1].arrivalOffsetMinutes = 24
    const slots = planTwoGuestReservations(roster, flexible)
    expect(slots).toHaveLength(4)
    expect(slots.every((slot) => !slot.roamingGuestId)).toBe(true)
    const schedule = generateMeetingScheduleV2(roster, flexible)
    expect(specialMatches(schedule).every((match) => guestCount(match) === 1)).toBe(true)
    expect(specialMatches(schedule).length).toBeGreaterThan(0)
  })

  it('keeps future pairs and completed games when replanning after play starts', () => {
    const roster = players()
    roster[1].arrivalOffsetMinutes = 24
    const original = generateMeetingScheduleV2(roster, settings)
    const locked = original.rounds[0].matches
    const result = replanMeetingSchedule({
      schedule: original, players: roster, previousPlayers: roster, settings: flexible,
      results: Object.fromEntries(locked.map((match) => [match.id, {
        teamAScore: '21', teamBScore: '12', completed: true, note: '',
      }])), assignments: {}, lockedMatchIds: locked.map((match) => match.id),
      continuation: makeDefaultMeetingContinuationState(),
    })
    expect(result.failureIssues).toEqual([])
    const matches = result.schedule.rounds.flatMap((round) => round.matches)
    for (const match of locked) expect(matches.find((next) => next.id === match.id)).toEqual(match)
    const createdSpecial = specialMatches(result.schedule).filter((match) => result.createdMatchIds.includes(match.id))
    expect(createdSpecial).toHaveLength(2)
    expect(createdSpecial.every((match) => guestCount(match) === 2)).toBe(true)
  })

  it('keeps the same 2+2 reservations through an event and its required rest', () => {
    const roster = players()
    const eventSettings: MatchSettings = { ...flexible,
      eventMatch: { ...settings.eventMatch, enabled: true, scheduleMode: 'fixed', startTime: '09:12', court: 1,
        participants: [roster[0], ...roster.slice(2, 5)].map((player) => ({ name: player.name, playerId: player.id })) as MatchSettings['eventMatch']['participants'],
      },
    }
    const strict = planTwoGuestReservations(roster, { ...eventSettings, specialShortagePolicy: 'strict' })
    const fallback = planTwoGuestReservations(roster, eventSettings)
    expect(strict).toHaveLength(2)
    expect(fallback).toEqual(strict)
    expect(fallback.some((slot) => slot.start === 12 || slot.start === 24)).toBe(false)
  })

  it('does not turn a group-repeat rejection into permission for 1+3', () => {
    const roster = players(2, 3)
    const repeated: MatchSettings = { ...flexible, courtCount: 1, endTime: '10:24',
      specialGameLimit: 7, specialParticipantTarget: 3 }
    const schedule = generateMeetingScheduleV2(roster, repeated)
    const matches = specialMatches(schedule)
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.length).toBeLessThan(7)
    expect(matches.every((match) => guestCount(match) === 2)).toBe(true)
    expect(schedule.warnings.join(' ')).toContain('스페셜 경기 목표 미달')
  })

  it('preserves required rest leading into a fixed event as well as after it', () => {
    const roster = players()
    roster[0].arrivalOffsetMinutes = 0
    const eventSettings: MatchSettings = { ...flexible,
      eventMatch: { ...settings.eventMatch, enabled: true, scheduleMode: 'fixed', startTime: '09:24', court: 1,
        participants: [roster[0], ...roster.slice(2, 5)].map((player) => ({ name: player.name, playerId: player.id })) as MatchSettings['eventMatch']['participants'],
      },
    }
    const slots = planTwoGuestReservations(roster, eventSettings)
    expect(slots.map((slot) => slot.start)).toEqual([0, 48])
    expect(slots.every((slot) => slot.roamingGuestId)).toBe(true)
    const schedule = generateMeetingScheduleV2(roster, eventSettings)
    expect(analyzeMeetingScheduleV2(schedule, roster, eventSettings).structuralIssues).toEqual([])
  })

})
