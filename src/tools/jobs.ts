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
      { waitUntil: "load", timeout: 45000 }
    );
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);

    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() =>
      page.waitForTimeout(3000)
    );

    // Expand full description if truncated
    const seeMoreBtn = page.locator(
      'button[aria-label="Click to see more description"], ' +
      'button[aria-label*="see more"], ' +
      'button:has-text("See more")'
    ).first();

    if (await seeMoreBtn.isVisible().catch(() => false)) {
      await seeMoreBtn.click();
      await page.waitForTimeout(500);
    }

    const details: JobDetails = await page.evaluate(() => {
      const main = (document.querySelector("main") ?? document) as Element;

      // Title: h1 is present on job listing pages
      const titleEl = main.querySelector("h1");
      const title = titleEl?.textContent?.trim() ?? document.title.split(" - ")[0].trim() ?? "";

      // Company: stable link pattern
      const companyLink = main.querySelector('a[href*="/company/"]');
      const company = companyLink?.textContent?.trim() ?? "";

      // Metadata spans (location, workplace type)
      const metaItems = Array.from(
        main.querySelectorAll('li span[aria-hidden="true"], li span:not([aria-hidden])')
      )
        .map((el) => el.textContent?.trim() ?? "")
        .filter((t) => t.length > 1 && t !== "·");

      const location = metaItems[0] ?? "";
      const workplaceType = metaItems[1] ?? "";

      // Posted date and applicant count via text pattern matching
      const allSpanTexts = Array.from(main.querySelectorAll("span")).map(
        (el) => el.textContent?.trim() ?? ""
      );
      const postedDate = allSpanTexts.find((t) => /\d+\s*(hour|day|week|month|year)s?\s*ago/i.test(t)) ?? "";
      const applicantCount =
        allSpanTexts.find((t) => /applicant|people applied/i.test(t) && /\d/.test(t)) ?? "";

      // Easy Apply button — aria-label is stable
      const easyApply = !!main.querySelector('button[aria-label*="Easy Apply"]');

      // Description — div#job-details is a persistent ID on LinkedIn job pages
      const descEl = (main.querySelector("div#job-details") ??
        main.querySelector("article")) as HTMLElement | null;
      const description = (descEl?.innerText ?? "").trim().slice(0, 2000);

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
      { waitUntil: "load", timeout: 45000 }
    );
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);

    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() =>
      page.waitForTimeout(3000)
    );

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
      { waitUntil: "load", timeout: 45000 }
    );
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);

    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() =>
      page.waitForTimeout(3000)
    );

    const jobs: SavedJobCard[] = await page.evaluate(() => {
      const items: SavedJobCard[] = [];

      // Find all job view links — stable URL pattern regardless of class names
      const links = Array.from(
        document.querySelectorAll('a[href*="/jobs/view/"]')
      ) as HTMLAnchorElement[];
      const seen = new Set<string>();

      for (const link of links) {
        const jobId = link.href.match(/\/jobs\/view\/(\d+)/)?.[1] ?? "";
        if (!jobId || seen.has(jobId)) continue;
        seen.add(jobId);

        const container = link.closest("li") ?? link.parentElement;
        const spans = Array.from(container?.querySelectorAll("span") ?? [])
          .filter((el) => el.getAttribute("aria-hidden") !== "true")
          .map((el) => el.textContent?.trim() ?? "")
          .filter((t) => t.length > 1);

        const title = link.textContent?.trim() ?? spans[0] ?? "";
        const company = spans[1] ?? "";
        const location = spans[2] ?? "";
        const easyApply = (container?.textContent?.toLowerCase() ?? "").includes("easy apply");

        if (title || jobId) items.push({ jobId, title, company, location, easyApply });
        if (items.length >= 20) break;
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
