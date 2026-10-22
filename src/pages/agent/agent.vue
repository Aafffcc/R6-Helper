<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';

import { askAgent, type AgentMessage } from '@/services/agent';

const messages = ref<AgentMessage[]>([]);
const draft = ref('');
const loading = ref(false);
const scrollIntoView = ref('');
const canSend = computed(() => draft.value.trim() !== '' && !loading.value);

async function scrollToLatest(): Promise<void> {
  await nextTick();
  scrollIntoView.value = `message-${messages.value.length - 1}`;
}

async function sendMessage(text = draft.value): Promise<void> {
  const content = text.trim();
  if (content === '' || loading.value) {
    return;
  }
  if (content.length > 1200) {
    uni.showToast({ title: '单条消息最多 1200 字', icon: 'none' });
    return;
  }

  draft.value = '';
  messages.value.push({ role: 'user', content });
  loading.value = true;
  await scrollToLatest();

  try {
    const answer = await askAgent(messages.value.slice(-16));
    messages.value.push({ role: 'assistant', content: answer });
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求失败，请稍后重试';
    uni.showToast({ title: message, icon: 'none', duration: 2600 });
  } finally {
    loading.value = false;
    await scrollToLatest();
  }
}
</script>

<template>
  <view class="agent-page">
    <view class="agent-header">
      <view>
        <text class="agent-header__title">R6 战术助手</text>
        <text class="agent-header__subtitle">干员、地图与战术讨论</text>
      </view>
      <view class="agent-status"><view class="agent-status__dot" />AI</view>
    </view>

    <scroll-view
      class="conversation"
      scroll-y
      :scroll-into-view="scrollIntoView"
      scroll-with-animation
    >
      <view v-if="messages.length === 0" class="welcome">
        <text class="welcome__title">今天想研究什么？</text>
        <text class="welcome__copy">可以聊干员定位、地图点位、阵容搭配和基础战术。</text>
        <view class="suggestions">
          <button class="suggestion" @tap="sendMessage('进攻俱乐部会所二楼，怎么组织默认进攻？')">
            会所二楼怎么进攻？
          </button>
          <button class="suggestion" @tap="sendMessage('防守方如何搭配反切位？')">
            如何搭配反切位？
          </button>
          <button class="suggestion" @tap="sendMessage('新手练习信息位有哪些干员？')">
            新手信息位干员
          </button>
        </view>
      </view>

      <view v-else class="message-list">
        <view
          v-for="(message, index) in messages"
          :id="`message-${index}`"
          :key="index"
          class="message-row"
          :class="`message-row--${message.role}`"
        >
          <view class="message-bubble">{{ message.content }}</view>
        </view>
        <view v-if="loading" id="message-loading" class="message-row message-row--assistant">
          <view class="message-bubble message-bubble--typing">正在组织回答…</view>
        </view>
      </view>
      <view class="scroll-anchor" />
    </scroll-view>

    <view class="composer">
      <textarea
        v-model="draft"
        class="composer__input"
        :maxlength="1200"
        :auto-height="true"
        :adjust-position="true"
        placeholder="问问 R6 战术助手"
        confirm-type="send"
        @confirm="sendMessage()"
      />
      <button class="composer__send" :disabled="!canSend" @tap="sendMessage()">发送</button>
    </view>
    <text class="disclaimer">回答由 AI 生成，请结合当前版本与实战判断</text>
  </view>
</template>

<style lang="scss" scoped>
.agent-page {
  display: flex;
  height: 100vh;
  flex-direction: column;
  background: $r6-bg;
  color: $r6-text-primary;
}

.agent-header {
  display: flex;
  min-height: 112rpx;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 32rpx;
  border-bottom: 1rpx solid $r6-border;
}

.agent-header__title,
.agent-header__subtitle {
  display: block;
}

.agent-header__title {
  font-size: 34rpx;
  font-weight: 700;
}

.agent-header__subtitle {
  margin-top: 8rpx;
  color: $r6-text-secondary;
  font-size: 23rpx;
}

.agent-status {
  display: flex;
  align-items: center;
  gap: 10rpx;
  color: $r6-text-secondary;
  font-size: 22rpx;
}

.agent-status__dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: $r6-success;
}

.conversation {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  padding: 32rpx 28rpx 20rpx;
}

.welcome {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 24rpx 8rpx 80rpx;
}

.welcome__title {
  font-size: 38rpx;
  font-weight: 700;
}

.welcome__copy {
  margin-top: 16rpx;
  color: $r6-text-secondary;
  font-size: 26rpx;
  line-height: 1.6;
}

.suggestions {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 14rpx;
  margin-top: 36rpx;
}

.suggestion {
  width: 100%;
  margin: 0;
  padding: 18rpx 22rpx;
  border: 1rpx solid $r6-border;
  border-radius: 8rpx;
  background: $r6-surface;
  color: $r6-text-primary;
  font-size: 25rpx;
  line-height: 1.45;
  text-align: left;
}

.suggestion::after,
.composer__send::after {
  border: 0;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.message-row {
  display: flex;
  width: 100%;
}

.message-row--user {
  justify-content: flex-end;
}

.message-bubble {
  max-width: 84%;
  padding: 20rpx 24rpx;
  border: 1rpx solid $r6-border;
  border-radius: 10rpx;
  background: $r6-surface;
  color: $r6-text-primary;
  font-size: 27rpx;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.message-row--user .message-bubble {
  border-color: rgba(255, 140, 26, 0.4);
  background: rgba(255, 140, 26, 0.14);
}

.message-bubble--typing {
  color: $r6-text-secondary;
}

.scroll-anchor {
  height: 12rpx;
}

.composer {
  display: flex;
  align-items: flex-end;
  gap: 16rpx;
  margin: 0 24rpx;
  padding: 16rpx;
  border: 1rpx solid $r6-border;
  border-radius: 12rpx;
  background: $r6-surface;
}

.composer__input {
  box-sizing: border-box;
  flex: 1;
  min-height: 68rpx;
  max-height: 220rpx;
  padding: 14rpx 4rpx;
  color: $r6-text-primary;
  font-size: 27rpx;
  line-height: 1.5;
}

.composer__send {
  flex: 0 0 112rpx;
  height: 68rpx;
  margin: 0;
  padding: 0;
  border-radius: 8rpx;
  background: $r6-accent;
  color: $r6-bg;
  font-size: 25rpx;
  line-height: 68rpx;
}

.composer__send[disabled] {
  background: $r6-surface-raised;
  color: $r6-text-secondary;
}

.disclaimer {
  padding: 14rpx 0 calc(14rpx + env(safe-area-inset-bottom));
  color: $r6-text-secondary;
  font-size: 20rpx;
  text-align: center;
}
</style>
