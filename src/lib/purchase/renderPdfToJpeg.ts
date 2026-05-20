/**
 * Render PDF pages to JPEG base64 for Gemini OCR (browser only).
 */
export async function renderPdfPagesToJpegBase64(file: File, maxPages = 8): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const version = (pdfjs as { version?: string }).version ?? '4.10.38';
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const n = Math.min(maxPages, pdf.numPages);
  const out: string[] = [];

  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unsupported');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    out.push(base64);
  }

  return out;
}
