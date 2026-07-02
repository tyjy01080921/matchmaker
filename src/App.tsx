import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import './App.css'
import amaLogo from './assets/ama-logo.png'
import {
  defaultPlayers,
  defaultSettings,
  defaultTournamentSettings,
  defaultTournamentTeams,
} from './defaultData'
import {
  calculateStats,
  generateSchedule,
  generateTournamentSchedule,
} from './matchmaker'
import {
  decodeSharePayload,
  getShareTokenFromLocation,
  makeShareUrl,
  SHARE_MODE_PARAM,
  SHARE_PARAM,
  type SharePayload,
} from './shareLink'
import {
  makePlayerNameLookup,
  playerDisplayName,
  type PlayerNameLookup,
} from './playerNames'
import { createSchedulePrintImages, createTournamentPrintImages } from './printSchedule'
import { drawPrizeWinners, parseMissionList, parsePrizeList } from './prizeDraw'
import type {
  AgeGroup,
  AppMode,
  Gender,
  Level,
  Match,
  MatchNameOverrides,
  MatchResult,
  MatchSettings,
  Player,
  PrizeDrawState,
  ResultsByMatch,
  Schedule,
  Team,
  TournamentFormat,
  TournamentMatch,
  TournamentMatchResult,
  TournamentResultsByMatch,
  TournamentSettings,
  TournamentTeam,
} from './types'

const STORAGE_KEY = 'badminton-matchmaker-v1'
const GAME_SLOT_MINUTES = 15
const EVENT_LIMIT_MINUTES = 120
const EVENT_LIMIT_ROUNDS = Math.floor(EVENT_LIMIT_MINUTES / GAME_SLOT_MINUTES)

const getTargetRoundCount = (settings: MatchSettings) => {
  const numeric = Number(settings.targetRoundCount)
  if (!Number.isFinite(numeric)) return EVENT_LIMIT_ROUNDS
  return Math.max(1, Math.floor(numeric))
}

const defaultPrizeDrawState: PrizeDrawState = {
  mode: 'people',
  prizesText: '',
  missionsText: '',
  allowDuplicateWinners: false,
  results: [],
  missionResults: [],
  matchMissions: {},
}

type StoredState = {
  appMode: AppMode
  players: Player[]
  settings: MatchSettings
  results: ResultsByMatch
  pairMixes: Record<string, number>
  matchNameOverrides: MatchNameOverrides
  prizeDraw: PrizeDrawState
  tournamentTeams: TournamentTeam[]
  tournamentSettings: TournamentSettings
  tournamentResults: TournamentResultsByMatch
}

const levelLabels: Record<Level, string> = {
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  스페셜: '스페셜',
}

const levelOptions: Level[] = ['A', 'B', 'C', 'D', '스페셜']

const ageGroups: AgeGroup[] = ['20대', '30대', '40대', '45대', '50대', '55대이상']

const genderLabels: Record<Gender, string> = {
  male: '남',
  female: '여',
  none: '무관',
}

const tournamentFormatLabels: Record<TournamentFormat, string> = {
  'group-knockout': '조별+넉아웃',
  knockout: '넉아웃',
  'team-battle': '단체전',
}

const tournamentFormatDescriptions: Record<TournamentFormat, string> = {
  'group-knockout': '조별 풀리그 후 상위 팀 진출',
  knockout: '시드와 부전승 기반 토너먼트',
  'team-battle': '팀 대 팀 세부 경기 합산',
}

const tournamentPhaseLabels: Record<TournamentMatch['phase'], string> = {
  group: '조별',
  knockout: '넉아웃',
  'third-place': '3·4위',
  'team-battle': '단체전',
}

const legacySampleNames: Record<string, string> = {
  'guest-ko': '참가자 1',
  'guest-shin': '참가자 2',
  'guest-special': '참가자 3',
  'p-minsu': '참가자 4',
  'p-jiyeon': '참가자 5',
  'p-taeho': '참가자 6',
  'p-soobin': '참가자 7',
  'p-hyunwoo': '참가자 8',
  'p-nayoung': '참가자 9',
  'p-junho': '참가자 10',
  'p-eunji': '참가자 11',
  'p-doyoon': '참가자 12',
  'p-yuna': '참가자 13',
  'p-chulsoo': '참가자 14',
  'p-harin': '참가자 15',
}

const legacySampleNameSet = new Set([
  '고성현',
  '신백철',
  '스페셜 1',
  '스페셜 게스트',
  '스페셜 선수',
  '김민수',
  '이지연',
  '박태호',
  '최수빈',
  '정현우',
  '강나영',
  '오준호',
  '한은지',
  '윤도윤',
  '서유나',
  '이철수',
  '문하린',
])

const normalizeLevel = (value: unknown): Level => {
  if (
    value === 'A' ||
    value === 'B' ||
    value === 'C' ||
    value === 'D' ||
    value === '스페셜'
  ) {
    return value
  }
  if (value === 'SPECIAL' || value === 'special' || value === 'Special') {
    return '스페셜'
  }
  const numeric = Number(value)
  if (numeric >= 4) return 'A'
  if (numeric === 3) return 'B'
  if (numeric === 2) return 'C'
  return 'D'
}

const normalizeAgeGroup = (value: unknown): AgeGroup => {
  if (ageGroups.includes(value as AgeGroup)) return value as AgeGroup
  return '30대'
}

const normalizeGender = (value: unknown): Gender => {
  if (value === 'male' || value === 'female' || value === 'none') return value
  if (value === '남' || value === '남자' || value === 'M' || value === 'm') return 'male'
  if (value === '여' || value === '여자' || value === 'F' || value === 'f') return 'female'
  return 'none'
}

const normalizePlayer = (player: Partial<Player>): Player => {
  const normalizedLevel = normalizeLevel(player.level)
  const isGuest = (player.isGuest ?? false) || normalizedLevel === '스페셜'
  const level = isGuest ? '스페셜' : normalizedLevel
  const isSpecialLevel = level === '스페셜'
  return {
    id: player.id ?? makeId(),
    name: player.name?.trim() || '참가자',
    level,
    ageGroup: normalizeAgeGroup(player.ageGroup),
    gender: isGuest || isSpecialLevel ? 'none' : normalizeGender(player.gender),
    active: player.active ?? true,
    specialRequired:
      isGuest || isSpecialLevel ? false : (player.specialRequired ?? true),
    isGuest,
    guestGameLimit: player.guestGameLimit ?? 0,
  }
}

const normalizeStoredPlayer = (player: Partial<Player>): Player => {
  const normalized = normalizePlayer(player)
  const legacyAutoName = normalized.name.match(/^게스트\s+(\d+)$/)
  const legacySampleName = legacySampleNames[normalized.id]
  if (legacySampleName && legacySampleNameSet.has(normalized.name)) {
    return { ...normalized, name: legacySampleName }
  }
  if (normalized.isGuest && legacyAutoName) {
    return { ...normalized, name: `스페셜 ${legacyAutoName[1]}` }
  }
  return normalized
}

const normalizeAppMode = (value: unknown): AppMode =>
  value === 'tournament' ? 'tournament' : 'meeting'

const normalizeTournamentFormat = (value: unknown): TournamentFormat => {
  if (
    value === 'group-knockout' ||
    value === 'knockout' ||
    value === 'team-battle'
  ) {
    return value
  }

  return 'knockout'
}

const normalizePositiveInteger = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.floor(numeric)))
}

const normalizeTournamentSeed = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.min(999, Math.floor(numeric))
}

const normalizeTournamentSettings = (
  settings: Partial<TournamentSettings> | undefined,
): TournamentSettings => {
  const rawSlots = Array.isArray(settings?.teamBattleSlots)
    ? settings.teamBattleSlots
    : defaultTournamentSettings.teamBattleSlots
  const teamBattleSlots = [...rawSlots, ...defaultTournamentSettings.teamBattleSlots]
    .map((slot) => String(slot).trim())
    .filter(Boolean)
    .slice(0, 5)

  return {
    ...defaultTournamentSettings,
    ...settings,
    format: normalizeTournamentFormat(settings?.format),
    courtCount: normalizePositiveInteger(
      settings?.courtCount,
      defaultTournamentSettings.courtCount,
      1,
      12,
    ),
    groupCount: normalizePositiveInteger(
      settings?.groupCount,
      defaultTournamentSettings.groupCount,
      1,
      16,
    ),
    advancePerGroup: normalizePositiveInteger(
      settings?.advancePerGroup,
      defaultTournamentSettings.advancePerGroup,
      1,
      8,
    ),
    includeThirdPlace: settings?.includeThirdPlace ?? true,
    teamBattleMatchCount: normalizePositiveInteger(
      settings?.teamBattleMatchCount,
      defaultTournamentSettings.teamBattleMatchCount,
      1,
      5,
    ),
    teamBattleSlots,
  }
}

const normalizeTournamentTeam = (
  team: Partial<TournamentTeam>,
  index: number,
): TournamentTeam => ({
  id: team.id ?? makeId(),
  name: team.name?.trim() || `${index + 1}팀`,
  playerNames: team.playerNames?.trim() || '',
  level: normalizeLevel(team.level),
  gender: normalizeGender(team.gender),
  seed: normalizeTournamentSeed(team.seed),
  active: team.active ?? true,
})

const normalizePrizeDrawResults = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((rawResult) => {
          const result = rawResult as Partial<PrizeDrawState['results'][number]>
          return {
            prize: String(result.prize ?? '').trim(),
            winnerId: String(result.winnerId ?? ''),
            winnerName: String(result.winnerName ?? '').trim(),
            reward:
              result.reward === undefined ? undefined : String(result.reward).trim(),
            done: Boolean(result.done),
          }
        })
        .filter((result) => result.prize && result.winnerId && result.winnerName)
    : []

const normalizePrizeDrawResultMap = (value: unknown) => {
  if (!value || typeof value !== 'object') return {}

  const entries: Array<[string, PrizeDrawState['results'][number]]> = []
  for (const [matchId, rawResult] of Object.entries(value as Record<string, unknown>)) {
    const [result] = normalizePrizeDrawResults([rawResult])
    if (result) entries.push([matchId, result])
  }

  return Object.fromEntries(entries)
}

const normalizePrizeDrawState = (
  value: Partial<PrizeDrawState> | undefined,
): PrizeDrawState => ({
  mode: value?.mode === 'mission' ? 'mission' : 'people',
  prizesText: typeof value?.prizesText === 'string' ? value.prizesText : '',
  missionsText: typeof value?.missionsText === 'string' ? value.missionsText : '',
  allowDuplicateWinners: value?.allowDuplicateWinners ?? false,
  results: normalizePrizeDrawResults(value?.results),
  missionResults: normalizePrizeDrawResults(value?.missionResults),
  matchMissions: normalizePrizeDrawResultMap(value?.matchMissions),
})

const legacyEnglishTitleCodes = [
  83,
  72,
  73,
  78,
  69,
  32,
  79,
  78,
  32,
  84,
  72,
  69,
  32,
  67,
  79,
  85,
  82,
  84,
]

const legacyEnglishTitle = legacyEnglishTitleCodes
  .map((code) => String.fromCharCode(code))
  .join('')

const legacyMeetingEventNames = new Set([
  '스페셜 배드민턴 데이',
  legacyEnglishTitle,
])

const readStoredState = (): StoredState => {
  if (typeof window === 'undefined') {
    return {
      appMode: 'meeting',
      players: defaultPlayers,
      settings: defaultSettings,
      results: {},
      pairMixes: {},
      matchNameOverrides: {},
      prizeDraw: defaultPrizeDrawState,
      tournamentTeams: defaultTournamentTeams,
      tournamentSettings: defaultTournamentSettings,
      tournamentResults: {},
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) throw new Error('empty')
    const parsed = JSON.parse(raw) as Partial<StoredState>
    const settings = { ...defaultSettings, ...parsed.settings }
    if (legacyMeetingEventNames.has(settings.eventName)) {
      settings.eventName = defaultSettings.eventName
    }
    return {
      appMode: normalizeAppMode(parsed.appMode),
      players: parsed.players?.length
        ? parsed.players.map((player) => normalizeStoredPlayer(player))
        : defaultPlayers,
      settings,
      results: parsed.results ?? {},
      pairMixes: parsed.pairMixes ?? {},
      matchNameOverrides: parsed.matchNameOverrides ?? {},
      prizeDraw: normalizePrizeDrawState(parsed.prizeDraw),
      tournamentTeams: parsed.tournamentTeams?.length
        ? parsed.tournamentTeams.map((team, index) =>
            normalizeTournamentTeam(team, index),
          )
        : defaultTournamentTeams,
      tournamentSettings: normalizeTournamentSettings(parsed.tournamentSettings),
      tournamentResults: parsed.tournamentResults ?? {},
    }
  } catch {
    return {
      appMode: 'meeting',
      players: defaultPlayers,
      settings: defaultSettings,
      results: {},
      pairMixes: {},
      matchNameOverrides: {},
      prizeDraw: defaultPrizeDrawState,
      tournamentTeams: defaultTournamentTeams,
      tournamentSettings: defaultTournamentSettings,
      tournamentResults: {},
    }
  }
}

const storedStateFromSharePayload = (payload: SharePayload): StoredState => ({
  appMode: normalizeAppMode(payload.appMode),
  players: payload.players.length
    ? payload.players.map((player) => normalizeStoredPlayer(player))
    : defaultPlayers,
  settings: { ...defaultSettings, ...payload.settings },
  results: payload.results ?? {},
  pairMixes: payload.pairMixes ?? {},
  matchNameOverrides: payload.matchNameOverrides ?? {},
  prizeDraw: normalizePrizeDrawState(payload.prizeDraw),
  tournamentTeams: payload.tournamentTeams?.length
    ? payload.tournamentTeams.map((team, index) =>
        normalizeTournamentTeam(team, index),
      )
    : defaultTournamentTeams,
  tournamentSettings: normalizeTournamentSettings(payload.tournamentSettings),
  tournamentResults: payload.tournamentResults ?? {},
})

const readSharedState = (): StoredState | null => {
  if (typeof window === 'undefined') return null

  const token = getShareTokenFromLocation(window.location)
  if (!token) return null

  const payload = decodeSharePayload(token)
  return payload ? storedStateFromSharePayload(payload) : null
}

const getBaseUrl = () => {
  const url = new URL(window.location.href)
  url.searchParams.delete(SHARE_PARAM)
  url.searchParams.delete(SHARE_MODE_PARAM)
  url.hash = ''
  return url.toString()
}

const makeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `player-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

const makeRegularPlayer = (index: number): Player => ({
  id: makeId(),
  name: `참가자 ${index}`,
  level: 'B',
  ageGroup: '30대',
  gender: 'none',
  active: true,
  specialRequired: true,
  isGuest: false,
  guestGameLimit: 0,
})

const makeGuestPlayer = (index: number): Player => ({
  id: makeId(),
  name: `스페셜 ${index}`,
  level: '스페셜',
  ageGroup: '30대',
  gender: 'none',
  active: true,
  specialRequired: false,
  isGuest: true,
  guestGameLimit: 0,
})

const makeTournamentTeam = (index: number): TournamentTeam => ({
  id: makeId(),
  name: `${index}팀`,
  playerNames: '',
  level: 'B',
  gender: 'none',
  seed: null,
  active: true,
})

const hasScore = (result?: MatchResult) =>
  Boolean(result?.teamAScore || result?.teamBScore)

const winnerLabel = (
  match: Match,
  result: MatchResult | undefined,
  names: PlayerNameLookup,
  nameOverrides: Record<string, string> = {},
) => {
  const matchTeamDisplayName = (team: Team) =>
    team
      .map((player) => nameOverrides[player.id]?.trim() || playerDisplayName(player, names))
      .join(' + ')
  const a = Number(result?.teamAScore)
  const b = Number(result?.teamBScore)
  if (!result?.completed || !Number.isFinite(a) || !Number.isFinite(b) || a === b) {
    return '대기'
  }
  return a > b ? matchTeamDisplayName(match.teamA) : matchTeamDisplayName(match.teamB)
}

const tournamentHasScore = (result?: TournamentMatchResult) =>
  Boolean(result?.teamAScore || result?.teamBScore)

const tournamentWinnerTeamId = (
  match: TournamentMatch,
  result: TournamentMatchResult | undefined,
) => {
  if (match.isBye) return match.teamAId ?? match.teamBId
  if (!match.teamAId || !match.teamBId) return undefined

  const a = Number(result?.teamAScore)
  const b = Number(result?.teamBScore)
  if (!result?.completed || !Number.isFinite(a) || !Number.isFinite(b) || a === b) {
    return undefined
  }

  return a > b ? match.teamAId : match.teamBId
}

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}시간 ${remainingMinutes}분`
  }
  if (hours > 0) return `${hours}시간`
  return `${minutes}분`
}

const copyToClipboard = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

const sanitizeFilename = (value: string) =>
  (value.trim() || '대진표')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')

const downloadImage = (imageUrl: string, filename: string) => {
  const link = document.createElement('a')
  link.href = imageUrl
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

const mixedMatch = (match: Match, mixIndex: number): Match => {
  const players = [match.teamA[0], match.teamA[1], match.teamB[0], match.teamB[1]]
  const options: Array<Pick<Match, 'teamA' | 'teamB'>> = [
    {
      teamA: [players[0], players[1]],
      teamB: [players[2], players[3]],
    },
    {
      teamA: [players[0], players[2]],
      teamB: [players[1], players[3]],
    },
    {
      teamA: [players[0], players[3]],
      teamB: [players[1], players[2]],
    },
  ]
  return {
    ...match,
    ...options[mixIndex % options.length],
  }
}

const applyPairMixes = (
  schedule: Schedule,
  pairMixes: Record<string, number>,
): Schedule => ({
  ...schedule,
  rounds: schedule.rounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) => mixedMatch(match, pairMixes[match.id] ?? 0)),
  })),
})

const parseBulkPlayers = (text: string): Player[] =>
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tokens = line.split(/[\s,\t]+/).filter(Boolean)
      const name = tokens[0]
      const regularLevelToken = tokens.find((token) =>
        (['A', 'B', 'C', 'D'] as string[]).includes(token.toUpperCase()),
      )
      const specialLevelToken = tokens.find(
        (token) => token === '스페셜' || token.toLowerCase() === 'special',
      )
      const levelToken = regularLevelToken ?? specialLevelToken
      const ageToken = tokens.find((token) => ageGroups.includes(token as AgeGroup))
      const genderToken = tokens.find((token) =>
        ['남', '남자', '여', '여자', 'male', 'female', '무관'].includes(
          token.toLowerCase(),
        ),
      )
      const isSpecialPlayer = Boolean(specialLevelToken) && !regularLevelToken
      const isGuest =
        isSpecialPlayer || tokens.some((token) => token.includes('게스트'))
      const specialRequired =
        !isGuest &&
        Boolean(regularLevelToken) &&
        tokens.some((token) => token.includes('스페셜') || token.toLowerCase() === 'special')

      return normalizePlayer({
        id: makeId(),
        name,
        level: levelToken
          ? normalizeLevel(levelToken === '스페셜' ? levelToken : levelToken.toUpperCase())
          : 'B',
        ageGroup: normalizeAgeGroup(ageToken),
        gender: normalizeGender(genderToken),
        active: true,
        specialRequired,
        isGuest,
        guestGameLimit: 0,
      })
    })

const tournamentGenderTokens = ['남', '남자', '여', '여자', 'male', 'female', '무관', '혼성', 'mixed']

const normalizeTournamentTeamGender = (value: unknown): Gender => {
  if (value === '혼성' || value === 'mixed') return 'none'
  return normalizeGender(value)
}

const parseBulkTournamentTeams = (text: string): TournamentTeam[] =>
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const commaParts = line.split(',').map((part) => part.trim()).filter(Boolean)
      const fields =
        commaParts.length > 1
          ? commaParts
          : line.split(/[\s,\t]+/).map((part) => part.trim()).filter(Boolean)
      const metadataFields = fields.slice(1)
      const seedIndex = metadataFields.findIndex((field) => /^\d+$/.test(field))
      const levelIndex = metadataFields.findIndex((field) =>
        (['A', 'B', 'C', 'D'] as string[]).includes(field.toUpperCase()),
      )
      const genderIndex = metadataFields.findIndex((field) =>
        tournamentGenderTokens.includes(field.toLowerCase()),
      )
      const roster = metadataFields
        .filter(
          (_, fieldIndex) =>
            fieldIndex !== seedIndex &&
            fieldIndex !== levelIndex &&
            fieldIndex !== genderIndex,
        )
        .join(', ')

      return normalizeTournamentTeam(
        {
          id: makeId(),
          name: fields[0],
          playerNames: roster,
          level:
            levelIndex >= 0
              ? normalizeLevel(metadataFields[levelIndex].toUpperCase())
              : 'B',
          gender:
            genderIndex >= 0
              ? normalizeTournamentTeamGender(metadataFields[genderIndex].toLowerCase())
              : 'none',
          seed:
            seedIndex >= 0 ? normalizeTournamentSeed(metadataFields[seedIndex]) : null,
          active: true,
        },
        index,
      )
    })

type NumberStepperProps = {
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  value: number
}

function NumberStepper({ label, max, min, onChange, value }: NumberStepperProps) {
  const commitValue = (rawValue: string) => {
    const next = Number(rawValue)
    if (!Number.isFinite(next)) return
    onChange(Math.min(max, Math.max(min, Math.floor(next))))
  }

  return (
    <label className="number-control">
      <span>{label}</span>
      <div className="stepper-control">
        <button
          type="button"
          aria-label={`${label} 줄이기`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <input
          aria-label={label}
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(event) => commitValue(event.target.value)}
        />
        <button
          type="button"
          aria-label={`${label} 늘리기`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </div>
    </label>
  )
}

function App() {
  const initialContext = useMemo(() => {
    const sharedState = readSharedState()
    return {
      isShared: Boolean(sharedState),
      state: sharedState ?? readStoredState(),
    }
  }, [])
  const initialState = initialContext.state
  const [appMode, setAppMode] = useState<AppMode>(initialState.appMode)
  const [players, setPlayers] = useState<Player[]>(initialState.players)
  const [settings, setSettings] = useState<MatchSettings>(initialState.settings)
  const [results, setResults] = useState<ResultsByMatch>(initialState.results)
  const [pairMixes, setPairMixes] = useState<Record<string, number>>(
    initialState.pairMixes,
  )
  const [matchNameOverrides, setMatchNameOverrides] = useState<MatchNameOverrides>(
    initialState.matchNameOverrides,
  )
  const [prizeDraw, setPrizeDraw] = useState<PrizeDrawState>(
    initialState.prizeDraw,
  )
  const [tournamentTeams, setTournamentTeams] = useState<TournamentTeam[]>(
    initialState.tournamentTeams,
  )
  const [tournamentSettings, setTournamentSettings] = useState<TournamentSettings>(
    initialState.tournamentSettings,
  )
  const [tournamentResults, setTournamentResults] = useState<TournamentResultsByMatch>(
    initialState.tournamentResults,
  )
  const [isSharedMode, setIsSharedMode] = useState(initialContext.isShared)
  const [view, setView] = useState<'schedule' | 'stats'>('schedule')
  const [tournamentView, setTournamentView] = useState<'progress' | 'board'>('progress')
  const [notice, setNotice] = useState(initialContext.isShared ? '공유본' : '저장됨')
  const [playersOpen, setPlayersOpen] = useState(true)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [tournamentBulkOpen, setTournamentBulkOpen] = useState(false)
  const [tournamentBulkText, setTournamentBulkText] = useState('')
  const [printImageUrls, setPrintImageUrls] = useState<string[]>([])
  const [tournamentPrintImageUrls, setTournamentPrintImageUrls] = useState<string[]>([])
  const [editingMatchIds, setEditingMatchIds] = useState<Record<string, boolean>>({})
  const [matchNameDrafts, setMatchNameDrafts] = useState<MatchNameOverrides>({})
  const [rouletteRotation, setRouletteRotation] = useState(0)
  const [rouletteWinnerName, setRouletteWinnerName] = useState('')
  const [isRouletteSpinning, setIsRouletteSpinning] = useState(false)
  const rouletteTimerRef = useRef<number | null>(null)

  const rawSchedule = useMemo(
    () => generateSchedule(players, settings),
    [players, settings],
  )
  const schedule = useMemo(
    () => applyPairMixes(rawSchedule, pairMixes),
    [rawSchedule, pairMixes],
  )
  const displayNames = useMemo(() => makePlayerNameLookup(players), [players])
  const stats = useMemo(
    () => calculateStats(players, schedule, results, matchNameOverrides),
    [players, schedule, results, matchNameOverrides],
  )
  const tournamentSchedule = useMemo(
    () =>
      generateTournamentSchedule(
        tournamentTeams,
        tournamentSettings,
        tournamentResults,
      ),
    [tournamentTeams, tournamentSettings, tournamentResults],
  )
  const tournamentTeamLookup = useMemo(
    () => new Map(tournamentTeams.map((team) => [team.id, team])),
    [tournamentTeams],
  )

  const activePlayers = players.filter((player) => player.active && player.name.trim())
  const prizeCandidates = activePlayers.map((player) => ({
    id: player.id,
    name: playerDisplayName(player, displayNames),
  }))
  const prizeList = parsePrizeList(prizeDraw.prizesText)
  const missionList = parseMissionList(prizeDraw.missionsText)
  const activePrizeResults =
    prizeDraw.mode === 'mission' ? prizeDraw.missionResults : prizeDraw.results
  const drawnPrizeWinnerIds = new Set(
    prizeDraw.results.map((result) => result.winnerId),
  )
  const drawnMissionIds = new Set(
    prizeDraw.missionResults.map((result) => result.winnerId),
  )
  const availableRouletteCandidates = prizeDraw.allowDuplicateWinners
    ? prizeCandidates
    : prizeCandidates.filter((candidate) => !drawnPrizeWinnerIds.has(candidate.id))
  const availableMissions = missionList.filter((mission) => !drawnMissionIds.has(mission.id))
  const isRouletteMode = prizeDraw.mode === 'people' && prizeList.length === 0
  const rouletteItems =
    prizeDraw.mode === 'mission'
      ? missionList.map((mission) => ({ id: mission.id, name: mission.number }))
      : prizeCandidates
  const availableRouletteCount =
    prizeDraw.mode === 'mission'
      ? availableMissions.length
      : availableRouletteCandidates.length
  const rouletteWheelStyle = {
    '--roulette-rotation': `${rouletteRotation}deg`,
  } as CSSProperties
  const regularPlayers = players.filter((player) => !player.isGuest)
  const guestPlayers = players.filter((player) => player.isGuest)
  const activeMembers = activePlayers.filter((player) => !player.isGuest)
  const activeGuests = activePlayers.filter((player) => player.isGuest)
  const hasActiveGuests = activeGuests.length > 0
  const requiredPlayers = hasActiveGuests ? activeMembers : []
  const pendingSpecial = requiredPlayers.filter(
    (player) => !schedule.specialCompletedIds.includes(player.id),
  )
  const completedMatches = schedule.rounds
    .flatMap((round) => round.matches)
    .filter((match) => results[match.id]?.completed).length
  const totalMatches = schedule.rounds.flatMap((round) => round.matches).length
  const totalGameSlots = schedule.rounds.length
  const targetRoundCount = getTargetRoundCount(settings)
  const inTimeGameSlots = Math.min(totalGameSlots, EVENT_LIMIT_ROUNDS)
  const overtimeGameSlots = Math.max(totalGameSlots - EVENT_LIMIT_ROUNDS, 0)
  const estimatedMinutes = totalGameSlots * GAME_SLOT_MINUTES
  const activeTournamentTeams = tournamentTeams.filter(
    (team) => team.active && team.name.trim(),
  )
  const seededTournamentTeams = tournamentTeams.filter((team) => team.seed !== null)
  const completedTournamentMatches = tournamentSchedule.matches.filter(
    (match) => tournamentWinnerTeamId(match, tournamentResults[match.id]),
  ).length
  const totalTournamentMatches = tournamentSchedule.matches.length
  const nextTournamentMatch = tournamentSchedule.matches.find(
    (match) =>
      !match.isBye &&
      match.teamAId &&
      match.teamBId &&
      !tournamentWinnerTeamId(match, tournamentResults[match.id]),
  )
  const tournamentRounds = useMemo(() => {
    const grouped = new Map<number, TournamentMatch[]>()
    for (const match of tournamentSchedule.matches) {
      grouped.set(match.round, [...(grouped.get(match.round) ?? []), match])
    }

    return Array.from(grouped.entries())
      .sort(([left], [right]) => left - right)
      .map(([round, matches]) => ({
        round,
        matches: [...matches].sort((a, b) => a.order - b.order),
      }))
  }, [tournamentSchedule.matches])

  useEffect(() => {
    if (isSharedMode) return

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        appMode,
        players,
        settings,
        results,
        pairMixes,
        matchNameOverrides,
        prizeDraw,
        tournamentTeams,
        tournamentSettings,
        tournamentResults,
      }),
    )
    setNotice('저장됨')
  }, [
    appMode,
    isSharedMode,
    players,
    settings,
    results,
    pairMixes,
    matchNameOverrides,
    prizeDraw,
    tournamentTeams,
    tournamentSettings,
    tournamentResults,
  ])

  useEffect(() => {
    let currentShareToken = getShareTokenFromLocation(window.location)

    const applySharedStateFromUrl = () => {
      const nextShareToken = getShareTokenFromLocation(window.location)
      if (!nextShareToken) {
        currentShareToken = null
        return
      }
      if (nextShareToken === currentShareToken) return

      const sharedState = readSharedState()
      if (!sharedState) return

      currentShareToken = nextShareToken
      setIsSharedMode(true)
      setAppMode(sharedState.appMode)
      setPlayers(sharedState.players)
      setSettings(sharedState.settings)
      setResults(sharedState.results)
      setPairMixes(sharedState.pairMixes)
      setMatchNameOverrides(sharedState.matchNameOverrides)
      setPrizeDraw(sharedState.prizeDraw)
      setTournamentTeams(sharedState.tournamentTeams)
      setTournamentSettings(sharedState.tournamentSettings)
      setTournamentResults(sharedState.tournamentResults)
      setView('schedule')
      setTournamentView('progress')
      setNotice('공유본')
    }

    window.addEventListener('hashchange', applySharedStateFromUrl)
    window.addEventListener('popstate', applySharedStateFromUrl)
    const shareUrlCheck = window.setInterval(applySharedStateFromUrl, 500)

    return () => {
      window.removeEventListener('hashchange', applySharedStateFromUrl)
      window.removeEventListener('popstate', applySharedStateFromUrl)
      window.clearInterval(shareUrlCheck)
    }
  }, [])

  useEffect(
    () => () => {
      if (rouletteTimerRef.current !== null) {
        window.clearTimeout(rouletteTimerRef.current)
      }
    },
    [],
  )

  const updatePlayer = (id: string, patch: Partial<Player>) => {
    setPlayers((current) =>
      current.map((player) => (player.id === id ? { ...player, ...patch } : player)),
    )
  }

  const setAppModeAndNotice = (mode: AppMode) => {
    setAppMode(mode)
    setNotice(mode === 'meeting' ? '모임 모드' : '대회 모드')
  }

  const updateTournamentSettings = (patch: Partial<TournamentSettings>) => {
    setTournamentSettings((current) => normalizeTournamentSettings({ ...current, ...patch }))
    setTournamentResults({})
    setNotice('대회 설정 변경됨')
  }

  const updateTournamentTeam = (id: string, patch: Partial<TournamentTeam>) => {
    setTournamentTeams((current) =>
      current.map((team, index) =>
        team.id === id ? normalizeTournamentTeam({ ...team, ...patch }, index) : team,
      ),
    )
    if (patch.seed !== undefined || patch.active !== undefined) {
      setTournamentResults({})
    }
  }

  const setTournamentTeamCount = (targetCount: number) => {
    setTournamentTeams((current) => {
      if (targetCount === current.length) return current

      return targetCount > current.length
        ? [
            ...current,
            ...Array.from({ length: targetCount - current.length }, (_, index) =>
              makeTournamentTeam(current.length + index + 1),
            ),
          ]
        : current.slice(0, targetCount)
    })
    setTournamentResults({})
    setNotice('팀 수 변경됨')
  }

  const setTournamentSeedCount = (targetCount: number) => {
    setTournamentTeams((current) => {
      const normalizedCount = Math.min(targetCount, current.length)
      return current.map((team, index) => ({
        ...team,
        seed: index < normalizedCount ? index + 1 : null,
      }))
    })
    setTournamentResults({})
    setNotice('시드 수 변경됨')
  }

  const addTournamentTeam = () => {
    setTournamentTeamCount(tournamentTeams.length + 1)
  }

  const removeTournamentTeam = (id: string) => {
    setTournamentTeams((current) => current.filter((team) => team.id !== id))
    setTournamentResults({})
    setNotice('팀 삭제됨')
  }

  const updateTournamentResult = (
    matchId: string,
    patch: Partial<TournamentMatchResult>,
  ) => {
    setTournamentResults((current) => {
      const previous = current[matchId] ?? {
        teamAScore: '',
        teamBScore: '',
        completed: false,
        note: '',
      }
      const next = { ...previous, ...patch }
      const a = Number(next.teamAScore)
      const b = Number(next.teamBScore)
      if (
        (patch.teamAScore !== undefined || patch.teamBScore !== undefined) &&
        next.teamAScore !== '' &&
        next.teamBScore !== '' &&
        Number.isFinite(a) &&
        Number.isFinite(b) &&
        a !== b
      ) {
        next.completed = true
      }
      return { ...current, [matchId]: next }
    })
  }

  const resetTournament = () => {
    const confirmed = window.confirm(
      '대회 팀, 설정, 결과가 기본값으로 돌아갑니다.\n계속 초기화할까요?',
    )
    if (!confirmed) return

    setTournamentTeams(defaultTournamentTeams)
    setTournamentSettings(defaultTournamentSettings)
    setTournamentResults({})
    setTournamentView('progress')
    setNotice('대회 초기화됨')
  }

  const matchPlayerName = (match: Match, player: Player) =>
    matchNameOverrides[match.id]?.[player.id]?.trim() ||
    playerDisplayName(player, displayNames)

  const matchTeamName = (match: Match, team: Team) =>
    team.map((player) => matchPlayerName(match, player)).join(' + ')

  const tournamentTeamName = (teamId: string | undefined) =>
    teamId ? tournamentTeamLookup.get(teamId)?.name ?? '팀 없음' : '대기'

  const tournamentTeamRoster = (teamId: string | undefined) =>
    teamId ? tournamentTeamLookup.get(teamId)?.playerNames.trim() ?? '' : ''

  const tournamentSideName = (
    match: TournamentMatch,
    side: 'A' | 'B',
  ) => {
    const teamId = side === 'A' ? match.teamAId : match.teamBId
    const source = side === 'A' ? match.sourceA : match.sourceB
    if (teamId) return tournamentTeamName(teamId)
    return source ?? '대기'
  }

  const tournamentWinnerLabel = (
    match: TournamentMatch,
    result: TournamentMatchResult | undefined,
  ) => {
    const winnerId = tournamentWinnerTeamId(match, result)
    if (winnerId) return tournamentTeamName(winnerId)
    return match.isBye ? '부전승' : '대기'
  }

  const updateMatchNameDraft = (
    matchId: string,
    playerId: string,
    value: string,
  ) => {
    setMatchNameDrafts((current) => ({
      ...current,
      [matchId]: {
        ...(current[matchId] ?? {}),
        [playerId]: value,
      },
    }))
  }

  const openMatchEditor = (match: Match) => {
    setMatchNameDrafts((current) => {
      const next = { ...current }
      const matchDraft = { ...(next[match.id] ?? {}) }
      for (const player of [...match.teamA, ...match.teamB]) {
        matchDraft[player.id] =
          matchDraft[player.id] ?? matchPlayerName(match, player)
      }
      next[match.id] = matchDraft
      return next
    })
    setEditingMatchIds((current) => ({ ...current, [match.id]: true }))
  }

  const saveMatchEditor = (match: Match) => {
    const nextOverrides = { ...(matchNameOverrides[match.id] ?? {}) }
    const matchDraft = matchNameDrafts[match.id] ?? {}

    for (const player of [...match.teamA, ...match.teamB]) {
      const baseName = playerDisplayName(player, displayNames)
      const nextName = (matchDraft[player.id] ?? baseName).trim()
      if (nextName && nextName !== baseName) {
        nextOverrides[player.id] = nextName
      } else {
        delete nextOverrides[player.id]
      }
    }

    setMatchNameOverrides((current) => {
      const next = { ...current }
      if (Object.keys(nextOverrides).length > 0) {
        next[match.id] = nextOverrides
      } else {
        delete next[match.id]
      }
      return next
    })
    setEditingMatchIds((current) => ({ ...current, [match.id]: false }))
    setNotice('카드 수정됨')
  }

  const setRegularPlayerCount = (targetCount: number) => {
    setPlayers((current) => {
      const regulars = current.filter((player) => !player.isGuest)
      const guests = current.filter((player) => player.isGuest)
      if (targetCount === regulars.length) return current

      const nextRegulars =
        targetCount > regulars.length
          ? [
              ...regulars,
              ...Array.from({ length: targetCount - regulars.length }, (_, index) =>
                makeRegularPlayer(regulars.length + index + 1),
              ),
            ]
          : regulars.slice(0, targetCount)

      return [...guests, ...nextRegulars]
    })
    setResults({})
    setPairMixes({})
    setMatchNameOverrides({})
  }

  const setGuestCount = (targetCount: number) => {
    setPlayers((current) => {
      const guests = current.filter((player) => player.isGuest)
      const regulars = current.filter((player) => !player.isGuest)
      if (targetCount === guests.length) return current

      const nextGuests =
        targetCount > guests.length
          ? [
              ...guests,
              ...Array.from({ length: targetCount - guests.length }, (_, index) =>
                makeGuestPlayer(guests.length + index + 1),
              ),
            ]
          : guests.slice(0, targetCount)

      return [...nextGuests, ...regulars]
    })
    setResults({})
    setPairMixes({})
    setMatchNameOverrides({})
  }

  const addPlayer = () => {
    setRegularPlayerCount(regularPlayers.length + 1)
  }

  const addGuest = () => {
    setGuestCount(guestPlayers.length + 1)
  }

  const removePlayer = (id: string) => {
    setPlayers((current) => current.filter((player) => player.id !== id))
    setResults({})
    setPairMixes({})
    setMatchNameOverrides({})
  }

  const handleReset = () => {
    const confirmed = window.confirm(
      '초기화하면 참가자, 설정, 경기 결과가 기본값으로 돌아갑니다.\n계속 초기화할까요?',
    )
    if (!confirmed) return

    setPlayers(defaultPlayers)
    setSettings(defaultSettings)
    setResults({})
    setPairMixes({})
    setMatchNameOverrides({})
    setNotice('초기화됨')
  }

  const reshuffle = () => {
    setSettings((current) => ({ ...current, seed: current.seed + 1 }))
    setResults({})
    setPairMixes({})
    setMatchNameOverrides({})
    setNotice('새 대진 생성됨')
  }

  const generateTwoHourSchedule = () => {
    setSettings((current) => ({
      ...current,
      seed: current.seed + 1,
      targetRoundCount: EVENT_LIMIT_ROUNDS,
    }))
    setResults({})
    setPairMixes({})
    setMatchNameOverrides({})
    setNotice('2시간 대진 생성됨')
  }

  const addScheduleRound = () => {
    setSettings((current) => ({
      ...current,
      targetRoundCount:
        Math.max(getTargetRoundCount(current), schedule.rounds.length) + 1,
    }))
    setNotice('추가 대진 생성됨')
  }

  const updateResult = (
    matchId: string,
    patch: Partial<MatchResult>,
  ) => {
    setResults((current) => {
      const previous = current[matchId] ?? {
        teamAScore: '',
        teamBScore: '',
        completed: false,
        note: '',
      }
      const next = { ...previous, ...patch }
      const a = Number(next.teamAScore)
      const b = Number(next.teamBScore)
      if (
        (patch.teamAScore !== undefined || patch.teamBScore !== undefined) &&
        next.teamAScore !== '' &&
        next.teamBScore !== '' &&
        Number.isFinite(a) &&
        Number.isFinite(b) &&
        a !== b
      ) {
        next.completed = true
      }
      return { ...current, [matchId]: next }
    })
  }

  const applyBulkPlayers = (mode: 'append' | 'replace') => {
    const parsedPlayers = parseBulkPlayers(bulkText)
    if (parsedPlayers.length === 0) {
      setNotice('추가할 명단 없음')
      return
    }

    setPlayers((current) =>
      mode === 'replace' ? parsedPlayers : [...current, ...parsedPlayers],
    )
    setResults({})
    setPairMixes({})
    setMatchNameOverrides({})
    setBulkText('')
    setNotice(`${parsedPlayers.length}명 입력됨`)
  }

  const applyBulkTournamentTeams = (mode: 'append' | 'replace') => {
    const parsedTeams = parseBulkTournamentTeams(tournamentBulkText)
    if (parsedTeams.length === 0) {
      setNotice('추가할 팀 없음')
      return
    }

    setTournamentTeams((current) =>
      mode === 'replace' ? parsedTeams : [...current, ...parsedTeams],
    )
    setTournamentResults({})
    setTournamentBulkText('')
    setNotice(`${parsedTeams.length}팀 입력됨`)
  }

  const runRouletteDraw = () => {
    if (isRouletteSpinning) return
    if (prizeDraw.mode === 'mission') {
      if (missionList.length === 0) {
        setNotice('미션 없음')
        return
      }
      if (availableMissions.length === 0) {
        setNotice('미션 완료')
        return
      }

      const mission =
        availableMissions[
          Math.min(
            availableMissions.length - 1,
            Math.floor(Math.random() * availableMissions.length),
          )
        ]
      const missionIndex = Math.max(
        0,
        missionList.findIndex((item) => item.id === mission.id),
      )
      const itemAngle = missionList.length > 0 ? 360 / missionList.length : 0
      const targetRotation = (360 - missionIndex * itemAngle) % 360

      if (rouletteTimerRef.current !== null) {
        window.clearTimeout(rouletteTimerRef.current)
      }

      setIsRouletteSpinning(true)
      setRouletteWinnerName('')
      setRouletteRotation((current) => {
        const normalizedCurrent = ((current % 360) + 360) % 360
        const offset = (targetRotation - normalizedCurrent + 360) % 360
        return current + 1440 + offset
      })

      rouletteTimerRef.current = window.setTimeout(() => {
        const result = {
          prize: `${mission.number}번`,
          winnerId: mission.id,
          winnerName: mission.mission,
          reward: mission.reward,
          done: false,
        }
        setPrizeDraw((current) => ({
          ...current,
          missionResults: [...current.missionResults, result],
        }))
        setRouletteWinnerName(mission.number)
        setIsRouletteSpinning(false)
        setNotice('미션 당첨')
        rouletteTimerRef.current = null
      }, 2200)
      return
    }

    if (prizeCandidates.length === 0) {
      setNotice('추첨 대상 없음')
      return
    }
    if (availableRouletteCandidates.length === 0) {
      setNotice('전원 추첨 완료')
      return
    }

    const [result] = drawPrizeWinners(
      [`${prizeDraw.results.length + 1}번째`],
      availableRouletteCandidates,
      true,
    )
    if (!result) return

    const winnerIndex = Math.max(
      0,
      rouletteItems.findIndex((candidate) => candidate.id === result.winnerId),
    )
    const itemAngle = rouletteItems.length > 0 ? 360 / rouletteItems.length : 0
    const targetRotation = (360 - winnerIndex * itemAngle) % 360

    if (rouletteTimerRef.current !== null) {
      window.clearTimeout(rouletteTimerRef.current)
    }

    setIsRouletteSpinning(true)
    setRouletteWinnerName('')
    setRouletteRotation((current) => {
      const normalizedCurrent = ((current % 360) + 360) % 360
      const offset = (targetRotation - normalizedCurrent + 360) % 360
      return current + 1440 + offset
    })

    rouletteTimerRef.current = window.setTimeout(() => {
      setPrizeDraw((current) => ({
        ...current,
        results: [...current.results, result],
      }))
      setRouletteWinnerName(result.winnerName)
      setIsRouletteSpinning(false)
      setNotice(`${result.winnerName} 당첨`)
      rouletteTimerRef.current = null
    }, 2200)
  }

  const runPrizeDraw = () => {
    if (prizeDraw.mode === 'mission' || isRouletteMode) {
      runRouletteDraw()
      return
    }
    if (isRouletteSpinning) return
    if (prizeCandidates.length === 0) {
      setNotice('추첨 대상 없음')
      return
    }

    const results = drawPrizeWinners(
      prizeList,
      prizeCandidates,
      prizeDraw.allowDuplicateWinners,
    )
    setPrizeDraw((current) => ({ ...current, results }))
    setRouletteWinnerName('')
    setNotice(
      results.length < prizeList.length
        ? `${results.length}개 추첨됨`
        : `${results.length}개 추첨 완료`,
    )
  }

  const resetPrizeDrawResults = () => {
    if (rouletteTimerRef.current !== null) {
      window.clearTimeout(rouletteTimerRef.current)
      rouletteTimerRef.current = null
    }
    setPrizeDraw((current) =>
      current.mode === 'mission'
        ? { ...current, missionResults: [] }
        : { ...current, results: [] },
    )
    setIsRouletteSpinning(false)
    setRouletteWinnerName('')
    setNotice('추첨 초기화됨')
  }

  const copyPrizeDrawResults = async () => {
    if (activePrizeResults.length === 0) {
      setNotice('복사할 결과 없음')
      return
    }

    try {
      await copyToClipboard(
        activePrizeResults
          .map((result) =>
            prizeDraw.mode === 'mission'
              ? `${result.prize} - ${result.winnerName} - ${result.reward ?? '상품'} - ${
                  result.done ? '지급' : '대기'
                }`
              : `${result.prize} - ${result.winnerName}`,
          )
          .join('\n'),
      )
      setNotice('추첨 결과 복사됨')
    } catch {
      setNotice('결과 복사 실패')
    }
  }

  const toggleMissionPrizeDone = (index: number) => {
    setPrizeDraw((current) => ({
      ...current,
      missionResults: current.missionResults.map((result, resultIndex) =>
        resultIndex === index ? { ...result, done: !result.done } : result,
      ),
    }))
  }

  const drawMissionForMatch = (matchId: string) => {
    if (missionList.length === 0) {
      setNotice('미션 없음')
      return
    }

    const mission =
      missionList[
        Math.min(missionList.length - 1, Math.floor(Math.random() * missionList.length))
      ]
    setPrizeDraw((current) => ({
      ...current,
      matchMissions: {
        ...current.matchMissions,
        [matchId]: {
          prize: `${mission.number}번`,
          winnerId: mission.id,
          winnerName: mission.mission,
          reward: mission.reward,
          done: false,
        },
      },
    }))
    setNotice(`${mission.number}번 미션`)
  }

  const toggleMatchMissionDone = (matchId: string) => {
    setPrizeDraw((current) => {
      const mission = current.matchMissions[matchId]
      if (!mission) return current

      return {
        ...current,
        matchMissions: {
          ...current.matchMissions,
          [matchId]: { ...mission, done: !mission.done },
        },
      }
    })
  }

  const mixMatch = (matchId: string) => {
    setPairMixes((current) => ({
      ...current,
      [matchId]: ((current[matchId] ?? 0) + 1) % 3,
    }))
    setResults((current) => {
      const next = { ...current }
      delete next[matchId]
      return next
    })
    setNotice('파트너 변경됨')
  }

  const handleCopyShareLink = async () => {
    try {
      const sharePayload: SharePayload = {
        version: 1,
        generatedAt: new Date().toISOString(),
        appMode,
        players,
        settings,
        results,
        pairMixes,
        matchNameOverrides,
        prizeDraw,
        tournamentTeams,
        tournamentSettings,
        tournamentResults,
      }
      await copyToClipboard(makeShareUrl(window.location.href, sharePayload))
      setNotice('공유 링크 복사됨')
    } catch {
      setNotice('공유 링크 실패')
    }
  }

  const saveScheduleImages = (imageUrls: string[]) => {
    const baseName = sanitizeFilename(settings.eventName)
    imageUrls.forEach((imageUrl, index) => {
      downloadImage(imageUrl, `${baseName}-대진표-${index + 1}.svg`)
    })
    setNotice(`대진표 저장 ${imageUrls.length}장`)
  }

  const handlePrintSchedule = () => {
    try {
      const imageUrls = createSchedulePrintImages({
        generatedAt: new Date(),
        names: displayNames,
        results,
        schedule,
        settings,
        matchNameOverrides,
      })

      setPrintImageUrls(imageUrls)
      saveScheduleImages(imageUrls)
    } catch {
      setNotice('대진표 저장 실패')
    }
  }

  const savePreparedScheduleImages = () => {
    if (printImageUrls.length === 0) {
      handlePrintSchedule()
      return
    }

    saveScheduleImages(printImageUrls)
  }

  const saveTournamentScheduleImages = (imageUrls: string[]) => {
    const baseName = sanitizeFilename(`${defaultSettings.eventName}-대회`)
    imageUrls.forEach((imageUrl, index) => {
      downloadImage(imageUrl, `${baseName}-대진표-${index + 1}.svg`)
    })
    setNotice(`대회 대진표 저장 ${imageUrls.length}장`)
  }

  const handlePrintTournament = () => {
    try {
      const imageUrls = createTournamentPrintImages({
        generatedAt: new Date(),
        results: tournamentResults,
        schedule: tournamentSchedule,
        settings: tournamentSettings,
        teams: tournamentTeams,
        title: defaultSettings.eventName,
      })

      setTournamentPrintImageUrls(imageUrls)
      saveTournamentScheduleImages(imageUrls)
    } catch {
      setNotice('대회 대진표 저장 실패')
    }
  }

  const savePreparedTournamentScheduleImages = () => {
    if (tournamentPrintImageUrls.length === 0) {
      handlePrintTournament()
      return
    }

    saveTournamentScheduleImages(tournamentPrintImageUrls)
  }

  const useSharedCopy = () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        appMode,
        players,
        settings,
        results,
        pairMixes,
        matchNameOverrides,
        prizeDraw,
        tournamentTeams,
        tournamentSettings,
        tournamentResults,
      }),
    )
    window.history.replaceState(null, '', getBaseUrl())
    setIsSharedMode(false)
    setNotice('편집 모드')
  }

  const openMySchedule = () => {
    window.location.href = getBaseUrl()
  }

  const renderTournamentSide = (match: TournamentMatch, side: 'A' | 'B') => {
    const teamId = side === 'A' ? match.teamAId : match.teamBId
    const roster = tournamentTeamRoster(teamId)

    return (
      <div className={`tournament-side ${teamId ? '' : 'pending-side'}`}>
        <strong>{tournamentSideName(match, side)}</strong>
        {roster ? <span>{roster}</span> : null}
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-block">
          <img className="brand-logo" src={amaLogo} alt="" aria-hidden="true" />
          <div>
            <h1 className="app-title">A.M.A Match Maker Pro</h1>
          </div>
        </div>

        <div className="mode-switch" aria-label="운영 모드">
          <button
            type="button"
            className={appMode === 'meeting' ? 'active' : ''}
            onClick={() => setAppModeAndNotice('meeting')}
          >
            모임
          </button>
          <button
            type="button"
            className={appMode === 'tournament' ? 'active' : ''}
            onClick={() => setAppModeAndNotice('tournament')}
          >
            대회
          </button>
        </div>

        <div className="header-actions">
          {isSharedMode ? (
            <>
              <button type="button" className="primary-action" onClick={useSharedCopy}>
                편집
              </button>
              <button type="button" onClick={openMySchedule}>
                새로
              </button>
              <button type="button" onClick={handleCopyShareLink}>
                공유
              </button>
              <button
                type="button"
                onClick={appMode === 'meeting' ? handlePrintSchedule : handlePrintTournament}
              >
                저장
              </button>
              <span className="header-status">{notice}</span>
            </>
          ) : appMode === 'meeting' ? (
            <>
              <button
                type="button"
                className="primary-action"
                onClick={generateTwoHourSchedule}
              >
                생성
              </button>
              <button type="button" onClick={reshuffle}>
                섞기
              </button>
              <button type="button" onClick={handleCopyShareLink}>
                공유
              </button>
              <button type="button" onClick={handlePrintSchedule}>
                저장
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="primary-action"
                onClick={() => setTournamentView('progress')}
              >
                진행
              </button>
              <button
                type="button"
                onClick={() => {
                  setTournamentResults({})
                  setNotice('대회 결과 초기화됨')
                }}
              >
                초기화
              </button>
              <button type="button" onClick={handleCopyShareLink}>
                공유
              </button>
              <button type="button" onClick={handlePrintTournament}>
                저장
              </button>
            </>
          )}
        </div>
      </header>

      {appMode === 'meeting' ? (
      <main className={`app-shell ${isSharedMode ? 'shared-shell' : ''}`}>
        {!isSharedMode ? (
        <aside className="control-panel">
          <section className="panel-section">
            <div className="section-heading">
              <h2>설정</h2>
              <span>{notice}</span>
            </div>
            <div className="settings-grid">
              <NumberStepper
                label="참가"
                min={0}
                max={80}
                value={regularPlayers.length}
                onChange={setRegularPlayerCount}
              />
              <NumberStepper
                label="스페셜"
                min={0}
                max={12}
                value={guestPlayers.length}
                onChange={setGuestCount}
              />
              <NumberStepper
                label="코트"
                min={1}
                max={12}
                value={settings.courtCount}
                onChange={(courtCount) => {
                  setSettings((current) => ({ ...current, courtCount }))
                  setResults({})
                  setPairMixes({})
                  setMatchNameOverrides({})
                }}
              />
              {guestPlayers.length > 0 ? (
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.singleGuestPerMatch}
                    onChange={(event) => {
                      setSettings((current) => ({
                        ...current,
                        singleGuestPerMatch: event.target.checked,
                      }))
                      setResults({})
                      setPairMixes({})
                      setMatchNameOverrides({})
                    }}
                  />
                  스페셜 1 + 참가자 3
                </label>
              ) : null}
            </div>
            <div className="metric-grid">
              <div>
                <strong>{activeMembers.length}</strong>
                <span>참가</span>
              </div>
              <div>
                <strong>{activeGuests.length}</strong>
                <span>스페셜</span>
              </div>
              <div>
                <strong>
                  {hasActiveGuests
                    ? `${schedule.specialCompletedIds.length}/${requiredPlayers.length}`
                    : totalMatches}
                </strong>
                <span>{hasActiveGuests ? '1회 이상' : '대진'}</span>
              </div>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <div>
                <h2>참가자</h2>
                <span>
                  참가 {activeMembers.length}명 · 스페셜 {activeGuests.length}명 · 1회 이상{' '}
                  {requiredPlayers.length}명
                </span>
              </div>
              <div className="compact-actions">
                <button type="button" onClick={addPlayer}>
                  추가
                </button>
                <button type="button" onClick={addGuest}>
                  스페셜
                </button>
                <button type="button" onClick={() => setBulkOpen((open) => !open)}>
                  일괄
                </button>
                <button type="button" onClick={handleReset}>
                  초기화
                </button>
                <button type="button" onClick={() => setPlayersOpen((open) => !open)}>
                  {playersOpen ? '접기' : '펼치기'}
                </button>
              </div>
            </div>

            {playersOpen ? (
              <>
                {bulkOpen ? (
                  <div className="bulk-panel">
                    <div className="bulk-help">
                      입력 순서: 이름 레벨 성별 연령대 · 예: 참가자 1 A 남 30대
                    </div>
                    <textarea
                      value={bulkText}
                      onChange={(event) => setBulkText(event.target.value)}
                      placeholder={'참가자 1 A 남 30대\n참가자 2 B 여 40대\n참가자 3 스페셜'}
                    />
                    <div className="bulk-actions">
                      <button type="button" onClick={() => applyBulkPlayers('append')}>
                        추가
                      </button>
                      <button type="button" onClick={() => applyBulkPlayers('replace')}>
                        교체
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="player-list">
                  {players.map((player) => {
                    const isSpecialLevel = player.level === '스페셜'
                    const displayName = playerDisplayName(player, displayNames)
                    const rawName = player.name.trim() || '참가자'

                    return (
                      <article
                        className={`player-row ${player.isGuest ? 'special-row' : ''}`}
                        key={player.id}
                      >
                        <div className="row-top">
                          <div className="row-status">
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={player.active}
                                onChange={(event) =>
                                  updatePlayer(player.id, { active: event.target.checked })
                                }
                              />
                              참석
                            </label>
                            {player.isGuest ? <span className="status-chip">스페셜</span> : null}
                          </div>
                          <button
                            type="button"
                            className="icon-button"
                            title="삭제"
                            onClick={() => removePlayer(player.id)}
                          >
                            ×
                          </button>
                        </div>
                        <input
                          className="name-input"
                          value={player.name}
                          onChange={(event) =>
                            updatePlayer(player.id, { name: event.target.value })
                          }
                        />
                        {displayName !== rawName ? (
                          <div className="name-display-hint">표시명 {displayName}</div>
                        ) : null}
                        <div className={isSpecialLevel ? 'row-fields single-field' : 'row-fields'}>
                          <label>
                            레벨
                            <select
                              value={player.level}
                              onChange={(event) => {
                                const level = event.target.value as Level
                                updatePlayer(player.id, {
                                  level,
                                  ...(level === '스페셜'
                                    ? {
                                        isGuest: true,
                                        gender: 'none' as Gender,
                                        specialRequired: false,
                                      }
                                    : { isGuest: false }),
                                })
                              }}
                            >
                              {levelOptions.map((level) => (
                                <option value={level} key={level}>
                                  {levelLabels[level]}
                                </option>
                              ))}
                            </select>
                          </label>
                          {!isSpecialLevel ? (
                            <>
                              <label>
                                연령대
                                <select
                                  value={player.ageGroup}
                                  onChange={(event) =>
                                    updatePlayer(player.id, {
                                      ageGroup: event.target.value as AgeGroup,
                                    })
                                  }
                                >
                                  {ageGroups.map((ageGroup) => (
                                    <option value={ageGroup} key={ageGroup}>
                                      {ageGroup}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                성별
                                <select
                                  value={player.gender}
                                  onChange={(event) =>
                                    updatePlayer(player.id, {
                                      gender: event.target.value as Gender,
                                    })
                                  }
                                >
                                  <option value="male">남</option>
                                  <option value="female">여</option>
                                  <option value="none">무관</option>
                                </select>
                              </label>
                            </>
                          ) : null}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="collapsed-summary">
                참가자 목록이 접혀 있습니다. 펼치기를 누르면 명단을 편집할 수 있습니다.
              </div>
            )}
          </section>

          <section className="panel-section prize-panel">
            <div className="section-heading">
              <div>
                <h2>경품 추첨</h2>
                <span>
                  {prizeDraw.mode === 'mission'
                    ? `미션 ${availableMissions.length}/${missionList.length}개`
                    : isRouletteMode
                      ? `룰렛 ${availableRouletteCandidates.length}/${prizeCandidates.length}명`
                      : `대상 ${prizeCandidates.length}명 · 경품 ${prizeList.length}개`}
                </span>
              </div>
              <div className="compact-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={isRouletteSpinning}
                  onClick={runPrizeDraw}
                >
                  {isRouletteSpinning ? '회전중' : '추첨'}
                </button>
                <button type="button" onClick={copyPrizeDrawResults}>
                  복사
                </button>
                <button type="button" onClick={resetPrizeDrawResults}>
                  초기화
                </button>
              </div>
            </div>

            <div className="prize-draw-box">
              <div className="prize-mode-switch" aria-label="추첨 종류">
                <button
                  type="button"
                  className={prizeDraw.mode === 'people' ? 'active' : ''}
                  onClick={() =>
                    setPrizeDraw((current) => ({ ...current, mode: 'people' }))
                  }
                >
                  사람
                </button>
                <button
                  type="button"
                  className={prizeDraw.mode === 'mission' ? 'active' : ''}
                  onClick={() =>
                    setPrizeDraw((current) => ({ ...current, mode: 'mission' }))
                  }
                >
                  미션
                </button>
              </div>
              <div className="bulk-help">
                {prizeDraw.mode === 'mission'
                  ? '입력 안내: 번호 / 미션 / 상품 순'
                  : '입력 안내: 경품은 한 줄에 하나씩 · 비워두면 참가자 룰렛'}
              </div>
              {(prizeDraw.mode === 'mission' || isRouletteMode) ? (
                <div className="prize-roulette" aria-live="polite">
                  <div className="prize-roulette-pointer" />
                  <div
                    className={`prize-roulette-wheel ${
                      isRouletteSpinning ? 'spinning' : ''
                    }`}
                    style={rouletteWheelStyle}
                  >
                    {rouletteItems.map((candidate, index) => (
                      <span
                        className="prize-roulette-name"
                        key={candidate.id}
                        style={
                          {
                            '--name-angle': `${
                              (360 / Math.max(rouletteItems.length, 1)) * index
                            }deg`,
                            '--name-angle-reverse': `${
                              (-360 / Math.max(rouletteItems.length, 1)) * index
                            }deg`,
                          } as CSSProperties
                        }
                      >
                        {candidate.name}
                      </span>
                    ))}
                  </div>
                  <div className="prize-roulette-center">
                    <span>
                      {isRouletteSpinning
                        ? '회전중'
                        : rouletteWinnerName
                          ? '당첨'
                          : '대기'}
                    </span>
                    <strong>
                      {isRouletteSpinning
                        ? '...'
                        : rouletteWinnerName ||
                          (prizeDraw.mode === 'mission'
                            ? `${availableRouletteCount}개`
                            : `${availableRouletteCount}명`)}
                    </strong>
                  </div>
                </div>
              ) : null}
              {prizeDraw.mode === 'mission' ? (
                <textarea
                  className="prize-textarea"
                  value={prizeDraw.missionsText}
                  onChange={(event) =>
                    setPrizeDraw((current) => ({
                      ...current,
                      missionsText: event.target.value,
                    }))
                  }
                  placeholder="번호 / 미션 / 상품"
                />
              ) : (
                <>
                  <textarea
                    className="prize-textarea"
                    value={prizeDraw.prizesText}
                    onChange={(event) =>
                      setPrizeDraw((current) => ({
                        ...current,
                        prizesText: event.target.value,
                      }))
                    }
                    placeholder="경품 입력창"
                  />
                  <label className="settings-checkbox prize-duplicate-option">
                    <input
                      type="checkbox"
                      checked={prizeDraw.allowDuplicateWinners}
                      onChange={(event) =>
                        setPrizeDraw((current) => ({
                          ...current,
                          allowDuplicateWinners: event.target.checked,
                        }))
                      }
                    />
                    중복 허용
                  </label>
                </>
              )}
              {activePrizeResults.length > 0 ? (
                <div className="prize-result-list">
                  {activePrizeResults.map((result, index) => (
                    <div
                      className={`prize-result-row ${
                        prizeDraw.mode === 'mission' ? 'mission-result-row' : ''
                      }`}
                      key={`${result.prize}-${index}`}
                    >
                      {prizeDraw.mode === 'mission' ? (
                        <>
                          <div className="mission-result-text">
                            <strong>{result.prize}</strong>
                            <span>{result.winnerName}</span>
                            {result.reward ? <em>{result.reward}</em> : null}
                          </div>
                          <button
                            type="button"
                            className={
                              result.done
                                ? 'mission-done-button active'
                                : 'mission-done-button'
                            }
                            onClick={() => toggleMissionPrizeDone(index)}
                          >
                            {result.done ? '지급' : '대기'}
                          </button>
                        </>
                      ) : (
                        <>
                          <strong>{result.prize}</strong>
                          <span>{result.winnerName}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="collapsed-summary">
                  {prizeDraw.mode === 'mission'
                    ? '미션 입력 후 대진 카드의 미션 버튼을 누르세요.'
                    : '참석 중인 참가자와 스페셜 전체가 추첨 대상입니다.'}
                </div>
              )}
            </div>
          </section>
        </aside>
        ) : null}

        <section className="workspace">
          {hasActiveGuests ? (
            <section className="special-bar">
              <div>
                <span className="eyebrow">스페셜 1회 이상</span>
                <h2>
                  {schedule.specialCompletedIds.length} / {requiredPlayers.length}
                </h2>
              </div>
              <div className="special-summary">
                {activeGuests.map((guest) => (
                  <span key={guest.id}>
                    {playerDisplayName(guest, displayNames)}{' '}
                    {schedule.guestGameCounts[guest.id] ?? 0}경기
                  </span>
                ))}
              </div>
              <div className="pending-line">
                {pendingSpecial.length > 0
                  ? pendingSpecial
                      .map((player) => playerDisplayName(player, displayNames))
                      .join(', ')
                  : '1회 이상 완료'}
              </div>
            </section>
          ) : null}

          {schedule.warnings.length > 0 ? (
            <div className="warning-strip">
              {schedule.warnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}

          <section className={`time-bar ${overtimeGameSlots > 0 ? 'time-overrun' : ''}`}>
            <div>
              <span className="eyebrow">진행 시간</span>
              <h2>
                {inTimeGameSlots}/{EVENT_LIMIT_ROUNDS}경기
              </h2>
            </div>
            <div className="time-summary">
              <span>{GAME_SLOT_MINUTES}분 기준</span>
              <span>{formatDuration(EVENT_LIMIT_MINUTES)} 내 {EVENT_LIMIT_ROUNDS}경기</span>
              <span>생성 {totalGameSlots}/{targetRoundCount}경기</span>
              <span>예상 {formatDuration(estimatedMinutes)}</span>
            </div>
            <div className={overtimeGameSlots > 0 ? 'time-alert' : 'time-ok'}>
              {overtimeGameSlots > 0
                ? `${EVENT_LIMIT_ROUNDS + 1}경기부터 초과 · ${overtimeGameSlots}경기`
                : '2시간 내 완료'}
            </div>
          </section>

          {printImageUrls.length > 0 ? (
            <section className="print-preview-panel">
              <div className="section-heading">
                <div>
                  <h2>대진표 이미지</h2>
                  <span>A4 {printImageUrls.length}장 생성됨</span>
                </div>
                <div className="compact-actions">
                  <button type="button" onClick={savePreparedScheduleImages}>
                    저장
                  </button>
                  <button type="button" onClick={() => setPrintImageUrls([])}>
                    닫기
                  </button>
                </div>
              </div>
              <div className="print-preview-list">
                {printImageUrls.map((imageUrl, index) => (
                  <article className="print-preview-page" key={imageUrl}>
                    <img src={imageUrl} alt={`대진표 ${index + 1}쪽`} />
                    <a href={imageUrl} download={`대진표-${index + 1}.svg`}>
                      {index + 1}쪽 저장
                    </a>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <nav className="tab-row" aria-label="보기 선택">
            <button
              type="button"
              className={view === 'schedule' ? 'active' : ''}
              onClick={() => setView('schedule')}
            >
              대진표
            </button>
            <button
              type="button"
              className={view === 'stats' ? 'active' : ''}
              onClick={() => setView('stats')}
            >
              통계
            </button>
            <span>
              {completedMatches}/{totalMatches} 경기 완료
            </span>
          </nav>

          {view === 'schedule' ? (
            <div className="round-list">
              {schedule.rounds.map((round) => {
                const isOvertimeRound = round.number > EVENT_LIMIT_ROUNDS
                const startsAt = (round.number - 1) * GAME_SLOT_MINUTES
                const endsAt = round.number * GAME_SLOT_MINUTES

                return (
                  <section
                    className={`round-section ${
                      isOvertimeRound ? 'overtime-round' : ''
                    }`}
                    key={round.id}
                  >
                    <div className="round-heading">
                      <div className="round-title">
                        <h2>{round.number}경기</h2>
                        <span className={`time-chip ${isOvertimeRound ? 'over' : ''}`}>
                          {isOvertimeRound ? '2시간 초과' : '2시간 내'}
                        </span>
                      </div>
                      <span>
                        예상 {formatDuration(startsAt)}-{formatDuration(endsAt)} · 휴식{' '}
                        {round.resting.length > 0
                          ? round.resting
                              .map((player) => playerDisplayName(player, displayNames))
                              .join(', ')
                          : '없음'}
                      </span>
                    </div>
                    <div className="match-grid">
                      {round.matches.map((match) => {
                        const result = results[match.id] ?? {
                          teamAScore: '',
                          teamBScore: '',
                          completed: false,
                          note: '',
                        }
                        const isEditingMatch = Boolean(editingMatchIds[match.id])
                        const matchOverrides = matchNameOverrides[match.id] ?? {}
                        const matchMission = prizeDraw.matchMissions[match.id]
                        const renderTeamName = (team: Team, teamLabel: string) =>
                          isEditingMatch && !isSharedMode ? (
                            <div className="team-name-edit">
                              {team.map((player, playerIndex) => (
                                <input
                                  key={player.id}
                                  aria-label={`${teamLabel} ${playerIndex + 1} 이름`}
                                  value={
                                    matchNameDrafts[match.id]?.[player.id] ??
                                    matchPlayerName(match, player)
                                  }
                                  onChange={(event) =>
                                    updateMatchNameDraft(
                                      match.id,
                                      player.id,
                                      event.target.value,
                                    )
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') saveMatchEditor(match)
                                  }}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="team-name">
                              {matchTeamName(match, team)}
                            </div>
                          )

                        return (
                          <article
                            className={`match-card ${
                              match.isSpecial ? 'special-match' : ''
                            }`}
                            key={match.id}
                          >
                            <header>
                              <span>코트 {match.court}</span>
                              <div className="match-card-actions">
                                {!isSharedMode ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        isEditingMatch
                                          ? saveMatchEditor(match)
                                          : openMatchEditor(match)
                                      }
                                    >
                                      {isEditingMatch ? '완료' : '수정'}
                                    </button>
                                    <button type="button" onClick={() => mixMatch(match.id)}>
                                      믹스
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => drawMissionForMatch(match.id)}
                                    >
                                      미션
                                    </button>
                                  </>
                                ) : null}
                                {match.isSpecial ? <strong>스페셜</strong> : null}
                              </div>
                            </header>
                            {matchMission ? (
                              <div className="match-mission-box">
                                <div>
                                  <strong>{matchMission.prize}</strong>
                                  <span>{matchMission.winnerName}</span>
                                  {matchMission.reward ? (
                                    <em>{matchMission.reward}</em>
                                  ) : null}
                                </div>
                                {!isSharedMode ? (
                                  <button
                                    type="button"
                                    className={
                                      matchMission.done
                                        ? 'mission-done-button active'
                                        : 'mission-done-button'
                                    }
                                    onClick={() => toggleMatchMissionDone(match.id)}
                                  >
                                    {matchMission.done ? '지급' : '대기'}
                                  </button>
                                ) : (
                                  <span>{matchMission.done ? '지급' : '대기'}</span>
                                )}
                              </div>
                            ) : null}
                            <div className={`score-row ${isSharedMode ? 'read-only-score' : ''}`}>
                              {renderTeamName(match.teamA, 'A팀')}
                              {isSharedMode ? (
                                <span className="score-value">{result.teamAScore || '-'}</span>
                              ) : (
                                <input
                                  className="score-input"
                                  aria-label={`${matchTeamName(match, match.teamA)} 점수`}
                                  type="number"
                                  min="0"
                                  value={result.teamAScore}
                                  onChange={(event) =>
                                    updateResult(match.id, {
                                      teamAScore: event.target.value,
                                    })
                                  }
                                />
                              )}
                            </div>
                            <div className={`score-row ${isSharedMode ? 'read-only-score' : ''}`}>
                              {renderTeamName(match.teamB, 'B팀')}
                              {isSharedMode ? (
                                <span className="score-value">{result.teamBScore || '-'}</span>
                              ) : (
                                <input
                                  className="score-input"
                                  aria-label={`${matchTeamName(match, match.teamB)} 점수`}
                                  type="number"
                                  min="0"
                                  value={result.teamBScore}
                                  onChange={(event) =>
                                    updateResult(match.id, {
                                      teamBScore: event.target.value,
                                    })
                                  }
                                />
                              )}
                            </div>
                            <div className="match-footer">
                              {isSharedMode ? (
                                <span>{result.completed ? '완료' : '대기'}</span>
                              ) : (
                                <label className="checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={result.completed}
                                    disabled={!hasScore(result)}
                                    onChange={(event) =>
                                      updateResult(match.id, {
                                        completed: event.target.checked,
                                      })
                                    }
                                  />
                                  완료
                                </label>
                              )}
                              <span>{winnerLabel(match, result, displayNames, matchOverrides)}</span>
                            </div>
                            {isSharedMode ? (
                              result.note ? (
                                <div className="note-readonly">{result.note}</div>
                              ) : null
                            ) : (
                              <input
                                className="note-input"
                                placeholder="메모"
                                value={result.note}
                                onChange={(event) =>
                                  updateResult(match.id, { note: event.target.value })
                                }
                              />
                            )}
                          </article>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
              {!isSharedMode && schedule.rounds.length > 0 ? (
                <div className="add-round-panel">
                  <button type="button" onClick={addScheduleRound}>
                    추가 생성
                  </button>
                  <span>
                    생성 {totalGameSlots}/{targetRoundCount}경기 · 다음 경기{' '}
                    {formatDuration(totalGameSlots * GAME_SLOT_MINUTES)}
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <section className="stats-section">
              <div className="stats-table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>레벨</th>
                      <th>연령대</th>
                      <th>성별</th>
                      <th>경기</th>
                      <th>휴식</th>
                      <th>승</th>
                      <th>패</th>
                      <th>승률</th>
                      <th>득실</th>
                      <th>스페셜 경기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((stat) => {
                      const decided = stat.wins + stat.losses
                      const winRate =
                        decided > 0 ? Math.round((stat.wins / decided) * 100) : 0
                      return (
                        <tr key={stat.player.id}>
                          <td>{playerDisplayName(stat.player, displayNames)}</td>
                          <td>{stat.player.level}</td>
                          <td>
                            {stat.player.level === '스페셜' ? '-' : stat.player.ageGroup}
                          </td>
                          <td>
                            {stat.player.level === '스페셜'
                              ? '-'
                              : genderLabels[stat.player.gender]}
                          </td>
                          <td>{stat.games}</td>
                          <td>{stat.rests}</td>
                          <td>{stat.wins}</td>
                          <td>{stat.losses}</td>
                          <td>{winRate}%</td>
                          <td>{stat.pointsFor - stat.pointsAgainst}</td>
                          <td>
                            {stat.player.isGuest
                              ? `${schedule.guestGameCounts[stat.player.id] ?? 0}경기`
                              : `${stat.guestGames}경기`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </section>
      </main>
      ) : (
        <main className={`app-shell tournament-shell ${isSharedMode ? 'shared-shell' : ''}`}>
          {!isSharedMode ? (
            <aside className="control-panel tournament-panel">
              <section className="panel-section">
                <div className="section-heading">
                  <h2>대회 설정</h2>
                  <span>{notice}</span>
                </div>

                <div className="format-list" aria-label="대회 진행 방식">
                  {(Object.keys(tournamentFormatLabels) as TournamentFormat[]).map(
                    (format) => (
                      <button
                        type="button"
                        className={
                          tournamentSettings.format === format ? 'active' : ''
                        }
                        key={format}
                        onClick={() => updateTournamentSettings({ format })}
                      >
                        <strong>{tournamentFormatLabels[format]}</strong>
                        <span>{tournamentFormatDescriptions[format]}</span>
                      </button>
                    ),
                  )}
                </div>

                <div className="settings-grid tournament-settings-grid">
                  <NumberStepper
                    label="코트"
                    min={1}
                    max={12}
                    value={tournamentSettings.courtCount}
                    onChange={(courtCount) => updateTournamentSettings({ courtCount })}
                  />
                  <NumberStepper
                    label="팀 수"
                    min={0}
                    max={64}
                    value={tournamentTeams.length}
                    onChange={setTournamentTeamCount}
                  />
                  <NumberStepper
                    label="시드"
                    min={0}
                    max={tournamentTeams.length}
                    value={seededTournamentTeams.length}
                    onChange={setTournamentSeedCount}
                  />
                  {tournamentSettings.format === 'group-knockout' ? (
                    <>
                      <NumberStepper
                        label="조"
                        min={1}
                        max={16}
                        value={tournamentSettings.groupCount}
                        onChange={(groupCount) =>
                          updateTournamentSettings({ groupCount })
                        }
                      />
                      <NumberStepper
                        label="진출"
                        min={1}
                        max={8}
                        value={tournamentSettings.advancePerGroup}
                        onChange={(advancePerGroup) =>
                          updateTournamentSettings({ advancePerGroup })
                        }
                      />
                    </>
                  ) : null}
                  {tournamentSettings.format === 'team-battle' ? (
                    <NumberStepper
                      label="세부"
                      min={1}
                      max={5}
                      value={tournamentSettings.teamBattleMatchCount}
                      onChange={(teamBattleMatchCount) =>
                        updateTournamentSettings({ teamBattleMatchCount })
                      }
                    />
                  ) : null}
                  {tournamentSettings.format !== 'team-battle' ? (
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={tournamentSettings.includeThirdPlace}
                        onChange={(event) =>
                          updateTournamentSettings({
                            includeThirdPlace: event.target.checked,
                          })
                        }
                      />
                      3·4위전
                    </label>
                  ) : null}
                </div>

                {tournamentSettings.format === 'team-battle' ? (
                  <div className="slot-editor">
                    {Array.from(
                      { length: tournamentSettings.teamBattleMatchCount },
                      (_, index) => {
                        const value =
                          tournamentSettings.teamBattleSlots[index] ??
                          `${index + 1}경기`

                        return (
                          <label key={index}>
                            {index + 1}경기
                            <input
                              value={value}
                              onChange={(event) => {
                                const teamBattleSlots = [
                                  ...tournamentSettings.teamBattleSlots,
                                ]
                                teamBattleSlots[index] = event.target.value
                                updateTournamentSettings({ teamBattleSlots })
                              }}
                            />
                          </label>
                        )
                      },
                    )}
                  </div>
                ) : null}
              </section>

              <section className="panel-section">
                <div className="section-heading">
                  <div>
                    <h2>팀 등록</h2>
                    <span>참가 {activeTournamentTeams.length}팀</span>
                  </div>
                  <div className="compact-actions">
                    <button type="button" onClick={addTournamentTeam}>
                      추가
                    </button>
                    <button
                      type="button"
                      onClick={() => setTournamentBulkOpen((open) => !open)}
                    >
                      일괄
                    </button>
                    <button type="button" onClick={resetTournament}>
                      초기화
                    </button>
                  </div>
                </div>

                {tournamentBulkOpen ? (
                  <div className="bulk-panel">
                    <div className="bulk-help">
                      {tournamentSettings.format === 'team-battle'
                        ? '입력 순서: 팀명 시드(선택) 선수명 · 숫자가 없으면 시드 없음'
                        : '입력 순서: 팀명 시드(선택) 레벨(선택) 성별(선택) 선수명 · 숫자가 없으면 시드 없음'}
                    </div>
                    <textarea
                      value={tournamentBulkText}
                      onChange={(event) => setTournamentBulkText(event.target.value)}
                      placeholder={
                        tournamentSettings.format === 'team-battle'
                          ? 'A팀 1 김철수 이영희\nB팀 박민지 최수진\nC팀, 3, 홍길동, 김하나'
                          : 'A팀 1 A 남 김철수 이영희\nB팀, 2, B, 여, 박민지, 최수진\nC팀 혼성 홍길동 김하나'
                      }
                    />
                    <div className="bulk-actions">
                      <button
                        type="button"
                        onClick={() => applyBulkTournamentTeams('append')}
                      >
                        추가
                      </button>
                      <button
                        type="button"
                        onClick={() => applyBulkTournamentTeams('replace')}
                      >
                        교체
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="player-list tournament-team-list">
                  {tournamentTeams.map((team, index) => (
                    <article className="player-row tournament-team-row" key={team.id}>
                      <div className="row-top">
                        <div className="row-status">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={team.active}
                              onChange={(event) =>
                                updateTournamentTeam(team.id, {
                                  active: event.target.checked,
                                })
                              }
                            />
                            참가
                          </label>
                          {team.seed ? (
                            <span className="status-chip">{team.seed}번 시드</span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="icon-button"
                          title="삭제"
                          onClick={() => removeTournamentTeam(team.id)}
                        >
                          ×
                        </button>
                      </div>
                      <input
                        className="name-input"
                        value={team.name}
                        onChange={(event) =>
                          updateTournamentTeam(team.id, { name: event.target.value })
                        }
                      />
                      <textarea
                        className="team-roster-input"
                        value={team.playerNames}
                        placeholder="선수명"
                        onChange={(event) =>
                          updateTournamentTeam(team.id, {
                            playerNames: event.target.value,
                          })
                        }
                      />
                      <div
                        className={
                          tournamentSettings.format === 'team-battle'
                            ? 'row-fields seed-row-fields'
                            : 'row-fields tournament-team-fields'
                        }
                      >
                        <label className="settings-checkbox seed-toggle">
                          <input
                            type="checkbox"
                            checked={team.seed !== null}
                            onChange={(event) =>
                              updateTournamentTeam(team.id, {
                                seed: event.target.checked ? index + 1 : null,
                              })
                            }
                          />
                          시드 지정
                        </label>
                        {team.seed !== null ? (
                          <label>
                            시드
                            <input
                              type="number"
                              min="1"
                              value={team.seed}
                              onChange={(event) =>
                                updateTournamentTeam(team.id, {
                                  seed: normalizeTournamentSeed(event.target.value),
                                })
                              }
                            />
                          </label>
                        ) : null}
                        {tournamentSettings.format !== 'team-battle' ? (
                          <>
                            <label>
                              레벨
                              <select
                                value={team.level}
                                onChange={(event) =>
                                  updateTournamentTeam(team.id, {
                                    level: event.target.value as Level,
                                  })
                                }
                              >
                                {levelOptions
                                  .filter((level) => level !== '스페셜')
                                  .map((level) => (
                                    <option value={level} key={level}>
                                      {levelLabels[level]}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <label>
                              성별
                              <select
                                value={team.gender}
                                onChange={(event) =>
                                  updateTournamentTeam(team.id, {
                                    gender: event.target.value as Gender,
                                  })
                                }
                              >
                                <option value="male">남</option>
                                <option value="female">여</option>
                                <option value="none">무관</option>
                              </select>
                            </label>
                          </>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </aside>
          ) : null}

          <section className="workspace tournament-workspace">
            <section className="tournament-summary-bar">
              <div>
                <span className="eyebrow">대회 진행</span>
                <h2>{tournamentFormatLabels[tournamentSettings.format]}</h2>
              </div>
              <div className="time-summary">
                <span>팀 {activeTournamentTeams.length}</span>
                <span>코트 {tournamentSettings.courtCount}</span>
                <span>
                  완료 {completedTournamentMatches}/{totalTournamentMatches}
                </span>
                <span>
                  {seededTournamentTeams.length > 0
                    ? `시드 ${seededTournamentTeams.length}`
                    : '시드 없음'}
                </span>
              </div>
              <div className="time-ok">
                {nextTournamentMatch
                  ? `${nextTournamentMatch.label} 대기`
                  : totalTournamentMatches > 0
                    ? '전체 완료'
                    : '대진 없음'}
              </div>
            </section>

            {tournamentSchedule.warnings.length > 0 ? (
              <div className="warning-strip">
                {tournamentSchedule.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}

            {tournamentPrintImageUrls.length > 0 ? (
              <section className="print-preview-panel">
                <div className="section-heading">
                  <div>
                    <h2>대회 대진표 이미지</h2>
                    <span>A4 {tournamentPrintImageUrls.length}장 생성됨</span>
                  </div>
                  <div className="compact-actions">
                    <button type="button" onClick={savePreparedTournamentScheduleImages}>
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={() => setTournamentPrintImageUrls([])}
                    >
                      닫기
                    </button>
                  </div>
                </div>
                <div className="print-preview-list">
                  {tournamentPrintImageUrls.map((imageUrl, index) => (
                    <article className="print-preview-page" key={imageUrl}>
                      <img src={imageUrl} alt={`대회 대진표 ${index + 1}쪽`} />
                      <a href={imageUrl} download={`대회-대진표-${index + 1}.svg`}>
                        {index + 1}쪽 저장
                      </a>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <nav className="tab-row" aria-label="대회 보기 선택">
              <button
                type="button"
                className={tournamentView === 'progress' ? 'active' : ''}
                onClick={() => setTournamentView('progress')}
              >
                진행
              </button>
              <button
                type="button"
                className={tournamentView === 'board' ? 'active' : ''}
                onClick={() => setTournamentView('board')}
              >
                순위/브래킷
              </button>
              <span>
                {completedTournamentMatches}/{totalTournamentMatches} 경기 완료
              </span>
            </nav>

            {tournamentView === 'progress' ? (
              <div className="round-list">
                {tournamentRounds.map(({ round, matches }) => (
                  <section className="round-section" key={round}>
                    <div className="round-heading">
                      <div className="round-title">
                        <h2>{round}순서</h2>
                        <span className="time-chip">코트 배정</span>
                      </div>
                      <span>
                        {matches
                          .map((match) => `${match.court}코트 ${match.label}`)
                          .join(' · ')}
                      </span>
                    </div>
                    <div className="match-grid">
                      {matches.map((match) => {
                        const result = tournamentResults[match.id] ?? {
                          teamAScore: '',
                          teamBScore: '',
                          completed: false,
                          note: '',
                        }
                        const canEditResult =
                          !isSharedMode &&
                          !match.isBye &&
                          Boolean(match.teamAId && match.teamBId)

                        return (
                          <article
                            className={`match-card tournament-match-card ${
                              match.isBye ? 'bye-match' : ''
                            }`}
                            key={match.id}
                          >
                            <header>
                              <span>
                                {match.court}코트 · {match.label}
                                {match.teamBattleSlot
                                  ? ` · ${match.teamBattleSlot}`
                                  : ''}
                              </span>
                              <div className="match-card-actions">
                                <strong>{tournamentPhaseLabels[match.phase]}</strong>
                                {match.isBye ? <strong>부전승</strong> : null}
                              </div>
                            </header>
                            <div
                              className={`score-row ${
                                !canEditResult ? 'read-only-score' : ''
                              }`}
                            >
                              {renderTournamentSide(match, 'A')}
                              {canEditResult ? (
                                <input
                                  className="score-input"
                                  aria-label={`${tournamentSideName(match, 'A')} 점수`}
                                  type="number"
                                  min="0"
                                  value={result.teamAScore}
                                  onChange={(event) =>
                                    updateTournamentResult(match.id, {
                                      teamAScore: event.target.value,
                                    })
                                  }
                                />
                              ) : (
                                <span className="score-value">
                                  {match.isBye ? 'BYE' : result.teamAScore || '-'}
                                </span>
                              )}
                            </div>
                            <div
                              className={`score-row ${
                                !canEditResult ? 'read-only-score' : ''
                              }`}
                            >
                              {renderTournamentSide(match, 'B')}
                              {canEditResult ? (
                                <input
                                  className="score-input"
                                  aria-label={`${tournamentSideName(match, 'B')} 점수`}
                                  type="number"
                                  min="0"
                                  value={result.teamBScore}
                                  onChange={(event) =>
                                    updateTournamentResult(match.id, {
                                      teamBScore: event.target.value,
                                    })
                                  }
                                />
                              ) : (
                                <span className="score-value">
                                  {match.isBye ? '-' : result.teamBScore || '-'}
                                </span>
                              )}
                            </div>
                            <div className="match-footer">
                              {canEditResult ? (
                                <label className="checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={result.completed}
                                    disabled={!tournamentHasScore(result)}
                                    onChange={(event) =>
                                      updateTournamentResult(match.id, {
                                        completed: event.target.checked,
                                      })
                                    }
                                  />
                                  완료
                                </label>
                              ) : (
                                <span>
                                  {tournamentWinnerTeamId(match, result)
                                    ? '완료'
                                    : '대기'}
                                </span>
                              )}
                              <span>{tournamentWinnerLabel(match, result)}</span>
                            </div>
                            {canEditResult ? (
                              <input
                                className="note-input"
                                placeholder="메모"
                                value={result.note}
                                onChange={(event) =>
                                  updateTournamentResult(match.id, {
                                    note: event.target.value,
                                  })
                                }
                              />
                            ) : result.note ? (
                              <div className="note-readonly">{result.note}</div>
                            ) : null}
                          </article>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <section className="tournament-board">
                {tournamentSettings.format === 'group-knockout' ? (
                  <div className="board-section">
                    <div className="section-heading">
                      <h2>조별 순위</h2>
                      <span>
                        상위 {tournamentSettings.advancePerGroup}팀 넉아웃 진출
                      </span>
                    </div>
                    <div className="standings-grid">
                      {tournamentSchedule.groups.map((group) => (
                        <div className="stats-table-wrap" key={group.id}>
                          <table className="stats-table compact-table">
                            <thead>
                              <tr>
                                <th>{group.name}</th>
                                <th>승</th>
                                <th>패</th>
                                <th>득실</th>
                                <th>득점</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tournamentSchedule.standings
                                .filter((standing) => standing.groupId === group.id)
                                .map((standing) => (
                                  <tr key={standing.team.id}>
                                    <td>
                                      {standing.rank}. {standing.team.name}
                                    </td>
                                    <td>{standing.wins}</td>
                                    <td>{standing.losses}</td>
                                    <td>{standing.pointDiff}</td>
                                    <td>{standing.pointsFor}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {tournamentSchedule.knockoutMatches.length > 0 ? (
                  <div className="board-section">
                    <div className="section-heading">
                      <h2>브래킷</h2>
                      <span>결과 입력 시 다음 경기 자동 배정</span>
                    </div>
                    <div className="bracket-list">
                      {tournamentSchedule.knockoutMatches.map((match) => {
                        const result = tournamentResults[match.id]

                        return (
                          <article className="bracket-item" key={match.id}>
                            <strong>{match.label}</strong>
                            <span>
                              {tournamentSideName(match, 'A')} vs{' '}
                              {tournamentSideName(match, 'B')}
                            </span>
                            <em>{tournamentWinnerLabel(match, result)}</em>
                          </article>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                {tournamentSettings.format === 'team-battle' ? (
                  <>
                    <div className="board-section">
                      <div className="section-heading">
                        <h2>단체전 순위</h2>
                        <span>세부 경기 승수 합산</span>
                      </div>
                      <div className="stats-table-wrap">
                        <table className="stats-table">
                          <thead>
                            <tr>
                              <th>팀</th>
                              <th>단체승</th>
                              <th>단체패</th>
                              <th>세부승</th>
                              <th>세부패</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tournamentSchedule.teamBattleStandings.map((standing) => (
                              <tr key={standing.team.id}>
                                <td>
                                  {standing.rank}. {standing.team.name}
                                </td>
                                <td>{standing.tiesWon}</td>
                                <td>{standing.tiesLost}</td>
                                <td>{standing.matchWins}</td>
                                <td>{standing.matchLosses}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="board-section">
                      <div className="section-heading">
                        <h2>팀 대전</h2>
                        <span>{tournamentSettings.teamBattleMatchCount}경기제</span>
                      </div>
                      <div className="bracket-list">
                        {tournamentSchedule.teamBattleTies.map((tie) => (
                          <article className="bracket-item" key={tie.id}>
                            <strong>{tie.label}</strong>
                            <span>
                              {tie.teamAWins} - {tie.teamBWins}
                            </span>
                            <em>
                              {tie.winnerTeamId
                                ? tournamentTeamName(tie.winnerTeamId)
                                : '대기'}
                            </em>
                          </article>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
              </section>
            )}
          </section>
        </main>
      )}
    </div>
  )
}

export default App
