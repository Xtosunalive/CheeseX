import { create } from "zustand";

/** 全景停靠卡选中对象：实体或拓扑边（PR-026 丙方案：图谱检索右侧栏并入全景） */
export interface HubDrawerSelection {
  kind: "entity" | "edge";
  id: string;
}

interface HubDrawerState {
  open: boolean;
  setOpen: (open: boolean) => void;
  selection: HubDrawerSelection | null;
  /** 打开并定位到指定对象（实体节点或关系边点击的统一入口） */
  focus: (sel: HubDrawerSelection) => void;
}

export const useHubDrawerState = create<HubDrawerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  selection: null,
  focus: (sel) => set({ open: true, selection: sel }),
}));
