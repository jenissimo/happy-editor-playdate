/** Integer pixel scales only — fractional zoom softens 1-bit art. */
export const ZOOM_MIN = 1
export const ZOOM_MAX = 6
export const ZOOM_STEP = 1

export function clampZoom(z: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z)))
}
