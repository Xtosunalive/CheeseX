'use strict';
// Component: Confidence-Bands（置信档位单源——WP-049 L4／SPEC-044 C4）
// @responsible: 档位名集与代表值的唯一取数点。实证清单 P6「五份手抄」（suggestion-service／
//   calibration-report／relations-write／object-dictionary／前端编辑器）收敛为：本体声明优先
//   （ontology.confidence_suggestion.band_*，经词表装载端口）＋本模块一份规范缺省（仓内唯一，
//   R9 护栏口径 0<n≤1 原样保留）。消费方禁止再自抄数值或名集。
// @inputs: ontology 数据（注入形态）或 vaultPath（端口装载形态）
// @outputs: confidenceBandValues(ontologyData)／confidenceBandNames(vaultPath)
// @context: Vault（Sync）
const { loadVocabBundle } = require('./vocab-load-port.cjs');

// 规范缺省（仓内唯一一份）：与 ontology.confidence_suggestion 声明等值——声明在场时永不生效；
// 声明缺位/越界时的护栏回落（SPEC-027 R9/R9② 红队二轮口径原样）。
const BAND_VALUE_DEFAULTS = Object.freeze({ high: 0.85, medium: 0.5, low: 0.3 });

function guardrailed(value, fallback) {
  const n = Number(value);
  // R9②（红队二轮）：band 代表值 0..1 护栏——越界声明回落（读写两面口径一致）
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

/** 档位代表值（纯函数，注入形态——suggestion-service 等依赖注入方用）：
 * ontology.confidence_suggestion.band_high/medium/low 声明优先，护栏回落规范缺省。 */
function confidenceBandValues(ontologyData) {
  const decl = (ontologyData && ontologyData.confidence_suggestion) || {};
  // WP-050 D1：值映射 null 原型——内容档位名（constructor 族）直取不可表达（undefined→无档位回落）
  return Object.assign(Object.create(null), {
    high: guardrailed(decl.band_high, BAND_VALUE_DEFAULTS.high),
    medium: guardrailed(decl.band_medium, BAND_VALUE_DEFAULTS.medium),
    low: guardrailed(decl.band_low, BAND_VALUE_DEFAULTS.low),
  });
}

/** 档位名集（端口装载形态——选项类消费方用）：名集从声明键派生（band_* 去前缀），
 * 声明缺位回落规范名集；顺序按代表值降序（high＞medium＞low，展示稳定）。 */
function confidenceBandNames(vaultPath) {
  const names = Object.keys(BAND_VALUE_DEFAULTS);
  try {
    const bundle = loadVocabBundle(vaultPath, { files: ['ontology'] });
    const file = bundle.files.ontology;
    const decl = (file && file.state === 'present' && file.data && file.data.confidence_suggestion) || {};
    const derived = Object.keys(decl)
      .map((key) => /^band_(.+)$/.exec(key))
      .filter(Boolean)
      .map((m) => m[1]);
    if (derived.length) {
      const values = confidenceBandValues({ confidence_suggestion: decl });
      return derived.sort((a, b) => values[b] - values[a]);
    }
  } catch (error) {
    // 红队发现（WP-049 L4）：端口装载失败在此回落规范名集（展示面不炸）——但必须可见，
    // 不做无声回落；上游拉起链对坏词表已 fail-closed，此处命中＝脱离拉起链的直调方
    (console.warn || console.error)(`confidence-bands-fallback-to-canonical: 端口装载失败，档位名集回落规范缺省——${String((error && error.message) || error).slice(0, 200)}`);
  }
  return names;
}

module.exports = { confidenceBandValues, confidenceBandNames, BAND_VALUE_DEFAULTS };
