import { type Page, type Browser, type BrowserContext } from "playwright";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "../logger";
import { launchWithSession, ensureAuthenticated, rateLimit } from "../browser";
import { compactJson, fieldsToSummary, randomDelay } from "../response-utils";

// -- Types -----------------------------------------------------------------

interface FormField {
  type: "text" | "textarea" | "select" | "radio" | "checkbox" | "file" | "unknown";
  label: string;
  name: string;
  value: string;
  options?: string[];  // for select/radio
  required: boolean;
  checked?: boolean;   // for checkbox
}

interface StepState {
  stepNumber: number;
  isReviewStep: boolean;
  isComplete: boolean;
  fields: FormField[];
  formSummary: string;
  screenshotPath: string;
}

interface FieldAnswer {
  label: string;
  value: string;
}

// -- Active session management ---------------------------------------------
// The Easy Apply modal is multi-step and must persist across tool calls.

let activeBrowser: Browser | null = null;
let activeContext: BrowserContext | null = null;
let activePage: Page | null = null;
let activeJobId: string | null = null;
let currentStep = 0;

async function cleanupSession(): Promise<void> {
  if (activeBrowser) {
    await activeBrowser.close().catch(() => {});
    activeBrowser = null;
    activeContext = null;
    activePage = null;
    activeJobId = null;
    currentStep = 0;
  }
}

function ensureActiveSession(): Page {
  if (!activePage || !activeBrowser) {
    throw new Error(
      "No active Easy Apply session. Call start_application first."
    );
  }
  return activePage;
}

// -- Helpers ---------------------------------------------------------------

function ensureScreenshotDir(): void {
  if (!fs.existsSync(config.browser.screenshotsDir)) {
    fs.mkdirSync(config.browser.screenshotsDir, { recursive: true });
  }
}

async function captureScreenshot(page: Page, label: string): Promise<string> {
  ensureScreenshotDir();
  const filename = `easy-apply-${activeJobId}-${label}-${Date.now()}.png`;
  const filepath = path.join(config.browser.screenshotsDir, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  logger.info(`Screenshot saved: ${filepath}`);
  return filepath;
}

function getModalLocator(page: Page) {
  return page.locator(
    'div.jobs-easy-apply-modal, div.jobs-easy-apply-content, ' +
    'div[data-test-modal-id="easy-apply-modal"], div.artdeco-modal:has(button[aria-label="Submit application"])'
  ).first();
}

async function extractFormFields(page: Page): Promise<FormField[]> {
  const modal = getModalLocator(page);

  return modal.evaluate((el) => {
    const fields: {
      type: "text" | "textarea" | "select" | "radio" | "checkbox" | "file" | "unknown";
      label: string;
      name: string;
      value: string;
      options?: string[];
      required: boolean;
      checked?: boolean;
    }[] = [];

    // Text inputs
    el.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type])').forEach((input) => {
      const inp = input as HTMLInputElement;
      const labelEl =
        el.querySelector(`label[for="${inp.id}"]`) ||
        inp.closest('div')?.querySelector('label');
      fields.push({
        type: "text",
        label: labelEl?.textContent?.trim() || inp.placeholder || inp.name || "",
        name: inp.name || inp.id || "",
        value: inp.value || "",
        required: inp.required || inp.getAttribute("aria-required") === "true",
      });
    });

    // Textareas
    el.querySelectorAll('textarea').forEach((ta) => {
      const textarea = ta as HTMLTextAreaElement;
      const labelEl =
        el.querySelector(`label[for="${textarea.id}"]`) ||
        textarea.closest('div')?.querySelector('label');
      fields.push({
        type: "textarea",
        label: labelEl?.textContent?.trim() || textarea.placeholder || textarea.name || "",
        name: textarea.name || textarea.id || "",
        value: textarea.value || "",
        required: textarea.required || textarea.getAttribute("aria-required") === "true",
      });
    });

    // Selects
    el.querySelectorAll('select').forEach((sel) => {
      const select = sel as HTMLSelectElement;
      const labelEl =
        el.querySelector(`label[for="${select.id}"]`) ||
        select.closest('div')?.querySelector('label');
      const options = Array.from(select.options).map((o) => o.text.trim()).filter(Boolean);
      fields.push({
        type: "select",
        label: labelEl?.textContent?.trim() || select.name || "",
        name: select.name || select.id || "",
        value: select.value || "",
        options,
        required: select.required || select.getAttribute("aria-required") === "true",
      });
    });

    // Radio groups
    const radioGroups = new Map<string, HTMLInputElement[]>();
    el.querySelectorAll('input[type="radio"]').forEach((r) => {
      const radio = r as HTMLInputElement;
      const name = radio.name || "";
      if (!radioGroups.has(name)) radioGroups.set(name, []);
      radioGroups.get(name)!.push(radio);
    });
    radioGroups.forEach((radios, name) => {
      const groupContainer = radios[0]?.closest('fieldset') || radios[0]?.closest('div');
      const legendEl = groupContainer?.querySelector('legend, span.fb-dash-form-element__label');
      const options = radios.map((r) => {
        const lbl = el.querySelector(`label[for="${r.id}"]`);
        return lbl?.textContent?.trim() || r.value || "";
      });
      const checked = radios.find((r) => r.checked);
      fields.push({
        type: "radio",
        label: legendEl?.textContent?.trim() || name,
        name,
        value: checked?.value || "",
        options,
        required: radios[0]?.required || radios[0]?.getAttribute("aria-required") === "true",
      });
    });

    // Checkboxes
    el.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      const checkbox = cb as HTMLInputElement;
      const labelEl =
        el.querySelector(`label[for="${checkbox.id}"]`) ||
        checkbox.closest('div')?.querySelector('label');
      fields.push({
        type: "checkbox",
        label: labelEl?.textContent?.trim() || checkbox.name || "",
        name: checkbox.name || checkbox.id || "",
        value: checkbox.value || "",
        required: checkbox.required,
        checked: checkbox.checked,
      });
    });

    // File inputs
    el.querySelectorAll('input[type="file"]').forEach((f) => {
      const fileInput = f as HTMLInputElement;
      const labelEl =
        el.querySelector(`label[for="${fileInput.id}"]`) ||
        fileInput.closest('div')?.querySelector('label');
      fields.push({
        type: "file",
        label: labelEl?.textContent?.trim() || "File upload",
        name: fileInput.name || fileInput.id || "",
        value: "",
        required: fileInput.required,
      });
    });

    return fields;
  });
}

async function detectReviewStep(page: Page): Promise<boolean> {
  const modal = getModalLocator(page);

  // Check for review indicators: a "Review" heading or a "Submit application" button.
  const reviewHeading = modal.locator(
    'h3:has-text("Review"), h2:has-text("Review"), ' +
    'span:has-text("Review your application")'
  ).first();

  const submitButton = modal.locator(
    'button[aria-label="Submit application"], ' +
    'button:has-text("Submit application")'
  ).first();

  const hasReviewHeading = await reviewHeading.isVisible().catch(() => false);
  const hasSubmitButton = await submitButton.isVisible().catch(() => false);

  return hasReviewHeading || hasSubmitButton;
}

async function uncheckFollowCompany(page: Page): Promise<void> {
  const modal = getModalLocator(page);

  const followCheckbox = modal.locator(
    'input[type="checkbox"][id*="follow"], ' +
    'label:has-text("Follow") input[type="checkbox"], ' +
    'label:has-text("follow") input[type="checkbox"]'
  ).first();

  const isVisible = await followCheckbox.isVisible().catch(() => false);

  if (isVisible) {
    const isChecked = await followCheckbox.isChecked().catch(() => false);
    if (isChecked) {
      await followCheckbox.uncheck();
      logger.info("Unchecked 'Follow company' checkbox.");
    }
  } else {
    // Try label-based click approach for custom checkboxes.
    const followLabel = modal.locator(
      'label:has-text("Follow")'
    ).first();

    const labelVisible = await followLabel.isVisible().catch(() => false);
    if (labelVisible) {
      // Check if the associated input is checked via aria/class.
      const labelClasses = await followLabel.getAttribute("class") || "";
      if (labelClasses.includes("artdeco-toggle--checked") || labelClasses.includes("checked")) {
        await followLabel.click();
        logger.info("Unchecked 'Follow company' via label click.");
      }
    }
  }
}

async function captureStepState(page: Page): Promise<StepState> {
  const isReview = await detectReviewStep(page);

  if (isReview) {
    await uncheckFollowCompany(page);
  }

  const fields = await extractFormFields(page);
  const formSummary = fieldsToSummary(fields);
  const screenshotPath = await captureScreenshot(page, `step-${currentStep}`);

  return {
    stepNumber: currentStep,
    isReviewStep: isReview,
    isComplete: false,
    fields,
    formSummary,
    screenshotPath,
  };
}

// -- start_application -----------------------------------------------------

async function startApplication(jobId: string): Promise<string> {
  // Clean up any previous session.
  await cleanupSession();

  logger.info(`Starting Easy Apply for job ${jobId}...`);

  const session = await launchWithSession();
  activeBrowser = session.browser;
  activeContext = session.context;
  activePage = session.page;
  activeJobId = jobId;
  currentStep = 1;

  const page = activePage;
  const jobUrl = `https://www.linkedin.com/jobs/view/${jobId}/`;

  try {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    ensureAuthenticated(page);

    // Wait for the job page to load.
    await page.waitForSelector(
      'div.jobs-unified-top-card, div.job-view-layout, main',
      { timeout: 15000 }
    );

    // Find and click the Easy Apply button.
    const easyApplyButton = page.locator(
      'button.jobs-apply-button:has-text("Easy Apply"), ' +
      'button[aria-label*="Easy Apply"], ' +
      'button:has-text("Easy Apply")'
    ).first();

    const easyApplyVisible = await easyApplyButton.isVisible().catch(() => false);
    if (!easyApplyVisible) {
      await cleanupSession();
      return compactJson({
        error: true,
        message: "Easy Apply button not found. This job may not support Easy Apply, or the listing may have been removed.",
      });
    }

    await easyApplyButton.click();

    // Wait for the Easy Apply modal to appear.
    const modal = getModalLocator(page);
    await modal.waitFor({ state: "visible", timeout: 10000 });

    // Allow the form to fully render.
    await page.waitForTimeout(1500);

    const stepState = await captureStepState(page);

    logger.info(
      `Easy Apply modal opened for job ${jobId}, step ${currentStep}, ` +
      `${stepState.fields.length} fields found.`
    );

    return compactJson(stepState);
  } catch (err) {
    await cleanupSession();
    throw err;
  }
}

// -- fill_application_step -------------------------------------------------

async function fillApplicationStep(
  answers: FieldAnswer[],
  action: "next" | "review" | "submit"
): Promise<string> {
  await rateLimit();

  const page = ensureActiveSession();
  const modal = getModalLocator(page);

  try {
    // Fill in each provided answer.
    for (const answer of answers) {
      await fillField(page, modal, answer);
    }

    // Short pause after filling fields.
    await page.waitForTimeout(500);

    // Click the appropriate action button.
    if (action === "submit") {
      // Final submission.
      await uncheckFollowCompany(page);

      const submitButton = modal.locator(
        'button[aria-label="Submit application"], ' +
        'button:has-text("Submit application")'
      ).first();

      await submitButton.waitFor({ state: "visible", timeout: 5000 });
      await submitButton.click();

      // Wait for confirmation.
      await page.waitForTimeout(3000);

      // Check for success indicators.
      const successIndicator = page.locator(
        'h2:has-text("Application sent"), ' +
        'h3:has-text("Application sent"), ' +
        'span:has-text("Application sent"), ' +
        'div:has-text("Your application was sent")'
      ).first();

      const submitted = await successIndicator.isVisible().catch(() => false);

      const screenshotPath = await captureScreenshot(page, "submitted");
      await cleanupSession();

      return compactJson({
        stepNumber: currentStep,
        isComplete: true,
        submitted,
        message: submitted
          ? "Application submitted successfully!"
          : "Submit was clicked. Check screenshot to verify completion.",
        screenshotPath,
      });
    }

    // "Next" or "Review" button.
    const nextButton = modal.locator(
      'button[aria-label="Continue to next step"], ' +
      'button[aria-label="Review your application"], ' +
      'button:has-text("Next"), ' +
      'button:has-text("Review")'
    ).first();

    await nextButton.waitFor({ state: "visible", timeout: 5000 });
    await nextButton.click();

    // Wait for the next step to load.
    await page.waitForTimeout(2000);

    // Check if there was a validation error preventing navigation.
    const validationError = modal.locator(
      'div[data-test-form-element-error], ' +
      'span.artdeco-inline-feedback__message, ' +
      'div.artdeco-inline-feedback--error'
    ).first();

    const hasError = await validationError.isVisible().catch(() => false);

    if (hasError) {
      const errorText = await validationError.textContent().then((t) => t?.trim() || "").catch(() => "");
      const stepState = await captureStepState(page);
      return compactJson({
        ...stepState,
        validationError: errorText || "Form validation failed. Check required fields.",
      });
    }

    currentStep++;
    const stepState = await captureStepState(page);

    logger.info(
      `Advanced to step ${currentStep}, isReview=${stepState.isReviewStep}, ` +
      `${stepState.fields.length} fields found.`
    );

    return compactJson(stepState);
  } catch (err) {
    // Take a diagnostic screenshot before propagating.
    await captureScreenshot(page, "error").catch(() => {});
    throw err;
  }
}

async function fillField(
  page: Page,
  modal: ReturnType<Page["locator"]>,
  answer: FieldAnswer
): Promise<void> {
  const { label, value } = answer;

  if (!label || !value) return;

  logger.debug(`Filling field "${label}" with "${value.slice(0, 50)}..."`);

  // Try text input by label.
  const textInput = modal.locator([
    `input[aria-label="${label}"]`,
    `label:has-text("${label}") ~ input`,
    `label:has-text("${label}") ~ div input`,
  ].join(", ")).first();

  if (await textInput.isVisible().catch(() => false)) {
    await textInput.click({ clickCount: 3 });
    await textInput.press("Backspace");
    await textInput.pressSequentially(value, { delay: randomDelay() });
    return;
  }

  // Try textarea by label.
  const textarea = modal.locator([
    `textarea[aria-label="${label}"]`,
    `label:has-text("${label}") ~ textarea`,
    `label:has-text("${label}") ~ div textarea`,
  ].join(", ")).first();

  if (await textarea.isVisible().catch(() => false)) {
    await textarea.click();
    await page.keyboard.press("Meta+A");
    await page.keyboard.press("Backspace");
    await textarea.pressSequentially(value, { delay: randomDelay() });
    return;
  }

  // Try select by label.
  const select = modal.locator([
    `select[aria-label="${label}"]`,
    `label:has-text("${label}") ~ select`,
    `label:has-text("${label}") ~ div select`,
  ].join(", ")).first();

  if (await select.isVisible().catch(() => false)) {
    await select.selectOption({ label: value });
    return;
  }

  // Try radio by label — click the radio whose label matches value.
  const radioOption = modal.locator(
    `fieldset:has(legend:has-text("${label}")) label:has-text("${value}"), ` +
    `div:has(span:has-text("${label}")) label:has-text("${value}")`
  ).first();

  if (await radioOption.isVisible().catch(() => false)) {
    await radioOption.click();
    return;
  }

  // Try checkbox by label.
  const checkbox = modal.locator([
    `label:has-text("${label}") input[type="checkbox"]`,
    `input[type="checkbox"][aria-label="${label}"]`,
  ].join(", ")).first();

  if (await checkbox.isVisible().catch(() => false)) {
    const isChecked = await checkbox.isChecked();
    const shouldCheck = value.toLowerCase() === "true" || value.toLowerCase() === "yes";
    if (isChecked !== shouldCheck) {
      if (shouldCheck) await checkbox.check();
      else await checkbox.uncheck();
    }
    return;
  }

  // Try contenteditable div (LinkedIn sometimes uses these).
  const contentEditable = modal.locator([
    `label:has-text("${label}") ~ div div[contenteditable="true"]`,
    `div[aria-label="${label}"][contenteditable="true"]`,
  ].join(", ")).first();

  if (await contentEditable.isVisible().catch(() => false)) {
    await contentEditable.click();
    await page.keyboard.press("Meta+A");
    await page.keyboard.press("Backspace");
    await contentEditable.pressSequentially(value, { delay: randomDelay() });
    return;
  }

  logger.warn(`Could not find a matching input for field "${label}". Skipping.`);
}

// -- Exported handlers -----------------------------------------------------

export async function handleStartApplication(args: {
  job_id: string;
}): Promise<string> {
  return startApplication(args.job_id);
}

export async function handleFillApplicationStep(args: {
  answers: FieldAnswer[];
  action: "next" | "review" | "submit";
}): Promise<string> {
  return fillApplicationStep(args.answers, args.action);
}

export async function handleCleanupApplication(): Promise<string> {
  await cleanupSession();
  return "Easy Apply session cleaned up.";
}
