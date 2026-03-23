// ============================================
// OSM Modülü — KEHarita Entegrasyonu
// ============================================
// app.js'e DOKUNULMAZ. Bu dosya yüklendikten
// sonra ilgili fonksiyonları sarar (wrap).
// ============================================

const OSM_MODULE = (() => {

  // ── Durum ────────────────────────────────────────────────────
  let _activeKEItem    = null;
  let _activeQID       = null;
  let _selectedOSMEl   = null;
  let _wikidataToken   = null;
  let _overpassCache   = {};
  let _osmMissingLayer = null;
  let _osmMissingMode  = false;
  let _osmElementStore = {};     // {type-id: element} onclick için veri deposu
  const CACHE_TTL_MS   = 5 * 60 * 1000;

  // ── app.js Fonksiyonlarını Sar ────────────────────────────────
  // app.js tamamen yüklendikten sonra çalışır
  function hookIntoApp() {

    // 1) showInfoPanel wrap: KE noktası seçilince çalışır
    if (typeof showInfoPanel === 'function') {
      const _orig = window.showInfoPanel;
      window.showInfoPanel = function(item) {
        _orig.call(this, item);
        _activeKEItem  = item;
        _activeQID     = null;
        _selectedOSMEl = null;

        // Zaten eşleşmiş nokta mı? Firebase'den QID'yi oku
        const keId = item.i || item.id;
        try {
          firebase.database().ref('matches/' + keId).once('value').then(snap => {
            const match = snap.val();
            const qid   = match ? match.qid : null;
            _activeQID  = qid;
            _injectOSMSection(item, qid);
          });
        } catch (e) {
          _injectOSMSection(item, null);
        }
      };
    }

    // 2) addKEIDToWikidata wrap: KE→Wikidata eşleşmesi tamamlanınca çalışır
    if (typeof addKEIDToWikidata === 'function') {
      const _orig = window.addKEIDToWikidata;
      window.addKEIDToWikidata = async function(qid, keId) {
        const result = await _orig.call(this, qid, keId);
        // Eşleşme başarılıysa OSM panelini güncelle
        _activeQID = qid;
        _injectOSMSection(_activeKEItem, qid);
        // Wikimedia token'ı al (currentUser app.js global değişkeni)
        if (typeof currentUser !== 'undefined' && currentUser?.accessToken) {
          _wikidataToken = currentUser.accessToken;
        }
        return result;
      };
    }

    // 3) Buton enjekte et
    _injectOSMMissingButton();

    // 4) Wikimedia token'ı yakala + login butonuna kullanıcı adı yaz
    setInterval(() => {
      if (typeof currentUser !== 'undefined' && currentUser?.accessToken) {
        _wikidataToken = currentUser.accessToken;

        const btn = document.getElementById('loginButton');
        if (btn && currentUser.username && !btn.dataset.wmLabeled) {
          btn.dataset.wmLabeled = '1';
          btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
              <polyline points="10 17 15 12 10 7"></polyline>
              <line x1="15" y1="12" x2="3" y2="12"></line>
            </svg>
            WM:${currentUser.username}`;
        }
      }
    }, 1000);
  }

  // ── Info Panel'e OSM Bölümü Ekle ────────────────────────────
  async function _injectOSMSection(item, qid) {
    const panel = document.getElementById('infoPanel');
    if (!panel) return;

    // Eski OSM bölümünü temizle
    const old = document.getElementById('osm-section');
    if (old) old.remove();

    const section = document.createElement('div');
    section.id = 'osm-section';
    section.style.cssText = `
      margin-top: 12px;
      padding-top: 12px;
      border-top: 2px solid #e8f4fd;
    `;

    if (!qid) {
      // Wikidata eşleşmesi henüz yapılmamış
      section.innerHTML = `
        <div style="font-size:12px; color:#95a5a6; text-align:center; padding:8px 0;">
          OSM eşleştirmesi için önce Wikidata bağlantısı yapın.
        </div>`;
      panel.appendChild(section);
      return;
    }

    // Yükleniyor göster
    section.innerHTML = _loadingHTML('OSM durumu kontrol ediliyor…');
    panel.appendChild(section);

    try {
      const osmStatus = await OSM_API.checkWikidataOSMStatus(qid);
      const hasOSM    = osmStatus.node || osmStatus.way || osmStatus.relation;

      if (hasOSM) {
        const type = osmStatus.way ? 'way' : osmStatus.relation ? 'relation' : 'node';
        const id   = osmStatus[type];
        section.innerHTML = _osmLinkedHTML(qid, type, id, osmStatus);
      } else {
        section.innerHTML = _osmSearchHTML(qid, item);
      }

    } catch (e) {
      section.innerHTML = `
        <div style="font-size:12px; color:#e74c3c;">
          ⚠️ OSM durumu alınamadı: ${e.message}
        </div>`;
    }
  }

  // ── HTML Parçaları ────────────────────────────────────────────
  function _loadingHTML(msg) {
    return `
      <div style="display:flex; align-items:center; gap:8px; font-size:12px; color:#7f8c8d; padding:6px 0;">
        <span class="loading-spinner"></span> ${msg}
      </div>`;
  }

  function _osmLinkedHTML(qid, type, id, osmStatus) {
    const typeLabel = OSM_API.osmTypeLabel(type);
    const osmUrl    = `https://www.openstreetmap.org/${type}/${id}`;
    const idEditor  = `https://www.openstreetmap.org/edit?${type}=${id}`;

    const allLinks = [
      osmStatus.node     && `<a href="https://www.openstreetmap.org/node/${osmStatus.node}" target="_blank" style="color:#27ae60;">Nokta #${osmStatus.node}</a>`,
      osmStatus.way      && `<a href="https://www.openstreetmap.org/way/${osmStatus.way}" target="_blank" style="color:#27ae60;">Yol #${osmStatus.way}</a>`,
      osmStatus.relation && `<a href="https://www.openstreetmap.org/relation/${osmStatus.relation}" target="_blank" style="color:#27ae60;">İlişki #${osmStatus.relation}</a>`,
    ].filter(Boolean).join(' · ');

    return `
      <div>
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
          <span style="background:#27ae60; color:white; border-radius:4px; padding:2px 7px; font-size:11px; font-weight:700;">OSM ✓</span>
          <span style="font-size:12px; color:#27ae60; font-weight:600;">OSM'de bağlantı mevcut</span>
        </div>
        <div style="font-size:12px; color:#555; margin-bottom:8px;">${allLinks}</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <a href="${osmUrl}" target="_blank"
             style="font-size:11px; background:#f0f9f0; color:#27ae60; border:1px solid #c8e6c9; padding:4px 10px; border-radius:4px; text-decoration:none;">
            OSM'de Gör ↗
          </a>
          <button onclick="OSM_MODULE.openTagTransfer('${qid}','${type}','${id}')"
                  style="font-size:11px; background:#e3f2fd; color:#1565c0; border:1px solid #bbdefb; padding:4px 10px; border-radius:4px; cursor:pointer;">
            Tag Aktarımı
          </button>
        </div>
      </div>`;
  }

  function _osmSearchHTML(qid, item) {
    const isLoggedIn = OSM_AUTH.isLoggedIn();
    if (!isLoggedIn) {
      return `
        <div>
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
            <span style="background:#e74c3c; color:white; border-radius:4px; padding:2px 7px; font-size:11px; font-weight:700;">OSM ✗</span>
            <span style="font-size:12px; color:#e74c3c; font-weight:600;">OSM bağlantısı yok</span>
          </div>
          <div style="font-size:12px; color:#7f8c8d; margin-bottom:8px;">
            OSM eşleştirmesi için giriş yapın.
          </div>
          <button onclick="OSM_AUTH.login()"
                  style="font-size:12px; background:linear-gradient(135deg,#e67e22,#ca6f1e); color:white; border:none; padding:7px 14px; border-radius:5px; cursor:pointer; font-weight:600;">
            OSM ile Giriş Yap
          </button>
        </div>`;
    }

    return `
      <div>
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
          <span style="background:#e74c3c; color:white; border-radius:4px; padding:2px 7px; font-size:11px; font-weight:700;">OSM ✗</span>
          <span style="font-size:12px; color:#e74c3c; font-weight:600;">OSM bağlantısı yok</span>
        </div>
        <div style="font-size:12px; color:#7f8c8d; margin-bottom:8px;">
          Bu Wikidata kaydına bağlı OSM elemanı bulunamadı.
        </div>
        <button onclick="OSM_MODULE.searchNearbyOSM('${qid}', ${item.lat}, ${item.lng})"
                style="font-size:12px; background:linear-gradient(135deg,#e67e22,#ca6f1e); color:white; border:none; padding:7px 14px; border-radius:5px; cursor:pointer; font-weight:600; width:100%;">
          🔍 Yakında OSM Elemanı Ara
        </button>
      </div>`;
  }

  // ── Yakın OSM Elemanlarını Ara ────────────────────────────────
  async function searchNearbyOSM(qid, lat, lng) {
    const section = document.getElementById('osm-section');
    if (!section) return;

    _activeQID = qid;
    const radius = (typeof currentSearchRadius !== 'undefined') ? currentSearchRadius : 200;

    section.innerHTML = _loadingHTML(`${radius}m içinde OSM elemanları aranıyor…`);

    const cacheKey = `${lat},${lng},${radius}`;
    let results;

    try {
      if (_overpassCache[cacheKey] && Date.now() - _overpassCache[cacheKey].ts < CACHE_TTL_MS) {
        results = _overpassCache[cacheKey].results;
      } else {
        results = await OSM_API.findNearbyElements(lat, lng, radius);
        _overpassCache[cacheKey] = { ts: Date.now(), results };
      }
    } catch (e) {
      section.innerHTML = `
        <div style="font-size:12px; color:#e74c3c;">
          ⚠️ Overpass hatası: ${e.message}
        </div>`;
      return;
    }

    if (results.length === 0) {
      section.innerHTML = `
        <div>
          <div style="font-size:12px; color:#7f8c8d; margin-bottom:8px;">
            ${radius}m içinde OSM elemanı bulunamadı.
          </div>
          <button onclick="OSM_MODULE.searchNearbyOSM('${qid}', ${lat}, ${lng})"
                  style="font-size:11px; background:#ecf0f1; color:#555; border:1px solid #ddd; padding:5px 10px; border-radius:4px; cursor:pointer;">
            Tekrar Ara
          </button>
        </div>`;
      return;
    }

    section.innerHTML = _buildOSMListHTML(qid, lat, lng, results);
  }

  function _buildOSMListHTML(qid, lat, lng, results) {
    // Elemanları depoya kaydet (onclick'te JSON sorunu yaşamamak için)
    _osmElementStore = {};
    results.slice(0, 10).forEach(el => {
      _osmElementStore[`${el.type}-${el.id}`] = el;
    });

    const items = results.slice(0, 10).map(el => {
      const typeLabel = OSM_API.osmTypeLabel(el.type);
      const name      = el.tags.name || '<i style="color:#aaa;font-size:11px;">isimsiz</i>';
      const dist      = el.distance  ? `${el.distance}m` : '?';
      const storeKey  = `${el.type}-${el.id}`;
      const wdBadge   = el.hasWikidata
        ? `<span style="font-size:10px; background:#fff3cd; color:#856404; border-radius:3px; padding:1px 5px; margin-left:4px;">wikidata: ${el.wikidataTag}</span>`
        : '';

      return `
        <div onclick="OSM_MODULE.selectOSMElement('${qid}', '${storeKey}')"
             style="padding:7px 9px; margin:3px 0; background:#f8f9fa; border-radius:5px; cursor:pointer;
                    border:2px solid transparent; font-size:12px; transition:all 0.15s;"
             onmouseover="this.style.borderColor='#3498db';this.style.background='#ebf5fb';this.style.boxShadow='0 2px 6px rgba(52,152,219,0.25)'"
             onmouseout="this.style.borderColor='transparent';this.style.background='#f8f9fa';this.style.boxShadow='none'"
             id="osm-el-${el.type}-${el.id}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:600; color:#2c3e50;">${name}${wdBadge}</span>
            <span style="font-size:10px; color:#95a5a6;">${dist}</span>
          </div>
          <div style="color:#7f8c8d; font-size:10px; margin-top:2px;">
            ${typeLabel} #${el.id}
            ${el.tags['addr:street'] ? ' · ' + el.tags['addr:street'] : ''}
          </div>
        </div>`;
    }).join('');

    return `
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:12px; font-weight:600; color:#2c3e50;">
            Yakın OSM Elemanları (${results.length})
          </span>
          <button onclick="OSM_MODULE.searchNearbyOSM('${qid}', ${lat}, ${lng})"
                  style="font-size:10px; background:none; border:1px solid #ddd; padding:2px 7px; border-radius:3px; cursor:pointer; color:#7f8c8d;">
            ↻ Yenile
          </button>
        </div>
        <div style="max-height:220px; overflow-y:auto;">${items}</div>
        ${results.length > 10 ? `<div style="font-size:11px; color:#95a5a6; text-align:center; margin-top:4px;">+${results.length-10} eleman daha — yarıçapı daraltın</div>` : ''}
      </div>`;
  }

  // ── OSM Elemanı Seç → Önizleme ────────────────────────────────
  // element: depodaki key string'i veya doğrudan obje
  async function selectOSMElement(qid, elementOrKey) {
    const element = (typeof elementOrKey === 'string')
      ? _osmElementStore[elementOrKey]
      : elementOrKey;
    if (!element) return;
    _selectedOSMEl = element;
    const section  = document.getElementById('osm-section');
    if (!section) return;

    section.innerHTML = _loadingHTML('Eleman ve tag bilgileri alınıyor…');

    try {
      // Güncel element detayını çek (versiyon için gerekli)
      const fresh    = await OSM_API.getElement(element.type, element.id);
      _selectedOSMEl = { ...element, version: fresh.version, tags: fresh.tags || {} };

      // Wikidata'dan önerilen tag'leri çek
      const wdSuggestions = await OSM_API.getWikidataTagSuggestions(qid);

      section.innerHTML = _buildPreviewHTML(qid, _selectedOSMEl, wdSuggestions);

    } catch (e) {
      section.innerHTML = `
        <div style="font-size:12px; color:#e74c3c;">
          ⚠️ Eleman detayı alınamadı: ${e.message}
        </div>`;
    }
  }

  function _buildPreviewHTML(qid, el, wdSuggestions) {
    const keId      = _activeKEItem?.i || _activeKEItem?.id || '';
    const typeLabel = OSM_API.osmTypeLabel(el.type);

    // Zorunlu tag'ler (her zaman eklenir)
    const requiredTags = {
      'wikidata': qid,
    };

    // Önerilen tag'ler: Wikidata'dan gelip OSM'de henüz olmayan
    const suggestedEntries = Object.entries(wdSuggestions)
      .filter(([k, v]) => !el.tags[k] && v);

    const suggestedHTML = suggestedEntries.length > 0
      ? suggestedEntries.map(([k, v]) => `
          <label style="display:flex; align-items:flex-start; gap:7px; padding:5px 0; font-size:12px; cursor:pointer;">
            <input type="checkbox" name="osm_tag_${k}" value="${v}" checked
                   style="margin-top:2px; cursor:pointer; accent-color:#27ae60;">
            <span>
              <code style="background:#eaf4e8; color:#1a5c1a; padding:1px 5px; border-radius:3px;">${k}</code>
              = <strong>${v}</strong>
            </span>
          </label>`).join('')
      : `<div style="font-size:11px; color:#95a5a6;">Aktarılacak ek veri yok.</div>`;

    const existingConflict = Object.entries(requiredTags)
      .filter(([k]) => el.tags[k] && el.tags[k] !== requiredTags[k])
      .map(([k, v]) => `<div style="font-size:11px; color:#e67e22;">⚠️ <code>${k}</code> zaten <strong>${el.tags[k]}</strong> — <strong>${v}</strong> ile güncellenecek</div>`)
      .join('');

    return `
      <div>
        <div style="font-size:12px; font-weight:700; color:#2c3e50; margin-bottom:8px;">
          Seçilen: ${typeLabel} #${el.id}
          <span style="font-weight:400; color:#7f8c8d;"> — ${el.tags.name || '—'}</span>
        </div>

        <!-- Zorunlu tag'ler -->
        <div style="background:#e8f5e9; border-radius:6px; padding:9px 11px; margin-bottom:8px;">
          <div style="font-size:11px; font-weight:700; color:#1b5e20; margin-bottom:5px; text-transform:uppercase;">
            Zorunlu Eklenecekler
          </div>
          ${Object.entries(requiredTags).map(([k,v]) => `
            <div style="font-size:12px; padding:2px 0;">
              <code style="background:#c8e6c9; color:#1b5e20; padding:1px 5px; border-radius:3px;">${k}</code>
              = <strong>${v}</strong>
              ${el.tags[k] === v ? '<span style="color:#27ae60; font-size:10px;"> (mevcut)</span>' : ''}
            </div>`).join('')}
          ${existingConflict}
        </div>

        <!-- Önerilen tag'ler -->
        <div style="background:#f8f9fa; border-radius:6px; padding:9px 11px; margin-bottom:10px;">
          <div style="font-size:11px; font-weight:700; color:#555; margin-bottom:5px; text-transform:uppercase;">
            Wikidata'dan Önerilen
          </div>
          <div id="osm-suggested-tags">${suggestedHTML}</div>
        </div>

        <!-- Changeset açıklaması -->
        <div style="margin-bottom:10px;">
          <label style="font-size:11px; font-weight:600; color:#555; display:block; margin-bottom:3px;">
            Changeset Yorumu:
          </label>
          <input id="osm-changeset-comment"
                 value="wikidata ${qid} eklendi"
                 style="width:100%; font-size:11px; padding:5px 8px; border:1px solid #ddd; border-radius:4px; box-sizing:border-box;">
        </div>

        <!-- Butonlar -->
        <div style="display:flex; gap:6px;">
          <button onclick="OSM_MODULE.confirmAndWrite('${qid}')"
                  style="flex:1; background:linear-gradient(135deg,#27ae60,#1e8449); color:white; border:none; padding:9px; border-radius:6px; cursor:pointer; font-size:13px; font-weight:700;">
            ✅ Onayla ve Kaydet
          </button>
          <button onclick="OSM_MODULE.searchNearbyOSM('${qid}', ${_activeKEItem?.lat||0}, ${_activeKEItem?.lng||0})"
                  style="background:#ecf0f1; color:#555; border:1px solid #ddd; padding:9px 13px; border-radius:6px; cursor:pointer; font-size:12px;">
            ← Geri
          </button>
        </div>
      </div>`;
  }

  // ── Onayla ve Yaz ─────────────────────────────────────────────
  async function confirmAndWrite(qid) {
    if (!_selectedOSMEl) return;

    const osmUser = OSM_AUTH.getUser();
    if (!osmUser) {
      alert('OSM işlemi için giriş yapmanız gerekiyor.');
      OSM_AUTH.login();
      return;
    }

    // Seçili önerilen tag'leri topla
    const checkboxes = document.querySelectorAll('#osm-suggested-tags input[type=checkbox]:checked');
    const keId       = _activeKEItem?.i || _activeKEItem?.id || '';
    const comment    = `wikidata ${qid} eklendi`;

    const tagsToAdd = {
      'wikidata': qid,
    };

    checkboxes.forEach(cb => {
      const key = cb.name.replace('osm_tag_', '');
      tagsToAdd[key] = cb.value;
    });

    // UI: yükleniyor
    const section = document.getElementById('osm-section');
    if (section) section.innerHTML = _loadingHTML('OSM ve Wikidata\u2019ya yazılıyor\u2026');

    const errors = [];

    // 1) OSM'ye yaz
    try {
      await OSM_API.writeTagsToElement({
        type:             _selectedOSMEl.type,
        id:               _selectedOSMEl.id,
        version:          _selectedOSMEl.version,
        tagsToAdd,
        changesetComment: comment,
        accessToken:      osmUser.accessToken,
      });
    } catch (e) {
      errors.push(`OSM yazma hatası: ${e.message}`);
    }

    // 2) Wikidata'ya OSM ID ekle
    if (_wikidataToken) {
      try {
        await OSM_API.addOSMPropertyToWikidata({
          qid,
          osmType:        _selectedOSMEl.type,
          osmId:          _selectedOSMEl.id,
          wikimediaToken: _wikidataToken,
        });
      } catch (e) {
        errors.push(`Wikidata yazma hatası: ${e.message}`);
      }
    } else {
      errors.push('Wikimedia girişi yok — Wikidata\'ya OSM ID eklenemedi.');
    }

    // Sonuç
    if (errors.length === 0) {
      _showNotification('✅ OSM ve Wikidata güncellendi!', 'success');
      // Paneli "bağlı" durumuna geçir
      const osmStatus = { [_selectedOSMEl.type]: String(_selectedOSMEl.id) };
      if (section) section.innerHTML = _osmLinkedHTML(
        qid, _selectedOSMEl.type, _selectedOSMEl.id, osmStatus
      );
    } else {
      _showNotification('⚠️ Kısmi hata: ' + errors[0], 'error');
      if (section) section.innerHTML = `
        <div style="font-size:12px; color:#e74c3c;">
          ${errors.map(e => `<div>⚠️ ${e}</div>`).join('')}
          <button onclick="OSM_MODULE.selectOSMElement('${qid}', ${JSON.stringify(_selectedOSMEl).replace(/'/g,"\\'")})"
                  style="margin-top:8px; font-size:11px; background:#ecf0f1; border:1px solid #ddd; padding:4px 10px; border-radius:4px; cursor:pointer;">
            ← Geri Dön
          </button>
        </div>`;
    }
  }

  // ── Tag Aktarımı (Zaten Bağlı Elemanlar İçin) ─────────────────
  async function openTagTransfer(qid, type, id) {
    const section = document.getElementById('osm-section');
    if (!section) return;

    section.innerHTML = _loadingHTML('Tag bilgileri alınıyor…');

    try {
      const [el, wdSuggestions] = await Promise.all([
        OSM_API.getElement(type, id),
        OSM_API.getWikidataTagSuggestions(qid),
      ]);

      _selectedOSMEl = { type, id, version: el.version, tags: el.tags || {} };
      section.innerHTML = _buildPreviewHTML(qid, _selectedOSMEl, wdSuggestions);

    } catch (e) {
      section.innerHTML = `<div style="font-size:12px; color:#e74c3c;">⚠️ ${e.message}</div>`;
    }
  }

  // ── OSM Eksik QID Modu ────────────────────────────────────────
  async function toggleOSMMissingMode() {
    const btn = document.getElementById('osmMissingBtn');
    if (_osmMissingMode) {
      // Modu kapat
      _osmMissingMode = false;
      if (_osmMissingLayer) { map.removeLayer(_osmMissingLayer); _osmMissingLayer = null; }
      if (btn) { btn.textContent = 'OSM Eksik QID'; btn.style.background = 'linear-gradient(135deg,#8e44ad,#6c3483)'; }
      return;
    }

    // Modu aç
    _osmMissingMode = true;
    if (btn) { btn.textContent = '⏳ Yükleniyor…'; btn.disabled = true; }

    try {
      const items = await _fetchOSMMissingQIDs();
      _renderOSMMissingLayer(items);
      if (btn) {
        btn.textContent = `OSM Eksik (${items.length})`;
        btn.style.background = 'linear-gradient(135deg,#c0392b,#a93226)';
        btn.disabled = false;
      }
    } catch (e) {
      _osmMissingMode = false;
      if (btn) { btn.textContent = 'OSM Eksik QID'; btn.disabled = false; }
      _showNotification('SPARQL hatası: ' + e.message, 'error');
    }
  }

  async function _fetchOSMMissingQIDs() {
    const sparql = `
SELECT ?place ?placeLabel ?coordinates WHERE {
  ?place wdt:P11729 ?keID.
  ?place wdt:P625 ?coordinates.
  ?place wdt:P17 wd:Q43.
  FILTER NOT EXISTS { ?place wdt:P10689 ?w. }
  FILTER NOT EXISTS { ?place wdt:P402  ?r. }
  FILTER NOT EXISTS { ?place wdt:P11693 ?n. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
}`.trim();

    const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql) + '&format=json';
    const res  = await fetch(url, { headers: { Accept: 'application/sparql-results+json' } });
    if (!res.ok) throw new Error(`SPARQL ${res.status}`);
    const data = await res.json();

    return data.results.bindings.map(b => {
      const coords = b.coordinates?.value?.match(/Point\(([^ ]+) ([^ )]+)\)/);
      if (!coords) return null;
      return {
        qid:   b.place.value.split('/').pop(),
        label: b.placeLabel.value,
        lat:   parseFloat(coords[2]),
        lng:   parseFloat(coords[1]),
      };
    }).filter(d => d && !isNaN(d.lat));
  }

  function _renderOSMMissingLayer(items) {
    if (_osmMissingLayer) map.removeLayer(_osmMissingLayer);
    _osmMissingLayer = L.layerGroup();

    const icon = L.circleMarker; // kullan
    items.forEach(item => {
      const marker = L.circleMarker([item.lat, item.lng], {
        radius: 7,
        fillColor: '#8e44ad',
        color: '#6c3483',
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.85,
      });

      marker.bindTooltip(`<strong>${item.label}</strong><br><span style="color:#8e44ad">${item.qid}</span>`, { direction: 'top' });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        _activeQID    = item.qid;
        _activeKEItem = { lat: item.lat, lng: item.lng, i: null, n: item.label };

        // Paneli aç ve hemen Overpass aramasını başlat
        const panel = document.getElementById('infoPanel');
        if (panel) {
          panel.style.display = 'block';
          panel.innerHTML = `
            <h2 style="font-size:15px; color:#1a237e; border-bottom:2px solid #3f51b5; padding-bottom:8px; margin-bottom:10px;">
              ${item.label}
            </h2>
            <p style="font-size:12px; color:#555; margin-bottom:8px;">
              <a href="https://www.wikidata.org/wiki/${item.qid}" target="_blank" style="color:#3498db;">${item.qid}</a>
            </p>
            <div id="osm-section"></div>`;
          searchNearbyOSM(item.qid, item.lat, item.lng);
        }
      });

      _osmMissingLayer.addLayer(marker);
    });

    _osmMissingLayer.addTo(map);
  }

  // ── Stats Paneline Buton Ekle ─────────────────────────────────
  function _injectOSMMissingButton() {
    const statsPanel = document.querySelector('.stats-panel');
    if (!statsPanel || document.getElementById('osmMissingBtn')) return;

    const div = document.createElement('div');
    div.className = 'stat-item';
    div.innerHTML = `
      <button id="osmMissingBtn"
              onclick="OSM_MODULE.toggleOSMMissingMode()"
              style="background:linear-gradient(135deg,#8e44ad,#6c3483); color:white; border:none;
                     padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:600;
                     font-size:12px; transition:transform 0.2s;"
              onmouseover="this.style.transform='scale(1.05)'"
              onmouseout="this.style.transform='scale(1)'">
        OSM Eksik QID
      </button>`;
    statsPanel.appendChild(div);
  }

  // ── Bildirim ──────────────────────────────────────────────────
  // app.js'deki mevcut notification box'ı kullan
  function _showNotification(msg, type = 'success') {
    const box = document.getElementById('notification-box');
    if (!box) return;
    box.textContent  = msg;
    box.className    = type;
    box.style.display = 'block';
    setTimeout(() => { box.style.display = 'none'; }, 4000);
  }

  // ── Altlık Haritayı OSM Standart ile Değiştir ────────────────
  function _switchToOSMTiles() {
    if (typeof map === 'undefined') return;
    // Mevcut tile katmanlarını kaldır
    map.eachLayer(layer => {
      if (layer instanceof L.TileLayer) map.removeLayer(layer);
    });
    // Klasik OSM altlığı ekle
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıda bulunanlar',
      maxZoom: 19,
    }).addTo(map);
  }

  // ── Başlat ────────────────────────────────────────────────────
  function init() {
    // app.js tamamen yüklendikten sonra hook'ları kur
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hookIntoApp);
    } else {
      // DOMContentLoaded zaten geçtiyse biraz bekle (app.js'nin bitmesi için)
      setTimeout(hookIntoApp, 200);
    }
    // Harita hazır olunca tile katmanını değiştir
    setTimeout(_switchToOSMTiles, 500);
  }

  // ── Public API ────────────────────────────────────────────────
  return {
    init,
    searchNearbyOSM,
    selectOSMElement,
    confirmAndWrite,
    openTagTransfer,
    toggleOSMMissingMode,
  };

})();

OSM_MODULE.init();
