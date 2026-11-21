// WP-213（红队 M1②）：派生字段表单——统一件化（ui-kit Input/Checkbox，原生件退役）。
// 渲染形态（文本/数值/布尔三形态 MVP）与中文 display/必填/未声明标注不变（INDIVIDUALS_COPY 闭集）。
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { IndividualFieldConfig } from "../individuals-types";
import { INDIVIDUALS_COPY } from "../individuals-copy";

interface Props {
  fields: IndividualFieldConfig[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  disabled?: boolean;
}

const NUMERIC_TYPES = new Set(["integer", "float", "decimal", "unsigned integer"]);

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
            <Checkbox
              checked={Boolean(values[field.name])}
              disabled={disabled}
              onCheckedChange={(checked) => onChange(field.name, checked === true)}
              aria-label={field.display}
            />
          ) : (
            <Input
              type={NUMERIC_TYPES.has(field.type) ? "number" : "text"}
              value={String(values[field.name] ?? "")}
              disabled={disabled}
              onChange={(event) => onChange(field.name, NUMERIC_TYPES.has(field.type) ? Number(event.target.value) : event.target.value)}
              className="h-8 w-full max-w-md"
            />
          )}
        </label>
      ))}
    </div>
  );
}
