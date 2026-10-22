<script setup lang="ts">
import { R6_THEME_VARS } from '@/styles/theme';

defineProps<{
  title: string;
  hint: string;
}>();
</script>

<template>
  <wd-config-provider :theme-vars="R6_THEME_VARS">
    <view class="placeholder">
      <text class="placeholder__title">{{ title }}</text>
      <wd-empty :text="hint" />
    </view>
  </wd-config-provider>
</template>

<style lang="scss" scoped>
.placeholder {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  gap: 16rpx;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
}

.placeholder__title {
  font-size: 36rpx;
  font-weight: 700;
  color: $r6-text-primary;
}
</style>
