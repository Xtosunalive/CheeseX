const assert = require("assert");
const {
  decorateEdge,
  edgeMatchesIdentity,
  evidenceHash,
  identityFromPayload,
  stableEdgeId,
} = require("../edge-identity.cjs");

function run() {
  const edgeA = {
    from: "api-gateway",
    to: "auth-service",
    relationType: "DEPENDS_ON",
    sourceFile: "wiki/entities/api-gateway.md",
    properties: {
      sources: [{ line_number: 9, evidence_text: "依赖::[[auth-service]]" }],
    },
  };
  const edgeB = {
    from: "api-gateway",
    to: "auth-service",
    relationType: "CONNECTS_TO",
    sourceFile: "wiki/entities/api-gateway.md",
    properties: {
      sources: [{ line_number: 10, evidence_text: "连接::[[auth-service]]" }],
    },
  };
  const remappedEdgeA = {
    ...edgeA,
    relationType: "RELATED",
  };

  assert.notStrictEqual(stableEdgeId(edgeA), stableEdgeId(edgeB), "line/evidence must affect edge identity");
  assert.notStrictEqual(stableEdgeId(edgeA), stableEdgeId(remappedEdgeA), "different relationType must produce different edge identity");

  // Same source/target with different relationType but same evidence → distinct IDs
  const docEdge = { from: "doc-1", to: "comp-1", relationType: "DOCUMENTS", sourceFile: "a.md", properties: { sources: [{ line_number: 1, evidence_text: "x" }] } };
  const refEdge = { from: "doc-1", to: "comp-1", relationType: "REFERENCES", sourceFile: "a.md", properties: { sources: [{ line_number: 1, evidence_text: "x" }] } };
  assert.notStrictEqual(stableEdgeId(docEdge), stableEdgeId(refEdge), "DOCUMENTS and REFERENCES between same nodes must have different edgeId");

  // edgeMatchesIdentity with relationType filters correctly
  const docIdentity = identityFromPayload({ source: "doc-1", target: "comp-1", type: "DOCUMENTS", sourceFile: "a.md", lineNumber: 1, evidenceHash: evidenceHash(docEdge) });
  assert(edgeMatchesIdentity(docEdge, docIdentity), "identity with relationType matches same-type edge");
  assert(!edgeMatchesIdentity(refEdge, docIdentity), "identity with relationType does not match different-type edge");

  const decorated = decorateEdge(edgeA);
  assert.strictEqual(decorated.sourceFile, "wiki/entities/api-gateway.md");
  assert.strictEqual(decorated.lineNumber, 9);
  assert.ok(decorated.evidenceHash);

  const exact = identityFromPayload({
    edgeId: decorated.edgeId,
    source: "api-gateway",
    target: "auth-service",
  });
  assert(edgeMatchesIdentity(edgeA, exact), "edgeId should match the original edge");
  assert(!edgeMatchesIdentity(edgeB, exact), "edgeId should not match a sibling edge");

  const collidedDocuments = { ...docEdge, edgeId: "legacy-collision" };
  const collidedReferences = { ...refEdge, edgeId: "legacy-collision" };
  assert.notStrictEqual(stableEdgeId(collidedDocuments), stableEdgeId(collidedReferences), "legacy explicit IDs must not preserve cross-type collisions");

  const legacy = identityFromPayload({
    source: "api-gateway",
    target: "auth-service",
    type: "DEPENDS_ON",
    sourceFile: "wiki/entities/api-gateway.md",
    lineNumber: 9,
    evidenceHash: decorated.evidenceHash,
  });
  assert(edgeMatchesIdentity(edgeA, legacy), "composite identity should match");
  assert(!edgeMatchesIdentity(edgeB, legacy), "composite identity should distinguish sibling edges");

  console.log("Edge-Identity tests passed: 13 passed, 0 failed");
}

run();
