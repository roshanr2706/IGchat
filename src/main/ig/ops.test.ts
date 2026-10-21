import { describe, expect, it } from 'vitest';
import threadList from './__fixtures__/threadList.json';
import messageList from './__fixtures__/messageList.json';
import {
  editVars, extractEditResult, extractMessageListPage, extractReactions, extractSearchUsers, extractSendResult, extractThreadListPage, extractUnsendResult,
  generateOtid, messageListVars, OPS, reactVars, searchVars, sendTextVars, threadListVars, unsendVars
} from './ops';

describe('ops', () => {
  it('names the operations exactly', () => {
    expect(OPS).toEqual({
      threadList: 'IGDThreadListOffMsysPaginationQuery',
      messageList: 'IGDMessageListOffMsysQuery',
      sendText: 'IGDirectTextSendMutation',
      edit: 'IGDirectEditMessageMutation',
      unsend: 'IGDMessageUnsendDialogOffMsysMutation',
      react: 'IGDirectReactionSendMutation',
      search: 'IGDOmniPickerSearchResultsListQuery'
    });
  });

  it('builds variables in the captured shapes', () => {
    expect(threadListVars('900', 'cur')).toMatchObject({ count: 20, cursor: 'cur', folder: 'INBOX', id: '900' });
    expect(messageListVars('100', 'mid.$x')).toMatchObject({ id: '100', first: 20, older_than_message_id: 'mid.$x', after: null });
    expect(sendTextVars('100', 'hi', '7300000000000000001', 'mid.$r')).toMatchObject({ ig_thread_igid: '100', offline_threading_id: '7300000000000000001', text: { sensitive_string_value: 'hi' }, reply_to_message_id: 'mid.$r', mentions: [], mentioned_user_ids: [] });
    expect(editVars('100', 'mid.$m', 'new', '7')).toEqual({ thread_id: '100', target_item_id: null, body: { sensitive_string_value: 'new' }, offline_threading_id: '7', target_message_id: 'mid.$m' });
    expect(unsendVars('mid.$m', '3402')).toEqual({ message_id: 'mid.$m', send_data: { thread_id: '3402' } });
    expect(reactVars('100', 'mid.$m', 'item-1', '🔥', false)).toEqual({ input: { emoji: '🔥', item_id: 'item-1', message_id: 'mid.$m', reaction_status: 'created', thread_id: '100' } });
    expect(reactVars('100', 'mid.$m', 'item-1', '', true).input.reaction_status).toBe('deleted');
  });

  it('extracts pages and results', () => {
    const tl = extractThreadListPage(threadList.data);
    expect(tl.nodes).toHaveLength(2);
    expect(tl).toMatchObject({ endCursor: 't2', hasMore: true });
    const ml = extractMessageListPage(messageList.data);
    expect(ml.nodes).toHaveLength(12);
    expect(ml.hasOlder).toBe(true);
    expect(extractSendResult({ xig_direct_text_send_with_slide_messaging_response: { message_id: 'mid.$n', timestamp_ms: '1792100000001' } })).toEqual({ messageId: 'mid.$n', timestampMs: 1792100000001 });
    expect(extractEditResult({ direct_edit_message_with_slide_messaging_response: { message_id: 'mid.$n', timestamp_ms: '5' } })).toEqual({ messageId: 'mid.$n', timestampMs: 5 });
    expect(extractUnsendResult({ direct_unsend_message: true })).toBe(true);
    expect(extractReactions({ xig_direct_reaction_send_with_slide_messaging_response: { slide_message: { reactions: [{ reaction: '🔥' }] } } })).toEqual([{ reaction: '🔥' }]);
    expect(extractSendResult({})).toBeNull();
    expect(extractThreadListPage(null)).toEqual({ nodes: [], endCursor: null, hasMore: false });
  });

  it('generates 19-digit offline threading ids', () => {
    expect(generateOtid(1792100000000, () => 0.123456)).toBe('1792100000000123456');
    expect(generateOtid()).toMatch(/^\d{19}$/);
  });
  it('builds and reads the people search', () => {
    expect(OPS.search).toBe('IGDOmniPickerSearchResultsListQuery');
    expect(searchVars('alex')).toEqual({ search_text: 'alex' });
    expect(extractSearchUsers({ xfb_combinedIGSearchQuery: { search_messenger_contact_v2: [{ pk: '1', username: 'a' }, { pk: '2', username: 'b' }] } })).toHaveLength(2);
    expect(extractSearchUsers(null)).toEqual([]);
  });

  it('collects people from every result list, including wrapped users, once each', () => {
    const data = {
      xfb_combinedIGSearchQuery: {
        search_messenger_contact_v2: [{ pk: '1', username: 'a' }],
        search_ig_users: { edges: [{ node: { user: { pk: '2', username: 'b' } } }, { node: { pk: '1', username: 'a' } }] },
        other: [{ title: 'not a person' }]
      }
    };
    expect((extractSearchUsers(data) as { pk: string }[]).map((u) => u.pk)).toEqual(['1', '2']);
  });

  it("copies the page's own search variables, replacing only the text", () => {
    expect(searchVars('alex', { search_text: 'old', num_results: 20, surface: 'omnipicker' })).toEqual({ search_text: 'alex', num_results: 20, surface: 'omnipicker' });
    expect(searchVars('alex', { query: 'old', count: 5 })).toEqual({ query: 'alex', count: 5 });
  });
});
