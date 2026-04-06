import { type Page } from "playwright";
import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated } from "../browser";
import { compactJson } from "../response-utils";

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

// -- URL helpers -----------------------------------------------------------

// Normalize any LinkedIn profile URL to "https://www.linkedin.com/in/username/"
function normalizeProfileUrl(url: string): string {
  const match = url.match(/^(https:\/\/www\.linkedin\.com\/in\/[^/?#]+)/);
  return match ? match[1] + "/" : url.replace(/\/?$/, "/");
}

// -- "Load more" click helper ----------------------------------------------

// On /details/* pages LinkedIn renders a "Load more" button that must be
// clicked before the actual section content appears in the DOM.
async function clickLoadMoreIfPresent(page: Page): Promise<void> {
  const btn = page.locator("button").filter({ hasText: /^Load more$/ }).first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() =>
      page.waitForTimeout(2000)
    );
  }
}

// Navigate to a /details/* page, trigger load, and return #workspace.innerText.
async function getDetailsText(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(1500);
  ensureAuthenticated(page);
  await clickLoadMoreIfPresent(page);
  return page.evaluate(
    () => (document.querySelector("#workspace") as HTMLElement | null)?.innerText ?? ""
  );
}

// -- Text parsers ----------------------------------------------------------

// DOM inspection (April 2026) confirmed that /details/* pages contain no
// <li> elements and no stable class names. All content is parsed from the
// plain text produced by #workspace.innerText.

function parseExperience(wsText: string): ExperienceEntry[] {
  // A "date line" contains a 4-digit year or "Present" plus a separator.
  const isDate = (l: string) => /(\d{4}|Present)/.test(l) && /[-–·]/.test(l);
  // A "company line" has a mid-dot separator but is NOT a date line and does
  // not start with a bullet — e.g. "Disney Cruise Line · Contract".
  const isCompany = (l: string) =>
    /·/.test(l) && !isDate(l) && !l.startsWith("•") && l.length < 140;

  const NOISE = new Set([
    "Experience", "Enhance with AI", "Load more", "Show more",
    "Show all", "Profile language", "English",
    "Who your viewers also viewed", "Private to you",
    "Hybrid", "Remote", "On-site", "Onsite",
  ]);
  const FOOTER = /^(About|Accessibility|Talent Solutions|Community Guidelines|Careers|Marketing Solutions|Privacy|Ad Choices|Advertising|Sales Solutions|Mobile|Small Business|Safety Center|LinkedIn Corporation|Questions\?|Visit our Help|Manage your account|Go to your Settings|Recommendation transparency|Learn more about|Select language)/;
  const isSkillsMeta = (l: string) => /skills$|and \+\d+ skills?/i.test(l);
  const isEndorsement = (l: string) => /^\d+ endorsement/i.test(l) || /^Endorsed by/i.test(l);

  const lines = wsText
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !NOISE.has(l) &&
        !FOOTER.test(l) &&
        !isSkillsMeta(l) &&
        !isEndorsement(l)
    );

  const entries: ExperienceEntry[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";

    // Entry start: non-date, non-company, non-bullet line whose next line is a company line.
    if (!isDate(line) && !isCompany(line) && !line.startsWith("•") && isCompany(next)) {
      const title = line.slice(0, 120);
      const company = next.split("·")[0].trim().slice(0, 100);
      i += 2;

      // Optional date line
      let duration = "";
      if (i < lines.length && isDate(lines[i])) {
        duration = lines[i].split("·")[0].trim();
        i++;
      }

      // Collect bullet descriptions until the next entry title or footer
      const bullets: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (FOOTER.test(l)) break;
        // Stop when we've reached the next entry's title (non-bullet, non-date, non-company,
        // and the line AFTER it is a company line).
        if (
          !isDate(l) &&
          !isCompany(l) &&
          !l.startsWith("•") &&
          i + 1 < lines.length &&
          isCompany(lines[i + 1])
        ) break;
        if (l.startsWith("•")) bullets.push(l.slice(1).trim());
        i++;
      }

      entries.push({
        title,
        company,
        duration,
        description: bullets.slice(0, 3).join(" ").slice(0, 500),
      });
    } else {
      i++;
    }
  }

  return entries;
}

function parseEducation(wsText: string): EducationEntry[] {
  const FOOTER = /^(Profile language|Who your viewers|About|Accessibility|Talent Solutions|Community Guidelines|Careers|Marketing Solutions|Privacy|LinkedIn Corporation)/;
  // A date range line: contains a 4-digit year and a dash or en-dash.
  const isDateRange = (l: string) => /\d{4}/.test(l) && /[-–]/.test(l);

  const lines = wsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== "Education" && !FOOTER.test(l) && l !== "Show more");

  const entries: EducationEntry[] = [];

  // Anchor on date range lines: the two lines before a date range are degree and school.
  for (let i = 0; i < lines.length; i++) {
    if (isDateRange(lines[i]) && i >= 2) {
      const school = lines[i - 2];
      const degree = lines[i - 1];
      if (!isDateRange(school) && school.length > 3) {
        entries.push({ school, degree, duration: lines[i] });
      }
    }
  }

  return entries;
}

function parseSkills(wsText: string): string[] {
  // Category filter tabs that appear at the top of the skills page.
  const SKIP = new Set([
    "Skills", "All", "Industry Knowledge", "Tools & Technologies",
    "Interpersonal Skills", "Other Skills", "Load more", "Show more",
    "Who your viewers also viewed", "Private to you",
  ]);
  const FOOTER = /^(Profile language|About|Accessibility|Talent Solutions|Community Guidelines|Careers|Marketing Solutions|Privacy|LinkedIn Corporation)/;
  const isNoise = (l: string) =>
    SKIP.has(l) ||
    FOOTER.test(l) ||
    /^\d+ endorsement/i.test(l) ||
    /^Endorsed by/i.test(l) ||
    // Endorser context lines like "Program Manager at Acme Inc."
    / at [A-Z].+(Inc\.|LLC|Corp|Company|Ltd|Group|Services|Solutions|Capital)/i.test(l);

  const skills = wsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1 && l.length < 80 && !isNoise(l));

  return [...new Set(skills)].slice(0, 30);
}

// -- Top card + About from the main profile page ---------------------------

async function scrapeTopCard(
  page: Page,
  profileUrl: string
): Promise<{ name: string; headline: string; location: string; about: string }> {
  await page.goto(profileUrl, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(2000);
  ensureAuthenticated(page);
  await page.waitForFunction(
    () => document.title.includes("| LinkedIn") && document.title.length > 15,
    { timeout: 30000 }
  );

  return page.evaluate(() => {
    const name = document.title.split(" | ")[0].trim();
    const ws = document.querySelector("#workspace") as HTMLElement | null;

    // Headline and location are in the first visible <p> elements of the top card.
    const ps = Array.from((ws ?? document).querySelectorAll("p"))
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

    // About: if the profile has an About section it appears between the top
    // card and the Activity section in the workspace innerText.
    const wsText = ws?.innerText ?? "";
    const activityIdx = wsText.indexOf("\nActivity\n");
    const nameIdx = wsText.indexOf(name);
    let about = "";
    if (activityIdx > nameIdx + name.length + 50) {
      const between = wsText.slice(nameIdx + name.length, activityIdx);
      const candidate = between
        .split("\n")
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length > 50 &&
            !/^(Contact info|\d+ connection|Open to|Show|Add|Create|Follow|Message|Connect|·)/.test(
              l
            )
        )
        .join(" ");
      about = candidate.slice(0, 1500);
    }

    return { name, headline: ps[0] ?? "", location: ps[1] ?? "", about };
  });
}

// -- Full profile scrape ---------------------------------------------------

async function scrapeFullProfile(page: Page, profileUrl: string): Promise<ProfileData> {
  const base = normalizeProfileUrl(profileUrl);

  const topCard = await scrapeTopCard(page, base);

  const expText = await getDetailsText(page, base + "details/experience/");
  const eduText = await getDetailsText(page, base + "details/education/");
  const skillsText = await getDetailsText(page, base + "details/skills/");

  const result: ProfileData = {
    ...topCard,
    experience: parseExperience(expText),
    education: parseEducation(eduText),
    skills: parseSkills(skillsText),
  };

  logger.info(
    `Profile scraped: "${result.name}" — ` +
      `exp=${result.experience.length}, edu=${result.education.length}, skills=${result.skills.length}`
  );

  return result;
}

// -- get_profile -----------------------------------------------------------

async function getProfile(): Promise<string> {
  const { browser, page } = await launchWithSession();
  try {
    // Navigate to /in/me/ and follow the redirect to get the actual profile URL.
    await page.goto(MY_PROFILE_URL, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2000);
    ensureAuthenticated(page);
    await page.waitForFunction(
      () => document.title.includes("| LinkedIn") && document.title.length > 15,
      { timeout: 30000 }
    );
    const actualUrl = normalizeProfileUrl(page.url());
    const result = await scrapeFullProfile(page, actualUrl);
    return compactJson(result);
  } finally {
    await browser.close();
  }
}

// -- view_profile ----------------------------------------------------------

async function viewProfile(profileUrl: string): Promise<string> {
  const { browser, page } = await launchWithSession();
  try {
    const result = await scrapeFullProfile(page, profileUrl);
    return compactJson(result);
  } finally {
    await browser.close();
  }
}

// -- update_section --------------------------------------------------------

async function updateSection(section: EditableSection, newText: string): Promise<string> {
  const { browser, page } = await launchWithSession();
  try {
    if (section === "headline") {
      await updateHeadline(page, newText);
    } else {
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
  // LinkedIn's headline editor is a standalone full page at /edit/intro/.
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
  // fill() clears and sets the value instantly — no per-character typing that
  // would time out on long strings.
  await headlineEl.fill(newText);

  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForFunction(
    () => !window.location.href.includes("/edit/intro/"),
    { timeout: 15000 }
  );
  logger.info("Headline updated.");
}

async function updateAbout(page: Page, newText: string): Promise<void> {
  const editLink = page.getByRole("link", { name: /edit.*about/i }).first();
  const addBtn = page.getByRole("button", { name: /add.*about/i }).first();

  const hasEdit = await editLink.isVisible().catch(() => false);
  const hasAdd = await addBtn.isVisible().catch(() => false);

  if (!hasEdit && !hasAdd) {
    throw new Error(
      "About section edit control not found. Add an About section on LinkedIn first."
    );
  }

  if (hasEdit) await editLink.click();
  else await addBtn.click();

  await page.waitForTimeout(1500);

  const input = page
    .locator('[contenteditable="true"][role="textbox"], textarea')
    .first();
  await input.waitFor({ state: "visible", timeout: 10000 });
  // fill() works for both textarea and contenteditable elements and is instant.
  await input.fill(newText);

  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(2000);
  logger.info("About updated.");
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
      if (!args.section) throw new Error("'section' is required for update_section.");
      if (!args.text) throw new Error("'text' is required for update_section.");
      const valid: EditableSection[] = ["headline", "about"];
      if (!valid.includes(args.section as EditableSection)) {
        throw new Error(`Unsupported section '${args.section}'. Supported: ${valid.join(", ")}`);
      }
      return updateSection(args.section as EditableSection, args.text);
    }

    default:
      throw new Error(
        `Unknown action '${args.action}'. Use 'get_profile' or 'update_section'.`
      );
  }
}
