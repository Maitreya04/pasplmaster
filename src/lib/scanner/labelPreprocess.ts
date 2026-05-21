/** Image prep for damaged / glare-heavy warehouse labels (TAFE bags, crushed cartons). */

export interface LabelDecodeVariant {
  image: ImageData;
  /** Scale factor vs source frame — used to map bounding boxes back. */
  scale: number;
}

function cloneImageData(source: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
}

function luminanceAt(data: Uint8ClampedArray, index: number): number {
  return (data[index] + data[index + 1] + data[index + 2]) / 3;
}

function writeGrayPixel(out: Uint8ClampedArray, index: number, value: number, alpha: number): void {
  const v = Math.min(255, Math.max(0, Math.round(value)));
  out[index] = v;
  out[index + 1] = v;
  out[index + 2] = v;
  out[index + 3] = alpha;
}

/** Stretch luminance — helps faded thermal / sun-bleached print. */
export function stretchContrast(source: ImageData): ImageData {
  const { data, width, height } = source;
  let min = 255;
  let max = 0;

  for (let i = 0; i < data.length; i += 4) {
    const lum = luminanceAt(data, i);
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }

  if (max - min < 12) return cloneImageData(source);

  const scale = 255 / (max - min);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      out[i + c] = Math.min(255, Math.max(0, Math.round((data[i + c] - min) * scale)));
    }
    out[i + 3] = data[i + 3];
  }

  return new ImageData(out, width, height);
}

/**
 * Clip plastic-wrap / torch glare (hot pixels) then re-stretch contrast.
 * Real TAFE bags often blow out the 2D QR while 1D remains readable.
 */
export function suppressGlare(source: ImageData, hotPercentile = 0.9): ImageData {
  const { data, width, height } = source;
  const lums: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    lums.push(luminanceAt(data, i));
  }
  if (lums.length === 0) return cloneImageData(source);

  lums.sort((a, b) => a - b);
  const threshold = lums[Math.min(lums.length - 1, Math.floor(lums.length * hotPercentile))] ?? 255;
  if (threshold >= 248) return stretchContrast(source);

  const softened = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const lum = luminanceAt(data, i);
    const pull = lum > threshold ? threshold + (lum - threshold) * 0.35 : lum;
    const ratio = lum > 0 ? pull / lum : 1;
    for (let c = 0; c < 3; c += 1) {
      softened[i + c] = Math.min(255, Math.max(0, Math.round(data[i + c] * ratio)));
    }
    softened[i + 3] = data[i + 3];
  }

  return stretchContrast(new ImageData(softened, width, height));
}

/** Light unsharp mask on luminance — helps wavy / wrinkled 1D bars. */
export function sharpenLabel(source: ImageData): ImageData {
  const { data, width, height } = source;
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      gray[y * width + x] = luminanceAt(data, i);
    }
  }

  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || nx < 0 || ny >= height || nx >= width) continue;
          sum += gray[ny * width + nx];
          count += 1;
        }
      }
      const blur = sum / count;
      const idx = y * width + x;
      const sharp = Math.min(255, Math.max(0, gray[idx] + (gray[idx] - blur) * 1.4));
      const i = idx * 4;
      writeGrayPixel(out, i, sharp, data[i + 3]);
    }
  }

  return new ImageData(out, width, height);
}

export function invertLuminance(source: ImageData): ImageData {
  const out = new Uint8ClampedArray(source.data.length);
  for (let i = 0; i < source.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      out[i + c] = 255 - source.data[i + c];
    }
    out[i + 3] = source.data[i + 3];
  }
  return new ImageData(out, source.width, source.height);
}

export function upscaleNearest(source: ImageData, scale: number): ImageData {
  const targetWidth = Math.max(1, Math.floor(source.width * scale));
  const targetHeight = Math.max(1, Math.floor(source.height * scale));
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const src = source.data;

  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor(y / scale));
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor(x / scale));
      const srcIdx = (sy * source.width + sx) * 4;
      const dstIdx = (y * targetWidth + x) * 4;
      out[dstIdx] = src[srcIdx];
      out[dstIdx + 1] = src[srcIdx + 1];
      out[dstIdx + 2] = src[srcIdx + 2];
      out[dstIdx + 3] = src[srcIdx + 3];
    }
  }

  return new ImageData(out, targetWidth, targetHeight);
}

/** Ordered ladder — cheap passes first, heavier upscale last. */
export function buildLabelDecodeVariants(source: ImageData): LabelDecodeVariant[] {
  const contrast = stretchContrast(source);
  const deglared = suppressGlare(source);
  const sharp = sharpenLabel(contrast);

  return [
    { image: contrast, scale: 1 },
    { image: deglared, scale: 1 },
    { image: sharp, scale: 1 },
    { image: upscaleNearest(deglared, 2), scale: 2 },
    { image: upscaleNearest(sharp, 2.5), scale: 2.5 },
    { image: invertLuminance(contrast), scale: 1 },
  ];
}

export function oemCaptureBoost(active: boolean): { maxLongEdge: number; upscale: number } {
  return active
    ? { maxLongEdge: 1536, upscale: 2.35 }
    : { maxLongEdge: 1280, upscale: 1.85 };
}
