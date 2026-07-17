const SHARE_TTL_SECONDS = 24 * 60 * 60
const MAX_SHARE_BYTES = 512 * 1024
const SHARE_KEY_PREFIX = 'share:'

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  },
)

const readLimitedBody = async (request: Request) => {
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SHARE_BYTES) {
    throw new RangeError('payload too large')
  }
  if (!request.body) throw new SyntaxError('empty payload')

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_SHARE_BYTES) {
      await reader.cancel('payload too large')
      throw new RangeError('payload too large')
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

const isSharePayload = (value: unknown) => {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return payload.version === 1 &&
    typeof payload.generatedAt === 'string' &&
    Array.isArray(payload.players) &&
    Boolean(payload.settings && typeof payload.settings === 'object') &&
    Boolean(payload.results && typeof payload.results === 'object')
}

const makeShareId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  const binary = String.fromCharCode(...bytes)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const request = context.request
  const env = context.env
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405)
  }

  const requestUrl = new URL(request.url)
  const requestOrigin = request.headers.get('Origin')
  if (requestOrigin && requestOrigin !== requestUrl.origin) {
    return jsonResponse({ error: 'ORIGIN_NOT_ALLOWED' }, 403)
  }
  if (!request.headers.get('Content-Type')?.includes('application/json')) {
    return jsonResponse({ error: 'JSON_REQUIRED' }, 415)
  }

  try {
    const rawPayload = await readLimitedBody(request)
    const payload = JSON.parse(rawPayload) as unknown
    if (!isSharePayload(payload)) {
      return jsonResponse({ error: 'INVALID_SHARE_DATA' }, 400)
    }

    let shareId = ''
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = makeShareId()
      const existing = await env.MATCHMAKER_SHARES.get(`${SHARE_KEY_PREFIX}${candidate}`)
      if (!existing) {
        shareId = candidate
        break
      }
    }
    if (!shareId) return jsonResponse({ error: 'SHARE_ID_UNAVAILABLE' }, 503)

    await env.MATCHMAKER_SHARES.put(
      `${SHARE_KEY_PREFIX}${shareId}`,
      rawPayload,
      { expirationTtl: SHARE_TTL_SECONDS },
    )
    return jsonResponse({
      id: shareId,
      expiresAt: new Date(Date.now() + SHARE_TTL_SECONDS * 1000).toISOString(),
    }, 201)
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonResponse({ error: 'SHARE_DATA_TOO_LARGE' }, 413)
    }
    if (error instanceof SyntaxError) {
      return jsonResponse({ error: 'INVALID_JSON' }, 400)
    }
    console.error(JSON.stringify({
      event: 'share_create_failed',
      message: error instanceof Error ? error.message : String(error),
    }))
    return jsonResponse({ error: 'SHARE_CREATE_FAILED' }, 500)
  }
}
