// ----- Country styling -----
// Colorblind-safe political-map palette. Foundation is Okabe-Ito (designed
// for protanopia, deuteranopia, tritanopia): Donovia vermillion, Laurikin
// yellow, Houdini reddish-purple, Iceland bluish-green. Three deviations
// add hue/lightness separation Okabe-Ito alone can't provide:
//   • Olvana — deep wine red (darker than Donovia's vermillion so the
//     pair separates by lightness as well as hue under red-green CVD).
//   • Greenland — pale ice-pastel blue (much lighter than Okabe-Ito sky).
//   • Canada — deep navy (much darker than Okabe-Ito blue).
// The Greenland↔Canada lightness gap (~60 points) makes them distinct
// even under total achromatopsia. Faction temperature is preserved:
// warm = OPFOR, mid = neutral/contested, cool = real-world coalition.
const COUNTRY_STYLE = {
  'Olvana':    { stroke: '#4A1010', fill: '#8B2424', group: 'OPFOR (composite)' },
  'Donovia':   { stroke: '#7A3500', fill: '#D55E00', group: 'OPFOR (composite)' },
  'Laurikin':  { stroke: '#8C8222', fill: '#F0E442', group: 'Neutral / Contested' },
  'Houdini':   { stroke: '#7A4566', fill: '#CC79A7', group: 'Neutral / Contested' },
  'Iceland':   { stroke: '#005C44', fill: '#009E73', group: 'Real-world' },
  'Greenland': { stroke: '#4A7B95', fill: '#A6D8F2', group: 'Real-world' },
  'Canada':    { stroke: '#001A2C', fill: '#003F5C', group: 'Real-world' },
};
const DEFAULT_STYLE = { stroke: '#555', fill: '#bbb', group: 'Other' };

function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ----- Projection: EPSG:3978 (NAD83 / Canada Atlas Lambert) -----
// Lambert Conformal Conic, central meridian -95°W, standard parallels
// 49°N / 77°N. Conformal — preserves shape locally — and minimizes
// scale distortion across all of Canada and the surrounding North
// Atlantic and Arctic.
proj4.defs(
  'EPSG:3978',
  '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs'
);
ol.proj.proj4.register(proj4);
const proj3978 = ol.proj.get('EPSG:3978');
proj3978.setExtent([-4926564, -5396819, 5347436, 4623181]);

// ----- Polygon style (fill only) -----
// Strokes are NOT in the style — they're drawn in a postrender hook below
// (see "Split-color borders") so each country only paints its own interior
// half of the stroke, exposing the neighbor's color on the other side.
// When a basemap is active, the fill is dropped so masked terrain shows
// — unless the "country tint" toggle is on, in which case a 40% wash of
// the country color is painted over the basemap (hybrid political/topo).
let basemapActive    = false;
let countryTintActive = false;
let countryTintAlpha = 0.40;  // user-adjustable via slider; range 0..1
let rangeToolActive  = false;
function countryStyle(feature, hover = false) {
  const name = feature.get('NAME');
  const s = COUNTRY_STYLE[name] || DEFAULT_STYLE;
  let fillColor;
  if (basemapActive) {
    fillColor = countryTintActive ? hexAlpha(s.fill, countryTintAlpha) : 'rgba(0,0,0,0)';
  } else if (hover) {
    fillColor = hexAlpha(s.fill, 1.0);
  } else {
    fillColor = hexAlpha(s.fill, 0.92);
  }
  return new ol.style.Style({
    fill: new ol.style.Fill({ color: fillColor }),
  });
}

// ----- Country polygon source + layer -----
const countriesSource = new ol.source.Vector({
  url: 'data/scenario.geojson',
  format: new ol.format.GeoJSON({
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3978',
  }),
});
const countriesLayer = new ol.layer.Vector({
  source: countriesSource,
  style: countryStyle,
  zIndex: 10,   // above basemap tiles (5), below weather (40+) and labels (100)
});

// ----- Label layer (one Point per unique country NAME) -----
const labelsSource = new ol.source.Vector();
const labelsLayer = new ol.layer.Vector({
  source: labelsSource,
  style: feature => new ol.style.Style({
    text: new ol.style.Text({
      text: feature.get('label'),
      font: '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fill: new ol.style.Fill({ color: '#fff' }),
      stroke: new ol.style.Stroke({ color: '#000', width: 3 }),
      textAlign: 'center',
    }),
  }),
  // Labels render on top of polygons
  zIndex: 100,
});

// ----- Map -----
// No ScaleLine: the range-rings tool (bottom-left) is the primary
// distance reference instead. Each ring is labeled with its true ground
// distance (250 / 500 / 750 / 1000 km), which is unambiguous regardless
// of viewport latitude — a scale bar would only have duplicated/conflicted
// with the rings' own per-radius labels.
const map = new ol.Map({
  target: 'map',
  layers: [countriesLayer, labelsLayer],
  view: new ol.View({
    projection: 'EPSG:3978',
    center: [0, 0],
    zoom: 1,
  }),
  controls: ol.control.defaults.defaults({
    attributionOptions: { collapsible: true },
  }),
});

// ----- Persisted UI / view state (localStorage) -----
const MAP_STATE_KEY = 'bq26-webmap-state-v1';
let _restoringMapState = false;
let _saveMapStateTimer = null;
let pendingSavedMapState = null;
let _suppressViewSave = false;
let _viewPersistenceBound = false;
try {
  const _rawState = localStorage.getItem(MAP_STATE_KEY);
  if (_rawState) pendingSavedMapState = JSON.parse(_rawState);
} catch (e) {
  console.warn('[map-state] load failed:', e);
}

function applySavedView(viewState) {
  if (!viewState?.center || viewState.zoom == null) return false;
  const view = map.getView();
  _suppressViewSave = true;
  try {
    view.setCenter(viewState.center);
    if (viewState.resolution != null) {
      view.setResolution(viewState.resolution);
    } else {
      view.setZoom(viewState.zoom);
    }
  } finally {
    _suppressViewSave = false;
  }
  return true;
}

function bindViewPersistence() {
  if (_viewPersistenceBound) return;
  _viewPersistenceBound = true;
  map.getView().on(['change:center', 'change:resolution'], scheduleSaveMapState);
}

// ----- Build labels + fit view once polygons load -----
countriesSource.once('featuresloadend', () => {
  // Drop the inline Ocean polygon — the dark map background is the "ocean"
  const all = countriesSource.getFeatures();
  const oceanFeatures = all.filter(f => f.get('TYPE') === 'Ocean');
  for (const f of oceanFeatures) countriesSource.removeFeature(f);
  const countryFeatures = all.filter(f => f.get('TYPE') !== 'Ocean');

  // Cache each feature's polygon coordinate structure once. The postrender
  // hook walks these every frame; calling getCoordinates() each time would
  // re-allocate the nested [[x,y],...] array (64k entries for Canada alone)
  // on every render — a major contributor to tile-load choppiness.
  for (const f of countryFeatures) {
    const geom = f.getGeometry();
    if (!geom) continue;
    f.set('_polys', geom instanceof ol.geom.MultiPolygon
      ? geom.getCoordinates()
      : [geom.getCoordinates()]);
  }

  // Pick the largest sub-polygon per unique NAME (largest by extent area
  // in projected meters)
  function extentArea(extent) {
    return (extent[2] - extent[0]) * (extent[3] - extent[1]);
  }
  function largestPolygon(geom) {
    if (geom.getType() === 'Polygon') return geom;
    const polys = geom.getPolygons();
    let best = polys[0], bestA = extentArea(best.getExtent());
    for (let i = 1; i < polys.length; i++) {
      const a = extentArea(polys[i].getExtent());
      if (a > bestA) { bestA = a; best = polys[i]; }
    }
    return best;
  }

  const byName = new Map();
  for (const f of countryFeatures) {
    const poly = largestPolygon(f.getGeometry());
    const a = extentArea(poly.getExtent());
    const name = f.get('NAME');
    const prev = byName.get(name);
    if (!prev || a > prev.area) {
      byName.set(name, {
        poly, area: a, label: f.get('LABEL_TXT') || f.get('NAME'),
      });
    }
  }

  // Constrain panning: viewport can't extend more than 2000 km past
  // the country bounding box. EPSG:3978 units are meters, so buffer = 2e6.
  // smoothExtentConstraint stays at its default (true) so the edge feels
  // like a soft wall rather than a hard stop.
  const ext = countriesSource.getExtent();
  const PAN_BUFFER_M = 2_000_000;
  const bufferedExt = [
    ext[0] - PAN_BUFFER_M, ext[1] - PAN_BUFFER_M,
    ext[2] + PAN_BUFFER_M, ext[3] + PAN_BUFFER_M,
  ];
  // Update pan constraints on the existing view — do NOT replace the view
  // object. setView() would discard center/zoom and detach persistence listeners.
  const view = map.getView();
  view.setProperties({
    extent: bufferedExt,
    showFullExtent: true,
  });
  _suppressViewSave = true;
  try {
    if (!applySavedView(pendingSavedMapState?.view)) {
      view.fit(ext, { padding: [40, 40, 40, 40] });
    }
  } finally {
    _suppressViewSave = false;
  }
  bindViewPersistence();
  scenarioCountriesReady = true;
  rebuildScenarioCountryGeoms(countryFeatures);
  // Country labels + legend: defer one frame so map extent/view paint first.
  requestAnimationFrame(() => {
    for (const { poly, label } of byName.values()) {
      const ring = poly.getLinearRing(0).getCoordinates();
      let a = 0, cx = 0, cy = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
        const cross = x0 * y1 - x1 * y0;
        a  += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
      }
      a *= 0.5;
      labelsSource.addFeature(new ol.Feature({
        geometry: new ol.geom.Point([cx / (6 * a), cy / (6 * a)]),
        label,
      }));
    }
    buildLegend(countryFeatures);
  });
});

// POI popups: resolve scenario country on click only (not bulk-tagged at load —
// ~13k spatial lookups blocked the main thread and hung refresh).
let scenarioCountriesReady = false;
let scenarioCountryGeoms = [];
const SCENARIO_FICTION_PRIORITY = ['Olvana', 'Donovia', 'Laurikin', 'Houdini'];

function rebuildScenarioCountryGeoms(countryFeatures) {
  scenarioCountryGeoms = [];
  for (const f of countryFeatures) {
    const geom = f.getGeometry();
    const name = f.get('NAME');
    if (geom && name) scenarioCountryGeoms.push({ name, geom });
  }
}

function pickScenarioCountryName(names) {
  const uniq = [...new Set(names.filter((n) => n && n !== 'Ocean'))];
  if (!uniq.length) return null;
  for (const n of SCENARIO_FICTION_PRIORITY) {
    if (uniq.includes(n)) return n;
  }
  return uniq[0];
}

function scenarioCountryAtCoord(coord3978) {
  if (!coord3978 || !scenarioCountriesReady) return null;
  const hits = [];
  for (const { name, geom } of scenarioCountryGeoms) {
    if (geom.intersectsCoordinate(coord3978)) hits.push(name);
  }
  return pickScenarioCountryName(hits);
}

function popupScenarioCountryRow(scenarioName) {
  if (!scenarioName) return '';
  const group = (COUNTRY_STYLE[scenarioName] || DEFAULT_STYLE).group;
  return `
      <span class="k">Country</span><span class="v">${scenarioName}${group ? ` <span class="badge">${group}</span>` : ''}</span>`;
}

// ----- Cursor coordinate readout: lat/lon (with N/S/E/W) + MGRS -----
const coordsLatLon = document.getElementById('coords-latlon');
const coordsMgrs   = document.getElementById('coords-mgrs');

function fmtLatLon(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}
function fmtMgrs(lat, lon) {
  try {
    // 5 = 1m precision; output is e.g. "16TFN1234567890"
    const raw = mgrs.forward([lon, lat], 5);
    // Standard NATO readable form: "<zone><band> <square> <easting> <northing>"
    const m = raw.match(/^(\d{1,2}[A-Z])([A-Z]{2})(\d{5})(\d{5})$/);
    return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : raw;
  } catch (e) {
    return '—';  // mgrs.forward throws near the poles / outside its valid range
  }
}

/** Lat/lon + MGRS rows for popups (coord in EPSG:3978 map meters). */
function popupGeoRowsFromCoord(coord3978) {
  const [lon, lat] = ol.proj.toLonLat(coord3978, 'EPSG:3978');
  return `
      <span class="k">Lat/Lon</span><span class="v v-coords">${fmtLatLon(lat, lon)}</span>
      <span class="k">MGRS</span><span class="v v-coords">${fmtMgrs(lat, lon)}</span>`;
}

map.on('pointermove', (evt) => {
  if (evt.dragging) return;
  const [lon, lat] = ol.proj.toLonLat(evt.coordinate, 'EPSG:3978');
  coordsLatLon.textContent = fmtLatLon(lat, lon);
  coordsMgrs.textContent   = fmtMgrs(lat, lon);
});
map.getViewport().addEventListener('mouseleave', () => {
  coordsLatLon.textContent = 'Move cursor for coordinates';
  coordsMgrs.textContent   = '';
});

// ----- Hover highlight (throttled to one hit-test per animation frame) -----
// pointermove fires on every pixel of mouse motion; hit-testing 121k vertices
// across 7 MultiPolygons that often is enough to cause visible jank. rAF
// coalesces rapid events into one pass per frame (~60Hz), and the basemap
// short-circuit skips style flips that wouldn't change anything visible.
let hoverFeature = null;
let pendingHoverEvt = null;
let hoverRafId = 0;
map.on('pointermove', (evt) => {
  if (evt.dragging) return;
  pendingHoverEvt = evt;
  if (hoverRafId) return;
  hoverRafId = requestAnimationFrame(() => {
    hoverRafId = 0;
    const e = pendingHoverEvt;
    pendingHoverEvt = null;
    if (!e) return;
    const f = map.forEachFeatureAtPixel(e.pixel, (fr, layer) =>
      layer === countriesLayer ? fr : null
    );
    if (f !== hoverFeature) {
      // In basemap mode the country fill is fixed (transparent or 40% tint),
      // so toggling hover style triggers a re-render with no visible change.
      if (!basemapActive) {
        if (hoverFeature) hoverFeature.setStyle(undefined);
        if (f) f.setStyle(countryStyle(f, true));
      }
      hoverFeature = f;
    }
    // Range tool owns the cursor while active — don't let hover override it.
    if (!rangeToolActive) {
      map.getTargetElement().style.cursor = f ? 'pointer' : '';
    }
  });
});

// ----- Click popup -----
const popupEl     = document.getElementById('popup');
const popupBody   = document.getElementById('popup-content');
const popupClose  = document.getElementById('popup-close');
const popupOverlay = new ol.Overlay({
  element: popupEl,
  positioning: 'bottom-center',
  // Small standoff so the popup body doesn't sit exactly on the cursor.
  offset: [0, -8],
  stopEvent: true,
  autoPan: { animation: { duration: 250 }, margin: 40 },
});
map.addOverlay(popupOverlay);
popupClose.addEventListener('click', () => { popupEl.style.display = 'none'; });

function fmtArea(m2) {
  if (!m2 || m2 <= 0) return '—';
  return (m2 / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' km²';
}

map.on('click', (evt) => {
  // Range-rings tool takes precedence: a click places concentric rings at
  // the cursor and skips the country popup.
  if (rangeToolActive) {
    placeRangeRings(evt.coordinate);
    popupEl.style.display = 'none';
    return;
  }
  const f = map.forEachFeatureAtPixel(evt.pixel, (fr, layer) =>
    layer === countriesLayer ? fr : null
  );
  if (!f) { popupEl.style.display = 'none'; return; }

  const p = f.getProperties();
  const name  = p.LABEL_TXT || p.NAME || '(unnamed)';
  const type  = p.TYPE || '—';
  const group = (COUNTRY_STYLE[p.NAME] || DEFAULT_STYLE).group;
  popupBody.innerHTML = `
    <h3>${name}</h3>
    <div class="kv">
      <span class="k">Type</span><span class="v"><span class="badge">${type}</span></span>
      ${popupGeoRowsFromCoord(evt.coordinate)}
      <span class="k">Name</span><span class="v">${p.NAME ?? '—'}</span>
      <span class="k">Label</span><span class="v">${p.LABEL_TXT ?? '<em>(none)</em>'}</span>
      <span class="k">Group</span><span class="v">${group}</span>
      <span class="k">Area</span><span class="v">${fmtArea(p.Shape_Area)}</span>
    </div>`;
  popupEl.style.display = '';
  popupOverlay.setPosition(evt.coordinate);
});

// ----- Reset-view control (custom) -----
class ResetControl extends ol.control.Control {
  constructor() {
    const button = document.createElement('button');
    button.innerHTML = '⌖';
    button.title = 'Reset view to scenario extent';
    const div = document.createElement('div');
    div.className = 'ol-reset-view ol-unselectable ol-control';
    div.appendChild(button);
    super({ element: div });
    button.addEventListener('click', () => {
      const ext = countriesSource.getExtent();
      if (ext && isFinite(ext[0])) {
        map.getView().fit(ext, { padding: [40, 40, 40, 40], duration: 300 });
      }
    });
  }
}
map.addControl(new ResetControl());

// ----- Legend (grouped by faction) -----
function buildLegend(features) {
  const seen = new Set();
  const groups = {};
  for (const f of features) {
    const name = f.get('NAME');
    if (seen.has(name)) continue;
    seen.add(name);
    const s = COUNTRY_STYLE[name] || DEFAULT_STYLE;
    (groups[s.group] = groups[s.group] || []).push({ name, fill: s.fill });
  }
  let html = '<h4>Faction Map</h4>';
  for (const [grp, items] of Object.entries(groups)) {
    html += `<div class="group">${grp}</div>`;
    for (const it of items) {
      html += `<div class="row"><span class="swatch" style="background:${it.fill}"></span>${it.name}</div>`;
    }
  }
  html += `<div class="group">Hydrography</div>`;
  html += `<div class="row"><span class="swatch" style="background:#1a2332"></span>Open Water</div>`;

  // Populate the pre-existing #legend slot inside .bottom-left-stack rather
  // than creating a floating element — the stack handles the layout (legend
  // on top of the range-rings widget) and the upward push when the widget
  // expands.
  const legend = document.getElementById('legend');
  legend.innerHTML = html;
  legend.removeAttribute('hidden');
}

// ----- Error surface for failed data load -----
countriesSource.on('featuresloaderror', () => {
  document.querySelector('.title-bar').innerHTML +=
    '<br><span style="color:#ff6b6b;font-size:11px">Failed to load data — serve this folder over HTTP (see file header).</span>';
});

// =============================================================
// Weather overlays — Environment Canada GeoMet (WMS, EPSG:3978)
// =============================================================
const GEOMET_URL = 'https://geo.weather.gc.ca/geomet';

// GeoMet WMS time dimension wants strict ISO8601 to seconds (no millis).
function isoSec(d) { return d.toISOString().replace(/\.\d+Z$/, 'Z'); }

const FRAME_DURATION_MS = 500;   // 2 fps
const $ = (id) => document.getElementById(id);

// ----- Master animation controller -----
// One timeline drives all enabled weather layers. The master cadence is
// the smallest cadence among layers (radar = 6 min). Each layer rounds
// the master timestamp to its OWN cadence — so radar updates every step,
// cloud cover updates only every 10 steps (60 / 6). Both end up showing
// the same effective moment in wall-clock time.
const BASE_CADENCE_MIN  = 6;
const MASTER_FRAMES     = 30;   // 3 hours of history at 6-min steps
const MASTER_LATENCY_MIN = 10;

const animatedLayers = []; // [{ layer, source, cadenceMs, lastTime, panelId }]
let masterFrame = MASTER_FRAMES - 1;
let masterTimer = null;
let masterPlaying = false;
let baseLatestMs = 0;

function refreshBaseLatest() {
  const cMs = BASE_CADENCE_MIN * 60_000;
  baseLatestMs = Math.floor((Date.now() - MASTER_LATENCY_MIN * 60_000) / cMs) * cMs;
}
refreshBaseLatest();
setInterval(refreshBaseLatest, 5 * 60_000);

function masterTimeAt(idx) {
  return new Date(baseLatestMs - (MASTER_FRAMES - 1 - idx) * BASE_CADENCE_MIN * 60_000);
}
function fmtMasterTime(d, idx) {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const minsBack = (MASTER_FRAMES - 1 - idx) * BASE_CADENCE_MIN;
  const ago = minsBack === 0 ? 'now' : `−${minsBack}m`;
  return `${hh}:${mm}Z (${ago})`;
}
function applyMasterFrame() {
  const t = masterTimeAt(masterFrame);
  // For each visible layer, round t to that layer's cadence and update
  // the WMS TIME param only if it actually changed (prevents redundant fetches).
  for (const al of animatedLayers) {
    if (!al.layer.getVisible()) continue;
    const rounded = Math.floor(t.getTime() / al.cadenceMs) * al.cadenceMs;
    const iso = isoSec(new Date(rounded));
    if (iso !== al.lastTime) {
      al.source.updateParams({ TIME: iso });
      al.lastTime = iso;
    }
  }
  $('master-time').textContent = fmtMasterTime(t, masterFrame);
  $('master-slider').value = masterFrame;
}
function setMasterFrame(idx) { masterFrame = idx; applyMasterFrame(); }
function startMaster() {
  if (masterTimer) return;
  masterTimer = setInterval(() => setMasterFrame((masterFrame + 1) % MASTER_FRAMES), FRAME_DURATION_MS);
  masterPlaying = true;
  $('master-play').textContent = '⏸';
}
function stopMaster() {
  if (masterTimer) clearInterval(masterTimer);
  masterTimer = null;
  masterPlaying = false;
  $('master-play').textContent = '▶';
}
function anyLayerVisible() { return animatedLayers.some(al => al.layer.getVisible()); }

// Wire master controls
$('master-play').addEventListener('click', () => {
  if (masterPlaying) stopMaster(); else startMaster();
  scheduleSaveMapState();
});
$('master-slider').addEventListener('input', (e) => {
  stopMaster();
  setMasterFrame(parseInt(e.target.value, 10));
  scheduleSaveMapState();
});

// ----- Layer setup: registers a layer + toggle handler. No per-layer animation. -----
// crossOrigin is intentionally omitted — we don't need pixel access.
function setupAnimatedWmsLayer({ panelId, layerName, cadenceMin, opacity, zIndex }) {
  const cadenceMs = cadenceMin * 60_000;
  const source = new ol.source.TileWMS({
    url: GEOMET_URL,
    params: { LAYERS: layerName, FORMAT: 'image/png', TRANSPARENT: true, VERSION: '1.3.0' },
  });
  const layer = new ol.layer.Tile({ visible: false, opacity, source, zIndex });
  map.addLayer(layer);

  const al = { layer, source, cadenceMs, lastTime: null, panelId };
  animatedLayers.push(al);

  // Tile event hooks: loading indicator + error reporting
  let pending = 0, loaded = 0, errors = 0;
  source.on('tileloadstart', (e) => {
    pending++;
    $(panelId + '-loading').classList.add('on');
    if (loaded + errors === 0) {
      console.log(`[${panelId}] first tile URL:`, e.tile.src_ || e.tile.getImage().src);
    }
  });
  source.on('tileloadend', () => {
    loaded++;
    pending = Math.max(0, pending - 1);
    if (pending === 0) $(panelId + '-loading').classList.remove('on');
  });
  source.on('tileloaderror', (e) => {
    errors++;
    pending = Math.max(0, pending - 1);
    if (pending === 0) $(panelId + '-loading').classList.remove('on');
    console.warn(`[${panelId}] tile failed:`, e.tile.src_ || e.tile.getImage().src);
  });

  // Toggle: on first enable, show master controls + start anim if not running
  $('toggle-' + panelId).addEventListener('change', (e) => {
    if (e.target.checked) {
      layer.setVisible(true);
      al.lastTime = null;  // force update on the next applyMasterFrame
      $('master-controls').style.display = '';
      applyMasterFrame();
      if (!masterPlaying) startMaster();
    } else {
      layer.setVisible(false);
      $(panelId + '-loading').classList.remove('on');
      if (!anyLayerVisible()) {
        stopMaster();
        $('master-controls').style.display = 'none';
      }
    }
    scheduleSaveMapState();
  });
}

// Radar — Rain Rate Reflectivity, 1km grid, 6-min cadence
setupAnimatedWmsLayer({
  panelId:    'radar',
  layerName:  'RADAR_1KM_RRAI',
  cadenceMin: 6,
  opacity:    0.75,
  zIndex:     50,    // above country fills (default 0), below labels (100)
});

// GDPS total cloud cover — global NWP, 15km grid, hourly cadence.
// Renders only clouds (transparent over clear sky), no surface terrain.
setupAnimatedWmsLayer({
  panelId:    'cloud',
  layerName:  'GDPS_15km_TotalCloudCover',
  cadenceMin: 60,
  opacity:    0.7,
  zIndex:     40,    // below radar so radar wins compositing when both on
});

// =============================================================
// Basemaps — terrain/imagery tiles clipped to country polygons
// =============================================================
// The country polygons act as a mask: tiles render on the layer's canvas,
// then on `postrender` we composite the country shapes with
// globalCompositeOperation='destination-in'. That keeps only the pixels that
// fall inside the polygons; everything else is erased, leaving the dark
// "open water" backdrop visible. The country fill is dropped (see
// countryStyle above) so the masked terrain shows through; only the
// colored stroke remains for faction identification.

// NRCan tile pyramid (EPSG:3978-native services share this grid)
const NRCAN_RESOLUTIONS = [
  38364.660062653464, 22489.62831258996,  13229.193125052918,
  7937.5158750317505, 4630.2175937685215, 2645.8386250105837,
  1587.5031750063501, 926.0435187537042,  529.1677250021168,
  317.50063500127004, 185.20870375074085, 111.12522225044451,
  66.1459656252646,   38.36466006265346,  22.48962831258996,
  13.229193125052918, 7.9375158750317505, 4.6302175937685215,
  2.6458386250105836, 1.5875031750063502,
];
const nrcanTileGrid = new ol.tilegrid.TileGrid({
  origin: [-34655800, 39310000],
  resolutions: NRCAN_RESOLUTIONS,
  tileSize: [256, 256],
});
const NRCAN_BASE = 'https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps';

// Build a Path2D in device-pixel coordinates from a feature's cached
// polygon rings. `coordinateToPixelTransform` returns CSS pixels, so we
// multiply by frameState.pixelRatio for the device canvas. Returning a
// Path2D lets the caller reuse the same path for clip + stroke without
// re-walking the (potentially 64k-vertex) coordinate array.
function buildFeaturePath2D(feature, frameState) {
  const polys = feature.get('_polys');
  if (!polys) return null;
  const tx = frameState.coordinateToPixelTransform;
  const pr = frameState.pixelRatio;
  const path = new Path2D();
  for (const poly of polys) {
    for (const ring of poly) {
      const len = ring.length;
      if (len === 0) continue;
      const r0 = ring[0];
      path.moveTo((tx[0] * r0[0] + tx[2] * r0[1] + tx[4]) * pr,
                  (tx[1] * r0[0] + tx[3] * r0[1] + tx[5]) * pr);
      for (let i = 1; i < len; i++) {
        const ri = ring[i];
        path.lineTo((tx[0] * ri[0] + tx[2] * ri[1] + tx[4]) * pr,
                    (tx[1] * ri[0] + tx[3] * ri[1] + tx[5]) * pr);
      }
      path.closePath();
    }
  }
  return path;
}

// Combined Path2D used as the basemap clip mask (union of all countries).
function buildAllCountriesPath2D(frameState) {
  const combined = new Path2D();
  for (const feature of countriesSource.getFeatures()) {
    const p = buildFeaturePath2D(feature, frameState);
    if (p) combined.addPath(p);
  }
  return combined;
}

// ---- View-keyed caches ----
// Both the basemap clip path and the country border art are functions of
// (view state, feature set, basemap mode) only — not of which tile just
// loaded or which country is being hovered. Caching them and invalidating
// on view change means tile-load frames just blit a bitmap / reuse a
// Path2D, instead of re-walking ~121k vertices every time. This is what
// kept the page choppy after the JS hot-path optimizations: the postrender
// hook ran on every tile load and traversed full geometry each time.
let _clipPath = null;
let _clipPathKey = '';
function getCachedClipPath2D(fs) {
  const vs = fs.viewState;
  const key = `${vs.resolution}|${vs.center[0]}|${vs.center[1]}|${vs.rotation}|${fs.pixelRatio}`;
  if (key !== _clipPathKey) {
    _clipPath = buildAllCountriesPath2D(fs);
    _clipPathKey = key;
  }
  return _clipPath;
}

let _bordersCanvas = null;
let _bordersCtx = null;
let _bordersKey = '';
function invalidateRenderCaches() {
  _clipPathKey = '';
  _bordersKey  = '';
}
countriesSource.on('change', invalidateRenderCaches);

// ----- Split-color borders -----
// Every country strokes its own boundary clipped to its interior, so each
// neighbor only contributes the inner half of the stroke — at shared borders
// you see both colors meeting at the line.
//
// Two visual modes:
//   • No basemap: thin clean split-color outline (BORDER_PLAIN px / side).
//   • Basemap on: NatGeo-style fading band — built by stacking BAND_STEPS
//     concentric strokes from widest+narrowest (each at the same low alpha).
//     Strokes overlap most near the boundary and least at BAND_MAX_WIDTH
//     inward, producing a smooth falloff from opaque at the border to
//     transparent at the inward edge.
const BORDER_PLAIN     = 1.4;   // CSS px per side, no-basemap mode
const BAND_MAX_WIDTH   = 10;    // CSS px per side, widest stroke (extent of fade)
const BAND_MIN_WIDTH   = 0.5;   // CSS px per side, narrowest stroke (sharp edge)
const BAND_STEPS       = 6;     // layered strokes per country (was 10; visually
                                // identical at this width range, 40% less work)
const BAND_STEP_ALPHA  = 0.10;  // per-stroke opacity, retuned for 6 steps so the
                                // cumulative band opacity stays ≈ original

// Paint the split-color border art into any context. Pure function of
// (frameState, basemapActive); used both for the offscreen bitmap cache
// and as a fallback if caching is disabled.
function paintBordersInto(ctx, fs) {
  const pr = fs.pixelRatio;
  const features = countriesSource.getFeatures();
  if (basemapActive) {
    // NatGeo-style fading band per country (split colors at shared borders)
    for (const feature of features) {
      const path = buildFeaturePath2D(feature, fs);
      if (!path) continue;
      const s = COUNTRY_STYLE[feature.get('NAME')] || DEFAULT_STYLE;
      const bandColor = hexAlpha(s.fill, BAND_STEP_ALPHA);
      ctx.save();
      ctx.clip(path);
      // Round joins/caps prevent miter spikes at sharp interior vertices —
      // critical because BAND_MAX_WIDTH × 2 strokes can produce 10×-width
      // miter extensions that show up as radial spikes after clipping.
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';
      ctx.strokeStyle = bandColor;
      // Layer strokes from widest (most-transparent fringe) to narrowest
      // (sharp edge at boundary). Same Path2D reused — no re-walking of
      // the geometry array between strokes.
      for (let i = 0; i < BAND_STEPS; i++) {
        const t = i / (BAND_STEPS - 1);          // 0 = widest, 1 = narrowest
        const widthCss = BAND_MAX_WIDTH - (BAND_MAX_WIDTH - BAND_MIN_WIDTH) * t;
        ctx.lineWidth = widthCss * 2 * pr;       // half clipped → widthCss visible
        ctx.stroke(path);
      }
      ctx.restore();
    }
  } else {
    // Plain mode: simple split-color outline
    for (const feature of features) {
      const path = buildFeaturePath2D(feature, fs);
      if (!path) continue;
      const s = COUNTRY_STYLE[feature.get('NAME')] || DEFAULT_STYLE;
      ctx.save();
      ctx.clip(path);
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth   = BORDER_PLAIN * 2 * pr;
      ctx.stroke(path);
      ctx.restore();
    }
  }
}

countriesLayer.on('postrender', (event) => {
  const ctx = event.context;
  const fs  = event.frameState;
  const w   = ctx.canvas.width;
  const h   = ctx.canvas.height;
  const vs  = fs.viewState;

  // Cache key: re-paint only when something we'd visibly draw differently
  // changes. Tile loads and hover restyles fire postrender repeatedly with
  // the same view state — those frames just blit the cached bitmap.
  const key = `${w}|${h}|${vs.resolution}|${vs.center[0]}|${vs.center[1]}|${vs.rotation}|${fs.pixelRatio}|${basemapActive ? 1 : 0}`;

  if (key !== _bordersKey) {
    if (!_bordersCanvas) {
      _bordersCanvas = document.createElement('canvas');
      _bordersCtx = _bordersCanvas.getContext('2d');
    }
    if (_bordersCanvas.width  !== w) _bordersCanvas.width  = w;
    if (_bordersCanvas.height !== h) _bordersCanvas.height = h;
    _bordersCtx.clearRect(0, 0, w, h);
    paintBordersInto(_bordersCtx, fs);
    _bordersKey = key;
  }
  ctx.drawImage(_bordersCanvas, 0, 0);
});

function makeBasemap(opts) {
  const source = new ol.source.XYZ({
    url: opts.url,
    projection: opts.projection,
    tileGrid: opts.tileGrid,        // undefined → OL infers (EPSG:3857 default)
    attributions: opts.attribution,
    crossOrigin: 'anonymous',
  });
  const layer = new ol.layer.Tile({
    visible: false,
    source,
    zIndex: 5,
  });

  // Diagnostic: log tile activity so we can see if requests are happening
  let loaded = 0, errors = 0;
  source.on('tileloadstart', (e) => {
    if (loaded + errors === 0) {
      console.log(`[basemap:${opts.label}] first tile URL:`, e.tile.src_ || e.tile.getImage().src);
    }
  });
  source.on('tileloadend',   () => { loaded++; });
  source.on('tileloaderror', (e) => {
    errors++;
    console.warn(`[basemap:${opts.label}] tile failed:`, e.tile.src_ || e.tile.getImage().src);
  });

  // Clip the tile to country polygons via a cached Path2D mask. The path
  // is rebuilt only when view state changes; tile loads reuse the cache.
  layer.on('prerender', (event) => {
    event.context.save();
    event.context.clip(getCachedClipPath2D(event.frameState));
  });
  layer.on('postrender', (event) => {
    event.context.restore();
  });

  map.addLayer(layer);
  return layer;
}

const basemapLayers = {
  hillshade: makeBasemap({
    label: 'hillshade',
    // Esri World Hillshade — global coverage. NRCan's hillshade only covers
    // Canadian territory, leaving Alaska/Donovia, Greenland, Iceland blank.
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    projection: 'EPSG:3857',  // reprojected on the fly
    attribution: 'Hillshade &copy; Esri, USGS, NOAA',
  }),
  transport: makeBasemap({
    label: 'transport',
    // OpenStreetMap — global street/transit basemap. Replaces NRCan CBMT
    // (Canada-only) so countries outside Canada show roads & place names too.
    url: 'https://{a-c}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    projection: 'EPSG:3857',
    attribution: '&copy; OpenStreetMap contributors',
  }),
  satellite: makeBasemap({
    label: 'satellite',
    // EPSG:3857 source — OL reprojects on the fly into our EPSG:3978 view
    url: 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    projection: 'EPSG:3857',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
  }),
  topo: makeBasemap({
    label: 'topo',
    url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
    projection: 'EPSG:3857',
    attribution: '&copy; OpenTopoMap (CC-BY-SA), &copy; OpenStreetMap',
  }),
};

// Radio handler — only one basemap visible at a time
function applyBasemap(value, { skipSave = false } = {}) {
  const radio = document.querySelector(`input[name="basemap"][value="${value}"]`);
  if (radio) radio.checked = true;
  for (const lyr of Object.values(basemapLayers)) lyr.setVisible(false);
  if (value === 'none') {
    basemapActive = false;
  } else if (basemapLayers[value]) {
    basemapLayers[value].setVisible(true);
    basemapActive = true;
  }
  countriesLayer.changed();
  if (!skipSave) scheduleSaveMapState();
}
document.querySelectorAll('input[name="basemap"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    applyBasemap(e.target.value);
  });
});

// Country-tint toggle + opacity slider — when toggle is on AND a basemap
// is active, country interiors get a color wash over the basemap (hybrid
// political/topo look). Slider drives the wash opacity live; it's disabled
// when the toggle is off so its UI state matches its effective state.
const tintToggleEl = document.getElementById('toggle-country-tint');
const tintSliderEl = document.getElementById('country-tint-slider');
const tintValueEl  = document.getElementById('country-tint-value');
// We dirty the source (not just the layer) because OL caches per-feature
// styled geometry on the vector layer; layer.changed() alone won't force
// re-evaluation of countryStyle() when only its closure values change.
tintToggleEl.addEventListener('change', (e) => {
  countryTintActive = e.target.checked;
  tintSliderEl.disabled = !countryTintActive;
  countriesSource.changed();
  scheduleSaveMapState();
});
tintSliderEl.addEventListener('input', (e) => {
  const pct = Number(e.target.value);
  countryTintAlpha = pct / 100;
  tintValueEl.textContent = String(pct);
  if (countryTintActive) countriesSource.changed();
  scheduleSaveMapState();
});

// =============================================================
// Range rings overlay — toggleable click-to-place
// =============================================================
// Concentric geodesic rings from the click point; preset selects radii.
// Long: 250 / 500 / 750 / 1000 km. Short: 50 / 100 / 150 / 200 / 250 km.
// Vertices use WGS84/NAD83 Vincenty direct (ellipsoid ground distance), then
// project into EPSG:3978. On a Lambert map the rings look slightly oval and
// ruler-measured map distance ≠ label km — that is projection, not error.
const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_B = (1 - WGS84_F) * WGS84_A;

/** Vincenty direct — [lon, lat] degrees at ground distance (m) and bearing (rad). */
function geodesicOffset(centerLL, distanceM, bearingRad) {
  const phi1 = centerLL[1] * Math.PI / 180;
  const lam1 = centerLL[0] * Math.PI / 180;
  const sina = Math.sin(bearingRad);
  const cosa = Math.cos(bearingRad);
  const tanU1 = (1 - WGS84_F) * Math.tan(phi1);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;
  const sig1 = Math.atan2(tanU1, cosa);
  const sina1 = cosU1 * sina;
  const cos2a = 1 - sina1 * sina1;
  const u2 = cos2a * (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_B * WGS84_B);
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  let sig = distanceM / (WGS84_B * A);
  let cos2sigM;
  for (let iter = 0; iter < 100; iter++) {
    cos2sigM = Math.cos(2 * sig1 + sig);
    const sinsig = Math.sin(sig);
    const cossig = Math.cos(sig);
    const dsig = B * sina1 * (cossig * (cos2sigM + B / 4 * (cossig * (-1 + 2 * cos2sigM * cos2sigM)
        - B / 6 * cos2sigM * (-3 + 4 * sinsig * sinsig) * (-3 + 4 * cos2sigM * cos2sigM))));
    const sigp = sig;
    sig = distanceM / (WGS84_B * A) + dsig;
    if (Math.abs(sig - sigp) < 1e-12) break;
  }
  const sinsig = Math.sin(sig);
  const cossig = Math.cos(sig);
  const x = sinU1 * sinsig - cosU1 * cossig * cosa;
  const phi2 = Math.atan2(
    sinU1 * cossig + cosU1 * sinsig * cosa,
    (1 - WGS84_F) * Math.sqrt(sina1 * sina1 + x * x),
  );
  const lam = Math.atan2(sinsig * sina, cosU1 * cossig - sinU1 * sinsig * cosa);
  const C = WGS84_F / 16 * cos2a * (4 + WGS84_F * (4 - 3 * cos2a));
  const dLam = lam - (1 - C) * WGS84_F * sina1
      * (sig + C * sinsig * (cos2sigM + C * cossig * (-1 + 2 * cos2sigM * cos2sigM)));
  return [(lam1 + dLam) * 180 / Math.PI, phi2 * 180 / Math.PI];
}

/** Vincenty inverse — ellipsoid ground distance (m) between [lon,lat] pairs. */
function geodesicDistanceM(c1, c2) {
  const phi1 = c1[1] * Math.PI / 180;
  const phi2 = c2[1] * Math.PI / 180;
  const L = (c2[0] - c1[0]) * Math.PI / 180;
  const tanU1 = (1 - WGS84_F) * Math.tan(phi1);
  const tanU2 = (1 - WGS84_F) * Math.tan(phi2);
  const U1 = Math.atan(tanU1);
  const U2 = Math.atan(tanU2);
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);
  let lam = L;
  let sinLam, cosLam, sinsig, cossig, sig, sina, cos2a, cos2sigM;
  for (let iter = 0; iter < 200; iter++) {
    sinLam = Math.sin(lam);
    cosLam = Math.cos(lam);
    sinsig = Math.sqrt((cosU2 * sinLam) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLam) ** 2);
    if (sinsig === 0) return 0;
    cossig = sinU1 * sinU2 + cosU1 * cosU2 * cosLam;
    sig = Math.atan2(sinsig, cossig);
    sina = cosU1 * cosU2 * sinLam / sinsig;
    cos2a = 1 - sina * sina;
    cos2sigM = cossig - 2 * sinU1 * sinU2 / cos2a;
    if (Number.isNaN(cos2sigM)) cos2sigM = 0;
    const C = WGS84_F / 16 * cos2a * (4 + WGS84_F * (4 - 3 * cos2a));
    const lamp = lam;
    lam = L + (1 - C) * WGS84_F * sina
        * (sig + C * sinsig * (cos2sigM + C * cossig * (-1 + 2 * cos2sigM * cos2sigM)));
    if (Math.abs(lam - lamp) < 1e-12) break;
  }
  const u2 = cos2a * (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_B * WGS84_B);
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dsig = B * sina * (cossig * (cos2sigM + B / 4 * (cossig * (-1 + 2 * cos2sigM * cos2sigM)
      - B / 6 * cos2sigM * (-3 + 4 * sinsig * sinsig) * (-3 + 4 * cos2sigM * cos2sigM))));
  return WGS84_B * A * (sig - dsig);
}

function maxRingGeodesicErrorM(centerLL, ringCoords3978, targetM) {
  let maxErr = 0;
  const n = ringCoords3978.length;
  for (let i = 0; i < n; i += 16) {
    const ll = ol.proj.toLonLat(ringCoords3978[i], 'EPSG:3978');
    const d = geodesicDistanceM(centerLL, ll);
    maxErr = Math.max(maxErr, Math.abs(d - targetM));
  }
  return maxErr;
}

const RANGE_PRESETS = {
  long:  { radiiM: [250_000, 500_000, 750_000, 1_000_000], maxKm: 1000 },
  short: { radiiM: [50_000, 100_000, 150_000, 200_000, 250_000], maxKm: 250 },
};
let rangePreset = 'long';
let rangeLastCenter = null;
const RANGE_RING_STEPS = 256;  // vertices per ring; 256 is visually smooth

function getRangeRadiiM() {
  return RANGE_PRESETS[rangePreset]?.radiiM || RANGE_PRESETS.long.radiiM;
}

function formatRangeLabel(rM) {
  const km = rM / 1000;
  return Number.isInteger(km) ? `${km} km` : `${km.toFixed(1)} km`;
}

function rangePresetHintHtml() {
  const radii = getRangeRadiiM().map(formatRangeLabel).join(' / ');
  const max = RANGE_PRESETS[rangePreset]?.maxKm || 1000;
  return `Drops concentric rings at <b>${radii}</b> from the click point (max <b>${max} km</b>). `
    + 'Distances are <b>ground km</b> (WGS84 geodesic); on this Lambert map rings look '
    + 'slightly oval and map-scale rulers will not match labels exactly. '
    + 'Toggle <b>Range Rings</b> on, click the map to place; click again to relocate. '
    + 'Use <b>Clear</b> to remove them.';
}

const rangeSource = new ol.source.Vector();
const rangeLayer = new ol.layer.Vector({
  source: rangeSource,
  zIndex: 90,  // above weather (40-50), below country labels (100)
  style: (feature) => {
    const t = feature.get('rangeType');
    if (t === 'center') {
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 4,
          fill:   new ol.style.Fill({ color: '#ff3b30' }),
          stroke: new ol.style.Stroke({ color: '#5a0000', width: 1 }),
        }),
      });
    }
    if (t === 'ring') {
      return new ol.style.Style({
        stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.85)', width: 1 }),
        fill:   new ol.style.Fill({ color: 'rgba(255,255,255,0.05)' }),
      });
    }
    if (t === 'label') {
      return new ol.style.Style({
        text: new ol.style.Text({
          text: feature.get('text'),
          font: '600 10px ui-monospace, "SF Mono", Menlo, monospace',
          fill: new ol.style.Fill({ color: '#fff' }),
          stroke: new ol.style.Stroke({ color: '#000', width: 2.5 }),
          textAlign: 'center',
          offsetY: 0,
        }),
      });
    }
    return null;
  },
});
map.addLayer(rangeLayer);

function clearRangeRings() {
  rangeSource.clear();
  rangeLastCenter = null;
}

function placeRangeRings(coord) {
  rangeLastCenter = coord.slice();
  rangeSource.clear();
  // Center dot
  const center = new ol.Feature({ geometry: new ol.geom.Point(coord) });
  center.set('rangeType', 'center');
  rangeSource.addFeature(center);

  const centerLL = ol.proj.toLonLat(coord, 'EPSG:3978');

  for (const r of getRangeRadiiM()) {
    const ringCoords = new Array(RANGE_RING_STEPS + 1);
    for (let i = 0; i <= RANGE_RING_STEPS; i++) {
      const bearing = (i / RANGE_RING_STEPS) * 2 * Math.PI;
      const destLL  = geodesicOffset(centerLL, r, bearing);
      ringCoords[i] = ol.proj.fromLonLat(destLL, 'EPSG:3978');
    }
    const maxErr = maxRingGeodesicErrorM(centerLL, ringCoords, r);
    if (maxErr > 5) {
      console.warn(`[range] ${formatRangeLabel(r)} ring geodesic sample error: ${maxErr.toFixed(1)} m`);
    }
    const ring = new ol.Feature({
      geometry: new ol.geom.Polygon([ringCoords]),
    });
    ring.set('rangeType', 'ring');
    ring.set('geodesicErrorM', maxErr);
    rangeSource.addFeature(ring);

    const labelLL = geodesicOffset(centerLL, r, Math.PI / 4);
    const labelCoord = ol.proj.fromLonLat(labelLL, 'EPSG:3978');
    const label = new ol.Feature({
      geometry: new ol.geom.Point(labelCoord),
    });
    label.set('rangeType', 'label');
    label.set('text', formatRangeLabel(r));
    rangeSource.addFeature(label);
  }
  // Reveal the Clear affordance now that rings exist. The help blurb is now
  // a separate (i)-button toggle, so placing rings no longer hides it.
  rangeClear.hidden = false;
  scheduleSaveMapState();
}

// Bottom-left tool widget. Range Rings toggle drives the click-to-place
// mode; Clear shows once rings exist; (i) info button toggles a persistent
// help blurb independently of the tool's active state — the user can read
// the instructions before, during, or after using the tool.
const rangeBtn   = document.getElementById('range-tool-btn');
const rangeClear = document.getElementById('range-tool-clear');
const rangeHint  = document.getElementById('range-tool-hint');
const rangeHintText = document.getElementById('range-tool-hint-text');
const rangeInfo  = document.getElementById('range-tool-info');

function setRangePreset(value, { skipSave = false } = {}) {
  if (!RANGE_PRESETS[value]) return;
  rangePreset = value;
  const radio = document.querySelector(`input[name="range-preset"][value="${value}"]`);
  if (radio) radio.checked = true;
  if (rangeHintText) rangeHintText.innerHTML = rangePresetHintHtml();
  if (rangeLastCenter) placeRangeRings(rangeLastCenter);
  if (!skipSave) scheduleSaveMapState();
}

function setRangeToolActive(active, { skipSave = false } = {}) {
  rangeToolActive = active;
  rangeBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  // Crosshair cursor signals the click-to-place mode is live.
  map.getTargetElement().style.cursor = active ? 'crosshair' : '';
  if (!active) {
    clearRangeRings();
    rangeClear.hidden = true;
  }
  if (!skipSave) scheduleSaveMapState();
}

rangeBtn.addEventListener('click', () => setRangeToolActive(!rangeToolActive));
rangeClear.addEventListener('click', () => {
  clearRangeRings();
  rangeClear.hidden = true;
  scheduleSaveMapState();
});
rangeInfo.addEventListener('click', () => {
  const showing = !rangeHint.hasAttribute('hidden');
  if (showing) rangeHint.setAttribute('hidden', '');
  else rangeHint.removeAttribute('hidden');
  rangeInfo.setAttribute('aria-pressed', showing ? 'false' : 'true');
});
document.querySelectorAll('input[name="range-preset"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    setRangePreset(e.target.value);
  });
});
if (rangeHintText) rangeHintText.innerHTML = rangePresetHintHtml();

// =============================================================
// POI overlays — airports, hospitals, Walmart stores
// =============================================================
// Three GeoJSON datasets (pre-clipped to scenario land — see
// scripts/build_overlays.py) feed ONE combined cluster layer. Points are
// tagged with `_poiKind` on load and added to a shared combined source;
// the cluster source wraps that combined source and filters via its
// geometryFunction to only include kinds the user has enabled.
//
// Why combined (not per-kind) clustering: a hospital and a Walmart on
// the same block should fuse into a single "2" bubble, not stack two
// per-kind bubbles on top of each other. The reference screenshot uses
// the same convention — count is across all visible overlays.

// Per-kind single-feature style (used when a cluster wraps exactly one
// point) — colored disc + glyph. Built once each, reused for every render.
const POI_DISC_RADIUS = 7;
const POI_EMPHASIS_RING_RADIUS = 11;

function poiStyle({ fill, stroke, glyph, glyphFill }) {
  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: POI_DISC_RADIUS,
      fill:   new ol.style.Fill({ color: fill }),
      stroke: new ol.style.Stroke({ color: stroke, width: 1.2 }),
    }),
    text: new ol.style.Text({
      text: glyph,
      font: '700 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fill: new ol.style.Fill({ color: glyphFill }),
      textAlign: 'center',
      textBaseline: 'middle',
      offsetY: 0.5,  // pixel-perfect centering of the glyph in the disc
    }),
  });
}

function poiEmphasisRing(strokeColor) {
  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: POI_EMPHASIS_RING_RADIUS,
      fill: new ol.style.Fill({ color: 'rgba(255,255,255,0)' }),
      stroke: new ol.style.Stroke({ color: strokeColor, width: 2 }),
    }),
  });
}

const POI_KINDS = [
  // All eight kinds tier on `tier` → see *_TIER_STYLES + resolvePoiStyle.
  // First three are the original tactical-planning layers; remaining
  // five (military / corrections / schools / food / ltc) were added for
  // BoldQuest 26 pathogen-spread TTX modelling.
  { kind: 'airport',     url: 'data/airports.geojson',    panelId: 'airports' },
  { kind: 'hospital',    url: 'data/hospitals.geojson',   panelId: 'hospitals' },
  { kind: 'walmart',     url: 'data/walmarts.geojson',    panelId: 'walmarts' },
  { kind: 'military',    url: 'data/military.geojson',    panelId: 'military' },
  { kind: 'corrections', url: 'data/corrections.geojson', panelId: 'corrections' },
  { kind: 'school',      url: 'data/schools.geojson',     panelId: 'schools' },
  { kind: 'food',        url: 'data/food.geojson',        panelId: 'food' },
  { kind: 'ltc',         url: 'data/ltc.geojson',         panelId: 'ltc' },
];

// Hospital tiering — the `tier` property on each hospital feature
// (computed in scripts/build_overlays.py from HIFLD TYPE/TRAUMA/BEDS,
// ODHF facility-name keywords, or OSM amenity/emergency tags) drives the
// fill color. Same white "H" glyph in all three for instant kind recognition;
// red→orange→peach communicates the capability gradient at a glance.
const HOSPITAL_TIER_COLORS = {
  major:    { fill: '#B11226', stroke: '#4a0000', label: 'Major'    },
  standard: { fill: '#E07B00', stroke: '#5a3000', label: 'Standard' },
  limited:  { fill: '#E8A87C', stroke: '#7a3f1c', label: 'Limited'  },
};
const HOSPITAL_TIER_STYLES = Object.fromEntries(
  Object.entries(HOSPITAL_TIER_COLORS).map(([t, c]) =>
    [t, poiStyle({ fill: c.fill, stroke: c.stroke, glyph: 'H', glyphFill: '#fff' })])
);

function isMajorHospitalFeature(feature) {
  return feature.get('_poiKind') === 'hospital' && feature.get('tier') === 'major';
}
function hospitalFeatureVisible(feature) {
  if (feature.get('_poiKind') !== 'hospital') return true;
  return isMajorHospitalFeature(feature)
    ? poiEnabled.hospitalMajor
    : poiEnabled.hospitalOther;
}

// Airport tiering — the `tier` property on each airport feature
// (computed in scripts/build_overlays.py from the longest runway length and
// surface, with USAF cargo-aircraft minima as anchors) drives the fill color.
// Same white ✈ glyph in all three. Dark→cyan→sky gradient = heavy→light.
const AIRPORT_TIER_COLORS = {
  major:    { fill: '#023E8A', stroke: '#001A4A', label: 'Heavy (C-5)'  },
  standard: { fill: '#0077B6', stroke: '#002B4A', label: 'Medium (C-17)' },
  limited:  { fill: '#00B4D8', stroke: '#003049', label: 'Light (C-130)' },
};
const AIRPORT_TIER_STYLES = Object.fromEntries(
  Object.entries(AIRPORT_TIER_COLORS).map(([t, c]) =>
    [t, poiStyle({ fill: c.fill, stroke: c.stroke, glyph: '✈', glyphFill: '#fff' })])
);

// Walmart tiering — store format by physical footprint (computed in
// scripts/build_overlays.py from OSM `shop`/`amenity`/`name` tags).
// Walmart brand palette is yellow + blue, so we keep the glyph (W) blue
// on yellow for the Supercenter (the recognisable storefront look) and
// shift the smaller formats to navy/cyan with white W's so the size
// gradient reads at a glance.
//   major    — Supercenter        : Walmart-yellow #FFC220, blue W
//   standard — Discount Store     : Walmart-blue   #0071CE, white W
//   limited  — Neighborhood Market: light azure    #5DA9E9, white W
const WALMART_TIER_COLORS = {
  major:    { fill: '#FFC220', stroke: '#0071CE', glyphFill: '#0071CE',
              label: 'Supercenter' },
  standard: { fill: '#0071CE', stroke: '#003F7A', glyphFill: '#FFC220',
              label: 'Discount Store' },
  limited:  { fill: '#5DA9E9', stroke: '#003F7A', glyphFill: '#fff',
              label: 'Neighborhood Market' },
};
const WALMART_TIER_STYLES = Object.fromEntries(
  Object.entries(WALMART_TIER_COLORS).map(([t, c]) =>
    [t, poiStyle({ fill: c.fill, stroke: c.stroke, glyph: 'W', glyphFill: c.glyphFill })])
);

// Major installations vs other military sites — map toggles filter on OSM
// `kind`, not just tier color. Offices/recruiting stations are excluded from
// the major toggle even when mis-tagged in older GeoJSON builds.
const MIL_MAJOR_KINDS = new Set([
  'base', 'naval_base', 'airfield', 'garrison', 'naval', 'navy',
]);
function isMajorMilitaryProps(props) {
  return MIL_MAJOR_KINDS.has((props.kind || '').toLowerCase());
}
function isMajorMilitaryFeature(feature) {
  return feature.get('_poiKind') === 'military' && isMajorMilitaryProps(feature.getProperties());
}
function militaryFeatureVisible(feature) {
  if (feature.get('_poiKind') !== 'military') return true;
  return (isMajorMilitaryFeature(feature) && poiEnabled.militaryMajor)
      || (!isMajorMilitaryFeature(feature) && poiEnabled.militaryOther);
}
const MILITARY_TIER_COLORS = {
  major:    { fill: '#3F4D2F', stroke: '#1F2818', label: 'Base'             },
  standard: { fill: '#7A8450', stroke: '#3A4220', label: 'Guard / Reserve'  },
  limited:  { fill: '#B5C18E', stroke: '#5A6A38', label: 'Range / Training' },
};
const MILITARY_TIER_STYLES = Object.fromEntries(
  Object.entries(MILITARY_TIER_COLORS).map(([t, c]) =>
    [t, poiStyle({ fill: c.fill, stroke: c.stroke, glyph: '★', glyphFill: '#fff' })])
);

// Correctional facilities — slate gradient. Major = federal/max,
// Standard = state/medium, Limited = local/juvenile. P glyph for prison.
const CORRECTIONS_TIER_COLORS = {
  major:    { fill: '#2F3E46', stroke: '#0E1B22', label: 'Federal / Maximum' },
  standard: { fill: '#52796F', stroke: '#234038', label: 'State / Medium'    },
  limited:  { fill: '#84A98C', stroke: '#3F6049', label: 'Local / Juvenile'  },
};
const CORRECTIONS_TIER_STYLES = Object.fromEntries(
  Object.entries(CORRECTIONS_TIER_COLORS).map(([t, c]) =>
    [t, poiStyle({ fill: c.fill, stroke: c.stroke, glyph: 'P', glyphFill: '#fff' })])
);

// Schools — purple gradient. Tier driven by HIFLD ENROLLMENT field where
// available (Major = college/uni, Standard = K-12 ≥500, Limited = K-12
// 100-499; below 100 dropped at fetch time). S glyph in white.
const SCHOOL_TIER_COLORS = {
  major:    { fill: '#5E2A84', stroke: '#2A0E40', label: 'College / University' },
  standard: { fill: '#8E6CB0', stroke: '#3F2A60', label: 'K-12 (≥ 500)'        },
  limited:  { fill: '#C4A7E0', stroke: '#5F3F88', label: 'K-12 (100–499)'      },
};
const SCHOOL_TIER_STYLES = Object.fromEntries(
  Object.entries(SCHOOL_TIER_COLORS).map(([t, c]) =>
    [t, poiStyle({ fill: c.fill, stroke: c.stroke, glyph: 'S', glyphFill: '#fff' })])
);

// Food production — brown gradient. Activity-driven: slaughter floors
// (Major) drove the strongest documented food-industry COVID outbreaks,
// processing (Standard), egg/other (Limited). F glyph.
const FOOD_TIER_COLORS = {
  major:    { fill: '#5C3317', stroke: '#2A1408', label: 'Slaughter'    },
  standard: { fill: '#8B5A2B', stroke: '#3F2814', label: 'Processing'   },
  limited:  { fill: '#C68E5E', stroke: '#5F3F22', label: 'Egg / Other'  },
};
const FOOD_TIER_STYLES = Object.fromEntries(
  Object.entries(FOOD_TIER_COLORS).map(([t, c]) =>
    [t, poiStyle({ fill: c.fill, stroke: c.stroke, glyph: 'F', glyphFill: '#fff' })])
);

// Long-term care — rose gradient. Clinical-acuity tier — Major = skilled
// nursing (highest CFR in COVID-era LTC outbreaks), Standard = assisted
// living, Limited = hospice/adult day. L glyph.
const LTC_TIER_COLORS = {
  major:    { fill: '#9D2A4E', stroke: '#4A0F23', label: 'Skilled Nursing' },
  standard: { fill: '#C76B89', stroke: '#5F2A3A', label: 'Assisted Living' },
  limited:  { fill: '#E8B6C1', stroke: '#7F4F5E', label: 'Hospice / Day'   },
};
const LTC_TIER_STYLES = Object.fromEntries(
  Object.entries(LTC_TIER_COLORS).map(([t, c]) =>
    [t, poiStyle({ fill: c.fill, stroke: c.stroke, glyph: 'L', glyphFill: '#fff' })])
);

// poiEnabled drives the cluster source's geometryFunction. Toggles flip
// these flags and call clusterSource.refresh() to re-cluster from scratch.
const poiEnabled = {
  airport: false,
  hospitalMajor: false, hospitalOther: false,
  walmart: false,
  militaryMajor: false, militaryOther: false,
  corrections: false, school: false, food: false, ltc: false,
};

function poiNeedsEmphasisRing(feature) {
  return isMajorHospitalFeature(feature) || isMajorMilitaryFeature(feature);
}

// One-stop style resolver for single POI features (called when a cluster
// wraps exactly one point). All eight kinds dispatch on `tier`.
function resolvePoiStyle(feature) {
  const kind = feature.get('_poiKind');
  const tier = feature.get('tier');
  let base = null;
  let ringStroke = null;
  if (kind === 'airport') {
    base = AIRPORT_TIER_STYLES[tier] || AIRPORT_TIER_STYLES.limited;
    ringStroke = (AIRPORT_TIER_COLORS[tier] || AIRPORT_TIER_COLORS.limited).stroke;
  } else if (kind === 'hospital') {
    base = HOSPITAL_TIER_STYLES[tier] || HOSPITAL_TIER_STYLES.standard;
    ringStroke = (HOSPITAL_TIER_COLORS[tier] || HOSPITAL_TIER_COLORS.standard).stroke;
  } else if (kind === 'walmart') {
    base = WALMART_TIER_STYLES[tier] || WALMART_TIER_STYLES.standard;
    ringStroke = (WALMART_TIER_COLORS[tier] || WALMART_TIER_COLORS.standard).stroke;
  } else if (kind === 'military') {
    base = MILITARY_TIER_STYLES[tier] || MILITARY_TIER_STYLES.major;
    ringStroke = (MILITARY_TIER_COLORS[tier] || MILITARY_TIER_COLORS.major).stroke;
  } else if (kind === 'corrections') {
    base = CORRECTIONS_TIER_STYLES[tier] || CORRECTIONS_TIER_STYLES.standard;
    ringStroke = (CORRECTIONS_TIER_COLORS[tier] || CORRECTIONS_TIER_COLORS.standard).stroke;
  } else if (kind === 'school') {
    base = SCHOOL_TIER_STYLES[tier] || SCHOOL_TIER_STYLES.standard;
    ringStroke = (SCHOOL_TIER_COLORS[tier] || SCHOOL_TIER_COLORS.standard).stroke;
  } else if (kind === 'food') {
    base = FOOD_TIER_STYLES[tier] || FOOD_TIER_STYLES.standard;
    ringStroke = (FOOD_TIER_COLORS[tier] || FOOD_TIER_COLORS.standard).stroke;
  } else if (kind === 'ltc') {
    base = LTC_TIER_STYLES[tier] || LTC_TIER_STYLES.standard;
    ringStroke = (LTC_TIER_COLORS[tier] || LTC_TIER_COLORS.standard).stroke;
  }
  if (!base) return null;
  if (poiNeedsEmphasisRing(feature)) {
    return [poiEmphasisRing(ringStroke), base];
  }
  return base;
}

// ----- Generic count-bubble style -----
// Three color tiers matched to the three size tiers — small clusters are
// cool (blue), medium amber, large hot red. Breakpoints at 10 and 100 align
// with the radius/font-size tiers below so a bubble's color and size both
// step at the same count thresholds. Halo is a low-alpha rim in the same hue.
const CLUSTER_TIERS = [
  // { max: exclusive upper bound, fill, halo }
  { max: 10,       fill: '#1f4e8c', halo: 'rgba(31,78,140,0.30)'  }, // small  (blue)
  { max: 100,      fill: '#E89216', halo: 'rgba(232,146,22,0.32)' }, // medium (amber)
  { max: Infinity, fill: '#D7263D', halo: 'rgba(215,38,61,0.32)'  }, // large  (red)
];

const _clusterStyleCache = new Map();   // count -> Style[]
function clusterBubbleStyle(count) {
  const cached = _clusterStyleCache.get(count);
  if (cached) return cached;
  const tier = CLUSTER_TIERS.find(t => count < t.max);
  const fill = tier.fill, halo = tier.halo;
  const r     = count < 10 ? 12 : count < 100 ? 15 : 19;
  const fSize = count < 10 ? 11 : count < 100 ? 12 : 13;
  const styles = [
    new ol.style.Style({
      image: new ol.style.Circle({
        radius: r + 7,
        fill: new ol.style.Fill({ color: halo }),
      }),
    }),
    new ol.style.Style({
      image: new ol.style.Circle({
        radius: r,
        fill: new ol.style.Fill({ color: fill }),
        stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 }),
      }),
      text: new ol.style.Text({
        text: String(count),
        font: `700 ${fSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`,
        fill: new ol.style.Fill({ color: '#fff' }),
        textAlign: 'center',
        textBaseline: 'middle',
      }),
    }),
  ];
  _clusterStyleCache.set(count, styles);
  return styles;
}

// Helper: true if a hit feature came from the cluster source AND wraps >1.
function isCluster(feature) {
  const inner = feature.get('features');
  return Array.isArray(inner) && inner.length > 1;
}
// Helper: return the underlying POI feature from a cluster wrapper of size 1,
// or the feature itself if it's already an unwrapped POI.
function unwrapPoi(feature) {
  const inner = feature.get('features');
  return inner && inner.length ? inner[0] : feature;
}

// Combined source — all features from all kinds, each tagged with _poiKind.
// Populated by direct fetch() of each GeoJSON file. We don't use the usual
// `new ol.source.Vector({ url, format })` form here because that source
// only triggers its loader when attached to a rendering layer — and the
// raw sources aren't (only the cluster layer renders). Skipping the OL
// loader machinery and parsing GeoJSON manually keeps the data path
// straightforward and makes the load order easy to reason about.
const poiCombinedSource = new ol.source.Vector();
const _poiGeoJsonFormat = new ol.format.GeoJSON({
  dataProjection:    'EPSG:4326',
  featureProjection: 'EPSG:3978',
});
for (const cfg of POI_KINDS) {
  fetch(cfg.url)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(gj => {
      // Yield before parsing large GeoJSON so refresh can paint the map first.
      requestAnimationFrame(() => {
      const feats = _poiGeoJsonFormat.readFeatures(gj);
      for (const f of feats) f.set('_poiKind', cfg.kind);
      poiCombinedSource.addFeatures(feats);
      if (cfg.kind === 'military') {
        const majorN = feats.filter((f) => isMajorMilitaryFeature(f)).length;
        const otherN = feats.length - majorN;
        const majorEl = document.getElementById('military-major-count');
        const otherEl = document.getElementById('military-other-count');
        if (majorEl) majorEl.textContent = `(${majorN.toLocaleString()})`;
        if (otherEl) otherEl.textContent = `(${otherN.toLocaleString()})`;
      } else if (cfg.kind === 'hospital') {
        const majorN = feats.filter((f) => isMajorHospitalFeature(f)).length;
        const otherN = feats.length - majorN;
        const majorEl = document.getElementById('hospital-major-count');
        const otherEl = document.getElementById('hospital-other-count');
        if (majorEl) majorEl.textContent = `(${majorN.toLocaleString()})`;
        if (otherEl) otherEl.textContent = `(${otherN.toLocaleString()})`;
      } else {
        const countEl = document.getElementById(cfg.panelId + '-count');
        if (countEl) countEl.textContent = `(${feats.length.toLocaleString()})`;
      }
      // If the user flipped this kind's toggle on before its data finished
      // loading, kick the cluster source so it picks the new features up.
      const kindActive = cfg.kind === 'military'
        ? (poiEnabled.militaryMajor || poiEnabled.militaryOther)
        : cfg.kind === 'hospital'
          ? (poiEnabled.hospitalMajor || poiEnabled.hospitalOther)
          : poiEnabled[cfg.kind];
      if (kindActive) schedulePoiClusterRefresh();
      });
    })
    .catch((err) => {
      console.warn(`[poi:${cfg.kind}] load failed:`, err);
      const countEl = document.getElementById(cfg.panelId + '-count');
      if (countEl) countEl.textContent = '(load failed)';
    });
}

// Cluster source — wraps the combined source, but its geometryFunction
// filters out any feature whose kind is currently disabled. Toggling a
// kind off → those features return null geometry → cluster ignores them.
// 40 px between cluster centers (default 20 is too tight at low zoom);
// 20 px minimum gap keeps neighbouring bubbles from fusing visually.
const poiClusterSource = new ol.source.Cluster({
  source: poiCombinedSource,
  distance: 40,
  minDistance: 20,
  geometryFunction: (feature) => {
    const kind = feature.get('_poiKind');
    if (kind === 'military') {
      if (!militaryFeatureVisible(feature)) return null;
    } else if (kind === 'hospital') {
      if (!hospitalFeatureVisible(feature)) return null;
    } else if (!poiEnabled[kind]) {
      return null;
    }
    return feature.getGeometry();
  },
});

// Single cluster layer. Singletons render with their per-kind glyph style;
// any cluster of 2+ renders as a generic count bubble (blue or red).
// Layer-level visibility tracks "any kind enabled?" so OL skips rendering
// entirely when the user has every overlay turned off.
const poiClusterLayer = new ol.layer.Vector({
  source: poiClusterSource,
  visible: false,
  zIndex: 82,
  style: (feature) => {
    const inner = feature.get('features');
    if (!inner || inner.length === 1) {
      return resolvePoiStyle(inner ? inner[0] : feature);
    }
    return clusterBubbleStyle(inner.length);
  },
});
map.addLayer(poiClusterLayer);

// Toggle handlers — flip the enabled flag, sync layer visibility to the
// "any enabled?" predicate, and force the cluster source to recompute
// (refresh() re-runs the geometryFunction over every feature).
function anyPoiEnabled() {
  return poiEnabled.airport
      || poiEnabled.hospitalMajor || poiEnabled.hospitalOther
      || poiEnabled.walmart
      || poiEnabled.militaryMajor || poiEnabled.militaryOther
      || poiEnabled.corrections || poiEnabled.school
      || poiEnabled.food || poiEnabled.ltc;
}

let _poiClusterRefreshQueued = false;
function schedulePoiClusterRefresh() {
  if (_poiClusterRefreshQueued) return;
  _poiClusterRefreshQueued = true;
  requestAnimationFrame(() => {
    _poiClusterRefreshQueued = false;
    if (anyPoiEnabled()) poiClusterSource.refresh();
  });
}

function setPoiToggle(key, panelId, checked, { skipSave = false, skipRefresh = false } = {}) {
  poiEnabled[key] = checked;
  const el = document.getElementById('toggle-' + panelId);
  if (el) el.checked = checked;
  poiClusterLayer.setVisible(anyPoiEnabled());
  if (!skipRefresh) schedulePoiClusterRefresh();
  if (!skipSave) scheduleSaveMapState();
}

const POI_TOGGLE_SPECS = [
  { key: 'airport',     panelId: 'airports' },
  { key: 'walmart',     panelId: 'walmarts' },
  { key: 'corrections', panelId: 'corrections' },
  { key: 'school',      panelId: 'schools' },
  { key: 'food',        panelId: 'food' },
  { key: 'ltc',         panelId: 'ltc' },
];
for (const cfg of POI_TOGGLE_SPECS) {
  document.getElementById('toggle-' + cfg.panelId).addEventListener('change', (e) => {
    setPoiToggle(cfg.key, cfg.panelId, e.target.checked);
  });
}
document.getElementById('toggle-hospital-major').addEventListener('change', (e) => {
  setPoiToggle('hospitalMajor', 'hospital-major', e.target.checked);
});
document.getElementById('toggle-hospital-other').addEventListener('change', (e) => {
  setPoiToggle('hospitalOther', 'hospital-other', e.target.checked);
});
document.getElementById('toggle-military-major').addEventListener('change', (e) => {
  setPoiToggle('militaryMajor', 'military-major', e.target.checked);
});
document.getElementById('toggle-military-other').addEventListener('change', (e) => {
  setPoiToggle('militaryOther', 'military-other', e.target.checked);
});

// Extend the existing click handler so a click on a POI shows its popup.
// We register a NEW click listener (the country handler in §click popup
// already returned without opening on null features, so it does no harm —
// but if a POI sits on top of a country, we want the POI to win).
function renderPoiPopup(feature) {
  const p = feature.getProperties();
  const kind = p._poiKind;
  let title, badge, rows = '';
  if (kind === 'airport') {
    title = p.name || 'Airport';
    const tier = AIRPORT_TIER_COLORS[p.tier] || AIRPORT_TIER_COLORS.limited;
    badge = `AIRPORT · ${tier.label.toUpperCase()}`;
    // Runway: prefer paved, fall back to hard-surface ("3,500 ft hard" reads
    // differently to a planner than "3,500 ft paved", so be explicit).
    const rwLabel = p.longest_paved_ft && p.longest_paved_ft > 0
        ? `${p.longest_paved_ft.toLocaleString()} ft paved`
        : (p.longest_hard_ft && p.longest_hard_ft > 0
            ? `${p.longest_hard_ft.toLocaleString()} ft hard`
            : (p.longest_ft && p.longest_ft > 0 ? `${p.longest_ft.toLocaleString()} ft` : ''));
    rows = `
      ${p.iata ? `<span class="k">IATA</span><span class="v">${p.iata}</span>` : ''}
      ${p.icao ? `<span class="k">ICAO</span><span class="v">${p.icao}</span>` : ''}
      ${rwLabel ? `<span class="k">Runway</span><span class="v">${rwLabel}</span>` : ''}
      ${p.municipality ? `<span class="k">City</span><span class="v">${p.municipality}</span>` : ''}
      ${p.iso_region ? `<span class="k">Region</span><span class="v">${p.iso_region}</span>` : ''}`;
  } else if (kind === 'hospital') {
    title = p.name || 'Hospital';
    const tier = HOSPITAL_TIER_COLORS[p.tier] || HOSPITAL_TIER_COLORS.standard;
    badge = `HOSPITAL · ${tier.label.toUpperCase()}`;
    const loc = [p.city, p.region].filter(Boolean).join(', ');
    rows = `
      ${loc ? `<span class="k">Location</span><span class="v">${loc}</span>` : ''}
      ${p.beds ? `<span class="k">Beds</span><span class="v">${p.beds}</span>` : ''}
      ${p.trauma ? `<span class="k">Trauma</span><span class="v">${p.trauma}</span>` : ''}
      ${p.helipad === 'Y' ? `<span class="k">Helipad</span><span class="v">Yes</span>` : ''}
      ${p.source ? `<span class="k">Source</span><span class="v">${p.source}</span>` : ''}`;
  } else if (kind === 'walmart') {
    title = p.name || 'Walmart';
    const tier = WALMART_TIER_COLORS[p.tier] || WALMART_TIER_COLORS.standard;
    badge = `WALMART · ${tier.label.toUpperCase()}`;
    const loc = [p.city, p.region].filter(Boolean).join(', ');
    rows = `
      ${p.addr ? `<span class="k">Address</span><span class="v">${p.addr}</span>` : ''}
      ${loc ? `<span class="k">Location</span><span class="v">${loc}</span>` : ''}
      ${p.osm_id ? `<span class="k">OSM</span><span class="v">${p.osm_id}</span>` : ''}`;
  } else if (kind === 'military') {
    title = p.name || 'Military installation';
    const tier = MILITARY_TIER_COLORS[p.tier] || MILITARY_TIER_COLORS.major;
    badge = `MILITARY · ${tier.label.toUpperCase()}`;
    rows = `
      ${p.operator ? `<span class="k">Operator</span><span class="v">${p.operator}</span>` : ''}
      ${p.source ? `<span class="k">Source</span><span class="v">${p.source}</span>` : ''}`;
  } else if (kind === 'corrections') {
    title = p.name || 'Correctional facility';
    const tier = CORRECTIONS_TIER_COLORS[p.tier] || CORRECTIONS_TIER_COLORS.standard;
    badge = `CORRECTIONS · ${tier.label.toUpperCase()}`;
    const loc = [p.city, p.region].filter(Boolean).join(', ');
    rows = `
      ${loc ? `<span class="k">Location</span><span class="v">${loc}</span>` : ''}
      ${p.type ? `<span class="k">Type</span><span class="v">${p.type}</span>` : ''}
      ${p.security ? `<span class="k">Security</span><span class="v">${p.security}</span>` : ''}
      ${p.population ? `<span class="k">Population</span><span class="v">${p.population.toLocaleString()}</span>` : ''}
      ${p.capacity ? `<span class="k">Capacity</span><span class="v">${p.capacity.toLocaleString()}</span>` : ''}
      ${p.source ? `<span class="k">Source</span><span class="v">${p.source}</span>` : ''}`;
  } else if (kind === 'school') {
    title = p.name || 'School';
    const tier = SCHOOL_TIER_COLORS[p.tier] || SCHOOL_TIER_COLORS.standard;
    badge = `SCHOOL · ${tier.label.toUpperCase()}`;
    const loc = [p.city, p.region].filter(Boolean).join(', ');
    rows = `
      ${loc ? `<span class="k">Location</span><span class="v">${loc}</span>` : ''}
      ${p.kind ? `<span class="k">Kind</span><span class="v">${p.kind}</span>` : ''}
      ${p.grades ? `<span class="k">Grades</span><span class="v">${p.grades}</span>` : ''}
      ${p.enrollment ? `<span class="k">Enrollment</span><span class="v">${p.enrollment.toLocaleString()}</span>` : ''}
      ${p.housing && p.housing.toString().toUpperCase().startsWith('Y') ? `<span class="k">Housing</span><span class="v">Yes${p.dorm_cap ? ` (${p.dorm_cap.toLocaleString()} dorm)` : ''}</span>` : ''}
      ${p.source ? `<span class="k">Source</span><span class="v">${p.source}</span>` : ''}`;
  } else if (kind === 'food') {
    title = p.name || 'Food production';
    const tier = FOOD_TIER_COLORS[p.tier] || FOOD_TIER_COLORS.standard;
    badge = `FOOD PROD · ${tier.label.toUpperCase()}`;
    const loc = [p.city, p.region].filter(Boolean).join(', ');
    rows = `
      ${p.address ? `<span class="k">Address</span><span class="v">${p.address}</span>` : ''}
      ${loc ? `<span class="k">Location</span><span class="v">${loc}</span>` : ''}
      ${p.est_id ? `<span class="k">Est ID</span><span class="v">${p.est_id}</span>` : ''}
      ${p.activities ? `<span class="k">Activities</span><span class="v">${p.activities}</span>` : ''}
      ${p.source ? `<span class="k">Source</span><span class="v">${p.source}</span>` : ''}`;
  } else if (kind === 'ltc') {
    title = p.name || 'Long-term care facility';
    const tier = LTC_TIER_COLORS[p.tier] || LTC_TIER_COLORS.standard;
    badge = `LTC · ${tier.label.toUpperCase()}`;
    const loc = [p.city, p.region].filter(Boolean).join(', ');
    rows = `
      ${loc ? `<span class="k">Location</span><span class="v">${loc}</span>` : ''}
      ${p.facility ? `<span class="k">Type</span><span class="v">${p.facility}</span>` : ''}
      ${p.population ? `<span class="k">Population</span><span class="v">${p.population.toLocaleString()}</span>` : ''}
      ${p.source ? `<span class="k">Source</span><span class="v">${p.source}</span>` : ''}`;
  } else {
    return null;
  }
  const geom = feature.getGeometry();
  const coord = geom ? geom.getCoordinates() : null;
  const geoRows = coord ? popupGeoRowsFromCoord(coord) : '';
  const scenarioName = coord ? scenarioCountryAtCoord(coord) : null;
  const scenarioRow = popupScenarioCountryRow(scenarioName);
  return `
    <h3>${title}</h3>
    <div class="kv">
      <span class="k">Type</span><span class="v"><span class="badge">${badge}</span></span>
      ${geoRows}
      ${scenarioRow}
      ${rows}
    </div>`;
}

map.on('click', (evt) => {
  if (rangeToolActive) return;  // range tool already handled by earlier listener
  if (!poiClusterLayer.getVisible()) return;
  const hit = map.forEachFeatureAtPixel(evt.pixel,
    (fr, layer) => layer === poiClusterLayer ? fr : null,
    { hitTolerance: 4 },
  );
  if (!hit) return;

  // Cluster bubble: zoom to fit its members. If all members share one point
  // (extent has zero area), bump the zoom manually since view.fit() of a
  // degenerate extent is a no-op.
  if (isCluster(hit)) {
    const inner = hit.get('features');
    const ext = ol.extent.createEmpty();
    for (const f of inner) ol.extent.extend(ext, f.getGeometry().getExtent());
    const view = map.getView();
    const w = ext[2] - ext[0], h = ext[3] - ext[1];
    if (w === 0 && h === 0) {
      view.animate({
        center: hit.getGeometry().getCoordinates(),
        zoom: Math.min((view.getZoom() || 0) + 2, view.getMaxZoom()),
        duration: 300,
      });
    } else {
      view.fit(ext, { padding: [60, 60, 60, 60], duration: 300, maxZoom: 12 });
    }
    popupEl.style.display = 'none';
    return;
  }

  // Singleton — unwrap to the underlying POI feature for the popup.
  const poi = unwrapPoi(hit);
  const html = renderPoiPopup(poi);
  if (!html) return;
  popupBody.innerHTML = html;
  popupEl.style.display = '';
  // Position the popup at the feature's actual point geometry, not the
  // click pixel — keeps the popup anchored if the user pans afterward.
  popupOverlay.setPosition(poi.getGeometry().getCoordinates());
});

// Extend hover: pointer cursor over POI markers and cluster bubbles.
map.on('pointermove', (evt) => {
  if (evt.dragging || rangeToolActive) return;
  if (!poiClusterLayer.getVisible()) return;
  const f = map.forEachFeatureAtPixel(evt.pixel,
    (fr, layer) => layer === poiClusterLayer ? fr : null,
    { hitTolerance: 4 },
  );
  if (f) map.getTargetElement().style.cursor = 'pointer';
});

// ----- POI dropdown (mirrors the existing layers dropdown behavior) -----
const poiControl = document.getElementById('poi-control');
const poiToggle  = document.getElementById('poi-toggle');
const poiPanel   = document.getElementById('poi-panel');
function setPoiOpen(open) {
  poiControl.classList.toggle('open', open);
  poiToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) poiPanel.removeAttribute('hidden');
  else poiPanel.setAttribute('hidden', '');
}
poiToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  setPoiOpen(!poiControl.classList.contains('open'));
  // Auto-close the sibling dropdowns so they don't overlap on narrow screens.
  setLayersOpen(false);
  setInfoOpen(false);
});
poiPanel.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => setPoiOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && poiControl.classList.contains('open')) {
    setPoiOpen(false);
    poiToggle.focus();
  }
});

// ----- Data-sources (info) dropdown -----
// Static content, leftmost of the three top-right controls. Same open/close
// pattern as the other two — click-outside and Escape close it.
const infoControl = document.getElementById('info-control');
const infoToggle  = document.getElementById('info-toggle');
const infoPanel   = document.getElementById('info-panel');
function setInfoOpen(open) {
  infoControl.classList.toggle('open', open);
  infoToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) infoPanel.removeAttribute('hidden');
  else infoPanel.setAttribute('hidden', '');
}
infoToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  setInfoOpen(!infoControl.classList.contains('open'));
  setLayersOpen(false);
  setPoiOpen(false);
});
infoPanel.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => setInfoOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && infoControl.classList.contains('open')) {
    setInfoOpen(false);
    infoToggle.focus();
  }
});

// =============================================================
// Layers panel dropdown
// =============================================================
// ----- Layers panel dropdown -----
// The panel is hidden by default; the layers icon toggles it. Closes on
// click-outside or Escape. The panel itself is `stopPropagation` so that
// interacting with controls inside doesn't trigger the outside-click close.
const layersControl = document.getElementById('layers-control');
const layersToggle  = document.getElementById('layers-toggle');
const layersPanel   = document.getElementById('layers-panel');

function setLayersOpen(open) {
  layersControl.classList.toggle('open', open);
  layersToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) layersPanel.removeAttribute('hidden');
  else layersPanel.setAttribute('hidden', '');
}
layersToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  setLayersOpen(!layersControl.classList.contains('open'));
  // Close the sibling dropdowns so the panels don't overlap.
  setPoiOpen(false);
  setInfoOpen(false);
});
layersPanel.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => setLayersOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && layersControl.classList.contains('open')) {
    setLayersOpen(false);
    layersToggle.focus();
  }
});

// =============================================================
// Persist / restore map UI state across page reloads
// =============================================================
function scheduleSaveMapState() {
  if (_restoringMapState || _suppressViewSave) return;
  clearTimeout(_saveMapStateTimer);
  _saveMapStateTimer = setTimeout(saveMapState, 250);
}

function saveMapState() {
  const view = map.getView();
  const center = view.getCenter();
  const zoom = view.getZoom();
  const resolution = view.getResolution();
  let rangeCenter = null;
  for (const f of rangeSource.getFeatures()) {
    if (f.get('rangeType') === 'center') {
      rangeCenter = f.getGeometry().getCoordinates().slice();
      break;
    }
  }
  const state = {
    view: (center && zoom != null) ? {
      center: center.slice(),
      zoom,
      resolution: resolution ?? undefined,
    } : null,
    basemap: document.querySelector('input[name="basemap"]:checked')?.value || 'none',
    countryTint: countryTintActive,
    countryTintPct: Math.round(countryTintAlpha * 100),
    radar: $('toggle-radar').checked,
    cloud: $('toggle-cloud').checked,
    masterFrame,
    masterPlaying,
    poi: { ...poiEnabled },
    rangeTool: rangeToolActive,
    rangePreset,
    rangeCenter,
  };
  try {
    localStorage.setItem(MAP_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[map-state] save failed:', e);
  }
}

function setWeatherLayer(panelId, on, { skipSave = false } = {}) {
  const al = animatedLayers.find((x) => x.panelId === panelId);
  if (!al) return;
  const el = $('toggle-' + panelId);
  if (el) el.checked = on;
  if (on) {
    al.layer.setVisible(true);
    al.lastTime = null;
    $('master-controls').style.display = '';
    applyMasterFrame();
    if (!masterPlaying) startMaster();
  } else {
    al.layer.setVisible(false);
    $(panelId + '-loading').classList.remove('on');
    if (!anyLayerVisible()) {
      stopMaster();
      $('master-controls').style.display = 'none';
    }
  }
  if (!skipSave) scheduleSaveMapState();
}

function migrateSavedPoiState(poi) {
  if (!poi) return poi;
  const next = { ...poi };
  if (next.hospital && next.hospitalMajor === undefined) {
    next.hospitalMajor = !!next.hospital;
    next.hospitalOther = !!next.hospital;
  }
  delete next.hospital;
  return next;
}

function restoreMapState(state) {
  if (!state) return;
  _restoringMapState = true;
  try {
    state = { ...state, poi: migrateSavedPoiState(state.poi) };
    applyBasemap(state.basemap || 'none', { skipSave: true });
    tintToggleEl.checked = !!state.countryTint;
    countryTintActive = !!state.countryTint;
    tintSliderEl.disabled = !countryTintActive;
    const pct = state.countryTintPct ?? 40;
    tintSliderEl.value = String(pct);
    countryTintAlpha = pct / 100;
    tintValueEl.textContent = String(pct);
    countriesSource.changed();

    setWeatherLayer('radar', !!state.radar, { skipSave: true });
    setWeatherLayer('cloud', !!state.cloud, { skipSave: true });
    if (typeof state.masterFrame === 'number') {
      masterFrame = Math.max(0, Math.min(MASTER_FRAMES - 1, state.masterFrame));
      applyMasterFrame();
    }
    if (state.masterPlaying && anyLayerVisible()) startMaster();
    else stopMaster();

    for (const cfg of POI_TOGGLE_SPECS) {
      setPoiToggle(cfg.key, cfg.panelId, !!state.poi?.[cfg.key], { skipSave: true, skipRefresh: true });
    }
    setPoiToggle('hospitalMajor', 'hospital-major', !!state.poi?.hospitalMajor, { skipSave: true, skipRefresh: true });
    setPoiToggle('hospitalOther', 'hospital-other', !!state.poi?.hospitalOther, { skipSave: true, skipRefresh: true });
    setPoiToggle('militaryMajor', 'military-major', !!state.poi?.militaryMajor, { skipSave: true, skipRefresh: true });
    setPoiToggle('militaryOther', 'military-other', !!state.poi?.militaryOther, { skipSave: true, skipRefresh: true });
    poiClusterLayer.setVisible(anyPoiEnabled());
    schedulePoiClusterRefresh();

    if (state.rangePreset && RANGE_PRESETS[state.rangePreset]) {
      setRangePreset(state.rangePreset, { skipSave: true });
    }
    if (state.rangeCenter) {
      placeRangeRings(state.rangeCenter);
      rangeClear.hidden = false;
    }
    rangeToolActive = !!state.rangeTool;
    rangeBtn.setAttribute('aria-pressed', state.rangeTool ? 'true' : 'false');
    map.getTargetElement().style.cursor = state.rangeTool ? 'crosshair' : '';
  } finally {
    _restoringMapState = false;
  }
}

function resetMapToDefaults() {
  _restoringMapState = true;
  try {
    localStorage.removeItem(MAP_STATE_KEY);
    pendingSavedMapState = null;

    applyBasemap('none', { skipSave: true });
    tintToggleEl.checked = false;
    countryTintActive = false;
    tintSliderEl.disabled = true;
    tintSliderEl.value = '40';
    countryTintAlpha = 0.40;
    tintValueEl.textContent = '40';
    countriesSource.changed();

    setWeatherLayer('radar', false, { skipSave: true });
    setWeatherLayer('cloud', false, { skipSave: true });
    stopMaster();
    masterFrame = MASTER_FRAMES - 1;
    applyMasterFrame();

    for (const cfg of POI_TOGGLE_SPECS) {
      setPoiToggle(cfg.key, cfg.panelId, false, { skipSave: true, skipRefresh: true });
    }
    setPoiToggle('hospitalMajor', 'hospital-major', false, { skipSave: true, skipRefresh: true });
    setPoiToggle('hospitalOther', 'hospital-other', false, { skipSave: true, skipRefresh: true });
    setPoiToggle('militaryMajor', 'military-major', false, { skipSave: true, skipRefresh: true });
    setPoiToggle('militaryOther', 'military-other', false, { skipSave: true, skipRefresh: true });
    poiClusterLayer.setVisible(false);
    schedulePoiClusterRefresh();

    setRangePreset('long', { skipSave: true });
    setRangeToolActive(false, { skipSave: true });
    popupEl.style.display = 'none';

    _suppressViewSave = true;
    try {
      const ext = countriesSource.getExtent();
      if (ext && isFinite(ext[0])) {
        map.getView().fit(ext, { padding: [40, 40, 40, 40], duration: 300 });
      }
    } finally {
      _suppressViewSave = false;
    }
  } finally {
    _restoringMapState = false;
  }
}

document.getElementById('reset-map-btn').addEventListener('click', () => {
  resetMapToDefaults();
});

restoreMapState(pendingSavedMapState);
