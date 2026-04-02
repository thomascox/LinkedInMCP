import { chromium, type Page, type Browser, type BrowserContext } from "playwright";
import fs from "fs";
import { config } from "./config";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function launchWithSession(): Promise<BrowserSession> {
  if (!fs.existsSync(config.browser.storageStatePath)) {
    throw new Error(
      "No saved session found. Run manage_auth_session with action 'capture' first."
    );
  }

  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
  });

  const context = await browser.newContext({
    storageState: config.browser.storageStatePath,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

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
