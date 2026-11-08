import { useState } from "react";
import { DOC_TAX_COPY } from "./schema-manager-copy";
import { TaxonomyListEditor } from "./components";
import { tabSemantics } from "@/lib/schema-shape";
import { OBJECT_DICTIONARY } from "@/lib/object-dictionary";
import { useSchemaManagerStore } from "./schema-manager-store";

type TaxonomySection = "article_types" | "doc_types";

// 批10（Master 2026-10-26「1 拆」）：产品模块已拆独立页签——本页签回归两个纯值域轴
const SECTIONS: Array<{ id: TaxonomySection; label: string; hint: string }> = [
  { id: "article_types", label: DOC_TAX_COPY.SECTION_ARTICLE_TYPES, hint: DOC_TAX_COPY.ARTICLE_TYPES_HINT },
  { id: "doc_types", label: DOC_TAX_COPY.SECTION_DOC_TYPES, hint: DOC_TAX_COPY.DOC_TYPES_HINT },
];

export function DocumentTaxonomyEditor({ disabled }: { disabled: boolean }) {
  const store = useSchemaManagerStore();
  const [activeSection, setActiveSection] = useState<TaxonomySection>("article_types");
  if (!store.enums) return null;

  return (
    <div data-testid="document-taxonomy-editor" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-thin pb-3">
        <div>
          {/* 批9：标题/说明派生自字典语义层（正名「文章字段值域」，Master 裁决定名——不再硬编码第二份） */}
          <h3 className="text-sm font-semibold text-text-main">{tabSemantics(OBJECT_DICTIONARY, "taxonomy")?.primaryName ?? DOC_TAX_COPY.PRIMARY_NAME_FALLBACK}</h3>
          <p className="mt-1 text-xs text-text-hint">{store.enums.sourceFile}</p>
          {tabSemantics(OBJECT_DICTIONARY, "taxonomy") && (
            <p className="mt-1 max-w-xl text-xs text-text-sub">{tabSemantics(OBJECT_DICTIONARY, "taxonomy")!.objects[0].definition}</p>
          )}
        </div>
        <div className="flex h-8 items-center rounded-md ring-1 ring-border-thin">
          {SECTIONS.map((section) => (
            <button key={section.id} title={section.hint} type="button" onClick={() => setActiveSection(section.id)} className={`h-8 px-3 text-xs first:rounded-l-md last:rounded-r-md ${activeSection === section.id ? "bg-accent-base text-accent-contrast" : "text-text-sub hover:text-text-main"}`}>
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-text-sub">{SECTIONS.find((s) => s.id === activeSection)?.hint}</p>
      {activeSection === "article_types" && <TaxonomyListEditor label={DOC_TAX_COPY.SECTION_ARTICLE_TYPES} values={store.enums.article_types} disabled={disabled} onChange={store.setArticleTypes} />}
      {activeSection === "doc_types" && <TaxonomyListEditor label={DOC_TAX_COPY.SECTION_DOC_TYPES} values={store.enums.doc_types} disabled={disabled} onChange={store.setDocTypes} />}
    </div>
  );
}
