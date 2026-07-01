import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { defaultPlayers, defaultSettings } from './defaultData'
import { calculateStats, generateSchedule } from './matchmaker'
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
  teamDisplayName,
  type PlayerNameLookup,
} from './playerNames'
import { createSchedulePrintImages } from './printSchedule'
import type {
  AgeGroup,
  Gender,
  Level,
  Match,
  MatchResult,
  MatchSettings,
  Player,
  ResultsByMatch,
  Schedule,
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

type StoredState = {
  players: Player[]
  settings: MatchSettings
  results: ResultsByMatch
  pairMixes: Record<string, number>
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

const legacySampleNames: Record<string, string> = {
  'guest-special': '스페셜 1',
  'p-minsu': '참가자 1',
  'p-jiyeon': '참가자 2',
  'p-taeho': '참가자 3',
  'p-soobin': '참가자 4',
  'p-hyunwoo': '참가자 5',
  'p-nayoung': '참가자 6',
  'p-junho': '참가자 7',
  'p-eunji': '참가자 8',
  'p-doyoon': '참가자 9',
  'p-yuna': '참가자 10',
  'p-chulsoo': '참가자 11',
  'p-harin': '참가자 12',
}

const legacySampleNameSet = new Set([
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

const readStoredState = (): StoredState => {
  if (typeof window === 'undefined') {
    return {
      players: defaultPlayers,
      settings: defaultSettings,
      results: {},
      pairMixes: {},
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) throw new Error('empty')
    const parsed = JSON.parse(raw) as Partial<StoredState>
    const settings = { ...defaultSettings, ...parsed.settings }
    if (settings.eventName === '스페셜 배드민턴 데이') {
      settings.eventName = defaultSettings.eventName
    }
    return {
      players: parsed.players?.length
        ? parsed.players.map((player) => normalizeStoredPlayer(player))
        : defaultPlayers,
      settings,
      results: parsed.results ?? {},
      pairMixes: parsed.pairMixes ?? {},
    }
  } catch {
    return {
      players: defaultPlayers,
      settings: defaultSettings,
      results: {},
      pairMixes: {},
    }
  }
}

const storedStateFromSharePayload = (payload: SharePayload): StoredState => ({
  players: payload.players.length
    ? payload.players.map((player) => normalizeStoredPlayer(player))
    : defaultPlayers,
  settings: { ...defaultSettings, ...payload.settings },
  results: payload.results ?? {},
  pairMixes: payload.pairMixes ?? {},
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

const hasScore = (result?: MatchResult) =>
  Boolean(result?.teamAScore || result?.teamBScore)

const winnerLabel = (
  match: Match,
  result: MatchResult | undefined,
  names: PlayerNameLookup,
) => {
  const a = Number(result?.teamAScore)
  const b = Number(result?.teamBScore)
  if (!result?.completed || !Number.isFinite(a) || !Number.isFinite(b) || a === b) {
    return '대기'
  }
  return a > b
    ? teamDisplayName(match.teamA, names)
    : teamDisplayName(match.teamB, names)
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
  const [players, setPlayers] = useState<Player[]>(initialState.players)
  const [settings, setSettings] = useState<MatchSettings>(initialState.settings)
  const [results, setResults] = useState<ResultsByMatch>(initialState.results)
  const [pairMixes, setPairMixes] = useState<Record<string, number>>(
    initialState.pairMixes,
  )
  const [isSharedMode, setIsSharedMode] = useState(initialContext.isShared)
  const [view, setView] = useState<'schedule' | 'stats'>('schedule')
  const [notice, setNotice] = useState(initialContext.isShared ? '공유본' : '저장됨')
  const [playersOpen, setPlayersOpen] = useState(true)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [printImageUrls, setPrintImageUrls] = useState<string[]>([])

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
    () => calculateStats(players, schedule, results),
    [players, schedule, results],
  )

  const activePlayers = players.filter((player) => player.active && player.name.trim())
  const regularPlayers = players.filter((player) => !player.isGuest)
  const guestPlayers = players.filter((player) => player.isGuest)
  const activeMembers = activePlayers.filter((player) => !player.isGuest)
  const activeGuests = activePlayers.filter((player) => player.isGuest)
  const requiredPlayers = activeMembers
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

  useEffect(() => {
    if (isSharedMode) return

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ players, settings, results, pairMixes }),
    )
    setNotice('저장됨')
  }, [isSharedMode, players, settings, results, pairMixes])

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
      setPlayers(sharedState.players)
      setSettings(sharedState.settings)
      setResults(sharedState.results)
      setPairMixes(sharedState.pairMixes)
      setView('schedule')
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

  const updatePlayer = (id: string, patch: Partial<Player>) => {
    setPlayers((current) =>
      current.map((player) => (player.id === id ? { ...player, ...patch } : player)),
    )
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
    setNotice('초기화됨')
  }

  const reshuffle = () => {
    setSettings((current) => ({ ...current, seed: current.seed + 1 }))
    setResults({})
    setPairMixes({})
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
    setBulkText('')
    setNotice(`${parsedPlayers.length}명 입력됨`)
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
        players,
        settings,
        results,
        pairMixes,
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

  const useSharedCopy = () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ players, settings, results, pairMixes }),
    )
    window.history.replaceState(null, '', getBaseUrl())
    setIsSharedMode(false)
    setNotice('편집 모드')
  }

  const openMySchedule = () => {
    window.location.href = getBaseUrl()
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-block">
          <div className="court-mark" aria-hidden="true">
            <span />
          </div>
          <div>
            {isSharedMode ? (
              <span className="eyebrow">A.M.A Match Maker</span>
            ) : (
              <label className="eyebrow" htmlFor="eventName">
                A.M.A Match Maker
              </label>
            )}
            {isSharedMode ? (
              <h1 className="event-title static-title">{settings.eventName}</h1>
            ) : (
              <input
                id="eventName"
                className="event-title"
                value={settings.eventName}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    eventName: event.target.value,
                  }))
                }
              />
            )}
          </div>
        </div>

        <div className="header-actions">
          {isSharedMode ? (
            <>
              <button type="button" className="primary-action" onClick={useSharedCopy}>
                내 대진 편집
              </button>
              <button type="button" onClick={openMySchedule}>
                새 대진
              </button>
              <button type="button" onClick={handleCopyShareLink}>
                공유 링크 복사
              </button>
              <button type="button" onClick={handlePrintSchedule}>
                대진표 저장
              </button>
              <span className="header-status">{notice}</span>
            </>
          ) : (
            <>
              <button
                type="button"
                className="primary-action"
                onClick={generateTwoHourSchedule}
              >
                대진 생성
              </button>
              <button type="button" onClick={reshuffle}>
                다시 섞기
              </button>
              <button type="button" onClick={handleCopyShareLink}>
                공유 링크 복사
              </button>
              <button type="button" onClick={handlePrintSchedule}>
                대진표 저장
              </button>
            </>
          )}
        </div>
      </header>

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
                label="참가자 수"
                min={0}
                max={80}
                value={regularPlayers.length}
                onChange={setRegularPlayerCount}
              />
              <NumberStepper
                label="스페셜 수"
                min={0}
                max={12}
                value={guestPlayers.length}
                onChange={setGuestCount}
              />
              <NumberStepper
                label="코트 수"
                min={1}
                max={12}
                value={settings.courtCount}
                onChange={(courtCount) =>
                  setSettings((current) => ({ ...current, courtCount }))
                }
              />
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
                  }}
                />
                스페셜 1 + 참가자 3
              </label>
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
                  {schedule.specialCompletedIds.length}/{requiredPlayers.length}
                </strong>
                <span>1회 이상</span>
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
                  일괄 입력
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
                    <textarea
                      value={bulkText}
                      onChange={(event) => setBulkText(event.target.value)}
                      placeholder={'참가자 1 A 남 30대\n참가자 2 B 여 40대\n고성현 스페셜'}
                    />
                    <div className="bulk-actions">
                      <button type="button" onClick={() => applyBulkPlayers('append')}>
                        명단 추가
                      </button>
                      <button type="button" onClick={() => applyBulkPlayers('replace')}>
                        기존 교체
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
        </aside>
        ) : null}

        <section className="workspace">
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
                                  <button type="button" onClick={() => mixMatch(match.id)}>
                                    믹스
                                  </button>
                                ) : null}
                                {match.isSpecial ? <strong>스페셜</strong> : null}
                              </div>
                            </header>
                            <div className={`score-row ${isSharedMode ? 'read-only-score' : ''}`}>
                              <div className="team-name">
                                {teamDisplayName(match.teamA, displayNames)}
                              </div>
                              {isSharedMode ? (
                                <span className="score-value">{result.teamAScore || '-'}</span>
                              ) : (
                                <input
                                  aria-label={`${teamDisplayName(match.teamA, displayNames)} 점수`}
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
                              <div className="team-name">
                                {teamDisplayName(match.teamB, displayNames)}
                              </div>
                              {isSharedMode ? (
                                <span className="score-value">{result.teamBScore || '-'}</span>
                              ) : (
                                <input
                                  aria-label={`${teamDisplayName(match.teamB, displayNames)} 점수`}
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
                              <span>{winnerLabel(match, result, displayNames)}</span>
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
                    추가 대진 생성
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
    </div>
  )
}

export default App
