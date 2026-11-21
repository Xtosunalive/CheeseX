// WP-210（SPEC-100 批 4）：派生字段表单——按服务端派生配置渲染输入族（文本/数值/布尔三形态 MVP）。
import type { IndividualFieldConfig } from "../individuals-types";
import { INDIVIDUALS_COPY } from "../individuals-copy";

interface Props {
  fields: IndividualFieldConfig[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  disabled?: boolean;
}

export function DerivedFieldForm({ fields, values, onChange, disabled }: Props) {
  return (
    <div className="space-y-2">
      {fields.map((field) => (
        <label key={field.name} className="block">
          <span className="mb-1 block text-kg-xs text-text-hint">
            {field.display}
            {field.required && <span className="ml-1 text-status-error">{INDIVIDUALS_COPY.REQUIRED_MARK}</span>}
            {!field.declared && <span className="ml-1 text-text-placeholder" title={INDIVIDUALS_COPY.UNDECLARED_NOTE}>{INDIVIDUALS_COPY.UNDECLARED_SHORT}</span>}
          </span>
          {field.type === "boolean" ? (
            <input
              type="checkbox"
              checked={Boolean(values[field.name])}
              disabled={disabled}
              onChange={(event) => onChange(field.name, event.target.checked)}
              className="h-4 w-4"
            />
          ) : (
            <input
              type={field.type === "integer" || field.type === "float" || field.type === "decimal" || field.type === "unsigned integer" ? "number" : "text"}
              value={String(values[field.name] ?? "")}
              disabled={disabled}
              onChange={(event) => onChange(field.name, field.type.includes("integer") || field.type === "float" || field.type === "decimal" ? Number(event.target.value) : event.target.value)}
              className="h-8 w-full max-w-md rounded bg-surface-root px-3 text-xs text-text-main ring-1 ring-border-thin outline-none focus:ring-border-focus"
            />
          )}
        </label>
      ))}
    </div>
  );
}
