import { describe, expect, it } from 'vitest';
import { HeuristicClassifier } from '../lib/prelim';
import { splitSentences } from '../lib/sentences';
import { buildTextMap, findQuote, offsetOf, rangeFor } from '../lib/textmap';

const POLICY = `
  <main>
    <h1>Privacy Policy</h1>
    <p>We do not collect your location.</p>
    <p>We collect your <b>precise GPS location</b> to help prevent fraud.</p>
    <p style="display:none" hidden>Hidden text that must be skipped.</p>
    <script>var x = "We share everything";</script>
    <p>We may share certain information with partners from time to time.</p>
  </main>`;

describe('policy text map', () => {
  it('extracts visible text with offsets that map back to DOM ranges', () => {
    document.body.innerHTML = POLICY;
    const map = buildTextMap(document.body);
    expect(map.text).not.toContain('Hidden text');
    expect(map.text).not.toContain('We share everything');
    const span = findQuote(map.text, 'We collect your precise GPS location to help prevent fraud.');
    expect(span).not.toBeNull();
    const range = rangeFor(map, span![0], span![1])!;
    expect(range.toString()).toBe('We collect your precise GPS location to help prevent fraud.');
    // Page text is untouched: the paragraph still has its original children.
    expect(document.querySelector('b')!.textContent).toBe('precise GPS location');
    const bText = document.querySelector('b')!.firstChild!;
    expect(offsetOf(map, bText, 0)).toBe(map.text.indexOf('precise GPS'));
  });

  it('splits sentences with offsets, including the danda', () => {
    const text = 'हम आपका स्थान एकत्र नहीं करते। We collect email. Heading\nNext line';
    const s = splitSentences(text);
    expect(s.map((x) => x.text)).toEqual(['हम आपका स्थान एकत्र नहीं करते।', 'We collect email.', 'Heading', 'Next line']);
    for (const x of s) expect(text.slice(x.start, x.end)).toBe(x.text);
  });
});

describe('preliminary on-device classifier', () => {
  it('labels denials, sharing and vague sentences without producing tuples', async () => {
    const text = 'We do not collect your location. We share your email address with partners. We may share certain information from time to time. Welcome!';
    const res = await new HeuristicClassifier().classify(text);
    expect(res.kind).toBe('preliminary');
    const labels = res.segments.map((s) => s.label);
    expect(labels).toEqual(['denial', 'sharing', 'vague']);
    expect(res.segments.every((s) => !('tuples' in s))).toBe(true);
    expect(res.segments.every((s) => s.confidence < 0.5)).toBe(true);
    expect(res.vague_claim_ratio).toBeCloseTo(0.33, 2);
  });
});
