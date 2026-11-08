// seq209-field-label-ssot：field-labels.mjs 的 TypeScript 类型声明（vite/tsc 对仓根 ESM 的解析锚）
// 写法照抄 shared/date-contract.d.mts。
export type FieldLabelDomain = "entity" | "article";
export declare const FIELD_LABELS: { entity: Record<string, string>; article: Record<string, string> };
export declare function fieldLabel(field: unknown, domain?: FieldLabelDomain): string;
