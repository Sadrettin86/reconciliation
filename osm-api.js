// ============================================
// OSM API — Overpass + Changeset Yazma
// ============================================
// Overpass: doğrudan (CORS destekli, okuma)
// OSM write API: toolforge proxy üzerinden
// ============================================

const OSM_API = (() => {

  const OSM_BASE    = 'https://api.openstreetmap.org/api/0.6';
  const PROXY_BASE  = 'https://keharita.toolforge.org';
  const OVERPASS    = 'https://overpass-api.de/api/interpreter';

  // Wikidata property → OSM element tipi eşlemesi
  const OSM_TYPE_TO_WD_PROPERTY = {
    node:     'P11693',
    way:      'P10689',
    relation: 'P402',
  };

  // ── Overpass: Yakın OSM Elemanları ──────────────────────────
  async function findNearbyElements(lat, lng, radiusMeters) {
    const r = radiusMeters;
    const query = `
[out:json][timeout:15];
(
  node(around:${r},${lat},${lng});
  way(around:${r},${lat},${lng});
  relation(around:${r},${lat},${lng});
);
out body;
>;
out skel qt;
`.trim();

    const res = await fetch(OVERPASS, {
      method: 'POST',
      body:   'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!res.ok) throw new Error('Overpass isteği başarısız');
    const data = await res.json();

    // Düğüm koordinatlarını way/relation için bir haritaya al
    const nodeCoords = {};
    for (const el of data.elements) {
      if (el.type === 'node') nodeCoords[el.id] = { lat: el.lat, lon: el.lon };
    }

    // Tüm elemanları döndür (isimsizler dahil), merkez koordinatı ekle
    return data.elements
      .filter(el => el.tags)
      .map(el => {
        let center = null;
        if (el.type === 'node') {
          center = { lat: el.lat, lon: el.lon };
        } else if (el.type === 'way' && el.nodes && el.nodes.length) {
          // Way için ilk düğüm koordinatı yaklaşık merkez olarak kullanılır
          const nc = nodeCoords[el.nodes[Math.floor(el.nodes.length / 2)]];
          if (nc) center = nc;
        } else if (el.center) {
          center = el.center;
        }

        const distance = center
          ? haversineMeters(lat, lng, center.lat, center.lon)
          : null;

        return {
          type:     el.type,
          id:       el.id,
          tags:     el.tags || {},
          center,
          distance,
          hasWikidata: !!el.tags?.wikidata,
          wikidataTag: el.tags?.wikidata || null,
        };
      })
      .filter(el => el.distance !== null)
      .sort((a, b) => a.distance - b.distance);
  }

  // ── OSM Element Detayı ───────────────────────────────────────
  async function getElement(type, id) {
    const res = await fetch(`${OSM_BASE}/${type}/${id}.json`);
    if (!res.ok) throw new Error(`OSM element alınamadı: ${type}/${id}`);
    const data = await res.json();
    return data.elements[0];
  }

  // ── Changeset Oluştur → Tag Ekle → Kapat (proxy) ────────────
  // toolforge'a eklenmesi gereken endpoint: POST /osm-edit
  // Body: { access_token, type, id, version, tags_to_add, changeset_comment }
  async function writeTagsToElement({ type, id, version, tagsToAdd, changesetComment, accessToken }) {
    const res = await fetch(`${PROXY_BASE}/osm-edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token:      accessToken,
        type,
        id,
        version,
        tags_to_add:       tagsToAdd,
        changeset_comment: changesetComment,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OSM yazma hatası: ${err}`);
    }

    return res.json(); // { changeset_id, new_version }
  }

  // ── Wikidata'ya OSM ID Ekle (mevcut proxy) ──────────────────
  async function addOSMPropertyToWikidata({ qid, osmType, osmId, wikimediaToken }) {
    const property = OSM_TYPE_TO_WD_PROPERTY[osmType];
    if (!property) throw new Error(`Bilinmeyen OSM tipi: ${osmType}`);

    const res = await fetch(`${PROXY_BASE}/add-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: wikimediaToken,
        qid,
        property,
        value: String(osmId),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Wikidata yazma hatası: ${err}`);
    }

    return res.json();
  }

  // ── Wikidata SPARQL: QID'nin OSM Durumunu Sorgula ───────────
  async function checkWikidataOSMStatus(qid) {
    const sparql = `
SELECT ?osmNode ?osmWay ?osmRel ?nameLabel WHERE {
  OPTIONAL { wd:${qid} wdt:P11693 ?osmNode. }
  OPTIONAL { wd:${qid} wdt:P10689 ?osmWay. }
  OPTIONAL { wd:${qid} wdt:P402  ?osmRel. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
}
LIMIT 1`.trim();

    const url = 'https://query.wikidata.org/sparql?query=' +
      encodeURIComponent(sparql) + '&format=json';

    const res = await fetch(url, {
      headers: { Accept: 'application/sparql-results+json' },
    });

    if (!res.ok) throw new Error('Wikidata SPARQL hatası');
    const data = await res.json();
    const b = data.results.bindings[0] || {};

    return {
      node:     b.osmNode     ? extractOSMId(b.osmNode.value)    : null,
      way:      b.osmWay      ? extractOSMId(b.osmWay.value)     : null,
      relation: b.osmRel      ? extractOSMId(b.osmRel.value)     : null,
    };
  }

  // ── Wikidata'dan Aktarılabilecek Tag'leri Çek ───────────────
  async function getWikidataTagSuggestions(qid) {
    const sparql = `
SELECT ?nameLabel ?nameTrLabel ?nameEnLabel ?wikipedia ?website ?heritage WHERE {
  OPTIONAL { wd:${qid} rdfs:label ?nameTr FILTER(LANG(?nameTr)="tr"). }
  OPTIONAL { wd:${qid} rdfs:label ?nameEn FILTER(LANG(?nameEn)="en"). }
  OPTIONAL {
    ?article schema:about wd:${qid};
             schema:inLanguage "tr";
             schema:isPartOf <https://tr.wikipedia.org/>.
    BIND(?article AS ?wikipedia)
  }
  OPTIONAL { wd:${qid} wdt:P856 ?website. }
  OPTIONAL { wd:${qid} wdt:P1435 ?heritageStatus. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en". }
  BIND(COALESCE(?nameTr, ?nameEn) AS ?name)
}
LIMIT 1`.trim();

    const url = 'https://query.wikidata.org/sparql?query=' +
      encodeURIComponent(sparql) + '&format=json';

    const res = await fetch(url, {
      headers: { Accept: 'application/sparql-results+json' },
    });

    if (!res.ok) throw new Error('Wikidata SPARQL hatası');
    const data = await res.json();
    const b = data.results.bindings[0] || {};

    const suggestions = {};

    if (b.nameTrLabel?.value) suggestions['name']    = b.nameTrLabel.value;
    if (b.nameTrLabel?.value) suggestions['name:tr'] = b.nameTrLabel.value;
    if (b.nameEnLabel?.value) suggestions['name:en'] = b.nameEnLabel.value;
    if (b.wikipedia?.value) {
      // https://tr.wikipedia.org/wiki/Foo → tr:Foo
      const wpTitle = b.wikipedia.value.split('/wiki/')[1];
      if (wpTitle) suggestions['wikipedia'] = `tr:${decodeURIComponent(wpTitle)}`;
    }
    if (b.website?.value)  suggestions['website']  = b.website.value;
    if (b.heritage?.value) suggestions['heritage'] = '2'; // Türkiye tescilli

    return suggestions;
  }

  // ── Yardımcılar ──────────────────────────────────────────────
  function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1 * Math.PI/180) *
              Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLng/2)**2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
  }

  function extractOSMId(uri) {
    // "https://www.openstreetmap.org/node/12345" → "12345"
    const parts = uri.split('/');
    return parts[parts.length - 1];
  }

  function osmTypeLabel(type) {
    return { node: 'Nokta', way: 'Yol', relation: 'İlişki' }[type] || type;
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    findNearbyElements,
    getElement,
    writeTagsToElement,
    addOSMPropertyToWikidata,
    checkWikidataOSMStatus,
    getWikidataTagSuggestions,
    osmTypeLabel,
    OSM_TYPE_TO_WD_PROPERTY,
  };

})();
