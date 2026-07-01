import { describe, expect, it } from 'vitest'
import { makePlayerNameLookup } from './playerNames'
import {
  createSchedulePrintImages,
  makePrintableScheduleItems,
  paginatePrintableScheduleItems,
  type PrintableScheduleItem,
} from './printSchedule'
import type { Match, MatchSettings, Player, ResultsByMatch, Schedule } from './types'

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
})
