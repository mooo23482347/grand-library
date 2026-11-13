// Shelves (data: departments) and collections: create, rename, colour, reorder, delete.

import { h, fromHTML } from '../util.js';
import {
  idx, state, createDepartment, updateDepartment, deleteDepartment, createCollection, updateCollection,
  deleteCollection, relocateCollection, subtreeIds, docsUnder, childCollections, placementLabel, setCollectionOrder,
} from '../store.js';
import { LEATHERS } from '../kinds.js';
import { icon, MINUS_BADGE } from '../ui/icons.js';
import { openSheet, confirmDialog, promptDialog, toast } from '../ui/modal.js';
import { group, cell } from '../ui/controls.js';
import { pickOne } from '../ui/picker.js';
import { makeReorderable } from '../ui/reorder.js';

function colorRow(value, onPick) {
  const row = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Farbe' });
  const draw = () =>
    row.replaceChildren(
      ...LEATHERS.map((l) =>
        h('button', {
          type: 'button',
          class: `swatch ${l.hex === value ? 'on' : ''}`,
          style: { '--c': l.hex },
          role: 'radio',
          'aria-checked': l.hex === value ? 'true' : 'false',
          'aria-label': l.name,
          title: l.name,
          onClick: () => {
            value = l.hex;
            onPick(l.hex);
            draw();
          },
        }),
      ),
    );
  draw();
  return row;
}

export function newRoomDialog() {
  let color = LEATHERS[(state.departments.length + 3) % LEATHERS.length].hex;
  const name = h('input', { type: 'text', placeholder: 'z. B. Kunst & Architektur', maxlength: 60, autofocus: true, 'aria-label': 'Name' });
  openSheet({
    title: 'Neues Regal',
    left: { label: 'Abbrechen' },
    right: {
      label: 'Hinzufügen',
      strong: true,
      onClick: async (close) => {
        if (!name.value.trim()) {
          name.focus();
          return false;
        }
        const d = await createDepartment({ name: name.value.trim(), leather: color });
        close();
        toast(`Regal „${d.name}“ angelegt`);
      },
    },
    body: h('div', null, group({ rows: [h('label', { class: 'cell' }, name)] }), group({ head: 'Farbe', rows: [h('div', { class: 'cell' }, colorRow(color, (c) => (color = c)))] })),
  });
}

/** Everything about one shelf: name, colour, its collections, and deleting it. */
export function editRoomDialog(d) {
  let color = d.leather || LEATHERS[0].hex;
  const name = h('input', { type: 'text', value: d.name, maxlength: 60, 'aria-label': 'Name' });
  const colsBox = h('div');

  const drawCols = () => {
    const cols = childCollections(d.id, null);
    const list = h(
      'ul',
      { class: 'list edit-list' },
      cols.map((c) =>
        h(
          'li',
          { 'data-key': c.id },
          h(
            'div',
            { class: 'cell' },
            h('button', { type: 'button', class: 'del-btn', 'aria-label': `${c.name} entfernen`, html: MINUS_BADGE, onClick: () => deleteCollectionDialog(c).then(drawCols) }),
            h('button', { type: 'button', class: 'cell-main link', onClick: () => editCollectionDialog(c).then(drawCols) }, h('span', { class: 'cell-title' }, c.name), h('span', { class: 'cell-sub' }, `${docsUnder(c.id).size} Bücher${childCollections(d.id, c.id).length ? ` · ${childCollections(d.id, c.id).length} Unter-Sammlungen` : ''}`)),
            h('span', { class: 'grip', 'aria-label': 'Ziehen zum Umsortieren', html: icon('grip') }),
          ),
        ),
      ),
      h('li', null, cell({ title: 'Neue Sammlung', accent: true, onClick: async () => { await newCollectionDialog(d.id, null, { stay: true }); drawCols(); } })),
    );
    makeReorderable(list, { onReorder: (keys) => setCollectionOrder(keys).then(drawCols) });
    colsBox.replaceChildren(h('section', { class: 'group' }, h('h2', { class: 'group-head' }, h('span', null, 'Sammlungen')), list, h('p', { class: 'group-foot' }, 'Ziehen zum Umsortieren. Beim Entfernen einer Sammlung bleiben ihre Bücher im Regal.')));
  };
  drawCols();

  const sheet = openSheet({
    title: 'Regal bearbeiten',
    tall: true,
    left: { label: 'Abbrechen' },
    right: {
      label: 'Fertig',
      strong: true,
      onClick: async (close) => {
        if (!name.value.trim()) {
          name.focus();
          return false;
        }
        await updateDepartment(d.id, { name: name.value.trim(), leather: color });
        close();
      },
    },
    body: h(
      'div',
      null,
      group({ head: 'Name', rows: [h('label', { class: 'cell' }, name)] }),
      group({ head: 'Farbe', rows: [h('div', { class: 'cell' }, colorRow(color, (c) => (color = c)))] }),
      colsBox,
      group({ rows: [cell({ title: 'Regal löschen', danger: true, onClick: async () => { if (await deleteRoomDialog(d)) sheet.close(); } })] }),
    ),
  });
  return sheet;
}

export async function deleteRoomDialog(d) {
  const ids = idx.docsInDept.get(d.id) || new Set();
  const onlyHere = [...ids].filter((id) => (idx.asgByDoc.get(id) || []).every((a) => a.departmentId === d.id)).length;
  const ok = await confirmDialog({
    title: `„${d.name}“ löschen?`,
    message: ids.size
      ? onlyHere
        ? `Kein Buch wird gelöscht. ${onlyHere} ${onlyHere === 1 ? 'Buch steht' : 'Bücher stehen'} nur hier und ${onlyHere === 1 ? 'kommt' : 'kommen'} nach „Ohne Regal“.`
        : 'Kein Buch wird gelöscht. Alle Bücher stehen auch noch in anderen Regalen.'
      : 'Das Regal ist leer.',
    confirm: 'Löschen',
    danger: true,
  });
  if (!ok) return false;
  await deleteDepartment(d.id);
  toast(`„${d.name}“ gelöscht`);
  if (location.hash.startsWith(`#/room/${d.id}`)) location.hash = '#/';
  return true;
}

// ---------------------------------------------------------------- collections

export function newCollectionDialog(departmentId, parentId = null, { stay = false } = {}) {
  return new Promise((resolve) => {
    const where = parentId ? placementLabel({ departmentId, collectionId: parentId }) : idx.dept.get(departmentId)?.name;
    promptDialog({ title: 'Neue Sammlung', message: `In ${where}`, placeholder: 'Name', confirm: 'Hinzufügen' }).then(async (name) => {
      if (!name) return resolve(null);
      const c = await createCollection({ departmentId, parentId, name });
      if (!stay) location.hash = `#/room/${departmentId}/${c.id}`;
      resolve(c);
    });
  });
}

export async function editCollectionDialog(c) {
  const name = await promptDialog({ title: 'Sammlung umbenennen', value: c.name, confirm: 'Sichern' });
  if (name && name !== c.name) await updateCollection(c.id, { name });
}

export async function deleteCollectionDialog(c) {
  const n = docsUnder(c.id).size;
  const kids = childCollections(c.departmentId, c.id).length;
  const parent = c.parentId ? idx.col.get(c.parentId)?.name : `„Allgemein“ in ${idx.dept.get(c.departmentId)?.name}`;
  const ok = await confirmDialog({
    title: `„${c.name}“ entfernen?`,
    message: `Kein Buch wird gelöscht.${n ? ` ${n} ${n === 1 ? 'Buch kommt' : 'Bücher kommen'} nach ${parent}.` : ''}${kids ? ` ${kids} Unter-${kids === 1 ? 'Sammlung rückt' : 'Sammlungen rücken'} eine Ebene nach oben.` : ''}`,
    confirm: 'Entfernen',
    danger: true,
  });
  if (!ok) return false;
  await deleteCollection(c.id);
  toast(`„${c.name}“ entfernt`);
  if (location.hash.includes(c.id)) location.hash = c.parentId ? `#/room/${c.departmentId}/${c.parentId}` : `#/room/${c.departmentId}`;
  return true;
}

export async function relocateCollectionDialog(c) {
  const target = await pickOne({
    title: `„${c.name}“ verschieben`,
    confirm: 'Verschieben',
    exclude: subtreeIds(c.id),
    rootLabel: 'Oberste Ebene',
    selected: [{ deptId: c.departmentId, colId: c.parentId }],
  });
  if (!target) return;
  try {
    await relocateCollection(c.id, { departmentId: target.deptId, parentId: target.colId });
    toast('Sammlung verschoben');
    location.hash = `#/room/${target.deptId}/${c.id}`;
  } catch (e) {
    toast(e.message);
  }
}

export const plusIcon = () => fromHTML(icon('plus'));
