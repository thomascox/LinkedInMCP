import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated, rateLimit } from "../browser";
import { compactJson } from "../response-utils";

// -- Types -----------------------------------------------------------------

type ConnectionAction = "list_received" | "accept" | "decline";

interface ConnectionCard {
  name: string;
  headline: string;
  profileUrl: string;
}

interface InvitationCard {
  name: string;
  headline: string;
  profileUrl: string;
  mutualConnections: string;
}

// -- send_connection_request -----------------------------------------------

async function sendConnectionRequest(
  profileUrl: string,
  note?: string
): Promise<string> {
  await rateLimit();
  logger.info(`Sending connection request to: ${profileUrl}`);

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    ensureAuthenticated(page);

    await page.waitForSelector(
      "div.pv-top-card, section.pv-top-card, main.scaffold-layout__main",
      { timeout: 15000 }
    );
    await page.waitForTimeout(1500);

    // Check if already connected (1st degree badge)
    const firstDegree = page.locator(
      'span.dist-value:has-text("1st"), span:has-text("1st degree connection")'
    ).first();
    if (await firstDegree.isVisible().catch(() => false)) {
      return compactJson({ status: "already_connected" });
    }

    // Try direct Connect button first
    let connectButton = page.locator(
      [
        'button.pv-s-profile-actions__action:has-text("Connect")',
        'button[aria-label*="Connect"]:not([aria-label*="message"])',
        'div.pv-top-card-v2-ctas button:has-text("Connect")',
        'main button:has-text("Connect")',
      ].join(", ")
    ).first();

    let connectVisible = await connectButton.isVisible().catch(() => false);

    if (!connectVisible) {
      // Try "More" dropdown
      const moreButton = page.locator(
        'button[aria-label="More actions"], button:has-text("More")'
      ).first();

      if (await moreButton.isVisible().catch(() => false)) {
        await moreButton.click();
        await page.waitForTimeout(600);

        connectButton = page.locator(
          'div.artdeco-dropdown__content li:has-text("Connect"), ' +
          '.pvs-profile-actions__action:has-text("Connect")'
        ).first();
        connectVisible = await connectButton.isVisible().catch(() => false);
      }
    }

    if (!connectVisible) {
      // Check if request is already pending
      const pendingEl = page.locator(
        'button:has-text("Pending"), span:has-text("Pending")'
      ).first();
      if (await pendingEl.isVisible().catch(() => false)) {
        return compactJson({ status: "pending" });
      }
      return compactJson({
        status: "connect_button_not_found",
        message:
          "Connect button not found. Profile may be private, or this person requires InMail (no mutual connection path).",
      });
    }

    await connectButton.click();
    await page.waitForTimeout(1000);

    // Check for note modal
    const addNoteButton = page.locator('button:has-text("Add a note")').first();
    const addNoteVisible = await addNoteButton.isVisible().catch(() => false);

    if (note && addNoteVisible) {
      await addNoteButton.click();
      await page.waitForTimeout(500);
      const noteInput = page.locator('textarea[name="message"]').first();
      await noteInput.waitFor({ state: "visible", timeout: 5000 });
      await noteInput.fill(note.slice(0, 300));
    }

    // Send (with or without note)
    const sendButton = page.locator(
      [
        'button[aria-label="Send now"]',
        'button:has-text("Send without a note")',
        'button:has-text("Send")',
      ].join(", ")
    ).first();

    await sendButton.waitFor({ state: "visible", timeout: 5000 });
    await sendButton.click();
    await page.waitForTimeout(2000);

    // Check for weekly limit warning
    const limitEl = page.locator(
      'div:has-text("weekly invitation limit"), div:has-text("invitation limit")'
    ).first();
    if (await limitEl.isVisible().catch(() => false)) {
      return compactJson({
        status: "limit_reached",
        message:
          "Weekly invitation limit reached. LinkedIn caps connection requests per week — try again later.",
      });
    }

    logger.info(`Connection request sent to ${profileUrl}`);
    return compactJson({ status: "sent" });
  } finally {
    await browser.close();
  }
}

// -- get_connections -------------------------------------------------------

async function getConnections(search?: string): Promise<string> {
  logger.info(`Fetching connections${search ? ` (filter: "${search}")` : ""}...`);

  const { browser, page } = await launchWithSession();

  try {
    let url = "https://www.linkedin.com/mynetwork/invite-connect/connections/";
    if (search) {
      url += `?search=${encodeURIComponent(search)}`;
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    ensureAuthenticated(page);

    await page.waitForSelector(
      "ul.mn-connections__list, div.scaffold-finite-scroll__content",
      { timeout: 15000 }
    );
    await page.waitForTimeout(2000);

    const connections: ConnectionCard[] = await page.evaluate(() => {
      const items: ConnectionCard[] = [];
      const cards = document.querySelectorAll(
        "li.mn-connection-card, li.scaffold-finite-scroll__item"
      );
      const limit = Math.min(cards.length, 20);

      for (let i = 0; i < limit; i++) {
        const card = cards[i];
        const linkEl = card.querySelector(
          "a.mn-connection-card__link, a[href*='/in/']"
        ) as HTMLAnchorElement | null;
        const nameEl =
          card.querySelector("span.mn-connection-card__name") ||
          card.querySelector("span.t-16.t-black.t-bold");
        const headlineEl =
          card.querySelector("span.mn-connection-card__occupation") ||
          card.querySelector("span.t-14.t-black--light");

        const name = nameEl?.textContent?.trim() || "";
        const headline = headlineEl?.textContent?.trim() || "";
        let profileUrl = linkEl?.href || "";

        if (profileUrl) {
          try {
            const u = new URL(profileUrl);
            profileUrl = `${u.origin}${u.pathname}`;
          } catch {
            // keep as-is
          }
        }

        if (name) items.push({ name, headline, profileUrl });
      }

      return items;
    });

    logger.info(`Retrieved ${connections.length} connections.`);
    return compactJson(connections);
  } finally {
    await browser.close();
  }
}

// -- manage_connection_requests --------------------------------------------

async function manageConnectionRequests(
  action: ConnectionAction,
  profileUrl?: string
): Promise<string> {
  logger.info(`manage_connection_requests: action=${action}`);

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(
      "https://www.linkedin.com/mynetwork/invitation-manager/",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    ensureAuthenticated(page);

    await page.waitForSelector(
      "section.mn-invitations-tabs-container, ul.invitation-list, main",
      { timeout: 15000 }
    );
    await page.waitForTimeout(2000);

    if (action === "list_received") {
      const requests: InvitationCard[] = await page.evaluate(() => {
        const items: InvitationCard[] = [];
        const cards = document.querySelectorAll(
          "li.invitation-card, li[class*='invitation']"
        );
        const limit = Math.min(cards.length, 20);

        for (let i = 0; i < limit; i++) {
          const card = cards[i];
          const linkEl = card.querySelector(
            "a[href*='/in/']"
          ) as HTMLAnchorElement | null;
          const nameEl =
            card.querySelector("span.invitation-card__title") ||
            card.querySelector("strong.invitation-card__title") ||
            card.querySelector("span.t-16.t-bold");
          const headlineEl =
            card.querySelector("p.invitation-card__subtitle") ||
            card.querySelector("span.t-14.t-black--light");
          const mutualEl =
            card.querySelector("span.invitation-card__caption") ||
            card.querySelector("span.member-insights__count");

          const name = nameEl?.textContent?.trim() || "";
          const headline = headlineEl?.textContent?.trim() || "";
          const mutualConnections = mutualEl?.textContent?.trim() || "";
          let url = linkEl?.href || "";

          if (url) {
            try {
              const u = new URL(url);
              url = `${u.origin}${u.pathname}`;
            } catch {
              // keep as-is
            }
          }

          if (name) items.push({ name, headline, profileUrl: url, mutualConnections });
        }

        return items;
      });

      logger.info(`Found ${requests.length} pending connection requests.`);
      return compactJson(requests);
    }

    // accept or decline
    if (!profileUrl) {
      throw new Error("profile_url is required for accept and decline actions.");
    }

    // Find the card index in one evaluate() call instead of N Playwright RPC calls
    const targetPath = profileUrl.split("?")[0].replace(/\/$/, "");
    const cardIndex = await page.evaluate((targetPath: string) => {
      const cards = document.querySelectorAll("li.invitation-card, li[class*='invitation']");
      for (let i = 0; i < cards.length; i++) {
        const link = cards[i].querySelector("a[href*='/in/']") as HTMLAnchorElement | null;
        const hrefPath = (link?.href || "").split("?")[0].replace(/\/$/, "");
        if (hrefPath && (hrefPath.endsWith(targetPath) || targetPath.endsWith(hrefPath))) {
          return i;
        }
      }
      return -1;
    }, targetPath);

    if (cardIndex === -1) {
      return compactJson({
        status: "not_found",
        message: "No pending invitation found from this profile.",
      });
    }

    const card = page.locator("li.invitation-card, li[class*='invitation']").nth(cardIndex);

    if (action === "accept") {
      const acceptBtn = card.locator('button:has-text("Accept")').first();
      await acceptBtn.waitFor({ state: "visible", timeout: 5000 });
      await acceptBtn.click();
    } else {
      const ignoreBtn = card
        .locator('button:has-text("Ignore"), button[aria-label*="Ignore"]')
        .first();
      await ignoreBtn.waitFor({ state: "visible", timeout: 5000 });
      await ignoreBtn.click();
    }

    await page.waitForTimeout(2000);
    logger.info(`Connection request from ${profileUrl}: ${action}d.`);
    return compactJson({
      status: action === "accept" ? "accepted" : "declined",
      profileUrl,
    });
  } finally {
    await browser.close();
  }
}

// -- Exported handlers -----------------------------------------------------

export async function handleSendConnectionRequest(args: {
  profile_url: string;
  note?: string;
}): Promise<string> {
  return sendConnectionRequest(args.profile_url, args.note);
}

export async function handleGetConnections(args: {
  search?: string;
}): Promise<string> {
  return getConnections(args.search);
}

export async function handleManageConnectionRequests(args: {
  action: ConnectionAction;
  profile_url?: string;
}): Promise<string> {
  return manageConnectionRequests(args.action, args.profile_url);
}
