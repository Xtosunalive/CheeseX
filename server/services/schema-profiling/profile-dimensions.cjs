// Component: Profile-Dimensions
// @responsible: 词表画像维度单一定义（SPEC-020 波 2：DIMENSIONS 双胞胎收敛——此前
//               vocabulary-profiling-service 与 vocabulary-lineage 各维护一份，现一处定义两处消费；
//               字段名锚点对账由 check:fields-registry 锚点随迁至本文件）。
// @context: 维度是画像视图选择（非域事实）——数据驱动会过度工程，收敛为单份定义＋门禁锚点。
module.exports = [
  { key: "layer", entityField: "arch_layer", articleFields: ["arch_layer"], kind: "scalar" },
  { key: "category", entityField: "arch_category", articleFields: ["arch_category"], kind: "scalar" },
  { key: "subdomain", entityField: "arch_subdomain", articleFields: ["arch_subdomain"], kind: "scalar" },
  { key: "module", entityField: "module", articleFields: ["module"], kind: "list" },
  { key: "tag", entityField: "tags", articleFields: ["tags"], kind: "tags" },
];
