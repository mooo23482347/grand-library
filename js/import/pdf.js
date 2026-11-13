// What a PDF can tell about itself: title, author, outline, a cover, and its text.

import { loadPdfjs } from '../deps.js';

export async function openPdf(blob) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: false }).promise;
}

function pdfYear(s) {
  const m = String(s || '').match(/(19|20)\d{2}/);
  return m ? m[0] : '';
}

const junkTitle = (t) => !t || /^(untitled|microsoft word|powerpoint|document\d*|\s*-\s*)$/i.test(t.trim()) || /\.(docx?|pptx?|pdf|tex|indd)$/i.test(t.trim()) || t.trim().length < 3;

export async function inspectPdf(blob) {
  const pdf = await openPdf(blob);
  try {
    const meta = await pdf.getMetadata().catch(() => null);
    const info = meta?.info || {};
    let title = String(info.Title || '').trim();
    let author = String(info.Author || '').trim();
    const page1 = await pdf.getPage(1);
    const vp = page1.getViewport({ scale: 1 });
    const content = await page1.getTextContent();
    const items = content.items.filter((i) => i.str && i.str.trim());
    const firstText = items.map((i) => i.str).join(' ');

    // No usable embedded title: take the largest line on the first page.
    if (junkTitle(title)) {
      const sized = items.map((i) => ({ s: i.str.trim(), size: Math.abs(i.transform[3]) || Math.abs(i.transform[0]), y: i.transform[5] }));
      const max = Math.max(0, ...sized.map((x) => x.size));
      const big = sized.filter((x) => x.size >= max * 0.92 && x.s.length > 1);
      const line = big.sort((a, b) => b.y - a.y).map((x) => x.s).join(' ').replace(/\s+/g, ' ').trim();
      if (line && line.length < 220) title = line;
    }
    // A second page helps detect DOIs and abstracts.
    let moreText = '';
    if (pdf.numPages > 1) {
      try {
        const p2 = await pdf.getPage(2);
        moreText = (await p2.getTextContent()).items.map((i) => i.str).join(' ');
      } catch {
        /* ignore */
      }
    }
    const allText = `${firstText} ${moreText}`;
    const doi = (allText.match(/\b(10\.\d{4,9}\/[^\s"<>]+[^\s"<>.,;)])/i) || [])[1] || '';

    let toc = [];
    try {
      const outline = await pdf.getOutline();
      const walk = async (items, depth) => {
        for (const it of items || []) {
          if (toc.length > 600) return;
          let page = null;
          try {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await pdf.getDestination(dest);
            if (Array.isArray(dest) && dest[0]) page = (await pdf.getPageIndex(dest[0])) + 1;
          } catch {
            /* unresolved destination */
          }
          if (page) toc.push({ label: String(it.title || '').trim() || `Page ${page}`, depth, loc: { page } });
          if (it.items?.length) await walk(it.items, depth + 1);
        }
      };
      await walk(outline, 0);
    } catch {
      toc = [];
    }

    const cover = await renderPageImage(page1, 360);
    return {
      meta: {
        title,
        author,
        description: String(info.Subject || '').trim(),
        year: pdfYear(info.CreationDate) || pdfYear(allText.slice(0, 2000)),
        keywords: String(info.Keywords || '').trim(),
        doi,
      },
      pages: pdf.numPages,
      landscape: vp.width > vp.height * 1.15,
      firstText: allText.slice(0, 6000),
      toc,
      cover,
    };
  } finally {
    pdf.destroy();
  }
}

export async function renderPageImage(page, width = 360) {
  const vp1 = page.getViewport({ scale: 1 });
  const scale = width / vp1.width;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return new Promise((r) => canvas.toBlob((b) => r(b), 'image/jpeg', 0.82));
}

/** Text of every page, for full-text search. Yields to the page between pages. */
export async function extractPdfText(blob, { onProgress, signal } = {}) {
  const pdf = await openPdf(blob);
  const parts = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      if (signal?.aborted) break;
      const page = await pdf.getPage(n);
      const tc = await page.getTextContent();
      let text = '';
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        text += it.str;
        text += it.hasEOL ? '\n' : ' ';
      }
      parts.push({ label: `Page ${n}`, loc: { page: n }, text: text.replace(/[ \t]+/g, ' ').trim() });
      page.cleanup();
      onProgress?.(n / pdf.numPages);
      if (n % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    pdf.destroy();
  }
  return parts;
}
