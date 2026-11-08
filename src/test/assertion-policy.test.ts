import { describe, it, expect } from "vitest";
import {
  resolveAssertionPolicy,
  hasAssertionPolicies,
  RELATION_TYPES,
} from "../lib/ontology";

describe("assertion policy — generated registry", () => {
  it("every relation type in the registry has assertionPolicies", () => {
    for (const [, def] of Object.entries(RELATION_TYPES)) {
      expect(def.assertionPolicies).toBeDefined();
      expect(Array.isArray(def.assertionPolicies)).toBe(true);
      expect((def.assertionPolicies as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it("DEPEPENDS_ON has reviewed decision mode for typed_wikilink", () => {
    const def = RELATION_TYPES.DEPENDS_ON;
    expect(def.assertionPolicies).toBeDefined();
    const policy = def.assertionPolicies!.find(
      (p) => p.sourceKind === "typed_wikilink" && p.producer === "extract_graph.entity_typed_wikilink",
    );
    expect(policy).toBeDefined();
    expect(policy!.decisionMode).toBe("reviewed");
    expect(policy!.workingProjection).toBe("approved_only");
  });

  it("USES has forbidden decision mode", () => {
    const def = RELATION_TYPES.USES;
    expect(def.assertionPolicies).toBeDefined();
    const policy = def.assertionPolicies!.find(
      (p) => p.decisionMode === "forbidden",
    );
    expect(policy).toBeDefined();
    expect(policy!.workingProjection).toBe("never");
    expect(policy!.formalConsumers).toEqual([]);
  });

  it("MENTIONS has derived_only and never projection", () => {
    const def = RELATION_TYPES.MENTIONS;
    expect(def.assertionPolicies).toBeDefined();
    const policy = def.assertionPolicies!.find(
      (p) => p.decisionMode === "derived_only",
    );
    expect(policy).toBeDefined();
    expect(policy!.workingProjection).toBe("never");
  });
});

describe("resolveAssertionPolicy", () => {
  it("resolves exact match for DEPENDS_ON typed_wikilink", () => {
    const policy = resolveAssertionPolicy(
      "DEPENDS_ON",
      "typed_wikilink",
      "extract_graph.entity_typed_wikilink",
    );
    expect(policy).not.toBeNull();
    expect(policy!.decisionMode).toBe("reviewed");
  });

  it("returns null for unknown relation type", () => {
    const policy = resolveAssertionPolicy("UNKNOWN_REL", "typed_wikilink", "p");
    expect(policy).toBeNull();
  });

  it("returns null for non-matching source_kind", () => {
    const policy = resolveAssertionPolicy(
      "DEPENDS_ON",
      "article_association",
      "extract_graph.entity_typed_wikilink",
    );
    expect(policy).toBeNull();
  });

  it("returns null for non-matching producer", () => {
    const policy = resolveAssertionPolicy(
      "DEPENDS_ON",
      "typed_wikilink",
      "some.other.producer",
    );
    expect(policy).toBeNull();
  });

  it("does not apply wildcard fallback", () => {
    const policy = resolveAssertionPolicy(
      "DEPENDS_ON",
      "*",
      "extract_graph.entity_typed_wikilink",
    );
    expect(policy).toBeNull();
  });

  it("typed_wikilink is candidate only, not auto-approved", () => {
    const policy = resolveAssertionPolicy(
      "DEPENDS_ON",
      "typed_wikilink",
      "extract_graph.entity_typed_wikilink",
    );
    expect(policy).not.toBeNull();
    expect(policy!.decisionMode).toBe("reviewed");
    expect(["deterministic", "inherit_source_approval"]).not.toContain(policy!.decisionMode);
  });
});

describe("hasAssertionPolicies", () => {
  it("returns true for DEPENDS_ON", () => {
    expect(hasAssertionPolicies("DEPENDS_ON")).toBe(true);
  });

  it("returns false for unknown relation", () => {
    expect(hasAssertionPolicies("NONEXISTENT")).toBe(false);
  });

  it("returns true for all active relation types", () => {
    for (const type of Object.keys(RELATION_TYPES)) {
      expect(hasAssertionPolicies(type)).toBe(true);
    }
  });
});
