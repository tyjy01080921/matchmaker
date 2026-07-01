import { describe, expect, it } from 'vitest'
import { makePlayerNameLookup, playerDisplayName, teamDisplayName } from './playerNames'
import type { Player } from './types'

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

describe('player display names', () => {
  it('adds sequence numbers only when participant names are duplicated', () => {
    const firstKim = makePlayer('p-1', '김민수')
    const lee = makePlayer('p-2', '이지연')
    const secondKim = makePlayer('p-3', '김민수')
    const names = makePlayerNameLookup([firstKim, lee, secondKim])

    expect(playerDisplayName(firstKim, names)).toBe('김민수 1')
    expect(playerDisplayName(lee, names)).toBe('이지연')
    expect(playerDisplayName(secondKim, names)).toBe('김민수 2')
    expect(teamDisplayName([firstKim, secondKim], names)).toBe('김민수 1 + 김민수 2')
  })

  it('trims blank names before numbering', () => {
    const names = makePlayerNameLookup([
      makePlayer('p-1', '  참가자  '),
      makePlayer('p-2', '참가자'),
    ])

    expect(names).toEqual({
      'p-1': '참가자 1',
      'p-2': '참가자 2',
    })
  })
})
