/** Design canvas for every big screen: 1920×1080, scaled to fit the display. */
export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

/** Never upscale: a window larger than the canvas must not crop the board. */
export function fitScale(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(
    window.innerWidth / DESIGN_WIDTH,
    window.innerHeight / DESIGN_HEIGHT,
    1,
  );
}
