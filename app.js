// ============================================
// GLOBAL DEĞİŞKENLER
// ============================================
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
let activeCoordinate = null; // Koordinat aramada kullanılır: {lat, lng}
let searchCircle = null;
let currentSearchRadius = 100; // Varsayılan 100 metre (localStorage'dan yüklenecek)
let currentUser = null;

// Firebase database referansı
const database = firebase.database();

// ============================================
// KULLANICI YÖNETİMİ (Basit - Prompt)
// ============================================

function getCurrentUser() {
    if (currentUser) return currentUser;
    
    // LocalStorage'dan kontrol et
    const saved = localStorage.getItem('userName');
    if (saved) {
        currentUser = {
            name: saved,
            userId: 'user_' + saved.replace(/\s/g, '_').toLowerCase() + '_' + Date.now().toString().slice(-6)
        };
        console.log(`✅ Kullanıcı: ${currentUser.name}`);
        return currentUser;
    }
    
    // İlk kullanım - isim sor
    const name = prompt('👤 Adınızı girin:\n(Yapılanlar listesinde görünecek)');
    if (!name || name.trim() === '') {
        return null;
    }
    
    currentUser = {
        name: name.trim(),
        userId: 'user_' + name.trim().replace(/\s/g, '_').toLowerCase() + '_' + Date.now().toString().slice(-6)
    };
    
    localStorage.setItem('userName', currentUser.name);
    console.log(`✅ Yeni kullanıcı: ${currentUser.name}`);
    
    return currentUser;
}

// ============================================
// HARİTA BAŞLATMA
// ============================================

function initMap() {
    // Mobilde zoom kontrolleri sağ altta
    const isMobile = window.innerWidth <= 768;
    const zoomControlPosition = 'bottomright'; // Her zaman sağ alt köşe
    
    // localStorage'dan son harita pozisyonunu yükle
    const savedLat = parseFloat(localStorage.getItem('mapLat')) || 39.0;
    const savedLng = parseFloat(localStorage.getItem('mapLng')) || 35.0;
    const savedZoom = parseInt(localStorage.getItem('mapZoom')) || 6;
    
    map = L.map('map', {
        zoomControl: false,
        doubleClickZoom: true,  // Çift tıklama zoom
        tap: true,              // Mobil dokunma
        tapTolerance: 15        // Dokunma toleransı
    }).setView([savedLat, savedLng], savedZoom);
    
    // Zoom kontrolü ekle (pozisyon belirterek)
    L.control.zoom({
        position: zoomControlPosition
    }).addTo(map);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
    
    keMarkers.addTo(map);
    qidMarkers.addTo(map);
    
    map.on('moveend', onMapMoveEnd);
    
    // Harita hareket edince pozisyonu kaydet
    map.on('moveend', function() {
        const center = map.getCenter();
        const zoom = map.getZoom();
        localStorage.setItem('mapLat', center.lat);
        localStorage.setItem('mapLng', center.lng);
        localStorage.setItem('mapZoom', zoom);
    });
    
    // Sağ tıklama menüsü
    map.on('contextmenu', function(e) {
        showContextMenu(e.latlng.lat, e.latlng.lng, e.containerPoint);
    });
    
    // Boş alana tıklayınca sidebar ve yarıçap kapat
    map.on('click', function(e) {
        // Context menüyü kapat
        hideContextMenu();
        
        // Eğer marker'a tıklanmadıysa (event propagation durdurulamadıysa)
        setTimeout(() => {
            if (!e.originalEvent._markerClicked) {
                closeSidebar();
            }
        }, 10);
    });
    
    // Encoded data yükle
    loadEncodedData();
    
    // Firebase realtime senkronizasyon
    initRealtimeSync();
    
    // Arama yarıçapı slider
    setupRadiusSlider();
    
    // Sidebar resize localStorage
    setupSidebarResize();
    
    // Mobilde slider'ı başlangıçta göster
    if (window.innerWidth <= 768) {
        showMobileSlider();
    }
}

// Sidebar ve yarıçapı kapat
function closeSidebar() {
    const panel = document.getElementById('infoPanel');
    if (panel) {
        panel.style.display = 'none';
    }
    
    // Yarıçap çemberini kaldır
    if (searchCircle) {
        map.removeLayer(searchCircle);
        searchCircle = null;
    }
    
    // QID marker'larını temizle
    qidMarkers.clearLayers();
    
    // Aktif marker'ı sıfırla
    if (activeKEMarker) {
        updateMarkerColor(activeKEMarker, activeKEMarker.keItem.matched, false);
        activeKEMarker = null;
    }
}

// ============================================
// FIREBASE İŞLEMLERİ
// ============================================

function initRealtimeSync() {
    console.log('🔥 Firebase senkronizasyon başlatılıyor...');
    
    // Yeni öğeleri dinle
    database.ref('newItems').on('value', (snapshot) => {
        const firebaseData = snapshot.val();
        
        if (!firebaseData) {
            console.log('Henüz yeni öğe yok');
            updateLastUpdate(0);
            return;
        }
        
        const newItemIds = Object.keys(firebaseData).map(id => parseInt(id));
        
        let updateCount = 0;
        keData.forEach(item => {
            const wasNewItem = item.newItem;
            item.newItem = newItemIds.includes(item.id);
            
            if (item.newItem && !wasNewItem) {
                updateCount++;
            }
        });
        
        if (updateCount > 0) {
            console.log(`🔔 ${updateCount} yeni öğe eklendi!`);
        }
        
        displayKEData();
        updateStats();
        updateLastUpdate(updateCount);
    });
    
    // Eşleştirmeleri dinle
    database.ref('matches').on('value', (snapshot) => {
        const matchData = snapshot.val();
        
        if (!matchData) {
            return;
        }
        
        const matchedIds = Object.keys(matchData).map(id => parseInt(id));
        
        let updateCount = 0;
        keData.forEach(item => {
            const wasMatched = item.matched;
            item.matched = matchedIds.includes(item.id);
            
            if (item.matched && !wasMatched) {
                updateCount++;
            }
        });
        
        if (updateCount > 0) {
            console.log(`🟢 ${updateCount} yeni eşleştirme!`);
        }
        
        displayKEData();
        updateStats();
    });
}

function updateLastUpdate(count) {
    const lastUpdateEl = document.getElementById('lastUpdate');
    if (!lastUpdateEl) return;
    
    const now = new Date().toLocaleTimeString('tr-TR');
    lastUpdateEl.textContent = `Son güncelleme: ${now} 🔥`;
    lastUpdateEl.style.color = count > 0 ? '#27ae60' : '#95a5a6';
}

async function markAsNewItem(keId) {
    const item = keData.find(i => i.id === keId);
    if (!item) return;
    
    // Kullanıcı al
    const user = getCurrentUser();
    if (!user) {
        alert('❌ İşlem iptal edildi');
        return;
    }
    
    // Firebase'e ekle
    try {
        await database.ref('newItems/' + keId).set({
            keId: keId,
            timestamp: Date.now(),
            userName: user.name,
            userId: user.userId,
            name: item.name || '',
            city: item.city || '',
            district: item.district || ''
        });
        
        // Kullanıcı istatistiklerini güncelle
        await updateUserStats('newItem');
        
        // Yerel güncelleme
        item.newItem = true;
        item.matched = false;
        
        // Marker'ı haritadan kaldır
        const marker = keMarkers.getLayers().find(m => m.keItem && m.keItem.id === keId);
        if (marker) {
            marker.remove();
        }
        
        // Sidebar'ı kapat
        if (activeKEMarker) {
            activeKEMarker = null;
            document.getElementById('infoPanel').style.display = 'none';
        }
        
        // En yakın eşleşmemiş KE'yi bul ve göster
        showNearestUnmatched(item.lat, item.lng);
        
        displayKEData();
        updateStats();
        
        console.log(`✅ KE ID ${keId} yeni öğe olarak eklendi!`);
        
    } catch (error) {
        console.error('Firebase hatası:', error);
        alert('❌ Eklenemedi: ' + error.message);
    }
}

// En yakın eşleşmemiş KE'yi bul ve göster
function showNearestUnmatched(fromLat, fromLng) {
    // Eşleşmemiş KE'leri bul
    const unmatchedItems = keData.filter(item => !item.matched && !item.newItem);
    
    if (unmatchedItems.length === 0) {
        showLoadingMessage('🎉 Tebrikler! Tüm KE noktaları eşleştirildi!', 2000);
        return;
    }
    
    // Loading mesajı göster
    showLoadingMessage('En yakın öğeye geçiliyor...', 1300);
    
    // En yakını bul (Haversine distance)
    let nearest = null;
    let minDistance = Infinity;
    
    unmatchedItems.forEach(item => {
        const distance = calculateDistance(fromLat, fromLng, item.lat, item.lng);
        if (distance < minDistance) {
            minDistance = distance;
            nearest = item;
        }
    });
    
    if (nearest) {
        // 1 saniye sonra haritayı hareket ettir ve marker'a tıkla
        setTimeout(() => {
            // Önce haritayı hareket ettir
            map.setView([nearest.lat, nearest.lng], map.getZoom() < 16 ? 16 : map.getZoom(), {
                animate: true,
                duration: 0.5
            });
            
            // Harita animasyonu bitince marker'a tıkla (800ms)
            setTimeout(() => {
                const marker = keMarkers.getLayers().find(m => m.keItem && m.keItem.id === nearest.id);
                if (marker) {
                    // selectKEMarker direkt çağır (fire('click') yerine)
                    selectKEMarker(marker, nearest);
                }
            }, 800);
        }, 1000);
    }
}

// Loading mesajı göster
function showLoadingMessage(message, duration) {
    // Mevcut loading mesajını kaldır
    const existingLoading = document.getElementById('loadingMessage');
    if (existingLoading) {
        existingLoading.remove();
    }
    
    // Yeni loading mesajı oluştur
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loadingMessage';
    loadingDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.85);
        color: white;
        padding: 20px 40px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        text-align: center;
        opacity: 0;
        transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
    `;
    loadingDiv.textContent = message;
    
    document.body.appendChild(loadingDiv);
    
    // Fade-in efekti (10ms sonra opacity 1)
    setTimeout(() => {
        loadingDiv.style.opacity = '1';
        loadingDiv.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 10);
    
    // Fade-out başlat (duration - 300ms önce)
    setTimeout(() => {
        loadingDiv.style.opacity = '0';
        loadingDiv.style.transform = 'translate(-50%, -50%) scale(0.95)';
    }, duration - 300);
    
    // Tamamen kaldır
    setTimeout(() => {
        loadingDiv.remove();
    }, duration);
}

// Haversine distance formula (km)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

async function saveMatch(keId, qid) {
    const user = getCurrentUser();
    if (!user) {
        alert('❌ Eşleştirme yapmak için isim girmelisiniz!');
        return;
    }
    
    const item = keData.find(i => i.id === keId);
    if (!item) return;
    
    try {
        await database.ref('matches/' + keId).set({
            keId: keId,
            qid: qid,
            timestamp: Date.now(),
            userName: user.name,
            userId: user.userId,
            name: item.name || ''
        });
        
        await updateUserStats('match');
        
        item.matched = true;
        item.newItem = false;
        
        // Marker'ı haritadan kaldır
        const marker = keMarkers.getLayers().find(m => m.keItem && m.keItem.id === keId);
        if (marker) {
            marker.remove();
        }
        
        // Sidebar'ı kapat
        if (activeKEMarker) {
            activeKEMarker = null;
            document.getElementById('infoPanel').style.display = 'none';
        }
        
        // En yakın eşleşmemiş KE'yi bul ve göster
        showNearestUnmatched(item.lat, item.lng);
        
        displayKEData();
        updateStats();
        
        console.log(`✅ Eşleştirme kaydedildi: KE ${keId} → ${qid}`);
        
    } catch (error) {
        console.error('Eşleştirme hatası:', error);
    }
}

async function updateUserStats(type) {
    if (!currentUser) return;
    
    const userRef = database.ref('users/' + currentUser.userId);
    const snapshot = await userRef.once('value');
    const userData = snapshot.val() || {
        name: currentUser.name,
        matchCount: 0,
        newItemCount: 0,
        totalCount: 0,
        lastActivity: 0
    };
    
    if (type === 'match') {
        userData.matchCount++;
    } else if (type === 'newItem') {
        userData.newItemCount++;
    }
    
    userData.totalCount++;
    userData.lastActivity = Date.now();
    
    await userRef.set(userData);
}

// ============================================
// YAPILANLAR MODAL
// ============================================

// Wikidata arama - debounce timer
let wikidataSearchTimeout = null;

// Wikidata arama input handler
function handleWikidataSearchInput() {
    const input = document.getElementById('wikidataSearch');
    const query = input.value.trim();
    
    // Dropdown'u temizle
    if (query.length < 2) {
        hideWikidataAutocomplete();
        return;
    }
    
    // Debounce (300ms)
    clearTimeout(wikidataSearchTimeout);
    wikidataSearchTimeout = setTimeout(() => {
        fetchWikidataAutocomplete(query);
    }, 300);
}

// Wikidata autocomplete API
async function fetchWikidataAutocomplete(query) {
    try {
        const url = `https://www.wikidata.org/w/api.php?` +
            `action=wbsearchentities&` +
            `search=${encodeURIComponent(query)}&` +
            `language=tr&` +
            `uselang=tr&` +
            `limit=50&` +
            `format=json&` +
            `origin=*`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.search && data.search.length > 0) {
            showWikidataAutocomplete(data.search);
        } else {
            hideWikidataAutocomplete();
        }
    } catch (error) {
        console.error('Wikidata autocomplete hatası:', error);
        hideWikidataAutocomplete();
    }
}

// Autocomplete dropdown göster
function showWikidataAutocomplete(results) {
    const dropdown = document.getElementById('wikidataAutocomplete');
    
    let html = '';
    results.forEach(item => {
        const description = item.description || '';
        html += `
            <div style="padding: 10px; cursor: pointer; border-bottom: 1px solid #f0f0f0; transition: background 0.2s;"
                 onmouseover="this.style.background='#f8f9fa'"
                 onmouseout="this.style.background='white'"
                 onclick="selectWikidataItem('${item.id}')">
                <div style="font-weight: 600; font-size: 13px; color: #2c3e50;">${item.label}</div>
                <div style="font-size: 11px; color: #7f8c8d; margin-top: 2px;">
                    ${description} <span style="color: #9b59b6;">(${item.id})</span>
                </div>
            </div>
        `;
    });
    
    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
}

// Autocomplete dropdown gizle
function hideWikidataAutocomplete() {
    const dropdown = document.getElementById('wikidataAutocomplete');
    dropdown.style.display = 'none';
}

// Autocomplete'ten item seç
async function selectWikidataItem(qid) {
    hideWikidataAutocomplete();
    
    // QID bilgilerini al
    const itemData = await fetchWikidataItemData(qid);
    
    if (itemData && itemData.coordinates) {
        // Koordinat varsa haritada göster
        showCoordinateSearch(itemData.coordinates.lat, itemData.coordinates.lng);
    } else {
        // Koordinat yoksa sadece bilgi göster
        alert(`ℹ️ ${itemData.label}\n\n${qid} öğesinin koordinat bilgisi yok.`);
    }
    
    // Input'u temizle
    document.getElementById('wikidataSearch').value = '';
}

// Wikidata item verilerini al (P625, P131, P17)
async function fetchWikidataItemData(qid) {
    try {
        const url = `https://www.wikidata.org/w/api.php?` +
            `action=wbgetentities&` +
            `ids=${qid}&` +
            `props=labels|claims&` +
            `languages=tr|en&` +
            `languagefallback=1&` +
            `format=json&` +
            `origin=*`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        const entity = data.entities[qid];
        if (!entity) return null;
        
        const label = entity.labels.tr?.value || entity.labels.en?.value || qid;
        
        // P625 (coordinate location)
        let coordinates = null;
        if (entity.claims.P625 && entity.claims.P625[0]) {
            const coordClaim = entity.claims.P625[0].mainsnak.datavalue.value;
            coordinates = {
                lat: coordClaim.latitude,
                lng: coordClaim.longitude
            };
        }
        
        // P131 (located in)
        let p131 = null;
        if (entity.claims.P131 && entity.claims.P131[0]) {
            const p131Id = entity.claims.P131[0].mainsnak.datavalue.value.id;
            p131 = await fetchWikidataLabel(p131Id);
        }
        
        // P17 (country)
        let p17 = null;
        if (entity.claims.P17 && entity.claims.P17[0]) {
            const p17Id = entity.claims.P17[0].mainsnak.datavalue.value.id;
            p17 = await fetchWikidataLabel(p17Id);
        }
        
        // P11729 (Kültür Envanteri ID)
        let p11729 = null;
        if (entity.claims.P11729 && entity.claims.P11729[0]) {
            p11729 = entity.claims.P11729[0].mainsnak.datavalue.value;
        }
        
        return { qid, label, coordinates, p131, p17, p11729 };
    } catch (error) {
        console.error('Wikidata item data hatası:', error);
        return null;
    }
}

// Wikidata label al
async function fetchWikidataLabel(qid) {
    try {
        const url = `https://www.wikidata.org/w/api.php?` +
            `action=wbgetentities&` +
            `ids=${qid}&` +
            `props=labels&` +
            `languages=tr|en&` +
            `languagefallback=1&` +
            `format=json&` +
            `origin=*`;
        
        const response = await fetch(url);
        const data = await response.json();
        const entity = data.entities[qid];
        
        return entity.labels.tr?.value || entity.labels.en?.value || qid;
    } catch (error) {
        return qid;
    }
}

// Wikidata arama (Enter/Ara butonu)
async function performWikidataSearch() {
    const input = document.getElementById('wikidataSearch');
    const query = input.value.trim();
    
    if (!query) {
        alert('❌ Lütfen arama terimi girin!');
        return;
    }
    
    hideWikidataAutocomplete();
    
    // Arama yap
    try {
        const url = `https://www.wikidata.org/w/api.php?` +
            `action=wbsearchentities&` +
            `search=${encodeURIComponent(query)}&` +
            `language=tr&` +
            `uselang=tr&` +
            `limit=50&` +
            `format=json&` +
            `origin=*`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.search && data.search.length > 0) {
            // Arama sonuçlarını sidebar'da göster
            showWikidataSearchResults(query, data.search);
        } else {
            alert(`ℹ️ "${query}" için sonuç bulunamadı.`);
        }
    } catch (error) {
        console.error('Wikidata arama hatası:', error);
        alert('❌ Arama sırasında hata oluştu.');
    }
}

// Wikidata arama sonuçlarını sidebar'da göster
async function showWikidataSearchResults(query, results) {
    const panel = document.getElementById('infoPanel');
    if (!panel) return;
    
    // Aktif modları sıfırla
    activeKEMarker = null;
    activeCoordinate = null;
    
    panel.style.display = 'block';
    
    const isMobile = window.innerWidth <= 768;
    
    let html = `
        <div id="panelHeader" style="position: relative; z-index: 1;">
            <h2 style="color: #2c3e50; font-size: ${isMobile ? '13px' : '14px'}; margin: 0 0 6px 0; line-height: 1.3;">
                Arama: "${query}"
            </h2>
            <h3 style="margin: 0 0 8px 0; font-size: ${isMobile ? '12px' : '13px'}; padding-top: 6px; border-top: 1px solid #ecf0f1; color: #555;">
                Sonuçlar (${results.length})
            </h3>
        </div>
        
        <div id="qidListContainer" style="position: absolute; left: 15px; right: 15px; top: 50px; bottom: 15px; overflow-y: auto;"></div>
    `;
    
    panel.innerHTML = html;
    
    // Mobilde resize handle ekle
    if (isMobile) {
        addMobileResizeHandle();
    }
    
    // Sonuçları yükle (her biri için P625, P131, P17 al)
    const container = document.getElementById('qidListContainer');
    container.innerHTML = '<p style="color: #7f8c8d; text-align: center; padding: 20px;">Sonuçlar yükleniyor...</p>';
    
    const itemPromises = results.map(item => fetchWikidataItemData(item.id));
    const itemsData = await Promise.all(itemPromises);
    
    let resultsHtml = '<div class="qid-list">';
    
    itemsData.forEach(item => {
        if (!item) return;
        
        const hasCoords = item.coordinates !== null;
        const gotoButton = hasCoords ? `
            <button onclick="gotoWikidataLocation('${item.qid}', ${item.coordinates.lat}, ${item.coordinates.lng})"
                    style="padding: 6px 12px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600; transition: background 0.2s;"
                    onmouseover="this.style.background='#2980b9'"
                    onmouseout="this.style.background='#3498db'">
                → Git
            </button>
        ` : '';
        
        // P11729 (KE ID) badge - QID'den sonra
        const keBadge = item.p11729 ? `
            <a href="https://kulturenvanteri.com/yer/?p=${item.p11729}" 
               target="_blank"
               style="background: #8b4513; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; text-decoration: none; margin-left: 6px; transition: background 0.2s; display: inline-block;"
               onmouseover="this.style.background='#654321';"
               onmouseout="this.style.background='#8b4513';"
               title="Kültür Envanteri'nde aç">${item.p11729}</a>
        ` : '';
        
        resultsHtml += `
            <div style="padding: 12px; background: #f8f9fa; border-radius: 6px; margin-bottom: 10px; border: 1px solid #e0e0e0;">
                <div style="display: flex; justify-content: space-between; align-items: start; gap: 10px;">
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 14px; margin-bottom: 6px;">
                            <a href="https://www.wikidata.org/wiki/${item.qid}" 
                               target="_blank"
                               style="color: #2c3e50; text-decoration: none; border-bottom: 1px solid transparent; transition: all 0.2s;"
                               onmouseover="this.style.color='#3498db'; this.style.borderBottomColor='#3498db';"
                               onmouseout="this.style.color='#2c3e50'; this.style.borderBottomColor='transparent';">
                                ${item.label}
                            </a>
                            <span style="color: #9b59b6; font-size: 11px; margin-left: 6px;">(${item.qid})</span>
                            ${keBadge}
                        </div>
                        <div style="display: flex; gap: 15px; font-size: 12px; color: #7f8c8d; margin-top: 3px;">
                            ${item.p131 ? `<span><strong>İdari birim:</strong> ${item.p131}</span>` : ''}
                            ${item.p17 ? `<span><strong>Ülke:</strong> ${item.p17}</span>` : ''}
                            ${!item.p131 && !item.p17 ? `<span style="font-size: 11px; color: #95a5a6; font-style: italic;">Konum bilgisi yok</span>` : ''}
                        </div>
                    </div>
                    <div>
                        ${gotoButton}
                    </div>
                </div>
            </div>
        `;
    });
    
    resultsHtml += '</div>';
    container.innerHTML = resultsHtml;
}

// Wikidata konumuna git
function gotoWikidataLocation(qid, lat, lng) {
    showCoordinateSearch(lat, lng);
}

// Giriş yap fonksiyonu
// OAuth Configuration
const OAUTH_CONFIG = {
    clientId: '6495296455dbf4d018bf3137a5e4a3fb',
    redirectUri: 'https://keharita.app/callback',
    authEndpoint: 'https://meta.wikimedia.org/w/rest.php/oauth2/authorize',
    tokenEndpoint: 'https://meta.wikimedia.org/w/rest.php/oauth2/access_token',
    userInfoEndpoint: 'https://meta.wikimedia.org/w/rest.php/oauth2/resource/profile'
};

// ============================================
// PKCE (Proof Key for Code Exchange) Functions
// ============================================

// Generate random string for code_verifier
function generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64URLEncode(array);
}

// Base64URL encode (without padding)
function base64URLEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    bytes.forEach(byte => str += String.fromCharCode(byte));
    return btoa(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

// SHA-256 hash
async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return await crypto.subtle.digest('SHA-256', data);
}

// Generate code_challenge from code_verifier
async function generateCodeChallenge(verifier) {
    const hashed = await sha256(verifier);
    return base64URLEncode(hashed);
}

// ============================================
// OAuth Flow
// ============================================

// Check if returning from OAuth
window.addEventListener('DOMContentLoaded', () => {
    checkOAuthCallback();
    loadUserFromStorage();
    updateLoginButton();
});

// Load user from localStorage
function loadUserFromStorage() {
    const userJson = localStorage.getItem('keharita_user');
    if (userJson) {
        try {
            currentUser = JSON.parse(userJson);
            console.log('User loaded:', currentUser.username);
        } catch (e) {
            console.error('Failed to parse user data:', e);
            localStorage.removeItem('keharita_user');
        }
    }
}

// Save user to localStorage
function saveUserToStorage(user) {
    localStorage.setItem('keharita_user', JSON.stringify(user));
}

// Check OAuth callback
function checkOAuthCallback() {
    // Check if returning from callback page
    const code = localStorage.getItem('oauth_code');
    
    if (code) {
        console.log('OAuth code found:', code.substring(0, 20) + '...');
        
        // Clear code
        localStorage.removeItem('oauth_code');
        
        // Exchange code for token
        exchangeCodeForToken(code);
    }
}

// Start OAuth flow with PKCE
async function handleLogin() {
    if (currentUser) {
        // Already logged in - show profile
        showUserProfile();
        return;
    }
    
    try {
        // Generate PKCE parameters
        const state = generateRandomString(32);
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        
        // Store for later use
        localStorage.setItem('oauth_state', state);
        localStorage.setItem('oauth_code_verifier', codeVerifier);
        
        // Build authorization URL with PKCE
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: OAUTH_CONFIG.clientId,
            redirect_uri: OAUTH_CONFIG.redirectUri,
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        });
        
        const authUrl = `${OAUTH_CONFIG.authEndpoint}?${params.toString()}`;
        
        console.log('🔐 Starting OAuth with PKCE...');
        console.log('Code Challenge:', codeChallenge);
        
        // Redirect to Wikimedia OAuth
        window.location.href = authUrl;
        
    } catch (error) {
        console.error('OAuth PKCE error:', error);
        alert('❌ Giriş yapılırken hata oluştu: ' + error.message);
    }
}

// Exchange authorization code for access token
async function exchangeCodeForToken(code) {
    try {
        // Show loading
        const loginButton = document.getElementById('loginButton');
        if (loginButton) {
            loginButton.innerHTML = '<span style="font-size: 12px;">⏳ Giriş yapılıyor...</span>';
            loginButton.disabled = true;
        }
        
        // Get code_verifier from localStorage (PKCE)
        const codeVerifier = localStorage.getItem('oauth_code_verifier');
        
        if (!codeVerifier) {
            console.error('❌ Code verifier not found!');
            alert('❌ PKCE hatası: Code verifier bulunamadı.');
            
            if (loginButton) {
                loginButton.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                        <polyline points="10 17 15 12 10 7"></polyline>
                        <line x1="15" y1="12" x2="3" y2="12"></line>
                    </svg>
                    Giriş Yap
                `;
                loginButton.disabled = false;
            }
            return;
        }
        
        console.log('🔐 Code Verifier found:', codeVerifier.substring(0, 20) + '...');
        console.log('📡 Calling Cloudflare Worker proxy...');
        
        // Clear PKCE verifier
        localStorage.removeItem('oauth_code_verifier');
        
        // Backend proxy - Cloudflare Worker
        const PROXY_URL = 'https://keharita.toolforge.org';
        
        const response = await fetch(PROXY_URL + '/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                client_id: OAUTH_CONFIG.clientId,
                redirect_uri: OAUTH_CONFIG.redirectUri,
                code_verifier: codeVerifier
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('❌ Token exchange failed:', errorData);
            
            alert('❌ Token alınırken hata oluştu.\n\n' +
                  'Hata: ' + (errorData.error || 'Unknown error') + '\n' +
                  (errorData.details ? JSON.stringify(errorData.details) : ''));
            
            if (loginButton) {
                loginButton.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                        <polyline points="10 17 15 12 10 7"></polyline>
                        <line x1="15" y1="12" x2="3" y2="12"></line>
                    </svg>
                    Giriş Yap
                `;
                loginButton.disabled = false;
            }
            return;
        }
        
        const tokenData = await response.json();
        console.log('✅ Access token received!');
        
        // Fetch user profile
        const user = await fetchUserProfile(tokenData.access_token);
        
        if (!user) {
            console.error('❌ Failed to fetch user profile');
            alert('❌ Kullanıcı bilgileri alınamadı.');
            
            if (loginButton) {
                loginButton.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                        <polyline points="10 17 15 12 10 7"></polyline>
                        <line x1="15" y1="12" x2="3" y2="12"></line>
                    </svg>
                    Giriş Yap
                `;
                loginButton.disabled = false;
            }
            return;
        }
        
        // Debug: Check user object
        console.log('👤 User object:', {
            username: user.username,
            sub: user.sub,
            hasToken: !!user.accessToken
        });
        
        // Save user
        currentUser = user;
        saveUserToStorage(user);
        
        console.log('💾 User saved to localStorage');
        console.log('🔄 Updating login button...');
        
        updateLoginButton();
        
        console.log('✅ Login successful!');
        
        // Simple alert
        alert('Giriş başarılı!');
        
    } catch (error) {
        console.error('❌ OAuth error:', error);
        alert('❌ Giriş yapılırken hata oluştu:\n\n' + error.message);
        
        const loginButton = document.getElementById('loginButton');
        if (loginButton) {
            loginButton.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                    <polyline points="10 17 15 12 10 7"></polyline>
                    <line x1="15" y1="12" x2="3" y2="12"></line>
                </svg>
                Giriş Yap
            `;
            loginButton.disabled = false;
        }
    }
}

// Fetch user profile via Cloudflare Worker (CORS fix)
async function fetchUserProfile(accessToken) {
    try {
        // Kullanıcı bilgisi önemsiz - sadece token'ın geçerli olduğunu kontrol et
        return {
            username: 'user',  // Dummy username
            sub: 'unknown',
            accessToken: accessToken
        };
    } catch (error) {
        console.error('❌ Failed to create user profile:', error);
        return null;
    }
}

// Update login button based on user state
function updateLoginButton() {
    const loginButton = document.getElementById('loginButton');
    if (!loginButton) return;
    
    if (currentUser) {
        // Show "Çıkış" button
        loginButton.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            Çıkış
        `;
        loginButton.style.background = 'linear-gradient(135deg, #27ae60 0%, #229954 100%)';
        loginButton.style.cursor = 'pointer';
        loginButton.title = 'Çıkış yap';
        
        // Click handler - Logout
        loginButton.onclick = handleLogout;
    } else {
        // Show login
        loginButton.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                <polyline points="10 17 15 12 10 7"></polyline>
                <line x1="15" y1="12" x2="3" y2="12"></line>
            </svg>
            Giriş Yap
        `;
        loginButton.style.background = 'linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)';
        loginButton.style.cursor = 'pointer';
        loginButton.title = 'Wikimedia hesabınızla giriş yapın';
        loginButton.onclick = handleLogin;
    }
}

// Logout function
function handleLogout() {
    console.log('👋 Logging out...');
    
    // Clear user data
    currentUser = null;
    localStorage.removeItem('keharita_user');
    localStorage.removeItem('oauth_code');
    localStorage.removeItem('oauth_state');
    localStorage.removeItem('oauth_code_verifier');
    localStorage.removeItem('oauth_timestamp');
    
    console.log('✅ User data cleared');
    
    // Update button
    updateLoginButton();
    
    alert('Çıkış yapıldı.');
}

// Show user profile dialog
function showUserProfile() {
    const stats = `
👤 **Kullanıcı Bilgileri**

**Kullanıcı adı:** ${currentUser.username}
**ID:** ${currentUser.sub}

**Katkılar:**
• Toplam eşleştirme: Yakında
• Yeni öğe: Yakında
• Liderlik sırası: Yakında

Bu özellikler backend hazır olduğunda aktif olacak.
    `;
    
    const action = confirm(stats + '\n\nÇıkış yapmak ister misiniz?');
    
    if (action) {
        handleLogout();
    }
}

// Logout
function handleLogout() {
    currentUser = null;
    localStorage.removeItem('keharita_user');
    updateLoginButton();
    alert('✅ Çıkış yapıldı.');
}

// Generate random string for state
function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Sağ tıklama context menu göster
function showContextMenu(lat, lng, point) {
    // Mevcut menüyü kaldır
    hideContextMenu();
    
    // Context menu oluştur
    const menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.style.cssText = `
        position: absolute;
        left: ${point.x}px;
        top: ${point.y}px;
        background: white;
        border: 1px solid #ddd;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        min-width: 180px;
        overflow: hidden;
    `;
    
    menu.innerHTML = `
        <div style="padding: 8px 12px; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; gap: 8px;"
             onmouseover="this.style.background='#f8f9fa'"
             onmouseout="this.style.background='white'"
             onclick="searchFromContextMenu(${lat}, ${lng})">
            <span style="font-size: 16px;">🔍</span>
            <span style="font-size: 13px; font-weight: 500;">Vikiveri'de ara</span>
        </div>
        <div style="padding: 6px 12px; font-size: 11px; color: #7f8c8d; border-top: 1px solid #ecf0f1;">
            ${lat.toFixed(6)}, ${lng.toFixed(6)}
        </div>
    `;
    
    document.body.appendChild(menu);
    
    // Koordinatları global değişkende sakla
    window.contextMenuCoords = { lat, lng };
}

// Context menu'yü gizle
function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    if (menu) {
        menu.remove();
    }
    window.contextMenuCoords = null;
}

// Context menu'den koordinat arama
function searchFromContextMenu(lat, lng) {
    hideContextMenu();
    showCoordinateSearch(lat, lng);
}

// Koordinat arama fonksiyonu
function searchCoordinates() {
    const input = document.getElementById('coordSearch').value.trim();
    
    if (!input) {
        alert('❌ Lütfen koordinat girin!\n\nÖrnek: 41.0082, 28.9784');
        return;
    }
    
    // Koordinat parse (virgül, boşluk veya slash ayırıcı)
    const coords = input.split(/[,\s/]+/).map(s => parseFloat(s.trim()));
    
    if (coords.length !== 2 || isNaN(coords[0]) || isNaN(coords[1])) {
        alert('❌ Geçersiz koordinat formatı!\n\nDoğru format:\n• 41.0082, 28.9784\n• 41.0082 28.9784\n• 41.0082/28.9784');
        return;
    }
    
    const [lat, lng] = coords;
    
    // Koordinat geçerli mi kontrol et
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        alert('❌ Koordinatlar geçersiz!\n\nLatitude: -90 ile 90 arası\nLongitude: -180 ile 180 arası');
        return;
    }
    
    // Haritada göster
    showCoordinateSearch(lat, lng);
}

// Koordinat arama sonuçlarını göster
function showCoordinateSearch(lat, lng) {
    // Aktif koordinatı kaydet
    activeCoordinate = { lat, lng };
    activeKEMarker = null; // KE marker modundan çık
    
    // Arama çemberini göster
    showSearchCircle(lat, lng, currentSearchRadius);
    
    // Haritaya git
    map.setView([lat, lng], 16, { animate: true, duration: 0.5 });
    
    // Sidebar'ı koordinat modunda aç
    showCoordinatePanel(lat, lng);
    
    // Yakındaki QID'leri yükle
    loadNearbyQIDsForCoordinate(lat, lng);
}

// Koordinat için sidebar göster (KE bilgileri olmadan)
function showCoordinatePanel(lat, lng) {
    const panel = document.getElementById('infoPanel');
    if (!panel) return;
    
    panel.style.display = 'block';
    
    const isMobile = window.innerWidth <= 768;
    const qidBottom = isMobile ? '15px' : '60px';
    
    // Google Maps footer (mobilde gizli)
    const googleMapsFooter = isMobile ? '' : `
        <div style="position: absolute; left: 15px; right: 15px; bottom: 15px; height: 35px; display: flex; align-items: center; justify-content: center; border-top: 1px solid #ecf0f1; padding-top: 8px;">
            <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" style="display: flex; align-items: center; gap: 6px; color: #4285f4; text-decoration: none; font-size: 13px; font-weight: 500; padding: 6px 12px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='#f0f7ff'" onmouseout="this.style.background='transparent'">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                </svg>
                Google Maps'te Aç
            </a>
        </div>
    `;
    
    let html = `
        <div id="panelHeader" style="position: relative; z-index: 1;">
            <h2 style="color: #2c3e50; font-size: ${isMobile ? '11px' : '12px'}; margin: 0 0 6px 0; font-family: monospace; line-height: 1.3;">
                Koordinat: ${lat.toFixed(6)}, ${lng.toFixed(6)}
            </h2>
            
            <h3 style="margin: 0 0 8px 0; padding-top: 6px; border-top: 1px solid #ecf0f1; font-size: ${isMobile ? '12px' : '13px'}; color: #555;">Yakındaki Wikidata (${currentSearchRadius} m)</h3>
        </div>
        
        <div id="qidListContainer" style="position: absolute; left: 15px; right: 15px; bottom: ${qidBottom}; overflow-y: auto;"></div>
        
        ${googleMapsFooter}
    `;
    
    panel.innerHTML = html;
    
    // Mobilde resize handle ekle
    if (isMobile) {
        addMobileResizeHandle();
    }
    
    // Header yüksekliğini ölç
    requestAnimationFrame(() => {
        const header = document.getElementById('panelHeader');
        const container = document.getElementById('qidListContainer');
        if (header && container) {
            const headerHeight = header.offsetHeight;
            container.style.top = (headerHeight + 15) + 'px';
        }
    });
    
    // Mobilde slider'ı göster
    if (isMobile) {
        showMobileSlider();
    }
}

// Koordinat için yakındaki QID'leri yükle (KE ID Ekle butonu olmadan)
async function loadNearbyQIDsForCoordinate(lat, lng) {
    const container = document.getElementById('qidListContainer');
    if (!container) return;
    
    container.innerHTML = '<p style="color: #7f8c8d; text-align: center; padding: 20px;">Yükleniyor...</p>';
    
    try {
        const sparqlQuery = `
            SELECT ?place ?placeLabel ?location ?keID WHERE {
              SERVICE wikibase:around {
                ?place wdt:P625 ?location.
                bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral.
                bd:serviceParam wikibase:radius "${currentSearchRadius / 1000}".
              }
              OPTIONAL { ?place wdt:P11729 ?keID. }
              SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
            }
        `;
        
        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;
        const response = await fetch(url);
        const data = await response.json();
        
        const bindings = data.results.bindings;
        
        if (bindings.length === 0) {
            container.innerHTML = '<p style="color: #7f8c8d; text-align: center; padding: 20px;">Bu yarıçapta Wikidata öğesi bulunamadı.</p>';
            return;
        }
        
        // QID'leri işle
        const qidPromises = bindings.map(async (binding) => {
            const qid = binding.place.value.split('/').pop();
            const label = binding.placeLabel.value;
            const coords = binding.location.value.match(/Point\(([^ ]+) ([^ ]+)\)/);
            const keID = binding.keID ? binding.keID.value : null; // P11729
            
            if (coords) {
                const qidLng = parseFloat(coords[1]);
                const qidLat = parseFloat(coords[2]);
                const distance = Math.round(calculateDistance(lat, lng, qidLat, qidLng) * 1000);
                
                // P31 (instance of) al
                let p31Label = '';
                try {
                    const p31Query = `
                        SELECT ?typeLabel WHERE {
                          wd:${qid} wdt:P31 ?type .
                          SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
                        } LIMIT 1
                    `;
                    const p31Url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(p31Query)}&format=json`;
                    const p31Response = await fetch(p31Url);
                    const p31Data = await p31Response.json();
                    if (p31Data.results.bindings.length > 0) {
                        p31Label = p31Data.results.bindings[0].typeLabel.value;
                    }
                } catch (e) {
                    console.log('P31 yüklenemedi:', qid);
                }
                
                return { qid, label, distance, p31Label, lat: qidLat, lng: qidLng, keID };
            }
            return null;
        });
        
        Promise.all(qidPromises).then(qidList => {
            const validQids = qidList.filter(q => q !== null);
            
            // Mesafeye göre sırala
            validQids.sort((a, b) => a.distance - b.distance);
            
            // QID marker'larını temizle ve yeniden ekle
            qidMarkers.clearLayers();
            
            validQids.forEach(q => {
                // Haritaya sarı marker ekle
                const marker = L.circleMarker([q.lat, q.lng], {
                    radius: 8,
                    fillColor: '#f1c40f',
                    color: '#f39c12',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.8
                });
                
                marker.qid = q.qid;
                marker.bindTooltip(q.label, { permanent: false, direction: 'top' });
                marker.addTo(qidMarkers);
            });
            
            console.log(`Displayed ${validQids.length} QID markers`);
            
            let html = `<div class="qid-list">`;
            
            validQids.forEach(q => {
                const p31Text = q.p31Label ? ` <span style="color: #7f8c8d; font-size: 11px;">(${q.p31Label})</span>` : '';
                
                // P11729 (KE ID) badge - QID'den sonra
                const keBadge = q.keID ? `
                    <a href="https://kulturenvanteri.com/yer/?p=${q.keID}" 
                       target="_blank"
                       style="background: #8b4513; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; text-decoration: none; margin-left: 6px; transition: background 0.2s; display: inline-block;"
                       onmouseover="this.style.background='#654321';"
                       onmouseout="this.style.background='#8b4513';"
                       title="Kültür Envanteri'nde aç">${q.keID}</a>
                ` : '';
                
                // KE ID Ekle butonu YOK!
                html += `
                    <div class="qid-item" id="qid-item-${q.qid}" 
                         style="padding: 10px; background: #f8f9fa; border-radius: 5px; margin-bottom: 8px; transition: all 0.2s; border: 1px solid transparent;"
                         onmouseover="highlightQIDMarker('${q.qid}'); this.style.background='#fff3cd'; this.style.borderColor='#ffc107';" 
                         onmouseout="unhighlightQIDMarker(); this.style.background='#f8f9fa'; this.style.borderColor='transparent';">
                        
                        <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">
                            <a href="https://www.wikidata.org/wiki/${q.qid}" 
                               target="_blank" 
                               style="color: #2c3e50; text-decoration: none; transition: all 0.2s; border-bottom: 1px solid transparent;"
                               onmouseover="this.style.color='#3498db'; this.style.borderBottomColor='#3498db';"
                               onmouseout="this.style.color='#2c3e50'; this.style.borderBottomColor='transparent';"
                               title="Wikidata'da açmak için tıklayın 🔗">
                                ${q.label}
                            </a>
                            ${p31Text}
                        </div>
                        
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <small style="color: #7f8c8d; font-size: 12px;">Uzaklık: ${q.distance}m</small>
                            <div>
                                <a href="https://www.wikidata.org/wiki/${q.qid}" 
                                   target="_blank"
                                   style="color: #9b59b6; font-size: 11px; font-weight: 600; text-decoration: none; transition: color 0.2s;"
                                   onmouseover="this.style.color='#8e44ad';"
                                   onmouseout="this.style.color='#9b59b6';"
                                   title="Wikidata'da açmak için tıklayın">${q.qid}</a>
                                ${keBadge}
                            </div>
                        </div>
                    </div>
                `;
            });
            
            html += '</div>';
            container.innerHTML = html;
        });
        
    } catch (error) {
        console.error('QID yükleme hatası:', error);
        container.innerHTML = '<p style="color: #e74c3c; text-align: center; padding: 20px;">Hata oluştu. Lütfen tekrar deneyin.</p>';
    }
}

async function showActivities() {
    const modal = document.getElementById('activitiesModal');
    const body = document.getElementById('activitiesBody');
    
    modal.classList.add('active');
    body.innerHTML = '<div style="text-align: center; padding: 40px; color: #95a5a6;">Yükleniyor...</div>';
    
    try {
        const usersSnapshot = await database.ref('users').once('value');
        const users = usersSnapshot.val() || {};
        
        const sortedUsers = Object.values(users)
            .sort((a, b) => b.totalCount - a.totalCount)
            .slice(0, 10);
        
        const newItemsSnapshot = await database.ref('newItems').orderByChild('timestamp').limitToLast(10).once('value');
        const matchesSnapshot = await database.ref('matches').orderByChild('timestamp').limitToLast(10).once('value');
        
        const activities = [];
        
        newItemsSnapshot.forEach(child => {
            activities.push({ type: 'new', ...child.val() });
        });
        
        matchesSnapshot.forEach(child => {
            activities.push({ type: 'match', ...child.val() });
        });
        
        activities.sort((a, b) => b.timestamp - a.timestamp);
        
        let html = '<div class="activities-section">';
        html += '<h3>EN AKTIF KULLANICILAR</h3>';
        
        if (sortedUsers.length === 0) {
            html += '<div style="text-align: center; padding: 20px; color: #95a5a6;">Henüz kullanıcı yok</div>';
        } else {
            sortedUsers.forEach((user, index) => {
                const medal = index === 0 ? '1.' : index === 1 ? '2.' : index === 2 ? '3.' : `${index + 1}.`;
                html += `
                    <div class="user-item">
                        <div class="user-name">
                            <span>${medal}</span> <span>${user.name}</span>
                        </div>
                        <div class="user-score">
                            <div class="user-total">${user.totalCount} işlem</div>
                            <div class="user-breakdown">${user.matchCount} eşleş. + ${user.newItemCount} yeni</div>
                        </div>
                    </div>
                `;
            });
        }
        
        html += '</div>';
        
        html += '<div class="activities-section">';
        html += '<h3>SON İŞLEMLER</h3>';
        
        if (activities.length === 0) {
            html += '<div style="text-align: center; padding: 20px; color: #95a5a6;">Henüz işlem yok</div>';
        } else {
            activities.slice(0, 10).forEach(activity => {
                const icon = activity.type === 'match' ? '→' : '+';
                const action = activity.type === 'match' 
                    ? `KE ${activity.keId} → ${activity.qid}` 
                    : `KE ${activity.keId} yeni öğe`;
                const timeAgo = getTimeAgo(activity.timestamp);
                
                html += `
                    <div class="activity-item">
                        <div>
                            <span style="margin-right: 5px;">${icon}</span>
                            <span class="activity-user">${activity.userName}</span>
                            <div class="activity-action">${action}</div>
                        </div>
                        <div class="activity-time">${timeAgo}</div>
                    </div>
                `;
            });
        }
        
        html += '</div>';
        body.innerHTML = html;
        
    } catch (error) {
        console.error('Yapılanlar yüklenirken hata:', error);
        body.innerHTML = '<div style="text-align: center; padding: 40px; color: #e74c3c;">Yüklenemedi</div>';
    }
}

function closeActivities() {
    document.getElementById('activitiesModal').classList.remove('active');
}

function getTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Az önce';
    if (minutes < 60) return `${minutes} dk önce`;
    if (hours < 24) return `${hours} saat önce`;
    return `${days} gün önce`;
}

// ============================================
// DATA YÜKLEME
// ============================================

function loadEncodedData() {
    if (typeof encodedKEData === 'undefined') {
        console.log('No encoded data found');
        return;
    }
    
    try {
        // Base64 decode - UTF-8 desteği ile (Türkçe karakterler için)
        const decoded = decodeURIComponent(Array.prototype.map.call(atob(encodedKEData), function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        
        const data = JSON.parse(decoded);
        
        console.log(`✅ Loaded ${data.length} points from encoded data`);
        console.log('RAW data first item:', data[0]);
        console.log('Available fields:', Object.keys(data[0]));
        
        keData = data.map(point => ({
            id: point.i,
            name: point.n || '',
            type: point.t || '',
            lat: point.la,
            lng: point.lo,
            country: point.c || '',
            region: point.r || '',
            // Tüm olası field kombinasyonları
            city: point.il || point.city || point.sehir || point.ci || point.s || '',
            district: point.ilce || point.district || point.ilçe || point.d || '',
            mahalle: point.m || point.mahalle || '',
            access: point.a || point.erisim || '',
            matched: false,
            newItem: false
        }));
        
        displayKEData();
        updateStats();
        
        console.log('Sample RAW data:', data[0]);
        console.log('Sample MAPPED data:', keData[0]);
        console.log('City field test:', {
            'point.il': data[0].il,
            'point.city': data[0].city,
            'point.sehir': data[0].sehir,
            'point.ci': data[0].ci,
            'point.s': data[0].s
        });
        console.log('District field test:', {
            'point.ilce': data[0].ilce,
            'point.district': data[0].district,
            'point.ilçe': data[0].ilçe,
            'point.d': data[0].d
        });
        
    } catch (error) {
        console.error('Error loading encoded data:', error);
    }
}

// Excel upload özelliği kaldırıldı (index.html'de input yok)
// Gerekirse eklenebilir ama şu an data.js kullanıyoruz

// ============================================
// HARİTA GÖSTERİM
// ============================================

function displayKEData() {
    keMarkers.clearLayers();
    
    keData.forEach(item => {
        // Matched veya newItem ise marker ekleme (gizli)
        if (item.matched || item.newItem) {
            return;  // Skip this marker
        }
        
        // Sadece eşleşmemiş (kırmızı) marker'lar
        const color = '#e74c3c'; // Kırmızı - Eşleşmemiş
        
        const icon = L.divIcon({
            className: 'ke-marker',
            html: `<div style="background: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
            iconSize: [20, 20]
        });
        
        const marker = L.marker([item.lat, item.lng], { icon: icon });
        
        const statusBadge = '<span style="background: #e74c3c; color: white; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 600;">EŞLEŞMEMİŞ</span>';
        
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
                <div style="margin-top: 10px;">
                    <button onclick="markAsNewItem(${item.id})" style="width: 100%; padding: 8px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
                        ➕ Yeni Öğe Olarak İşaretle
                    </button>
                </div>
            </div>
        `;
        
        marker.on('click', (e) => {
            e.originalEvent._markerClicked = true;
            selectKEMarker(marker, item);
        });
        marker.keItem = item;
        
        keMarkers.addLayer(marker);
    });
    
    const unmatchedCount = keData.filter(i => !i.matched && !i.newItem).length;
    console.log(`Displayed ${unmatchedCount} unmatched KE markers (out of ${keData.length} total)`);
}

function selectKEMarker(marker, item) {
    if (activeKEMarker) {
        updateMarkerColor(activeKEMarker, activeKEMarker.keItem.matched);
    }
    
    activeKEMarker = marker;
    updateMarkerColor(marker, item.matched, true);
    
    showSearchCircle(item.lat, item.lng, currentSearchRadius);
    
    // Yarıçapa göre zoom yap
    const radiusKm = currentSearchRadius / 1000;
    let zoomLevel;
    if (radiusKm <= 0.1) zoomLevel = 18;
    else if (radiusKm <= 0.2) zoomLevel = 17;
    else if (radiusKm <= 0.5) zoomLevel = 16;
    else zoomLevel = 15;
    
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        // Mobilde: Sidebar üstte, çemberi haritanın alt kısmına yerleştir
        const panel = document.getElementById('infoPanel');
        const panelHeight = panel ? panel.offsetHeight : window.innerHeight * 0.5;
        
        const mapContainer = map.getContainer();
        const mapHeight = mapContainer.offsetHeight;
        const visibleMapHeight = mapHeight - panelHeight;
        
        // Çemberi haritanın görünen kısmının 2/3'üne kaydır (daha aşağıda)
        const offsetY = panelHeight + (visibleMapHeight * 0.66) - (mapHeight / 2);
        
        const point = map.project([item.lat, item.lng], zoomLevel);
        point.y += offsetY;
        const newCenter = map.unproject(point, zoomLevel);
        
        map.setView(newCenter, zoomLevel, { animate: true, duration: 0.5 });
    } else {
        // Desktop: Sağ panel genişliği: 380px + 20px (right margin) = 400px
        // Merkezi SOLA kaydır ki yarıçap panelin dışında kalsın
        const mapContainer = map.getContainer();
        const panelWidth = 410; // 380px panel + 30px margin
        
        // Harita merkezini sola kaydır
        const offsetX = panelWidth / 2;
        
        // Pixel koordinatını hesapla ve offset uygula
        const point = map.project([item.lat, item.lng], zoomLevel);
        point.x += offsetX; // Sağa kayar, merkez sola gider
        const newCenter = map.unproject(point, zoomLevel);
        
        map.setView(newCenter, zoomLevel, { animate: true, duration: 0.5 });
    }
    
    // Sağ paneli göster ve güncelle
    showInfoPanel(item);
    
    // Yakındaki QID'leri yükle
    loadNearbyQIDs(item.lat, item.lng, currentSearchRadius);
    
    console.log(`Selected KE ${item.id}`);
}

// Sağ paneli göster ve KE bilgilerini doldur
function showInfoPanel(item) {
    const panel = document.getElementById('infoPanel');
    if (!panel) return;
    
    panel.style.display = 'block';
    
    // Mobil grid layout için
    const isMobile = window.innerWidth <= 768;
    const gridStyle = isMobile ? 'display: grid; grid-template-columns: 1fr 1fr; gap: 5px 10px; font-size: 11px;' : 'font-size: 13px;';
    
    // Google Maps footer (mobilde gizli)
    const googleMapsFooter = isMobile ? '' : `
        <div style="position: absolute; left: 15px; right: 15px; bottom: 15px; height: 35px; display: flex; align-items: center; justify-content: center; border-top: 1px solid #ecf0f1; padding-top: 8px;">
            <a href="https://www.google.com/maps?q=${item.lat},${item.lng}" target="_blank" style="display: flex; align-items: center; gap: 6px; color: #4285f4; text-decoration: none; font-size: 13px; font-weight: 500; padding: 6px 12px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='#f0f7ff'" onmouseout="this.style.background='transparent'">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                </svg>
                Google Maps'te Aç
            </a>
        </div>
    `;
    
    // QID container bottom (mobilde 15px, desktop'ta 60px - footer yüksekliği)
    const qidBottom = isMobile ? '15px' : '60px';
    
    // Kompakt bilgi satırı - sadece önemli olanlar
    const infoLine = [
        item.mahalle ? `Mahalle: ${item.mahalle}` : null,
        item.type ? `Türler: ${item.type}` : null,
        item.access ? `Erişim: ${item.access}` : null
    ].filter(Boolean).join(' • ');
    
    let html = `
        <div id="panelHeader" style="position: relative; z-index: 1;">
            <h2 style="cursor: pointer; color: #2c3e50; font-size: ${isMobile ? '14px' : '15px'}; margin: 0 0 6px 0; transition: all 0.2s; border-bottom: 2px solid transparent; line-height: 1.3;" 
                onclick="window.open('https://kulturenvanteri.com/yer/?p=${item.id}', '_blank')" 
                onmouseover="this.style.color='#3498db'; this.style.borderBottomColor='#3498db';" 
                onmouseout="this.style.color='#2c3e50'; this.style.borderBottomColor='transparent';"
                title="Kültür Envanteri'nde açmak için tıklayın 🔗">
                ${item.name || 'İsimsiz'}
            </h2>
            ${infoLine ? `<p style="margin: 0 0 8px 0; font-size: 11px; color: #7f8c8d;">${infoLine}</p>` : ''}
            
            <button id="newItemButton" data-ke-id="${item.id}"
                    style="width: 100%; padding: 6px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 11px; margin-bottom: 8px; touch-action: manipulation;">
                ➕ Yeni Öğe Olarak İşaretle
            </button>
            
            <h3 style="margin: 0 0 8px 0; padding-top: 8px; border-top: 1px solid #ecf0f1; font-size: ${isMobile ? '12px' : '13px'}; color: #555;">Yakındaki Wikidata (${currentSearchRadius} m)</h3>
        </div>
        
        <div id="qidListContainer" style="position: absolute; left: 15px; right: 15px; bottom: ${qidBottom}; overflow-y: auto;"></div>
        
        ${googleMapsFooter}
    `;
    
    panel.innerHTML = html;
    
    // Mobilde resize handle ekle
    if (isMobile) {
        addMobileResizeHandle();
    }
    
    // Header yüksekliğini ölç ve QID container'ın top'unu ayarla
    requestAnimationFrame(() => {
        const header = document.getElementById('panelHeader');
        const container = document.getElementById('qidListContainer');
        if (header && container) {
            const headerHeight = header.offsetHeight;
            container.style.top = (headerHeight + 15) + 'px';
        }
        
        // Yeni Öğe butonuna event listener ekle
        const newItemButton = document.getElementById('newItemButton');
        if (newItemButton) {
            const keId = parseInt(newItemButton.getAttribute('data-ke-id'));
            
            // Touch event (mobil)
            newItemButton.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                markAsNewItem(keId);
            }, { passive: false });
            
            // Click event (desktop fallback)
            newItemButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                markAsNewItem(keId);
            });
        }
    });
    
    // Mobilde slider'ı göster
    if (isMobile) {
        showMobileSlider();
    }
}

// QID listesini güncelle
function displayQIDList(results) {
    const container = document.getElementById('qidListContainer');
    if (!container) return;
    
    if (results.length === 0) {
        container.innerHTML = '<p style="color: #95a5a6; font-size: 12px; text-align: center;">Yakında Wikidata öğesi bulunamadı</p>';
        return;
    }
    
    // Her QID için P31 (instance of) bilgisini çek
    const qidPromises = results.map(async result => {
        const qid = result.item.value.split('/').pop();
        const label = result.itemLabel.value;
        const coords = result.location.value.match(/Point\(([^ ]+) ([^ ]+)\)/);
        
        if (coords && activeKEMarker) {
            const lng = parseFloat(coords[1]);
            const lat = parseFloat(coords[2]);
            
            // Mesafe hesapla
            const keItem = activeKEMarker.keItem;
            const R = 6371000;
            const dLat = (lat - keItem.lat) * Math.PI / 180;
            const dLon = (lng - keItem.lng) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(keItem.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distance = Math.round(R * c);
            
            // P31 değerini çek
            let p31Label = '';
            try {
                const p31Query = `
                    SELECT ?typeLabel WHERE {
                      wd:${qid} wdt:P31 ?type .
                      SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
                    } LIMIT 1
                `;
                const p31Url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(p31Query)}&format=json`;
                const p31Response = await fetch(p31Url);
                const p31Data = await p31Response.json();
                if (p31Data.results.bindings.length > 0) {
                    p31Label = p31Data.results.bindings[0].typeLabel.value;
                }
            } catch (e) {
                console.log('P31 yüklenemedi:', qid);
            }
            
            return { qid, label, distance, p31Label };
        }
        return null;
    });
    
    Promise.all(qidPromises).then(qidList => {
        const validQids = qidList.filter(q => q !== null);
        
        // Mesafeye göre sırala (yakından uzağa)
        validQids.sort((a, b) => a.distance - b.distance);
        
        let html = `<div class="qid-list">`;
        
        validQids.forEach(q => {
            const p31Text = q.p31Label ? ` <span style="color: #7f8c8d; font-size: 11px;">(${q.p31Label})</span>` : '';
            
            html += `
                <div class="qid-item" id="qid-item-${q.qid}" 
                     style="display: flex; gap: 8px; padding: 8px; background: #f8f9fa; border-radius: 5px; margin-bottom: 5px; transition: all 0.2s; border: 1px solid transparent;"
                     onmouseover="highlightQIDMarker('${q.qid}'); this.style.background='#fff3cd'; this.style.borderColor='#ffc107';" 
                     onmouseout="unhighlightQIDMarker(); this.style.background='#f8f9fa'; this.style.borderColor='transparent';">
                    
                    <!-- Sol: 70% İçerik -->
                    <div style="flex: 0 0 70%; min-width: 0;">
                        <div style="font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <a href="https://www.wikidata.org/wiki/${q.qid}" 
                               target="_blank" 
                               style="color: #2c3e50; text-decoration: none; transition: all 0.2s; border-bottom: 1px solid transparent;"
                               onmouseover="this.style.color='#3498db'; this.style.borderBottomColor='#3498db';"
                               onmouseout="this.style.color='#2c3e50'; this.style.borderBottomColor='transparent';"
                               title="Wikidata'da açmak için tıklayın 🔗">
                                ${q.label}
                            </a>
                        </div>
                        ${p31Text}
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                            <small style="color: #7f8c8d; font-size: 11px;">Uzaklık: ${q.distance}m</small>
                            <a href="https://www.wikidata.org/wiki/${q.qid}" 
                               target="_blank"
                               style="color: #9b59b6; font-size: 10px; font-weight: 600; text-decoration: none; transition: color 0.2s;"
                               onmouseover="this.style.color='#8e44ad';"
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

// Wikidata modal fonksiyonları
// ============================================
// WIKIDATA EDIT API - P11729 (KE ID) EKLEME
// ============================================

// Add P11729 (Kültür Envanteri ID) to Wikidata item via Worker
async function addKEIDToWikidata(qid, keId) {
    if (!currentUser || !currentUser.accessToken) {
        alert('Bu işlem için giriş yapmalısınız.');
        return false;
    }
    
    try {
        console.log(`📝 Adding P11729: ${keId} to ${qid}`);
        
        const PROXY_URL = 'https://keharita.toolforge.org';
        
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
        
        const data = await response.json();
        console.log('✅ P11729 successfully added:', data);
        
        // Hata kontrolü
        if (data.error) {
            showNotification(`Hata: ${data.error.info}`, 'error');
            throw new Error(data.error.info || 'Wikidata hatası');
        }
        
        // Başarılı - QID label'ını al
        const qidLabel = await getQIDLabel(qid);
        const message = `${qidLabel} (${qid}) öğesine KE ID ${keId} eklendi.`;
        
        showNotification(message, 'success');
        
        // 1 saniye sonra en yakın unmatched marker'a geç
        setTimeout(() => {
            moveToNearestUnmatched();
        }, 1000);
        
        return true;
        
    } catch (error) {
        console.error('❌ Wikidata edit error:', error);
        showNotification(`Hata: ${error.message}`, 'error');
        throw error;
    }
}

// QID label'ını al (cache ile)
const qidLabelCache = {};

async function getQIDLabel(qid) {
    if (qidLabelCache[qid]) {
        return qidLabelCache[qid];
    }
    
    try {
        const response = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels&languages=tr|en&format=json&origin=*`);
        const data = await response.json();
        
        const entity = data.entities[qid];
        const label = entity.labels.tr?.value || entity.labels.en?.value || qid;
        
        qidLabelCache[qid] = label;
        return label;
    } catch (error) {
        console.error('Label fetch error:', error);
        return qid;
    }
}

function openAddKEModal(qid, keId) {
    // Kullanıcı giriş kontrolü
    if (!currentUser || !currentUser.accessToken) {
        // Giriş yapılmamış - bilgi kutusu göster
        showNotification('Bu işlem için lütfen giriş yapın.', 'warning', 4000);
        return; // Fonksiyonu sonlandır
    }
    
    // Giriş yapılmış - Loading state
    const button = event.target;
    const originalText = button.innerHTML;
    button.innerHTML = '⏳';
    button.style.pointerEvents = 'none';
    
    addKEIDToWikidata(qid, keId)
        .then(() => {
            // Başarılı mesaj zaten addKEIDToWikidata içinde gösteriliyor
            
            // Refresh QID list
            if (activeKEMarker) {
                loadNearbyQIDs(activeKEMarker.keItem.lat, activeKEMarker.keItem.lng, currentSearchRadius);
            }
        })
        .catch(error => {
            showNotification('Hata: ' + error.message, 'error');
        })
        .finally(() => {
            button.innerHTML = originalText;
            button.style.pointerEvents = 'auto';
        });
}

function closeWikidataModal() {
    document.getElementById('wikidataModal').classList.remove('active');
}

// Bildirim göster fonksiyonu
function showNotification(message, type = 'success', duration = 3000) {
    // Mevcut bildirimi kaldır
    const existingBox = document.getElementById('notification-box');
    if (existingBox) {
        existingBox.remove();
    }
    
    // Yeni bildirim oluştur
    const notificationBox = document.createElement('div');
    notificationBox.id = 'notification-box';
    notificationBox.className = `notification ${type}`;
    
// İçerik oluştur (emoji yok)
notificationBox.innerHTML = `
    <span style="flex: 1;">${message}</span>
    <button onclick="this.parentElement.remove()" 
            style="background: transparent; border: none; color: white; font-size: 20px; cursor: pointer; padding: 0 5px; opacity: 0.7; transition: opacity 0.2s;"
            onmouseover="this.style.opacity='1'"
            onmouseout="this.style.opacity='0.7'">×</button>
`;
    
// Stil ayarla
notificationBox.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.9);
    background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : type === 'warning' ? '#f39c12' : '#3498db'};
    color: white;
    padding: 20px 25px;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    z-index: 10001;
    min-width: 350px;
    max-width: 500px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 15px;
    font-weight: 500;
    opacity: 0;
    transition: all 0.3s ease-in-out;
`;
    
    document.body.appendChild(notificationBox);
    
    // Fade-in animasyonu
    setTimeout(() => {
        notificationBox.style.opacity = '1';
        notificationBox.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);
    
    // Otomatik kapat
    setTimeout(() => {
        notificationBox.style.opacity = '0';
        notificationBox.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => {
            notificationBox.remove();
        }, 300);
    }, duration);
}

// En yakın unmatched KE marker'a geç
function moveToNearestUnmatched() {
    if (!activeKEMarker) return;
    
    const currentItem = activeKEMarker.keItem;
    const currentLat = currentItem.lat;
    const currentLng = currentItem.lng;
    let nearestMarker = null;
    let nearestDistance = Infinity;
    
    // Tüm unmatched marker'ları kontrol et
    keMarkers.eachLayer(marker => {
        if (!marker.keItem) return;
        
        // QID'si olan (eşleşmiş) marker'ları atla
        if (marker.keItem.matched || marker.keItem.newItem) return;
        
        if (marker === activeKEMarker) return;
        
        // Mesafeyi hesapla
        const distance = calculateDistance(currentLat, currentLng, marker.keItem.lat, marker.keItem.lng);
        
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestMarker = marker;
        }
    });
    
    // En yakın marker'a geç
    if (nearestMarker) {
        map.setView([nearestMarker.keItem.lat, nearestMarker.keItem.lng], map.getZoom() < 16 ? 16 : map.getZoom(), {
            animate: true,
            duration: 0.5
        });
        
        setTimeout(() => {
            selectKEMarker(nearestMarker, nearestMarker.keItem);
        }, 500);
    }
}
