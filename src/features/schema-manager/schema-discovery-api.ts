import { apiFetchEnvelope } from "@/lib/api";
import { SM_REQUEST_COPY } from "./schema-manager-copy";
import type { DiscoveryResponse } from "./schema-manager-types";

export async function fetchDiscovery(verifiedThreshold?: number, minCount?: number): Promise<DiscoveryResponse> {
  // 波2（SPEC-007 §3.2）：阈值透传——22:06 Master 裁决的页面配置项（非法值由服务端回落默认 1）。
  // 波3b（Master 02:57 令）：minCount 信号门槛透传——与实体阈值同款页面配置项（默认 2）。
  const params: string[] = [];
  if (typeof verifiedThreshold === "number" && Number.isInteger(verifiedThreshold) && verifiedThreshold >= 1 && verifiedThreshold <= 99) {
    params.push(`verifiedThreshold=${verifiedThreshold}`);
  }
  if (typeof minCount === "number" && Number.isInteger(minCount) && minCount >= 1 && minCount <= 99) {
    params.push(`minCount=${minCount}`);
  }
  const query = params.length ? `?${params.join("&")}` : "";
  const env = await apiFetchEnvelope<DiscoveryResponse>(`/api/schema/discovery${query}`);
  if (!env.ok || !env.data) throw new Error(env.error ?? SM_REQUEST_COPY.DISCOVERY_FETCH_FAILED);
  return env.data;
}
