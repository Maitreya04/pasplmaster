import {
  ZBarConfigType,
  ZBarScanner,
  ZBarSymbolType,
  scanImageData,
} from '@undecaf/zbar-wasm';
import {
  prepareZXingModule,
  readBarcodes,
  type Position,
  type ReaderOptions,
} from 'zxing-wasm/reader';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import {
  buildLabelDecodeVariants,
  stretchContrast,
  suppressGlare,
  type LabelDecodeVariant,
} from '../lib/scanner/labelPreprocess';
import {
  pickBestBarcodeCandidate,
  type BarcodeHit,
  type PickBarcodeContext,
} from '../lib/scanner/pickBarcodeSelection';

type ScanRequestMessage = {
  type: 'scan';
  frameId: number;
  imageData: ImageData;
  missStreak?: number;
  pickContext?: PickBarcodeContext;
};

type WorkerRequestMessage = ScanRequestMessage;

export type WorkerBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type WorkerResponseMessage =
  | {
      type: 'ready';
    }
  | {
      type: 'scan-result';
      frameId: number;
      rawValue: string | null;
      boundingBox?: WorkerBoundingBox;
    }
  | {
      type: 'error';
      message: string;
    };

/** After this many misses, run the damaged-label recovery ladder. */
const HARD_PASS_MISS_STREAK = 2;
/** Cheap preprocess pass (glare + local binarize) after this many misses. */
const SOFT_PASS_MISS_STREAK = 1;

function positionToBoundingBox(position: Position): WorkerBoundingBox {
  const xs = [position.topLeft.x, position.topRight.x, position.bottomLeft.x, position.bottomRight.x];
  const ys = [position.topLeft.y, position.topRight.y, position.bottomLeft.y, position.bottomRight.y];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function zbarFormatName(type: ZBarSymbolType): string | undefined {
  if (type === ZBarSymbolType.ZBAR_QRCODE) return 'QRCode';
  if (type === ZBarSymbolType.ZBAR_CODE128) return 'Code128';
  if (type === ZBarSymbolType.ZBAR_CODE39) return 'Code39';
  if (type === ZBarSymbolType.ZBAR_CODE93) return 'Code93';
  return undefined;
}

const ZXING_FORMATS: NonNullable<ReaderOptions['formats']> = [
  'QRCode',
  'MicroQRCode',
  'Code128',
  'Code39',
  'Code93',
  'Codabar',
  'DataMatrix',
  'EAN13',
  'EAN8',
  'ITF',
  'PDF417',
  'Aztec',
  'UPCA',
  'UPCE',
];

let zxingReadyPromise: Promise<unknown> | null = null;

async function prepareZXing(): Promise<void> {
  if (!zxingReadyPromise) {
    zxingReadyPromise = Promise.resolve(
      prepareZXingModule({
        overrides: {
          locateFile: (path: string) => (path.endsWith('.wasm') ? zxingReaderWasmUrl : path),
        },
        fireImmediately: true,
      }),
    );
  }
  await zxingReadyPromise;
}

function oemModeActive(pickContext?: PickBarcodeContext): boolean {
  return Boolean(pickContext?.oemMultiBarcodeMode && pickContext.expectedCodes.length > 0);
}

async function scanAllZXing(
  imageData: ImageData,
  tryHarder: boolean,
  pickContext?: PickBarcodeContext,
): Promise<BarcodeHit[]> {
  await prepareZXing();
  const oem = oemModeActive(pickContext);
  const aggressive = tryHarder || oem;

  const results = await readBarcodes(imageData, {
    formats: ZXING_FORMATS,
    tryHarder,
    tryRotate: tryHarder,
    tryInvert: tryHarder || oem,
    tryDownscale: !aggressive,
    tryDenoise: aggressive,
    binarizer: aggressive ? 'LocalAverage' : 'GlobalHistogram',
    maxNumberOfSymbols: 8,
    minLineCount: aggressive ? 1 : 2,
    textMode: 'Plain',
  });
  return results
    .filter((result) => result.text.trim().length > 0 && result.isValid)
    .map((result) => ({
      rawValue: result.text.trim(),
      format: result.format,
      boundingBox: positionToBoundingBox(result.position),
    }));
}

async function scanAllZBar(scanner: ZBarScanner, imageData: ImageData): Promise<BarcodeHit[]> {
  const symbols = await scanImageData(imageData, scanner);
  const hits: BarcodeHit[] = [];
  for (const symbol of symbols) {
    const rawValue = symbol.decode().trim();
    if (!rawValue) continue;
    hits.push({
      rawValue,
      format: zbarFormatName(symbol.type),
    });
  }
  return hits;
}

async function scanAllBarcodes(
  scanner: ZBarScanner,
  imageData: ImageData,
  tryHarder: boolean,
  pickContext?: PickBarcodeContext,
): Promise<BarcodeHit | null> {
  const [zxingHits, zbarHits] = await Promise.all([
    scanAllZXing(imageData, tryHarder, pickContext),
    scanAllZBar(scanner, imageData),
  ]);

  const merged: BarcodeHit[] = [];
  const seen = new Set<string>();
  for (const hit of [...zxingHits, ...zbarHits]) {
    const key = hit.rawValue.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
  }

  return pickBestBarcodeCandidate(merged, {
    collectMode: false,
    pickContext,
    frameHeight: imageData.height,
  });
}

let scannerPromise: Promise<ZBarScanner> | null = null;

async function getBarcodeScanner(): Promise<ZBarScanner> {
  if (!scannerPromise) {
    scannerPromise = ZBarScanner.create().then((scanner) => {
      scanner.enableCache(false);

      scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_X_DENSITY, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_Y_DENSITY, 1);

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

/** Warm WASM + ZBar scanner before first frame (first scan awaits this implicitly). */
const engineWarmPromise = Promise.all([prepareZXing(), getBarcodeScanner()]).catch((err: unknown) => {
  console.error('[qrScanner.worker] engine warmup failed', err);
  throw err;
});

async function tryDecodeVariant(
  scanner: ZBarScanner,
  variant: LabelDecodeVariant,
  pickContext: PickBarcodeContext | undefined,
  post: (rawValue: string | null, boundingBox?: WorkerBoundingBox, upscale?: number) => void,
): Promise<boolean> {
  const hit = await scanAllBarcodes(scanner, variant.image, true, pickContext);
  if (!hit) return false;
  post(hit.rawValue, hit.boundingBox, variant.scale);
  return true;
}

async function handleScan(message: ScanRequestMessage) {
  const scanner = await getBarcodeScanner();
  const image = message.imageData;
  const pickContext = message.pickContext;
  const missStreak = message.missStreak ?? 0;

  const post = (rawValue: string | null, boundingBox?: WorkerBoundingBox, upscale = 1) => {
    let box = boundingBox;
    if (box && upscale !== 1) {
      box = {
        x: box.x / upscale,
        y: box.y / upscale,
        width: box.width / upscale,
        height: box.height / upscale,
      };
    }
    const response: WorkerResponseMessage = {
      type: 'scan-result',
      frameId: message.frameId,
      rawValue,
      ...(box ? { boundingBox: box } : {}),
    };
    self.postMessage(response);
  };

  let hit = await scanAllBarcodes(scanner, image, false, pickContext);
  if (hit) {
    post(hit.rawValue, hit.boundingBox);
    return;
  }

  if (missStreak >= SOFT_PASS_MISS_STREAK) {
    const softImage = suppressGlare(stretchContrast(image));
    hit = await scanAllBarcodes(scanner, softImage, true, pickContext);
    if (hit) {
      post(hit.rawValue, hit.boundingBox);
      return;
    }
  }

  if (missStreak < HARD_PASS_MISS_STREAK) {
    post(null);
    return;
  }

  for (const variant of buildLabelDecodeVariants(image)) {
    const decoded = await tryDecodeVariant(scanner, variant, pickContext, post);
    if (decoded) return;
  }

  post(null);
}

self.postMessage({ type: 'ready' } satisfies WorkerResponseMessage);

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const message = event.data;
  if (message.type !== 'scan') return;

  void engineWarmPromise
    .then(() => handleScan(message))
    .catch((error: unknown) => {
      const response: WorkerResponseMessage = {
        type: 'error',
        message: error instanceof Error ? error.message : 'QR worker failed',
      };
      self.postMessage(response);
    });
};
