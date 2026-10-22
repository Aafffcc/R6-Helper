import uniCloudSdk, { type UniCloudInstance } from '@dcloudio/uni-cloud';

import { UNICLOUD_SPACE, getUnicloudEndpoint, isUnicloudConfigured } from '@/config/env';
import { AppError, toAppError, unwrapCloudResult } from '@/types/errors';

let cloudClient: UniCloudInstance | null = null;

// CLI 构建不会自动注入 uniCloud 运行时（那需要 HBuilderX 的运行菜单），
// 因此显式 import SDK，并用 .env.local 的空间配置初始化，联调不依赖 HBuilderX。
function getCloudClient(): UniCloudInstance {
  if (!isUnicloudConfigured()) {
    throw new AppError(
      'E_CLOUD_NOT_CONFIGURED',
      '空间凭据未填写（spaceId / accessKey / secretKey / spaceAppId）',
    );
  }
  if (cloudClient === null) {
    cloudClient = uniCloudSdk.init({
      provider: UNICLOUD_SPACE.provider,
      spaceId: UNICLOUD_SPACE.spaceId,
      accessKey: UNICLOUD_SPACE.accessKey,
      secretKey: UNICLOUD_SPACE.secretKey,
      spaceAppId: UNICLOUD_SPACE.spaceAppId,
      endpoint: getUnicloudEndpoint(),
    });
  }
  return cloudClient;
}

/**
 * 云对象调用统一出口：所有对云对象的访问都经过这里，
 * 统一完成响应解包与错误收敛，页面层不再感知 importObject 细节。
 */
export async function callCloudObject<T>(
  objectName: string,
  method: string,
  params?: unknown,
): Promise<T> {
  try {
    const target = getCloudClient().importObject(objectName, { customUI: true });
    const methodFn = target[method];
    if (typeof methodFn !== 'function') {
      throw new AppError('E_UNKNOWN', `云对象 ${objectName} 不存在方法 ${method}`);
    }
    const result: unknown = await methodFn(params);
    return unwrapCloudResult(result) as T;
  } catch (error) {
    throw toAppError(error);
  }
}
