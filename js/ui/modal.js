// Dialogs, menus and notices, styled as parchment cards in walnut frames.

import { h, fromHTML } from '../util.js';
import { icon } from './icons.js';

const modalRoot = () => document.getElementById('layer-modal');
const stack = [];

export function openModal({ title, subtitle, body, actions = [], wide = false, className = '', onClose, dismissable = true } = {}) {
  const prevFocus = document.activeElement;
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    wrap.classList.add('closing');
    const i = stack.indexOf(api);
    if (i >= 0) stack.splice(i, 1);
    setTimeout(() => wrap.remove(), 160);
    document.removeEventListener('keydown', onKey, true);
    if (!stack.length) document.documentElement.classList.remove('modal-open');
    onClose?.(result);
    prevFocus?.focus?.({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && stack[stack.length - 1] === api && dismissable) {
      e.stopPropagation();
      close();
    }
  };

  const footer = actions.length
    ? h(
        'footer',
        { class: 'modal-actions' },
        actions.map((a) => {
          const b = h('button', { type: 'button', class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''} ${a.className || ''}` }, a.label);
          b.addEventListener('click', async () => {
            if (a.onClick) {
              b.disabled = true;
              try {
                const keep = await a.onClick(close, b);
                if (keep === false) b.disabled = false;
              } catch (err) {
                b.disabled = false;
                toast(err.message || String(err), { kind: 'error' });
              }
            } else close();
          });
          return b;
        }),
      )
    : null;

  const card = h(
    'div',
    { class: `modal ${wide ? 'modal-wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
    h(
      'header',
      { class: 'modal-head' },
      h('div', { class: 'modal-titles' }, title ? h('h2', { class: 'modal-title' }, title) : null, subtitle ? h('p', { class: 'modal-sub' }, subtitle) : null),
      dismissable ? h('button', { type: 'button', class: 'icon-btn modal-x', 'aria-label': 'Close', html: icon('close'), onClick: () => close() }) : null,
    ),
    h('div', { class: 'modal-body' }, body),
    footer,
  );
  const wrap = h('div', { class: 'modal-wrap' }, h('div', { class: 'modal-backdrop', onClick: () => dismissable && close() }), card);
  modalRoot().append(wrap);
  document.documentElement.classList.add('modal-open');
  document.addEventListener('keydown', onKey, true);
  const api = { el: card, close };
  stack.push(api);
  requestAnimationFrame(() => {
    const f = card.querySelector('[autofocus], input:not([type=checkbox]):not([type=radio]), textarea, select');
    if (f && !matchMedia('(hover: none)').matches) f.focus();
    else card.querySelector('.modal-x')?.focus({ preventScroll: true });
  });
  return api;
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false, cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: typeof message === 'string' ? h('p', { class: 'modal-text' }, message) : message,
      actions: [
        { label: cancel, onClick: (close) => close(false) },
        { label: confirm, primary: !danger, danger, onClick: (close) => close(true) },
      ],
      onClose: (r) => resolve(r === true),
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', confirm = 'Save', multiline = false }) {
  return new Promise((resolve) => {
    const input = multiline
      ? h('textarea', { class: 'field-input', rows: 4, placeholder }, value)
      : h('input', { class: 'field-input', type: 'text', value, placeholder });
    const submit = (close) => {
      const v = input.value.trim();
      if (!v) {
        input.focus();
        return false;
      }
      close(v);
    };
    const m = openModal({
      title,
      body: h('label', { class: 'field' }, label ? h('span', { class: 'field-label' }, label) : null, input),
      actions: [
        { label: 'Cancel', onClick: (close) => close(null) },
        { label: confirm, primary: true, onClick: submit },
      ],
      onClose: (r) => resolve(typeof r === 'string' ? r : null),
    });
    if (!multiline)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit(m.close);
        }
      });
  });
}

// ---------------------------------------------------------------- menus

let openMenu = null;

export function closeMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', menuKey, true);
  }
}
function outside(e) {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
}
function menuKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeMenu();
  }
}

/** items: [{label, icon, onClick, danger, disabled, hint}] or '-' for a rule, or {heading} */
export function showMenu(anchor, items, { align = 'end' } = {}) {
  closeMenu();
  const el = h(
    'div',
    { class: 'menu', role: 'menu' },
    items.map((it) => {
      if (it === '-') return h('hr', { class: 'menu-rule' });
      if (it.heading) return h('div', { class: 'menu-heading' }, it.heading);
      const b = h(
        'button',
        { type: 'button', role: 'menuitem', class: `menu-item ${it.danger ? 'danger' : ''}`, disabled: it.disabled || null },
        it.icon ? fromHTML(icon(it.icon)) : h('span', { class: 'menu-gap' }),
        h('span', { class: 'menu-label' }, it.label),
        it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null,
      );
      b.addEventListener('click', () => {
        closeMenu();
        it.onClick?.();
      });
      return b;
    }),
  );
  document.body.append(el);
  openMenu = el;
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth;
  const mh = el.offsetHeight;
  let left = align === 'end' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  let top = r.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', menuKey, true);
  });
  el.querySelector('.menu-item:not([disabled])')?.focus({ preventScroll: true });
  return el;
}

// ---------------------------------------------------------------- notices

export function toast(message, { kind = 'info', action, timeout = 4200 } = {}) {
  const root = document.getElementById('layer-toast');
  const el = h(
    'div',
    { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-text' }, message),
    action ? h('button', { type: 'button', class: 'toast-action', onClick: () => { action.onClick(); dismiss(); } }, action.label) : null,
  );
  const dismiss = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  };
  root.append(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  if (timeout) setTimeout(dismiss, action ? timeout + 2500 : timeout);
  return dismiss;
}
