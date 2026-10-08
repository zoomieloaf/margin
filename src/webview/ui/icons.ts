const P: Record<string, string> = {
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  strike: '<path d="M16 6.5A4 4 0 0 0 12.5 5h-1A3.5 3.5 0 0 0 8 8.5c0 1.4.8 2.5 2.2 3"/><path d="M14.5 13.5c1 .6 1.5 1.5 1.5 2.5a3.5 3.5 0 0 1-3.5 3.5h-1.5A4 4 0 0 1 7.5 17"/><path d="M4 12h16"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  highlight: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
  olist: '<path d="M10 6h11M10 12h11M10 18h11M4 4.5 5 4v4M4 8h2M6 19.5H4c0-1 2-1.5 2-2.5s-1-1.5-2-.8"/>',
  task: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
  quote: '<path d="M5 7h5v5c0 3-2 5-4.5 5.5M14 7h5v5c0 3-2 5-4.5 5.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
  codeblock: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m10 9-3 3 3 3M14 15l3-3-3-3"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 4v16"/>',
  minus: '<path d="M4 12h16"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M17.5 8.5h1M17.5 12h1"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  sparkles: '<path d="M11 3.5 12.8 8l4.7 1.8-4.7 1.8L11 16l-1.8-4.4L4.5 9.8 9.2 8z"/><path d="M18.5 14v5M16 16.5h5"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pencil: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  diagram: '<rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/><path d="M6.5 10v4a2 2 0 0 0 2 2H14"/>',
  shorten: '<path d="M4 7h16M4 12h10M4 17h6"/>',
  spell: '<path d="m3 16 4-10 4 10M4.5 12.5h5"/><path d="m13 15 2.5 2.5L21 12"/>',
  translate: '<path d="M4 5h8M8 3v2M5 9c1.5 3 4 5 7 6M11 5c-1 4-3.5 7-7 9"/><path d="m13 21 4-9 4 9M14.5 18h5"/>',
};

export function icon(name: string, cls = ''): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
export const keyLabel = (k: string) => (isMac ? k.replace(/Ctrl/g, '⌘') : k);
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
