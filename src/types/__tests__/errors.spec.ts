import { describe, expect, it } from 'vitest';

import { AppError, assertCloudSuccess, toAppError } from '../errors';

describe('toAppError', () => {
  it('AppError 原样返回，不重复包装', () => {
    const original = new AppError('E_NOT_FOUND', 'detail');
    expect(toAppError(original)).toBe(original);
  });

  it('云端结构化错误按 errCode 收敛，原始信息进 detail', () => {
    const cloudError = Object.assign(new Error('上游数据源尚未接入'), {
      errCode: 'E_UPSTREAM_NOT_CONFIGURED',
      errMsg: '上游数据源尚未接入',
    });
    const appError = toAppError(cloudError);
    expect(appError.code).toBe('E_UPSTREAM_NOT_CONFIGURED');
    expect(appError.detail).toBe('上游数据源尚未接入');
    expect(appError.message).not.toBe('');
  });

  it('传输层异常（HTTP 500 等）收敛为 E_UNKNOWN，不暴露原始堆栈文案', () => {
    const appError = toAppError(new Error('[stats]: 用户函数代码语法或逻辑异常'));
    expect(appError.code).toBe('E_UNKNOWN');
    expect(appError.detail).toBe('[stats]: 用户函数代码语法或逻辑异常');
  });

  it('非对象异常收敛为 E_UNKNOWN', () => {
    expect(toAppError('boom').code).toBe('E_UNKNOWN');
    expect(toAppError(null).code).toBe('E_UNKNOWN');
    expect(toAppError(undefined).code).toBe('E_UNKNOWN');
  });
});

describe('assertCloudSuccess（云对象响应信封）', () => {
  it('成功信封与无 errCode 的响应直接通过', () => {
    expect(() => assertCloudSuccess({ errCode: 'OK', stats: {}, fromCache: true })).not.toThrow();
    expect(() => assertCloudSuccess({ stats: {} })).not.toThrow();
    expect(() => assertCloudSuccess(null)).not.toThrow();
  });

  it('业务错误信封转为 AppError 并保留错误码', () => {
    expect(() =>
      assertCloudSuccess({ errCode: 'E_UPSTREAM_NOT_CONFIGURED', errMsg: '上游数据源尚未接入' }),
    ).toThrowError(AppError);
    try {
      assertCloudSuccess({ errCode: 'E_UPSTREAM_NOT_CONFIGURED', errMsg: '上游数据源尚未接入' });
    } catch (error) {
      expect((error as AppError).code).toBe('E_UPSTREAM_NOT_CONFIGURED');
      expect((error as AppError).detail).toBe('上游数据源尚未接入');
    }
  });

  it('未知错误码收敛为 E_UNKNOWN', () => {
    try {
      assertCloudSuccess({ errCode: 'E_SOMETHING_NEW', errMsg: '未知错误' });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as AppError).code).toBe('E_UNKNOWN');
    }
  });
});
