import { describe, expect, it } from 'vitest'
import { analyzeParticipants } from './participantAnalysis'
import type { Player } from './types'

const player = (overrides: Partial<Player>): Player => ({
  id: 'player',
  name: '참가자',
  level: 'O',
  ageGroup: '무관',
  gender: 'none',
  active: true,
  specialRequired: false,
  isGuest: false,
  guestGameLimit: 0,
  ...overrides,
})

describe('participant analysis', () => {
  it('keeps a name-only roster on the direct creation path', () => {
    const analysis = analyzeParticipants([
      player({ id: 'one', name: '1번' }),
      player({ id: 'two', name: '2번' }),
      player({ id: 'inactive', active: false, level: 'A' }),
    ])

    expect(analysis.hasStructuredInput).toBe(false)
    expect(analysis.activeCount).toBe(2)
    expect(analysis.incompleteRegulars.map((item) => item.id)).toEqual([
      'one',
      'two',
    ])
  })

  it('opens analysis for detailed or partial participant information', () => {
    const analysis = analyzeParticipants([
      player({ id: 'plain', name: '이름만' }),
      player({
        id: 'detailed',
        name: '상세',
        level: 'B',
        ageGroup: '40대',
        gender: 'female',
      }),
      player({
        id: 'guest',
        name: '스페셜',
        level: '스페셜',
        isGuest: true,
      }),
    ])

    expect(analysis.hasStructuredInput).toBe(true)
    expect(analysis).toMatchObject({
      activeCount: 3,
      regularCount: 2,
      guestCount: 1,
    })
    expect(analysis.genderCounts).toMatchObject({
      female: 1,
      none: 1,
    })
    expect(analysis.ageCounts).toMatchObject({
      '40대': 1,
      무관: 1,
    })
    expect(analysis.levelCounts).toMatchObject({
      B: 1,
      O: 1,
      스페셜: 1,
    })
    expect(analysis.incompleteRegulars.map((item) => item.id)).toEqual([
      'plain',
    ])
  })

  it('treats attendance and preference settings as structured input', () => {
    expect(
      analyzeParticipants([
        player({ arrivalOffsetMinutes: 12 }),
      ]).hasStructuredInput,
    ).toBe(true)
    expect(
      analyzeParticipants([
        player({ preferredPartnerIds: ['partner'] }),
      ]).hasStructuredInput,
    ).toBe(true)
  })
})
