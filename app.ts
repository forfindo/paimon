import { SnowLumaWebSocketClient } from '@snowluma/sdk';
import type { AnyMessageSegment } from '@snowluma/sdk';
import { Workspace } from '@xopenbot/plugin';
import YunzaiPlugin from './plugins/yunzai-xbot-plugin/xopenbot.js';
import { buildMessageSegments } from './src/host.js';
import type { HostPart } from './src/host.js';

const selfId = 3629157064;

const bot = new SnowLumaWebSocketClient({
  url: 'ws://127.0.0.1:3001',
  accessToken: 'vAonhNthREIkgo6TXD5fGMJa71xvd9RiDmV-DCsF8Ac',
  reconnect: true
});

const plugins = new Workspace();

plugins.registry(YunzaiPlugin);

bot.onGroupMessage(event => {
  const sender = event.sender ?? { user_id: event.user_id };
  const userId = sender.user_id ?? event.user_id;
  plugins.process(event.raw_message, {
    selfId: String(selfId),
    groupId: String(event.group_id),
    isMaster: userId === 3530766280,
    isAdmin: userId === 3530766280,
    sender,
    member: {
      isAdmin: sender.role === 'admin'
    },
    messageId: event.message_id, // 当前消息 ID
    elements: [
      {
        type: 'text',
        text: event.raw_message
      }
    ],
    type: 'message',
    host: {
      getHistory(messageId: string) {
        void messageId;
        throw new Error('unimplement');
      },
      getForward(resId: string) {
        void resId;
        throw new Error('unimplement');
      },
      getMemberMap() {
        throw new Error('unimplement');
      },
      getMember(userId: string) {
        void userId;
        throw new Error('unimplement');
      },
      send(parts: HostPart[]) {
        const segments = buildMessageSegments(parts, selfId);
        if (segments.length === 0) {
          console.warn('[bot] 消息内容为空，已跳过发送', parts);
          return Promise.resolve();
        }
        return bot.sendGroupMessage(event.group_id, segments as AnyMessageSegment[]);
      }
    }
  })
    .then(() => {})
    .catch(error => {
      console.error('[bot] Workspace.process 处理失败', error);
    });
});

bot.onPrivateMessage(event => {
  const sender = event.sender ?? { user_id: event.user_id };
  const userId = sender.user_id ?? event.user_id;
  plugins.process(event.raw_message, {
    selfId: String(selfId),
    userId: String(userId),
    isMaster: userId === 3530766280,
    isAdmin: userId === 3530766280,
    sender,
    member: {
      isAdmin: sender.role === 'admin'
    },
    messageId: event.message_id, // 当前消息 ID
    elements: [
      {
        type: 'text',
        text: event.raw_message
      }
    ],
    type: 'message',
    host: {
      getHistory(messageId: string) {
        void messageId;
        throw new Error('unimplement');
      },
      getForward(resId: string) {
        void resId;
        throw new Error('unimplement');
      },
      getMemberMap() {
        throw new Error('unimplement');
      },
      getMember(userId: string) {
        void userId;
        throw new Error('unimplement');
      },
      send(parts: HostPart[]) {
        const segments = buildMessageSegments(parts, selfId);
        if (segments.length === 0) {
          console.warn('[bot] 消息内容为空，已跳过发送', parts);
          return Promise.resolve();
        }
        return bot.sendPrivateMessage(event.user_id, segments as AnyMessageSegment[]);
      }
    }
  })
    .then(() => {})
    .catch(error => {
      console.error('[bot] Workspace.process 处理失败', error);
    });
});
await bot.connect();
