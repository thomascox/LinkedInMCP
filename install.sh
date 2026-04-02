#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/thomascox/LinkedInMCP.git"
INSTALL_DIR="$HOME/.linkedin-mcp-server"
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

echo "LinkedIn MCP Server — Installer"
echo "================================"

# -- 1. Clone or update -------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "-> Updating existing install at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "-> Cloning into $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# -- 2. Install dependencies + build -----------------------------------------
echo "-> Installing dependencies and building..."
cd "$INSTALL_DIR"
npm install --silent

# -- 3. Install Playwright Chromium ------------------------------------------
echo "-> Installing Playwright Chromium..."
npx --yes playwright install chromium

# -- 4. Patch Claude Desktop config ------------------------------------------
ENTRY_POINT="$INSTALL_DIR/dist/index.js"

if [ ! -f "$CLAUDE_CONFIG" ]; then
  echo "-> Claude Desktop config not found. Creating it..."
  mkdir -p "$(dirname "$CLAUDE_CONFIG")"
  echo '{"mcpServers":{}}' > "$CLAUDE_CONFIG"
fi

# Use node to safely merge the new server entry into the existing JSON.
node - <<EOF
const fs = require('fs');
const path = '$CLAUDE_CONFIG';
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {}
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.linkedin = {
  command: 'node',
  args: ['$ENTRY_POINT']
};
fs.writeFileSync(path, JSON.stringify(cfg, null, 2));
console.log('-> Claude Desktop config updated.');
EOF

echo ""
echo "Done! Restart Claude Desktop to load the LinkedIn MCP server."
echo ""
echo "First-time setup: ask Claude to run:"
echo "  manage_auth_session with action 'capture'"
echo "A browser window will open for you to log in to LinkedIn."
