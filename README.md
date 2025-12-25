# Kültür Envanteri Harita Uygulaması

Türkiye Kültür Envanteri noktalarını interaktif harita üzerinde gösteren ve Wikidata entegrasyonu ile zenginleştirilmiş web uygulaması.

## Özellikler

### ✅ Mevcut Özellikler
- 📍 Kültür Envanteri noktalarını harita üzerinde gösterme
- 📊 Excel (.xlsx, .xls) veya CSV dosyası yükleme
- 🔍 Her KE noktasına tıklayınca detaylı bilgi gösterme
- 🗺️ Haritada yakınlaştıkça (zoom ≥ 12) otomatik olarak çevredeki Wikidata QID'lerini sorgulama
- 📏 Seçili noktanın 1 km çevresindeki QID'leri SPARQL ile sorgulama ve gösterme
- 🎨 Farklı renklerle KE ve QID marker'ları (Kırmızı: KE, Mavi: QID)
- 🔗 Wikidata ve Kültür Envanteri linkleri
- 📱 Responsive tasarım

### 🔮 Planlanan Özellikler
- İleride eklenecek özellikler için hazır altyapı

## Kullanım

### 1. Excel Dosyası Formatı

Excel dosyanız şu sütunları içermelidir (sütun başlıkları büyük/küçük harf duyarlı değildir):

**Zorunlu Sütunlar:**
- `KE ID` veya `KEID` veya `ID`: Kültür Envanteri ID numarası
- `Lat` veya `LAT` veya `Latitude`: Enlem
- `Lng` veya `LNG` veya `Longitude`: Boylam

**Opsiyonel Sütunlar:**
- `Başlık` veya `Baslik` veya `Title`: Yapının adı
- `Türler` veya `Turler` veya `Type`: Yapı türü
- `Vikidata` veya `Wikidata` veya `QID`: Wikidata QID
- `Ülke` veya `Ulke` veya `Country`: Ülke
- `Bölge` veya `Bolge` veya `Region`: Bölge
- `İl` veya `Il` veya `Province`: İl
- `İlçe` veya `Ilce` veya `District`: İlçe
- `Mahalle` veya `Neighborhood`: Mahalle
- `Erişim Durumu` veya `Access`: Erişilebilirlik durumu
- `Diğer Adlan` veya `Other Names`: Alternatif isimler

### 2. Dosya Yükleme

1. Sol üst köşedeki "Excel Dosyası Yükle" butonuna tıklayın
2. Excel veya CSV dosyanızı seçin
3. Dosya otomatik olarak işlenecek ve noktalar haritada görünecektir

### 3. Harita Kullanımı

**Kültür Envanteri Noktaları:**
- Kırmızı marker'lar Kültür Envanteri noktalarını gösterir
- Bir noktaya tıklayınca sağ panelde detaylı bilgiler görünür
- Panelde ayrıca 1 km çevresindeki Wikidata QID'leri listelenir

**Wikidata QID Noktaları:**
- Mavi marker'lar Wikidata'dan gelen kültürel miras öğelerini gösterir
- Haritada zoom ≥ 12 seviyesine geldiğinizde otomatik olarak yüklenir
- Marker'lara tıklayınca popup'ta QID ve görsel (varsa) görünür

**Navigasyon:**
- Sol alt köşede renk kodları lejantı bulunur
- Sağ paneli kapatmak için `ESC` tuşuna basın
- Haritada zoom yaparak farklı bölgeleri keşfedin

## Wikidata Entegrasyonu

Uygulama Wikidata SPARQL endpoint'i kullanarak şu kriterlere uyan öğeleri sorgular:

- Türkiye'de (P17: Q43) bulunan
- Kültürel miras örneği (P31/P279*: Q358) VEYA
- Koruma durumu olan (P1435) VEYA
- Arkeolojik sit (P31/P279*: Q839954)

### Sorgulama Stratejisi

1. **Otomatik Yükleme**: Zoom ≥ 12 olduğunda görüntüdeki alandaki tüm QID'ler otomatik yüklenir
2. **Nokta Bazlı**: Bir KE noktasına tıklayınca 1 km çevresindeki QID'ler mesafe sıralı gösterilir
3. **Akıllı Önbellekleme**: Aynı bölge tekrar sorgulanmaz

## Teknik Detaylar

### Kullanılan Kütüphaneler
- **Leaflet.js**: Harita altyapısı
- **Leaflet.markercluster**: Marker kümeleme
- **SheetJS (xlsx)**: Excel dosya okuma
- **Wikidata Query Service**: SPARQL sorguları

### Dosya Yapısı
```
├── index.html          # Ana HTML dosyası
├── app.js             # JavaScript uygulaması
└── README.md          # Bu dosya
```

## GitHub Pages'de Yayınlama

1. Bu dosyaları bir GitHub repository'sine yükleyin
2. Repository Settings > Pages bölümünde:
   - Source: "Deploy from a branch" seçin
   - Branch: `main` (veya `master`) ve `/root` seçin
3. Birkaç dakika sonra siteniz `https://[kullanıcı-adınız].github.io/[repo-adı]/` adresinde yayına girer

## Geliştirme Notları

### Performans Optimizasyonları
- Marker clustering kullanarak yüzlerce noktanın performanslı gösterilmesi
- Akıllı QID önbellekleme sistemi
- Bölgesel SPARQL sorguları

### Güvenlik
- XSS koruması
- CORS güvenli Wikidata entegrasyonu
- Sadece statik dosyalar (sunucu gerektirmez)

## Lisans

MIT License - Özgürce kullanabilir, değiştirebilir ve dağıtabilirsiniz.

## Katkıda Bulunma

Bu proje açık kaynaklıdır. İyileştirmeler ve yeni özellikler için pull request göndermekten çekinmeyin.

## Sorun Giderme

**Excel dosyası yüklenmiyor:**
- Dosyanın .xlsx, .xls veya .csv formatında olduğundan emin olun
- Sütun başlıklarının doğru olduğunu kontrol edin
- Koordinatların sayısal değerler olduğundan emin olun

**QID'ler görünmüyor:**
- Zoom seviyesinin 12 veya üzeri olduğundan emin olun
- İnternet bağlantınızı kontrol edin
- Wikidata Query Service'in çalıştığını kontrol edin

**Harita yüklenmiyor:**
- İnternet bağlantınızı kontrol edin
- Tarayıcı konsolunu açıp hata mesajlarını kontrol edin
- Tarayıcı önbelleğini temizleyin

---

**Geliştirici:** Adem İçduygu  
**Tarih:** Aralık 2025  
**İletişim:** GitHub Issues üzerinden
