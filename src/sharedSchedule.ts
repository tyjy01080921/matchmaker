export type SharedScheduleItem = {
  id: string
  time: string
  court: number
  label: string
  team: string
  opponent: string
  status: '완료' | '예정'
  detail?: string
}

export type SharedScheduleCandidate = {
  id: string
  name: string
  subtitle?: string
  searchTerms?: string[]
  items: SharedScheduleItem[]
}

const normalizeSearchText = (value: string) =>
  value.trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, '')

export const findSharedScheduleCandidates = (
  candidates: SharedScheduleCandidate[],
  query: string,
) => {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return []

  const searchableTerms = (candidate: SharedScheduleCandidate) =>
    [candidate.name, ...(candidate.searchTerms ?? [])]
      .map(normalizeSearchText)
      .filter(Boolean)
  const exact = candidates.filter((candidate) =>
    searchableTerms(candidate).some((term) => term === normalizedQuery),
  )
  if (exact.length > 0) return exact

  return candidates.filter((candidate) =>
    searchableTerms(candidate).some((term) => term.includes(normalizedQuery)),
  )
}
