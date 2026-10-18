import type { FoodProduct, Nutrition } from './types';

type OffResponse = {
  status?: string | number;
  product?: {
    code?: string;
    product_name?: string;
    brands?: string;
    image_front_small_url?: string;
    ingredients_text?: string;
    ingredients_text_tr?: string;
    ingredients_text_en?: string;
    nutriments?: Record<string, unknown>;
    nutriscore_grade?: string;
    nova_group?: number;
    allergens_tags?: string[];
    categories_tags?: string[];
  };
};

const fields = 'code,product_name,brands,image_front_small_url,ingredients_text,ingredients_text_tr,ingredients_text_en,nutriments,nutriscore_grade,nova_group,allergens_tags,categories_tags';
export function isBarcode(value: string): boolean {
  return /^\d{8,14}$/.test(value.trim());
}

function numberOrUndefined(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string' && input.trim() && Number.isFinite(Number(input.replace(',', '.')))) return Number(input.replace(',', '.'));
  return undefined;
}

export async function fetchProduct(barcode: string): Promise<FoodProduct | null> {
  if (!isBarcode(barcode)) throw new Error('Barkod 8–14 rakamdan oluşmalıdır.');
  const root = import.meta.env.VITE_PRODUCT_API_BASE?.trim().replace(/\/$/, '');
  const url = root
    ? `${root}/product/${encodeURIComponent(barcode)}`
    : `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}?fields=${encodeURIComponent(fields)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error('Ürün servisine erişilemiyor. Bağlantınızı kontrol edin veya etiket fotoğrafı ile devam edin.');
  }
  if (response.status === 404) return null;
  if (response.status === 429) throw new Error('Sorgu sınırına ulaşıldı. Bir süre sonra yeniden deneyin.');
  if (!response.ok) throw new Error(`Ürün servisi geçici olarak yanıt vermiyor (${response.status}).`);
  const data = await response.json() as OffResponse;
  if (!data.product || data.status === 'failure' || data.status === 0 || data.status === '0') return null;
  const p = data.product;
  const n = p.nutriments ?? {};
  const nutrition: Nutrition = {
    energyKcal: numberOrUndefined(n['energy-kcal_100g']),
    sugars: numberOrUndefined(n['sugars_100g']),
    saturatedFat: numberOrUndefined(n['saturated-fat_100g']),
    fat: numberOrUndefined(n['fat_100g']),
    salt: numberOrUndefined(n['salt_100g']),
    proteins: numberOrUndefined(n['proteins_100g']),
    fiber: numberOrUndefined(n['fiber_100g'])
  };
  const name = p.product_name?.trim() || 'İsmi belirtilmeyen ürün';
  return {
    id: barcode,
    barcode,
    name,
    brand: p.brands?.split(',')[0]?.trim(),
    imageUrl: p.image_front_small_url,
    ingredients: p.ingredients_text_tr || p.ingredients_text || p.ingredients_text_en || '',
    nutrition,
    // OFF _100g values represent per 100g/100ml, depending on product.
    nutritionBasis: !p.categories_tags?.length ? 'unknown' : p.categories_tags.some(c => /(?:beverages|soft-drinks|juices|waters|sodas)/i.test(c)) ? '100ml' : '100g',
    nutriScore: p.nutriscore_grade && p.nutriscore_grade !== 'unknown' ? p.nutriscore_grade.toUpperCase() : undefined,
    nova: p.nova_group && p.nova_group >= 1 && p.nova_group <= 4 ? p.nova_group : undefined,
    allergens: (p.allergens_tags ?? []).map(t => t.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ')),
    source: 'openfoodfacts',
    savedAt: Date.now()
  };
}
