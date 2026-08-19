import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaultData'
import { disableEventMatchOnEntry } from './eventMatchSettings'

describe('event match entry settings', () => {
  it('starts with the event match unchecked even if it was previously enabled', () => {
    const previouslyEnabled = {
      ...defaultSettings,
      eventMatch: {
        ...defaultSettings.eventMatch,
        enabled: true,
      },
    }

    expect(disableEventMatchOnEntry(previouslyEnabled).eventMatch.enabled).toBe(false)
    expect(previouslyEnabled.eventMatch.enabled).toBe(true)
  })
})
