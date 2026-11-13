// Light / dark / automatic, per device. Also keeps the browser's theme-color in step.

const KEY = 'buecher.theme';
const media = matchMedia('(prefers-color-scheme: dark)');

export function getTheme() {
  try {
    return localStorage.getItem(KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

export function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : media.matches;
}

export function applyTheme(mode = getTheme()) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
  paintThemeColor();
}

export function paintThemeColor(color) {
  const c = color || getComputedStyle(document.documentElement).getPropertyValue('--bar-solid').trim() || (isDark() ? '#1b1511' : '#f6f1e9');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', c));
}

export function setTheme(mode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode */
  }
  applyTheme(mode);
}

media.addEventListener?.('change', () => {
  if (getTheme() === 'auto' && !document.documentElement.classList.contains('reading')) paintThemeColor();
});
