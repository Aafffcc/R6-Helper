/**
 * 环境与迁移敏感信息统一配置。
 * 规范约束：spaceId、默认域名、fileID 口径只允许在此处定义，
 * 服务空间迁移时仅改本文件；禁止在页面、组件中散落硬编码。
 *
 * 注意：这里不存放任何上游（育碧）凭据——上游凭据只能存放在
 * uni-config-center / 云函数环境配置中，小程序端不得保存。
 */

export const UNICLOUD_SPACE = {
  provider: 'alipay',
  spaceId: '',
  clientSecret: '',
} as const;

/** 静态图片（操作员/武器/战队/联赛）托管基址，接入 uniCloud 存储或 CDN 后填写 */
export const ASSET_BASE_URL = '';

export function isUnicloudConfigured(): boolean {
  return UNICLOUD_SPACE.spaceId !== '' && UNICLOUD_SPACE.clientSecret !== '';
}

export function hasAssetBaseUrl(): boolean {
  return ASSET_BASE_URL !== '';
}
