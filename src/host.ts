import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  path?: string;
  content?: string;
}

export interface AtPart {
  type: 'at';
  userId: number | string;
  name?: string;
}

export interface ButtonPart {
  type: 'button';
  rows: Array<Array<{ text?: string } | null | undefined>>;
}

export interface ForwardNode {
  title?: string;
  userId?: number | string;
  nickname?: string;
  elements: InputPart[];
}

export interface ForwardPart {
  type: 'forward';
  title?: string;
  nodes: ForwardNode[];
}

export type HostPart = TextPart | ImagePart | AtPart | ButtonPart | ForwardPart;

export interface UnknownPart {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

export type InputPart = HostPart | UnknownPart;

export interface OutgoingSegment {
  type: string;
  data: Record<string, unknown>;
}

function normalizeId(value: unknown): number | null {
  if (value === null || value === '') {
    return null;
  }
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

function imageFile(path?: string, content?: string): string | null {
  if (content) {
    return `base64://${content}`;
  }
  if (!path) {
    return null;
  }
  if (/^(?:base64:\/\/|data:|https?:)/i.test(path)) {
    return path;
  }
  let file = path;
  if (file.startsWith('file://')) {
    try {
      file = fileURLToPath(file);
    } catch {
      file = file.replace(/^file:\/+/i, '');
    }
  }
  try {
    return `base64://${readFileSync(file).toString('base64')}`;
  } catch {
    return path;
  }
}

function appendForward(
  segments: OutgoingSegment[],
  part: Partial<ForwardPart>,
  selfId: number | null
): void {
  const nodes = part.nodes ?? [];
  for (const node of nodes) {
    if (!Array.isArray(node?.elements)) {
      continue;
    }
    const inner = buildMessageSegments(node.elements, selfId);
    if (inner.length === 0) {
      continue;
    }
    const userId = normalizeId(node.userId) ?? selfId;
    if (userId === null) {
      segments.push(...inner);
    } else {
      segments.push({
        type: 'node',
        data: {
          user_id: userId,
          nickname: node.nickname ?? node.title ?? part.title ?? '消息',
          content: inner
        }
      });
    }
  }
}

function appendPart(
  segments: OutgoingSegment[],
  part: InputPart,
  selfId: number | null
): void {
  if (!part || typeof part !== 'object') {
    return;
  }

  switch (part.type) {
    case 'text': {
      const { text } = part as Partial<TextPart>;
      if (typeof text === 'string' && text.length > 0) {
        segments.push({ type: 'text', data: { text } });
      }
      return;
    }
    case 'image': {
      const { path, content } = part as Partial<ImagePart>;
      const file = imageFile(path, content);
      if (file) {
        segments.push({ type: 'image', data: { file } });
      }
      return;
    }
    case 'at': {
      const { userId, name } = part as Partial<AtPart>;
      const id = normalizeId(userId);
      if (id === null) {
        if (name) {
          segments.push({ type: 'text', data: { text: `@${name}` } });
        }
      } else {
        segments.push({ type: 'at', data: { qq: String(id) } });
      }
      return;
    }
    case 'button': {
      const { rows } = part as Partial<ButtonPart>;
      const text = (rows ?? [])
        .flat()
        .map(row => row?.text)
        .filter((item): item is string => Boolean(item))
        .join(' ');
      if (text.length > 0) {
        segments.push({ type: 'text', data: { text } });
      }
      return;
    }
    case 'forward': {
      appendForward(segments, part as Partial<ForwardPart>, selfId);
      return;
    }
    default: {
      return;
    }
  }
}

export function buildMessageSegments(
  parts: readonly InputPart[],
  selfId?: number | string | null
): OutgoingSegment[] {
  const segments: OutgoingSegment[] = [];
  const fallbackUserId = normalizeId(selfId);
  for (const part of parts) {
    appendPart(segments, part, fallbackUserId);
  }
  return segments;
}
