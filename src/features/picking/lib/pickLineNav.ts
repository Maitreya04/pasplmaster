/** Above this count, footer uses compact nav + list jump instead of chip strip. */
export const PICK_LINE_CHIP_MAX = 8;

export function usePickLineChipStrip(totalLines: number): boolean {
  return totalLines <= PICK_LINE_CHIP_MAX;
}
