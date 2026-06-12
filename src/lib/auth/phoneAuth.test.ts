import { describe, expect, it } from 'vitest';
import {
  branchDisplayName,
  inviteCodeErrorMessage,
  isValidPhone,
  isValidPin,
  normalizePhoneInput,
  phoneToAuthEmail,
} from './phoneAuth';

describe('phoneAuth', () => {
  it('normalizes phone to last 10 digits', () => {
    expect(normalizePhoneInput('+91 98765 43210')).toBe('9876543210');
  });

  it('builds auth email from phone', () => {
    expect(phoneToAuthEmail('9876543210')).toBe('9876543210@paspl.local');
  });

  it('validates phone and pin', () => {
    expect(isValidPhone('9876543210')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('1234567')).toBe(false);
  });

  it('maps branch labels', () => {
    expect(branchDisplayName('main_store')).toBe('Indore');
    expect(branchDisplayName('jabalpur')).toBe('Jabalpur');
  });

  it('maps invite errors to user messages', () => {
    expect(inviteCodeErrorMessage('code_expired')).toContain('expired');
  });
});
