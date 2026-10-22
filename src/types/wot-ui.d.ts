// Wot UI 的 GlobalComponents 全局类型增强。用 d.ts 三斜线引用而非 tsconfig types 数组，
// 因为 types 字段对包子路径（@wot-ui/ui/global）的解析依赖 TS 版本，编辑器内易报 TS2688。
/// <reference types="@wot-ui/ui/global" />
