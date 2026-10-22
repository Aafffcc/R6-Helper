<script setup lang="ts">
import { computed, ref } from 'vue';

import { useToast } from '@wot-ui/ui/components/wd-toast';
import { loadFavorites, removeFavorite, type FavoritePlayer } from '@/services/favorites';
import { loadRecentSearches, saveRecentSearch, type RecentSearch } from '@/services/recent-search';
import { R6_THEME_VARS } from '@/styles/theme';
import { STATS_PLATFORM_OPTIONS, type StatsPlatform } from '@/types/stats';

const toast = useToast();

const nickname = ref('');
const platformIndex = ref(0);
const recentSearches = ref<RecentSearch[]>(loadRecentSearches());
const favorites = ref<FavoritePlayer[]>(loadFavorites());

const platform = computed<StatsPlatform>(
  () => STATS_PLATFORM_OPTIONS[platformIndex.value]?.value ?? 'pc',
);
const isNicknameValid = computed(() => nickname.value.trim().length > 0);

function startQuery(rawNickname: string, rawPlatform: StatsPlatform) {
  const target = rawNickname.trim();
  if (target === '') {
    toast.show('请输入玩家昵称');
    return;
  }
  recentSearches.value = saveRecentSearch({ nickname: target, platform: rawPlatform });
  const query = `nickname=${encodeURIComponent(target)}&platform=${rawPlatform}`;
  uni.navigateTo({ url: `/pages/player/player?${query}` });
}

function onSubmit() {
  startQuery(nickname.value, platform.value);
}

function onPickRecent(item: RecentSearch) {
  nickname.value = item.nickname;
  platformIndex.value = Math.max(
    0,
    STATS_PLATFORM_OPTIONS.findIndex((option) => option.value === item.platform),
  );
  startQuery(item.nickname, item.platform);
}

function onPickFavorite(item: FavoritePlayer) {
  onPickRecent(item);
}

function onRemoveFavorite(item: FavoritePlayer) {
  favorites.value = removeFavorite(item);
}
</script>

<template>
  <wd-config-provider :theme-vars="R6_THEME_VARS">
    <view class="page">
      <view class="hero">
        <text class="hero__title">彩虹六号战绩查询</text>
        <text class="hero__subtitle">输入玩家昵称，查询当前赛季排位表现</text>
      </view>

      <wd-tabs v-model="platformIndex">
        <wd-tab
          v-for="option in STATS_PLATFORM_OPTIONS"
          :key="option.value"
          :title="option.label"
        />
      </wd-tabs>

      <wd-card>
        <wd-input
          v-model="nickname"
          clearable
          placeholder="玩家昵称（Uplay / PSN / Xbox ID）"
          prefix-icon="search-line"
          custom-class="query-input"
          @confirm="onSubmit"
        />
        <wd-button block :disabled="!isNicknameValid" @click="onSubmit">查询战绩</wd-button>
      </wd-card>

      <view v-if="favorites.length > 0" class="section">
        <view class="section__header">
          <text class="section__title">收藏玩家</text>
          <text class="section__count">{{ favorites.length }}</text>
        </view>
        <scroll-view scroll-x class="favorites">
          <view class="favorites__list">
            <wd-tag
              v-for="item in favorites"
              :key="`${item.platform}:${item.nickname}`"
              round
              closable
              type="primary"
              @click="onPickFavorite(item)"
              @close="onRemoveFavorite(item)"
            >
              {{ item.nickname }} · {{ item.platform.toUpperCase() }}
            </wd-tag>
          </view>
        </scroll-view>
      </view>

      <view v-if="recentSearches.length > 0" class="section">
        <view class="section__header">
          <text class="section__title">最近查询</text>
          <text class="section__count">{{ recentSearches.length }}/5</text>
        </view>
        <view class="recent">
          <wd-tag
            v-for="item in recentSearches"
            :key="`${item.platform}:${item.nickname}`"
            round
            plain
            type="primary"
            @click="onPickRecent(item)"
          >
            {{ item.nickname }} · {{ item.platform.toUpperCase() }}
          </wd-tag>
        </view>
      </view>
    </view>
    <wd-toast />
  </wd-config-provider>
</template>

<style lang="scss" scoped>
.page {
  display: flex;
  min-height: 100vh;
  padding: 32rpx;
  flex-direction: column;
  gap: 32rpx;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.hero__title {
  font-size: 44rpx;
  font-weight: 700;
  color: $r6-text-primary;
}

.hero__subtitle {
  font-size: 24rpx;
  color: $r6-text-secondary;
}

.query-input {
  margin-bottom: 24rpx;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.section__header {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.section__title {
  font-size: 28rpx;
  font-weight: 600;
  color: $r6-text-primary;
}

.section__count {
  font-size: 22rpx;
  color: $r6-text-secondary;
}

.favorites {
  width: 100%;
  white-space: nowrap;
}

.favorites__list {
  display: inline-flex;
  gap: 16rpx;
  padding-bottom: 8rpx;
}

.recent {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}
</style>
