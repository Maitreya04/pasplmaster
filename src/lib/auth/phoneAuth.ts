import type { StockLocationCode } from '../../types';

export const PASPL_AUTH_EMAIL_DOMAIN = 'paspl.local';

/** Normalize user-entered phone to 10 digits (India mobile). */
export function normalizePhoneInput(value: string): string {
  return value.replace(/\D/g, '').slice(-10);
}

export function phoneToAuthEmail(phone: string): string {
  return `${normalizePhoneInput(phone)}@${PASPL_AUTH_EMAIL_DOMAIN}`;
}

export function isValidPhone(phone: string): boolean {
  return /^\d{10}$/.test(normalizePhoneInput(phone));
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function branchDisplayName(branch: StockLocationCode | string | null | undefined): string {
  if (branch === 'jabalpur') return 'Jabalpur';
  if (branch === 'main_store') return 'Indore';
  return branch ?? 'Unknown';
}

export type ActivateUserResponse =
  | {
      success: true;
      user_id: number;
      full_name: string;
      role: string;
      branch: string | null;
      phone: string;
      message: string;
    }
  | { error: string; detail?: string };

export async function activateUserAccount(params: {
  supabaseUrl: string;
  anonKey: string;
  inviteCode: string;
  phone: string;
  pin: string;
}): Promise<ActivateUserResponse> {
  const response = await fetch(`${params.supabaseUrl}/functions/v1/activate-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.anonKey}`,
      apikey: params.anonKey,
    },
    body: JSON.stringify({
      invite_code: params.inviteCode.trim().toUpperCase(),
      phone: normalizePhoneInput(params.phone),
      pin: params.pin,
    }),
  });

  const payload = (await response.json()) as ActivateUserResponse;
  if (!response.ok) {
    return 'error' in payload ? payload : { error: 'activation_failed' };
  }
  if ('error' in payload) {
    return payload;
  }
  return payload;
}

export type ValidateInviteCodeResult =
  | {
      valid: true;
      user_id: number;
      full_name: string;
      role: string;
      branch: StockLocationCode | null;
    }
  | { valid: false; error: string };

export function inviteCodeErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'invalid_code':
      return 'Invalid verification code. Try again from Get started.';
    case 'already_activated':
      return 'This account is already activated. Sign in with phone + PIN.';
    case 'code_expired':
      return 'Verification code expired. Start again from Get started.';
    case 'phone_already_used':
      return 'This phone number is already registered.';
    case 'pin_must_be_4_to_6_digits':
      return 'PIN must be 4–6 digits.';
    case 'invalid_phone':
      return 'Enter a valid 10-digit mobile number.';
    case 'auth_creation_failed':
      return 'Could not create account. Try again or contact admin.';
    default:
      return 'Activation failed. Please try again.';
  }
}
