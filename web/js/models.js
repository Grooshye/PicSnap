// 数据模型：图片 / 格子 / 分组（对应 Windows 版 app/models.py）

let nextId = 1;

export class ImageItem {
  /**
   * @param {Blob} blob   原始文件（导出时按需重新解码，保证画质）
   * @param {string} name 显示用文件名
   * @param {number} width  原始宽（EXIF 已校正）
   * @param {number} height 原始高
   */
  constructor(blob, name, width, height) {
    this.id = nextId++;
    this.blob = blob;
    this.name = name || '图片';
    this.width = width;
    this.height = height;

    this.thumb = null;      // ImageBitmap ~300px，图库缩略图
    this.preview = null;    // ImageBitmap ~1024px，画布显示用
    this._fullPromise = null;
    this._processed = new Map();   // 模糊/马赛克缓存
  }

  /** 画布显示用的中等尺寸图 */
  ensurePreview(size = 1024) {
    if (this.preview) return Promise.resolve(this.preview);
    if (!this._previewPromise) {
      this._previewPromise = decodeCapped(this.blob, size).then((bmp) => {
        this.preview = bmp;
        return bmp;
      });
    }
    return this._previewPromise;
  }

  /** 导出用的高分辨率图（不写回 preview，用完即可释放） */
  ensureFull(size = 3200) {
    return decodeCapped(this.blob, size);
  }

  /** 按模糊/马赛克参数取处理后的图（带缓存，最多 6 份，防止手机内存爆掉） */
  processed(img, mode, amount) {
    if (mode === 'none' || !amount) return img;
    const key = `${img.width}x${img.height}|${mode}|${amount}`;
    let hit = this._processed.get(key);
    if (hit) {
      // 命中后挪到队尾，保持最近使用的留在缓存里
      this._processed.delete(key);
      this._processed.set(key, hit);
      return hit;
    }
    hit = applyEffect(img, mode, amount);
    this._processed.set(key, hit);
    while (this._processed.size > 6) {
      const oldest = this._processed.keys().next().value;
      this._processed.delete(oldest);
    }
    return hit;
  }

  /** 缩略图的 data URL，供拖拽浮层使用（懒生成 + 缓存） */
  get thumbUrl() {
    if (this._thumbUrl) return this._thumbUrl;
    const src = this.thumb;
    if (!src) return '';
    const cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    cv.getContext('2d').drawImage(src, 0, 0);
    this._thumbUrl = cv.toDataURL('image/jpeg', 0.82);
    return this._thumbUrl;
  }

  clearCache() {
    this._processed.clear();
  }
}

/** 用 <img> 解码（浏览器会自动按 EXIF 摆正方向），比 createImageBitmap 兼容性好 */
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    img.src = url;
  });
}

/**
 * 解码 blob 并限制最长边（保持比例），返回 canvas。
 * 统一返回 canvas，drawImage / 裁剪都能直接用。
 */
export async function decodeCapped(blob, maxSide) {
  const img = await loadImage(blob);
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  if (!nw || !nh) throw new Error('图片尺寸无效');

  const scale = Math.min(1, maxSide / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  // 立刻释放解码出来的大图，避免手机内存吃紧
  img.src = '';
  return cv;
}

/** 模糊 / 马赛克处理，返回 canvas */
export function applyEffect(img, mode, amount) {
  const w = img.width;
  const h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const t = Math.max(0, Math.min(100, amount)) / 100;

  if (mode === 'mosaic') {
    // 马赛克：先缩到很小，再关掉平滑放大回去
    const block = Math.max(2, Math.round((Math.min(w, h) / 100) * (1 + t * 24)));
    const sw = Math.max(1, Math.round(w / block));
    const sh = Math.max(1, Math.round(h / block));
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(img, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
    return cv;
  }

  // 高斯模糊：留出边距避免边缘发暗
  const radius = Math.max(0.5, (Math.min(w, h) / 100) * (1 + t * 6));
  const pad = Math.ceil(radius * 3);
  const big = document.createElement('canvas');
  big.width = w + pad * 2;
  big.height = h + pad * 2;
  const bctx = big.getContext('2d');
  bctx.filter = `blur(${radius}px)`;
  bctx.drawImage(img, pad, pad, w, h);
  // 四边延展，避免模糊后边缘透明
  bctx.drawImage(img, 0, 0, 1, h, pad - 1, pad, 1, h);
  bctx.drawImage(img, w - 1, 0, 1, h, pad + w, pad, 1, h);
  bctx.drawImage(img, 0, 0, w, 1, pad, pad - 1, w, 1);
  bctx.drawImage(img, 0, h - 1, w, 1, pad, pad + h, w, 1);
  ctx.drawImage(big, pad, pad, w, h, 0, 0, w, h);
  return cv;
}

export class Cell {
  constructor(image = null) {
    this.image = image;   // ImageItem
    this.cx = 0.5;        // 可见区域中心 x（归一化 0~1）
    this.cy = 0.5;        // 可见区域中心 y
    this.zoom = 1;        // 缩放倍数（1 = 整图铺满，>1 放大）
    this.blurMode = 'none';   // none | blur | mosaic
    this.blurAmount = 30;     // 0~100
  }
}

export class Group {
  constructor(name, templateName = '', layout = []) {
    this.name = name || '分组';
    this.mode = 'grid';
    this.templateName = templateName;
    this.layout = layout.map((r) => [...r]);
    this.cells = [];
    this.ensureCells();
  }

  ensureCells() {
    const n = this.layout.length;
    while (this.cells.length < n) this.cells.push(new Cell());
    if (this.cells.length > n) this.cells.length = n;
  }

  /** 分组内出现的图片（去重、按格子顺序） */
  images() {
    const out = [];
    for (const c of this.cells) {
      if (c.image && !out.includes(c.image)) out.push(c.image);
    }
    return out;
  }

  hasImage(img) {
    return this.cells.some((c) => c.image === img);
  }

  cellOf(img) {
    return this.cells.findIndex((c) => c.image === img);
  }

  removeImage(img) {
    for (const c of this.cells) if (c.image === img) c.image = null;
  }

  /** 把图放入指定格或第一个空格，返回格子索引（放不进则 -1） */
  placeImage(img, index = null) {
    this.ensureCells();
    if (index != null && index >= 0 && index < this.cells.length) {
      const c = this.cells[index];
      c.image = img;
      c.cx = c.cy = 0.5;
      c.zoom = 1;
      return index;
    }
    for (let i = 0; i < this.cells.length; i++) {
      if (!this.cells[i].image) {
        const c = this.cells[i];
        c.image = img;
        c.cx = c.cy = 0.5;
        c.zoom = 1;
        return i;
      }
    }
    return -1;
  }
}
