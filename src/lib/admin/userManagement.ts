import type { StockLocationCode, UserRole } from '../../types';

const PASPL_AUTH_EMAIL_DOMAIN = 'paspl.local';

export type AdminUserAuthAction = 'update_phone' | 'delete_auth_user';

export interface AdminUserAuthResponse {
  success?: boolean;
  skipped?: boolean;
  error?: string;
  detail?: string;
  phone?: string;
  user_id?: number;
  auth_id?: string;
}

export function adminUserManagementErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'unauthorized':
      return 'You are not authorized to manage users.';
    case 'invalid_full_name':
      return 'Name must be 2–50 characters.';
    case 'duplicate_full_name':
      return 'A user with this name already exists.';
    case 'invalid_role':
      return 'Choose a valid role.';
    case 'invalid_branch':
      return 'Choose a valid branch.';
    case 'user_not_found':
      return 'User not found.';
    case 'cannot_edit_admin':
      return 'Admin accounts cannot be edited here.';
    case 'cannot_deactivate_admin':
      return 'Admin accounts cannot be deactivated.';
    case 'cannot_deactivate_self':
      return 'You cannot deactivate your own account.';
    case 'cannot_revoke_self':
      return 'You cannot revoke your own access.';
    case 'cannot_revoke_admin':
      return 'Admin access cannot be revoked.';
    case 'already_deactivated':
      return 'This user is already deactivated.';
    case 'already_active':
      return 'This user is already active.';
    case 'not_activated':
      return 'This user has not activated yet.';
    case 'no_changes':
      return 'No changes to save.';
    case 'phone_already_used':
      return 'This phone number is already registered.';
    case 'invalid_phone':
      return 'Enter a valid 10-digit mobile number.';
    case 'auth_update_failed':
      return 'Could not update login phone. Try again.';
    case 'auth_delete_failed':
      return 'Could not remove login access. Try again.';
    default:
      return error ? error.replaceAll('_', ' ') : 'Something went wrong.';
  }
}

export async function callAdminUserAuth(params: {
  supabaseUrl: string;
  anonKey: string;
  action: AdminUserAuthAction;
  actorUserId: number;
  userId: number;
  phone?: string;
  authId?: string | null;
}): Promise<AdminUserAuthResponse> {
  const response = await fetch(`${params.supabaseUrl}/functions/v1/admin-update-user-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.anonKey}`,
      apikey: params.anonKey,
    },
    body: JSON.stringify({
      action: params.action,
      actor_user_id: params.actorUserId,
      user_id: params.userId,
      phone: params.phone,
      auth_id: params.authId,
    }),
  });

  const payload = (await response.json()) as AdminUserAuthResponse;
  if (!response.ok) {
    return payload.error ? payload : { error: 'request_failed' };
  }
  return payload;
}

export const MANAGEABLE_ROLES: Array<{ value: Exclude<UserRole, 'admin'>; label: string }> = [
  { value: 'sales', label: 'Sales' },
  { value: 'billing', label: 'Billing' },
  { value: 'picking', label: 'Picking' },
];

export const BRANCH_OPTIONS: Array<{ value: StockLocationCode; label: string }> = [
  { value: 'main_store', label: 'Indore' },
  { value: 'jabalpur', label: 'Jabalpur' },
];

export type UserManagementStatus = 'activated' | 'pending' | 'deactivated';

export function getUserManagementStatus(row: {
  auth_id: string | null;
  is_active: boolean;
}): UserManagementStatus {
  if (!row.is_active) return 'deactivated';
  if (row.auth_id) return 'activated';
  return 'pending';
}

export function phoneToAuthEmail(phone: string): string {
  const normalized = phone.replace(/\D/g, '').slice(-10);
  return `${normalized}@${PASPL_AUTH_EMAIL_DOMAIN}`;
}
