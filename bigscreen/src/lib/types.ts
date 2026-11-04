/** Big-screen configuration and data models (see docs/adr/003-bigscreen-integration.md). */

export type PanelType =
  | "view-nav"
  | "region-list"
  | "metric-cards"
  | "alert-cards"
  | "ticker"
  | "system-links"
  | "analysis-card";

export interface BoardItem {
  type: PanelType;
  /** Data path relative to /screen/data/<screen>/. Supports "{view}". */
  source?: string;
  title?: string;
}

export interface TopicView {
  id: string;
  label: string;
}

export interface TopicLayout {
  left?: BoardItem[];
  right?: BoardItem[];
  bottom?: BoardItem[];
}

export interface QuickPrompt {
  label: string;
  prompt: string;
}

export interface QuickGroup {
  title: string;
  prompts: QuickPrompt[];
}

export interface ChatOptions {
  skills?: string[];
  mcpServers?: string[];
  knowledgeBaseIds?: string[];
  conversationMode?: "ask" | "plan" | "craft";
}

export interface ChatConfig {
  /** Expert agent id that owns this conversation. */
  agentId: string;
  /** Welcome line under the robot, e.g. 「您好！我是演示助手…」. */
  welcome?: string;
  /** Workspace subagent slug routed via an automatic @mention. */
  subagent?: string;
  title?: string;
  subtitle?: string;
  quickPrompts?: QuickPrompt[];
  /** Grouped quick prompts (原型的两列推荐问题卡). */
  quickGroups?: QuickGroup[];
  chatOptions?: ChatOptions;
  /** "nav" (default) injects a page-navigation line; "off" disables it. */
  contextInjection?: "nav" | "off";
}

export interface FloatChatConfig {
  enabled?: boolean;
  title?: string;
  subtitle?: string;
  quickPrompts?: QuickPrompt[];
  contextInjection?: "nav" | "off";
}

export interface DrilldownConfig {
  /** Dimension this drill-down belongs to: "region" (default) or "department". */
  dimension?: string;
  /** id -> route target, e.g. region id -> /demo/:topic/region/:id. */
  route: string;
  title?: string;
  source?: string;
  layout?: TopicLayout;
  chat?: ChatConfig;
  /** When enabled, this page uses the floating widget instead of the board chat. */
  floatChat?: FloatChatConfig;
}

export interface TopicConfig {
  id: string;
  title: string;
  subtitle?: string;
  views?: TopicView[];
  layout: TopicLayout;
  chat: ChatConfig;
  drilldown?: DrilldownConfig[];
  floatChat?: FloatChatConfig;
}

export interface TopicSummary {
  id: string;
  title: string;
}

export interface TopicsIndex {
  topics: TopicSummary[];
}

// ── Panel data models ───────────────────────────────────────────────────────

export interface MetricsData {
  items: Array<{
    label: string;
    value: string;
    unit?: string;
    note?: string;
    trend?: "up" | "down";
  }>;
}

export interface AlertItem {
  level: "warning" | "danger";
  title: string;
  detail?: string;
}

export interface AlertsData {
  items: AlertItem[];
}

export interface TickerData {
  items: string[];
}

export interface SystemsData {
  groups: Array<{
    id: string;
    label: string;
    items: Array<{
      name: string;
      url?: string;
      status?: string;
      icon?: string;
    }>;
  }>;
}

export interface RegionsData {
  items: Array<{ id: string; name: string; route?: string }>;
}

/** Multi-dimension filter groups (区块 / 部门 tabs). */
export interface DimensionItem {
  id: string;
  name: string;
}

export interface DimensionGroup {
  id: string;
  label: string;
  items: DimensionItem[];
}

export interface DimensionsData {
  dimensions: DimensionGroup[];
}

export interface AnalysisData {
  title: string;
  stats?: Array<{ label: string; value: string }>;
  note?: string;
}

/** Context card shown at the top of the float chat (e.g. 原因归因/数据范围). */
export interface ChatContextData {
  title?: string;
  range?: string;
  basis?: string;
  bullets?: Array<{ label: string; text: string }>;
}
