// Reading preferences.
//
// Synced to every device (taste, the same on phone and PC): skin, font, weight, line spacing,
// paragraph spacing, alignment, ornaments.
// Kept per device (they depend on the screen): type size, margins, reading mode, double pages.

import { getPref, setPref, getSetting, setSetting } from '../store.js';

export const SKINS = [
  { id: 'cream', name: 'Cremeweiß', dark: false },
  { id: 'parchment', name: 'Pergament', dark: false },
  { id: 'sepia', name: 'Sepia', dark: false },
  { id: 'sage', name: 'Salbei', dark: false },
  { id: 'newsprint', name: 'Zeitungsgrau', dark: false },
  { id: 'midnight', name: 'Mitternacht', dark: true },
];

export const FONTS = [
  { id: 'serif', name: 'System-Serif', css: "ui-serif, 'New York', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif" },
  { id: 'georgia', name: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  { id: 'palatino', name: 'Palatino', css: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
  { id: 'literata', name: 'Literata', css: "'Literata', Georgia, serif" },
  { id: 'atkinson', name: 'Atkinson Hyperlegible', css: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  { id: 'sans', name: 'System-Sans', css: "-apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', sans-serif" },
];

const SYNCED_DEFAULTS = { skin: 'cream', font: 'serif', weight: 400, leading: 1.55, para: 0, align: 'auto', ornaments: true };
const DEVICE_DEFAULTS = () => ({
  size: matchMedia('(max-width: 600px)').matches ? 19 : 20,
  margins: 'm',
  mode: 'pages',
  spread: true,
});
const SYNCED_KEYS = Object.keys(SYNCED_DEFAULTS);

let device = null;

export async function loadReaderPrefs() {
  if (!device) {
    device = { ...DEVICE_DEFAULTS(), ...((await getSetting('readerDevice')) || {}) };
    // Older versions stored everything locally; carry the size over once.
    const old = await getSetting('readerPrefs');
    if (old?.size && !(await getSetting('readerDevice'))) device.size = Math.max(15, Math.min(30, old.size - 1));
  }
  return readerPrefs();
}

export function readerPrefs() {
  const synced = { ...SYNCED_DEFAULTS, ...(getPref('reader', {}) || {}) };
  return { ...synced, ...(device || DEVICE_DEFAULTS()) };
}

export async function setReaderPrefs(patch) {
  const syncedPatch = {};
  const devicePatch = {};
  for (const [k, v] of Object.entries(patch)) (SYNCED_KEYS.includes(k) ? syncedPatch : devicePatch)[k] = v;
  if (Object.keys(devicePatch).length) {
    device = { ...(device || DEVICE_DEFAULTS()), ...devicePatch };
    await setSetting('readerDevice', device);
  }
  if (Object.keys(syncedPatch).length) await setPref('reader', { ...SYNCED_DEFAULTS, ...(getPref('reader', {}) || {}), ...syncedPatch });
  return readerPrefs();
}

export const fontCss = (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).css;
export const skinOf = (id) => SKINS.find((s) => s.id === id) || SKINS[0];
