<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';

import {
  askAgentStream,
  stopAgentStream,
  warmAgentChannel,
  type AgentFrame,
  type AgentMessage,
} from '@/services/agent';

/** 页面消息模型：reasoning/thinking 只用于本地渲染，不随上下文回传云端。 */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning: string;
  thinking: boolean;
  thinkExpanded: boolean;
  thinkMs: number | null;
}

const messages = ref<ChatMessage[]>([]);
const draft = ref('');
const loading = ref(false);
const scrollIntoView = ref('');
const canSend = computed(() => draft.value.trim() !== '' && !loading.value);
const sendButtonLabel = computed(() => (loading.value ? '停止' : '发送'));
const sendButtonDisabled = computed(() => !loading.value && !canSend.value);

/** 代际计数：停止或重新发送后，旧请求的帧回调与收尾逻辑全部失效 */
let generation = 0;

// 进入页面即预建流式通道，个推握手不占用发送后的首字延迟
onShow(() => {
  warmAgentChannel();
});

async function scrollToLatest(): Promise<void> {
  await nextTick();
  scrollIntoView.value = `message-${messages.value.length - 1}`;
}

function createChatMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content, reasoning: '', thinking: false, thinkExpanded: false, thinkMs: null };
}

function applyFrame(message: ChatMessage, frame: AgentFrame, startedAt: number): void {
  if (frame.type === 'think') {
    message.reasoning += frame.text;
    return;
  }
  message.content += frame.text;
  if (message.thinkMs === null) {
    message.thinkMs = Date.now() - startedAt;
  }
  message.thinking = false;
}

function showThinkBlock(message: ChatMessage): boolean {
  return message.role === 'assistant' && (message.thinking || message.reasoning !== '');
}

function showThinkBody(message: ChatMessage): boolean {
  return message.thinking || message.thinkExpanded;
}

function thinkLabel(message: ChatMessage): string {
  if (message.thinking) {
    return '深度思考中…';
  }
  if (message.thinkMs === null) {
    return '已深度思考';
  }
  return `已深度思考（${(message.thinkMs / 1000).toFixed(1)} 秒）`;
}

function toggleThink(message: ChatMessage): void {
  message.thinkExpanded = !message.thinkExpanded;
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
  messages.value.push(createChatMessage('user', content));
  // 占位消息入数组后必须从数组取回响应式代理：直接改原始对象不触发渲染（会整块出现）
  const placeholder = createChatMessage('assistant', '');
  placeholder.thinking = true;
  messages.value.push(placeholder);
  const reply = messages.value[messages.value.length - 1];
  loading.value = true;
  const currentGeneration = ++generation;
  const startedAt = Date.now();
  await scrollToLatest();

  try {
    // 占位的 assistant 消息不发给云端（校验要求末条必须是 user）；思维链字段不回传上下文
    const input: AgentMessage[] = messages.value
      .slice(0, -1)
      .slice(-16)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    const { answer, reasoning } = await askAgentStream(input, (frame) => {
      if (currentGeneration !== generation) {
        return;
      }
      applyFrame(reply, frame, startedAt);
      void scrollToLatest();
    });
    if (currentGeneration !== generation) {
      return;
    }
    // 通道降级（transport=plain）或帧全部为空时，用最终回答与思维链补显
    if (reply.reasoning === '' && reasoning !== '') {
      reply.reasoning = reasoning;
    }
    reply.content = reply.content !== '' ? reply.content : answer;
    reply.thinking = false;
  } catch (error) {
    if (currentGeneration !== generation) {
      return;
    }
    const message = error instanceof Error ? error.message : '请求失败，请稍后重试';
    uni.showToast({ title: message, icon: 'none', duration: 2600 });
    if (reply.content === '') {
      messages.value.pop();
    }
  } finally {
    if (currentGeneration === generation) {
      loading.value = false;
      await scrollToLatest();
    }
  }
}

function stopStreaming(): void {
  stopAgentStream();
  generation += 1;
  loading.value = false;
  const last = messages.value[messages.value.length - 1];
  if (last && last.role === 'assistant') {
    last.thinking = false;
    if (last.content === '') {
      last.content = '（已停止生成）';
    }
  }
}

function onComposerAction(): void {
  if (loading.value) {
    stopStreaming();
    return;
  }
  void sendMessage();
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
      <!-- TEMP: Phase 0 Spike 入口，Go 决策后随 demo 页一起删除 -->
      <navigator class="agent-spike-link" url="/pages/agent/demo">Spike</navigator>
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
          <view class="message-bubble" :class="{ 'message-bubble--typing': message.thinking }">
            <view v-if="showThinkBlock(message)" class="think">
              <view class="think__header" @tap="toggleThink(message)">
                <text
                  class="think__label"
                  :class="{ 'think__label--thinking': message.thinking }"
                  >{{ thinkLabel(message) }}</text
                >
                <text v-if="!message.thinking" class="think__toggle">{{
                  message.thinkExpanded ? '收起' : '展开'
                }}</text>
              </view>
              <view v-if="showThinkBody(message)" class="think__body">
                <text>{{ message.reasoning !== '' ? message.reasoning : '正在思考…' }}</text>
              </view>
            </view>
            <text v-if="message.content !== ''">{{ message.content }}</text>
            <text v-else-if="!showThinkBlock(message)">正在思考…</text>
          </view>
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
      <button class="composer__send" :disabled="sendButtonDisabled" @tap="onComposerAction">
        {{ sendButtonLabel }}
      </button>
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

/* TEMP: Phase 0 Spike 入口样式，随入口一起删除 */
.agent-spike-link {
  align-self: center;
  margin-left: 16rpx;
  padding: 4rpx 14rpx;
  border: 1rpx solid $r6-border;
  border-radius: 999rpx;
  color: $r6-text-secondary;
  font-size: 20rpx;
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

.think {
  margin-bottom: 16rpx;
  padding: 14rpx 18rpx;
  border-left: 4rpx solid $r6-border;
  border-radius: 6rpx;
  background: $r6-bg;
}

.think__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.think__label {
  color: $r6-text-secondary;
  font-size: 22rpx;
}

.think__label--thinking {
  animation: think-pulse 1.4s ease-in-out infinite;
}

.think__toggle {
  color: $r6-text-secondary;
  font-size: 20rpx;
}

.think__body {
  margin-top: 12rpx;
  color: $r6-text-secondary;
  font-size: 23rpx;
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

@keyframes think-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
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
