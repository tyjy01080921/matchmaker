import { describe, expect, it } from 'vitest'
import {
  isPreferredPartnerPair,
  preferredPartnerBonusStage,
  preferredPartnerStrength,
  preferredPartnerNames,
  resolvePreferredPartnerNames,
} from './preferredPartners'
import type { Player } from './types'

const makePlayer = (id: string, name: string): Player => ({
  id,
  name,
  level: 'B',
  ageGroup: '30대',
  gender: 'male',
  active: true,
  specialRequired: true,
  isGuest: false,
  guestGameLimit: 0,
})

describe('preferred partners', () => {
  const players = [
    makePlayer('p1', '김하나'),
    makePlayer('p2', '이둘'),
    makePlayer('p3', '박셋'),
    makePlayer('p4', '최넷'),
    makePlayer('p5', '정다섯'),
  ]

  it('resolves up to three comma-separated names to stable ids', () => {
    expect(
      resolvePreferredPartnerNames('이둘, 박셋, 최넷', players[0], players),
    ).toEqual({ ids: ['p2', 'p3', 'p4'], error: null })
  })

  it('rejects more than three names and missing participants', () => {
    expect(
      resolvePreferredPartnerNames('이둘, 박셋, 최넷, 정다섯', players[0], players).error,
    ).toContain('최대 3명')
    expect(
      resolvePreferredPartnerNames('없는사람', players[0], players).error,
    ).toContain('찾을 수 없습니다')
  })

  it('shows current names from stored ids', () => {
    expect(preferredPartnerNames(
      { ...players[0], preferredPartnerIds: ['p2', 'p3'] },
      players,
    )).toBe('이둘, 박셋')
  })

  it('treats one-sided and mutual selections as the same preferred pair', () => {
    const oneSided = { ...players[0], preferredPartnerIds: ['p2'] }
    const mutual = { ...players[1], preferredPartnerIds: ['p1'] }

    expect(isPreferredPartnerPair(oneSided, players[1])).toBe(true)
    expect(preferredPartnerStrength(oneSided, players[1])).toBe(1)
    expect(isPreferredPartnerPair(oneSided, mutual)).toBe(true)
    expect(preferredPartnerStrength(oneSided, mutual)).toBe(2)
    expect(isPreferredPartnerPair(oneSided, players[2])).toBe(false)
    expect(preferredPartnerBonusStage(oneSided, players[1], 0)).toBe('first')
    expect(preferredPartnerBonusStage(oneSided, players[1], 1)).toBe('second')
    expect(preferredPartnerBonusStage(oneSided, players[1], 2)).toBe('none')
    expect(preferredPartnerBonusStage(oneSided, players[2], 0)).toBe('none')
  })
})
