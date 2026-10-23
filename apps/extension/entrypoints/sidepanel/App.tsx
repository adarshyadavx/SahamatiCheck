import type { Ontology } from '@sahamati/contracts';
import { useCallback, useEffect, useState } from 'react';
import { I18nProvider } from '../../components/I18n';
import { OntologyProvider } from '../../components/Ontology';
import { resolveLang, translate, type Lang } from '../../lib/i18n';
import { FOCUS_KEY, sendToBackground, type FocusTarget } from '../../lib/messages';
import { packageFromPlayUrl } from '../../lib/play';
import { getSettings, onSettingsChanged } from '../../lib/settings';
import { PolicyView } from './PolicyView';
import { ReceiptsView } from './ReceiptsView';
import { ReportView } from './ReportView';

type Tab = 'report' | 'policy' | 'receipts';
const TABS: Tab[] = ['report', 'policy', 'receipts'];

interface ActiveTab {
  id: number | undefined;
  url: string | undefined;
}

async function activeTab(): Promise<ActiveTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { id: tab?.id, url: tab?.url };
}

export function App() {
  const [lang, setLang] = useState<Lang>(resolveLang('auto'));
  const [apiBase, setApiBase] = useState('');
  const [tab, setTab] = useState<Tab>('report');
  const [browserTab, setBrowserTab] = useState<ActiveTab>({ id: undefined, url: undefined });
  const [manualPkg, setManualPkg] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [ontology, setOntology] = useState<Ontology | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    void getSettings().then((s) => {
      setLang(resolveLang(s.lang));
      setApiBase(s.apiBase);
    });
    return onSettingsChanged((s) => {
      setLang(resolveLang(s.lang));
      setApiBase(s.apiBase);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = translate(lang, 'app.name');
  }, [lang]);

  useEffect(() => {
    void sendToBackground({ type: 'ontology:get' })
      .then((r) => setOntology(r?.ontology ?? null))
      .catch(() => undefined);
  }, [apiBase]);

  useEffect(() => {
    void sendToBackground({ type: 'version:get' })
      .then((r) => setStale(r?.state === 'stale'))
      .catch(() => undefined);
  }, [apiBase]);

  // Track the active browser tab.
  useEffect(() => {
    const update = () => void activeTab().then(setBrowserTab);
    update();
    const onActivated = () => {
      setManualPkg(null);
      update();
    };
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => {
      if (info.url || info.status === 'complete') update();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // Marker clicks on Play store a focus target in session storage.
  useEffect(() => {
    const apply = (f: FocusTarget | undefined) => {
      if (!f || Date.now() - f.at > 60_000) return;
      setFocus(f);
      setManualPkg(f.package);
      setTab('report');
    };
    void chrome.storage.session.get(FOCUS_KEY).then((got) => apply(got[FOCUS_KEY] as FocusTarget | undefined));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[FOCUS_KEY]) apply(changes[FOCUS_KEY].newValue as FocusTarget | undefined);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const tabPkg = packageFromPlayUrl(browserTab.url);
  const pkg = manualPkg ?? tabPkg;
  const t = useCallback((k: Parameters<typeof translate>[1]) => translate(lang, k), [lang]);

  const onKeyTabs = (e: React.KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    if (e.key === 'ArrowRight') setTab(TABS[(i + 1) % TABS.length]);
    if (e.key === 'ArrowLeft') setTab(TABS[(i + TABS.length - 1) % TABS.length]);
  };

  return (
    <I18nProvider lang={lang}>
      <OntologyProvider ontology={ontology}>
        <div className="panel">
          <header className="panel-head">
            <h1 className="brand">{t('app.name')}</h1>
            <p className="muted small">{t('app.tagline')}</p>
          </header>
          {stale && (
            <p className="notice" role="alert" data-testid="stale-backend">
              {t('app.staleBackend')}
            </p>
          )}
          <div role="tablist" aria-label={t('tabs.label')} className="tabs" onKeyDown={onKeyTabs}>
            {TABS.map((id) => (
              <button
                key={id}
                id={`tab-${id}`}
                role="tab"
                type="button"
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
              >
                {t(`tabs.${id}`)}
              </button>
            ))}
          </div>
          <main id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="tab-body">
            {tab === 'report' && (
              <ReportView
                pkg={pkg}
                tabPkg={tabPkg}
                tabId={browserTab.id}
                apiBase={apiBase}
                focusFindingId={focus && focus.package === pkg ? focus.findingId : undefined}
                onPickPackage={setManualPkg}
              />
            )}
            {tab === 'policy' && <PolicyView tabId={browserTab.id} />}
            {tab === 'receipts' && <ReceiptsView pkg={pkg} />}
          </main>
        </div>
      </OntologyProvider>
    </I18nProvider>
  );
}
