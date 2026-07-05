import { describe, expect, it } from 'vitest'
import {
  drawPrizeWinners,
  getNextPrizeDrawLabel,
  getNextPrizeDrawLabels,
  parseMissionList,
  parsePrizeList,
  type PrizeCandidate,
} from './prizeDraw'

const candidates: PrizeCandidate[] = [
  { id: 'a', name: '1번' },
  { id: 'b', name: '2번' },
  { id: 'c', name: '스페셜 1번' },
]

describe('parsePrizeList', () => {
  it('keeps non-empty prize names in input order', () => {
    expect(parsePrizeList('셔틀콕\n\n 그립 \n음료 쿠폰')).toEqual([
      '셔틀콕',
      '그립',
      '음료 쿠폰',
    ])
  })
})

describe('parseMissionList', () => {
  it('reads number, mission, and reward from slash or comma separated lines', () => {
    expect(parseMissionList('1 / 다음 경기 이기기 / 그립\n2, 랠리 10회, 음료')).toEqual([
      {
        id: '1-다음 경기 이기기-그립',
        number: '1',
        mission: '다음 경기 이기기',
        reward: '그립',
      },
      {
        id: '2-랠리 10회-음료',
        number: '2',
        mission: '랠리 10회',
        reward: '음료',
      },
    ])
  })
})

describe('getNextPrizeDrawLabel', () => {
  it('uses named prizes in order before reporting completion', () => {
    const prizes = ['셔틀콕', '그립']

    expect(getNextPrizeDrawLabel(prizes, 0)).toBe('셔틀콕')
    expect(getNextPrizeDrawLabel(prizes, 1)).toBe('그립')
    expect(getNextPrizeDrawLabel(prizes, 2)).toBeNull()
  })

  it('falls back to draw order when no prize list is entered', () => {
    expect(getNextPrizeDrawLabel([], 0)).toBe('1번째')
    expect(getNextPrizeDrawLabel([], 2)).toBe('3번째')
  })
})

describe('getNextPrizeDrawLabels', () => {
  it('returns the requested number of named prizes from the next position', () => {
    expect(getNextPrizeDrawLabels(['셔틀콕', '그립', '양말'], 1, 2)).toEqual([
      '그립',
      '양말',
    ])
  })

  it('returns ordered draw labels when prizes are empty', () => {
    expect(getNextPrizeDrawLabels([], 2, 3)).toEqual(['3번째', '4번째', '5번째'])
  })
})

describe('drawPrizeWinners', () => {
  it('draws without duplicate winners by default', () => {
    const randomValues = [0.99, 0.99, 0.99]
    const results = drawPrizeWinners(
      ['셔틀콕', '그립', '음료'],
      candidates,
      false,
      () => randomValues.shift() ?? 0,
    )

    expect(results.map((result) => result.winnerId)).toEqual(['c', 'b', 'a'])
    expect(new Set(results.map((result) => result.winnerId)).size).toBe(3)
  })

  it('stops when prizes exceed candidates and duplicates are disabled', () => {
    const results = drawPrizeWinners(
      ['셔틀콕', '그립', '음료', '양말'],
      candidates.slice(0, 2),
      false,
      () => 0,
    )

    expect(results).toHaveLength(2)
  })

  it('allows duplicate winners when enabled', () => {
    const results = drawPrizeWinners(
      ['셔틀콕', '그립', '음료'],
      candidates,
      true,
      () => 0,
    )

    expect(results.map((result) => result.winnerId)).toEqual(['a', 'a', 'a'])
  })
})
