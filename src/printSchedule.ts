import { playerDisplayName, type PlayerNameLookup } from './playerNames'
import {
  calculateTournamentMvpCandidates,
  tournamentParticipantsFromTeams,
} from './matchmaker'
import type {
  Match,
  MatchNameOverrides,
  MatchSettings,
  ResultsByMatch,
  Round,
  Schedule,
  Team,
  TournamentFormat,
  TournamentLineupsByMatch,
  TournamentMatch,
  TournamentResultsByMatch,
  TournamentSchedule,
  TournamentSettings,
  TournamentTeam,
} from './types'
import {
  DEFAULT_START_TIME,
  GAME_SLOT_MINUTES,
  clockTimeAtOffset,
  getBookingDurationMinutes,
  getBookingRoundCount,
  roundTimeRange,
} from './scheduleTime'

export const A4_IMAGE_WIDTH = 1240
export const A4_IMAGE_HEIGHT = 1754

type RoundItem = {
  kind: 'round'
  text: string
}

type MatchItem = {
  kind: 'match'
  match: Match
}

export type PrintableScheduleItem = RoundItem | MatchItem

type TournamentSectionItem = {
  kind: 'section'
  title: string
  detail: string
}

type TournamentMatchItem = {
  kind: 'tournament-match'
  court: string
  label: string
  order: string
  result: string
  sideA: string
  sideB: string
}

type TournamentStandingItem = {
  kind: 'tournament-standing'
  detail: string
  points: string
  rank: string
  record: string
  team: string
}

type TournamentBracketItem = {
  kind: 'tournament-bracket'
  label: string
  matchup: string
  result: string
}

export type PrintableTournamentItem =
  | TournamentSectionItem
  | TournamentMatchItem
  | TournamentStandingItem
  | TournamentBracketItem

type PrintScheduleOptions = {
  generatedAt: Date
  names: PlayerNameLookup
  results: ResultsByMatch
  schedule: Schedule
  summary: {
    averageGames: number
    estimatedMinutes: number
    maximumGames: number
    maximumParticipants: string
    minimumGames: number
    minimumParticipants: string
    participantCount: number
    specialCount: number
    specialStatus: string
  }
  settings: MatchSettings
  matchNameOverrides?: MatchNameOverrides
}

type PrintTournamentOptions = {
  generatedAt: Date
  results: TournamentResultsByMatch
  schedule: TournamentSchedule
  settings: TournamentSettings
  teams: TournamentTeam[]
  lineups?: TournamentLineupsByMatch
  title?: string
}

type TournamentPrintParticipant = ReturnType<typeof tournamentParticipantsFromTeams>[number]

const layout = {
  contentBottom: A4_IMAGE_HEIGHT - 62,
  contentTop: 330,
  matchHeight: 74,
  roundHeight: 36,
}

const tournamentLayout = {
  bracketHeight: 50,
  contentBottom: A4_IMAGE_HEIGHT - 42,
  contentTop: 84,
  matchHeight: 76,
  sectionHeight: 30,
  standingHeight: 42,
}

const tournamentFormatPrintLabels: Record<TournamentFormat, string> = {
  'group-knockout': '조별+넉아웃',
  knockout: '넉아웃',
  'team-battle': '단체전',
  'friendly-team-battle': '친목전',
}

const tournamentPhasePrintLabels: Record<TournamentMatch['phase'], string> = {
  group: '조별',
  knockout: '넉아웃',
  'third-place': '3·4위',
  'team-battle': '단체전',
}

const columns = [
  { label: '경기', width: 140 },
  { label: '코트', width: 120 },
  { label: 'A팀', width: 440 },
  { label: 'B팀', width: 440 },
]

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const itemHeight = (item: PrintableScheduleItem) =>
  item.kind === 'round' ? layout.roundHeight : layout.matchHeight

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours > 0 && remainingMinutes > 0) return `${hours}시간 ${remainingMinutes}분`
  if (hours > 0) return `${hours}시간`
  return `${minutes}분`
}

const formatGeneratedAt = (date: Date) =>
  new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)

const truncateText = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 1))}…` : value

const text = (
  value: string,
  x: number,
  y: number,
  options: {
    color?: string
    size?: number
    weight?: number
  } = {},
) =>
  `<text x="${x}" y="${y}" fill="${options.color ?? '#18211f'}" font-family="Inter, Arial, sans-serif" font-size="${options.size ?? 13}" font-weight="${options.weight ?? 800}">${escapeXml(value)}</text>`

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    fill?: string
    stroke?: string
    strokeWidth?: number
  } = {},
) =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${options.fill ?? '#fff'}" stroke="${options.stroke ?? 'none'}" stroke-width="${options.strokeWidth ?? 0}" />`

const makeRoundText = (
  round: Round,
  names: PlayerNameLookup,
  startTime: string,
) => {
  const resting =
    round.resting.length > 0
      ? round.resting.map((player) => playerDisplayName(player, names)).join(', ')
      : '없음'

  return `${round.number}경기 · ${roundTimeRange(startTime, round.number)} · 휴식 ${resting}`
}

const svgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

const tournamentItemHeight = (item: PrintableTournamentItem) => {
  if (item.kind === 'section') return tournamentLayout.sectionHeight
  if (item.kind === 'tournament-match') return tournamentLayout.matchHeight
  if (item.kind === 'tournament-standing') return tournamentLayout.standingHeight
  return tournamentLayout.bracketHeight
}

const completedTournamentScores = (
  result: TournamentResultsByMatch[string] | undefined,
) => {
  const teamAScore = Number(result?.teamAScore)
  const teamBScore = Number(result?.teamBScore)
  if (
    !result?.completed ||
    !Number.isFinite(teamAScore) ||
    !Number.isFinite(teamBScore) ||
    teamAScore === teamBScore
  ) {
    return null
  }

  return { teamAScore, teamBScore }
}

const tournamentWinnerTeamId = (
  match: TournamentMatch,
  result: TournamentResultsByMatch[string] | undefined,
) => {
  if (match.isBye) return match.teamAId ?? match.teamBId
  if (!match.teamAId || !match.teamBId) return undefined

  const scores = completedTournamentScores(result)
  if (!scores) return undefined

  return scores.teamAScore > scores.teamBScore ? match.teamAId : match.teamBId
}

const tournamentTeamPrintName = (
  teamId: string | undefined,
  teamsById: Map<string, TournamentTeam>,
  fallback = '대기',
) => {
  if (!teamId) return fallback

  const team = teamsById.get(teamId)
  if (!team) return fallback

  return team.seed ? `${team.name} (${team.seed}번 시드)` : team.name
}

const signedNumber = (value: number) => (value > 0 ? `+${value}` : String(value))

const tournamentMatchResultText = (
  match: TournamentMatch,
  result: TournamentResultsByMatch[string] | undefined,
  teamsById: Map<string, TournamentTeam>,
) => {
  const winnerId = tournamentWinnerTeamId(match, result)
  if (match.isBye) {
    return winnerId
      ? `부전승 ${tournamentTeamPrintName(winnerId, teamsById)}`
      : '부전승'
  }

  const scores = completedTournamentScores(result)
  if (!scores || !winnerId) return '대기'

  return `${scores.teamAScore}-${scores.teamBScore} · ${tournamentTeamPrintName(
    winnerId,
    teamsById,
  )} 승`
}

const tournamentMatchupText = (
  match: TournamentMatch,
  teamsById: Map<string, TournamentTeam>,
) =>
  `${tournamentTeamPrintName(
    match.teamAId,
    teamsById,
    match.sourceA ?? '대기',
  )} vs ${tournamentTeamPrintName(match.teamBId, teamsById, match.sourceB ?? '대기')}`

const tournamentLineupPrintText = (
  match: TournamentMatch,
  side: 'A' | 'B',
  options: PrintTournamentOptions,
  participantsById: Map<string, TournamentPrintParticipant>,
) => {
  const lineup = options.lineups?.[match.id]
  const teamId = side === 'A' ? match.teamAId : match.teamBId
  const playerIds = side === 'A' ? lineup?.teamAPlayerIds : lineup?.teamBPlayerIds
  if (!teamId || !playerIds?.some(Boolean)) return ''

  return playerIds
    .map((playerId) => {
      const participant = participantsById.get(playerId)
      if (!participant) return ''
      return participant.teamId === teamId
        ? participant.name
        : `${participant.name}(지원)`
    })
    .filter(Boolean)
    .join(' + ')
}

const tournamentSidePrintText = (
  match: TournamentMatch,
  side: 'A' | 'B',
  options: PrintTournamentOptions,
  teamsById: Map<string, TournamentTeam>,
  participantsById: Map<string, TournamentPrintParticipant>,
) => {
  const teamId = side === 'A' ? match.teamAId : match.teamBId
  const source = side === 'A' ? match.sourceA : match.sourceB
  const teamName = tournamentTeamPrintName(teamId, teamsById, source ?? '대기')
  const lineup = tournamentLineupPrintText(match, side, options, participantsById)

  return lineup ? `${teamName} · ${lineup}` : teamName
}

const drawTableHeader = (y: number) => {
  let x = 50
  const labels = columns.map((column) => {
    const node = text(column.label, x + 9, y + 21, {
      color: '#65716e',
      size: 14,
      weight: 900,
    })
    x += column.width
    return node
  })

  return [
    rect(50, y, A4_IMAGE_WIDTH - 100, 34, {
      fill: '#f6f8f7',
      stroke: '#dce3df',
      strokeWidth: 1,
    }),
    ...labels,
  ].join('')
}

const drawScheduleSummary = (options: PrintScheduleOptions) => {
  const { summary } = options
  const cells = [
    { label: '참가자', value: `${summary.participantCount}명 · 스페셜 ${summary.specialCount}명` },
    { label: '라운드', value: `${options.schedule.rounds.length}R` },
    {
      label: '총 경기',
      value: `${options.schedule.rounds.reduce((sum, round) => sum + round.matches.length, 0)}경기`,
    },
    {
      label: '예약·예상 종료',
      value: `${options.settings.startTime}–${options.settings.endTime} · ${clockTimeAtOffset(
        options.settings.startTime,
        summary.estimatedMinutes,
      )}`,
    },
    { label: '평균 경기', value: `${summary.averageGames.toFixed(1)}경기` },
  ]
  const top = 118
  const gap = 8
  const cellWidth = (A4_IMAGE_WIDTH - 100 - gap * 4) / 5
  const nodes = cells.flatMap((cell, index) => {
    const x = 50 + index * (cellWidth + gap)
    return [
      rect(x, top, cellWidth, 54, {
        fill: '#f6f8f7',
        stroke: '#dce3df',
        strokeWidth: 1,
      }),
      text(cell.label, x + 12, top + 19, {
        color: '#65716e',
        size: 11,
        weight: 900,
      }),
      text(truncateText(cell.value, 24), x + 12, top + 41, {
        size: 15,
        weight: 900,
      }),
    ]
  })
  const detailTop = top + 62
  const detailWidth = (A4_IMAGE_WIDTH - 100 - gap) / 2
  const details = [
    {
      label: '최다 경기 배정자',
      value: summary.maximumParticipants
        ? `${summary.maximumParticipants} · ${summary.maximumGames}경기`
        : '없음',
    },
    {
      label: '최소 경기 배정자',
      value: summary.minimumParticipants
        ? `${summary.minimumParticipants} · ${summary.minimumGames}경기`
        : '없음',
    },
  ]

  for (const [index, detail] of details.entries()) {
    const x = 50 + index * (detailWidth + gap)
    nodes.push(
      rect(x, detailTop, detailWidth, 62, {
        fill: '#edf8f5',
        stroke: '#dce3df',
        strokeWidth: 1,
      }),
      text(detail.label, x + 12, detailTop + 20, {
        color: '#18685c',
        size: 11,
        weight: 900,
      }),
      text(truncateText(detail.value, 54), x + 12, detailTop + 45, {
        size: 16,
        weight: 900,
      }),
    )
  }

  return nodes.join('')
}

const drawRoundItem = (item: RoundItem, y: number) =>
  [
    rect(50, y, A4_IMAGE_WIDTH - 100, layout.roundHeight, { fill: '#e7f2ef' }),
    text(truncateText(item.text, 96), 66, y + 24, {
      color: '#18685c',
      size: 16,
      weight: 900,
    }),
  ].join('')

const drawMatchItem = (
  item: MatchItem,
  y: number,
  options: PrintScheduleOptions,
) => {
  const { match } = item
  const matchNames = options.matchNameOverrides?.[match.id] ?? {}
  const matchTeamDisplayName = (team: Team) =>
    team
      .map(
        (player) =>
          matchNames[player.id]?.trim() || playerDisplayName(player, options.names),
      )
      .join(' + ')
  const values = [
    `${match.round}경기`,
    `${match.court}코트`,
    matchTeamDisplayName(match.teamA),
    matchTeamDisplayName(match.teamB),
  ]

  let x = 50
  const cells = values.map((value, index) => {
    const column = columns[index]
    const isIndexCell = index < 2
    const node = text(
      truncateText(value, Math.max(4, Math.floor(column.width / (isIndexCell ? 16 : 18)))),
      x + (isIndexCell ? 16 : 18),
      y + 47,
      {
        color: match.isSpecial ? '#a75e19' : '#18211f',
        size: isIndexCell ? 24 : 26,
        weight: 900,
      },
    )
    x += column.width
    return node
  })

  return [
    rect(50, y, A4_IMAGE_WIDTH - 100, layout.matchHeight, {
      fill: match.isSpecial ? '#fff8ef' : '#ffffff',
      stroke: '#dce3df',
      strokeWidth: 1,
    }),
    match.isSpecial
      ? text('스페셜', 62, y + 18, { color: '#a75e19', size: 11, weight: 900 })
      : '',
    ...cells,
  ].join('')
}

export const makePrintableScheduleItems = (
  schedule: Schedule,
  names: PlayerNameLookup,
  startTime = DEFAULT_START_TIME,
): PrintableScheduleItem[] =>
  schedule.rounds.flatMap((round) => [
    {
      kind: 'round' as const,
      text: makeRoundText(round, names, startTime),
    },
    ...round.matches.map((match) => ({
      kind: 'match' as const,
      match,
    })),
  ])

export const paginatePrintableScheduleItems = (
  items: PrintableScheduleItem[],
): PrintableScheduleItem[][] => {
  const pages: PrintableScheduleItem[][] = []
  let currentPage: PrintableScheduleItem[] = []
  let currentHeight = 0
  const maxContentHeight = layout.contentBottom - layout.contentTop

  for (const item of items) {
    const nextHeight = itemHeight(item)
    if (currentPage.length > 0 && currentHeight + nextHeight > maxContentHeight) {
      pages.push(currentPage)
      currentPage = []
      currentHeight = 0
    }

    currentPage.push(item)
    currentHeight += nextHeight
  }

  return pages.length > 0 || currentPage.length > 0 ? [...pages, currentPage] : [[]]
}

export const makePrintableTournamentItems = (
  options: PrintTournamentOptions,
): PrintableTournamentItem[] => {
  const teamsById = new Map(options.teams.map((team) => [team.id, team]))
  const participantsById = new Map(
    tournamentParticipantsFromTeams(options.teams).map((participant) => [
      participant.id,
      participant,
    ]),
  )
  const tournamentMvpCandidates =
    options.settings.format === 'friendly-team-battle'
      ? calculateTournamentMvpCandidates(
          options.schedule.matches,
          options.teams,
          options.results,
          options.lineups ?? {},
        )
      : {}
  const items: PrintableTournamentItem[] = []
  const orderedMatches = [...options.schedule.matches].sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label),
  )

  if (options.schedule.warnings.length > 0) {
    items.push({
      kind: 'section',
      title: '알림',
      detail: options.schedule.warnings.join(' · '),
    })
  }

  if (orderedMatches.length > 0) {
    items.push({
      kind: 'section',
      title: '진행 순서',
      detail: `${orderedMatches.length}경기 · ${options.settings.courtCount}코트 · ${options.settings.startTime}–${options.settings.endTime}`,
    })

    for (const match of orderedMatches) {
      items.push({
        kind: 'tournament-match',
        court: `${match.court}코트`,
        label: [
          match.phase === 'team-battle'
            ? tournamentFormatPrintLabels[options.settings.format]
            : tournamentPhasePrintLabels[match.phase],
          match.label,
          match.teamBattleSlot,
        ]
          .filter(Boolean)
          .join(' · '),
        order: roundTimeRange(options.settings.startTime, match.round),
        result: tournamentMatchResultText(
          match,
          options.results[match.id],
          teamsById,
        ),
        sideA: tournamentSidePrintText(
          match,
          'A',
          options,
          teamsById,
          participantsById,
        ),
        sideB: tournamentSidePrintText(
          match,
          'B',
          options,
          teamsById,
          participantsById,
        ),
      })
    }
  }

  if (
    options.settings.format === 'group-knockout' &&
    options.schedule.standings.length > 0
  ) {
    for (const group of options.schedule.groups) {
      items.push({
        kind: 'section',
        title: `${group.name} 순위`,
        detail: `상위 ${options.settings.advancePerGroup}팀 진출`,
      })

      options.schedule.standings
        .filter((standing) => standing.groupId === group.id)
        .forEach((standing) => {
          items.push({
            kind: 'tournament-standing',
            detail: `득실 ${signedNumber(standing.pointDiff)}`,
            points: `득점 ${standing.pointsFor}`,
            rank: `${standing.rank}위`,
            record: `${standing.wins}승 ${standing.losses}패`,
            team: tournamentTeamPrintName(standing.team.id, teamsById),
          })
        })
    }
  }

  if (options.schedule.knockoutMatches.length > 0) {
    items.push({
      kind: 'section',
      title: '브래킷',
      detail: '결과 입력 시 다음 경기 자동 배정',
    })

    for (const match of options.schedule.knockoutMatches) {
      items.push({
        kind: 'tournament-bracket',
        label: match.label,
        matchup: tournamentMatchupText(match, teamsById),
        result: tournamentMatchResultText(
          match,
          options.results[match.id],
          teamsById,
        ),
      })
    }
  }

  if (
    options.settings.format === 'team-battle' ||
    options.settings.format === 'friendly-team-battle'
  ) {
    if (options.schedule.teamBattleStandings.length > 0) {
      items.push({
        kind: 'section',
        title: `${tournamentFormatPrintLabels[options.settings.format]} 순위`,
        detail:
          options.settings.format === 'friendly-team-battle'
            ? '세부 승패 · 총 득실 · MVP 후보'
            : '세부 경기 승수 합산',
      })

      for (const standing of options.schedule.teamBattleStandings) {
        if (options.settings.format === 'friendly-team-battle') {
          items.push({
            kind: 'tournament-standing',
            detail: `득점 ${standing.pointsFor} · 실점 ${standing.pointsAgainst}`,
            points: `득실 ${signedNumber(standing.pointDiff)} · MVP ${
              tournamentMvpCandidates[standing.team.id] ?? '대기'
            }`,
            rank: `${standing.rank}위`,
            record: `세부 ${standing.matchWins}-${standing.matchLosses}`,
            team: tournamentTeamPrintName(standing.team.id, teamsById),
          })
        } else {
          items.push({
            kind: 'tournament-standing',
            detail: `세부 ${standing.matchWins}-${standing.matchLosses}`,
            points: `득실 ${signedNumber(standing.pointDiff)}`,
            rank: `${standing.rank}위`,
            record: `${standing.tiesWon}승 ${standing.tiesLost}패`,
            team: tournamentTeamPrintName(standing.team.id, teamsById),
          })
        }
      }
    }

    if (options.schedule.teamBattleTies.length > 0) {
      items.push({
        kind: 'section',
        title: '팀 대전',
        detail: `${options.settings.teamBattleMatchCount}경기제`,
      })

      for (const tie of options.schedule.teamBattleTies) {
        items.push({
          kind: 'tournament-bracket',
          label: tie.label,
          matchup: `${tie.teamAWins} - ${tie.teamBWins}`,
          result: tie.winnerTeamId
            ? `${tournamentTeamPrintName(tie.winnerTeamId, teamsById)} 승`
            : '대기',
        })
      }
    }
  }

  if (items.length === 0) {
    items.push({
      kind: 'section',
      title: '대진 없음',
      detail: '참가 팀과 경쟁 설정을 확인해 주세요.',
    })
  }

  return items
}

export const paginatePrintableTournamentItems = (
  items: PrintableTournamentItem[],
): PrintableTournamentItem[][] => {
  const pages: PrintableTournamentItem[][] = []
  let currentPage: PrintableTournamentItem[] = []
  let currentHeight = 0
  const maxContentHeight =
    tournamentLayout.contentBottom - tournamentLayout.contentTop

  for (const item of items) {
    const nextHeight = tournamentItemHeight(item)
    if (currentPage.length > 0 && currentHeight + nextHeight > maxContentHeight) {
      pages.push(currentPage)
      currentPage = []
      currentHeight = 0
    }

    currentPage.push(item)
    currentHeight += nextHeight
  }

  return pages.length > 0 || currentPage.length > 0 ? [...pages, currentPage] : [[]]
}

export const renderLegacySchedulePageSvg = (
  page: PrintableScheduleItem[],
  pageIndex: number,
  pageCount: number,
  options: PrintScheduleOptions,
) => {
  const body: string[] = [
    rect(0, 0, A4_IMAGE_WIDTH, A4_IMAGE_HEIGHT, { fill: '#ffffff' }),
    rect(50, 34, 6, 56, { fill: '#18685c' }),
    text(truncateText(options.settings.eventName, 48), 68, 58, {
      size: 22,
      weight: 900,
    }),
  ]
  const matchCount = options.schedule.rounds.reduce(
    (sum, round) => sum + round.matches.length,
    0,
  )

  body.push(
    text(
      `대진표 · ${options.schedule.rounds.length}경기 순서 · ${matchCount}매치 · ${options.settings.courtCount}코트`,
      68,
      82,
      { color: '#65716e', size: 11, weight: 800 },
    ),
    text(truncateText(options.summary.specialStatus, 80), 620, 101, {
      color: '#18685c',
      size: 11,
      weight: 900,
    }),
    text(
      `생성 ${formatGeneratedAt(options.generatedAt)} · ${pageIndex + 1}/${pageCount}쪽`,
      68,
      101,
      { color: '#65716e', size: 11, weight: 800 },
    ),
    drawScheduleSummary(options),
    drawTableHeader(286),
  )

  let y = layout.contentTop
  for (const item of page) {
    body.push(
      item.kind === 'round'
        ? drawRoundItem(item, y)
        : drawMatchItem(item, y, options),
    )
    y += itemHeight(item)
  }

  body.push(
    text('A4 저장용 이미지', A4_IMAGE_WIDTH - 176, A4_IMAGE_HEIGHT - 32, {
      color: '#65716e',
      size: 11,
      weight: 700,
    }),
  )

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${A4_IMAGE_WIDTH}" height="${A4_IMAGE_HEIGHT}" viewBox="0 0 ${A4_IMAGE_WIDTH} ${A4_IMAGE_HEIGHT}">${body.join('')}</svg>`
}

const renderCourtGridPageSvg = (
  courts: Array<{ court: number; matches: Match[] }>,
  rowStart: number,
  rowCount: number,
  pageIndex: number,
  pageCount: number,
  options: PrintScheduleOptions,
) => {
  const pageWidth = A4_IMAGE_WIDTH
  const pageHeight = A4_IMAGE_HEIGHT
  const left = 0
  const top = 104
  const indexWidth = 40
  const headerHeight = 36
  const rowHeight = Math.floor(
    (pageHeight - top - headerHeight) / Math.max(1, rowCount),
  )
  const courtWidth = (pageWidth - left * 2 - indexWidth) / courts.length
  const compact = courtWidth < 170
  const nameLimit = Math.max(7, Math.floor(courtWidth / (compact ? 11 : 13)))
  const allMatches = options.schedule.rounds.flatMap((round) => round.matches)
  const averageGames = options.summary.averageGames.toFixed(1)
  const nodes = [
    rect(0, 0, pageWidth, pageHeight, { fill: '#ffffff' }),
    rect(left, 0, 5, 54, { fill: '#18685c' }),
    text(truncateText(options.settings.eventName, 60), left + 13, 25, { size: 21, weight: 900 }),
    text(
      `코트별 대진표 · ${options.settings.startTime}–${options.settings.endTime} · ${pageIndex + 1}/${pageCount}쪽`,
      left + 13,
      47,
      { color: '#65716e', size: 12, weight: 800 },
    ),
    rect(left, 58, pageWidth, 40, { fill: '#f6f8f7', stroke: '#dce3df' }),
    text(`참가 ${options.summary.participantCount}명 · 스페셜 ${options.summary.specialCount}명`, left + 10, 84, { size: 14, weight: 900 }),
    text(`총 ${allMatches.length}경기`, left + 276, 84, { size: 14, weight: 900 }),
    text(`코트 ${courts.length}개`, left + 426, 84, { size: 14, weight: 900 }),
    text(`참가자 평균 ${averageGames}경기`, left + 566, 84, { size: 14, weight: 900 }),
    rect(left, top, indexWidth, headerHeight, { fill: '#e7f2ef', stroke: '#dce3df' }),
    text('경기', left + 7, top + 25, { color: '#18685c', size: 13, weight: 900 }),
  ]

  courts.forEach(({ court }, courtIndex) => {
    const x = left + indexWidth + courtIndex * courtWidth
    nodes.push(
      rect(x, top, courtWidth, headerHeight, { fill: '#e7f2ef', stroke: '#dce3df' }),
    text(`${court}코트`, x + 5, top + 24, { color: '#18685c', size: compact ? 12 : 14, weight: 900 }),
    )
  })

  for (let row = 0; row < rowCount; row += 1) {
    const matchIndex = rowStart + row
    const y = top + headerHeight + row * rowHeight
    nodes.push(
      rect(left, y, indexWidth, rowHeight, { fill: '#f6f8f7', stroke: '#dce3df' }),
      text(`${matchIndex + 1}번`, left + 6, y + Math.floor(rowHeight / 2) + 5, { size: 12, weight: 900 }),
    )
    courts.forEach(({ matches }, courtIndex) => {
      const match = matches[matchIndex]
      const x = left + indexWidth + courtIndex * courtWidth
      nodes.push(rect(x, y, courtWidth, rowHeight, {
        fill: match?.isSpecial ? '#fff8ef' : '#ffffff',
        stroke: '#dce3df',
      }))
      if (!match) return
      const overrides = options.matchNameOverrides?.[match.id] ?? {}
      const teamName = (team: Team) => team
        .map((player) => overrides[player.id]?.trim() || playerDisplayName(player, options.names))
        .join(' + ')
      const start = match.startOffsetMinutes ?? (match.round - 1) * GAME_SLOT_MINUTES
      const duration = match.durationMinutes ?? GAME_SLOT_MINUTES
      nodes.push(
        text(
          `${clockTimeAtOffset(options.settings.startTime, start)}–${clockTimeAtOffset(options.settings.startTime, start + duration)} · ${duration}분${match.isSpecial ? ' · 스페셜' : ''}`,
          x + 5,
          y + Math.min(17, Math.floor(rowHeight * 0.28)),
          { color: match.isSpecial ? '#a75e19' : '#65716e', size: compact ? 9 : 10, weight: 900 },
        ),
        text(truncateText(teamName(match.teamA), nameLimit), x + 5, y + Math.floor(rowHeight * 0.58), { size: compact ? 11 : 13, weight: 900 }),
        text(truncateText(teamName(match.teamB), nameLimit), x + 5, y + rowHeight - 9, { size: compact ? 11 : 13, weight: 900 }),
      )
    })
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="${pageHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}">${nodes.join('')}</svg>`
}

const drawTournamentSectionItem = (item: TournamentSectionItem, y: number) =>
  [
    rect(50, y, A4_IMAGE_WIDTH - 100, tournamentLayout.sectionHeight, {
      fill: '#f6f8f7',
      stroke: '#dce3df',
      strokeWidth: 1,
    }),
    text(truncateText(item.title, 24), 66, y + 21, {
      color: '#18685c',
      size: 15,
      weight: 900,
    }),
    text(truncateText(item.detail, 90), 258, y + 21, {
      color: '#65716e',
      size: 13,
      weight: 800,
    }),
  ].join('')

const drawTournamentMatchItem = (item: TournamentMatchItem, y: number) =>
  [
    rect(50, y, A4_IMAGE_WIDTH - 100, tournamentLayout.matchHeight, {
      fill: '#ffffff',
      stroke: '#dce3df',
      strokeWidth: 1,
    }),
    rect(50, y, 88, tournamentLayout.matchHeight, {
      fill: '#f6f8f7',
      stroke: '#dce3df',
      strokeWidth: 1,
    }),
    rect(902, y, 288, tournamentLayout.matchHeight, {
      fill: item.result === '대기' ? '#f6f8f7' : '#e7f2ef',
    }),
    text(truncateText(item.order, 13), 58, y + 28, {
      color: '#65716e',
      size: 10,
      weight: 900,
    }),
    text(truncateText(item.court, 7), 66, y + 57, {
      size: 20,
      weight: 900,
    }),
    text(truncateText(item.label, 46), 154, y + 24, {
      color: '#65716e',
      size: 13,
      weight: 900,
    }),
    text(truncateText(item.sideA, 18), 154, y + 58, {
      size: 24,
      weight: 900,
    }),
    text('vs', 468, y + 58, {
      color: '#98a39f',
      size: 14,
      weight: 900,
    }),
    text(truncateText(item.sideB, 18), 522, y + 58, {
      size: 24,
      weight: 900,
    }),
    text(truncateText(item.result, 25), 922, y + 48, {
      color: item.result === '대기' ? '#65716e' : '#18685c',
      size: 17,
      weight: 900,
    }),
  ].join('')

const drawTournamentStandingItem = (item: TournamentStandingItem, y: number) =>
  [
    rect(50, y, A4_IMAGE_WIDTH - 100, tournamentLayout.standingHeight, {
      fill: '#ffffff',
      stroke: '#dce3df',
      strokeWidth: 1,
    }),
    text(item.rank, 66, y + 28, { color: '#18685c', size: 17, weight: 900 }),
    text(truncateText(item.team, 36), 150, y + 28, {
      size: 17,
      weight: 900,
    }),
    text(item.record, 640, y + 28, { color: '#18211f', size: 16, weight: 900 }),
    text(item.detail, 790, y + 28, { color: '#65716e', size: 15, weight: 800 }),
    text(truncateText(item.points, 28), 940, y + 28, {
      color: '#65716e',
      size: 15,
      weight: 800,
    }),
  ].join('')

const drawTournamentBracketItem = (item: TournamentBracketItem, y: number) =>
  [
    rect(50, y, A4_IMAGE_WIDTH - 100, tournamentLayout.bracketHeight, {
      fill: '#ffffff',
      stroke: '#dce3df',
      strokeWidth: 1,
    }),
    rect(50, y, 150, tournamentLayout.bracketHeight, {
      fill: '#f6f8f7',
      stroke: '#dce3df',
      strokeWidth: 1,
    }),
    text(truncateText(item.label, 16), 66, y + 31, {
      color: '#18685c',
      size: 16,
      weight: 900,
    }),
    text(truncateText(item.matchup, 52), 224, y + 31, {
      size: 19,
      weight: 900,
    }),
    text(truncateText(item.result, 27), 902, y + 31, {
      color: item.result === '대기' ? '#65716e' : '#18685c',
      size: 16,
      weight: 900,
    }),
  ].join('')

const drawTournamentItem = (item: PrintableTournamentItem, y: number) => {
  if (item.kind === 'section') return drawTournamentSectionItem(item, y)
  if (item.kind === 'tournament-match') return drawTournamentMatchItem(item, y)
  if (item.kind === 'tournament-standing') return drawTournamentStandingItem(item, y)
  return drawTournamentBracketItem(item, y)
}

const renderTournamentPageSvg = (
  page: PrintableTournamentItem[],
  pageIndex: number,
  pageCount: number,
  options: PrintTournamentOptions,
) => {
  const activeTeams = options.teams.filter((team) => team.active && team.name.trim())
  const completedMatches = options.schedule.matches.filter((match) =>
    tournamentWinnerTeamId(match, options.results[match.id]),
  ).length
  const title = options.title?.trim() || 'A.M.A Match Maker Pro'
  const scheduledRounds = options.schedule.matches.reduce(
    (maximum, match) => match.isBye ? maximum : Math.max(maximum, match.round),
    0,
  )
  const bookingRounds = getBookingRoundCount(
    options.settings.startTime,
    options.settings.endTime,
  )
  const overtimeMinutes = Math.max(0, scheduledRounds - bookingRounds) * GAME_SLOT_MINUTES
  const estimatedEndTime = clockTimeAtOffset(
    options.settings.startTime,
    scheduledRounds * GAME_SLOT_MINUTES,
  )
  const body: string[] = [
    rect(0, 0, A4_IMAGE_WIDTH, A4_IMAGE_HEIGHT, { fill: '#ffffff' }),
    text(truncateText(`${title} · 경쟁 대진표`, 48), 50, 38, {
      size: 16,
      weight: 900,
    }),
    text(
      `${tournamentFormatPrintLabels[options.settings.format]} · ${activeTeams.length}팀 · ${options.settings.courtCount}코트 · 예약 ${options.settings.startTime}–${options.settings.endTime}(${formatDuration(getBookingDurationMinutes(options.settings.startTime, options.settings.endTime))}) · 예상 ${estimatedEndTime}${overtimeMinutes > 0 ? `(${formatDuration(overtimeMinutes)} 초과)` : ''} · 완료 ${completedMatches}/${options.schedule.matches.length} · ${pageIndex + 1}/${pageCount}쪽`,
      50,
      61,
      { color: '#65716e', size: 11, weight: 800 },
    ),
    rect(50, 72, A4_IMAGE_WIDTH - 100, 1, { fill: '#dce3df' }),
  ]

  let y = tournamentLayout.contentTop
  for (const item of page) {
    body.push(drawTournamentItem(item, y))
    y += tournamentItemHeight(item)
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${A4_IMAGE_WIDTH}" height="${A4_IMAGE_HEIGHT}" viewBox="0 0 ${A4_IMAGE_WIDTH} ${A4_IMAGE_HEIGHT}">${body.join('')}</svg>`
}

export const createSchedulePrintImages = (options: PrintScheduleOptions) => {
  const matches = options.schedule.rounds.flatMap((round) => round.matches)
  const allCourts = Array.from({ length: options.settings.courtCount }, (_, index) => ({
    court: index + 1,
    matches: matches
      .filter((match) => match.court === index + 1)
      .sort((left, right) =>
        (left.startOffsetMinutes ?? 0) - (right.startOffsetMinutes ?? 0)),
  })).filter(({ matches: courtMatches }) => courtMatches.length > 0)
  const maximumGames = Math.max(...allCourts.map((court) => court.matches.length))
  const rowsPerPage = 21
  const pageInputs = Array.from({ length: Math.ceil(maximumGames / rowsPerPage) }, (_, index) => ({
    courts: allCourts,
    rowStart: index * rowsPerPage,
    rowCount: Math.min(rowsPerPage, maximumGames - index * rowsPerPage),
  }))

  return pageInputs.map((page, index) => svgDataUrl(renderCourtGridPageSvg(
    page.courts,
    page.rowStart,
    page.rowCount,
    index,
    pageInputs.length,
    options,
  )))
}

export const createTournamentPrintImages = (options: PrintTournamentOptions) => {
  const items = makePrintableTournamentItems(options)
  const pages = paginatePrintableTournamentItems(items)

  return pages.map((page, index) =>
    svgDataUrl(renderTournamentPageSvg(page, index, pages.length, options)),
  )
}
