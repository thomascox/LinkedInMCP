import { logger } from "./logger";

const MIN_DELAY_MS = 10_000; // 10 seconds
const MAX_DELAY_MS = 30_000; // 30 seconds

let lastActionTime = 0;

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Wait until enough time has passed since the last action.
 *
 * Each call sleeps for a randomized interval between 10-30 seconds
 * measured from the *previous* action's completion. If the elapsed
 * time already exceeds the chosen delay, the call returns immediately.
 *
 * Call this at the start of every tool handler that touches LinkedIn.
 */
export async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastActionTime;
  const requiredDelay = randomBetween(MIN_DELAY_MS, MAX_DELAY_MS);

  if (elapsed < requiredDelay) {
    const waitMs = requiredDelay - elapsed;
    logger.info(`Rate limiter: waiting ${(waitMs / 1000).toFixed(1)}s before next action...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  lastActionTime = Date.now();
}
