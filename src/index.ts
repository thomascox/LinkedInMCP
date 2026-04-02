import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config";
import { logger } from "./logger";
import { handleManageAuthSession } from "./tools/auth";

const server = new McpServer({
  name: config.server.name,
  version: config.server.version,
});

// -- Register tools --------------------------------------------------------

server.tool(
  "linkedin_ping",
  "Check that the LinkedIn MCP server is running",
  {},
  async () => {
    return {
      content: [{ type: "text", text: "LinkedIn MCP server is alive." }],
    };
  }
);

server.tool(
  "manage_auth_session",
  "Manage LinkedIn authentication. Use 'capture' to open a browser for manual login and save the session. Use 'verify' to check if a saved session is still valid.",
  {
    action: z
      .enum(["capture", "verify"])
      .describe("'capture' to log in and save session, 'verify' to check it"),
  },
  async (args) => {
    try {
      const message = await handleManageAuthSession(args);
      return { content: [{ type: "text", text: message }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("manage_auth_session failed:", errorMsg);
      return {
        content: [{ type: "text", text: `Error: ${errorMsg}` }],
        isError: true,
      };
    }
  }
);

// -- Start server ----------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  logger.info("Starting LinkedIn MCP server...");
  await server.connect(transport);
  logger.info("Server connected and listening on stdio.");
}

main().catch((err) => {
  logger.error("Fatal error starting server:", err);
  process.exit(1);
});
