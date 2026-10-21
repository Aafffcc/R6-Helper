<script setup lang="ts">
import { ref } from 'vue';

import { loadRecentSearches, saveRecentSearch, type RecentSearch } from '@/services/recent-search';
import { STATS_PLATFORM_OPTIONS, isStatsPlatform, type StatsPlatform } from '@/types/stats';

const nickname = ref('');
const platform = ref<StatsPlatform>('pc');
const recentSearches = ref<RecentSearch[]>(loadRecentSearches());

function selectPlatform(value: string) {
  // picker 事件值按 unknown 接收后再收敛，避免模板事件带出的宽类型绕过校验
  if (isStatsPlatform(value)) {
    platform.value = value;
  }
}

function isNicknameValid(): boolean {
  return nickname.value.trim().length > 0;
}

function startQuery(rawNickname: string, rawPlatform: StatsPlatform) {
  const target = rawNickname.trim();
  if (target === '') {
    uni.showToast({ title: '请输入玩家昵称', icon: 'none' });
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
  platform.value = item.platform;
  startQuery(item.nickname, item.platform);
}
</script>

<template>
  <view class="page">
    <view class="hero">
      <text class="hero__title">彩虹六号战绩查询</text>
      <text class="hero__subtitle">输入玩家昵称，查询当前赛季排位表现</text>
    </view>

    <view class="query-card">
      <input
        v-model="nickname"
        class="query-card__input"
        placeholder="玩家昵称（Uplay / PSN / Xbox ID）"
        placeholder-class="query-card__placeholder"
        confirm-type="search"
        @confirm="onSubmit"
      />
      <view class="query-card__platforms">
        <view
          v-for="option in STATS_PLATFORM_OPTIONS"
          :key="option.value"
          class="query-card__platform"
          :class="{ 'query-card__platform--active': platform === option.value }"
          @tap="selectPlatform(option.value)"
        >
          <text>{{ option.label }}</text>
        </view>
      </view>
      <button class="query-card__submit" :disabled="!isNicknameValid()" @tap="onSubmit">
        查询战绩
      </button>
    </view>

    <view v-if="recentSearches.length > 0" class="recent">
      <text class="recent__title">最近查询</text>
      <view class="recent__list">
        <view
          v-for="item in recentSearches"
          :key="`${item.platform}:${item.nickname}`"
          class="recent__item"
          @tap="onPickRecent(item)"
        >
          <text class="recent__item-text">{{ item.nickname }}</text>
          <text class="recent__item-platform">{{ item.platform.toUpperCase() }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  display: flex;
  min-height: 100vh;
  padding: 32rpx;
  flex-direction: column;
  gap: 40rpx;
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

.query-card {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  padding: 32rpx;
  border: 1rpx solid $r6-border;
  border-radius: 20rpx;
  background-color: $r6-surface;
}

.query-card__input {
  height: 88rpx;
  padding: 0 24rpx;
  border: 1rpx solid $r6-border;
  border-radius: 12rpx;
  background-color: $r6-bg;
  color: $r6-text-primary;
}

.query-card__placeholder {
  color: $r6-text-secondary;
}

.query-card__platforms {
  display: flex;
  gap: 16rpx;
}

.query-card__platform {
  display: flex;
  flex: 1;
  height: 72rpx;
  align-items: center;
  justify-content: center;
  border: 1rpx solid $r6-border;
  border-radius: 12rpx;
  background-color: $r6-bg;
  color: $r6-text-secondary;
}

.query-card__platform--active {
  border-color: $r6-accent;
  color: $r6-accent;
}

.query-card__submit {
  height: 88rpx;
  border-radius: 12rpx;
  background-color: $r6-accent;
  color: #16181d;
  font-size: 30rpx;
  font-weight: 600;

  &[disabled] {
    opacity: 0.4;
  }
}

.recent {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.recent__title {
  font-size: 26rpx;
  color: $r6-text-secondary;
}

.recent__list {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.recent__item {
  display: flex;
  gap: 12rpx;
  padding: 14rpx 24rpx;
  align-items: center;
  border: 1rpx solid $r6-border;
  border-radius: 999rpx;
  background-color: $r6-surface;
}

.recent__item-text {
  font-size: 26rpx;
  color: $r6-text-primary;
}

.recent__item-platform {
  font-size: 20rpx;
  color: $r6-text-secondary;
}
</style>
