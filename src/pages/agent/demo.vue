<!-- TEMP: Phase 0 Spike 页面（uni-ai 流式 + SSEChannel 验证），Go 决策后删除本文件与 pages.json 注册 -->
<script setup lang="ts">
import { computed, ref } from 'vue';

import { runSpikeChat, type SpikeOutcome } from '@/services/agent-demo';

const DEFAULT_PROMPT = '用三句话说明彩虹六号进攻方的默认分工。';

const prompt = ref(DEFAULT_PROMPT);
const running = ref(false);
const output = ref('');
const outcome = ref<SpikeOutcome | null>(null);

const outcomeLines = computed<string[]>(() => {
  const current = outcome.value;
  if (current === null) {
    return [];
  }
  const lines = [
    `transport: ${current.transport}`,
    `ok: ${String(current.ok)}`,
    `errCode: ${current.errCode ?? '—'}`,
    `errMsg: ${current.errMsg ?? '—'}`,
    `首帧: ${current.firstFrameMs === null ? '—' : `${current.firstFrameMs}ms`}`,
    `总耗时: ${current.totalMs === null ? '—' : `${current.totalMs}ms`}`,
    `帧数: ${current.frameCount}`,
    `回答字数: ${current.answer.length}`,
  ];
  if (current.answer === '' && current.raw !== null && current.raw !== undefined) {
    try {
      lines.push(`raw: ${JSON.stringify(current.raw).slice(0, 600)}`);
    } catch {
      lines.push('raw: <无法序列化>');
    }
  }
  return lines;
});

async function start(preferChannel: boolean): Promise<void> {
  if (running.value) {
    return;
  }
  running.value = true;
  output.value = '';
  outcome.value = null;
  try {
    const result = await runSpikeChat(prompt.value, {
      preferChannel,
      onFrame: (text) => {
        output.value += text;
      },
    });
    // 非流式路径没有帧回调，回答只在最终结果里，这里补显
    if (output.value === '' && result.answer !== '') {
      output.value = result.answer;
    }
    outcome.value = result;
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <view class="spike">
    <text class="spike__hint">
      Phase 0 Spike：验证支付宝云空间 uni-ai 流式 +
      SSEChannel。先点「非流式对照」确认基础链路，再点「流式」。
    </text>
    <textarea v-model="prompt" class="spike__input" :maxlength="1200" :disabled="running" />
    <view class="spike__actions">
      <button class="spike__btn" :disabled="running" @tap="start(false)">非流式对照</button>
      <button class="spike__btn spike__btn--primary" :disabled="running" @tap="start(true)">
        流式（SSEChannel）
      </button>
    </view>
    <view v-if="output !== '' || running" class="spike__output">
      <text>{{ output }}</text>
    </view>
    <view v-if="outcomeLines.length > 0" class="spike__panel">
      <text v-for="line in outcomeLines" :key="line" class="spike__line">{{ line }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.spike {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 24rpx;
  background-color: #16181d;
  display: flex;
  flex-direction: column;
  gap: 20rpx;

  &__hint {
    color: #9aa1ac;
    font-size: 24rpx;
    line-height: 1.6;
  }

  &__input {
    box-sizing: border-box;
    width: 100%;
    min-height: 140rpx;
    padding: 16rpx;
    border-radius: 12rpx;
    background-color: #1f2229;
    color: #e8eaed;
    font-size: 28rpx;
  }

  &__actions {
    display: flex;
    gap: 16rpx;
  }

  &__btn {
    flex: 1;
    font-size: 26rpx;
    background-color: #2a2e37;
    color: #e8eaed;

    &--primary {
      background-color: #ff8c1a;
      color: #16181d;
    }

    &[disabled] {
      opacity: 0.5;
    }
  }

  &__output {
    min-height: 200rpx;
    padding: 20rpx;
    border-radius: 12rpx;
    background-color: #1f2229;
    color: #e8eaed;
    font-size: 28rpx;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
  }

  &__panel {
    padding: 20rpx;
    border-radius: 12rpx;
    background-color: #1f2229;
    display: flex;
    flex-direction: column;
    gap: 8rpx;
  }

  &__line {
    color: #9aa1ac;
    font-size: 24rpx;
  }
}
</style>
