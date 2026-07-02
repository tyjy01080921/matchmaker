import { describe, expect, it } from 'vitest'
import { defaultTournamentSettings } from './defaultData'
import { generateTournamentSchedule } from './matchmaker'
import { makePlayerNameLookup } from './playerNames'
import {
  createSchedulePrintImages,
  createTournamentPrintImages,
  makePrintableScheduleItems,
  paginatePrintableScheduleItems,
  paginatePrintableTournamentItems,
  type PrintableScheduleItem,
  type PrintableTournamentItem,
} from './printSchedule'
import type {
  Match,
  MatchSettings,
  Player,
  ResultsByMatch,
  Schedule,
  TournamentResultsByMatch,
  TournamentTeam,
} from './types'

const makePlayer = (id: string, name: string): Player => ({
  id,
  name,
  level: 'B',
  ageGroup: '30대',
  gender: 'none',
  active: true,
  specialRequired: true,
  isGuest: false,
  guestGameLimit: 0,
})

const players = [
  makePlayer('p-1', '김민수'),
  makePlayer('p-2', '김민수'),
  makePlayer('p-3', '이지연'),
  makePlayer('p-4', '박태호'),
  makePlayer('p-5', '최수빈'),
] as const

const makeMatch = (index: number): Match => ({
  id: `m-${index}`,
  round: index,
  court: 1,
  teamA: [players[0], players[2]],
  teamB: [players[1], players[3]],
  isSpecial: false,
})

const makeTournamentTeam = (
  id: string,
  name: string,
  seed: number | null,
): TournamentTeam => ({
  id,
  name,
  playerNames: '',
  level: 'B',
  gender: 'none',
  seed,
  active: true,
})

describe('printable schedule', () => {
  it('includes duplicate display names in round rest lines', () => {
    const names = makePlayerNameLookup([...players])
    const schedule: Schedule = {
      rounds: [
        {
          id: 'r-1',
          number: 1,
          matches: [makeMatch(1)],
          resting: [players[0], players[1]],
        },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }

    const items = makePrintableScheduleItems(schedule, names)

    expect(items[0]).toEqual({
      kind: 'round',
      text: expect.stringContaining('김민수 1, 김민수 2'),
    })
  })

  it('splits long schedules into A4 image pages', () => {
    const items: PrintableScheduleItem[] = Array.from({ length: 60 }, (_, index) => ({
      kind: 'match',
      match: makeMatch(index + 1),
    }))
    const pages = paginatePrintableScheduleItems(items)

    expect(pages.length).toBeGreaterThan(1)
    expect(pages.flat()).toHaveLength(items.length)
  })

  it('renders schedule images without status fields', () => {
    const names = makePlayerNameLookup([...players])
    const schedule: Schedule = {
      rounds: [
        {
          id: 'r-1',
          number: 1,
          matches: [makeMatch(1)],
          resting: [],
        },
      ],
      warnings: [],
      specialCompletedIds: [],
      guestGameCounts: {},
    }
    const settings: MatchSettings = {
      eventName: '저장 테스트',
      courtCount: 1,
      seed: 1,
      singleGuestPerMatch: true,
      targetRoundCount: 8,
    }
    const images = createSchedulePrintImages({
      generatedAt: new Date('2026-07-01T00:00:00.000Z'),
      names,
      results: {} satisfies ResultsByMatch,
      schedule,
      settings,
      matchNameOverrides: {
        'm-1': {
          'p-1': '현장참가자',
        },
      },
    })
    const svg = decodeURIComponent(
      images[0].replace('data:image/svg+xml;charset=utf-8,', ''),
    )

    expect(svg).toContain('1경기')
    expect(svg).toContain('1코트')
    expect(svg).toContain('현장참가자 + 이지연')
    expect(svg).not.toContain('상태')
    expect(svg).not.toContain('점수')
  })

  it('splits long tournament schedules into A4 image pages', () => {
    const items: PrintableTournamentItem[] = Array.from(
      { length: 80 },
      (_, index) => ({
        kind: 'tournament-match',
        court: '1코트',
        label: `예선 ${index + 1}경기`,
        order: `${index + 1}순서`,
        result: '대기',
        sideA: 'A팀',
        sideB: 'B팀',
      }),
    )
    const pages = paginatePrintableTournamentItems(items)

    expect(pages.length).toBeGreaterThan(1)
    expect(pages.flat()).toHaveLength(items.length)
  })

  it('renders tournament images with seed labels and no unseeded label', () => {
    const teams = [
      makeTournamentTeam('team-1', '1팀', 1),
      makeTournamentTeam('team-2', '2팀', null),
    ]
    const settings = {
      ...defaultTournamentSettings,
      courtCount: 1,
      format: 'knockout' as const,
      includeThirdPlace: false,
    }
    const schedule = generateTournamentSchedule(
      teams,
      settings,
      {} satisfies TournamentResultsByMatch,
    )
    const images = createTournamentPrintImages({
      generatedAt: new Date('2026-07-01T00:00:00.000Z'),
      results: {} satisfies TournamentResultsByMatch,
      schedule,
      settings,
      teams,
      title: 'A.M.A Match Maker Pro',
    })
    const svg = decodeURIComponent(
      images[0].replace('data:image/svg+xml;charset=utf-8,', ''),
    )

    expect(svg).toContain('대회 대진표')
    expect(svg).toContain('1팀 (1번 시드)')
    expect(svg).toContain('2팀')
    expect(svg).toContain('결승')
    expect(svg).not.toContain('비시드')
  })
})
