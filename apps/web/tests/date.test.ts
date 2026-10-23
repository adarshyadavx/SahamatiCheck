import { describe, expect, it } from "vitest";
import { formatDate } from "@sahamati/i18n";

// The server (Node) and the browser must print the same date, or React reports a hydration mismatch on /hi.
describe("formatDate", () => {
  it("prints fixed, ICU-independent month names in UTC", () => {
    expect(formatDate("en", "2026-10-24")).toBe("24 Oct 2026");
    expect(formatDate("hi", "2026-10-24")).toBe("24 अक्टू॰ 2026");
    expect(formatDate("en", "2026-01-01T23:59:59Z")).toBe("1 Jan 2026");
  });
  it("returns the input when it is not a date", () => expect(formatDate("en", "n/a")).toBe("n/a"));
});
