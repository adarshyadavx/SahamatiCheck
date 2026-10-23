"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

interface Item {
  href: string;
  label: string;
}

export function NavMenu({ items, labels }: { items: Item[]; labels: { primary: string; menu: string; close: string } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (h: string) => pathname === h || pathname.startsWith(`${h}/`);

  return (
    <>
      <nav aria-label={labels.primary} className="hidden lg:block">
        <ul className="flex items-center gap-0.5">
          {items.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={isActive(i.href) ? "page" : undefined}
                className="rounded-full px-3 py-1.5 text-[0.88rem] font-medium text-ink-muted no-underline transition-colors hover:bg-neel-soft hover:text-neel aria-[current=page]:bg-neel-soft aria-[current=page]:text-neel"
              >
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <button
        ref={buttonRef}
        type="button"
        className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface-raised text-ink lg:hidden"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? labels.close : labels.menu}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          {open ? (
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <path d="M3 5h12M3 9h12M3 13h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-16 border-b border-line bg-surface shadow-2 lg:hidden"
      >
        <nav aria-label={labels.primary} className="page py-3">
          <ul className="grid gap-1">
            {items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={isActive(i.href) ? "page" : undefined}
                  className="block rounded-lg px-3 py-2.5 font-medium text-ink no-underline hover:bg-neel-soft aria-[current=page]:bg-neel-soft aria-[current=page]:text-neel"
                >
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
