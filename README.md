# Gıda Pusulası 🌿

Mobil öncelikli barkod ve gıda etiketi analiz PWA prototipi.

**Teknoloji:** Vue 3 · TypeScript · Vite · ZXing · Tesseract.js · IndexedDB. İlk sürümde sunucu veritabanı yoktur.

## Özellikler

- Kameradan EAN/UPC barkod tarama ve elle barkod sorgulama
- Open Food Facts ürün verileri, Nutri-Score ve NOVA (varsa)
- Türkçe + İngilizce cihaz-içi OCR ile içindekiler ve besin tablosu okuma
- OCR sonuçlarını ve besin değerlerini elle doğrulama/düzeltme
- Kural tabanlı beslenme uyarıları (bilimsel doğrulanmış sağlık skoru değildir)
- IndexedDB üzerinde yerel ürün geçmişi
- GitHub Pages için otomatik derleme ve yayınlama

## Yerel geliştirme

Node.js 22+ gereklidir.

```bash
npm install
npm run dev
```

Ardından `http://localhost:5173` adresini açın. Mobil kamerayı test etmek için HTTPS üzerinden yayımlayın.

```bash
npm run check
npm run build
```

## GitHub Pages

1. `https://github.com/new` üzerinden **gida-pusulasi** isimli **Public** bir repo oluşturun, "Add README" ve diğer başlangıç dosyalarını seçmeyin.
2. Bu projenin dosyalarını (gizli `.github` klasörü dahil) repo köküne push edin. Sadece ZIP dosyasını yüklemeyin; ZIP içeriğini çıkarın.
3. **Settings → Pages → Build and deployment → Source → GitHub Actions** seçin.
4. `main` push işlemi `.github/workflows/deploy.yml` iş akışını başlatır.
5. Yayın URL'si: `https://emirozyilmaz.github.io/gida-pusulasi/` (deploy başarılı olduktan sonra).

**Not:** Repo adı değişirse `vite.config.ts` içindeki `base` değerini değiştirin. Alan adını ve kullanıcı adını bu örnekte sabit tuttuk.

### İlk yükleme (terminal)

```bash
git init
git add .
git commit -m "feat: initial PWA and OCR prototype"
git branch -M main
git remote add origin https://github.com/emirozyilmaz/gida-pusulasi.git
git push -u origin main
```

GitHub'dan repoyu ilk oluştururken README eklemediyseniz bu komutlar doğrudan çalışır.

## Ürün API'si ve Cloudflare Worker

Başlangıç prototipi Open Food Facts'a tarayıcıdan doğrudan istek yapar. Bu yöntem gerçek kullanımda CORS, `User-Agent` ve API hız limiti sebebiyle güvenilir olmayabilir. Resmî Open Food Facts API koşulları: <https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/>.

`worker/index.ts` isteğe bağlı Cloudflare Worker örneğidir. GitHub Pages Worker çalıştırmaz; ayrı deploy gerekir. Cloudflare hesabınız ile `cd worker && npx wrangler deploy` komutunu kullanabilirsiniz. Worker'ı yayınladıktan sonra GitHub repo ayarlarından **Settings → Secrets and variables → Actions → Variables** altında `VITE_PRODUCT_API_BASE` değerine worker URL'si yazın ve workflow'u yeniden çalıştırın. Worker, API çağrısında bir uygulama `User-Agent` başlığı gönderir ve önbelleğe alır.

Cloudflare Worker'ın prod kullanımı için hız sınırı, log/izleme, hata yönetimi ve API koşulları ayrıca değerlendirilmelidir.

## Önemli sınırlar

- OCR metni kusurlu okuyabilir: değerleri kullanıcı doğrulamalıdır. 100 g ve porsiyon değerleri karıştırılmamalıdır.
- OCR ilk çalıştırmada dil dosyası indirir, bu nedenle internet bağlantısı gerekebilir.
- Fotoğraflar cihaz üzerinde işlenir, bu uygulama fotoğrafı sunucuya yüklemez.
- Ürün verileri kullanıcı katkılı Open Food Facts'tan gelir; eksik/eski olabilir.
- Uygulama tıbbi/kişisel beslenme önerisi sunmaz. Katkı maddelerinin bulunması tek başına zararlılık kanıtı değildir.
- Nutri-Score ve NOVA yalnızca kaynakta varsa gösterilir, uygulama bunları kendisi hesaplamaz.
- Veriler tarayıcının IndexedDB alanında saklanır; tarayıcı depolaması silinirse kayıtlar kaybolabilir.
- Prototipte doğrudan API çağrısı bazı tarayıcı ve ağlarda CORS engeline takılabilir; Worker yöntemi bu yüzden önerilir.

## Gizlilik, lisans

Open Food Facts verileri ODbL lisansı altındadır: <https://world.openfoodfacts.org/data>. Kamuya açık yeni bir türetilmiş ürün veritabanı oluşturacaksanız paylaşım/atıf yükümlülüklerini ayrıca inceleyin.

Proje lisansı: MIT; üçüncü taraf kitaplık ve veri lisansları ayrıca geçerlidir.
