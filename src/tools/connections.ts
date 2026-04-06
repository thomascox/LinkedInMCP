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
    await page.goto(profileUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);
    await page.waitForFunction(
      () => document.title.includes("| LinkedIn") && document.title.length > 15,
      { timeout: 30000 }
    );

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

    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() =>
      page.waitForTimeout(3000)
    );

    const connections: ConnectionCard[] = await page.evaluate(() => {
      const items: ConnectionCard[] = [];
      // Stable: profile links are always /in/ paths; group by li parent
      const links = Array.from(
        document.querySelectorAll('a[href*="/in/"]')
      ) as HTMLAnchorElement[];

      const seen = new Set<string>();
      for (const link of links) {
        let href = link.href;
        try { href = new URL(href).origin + new URL(href).pathname; } catch { /**/ }
        if (seen.has(href) || !href.includes("/in/")) continue;
        seen.add(href);

        // Name: first non-empty text-only descendant of the link
        const nameSpan = link.querySelector("span[aria-hidden='true']") || link;
        const name = nameSpan.textContent?.trim() || "";

        // Headline: look in the same li/card container, a sibling p element
        const container = link.closest("li") || link.parentElement;
        const ps = Array.from(container?.querySelectorAll("p") || [])
          .map((p) => p.textContent?.trim())
          .filter((t): t is string => !!t && t.length > 0 && t !== name);
        const headline = ps[0] || "";

        if (name) items.push({ name, headline, profileUrl: href });
        if (items.length >= 20) break;
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
      { waitUntil: "load", timeout: 45000 }
    );
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() =>
      page.waitForTimeout(3000)
    );

    if (action === "list_received") {
      const requests: InvitationCard[] = await page.evaluate(() => {
        const items: InvitationCard[] = [];
        // Stable: find profile links, then extract card context
        const links = Array.from(
          document.querySelectorAll('a[href*="/in/"]')
        ) as HTMLAnchorElement[];
        const seen = new Set<string>();
        for (const link of links) {
          let href = link.href;
          try { href = new URL(href).origin + new URL(href).pathname; } catch { /**/ }
          if (seen.has(href)) continue;
          seen.add(href);
          const container = link.closest("li") || link.parentElement;
          const ps = Array.from(container?.querySelectorAll("p, span") || [])
            .map((el) => el.textContent?.trim())
            .filter((t): t is string => !!t && t.length > 2);
          const name = ps[0] || link.textContent?.trim() || "";
          const headline = ps[1] || "";
          const mutualConnections = ps.find((t) => /mutual|connection/i.test(t)) || "";
          if (name) items.push({ name, headline, profileUrl: href, mutualConnections });
          if (items.length >= 20) break;
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

    // Find the li containing the target profile link, then click its action button
    const targetPath = profileUrl.split("?")[0].replace(/\/$/, "");
    const found = await page.evaluate((targetPath: string) => {
      const links = Array.from(
        document.querySelectorAll('a[href*="/in/"]')
      ) as HTMLAnchorElement[];
      for (const link of links) {
        const hrefPath = (link.href || "").split("?")[0].replace(/\/$/, "");
        if (hrefPath.endsWith(targetPath) || targetPath.endsWith(hrefPath)) {
          const li = link.closest("li");
          return li ? Array.from(document.querySelectorAll("li")).indexOf(li as HTMLLIElement) : -1;
        }
      }
      return -1;
    }, targetPath);

    if (found === -1) {
      return compactJson({
        status: "not_found",
        message: "No pending invitation found from this profile.",
      });
    }

    const card = page.locator("li").nth(found);

    if (action === "accept") {
      const acceptBtn = card.getByRole("button", { name: /accept/i }).first();
      await acceptBtn.waitFor({ state: "visible", timeout: 5000 });
      await acceptBtn.click();
    } else {
      const ignoreBtn = card
        .getByRole("button", { name: /ignore/i })
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
