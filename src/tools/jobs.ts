import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated } from "../browser";
import { compactJson } from "../response-utils";

// -- Types -----------------------------------------------------------------

interface JobDetails {
  title: string;
  company: string;
  location: string;
  workplaceType: string;
  postedDate: string;
  applicantCount: string;
  easyApply: boolean;
  description: string;
}

interface SavedJobCard {
  jobId: string;
  title: string;
  company: string;
  location: string;
  easyApply: boolean;
}

// -- get_job_details -------------------------------------------------------

async function getJobDetails(jobId: string): Promise<string> {
  logger.info(`Fetching job details for job ${jobId}...`);

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(
      `https://www.linkedin.com/jobs/view/${jobId}/`,
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    ensureAuthenticated(page);

    await page.waitForSelector(
      "div.jobs-unified-top-card, div.job-view-layout, main",
      { timeout: 15000 }
    );
    // Wait for job title to hydrate before scraping
    await page.waitForSelector(
      "h1, div.jobs-description-content__text",
      { timeout: 10000 }
    ).catch(() => {});

    // Expand full description if truncated
    const seeMoreBtn = page.locator(
      'button.jobs-description__footer-button, ' +
      'button[aria-label="Click to see more description"], ' +
      'footer.jobs-description__details button'
    ).first();

    if (await seeMoreBtn.isVisible().catch(() => false)) {
      await seeMoreBtn.click();
      await page.waitForTimeout(500);
    }

    const details: JobDetails = await page.evaluate(() => {
      // Scope to main to avoid nav/sidebar noise
      const main = document.querySelector("main") || document;

      const title =
        main.querySelector(
          "h1.job-details-jobs-unified-top-card__job-title, " +
          "h1.t-24.t-bold.inline"
        )?.textContent?.trim() || "";

      const company =
        main.querySelector(
          "a.job-details-jobs-unified-top-card__company-name, " +
          "span.jobs-unified-top-card__company-name a, " +
          "div.job-details-jobs-unified-top-card__company-name"
        )?.textContent?.trim() || "";

      // Location and workplace type are often in the same element or adjacent spans
      const metaItems = Array.from(
        main.querySelectorAll(
          "span.jobs-unified-top-card__bullet, " +
          "span.job-details-jobs-unified-top-card__bullet, " +
          "li.job-details-jobs-unified-top-card__job-insight span[aria-hidden='true']"
        )
      ).map((el) => el.textContent?.trim() || "").filter(Boolean);

      const location = metaItems[0] || "";
      const workplaceType = metaItems[1] || "";

      const postedDate =
        main.querySelector(
          "span.jobs-unified-top-card__posted-date, " +
          "span.job-details-jobs-unified-top-card__posted-date"
        )?.textContent?.trim() || "";

      const applicantCount =
        main.querySelector(
          "span.jobs-unified-top-card__applicant-count, " +
          "figcaption.jobs-unified-top-card__applicant-count, " +
          "span.jobs-unified-top-card__bullet ~ span"
        )?.textContent?.trim() || "";

      const easyApplyBtn = main.querySelector(
        'button[aria-label*="Easy Apply"], button.jobs-apply-button'
      );
      const easyApply = !!easyApplyBtn;

      // Description — innerText for clean plain text, cap at 2000 chars
      const descEl = main.querySelector(
        "div.jobs-description-content__text, " +
        "div#job-details, " +
        "article.jobs-description__container"
      ) as HTMLElement | null;
      const description = (descEl?.innerText || "").trim().slice(0, 2000);

      return { title, company, location, workplaceType, postedDate, applicantCount, easyApply, description };
    });

    logger.info(`Job details fetched: "${details.title}" at "${details.company}".`);
    return compactJson(details);
  } finally {
    await browser.close();
  }
}

// -- save_job --------------------------------------------------------------

async function saveJob(jobId: string): Promise<string> {
  logger.info(`Saving job ${jobId}...`);

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(
      `https://www.linkedin.com/jobs/view/${jobId}/`,
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    ensureAuthenticated(page);

    await page.waitForSelector(
      "div.jobs-unified-top-card, main",
      { timeout: 15000 }
    );
    await page.waitForTimeout(1000);

    const saveButton = page.locator(
      'button[aria-label*="Save job"], button[aria-label*="save job"], button.jobs-save-button'
    ).first();

    const saveVisible = await saveButton.isVisible().catch(() => false);
    if (!saveVisible) {
      return compactJson({ status: "error", message: "Save button not found." });
    }

    const ariaLabel = (await saveButton.getAttribute("aria-label") || "").toLowerCase();
    if (ariaLabel.includes("unsave") || ariaLabel.includes("saved")) {
      return compactJson({ status: "already_saved", jobId });
    }

    await saveButton.click();
    await page.waitForTimeout(1500);

    logger.info(`Job ${jobId} saved.`);
    return compactJson({ status: "saved", jobId });
  } finally {
    await browser.close();
  }
}

// -- get_saved_jobs --------------------------------------------------------

async function getSavedJobs(): Promise<string> {
  logger.info("Fetching saved jobs...");

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(
      "https://www.linkedin.com/my-items/saved-jobs/",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    ensureAuthenticated(page);

    await page.waitForSelector(
      "ul.reusable-search__entity-result-list, " +
      "div.scaffold-finite-scroll__content, " +
      "main",
      { timeout: 15000 }
    );
    await page.waitForTimeout(2000);

    const jobs: SavedJobCard[] = await page.evaluate(() => {
      const items: SavedJobCard[] = [];

      const cards = document.querySelectorAll(
        "li.reusable-search__result-container, " +
        "li.scaffold-finite-scroll__item, " +
        "li.job-card-container"
      );
      const limit = Math.min(cards.length, 20);

      for (let i = 0; i < limit; i++) {
        const card = cards[i];

        const linkEl = card.querySelector(
          "a[href*='/jobs/view/']"
        ) as HTMLAnchorElement | null;
        const jobId = linkEl?.href?.match(/\/jobs\/view\/(\d+)/)?.[1] || "";

        const titleEl =
          card.querySelector("a.job-card-list__title") ||
          card.querySelector("a.job-card-container__link strong") ||
          card.querySelector("span.entity-result__title-text a span[aria-hidden='true']");

        const companyEl =
          card.querySelector("span.job-card-container__primary-description") ||
          card.querySelector("a.job-card-container__company-name") ||
          card.querySelector("div.artdeco-entity-lockup__subtitle span");

        const locationEl =
          card.querySelector("li.job-card-container__metadata-item") ||
          card.querySelector("div.artdeco-entity-lockup__caption span");

        const easyApplyEl =
          card.querySelector("li.job-card-container__apply-method") ||
          card.querySelector("span:has-text('Easy Apply')");

        const title = titleEl?.textContent?.trim() || "";
        const company = companyEl?.textContent?.trim() || "";
        const location = locationEl?.textContent?.trim() || "";
        const easyApply = (easyApplyEl?.textContent?.toLowerCase() || "").includes("easy apply");

        if (title || jobId) {
          items.push({ jobId, title, company, location, easyApply });
        }
      }

      return items;
    });

    logger.info(`Retrieved ${jobs.length} saved jobs.`);
    return compactJson(jobs);
  } finally {
    await browser.close();
  }
}

// -- Exported handlers -----------------------------------------------------

export async function handleGetJobDetails(args: { job_id: string }): Promise<string> {
  return getJobDetails(args.job_id);
}

export async function handleSaveJob(args: { job_id: string }): Promise<string> {
  return saveJob(args.job_id);
}

export async function handleGetSavedJobs(): Promise<string> {
  return getSavedJobs();
}
