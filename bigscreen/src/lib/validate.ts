/**
 * Minimal runtime guards for JSON loaded from public/data. Keeps a corrupt or
 * partially edited data file from rendering a blank/broken board: callers show
 * the thrown message instead.
 */

function fail(where: string, message: string): never {
  throw new Error(`${where}：${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  obj: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim())
    fail(where, `缺少字段 ${key}`);
  return value;
}

export function assertMetricsData(value: unknown, where: string): void {
  if (!isRecord(value) || !Array.isArray(value.items))
    fail(where, "items 必须是数组");
  value.items.forEach((item, index) => {
    if (!isRecord(item)) fail(where, `items[${index}] 必须是对象`);
    stringField(item, "label", where);
    stringField(item, "value", where);
  });
}

export function assertAlertsData(value: unknown, where: string): void {
  if (!isRecord(value) || !Array.isArray(value.items))
    fail(where, "items 必须是数组");
  value.items.forEach((item, index) => {
    if (!isRecord(item)) fail(where, `items[${index}] 必须是对象`);
    if (item.level !== "warning" && item.level !== "danger") {
      fail(where, `items[${index}].level 必须是 warning/danger`);
    }
    stringField(item, "title", where);
  });
}

export function assertTickerData(value: unknown, where: string): void {
  if (!isRecord(value) || !Array.isArray(value.items))
    fail(where, "items 必须是数组");
  value.items.forEach((item, index) => {
    if (typeof item !== "string") fail(where, `items[${index}] 必须是字符串`);
  });
}

export function assertSystemsData(value: unknown, where: string): void {
  if (!isRecord(value) || !Array.isArray(value.groups))
    fail(where, "groups 必须是数组");
  value.groups.forEach((group, index) => {
    if (!isRecord(group)) fail(where, `groups[${index}] 必须是对象`);
    stringField(group, "id", where);
    stringField(group, "label", where);
    if (!Array.isArray(group.items))
      fail(where, `groups[${index}].items 必须是数组`);
    group.items.forEach((item, itemIndex) => {
      if (!isRecord(item))
        fail(where, `groups[${index}].items[${itemIndex}] 必须是对象`);
      stringField(item, "name", where);
    });
  });
}

export function assertRegionsData(value: unknown, where: string): void {
  if (!isRecord(value) || !Array.isArray(value.items))
    fail(where, "items 必须是数组");
  value.items.forEach((item, index) => {
    if (!isRecord(item)) fail(where, `items[${index}] 必须是对象`);
    stringField(item, "id", where);
    stringField(item, "name", where);
  });
}

export function assertAnalysisData(value: unknown, where: string): void {
  if (!isRecord(value)) fail(where, "必须是对象");
  stringField(value, "title", where);
  if (value.stats !== undefined && !Array.isArray(value.stats)) {
    fail(where, "stats 必须是数组");
  }
}

export function assertDimensionsData(value: unknown, where: string): void {
  if (!isRecord(value) || !Array.isArray(value.dimensions)) {
    fail(where, "dimensions 必须是数组");
  }
  value.dimensions.forEach((group, index) => {
    if (!isRecord(group)) fail(where, `dimensions[${index}] 必须是对象`);
    stringField(group, "id", where);
    stringField(group, "label", where);
    if (!Array.isArray(group.items)) {
      fail(where, `dimensions[${index}].items 必须是数组`);
    }
    group.items.forEach((item, itemIndex) => {
      if (!isRecord(item)) {
        fail(where, `dimensions[${index}].items[${itemIndex}] 必须是对象`);
      }
      stringField(item, "id", where);
      stringField(item, "name", where);
    });
  });
}

export function assertChatContextData(value: unknown, where: string): void {
  if (!isRecord(value)) fail(where, "必须是对象");
  if (value.bullets !== undefined && !Array.isArray(value.bullets)) {
    fail(where, "bullets 必须是数组");
  }
}
