import Link from "next/link";
import { createT } from "@sahamati/i18n";
import { Seal } from "@sahamati/ui";

// not-found cannot read params; English with a Hindi line keeps it usable for both.
export default function NotFound() {
  const t = createT("en");
  const th = createT("hi");
  return (
    <div className="page grid place-items-center py-24 text-center">
      <Seal size={64} variant="dashed" color="var(--class-gap)" />
      <h1 className="display mt-6 text-4xl">{t("notFound.title")}</h1>
      <p className="lede mx-auto mt-3">{t("notFound.body")}</p>
      <p className="mt-1 text-ink-muted" lang="hi">
        {th("notFound.body")}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/en" className="btn btn-primary">
          {t("common.backHome")}
        </Link>
        <Link href="/hi" className="btn btn-secondary" lang="hi">
          {th("common.backHome")}
        </Link>
      </div>
    </div>
  );
}
