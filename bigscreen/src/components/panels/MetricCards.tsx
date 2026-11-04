import type { BoardItem } from "@/lib/types";
import { dataProvider } from "@/lib/dataProvider";
import { usePanelData } from "@/hooks/usePanelData";
import PanelShell from "@/components/PanelShell";
import styles from "@/styles/board.module.css";

export interface PanelProps {
  item: BoardItem;
  screen: string;
  vars: Record<string, string>;
}

/** Metric row list (原型左列：名称 + 数值 + 对比说明). */
export default function MetricCards({ item, screen, vars }: PanelProps) {
  const state = usePanelData(
    () => dataProvider.loadMetrics(screen, item.source ?? "", vars),
    [screen, item.source, vars.view, vars.regionId],
  );

  return (
    <PanelShell title={item.title}>
      {state.loading ? <div className={styles.muted}>加载中…</div> : null}
      {state.error ? <div className={styles.error}>{state.error}</div> : null}
      {state.data ? (
        <div className={styles.metricRows}>
          {state.data.items.map((metric, index) => (
            <div
              key={metric.label}
              className={styles.metricRow}
              data-alt={index % 2 === 1}
            >
              <span className={styles.metricName}>{metric.label}</span>
              <span className={styles.metricValues}>
                <strong>{metric.value}</strong>
                {metric.unit ? <small>{metric.unit}</small> : null}
              </span>
              {metric.note ? (
                <span className={styles.metricNote}>{metric.note}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </PanelShell>
  );
}
