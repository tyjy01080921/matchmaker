import type { Player, Team } from './types'

export type PlayerNameLookup = Record<string, string>

const fallbackPlayerNamePrefix = (player: Player) =>
  player.isGuest ? '스페셜' : ''

const playerNameBase = (player: Player, fallbackIndex?: number) => {
  const name = player.name.trim()
  if (name) return name
  const prefix = fallbackPlayerNamePrefix(player)
  return prefix ? `${prefix} ${fallbackIndex ?? 1}번` : `${fallbackIndex ?? 1}번`
}

export const makePlayerNameLookup = (players: Player[]): PlayerNameLookup => {
  const nameCounts = new Map<string, number>()
  const seenCounts = new Map<string, number>()
  const fallbackCounts = new Map<string, number>()
  const baseNames = new Map<string, string>()

  for (const player of players) {
    const fallbackKey = fallbackPlayerNamePrefix(player)
    const fallbackIndex = (fallbackCounts.get(fallbackKey) ?? 0) + 1
    if (!player.name.trim()) fallbackCounts.set(fallbackKey, fallbackIndex)
    const name = playerNameBase(player, fallbackIndex)
    baseNames.set(player.id, name)
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }

  return Object.fromEntries(
    players.map((player) => {
      const name = baseNames.get(player.id) ?? playerNameBase(player)
      const count = nameCounts.get(name) ?? 0
      if (count <= 1) return [player.id, name]

      const nextIndex = (seenCounts.get(name) ?? 0) + 1
      seenCounts.set(name, nextIndex)
      return [player.id, `${name} ${nextIndex}`]
    }),
  )
}

export const playerDisplayName = (
  player: Player,
  names: PlayerNameLookup,
) => names[player.id] ?? playerNameBase(player)

export const teamDisplayName = (team: Team, names: PlayerNameLookup) =>
  team.map((player) => playerDisplayName(player, names)).join(' + ')
