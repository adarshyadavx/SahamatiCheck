import { splitSentences } from './sentences';

/**
 * On-device "preliminary" sentence classifier.
 *
 * This is the interface a future transformers.js MiniLM model will implement.
 * For now it is a fast keyword + negation heuristic. Its output only colours
 * sentences; it has no actor/data-type tuples and NEVER produces findings.
 */
export type PrelimLabel = 'collection' | 'sharing' | 'denial' | 'vague';

export interface PreliminarySegment {
  char_start: number;
  char_end: number;
  text: string;
  label: PrelimLabel;
  vague: boolean;
  negated: boolean;
  confidence: number;
}

export interface PreliminaryResult {
  kind: 'preliminary';
  classifier: string;
  segments: PreliminarySegment[];
  vague_claim_ratio: number;
}

export interface PreliminaryClassifier {
  readonly id: string;
  classify(text: string): Promise<PreliminaryResult>;
}

const SHARE = /\b(share[sd]?|sharing|disclos(e|es|ed|ing)|sell(s|ing)?|sold|transfer(s|red|ring)?|provide[sd]? (it |this |them )?to|make available to)\b|साझा|बेच/i;
const COLLECT = /\b(collect(s|ed|ing)?|gather(s|ed|ing)?|obtain(s|ed|ing)?|receive[sd]?|access(es|ed|ing)?|stor(e|es|ed|ing)|retain(s|ed|ing)?|record(s|ed|ing)?|use[sd]?|process(es|ed|ing)?)\b|एकत्र|इकट्ठा|संग्रह/i;
const NEGATION = /\b(not|never|no|none|neither|nor|don't|doesn't|won't|cannot|can't)\b|नहीं|कभी नहीं|न ही/i;
const HEDGE = /\b(may|might|could|certain (information|data)|from time to time|such as|including but not limited to|some (information|data)|as necessary|where appropriate|other information)\b|सकते|सकती|कुछ जानकारी/i;
const DATA_HINT = /\b(location|gps|contact(s)?|email|phone|device|identifier|advertising id|ip address|camera|photo(s)?|video(s)?|microphone|audio|financial|payment|card|bank|health|fitness|name|address|calendar|sms|messages?|browsing|crash|diagnostic|installed apps)\b|स्थान|फ़ोन|ईमेल|संपर्क|कैमरा|भुगतान|स्वास्थ्य/i;

export class HeuristicClassifier implements PreliminaryClassifier {
  readonly id = 'heuristic-keywords@0.1.0';

  async classify(text: string): Promise<PreliminaryResult> {
    const segments: PreliminarySegment[] = [];
    let claimish = 0;
    let vagueCount = 0;
    for (const s of splitSentences(text)) {
      if (s.text.length > 600) continue;
      const share = SHARE.test(s.text);
      const collect = COLLECT.test(s.text);
      if (!share && !collect) continue;
      claimish++;
      const negated = NEGATION.test(s.text);
      const hedged = HEDGE.test(s.text);
      const specific = DATA_HINT.test(s.text);
      const vague = hedged && !specific;
      if (vague) vagueCount++;
      const label: PrelimLabel = vague ? 'vague' : negated ? 'denial' : share ? 'sharing' : 'collection';
      segments.push({
        char_start: s.start,
        char_end: s.end,
        text: s.text,
        label,
        vague,
        negated,
        // Deliberately low: these are hints, not claims.
        confidence: specific ? 0.45 : 0.3,
      });
    }
    return {
      kind: 'preliminary',
      classifier: this.id,
      segments,
      vague_claim_ratio: claimish ? Math.round((vagueCount / claimish) * 100) / 100 : 0,
    };
  }
}
