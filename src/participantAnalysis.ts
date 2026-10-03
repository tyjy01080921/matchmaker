import type { AgeGroup, Gender, Level, Player } from './types'

const emptyCounts = <Key extends string>(keys: readonly Key[]) =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<Key, number>

const genders: Gender[] = ['male', 'female', 'none']
const ages: AgeGroup[] = [
  '무관',
  '20대',
  '30대',
  '40대',
  '45대',
  '50대',
  '55대이상',
]
const levels: Level[] = ['OA', 'A', 'B', 'C', 'D', 'E', 'O', '스페셜']

export type ParticipantAnalysis = {
  activeCount: number
  regularCount: number
  guestCount: number
  genderCounts: Record<Gender, number>
  ageCounts: Record<AgeGroup, number>
  levelCounts: Record<Level, number>
  incompleteRegulars: Player[]
  hasStructuredInput: boolean
}

const hasParticipantDetail = (player: Player) =>
  player.isGuest ||
  player.level !== 'O' ||
  player.ageGroup !== '무관' ||
  player.gender !== 'none' ||
  typeof player.arrivalOffsetMinutes === 'number' ||
  typeof player.departureOffsetMinutes === 'number' ||
  Boolean(player.attendancePriority) ||
  Boolean(player.gameCountFlexible) ||
  Boolean(player.waitTimeFlexible) ||
  (player.preferredPartnerIds?.length ?? 0) > 0

export const analyzeParticipants = (players: Player[]): ParticipantAnalysis => {
  const activePlayers = players.filter((player) => player.active)
  const regulars = activePlayers.filter((player) => !player.isGuest)
  const guests = activePlayers.filter((player) => player.isGuest)
  const genderCounts = emptyCounts(genders)
  const ageCounts = emptyCounts(ages)
  const levelCounts = emptyCounts(levels)

  for (const player of activePlayers) {
    levelCounts[player.level] += 1
  }
  for (const player of regulars) {
    genderCounts[player.gender] += 1
    ageCounts[player.ageGroup] += 1
  }

  return {
    activeCount: activePlayers.length,
    regularCount: regulars.length,
    guestCount: guests.length,
    genderCounts,
    ageCounts,
    levelCounts,
    incompleteRegulars: regulars.filter(
      (player) =>
        player.level === 'O' ||
        player.ageGroup === '무관' ||
        player.gender === 'none',
    ),
    hasStructuredInput: activePlayers.some(hasParticipantDetail),
  }
}
