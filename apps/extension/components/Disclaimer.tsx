import { useI18n } from './I18n';

export function Disclaimer() {
  const { t } = useI18n();
  return (
    <aside className="disclaimer" aria-label={t('disclaimer.title')}>
      <strong>{t('disclaimer.title')}.</strong> {t('disclaimer.text')}
    </aside>
  );
}

export function DemoBanner({ otherPackage }: { otherPackage?: string | null }) {
  const { t } = useI18n();
  return (
    <div className="demo-banner" role="status">
      <span className="demo-pill">{t('demo.label')}</span>
      <p>{t('demo.banner')}</p>
      {otherPackage && <p className="small">{t('demo.otherApp', { package: otherPackage })}</p>}
    </div>
  );
}
