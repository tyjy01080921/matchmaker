export const GAME_SLOT_MINUTES = 15
export const DEFAULT_START_TIME = '18:00'
export const DEFAULT_END_TIME = '20:00'
export const DEFAULT_BOOKING_MINUTES = 120
export const MAX_BOOKING_MINUTES = 12 * 60

const MINUTES_PER_DAY = 24 * 60

const moduloDay = (minutes: number) =>
  ((Math.floor(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY

export const parseClockTime = (value: unknown): number | null => {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null
  }

  return hours * 60 + minutes
}

export const formatClockTime = (minutes: number) => {
  const normalized = moduloDay(minutes)
  const hours = Math.floor(normalized / 60)
  const rest = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export const normalizeClockTime = (value: unknown, fallback: string) => {
  const parsed = parseClockTime(value)
  if (parsed === null) return fallback
  const rounded = Math.round(parsed / GAME_SLOT_MINUTES) * GAME_SLOT_MINUTES
  return formatClockTime(rounded)
}

export const rawBookingDurationMinutes = (startTime: string, endTime: string) => {
  const start = parseClockTime(startTime)
  const end = parseClockTime(endTime)
  if (start === null || end === null) return 0
  return moduloDay(end - start)
}

export const getBookingDurationMinutes = (
  startTime: string,
  endTime: string,
  fallback = DEFAULT_BOOKING_MINUTES,
) => {
  const duration = rawBookingDurationMinutes(startTime, endTime)
  if (
    duration < GAME_SLOT_MINUTES ||
    duration > MAX_BOOKING_MINUTES ||
    duration % GAME_SLOT_MINUTES !== 0
  ) {
    return fallback
  }
  return duration
}

export const getBookingRoundCount = (startTime: string, endTime: string) =>
  Math.max(
    1,
    Math.floor(
      getBookingDurationMinutes(startTime, endTime) / GAME_SLOT_MINUTES,
    ),
  )

export const clockTimeAtOffset = (startTime: string, offsetMinutes: number) => {
  const start = parseClockTime(startTime) ?? parseClockTime(DEFAULT_START_TIME) ?? 0
  return formatClockTime(start + offsetMinutes)
}

export const roundTimeRange = (startTime: string, roundNumber: number) => {
  const startsAt = Math.max(0, roundNumber - 1) * GAME_SLOT_MINUTES
  return `${clockTimeAtOffset(startTime, startsAt)}–${clockTimeAtOffset(
    startTime,
    startsAt + GAME_SLOT_MINUTES,
  )}`
}
