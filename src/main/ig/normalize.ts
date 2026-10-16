import type { Message, MessageBody, Reaction, ReplyRef, Thread, User } from '../../shared/types';
import { toMediaUrl } from '../media/url';

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : undefined);
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};
const isPresent = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

export type NormalizedUser = { user: User; fbid: string };
export type NormalizedThread = {
  thread: Thread;
  fbid: string;
  /** The 39-digit thread id; required by unsend. */
  threadKey: string;
  users: NormalizedUser[];
  viewerFbid: string | null;
  /** Timestamp (ms) up to which the viewer has read this thread; 0 when unknown. */
  viewerWatermark: number;
};
export type MessageContext = {
  threadId: string;
  viewerIgid: string;
  viewerFbid: string | null;
  igidForFbid: (fbid: string) => string | undefined;
};
export type NormalizedMessage = { message: Message; itemId: string; otid: string | null; threadFbid: string | null };

export function normalizeUser(raw: unknown): NormalizedUser | null {
  const r = obj(raw);
  const id = str(r?.id) ?? str(r?.pk);
  if (!r || !id) return null;
  return {
    user: {
      id,
      username: str(r.username) ?? '',
      fullName: str(r.full_name) ?? '',
      avatarUrl: toMediaUrl(str(r.profile_pic_url)),
      verified: r.is_verified === true
    },
    fbid: str(r.interop_messaging_user_fbid) ?? ''
  };
}

function messageNodes(r: Raw): Raw[] {
  return arr(obj(r.slide_messages)?.edges)
    .map((e) => obj(obj(e)?.node))
    .filter(isPresent);
}

export function normalizeThread(raw: unknown, viewerIgid: string | null): NormalizedThread | null {
  const r = obj(raw);
  const id = str(r?.id);
  if (!r || !id) return null;
  const viewer = obj(r.viewer);
  const vIgid = viewerIgid ?? str(viewer?.id) ?? str(r.viewer_id) ?? null;
  const viewerFbid = str(viewer?.interop_messaging_user_fbid) ?? null;
  const users = arr(r.users)
    .map(normalizeUser)
    .filter(isPresent)
    .filter((u) => u.user.id !== vIgid);
  const participants = users.map((u) => u.user);

  const last = messageNodes(r).reduce<Raw | undefined>((a, n) => (!a || num(n.timestamp_ms) > num(a.timestamp_ms) ? n : a), undefined);
  const lastFromViewer = Boolean(last && viewerFbid && str(last.sender_fbid) === viewerFbid);
  const snippet = last ? (str(last.igd_snippet) ?? str(last.text_body) ?? str(obj(last.content)?.text_body) ?? '') : '';
  const receipt = viewerFbid
    ? arr(r.slide_read_receipts)
        .map(obj)
        .find((x) => str(x?.participant_fbid) === viewerFbid)
    : undefined;
  const viewerWatermark = num(receipt?.watermark_timestamp_ms);
  const unreadByReceipt = Boolean(receipt && last && !lastFromViewer && num(last.timestamp_ms) > viewerWatermark);

  const imageUrl = toMediaUrl(str(r.thread_image_url));
  return {
    thread: {
      id,
      title: str(r.thread_title) ?? (participants.map((p) => p.fullName || p.username).join(', ') || 'Conversation'),
      isGroup: r.is_group === true,
      participants,
      adminIds: arr(r.admin_user_ids).map(str).filter(isPresent),
      lastActivityAt: num(r.last_activity_timestamp_ms) || (last ? num(last.timestamp_ms) : 0),
      lastMessagePreview: lastFromViewer && snippet && !snippet.startsWith('You') ? `You: ${snippet}` : snippet,
      unread: r.marked_as_unread === true || unreadByReceipt,
      muted: r.is_muted === true,
      avatarUrls: imageUrl ? [imageUrl] : participants.map((p) => p.avatarUrl).filter(Boolean).slice(0, 2)
    },
    fbid: str(r.thread_fbid) ?? id,
    threadKey: str(r.thread_id) ?? '',
    users,
    viewerFbid,
    viewerWatermark
  };
}

function senderIgid(fbid: string | undefined, ctx: MessageContext, fallback?: string): string {
  if (fbid && ctx.viewerFbid && fbid === ctx.viewerFbid) return ctx.viewerIgid;
  return (fbid ? ctx.igidForFbid(fbid) : undefined) ?? fallback ?? fbid ?? 'unknown';
}

export function normalizeReactions(raws: unknown[], ctx: MessageContext): Reaction[] {
  const byEmoji = new Map<string, string[]>();
  for (const raw of raws) {
    const r = obj(raw);
    const emoji = str(r?.reaction) ?? str(r?.emoji);
    if (!r || !emoji) continue;
    const who = senderIgid(str(r.sender_fbid), ctx, str(r.sender_igid));
    const list = byEmoji.get(emoji) ?? [];
    if (!list.includes(who)) list.push(who);
    byEmoji.set(emoji, list);
  }
  return [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds }));
}

type Attachment = { url?: string; preview?: string; w: number; h: number };

function firstAttachment(content: Raw): Attachment | null {
  const a = obj(arr(content.attachments)[0]) ?? obj(content.attachment) ?? obj(arr(content.animated_media)[0]);
  if (!a) return null;
  return {
    url: str(a.attachment_cdn_url) ?? str(a.cdn_url) ?? str(a.url),
    preview: str(a.preview_cdn_url) ?? str(a.preview_url),
    w: num(a.preview_width ?? a.width),
    h: num(a.preview_height ?? a.height)
  };
}

function xmaBody(xma: Raw, xmaText: string | undefined): MessageBody {
  const target = str(xma.target_url) ?? '';
  const thumbUrl = toMediaUrl(str(obj(xma.preview_image)?.url));
  const author = str(xma.header_title_text);
  const caption = str(xma.caption_body_text) ?? xmaText;
  const extras = { ...(caption ? { caption } : {}), ...(author ? { author } : {}) };
  if (/^https:\/\/(www\.)?instagram\.com\/reels?\//i.test(target)) return { kind: 'reel', postUrl: target, thumbUrl, ...extras };
  if (/^https:\/\/(www\.)?instagram\.com\/(p|tv)\//i.test(target)) return { kind: 'sharedPost', postUrl: target, thumbUrl, ...extras };
  if (/^https:\/\//i.test(target)) {
    const title = str(xma.title_text) ?? author;
    return { kind: 'link', text: xmaText ?? '', url: target, ...(title ? { title } : {}), ...(thumbUrl ? { thumbUrl } : {}) };
  }
  return { kind: 'unsupported', rawType: str(xma.__typename) ?? 'xma' };
}

function adminText(content: Raw, r: Raw): string {
  const fragments = arr(content.text_fragments)
    .map((f) => str(obj(f)?.text))
    .filter(isPresent)
    .join('');
  return fragments || str(r.text_body) || str(r.igd_snippet) || 'Conversation updated';
}

function messageBody(r: Raw): MessageBody | null {
  const content = obj(r.content) ?? {};
  const type = str(r.content_type) ?? '';
  const typename = str(content.__typename) ?? '';

  if (typename === 'SlideMessageAdminText') {
    if (content.is_reaction_action_log === true || type === 'REACTION_LOG_XMAT') return null;
    return { kind: 'actionLog', text: adminText(content, r) };
  }
  if (type === 'RAVEN_IMAGE' || typename === 'SlideMessageRavenImageContent') return { kind: 'unsupported', rawType: 'view_once' };
  if (typename === 'SlideMessageText' || type === 'TEXT') {
    const text = str(content.text_body) ?? str(r.text_body);
    return text ? { kind: 'text', text } : null;
  }
  if (typename === 'SlideMessageVideosContent' || type === 'VIDEOS') {
    const a = firstAttachment(content);
    const url = toMediaUrl(a?.url);
    if (a && url) return { kind: 'video', url, thumbUrl: toMediaUrl(a.preview), width: a.w, height: a.h };
  }
  if (typename === 'SlideMessageCutoutStickerXMAContent') {
    const url = toMediaUrl(str(content.preview_url));
    if (url) return { kind: 'image', url, width: num(content.preview_width), height: num(content.preview_height) };
  }
  if (/Image|AnimatedMedia|MultiMedia/.test(typename) || ['IMAGES', 'MULTI_MEDIA', 'INSTAGRAM_MESSAGING_ANIMATED_IMAGE'].includes(type)) {
    const a = firstAttachment(content);
    const url = toMediaUrl(a?.url) || toMediaUrl(a?.preview);
    if (a && url) return { kind: 'image', url, width: a.w, height: a.h };
  }
  const xma = obj(content.xma);
  if (xma) return xmaBody(xma, str(content.xma_text_body));
  return { kind: 'unsupported', rawType: type || typename || 'unknown' };
}

export function normalizeMessage(raw: unknown, ctx: MessageContext): NormalizedMessage | null {
  const r = obj(raw);
  if (!r || r.tombstone_reason) return null;
  const id = str(r.message_id) ?? str(r.id);
  if (!id) return null;
  const body = messageBody(r);
  if (!body) return null;

  const sender = obj(r.sender);
  const replied = obj(r.replied_to_message);
  const repliedId = str(replied?.message_id);
  const replyTo: ReplyRef | undefined =
    replied && repliedId
      ? {
          messageId: repliedId,
          senderId: senderIgid(str(replied.sender_fbid), ctx),
          preview: str(replied.text_body) ?? str(obj(replied.content)?.xma_text_body) ?? 'Message'
        }
      : undefined;
  const edits = arr(r.slide_edit_history).map(obj).filter(isPresent);
  const editedAt = edits.length ? Math.max(...edits.map((e) => num(e.timestamp_ms))) : 0;

  const message = {
    id,
    threadId: ctx.threadId,
    senderId: senderIgid(str(r.sender_fbid), ctx, str(sender?.igid)),
    timestamp: num(r.timestamp_ms),
    reactions: normalizeReactions(arr(r.reactions), ctx),
    status: 'sent',
    ...(replyTo ? { replyTo } : {}),
    ...(editedAt ? { editedAt } : {}),
    ...body
  } as Message;
  return { message, itemId: str(r.id) ?? id, otid: str(r.offline_threading_id) ?? null, threadFbid: str(r.thread_fbid) ?? null };
}
