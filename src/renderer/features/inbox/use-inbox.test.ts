import { describe, expect, it } from 'vitest';
import { relativeTime, usageLabel } from './use-inbox';

describe('usageLabel', () => {
  it('写次数与 token；有价目才写花费', () => {
    expect(usageLabel(null)).toBe('本月还没有调用模型');
    expect(usageLabel({ month: '2026-10', runs: 3, input: 30000, output: 4000, cost: 0 })).toBe(
      '本月提取 3 次 · 约 3.4 万 token',
    );
    expect(usageLabel({ month: '2026-10', runs: 1, input: 900, output: 100, cost: 0.004 })).toBe(
      '本月提取 1 次 · 约 1000 token · 约 $0.004',
    );
  });
});

describe('relativeTime', () => {
  it('刚刚 / 分钟 / 小时 / 从未', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    expect(relativeTime(null, now)).toBe('从未');
    expect(relativeTime('2026-10-31T11:59:30Z', now)).toBe('刚刚');
    expect(relativeTime('2026-10-31T11:48:00Z', now)).toBe('12 分钟前');
    expect(relativeTime('2026-10-31T09:00:00Z', now)).toBe('3 小时前');
  });
});
