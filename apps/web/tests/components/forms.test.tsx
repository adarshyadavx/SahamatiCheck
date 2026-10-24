// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import sample from "@sahamati/contracts/fixtures/report.sample.json";
import { createT } from "@sahamati/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useSearchParams: () => search }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const api = vi.hoisted(() => ({
  postCheck: vi.fn(),
  getJob: vi.fn(),
  postDispute: vi.fn(),
  postSelfCheck: vi.fn(),
  fetchReportClient: vi.fn(),
}));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, ...api };
});

import { ApiError, ApiUnreachable } from "@/lib/api";
import { CheckForm } from "@/components/CheckForm";
import { DisputeForm } from "@/components/DisputeForm";
import { SelfCheckForm } from "@/components/SelfCheckForm";

const t = createT("en");
const hi = createT("hi");

class FakeEventSource {
  static CLOSED = 2;
  static CONNECTING = 0;
  static last: FakeEventSource | null = null;
  readyState = 1;
  onerror: (() => void) | null = null;
  closed = false;
  listeners: Record<string, ((e: MessageEvent<string>) => void)[]> = {};
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
    (this.listeners[name] ??= []).push(fn);
  }
  emit(name: string, data: unknown) {
    for (const fn of this.listeners[name] ?? []) fn({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

beforeEach(() => {
  push.mockReset();
  Object.values(api).forEach((m) => m.mockReset());
  search = new URLSearchParams();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
  // jsdom's FormData yields jsdom Files; make `instanceof File` in the component see the same class (test environment only)
  vi.stubGlobal("File", window.File);
  // jsdom's FormData(form) copies uploaded files with size 0; read them from the inputs like a browser would
  class BrowserLikeFormData extends window.FormData {
    constructor(form?: HTMLFormElement) {
      super(form);
      form?.querySelectorAll<HTMLInputElement>("input[type=file]").forEach((i) => {
        const f = i.files?.[0];
        if (f) this.set(i.name, f);
      });
    }
  }
  vi.stubGlobal("FormData", BrowserLikeFormData);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const typeAndSubmit = async (value: string) => {
  const user = userEvent.setup();
  const box = screen.getByLabelText(t("check.label"));
  if (value) await user.type(box, value);
  await user.click(screen.getByRole("button", { name: t("check.submit") }));
  return user;
};

describe("CheckForm", () => {
  it("rejects input that is neither a package name nor a Play URL, without calling the API", async () => {
    render(<CheckForm locale="en" />);
    await typeAndSubmit("not a package");
    expect(await screen.findByRole("alert")).toHaveTextContent(t("check.invalid"));
    expect(screen.getByLabelText(t("check.label"))).toHaveAttribute("aria-invalid", "true");
    expect(api.postCheck).not.toHaveBeenCalled();
  });

  it("an empty submit is also invalid", async () => {
    render(<CheckForm locale="en" />);
    await typeAndSubmit("");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("the example link fills in the demo package", async () => {
    render(<CheckForm locale="en" />);
    await userEvent.setup().click(screen.getByRole("button", { name: t("check.hint") }));
    expect(screen.getByLabelText(t("check.label"))).toHaveValue("in.example.chaiwallet");
  });

  it("opens the report straight away when the API already has one", async () => {
    api.postCheck.mockResolvedValue({ kind: "report", report: { report_id: "r_cached 1" } });
    render(<CheckForm locale="en" />);
    await typeAndSubmit("in.example.shopkart");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/en/r/r_cached%201"));
    expect(api.postCheck).toHaveBeenCalledWith({ package_name: "in.example.shopkart" });
  });

  it("a Hindi page navigates to the Hindi report", async () => {
    api.postCheck.mockResolvedValue({ kind: "report", report: { report_id: "r_1" } });
    render(<CheckForm locale="hi" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(hi("check.label")), "in.example.shopkart");
    await user.click(screen.getByRole("button", { name: hi("check.submit") }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hi/r/r_1"));
  });

  it("follows a job over server-sent events, shows progress, then opens the report", async () => {
    api.postCheck.mockResolvedValue({ kind: "job", job_id: "j1", status_url: "/v1/jobs/j1", events_url: "/v1/jobs/j1/events" });
    render(<CheckForm locale="en" />);
    await typeAndSubmit("in.example.shopkart");
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    expect(FakeEventSource.last!.url).toBe("http://localhost:8000/v1/jobs/j1/events");
    const bar = await screen.findByRole("progressbar");
    FakeEventSource.last!.emit("progress", { job_id: "j1", status: "running", stage: "fetch_policy", progress: 0.4 });
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "40"));
    FakeEventSource.last!.emit("done", { job_id: "j1", status: "done", stage: "done", progress: 1, report_id: "r_new" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/en/r/r_new"));
    expect(FakeEventSource.last!.closed).toBe(true);
  });

  it("shows the job's error and lets the user retry", async () => {
    api.postCheck.mockResolvedValue({ kind: "job", job_id: "j2", status_url: "/s", events_url: "/e" });
    render(<CheckForm locale="en" />);
    const user = await typeAndSubmit("in.example.shopkart");
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    FakeEventSource.last!.emit("error", { job_id: "j2", status: "error", error: "Play listing unavailable" });
    // the "error" listener is not one of the named events the client subscribes to, so use "message"
    FakeEventSource.last!.emit("message", { job_id: "j2", status: "error", error: "Play listing unavailable" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Play listing unavailable");
    await user.click(screen.getByRole("button", { name: t("common.retry") }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("falls back to polling when the event stream drops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.postCheck.mockResolvedValue({ kind: "job", job_id: "j3", status_url: "/v1/jobs/j3", events_url: "/e" });
    api.getJob.mockResolvedValueOnce({ job_id: "j3", status: "running", stage: "analyse_apk", progress: 0.5 })
      .mockResolvedValueOnce({ job_id: "j3", status: "done", stage: "done", progress: 1, report_id: "r_polled" });
    render(<CheckForm locale="en" />);
    fireEvent.change(screen.getByLabelText(t("check.label")), { target: { value: "in.example.shopkart" } });
    fireEvent.click(screen.getByRole("button", { name: t("check.submit") }));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    FakeEventSource.last!.readyState = FakeEventSource.CLOSED;
    FakeEventSource.last!.onerror?.();
    await waitFor(() => expect(api.getJob).toHaveBeenCalledWith("/v1/jobs/j3"));
    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/en/r/r_polled"));
  });

  it("without EventSource support it polls from the start", async () => {
    vi.stubGlobal("EventSource", undefined);
    api.postCheck.mockResolvedValue({ kind: "job", job_id: "j4", status_url: "/v1/jobs/j4", events_url: "/e" });
    api.getJob.mockResolvedValue({ job_id: "j4", status: "done", stage: "done", progress: 1, report_id: "r_p" });
    render(<CheckForm locale="en" />);
    await typeAndSubmit("in.example.shopkart");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/en/r/r_p"));
  });

  it("an unreachable API offers the demo report", async () => {
    api.postCheck.mockRejectedValue(new ApiUnreachable("Failed to fetch"));
    render(<CheckForm locale="en" />);
    await typeAndSubmit("in.example.shopkart");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("http://localhost:8000");
    expect(screen.getByRole("link", { name: t("check.openDemo") })).toHaveAttribute("href", "/en/r/r_demo_chaiwallet");
  });

  it("an API error is shown as the server worded it", async () => {
    api.postCheck.mockRejectedValue(new ApiError("Play listing fetch needs the optional 'play' extra", 422));
    render(<CheckForm locale="en" />);
    await typeAndSubmit("com.real.app");
    expect(await screen.findByRole("alert")).toHaveTextContent("needs the optional 'play' extra");
  });

  it("disables the form while a check is running (no double submit)", async () => {
    api.postCheck.mockReturnValue(new Promise(() => {}));
    render(<CheckForm locale="en" />);
    await typeAndSubmit("in.example.shopkart");
    expect(await screen.findByRole("button", { name: t("check.running") })).toBeDisabled();
    expect(screen.getByLabelText(t("check.label"))).toBeDisabled();
  });
});

describe("DisputeForm", () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText(t("about.email")), "dev@example.com");
    await user.type(screen.getByLabelText(t("about.message")), "We changed the policy.");
  };

  it("prefills the report and finding from the link the report page builds", () => {
    search = new URLSearchParams({ report: "r_demo_shopkart", finding: "f_dm_01" });
    render(<DisputeForm locale="en" />);
    expect(screen.getByLabelText(t("about.reportId"))).toHaveValue("r_demo_shopkart");
    expect(screen.getByLabelText(new RegExp(t("about.findingId")))).toHaveValue("f_dm_01");
  });

  it("sends the dispute and confirms; an empty finding id is omitted", async () => {
    api.postDispute.mockResolvedValue(undefined);
    render(<DisputeForm locale="en" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(t("about.reportId")), "r_demo_shopkart");
    await fill(user);
    await user.click(screen.getByRole("button", { name: t("about.submit") }));
    expect(await screen.findByRole("status")).toHaveTextContent(t("about.sent"));
    expect(api.postDispute).toHaveBeenCalledWith({
      report_id: "r_demo_shopkart", finding_id: undefined, contact_email: "dev@example.com", message: "We changed the policy.",
    });
  });

  it("a failed submission keeps the form and says so", async () => {
    api.postDispute.mockRejectedValue(new ApiError("report not found", 404));
    search = new URLSearchParams({ report: "r_missing" });
    render(<DisputeForm locale="en" />);
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole("button", { name: t("about.submit") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("about.failed"));
    expect(screen.getByLabelText(t("about.message"))).toHaveValue("We changed the policy.");
  });
});

describe("SelfCheckForm validation", () => {
  it("lists every missing requirement and sends nothing", async () => {
    render(<SelfCheckForm locale="en" />);
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    const text = document.body.textContent ?? "";
    expect(text).toContain(t("selfCheck.needApk"));
    expect(text).toContain(t("selfCheck.needPolicy"));
    expect(text).toContain(t("selfCheck.consent"));
    expect(api.postSelfCheck).not.toHaveBeenCalled();
  });
});

describe("SelfCheckForm submission", () => {
  const sampleReport = { ...(sample as object), report_id: "r_sc_abc" };  // a complete report, so ReportView can render it

  async function fillValid(overrides: { ds?: string } = {}) {
    const user = userEvent.setup();
    const apk = new File(["PK\u0003\u0004"], "app.apk", { type: "application/vnd.android.package-archive" });
    await user.upload(screen.getByLabelText(t("selfCheck.apk")), apk);
    await user.type(screen.getByLabelText(t("selfCheck.policyText")), "We never collect your precise location.");
    if (overrides.ds !== undefined) fireEvent.change(screen.getByLabelText(t("selfCheck.dataSafety")), { target: { value: overrides.ds } });
    await user.click(screen.getByRole("checkbox"));
    return user;
  }
  const submit = () => fireEvent.submit(document.querySelector("form")!);

  it("rejects data-safety text that is not JSON", async () => {
    render(<SelfCheckForm locale="en" />);
    await fillValid({ ds: "{not json" });
    submit();
    await waitFor(() => expect(document.body.textContent).toContain(t("selfCheck.badJson")));
    expect(api.postSelfCheck).not.toHaveBeenCalled();
  });

  it("sends multipart with only the fields that were filled in, and shows the private result", async () => {
    api.postSelfCheck.mockResolvedValue({ kind: "report", report: sampleReport });
    render(<SelfCheckForm locale="en" />);
    await fillValid({ ds: '{"no_data_shared": true}' });
    submit();
    await waitFor(() => expect(api.postSelfCheck).toHaveBeenCalledTimes(1));
    const fd = api.postSelfCheck.mock.calls[0][0] as FormData;
    expect((fd.get("apk") as File).name).toBe("app.apk");
    expect(fd.get("policy_text")).toBe("We never collect your precise location.");
    expect(fd.get("data_safety")).toBe('{"no_data_shared": true}');
    expect(fd.has("policy_url")).toBe(false); // empty optional fields are not sent
    expect(fd.has("data_safety_file")).toBe(false);
    expect(await screen.findByText(t("selfCheck.resultTitle") + ".", { exact: false })).toBeInTheDocument();
    expect(document.body.textContent).toContain(t("selfCheck.private"));
  });

  it("waits for a queued job, then fetches its report", async () => {
    api.postSelfCheck.mockResolvedValue({ kind: "job", job_id: "j9", status_url: "/v1/jobs/j9", events_url: "/e" });
    api.getJob.mockResolvedValue({ job_id: "j9", status: "done", report_id: "r_sc_abc" });
    api.fetchReportClient.mockResolvedValue(sampleReport);
    render(<SelfCheckForm locale="en" />);
    await fillValid();
    submit();
    await waitFor(() => expect(api.fetchReportClient).toHaveBeenCalledWith("r_sc_abc"));
    expect(await screen.findByText(t("selfCheck.resultTitle") + ".", { exact: false })).toBeInTheDocument();
  });

  it("explains an unreachable API and an API error, and keeps the form for another try", async () => {
    api.postSelfCheck.mockRejectedValueOnce(new ApiUnreachable("down"));
    render(<SelfCheckForm locale="en" />);
    await fillValid();
    submit();
    await waitFor(() => expect(document.body.textContent).toContain("http://localhost:8000"));
    expect(document.body.textContent).not.toContain(t("selfCheck.resultTitle") + ".");
  });
});
