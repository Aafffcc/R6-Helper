<script setup lang="ts">
import { computed } from 'vue';

import { formatDashValue } from '@/utils/format';

const props = defineProps<{
  label: string;
  value: number | string | null | undefined;
}>();

const display = computed(() => formatDashValue(props.value));
</script>

<template>
  <view class="stat-block">
    <text class="stat-block__label">{{ label }}</text>
    <text class="stat-block__value">{{ display }}</text>
  </view>
</template>

<style lang="scss" scoped>
.stat-block {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8rpx;
}

.stat-block__label {
  font-size: 22rpx;
  color: $r6-text-secondary;
}

.stat-block__value {
  font-size: 34rpx;
  font-weight: 600;
  color: $r6-text-primary;
}
</style>
