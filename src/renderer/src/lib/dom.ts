/** Scrolls a loaded message into view and briefly highlights it. */
export function scrollToMessage(id: string): void {
  const el = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1300);
}
