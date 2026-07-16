import type { Player } from './types'

export const MAX_PREFERRED_PARTNERS = 3

export type PreferredPartnerResolution = {
  ids: string[]
  error: string | null
}

export const preferredPartnerNames = (
  player: Player,
  players: Player[],
) => {
  const playersById = new Map(players.map((candidate) => [candidate.id, candidate]))
  return (player.preferredPartnerIds ?? [])
    .map((id) => playersById.get(id)?.name.trim())
    .filter((name): name is string => Boolean(name))
    .join(', ')
}

export const resolvePreferredPartnerNames = (
  value: string,
  player: Player,
  players: Player[],
): PreferredPartnerResolution => {
  const names = [...new Set(
    value
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  )]

  if (names.length > MAX_PREFERRED_PARTNERS) {
    return {
      ids: [],
      error: `선호 파트너는 최대 ${MAX_PREFERRED_PARTNERS}명까지 입력할 수 있습니다.`,
    }
  }

  const ids: string[] = []
  for (const name of names) {
    const candidates = players.filter(
      (candidate) =>
        !candidate.isGuest &&
        candidate.id !== player.id &&
        candidate.name.trim() === name,
    )
    if (candidates.length === 0) {
      return { ids: [], error: `명단에서 선호 파트너 '${name}'을 찾을 수 없습니다.` }
    }
    if (candidates.length > 1) {
      return { ids: [], error: `동명이인 '${name}'은 구분해서 입력해야 합니다.` }
    }
    ids.push(candidates[0].id)
  }

  return { ids, error: null }
}
