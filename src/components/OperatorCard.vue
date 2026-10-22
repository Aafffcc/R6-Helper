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
  /* 三列自适应铺满一行（内容区 686rpx - 2×20rpx 间隙），border-box 防止 padding 撑宽 */
  width: calc((100% - 40rpx) / 3);
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
