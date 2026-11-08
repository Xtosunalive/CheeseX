import { create } from "zustand";
import { compareArchitectureVersions, fetchProductVersions } from "./architecture-version-api";
import type { ArchitectureVersionComparison, ProductVersion, ProductVersionList } from "./architecture-version-types";
import { errorMessageOf, requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";
import { AV_REQUEST_COPY } from "./architecture-version-copy";

type State = {
  versions: ProductVersionList | null;
  comparison: ArchitectureVersionComparison | null;
  /** 主请求＝产品版本清单加载 */
  status: RequestStatus;
  error: string | null;
  /** 写侧/派生请求＝版本比较：busy 旗＋独立错误位（不污染主请求 error） */
  comparing: boolean;
  operationError: string | null;
  product: string;
  sourceVersion: string;
  targetVersion: string;
  load: () => Promise<void>;
  compare: () => Promise<void>;
  setProduct: (product: string) => void;
  setSourceVersion: (version: string) => void;
  setTargetVersion: (version: string) => void;
};

function versionsFor(items: ProductVersion[], product: string) {
  return items.filter((item) => item.product === product);
}

function defaultSelection(items: ProductVersion[], preferredProduct = "") {
  const compareableProduct = [...new Set(items.map((item) => item.product))]
    .find((candidate) => versionsFor(items, candidate).length >= 2);
  const product = preferredProduct && items.some((item) => item.product === preferredProduct)
    ? preferredProduct
    : compareableProduct || items[0]?.product || "";
  const productVersions = versionsFor(items, product);
  return {
    product,
    sourceVersion: productVersions[0]?.version || "",
    targetVersion: productVersions[1]?.version || "",
  };
}

export const useArchitectureVersionStore = create<State>((set, get) => ({
  versions: null,
  comparison: null,
  status: "idle",
  error: null,
  comparing: false,
  operationError: null,
  product: "",
  sourceVersion: "",
  targetVersion: "",
  load: async () => {
    set(requestLoading());
    try {
      const versions = await fetchProductVersions();
      set({ versions, ...defaultSelection(versions.items, get().product), comparison: null, ...requestSettled(versions.items.length === 0) });
    } catch (error) {
      set(requestFailed(error, AV_REQUEST_COPY.LOAD_FAILED));
    }
  },
  compare: async () => {
    const { product, sourceVersion, targetVersion } = get();
    if (!product || !sourceVersion || !targetVersion || sourceVersion === targetVersion) return;
    set({ comparing: true, operationError: null });
    try {
      const comparison = await compareArchitectureVersions(product, sourceVersion, targetVersion);
      set({ comparison, comparing: false });
    } catch (error) {
      set({ comparing: false, operationError: errorMessageOf(error, AV_REQUEST_COPY.COMPARE_FAILED) });
    }
  },
  setProduct: (product) => {
    const items = get().versions?.items || [];
    set({ ...defaultSelection(items, product), comparison: null, operationError: null });
  },
  setSourceVersion: (sourceVersion) => set({ sourceVersion, comparison: null, operationError: null }),
  setTargetVersion: (targetVersion) => set({ targetVersion, comparison: null, operationError: null }),
}));
