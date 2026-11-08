// ConceptVocabularyTab（SPEC-018 #2）——概念主体页签最小补位。
// 管概念域（domains.concept）的子域词表：复用 DomainSubdomainEditor 锁定 concept 域，
// 数据走既有 enums store（读写链路与「知识域/子域」页签同一套，零新通道）。
// 锁边界：concept_types（ontology 概念类型）下钻管理后续增强另立。
import { DomainSubdomainEditor } from "./DomainSubdomainEditor";
import { CONCEPT_TAB_COPY } from "./schema-manager-copy";
import { useSchemaManagerStore } from "./schema-manager-store";

export function ConceptVocabularyTab({ disabled }: { disabled?: boolean }) {
  const store = useSchemaManagerStore();
  const conceptDomain = { concept: store.enums?.domains?.concept ?? CONCEPT_TAB_COPY.CONCEPT_DOMAIN_FALLBACK };
  const conceptSubdomains = { concept: store.enums?.subdomains?.concept ?? [] };
  return <section aria-label={CONCEPT_TAB_COPY.SECTION_ARIA} className="space-y-3">
    <DomainSubdomainEditor
      domains={conceptDomain}
      subdomains={conceptSubdomains}
      categories={store.enums?.categories ?? []}
      policies={store.enums?.subdomain_constraints ?? {}}
      onDomainsChange={() => {/* 域名单域锁定——concept 域不可增删（域结构属元层） */}}
      onSubdomainsChange={(next) => store.setSubdomains({ ...store.enums?.subdomains, ...next })}
      onPoliciesChange={store.setSubdomainConstraints}
      disabled={disabled}
      showDomainList={false}
    />
  </section>;
}
