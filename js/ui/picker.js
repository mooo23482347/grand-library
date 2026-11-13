// "Where should this stand?" — a directory of every room and collection to choose shelves from.

import { h, fold, fromHTML } from '../util.js';
import { idx, childCollections, createCollection, createDepartment } from '../store.js';
import { openModal, promptDialog, toast } from './modal.js';
import { emblem, icon } from './icons.js';

const keyOf = (t) => (t.colId ? `c:${t.colId}` : `d:${t.deptId}`);

/**
 * Pick shelves. Resolves to an array of {deptId, colId} or null if cancelled.
 *  multi       several places at once (checkboxes) or a single one (radio)
 *  exclude     collection ids that may not be chosen (e.g. a subtree when re-hanging a collection)
 *  rootLabel   label of the room-level choice ("General shelf", "Top level of the room")
 */
export function pickPlacements({
  title = 'Shelve in…',
  subtitle = 'A volume can stand in several places. It is kept only once.',
  selected = [],
  multi = true,
  confirm = 'Shelve here',
  exclude = [],
  rootLabel = 'General shelf',
} = {}) {
  return new Promise((resolve) => {
    const chosen = new Map(selected.filter((t) => t?.deptId).map((t) => [keyOf(t), { deptId: t.deptId, colId: t.colId || null }]));
    const excluded = new Set(exclude);
    let filter = '';

    const filterInput = h('input', { class: 'field-input picker-filter', type: 'search', placeholder: 'Find a room or collection…', 'aria-label': 'Filter rooms and collections' });
    const list = h('div', { class: 'picker-list', role: multi ? 'group' : 'radiogroup' });
    const summary = h('p', { class: 'picker-summary' });

    const toggle = (t) => {
      const k = keyOf(t);
      if (multi) {
        if (chosen.has(k)) chosen.delete(k);
        else chosen.set(k, t);
      } else {
        chosen.clear();
        chosen.set(k, t);
      }
      draw();
    };

    const row = (t, label, depth, extraClass = '') => {
      const k = keyOf(t);
      const on = chosen.has(k);
      return h(
        'button',
        {
          type: 'button',
          class: `picker-row ${on ? 'on' : ''} ${extraClass}`,
          style: { '--depth': depth },
          role: multi ? 'checkbox' : 'radio',
          'aria-checked': on ? 'true' : 'false',
          onClick: () => toggle(t),
        },
        h('span', { class: `picker-box ${multi ? '' : 'round'}` }, on ? fromHTML(icon('check')) : null),
        h('span', { class: 'picker-label' }, label),
      );
    };

    const matches = (txt) => !filter || fold(txt).includes(filter);

    function draw() {
      list.replaceChildren();
      for (const d of idx.depts) {
        const rows = [];
        const walk = (parentId, depth, trail) => {
          for (const c of childCollections(d.id, parentId)) {
            if (excluded.has(c.id)) continue;
            const t2 = `${trail} ${c.name}`;
            if (matches(t2)) rows.push(row({ deptId: d.id, colId: c.id }, c.name, depth));
            walk(c.id, depth + 1, t2);
          }
        };
        if (matches(d.name) || matches(rootLabel)) rows.push(row({ deptId: d.id, colId: null }, rootLabel, 0, 'root'));
        walk(null, 0, d.name);
        if (!rows.length) continue;
        list.append(
          h(
            'section',
            { class: 'picker-room', style: { '--leather': d.leather } },
            h('header', { class: 'picker-room-head' }, fromHTML(emblem(d.emblem)), h('span', null, d.name)),
            rows,
            h(
              'button',
              {
                type: 'button',
                class: 'picker-new',
                onClick: async () => {
                  const name = await promptDialog({ title: `New collection in ${d.name}`, label: 'Name of the collection', confirm: 'Create' });
                  if (!name) return;
                  const c = await createCollection({ departmentId: d.id, name });
                  toggle({ deptId: d.id, colId: c.id });
                },
              },
              fromHTML(icon('plus')),
              'New collection',
            ),
          ),
        );
      }
      if (!list.children.length) list.append(h('p', { class: 'muted picker-empty' }, 'No room or collection by that name.'));
      const n = chosen.size;
      summary.textContent = n ? `${n} ${n === 1 ? 'place' : 'places'} chosen` : 'Nothing chosen yet';
    }

    filterInput.addEventListener('input', () => {
      filter = fold(filterInput.value.trim());
      draw();
    });
    draw();

    openModal({
      title,
      subtitle,
      className: 'picker-modal',
      body: h('div', { class: 'picker' }, filterInput, list, summary),
      actions: [
        {
          label: 'New room',
          className: 'btn-left',
          onClick: async () => {
            const name = await promptDialog({ title: 'Open a new room', label: 'Name of the room', confirm: 'Open room' });
            if (name) {
              const d = await createDepartment({ name });
              toggle({ deptId: d.id, colId: null });
              toast(`The room “${d.name}” has been opened.`);
            }
            return false;
          },
        },
        { label: 'Cancel', onClick: (close) => close(null) },
        {
          label: confirm,
          primary: true,
          onClick: (close) => {
            if (!chosen.size) {
              toast('Choose at least one shelf.');
              return false;
            }
            close([...chosen.values()]);
          },
        },
      ],
      onClose: (r) => resolve(Array.isArray(r) ? r : null),
    });
  });
}

export async function pickOne(opts) {
  const r = await pickPlacements({ ...opts, multi: false });
  return r ? r[0] : null;
}
