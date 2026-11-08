'use strict';
// Component: Identity-Port（身份入口——WP-051／SPEC-046，ADR-016 §二律文）
// @responsible: 复合身份（边/组合/依赖/影响行/账本行）的唯一构造点：**不透明 ID＝域标签＋长度
//   前缀编码**（每段先注 UTF-8 字节长度再注内容——内容含 `|`／`:`／任意字符都不再歧义）。
//   消费方比较/去重/分页/缓存只用 ID 等值；**禁手写 `|` 拼接构造身份、禁对 ID split**——
//   拆段需求经 idParts 公开端口（域标签路由用）。纯函数零存储（SPEC-046 I7：ID 是现场计算的
//   身份函数，不落库不缓存为权威）。Python 侧同构轻量版 scripts/vault-runtime/identity_port.py
//   （extract_graph 合并键消费——跨语言字节长度一致）。
// @inputs: domain（ASCII 域标签）＋ parts（任意字符串段；null/undefined 归一为空串）
// @outputs: makeId(domain, …parts) / idParts(id) / sameId(a,b)
// @context: 进程内/管线内（不外泄 OpenAPI；不持久化为权威——I4 兼容：进程内比对语义等价）
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DOMAIN_RE = /^[a-z][a-z0-9_-]{0,31}$/;

function byteLen(s) {
  return Buffer.byteLength(s, 'utf8');
}

/** 段归一：null/undefined→空串；非串强转（数字行号等）。 */
function partText(part) {
  if (part === null || part === undefined) return '';
  return String(part);
}

/**
 * 构造不透明 ID：`{domain}:{len1}:{part1}|{len2}:{part2}…`（len＝UTF-8 字节数）。
 * 例：makeId('edge', 'a|b', 'c') → 'edge:3:a|b|1:c'——长度前缀使解析器按字节精确取段，
 * 内容含分隔符不再歧义（P2 病根的结构消灭）。
 */
function makeId(domain, parts) {
  if (typeof domain !== 'string' || !DOMAIN_RE.test(domain)) {
    throw new TypeError(`identity-port.makeId: domain 必须是 ASCII 标签（/^${DOMAIN_RE.source}/），实得 ${JSON.stringify(domain)}`);
  }
  if (!Array.isArray(parts)) {
    throw new TypeError('identity-port.makeId: parts 必须是数组（复合身份各段）');
  }
  const chunks = [];
  for (const part of parts) {
    const text = partText(part);
    chunks.push(`${byteLen(text)}:${text}`);
  }
  return `${domain}:${chunks.join('|')}`;
}

/** 按字节数取段（UTF-16 串上按 UTF-8 字节行走——跨语言一致）；返回 { text, rest }。 */
function takeBytes(s, byteCount) {
  let bytes = 0;
  let i = 0;
  while (i < s.length && bytes < byteCount) {
    const cp = s.codePointAt(i);
    const size = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (bytes + size > byteCount) {
      throw new Error(`identity-port.idParts: ID 段字节长度错位（期望 ${byteCount}，第 ${bytes + size} 字节处截断）——ID 已损坏或不合法`);
    }
    bytes += size;
    i += cp > 0xffff ? 2 : 1;
  }
  if (bytes !== byteCount) {
    throw new Error(`identity-port.idParts: ID 段不足（期望 ${byteCount} 字节，实得 ${bytes}）——ID 已损坏或不合法`);
  }
  return { text: s.slice(0, i), rest: s.slice(i) };
}

/**
 * 解析不透明 ID → { domain, parts }（公开端口——消费方拆段唯一通道，禁自行 split）。
 * 损坏 ID（长度错位/缺分隔/域标签非法）显式抛错（fail-closed，不静默给错段）。
 */
function idParts(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('identity-port.idParts: id 必须是非空字符串');
  }
  const colonIdx = id.indexOf(':');
  if (colonIdx < 1) {
    throw new Error('identity-port.idParts: 缺域标签分隔（domain: 前缀）——ID 不合法');
  }
  const domain = id.slice(0, colonIdx);
  if (!DOMAIN_RE.test(domain)) {
    throw new Error(`identity-port.idParts: 域标签非法 '${domain}'（须 /^${DOMAIN_RE.source}/）`);
  }
  let rest = id.slice(colonIdx + 1);
  const parts = [];
  while (rest.length > 0) {
    const match = /^(\d+):/.exec(rest);
    if (!match) {
      throw new Error('identity-port.idParts: 段长度前缀缺失（len:content 形态）——ID 不合法');
    }
    rest = rest.slice(match[0].length);
    const taken = takeBytes(rest, Number(match[1]));
    parts.push(taken.text);
    rest = taken.rest;
    if (rest.length > 0) {
      if (rest[0] !== '|') {
        throw new Error('identity-port.idParts: 段间分隔符错位——ID 不合法');
      }
      rest = rest.slice(1);
    }
  }
  return { domain, parts };
}

/** ID 等值（不透明比较——消费方唯一合法的比较方式；与 === 等价，语义自证用）。 */
function sameId(a, b) {
  return a === b;
}

module.exports = { makeId, idParts, sameId };
