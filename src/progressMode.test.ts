import { describe, expect, it } from 'vitest'
import {
  assignAvailableMeetingMatch,
  assignAvailableMeetingMatchToFirstEmptyCourt,
  assignNextAvailableMeetingMatch,
  buildAvailableMeetingCourtLanes,
  buildMeetingCourtLanes,
  buildTournamentCourtLanes,
  canUndoAvailableMeetingMatch,
  getMeetingMatchSequence,
  getMeetingReplanLockedMatchIds,
  getUndoableTournamentMatchId,
  getProgressWinnerSide,
  getMeetingCourtMatchNumber,
  getTournamentCourtMatchNumber,
  getProgressCourtPageSize,
  hasTournamentWinner,
  hasProgressScorePair,
  initializeAvailableMeetingAssignments,
  toggleMeetingWinner,
  toggleProgressWinner,
  updateProgressScore,
} from './progressMode'
import type {
  Match,
  MeetingCourtAssignments,
  Player,
  Schedule,
  TournamentMatch,
} from './types'

const player = (id: string): Player => ({
  id,
  name: id,
  level: 'B',
  ageGroup: '30대',
  gender: 'male',
  active: true,
  specialRequired: false,
  isGuest: false,
  guestGameLimit: 0,
})

const meetingMatch = (
  id: string,
  court: number,
  startOffsetMinutes: number,
): Match => ({
  id,
  round: startOffsetMinutes / 15 + 1,
  court,
  teamA: [player(`${id}-a1`), player(`${id}-a2`)],
  teamB: [player(`${id}-b1`), player(`${id}-b2`)],
  isSpecial: false,
  startOffsetMinutes,
  durationMinutes: 15,
})

const meetingMatchWithPlayers = (
  id: string,
  court: number,
  startOffsetMinutes: number,
  playerIds: [string, string, string, string],
): Match => ({
  id,
  round: startOffsetMinutes / 15 + 1,
  court,
  teamA: [player(playerIds[0]), player(playerIds[1])],
  teamB: [player(playerIds[2]), player(playerIds[3])],
  isSpecial: false,
  startOffsetMinutes,
  durationMinutes: 15,
})

const tournamentMatch = (
  id: string,
  order: number,
  court: number,
  teamAId: string | undefined = `${id}-a`,
  teamBId: string | undefined = `${id}-b`,
): TournamentMatch => ({
  id,
  phase: 'knockout',
  order,
  round: Math.ceil(order / 2),
  court,
  label: `${order}경기`,
  teamAId,
  teamBId,
})

describe('progress mode helpers', () => {
  it('shows four courts on a mobile landscape viewport', () => {
    expect(getProgressCourtPageSize(915, 412)).toBe(4)
    expect(getProgressCourtPageSize(1200, 540)).toBe(4)
    expect(getProgressCourtPageSize(390, 844)).toBe(1)
    expect(getProgressCourtPageSize(1440, 900)).toBe(6)
  })

  it('keeps score entry pending and derives the winner without completing', () => {
    const withTeamA = updateProgressScore(undefined, 'A', '21')
    const withBoth = updateProgressScore(withTeamA, 'B', '17')

    expect(withBoth).toMatchObject({
      teamAScore: '21',
      teamBScore: '17',
      completed: false,
      winnerSide: 'A',
    })
    expect(hasProgressScorePair(withBoth)).toBe(true)
    expect(getProgressWinnerSide(withBoth)).toBe('A')
  })

  it('allows a scoreless winner selection and clears it when selected again', () => {
    const selected = toggleProgressWinner(undefined, 'B')
    const cleared = toggleProgressWinner(selected, 'B')

    expect(getProgressWinnerSide(selected)).toBe('B')
    expect(cleared.winnerSide).toBeUndefined()
    expect(cleared.completed).toBe(false)
  })

  it('keeps meeting winner selection separate from completion', () => {
    const pending = toggleMeetingWinner(undefined, 'A')
    const completed = toggleMeetingWinner(
      { ...pending, completed: true },
      'B',
    )

    expect(pending).toMatchObject({ winnerSide: 'A', completed: false })
    expect(completed).toMatchObject({ winnerSide: 'B', completed: true })
    expect(toggleMeetingWinner(completed, 'B')).toMatchObject({
      winnerSide: undefined,
      completed: true,
    })
  })

  it('does not derive a winner from a tied score', () => {
    const tied = updateProgressScore(
      updateProgressScore(undefined, 'A', '21'),
      'B',
      '21',
    )

    expect(hasProgressScorePair(tied)).toBe(true)
    expect(getProgressWinnerSide(tied)).toBeUndefined()
  })

  it('groups meeting matches by court and removes completed cards from pending', () => {
    const first = meetingMatch('first', 1, 0)
    const second = meetingMatch('second', 1, 15)
    const third = meetingMatch('third', 2, 0)
    const schedule: Schedule = {
      rounds: [
        { id: 'round-1', number: 1, matches: [third, second, first], resting: [] },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }

    const lanes = buildMeetingCourtLanes(schedule, {
      [first.id]: {
        teamAScore: '',
        teamBScore: '',
        completed: true,
        note: '',
      },
    })

    expect(lanes.map((lane) => lane.court)).toEqual([1, 2])
    expect(lanes[0].pending.map((match) => match.id)).toEqual(['second'])
    expect(lanes[0].completed.map((match) => match.id)).toEqual(['first'])
    expect(getMeetingCourtMatchNumber(lanes[0], second.id)).toBe(2)
  })

  it('allows a later fixed-court match to finish before the current match', () => {
    const current = meetingMatch('current', 1, 0)
    const skippedTo = meetingMatch('skipped-to', 1, 30)
    const schedule: Schedule = {
      rounds: [
        {
          id: 'round-1',
          number: 1,
          matches: [skippedTo, current],
          resting: [],
        },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }

    const lanes = buildMeetingCourtLanes(schedule, {
      [skippedTo.id]: {
        teamAScore: '21',
        teamBScore: '17',
        completed: true,
        note: '',
        winnerSide: 'A',
      },
    })

    expect(lanes[0].pending.map((match) => match.id)).toEqual(['current'])
    expect(lanes[0].completed.map((match) => match.id)).toEqual(['skipped-to'])
  })

  it('assigns the opening sequence across available courts', () => {
    const first = meetingMatchWithPlayers('first', 1, 0, ['a', 'b', 'c', 'd'])
    const second = meetingMatchWithPlayers('second', 2, 0, ['e', 'f', 'g', 'h'])
    const schedule: Schedule = {
      rounds: [
        { id: 'round-1', number: 1, matches: [second, first], resting: [] },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }

    const assignments = initializeAvailableMeetingAssignments(schedule, 2)

    expect(getMeetingMatchSequence(schedule).map((match) => match.id))
      .toEqual(['first', 'second'])
    expect(assignments).toEqual({
      first: { court: 1, dispatchOrder: 1 },
      second: { court: 2, dispatchOrder: 2 },
    })
  })

  it('skips a blocked sequence match and assigns the first playable match', () => {
    const first = meetingMatchWithPlayers('first', 1, 0, ['a', 'b', 'c', 'd'])
    const second = meetingMatchWithPlayers('second', 2, 0, ['e', 'f', 'g', 'h'])
    const blocked = meetingMatchWithPlayers('blocked', 1, 15, ['e', 'i', 'j', 'k'])
    const playable = meetingMatchWithPlayers('playable', 2, 15, ['a', 'l', 'm', 'n'])
    const schedule: Schedule = {
      rounds: [
        { id: 'round-1', number: 1, matches: [first, second], resting: [] },
        { id: 'round-2', number: 2, matches: [blocked, playable], resting: [] },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }
    const initial = initializeAvailableMeetingAssignments(schedule, 2)
    const results = {
      first: { teamAScore: '', teamBScore: '', completed: true, note: '' },
    }

    const assigned = assignNextAvailableMeetingMatch(
      schedule,
      initial,
      results,
      1,
    )

    expect(assigned.playable).toEqual({ court: 1, dispatchOrder: 3 })
    expect(assigned.blocked).toBeUndefined()
    expect(buildAvailableMeetingCourtLanes(schedule, 2, assigned, results)[0])
      .toMatchObject({ court: 1, active: { id: 'playable' } })
  })

  it('keeps a completed court empty until the operator selects a waiting match', () => {
    const first = meetingMatchWithPlayers('first', 1, 0, ['a', 'b', 'c', 'd'])
    const second = meetingMatchWithPlayers('second', 2, 0, ['e', 'f', 'g', 'h'])
    const third = meetingMatchWithPlayers('third', 1, 15, ['i', 'j', 'k', 'l'])
    const schedule: Schedule = {
      rounds: [
        { id: 'round-1', number: 1, matches: [first, second], resting: [] },
        { id: 'round-2', number: 2, matches: [third], resting: [] },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }
    const assignments = initializeAvailableMeetingAssignments(schedule, 2)

    const completedResults = {
      first: {
        teamAScore: '21',
        teamBScore: '17',
        completed: true,
        note: '',
        winnerSide: 'A' as const,
      },
    }
    const emptyLane = buildAvailableMeetingCourtLanes(
      schedule,
      2,
      assignments,
      completedResults,
    )[0]

    expect(emptyLane.active).toBeUndefined()

    const assigned = assignAvailableMeetingMatch(
      schedule,
      assignments,
      completedResults,
      1,
      third.id,
    )

    expect(assigned.third).toEqual({ court: 1, dispatchOrder: 3 })
  })

  it('places selected waiting matches into empty courts in court order', () => {
    const first = meetingMatchWithPlayers('first', 1, 0, ['a', 'b', 'c', 'd'])
    const second = meetingMatchWithPlayers('second', 2, 0, ['e', 'f', 'g', 'h'])
    const third = meetingMatchWithPlayers('third', 1, 15, ['i', 'j', 'k', 'l'])
    const fourth = meetingMatchWithPlayers('fourth', 2, 15, ['m', 'n', 'o', 'p'])
    const schedule: Schedule = {
      rounds: [
        { id: 'round-1', number: 1, matches: [first, second], resting: [] },
        { id: 'round-2', number: 2, matches: [third, fourth], resting: [] },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }
    const initial = initializeAvailableMeetingAssignments(schedule, 2)
    const completedResults = {
      first: { teamAScore: '', teamBScore: '', completed: true, note: '' },
      second: { teamAScore: '', teamBScore: '', completed: true, note: '' },
    }

    const firstPlacement = assignAvailableMeetingMatchToFirstEmptyCourt(
      schedule,
      2,
      initial,
      completedResults,
      third.id,
    )
    const secondPlacement = assignAvailableMeetingMatchToFirstEmptyCourt(
      schedule,
      2,
      firstPlacement.assignments,
      completedResults,
      fourth.id,
    )

    expect(firstPlacement.court).toBe(1)
    expect(firstPlacement.assignments.third).toEqual({ court: 1, dispatchOrder: 3 })
    expect(secondPlacement.court).toBe(2)
    expect(secondPlacement.assignments.fourth).toEqual({ court: 2, dispatchOrder: 4 })
  })

  it('only allows undo before a later match is assigned to the same court', () => {
    const first = meetingMatchWithPlayers('first', 1, 0, ['a', 'b', 'c', 'd'])
    const second = meetingMatchWithPlayers('second', 1, 15, ['e', 'f', 'g', 'h'])
    const schedule: Schedule = {
      rounds: [
        { id: 'round-1', number: 1, matches: [first], resting: [] },
        { id: 'round-2', number: 2, matches: [second], resting: [] },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }
    const results = {
      first: { teamAScore: '', teamBScore: '', completed: true, note: '' },
    }
    const firstOnly: MeetingCourtAssignments = {
      first: { court: 1, dispatchOrder: 1 },
    }
    const withLater: MeetingCourtAssignments = {
      ...firstOnly,
      second: { court: 1, dispatchOrder: 2 },
    }

    expect(canUndoAvailableMeetingMatch(schedule, 'first', firstOnly, results))
      .toBe(true)
    expect(canUndoAvailableMeetingMatch(schedule, 'first', withLater, results))
      .toBe(false)
  })

  it('locks completed and current matches on each fixed court for replanning', () => {
    const completed = meetingMatchWithPlayers('completed', 1, 0, ['a', 'b', 'c', 'd'])
    const currentOne = meetingMatchWithPlayers('current-1', 1, 15, ['e', 'f', 'g', 'h'])
    const currentTwo = meetingMatchWithPlayers('current-2', 2, 0, ['i', 'j', 'k', 'l'])
    const future = meetingMatchWithPlayers('future', 2, 15, ['m', 'n', 'o', 'p'])
    const schedule: Schedule = {
      rounds: [
        { id: 'round-1', number: 1, matches: [completed, currentTwo], resting: [] },
        { id: 'round-2', number: 2, matches: [currentOne, future], resting: [] },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }

    expect(getMeetingReplanLockedMatchIds(
      schedule,
      { completed: { teamAScore: '', teamBScore: '', completed: true, note: '' } },
      {},
      'fixed',
    )).toEqual(['completed', 'current-2', 'current-1'])
  })

  it('locks only completed and actively assigned matches in available-court mode', () => {
    const completed = meetingMatchWithPlayers('completed', 1, 0, ['a', 'b', 'c', 'd'])
    const assigned = meetingMatchWithPlayers('assigned', 2, 0, ['e', 'f', 'g', 'h'])
    const future = meetingMatchWithPlayers('future', 1, 15, ['i', 'j', 'k', 'l'])
    const schedule: Schedule = {
      rounds: [
        { id: 'round-1', number: 1, matches: [completed, assigned], resting: [] },
        { id: 'round-2', number: 2, matches: [future], resting: [] },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }

    expect(getMeetingReplanLockedMatchIds(
      schedule,
      { completed: { teamAScore: '', teamBScore: '', completed: true, note: '' } },
      {
        completed: { court: 2, dispatchOrder: 1 },
        assigned: { court: 1, dispatchOrder: 2 },
      },
      'available',
    )).toEqual(['completed', 'assigned'])
  })

  it('accepts a winner selection without requiring scores', () => {
    expect(hasTournamentWinner({
      teamAScore: '',
      teamBScore: '',
      completed: true,
      note: '',
      winnerSide: 'B',
    })).toBe(true)
  })

  it('rejects incomplete, tied, and one-sided tournament scores', () => {
    expect(hasTournamentWinner({
      teamAScore: '21',
      teamBScore: '',
      completed: true,
      note: '',
    })).toBe(false)
    expect(hasTournamentWinner({
      teamAScore: '21',
      teamBScore: '21',
      completed: true,
      note: '',
    })).toBe(false)
    expect(hasTournamentWinner({
      teamAScore: '21',
      teamBScore: '19',
      completed: false,
      note: '',
    })).toBe(false)
  })

  it('separates ready, waiting, and completed tournament cards', () => {
    const ready = tournamentMatch('ready', 1, 1)
    const completed = tournamentMatch('completed', 2, 2)
    const waiting = tournamentMatch('waiting', 3, 1, 'winner-1', '')

    const lanes = buildTournamentCourtLanes(
      [waiting, completed, ready],
      {
        [completed.id]: {
          teamAScore: '',
          teamBScore: '',
          completed: true,
          note: '',
          winnerSide: 'A',
        },
      },
    )

    expect(lanes[0].ready.map((match) => match.id)).toEqual(['ready'])
    expect(lanes[0].waiting.map((match) => match.id)).toEqual(['waiting'])
    expect(lanes[1].completed.map((match) => match.id)).toEqual(['completed'])
    expect(getTournamentCourtMatchNumber(lanes[0], waiting.id)).toBe(2)
  })

  it('only offers the latest completed tournament match for safe undo', () => {
    const first = tournamentMatch('first', 1, 1)
    const second = tournamentMatch('second', 2, 2)
    const completedResult = {
      teamAScore: '',
      teamBScore: '',
      completed: true,
      note: '',
      winnerSide: 'A' as const,
    }

    expect(getUndoableTournamentMatchId(
      [second, first],
      { first: completedResult, second: completedResult },
    )).toBe('second')
  })
})
