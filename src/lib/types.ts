export type Nutrition = {
  energyKcal?: number;
  sugars?: number;
  saturatedFat?: number;
  fat?: number;
  salt?: number;
  proteins?: number;
  fiber?: number;
};
export type FoodProduct = {
  id: string;
  barcode?: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  ingredients: string;
  nutrition: Nutrition;
  nutritionBasis: '100g' | '100ml' | 'unknown';
  nutriScore?: string;
  nova?: number;
  allergens: string[];
  source: 'openfoodfacts' | 'etiket';
  savedAt: number;
};
export type Finding = { status: 'attention' | 'info' | 'good'; title: string; description: string };
export type Review = { headline: string; description: string; findings: Finding[]; hasData: boolean };
