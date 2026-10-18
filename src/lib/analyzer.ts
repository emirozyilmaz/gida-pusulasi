import type { FoodProduct, Review, Finding } from './types';

/**
 * Transparency-first interpretation of nutritional fields.
 * These are screening thresholds, NOT a diagnosis or validated composite score.
 * Thresholds apply only to food data per 100 g, not drinks or portions.
 */
export function analyze(p: FoodProduct): Review {
  const n = p.nutrition;
  const findings: Finding[] = [];
  const hasIngredients = p.ingredients.trim().length > 0;
  const hasNutrition = Object.values(n).some(v => typeof v === 'number' && Number.isFinite(v));
  if (!hasNutrition && !hasIngredients && !p.nutriScore && !p.nova) {
    return { headline: 'Yetersiz veri', description: 'İçerik veya besin değeri ekleyerek değerlendirmeyi başlatın.', findings: [], hasData: false };
  }
  if (p.nutritionBasis === '100g') {
    const checks: Array<[number | undefined, number, string, string]> = [
      [n.sugars, 22.5, 'Şeker miktarı yüksek', '100 g üründe şeker miktarı 22,5 g veya üzerinde.'],
      [n.saturatedFat, 5, 'Doymuş yağ miktarı yüksek', '100 g üründe doymuş yağ miktarı 5 g veya üzerinde.'],
      [n.salt, 1.5, 'Tuz miktarı yüksek', '100 g üründe tuz miktarı 1,5 g veya üzerinde.']
    ];
    for (const [value, threshold, title, description] of checks) {
      if (value !== undefined && value >= threshold) findings.push({ status: 'attention', title, description });
    }
  } else if (hasNutrition) {
    findings.push({ status: 'info', title: 'Ölçü birimini doğrulayın', description: 'Besin değerleri 100 g / 100 ml olarak ayrılmadığından eşik temelli yorum yapılmadı.' });
  }
  if (p.nova === 4) findings.push({ status: 'attention', title: 'NOVA 4: ultra işlenmiş', description: 'İşlenme sınıfıdır; tek başına ürünün güvenli veya zararlı olduğunu göstermez.' });
  if (p.allergens.length) findings.push({ status: 'info', title: 'Alerjen bilgisi var', description: `Kayıtlı alerjenler: ${p.allergens.join(', ')}. Ambalajı ayrıca kontrol edin.` });
  if (hasIngredients) findings.push({ status: 'info', title: 'İçindekiler mevcut', description: 'İçerik listesi tek başına risk puanı değildir. Katkı maddelerinin varlığı tek başına zararlı anlamına gelmez.' });
  if (findings.some(f => f.status === 'attention')) return {
    headline: 'Dikkat edilmesi gereken noktalar var',
    description: 'Aşağıdaki göstergeler ürünün beslenme profili veya işlenme düzeyiyle ilgilidir. Tüketim miktarı da önemlidir.', findings, hasData: true
  };
  return {
    headline: 'Belirgin bir uyarı bulunmadı',
    description: 'Bu, ürünün mutlaka sağlıklı olduğu anlamına gelmez. Mevcut veri ve porsiyon miktarını birlikte değerlendirin.', findings, hasData: true
  };
}
