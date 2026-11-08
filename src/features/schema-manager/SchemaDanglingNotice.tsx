// SchemaDanglingNotice —— 悬空引用警示条（SCHEMA-IA-001 批2）：danglingForTab 一行取数的消费面。
// 纯呈现不拦截（执法在写网关，与"前端现算、后端执法"分层一致）；零悬空/数据未就绪时不渲染
// （能改变才渲染——OpenMAIC shape 层同款规则的最小落地）。
import { danglingForTab, type SchemaTopology } from "@/lib/schema-shape";
import type { TabId } from "./schema-manager-types";
import { KIND_LABELS } from "./dangling-kind-labels";
import { DANGLING_NOTICE_COPY } from "./schema-manager-copy";

export function SchemaDanglingNotice({ tab, topology }: { tab: TabId; topology: SchemaTopology | null }) {
  const items = topology ? danglingForTab(tab, topology) : [];
  if (items.length === 0) return null;
  return (
    <div
      data-testid="schema-dangling-notice"
      className="mb-3 rounded-md bg-status-warn-2 p-3 text-xs leading-5 text-status-warn ring-1 ring-status-warn-6"
    >
      <p className="font-medium">
        {DANGLING_NOTICE_COPY.BANNER(items.length)}
      </p>
      <ul className="mt-1 space-y-0.5 text-status-warn-11">
        {items.map((ref) => (
          <li key={`${ref.kind}:${ref.from}:${ref.to}`}>
            <code className="font-mono">{ref.from}</code> → {ref.to}（{KIND_LABELS[ref.kind]}）
          </li>
        ))}
      </ul>
    </div>
  );
}
