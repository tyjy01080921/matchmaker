import {
  SHORT_SHARE_PARAM,
  parseSharePayload,
  type SharePayload,
} from './shareLink'

const SHORT_SHARE_ENDPOINT = '/api/shares'

export class ShortShareError extends Error {
  readonly code: 'create-failed' | 'expired' | 'invalid' | 'load-failed'

  constructor(
    message: string,
    code: 'create-failed' | 'expired' | 'invalid' | 'load-failed',
  ) {
    super(message)
    this.name = 'ShortShareError'
    this.code = code
  }
}

export const createShortShareUrl = async (
  payload: SharePayload,
  currentUrl: string,
  fetcher: typeof fetch = fetch,
) => {
  const response = await fetcher(SHORT_SHARE_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new ShortShareError('짧은 공유 링크 생성 실패', 'create-failed')
  }
  const result = await response.json() as { id?: unknown }
  if (typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{12}$/.test(result.id)) {
    throw new ShortShareError('공유 ID 확인 실패', 'invalid')
  }

  const url = new URL(currentUrl)
  url.search = ''
  url.hash = ''
  url.searchParams.set(SHORT_SHARE_PARAM, result.id)
  return url.toString()
}

export const loadShortShare = async (
  shareId: string,
  fetcher: typeof fetch = fetch,
) => {
  const response = await fetcher(
    `${SHORT_SHARE_ENDPOINT}/${encodeURIComponent(shareId)}`,
    { headers: { Accept: 'application/json' } },
  )
  if (response.status === 404) {
    throw new ShortShareError('공유 링크가 만료되었습니다.', 'expired')
  }
  if (!response.ok) {
    throw new ShortShareError('공유 대진을 불러오지 못했습니다.', 'load-failed')
  }
  const payload = parseSharePayload(await response.json())
  if (!payload) {
    throw new ShortShareError('공유 대진 데이터가 올바르지 않습니다.', 'invalid')
  }
  return payload
}
