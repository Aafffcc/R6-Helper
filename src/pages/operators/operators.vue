<script setup lang="ts">
import { computed, ref } from 'vue';

import OperatorCard from '@/components/OperatorCard.vue';
import { getOperators } from '@/services/catalog';
import type { OperatorEntry, OperatorSide } from '@/types/catalog';

type SideFilter = 'all' | OperatorSide;

const sideFilters: ReadonlyArray<{ value: SideFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'attacker', label: '进攻方' },
  { value: 'defender', label: '防守方' },
];

const operators = getOperators();
const keyword = ref('');
const activeSide = ref<SideFilter>('all');

const filteredOperators = computed<OperatorEntry[]>(() => {
  const text = keyword.value.trim().toLowerCase();
  const side = activeSide.value;
  return operators.filter((operator) => {
    // 经典招募干员双阵营可用，任何阵营筛选下都保留
    const sideMatched = side === 'all' || operator.side === 'both' || operator.side === side;
    const keywordMatched = text === '' || operator.name.toLowerCase().includes(text);
    return sideMatched && keywordMatched;
  });
});
</script>

<template>
  <view class="page">
    <view class="toolbar">
      <input
        v-model="keyword"
        class="toolbar__input"
        placeholder="搜索操作员名称"
        placeholder-class="toolbar__placeholder"
      />
      <view class="toolbar__filters">
        <view
          v-for="filter in sideFilters"
          :key="filter.value"
          class="toolbar__filter"
          :class="{ 'toolbar__filter--active': activeSide === filter.value }"
          @tap="activeSide = filter.value"
        >
          <text>{{ filter.label }}</text>
        </view>
      </view>
    </view>

    <text class="summary">共 {{ filteredOperators.length }} 名操作员</text>

    <view class="grid">
      <OperatorCard v-for="operator in filteredOperators" :key="operator.id" :operator="operator" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  display: flex;
  min-height: 100vh;
  padding: 32rpx;
  flex-direction: column;
  gap: 24rpx;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.toolbar__input {
  height: 80rpx;
  padding: 0 24rpx;
  border: 1rpx solid $r6-border;
  border-radius: 12rpx;
  background-color: $r6-surface;
  color: $r6-text-primary;
}

.toolbar__placeholder {
  color: $r6-text-secondary;
}

.toolbar__filters {
  display: flex;
  gap: 16rpx;
}

.toolbar__filter {
  display: flex;
  height: 64rpx;
  padding: 0 32rpx;
  align-items: center;
  justify-content: center;
  border: 1rpx solid $r6-border;
  border-radius: 999rpx;
  background-color: $r6-surface;
  color: $r6-text-secondary;
}

.toolbar__filter--active {
  border-color: $r6-accent;
  color: $r6-accent;
}

.summary {
  font-size: 24rpx;
  color: $r6-text-secondary;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 20rpx;
  padding-bottom: 40rpx;
}
</style>
