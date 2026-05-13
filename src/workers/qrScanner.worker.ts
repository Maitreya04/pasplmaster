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
  const symbols = await scanImageData(message.imageData, scanner);
  const usableSymbols = symbols.filter((symbol) => symbol.decode().trim().length > 0);
  let symbol: (typeof usableSymbols)[number] | undefined;

  if (usableSymbols.length > 0) {
    symbol = usableSymbols[0];
    let bestScore = scoreSymbol(symbol);
    for (let i = 1; i < usableSymbols.length; i += 1) {
      const candidate = usableSymbols[i];
      const score = scoreSymbol(candidate);
      if (score > bestScore) {
        symbol = candidate;
        bestScore = score;
      }
    }
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
