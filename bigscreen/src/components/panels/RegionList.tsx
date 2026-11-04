import { useEffect, useState } from "react";
import { dataProvider } from "@/lib/dataProvider";
import { usePanelData } from "@/hooks/usePanelData";
import PanelShell from "@/components/PanelShell";
import styles from "@/styles/board.module.css";
import type { PanelProps } from "./MetricCards";

/**
 * Region/department filter (D8): dimension tabs (区块 / 部门) with clickable
 * items that drill into the matching dimension page.
 */
export default function RegionList({
  item,
  screen,
  vars,
  onRegionSelect,
}: PanelProps & {
  onRegionSelect?: (dimension: string, itemId: string) => void;
}) {
  const state = usePanelData(
    () => dataProvider.loadDimensions(screen, item.source ?? "", vars),
    [screen, item.source, vars.view, vars.regionId],
  );
  const [activeDimension, setActiveDimension] = useState<string | null>(
    vars.dimension ?? null,
  );

  const dimensions = state.data?.dimensions ?? [];
  const active =
    dimensions.find((dimension) => dimension.id === activeDimension) ??
    dimensions[0];

  useEffect(() => {
    setActiveDimension(vars.dimension ?? null);
  }, [item.source, vars.dimension]);

  return (
    <PanelShell
      title={item.title ?? "区块"}
      tabs={
        dimensions.length > 1
          ? dimensions.map((dimension) => (
              <button
                key={dimension.id}
                type="button"
                className={`${styles.titleTab} ${
                  dimension.id === active?.id ? styles.titleTabActive : ""
                }`}
                onClick={() => setActiveDimension(dimension.id)}
              >
                {dimension.label}
              </button>
            ))
          : null
      }
    >
      {state.loading ? <div className={styles.muted}>加载中…</div> : null}
      {state.error ? <div className={styles.error}>{state.error}</div> : null}
      {active ? (
        <div className={styles.towns}>
          {active.items.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={styles.town}
              onClick={() => onRegionSelect?.(active.id, entry.id)}
            >
              {entry.name}
              <span>»</span>
            </button>
          ))}
        </div>
      ) : null}
    </PanelShell>
  );
}
