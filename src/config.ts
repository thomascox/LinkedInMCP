import path from "path";
import os from "os";

const BASE_DIR = path.join(os.homedir(), ".linkedin-mcp");

export const config = {
  browser: {
    userDataDir: path.join(BASE_DIR, "browser-data"),
    storageStatePath: path.join(BASE_DIR, "storageState.json"),
    screenshotsDir: path.join(BASE_DIR, "screenshots"),
  },
  server: {
    name: "linkedin-mcp-server",
    version: "0.1.0",
  },
};
