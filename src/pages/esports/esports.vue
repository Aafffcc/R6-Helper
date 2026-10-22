<script setup lang="ts">
import { computed, ref } from 'vue';

import { getEsportsEvents, getEsportsMatches, getFeaturedEsportsTeams } from '@/services/esports';
import { R6_THEME_VARS } from '@/styles/theme';
import type { EsportsEvent, EsportsMatch } from '@/types/esports';

type FeedFilter = 'all' | 'upcoming' | 'completed';

const activeFilter = ref<FeedFilter>('all');
const events = getEsportsEvents();
const matches = getEsportsMatches();
const teams = getFeaturedEsportsTeams();
const featuredEvent = computed<EsportsEvent>(() => events[1] ?? events[0]);
const filteredMatches = computed<EsportsMatch[]>(() =>
  activeFilter.value === 'all'
    ? matches
    : matches.filter((match) => match.status === activeFilter.value),
);

function formatMatchTime(value: string): string {
  const date = new Date(value);
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${minutes}`;
}

function statusLabel(status: EsportsMatch['status']): string {
  return status === 'live' ? '进行中' : status === 'completed' ? '已结束' : '即将开始';
}

function eventStatusLabel(status: EsportsEvent['status']): string {
  return status === 'ongoing' ? '进行中' : status === 'completed' ? '已结束' : '即将开始';
}
</script>

<template>
  <wd-config-provider theme="dark" :theme-vars="R6_THEME_VARS">
    <scroll-view scroll-y class="page">
      <view class="masthead">
        <view>
          <text class="eyebrow">R6 ESPORTS</text>
          <text class="title">电竞赛场</text>
          <text class="subtitle">赛程、赛果与战队动态，一页掌握</text>
        </view>
        <view class="season-badge">
          <text class="season-badge__label">当前赛季</text>
          <text class="season-badge__value">2026</text>
        </view>
      </view>

      <view class="notice-bar"
        ><text class="notice-bar__dot"></text
        ><text>Liquipedia 数据接入准备中，当前展示本地演示数据</text></view
      >

      <view class="feature-card">
        <view class="feature-card__topline"
          ><text class="feature-card__kicker">焦点赛事</text
          ><text class="feature-card__tier">{{ featuredEvent.tier }}</text></view
        >
        <text class="feature-card__title">{{ featuredEvent.name }}</text>
        <view class="feature-card__meta"
          ><text>{{ featuredEvent.region }}</text
          ><text>{{ featuredEvent.startDate }} — {{ featuredEvent.endDate }}</text></view
        >
        <view class="feature-card__footer"
          ><text>{{ featuredEvent.teamsCount }} 支队伍参赛</text
          ><text class="feature-card__link">查看赛事概览 ›</text></view
        >
      </view>

      <view class="section-heading"
        ><view
          ><text class="section-heading__title">近期比赛</text
          ><text class="section-heading__hint">按时间查看比赛状态</text></view
        ><text class="section-heading__count">{{ filteredMatches.length }} 场</text></view
      >
      <view class="filter-row">
        <wd-tag
          v-for="filter in [
            { value: 'all', label: '全部' },
            { value: 'upcoming', label: '未开始' },
            { value: 'completed', label: '已结束' },
          ]"
          :key="filter.value"
          round
          :plain="activeFilter !== filter.value"
          type="primary"
          @click="activeFilter = filter.value as FeedFilter"
          >{{ filter.label }}</wd-tag
        >
      </view>

      <view class="match-list">
        <view v-for="match in filteredMatches" :key="match.id" class="match-card">
          <view class="match-card__header"
            ><view class="match-card__event"
              ><text class="match-card__event-name">{{ match.eventName }}</text
              ><text class="match-card__event-meta"
                >{{ match.region }} · {{ match.eventTier }}</text
              ></view
            ><view class="match-card__status" :class="`match-card__status--${match.status}`"
              ><text>{{ statusLabel(match.status) }}</text></view
            ></view
          >
          <view class="match-card__body">
            <view class="team"
              ><view class="team__crest"
                ><text>{{ match.home.shortName }}</text></view
              ><text class="team__name">{{ match.home.name }}</text></view
            >
            <view class="match-score"
              ><text class="match-score__time">{{ formatMatchTime(match.startAt) }}</text
              ><text class="match-score__value"
                >{{ match.homeScore === null ? '—' : match.homeScore }} :
                {{ match.awayScore === null ? '—' : match.awayScore }}</text
              ><text class="match-score__bo">BO{{ match.bestOf }}</text></view
            >
            <view class="team"
              ><view class="team__crest"
                ><text>{{ match.away.shortName }}</text></view
              ><text class="team__name">{{ match.away.name }}</text></view
            >
          </view>
        </view>
      </view>

      <view class="section-heading"
        ><view
          ><text class="section-heading__title">赛事索引</text
          ><text class="section-heading__hint">追踪本赛季主要赛事</text></view
        ><text class="section-heading__link">全部赛事 ›</text></view
      >
      <scroll-view scroll-x class="horizontal-strip"
        ><view class="horizontal-strip__content"
          ><view v-for="event in events" :key="event.id" class="event-chip"
            ><text class="event-chip__tier">{{ event.tier }}</text
            ><text class="event-chip__name">{{ event.name }}</text
            ><text class="event-chip__status">{{ eventStatusLabel(event.status) }}</text></view
          ></view
        ></scroll-view
      >

      <view class="section-heading"
        ><view
          ><text class="section-heading__title">热门战队</text
          ><text class="section-heading__hint">来自静态战队目录</text></view
        ><text class="section-heading__link">战队库 ›</text></view
      >
      <scroll-view scroll-x class="horizontal-strip"
        ><view class="horizontal-strip__content"
          ><view v-for="team in teams" :key="team.id" class="team-tile"
            ><view class="team-tile__crest"
              ><text>{{ team.shortName }}</text></view
            ><text class="team-tile__name">{{ team.name }}</text></view
          ></view
        ></scroll-view
      >
    </scroll-view>
  </wd-config-provider>
</template>

<style lang="scss" scoped>
.page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 36rpx 32rpx 72rpx;
  background: $r6-bg;
}
.masthead,
.feature-card__topline,
.feature-card__meta,
.feature-card__footer,
.section-heading,
.match-card__header,
.match-card__body {
  display: flex;
  align-items: center;
}
.masthead {
  justify-content: space-between;
}
.masthead > view:first-child,
.section-heading > view,
.match-card__event {
  display: flex;
  flex-direction: column;
}
.eyebrow,
.feature-card__kicker {
  font-size: 20rpx;
  font-weight: 700;
  letter-spacing: 3rpx;
  color: $r6-accent;
}
.title {
  display: block;
  margin-top: 8rpx;
  font-size: 52rpx;
  font-weight: 700;
  color: $r6-text-primary;
}
.subtitle,
.section-heading__hint,
.match-card__event-meta {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $r6-text-secondary;
}
.season-badge {
  display: flex;
  width: 124rpx;
  height: 124rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1rpx solid rgba(255, 140, 26, 0.5);
  border-radius: 50%;
  background: rgba(255, 140, 26, 0.08);
}
.season-badge__label {
  font-size: 20rpx;
  color: $r6-text-secondary;
}
.season-badge__value {
  margin-top: 4rpx;
  font-size: 32rpx;
  font-weight: 700;
  color: $r6-accent;
}
.notice-bar {
  display: flex;
  margin-top: 28rpx;
  padding: 18rpx 20rpx;
  align-items: center;
  border-left: 4rpx solid $r6-accent;
  background: $r6-surface;
  font-size: 22rpx;
  color: $r6-text-secondary;
}
.notice-bar__dot {
  width: 12rpx;
  height: 12rpx;
  margin-right: 12rpx;
  border-radius: 50%;
  background: $r6-accent;
}
.feature-card {
  margin-top: 28rpx;
  padding: 28rpx;
  border: 1rpx solid rgba(255, 140, 26, 0.45);
  background: linear-gradient(135deg, #30261c 0%, $r6-surface 65%);
}
.feature-card__topline,
.feature-card__meta,
.feature-card__footer {
  justify-content: space-between;
}
.feature-card__tier {
  padding: 6rpx 12rpx;
  border: 1rpx solid rgba(255, 140, 26, 0.45);
  font-size: 20rpx;
  color: $r6-accent;
}
.feature-card__title {
  display: block;
  margin-top: 22rpx;
  font-size: 36rpx;
  font-weight: 700;
  color: $r6-text-primary;
}
.feature-card__meta,
.feature-card__footer {
  margin-top: 18rpx;
  font-size: 22rpx;
  color: $r6-text-secondary;
}
.feature-card__footer {
  padding-top: 20rpx;
  border-top: 1rpx solid $r6-border;
}
.feature-card__link,
.section-heading__link {
  color: $r6-accent;
}
.section-heading {
  justify-content: space-between;
  margin-top: 40rpx;
}
.section-heading__title {
  font-size: 30rpx;
  font-weight: 700;
  color: $r6-text-primary;
}
.section-heading__count,
.section-heading__link {
  font-size: 22rpx;
}
.filter-row {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}
.match-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 20rpx;
}
.match-card {
  padding: 22rpx;
  border: 1rpx solid $r6-border;
  background: $r6-surface;
}
.match-card__header {
  justify-content: space-between;
}
.match-card__event-name {
  overflow: hidden;
  font-size: 24rpx;
  color: $r6-text-primary;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-card__status {
  padding: 6rpx 12rpx;
  font-size: 20rpx;
  white-space: nowrap;
}
.match-card__status--upcoming {
  background: rgba(74, 163, 255, 0.14);
  color: $r6-defend;
}
.match-card__status--completed {
  background: rgba(154, 161, 172, 0.14);
  color: $r6-text-secondary;
}
.match-card__status--live {
  background: rgba(74, 222, 128, 0.14);
  color: $r6-success;
}
.match-card__body {
  justify-content: space-between;
  margin-top: 24rpx;
}
.team {
  display: flex;
  width: 30%;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
}
.team__crest,
.team-tile__crest {
  display: flex;
  width: 68rpx;
  height: 68rpx;
  align-items: center;
  justify-content: center;
  border: 1rpx solid $r6-border;
  background: $r6-surface-raised;
  color: $r6-accent;
}
.team__name {
  overflow: hidden;
  width: 100%;
  font-size: 22rpx;
  color: $r6-text-primary;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-score {
  display: flex;
  width: 36%;
  flex-direction: column;
  align-items: center;
}
.match-score__time,
.match-score__bo {
  font-size: 20rpx;
  color: $r6-text-secondary;
}
.match-score__value {
  margin: 8rpx 0;
  font-size: 34rpx;
  font-weight: 700;
  color: $r6-text-primary;
}
.horizontal-strip {
  width: 100%;
  margin-top: 20rpx;
  white-space: nowrap;
}
.horizontal-strip__content {
  display: inline-flex;
  gap: 16rpx;
}
.event-chip {
  display: flex;
  width: 270rpx;
  min-height: 142rpx;
  padding: 20rpx;
  box-sizing: border-box;
  flex-direction: column;
  justify-content: space-between;
  border: 1rpx solid $r6-border;
  background: $r6-surface;
  white-space: normal;
}
.event-chip__tier {
  font-size: 20rpx;
  color: $r6-accent;
}
.event-chip__name {
  margin-top: 14rpx;
  font-size: 24rpx;
  color: $r6-text-primary;
}
.event-chip__status {
  margin-top: 16rpx;
  font-size: 20rpx;
  color: $r6-text-secondary;
}
.team-tile {
  display: flex;
  width: 156rpx;
  min-height: 132rpx;
  padding: 18rpx 12rpx;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  border: 1rpx solid $r6-border;
  background: $r6-surface;
}
.team-tile__crest {
  width: 56rpx;
  height: 56rpx;
  font-size: 20rpx;
}
.team-tile__name {
  overflow: hidden;
  width: 100%;
  font-size: 20rpx;
  color: $r6-text-primary;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
