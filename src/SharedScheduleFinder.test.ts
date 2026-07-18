import { describe, expect, it } from 'vitest'
import {
  findSharedScheduleCandidates,
  type SharedScheduleCandidate,
} from './sharedSchedule'

const candidates: SharedScheduleCandidate[] = [
  { id: '1', name: '김 민수', searchTerms: ['민수'], items: [] },
  { id: '2', name: '김민수', subtitle: 'B팀', items: [] },
  { id: '3', name: '이지연', items: [] },
]

describe('shared schedule finder', () => {
  it('prefers exact names and ignores spaces', () => {
    expect(findSharedScheduleCandidates(candidates, '김민수').map(({ id }) => id))
      .toEqual(['1', '2'])
  })

  it('finds partial names and aliases', () => {
    expect(findSharedScheduleCandidates(candidates, '지연').map(({ id }) => id))
      .toEqual(['3'])
    expect(findSharedScheduleCandidates(candidates, '민수').map(({ id }) => id))
      .toEqual(['1'])
  })

  it('returns no candidates for a blank query', () => {
    expect(findSharedScheduleCandidates(candidates, '   ')).toEqual([])
  })
})
