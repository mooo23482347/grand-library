// Third-party libraries, loaded from jsDelivr with pinned versions.
// The service worker caches them, so the library keeps working offline after the first visit.
// Dexie is imported statically in db.js (same version as listed here).

export const CDN = {
  dexie: 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm',
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm',
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
  supabase: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm',
};

let pdfP = null;
let zipP = null;
let supaP = null;

export function loadPdfjs() {
  if (!pdfP) {
    pdfP = import(CDN.pdfjs).then((m) => {
      m.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
      return m;
    });
  }
  return pdfP;
}

export function loadJSZip() {
  if (!zipP) zipP = import(CDN.jszip).then((m) => m.default || m.JSZip || m);
  return zipP;
}

export function loadSupabase() {
  if (!supaP) supaP = import(CDN.supabase);
  return supaP;
}
