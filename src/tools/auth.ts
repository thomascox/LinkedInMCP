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
  if (!fs.existsSync(config.browser.storageStatePath)) {
    throw new Error(
      "No saved session found. Run manage_auth_session with action 'capture' first."
    );
  }

  logger.info("Launching headless browser to verify session...");

  await rateLimit();

  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const context = await browser.newContext({
    storageState: config.browser.storageStatePath,
    locale: "en-US",
  });

  await applyStealthScripts(context);

  const page = await context.newPage();

  await page.goto(FEED_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // LinkedIn redirects to /login if the session is invalid.
  if (page.url().includes("/login")) {
    await browser.close();
    return "Session is INVALID — LinkedIn redirected to the login page.";
  }

  // Look for the user's nav avatar as a positive signal.
  const avatar = page.locator(
    'img.global-nav__me-photo, img[alt="Photo of"], button.global-nav__primary-link--me-btn img'
  );

  try {
    await avatar.first().waitFor({ state: "visible", timeout: 15000 });
  } catch {
    await browser.close();
    return (
      "Session may be invalid — reached the feed but could not find the " +
      "user avatar. Consider re-capturing."
    );
  }

  await browser.close();
  logger.info("Session verified — avatar found on feed page.");
  return "Session is VALID — LinkedIn feed loaded and user avatar detected.";
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
