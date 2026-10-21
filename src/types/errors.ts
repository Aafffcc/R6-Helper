/**
 * 应用错误模型：云对象抛出的 errCode 在客户端统一收敛为 AppError，
 * 页面只认 AppError.code 与 message，不直接解析云端错误结构。
 */

export type AppErrorCode =
  | 'E_CLOUD_NOT_CONFIGURED'
  | 'E_UPSTREAM_NOT_CONFIGURED'
  | 'E_INVALID_PARAM'
  | 'E_NOT_FOUND'
  | 'E_RATE_LIMITED'
  | 'E_UPSTREAM_ERROR'
  | 'E_NETWORK'
  | 'E_UNKNOWN';

const FRIENDLY_MESSAGES: Readonly<Record<AppErrorCode, string>> = {
  E_CLOUD_NOT_CONFIGURED: '云服务空间尚未配置，请先在 src/config/env.ts 填写空间信息',
  E_UPSTREAM_NOT_CONFIGURED: '上游数据源尚未接入，确定凭据与字段口径后即可开放查询',
  E_INVALID_PARAM: '查询参数有误，请检查昵称与平台',
  E_NOT_FOUND: '未找到该玩家，请确认昵称与平台',
  E_RATE_LIMITED: '查询过于频繁，请稍后再试',
  E_UPSTREAM_ERROR: '上游数据源暂时不可用，请稍后再试',
  E_NETWORK: '网络异常，请确认小程序已配置云服务合法域名',
  E_UNKNOWN: '查询失败，请稍后再试',
};

const KNOWN_CODES = new Set<string>(Object.keys(FRIENDLY_MESSAGES));

export class AppError extends Error {
  readonly code: AppErrorCode;

  /** 云端/底层原始错误信息，仅用于诊断，不直接展示 */
  readonly detail: string | null;

  constructor(code: AppErrorCode, detail: string | null) {
    super(FRIENDLY_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

function readStringProperty(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) {
    return null;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const code = readStringProperty(error, 'errCode');
  if (code !== null && KNOWN_CODES.has(code)) {
    return new AppError(code as AppErrorCode, readStringProperty(error, 'errMsg') ?? code);
  }
  const detail =
    readStringProperty(error, 'errMsg') ?? readStringProperty(error, 'message') ?? code;
  return new AppError('E_UNKNOWN', detail);
}

/**
 * 云对象响应信封校验：云端以 200 响应体返回 { errCode, errMsg } 表示业务错误，
 * errCode 缺失或为 'OK' 视为成功。支付宝云传输层不保留 throw 的 errCode
 * （任何 throw 都变成调用失败并丢失错误码），因此业务错误不走 throw 传输。
 */
export function assertCloudSuccess(result: unknown): void {
  if (typeof result !== 'object' || result === null) {
    return;
  }
  const errCode = readStringProperty(result, 'errCode');
  if (errCode === null || errCode === 'OK') {
    return;
  }
  const errMsg = readStringProperty(result, 'errMsg');
  throw new AppError(
    (KNOWN_CODES.has(errCode) ? errCode : 'E_UNKNOWN') as AppErrorCode,
    errMsg ?? errCode,
  );
}
