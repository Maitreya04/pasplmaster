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

let scannerPromise: Promise<ZBarScanner> | null = null;

async function getBarcodeScanner(): Promise<ZBarScanner> {
  if (!scannerPromise) {
    scannerPromise = ZBarScanner.create().then((scanner) => {
      scanner.enableCache(false);
      // Disable everything first, then enable the formats we want.
      scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_ENABLE, 0);
      scanner.setConfig(ZBarSymbolType.ZBAR_QRCODE, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_CODE128, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_CODE39, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_EAN13, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_EAN8, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      scanner.setConfig(ZBarSymbolType.ZBAR_UPCA, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
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
  // Prefer QR if both are detected, otherwise take the first decoded symbol.
  const symbol =
    symbols.find((s) => s.type === ZBarSymbolType.ZBAR_QRCODE) ??
    symbols.find((s) => {
      const decoded = s.decode();
      return decoded && decoded.trim().length > 0;
    });

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
