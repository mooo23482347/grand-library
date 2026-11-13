// Document kinds, bindings and the palettes that make each kind look different on the shelf.

export const KINDS = [
  { id: 'book', label: 'Book', group: 'Books', binding: 'leather' },
  { id: 'paper', label: 'Scientific paper', group: 'Scientific literature', binding: 'journal' },
  { id: 'article', label: 'Research article', group: 'Scientific literature', binding: 'journal' },
  { id: 'journal', label: 'Journal issue', group: 'Scientific literature', binding: 'journal' },
  { id: 'study', label: 'Study or report', group: 'Scientific literature', binding: 'journal' },
  { id: 'review', label: 'Literature review', group: 'Scientific literature', binding: 'journal' },
  { id: 'lecture', label: 'Lecture script', group: 'University & studies', binding: 'binder' },
  { id: 'material', label: 'Course material', group: 'University & studies', binding: 'binder' },
  { id: 'assignment', label: 'Assignment', group: 'University & studies', binding: 'binder' },
  { id: 'slides', label: 'Presentation', group: 'University & studies', binding: 'binder' },
  { id: 'exam', label: 'Exam summary', group: 'University & studies', binding: 'binder' },
  { id: 'notebook', label: 'Notebook', group: 'Personal papers', binding: 'notebook' },
  { id: 'thoughts', label: 'Philosophical thoughts', group: 'Personal papers', binding: 'notebook' },
  { id: 'theory', label: 'Own theory', group: 'Personal papers', binding: 'manuscript' },
  { id: 'summary', label: 'Summary', group: 'Personal papers', binding: 'notebook' },
  { id: 'quotes', label: 'Quotation collection', group: 'Personal papers', binding: 'notebook' },
  { id: 'manuscript', label: 'Manuscript', group: 'Personal papers', binding: 'manuscript' },
  { id: 'other', label: 'Other document', group: 'Other', binding: 'cloth' },
];

export const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));
export const kindLabel = (id) => KIND[id]?.label || 'Document';
export const bindingOf = (id) => (KIND[id] || KIND.other).binding;

export const KIND_GROUPS = [...new Set(KINDS.map((k) => k.group))];

export const NOTE_KINDS = [
  { id: 'note', label: 'Note' },
  { id: 'summary', label: 'Summary' },
  { id: 'thought', label: 'Own thought' },
  { id: 'theory', label: 'Theory' },
  { id: 'quote', label: 'Quotation' },
];
export const noteKindLabel = (id) => NOTE_KINDS.find((k) => k.id === id)?.label || 'Note';

export const FORMATS = {
  epub: 'EPUB',
  pdf: 'PDF',
  text: 'Written in the library',
  file: 'Stored file',
  none: 'Catalogue entry, no file',
};

/** Leather colours a room can be dressed in. */
export const LEATHERS = [
  { name: 'Oxblood', hex: '#5b1a1a' },
  { name: 'Bottle green', hex: '#1f3b2c' },
  { name: 'Aubergine', hex: '#3e2338' },
  { name: 'Prussian blue', hex: '#1d2a44' },
  { name: 'Umber', hex: '#4b2e1a' },
  { name: 'Verdigris', hex: '#23393b' },
  { name: 'Ochre', hex: '#6b4a1c' },
  { name: 'Slate', hex: '#2f3438' },
  { name: 'Claret', hex: '#4a1630' },
  { name: 'Moss', hex: '#3a3f1f' },
];

/** Colours a spine can be bound in, per binding. */
export const PALETTE = {
  leather: ['#5b1a1a', '#4a1616', '#6a2a1c', '#1f3b2c', '#173022', '#1d2a44', '#18223a', '#3e2338', '#4b2e1a', '#2a1d14', '#14110f', '#3a2e1e', '#5a4524', '#2b3a3a', '#6b3a1e', '#4a1630'],
  journal: ['#3d4a52', '#4a5446', '#5a4f3a', '#463c4a', '#3b4656', '#5b5244', '#2f3b3b', '#4f3f33'],
  binder: ['#3a2f26', '#2e3540', '#40302a', '#33392c', '#3b2b2f'],
  notebook: ['#6b5a3e', '#4f3b2a', '#3f3328', '#5d4a35', '#2f2a24', '#54412c'],
  manuscript: ['#d8c6a0', '#cdb98f', '#e0d0ac', '#d2bf96'],
  cloth: ['#4a3b2b', '#3c3a33', '#51443a', '#3a3f45'],
};

export const ALL_SPINE_COLORS = [...new Set([...PALETTE.leather, ...PALETTE.journal, ...PALETTE.notebook, ...PALETTE.manuscript])];

export const EMBLEMS = ['owl', 'quill', 'key', 'globe', 'column', 'mortarboard', 'lamp', 'book', 'scroll', 'hourglass', 'laurel', 'compass', 'lyre', 'crown'];
