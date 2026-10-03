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
