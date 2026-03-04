import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  UploadSimple,
  FileXls,
  CheckCircle,
  Warning,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { Card } from '../../components/shared';
import { BigButton } from '../../components/shared';
import { ProgressBar } from '../../components/shared';
import { useToast } from '../../context/ToastContext';
import { detectFileType, type DetectionResult } from '../../lib/import/fileDetector';
import { importItems, type ImportProgress } from '../../lib/import/itemImporter';
import { importCustomers } from '../../lib/import/customerImporter';
import { importStock } from '../../lib/import/stockImporter';
import { importSalesTargets } from '../../lib/import/salesTargetsImporter';
import { importSalesHistory } from '../../lib/import/salesHistoryImporter';
import { queryClient } from '../../lib/queryClient';
import { ITEMS_QUERY_KEY } from '../../hooks/useItems';

type UploadState = 'idle' | 'detected' | 'uploading' | 'done' | 'error';

const EMPTY_PROGRESS: ImportProgress = {
  processed: 0,
  total: 0,
  newCount: 0,
  updatedCount: 0,
  batchIndex: 0,
  totalBatches: 0,
  failedCount: 0,
};

export default function UploadPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<UploadState>('idle');
  const [fileName, setFileName] = useState('');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [progress, setProgress] = useState<ImportProgress>(EMPTY_PROGRESS);
  const [errorMsg, setErrorMsg] = useState('');
  const [debugRows, setDebugRows] = useState<unknown[][] | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setFileName(file.name);
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const first10 = data.slice(0, 10);
      setDebugRows(first10);
      console.log('[Upload] First 10 rows of', file.name);
      first10.forEach((row, i) => console.log(`  row ${i}:`, row));
      const result = detectFileType(wb);
      setWorkbook(wb);
      setDetection(result);
      if (result.type === 'unknown') {
        setState('error');
        setErrorMsg('Could not identify this file. Expected a Price List, Customer List, Stock file, or Sales Plan.');
      } else {
        setState('detected');
      }
    } catch {
      setState('error');
      setErrorMsg('Failed to read the file. Please check the format.');
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!workbook || !detection) return;
    setState('uploading');
    const totalRows = detection.type === 'sales_plan' ? 1 : detection.rowCount;
    const totalBatches = detection.type === 'sales_plan' ? 1 : Math.ceil(detection.rowCount / 500) || 1;
    setProgress({
      ...EMPTY_PROGRESS,
      total: totalRows,
      batchIndex: 0,
      totalBatches,
    });
    try {
      let result: ImportProgress;
      if (detection.type === 'items_price') {
        result = await importItems(workbook, fileName, detection.headerRowIndex, setProgress);
      } else if (detection.type === 'items_stock') {
        result = await importStock(workbook, fileName, detection.headerRowIndex, setProgress);
      } else if (detection.type === 'sales_plan') {
        result = await importSalesTargets(workbook, fileName, setProgress);
      } else if (detection.type === 'sales_history') {
        result = await importSalesHistory(workbook, fileName, setProgress);
      } else {
        result = await importCustomers(workbook, fileName, setProgress);
      }
      setProgress(result);
      setState('done');
      // Invalidate items cache so New Order / search see updated list after item or stock import
      if (detection.type === 'items_price' || detection.type === 'items_stock') {
        void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
      }
      if (result.failedCount > 0) {
        toast.info(
          `Import finished. ${result.processed.toLocaleString()} ${detection.type === 'sales_plan' ? 'targets' : 'rows'} imported successfully, ${result.failedCount.toLocaleString()} failed.`,
        );
      } else {
        toast.success(
          detection.type === 'sales_plan'
            ? `Import complete! ${result.processed.toLocaleString()} targets imported.`
            : `Import complete! ${result.processed.toLocaleString()} rows imported (${result.newCount} new, ${result.updatedCount} updated).`,
        );
      }
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Import failed');
      toast.error('Import failed');
    }
  }, [workbook, detection, fileName, toast]);

  const handleReset = useCallback(() => {
    setState('idle');
    setFileName('');
    setDetection(null);
    setWorkbook(null);
    setProgress(EMPTY_PROGRESS);
    setErrorMsg('');
    setDebugRows(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="theme-light role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-6 max-w-2xl mx-auto space-y-6">
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="flex items-center gap-2 text-sm text-[var(--content-tertiary)] hover:text-[var(--content-primary)] transition-colors mb-4"
          >
            <ArrowLeft size={18} weight="regular" />
            Back
          </button>
          <h1 className="text-2xl font-bold text-[var(--content-primary)]">Upload Data</h1>
          <p className="text-sm text-[var(--content-tertiary)] mt-1">
            Import Excel files for items, stock, customers, sales targets &amp; sales history
          </p>
        </div>

        {state === 'idle' && (
          <Card className="border-2 border-dashed border-[var(--border-opaque)] text-center py-12">
            <UploadSimple size={48} weight="thin" className="mx-auto mb-4 text-[var(--content-quaternary)]" />
            <p className="text-[var(--content-secondary)] font-medium mb-1">Select an Excel file</p>
            <p className="text-sm text-[var(--content-tertiary)] mb-4">Supports .xlsx, .xls and .csv files</p>
            <BigButton
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              className="max-w-xs mx-auto"
            >
              Choose File
            </BigButton>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </Card>
        )}

        {state === 'detected' && detection && (
          <div className="space-y-4">
            <Card>
              <div className="flex items-start gap-4">
                <div className="shrink-0 p-3 rounded-xl bg-[var(--bg-positive-subtle)]">
                  <FileXls size={28} weight="duotone" className="text-[var(--content-positive)]" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--content-primary)] truncate">{fileName}</p>
                  <p className="text-sm text-[var(--content-accent)] font-medium mt-0.5">
                    {detection.label}
                  </p>
                  <p className="text-sm text-[var(--content-tertiary)] mt-1">
                    {detection.type === 'sales_plan'
                      ? 'Imports from 4WF and 2Wf sheets'
                      : `${detection.rowCount.toLocaleString()} data rows detected`}
                  </p>
                </div>
              </div>
            </Card>
            <div className="flex gap-3">
              <BigButton variant="ghost" onClick={handleReset} className="flex-1">
                Cancel
              </BigButton>
              <BigButton variant="primary" onClick={handleConfirm} className="flex-1">
                Confirm Upload
              </BigButton>
            </div>
            {debugRows != null && (
              <Card className="overflow-x-auto">
                <p className="text-xs font-medium text-[var(--content-tertiary)] mb-2">
                  Debug: first 10 rows (see console for same data)
                </p>
                <pre className="text-xs text-[var(--content-secondary)] whitespace-pre-wrap break-all font-mono">
                  {debugRows.map(row => JSON.stringify(row)).join('\n')}
                </pre>
              </Card>
            )}
          </div>
        )}

        {state === 'uploading' && (
          <Card>
            <p className="font-semibold text-[var(--content-primary)] mb-3">
              {progress.totalBatches > 0
                ? `Uploading batch ${Math.max(1, progress.batchIndex)} of ${progress.totalBatches}...`
                : `Importing ${detection?.label}...`}
            </p>
            <ProgressBar
              segments={[{ value: progress.processed, color: 'green' }]}
              total={progress.total}
              className="mb-3"
            />
            <div className="flex justify-between text-sm text-[var(--content-tertiary)]">
              <span>
                {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} rows
              </span>
              <span>{pct}%</span>
            </div>
          </Card>
        )}

        {state === 'done' && (
          <div className="space-y-4">
            <Card>
              <div className="flex items-start gap-4">
                <div className="shrink-0 p-3 rounded-xl bg-[var(--bg-positive-subtle)]">
                  <CheckCircle size={28} weight="duotone" className="text-[var(--content-positive)]" />
                </div>
                <div>
                  <p className="font-semibold text-[var(--content-primary)]">Import Complete</p>
                  <p className="text-sm text-[var(--content-tertiary)] mt-1">
                    {detection?.type === 'sales_plan'
                      ? `Targets imported: ${progress.processed.toLocaleString()}`
                      : `Total rows successfully imported: ${progress.processed.toLocaleString()}`}
                  </p>
                  {detection?.type !== 'sales_plan' && (
                    <div className="flex gap-4 mt-2 text-sm">
                      <span className="text-[var(--content-positive)] font-medium">
                        {progress.newCount.toLocaleString()} new
                      </span>
                      <span className="text-[var(--content-accent)] font-medium">
                        {progress.updatedCount.toLocaleString()} updated
                      </span>
                      {progress.failedCount > 0 && (
                        <span className="text-[var(--content-negative)] font-medium">
                          {progress.failedCount.toLocaleString()} failed
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
            <BigButton variant="secondary" onClick={handleReset}>
              Upload Another File
            </BigButton>
          </div>
        )}

        {state === 'error' && (
          <div className="space-y-4">
            <Card>
              <div className="flex items-start gap-4">
                <div className="shrink-0 p-3 rounded-xl bg-[var(--bg-negative-subtle)]">
                  <Warning size={28} weight="duotone" className="text-[var(--content-negative)]" />
                </div>
                <div>
                  <p className="font-semibold text-[var(--content-negative)]">Import Failed</p>
                  <p className="text-sm text-[var(--content-tertiary)] mt-1">{errorMsg}</p>
                </div>
              </div>
            </Card>
            {debugRows != null && (
              <Card className="overflow-x-auto">
                <p className="text-xs font-medium text-[var(--content-tertiary)] mb-2">
                  Debug: first 10 rows (see console for same data)
                </p>
                <pre className="text-xs text-[var(--content-secondary)] whitespace-pre-wrap break-all font-mono">
                  {debugRows.map(row => JSON.stringify(row)).join('\n')}
                </pre>
              </Card>
            )}
            <BigButton variant="secondary" onClick={handleReset}>
              Try Again
            </BigButton>
          </div>
        )}
      </div>
    </div>
  );
}
