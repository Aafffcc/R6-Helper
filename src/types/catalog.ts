/** 操作员阵营：经典招募干员（recruit_*）双阵营可用 */
export type OperatorSide = 'attacker' | 'defender' | 'both';

/** 目录条目通用字段：图片托管于 ASSET_BASE_URL 下对应类目目录；
 *  image 为 null 表示暂无图片资源（maps/skins/charms 的源数据不带图），展示层走占位块降级 */
export interface CatalogEntry {
  id: string;
  name: string;
  image: string | null;
}

export interface OperatorEntry {
  id: string;
  name: string;
  side: OperatorSide;
  /** 图片文件名（含扩展名），托管于 ASSET_BASE_URL 下的 operators/ 目录；操作员必配图 */
  image: string;
}

/** 地图条目：arenyze /maps 无图片字段，releaseDate/mapReworked 为上游原文案（如 "Dust Line (May 2016)"） */
export interface MapEntry extends CatalogEntry {
  location: string | null;
  releaseDate: string | null;
  playlists: string[];
  mapReworked: string | null;
}

/** 皮肤条目（arenyze /universalSkins）：weapons 为适用武器名列表，universalSkins 本身就是全武器通用皮肤 */
export interface SkinEntry extends CatalogEntry {
  weapons: string[];
  rarity: string | null;
  availability: string | null;
  bundle: string | null;
  season: string | null;
}

/** 挂件条目（arenyze /charms） */
export interface CharmEntry extends CatalogEntry {
  collection: string | null;
  rarity: string | null;
  availability: string | null;
  bundle: string | null;
  season: string | null;
}

export function isOperatorSide(value: unknown): value is OperatorSide {
  return value === 'attacker' || value === 'defender' || value === 'both';
}
