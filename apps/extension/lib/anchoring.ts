import type { Finding, Report } from '@sahamati/contracts';

/**
 * Anchors SahamatiCheck markers to rows of the Play data-safety section by matching
 * the fixed, public data-safety vocabulary text. Play's CSS class names are
 * obfuscated and change often, so they are never used.
 */

export type DsLevel = 'category' | 'type';

export interface DsTerm {
  term: string;
  level: DsLevel;
  category: string;
}

/** Google Play data-safety categories and data types (English UI). */
const VOCAB: Record<string, string[]> = {
  Location: ['Approximate location', 'Precise location'],
  'Personal info': [
    'Name',
    'Email address',
    'User IDs',
    'Address',
    'Phone number',
    'Race and ethnicity',
    'Political or religious beliefs',
    'Sexual orientation',
    'Other info',
  ],
  'Financial info': ['User payment info', 'Purchase history', 'Credit score', 'Other financial info'],
  'Health and fitness': ['Health info', 'Fitness info'],
  Messages: ['Emails', 'SMS or MMS', 'Other in-app messages'],
  'Photos and videos': ['Photos', 'Videos'],
  'Audio files': ['Voice or sound recordings', 'Music files', 'Other audio files'],
  'Files and docs': ['Files and docs'],
  Calendar: ['Calendar events'],
  Contacts: ['Contacts'],
  'App activity': [
    'App interactions',
    'In-app search history',
    'Installed apps',
    'Other user-generated content',
    'Other actions',
  ],
  'Web browsing': ['Web browsing history'],
  'App info and performance': ['Crash logs', 'Diagnostics', 'Other app performance data'],
  'Device or other IDs': ['Device or other IDs'],
};

export const DS_TERMS: DsTerm[] = Object.entries(VOCAB).flatMap(([category, types]) => [
  { term: category, level: 'category' as const, category },
  ...types.map((t) => ({ term: t, level: 'type' as const, category })),
]);

export type SectionKind = 'shared' | 'collected' | 'no_shared' | 'no_collected' | 'security';

/** Section headings on the data-safety page. */
export const SECTION_TERMS: Record<string, SectionKind> = {
  'data shared': 'shared',
  'data collected': 'collected',
  'no data shared with third parties': 'no_shared',
  'no data collected': 'no_collected',
  'security practices': 'security',
};

/**
 * Display-only mapping from ontology ids to the data-safety label that shows them.
 * Used only to place a marker; it never affects any finding.
 */
export const ONTOLOGY_TO_DS: Record<string, string> = {
  location: 'Location',
  approximate_location: 'Approximate location',
  precise_location: 'Precise location',
  personal_info: 'Personal info',
  name: 'Name',
  email: 'Email address',
  email_address: 'Email address',
  user_ids: 'User IDs',
  user_id: 'User IDs',
  address: 'Address',
  phone_number: 'Phone number',
  race_ethnicity: 'Race and ethnicity',
  political_religious_beliefs: 'Political or religious beliefs',
  sexual_orientation: 'Sexual orientation',
  financial_info: 'Financial info',
  payment_info: 'User payment info',
  user_payment_info: 'User payment info',
  purchase_history: 'Purchase history',
  credit_score: 'Credit score',
  health_fitness: 'Health and fitness',
  health_info: 'Health info',
  fitness_info: 'Fitness info',
  messages: 'Messages',
  emails: 'Emails',
  sms_mms: 'SMS or MMS',
  sms: 'SMS or MMS',
  photos_media: 'Photos and videos',
  photos_videos: 'Photos and videos',
  photos: 'Photos',
  camera_media: 'Photos',
  videos: 'Videos',
  audio: 'Audio files',
  audio_files: 'Audio files',
  voice_recordings: 'Voice or sound recordings',
  music_files: 'Music files',
  files_docs: 'Files and docs',
  calendar: 'Calendar events',
  calendar_events: 'Calendar events',
  contacts: 'Contacts',
  app_activity: 'App activity',
  app_interactions: 'App interactions',
  search_history: 'In-app search history',
  installed_apps: 'Installed apps',
  web_browsing: 'Web browsing history',
  web_browsing_history: 'Web browsing history',
  app_performance: 'App info and performance',
  diagnostics: 'Diagnostics',
  crash_logs: 'Crash logs',
  device_id: 'Device or other IDs',
  device_ids: 'Device or other IDs',
  advertising_id: 'Device or other IDs',
};

export function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

const TERM_INDEX = new Map(DS_TERMS.map((t) => [normalise(t.term), t]));

export interface Anchor {
  /** The vocabulary term as written in DS_TERMS. */
  term: string;
  level: DsLevel;
  /** The text node whose whole content is the term. */
  textNode: Text;
  /** The element holding that text. */
  label: Element;
  /** The smallest ancestor that holds this row and no other term. */
  row: Element;
  section: SectionKind | null;
}

export interface SectionAnchor {
  kind: SectionKind;
  textNode: Text;
  label: Element;
}

export interface AnchorScan {
  anchors: Anchor[];
  sections: SectionAnchor[];
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT']);
export const MARKER_ATTR = 'data-sahamati-marker';
const MAX_ROW_TEXT = 400;

function textNodes(root: Node): Text[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return 2; // FILTER_REJECT
      if (parent.closest(`[${MARKER_ATTR}]`)) return 2;
      const value = node.nodeValue ?? '';
      if (value.length > 80 || !value.trim()) return 3; // FILTER_SKIP
      return 1; // FILTER_ACCEPT
    },
  });
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

function precedes(a: Node, b: Node): boolean {
  // DOCUMENT_POSITION_FOLLOWING = 4: b follows a.
  return (a.compareDocumentPosition(b) & 4) !== 0;
}

/** Scan a page (or a subtree) for data-safety rows and section headings. */
export function findDataSafetyAnchors(root: ParentNode & Node): AnchorScan {
  const sections: SectionAnchor[] = [];
  const raw: { term: DsTerm; textNode: Text; label: Element }[] = [];

  for (const node of textNodes(root)) {
    const key = normalise(node.nodeValue ?? '');
    const section = SECTION_TERMS[key];
    if (section && node.parentElement) {
      sections.push({ kind: section, textNode: node, label: node.parentElement });
      continue;
    }
    const term = TERM_INDEX.get(key);
    if (term && node.parentElement) raw.push({ term, textNode: node, label: node.parentElement });
  }

  const labels = raw.map((r) => r.label);
  const anchors: Anchor[] = raw.map(({ term, textNode, label }) => {
    let row: Element = label;
    for (;;) {
      const parent: Element | null = row.parentElement;
      if (!parent || parent === root || parent.tagName === 'BODY' || parent.tagName === 'HTML') break;
      if (labels.some((l) => l !== label && parent.contains(l))) break;
      if (sections.some((s) => parent.contains(s.label))) break;
      if (normalise(parent.textContent ?? '').length > MAX_ROW_TEXT) break;
      row = parent;
    }
    let sectionKind: SectionKind | null = null;
    for (const s of sections) if (precedes(s.textNode, textNode)) sectionKind = s.kind;
    return { term: term.term, level: term.level, textNode, label, row, section: sectionKind };
  });

  return { anchors, sections };
}

/** Which section a finding most likely refers to, from its data-safety side. */
export function preferredSection(f: Finding): SectionKind | null {
  const ds = f.sides.find((s) => s.source === 'data_safety');
  const label = normalise(ds?.evidence.label ?? '');
  if (/\bnot shared\b|no data shared/.test(label)) return 'shared';
  if (/\bnot collected\b|no data collected/.test(label)) return 'collected';
  if (/\bshared\b/.test(label)) return 'shared';
  if (/\bcollected\b/.test(label)) return 'collected';
  const action = ds?.tuple.action ?? f.sides[0].tuple.action;
  if (action === 'share' || action === 'sell') return 'shared';
  if (action === 'collect') return 'collected';
  return null;
}

/** Candidate vocabulary terms for a finding, most specific first. */
export function findingTerms(f: Finding): string[] {
  const terms: string[] = [];
  const push = (t: string | undefined) => {
    if (t && TERM_INDEX.has(normalise(t)) && !terms.includes(t)) terms.push(t);
  };
  for (const side of f.sides) {
    if (side.source !== 'data_safety' || !side.evidence.label) continue;
    for (const part of side.evidence.label.split(/\s+[—–-]\s+/)) {
      const t = TERM_INDEX.get(normalise(part));
      if (t) push(t.term);
    }
  }
  // Skip the root (e.g. personal_info): it is too broad to place a marker on.
  for (const id of f.ontology_path.slice(1).reverse()) push(ONTOLOGY_TO_DS[id]);
  const roots = new Set(f.ontology_path.slice(0, 1));
  for (const side of f.sides) if (!roots.has(side.tuple.data_type)) push(ONTOLOGY_TO_DS[side.tuple.data_type]);
  return terms;
}

export interface Placement {
  findings: Finding[];
  /** Where to mount the marker: after this text node. */
  textNode: Text;
  row: Element | null;
  term: string;
  viaSection: boolean;
}

/**
 * Place each finding on the best matching row. A finding about something the
 * page does not list (e.g. "Contacts — Not collected") goes next to the matching
 * section heading instead. Findings that match nothing are dropped quietly.
 */
export function placeFindings(report: Report, scan: AnchorScan): Placement[] {
  const byNode = new Map<Text, Placement>();

  for (const f of report.findings) {
    const pref = preferredSection(f);
    let chosen: { textNode: Text; row: Element | null; term: string; viaSection: boolean } | null = null;

    for (const term of findingTerms(f)) {
      const matches = scan.anchors.filter((a) => a.term === term);
      if (!matches.length) continue;
      const inSection = pref ? matches.filter((a) => a.section === pref) : [];
      const pool = inSection.length ? inSection : matches;
      // The last match is the expanded detail row (Play repeats the term in the
      // category header, its summary and the detail list).
      const pick = pool[pool.length - 1];
      chosen = { textNode: pick.textNode, row: pick.row, term, viaSection: false };
      break;
    }

    if (!chosen && pref) {
      const sectionKinds: SectionKind[] =
        pref === 'shared' ? ['shared', 'no_shared'] : pref === 'collected' ? ['collected', 'no_collected'] : [pref];
      const section = scan.sections.find((s) => sectionKinds.includes(s.kind));
      if (section) {
        chosen = { textNode: section.textNode, row: null, term: section.label.textContent?.trim() ?? '', viaSection: true };
      }
    }
    if (!chosen) continue;

    const existing = byNode.get(chosen.textNode);
    if (existing) existing.findings.push(f);
    else byNode.set(chosen.textNode, { findings: [f], ...chosen });
  }

  return [...byNode.values()];
}
