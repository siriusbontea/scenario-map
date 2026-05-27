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
- **Weather (WX) dropdown** — one GeoMet WMS overlay at a time (Current or
  Forecast), with a shared timeline:
  - **Current:** radar (1 km / 6 min), 6 h precip analysis (RDPA), 10 m wind
  - **Forecast (GDPS):** 1 h precip, 10 m wind, total cloud cover
- **Eight tiered POI overlays**, pre-clipped to scenario land:
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
  - **Military installations** by site role:
    Base (active duty) / Guard or Reserve / Range or training area.
  - **Correctional facilities** by jurisdiction × security level:
    Federal or Maximum / State or Medium / Local, Jail or Juvenile.
  - **Schools** by enrollment:
    College or University / K-12 with ≥ 500 enrollment / K-12 with
    100–499 enrollment. Schools below 100 are dropped.
  - **Food production** by activity:
    Slaughter / Processing / Egg or Other. Driven by USDA FSIS and
    CFIA establishment activity codes.
  - **Long-term care** by clinical acuity:
    Skilled nursing / Assisted living / Hospice or adult day.
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
├── scripts/
│   └── build_overlays.py   Re-builds every overlay GeoJSON from upstream
└── data/
    ├── scenario.geojson    Scenario country polygons (EPSG:4326)
    ├── airports.geojson    Pre-clipped, tiered airfield POIs
    ├── hospitals.geojson   Pre-clipped, tiered hospital POIs
    ├── walmarts.geojson    Pre-clipped, tiered Walmart POIs
    ├── military.geojson    Pre-clipped, tiered military installations
    ├── corrections.geojson Pre-clipped, tiered correctional facilities
    ├── schools.geojson     Pre-clipped, tiered schools (enrollment ≥ 100)
    ├── food.geojson        Pre-clipped, tiered food production facilities
    ├── ltc.geojson         Pre-clipped, tiered long-term care facilities
    ├── airport_edges.csv   BTS T-100 passenger-flow sidecar (sidecar only)
    ├── _geocode_cache.json Cached US Census + Nominatim geocodes
    ├── ne_land.geojson     Natural Earth land reference
    ├── ocean.geojson       Reference ocean polygon
    └── raw/
        └── T_T100_SEGMENT_ALL_CARRIER.zip   User-pre-positioned BTS data
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
| Military installations | [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass API (`military=*`) | © OSM contributors, ODbL |
| Correctional facilities (US) | [HIFLD Prison Points](https://hifld-geoplatform.opendata.arcgis.com/) | Public domain |
| Correctional facilities (CA, GL, IS) | [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass API (`amenity=prison`) | © OSM contributors, ODbL |
| Schools (US, public + private K-12 + colleges) | HIFLD [Public Schools](https://hifld-geoplatform.opendata.arcgis.com/), [Private Schools](https://hifld-geoplatform.opendata.arcgis.com/), and [Colleges & Universities](https://hifld-geoplatform.opendata.arcgis.com/) (wraps NCES CCD/PSS + IPEDS) | Public domain |
| Schools (CA, GL, IS) | [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass API (`amenity=school|college|university`) | © OSM contributors, ODbL |
| Food production (US) | [USDA FSIS Meat, Poultry & Egg Product Inspection Directory](https://www.fsis.usda.gov/inspection/establishments/meat-poultry-and-egg-product-inspection-directory), addresses geocoded via [US Census Geocoder](https://geocoding.geo.census.gov/geocoder/) | Public domain |
| Food production (CA, GL, IS) | [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass API (`industrial=slaughterhouse|meat|food|fish`). CFIA doesn't publish a bulk CSV of licensed establishments via open.canada.ca, so OSM is the unified source for all three foreign countries. | © OSM contributors, ODbL |
| Long-term care (US) | [HIFLD Open Nursing Homes](https://hifld-geoplatform.opendata.arcgis.com/) (wraps CMS Provider Information) | Public domain |
| Long-term care (CA) | [StatCan ODHF v1.1](https://www.statcan.gc.ca/en/lode/databases/odhf) (filtered to long-term care facility types) | Statistics Canada Open License |
| Long-term care (GL, IS) | [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass API (`amenity=nursing_home` + `social_facility=*`) | © OSM contributors, ODbL |
| Airport passenger-flow sidecar | [BTS T-100 Segment](https://www.transtats.bts.gov/Tables.asp?DB_ID=110) — user-pre-positioned ZIP | Public domain |

POI data is clipped to scenario land polygons at fetch time using a
point-in-polygon test against `data/scenario.geojson`.

## Rebuilding the overlays

`scripts/build_overlays.py` regenerates every GeoJSON overlay from
upstream sources. The script is idempotent — re-run any time to refresh.

```bash
# All eight overlays + the BTS T-100 sidecar
.venv/bin/python scripts/build_overlays.py

# A single layer (faster iteration)
.venv/bin/python scripts/build_overlays.py military
.venv/bin/python scripts/build_overlays.py schools
.venv/bin/python scripts/build_overlays.py food         # see caveats below
```

### Notes

- **FSIS network access.** The USDA FSIS site is fronted by Akamai's
  bot-detection layer. From data-centre / cloud / VPN egress it 403s for
  every non-residential request, regardless of headers. Run the build
  from a residential network for the `food` layer to succeed; otherwise
  it falls back to OSM-only food coverage (Greenland / Iceland only,
  sparse). Override the URL pattern via `FSIS_CSV_URL=<mirror>` if you
  have a stable mirror.
- **CFIA geocoding via Nominatim** is rate-limited to 1 req/sec per the
  Nominatim usage policy. The first `food` build is therefore slow
  (~10 min for ~600 CA records); subsequent runs hit the local cache at
  `data/_geocode_cache.json` and complete in seconds.
- **BTS T-100 sidecar.** The script reads a pre-positioned ZIP at
  `data/raw/T_T100_SEGMENT_ALL_CARRIER.zip`. Download once from BTS:
  visit <https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FIL>,
  choose Aviation → T-100 Segment (All Carriers), pick a year, save the
  ZIP into `data/raw/`. The build aggregates origin→dest passenger flows
  to airport-pair edges, retaining only pairs whose endpoints are both
  in `airports.geojson`.

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
