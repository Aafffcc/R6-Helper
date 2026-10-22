import type { ConfigProviderThemeVars } from '@wot-ui/ui';

/**
 * Wot UI 主题变量映射：把全局 $r6 色板同步到 wd- 组件的 CSS 变量。
 * 键名为组件变量的 camelCase（mapThemeVarsToCSSVars 会转成 --wot-kebab-case），
 * 深色取值与 src/uni.scss 的 $r6-* 保持一致，调整色板时两处同步修改。
 * 所有页面统一通过 wd-config-provider 引用本映射。
 *
 * 注意：wot 2.x 没有 colorTheme 键（品牌色由 primary1..10 色阶与各组件
 * buttonPrimaryBg / tagPrimaryBg 等组件级键驱动），设置 colorTheme 无效。
 */
export const R6_THEME_VARS: ConfigProviderThemeVars = {
  // 品牌色阶（primary5 为主色，primary6 为按压/深一档）
  primary5: '#ff8c1a',
  primary6: '#f07e0d',
  // 语义色（含悬停/按压变体，避免默认蓝色系残留）
  successMain: '#4ade80',
  successHover: '#63e6a0',
  successClicked: '#38b268',
  warningMain: '#ff8c42',
  dangerMain: '#f87171',
  dangerHover: '#ff8f8f',
  dangerClicked: '#e05c5c',
  // 输入框
  inputBg: '#1f232b',
  inputInnerColor: '#f5f6f8',
  inputInnerPlaceholderColor: '#9aa1ac',
  inputIconColor: '#9aa1ac',
  // 搜索框
  searchBg: '#1f232b',
  searchLightBg: '#1f232b',
  searchInputBg: '#262b35',
  searchInputColor: '#f5f6f8',
  searchIconColor: '#9aa1ac',
  searchCancelColor: '#9aa1ac',
  searchCoverBg: '#1f232b',
  // 标签页导航
  tabsNavBg: '#16181d',
  tabsNavColor: '#9aa1ac',
  tabsNavColorActive: '#ff8c1a',
  tabsNavLineBg: '#ff8c1a',
  // 卡片
  cardBg: '#1f232b',
  cardBorderColor: '#2c313b',
  cardTitleColor: '#f5f6f8',
  cardContentColor: '#9aa1ac',
  // 按钮（主按钮 = 橙底深字）
  buttonPrimaryBg: '#ff8c1a',
  buttonPrimaryBgActive: '#f07e0d',
  buttonPrimaryColor: '#16181d',
  buttonPrimaryPlainBg: 'rgba(255, 140, 26, 0.15)',
  buttonPrimaryPlainBorder: '#ff8c1a',
  // 标签（收藏/筛选 chips）
  tagColor: '#f5f6f8',
  tagPrimaryBg: '#ff8c1a',
  tagPrimaryColor: '#16181d',
  tagPrimaryLightBg: 'rgba(255, 140, 26, 0.15)',
  tagInfoLightBg: '#262b35',
  // 骨架屏
  skeletonColBg: '#262b35',
  // 头像
  avatarBg: '#262b35',
  avatarColor: '#ff8c1a',
  // Toast
  toastBg: '#262b35',
  toastColor: '#f5f6f8',
};
