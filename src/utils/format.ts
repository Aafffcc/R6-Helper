/** 展示层格式化：未知数据一律显示占位符，禁止把 null 渲染成 0 或 undefined */

const DASH = '—';

export function formatDashValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return DASH;
  }
  const text = String(value).trim();
  return text === '' ? DASH : text;
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return DASH;
  }
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatDecimal(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return DASH;
  }
  return value.toFixed(digits);
}

/** timestamp 晚于 now（时钟偏移）视为未知，不产出误导性文案 */
export function formatRelativeTime(timestamp: number | null | undefined, now: number): string {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) {
    return DASH;
  }
  if (timestamp > now) {
    return DASH;
  }
  const diffMinutes = Math.floor((now - timestamp) / 60000);
  if (diffMinutes < 1) {
    return '刚刚';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }
  return `${Math.floor(diffHours / 24)} 天前`;
}
