import type { BoardItem, TopicView } from "@/lib/types";
import MetricCards from "./MetricCards";
import AlertCards from "./AlertCards";
import Ticker from "./Ticker";
import SystemLinks from "./SystemLinks";
import RegionList from "./RegionList";
import ViewNav from "./ViewNav";
import AnalysisCard from "./AnalysisCard";

interface PanelHostProps {
  item: BoardItem;
  screen: string;
  vars: Record<string, string>;
  views?: TopicView[];
  activeView?: string;
  onViewChange?: (view: string) => void;
  onRegionSelect?: (dimension: string, itemId: string) => void;
}

/** Renders one configured board item; unknown types render nothing. */
export default function PanelHost({
  item,
  screen,
  vars,
  views,
  activeView,
  onViewChange,
  onRegionSelect,
}: PanelHostProps) {
  const props = { item, screen, vars };

  switch (item.type) {
    case "view-nav":
      return views && onViewChange ? (
        <ViewNav
          views={views}
          activeView={activeView ?? views[0]?.id ?? "overview"}
          onChange={onViewChange}
        />
      ) : null;
    case "region-list":
      return <RegionList {...props} onRegionSelect={onRegionSelect} />;
    case "metric-cards":
      return <MetricCards {...props} />;
    case "alert-cards":
      return <AlertCards {...props} />;
    case "ticker":
      return <Ticker {...props} />;
    case "system-links":
      return <SystemLinks {...props} />;
    case "analysis-card":
      return <AnalysisCard {...props} />;
    default:
      return null;
  }
}
