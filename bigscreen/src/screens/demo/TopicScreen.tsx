import { useEffect, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import Board from "@/components/Board";
import ChatPanel from "@/components/ChatPanel";
import PanelHost from "@/components/panels/PanelHost";
import { dataProvider } from "@/lib/dataProvider";
import { screenKeyFor } from "@/lib/screenKey";
import type { TopicConfig, TopicSummary } from "@/lib/types";
import styles from "@/styles/board.module.css";

/**
 * One big-screen topic (总览 / 招商引资 / …). Layout and content come from
 * public/data/demo/topics/<id>.json — this component is topic-agnostic.
 */
export default function TopicScreen({
  topicId: fixedTopicId,
}: {
  topicId?: string;
}) {
  const params = useParams();
  const topicId = fixedTopicId ?? params.topicId ?? "overview";
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [topic, setTopic] = useState<TopicConfig | null>(null);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTopic(null);
    setError(null);
    Promise.all([
      dataProvider.loadTopic("demo", topicId),
      dataProvider.listTopics("demo"),
    ])
      .then(([config, list]) => {
        if (!cancelled) {
          setTopic(config);
          setTopics(list);
        }
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

  const views = topic?.views ?? [];
  const activeView = searchParams.get("view") ?? views[0]?.id ?? "overview";
  const viewLabel = views.find((view) => view.id === activeView)?.label;
  const vars = { view: activeView };
  const bottom = topic?.layout.bottom ?? [];
  const [bottomCollapsed, setBottomCollapsed] = useState(false);

  const changeView = (view: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("view", view);
        return next;
      },
      { replace: true },
    );
  };

  if (error) {
    return (
      <Board>
        <div className={styles.error} style={{ margin: "auto" }}>
          {error}
        </div>
      </Board>
    );
  }

  if (!topic) {
    return (
      <Board>
        <div className={styles.muted} style={{ margin: "auto" }}>
          加载中…
        </div>
      </Board>
    );
  }

  const panelProps = {
    screen: "demo",
    vars,
    views,
    activeView,
    onViewChange: changeView,
    onRegionSelect: (dimension: string, itemId: string) =>
      navigate(`/demo/${topicId}/${dimension}/${itemId}`),
  };

  return (
    <Board>
      <header className={styles.titleBar}>
        <div className={styles.topicNav}>
          {topics.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`${styles.topicButton} ${
                entry.id === topicId ? styles.topicButtonActive : ""
              }`}
              onClick={() =>
                navigate(entry.id === "overview" ? "/demo/" : `/demo/${entry.id}`)
              }
            >
              {entry.title}
            </button>
          ))}
        </div>
        <div className={styles.titleWrap}>
          <div className={`${styles.titleWing} ${styles.titleWingLeft}`} />
          <div className={`${styles.titleWing} ${styles.titleWingRight}`} />
          <div className={styles.titleBanner}>
            <div className={styles.titleMain}>{topic.title}</div>
          </div>
        </div>
        {topic.subtitle ? (
          <div className={styles.titleSub}>{topic.subtitle}</div>
        ) : null}
      </header>

      <main className={styles.body}>
        <div className={styles.column}>
          {(topic.layout.left ?? []).map((item, index) => (
            <PanelHost key={`left-${index}`} item={item} {...panelProps} />
          ))}
        </div>
        <div className={styles.centerColumn}>
          <ChatPanel
            screenKey={screenKeyFor(location.pathname)}
            pageLabel={viewLabel ? `${topic.title}/${viewLabel}` : topic.title}
            config={topic.chat}
          />
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
          {(topic.layout.right ?? []).map((item, index) => (
            <PanelHost key={`right-${index}`} item={item} {...panelProps} />
          ))}
        </div>
      </main>
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
