import type { MatchSettings } from './types'

export const disableEventMatchOnEntry = (
  settings: MatchSettings,
): MatchSettings => ({
  ...settings,
  eventMatch: {
    ...settings.eventMatch,
    enabled: false,
  },
})
