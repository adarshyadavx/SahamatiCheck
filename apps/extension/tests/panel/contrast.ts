import type { Page } from "@playwright/test";

export interface ContrastFailure {
  text: string;
  selector: string;
  ratio: number;
  required: number;
  fg: string;
  bg: string;
}

/**
 * WCAG 2.x contrast for every visible text element, computed in the page. axe-core cannot judge text over the
 * site's textured background (it reports those nodes as "incomplete"), so this check composites the real
 * ancestor background colours itself. Large text (>= 24px, or >= 18.66px bold) needs 3:1, everything else 4.5:1.
 */
export async function findLowContrast(page: Page, rootSelector = "body"): Promise<ContrastFailure[]> {
  return page.evaluate((rootSel) => {
    type RGBA = [number, number, number, number];
    const canvas = document.createElement("canvas").getContext("2d")!;
    const parse = (css: string): RGBA => {
      // let the browser normalise any CSS colour (rgb, color(srgb ...), color-mix) to rgba via a 1px canvas
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = "#000";
      canvas.fillStyle = css;
      canvas.fillRect(0, 0, 1, 1);
      const d = canvas.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (top: RGBA, under: RGBA): RGBA => {
      const a = top[3] + under[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const c = (i: number) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
      return [c(0), c(1), c(2), a];
    };
    const lum = ([r, g, b]: RGBA) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const effectiveBg = (el: Element): RGBA => {
      const layers: RGBA[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let acc: RGBA = parse(getComputedStyle(document.documentElement).backgroundColor);
      if (acc[3] === 0) acc = [255, 255, 255, 1];
      for (const l of layers.reverse()) acc = over(l, acc);
      return acc;
    };
    const sel = (el: Element) =>
      el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
    const out: ContrastFailure[] = [];
    const root = document.querySelector(rootSel) ?? document.body;
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
      if (!own.length) continue;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0 || rect.width === 0 || rect.height === 0) continue;
      const bg = effectiveBg(el);
      const fgRaw = parse(cs.color);
      const fg = over(fgRaw, bg);
      const l1 = lum(fg), l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const px = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const required = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
      if (ratio < required) {
        out.push({
          text: (own[0].textContent ?? "").trim().slice(0, 50), selector: sel(el), ratio: Math.round(ratio * 100) / 100, required,
          fg: `rgb(${fg.slice(0, 3).map(Math.round)})`, bg: `rgb(${bg.slice(0, 3).map(Math.round)})`,
        });
      }
    }
    return out;
  }, rootSelector);
}
