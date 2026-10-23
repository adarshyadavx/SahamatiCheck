import { API_BASE_DEFAULT } from '@sahamati/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { I18nProvider, useI18n } from '../../components/I18n';
import { resolveLang, type LangPref } from '../../lib/i18n';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from '../../lib/settings';

const ALL_HTTPS = { origins: ['https://*/*'] };

/** Optional permissions are requested only here, in context, on a user click. */
async function ensurePermission(perm: chrome.permissions.Permissions, on: boolean): Promise<boolean> {
  if (!on) {
    await chrome.permissions.remove(perm).catch(() => false);
    return false;
  }
  // Call request() first, with no await before it, so Chrome still sees the click.
  // It resolves true at once if the permission is already granted.
  return chrome.permissions.request(perm).catch(() => false);
}

function Form({ initial, onLang }: { initial: Settings; onLang: (l: LangPref) => void }) {
  const { t } = useI18n();
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = async (key: 'autoHighlight' | 'contextMenu' | 'notifications', on: boolean) => {
    const perm: chrome.permissions.Permissions =
      key === 'autoHighlight' ? ALL_HTTPS : { permissions: [key === 'contextMenu' ? 'contextMenus' : 'notifications'] };
    const granted = await ensurePermission(perm, on);
    if (on && !granted) setMsg(t('options.permissionDenied'));
    const next = await saveSettings({ [key]: on && granted });
    setS(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = await saveSettings({ apiBase: s.apiBase, lang: s.lang });
    setS(next);
    onLang(next.lang);
    setMsg(t('options.saved'));
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="card">
        <label htmlFor="api" className="h3">{t('options.apiBase')}</label>
        <input
          id="api"
          className="input mono"
          type="url"
          value={s.apiBase}
          placeholder={API_BASE_DEFAULT}
          onChange={(e) => setS({ ...s, apiBase: e.target.value })}
        />
        <p className="small muted">{t('options.apiBaseHelp')}</p>
      </div>
      <div className="card">
        <label htmlFor="lang" className="h3">{t('options.lang')}</label>
        <select id="lang" className="input" value={s.lang} onChange={(e) => setS({ ...s, lang: e.target.value as LangPref })}>
          <option value="auto">{t('options.langAuto')}</option>
          <option value="en">{t('options.langEn')}</option>
          <option value="hi">{t('options.langHi')}</option>
        </select>
      </div>
      <div>
        <button type="submit" className="btn">{t('options.save')}</button>
      </div>

      <fieldset className="card">
        {(
          [
            ['autoHighlight', 'options.autoHighlight', 'options.autoHighlightHelp'],
            ['contextMenu', 'options.contextMenu', 'options.contextMenuHelp'],
            ['notifications', 'options.notifications', 'options.notificationsHelp'],
          ] as const
        ).map(([key, label, help]) => (
          <div key={key} className="check">
            <input id={key} type="checkbox" checked={s[key]} onChange={(e) => void toggle(key, e.target.checked)} />
            <div>
              <label htmlFor={key}>{t(label)}</label>
              <p className="small muted">{t(help)}</p>
            </div>
          </div>
        ))}
      </fieldset>
      {msg && <p role="status" className="small">{msg}</p>}

      <section className="card">
        <h2 className="h3">{t('options.privacyTitle')}</h2>
        <p className="small">{t('options.privacy')}</p>
      </section>
    </form>
  );
}

export function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [langPref, setLangPref] = useState<LangPref>('auto');

  useEffect(() => {
    void getSettings()
      .then((s) => {
        setSettings(s);
        setLangPref(s.lang);
      })
      .catch(() => setSettings(DEFAULT_SETTINGS));
  }, []);

  const lang = resolveLang(langPref);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <I18nProvider lang={lang}>
      <div className="panel options">
        <OptionsTitle />
        {settings && <Form initial={settings} onLang={setLangPref} />}
      </div>
    </I18nProvider>
  );
}

function OptionsTitle() {
  const { t } = useI18n();
  useEffect(() => {
    document.title = t('options.title');
  }, [t]);
  return <h1 className="brand">{t('options.title')}</h1>;
}
