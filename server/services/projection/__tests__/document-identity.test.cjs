const assert = require("assert");
const test = require("node:test");

const { createDocumentIdentity, sourceHash } = require("../document-identity.cjs");

test("uses article_id before architecture-node-id and source path", () => {
  assert.deepStrictEqual(createDocumentIdentity({ article_id: "ART-001", "architecture-node-id": "component-a" }, "知识库/raw/precleaned/a.md"), {
    documentId: "article:ART-001",
    articleId: "ART-001",
    architectureNodeId: "component-a",
    identitySource: "article_id",
  });
});

test("falls back to architecture-node-id and then normalized Vault path", () => {
  assert.strictEqual(createDocumentIdentity({ "architecture-node-id": "component-a" }, "知识库/wiki/entities/a.md").documentId, "entity:component-a");
  assert.strictEqual(createDocumentIdentity({}, "知识库\\wiki\\overview\\index.md").documentId, "path:知识库/wiki/overview/index.md");
});

test("rejects container identities and hashes source bytes", () => {
  assert.throws(() => createDocumentIdentity({ article_id: ["ART-001"] }, "a.md"), (error) => error.code === "INVALID_DOCUMENT_IDENTITY");
  assert.match(sourceHash("hello"), /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(sourceHash("hello"), sourceHash(Buffer.from("hello")));
});
