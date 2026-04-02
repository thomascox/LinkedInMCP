import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config";
import { logger } from "./logger";
import { handleManageAuthSession } from "./tools/auth";
import { handleSearchLinkedin } from "./tools/search";
import { handleGetMessages, handleSendLinkedinMessage } from "./tools/messaging";
import { handleManageProfile } from "./tools/profile";

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

server.tool(
  "get_messages",
  "Retrieve the last 10 conversation threads from the LinkedIn messaging inbox. Returns sender names and message snippets.",
  {},
  async () => {
    try {
      const result = await handleGetMessages();
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("get_messages failed:", errorMsg);
      return {
        content: [{ type: "text", text: `Error: ${errorMsg}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "send_linkedin_message",
  "Send a direct message to a LinkedIn user via their profile URL. Only works for 1st-degree connections where the Message button is available.",
  {
    profile_url: z
      .string()
      .url()
      .describe("Full LinkedIn profile URL (e.g. 'https://www.linkedin.com/in/username')"),
    message_body: z
      .string()
      .min(1)
      .describe("The message text to send"),
  },
  async (args) => {
    try {
      const result = await handleSendLinkedinMessage(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("send_linkedin_message failed:", errorMsg);
      return {
        content: [{ type: "text", text: `Error: ${errorMsg}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "manage_profile",
  "Manage your LinkedIn profile. Use 'get_profile' to scrape your headline, about, and experience. Use 'update_section' to edit a specific section (headline or about).",
  {
    action: z
      .enum(["get_profile", "update_section"])
      .describe("'get_profile' to read profile data, 'update_section' to edit a section"),
    section: z
      .enum(["headline", "about"])
      .optional()
      .describe("Section to update (required for update_section)"),
    text: z
      .string()
      .optional()
      .describe("New text content for the section (required for update_section)"),
  },
  async (args) => {
    try {
      const result = await handleManageProfile(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("manage_profile failed:", errorMsg);
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
