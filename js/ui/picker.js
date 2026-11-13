// Choose shelves and collections: a sheet with one checkmark list per shelf.

import { h, fold, fromHTML } from '../util.js';
import { idx, childCollections, createCollection, createDepartment } from '../store.js';
import { openSheet, promptDialog, toast } from './modal.js';
import { icon } from './icons.js';
import { searchField } from './controls.js';

const keyOf = (t) => (t.colId ? `c:${t.colId}` : `d:${t.deptId}`);

/**
 * Resolves to [{deptId, colId}] or null.
 *  multi: several places (checkmarks) or one
 *  exclude: collection ids that cannot be chosen
 *  rootLabel: label of the shelf-level choice
 */
export function pickPlacements({ title = 'Regal wählen', subtitle = '', selected = [], multi = true, confirm = 'Fertig', exclude = [], rootLabel = 'Allgemein' } = {}) {
  return new Promise((resolve) => {
    const chosen = new Map(selected.filter((t) => t?.deptId).map((t) => [keyOf(t), { deptId: t.deptId, colId: t.colId || null }]));
    const excluded = new Set(exclude);
    let filter = '';
    const list = h('div', { class: 'picker' });

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

    const row = (t, label, depth, extra = '') =>
      h(
        'button',
        { type: 'button', class: `cell pick-row ${extra}`, style: { '--depth': depth }, role: multi ? 'checkbox' : 'radio', 'aria-checked': chosen.has(keyOf(t)) ? 'true' : 'false', onClick: () => toggle(t) },
        h('span', { class: 'cell-main' }, h('span', { class: 'cell-title' }, label)),
        h('span', { class: 'pick-check', html: chosen.has(keyOf(t)) ? icon('check') : '' }),
      );

    const matches = (txt) => !filter || fold(txt).includes(filter);

    function draw() {
      const out = [];
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
        rows.push(
          h('button', {
            type: 'button',
            class: 'cell accent',
            onClick: async () => {
              const name = await promptDialog({ title: 'Neue Sammlung', message: `In ${d.name}`, placeholder: 'Name', confirm: 'Hinzufügen' });
              if (!name) return;
              const c = await createCollection({ departmentId: d.id, name });
              toggle({ deptId: d.id, colId: c.id });
            },
          }, 'Neue Sammlung …'),
        );
        out.push(h('section', { class: 'group' }, h('h2', { class: 'group-head' }, h('span', { class: 'pick-shelf', style: { '--shelf-color': d.leather } }, d.name)), h('ul', { class: 'list' }, rows.map((r) => h('li', null, r)))));
      }
      if (!out.length) out.push(h('p', { class: 'muted', style: { textAlign: 'center' } }, 'Kein Regal mit diesem Namen.'));
      out.push(
        h('section', { class: 'group' }, h('ul', { class: 'list' }, h('li', null, h('button', {
          type: 'button',
          class: 'cell accent',
          onClick: async () => {
            const name = await promptDialog({ title: 'Neues Regal', placeholder: 'Name', confirm: 'Hinzufügen' });
            if (!name) return;
            const d = await createDepartment({ name });
            toggle({ deptId: d.id, colId: null });
            toast(`Regal „${d.name}“ angelegt`);
          },
        }, fromHTML(icon('plus')), 'Neues Regal …')))),
      );
      list.replaceChildren(...out);
      sheet?.setTitle(multi && chosen.size ? `${title} (${chosen.size})` : title);
    }

    const search = searchField({ placeholder: 'Regal oder Sammlung suchen', onInput: (v) => { filter = fold(v.trim()); draw(); } });
    let sheet = null;
    sheet = openSheet({
      title,
      subtitle,
      tall: true,
      className: 'picker-sheet',
      left: { label: 'Abbrechen', onClick: (close) => close(null) },
      right: {
        label: confirm,
        strong: true,
        onClick: (close) => {
          if (!chosen.size) {
            toast('Bitte mindestens ein Regal wählen.');
            return false;
          }
          close([...chosen.values()]);
        },
      },
      body: h('div', null, search, list),
      onClose: (r) => resolve(Array.isArray(r) ? r : null),
    });
    draw();
  });
}

export async function pickOne(opts) {
  const r = await pickPlacements({ ...opts, multi: false });
  return r ? r[0] : null;
}
