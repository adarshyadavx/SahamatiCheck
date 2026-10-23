"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Toggles data-theme on <html>; the choice is remembered per browser. */
export function ThemeToggle({ toLight, toDark }: { toLight: string; toDark: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(currentTheme());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(currentTheme());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next: Theme = (theme ?? currentTheme()) === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("sahamati-theme", next);
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
    setTheme(next);
  }

  const label = theme === "dark" ? toLight : toDark;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface-raised text-ink transition-colors hover:border-neel hover:text-neel"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
        {theme === "dark" ? (
          <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <circle cx="10" cy="10" r="3.6" />
            <path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5" />
          </g>
        ) : (
          <path d="M15.8 12.6A6.6 6.6 0 0 1 7.4 4.2 6.6 6.6 0 1 0 15.8 12.6z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
