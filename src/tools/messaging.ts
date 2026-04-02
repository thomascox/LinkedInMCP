import { type Page } from "playwright";
import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated } from "../browser";

// -- Types -----------------------------------------------------------------

interface ConversationThread {
  senderName: string;
  lastMessageSnippet: string;
}

// -- Helpers ---------------------------------------------------------------

function randomDelay(): number {
  return Math.floor(Math.random() * (150 - 50 + 1)) + 50;
}

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
      const items: { senderName: string; lastMessageSnippet: string }[] = [];

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

        const senderName = nameEl?.textContent?.trim() || "Unknown";
        const lastMessageSnippet = snippetEl?.textContent?.trim() || "";

        items.push({ senderName, lastMessageSnippet });
      }

      return items;
    });

    logger.info(`Retrieved ${threads.length} conversation threads.`);
    return JSON.stringify(threads, null, 2);
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
