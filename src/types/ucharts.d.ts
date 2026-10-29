/**
 * uCharts v2 最小类型声明：仅覆盖本项目使用的折线图配置面，
 * 完整类型以 uCharts 官方文档（https://www.ucharts.cn）为准。
 */
declare module '@qiun/ucharts' {
  export interface UChartsOptions {
    type: string;
    /** 小程序 canvas 2d 上下文 */
    context: CanvasRenderingContext2D;
    width: number;
    height: number;
    pixelRatio: number;
    categories?: string[];
    series: Array<{
      name: string;
      data: Array<number | null>;
      color?: string;
    }>;
    /** 画布背景色，传 'none' 时不绘制背景 */
    background?: string;
    color?: string[];
    padding?: number[];
    animation?: boolean;
    legend?: { show?: boolean };
    /** uCharts v2 以布尔判断：false 关闭数据标签 */
    dataLabel?: boolean;
    xAxis?: {
      disabled?: boolean;
      disableGrid?: boolean;
      labelCount?: number;
      fontSize?: number;
      fontColor?: string;
      axisLineColor?: string;
      lineHeight?: number;
      marginTop?: number;
    };
    yAxis?: {
      disabled?: boolean;
      gridColor?: string;
      axisLineColor?: string;
      splitNumber?: number;
      fontSize?: number;
      fontColor?: string;
    };
    extra?: {
      line?: {
        type?: string;
        width?: number;
        activeType?: string;
      };
      tooltip?: {
        showBox?: boolean;
        bgColor?: string;
        fontColor?: string;
        legendShow?: boolean;
      };
      /** 横向参考线（本项目仅用于 RP 趋势图的段位边界标注） */
      markLine?: {
        type?: string;
        dashLength?: number;
        data?: Array<{
          value: number;
          lineColor?: string;
          showLabel?: boolean;
          labelText?: string;
          labelFontSize?: number;
          labelPadding?: number;
          labelFontColor?: string;
          labelBgColor?: string;
          labelBgOpacity?: number;
          labelAlign?: string;
          labelOffsetX?: number;
          labelOffsetY?: number;
        }>;
      };
    };
  }

  export default class UCharts {
    constructor(options: UChartsOptions);
    updateData(data: { categories?: string[]; series?: UChartsOptions['series'] }): void;
    stopAnimation(): void;
  }
}
