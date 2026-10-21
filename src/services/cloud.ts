import { UNICLOUD_SPACE, isUnicloudConfigured } from '@/config/env';
import { AppError, toAppError } from '@/types/errors';

interface UniCloudInitOptions {
  provider: string;
  spaceId: string;
  clientSecret: string;
}

interface UniCloudClient {
  importObject(name: string): Record<string, (params?: unknown) => Promise<unknown>>;
}

interface UniCloudGlobal {
  init(options: UniCloudInitOptions): UniCloudClient;
}

let cloudClient: UniCloudClient | null = null;

// 不直接引用全局 uniCloud 声明，避免与平台类型定义冲突；
// 运行时不存在（未配置空间/平台不支持）时按未配置错误收敛。
function getUniCloudGlobal(): UniCloudGlobal {
  const candidate: unknown = (globalThis as { uniCloud?: unknown }).uniCloud;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as { init?: unknown }).init !== 'function'
  ) {
    throw new AppError('E_CLOUD_NOT_CONFIGURED', 'uniCloud 运行时未就绪');
  }
  return candidate as UniCloudGlobal;
}

function getCloudClient(): UniCloudClient {
  if (!isUnicloudConfigured()) {
    throw new AppError('E_CLOUD_NOT_CONFIGURED', 'spaceId / clientSecret 未填写');
  }
  if (cloudClient === null) {
    cloudClient = getUniCloudGlobal().init({
      provider: UNICLOUD_SPACE.provider,
      spaceId: UNICLOUD_SPACE.spaceId,
      clientSecret: UNICLOUD_SPACE.clientSecret,
    });
  }
  return cloudClient;
}

/**
 * 云对象调用统一出口：所有对云对象的访问都经过这里，
 * 统一完成错误收敛，页面层不再感知 importObject 细节。
 */
export async function callCloudObject<T>(
  objectName: string,
  method: string,
  params?: unknown,
): Promise<T> {
  try {
    const target = getCloudClient().importObject(objectName);
    const methodFn = target[method];
    if (typeof methodFn !== 'function') {
      throw new AppError('E_UNKNOWN', `云对象 ${objectName} 不存在方法 ${method}`);
    }
    return (await methodFn(params)) as T;
  } catch (error) {
    throw toAppError(error);
  }
}
