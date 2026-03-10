import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const BADGE_PATTERN = /tests-\d+%20passed/g;

/**
 * Parse vitest JSON reporter output and extract the number of passed tests.
 * Handles cases where the JSON is surrounded by extra output lines.
 */
export function parseTestCount(output: string): number {
  const lines = output.trim().split("\n");
  let parsed: { numPassedTests?: number } | undefined;

  for (const line of lines) {
    try {
      const candidate = JSON.parse(line.trim());
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        "numPassedTests" in candidate
      ) {
        parsed = candidate;
        break;
      }
    } catch {
      // not a JSON line, skip
    }
  }

  // If no line-by-line match, try parsing the whole output as JSON
  if (!parsed) {
    try {
      const candidate = JSON.parse(output.trim());
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        "numPassedTests" in candidate
      ) {
        parsed = candidate;
      }
    } catch {
      // ignore
    }
  }

  if (!parsed || typeof parsed.numPassedTests !== "number") {
    throw new Error(
      "Failed to parse test results: numPassedTests not found in JSON output"
    );
  }

  if (parsed.numPassedTests <= 0) {
    throw new Error(
      `Invalid test count: ${parsed.numPassedTests}. Expected a positive number.`
    );
  }

  return parsed.numPassedTests;
}

/**
 * Build the badge URL fragment for a given test count.
 */
export function buildBadgeText(count: number): string {
  if (count <= 0) {
    throw new Error(`Invalid count: ${count}. Must be positive.`);
  }
  return `tests-${count}%20passed`;
}

/**
 * Replace all badge occurrences in README content with the new count.
 * Returns the updated content string.
 */
export function replaceBadge(content: string, count: number): string {
  if (!BADGE_PATTERN.test(content)) {
    throw new Error("No test badge pattern found in content");
  }

  // Reset lastIndex since we used .test() with a global regex
  BADGE_PATTERN.lastIndex = 0;

  const newBadge = buildBadgeText(count);
  return content.replace(BADGE_PATTERN, newBadge);
}

/**
 * Main entry point: run vitest, parse results, update README.md badge.
 */
async function main(): Promise<void> {
  const projectRoot = resolve(import.meta.dirname, "..", "..");
  const readmePath = resolve(projectRoot, "README.md");

  // Run vitest with JSON reporter
  let output: string;
  try {
    output = execSync("npx vitest run --reporter=json", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    // vitest exits with non-zero when tests fail, but still produces JSON
    if (error && typeof error === "object" && "stdout" in error) {
      output = (error as { stdout: string }).stdout;
    } else {
      throw new Error(`Failed to run vitest: ${error}`);
    }
  }

  const passedCount = parseTestCount(output);

  const readmeContent = readFileSync(readmePath, "utf-8");
  const updatedContent = replaceBadge(readmeContent, passedCount);

  if (updatedContent === readmeContent) {
    console.log(`Badge is already up to date (${passedCount} passed).`);
    return;
  }

  writeFileSync(readmePath, updatedContent, "utf-8");
  console.log(`Updated badge: ${passedCount} passed.`);
}

// Run main only when executed directly (not imported in tests)
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("update-test-badge.ts");

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
