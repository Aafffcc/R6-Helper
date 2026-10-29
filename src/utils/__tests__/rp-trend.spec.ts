import { describe, expect, it } from 'vitest';

import type { RpHistoryPoint } from '@/types/stats';
import { aggregateRpPointsByDay, deriveRankBoundaries, formatRpDayLabel } from '../rpTrend';

function point(
  timestamp: number | null,
  rp: number | null,
  rank: string | null = null,
): RpHistoryPoint {
  return { timestamp, rp, rank };
}

describe('aggregateRpPointsByDay', () => {
  it('同一天保留时间戳最新的快照', () => {
    const points = [
      point(Date.parse('2026-10-28T13:00:00'), 1650),
      point(Date.parse('2026-10-28T15:30:00'), 1690),
      point(Date.parse('2026-10-28T21:00:00'), 1720),
    ];
    expect(aggregateRpPointsByDay(points)).toEqual([
      point(Date.parse('2026-10-28T21:00:00'), 1720),
    ]);
  });

  it('不同日期各自保留当日最后一点，按日期顺序输出', () => {
    const points = [
      point(Date.parse('2026-10-27T22:00:00'), 1580, 'GOLD I'),
      point(Date.parse('2026-10-27T23:30:00'), 1600, 'GOLD I'),
      point(Date.parse('2026-10-28T11:00:00'), 1620, 'GOLD I'),
      point(Date.parse('2026-10-28T23:00:00'), 1660, 'SILVER III'),
    ];
    const daily = aggregateRpPointsByDay(points);
    expect(daily.map((item) => item.rp)).toEqual([1600, 1660]);
    expect(daily.map((item) => item.rank)).toEqual(['GOLD I', 'SILVER III']);
  });

  it('时间戳缺失的点无法归日，原样保留在末尾', () => {
    const points = [
      point(null, 1700, 'SILVER III'),
      point(Date.parse('2026-10-28T12:00:00'), 1660),
    ];
    expect(aggregateRpPointsByDay(points)).toEqual([
      point(Date.parse('2026-10-28T12:00:00'), 1660),
      point(null, 1700, 'SILVER III'),
    ]);
  });

  it('空输入返回空数组，且聚合幂等', () => {
    expect(aggregateRpPointsByDay([])).toEqual([]);
    const daily = [point(Date.parse('2026-10-28T12:00:00'), 1660)];
    expect(aggregateRpPointsByDay(daily)).toEqual(daily);
  });
});

describe('formatRpDayLabel', () => {
  it('输出 M/D 日标签，未知时间为空串', () => {
    expect(formatRpDayLabel(Date.parse('2026-10-16T15:58:28'))).toBe('10/16');
    expect(formatRpDayLabel(null)).toBe('');
  });
});

describe('deriveRankBoundaries', () => {
  it('相邻段位取观测区间中点为边界，标注进入的段位', () => {
    const points = [
      point(1, 2950, 'GOLD I'),
      point(2, 3000, 'GOLD I'),
      point(3, 3300, 'PLATINUM II'),
    ];
    expect(deriveRankBoundaries(points)).toEqual([
      { rank: 'PLATINUM II', rp: 3150, showLabel: true },
    ]);
  });

  it('单一段位、缺段位或缺 RP 的点不产生边界', () => {
    expect(deriveRankBoundaries([point(1, 2000, 'GOLD I')])).toEqual([]);
    expect(deriveRankBoundaries([point(1, 2000, null), point(2, 2100, null)])).toEqual([]);
  });

  it('缺段位或缺 RP 的点不参与区间统计，有效点照常推导', () => {
    const points = [
      point(1, 3000, 'GOLD I'),
      point(2, null, 'GOLD I'),
      point(3, 3200, null),
      point(4, 3300, 'PLATINUM II'),
    ];
    expect(deriveRankBoundaries(points)).toEqual([
      { rank: 'PLATINUM II', rp: 3150, showLabel: true },
    ]);
  });

  it('段位回升合并观测区间，区间重叠时不推断边界', () => {
    const points = [
      point(1, 3050, 'GOLD I'),
      point(2, 3100, 'GOLD I'),
      point(3, 3150, 'PLATINUM II'),
      point(4, 3200, 'PLATINUM II'),
      point(5, 3180, 'GOLD I'),
    ];
    expect(deriveRankBoundaries(points)).toEqual([]);
  });

  it('相邻边界过近时后者仅画线不画徽标', () => {
    const points = [
      point(1, 0, 'A'),
      point(2, 400, 'A'),
      point(3, 410, 'B'),
      point(4, 450, 'B'),
      point(5, 460, 'C'),
      point(6, 1000, 'C'),
    ];
    expect(deriveRankBoundaries(points)).toEqual([
      { rank: 'B', rp: 405, showLabel: true },
      { rank: 'C', rp: 455, showLabel: false },
    ]);
  });
});
