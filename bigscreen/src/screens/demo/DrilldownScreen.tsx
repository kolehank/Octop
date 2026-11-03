import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Board from "@/components/Board";
import ChatPanel from "@/components/ChatPanel";
import FloatChat from "@/components/FloatChat";
import PanelHost from "@/components/panels/PanelHost";
import { dataProvider } from "@/lib/dataProvider";
import { screenKeyFor } from "@/lib/screenKey";
import type { TopicConfig } from "@/lib/types";
import styles from "@/styles/board.module.css";

/**
 * Dimension drill-down page (区块 / 部门, 二级/三级展示界面). Picks the
 * topic's matching `drilldown` entry by route dimension.
 */
export default function DrilldownScreen() {
  const {
    topicId = "overview",
    dimension = "region",
    itemId,
    regionId,
  } = useParams();
  const target = itemId ?? regionId ?? "";
  const navigate = useNavigate();
  const location = useLocation();
  const [topic, setTopic] = useState<TopicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [itemName, setItemName] = useState("");
  const [bottomCollapsed, setBottomCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTopic(null);
    setError(null);
    dataProvider
      .loadTopic("demo", topicId)
      .then((config) => {
        if (!cancelled) setTopic(config);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : String(loadError),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [topicId]);

  // Resolve the clicked item's display name from the filter dimensions data.
  useEffect(() => {
    if (!topic) return;
    let cancelled = false;
    setItemName(target);
    const items = [...(topic.layout.left ?? []), ...(topic.layout.right ?? [])];
    const filter = items.find((entry) => entry.type === "region-list");
    if (!filter?.source) return;
    dataProvider
      .loadDimensions("demo", filter.source, { view: "overview" })
      .then((data) => {
        const group = data.dimensions.find((entry) => entry.id === dimension);
        const found = group?.items.find((entry) => entry.id === target);
        if (!cancelled) setItemName(found?.name ?? target);
      })
      .catch(() => {
        if (!cancelled) setItemName(target);
      });
    return () => {
      cancelled = true;
    };
  }, [topic, dimension, target]);

  if (error) {
    return (
      <Board>
        <div className={styles.error} style={{ margin: "auto" }}>
          {error}
        </div>
      </Board>
    );
  }

  const drilldown =
    topic?.drilldown?.find(
      (entry) => (entry.dimension ?? "region") === dimension,
    ) ?? topic?.drilldown?.[0];
  if (!topic || !drilldown) {
    return (
      <Board>
        <div className={styles.muted} style={{ margin: "auto" }}>
          加载中…
        </div>
      </Board>
    );
  }

  const layout = drilldown.layout ?? {};
  const vars = {
    view: "overview",
    regionId: target,
    itemId: target,
    dimension,
  };
  const panelProps = { screen: "demo", vars };
  const pageLabel = `${topic.title}/${drilldown.title ?? "详情"}·${
    itemName || target
  }`;
  const floatEnabled = drilldown.floatChat?.enabled ?? false;
  const bottom = layout.bottom ?? [];

  return (
    <Board>
      <header className={styles.titleBar}>
        <button
          type="button"
          className={styles.backButton}
          onClick={() => navigate(`/demo/${topicId}`)}
        >
          ‹ 返回
        </button>
        <div className={styles.titleWrap}>
          <div className={`${styles.titleWing} ${styles.titleWingLeft}`} />
          <div className={`${styles.titleWing} ${styles.titleWingRight}`} />
          <div className={styles.titleBanner}>
            <div className={styles.titleMain}>
              {drilldown.title ?? topic.title}
            </div>
          </div>
        </div>
        <div className={styles.titleSub}>
          {dimension === "department" ? "部门" : "区块"} · {itemName || target}
        </div>
      </header>

      <main className={styles.body}>
        <div className={styles.column}>
          {(layout.left ?? []).map((item, index) => (
            <PanelHost key={`left-${index}`} item={item} {...panelProps} />
          ))}
        </div>
        <div className={styles.centerColumn}>
          {floatEnabled ? (
            <div className={styles.floatPlaceholder}>
              <p>
                点击右下角「{drilldown.floatChat?.title ?? "助手"}
                」开始对话
              </p>
            </div>
          ) : (
            <ChatPanel
              screenKey={screenKeyFor(location.pathname)}
              pageLabel={pageLabel}
              config={drilldown.chat ?? topic.chat}
            />
          )}
          {bottom.length > 0 ? (
            <section
              className={styles.bottomPanels}
              data-collapsed={bottomCollapsed}
            >
              {!bottomCollapsed
                ? bottom.map((item, index) => (
                    <PanelHost
                      key={`bottom-${index}`}
                      item={item}
                      {...panelProps}
                    />
                  ))
                : null}
              <button
                type="button"
                className={styles.collapseToggle}
                aria-label={bottomCollapsed ? "展开底部面板" : "收起底部面板"}
                aria-expanded={!bottomCollapsed}
                onClick={() => setBottomCollapsed((prev) => !prev)}
              >
                <ChevronIcon />
              </button>
            </section>
          ) : null}
        </div>
        <div className={styles.column}>
          {(layout.right ?? []).map((item, index) => (
            <PanelHost key={`right-${index}`} item={item} {...panelProps} />
          ))}
        </div>
      </main>

      {floatEnabled ? (
        <FloatChat
          chatConfig={drilldown.chat ?? topic.chat}
          float={drilldown.floatChat}
          screenKey={screenKeyFor(location.pathname)}
          pageLabel={pageLabel}
        />
      ) : null}
    </Board>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="m6 9 6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
