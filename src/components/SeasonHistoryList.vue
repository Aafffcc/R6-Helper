<script setup lang="ts">
import type { NormalizedSeasonRecord } from '@/types/stats';
import { formatDashValue, formatDecimal, formatPercent } from '@/utils/format';

defineProps<{
  seasons: NormalizedSeasonRecord[];
}>();

function seasonLabel(season: NormalizedSeasonRecord): string {
  return season.seasonId ?? (season.seasonNumber !== null ? `S${season.seasonNumber}` : '未知赛季');
}

function matchCount(season: NormalizedSeasonRecord): number | null {
  const wins = season.matches.wins;
  const losses = season.matches.losses;
  if (wins === null && losses === null) {
    return null;
  }
  return (wins ?? 0) + (losses ?? 0);
}
</script>

<template>
  <view class="seasons">
    <view
      v-for="(season, index) in seasons"
      :key="season.seasonId ?? `${season.seasonNumber ?? 'unknown'}-${index}`"
      class="seasons__row"
    >
      <view class="seasons__head">
        <view class="seasons__label-wrap">
          <text class="seasons__id">{{ seasonLabel(season) }}</text>
          <text v-if="season.seasonName !== null" class="seasons__name">
            {{ season.seasonName }}
          </text>
        </view>
        <text v-if="season.finalRankName !== null" class="seasons__rank">
          {{ season.finalRankName }}
        </text>
      </view>
      <view class="seasons__rp">
        <text>结算 {{ formatDashValue(season.finalRp) }} RP</text>
        <text>最高 {{ formatDashValue(season.maxRp) }} RP</text>
      </view>
      <view class="seasons__metrics">
        <view class="seasons__metric">
          <text class="seasons__metric-label">场次</text>
          <text class="seasons__metric-value">{{ formatDashValue(matchCount(season)) }}</text>
        </view>
        <view class="seasons__metric">
          <text class="seasons__metric-label">胜率</text>
          <text class="seasons__metric-value">{{ formatPercent(season.matches.winRate, 0) }}</text>
        </view>
        <view class="seasons__metric">
          <text class="seasons__metric-label">K/D</text>
          <text class="seasons__metric-value">{{ formatDecimal(season.matches.kd) }}</text>
        </view>
        <view class="seasons__metric">
          <text class="seasons__metric-label">爆头率</text>
          <text class="seasons__metric-value">{{
            formatPercent(season.matches.hsPercent, 0)
          }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.seasons {
  display: flex;
  flex-direction: column;
}

.seasons__row {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 20rpx 0;
  border-bottom: 1rpx solid $r6-border;
}

.seasons__row:last-child {
  border-bottom: none;
}

.seasons__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.seasons__label-wrap {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12rpx;
}

.seasons__id {
  flex-shrink: 0;
  font-size: 26rpx;
  font-weight: 700;
  color: $r6-accent;
}

.seasons__name {
  overflow: hidden;
  font-size: 24rpx;
  color: $r6-text-primary;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seasons__rank {
  flex-shrink: 0;
  font-size: 24rpx;
  font-weight: 600;
  color: $r6-text-primary;
}

.seasons__rp {
  display: flex;
  gap: 24rpx;
  font-size: 22rpx;
  color: $r6-text-secondary;
}

.seasons__metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12rpx;
}

.seasons__metric {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.seasons__metric-label {
  font-size: 20rpx;
  color: $r6-text-secondary;
}

.seasons__metric-value {
  font-size: 26rpx;
  font-weight: 600;
  color: $r6-text-primary;
}
</style>
