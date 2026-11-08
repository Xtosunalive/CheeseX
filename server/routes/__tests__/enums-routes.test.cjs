const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");
const routes = require("../enums-routes.cjs");
const { createRouteHarness, mergeW1aActionTypes, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");

(async function run() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "enums-routes-"));
  const h = createRouteHarness();
  try {
    const schemaDir = path.join(vault, "知识库", "TheSchema");
    const entityDir = path.join(vault, "知识库", "wiki", "entities");
    fs.mkdirSync(schemaDir, { recursive: true }); fs.mkdirSync(entityDir, { recursive: true });
    const enumsPath = path.join(schemaDir, "enums.yaml");
    fs.writeFileSync(enumsPath, YAML.stringify({
      domains: { ops: "运维操作" }, subdomains: { ops: ["deploy"] },
      layers: [{ id: "service", label: "服务", color: "gray", layout: "central" }],
      arch_categories: ["服务"], article_types: ["排错指南"],
      modules: { 部署服务: { subdomain: "deploy", system: "deploy", since: "7.0.0", until: "", products: ["AnyShare"] } },
    }));
    // ADR-008 波4 后：arch_subdomain: deploy 会使 deploy 成在用词，rename 流程 PUT 会被删词门禁拦
    // （语义正确——在用子域删除会把实体打成野生值）。本测试族测保存链不测画像，故脱钩。
    fs.writeFileSync(path.join(entityDir, "deploy.md"), "---\narchitecture-node-id: deploy\narch_component: true\n---\n");
    mergeW1aActionTypes(path.join(schemaDir, "ontology.yaml")); // WP-048 W1-A：PUT/rollback 已动作化
    setupActionRuntime({ vaultPath: vault });
    let writeEnumsCalls = 0; let snapshotRevertCalls = 0; let lastWritePatch = null;
    routes.register(h.registerRoute, {
      vaultPath: vault,
      schemaWriteService: {
        writeEnums: (input) => { writeEnumsCalls += 1; lastWritePatch = input.patch; return { category: "enums", revision: "sha256:" + "c".repeat(64), affectedFile: "知识库/TheSchema/enums.yaml" }; },
        snapshotRevert: (input) => { snapshotRevertCalls += 1; return { category: "snapshot-revert", revision: "sha256:" + "d".repeat(64) }; },
      },
    });

    const all = await h.call("GET /api/schema/enums", "/api/schema/enums");
    assert.equal(all.statusCode, 200); assert.equal(all.body.data.domains.ops, "运维操作");
    assert.match(all.body.data.revision, /^sha256:[a-f0-9]{64}$/);
    const section = await h.call("GET /api/schema/enums", "/api/schema/enums?section=layers");
    assert.deepEqual(Object.keys(section.body.data), ["layers"]);
    const invalid = await h.call("GET /api/schema/enums", "/api/schema/enums?section=unknown");
    assert.equal(invalid.statusCode, 400);
    const history = await h.call("GET /api/schema/enums/history", "/api/schema/enums/history");
    assert.deepEqual(history.body.data.items, []);

    const candidate = {
      revision: all.body.data.revision,
      subdomains: { ops: ["release"] },
      modules: { 部署服务: { subdomain: "release", system: "deploy", since: "7.0.0", until: "", products: ["AnyShare"] } },
    };
    const preview = await h.call("POST /api/schema/enums/preview", "/api/schema/enums/preview", candidate);
    assert.equal(preview.statusCode, 200); assert.match(preview.body.data.previewId, /^[0-9a-f-]{36}$/);

    const before = fs.readFileSync(enumsPath);
    // G4 后 PUT 与 preview 同语义：改 subdomains 必须带配套 modules（否则 validateRemovedSubdomainReferences 拦截，同 preview）
    const written = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { subdomains: { ops: ["release"] }, modules: { 部署服务: { subdomain: "release", system: "deploy", since: "7.0.0", until: "", products: ["AnyShare"] } } } });
    const rolled = await h.call("POST /api/schema/enums/rollback", "/api/schema/enums/rollback", { revision: all.body.data.revision, snapshotId: "snapshot-x" });
    assert.equal(written.statusCode, 200); assert.equal(rolled.statusCode, 200);
    assert.equal(writeEnumsCalls, 1); assert.equal(snapshotRevertCalls, 1);
    assert.deepEqual(fs.readFileSync(enumsPath), before);

    // ADR-008 D1 回归：词条对象形态（编辑器 label 保存路径）必须过写闸门——裸 string 校验口径已退役
    const entryPut = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { subdomains: { ops: [{ id: "deploy", label: "部署" }] }, modules: { 部署服务: { subdomain: "deploy", system: "deploy-svc", since: "7.0.0", until: "", products: ["AnyShare"] } } } });
    assert.equal(entryPut.statusCode, 200, "词条对象 patch 不得被写闸门 400：" + JSON.stringify(entryPut.body));
    // 畸形 label（非字符串）仍须拦
    const badEntryPut = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { subdomains: { ops: [{ id: "deploy", label: 42 }] } } });
    assert.equal(badEntryPut.statusCode, 400);

    // ADR-008 波4/SPEC-017 W3：删词门禁——在用词（实体引用中）删除必须 400；死词（零使用）删除放行
    // 夹具：probe.md 实体 arch_subdomain: probe-sub → probe-sub 在用；unused-sub 无引用为死词
    fs.writeFileSync(path.join(entityDir, "probe.md"), "---\narchitecture-node-id: probe\narch_component: true\narch_subdomain: probe-sub\n---\n");
    fs.writeFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), YAML.stringify({
      domains: { ops: "运维操作" }, subdomains: { ops: [{ id: "probe-sub", label: "探针" }, { id: "unused-sub", label: "闲置" }] },
      layers: [{ id: "service", label: "服务", color: "gray", layout: "central" }],
      arch_categories: ["服务"], article_types: ["排错指南"],
      modules: {},
    }));
    const revisionInUse = (await h.call("GET /api/schema/enums", "/api/schema/enums")).body.data.revision;
    const inUsePut = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: revisionInUse, patch: { subdomains: { ops: [{ id: "unused-sub", label: "闲置" }] } } });
    assert.equal(inUsePut.statusCode, 400, "在用词 probe-sub 被删必须拦");
    assert.match(JSON.stringify(inUsePut.body), /is still in use/);
    const revisionDead = (await h.call("GET /api/schema/enums", "/api/schema/enums")).body.data.revision;
    const deadPut = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: revisionDead, patch: { subdomains: { ops: [{ id: "probe-sub", label: "探针" }] } } });
    assert.equal(deadPut.statusCode, 200, "死词 unused-sub 删除放行: " + JSON.stringify(deadPut.body));
    fs.rmSync(path.join(entityDir, "probe.md"));

    // G4（PR-020 批1）：PUT 写路径结构校验闸门——非法 patch（subdomain 引用未知 domain）必须 400 fail-closed，不得触达写服务
    const g4CallsBefore = writeEnumsCalls;
    const g4Invalid = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { subdomains: { "no-such-domain": ["deploy"] } } });
    assert.equal(g4Invalid.statusCode, 400, "G4 gate: invalid subdomain->domain reference must fail with 400");
    assert.equal(g4Invalid.body.error_code, "VALIDATION_ERROR");
    assert.equal(writeEnumsCalls, g4CallsBefore, "G4 gate: rejected patch must not reach writeEnums service");
    // 未知 section 键同样拦截
    const g4Unknown = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { not_a_section: ["x"] } });
    assert.equal(g4Unknown.statusCode, 400, "G4 gate: unknown section key must fail with 400");
    assert.equal(writeEnumsCalls, g4CallsBefore, "G4 gate: unknown section must not reach writeEnums service");
    // 合法 patch 仍放行（闸门不误伤；同节内不含模块引用冲突的改动）
    const g4Valid = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { subdomains: { ops: ["deploy", "release"] } } });
    assert.equal(g4Valid.statusCode, 200, "G4 gate: valid patch must still pass");
    assert.equal(writeEnumsCalls, g4CallsBefore + 1, "G4 gate: valid patch must reach writeEnums service");

    // 回归（tr_70af34a6）：GET 响应携带只读投影键（lifecycle_status/sourceFile），整包回写必须被闸门 400 拒绝——
    // 前端职责是发节键差量，闸门保持 fail-closed 不放水只读键
    assert.ok(all.body.data.lifecycle_status !== undefined || all.body.data.sourceFile !== undefined, "fixture GET 响应应含只读投影键以复现整包回写场景");
    const readOnlyRoundtrip = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { lifecycle_status: ["灰度"], sourceFile: "知识库/TheSchema/enums.yaml" } });
    assert.equal(readOnlyRoundtrip.statusCode, 400, "整包回写（含只读投影键）必须被闸门拒绝");
    assert.match(readOnlyRoundtrip.body.message, /^Unknown section: lifecycle_status/);
    assert.equal(writeEnumsCalls, g4CallsBefore + 1, "被拒 patch 不得触达写服务");

    // B1 执法修正（WP-064，Master「B」）：categories 是声明宿主（矩阵勾选框选项源）——放行走写闸；
    // 冻结对象＝arch_categories 派生视图（yaml 键）——直改仍 403。两段分离执法。
    const b1CallsBefore = writeEnumsCalls;
    const archRejected = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { arch_categories: ["服务", "终端"] } });
    assert.equal(archRejected.statusCode, 403, "arch_categories 派生视图直改必须 403: " + JSON.stringify(archRejected.body));
    assert.equal(archRejected.body.error_code, "DERIVED_SEGMENT_READ_ONLY");
    assert.match(archRejected.body.message, /B1=b|ADR-006/);
    assert.equal(writeEnumsCalls, b1CallsBefore, "arch_categories 拒绝的 patch 不得触达写服务");
    // 混合 patch（合法节＋arch_categories）同样整体拒绝（段级守卫先于结构闸门）
    const b1Mixed = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { arch_categories: ["服务"], subdomains: { ops: ["deploy", "release"] } } });
    assert.equal(b1Mixed.statusCode, 403, "混合 patch 含 arch_categories 同样拒绝");
    assert.equal(writeEnumsCalls, b1Mixed && b1CallsBefore, "混合 patch 不得触达写服务");
    // WP-064：categories 声明宿主放行——走写闸（严格校验＋快照），勾选框选项源恢复可配置
    const catWrite = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { categories: ["服务", "终端"] } });
    assert.equal(catWrite.statusCode, 200, "categories 声明宿主写入放行: " + JSON.stringify(catWrite.body));
    assert.equal(writeEnumsCalls, b1CallsBefore + 1, "categories 写入触达写服务");
    // 不含 categories 的合法 patch 仍放行（守卫不误伤其他节）
    const b1Clean = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { subdomains: { ops: ["deploy", "release"] } } });
    assert.equal(b1Clean.statusCode, 200, "无 categories 的合法 patch 不受 B1 守卫影响: " + JSON.stringify(b1Clean.body));
    assert.equal(writeEnumsCalls, b1CallsBefore + 2, "合法 patch 仍触达写服务（+arch 拒绝不触达＋categories 放行触达）");

    // 原型同名键接受面：跨表引用只认注册表自身键——Object.prototype 同名属性（constructor/toString/
    // hasOwnProperty）不得蒙混成「已存在的域/模块」，否则非法引用被静默放行（假绿）。
    const protoCallsBefore = writeEnumsCalls;
    const protoBefore = fs.readFileSync(enumsPath);
    const protoSubdomain = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { subdomains: { constructor: ["deploy"] } } });
    assert.equal(protoSubdomain.statusCode, 400, "subdomains: 未注册域的同名键不得因原型继承被当成已存在域");
    assert.match(String(protoSubdomain.body.message), /subdomains\.constructor: key not found in domains/);
    const protoConstraint = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { subdomain_constraints: { "probe-sub": { domain_id: "toString", allowed_categories: [] } } } });
    assert.equal(protoConstraint.statusCode, 400, "subdomain_constraints.domain_id: 不得命中原型同名属性");
    assert.match(String(protoConstraint.body.message), /subdomain_constraints\.probe-sub\.domain_id: unknown domain/);
    const protoLayer = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { layers: [{ id: "service", label: "服务", color: "gray", layout: "central", domain_id: "hasOwnProperty" }] } });
    assert.equal(protoLayer.statusCode, 400, "layers.domain_id: 不得命中原型同名属性");
    assert.match(String(protoLayer.body.message), /layers\.service\.domain_id: unknown domain/);
    const protoModule = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: all.body.data.revision, patch: { modules: { 部署服务: { subdomain: "probe-sub", system: "deploy-svc", parent_id: "toString" } } } });
    assert.equal(protoModule.statusCode, 400, "modules.parent_id: 不得命中原型同名属性");
    assert.match(String(protoModule.body.message), /modules\.部署服务\.parent_id: unknown module/);
    assert.equal(writeEnumsCalls, protoCallsBefore, "被拒 patch 不得触达写服务");
    assert.deepEqual(fs.readFileSync(enumsPath), protoBefore, "被拒 patch 不得改写 enums.yaml");

    // 反证（红队）：只认自身键不得误伤真实注册的构造同名键——自身键 constructor 必须照常放行
    fs.writeFileSync(enumsPath, YAML.stringify({
      domains: { constructor: "构造域" }, subdomains: { constructor: [{ id: "deploy", label: "部署" }] },
      layers: [{ id: "service", label: "服务", color: "gray", layout: "central" }],
      arch_categories: ["服务"], article_types: ["排错指南"],
      modules: {},
    }));
    const ownKeyRevision = (await h.call("GET /api/schema/enums", "/api/schema/enums")).body.data.revision;
    const ownKeyCallsBefore = writeEnumsCalls;
    const ownKeyPut = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: ownKeyRevision, patch: { subdomains: { constructor: [{ id: "deploy", label: "部署" }] } } });
    assert.equal(ownKeyPut.statusCode, 200, "真实注册的自身键 constructor 不得被误判: " + JSON.stringify(ownKeyPut.body));
    assert.equal(writeEnumsCalls, ownKeyCallsBefore + 1, "自身键合法 patch 仍触达写服务");

    // 去重寄存器/词表同为原型同名键接受面：合法值 constructor 既不得被误判重复，也不得因假阳性 500。
    const protoValueRevision = (await h.call("GET /api/schema/enums", "/api/schema/enums")).body.data.revision;
    const protoValueCallsBefore = writeEnumsCalls;
    const protoValueBefore = fs.readFileSync(enumsPath);
    const sysConstructor = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: protoValueRevision, patch: { modules: { 构造服务: { subdomain: "deploy", system: "constructor" } } } });
    assert.equal(sysConstructor.statusCode, 200, "system 名为 constructor 不得触发 500/误判: " + JSON.stringify(sysConstructor.body));
    assert.equal(writeEnumsCalls, protoValueCallsBefore + 1, "system=constructor 合法 patch 必须触达写服务");
    const articleTypeConstructor = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: protoValueRevision, patch: { article_types: ["constructor"] } });
    assert.equal(articleTypeConstructor.statusCode, 200, "article_types 含 constructor 不得被误判重复: " + JSON.stringify(articleTypeConstructor.body));
    // 词表兜底：layout 只认三值，原型同名属性不得冒充合法取值（Ajv strict 落盘前的校验层即须拒）
    const layoutCallsBefore = writeEnumsCalls;
    const layoutProto = await h.call("PUT /api/schema/enums", "/api/schema/enums", { revision: protoValueRevision, patch: { layers: [{ id: "service", label: "服务", color: "gray", layout: "constructor" }] } });
    assert.equal(layoutProto.statusCode, 400, "layout=constructor 必须 400: " + JSON.stringify(layoutProto.body));
    assert.match(String(layoutProto.body.message), /layers\[0\]\.layout: must be one of central, left-panel, right-panel/);
    assert.equal(writeEnumsCalls, layoutCallsBefore, "被拒的 layout patch 不得触达写服务");
    assert.deepEqual(fs.readFileSync(enumsPath), protoValueBefore, "被拒的 layout patch 不得改写 enums.yaml");
  } finally { await h.close(); fs.rmSync(vault, { recursive: true, force: true }); }
  console.log("enums-routes tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
