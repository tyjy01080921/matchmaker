import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaultData'
import { unequalFixedRotationIds, validateMeetingFairness, validateMeetingSchedule, appendGeneralCourtGames, replanMeetingSchedule, fixedPartnerIssues, fixedPartnersAllowTeams, generateSchedule, mutualPartnerIds } from './matchmaker'
import { generateMeetingScheduleV2, generateMeetingScheduleV2WithWaitResolution } from './matchmaker/engine'
import { analyzeMeetingScheduleV2 } from './matchmaker/validation'
import type { MatchSettings, Player, Schedule } from './types'

const roster = (count = 8): Player[] => Array.from({ length: count }, (_, i) => ({
  id: `p${i}`, name: `참가자${i}`, level: 'B', gender: 'male', ageGroup: '30대',
  active: true, isGuest: false, specialRequired: false, guestGameLimit: 0,
}))
const settings = { ...defaultSettings, courtCount: 1, startTime: '18:00', endTime: '19:00',
  normalGameMinutes: 10 as const, targetRoundCount: 6, pacingRoundCount: 6, roundCountLocked: true }
const link = (players: Player[], a: number, b: number) => {
  players[a].preferredPartnerIds = [...(players[a].preferredPartnerIds ?? []), players[b].id]
  players[b].preferredPartnerIds = [...(players[b].preferredPartnerIds ?? []), players[a].id]
}
const expectFixed = (schedule: Schedule, players: Player[], matchSettings: MatchSettings = settings) => {
  const matches = schedule.rounds.flatMap((round) => round.matches).filter((match) => !match.isSpecial && !match.isEventMatch)
  expect(matches.length).toBeGreaterThan(0)
  for (const match of matches) expect(fixedPartnersAllowTeams(match.teamA, match.teamB, players)).toBe(true)
  expect(analyzeMeetingScheduleV2(schedule, players, matchSettings).structuralIssues).toEqual([])
}

describe('mutual fixed partners', () => {
  it('requires a designated teammate, while one-sided preferences stay optional', () => {
    const players = roster(4)
    players[0].preferredPartnerIds = ['p1']
    expect(fixedPartnersAllowTeams([players[0], players[2]], [players[1], players[3]], players)).toBe(true)
    link(players, 0, 1)
    expect(fixedPartnersAllowTeams([players[0], players[2]], [players[1], players[3]], players)).toBe(false)
  })
  it('keeps fixed pairs through generation and optimization across seeds', () => {
    const players = roster()
    link(players, 0, 1)
    for (const seed of [1, 11, 23]) {
      expectFixed(generateMeetingScheduleV2(players, { ...settings, seed }), players)
    }
    expectFixed(generateSchedule(players, settings), players)
    expectFixed(generateMeetingScheduleV2WithWaitResolution(players, settings, 2).schedule, players)
  })
  it('alternates two mutual partners without assigning an outsider', () => {
    const players = roster()
    // A triangle lets both rotating partners play with each other while resting the anchor.
    link(players, 0, 1); link(players, 0, 2); link(players, 1, 2)
    const extended = { ...settings, endTime: '20:00' }
    const schedule = generateMeetingScheduleV2(players, extended)
    expectFixed(schedule, players, extended)
    const partners = new Set(schedule.rounds.flatMap((round) => round.matches)
      .flatMap((match) => [match.teamA, match.teamB])
      .filter((team) => team.some((player) => player.id === 'p0'))
      .flatMap((team) => team.filter((player) => player.id !== 'p0').map((player) => player.id)))
    expect([...partners].sort()).toEqual(['p1', 'p2'])
  })
  it('rotates a participant between two mutually designated partners', () => {
    const players = roster()
    link(players, 0, 1); link(players, 0, 2)
    const schedule = generateMeetingScheduleV2(players, { ...settings, endTime: '20:00' })
    const partners = new Set<string>()
    for (const match of schedule.rounds.flatMap((round) => round.matches)) {
      expect(fixedPartnersAllowTeams(match.teamA, match.teamB, players)).toBe(true)
      for (const team of [match.teamA, match.teamB]) {
        if (team.some((player) => player.id === 'p0')) {
          partners.add(team.find((player) => player.id !== 'p0')!.id)
        }
      }
    }
    expect([...partners].sort()).toEqual(['p1', 'p2'])
  })
  it('reports infeasibility instead of splitting a fixed triangle with only four players', () => {
    const players = roster(4)
    link(players, 0, 1); link(players, 0, 2); link(players, 1, 2)
    const resolution = generateMeetingScheduleV2WithWaitResolution(players, settings, 1)
    expect(resolution.schedule.rounds).toEqual([])
    expect(resolution.failureIssues.length).toBeGreaterThan(0)
  })
  it('keeps fixed partners when extending or replanning the schedule', () => {
    const players = roster()
    link(players, 0, 1); link(players, 0, 2)
    const schedule = generateMeetingScheduleV2(players, settings)
    const extended = appendGeneralCourtGames(schedule, players, { ...settings, endTime: '20:00' })
    expect(extended.addedMatchIds.length).toBeGreaterThan(0)
    expectFixed(extended.schedule, players, { ...settings, endTime: '20:00' })
    const replanned = replanMeetingSchedule({
      schedule, players, previousPlayers: players, settings, results: {}, assignments: {}, lockedMatchIds: [],
    })
    expect(replanned.createdMatchIds.length).toBeGreaterThan(0)
    expectFixed(replanned.schedule, players)
  })
  it('validates current preferences and permits explicitly locked historical matches', () => {
    const players = roster(4)
    const historicalPlayers = structuredClone(players)
    link(players, 0, 1)
    const schedule: Schedule = {
      rounds: [{ id: 'r1', number: 1, resting: [], matches: [{
        id: 'old', round: 1, court: 1, isSpecial: false, startOffsetMinutes: 0, durationMinutes: 10,
        teamA: [historicalPlayers[0], historicalPlayers[2]],
        teamB: [historicalPlayers[1], historicalPlayers[3]],
      }] }], warnings: [], specialCompletedIds: [], guestGameCounts: {},
    }
    expect(analyzeMeetingScheduleV2(schedule, players, settings).structuralIssues)
      .toContain('상호 고정 파트너 배정 위반')
    expect(validateMeetingSchedule(schedule, players, settings)).toContain('상호 고정 파트너 배정 위반')
    const options = { allowedFixedPartnerMatchIds: ['old'] }
    expect(analyzeMeetingScheduleV2(schedule, players, settings, options).structuralIssues).toEqual([])
    expect(validateMeetingSchedule(schedule, players, settings, options)).toEqual([])
  })
  it('does not block a two-partner rotation with an impossible equal-game quota', () => {
    const players = roster(16)
    link(players, 0, 1); link(players, 0, 2)
    const matchSettings = { ...settings, courtCount: 3 }
    const resolution = generateMeetingScheduleV2WithWaitResolution(players, matchSettings, 2)
    expectFixed(resolution.schedule, players, matchSettings)
    expect(resolution.schedule.rounds.flatMap((round) => round.matches)).toHaveLength(18)
    expect(resolution.failureIssues).toEqual([])
    expect(resolution.waitLimitFailure).toBeNull()
    expect(validateMeetingFairness(resolution.schedule, players)).toEqual([])
    const metrics = analyzeMeetingScheduleV2(resolution.schedule, players, matchSettings)
    expect(metrics.standardGameSpread).toBeGreaterThan(1)
    expect(metrics.qualityIssues.some((issue) => issue.startsWith('고정 파트너 교대'))).toBe(true)
    expect(metrics.maximumBetweenWaitMinutes).toBeLessThanOrEqual(10)
  })
  it('limits unequal-game exceptions to rotating paths rather than independent fixed pairs or cycles', () => {
    const players = roster()
    link(players, 0, 1); link(players, 0, 2)
    link(players, 3, 4); link(players, 4, 5); link(players, 3, 5)
    link(players, 6, 7)
    expect([...unequalFixedRotationIds(players)].sort()).toEqual(['p0', 'p1', 'p2'])
  })
  it('still rejects unfair counts among participants outside a fixed rotation', () => {
    const players = roster()
    link(players, 0, 1); link(players, 0, 2)
    const schedule: Schedule = {
      rounds: [1, 2, 1].map((partner, i) => ({ id: `r${i}`, number: i + 1, resting: [], matches: [{
        id: `m${i}`, round: i + 1, court: 1, isSpecial: false, startOffsetMinutes: i * 10, durationMinutes: 10,
        teamA: [players[0], players[partner]], teamB: [players[3], players[4]],
      }] })), warnings: [], specialCompletedIds: [], guestGameCounts: {},
    }
    expect(analyzeMeetingScheduleV2(schedule, players, settings).successIssues)
      .toContain('일반 참가자 경기 수 차 3경기')
    expect(validateMeetingFairness(schedule, players).some((issue) => issue.includes('경기 수 차'))).toBe(true)
  })
  it('does not starve fixed partners when court capacity is scarce', () => {
    const players = roster(48)
    link(players, 0, 1); link(players, 0, 2)
    const matchSettings = { ...settings, courtCount: 3, endTime: '20:00', normalGameMinutes: 12 as const }
    const resolution = generateMeetingScheduleV2WithWaitResolution(players, matchSettings, 2)
    expectFixed(resolution.schedule, players, matchSettings)
    const metrics = analyzeMeetingScheduleV2(resolution.schedule, players, matchSettings)
    expect(metrics.maximumWaitMinutes).toBeLessThanOrEqual(48)
    expect(metrics.maximumFinalIdleMinutes).toBeLessThanOrEqual(48)
    expect(resolution.schedule.rounds.flatMap((round) => round.matches)).toHaveLength(30)
  }, 30000)
  it('rotates a fixed cycle even when one pairing has a better soft skill balance', () => {
    const players = roster(4)
    players[2].level = 'C'; players[3].level = 'C'
    link(players, 0, 1); link(players, 1, 2); link(players, 2, 3); link(players, 3, 0)
    const schedule = generateMeetingScheduleV2(players, settings)
    expectFixed(schedule, players)
    const counts = new Map<string, number>()
    for (const match of schedule.rounds.flatMap((round) => round.matches)) {
      for (const team of [match.teamA, match.teamB]) {
        if (team.some((player) => player.id === 'p0')) {
          const partner = team.find((player) => player.id !== 'p0')!.id
          counts.set(partner, (counts.get(partner) ?? 0) + 1)
        }
      }
    }
    expect(counts.get('p1')).toBe(3)
    expect(counts.get('p3')).toBe(3)
  })
  it('allows repeated groups when fixed pairs would otherwise have no game', () => {
    const players = roster(4)
    link(players, 0, 1); link(players, 2, 3)
    const schedule = generateMeetingScheduleV2(players, settings)
    expectFixed(schedule, players)
    expect(schedule.rounds.flatMap((round) => round.matches).length).toBe(6)
    const metrics = analyzeMeetingScheduleV2(schedule, players, settings)
    expect(metrics.maximumBetweenWaitMinutes).toBe(0)
    expect(metrics.maximumFinalIdleMinutes).toBe(0)
    expect(analyzeMeetingScheduleV2(schedule, players, settings).successIssues
      .some((issue) => issue.startsWith('동일 4인'))).toBe(false)
  })
  it('does not release a fixed player when the only partner is inactive', () => {
    const players = roster()
    link(players, 0, 1)
    players[1].active = false
    const schedule = generateMeetingScheduleV2(players, settings)
    expect(schedule.rounds.flatMap((round) => round.matches).flatMap((match) => [...match.teamA, ...match.teamB])
      .some((player) => player.id === 'p0')).toBe(false)
    expect(mutualPartnerIds(players[0], players)).toEqual(['p1'])
  })
  it('rejects more than two mutual partners with a concrete warning', () => {
    const players = roster()
    link(players, 0, 1); link(players, 0, 2); link(players, 0, 3)
    expect(fixedPartnerIssues(players)).toEqual(['참가자0: 상호 고정 파트너는 최대 2명입니다.'])
    const schedule = generateMeetingScheduleV2(players, settings)
    expect(schedule.rounds).toEqual([])
    expect(schedule.warnings).toEqual(fixedPartnerIssues(players))
  })
})
