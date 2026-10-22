/**
 * 静态数据维护脚本：把 data/ 下的图片资产与 scripts/source/ 源清单
 * 汇编为 src/static/gen/ 下的目录 JSON。产物不允许手工编辑，
 * 改数据一律改源清单或补图片后重新运行本脚本。
 *
 * 校验规则（任一失败即退出码 1）：
 * - 源清单条目必须有 id/name，id 不得重复；
 * - 图片必须有源清单条目（全部类目）；
 * - operators/leagues/weapons/teams：清单条目必须有对应图片（双向对齐）；
 * - maps/skins/charms（optionalImage）：清单条目可以缺图（image 置 null，展示层降级），
 *   上游三个元数据端点均无图片字段，图片为人工后续补充的 data/ 本地资产；
 * - side 取值仅限 attacker / defender / both。
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(projectRoot, 'data');
const sourceDir = join(projectRoot, 'scripts', 'source');
const outputDir = join(projectRoot, 'src', 'static', 'gen');

const IMAGE_EXTENSIONS = /\.(png|webp)$/i;
const OPERATOR_SIDES = new Set(['attacker', 'defender', 'both']);
// optionalImage 类目：清单由烘焙脚本生成，图片允许后补
const OPTIONAL_IMAGE_CATEGORIES = ['maps', 'skins', 'charms'];

function listImages(category) {
  return readdirSync(join(dataDir, category))
    .filter((fileName) => IMAGE_EXTENSIONS.test(fileName))
    .sort();
}

function readSourceJson(fileName) {
  return JSON.parse(readFileSync(join(sourceDir, fileName), 'utf8'));
}

function toId(fileName) {
  return fileName.replace(IMAGE_EXTENSIONS, '');
}

function prettifyName(id) {
  return id
    .split('-')
    .map((token) => (token === '' ? token : token[0].toUpperCase() + token.slice(1)))
    .join(' ');
}

function fail(message) {
  console.error(`[gen:static-data] ${message}`);
  process.exitCode = 1;
}

/** 可选文本字段：非空字符串原样保留，缺失/空串收敛为 null；类型非法视为校验失败 */
function validateOptionalText(category, id, key, value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    fail(`${category} 源清单字段类型非法：${id}.${key} -> ${JSON.stringify(value)}`);
    return null;
  }
  return value.trim() === '' ? null : value;
}

/** 可选字符串数组字段：缺失收敛为空数组；类型非法视为校验失败 */
function validateStringList(category, id, key, value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((token) => typeof token !== 'string')) {
    fail(`${category} 源清单字段类型非法：${id}.${key} -> ${JSON.stringify(value)}`);
    return [];
  }
  return value.filter((token) => token.trim() !== '');
}

/**
 * 源清单驱动的目录构建。
 * 默认模式：图片与清单双向对齐，条目必须有图。
 * optionalImage 模式（maps/skins/charms）：以清单为驱动，缺图条目 image 置 null；
 * 两种模式下「有图无清单」都算校验失败。
 */
function buildFromSource(category, sourceEntries, mapEntry, { optionalImage = false } = {}) {
  const images = listImages(category);
  const sourceById = new Map();
  for (const entry of sourceEntries) {
    if (typeof entry?.id !== 'string' || typeof entry?.name !== 'string') {
      fail(`${category} 源清单条目字段非法：${JSON.stringify(entry)}`);
      continue;
    }
    if (sourceById.has(entry.id)) {
      fail(`${category} 源清单存在重复 id：${entry.id}`);
    }
    sourceById.set(entry.id, entry);
  }

  const entries = [];
  const missingSource = [];
  if (optionalImage) {
    for (const source of sourceById.values()) {
      const fileName = images.find((file) => toId(file) === source.id) ?? null;
      entries.push(mapEntry(source, fileName));
    }
    for (const fileName of images) {
      if (!sourceById.has(toId(fileName))) {
        missingSource.push(toId(fileName));
      }
    }
  } else {
    for (const fileName of images) {
      const id = toId(fileName);
      const source = sourceById.get(id);
      if (source === undefined) {
        missingSource.push(id);
        continue;
      }
      entries.push(mapEntry(source, fileName));
    }
    const extraSource = [...sourceById.keys()].filter((id) => !images.some((f) => toId(f) === id));
    if (extraSource.length > 0) {
      fail(`${category} 源清单条目没有对应图片：${extraSource.join(', ')}`);
    }
  }

  if (missingSource.length > 0) {
    fail(`${category} 缺少源清单条目：${missingSource.join(', ')}`);
  }
  return entries;
}

function buildOperators() {
  return buildFromSource('operators', readSourceJson('operators.json'), (source, fileName) => {
    if (!OPERATOR_SIDES.has(source.side)) {
      fail(`operators 源清单 side 非法：${source.id} -> ${source.side}`);
      return { id: source.id, name: source.name, side: source.side, image: fileName };
    }
    return { id: source.id, name: source.name, side: source.side, image: fileName };
  });
}

function buildLeagues() {
  return buildFromSource('leagues', readSourceJson('leagues.json'), (source, fileName) => ({
    id: source.id,
    name: source.name,
    image: fileName,
  }));
}

function buildDerived(category) {
  return listImages(category).map((fileName) => {
    const id = toId(fileName);
    return { id, name: prettifyName(id), image: fileName };
  });
}

// maps/skins/charms 源清单由 scripts/fetch-arenyze-metadata.mjs 烘焙生成，
// 字段保持上游口径；图片为人工后补的 data/ 本地资产，缺失时 image 置 null。

function buildMaps() {
  return buildFromSource(
    'maps',
    readSourceJson('maps.json'),
    (source, fileName) => ({
      id: source.id,
      name: source.name,
      location: validateOptionalText('maps', source.id, 'location', source.location),
      releaseDate: validateOptionalText('maps', source.id, 'releaseDate', source.releaseDate),
      playlists: validateStringList('maps', source.id, 'playlists', source.playlists),
      mapReworked: validateOptionalText('maps', source.id, 'mapReworked', source.mapReworked),
      image: fileName,
    }),
    { optionalImage: true },
  );
}

function buildSkins() {
  return buildFromSource(
    'skins',
    readSourceJson('skins.json'),
    (source, fileName) => ({
      id: source.id,
      name: source.name,
      weapons: validateStringList('skins', source.id, 'weapons', source.weapons),
      rarity: validateOptionalText('skins', source.id, 'rarity', source.rarity),
      availability: validateOptionalText('skins', source.id, 'availability', source.availability),
      bundle: validateOptionalText('skins', source.id, 'bundle', source.bundle),
      season: validateOptionalText('skins', source.id, 'season', source.season),
      image: fileName,
    }),
    { optionalImage: true },
  );
}

function buildCharms() {
  return buildFromSource(
    'charms',
    readSourceJson('charms.json'),
    (source, fileName) => ({
      id: source.id,
      name: source.name,
      collection: validateOptionalText('charms', source.id, 'collection', source.collection),
      rarity: validateOptionalText('charms', source.id, 'rarity', source.rarity),
      availability: validateOptionalText('charms', source.id, 'availability', source.availability),
      bundle: validateOptionalText('charms', source.id, 'bundle', source.bundle),
      season: validateOptionalText('charms', source.id, 'season', source.season),
      image: fileName,
    }),
    { optionalImage: true },
  );
}

function writeOutput(fileName, entries) {
  // 生成产物不入 prettier 管控（见 .prettierignore），这里保持稳定的 2 空格缩进 + LF
  writeFileSync(join(outputDir, fileName), `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  console.log(`[gen:static-data] ${fileName}: ${entries.length} 条`);
}

mkdirSync(outputDir, { recursive: true });
// optionalImage 类目的 data/ 目录可能还没有图，先建目录保证 readdirSync 不抛错
for (const category of OPTIONAL_IMAGE_CATEGORIES) {
  mkdirSync(join(dataDir, category), { recursive: true });
}

const operators = buildOperators();
const leagues = buildLeagues();
const weapons = buildDerived('weapons');
const teams = buildDerived('teams');
const maps = buildMaps();
const skins = buildSkins();
const charms = buildCharms();

if (process.exitCode === 1) {
  console.error('[gen:static-data] 校验失败，未写出任何产物');
  process.exit(process.exitCode);
}

writeOutput('operators.json', operators);
writeOutput('leagues.json', leagues);
writeOutput('weapons.json', weapons);
writeOutput('teams.json', teams);
writeOutput('maps.json', maps);
writeOutput('skins.json', skins);
writeOutput('charms.json', charms);
console.log('[gen:static-data] 完成');
