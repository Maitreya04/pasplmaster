import { CameraRotate, Lightning } from '@phosphor-icons/react';

export interface ScannerControlsProps {
  torchAvailable: boolean;
  torchActive: boolean;
  onTorchToggle: () => void;
  zoomLevel: number | null;
  onZoomToggle: () => void;
  supportMessage: string | null;
  onReset: () => void;
  resetDisabled: boolean;
  onClose: () => void;
}

export function ScannerControls({
  torchAvailable,
  torchActive,
  onTorchToggle,
  zoomLevel,
  onZoomToggle,
  supportMessage,
  onReset,
  resetDisabled,
  onClose,
}: ScannerControlsProps): React.JSX.Element {
  const disabled = Boolean(supportMessage);

  return (
    <div className="grid grid-cols-4 gap-2">
      <button
        type="button"
        onClick={onTorchToggle}
        disabled={!torchAvailable || disabled}
        className={`flex h-11 items-center justify-center gap-1.5 rounded-2xl text-sm font-medium text-white disabled:opacity-35 ${
          torchActive ? 'bg-amber-400/25 text-amber-100' : 'bg-white/10'
        }`}
        style={{ transition: 'transform 120ms ease-out, opacity 120ms ease-out' }}
      >
        <Lightning size={16} weight="fill" />
        Torch
      </button>
      <button
        type="button"
        onClick={onZoomToggle}
        disabled={!zoomLevel || disabled}
        className="flex h-11 items-center justify-center rounded-2xl bg-white/10 text-sm font-medium text-white disabled:opacity-35"
        style={{ transition: 'transform 120ms ease-out, opacity 120ms ease-out' }}
      >
        {zoomLevel ? `${zoomLevel.toFixed(zoomLevel % 1 === 0 ? 0 : 1)}x` : 'Zoom'}
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={resetDisabled || disabled}
        className="flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-white/10 text-sm font-medium text-white disabled:opacity-35"
        style={{ transition: 'transform 120ms ease-out, opacity 120ms ease-out' }}
      >
        <CameraRotate size={16} weight="bold" />
        Again
      </button>
      <button
        type="button"
        onClick={onClose}
        className="flex h-11 items-center justify-center rounded-2xl bg-white/10 text-sm font-medium text-white"
        style={{ transition: 'transform 120ms ease-out' }}
      >
        Done
      </button>
    </div>
  );
}
