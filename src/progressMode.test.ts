import { describe, expect, it } from 'vitest'
import {
  buildMeetingCourtLanes,
  buildTournamentCourtLanes,
  getUndoableTournamentMatchId,
  getProgressWinnerSide,
  getMeetingCourtMatchNumber,
  getTournamentCourtMatchNumber,
  getProgressCourtPageSize,
  hasTournamentWinner,
  hasProgressScorePair,
  toggleProgressWinner,
  updateProgressScore,
} from './progressMode'
import type {
  Match,
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
