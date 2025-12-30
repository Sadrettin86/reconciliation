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
    const zoomControlPosition = isMobile ? 'bottomright' : 'topleft';
    
    map = L.map('map', {
        zoomControl: false,
        doubleClickZoom: true,  // Çift tıklama zoom
        tap: true,              // Mobil dokunma
        tapTolerance: 15        // Dokunma toleransı
    }).setView([39.0, 35.0], 6);
    
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
    showLoadingMessage('En yakın öğeye geçiliyor...', 1000);
    
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
            // Haritayı en yakın KE'ye götür
            map.setView([nearest.lat, nearest.lng], map.getZoom() < 16 ? 16 : map.getZoom());
            
            // Marker'ı bul ve tıkla
            setTimeout(() => {
                const marker = keMarkers.getLayers().find(m => m.keItem && m.keItem.id === nearest.id);
                if (marker) {
                    marker.fire('click');  // Otomatik tıklama - çember ve sidebar açılır
                }
            }, 300);
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
    `;
    loadingDiv.textContent = message;
    
    document.body.appendChild(loadingDiv);
    
    // Belirtilen süre sonra kaldır
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
        // Mobilde: Sidebar dinamik yükseklik, harita altta
        // Çemberi haritanın görünen kısmının ortasına yerleştir
        const panel = document.getElementById('infoPanel');
        const panelHeight = panel ? panel.offsetHeight : window.innerHeight * 0.5;
        
        const mapContainer = map.getContainer();
        const mapHeight = mapContainer.offsetHeight;
        const visibleMapHeight = mapHeight - panelHeight;
        
        // Görünen harita alanının ortasına kaydır
        const offsetY = panelHeight + (visibleMapHeight / 2) - (mapHeight / 2);
        
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
    const gridStyle = isMobile ? 'display: grid; grid-template-columns: 1fr 1fr; gap: 5px 10px; font-size: 11px;' : '';
    
    let html = `
        <div id="panelHeader" style="position: relative; z-index: 1;">
            <h2 style="cursor: pointer; color: #2c3e50; font-size: ${isMobile ? '16px' : '18px'}; margin: 0 0 10px 0;" onclick="window.open('https://kulturenvanteri.com/yer/?p=${item.id}', '_blank')" title="Kültür Envanteri'nde aç">
                ${item.name || 'İsimsiz'}
            </h2>
            <div style="${gridStyle}">
                ${item.type ? `<p style="margin: 3px 0;"><span class="label">Türler:</span> ${item.type}</p>` : ''}
                ${item.city ? `<p style="margin: 3px 0;"><span class="label">İl:</span> ${item.city}</p>` : ''}
                ${item.district ? `<p style="margin: 3px 0;"><span class="label">İlçe:</span> ${item.district}</p>` : ''}
                ${item.mahalle ? `<p style="margin: 3px 0;"><span class="label">Mahalle:</span> ${item.mahalle}</p>` : ''}
                ${item.access ? `<p style="margin: 3px 0;"><span class="label">Erişim:</span> ${item.access}</p>` : ''}
            </div>
            
            <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #ecf0f1;">
                <button onclick="markAsNewItem(${item.id})" style="width: 100%; padding: 8px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: ${isMobile ? '12px' : '13px'}; margin-bottom: 15px;">
                    ➕ Yeni Öğe Olarak İşaretle
                </button>
                <h3 style="margin: 0 0 10px 0; font-size: ${isMobile ? '13px' : '16px'};">Yakındaki Wikidata Öğeleri (${currentSearchRadius} m)</h3>
            </div>
        </div>
        
        <div id="qidListContainer" style="position: absolute; left: 15px; right: 15px; bottom: 50px; overflow-y: auto;"></div>
        
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
    
    panel.innerHTML = html;
    
    // Header yüksekliğini ölç ve QID container'ın top'unu ayarla
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
            const p31Text = q.p31Label ? ` <span style="color: #7f8c8d; font-size: 12px;">(${q.p31Label})</span>` : '';
            
            html += `
                <div class="qid-item" id="qid-item-${q.qid}" 
                     onmouseover="highlightQIDMarker('${q.qid}'); this.style.background='#fff3cd';" 
                     onmouseout="unhighlightQIDMarker(); this.style.background='#f8f9fa';">
                    <div style="font-size: 14px; font-weight: 600;">
                        <a href="https://www.wikidata.org/wiki/${q.qid}" target="_blank" style="color: #2c3e50; text-decoration: none;">
                            ${q.label}${p31Text}
                        </a>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 3px;">
                        <small style="color: #7f8c8d; font-size: 12px;">Uzaklık: ${q.distance}m</small>
                        <small style="color: #9b59b6; font-size: 11px; font-weight: 600;">${q.qid}</small>
                    </div>
                    <div style="margin-top: 5px;">
                        <a href="#" onclick="openAddKEModal('${q.qid}', ${activeKEMarker.keItem.id}); return false;" 
                           style="display: block; padding: 8px 12px; background: #4caf50; color: white; border-radius: 3px; font-size: 11px; text-decoration: none; font-weight: bold; text-align: center;">
                            + KE ID Ekle
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
    
    // ResizeObserver ile boyut değişimini izle
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            const height = entry.contentRect.height;
            
            if (window.innerWidth <= 768) {
                // Mobilde
                if (height >= 100) {
                    localStorage.setItem('sidebarHeightMobile', Math.round(height));
                    
                    // Sidebar resize olunca çemberi tekrar ortala
                    if (activeKEMarker && activeKEMarker.keItem) {
                        updateMobileCirclePosition();
                    }
                }
            } else {
                // Desktop'ta
                if (height >= 300) {
                    localStorage.setItem('sidebarHeight', Math.round(height));
                }
            }
        }
    });
    
    resizeObserver.observe(panel);
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
