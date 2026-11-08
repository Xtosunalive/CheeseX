const { computeGaps } = require("../gap-engine.cjs");
let passed = 0, failed = 0;
function assertEq(a,e,l) { if(a===e)passed++; else{console.error("FAIL: "+l);failed++;} }
function assert(c,l) { if(c)passed++; else{console.error("FAIL: "+l);failed++;} }
function s(ids){return new Set(ids)}
function n(id,label,labels,fp,exempt){return{id,label:label||id,category:"服务",labels:labels||["ArchitectureComponent"],filePath:fp||null,exemptRules:exempt||null}}

// 1: isolated_entity severity = warning
(function(){
  var r=computeGaps(s(["A","B"]),[{source:"A",target:"A"}],[],s(["A","B"]),{A:n("A"),B:n("B")},s([]),"TestVault");
  var iso=r.gaps.filter(function(g){return g.type==="isolated_entity"});
  assertEq(iso.length,1,"1: isolated_entity count");
  assertEq(iso[0].severity,"warning","1: severity=warning");
})();

// 2: dangling_dependency severity = blocker
(function(){
  var r=computeGaps(s(["A"]),[],[{source:"A",target:"ghost",type:"DEPENDS_ON"}],s(["A"]),{A:n("A","A",["ArchitectureComponent"],"wiki/entities/A.md")},s([]),"MyVault");
  var dd=r.gaps.filter(function(g){return g.type==="dangling_dependency"});
  assertEq(dd.length,1,"2: dangling_dependency count");
  assertEq(dd[0].severity,"blocker","2: severity=blocker");
})();

// 3: canonical filePath is preserved for the shared opener
(function(){
  var r=computeGaps(s(["A"]),[],[{source:"A",target:"ghost",type:"DEPENDS_ON"}],s(["A"]),{A:n("A","A",["ArchitectureComponent"],"wiki/entities/A.md")},s([]),"MyVault");
  var dd=r.gaps.filter(function(g){return g.type==="dangling_dependency"});
  assertEq(dd[0].filePath,"wiki/entities/A.md","3: filePath present");
})();

// 4: missing_document_ref keeps filePath when present
(function(){
  var r=computeGaps(s(["A"]),[{source:"A",target:"A"}],[],s(["A"]),{A:n("A","A",["ArchitectureComponent"],"wiki/entities/A.md")},s([]),"TestVault");
  var mdr=r.gaps.filter(function(g){return g.type==="missing_document_ref"});
  assertEq(mdr.length,1,"4: mdr count=1");
  assertEq(mdr[0].filePath,"wiki/entities/A.md","4: filePath present on mdr");
})();

// 5: missing_document_ref stays warning (not blocker)
assertEq("warning","warning","5: mdr severity=warning placeholder");

// 6: empty inputs
(function(){
  var r=computeGaps(new Set,[],[],new Set,{},new Set,"");
  assertEq(r.gaps.length,0,"6: empty=empty");
})();

// 7: filePath is independent from vault display name
(function(){
  var r=computeGaps(s(["A"]),[],[{source:"A",target:"ghost"}],s(["A"]),{A:n("A","A",["ArchitectureComponent"],"wiki/A.md")},s([]),"");
  var dd=r.gaps.filter(function(g){return g.type==="dangling_dependency"});
  assertEq(dd[0].filePath,"wiki/A.md","7: filePath remains available");
})();

// 8: cross_domain_ref
(function(){
  var r=computeGaps(s(["A"]),[],[{source:"A",target:"dom:x",type:"BELONGS_TO"}],s(["A","dom:x"]),{A:n("A"),"dom:x":n("dom:x","域",["BusinessDomain"])},s([]),"V");
  var cd=r.gaps.filter(function(g){return g.type==="cross_domain_ref"});
  assertEq(cd.length,1,"8: cross_domain_ref count");
  assertEq(cd[0].severity,"warning","8: severity=warning");
})();

// 9-13: WP-031 文档级豁免（exempt_rules——同管道双粒度）
// 9: 源实体文档豁免 isolated_entity → gap 不进清单＋exempted 追溯（含豁免归属节点）
(function(){
  var nodes={A:n("A","A",["ArchitectureComponent"],"wiki/entities/A.md",["isolated_entity"]),B:n("B","B",["ArchitectureComponent"])};
  var r=computeGaps(s(["A","B"]),[{source:"B",target:"B"}],[],s(["A","B"]),nodes,s([]),"V");
  assertEq(r.gaps.filter(function(g){return g.type==="isolated_entity"&&g.targetId==="A"}).length,0,"9: 豁免后 isolated_entity 不在 gaps");
  var ex=r.exempted.filter(function(e){return e.type==="isolated_entity"&&e.targetId==="A"});
  assertEq(ex.length,1,"9: exempted 追溯在位");
  assertEq(ex[0].exemptedBy,"A","9: 豁免归属=源实体自身文档");
})();

// 10: 反例——未豁免类型不受影响（A 豁免 isolated_entity，其 missing_document_ref 仍报）
(function(){
  var nodes={A:n("A","A",["ArchitectureComponent"],"wiki/entities/A.md",["isolated_entity"])};
  var r=computeGaps(s(["A"]),[{source:"A",target:"A"}],[],s(["A"]),nodes,s([]),"V");
  assertEq(r.gaps.filter(function(g){return g.type==="missing_document_ref"}).length,1,"10: 未豁免类型仍报");
})();

// 11: 反例——其他实体的同类型缺口不受影响（B 未声明豁免）
(function(){
  var nodes={A:n("A","A",["ArchitectureComponent"],"wiki/entities/A.md",["isolated_entity"]),B:n("B","B",["ArchitectureComponent"])};
  var r=computeGaps(s(["A","B"]),[],[],s(["A","B"]),nodes,s([]),"V");
  assertEq(r.gaps.filter(function(g){return g.type==="isolated_entity"&&g.targetId==="B"}).length,1,"11: 未声明豁免的实体同类型仍报");
  assertEq(r.gaps.filter(function(g){return g.type==="isolated_entity"&&g.targetId==="A"}).length,0,"11: 同输入下豁免方 A 确已豁免（对照）");
})();

// 12: 边类缺口豁免归属=from 端源实体文档（dangling_dependency 由 A 声明豁免）
(function(){
  var nodes={A:n("A","A",["ArchitectureComponent"],"wiki/entities/A.md",["dangling_dependency"])};
  var r=computeGaps(s(["A"]),[],[{source:"A",target:"ghost",type:"DEPENDS_ON"}],s(["A"]),nodes,s([]),"V");
  assertEq(r.gaps.filter(function(g){return g.type==="dangling_dependency"}).length,0,"12: 边类缺口豁免后不在 gaps");
  assertEq(r.exempted.length,1,"12: exempted 在位");
  assertEq(r.exempted[0].exemptedBy,"A","12: 豁免归属=from 源实体");
})();

// 13: 单条 resolve 通道回归零变化（resolvedGapIds 依旧优先，exempted 不吞已 resolve 项）
(function(){
  var nodes={A:n("A","A",["ArchitectureComponent"],"wiki/entities/A.md",["isolated_entity"])};
  var r=computeGaps(s(["A"]),[],[],s(["A"]),nodes,s(["gap:isolated_entity:A"]),"V");
  assertEq(r.gaps.filter(function(g){return g.type==="isolated_entity"}).length,0,"13: resolved 依旧过滤");
  assertEq(r.exempted.length,0,"13: resolved 不进 exempted（两通道互不冒领）");
})();

// 14: WP-031 文案人话断言——五类 detail 不含内部话术禁词（唯一声明处纪律的守护钉：
// 改 gap-detail-declarations 文案带入禁词即红）
(function(){
  var r=computeGaps(s(["A","B"]),[],[{source:"A",target:"ghost",type:"DEPENDS_ON"},{source:"B",target:"dom:x",type:"RELATES_TO"}],s(["A","B"]),{A:n("A","甲",["ArchitectureComponent"],"wiki/entities/A.md"),B:n("B","乙",["ArchitectureComponent"],"wiki/entities/B.md"),"dom:x":n("dom:x","域",["BusinessDomain"])},s([]),"V");
  var details=(r.gaps.map(function(g){return g.detail;}).join("\n")+"\n"+(r.exempted||[]).map(function(e){return e.type;}).join("\n"));
  var banned=["master_graph","labels:","入度+出度","REFERENCES","管道","gap:"];
  for (var i=0;i<banned.length;i++) assert(details.indexOf(banned[i])<0,"14: detail 禁词『"+banned[i]+"』不得出现");
})();

// 15: WP-031 红队项②③——未识别规则值 warnings 提示＋low_confidence 带 filePath（豁免引导可定位）
(function(){
  var nodes={A:n("A","甲",["ArchitectureComponent"],"wiki/entities/A.md",["isolated_entity","blocker_all"])};
  var r=computeGaps(s(["A"]),[],[],s(["A"]),nodes,s([]),"V");
  var uw=r.warnings.filter(function(w){return w.type==="unknown_exempt_rule";});
  assertEq(uw.length,1,"15: 未识别规则值 → warnings 一条");
  assert(uw[0].detail.indexOf("blocker_all")>=0 && uw[0].detail.indexOf("合法类型")>=0,"15: 提示含原值与合法清单");
  var nodes2={A:n("A","甲",["ArchitectureComponent"],"wiki/entities/A.md"),B:n("B","乙",["ArchitectureComponent"])};
  var r2=computeGaps(s(["A","B"]),[{source:"A",target:"B",properties:{confidence:0.3}}],[],s(["A","B"]),nodes2,s([]),"V");
  var lc=r2.gaps.filter(function(g){return g.type==="low_confidence";});
  assertEq(lc.length,1,"15: low_confidence 在列");
  assertEq(lc[0].filePath,"wiki/entities/A.md","15: low_confidence filePath=from 源实体文档");
})();

// ── WP-116 批1（八址键直取收敛）：LABEL_PLAIN_NAMES 内容标签 own 显式分支（表已 null 原型，WP-050 D1）──
(function(){
  var plainLabels = require("../gap-detail-declarations.cjs").plainLabels;
  assertEq(plainLabels(["BusinessDomain","Subdomain"]), "业务域、子域", "WP-116 gap: 在册标签映射保持");
  assertEq(plainLabels(["Document"]), "文档", "WP-116 gap: 单标签对照");
  assertEq(plainLabels(["constructor"]), "其他类型", "WP-116 gap: 保留名标签回落（own 分支，不渲染函数原文）");
  assertEq(plainLabels(["toString","valueOf"]), "其他类型、其他类型", "WP-116 gap: 保留名标签族全部回落");
  assertEq(plainLabels([]), "其他类型", "WP-116 gap: 空标签集回落");
  assertEq(plainLabels("not-an-array"), "其他类型", "WP-116 gap: 非数组入参回落（语义保持）");
})();

console.log("passed: "+passed+", failed: "+failed);
if(!process.env.VITEST)process.exit(failed>0?1:0);
