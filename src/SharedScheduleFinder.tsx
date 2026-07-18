import {
  useEffect,
  useId,
  useState,
  type FormEvent,
} from 'react'
import {
  findSharedScheduleCandidates,
  type SharedScheduleCandidate,
} from './sharedSchedule'

type SharedScheduleFinderProps = {
  candidates: SharedScheduleCandidate[]
}

export const SharedScheduleFinder = ({
  candidates,
}: SharedScheduleFinderProps) => {
  const inputId = useId()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState(false)
  const [matches, setMatches] = useState<SharedScheduleCandidate[]>([])
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    if (!selectedId || candidates.some((candidate) => candidate.id === selectedId)) return
    setSelectedId('')
  }, [candidates, selectedId])

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextMatches = findSharedScheduleCandidates(candidates, query)
    setSearched(true)
    setMatches(nextMatches)
    setSelectedId(nextMatches.length === 1 ? nextMatches[0].id : '')
  }

  const selected = candidates.find((candidate) => candidate.id === selectedId)
  const uniqueNames = [...new Set(candidates.map((candidate) => candidate.name))]

  return (
    <section className="shared-schedule-finder" aria-labelledby={`${inputId}-title`}>
      <div className="shared-schedule-heading">
        <div>
          <span>공유 대진표</span>
          <h2 id={`${inputId}-title`}>내 경기 찾기</h2>
        </div>
        <p>이름으로 찾고 화면을 캡처하세요.</p>
      </div>
      <form className="shared-schedule-search" role="search" onSubmit={search}>
        <label htmlFor={inputId}>참가자 이름</label>
        <input
          id={inputId}
          list={listId}
          value={query}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="이름 입력"
          onChange={(event) => setQuery(event.target.value)}
        />
        <datalist id={listId}>
          {uniqueNames.map((name) => <option value={name} key={name} />)}
        </datalist>
        <button type="submit" className="primary-action">찾기</button>
      </form>

      {searched && matches.length === 0 ? (
        <p className="shared-schedule-feedback" role="status">
          일치하는 참가자가 없습니다. 이름을 확인해 주세요.
        </p>
      ) : null}

      {matches.length > 1 && !selected ? (
        <div className="shared-schedule-candidates" role="group" aria-label="참가자 선택">
          <span>참가자를 선택하세요.</span>
          <div>
            {matches.map((candidate) => (
              <button
                type="button"
                key={candidate.id}
                onClick={() => setSelectedId(candidate.id)}
              >
                <strong>{candidate.name}</strong>
                {candidate.subtitle ? <small>{candidate.subtitle}</small> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {selected ? (
        <section className="personal-schedule" aria-label={`${selected.name} 경기 일정`}>
          <header>
            <div>
              <span>나의 경기</span>
              <h3>{selected.name}</h3>
              {selected.subtitle ? <small>{selected.subtitle}</small> : null}
            </div>
            <strong>{selected.items.length}경기</strong>
          </header>
          {selected.items.length > 0 ? (
            <div className="personal-schedule-list">
              {selected.items.map((item, index) => (
                <article key={item.id}>
                  <div className="personal-schedule-order">
                    <span>{index + 1}</span>
                  </div>
                  <div className="personal-schedule-location">
                    <time>{item.time}</time>
                    <strong>{item.court}코트</strong>
                    <span>{item.label}</span>
                    {item.detail ? <small>{item.detail}</small> : null}
                  </div>
                  <div className="personal-schedule-teams">
                    <span><b>함께</b>{item.team}</span>
                    <span><b>상대</b>{item.opponent}</span>
                  </div>
                  <em className={item.status === '완료' ? 'completed' : ''}>
                    {item.status}
                  </em>
                </article>
              ))}
            </div>
          ) : (
            <p className="shared-schedule-feedback">현재 배정된 경기가 없습니다.</p>
          )}
          <footer>현재 공유된 대진 기준 · 이 영역만 캡처해 활용하세요.</footer>
        </section>
      ) : null}
    </section>
  )
}
