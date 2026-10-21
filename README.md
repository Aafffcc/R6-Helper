# R6-Helper

彩虹六号战绩查询小程序。技术栈：uni-app（Vue 3 + Vite + TypeScript）+ uniCloud（支付宝云服务空间），主交付端为微信小程序。旧版原生 WXML 仓库（R6Helper）已冻结，作为行为与数据口径的参照。

维护规范见 [AGENTS.md](./AGENTS.md)。

## 目录结构

```
├─ AGENTS.md                        # 代码与协作规范
├─ data/                            # 静态图片资产源（操作员/武器/战队/联赛，只读）
├─ scripts/
│  ├─ generate-static-data.mjs      # 静态数据生成脚本（源清单 + 图片 → src/static/gen）
│  └─ source/                       # 静态数据源清单（改数据先改这里）
├─ src/
│  ├─ config/env.ts                 # 空间与资源地址唯一读取点（真实凭据在 .env.local）
│  ├─ pages/                        # 页面：战绩查询 / 战绩详情 / 操作员图鉴
│  ├─ services/                     # 云对象调用、静态目录、本地查询历史的统一封装
│  ├─ types/                        # 领域类型（stats 契约转发自 stats-core）与错误模型
│  ├─ utils/                        # 纯展示格式化逻辑（可独立单测）
│  └─ static/gen/                   # 生成产物，禁止手工编辑
├─ uniCloud-alipay/
│  ├─ cloudfunctions/
│  │  ├─ stats/                     # stats 云对象：参数校验 + 缓存读写 + 编排
│  │  └─ common/stats-core/         # 归一化与上游适配纯逻辑（口径唯一来源，含回归测试）
│  └─ database/                     # DB Schema（stats-cache，权限默认拒绝）
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
- 已知噪音：uni-app 编译器经旧版 JS API 调用 Dart Sass，构建时有 `legacy-js-api` 弃用警告，不影响产物。

## uniCloud 接入步骤（当前为占位状态）

1. 配置空间凭据：复制 `.env.example` 为 `.env.local` 填写（真实值不进仓库，[src/config/env.ts](./src/config/env.ts) 是类型层面唯一读取点）。
   注意：支付宝云空间**没有 `clientSecret`**（那是阿里云空间的参数），需要的是 `spaceId` + `accessKey` + `secretKey` + `spaceAppId` 四项，均在 [uniCloud 控制台](https://unicloud.dcloud.net.cn)对应空间的「服务空间详情」页查看。
2. 用 HBuilderX 打开项目并登录 DCloud 账号，右键 `uniCloud-alipay` 目录 →「关联云服务空间或项目…」选择你的支付宝云空间，然后上传：
   - 云对象 `uniCloud-alipay/cloudfunctions/stats/`（其 `package.json` 以 `file:` 引用公共模块 `stats-core`）；
   - DB Schema `uniCloud-alipay/database/stats-cache.schema.json`（客户端读写全部拒绝，仅云函数经管理面访问）。
3. 客户端 SDK 说明：CLI 构建不会自动注入 uniCloud 运行时（那依赖 HBuilderX 运行菜单），项目在 `src/services/cloud.ts` 中显式 import `@dcloudio/uni-cloud` 并用 `.env.local` 的空间配置初始化，因此终端 `npm run dev:mp-weixin` 联调不依赖 HBuilderX；HBuilderX 的关联仅用于上传云函数与 Schema。
4. 上游（育碧）会话凭据只允许存放在 `uni-config-center` 的 `r6-upstream` 插件配置中；未配置时 `stats` 云对象按 `E_UPSTREAM_NOT_CONFIGURED` 降级，不影响缓存链路。
5. 微信端联调前，把 `https://{spaceId}.api-hz.cloudbasefunction.cn`（spaceId 替换为实际值）加入小程序 request 合法域名。

## 数据口径（与旧版对齐，改动需先补回归用例）

- RP 与 MMR 是独立维度，字段分开存放，互不推断；
- 未知数据一律 `null`，展示层渲染为 `—`，禁止填零；
- 排位数据只表示当前赛季，不做历史回退；
- 战绩查询必须走 `stats-cache` 缓存，TTL 10 分钟（`stats-core.STATS_CACHE_TTL_MS`），有效期内不重复请求上游。

## 静态数据维护

- 操作员/联赛：图片放 `data/operators|leagues/`，同时维护 `scripts/source/` 源清单，脚本做双向对齐校验（缺清单或缺图即失败）。
- 武器/战队：仅需放图，展示名由 id 派生（后续如需精确命名再进源清单）。
- 操作员图片托管未接入：`ASSET_BASE_URL` 为空时图鉴降级为首字母占位块，接入 uniCloud 存储或 CDN 后填写即可。

## 当前状态与下一步

- [x] 工程骨架、校验链路（format/lint/type-check/test）、微信端构建
- [x] stats 云对象 + 缓存 Schema + 归一化公共模块（含 21 个回归用例）
- [ ] 育碧上游数据源适配（凭据走 uni-config-center，接入前查询返回 `E_UPSTREAM_NOT_CONFIGURED`）
- [ ] 操作员/武器/战队图片托管（uniCloud 存储 or CDN）
- [ ] 微信端真机联调（appid、合法域名、云对象部署）
