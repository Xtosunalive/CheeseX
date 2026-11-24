import { CLASS_MANAGEMENT_MAP, INDIVIDUALS_COPY } from "../individuals-copy";

type ClassManagementMapProps = {
  groups: typeof CLASS_MANAGEMENT_MAP;
};

export function ClassManagementMap({ groups }: ClassManagementMapProps) {
  return (
    <details className="rounded-lg bg-surface-root ring-1 ring-border-thin">
      <summary className="cursor-pointer select-none px-3 py-2 text-kg-xs text-text-hint">{INDIVIDUALS_COPY.MAP_SUMMARY}</summary>
      <div className="space-y-3 px-3 pb-3">
        {groups.map((group) => (
          <div key={group.family}>
            <p className="text-xs font-medium text-text-main">{group.family}</p>
            {group.rows.map((row) => (
              <p key={row.cls} className="mt-1 text-kg-xs leading-5 text-text-hint">
                <span className="font-medium text-text-main">{row.cls}</span>：{row.surface}（{row.channel}）
              </p>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
