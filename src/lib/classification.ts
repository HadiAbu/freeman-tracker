import type { HoldingMeta } from '@/types';

type Existing = { name?: string | null; sector?: string | null; asset_class?: string | null } | undefined;

/**
 * Classification entered on the add-trade form, merged over what the holding already has.
 * PUT /holdings replaces all three fields, so a field left blank here must keep its stored
 * value instead of being wiped. Returns null when nothing was entered (no request needed).
 */
export function mergeClassification(
  existing: Existing,
  input: { sector: string; assetClass: string },
): HoldingMeta | null {
  const sector = input.sector.trim();
  const assetClass = input.assetClass.trim();
  if (!sector && !assetClass) return null;
  return {
    name: existing?.name ?? null,
    sector: sector || existing?.sector || null,
    asset_class: assetClass || existing?.asset_class || null,
  };
}

/** True when a Sector / Asset class view has nothing to group by yet. */
export function isAllUnassigned(slices: { label: string }[]): boolean {
  return slices.length > 0 && slices.every((s) => s.label === 'Unassigned');
}
