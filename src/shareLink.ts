import type {
  AppMode,
  MatchNameOverrides,
  MatchSettings,
  Player,
  PrizeDrawState,
  ResultsByMatch,
  TournamentLineupsByMatch,
  TournamentResultsByMatch,
  TournamentSettings,
  TournamentTeam,
} from './types'

export const SHARE_PARAM = 'share'
export const SHARE_MODE_PARAM = 'shared'

export type SharePayload = {
  version: 1
  generatedAt: string
  players: Player[]
  settings: MatchSettings
  results: ResultsByMatch
  pairMixes: Record<string, number>
  matchNameOverrides?: MatchNameOverrides
  appMode?: AppMode
  tournamentTeams?: TournamentTeam[]
  tournamentSettings?: TournamentSettings
  tournamentResults?: TournamentResultsByMatch
  tournamentLineups?: TournamentLineupsByMatch
  prizeDraw?: PrizeDrawState
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const BASE64_URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const decodeBase64UrlChar = (value: string) => {
  const index = BASE64_URL_ALPHABET.indexOf(value)
  if (index === -1) throw new Error('invalid base64url')
  return index
}

const bytesToBase64Url = (bytes: Uint8Array) => {
  let output = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1]
    const third = bytes[index + 2]

    output += BASE64_URL_ALPHABET[first >> 2]
    output += BASE64_URL_ALPHABET[((first & 3) << 4) | ((second ?? 0) >> 4)]

    if (second !== undefined) {
      output += BASE64_URL_ALPHABET[((second & 15) << 2) | ((third ?? 0) >> 6)]
    }

    if (third !== undefined) {
      output += BASE64_URL_ALPHABET[third & 63]
    }
  }

  return output
}

const base64UrlToBytes = (base64Url: string) => {
  const normalized = base64Url
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  if (normalized.length % 4 === 1) throw new Error('invalid base64url')

  const bytes: number[] = []
  for (let index = 0; index < normalized.length; index += 4) {
    const first = decodeBase64UrlChar(normalized[index])
    const second = decodeBase64UrlChar(normalized[index + 1])
    const third =
      normalized[index + 2] === undefined
        ? undefined
        : decodeBase64UrlChar(normalized[index + 2])
    const fourth =
      normalized[index + 3] === undefined
        ? undefined
        : decodeBase64UrlChar(normalized[index + 3])

    bytes.push((first << 2) | (second >> 4))
    if (third !== undefined) bytes.push(((second & 15) << 4) | (third >> 2))
    if (fourth !== undefined) bytes.push(((third ?? 0) << 6) | fourth)
  }

  return new Uint8Array(bytes)
}

const isSharePayload = (value: unknown): value is SharePayload => {
  if (!value || typeof value !== 'object') return false

  const payload = value as Partial<SharePayload>
  return (
    payload.version === 1 &&
    typeof payload.generatedAt === 'string' &&
    Array.isArray(payload.players) &&
    typeof payload.settings === 'object' &&
    payload.settings !== null &&
    typeof payload.results === 'object' &&
    payload.results !== null &&
    typeof payload.pairMixes === 'object' &&
    payload.pairMixes !== null &&
    (
      payload.matchNameOverrides === undefined ||
      (
        typeof payload.matchNameOverrides === 'object' &&
        payload.matchNameOverrides !== null
      )
    ) &&
    (
      payload.appMode === undefined ||
      payload.appMode === 'meeting' ||
      payload.appMode === 'tournament'
    ) &&
    (
      payload.tournamentTeams === undefined ||
      Array.isArray(payload.tournamentTeams)
    ) &&
    (
      payload.tournamentSettings === undefined ||
      (
        typeof payload.tournamentSettings === 'object' &&
        payload.tournamentSettings !== null
      )
    ) &&
    (
      payload.tournamentResults === undefined ||
      (
        typeof payload.tournamentResults === 'object' &&
        payload.tournamentResults !== null
      )
    ) &&
    (
      payload.tournamentLineups === undefined ||
      (
        typeof payload.tournamentLineups === 'object' &&
        payload.tournamentLineups !== null
      )
    ) &&
    (
      payload.prizeDraw === undefined ||
      (
        typeof payload.prizeDraw === 'object' &&
        payload.prizeDraw !== null
      )
    )
  )
}

export const encodeSharePayload = (payload: SharePayload) =>
  bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)))

export const decodeSharePayload = (value: string): SharePayload | null => {
  try {
    const payload = JSON.parse(
      textDecoder.decode(base64UrlToBytes(value)),
    ) as unknown

    return isSharePayload(payload) ? payload : null
  } catch {
    return null
  }
}

export const getShareTokenFromLocation = (
  location: Pick<Location, 'hash' | 'search'>,
) => {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash
  const hashToken = new URLSearchParams(hash).get(SHARE_PARAM)
  if (hashToken) return hashToken

  return new URLSearchParams(location.search).get(SHARE_PARAM)
}

export const makeShareUrl = (currentHref: string, payload: SharePayload) => {
  const url = new URL(currentHref)
  url.searchParams.delete(SHARE_PARAM)
  url.searchParams.set(SHARE_MODE_PARAM, '1')
  url.hash = `${SHARE_PARAM}=${encodeURIComponent(encodeSharePayload(payload))}`
  return url.toString()
}
