'use strict';

/**
 * uni-config-center：云函数配置中心。
 *
 * DCloud 官方 uni-config-center 仅发布在插件市场、npm 无可用包，
 * CLI 项目按官方目录约定放置在 cloudfunctions/common/uni-config-center，
 * 由云函数以 file: 依赖引用。本文件是接口对齐官方 API 的最小实现：
 *   const uniConfigCenter = require('uni-config-center');
 *   uniConfigCenter({ pluginId: 'r6-upstream' }).config();
 *
 * 各插件配置为本目录下 <pluginId>/config.json；真实密钥文件已在
 * .gitignore 排除，仓库只保留 <pluginId>/config.example.json。
 */

const fs = require('fs');
const path = require('path');

function createConfigCenter(options) {
  const source = typeof options === 'object' && options !== null ? options : {};
  if (typeof source.pluginId !== 'string' || source.pluginId.trim() === '') {
    throw new Error('uni-config-center: pluginId 不能为空');
  }
  const configFile = path.join(__dirname, source.pluginId, 'config.json');
  return {
    config() {
      if (!fs.existsSync(configFile)) {
        return null;
      }
      const raw = fs.readFileSync(configFile, 'utf8');
      try {
        // 容忍 Windows 记事本等编辑器写入的 UTF-8 BOM
        return JSON.parse(raw.replace(/^\uFEFF/, ''));
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown';
        throw new Error(
          `uni-config-center: ${source.pluginId}/config.json 不是合法 JSON（${reason}）`,
        );
      }
    },
  };
}

module.exports = createConfigCenter;
