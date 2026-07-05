import { describe, expect, it } from 'vitest'
import { parseBulkPlayerDrafts } from './playerInput'

describe('parseBulkPlayerDrafts', () => {
  it('keeps the first token as the participant name even when it looks numeric', () => {
    const [player] = parseBulkPlayerDrafts('40 A 남 30대')

    expect(player).toMatchObject({
      name: '40',
      level: 'A',
      gender: 'male',
      ageGroup: '30대',
    })
  })

  it('classifies level, gender, and age after the name in any order', () => {
    const players = parseBulkPlayerDrafts('박태호 남 30 B\n최수빈 40 여 A')

    expect(players).toEqual([
      expect.objectContaining({
        name: '박태호',
        level: 'B',
        gender: 'male',
        ageGroup: '30대',
      }),
      expect.objectContaining({
        name: '최수빈',
        level: 'A',
        gender: 'female',
        ageGroup: '40대',
      }),
    ])
  })

  it('recognizes numeric age tokens without treating them as levels', () => {
    const [player] = parseBulkPlayerDrafts('김민수 40 남')

    expect(player).toMatchObject({
      name: '김민수',
      level: 'O',
      gender: 'male',
      ageGroup: '40대',
    })
  })
})
