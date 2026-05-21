import type { RoiCrop } from './roiProcessor';

/** Matches Tailwind `w-64` / `h-48` at the default 16px root font size. Keep in sync with ViewfinderOverlay. */
export const VIEWFINDER_CSS_WIDTH = 256;
export const VIEWFINDER_CSS_HEIGHT = 192;

/**
 * Map the on-screen aim guide to pixel coordinates in the camera frame.
 * Pass `viewfinderEl` when available for exact alignment with the rendered box.
 */
export function getViewfinderVideoCrop(
  video: HTMLVideoElement,
  viewfinderEl?: HTMLElement | null,
): RoiCrop | null {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (rect.width <= 0 || rect.height <= 0 || vw <= 0 || vh <= 0) return null;

  const coverScale = Math.max(rect.width / vw, rect.height / vh);
  const renderedWidth = vw * coverScale;
  const renderedHeight = vh * coverScale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;

  let vfLeft: number;
  let vfTop: number;
  let vfWidth: number;
  let vfHeight: number;

  if (viewfinderEl) {
    const vfRect = viewfinderEl.getBoundingClientRect();
    vfLeft = vfRect.left - rect.left;
    vfTop = vfRect.top - rect.top;
    vfWidth = vfRect.width;
    vfHeight = vfRect.height;
  } else {
    vfWidth = VIEWFINDER_CSS_WIDTH;
    vfHeight = VIEWFINDER_CSS_HEIGHT;
    vfLeft = (rect.width - vfWidth) / 2;
    vfTop = (rect.height - vfHeight) / 2;
  }

  let sx = (vfLeft - offsetX) / coverScale;
  let sy = (vfTop - offsetY) / coverScale;
  let sw = vfWidth / coverScale;
  let sh = vfHeight / coverScale;

  sx = Math.max(0, Math.min(vw - 1, Math.round(sx)));
  sy = Math.max(0, Math.min(vh - 1, Math.round(sy)));
  sw = Math.max(1, Math.min(vw - sx, Math.round(sw)));
  sh = Math.max(1, Math.min(vh - sy, Math.round(sh)));

  return { level: 'tight', sx, sy, sw, sh };
}

export function isBoundingBoxInsideCrop(
  bbox: { x: number; y: number; width: number; height: number },
  crop: RoiCrop,
): boolean {
  const centerX = bbox.x + bbox.width / 2;
  const centerY = bbox.y + bbox.height / 2;
  return (
    centerX >= crop.sx &&
    centerX <= crop.sx + crop.sw &&
    centerY >= crop.sy &&
    centerY <= crop.sy + crop.sh
  );
}
