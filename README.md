# Scenario Map

Interactive OpenLayers web map for tactical scenario planning. Static
HTML/CSS/JS — no build step.

**Live site:** https://siriusbontea.github.io/scenario-map/

## Features

- **Custom country polygons** rendered in EPSG:3978 (NAD83 / Canada
  Atlas Lambert) with split-color borders and a colorblind-safe palette
  (Okabe-Ito foundation).
- **Four basemaps**, each clipped to the country polygons via a cached
  Path2D mask:
  - Esri World Hillshade (relief)
  - OpenStreetMap (transportation)
  - Esri World Imagery (satellite)
  - OpenTopoMap (topographic)
- **Animated weather overlays** from Environment Canada GeoMet, driven by
  a shared master timeline:
  - Radar — 1 km grid, 6-min cadence
  - GDPS total cloud cover — 15 km grid, hourly cadence
- **Three tiered POI overlays**, pre-clipped to scenario land:
  - **Military-capable airfields** by longest usable runway against USAF
    cargo-aircraft minima:
    C-5 (≥ 8,000 ft paved) / C-17 (≥ 6,000 ft paved) / C-130 (≥ 4,000 ft
    hard surface). Smaller airfields dropped.
  - **Hospitals** by capability:
    Major (Level I/II trauma, military, ≥ 200-bed general acute,
    regional/teaching) / Standard (general acute care) / Limited
    (critical access, specialty, clinic).
  - **Walmart stores** by retail format:
    Supercenter / Discount Store / Neighborhood Market.
- **Cross-overlay clustering** — an airport, hospital, and Walmart on the
  same block fuse into one count bubble. Bubbles step through three
  color/size tiers (blue < 10, amber 10–99, red ≥ 100). Clicking a bubble
  zooms to fit its members.
- **Geodesic range-rings tool** — drops concentric rings at
  250 / 500 / 750 / 1,000 km from the click point. Each ring is a true
  great-circle distance.
- **Cursor coordinate readout** — decimal lat/lon plus NATO MGRS.
- **Data-sources panel** with attribution links for every layer.

## Running locally

The page uses `fetch()` to load GeoJSON, so it must be served over HTTP
(not `file://`).

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## File layout

```
.
├── index.html        Page skeleton + the three top-right control panels
├── style.css         All custom styling
├── map.js            Map setup, projection, layers, tools, overlays
├── favicon.svg       Browser-tab icon (concentric range rings)
└── data/
    ├── scenario.geojson    Scenario country polygons (EPSG:4326)
    ├── airports.geojson    Pre-clipped, tiered airfield POIs
    ├── hospitals.geojson   Pre-clipped, tiered hospital POIs
    ├── walmarts.geojson    Pre-clipped, tiered Walmart POIs
    ├── ne_land.geojson     Natural Earth land reference
    └── ocean.geojson       Reference ocean polygon
```

## Data sources

| Layer | Source | License |
|---|---|---|
| Hillshade | [Esri World Hillshade](https://www.arcgis.com/home/item.html?id=1b243539f4514b6ba35e7d995890db1d) | Esri / USGS / NOAA |
| Transportation | [OpenStreetMap](https://www.openstreetmap.org/copyright) | © OSM contributors, ODbL |
| Satellite | [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Esri / Maxar / Earthstar Geographics |
| Topographic | [OpenTopoMap](https://opentopomap.org/about) | CC-BY-SA + OSM contributors |
| Weather (radar, cloud cover) | [Environment Canada GeoMet](https://eccc-msc.github.io/open-data/msc-geomet/readme_geomet_en/) | Open Government Licence — Canada |
| Airfields | [OurAirports](https://ourairports.com/data/) (`airports.csv` + `runways.csv`) | CC0 / Public Domain |
| Hospitals (US) | [HIFLD Hospitals](https://hifld-geoplatform.opendata.arcgis.com/) | Public domain |
| Hospitals (CA) | [StatCan ODHF v1.1](https://www.statcan.gc.ca/en/lode/databases/odhf) | Statistics Canada Open License |
| Hospitals (GL, IS) | [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass API | © OSM contributors, ODbL |
| Walmart stores | [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass API | © OSM contributors, ODbL |

POI data is clipped to scenario land polygons at fetch time using a
point-in-polygon test against `data/scenario.geojson`.

## Tech notes

- **Projection.** EPSG:3978 (Lambert Conformal Conic, NAD83). Conformal —
  preserves local shape — and minimizes scale distortion across Canada,
  the North Atlantic, and the Arctic.
- **No build step.** Bundlers and ES modules are intentionally avoided.
  The page is editable in any text editor and loads OpenLayers, proj4js,
  and the MGRS library from jsDelivr.
- **Clustering.** OpenLayers' `Cluster` source wraps one combined feature
  source containing all enabled overlays. Toggling a kind off filters its
  features out via the cluster's `geometryFunction` rather than removing
  them, so re-enabling is instant.
- **Country fills as a clip mask.** Basemap tiles render to the layer's
  canvas, then `postrender` composites the country shapes with
  `globalCompositeOperation = 'destination-in'`. Pixels outside the
  polygons are erased, leaving the textured dark "ocean" backdrop
  visible.

## Authorship

Sirius T. Bontea
