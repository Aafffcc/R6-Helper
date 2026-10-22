<script setup lang="ts">
import { computed, ref } from 'vue';

import { getCatalogImageUrl } from '@/services/catalog';
import type { CatalogEntry } from '@/types/catalog';

const props = defineProps<{
  entry: CatalogEntry;
  category: string;
}>();

const imageFailed = ref(false);

const imageUrl = computed(() => getCatalogImageUrl(props.entry, props.category));
const initials = computed(() => props.entry.name.slice(0, 2).toUpperCase());

function onImageError() {
  // 图片托管未接入或加载失败时降级为首字母占位块
  imageFailed.value = true;
}
</script>

<template>
  <view class="catalog-card">
    <image
      v-if="imageUrl !== null && !imageFailed"
      class="catalog-card__image"
      :src="imageUrl"
      mode="aspectFit"
      @error="onImageError"
    />
    <view v-else class="catalog-card__fallback">
      <text class="catalog-card__initials">{{ initials }}</text>
    </view>
    <text class="catalog-card__name">{{ entry.name }}</text>
  </view>
</template>

<style lang="scss" scoped>
.catalog-card {
  display: flex;
  width: 208rpx;
  flex-direction: column;
  align-items: center;
  padding: 20rpx;
  border: 1rpx solid $r6-border;
  border-radius: 16rpx;
  background-color: $r6-surface;
}

.catalog-card__image {
  width: 140rpx;
  height: 100rpx;
}

.catalog-card__fallback {
  display: flex;
  width: 140rpx;
  height: 100rpx;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
  background-color: $r6-surface-raised;
}

.catalog-card__initials {
  font-size: 32rpx;
  font-weight: 700;
  color: $r6-text-secondary;
}

.catalog-card__name {
  margin-top: 12rpx;
  font-size: 26rpx;
  color: $r6-text-primary;
}
</style>
