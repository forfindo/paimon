import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import { normalizeMessage } from '@snowluma/sdk';
import type { AnyMessageSegment, JsonObject, OutgoingMessage } from '@snowluma/sdk';
import type { MessageElem, Sendable } from './message-part.js';

type FileInput = string | Buffer | Readable;

/** 将 icqq 的文件字段（路径 / Buffer / 流）统一成 OneBot 的 file 字符串 */
function toFile(file: FileInput): string | null {
  if (Buffer.isBuffer(file)) {
    return `base64://${file.toString('base64')}`;
  }
  if (typeof file !== 'string') {
    // 流无法同步读取，发送流请使用 sendGroupImage / sendGroupRecord 等上传 API
    return null;
  }
  if (/^(?:base64:\/\/|data:|https?:)/i.test(file)) {
    return file;
  }
  let path = file;
  if (path.startsWith('file://')) {
    try {
      path = fileURLToPath(path);
    } catch {
      path = path.replace(/^file:\/+/i, '');
    }
  }
  try {
    return `base64://${readFileSync(path).toString('base64')}`;
  } catch {
    return file;
  }
}

/** 没有对应 OneBot 类型的元素，用 raw 段原样透传，避免信息丢失 */
function raw(type: string, data: JsonObject): AnyMessageSegment {
  return { type, data };
}

/** 单个 icqq 消息元素 -> SDK 可识别的消息段，无法映射时返回 null */
export function convertMessageElem(elem: MessageElem): AnyMessageSegment | null {
  switch (elem.type) {
    case 'text':
      return elem.text ? { type: 'text', data: { text: elem.text } } : null;
    case 'at': {
      if (elem.dummy) {
        const text = elem.text ?? (elem.qq === 'all' ? '@全体成员' : `@${elem.qq}`);
        return { type: 'text', data: { text } };
      }
      return { type: 'at', data: { qq: String(elem.qq) } };
    }
    case 'face':
    case 'sface':
      return { type: 'face', data: { id: String(elem.id) } };
    case 'bface':
      return raw('bface', { file: elem.file, text: elem.text });
    case 'rps':
    case 'dice':
      return raw(elem.type, elem.id === undefined ? {} : { id: elem.id });
    case 'image': {
      const file = toFile(elem.file);
      if (!file) return null;
      return { type: 'image', data: { file, ...(elem.url ? { url: elem.url } : {}) } };
    }
    case 'flash': {
      const file = toFile(elem.file);
      if (!file) return null;
      return { type: 'image', data: { file, type: 'flash' } };
    }
    case 'record': {
      const file = toFile(elem.file);
      if (!file) return null;
      return { type: 'record', data: { file, ...(elem.url ? { url: elem.url } : {}) } };
    }
    case 'video':
      return { type: 'video', data: { file: elem.file } };
    case 'location':
      return {
        type: 'location',
        data: {
          lat: elem.lat,
          lon: elem.lng,
          ...(elem.name ? { title: elem.name } : {}),
          ...(elem.address ? { content: elem.address } : {}),
        },
      };
    case 'share':
      return {
        type: 'share',
        data: {
          url: elem.url,
          title: elem.title,
          ...(elem.content ? { content: elem.content } : {}),
          ...(elem.image ? { image: elem.image } : {}),
        },
      };
    case 'json':
      return {
        type: 'json',
        data: { data: typeof elem.data === 'string' ? elem.data : JSON.stringify(elem.data) },
      };
    case 'xml':
      return {
        type: 'xml',
        data: { data: elem.data, ...(elem.id === undefined ? {} : { id: String(elem.id) }) },
      };
    case 'poke':
      return { type: 'poke', data: { type: elem.id } };
    case 'reply':
      return { type: 'reply', data: { id: String(elem.id) } };
    case 'forward':
      return { type: 'forward', data: { id: elem.id, res_id: elem.id, forward_id: elem.id } };
    case 'mirai':
      return raw('mirai', { data: elem.data });
    case 'lottie':
      return raw('lottie', { id: elem.id, ...(elem.text ? { text: elem.text } : {}) });
    // file / redPacket 没有 OneBot 消息段，发送文件请走专用上传 API
    case 'file':
    case 'redPacket':
      return null;
    default:
      return null;
  }
}

/** 将 OutgoingMessage（字符串 / 消息段数组）转成转发预览用纯文本，非文本段用类型占位 */
export function outgoingToText(content: string | AnyMessageSegment[]): string {
  if (typeof content === 'string') {
    return content;
  }
  const parts: string[] = [];
  for (const segment of content) {
    const data: Record<string, unknown> = segment.data;
    switch (segment.type) {
      case 'text':
        if (typeof data.text === 'string') parts.push(data.text);
        break;
      case 'at':
        parts.push(`@${data.qq}`);
        break;
      case 'face':
        parts.push('[表情]');
        break;
      case 'image':
        parts.push('[图片]');
        break;
      case 'record':
        parts.push('[语音]');
        break;
      case 'video':
        parts.push('[视频]');
        break;
      case 'reply':
        parts.push('[回复]');
        break;
      case 'forward':
        parts.push('[转发]');
        break;
      case 'json':
      case 'xml':
        parts.push('[卡片]');
        break;
      case 'poke':
        parts.push('[戳一戳]');
        break;
      case 'location':
        parts.push('[位置]');
        break;
      case 'share':
        parts.push('[分享]');
        break;
      default:
        break;
    }
  }
  return parts.join('');
}

/** 将 Sendable（字符串 / 元素 / 元素数组）转换为 SDK 的 OutgoingMessage */
export function toOutgoingMessage(content: Sendable): string | AnyMessageSegment[] {
  if (typeof content === 'string') {
    return content;
  }
  const list = Array.isArray(content) ? content : [content];
  const segments: AnyMessageSegment[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      if (item.length > 0) {
        segments.push({ type: 'text', data: { text: item } });
      }
      continue;
    }
    const segment = convertMessageElem(item);
    if (segment) {
      segments.push(segment);
    }
  }
  return segments;
}

/** 字符串 / 数字统一转成 number，非法时返回 null */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 单个 SDK 消息段 -> icqq 消息元素，无法映射时返回 null */
export function convertSegment(segment: AnyMessageSegment): MessageElem | null {
  const type = segment.type;
  // 各段的 data 字段类型不同，这里统一按 Record<string, unknown> 读取并做运行时校验
  const data: Record<string, unknown> = segment.data;
  switch (type) {
    case 'text': {
      const text = data.text;
      return typeof text === 'string' ? { type: 'text', text } : null;
    }
    case 'face': {
      const id = toNumber(data.id);
      return id === null ? null : { type: 'face', id };
    }
    case 'at': {
      const qq = data.qq === 'all' ? 'all' : toNumber(data.qq);
      return qq === null ? null : { type: 'at', qq };
    }
    case 'reply':
      return typeof data.id === 'string' ? { type: 'reply', id: data.id } : null;
    case 'image': {
      const file = data.file;
      if (typeof file !== 'string') {
        return null;
      }
      const url = typeof data.url === 'string' ? { url: data.url } : {};
      return data.type === 'flash'
        ? { type: 'flash', file, ...url }
        : { type: 'image', file, ...url };
    }
    case 'record': {
      const file = data.file;
      if (typeof file !== 'string') {
        return null;
      }
      return { type: 'record', file, ...(typeof data.url === 'string' ? { url: data.url } : {}) };
    }
    case 'video': {
      const file = data.file;
      return typeof file === 'string' ? { type: 'video', file } : null;
    }
    case 'json': {
      const json = data.data;
      return typeof json === 'string' ? { type: 'json', data: json } : null;
    }
    case 'xml': {
      const xml = data.data;
      if (typeof xml !== 'string') {
        return null;
      }
      const id = data.id === undefined ? null : toNumber(data.id);
      return { type: 'xml', data: xml, ...(id === null ? {} : { id }) };
    }
    case 'poke': {
      const id = toNumber(data.type);
      return id === null ? null : { type: 'poke', id };
    }
    case 'location': {
      const lat = toNumber(data.lat);
      const lng = toNumber(data.lon);
      if (lat === null || lng === null) {
        return null;
      }
      const content = data.content;
      const title = data.title;
      return {
        type: 'location',
        lat,
        lng,
        address: typeof content === 'string' ? content : '',
        ...(typeof title === 'string' ? { name: title } : {}),
      };
    }
    case 'share': {
      const url = data.url;
      const title = data.title;
      if (typeof url !== 'string' || typeof title !== 'string') {
        return null;
      }
      const content = data.content;
      const image = data.image;
      return {
        type: 'share',
        url,
        title,
        ...(typeof content === 'string' ? { content } : {}),
        ...(typeof image === 'string' ? { image } : {}),
      };
    }
    case 'forward': {
      const id = typeof data.id === 'string' ? data.id : '';
      return id ? { type: 'forward', id } : null;
    }
    // node / music / contact 没有对应的 MessageElem，丢弃
    case 'node':
    case 'music':
    case 'contact':
      return null;
    case 'bface': {
      const file = data.file;
      const text = data.text;
      return {
        type: 'bface',
        file: typeof file === 'string' ? file : '',
        text: typeof text === 'string' ? text : '',
      };
    }
    case 'rps':
    case 'dice': {
      const id = toNumber(data.id);
      return { type, ...(id === null ? {} : { id }) };
    }
    case 'mirai': {
      const mdata = data.data;
      return { type: 'mirai', data: typeof mdata === 'string' ? mdata : '' };
    }
    case 'lottie': {
      const id = toNumber(data.id);
      if (id === null) {
        return null;
      }
      const text = data.text;
      return { type: 'lottie', id, ...(typeof text === 'string' ? { text } : {}) };
    }
    default:
      return null;
  }
}

/** 将 OutgoingMessage 转换为 icqq 的 Sendable */
export function toSendable(content: OutgoingMessage): Sendable {
  const normalized = normalizeMessage(content);
  if (typeof normalized === 'string') {
    return normalized;
  }
  const elems: MessageElem[] = [];
  for (const segment of normalized) {
    const elem = convertSegment(segment);
    if (elem) {
      elems.push(elem);
    }
  }
  return elems;
}
