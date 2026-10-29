// 全局运行设置（对应 Windows 版 app/core/settings.py）

export const settings = {
  gapEnabled: true,       // true = 有缝隙；false = 无框线无缝拼贴
  allowDuplicate: false,  // 允许同一张图重复放入多个格/分组
  artW: 1080,
  artH: 1080,
  freeMode: false,        // 自由模式：可拖动外框改尺寸
  sizeIndex: 0,           // 尺寸下拉当前项
};

export const SIZE_PRESETS = [
  { name: '1080×1080 方形', w: 1080, h: 1080, aspect: 1 },
  { name: '1080×1440 竖版', w: 1080, h: 1440, aspect: 3 / 4 },
  { name: '1440×1080 横版', w: 1440, h: 1080, aspect: 4 / 3 },
  { name: '自定义…', w: 0, h: 0, aspect: 1 },
];

export const FREE_MODE_INDEX = 4;   // 尺寸下拉里「自由模式」的位置
export const MIN_ART = 200;
export const MAX_ART = 4000;
