// Component: Stale-Lock (T1/#822)
// @responsible: 跨请求互斥锁——owner 行（pid/startedAt/host）＋ pid 存活检查（stale 自动接管）。
// @context: Release-Governance（publisher publish 锁）
//
// SPEC-012 WP-A：锁语义迁 runtime-state.db locks 表（BEGIN IMMEDIATE 互斥替代 wx 文件锁＋fd 写）——
// 原 vault-write-baseline 的「fd 锁写」条目随之清零（基线随 WP-J 退役）。原「approval merge.lock」自初始提交起无任何
// 调用点（勘察 2026-10-14 实证），幽灵注释随本次重写退役，不为其建行。
// 语义不变点：拿到=true / BUSY=false；pid 已死（ESRCH）＝stale 可接管，一次尝试；释放幂等。

"use strict";

const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");

// 拿锁失败时的 stale 判定：owner pid 已死（ESRCH）→ 可安全接管。
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

function lockStore(options) {
  return (options && options.runtimeState || getRuntimeStateStore()).locks;
}

/**
 * 拿锁（带 stale 接管）。锁名代替旧锁文件路径——物理住 runtime-state.db。
 * @param {string} name 锁名（如 "publish"）
 * @param {{ runtimeState?: object }} [options]
 * @returns {boolean} true=拿到（调用方负责 finally 释放）；false=BUSY
 */
function tryAcquire(name, options) {
  const locks = lockStore(options);
  try {
    return locks.tryAcquire(name, { isPidAlive }) !== null; // store 内含 stale 接管（BEGIN IMMEDIATE 事务内判活+覆写）
  } catch {
    return false;
  }
}

function acquireWithStaleRecovery(name, options) {
  return tryAcquire(name, options); // stale 判定已并入 store 事务（一次接管语义不变）
}

function release(name, options) {
  try { lockStore(options).release(name); } catch { /* best-effort：清理/降级失败静默可接受 */ }
}

function readOwner(name, options) {
  try { return lockStore(options).owner(name); } catch { return null; }
}

module.exports = { acquireWithStaleRecovery, release, isPidAlive, readOwner, tryAcquire };
