/**
 * tabbar 图标维护脚本：从 Wot UI 的 wd-icon 字体（iconfont.ttf）中
 * 把 pages.json 原生 tabBar 所需的图标渲染为 PNG。
 *
 * 背景：微信原生 tabBar 的 iconPath 只接受本地 PNG（建议 81x81、单张 <=40KB），
 * 不能用字体图标；此脚本是组件库图标与 tabBar 之间的唯一桥梁，
 * 图标来源与 wd-icon 保持同一字体，Wot UI 升级后重跑本脚本即可同步。
 *
 * 产物写入 src/static/tabbar/，不允许手工编辑；
 * 调整图标选型改下方 TAB_ICONS，调整配色改 TABBAR_COLORS（须与 pages.json 一致）。
 */

import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSync as openFontSync } from 'fontkit';
import sharp from 'sharp';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const iconfontDir = join(projectRoot, 'node_modules', '@wot-ui', 'ui', 'components', 'wd-icon');
const outputDir = join(projectRoot, 'src', 'static', 'tabbar');

// 微信 tabBar 图标建议尺寸与单张体积上限
const ICON_SIZE = 81;
const MAX_FILE_BYTES = 40 * 1024;
// 字形外接框四周留白比例，避免图标顶满画布
const PADDING_RATIO = 0.06;

// tabBar 文字配色（必须与 src/pages.json 的 tabBar.color / selectedColor 一致）
const TABBAR_COLORS = {
  normal: '#9aa1ac',
  selected: '#ff8c1a',
};

// tab -> wd-icon 图标名；换图标只改这里的名字
const TAB_ICONS = {
  stats: 'command',
  esports: 'live-broadcast',
  library: 'book',
  agent: 'robot',
  profile: 'user',
};

function fail(message) {
  console.error(`[gen:tabbar-icons] ${message}`);
  process.exitCode = 1;
}

/** 解析 iconfont.scss，得到图标名 -> 码点（十进制数字）映射 */
function parseCodepoints(scss) {
  const codepoints = new Map();
  const pattern = /\.wd-icon-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([0-9a-fA-F]+)"/g;
  let match = pattern.exec(scss);
  while (match !== null) {
    codepoints.set(match[1], Number.parseInt(match[2], 16));
    match = pattern.exec(scss);
  }
  return codepoints;
}

/** 字形路径命令序列转 SVG path data，同时把字体 y 轴向上的坐标翻转为 SVG y 轴向下 */
function glyphPathData(glyph, transformPoint) {
  const parts = [];
  for (const { command, args } of glyph.path.commands) {
    const points = [];
    for (let i = 0; i < args.length; i += 2) {
      points.push(transformPoint(args[i], args[i + 1]));
    }
    switch (command) {
      case 'moveTo':
        parts.push(`M${points[0][0]} ${points[0][1]}`);
        break;
      case 'lineTo':
        parts.push(`L${points[0][0]} ${points[0][1]}`);
        break;
      case 'quadraticCurveTo':
        parts.push(`Q${points[0][0]} ${points[0][1]} ${points[1][0]} ${points[1][1]}`);
        break;
      case 'bezierCurveTo':
        parts.push(
          `C${points[0][0]} ${points[0][1]} ${points[1][0]} ${points[1][1]} ${points[2][0]} ${points[2][1]}`,
        );
        break;
      case 'closePath':
        parts.push('Z');
        break;
      default:
        fail(`未支持的路径命令：${command}`);
        return null;
    }
  }
  return parts.join('');
}

/** 计算路径所有坐标点的包围盒（控制点参与计算，对图标渲染足够） */
function pathBounds(data) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const pattern = /[MLQCZ]|(-?\d+(?:\.\d+)?)/g;
  let match = pattern.exec(data);
  let xs = [];
  while (match !== null) {
    if (match[1] !== undefined) {
      xs.push(Number.parseFloat(match[1]));
      if (xs.length === 2) {
        x1 = Math.min(x1, xs[0]);
        x2 = Math.max(x2, xs[0]);
        y1 = Math.min(y1, xs[1]);
        y2 = Math.max(y2, xs[1]);
        xs = [];
      }
    } else if (match[0] === 'Z') {
      xs = [];
    }
    match = pattern.exec(data);
  }
  return { x1, y1, x2, y2 };
}

/** 用 sharp 把 SVG 字符串渲染为 81x81 PNG，返回文件体积 */
async function renderPng(svg, outPath) {
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  return statSync(outPath).size;
}

async function main() {
  const scss = readFileSync(join(iconfontDir, 'iconfont.scss'), 'utf8');
  const codepoints = parseCodepoints(scss);
  const font = openFontSync(join(iconfontDir, 'iconfont.ttf'));

  mkdirSync(outputDir, { recursive: true });

  for (const [tab, iconName] of Object.entries(TAB_ICONS)) {
    const codepoint = codepoints.get(iconName);
    if (codepoint === undefined) {
      fail(`iconfont.scss 中找不到图标 wd-icon-${iconName}（tab: ${tab}）`);
      continue;
    }
    const glyph = font.glyphsForString(String.fromCodePoint(codepoint))[0];
    if (glyph === undefined) {
      fail(`iconfont.ttf 中找不到码点 U+${codepoint.toString(16)} 的字形（wd-icon-${iconName}）`);
      continue;
    }

    // 字体坐标 y 向上、基线为 0，统一翻转到 SVG 的 y 向下坐标
    const flip = (x, y) => [x, -y];
    const pathData = glyphPathData(glyph, flip);
    if (pathData === null) {
      continue;
    }
    const { x1, y1, x2, y2 } = pathBounds(pathData);
    const contentWidth = x2 - x1;
    const contentHeight = y2 - y1;
    if (!(contentWidth > 0) || !(contentHeight > 0)) {
      fail(`wd-icon-${iconName} 字形包围盒异常：${JSON.stringify({ x1, y1, x2, y2 })}`);
      continue;
    }
    // 正方形画布 + 四周留白，短边方向居中
    const side = Math.max(contentWidth, contentHeight) * (1 + PADDING_RATIO * 2);
    const startX = x1 - (side - contentWidth) / 2;
    const startY = y1 - (side - contentHeight) / 2;

    for (const [suffix, color] of [
      ['', TABBAR_COLORS.normal],
      ['-selected', TABBAR_COLORS.selected],
    ]) {
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" ` +
        `viewBox="${startX} ${startY} ${side} ${side}"><path d="${pathData}" fill="${color}"/></svg>`;
      const outPath = join(outputDir, `${tab}${suffix}.png`);
      const bytes = await renderPng(svg, outPath);
      if (bytes > MAX_FILE_BYTES) {
        fail(`${tab}${suffix}.png 体积 ${bytes} 字节，超过微信 40KB 上限`);
        continue;
      }
      console.log(`生成 ${tab}${suffix}.png（wd-icon-${iconName}，${bytes} 字节）`);
    }
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
