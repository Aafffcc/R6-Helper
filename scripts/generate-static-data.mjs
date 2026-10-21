/**
 * 静态数据维护脚本：把 data/ 下的图片资产与 scripts/source/ 源清单
 * 汇编为 src/static/gen/ 下的目录 JSON。产物不允许手工编辑，
 * 改数据一律改源清单或补图片后重新运行本脚本。
 *
 * 校验规则（任一失败即退出码 1）：
 * - 源清单中的条目必须有对应图片，图片必须有源清单条目（双向对齐）；
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

/** 图片与源清单双向对齐校验，返回与图片一一对应的目录条目 */
function buildFromSource(category, sourceEntries, mapEntry) {
  const images = listImages(category);
  const sourceById = new Map();
  for (const entry of sourceEntries) {
    if (sourceById.has(entry.id)) {
      fail(`${category} 源清单存在重复 id：${entry.id}`);
    }
    sourceById.set(entry.id, entry);
  }

  const entries = [];
  const missingSource = [];
  for (const fileName of images) {
    const id = toId(fileName);
    const source = sourceById.get(id);
    if (source === undefined) {
      missingSource.push(id);
      continue;
    }
    entries.push(mapEntry(source, fileName));
  }

  if (missingSource.length > 0) {
    fail(`${category} 缺少源清单条目：${missingSource.join(', ')}`);
  }
  const extraSource = [...sourceById.keys()].filter((id) => !images.some((f) => toId(f) === id));
  if (extraSource.length > 0) {
    fail(`${category} 源清单条目没有对应图片：${extraSource.join(', ')}`);
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

function writeOutput(fileName, entries) {
  // 生成产物不入 prettier 管控（见 .prettierignore），这里保持稳定的 2 空格缩进 + LF
  writeFileSync(join(outputDir, fileName), `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  console.log(`[gen:static-data] ${fileName}: ${entries.length} 条`);
}

mkdirSync(outputDir, { recursive: true });

const operators = buildOperators();
const leagues = buildLeagues();
const weapons = buildDerived('weapons');
const teams = buildDerived('teams');

if (process.exitCode === 1) {
  console.error('[gen:static-data] 校验失败，未写出任何产物');
  process.exit(process.exitCode);
}

writeOutput('operators.json', operators);
writeOutput('leagues.json', leagues);
writeOutput('weapons.json', weapons);
writeOutput('teams.json', teams);
console.log('[gen:static-data] 完成');
