import { describe, expect, it, vi } from 'vitest'
import { defaultSettings, samplePlayers } from './defaultData'
import { createShortShareUrl, loadShortShare } from './shortShare'
import type { SharePayload } from './shareLink'

const payload: SharePayload = {
  version: 1,
  generatedAt: '2026-07-17T00:00:00.000Z',
  players: samplePlayers,
  settings: defaultSettings,
  results: {},
  pairMixes: {},
}

describe('short share links', () => {
  it('creates a short same-origin URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'Ab3x9K_yZ012' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(createShortShareUrl(
      payload,
      'https://example.com/?old=1#share=old',
      fetcher,
    )).resolves.toBe('https://example.com/?s=Ab3x9K_yZ012')
  })

  it('loads and validates a short share payload', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(loadShortShare('Ab3x9K_yZ012', fetcher)).resolves.toEqual(payload)
  })

  it('reports an expired short share', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'SHARE_EXPIRED' }), { status: 404 }),
    )

    await expect(loadShortShare('Ab3x9K_yZ012', fetcher)).rejects.toMatchObject({
      code: 'expired',
    })
  })
})
