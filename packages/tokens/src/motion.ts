/**
 * Motion.
 *
 * The design is near-static on purpose. This is the COMPLETE set of animation the
 * prototype declares — anything beyond it is a new design decision, not a port.
 * Resisting the urge to add spring physics everywhere is part of the brief:
 * "chrome should fade out of the way", not perform.
 */
export const duration = {
  /** Tab island pill transition. */
  fast: 180,
  /** Toggle track colour and knob position. */
  base: 200,
  /** Sheet present/dismiss. Not in the prototype; the platform default. */
  sheet: 300,
} as const

export const easing = {
  /** The only curve the prototype uses. */
  standard: 'ease',
} as const

export const timing = {
  /** Toast auto-dismiss. */
  toastDuration: 2400,
  /**
   * Text caret blink: 1s, `steps(2)` — a hard on/off blink, NOT a fade. Ported
   * literally because a fading caret reads as a different product.
   */
  caretPeriod: 1000,
} as const
