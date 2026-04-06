import { chromium } from "playwright";
import fs from "fs";
import { config } from "../config";
import { logger } from "../logger";
import { applyStealthScripts } from "../stealth";
import { rateLimit } from "../rate-limiter";

const LOGIN_URL = "https://www.linkedin.com/login";
const FEED_URL = "https://www.linkedin.com/feed";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for manual login
const POLL_INTERVAL_MS = 2000;

async function captureSession(): Promise<string> {
  logger.info("Launching headed browser for manual login...");

  const context = await chromium.launchPersistentContext(
    config.browser.userDataDir,
    {
      headless: false,
      channel: "chromium",
      viewport: { width: 1280, height: 800 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    }
  );

  await applyStealthScripts(context);

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  logger.info(
    `Navigated to login page. Waiting up to ${LOGIN_TIMEOUT_MS / 1000}s for manual login...`
  );

  // Poll the URL until we land on the feed, indicating successful login.
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const currentUrl = page.url();
    if (currentUrl.includes("/feed")) {
      logger.info("Detected /feed URL — login successful.");
      break;
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  if (!page.url().includes("/feed")) {
    await context.close();
    throw new Error(
      "Timed out waiting for login. The browser was open for " +
        `${LOGIN_TIMEOUT_MS / 1000}s without reaching the feed page.`
    );
  }

  await context.storageState({ path: config.browser.storageStatePath });
  logger.info(`Storage state saved to ${config.browser.storageStatePath}`);

  await context.close();
  return (
    "Session captured successfully. Storage state saved to " +
    config.browser.storageStatePath
  );
}

async function verifySession(): Promise<string> {
  if (!fs.existsSync(config.browser.userDataDir)) {
    throw new Error(
      "No saved session found. Run manage_auth_session with action 'capture' first."
    );
  }

  logger.info("Launching headless browser to verify session...");

  await rateLimit();

  // Use the same launchPersistentContext path that all tools use, so verify
  // actually tests the real session rather than a cookies-only fresh context.
  const context = await chromium.launchPersistentContext(
    config.browser.userDataDir,
    {
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
    }
  );

  await applyStealthScripts(context);

  const page = await context.newPage();

  await page.goto(FEED_URL, { waitUntil: "load", timeout: 45000 });

  // Allow JS to finish any client-side redirects before checking URL.
  await page.waitForTimeout(2000);

  const url = page.url();
  if (
    url.includes("/login") ||
    url.includes("/authwall") ||
    url.includes("/checkpoint/")
  ) {
    await context.close();
    return `Session is INVALID — LinkedIn redirected to ${url}. Re-run 'capture'.`;
  }

  // Confirm we're actually on the feed by checking for any h1 or nav element.
  let confirmed = false;
  try {
    await page.waitForSelector('h1, nav', { timeout: 10000 });
    confirmed = true;
  } catch {
    // Page loaded but no recognisable content — session may be degraded.
  }

  await context.close();

  if (confirmed) {
    logger.info("Session verified — feed loaded with valid session.");
    return `Session is VALID — LinkedIn feed loaded at ${url}.`;
  }
  return (
    "Session may be degraded — reached the feed URL but page content did not " +
    "render. Consider re-capturing."
  );
}

export async function handleManageAuthSession(args: {
  action: string;
}): Promise<string> {
  switch (args.action) {
    case "capture":
      return captureSession();
    case "verify":
      return verifySession();
    default:
      throw new Error(
        `Unknown action '${args.action}'. Use 'capture' or 'verify'.`
      );
  }
}
