import { dataProvider } from "@/lib/dataProvider";
import { usePanelData } from "@/hooks/usePanelData";
import styles from "@/styles/board.module.css";
import type { PanelProps } from "./MetricCards";

/** Highlight card (原型右列渐变数据卡). */
export default function AnalysisCard({ item, screen, vars }: PanelProps) {
  const state = usePanelData(
    () => dataProvider.loadAnalysis(screen, item.source ?? "", vars),
    [screen, item.source, vars.view, vars.regionId],
  );

  if (state.loading) {
    return <div className={styles.analysisCard}>加载中…</div>;
  }
  if (state.error) {
    return <div className={styles.analysisCard}>{state.error}</div>;
  }
  if (!state.data) return null;

  return (
    <div className={styles.analysisCard}>
      <h2>{item.title ?? state.data.title}</h2>
      {state.data.stats ? (
        <div className={styles.analysisStats}>
          {state.data.stats.map((stat) => (
            <div key={stat.label} className={styles.analysisStat}>
              <span className={styles.analysisStatLabel}>{stat.label}</span>
              <span className={styles.analysisStatValue}>{stat.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {state.data.note ? (
        <p className={styles.analysisNote}>{state.data.note}</p>
      ) : null}
    </div>
  );
}
