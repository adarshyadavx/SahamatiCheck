import { useI18n } from './I18n';
import { useOntologyLabel } from './Ontology';

export function Breadcrumbs({ path }: { path: string[] }) {
  const { t } = useI18n();
  const label = useOntologyLabel();
  if (!path.length) return null;
  return (
    <nav className="crumbs" aria-label={t('finding.path')}>
      <ol>
        {path.map((id, i) => (
          <li key={`${id}-${i}`} aria-current={i === path.length - 1 ? 'true' : undefined}>
            {label(id)}
          </li>
        ))}
      </ol>
    </nav>
  );
}
