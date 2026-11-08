import type { FullEnumsData, ModuleRegistry } from "./schema-manager-types";

export function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function renameModuleSubdomainReferences(modules: ModuleRegistry, from: string, to: string) {
  const moduleNames: string[] = [];
  const nextModules = Object.fromEntries(Object.entries(modules).map(([name, definition]) => {
    if (definition.subdomain !== from) return [name, definition];
    moduleNames.push(name);
    return [name, { ...definition, subdomain: to }];
  }));
  return { modules: nextModules, moduleNames };
}

export function computeEnumsDirtyDiffs(
  enums: FullEnumsData | null,
  savedEnums: FullEnumsData | null,
): Partial<FullEnumsData> {
  if (!enums || !savedEnums) return {};
  const diffs: Partial<FullEnumsData> = {};
  if (!deepEqual(enums.domains, savedEnums.domains)) diffs.domains = enums.domains;
  if (!deepEqual(enums.subdomains, savedEnums.subdomains)) diffs.subdomains = enums.subdomains;
  if (!deepEqual(enums.subdomain_constraints, savedEnums.subdomain_constraints)) diffs.subdomain_constraints = enums.subdomain_constraints;
  if (!deepEqual(enums.layers, savedEnums.layers)) diffs.layers = enums.layers;
  if (!deepEqual(enums.categories, savedEnums.categories)) diffs.categories = enums.categories;
  if (!deepEqual(enums.article_types, savedEnums.article_types)) diffs.article_types = enums.article_types;
  if (!deepEqual(enums.doc_types, savedEnums.doc_types)) diffs.doc_types = enums.doc_types;
  if (!deepEqual(enums.modules, savedEnums.modules)) diffs.modules = enums.modules;
  if (!deepEqual(enums.tags, savedEnums.tags)) diffs.tags = enums.tags;
  if (!deepEqual(enums.tag_aliases, savedEnums.tag_aliases)) diffs.tag_aliases = enums.tag_aliases;
  if (!deepEqual(enums.disabled_tags, savedEnums.disabled_tags)) diffs.disabled_tags = enums.disabled_tags;
  return diffs;
}
