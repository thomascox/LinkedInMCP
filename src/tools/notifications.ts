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
      waitUntil: "load",
      timeout: 45000,
    });
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() =>
      page.waitForTimeout(3000)
    );

    const notifications: Notification[] = await page.evaluate(() => {
      const items: Notification[] = [];

      // data-urn is stable for notification items
      const cards = Array.from(
        document.querySelectorAll("[data-urn]")
      ).filter((el) => {
        const urn = el.getAttribute("data-urn") || "";
        return urn.includes("notification");
      });

      const limit = Math.min(cards.length, 10);

      for (let i = 0; i < limit; i++) {
        const card = cards[i];

        // Actor: first profile link text
        const actorLink = card.querySelector('a[href*="/in/"]');
        const actor = actorLink?.textContent?.trim() || "";

        // Text: all visible p/span text joined
        const textEls = Array.from(card.querySelectorAll("p, span"))
          .filter((el) => (el as HTMLElement).offsetParent !== null && el.children.length === 0);
        const text = textEls
          .map((el) => el.textContent?.trim())
          .filter((t): t is string => !!t && t.length > 2)
          .join(" ")
          .slice(0, 200);

        const timeEl = card.querySelector("time");
        const time = timeEl?.getAttribute("datetime") || timeEl?.textContent?.trim() || "";
        const cardClass = "";

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
      waitUntil: "load",
      timeout: 45000,
    });
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);

    const counts = await page.evaluate(() => {
      // LinkedIn nav aria-labels are confirmed stable (April 2026):
      // "Messaging, N new notifications" and "Notifications, N new notifications"
      function parseCountFromLabel(label: string | null): number {
        if (!label) return 0;
        const m = label.match(/(\d+)\s+new/);
        return m ? parseInt(m[1], 10) : 0;
      }

      const msgEl = document.querySelector('a[aria-label*="Messaging"]') ||
        document.querySelector('button[aria-label*="Messaging"]');
      const notifEl = document.querySelector('a[aria-label*="Notifications"]');

      const unreadMessages = parseCountFromLabel(msgEl?.getAttribute("aria-label") ?? null);
      const unreadNotifications = parseCountFromLabel(notifEl?.getAttribute("aria-label") ?? null);

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
