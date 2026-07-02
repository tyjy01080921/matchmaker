import { describe, expect, it } from 'vitest'
import { drawPrizeWinners, parsePrizeList, type PrizeCandidate } from './prizeDraw'

const candidates: PrizeCandidate[] = [
  { id: 'a', name: '참가자 1' },
  { id: 'b', name: '참가자 2' },
  { id: 'c', name: '스페셜 1' },
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
