import { describe, expect, it } from 'vitest'
import { defaultSettings, samplePlayers } from './defaultData'
import {
  decodeSharePayload,
  encodeSharePayload,
  getShareTokenFromLocation,
  makeShareUrl,
  type SharePayload,
} from './shareLink'

const makePayload = (): SharePayload => ({
  version: 1,
  generatedAt: '2026-06-30T12:00:00.000Z',
  players: samplePlayers,
  settings: {
    ...defaultSettings,
    eventName: '화요 배드민턴',
  },
  results: {
    'r1-c1': {
      teamAScore: '21',
      teamBScore: '18',
      completed: true,
      note: '결승 코트',
    },
  },
  pairMixes: {
    'r1-c1': 2,
  },
  matchNameOverrides: {
    'r1-c1': {
      'p-minsu': '현장참가자',
    },
  },
  prizeDraw: {
    mode: 'people',
    prizesText: '셔틀콕\n그립',
    prizesConfirmed: true,
    missionsText: '',
    allowDuplicateWinners: false,
    drawCount: 1,
    results: [
      {
        prize: '셔틀콕',
        winnerId: 'guest-ko',
        winnerName: '1번',
      },
    ],
    missionResults: [],
    matchMissions: {},
  },
})

describe('share links', () => {
  it('round-trips Korean schedule data through a URL-safe token', () => {
    const payload = makePayload()
    const token = encodeSharePayload(payload)

    expect(token).not.toContain('+')
    expect(token).not.toContain('/')
    expect(decodeSharePayload(token)).toEqual(payload)
  })

  it('builds a hash-based share URL without keeping an old share query', () => {
    const payload = makePayload()
    const url = makeShareUrl('https://example.com/?share=old&view=edit', payload)
    const parsed = new URL(url)

    expect(parsed.searchParams.get('share')).toBeNull()
    expect(parsed.searchParams.get('shared')).toBe('1')
    expect(parsed.searchParams.get('view')).toBe('edit')
    expect(getShareTokenFromLocation(parsed)).toBeTruthy()
    expect(decodeSharePayload(getShareTokenFromLocation(parsed) ?? '')).toEqual(
      payload,
    )
  })
})
