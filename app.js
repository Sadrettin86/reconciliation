// Global değişkenler
let map;
let keMarkers = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true, // Cluster'a tıklayınca zoom yapsın
    maxClusterRadius: 50
});
let qidMarkers = L.layerGroup();
let keData = [];
let loadedQidClusters = new Set(); // Hangi bölgelerin QID'leri yüklendiğini takip et
let activeKEMarker = null; // Aktif KE marker
let searchCircle = null; // 1 km arama çemberi
let currentSearchRadius = 1000; // Metre cinsinden (varsayılan 1 km)

// Haritayı başlat
function initMap() {
    map = L.map('map').setView([39.0, 35.0], 6); // Türkiye merkezi
    
    // CartoDB Positron - Minimal ve temiz (tarihi eserler için ideal)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
    
    // Marker gruplarını haritaya ekle
    keMarkers.addTo(map);
    qidMarkers.addTo(map);
    
    // Zoom değişimlerini dinle
    map.on('moveend', onMapMoveEnd);
}

// Excel dosyasını yükle ve işle
document.getElementById('excelFile').addEventListener('change', handleFileUpload);

// Arama yarıçapı kontrolü
const radiusSlider = document.getElementById('searchRadius');
const radiusValue = document.getElementById('radiusValue');

radiusSlider.addEventListener('input', (e) => {
    const kmValue = parseFloat(e.target.value);
    currentSearchRadius = kmValue * 1000; // km'yi metre'ye çevir
    radiusValue.textContent = `${kmValue} km`;
    
    // Eğer aktif bir marker varsa, çemberi güncelle
    if (activeKEMarker && activeKEMarker.keItem) {
        const item = activeKEMarker.keItem;
        showSearchCircle(item.lat, item.lng, currentSearchRadius);
        // QID'leri de yeniden sorgula
        queryNearbyQids(item.lat, item.lng, currentSearchRadius, item.keId);
    }
});

function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    showStatus('Excel dosyası okunuyor...', 'loading');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // İlk sayfayı al
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet);
            
            processExcelData(jsonData);
        } catch (error) {
            showStatus('Dosya okuma hatası: ' + error.message, 'error');
            console.error(error);
        }
    };
    reader.readAsArrayBuffer(file);
}

// Excel verisini işle ve haritaya ekle
function processExcelData(data) {
    keData = [];
    keMarkers.clearLayers();
    
    let validCount = 0;
    let invalidCount = 0;
    
    data.forEach(row => {
        // Sütun başlıklarını kontrol et
        const keId = row['KE ID'] || row['KEID'] || row['ID'];
        const baslik = row['Başlık'] || row['Baslik'] || row['Title'];
        const lat = parseFloat(row['Lat'] || row['LAT'] || row['Latitude']);
        const lng = parseFloat(row['Lng'] || row['LNG'] || row['Longitude']);
        const turler = row['Türler'] || row['Turler'] || row['Type'];
        const vikidata = row['Vikidata'] || row['Wikidata'] || row['QID'];
        const ulke = row['Ülke'] || row['Ulke'] || row['Country'];
        const bolge = row['Bölge'] || row['Bolge'] || row['Region'];
        const il = row['İl'] || row['Il'] || row['Province'];
        const ilce = row['İlçe'] || row['Ilce'] || row['District'];
        const mahalle = row['Mahalle'] || row['Neighborhood'];
        const erisimDurumu = row['Erişim Durumu'] || row['Access'];
        const digerAdlan = row['Diğer Adlan'] || row['Other Names'];
        
        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
            const item = {
                keId,
                baslik,
                lat,
                lng,
                turler,
                vikidata,
                ulke,
                bolge,
                il,
                ilce,
                mahalle,
                erisimDurumu,
                digerAdlan
            };
            
            keData.push(item);
            addKEMarker(item);
            validCount++;
        } else {
            invalidCount++;
        }
    });
    
    // Haritayı marker'lara göre ayarla
    if (keMarkers.getLayers().length > 0) {
        map.fitBounds(keMarkers.getBounds(), { padding: [50, 50] });
    }
    
    showStatus(`${validCount} nokta yüklendi${invalidCount > 0 ? ` (${invalidCount} geçersiz)` : ''}`, 'success');
}

// KE marker ekle
function addKEMarker(item) {
    const marker = L.circleMarker([item.lat, item.lng], {
        radius: 8,
        fillColor: '#e74c3c',
        color: '#c0392b',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8
    });
    
    // Marker'a item referansını ekle
    marker.keItem = item;
    
    marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e); // Harita click event'ini durdur
        showKEInfo(item);
        setActiveKEMarker(marker);
        showSearchCircle(item.lat, item.lng, currentSearchRadius);
    });
    
    // Tooltip ekle
    marker.bindTooltip(`${item.keId}: ${item.baslik || 'İsimsiz'}`, {
        permanent: false,
        direction: 'top'
    });
    
    keMarkers.addLayer(marker);
}

// KE bilgilerini göster
function showKEInfo(item) {
    const panel = document.getElementById('infoPanel');
    panel.style.display = 'block';
    
    const baslik = item.baslik || 'İsimsiz Yapı';
    
    let html = `
        <h2 class="copyable" data-copy="${baslik}" title="Kopyalamak için tıklayın">${baslik}</h2>
        <p><span class="label">KE ID:</span> <span class="copyable" data-copy="${item.keId || ''}" title="Kopyalamak için tıklayın">${item.keId || '-'}</span></p>
        ${item.turler ? `<p><span class="label">Türler:</span> <span class="copyable" data-copy="${item.turler}" title="Kopyalamak için tıklayın">${item.turler}</span></p>` : ''}
        ${item.vikidata ? `<p><span class="label">Wikidata:</span> <a href="https://www.wikidata.org/wiki/${item.vikidata}" target="_blank" class="copyable" data-copy="${item.vikidata}" title="Kopyalamak için tıklayın">${item.vikidata}</a></p>` : ''}
        ${item.il ? `<p><span class="label">İl:</span> <span class="copyable" data-copy="${item.il}" title="Kopyalamak için tıklayın">${item.il}</span></p>` : ''}
        ${item.ilce ? `<p><span class="label">İlçe:</span> <span class="copyable" data-copy="${item.ilce}" title="Kopyalamak için tıklayın">${item.ilce}</span></p>` : ''}
        ${item.mahalle ? `<p><span class="label">Mahalle:</span> <span class="copyable" data-copy="${item.mahalle}" title="Kopyalamak için tıklayın">${item.mahalle}</span></p>` : ''}
        ${item.bolge ? `<p><span class="label">Bölge:</span> <span class="copyable" data-copy="${item.bolge}" title="Kopyalamak için tıklayın">${item.bolge}</span></p>` : ''}
        ${item.erisimDurumu ? `<p><span class="label">Erişim:</span> <span class="copyable" data-copy="${item.erisimDurumu}" title="Kopyalamak için tıklayın">${item.erisimDurumu}</span></p>` : ''}
        ${item.digerAdlan ? `<p><span class="label">Diğer Adlar:</span> <span class="copyable" data-copy="${item.digerAdlan}" title="Kopyalamak için tıklayın">${item.digerAdlan}</span></p>` : ''}
        <p><span class="label">Koordinat:</span> <span class="copyable" data-copy="${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}" title="Kopyalamak için tıklayın">${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}</span></p>
        <hr style="margin: 10px 0;">
        <div id="nearbyQids">
            <div class="loading-spinner"></div> Yakındaki QID'ler sorgulanıyor...
        </div>
    `;
    
    panel.innerHTML = html;
    
    // Kopyalama event listener'larını ekle
    attachCopyListeners();
    
    // Yakındaki QID'leri sorgula
    queryNearbyQids(item.lat, item.lng, currentSearchRadius, item.keId); // KE ID'yi de gönder
}

// Harita hareket ettiğinde tetiklenir
function onMapMoveEnd() {
    const zoom = map.getZoom();
    
    // Sadece yeterince yakınlaştığında QID'leri yükle (zoom >= 12)
    if (zoom >= 12) {
        const bounds = map.getBounds();
        const center = bounds.getCenter();
        
        // Bu bölge daha önce yüklendi mi kontrol et
        const clusterKey = `${Math.floor(center.lat * 10)}_${Math.floor(center.lng * 10)}`;
        
        if (!loadedQidClusters.has(clusterKey)) {
            loadedQidClusters.add(clusterKey);
            queryQidsInBounds(bounds);
        }
    }
}

// Görüntüdeki tüm QID'leri sorgula
function queryQidsInBounds(bounds) {
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const west = bounds.getWest();
    
    const sparql = `
        SELECT DISTINCT ?item ?itemLabel ?coord ?image WHERE {
          SERVICE wikibase:box {
            ?item wdt:P625 ?coord.
            bd:serviceParam wikibase:cornerWest "Point(${west} ${south})"^^geo:wktLiteral.
            bd:serviceParam wikibase:cornerEast "Point(${east} ${north})"^^geo:wktLiteral.
          }
          # Türkiye'deki kültürel miras öğeleri
          {
            ?item wdt:P17 wd:Q43. # Türkiye
            ?item wdt:P31/wdt:P279* wd:Q358. # kültürel miras örneği
          } UNION {
            ?item wdt:P17 wd:Q43.
            ?item wdt:P1435 ?status. # koruma durumu
          } UNION {
            ?item wdt:P17 wd:Q43.
            ?item wdt:P31/wdt:P279* wd:Q839954. # arkeolojik sit
          }
          OPTIONAL { ?item wdt:P18 ?image. }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
        }
        LIMIT 200
    `;
    
    queryWikidata(sparql, addQidMarkers);
}

// Belirli bir noktanın yakınındaki QID'leri sorgula
function queryNearbyQids(lat, lng, radiusMeters, keId) {
    const radiusKm = radiusMeters / 1000;
    
    const sparql = `
        SELECT DISTINCT ?item ?itemLabel ?coord ?distance ?image WHERE {
          SERVICE wikibase:around {
            ?item wdt:P625 ?coord.
            bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral.
            bd:serviceParam wikibase:radius "${radiusKm}".
            bd:serviceParam wikibase:distance ?distance.
          }
          # Türkiye'deki kültürel miras öğeleri
          {
            ?item wdt:P17 wd:Q43. # Türkiye
            ?item wdt:P31/wdt:P279* wd:Q358. # kültürel miras örneği
          } UNION {
            ?item wdt:P17 wd:Q43.
            ?item wdt:P1435 ?status. # koruma durumu
          } UNION {
            ?item wdt:P17 wd:Q43.
            ?item wdt:P31/wdt:P279* wd:Q839954. # arkeolojik sit
          }
          OPTIONAL { ?item wdt:P18 ?image. }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
        }
        ORDER BY ASC(?distance)
        LIMIT 50
    `;
    
    queryWikidata(sparql, (results) => {
        displayNearbyQids(results, keId);
        addQidMarkers(results);
    });
}

// Wikidata SPARQL sorgusu
function queryWikidata(sparql, callback) {
    const url = 'https://query.wikidata.org/sparql?query=' + 
                encodeURIComponent(sparql) + '&format=json';
    
    fetch(url)
        .then(response => response.json())
        .then(data => {
            const results = data.results.bindings;
            callback(results);
        })
        .catch(error => {
            console.error('Wikidata sorgu hatası:', error);
        });
}

// QID marker'larını haritaya ekle
function addQidMarkers(results) {
    results.forEach(result => {
        const coordStr = result.coord.value;
        const match = coordStr.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
        
        if (match) {
            const lng = parseFloat(match[1]);
            const lat = parseFloat(match[2]);
            const qid = result.item.value.split('/').pop();
            const label = result.itemLabel.value;
            const image = result.image ? result.image.value : null;
            
            // Bu QID zaten eklenmiş mi kontrol et
            let alreadyExists = false;
            qidMarkers.eachLayer(layer => {
                if (layer.qid === qid) {
                    alreadyExists = true;
                }
            });
            
            if (!alreadyExists) {
                const marker = L.circleMarker([lat, lng], {
                    radius: 6,
                    fillColor: '#3498db',
                    color: '#2980b9',
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0.6
                });
                
                marker.qid = qid;
                
                // Click event'i durdur - panel kapanmasın
                marker.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                });
                
                let popupContent = `
                    <strong>${label}</strong><br>
                    <a href="https://www.wikidata.org/wiki/${qid}" target="_blank">${qid}</a>
                `;
                
                if (image) {
                    popupContent += `<br><img src="${image}" style="max-width: 200px; margin-top: 5px;" />`;
                }
                
                marker.bindPopup(popupContent);
                
                marker.bindTooltip(label, {
                    permanent: false,
                    direction: 'top'
                });
                
                qidMarkers.addLayer(marker);
            }
        }
    });
}

// Yakındaki QID'leri panel'de göster
function displayNearbyQids(results, keId) {
    const container = document.getElementById('nearbyQids');
    
    if (results.length === 0) {
        container.innerHTML = `
            <p style="color: #999; font-style: italic;">Yakında QID bulunamadı.</p>
            <button onclick="createNewItem('${keId}')" style="
                width: 100%;
                padding: 10px;
                background: #ff9800;
                color: white;
                border: none;
                border-radius: 6px;
                font-weight: 600;
                cursor: pointer;
                margin-top: 10px;
            ">
                🆕 Yeni Öğe Oluştur
            </button>
        `;
        return;
    }
    
    let html = `<h4 style="margin: 10px 0; font-size: 14px;">Yakındaki Wikidata Öğeleri (${results.length})</h4>`;
    html += '<div class="qid-list">';
    
    results.forEach(result => {
        const qid = result.item.value.split('/').pop();
        const label = result.itemLabel.value;
        const distance = result.distance ? 
            `${(parseFloat(result.distance.value)).toFixed(0)}m` : '';
        
        html += `
            <div class="qid-item" data-qid="${qid}">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                    <div style="flex: 1;">
                        <a href="https://www.wikidata.org/wiki/${qid}" target="_blank" class="copyable" data-copy="${qid}" title="QID'yi kopyalamak için tıklayın">${qid}</a>
                        - ${label}
                        ${distance ? `<br><small style="color: #666;">Uzaklık: ${distance}</small>` : ''}
                    </div>
                    <button onclick="matchKEWithQID('${keId}', '${qid}', '${label.replace(/'/g, "\\'")}', event)" 
                            class="match-button"
                            title="Bu QID ile eşleştir">
                        ✓ Eşleştir
                    </button>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    
    // Yeni öğe oluştur butonu
    html += `
        <button onclick="createNewItem('${keId}')" style="
            width: 100%;
            padding: 10px;
            background: #ff9800;
            color: white;
            border: none;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 15px;
        ">
            🆕 Yeni Öğe Oluştur
        </button>
    `;
    
    container.innerHTML = html;
    
    // Kopyalama event listener'larını ekle
    attachCopyListeners();
    
    // Hover event'leri ekle
    attachQidHoverListeners();
}

// Durum mesajını göster
function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = 'status ' + type;
    status.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            status.style.display = 'none';
        }, 5000);
    }
}

// Haritayı başlat
initMap();

// Info panel'i kapatmak için haritaya tıklama
map.on('click', (e) => {
    // Marker'a veya popup'a tıklanmışsa işlem yapma
    if (e.originalEvent.target.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-interactive')) {
        return;
    }
    
    // Panel açıksa ve haritanın boş bir yerine tıklandıysa kapat
    const panel = document.getElementById('infoPanel');
    if (panel.style.display === 'block') {
        closeInfoPanel();
    }
});

// Panel'i kapat ve temizlik yap
function closeInfoPanel() {
    document.getElementById('infoPanel').style.display = 'none';
    
    // Aktif marker'ı normale döndür
    if (activeKEMarker) {
        activeKEMarker.setStyle({
            radius: 8,
            fillColor: '#e74c3c',
            color: '#c0392b',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        });
        
        const markerElement = activeKEMarker.getElement();
        if (markerElement) {
            markerElement.classList.remove('active-ke-marker');
            markerElement.style.filter = ''; // Filter'ı temizle
        }
        
        activeKEMarker = null;
    }
    
    // Arama çemberini kaldır
    if (searchCircle) {
        map.removeLayer(searchCircle);
        searchCircle = null;
    }
}

// ============ GOOGLE SHEETS ENTEGRASYONU ============

// KE ID ile QID'yi eşleştir ve Google Sheets'e kaydet
async function matchKEWithQID(keId, qid, qidLabel, event) {
    const button = event.target;
    const originalText = button.textContent;
    
    button.disabled = true;
    button.textContent = '⏳ Kaydediliyor...';
    
    try {
        // Aktif KE item'ı al
        const keItem = activeKEMarker ? activeKEMarker.keItem : null;
        
        if (!keItem) {
            throw new Error('KE bilgisi bulunamadı');
        }
        
        // QID'nin koordinatlarını al
        const qidCoord = await getQIDCoordinates(qid);
        
        // QID'nin P31 değerini al (instance of)
        const qidP31 = await getQIDP31(qid);
        
        // Google Sheets'e kaydet
        const rowData = {
            keId: keItem.keId,
            keLabel: keItem.baslik || '',
            keTur: keItem.turler || '',
            keKoordinat: `${keItem.lat}, ${keItem.lng}`,
            qid: qid,
            qidLabelTr: qidLabel,
            qidLabelEn: '', // SPARQL'den alınabilir
            qidKoordinat: qidCoord,
            qidP31: qidP31
        };
        
        await saveToGoogleSheets(rowData);
        
        // Başarı bildirimi
        button.textContent = '✓ Kaydedildi';
        button.classList.add('matched');
        button.style.background = '#2196f3';
        
        showNotification(`✅ ${keItem.keId} ↔ ${qid} eşleştirildi ve Google Sheets'e kaydedildi!`, 'success');
        
    } catch (error) {
        console.error('Eşleştirme hatası:', error);
        button.textContent = '❌ Hata';
        button.style.background = '#f44336';
        showNotification(`❌ Hata: ${error.message}`, 'error');
        
        setTimeout(() => {
            button.disabled = false;
            button.textContent = originalText;
            button.style.background = '';
        }, 3000);
    }
}

// Yeni Wikidata öğesi oluştur
async function createNewItem(keId) {
    const keItem = activeKEMarker ? activeKEMarker.keItem : null;
    
    if (!keItem) {
        showNotification('❌ KE bilgisi bulunamadı', 'error');
        return;
    }
    
    if (!confirm(`Yeni Wikidata öğesi oluşturmak istediğinizi onaylıyor musunuz?\n\nKE ID: ${keItem.keId}\nBaşlık: ${keItem.baslik}`)) {
        return;
    }
    
    try {
        // Google Sheets'e "Yeni Öğe" olarak kaydet
        const rowData = {
            keId: keItem.keId,
            keLabel: keItem.baslik || '',
            keTur: keItem.turler || '',
            keKoordinat: `${keItem.lat}, ${keItem.lng}`,
            qid: 'Yeni Öğe',
            qidLabelTr: '',
            qidLabelEn: '',
            qidKoordinat: '',
            qidP31: ''
        };
        
        await saveToGoogleSheets(rowData);
        
        showNotification(`✅ ${keItem.keId} "Yeni Öğe" olarak kaydedildi!`, 'success');
        
    } catch (error) {
        console.error('Yeni öğe hatası:', error);
        showNotification(`❌ Hata: ${error.message}`, 'error');
    }
}

// QID'nin koordinatlarını al
async function getQIDCoordinates(qid) {
    const sparql = `
        SELECT ?coord WHERE {
          wd:${qid} wdt:P625 ?coord.
        }
    `;
    
    try {
        const url = 'https://query.wikidata.org/sparql?query=' + 
                    encodeURIComponent(sparql) + '&format=json';
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.results.bindings.length > 0) {
            const coordStr = data.results.bindings[0].coord.value;
            const match = coordStr.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
            if (match) {
                return `${match[2]}, ${match[1]}`; // lat, lng
            }
        }
        return '';
    } catch (error) {
        console.error('Koordinat alma hatası:', error);
        return '';
    }
}

// QID'nin P31 değerini al
async function getQIDP31(qid) {
    const sparql = `
        SELECT ?p31 ?p31Label WHERE {
          wd:${qid} wdt:P31 ?p31.
          SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
        }
        LIMIT 1
    `;
    
    try {
        const url = 'https://query.wikidata.org/sparql?query=' + 
                    encodeURIComponent(sparql) + '&format=json';
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.results.bindings.length > 0) {
            const p31Qid = data.results.bindings[0].p31.value.split('/').pop();
            const p31Label = data.results.bindings[0].p31Label.value;
            return `${p31Qid} (${p31Label})`;
        }
        return '';
    } catch (error) {
        console.error('P31 alma hatası:', error);
        return '';
    }
}

// Google Sheets'e kaydet
async function saveToGoogleSheets(rowData) {
    // Web App URL kontrolü
    if (GOOGLE_SHEETS_CONFIG.webAppUrl === 'BURAYA_WEB_APP_URL_GELECEK') {
        throw new Error('Google Sheets Web App URL ayarlanmamış! Lütfen README.md dosyasındaki talimatları takip edin.');
    }
    
    const response = await fetch(GOOGLE_SHEETS_CONFIG.webAppUrl, {
        method: 'POST',
        mode: 'no-cors', // CORS bypass için
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action: 'addRow',
            data: rowData
        })
    });
    
    // no-cors modunda response okunamaz, sadece gönderildiğini varsayıyoruz
    console.log('Google Sheets\'e gönderildi:', rowData);
    
    // Alternatif: CORS sorunu yoksa response'u kontrol et
    // const result = await response.json();
    // if (!result.success) {
    //     throw new Error(result.error || 'Kayıt başarısız');
    // }
}

// Bildirim göster
function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#4caf50' : '#f44336'};
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 100000;
        font-size: 14px;
        font-weight: 500;
        max-width: 400px;
        animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 4000);
}

// Wikidata modal'ı aç
let currentWikidataQid = null;

function openWikidataModal(qid, keId) {
    currentWikidataQid = qid;
    
    // Modal'ı göster
    const modal = document.getElementById('wikidataModal');
    modal.classList.add('active');
    
    // KE ID değerini göster
    document.getElementById('modalKeValue').textContent = keId;
    
    // Wikidata butonunu ayarla
    const btn = document.getElementById('openWikidataBtn');
    btn.onclick = () => {
        window.open(`https://www.wikidata.org/wiki/${qid}`, '_blank');
        // Modal'ı kapat
        setTimeout(() => {
            closeWikidataModal();
        }, 500);
    };
}

// Wikidata modal'ı kapat
function closeWikidataModal() {
    const modal = document.getElementById('wikidataModal');
    modal.classList.remove('active');
    currentWikidataQid = null;
}

// Modal dışına tıklayınca kapat
document.addEventListener('click', (e) => {
    const modal = document.getElementById('wikidataModal');
    if (e.target === modal) {
        closeWikidataModal();
    }
});

// ESC ile modal'ı da kapat
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('wikidataModal');
        if (modal.classList.contains('active')) {
            closeWikidataModal();
        } else {
            closeInfoPanel();
        }
    }
});

// Panoya kopyalama fonksiyonu
function copyToClipboard(text, element) {
    if (!text) return;
    
    const originalText = element.textContent;
    
    navigator.clipboard.writeText(text).then(() => {
        // Elementi "Kopyalandı" olarak değiştir
        element.textContent = 'Kopyalandı ✓';
        element.classList.add('copied');
        
        // 1 saniye sonra eski haline döndür
        setTimeout(() => {
            element.textContent = originalText;
            element.classList.remove('copied');
        }, 1000);
    }).catch(err => {
        console.error('Kopyalama hatası:', err);
        // Fallback method
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            element.textContent = 'Kopyalandı ✓';
            element.classList.add('copied');
            setTimeout(() => {
                element.textContent = originalText;
                element.classList.remove('copied');
            }, 1000);
        } catch (err) {
            console.error('Fallback kopyalama hatası:', err);
        }
        document.body.removeChild(textArea);
    });
}

// Kopyalama event listener'larını ekle
function attachCopyListeners() {
    const copyables = document.querySelectorAll('.copyable');
    copyables.forEach(element => {
        // Önceki listener'ı kaldır
        element.replaceWith(element.cloneNode(true));
    });
    
    // Yeni listener'ları ekle
    document.querySelectorAll('.copyable').forEach(element => {
        element.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const textToCopy = element.getAttribute('data-copy');
            if (textToCopy) {
                copyToClipboard(textToCopy, element);
            }
        });
    });
}

// QID hover event'lerini ekle
function attachQidHoverListeners() {
    const qidItems = document.querySelectorAll('.qid-item');
    qidItems.forEach(item => {
        const qid = item.getAttribute('data-qid');
        if (!qid) return;
        
        item.addEventListener('mouseenter', () => {
            highlightQidMarker(qid, true);
            item.classList.add('highlighted');
        });
        
        item.addEventListener('mouseleave', () => {
            highlightQidMarker(qid, false);
            item.classList.remove('highlighted');
        });
    });
}

// Haritada QID marker'ını vurgula
function highlightQidMarker(qid, highlight) {
    qidMarkers.eachLayer(layer => {
        if (layer.qid === qid) {
            if (highlight) {
                layer.setStyle({
                    radius: 10,
                    weight: 4,
                    fillOpacity: 1,
                    className: 'marker-highlight'
                });
                layer.openPopup();
            } else {
                layer.setStyle({
                    radius: 6,
                    weight: 2,
                    fillOpacity: 0.6,
                    className: ''
                });
                layer.closePopup();
            }
        }
    });
}

// Aktif KE marker'ı ayarla
function setActiveKEMarker(marker) {
    // Önceki aktif marker'ı normale döndür
    if (activeKEMarker) {
        activeKEMarker.setStyle({
            radius: 8,
            fillColor: '#e74c3c',
            color: '#c0392b',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        });
        
        const oldElement = activeKEMarker.getElement();
        if (oldElement) {
            oldElement.classList.remove('active-ke-marker');
            oldElement.style.filter = '';
        }
    }
    
    // Yeni marker'ı aktif yap - sadece stil değişikliği, animasyon yok
    activeKEMarker = marker;
    marker.setStyle({
        radius: 12,
        fillColor: '#ff6b6b',
        color: '#ff0000',
        weight: 4,
        opacity: 1,
        fillOpacity: 1
    });
    
    // Glow efekti ekle
    const markerElement = marker.getElement();
    if (markerElement) {
        markerElement.style.filter = 'drop-shadow(0 0 8px #ff0000)';
    }
}

// Arama çemberini göster
function showSearchCircle(lat, lng, radiusMeters) {
    // Önceki çemberi kaldır
    if (searchCircle) {
        map.removeLayer(searchCircle);
    }
    
    // Yeni çember oluştur
    searchCircle = L.circle([lat, lng], {
        radius: radiusMeters,
        color: '#e74c3c',
        fillColor: '#e74c3c',
        fillOpacity: 0.05,
        weight: 2,
        opacity: 0.6,
        dashArray: '10, 10',
        interactive: false // Tıklanamaz yap
    });
    
    searchCircle.addTo(map);
}
                               onmouseout="this.style.color='#9b59b6';"
                               title="Wikidata'da açmak için tıklayın">${q.qid}</a>
                        </div>
                    </div>
                    
                    <!-- Sağ: 30% Buton -->
                    <div style="flex: 0 0 30%; display: flex; align-items: center; justify-content: center;">
                        <a href="#" 
                           onclick="openAddKEModal('${q.qid}', ${activeKEMarker.keItem.id}); return false;" 
                           ontouchend="event.preventDefault(); event.stopPropagation(); openAddKEModal('${q.qid}', ${activeKEMarker.keItem.id});"
                           style="display: block; padding: 6px 8px; background: #4caf50; color: white; border-radius: 4px; font-size: 10px; text-decoration: none; font-weight: bold; text-align: center; width: 100%; touch-action: manipulation; transition: background 0.2s;"
                           onmouseover="this.style.background='#45a049';"
                           onmouseout="this.style.background='#4caf50';">
                            + KE ID<br>Ekle
                        </a>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        container.innerHTML = html;
    });
}

// QID marker highlight
let highlightedQID = null;

function highlightQIDMarker(qid) {
    qidMarkers.eachLayer(marker => {
        if (marker.qid === qid) {
            const highlighted = L.divIcon({
                className: 'qid-marker marker-highlight',
                html: `<div style="background: #f1c40f; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 12px rgba(241, 196, 15, 0.8);"></div>`,
                iconSize: [24, 24]
            });
            marker.setIcon(highlighted);
            highlightedQID = marker;
        }
    });
}

function unhighlightQIDMarker() {
    if (highlightedQID) {
        const normal = L.divIcon({
            className: 'qid-marker',
            html: `<div style="background: #f1c40f; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
            iconSize: [20, 20]
        });
        highlightedQID.setIcon(normal);
        highlightedQID = null;
    }
}

function updateMarkerColor(marker, matched, active = false) {
    const item = marker.keItem;
    
    // Matched veya newItem ise marker'ı gizle
    if (item.newItem || item.matched) {
        marker.remove();
        return;
    }
    
    // Sadece eşleşmemiş (kırmızı) marker'lar görünsün
    const color = '#e74c3c'; // Kırmızı
    
    if (active) {
        // Aktif: Kare (rounded corners) + siyah kenarlık + daha büyük + PULSE animasyon
        const icon = L.divIcon({
            className: 'ke-marker',
            html: `<div style="
                background: ${color}; 
                width: 28px; 
                height: 28px; 
                border-radius: 6px; 
                border: 3px solid #000; 
                box-shadow: 0 4px 8px rgba(0,0,0,0.5);
                animation: pulse 1.5s ease-in-out infinite;
            "></div>
            <style>
                @keyframes pulse {
                    0%, 100% { 
                        opacity: 1; 
                        transform: scale(1); 
                    }
                    50% { 
                        opacity: 0.7; 
                        transform: scale(1.1); 
                    }
                }
            </style>`,
            iconSize: [28, 28]
        });
        marker.setIcon(icon);
    } else {
        // Normal: Yuvarlak
        const icon = L.divIcon({
            className: 'ke-marker',
            html: `<div style="background: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
            iconSize: [20, 20]
        });
        marker.setIcon(icon);
    }
}

function showSearchCircle(lat, lng, radius) {
    if (searchCircle) {
        map.removeLayer(searchCircle);
    }
    
    searchCircle = L.circle([lat, lng], {
        radius: radius,
        color: '#3498db',
        fillColor: '#3498db',
        fillOpacity: 0.1,
        weight: 2,
        dashArray: '5, 5'
    }).addTo(map);
}

async function loadNearbyQIDs(lat, lng, radius) {
    qidMarkers.clearLayers();
    
    const radiusKm = radius / 1000;
    
    const query = `
    SELECT ?item ?itemLabel ?location WHERE {
      SERVICE wikibase:around {
        ?item wdt:P625 ?location.
        bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral.
        bd:serviceParam wikibase:radius "${radiusKm}".
      }
      FILTER EXISTS { ?item wdt:P31 ?type }
      FILTER NOT EXISTS { ?item wdt:P11729 ?keId }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
    }
    `;
    
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        displayQIDMarkers(data.results.bindings);
        displayQIDList(data.results.bindings);
        
    } catch (error) {
        console.error('Error loading QIDs:', error);
        const container = document.getElementById('qidListContainer');
        if (container) {
            container.innerHTML = '<p style="color: #e74c3c; text-align: center;">Yüklenemedi</p>';
        }
    }
}

function displayQIDMarkers(results) {
    results.forEach(result => {
        const qid = result.item.value.split('/').pop();
        const label = result.itemLabel.value;
        const coords = result.location.value.match(/Point\(([^ ]+) ([^ ]+)\)/);
        
        if (coords) {
            const lng = parseFloat(coords[1]);
            const lat = parseFloat(coords[2]);
            
            const icon = L.divIcon({
                className: 'qid-marker',
                html: `<div style="background: #f1c40f; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
                iconSize: [20, 20]
            });
            
            const marker = L.marker([lat, lng], { icon: icon });
            marker.bindPopup(`<strong>${label}</strong><br>QID: ${qid}`);
            
            // Hover delay için timeout referansı
            let hoverTimeout = null;
            
            // QID marker'a mouse gelince sidebar'da highlight (500ms delay)
            marker.on('mouseover', () => {
                // Önceki timeout'u iptal et
                if (hoverTimeout) {
                    clearTimeout(hoverTimeout);
                }
                
                // 500ms sonra highlight et
                hoverTimeout = setTimeout(() => {
                    const sidebarItem = document.getElementById('qid-item-' + qid);
                    if (sidebarItem) {
                        // Scroll to item
                        sidebarItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        
                        // Turuncu highlight
                        sidebarItem.style.background = '#ffc107';
                        sidebarItem.style.transition = 'background 0.3s';
                    }
                }, 500);
            });
            
            marker.on('mouseout', () => {
                // Timeout'u iptal et (mouse çıktı, highlight yapma)
                if (hoverTimeout) {
                    clearTimeout(hoverTimeout);
                    hoverTimeout = null;
                }
                
                const sidebarItem = document.getElementById('qid-item-' + qid);
                if (sidebarItem) {
                    // Gri'ye dön
                    sidebarItem.style.background = '#f8f9fa';
                }
            });
            
            marker.qid = qid; // QID'yi marker'a ekle
            qidMarkers.addLayer(marker);
        }
    });
    
    console.log(`Displayed ${results.length} QID markers`);
}

function onMapMoveEnd() {
    // Lazy loading
}

function updateStats() {
    const matched = keData.filter(item => item.matched).length;
    const newItems = keData.filter(item => item.newItem).length;
    const total = keData.length;
    const unmatched = total - matched - newItems;
    
    document.getElementById('totalPoints').textContent = total.toLocaleString();
    document.getElementById('matchedPoints').textContent = matched.toLocaleString();
    document.getElementById('unmatchedPoints').textContent = unmatched.toLocaleString();
    document.getElementById('newItemPoints').textContent = newItems.toLocaleString();
}

function setupRadiusSlider() {
    const radiusSlider = document.getElementById('searchRadius');
    const radiusValue = document.getElementById('radiusValue');
    
    // localStorage'dan yükle (varsayılan: 100m)
    const savedRadius = localStorage.getItem('searchRadius');
    if (savedRadius) {
        currentSearchRadius = parseInt(savedRadius);
        radiusSlider.value = currentSearchRadius;
        radiusValue.textContent = `${currentSearchRadius} m`;
    } else {
        currentSearchRadius = 100; // Varsayılan 100m
        radiusSlider.value = 100;
        radiusValue.textContent = '100 m';
    }
    
    radiusSlider.addEventListener('input', (e) => {
        const meterValue = parseInt(e.target.value);
        currentSearchRadius = meterValue;
        radiusValue.textContent = `${meterValue} m`;
        
        // localStorage'a kaydet
        localStorage.setItem('searchRadius', meterValue);
        
        // KE marker aktifse
        if (activeKEMarker && activeKEMarker.keItem) {
            const item = activeKEMarker.keItem;
            showSearchCircle(item.lat, item.lng, currentSearchRadius);
            
            // Yarıçapa göre zoom yap
            const radiusKm = currentSearchRadius / 1000;
            let zoomLevel;
            if (radiusKm <= 0.1) zoomLevel = 18;
            else if (radiusKm <= 0.2) zoomLevel = 17;
            else if (radiusKm <= 0.5) zoomLevel = 16;
            else zoomLevel = 15;
            
            map.setView([item.lat, item.lng], zoomLevel, { animate: true, duration: 0.5 });
            loadNearbyQIDs(item.lat, item.lng, currentSearchRadius);
        }
        // Koordinat arama aktifse
        else if (activeCoordinate) {
            showSearchCircle(activeCoordinate.lat, activeCoordinate.lng, currentSearchRadius);
            loadNearbyQIDsForCoordinate(activeCoordinate.lat, activeCoordinate.lng);
            
            // Sidebar başlığını güncelle (yarıçap bilgisi)
            const panelHeader = document.getElementById('panelHeader');
            if (panelHeader) {
                const h3 = panelHeader.querySelector('h3');
                if (h3) {
                    h3.textContent = `Yakındaki Wikidata Öğeleri (${currentSearchRadius} m)`;
                }
            }
        }
    });
}

// Mobilde slider göster
function showMobileSlider() {
    let slider = document.getElementById('mobileRadiusSlider');
    
    if (!slider) {
        // Slider yoksa oluştur
        slider = document.createElement('div');
        slider.id = 'mobileRadiusSlider';
        slider.className = 'mobile-radius-slider';
        slider.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 11px; font-weight: 600; color: #555; white-space: nowrap; min-width: 100px;">
                    Yarıçap: <span id="mobileRadiusValue">${currentSearchRadius}m</span>
                </span>
                <input type="range" id="mobileSearchRadius" min="50" max="1000" step="50" value="${currentSearchRadius}" 
                       style="flex: 1;" 
                       oninput="updateMobileRadius(this.value)" />
            </div>
        `;
        document.body.appendChild(slider);
    } else {
        // Slider varsa sadece değeri güncelle
        const mobileSlider = document.getElementById('mobileSearchRadius');
        const mobileValue = document.getElementById('mobileRadiusValue');
        if (mobileSlider) mobileSlider.value = currentSearchRadius;
        if (mobileValue) mobileValue.textContent = `${currentSearchRadius}m`;
    }
}

// Mobilde arama yarıçapı değiştiğinde
function updateMobileRadius(value) {
    const meterValue = parseInt(value);
    currentSearchRadius = meterValue;
    
    // Mobil slider değerini güncelle
    const mobileValueSpan = document.getElementById('mobileRadiusValue');
    if (mobileValueSpan) {
        mobileValueSpan.textContent = `${meterValue}m`;
    }
    
    // Desktop slider'ı da senkronize et (varsa)
    const desktopSlider = document.getElementById('searchRadius');
    if (desktopSlider) {
        desktopSlider.value = meterValue;
    }
    const desktopValue = document.getElementById('radiusValue');
    if (desktopValue) {
        desktopValue.textContent = `${meterValue} m`;
    }
    
    // localStorage'a kaydet
    localStorage.setItem('searchRadius', meterValue);
    
    // Aktif marker varsa çemberi güncelle
    if (activeKEMarker && activeKEMarker.keItem) {
        const item = activeKEMarker.keItem;
        showSearchCircle(item.lat, item.lng, currentSearchRadius);
        
        // Mobilde çemberi tekrar ortala
        if (window.innerWidth <= 768) {
            updateMobileCirclePosition();
        }
        
        // QID'leri tekrar yükle
        loadNearbyQIDs(item.lat, item.lng, currentSearchRadius);
    }
}

// Mobil sidebar resize localStorage
// Mobilde resize handle ekle
function addMobileResizeHandle() {
    const panel = document.getElementById('infoPanel');
    if (!panel) return;
    
    // Mevcut handle'ı kaldır
    const existingHandle = document.getElementById('mobileResizeHandle');
    if (existingHandle) {
        existingHandle.remove();
    }
    
    let startY = 0;
    let startHeight = 0;
    let isResizing = false;
    
    // Resize handle oluştur
    const resizeHandle = document.createElement('div');
    resizeHandle.id = 'mobileResizeHandle';
    resizeHandle.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 40px;
        cursor: ns-resize;
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: center;
        touch-action: none;
        -webkit-user-select: none;
        user-select: none;
    `;
    
    // Visual indicator
    const handleIndicator = document.createElement('div');
    handleIndicator.style.cssText = `
        width: 50px;
        height: 5px;
        background: #95a5a6;
        border-radius: 3px;
        pointer-events: none;
    `;
    resizeHandle.appendChild(handleIndicator);
    
    // Touch start
    resizeHandle.addEventListener('touchstart', (e) => {
        isResizing = true;
        startY = e.touches[0].clientY;
        startHeight = panel.offsetHeight;
        handleIndicator.style.background = '#7f8c8d'; // Darker on touch
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false });
    
    // Touch move
    const handleTouchMove = (e) => {
        if (!isResizing) return;
        
        const currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        const newHeight = startHeight + deltaY;
        
        // Min/max constraints
        const minHeight = window.innerHeight * 0.2; // 20vh
        const maxHeight = window.innerHeight * 0.9; // 90vh
        
        if (newHeight >= minHeight && newHeight <= maxHeight) {
            panel.style.height = newHeight + 'px';
        }
        
        e.preventDefault();
        e.stopPropagation();
    };
    
    // Touch end
    const handleTouchEnd = () => {
        if (isResizing) {
            isResizing = false;
            handleIndicator.style.background = '#95a5a6'; // Back to normal
            const finalHeight = panel.offsetHeight;
            localStorage.setItem('sidebarHeightMobile', Math.round(finalHeight));
            
            // Çemberi yeniden ortala
            if (activeKEMarker && activeKEMarker.keItem) {
                updateMobileCirclePosition();
            }
        }
    };
    
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);
    
    panel.appendChild(resizeHandle);
}

function setupSidebarResize() {
    const panel = document.getElementById('infoPanel');
    if (!panel) return;
    
    const isMobile = window.innerWidth <= 768;
    
    // localStorage'dan yükle
    if (isMobile) {
        const savedMobileHeight = localStorage.getItem('sidebarHeightMobile');
        if (savedMobileHeight) {
            panel.style.height = savedMobileHeight + 'px';
        }
    } else {
        const savedHeight = localStorage.getItem('sidebarHeight');
        if (savedHeight) {
            panel.style.height = savedHeight + 'px';
        }
    }
    
    // ResizeObserver ile boyut değişimini izle (desktop için)
    if (!isMobile) {
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const height = entry.contentRect.height;
                if (height >= 300) {
                    localStorage.setItem('sidebarHeight', Math.round(height));
                }
            }
        });
        
        resizeObserver.observe(panel);
    }
}

// Mobilde çemberi sidebar yüksekliğine göre ortala
function updateMobileCirclePosition() {
    if (!activeKEMarker || !activeKEMarker.keItem) return;
    if (window.innerWidth > 768) return;
    
    const item = activeKEMarker.keItem;
    const panel = document.getElementById('infoPanel');
    const panelHeight = panel ? panel.offsetHeight : window.innerHeight * 0.5;
    
    const radiusKm = currentSearchRadius / 1000;
    let zoomLevel;
    if (radiusKm <= 0.1) zoomLevel = 18;
    else if (radiusKm <= 0.2) zoomLevel = 17;
    else if (radiusKm <= 0.5) zoomLevel = 16;
    else zoomLevel = 15;
    
    const mapContainer = map.getContainer();
    const mapHeight = mapContainer.offsetHeight;
    const visibleMapHeight = mapHeight - panelHeight;
    
    // Görünen harita alanının ortasına kaydır
    const offsetY = panelHeight + (visibleMapHeight / 2) - (mapHeight / 2);
    
    const point = map.project([item.lat, item.lng], zoomLevel);
    point.y += offsetY;
    const newCenter = map.unproject(point, zoomLevel);
    
    map.setView(newCenter, zoomLevel, { animate: false });
}

// ============================================
// SAYFA BAŞLATMA
// ============================================
document.addEventListener('DOMContentLoaded', initMap);

// ============================================
// WIKIDATA EDIT API - P11729 (KE ID) EKLEME
// ============================================

// Add P11729 (Kültür Envanteri ID) to Wikidata item via Worker
async function addKEIDToWikidata(qid, keId) {
    // Check if user is logged in
    if (!currentUser || !currentUser.accessToken) {
        alert('Bu işlem için giriş yapmalısınız.');
        return false;
    }
    
    try {
        console.log(`📝 Adding P11729: ${keId} to ${qid}`);
        
        // Use Cloudflare Worker proxy
        const PROXY_URL = 'https://keharita-oauth.ademozcna.workers.dev';
        
        const response = await fetch(PROXY_URL + '/add-claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                access_token: currentUser.accessToken,
                qid: qid,
                property: 'P11729',
                value: keId.toString()
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Unknown error');
        }
        
        const data = await response.json();
        console.log('✅ P11729 successfully added:', data);
        
        return true;
        
    } catch (error) {
        console.error('❌ Wikidata edit error:', error);
        throw error;
    }
}

function openAddKEModal(qid, keId) {
    // Eğer giriş yapılmışsa, direkt Wikidata'ya ekle
    if (currentUser && currentUser.accessToken) {
        // Loading state
        const button = event.target;
        const originalText = button.innerHTML;
        button.innerHTML = '⏳';
        button.style.pointerEvents = 'none';
        
        addKEIDToWikidata(qid, keId)
            .then(() => {
                alert('Eklendi!');
                
                // Refresh QID list
                if (activeKEMarker) {
                    loadNearbyQIDs(activeKEMarker.keItem.lat, activeKEMarker.keItem.lng, currentSearchRadius);
                }
            })
            .catch(error => {
                alert('Hata: ' + error.message);
            })
            .finally(() => {
                button.innerHTML = originalText;
                button.style.pointerEvents = 'auto';
            });
    } else {
        // Giriş yapılmamış - modal göster
        document.getElementById('modalKeValue').textContent = keId;
        document.getElementById('openWikidataBtn').onclick = function() {
            window.open(`https://www.wikidata.org/wiki/${qid}`, '_blank');
            closeWikidataModal();
        };
        document.getElementById('wikidataModal').classList.add('active');
    }
}

function closeWikidataModal() {
    document.getElementById('wikidataModal').classList.remove('active');
}
