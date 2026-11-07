import type {
  AnyMessageSegment,
  OneBotGroupMessageEvent,
  OneBotPrivateMessageEvent,
  OneBotSender,
} from '@snowluma/sdk';
import { outgoingToText } from './message-convert.js';

/** OneBot12 消息段，标准段之外保留原始扩展段 */
export interface OneBot12MessageSegment {
  type: string;
  data: Record<string, unknown>;
}

/** OneBot12 事件的机器人自身标识 */
export interface OneBot12Self {
  platform: string;
  user_id: string;
}

/** OneBot12 扩展的发送者信息 */
export interface OneBot12Sender {
  user_id: string;
  name?: string;
  nickname?: string;
  card?: string;
  role?: string;
}

/** OneBot12 消息事件，标准字段必填，sender/group_name 作为扩展字段 */
export interface OneBot12MessageEvent {
  id: string;
  time: number;
  type: 'message';
  detail_type: 'group' | 'private';
  sub_type: string;
  self: OneBot12Self;
  message_id: string;
  message: OneBot12MessageSegment[];
  alt_message: string;
  user_id: string;
  group_id?: string;
  group_name?: string;
  sender?: OneBot12Sender;
}

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
};

/** 单个 OneBot11 消息段 -> OneBot12 消息段 */
export function convertEventSegment(segment: AnyMessageSegment): OneBot12MessageSegment {
  // 各段的 data 结构不同，这里统一按 Record 读取
  const data = segment.data as Record<string, unknown>;
  switch (segment.type) {
    case 'text':
      return { type: 'text', data: { text: toText(data.text) } };
    case 'at': {
      const userId = data.qq ?? data.uid;
      if (userId === 'all') {
        return { type: 'mention_all', data: {} };
      }
      return { type: 'mention', data: { user_id: toText(userId) } };
    }
    case 'image': {
      const { file, ...rest } = data;
      return { type: 'image', data: { ...rest, file_id: toText(file) } };
    }
    case 'record': {
      const { file, ...rest } = data;
      return { type: 'voice', data: { ...rest, file_id: toText(file) } };
    }
    case 'video': {
      const { file, ...rest } = data;
      return { type: 'video', data: { ...rest, file_id: toText(file) } };
    }
    case 'file': {
      const { file, ...rest } = data;
      return { type: 'file', data: { ...rest, file_id: toText(data.file_id ?? file) } };
    }
    case 'location': {
      const { lat, lon, ...rest } = data;
      return {
        type: 'location',
        data: {
          ...rest,
          latitude: Number(lat) || 0,
          longitude: Number(lon) || 0,
          title: toText(data.title),
          content: toText(data.content),
        },
      };
    }
    case 'reply': {
      const { id, ...rest } = data;
      return { type: 'reply', data: { ...rest, message_id: toText(id) } };
    }
    default:
      // 非 OneBot12 标准段（face / json / xml / poke / forward 等）作为扩展段原样保留
      return { type: segment.type, data: { ...data } };
  }
}

/** OneBot11 消息段数组 -> OneBot12 消息段数组 */
export function convertEventMessage(message: unknown): OneBot12MessageSegment[] {
  if (!Array.isArray(message)) {
    return [];
  }
  return (message as AnyMessageSegment[]).map(convertEventSegment);
}

const convertSender = (sender: OneBotSender): OneBot12Sender => ({
  user_id: toText(sender.user_id),
  nickname: sender.nickname,
  name: sender.card || sender.nickname,
  ...(sender.card ? { card: sender.card } : {}),
  ...(sender.role ? { role: sender.role } : {}),
});

/** OneBot11 群消息事件 -> OneBot12 群消息事件 */
export function convertGroupMessageEvent(
  event: OneBotGroupMessageEvent,
  groupName?: string,
): OneBot12MessageEvent {
  return {
    id: toText(event.message_id),
    time: event.time,
    type: 'message',
    detail_type: 'group',
    sub_type: '',
    self: { platform: 'qq', user_id: toText(event.self_id) },
    message_id: toText(event.message_id),
    message: convertEventMessage(event.message),
    alt_message: outgoingToText(event.message as unknown as AnyMessageSegment[]),
    user_id: toText(event.user_id),
    group_id: toText(event.group_id),
    ...(groupName ? { group_name: groupName } : {}),
    sender: convertSender(event.sender),
  };
}

/** OneBot11 私聊消息事件 -> OneBot12 私聊消息事件 */
export function convertPrivateMessageEvent(
  event: OneBotPrivateMessageEvent,
): OneBot12MessageEvent {
  return {
    id: toText(event.message_id),
    time: event.time,
    type: 'message',
    detail_type: 'private',
    sub_type: '',
    self: { platform: 'qq', user_id: toText(event.self_id) },
    message_id: toText(event.message_id),
    message: convertEventMessage(event.message),
    alt_message: outgoingToText(event.message as unknown as AnyMessageSegment[]),
    user_id: toText(event.user_id),
    sender: convertSender(event.sender),
  };
}
