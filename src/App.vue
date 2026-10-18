<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { cameraCapabilities, applyCameraControl } from './lib/cameraCapabilities';
import type { FoodProduct, Nutrition } from './lib/types';
import { analyze } from './lib/analyzer';
import { fetchProduct, isBarcode } from './lib/openFoodFacts';
import { cleanIngredientText, parseNutrition } from './lib/labelParser';
import { deleteProduct, readHistory, saveProduct } from './lib/storage';

type View = 'home' | 'scanner' | 'label' | 'result' | 'history';
type LabelSection = 'ingredients' | 'nutrition';
const view = ref<View>('home');
const scannerVideo = ref<HTMLVideoElement | null>(null);
const scannerPhotoInput = ref<HTMLInputElement | null>(null);
const scannerPhotoBusy = ref(false);
const scannerCameras = ref<MediaDeviceInfo[]>([]);
const scannerCameraId = ref('');
const scannerZoom = ref(1);
const scannerZoomMin = ref(1);
const scannerZoomMax = ref(1);
const scannerZoomStep = ref(0.1);
const scannerCanZoom = ref(false);
const scannerCanFocus = ref(false);
const scannerCanTorch = ref(false);
const scannerTorchOn = ref(false);
const scannerMessage = ref('');
const barcode = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const isScanning = ref(false);
const ocrBusy = ref(false);
const ocrProgress = ref(0);
const ocrStep = ref('');
const ingredientImage = ref('');
const nutritionImage = ref('');
const ingredientInput = ref<HTMLInputElement | null>(null);
const nutritionInput = ref<HTMLInputElement | null>(null);
const product = ref<FoodProduct | null>(null);
const history = ref<FoodProduct[]>([]);
const labelProductName = ref('');
const labelBrand = ref('');
const labelIngredients = ref('');
const nutritionText = ref('');
const labelBasis = ref<'100g' | '100ml'>('100g');
const values = ref<Record<keyof Nutrition,string>>({ energyKcal:'', sugars:'', fat:'', saturatedFat:'', salt:'', proteins:'', fiber:'' });
const nutritionFields: Array<{key:keyof Nutrition; label:string; unit:string}> = [
  { key:'energyKcal', label:'Enerji', unit:'kcal' },
  { key:'sugars', label:'Şeker', unit:'g' },
  { key:'fat', label:'Toplam yağ', unit:'g' },
  { key:'saturatedFat', label:'Doymuş yağ', unit:'g' },
  { key:'salt', label:'Tuz', unit:'g' },
  { key:'proteins', label:'Protein', unit:'g' },
  { key:'fiber', label:'Lif', unit:'g' }
];
const currentReview = computed(() => product.value ? analyze(product.value) : null);
const knownNutrients = computed(() => product.value ? nutritionFields.filter(f => product.value!.nutrition[f.key] !== undefined) : []);
const additiveCodes = computed(() => [...new Set(product.value?.ingredients.match(/\bE\s?\d{3,4}[a-z]?\b/gi)?.map(t => t.replace(/\s+/g,'').toUpperCase()) ?? [])].slice(0, 12));
let scanControls: IScannerControls | null = null;
let scannerTrack: MediaStreamTrack | null = null;
let focusModes: string[] = [];
let scanningToken = 0;
let activeWorker: { terminate: () => Promise<unknown> } | null = null;

async function reloadHistory() {
  try { history.value = await readHistory(); }
  catch { notice.value = 'Tarayıcı geçmişe erişim izni vermiyor; diğer özellikleri kullanabilirsiniz.'; }
}
function stopCamera() {
  scanningToken++;
  scanControls?.stop();
  scanControls = null;
  scannerTrack = null;
  scannerTorchOn.value = false;
  isScanning.value = false;
  if (scannerVideo.value?.srcObject) {
    (scannerVideo.value.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    scannerVideo.value.srcObject = null;
  }
}
function navigate(next: View) {
  stopCamera();
  error.value = '';
  notice.value = '';
  view.value = next;
}
function beginLabel() { navigate('label'); }
async function beginScan() {
  navigate('scanner');
  await nextTick();
  await startScanner();
}
async function startScanner(cameraId?: string) {
  stopCamera();
  const token = ++scanningToken;
  scannerMessage.value = '';
  error.value = '';
  scannerCanZoom.value = false;
  scannerCanFocus.value = false;
  scannerCanTorch.value = false;
  scannerCameras.value = [];
  if (!scannerVideo.value) return;
  try {
    isScanning.value = true;
    const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 260 });
    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: 'environment' } })
    };
    const controls = await reader.decodeFromConstraints(
      { video: videoConstraints, audio: false },
      scannerVideo.value,
      (result, _err, ctrl) => {
        const code = result?.getText().trim() ?? '';
        if (code && isBarcode(code) && token === scanningToken) {
          ctrl.stop();
          isScanning.value = false;
          void searchBarcode(code);
        }
      }
    );
    if (token !== scanningToken) { controls.stop(); return; }
    scanControls = controls;
    const track = (scannerVideo.value.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (!track) return;
    scannerTrack = track;
    const capabilities = cameraCapabilities(track);
    focusModes = capabilities.focusMode ?? [];
    scannerCanFocus.value = focusModes.includes('continuous') || focusModes.includes('single-shot');
    if (focusModes.includes('continuous')) {
      try { await applyCameraControl(track, 'focusMode', 'continuous'); } catch { /* unsupported */ }
    }
    const zoom = capabilities.zoom;
    if (zoom && zoom.max > zoom.min) {
      scannerZoomMin.value = zoom.min;
      scannerZoomMax.value = Math.min(zoom.max, 5);
      scannerZoomStep.value = zoom.step && zoom.step > 0 ? zoom.step : 0.1;
      scannerZoom.value = Math.min(scannerZoomMax.value, Math.max(scannerZoomMin.value, (track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom ?? zoom.min));
      scannerCanZoom.value = scannerZoomMax.value > scannerZoomMin.value;
    }
    scannerCanTorch.value = capabilities.torch === true || typeof controls.switchTorch === 'function';
    try {
      scannerCameras.value = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      scannerCameraId.value = track.getSettings().deviceId ?? cameraId ?? '';
    } catch { scannerCameras.value = []; }
  } catch {
    if (token !== scanningToken) return;
    stopCamera();
    error.value = 'Kamera açılamadı. İzinleri kontrol edin veya başka bir kamera ile deneyin.';
  }
}
function selectScannerCamera(event: Event) {
  scannerCameraId.value = (event.target as HTMLSelectElement).value;
  void startScanner(scannerCameraId.value);
}
async function adjustScannerZoom(event: Event) {
  if (!scannerTrack) return;
  const zoom = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(zoom)) return;
  try { await applyCameraControl(scannerTrack, 'zoom', zoom); scannerZoom.value = zoom; }
  catch { scannerMessage.value = 'Bu cihazda yakınlaştırma kullanılamıyor.'; }
}
async function refocusScanner() {
  if (!scannerTrack || !scannerCanFocus.value) return;
  const mode = focusModes.includes('single-shot') ? 'single-shot' : 'continuous';
  try {
    await applyCameraControl(scannerTrack, 'focusMode', mode);
    scannerMessage.value = 'Odak isteği gönderildi. Barkodu biraz uzaklaştırarak deneyin.';
  } catch { scannerMessage.value = 'Tarayıcı odak isteğini kabul etmedi.'; }
}
async function toggleScannerTorch() {
  if (!scannerTrack || !scannerCanTorch.value) return;
  const desired = !scannerTorchOn.value;
  try {
    if (scanControls?.switchTorch) await scanControls.switchTorch(desired);
    else await applyCameraControl(scannerTrack, 'torch', desired);
    scannerTorchOn.value = desired;
  } catch { scannerMessage.value = 'Flaş kontrolü kullanılamıyor.'; }
}
function openScannerPhoto() {
  stopCamera();
  error.value = '';
  scannerPhotoInput.value?.click();
}
async function decodeScannerPhoto(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    error.value = 'Lütfen bir barkod fotoğrafı seçin.';
    return;
  }
  scannerPhotoBusy.value = true;
  error.value = '';
  const url = URL.createObjectURL(file);
  try {
    const reader = new BrowserMultiFormatReader();
    const result = await reader.decodeFromImageUrl(url);
    const code = result.getText().trim();
    if (!isBarcode(code)) throw new Error('Barkod formatı geçersiz.');
    await searchBarcode(code);
  } catch {
    error.value = 'Fotoğraf okunamadı. Barkodu net, tam ve düz kadrajla çekin veya kamerayı yeniden başlatın.';
  } finally {
    URL.revokeObjectURL(url);
    scannerPhotoBusy.value = false;
  }
}
async function showProduct(p: FoodProduct) {
  product.value = p;
  navigate('result');
  try { await saveProduct({ ...p, savedAt: Date.now() }); await reloadHistory(); }
  catch { notice.value = 'Ürün görüntüleniyor ancak bu cihazda geçmişe kaydedilemedi.'; }
}
async function searchBarcode(input?: string) {
  const code = (input ?? barcode.value).trim();
  if (!isBarcode(code)) { error.value = 'Lütfen 8–14 rakamdan oluşan barkod girin.'; return; }
  stopCamera();
  barcode.value = code;
  error.value = '';
  busy.value = true;
  try {
    const p = await fetchProduct(code);
    if (!p) {
      beginLabel();
      error.value = 'Bu barkodda ürün bilgisi bulunamadı. Etiketi fotoğraflayarak devam edebilirsiniz.';
      return;
    }
    await showProduct(p);
  } catch (ex) {
    error.value = ex instanceof Error ? ex.message : 'Ürün sorgulanamadı.';
    navigate('home');
    // navigate clears error, so restore it for the user.
    error.value = ex instanceof Error ? ex.message : 'Ürün sorgulanamadı.';
  } finally { busy.value = false; }
}
function previewFile(file: File, section: LabelSection) {
  const blob = URL.createObjectURL(file);
  const previous = section === 'ingredients' ? ingredientImage.value : nutritionImage.value;
  if (previous) URL.revokeObjectURL(previous);
  if (section === 'ingredients') ingredientImage.value = blob;
  else nutritionImage.value = blob;
  return blob;
}
function applyParsed(text: string) {
  const parsed = parseNutrition(text);
  for (const key of Object.keys(parsed) as Array<keyof Nutrition>) {
    if (parsed[key] !== undefined) values.value[key] = String(parsed[key]);
  }
}
async function recognizeFile(event: Event, section: LabelSection) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { error.value = 'Lütfen bir görsel dosyası seçin.'; return; }
  if (file.size > 15 * 1024 * 1024) { error.value = 'Lütfen 15 MB altında bir görsel seçin.'; return; }
  const imageUrl = previewFile(file, section);
  error.value = '';
  ocrBusy.value = true;
  ocrProgress.value = 0;
  ocrStep.value = 'OCR modeli hazırlanıyor';
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker(['tur', 'eng'], 1, {
      logger: message => {
        if (typeof message.progress === 'number') ocrProgress.value = Math.round(message.progress * 100);
        if (typeof message.status === 'string') ocrStep.value = message.status;
      }
    });
    activeWorker = worker;
    const { data } = await worker.recognize(imageUrl);
    const recognized = data.text.trim();
    if (!recognized) { error.value = 'Fotoğrafta okunabilir metin bulunamadı. Daha net ve yakın bir fotoğraf deneyin.'; return; }
    if (section === 'ingredients') labelIngredients.value = recognized;
    else { nutritionText.value = recognized; applyParsed(recognized); }
    notice.value = 'Metin okundu. Lütfen OCR hatalarını, ölçü birimlerini ve tüm sayıları doğrulayın.';
  } catch {
    error.value = 'OCR çalıştırılamadı. İnternet bağlantısını, fotoğrafı veya cihaz belleğini kontrol edin.';
  } finally {
    await activeWorker?.terminate().catch(() => undefined);
    activeWorker = null;
    ocrBusy.value = false;
    ocrStep.value = '';
  }
}
function clickImageInput(section: LabelSection) {
  if (ocrBusy.value) return;
  (section === 'ingredients' ? ingredientInput : nutritionInput).value?.click();
}
function resetLabel() {
  labelProductName.value = '';
  labelBrand.value = '';
  labelIngredients.value = '';
  nutritionText.value = '';
  values.value = { energyKcal:'', sugars:'', fat:'', saturatedFat:'', salt:'', proteins:'', fiber:'' };
  if (ingredientImage.value) URL.revokeObjectURL(ingredientImage.value);
  if (nutritionImage.value) URL.revokeObjectURL(nutritionImage.value);
  ingredientImage.value = '';
  nutritionImage.value = '';
}
async function analyzeLabel() {
  if (!labelIngredients.value.trim() && !Object.values(values.value).some(v => v.trim() !== '')) {
    error.value = 'Analiz için içindekiler veya en az bir besin değeri girin.'; return;
  }
  const nutrition: Nutrition = {};
  for (const field of nutritionFields) {
    const value = values.value[field.key].trim().replace(',', '.');
    if (!value) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || (field.key !== 'energyKcal' && n > 100)) {
      error.value = `${field.label} değeri geçersiz. Lütfen etiketi kontrol edin.`; return;
    }
    nutrition[field.key] = n;
  }
  await showProduct({
    id: `label-${Date.now()}`,
    name: labelProductName.value.trim() || 'Etiketten okunan ürün',
    brand: labelBrand.value.trim() || undefined,
    ingredients: cleanIngredientText(labelIngredients.value),
    nutrition, nutritionBasis: labelBasis.value,
    allergens: [], source: 'etiket', savedAt: Date.now()
  });
}
async function removeHistory(id: string) {
  try { await deleteProduct(id); await reloadHistory(); }
  catch { error.value = 'Geçmiş kaydı silinemedi.'; }
}
function displayNumber(number: number): string { return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(number); }
function displayDate(timestamp: number): string { return new Intl.DateTimeFormat('tr-TR', { day:'numeric', month:'short' }).format(timestamp); }
onMounted(() => { void reloadHistory(); });
onBeforeUnmount(() => {
  stopCamera();
  void activeWorker?.terminate();
  if (ingredientImage.value) URL.revokeObjectURL(ingredientImage.value);
  if (nutritionImage.value) URL.revokeObjectURL(nutritionImage.value);
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" type="button" @click="navigate('home')" aria-label="Ana sayfa">
        <span class="brand-mark">✳</span><span>gıda<span class="brand-accent">pusulası</span><span class="brand-period">.</span></span>
      </button>
      <button class="header-nav" type="button" @click="navigate('history')"><span class="nav-icon">◷</span><span>Geçmiş</span></button>
    </header>

    <main>
      <section v-if="view === 'home'" class="home-screen">
        <div class="hero">
          <div class="eyebrow"><span class="pulse-dot"></span> DAHA BİLİNÇLİ ALIŞVERİŞ</div>
          <h1>Ne yediğini<br /><em>bil.</em></h1>
          <p>Bir barkod ya da etiket fotoğrafı yeterli. Ürünlerin içeriğini karmaşık terimler olmadan keşfet.</p>
          <div class="hero-decoration" aria-hidden="true"><span class="orbit orbit-one"></span><span class="orbit orbit-two"></span><span class="center-leaf">✳</span></div>
        </div>

        <div class="action-list">
          <button class="action-card primary-action" type="button" @click="beginScan">
            <span class="action-icon">▥</span>
            <span class="action-copy"><strong>Barkod okut</strong><small>Kamerayla ürününü hemen bul</small></span>
            <span class="action-arrow">↗</span>
          </button>
          <button class="action-card" type="button" @click="beginLabel">
            <span class="action-icon soft">▧</span>
            <span class="action-copy"><strong>Etiket fotoğrafı çek</strong><small>İçindekileri ve besin değerlerini oku</small></span>
            <span class="action-arrow">↗</span>
          </button>
        </div>
        <div class="lookup-panel">
          <label for="barcode-search">Barkod numarasıyla ara</label>
          <form class="lookup-form" @submit.prevent="searchBarcode()">
            <input id="barcode-search" v-model="barcode" inputmode="numeric" pattern="[0-9]*" maxlength="14" placeholder="Örn. 8690..." autocomplete="off" />
            <button type="submit" :disabled="busy">{{ busy ? 'Aranıyor…' : 'Sorgula' }} →</button>
          </form>
          <p v-if="error" class="message error" role="alert">{{ error }}</p>
        </div>
        <div class="recent" v-if="history.length">
          <div class="section-heading"><h2>Son incelediklerin</h2><button @click="navigate('history')">Tümü →</button></div>
          <div class="recent-list">
            <button v-for="item in history.slice(0, 3)" :key="item.id" class="recent-item" @click="showProduct(item)"><span class="small-product-icon">✳</span><span><strong>{{ item.name }}</strong><small>{{ item.brand || (item.source === 'etiket' ? 'Etiketten analiz' : 'Open Food Facts') }}</small></span><span class="action-arrow">›</span></button>
          </div>
        </div>
        <div class="note-card"><span>ⓘ</span><p>Bu uygulama ürünleri tek bir puanla “sağlıklı/sağlıksız” ilan etmez. Verileri ve dikkat edilmesi gereken noktaları açıklar.</p></div>
      </section>

      <section v-else-if="view === 'scanner'" class="page-screen">
        <button class="back" @click="navigate('home')">← Geri</button>
        <div class="page-eyebrow">01 / BARKOD TARAMA</div>
        <h1>Barkodu <em>kadrajla.</em></h1>
        <p class="page-lead">Ürünün ambalajındaki barkodu çerçevenin içine yerleştir.</p>
        <div class="scanner-frame" @click="refocusScanner"><video ref="scannerVideo" autoplay muted playsinline aria-label="Barkod kamerası"></video><div class="scanner-reticle"><i></i><i></i><i></i><i></i></div><span v-if="isScanning" class="scanner-caption">Barkod aranıyor…</span></div>
        <div class="scanner-tools" v-if="isScanning">
          <label v-if="scannerCameras.length > 1" class="scanner-camera-label">Kamera
            <select :value="scannerCameraId" @change="selectScannerCamera">
              <option v-for="(camera, i) in scannerCameras" :key="camera.deviceId" :value="camera.deviceId">{{ camera.label || 'Kamera ' + (i + 1) }}</option>
            </select>
          </label>
          <label v-if="scannerCanZoom" class="scanner-zoom-label">Yakınlaştırma <strong>{{ scannerZoom.toFixed(1) }}×</strong>
            <input type="range" :min="scannerZoomMin" :max="scannerZoomMax" :step="scannerZoomStep" :value="scannerZoom" @input="adjustScannerZoom"/>
          </label>
          <div class="scanner-tool-buttons">
            <button v-if="scannerCanFocus" type="button" @click="refocusScanner">◎ Yeniden odakla</button>
            <button v-if="scannerCanTorch" type="button" @click="toggleScannerTorch">{{ scannerTorchOn ? '✦ Flaş kapat' : '✦ Flaş aç' }}</button>
          </div>
        </div>
        <p v-if="scannerMessage" class="center-text" role="status">{{ scannerMessage }}</p>
        <p class="center-text">Çok yakına getirmek yerine 15–25 cm uzaktan netleştirin; gerekiyorsa yakınlaştırın.</p>
        <p v-if="error" class="message error" role="alert">{{ error }}</p>
        <input ref="scannerPhotoInput" class="sr-only" type="file" accept="image/*" capture="environment" @change="decodeScannerPhoto" />
        <button class="submit-primary scanner-photo" type="button" :disabled="scannerPhotoBusy" @click="openScannerPhoto">{{ scannerPhotoBusy ? 'Fotoğraf inceleniyor…' : '📷 Telefon kamerasıyla barkodu fotoğrafla' }}</button>
        <button v-if="!isScanning && !scannerPhotoBusy" class="outlined full" type="button" @click="startScanner(scannerCameraId || undefined)">↻ Canlı kamerayı yeniden başlat</button>
        <p class="center-text">Kamera erişimi için HTTPS ve tarayıcı izni gerekir. Fotoğraflar cihazda incelenir.</p>
        <button class="outlined full" @click="beginLabel">Barkod yok mu? Etiket fotoğrafla →</button>
      </section>

      <section v-else-if="view === 'label'" class="page-screen">
        <button class="back" @click="navigate('home')">← Geri</button>
        <div class="page-eyebrow">02 / ETİKET OKUMA</div>
        <h1>Etiketi <em>okuyalım.</em></h1>
        <p class="page-lead">Fotoğrafı çek, metni kontrol et, sonra analiz et. Görseller cihazında işlenir.</p>
        <div v-if="error" class="message error" role="alert">{{ error }}</div>
        <div v-if="notice" class="message info" role="status">{{ notice }}</div>
        <div class="form-card">
          <div class="fieldrow"><label>Ürün adı <span>(isteğe bağlı)</span><input v-model="labelProductName" placeholder="Örn. Fındık kreması" /></label><label>Marka <span>(isteğe bağlı)</span><input v-model="labelBrand" placeholder="Marka" /></label></div>
          <div class="step-title"><span>1</span><div><strong>İçindekiler listesi</strong><small>İçerik yazısını yakın ve net çek</small></div></div>
          <input ref="ingredientInput" class="sr-only" type="file" accept="image/*" capture="environment" @change="recognizeFile($event, 'ingredients')" />
          <button class="image-upload" :disabled="ocrBusy" @click="clickImageInput('ingredients')"><span>▧</span>{{ ingredientImage ? 'Farklı fotoğraf çek' : 'İçindekileri fotoğrafla' }} <span class="upload-plus">＋</span></button>
          <img v-if="ingredientImage" class="photo-preview" :src="ingredientImage" alt="Seçilen içindekiler fotoğrafı" />
          <label class="text-label" for="ingredient-raw">Okunan içerik <small>• Düzenlenebilir</small></label>
          <textarea id="ingredient-raw" v-model="labelIngredients" rows="4" placeholder="OCR metni burada görünür. İstersen doğrudan yazabilirsin."></textarea>
          <div class="field-divider"></div>
          <div class="step-title"><span>2</span><div><strong>Besin değerleri tablosu</strong><small>100 g veya 100 ml sütununu kontrol et</small></div></div>
          <input ref="nutritionInput" class="sr-only" type="file" accept="image/*" capture="environment" @change="recognizeFile($event, 'nutrition')" />
          <button class="image-upload" :disabled="ocrBusy" @click="clickImageInput('nutrition')"><span>▦</span>{{ nutritionImage ? 'Farklı fotoğraf çek' : 'Besin tablosunu fotoğrafla' }} <span class="upload-plus">＋</span></button>
          <img v-if="nutritionImage" class="photo-preview" :src="nutritionImage" alt="Seçilen besin tablosu fotoğrafı" />
          <div v-if="ocrBusy" class="ocr-progress"><div><strong>Fotoğraf okunuyor</strong><span>{{ ocrProgress }}%</span></div><div class="progress-track"><div :style="{width: ocrProgress + '%'}"></div></div><small>{{ ocrStep }}</small></div>
          <label class="text-label" for="nutrition-raw">Okunan ham metin <small>• Düzenlenebilir</small></label>
          <textarea id="nutrition-raw" v-model="nutritionText" rows="3" placeholder="Besin tablosu metni burada görünür." @blur="applyParsed(nutritionText)"></textarea>
          <div class="basis-row"><span>Etiketteki değerler</span><div class="segment"><button :class="{selected: labelBasis === '100g'}" @click="labelBasis = '100g'">100 g</button><button :class="{selected: labelBasis === '100ml'}" @click="labelBasis = '100ml'">100 ml</button></div></div>
          <div class="nutrition-form"><label v-for="f in nutritionFields" :key="f.key"><span>{{ f.label }} <small>{{ f.unit }}</small></span><input v-model="values[f.key]" inputmode="decimal" placeholder="—" /></label></div>
          <p class="warning-hint">⚠ OCR sonucu hatalı olabilir. Özellikle 100 g / porsiyon ayrımını ve sayıları mutlaka doğrula.</p>
          <button class="submit-primary" :disabled="ocrBusy" @click="analyzeLabel">İçeriği analiz et <span>→</span></button>
          <button class="quiet-button" :disabled="ocrBusy" @click="resetLabel">Formu temizle</button>
        </div>
      </section>

      <section v-else-if="view === 'result' && product && currentReview" class="page-screen result-screen">
        <button class="back" @click="navigate('home')">← Ana sayfa</button>
        <div class="page-eyebrow">ÜRÜN İNCELEMESİ</div>
        <div class="result-product">
          <img v-if="product.imageUrl" :src="product.imageUrl" alt="Ürün ambalajı" referrerpolicy="no-referrer" />
          <span v-else class="result-glyph">✳</span>
          <div><p class="product-brand">{{ product.brand || (product.source === 'etiket' ? 'Etiket fotoğrafından' : 'Open Food Facts') }}</p><h1>{{ product.name }}</h1><p class="product-origin">{{ product.barcode || 'Manuel etiket analizi' }}</p></div>
        </div>
        <div class="summary-panel" :class="{'summary-alert': currentReview.findings.some(f => f.status === 'attention')}">
          <div class="summary-mark">{{ currentReview.findings.some(f => f.status === 'attention') ? '!' : '✓' }}</div>
          <div><strong>{{ currentReview.headline }}</strong><p>{{ currentReview.description }}</p></div>
        </div>
        <div class="metric-pills"><span v-if="product.nutriScore" class="metric-pill">Nutri-Score <strong>{{ product.nutriScore }}</strong></span><span v-if="product.nova" class="metric-pill">NOVA <strong>{{ product.nova }}/4</strong></span><span class="metric-pill muted">{{ product.source === 'etiket' ? 'OCR / Manuel' : 'Open Food Facts' }}</span></div>
        <div class="content-panel"><div class="section-heading"><h2>Dikkat noktaları</h2></div><div v-if="!currentReview.findings.length" class="empty-inline">Yorum üretmek için daha fazla veri gerekebilir.</div><div v-for="(finding,index) in currentReview.findings" :key="index" class="finding"><span class="finding-symbol" :class="finding.status">{{ finding.status === 'attention' ? '!' : finding.status === 'good' ? '✓' : 'i' }}</span><div><strong>{{ finding.title }}</strong><p>{{ finding.description }}</p></div></div></div>
        <div class="content-panel" v-if="knownNutrients.length"><div class="section-heading"><h2>Besin değerleri</h2><span>{{ product.nutritionBasis === 'unknown' ? '100 g / 100 ml' : product.nutritionBasis === '100g' ? '100 g için' : '100 ml için' }}</span></div><div class="nutrient-row" v-for="field in knownNutrients" :key="field.key"><span>{{ field.label }}</span><strong>{{ displayNumber(product.nutrition[field.key]!) }} {{ field.unit }}</strong></div></div>
        <div class="content-panel" v-if="product.ingredients"><div class="section-heading"><h2>İçindekiler</h2></div><p class="ingredient-copy">{{ product.ingredients }}</p><div v-if="additiveCodes.length" class="additive-tags"><span v-for="code in additiveCodes" :key="code">{{ code }}</span></div><p class="ingredient-note">E kodları tek başına zararlı olduğu anlamına gelmez; bu ekran bir güvenlik onayı değildir.</p></div>
        <div v-if="!product.ingredients" class="note-card compact">İçindekiler bilgisi eksik. Ürünün ambalajından kontrol et.</div>
        <p class="attribution" v-if="product.source === 'openfoodfacts'">Veri: <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL). Kullanıcı katkılı bilgiler güncel veya eksiksiz olmayabilir.</p>
        <p class="attribution">Değerlendirmeler bilgilendirme amaçlıdır. Alerji veya özel beslenme gereksinimlerinde ambalajı kontrol edin.</p>
        <button class="outlined full" @click="beginLabel">Etiketten yeni analiz yap →</button>
      </section>

      <section v-else-if="view === 'history'" class="page-screen">
        <button class="back" @click="navigate('home')">← Ana sayfa</button>
        <div class="page-eyebrow">CİHAZDA KAYITLI</div>
        <h1>İnceleme <em>geçmişin.</em></h1>
        <p class="page-lead">Geçmişin bu cihazdaki tarayıcıda tutulur, hesabına gönderilmez.</p>
        <div v-if="error" class="message error">{{ error }}</div>
        <div class="history-list" v-if="history.length"><div v-for="item in history" :key="item.id" class="history-entry"><button @click="showProduct(item)"><span class="small-product-icon">✳</span><span><strong>{{ item.name }}</strong><small>{{ displayDate(item.savedAt) }} · {{ item.source === 'etiket' ? 'Etiket analizi' : 'Barkod sorgusu' }}</small></span></button><button class="delete-button" :aria-label="item.name + ' kaydını sil'" @click="removeHistory(item.id)">×</button></div></div>
        <div v-else class="empty-history"><span>◷</span><h2>Henüz kayıt yok</h2><p>Ürün incelediğinde burada görebileceksin.</p><button class="outlined" @click="navigate('home')">İlk ürünü incele →</button></div>
      </section>
    </main>
    <footer><span>gıda<span class="brand-accent">pusulası</span>.</span><span>Veriye dayalı, anlaşılır seçimler.</span></footer>
  </div>
</template>
