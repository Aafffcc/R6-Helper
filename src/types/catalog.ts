/** 操作员阵营：经典招募干员（recruit_*）双阵营可用 */
export type OperatorSide = 'attacker' | 'defender' | 'both';

export interface OperatorEntry {
  id: string;
  name: string;
  side: OperatorSide;
  /** 图片文件名（含扩展名），托管于 ASSET_BASE_URL 下的 operators/ 目录 */
  image: string;
}

/** 武器、战队、联赛等扁平目录条目 */
export interface CatalogEntry {
  id: string;
  name: string;
  image: string;
}

export function isOperatorSide(value: unknown): value is OperatorSide {
  return value === 'attacker' || value === 'defender' || value === 'both';
}
