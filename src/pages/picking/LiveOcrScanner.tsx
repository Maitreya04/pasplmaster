import { useCallback, useEffect, useRef, useState } from 'react';
import type { OrderItem, ScanResult } from '../../types';
import { scanImage } from '../../lib/ocr/ocrEngine';
import { matchOcrToItem } from '../../lib/ocr/ocrMatcher';
import { buildScanResultFromMatch } from '../../lib/ocr/scanResult';
import { verifyWithAI, buildScanResultFromAI } from '../../lib/ocr/pickVerifier';
import { OcrScannerSheet } from './LiveOcrScannerSheet';

/** Resize image to JPEG base64 for AI verification */
function imageFileToBase64(file: File, maxWidth = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      resolve(dataUrl.split(',')[1]);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };
    img.src = URL.createObjectURL(file);
  });
}

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
  const [photoState, setPhotoState] = useState<'idle' | 'processing' | 'ai_checking' | 'done'>('idle');
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const autoConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageFileRef = useRef<File | null>(null);

  // Reset when sheet closes
  useEffect(() => {
    if (!isOpen) {
      if (autoConfirmTimer.current) clearTimeout(autoConfirmTimer.current);
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      setPhotoState('idle');
      setThumbUrl(null);
      setResult(null);
      imageFileRef.current = null;
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePhoto = useCallback(
    async (file: File) => {
      const url = URL.createObjectURL(file);
      setThumbUrl(url);
      setPhotoState('processing');
      imageFileRef.current = file;

      try {
        // Layer 1+2: Tesseract OCR → local multi-signal matching
        const { rawText } = await scanImage(file);
        const matchResult = matchOcrToItem(
          rawText,
          expectedItem,
          itemMrp,
          itemMainGroup ?? null,
          itemAlias1 ?? null,
        );

        if (matchResult.isMatch) {
          // Local match succeeded — done!
          const scanResult = buildScanResultFromMatch({ rawText, matchResult, expectedItem });
          scanResult.method = 'local_match';
          setResult(scanResult);
          setPhotoState('done');

          // Auto-confirm after brief success flash
          autoConfirmTimer.current = setTimeout(() => {
            onFinal({ scanResult, thumbnailUrl: url });
            onClose();
          }, 900);
          return;
        }

        // Local match failed — try AI fallback
        setPhotoState('ai_checking');

        try {
          const imageBase64 = await imageFileToBase64(file, 1000);
          const aiResult = await verifyWithAI(imageBase64, {
            name: expectedItem.item_name,
            alias1: itemAlias1,
            mrp: itemMrp,
          });

          if (aiResult.match) {
            // AI confirmed the match
            const scanResult = buildScanResultFromAI(aiResult, rawText, expectedItem);
            setResult(scanResult);
            setPhotoState('done');

            autoConfirmTimer.current = setTimeout(() => {
              onFinal({ scanResult, thumbnailUrl: url });
              onClose();
            }, 900);
            return;
          }

          // AI also didn't match — show local result as no-match
          const scanResult = buildScanResultFromMatch({ rawText, matchResult, expectedItem });
          scanResult.method = 'local_match';
          setResult(scanResult);
          setPhotoState('done');
        } catch (aiErr) {
          console.warn('AI verification failed, showing local result:', aiErr);
          // AI unavailable — fall back to showing local result
          const scanResult = buildScanResultFromMatch({ rawText, matchResult, expectedItem });
          scanResult.method = 'local_match';
          setResult(scanResult);
          setPhotoState('done');
        }
      } catch {
        URL.revokeObjectURL(url);
        setThumbUrl(null);
        setPhotoState('idle');
        imageFileRef.current = null;
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
    imageFileRef.current = null;
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
      scanResult.method = 'manual';
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
