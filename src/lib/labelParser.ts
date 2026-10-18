import type { Nutrition } from './types';

/** Best effort parsing only; every extracted field requires visual user review. */
export function parseNutrition(text: string): Nutrition {
  const lines = text.replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const result: Nutrition = {};
  const rules: Array<[keyof Nutrition, RegExp]> = [
    ['saturatedFat', /(?:doymuş\s*(?:yağ|yağ\s*asidi)|saturated\s*fat|of\s*which\s*saturates)/i],
    ['sugars', /(?:şekerler|şeker|sugars|of\s*which\s*sugars)/i],
    ['salt', /(?:tuz|salt)(?!\s*oranı)/i],
    ['proteins', /(?:protein|proteins)/i],
    ['fiber', /(?:lif|fiber|fibre)/i],
    ['fat', /^(?:toplam\s*)?(?:yağ|fat)(?:\s|:|$)/i],
    ['energyKcal', /(?:enerji|energy|kcal)/i]
  ];

  for (const line of lines) {
    for (const [field, pattern] of rules) {
      if (result[field] !== undefined || !pattern.test(line)) continue;
      // Capture a value right after the field label, not digits in words / percentages.
      const match = line.match(/(-?\d{1,5}(?:[.,]\d{1,3})?)\s*(kcal|g|mg)\b/i);
      if (!match) continue;
      const raw = Number(match[1].replace(',', '.'));
      if (!Number.isFinite(raw) || raw < 0) continue;
      const unit = match[2].toLowerCase();
      const value = unit === 'mg' ? raw / 1000 : raw;
      if (field === 'energyKcal' && unit !== 'kcal') continue;
      if (field !== 'energyKcal' && unit === 'kcal') continue;
      if (field !== 'energyKcal' && value > 100) continue;
      result[field] = value;
      break;
    }
  }
  return result;
}

export function cleanIngredientText(raw: string): string {
  return raw.replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
}
