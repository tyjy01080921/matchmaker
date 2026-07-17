const SHARE_KEY_PREFIX = 'share:'
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/

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

export const onRequest: PagesFunction<Env, 'id'> = async (context) => {
  const request = context.request
  const env = context.env
  const params = context.params
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405)
  }

  const shareId = Array.isArray(params.id) ? params.id[0] : params.id
  if (!shareId || !SHARE_ID_PATTERN.test(shareId)) {
    return jsonResponse({ error: 'INVALID_SHARE_ID' }, 400)
  }

  try {
    const payload = await env.MATCHMAKER_SHARES.get(`${SHARE_KEY_PREFIX}${shareId}`)
    if (!payload) return jsonResponse({ error: 'SHARE_EXPIRED' }, 404)
    return new Response(payload, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error(JSON.stringify({
      event: 'share_read_failed',
      message: error instanceof Error ? error.message : String(error),
    }))
    return jsonResponse({ error: 'SHARE_READ_FAILED' }, 500)
  }
}
