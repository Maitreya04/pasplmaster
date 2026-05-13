import type { QRCode } from 'jsqr';

export const SCAN_INTERVAL_MS = 80;
export const STABLE_LOCK_FRAMES = 20;
export const MAX_SCAN_LONG_EDGE = 1280;
export const ZOOM_SCALE = 1.35;

export interface ScannerPoint {
  x: number;
  y: number;
}

export interface ScannerSize {
  width: number;
  height: number;
}

export interface MappedQrLocation {
  topLeftCorner: ScannerPoint;
  topRightCorner: ScannerPoint;
  bottomRightCorner: ScannerPoint;
  bottomLeftCorner: ScannerPoint;
  center: ScannerPoint;
  averageSide: number;
}

export interface ScanCanvasSizing {
  width: number;
  height: number;
  scale: number;
}

export function getScanCanvasSizing(
  sourceWidth: number,
  sourceHeight: number,
  maxLongEdge = MAX_SCAN_LONG_EDGE,
): ScanCanvasSizing {
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

export function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const nextWidth = Math.max(1, Math.round(rect.width * dpr));
  const nextHeight = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function clearDisplayCanvas(canvas: HTMLCanvasElement): void {
  const ctx = resizeCanvasToDisplaySize(canvas);
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
}

export function mapScanPointToDisplay(
  point: ScannerPoint,
  scanSize: ScannerSize,
  sourceSize: ScannerSize,
  displaySize: ScannerSize,
): ScannerPoint {
  const sourceX = (point.x / scanSize.width) * sourceSize.width;
  const sourceY = (point.y / scanSize.height) * sourceSize.height;
  const coverScale = Math.max(displaySize.width / sourceSize.width, displaySize.height / sourceSize.height);
  const renderedWidth = sourceSize.width * coverScale;
  const renderedHeight = sourceSize.height * coverScale;
  const offsetX = (displaySize.width - renderedWidth) / 2;
  const offsetY = (displaySize.height - renderedHeight) / 2;

  return {
    x: sourceX * coverScale + offsetX,
    y: sourceY * coverScale + offsetY,
  };
}

export function mapQrLocationToDisplay(
  code: Pick<QRCode, 'location'>,
  scanSize: ScannerSize,
  sourceSize: ScannerSize,
  displaySize: ScannerSize,
): MappedQrLocation {
  const topLeftCorner = mapScanPointToDisplay(code.location.topLeftCorner, scanSize, sourceSize, displaySize);
  const topRightCorner = mapScanPointToDisplay(code.location.topRightCorner, scanSize, sourceSize, displaySize);
  const bottomRightCorner = mapScanPointToDisplay(code.location.bottomRightCorner, scanSize, sourceSize, displaySize);
  const bottomLeftCorner = mapScanPointToDisplay(code.location.bottomLeftCorner, scanSize, sourceSize, displaySize);
  const center = {
    x: (topLeftCorner.x + bottomRightCorner.x) / 2,
    y: (topLeftCorner.y + bottomRightCorner.y) / 2,
  };

  return {
    topLeftCorner,
    topRightCorner,
    bottomRightCorner,
    bottomLeftCorner,
    center,
    averageSide: averageQrSide([topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner]),
  };
}

export function averageQrSide(points: [ScannerPoint, ScannerPoint, ScannerPoint, ScannerPoint]): number {
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  return (
    distance(topLeft, topRight) +
    distance(topRight, bottomRight) +
    distance(bottomRight, bottomLeft) +
    distance(bottomLeft, topLeft)
  ) / 4;
}

export function drawQrBrackets(
  ctx: CanvasRenderingContext2D,
  location: MappedQrLocation,
  color: string,
  armLength = 16,
  strokeWidth = 2.5,
): void {
  const points = [
    {
      corner: location.topLeftCorner,
      first: { x: location.topLeftCorner.x + armLength, y: location.topLeftCorner.y },
      second: { x: location.topLeftCorner.x, y: location.topLeftCorner.y + armLength },
    },
    {
      corner: location.topRightCorner,
      first: { x: location.topRightCorner.x - armLength, y: location.topRightCorner.y },
      second: { x: location.topRightCorner.x, y: location.topRightCorner.y + armLength },
    },
    {
      corner: location.bottomRightCorner,
      first: { x: location.bottomRightCorner.x - armLength, y: location.bottomRightCorner.y },
      second: { x: location.bottomRightCorner.x, y: location.bottomRightCorner.y - armLength },
    },
    {
      corner: location.bottomLeftCorner,
      first: { x: location.bottomLeftCorner.x + armLength, y: location.bottomLeftCorner.y },
      second: { x: location.bottomLeftCorner.x, y: location.bottomLeftCorner.y - armLength },
    },
  ];

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  for (const point of points) {
    ctx.moveTo(point.corner.x, point.corner.y);
    ctx.lineTo(point.first.x, point.first.y);
    ctx.moveTo(point.corner.x, point.corner.y);
    ctx.lineTo(point.second.x, point.second.y);
  }

  ctx.stroke();
  ctx.restore();
}

export function distance(a: ScannerPoint, b: ScannerPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
