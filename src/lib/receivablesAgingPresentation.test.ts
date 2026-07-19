import { describe, expect, it } from 'vitest';
import {
  agingBucketForDays,
  agingPresentationForDays,
  agingToneForDays,
  buildCustomerRailGlance,
  formatAgingSnapshotCaption,
} from './receivables';

describe('aging presentation semantics', () => {
  it('maps Busy bill age into the absolute risk ladder', () => {
    expect(agingBucketForDays(0)).toBe('0_30');
    expect(agingBucketForDays(30)).toBe('0_30');
    expect(agingBucketForDays(31)).toBe('31_60');
    expect(agingBucketForDays(60)).toBe('31_60');
    expect(agingBucketForDays(61)).toBe('61_90');
    expect(agingBucketForDays(90)).toBe('61_90');
    expect(agingBucketForDays(91)).toBe('90_plus');
  });

  it('uses meaning words that escalate left to right', () => {
    expect(agingPresentationForDays(12).meaning).toBe('Fresh');
    expect(agingPresentationForDays(45).meaning).toBe('Watch');
    expect(agingPresentationForDays(75).meaning).toBe('Late');
    expect(agingPresentationForDays(120).meaning).toBe('Critical');
  });

  it('keeps tone aligned with meaning', () => {
    expect(agingToneForDays(12)).toBe('ok');
    expect(agingToneForDays(45)).toBe('watch');
    expect(agingToneForDays(75)).toBe('late');
    expect(agingToneForDays(120)).toBe('critical');
  });

  it('summarizes with bill age, never credit terms', () => {
    const caption = formatAgingSnapshotCaption(
      { bill_count: 42, oldest_days: 95, credit_adjustments: 14000 },
      {
        '0_30': { label: '0-30', amount: 45000, count: 18 },
        '31_60': { label: '31-60', amount: 80000, count: 10 },
        '61_90': { label: '61-90', amount: 95000, count: 10 },
        '90_plus': { label: '90+', amount: 65000, count: 4 },
      },
    );

    expect(caption).toBe('42 bills · net of ₹14K credits · ₹1.6L past 60d · oldest 95d');
    expect(caption.toLowerCase()).not.toContain('overdue');
    expect(caption.toLowerCase()).not.toContain('terms');
  });

  it('builds a glanceable rail card for aged accounts without saying overdue', () => {
    const glance = buildCustomerRailGlance({
      summary: {
        total_pending: 285000,
        credit_adjustments: 14000,
        net_outstanding: 271000,
        bill_count: 42,
        oldest_days: 95,
        largest_bill_amount: 65000,
        over_credit_days_amount: null,
        over_credit_days_count: 0,
      },
      buckets: {
        '0_30': { label: '0-30', amount: 45000, count: 18 },
        '31_60': { label: '31-60', amount: 80000, count: 10 },
        '61_90': { label: '61-90', amount: 95000, count: 10 },
        '90_plus': { label: '90+', amount: 65000, count: 4 },
      },
    });

    expect(glance.status).toBe('aged');
    expect(glance.tone).toBe('critical');
    expect(glance.billCount).toBe(42);
    expect(glance.primaryBadge).toEqual({ label: '₹1.6L past 60d', intent: 'negative' });
    expect(glance.secondaryBadge).toEqual({ label: '95d oldest', intent: 'neutral' });
    expect(glance.primaryBadge?.label.toLowerCase()).not.toContain('overdue');
  });

  it('shows Clear when nothing is outstanding', () => {
    const glance = buildCustomerRailGlance({
      summary: {
        total_pending: 0,
        credit_adjustments: 0,
        net_outstanding: 0,
        bill_count: 85,
        oldest_days: null,
        largest_bill_amount: 0,
        over_credit_days_amount: null,
        over_credit_days_count: 0,
      },
      buckets: {
        '0_30': { label: '0-30', amount: 0, count: 0 },
        '31_60': { label: '31-60', amount: 0, count: 0 },
        '61_90': { label: '61-90', amount: 0, count: 0 },
        '90_plus': { label: '90+', amount: 0, count: 0 },
      },
    });

    expect(glance.status).toBe('clear');
    expect(glance.primaryBadge).toEqual({ label: 'Clear', intent: 'positive' });
    expect(glance.secondaryBadge).toBeNull();
  });
});
