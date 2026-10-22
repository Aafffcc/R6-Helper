/**
 * arenyze 元数据端点响应归一化（纯逻辑，烘焙脚本与回归测试共用）。
 *
 * 口径来源：https://r6.arenyze.com/api-docs，实测确认 2026-10：
 * - /maps        -> [{ name, location, releaseDate, playlists, mapReworked }]
 * - /universalSkins -> [{ weapon, name, rarity, availability, bundle, season }]
 * - /charms      -> [{ name, collection, rarity, availability, bundle, season }]
 * 三端点均返回裸 JSON 数组（无分页包装），且都不提供图片 URL——目录条目图片一律
 * 走 data/ 本地资产（后续人工补充），缺失时 image 为 null，展示层走占位块降级。
 *
 * 未知数据一律 null / 空数组，不填零、不编造；字段名保持上游口径（releaseDate、
 * mapReworked 等），改名发生在展示层标签，不在数据契约。
 */

export class MetadataNormalizerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MetadataNormalizerError';
  }
}

/** 名称转 id：小写、非字母数字折叠为连字符、去首尾连字符；结果为空视为非法输入 */
export function slugifyName(name) {
  if (typeof name !== 'string') {
    throw new MetadataNormalizerError(`名称必须是字符串：${JSON.stringify(name)}`);
  }
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (id === '') {
    throw new MetadataNormalizerError(`名称无法派生 id：${JSON.stringify(name)}`);
  }
  return id;
}

/** 上游逗号串（"Standard, Ranked"）拆为去空白数组；空/缺失输入返回空数组 */
function splitList(value, { context }) {
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value !== 'string') {
    throw new MetadataNormalizerError(`${context} 应为字符串：${JSON.stringify(value)}`);
  }
  return value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '');
}

/** 可选字符串字段：非空字符串原样保留，其余（缺失/空串/非字符串）一律 null */
function optionalText(value) {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return null;
}

function requireArray(raw, endpoint) {
  if (!Array.isArray(raw)) {
    throw new MetadataNormalizerError(`${endpoint} 响应结构异常：应为数组，收到 ${typeof raw}`);
  }
}

function requireName(item, index, endpoint) {
  const name = optionalText(item.name);
  if (name === null) {
    throw new MetadataNormalizerError(
      `${endpoint}[${index}] 缺少有效 name：${JSON.stringify(item)}`,
    );
  }
  return name;
}

/** 同 id 冲突处理：归一化结果完全一致的重复条目去重，其余视为上游脏数据直接失败 */
function dedupeById(entries, endpoint) {
  const byId = new Map();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (existing === undefined) {
      byId.set(entry.id, entry);
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(entry)) {
      throw new MetadataNormalizerError(
        `${endpoint} 存在同名不同内容条目（id: ${entry.id}），需人工核对`,
      );
    }
  }
  return [...byId.values()];
}

export function normalizeMaps(raw) {
  requireArray(raw, 'maps');
  const entries = raw.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new MetadataNormalizerError(`maps[${index}] 应为对象：${JSON.stringify(item)}`);
    }
    const name = requireName(item, index, 'maps');
    return {
      id: slugifyName(name),
      name,
      location: optionalText(item.location),
      releaseDate: optionalText(item.releaseDate),
      playlists: splitList(item.playlists, { context: `maps[${index}].playlists` }),
      mapReworked: optionalText(item.mapReworked),
    };
  });
  return dedupeById(entries, 'maps');
}

export function normalizeSkins(raw) {
  requireArray(raw, 'universalSkins');
  const entries = raw.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new MetadataNormalizerError(
        `universalSkins[${index}] 应为对象：${JSON.stringify(item)}`,
      );
    }
    const name = requireName(item, index, 'universalSkins');
    return {
      id: slugifyName(name),
      name,
      weapons: splitList(item.weapon, { context: `universalSkins[${index}].weapon` }),
      rarity: optionalText(item.rarity),
      availability: optionalText(item.availability),
      bundle: optionalText(item.bundle),
      season: optionalText(item.season),
    };
  });
  return dedupeById(entries, 'universalSkins');
}

export function normalizeCharms(raw) {
  requireArray(raw, 'charms');
  const entries = raw.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new MetadataNormalizerError(`charms[${index}] 应为对象：${JSON.stringify(item)}`);
    }
    const name = requireName(item, index, 'charms');
    return {
      id: slugifyName(name),
      name,
      collection: optionalText(item.collection),
      rarity: optionalText(item.rarity),
      availability: optionalText(item.availability),
      bundle: optionalText(item.bundle),
      season: optionalText(item.season),
    };
  });
  return dedupeById(entries, 'charms');
}
