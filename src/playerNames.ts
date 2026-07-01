import type { Player, Team } from './types'

export type PlayerNameLookup = Record<string, string>

const basePlayerName = (player: Player) => player.name.trim() || '참가자'

export const makePlayerNameLookup = (players: Player[]): PlayerNameLookup => {
  const nameCounts = new Map<string, number>()
  const seenCounts = new Map<string, number>()

  for (const player of players) {
    const name = basePlayerName(player)
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }

  return Object.fromEntries(
    players.map((player) => {
      const name = basePlayerName(player)
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
) => names[player.id] ?? basePlayerName(player)

export const teamDisplayName = (team: Team, names: PlayerNameLookup) =>
  team.map((player) => playerDisplayName(player, names)).join(' + ')
