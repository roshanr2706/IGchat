import { messagePreview } from '../../shared/preview';
import type { Message, MessageBody, Reaction, ReplyRef, Thread, User } from '../../shared/types';

export const ME: User = { id: 'me', username: 'you', fullName: 'You', avatarUrl: '', verified: false };

const PEOPLE: [username: string, fullName: string, bio: string][] = [
  ['alex_r', 'Alex Rivera', 'coffee, cameras, bad puns'],
  ['sam.kim', 'Sam Kim', 'cs @ uw'],
  ['priya.s', 'Priya Shah', 'plants > people'],
  ['jordan_b', 'Jordan Brooks', ''],
  ['mia.chen', 'Mia Chen', 'climbing 🧗'],
  ['leo.m', 'Leo Martins', 'music producer'],
  ['nora.w', 'Nora Williams', ''],
  ['dev.patel', 'Dev Patel', 'building things'],
  ['zoe.l', 'Zoe Lambert', 'film photography'],
  ['omar.h', 'Omar Haddad', ''],
  ['ella.j', 'Ella Johnson', 'runner'],
  ['kai.n', 'Kai Nakamura', 'gamer'],
  ['lucia.g', 'Lucia Garcia', ''],
  ['ben.t', 'Ben Thompson', 'chef in training'],
  ['ava.r', 'Ava Rossi', ''],
  ['noah.k', 'Noah Kowalski', 'gym'],
  ['ivy.z', 'Ivy Zhang', 'art'],
  ['max.f', 'Max Fischer', ''],
  ['ruby.o', "Ruby O'Neill", 'books'],
  ['theo.d', 'Theo Dubois', ''],
  ['lily.p', 'Lily Park', 'k-drama enjoyer'],
  ['ethan.c', 'Ethan Clarke', ''],
  ['sofia.m', 'Sofia Moreno', 'travel'],
  ['jay.v', 'Jay Verma', '']
];

const GROUPS: [title: string, memberIndexes: number[]][] = [
  ['weekend plans 🏕️', [0, 1, 2, 4]],
  ['cs study group', [1, 7, 11, 21]],
  ['roommates', [3, 9]],
  ['climbing crew', [4, 10, 15, 22, 23]],
  ['fam', [12, 14]],
  ['music collab', [5, 17, 19]]
];

export const LINES = [
  'yo did you see this',
  'lmaooo',
  'bro what',
  'omw',
  "that's crazy",
  'send me the link',
  "who's coming tonight?",
  "i'm dead 💀",
  'nah no way',
  'ok bet',
  'haha',
  'wait really?',
  "can't rn, later?",
  'this is so you',
  'LOL',
  'good morning ☀️',
  'did you finish the assignment',
  'facts',
  "call me when you're free",
  'brb'
];

const CAPTIONS = ['this is unreal', 'tag someone who needs this', 'no thoughts just vibes', 'weekend mood', 'how is this real'];
const REACTIONS = ['❤️', '😂', '😮', '👍'];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function svgDataUri(label: string, hue: number, w: number, h: number): string {
  const size = Math.round(Math.min(w, h) / 3);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},70%,60%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,40%)"/>` +
    `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>` +
    `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${size}" fill="white">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function threadPreview(m: Message): string {
  return `${m.senderId === ME.id ? 'You: ' : ''}${messagePreview(m)}`;
}

export type Seed = { users: User[]; threads: Thread[]; messages: Map<string, Message[]> };

type Spec = { title: string; members: User[]; isGroup: boolean };

export function createSeed(now: number, seed = 42): Seed {
  const rand = mulberry32(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

  const users: User[] = PEOPLE.map(([username, fullName, bio], i) => ({
    id: `u${i}`,
    username,
    fullName,
    bio: bio || undefined,
    verified: i === 5,
    avatarUrl: i % 2 === 0 ? svgDataUri(fullName[0]!, (i * 47) % 360, 96, 96) : ''
  }));

  const specs: Spec[] = [
    ...users.map((u) => ({ title: u.fullName, members: [u], isGroup: false })),
    ...GROUPS.map(([title, idx]) => ({ title, members: idx.map((i) => users[i]!), isGroup: true }))
  ];
  // Deterministic Fisher–Yates shuffle so groups are interleaved with DMs.
  for (let i = specs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [specs[i], specs[j]] = [specs[j]!, specs[i]!];
  }

  const randomBody = (spec: Spec): MessageBody => {
    const r = rand();
    if (r < 0.06) return { kind: 'image', url: svgDataUri('📷', Math.floor(rand() * 360), 480, 320), width: 480, height: 320 };
    if (r < 0.09) {
      return { kind: 'reel', postUrl: 'https://www.instagram.com/reels/', thumbUrl: svgDataUri('▶', Math.floor(rand() * 360), 270, 480), caption: pick(CAPTIONS), author: pick(spec.members).username };
    }
    if (r < 0.11) {
      return { kind: 'sharedPost', postUrl: 'https://www.instagram.com/explore/', thumbUrl: svgDataUri('◼', Math.floor(rand() * 360), 400, 400), caption: pick(CAPTIONS), author: pick(spec.members).username };
    }
    if (r < 0.125) return { kind: 'link', text: 'check this out https://example.com/article', url: 'https://example.com/article', title: 'An interesting article' };
    if (r < 0.14) return { kind: 'like' };
    if (spec.isGroup && r < 0.15) return { kind: 'actionLog', text: `${pick(spec.members).fullName} changed the group photo` };
    if (r < 0.155) return { kind: 'unsupported', rawType: 'voice_media' };
    return { kind: 'text', text: pick(LINES) };
  };

  const threads: Thread[] = [];
  const messages = new Map<string, Message[]>();

  specs.forEach((spec, k) => {
    const id = `t${k}`;
    const count = k < 3 ? 120 : 20 + Math.floor(rand() * 40);

    // Timestamps newest → oldest, then reversed to ascending.
    const stamps: number[] = [];
    let ts = now - k * 47 * 60_000 - Math.floor(rand() * 30 * 60_000);
    for (let i = 0; i < count; i++) {
      stamps.push(ts);
      const r = rand();
      const gap = r < 0.7 ? 10_000 + rand() * 290_000 : r < 0.95 ? 600_000 + rand() * 4_800_000 : 21_600_000 + rand() * 86_400_000;
      ts -= Math.round(gap);
    }
    stamps.reverse();

    const list: Message[] = [];
    stamps.forEach((timestamp, i) => {
      const body = randomBody(spec);
      const senderId = body.kind === 'actionLog' ? pick(spec.members).id : rand() < 0.45 ? ME.id : pick(spec.members).id;
      let replyTo: ReplyRef | undefined;
      if (i > 3 && body.kind === 'text' && rand() < 0.06) {
        const target = list[i - 1 - Math.floor(rand() * 3)]!;
        if (target.kind !== 'actionLog') replyTo = { messageId: target.id, senderId: target.senderId, preview: messagePreview(target) };
      }
      const reactions: Reaction[] = body.kind !== 'actionLog' && rand() < 0.1 ? [{ emoji: pick(REACTIONS), userIds: [pick([ME, ...spec.members]).id] }] : [];
      list.push({ id: `${id}-m${i}`, threadId: id, senderId, timestamp, reactions, status: 'sent', ...(replyTo ? { replyTo } : {}), ...body } as Message);
    });
    messages.set(id, list);

    const last = list[list.length - 1]!;
    const avatarUrls = spec.members.map((m) => m.avatarUrl).filter(Boolean).slice(0, 2);
    threads.push({
      id,
      title: spec.title,
      isGroup: spec.isGroup,
      participants: spec.members,
      adminIds: spec.isGroup ? [ME.id] : [],
      lastActivityAt: last.timestamp,
      lastMessagePreview: threadPreview(last),
      unread: k === 0 || k === 2,
      muted: k === 7,
      avatarUrls
    });
  });

  return { users, threads, messages };
}
