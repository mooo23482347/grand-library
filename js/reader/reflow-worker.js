// Reflow worker: turns positioned PDF text into chapters of headings, paragraphs and footnotes.
// Runs off the main thread. Input: one message per page, then 'finish'. Pure function of its input,
// so every device produces the same chapters and positions stay valid across devices.
//
// page item: [text, x, y (baseline, from the top), width, fontSize]

'use strict';

const pages = [];

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'page') pages[m.n - 1] = buildPage(m);
  else if (m.type === 'finish') {
    try {
      self.postMessage({ type: 'done', result: analyse(m) });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
  }
};

const round = (v, step = 0.5) => Math.round(v / step) * step;

// ---------------------------------------------------------------- one page → lines

function buildPage({ n, w, h, items }) {
  items.sort((a, b) => a[2] - b[2] || a[1] - b[1]);
  const rows = [];
  for (const it of items) {
    const [str, x, y, wd, size] = it;
    if (!str || size <= 0) continue;
    let row = rows[rows.length - 1];
    if (!row || Math.abs(y - row.y) > Math.max(1.5, Math.min(size, row.size) * 0.45)) {
      row = { y, size, items: [] };
      rows.push(row);
    }
    row.items.push({ str, x, x2: x + Math.max(0, wd), size });
    if (size > row.size) row.size = size;
  }
  const lines = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    // Split a row at wide gaps: those are column gutters, not word spaces.
    let frag = null;
    for (const it of row.items) {
      const gap = frag ? it.x - frag.x2 : 0;
      if (!frag || gap > Math.max(it.size, frag.size) * 1.6) {
        if (frag) lines.push(finish(frag, row.y, n));
        frag = { x: it.x, x2: it.x2, size: it.size, parts: [it.str], sizes: [[it.size, it.str.length]] };
        continue;
      }
      const last = frag.parts[frag.parts.length - 1];
      const needSpace = gap > it.size * 0.18 && !/\s$/.test(last) && !/^\s/.test(it.str);
      frag.parts.push(needSpace ? ` ${it.str}` : it.str);
      frag.x2 = Math.max(frag.x2, it.x2);
      frag.sizes.push([it.size, it.str.length]);
    }
    if (frag) lines.push(finish(frag, row.y, n));
  }
  return { n, w, h, lines: lines.filter((l) => l.text) };
}

function finish(frag, y, n) {
  // dominant size of the fragment, weighted by characters
  const tally = new Map();
  for (const [s, len] of frag.sizes) tally.set(round(s), (tally.get(round(s)) || 0) + len);
  let size = frag.size;
  let best = -1;
  for (const [s, c] of tally) if (c > best) { best = c; size = s; }
  const text = frag.parts.join('').replace(/\s+/g, ' ').trim();
  return { text, x: frag.x, x2: frag.x2, y, size, n, col: 0 };
}

// ---------------------------------------------------------------- the whole document

function analyse({ outline = [], pages: count }) {
  const all = [];
  for (let i = 0; i < count; i++) if (!pages[i]) pages[i] = { n: i + 1, w: 600, h: 800, lines: [] };

  // body size: the size most characters are set in
  const sizeTally = new Map();
  for (const p of pages) for (const l of p.lines) sizeTally.set(round(l.size), (sizeTally.get(round(l.size)) || 0) + l.text.length);
  let body = 10;
  let bestCount = -1;
  for (const [s, c] of sizeTally) if (c > bestCount) { bestCount = c; body = s; }

  let totalChars = 0;
  for (const p of pages) for (const l of p.lines) totalChars += l.text.length;
  if (totalChars < Math.max(200, count * 80)) return { v: 3, status: 'notext', pages: count, chars: totalChars, chapters: [] };

  removeRunningHeads(pages);
  for (const p of pages) orderColumns(p);

  // typical line distance and margins per page/column
  const gaps = new Map();
  for (const p of pages) {
    for (let i = 1; i < p.lines.length; i++) {
      const a = p.lines[i - 1];
      const b = p.lines[i];
      if (a.col !== b.col || Math.abs(a.size - body) > 0.6 || Math.abs(b.size - body) > 0.6) continue;
      const d = round(b.y - a.y, 0.5);
      if (d > 0 && d < body * 3) gaps.set(d, (gaps.get(d) || 0) + 1);
    }
    p.margins = margins(p, body);
  }
  let lineGap = body * 1.25;
  let gBest = -1;
  for (const [d, c] of gaps) if (c > gBest) { gBest = c; lineGap = d; }

  // heading size classes (bigger than body, used on short lines)
  const headSizes = [...new Set(pages.flatMap((p) => p.lines.filter((l) => l.size >= body * 1.18 && l.text.length < 160).map((l) => round(l.size))))].sort((a, b) => b - a).slice(0, 3);
  const levelOf = (size) => {
    const i = headSizes.findIndex((s) => Math.abs(s - round(size)) < 0.6);
    return i < 0 ? 3 : i + 1;
  };

  // ---------------- blocks
  const VERSION = 3; // keep in step with REFLOW_VERSION in reflow.js
  const blocks = [];
  let expectTitle = false; // the line after "Fünftes Kapitel" is usually the chapter's name
  const notes = [];
  let cur = null;
  let prev = null;
  let pendingCap = '';
  const flush = () => {
    if (cur && cur.x.trim()) blocks.push(cur);
    cur = null;
  };

  for (const p of pages) {
    const bodyLines = p.lines.filter((l) => Math.abs(l.size - body) < body * 0.12);
    const lowestBodyY = bodyLines.length ? Math.max(...bodyLines.map((l) => l.y)) : 0;
    let inNote = null;
    p.lines.forEach((l, i) => {
      const m = p.margins[l.col] || p.margins[0];
      const isSmall = l.size <= body * 0.88;
      // footnotes: small lines in the lower part of the page, below the body text
      if (isSmall && l.y > p.h * 0.55 && l.y >= lowestBodyY - lineGap * 0.5 && bodyLines.length > 3) {
        if (/^(\d{1,3}|[*†‡§])[\s).]/.test(l.text) || !inNote) {
          inNote = { t: 'fn', x: l.text, pg: p.n };
          notes.push(inNote);
        } else inNote.x = join(inNote.x, l.text);
        return;
      }
      const gapAbove = prev && prev.n === l.n ? l.y - prev.y : lineGap * 2;
      const next = p.lines[i + 1];
      const gapBelow = next ? next.y - l.y : lineGap * 2;
      const big = l.size >= body * 1.18 && l.text.length < 160;
      const caps = l.text.length >= 4 && l.text.length <= 70 && /[A-ZÄÖÜ]{3}/.test(l.text) && l.text === l.text.toUpperCase() && gapAbove > lineGap * 1.5 && gapBelow > lineGap * 1.2;
      const centered = Math.abs((l.x + l.x2) / 2 - (m.left + m.right) / 2) < (m.right - m.left) * 0.12 && l.x2 - l.x < (m.right - m.left) * 0.8;
      // Section headings set in the body size: numbered ("2.1 Method", "1. Die Ware", "A) …") or a short line standing alone.
      const words = l.text.split(/\s+/).length;
      const numbered = /^(\d{1,2}(\.\d{1,2}){1,3}\.?|\d{1,2}\.|[IVX]{1,5}\.|[A-Z]\))\s+[A-ZÄÖÜ]/.test(l.text) && l.text.length < 100 && !/[.,;]$/.test(l.text) && words <= 14 && l.x2 < m.right - body * 1.5;
      const standalone = gapAbove > lineGap * 1.4 && l.text.length < 70 && words <= 9 && /^[A-ZÄÖÜ]/.test(l.text) && !/[.,;:=]$/.test(l.text) && !/[=+]/.test(l.text) && (!next || gapBelow > lineGap * 1.05 || (next.x - m.left) > body * 0.8 || next.col !== l.col);
      const sub = !big && !caps && Math.abs(l.size - body) < body * 0.2 && (numbered || (standalone && !cur?.x.match(/[a-zäöü,]$/)));
      // a line of its own: not the continuation of a running sentence
      const ownLine = !cur || prev?.n !== l.n || gapAbove > lineGap * 1.3 || /[.!?:;»«"”“)\]]$/.test(cur.x);
      const kw = l.text.length <= 70 && ownLine && /^[\p{Lu}\d]/u.test(l.text) ? divisionKind(l.text) : null;

      if (big && l.text.length <= 2 && /^[a-zäöü]/.test(l.text)) {
        prev = l; // a stray lower-case glyph set large (logos, ornaments): not text
        return;
      }
      if (big && l.text.length <= 2 && /^[A-ZÄÖÜ]/.test(l.text)) {
        pendingCap = l.text; // drop cap: belongs to the next paragraph
        prev = l;
        return;
      }
      if (kw) {
        // "Fünftes Kapitel", "Zweiter Abschnitt", "Vorwort zur ersten Auflage": structure even when set in body type
        flush();
        blocks.push({ t: 'h', l: kw === 'part' ? 1 : 2, x: l.text, pg: p.n, k: kw });
        expectTitle = kw !== 'front';
        prev = l;
        return;
      }
      if (expectTitle) {
        expectTitle = false;
        const isTitle = l.text.length <= 90 && /^\p{Lu}/u.test(l.text) && !/[.,;]$/.test(l.text) && (big || centered || l.x2 < m.right - body * 3);
        if (isTitle) {
          flush();
          blocks.push({ t: 'h', l: big ? levelOf(l.size) : 2, x: l.text, pg: p.n, k: 'title' });
          prev = l;
          return;
        }
      }
      if (big || (caps && centered) || sub) {
        const level = big ? levelOf(l.size) : sub ? (/^\d{1,2}\.\d/.test(l.text) ? 4 : 3) : 3;
        const last = blocks[blocks.length - 1];
        if (!cur && last && last.t === 'h' && !last.k && last.l === level && last.pg === p.n && prev && prev.n === l.n && gapAbove < l.size * 2.2) {
          last.x = join(last.x, l.text);
        } else {
          flush();
          blocks.push({ t: 'h', l: level, x: l.text, pg: p.n });
        }
        prev = l;
        return;
      }

      const indent = l.x - m.left;
      const prevShort = prev && prev.x2 < (p.margins[prev.col] || m).right - body * 2.5;
      const endsSentence = cur && /[.!?:;»«"”“)\]]$/.test(cur.x);
      let start = !cur;
      if (!start && prev && prev.n === l.n && prev.col === l.col && gapAbove > lineGap * 1.55) start = true;
      if (!start && indent > body * 0.8 && indent < body * 8 && !centered) start = true;
      if (!start && prevShort && endsSentence) start = true;
      if (!start && prev && prev.n !== l.n && endsSentence && indent > body * 0.8) start = true;

      const text = pendingCap ? pendingCap + l.text : l.text;
      pendingCap = '';
      if (start) {
        flush();
        cur = { t: 'p', x: text, pg: p.n };
      } else cur.x = join(cur.x, text);
      prev = l;
    });
  }
  flush();

  return { v: VERSION, status: 'ok', pages: count, chars: totalChars, body, chapters: chapters(blocks, notes, outline, count) };
}

// Division headings recognised by their wording, in German, English, French, Italian and Spanish.
const NUM = '(?:\\d{1,3}|[IVXLC]{1,7})';
const DIV_CHAPTER = new RegExp(`^(?:\\p{L}+\\s+|${NUM}\\.?\\s+)?(?:kapitel|chapter|chapitre|capitolo|capítulo)(?:\\s+(?:${NUM}|\\p{L}+))?\\.?$`, 'iu');
const DIV_PART = new RegExp(`^(?:\\p{L}+\\s+|${NUM}\\.?\\s+)?(?:abschnitt|teil|buch|part|book|livre|parte)(?:\\s+(?:${NUM}|\\p{L}+))?[.:]?$`, 'iu');
const DIV_FRONT = /^(?:vorwort|vorrede|nachwort|einleitung|einführung|prolog|epilog|anhang|nachbemerkung|preface|foreword|introduction|afterword|appendix|prologue|epilogue)\b[^.,;]{0,50}$/i;
// German ordinals ("Vierundzwanzigstes"), to accept the common misprint "… Kapital" for "Kapitel"
const DE_ORDINAL = /^(?:erst|zweit|dritt|viert|fünft|sechst|sieb(?:en)?t|acht|neunt|zehnt|elft|zwölft|\p{L}+zehnt|\p{L}+zigst|\p{L}+ßigst|hundertst)e[sr]?$/iu;
function divisionKind(text) {
  const t = text.trim();
  if (t.length <= 40 && DIV_CHAPTER.test(t)) return 'ch';
  const typo = t.match(/^(\p{L}+)\s+Kapital\.?$/u);
  if (typo && DE_ORDINAL.test(typo[1])) return 'ch';
  if (t.length <= 40 && DIV_PART.test(t)) return 'part';
  if (DIV_FRONT.test(t)) return 'front';
  return null;
}

function join(a, b) {
  if (/[A-Za-zÄÖÜäöüß]-$/.test(a) && /^[a-zäöüß]/.test(b)) return a.slice(0, -1) + b; // de-hyphenate
  if (/­$/.test(a)) return a.slice(0, -1) + b;
  if (/[‐-—/]$/.test(a)) return a + b;
  return `${a} ${b}`;
}

function margins(p, body) {
  const out = {};
  for (const col of [0, 1]) {
    const ls = p.lines.filter((l) => l.col === col && Math.abs(l.size - body) < body * 0.15);
    if (!ls.length) continue;
    const xs = new Map();
    for (const l of ls) xs.set(round(l.x, 1), (xs.get(round(l.x, 1)) || 0) + 1);
    let left = ls[0].x;
    let best = -1;
    for (const [x, c] of xs) if (c > best || (c === best && x < left)) { best = c; left = x; }
    const rights = ls.map((l) => l.x2).sort((a, b) => a - b);
    out[col] = { left, right: rights[Math.floor(rights.length * 0.9)] || left + 400 };
  }
  if (!out[0]) out[0] = out[1] || { left: 0, right: p.w };
  return out;
}

/** Running heads, footers and page numbers that repeat from page to page. */
function removeRunningHeads(list) {
  const key = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/[ivxlcdm]+\b/g, '#').replace(/\s+/g, ' ').trim();
  const counts = new Map();
  for (const p of list) {
    const edge = edgeLines(p);
    const seen = new Set();
    for (const l of edge) {
      const k = key(l.text);
      if (!seen.has(k)) counts.set(k, (counts.get(k) || 0) + 1);
      seen.add(k);
    }
  }
  const limit = Math.max(3, list.length * 0.2);
  for (const p of list) {
    const edge = new Set(edgeLines(p));
    p.lines = p.lines.filter((l) => {
      if (!edge.has(l)) return true;
      if (/^[\s\-–—|]*(\d{1,4}|[ivxlcdm]{1,6})[\s\-–—|]*$/i.test(l.text)) return false;
      if (/^(seite|page|s\.)\s*\d+/i.test(l.text)) return false;
      if (list.length >= 4 && counts.get(key(l.text)) >= limit) return false;
      return true;
    });
  }
}

function edgeLines(p) {
  if (!p.lines.length) return [];
  const byY = [...p.lines].sort((a, b) => a.y - b.y);
  const top = byY.slice(0, 2).filter((l) => l.y < p.h * 0.12);
  const bottom = byY.slice(-2).filter((l) => l.y > p.h * 0.88);
  return [...top, ...bottom];
}

/** Two-column pages: read the left column, then the right one. */
function orderColumns(p) {
  const W = p.w;
  const narrow = (l) => l.x2 - l.x < W * 0.56;
  const left = p.lines.filter((l) => narrow(l) && l.x2 <= W * 0.53);
  const right = p.lines.filter((l) => narrow(l) && l.x >= W * 0.47);
  const two = left.length >= 6 && right.length >= 6 && left.length + right.length >= p.lines.length * 0.5;
  if (!two) {
    p.lines.sort((a, b) => a.y - b.y || a.x - b.x);
    return;
  }
  const L = new Set(left);
  const R = new Set(right);
  const full = p.lines.filter((l) => !L.has(l) && !R.has(l));
  const firstCol = Math.min(...[...left, ...right].map((l) => l.y));
  right.forEach((l) => (l.col = 1));
  const byY = (a, b) => a.y - b.y || a.x - b.x;
  p.lines = [...full.filter((l) => l.y < firstCol).sort(byY), ...left.sort(byY), ...right.sort(byY), ...full.filter((l) => l.y >= firstCol).sort(byY)];
}

// ---------------------------------------------------------------- chapters

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();

function chapters(blocks, notes, outline, count) {
  const firstBlockAt = (page) => {
    const i = blocks.findIndex((b) => b.pg >= page);
    return i < 0 ? blocks.length : i;
  };
  let starts = []; // [{i, title, fromOutline}]

  const flat = outline.filter((o) => o.page).sort((a, b) => a.page - b.page);
  const top = flat.filter((o) => o.depth === 0);
  const marks = top.length >= 2 ? top : flat.filter((o) => o.depth <= 1);
  if (marks.length >= 2 && marks.length <= 600) {
    for (const o of marks) {
      let i = firstBlockAt(o.page);
      const want = norm(o.title);
      for (let k = Math.max(0, i - 1); k < Math.min(blocks.length, i + 30); k++) {
        const got = norm(blocks[k].x);
        const same = want && got && (got.startsWith(want.slice(0, 24)) || want.startsWith(got.slice(0, 24)));
        if (same && (blocks[k].t === 'h' || blocks[k].x.length < 140)) {
          i = k;
          if (blocks[k].t !== 'h') blocks[k] = { ...blocks[k], t: 'h', l: 2 };
          break;
        }
      }
      if (!starts.length || i > starts[starts.length - 1].i) starts.push({ i, title: o.title, fromOutline: true });
    }
  } else if (blocks.filter((b) => b.k === 'ch').length >= 3) {
    // Chapters named in the text ("Fünftes Kapitel"), plus prefaces and afterwords. A part heading
    // and its title directly above a chapter ("Zweiter Abschnitt / Die Verwandlung …") open that chapter.
    blocks.forEach((b, i) => {
      if (b.t !== 'h' || (b.k !== 'ch' && b.k !== 'front')) return;
      let s = i;
      while (s > 0 && i - s < 3 && blocks[s - 1].t === 'h' && (blocks[s - 1].k === 'part' || blocks[s - 1].k === 'title')) s--;
      const name = blocks[i + 1]?.k === 'title' ? `${b.x} · ${blocks[i + 1].x}` : b.x;
      if (!starts.length || s > starts[starts.length - 1].i) starts.push({ i: s, title: name, fromOutline: false });
    });
  } else {
    // The highest heading level that occurs often enough, and spread widely enough, to structure the text
    // (three headings on the title page are not a structure).
    for (const lvl of [1, 2, 3]) {
      const hs = [];
      blocks.forEach((b, i) => b.t === 'h' && b.l === lvl && /\p{L}.*\p{L}.*\p{L}/u.test(b.x) && hs.push(i));
      const spread = new Set(hs.map((i) => blocks[i].pg)).size;
      if (hs.length >= 3 && hs.length <= 600 && spread >= 3) {
        starts = hs.map((i) => ({ i, title: blocks[i].x, fromOutline: false }));
        break;
      }
    }
  }
  if (starts.length < 2) {
    // No structure found: sections of about 25 pages.
    starts = [];
    const step = 25;
    for (let pg = 1; pg <= count; pg += step) {
      const i = firstBlockAt(pg);
      if (i < blocks.length && (!starts.length || i > starts[starts.length - 1].i)) starts.push({ i, title: count > step ? `Seiten ${pg}–${Math.min(count, pg + step - 1)}` : 'Text', fromOutline: false });
    }
    if (!starts.length) starts.push({ i: 0, title: 'Text', fromOutline: false });
  }
  if (starts[0].i > 0) {
    const front = blocks.slice(0, starts[0].i);
    const len = front.reduce((n, b) => n + b.x.length, 0);
    if (len > 300) starts.unshift({ i: 0, title: 'Anfang', fromOutline: false });
    else starts[0].i = 0;
  }

  let out = [];
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].i : blocks.length;
    const bl = blocks.slice(s.i, end);
    if (!bl.length) return;
    // Print the chapter title only if the text does not already open with it.
    const want = norm(s.title).replace(/\s*\.\.\.$/, '').slice(0, 28);
    const showTitle = !bl.slice(0, 8).some((b) => b.t === 'h' && want && norm(b.x).slice(0, 28) === want);
    out.push({ title: (s.title || '').trim() || `Kapitel ${out.length + 1}`, showTitle: showTitle && s.fromOutline, blocks: bl, notes: [] });
  });

  // very long chapters are split so a phone renders them smoothly
  const MAX = 90000;
  const split = [];
  for (const ch of out) {
    const len = ch.blocks.reduce((n, b) => n + b.x.length, 0);
    if (len <= MAX) {
      split.push(ch);
      continue;
    }
    let part = [];
    let size = 0;
    let n = 1;
    const push = () => {
      split.push({ title: n === 1 ? ch.title : `${ch.title} (${n})`, showTitle: n === 1 ? ch.showTitle : true, blocks: part, notes: [] });
      n++;
      part = [];
      size = 0;
    };
    for (const b of ch.blocks) {
      if (size > MAX * 0.66 && (b.t === 'h' || size > MAX)) push();
      part.push(b);
      size += b.x.length;
    }
    if (part.length) push();
  }
  out = split;

  // footnotes go to the end of the chapter their page belongs to
  for (const fn of notes) {
    let target = out[0];
    for (const ch of out) if (ch.blocks[0] && ch.blocks[0].pg <= fn.pg) target = ch;
    target?.notes.push(fn);
  }
  for (const ch of out) {
    ch.pg = ch.blocks[0]?.pg || 1;
    ch.pgEnd = ch.blocks[ch.blocks.length - 1]?.pg || ch.pg;
  }
  return out;
}
