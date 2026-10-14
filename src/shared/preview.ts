import type { MessageBody } from './types';

/** Short human-readable description of a message, used for reply quotes and thread previews. */
export function messagePreview(m: MessageBody): string {
  switch (m.kind) {
    case 'text':
      return m.text;
    case 'link':
      return m.text || m.url;
    case 'image':
      return 'Sent a photo';
    case 'video':
      return 'Sent a video';
    case 'sharedPost':
      return 'Shared a post';
    case 'reel':
      return 'Shared a reel';
    case 'like':
      return '❤️';
    case 'actionLog':
      return m.text;
    case 'unsupported':
      return 'Sent a message';
  }
}
