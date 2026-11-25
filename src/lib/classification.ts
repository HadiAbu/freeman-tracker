import type { HoldingMeta } from '@/types';

/**
 * The fields the user actually typed on the add-trade form, for PATCH /holdings (which only
 * changes the fields it is sent). Never includes name or nulls, so blank fields keep their
 * stored value. Returns null when nothing was entered (no request needed).
 */
export function enteredClassification(input: {
  sector: string;
  assetClass: string;
}): HoldingMeta | null {
  const sector = input.sector.trim();
  const assetClass = input.assetClass.trim();
  const meta: HoldingMeta = {};
  if (sector) meta.sector = sector;
  if (assetClass) meta.asset_class = assetClass;
  return Object.keys(meta).length > 0 ? meta : null;
}

/** True when a Sector / Asset class view has nothing to group by yet. */
export function isAllUnassigned(slices: { label: string }[]): boolean {
  return slices.length > 0 && slices.every((s) => s.label === 'Unassigned');
}
