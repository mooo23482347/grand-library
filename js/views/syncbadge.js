// A small sync symbol: quiet when all is well, visible when something needs attention.

import { h } from '../util.js';
import { icon } from '../ui/icons.js';
import { syncState, onSyncState } from '../sync.js';

export const SYNC_TEXT = {
  off: 'Nicht angemeldet',
  idle: 'Synchronisiert',
  syncing: 'Wird synchronisiert',
  offline: 'Offline – wird später synchronisiert',
  error: 'Fehler beim Synchronisieren',
};

function iconFor(s) {
  if (s.status === 'syncing') return 'sync';
  if (s.status === 'error') return 'alert';
  if (s.status === 'offline' || s.status === 'off') return 'cloudOff';
  return 'cloudCheck';
}

const badges = new Set();
onSyncState((s) => {
  for (const b of badges) {
    if (!b.isConnected) {
      badges.delete(b);
      continue;
    }
    paint(b, s);
  }
});

function paint(b, s) {
  b.hidden = !s.configured;
  b.className = `icon-btn sync-badge s-${s.status}`;
  b.innerHTML = icon(iconFor(s));
  b.title = SYNC_TEXT[s.status] || '';
  b.setAttribute('aria-label', `${SYNC_TEXT[s.status] || 'Synchronisierung'} – Einstellungen öffnen`);
}

export function syncBadge() {
  const b = h('a', { href: '#/settings' });
  paint(b, syncState);
  badges.add(b);
  return b;
}
