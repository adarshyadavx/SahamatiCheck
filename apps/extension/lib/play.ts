/** Extract the package id from a Play listing URL (details or datasafety). */
export function packageFromPlayUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname !== 'play.google.com') return null;
    if (!/^\/store\/apps\/(details|datasafety)/.test(u.pathname)) return null;
    const id = u.searchParams.get('id');
    return id && isPackageName(id) ? id : null;
  } catch {
    return null;
  }
}

export function isPackageName(s: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(s.trim());
}

/** Rough check used by the opt-in auto-highlighter. */
export function looksLikePolicyPage(url: string, title = ''): boolean {
  if (!/^https:\/\//.test(url)) return false;
  return /privacy|policy|datenschutz|गोपनीयता/i.test(`${url} ${title}`);
}
