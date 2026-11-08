'use strict';
// Component: Entity-Identity-Mint —— 组件身份的唯一铸造点（WP-113，ADR-016 §二「身份入口」在实体主键上落地）
// @responsible: 给新建实体产出不透明身份号 architecture-node-id＝UUID（v4，Node 内建 crypto.randomUUID）。
// @inputs: mintEntityId({ taken, random })——taken＝判重回调（素材与写门同源，本模块不自查库）；
//   random＝仅供单元测试注入确定性序列，生产不传＝真随机源
// @outputs: 号串；64 次候选全被占用时返回 null（调用方必须按冲突报错，本模块不静默返回可撞值或空值）
// @context: 形状改判记录（Master 2026-11-05「换，存量是测试数据可以重建」）——M1 曾用自造的
//   「可读主干＋短随机尾」，其前提「人需在正文手写身份号」经实测不成立：连线写的是标题，
//   按标题命中时消费面自己报 via:'label'（WP-108 D2）。同时本仓不引 UUID 库（SPEC-046 §六在册
//   「不引入 UUID 库依赖」）、也不自写 v7 编码器（那仍是自造），故取 Node 内建 v4：不撞、无计数器。
//   存量号（grown-*／entity-* 等）一律不迁移——消费面只用整串等值（ADR-016 §二／SPEC-046 I2），
//   两代形状并存不影响比较、去重与分页。
// 纪律：本模块不外导形状常量，也不提供 isEntityId／assertEntityId——身份号一旦可被下游解析，
//   迟早长出第二份判据（本仓实录：PR-231 撤掉的正是消费面对 ID 的形状折叠与试剥）。

const { randomUUID } = require("node:crypto");

const MAX_MINT_ATTEMPTS = 64;

function mintEntityId(options = {}) {
  const random = typeof options.random === "function" ? options.random : () => randomUUID();
  const taken = typeof options.taken === "function" ? options.taken : () => false;
  for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
    const candidate = String(random()).trim().toLowerCase();
    if (candidate && !taken(candidate)) return candidate; // 空串/纯空白候选一律弃用（不得把空号写进库）
  }
  return null;
}

module.exports = { mintEntityId };
