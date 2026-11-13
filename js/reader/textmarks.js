// Character offsets inside a chapter: the stable address of a highlight or a found passage.

import { looseRegex } from '../util.js';

/** Offset of (node, offset) counted in characters of text from the start of root. */
export function offsetOf(root, node, offset) {
  const r = document.createRange();
  r.setStart(root, 0);
  try {
    r.setEnd(node, offset);
  } catch {
    return 0;
  }
  return r.toString().length;
}

export function rangeOffsets(root, range) {
  if (!root.contains(range.commonAncestorContainer)) return null;
  const start = offsetOf(root, range.startContainer, range.startOffset);
  const end = offsetOf(root, range.endContainer, range.endOffset);
  if (end <= start) return null;
  return { start, end };
}

/** Wrap characters [start, end) in elements made by make(); works across element boundaries. */
export function wrapOffsets(root, start, end, make) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  const targets = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const len = n.data.length;
    const s = pos;
    const e = pos + len;
    if (e > start && s < end && len) targets.push([n, Math.max(0, start - s), Math.min(len, end - s)]);
    pos = e;
    if (pos >= end) break;
  }
  const made = [];
  for (const [n, a, b] of targets) {
    if (b <= a) continue;
    let node = n;
    if (b < node.data.length) node.splitText(b);
    if (a > 0) node = node.splitText(a);
    if (!node.data.trim() && targets.length > 1) continue;
    const m = make();
    node.parentNode.insertBefore(m, node);
    m.append(node);
    made.push(m);
  }
  return made;
}

export function unwrap(els) {
  const parents = new Set();
  for (const el of els) {
    if (!el.parentNode) continue;
    parents.add(el.parentNode);
    el.replaceWith(...el.childNodes);
  }
  parents.forEach((p) => p.normalize());
}

/** Find a phrase (accent- and case-insensitive) and return its offsets. */
export function findOffsets(root, phrase, near = 0) {
  const re = looseRegex(phrase);
  if (!re) return null;
  const text = root.textContent;
  let best = null;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    const cand = { start: m.index, end: m.index + m[0].length };
    if (!best || Math.abs(cand.start - near) < Math.abs(best.start - near)) best = cand;
    if (m.index > near) break;
    if (!m[0].length) re.lastIndex++;
  }
  return best;
}

/** Client rectangle of the first characters at an offset, for scrolling to it. */
export function rectAt(root, start, end = start + 1) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const len = n.data.length;
    if (pos + len > start) {
      const r = document.createRange();
      const a = start - pos;
      r.setStart(n, a);
      r.setEnd(n, Math.min(len, a + Math.max(1, end - start)));
      return r.getBoundingClientRect();
    }
    pos += len;
  }
  return null;
}
