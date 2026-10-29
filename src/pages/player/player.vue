<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';

import { useToast } from '@wot-ui/ui/components/wd-toast';
import MatchHistoryList from '@/components/MatchHistoryList.vue';
import OperatorStatsList from '@/components/OperatorStatsList.vue';
import RpTrendChart from '@/components/RpTrendChart.vue';
import SeasonHistoryList from '@/components/SeasonHistoryList.vue';
import StatBlock from '@/components/StatBlock.vue';
import { isFavorite, toggleFavorite } from '@/services/favorites';
import { fetchPlayerMatches, fetchPlayerOperators, fetchPlayerStats } from '@/services/stats';
import { R6_THEME_VARS } from '@/styles/theme';
import type {
  NormalizedMatchSummary,
  NormalizedModeStats,
  NormalizedOperatorStats,
  NormalizedPlayerStats,
  StatsPlatform,
} from '@/types/stats';
import { isStatsPlatform } from '@/types/stats';
import { toAppError } from '@/types/errors';
import { formatDashValue, formatDecimal, formatPercent, formatRelativeTime } from '@/utils/format';
import { aggregateRpPointsByDay } from '@/utils/rpTrend';

type LoadState = 'loading' | 'success' | 'error';
type OperatorsState = 'loading' | 'success' | 'error';

interface ModeRow {
  label: string;
  stats: NormalizedModeStats | null;
}

// 干员列表先展示出场最多的前 N 名，避免页面过长，支持展开
const OPERATORS_PREVIEW_COUNT = 10;

const toast = useToast();

const state = ref<LoadState>('loading');
const stats = ref<NormalizedPlayerStats | null>(null);
const loadedAt = ref<number | null>(null);
const errorCode = ref('');
const errorDetail = ref<string | null>(null);
const isFromCache = ref(false);
const avatarFailed = ref(false);
const starred = ref(false);

const operatorsState = ref<OperatorsState>('loading');
const operators = ref<NormalizedOperatorStats[]>([]);
const operatorsErrorCode = ref('');
const operatorsErrorDetail = ref<string | null>(null);
const showAllOperators = ref(false);

type MatchesState = 'loading' | 'success' | 'error';

const matchesState = ref<MatchesState>('loading');
const matches = ref<NormalizedMatchSummary[]>([]);
const matchesErrorCode = ref('');
const matchesErrorDetail = ref<string | null>(null);
const matchesNextBefore = ref<number | null>(null);
const isLoadingMoreMatches = ref(false);

const query = ref<{ nickname: string; platform: StatsPlatform }>({
  nickname: '',
  platform: 'pc',
});

const platformLabel = computed(() => query.value.platform.toUpperCase());
const ranked = computed(() => stats.value?.ranked ?? null);
const rankedMatches = computed(() => ranked.value?.matches ?? null);
// RP 趋势按自然日展示：同一天保留当日最后快照，与图表 x 轴粒度同口径
const rpPoints = computed(() =>
  aggregateRpPointsByDay((ranked.value?.rpHistory ?? []).filter((point) => point.rp !== null)),
);
const seasonHistory = computed(() => stats.value?.seasonHistory ?? []);
const modeRows = computed<ModeRow[]>(() => [
  { label: '排位', stats: rankedMatches.value },
  { label: '非排位', stats: stats.value?.unranked ?? null },
  { label: '快速匹配', stats: stats.value?.casual ?? null },
  { label: '活动', stats: stats.value?.event ?? null },
]);
const visibleOperators = computed(() =>
  showAllOperators.value ? operators.value : operators.value.slice(0, OPERATORS_PREVIEW_COUNT),
);
const identityInitials = computed(() =>
  (stats.value?.identity.nickname ?? '??').slice(0, 2).toUpperCase(),
);

function matchCount(row: ModeRow): number | null {
  const statsRow = row.stats;
  if (statsRow === null || (statsRow.wins === null && statsRow.losses === null)) {
    return null;
  }
  return (statsRow.wins ?? 0) + (statsRow.losses ?? 0);
}

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

async function loadStats(): Promise<boolean> {
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
    return true;
  } catch (error) {
    const appError = toAppError(error);
    errorCode.value = appError.code;
    // 云端 errMsg 原样展示，便于不查服务端日志时定位配置类问题
    errorDetail.value = appError.detail;
    state.value = 'error';
    return false;
  }
}

/**
 * 干员统计独立加载：失败或未配置上游都不影响主战绩展示，
 * 卡片内给出占位说明即可。失败原因原样展示（与主查询卡片同一口径），
 * 便于不查云端日志时定位限流、上游配置类问题。
 */
async function loadOperators() {
  operatorsState.value = 'loading';
  operatorsErrorCode.value = '';
  operatorsErrorDetail.value = null;
  try {
    const result = await fetchPlayerOperators(query.value.nickname, query.value.platform);
    operators.value = result.operators;
    operatorsState.value = 'success';
  } catch (error) {
    const appError = toAppError(error);
    operatorsErrorCode.value = appError.code;
    operatorsErrorDetail.value = appError.detail;
    operatorsState.value = 'error';
  }
}

/**
 * 对局记录独立加载（育碧官方上游）：与干员统计同一降级口径，
 * 失败或未配置上游都只影响本卡片，不阻塞主战绩与干员数据展示。
 */
async function loadMatches() {
  matchesState.value = 'loading';
  matchesErrorCode.value = '';
  matchesErrorDetail.value = null;
  try {
    const result = await fetchPlayerMatches(query.value.nickname, query.value.platform);
    matches.value = result.matches;
    matchesNextBefore.value = result.nextBefore;
    matchesState.value = 'success';
  } catch (error) {
    const appError = toAppError(error);
    matchesErrorCode.value = appError.code;
    matchesErrorDetail.value = appError.detail;
    matchesState.value = 'error';
  }
}

/** 加载更多：携带上一页最早已知对局时间作为游标，追加结果按 id 去重 */
async function loadMoreMatches() {
  if (matchesNextBefore.value === null || isLoadingMoreMatches.value) {
    return;
  }
  isLoadingMoreMatches.value = true;
  try {
    const result = await fetchPlayerMatches(
      query.value.nickname,
      query.value.platform,
      matchesNextBefore.value,
    );
    const seen = new Set(matches.value.map((match) => match.id));
    const appended = result.matches.filter((match) => !seen.has(match.id));
    matches.value = [...matches.value, ...appended];
    matchesNextBefore.value = result.nextBefore;
  } catch (error) {
    toast.show(toAppError(error).message);
  } finally {
    isLoadingMoreMatches.value = false;
  }
}

async function retry() {
  if (await loadStats()) {
    await Promise.all([loadOperators(), loadMatches()]);
  }
}

onLoad(async (options) => {
  const nickname = readParam(options, 'nickname') ?? '';
  const platformParam = readParam(options, 'platform');
  query.value = {
    nickname,
    platform: isStatsPlatform(platformParam) ? platformParam : 'pc',
  };
  if (await loadStats()) {
    await Promise.all([loadOperators(), loadMatches()]);
  }
});
</script>

<template>
  <wd-config-provider theme="dark" :theme-vars="R6_THEME_VARS">
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
              <text class="card__title">当前赛季</text>
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
              <!-- 真值判断兼容旧缓存/旧云端数据结构（无 max 字段时为 undefined） -->
              <text v-if="ranked.rank.max" class="rank-line__max-rank">
                赛季最高段位 {{ ranked.rank.max }}
              </text>
            </view>
            <view class="card__row">
              <StatBlock label="K/D" :value="formatDecimal(rankedMatches?.kd ?? null)" />
              <StatBlock label="胜率" :value="formatPercent(rankedMatches?.winRate ?? null)" />
              <StatBlock label="爆头率" :value="formatPercent(ranked.hsPercent)" />
            </view>
            <view class="card__row">
              <StatBlock
                label="场次"
                :value="
                  rankedMatches === null ||
                  (rankedMatches.wins === null && rankedMatches.losses === null)
                    ? null
                    : (rankedMatches.wins ?? 0) + (rankedMatches.losses ?? 0)
                "
              />
              <StatBlock
                label="胜 / 负"
                :value="
                  rankedMatches === null
                    ? null
                    : `${formatDashValue(rankedMatches.wins)} / ${formatDashValue(rankedMatches.losses)}`
                "
              />
              <StatBlock label="RP 最高" :value="formatDashValue(ranked.rp.max)" />
            </view>
          </template>
          <text v-else class="card__empty">当前赛季排位数据未知</text>
        </wd-card>

        <wd-card>
          <template #title>
            <view class="card__header">
              <text class="card__title">RP 趋势</text>
              <text v-if="rpPoints.length > 0" class="card__tag">{{ rpPoints.length }} 天数据</text>
            </view>
          </template>
          <RpTrendChart v-if="rpPoints.length > 0" :points="rpPoints" />
          <text v-else class="card__hint">暂无 RP 历史数据</text>
        </wd-card>

        <wd-card title="模式数据">
          <view class="modes">
            <view class="modes__head">
              <text>模式</text>
              <text>场次</text>
              <text>K/D</text>
              <text>胜率</text>
              <text>爆头率</text>
            </view>
            <view v-for="row in modeRows" :key="row.label" class="modes__row">
              <text class="modes__label">{{ row.label }}</text>
              <text>{{ formatDashValue(matchCount(row)) }}</text>
              <text>{{ formatDecimal(row.stats?.kd ?? null) }}</text>
              <text>{{ formatPercent(row.stats?.winRate ?? null, 0) }}</text>
              <text>{{ formatPercent(row.stats?.hsPercent ?? null, 0) }}</text>
            </view>
          </view>
        </wd-card>

        <wd-card>
          <template #title>
            <view class="card__header">
              <text class="card__title">往赛季数据</text>
              <text v-if="seasonHistory.length > 0" class="card__tag"
                >共 {{ seasonHistory.length }} 个赛季</text
              >
            </view>
          </template>
          <SeasonHistoryList v-if="seasonHistory.length > 0" :seasons="seasonHistory" />
          <text v-else class="card__hint">暂无往赛季排位数据</text>
        </wd-card>

        <wd-card>
          <template #title>
            <view class="card__header">
              <text class="card__title">干员统计</text>
              <!-- 上游 /v2/operators 不带 seasonYear 时返回生涯聚合，标签须与口径一致 -->
              <text class="card__tag">生涯 · 全模式</text>
            </view>
          </template>
          <wd-skeleton
            v-if="operatorsState === 'loading'"
            theme="paragraph"
            :row-col="[3]"
            animation="gradient"
          />
          <view v-else-if="operatorsState === 'error'" class="operators-error">
            <text class="operators-error__hint">干员数据暂时不可用，不影响主战绩查询</text>
            <text v-if="operatorsErrorDetail !== null" class="operators-error__detail">
              {{ operatorsErrorDetail }}
            </text>
            <text class="operators-error__code">错误码：{{ operatorsErrorCode }}</text>
            <text class="card__retry" @tap="loadOperators">重新加载</text>
          </view>
          <text v-else-if="operators.length === 0" class="card__hint">暂无干员统计数据</text>
          <template v-else>
            <OperatorStatsList :operators="visibleOperators" />
            <view
              v-if="operators.length > OPERATORS_PREVIEW_COUNT"
              class="operators-toggle"
              @tap="showAllOperators = !showAllOperators"
            >
              <text class="operators-toggle__text">
                {{ showAllOperators ? '收起' : `展开全部 ${operators.length} 名干员` }}
              </text>
            </view>
          </template>
        </wd-card>

        <wd-card title="地图统计">
          <text class="card__hint">当前数据源暂不提供按地图统计的生涯数据</text>
        </wd-card>

        <wd-card>
          <template #title>
            <view class="card__header">
              <text class="card__title">对局记录</text>
              <text v-if="matches.length > 0" class="card__tag">最近 {{ matches.length }} 场</text>
            </view>
          </template>
          <wd-skeleton
            v-if="matchesState === 'loading'"
            theme="paragraph"
            :row-col="[3]"
            animation="gradient"
          />
          <view v-else-if="matchesState === 'error'" class="operators-error">
            <text class="operators-error__hint">对局数据暂时不可用，不影响主战绩查询</text>
            <text v-if="matchesErrorDetail !== null" class="operators-error__detail">
              {{ matchesErrorDetail }}
            </text>
            <text class="operators-error__code">错误码：{{ matchesErrorCode }}</text>
            <text class="card__retry" @tap="loadMatches">重新加载</text>
          </view>
          <text v-else-if="matches.length === 0" class="card__hint">暂无对局记录</text>
          <template v-else>
            <MatchHistoryList :matches="matches" />
            <view v-if="matchesNextBefore !== null" class="matches-more" @tap="loadMoreMatches">
              <text class="matches-more__text">
                {{ isLoadingMoreMatches ? '加载中…' : '加载更早对局' }}
              </text>
            </view>
          </template>
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
  margin-top: 24rpx;
}

.card__empty {
  font-size: 26rpx;
  color: $r6-text-secondary;
}

/* 紧凑文字占位：替代 wd-empty（其默认大图标在深色主题下视觉突兀） */
.card__hint {
  display: block;
  padding: 32rpx 0;
  font-size: 24rpx;
  color: $r6-text-secondary;
  text-align: center;
}

.card__retry {
  display: block;
  margin-top: 12rpx;
  color: $r6-accent;
}

.rank-line {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 20rpx 24rpx;
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

.rank-line__max-rank {
  font-size: 24rpx;
  color: $r6-accent;
}

.modes {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.modes__head,
.modes__row {
  display: grid;
  grid-template-columns: 1.3fr 0.8fr 0.8fr 0.9fr 0.9fr;
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

.operators-toggle {
  display: flex;
  justify-content: center;
  padding: 20rpx 0 4rpx;
}

.operators-error {
  display: flex;
  padding: 32rpx 0;
  flex-direction: column;
  gap: 8rpx;
  align-items: center;
}

.operators-error__hint {
  font-size: 24rpx;
  color: $r6-text-secondary;
}

.operators-error__detail {
  font-size: 22rpx;
  color: $r6-text-secondary;
  text-align: center;
}

.operators-error__code {
  font-size: 22rpx;
  color: $r6-danger;
}

.operators-toggle__text {
  font-size: 24rpx;
  color: $r6-accent;
}

.matches-more {
  display: flex;
  justify-content: center;
  padding-top: 20rpx;
}

.matches-more__text {
  font-size: 24rpx;
  font-weight: 600;
  color: $r6-accent;
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
