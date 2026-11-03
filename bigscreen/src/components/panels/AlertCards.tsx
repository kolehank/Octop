import { dataProvider } from "@/lib/dataProvider";
import { usePanelData } from "@/hooks/usePanelData";
import PanelShell from "@/components/PanelShell";
import styles from "@/styles/board.module.css";
import type { PanelProps } from "./MetricCards";

export default function AlertCards({ item, screen, vars }: PanelProps) {
  const state = usePanelData(
    () => dataProvider.loadAlerts(screen, item.source ?? "", vars),
    [screen, item.source, vars.view, vars.regionId],
  );

  return (
    <PanelShell title={item.title}>
      {state.loading ? <div className={styles.muted}>加载中…</div> : null}
      {state.error ? <div className={styles.error}>{state.error}</div> : null}
      {state.data ? (
        <div className={styles.alertList}>
          {state.data.items.map((alert) => (
            <div
              key={alert.title}
              className={styles.alertItem}
              data-level={alert.level}
            >
              <span className={styles.alertTitle}>{alert.title}</span>
              {alert.detail ? (
                <span className={styles.alertDetail}>{alert.detail}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </PanelShell>
  );
}
