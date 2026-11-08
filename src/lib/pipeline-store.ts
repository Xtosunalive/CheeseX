import { create } from "zustand";
import { cancelPipeline, fetchPipelineStatus, rebuildPipeline, runPipeline, type PipelineJob } from "@/lib/pipeline-api";
import { requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";
import { LIB_REQUEST_COPY } from "@/lib/lib-copy";

export type PipelineRunMode = "diagnostic" | "rebuild";

type PipelineState = {
  job: PipelineJob | null;
  open: boolean;
  /** 管道请求线（状态读取/启动/取消共用；按钮禁用态取 status === "loading"） */
  status: RequestStatus;
  confirming: boolean;
  confirmingMode: PipelineRunMode;
  error: string | null;
  initialized: boolean;
  setOpen: (open: boolean) => void;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  /** 打开阻断确认（仅重建档使用——WP-146 件1：诊断只读改直执行，不再经确认块） */
  requestRun: (mode?: PipelineRunMode) => void;
  dismissConfirmation: () => void;
  /** 直执行通道（诊断主路径；confirmRun 复用同一起动体） */
  startRun: (mode: PipelineRunMode) => Promise<void>;
  confirmRun: () => Promise<void>;
  cancel: () => Promise<void>;
};

export const usePipelineStore = create<PipelineState>((set, get) => ({
  job: null,
  open: false,
  status: "idle",
  confirming: false,
  confirmingMode: "diagnostic",
  error: null,
  initialized: false,

  setOpen: (open) => set({ open }),
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
  requestRun: (mode = "diagnostic") => set({ confirming: true, confirmingMode: mode, error: null }),
  dismissConfirmation: () => set({ confirming: false }),
  startRun: async (mode) => {
    // 直执行/确认共用同一起动体：进入即清阻断确认（诊断直点不残留重建确认块），
    // error 随 requestLoading 一并归零（request-status 契约：error 非空 ⇔ status==="error"）
    set({ confirming: false, ...requestLoading() });
    try {
      const job = mode === "rebuild" ? await rebuildPipeline() : await runPipeline();
      set({ job, ...requestSettled() });
    } catch (reason) {
      set(requestFailed(reason, LIB_REQUEST_COPY.PIPELINE_START_FAILED));
    }
  },
  confirmRun: async () => {
    await get().startRun(get().confirmingMode);
  },
  cancel: async () => {
    set(requestLoading());
    try {
      set({ job: await cancelPipeline(), ...requestSettled() });
    } catch (reason) {
      set(requestFailed(reason, LIB_REQUEST_COPY.PIPELINE_CANCEL_FAILED));
    }
  },
}));
