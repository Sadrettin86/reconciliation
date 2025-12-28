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
let searchCircle = null;
let currentSearchRadius = 1000; // Metre
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
    map = L.map('map').setView([39.0, 35.0], 6);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
    
    keMarkers.addTo(map);
    qidMarkers.addTo(map);
    
    map.on('moveend', onMapMoveEnd);
    
    // Encoded data yükle
    loadEncodedData();
    
    // Firebase realtime senkronizasyon
    initRealtimeSync();
    
    // Arama yarıçapı slider
    setupRadiusSlider();
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
        
        displayKEData();
        updateStats();
        
        alert(`✅ KE ID ${keId} yeni öğe olarak eklendi!`);
        
    } catch (error) {
        console.error('Firebase hatası:', error);
        alert('❌ Eklenemedi: ' + error.message);
    }
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

async function showActivities() {
    const modal = document.getElementById('activitiesModal');
    const body = document.getElementById('activitiesBody');
    
    modal.classList.add('active');
    body.innerHTML = '<div style="text-align: center; padding: 40px; color: #95a5a6;">⏳ Yükleniyor...</div>';
    
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
        html += '<h3>👥 EN AKTIF KULLANICILAR</h3>';
        
        if (sortedUsers.length === 0) {
            html += '<div style="text-align: center; padding: 20px; color: #95a5a6;">Henüz kullanıcı yok</div>';
        } else {
            sortedUsers.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
                html += `
                    <div class="user-item">
                        <div class="user-name">
                            ${medal} <span>#${index + 1}</span> <span>${user.name}</span>
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
        html += '<h3>⏰ SON İŞLEMLER</h3>';
        
        if (activities.length === 0) {
            html += '<div style="text-align: center; padding: 20px; color: #95a5a6;">Henüz işlem yok</div>';
        } else {
            activities.slice(0, 10).forEach(activity => {
                const icon = activity.type === 'match' ? '🟢' : '🔵';
                const action = activity.type === 'match' 
                    ? `KE ${activity.keId} → ${activity.qid}` 
                    : `KE ${activity.keId} yeni öğe`;
                const timeAgo = getTimeAgo(activity.timestamp);
                
                html += `
                    <div class="activity-item">
                        <div>
                            ${icon} <span class="activity-user">${activity.userName}</span>
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
        body.innerHTML = '<div style="text-align: center; padding: 40px; color: #e74c3c;">❌ Yüklenemedi</div>';
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
        const decoded = atob(encodedKEData);
        const data = JSON.parse(decoded);
        
        console.log(`✅ Loaded ${data.length} points from encoded data`);
        
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
            newItem: false
        }));
        
        displayKEData();
        updateStats();
        
        console.log('Sample data:', keData[0]);
        
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
    
    console.log(`Displayed ${keData.length} KE markers`);
}

function selectKEMarker(marker, item) {
    if (activeKEMarker) {
        updateMarkerColor(activeKEMarker, activeKEMarker.keItem.matched);
    }
    
    activeKEMarker = marker;
    updateMarkerColor(marker, item.matched, true);
    
    showSearchCircle(item.lat, item.lng, currentSearchRadius);
    loadNearbyQIDs(item.lat, item.lng, currentSearchRadius);
    
    // Sağ paneli güncelle
    updateInfoPanel(item);
    
    console.log(`Selected KE ${item.id}`);
}

// Sağ panel içeriğini güncelle
function updateInfoPanel(item) {
    const panel = document.getElementById('infoPanel');
    if (!panel) return;
    
    const statusBadge = item.newItem 
        ? '<span style="background: #3498db; color: white; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600;">YENİ ÖĞE</span>'
        : item.matched 
        ? '<span style="background: #27ae60; color: white; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600;">EŞLEŞMİŞ</span>'
        : '<span style="background: #e74c3c; color: white; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600;">EŞLEŞMEMİŞ</span>';
    
    let html = `
        <h2>📍 ${item.name || 'İsimsiz'}</h2>
        <div style="margin-bottom: 15px;">${statusBadge}</div>
        
        <div class="ke-info">
            <div class="ke-info-item">
                <div class="ke-info-label">KE ID:</div>
                <div class="ke-info-value"><strong>${item.id}</strong></div>
            </div>
            ${item.type ? `
            <div class="ke-info-item">
                <div class="ke-info-label">Tür:</div>
                <div class="ke-info-value">${item.type}</div>
            </div>` : ''}
            ${item.city ? `
            <div class="ke-info-item">
                <div class="ke-info-label">İl:</div>
                <div class="ke-info-value">${item.city}</div>
            </div>` : ''}
            ${item.district ? `
            <div class="ke-info-item">
                <div class="ke-info-label">İlçe:</div>
                <div class="ke-info-value">${item.district}</div>
            </div>` : ''}
            ${item.mahalle ? `
            <div class="ke-info-item">
                <div class="ke-info-label">Mahalle:</div>
                <div class="ke-info-value">${item.mahalle}</div>
            </div>` : ''}
            <div class="ke-info-item">
                <div class="ke-info-label">Koord:</div>
                <div class="ke-info-value" style="font-size: 11px;">${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}</div>
            </div>
        </div>
        
        ${item.newItem ? '' : `
        <button onclick="markAsNewItem(${item.id})" style="width: 100%; padding: 10px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; margin-bottom: 15px;">
            ➕ Yeni Öğe Olarak İşaretle
        </button>
        `}
        
        <h3 style="color: #9b59b6; margin-top: 20px;">🔍 Yakındaki Wikidata Öğeleri</h3>
        <div id="qidListContainer" style="margin-top: 10px;">
            <div style="text-align: center; color: #95a5a6; padding: 20px; font-size: 12px;">
                <div class="loading-spinner"></div> Aranıyor...
            </div>
        </div>
    `;
    
    panel.innerHTML = html;
}

// QID listesini sağ panelde göster
function updateQIDList(results) {
    const container = document.getElementById('qidListContainer');
    if (!container) return;
    
    if (results.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #95a5a6; padding: 20px; font-size: 12px;">Yakında Wikidata öğesi bulunamadı</div>';
        return;
    }
    
    let html = '<div class="qid-list">';
    results.forEach((result, index) => {
        const qid = result.item.value.split('/').pop();
        const label = result.itemLabel.value;
        const coords = result.location.value.match(/Point\(([^ ]+) ([^ ]+)\)/);
        
        if (coords) {
            const lng = parseFloat(coords[1]);
            const lat = parseFloat(coords[2]);
            const distance = calculateDistance(
                activeKEMarker.keItem.lat,
                activeKEMarker.keItem.lng,
                lat,
                lng
            );
            
            html += `
                <div class="qid-item" onmouseover="highlightQIDMarker('${qid}')" onmouseout="unhighlightQIDMarker()">
                    <a href="https://www.wikidata.org/wiki/${qid}" target="_blank" style="font-weight: 600; color: #9b59b6;">
                        ${label}
                    </a>
                    <div style="font-size: 10px; color: #7f8c8d; margin-top: 2px;">
                        ${qid} • ${distance.toFixed(0)}m uzakta
                    </div>
                    <a href="#" onclick="addKEToWikidata('${qid}', ${activeKEMarker.keItem.id}); return false;" class="add-ke-button">
                        + KE ID Ekle
                    </a>
                </div>
            `;
        }
    });
    html += '</div>';
    
    container.innerHTML = html;
}

// İki nokta arası mesafe hesapla (metre)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Dünya yarıçapı metre
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function updateMarkerColor(marker, matched, active = false) {
    let color;
    if (active) {
        color = '#3498db';
    } else {
        color = matched ? '#27ae60' : '#e74c3c';
    }
    
    const icon = L.divIcon({
        className: 'ke-marker',
        html: `<div style="background: ${color}; width: ${active ? 16 : 12}px; height: ${active ? 16 : 12}px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></div>`,
        iconSize: [active ? 16 : 12, active ? 16 : 12]
    });
    
    marker.setIcon(icon);
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
      SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
    }
    LIMIT 100
    `;
    
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        displayQIDMarkers(data.results.bindings);
        updateQIDList(data.results.bindings);
        
    } catch (error) {
        console.error('Error loading QIDs:', error);
        const container = document.getElementById('qidListContainer');
        if (container) {
            container.innerHTML = '<div style="text-align: center; color: #e74c3c; padding: 20px; font-size: 12px;">❌ Yüklenemedi</div>';
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
}

// ============================================
// SAYFA BAŞLATMA
// ============================================
document.addEventListener('DOMContentLoaded', initMap);

// Wikidata modal fonksiyonları
function addKEToWikidata(qid, keId) {
    document.getElementById('modalKeValue').textContent = keId;
    document.getElementById('openWikidataBtn').onclick = function() {
        window.open(`https://www.wikidata.org/wiki/${qid}`, '_blank');
        closeWikidataModal();
    };
    document.getElementById('wikidataModal').classList.add('active');
}

function closeWikidataModal() {
    document.getElementById('wikidataModal').classList.remove('active');
}

// QID marker highlight
let highlightedQIDMarker = null;

function highlightQIDMarker(qid) {
    // QID marker'ını bul ve vurgula
    qidMarkers.eachLayer(layer => {
        const popup = layer.getPopup();
        if (popup && popup.getContent().includes(qid)) {
            layer.setIcon(L.divIcon({
                className: 'qid-marker marker-highlight',
                html: `<div style="background: #9b59b6; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 10px rgba(155, 89, 182, 0.8);"></div>`,
                iconSize: [14, 14]
            }));
            highlightedQIDMarker = layer;
        }
    });
}

function unhighlightQIDMarker() {
    if (highlightedQIDMarker) {
        highlightedQIDMarker.setIcon(L.divIcon({
            className: 'qid-marker',
            html: `<div style="background: #9b59b6; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
            iconSize: [10, 10]
        }));
        highlightedQIDMarker = null;
    }
}
