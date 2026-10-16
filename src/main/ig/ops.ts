export const OPS = {
  threadList: 'IGDThreadListOffMsysPaginationQuery',
  messageList: 'IGDMessageListOffMsysQuery',
  sendText: 'IGDirectTextSendMutation',
  edit: 'IGDirectEditMessageMutation',
  unsend: 'IGDMessageUnsendDialogOffMsysMutation',
  react: 'IGDirectReactionSendMutation'
} as const;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function threadListVars(viewerFbid: string, cursor: string | null, count = 20) {
  return {
    count,
    cursor,
    folder: 'INBOX',
    newer_than_timestamp_ms: null,
    id: viewerFbid,
    __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
    __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 99,
    __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: true
  };
}

export function messageListVars(threadIgid: string, olderThanMessageId: string | null, first = 20) {
  return {
    after: null,
    before: null,
    first,
    last: null,
    newer_than_message_id: null,
    older_than_message_id: olderThanMessageId,
    id: threadIgid,
    __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: first
  };
}

export function sendTextVars(threadIgid: string, text: string, otid: string, replyToMessageId: string | null) {
  return {
    ig_thread_igid: threadIgid,
    offline_threading_id: otid,
    recipient_igids: null,
    replied_to_client_context: null,
    replied_to_item_id: null,
    reply_to_message_id: replyToMessageId,
    sampled: null,
    text: { sensitive_string_value: text },
    mentions: [],
    mentioned_user_ids: [],
    commands: null,
    forwarded_from_thread_id: null,
    is_forwarded_from_own_message: null,
    send_attribution: 'direct_thread'
  };
}

export function editVars(threadIgid: string, messageId: string, text: string, otid: string) {
  return { thread_id: threadIgid, target_item_id: null, body: { sensitive_string_value: text }, offline_threading_id: otid, target_message_id: messageId };
}

export function unsendVars(messageId: string, threadKey: string) {
  return { message_id: messageId, send_data: { thread_id: threadKey } };
}

export function reactVars(threadIgid: string, messageId: string, itemId: string, emoji: string, remove: boolean) {
  return { input: { emoji, item_id: itemId, message_id: messageId, reaction_status: remove ? 'deleted' : 'created', thread_id: threadIgid } };
}

export function extractThreadListPage(data: unknown): { nodes: unknown[]; endCursor: string | null; hasMore: boolean } {
  const conn = obj(obj(obj(data)?.fetch__SlideMailbox)?.threads_by_folder);
  const pageInfo = obj(conn?.page_info);
  return {
    nodes: arr(conn?.edges).map((e) => obj(obj(e)?.node)?.as_ig_direct_thread).filter((n) => n !== undefined),
    endCursor: typeof pageInfo?.end_cursor === 'string' ? pageInfo.end_cursor : null,
    hasMore: pageInfo?.has_next_page === true
  };
}

export function extractMessageListPage(data: unknown): { nodes: unknown[]; hasOlder: boolean } {
  const conn = obj(obj(obj(obj(data)?.fetch__SlideThread)?.as_ig_direct_thread)?.slide_messages);
  return {
    nodes: arr(conn?.edges).map((e) => obj(e)?.node).filter((n) => n !== undefined),
    hasOlder: obj(conn?.page_info)?.has_next_page === true
  };
}

function idAndTime(v: unknown): { messageId: string; timestampMs: number } | null {
  const r = obj(v);
  if (!r || typeof r.message_id !== 'string') return null;
  return { messageId: r.message_id, timestampMs: Number(r.timestamp_ms) || Date.now() };
}

export const extractSendResult = (data: unknown) => idAndTime(obj(data)?.xig_direct_text_send_with_slide_messaging_response);
export const extractEditResult = (data: unknown) => idAndTime(obj(data)?.direct_edit_message_with_slide_messaging_response);
export const extractUnsendResult = (data: unknown): boolean => obj(data)?.direct_unsend_message === true;

export function extractReactions(data: unknown): unknown[] | null {
  const msg = obj(obj(obj(data)?.xig_direct_reaction_send_with_slide_messaging_response)?.slide_message);
  return msg && Array.isArray(msg.reactions) ? msg.reactions : null;
}

/** 19-digit client id Instagram uses to match a send with its echo (13-digit ms time + 6 random digits). */
export function generateOtid(now: number = Date.now(), rand: () => number = Math.random): string {
  return `${Math.floor(now)}${String(Math.floor(rand() * 1_000_000)).padStart(6, '0')}`.slice(0, 19).padEnd(19, '0');
}
