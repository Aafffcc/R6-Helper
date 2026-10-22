/**
 * arenyze 元数据一次性烘焙脚本：拉取 /maps、/universalSkins、/charms 三个端点，
 * 经 scripts/lib/arenyze-metadata.mjs 归一化后写入 scripts/source/{maps,skins,charms}.json，
 * 供 generate-static-data.mjs 离线消费。构建期不依赖上游，重跑以最新上游数据覆盖清单。
 *
 * - apiKey 只从 uni-config-center 的 r6-upstream/config.json 读取（凭据唯一存放点），禁止落日志；
 * - 三端点均不返回图片 URL（实测 2026-10），地图/皮肤/挂件的图片人工放入 data/ 对应目录即可，
 *   缺图条目由 generate-static-data 置 image: null，展示层走占位块降级；
 * - 每次运行消耗上游配额 3 次调用（免费档月度 2000），无需频繁重跑。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MetadataNormalizerError,
  normalizeCharms,
  normalizeMaps,
  normalizeSkins,
} from './lib/arenyze-metadata.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const upstreamConfigPath = join(
  projectRoot,
  'uniCloud-alipay',
  'cloudfunctions',
  'common',
  'uni-config-center',
  'r6-upstream',
  'config.json',
);
const sourceDir = join(projectRoot, 'scripts', 'source');

const DEFAULT_BASE_URL = 'https://public-api.arenyze.com/r6/api';
const REQUEST_TIMEOUT_MS = 15000;
// 上游未公布逐秒限速口径，串行 + 1.5s 间隔是保守礼貌节奏（与计划中 esports 端点策略一致）
const REQUEST_INTERVAL_MS = 1500;

function fail(message) {
  console.error(`[gen:fetch-metadata] ${message}`);
  process.exitCode = 1;
}

function readUpstreamConfig() {
  let raw;
  try {
    raw = readFileSync(upstreamConfigPath, 'utf8');
  } catch {
    fail(
      `缺少上游配置：${upstreamConfigPath}（结构参考同目录 config.example.json，真实文件已 gitignore）`,
    );
    return null;
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    fail(`上游配置解析失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (apiKey === '') {
    fail('上游配置 apiKey 为空，无法拉取元数据');
    return null;
  }
  const baseUrl =
    typeof config.baseUrl === 'string' && config.baseUrl.trim() !== ''
      ? config.baseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_BASE_URL;
  return { apiKey, baseUrl };
}

async function fetchJson(url, apiKey, endpoint) {
  let response;
  try {
    response = await fetch(url, {
      headers: { 'api-key': apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    fail(`${endpoint} 请求失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (!response.ok) {
    const hint =
      response.status === 401
        ? '（apiKey 无效，请核对 uni-config-center 配置并重新上传公共模块）'
        : response.status === 429
          ? '（上游限速或月度配额用尽）'
          : '';
    fail(`${endpoint} HTTP ${response.status}${hint}`);
    return null;
  }
  try {
    return await response.json();
  } catch (error) {
    fail(`${endpoint} 响应非 JSON：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const upstream = readUpstreamConfig();
  if (upstream === null) {
    process.exit(1);
  }

  const tasks = [
    { endpoint: 'maps', normalize: normalizeMaps, output: 'maps.json' },
    { endpoint: 'universalSkins', normalize: normalizeSkins, output: 'skins.json' },
    { endpoint: 'charms', normalize: normalizeCharms, output: 'charms.json' },
  ];

  const manifests = [];
  for (const [index, task] of tasks.entries()) {
    if (index > 0) {
      await sleep(REQUEST_INTERVAL_MS);
    }
    const raw = await fetchJson(
      `${upstream.baseUrl}/${task.endpoint}`,
      upstream.apiKey,
      task.endpoint,
    );
    if (raw === null) {
      continue;
    }
    try {
      const entries = task.normalize(raw);
      manifests.push({ output: task.output, endpoint: task.endpoint, entries });
    } catch (error) {
      if (error instanceof MetadataNormalizerError) {
        fail(`${task.endpoint} 归一化失败：${error.message}`);
      } else {
        throw error;
      }
    }
  }

  if (manifests.length !== tasks.length) {
    fail('存在失败的端点，未写出任何清单（保持源清单一致性）');
    process.exit(1);
  }

  for (const manifest of manifests) {
    const payload = `${JSON.stringify(manifest.entries, null, 2)}\n`;
    writeFileSync(join(sourceDir, manifest.output), payload, 'utf8');
    console.log(
      `[gen:fetch-metadata] scripts/source/${manifest.output}: ${manifest.entries.length} 条（来自 /${manifest.endpoint}）`,
    );
  }
  console.log('[gen:fetch-metadata] 完成');
}

main().catch((error) => {
  fail(`未预期异常：${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
