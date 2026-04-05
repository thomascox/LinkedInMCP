import { type Page } from "playwright";
import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated, rateLimit } from "../browser";
import { compactJson, randomDelay } from "../response-utils";

// -- Types -----------------------------------------------------------------

type PostVisibility = "anyone" | "connections";

type ReactionType = "like" | "celebrate" | "support" | "funny" | "love" | "insightful";

interface FeedPost {
  author: string;
  authorHeadline: string;
  text: string;
  likes: string;
  comments: string;
  postUrl: string;
}

// -- get_feed --------------------------------------------------------------

async function getFeed(): Promise<string> {
  logger.info("Fetching LinkedIn home feed...");

  const { browser, page } = await launchWithSession();

  try {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    ensureAuthenticated(page);

    await page.waitForSelector(
      "div.core-rail, div[data-id='feed-container'], main",
      { timeout: 15000 }
    );
    // Wait for at least one post card to render (feed is JS-hydrated after skeleton)
    await page.waitForSelector(
      "div.feed-shared-update-v2, div[data-urn*='activity']",
      { timeout: 10000 }
    ).catch(() => {});

    const posts: FeedPost[] = await page.evaluate(() => {
      const items: FeedPost[] = [];

      const cards = document.querySelectorAll(
        "div.feed-shared-update-v2, " +
        "div[data-urn*='ugcPost'], " +
        "div[data-urn*='activity']"
      );

      for (let i = 0; i < cards.length && items.length < 10; i++) {
        const card = cards[i];

        // Skip promoted/sponsored posts
        const promoEl =
          card.querySelector("span.feed-shared-actor__sub-description") ||
          card.querySelector("span.update-components-actor__sub-description");
        const promoText = (promoEl?.textContent || "").toLowerCase();
        if (promoText.includes("promoted") || promoText.includes("sponsored")) {
          continue;
        }

        const authorEl =
          card.querySelector(
            "span.feed-shared-actor__name span[aria-hidden='true']"
          ) ||
          card.querySelector(
            "a.update-components-actor__name span[aria-hidden='true']"
          );

        const headlineEl =
          card.querySelector(
            "span.feed-shared-actor__description span[aria-hidden='true']"
          ) ||
          card.querySelector(
            "span.update-components-actor__description span[aria-hidden='true']"
          );

        const textEl =
          card.querySelector(
            "div.feed-shared-update-v2__description span[dir='ltr']"
          ) ||
          card.querySelector(
            "div.update-components-text span[dir='ltr']"
          ) ||
          card.querySelector("div.feed-shared-text-view span[dir='ltr']");

        const likesEl =
          card.querySelector(
            "span.social-details-social-counts__reactions-count"
          ) ||
          card.querySelector("button[aria-label*='reaction'] span");

        const commentsEl =
          card.querySelector(
            "li.social-details-social-counts__comments a"
          ) ||
          card.querySelector("button[aria-label*='comment'] span");

        // Build post URL from data-urn attribute
        const urn = card.getAttribute("data-urn") || "";
        const postUrl = urn
          ? `https://www.linkedin.com/feed/update/${urn}/`
          : "";

        const author = authorEl?.textContent?.trim() || "";
        const authorHeadline = headlineEl?.textContent?.trim() || "";
        const text = (textEl?.textContent?.trim() || "").slice(0, 300);
        const likes = likesEl?.textContent?.trim() || "0";
        const comments = commentsEl?.textContent?.trim() || "0";

        if (author || text) {
          items.push({ author, authorHeadline, text, likes, comments, postUrl });
        }
      }

      return items;
    });

    logger.info(`Scraped ${posts.length} feed posts.`);
    return compactJson(posts);
  } finally {
    await browser.close();
  }
}

// -- create_post -----------------------------------------------------------

async function createPost(text: string, visibility: PostVisibility): Promise<string> {
  await rateLimit();
  logger.info(`Creating post (visibility: ${visibility})...`);

  const { browser, page } = await launchWithSession();

  try {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    ensureAuthenticated(page);

    await page.waitForSelector(
      "div.share-box-feed-entry, main",
      { timeout: 15000 }
    );

    // Click "Start a post"
    const startPostBtn = page.locator(
      [
        "button.share-box-feed-entry__trigger",
        "button.share-box-feed-entry__open",
        'div[role="button"]:has-text("Start a post")',
        'button:has-text("Start a post")',
      ].join(", ")
    ).first();

    await startPostBtn.waitFor({ state: "visible", timeout: 10000 });
    await startPostBtn.click();

    // Wait for composer dialog
    const composer = page.locator(
      'div.share-creation-state__main, div[role="dialog"]:has(div[contenteditable="true"])'
    ).first();
    await composer.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(1000);

    // Type content
    const textArea = composer.locator(
      'div[contenteditable="true"][role="textbox"], div[contenteditable="true"]'
    ).first();
    await textArea.waitFor({ state: "visible", timeout: 5000 });
    await textArea.click();
    await textArea.pressSequentially(text, { delay: randomDelay() });
    await page.waitForTimeout(500);

    // Change visibility if needed (LinkedIn default is "Anyone")
    if (visibility === "connections") {
      await setPostVisibilityToConnections(page, composer);
    }

    // Click Post button
    const postButton = composer.locator(
      [
        "button.share-actions__primary-action",
        'button[class*="share-actions__primary"]',
        'button:has-text("Post")',
      ].join(", ")
    ).first();

    await postButton.waitFor({ state: "visible", timeout: 5000 });
    await postButton.click();

    // Wait for post to submit
    await page.waitForTimeout(3000);

    logger.info("Post created successfully.");
    return compactJson({ status: "posted", visibility });
  } finally {
    await browser.close();
  }
}

async function setPostVisibilityToConnections(
  page: Page,
  composer: ReturnType<Page["locator"]>
): Promise<void> {
  const visBtn = composer.locator(
    'button[aria-label*="visibility"], button[class*="visibility"], button:has-text("Anyone")'
  ).first();

  if (!(await visBtn.isVisible().catch(() => false))) return;

  await visBtn.click();
  await page.waitForTimeout(600);

  const connectionsOption = page.locator(
    'li:has-text("Connections only"), label:has-text("Connections only")'
  ).first();

  if (await connectionsOption.isVisible().catch(() => false)) {
    await connectionsOption.click();
    await page.waitForTimeout(500);

    const doneBtn = page.locator(
      'button:has-text("Save"), button:has-text("Done")'
    ).first();
    if (await doneBtn.isVisible().catch(() => false)) {
      await doneBtn.click();
      await page.waitForTimeout(500);
    }
  }
}

// -- react_to_post ---------------------------------------------------------

const REACTION_LABELS: Record<ReactionType, string> = {
  like: "Like",
  celebrate: "Celebrate",
  support: "Support",
  funny: "Funny",
  love: "Love",
  insightful: "Insightful",
};

async function reactToPost(postUrl: string, reaction: ReactionType): Promise<string> {
  await rateLimit();
  logger.info(`Reacting to post (${reaction}): ${postUrl}`);

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    ensureAuthenticated(page);

    await page.waitForSelector(
      "div.feed-shared-update-v2, main",
      { timeout: 15000 }
    );
    await page.waitForTimeout(1500);

    // Find the Like/React button
    const likeButton = page.locator(
      [
        'button[aria-label="React Like"]',
        'button.react-button__trigger',
        'button[data-control-name="like_toggle"]',
        'button:has-text("Like")',
      ].join(", ")
    ).first();

    await likeButton.waitFor({ state: "visible", timeout: 8000 });

    if (reaction === "like") {
      await likeButton.click();
      await page.waitForTimeout(1000);
      return compactJson({ status: "reacted", reaction: "like" });
    }

    // Hover to open reaction picker
    await likeButton.hover();
    await page.waitForTimeout(1200);

    const label = REACTION_LABELS[reaction];
    const reactionBtn = page.locator(
      `button[aria-label="${label}"], li[aria-label="${label}"] button`
    ).first();

    if (await reactionBtn.isVisible().catch(() => false)) {
      await reactionBtn.click();
      await page.waitForTimeout(1000);
      logger.info(`Reacted with "${reaction}" to post.`);
      return compactJson({ status: "reacted", reaction });
    }

    return compactJson({
      status: "error",
      message: `Reaction picker for "${reaction}" not found. Try "like" as a fallback.`,
    });
  } finally {
    await browser.close();
  }
}

// -- Exported handlers -----------------------------------------------------

export async function handleGetFeed(): Promise<string> {
  return getFeed();
}

export async function handleCreatePost(args: {
  text: string;
  visibility?: PostVisibility;
}): Promise<string> {
  return createPost(args.text, args.visibility ?? "anyone");
}

export async function handleReactToPost(args: {
  post_url: string;
  reaction: ReactionType;
}): Promise<string> {
  return reactToPost(args.post_url, args.reaction);
}
