// Dashboard API layer — response shape comes from the OpenAPI contract.
import type { paths } from "@/lib/generated/api-types";
import { dashboardTopologyRequestFailed } from "./dashboard-copy";

export type TopologyRawResponse =
  paths["/api/dashboard/topology"]["get"]["responses"][200]["content"]["application/json"];

export class DashboardApiError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchTopology(scope: "full" | "architecture" = "full"): Promise<TopologyRawResponse> {
  const response = await fetch(`/api/dashboard/topology?scope=${scope}`, {
    cache: "no-store",
  });
  const body = (await response.json()) as TopologyRawResponse & {
    error_code?: string;
    message?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new DashboardApiError(
      body.message || body.error || dashboardTopologyRequestFailed(response.status),
      body.error_code || "UNKNOWN_ERROR",
      response.status,
    );
  }
  return body;
}
