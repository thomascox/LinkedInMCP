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

## Project Structure

```
LinkedInMCP/
├── src/
│   ├── index.ts          # Server entry point, tool registration
│   ├── config.ts         # Central configuration (paths, server metadata)
│   ├── logger.ts         # Stderr logging utility (prevents JSON-RPC corruption)
│   └── tools/
│       ├── auth.ts       # manage_auth_session implementation
│       └── search.ts     # search_linkedin implementation
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
