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
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    ensureAuthenticated(page);

    // Wait for the conversation list to render.
    await page.waitForSelector(
      'li.msg-conversation-listitem, li.msg-conversations-container__convo-item, ul.msg-conversations-container__conversations-list li',
      { timeout: 15000 }
    );

    // Short pause for any lazy-loaded content.
    await page.waitForTimeout(2000);

    const threads: ConversationThread[] = await page.evaluate(() => {
      const items: { senderName: string; lastMessageSnippet: string; conversationUrl: string }[] = [];

      const convos = document.querySelectorAll(
        'li.msg-conversation-listitem, li.msg-conversations-container__convo-item'
      );

      const limit = Math.min(convos.length, 10);

      for (let i = 0; i < limit; i++) {
        const convo = convos[i];

        const nameEl =
          convo.querySelector('h3.msg-conversation-listitem__participant-names span') ||
          convo.querySelector('h3.msg-conversation-card__participant-names span') ||
          convo.querySelector('span.msg-conversation-listitem__participant-names');

        const snippetEl =
          convo.querySelector('p.msg-conversation-listitem__message-snippet') ||
          convo.querySelector('p.msg-conversation-card__message-snippet') ||
          convo.querySelector('span.msg-conversation-listitem__message-snippet-body');

        // Extract conversation URL from the thread link
        const linkEl = convo.querySelector(
          'a[href*="/messaging/thread/"], a.msg-conversation-listitem__link'
        ) as HTMLAnchorElement | null;
        let conversationUrl = linkEl?.href || "";
        if (conversationUrl && !conversationUrl.startsWith("http")) {
          conversationUrl = `https://www.linkedin.com${conversationUrl}`;
        }

        const senderName = nameEl?.textContent?.trim() || "Unknown";
        const lastMessageSnippet = snippetEl?.textContent?.trim() || "";

        items.push({ senderName, lastMessageSnippet, conversationUrl });
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
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    ensureAuthenticated(page);

    // Wait for profile actions section to load.
    await page.waitForSelector(
      'div.pv-top-card, section.pv-top-card, main.scaffold-layout__main',
      { timeout: 15000 }
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
    await page.goto(conversationUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    ensureAuthenticated(page);

    await page.waitForSelector(
      "ul.msg-s-message-list, div.msg-s-message-list-container, main",
      { timeout: 15000 }
    );

    // Wait for at least one message bubble to render
    await page.waitForSelector(
      "p.msg-s-event-listitem__body, div.msg-s-event__content p",
      { timeout: 10000 }
    ).catch(() => {});

    const messages: Message[] = await page.evaluate(() => {
      const items: { sender: string; text: string; time: string }[] = [];

      // Messages are grouped by sender/time blocks
      const groups = document.querySelectorAll(
        "li.msg-s-message-list__event, " +
        "div.msg-s-event-listitem"
      );

      // Walk all message groups, collecting up to 20 messages
      for (let i = 0; i < groups.length && items.length < 20; i++) {
        const group = groups[i];

        // Each group may have multiple bubble items
        const bubbles = group.querySelectorAll(
          "p.msg-s-event-listitem__body, " +
          "span.msg-s-event-listitem__body, " +
          "div.msg-s-event__content p"
        );

        if (bubbles.length === 0) continue;

        const senderEl =
          group.querySelector("span.msg-s-message-group__profile-link") ||
          group.querySelector("a.msg-s-message-group__link span") ||
          group.querySelector("span.msg-s-event__author");

        const timeEl =
          group.querySelector("time.msg-s-message-group__timestamp") ||
          group.querySelector("span.msg-s-message-group__timestamp");

        const sender = senderEl?.textContent?.trim() || "them";
        const time = timeEl?.textContent?.trim() || "";

        bubbles.forEach((bubble) => {
          const text = (bubble.textContent?.trim() || "").slice(0, 500);
          if (text) items.push({ sender, text, time });
        });
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
