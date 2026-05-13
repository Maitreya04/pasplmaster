import {
  ZBarConfigType,
  ZBarScanner,
  ZBarSymbolType,
  scanImageData,
} from '@undecaf/zbar-wasm';

type ScanRequestMessage = {
  type: 'scan';
  frameId: number;
  imageData: ImageData;
};

type WorkerRequestMessage = ScanRequestMessage;

type WorkerResponseMessage =
  | {
      type: 'ready';
    }
  | {
      type: 'scan-result';
      frameId: number;
      rawValue: string | null;
    }
  | {
      type: 'error';
      message: string;
    };

function cropImageData(
  source: ImageData,
  sx: number,
  sy: number,
  width: number,
  height: number,
): ImageData {
  const srcWidth = source.width;
  const srcHeight = source.height;
  const x = Math.max(0, Math.min(srcWidth - 1, Math.floor(sx)));
  const y = Math.max(0, Math.min(srcHeight - 1, Math.floor(sy)));
  const w = Math.max(1, Math.min(srcWidth - x, Math.floor(width)));
  const h = Math.max(1, Math.min(srcHeight - y, Math.floor(height)));
  const out = new Uint8ClampedArray(w * h * 4);
  const src = source.data;

  for (let row = 0; row < h; row += 1) {
    const srcOffset = ((y + row) * srcWidth + x) * 4;
    const dstOffset = row * w * 4;
    out.set(src.subarray(srcOffset, srcOffset + w * 4), dstOffset);
  }

  return new ImageData(out, w, h);
}

function upscaleNearest(source: ImageData, scale: number): ImageData {
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

function isLikelyPartNumber(raw: string): boolean {
  const value = raw.trim().toUpperCase();
  if (!value) return false;
  if (value.length < 4 || value.length > 36) return false;
  if (/\n/.test(value)) return false;
  if (/\b(?:MRP|QTY|COMMODITY|NUMBER OF|PACKED)\b/.test(value)) return false;
  if (/^[A-Z0-9][A-Z0-9.\-/]{3,}$/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)) {
    return true;
  }
  if (/^\d{6,18}$/.test(value)) return true;
  return false;
}

function scoreSymbol(symbol: { type: ZBarSymbolType; decode(): string }): number {
  const decoded = symbol.decode().trim();
  if (!decoded) return -1000;

  let score = 0;
  if (symbol.type === ZBarSymbolType.ZBAR_CODE128) score += 12;
  if (symbol.type === ZBarSymbolType.ZBAR_CODE39 || symbol.type === ZBarSymbolType.ZBAR_CODE93) score += 8;
  if (
    symbol.type === ZBarSymbolType.ZBAR_EAN13 ||
    symbol.type === ZBarSymbolType.ZBAR_EAN8 ||
    symbol.type === ZBarSymbolType.ZBAR_UPCA ||
    symbol.type === ZBarSymbolType.ZBAR_UPCE
  ) {
    score += 6;
  }
  if (symbol.type === ZBarSymbolType.ZBAR_QRCODE) score -= 8;
  if (isLikelyPartNumber(decoded)) score += 20;
  if (decoded.length > 26) score -= 4;
  return score;
}

async function scanBestSymbol(scanner: ZBarScanner, imageData: ImageData) {
  const symbols = await scanImageData(imageData, scanner);
  const usableSymbols = symbols.filter((symbol) => symbol.decode().trim().length > 0);
  if (usableSymbols.length === 0) return null;

  let best = usableSymbols[0];
  let bestScore = scoreSymbol(best);
  for (let i = 1; i < usableSymbols.length; i += 1) {
    const candidate = usableSymbols[i];
    const score = scoreSymbol(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

let scannerPromise: Promise<ZBarScanner> | null = null;

async function getBarcodeScanner(): Promise<ZBarScanner> {
  if (!scannerPromise) {
    scannerPromise = ZBarScanner.create().then((scanner) => {
      scanner.enableCache(false);
      
      // Increase scanning density to 1 (check every pixel row/column) 
      // This is critical for detecting 1D barcodes reliably on standard webcams.
      scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_X_DENSITY, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_Y_DENSITY, 1);

      // Disable everything first, then enable the formats we want.
      scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_ENABLE, 0);
      scanner.setConfig(ZBarSymbolType.ZBAR_QRCODE, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_CODE128, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_CODE39, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_CODE93, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_CODABAR, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_EAN13, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_EAN8, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_UPCA, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_UPCE, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_I25, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_DATABAR, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      return scanner;
    });
  }

  return scannerPromise;
}

async function handleScan(message: ScanRequestMessage) {
  const scanner = await getBarcodeScanner();
  const image = message.imageData;
  const variants: ImageData[] = [image];
  const centerCrop = cropImageData(
    image,
    image.width * 0.2,
    image.height * 0.2,
    image.width * 0.6,
    image.height * 0.6,
  );
  variants.push(centerCrop);
  variants.push(upscaleNearest(centerCrop, 2));
  variants.push(upscaleNearest(image, 1.5));

  let symbol: { decode(): string } | null = null;
  for (const variant of variants) {
    symbol = await scanBestSymbol(scanner, variant);
    if (symbol) break;
  }

  const response: WorkerResponseMessage = {
    type: 'scan-result',
    frameId: message.frameId,
    rawValue: symbol ? symbol.decode() : null,
  };

  self.postMessage(response);
}

self.postMessage({ type: 'ready' } satisfies WorkerResponseMessage);

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const message = event.data;
  if (message.type !== 'scan') return;

  void handleScan(message).catch((error: unknown) => {
    const response: WorkerResponseMessage = {
      type: 'error',
      message: error instanceof Error ? error.message : 'QR worker failed',
    };
    self.postMessage(response);
  });
};
