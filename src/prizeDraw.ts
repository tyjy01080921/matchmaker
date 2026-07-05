import type { PrizeDrawResult } from './types'

export type PrizeCandidate = {
  id: string
  name: string
}

export type MissionDrawItem = {
  id: string
  number: string
  mission: string
  reward: string
}

export const parsePrizeList = (text: string) =>
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

export const getNextPrizeDrawLabels = (
  prizes: string[],
  completedDrawCount: number,
  drawCount: number,
) => {
  const completedCount = Number.isFinite(completedDrawCount)
    ? Math.max(0, Math.floor(completedDrawCount))
    : 0
  const requestedCount = Number.isFinite(drawCount)
    ? Math.max(1, Math.floor(drawCount))
    : 1
  if (prizes.length === 0) {
    return Array.from(
      { length: requestedCount },
      (_, index) => `${completedCount + index + 1}번째`,
    )
  }

  return prizes.slice(completedCount, completedCount + requestedCount)
}

export const getNextPrizeDrawLabel = (
  prizes: string[],
  completedDrawCount: number,
) => {
  return getNextPrizeDrawLabels(prizes, completedDrawCount, 1)[0] ?? null
}

export const parseMissionList = (text: string): MissionDrawItem[] =>
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line
        .split(/\s*[/,\t]\s*/)
        .map((part) => part.trim())
        .filter(Boolean)

      if (parts.length >= 3) {
        return {
          id: `${parts[0]}-${parts[1]}-${parts.slice(2).join('-')}`,
          number: parts[0],
          mission: parts.slice(1, -1).join(' / '),
          reward: parts[parts.length - 1],
        }
      }

      return {
        id: `${index + 1}-${line}`,
        number: `${index + 1}`,
        mission: line,
        reward: '상품',
      }
    })

export const drawPrizeWinners = (
  prizes: string[],
  candidates: PrizeCandidate[],
  allowDuplicateWinners: boolean,
  random: () => number = Math.random,
): PrizeDrawResult[] => {
  if (prizes.length === 0 || candidates.length === 0) return []

  const available = [...candidates]
  const results: PrizeDrawResult[] = []

  for (const prize of prizes) {
    const pool = allowDuplicateWinners ? candidates : available
    if (pool.length === 0) break

    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
    const winner = pool[index]
    results.push({
      prize,
      winnerId: winner.id,
      winnerName: winner.name,
    })

    if (!allowDuplicateWinners) {
      available.splice(available.findIndex((candidate) => candidate.id === winner.id), 1)
    }
  }

  return results
}
