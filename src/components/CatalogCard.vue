<script setup lang="ts">
import { computed, ref } from 'vue';

import { getCatalogImageUrl } from '@/services/catalog';
import type { CatalogEntry } from '@/types/catalog';

const props = defineProps<{
  entry: CatalogEntry;
  category: string;
  /** 名称下方的补充说明行（如皮肤稀有度/赛季），缺省不渲染 */
  caption?: string | null;
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
    <text v-if="caption" class="catalog-card__caption">{{ caption }}</text>
  </view>
</template>

<style lang="scss" scoped>
.catalog-card {
  display: flex;
  /* 三列铺满内容区：686rpx（750 - 2×32 页边距）= 3×215 + 2×20 间隙。
     不能用 calc(100%/3)：百分比相对小程序组件宿主节点解析，宿主在 flex 里
     宽度 auto，会循环解析塌缩成最小内容宽（真机已踩坑） */
  width: 215rpx;
  box-sizing: border-box;
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
  max-width: 100%;
  margin-top: 12rpx;
  overflow: hidden;
  font-size: 26rpx;
  color: $r6-text-primary;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.catalog-card__caption {
  max-width: 100%;
  margin-top: 4rpx;
  overflow: hidden;
  font-size: 22rpx;
  color: $r6-text-secondary;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
