import { useCallback, useEffect, useRef, useState } from 'react';
import type { OrderItem, ScanResult } from '../../types';
import { scanImage } from '../../lib/ocr/ocrEngine';
import { matchOcrToItem } from '../../lib/ocr/ocrMatcher';
import { buildScanResultFromMatch } from '../../lib/ocr/scanResult';
import { OcrScannerSheet } from './LiveOcrScannerSheet';

export function LiveOcrScanner({
  isOpen,
  expectedItem,
  itemMrp,
  itemMainGroup,
  itemAlias1,
  onClose,
  onFinal,
}: {
  isOpen: boolean;
  expectedItem: OrderItem;
  itemMrp?: number;
  itemMainGroup?: string | null;
  itemAlias1?: string | null;
  onClose: () => void;
  onFinal: (payload: { scanResult: ScanResult; thumbnailUrl: string | null }) => void;
}) {
  const [photoState, setPhotoState] = useState<'idle' | 'processing' | 'done'>('idle');
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const autoConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when sheet closes
  useEffect(() => {
    if (!isOpen) {
      if (autoConfirmTimer.current) clearTimeout(autoConfirmTimer.current);
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      setPhotoState('idle');
      setThumbUrl(null);
      setResult(null);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePhoto = useCallback(
    async (file: File) => {
      const url = URL.createObjectURL(file);
      setThumbUrl(url);
      setPhotoState('processing');

      try {
        const { rawText } = await scanImage(file);
        const matchResult = matchOcrToItem(
          rawText,
          expectedItem,
          itemMrp,
          itemMainGroup ?? null,
          itemAlias1 ?? null,
        );
        const scanResult = buildScanResultFromMatch({ rawText, matchResult, expectedItem });
        setResult(scanResult);
        setPhotoState('done');

        if (scanResult.isMatch) {
          // Auto-confirm a successful scan after a brief success flash
          autoConfirmTimer.current = setTimeout(() => {
            onFinal({ scanResult, thumbnailUrl: url });
            onClose();
          }, 900);
        }
      } catch {
        URL.revokeObjectURL(url);
        setThumbUrl(null);
        setPhotoState('idle');
      }
    },
    [expectedItem, itemAlias1, itemMainGroup, itemMrp, onClose, onFinal],
  );

  const handleConfirm = useCallback(() => {
    if (!result) return;
    if (autoConfirmTimer.current) clearTimeout(autoConfirmTimer.current);
    onFinal({ scanResult: result, thumbnailUrl: thumbUrl });
    onClose();
  }, [onClose, onFinal, result, thumbUrl]);

  const handleRetake = useCallback(() => {
    if (autoConfirmTimer.current) clearTimeout(autoConfirmTimer.current);
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    setThumbUrl(null);
    setResult(null);
    setPhotoState('idle');
  }, [thumbUrl]);

  const handleManualSubmit = useCallback(
    (value: string) => {
      const rawText = value.trim();
      if (!rawText) return;
      const matchResult = matchOcrToItem(
        rawText,
        expectedItem,
        itemMrp,
        itemMainGroup ?? null,
        itemAlias1 ?? null,
      );
      const scanResult = buildScanResultFromMatch({ rawText, matchResult, expectedItem });
      onFinal({ scanResult, thumbnailUrl: null });
      onClose();
    },
    [expectedItem, itemAlias1, itemMainGroup, itemMrp, onClose, onFinal],
  );

  return (
    <OcrScannerSheet
      isOpen={isOpen}
      expectedItem={expectedItem}
      itemAlias1={itemAlias1 ?? null}
      photoState={photoState}
      thumbnailUrl={thumbUrl}
      scanResult={result}
      onClose={onClose}
      onPhoto={handlePhoto}
      onConfirm={handleConfirm}
      onRetake={handleRetake}
      onManualSubmit={handleManualSubmit}
    />
  );
}
