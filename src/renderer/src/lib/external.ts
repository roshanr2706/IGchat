import { call } from './api';

export function openExternal(url: string): void {
  if (/^https:\/\//i.test(url)) void call('shell:openExternal', url).catch(() => {});
}
