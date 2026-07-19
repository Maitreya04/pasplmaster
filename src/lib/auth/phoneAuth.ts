import type { StockLocationCode } from '../../types';

export const PASPL_AUTH_EMAIL_DOMAIN = 'paspl.local';
const DEVICE_PROFILE_KEY = 'paspl_device_profile';

export interface DeviceProfile {
  phone: string;
  displayName: string;
}

export function loadDeviceProfile(): DeviceProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DEVICE_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceProfile;
    if (!isValidPhone(parsed.phone) || typeof parsed.displayName !== 'string' || !parsed.displayName.trim()) {
      return null;
    }
    return { phone: normalizePhoneInput(parsed.phone), displayName: parsed.displayName.trim() };
  } catch {
    return null;
  }
}

export function saveDeviceProfile(profile: DeviceProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      DEVICE_PROFILE_KEY,
      JSON.stringify({
        phone: normalizePhoneInput(profile.phone),
        displayName: profile.displayName.trim(),
      }),
    );
  } catch {
    // ignore quota / private mode
  }
}

export function clearDeviceProfile(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DEVICE_PROFILE_KEY);
  } catch {
    // ignore
  }
}

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
    case 'code_consumed':
      return 'Verification code was already used. Start again from Get started.';
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

export type ResetPinResponse =
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

export async function resetUserPin(params: {
  supabaseUrl: string;
  anonKey: string;
  inviteCode: string;
  phone: string;
  pin: string;
}): Promise<ResetPinResponse> {
  const response = await fetch(`${params.supabaseUrl}/functions/v1/reset-user-pin`, {
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

  const payload = (await response.json()) as ResetPinResponse;
  if (!response.ok) {
    return 'error' in payload ? payload : { error: 'reset_failed' };
  }
  if ('error' in payload) {
    return payload;
  }
  return payload;
}

export function resetPinErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'invalid_code':
      return 'Reset code is invalid. Go back and try again.';
    case 'code_expired':
      return 'Reset code expired. Go back and generate a new one.';
    case 'code_consumed':
      return 'Reset code was already used. Go back and generate a new one.';
    case 'phone_mismatch':
      return 'Phone number does not match our records.';
    case 'not_activated':
      return 'This account is not set up yet. Use Get started instead.';
    case 'phone_not_registered':
      return 'No phone on file for this account. Contact admin.';
    case 'pin_must_be_4_to_6_digits':
      return 'PIN must be 4–6 digits.';
    case 'invalid_phone':
      return 'Enter a valid 10-digit mobile number.';
    case 'pin_update_failed':
      return 'Could not update PIN. Try again or contact admin.';
    default:
      return 'PIN reset failed. Please try again.';
  }
}
