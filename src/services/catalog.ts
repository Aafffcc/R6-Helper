import { ASSET_BASE_URL, hasAssetBaseUrl } from '@/config/env';
import type { CatalogEntry, OperatorEntry, OperatorSide } from '@/types/catalog';
import { isOperatorSide } from '@/types/catalog';
import operatorsJson from '@/static/gen/operators.json';
import weaponsJson from '@/static/gen/weapons.json';
import teamsJson from '@/static/gen/teams.json';
import leaguesJson from '@/static/gen/leagues.json';

/**
 * 静态目录数据由 scripts/generate-static-data.mjs 从 data/ 与源清单生成，
 * 本模块加载时做一次结构校验，生成产物被误改时立刻在启动阶段暴露。
 */

function toCatalogEntries(raw: unknown, label: string): CatalogEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error(`生成数据 ${label} 结构异常：应为数组`);
  }
  return raw.map((item) => {
    const entry = item as { id?: unknown; name?: unknown; image?: unknown };
    if (
      typeof entry.id !== 'string' ||
      typeof entry.name !== 'string' ||
      typeof entry.image !== 'string'
    ) {
      throw new Error(`生成数据 ${label} 条目字段异常：${JSON.stringify(item)}`);
    }
    return { id: entry.id, name: entry.name, image: entry.image };
  });
}

function toOperatorEntries(raw: unknown): OperatorEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error('生成数据 operators 结构异常：应为数组');
  }
  return raw.map((item) => {
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

const operators: OperatorEntry[] = toOperatorEntries(operatorsJson);
const weapons: CatalogEntry[] = toCatalogEntries(weaponsJson, 'weapons');
const teams: CatalogEntry[] = toCatalogEntries(teamsJson, 'teams');
const leagues: CatalogEntry[] = toCatalogEntries(leaguesJson, 'leagues');

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
  if (!hasAssetBaseUrl()) {
    return null;
  }
  return `${ASSET_BASE_URL}/${category}/${entry.image}`;
}
