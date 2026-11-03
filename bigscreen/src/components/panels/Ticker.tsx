import { dataProvider } from "@/lib/dataProvider";
import { usePanelData } from "@/hooks/usePanelData";
import PanelShell from "@/components/PanelShell";
import styles from "@/styles/board.module.css";
import type { PanelProps } from "./MetricCards";

/** Vertically scrolling record list (原型底部滚动列表). */
export default function Ticker({ item, screen, vars }: PanelProps) {
  const state = usePanelData(
    () => dataProvider.loadTicker(screen, item.source ?? "", vars),
    [screen, item.source, vars.view, vars.regionId],
  );

  return (
    <PanelShell title={item.title ?? "滚动"}>
      {state.error ? <div className={styles.error}>{state.error}</div> : null}
      {state.data ? (
        <div className={styles.recordList}>
          <div className={styles.recordTrack}>
            {[0, 1].map((pass) =>
              state.data!.items.map((text, index) => (
                <div
                  key={`${pass}-${index}`}
                  className={styles.recordRow}
                  aria-hidden={pass === 1}
                >
                  <span className={styles.recordDot} />
                  <span className={styles.recordText}>{text}</span>
                </div>
              )),
            )}
          </div>
        </div>
      ) : null}
    </PanelShell>
  );
}
