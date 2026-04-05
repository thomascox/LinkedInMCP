import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config";
import { logger } from "./logger";
import { handleManageAuthSession } from "./tools/auth";
import { handleSearchLinkedin } from "./tools/search";
import { handleGetMessages, handleSendLinkedinMessage, handleGetConversation } from "./tools/messaging";
import { handleManageProfile, handleViewProfile } from "./tools/profile";
import {
  handleStartApplication,
  handleFillApplicationStep,
  handleCleanupApplication,
} from "./tools/easy-apply";
import {
  handleSendConnectionRequest,
  handleGetConnections,
  handleManageConnectionRequests,
} from "./tools/connections";
import {
  handleGetJobDetails,
  handleSaveJob,
  handleGetSavedJobs,
} from "./tools/jobs";
import {
  handleGetFeed,
  handleCreatePost,
  handleReactToPost,
} from "./tools/feed";
import {
  handleGetNotifications,
  handleGetUnreadCount,
} from "./tools/notifications";

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
  "Manage LinkedIn authentication. Use 'capture' to open a browser for manual login and save the session. Use 'verify' to check validity.\n\nNOTE: Sessions expire after ~24-48 hours. If any tool returns a session-expired error, re-run with 'capture'. LinkedIn may present CAPTCHA challenges during capture.",
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

server.tool(
  "start_application",
  "Start an Easy Apply application for a LinkedIn job. Returns structured form fields and a text summary for each step. The browser session stays alive for subsequent fill_application_step calls.\n\nIMPORTANT: If you get a session-expired error, call manage_auth_session with 'capture' first. If Easy Apply button is not found, the job may require external application or the listing was removed.",
  {
    job_id: z.string().describe("LinkedIn Job ID (from search_linkedin results)"),
  },
  async (args) => {
    try {
      const result = await handleStartApplication(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("start_application failed:", errorMsg);
      return {
        content: [{ type: "text", text: `Error: ${errorMsg}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "fill_application_step",
  "Fill the current Easy Apply form step and advance. Match answers to fields by their 'label' from the previous step's fields array.\n\nTips: Use action='next' for intermediate steps, 'review' for the review page, 'submit' only on the final review step. If validation errors are returned, check required fields and retry with corrected answers. Automatically unchecks 'Follow company'.",
  {
    answers: z
      .array(
        z.object({
          label: z.string().describe("The field label as shown in the form"),
          value: z.string().describe("The value to fill in"),
        })
      )
      .describe("Array of field answers to fill in the current step"),
    action: z
      .enum(["next", "review", "submit"])
      .describe("'next' to advance, 'review' to go to review, 'submit' to submit the application"),
  },
  async (args) => {
    try {
      const result = await handleFillApplicationStep(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("fill_application_step failed:", errorMsg);
      return {
        content: [{ type: "text", text: `Error: ${errorMsg}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "cancel_application",
  "Cancel and clean up an in-progress Easy Apply session. Call this to abort, on unrecoverable errors mid-application, or before starting a new application (each job requires its own session).",
  {},
  async () => {
    try {
      const result = await handleCleanupApplication();
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("cancel_application failed:", errorMsg);
      return {
        content: [{ type: "text", text: `Error: ${errorMsg}` }],
        isError: true,
      };
    }
  }
);

// -- Phase 1: Profile & People ---------------------------------------------

server.tool(
  "view_profile",
  "View any LinkedIn profile by URL. Returns name, headline, location, about, experience (top 5), education (top 3), and skills (top 10) as compact JSON.\n\nThe profile_url must be a full LinkedIn URL (e.g. 'https://www.linkedin.com/in/username'). If a profile is private or out-of-network, some sections may be empty.",
  {
    profile_url: z
      .string()
      .url()
      .describe("Full LinkedIn profile URL (e.g. 'https://www.linkedin.com/in/username')"),
  },
  async (args) => {
    try {
      const result = await handleViewProfile(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("view_profile failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

server.tool(
  "send_connection_request",
  "Send a LinkedIn connection request to a profile. Returns status: sent | already_connected | pending | limit_reached | connect_button_not_found.\n\nIMPORTANT: If status is 'limit_reached', stop and inform the user — LinkedIn enforces a weekly cap on invitations. Optional note is capped at 300 characters. If the button is not found, the profile may be private or require InMail.",
  {
    profile_url: z
      .string()
      .url()
      .describe("Full LinkedIn profile URL"),
    note: z
      .string()
      .max(300)
      .optional()
      .describe("Optional personal note to include with the request (max 300 chars)"),
  },
  async (args) => {
    try {
      const result = await handleSendConnectionRequest(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("send_connection_request failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

// -- Phase 2: Jobs ---------------------------------------------------------

server.tool(
  "get_job_details",
  "Get full details for a LinkedIn job posting. Returns title, company, location, workplace type, posted date, applicant count, Easy Apply status, and description (capped at 2000 chars).\n\nUse the job_id from search_linkedin results. If the listing was removed, you will get an empty response — search again for alternatives.",
  {
    job_id: z.string().describe("LinkedIn Job ID (from search_linkedin results)"),
  },
  async (args) => {
    try {
      const result = await handleGetJobDetails(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("get_job_details failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

server.tool(
  "save_job",
  "Bookmark/save a LinkedIn job for later. Returns status: saved | already_saved. Use job_id from search_linkedin or get_job_details.",
  {
    job_id: z.string().describe("LinkedIn Job ID to save"),
  },
  async (args) => {
    try {
      const result = await handleSaveJob(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("save_job failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

server.tool(
  "get_saved_jobs",
  "Retrieve your saved/bookmarked LinkedIn jobs. Returns up to 20 jobs with the same structure as search_linkedin (jobId, title, company, location, easyApply).",
  {},
  async () => {
    try {
      const result = await handleGetSavedJobs();
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("get_saved_jobs failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

// -- Phase 3: Messaging (depth) -------------------------------------------

server.tool(
  "get_conversation",
  "Read the full message history of a LinkedIn conversation thread. Returns up to 20 messages with sender, text (capped at 500 chars), and timestamp.\n\nUse the conversationUrl from get_messages results. Call get_messages first if you don't have a conversation URL.",
  {
    conversation_url: z
      .string()
      .url()
      .describe("LinkedIn conversation thread URL (from get_messages results)"),
  },
  async (args) => {
    try {
      const result = await handleGetConversation(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("get_conversation failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

server.tool(
  "get_unread_count",
  "Get the count of unread messages and unread notifications from the LinkedIn nav badges. Fast check — navigates to the feed and reads badge numbers without loading full inbox.",
  {},
  async () => {
    try {
      const result = await handleGetUnreadCount();
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("get_unread_count failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

// -- Phase 4: Feed & Content -----------------------------------------------

server.tool(
  "get_feed",
  "Fetch the top 10 non-promoted posts from your LinkedIn home feed. Returns author, headline, post text snippet (300 chars), reaction count, comment count, and post URL.",
  {},
  async () => {
    try {
      const result = await handleGetFeed();
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("get_feed failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

server.tool(
  "create_post",
  "Create a new LinkedIn post. IMPORTANT: Always confirm the exact post text with the user before calling this tool — posts are immediately visible to your network.\n\nReturns status: posted. visibility defaults to 'anyone' (public). Use 'connections' to limit to 1st-degree connections only.",
  {
    text: z.string().min(1).describe("The post content to publish"),
    visibility: z
      .enum(["anyone", "connections"])
      .optional()
      .describe("Who can see the post: 'anyone' (default) or 'connections' only"),
  },
  async (args) => {
    try {
      const result = await handleCreatePost(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("create_post failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

server.tool(
  "react_to_post",
  "React to a LinkedIn post. Use the postUrl from get_feed results.\n\nAvailable reactions: like | celebrate | support | funny | love | insightful. If the reaction picker does not open, fall back to 'like'.",
  {
    post_url: z
      .string()
      .url()
      .describe("Full LinkedIn post URL (from get_feed results)"),
    reaction: z
      .enum(["like", "celebrate", "support", "funny", "love", "insightful"])
      .describe("The reaction type to apply"),
  },
  async (args) => {
    try {
      const result = await handleReactToPost(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("react_to_post failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

// -- Phase 5: Notifications & Connections ----------------------------------

server.tool(
  "get_notifications",
  "Fetch your 10 most recent LinkedIn notifications. Returns type (connection | job | reaction | comment | mention | birthday | work_anniversary | profile_view | post_share), actor name, text snippet (200 chars), and timestamp.",
  {},
  async () => {
    try {
      const result = await handleGetNotifications();
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("get_notifications failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

server.tool(
  "get_connections",
  "List your LinkedIn connections. Returns up to 20 connections with name, headline, and profile URL. Use the optional search keyword to filter by name.",
  {
    search: z
      .string()
      .optional()
      .describe("Optional name filter to search within your connections"),
  },
  async (args) => {
    try {
      const result = await handleGetConnections(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("get_connections failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
    }
  }
);

server.tool(
  "manage_connection_requests",
  "Manage incoming LinkedIn connection requests. Use action='list_received' to see pending invites (returns name, headline, profileUrl, mutualConnections). Use 'accept' or 'decline' with a profile_url to respond to a specific request.",
  {
    action: z
      .enum(["list_received", "accept", "decline"])
      .describe("'list_received' to see pending requests, 'accept' or 'decline' to respond"),
    profile_url: z
      .string()
      .url()
      .optional()
      .describe("Profile URL of the person to accept or decline (required for accept/decline)"),
  },
  async (args) => {
    try {
      const result = await handleManageConnectionRequests(args);
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("manage_connection_requests failed:", errorMsg);
      return { content: [{ type: "text", text: `Error: ${errorMsg}` }], isError: true };
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
