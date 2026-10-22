# R6-Helper

彩虹六号战绩查询小程序。技术栈：uni-app（Vue 3 + Vite + TypeScript）+ uniCloud（支付宝云服务空间），主交付端为微信小程序。旧版原生 WXML 仓库（R6Helper）已冻结，作为行为与数据口径的参照。

维护规范见 [AGENTS.md](./AGENTS.md)。

## Agent 模型配置

Agent 页面通过 `uniCloud-alipay/cloudfunctions/agent` 调用 OpenAI Chat Completions 兼容接口，模型凭据只放在云端配置中心。

部署前复制 `uniCloud-alipay/cloudfunctions/common/uni-config-center/r6-agent/config.example.json` 为同目录的 `config.json`，填写 `apiKey`、`baseUrl`、`model`，并可选填写 `systemPrompt`。示例采用 DeepSeek 的 `https://api.deepseek.com` 与 `deepseek-flash`；其他兼容供应商应填写其对应的根地址和模型名。

随后上传 `common/uni-config-center`、`common/agent-core` 和 `agent` 云对象，并上传 `uniCloud-alipay/database/agent-usage.schema.json`。首版按短会话调用，不保存聊天记录，每个来源每日最多调用 20 次，单条消息最多 1200 字，最多携带 16 条上下文消息。当前以系统提示词限定 R6 领域回答，尚未接入检索知识库或版本实时数据。

## 目录结构

```
├─ AGENTS.md                        # 代码与协作规范
├─ data/                            # 静态图片资产源（操作员/武器/战队/联赛/地图/皮肤/挂件，只读）
├─ scripts/
│  ├─ generate-static-data.mjs      # 静态数据生成脚本（源清单 + 图片 → src/static/gen）
│  ├─ fetch-arenyze-metadata.mjs    # arenyze 元数据一次性烘焙（maps/skins/charms 源清单）
│  ├─ upload-assets-to-unicloud.mjs # 图鉴图片批量上传云存储（配合 asset-import 云函数）
│  ├─ lib/arenyze-metadata.mjs      # 元数据归一化纯逻辑（含回归测试）
│  └─ source/                       # 静态数据源清单（改数据先改这里；maps/skins/charms 由烘焙生成）
├─ src/
│  ├─ config/env.ts                 # 空间与资源地址唯一读取点（真实凭据在 .env.local）
│  ├─ pages/                        # 页面：战绩 / 电竞 / 资料库 / Agent / 个人中心 五个 tab + 战绩详情
│  ├─ services/                     # 云对象调用、静态目录、本地查询历史与收藏玩家的统一封装
│  ├─ styles/                       # Wot UI 主题变量映射（$r6 色板 → wd- 组件）
│  ├─ types/                        # 领域类型（stats 契约转发自 stats-core）与错误模型
│  ├─ utils/                        # 纯展示格式化逻辑（可独立单测）
│  └─ static/gen/                   # 生成产物，禁止手工编辑
├─ uniCloud-alipay/
│  ├─ cloudfunctions/
│  │  ├─ agent/                      # Agent 云对象：兼容 Chat Completions 请求 + 云端限流
│  │  ├─ stats/                     # stats 云对象：参数校验 + 缓存读写 + 编排
│  │  ├─ asset-import/              # 图鉴资产一次性导入（URL 化 + token，配合上传脚本）
│  │  └─ common/
│  │     ├─ stats-core/             # 归一化与上游适配纯逻辑（口径唯一来源，含回归测试）
│  │     ├─ agent-core/              # Agent 消息校验与模型协议请求（含回归测试）
│  │     └─ uni-config-center/      # 云函数配置中心（r6-upstream / asset-import 真实 config.json 已 gitignore）
│  └─ database/                     # DB Schema（stats-cache / agent-usage，权限默认拒绝）
```

## 快速开始

```bash
npm install
cp .env.example .env.local # 填入 uniCloud 空间凭据（本机文件，已被 git 忽略）
npm run gen:static-data    # 重新生成 src/static/gen（改了 data/ 或源清单后）
npm run dev:mp-weixin      # 产物在 dist/dev/mp-weixin，用微信开发者工具导入
npm run build:mp-weixin    # 生产构建 dist/build/mp-weixin
```

## 验证与交付

```bash
npm run verify            # format:check + lint + type-check + test
```

- 战绩归一化的回归用例在 `uniCloud-alipay/cloudfunctions/common/stats-core/__tests__/`，改动口径必须先补用例。
- H5 / HTML 预览不能替代微信开发者工具与真机验证。
- 已知噪音：Sass 旧版 JS API 弃用告警已在 `vite.config.ts` 通过 `silenceDeprecations` 静默；后续升级 Vite ≥ 5.4 时应切换到 `api: 'modern-compiler'` 并移除该配置。

## uniCloud 接入步骤

1. 配置空间凭据：复制 `.env.example` 为 `.env.local` 填写（真实值不进仓库，[src/config/env.ts](./src/config/env.ts) 是类型层面唯一读取点）。
   注意：支付宝云空间**没有 `clientSecret`**（那是阿里云空间的参数），需要的是 `spaceId` + `accessKey` + `secretKey` + `spaceAppId` 四项，均在 [uniCloud 控制台](https://unicloud.dcloud.net.cn)对应空间的「服务空间详情」页查看。
2. 用 HBuilderX 打开项目并登录 DCloud 账号，右键 `uniCloud-alipay` 目录 →「关联云服务空间或项目…」选择你的支付宝云空间，然后上传：
   - 公共模块 `uniCloud-alipay/cloudfunctions/common/uni-config-center/`（右键 →「上传公共模块」；`r6-upstream/config.json` 随模块一起上传，**修改 key 后必须重新上传该模块**）；
   - 公共模块 `uniCloud-alipay/cloudfunctions/common/stats-core/`；
   - 云对象 `uniCloud-alipay/cloudfunctions/stats/`（其 `package.json` 以 `file:` 引用上述两个公共模块）；
   - DB Schema `uniCloud-alipay/database/stats-cache.schema.json`（客户端读写全部拒绝，仅云函数经管理面访问）。
3. 客户端 SDK 说明：CLI 构建不会自动注入 uniCloud 运行时（那依赖 HBuilderX 运行菜单），项目在 `src/services/cloud.ts` 中显式 import `@dcloudio/uni-cloud` 并用 `.env.local` 的空间配置初始化，因此终端 `npm run dev:mp-weixin` 联调不依赖 HBuilderX；HBuilderX 的关联仅用于上传云函数与 Schema。
4. 上游数据源为 arenyze（`https://public-api.arenyze.com/r6/api`，Ubisoft 数据的第三方代理，需 API key）：把 key 填入 `uniCloud-alipay/cloudfunctions/common/uni-config-center/r6-upstream/config.json`（结构参考同目录 `config.example.json`，真实文件已 gitignore，禁止提交），**填完后重新上传 uni-config-center 公共模块**。apiKey 为空或未配置时 `stats` 云对象按 `E_UPSTREAM_NOT_CONFIGURED` 降级，云端日志会输出具体原因（模块缺失 / 配置缺失 / key 为空）。arenyze 免费档每月 2000 次调用，`stats-cache` 有效期内强制命中缓存是配额纪律的一部分，请勿调短 TTL 或绕过缓存直连上游。
5. 微信端联调前，把 `https://{spaceId}.api-hz.cloudbasefunction.cn`（spaceId 替换为实际值）加入小程序 request 合法域名。
6. 图片资产上传到云存储（控制台无文件夹上传/文件夹模式，目录结构由云函数保持）：
   1. 生成导入 token：本地 `uniCloud-alipay/cloudfunctions/common/uni-config-center/asset-import/config.json`（结构参考同目录 `config.example.json`，真实文件已 gitignore，可用 `openssl rand -hex 24` 生成 token）；
   2. HBuilderX 重新上传 uni-config-center 公共模块（携带上一步 token），再上传云函数 `uniCloud-alipay/cloudfunctions/asset-import/`；
   3. 在 uniCloud 控制台为 `asset-import` 开启「云函数 URL 化」，把地址填入 `.env.local` 的 `UNICLOUD_ASSET_IMPORT_URL`；
   4. `npm run gen:upload-assets -- --dry-run` 核对计划后去掉 `--dry-run` 实际上传（253 张约 12MB，自动分批 + 失败重试）；完成后脚本会输出每类目下载地址样例；
   5. 从输出 URL 推导前缀填入 `.env.local` 的 `VITE_ASSET_BASE_URL`（可用 `npm run gen:upload-assets -- --check-base <前缀>` 验证拼接可访问），并把存储域名加入小程序 downloadFile 合法域名；
   6. 迁移完成后建议在控制台关闭 `asset-import` 的 URL 化（函数保留以备增量重传）。若 `VITE_ASSET_BASE_URL` 留空，图鉴条目降级为首字母占位块（`maps/skins/charms` 上游无图源，补图前持续如此）。

## 数据口径（与旧版对齐，改动需先补回归用例）

- RP 与 MMR 是独立维度，字段分开存放，互不推断（arenyze `/v2/profile` 不提供 MMR，保持未知）；
- 未知数据一律 `null`，展示层渲染为 `—`，禁止填零；
- 比例字段（winRate / hsPercent）统一为 0..1 口径，上游百分数由 stats-core 的 `normalizeRatio` 换算；
- `ranked.rpHistory` 是当前赛季 RP 随时间变化序列（RP 趋势折线图数据源），上游缺失时为空数组；点数上限 500；
- “当前赛季”各模式（ranked / unranked / casual / event）只取当前赛季分段，不做历史回退；往赛季数据走独立的 `seasonHistory` 出口（排除当前赛季，按赛季号降序，同赛季多地区分段取场次数最多的一条，只收排位分段），不参与当前赛季兜底；
- 赛季最高段位名（`ranked.rank.max`）取 RP 历史中 RP 最高的带名时点；往赛季只有结算段位名与结算/最高 RP（上游分段无最高段位名口径）；
- 干员统计来自 `/v2/operators?modes=all`（当前赛季、全模式聚合），条目按出场回合数降序；arenyze 未提供按玩家的地图统计端点，「地图统计」卡片为占位展示；
- 上游平台口径映射：应用侧 `pc / psn / xbox` → arenyze `uplay / psn / xbl`，映射只发生在 stats-core 适配器内；
- arenyze 未提供逐场对局端点，详情页「对局记录」入口置灰，待数据源支持后启用；
- 战绩查询必须走 `stats-cache` 缓存：主战绩 TTL 10 分钟（`stats-core.STATS_CACHE_TTL_MS`），干员统计独立缓存键（`_ops` 后缀）TTL 30 分钟（`stats-core.OPERATORS_CACHE_TTL_MS`），有效期内不重复请求上游；
- 云对象响应约定（实测 2026-10，依据客户端 SDK 传输层源码）：支付宝云 transport 把函数返回值原样作为 result 交给 importObject；`result.errCode` 为真值即被 SDK 视为业务错误抛出（错误码与消息完整保留），否则 result 原样返回给调用方。因此成功载荷不带 errCode（`{ ok: true, ... }`），业务错误返回 `{ errCode, errMsg }`，客户端经 `unwrapCloudResult` / `toAppError` 收敛；客户端以 `customUI: true` 调用，自行渲染错误面板。禁止在成功载荷携带 errCode（含 `'OK'`，会被误判为错误并弹空提示框）。

## 静态数据维护

- 操作员/联赛：图片放 `data/operators|leagues/`，同时维护 `scripts/source/` 源清单，脚本做双向对齐校验（缺清单或缺图即失败）。
- 武器/战队：仅需放图，展示名由 id 派生（后续如需精确命名再进源清单）。
- 地图/皮肤/挂件：源清单由 `npm run gen:fetch-metadata` 从 arenyze 元数据端点一次性烘焙（`/maps`、`/universalSkins`、`/charms`，每次消耗 3 次月度配额，勿频繁重跑），构建期离线；三个端点均**无图片字段**，图片为人工后补的 `data/maps|skins|charms/` 本地资产，缺图条目 `image` 为 `null`、展示层走占位块，补图后重跑 `npm run gen:static-data` 即自动亮图。
- 图片托管：见「uniCloud 接入步骤」第 6 步（`asset-import` 云函数 + `npm run gen:upload-assets`）。

## 当前状态与下一步

- [x] 工程骨架、校验链路（format/lint/type-check/test）、微信端构建
- [x] stats 云对象 + 缓存 Schema + 归一化公共模块（含战绩归一化回归用例）
- [x] 云链路联调验证（开发者工具）：客户端 SDK 初始化 → 云对象 → 参数校验 → 缓存读取 → 错误信封
- [x] 五板块信息架构：战绩 / 电竞 / 资料库 / Agent / 个人中心
- [x] arenyze 上游适配 + RP 趋势图表（uCharts）+ 收藏玩家（本地存储）
- [x] M3 资料库补全：地图 / 皮肤 / 挂件（arenyze 元数据一次性烘焙，含回归用例）+ 资料库五 tab
- [x] 图片托管工具链：asset-import 云函数（URL 化 + token）+ 批量上传脚本，`VITE_ASSET_BASE_URL` 填入前缀即亮图
- [ ] 图片资产实际上传执行与真机亮图验证（工具链就绪，按「uniCloud 接入步骤」第 6 步操作）
- [ ] arenyze 真实 key 联调与真机回归（适配器按官方文档字段实现，首次真实响应如与文档有差异需校准 extract 系列函数并补用例）
- [ ] 电竞模块（Liquipedia 数据源） / 个人中心（微信登录 + 收藏云同步）
