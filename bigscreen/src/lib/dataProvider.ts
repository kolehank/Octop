/**
 * Runtime data access for the big screen.
 *
 * All board content lives in bigscreen/public/data/<screen>/ and is fetched at
 * runtime (never bundled), so editing a JSON file does not touch UI code.
 * Swap this module when real systems take over.
 */

import type {
  AlertsData,
  AnalysisData,
  ChatContextData,
  DimensionsData,
  MetricsData,
  RegionsData,
  SystemsData,
  TickerData,
  TopicConfig,
  TopicsIndex,
  TopicSummary,
} from "./types";
import {
  assertAlertsData,
  assertAnalysisData,
  assertChatContextData,
  assertDimensionsData,
  assertMetricsData,
  assertRegionsData,
  assertSystemsData,
  assertTickerData,
} from "./validate";

const DATA_ROOT = "/screen/data";

class DataNotFoundError extends Error {}

/** Replace "{view}" and ":param" placeholders in a configured source path. */
export function resolveSource(
  source: string,
  vars: Record<string, string>,
): string {
  let resolved = source.replaceAll("{view}", vars.view ?? "overview");
  for (const [key, value] of Object.entries(vars)) {
    resolved = resolved.replaceAll(`:${key}`, value);
  }
  return resolved;
}

function dataUrl(screen: string, source: string): string {
  return `${DATA_ROOT}/${screen}/${source.replace(/^\/+/, "")}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-cache" });
  if (response.status === 404) throw new DataNotFoundError(url);
  if (!response.ok) {
    throw new Error(`数据加载失败（${response.status}）：${url}`);
  }
  // Dev servers may answer a missing JSON path with the SPA shell. Treat a
  // non-JSON body as "missing" so {view} fallback still works.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new DataNotFoundError(url);
  }
  return response.json() as Promise<unknown>;
}

/**
 * Load and validate a data file.
 *
 * Sources containing "{view}" fall back to the topic's overview view when the
 * topic-specific file does not exist yet, so new views only override what they
 * need. Validation errors never fall back — corrupt data must surface.
 */
async function load<T>(
  screen: string,
  source: string,
  vars: Record<string, string>,
  validate: (value: unknown, where: string) => void,
): Promise<T> {
  const resolved = resolveSource(source, vars);
  const candidates = [resolved];
  if (source.includes("{view}") && (vars.view ?? "overview") !== "overview") {
    candidates.push(resolveSource(source, { ...vars, view: "overview" }));
  }

  for (const candidate of candidates) {
    const url = dataUrl(screen, candidate);
    try {
      const value = await fetchJson(url);
      validate(value, url);
      return value as T;
    } catch (error) {
      if (!(error instanceof DataNotFoundError)) throw error;
    }
  }
  throw new Error(`数据文件不存在：${dataUrl(screen, resolved)}`);
}

export const dataProvider = {
  listTopics: async (screen: string): Promise<TopicSummary[]> => {
    const index = (await fetchJson(
      dataUrl(screen, "topics.json"),
    )) as TopicsIndex;
    if (!index || !Array.isArray(index.topics)) {
      throw new Error("topics.json 格式错误：需要 { topics: { id, title }[] }");
    }
    return index.topics;
  },

  loadTopic: (screen: string, topicId: string): Promise<TopicConfig> =>
    fetchJson(
      dataUrl(screen, `topics/${topicId}.json`),
    ) as Promise<TopicConfig>,

  loadMetrics: (screen: string, source: string, vars: Record<string, string>) =>
    load<MetricsData>(screen, source, vars, assertMetricsData),

  loadAlerts: (screen: string, source: string, vars: Record<string, string>) =>
    load<AlertsData>(screen, source, vars, assertAlertsData),

  loadTicker: (screen: string, source: string, vars: Record<string, string>) =>
    load<TickerData>(screen, source, vars, assertTickerData),

  loadSystems: (screen: string, source: string, vars: Record<string, string>) =>
    load<SystemsData>(screen, source, vars, assertSystemsData),

  loadRegions: (screen: string, source: string, vars: Record<string, string>) =>
    load<RegionsData>(screen, source, vars, assertRegionsData),

  loadDimensions: (
    screen: string,
    source: string,
    vars: Record<string, string>,
  ) => load<DimensionsData>(screen, source, vars, assertDimensionsData),

  loadAnalysis: (
    screen: string,
    source: string,
    vars: Record<string, string>,
  ) => load<AnalysisData>(screen, source, vars, assertAnalysisData),

  loadChatContext: (
    screen: string,
    source: string,
    vars: Record<string, string>,
  ) => load<ChatContextData>(screen, source, vars, assertChatContextData),
};
