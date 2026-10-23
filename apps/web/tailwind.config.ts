import type { Config } from "tailwindcss";

// Tailwind maps onto the Mudra CSS variables from packages/ui/src/tokens.css,
// so light/dark come from the tokens rather than Tailwind's dark: variant.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        neel: { DEFAULT: "var(--neel)", soft: "var(--neel-soft)" },
        surface: { DEFAULT: "var(--surface)", raised: "var(--surface-raised)", sunken: "var(--surface-sunken)" },
        line: { DEFAULT: "var(--border)", strong: "var(--border-strong)" },
        ink: { DEFAULT: "var(--ink)", muted: "var(--ink-muted)", faint: "var(--ink-faint)" },
        onneel: "var(--on-neel)",
        internal: { DEFAULT: "var(--class-internal)", soft: "var(--class-internal-soft)" },
        declaration: { DEFAULT: "var(--class-declaration)", soft: "var(--class-declaration-soft)" },
        behaviour: { DEFAULT: "var(--class-behaviour)", soft: "var(--class-behaviour-soft)", fill: "var(--class-behaviour-fill)" },
        gap: { DEFAULT: "var(--class-gap)", soft: "var(--class-gap-soft)" },
        agree: { DEFAULT: "var(--agree)", soft: "var(--agree-soft)" },
        haldi: "var(--haldi)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: { mudra: "var(--radius)" },
      boxShadow: { 1: "var(--shadow-1)", 2: "var(--shadow-2)" },
      maxWidth: { page: "72rem" },
    },
  },
  plugins: [],
};

export default config;
