import { type Page } from "playwright";
import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated } from "../browser";
import { compactJson, randomDelay } from "../response-utils";

// -- Types -----------------------------------------------------------------

interface ExperienceEntry {
  title: string;
  company: string;
  duration: string;
  description: string;
}

interface EducationEntry {
  school: string;
  degree: string;
  duration: string;
}

interface ProfileData {
  name: string;
  headline: string;
  location: string;
  about: string;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: string[];
}

type EditableSection = "headline" | "about";

const MY_PROFILE_URL = "https://www.linkedin.com/in/me/";

// -- Scroll helper ---------------------------------------------------------

// LinkedIn renders profile sections lazily — they only appear in the DOM
// after scrolling the custom overflow container main#workspace (not window).

async function scrollToLoadSections(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      const ws = document.querySelector("#workspace") as HTMLElement | null;
      (ws ?? document.documentElement).scrollBy(0, 800);
    });
    await page.waitForTimeout(700);
  }
  // One final scroll to bottom to ensure all lazy sections have loaded
  await page.evaluate(() => {
    const ws = document.querySelector("#workspace") as HTMLElement | null;
    const el = ws ?? document.documentElement;
    el.scrollTo(0, el.scrollHeight ?? 99999);
  });
  await page.waitForTimeout(1500);
}

// -- Full profile extractor (serialized into page context by Playwright) ---

function extractFullProfileInPage(): ProfileData {
  const name = (document.title || "").split(" | ")[0].trim();

  // -- Top card --
  // LinkedIn renders top-card fields as an ordered sequence of <p> elements.
  // No stable class names (all hashed). Order: headline → location → company → education.
  const main = document.querySelector("main");
  const ps = Array.from((main ?? document).querySelectorAll("p"))
    .filter((el) => (el as HTMLElement).offsetParent !== null)
    .map((el) => el.textContent?.trim() ?? "")
    .filter(
      (t) =>
        t.length > 0 &&
        t !== "·" &&
        t !== "Contact info" &&
        !/^\d+ connection/.test(t) &&
        !/^(Show|Add|Create|Get started|Open to work|Message|Connect|Follow)/.test(t)
    );

  // -- Section finder: locate a <section> by its <h2> heading text --
  // Stable against class-name hashing because it matches on text content.
  function findSection(keyword: string): Element | null {
    const kw = keyword.toLowerCase();
    for (const h2 of Array.from(document.querySelectorAll("h2"))) {
      const txt = (h2.textContent?.trim() ?? "").toLowerCase();
      if (txt === kw || txt.startsWith(kw + " ")) {
        return (
          h2.closest("section") ??
          h2.parentElement?.closest("section") ??
          h2.parentElement?.parentElement ??
          null
        );
      }
    }
    return null;
  }

  // -- About --
  const aboutSection = findSection("about");
  let about = "";
  if (aboutSection) {
    // Try span[dir="ltr"] first (same stable attribute used by feed post text),
    // then fall back to the first paragraph in the section.
    const el =
      aboutSection.querySelector('span[dir="ltr"]') ??
      aboutSection.querySelector("p");
    about = (el?.textContent?.trim() ?? "").slice(0, 1500);
  }

  // -- Experience --
  const expSection = findSection("experience");
  const experience: ExperienceEntry[] = [];
  if (expSection) {
    for (const li of Array.from(expSection.querySelectorAll("li"))) {
      // Collect visible, non-aria-hidden span text — title is first, company second.
      const spans = Array.from(li.querySelectorAll("span"))
        .filter(
          (el) =>
            el.getAttribute("aria-hidden") !== "true" &&
            (el as HTMLElement).offsetParent !== null
        )
        .map((el) => el.textContent?.trim() ?? "")
        .filter((t) => t.length > 1 && t !== "·");

      // Company link is the most reliable company signal
      const companyLink = li.querySelector('a[href*="/company/"]');
      const company = (companyLink?.textContent?.trim() ?? spans[1] ?? "").slice(0, 100);
      const title = (spans[0] ?? "").slice(0, 100);
      const duration = spans.find((t) => /\d{4}|Present|yr|mo/.test(t)) ?? "";
      // Description: first span longer than 60 chars that isn't the title/company/duration
      const description = (
        spans.find((t) => t.length > 60 && t !== title && t !== company && t !== duration) ?? ""
      ).slice(0, 500);

      if (title && title !== company) {
        experience.push({ title, company, duration, description });
      }
    }
  }

  // -- Education --
  const eduSection = findSection("education");
  const education: EducationEntry[] = [];
  if (eduSection) {
    for (const li of Array.from(eduSection.querySelectorAll("li"))) {
      const spans = Array.from(li.querySelectorAll("span"))
        .filter((el) => el.getAttribute("aria-hidden") !== "true")
        .map((el) => el.textContent?.trim() ?? "")
        .filter((t) => t.length > 1);

      const school = (spans[0] ?? "").slice(0, 150);
      const degree = (spans[1] ?? "").slice(0, 150);
      const duration = spans.find((t) => /\d{4}/.test(t)) ?? "";

      if (school) education.push({ school, degree, duration });
    }
  }

  // -- Skills --
  const skillsSection = findSection("skills");
  const skills: string[] = [];
  if (skillsSection) {
    const raw = Array.from(
      skillsSection.querySelectorAll('li span:not([aria-hidden="true"])')
    )
      .map((el) => el.textContent?.trim() ?? "")
      .filter((t) => t.length > 1 && t.length < 60);

    skills.push(...[...new Set(raw)].slice(0, 25));
  }

  return {
    name,
    headline: ps[0] ?? "",
    location: ps[1] ?? "",
    about,
    experience,
    education,
    skills,
  };
}

// -- get_profile -----------------------------------------------------------

async function getProfile(): Promise<string> {
  logger.info("Scraping own profile data...");

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(MY_PROFILE_URL, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);
    await page.waitForFunction(
      () => document.title.includes("| LinkedIn") && document.title.length > 15,
      { timeout: 30000 }
    );

    await scrollToLoadSections(page);

    const result = await page.evaluate(extractFullProfileInPage);

    logger.info(
      `Profile scraped: name="${result.name}", ` +
        `exp=${result.experience.length}, edu=${result.education.length}, ` +
        `skills=${result.skills.length}`
    );

    return compactJson(result);
  } finally {
    await browser.close();
  }
}

// -- update_section --------------------------------------------------------

async function updateSection(
  section: EditableSection,
  newText: string
): Promise<string> {
  logger.info(`Updating profile section: ${section}`);

  const { browser, page } = await launchWithSession();

  try {
    if (section === "headline") {
      await updateHeadline(page, newText);
    } else if (section === "about") {
      await page.goto(MY_PROFILE_URL, { waitUntil: "load", timeout: 45000 });
      await page.waitForTimeout(2000);
      ensureAuthenticated(page);
      await page.waitForFunction(
        () => document.title.includes("| LinkedIn") && document.title.length > 15,
        { timeout: 30000 }
      );
      await updateAbout(page, newText);
    }

    return `Successfully updated '${section}' section.`;
  } finally {
    await browser.close();
  }
}

async function updateHeadline(page: Page, newText: string): Promise<void> {
  // LinkedIn moved headline editing to a standalone full page (confirmed April 2026).
  // There is no modal — the page has a single [contenteditable] div for the headline.
  await page.goto("https://www.linkedin.com/in/me/edit/intro/", {
    waitUntil: "load",
    timeout: 45000,
  });
  await page.waitForTimeout(2000);
  ensureAuthenticated(page);
  await page.waitForFunction(
    () => document.title.includes("| LinkedIn") && document.title.length > 15,
    { timeout: 15000 }
  );

  const headlineEl = page.locator('[contenteditable="true"]').first();
  await headlineEl.waitFor({ state: "visible", timeout: 10000 });

  await headlineEl.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await headlineEl.pressSequentially(newText, { delay: randomDelay() });

  await page.getByRole("button", { name: "Save" }).click();

  await page.waitForFunction(
    () => !window.location.href.includes("/edit/intro/"),
    { timeout: 15000 }
  );

  logger.info("Headline updated successfully.");
}

async function updateAbout(page: Page, newText: string): Promise<void> {
  const editAboutLink = page.getByRole("link", { name: /edit.*about/i }).first();
  const addAboutBtn = page.getByRole("button", { name: /add.*about/i }).first();

  const hasEdit = await editAboutLink.isVisible().catch(() => false);
  const hasAdd = await addAboutBtn.isVisible().catch(() => false);

  if (!hasEdit && !hasAdd) {
    throw new Error(
      "About section edit not found on profile. The About section may not exist yet. " +
        "Add it manually on LinkedIn first, then use update_section to modify it."
    );
  }

  if (hasEdit) {
    await editAboutLink.click();
  } else {
    await addAboutBtn.click();
  }

  await page.waitForTimeout(1500);

  const aboutInput = page
    .locator('[contenteditable="true"][role="textbox"], textarea')
    .first();
  await aboutInput.waitFor({ state: "visible", timeout: 10000 });

  await aboutInput.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await aboutInput.pressSequentially(newText, { delay: randomDelay() });

  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(2000);

  logger.info("About section updated successfully.");
}

// -- view_profile ----------------------------------------------------------

async function viewProfile(profileUrl: string): Promise<string> {
  logger.info(`Viewing profile: ${profileUrl}`);

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(profileUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);
    await page.waitForFunction(
      () => document.title.includes("| LinkedIn") && document.title.length > 15,
      { timeout: 30000 }
    );

    await scrollToLoadSections(page);

    const data = await page.evaluate(extractFullProfileInPage);

    logger.info(`Profile scraped: "${data.name}" — "${data.headline.slice(0, 50)}"`);
    return compactJson(data);
  } finally {
    await browser.close();
  }
}

// -- Exported handlers -----------------------------------------------------

export async function handleViewProfile(args: { profile_url: string }): Promise<string> {
  return viewProfile(args.profile_url);
}

export async function handleManageProfile(args: {
  action: string;
  section?: string;
  text?: string;
}): Promise<string> {
  switch (args.action) {
    case "get_profile":
      return getProfile();

    case "update_section": {
      if (!args.section) {
        throw new Error("'section' is required for the update_section action.");
      }
      if (!args.text) {
        throw new Error("'text' is required for the update_section action.");
      }
      const validSections: EditableSection[] = ["headline", "about"];
      if (!validSections.includes(args.section as EditableSection)) {
        throw new Error(
          `Unsupported section '${args.section}'. Supported: ${validSections.join(", ")}`
        );
      }
      return updateSection(args.section as EditableSection, args.text);
    }

    default:
      throw new Error(
        `Unknown action '${args.action}'. Use 'get_profile' or 'update_section'.`
      );
  }
}
