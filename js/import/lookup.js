// Free catalogue lookups (no key, no cost). Only called when the user asks for it.

export async function lookupDoi(doi) {
  const clean = String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(clean)}`);
  if (!res.ok) throw new Error('No record found for this DOI.');
  const m = (await res.json()).message || {};
  const author = (m.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ') || a.name).filter(Boolean).join('; ');
  const year = (m.issued?.['date-parts']?.[0]?.[0] || m.published?.['date-parts']?.[0]?.[0] || '') + '';
  const desc = String(m.abstract || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    title: (m.title || [])[0] || '',
    author,
    year,
    publisher: (m['container-title'] || [])[0] || m.publisher || '',
    description: desc,
    kind: m.type === 'journal-article' ? 'paper' : m.type === 'book' ? 'book' : undefined,
  };
}
