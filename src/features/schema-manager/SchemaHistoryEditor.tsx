import { useEffect, useState } from "react";
import { HISTORY_COPY } from "./schema-manager-copy";
import { History } from "lucide-react";
import { fetchSchemaHistory, type SchemaSnapshot } from "./schema-manager-api";
import { rollbackEnums } from "./schema-write-api";
import { useSchemaManagerStore } from "./schema-manager-store";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";

// SchemaHistoryEditor — Schema 版本快照（SCHEMA-IA-001 批6：自研行列表 → DataTable 语义表；
// 回滚动作 RowActions 化，git 即账语义与回滚即写点行为原样保留；测试面零耦合已核实）。
export function SchemaHistoryEditor({ disabled }: { disabled: boolean }) {
  const store = useSchemaManagerStore();
  const [items, setItems] = useState<SchemaSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setItems(await fetchSchemaHistory()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : HISTORY_COPY.READ_FAILED); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const restoreInProposal = async (snapshot: SchemaSnapshot) => {
    if (!store.enums?.revision) return;
    setWorking(snapshot.id);
    try {
      await rollbackEnums(store.enums.revision, snapshot.id);
      await store.load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : HISTORY_COPY.ROLLBACK_FAILED);
    } finally {
      setWorking(null);
    }
  };

  type SnapshotRow = SchemaSnapshot & { __working: string | null };
  const columns: Array<Column<SnapshotRow>> = [
    {
      key: "generatedAt",
      title: HISTORY_COPY.COL_TIME,
      width: 190,
      render: (row) => (
        <span className="flex items-center gap-2">
          <History className="h-4 w-4 text-text-hint" aria-hidden />
          <span className="text-sm text-text-main">{new Date(row.generatedAt).toLocaleString()}</span>
        </span>
      ),
    },
    { key: "revision", title: HISTORY_COPY.COL_REVISION, render: (row) => <span className="truncate font-mono text-xs text-text-hint">{row.revision}</span> },
    {
      key: "row-actions",
      title: "",
      width: 96,
      render: (row) => (
        <button
          type="button"
          disabled={disabled || Boolean(row.__working)}
          title={HISTORY_COPY.ROLLBACK_TITLE}
          onClick={() => void restoreInProposal(row)}
          className="rounded-md px-2.5 py-1.5 text-xs ring-1 ring-border-thin hover:bg-surface-hover disabled:opacity-40"
        >
          {row.__working === row.id ? HISTORY_COPY.ROLLBACK_BUSY : HISTORY_COPY.ROLLBACK_ACTION}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <section aria-label={HISTORY_COPY.SECTION_ARIA} className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-text-main">{HISTORY_COPY.HEADER}</h3>
          <p className="mt-1 text-xs text-text-hint">{HISTORY_COPY.INTRO}</p>
        </div>
        {error && <p className="text-xs text-status-error">{error}</p>}
        <DataTable
          ariaLabel={HISTORY_COPY.TABLE_ARIA}
          columns={columns}
          rows={items.map((item) => ({ ...item, __working: working }))}
          rowKey={(row) => row.id}
          density="sm"
          loading={loading}
          empty={{ title: HISTORY_COPY.EMPTY }}
        />
      </section>
    </div>
  );
}
