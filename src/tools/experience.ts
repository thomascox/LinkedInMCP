import { type Page } from "playwright";
import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated } from "../browser";
import { compactJson } from "../response-utils";

// -- Types -----------------------------------------------------------------

export interface ExperienceArgs {
  action: "add" | "edit";
  match_title?: string;   // edit only: partial text to match existing entry title
  title?: string;
  company?: string;
  employment_type?: string;
  location?: string;
  location_type?: string;
  start_month?: number;   // 1-12
  start_year?: number;
  end_month?: number;     // 1-12 — omit or leave undefined for current roles
  end_year?: number;
  is_current?: boolean;
  description?: string;
}

// -- Constants -------------------------------------------------------------

const MONTHS = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const EXP_PAGE = "https://www.linkedin.com/in/me/details/experience/";

// -- Navigate to the edit/add form -----------------------------------------

// For "edit": navigate to /details/experience/, click Load more, find the
// edit link whose aria-label contains match_title (case-insensitive), then
// navigate to its href.
async function navigateToEditForm(page: Page, matchTitle: string): Promise<void> {
  await page.goto(EXP_PAGE, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(1500);
  ensureAuthenticated(page);

  // Load the experience list
  const loadMore = page.locator("button").filter({ hasText: /^Load more$/ }).first();
  if (await loadMore.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loadMore.click();
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() =>
      page.waitForTimeout(2000)
    );
  }

  // Find the edit link by case-insensitive match on aria-label
  const editLinks = page.locator('a[aria-label^="Edit "]');
  const count = await editLinks.count();

  for (let i = 0; i < count; i++) {
    const label = (await editLinks.nth(i).getAttribute("aria-label")) ?? "";
    if (label.toLowerCase().includes(matchTitle.toLowerCase())) {
      const href = await editLinks.nth(i).getAttribute("href");
      if (href) {
        await page.goto(href, { waitUntil: "load", timeout: 45000 });
        await page.waitForTimeout(1000);
        return;
      }
    }
  }

  throw new Error(
    `No experience entry found with title matching "${matchTitle}". ` +
      `Use get_profile to see current experience titles.`
  );
}

// For "add": navigate to /details/experience/, click Load more, then click
// the "Add a position or career break" button to open the add form.
async function navigateToAddForm(page: Page): Promise<void> {
  await page.goto(EXP_PAGE, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(1500);
  ensureAuthenticated(page);

  const loadMore = page.locator("button").filter({ hasText: /^Load more$/ }).first();
  if (await loadMore.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loadMore.click();
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() =>
      page.waitForTimeout(2000)
    );
  }

  const addBtn = page.locator('button[aria-label="Add a position or career break"]').first();
  await addBtn.waitFor({ state: "visible", timeout: 8000 });
  await addBtn.click();
  await page.waitForTimeout(1000);
}

// -- Fill the experience form ----------------------------------------------

// DOM inspection (April 2026) confirmed stable selectors:
//   Title:           input[placeholder="Ex: Retail Sales Manager"]
//   Company:         input[placeholder="Ex: Microsoft"]
//   Location:        input[placeholder="Ex: London, United Kingdom"]
//   Employment type: select with label "Employment type"
//   Location type:   select with label "Location type"
//   Start month/yr:  first pair of Month*/Year* selects
//   End month/yr:    second pair of Month*/Year* selects
//   Currently:       <p> "I am currently working in this role" → adjacent checkbox
//   Description:     textarea (only one on the form)
//   Save:            button[name="Save"]

async function fillExperienceForm(page: Page, args: ExperienceArgs): Promise<void> {
  // Wait for the form to be ready
  await page.waitForFunction(
    () => !!document.querySelector('input[placeholder="Ex: Retail Sales Manager"]'),
    { timeout: 15000 }
  );
  await page.waitForTimeout(400);

  // Title
  if (args.title !== undefined) {
    await page.getByPlaceholder("Ex: Retail Sales Manager").fill(args.title);
  }

  // Company — try autocomplete first, fall back to plain text
  if (args.company !== undefined) {
    const companyInput = page.getByPlaceholder("Ex: Microsoft");
    await companyInput.fill(args.company);
    await page.waitForTimeout(1000);
    const suggestion = page.locator('[role="option"]').first();
    if (await suggestion.isVisible({ timeout: 1500 }).catch(() => false)) {
      await suggestion.click();
      await page.waitForTimeout(500);
    }
  }

  // Employment type
  if (args.employment_type !== undefined) {
    await page.getByLabel("Employment type").selectOption({ label: args.employment_type });
  }

  // "I am currently working in this role" checkbox
  // Find it via the adjacent <p> text since the checkbox has no visible label.
  if (args.is_current !== undefined) {
    const isChecked: boolean = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("p")).find((el) =>
        el.textContent?.includes("I am currently working in this role")
      );
      if (!p) return false;
      // Walk up to find the nearest checkbox
      let el: HTMLElement | null = p.parentElement;
      while (el) {
        const cb = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (cb) return cb.checked;
        el = el.parentElement;
      }
      return false;
    });

    if (args.is_current !== isChecked) {
      // Click the <p> text which is the de-facto label for this checkbox
      await page.getByText("I am currently working in this role").first().click();
      await page.waitForTimeout(500);
    }
  }

  // Start date (month then year — always nth(0) of their respective labels)
  if (args.start_month !== undefined) {
    await page.getByLabel(/month/i).nth(0).selectOption({ label: MONTHS[args.start_month] });
  }
  if (args.start_year !== undefined) {
    await page.getByLabel(/year/i).nth(0).selectOption({ label: String(args.start_year) });
  }

  // End date — only visible when "currently working" is unchecked
  if (args.end_month !== undefined) {
    await page.getByLabel(/month/i).nth(1).selectOption({ label: MONTHS[args.end_month] });
  }
  if (args.end_year !== undefined) {
    await page.getByLabel(/year/i).nth(1).selectOption({ label: String(args.end_year) });
  }

  // Location (free text)
  if (args.location !== undefined) {
    await page.getByPlaceholder("Ex: London, United Kingdom").fill(args.location);
  }

  // Location type
  if (args.location_type !== undefined) {
    await page.getByLabel("Location type").selectOption({ label: args.location_type });
  }

  // Description — fill() is instant, no per-character delay
  if (args.description !== undefined) {
    await page.locator("textarea").first().fill(args.description);
  }

  // Save
  await page.getByRole("button", { name: "Save" }).click();

  // Wait for navigation away from the form (back to experience list or profile)
  await page.waitForFunction(
    () =>
      !window.location.href.includes("/edit/forms/") &&
      !window.location.href.includes("/experience/add"),
    { timeout: 20000 }
  );
}

// -- Exported handler ------------------------------------------------------

export async function handleManageExperience(args: ExperienceArgs): Promise<string> {
  const { browser, page } = await launchWithSession();

  try {
    if (args.action === "edit") {
      if (!args.match_title) {
        throw new Error("'match_title' is required for the edit action.");
      }
      logger.info(`Editing experience entry matching "${args.match_title}"`);
      await navigateToEditForm(page, args.match_title);
    } else {
      if (!args.title) {
        throw new Error("'title' is required for the add action.");
      }
      logger.info(`Adding new experience entry: "${args.title}"`);
      await navigateToAddForm(page);
    }

    await fillExperienceForm(page, args);

    const summary = compactJson({
      status: "success",
      action: args.action,
      title: args.title ?? args.match_title,
      company: args.company,
    });

    logger.info(`Experience ${args.action} completed: "${args.title ?? args.match_title}"`);
    return summary;
  } finally {
    await browser.close();
  }
}
