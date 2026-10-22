import { ASSET_BASE_URL, hasAssetBaseUrl } from '@/config/env';
import type {
  CatalogEntry,
  CharmEntry,
  MapEntry,
  OperatorEntry,
  OperatorSide,
  SkinEntry,
} from '@/types/catalog';
import { isOperatorSide } from '@/types/catalog';
import operatorsJson from '@/static/gen/operators.json';
import weaponsJson from '@/static/gen/weapons.json';
import teamsJson from '@/static/gen/teams.json';
import leaguesJson from '@/static/gen/leagues.json';
import mapsJson from '@/static/gen/maps.json';
import skinsJson from '@/static/gen/skins.json';
import charmsJson from '@/static/gen/charms.json';

/**
 * 静态目录数据由 scripts/generate-static-data.mjs 从 data/ 与源清单生成，
 * 本模块加载时做一次结构校验，生成产物被误改时立刻在启动阶段暴露。
 * maps/skins/charms 允许 image 为 null（上游无图，图片为人工后补资产），
 * weapons/teams/leagues 仍要求 image 为非空字符串。
 */

interface EntryBase {
  id: string;
  name: string;
  image: string | null;
}

function toEntryBase(item: unknown, label: string, requireImage: boolean): EntryBase {
  const entry = item as { id?: unknown; name?: unknown; image?: unknown };
  let image: string | null | undefined;
  if (typeof entry.image === 'string') {
    image = entry.image;
  } else if (!requireImage && entry.image === null) {
    image = null;
  }
  if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || image === undefined) {
    throw new Error(`生成数据 ${label} 条目字段异常：${JSON.stringify(item)}`);
  }
  return { id: entry.id, name: entry.name, image };
}

function toArray(raw: unknown, label: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new Error(`生成数据 ${label} 结构异常：应为数组`);
  }
  return raw;
}

function toCatalogEntries(raw: unknown, label: string): CatalogEntry[] {
  return toArray(raw, label).map((item) => toEntryBase(item, label, true));
}

function toOperatorEntries(raw: unknown): OperatorEntry[] {
  return toArray(raw, 'operators').map((item) => {
    const entry = item as { id?: unknown; name?: unknown; side?: unknown; image?: unknown };
    if (
      typeof entry.id !== 'string' ||
      typeof entry.name !== 'string' ||
      typeof entry.image !== 'string' ||
      !isOperatorSide(entry.side)
    ) {
      throw new Error(`生成数据 operators 条目字段异常：${JSON.stringify(item)}`);
    }
    return { id: entry.id, name: entry.name, side: entry.side, image: entry.image };
  });
}

/** 可选文本字段收敛：非空字符串保留，其余一律 null */
function toOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** 可选字符串列表收敛：缺失视为空数组；类型非法直接抛错 */
function toStringList(value: unknown, label: string, field: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((token) => typeof token !== 'string')) {
    throw new Error(`生成数据 ${label} 字段 ${field} 异常：${JSON.stringify(value)}`);
  }
  return value;
}

function toMapEntries(raw: unknown): MapEntry[] {
  return toArray(raw, 'maps').map((item) => {
    const base = toEntryBase(item, 'maps', false);
    const entry = item as Record<string, unknown>;
    return {
      ...base,
      location: toOptionalText(entry.location),
      releaseDate: toOptionalText(entry.releaseDate),
      playlists: toStringList(entry.playlists, 'maps', 'playlists'),
      mapReworked: toOptionalText(entry.mapReworked),
    };
  });
}

function toSkinEntries(raw: unknown): SkinEntry[] {
  return toArray(raw, 'skins').map((item) => {
    const base = toEntryBase(item, 'skins', false);
    const entry = item as Record<string, unknown>;
    return {
      ...base,
      weapons: toStringList(entry.weapons, 'skins', 'weapons'),
      rarity: toOptionalText(entry.rarity),
      availability: toOptionalText(entry.availability),
      bundle: toOptionalText(entry.bundle),
      season: toOptionalText(entry.season),
    };
  });
}

function toCharmEntries(raw: unknown): CharmEntry[] {
  return toArray(raw, 'charms').map((item) => {
    const base = toEntryBase(item, 'charms', false);
    const entry = item as Record<string, unknown>;
    return {
      ...base,
      collection: toOptionalText(entry.collection),
      rarity: toOptionalText(entry.rarity),
      availability: toOptionalText(entry.availability),
      bundle: toOptionalText(entry.bundle),
      season: toOptionalText(entry.season),
    };
  });
}

const operators: OperatorEntry[] = toOperatorEntries(operatorsJson);
const weapons: CatalogEntry[] = toCatalogEntries(weaponsJson, 'weapons');
const teams: CatalogEntry[] = toCatalogEntries(teamsJson, 'teams');
const leagues: CatalogEntry[] = toCatalogEntries(leaguesJson, 'leagues');
const maps: MapEntry[] = toMapEntries(mapsJson);
const skins: SkinEntry[] = toSkinEntries(skinsJson);
const charms: CharmEntry[] = toCharmEntries(charmsJson);

export function getOperators(): OperatorEntry[] {
  return operators;
}

export function getWeapons(): CatalogEntry[] {
  return weapons;
}

export function getTeams(): CatalogEntry[] {
  return teams;
}

export function getLeagues(): CatalogEntry[] {
  return leagues;
}

export function getMaps(): MapEntry[] {
  return maps;
}

export function getSkins(): SkinEntry[] {
  return skins;
}

export function getCharms(): CharmEntry[] {
  return charms;
}

export function getOperatorSideLabel(side: OperatorSide): string {
  if (side === 'attacker') {
    return '进攻方';
  }
  if (side === 'defender') {
    return '防守方';
  }
  return '通用';
}

export function getCatalogImageUrl(entry: CatalogEntry, category: string): string | null {
  if (!hasAssetBaseUrl() || entry.image === null) {
    return null;
  }
  return `${ASSET_BASE_URL}/${category}/${entry.image}`;
}
