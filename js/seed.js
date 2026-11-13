// The shelves a new library starts with. Only a starting point: every shelf and collection can be
// renamed, rearranged or removed. Ids are deterministic so a second device seeds identical records.

import { slug } from './util.js';

export const SEED_ROOMS = [
  {
    key: 'philosophy', name: 'Philosophie', en: 'Philosophy', subtitle: '', emblem: 'owl', leather: '#8a3b2e',
    collections: [
      ['Ancient Philosophy', 'Antike Philosophie'], ['Modern Philosophy', 'Neuzeitliche Philosophie'], ['Political Philosophy', 'Politische Philosophie'],
      ['Ethics', 'Ethik'], ['Metaphysics', 'Metaphysik'], ['Epistemology', 'Erkenntnistheorie'], ['Philosophical Notes', 'Philosophische Notizen'],
    ],
  },
  {
    key: 'literature', name: 'Literatur & Klassiker', en: 'Literature & Classics', subtitle: '', emblem: 'quill', leather: '#3f6b52',
    collections: [['German Literature', 'Deutsche Literatur'], ['English Literature', 'Englische Literatur'], ['Classical Literature', 'Klassische Literatur'], ['Poetry', 'Lyrik'], ['Historical Fiction', 'Historische Romane']],
  },
  {
    key: 'fantasy', name: 'Fantasy & Fiction', en: 'Fantasy & Fiction', subtitle: '', emblem: 'key', leather: '#6b4560',
    collections: [['High Fantasy', 'High Fantasy'], ['Science Fiction', 'Science-Fiction'], ['Myths & Legends', 'Mythen & Sagen']],
  },
  {
    key: 'science', name: 'Wissenschaft', en: 'Science & Knowledge', subtitle: '', emblem: 'globe', leather: '#3e5874',
    collections: [['Natural Sciences', 'Naturwissenschaften'], ['Artificial Intelligence', 'Künstliche Intelligenz'], ['Economics', 'Wirtschaft'], ['Scientific Papers', 'Wissenschaftliche Paper']],
  },
  {
    key: 'history', name: 'Geschichte & Politik', en: 'History & Politics', subtitle: '', emblem: 'column', leather: '#7a5434',
    collections: [['Ancient History', 'Alte Geschichte'], ['European History', 'Europäische Geschichte'], ['Political Systems', 'Politische Systeme'], ['Political Theory', 'Politische Theorie'], ['International Relations', 'Internationale Beziehungen']],
  },
  {
    key: 'university', name: 'Uni & Studium', en: 'University & Studies', subtitle: '', emblem: 'mortarboard', leather: '#3f706c',
    collections: [
      ['E-Commerce', 'E-Commerce'], ['Marketing', 'Marketing'], ['Research Methods', 'Forschungsmethoden'], ['Business Administration', 'Betriebswirtschaft'],
      ['Private Law Studies', 'Privatrecht'], ['Lecture Notes', 'Vorlesungsnotizen'], ['Scientific Papers', 'Wissenschaftliche Paper'], ['Assignments', 'Aufgaben'],
    ],
  },
  {
    key: 'personal', name: 'Persönliches Archiv', en: 'Personal Archive', subtitle: '', emblem: 'lamp', leather: '#a07432',
    collections: [['Own Thoughts', 'Eigene Gedanken'], ['Manuscripts', 'Manuskripte'], ['Quotations', 'Zitate'], ['Summaries', 'Zusammenfassungen'], ['Journals', 'Tagebücher']],
  },
];

// Collection ids are derived from the original English names, so they stay identical everywhere.
export function seedRecords(rooms) {
  const departments = [];
  const collections = [];
  rooms.forEach((r, i) => {
    const id = `dept-${r.key}`;
    departments.push({ id, name: r.name, subtitle: r.subtitle, emblem: r.emblem, leather: r.leather, order: i + 1, createdAt: 0, updatedAt: 0 });
    r.collections.forEach(([en, de], j) => {
      collections.push({ id: `col-${r.key}-${slug(en)}`, departmentId: id, parentId: null, name: de, description: '', order: j + 1, createdAt: 0, updatedAt: 0 });
    });
  });
  return { departments, collections };
}

/** English seed names → German, for libraries created before the German interface. */
export function germanRenames() {
  const depts = new Map();
  const cols = new Map();
  for (const r of SEED_ROOMS) {
    depts.set(`dept-${r.key}`, { from: r.en, to: r.name, leather: r.leather });
    for (const [en, de] of r.collections) cols.set(`col-${r.key}-${slug(en)}`, { from: en, to: de });
  }
  return { depts, cols };
}
