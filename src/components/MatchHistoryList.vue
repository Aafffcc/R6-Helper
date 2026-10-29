<script setup lang="ts">
import type { NormalizedMatchSummary } from '@/types/stats';
import { formatDashValue, formatRelativeTime } from '@/utils/format';

defineProps<{
  matches: NormalizedMatchSummary[];
}>();

const MODE_LABELS: Readonly<Record<string, string>> = {
  ranked: '排位',
  unranked: '非排位',
  casual: '快速',
  other: '其他',
};

function modeLabel(match: NormalizedMatchSummary): string {
  return match.mode === null ? '未知模式' : (MODE_LABELS[match.mode] ?? '其他');
}

function barClass(match: NormalizedMatchSummary): string {
  if (match.result === 'win') {
    return 'matches__bar--win';
  }
  if (match.result === 'loss') {
    return 'matches__bar--loss';
  }
  return 'matches__bar--unknown';
}

function scoreText(match: NormalizedMatchSummary): string {
  if (match.roundsWon === null && match.roundsLost === null) {
    return '比分 —';
  }
  return `比分 ${formatDashValue(match.roundsWon)} : ${formatDashValue(match.roundsLost)}`;
}

function kdText(match: NormalizedMatchSummary): string {
  return `K/D ${formatDashValue(match.kills)} / ${formatDashValue(match.deaths)}`;
}

function rpClass(match: NormalizedMatchSummary): string {
  if (match.rpChange === null) {
    return '';
  }
  if (match.rpChange > 0) {
    return 'matches__rp--gain';
  }
  return match.rpChange < 0 ? 'matches__rp--loss' : 'matches__rp--flat';
}

function rpText(match: NormalizedMatchSummary): string {
  if (match.rpChange === null) {
    return '';
  }
  const sign = match.rpChange > 0 ? '+' : '';
  return `${sign}${match.rpChange} RP`;
}
</script>

<template>
  <view class="matches">
    <view v-for="match in matches" :key="match.id" class="matches__row">
      <view class="matches__bar" :class="barClass(match)" />
      <view class="matches__body">
        <view class="matches__head">
          <text class="matches__map">{{ match.map ?? '未知地图' }}</text>
          <text class="matches__mode">{{ modeLabel(match) }}</text>
          <text v-if="match.rpChange !== null" class="matches__rp" :class="rpClass(match)">
            {{ rpText(match) }}
          </text>
        </view>
        <view class="matches__meta">
          <text class="matches__score">{{ scoreText(match) }}</text>
          <text class="matches__kd">{{ kdText(match) }}</text>
          <text class="matches__time">
            {{ formatRelativeTime(match.playedAt, Date.now()) }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.matches {
  display: flex;
  flex-direction: column;
}

.matches__row {
  display: flex;
  gap: 16rpx;
  padding: 20rpx 0;
  border-bottom: 1rpx solid $r6-border;
}

.matches__row:last-child {
  border-bottom: none;
}

.matches__bar {
  flex-shrink: 0;
  width: 6rpx;
  border-radius: 3rpx;
}

.matches__bar--win {
  background-color: $r6-success;
}

.matches__bar--loss {
  background-color: $r6-danger;
}

.matches__bar--unknown {
  background-color: $r6-border;
}

.matches__body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 8rpx;
}

.matches__head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.matches__map {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  font-size: 26rpx;
  font-weight: 700;
  color: $r6-text-primary;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.matches__mode {
  flex-shrink: 0;
  font-size: 20rpx;
  color: $r6-text-secondary;
}

.matches__rp {
  flex-shrink: 0;
  font-size: 24rpx;
  font-weight: 600;
}

.matches__rp--gain {
  color: $r6-success;
}

.matches__rp--loss {
  color: $r6-danger;
}

.matches__rp--flat {
  color: $r6-text-secondary;
}

.matches__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  font-size: 22rpx;
  color: $r6-text-secondary;
}

.matches__score {
  flex-shrink: 0;
}

.matches__kd {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  text-align: center;
}

.matches__time {
  flex-shrink: 0;
}
</style>
