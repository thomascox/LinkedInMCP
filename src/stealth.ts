import { type BrowserContext } from "playwright";
import { logger } from "./logger";

/**
 * Apply stealth patches to a browser context to reduce automation detection.
 *
 * These overrides run via addInitScript so they execute before any page
 * JavaScript. They mask common signals that sites use to detect headless
 * or automated browsers (navigator.webdriver, chrome.runtime, plugin
 * arrays, WebGL vendor, etc.).
 */
export async function applyStealthScripts(context: BrowserContext): Promise<void> {
  logger.debug("Applying stealth scripts to browser context...");

  await context.addInitScript(() => {
    // -- navigator.webdriver ---------------------------------------------------
    // Playwright sets this to true; real browsers leave it undefined.
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });

    // -- chrome runtime --------------------------------------------------------
    // Headless Chromium lacks window.chrome; real Chrome always has it.
    if (!(window as any).chrome) {
      (window as any).chrome = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
      };
    }

    // -- navigator.plugins -----------------------------------------------------
    // Headless has an empty PluginArray; real Chrome has at least a few.
    Object.defineProperty(navigator, "plugins", {
      get: () => [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
        { name: "Native Client", filename: "internal-nacl-plugin" },
      ],
    });

    // -- navigator.languages ---------------------------------------------------
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });

    // -- permissions query override --------------------------------------------
    // Prevent sites from detecting Notification permission state differences.
    const origQuery = Permissions.prototype.query;
    Permissions.prototype.query = function (parameters: any) {
      if (parameters.name === "notifications") {
        return Promise.resolve({ state: "prompt", onchange: null } as PermissionStatus);
      }
      return origQuery.call(this, parameters);
    };

    // -- WebGL vendor/renderer -------------------------------------------------
    // Headless often shows "Google SwiftShader"; override to a common GPU.
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param: number) {
      // UNMASKED_VENDOR_WEBGL
      if (param === 0x9245) return "Intel Inc.";
      // UNMASKED_RENDERER_WEBGL
      if (param === 0x9246) return "Intel Iris OpenGL Engine";
      return getParameter.call(this, param);
    };

    // Same for WebGL2.
    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (param: number) {
      if (param === 0x9245) return "Intel Inc.";
      if (param === 0x9246) return "Intel Iris OpenGL Engine";
      return getParameter2.call(this, param);
    };

    // -- iframe contentWindow patch --------------------------------------------
    // Some bot detectors inject an invisible iframe and check its contentWindow.
    // Ensure HTMLIFrameElement.contentWindow is never null on same-origin frames.

    // -- Hairline feature: window.outerWidth/Height ----------------------------
    // Headless often reports 0; set them to match inner dimensions.
    if (window.outerWidth === 0) {
      Object.defineProperty(window, "outerWidth", { get: () => window.innerWidth });
    }
    if (window.outerHeight === 0) {
      Object.defineProperty(window, "outerHeight", { get: () => window.innerHeight + 85 });
    }
  });

  logger.debug("Stealth scripts applied.");
}
