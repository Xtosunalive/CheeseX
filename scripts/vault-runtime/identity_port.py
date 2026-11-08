#!/usr/bin/env python3
"""身份入口 Python 同构轻量版（WP-051 I-A／SPEC-046——ADR-016 §二律文）。

与 server/shared/identity-port.cjs 字节级同构（段长度＝UTF-8 字节数——跨语言一致；
编码/解析规则一字不差对齐，extract_graph 合并键消费）。纯函数零依赖。
"""


def make_id(domain, parts):
    """构造不透明 ID：``{domain}:{len1}:{part1}|{len2}:{part2}…``（len＝UTF-8 字节数）。"""
    if not isinstance(domain, str) or not domain:
        raise ValueError("identity_port.make_id: domain 必须是非空字符串")
    chunks = []
    for part in parts:
        text = "" if part is None else str(part)
        chunks.append(f"{len(text.encode('utf-8'))}:{text}")
    return f"{domain}:" + "|".join(chunks)


def _take_bytes(s, byte_count):
    raw = s.encode("utf-8")
    if len(raw) < byte_count:
        raise ValueError(f"identity_port.id_parts: ID 段不足（期望 {byte_count} 字节）")
    return raw[:byte_count].decode("utf-8"), s.encode("utf-8")[byte_count:].decode("utf-8")


def id_parts(identifier):
    """解析不透明 ID → (domain, parts)（公开端口——拆段唯一通道，禁自行 split）。"""
    if not isinstance(identifier, str) or not identifier:
        raise ValueError("identity_port.id_parts: id 必须是非空字符串")
    colon = identifier.find(":")
    if colon < 1:
        raise ValueError("identity_port.id_parts: 缺域标签分隔")
    domain = identifier[:colon]
    rest = identifier[colon + 1:]
    parts = []
    while rest:
        # 读长度前缀（数字到下一个冒号）
        end = rest.find(":")
        if end < 1 or not rest[:end].isdigit():
            raise ValueError("identity_port.id_parts: 段长度前缀缺失")
        byte_count = int(rest[:end])
        rest = rest[end + 1:]
        text, rest = _take_bytes(rest, byte_count)
        parts.append(text)
        if rest:
            if rest[0] != "|":
                raise ValueError("identity_port.id_parts: 段间分隔符错位")
            rest = rest[1:]
    return domain, parts
