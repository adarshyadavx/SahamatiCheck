import type { Report } from '@sahamati/contracts';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { findDataSafetyAnchors, MARKER_ATTR, placeFindings } from '../lib/anchoring';
import { statusKey, topStatus } from '../lib/card';
import { resolveLang, translate, type Lang } from '../lib/i18n';
import { clearMarkers, mountMarkers } from '../lib/markers';
import type { BgResponses, TabMessage } from '../lib/messages';
import { packageFromPlayUrl } from '../lib/play';
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings';

/**
 * Play data-safety annotator. It reads only the page the user is viewing and the
 * extension's local report cache; it makes no network requests itself. Markers
 * appear for apps the user has checked from the side panel.
 */
export default defineContentScript({
  matches: ['https://play.google.com/store/apps/details*', 'https://play.google.com/store/apps/datasafety*'],
  runAt: 'document_idle',
  main(ctx) {
    let report: Report | null = null;
    let currentPkg: string | null = null;
    let lang: Lang = 'en';
    let observer: MutationObserver | null = null;
    let timer: number | undefined;

    const annotate = () => {
      if (!report || !document.body) return;
      try {
        observer?.disconnect();
        const placements = placeFindings(report, findDataSafetyAnchors(document.body));
        const pkg = report.app.package;
        mountMarkers(placements, {
          label: (p) =>
            translate(lang, 'marker.label', {
              n: p.findings.length,
              term: p.term,
              status: translate(lang, statusKey(topStatus(p.findings))),
            }),
          onActivate: (finding) => {
            void chrome.runtime.sendMessage({ type: 'panel:open', package: pkg, findingId: finding.id });
          },
        });
      } catch {
        // Anchoring failed (layout changed): degrade quietly, the side panel still works.
      } finally {
        observe();
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(annotate, 400);
    };

    const observe = () => {
      if (!report || !document.body) return;
      observer ??= new MutationObserver((records) => {
        const ours = records.every((r) =>
          [...r.addedNodes, ...r.removedNodes].every((n) => n instanceof Element && n.hasAttribute(MARKER_ATTR)),
        );
        if (!ours) schedule();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };

    const refresh = async () => {
      const pkg = packageFromPlayUrl(location.href);
      if (pkg !== currentPkg) {
        clearMarkers(document);
        report = null;
        currentPkg = pkg;
      }
      if (!pkg) return;
      try {
        const res = (await chrome.runtime.sendMessage({ type: 'report:cached', package: pkg })) as
          | BgResponses['report:cached']
          | undefined;
        // Only annotate with a report about this exact app, never a demo sample.
        report = res?.report && res.report.app.package === pkg ? res.report : null;
      } catch {
        report = null;
      }
      if (report) annotate();
    };

    void chrome.storage.local.get('settings').then((got) => {
      const s: Settings = { ...DEFAULT_SETTINGS, ...(got.settings ?? {}) };
      lang = resolveLang(s.lang);
      void refresh();
    });

    // Play is a single-page app: re-run on in-page navigation.
    ctx.addEventListener(window, 'wxt:locationchange', () => void refresh());

    const onMessage = (msg: TabMessage) => {
      if (msg?.type === 'report:updated' && msg.package === currentPkg) void refresh();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      observer?.disconnect();
      window.clearTimeout(timer);
      clearMarkers(document);
    });
  },
});
