<script setup lang="ts">
import { getCurrentInstance, onMounted, onUnmounted, watch } from 'vue';

import uCharts from '@qiun/ucharts';
import type { RpHistoryPoint } from '@/types/stats';
import { aggregateRpPointsByDay, deriveRankBoundaries, formatRpDayLabel } from '@/utils/rpTrend';

const props = defineProps<{
  points: RpHistoryPoint[];
}>();

const instance = getCurrentInstance();
const canvasId = `rp-trend-${Math.random().toString(36).slice(2, 10)}`;

const RANK_LABEL_FONT_SIZE = 9;
const RANK_LABEL_PADDING = 3;

// markLine 徽标需按文本像素宽内移贴边，uCharts 不暴露 measureText，
// 按半角 0.6em / 全角 1em 估算即可满足排版
function estimateLabelPixelWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    width += char.charCodeAt(0) > 0xff ? fontSize : fontSize * 0.6;
  }
  return width;
}

// 段位徽标贴绘图区右缘：uCharts 的非 left 对齐默认从右缘向画布外排布，
// 用负偏移把徽标整体拉回绘图区内侧，避免被画布裁切
function buildRankMarkLines(points: RpHistoryPoint[]) {
  return deriveRankBoundaries(points).map((boundary) => ({
    value: boundary.rp,
    lineColor: '#4a5160',
    showLabel: boundary.showLabel,
    labelText: boundary.rank,
    labelFontSize: RANK_LABEL_FONT_SIZE,
    labelPadding: RANK_LABEL_PADDING,
    labelFontColor: '#ff8c1a',
    labelBgColor: '#262b35',
    labelBgOpacity: 0.9,
    labelAlign: 'right',
    labelOffsetX: -(
      estimateLabelPixelWidth(boundary.rank, RANK_LABEL_FONT_SIZE) +
      RANK_LABEL_PADDING * 2 +
      4
    ),
  }));
}

function renderChart() {
  // x 轴以自然日为粒度（同一天保留最后快照）；输入已按天聚合时幂等
  const daily = aggregateRpPointsByDay(props.points.filter((point) => point.rp !== null));
  if (daily.length === 0) {
    return;
  }
  const rankMarkLines = buildRankMarkLines(daily);
  const query = uni.createSelectorQuery().in(instance);
  // 布局尺寸量外层普通 view：H5 端 canvas 由 uni 自管放大 backing store，
  // 直接探测 canvas 元素拿到的宽高会失真，导致图表按错误尺寸布局被裁切
  query.select('.rp-trend').fields({ size: true }, () => {});
  query.select(`#${canvasId}`).fields({ node: true }, () => {});
  query.exec((result) => {
    const size = result?.[0] as { width?: number; height?: number };
    const info = result?.[1] as { node?: HTMLCanvasElement };
    const canvas = info?.node;
    const width = size?.width ?? 0;
    const height = size?.height ?? 0;
    if (!canvas || width <= 0 || height <= 0) {
      return;
    }
    // canvas 2d 已手动放大画布并 scale 上下文；uCharts 内部会按 pixelRatio
    // 再放大全部坐标与字号（opts.pix），这里必须传 1，否则二次放大导致比例异常
    const dpr = uni.getWindowInfo().pixelRatio || 2;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.scale(dpr, dpr);
    new uCharts({
      type: 'line',
      context,
      width,
      height,
      pixelRatio: 1,
      categories: daily.map((point) => formatRpDayLabel(point.timestamp)),
      series: [
        {
          name: 'RP',
          data: daily.map((point) => point.rp),
          color: '#ff8c1a',
        },
      ],
      // 与卡片底色一致，避免画布白底突兀
      background: '#1F232B',
      color: ['#ff8c1a'],
      padding: [16, 12, 20, 8],
      animation: true,
      legend: { show: false },
      dataLabel: false,
      xAxis: {
        disableGrid: true,
        labelCount: 4,
        fontSize: 10,
        fontColor: '#9aa1ac',
        axisLineColor: '#3a404c',
        lineHeight: 1.2,
        marginTop: 8,
      },
      yAxis: {
        gridColor: '#2c313b',
        axisLineColor: '#3a404c',
        splitNumber: 4,
        fontSize: 10,
        fontColor: '#9aa1ac',
      },
      extra: {
        line: { type: 'curve', width: 2, activeType: 'hollow' },
        tooltip: { showBox: true, bgColor: '#262b35', fontColor: '#f5f6f8', legendShow: false },
        markLine: { type: 'dash', dashLength: 4, data: rankMarkLines },
      },
    });
  });
}

// 视口在挂载后才稳定（H5 首帧布局、转屏、模拟器缩放）时，图表会按旧尺寸
// 绘制而被裁切；监听窗口尺寸变化按新尺寸重绘，MP 端仅在转屏时触发。
function handleWindowResize() {
  renderChart();
}

onMounted(() => {
  renderChart();
  uni.onWindowResize(handleWindowResize);
});

onUnmounted(() => {
  uni.offWindowResize(handleWindowResize);
});

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
  display: block;
  width: 100%;
  height: 320rpx;
  background-color: $r6-surface;
}
</style>
