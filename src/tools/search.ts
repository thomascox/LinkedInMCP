import { type Page } from "playwright";
import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated } from "../browser";
import { compactJson } from "../response-utils";

// -- Types -----------------------------------------------------------------

interface SearchFilters {
  location?: string;
  remote?: "onsite" | "remote" | "hybrid";
  experienceLevel?: "internship" | "entry" | "associate" | "mid-senior" | "director" | "executive";
}

interface PersonResult {
  name: string;
  headline: string;
  profileUrl: string;
}

interface JobResult {
  jobId: string;
  title: string;
  company: string;
  location: string;
  easyApply: boolean;
}

type SearchResult = PersonResult | JobResult;

// -- LinkedIn filter code mappings -----------------------------------------

const REMOTE_CODES: Record<string, string> = {
  onsite: "1",
  remote: "2",
  hybrid: "3",
};

const EXPERIENCE_CODES: Record<string, string> = {
  internship: "1",
  entry: "2",
  associate: "3",
  "mid-senior": "4",
  director: "5",
  executive: "6",
};

// -- URL builders ----------------------------------------------------------

function buildPeopleSearchUrl(keywords: string, filters: SearchFilters): string {
  const params = new URLSearchParams({
    keywords,
    origin: "GLOBAL_SEARCH_HEADER",
  });
  if (filters.location) {
    params.set("geoUrn", filters.location);
  }
  return `https://www.linkedin.com/search/results/people/?${params.toString()}`;
}

function buildJobSearchUrl(keywords: string, filters: SearchFilters): string {
  const params = new URLSearchParams({
    keywords,
    origin: "GLOBAL_SEARCH_HEADER",
  });
  if (filters.location) {
    params.set("location", filters.location);
  }
  if (filters.remote && REMOTE_CODES[filters.remote]) {
    params.set("f_WT", REMOTE_CODES[filters.remote]);
  }
  if (filters.experienceLevel && EXPERIENCE_CODES[filters.experienceLevel]) {
    params.set("f_E", EXPERIENCE_CODES[filters.experienceLevel]);
  }
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

// -- Infinite scroll helper ------------------------------------------------

async function scrollToLoadAll(page: Page, maxScrolls: number = 5): Promise<void> {
  let previousHeight = 0;

  for (let i = 0; i < maxScrolls; i++) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);

    if (currentHeight === previousHeight) {
      logger.debug(`Scroll ${i + 1}: no new content loaded — stopping.`);
      break;
    }

    previousHeight = currentHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    logger.debug(`Scroll ${i + 1}: scrolled to ${currentHeight}px, waiting for new results...`);

    // Wait for either new content or a network idle moment.
    await page.waitForTimeout(2000);
  }
}

// -- Scrapers --------------------------------------------------------------

async function scrapePeopleResults(page: Page): Promise<PersonResult[]> {
  await page.waitForSelector(
    'div.search-results-container, ul.reusable-search__entity-result-list',
    { timeout: 15000 }
  );

  await scrollToLoadAll(page);

  const results = await page.evaluate(() => {
    const items: { name: string; headline: string; profileUrl: string }[] = [];

    const cards = document.querySelectorAll(
      'li.reusable-search__result-container, div.entity-result'
    );

    cards.forEach((card) => {
      const linkEl = card.querySelector(
        'a.app-aware-link[href*="/in/"], span.entity-result__title-text a'
      ) as HTMLAnchorElement | null;

      const nameEl =
        card.querySelector('span.entity-result__title-text a span[aria-hidden="true"]') ||
        card.querySelector('span.entity-result__title-text span[dir="ltr"]') ||
        linkEl;

      const headlineEl =
        card.querySelector('div.entity-result__primary-subtitle') ||
        card.querySelector('p.entity-result__summary');

      const name = nameEl?.textContent?.trim() || "";
      const headline = headlineEl?.textContent?.trim() || "";
      let profileUrl = linkEl?.href || "";

      // Clean tracking params from profile URL.
      if (profileUrl) {
        try {
          const url = new URL(profileUrl);
          profileUrl = `${url.origin}${url.pathname}`;
        } catch {
          // keep as-is
        }
      }

      if (name) {
        items.push({ name, headline, profileUrl });
      }
    });

    return items;
  });

  return results;
}

async function scrapeJobResults(page: Page): Promise<JobResult[]> {
  await page.waitForSelector(
    'ul.jobs-search__results-list, div.jobs-search-results-list, ul.scaffold-layout__list-container',
    { timeout: 15000 }
  );

  await scrollToLoadAll(page);

  const results = await page.evaluate(() => {
    const items: {
      jobId: string;
      title: string;
      company: string;
      location: string;
      easyApply: boolean;
    }[] = [];

    const cards = document.querySelectorAll(
      'li.jobs-search-results__list-item, div.job-card-container, li.scaffold-layout__list-item'
    );

    cards.forEach((card) => {
      // Job ID from data attribute or the card's link.
      const jobId =
        card.getAttribute("data-occludable-job-id") ||
        card.getAttribute("data-job-id") ||
        card.querySelector('[data-job-id]')?.getAttribute("data-job-id") ||
        "";

      const titleEl =
        card.querySelector('a.job-card-list__title, a.job-card-container__link strong') ||
        card.querySelector('a[href*="/jobs/view/"]');

      const companyEl =
        card.querySelector('span.job-card-container__primary-description') ||
        card.querySelector('a.job-card-container__company-name') ||
        card.querySelector('div.artdeco-entity-lockup__subtitle span');

      const locationEl =
        card.querySelector('li.job-card-container__metadata-item') ||
        card.querySelector('span.job-card-container__metadata-wrapper--is-visible') ||
        card.querySelector('div.artdeco-entity-lockup__caption span');

      const easyApplyEl =
        card.querySelector('li.job-card-container__apply-method') ||
        card.querySelector('span.job-card-container__footer-job-state');

      const easyApplyText = easyApplyEl?.textContent?.toLowerCase() || "";

      const title = titleEl?.textContent?.trim() || "";
      const company = companyEl?.textContent?.trim() || "";
      const location = locationEl?.textContent?.trim() || "";
      const easyApply = easyApplyText.includes("easy apply");

      if (title || jobId) {
        items.push({ jobId, title, company, location, easyApply });
      }
    });

    return items;
  });

  return results;
}

// -- Main handler ----------------------------------------------------------

export async function handleSearchLinkedin(args: {
  category: string;
  keywords: string;
  filters?: SearchFilters;
}): Promise<string> {
  const { category, keywords, filters = {} } = args;

  const url =
    category === "PEOPLE"
      ? buildPeopleSearchUrl(keywords, filters)
      : buildJobSearchUrl(keywords, filters);

  logger.info(`Searching LinkedIn ${category}: ${url}`);

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    ensureAuthenticated(page);

    let results: SearchResult[];

    if (category === "PEOPLE") {
      results = await scrapePeopleResults(page);
    } else {
      results = await scrapeJobResults(page);
    }

    logger.info(`Scraped ${results.length} ${category.toLowerCase()} results.`);
    return compactJson(results);
  } finally {
    await browser.close();
  }
}
