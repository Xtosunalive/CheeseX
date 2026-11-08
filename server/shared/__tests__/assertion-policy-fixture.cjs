const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const fixturePath = path.join(
  process.cwd(),
  "test/fixtures/relation-capability-vault/知识库/TheSchema/ontology.yaml",
);
const referenceRelations = YAML.parse(fs.readFileSync(fixturePath, "utf8")).relation_types;

function assertionPoliciesFor(type) {
  const policies = referenceRelations[type]?.assertion_policies;
  if (!Array.isArray(policies) || policies.length === 0) {
    throw new Error(`No assertion policy fixture registered for ${type}`);
  }
  return structuredClone(policies);
}

function withAssertionPolicies(relationTypes) {
  return Object.fromEntries(Object.entries(relationTypes).map(([type, definition]) => [
    type,
    { ...definition, assertion_policies: assertionPoliciesFor(type) },
  ]));
}

module.exports = { assertionPoliciesFor, withAssertionPolicies };
