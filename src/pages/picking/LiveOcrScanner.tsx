import { useCallback, useMemo, useRef, useState } from 'react';
import type { OrderItem, ScanResult } from '../../types';
import { scanImage } from '../../lib/ocr/ocrEngine';
import { matchOcrToItem } from '../../lib/ocr/ocrMatcher';
import { buildScanResultFromMatch } from '../../lib/ocr/scanResult';
import { useContinuousOcr } from '../../hooks/useContinuousOcr';
import { LiveOcrScannerSheet, type LiveScanUiState } from './LiveOcrScannerSheet';

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraState, setCameraState] = useState<
    'requesting_camera' | 'camera_ready' | 'error'
  >('requesting_camera');

  const startCamera = useCallback(async (videoEl: HTMLVideoElement) => {
    try {
      setCameraState('requesting_camera');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
      setCameraState('camera_ready');
      return stream;
    } catch {
      setCameraState('error');
      return null;
    }
  }, []);

  const ocrEnabled = isOpen && cameraState === 'camera_ready';

  const handleStable = useCallback(
    (scanResult: ScanResult) => {
      onFinal({ scanResult, thumbnailUrl: null });
      onClose();
    },
    [onClose, onFinal],
  );

  const continuous = useContinuousOcr({
    enabled: ocrEnabled,
    videoRef,
    expectedItem,
    itemMrp,
    itemMainGroup,
    itemAlias1,
    onStableResult: handleStable,
  });

  const uiState: LiveScanUiState = useMemo(() => {
    if (!isOpen) return 'camera_ready';
    if (cameraState === 'requesting_camera') return 'requesting_camera';
    if (cameraState === 'error') return 'error';
    return continuous.uiState;
  }, [cameraState, continuous.uiState, isOpen]);

  const statusText = useMemo(() => {
    if (cameraState === 'requesting_camera') return 'Requesting camera…';
    if (cameraState === 'error') return 'Camera permission denied or unavailable';
    return continuous.statusText;
  }, [cameraState, continuous.statusText]);

  const onUsePhoto = useCallback(
    async (file: File) => {
      const thumbUrl = URL.createObjectURL(file);
      try {
        const { rawText } = await scanImage(file);
        const matchResult = matchOcrToItem(
          rawText,
          expectedItem,
          itemMrp,
          itemMainGroup ?? null,
          itemAlias1 ?? null,
        );
        const scanResult = buildScanResultFromMatch({
          rawText,
          matchResult,
          expectedItem,
        });
        onFinal({ scanResult, thumbnailUrl: thumbUrl });
        onClose();
      } catch {
        URL.revokeObjectURL(thumbUrl);
      }
    },
    [expectedItem, itemMainGroup, itemMrp, onClose, onFinal],
  );

  const onManualSubmit = useCallback(
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
      const scanResult = buildScanResultFromMatch({
        rawText,
        matchResult,
        expectedItem,
      });
      onFinal({ scanResult, thumbnailUrl: null });
      onClose();
    },
    [expectedItem, itemAlias1, itemMainGroup, itemMrp, onClose, onFinal],
  );

  return (
    <LiveOcrScannerSheet
      isOpen={isOpen}
      expectedItem={expectedItem}
      itemAlias1={itemAlias1 ?? null}
      videoRef={videoRef}
      uiState={uiState}
      statusText={statusText}
      candidateText={continuous.candidateText}
      lastScanResult={continuous.lastScanResult}
      onClose={onClose}
      onStartCamera={startCamera}
      onUsePhoto={onUsePhoto}
      onManualSubmit={onManualSubmit}
    />
  );
}

