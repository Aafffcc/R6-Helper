/**
 * 环境与迁移敏感信息统一配置。
 * 规范约束：spaceId、默认域名、fileID 口径只允许在此处定义，
 * 服务空间迁移时仅改本文件；禁止在页面、组件中散落硬编码。
 *
 * 凭据口径（uniCloud 官方文档）：
 * - 支付宝云空间没有 clientSecret（那是阿里云空间的参数）；
 * - 支付宝云客户端凭据为 spaceId + accessKey + secretKey + spaceAppId，
 *   均在 uniCloud 控制台（https://unicloud.dcloud.net.cn）对应空间的
 *   「服务空间详情」页查看；
 * - 默认端点为 https://{spaceId}.api-hz.cloudbasefunction.cn，
 *   该域名同时是微信端 request 合法域名。
 *
 * 注意：这里不存放任何上游（育碧）凭据——上游凭据只能存放在
 * uni-config-center / 云函数环境配置中，小程序端不得保存。
 */

export const UNICLOUD_SPACE = {
  provider: 'alipay',
  spaceId: '',
  accessKey: '',
  secretKey: '',
  spaceAppId: '',
} as const;

/** 静态图片（操作员/武器/战队/联赛）托管基址，接入 uniCloud 存储或 CDN 后填写 */
export const ASSET_BASE_URL = '';

const ALIPAY_ENDPOINT_TEMPLATE = 'https://{spaceId}.api-hz.cloudbasefunction.cn';

/** 支付宝云默认端点由 spaceId 派生，空间未配置时返回空串 */
export function getUnicloudEndpoint(): string {
  if (UNICLOUD_SPACE.spaceId === '') {
    return '';
  }
  return ALIPAY_ENDPOINT_TEMPLATE.replace('{spaceId}', UNICLOUD_SPACE.spaceId);
}

export function isUnicloudConfigured(): boolean {
  return (
    UNICLOUD_SPACE.spaceId !== '' &&
    UNICLOUD_SPACE.accessKey !== '' &&
    UNICLOUD_SPACE.secretKey !== '' &&
    UNICLOUD_SPACE.spaceAppId !== ''
  );
}

export function hasAssetBaseUrl(): boolean {
  return ASSET_BASE_URL !== '';
}
