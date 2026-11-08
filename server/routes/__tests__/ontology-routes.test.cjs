const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const routes = require("../ontology-routes.cjs");
const { createRouteHarness, mergeW1aActionTypes, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");
const { validateDocumentStrict } = require("../../shared/theschema-loader.cjs");
const { validateOntologyPayload } = require("../../services/schema-manager/schema-validators.cjs");
const { createSchemaWriteService } = require("../../services/schema-manager/schema-write-service.cjs");
const { normalizeRetiredReference, resolveClassInheritance } = require("../../shared/ontology-inheritance-resolver.cjs");
const { validateCapabilityConsumerAnchors } = require("../../shared/relation-capability-selector.cjs");
const { buildInferenceOntology } = require("../../services/inference/inference-ontology.cjs");

function node(overrides) {
  return Object.assign({ description: "节点", category: "服务", color: "blue", icon: "server", allows_relations: [] }, overrides);
}

function relation(overrides) {
  return Object.assign({ description: "关系", label_cn: "关系", versionable: false, weight_default: 0.4, weight_range: [0, 1], source_types: ["System"], target_types: ["System"] }, overrides);
}

(async function run() {
  const extended = {
    node_types: {
      Base: { subClassOf: "Root", data_properties: { title: { required: true, default: "x", validation: { min: 1 }, permission: "private" } }, lifecycle_status: "approved" },
      Root: { lifecycle_status: "draft" },
      Legacy: { lifecycle_status: "retired", retirement: { reason: "replaced", replaced_by: "Base" } },
    },
    relation_types: { R: { lifecycle_status: "reserved", retirement: { reason: "reserved", replaced_by: "R2" }, transitive: false, inverse_of: "R2" } },
    action_types: { act: { class_id: "Base", input_schema: { type: "object" }, preconditions: [], effects: [], risk_id: "risk", required_roles: ["admin"], audit_policy: {}, executor: "registered", lifecycle_status: "submitted" } },
    risk_types: { risk: { action_ids: ["act"], when: { all: [] }, level: "high", decision: "confirm", lifecycle_status: "draft" } },
    inference_rules: [{ id: "rule", kind: "class_membership", class_id: "Base", when: {}, then: {}, lifecycle_status: "approved" }],
    constraints: [{ id: "constraint", class_id: "Base", action_id: "act", lifecycle_status: "retired", retirement: { reason: "old", replaced_by: "constraint2" } }],
  };
  assert.deepEqual(validateDocumentStrict("ontology", extended), [], "Wave 0 新字段必须有合法 Schema 位置");
  assert.ok(validateDocumentStrict("ontology", { node_types: { Bad: { subClassOf: ["Root"], lifecycle_status: 1, retirement: [] } } }).length >= 3, "非法父类、生命周期与退役形态必须被 Schema 拒绝");
  assert.ok(validateDocumentStrict("ontology", { risk_types: { risk: { decision: "arbitrary" } } }).some((error) => error.includes("decision")), "风险处置只允许放行、确认、审批、阻断");

  const vault = fs.mkdtempSync(path.join("/tmp", "ontology-routes-"));
  const previousSchemaDir = process.env.THESCHEMA_DIR;
  const h = createRouteHarness();
  try {
    const schemaDir = path.join(vault, "知识库", "TheSchema"); fs.mkdirSync(schemaDir, { recursive: true });
    process.env.THESCHEMA_DIR = schemaDir; // SPEC-023 波 1 钉扎：夹具无 enums.yaml——防 repo 回落读生产 ontology
    const ontologyPath = path.join(schemaDir, "ontology.yaml");
    fs.writeFileSync(ontologyPath, YAML.stringify({
      node_types: { System: { description: "系统" } }, relation_types: { DEPENDS_ON: { label_cn: "依赖" } },
      inference_rules: [{ name: "transitive" }], constraints: [{ id: "typed" }],
    }));
    mergeW1aActionTypes(ontologyPath); // WP-048 W1-A：动作化端点须有动作定义（单源＝仓内 ontology.yaml）
    setupActionRuntime({ vaultPath: vault });
    let writeOntologyCalls = 0;
    routes.register(h.registerRoute, {
      vaultPath: vault,
      schemaWriteService: {
        writeOntology: (input) => { writeOntologyCalls += 1; return { category: "ontology", revision: "sha256:" + "a".repeat(64), affectedFile: "知识库/TheSchema/ontology.yaml" }; },
      },
    });
    const read = await h.call("GET /api/schema/ontology");
    assert.equal(read.statusCode, 200); assert.ok(read.body.data.node_types.System);
    assert.equal(read.body.data.inference_rules[0].name, "transitive"); assert.equal(read.body.data.constraints[0].id, "typed");

    // E3'：PUT 直接写回（乐观锁 + 原子写回 + 备份），不再是 retired
    const written = await h.call("PUT /api/schema/ontology", undefined, { revision: "sha256:x", patch: { node_types: {} } });
    assert.equal(written.statusCode, 200);
    assert.equal(writeOntologyCalls, 1);
    assert.equal(written.body.data.category, "ontology");

    // G3（PR-020 批3）：ontology 结构校验器接线——非法 patch（relation 引用未知 node type）必须 400 fail-closed，不触达写服务
    const g3CallsBefore = writeOntologyCalls;
    const g3Invalid = await h.call("PUT /api/schema/ontology", undefined, { revision: "sha256:x", patch: { relation_types: { BAD_REL: { source_types: ["NoSuchNode"], target_types: ["System"], label_cn: "坏关系" } } } });
    assert.equal(g3Invalid.statusCode, 400, "G3: relation referencing unknown node type must fail with 400");
    assert.equal(g3Invalid.body.error_code, "VALIDATION_ERROR");
    assert.ok(String(g3Invalid.body.message).includes("unknown node type"), "G3: error message must pinpoint the unknown node type");
    assert.equal(writeOntologyCalls, g3CallsBefore, "G3: rejected patch must not reach writeOntology service");
    // WP-006 6b 写时准入：未知能力字段（无在册消费锚点）→ 422 拒写，不触达写服务
    const wpgBefore = writeOntologyCalls;
    const unknownField = await h.call("PUT /api/schema/ontology", undefined, { revision: "sha256:x", patch: { relation_types: { RELATED: { description: "关联", label_cn: "关联", versionable: false, weight_default: 0.4, weight_range: [0, 1], source_types: ["System"], target_types: ["System"], brand_new_capability: true } } } });
    assert.equal(unknownField.statusCode, 422, "WP-006: 未登记消费锚点的能力字段必须 422 拒写");
    assert.equal(unknownField.body.error_code, "CAPABILITY_CONSUMER_ANCHOR_INVALID");
    assert.ok(String(unknownField.body.details.fix).includes("CAPABILITY_FIELD_CONSUMERS"), "报错必须带修法指引（锚点登记位置）");
    assert.equal(writeOntologyCalls, wpgBefore, "被拒 patch 不得触达 writeOntology");
    // 破坏实验面（锚点失效拒写）在 check-ontology-consumer-anchors 门禁测试覆盖（readModule 注入形态）
    // 合法 patch（完整关系定义：必填字段齐全 + source/target 全部已注册）仍放行
    const g3Valid = await h.call("PUT /api/schema/ontology", undefined, { revision: "sha256:x", patch: { relation_types: { RELATED: { description: "关联", label_cn: "关联", versionable: false, weight_default: 0.4, weight_range: [0, 1], source_types: ["System"], target_types: ["System"] } } } });
    assert.equal(g3Valid.statusCode, 200, "G3: valid relation patch must still pass");
    assert.equal(writeOntologyCalls, g3CallsBefore + 1, "G3: valid patch must reach writeOntology service");

    async function expectRejected(patch, messagePart) {
      const before = writeOntologyCalls;
      const response = await h.call("PUT /api/schema/ontology", undefined, { revision: "sha256:x", patch });
      assert.equal(response.statusCode, 400, messagePart);
      assert.ok(String(response.body.message).includes(messagePart), response.body.message);
      assert.equal(writeOntologyCalls, before, "被拒 patch 不得触达写服务");
    }

    await expectRejected({ node_types: { System: node({ lifecycle_status: "archived" }) } }, "lifecycle_status");
    await expectRejected({ node_types: { System: node(), Old: node({ lifecycle_status: "retired" }) } }, "retirement.reason");
    await expectRejected({ node_types: { System: node(), Old: node({ lifecycle_status: "retired", retirement: {} }) } }, "retirement.reason");
    await expectRejected({ node_types: { System: node({ lifecycle_status: "draft" }), Old: node({ lifecycle_status: "retired", retirement: { reason: "old", replaced_by: "System" } }) } }, "approved");
    await expectRejected({ node_types: { System: node(), Old: node({ lifecycle_status: "retired", retirement: { reason: "old", replaced_by: "DEPENDS_ON" } }) } }, "same element type");
    await expectRejected({ node_types: { System: node(), Old: node({ lifecycle_status: "retired", retirement: { reason: "old", replaced_by: "Missing" } }) } }, "unknown replacement");
    await expectRejected({ node_types: { System: node({ lifecycle_status: "retired", retirement: { reason: "old", replaced_by: "System" } }) } }, "self-reference");
    await expectRejected({ node_types: {
      A: node({ lifecycle_status: "retired", retirement: { reason: "a", replaced_by: "B" } }),
      B: node({ lifecycle_status: "retired", retirement: { reason: "b", replaced_by: "A" } }),
    } }, "cycle");
    await expectRejected({ node_types: { System: node({ data_properties: { title: { type: "date" } } }) } }, "fields.yaml");
    await expectRejected({ node_types: { System: node({ data_properties: { not_in_fields: { required: true } } }) } }, "fields.yaml");
    const unknownFieldPayload = { node_types: { System: node({ data_properties: { not_in_fields: { required: true } } }) } };
    assert.ok(validateOntologyPayload(unknownFieldPayload, unknownFieldPayload, undefined, { fields: [{ name: "title", type: "string" }] })
      .some((error) => error.includes("unknown field")), "给定字段字典后，未知绑定必须按字段名拒绝");
    const validFieldPayload = { node_types: { System: node({ data_properties: { title: { required: true } } }) } };
    assert.deepEqual(validateOntologyPayload(validFieldPayload, validFieldPayload, undefined, { fields: [{ name: "title", type: "string" }] }), []);
    await expectRejected({ node_types: { System: node({ allows_relations: ["MISSING"] }) }, relation_types: {} }, "unknown relation type");

    for (const status of ["draft", "submitted", "reserved", "retired"]) {
      await expectRejected({ node_types: {
        Parent: node({ lifecycle_status: status }),
        Child: node({ subClassOf: "Parent" }),
      } }, "only approved classes");
    }

    for (const status of ["draft", "submitted", "reserved"]) {
      const before = writeOntologyCalls;
      const response = await h.call("PUT /api/schema/ontology", undefined, { revision: "sha256:x", patch: {
        relation_types: { R: relation({ lifecycle_status: status, brand_new_capability: true }) },
      } });
      assert.equal(response.statusCode, 200, `${status} 关系退出活消费锚面`);
      assert.equal(writeOntologyCalls, before + 1);
    }
    const retiredBefore = writeOntologyCalls;
    const retiredRelation = await h.call("PUT /api/schema/ontology", undefined, { revision: "sha256:x", patch: {
      relation_types: {
        R_OLD: relation({ lifecycle_status: "retired", retirement: { reason: "old", replaced_by: "R_NEW" }, brand_new_capability: true }),
        R_NEW: relation(),
      },
    } });
    assert.equal(retiredRelation.statusCode, 200, "retired 关系保留历史但退出活锚面");
    assert.equal(writeOntologyCalls, retiredBefore + 1);
    const reactivated = await h.call("PUT /api/schema/ontology", undefined, { revision: "sha256:x", patch: {
      relation_types: { R: relation({ lifecycle_status: "approved", brand_new_capability: true }) },
    } });
    assert.equal(reactivated.statusCode, 422, "关系恢复 approved 后重新执行消费锚准入");

    const previous = { node_types: {
      A: node({ lifecycle_status: "retired", retirement: { reason: "a", replaced_by: "B" } }),
      B: node(),
      C: node(),
    } };
    const next = { node_types: {
      A: node({ lifecycle_status: "retired", retirement: { reason: "a", replaced_by: "B" } }),
      B: node({ lifecycle_status: "retired", retirement: { reason: "b", replaced_by: "C" } }),
      C: node(),
    } };
    assert.deepEqual(validateOntologyPayload(next, next, previous), [], "A→B→C：只新退役 B，历史上游 A 保持原指针且全链落到现役 C");
    assert.ok(validateOntologyPayload(next, Object.assign({}, next)).some((error) => error.includes("approved at write time")), "没有写前状态时不得把新退役直指退役目标当作历史链放行");
    for (const replacement of [" C", "C ", " C "]) {
      const malformed = { node_types: { ...next.node_types, B: node({ lifecycle_status: "retired", retirement: { reason: "b", replaced_by: replacement } }) } };
      const errors = validateOntologyPayload(malformed, malformed, malformed);
      assert.ok(errors.some((error) => error.includes("unknown replacement")), "既有退役链同样精确检查目标 ID");
      assert.ok(errors.some((error) => error.includes("replacement chain is dangling")), "上游沿历史链遇到带空白目标必须报悬空");
    }
    const literalId = { node_types: {
      A: node({ lifecycle_status: "retired", retirement: { reason: "a", replaced_by: " B " } }),
      " B ": node(), Child: node({ subClassOf: " B " }),
    } };
    assert.deepEqual(validateOntologyPayload(literalId, literalId, {}), [], "目标本身含空白时只认精确 ID，不另造 trim 后身份");
    assert.equal(normalizeRetiredReference(literalId.node_types, "A").resolved_id, " B ");
    assert.deepEqual(resolveClassInheritance(literalId, "Child").inheritance_chain, [" B ", "Child"]);
    for (const id of ["constructor", "toString", "hasOwnProperty"]) {
      const registered = {
        node_types: { System: node(), [id]: node({ allows_relations: [id] }), Child: node({ subClassOf: id }) },
        relation_types: { [id]: relation() },
      };
      delete registered.node_types.Child.allows_relations;
      assert.deepEqual(validateOntologyPayload(registered, registered, {}), [], "与对象原型同名的自身注册键仍合法");
      const resolved = resolveClassInheritance(registered, "Child");
      assert.deepEqual(resolved.inheritance_chain, [id, "Child"]);
      assert.deepEqual(resolved.allows_relations.relation_ids, [id]);
    }
    for (const field of ["constructor", "toString", "hasOwnProperty"]) {
      const anchorResult = validateCapabilityConsumerAnchors({ relation_types: { R: { [field]: {} } } });
      assert.equal(anchorResult.ok, false, "原型同名能力字段必须按未登记拒写而不是抛错: " + field);
      assert.ok(anchorResult.errors.some((error) => error.includes("字段「" + field + "」无在册消费点")));
    }
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const unregisteredParent = { node_types: { System: node(), Child: node({ subClassOf: id }) } };
      assert.ok(validateOntologyPayload(unregisteredParent, unregisteredParent, {}).some((error) => error.includes("unknown parent class")), "仅存在于对象原型链上的名字不得当作已注册父类: " + id);
      const unregisteredRelation = { node_types: { System: node({ allows_relations: [id] }) }, relation_types: {} };
      assert.ok(validateOntologyPayload(unregisteredRelation, unregisteredRelation, {}).some((error) => error.includes("unknown relation type")), "仅存在于对象原型链上的名字不得当作已注册关系: " + id);
    }
  } finally {
    await h.close();
    fs.rmSync(vault, { recursive: true, force: true });
    if (previousSchemaDir === undefined) delete process.env.THESCHEMA_DIR;
    else process.env.THESCHEMA_DIR = previousSchemaDir;
  }
  for (let run = 0; run < 2; run++) await realWriteRoundTrip();
  console.log("ontology-routes tests passed (real HTTP/write/read round-trip twice)");
})().catch((error) => { console.error(error); process.exit(1); });

async function realWriteRoundTrip() {
  const vault = fs.mkdtempSync(path.join("/tmp", "ontology-http-"));
  const previousSchemaDir = process.env.THESCHEMA_DIR;
  const previousDataDir = process.env.KB_DATA_DIR;
  const schemaDir = path.join(vault, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  process.env.THESCHEMA_DIR = schemaDir;
  process.env.KB_DATA_DIR = path.join(vault, "data");
  const ontologyPath = path.join(schemaDir, "ontology.yaml");
  const fieldsPath = path.join(schemaDir, "fields.yaml");
  fs.writeFileSync(ontologyPath, YAML.stringify({ node_types: { A: node(), B: node(), C: node() }, relation_types: {} }));
  mergeW1aActionTypes(ontologyPath); // WP-048 W1-A：PUT 已动作化——真实 HTTP 轮须有动作定义与工厂运行时
  setupActionRuntime({ vaultPath: vault });
  fs.writeFileSync(fieldsPath, YAML.stringify({ schema_version: 1, fields: [
    { name: "title", label: "标题", type: "string", required: "是", scope: ["entity"], layer: "内容属性" },
  ] }));
  const instancePath = path.join(vault, "historical-instance.md");
  fs.writeFileSync(instancePath, "---\nclass_id: A\ntitle: 原始实例\n---\n");
  const instanceBefore = fs.readFileSync(instancePath);
  const fieldsBefore = fs.readFileSync(fieldsPath);
  let h;
  async function start() {
    h = createRouteHarness();
    routes.register(h.registerRoute, { vaultPath: vault, schemaWriteService: createSchemaWriteService({ vaultPath: vault }) });
    return h.app.listen({ port: 0, host: "127.0.0.1" });
  }
  try {
    let address = await start();
    async function request(method, body) {
      const response = await fetch(address + "/api/schema/ontology", {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }
    async function expectRejectedWrite(patch, status, messagePart, errorCode = "VALIDATION_ERROR") {
      const before = await request("GET");
      assert.equal(before.status, 200);
      const bytes = fs.readFileSync(ontologyPath);
      const fieldBytes = fs.readFileSync(fieldsPath);
      const rejected = await request("PUT", { revision: before.body.data.revision, patch });
      assert.equal(rejected.status, status, JSON.stringify(rejected.body));
      assert.equal(rejected.body.error_code, errorCode);
      assert.ok(rejected.body.message.includes(messagePart), rejected.body.message);
      assert.deepEqual(fs.readFileSync(ontologyPath), bytes, "拒写不改变本体字节");
      assert.deepEqual(fs.readFileSync(fieldsPath), fieldBytes, "拒写不改变字段字典字节");
      const after = await request("GET");
      assert.equal(after.status, 200);
      assert.deepEqual(after.body.data, before.body.data, "拒写不改变读回数据及 revision");
    }
    const initial = await request("GET");
    assert.equal(initial.status, 200);
    await expectRejectedWrite({ node_types: { A: node({ data_properties: { title: { required: "yes" } } }) } }, 400, "/data_properties/title/required");
    await expectRejectedWrite({
      node_types: { A: node({ data_properties: { title: { required: true } } }) },
      relation_types: { R: relation({
        source_types: ["A"], target_types: ["A"], assertion_policies: [{ brand_new_capability: true }],
      }) },
    }, 422, "brand_new_capability", "CAPABILITY_CONSUMER_ANCHOR_INVALID");
    for (const section of ["inference_rules", "constraints"]) {
      const entries = [
        { id: "A", lifecycle_status: "retired", retirement: { reason: "a", replaced_by: "B" } },
        { id: "B", lifecycle_status: "retired", retirement: { reason: "b", replaced_by: "C" } },
        { id: "B", lifecycle_status: "approved" },
        { id: "C", lifecycle_status: "approved" },
      ];
      for (const duplicates of [entries, [...entries].reverse(), [{ id: "B" }, { id: "B" }]]) {
        await expectRejectedWrite({ [section]: duplicates }, 400, "duplicate id 'B'");
        const merged = { ...initial.body.data, [section]: duplicates };
        assert.ok(validateOntologyPayload({}, merged, initial.body.data).some((error) => error.includes("duplicate id 'B'")), "纯单元：未在 patch 中的数组段同样校验重复 ID");
      }
      const valid = { [section]: [entries[0], entries[2], entries[3]] };
      assert.deepEqual(validateOntologyPayload(valid, valid, {}), [], "纯单元：段内 ID 唯一且替代目标现役仍放行");
      await expectRejectedWrite({ [section]: [entries[0], entries[1], entries[3]] }, 400, "approved at write time");
    }
    const rules = [
      { name: "transitive_dependency", pattern: "A -[DEPENDS_ON]-> B -[DEPENDS_ON]-> C", output: "A -[DEPENDS_ON]-> C (inferred)" },
      { name: "document_covers_related", pattern: "D -[DOCUMENTS]-> A -[REFERENCES]-> B", output: "D -[REFERENCES]-> B (inferred)" },
      { id: "A", kind: "class_membership", when: {}, then: {} },
    ];
    const firstNodes = {
      A: node({ lifecycle_status: "retired", retirement: { reason: "a", replaced_by: "B" } }),
      B: node(), C: node({ data_properties: { title: { required: true } } }),
    };
    const first = await request("PUT", { revision: initial.body.data.revision, patch: {
      node_types: firstNodes, inference_rules: rules, constraints: [{ id: "A" }],
    } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const nextNodes = {
      ...firstNodes,
      B: node({ lifecycle_status: "retired", retirement: { reason: "b", replaced_by: "C" } }),
    };
    const second = await request("PUT", { revision: first.body.data.revision, patch: { node_types: nextNodes } });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    const writtenBytes = fs.readFileSync(ontologyPath);
    const read = await request("GET");
    assert.deepEqual(read.body.data.node_types, nextNodes);
    assert.equal(read.body.data.revision, second.body.data.revision);
    assert.deepEqual(YAML.parse(writtenBytes.toString()).node_types, nextNodes);
    assert.deepEqual(read.body.data.inference_rules, rules, "无 id 历史规则与新 kind 写读保真");
    assert.deepEqual(read.body.data.constraints, [{ id: "A" }], "类、规则、约束可各自使用同名 ID");
    assert.deepEqual(buildInferenceOntology(YAML.parse(writtenBytes.toString())).rules.map((rule) => rule.id), rules.slice(0, 2).map((rule) => rule.name), "写入的新 kind 不进入旧解释器");
    assert.deepEqual(normalizeRetiredReference(read.body.data.node_types, "A"), {
      original_id: "A", resolved_id: "C", replacement_chain: ["A", "B", "C"],
    });
    for (const badNodes of [
      { ...nextNodes, C: node({ data_properties: { absent: { required: true } } }) },
      { ...nextNodes, D: node({ lifecycle_status: "retired", retirement: { reason: "d", replaced_by: "A" } }) },
      { ...nextNodes, C: node({ lifecycle_status: "draft" }) },
      ...[" C", "C ", " C "].flatMap((id) => [
        { ...nextNodes, D: node({ lifecycle_status: "retired", retirement: { reason: "d", replaced_by: id } }) },
        { ...nextNodes, B: node({ lifecycle_status: "retired", retirement: { reason: "b", replaced_by: id } }) },
        { ...nextNodes, Child: node({ subClassOf: id }) },
      ]),
    ]) {
      const rejected = await request("PUT", { revision: second.body.data.revision, patch: { node_types: badNodes } });
      assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
      assert.deepEqual(fs.readFileSync(ontologyPath), writtenBytes, "拒写不改变文件");
    }
    const stale = await request("PUT", { revision: initial.body.data.revision, patch: { node_types: nextNodes } });
    assert.equal(stale.status, 409);
    assert.deepEqual(fs.readFileSync(ontologyPath), writtenBytes);
    const repeated = await request("PUT", { revision: second.body.data.revision, patch: { node_types: nextNodes } });
    assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
    assert.equal(repeated.body.data.revision, second.body.data.revision);
    assert.deepEqual(fs.readFileSync(ontologyPath), writtenBytes);
    await h.close();
    address = await start();
    const restarted = await request("GET");
    assert.equal(restarted.status, 200);
    assert.deepEqual(restarted.body.data.node_types, nextNodes);
    assert.equal(restarted.body.data.node_types.A.retirement.replaced_by, "B");
    const child = node({ subClassOf: "Parent" });
    delete child.allows_relations;
    const inheritedNodes = { ...nextNodes, Parent: node({ allows_relations: ["R"] }), Child: child };
    const inherited = await request("PUT", { revision: restarted.body.data.revision, patch: {
      node_types: inheritedNodes, relation_types: { R: relation({ source_types: ["C"], target_types: ["C"] }) },
    } });
    assert.equal(inherited.status, 200, JSON.stringify(inherited.body));
    const inheritedRead = await request("GET");
    const inheritedDoc = YAML.parse(fs.readFileSync(ontologyPath, "utf8"));
    assert.deepEqual(inheritedRead.body.data.node_types, inheritedDoc.node_types);
    assert.equal(Object.hasOwn(inheritedDoc.node_types.Child, "allows_relations"), false, "继承不回填子类声明");
    assert.deepEqual(resolveClassInheritance(inheritedDoc, "Child", YAML.parse(fieldsBefore.toString())).allows_relations, {
      relation_ids: ["R"], source_class: "Parent",
      override_chain: [{ class_id: "Parent", relation_ids: ["R"] }],
    });
    // WP-068 C5：在册关系 R 处于 approved，跳到 submitted 只被迁移表拒（既有校验放行——非 approved 关系只是退出锚面）。
    // 本例是「撤掉守卫接线即转红」的接线钉，同时断言拒写不改本体字节与 revision。
    await expectRejectedWrite({ relation_types: { R: relation({ lifecycle_status: "submitted", source_types: ["C"], target_types: ["C"] }) } }, 400, "lifecycle_transition_denied");
    const inheritedBytes = fs.readFileSync(ontologyPath);
    for (const value of [null, "R", {}]) {
      const invalidChild = { ...child, allows_relations: value };
      const rejected = await request("PUT", { revision: inherited.body.data.revision, patch: { node_types: { ...inheritedNodes, Child: invalidChild } } });
      assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
      assert.deepEqual(fs.readFileSync(ontologyPath), inheritedBytes);
    }
    const cleared = await request("PUT", { revision: inherited.body.data.revision, patch: {
      node_types: { ...inheritedNodes, Child: { ...child, allows_relations: [] } },
    } });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    const clearedDoc = YAML.parse(fs.readFileSync(ontologyPath, "utf8"));
    assert.deepEqual(resolveClassInheritance(clearedDoc, "Child", YAML.parse(fieldsBefore.toString())).allows_relations, {
      relation_ids: [], source_class: "Child",
      override_chain: [{ class_id: "Parent", relation_ids: ["R"] }, { class_id: "Child", relation_ids: [] }],
    });
    const rootWithoutRelations = node();
    delete rootWithoutRelations.allows_relations;
    const invalidRoot = await request("PUT", { revision: cleared.body.data.revision, patch: {
      node_types: { ...clearedDoc.node_types, Root: rootWithoutRelations },
    } });
    assert.equal(invalidRoot.status, 400, "根类既有必填检查不因子类继承而放宽");
    assert.deepEqual(YAML.parse(fs.readFileSync(ontologyPath, "utf8")), clearedDoc);
    // 与对象原型同名的注册键：写校验只认注册表自身键，精确同名仍可正常写读
    const protoChild = node({ subClassOf: "constructor" });
    delete protoChild.allows_relations;
    const protoNodes = {
      ...clearedDoc.node_types,
      constructor: node({ allows_relations: ["constructor"] }),
      ProtoChild: protoChild,
    };
    const protoWrite = await request("PUT", { revision: cleared.body.data.revision, patch: {
      node_types: protoNodes, relation_types: { ...clearedDoc.relation_types, constructor: relation({ source_types: ["C"], target_types: ["C"] }) },
    } });
    assert.equal(protoWrite.status, 200, JSON.stringify(protoWrite.body));
    const protoDoc = YAML.parse(fs.readFileSync(ontologyPath, "utf8"));
    assert.equal(Object.hasOwn(protoDoc.node_types, "constructor"), true);
    assert.equal(Object.hasOwn(protoDoc.node_types.ProtoChild, "allows_relations"), false);
    const protoResolved = resolveClassInheritance(protoDoc, "ProtoChild", YAML.parse(fieldsBefore.toString()));
    assert.deepEqual(protoResolved.inheritance_chain, ["constructor", "ProtoChild"]);
    assert.deepEqual(protoResolved.allows_relations.relation_ids, ["constructor"]);
    const protoRetired = await request("PUT", { revision: protoWrite.body.data.revision, patch: { node_types: {
      ...protoNodes,
      ProtoChild: node({ lifecycle_status: "retired", retirement: { reason: "改用构造器同名类", replaced_by: "constructor" } }),
    } } });
    assert.equal(protoRetired.status, 200, JSON.stringify(protoRetired.body));
    const protoRetiredDoc = YAML.parse(fs.readFileSync(ontologyPath, "utf8"));
    assert.equal(normalizeRetiredReference(protoRetiredDoc.node_types, "ProtoChild").resolved_id, "constructor");
    const protoBytes = fs.readFileSync(ontologyPath);
    for (const [label, patch] of [
      ["未注册父类", { node_types: { ...protoRetiredDoc.node_types, Other: node({ subClassOf: "toString" }) } }],
      ["未注册关系", { node_types: { ...protoRetiredDoc.node_types, Other: node({ allows_relations: ["toString"] }) } }],
      ["未注册替代目标", { node_types: { ...protoRetiredDoc.node_types, Other: node({ lifecycle_status: "retired", retirement: { reason: "r", replaced_by: "hasOwnProperty" } }) } }],
    ]) {
      const rejected = await request("PUT", { revision: protoRetired.body.data.revision, patch });
      assert.equal(rejected.status, 400, label + "必须拒写");
      assert.deepEqual(fs.readFileSync(ontologyPath), protoBytes, label + "拒写不改变文件");
    }
    const protoField = await request("PUT", { revision: protoRetired.body.data.revision, patch: { relation_types: {
      ...protoRetiredDoc.relation_types,
      RProto: { ...relation({ source_types: ["C"], target_types: ["C"] }), constructor: {} },
    } } });
    assert.equal(protoField.status, 422, "原型同名能力字段按未登记 422 拒写，不得 500: " + JSON.stringify(protoField.body));
    assert.equal(protoField.body.error_code, "CAPABILITY_CONSUMER_ANCHOR_INVALID");
    assert.deepEqual(fs.readFileSync(ontologyPath), protoBytes, "能力锚拒写不改变文件");
    assert.deepEqual(fs.readFileSync(fieldsPath), fieldsBefore);
    assert.deepEqual(validateOntologyPayload({ constraints: [] }, { ...protoRetiredDoc, constraints: [] }, protoRetiredDoc), [], "纯单元：未改类绑定时无需字段字典快照");
    const brokenFields = "fields: [\n";
    fs.writeFileSync(fieldsPath, brokenFields);
    const constraintsOnly = await request("PUT", { revision: protoRetired.body.data.revision, patch: { constraints: [] } });
    assert.equal(constraintsOnly.status, 200, "字段字典损坏不得阻断无绑定的修改: " + JSON.stringify(constraintsOnly.body));
    const constraintsRead = await request("GET");
    assert.equal(constraintsRead.body.data.revision, constraintsOnly.body.data.revision);
    assert.deepEqual(constraintsRead.body.data.node_types, protoRetiredDoc.node_types);
    assert.deepEqual(constraintsRead.body.data.constraints, []);
    const constraintBytes = fs.readFileSync(ontologyPath);
    const constraintsRepeated = await request("PUT", { revision: constraintsOnly.body.data.revision, patch: { constraints: [] } });
    assert.equal(constraintsRepeated.status, 200);
    assert.equal(constraintsRepeated.body.data.revision, constraintsOnly.body.data.revision);
    assert.deepEqual(fs.readFileSync(ontologyPath), constraintBytes);
    for (const data_properties of [null, [], "bad", { title: null }, { title: [] }, { title: "bad" }, { title: { required: "yes" } }]) {
      await expectRejectedWrite({ node_types: { ...protoRetiredDoc.node_types, C: node({ data_properties }) } }, 400, "/data_properties");
    }
    await expectRejectedWrite({ node_types: protoRetiredDoc.node_types }, 500, "fields: [", "BAD_INDENT");
    for (const data_properties of [undefined, {}]) {
      const noBindings = Object.fromEntries(Object.entries(protoRetiredDoc.node_types).map(([id, definition]) => {
        const { data_properties: removed, ...rest } = definition;
        return [id, { ...rest, ...(data_properties === undefined ? {} : { data_properties }) }];
      }));
      const before = await request("GET");
      const written = await request("PUT", { revision: before.body.data.revision, patch: { node_types: noBindings } });
      assert.equal(written.status, 200, JSON.stringify(written.body));
      const after = await request("GET");
      assert.equal(after.body.data.revision, written.body.data.revision);
      assert.deepEqual(after.body.data.node_types, noBindings, "没有字段待验的类修改不读字段字典");
      assert.deepEqual(YAML.parse(fs.readFileSync(ontologyPath, "utf8")).node_types, noBindings);
    }
    assert.equal(fs.readFileSync(fieldsPath, "utf8"), brokenFields, "故障测试不修补字段字典");
    fs.writeFileSync(fieldsPath, fieldsBefore);
    const recoveredRead = await request("GET");
    const recoveredNodes = { ...protoRetiredDoc.node_types, C: node({ data_properties: { title: { required: false } } }) };
    const recovered = await request("PUT", { revision: recoveredRead.body.data.revision, patch: { node_types: recoveredNodes } });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    const recoveredDoc = await request("GET");
    assert.deepEqual(recoveredDoc.body.data.node_types, recoveredNodes, "字典恢复后真正绑定重新放行，required=false 保真");
    assert.deepEqual(YAML.parse(fs.readFileSync(ontologyPath, "utf8")).node_types, recoveredNodes);
    assert.deepEqual(fs.readFileSync(fieldsPath), fieldsBefore);
    assert.deepEqual(fs.readFileSync(instancePath), instanceBefore, "历史实例零回填");
  } finally {
    if (h) await h.close();
    if (previousSchemaDir === undefined) delete process.env.THESCHEMA_DIR;
    else process.env.THESCHEMA_DIR = previousSchemaDir;
    if (previousDataDir === undefined) delete process.env.KB_DATA_DIR;
    else process.env.KB_DATA_DIR = previousDataDir;
    fs.rmSync(vault, { recursive: true, force: true });
  }
}
