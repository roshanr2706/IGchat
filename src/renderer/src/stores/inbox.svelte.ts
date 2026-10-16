import type { SyncStatus, Thread, User } from '../../../shared/types';
import { call, on } from '../lib/api';

export function sortThreads(threads: Thread[]): Thread[] {
  return [...threads].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

class InboxStore {
  threads = $state<Thread[]>([]);
  hasMore = $state(false);
  loading = $state(false);
  activeId = $state<string | null>(null);
  me = $state<User | null>(null);
  syncStatus = $state<SyncStatus>('ok');
  active = $derived<Thread | null>(this.threads.find((t) => t.id === this.activeId) ?? null);

  byId(id: string): Thread | undefined {
    return this.threads.find((t) => t.id === id);
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const [me, page] = await Promise.all([call('session:me'), call('inbox:get')]);
      this.me = me;
      this.threads = sortThreads(page.items);
      this.hasMore = page.hasMore;
    } finally {
      this.loading = false;
    }
  }

  async loadMore(): Promise<void> {
    if (!this.hasMore || this.loading) return;
    this.loading = true;
    try {
      const page = await call('inbox:loadMore');
      this.applyUpdates(page.items);
      this.hasMore = page.hasMore;
    } finally {
      this.loading = false;
    }
  }

  applyUpdates(updated: Thread[]): void {
    const byId = new Map(this.threads.map((t) => [t.id, t]));
    for (const t of updated) {
      if (t.id === this.activeId && t.unread) {
        byId.set(t.id, { ...t, unread: false });
        void call('thread:markSeen', t.id).catch(() => {});
      } else {
        byId.set(t.id, t);
      }
    }
    this.threads = sortThreads([...byId.values()]);
  }

  select(id: string): void {
    this.activeId = id;
    const t = this.byId(id);
    if (t) t.unread = false;
  }

  /** Neighbour of the active thread in sidebar order, or null at the ends. With no active thread, the first one. */
  step(delta: 1 | -1): string | null {
    if (!this.activeId) return this.threads[0]?.id ?? null;
    const index = this.threads.findIndex((t) => t.id === this.activeId);
    return this.threads[index + delta]?.id ?? null;
  }

  subscribe(): () => void {
    const offs = [
      on('inbox:updated', (threads) => this.applyUpdates(threads)),
      on('sync:status', (status) => {
        const was = this.syncStatus;
        this.syncStatus = status;
        // The backend became usable (engine ready, or back after a login): fetch the real inbox.
        if (status === 'ok' && was !== 'ok') void this.load().catch(() => {});
      })
    ];
    return () => offs.forEach((off) => off());
  }
}

export const inbox = new InboxStore();
