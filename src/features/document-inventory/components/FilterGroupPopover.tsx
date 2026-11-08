import { FilterSelect } from "@/components/filter-select";
import type { DocumentFacetOption } from "@/features/document-inventory/document-inventory-types";
import { documentFilterGroupAria, documentFilterGroupEmpty, documentFilterGroupTitle } from "../document-inventory-copy";

export function FilterGroupPopover({ label, triggerLabel, options, selected, onChange }: {
  label: string;
  triggerLabel?: string;
  options: DocumentFacetOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return <FilterSelect ariaLabel={documentFilterGroupAria(label)} title={documentFilterGroupTitle(label)} searchPlaceholder={documentFilterGroupAria(label)} multiple variant="filter" value={selected} onValueChange={(value) => onChange(value as string[])} emptyLabel={documentFilterGroupEmpty(label)} emptyTriggerLabel={triggerLabel} placeholder={label} options={options.map((option) => ({ value: option.value, label: option.value, count: option.count, group: label }))} />;
}
