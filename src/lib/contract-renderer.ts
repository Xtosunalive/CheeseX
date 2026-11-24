import type { components } from "@/lib/generated/api-types";

export type ScreenButton = components["schemas"]["ScreenButton"];
export type ScreenSection = components["schemas"]["ScreenSection"];
export type ScreenContract = NonNullable<components["schemas"]["ScreenContract"]>;

export type ContractField = {
  name: string;
  display: string;
  required: boolean;
  type: string;
  declared: boolean;
};

export type ContractRow = {
  id: string;
  title?: string;
  revision?: string;
  fields: Record<string, unknown>;
};

export type ContractActionContext = {
  action: ScreenButton;
  row?: ContractRow;
};

export function rowValue(row: ContractRow, field: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row.fields, field)) return row.fields[field];
  if (field === "id") return row.id;
  if (field === "title") return row.title;
  if (field === "revision") return row.revision;
  return undefined;
}

export function renderContractValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map(renderContractValue).join("、") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function impactText(button: ScreenButton): string {
  return button.impact.map((impact) => impact.description || `${impact.class_id}.${impact.fields.join("/")}`).join("；");
}
