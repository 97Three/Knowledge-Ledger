const DAY = 86_400_000;

/** 相对时间：刚刚 / 12 分钟前 / 3 小时前 / 2 天前 / 2026年11月3日 */
export function formatRelativeTime(value: string | undefined): string {
  if (value === undefined || value === "") return "—";
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) return "—";
  const delta = Date.now() - stamp;
  if (delta < 60_000) return "刚刚";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(stamp));
}

export function formatDate(value: string | undefined): string {
  if (value === undefined || value === "") return "—";
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) return "—";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(stamp));
}

export function formatDateTime(value: string | undefined): string {
  if (value === undefined || value === "") return "—";
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(stamp));
}

/** 长 ID 截断，保留头尾可辨认部分 */
export function shortId(value: string | undefined, length = 18): string {
  if (value === undefined) return "—";
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

/** 把修订号渲染成 rev 7f3a·c92e 这种可读形式（取内容地址前 8 位） */
export function shortRevision(value: string | undefined): string {
  if (value === undefined || value === "") return "—";
  const digest = value.split(":").at(-1) ?? value;
  const hex = digest.replace(/[^a-zA-Z0-9]/gu, "");
  if (hex.length < 8) return value;
  return `${hex.slice(0, 4)}·${hex.slice(4, 8)}`;
}

/** 天数差，用于“已停留 2 天”这类提示 */
export function daysSince(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) return undefined;
  return Math.max(0, Math.floor((Date.now() - stamp) / DAY));
}

export function percent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}
