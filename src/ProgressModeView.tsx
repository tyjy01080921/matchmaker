import {
  useEffect,
  useState,
  type CSSProperties,
} from 'react'
// 설정 화면과 분리된 현장 진행 전용 화면입니다.
import type {
  Match,
  MatchResult,
  MatchWinnerSide,
  ResultsByMatch,
  TournamentMatch,
  TournamentResultsByMatch,
} from './types'
import type {
  MeetingCourtLane,
  TournamentCourtLane,
} from './progressMode'
import {
  getMeetingCourtMatchNumber,
  getProgressCourtPageSize,
  getProgressScoreWinnerSide,
  getProgressWinnerSide,
  getTournamentCourtMatchNumber,
  hasProgressScorePair,
} from './progressMode'
import {
  GAME_SLOT_MINUTES,
  clockTimeAtOffset,
  roundTimeRange,
} from './scheduleTime'

type ProgressHeaderProps = {
  eventName: string
  modeLabel: string
  completedCount: number
  totalCount: number
  isFullscreen: boolean
  fullscreenSupported: boolean
  completedPanelOpen?: boolean
  onToggleCompletedPanel?: () => void
  onToggleFullscreen: () => void
  onExit: () => void
}

const ProgressHeader = ({
  eventName,
  modeLabel,
  completedCount,
  totalCount,
  isFullscreen,
  fullscreenSupported,
  completedPanelOpen,
  onToggleCompletedPanel,
  onToggleFullscreen,
  onExit,
}: ProgressHeaderProps) => {
  const remainingCount = Math.max(0, totalCount - completedCount)
  const percent = totalCount > 0
    ? Math.round((completedCount / totalCount) * 100)
    : 0

  return (
    <header className="progress-mode-header">
      <div className="progress-mode-title">
        <span>{modeLabel} 진행 모드</span>
        <h1>{eventName.trim() || '대진 진행'}</h1>
      </div>
      <div className="progress-mode-status">
        <div>
          <span>완료</span>
          <strong>{completedCount}/{totalCount}</strong>
        </div>
        <div>
          <span>남은 경기</span>
          <strong>{remainingCount}</strong>
        </div>
        <div className="progress-mode-meter" aria-label={`진행률 ${percent}%`}>
          <span style={{ width: `${percent}%` }} />
          <strong>{percent}%</strong>
        </div>
      </div>
      <div className="progress-mode-header-actions">
        {onToggleCompletedPanel ? (
          <button
            type="button"
            aria-pressed={completedPanelOpen}
            onClick={onToggleCompletedPanel}
          >
            완료 경기 {completedCount}
          </button>
        ) : null}
        {fullscreenSupported ? (
          <button type="button" onClick={onToggleFullscreen}>
            {isFullscreen ? '전체 화면 종료' : '전체 화면'}
          </button>
        ) : null}
        <button type="button" className="primary-action" onClick={onExit}>
          진행 모드 나가기
        </button>
      </div>
      <p className="progress-orientation-hint">
        가로로 돌리면 코트별 대진을 더 크게 볼 수 있습니다.
      </p>
    </header>
  )
}

const getCourtPageSize = () => {
  if (typeof window === 'undefined') return 6
  return getProgressCourtPageSize(window.innerWidth, window.innerHeight)
}

const useCourtPage = <Lane extends { court: number }>(lanes: Lane[]) => {
  const [pageSize, setPageSize] = useState(getCourtPageSize)
  const [page, setPageState] = useState(0)
  const [selectedCourt, setSelectedCourt] = useState<number | undefined>(
    lanes[0]?.court,
  )

  useEffect(() => {
    const updatePageSize = () => setPageSize(getCourtPageSize())
    window.addEventListener('resize', updatePageSize)
    window.addEventListener('orientationchange', updatePageSize)
    return () => {
      window.removeEventListener('resize', updatePageSize)
      window.removeEventListener('orientationchange', updatePageSize)
    }
  }, [])

  useEffect(() => {
    if (selectedCourt && lanes.some((lane) => lane.court === selectedCourt)) return
    setSelectedCourt(lanes[0]?.court)
  }, [lanes, selectedCourt])

  const pageCount = Math.max(1, Math.ceil(lanes.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)

  useEffect(() => {
    if (page !== safePage) setPageState(safePage)
  }, [page, safePage])

  useEffect(() => {
    const selectedIndex = lanes.findIndex((lane) => lane.court === selectedCourt)
    if (selectedIndex >= 0) setPageState(Math.floor(selectedIndex / pageSize))
  }, [lanes, pageSize, selectedCourt])

  const setPage = (nextPage: number) => {
    const boundedPage = Math.min(pageCount - 1, Math.max(0, nextPage))
    setPageState(boundedPage)
    setSelectedCourt(lanes[boundedPage * pageSize]?.court)
  }

  const selectCourt = (court: number) => {
    const courtIndex = lanes.findIndex((lane) => lane.court === court)
    if (courtIndex < 0) return
    setSelectedCourt(court)
    setPageState(Math.floor(courtIndex / pageSize))
  }

  const visibleLanes = lanes.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  )
  const columns = pageSize === 6
    ? visibleLanes.length === 4
      ? 2
      : Math.max(1, Math.min(3, visibleLanes.length))
    : Math.max(1, Math.min(pageSize, visibleLanes.length))
  const rows = Math.max(1, Math.ceil(visibleLanes.length / columns))

  return {
    page: safePage,
    pageCount,
    pageSize,
    columns,
    setPage,
    selectedCourt,
    selectCourt,
    visibleLanes,
    boardStyle: {
      '--progress-court-columns': columns,
      '--progress-court-rows': rows,
    } as CSSProperties,
  }
}

type CourtPageNavigationProps = {
  page: number
  pageCount: number
  pageSize: number
  lanes: Array<{ court: number }>
  selectedCourt: number | undefined
  onPage: (page: number) => void
  onCourt: (court: number) => void
}

const CourtPageNavigation = ({
  page,
  pageCount,
  pageSize,
  lanes,
  selectedCourt,
  onPage,
  onCourt,
}: CourtPageNavigationProps) => {
  if (lanes.length <= 1) return null
  const visibleLanes = lanes.slice(page * pageSize, page * pageSize + pageSize)
  const firstCourt = visibleLanes[0]?.court
  const lastCourt = visibleLanes.at(-1)?.court

  return (
    <nav className="progress-court-pagination" aria-label="코트 바로가기">
      <div className="progress-court-page-controls">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          이전
        </button>
        <strong>
          {firstCourt === lastCourt
            ? `${firstCourt ?? '-'}코트`
            : `${firstCourt ?? '-'}–${lastCourt ?? '-'}코트`}
        </strong>
        <span>{page + 1}/{pageCount}</span>
        <button
          type="button"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
        >
          다음
        </button>
      </div>
      <div className="progress-court-jump-list">
        {lanes.map((lane) => (
          <button
            type="button"
            className={selectedCourt === lane.court ? 'active' : ''}
            aria-label={`${lane.court}코트 보기`}
            aria-pressed={selectedCourt === lane.court}
            key={lane.court}
            onClick={() => onCourt(lane.court)}
          >
            {lane.court}코트
          </button>
        ))}
      </div>
    </nav>
  )
}

type ProgressMatchHeadingProps = {
  court: number
  matchNumber: number
  status: string
  startsAt: string
  endsAt: string
  detail?: string
}

const ProgressMatchHeading = ({
  court,
  matchNumber,
  status,
  startsAt,
  endsAt,
  detail,
}: ProgressMatchHeadingProps) => (
  <header className="progress-card-heading">
    <div className="progress-card-identity">
      <strong>{court}코트 {matchNumber}경기</strong>
      <span>{status}</span>
      {detail ? <em>{detail}</em> : null}
    </div>
    <time>
      <strong>{startsAt}</strong>
      <span>–{endsAt}</span>
    </time>
  </header>
)

type ProgressResultEditorProps = {
  matchId: string
  teamAName: string
  teamBName: string
  result: MatchResult | undefined
  winnerRequired: boolean
  onScoreChange: (
    matchId: string,
    side: MatchWinnerSide,
    value: string,
  ) => void
  onWinner: (matchId: string, winnerSide: MatchWinnerSide) => void
  onComplete: (matchId: string) => void
}

const ProgressResultEditor = ({
  matchId,
  teamAName,
  teamBName,
  result,
  winnerRequired,
  onScoreChange,
  onWinner,
  onComplete,
}: ProgressResultEditorProps) => {
  const teamAScore = result?.teamAScore ?? ''
  const teamBScore = result?.teamBScore ?? ''
  const winnerSide = getProgressWinnerSide(result)
  const hasScorePair = hasProgressScorePair(result)
  const scoreWinnerSide = getProgressScoreWinnerSide(result)
  const tiedScore = hasScorePair && !scoreWinnerSide

  const renderTeam = (
    side: MatchWinnerSide,
    teamName: string,
    score: string,
  ) => (
    <div className="progress-result-team" key={side}>
      <span>{side}팀</span>
      <strong title={teamName}>{teamName}</strong>
      <input
        aria-label={`${teamName} 점수`}
        type="number"
        inputMode="numeric"
        min="0"
        max="999"
        placeholder="점수"
        value={score}
        onChange={(event) =>
          onScoreChange(
            matchId,
            side,
            event.target.value.replace(/[^0-9]/g, '').slice(0, 3),
          )}
      />
      <button
        type="button"
        className={winnerSide === side ? 'active' : ''}
        aria-label={`${teamName} 승리 선택`}
        aria-pressed={winnerSide === side}
        disabled={hasScorePair}
        title={hasScorePair ? '입력한 점수로 승리 팀이 결정됩니다.' : ''}
        onClick={() => onWinner(matchId, side)}
      >
        승
      </button>
    </div>
  )

  return (
    <div className="progress-result-editor">
      {renderTeam('A', teamAName, teamAScore)}
      {renderTeam('B', teamBName, teamBScore)}
      <div className="progress-result-actions">
        <span className={tiedScore ? 'score-warning' : ''}>
          {tiedScore
            ? '동점 점수 확인'
            : winnerSide
              ? `${winnerSide}팀 승리`
              : winnerRequired
                ? '승리 팀 선택 필요'
                : '결과 입력 선택'}
        </span>
        <button
          type="button"
          className="progress-complete-button"
          disabled={winnerRequired && !winnerSide}
          onClick={() => onComplete(matchId)}
        >
          경기 완료
        </button>
      </div>
    </div>
  )
}

type UpcomingTeamsProps = {
  teamAName: string
  teamBName: string
  compact?: boolean
}

const UpcomingTeams = ({
  teamAName,
  teamBName,
  compact = false,
}: UpcomingTeamsProps) => compact ? (
  <div className="progress-team-preview">
    <strong title={teamAName}>{teamAName}</strong>
    <span>vs</span>
    <strong title={teamBName}>{teamBName}</strong>
  </div>
) : (
  <div className="progress-upcoming-teams">
    <div className="progress-team-row">
      <span>A팀</span>
      <strong title={teamAName}>{teamAName}</strong>
    </div>
    <div className="progress-team-row">
      <span>B팀</span>
      <strong title={teamBName}>{teamBName}</strong>
    </div>
  </div>
)

const resultSummary = (
  result: MatchResult | undefined,
  teamAName: string,
  teamBName: string,
) => {
  const score = result?.teamAScore || result?.teamBScore
    ? `${result?.teamAScore || '-'} : ${result?.teamBScore || '-'}`
    : ''
  const winnerSide = getProgressWinnerSide(result)
  const winner = winnerSide === 'A'
    ? `${teamAName} 승리`
    : winnerSide === 'B'
      ? `${teamBName} 승리`
      : ''
  return [score, winner].filter(Boolean).join(' · ')
}

type MeetingProgressModeProps = Omit<ProgressHeaderProps, 'modeLabel'> & {
  startTime: string
  lanes: MeetingCourtLane[]
  results: ResultsByMatch
  teamName: (match: Match, side: 'A' | 'B') => string
  onScoreChange: (
    matchId: string,
    side: MatchWinnerSide,
    value: string,
  ) => void
  onWinner: (matchId: string, winnerSide: MatchWinnerSide) => void
  onComplete: (matchId: string) => void
  onUndo: (matchId: string) => void
}

export const MeetingProgressMode = ({
  startTime,
  lanes,
  results,
  teamName,
  onScoreChange,
  onWinner,
  onComplete,
  onUndo,
  ...headerProps
}: MeetingProgressModeProps) => {
  const [completedOpen, setCompletedOpen] = useState(false)
  const courtPage = useCourtPage(lanes)
  const completedMatches = lanes
    .flatMap((lane) => lane.completed)
    .sort((left, right) =>
      (right.startOffsetMinutes ?? 0) - (left.startOffsetMinutes ?? 0),
    )
  const allDone = headerProps.totalCount > 0 &&
    headerProps.completedCount >= headerProps.totalCount

  const matchTimes = (match: Match) => {
    const startsAt = match.startOffsetMinutes ??
      (match.round - 1) * GAME_SLOT_MINUTES
    const duration = match.durationMinutes ?? GAME_SLOT_MINUTES
    const start = clockTimeAtOffset(startTime, startsAt)
    const end = clockTimeAtOffset(startTime, startsAt + duration)
    return { start, end, label: `${start}–${end}` }
  }

  return (
    <main className="progress-mode-shell">
      <ProgressHeader
        {...headerProps}
        modeLabel="친목"
        completedPanelOpen={completedOpen}
        onToggleCompletedPanel={() => setCompletedOpen((open) => !open)}
      />
      {allDone ? (
        <section className="progress-mode-complete">
          <strong>모든 경기를 완료했습니다.</strong>
          <span>완료된 경기에서 필요하면 완료를 취소할 수 있습니다.</span>
        </section>
      ) : null}
      <CourtPageNavigation
        page={courtPage.page}
        pageCount={courtPage.pageCount}
        pageSize={courtPage.pageSize}
        lanes={lanes}
        selectedCourt={courtPage.selectedCourt}
        onPage={courtPage.setPage}
        onCourt={courtPage.selectCourt}
      />
      <div
        className="progress-court-board"
        data-court-columns={courtPage.columns}
        style={courtPage.boardStyle}
      >
        {courtPage.visibleLanes.map((lane) => (
          <section
            className={`progress-court-lane ${
              lane.court === courtPage.selectedCourt ? 'selected' : ''
            }`}
            key={lane.court}
          >
            <header>
              <h2>{lane.court}코트</h2>
              <span>남음 {lane.pending.length}경기</span>
            </header>
            <div className="progress-court-matches">
              {lane.pending.length > 0 ? lane.pending.map((match, index) => {
                const stageClass = index === 0
                  ? 'current'
                  : index === 1
                    ? 'upcoming-next'
                    : 'upcoming-later'
                const teamAName = teamName(match, 'A')
                const teamBName = teamName(match, 'B')
                const times = matchTimes(match)
                return (
                  <article
                    className={`progress-match-card ${stageClass}`}
                    key={match.id}
                  >
                    <ProgressMatchHeading
                      court={lane.court}
                      matchNumber={getMeetingCourtMatchNumber(lane, match.id)}
                      status={
                        index === 0
                          ? '현재'
                          : index === 1
                            ? '바로 다음'
                            : index === 2
                              ? '그다음'
                              : '대기'
                      }
                      startsAt={times.start}
                      endsAt={times.end}
                      detail={match.isSpecial ? '스페셜' : undefined}
                    />
                    {index === 0 ? (
                      <ProgressResultEditor
                        matchId={match.id}
                        teamAName={teamAName}
                        teamBName={teamBName}
                        result={results[match.id]}
                        winnerRequired={false}
                        onScoreChange={onScoreChange}
                        onWinner={onWinner}
                        onComplete={onComplete}
                      />
                    ) : (
                      <UpcomingTeams
                        teamAName={teamAName}
                        teamBName={teamBName}
                        compact={index >= 2}
                      />
                    )}
                  </article>
                )
              }) : (
                <div className="progress-court-empty">이 코트의 경기를 완료했습니다.</div>
              )}
            </div>
          </section>
        ))}
      </div>
      {completedOpen ? (
        <section className="progress-completed-panel open">
          <button
            type="button"
            className="progress-completed-toggle"
            onClick={() => setCompletedOpen(false)}
          >
            완료 경기 {completedMatches.length}개 · 닫기
          </button>
          <div className="progress-completed-list">
            {completedMatches.map((match) => {
              const teamAName = teamName(match, 'A')
              const teamBName = teamName(match, 'B')
              const summary = resultSummary(
                results[match.id],
                teamAName,
                teamBName,
              )
              return (
                <article key={match.id}>
                  <span>{match.court}코트 · {matchTimes(match).label}</span>
                  <strong>{teamAName} vs {teamBName}</strong>
                  {summary ? <em>{summary}</em> : null}
                  <button type="button" onClick={() => onUndo(match.id)}>
                    완료 취소
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      ) : null}
    </main>
  )
}

type TournamentProgressModeProps = Omit<ProgressHeaderProps, 'modeLabel'> & {
  startTime: string
  lanes: TournamentCourtLane[]
  results: TournamentResultsByMatch
  sideName: (match: TournamentMatch, side: 'A' | 'B') => string
  phaseLabel: (match: TournamentMatch) => string
  winnerName: (match: TournamentMatch) => string
  undoableMatchId?: string
  onScoreChange: (
    matchId: string,
    side: MatchWinnerSide,
    value: string,
  ) => void
  onWinner: (matchId: string, winnerSide: MatchWinnerSide) => void
  onComplete: (matchId: string) => void
  onUndo: (matchId: string) => void
}

export const TournamentProgressMode = ({
  startTime,
  lanes,
  results,
  sideName,
  phaseLabel,
  winnerName,
  undoableMatchId,
  onScoreChange,
  onWinner,
  onComplete,
  onUndo,
  ...headerProps
}: TournamentProgressModeProps) => {
  const [completedOpen, setCompletedOpen] = useState(false)
  const courtPage = useCourtPage(lanes)
  const completedMatches = lanes
    .flatMap((lane) => lane.completed)
    .sort((left, right) => right.order - left.order)
  const allDone = headerProps.totalCount > 0 &&
    headerProps.completedCount >= headerProps.totalCount

  return (
    <main className="progress-mode-shell tournament-progress-mode">
      <ProgressHeader
        {...headerProps}
        modeLabel="경쟁"
        completedPanelOpen={completedOpen}
        onToggleCompletedPanel={() => setCompletedOpen((open) => !open)}
      />
      {allDone ? (
        <section className="progress-mode-complete">
          <strong>모든 경기를 완료했습니다.</strong>
          <span>최종 순위와 대진 결과는 일반 화면에서 확인할 수 있습니다.</span>
        </section>
      ) : null}
      <CourtPageNavigation
        page={courtPage.page}
        pageCount={courtPage.pageCount}
        pageSize={courtPage.pageSize}
        lanes={lanes}
        selectedCourt={courtPage.selectedCourt}
        onPage={courtPage.setPage}
        onCourt={courtPage.selectCourt}
      />
      <div
        className="progress-court-board"
        data-court-columns={courtPage.columns}
        style={courtPage.boardStyle}
      >
        {courtPage.visibleLanes.map((lane) => {
          const currentMatch = lane.ready[0]
          const remaining = [
            ...lane.ready.map((match) => ({ match, waiting: false })),
            ...lane.waiting.map((match) => ({ match, waiting: true })),
          ].sort((left, right) => left.match.order - right.match.order)
          const visibleMatches = currentMatch
            ? [
                { match: currentMatch, waiting: false },
                ...remaining.filter(({ match }) => match.id !== currentMatch.id),
              ]
            : remaining

          return (
            <section
              className={`progress-court-lane ${
                lane.court === courtPage.selectedCourt ? 'selected' : ''
              }`}
              key={lane.court}
            >
              <header>
                <h2>{lane.court}코트</h2>
                <span>남음 {remaining.length}경기</span>
              </header>
              <div className="progress-court-matches">
                {visibleMatches.length > 0 ? visibleMatches.map(
                  ({ match, waiting }, index) => {
                    const isCurrent = match.id === currentMatch?.id && !waiting
                    const stageClass = isCurrent
                      ? 'current'
                      : index <= (currentMatch ? 1 : 0)
                        ? 'upcoming-next'
                        : 'upcoming-later'
                    const teamAName = sideName(match, 'A')
                    const teamBName = sideName(match, 'B')
                    const [startsAt = '', endsAt = ''] = roundTimeRange(
                      startTime,
                      match.round,
                    ).split('–')
                    return (
                      <article
                        className={`progress-match-card ${stageClass} ${
                          waiting ? 'waiting' : ''
                        }`}
                        key={match.id}
                      >
                        <ProgressMatchHeading
                          court={lane.court}
                          matchNumber={getTournamentCourtMatchNumber(
                            lane,
                            match.id,
                          )}
                          status={
                            waiting
                              ? '결과 대기'
                              : isCurrent
                                ? '현재'
                                : index === 1
                                  ? '바로 다음'
                                  : index === 2
                                    ? '그다음'
                                    : '대기'
                          }
                          startsAt={startsAt}
                          endsAt={endsAt}
                          detail={`${phaseLabel(match)} · ${match.label}`}
                        />
                        {isCurrent ? (
                          <ProgressResultEditor
                            matchId={match.id}
                            teamAName={teamAName}
                            teamBName={teamBName}
                            result={results[match.id]}
                            winnerRequired
                            onScoreChange={onScoreChange}
                            onWinner={onWinner}
                            onComplete={onComplete}
                          />
                        ) : (
                          <UpcomingTeams
                            teamAName={teamAName}
                            teamBName={teamBName}
                            compact={stageClass === 'upcoming-later'}
                          />
                        )}
                      </article>
                    )
                  },
                ) : (
                  <div className="progress-court-empty">이 코트의 경기를 완료했습니다.</div>
                )}
              </div>
            </section>
          )
        })}
      </div>
      {completedOpen ? (
        <section className="progress-completed-panel open">
          <button
            type="button"
            className="progress-completed-toggle"
            onClick={() => setCompletedOpen(false)}
          >
            완료 경기 {completedMatches.length}개 · 닫기
          </button>
          <div className="progress-completed-list">
            {completedMatches.map((match) => {
              const teamAName = sideName(match, 'A')
              const teamBName = sideName(match, 'B')
              const canUndo = match.id === undoableMatchId
              const summary = resultSummary(
                results[match.id],
                teamAName,
                teamBName,
              )
              return (
                <article key={match.id}>
                  <span>{match.court}코트 · {phaseLabel(match)} · {match.label}</span>
                  <strong>승리 {winnerName(match)}</strong>
                  {summary ? <em>{summary}</em> : null}
                  <button
                    type="button"
                    disabled={!canUndo}
                    title={canUndo ? '' : '뒤 경기부터 완료를 취소해 주세요.'}
                    onClick={() => onUndo(match.id)}
                  >
                    {canUndo ? '완료 취소' : '뒤 경기 먼저 취소'}
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      ) : null}
    </main>
  )
}
