<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';

import { useToast } from '@wot-ui/ui/components/wd-toast';
import RpTrendChart from '@/components/RpTrendChart.vue';
import StatBlock from '@/components/StatBlock.vue';
import { isFavorite, toggleFavorite } from '@/services/favorites';
import { fetchPlayerStats } from '@/services/stats';
import { R6_THEME_VARS } from '@/styles/theme';
import type { NormalizedModeStats, NormalizedPlayerStats, StatsPlatform } from '@/types/stats';
import { isStatsPlatform } from '@/types/stats';
import { toAppError } from '@/types/errors';
import { formatDecimal, formatDashValue, formatPercent, formatRelativeTime } from '@/utils/format';

type LoadState = 'loading' | 'success' | 'error';

interface ModeRow {
  label: string;
  stats: NormalizedModeStats | null;
}

const toast = useToast();

const state = ref<LoadState>('loading');
const stats = ref<NormalizedPlayerStats | null>(null);
const loadedAt = ref<number | null>(null);
const errorCode = ref('');
const errorDetail = ref<string | null>(null);
const isFromCache = ref(false);
const avatarFailed = ref(false);
const starred = ref(false);

const query = ref<{ nickname: string; platform: StatsPlatform }>({
  nickname: '',
  platform: 'pc',
});

const platformLabel = computed(() => query.value.platform.toUpperCase());
const ranked = computed(() => stats.value?.ranked ?? null);
const rankedMatches = computed(() => ranked.value?.matches ?? null);
const rpPoints = computed(() =>
  (ranked.value?.rpHistory ?? []).filter((point) => point.rp !== null),
);
const modeRows = computed<ModeRow[]>(() => [
  { label: '排位', stats: rankedMatches.value },
  { label: '快速匹配', stats: stats.value?.casual ?? null },
  { label: '非排位', stats: stats.value?.unranked ?? null },
]);
const identityInitials = computed(() =>
  (stats.value?.identity.nickname ?? '??').slice(0, 2).toUpperCase(),
);

function readParam(options: unknown, key: string): string | null {
  if (typeof options !== 'object' || options === null) {
    return null;
  }
  const value = (options as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function onAvatarError() {
  // 头像加载失败时降级为首字母占位
  avatarFailed.value = true;
}

function onToggleStar() {
  const result = toggleFavorite({
    nickname: query.value.nickname,
    platform: query.value.platform,
  });
  starred.value = result.starred;
  toast.show(result.starred ? '已加入收藏' : '已取消收藏');
}

async function loadStats() {
  state.value = 'loading';
  errorDetail.value = null;
  try {
    const result = await fetchPlayerStats(query.value.nickname, query.value.platform);
    stats.value = result.stats;
    isFromCache.value = result.fromCache;
    loadedAt.value = Date.now();
    avatarFailed.value = false;
    starred.value = isFavorite({
      nickname: query.value.nickname,
      platform: query.value.platform,
    });
    state.value = 'success';
  } catch (error) {
    const appError = toAppError(error);
    errorCode.value = appError.code;
    // 云端 errMsg 原样展示，便于不查服务端日志时定位配置类问题
    errorDetail.value = appError.detail;
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
  <wd-config-provider :theme-vars="R6_THEME_VARS">
    <view class="page">
      <wd-skeleton
        v-if="state === 'loading'"
        theme="paragraph"
        :row-col="[2, 3]"
        animation="gradient"
      />

      <wd-card v-else-if="state === 'error'" custom-class="panel">
        <view class="panel__body">
          <text class="panel__title">查询失败</text>
          <text v-if="errorCode === 'E_UPSTREAM_NOT_CONFIGURED'" class="panel__hint">
            上游数据源尚未就绪：完成 arenyze apiKey 配置后即可开放查询。
          </text>
          <text v-else-if="errorCode === 'E_NOT_FOUND'" class="panel__hint">
            未找到玩家 {{ query.nickname }}（{{ platformLabel }}），请检查昵称与平台。
          </text>
          <text v-else class="panel__hint">
            {{ query.nickname }}（{{ platformLabel }}）暂时无法查询，请稍后再试。
          </text>
          <text class="panel__code">错误码：{{ errorCode }}</text>
          <text v-if="errorDetail !== null" class="panel__detail">{{ errorDetail }}</text>
          <wd-button custom-class="panel__retry" @click="retry">重新查询</wd-button>
        </view>
      </wd-card>

      <template v-else-if="stats !== null">
        <wd-card>
          <view class="identity">
            <wd-avatar
              v-if="stats.identity.avatarUrl !== null && !avatarFailed"
              :src="stats.identity.avatarUrl"
              custom-class="identity__avatar-image"
              @error="onAvatarError"
            />
            <wd-avatar v-else custom-class="identity__avatar">
              {{ identityInitials }}
            </wd-avatar>
            <view class="identity__meta">
              <text class="identity__name">{{ stats.identity.nickname }}</text>
              <text class="identity__sub">
                {{ platformLabel }}
                <template v-if="stats.identity.level !== null">
                  · 等级 {{ stats.identity.level }}
                </template>
              </text>
            </view>
            <view class="identity__star" @tap="onToggleStar">
              <wd-icon
                :name="starred ? 'star-fill' : 'star'"
                size="44rpx"
                :color="starred ? '#ff8c1a' : '#9aa1ac'"
              />
            </view>
          </view>
        </wd-card>

        <wd-card>
          <template #title>
            <view class="card__header">
              <text class="card__title">排位 · 当前赛季</text>
              <text class="card__tag">{{ ranked?.season.name ?? '未知赛季' }}</text>
            </view>
          </template>
          <template v-if="ranked !== null">
            <view class="rank-line">
              <text class="rank-line__rank">{{ ranked.rank.name ?? '未知段位' }}</text>
              <text class="rank-line__points">
                {{ formatDashValue(ranked.rp.current) }} RP
                <template v-if="ranked.rp.max !== null">· 赛季最高 {{ ranked.rp.max }}</template>
              </text>
            </view>
            <view class="card__row">
              <StatBlock label="K/D" :value="formatDecimal(rankedMatches?.kd ?? null)" />
              <StatBlock label="胜率" :value="formatPercent(rankedMatches?.winRate ?? null)" />
              <StatBlock label="爆头率" :value="formatPercent(ranked.hsPercent)" />
            </view>
            <view class="card__row">
              <StatBlock
                label="胜 / 负"
                :value="
                  rankedMatches === null
                    ? null
                    : `${formatDashValue(rankedMatches.wins)} / ${formatDashValue(rankedMatches.losses)}`
                "
              />
              <StatBlock label="RP 最高" :value="formatDashValue(ranked.rp.max)" />
              <StatBlock
                label="MMR（当前 / 峰值）"
                :value="
                  ranked.mmr.current === null && ranked.mmr.peak === null
                    ? null
                    : `${formatDashValue(ranked.mmr.current)} / ${formatDashValue(ranked.mmr.peak)}`
                "
              />
            </view>
          </template>
          <text v-else class="card__empty">当前赛季排位数据未知</text>
        </wd-card>

        <wd-card>
          <template #title>
            <view class="card__header">
              <text class="card__title">RP 趋势</text>
              <text v-if="rpPoints.length > 0" class="card__tag"
                >{{ rpPoints.length }} 个数据点</text
              >
            </view>
          </template>
          <RpTrendChart v-if="rpPoints.length > 0" :points="rpPoints" />
          <wd-empty v-else text="暂无 RP 历史数据" />
        </wd-card>

        <wd-card title="模式对比">
          <view class="modes">
            <view class="modes__head">
              <text>模式</text>
              <text>胜率</text>
              <text>K/D</text>
              <text>胜 / 负</text>
            </view>
            <view v-for="row in modeRows" :key="row.label" class="modes__row">
              <text class="modes__label">{{ row.label }}</text>
              <text>{{ formatPercent(row.stats?.winRate ?? null) }}</text>
              <text>{{ formatDecimal(row.stats?.kd ?? null) }}</text>
              <text>
                {{ formatDashValue(row.stats?.wins ?? null) }} /
                {{ formatDashValue(row.stats?.losses ?? null) }}
              </text>
            </view>
          </view>
        </wd-card>

        <wd-card custom-class="card--disabled">
          <view class="matches-entry">
            <view class="matches-entry__main">
              <text class="card__title">对局记录</text>
              <text class="matches-entry__hint">数据源暂不支持逐场对局查询</text>
            </view>
            <wd-icon name="arrow-right" size="28rpx" color="#555b66" />
          </view>
        </wd-card>

        <view class="footer">
          <text class="footer__text">
            数据更新于 {{ formatRelativeTime(loadedAt, Date.now()) }}
            {{ isFromCache ? '· 来自缓存' : '' }}
          </text>
        </view>
      </template>
    </view>
    <wd-toast />
  </wd-config-provider>
</template>

<style lang="scss" scoped>
.page {
  display: flex;
  min-height: 100vh;
  padding: 24rpx;
  flex-direction: column;
  gap: 20rpx;
}

.panel__body {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  align-items: center;
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

.panel__detail {
  font-size: 22rpx;
  color: $r6-text-secondary;
  text-align: center;
}

.panel__retry {
  width: 320rpx;
  height: 80rpx;
  border-radius: 12rpx;
}

.identity {
  display: flex;
  gap: 24rpx;
  align-items: center;
}

.identity__avatar,
.identity__avatar-image {
  width: 112rpx;
  height: 112rpx;
}

.identity__meta {
  display: flex;
  flex: 1;
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

.identity__star {
  display: flex;
  width: 72rpx;
  height: 72rpx;
  align-items: center;
  justify-content: center;
}

.card__header {
  display: flex;
  flex: 1;
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

.rank-line {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 20rpx 24rpx;
  margin-bottom: 24rpx;
  border: 1rpx solid $r6-border;
  border-radius: 16rpx;
  background-color: $r6-surface-raised;
}

.rank-line__rank {
  font-size: 40rpx;
  font-weight: 700;
  color: $r6-accent;
}

.rank-line__points {
  font-size: 26rpx;
  color: $r6-text-secondary;
}

.modes {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.modes__head,
.modes__row {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr 1.4fr;
  gap: 12rpx;
  align-items: center;
}

.modes__head {
  font-size: 22rpx;
  color: $r6-text-secondary;
}

.modes__row {
  padding: 16rpx 0;
  border-bottom: 1rpx solid $r6-border;
  font-size: 26rpx;
  color: $r6-text-primary;
}

.modes__row:last-child {
  border-bottom: none;
}

.modes__label {
  font-weight: 600;
}

.matches-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.matches-entry__main {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.matches-entry__hint {
  font-size: 22rpx;
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
