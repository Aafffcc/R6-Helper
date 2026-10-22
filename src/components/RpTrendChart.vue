<script setup lang="ts">
import { getCurrentInstance, onMounted, watch } from 'vue';

import uCharts from '@qiun/ucharts';
import type { RpHistoryPoint } from '@/types/stats';

const props = defineProps<{
  points: RpHistoryPoint[];
}>();

const instance = getCurrentInstance();
const canvasId = `rp-trend-${Math.random().toString(36).slice(2, 10)}`;

function formatAxisLabel(timestamp: number | null): string {
  if (timestamp === null) {
    return '';
  }
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function renderChart() {
  const valid = props.points.filter((point) => point.rp !== null);
  if (valid.length === 0) {
    return;
  }
  uni
    .createSelectorQuery()
    .in(instance)
    .select(`#${canvasId}`)
    .fields({ node: true, size: true }, () => {})
    .exec((result) => {
      const info = result?.[0] as { node?: HTMLCanvasElement; width?: number; height?: number };
      const canvas = info?.node;
      const width = info?.width ?? 0;
      const height = info?.height ?? 0;
      if (!canvas || width <= 0 || height <= 0) {
        return;
      }
      const pixelRatio = uni.getWindowInfo().pixelRatio || 2;
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }
      context.scale(pixelRatio, pixelRatio);
      new uCharts({
        type: 'line',
        context,
        width,
        height,
        pixelRatio,
        categories: valid.map((point) => formatAxisLabel(point.timestamp)),
        series: [
          {
            name: 'RP',
            data: valid.map((point) => point.rp),
            color: '#ff8c1a',
          },
        ],
        // 与卡片底色一致，避免画布白底突兀
        background: '#1F232B',
        color: ['#ff8c1a'],
        padding: [16, 12, 4, 8],
        animation: true,
        legend: { show: false },
        dataLabel: false,
        xAxis: {
          disableGrid: true,
          labelCount: 4,
          fontSize: 10,
          fontColor: '#9aa1ac',
          lineHeight: 1.2,
          marginTop: 0,
        },
        yAxis: {
          gridColor: '#2c313b',
          splitNumber: 4,
          fontSize: 10,
          fontColor: '#9aa1ac',
        },
        extra: {
          line: { type: 'curve', width: 2, activeType: 'hollow' },
          tooltip: { showBox: true, bgColor: '#262b35', fontColor: '#f5f6f8', legendShow: false },
        },
      });
    });
}

onMounted(renderChart);
watch(
  () => props.points,
  () => renderChart(),
);
</script>

<template>
  <view class="rp-trend">
    <canvas :id="canvasId" :canvas-id="canvasId" type="2d" class="rp-trend__canvas" />
  </view>
</template>

<style lang="scss" scoped>
.rp-trend {
  width: 100%;
}

.rp-trend__canvas {
  width: 100%;
  height: 400rpx;
}
</style>
