/**
 * Television design tokens.
 *
 * Two rules drive these numbers: everything must be readable from across a
 * room, and the screen must be calm in a dim one. Sizes are in density
 * independent pixels against a 1080p television, where the app renders at
 * roughly 960x540 dp, so 32dp of text is about 64 real pixels.
 */
export const theme = {
  colour: {
    background: '#101D33',
    backgroundSoft: '#16253C',
    panel: '#1B2E4A',
    text: '#F7F3EC',
    textSoft: '#C3CEDD',
    teal: '#4FA3A1',
    tealDeep: '#2D6160',
    amber: '#D68F2C',
    amberText: '#2A1C05',
    focusRing: '#FFFFFF',
    rose: '#E08A7E',
  },
  size: {
    // Overscan-safe margin: televisions crop the edges of the picture.
    safe: 42,
    gap: 18,
    radius: 16,
  },
  text: {
    hero: 46,
    title: 34,
    body: 26,
    label: 19,
    small: 16,
  },
} as const;

/** Scale every text size by the caregiver's preference. */
export function scaled(size: number, scale: number): number {
  return Math.round(size * Math.max(0.85, Math.min(1.5, scale || 1)));
}
