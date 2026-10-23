export interface Sentence {
  start: number;
  end: number;
  text: string;
}

/** Split text into sentences, keeping offsets. Handles '.', '!', '?', the Devanagari danda and line breaks. */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?।\n]+(?:[.!?।]+["'”’)\]]*|\n|$)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length < 3) continue;
    const start = m.index + lead;
    out.push({ start, end: start + trimmed.length, text: trimmed });
  }
  return out;
}
