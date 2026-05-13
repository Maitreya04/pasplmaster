export type RoiLevel = 'tight' | 'medium' | 'full';

export interface RoiCrop {
  level: RoiLevel;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface RoiImageDataCapture {
  level: RoiLevel;
  imageData: ImageData;
  sourceCrop: RoiCrop;
}

export interface RoiBitmapCapture {
  level: RoiLevel;
  bitmap: ImageBitmap;
  sourceCrop: RoiCrop;
}

const ROI_SCALE: Record<RoiLevel, { width: number; height: number }> = {
  tight: { width: 0.36, height: 0.48 },
  medium: { width: 0.58, height: 0.72 },
  full: { width: 1, height: 1 },
};

function getTargetSize(
  crop: RoiCrop,
  maxLongEdge: number,
  upscale = 1,
): { width: number; height: number } {
  const scaledWidth = crop.sw * upscale;
  const scaledHeight = crop.sh * upscale;
  const longEdge = Math.max(scaledWidth, scaledHeight);
  const fitScale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;

  return {
    width: Math.max(1, Math.round(scaledWidth * fitScale)),
    height: Math.max(1, Math.round(scaledHeight * fitScale)),
  };
}

export function getRoiCrop(sourceWidth: number, sourceHeight: number, level: RoiLevel): RoiCrop {
  const scale = ROI_SCALE[level];
  const sw = Math.max(1, Math.round(sourceWidth * scale.width));
  const sh = Math.max(1, Math.round(sourceHeight * scale.height));
  const sx = Math.max(0, Math.round((sourceWidth - sw) / 2));
  const sy = Math.max(0, Math.round((sourceHeight - sh) / 2));

  return { level, sx, sy, sw, sh };
}

export function getNextRoiLevel(frameNumber: number): RoiLevel {
  if (frameNumber % 9 === 0) return 'full';
  if (frameNumber % 3 === 0) return 'medium';
  return 'tight';
}

export async function captureRoiBitmap(
  video: HTMLVideoElement,
  level: RoiLevel,
  options: { maxLongEdge?: number; upscale?: number } = {},
): Promise<RoiBitmapCapture | null> {
  if (typeof createImageBitmap !== 'function') return null;
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;

  const sourceCrop = getRoiCrop(video.videoWidth, video.videoHeight, level);
  const { width, height } = getTargetSize(
    sourceCrop,
    options.maxLongEdge ?? 1280,
    options.upscale ?? (level === 'tight' ? 1.5 : 1),
  );

  const bitmap = await createImageBitmap(
    video,
    sourceCrop.sx,
    sourceCrop.sy,
    sourceCrop.sw,
    sourceCrop.sh,
    {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    },
  );

  return { level, bitmap, sourceCrop };
}

export function captureRoiImageData(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  level: RoiLevel,
  options: { maxLongEdge?: number; upscale?: number } = {},
): RoiImageDataCapture | null {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;

  const sourceCrop = getRoiCrop(video.videoWidth, video.videoHeight, level);
  const { width, height } = getTargetSize(
    sourceCrop,
    options.maxLongEdge ?? 1280,
    options.upscale ?? (level === 'tight' ? 1.5 : 1),
  );

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.drawImage(
    video,
    sourceCrop.sx,
    sourceCrop.sy,
    sourceCrop.sw,
    sourceCrop.sh,
    0,
    0,
    width,
    height,
  );

  return {
    level,
    imageData: ctx.getImageData(0, 0, width, height),
    sourceCrop,
  };
}
