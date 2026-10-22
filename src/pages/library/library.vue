<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import CatalogCard from '@/components/CatalogCard.vue';
import MapCard from '@/components/MapCard.vue';
import OperatorCard from '@/components/OperatorCard.vue';
import { getCharms, getMaps, getOperators, getSkins, getWeapons } from '@/services/catalog';
import { R6_THEME_VARS } from '@/styles/theme';
import type {
  CatalogEntry,
  CharmEntry,
  MapEntry,
  OperatorEntry,
  OperatorSide,
  SkinEntry,
} from '@/types/catalog';

type SideFilter = 'all' | OperatorSide;

const sideFilters: ReadonlyArray<{ value: SideFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'attacker', label: '进攻方' },
  { value: 'defender', label: '防守方' },
];

const operators = getOperators();
const weapons = getWeapons();
const maps = getMaps();
const skins = getSkins();
const charms = getCharms();

const operatorKeyword = ref('');
const weaponKeyword = ref('');
const mapKeyword = ref('');
const skinKeyword = ref('');
const charmKeyword = ref('');
const activeSide = ref<SideFilter>('all');

/** 皮肤/挂件条目过多（141/1368），一次性渲染整页卡片会卡顿，按页增量渲染 */
const LIBRARY_PAGE_SIZE = 60;

function matchByName<T extends { name: string }>(items: readonly T[], keyword: string): T[] {
  const text = keyword.trim().toLowerCase();
  return items.filter((item) => text === '' || item.name.toLowerCase().includes(text));
}

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

const filteredWeapons = computed<CatalogEntry[]>(() => matchByName(weapons, weaponKeyword.value));
const filteredMaps = computed<MapEntry[]>(() => matchByName(maps, mapKeyword.value));
const filteredSkins = computed<SkinEntry[]>(() => matchByName(skins, skinKeyword.value));
const filteredCharms = computed<CharmEntry[]>(() => matchByName(charms, charmKeyword.value));

const skinVisibleCount = ref(LIBRARY_PAGE_SIZE);
const charmVisibleCount = ref(LIBRARY_PAGE_SIZE);

watch(skinKeyword, () => {
  skinVisibleCount.value = LIBRARY_PAGE_SIZE;
});
watch(charmKeyword, () => {
  charmVisibleCount.value = LIBRARY_PAGE_SIZE;
});

const visibleSkins = computed(() => filteredSkins.value.slice(0, skinVisibleCount.value));
const visibleCharms = computed(() => filteredCharms.value.slice(0, charmVisibleCount.value));
const hasMoreSkins = computed(() => filteredSkins.value.length > visibleSkins.value.length);
const hasMoreCharms = computed(() => filteredCharms.value.length > visibleCharms.value.length);

const skinSummary = computed(() =>
  hasMoreSkins.value
    ? `共 ${filteredSkins.value.length} 个皮肤（已显示 ${visibleSkins.value.length}）`
    : `共 ${filteredSkins.value.length} 个皮肤`,
);
const charmSummary = computed(() =>
  hasMoreCharms.value
    ? `共 ${filteredCharms.value.length} 个挂件（已显示 ${visibleCharms.value.length}）`
    : `共 ${filteredCharms.value.length} 个挂件`,
);

function loadMoreSkins() {
  skinVisibleCount.value += LIBRARY_PAGE_SIZE;
}

function loadMoreCharms() {
  charmVisibleCount.value += LIBRARY_PAGE_SIZE;
}

function joinCaption(parts: ReadonlyArray<string | null>): string | null {
  const caption = parts.filter((part) => part !== null).join(' · ');
  return caption === '' ? null : caption;
}
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
        <wd-tab title="地图">
          <view class="pane">
            <wd-search
              v-model="mapKeyword"
              variant="filled"
              placeholder="搜索地图名称"
              hide-cancel
            />
            <text class="summary">共 {{ filteredMaps.length }} 张地图</text>
            <view class="grid">
              <MapCard v-for="map in filteredMaps" :key="map.id" :entry="map" />
            </view>
          </view>
        </wd-tab>
        <wd-tab title="皮肤">
          <view class="pane">
            <wd-search
              v-model="skinKeyword"
              variant="filled"
              placeholder="搜索皮肤名称"
              hide-cancel
            />
            <text class="summary">{{ skinSummary }}</text>
            <view class="grid">
              <CatalogCard
                v-for="skin in visibleSkins"
                :key="skin.id"
                :entry="skin"
                category="skins"
                :caption="joinCaption([skin.rarity, skin.season])"
              />
            </view>
            <wd-button v-if="hasMoreSkins" block plain @click="loadMoreSkins">
              加载更多（剩余 {{ filteredSkins.length - visibleSkins.length }}）
            </wd-button>
          </view>
        </wd-tab>
        <wd-tab title="挂件">
          <view class="pane">
            <wd-search
              v-model="charmKeyword"
              variant="filled"
              placeholder="搜索挂件名称"
              hide-cancel
            />
            <text class="summary">{{ charmSummary }}</text>
            <view class="grid">
              <CatalogCard
                v-for="charm in visibleCharms"
                :key="charm.id"
                :entry="charm"
                category="charms"
                :caption="joinCaption([charm.collection, charm.rarity])"
              />
            </view>
            <wd-button v-if="hasMoreCharms" block plain @click="loadMoreCharms">
              加载更多（剩余 {{ filteredCharms.length - visibleCharms.length }}）
            </wd-button>
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
