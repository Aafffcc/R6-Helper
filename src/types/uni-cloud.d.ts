/**
 * @dcloudio/uni-cloud 客户端 SDK 未随包发布类型声明。
 * 这里按本项目用到的最小接口声明（init / importObject），
 * 参数口径以 uniCloud 官方文档「一个应用访问多个服务空间」为准。
 */
declare module '@dcloudio/uni-cloud' {
  export interface UniCloudInitOptions {
    provider: string;
    spaceId: string;
    /** 阿里云空间参数 */
    clientSecret?: string;
    /** 支付宝云空间参数 */
    accessKey?: string;
    secretKey?: string;
    spaceAppId?: string;
    endpoint?: string;
    wsEndpoint?: string;
  }

  export interface UniCloudObject {
    [method: string]: (params?: unknown) => Promise<unknown>;
  }

  export interface UniCloudInstance {
    init(options: UniCloudInitOptions): UniCloudInstance;
    importObject(objectName: string, options?: unknown): UniCloudObject;
  }

  const uniCloud: UniCloudInstance;
  export default uniCloud;
}
