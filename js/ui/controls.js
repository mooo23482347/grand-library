// iOS-style building blocks: nav bar with large title, grouped lists, segmented control, switch, stepper.

import { h, fromHTML } from '../util.js';
import { icon } from './icons.js';

/** Navigation bar + large title. The small title fades in once the large one scrolls away. */
export function pageHeader({ title, back, left = [], actions = [], sub } = {}) {
  const leftEl = h(
    'div',
    { class: 'nav-left' },
    back ? h('a', { class: 'nav-back', href: back.href, onClick: back.onClick || null }, fromHTML(icon('back')), h('span', null, back.label)) : null,
    left,
  );
  const nav = h('header', { class: 'navbar' }, leftEl, h('div', { class: 'nav-title', 'aria-hidden': 'true' }, title), h('div', { class: 'nav-right' }, actions));
  const large = h('h1', { class: 'large-title' }, title);
  return [nav, large, sub ? h('p', { class: 'large-sub' }, sub) : null];
}

/** Watch large titles so their nav bar turns compact while scrolling. */
let io = null;
export function watchLargeTitles(root) {
  io?.disconnect();
  const title = root.querySelector('.large-title');
  const nav = root.querySelector('.navbar');
  if (!title || !nav) return;
  io = new IntersectionObserver(
    ([e]) => nav.classList.toggle('compact', !e.isIntersecting),
    { rootMargin: `-${nav.offsetHeight || 56}px 0px 0px 0px`, threshold: 0 },
  );
  io.observe(title);
}

export function navButton(label, onClick, { strong = false, icon: ic, aria } = {}) {
  if (ic) return h('button', { type: 'button', class: 'icon-btn', 'aria-label': aria || label, title: aria || label, html: icon(ic), onClick });
  return h('button', { type: 'button', class: `btn ${strong ? 'strong' : ''}`, onClick }, label);
}

/** Inset grouped list. rows: nodes from cell() or anything. */
export function group({ head, headAction, foot, rows, icons = false, className = '' } = {}) {
  const items = rows.flat().filter(Boolean);
  return h(
    'section',
    { class: `group ${className}` },
    head || headAction ? h('h2', { class: 'group-head' }, h('span', null, head || ''), headAction || null) : null,
    h('ul', { class: `list ${icons ? 'has-icons' : ''}` }, items.map((r) => h('li', null, r))),
    foot ? h('p', { class: 'group-foot' }, foot) : null,
  );
}

/**
 * One row. { title, sub, detail, icon, tint, href, onClick, chevron, accessory, danger, accent, className }
 */
export function cell({ title, sub, detail, icon: ic, tint, href, onClick, chevron, accessory, danger, accent, className = '', wrap = false, attrs = {} } = {}) {
  const tag = href ? 'a' : onClick ? 'button' : 'div';
  const props = { class: `cell ${danger ? 'danger' : ''} ${accent ? 'accent' : ''} ${className}`, ...attrs };
  if (href) props.href = href;
  if (onClick) {
    props.onClick = onClick;
    if (tag === 'button') props.type = 'button';
  }
  return h(
    tag,
    props,
    ic ? h('span', { class: 'cell-icon', style: tint ? { '--tint': tint } : null, html: icon(ic) }) : null,
    danger || accent
      ? title
      : h('span', { class: 'cell-main' }, h('span', { class: `cell-title ${wrap ? 'wrap' : ''}` }, title), sub ? h('span', { class: 'cell-sub' }, sub) : null),
    detail != null && detail !== '' ? h('span', { class: 'cell-detail' }, detail) : null,
    accessory || null,
    chevron || (href && chevron !== false) ? fromHTML(icon('next', 'cell-chevron')) : null,
  );
}

/** A row with a switch. */
export function switchCell({ title, sub, checked, onChange, icon: ic, tint }) {
  const input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked, 'aria-label': title });
  input.addEventListener('change', () => onChange(input.checked));
  return h(
    'label',
    { class: 'cell' },
    ic ? h('span', { class: 'cell-icon', style: tint ? { '--tint': tint } : null, html: icon(ic) }) : null,
    h('span', { class: 'cell-main' }, h('span', { class: 'cell-title' }, title), sub ? h('span', { class: 'cell-sub' }, sub) : null),
    input,
  );
}

/** Segmented control. options: [{value, label}] */
export function segmented(options, value, onChange, { full = false, label } = {}) {
  const thumb = h('span', { class: 'thumb', 'aria-hidden': 'true' });
  const el = h('div', { class: `segmented ${full ? 'full' : ''}`, role: 'group', 'aria-label': label || null }, thumb);
  const buttons = options.map((o) =>
    h('button', {
      type: 'button',
      'aria-pressed': o.value === value ? 'true' : 'false',
      onClick: () => {
        if (o.value === value) return;
        value = o.value;
        place();
        onChange(o.value);
      },
    }, o.label),
  );
  el.append(...buttons);
  const place = () => {
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    buttons.forEach((b, j) => b.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
    const b = buttons[i];
    if (!b.offsetWidth) return;
    thumb.style.width = `${b.offsetWidth}px`;
    thumb.style.transform = `translateX(${b.offsetLeft - 2}px)`;
  };
  requestAnimationFrame(place);
  new ResizeObserver(place).observe(el);
  el.setValue = (v) => {
    value = v;
    place();
  };
  return el;
}

export function stepper(value, { min = 0, max = 100, step = 1, format = (v) => String(v), label = '' } = {}, onChange) {
  const out = h('span', { class: 'value', 'aria-live': 'polite' }, format(value));
  const set = (v) => {
    v = Math.min(max, Math.max(min, +v.toFixed(3)));
    if (v === value) return;
    value = v;
    out.textContent = format(v);
    onChange(v);
  };
  return h(
    'span',
    { class: 'stepper', role: 'group', 'aria-label': label },
    h('button', { type: 'button', 'aria-label': `${label} verringern`, html: icon('minus'), onClick: () => set(value - step) }),
    out,
    h('button', { type: 'button', 'aria-label': `${label} erhöhen`, html: icon('plus'), onClick: () => set(value + step) }),
  );
}

export function searchField({ placeholder = 'Suchen', value = '', onInput, onFocus, onEnter, fk } = {}) {
  const input = h('input', { type: 'search', placeholder, value, 'aria-label': placeholder, enterkeyhint: 'search', autocomplete: 'off', 'data-fk': fk || null });
  if (onInput) input.addEventListener('input', () => onInput(input.value));
  if (onFocus) input.addEventListener('focus', onFocus);
  if (onEnter) input.addEventListener('keydown', (e) => e.key === 'Enter' && onEnter(input.value));
  return h('label', { class: 'search-field' }, fromHTML(icon('search')), input);
}

export function emptyState({ icon: ic = 'book', title, text, action }) {
  return h('div', { class: 'empty' }, fromHTML(icon(ic)), h('div', { class: 'empty-title' }, title), text ? h('p', null, text) : null, action || null);
}
