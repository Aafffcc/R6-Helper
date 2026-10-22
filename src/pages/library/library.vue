<script setup lang="ts">
import { computed, ref } from 'vue';

import OperatorCard from '@/components/OperatorCard.vue';
import CatalogCard from '@/components/CatalogCard.vue';
import { getOperators, getWeapons } from '@/services/catalog';
import { R6_THEME_VARS } from '@/styles/theme';
import type { CatalogEntry, OperatorEntry, OperatorSide } from '@/types/catalog';

type SideFilter = 'all' | OperatorSide;

const sideFilters: ReadonlyArray<{ value: SideFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'attacker', label: '进攻方' },
  { value: 'defender', label: '防守方' },
];

const operators = getOperators();
const weapons = getWeapons();

const operatorKeyword = ref('');
const weaponKeyword = ref('');
const activeSide = ref<SideFilter>('all');

const filteredOperators = computed<OperatorEntry[]>(() => {
  const text = operatorKeyword.value.trim().toLowerCase();
  const side = activeSide.value;
  return operators.filter((operator) => {
    // 经典招募干员双阵营可用，任何阵营筛选下都保留
    const sideMatched = side === 'all' || operator.side === 'both' || operator.side === side;
    const keywordMatched = text === '' || operator.name.toLowerCase().includes(text);
    return sideMatched && keywordMatched;
  });
});

const filteredWeapons = computed<CatalogEntry[]>(() => {
  const text = weaponKeyword.value.trim().toLowerCase();
  return weapons.filter((weapon) => text === '' || weapon.name.toLowerCase().includes(text));
});
</script>

<template>
  <wd-config-provider :theme-vars="R6_THEME_VARS">
    <view class="page">
      <wd-tabs swipeable>
        <wd-tab title="干员">
          <view class="pane">
            <wd-search
              v-model="operatorKeyword"
              variant="filled"
              placeholder="搜索干员名称"
              hide-cancel
            />
            <view class="filters">
              <wd-tag
                v-for="filter in sideFilters"
                :key="filter.value"
                round
                type="primary"
                :plain="activeSide !== filter.value"
                @click="activeSide = filter.value"
              >
                {{ filter.label }}
              </wd-tag>
            </view>
            <text class="summary">共 {{ filteredOperators.length }} 名干员</text>
            <view class="grid">
              <OperatorCard
                v-for="operator in filteredOperators"
                :key="operator.id"
                :operator="operator"
              />
            </view>
          </view>
        </wd-tab>
        <wd-tab title="武器">
          <view class="pane">
            <wd-search
              v-model="weaponKeyword"
              variant="filled"
              placeholder="搜索武器名称"
              hide-cancel
            />
            <text class="summary">共 {{ filteredWeapons.length }} 把武器</text>
            <view class="grid">
              <CatalogCard
                v-for="weapon in filteredWeapons"
                :key="weapon.id"
                :entry="weapon"
                category="weapons"
              />
            </view>
          </view>
        </wd-tab>
      </wd-tabs>
    </view>
  </wd-config-provider>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
}

.pane {
  display: flex;
  padding: 24rpx 32rpx 40rpx;
  flex-direction: column;
  gap: 20rpx;
}

.filters {
  display: flex;
  gap: 16rpx;
}

.summary {
  font-size: 24rpx;
  color: $r6-text-secondary;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 20rpx;
}
</style>
