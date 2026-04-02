# Changelog

All notable changes to this project will be documented in this file.

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
