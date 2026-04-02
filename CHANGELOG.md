# Changelog

All notable changes to this project will be documented in this file.

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
