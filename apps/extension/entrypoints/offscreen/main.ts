import { HeuristicClassifier, type PreliminaryClassifier } from '../../lib/prelim';
import type { OffscreenRequest } from '../../lib/messages';

/**
 * Offscreen document hosting the on-device preliminary classifier.
 * Today this is a keyword/negation heuristic. A future transformers.js MiniLM
 * (bundled, never fetched) implements the same PreliminaryClassifier interface.
 * No model is bundled yet.
 */
const classifier: PreliminaryClassifier = new HeuristicClassifier();

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'classify') return false;
  classifier
    .classify(msg.text)
    .then(sendResponse)
    .catch(() => sendResponse(undefined));
  return true;
});
