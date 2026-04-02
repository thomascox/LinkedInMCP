import { type Page } from "playwright";
import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated } from "../browser";

// -- Types -----------------------------------------------------------------

interface ProfileData {
  headline: string;
  about: string;
  experience: {
    title: string;
    company: string;
    duration: string;
    description: string;
  }[];
}

type EditableSection = "headline" | "about";

const MY_PROFILE_URL = "https://www.linkedin.com/in/me/";

// -- Helpers ---------------------------------------------------------------

function randomDelay(): number {
  return Math.floor(Math.random() * (150 - 50 + 1)) + 50;
}

// -- get_profile -----------------------------------------------------------

async function getProfile(): Promise<string> {
  logger.info("Scraping own profile data...");

  const { browser, page } = await launchWithSession();

  try {
    await page.goto(MY_PROFILE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    ensureAuthenticated(page);

    // Wait for profile top card to render.
    await page.waitForSelector(
      'div.pv-top-card, section.pv-top-card, main.scaffold-layout__main',
      { timeout: 15000 }
    );

    // Allow lazy sections to load.
    await page.waitForTimeout(2000);

    // -- Headline --
    const headline = await page
      .locator('div.text-body-medium.break-words')
      .first()
      .textContent()
      .then((t) => t?.trim() || "")
      .catch(() => "");

    // -- About section --
    // The about section may be collapsed behind a "see more" button.
    const aboutSeeMore = page.locator(
      'section:has(#about) button:has-text("see more"), ' +
      'div#about ~ div button:has-text("see more")'
    ).first();

    if (await aboutSeeMore.isVisible().catch(() => false)) {
      await aboutSeeMore.click();
      await page.waitForTimeout(500);
    }

    const about = await page
      .locator(
        'section:has(#about) div.display-flex.full-width span[aria-hidden="true"], ' +
        'section:has(#about) div.inline-show-more-text span[aria-hidden="true"]'
      )
      .first()
      .textContent()
      .then((t) => t?.trim() || "")
      .catch(() => "");

    // -- Experience section --
    const experience = await page.evaluate(() => {
      const items: {
        title: string;
        company: string;
        duration: string;
        description: string;
      }[] = [];

      // Find the experience section by its anchor id.
      const expSection =
        document.querySelector('section:has(#experience)') ||
        document.querySelector('div#experience')?.closest('section');

      if (!expSection) return items;

      const entries = expSection.querySelectorAll(
        'li.artdeco-list__item, li.pvs-list__paged-list-item'
      );

      entries.forEach((entry) => {
        const titleEl =
          entry.querySelector(
            'div.display-flex.align-items-center.mr1 span[aria-hidden="true"]'
          ) ||
          entry.querySelector(
            'span.t-bold span[aria-hidden="true"]'
          );

        const companyEl =
          entry.querySelector(
            'span.t-14.t-normal span[aria-hidden="true"]'
          ) ||
          entry.querySelector(
            't-14.t-normal.flex-1 span[aria-hidden="true"]'
          );

        const durationEl =
          entry.querySelector(
            'span.t-14.t-normal.t-black--light span[aria-hidden="true"]'
          );

        const descEl =
          entry.querySelector(
            'div.inline-show-more-text span[aria-hidden="true"]'
          ) ||
          entry.querySelector(
            'div.pvs-list__outer-container span[aria-hidden="true"]:last-of-type'
          );

        const title = titleEl?.textContent?.trim() || "";
        const company = companyEl?.textContent?.trim() || "";
        const duration = durationEl?.textContent?.trim() || "";
        const description = descEl?.textContent?.trim() || "";

        if (title || company) {
          items.push({ title, company, duration, description });
        }
      });

      return items;
    });

    const profileData: ProfileData = { headline, about, experience };

    logger.info(
      `Profile scraped: headline="${headline.slice(0, 50)}...", ` +
      `${experience.length} experience entries.`
    );

    return JSON.stringify(profileData, null, 2);
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
    await page.goto(MY_PROFILE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    ensureAuthenticated(page);

    await page.waitForSelector(
      'div.pv-top-card, section.pv-top-card, main.scaffold-layout__main',
      { timeout: 15000 }
    );

    await page.waitForTimeout(1500);

    if (section === "headline") {
      await updateHeadline(page, newText);
    } else if (section === "about") {
      await updateAbout(page, newText);
    }

    // Wait for the confirmation toast.
    const toast = page.locator(
      'div.artdeco-toast-item, li.artdeco-toast-item, ' +
      'div[data-test-artdeco-toast], section.artdeco-toast-item'
    ).first();

    try {
      await toast.waitFor({ state: "visible", timeout: 10000 });
      const toastText = await toast.textContent().then((t) => t?.trim() || "");
      logger.info(`Toast confirmation: "${toastText}"`);
    } catch {
      logger.warn("No toast confirmation detected, but save was clicked.");
    }

    return `Successfully updated '${section}' section.`;
  } finally {
    await browser.close();
  }
}

async function updateHeadline(page: Page, newText: string): Promise<void> {
  // The headline is edited through the intro edit modal.
  // Click the pencil/edit button on the top card intro section.
  const introEditButton = page.locator(
    [
      'button[aria-label="Edit intro"]',
      'section.pv-top-card button.profile-edit-btn',
      'div.pv-top-card button[aria-label*="Edit"]',
    ].join(", ")
  ).first();

  await introEditButton.waitFor({ state: "visible", timeout: 10000 });
  await introEditButton.click();

  // Wait for the edit modal to open.
  const modal = page.locator(
    'div.artdeco-modal, div[role="dialog"]'
  ).first();
  await modal.waitFor({ state: "visible", timeout: 10000 });

  // Find the headline input field inside the modal.
  const headlineInput = modal.locator(
    [
      'input[aria-label="Headline"]',
      'input[aria-label*="Headline"]',
      'input#headline',
      'label:has-text("Headline") ~ input',
    ].join(", ")
  ).first();

  await headlineInput.waitFor({ state: "visible", timeout: 5000 });

  // Clear existing text and type the new headline.
  await headlineInput.click({ clickCount: 3 });
  await headlineInput.press("Backspace");
  await headlineInput.pressSequentially(newText, { delay: randomDelay() });

  // Click Save.
  await clickModalSave(page, modal);
}

async function updateAbout(page: Page, newText: string): Promise<void> {
  // The about section has its own edit button.
  const aboutEditButton = page.locator(
    [
      'section:has(#about) button[aria-label="Edit about"]',
      'section:has(#about) button[aria-label*="Edit"]',
      '#about ~ div button[aria-label*="Edit"]',
    ].join(", ")
  ).first();

  const aboutEditVisible = await aboutEditButton.isVisible().catch(() => false);

  if (!aboutEditVisible) {
    // If there's no about section yet, look for "Add about" or the
    // profile-level "Add section" flow.
    const addAboutButton = page.locator(
      [
        'button:has-text("Add about")',
        'section.pv-top-card button:has-text("Add profile section")',
      ].join(", ")
    ).first();

    const addVisible = await addAboutButton.isVisible().catch(() => false);
    if (!addVisible) {
      throw new Error(
        "Could not find the edit or add button for the About section."
      );
    }
    await addAboutButton.click();

    // If we clicked "Add profile section", we may need to select "About" from a dropdown.
    const aboutOption = page.locator(
      'button:has-text("About"), li:has-text("About")'
    ).first();
    if (await aboutOption.isVisible().catch(() => false)) {
      await aboutOption.click();
    }
  } else {
    await aboutEditButton.click();
  }

  // Wait for the modal.
  const modal = page.locator(
    'div.artdeco-modal, div[role="dialog"]'
  ).first();
  await modal.waitFor({ state: "visible", timeout: 10000 });

  // Find the about textarea inside the modal.
  const aboutInput = modal.locator(
    [
      'textarea[aria-label="About"]',
      'textarea[aria-label*="About"]',
      'textarea#about',
      'div[role="textbox"][contenteditable="true"]',
      'textarea',
    ].join(", ")
  ).first();

  await aboutInput.waitFor({ state: "visible", timeout: 5000 });

  // Select all existing text and replace it.
  await aboutInput.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await aboutInput.pressSequentially(newText, { delay: randomDelay() });

  // Click Save.
  await clickModalSave(page, modal);
}

async function clickModalSave(page: Page, modal: ReturnType<Page["locator"]>): Promise<void> {
  const saveButton = modal.locator(
    [
      'button:has-text("Save")',
      'button[aria-label="Save"]',
      'button.artdeco-button--primary:has-text("Save")',
    ].join(", ")
  ).first();

  await saveButton.waitFor({ state: "visible", timeout: 5000 });
  await saveButton.click();

  // Wait for modal to close, confirming the save completed.
  await modal.waitFor({ state: "hidden", timeout: 15000 });
}

// -- Exported handler ------------------------------------------------------

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
