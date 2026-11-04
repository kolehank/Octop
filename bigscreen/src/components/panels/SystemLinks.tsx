import { useState } from "react";
import { dataProvider } from "@/lib/dataProvider";
import { usePanelData } from "@/hooks/usePanelData";
import PanelShell from "@/components/PanelShell";
import SystemIcon from "@/components/SystemIcon";
import styles from "@/styles/board.module.css";
import type { PanelProps } from "./MetricCards";

/** Business system entries with round icons (原型右列 business-list). */
export default function SystemLinks({ item, screen, vars }: PanelProps) {
  const state = usePanelData(
    () => dataProvider.loadSystems(screen, item.source ?? "", vars),
    [screen, item.source, vars.view, vars.regionId],
  );
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const groups = state.data?.groups ?? [];
  const active = groups.find((group) => group.id === activeGroup) ?? groups[0];

  return (
    <PanelShell
      title={item.title}
      tabs={
        groups.length > 1
          ? groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={`${styles.titleTab} ${
                  group.id === active?.id ? styles.titleTabActive : ""
                }`}
                onClick={() => setActiveGroup(group.id)}
              >
                {group.label}
              </button>
            ))
          : null
      }
    >
      {state.loading ? <div className={styles.muted}>加载中…</div> : null}
      {state.error ? <div className={styles.error}>{state.error}</div> : null}
      {active ? (
        <div className={styles.businessList}>
          {active.items.map((entry) => (
            <div key={entry.name} className={styles.businessItem}>
              <span className={styles.businessIcon} aria-hidden>
                <SystemIcon
                  name={entry.icon}
                  fallback={entry.name.slice(0, 1)}
                />
              </span>
              <span className={styles.businessName}>{entry.name}</span>
              <span className={styles.systemStatus} data-status={entry.status}>
                {entry.status ?? ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </PanelShell>
  );
}
