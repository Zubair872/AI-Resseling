// Purpose: pure helpers for Autopilot (no database, no network).
export type Slot = { hour: number; minute: number }

// Spreads `count` posts evenly between startHour and endHour (local time), rounded to 5 minutes.
export function slotTimes(count: number, startHour = 10, endHour = 21): Slot[] {
  const n = Math.max(0, Math.min(Math.floor(count), 24))
  const slots: Slot[] = []
  for (let i = 0; i < n; i += 1) {
    const minutes = Math.round((startHour * 60 + ((endHour - startHour) * 60 * (i + 0.5)) / n) / 5) * 5
    slots.push({ hour: Math.floor(minutes / 60), minute: minutes % 60 })
  }
  return slots
}

// Slots still free for a day: the first `alreadyScheduled` slots are treated as used.
export function freeSlots(dailyLimit: number, alreadyScheduled: number): Slot[] {
  return slotTimes(dailyLimit).slice(Math.max(0, alreadyScheduled))
}

// Content made by Autopilot is approved automatically ONLY in hybrid/full mode. Otherwise a person approves it first.
export function autoApprovesContent(mode: string) {
  return mode === 'hybrid' || mode === 'full'
}
