import { branchDisplayName } from '../../lib/auth/phoneAuth';
import type { UserActivationRow } from '../../hooks/useUserActivationStatus';

interface InviteCodeTableProps {
  rows: UserActivationRow[];
  onGenerateOne: (userId: number) => void;
  generatingUserId: number | null;
}

export function InviteCodeTable({
  rows,
  onGenerateOne,
  generatingUserId,
}: InviteCodeTableProps): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--border-subtle)]">
      <table className="min-w-full text-sm">
        <thead className="bg-[var(--bg-tertiary)] text-left text-[var(--content-secondary)]">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Branch</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Invite code</th>
            <th className="px-3 py-2 font-medium">Phone</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const activated = Boolean(row.auth_id);
            return (
              <tr key={row.id} className="border-t border-[var(--border-subtle)]">
                <td className="px-3 py-2 font-medium text-[var(--content-primary)]">{row.full_name}</td>
                <td className="px-3 py-2 capitalize">{row.role}</td>
                <td className="px-3 py-2">{branchDisplayName(row.stock_location_code)}</td>
                <td className="px-3 py-2">
                  {activated ? (
                    <span className="text-emerald-600 font-medium">Activated</span>
                  ) : (
                    <span className="text-amber-600 font-medium">Pending</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono">{row.invite_code ?? '—'}</td>
                <td className="px-3 py-2 font-mono">{row.phone ?? '—'}</td>
                <td className="px-3 py-2">
                  {!activated && row.role !== 'admin' && (
                    <button
                      type="button"
                      disabled={generatingUserId === row.id}
                      onClick={() => onGenerateOne(row.id)}
                      className="text-[var(--content-accent)] hover:underline disabled:opacity-50"
                    >
                      {generatingUserId === row.id ? '…' : 'New code'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
