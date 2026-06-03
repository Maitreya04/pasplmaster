import { describe, expect, it } from 'vitest';
import { orderAllowsSalesLineEdit, salesLineEditHint } from './orderAllowsSalesLineEdit';

const base = {
  salesperson_user_id: 10,
  picker_name: null as string | null,
  workflow_status: 'submitted' as const,
};

describe('orderAllowsSalesLineEdit', () => {
  it('allows owner on submitted', () => {
    expect(orderAllowsSalesLineEdit(base, 10)).toBe(true);
  });

  it('allows owner on approved before picker assignment', () => {
    expect(
      orderAllowsSalesLineEdit({ ...base, workflow_status: 'approved' }, 10),
    ).toBe(true);
  });

  it('blocks after picker assignment', () => {
    expect(
      orderAllowsSalesLineEdit(
        { ...base, workflow_status: 'approved', picker_name: 'Ravi' },
        10,
      ),
    ).toBe(false);
  });

  it('blocks non-owner', () => {
    expect(orderAllowsSalesLineEdit(base, 99)).toBe(false);
  });
});

describe('salesLineEditHint', () => {
  it('explains picker assignment', () => {
    expect(
      salesLineEditHint({ ...base, workflow_status: 'approved', picker_name: 'Ravi' }),
    ).toContain('Ravi');
  });
});
