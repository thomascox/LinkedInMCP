# LinkedIn MCP Server

A Model Context Protocol (MCP) server that provides LinkedIn automation tools via Playwright browser control. Designed to work with MCP clients like Claude Desktop over the Stdio transport.

Includes built-in stealth measures to reduce automation detection and a global rate limiter (10-30s randomized delay between actions) for safe, human-paced operation. All tool responses use semantic data reduction — null/empty fields are stripped, text is capped, and only the relevant DOM section is scraped — keeping token usage low.

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

A global rate limiter enforces a randomized delay of **10-30 seconds** between every LinkedIn action. This applies to all tool calls that interact with LinkedIn. The delay is measured from the completion of the previous action, so natural pauses between LLM reasoning steps count toward the wait.

### Token Efficiency

All tools use semantic data reduction to minimize context usage:

- `compactJson` — strips null/empty fields before returning JSON (no indentation)
- DOM scraping scoped to `[role="main"]` or the specific modal/section — navigation, ads, and tracking scripts are never included
- Long text fields (job descriptions, post bodies, message bodies) capped at the scraper level
- Tool descriptions act as mini-prompts with retry guidance and edge-case handling built in

---

## Tools

### Authentication

#### `linkedin_ping`

Health check to confirm the server is running.

**Parameters:** None

#### `manage_auth_session`

Manage LinkedIn authentication sessions.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `action` | `"capture"` \| `"verify"` | Yes | The action to perform |

- **`capture`** — Opens a headed browser, navigates to login, waits for you to log in, saves session cookies.
- **`verify`** — Headless check that the saved session is still valid (loads feed, checks for nav/page content).

Sessions expire after ~24-48 hours. If any tool returns a session-expired error, re-run with `capture`.

---

### Search

#### `search_linkedin`

Search LinkedIn for people or jobs. Returns compact JSON results.

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

**People result shape:** `{ name, headline, profileUrl }`

**Job result shape:** `{ jobId, title, company, location, easyApply }`

---

### Profile

#### `view_profile`

View any LinkedIn profile by URL. Returns structured JSON with name, headline, location, about, experience entries, education entries, and skills (up to 25).

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `profile_url` | `string` (URL) | Yes | Full LinkedIn profile URL (e.g. `https://www.linkedin.com/in/username`) |

#### `manage_profile`

Read or update your own LinkedIn profile sections.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `action` | `"get_profile"` \| `"update_section"` | Yes | Action to perform |
| `section` | `"headline"` \| `"about"` | For `update_section` | Section to edit |
| `text` | `string` | For `update_section` | New content |

- **`get_profile`** — Returns your headline, location, about, experience, education, and skills as compact JSON.
- **`update_section`** — Opens edit modal, clears text, types new content with human-like delay, saves, and waits for the confirmation toast.

---

### Connections

#### `send_connection_request`

Send a LinkedIn connection request. Returns `status`: `sent` | `already_connected` | `pending` | `limit_reached` | `connect_button_not_found`.

> **Important:** If status is `limit_reached`, stop — LinkedIn enforces a weekly invitation cap.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `profile_url` | `string` (URL) | Yes | Full LinkedIn profile URL |
| `note` | `string` | No | Personal note to include (max 300 chars) |

#### `get_connections`

List your LinkedIn connections. Returns up to 20 with name, headline, and profile URL.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `search` | `string` | No | Filter connections by name |

#### `manage_connection_requests`

Manage incoming connection requests.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `action` | `"list_received"` \| `"accept"` \| `"decline"` | Yes | Action to perform |
| `profile_url` | `string` (URL) | For `accept`/`decline` | Profile URL of the person to respond to |

- **`list_received`** — Returns pending invites with name, headline, profileUrl, and mutualConnections.
- **`accept`** / **`decline`** — Responds to the matching invitation.

---

### Jobs

#### `get_job_details`

Get full details for a LinkedIn job posting.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `job_id` | `string` | Yes | LinkedIn Job ID (from `search_linkedin`) |

Returns: `title`, `company`, `location`, `workplaceType`, `postedDate`, `applicantCount`, `easyApply`, `description` (capped at 2000 chars).

#### `save_job`

Bookmark a job for later. Returns `status`: `saved` | `already_saved`.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `job_id` | `string` | Yes | LinkedIn Job ID |

#### `get_saved_jobs`

Retrieve your saved/bookmarked jobs. Returns up to 20 in the same shape as `search_linkedin` job results.

**Parameters:** None

---

### Easy Apply

#### `start_application`

Start an Easy Apply application for a LinkedIn job. Returns the initial form state (fields + summary) and keeps the browser alive for subsequent `fill_application_step` calls.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `job_id` | `string` | Yes | LinkedIn Job ID |

If the Easy Apply button is not found, the job may not support Easy Apply or the listing was removed.

#### `fill_application_step`

Fill the current Easy Apply form step and advance.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `answers` | `array` | Yes | Array of `{ label, value }` pairs matching form field labels |
| `action` | `"next"` \| `"review"` \| `"submit"` | Yes | Step action to take |

Auto-unchecks "Follow company" at the review step. Returns validation errors for LLM retry when required fields are missing.

#### `cancel_application`

Cancel an in-progress Easy Apply session and close the browser.

**Parameters:** None

---

### Messaging

#### `get_messages`

Retrieve the last 10 conversation threads from the LinkedIn messaging inbox. Returns sender name, last message snippet, and a `conversationUrl` for use with `get_conversation`.

**Parameters:** None

#### `get_conversation`

Read the full message history of a conversation thread. Returns up to 20 messages with sender, text (capped at 500 chars), and timestamp.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `conversation_url` | `string` (URL) | Yes | LinkedIn conversation thread URL (from `get_messages`) |

#### `send_linkedin_message`

Send a direct message to a LinkedIn user. Only works for 1st-degree connections.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `profile_url` | `string` (URL) | Yes | Full LinkedIn profile URL |
| `message_body` | `string` | Yes | The message text to send |

#### `get_unread_count`

Get the count of unread messages and notifications from the LinkedIn nav badges.

**Parameters:** None

Returns: `{ unreadMessages, unreadNotifications }`

---

### Feed & Content

#### `get_feed`

Fetch the top 10 non-promoted posts from your LinkedIn home feed. Returns author, headline, post text snippet (300 chars), reaction count, comment count, and post URL.

**Parameters:** None

#### `create_post`

Create a new LinkedIn post.

> **Important:** Always confirm post content with the user before calling — posts are immediately visible to your network.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `text` | `string` | Yes | The post content to publish |
| `visibility` | `"anyone"` \| `"connections"` | No | Who can see the post (default: `"anyone"`) |

#### `react_to_post`

React to a LinkedIn post with a specific reaction type.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_url` | `string` (URL) | Yes | Full LinkedIn post URL (from `get_feed`) |
| `reaction` | `"like"` \| `"celebrate"` \| `"support"` \| `"funny"` \| `"love"` \| `"insightful"` | Yes | Reaction to apply |

If the reaction picker doesn't open, fall back to `"like"`.

---

### Notifications

#### `get_notifications`

Fetch your 10 most recent LinkedIn notifications. Returns `type` (`connection` | `job` | `reaction` | `comment` | `mention` | `birthday` | `work_anniversary` | `profile_view` | `post_share`), actor name, text snippet (200 chars), and timestamp.

**Parameters:** None

---

## Project Structure

```
LinkedInMCP/
├── src/
│   ├── index.ts            # Server entry point, all tool registration
│   ├── config.ts           # Central configuration (paths, server metadata)
│   ├── logger.ts           # Stderr logging utility (prevents JSON-RPC corruption)
│   ├── browser.ts          # Shared browser launch + session + stealth + rate limit
│   ├── stealth.ts          # Anti-detection init scripts (navigator, WebGL, chrome, etc.)
│   ├── rate-limiter.ts     # Global 10-30s randomized delay between actions
│   ├── response-utils.ts   # compactJson, fieldsToSummary, randomDelay
│   └── tools/
│       ├── auth.ts         # manage_auth_session
│       ├── search.ts       # search_linkedin
│       ├── profile.ts      # view_profile, manage_profile
│       ├── connections.ts  # send_connection_request, get_connections, manage_connection_requests
│       ├── jobs.ts         # get_job_details, save_job, get_saved_jobs
│       ├── messaging.ts    # get_messages, get_conversation, send_linkedin_message, get_unread_count
│       ├── feed.ts         # get_feed, create_post, react_to_post
│       ├── notifications.ts# get_notifications, get_unread_count
│       └── easy-apply.ts   # start_application, fill_application_step, cancel_application
├── dist/                   # Compiled JavaScript (generated by npm run build)
├── install.sh              # One-command installer
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
