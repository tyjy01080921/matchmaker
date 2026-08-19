import { describe, expect, it } from 'vitest'
import { filterEventMatchPlayerOptions } from './eventMatchPlayerSearch'

const options = [
  { id: '1', name: '김민수' },
  { id: '2', name: '박민지' },
  { id: '3', name: '이서준' },
]

describe('event match player search', () => {
  it('does not reveal the participant list before typing', () => {
    expect(filterEventMatchPlayerOptions(options, '')).toEqual([])
    expect(filterEventMatchPlayerOptions(options, '   ')).toEqual([])
  })

  it('only returns participants whose names contain the typed text', () => {
    expect(filterEventMatchPlayerOptions(options, '민')).toEqual([
      { id: '1', name: '김민수' },
      { id: '2', name: '박민지' },
    ])
    expect(filterEventMatchPlayerOptions(options, '서준')).toEqual([
      { id: '3', name: '이서준' },
    ])
  })

  it('limits the number of visible suggestions', () => {
    const manyOptions = Array.from({ length: 12 }, (_, index) => ({
      id: String(index),
      name: `김참가자${index}`,
    }))

    expect(filterEventMatchPlayerOptions(manyOptions, '김')).toHaveLength(8)
  })
})
