import { type Page } from "playwright";
import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated } from "../browser";
import { compactJson, randomDelay } from "../response-utils";

// -- Types -----------------------------------------------------------------

interface ConversationThread {
  senderName: string;
  lastMessageSnippet: string;
  conversationUrl: string;
}

interface Message {
  sender: string;
  text: string;
  time: string;
}

// -- Helpers ---------------------------------------------------------------

async function humanType(page: Page, selector: string, text: string): Promise<void> {
  const el = page.locator(selector);
  await el.click();
  await el.pressSequentially(text, { delay: randomDelay() });
}

// -- get_messages ----------------------------------------------------------

async function getMessages(): Promise<string> {
  logger.info("Fetching last 10 conversation threads...");

  const { browser, page } = await launchWithSession();

  try {
    await page.goto("https://www.linkedin.com/messaging/", {
      waitUntil: "load",
      timeout: 45000,
    });
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() =>
      page.waitForTimeout(3000)
    );

    const threads: ConversationThread[] = await page.evaluate(() => {
      const items: { senderName: string; lastMessageSnippet: string; conversationUrl: string }[] = [];

      // Stable: messaging thread links always contain /messaging/thread/
      const links = Array.from(
        document.querySelectorAll('a[href*="/messaging/thread/"]')
      ) as HTMLAnchorElement[];
      const seen = new Set<string>();

      for (const link of links) {
        const conversationUrl = link.href;
        if (seen.has(conversationUrl)) continue;
        seen.add(conversationUrl);

        const container = link.closest("li") || link.parentElement;
        const texts = Array.from(container?.querySelectorAll("span, p") || [])
          .map((el) => el.textContent?.trim())
          .filter((t): t is string => !!t && t.length > 1);

        const senderName = texts[0] || "Unknown";
        const lastMessageSnippet = texts[1] || "";

        items.push({ senderName, lastMessageSnippet, conversationUrl });
        if (items.length >= 10) break;
      }

      return items;
    });

    logger.info(`Retrieved ${threads.length} conversation threads.`);
    return compactJson(threads);
  } finally {
    await browser.close();
  }
}

// -- send_linkedin_message -------------------------------------------------

async function sendMessage(profileUrl: string, messageBody: string): Promise<string> {
  logger.info(`Sending message to profile: ${profileUrl}`);

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(profileUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);
    await page.waitForFunction(
      () => document.title.includes("| LinkedIn") && document.title.length > 15,
      { timeout: 30000 }
    );

    // Look for the Message button — only available for 1st-degree connections.
    const messageButton = page.locator(
      [
        'button:has-text("Message")',
        'a:has-text("Message")',
      ].join(", ")
    ).first();

    // Check if the button exists and is visible.
    const buttonVisible = await messageButton.isVisible().catch(() => false);
    if (!buttonVisible) {
      return (
        "Cannot send message — the 'Message' button is not available on this profile. " +
        "This typically means the user is not a 1st-degree connection."
      );
    }

    await messageButton.click();

    // Wait for the messaging modal/overlay to appear.
    const messageInput = page.locator(
      [
        'div.msg-form__contenteditable[contenteditable="true"]',
        'div[role="textbox"][contenteditable="true"]',
        'div.msg-form__msg-content-container div[contenteditable="true"]',
      ].join(", ")
    ).first();

    await messageInput.waitFor({ state: "visible", timeout: 10000 });

    // Click to focus, then type with human-like delay.
    await messageInput.click();
    await messageInput.pressSequentially(messageBody, { delay: randomDelay() });

    // Short pause to let LinkedIn process the input.
    await page.waitForTimeout(500);

    // Click the Send button.
    const sendButton = page.locator(
      [
        'button.msg-form__send-button',
        'button[type="submit"]:has-text("Send")',
        'button:has-text("Send")',
      ].join(", ")
    ).first();

    await sendButton.waitFor({ state: "visible", timeout: 5000 });
    await sendButton.click();

    // Wait briefly to confirm the message was sent.
    await page.waitForTimeout(2000);

    logger.info("Message sent successfully.");
    return `Message sent successfully to ${profileUrl}.`;
  } finally {
    await browser.close();
  }
}

// -- get_conversation ------------------------------------------------------

async function getConversation(conversationUrl: string): Promise<string> {
  logger.info(`Fetching conversation: ${conversationUrl}`);

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(conversationUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() =>
      page.waitForTimeout(3000)
    );

    const messages: Message[] = await page.evaluate(() => {
      const items: { sender: string; text: string; time: string }[] = [];

      // Collect all <p> elements in the message area; each is a message bubble
      // time elements are siblings or nearby; sender is in an <a> or <span> preceding them
      const main = document.querySelector("main") || document;
      const allPs = Array.from(main.querySelectorAll("p"))
        .filter((el) => (el as HTMLElement).offsetParent !== null);

      for (const p of allPs) {
        const text = (p.textContent?.trim() || "").slice(0, 500);
        if (!text || text.length < 2) continue;

        // Time from nearest <time> element in same container
        const container = p.parentElement;
        const timeEl = container?.querySelector("time") ||
          container?.parentElement?.querySelector("time");
        const time = timeEl?.getAttribute("datetime") || timeEl?.textContent?.trim() || "";

        // Sender from nearest <a> with an /in/ href (profile link)
        const senderLink = container?.querySelector('a[href*="/in/"]');
        const sender = senderLink?.textContent?.trim() || "them";

        items.push({ sender, text, time });
        if (items.length >= 20) break;
      }

      return items;
    });

    logger.info(`Retrieved ${messages.length} messages from conversation.`);
    return compactJson(messages);
  } finally {
    await browser.close();
  }
}

// -- Exported handlers -----------------------------------------------------

export async function handleGetMessages(): Promise<string> {
  return getMessages();
}

export async function handleSendLinkedinMessage(args: {
  profile_url: string;
  message_body: string;
}): Promise<string> {
  return sendMessage(args.profile_url, args.message_body);
}

export async function handleGetConversation(args: {
  conversation_url: string;
}): Promise<string> {
  return getConversation(args.conversation_url);
}
