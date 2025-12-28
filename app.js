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
let loadedQidClusters = new Set();
let activeKEMarker = null;
let searchCircle = null;
let currentSearchRadius = 1000; // Metre

// Haritayı başlat
function initMap() {
    map = L.map('map').setView([39.0, 35.0], 6);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
    
    keMarkers.addTo(map);
    qidMarkers.addTo(map);
    
    map.on('moveend', onMapMoveEnd);
    
    // Encoded data varsa yükle
    loadEncodedData();
    
    // Periyodik güncelleme - her 10 saniyede GitHub'dan yeni öğeleri çek
    // Token ile: 5000/saat limit (yeterli)
    // Token olmadan: 60/saat limit (dikkatli kullanın veya token ekleyin)
    setInterval(async () => {
        console.log('🔄 Yeni öğeler kontrol ediliyor...');
        await loadNewItemsFromStorage();
    }, 10000); // 10 saniye
}

// Encoded KE verisini yükle (data.js dosyasından)
function loadEncodedData() {
    if (typeof encodedKEData === 'undefined') {
        console.log('No encoded data found. Use Excel upload or add data.js');
        return;
    }
    
    try {
        // Base64 decode
        const decoded = atob(encodedKEData);
        const data = JSON.parse(decoded);
        
        console.log(`✅ Loaded ${data.length} points from encoded data`);
        
        // Format: {i: id, n: name, t: type, la: lat, lo: lng, c: country, r: region, ci: city, d: district, m: mahalle, a: access}
        keData = data.map(point => ({
            id: point.i,
            name: point.n || '',
            type: point.t || '',
            lat: point.la,
            lng: point.lo,
            country: point.c || '',
            region: point.r || '',
            city: point.ci || '',
            district: point.d || '',
            mahalle: point.m || '',
            access: point.a || '',
            matched: false,
            newItem: false  // Yeni öğe mi?
        }));
        
        displayKEData();
        updateStats();
        
        // LocalStorage'dan yeni öğeleri yükle
        loadNewItemsFromStorage();
        
        console.log('Sample data:', keData[0]);
        
    } catch (error) {
        console.error('Error loading encoded data:', error);
    }
}

// Excel dosyası yükleme (opsiyonel - encoded data varsa gerek yok)
document.getElementById('excelFile').addEventListener('change', handleFileUpload);

function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);
        
        processExcelData(jsonData);
    };
    reader.readAsArrayBuffer(file);
}

function processExcelData(data) {
    keData = data.map((row, index) => {
        // Sütun isimlerini esnek şekilde bul
        const keId = row['KE ID'] || row['ke_id'] || row['ID'] || row['id'];
        const name = row['Başlık'] || row['baslik'] || row['name'] || row['Name'];
        const type = row['Türler'] || row['turler'] || row['type'] || row['Type'];
        const lat = row['Lat'] || row['lat'] || row['Latitude'] || row['latitude'];
        const lng = row['Lng'] || row['lng'] || row['Longitude'] || row['longitude'];
        const country = row['Ülke'] || row['ulke'] || row['country'] || row['Country'];
        const region = row['Bölge'] || row['bolge'] || row['region'] || row['Region'];
        const city = row['İl'] || row['il'] || row['city'] || row['City'];
        const district = row['İlçe'] || row['ilce'] || row['district'] || row['District'];
        const mahalle = row['Mahalle'] || row['mahalle'] || row['neighborhood'];
        const access = row['Erişim Durumu'] || row['erisim'] || row['access'];
        
        return {
            id: keId,
            name: name || '',
            type: type || '',
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            country: country || '',
            region: region || '',
            city: city || '',
            district: district || '',
            mahalle: mahalle || '',
            access: access || '',
            matched: false,
            index: index
        };
    }).filter(item => item.id && !isNaN(item.lat) && !isNaN(item.lng));
    
    console.log(`Processed ${keData.length} points from Excel with full data`);
    console.log('Sample:', keData[0]);
    
    displayKEData();
    updateStats();
}

// KE verilerini haritada göster
function displayKEData() {
    keMarkers.clearLayers();
    
    keData.forEach(item => {
        let color;
        if (item.newItem) {
            color = '#3498db'; // Mavi - Yeni öğe
        } else if (item.matched) {
            color = '#27ae60'; // Yeşil - Eşleşmiş
        } else {
            color = '#e74c3c'; // Kırmızı - Eşleşmemiş
        }
        
        const icon = L.divIcon({
            className: 'ke-marker',
            html: `<div style="background: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
            iconSize: [12, 12]
        });
        
        const marker = L.marker([item.lat, item.lng], { icon: icon });
        
        // Zengin popup içeriği
        const statusBadge = item.newItem 
            ? '<span style="background: #3498db; color: white; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 600;">YENİ ÖĞE</span>'
            : item.matched 
            ? '<span style="background: #27ae60; color: white; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 600;">EŞLEŞMİŞ</span>'
            : '<span style="background: #e74c3c; color: white; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 600;">EŞLEŞMEMİŞ</span>';
        
        const popupContent = `
            <div style="min-width: 200px;">
                <h3 style="margin: 0 0 10px 0; color: #2c3e50; font-size: 14px; border-bottom: 2px solid #3498db; padding-bottom: 5px;">
                    ${item.name || 'İsimsiz'}
                </h3>
                <div style="margin-bottom: 10px;">${statusBadge}</div>
                <table style="width: 100%; font-size: 12px;">
                    <tr><td style="color: #7f8c8d; padding: 2px 0;"><strong>KE ID:</strong></td><td>${item.id}</td></tr>
                    ${item.type ? `<tr><td style="color: #7f8c8d; padding: 2px 0;"><strong>Tür:</strong></td><td>${item.type}</td></tr>` : ''}
                    ${item.city ? `<tr><td style="color: #7f8c8d; padding: 2px 0;"><strong>İl:</strong></td><td>${item.city}</td></tr>` : ''}
                    ${item.district ? `<tr><td style="color: #7f8c8d; padding: 2px 0;"><strong>İlçe:</strong></td><td>${item.district}</td></tr>` : ''}
                    ${item.mahalle ? `<tr><td style="color: #7f8c8d; padding: 2px 0;"><strong>Mahalle:</strong></td><td>${item.mahalle}</td></tr>` : ''}
                    ${item.region ? `<tr><td style="color: #7f8c8d; padding: 2px 0;"><strong>Bölge:</strong></td><td>${item.region}</td></tr>` : ''}
                    ${item.access ? `<tr><td style="color: #7f8c8d; padding: 2px 0;"><strong>Erişim:</strong></td><td>${item.access}</td></tr>` : ''}
                </table>
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ecf0f1;">
                    <small style="color: #95a5a6;">📍 ${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}</small>
                </div>
                ${item.newItem ? '' : `
                <div style="margin-top: 10px;">
                    <button onclick="markAsNewItem(${item.id})" style="width: 100%; padding: 8px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
                        ➕ Yeni Öğe Olarak İşaretle
                    </button>
                </div>
                `}
            </div>
        `;
        
        marker.bindPopup(popupContent);
        marker.on('click', () => selectKEMarker(marker, item));
        marker.keItem = item;
        
        keMarkers.addLayer(marker);
    });
    
    console.log(`Displayed ${keData.length} KE markers with full info`);
}

// KE marker seçildiğinde
function selectKEMarker(marker, item) {
    // Önceki aktif marker'ı sıfırla
    if (activeKEMarker) {
        updateMarkerColor(activeKEMarker, activeKEMarker.keItem.matched);
    }
    
    // Yeni marker'ı aktif yap
    activeKEMarker = marker;
    updateMarkerColor(marker, item.matched, true);
    
    // Arama çemberini göster
    showSearchCircle(item.lat, item.lng, currentSearchRadius);
    
    // Yakındaki QID'leri yükle
    loadNearbyQIDs(item.lat, item.lng, currentSearchRadius);
    
    console.log(`Selected KE ${item.id} at ${item.lat}, ${item.lng}`);
}

// Marker rengini güncelle
function updateMarkerColor(marker, matched, active = false) {
    let color;
    if (active) {
        color = '#3498db'; // Mavi (aktif)
    } else {
        color = matched ? '#27ae60' : '#e74c3c'; // Yeşil/Kırmızı
    }
    
    const icon = L.divIcon({
        className: 'ke-marker',
        html: `<div style="background: ${color}; width: ${active ? 16 : 12}px; height: ${active ? 16 : 12}px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></div>`,
        iconSize: [active ? 16 : 12, active ? 16 : 12]
    });
    
    marker.setIcon(icon);
}

// Arama çemberini göster
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

// Yakındaki QID'leri Wikidata'dan yükle
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
      SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
    }
    LIMIT 100
    `;
    
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        displayQIDMarkers(data.results.bindings);
        
    } catch (error) {
        console.error('Error loading QIDs:', error);
    }
}

// QID marker'larını göster
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
                html: `<div style="background: #9b59b6; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
                iconSize: [10, 10]
            });
            
            const marker = L.marker([lat, lng], { icon: icon });
            marker.bindPopup(`<strong>${label}</strong><br>QID: ${qid}`);
            
            qidMarkers.addLayer(marker);
        }
    });
    
    console.log(`Displayed ${results.length} QID markers`);
}

// Harita hareket ettiğinde
function onMapMoveEnd() {
    // Gerekirse burada lazy loading yapılabilir
}

// İstatistikleri güncelle
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

// Arama yarıçapı kontrolü
const radiusSlider = document.getElementById('searchRadius');
const radiusValue = document.getElementById('radiusValue');

radiusSlider.addEventListener('input', (e) => {
    const kmValue = parseFloat(e.target.value);
    currentSearchRadius = kmValue * 1000;
    radiusValue.textContent = `${kmValue} km`;
    
    if (activeKEMarker && activeKEMarker.keItem) {
        const item = activeKEMarker.keItem;
        showSearchCircle(item.lat, item.lng, currentSearchRadius);
        loadNearbyQIDs(item.lat, item.lng, currentSearchRadius);
    }
});

// Sayfa yüklendiğinde haritayı başlat
document.addEventListener('DOMContentLoaded', initMap);

// GitHub configuration
const GITHUB_REPO = 'Sadrettin86/reconciliation';
const GITHUB_FILE = 'yeni-ogeler.txt';

// Yeni öğe olarak işaretle
async function markAsNewItem(keId) {
    const item = keData.find(i => i.id === keId);
    if (!item) return;
    
    // Token kontrolü
    let token = localStorage.getItem('githubToken');
    if (!token) {
        token = prompt('GitHub Personal Access Token girin:\n\n1. GitHub.com → Settings → Developer settings\n2. Personal access tokens → Generate new token\n3. Scope: "repo" seçin\n4. Token\'ı kopyalayıp buraya yapıştırın');
        if (!token) {
            alert('❌ Token olmadan yeni öğe eklenemez!');
            return;
        }
        localStorage.setItem('githubToken', token);
    }
    
    // Durumu güncelle
    item.newItem = true;
    item.matched = false;
    
    // GitHub'a commit et
    try {
        await addToGitHubFile(keId, token);
        
        // Haritayı güncelle
        displayKEData();
        updateStats();
        
        // Bildirim
        alert(`✅ KE ID ${keId} "Yeni Öğe" olarak işaretlendi ve GitHub'a eklendi!\n\nhttps://github.com/${GITHUB_REPO}/blob/main/${GITHUB_FILE}`);
    } catch (error) {
        console.error('GitHub commit hatası:', error);
        
        if (error.message.includes('401')) {
            // Token geçersiz
            localStorage.removeItem('githubToken');
            alert('❌ GitHub token geçersiz! Lütfen yeni bir token alın ve tekrar deneyin.');
        } else {
            alert('❌ GitHub\'a eklenirken hata oluştu: ' + error.message);
        }
    }
}

// GitHub'a dosya commit et
async function addToGitHubFile(keId, token) {
    // 1. Önce mevcut dosyayı al
    let currentContent = '';
    let currentSha = null;
    
    try {
        const getResponse = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );
        
        if (getResponse.ok) {
            const data = await getResponse.json();
            currentContent = atob(data.content); // Base64 decode
            currentSha = data.sha;
            
            // Zaten var mı kontrol et
            if (currentContent.includes(keId.toString())) {
                console.log(`KE ID ${keId} zaten listede`);
                return;
            }
        }
    } catch (error) {
        console.log('Dosya yok, yeni oluşturulacak');
    }
    
    // 2. Yeni satırı ekle
    const newContent = currentContent + keId + '\n';
    const encodedContent = btoa(unescape(encodeURIComponent(newContent))); // Base64 encode
    
    // 3. Commit et
    const commitData = {
        message: `Yeni öğe eklendi: KE ID ${keId}`,
        content: encodedContent
    };
    
    if (currentSha) {
        commitData.sha = currentSha; // Dosya varsa SHA gerekli
    }
    
    const putResponse = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
        {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(commitData)
        }
    );
    
    if (!putResponse.ok) {
        const error = await putResponse.json();
        throw new Error(error.message || 'GitHub commit başarısız');
    }
    
    console.log(`✅ KE ID ${keId} GitHub'a eklendi`);
    return putResponse.json();
}

// LocalStorage'dan yeni öğeleri yükle (sayfa yüklenirken)
async function loadNewItemsFromStorage() {
    // GitHub'dan yeni öğeleri çek
    try {
        // Token varsa kullan (rate limit 5000/saat), yoksa devam et (60/saat)
        const token = localStorage.getItem('githubToken');
        const headers = {
            'Accept': 'application/vnd.github.v3+json'
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
            { headers }
        );
        
        // Rate limit bilgisini kontrol et
        const remaining = response.headers.get('X-RateLimit-Remaining');
        const limit = response.headers.get('X-RateLimit-Limit');
        
        console.log(`📊 GitHub API: ${remaining}/${limit} kaldı`);
        
        if (response.ok) {
            const data = await response.json();
            const content = atob(data.content); // Base64 decode
            const newItemIds = content.trim().split('\n').map(id => parseInt(id)).filter(id => !isNaN(id));
            
            let updateCount = 0;
            keData.forEach(item => {
                const wasNewItem = item.newItem;
                item.newItem = newItemIds.includes(item.id);
                
                if (item.newItem && !wasNewItem) {
                    updateCount++;
                }
            });
            
            console.log(`Loaded ${newItemIds.length} new items from GitHub`);
            
            if (updateCount > 0) {
                console.log(`🔔 ${updateCount} yeni öğe eklendi!`);
            }
            
            // Son güncelleme zamanını göster
            const lastUpdateEl = document.getElementById('lastUpdate');
            if (lastUpdateEl) {
                const now = new Date().toLocaleTimeString('tr-TR');
                const tokenStatus = token ? '🔑' : '';
                lastUpdateEl.textContent = `Son güncelleme: ${now} ${tokenStatus}`;
                lastUpdateEl.style.color = updateCount > 0 ? '#27ae60' : '#95a5a6';
            }
            
            // Haritayı güncelle
            displayKEData();
            updateStats();
        } else if (response.status === 403) {
            // Rate limit aşıldı
            console.warn('⚠️ GitHub API rate limit aşıldı!');
            const lastUpdateEl = document.getElementById('lastUpdate');
            if (lastUpdateEl) {
                lastUpdateEl.textContent = '⚠️ Rate limit aşıldı';
                lastUpdateEl.style.color = '#e74c3c';
            }
        } else {
            // Dosya henüz yok
            const lastUpdateEl = document.getElementById('lastUpdate');
            if (lastUpdateEl) {
                lastUpdateEl.textContent = 'Henüz yeni öğe yok';
                lastUpdateEl.style.color = '#95a5a6';
            }
        }
    } catch (error) {
        console.log('GitHub dosyası yüklenemedi:', error);
        const lastUpdateEl = document.getElementById('lastUpdate');
        if (lastUpdateEl) {
            lastUpdateEl.textContent = 'Güncelleme başarısız';
            lastUpdateEl.style.color = '#e74c3c';
        }
    }
}
