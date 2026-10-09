/**
 * End-to-end UI check in a real DOM (jsdom) against the live RPC.
 *
 * Mounts the actual app, clicks the real "scan launches" button, waits for the
 * table to fill from chain data, then exercises the drawer and the simulator tab.
 * This is the closest thing to a browser pass that runs headless here.
 *
 *   npx tsx scripts/ui-check.tsx
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost:4173/",
  pretendToBeVisual: true,
});

const g = globalThis as unknown as Record<string, unknown>;
function expose(key: string, value: unknown) {
  try {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  } catch {
    /* some globals (e.g. navigator on Node 24) are getter-only — not needed by React DOM */
  }
}
expose("window", dom.window);
expose("document", dom.window.document);
expose("navigator", dom.window.navigator);
expose("localStorage", dom.window.localStorage);
for (const name of ["HTMLElement", "HTMLInputElement", "Element", "Node", "Event", "MouseEvent", "AbortController"]) {
  if (name === "AbortController") continue; // Node's own is fine for fetch
  expose(name, (dom.window as unknown as Record<string, unknown>)[name]);
}
expose("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
g.IS_REACT_ACT_ENVIRONMENT = false;

const { createRoot } = await import("react-dom/client");
const { createElement } = await import("react");
const { default: App } = await import("../src/App");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const root = createRoot(dom.window.document.getElementById("root")!);
root.render(createElement(App));

const text = () => dom.window.document.body.textContent ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(250);
  }
  console.log(`      (timed out waiting for ${label})`);
  return false;
}

await waitFor(() => text().includes("Launch Lab"), 5_000, "initial render");
check("app mounts and renders the masthead", text().includes("Launch Lab"));
check("tabs are present", ["Live launches", "Launch simulator", "How it works"].every((t) => text().includes(t)));

// ---- click the real scan button ----
const buttons = Array.from(dom.window.document.querySelectorAll("button"));
const scanBtn = buttons.find((b) => (b.textContent ?? "").toLowerCase().includes("scan launches"));
check("scan button exists and is clickable", Boolean(scanBtn) && !scanBtn!.hasAttribute("disabled"));
scanBtn!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

const sawProgress = await waitFor(() => text().includes("scanning logs") || text().includes("reading state") || text().includes("resolving"), 10_000, "scan progress");
check("scan kicks off and reports progress", sawProgress, text().slice(0, 120).replace(/\s+/g, " "));

const gotRows = await waitFor(() => dom.window.document.querySelectorAll(".tr.clickable").length > 0, 120_000, "table rows");
const rowCount = dom.window.document.querySelectorAll(".tr.clickable").length;
check("launch table fills from live chain data", gotRows && rowCount > 0, `${rowCount} rows rendered`);

const firstRowText = dom.window.document.querySelector(".tr.clickable")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
check("rows carry a name, symbol and numbers", /\S/.test(firstRowText) && /\d/.test(firstRowText), firstRowText.slice(0, 90));
check("stats panel appeared", text().includes("launches found") && text().includes("raised (enriched)"));
check("activity strip rendered", dom.window.document.querySelectorAll(".strip-bar").length > 0);

// ---- open the detail drawer ----
const firstRow = dom.window.document.querySelector(".tr.clickable") as HTMLElement | null;
firstRow?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const drawer = await waitFor(() => dom.window.document.querySelector(".detail") !== null, 5_000, "detail drawer");
check("detail drawer opens on row click", drawer);
check("drawer shows the model-vs-contract check", text().includes("Model vs contract") && text().includes("quoteBuy"));

// ---- run the live model verification from the drawer (classic rows) ----
// V6 rows intentionally have no run-check button: their curve exposes no members
// to check against. Either path is a pass; a contradiction is a failure.
const checkBtn = Array.from(dom.window.document.querySelectorAll(".detail button")).find((b) =>
  (b.textContent ?? "").toLowerCase().includes("run check"),
);
const v6Explained = text().includes("Not applicable on a") && text().includes("quoteBuyExactIn");
check("drawer offers the run-check button or explains why V6 cannot be modelled", Boolean(checkBtn) || v6Explained);

if (checkBtn) {
  checkBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const verified = await waitFor(
    () => text().includes("model reproduces the contract") || text().includes("MISMATCH"),
    60_000,
    "verification result",
  );
  const verdict = text().includes("model reproduces the contract")
    ? "contract reproduced"
    : text().includes("MISMATCH")
      ? "MISMATCH"
      : "no verdict";
  check("live verification against the deployed curve passes", verified && verdict === "contract reproduced", verdict);
} else {
  check("V6 row explains the absent check and the quote-derived price", v6Explained);
}

// ---- simulator tab ----
const simTab = Array.from(dom.window.document.querySelectorAll("button")).find((b) => b.textContent === "Launch simulator");
simTab?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const simOk = await waitFor(() => text().includes("Launch configuration") && text().includes("Will it graduate?"), 5_000, "simulator tab");
check("simulator tab renders", simOk);
check("simulator produced projections", /\d+\.\dx/.test(text()) && text().includes("tokens you get for the opening buy"));
check("buy ladder table rendered", dom.window.document.querySelectorAll(".ladder .tr").length > 5);
check("config score rendered", /Config score/.test(text()) && /Graduation reachability/.test(text()));

console.log(`\n${failures === 0 ? "ALL UI CHECKS PASSED" : `${failures} UI CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
