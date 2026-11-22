import { create } from "zustand";
import { fetchPipelineStatus, type PipelineJob } from "@/lib/pipeline-api";
import { requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";
import { LIB_REQUEST_COPY } from "@/lib/lib-copy";

type PipelineState = {
  job: PipelineJob | null;
  /** 管道状态读取请求线（stall 横幅消费 job；读取失败降级为不渲染） */
  status: RequestStatus;
  initialized: boolean;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
};

/**
 * pipeline-store（2026-11-22 纯观测化）：管道控制 UI 全部退役（重建/诊断按钮→页头灯弹窗），
 * 剩余职责＝状态读取单源——GraphStallNotice 消费 job 判停摆；start/cancel/确认流随 UI 退役，
 * 触发通道归服务端（自愈链路＋路由层维修口）。
 */
export const usePipelineStore = create<PipelineState>((set, get) => ({
  job: null,
  status: "idle",
  initialized: false,

  initialize: async () => {
    if (get().initialized || get().status === "loading") return;
    set(requestLoading());
    try {
      set({ job: await fetchPipelineStatus(), initialized: true, ...requestSettled() });
    } catch (reason) {
      set({ initialized: true, ...requestFailed(reason, LIB_REQUEST_COPY.PIPELINE_STATUS_FAILED) });
    }
  },
  refresh: async () => {
    try {
      set({ job: await fetchPipelineStatus(), ...requestSettled() });
    } catch (reason) {
      set(requestFailed(reason, LIB_REQUEST_COPY.PIPELINE_STATUS_FAILED));
    }
  },
}));
