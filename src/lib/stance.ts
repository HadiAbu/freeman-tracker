import type { Confidence, Stance } from '@/types';

/** Wording is deliberately "lean", not "recommendation": this is one opinion from news. */
export function stanceTitle(stance: Stance): string {
  return stance === 'unclear' ? 'No clear lean' : `Lean: ${stance}`;
}

export function confidenceLabel(confidence: Confidence): string {
  return `${confidence} confidence`;
}

export function stanceSpoken(stance: Stance, confidence: Confidence): string {
  return stance === 'unclear'
    ? 'No clear lean from the news'
    : `Lean: ${stance}, ${confidenceLabel(confidence)}`;
}
