<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';

import StatBlock from '@/components/StatBlock.vue';
import { fetchPlayerStats } from '@/services/stats';
import type { NormalizedPlayerStats, StatsPlatform } from '@/types/stats';
import { isStatsPlatform } from '@/types/stats';
import { toAppError } from '@/types/errors';
import { formatDecimal, formatPercent, formatRelativeTime } from '@/utils/format';

type LoadState = 'loading' | 'success' | 'error';

const state = ref<LoadState>('loading');
const stats = ref<NormalizedPlayerStats | null>(null);
const loadedAt = ref<number | null>(null);
const errorCode = ref('');
const isFromCache = ref(false);

const query = ref<{ nickname: string; platform: StatsPlatform }>({
  nickname: '',
  platform: 'pc',
});

const platformLabel = computed(() => query.value.platform.toUpperCase());
const rankedMatches = computed(() => stats.value?.ranked?.matches ?? null);
const casualMatches = computed(() => stats.value?.casual ?? null);

function readParam(options: unknown, key: string): string | null {
  if (typeof options !== 'object' || options === null) {
    return null;
  }
  const value = (options as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

async function loadStats() {
  state.value = 'loading';
  try {
    const result = await fetchPlayerStats(query.value.nickname, query.value.platform);
    stats.value = result.stats;
    isFromCache.value = result.fromCache;
    loadedAt.value = Date.now();
    state.value = 'success';
  } catch (error) {
    const appError = toAppError(error);
    errorCode.value = appError.code;
    state.value = 'error';
  }
}

function retry() {
  void loadStats();
}

onLoad((options) => {
  const nickname = readParam(options, 'nickname') ?? '';
  const platformParam = readParam(options, 'platform');
  query.value = {
    nickname,
    platform: isStatsPlatform(platformParam) ? platformParam : 'pc',
  };
  void loadStats();
});
</script>

<template>
  <view class="page">
    <view v-if="state === 'loading'" class="panel">
      <text class="panel__hint">正在查询 {{ query.nickname }}（{{ platformLabel }}）…</text>
    </view>

    <view v-else-if="state === 'error'" class="panel panel--error">
      <text class="panel__title">查询失败</text>
      <text v-if="errorCode === 'E_UPSTREAM_NOT_CONFIGURED'" class="panel__hint">
        上游数据源尚未接入：完成育碧数据源适配与凭据配置后即可开放查询。
      </text>
      <text v-else class="panel__hint">
        {{ query.nickname }}（{{ platformLabel }}）暂时无法查询，请稍后再试。
      </text>
      <text class="panel__code">错误码：{{ errorCode }}</text>
      <button class="panel__retry" @tap="retry">重新查询</button>
    </view>

    <template v-else-if="stats !== null">
      <view class="identity">
        <view class="identity__avatar">
          <text>{{ stats.identity.nickname.slice(0, 2).toUpperCase() }}</text>
        </view>
        <view class="identity__meta">
          <text class="identity__name">{{ stats.identity.nickname }}</text>
          <text class="identity__sub">
            {{ platformLabel }}
            <template v-if="stats.identity.level !== null">
              · 等级 {{ stats.identity.level }}
            </template>
          </text>
        </view>
      </view>

      <view class="card">
        <view class="card__header">
          <text class="card__title">排位 · 当前赛季</text>
          <text class="card__tag">
            {{ stats.ranked?.season.name ?? '未知赛季' }}
          </text>
        </view>
        <template v-if="stats.ranked !== null">
          <view class="card__row">
            <StatBlock label="段位" :value="stats.ranked.rank.name" />
            <StatBlock
              label="RP（当前 / 最高）"
              :value="
                stats.ranked.rp.current === null
                  ? null
                  : `${stats.ranked.rp.current} / ${stats.ranked.rp.max ?? '—'}`
              "
            />
          </view>
          <view class="card__row">
            <StatBlock
              label="MMR（当前 / 峰值）"
              :value="
                stats.ranked.mmr.current === null
                  ? null
                  : `${stats.ranked.mmr.current} / ${stats.ranked.mmr.peak ?? '—'}`
              "
            />
            <StatBlock label="胜率" :value="formatPercent(rankedMatches?.winRate ?? null)" />
          </view>
          <view class="card__row">
            <StatBlock
              label="胜 / 负"
              :value="
                rankedMatches === null
                  ? null
                  : `${rankedMatches.wins ?? '—'} / ${rankedMatches.losses ?? '—'}`
              "
            />
            <StatBlock label="K/D" :value="formatDecimal(rankedMatches?.kd ?? null)" />
          </view>
        </template>
        <text v-else class="card__empty">当前赛季排位数据未知</text>
      </view>

      <view class="card">
        <view class="card__header">
          <text class="card__title">快速匹配</text>
        </view>
        <template v-if="casualMatches !== null">
          <view class="card__row">
            <StatBlock label="胜率" :value="formatPercent(casualMatches.winRate)" />
            <StatBlock label="K/D" :value="formatDecimal(casualMatches.kd)" />
          </view>
          <view class="card__row">
            <StatBlock
              label="胜 / 负"
              :value="`${casualMatches.wins ?? '—'} / ${casualMatches.losses ?? '—'}`"
            />
            <StatBlock
              label="击杀 / 死亡"
              :value="`${casualMatches.kills ?? '—'} / ${casualMatches.deaths ?? '—'}`"
            />
          </view>
        </template>
        <text v-else class="card__empty">快速匹配数据未知</text>
      </view>

      <view class="footer">
        <text class="footer__text">
          数据更新于 {{ formatRelativeTime(loadedAt, Date.now()) }}
          {{ isFromCache ? '· 来自缓存' : '' }}
        </text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.page {
  display: flex;
  min-height: 100vh;
  padding: 32rpx;
  flex-direction: column;
  gap: 24rpx;
}

.panel {
  display: flex;
  padding: 48rpx 32rpx;
  flex-direction: column;
  gap: 16rpx;
  align-items: center;
  border: 1rpx solid $r6-border;
  border-radius: 20rpx;
  background-color: $r6-surface;
}

.panel--error {
  border-color: rgba(248, 113, 113, 0.4);
}

.panel__title {
  font-size: 32rpx;
  font-weight: 600;
  color: $r6-text-primary;
}

.panel__hint {
  font-size: 26rpx;
  color: $r6-text-secondary;
  text-align: center;
}

.panel__code {
  font-size: 22rpx;
  color: $r6-danger;
}

.panel__retry {
  width: 320rpx;
  height: 80rpx;
  border-radius: 12rpx;
  background-color: $r6-accent;
  color: #16181d;
  font-size: 28rpx;
}

.identity {
  display: flex;
  gap: 24rpx;
  align-items: center;
  padding: 32rpx;
  border: 1rpx solid $r6-border;
  border-radius: 20rpx;
  background-color: $r6-surface;
}

.identity__avatar {
  display: flex;
  width: 112rpx;
  height: 112rpx;
  align-items: center;
  justify-content: center;
  border-radius: 56rpx;
  background-color: $r6-surface-raised;
  font-size: 40rpx;
  font-weight: 700;
  color: $r6-accent;
}

.identity__meta {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.identity__name {
  font-size: 36rpx;
  font-weight: 700;
  color: $r6-text-primary;
}

.identity__sub {
  font-size: 24rpx;
  color: $r6-text-secondary;
}

.card {
  display: flex;
  padding: 32rpx;
  flex-direction: column;
  gap: 24rpx;
  border: 1rpx solid $r6-border;
  border-radius: 20rpx;
  background-color: $r6-surface;
}

.card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card__title {
  font-size: 30rpx;
  font-weight: 600;
  color: $r6-text-primary;
}

.card__tag {
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background-color: $r6-surface-raised;
  font-size: 22rpx;
  color: $r6-accent;
}

.card__row {
  display: flex;
  gap: 24rpx;
}

.card__empty {
  font-size: 26rpx;
  color: $r6-text-secondary;
}

.footer {
  display: flex;
  justify-content: center;
  padding-bottom: 24rpx;
}

.footer__text {
  font-size: 22rpx;
  color: $r6-text-secondary;
}
</style>
