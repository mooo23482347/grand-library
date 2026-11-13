// Document kinds, note kinds, formats and colours.

export const KINDS = [
  { id: 'book', label: 'Buch', group: 'Bücher', binding: 'leather' },
  { id: 'paper', label: 'Wissenschaftliches Paper', group: 'Wissenschaftliche Literatur', binding: 'journal' },
  { id: 'article', label: 'Fachartikel', group: 'Wissenschaftliche Literatur', binding: 'journal' },
  { id: 'journal', label: 'Zeitschriftenheft', group: 'Wissenschaftliche Literatur', binding: 'journal' },
  { id: 'study', label: 'Studie oder Bericht', group: 'Wissenschaftliche Literatur', binding: 'journal' },
  { id: 'review', label: 'Literaturübersicht', group: 'Wissenschaftliche Literatur', binding: 'journal' },
  { id: 'lecture', label: 'Vorlesungsskript', group: 'Uni & Studium', binding: 'binder' },
  { id: 'material', label: 'Lernmaterial', group: 'Uni & Studium', binding: 'binder' },
  { id: 'assignment', label: 'Aufgabe', group: 'Uni & Studium', binding: 'binder' },
  { id: 'slides', label: 'Präsentation', group: 'Uni & Studium', binding: 'binder' },
  { id: 'exam', label: 'Prüfungszusammenfassung', group: 'Uni & Studium', binding: 'binder' },
  { id: 'notebook', label: 'Notizbuch', group: 'Persönliches', binding: 'notebook' },
  { id: 'thoughts', label: 'Philosophische Gedanken', group: 'Persönliches', binding: 'notebook' },
  { id: 'theory', label: 'Eigene Theorie', group: 'Persönliches', binding: 'manuscript' },
  { id: 'summary', label: 'Zusammenfassung', group: 'Persönliches', binding: 'notebook' },
  { id: 'quotes', label: 'Zitatsammlung', group: 'Persönliches', binding: 'notebook' },
  { id: 'manuscript', label: 'Manuskript', group: 'Persönliches', binding: 'manuscript' },
  { id: 'other', label: 'Sonstiges Dokument', group: 'Sonstiges', binding: 'cloth' },
];

export const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));
export const kindLabel = (id) => KIND[id]?.label || 'Dokument';
export const bindingOf = (id) => (KIND[id] || KIND.other).binding;
export const KIND_GROUPS = [...new Set(KINDS.map((k) => k.group))];

export const NOTE_KINDS = [
  { id: 'note', label: 'Notiz', plural: 'Notizen', icon: 'penLine' },
  { id: 'summary', label: 'Zusammenfassung', plural: 'Zusammenfassungen', icon: 'fileText' },
  { id: 'thought', label: 'Gedanke', plural: 'Gedanken', icon: 'bulb' },
  { id: 'theory', label: 'Theorie', plural: 'Theorien', icon: 'sparkles' },
  { id: 'quote', label: 'Zitat', plural: 'Zitate', icon: 'quote' },
];
export const noteKindLabel = (id) => NOTE_KINDS.find((k) => k.id === id)?.label || 'Notiz';
export const noteKind = (id) => NOTE_KINDS.find((k) => k.id === id) || NOTE_KINDS[0];

export const FORMATS = {
  epub: 'EPUB',
  pdf: 'PDF',
  text: 'Eigener Text',
  file: 'Datei',
  none: 'Nur Katalogeintrag',
};

/** Shelf colours (stored on each shelf, shown as a small dot). */
export const LEATHERS = [
  { name: 'Ochsenblut', hex: '#8a3b2e' },
  { name: 'Flaschengrün', hex: '#3f6b52' },
  { name: 'Aubergine', hex: '#6b4560' },
  { name: 'Preußischblau', hex: '#3e5874' },
  { name: 'Umbra', hex: '#7a5434' },
  { name: 'Grünspan', hex: '#3f706c' },
  { name: 'Ocker', hex: '#a07432' },
  { name: 'Schiefer', hex: '#5a6168' },
  { name: 'Weinrot', hex: '#7c3048' },
  { name: 'Moos', hex: '#66703a' },
];

/** Generated covers: warm, muted cloth colours. */
export const COVER_COLORS = ['#8c4a32', '#5e6b4b', '#3f5566', '#7a5a2f', '#6b3f55', '#2f5d58', '#9a6a3a', '#4b4f6b', '#7d3b3b', '#56604a', '#a0552a', '#3b4a3f'];

// Kept for older stored records (spine colours chosen in earlier versions).
export const PALETTE = {
  leather: ['#5b1a1a', '#1f3b2c', '#1d2a44', '#3e2338', '#4b2e1a', '#2b3a3a', '#6b3a1e', '#4a1630'],
  journal: ['#3d4a52', '#4a5446', '#5a4f3a', '#463c4a', '#3b4656'],
  binder: ['#3a2f26', '#2e3540', '#40302a'],
  notebook: ['#6b5a3e', '#4f3b2a', '#5d4a35'],
  manuscript: ['#d8c6a0', '#cdb98f'],
  cloth: ['#4a3b2b', '#3c3a33'],
};
export const ALL_SPINE_COLORS = COVER_COLORS;
export const EMBLEMS = ['owl', 'quill', 'key', 'globe', 'column', 'mortarboard', 'lamp', 'book'];
