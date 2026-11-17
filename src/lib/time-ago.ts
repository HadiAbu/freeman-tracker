export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'date unknown';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'date unknown';
  const minutes = Math.max(0, Math.floor((now.getTime() - t) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
