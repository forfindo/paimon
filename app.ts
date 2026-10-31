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
  const preview = nodes.flatMap(node => {
    const text = outgoingToText(node.data.content).trim();
    return text ? [`${node.data.nickname}: ${text}`] : [];
  });
  const res = await bot.uploadForwardMessage({
    messages: nodes,
    user_id: user_id,
    group_id: group_id,
    ...(preview.length
        ? {
          summary: preview.join('\n'),
          news: preview.map(text => ({text})),
        }
        : {}),
  } as unknown as ForwardMessageParams);
  const id = res.res_id || res.forward_id || String(res.message_id);
  return {type: 'forward' as const, id};
}
const recallMsg = (messageId: number) => {
  return bot.deleteMessage(messageId)
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
      const message = toOutgoingMessage(content);
      const outgoing = quote
          ? [
            {type: 'reply' as const, data: {id: String(event.message_id)}},
            ...(typeof message === 'string'
                ? (message ? [{type: 'text' as const, data: {text: message}}] : [])
                : message),
          ]
          : message;
      // sendGroupMessage 返回 SendMessageResult，这里补成插件约定的 MessageRet（SDK 只提供 message_id）
      const res = await bot.sendGroupMessage(event.group_id, outgoing);
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
    seq: event.message_seq
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
      const message = toOutgoingMessage(content);
      const outgoing = quote
          ? [
            {type: 'reply' as const, data: {id: String(event.message_id)}},
            ...(typeof message === 'string'
                ? (message ? [{type: 'text' as const, data: {text: message}}] : [])
                : message),
          ]
          : message;
      // sendGroupMessage 返回 SendMessageResult，这里补成插件约定的 MessageRet（SDK 只提供 message_id）
      const res = await bot.sendPrivateMessage(event.user_id, outgoing);
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
    source: oicqSource
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