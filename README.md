# LinkedIn MCP Server

A Model Context Protocol (MCP) server that provides LinkedIn automation tools via Playwright browser control. Designed to work with MCP clients like Claude Desktop over the Stdio transport.

Includes built-in stealth measures to reduce automation detection and a global rate limiter (10-30s randomized delay between actions) for safe, human-paced operation.

## Quick Start

### Prerequisites

- **Node.js** >= 18 — [nodejs.org](https://nodejs.org)
- **Git**

### Step 1 — Run the installer (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/thomascox/LinkedInMCP/main/install.sh | bash
```

This single command:
1. Clones the repo to `~/.linkedin-mcp-server/`
2. Installs all dependencies and compiles TypeScript
3. Installs the Playwright Chromium browser
4. Writes the `linkedin` entry into your Claude Desktop config automatically

### Step 2 — Restart Claude Desktop

Quit and reopen Claude Desktop. The LinkedIn tools will appear.

### Step 3 — Authenticate

In Claude, say: _"Use manage\_auth\_session with action 'capture' to log in to LinkedIn."_

A browser window opens. Log in normally. Once you reach the feed, the session is saved and the browser closes.

That's it.

---

### Manual setup (if you prefer)

If you'd rather clone to a custom location:

```bash
git clone https://github.com/thomascox/LinkedInMCP.git
cd LinkedInMCP
npm install              # also builds dist/ automatically
npx playwright install chromium
```

Then open `~/Library/Application Support/Claude/claude_desktop_config.json` and add:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "node",
      "args": ["/full/path/to/LinkedInMCP/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop.

## Prerequisites

- **Node.js** >= 18
- **Git**
- Chromium (installed automatically by the installer or `npx playwright install chromium`)

## Configuration

The server stores browser data and session state in `~/.linkedin-mcp/`:

| Path | Purpose |
|------|---------|
| `~/.linkedin-mcp/browser-data/` | Persistent Chromium user profile |
| `~/.linkedin-mcp/storageState.json` | Saved cookies and session data |
| `~/.linkedin-mcp/screenshots/` | Easy Apply step screenshots |

No manual configuration is required. These directories are created automatically on first use.

## Stealth and Safety

### Anti-detection

Every browser context launched by the server has stealth patches applied automatically:

- Removes `navigator.webdriver` flag
- Injects `window.chrome` runtime stubs
- Populates `navigator.plugins` with realistic entries
- Overrides WebGL vendor/renderer to mask headless GPU signatures
- Sets `window.outerWidth`/`outerHeight` to match inner dimensions
- Patches `Permissions.prototype.query` for notifications
- Launches Chromium with `--disable-blink-features=AutomationControlled`
- Sets realistic user agent, locale (`en-US`), and timezone

### Rate Limiter

A global rate limiter enforces a randomized delay of **10-30 seconds** between every LinkedIn action. This applies to all tool calls that interact with LinkedIn (search, messaging, profile, applications). The delay is measured from the completion of the previous action, so natural pauses between LLM reasoning steps count toward the wait.

## Tools

### `linkedin_ping`

Health check to confirm the server is running.

**Parameters:** None

### `manage_auth_session`

Manage LinkedIn authentication sessions.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `action` | `"capture"` \| `"verify"` | Yes | The action to perform |

- **`capture`** — Opens a headed browser, navigates to login, waits for you to log in, saves session cookies.
- **`verify`** — Headless check that the saved session is still valid (loads feed, checks for avatar).

### `search_linkedin`

Search LinkedIn for people or jobs. Returns structured JSON results.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `category` | `"PEOPLE"` \| `"JOBS"` | Yes | Type of search to perform |
| `keywords` | `string` | Yes | Search keywords |
| `filters` | `object` | No | Optional filters (see below) |

**Filter options:**

| Name | Type | Applies to | Description |
|------|------|------------|-------------|
| `location` | `string` | Both | Location name (e.g. "San Francisco Bay Area") |
| `remote` | `"onsite"` \| `"remote"` \| `"hybrid"` | Jobs | Work arrangement filter |
| `experienceLevel` | `"internship"` \| `"entry"` \| `"associate"` \| `"mid-senior"` \| `"director"` \| `"executive"` | Jobs | Experience level filter |

**People results:**
```json
[{ "name": "Jane Doe", "headline": "Engineer at Acme", "profileUrl": "https://www.linkedin.com/in/janedoe" }]
```

**Job results:**
```json
[{ "jobId": "3812345678", "title": "Senior Engineer", "company": "Acme Corp", "location": "SF, CA", "easyApply": true }]
```

### `get_messages`

Retrieve the last 10 conversation threads from the LinkedIn messaging inbox.

**Parameters:** None

### `send_linkedin_message`

Send a direct message to a LinkedIn user. Only works for 1st-degree connections.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `profile_url` | `string` (URL) | Yes | Full LinkedIn profile URL |
| `message_body` | `string` | Yes | The message text to send |

Checks for the Message button (1st-degree gate), types with human-like delay (50-150ms per character), and clicks Send.

### `manage_profile`

Read or update your own LinkedIn profile sections.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `action` | `"get_profile"` \| `"update_section"` | Yes | Action to perform |
| `section` | `"headline"` \| `"about"` | For `update_section` | Section to edit |
| `text` | `string` | For `update_section` | New content |

- **`get_profile`** — Returns headline, about, and experience as JSON.
- **`update_section`** — Opens edit modal, clears text, types new content, saves, waits for toast.

### `start_application`

Start an Easy Apply application for a LinkedIn job.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `job_id` | `string` | Yes | LinkedIn Job ID |

Returns the initial form state (fields, HTML, screenshot path) for the LLM. Keeps the browser alive for `fill_application_step`.

### `fill_application_step`

Fill the current Easy Apply form step and advance.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `answers` | `array` | Yes | Array of `{ label, value }` pairs |
| `action` | `"next"` \| `"review"` \| `"submit"` | Yes | Action to take |

Auto-unchecks "Follow company" at review. Returns validation errors for LLM retry.

### `cancel_application`

Cancel an in-progress Easy Apply session and close the browser.

**Parameters:** None

## Project Structure

```
LinkedInMCP/
├── src/
│   ├── index.ts          # Server entry point, tool registration
│   ├── config.ts         # Central configuration (paths, server metadata)
│   ├── logger.ts         # Stderr logging utility (prevents JSON-RPC corruption)
│   ├── browser.ts        # Shared browser launch + session + stealth + rate limit
│   ├── stealth.ts        # Anti-detection init scripts (navigator, WebGL, chrome, etc.)
│   ├── rate-limiter.ts   # Global 10-30s randomized delay between actions
│   └── tools/
│       ├── auth.ts       # manage_auth_session implementation
│       ├── search.ts     # search_linkedin implementation
│       ├── messaging.ts  # get_messages + send_linkedin_message
│       ├── profile.ts    # manage_profile (get_profile + update_section)
│       └── easy-apply.ts # start_application + fill_application_step + cancel
├── dist/                 # Compiled JavaScript (generated by npm run build)
├── package.json
└── tsconfig.json
```

## Development

```bash
# Run from source (TypeScript)
npm start

# Run from compiled output
npm run start:built

# Type-check without emitting
npx tsc --noEmit

# Build to dist/
npm run build
```

## License

ISC
