import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, DownloadSimple, UsersThree } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { InviteCodeTable } from '../../components/admin/InviteCodeTable';
import {
  buildInviteCsv,
  formatInviteWhatsApp,
  useGenerateAllInviteCodes,
  useGenerateInviteCode,
  useUserActivationStatus,
} from '../../hooks/useUserActivationStatus';

export default function UserManagementPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const { data: rows = [], isLoading, error } = useUserActivationStatus();
  const generateOne = useGenerateInviteCode(userId);
  const generateAll = useGenerateAllInviteCodes(userId);
  const [generatingUserId, setGeneratingUserId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const pendingCount = useMemo(
    () => rows.filter((row) => !row.auth_id && row.role !== 'admin').length,
    [rows],
  );

  const pendingWithCodes = useMemo(
    () => rows.filter((row) => !row.auth_id && row.invite_code),
    [rows],
  );

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2500);
  };

  const handleGenerateOne = async (targetUserId: number) => {
    setGeneratingUserId(targetUserId);
    try {
      const result = await generateOne.mutateAsync(targetUserId);
      showToast(`Code for ${result.full_name}: ${result.invite_code}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate code');
    } finally {
      setGeneratingUserId(null);
    }
  };

  const handleGenerateAll = async () => {
    try {
      const result = await generateAll.mutateAsync();
      showToast(`Generated ${result.count ?? 0} invite codes`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate codes');
    }
  };

  const handleCopyWhatsApp = async () => {
    const text = pendingWithCodes.map(formatInviteWhatsApp).join('\n\n');
    if (!text) {
      showToast('No pending codes to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied WhatsApp messages');
    } catch {
      showToast('Could not copy to clipboard');
    }
  };

  const handleDownloadCsv = () => {
    const csv = buildInviteCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `paspl-invite-codes-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="p-2 rounded-xl border border-[var(--border-subtle)] text-[var(--content-secondary)]"
            aria-label="Back to admin"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--content-primary)] flex items-center gap-2">
              <UsersThree size={24} />
              User activation
            </h1>
            <p className="text-sm text-[var(--content-secondary)]">
              Generate invite codes for staff to activate phone + PIN login.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleGenerateAll()}
            disabled={generateAll.isPending || pendingCount === 0}
            className="rounded-xl bg-[var(--content-accent)] text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Generate all codes ({pendingCount} pending)
          </button>
          <button
            type="button"
            onClick={() => void handleCopyWhatsApp()}
            className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm flex items-center gap-2"
          >
            <Copy size={16} />
            Copy for WhatsApp
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm flex items-center gap-2"
          >
            <DownloadSimple size={16} />
            Download CSV
          </button>
        </div>

        {toast && (
          <p className="text-sm text-[var(--content-accent)] bg-[var(--bg-secondary)] rounded-xl px-4 py-2">
            {toast}
          </p>
        )}

        {isLoading && <p className="text-sm text-[var(--content-secondary)]">Loading users…</p>}
        {error && (
          <p className="text-sm text-[var(--content-negative)]">
            Could not load users. Apply migrations 128–130 first.
          </p>
        )}

        {!isLoading && !error && (
          <InviteCodeTable
            rows={rows}
            onGenerateOne={(id) => void handleGenerateOne(id)}
            generatingUserId={generatingUserId}
          />
        )}
      </div>
    </div>
  );
}
