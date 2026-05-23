import QRCode from 'qrcode';

export interface RackLabelSpec {
  binId: string;
  itemName: string;
  pickCode: string;
  busyCode: number | null;
  forwardPickQty: number | null;
}

const RACK_STRIP_HEIGHT_MM = 30;
const RACK_STRIP_QR_SIZE_MM = 16;

const PRINT_CSS = `
  @page {
    size: A4 portrait;
    margin: 10mm;
  }

  @media print {
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      background: #ffffff !important;
    }

    .a4-label-sheet {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6mm;
    }

    .a4-label-card {
      break-inside: avoid;
      page-break-inside: avoid;
      min-height: 30mm;
      height: 30mm;
      border: 0.25mm solid #cbd5e1 !important;
      box-shadow: none !important;
    }
  }

  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, sans-serif;
    background: #f8fafc;
  }

  .a4-label-sheet {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6mm;
    max-width: 210mm;
    margin: 0 auto;
    padding: 10mm;
  }

  .a4-label-card {
    overflow: hidden;
    background: #ffffff;
    color: #0f172a;
    border: 1px solid #cbd5e1;
    height: ${RACK_STRIP_HEIGHT_MM}mm;
  }

  .rack-strip-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 18mm;
    gap: 2.5mm;
    height: 100%;
    padding: 3mm 3.5mm;
    align-items: stretch;
  }

  .rack-strip-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }

  .rack-strip-code {
    font-variant-ligatures: none;
  }

  .rack-strip-description {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rack-strip-qr-shell {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .rack-strip-qr {
    width: ${RACK_STRIP_QR_SIZE_MM}mm;
    height: ${RACK_STRIP_QR_SIZE_MM}mm;
  }

  .rack-strip-qr svg {
    display: block;
    width: 100%;
    height: 100%;
    shape-rendering: crispEdges;
  }
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function binLocationPayload(label: Pick<RackLabelSpec, 'binId' | 'busyCode' | 'pickCode'>): string {
  return JSON.stringify({
    type: 'BIN',
    rack: label.binId,
    busy_code: label.busyCode,
    sku: label.pickCode,
  });
}

function rackStripCodeStyle(code: string): string {
  const length = code.trim().length;
  if (length <= 10) return 'font-size:9.6mm;letter-spacing:-0.06em;line-height:0.88';
  if (length <= 12) return 'font-size:8.4mm;letter-spacing:-0.055em;line-height:0.88';
  if (length <= 14) return 'font-size:7.6mm;letter-spacing:-0.05em;line-height:0.88';
  if (length <= 17) return 'font-size:6.7mm;letter-spacing:-0.045em;line-height:0.88';
  if (length <= 20) return 'font-size:6.0mm;letter-spacing:-0.04em;line-height:0.88';
  return 'font-size:5.0mm;letter-spacing:-0.03em;line-height:0.84';
}

function renderRackLabelCard(label: RackLabelSpec, qrSvg: string): string {
  const wrapBinCode = label.binId.trim().length > 12;
  const fpqLine =
    label.forwardPickQty != null
      ? `<span style="margin-left:1mm;font-size:3mm;font-weight:600;color:#065f46">· FPQ ${label.forwardPickQty} EA</span>`
      : `<span style="margin-left:1mm;font-size:3mm;font-weight:400;color:#94a3b8">· FPQ not set</span>`;

  return `<article class="a4-label-card">
    <div class="rack-strip-shell">
      <div class="rack-strip-copy">
        <div style="min-width:0">
          <p class="rack-strip-code" style="${rackStripCodeStyle(label.binId)};display:block;min-width:0;font-family:ui-sans-serif,system-ui,sans-serif;font-weight:900;text-transform:uppercase;color:#0f172a;${
            wrapBinCode ? 'white-space:normal;word-break:break-all' : 'white-space:nowrap'
          }">${escapeHtml(label.binId)}</p>
          <p class="rack-strip-description" style="margin-top:1.2mm;font-size:3.6mm;font-weight:600;line-height:1.2;color:#334155">${escapeHtml(label.itemName)}</p>
        </div>
        <p style="font-family:ui-monospace,monospace;font-size:3.5mm;font-weight:700;line-height:1;letter-spacing:0.08em;color:#64748b">
          ${escapeHtml(label.pickCode)}${fpqLine}
        </p>
      </div>
      <div class="rack-strip-qr-shell">
        <div class="rack-strip-qr" aria-label="QR for ${escapeHtml(binLocationPayload(label))}">${qrSvg}</div>
      </div>
    </div>
  </article>`;
}

export function openRackLabelsPrintWindow(): Window | null {
  const w = window.open('about:blank', '_blank');
  if (w) {
    w.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rack labels</title></head><body><p style="font:14px sans-serif;padding:24px;color:#64748b">Preparing rack labels…</p></body></html>',
    );
    w.document.close();
  }
  return w;
}

export async function openRackLabelsPrint(opts: {
  labels: RackLabelSpec[];
  autoPrint?: boolean;
  /** Pass a window opened synchronously from the click handler to avoid popup blockers. */
  targetWindow?: Window | null;
}): Promise<{ labelCount: number; blocked: boolean }> {
  const expanded: RackLabelSpec[] = [];
  for (const label of opts.labels) {
    if (!label.binId.trim()) continue;
    expanded.push(label);
  }

  if (expanded.length === 0) {
    opts.targetWindow?.close();
    return { labelCount: 0, blocked: false };
  }

  const w = opts.targetWindow ?? window.open('about:blank', '_blank');
  if (!w) return { labelCount: 0, blocked: true };

  const qrByPayload = new Map<string, string>();
  const cards: string[] = [];

  for (const label of expanded) {
    const payload = binLocationPayload(label);
    let qrSvg = qrByPayload.get(payload);
    if (!qrSvg) {
      qrSvg = await QRCode.toString(payload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        type: 'svg',
        color: { dark: '#111827', light: '#ffffff' },
      });
      qrSvg = qrSvg.replace('<svg', '<svg shape-rendering="crispEdges"');
      qrByPayload.set(payload, qrSvg);
    }
    cards.push(renderRackLabelCard(label, qrSvg));
  }

  const autoPrint = opts.autoPrint !== false;
  const printScript = autoPrint
    ? '<script>window.onload=function(){window.print();}</script>'
    : `<p style="margin:12px auto;max-width:210mm;font-size:12px;color:#64748b;text-align:center">
        Preview only — use the browser Print button when ready.
      </p>`;

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rack labels</title>
    <style>${PRINT_CSS}</style></head><body>
    <div class="a4-label-sheet">${cards.join('')}</div>
    ${printScript}
  </body></html>`);
  w.document.close();

  return { labelCount: cards.length, blocked: false };
}
