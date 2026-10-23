import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../components/I18n';
import { formatDate } from '../../lib/i18n';
import { sendToBackground } from '../../lib/messages';
import {
  exportJson,
  isEmptyDiff,
  openReceiptStore,
  withDiffs,
  type ClaimDiff,
  type Receipt,
  type ReceiptClaim,
} from '../../lib/receipts';

const store = openReceiptStore();

function claimText(c: ReceiptClaim): string {
  return `${c.source} · ${c.data_type}${c.actor ? ` · ${c.actor}` : ''} · ${c.stance}`;
}

function DiffView({ diff }: { diff: ClaimDiff | null }) {
  const { t } = useI18n();
  if (!diff) return <p className="small muted">{t('receipts.first')}</p>;
  if (isEmptyDiff(diff)) return <p className="small muted">{t('receipts.noChanges')}</p>;
  return (
    <div className="diff">
      <p className="small"><strong>{t('receipts.changes')}</strong></p>
      <ul>
        {diff.changed.map((c) => (
          <li key={c.key} className="small diff-changed">
            {t('receipts.changed')}: <code>{c.claim.source} · {c.claim.data_type}</code> {c.from} → {c.to}
          </li>
        ))}
        {diff.added.map((c) => (
          <li key={c.key} className="small diff-added">{t('receipts.added')}: <code>{claimText(c)}</code></li>
        ))}
        {diff.removed.map((c) => (
          <li key={c.key} className="small diff-removed">{t('receipts.removed')}: <code>{claimText(c)}</code></li>
        ))}
      </ul>
    </div>
  );
}

export function ReceiptsView({ pkg }: { pkg: string | null }) {
  const { t, lang } = useI18n();
  const [list, setList] = useState<Receipt[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setList(pkg ? await store.listByPackage(pkg) : await store.all());
  }, [pkg]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    if (!pkg) return setMsg(t('receipts.noReport'));
    const res = await sendToBackground({ type: 'report:get', package: pkg });
    if (res.kind !== 'report') return setMsg(t('receipts.noReport'));
    const out = await store.saveIfChanged(res.report);
    setMsg(out.saved ? t('receipts.saved') : t('receipts.unchanged'));
    await refresh();
  };

  const download = async () => {
    const blob = new Blob([exportJson(pkg ? list : await store.all())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sahamaticheck-receipts${pkg ? `-${pkg}` : ''}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const rows = withDiffs(list).reverse();

  return (
    <div className="stack">
      <section className="card">
        <h2 className="h2">{t('receipts.title')}</h2>
        <p className="small">{t('receipts.intro')}</p>
        <div className="row">
          <button type="button" className="btn" onClick={() => void save()}>{t('receipts.save')}</button>
          <button type="button" className="btn secondary" onClick={() => void download()} disabled={!list.length}>
            {t('receipts.export')}
          </button>
        </div>
        {msg && <p className="small" role="status">{msg}</p>}
      </section>
      <h3 className="h3">{pkg ? t('receipts.forApp', { package: pkg }) : t('receipts.all')}</h3>
      {!rows.length && <p className="muted">{t('receipts.none')}</p>}
      <ol className="receipts">
        {rows.map(({ receipt, diff }) => (
          <li key={receipt.id} className="card">
            <p className="row-between">
              <strong>{receipt.title}</strong>
              <span className="small muted">{formatDate(receipt.created_at, lang)}</span>
            </p>
            {receipt.is_demo && <span className="demo-pill">{t('demo.label')}</span>}
            <p className="small mono">{receipt.package}</p>
            <p className="small">{t('receipts.claims', { n: receipt.claims.length })}</p>
            <p className="small mono hash" title={receipt.sha256}>
              {t('receipts.hash')}: {receipt.sha256.slice(0, 16)}…
            </p>
            <DiffView diff={diff} />
          </li>
        ))}
      </ol>
    </div>
  );
}
