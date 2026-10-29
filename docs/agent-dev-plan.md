# Agent 模块开发计划（uni-ai 流式 + 垂直工具）

> 依据 2026-10 调研结论制定：Agent 编排全部跑在 uniCloud 云函数端，小程序端只做渲染；
> 流式采用 uniCloud 官方 SSEChannel 链路（云对象 + uni-ai + uni-push 2）；
> 垂直能力优先做"数据即工具"（查战绩/查资料库），向量 RAG 与 MCP 延后。
> 调研记录见会话归档，关键事实：支付宝云云函数仅 Node 18（Vercel AI SDK 7 不可用）；
> SSEChannel 不依赖 DCloud 计费网关，自有 apiKey 可用；支付宝云支持 uni-push 2。

## 目标与不做什么

**目标**：把现有 Agent 问答 MVP 升级为「真流式输出 + 可查询项目内数据（战绩缓存/资料库）的垂直助手」，
保持现有校验、限流、错误信封分层不变。

**明确不做**（本计划范围内）：

- 不引入 Vercel AI SDK / LangChain 等编排框架（Node 18 兼容性或体积不划算，uni-ai 已覆盖需求）；
- 不做向量 RAG、Embedding 检索（待攻略类非结构化内容积累后再立项）；
- 不接 MCP / Agent Skills 规范（uni-ai 无此支持，小程序场景优先级低）；
- 不做服务端会话存储（沿用客户端携带上下文 + 本地历史，符合"免费空间落库纪律"）;
- 不在 Agent 工具内直连 arenyze 上游（配额纪律：工具只读 `stats-cache`）。

## 总体架构

```
agent.vue（聊天页：SSEChannel 接收 + 打字机渲染 + 分步状态）
  → src/services/agent.ts          建通道 / 调云对象 / 降级为非流式
  → agent 云对象                    校验 → 限流 → 工具循环编排（新增）
  → agent-core 公共模块             消息校验（保留）+ 工具注册表（新增，纯逻辑含单测）
  → uni-ai LLMManager              provider: openai + proxy（DeepSeek 兼容端点）
  → SSEChannel.write()             token 逐帧推送回客户端
工具实现（新增）：
  - query_player_stats  → 只读 stats-cache 集合（不触发上游请求）
  - search_catalog      → 云端静态目录数据（生成产物，只读检索）
```

凭据纪律不变：apiKey/proxy/model 继续只放 `uni-config-center`（r6-agent 插件，
配置结构按 uni-ai 文档迁移，真实 config.json 保持 gitignore），日志不落密钥。

---

## Phase 0：前置验证 Spike（0.5–1 人日）⚠️ Go/No-Go 关口

SSEChannel 链路在支付宝云免费空间的实际可用性尚未实测，先花半天验证，避免全量开发后返工。

| #   | 任务                                                                                                                                            | 验收标准                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 0.1 | HBuilderX 开通 uni-push 2.0（支付宝云空间）+ manifest 配置                                                                                      | 控制台显示开通成功，客户端能收到测试推送                        |
| 0.2 | 上传 `opendb-tempdata` DB Schema                                                                                                                | 表存在，云函数读写不报"没有这张表"                              |
| 0.3 | 最小 demo：临时云对象调 `LLMManager.chatCompletion({ stream: true, sseChannel })`（自有 key + openai/proxy 指向 DeepSeek），临时页面逐字渲染    | 真机（微信开发者工具 + 手机）看到逐字输出，`on('end')` 正常收尾 |
| 0.4 | 实测云函数超时上限 vs 流式完整时长（max_tokens 900）                                                                                            | 函数超时配置 ≥ 实测流式最长耗时，记录数值                       |
| 0.5 | 验证 CLI 构建（`npm run dev:mp-weixin`）下客户端 SSEChannel API 可用（项目显式 import `@dcloudio/uni-cloud`，需确认该 SDK 版本导出 SSEChannel） | 不开 HBuilderX 运行菜单，终端构建 + 开发者工具可走通流式        |

**Go/No-Go**：0.1–0.5 任一项出现平台级硬伤（push 开不通、SDK 无 SSEChannel、函数超时不够且不可调），
则整体回退到备选路线：维持非流式现状（假流式打字机动画补偿），模型层迁移方案另行评估。
验证通过后删除 demo 代码，结论（含实测数值）回写本文件与 README。

### Phase 0 执行清单（代码已就绪，待空间侧操作）

已交付的代码（Go 决策后删除）：

- `uniCloud-alipay/cloudfunctions/agent-demo/`：Spike 云对象（非流式对照 + 流式两条路径，
  带 `E_NO_CHANNEL_API` / `E_NO_UNI_AI` / `E_CHANNEL_RECOVER_FAIL` 等检查点错误码，
  复用 r6-agent 配置与 agent-core 校验）；
- `src/services/agent-demo.ts`：SSEChannel 客户端调用（`client.SSEChannel` 实例 + 双参数云对象调用）；
- `src/pages/agent/demo.vue`（pages.json 已注册 `pages/agent/demo`）：输入问题 → 两个按钮
  「非流式对照」「流式（SSEChannel）」→ 诊断面板显示 transport / errCode / 首帧 / 总耗时 / 帧数；
- `src/services/cloud.ts`：`getCloudClient` 改为导出（Phase 1 正式实现也需要）。

需要人工执行的空间侧步骤（按序）：

1. [x] HBuilderX 打开项目，确认已登录 DCloud 并关联支付宝云空间；
2. [x] [uniCloud 控制台](https://unicloud.dcloud.net.cn) 对应空间开通 **uni-push 2.0**（已完成）；
3. [x] manifest 已由代码侧配置：`mp-weixin.unipush.enable: true`（CLI 构建据此注入 uni-push 2
       客户端模块，实测依据 `@dcloudio/uni-cli-shared` 的 `isEnableUniPushV2`）；
4. [x] [微信公众平台](https://mp.weixin.qq.com) → 开发管理 → 开发设置 → **socket 合法域名**，
       新增 `wss://wshzn.gepush.com:5223` 与 `wss://wshzn.getui.net:5223`
       （uni-push 小程序端走个推 websocket，官方文档口径）；
5. [x] 创建 `opendb-tempdata` 表（官方 schema 已入库
       `uniCloud-alipay/database/opendb-tempdata.schema.json`，经「上传所有 DB Schema」建表）；
6. [x] HBuilderX 中右键 `agent-demo` 云对象 →「管理公共模块或扩展库依赖」→ 勾选 **uni-cloud-ai**
       与 **uni-cloud-push**（`agent-demo/package.json` 的 `extensions` 已随代码提交；
       `uni-cloud-push` 是 `deserializeSSEChannel` 生效的必要条件——缺它时报
       `E_CHANNEL_RECOVER_FAIL`）；
7. [x] 上传公共模块 `uni-config-center`（r6-agent `config.json` 真实 key 随模块上传）与
       `agent-core`，再上传云对象 `agent-demo`；云函数超时 ≥30 秒；
8. [x] 真机预览（开发版 + vConsole 开发调试模式跳过域名校验）完成两组测试；
9. [x] 数据回传，判定完成（见下）。

### Phase 0 实测结论（2026-10-23，真机：微信开发版 + vConsole）

**判定：Go。** SSEChannel 流式链路在支付宝云免费空间 + 微信小程序真机上完整走通，
未发现平台级硬伤。全部检查点通过：

| 检查点                        | 结果                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| uni-ai 基础链路（非流式对照） | ✅ ok，完整回答 215 字，总耗时 3042–4885ms（三次实测）                                |
| push 注册（GtPush register）  | ✅ 修复 manifest 顶层 appid 为 DCloud 应用 ID 后成功                                  |
| SSEChannel 通道建立           | ✅ 需云对象勾选 uni-cloud-push 扩展库                                                 |
| 流式逐字输出                  | ✅ transport=sse，首帧 3991ms，回答 133 字正常收尾                                    |
| uni-ai 返回结构               | 非流式顶层 `reply` 字段为完整回答；`choices[].message.content` 同步存在               |
| 云函数超时                    | max_tokens 900 未实测触顶（本次 max_tokens 200 下总耗时 ≤5s），Phase 1 沿用 ≥30s 配置 |

过程中的关键排障记录（Phase 1 与后续维护参考）：

- `manifest.json` **顶层 `appid` 必须是 DCloud 应用 ID（`__UNI__` 前缀）**，微信 appid 只放
  `mp-weixin.appid`——push 注册上报的是顶层 appid（`getAppBaseInfo` → `UNI_APP_ID`），
  两处都填微信 appid 会导致 `GtPush register fail errorCode 1`；
- 云对象缺 **uni-cloud-push** 扩展库时，`uniCloud.deserializeSSEChannel` 会抛异常
  （`E_CHANNEL_RECOVER_FAIL`），流式通道无法还原；
- 开发者工具走系统代理会导致云函数与个推 websocket 全部 `ERR_TIMED_OUT`
  （工具代理设置改为「不使用任何代理」解决）；
- 微信开发者工具预览版（2.02.2609231）存在模拟器卡死、真机调试 electron 缺失、
  预览「运行环境失败」等问题，真机验收一律用**预览二维码 + 开发调试模式**。

Spike 代码（agent-demo 云对象、agent-demo.ts、demo.vue、Spike 入口）保留至 Phase 1
流式实现真机验收通过后一并删除。

## 首字延迟优化与思维链展示（2026-10-23 已实施）

与 Phase 1 同批落地的两项增强，改动集中在 agent-core / agent 云对象 / `src/services/agent.ts` / `agent.vue`：

**首字延迟**：

- **通道预热**：`warmAgentChannel()` 在页面 `onShow` 与每轮请求结束后立即建好 SSEChannel，
  个推 websocket 握手从发送后的首字路径整体移除。预热通道 TTL 2 分钟（超期可能被服务端回收，
  发送时自动重建）；通道不可用仍走降级为非流式的既有路径。
- **限流快速路径**：`agent-usage` 计数改为单次条件更新（`where _id + bucket + count<20` → `inc`），
  命中即返回省掉一次读往返；未命中（新来源 / 跨天 / 已达上限）回退到读-改-写慢路径。
- **待人工（空间侧）**：云函数保活定时触发器尚未配置（压冷启动，约 288 次调用/天），
  配置后需按配额纪律回写口径。

**思维链展示**：

- 帧协议：云端 SSEChannel 帧统一为 JSON 文本 `{"t":"think"|"answer","d":"..."}`（`agent-core encodeFrame`），
  思维链取自 `reasoning_content`（DeepSeek 风格，防御性提取），与最终回答分开推送；
  客户端对非 JSON 纯文本帧按 answer 处理（兼容旧版云对象未上传的场景，只渲染不展示思维链）。
- 页面：思考阶段流式渲染思维链（脉冲标题 + 增量正文）；首个回答帧到达后折叠为
  「已深度思考（N 秒）」可展开/收起；模型不输出思维链时页面自动退化为原问答行为。
- 口径：思维链只做本地渲染，不回传上下文（与 DeepSeek 多轮丢弃 CoT 的口径一致）；
  非流式降级时思维链随最终响应整段返回。历史思维链字段不落库。
- ⚠️ 生效条件：HBuilderX 重新上传 `agent-core` 公共模块与 `agent` 云对象，小程序端发版。

**真机回归修正（2026-10-23 第二轮）**：

- **回答截断**：`MAX_OUTPUT_TOKENS` 900 → **2000**（实测长回答在 ~900 token 处被静默截断，
  流正常 end、无错误提示）；
- **流式守卫改口径**：总时长 25s 会误杀长回答，改为**帧间空闲 15s**（`STREAM_IDLE_GUARD_MS`，
  每帧重置，首帧前等待同样受约束；连续无帧才报「模型响应中断」）；
- **云函数超时必须 ≥60s**（人工步骤，uniCloud 控制台 agent 云函数详情页调整）：
  2000 token 流式总时长可达数十秒，30s 配置下长回答会死于函数超时；
- **思维链未显示（已定位，源码级根因）**：uni-ai（uni-cloud-ai 1.1.23，HBuilderX 插件目录
  `plugins/unicloud/internal-functions/common/uni-cloud-ai`）的流式累加器把 `delta.reasoning_content`
  只喂给内部缓冲，以**独立事件 `reasoningMessage`** 实时下发（payload 为字符串增量），
  不经过 `message` 事件——只订阅 `message` 就表现为「无思考内容」。`runModelCall` 已补订阅。
  非流式路径思维链在顶层 `reasoningReply`（choices 内为驼峰 `reasoningContent`），
  `extractReasoning` 已覆盖。DeepSeek 官方文档确认 `deepseek-flash` 思考模式默认开启
  （effort 默认 high），无需换模型；思考模式下 temperature 等采样参数被忽略（保留作非思考回退）。
  uni-ai 的 `chatCompletion` 会透传未知参数（`thinking`/`reasoning_effort` 可经 options 直达上游），
  当前依赖默认值不显式传。两条一次性诊断日志（首个载荷 / 首个思维链增量）真机确认后移除。

## Phase 1：模型层迁移 uni-ai + 真流式（2–3 人日）

**云端**：

- agent 云对象勾选 uni-cloud-ai 扩展库依赖（写入云对象 package.json 随代码提交）；
- `agent-core`：保留 `validateMessages`；`requestModel` 替换为 uni-ai 适配层
  （`LLMManager.chatCompletion`，provider/proxy/model 从 uni-config-center 读取）；
- `chat` 方法签名扩展：接收 `sseChannel` 参数（`deserializeSSEChannel` 还原），
  通道存在 → 流式逐帧 `write`，不存在 → 返回完整 `answer`（兼容降级）；
- 每帧推送做 try/catch：推送失败不中断生成，最终结果仍可整段返回（降级须留日志说明）。

**客户端**：

- `src/services/agent.ts` 新增流式入口：`new uniCloud.SSEChannel()` → `open()` → 携带通道调云对象；
  通道创建失败自动降级现有 `askAgent` 非流式路径；
- `agent.vue`：消息流式追加渲染（打字机）、生成中状态、中断/重试；
  参考 uni-ai-chat 模板的流解析逻辑（只抄逻辑不引 UI，不违反组件库单一来源约束）；
- 乱序/粘包按模板既有处理方式对齐，真机弱网过一遍。

**测试与验收**：

- `agent-core` 单测改写：mock LLMManager，覆盖流式帧序、空回答、上游错误信封（沿用 `{ errCode, errMsg }`）；
- 限流口径调整：**额度按用户消息计**（一次提问含全部工具轮次 = 1 次，仍 20 次/日），
  `agent-usage` 文档增加观测字段（累计上游调用数），schema 同步更新；
- `npm run verify` 全绿；真机验收：流式观感、断网/超时/限流三种错误面板、
  H5 端不回归（SSEChannel 不支持的平台自动走非流式）。

## Phase 2：垂直工具（3–5 人日）——价值最大的一步

**数据可达性（先决条件）**：

- 扩展 `scripts/generate-static-data.mjs`：除 `src/static/gen` 外，同步产出一份云端只读副本
  到 `uniCloud-alipay/cloudfunctions/common/catalog-data/`（生成产物，禁止手工编辑，写入维护规范）；
  先核对产物体积（预估 1–2 MB 内，云函数打包无压力）；
- `search_catalog` 工具：按类目 + 关键词检索目录条目，返回名称/精简字段，单测覆盖匹配逻辑。

**战绩工具**：

- `query_player_stats(platform, username)`：只读 `stats-cache` 集合（云函数管理面访问）；
  缓存未命中时**不**触发上游请求，返回引导话术（"请先在战绩页查询该玩家"）——配额纪律优先；
- 返回字段做白名单裁剪（RP/MMR/胜率/段位/近期趋势摘要），控制 token 消耗。

**工具循环编排（agent-core 新增，纯逻辑 + 单测）**：

- 注册表式工具定义（name/description/parameters schema/prompt 描述）；
- 循环上限常量 `MAX_TOOL_ROUNDS = 4`，超限强制收敛回答；
- 每个 toolCall 的执行结果回传 tool 消息，循环逻辑独立成函数，mock LLM 全量单测；
- system prompt 更新：声明可用工具与使用时机，保留 R6 领域限定与"不确定不编造"约束。

**验收**：真机走通"帮我查 XX 的战绩 / XX 干员怎么用"两类典型问答；
工具命中与未命中（无缓存）两种路径都有确定性表现；`npm run verify` 全绿。

## Phase 3：体验完善与文档同步（2–3 人日）

- 会话体验：本地聊天历史持久化（沿用 recent-search 的本地存储封装模式）、
  新会话入口、上下文条数沿用 16 条上限；
- 分步状态：工具调用期间展示"正在查询战绩…"等中间状态（stream annotations 或独立事件帧）；
- README「当前状态与下一步」清单补齐电竞首版界面、Agent MVP、本计划各阶段勾选项；
- AGENTS.md 增补：catalog-data 云端副本的维护口径、agent 额度按消息计的说明；
- 真机全量回归：微信开发者工具 + 安卓/iOS 真机，覆盖流式、工具、降级、限流四条链路。

## Phase 4（延后立项，不在本计划内）

- 轻量 RAG：攻略/地图点位等非结构化文本，embedding + 云函数内余弦检索（uniCloud 无向量库）；
- 个性化：结合收藏玩家做"我的战绩分析"类工具；
- 观察 uni-ai 生态的 MCP / Agent Skills 进展，必要时再评估接入。

## 风险与对策

| 风险                                                                    | 对策                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 支付宝云免费空间 uni-push 2 实际开通受阻                                | Phase 0 关口先行，硬伤即回退非流式路线，损失仅半天                     |
| 流式时长超出云函数超时上限                                              | Phase 0 实测；必要时下调 max_tokens / 收敛回答长度                     |
| uni-ai openai/proxy 对 DeepSeek 兼容端点的细节差异（如 reasoning 字段） | Phase 0 demo 即用真实端点验证；适配层集中在 agent-core，差异只改一处   |
| 工具轮次放大上游 token 成本                                             | 轮次上限 4、结果白名单裁剪、额度按消息计 + 观测字段监控                |
| CLI 构建与 HBuilderX 扩展库勾选的流程摩擦                               | 云对象 package.json 随代码提交依赖声明；上传仍走 HBuilderX（现状不变） |
| SSEChannel 在 H5/其他端不可用                                           | 通道创建失败自动降级非流式，降级路径有单测与真机用例                   |

## 里程碑汇总

| 阶段 | 内容                 | 预估       | 交付判据                                |
| ---- | -------------------- | ---------- | --------------------------------------- |
| P0   | Spike 验证           | 0.5–1 人日 | 五项验证通过，Go 决策落档               |
| P1   | uni-ai 迁移 + 真流式 | 2–3 人日   | 真机逐字渲染，降级链路可用，verify 全绿 |
| P2   | 垂直工具             | 3–5 人日   | 战绩/资料库两类问答真机走通             |
| P3   | 体验 + 文档          | 2–3 人日   | 全量真机回归，README/AGENTS 同步        |

合计约 8–12 人日。每阶段结束跑 `npm run verify`；涉及真机验收的项在 README 勾选，
格式/类型检查通过不等于功能验收通过（按仓库交付纪律执行）。
