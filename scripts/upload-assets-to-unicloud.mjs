/**
 * 图鉴资产上传驱动脚本：把 data/ 下的图片经 asset-import 云函数批量写入
 * uniCloud 云存储（支付宝云空间控制台无文件夹上传能力，目录结构由云函数保持）。
 *
 * 前置条件（见 README「图片资产上传」一节）：
 * - asset-import 云函数已上传到空间并开启 URL 化，地址填入 .env.local 的
 *   UNICLOUD_ASSET_IMPORT_URL；
 * - uni-config-center 的 asset-import/config.json（token）已随公共模块上传，
 *   本地同名文件存在（两处 token 一致）。
 *
 * 用法：
 *   npm run gen:upload-assets -- --dry-run          # 只列出上传计划，不访问网络
 *   npm run gen:upload-assets                       # 实际上传
 *   npm run gen:upload-assets -- --check-base <url> # 校验 ASSET_BASE_URL 拼接可用性
 *
 * 上传完成后：从脚本输出的下载 URL 推导 VITE_ASSET_BASE_URL 前缀填入 .env.local，
 * 并把存储域名加入微信小程序 downloadFile 合法域名。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(projectRoot, 'data');
const genDir = join(projectRoot, 'src', 'static', 'gen');
const envLocalPath = join(projectRoot, '.env.local');
const importConfigPath = join(
  projectRoot,
  'uniCloud-alipay',
  'cloudfunctions',
  'common',
  'uni-config-center',
  'asset-import',
  'config.json',
);

const ASSET_CATEGORIES = ['operators', 'weapons', 'teams', 'leagues', 'maps', 'skins', 'charms'];
const IMAGE_EXTENSIONS = /\.(png|webp)$/i;
// 单批体积上限（原始字节）与文件数上限：URL 化请求体不宜过大，留足余量
const MAX_BATCH_BYTES = 512 * 1024;
const MAX_BATCH_FILES = 8;
const REQUEST_TIMEOUT_MS = 30000;
const REQUEST_INTERVAL_MS = 250;
const MAX_ATTEMPTS = 3;

function fail(message) {
  console.error(`[gen:upload-assets] ${message}`);
  process.exit(1);
}

function parseEnvLocal() {
  let raw;
  try {
    raw = readFileSync(envLocalPath, 'utf8');
  } catch {
    fail(`缺少 ${envLocalPath}（参考 .env.example 配置）`);
  }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator > 0) {
      env[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }
  }
  return env;
}

function readImportToken() {
  try {
    const config = JSON.parse(readFileSync(importConfigPath, 'utf8'));
    if (typeof config.token === 'string' && config.token.trim() !== '') {
      return config.token.trim();
    }
  } catch {
    // 落入下方 fail
  }
  fail(`缺少导入 token：${importConfigPath}（参考同目录 config.example.json）`);
}

function listCategoryFiles(category) {
  const categoryDir = join(dataDir, category);
  return readdirSync(categoryDir)
    .filter((fileName) => IMAGE_EXTENSIONS.test(fileName))
    .sort()
    .map((fileName) => {
      const filePath = join(categoryDir, fileName);
      return {
        cloudPath: `${category}/${fileName}`,
        filePath,
        bytes: statSync(filePath).size,
      };
    });
}

/** 与 gen 产物对账：必须配图的类目出现生成目录之外的文件视为陈旧数据 */
function warnAgainstStaleGen(category, files) {
  let genIds;
  try {
    genIds = new Set(
      JSON.parse(readFileSync(join(genDir, `${category}.json`), 'utf8')).map((entry) => entry.id),
    );
  } catch {
    console.warn(
      `[gen:upload-assets] 警告：无法读取 ${category}.json，跳过对账（先跑 gen:static-data）`,
    );
    return;
  }
  const orphanIds = files
    .map((file) => file.cloudPath.split('/')[1].replace(IMAGE_EXTENSIONS, ''))
    .filter((id) => !genIds.has(id));
  if (orphanIds.length > 0) {
    console.warn(
      `[gen:upload-assets] 警告：${category} 以下图片不在生成产物中（疑似陈旧文件）：${orphanIds.join(', ')}`,
    );
  }
}

function collectUploadPlan() {
  const plan = [];
  for (const category of ASSET_CATEGORIES) {
    const files = listCategoryFiles(category);
    if (files.length === 0) {
      console.log(`[gen:upload-assets] ${category}: 无图片，跳过`);
      continue;
    }
    warnAgainstStaleGen(category, files);
    plan.push({ category, files });
  }
  return plan;
}

function buildBatches(files) {
  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const file of files) {
    const wouldOverflow =
      current.length >= MAX_BATCH_FILES || currentBytes + file.bytes > MAX_BATCH_BYTES;
    if (current.length > 0 && wouldOverflow) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.bytes;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

async function callImportFunction(baseUrl, payload) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`响应非 JSON（HTTP ${response.status}）：${text.slice(0, 120)}`);
      }
      if (parsed.errCode === 'E_UNAUTHORIZED') {
        fail('token 校验失败：本地与云端 asset-import 配置不一致');
      }
      if (!parsed.ok) {
        throw new Error(`业务错误 ${parsed.errCode ?? '未知'}：${parsed.errMsg ?? ''}`);
      }
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[gen:upload-assets] 请求失败（第 ${attempt} 次），重试：${error instanceof Error ? error.message : String(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  fail(
    `连续 ${MAX_ATTEMPTS} 次请求失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function runUpload(baseUrl, token, plan, dryRun) {
  let totalFiles = 0;
  let totalBytes = 0;
  const uploaded = [];
  for (const { category, files } of plan) {
    const batches = buildBatches(files);
    const categoryBytes = files.reduce((sum, file) => sum + file.bytes, 0);
    totalFiles += files.length;
    totalBytes += categoryBytes;
    console.log(
      `[gen:upload-assets] ${category}: ${files.length} 个文件（${Math.round(categoryBytes / 1024)} KB），${batches.length} 批`,
    );
    if (dryRun) {
      continue;
    }
    for (const [batchIndex, batch] of batches.entries()) {
      const filesPayload = batch.map((file) => ({
        cloudPath: file.cloudPath,
        contentBase64: readFileSync(file.filePath).toString('base64'),
      }));
      const result = await callImportFunction(baseUrl, {
        action: 'import',
        token,
        files: filesPayload,
      });
      uploaded.push(...result.uploaded);
      console.log(`  批次 ${batchIndex + 1}/${batches.length} 完成（累计 ${uploaded.length}）`);
      await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
    }
  }
  console.log(
    `[gen:upload-assets] ${dryRun ? '计划' : '完成'}：${totalFiles} 个文件，约 ${Math.round(totalBytes / 1024)} KB`,
  );
  return uploaded;
}

async function resolveDownloadUrls(baseUrl, token, uploaded) {
  if (uploaded.length === 0) {
    return;
  }
  const fileIds = uploaded.map((item) => item.fileID);
  const urls = [];
  for (let offset = 0; offset < fileIds.length; offset += 50) {
    const result = await callImportFunction(baseUrl, {
      action: 'resolveUrls',
      token,
      fileList: fileIds.slice(offset, offset + 50),
    });
    urls.push(...result.list);
    await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
  }
  console.log('[gen:upload-assets] 下载地址样例（每类目第 1 个，用于推导 VITE_ASSET_BASE_URL）：');
  const seenCategories = new Set();
  for (const [index, item] of uploaded.entries()) {
    const category = item.cloudPath.split('/')[0];
    if (seenCategories.has(category)) {
      continue;
    }
    seenCategories.add(category);
    const entry = urls[index];
    console.log(`  ${item.cloudPath} -> ${entry?.tempFileURL ?? '<获取失败>'}`);
  }
  const expiredSuspect = urls.some(
    (entry) =>
      typeof entry?.tempFileURL === 'string' &&
      /[?&](expire|expires|Expires)=/.test(entry.tempFileURL),
  );
  if (expiredSuspect) {
    console.warn(
      '[gen:upload-assets] 警告：返回 URL 带过期参数（临时链接）。请在控制台把云存储读取权限设为「所有用户可读」后重新运行 --resolve，或改用 fileID 换链方案。',
    );
  }
}

async function checkBaseUrl(baseUrl, candidate) {
  const probes = ['leagues', 'maps'];
  for (const category of probes) {
    const files = listCategoryFiles(category);
    if (files.length === 0) {
      continue;
    }
    const probeUrl = `${candidate.replace(/\/+$/, '')}/${files[0].cloudPath}`;
    try {
      const response = await fetch(probeUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15000),
      });
      console.log(
        `[gen:upload-assets] ${response.ok ? 'OK' : 'FAIL'}（HTTP ${response.status}）：${probeUrl}`,
      );
    } catch (error) {
      console.log(
        `[gen:upload-assets] FAIL（${error instanceof Error ? error.message : String(error)}）：${probeUrl}`,
      );
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const checkBaseIndex = args.indexOf('--check-base');

  const env = parseEnvLocal();
  const baseUrl = env.UNICLOUD_ASSET_IMPORT_URL ?? '';
  const plan = collectUploadPlan();

  if (checkBaseIndex >= 0) {
    const candidate = args[checkBaseIndex + 1];
    if (candidate === undefined) {
      fail('--check-base 需要传入候选前缀，如 --check-base https://xxx/...');
    }
    checkBaseUrl(baseUrl, candidate).catch((error) => fail(String(error)));
    return;
  }

  if (dryRun) {
    // 计划模式不触网也不读 token，无需任何凭据
    runUpload(baseUrl, null, plan, true).catch((error) => fail(String(error)));
    return;
  }

  if (baseUrl === '') {
    fail('.env.local 缺少 UNICLOUD_ASSET_IMPORT_URL（asset-import 云函数 URL 化地址）');
  }
  const token = readImportToken();
  const fingerprint = createHash('sha256').update(token).digest('hex').slice(0, 8);
  console.log(`[gen:upload-assets] token 指纹 ${fingerprint}（仅用于核对两端一致，不输出本体）`);
  runUpload(baseUrl, token, plan, false)
    .then((uploaded) => resolveDownloadUrls(baseUrl, token, uploaded))
    .then(() => console.log('[gen:upload-assets] 全部完成'))
    .catch((error) => fail(String(error)));
}

main();
