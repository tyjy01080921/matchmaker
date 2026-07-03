import { describe, expect, it } from 'vitest'
import { makePlayerNameLookup, playerDisplayName, teamDisplayName } from './playerNames'
import type { Player } from './types'

const makePlayer = (id: string, name: string, isGuest = false): Player => ({
  id,
  name,
  level: isGuest ? '스페셜' : 'B',
  ageGroup: '30대',
  gender: 'none',
  active: true,
  specialRequired: !isGuest,
  isGuest,
  guestGameLimit: isGuest ? 3 : 0,
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

  it('uses numbered fallback labels for unnamed players', () => {
    const first = makePlayer('p-1', '')
    const second = makePlayer('p-2', '   ')
    const guest = makePlayer('g-1', '', true)
    const names = makePlayerNameLookup([first, second, guest])

    expect(playerDisplayName(first, names)).toBe('1번')
    expect(playerDisplayName(second, names)).toBe('2번')
    expect(playerDisplayName(guest, names)).toBe('스페셜 1번')
  })
})
