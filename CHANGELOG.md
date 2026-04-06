# Changelog

All notable changes to this project will be documented in this file.

## [0.7.4] - 2026-04-06

### Added

- **`manage_experience`** — Add or edit LinkedIn experience entries on your own profile. Supports all standard fields: title, company, employment type, location, location type, start/end dates, current role flag, and description. For `edit`, matches existing entries by case-insensitive partial title match (use `get_profile` to see current titles). Autocomplete is attempted for company names. DOM selectors confirmed via live inspection (April 2026): `input[placeholder="Ex: Retail Sales Manager"]` (title), `input[placeholder="Ex: Microsoft"]` (company), `getByLabel('Employment type')` select, `getByLabel(/month|year/i).nth(0/1)` (start/end dates), `<p>` "I am currently working in this role" adjacent checkbox, `getByLabel('Location type')` select, `textarea` (description).

## [0.7.3] - 2026-04-05

### Fixed

- **`view_profile` / `get_profile` — Experience, Education, Skills always empty** — LinkedIn's April 2026 profile layout no longer renders these sections on the main profile page at all (only the top card and Activity feed are present). Confirmed via live DOM inspection. These sections now require navigating to separate detail pages and clicking a "Load more" button before any content appears in the DOM:
  - `{profileUrl}details/experience/`
  - `{profileUrl}details/education/`
  - `{profileUrl}details/skills/`
  - (`/details/about/` returns 404 — About is extracted from the main profile page if present)
- **Profile scraping now uses `#workspace.innerText` text parsing** — confirmed via DOM inspection that the detail pages contain no `<li>` elements and no stable class names. All content is parsed line-by-line from plain text. Separate parsers for experience (title/company/duration/bullets), education (school/degree/date anchoring), and skills (endorsement noise filtered).
- **`get_profile` now follows `/in/me/` redirect** to capture the real profile URL before constructing detail page URLs.
- **`update_section` (headline and about) — timeout on long text** — replaced `pressSequentially({delay})` with `locator.fill()` which sets the full value instantly. Both `<textarea>` and `[contenteditable]` elements are supported by Playwright's `fill()`.

## [0.7.2] - 2026-04-05

### Fixed

- **LinkedIn April 2026 DOM compatibility** — LinkedIn hashed all CSS class names; every selector that referenced a class name (`.pv-top-card`, `.jobs-unified-top-card`, `.text-heading-xlarge`, etc.) was silently returning empty results or timing out. All selectors across all 9 tool files have been replaced with stable alternatives: `data-urn`, `aria-label`, `href` patterns, `id` attributes, element type + text content, and ARIA roles.
- **`profile.ts` — `view_profile` / `get_profile` returning empty About/Experience/Education/Skills** — root cause was two-fold: (1) LinkedIn lazy-loads profile sections below the fold and the scraper never scrolled; (2) the old code used class-based section selectors that no longer exist. Fixed by:
  - Adding `scrollToLoadSections()` which scrolls `main#workspace` (LinkedIn's custom overflow container — `window.scrollTo` has no effect) in 5 incremental steps to trigger lazy loading
  - Replacing all class-based selectors with a `findSection(keyword)` helper that locates sections by their `<h2>` text content — stable against class name hashing
  - `ProfileData` now returns `about` (string), `experience[]`, `education[]`, and `skills[]`
- **`profile.ts` — `update_section headline` failing** — LinkedIn replaced the edit modal with a full-page editor at `/in/me/edit/intro/`. Rewrote `updateHeadline` to navigate there directly and target the single `[contenteditable]` div.
- **`auth.ts` — `verify` testing wrong code path** — was using `chromium.launch + newContext({storageState})` (cookies only) while all tools use `launchPersistentContext`. Fixed to use the same persistent context path, so verify now accurately tests the real session.
- **`jobs.ts` — all three handlers** — replaced `waitUntil: "domcontentloaded"` with `"load"`, added 2s delay before auth check, replaced `waitForSelector` with `waitForLoadState` fallback, and rewrote `getJobDetails` scraping to use `h1` (title), `a[href*="/company/"]` (company), `div#job-details` (description). `getSavedJobs` now uses `a[href*="/jobs/view/"]` link-based extraction.
- **`easy-apply.ts`** — `waitUntil: "domcontentloaded"` → `"load"`, added auth timing fix, improved `getModalLocator` with `role="dialog"` fallbacks alongside class selectors.
- **`connections.ts`, `feed.ts`, `messaging.ts`, `notifications.ts`, `search.ts`** — all `waitForSelector` calls with hashed class names replaced with `waitForLoadState("networkidle").catch(fallback)`; all `waitUntil` changed to `"load"` with 45s timeouts; 2s auth-check delay added throughout.

## [0.7.1] - 2026-04-05

### Changed

- Extracted `randomDelay()` into `response-utils.ts` — was duplicated identically in `easy-apply.ts`, `messaging.ts`, `profile.ts`, and `feed.ts`
- Removed dead `inferNotificationType` export from `notifications.ts` (logic is inline inside `page.evaluate` where it belongs)
- Added `ConnectionAction` type alias in `connections.ts` to replace inline union duplicated across function signature and exported handler
- Replaced N+1 Playwright `getAttribute()` loop in `manageConnectionRequests` with a single `page.evaluate()` call to locate the matching invitation card by index
- Replaced blind `waitForTimeout` calls in `getFeed`, `viewProfile`, and `getJobDetails` with `waitForSelector` on actual content elements — more reliable and faster
- Replaced dead-code `waitForTimeout(2000)` in `getConversation` (comment referenced a scroll that was never performed) with `waitForSelector` on message bubble content

## [0.7.0] - 2026-04-05

### Added

- **Semantic data reduction** — all tools now return `compactJson` (strips null/empty fields, no indentation); DOM scraping scoped to `[role="main"]` or specific section; long text fields capped at the scraper level; tool descriptions act as mini-prompts with retry and edge-case guidance
- `response-utils.ts` — shared `compactJson`, `fieldsToSummary`, and `randomDelay` utilities
- **`view_profile`** — scrape any LinkedIn profile by URL; returns name, headline, location, connection degree, about, experience (top 5), education (top 3), skills (top 10)
- **`send_connection_request`** — send a connection request with optional note; returns `sent | already_connected | pending | limit_reached | connect_button_not_found`
- **`get_connections`** — list up to 20 connections with optional name filter
- **`manage_connection_requests`** — list pending invites, or accept/decline a specific request by profile URL
- **`get_job_details`** — full job posting details including description (capped at 2000 chars), workplace type, applicant count, and Easy Apply status
- **`save_job`** — bookmark a job by ID; returns `saved | already_saved`
- **`get_saved_jobs`** — retrieve up to 20 saved/bookmarked jobs in the same shape as `search_linkedin` results
- **`get_conversation`** — read up to 20 messages from a conversation thread (URL from `get_messages`)
- **`get_unread_count`** — read unread message and notification badge counts from the nav
- **`get_feed`** — fetch top 10 non-promoted posts from the home feed with author, text snippet, reaction count, comment count, and post URL
- **`create_post`** — publish a post with configurable visibility (`anyone` | `connections`)
- **`react_to_post`** — react to a post with `like | celebrate | support | funny | love | insightful`
- **`get_notifications`** — fetch 10 most recent notifications with inferred type, actor, text snippet, and timestamp

### Changed

- `get_messages` now includes `conversationUrl` in each thread result for use with `get_conversation`
- `manage_profile get_profile` response switched from pretty-printed JSON to `compactJson`
- `search_linkedin` response switched to `compactJson`

## [0.6.1] - 2026-04-02

### Changed

- Replaced multi-step README setup guide with a true one-command installer
- Added `install.sh` — clones repo, installs deps, builds, installs Chromium, and patches Claude Desktop config automatically
- README now shows `curl ... | bash` as the single setup step with manual fallback instructions

## [0.6.0] - 2026-04-02

### Added

- **Stealth layer** (`src/stealth.ts`) — applies anti-detection patches to every browser context:
  - Removes `navigator.webdriver`, injects `window.chrome` runtime stubs
  - Populates `navigator.plugins` with realistic entries
  - Overrides WebGL vendor/renderer to mask headless GPU signatures
  - Patches `Permissions.prototype.query`, fixes `outerWidth`/`outerHeight`
  - Chromium launched with `--disable-blink-features=AutomationControlled`
  - Sets realistic locale (`en-US`) and timezone (`America/New_York`)
- **Global rate limiter** (`src/rate-limiter.ts`) — enforces 10-30s randomized delay between all LinkedIn actions across all tools
- One-click setup guide in README with Claude Desktop `config.json` example pointing to compiled `dist/index.js`
- `prepare` script in package.json for automatic build on `npm install`
- `bin` field and `start:built` script for running from compiled output

### Changed

- `browser.ts` now integrates stealth scripts and rate limiting into `launchWithSession()`
- `auth.ts` capture and verify flows now apply stealth patches and rate limiting
- `easy-apply.ts` `fillApplicationStep` now rate-limited between steps
- README fully rewritten with Quick Start, Stealth & Safety, and all tool documentation
- Package version bumped to 0.5.0

## [0.5.0] - 2026-04-02

### Added

- `start_application` tool — navigates to a job listing, clicks Easy Apply, captures the initial modal form state (fields, HTML, screenshot), and returns it for LLM processing
- `fill_application_step` tool — fills form fields by label/value pairs with human-like typing, supports text, textarea, select, radio, checkbox, and contenteditable inputs; advances with next/review/submit actions
- `cancel_application` tool — cleans up an in-progress Easy Apply browser session
- Persistent browser session manager for multi-step Easy Apply modal (browser stays alive across tool calls)
- Automatic "Follow company" checkbox unchecking at the review/submit step
- Form field extraction covering text, textarea, select, radio groups, checkboxes, and file inputs
- Validation error detection with re-capture of step state for LLM retry
- Screenshot capture at each step and on errors (`~/.linkedin-mcp/screenshots/`)
- `screenshotsDir` added to central config

## [0.4.0] - 2026-04-02

### Added

- `manage_profile` tool with two actions:
  - `get_profile` — scrapes the authenticated user's headline, about section (with "see more" expansion), and experience entries (title, company, duration, description)
  - `update_section` — edits headline or about by opening the appropriate edit modal, clearing existing text with select-all, typing new content with human-like `pressSequentially` delay (50-150ms), clicking Save, and waiting for the confirmation toast
- Shared `clickModalSave()` helper that clicks Save and waits for modal dismissal

## [0.3.0] - 2026-04-02

### Added

- `get_messages` tool — retrieves the last 10 conversation threads from the LinkedIn inbox with sender names and message snippets
- `send_linkedin_message` tool — sends a direct message to a LinkedIn profile
  - Checks for Message button availability (1st-degree connection gate)
  - Uses `pressSequentially` with randomized 50-150ms per-character delay to mimic human typing
  - Returns informational message instead of erroring when recipient is not a 1st-degree connection

### Changed

- Extracted shared `launchWithSession()` and `ensureAuthenticated()` into `src/browser.ts` to eliminate duplication across tool modules
- Refactored `search.ts` to use shared browser helpers

## [0.2.0] - 2026-04-02

### Added

- `search_linkedin` tool with PEOPLE and JOBS categories
  - People search: scrapes names, headlines, and profile URLs
  - Jobs search: scrapes job ID, title, company, location, and Easy Apply status
  - Optional filters for location, remote status, and experience level
  - Infinite scroll helper to load additional results
  - Reusable `launchWithSession()` browser helper with session expiry detection
- Added `"DOM"` to tsconfig `lib` for Playwright `page.evaluate()` browser-context code

## [0.1.0] - 2026-04-02

### Added

- Initial project setup with TypeScript, ts-node, and Playwright
- MCP server using `@modelcontextprotocol/sdk` with Stdio transport
- Stderr logging utility to prevent JSON-RPC message corruption on stdout
- Central configuration object for browser user data and storage state paths (`~/.linkedin-mcp/`)
- `linkedin_ping` tool for server health checks
- `manage_auth_session` tool with two actions:
  - `capture` — launches a headed Chromium browser for manual LinkedIn login, polls for `/feed` URL, and saves session via `context.storageState()`
  - `verify` — launches a headless browser with saved state, navigates to feed, and checks for user avatar presence
- README with installation, configuration, usage, and Claude Desktop integration instructions
- `npm start` script for launching the server
