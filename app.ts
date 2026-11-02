import {
  type AnyMessageSegment,
  type ForwardMessageParams,
  type JsonArray,
  type JsonObject,
  SnowLumaWebSocketClient
} from '@snowluma/sdk';
import {Workspace} from '@xopenbot/plugin';
import YunzaiPlugin from './plugins/yunzai-xbot-plugin/xopenbot.js';
import type {Forwardable, Sendable, MessageRet} from "./src/message-part.js";
import {convertSegment, outgoingToText, toOutgoingMessage} from "./src/message-convert.js";
import * as fs from "node:fs";

const bot = new SnowLumaWebSocketClient({
  url: 'ws://127.0.0.1:3001',
  accessToken: 'vAonhNthREIkgo6TXD5fGMJa71xvd9RiDmV-DCsF8Ac',
  reconnect: true
});

process.on("SIGHUP", () => process.exit())

/** 捕获未处理的错误 */
process.on("uncaughtException", error => {
  console.log(error)
})

/** 捕获未处理的Promise错误 */
process.on("unhandledRejection", (error, promise) => {
  console.log(error)
})

/** 判断内容是否已经是发送结果（MessageRet）。合并转发走一步式发送时会直接返回此结构。 */
const isSentResult = (content: Sendable): boolean => {
  if (typeof content === 'string' || Array.isArray(content)) {
    return false;
  }
  const obj = content as { message_id?: unknown; type?: unknown };
  return typeof obj.message_id === 'string' && obj.type === undefined;
}

const outgoingWithQuote = (content: Sendable, quoteMsg?: number) => {
  const message = toOutgoingMessage(content);
  return quoteMsg ? [
    {type: 'reply' as const, data: {id: String(quoteMsg)}},
    ...(typeof message === 'string'
        ? (message ? [{type: 'text' as const, data: {text: message}}] : [])
        : message),
  ] : message;
}

const makeForwardMsg = async (forwardMsg: Forwardable[], user_id?: number, group_id?: number) => {
  const nodes = forwardMsg.map(node => {
    // 部分调用方（如 ImgUpload.profileImgList）只给 message，缺省时用机器人自身身份补全
    const uid = node.user_id ?? botInfo.user_id;
    return {
      type: 'node' as const,
      data: {
        user_id: uid,
        nickname: node.nickname ?? botInfo.nickname ?? String(uid),
        content: toOutgoingMessage(node.message),
      },
    };
  });
  // 转发卡片预览：每条消息生成一行「昵称: 文本」，非文本段用类型占位
  const preview = nodes.slice(0, 3).flatMap(node => {
    const text = outgoingToText(node.data.content).trim();
    return text ? [`${node.data.nickname}: ${text}`] : [];
  });
  const previewParams = preview.length
      ? {summary: `查看${nodes.length}条消息`, news: preview.map(text => ({text}))}
      : {};

  // SnowLuma 的私有转发需要目标 uid，两步式 upload_forward_msg 在私有场景会报
  // 「private image target uid is missing」，因此有目标时改用一步式 send_forward_msg 直接发送。
  if (group_id !== undefined || user_id !== undefined) {
    const res = await bot.sendForwardMessage({
      message_type: group_id !== undefined ? 'group' : 'private',
      user_id: user_id,
      group_id: group_id,
      messages: nodes,
      ...previewParams,
    } as unknown as ForwardMessageParams);
    return {message_id: String(res.message_id), seq: 0, rand: 0, time: 0};
  }

  // 无目标时（如 Workspace 的 Bot.makeForwardMsg 兜底）退回两步式上传
  const res = await bot.uploadForwardMessage({
    messages: nodes,
    ...previewParams,
  } as unknown as ForwardMessageParams);
  const id = res.res_id || res.forward_id || String(res.message_id);
  return {type: 'forward' as const, id};
}
const recallMsg = (messageId: number) => {
  return bot.deleteMessage(messageId)
}
/** 取消息段中能唯一标识该类型的字段，按 {type:value} 拼接 */
const msgToString = (message: AnyMessageSegment[]) => {
  const pick = (data: Record<string, unknown>, ...keys: string[]) => {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === 'string' && value.length > 0) return value.slice(0, 32);
      if (typeof value === 'number') return String(value).slice(0, 32);
    }
    return '';
  };

  return message.map(msg => {
    // 各段的 data 结构不同，这里统一按 Record 读取
    const data = msg.data as Record<string, unknown>;
    switch (msg.type) {
      case 'text':
        return msg.data.text;
      case 'at':
        return `{at:${pick(data, 'qq', 'uid')}}`;
      case 'face':
        return `{face:${pick(data, 'id')}}`;
      case 'reply':
        return `{reply:${pick(data, 'id')}}`;
      case 'image':
        return `{image:${pick(data, 'file')}}`;
      case 'record':
        return `{record:${pick(data, 'file')}}`;
      case 'video':
        return `{video:${pick(data, 'file')}}`;
      case 'json':
        return msg.data.data;
      case 'xml':
        return msg.data.data;
      case 'poke':
        return `{poke:${pick(data, 'id', 'type')}}`;
      case 'forward':
        return `{forward:${pick(data, 'id', 'res_id', 'forward_id')}}`;
      case 'node':
        // 节点本身没有 id，用发送者 QQ 标识
        return `{node:${pick(data, 'user_id')}}`;
      case 'share':
        return `{share:${pick(data, 'url')}}`;
      case 'music':
        return `{music:${pick(data, 'id', 'url', 'audio')}}`;
      case 'location':
        return `{location:${pick(data, 'lat')},${pick(data, 'lon')}}`;
      case 'contact':
        return `{contact:${pick(data, 'id')}}`;
      default:
        // 未知类型退化为第一个可用的标量字段，保证仍有值可区分
        return `{${msg.type}:${pick(data, ...Object.keys(data))}}`;
    }
  }).join('');
}

bot.onGroupMessage(async event => {
  if (!gml.has(event.group_id)) {
    const members = await bot.getGroupMemberList(event.group_id);
    gml.set(event.group_id, new Map(members.map(m => [m.user_id as number, m])))
  }
  const member = gml.get(event.group_id)!.get(event.user_id);
  // @ts-ignore
  const atme = (event.message as JsonArray).some(item => item!.type === 'at' && item!.data.qq == botInfo.user_id)
  // @ts-ignore
  const atall = (event.message as JsonArray).some(item => item!.type === 'at' && item!.data.qq == 'all')
  // @ts-ignore
  const source = (event.message as JsonArray).find(item => item!.type === 'reply')
  // @ts-ignore
  const oicqSource = source ? {user_id: source.user_id, seq: source.message_id} : undefined;
  plugins.process(event.raw_message, {
    /**
     * 快速回复
     * @param content
     * @param quote 引用这条消息(默认false)
     */
    async reply(content: Sendable, quote?: boolean): Promise<MessageRet> {
      // 合并转发一步式发送时内容已经是 MessageRet，直接透传，避免被当成普通消息重发
      if (isSentResult(content)) {
        return content as unknown as MessageRet;
      }
      // sendGroupMessage 返回 SendMessageResult，这里补成插件约定的 MessageRet（SDK 只提供 message_id）
      const res = await bot.sendGroupMessage(event.group_id, outgoingWithQuote(content, quote ? event.message_id : undefined));
      return ({message_id: String(res.message_id), seq: 0, rand: 0, time: 0});
    },
    /** 群对象 */
    group: {
      makeForwardMsg: (forwardMsg: Forwardable[]) => {
        return makeForwardMsg(forwardMsg, undefined, event.group_id)
      },
      pickMember: (uid: number) => {
        return {
          info: gml.get(event.group_id)!.get(uid)
        }
      },
      recallMsg,
      sendMsg: (msg: string) => {
        return bot.sendGroupMessage(event.group_id, msg);
      },
      sendFile: (filePath: string) => {
        return bot.sendGroupFile(event.group_id, fs.createReadStream(filePath));
      },
      getFileUrl: (fid: string) => {
        return bot.getGroupFileUrl(event.group_id, fid);
      },
      getChatHistory: async (seq: number, cnt: number) => {
        return bot.getGroupMessageHistory({
          group_id: event.group_id,
          message_id: seq,
          count: cnt,
        })
      }
    },
    /** 发送者群员对象 */
    member: {
      is_owner: member?.role === 'owner',
      is_admin: member?.role === 'admin',
      ...member
    },
    message_type: "group",
    /** anonymous:匿名 normal:通常  */
    sub_type: event.anonymous ? "anonymous" : "normal",
    group_id: event.group_id,
    group_name: gl.get(event.group_id)?.group_name,
    anonymous: event.anonymous,
    atme: atme,
    atall: atall,
    isMaster: event.user_id === 3530766280,
    sender: event.sender,
    user_id: event.user_id,
    nickname: event.sender.card || event.sender.nickname,
    post_type: "message",
    /** 消息时间 */
    time: event.time,
    /** 消息元素数组 */
    message: (event.message as unknown as AnyMessageSegment[]).map(convertSegment),
    /** 字符串形式的消息 */
    raw_message: event.raw_message,
    /** @cqhttp cqhttp方法用 */
    message_id: event.message_id,
    /** 引用回复 */
    source: oicqSource,
    seq: event.message_seq,
    toString: () => msgToString(event.message as unknown as AnyMessageSegment[])
  }).catch(error => {
    console.error('[bot] Workspace.process 处理失败', error);
  });
});

bot.onPrivateMessage(event => {
  // @ts-ignore
  const source = (event.message as JsonArray).find(item => item!.type === 'reply')
  // @ts-ignore
  const oicqSource = source ? {user_id: source.user_id, seq: source.message_id} : undefined;
  plugins.process(event.raw_message, {
    /**
     * 快速回复
     * @param content
     * @param quote 引用这条消息(默认false)
     */
    async reply(content: Sendable, quote?: boolean): Promise<MessageRet> {
      // 合并转发一步式发送时内容已经是 MessageRet，直接透传，避免被当成普通消息重发
      if (isSentResult(content)) {
        return content as unknown as MessageRet;
      }
      // sendGroupMessage 返回 SendMessageResult，这里补成插件约定的 MessageRet（SDK 只提供 message_id）
      const res = await bot.sendPrivateMessage(event.user_id, outgoingWithQuote(content, quote ? event.message_id : undefined));
      return ({message_id: String(res.message_id), seq: 0, rand: 0, time: 0});
    },
    /** 好友对象 */
    friend: {
      makeForwardMsg: (forwardMsg: Forwardable[]) => {
        return makeForwardMsg(forwardMsg, event.user_id, undefined)
      },
      recallMsg,
      sendFile: (filePath: string) => {
        return bot.sendPrivateFile(event.user_id, fs.createReadStream(filePath));
      },
      getFileUrl: (fid: string) => {
        return bot.getPrivateFileUrl(event.user_id, fid, fid);
      },
      getChatHistory: async (seq: number, cnt: number) => {
        return bot.getFriendMessageHistory({
          user_id: event.user_id,
          message_id: seq,
          count: cnt
        })
      }
    },
    isMaster: event.user_id === 3530766280,
    message_type: "private",
    /** friend:好友 group:群临时会话 self:我的设备 other:其他途径的临时会话 */
    sub_type: "friend",
    from_id: event.sender.user_id,
    to_id: botInfo.user_id,
    auto_reply: false,
    sender: event.sender,
    /**
     * 该值永远指向消息发送者。
     * 对于私聊消息，请使用`from_id`和`to_id`来确定发送者和接收者。
     * 建议使用 `sender.user_id`
     * @deprecated 未来会改为访问器，仅供内部转发消息时使用。
     */
    user_id: event.user_id,
    /** 仅供内部转发消息时使用 */
    nickname: event.sender.card || event.sender.nickname,
    post_type: "message",
    /** 消息时间 */
    time: event.time,
    /** 消息元素数组 */
    message: (event.message as unknown as AnyMessageSegment[]).map(convertSegment),
    /** 字符串形式的消息 */
    raw_message: event.raw_message,
    font: event.font,
    /** @cqhttp cqhttp方法用 */
    message_id: event.message_id,
    /** 消息编号，在群消息中是唯一的 (私聊消息建议至少使用time,seq,rand中的两个判断唯一性) */
    seq: event.message_seq,
    /** 引用回复 */
    source: oicqSource,
    toString: () => msgToString(event.message as unknown as AnyMessageSegment[])
  }).catch(error => {
    console.error('[bot] Workspace.process 处理失败', error);
  });
});

await bot.connect();

const botInfo = await bot.getLoginInfo()
const flist = await bot.getFriendList();
const glist = await bot.getGroupList();

const fl = new Map(flist.map(item => [item.user_id, item]))
const gl = new Map(glist.map(item => [item.group_id, item]))
const gml = new Map<number, Map<number, JsonObject>>();

const plugins = new Workspace({
  uin: botInfo.user_id,
  fl: fl,
  gml: gml,
  nickname: botInfo.nickname,
  logger: (globalThis as unknown as { logger: unknown }).logger,
  makeForwardMsg: async (forwardMsg: Forwardable[]) => {
    return makeForwardMsg(forwardMsg)
  },
  getForwardMsg: async (resid: string) => {
    const {messages} = await bot.getForwardMessage({id: resid});
    return messages.map(item => convertSegment(item as unknown as AnyMessageSegment))
  },
  pickUser: (uin: number) => {
    return {
      sendMsg: (msg: string) => {
        return bot.sendPrivateMessage(uin, msg)
      }
    }
  },
  pickGroup: (gid: number) => {
    if (!gl.has(gid)) {
      return null;
    }
    return {
      sendMsg: (msg: string) => {
        return bot.sendGroupMessage(gid, msg)
      }
    }
  },
  getGroupMemberInfo: (gid: number, uid: number) => {
    return bot.getGroupMemberInfo(gid, uid)
  }
});

await plugins.registry(YunzaiPlugin);