// Drag to reorder rows of a list: grab the handle (mouse or touch) or long-press a row (touch).

export function makeReorderable(list, { itemSelector = '[data-key]', handleSelector = '.grip', onReorder } = {}) {
  let drag = null;

  const begin = (row, y, pointerId, target) => {
    const rows = [...list.querySelectorAll(itemSelector)];
    const rects = rows.map((r) => r.getBoundingClientRect());
    drag = { row, rows, rects, startY: y, from: rows.indexOf(row), to: rows.indexOf(row), pointerId, target };
    row.classList.add('lifted');
    list.classList.add('reordering');
    navigator.vibrate?.(8);
    try {
      target.setPointerCapture?.(pointerId);
    } catch {
      /* ignore */
    }
  };

  const move = (y) => {
    if (!drag) return;
    const dy = y - drag.startY;
    drag.row.style.transform = `translateY(${dy}px)`;
    const h = drag.rects[drag.from].height;
    const center = drag.rects[drag.from].top + h / 2 + dy;
    let to = drag.from;
    drag.rects.forEach((r, i) => {
      if (i < drag.from && center < r.top + r.height / 2) to = Math.min(to, i);
      if (i > drag.from && center > r.top + r.height / 2) to = Math.max(to, i);
    });
    drag.to = to;
    drag.rows.forEach((r, i) => {
      if (r === drag.row) return;
      let shift = 0;
      if (drag.from < to && i > drag.from && i <= to) shift = -h;
      if (drag.from > to && i >= to && i < drag.from) shift = h;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };

  const end = () => {
    if (!drag) return;
    const { rows, from, to, row } = drag;
    rows.forEach((r) => (r.style.transform = ''));
    row.classList.remove('lifted');
    list.classList.remove('reordering');
    drag = null;
    if (from !== to) {
      const keys = rows.map((r) => r.dataset.key);
      const [k] = keys.splice(from, 1);
      keys.splice(to, 0, k);
      onReorder?.(keys);
    }
  };

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest(handleSelector);
    const row = e.target.closest(itemSelector);
    if (!row || !list.contains(row)) return;
    if (handle) {
      e.preventDefault();
      begin(row, e.clientY, e.pointerId, handle);
      return;
    }
    if (e.pointerType !== 'touch' || e.target.closest('button, input, a')) return;
    const startY = e.clientY;
    const timer = setTimeout(() => begin(row, startY, e.pointerId, row), 420);
    const cancel = (ev) => {
      if (ev.type === 'pointermove' && Math.abs(ev.clientY - startY) < 8) return;
      clearTimeout(timer);
      row.removeEventListener('pointermove', cancel);
      row.removeEventListener('pointerup', cancel);
    };
    row.addEventListener('pointermove', cancel);
    row.addEventListener('pointerup', cancel);
  });
  list.addEventListener('pointermove', (e) => {
    if (drag) {
      e.preventDefault();
      move(e.clientY);
    }
  });
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  list.addEventListener('touchmove', (e) => drag && e.preventDefault(), { passive: false });
}
