# LinkedIn MCP Server

A Model Context Protocol (MCP) server that provides LinkedIn automation tools via Playwright browser control. Designed to work with MCP clients like Claude Desktop over the Stdio transport.

## Prerequisites

- **Node.js** >= 18
- **npm**
- A Chromium-based browser (Playwright will use its bundled Chromium by default)

## Installation

```bash
# Clone the repository
git clone https://github.com/thomascox/LinkedInMCP.git
cd LinkedInMCP

# Install dependencies
npm install

# Install Playwright browsers (Chromium)
npx playwright install chromium
```

## Configuration

The server stores browser data and session state in `~/.linkedin-mcp/`:

| Path | Purpose |
|------|---------|
| `~/.linkedin-mcp/browser-data/` | Persistent Chromium user profile |
| `~/.linkedin-mcp/storageState.json` | Saved cookies and session data |

No manual configuration is required. These directories are created automatically on first use.

## Usage

### Starting the server

```bash
npm start
```

This launches the MCP server on stdio. It is intended to be started by an MCP client, not run interactively.

### Claude Desktop integration

Add the following to your Claude Desktop MCP configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "npx",
      "args": ["ts-node", "src/index.ts"],
      "cwd": "/path/to/LinkedInMCP"
    }
  }
}
```

Replace `/path/to/LinkedInMCP` with the actual path to this repository.

## Tools

### `linkedin_ping`

Health check to confirm the server is running.

**Parameters:** None

**Example response:**
```
LinkedIn MCP server is alive.
```

### `manage_auth_session`

Manage LinkedIn authentication sessions.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `action` | `"capture"` \| `"verify"` | Yes | The action to perform |

**Action: `capture`**

Opens a headed Chromium browser and navigates to LinkedIn's login page. You log in manually in the browser window. Once the URL reaches `/feed`, the session cookies are saved to `storageState.json` and the browser closes.

**Action: `verify`**

Launches a headless browser with the saved session state, navigates to the LinkedIn feed, and checks for the presence of the user avatar to confirm the session is still active.

### `search_linkedin`

Search LinkedIn for people or jobs. Returns structured JSON results.

**Parameters:**

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

**People results return:**
```json
[
  {
    "name": "Jane Doe",
    "headline": "Software Engineer at Acme",
    "profileUrl": "https://www.linkedin.com/in/janedoe"
  }
]
```

**Job results return:**
```json
[
  {
    "jobId": "3812345678",
    "title": "Senior Engineer",
    "company": "Acme Corp",
    "location": "San Francisco, CA",
    "easyApply": true
  }
]
```

### `get_messages`

Retrieve the last 10 conversation threads from the LinkedIn messaging inbox.

**Parameters:** None

**Example response:**
```json
[
  {
    "senderName": "Jane Doe",
    "lastMessageSnippet": "Thanks for connecting! I wanted to reach out about..."
  }
]
```

### `send_linkedin_message`

Send a direct message to a LinkedIn user. Only works for 1st-degree connections.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `profile_url` | `string` (URL) | Yes | Full LinkedIn profile URL |
| `message_body` | `string` | Yes | The message text to send |

The tool navigates to the profile, checks for the Message button (1st-degree connection check), opens the messaging modal, types the message with randomized per-character delay (50-150ms) to mimic human input, and clicks Send.

If the user is not a 1st-degree connection, the tool returns an informational message instead of failing.

### `manage_profile`

Read or update your own LinkedIn profile sections.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `action` | `"get_profile"` \| `"update_section"` | Yes | Action to perform |
| `section` | `"headline"` \| `"about"` | For `update_section` | Section to edit |
| `text` | `string` | For `update_section` | New content for the section |

**Action: `get_profile`**

Scrapes your own profile and returns structured data:

```json
{
  "headline": "Software Engineer at Acme",
  "about": "Passionate about building great products...",
  "experience": [
    {
      "title": "Software Engineer",
      "company": "Acme Corp",
      "duration": "Jan 2022 - Present",
      "description": "Leading frontend development..."
    }
  ]
}
```

**Action: `update_section`**

Opens the edit modal for the specified section, clears existing text, types the new content with human-like delay (50-150ms per character), clicks Save, and waits for the confirmation toast.

### `start_application`

Start an Easy Apply application for a LinkedIn job. Opens the Easy Apply modal and returns the initial form state for the LLM to process.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `job_id` | `string` | Yes | LinkedIn Job ID (from `search_linkedin` results) |

**Returns:** A JSON object containing the current step state:

```json
{
  "stepNumber": 1,
  "isReviewStep": false,
  "isComplete": false,
  "fields": [
    {
      "type": "text",
      "label": "Phone number",
      "name": "phone",
      "value": "",
      "required": true
    }
  ],
  "formHtml": "<div>...</div>",
  "screenshotPath": "/path/to/screenshot.png"
}
```

### `fill_application_step`

Fill the current Easy Apply form step and advance. The LLM manages the loop by reading fields from `start_application` or prior step responses and providing answers.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `answers` | `array` | Yes | Array of `{ label, value }` pairs for form fields |
| `action` | `"next"` \| `"review"` \| `"submit"` | Yes | Advance to next step, review, or submit |

Each answer matches a field by its label text. Supports text inputs, textareas, selects (by option label), radio buttons (by option text), checkboxes (`"true"`/`"false"`), and contenteditable divs.

At the review step, the tool automatically unchecks "Follow company" if checked. On `submit`, it clicks "Submit application" and checks for the success confirmation.

Returns validation errors if the form cannot advance, allowing the LLM to correct and retry.

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
│   ├── browser.ts        # Shared browser launch + session helpers
│   └── tools/
│       ├── auth.ts       # manage_auth_session implementation
│       ├── search.ts     # search_linkedin implementation
│       ├── messaging.ts  # get_messages + send_linkedin_message
│       ├── profile.ts    # manage_profile (get_profile + update_section)
│       └── easy-apply.ts # start_application + fill_application_step + cancel
├── package.json
└── tsconfig.json
```

## Development

```bash
# Type-check without emitting
npx tsc --noEmit

# Build to dist/
npm run build
```

## License

ISC
