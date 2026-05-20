import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { BigButton } from '../shared';
import { useToast } from '../../context/ToastContext';
import { fetchStagingLayersForBusy, promoteStagingLayer } from '../../lib/receiving/receivingApi';
import { isStagingBinId } from '../../lib/wms/stagingBin';

export function StagingPromotePanel({
  busyCode,
  targetBinId,
  userId,
  userName,
}: {
  busyCode: number;
  targetBinId: string;
  userId: number | null;
  userName: string | null;
}): ReactElement | null {
  const toast = useToast();
  const qc = useQueryClient();
  const [movingId, setMovingId] = useState<number | null>(null);

  const layersQuery = useQuery({
    queryKey: ['stagingLayers', busyCode],
    queryFn: () => fetchStagingLayersForBusy(busyCode),
    enabled: Number.isFinite(busyCode) && busyCode > 0,
  });

  if (isStagingBinId(targetBinId)) return null;

  const layers = (layersQuery.data ?? []).filter((l) => Number(l.qty_ea) > 0);
  if (layers.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900 dark:bg-amber-950/40">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">
        Stock in STAGING
      </p>
      <p className="mt-1 text-sm text-amber-950 dark:text-amber-100">
        Move received stock into bin <span className="font-mono font-semibold">{targetBinId}</span>
      </p>
      <ul className="mt-2 space-y-2">
        {layers.map((layer) => (
          <li
            key={layer.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200/80 bg-white/60 px-2 py-2 dark:border-amber-800 dark:bg-black/20"
          >
            <span className="font-mono text-xs">
              {layer.bin_id} · {layer.qty_ea} ea
              {layer.lot_no ? ` · lot ${layer.lot_no}` : ''}
            </span>
            <BigButton
              type="button"
              variant="secondary"
              className="min-h-9 text-xs"
              disabled={movingId === layer.id}
              onClick={() => {
                void (async () => {
                  setMovingId(layer.id);
                  try {
                    const r = await promoteStagingLayer({
                      layerId: layer.id,
                      toBinId: targetBinId,
                      qtyEa: Number(layer.qty_ea),
                      userId,
                      userName,
                    });
                    if (!r.success) {
                      toast.error(r.reason ?? 'Move failed');
                      return;
                    }
                    toast.success(`Moved ${r.qty_ea ?? layer.qty_ea} ea to ${targetBinId}`);
                    void qc.invalidateQueries({ queryKey: ['stagingLayers', busyCode] });
                  } catch {
                    toast.error('Move failed');
                  } finally {
                    setMovingId(null);
                  }
                })();
              }}
            >
              Move all here
            </BigButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
