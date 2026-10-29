/**
 * RP 趋势图的展示层转换：x 轴按自然日聚合、段位边界推导。
 * 只做纯变换，不改云端归一口径；输入为时间升序的 RP 历史点。
 */
import type { RpHistoryPoint } from '@/types/stats';

function toDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * 以本地自然日聚合：同一天保留时间戳最新的点（当日最后一次 RP 快照），
 * 与战绩平台按日展示的惯例一致。时间戳缺失的点无法归日，原样保留在末尾。
 * 输出按日期首次出现的顺序排列。
 */
export function aggregateRpPointsByDay(points: RpHistoryPoint[]): RpHistoryPoint[] {
  const byDay = new Map<string, RpHistoryPoint>();
  const untimed: RpHistoryPoint[] = [];
  for (const point of points) {
    const timestamp = point.timestamp;
    if (timestamp === null) {
      untimed.push(point);
      continue;
    }
    const key = toDayKey(timestamp);
    const existing = byDay.get(key);
    // 防御乱序输入：保留当日时间戳更大的点，同刻取后写者
    if (existing === undefined || existing.timestamp === null || timestamp >= existing.timestamp) {
      byDay.set(key, point);
    }
  }
  return [...byDay.values(), ...untimed];
}

/** x 轴日标签：M/D；时间戳未知为空串 */
export function formatRpDayLabel(timestamp: number | null): string {
  if (timestamp === null) {
    return '';
  }
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 段位边界：相邻段位观测 RP 区间的中点，图表在该高度画分隔线并标注进入的段位 */
export interface RankBoundary {
  rank: string;
  rp: number;
  /** 相邻边界在图上过于接近时仅画线、不画徽标，避免文字重叠 */
  showLabel: boolean;
}

/** 徽标最小间距按 RP 全跨度的比例近似（图高固定 320rpx，比例即可判断是否拥挤） */
const RANK_LABEL_MIN_GAP_RATIO = 0.08;

/**
 * 从历史点推导段位边界：每个段位名合并其观测 RP 区间，按区间下沿排序，
 * 相邻段位区间不重叠时取中点为边界。区间重叠（升降段数据交织）或段位
 * 少于两个时无法判定边界，不推断、返回空。
 */
export function deriveRankBoundaries(points: RpHistoryPoint[]): RankBoundary[] {
  const ranges = new Map<string, { min: number; max: number }>();
  for (const point of points) {
    if (point.rp === null || point.rank === null) {
      continue;
    }
    const range = ranges.get(point.rank);
    if (range === undefined) {
      ranges.set(point.rank, { min: point.rp, max: point.rp });
      continue;
    }
    range.min = Math.min(range.min, point.rp);
    range.max = Math.max(range.max, point.rp);
  }
  const ordered = [...ranges.entries()].sort((a, b) => a[1].min - b[1].min);
  if (ordered.length < 2) {
    return [];
  }
  const span =
    Math.max(...ordered.map(([, range]) => range.max)) -
    Math.min(...ordered.map(([, range]) => range.min));
  const boundaries: RankBoundary[] = [];
  let lastLabeledRp: number | null = null;
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1][1];
    const rank = ordered[i][0];
    const current = ordered[i][1];
    if (current.min <= previous.max) {
      continue;
    }
    const rp = (previous.max + current.min) / 2;
    const showLabel =
      lastLabeledRp === null || rp - lastLabeledRp >= span * RANK_LABEL_MIN_GAP_RATIO;
    if (showLabel) {
      lastLabeledRp = rp;
    }
    boundaries.push({ rank, rp, showLabel });
  }
  return boundaries;
}
