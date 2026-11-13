// Dialogs for furnishing rooms and collections.

import { h, fromHTML } from '../util.js';
import {
  idx, state, createDepartment, updateDepartment, deleteDepartment, createCollection, updateCollection,
  deleteCollection, relocateCollection, subtreeIds, docsUnder, childCollections, placementLabel,
} from '../store.js';
import { LEATHERS, EMBLEMS } from '../kinds.js';
import { emblem } from '../ui/icons.js';
import { openModal, confirmDialog, toast } from '../ui/modal.js';
import { pickOne } from '../ui/picker.js';

function roomForm(d = {}) {
  let chosenEmblem = d.emblem || 'book';
  let chosenLeather = d.leather || LEATHERS[0].hex;
  const name = h('input', { class: 'field-input', type: 'text', value: d.name || '', placeholder: 'e.g. Art & Architecture', maxlength: 60 });
  const subtitle = h('input', { class: 'field-input', type: 'text', value: d.subtitle || '', placeholder: 'A line engraved beneath the name', maxlength: 90 });

  const emblems = h('div', { class: 'emblem-grid', role: 'radiogroup', 'aria-label': 'Emblem' });
  const drawEmblems = () =>
    emblems.replaceChildren(
      ...EMBLEMS.map((e) =>
        h('button', {
          type: 'button',
          class: `emblem-choice ${e === chosenEmblem ? 'on' : ''}`,
          role: 'radio',
          'aria-checked': e === chosenEmblem ? 'true' : 'false',
          'aria-label': e,
          title: e,
          html: emblem(e),
          onClick: () => {
            chosenEmblem = e;
            drawEmblems();
          },
        }),
      ),
    );
  drawEmblems();

  const leathers = h('div', { class: 'swatch-row', role: 'radiogroup', 'aria-label': 'Leather' });
  const drawLeathers = () =>
    leathers.replaceChildren(
      ...LEATHERS.map((l) =>
        h('button', {
          type: 'button',
          class: `swatch ${l.hex === chosenLeather ? 'on' : ''}`,
          style: { '--c': l.hex },
          role: 'radio',
          'aria-checked': l.hex === chosenLeather ? 'true' : 'false',
          'aria-label': l.name,
          title: l.name,
          onClick: () => {
            chosenLeather = l.hex;
            drawLeathers();
          },
        }),
      ),
    );
  drawLeathers();

  const body = h(
    'div',
    { class: 'form-grid' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name on the brass plate'), name),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Engraved motto'), subtitle),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Emblem on the keystone'), emblems),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Leather of the room'), leathers),
  );
  return { body, values: () => ({ name: name.value.trim(), subtitle: subtitle.value.trim(), emblem: chosenEmblem, leather: chosenLeather }), name };
}

export function newRoomDialog() {
  const f = roomForm({ leather: LEATHERS[(state.departments.length + 3) % LEATHERS.length].hex });
  openModal({
    title: 'Open a new room',
    subtitle: 'A new wing of the library with its own shelves and collections.',
    body: f.body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Open the room',
        primary: true,
        onClick: async (close) => {
          const v = f.values();
          if (!v.name) {
            f.name.focus();
            return false;
          }
          const d = await createDepartment(v);
          close();
          location.hash = `#/room/${d.id}`;
        },
      },
    ],
  });
}

export function editRoomDialog(d) {
  const f = roomForm(d);
  openModal({
    title: `Edit ${d.name}`,
    body: f.body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save',
        primary: true,
        onClick: async (close) => {
          const v = f.values();
          if (!v.name) {
            f.name.focus();
            return false;
          }
          await updateDepartment(d.id, v);
          close();
        },
      },
    ],
  });
}

export async function deleteRoomDialog(d) {
  const ids = idx.docsInDept.get(d.id) || new Set();
  const onlyHere = [...ids].filter((id) => (idx.asgByDoc.get(id) || []).every((a) => a.departmentId === d.id)).length;
  const cols = idx.colCount.get(d.id) || 0;
  const ok = await confirmDialog({
    title: `Close the room “${d.name}”?`,
    message: h(
      'div',
      null,
      h('p', { class: 'modal-text' }, `The room and its ${cols} ${cols === 1 ? 'collection' : 'collections'} will be removed. No volume is deleted.`),
      ids.size
        ? h(
            'p',
            { class: 'modal-text' },
            onlyHere
              ? `${onlyHere} ${onlyHere === 1 ? 'volume stands' : 'volumes stand'} only here and will wait on the returns table to be shelved again.`
              : 'All of its volumes also stand in other rooms and stay there.',
          )
        : null,
    ),
    confirm: 'Close the room',
    danger: true,
  });
  if (!ok) return;
  await deleteDepartment(d.id);
  toast(`“${d.name}” is closed.`);
  if (location.hash.startsWith(`#/room/${d.id}`)) location.hash = '#/';
}

// ---------------------------------------------------------------- collections

function collectionForm(c = {}) {
  const name = h('input', { class: 'field-input', type: 'text', value: c.name || '', placeholder: 'e.g. Stoicism', maxlength: 80 });
  const desc = h('textarea', { class: 'field-input', rows: 3, placeholder: 'What belongs on this shelf (optional)' }, c.description || '');
  return {
    body: h(
      'div',
      { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Description'), desc),
    ),
    values: () => ({ name: name.value.trim(), description: desc.value.trim() }),
    name,
  };
}

export function newCollectionDialog(departmentId, parentId = null) {
  const f = collectionForm();
  const where = parentId ? placementLabel({ departmentId, collectionId: parentId }) : idx.dept.get(departmentId)?.name;
  openModal({
    title: parentId ? 'New sub-collection' : 'New collection',
    subtitle: `In ${where}`,
    body: f.body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Create',
        primary: true,
        onClick: async (close) => {
          const v = f.values();
          if (!v.name) {
            f.name.focus();
            return false;
          }
          const c = await createCollection({ departmentId, parentId, ...v });
          close();
          location.hash = `#/room/${departmentId}/${c.id}`;
        },
      },
    ],
  });
}

export function editCollectionDialog(c) {
  const f = collectionForm(c);
  openModal({
    title: `Edit ${c.name}`,
    body: f.body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save',
        primary: true,
        onClick: async (close) => {
          const v = f.values();
          if (!v.name) {
            f.name.focus();
            return false;
          }
          await updateCollection(c.id, v);
          close();
        },
      },
    ],
  });
}

export async function deleteCollectionDialog(c) {
  const n = docsUnder(c.id).size;
  const kids = childCollections(c.departmentId, c.id).length;
  const parent = c.parentId ? idx.col.get(c.parentId)?.name : `the general shelf of ${idx.dept.get(c.departmentId)?.name}`;
  const ok = await confirmDialog({
    title: `Remove the collection “${c.name}”?`,
    message: h(
      'p',
      { class: 'modal-text' },
      `No volume is deleted. ${n ? `Its ${n} ${n === 1 ? 'volume moves' : 'volumes move'} to ${parent}` : 'It holds no volumes'}${kids ? `, and its ${kids} sub-${kids === 1 ? 'collection moves' : 'collections move'} up one level` : ''}.`,
    ),
    confirm: 'Remove collection',
    danger: true,
  });
  if (!ok) return;
  await deleteCollection(c.id);
  toast(`“${c.name}” has been removed.`);
  location.hash = c.parentId ? `#/room/${c.departmentId}/${c.parentId}` : `#/room/${c.departmentId}`;
}

export async function relocateCollectionDialog(c) {
  const target = await pickOne({
    title: `Move “${c.name}” to…`,
    subtitle: 'The collection keeps all its volumes and sub-collections.',
    confirm: 'Move collection',
    exclude: subtreeIds(c.id),
    rootLabel: 'Top level of the room',
    selected: [{ deptId: c.departmentId, colId: c.parentId }],
  });
  if (!target) return;
  try {
    await relocateCollection(c.id, { departmentId: target.deptId, parentId: target.colId });
    toast(`“${c.name}” now stands in ${target.colId ? placementLabel({ departmentId: target.deptId, collectionId: target.colId }) : idx.dept.get(target.deptId).name}.`);
    location.hash = `#/room/${target.deptId}/${c.id}`;
  } catch (e) {
    toast(e.message, { kind: 'error' });
  }
}

export const emblemSvg = (name) => fromHTML(emblem(name));
