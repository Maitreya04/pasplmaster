import type { RoiCrop } from './roiProcessor';

/** Matches Tailwind `w-64` / `h-48` at the default 16px root font size. Keep in sync with ViewfinderOverlay. */
export const VIEWFINDER_CSS_WIDTH = 256;
export const VIEWFINDER_CSS_HEIGHT = 192;

/**
 * Map the on-screen aim guide to pixel coordinates in the camera frame.
 * Pass `viewfinderEl` when available for exact alignment with the rendered box.
 */
export type ViewfinderCropOptions = {
  /** Expand decode region beyond the on-screen frame (helps angled / partial labels). */
  paddingFactor?: number;
};

function expandCrop(crop: RoiCrop, vw: number, vh: number, paddingFactor: number): RoiCrop {
  if (paddingFactor <= 1) return crop;
  const padW = Math.round((crop.sw * (paddingFactor - 1)) / 2);
  const padH = Math.round((crop.sh * (paddingFactor - 1)) / 2);
  const sx = Math.max(0, crop.sx - padW);
  const sy = Math.max(0, crop.sy - padH);
  const sw = Math.min(vw - sx, crop.sw + padW * 2);
  const sh = Math.min(vh - sy, crop.sh + padH * 2);
  return { ...crop, sx, sy, sw, sh };
}

export function getViewfinderVideoCrop(
  video: HTMLVideoElement,
  viewfinderEl?: HTMLElement | null,
  options: ViewfinderCropOptions = {},
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

  const crop = { level: 'tight' as const, sx, sy, sw, sh };
  const factor = options.paddingFactor ?? 1;
  return expandCrop(crop, vw, vh, factor);
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

function intersectionArea(
  a: { x: number; y: number; width: number; height: number },
  crop: RoiCrop,
): number {
  const x1 = Math.max(a.x, crop.sx);
  const y1 = Math.max(a.y, crop.sy);
  const x2 = Math.min(a.x + a.width, crop.sx + crop.sw);
  const y2 = Math.min(a.y + a.height, crop.sy + crop.sh);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

/** Accept decode when center is in frame or enough of the symbol overlaps the aim region. */
export function acceptDecodedHit(
  bbox: { x: number; y: number; width: number; height: number } | undefined,
  crop: RoiCrop | null,
  options: { collectMode?: boolean; minOverlapRatio?: number } = {},
): boolean {
  if (options.collectMode || !crop) return true;
  if (!bbox || bbox.width <= 0 || bbox.height <= 0) return true;
  if (isBoundingBoxInsideCrop(bbox, crop)) return true;
  const overlap = intersectionArea(bbox, crop);
  const minRatio = options.minOverlapRatio ?? 0.2;
  return overlap / (bbox.width * bbox.height) >= minRatio;
}
