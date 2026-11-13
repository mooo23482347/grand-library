// Line icons drawn in the manner of engraved brass. Static, trusted markup.

const I = {
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  next: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  dots: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  arch: '<path d="M5 21V10a7 7 0 0 1 14 0v11"/><path d="M3 21h18"/><path d="M9 21v-7h6v7"/>',
  quill: '<path d="M20 3.5c-6 1.5-10.5 6.5-12.5 13.5L6.3 21"/><path d="M20 3.5c-1 5-4.6 9-9.6 11.3"/><path d="M11.5 10.5l3 .8M9.6 13.6l3 .4"/>',
  ledger: '<rect x="4" y="3.5" width="16" height="17" rx="1"/><path d="M8 3.5v17M11 8h6M11 11.5h6M11 15h4"/>',
  acquire: '<path d="M4 6.5c3-1 6-1 8 .8v13c-2-1.6-5-1.6-8-.8z"/><path d="M20 6.5c-3-1-6-1-8 .8"/><path d="M17 11v7M13.5 14.5h7"/>',
  key: '<circle cx="7.5" cy="12" r="3.5"/><path d="M11 12h10M18 12v3M21 12v2.5"/>',
  book: '<path d="M4 5.5c3-1 6-1 8 .8v13c-2-1.6-5-1.6-8-.8z"/><path d="M20 5.5c-3-1-6-1-8 .8v13c2-1.6 5-1.6 8-.8z"/>',
  toc: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".9" fill="currentColor"/><circle cx="4" cy="12" r=".9" fill="currentColor"/><circle cx="4" cy="18" r=".9" fill="currentColor"/>',
  ribbon: '<path d="M7 3.5h10v17l-5-4-5 4z"/>',
  ribbonFill: '<path d="M7 3.5h10v17l-5-4-5 4z" fill="currentColor"/>',
  type: '<path d="M4 19l5-13 5 13M5.8 14.5h6.4"/><path d="M15 19l3-7.5 3 7.5M15.9 16.8h4.2"/>',
  pen: '<path d="M4 20l1-4.5L16 4.5l3.5 3.5L8.5 19z"/><path d="M14 7l3.5 3.5"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  move: '<path d="M4 12h15M14 7l5 5-5 5"/>',
  copy: '<rect x="8" y="8" width="11" height="12" rx="1"/><path d="M5 16V5a1 1 0 0 1 1-1h9"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  select: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M8 12.5l3 3 5.5-6"/>',
  grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
  shelf: '<path d="M3 20h18M3 4h18M4 4v16M20 4v16"/><path d="M7 20V8M9.5 20V6.5M12 20V9M15 20l2-10"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>',
  sync: '<path d="M19.5 9A8 8 0 0 0 5 7.5M4.5 15A8 8 0 0 0 19 16.5"/><path d="M19.5 4v5h-5M4.5 20v-5h5"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5-1.5A4.8 4.8 0 0 0 7 18.5z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  folderUp: '<path d="M12 19V7M7 12l5-5 5 5"/>',
  minus: '<path d="M5 12h14"/>',
  highlight: '<path d="M5 19.5h14"/><path d="M7 16l2.5-1 8.5-8.5-1.5-1.5L8 13.5z"/>',
  scroll: '<path d="M7 4h11a2 2 0 0 1 0 4h-1v10a2 2 0 0 1-2 2H6a2 2 0 0 1 0-4h1z"/><path d="M7 16V6a2 2 0 0 0-2-2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6M12 7.6v.4"/>',
  lamp: '<path d="M9 21h6M12 21v-5"/><path d="M7 16h10l-2-9H9z"/>',
};

export function icon(name, cls = '') {
  const body = I[name] || I.info;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Room emblems, engraved on the keystone above each door. */
const E = {
  owl: '<path d="M10 12c0-3.2 2.8-4.6 6-4.6s6 1.4 6 4.6v7.5c0 4.2-2.8 7-6 7s-6-2.8-6-7z"/><path d="M10.2 11.4L9.4 7.2l3.6 1.9M21.8 11.4l.8-4.2-3.6 1.9"/><circle cx="13.6" cy="13.8" r="2.2"/><circle cx="18.4" cy="13.8" r="2.2"/><path d="M16 15.8l-.9 1.5h1.8z"/><path d="M12.4 20.2c1 1.8 2.2 2.6 3.6 2.6s2.6-.8 3.6-2.6"/><path d="M7 27.5h18"/>',
  quill: '<path d="M25 4.5C17.5 6.8 12.3 13 10 21.5L8.3 27.5"/><path d="M25 4.5c-1.2 6.5-5.6 11.6-12.3 14.6"/><path d="M14.5 13.6l4 .9M12.3 17.4l3.8.5"/><path d="M5.5 27.5h11"/>',
  key: '<circle cx="10" cy="16" r="5"/><circle cx="10" cy="16" r="1.6"/><path d="M15 16h12.5M23.5 16v4.2M27 16v3"/>',
  globe: '<circle cx="16" cy="14.5" r="8.5"/><ellipse cx="16" cy="14.5" rx="3.6" ry="8.5"/><path d="M7.5 14.5h17M9 10.2h14M9 18.8h14"/><path d="M16 23v3.2M10.5 27.5h11"/>',
  column: '<path d="M7 7.5h18M8.5 9.8h15M10 9.8v13.4M14 9.8v13.4M18 9.8v13.4M22 9.8v13.4M8.5 23.2h15M7.5 25.4h17M6.5 27.5h19"/><path d="M7 7.5l2-2.5h14l2 2.5"/>',
  mortarboard: '<path d="M3.5 13l12.5-6 12.5 6-12.5 6z"/><path d="M9 15.8v6.2c3.4 2.4 10.6 2.4 14 0v-6.2"/><path d="M27 14v7.5"/><circle cx="27" cy="22.5" r="1"/>',
  lamp: '<path d="M8.5 20.5c0-2 3.4-3.3 8-3.3s8.5 1.3 8.5 3.3-3.8 3.2-8.5 3.2-8-1.2-8-3.2z"/><path d="M25 20c2.2-.6 3.2-2.3 2.6-4.2"/><path d="M8.8 19.6L5.8 18"/><path d="M5.2 16.8c-1.7-1.9-1.1-4.2.7-6.3.1 2.1 1.6 3.3 1.1 5.5"/><path d="M13.5 23.6l-1 3.4h8l-1-3.4"/>',
  book: '<path d="M4.5 9c4-1.3 8.2-1.2 11.5 1v15.5c-3.3-2.1-7.5-2.2-11.5-1z"/><path d="M27.5 9c-4-1.3-8.2-1.2-11.5 1v15.5c3.3-2.1 7.5-2.2 11.5-1z"/><path d="M7.5 13.2c2-.4 4.2-.3 6 .5M7.5 17c2-.4 4.2-.3 6 .5M18.5 13.7c1.8-.8 4-.9 6-.5M18.5 17.5c1.8-.8 4-.9 6-.5"/>',
  scroll: '<path d="M9.5 6.5h14a2.4 2.4 0 0 1 0 4.8h-1v13.2a2.4 2.4 0 0 1-2.4 2.4H8.4a2.4 2.4 0 0 1 0-4.8h1.1z"/><path d="M9.5 22.1V8.9a2.4 2.4 0 0 0-2.4-2.4"/><path d="M13 13h6.5M13 16.5h6.5M13 20h4.5"/>',
  hourglass: '<path d="M8.5 4.5h15M8.5 27.5h15M10 4.5c0 6.2 6 7.2 6 11.5s-6 5.3-6 11.5M22 4.5c0 6.2-6 7.2-6 11.5s6 5.3 6 11.5"/><path d="M12.6 24.6c1.2-2 2.4-2.6 3.4-2.6s2.2.6 3.4 2.6z"/>',
  laurel: '<path d="M16 27.5c-6.5-3.2-9.6-9.6-8.4-17.5M16 27.5c6.5-3.2 9.6-9.6 8.4-17.5"/><path d="M9.6 21.3c-2.2.3-3.6-.9-4.2-2.6 2.1-.3 3.6.8 4.2 2.6zM8.1 16.4c-2.1-.4-3-2-3.1-3.8 2 .5 3 1.9 3.1 3.8zM8 11.5C6.3 10.4 6 8.6 6.6 7c1.7 1.1 2 2.7 1.4 4.5zM22.4 21.3c2.2.3 3.6-.9 4.2-2.6-2.1-.3-3.6.8-4.2 2.6zM23.9 16.4c2.1-.4 3-2 3.1-3.8-2 .5-3 1.9-3.1 3.8zM24 11.5c1.7-1.1 2-2.9 1.4-4.5-1.7 1.1-2 2.7-1.4 4.5z"/>',
  compass: '<path d="M16 3.5l2.6 9.9 9.9 2.6-9.9 2.6L16 28.5l-2.6-9.9L3.5 16l9.9-2.6z"/><circle cx="16" cy="16" r="2"/><path d="M8 8l3.5 3.5M24 8l-3.5 3.5M8 24l3.5-3.5M24 24l-3.5-3.5"/>',
  lyre: '<path d="M10.5 5.5c-3.3 4.3-2.6 10.6 1.8 13.8M21.5 5.5c3.3 4.3 2.6 10.6-1.8 13.8"/><path d="M11.3 19.3h9.4l-1 6.7h-7.4z"/><path d="M14 9.5v9.8M16 8.6v10.7M18 9.5v9.8"/><path d="M10.5 5.5c2 0 3.2 1.2 3.4 3.3M21.5 5.5c-2 0-3.2 1.2-3.4 3.3"/>',
  crown: '<path d="M6 22.5l2-12.5 5 6 3-8.5 3 8.5 5-6 2 12.5z"/><path d="M6 25.5h20"/><circle cx="16" cy="6" r="1.2"/>',
};

export function emblem(name, cls = '') {
  const body = E[name] || E.book;
  return `<svg class="emblem ${cls}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const ORNAMENT = `<svg class="ornament" viewBox="0 0 240 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1"><path d="M4 8h92M144 8h92"/><path d="M100 8c4-5 8-5 12 0-4 5-8 5-12 0zM128 8c4-5 8-5 12 0-4 5-8 5-12 0z"/><path d="M120 2l5 6-5 6-5-6z" fill="currentColor" stroke="none"/><circle cx="96" cy="8" r="1.4" fill="currentColor"/><circle cx="144" cy="8" r="1.4" fill="currentColor"/></svg>`;
