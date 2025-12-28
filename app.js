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
    
    // Boş alana tıklayınca sidebar ve yarıçap kapat
    map.on('click', function(e) {
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
            html: `<div style="background: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
            iconSize: [20, 20]
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
        
        marker.on('click', (e) => {
            e.originalEvent._markerClicked = true;
            selectKEMarker(marker, item);
        });
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
    
    // Yarıçapa göre zoom yap
    const radiusKm = currentSearchRadius / 1000;
    let zoomLevel = radiusKm <= 0.5 ? 17 : (radiusKm <= 1 ? 16 : 15);
    map.setView([item.lat, item.lng], zoomLevel, { animate: true, duration: 0.5 });
    
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
    
    let html = `
        <h2>${item.name || 'İsimsiz'}</h2>
        <p><span class="label">KE ID:</span> ${item.id}</p>
        ${item.type ? `<p><span class="label">Türler:</span> ${item.type}</p>` : ''}
        ${item.city ? `<p><span class="label">İl:</span> ${item.city}</p>` : ''}
        ${item.district ? `<p><span class="label">İlçe:</span> ${item.district}</p>` : ''}
        ${item.mahalle ? `<p><span class="label">Mahalle:</span> ${item.mahalle}</p>` : ''}
        ${item.region ? `<p><span class="label">Bölge:</span> ${item.region}</p>` : ''}
        ${item.access ? `<p><span class="label">Erişim:</span> ${item.access}</p>` : ''}
        <p><span class="label">Koordinat:</span> ${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}</p>
        
        <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #ecf0f1;">
            <h3 style="margin-bottom: 10px;">Yakındaki Wikidata Öğeleri (${currentSearchRadius/1000} km)</h3>
            <div id="qidListContainer">
                <div style="text-align: center; padding: 20px; color: #95a5a6;">
                    <div class="loading-spinner"></div> Aranıyor...
                </div>
            </div>
        </div>
    `;
    
    panel.innerHTML = html;
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
            const p31Text = q.p31Label ? ` <span style="color: #7f8c8d; font-size: 10px;">(${q.p31Label})</span>` : '';
            
            html += `
                <div class="qid-item" id="qid-item-${q.qid}" 
                     onmouseover="highlightQIDMarker('${q.qid}'); this.style.background='#fff3cd';" 
                     onmouseout="unhighlightQIDMarker(); this.style.background='#f8f9fa';">
                    <a href="https://www.wikidata.org/wiki/${q.qid}" target="_blank">${q.qid}</a> - ${q.label}${p31Text}
                    <br><small style="color: #7f8c8d;">Uzaklık: ${q.distance}m</small>
                    <div style="margin-top: 5px; display: flex; gap: 5px;">
                        <a href="#" onclick="openAddKEModal('${q.qid}', ${activeKEMarker.keItem.id}); return false;" 
                           style="flex: 1; padding: 4px 8px; background: #4caf50; color: white; border-radius: 3px; font-size: 10px; text-decoration: none; font-weight: bold; text-align: center;">
                            + KE ID Ekle
                        </a>
                        <a href="#" onclick="markAsNewItem(${activeKEMarker.keItem.id}); return false;" 
                           style="flex: 1; padding: 4px 8px; background: #3498db; color: white; border-radius: 3px; font-size: 10px; text-decoration: none; font-weight: bold; text-align: center;">
                            Yeni Öğe
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
    let color;
    
    // Renk değişmesin - orijinal rengini koru
    if (item.newItem) {
        color = '#3498db'; // Mavi
    } else if (item.matched) {
        color = '#27ae60'; // Yeşil
    } else {
        color = '#e74c3c'; // Kırmızı
    }
    
    if (active) {
        // Aktif: Kare (rounded corners) + siyah kenarlık + daha büyük
        const icon = L.divIcon({
            className: 'ke-marker',
            html: `<div style="background: ${color}; width: 28px; height: 28px; border-radius: 6px; border: 3px solid #000; box-shadow: 0 4px 8px rgba(0,0,0,0.5);"></div>`,
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
      SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
    }
    LIMIT 100
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
            
            // QID marker'a mouse gelince sidebar'da highlight
            marker.on('mouseover', () => {
                const sidebarItem = document.getElementById('qid-item-' + qid);
                if (sidebarItem) {
                    // Scroll to item
                    sidebarItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    
                    // Turuncu highlight
                    sidebarItem.style.background = '#ffc107';
                    sidebarItem.style.transition = 'background 0.3s';
                }
            });
            
            marker.on('mouseout', () => {
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
    
    radiusSlider.addEventListener('input', (e) => {
        const kmValue = parseFloat(e.target.value);
        currentSearchRadius = kmValue * 1000;
        radiusValue.textContent = `${kmValue} km`;
        
        if (activeKEMarker && activeKEMarker.keItem) {
            const item = activeKEMarker.keItem;
            showSearchCircle(item.lat, item.lng, currentSearchRadius);
    
    // Yarıçapa göre zoom yap
    const radiusKm = currentSearchRadius / 1000;
    let zoomLevel = radiusKm <= 0.5 ? 17 : (radiusKm <= 1 ? 16 : 15);
    map.setView([item.lat, item.lng], zoomLevel, { animate: true, duration: 0.5 });
            loadNearbyQIDs(item.lat, item.lng, currentSearchRadius);
        }
    });
}

// ============================================
// SAYFA BAŞLATMA
// ============================================
document.addEventListener('DOMContentLoaded', initMap);

// Wikidata modal fonksiyonları
function openAddKEModal(qid, keId) {
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
