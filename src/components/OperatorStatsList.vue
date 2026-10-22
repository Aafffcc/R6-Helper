<script setup lang="ts">
import type { NormalizedOperatorStats } from '@/types/stats';
import { formatDecimal, formatDashValue, formatPercent } from '@/utils/format';

defineProps<{
  operators: NormalizedOperatorStats[];
}>();

/** 上游 side 为 Attacker / Defender 英文口径，展示层转中文，未知原样兜底 */
function sideLabel(side: string | null): string {
  if (side === 'Attacker') {
    return '进攻方';
  }
  if (side === 'Defender') {
    return '防守方';
  }
  return side ?? '定位未知';
}
</script>

<template>
  <view class="operators">
    <view
      v-for="(item, index) in operators"
      :key="`${item.name}-${item.side ?? 'unknown'}-${index}`"
      class="operators__row"
    >
      <view class="operators__head">
        <view class="operators__name-wrap">
          <text class="operators__name">{{ item.name }}</text>
          <text class="operators__side">{{ sideLabel(item.side) }}</text>
        </view>
        <text class="operators__rounds">{{ formatDashValue(item.rounds) }} 回合</text>
      </view>
      <view class="operators__metrics">
        <view class="operators__metric">
          <text class="operators__metric-label">胜率</text>
          <text class="operators__metric-value">{{ formatPercent(item.winRate) }}</text>
        </view>
        <view class="operators__metric">
          <text class="operators__metric-label">K/D</text>
          <text class="operators__metric-value">{{ formatDecimal(item.kd) }}</text>
        </view>
        <view class="operators__metric">
          <text class="operators__metric-label">爆头率</text>
          <text class="operators__metric-value">{{ formatPercent(item.hsPercent) }}</text>
        </view>
        <view class="operators__metric">
          <text class="operators__metric-label">击杀</text>
          <text class="operators__metric-value">
            {{ formatDashValue(item.kills) }} / {{ formatDashValue(item.deaths) }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.operators {
  display: flex;
  flex-direction: column;
}

.operators__row {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 20rpx 0;
  border-bottom: 1rpx solid $r6-border;
}

.operators__row:last-child {
  border-bottom: none;
}

.operators__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.operators__name-wrap {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12rpx;
}

.operators__name {
  overflow: hidden;
  font-size: 26rpx;
  font-weight: 700;
  color: $r6-text-primary;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operators__side {
  flex-shrink: 0;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background-color: $r6-surface-raised;
  font-size: 20rpx;
  color: $r6-accent;
}

.operators__rounds {
  flex-shrink: 0;
  font-size: 22rpx;
  color: $r6-text-secondary;
}

.operators__metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12rpx;
}

.operators__metric {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.operators__metric-label {
  font-size: 20rpx;
  color: $r6-text-secondary;
}

.operators__metric-value {
  font-size: 26rpx;
  font-weight: 600;
  color: $r6-text-primary;
}
</style>
