# Changelog

All notable changes to this project will be documented in this file.

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
