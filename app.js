// Global değişkenler
let map;
let keMarkers = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 50
});
let qidMarkers = L.layerGroup();
let keData = [];
let loadedQidClusters = new Set(); // Hangi bölgelerin QID'leri yüklendiğini takip et

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
    
    marker.on('click', () => showKEInfo(item));
    
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
    
    let html = `
        <h3>Kültür Envanteri Detayları</h3>
        <p><span class="label">KE ID:</span> <span class="copyable" data-copy="${item.keId || ''}" title="Kopyalamak için tıklayın">${item.keId || '-'}</span></p>
        <p><span class="label">Başlık:</span> <span class="copyable" data-copy="${item.baslik || ''}" title="Kopyalamak için tıklayın">${item.baslik || '-'}</span></p>
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
    queryNearbyQids(item.lat, item.lng, 1000, item.keId); // KE ID'yi de gönder
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
        container.innerHTML = '<p style="color: #999; font-style: italic;">Yakında QID bulunamadı.</p>';
        return;
    }
    
    let html = `<h4 style="margin: 10px 0; font-size: 14px;">Yakındaki Wikidata Öğeleri (${results.length})</h4>`;
    html += '<div class="qid-list">';
    
    results.forEach(result => {
        const qid = result.item.value.split('/').pop();
        const label = result.itemLabel.value;
        const distance = result.distance ? 
            `${(parseFloat(result.distance.value)).toFixed(0)}m` : '';
        
        // KE ID ekleme URL'i oluştur
        const addKeUrl = `https://www.wikidata.org/wiki/${qid}?action=add-statement&property=P11729&value=${encodeURIComponent(keId || '')}`;
        
        html += `
            <div class="qid-item" data-qid="${qid}">
                <a href="https://www.wikidata.org/wiki/${qid}" target="_blank" class="copyable" data-copy="${qid}" title="QID'yi kopyalamak için tıklayın">${qid}</a>
                ${keId ? `<a href="${addKeUrl}" target="_blank" class="add-ke-button" title="KE ID ekle">+ KE ID</a>` : ''}
                - ${label}
                ${distance ? `<br><small style="color: #666;">Uzaklık: ${distance}</small>` : ''}
            </div>
        `;
    });
    
    html += '</div>';
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
    if (e.originalEvent.target.closest('.leaflet-marker-icon, .leaflet-popup')) {
        return; // Marker'a tıklandıysa panel'i kapatma
    }
    // Panel açıksa ve haritanın boş bir yerine tıklandıysa kapat
    const panel = document.getElementById('infoPanel');
    if (panel.style.display === 'block') {
        // Sadece Escape tuşu ile kapatmak için bu satırı kaldırabilirsiniz
        // panel.style.display = 'none';
    }
});

// Escape tuşu ile panel'i kapat
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('infoPanel').style.display = 'none';
    }
});

// Panoya kopyalama fonksiyonu
function copyToClipboard(text) {
    if (!text) return;
    
    navigator.clipboard.writeText(text).then(() => {
        showCopyNotification(`Kopyalandı: ${text}`);
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
            showCopyNotification(`Kopyalandı: ${text}`);
        } catch (err) {
            console.error('Fallback kopyalama hatası:', err);
        }
        document.body.removeChild(textArea);
    });
}

// Kopyalama bildirimi göster
function showCopyNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        document.body.removeChild(notification);
    }, 1500);
}

// Kopyalama event listener'larını ekle
function attachCopyListeners() {
    const copyables = document.querySelectorAll('.copyable');
    copyables.forEach(element => {
        element.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const textToCopy = element.getAttribute('data-copy');
            if (textToCopy) {
                copyToClipboard(textToCopy);
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
