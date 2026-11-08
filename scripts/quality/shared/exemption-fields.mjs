// Component: Shared-Exemption-Fields（豁免条目必备要素清单的单一事实源）
// @responsible: PR-215 收敛——「一条豁免须带哪几项」这件事此前在三个 checker 里各抄一份
//   （check-defect-shapes.mjs / check-error-codes.mjs / check-rules-lifecycle.mjs），改一处不回灌其余两处。
//   本件是唯一定义处；消费方一律 import，再现第二份由 check:defect-shapes 的 P6-F4 族直接判红。
//   注意：本件只统一「有哪些要素」，不统一「空怎么判」——各执法面对空白/缺项的判定强度按自身语义保留
//   （error-codes 用真值判、defect-shapes 用去空白判），统一口径属形状裁决，仍在 PR-215 待决项里。
// @inputs: 无（常量件）
// @outputs: EXEMPTION_FIELDS: string[]
// @context: Sync（纯常量，无 IO）
export const EXEMPTION_FIELDS = ["reason", "owner", "expiresAt", "reviewCondition"];
