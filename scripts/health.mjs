import process from "node:process";
import { pathToFileURL } from "node:url";

const apiPort = process.env.API_PORT || "18083";
const vitePort = process.env.VITE_PORT || "5174";

export const ALL_CHECKS = [
  ["API", `http://127.0.0.1:${apiPort}/api/health`],
  ["Web", `http://127.0.0.1:${vitePort}/`],
];

// Parse --api / --web flags; no flags = check all
export function selectChecks(args, allChecks = ALL_CHECKS) {
  const wantApi = args.includes("--api");
  const wantWeb = args.includes("--web");
  return (wantApi || wantWeb)
    ? allChecks.filter(([label]) => (wantApi && label === "API") || (wantWeb && label === "Web"))
    : allChecks;
}

export async function checkOne([label, url], { fetchImpl = fetch, logger = console } = {}) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(3_000) });
    await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    logger.log(`[health] ${label}: ready (${response.status})`);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`[health] ${label}: unavailable (${reason})`);
    return false;
  }
}

// Parallel execution — worst case is one timeout, not N sequential timeouts
export async function runHealth({ args = [], allChecks = ALL_CHECKS, check = checkOne, logger = console } = {}) {
  const checks = selectChecks(args, allChecks);
  const results = await Promise.all(checks.map((item) => check(item)));
  const failed = results.filter((ok) => !ok).length;

  if (failed > 0) logger.error(`[health] ${failed} service(s) unavailable.`);
  else logger.log("[health] All services are ready.");
  return { failed, checked: checks.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runHealth({ args: process.argv.slice(2) });
  process.exitCode = result.failed > 0 ? 1 : 0;
}
