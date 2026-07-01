import { playerDisplayName, teamDisplayName, type PlayerNameLookup } from './playerNames'
import type { Match, MatchSettings, ResultsByMatch, Round, Schedule } from './types'

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

type PrintScheduleOptions = {
  generatedAt: Date
  names: PlayerNameLookup
  results: ResultsByMatch
  schedule: Schedule
  settings: MatchSettings
}

const layout = {
  contentBottom: A4_IMAGE_HEIGHT - 62,
  contentTop: 176,
  matchHeight: 74,
  roundHeight: 36,
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

const makeRoundText = (round: Round, names: PlayerNameLookup) => {
  const startsAt = (round.number - 1) * 15
  const endsAt = round.number * 15
  const resting =
    round.resting.length > 0
      ? round.resting.map((player) => playerDisplayName(player, names)).join(', ')
      : '없음'

  return `${round.number}경기 · 예상 ${formatDuration(startsAt)}-${formatDuration(endsAt)} · 휴식 ${resting}`
}

const svgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

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
  const values = [
    `${match.round}경기`,
    `${match.court}코트`,
    teamDisplayName(match.teamA, options.names),
    teamDisplayName(match.teamB, options.names),
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
): PrintableScheduleItem[] =>
  schedule.rounds.flatMap((round) => [
    {
      kind: 'round' as const,
      text: makeRoundText(round, names),
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

const renderPageSvg = (
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
    text(
      `생성 ${formatGeneratedAt(options.generatedAt)} · ${pageIndex + 1}/${pageCount}쪽`,
      68,
      101,
      { color: '#65716e', size: 11, weight: 800 },
    ),
    drawTableHeader(132),
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

export const createSchedulePrintImages = (options: PrintScheduleOptions) => {
  const items = makePrintableScheduleItems(options.schedule, options.names)
  const pages = paginatePrintableScheduleItems(items)

  return pages.map((page, index) =>
    svgDataUrl(renderPageSvg(page, index, pages.length, options)),
  )
}
