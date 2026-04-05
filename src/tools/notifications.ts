import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated } from "../browser";
import { compactJson } from "../response-utils";

// -- Types -----------------------------------------------------------------

type NotificationType =
  | "connection"
  | "job"
  | "reaction"
  | "comment"
  | "mention"
  | "birthday"
  | "work_anniversary"
  | "profile_view"
  | "post_share"
  | "unknown";

interface Notification {
  type: NotificationType;
  actor: string;
  text: string;
  time: string;
}

// -- get_notifications -----------------------------------------------------

async function getNotifications(): Promise<string> {
  logger.info("Fetching LinkedIn notifications...");

  const { browser, page } = await launchWithSession();

  try {
    await page.goto("https://www.linkedin.com/notifications/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    ensureAuthenticated(page);

    await page.waitForSelector(
      "div.nt-card-list, ul[aria-label='Notifications'], main",
      { timeout: 15000 }
    );
    await page.waitForTimeout(2000);

    const notifications: Notification[] = await page.evaluate(() => {
      const items: Notification[] = [];

      const cards = document.querySelectorAll(
        "div.nt-card, " +
        "li.nt-card, " +
        "div[data-urn*='notification']"
      );
      const limit = Math.min(cards.length, 10);

      for (let i = 0; i < limit; i++) {
        const card = cards[i];

        const actorEl =
          card.querySelector("span.nt-card__actor-name") ||
          card.querySelector("a.nt-card__actor-link span[aria-hidden='true']") ||
          card.querySelector("span.t-bold");

        const textEl =
          card.querySelector("p.nt-card__text") ||
          card.querySelector("div.nt-card__description") ||
          card.querySelector("span.notification-item__text");

        const timeEl =
          card.querySelector("time.nt-card__time-stamp") ||
          card.querySelector("span.nt-card__time-stamp") ||
          card.querySelector("time");

        const actor = actorEl?.textContent?.trim() || "";
        const text = (textEl?.textContent?.trim() || "").slice(0, 200);
        const time = timeEl?.textContent?.trim() || "";
        const cardClass = card.className || "";

        const type = ((): "connection" | "job" | "reaction" | "comment" | "mention" | "birthday" | "work_anniversary" | "profile_view" | "post_share" | "unknown" => {
          const c = cardClass.toLowerCase();
          const t = text.toLowerCase();
          if (c.includes("connection") || t.includes("connected") || t.includes("accept")) return "connection";
          if (c.includes("job") || t.includes("job") || t.includes("hiring")) return "job";
          if (c.includes("like") || c.includes("reaction") || t.includes("reacted") || t.includes("liked")) return "reaction";
          if (c.includes("comment") || t.includes("commented")) return "comment";
          if (c.includes("mention") || t.includes("mentioned")) return "mention";
          if (c.includes("birthday") || t.includes("birthday")) return "birthday";
          if (c.includes("anniversary") || t.includes("anniversary")) return "work_anniversary";
          if (t.includes("viewed your profile")) return "profile_view";
          if (t.includes("shared") || t.includes("reposted")) return "post_share";
          return "unknown";
        })();

        if (text || actor) {
          items.push({ type, actor, text, time });
        }
      }

      return items;
    });

    logger.info(`Retrieved ${notifications.length} notifications.`);
    return compactJson(notifications);
  } finally {
    await browser.close();
  }
}

// -- get_unread_count ------------------------------------------------------

async function getUnreadCount(): Promise<string> {
  logger.info("Checking unread message/notification counts...");

  const { browser, page } = await launchWithSession();

  try {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    ensureAuthenticated(page);

    await page.waitForTimeout(2000);

    const counts = await page.evaluate(() => {
      // Messaging unread badge — various possible selectors
      const msgBadge =
        document.querySelector(
          'a[href*="/messaging/"] .notification-badge__count, ' +
          'a[href*="/messaging/"] .nav-item__badge-count, ' +
          'li[data-control-name="nav.messaging"] .notification-badge__count'
        );
      const unreadMessages = parseInt(msgBadge?.textContent?.trim() || "0", 10) || 0;

      // Notifications unread badge
      const notifBadge =
        document.querySelector(
          'a[href*="/notifications/"] .notification-badge__count, ' +
          'a[href*="/notifications/"] .nav-item__badge-count'
        );
      const unreadNotifications = parseInt(notifBadge?.textContent?.trim() || "0", 10) || 0;

      return { unreadMessages, unreadNotifications };
    });

    return compactJson(counts);
  } finally {
    await browser.close();
  }
}

// -- Exported handlers -----------------------------------------------------

export async function handleGetNotifications(): Promise<string> {
  return getNotifications();
}

export async function handleGetUnreadCount(): Promise<string> {
  return getUnreadCount();
}
