// Sheets, alerts, menus and toasts in the manner of iOS / macOS.
//  - Phone: bottom sheets with a grabber (swipe down to close), action sheets for menus.
//  - Desktop: centred sheets, an inspector panel on the right, popover menus.

import { h, fromHTML } from '../util.js';
import { icon } from './icons.js';

const root = () => document.getElementById('layer-modal');
const stack = [];
export const isDesktop = () => matchMedia('(min-width: 900px)').matches;

function lockScroll() {
  document.documentElement.classList.toggle('modal-open', stack.length > 0);
}

function actionButton(a, close, place) {
  if (!a) return h('span');
  const b = h('button', { type: 'button', class: `btn ${place} ${a.strong ? 'strong' : ''} ${a.danger ? 'danger' : ''}`, disabled: a.disabled || null }, a.label);
  b.addEventListener('click', async () => {
    if (!a.onClick) return close();
    b.disabled = true;
    try {
      const keep = await a.onClick(close, b);
      if (keep === false) b.disabled = false;
    } catch (err) {
      b.disabled = false;
      toast(err.message || String(err));
    }
  });
  return b;
}

/**
 * openSheet({ title, subtitle, body, left, right, tall, wide, panel, onClose, dismissable })
 * left/right: { label, strong, danger, onClick(close, button) → false keeps it open }
 */
export function openSheet({ title = '', subtitle = '', body, left, right, tall = false, wide = false, panel = false, className = '', onClose, dismissable = true } = {}) {
  const prevFocus = document.activeElement;
  let closed = false;
  const api = {};
  const close = (result) => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('in');
    const i = stack.indexOf(api);
    if (i >= 0) stack.splice(i, 1);
    lockScroll();
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => wrap.remove(), 380);
    onClose?.(result);
    prevFocus?.focus?.({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && stack[stack.length - 1] === api && dismissable) {
      e.stopPropagation();
      close();
    }
  };

  const titleEl = h('div', { class: 'sheet-title' }, title);
  const head = h('header', { class: 'sheet-head' }, h('div', { class: 'left' }, actionButton(left, close, 'left')), titleEl, h('div', { class: 'right' }, right ? actionButton(right, close, 'right') : dismissable ? h('button', { type: 'button', class: 'icon-btn circle', 'aria-label': 'Schließen', html: icon('close'), onClick: () => close() }) : null));
  const bodyEl = h('div', { class: 'sheet-body' }, subtitle ? h('p', { class: 'sheet-sub' }, subtitle) : null, body);
  const grabber = h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' });
  const sheet = h('section', { class: `sheet ${tall ? 'tall' : ''} ${wide ? 'wide' : ''} ${panel ? 'panel' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' }, grabber, head, bodyEl);
  const scrim = h('div', { class: 'sheet-scrim', onClick: () => dismissable && close() });
  const wrap = h('div', { class: `sheet-wrap ${panel ? 'panel-wrap' : ''}` }, scrim, sheet);
  root().append(wrap);
  Object.assign(api, { el: sheet, body: bodyEl, close, setTitle: (t) => (titleEl.textContent = t) });
  stack.push(api);
  lockScroll();
  document.addEventListener('keydown', onKey, true);
  void sheet.offsetWidth;
  wrap.classList.add('in');

  // Swipe down to dismiss (phone).
  if (dismissable) {
    let startY = null;
    let dy = 0;
    let t0 = 0;
    const down = (e) => {
      if (isDesktop() || e.target.closest('button, input, select, textarea, a')) return;
      startY = e.clientY;
      dy = 0;
      t0 = performance.now();
      sheet.classList.add('dragging');
      e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (startY == null) return;
      dy = Math.max(0, e.clientY - startY);
      sheet.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      if (startY == null) return;
      sheet.classList.remove('dragging');
      const v = dy / Math.max(1, performance.now() - t0);
      sheet.style.transform = '';
      if (dy > 120 || v > 0.6) close();
      startY = null;
    };
    for (const el of [grabber, head]) {
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }
  }

  requestAnimationFrame(() => {
    const f = sheet.querySelector('[autofocus]');
    if (f && !matchMedia('(hover: none)').matches) f.focus();
  });
  return api;
}

/** Older call style: actions [{label, primary, danger, onClick}]. */
export function openModal({ title, subtitle, body, actions = [], wide, className, onClose, dismissable }) {
  const primary = actions.find((a) => a.primary);
  const cancel = actions.find((a) => !a.onClick && !a.primary) || actions.find((a) => /abbrechen|cancel/i.test(a.label));
  const extra = actions.filter((a) => a !== primary && a !== cancel);
  const extraEl = extra.length
    ? h('div', { class: 'sheet-extra' }, extra.map((a) => h('button', { type: 'button', class: `btn block gray ${a.danger ? 'danger' : ''}`, onClick: async (e) => { const keep = await a.onClick?.(api.close, e.currentTarget); if (keep !== false && !a.keepOpen) {/* the action decides */} } }, a.label)))
    : null;
  const api = openSheet({
    title,
    subtitle,
    body: h('div', null, body, extraEl),
    left: cancel ? { label: cancel.label, onClick: cancel.onClick } : { label: 'Abbrechen' },
    right: primary ? { label: primary.label, strong: true, danger: primary.danger, onClick: primary.onClick } : null,
    wide,
    className,
    onClose,
    dismissable,
  });
  return api;
}

// ---------------------------------------------------------------- alerts

function alertBox({ title, message, buttons, input, check }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const inputEl = input ? h('input', { type: input.type || 'text', value: input.value || '', placeholder: input.placeholder || '', 'aria-label': title }) : null;
    const checkEl = check ? h('input', { type: 'checkbox', checked: check.checked }) : null;
    const done = (value) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.({ preventScroll: true });
      resolve({ value, text: inputEl?.value ?? null, checked: checkEl?.checked ?? null });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(null);
      }
      if (e.key === 'Enter' && inputEl && document.activeElement === inputEl) {
        e.preventDefault();
        const primary = buttons.find((b) => b.primary);
        if (primary) done(primary.value);
      }
    };
    const actions = h(
      'div',
      { class: `alert-actions ${buttons.length > 2 ? 'stacked' : ''}` },
      buttons.map((b) => h('button', { type: 'button', class: `${b.primary ? 'primary' : ''} ${b.destructive ? 'destructive' : ''}`, onClick: () => done(b.value) }, b.label)),
    );
    const wrap = h(
      'div',
      { class: 'alert-wrap', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
      h(
        'div',
        { class: 'alert' },
        h('div', { class: 'alert-text' }, h('div', { class: 'alert-title' }, title), message ? h('div', { class: 'alert-msg' }, message) : null, inputEl, checkEl ? h('label', { class: 'check' }, checkEl, check.label) : null),
        actions,
      ),
    );
    document.body.append(wrap);
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => (inputEl || actions.querySelector('.primary') || actions.lastElementChild)?.focus());
  });
}

export async function confirmDialog({ title, message, confirm = 'OK', cancel = 'Abbrechen', danger = false, check }) {
  const r = await alertBox({
    title,
    message,
    check,
    buttons: [
      { label: cancel, value: false },
      { label: confirm, value: true, primary: !danger, destructive: danger },
    ],
  });
  return check ? { ok: r.value === true, checked: r.checked } : r.value === true;
}

export async function promptDialog({ title, label, message, value = '', placeholder = '', confirm = 'Sichern' }) {
  const r = await alertBox({
    title,
    message: message || label,
    input: { value, placeholder },
    buttons: [
      { label: 'Abbrechen', value: false },
      { label: confirm, value: true, primary: true },
    ],
  });
  const v = r.value ? (r.text || '').trim() : '';
  return v || null;
}

export function alertMessage(title, message) {
  return alertBox({ title, message, buttons: [{ label: 'OK', value: true, primary: true }] });
}

// ---------------------------------------------------------------- menus

let openMenuEl = null;
export function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
}

/** items: [{label, icon, onClick, danger, disabled, hint}] | '-' | {heading} */
export function showMenu(anchor, items, { title } = {}) {
  closeMenu();
  const clean = items.filter(Boolean);
  const pick = (it) => {
    closeMenu();
    it.onClick?.();
  };
  const itemEl = (it) =>
    h(
      'button',
      { type: 'button', role: 'menuitem', class: `menu-item ${it.danger ? 'danger' : ''}`, disabled: it.disabled || null, onClick: () => pick(it) },
      h('span', null, it.label),
      it.hint ? h('span', { class: 'hint' }, it.hint) : null,
      it.icon ? fromHTML(icon(it.icon)) : null,
    );

  let wrap;
  if (!isDesktop()) {
    const groups = [[]];
    for (const it of clean) {
      if (it === '-') groups.push([]);
      else if (!it.heading) groups[groups.length - 1].push(it);
    }
    wrap = h(
      'div',
      { class: 'menu-wrap', role: 'menu' },
      h('div', { class: 'sheet-scrim', style: { opacity: 1 }, onClick: closeMenu }),
      h(
        'div',
        { class: 'action-sheet' },
        h('div', { class: 'action-group' }, title ? h('div', { class: 'action-title' }, title) : null, groups.flat().map(itemEl)),
        h('div', { class: 'action-group' }, h('button', { type: 'button', class: 'menu-item cancel', onClick: closeMenu }, 'Abbrechen')),
      ),
    );
  } else {
    const menu = h(
      'div',
      { class: 'menu', role: 'menu' },
      clean.map((it) => (it === '-' ? h('div', { class: 'menu-rule' }) : it.heading ? h('div', { class: 'menu-heading' }, it.heading) : itemEl(it))),
    );
    wrap = h('div', { class: 'menu-wrap', onClick: (e) => e.target === wrap && closeMenu() }, menu);
    document.body.append(wrap);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = Math.min(r.right - mw, innerWidth - mw - 8);
    left = Math.max(8, left);
    let top = r.bottom + 6;
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }
  if (!wrap.isConnected) document.body.append(wrap);
  openMenuEl = wrap;
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeMenu();
      document.removeEventListener('keydown', onKey, true);
    }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.querySelector('.menu-item:not([disabled])')?.focus({ preventScroll: true });
  return wrap;
}

// ---------------------------------------------------------------- toasts

export function toast(message, { action, timeout = 3200 } = {}) {
  const layer = document.getElementById('layer-toast');
  const el = h(
    'div',
    { class: 'toast', role: 'status' },
    h('span', null, message),
    action ? h('button', { type: 'button', class: 'toast-action', onClick: () => { action.onClick(); dismiss(); } }, action.label) : null,
  );
  const dismiss = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 230);
  };
  layer.append(el);
  while (layer.children.length > 2) layer.firstElementChild.remove();
  if (timeout) setTimeout(dismiss, action ? timeout + 2500 : timeout);
  return dismiss;
}
