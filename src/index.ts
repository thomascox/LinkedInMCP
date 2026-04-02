import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config";
import { logger } from "./logger";
import { handleManageAuthSession } from "./tools/auth";
import { handleSearchLinkedin } from "./tools/search";

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

server.tool(
  "search_linkedin",
  "Search LinkedIn for people or jobs. Returns structured JSON results including profile URLs (people) or job IDs with Easy Apply status (jobs).",
  {
    category: z
      .enum(["PEOPLE", "JOBS"])
      .describe("Type of LinkedIn search to perform"),
    keywords: z.string().describe("Search keywords"),
    filters: z
      .object({
        location: z.string().optional().describe("Location name (e.g. 'San Francisco Bay Area')"),
        remote: z
          .enum(["onsite", "remote", "hybrid"])
          .optional()
          .describe("Work arrangement filter (jobs only)"),
        experienceLevel: z
          .enum(["internship", "entry", "associate", "mid-senior", "director", "executive"])
          .optional()
          .describe("Experience level filter (jobs only)"),
      })
      .optional()
      .describe("Optional search filters"),
  },
  async (args) => {
    try {
      const result = await handleSearchLinkedin(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("search_linkedin failed:", errorMsg);
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
