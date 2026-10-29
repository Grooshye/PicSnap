// 导入：把用户选择的照片解码成 ImageItem（对应 Windows 版 app/core/importer.py）
import { ImageItem, decodeCapped } from './models.js';

const OK_TYPES = /^image\//;

export function isImageFile(file) {
  if (OK_TYPES.test(file.type)) return true;
  return /\.(jpe?g|png|bmp|webp|gif|tiff?|hei[cf]|avif)$/i.test(file.name || '');
}

/**
 * 批量导入文件，返回 ImageItem 数组（无法识别的自动跳过）
 * @param {FileList|File[]} files
 * @param {(done:number, total:number)=>void} [onProgress]
 */
export async function importFiles(files, onProgress) {
  const list = Array.from(files || []).filter(isImageFile);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    try {
      // 先解一张原始尺寸的位图拿宽高，再生成缩略图
      const full = await decodeCapped(file, 4096);
      const width = full.width;
      const height = full.height;
      const item = new ImageItem(file, file.name, width, height);
      item.thumb = await decodeCapped(file, 300);
      // 原始位图如果够小就直接当预览图用，省一次解码
      item.preview = width <= 1024 && height <= 1024 ? full : null;
      out.push(item);
    } catch (e) {
      console.warn('跳过无法识别的文件：', file.name, e);
    }
    onProgress?.(i + 1, list.length);
  }
  return out;
}

/** 从 URL 列表（拖拽进来的文件）取出 File 对象 */
export function filesFromDataTransfer(dt) {
  const files = [];
  if (dt.files && dt.files.length) files.push(...dt.files);
  else if (dt.items) {
    for (const it of dt.items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  return files;
}
