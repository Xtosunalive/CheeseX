// pool-bus — 任务池互斥总线（Master 2026-10-06 目检②裁决：右侧只放一个池容器，开新关旧）
// 语义：面板打开即占用总线；占用者切换时，其他面板读到「总线已易主」自行收起
// （收起=各面板自己的「最小化」语义，编辑内容不丢——修复面板随 entity-compliance store 缓存，
//  异常弹窗的表单草稿由组件内 issueScopeKey 效应缓存）。
// 时序注意：acquire 在 effect 中执行——首个渲染周期 stillOwner 必为 false（总线尚未易主），
// 故「被顶掉」判定必须基于「上一帧曾是 owner」的边沿，不能看绝对值（否则打开即自我关闭）。
import { useEffect, useRef } from "react";
import { create } from "zustand";

export type PoolName = "entity-repair" | "entity-hub" | "anomaly-repair" | "article-detail";

interface PoolBusState {
  active: PoolName | null;
  acquire: (name: PoolName) => void;
  release: (name: PoolName) => void;
}

export const usePoolBus = create<PoolBusState>((set, get) => ({
  active: null,
  acquire: (name) => { if (get().active !== name) set({ active: name }); },
  release: (name) => { if (get().active === name) set({ active: null }); },
}));

/** 打开时占用总线；卸载/关闭时释放。返回：本面板是否为当前占用者（边沿安全：首帧不算被顶） */
export function usePoolOccupancy(name: PoolName, open: boolean): boolean {
  const active = usePoolBus((s) => s.active);
  const acquire = usePoolBus((s) => s.acquire);
  const release = usePoolBus((s) => s.release);
  const wasOwnerRef = useRef(false);
  useEffect(() => {
    if (open) acquire(name);
    else release(name);
    return () => release(name);
  }, [open, name, acquire, release]);
  const isOwner = open && active === name;
  // 边沿判定输出：曾持有→现失去=被顶掉（false）；从未持有（首帧 acquire 未跑）不算
  const wasOwner = wasOwnerRef.current;
  if (isOwner) wasOwnerRef.current = true;
  else if (!open) wasOwnerRef.current = false;
  // 首帧（active 尚为 null，effect 未跑）视为 owner，避免打开即自关
  return isOwner || (open && !wasOwner && active === null);
}
