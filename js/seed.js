// The rooms a new library opens with. Only a starting point: every room and collection can be
// renamed, rearranged or removed afterwards.

import { slug } from './util.js';

export const SEED_ROOMS = [
  {
    key: 'philosophy', name: 'Philosophy', subtitle: 'Of wisdom, being and the good life', emblem: 'owl', leather: '#5b1a1a',
    collections: ['Ancient Philosophy', 'Modern Philosophy', 'Political Philosophy', 'Ethics', 'Metaphysics', 'Epistemology', 'Philosophical Notes'],
  },
  {
    key: 'literature', name: 'Literature & Classics', subtitle: 'The great works of the written word', emblem: 'quill', leather: '#1f3b2c',
    collections: ['German Literature', 'English Literature', 'Classical Literature', 'Poetry', 'Historical Fiction'],
  },
  {
    key: 'fantasy', name: 'Fantasy & Fiction', subtitle: 'Worlds that never were', emblem: 'key', leather: '#3e2338',
    collections: ['High Fantasy', 'Science Fiction', 'Myths & Legends'],
  },
  {
    key: 'science', name: 'Science & Knowledge', subtitle: 'Natural philosophy and the sciences', emblem: 'globe', leather: '#1d2a44',
    collections: ['Natural Sciences', 'Artificial Intelligence', 'Economics', 'Scientific Papers'],
  },
  {
    key: 'history', name: 'History & Politics', subtitle: 'Chronicles of peoples and states', emblem: 'column', leather: '#4b2e1a',
    collections: ['Ancient History', 'European History', 'Political Systems', 'Political Theory', 'International Relations'],
  },
  {
    key: 'university', name: 'University & Studies', subtitle: 'Lectures, papers and examinations', emblem: 'mortarboard', leather: '#23393b',
    collections: ['E-Commerce', 'Marketing', 'Research Methods', 'Business Administration', 'Private Law Studies', 'Lecture Notes', 'Scientific Papers', 'Assignments'],
  },
  {
    key: 'personal', name: 'Personal Archive', subtitle: 'Thoughts, manuscripts and private papers', emblem: 'lamp', leather: '#6b4a1c',
    collections: ['Own Thoughts', 'Manuscripts', 'Quotations', 'Summaries', 'Journals'],
  },
];

export function seedRecords(rooms) {
  const departments = [];
  const collections = [];
  rooms.forEach((r, i) => {
    const id = `dept-${r.key}`;
    departments.push({ id, name: r.name, subtitle: r.subtitle, emblem: r.emblem, leather: r.leather, order: i + 1, createdAt: 0, updatedAt: 0 });
    r.collections.forEach((name, j) => {
      collections.push({ id: `col-${r.key}-${slug(name)}`, departmentId: id, parentId: null, name, description: '', order: j + 1, createdAt: 0, updatedAt: 0 });
    });
  });
  return { departments, collections };
}
