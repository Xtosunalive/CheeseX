import { Button } from "@/components/ui/button";
import { INDIVIDUALS_COPY } from "../individuals-copy";
import type { IndividualListItem, IndividualUiConfig } from "../individuals-types";
import type { FormMode } from "../use-individuals-controller";
import { DerivedFieldForm } from "./DerivedFieldForm";
import { DerivedIndividualsTable } from "./DerivedIndividualsTable";

type LegacyIndividualsViewProps = {
  fields: IndividualUiConfig["fields"];
  items: IndividualListItem[];
  formMode: FormMode;
  values: Record<string, unknown>;
  busy: boolean;
  onChange: (name: string, value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
  onCreate: () => void;
  onEdit: (item: IndividualListItem) => void;
  onRetire: (item: IndividualListItem) => void;
};

export function LegacyIndividualsView({
  fields,
  items,
  formMode,
  values,
  busy,
  onChange,
  onSave,
  onCancel,
  onCreate,
  onEdit,
  onRetire,
}: LegacyIndividualsViewProps) {
  return (
    <div className="space-y-4">
      {formMode && (
        <div className="rounded-lg bg-surface-root p-3 ring-1 ring-border-thin">
          <p className="mb-2 text-xs font-medium">{formMode.kind === "create" ? INDIVIDUALS_COPY.CREATE_TITLE : INDIVIDUALS_COPY.EDIT_TITLE}</p>
          <DerivedFieldForm fields={fields} values={values} onChange={onChange} disabled={busy} />
          <div className="mt-2 flex gap-2">
            <Button type="button" disabled={busy} onClick={onSave}>{INDIVIDUALS_COPY.SAVE_BUTTON}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{INDIVIDUALS_COPY.CANCEL_BUTTON}</Button>
          </div>
        </div>
      )}
      {!formMode && <Button type="button" disabled={busy} onClick={onCreate}>{INDIVIDUALS_COPY.CREATE_BUTTON}</Button>}
      <DerivedIndividualsTable items={items} onEdit={onEdit} onRetire={onRetire} busy={busy} />
    </div>
  );
}
