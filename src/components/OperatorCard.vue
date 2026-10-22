<script setup lang="ts">
import { computed, ref } from 'vue';

import { getCatalogImageUrl, getOperatorSideLabel } from '@/services/catalog';
import type { OperatorEntry } from '@/types/catalog';

const props = defineProps<{
  operator: OperatorEntry;
}>();

const imageFailed = ref(false);

const imageUrl = computed(() => getCatalogImageUrl(props.operator, 'operators'));
const initials = computed(() => props.operator.name.slice(0, 2).toUpperCase());
const sideClass = computed(() => `operator-card--${props.operator.side}`);

function onImageError() {
  // 图片托管未接入或加载失败时降级为首字母占位块
  imageFailed.value = true;
}
</script>

<template>
  <view class="operator-card" :class="sideClass">
    <image
      v-if="imageUrl !== null && !imageFailed"
      class="operator-card__image"
      :src="imageUrl"
      mode="aspectFit"
      @error="onImageError"
    />
    <view v-else class="operator-card__fallback">
      <text class="operator-card__initials">{{ initials }}</text>
    </view>
    <text class="operator-card__name">{{ operator.name }}</text>
    <text class="operator-card__side">{{ getOperatorSideLabel(operator.side) }}</text>
  </view>
</template>

<style lang="scss" scoped>
.operator-card {
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

.operator-card__image {
  width: 120rpx;
  height: 120rpx;
}

.operator-card__fallback {
  display: flex;
  width: 120rpx;
  height: 120rpx;
  align-items: center;
  justify-content: center;
  border-radius: 60rpx;
  background-color: $r6-surface-raised;
}

.operator-card__initials {
  font-size: 40rpx;
  font-weight: 700;
  color: $r6-text-secondary;
}

.operator-card__name {
  max-width: 100%;
  margin-top: 12rpx;
  overflow: hidden;
  font-size: 26rpx;
  color: $r6-text-primary;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.operator-card__side {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: $r6-text-secondary;
}

.operator-card--attacker .operator-card__fallback {
  background-color: rgba(255, 140, 66, 0.18);
}

.operator-card--attacker .operator-card__side {
  color: $r6-attack;
}

.operator-card--defender .operator-card__fallback {
  background-color: rgba(74, 163, 255, 0.18);
}

.operator-card--defender .operator-card__side {
  color: $r6-defend;
}
</style>
