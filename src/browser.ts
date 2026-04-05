import { chromium, type Page, type Browser, type BrowserContext } from "playwright";
import fs from "fs";
import { config } from "./config";
import { applyStealthScripts } from "./stealth";
import { rateLimit } from "./rate-limiter";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Launch a headless browser reusing the persistent profile from capture.
 *
 * Uses launchPersistentContext so that the full browser state saved during
 * login (cookies, localStorage, IndexedDB, service workers, fingerprint data)
 * is present — not just cookies. LinkedIn fingerprints sessions on login and
 * rejects requests where the subsequent context doesn't match.
 *
 * Every call enforces the global rate limit (10-30s between actions)
 * and applies stealth init scripts to the context before returning.
 *
 * NOTE: Chromium locks the userDataDir while open. Only one context can use
 * it at a time. Cancel any in-progress Easy Apply session before calling
 * other tools.
 */
export async function launchWithSession(): Promise<BrowserSession> {
  if (!fs.existsSync(config.browser.userDataDir)) {
    throw new Error(
      "No saved session found. Run manage_auth_session with action 'capture' first."
    );
  }

  await rateLimit();

  const context = await chromium.launchPersistentContext(config.browser.userDataDir, {
    headless: true,
    channel: "chromium",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  await applyStealthScripts(context);

  const page = await context.newPage();

  // launchPersistentContext returns a BrowserContext, not a Browser.
  // Tool files all call browser.close() in their finally blocks — wrap
  // context.close() so that interface stays unchanged.
  const browser = { close: () => context.close() } as unknown as Browser;

  return { browser, context, page };
}

export function ensureAuthenticated(page: Page): void {
  const url = page.url();
  if (
    url.includes("/login") ||
    url.includes("/authwall") ||
    url.includes("/checkpoint/")
  ) {
    throw new Error(
      "Session expired or blocked — LinkedIn redirected to an auth page " +
      `(${url}). Re-run manage_auth_session with 'capture'.`
    );
  }
}

export { rateLimit } from "./rate-limiter";
