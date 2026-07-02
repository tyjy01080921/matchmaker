import type { PrizeDrawResult } from './types'

export type PrizeCandidate = {
  id: string
  name: string
}

export const parsePrizeList = (text: string) =>
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

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
