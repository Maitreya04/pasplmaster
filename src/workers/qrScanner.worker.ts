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

async function getQrScanner(): Promise<ZBarScanner> {
  if (!scannerPromise) {
    scannerPromise = ZBarScanner.create().then((scanner) => {
      scanner.enableCache(false);
      scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_ENABLE, 0);
      scanner.setConfig(ZBarSymbolType.ZBAR_QRCODE, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      return scanner;
    });
  }

  return scannerPromise;
}

async function handleScan(message: ScanRequestMessage) {
  const scanner = await getQrScanner();
  const symbols = await scanImageData(message.imageData, scanner);
  const qrSymbol = symbols.find((symbol) => symbol.type === ZBarSymbolType.ZBAR_QRCODE);

  const response: WorkerResponseMessage = {
    type: 'scan-result',
    frameId: message.frameId,
    rawValue: qrSymbol ? qrSymbol.decode() : null,
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
