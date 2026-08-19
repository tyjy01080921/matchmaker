export type EventMatchPlayerOption = {
  id: string
  name: string
}

const normalizeSearchText = (value: string) =>
  value.trim().normalize('NFC').toLocaleLowerCase('ko-KR')

export const filterEventMatchPlayerOptions = (
  options: EventMatchPlayerOption[],
  query: string,
  limit = 8,
) => {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return []

  return options
    .filter((option) =>
      normalizeSearchText(option.name).includes(normalizedQuery),
    )
    .slice(0, limit)
}
