import type { components } from "@/lib/generated/api-types";

type AnomalyIssue = components["schemas"]["AnomalyIssue"];

export type AnomalyObjectKind = "entity" | "article" | "relation";

export type AnomalyHandoffContext = {
  issueId?: string;
  candidateId?: string;
  objectKind: AnomalyObjectKind;
  objectId: string;
  sourcePath?: string;
  sourceLine?: number;
  relationSource?: string;
  relationTarget?: string;
  relationType?: string;
  releaseId?: string;
  sourceCommit?: string;
};

const STRING_FIELDS = [
  "issueId", "candidateId", "objectKind", "objectId", "sourcePath", "relationSource",
  "relationTarget", "relationType", "releaseId", "sourceCommit",
] as const;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildAnomalyHandoffHash(context: AnomalyHandoffContext): string {
  const params = new URLSearchParams({ handoff: "formal-detail" });
  for (const field of STRING_FIELDS) {
    const value = context[field];
    if (nonEmpty(value)) params.set(field, value);
  }
  if (Number.isInteger(context.sourceLine) && Number(context.sourceLine) > 0) {
    params.set("sourceLine", String(context.sourceLine));
  }
  return `#/anomalies?${params.toString()}`;
}

export function parseAnomalyHandoff(hash: string): AnomalyHandoffContext | null {
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);
  if (params.get("handoff") !== "formal-detail") return null;
  const objectKind = params.get("objectKind");
  const objectId = params.get("objectId");
  if (!objectId || !["entity", "article", "relation"].includes(objectKind || "")) return null;
  const sourceLine = Number(params.get("sourceLine"));
  const context: AnomalyHandoffContext = {
    objectKind: objectKind as AnomalyObjectKind,
    objectId,
  };
  for (const field of STRING_FIELDS) {
    const value = params.get(field);
    if (value && field !== "objectKind" && field !== "objectId") context[field] = value;
  }
  if (Number.isInteger(sourceLine) && sourceLine > 0) context.sourceLine = sourceLine;
  return context;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function issueValues(issue: AnomalyIssue): Set<string> {
  const values = new Set<string>([issue.issueId]);
  const collect = (value: unknown) => {
    if (nonEmpty(value)) values.add(value);
  };
  const action = record(issue.proposedAction);
  ["sourceKey", "sourcePath", "entityId", "articleId", "documentId", "edgeId", "source", "target", "type"].forEach((field) => collect(action[field]));
  for (const item of issue.evidence || []) {
    const evidence = record(item);
    ["path", "sourcePath", "entityId", "articleId", "documentId", "edgeId", "source", "target", "type"].forEach((field) => collect(evidence[field]));
  }
  const candidate = record(issue.relationCandidate);
  collect(candidate.candidateId);
  for (const item of Array.isArray(candidate.triples) ? candidate.triples : []) {
    const triple = record(item);
    ["source", "target", "relationType", "type"].forEach((field) => collect(triple[field]));
  }
  return values;
}

export function matchAnomalyHandoff(issues: AnomalyIssue[], context: AnomalyHandoffContext): AnomalyIssue | null {
  if (context.issueId) return issues.find((issue) => issue.issueId === context.issueId) || null;
  if (context.candidateId) {
    const matches = issues.filter((issue) => record(issue.relationCandidate).candidateId === context.candidateId);
    return matches.length === 1 ? matches[0] : null;
  }
  const coordinates = [context.sourcePath, context.objectId, context.relationSource, context.relationTarget, context.relationType].filter(nonEmpty);
  if (coordinates.length === 0) return null;
  const matches = issues.filter((issue) => {
    const values = issueValues(issue);
    const sourceMatches = context.sourcePath ? values.has(context.sourcePath) : true;
    const relationCoordinates = [context.relationSource, context.relationTarget, context.relationType].filter(nonEmpty);
    const relationMatches = relationCoordinates.length ? relationCoordinates.every((value) => values.has(value)) : true;
    const objectMatches = values.has(context.objectId) || Boolean(context.sourcePath && sourceMatches);
    return sourceMatches && relationMatches && objectMatches;
  });
  return matches.length === 1 ? matches[0] : null;
}
