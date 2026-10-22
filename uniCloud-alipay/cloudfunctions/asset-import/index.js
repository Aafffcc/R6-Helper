'use strict';

/**
 * 资产导入一次性云函数：配合 scripts/upload-assets-to-unicloud.mjs 把 data/ 下的
 * 图鉴图片批量写入云存储。支付宝云空间控制台无文件夹上传/文件夹模式，目录结构
 * （{category}/{file}，与 ASSET_BASE_URL 的拼接约定一致）只能由云函数经
 * uniCloud.uploadFile 的 cloudPath 保持。
 *
 * 安全约定：
 * - 经 URL 化访问是公网入口，所有 action 都要求 token 匹配 uni-config-center
 *   asset-import 配置；token 缺失时拒绝一切请求（fail-closed）；
 * - cloudPath 仅放行图鉴类目白名单下的图片文件名，禁止任意路径写入；
 * - 迁移完成后建议在控制台关闭该函数的 URL 化（函数保留以备增量重传）。
 */

const ASSET_CATEGORIES = new Set([
  'operators',
  'weapons',
  'teams',
  'leagues',
  'maps',
  'skins',
  'charms',
]);
// cloudPath 形如 operators/ace.png：类目白名单 + 图片文件名白名单
const CLOUD_PATH_PATTERN = /^([a-z0-9-]+)\/([a-z0-9-]+\.(png|webp))$/;
const MAX_BATCH_FILES = 12;

let importToken = null;
try {
  const uniConfigCenter = require('uni-config-center');
  const loaded = uniConfigCenter({ pluginId: 'asset-import' }).config();
  if (loaded && typeof loaded.token === 'string' && loaded.token.trim() !== '') {
    importToken = loaded.token.trim();
    console.log(`[asset-import] 配置已加载，token 长度=${importToken.length}`);
  } else {
    console.error(
      '[asset-import] asset-import/config.json 缺失或 token 为空，导入接口将拒绝一切请求',
    );
  }
} catch (error) {
  console.error(
    '[asset-import] uni-config-center 模块加载失败：请上传公共模块 common/uni-config-center',
    error,
  );
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unauthorized() {
  return { ok: false, errCode: 'E_UNAUTHORIZED', errMsg: 'token 校验失败' };
}

function badRequest(message) {
  return { ok: false, errCode: 'E_BAD_REQUEST', errMsg: message };
}

/** URL 化的请求体可能已被网关解析为对象，也可能仍是原始字符串，两种形态都兼容 */
function parseRequestBody(event) {
  if (isPlainObject(event) && isPlainObject(event.body)) {
    return event.body;
  }
  const raw = isPlainObject(event) && typeof event.body === 'string' ? event.body : null;
  if (raw === null) {
    return isPlainObject(event) ? event : null;
  }
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function checkToken(body) {
  return (
    importToken !== null && typeof body.token === 'string' && body.token.trim() === importToken
  );
}

async function handleImport(body) {
  if (!Array.isArray(body.files) || body.files.length === 0) {
    return badRequest('files 应为非空数组');
  }
  if (body.files.length > MAX_BATCH_FILES) {
    return badRequest(`单批最多 ${MAX_BATCH_FILES} 个文件`);
  }
  const uploaded = [];
  for (const file of body.files) {
    if (!isPlainObject(file)) {
      return badRequest('files 元素应为对象');
    }
    const match =
      typeof file.cloudPath === 'string' ? CLOUD_PATH_PATTERN.exec(file.cloudPath) : null;
    if (match === null || !ASSET_CATEGORIES.has(match[1])) {
      return badRequest(`cloudPath 非法或类目不在白名单：${String(file.cloudPath)}`);
    }
    if (typeof file.contentBase64 !== 'string' || file.contentBase64 === '') {
      return badRequest(`contentBase64 缺失：${file.cloudPath}`);
    }
    let fileContent;
    try {
      fileContent = Buffer.from(file.contentBase64, 'base64');
    } catch {
      return badRequest(`contentBase64 解码失败：${file.cloudPath}`);
    }
    if (fileContent.length === 0) {
      return badRequest(`文件内容为空：${file.cloudPath}`);
    }
    const result = await uniCloud.uploadFile({ cloudPath: file.cloudPath, fileContent });
    uploaded.push({ cloudPath: file.cloudPath, fileID: result.fileID });
  }
  return { ok: true, uploaded };
}

async function handleResolveUrls(body) {
  if (!Array.isArray(body.fileList) || body.fileList.length === 0) {
    return badRequest('fileList 应为非空数组');
  }
  if (body.fileList.length > 50) {
    return badRequest('fileList 单次最多 50 个');
  }
  const result = await uniCloud.getTempFileURL({ fileList: body.fileList });
  return { ok: true, list: result.fileList };
}

exports.main = async function main(event) {
  const body = parseRequestBody(event);
  if (body === null) {
    return badRequest('请求体应为 JSON 对象');
  }
  if (!checkToken(body)) {
    return unauthorized();
  }

  try {
    if (body.action === 'ping') {
      return { ok: true, categories: [...ASSET_CATEGORIES].sort() };
    }
    if (body.action === 'import') {
      return await handleImport(body);
    }
    if (body.action === 'resolveUrls') {
      return await handleResolveUrls(body);
    }
    return badRequest(`未知 action：${String(body.action)}`);
  } catch (error) {
    // 失败信息带云函数日志便于排查（存储配额、权限等），但不在响应里暴露内部细节
    console.error('[asset-import] 执行失败', error);
    return { ok: false, errCode: 'E_IMPORT_FAILED', errMsg: '导入执行失败，详见云端日志' };
  }
};
