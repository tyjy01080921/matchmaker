import type { AgeGroup, Gender, Level, Player } from './types'

const regularLevelTokens = ['OA', 'S', 'A', 'B', 'C', 'D', 'E', 'O']
const specialLevelTokens = ['스페셜', 'SPECIAL']
const numberedListPrefix = /^\d+\s*[.)]\s*/

export const parseBulkAgeGroup = (value: string): AgeGroup | undefined => {
  const normalized = value.trim().replace(/\s+/g, '')
  if (
    normalized === '무관' ||
    normalized === '20대' ||
    normalized === '30대' ||
    normalized === '40대' ||
    normalized === '45대' ||
    normalized === '50대' ||
    normalized === '55대이상'
  ) {
    return normalized
  }

  if (normalized === '20') return '20대'
  if (normalized === '30') return '30대'
  if (normalized === '40') return '40대'
  if (normalized === '45') return '45대'
  if (normalized === '50') return '50대'
  if (
    normalized === '55' ||
    normalized === '55대' ||
    normalized === '55이상' ||
    normalized === '55+'
  ) {
    return '55대이상'
  }

  return undefined
}

export const parseBulkGender = (value: string): Gender | undefined => {
  const normalized = value.trim()
  if (normalized === '남' || normalized === '남자' || normalized === 'M' || normalized === 'm') {
    return 'male'
  }
  if (normalized === '여' || normalized === '여자' || normalized === 'F' || normalized === 'f') {
    return 'female'
  }
  if (normalized === 'male' || normalized === 'MALE') return 'male'
  if (normalized === 'female' || normalized === 'FEMALE') return 'female'
  if (normalized === '무관') return 'none'
  return undefined
}

export const parseBulkLevel = (value: string): Level | undefined => {
  const normalized = value.trim()
  const upper = normalized.toUpperCase()
  if (regularLevelTokens.includes(upper)) return upper === 'S' ? 'OA' : (upper as Level)
  if (specialLevelTokens.includes(upper) || normalized === '스페셜') return '스페셜'

  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return undefined
  if (numeric === 4) return 'A'
  if (numeric === 3) return 'B'
  if (numeric === 2) return 'C'
  if (numeric === 1) return 'D'
  return undefined
}

export const parseBulkPlayerDrafts = (
  text: string,
): Array<Pick<Player, 'name' | 'level' | 'ageGroup' | 'gender' | 'active' | 'specialRequired' | 'isGuest' | 'guestGameLimit' | 'gameCountFlexible' | 'waitTimeFlexible'>> =>
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const normalizedLine = line.replace(numberedListPrefix, '')
      const [name, ...attributeTokens] = normalizedLine
        .split(/[\s,/]+/)
        .filter(Boolean)
      const levels = attributeTokens
        .map((token) => parseBulkLevel(token))
        .filter((level): level is Level => Boolean(level))
      const regularLevel = levels.find((level) => level !== '스페셜')
      const hasSpecialLevel = levels.includes('스페셜')
      const ageGroup =
        attributeTokens
          .map((token) => parseBulkAgeGroup(token))
          .find((age): age is AgeGroup => Boolean(age)) ?? '무관'
      const gender =
        attributeTokens
          .map((token) => parseBulkGender(token))
          .find((item): item is Gender => Boolean(item)) ?? 'none'
      const isGuest =
        (hasSpecialLevel && !regularLevel) ||
        attributeTokens.some((token) => token.includes('게스트'))
      const specialRequired =
        !isGuest &&
        Boolean(regularLevel) &&
        attributeTokens.some(
          (token) => token === '스페셜' || token.toLowerCase() === 'special',
        )
      const gameCountFlexible =
        !isGuest &&
        attributeTokens.some((token) =>
          ['경기양보', '경기수양보'].includes(token),
        )
      const waitTimeFlexible =
        !isGuest &&
        attributeTokens.some((token) =>
          ['대기양보', '긴대기', '24분대기', '25분대기'].includes(token),
        )

      return {
        name: name ?? '',
        level: regularLevel ?? (hasSpecialLevel ? '스페셜' : 'O'),
        ageGroup,
        gender,
        active: true,
        specialRequired,
        isGuest,
        guestGameLimit: 0,
        gameCountFlexible,
        waitTimeFlexible,
      }
    })
