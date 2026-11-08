import type { ProductIdentityData, SaveStatus, VersionRegistryData, VersionRegistryProducts } from "./schema-manager-types";
import { fetchProductIdentity, fetchVersionRegistry, freezeProductVersion, validateVersionRegistry } from "./version-registry-api";
import { writeProductIdentity, writeVersions } from "./schema-write-api";
import { requestFailed, requestIdle, requestLoading, requestSettled, type RequestSlice } from "@/lib/request-status";
import { SM_REQUEST_COPY } from "./schema-manager-copy";

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface VersionRegistrySlice {
  versions: VersionRegistryData | null;
  versionsSaved: VersionRegistryData | null;
  versionsRequest: RequestSlice;
  versionsSaveStatus: SaveStatus;
  versionsSaveError: string | null;
  productIdentity: ProductIdentityData | null;
  productIdentitySaved: ProductIdentityData | null;
  productIdentitySaveStatus: SaveStatus;
  productIdentityError: string | null;
  loadVersions: () => Promise<void>;
  setVersionProducts: (products: VersionRegistryProducts) => void;
  setProductAliases: (aliases: string[]) => void;
  saveProductIdentity: (productDraft?: string) => Promise<void>;
  validateVersions: () => Promise<void>;
  saveVersions: () => Promise<void>;
  freezeVersion: (product: string, version: string) => Promise<void>;
}

type SetSlice = (partial: Partial<VersionRegistrySlice>) => void;
type GetSlice = () => VersionRegistrySlice;

export function createVersionRegistrySlice(set: SetSlice, get: GetSlice): VersionRegistrySlice {
  return {
    versions: null,
    versionsSaved: null,
    versionsRequest: requestIdle(),
    versionsSaveStatus: "clean",
    versionsSaveError: null,
    productIdentity: null,
    productIdentitySaved: null,
    productIdentitySaveStatus: "clean",
    productIdentityError: null,

    loadVersions: async () => {
      set({ versionsRequest: requestLoading() });
      try {
        const [data, productIdentity] = await Promise.all([fetchVersionRegistry(), fetchProductIdentity()]);
        set({
          versions: data,
          versionsSaved: structuredClone(data),
          versionsRequest: requestSettled(),
          versionsSaveStatus: "clean",
          versionsSaveError: null,
          productIdentity,
          productIdentitySaved: structuredClone(productIdentity),
          productIdentitySaveStatus: "clean",
          productIdentityError: null,
        });
      } catch (error) {
        set({ versionsRequest: requestFailed(error, SM_REQUEST_COPY.VERSIONS_LOAD_FAILED) });
      }
    },

    setVersionProducts: (products) => {
      const { versions, versionsSaved } = get();
      if (!versions) return;
      set({
        versions: { ...versions, products, diagnostics: [] },
        versionsSaveStatus: deepEqual(products, versionsSaved?.products ?? {}) ? "clean" : "dirty",
        versionsSaveError: null,
      });
    },

    setProductAliases: (aliases) => {
      const { productIdentity, productIdentitySaved } = get();
      if (!productIdentity) return;
      set({
        productIdentity: { ...productIdentity, aliases },
        productIdentitySaveStatus: deepEqual(aliases, productIdentitySaved?.aliases ?? []) ? "clean" : "dirty",
        productIdentityError: null,
      });
    },

    saveProductIdentity: async (productDraft?: string) => {
      const current = get().productIdentity;
      if (!current) return;
      set({ productIdentitySaveStatus: "saving", productIdentityError: null });
      try {
        // 主产品名（身份锚点）仅空态首次设定随批携带（后端 IDENTITY_ANCHOR_IMMUTABLE 兜底已设定态）
        const firstSet = !current.canonicalProduct && typeof productDraft === "string" && productDraft.trim() ? productDraft.trim() : undefined;
        await writeProductIdentity(current.revision, { aliases: current.aliases, ...(firstSet ? { product: firstSet } : {}) });
        await get().loadVersions();
        set({ productIdentitySaved: structuredClone(current), productIdentitySaveStatus: "saved", productIdentityError: null });
        setTimeout(() => { if (get().productIdentitySaveStatus === "saved") set({ productIdentitySaveStatus: "clean" }); }, 2000);
      } catch (error) {
        set({ productIdentitySaveStatus: "error", productIdentityError: error instanceof Error ? error.message : SM_REQUEST_COPY.PRODUCT_IDENTITY_SAVE_FAILED });
      }
    },

    validateVersions: async () => {
      const current = get().versions;
      if (!current) return;
      set({ versionsSaveError: null });
      try {
        const checked = await validateVersionRegistry({ revision: current.revision, schema_version: 1, products: current.products });
        set({ versions: { ...checked, products: current.products, revision: current.revision }, versionsSaveError: null });
      } catch (error) {
        set({ versionsSaveError: error instanceof Error ? error.message : SM_REQUEST_COPY.VERSIONS_VALIDATE_FAILED });
      }
    },

    saveVersions: async () => {
      const current = get().versions;
      if (!current) return;
      set({ versionsSaveStatus: "saving", versionsSaveError: null });
      try {
        await writeVersions(current.revision, { products: current.products });
        await get().loadVersions();
        set({ versionsSaved: structuredClone(current), versionsSaveStatus: "saved", versionsSaveError: null });
        setTimeout(() => { if (get().versionsSaveStatus === "saved") set({ versionsSaveStatus: "clean" }); }, 2000);
      } catch (error) {
        set({ versionsSaveStatus: "error", versionsSaveError: error instanceof Error ? error.message : SM_REQUEST_COPY.VERSIONS_SAVE_FAILED });
      }
    },

    freezeVersion: async (product, version) => {
      const current = get().versions;
      if (!current || get().versionsSaveStatus === "dirty") return;
      // 冻结是写操作：busy 走 versionsSaveStatus（与保存同轴），不借用读请求的 versionsRequest
      set({ versionsSaveStatus: "saving", versionsSaveError: null });
      try {
        await freezeProductVersion(current.revision, product, version);
        await get().loadVersions();
        set({ versionsSaveStatus: "clean" });
      } catch (error) {
        set({ versionsSaveStatus: "error", versionsSaveError: error instanceof Error ? error.message : SM_REQUEST_COPY.VERSION_FREEZE_FAILED });
      }
    },
  };
}
