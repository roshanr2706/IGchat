import { call } from './api';
import { inbox } from '../stores/inbox.svelte';
import { messages } from '../stores/messages.svelte';
import { ui } from '../stores/ui.svelte';

export function openThread(id: string): void {
  if (inbox.activeId === id) return;
  if (inbox.activeId) messages.leave(inbox.activeId);
  inbox.select(id);
  ui.replyTo = null;
  ui.editingId = null;
  void call('session:setActiveThread', id).catch(() => {});
  void messages.open(id);
}

export function stepThread(delta: 1 | -1): void {
  const id = inbox.step(delta);
  if (id) openThread(id);
}
