import { describe, expect, it } from 'vitest';

import { formatDashValue, formatDecimal, formatPercent, formatRelativeTime } from '../format';

describe('formatDashValue', () => {
  it('null / undefined / 空串显示占位符，不渲染成 0', () => {
    expect(formatDashValue(null)).toBe('—');
    expect(formatDashValue(undefined)).toBe('—');
    expect(formatDashValue('')).toBe('—');
    expect(formatDashValue('   ')).toBe('—');
  });

  it('真实数值（含 0）与文本原样保留', () => {
    expect(formatDashValue(0)).toBe('0');
    expect(formatDashValue(4321)).toBe('4321');
    expect(formatDashValue('Champion')).toBe('Champion');
  });
});

describe('formatPercent', () => {
  it('比率转百分比并保留一位小数', () => {
    expect(formatPercent(0.6)).toBe('60.0%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(2 / 3)).toBe('66.7%');
  });

  it('未知比率为占位符', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
  });
});

describe('formatDecimal', () => {
  it('保留两位小数，未知为占位符', () => {
    expect(formatDecimal(1.25)).toBe('1.25');
    expect(formatDecimal(2)).toBe('2.00');
    expect(formatDecimal(null)).toBe('—');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');

  it('一分钟内显示“刚刚”', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('刚刚');
  });

  it('按分钟与小时聚合', () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 小时前');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2 天前');
  });

  it('未知与未来时间戳显示占位符', () => {
    expect(formatRelativeTime(null, now)).toBe('—');
    expect(formatRelativeTime(now + 60_000, now)).toBe('—');
  });
});
