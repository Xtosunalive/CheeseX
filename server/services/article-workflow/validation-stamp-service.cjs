// @responsible: 候选文章校验章重算（PR-151 修复③＝PR-046 残留缺口「PATCH/standardize 后自动重章」根治）。
// Web 写路径（补字段 PATCH /标准化/修复抽屉）改动候选内容时，frontmatter validation_* 校验章与内容
// 同一笔写落盘——发布闸门（approval-state-machine B3）读到的章自此必为当前内容的校验结论。
// 语义单源＝article-validator-lib（SPEC-022 Node 唯一语义）：validateContent 现算＋applyValidationStamp
// 同一实现产章；本模块只算不写，落盘由调用方走 writeVault（PR-057 唯一写通道＋PR-083 凭据制）。
// fail-closed：校验器不可用（解析物缺失/损坏等 ValidatorFatal）→ 抛错拒写，不留「已改内容、旧章残留」的半程态。
"use strict";

const { createArticleValidator, ValidatorFatal } = require("../../../scripts/vault-runtime/article-validator-lib.cjs");
const { createError } = require("../../shared/error-factory.cjs");

// 对候选内容（字符串）重算校验章，返回盖章后的完整文件内容与校验结果。
// 不读盘、不写盘——调用方负责内容字节与写通道凭据。
function restampCandidateContent(vaultPath, absolutePath, rawContent) {
  let validator;
  try {
    validator = createArticleValidator({ vaultPath });
  } catch (error) {
    if (error instanceof ValidatorFatal) throw createError("VALIDATOR_UNAVAILABLE", `校验器不可用，拒绝未重算校验章的写入（fail-closed）：${error.message}`, 503);
    throw error;
  }
  const validation = validator.validateContent(absolutePath, rawContent);
  const stamped = validator.applyValidationStamp(rawContent, validation);
  if (stamped === null) {
    throw createError("VALIDATION_STAMP_UNWRITABLE", "候选 frontmatter 不可安全序列化，无法重算校验章（fail-closed）", 409);
  }
  return { content: stamped, validation };
}

module.exports = { restampCandidateContent };
