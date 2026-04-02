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
 * Launch a headless browser with saved session state and stealth patches.
 *
 * Every call enforces the global rate limit (10-30s between actions)
 * and applies stealth init scripts to the context before returning.
 */
export async function launchWithSession(): Promise<BrowserSession> {
  if (!fs.existsSync(config.browser.storageStatePath)) {
    throw new Error(
      "No saved session found. Run manage_auth_session with action 'capture' first."
    );
  }

  await rateLimit();

  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const context = await browser.newContext({
    storageState: config.browser.storageStatePath,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  await applyStealthScripts(context);

  const page = await context.newPage();
  return { browser, context, page };
}

export function ensureAuthenticated(page: Page): void {
  if (page.url().includes("/login")) {
    throw new Error(
      "Session expired — LinkedIn redirected to login. Re-run manage_auth_session with 'capture'."
    );
  }
}

export { rateLimit } from "./rate-limiter";
