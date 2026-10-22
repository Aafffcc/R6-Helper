<script setup lang="ts">
import { computed, ref } from 'vue';

import { getCatalogImageUrl } from '@/services/catalog';
import type { MapEntry } from '@/types/catalog';

const props = defineProps<{
  entry: MapEntry;
}>();

const imageFailed = ref(false);

// arenyze /maps 无图片字段，地图图片为人工后补的 data/maps/ 资产，缺图走首字母占位块
const imageUrl = computed(() => getCatalogImageUrl(props.entry, 'maps'));
const initials = computed(() => props.entry.name.slice(0, 2).toUpperCase());

function onImageError() {
  imageFailed.value = true;
}
</script>

<template>
  <view class="map-card">
    <image
      v-if="imageUrl !== null && !imageFailed"
      class="map-card__image"
      :src="imageUrl"
      mode="aspectFit"
      @error="onImageError"
    />
    <view v-else class="map-card__fallback">
      <text class="map-card__initials">{{ initials }}</text>
    </view>
    <text class="map-card__name">{{ entry.name }}</text>
    <text v-if="entry.location" class="map-card__meta">{{ entry.location }}</text>
    <text v-if="entry.mapReworked" class="map-card__meta">{{ entry.mapReworked }} 改版</text>
  </view>
</template>

<style lang="scss" scoped>
.map-card {
  display: flex;
  width: 208rpx;
  flex-direction: column;
  align-items: center;
  padding: 20rpx;
  border: 1rpx solid $r6-border;
  border-radius: 16rpx;
  background-color: $r6-surface;
}

.map-card__image {
  width: 168rpx;
  height: 100rpx;
}

.map-card__fallback {
  display: flex;
  width: 168rpx;
  height: 100rpx;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
  background-color: $r6-surface-raised;
}

.map-card__initials {
  font-size: 32rpx;
  font-weight: 700;
  color: $r6-text-secondary;
}

.map-card__name {
  max-width: 100%;
  margin-top: 12rpx;
  overflow: hidden;
  font-size: 26rpx;
  color: $r6-text-primary;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.map-card__meta {
  max-width: 100%;
  margin-top: 4rpx;
  overflow: hidden;
  font-size: 22rpx;
  color: $r6-text-secondary;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
