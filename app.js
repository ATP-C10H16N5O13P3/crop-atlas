"use strict";

// Leave empty to enter your Google key in the app.
const GOOGLE_MAPS_API_KEY = "AIzaSyAcv4gLaZAHIBV2oJtsOsMiBkKMsskDXiY";

const $ = id => document.getElementById(id);

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
];

const DAYS = [
  31, 28.25, 31, 30, 31, 30,
  31, 31, 30, 31, 30, 31
];

const CATALOG_URL =
  "https://raw.githubusercontent.com/OpenCLIM/ecocrop/main/EcoCrop_DB.csv";

let map;
let mapMarker;
let GoogleMarker;
let googleLoad;
let placeVersion = 0;

let selectedLocation = null;
let selectedCrop = null;
let climate = null;
let soil = null;
let soilState = "idle";
let activeTab = "all";
let catalogLoaded = false;

const previousCropIds = new Set();

// =====================================================
// HELPERS
// =====================================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function cleanText(value) {
  const text = String(value || "").trim();

  if (text === "NA") return "";

  const parsed = new DOMParser().parseFromString(text, "text/html");

  return (parsed.body.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function number(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const result = Number(value);

  return Number.isFinite(result) && result !== -999
    ? result
    : null;
}

function formatValue(value, unit = "", decimals = 1) {
  if (!Number.isFinite(value)) return "Unavailable";

  return value.toLocaleString(undefined, {
    maximumFractionDigits: decimals
  }) + (unit ? ` ${unit}` : "");
}

function rangeText(min, max, unit = "") {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return "Unavailable";
  }

  return `${min}–${max}${unit ? " " + unit : ""}`;
}

function readStorage(key) {
  try {
    const result = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

function paragraph(parent, text, className = "note") {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function showMapMessage(text) {
  $("mapMessage").textContent = text;
  $("mapMessage").hidden = !text;
}

function metricCard(title, value, result, preferred, tolerance) {
  const symbol = !result
    ? ""
    : result.level === 2
      ? "✓"
      : result.level === null
        ? "?"
        : "!";

  return `
    <section class="metric-card">
      <div class="metric-title">${escapeHTML(title)}</div>
      <div class="metric-value">${escapeHTML(value)}</div>

      ${result ? `
        <div class="metric-status ${result.className}">
          ${symbol} ${escapeHTML(result.label)}
        </div>

        <div class="metric-range">
          Preferred: ${escapeHTML(preferred)}<br>
          Tolerance: ${escapeHTML(tolerance)}
        </div>
      ` : ""}
    </section>
  `;
}

// =====================================================
// CROP DATABASE
// =====================================================

function starter(id, name, scientific, icon, values) {
  const [
    tmin, toptmin, toptmax, tmax,
    rmin, roptmin, roptmax, rmax,
    gmin, gmax
  ] = values;

  return {
    id,
    name,
    scientific,
    icon,
    tmin,
    toptmin,
    toptmax,
    tmax,
    rmin,
    roptmin,
    roptmax,
    rmax,
    gmin,
    gmax,
    phmin: null,
    phmax: null,
    phoptmin: null,
    phoptmax: null,
    texture: "",
    drainage: "",
    family: "",
    category: "",
    lifespan: "",
    aliases: name
  };
}

let crops = [
  starter(
    "rice", "Rice", "Oryza sativa", "🌾",
    [10, 20, 30, 36, 1000, 1500, 2000, 4000, 80, 180]
  ),
  starter(
    "maize", "Maize", "Zea mays", "🌽",
    [10, 18, 33, 47, 400, 600, 1200, 1800, 65, 365]
  ),
  starter(
    "wheat", "Wheat", "Triticum aestivum", "🌾",
    [5, 15, 23, 27, 300, 750, 900, 1600, 90, 250]
  ),
  starter(
    "potato", "Potato", "Solanum tuberosum", "🥔",
    [7, 15, 25, 30, 250, 500, 800, 2000, 90, 160]
  ),
  starter(
    "soybean", "Soybean", "Glycine max", "🌱",
    [10, 20, 33, 38, 450, 600, 1500, 1800, 75, 180]
  ),
  starter(
    "coffee", "Arabica coffee", "Coffea arabica", "☕",
    [10, 14, 28, 34, 750, 1400, 2300, 4200, 210, 330]
  ),
  starter(
    "cassava", "Cassava", "Manihot esculenta", "🌿",
    [10, 20, 29, 35, 500, 1000, 1500, 5000, 180, 365]
  ),
  starter(
    "sunflower", "Sunflower", "Helianthus annuus", "🌻",
    [5, 17, 34, 45, 300, 600, 1000, 1600, 70, 200]
  )
];

const starterMap = new Map(
  crops.map(crop => [crop.scientific, crop])
);

const preferredNames = {
  "Myristica fragrans": "Nutmeg",
  "Abelmoschus esculentus": "Okra",
  "Allium cepa": "Onion",
  "Allium sativum": "Garlic",
  "Ananas comosus": "Pineapple",
  "Arachis hypogaea": "Peanut",
  "Carica papaya": "Papaya",
  "Cicer arietinum": "Chickpea",
  "Citrullus lanatus": "Watermelon",
  "Cocos nucifera": "Coconut",
  "Cucumis sativus": "Cucumber",
  "Daucus carota": "Carrot",
  "Durio zibethinus": "Durian",
  "Ipomoea batatas": "Sweet potato",
  "Lactuca sativa": "Lettuce",
  "Lens culinaris": "Lentil",
  "Lycopersicon esculentum": "Tomato",
  "Solanum lycopersicum": "Tomato",
  "Mangifera indica": "Mango",
  "Persea americana": "Avocado",
  "Phaseolus vulgaris": "Common bean",
  "Pisum sativum": "Pea",
  "Saccharum officinarum": "Sugarcane",
  "Solanum melongena": "Eggplant",
  "Sorghum bicolor": "Sorghum",
  "Theobroma cacao": "Cacao",
  "Vigna radiata": "Mung bean",
  "Vigna unguiculata": "Cowpea",
  "Vitis vinifera": "Grape",
  "Zingiber officinale": "Ginger"
};

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];

    if (character === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (
      (character === "\n" || character === "\r") &&
      !quoted
    ) {
      if (character === "\r" && text[i + 1] === "\n") i++;

      row.push(cell);

      if (row.some(value => value !== "")) {
        rows.push(row);
      }

      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);

  if (row.some(value => value !== "")) {
    rows.push(row);
  }

  const headers = (rows.shift() || []).map(value =>
    value.replace(/^\uFEFF/, "").trim()
  );

  return rows.map(values => Object.fromEntries(
    headers.map((key, index) => [key, values[index] || ""])
  ));
}

async function loadCatalog() {
  $("catalogStatus").textContent = "Loading plant database…";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(CATALOG_URL, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("Crop database request failed");
    }

    const buffer = await response.arrayBuffer();

    const records = parseCSV(
      new TextDecoder("windows-1252").decode(buffer)
    );

    const merged = new Map(
      crops.map(crop => [crop.scientific, crop])
    );

    for (const record of records) {
      const scientific = cleanText(record.ScientificName);
      const category = cleanText(record.CAT);
      const original = starterMap.get(scientific);

      const food =
        /vegetables|fruits|cereals|pulses|roots\/tubers|beverages|spices/i
          .test(category);

      if (!scientific || (!food && !original)) continue;

      const aliases = cleanText(record.COMNAME);

      merged.set(scientific, {
        id: original?.id || `eco-${record.EcoPortCode || scientific}`,

        name: original?.name ||
          preferredNames[scientific] ||
          aliases.split(",")[0].trim() ||
          scientific,

        scientific,
        icon: original?.icon || "🌱",
        aliases,
        category,

        family:
          cleanText(record.FAMNAME).split(":").pop() || "",

        lifespan: cleanText(record.LISPA),

        tmin: number(record.TMIN),
        toptmin: number(record.TOPMN),
        toptmax: number(record.TOPMX),
        tmax: number(record.TMAX),

        rmin: number(record.RMIN),
        roptmin: number(record.ROPMN),
        roptmax: number(record.ROPMX),
        rmax: number(record.RMAX),

        phmin: number(record.PHMIN),
        phmax: number(record.PHMAX),
        phoptmin: number(record.PHOPMN),
        phoptmax: number(record.PHOPMX),

        gmin: number(record.GMIN),
        gmax: number(record.GMAX),

        texture: cleanText(record.TEXT),
        drainage: cleanText(record.DRA)
      });
    }

    crops = [...merged.values()].sort((a, b) => {
      const first = starterMap.has(a.scientific);
      const second = starterMap.has(b.scientific);

      return first !== second
        ? first ? -1 : 1
        : a.name.localeCompare(b.name);
    });

    catalogLoaded = true;

    if (selectedCrop) {
      selectedCrop =
        crops.find(crop => crop.id === selectedCrop.id) ||
        selectedCrop;
    }

    $("catalogStatus").textContent =
      `${crops.length.toLocaleString()} records · EcoCrop`;

    renderLibrary();
    refreshComparisons();
    renderPreviousCrops();

    if (localRecords) {
      renderLocalCrops(localRecords);
    }

    invalidatePlan();
  } catch (error) {
    $("catalogStatus").textContent =
      "8 starter crops · full database unavailable. Refresh to retry.";

    console.error("Crop database:", error);
  } finally {
    clearTimeout(timeout);
  }
}

// =====================================================
// GOOGLE MAP
// =====================================================

function loadGoogle(key) {
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve();
  }

  if (googleLoad) return googleLoad;

  googleLoad = new Promise((resolve, reject) => {
    const script = document.createElement("script");

    const timer = setTimeout(() => {
      reject(new Error("Google Maps timed out"));
    }, 30000);

    window.cropAtlasGoogleReady = () => {
      clearTimeout(timer);
      resolve();
    };

    window.gm_authFailure = () => {
      clearTimeout(timer);

      showMapMessage(
        "Google rejected the key or its configuration. " +
        "Check F12 → Console and your demo-key limits."
      );

      reject(new Error("Google Maps authentication failed"));
    };

    const url = new URL(
      "https://maps.googleapis.com/maps/api/js"
    );

    const parameters = {
      key,
      v: "weekly",
      loading: "async",
      language: "en",
      region: "TH",
      callback: "cropAtlasGoogleReady"
    };

    Object.entries(parameters).forEach(([name, value]) =>
      url.searchParams.set(name, value)
    );

    script.src = url.href;
    script.async = true;

    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Could not download Google Maps"));
    };

    document.head.appendChild(script);
  });

  return googleLoad;
}

async function initializeMap(key) {
  $("mapSetup").hidden = true;
  showMapMessage("Loading Google’s 3D map…");

  try {
    await loadGoogle(key);

    const {
      Map3DElement,
      Marker3DElement
    } = await google.maps.importLibrary("maps3d");

    GoogleMarker = Marker3DElement;

    map = new Map3DElement({
      center: {
        lat: 15,
        lng: 100.5,
        altitude: 0
      },
      range: 18000000,
      tilt: 0,
      heading: 0,
      roll: 0,
      mode: "HYBRID",
      defaultUIHidden: true,
      gestureHandling: "GREEDY"
    });

    $("globe").replaceChildren(map);

    map.addEventListener("gmp-click", event => {
      const position = event.position;

      if (
        !position ||
        !Number.isFinite(position.lat) ||
        !Number.isFinite(position.lng)
      ) return;

      placeVersion++;

      selectLocation({
        name: "Selected location",
        latitude: position.lat,
        longitude: position.lng,
        altitude: Number.isFinite(position.altitude)
          ? Math.max(0, position.altitude)
          : 0
      });
    });

    map.addEventListener("gmp-error", () => {
      showMapMessage(
        "Google’s map could not initialize. Check WebGL, " +
        "your key, and demo quota. See F12 → Console."
      );
    });

    await initializeSearch();
    showMapMessage("");
  } catch (error) {
    console.error("Google Maps:", error);

    showMapMessage(
      "Google Maps could not load. Check your key and connection. " +
      "See F12 → Console, then refresh to retry."
    );
  }
}

function flyToLocation(location, range = 1800) {
  if (!map) return;

  map.flyCameraTo({
    endCamera: {
      center: {
        lat: location.latitude,
        lng: location.longitude,
        altitude: location.altitude || 0
      },
      range,
      tilt: 0,
      heading: 0,
      roll: 0
    },
    durationMillis: 1400
  }).catch(error => {
    console.warn("Map camera:", error);
  });
}

function updateMarker(location) {
  if (!map || !GoogleMarker) return;

  const position = {
    lat: location.latitude,
    lng: location.longitude,
    altitude: 0
  };

  if (!mapMarker) {
    mapMarker = new GoogleMarker({
      position,
      altitudeMode: "CLAMP_TO_GROUND",
      label: "Selected point"
    });

    map.append(mapMarker);
  } else {
    mapMarker.position = position;
  }
}

function selectLocation(location, fly = false) {
  selectedLocation = location;

  $("locationName").textContent = location.name;

  $("locationCoordinates").textContent =
    `${Math.abs(location.latitude).toFixed(5)}° ` +
    `${location.latitude >= 0 ? "N" : "S"} · ` +
    `${Math.abs(location.longitude).toFixed(5)}° ` +
    `${location.longitude >= 0 ? "E" : "W"}`;

  $("placeActions").hidden = false;

  previousCropIds.clear();
  renderPreviousCrops();
  invalidatePlan();

  updateMarker(location);
  scheduleClimate();
  scheduleSoil();
  scheduleLocalCrops();

  if (fly) {
    flyToLocation(location);
  }
}

// =====================================================
// PLACE SEARCH
// =====================================================

async function initializeSearch() {
  try {
    const { PlaceAutocompleteElement } =
      await google.maps.importLibrary("places");

    const search = new PlaceAutocompleteElement();

    search.setAttribute(
      "placeholder",
      "Search addresses, restaurants, landmarks…"
    );

    search.setAttribute(
      "aria-label",
      "Search Google Maps"
    );

    $("googleSearchHost").replaceChildren(search);

    $("searchStatus").textContent =
      "Google Maps · select a search suggestion";

    search.addEventListener("gmp-error", () => {
      $("searchStatus").textContent =
        "Search unavailable. Check Places access and demo quota, " +
        "or select a point directly.";
    });

    search.addEventListener("gmp-select", async event => {
      const version = ++placeVersion;

      $("searchStatus").textContent = "Loading place…";

      try {
        const place = event.placePrediction.toPlace();

        await place.fetchFields({
          fields: [
            "id",
            "displayName",
            "formattedAddress",
            "location",
            "viewport"
          ]
        });

        if (version !== placeVersion) return;

        if (!place.location) {
          throw new Error("No coordinates");
        }

        const location = {
          name:
            place.displayName ||
            place.formattedAddress ||
            "Selected place",

          latitude: place.location.lat(),
          longitude: place.location.lng(),
          placeId: place.id,
          source: "google"
        };

        selectLocation(location);

        let range = 1800;

        if (place.viewport) {
          const ne = place.viewport.getNorthEast();
          const sw = place.viewport.getSouthWest();

          let width = ne.lng() - sw.lng();

          if (width < 0) {
            width += 360;
          }

          const span = Math.max(
            ne.lat() - sw.lat(),
            width * Math.cos(location.latitude * Math.PI / 180)
          );

          range = Math.max(
            1200,
            Math.min(18000000, span * 180000)
          );
        }

        flyToLocation(location, range);

        $("searchStatus").textContent =
          place.formattedAddress ||
          "Selected on Google Maps";
      } catch (error) {
        if (version !== placeVersion) return;

        $("searchStatus").textContent =
          "Could not load this place. Try again or click the map.";

        console.error("Google place:", error);
      }
    });
  } catch (error) {
    $("searchStatus").textContent =
      "Google place search unavailable for this key. " +
      "You can still click the map.";

    console.error("Google search:", error);
  }
}

// =====================================================
// MAP BUTTONS
// =====================================================

$("keyForm").onsubmit = event => {
  event.preventDefault();

  const key = $("googleKeyInput").value.trim();

  if (!key) return;

  $("googleKeyInput").value = "";
  initializeMap(key);
};

$("overviewButton").onclick = () => {
  flyToLocation(
    {
      latitude: 15,
      longitude: 100.5
    },
    18000000
  );
};

$("zoomInButton").onclick = () => {
  if (map) {
    map.range = Math.max(40, map.range * 0.75);
  }
};

$("zoomOutButton").onclick = () => {
  if (map) {
    map.range = Math.min(40000000, map.range / 0.75);
  }
};

$("tiltButton").onclick = () => {
  if (!map) return;

  const tilted = map.tilt < 20;

  map.tilt = tilted ? 55 : 0;
  map.roll = 0;

  $("tiltButton").classList.toggle("active", tilted);

  $("tiltButton").setAttribute(
    "aria-pressed",
    String(tilted)
  );
};

$("labelsButton").onclick = () => {
  if (!map) return;

  const show = map.mode !== "HYBRID";

  map.mode = show ? "HYBRID" : "SATELLITE";

  $("labelsButton").setAttribute(
    "aria-pressed",
    String(show)
  );
};

// =====================================================
// SAVED LOCATIONS AND HOME
// =====================================================

let savedPlaces = readStorage("cropAtlasPlaces").filter(place =>
  place &&
  typeof place.id === "string" &&
  typeof place.label === "string" &&
  (
    typeof place.placeId === "string" ||
    (
      Number.isFinite(place.latitude) &&
      Number.isFinite(place.longitude)
    )
  )
);

let homeId = "";

try {
  homeId =
    localStorage.getItem("cropAtlasHomePlace") || "";
} catch {}

function persistPlaces() {
  try {
    localStorage.setItem(
      "cropAtlasPlaces",
      JSON.stringify(savedPlaces)
    );

    localStorage.setItem(
      "cropAtlasHomePlace",
      homeId
    );

    $("savedPlacesStatus").textContent =
      "Saved in this browser on this device.";
  } catch {
    $("savedPlacesStatus").textContent =
      "Storage unavailable. Changes last for this page only.";
  }

  renderSavedPlaces();
}

function savePlace(asHome = false) {
  if (!selectedLocation) return;

  const label = prompt(
    "Name this location:",
    asHome ? "Home" : ""
  );

  if (!label?.trim()) return;

  const saved = {
    id: crypto.randomUUID(),
    label: label.trim().slice(0, 120)
  };

  if (
    selectedLocation.source === "google" &&
    selectedLocation.placeId
  ) {
    saved.placeId = selectedLocation.placeId;
  } else {
    saved.latitude = selectedLocation.latitude;
    saved.longitude = selectedLocation.longitude;
    saved.altitude = selectedLocation.altitude || 0;
  }

  savedPlaces.unshift(saved);

  if (asHome) {
    homeId = saved.id;
  }

  persistPlaces();
}

async function visitPlace(saved) {
  const version = ++placeVersion;

  try {
    let location;

    if (saved.placeId) {
      if (!window.google?.maps?.importLibrary) {
        throw new Error("Connect Google Maps first.");
      }

      const { Place } =
        await google.maps.importLibrary("places");

      const place = new Place({
        id: saved.placeId
      });

      await place.fetchFields({
        fields: ["location"]
      });

      if (!place.location) {
        throw new Error(
          "This saved place has no available location."
        );
      }

      location = {
        name: saved.label,
        latitude: place.location.lat(),
        longitude: place.location.lng(),
        placeId: saved.placeId,
        source: "google"
      };
    } else {
      location = {
        name: saved.label,
        latitude: saved.latitude,
        longitude: saved.longitude,
        altitude: saved.altitude || 0
      };
    }

    if (version !== placeVersion) return;

    selectLocation(location, true);
    showMapMessage("");
  } catch (error) {
    if (version === placeVersion) {
      showMapMessage(error.message);
    }
  }
}

function renderSavedPlaces() {
  const list = $("savedPlacesList");
  list.replaceChildren();

  $("goHomeButton").disabled =
    !savedPlaces.some(place => place.id === homeId);

  if (!savedPlaces.length) {
    paragraph(
      list,
      "Select a location, then save it."
    );
  }

  for (const saved of savedPlaces) {
    const row = document.createElement("div");
    row.className = "saved-place";

    const visit = document.createElement("button");

    visit.type = "button";

    visit.textContent =
      `${saved.id === homeId ? "⌂" : "📍"} ${saved.label}`;

    visit.style.cssText =
      "display:block;width:100%;text-align:left;";

    visit.onclick = () => visitPlace(saved);

    row.appendChild(visit);

    const actions = [
      ["Rename", () => {
        const name = prompt(
          "New name:",
          saved.label
        );

        if (name?.trim()) {
          saved.label = name.trim().slice(0, 120);
          persistPlaces();
        }
      }],

      ["Set home", () => {
        homeId = saved.id;
        persistPlaces();
      }],

      ["Delete", () => {
        savedPlaces = savedPlaces.filter(place =>
          place.id !== saved.id
        );

        if (homeId === saved.id) {
          homeId = "";
        }

        persistPlaces();
      }]
    ];

    for (const [label, action] of actions) {
      const button = document.createElement("button");

      button.type = "button";
      button.textContent = label;
      button.onclick = action;

      row.appendChild(button);
    }

    list.appendChild(row);
  }
}

$("savePlaceButton").onclick = () => savePlace(false);

$("setHomeButton").onclick = () => savePlace(true);

$("goHomeButton").onclick = () => {
  const saved = savedPlaces.find(place =>
    place.id === homeId
  );

  if (saved) {
    visitPlace(saved);
  }
};

// =====================================================
// NASA POWER CLIMATE
// =====================================================

let climateTimer;
let climateRequest;
let climateVersion = 0;

const climateCache = new Map();

function scheduleClimate() {
  clearTimeout(climateTimer);

  if (climateRequest) {
    climateRequest.abort();
  }

  const version = ++climateVersion;
  const location = selectedLocation;

  climate = null;

  $("nasaStatus").textContent =
    "Loading NASA climate averages…";

  $("retryClimate").hidden = true;
  $("monthlyRows").replaceChildren();

  refreshComparisons();
  invalidatePlan();

  climateTimer = setTimeout(() => {
    loadClimate(location, version);
  }, 600);
}

async function loadClimate(location, version) {
  const key =
    `${location.latitude.toFixed(4)},` +
    `${location.longitude.toFixed(4)}`;

  if (climateCache.has(key)) {
    if (version !== climateVersion) return;

    climate = climateCache.get(key);
    displayClimate();
    return;
  }

  const request = new AbortController();
  climateRequest = request;

  const timeout = setTimeout(() => {
    request.abort();
  }, 30000);

  try {
    const url = new URL(
      "https://power.larc.nasa.gov/api/temporal/climatology/point"
    );

    const parameters = {
      parameters: "T2M,PRECTOTCORR",
      community: "AG",
      latitude: location.latitude,
      longitude: location.longitude,
      format: "JSON"
    };

    Object.entries(parameters).forEach(([name, value]) =>
      url.searchParams.set(name, value)
    );

    const response = await fetch(url, {
      signal: request.signal
    });

    if (!response.ok) {
      throw new Error(`NASA status ${response.status}`);
    }

    const data = await response.json();

    if (version !== climateVersion) return;

    const tempUnit =
      data.parameters?.T2M?.units || "";

    const rainUnit =
      data.parameters?.PRECTOTCORR?.units || "";

    if (
      !/^(C|°C|degC)$/i.test(tempUnit) ||
      !/^mm\/day$/i.test(rainUnit)
    ) {
      throw new Error("Unexpected NASA units");
    }

    const values = data.properties?.parameter;

    if (!values) {
      throw new Error("No NASA parameters");
    }

    const fill = data.header?.fill_value ?? -999;

    function series(source) {
      return Object.fromEntries(
        [...MONTHS, "ANN"].map(month => {
          const value = number(source?.[month]);

          return [
            month,
            value === fill ? null : value
          ];
        })
      );
    }

    const temperature = series(values.T2M);
    const precipitation = series(values.PRECTOTCORR);

    const complete = MONTHS.every(month =>
      Number.isFinite(precipitation[month]) &&
      precipitation[month] >= 0
    );

    climate = {
      temperature,
      precipitation,

      annualPrecipitation: complete
        ? MONTHS.reduce(
            (sum, month, index) =>
              sum + precipitation[month] * DAYS[index],
            0
          )
        : null,

      period: String(data.header?.range || "")
    };

    climateCache.set(key, climate);
    displayClimate();
  } catch (error) {
    if (version !== climateVersion) return;

    climate = null;

    $("nasaStatus").textContent =
      "NASA climate data could not load. Please retry.";

    $("retryClimate").hidden = false;

    refreshComparisons();

    console.error("NASA POWER:", error);
  } finally {
    clearTimeout(timeout);
  }
}

function displayClimate() {
  if (!climate) return;

  const years = climate.period.match(
    /\b(?:19|20)\d{2}\b/g
  );

  $("nasaStatus").textContent =
    years?.length >= 2
      ? `NASA POWER · Climate averages, ` +
        `${years[0]}–${years[years.length - 1]}`
      : "NASA POWER · Long-term climate averages";

  $("nasaStatus").title = climate.period;

  $("retryClimate").hidden = true;

  $("monthlyRows").replaceChildren();

  MONTHS.forEach((month, index) => {
    const row = document.createElement("tr");

    const rain = climate.precipitation[month];

    const total =
      Number.isFinite(rain) && rain >= 0
        ? rain * DAYS[index]
        : null;

    const values = [
      month,
      formatValue(climate.temperature[month], "", 1),
      formatValue(total, "", 0)
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    $("monthlyRows").appendChild(row);
  });

  refreshComparisons();

  if (localRecords) {
    renderLocalCrops(localRecords);
  }

  invalidatePlan();
}

$("retryClimate").onclick = () => {
  if (selectedLocation) {
    scheduleClimate();
  }
};

$("climateMonth").onchange = () => {
  refreshComparisons();

  if (localRecords) {
    renderLocalCrops(localRecords);
  }
};

// =====================================================
// CLIMATE COMPARISONS
// =====================================================

function compareRange(
  value,
  min,
  preferredMin,
  preferredMax,
  max
) {
  if (
    ![value, min, preferredMin, preferredMax, max]
      .every(Number.isFinite)
  ) {
    return {
      level: null,
      label: "Not enough data",
      className: "warning"
    };
  }

  if (
    !(
      min <= preferredMin &&
      preferredMin <= preferredMax &&
      preferredMax <= max
    )
  ) {
    return {
      level: null,
      label: "Reference range needs review",
      className: "warning"
    };
  }

  if (value < min) {
    return {
      level: 0,
      label: "Below recorded range",
      className: "bad"
    };
  }

  if (value > max) {
    return {
      level: 0,
      label: "Above recorded range",
      className: "bad"
    };
  }

  if (
    value >= preferredMin &&
    value <= preferredMax
  ) {
    return {
      level: 2,
      label: "Within preferred range",
      className: "good"
    };
  }

  return {
    level: 1,
    label: "Within tolerance; outside preferred range",
    className: "warning"
  };
}

function compareCrop(
  crop,
  month = $("climateMonth").value
) {
  return {
    temperature: compareRange(
      climate?.temperature[month],
      crop.tmin,
      crop.toptmin,
      crop.toptmax,
      crop.tmax
    ),

    rainfall: compareRange(
      climate?.annualPrecipitation,
      crop.rmin,
      crop.roptmin,
      crop.roptmax,
      crop.rmax
    )
  };
}

function refreshComparisons() {
  renderAssessment();
  renderRecommendations();
  renderSoil();
}

function renderAssessment() {
  const badge = $("climateMatch");
  const panel = $("assessment");

  badge.className = "badge";

  if (!selectedLocation) {
    badge.textContent = "Choose a location";

    panel.textContent =
      "Click the map or search for a place.";

    return;
  }

  if (!climate) {
    badge.textContent =
      $("retryClimate").hidden
        ? "Loading climate data…"
        : "Climate data unavailable";

    panel.textContent =
      "The comparison appears when NASA data is available.";

    return;
  }

  const month = $("climateMonth").value;

  const title =
    month === "ANN"
      ? "🌡️ Average temperature · annual"
      : `🌡️ Average temperature · ${month}`;

  const temp = formatValue(
    climate.temperature[month],
    "°C",
    1
  );

  const rain = formatValue(
    climate.annualPrecipitation,
    "mm/year",
    0
  );

  if (!selectedCrop) {
    badge.textContent =
      "Climate loaded · choose a crop";

    panel.innerHTML =
      metricCard(title, temp) +
      metricCard("🌧️ Rainfall · annual total", rain);

    return;
  }

  const crop = selectedCrop;
  const result = compareCrop(crop);

  const levels = [
    result.temperature.level,
    result.rainfall.level
  ];

  if (levels.includes(0)) {
    badge.textContent = "⚠ Climate limits to check";
    badge.classList.add("bad");
  } else if (levels.includes(null)) {
    badge.textContent = "? More data needed";
    badge.classList.add("warning");
  } else if (levels.every(level => level === 2)) {
    badge.textContent =
      "✓ Both within preferred ranges";

    badge.classList.add("good");
  } else {
    badge.textContent = "! Within tolerance ranges";
    badge.classList.add("warning");
  }

  panel.innerHTML =
    metricCard(
      title,
      temp,
      result.temperature,
      rangeText(crop.toptmin, crop.toptmax, "°C"),
      rangeText(crop.tmin, crop.tmax, "°C")
    ) +

    metricCard(
      "🌧️ Rainfall · annual total",
      rain,
      result.rainfall,
      rangeText(crop.roptmin, crop.roptmax, "mm/year"),
      rangeText(crop.rmin, crop.rmax, "mm/year")
    ) +

    `<p class="note">
      Climate comparison only. Soil, season, irrigation,
      extreme weather, and crop variety also matter.
    </p>`;
}

// =====================================================
// CROP RECOMMENDATIONS
// =====================================================

function renderRecommendations() {
  const list = $("recommendations");
  list.replaceChildren();

  if (!climate) {
    $("recommendationStatus").textContent =
      "Suggestions appear when climate data loads.";

    return;
  }

  const matches = crops.map(crop => {
    const result = compareCrop(crop);

    return {
      crop,
      temperature: result.temperature.level,
      rainfall: result.rainfall.level,

      score:
        (result.temperature.level ?? -10) +
        (result.rainfall.level ?? -10)
    };
  }).filter(item =>
    item.temperature > 0 &&
    item.rainfall > 0
  ).sort((a, b) =>
    b.score - a.score ||
    a.crop.name.localeCompare(b.crop.name)
  );

  $("recommendationStatus").textContent =
    `${matches.length} climate-range matches. ` +
    "Ordered by range match, then alphabetically. " +
    (
      catalogLoaded
        ? ""
        : "Using starter records while the catalog loads."
    );

  if (!matches.length) {
    paragraph(
      list,
      "No crops with complete valid ranges passed this screen. " +
      "This does not mean no crops can grow here."
    );
  }

  for (const item of matches) {
    const button = document.createElement("button");

    button.className = "suggestion";
    button.type = "button";

    const name = document.createElement("strong");

    name.textContent =
      `${item.crop.icon} ${item.crop.name}`;

    const reason = document.createElement("small");

    reason.textContent =
      item.score === 4
        ? "✓ Both climate values within preferred ranges"
        : "Both within tolerance; at least one outside preferred range";

    button.append(name, reason);

    button.onclick = () => {
      selectCrop(item.crop);
    };

    list.appendChild(button);
  }

  list.scrollTop = 0;
}

// =====================================================
// SOILGRIDS: SURFACE ESTIMATES
// =====================================================

let soilTimer;
let soilRequest;
let soilVersion = 0;

const soilCache = new Map();

function scheduleSoil() {
  clearTimeout(soilTimer);

  if (soilRequest) {
    soilRequest.abort();
  }

  const location = selectedLocation;
  const version = ++soilVersion;

  soil = null;
  soilState = "loading";

  $("soilSource").textContent = "";
  $("retrySoil").hidden = true;

  renderSoil();
  invalidatePlan();

  soilTimer = setTimeout(() => {
    loadSoil(location, version);
  }, 700);
}

async function fetchSoilProperty(
  property,
  location,
  signal
) {
  const layer = `${property}_0-5cm_mean`;
  const offset = 0.005;

  const url = new URL(
    "https://maps.isric.org/mapserv"
  );

  const parameters = {
    map: `/map/${property}.map`,
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetFeatureInfo",
    LAYERS: layer,
    QUERY_LAYERS: layer,
    STYLES: "",
    SRS: "EPSG:4326",

    BBOX: [
      location.longitude - offset,
      location.latitude - offset,
      location.longitude + offset,
      location.latitude + offset
    ].join(","),

    WIDTH: "101",
    HEIGHT: "101",
    X: "50",
    Y: "50",
    FORMAT: "image/png",
    INFO_FORMAT: "application/geo+json",
    FEATURE_COUNT: "1"
  };

  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value)
  );

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error("Soil request failed");
  }

  const text = await response.text();

  if (!text.trim()) return null;

  const data = JSON.parse(text);

  if (!Array.isArray(data.features)) {
    throw new Error("Unexpected soil response");
  }

  if (!data.features.length) return null;

  const properties = data.features[0]?.properties;

  const raw = number(
    properties?.pixel_value
  );

  const unit = String(
    properties?.unit || ""
  ).replace(/\s/g, "");

  if (raw === null || raw < 0) return null;

  if (property === "phh2o") {
    if (unit !== "pH*10") {
      throw new Error("Unexpected pH units");
    }

    return raw / 10 <= 14
      ? raw / 10
      : null;
  }

  if (unit !== "g/kg") {
    throw new Error("Unexpected composition units");
  }

  return raw / 10 <= 100
    ? raw / 10
    : null;
}

async function loadSoil(location, version) {
  const key =
    `${location.latitude.toFixed(5)},` +
    `${location.longitude.toFixed(5)}`;

  if (soilCache.has(key)) {
    if (version !== soilVersion) return;

    soil = soilCache.get(key);
    soilState = "loaded";

    renderSoil();
    return;
  }

  const request = new AbortController();
  soilRequest = request;

  const timeout = setTimeout(() => {
    request.abort();
  }, 30000);

  try {
    const names = [
      "phh2o",
      "sand",
      "silt",
      "clay"
    ];

    const results = await Promise.allSettled(
      names.map(name =>
        fetchSoilProperty(
          name,
          location,
          request.signal
        )
      )
    );

    if (version !== soilVersion) return;

    const failed = results.filter(result =>
      result.status === "rejected"
    ).length;

    soil = Object.fromEntries(
      names.map((name, index) => [
        name,
        results[index].status === "fulfilled"
          ? results[index].value
          : null
      ])
    );

    const any = names.some(name =>
      Number.isFinite(soil[name])
    );

    if (
      failed === names.length ||
      (failed && !any)
    ) {
      throw new Error("Soil requests failed");
    }

    soil.retrievedAt = new Date().toISOString();
    soil.partial = failed > 0;

    soilState = "loaded";

    if (!failed) {
      soilCache.set(key, soil);
    }

    $("retrySoil").hidden = !failed;

    renderSoil();
    invalidatePlan();
  } catch (error) {
    if (version !== soilVersion) return;

    soil = null;
    soilState = "error";

    $("retrySoil").hidden = false;

    renderSoil();

    console.error("SoilGrids:", error);
  } finally {
    clearTimeout(timeout);
  }
}

function renderSoil() {
  const panel = $("soilAssessment");

  if (soilState === "idle") {
    panel.textContent = "Select a location.";
    return;
  }

  if (soilState === "loading") {
    panel.textContent =
      "Loading mapped soil estimates…";

    return;
  }

  if (soilState === "error") {
    panel.textContent =
      "Soil estimates could not load. Please retry.";

    $("soilSource").textContent =
      "ISRIC SoilGrids · request unsuccessful.";

    return;
  }

  if (!soil) return;

  const any = [
    "phh2o",
    "sand",
    "silt",
    "clay"
  ].some(key =>
    Number.isFinite(soil[key])
  );

  const date = new Date(
    soil.retrievedAt
  ).toLocaleDateString();

  $("soilSource").textContent =
    `ISRIC SoilGrids · retrieved ${date}. ` +
    "This is not a sampling date. Map update date is not supplied. " +
    (
      soil.partial
        ? "Some properties could not load."
        : ""
    );

  if (!any) {
    panel.textContent =
      "No mapped soil values were returned. Some cities, " +
      "water bodies, and other areas have no estimates.";

    return;
  }

  let phCard = metricCard(
    "🪨 Estimated soil pH · in water",
    formatValue(soil.phh2o)
  );

  if (
    selectedCrop &&
    Number.isFinite(soil.phh2o)
  ) {
    const crop = selectedCrop;

    phCard = metricCard(
      "🪨 Estimated soil pH · in water",
      formatValue(soil.phh2o),

      compareRange(
        soil.phh2o,
        crop.phmin,
        crop.phoptmin,
        crop.phoptmax,
        crop.phmax
      ),

      rangeText(
        crop.phoptmin,
        crop.phoptmax
      ),

      rangeText(
        crop.phmin,
        crop.phmax
      )
    );
  }

  panel.innerHTML = `
    ${phCard}

    <section class="metric-card">
      <h3>Estimated soil composition</h3>

      <table>
        <tbody>
          <tr>
            <td>Sand</td>
            <td>${formatValue(soil.sand, "%")}</td>
          </tr>
          <tr>
            <td>Silt</td>
            <td>${formatValue(soil.silt, "%")}</td>
          </tr>
          <tr>
            <td>Clay</td>
            <td>${formatValue(soil.clay, "%")}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="note">
      Surface estimates for 0–5 cm depth.
      Approximately 250 m map resolution.
      Percentages may differ slightly from 100% due to rounding.
      <br>
      Drainage: unavailable. Total soil depth: unavailable.
      <br>
      Only pH is compared automatically here.
    </p>
  `;
}

$("retrySoil").onclick = () => {
  if (selectedLocation) {
    scheduleSoil();
  }
};

// =====================================================
// CROP LIBRARY, BOOKMARKS AND RECENT HISTORY
// =====================================================

let savedCropIds = readStorage(
  "cropAtlasSaved"
);

let recentCropIds = readStorage(
  "cropAtlasRecent"
);

function saveCropStorage() {
  try {
    localStorage.setItem(
      "cropAtlasSaved",
      JSON.stringify(savedCropIds)
    );

    localStorage.setItem(
      "cropAtlasRecent",
      JSON.stringify(recentCropIds)
    );
  } catch {}
}

function selectCrop(crop) {
  selectedCrop = crop;

  recentCropIds = [
    crop.id,
    ...recentCropIds.filter(id =>
      id !== crop.id
    )
  ].slice(0, 100);

  saveCropStorage();

  $("cropPreview").textContent = crop.icon;

  $("selectedCropName").textContent =
    `${crop.icon} ${crop.name}`;

  $("selectedScientific").textContent =
    crop.scientific;

  $("cropDetailsButton").disabled = false;

  renderLibrary();
  renderAssessment();
  renderSoil();
}

function renderLibrary() {
  const query = $("cropSearch")
    .value
    .trim()
    .toLowerCase();

  let visible = crops;

  if (activeTab === "saved") {
    visible = crops.filter(crop =>
      savedCropIds.includes(crop.id)
    );
  }

  if (activeTab === "recent") {
    visible = recentCropIds.map(id =>
      crops.find(crop => crop.id === id)
    ).filter(Boolean);
  }

  visible = visible.filter(crop =>
    `${crop.name} ${crop.scientific} ${crop.aliases}`
      .toLowerCase()
      .includes(query)
  );

  document.querySelectorAll(
    "[data-tab]"
  ).forEach(button => {
    const active =
      button.dataset.tab === activeTab;

    button.classList.toggle(
      "active",
      active
    );

    button.setAttribute(
      "aria-pressed",
      String(active)
    );
  });

  const list = $("cropList");
  list.replaceChildren();

  if (!visible.length) {
    paragraph(
      list,
      query
        ? "No matching crops."
        : activeTab === "saved"
          ? "Click ☆ beside a crop to save it."
          : "Crops you inspect appear here."
    );

    return;
  }

  const fragment =
    document.createDocumentFragment();

  for (const crop of visible) {
    const row = document.createElement("div");

    row.className = "crop-row";

    row.classList.toggle(
      "selected",
      selectedCrop?.id === crop.id
    );

    const inspect =
      document.createElement("button");

    inspect.className = "crop-select";
    inspect.type = "button";

    const name =
      document.createElement("span");

    name.textContent =
      `${crop.icon} ${crop.name}`;

    const scientific =
      document.createElement("small");

    scientific.textContent =
      crop.scientific;

    inspect.append(
      name,
      scientific
    );

    inspect.onclick = () => {
      selectCrop(crop);
    };

    const saved =
      savedCropIds.includes(crop.id);

    const bookmark =
      document.createElement("button");

    bookmark.className = "bookmark";
    bookmark.type = "button";

    bookmark.textContent =
      saved ? "★" : "☆";

    bookmark.setAttribute(
      "aria-label",
      `${saved ? "Unsave" : "Save"} ${crop.name}`
    );

    bookmark.onclick = () => {
      savedCropIds = saved
        ? savedCropIds.filter(id =>
            id !== crop.id
          )
        : [...savedCropIds, crop.id];

      saveCropStorage();
      renderLibrary();
    };

    row.append(
      inspect,
      bookmark
    );

    fragment.appendChild(row);
  }

  list.appendChild(fragment);
}

$("cropSearch").addEventListener(
  "input",
  renderLibrary
);

document.querySelectorAll(
  "[data-tab]"
).forEach(button => {
  button.onclick = () => {
    activeTab = button.dataset.tab;
    renderLibrary();
  };
});

// =====================================================
// CROP DETAILS
// =====================================================

function requirement(label, value) {
  return `
    <div class="requirement">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
    </div>
  `;
}

function openCrop(crop) {
  selectCrop(crop);

  $("profileName").textContent =
    crop.name;

  $("profileScientific").textContent =
    crop.scientific;

  $("profileIcon").textContent =
    crop.icon;

  $("profileContent").innerHTML = `
    <p>
      Reference conditions for
      <em>${escapeHTML(crop.scientific)}</em>.
      Species-level ranges are a starting point,
      not a field-specific growing prescription.
    </p>

    <h3>Growing conditions</h3>

    <div class="requirements">
      ${requirement(
        "Preferred temperature",
        rangeText(crop.toptmin, crop.toptmax, "°C")
      )}

      ${requirement(
        "Temperature tolerance",
        rangeText(crop.tmin, crop.tmax, "°C")
      )}

      ${requirement(
        "Preferred annual rainfall",
        rangeText(crop.roptmin, crop.roptmax, "mm/year")
      )}

      ${requirement(
        "Annual rainfall tolerance",
        rangeText(crop.rmin, crop.rmax, "mm/year")
      )}

      ${requirement(
        "Preferred soil pH",
        rangeText(crop.phoptmin, crop.phoptmax)
      )}

      ${requirement(
        "Soil pH tolerance",
        rangeText(crop.phmin, crop.phmax)
      )}
    </div>

    <h3 style="margin-top:22px">
      Soil & drainage
    </h3>

    <p>
      Recorded texture:
      ${escapeHTML(crop.texture || "Unavailable")}
      <br>
      Recorded drainage:
      ${escapeHTML(crop.drainage || "Unavailable")}
    </p>

    <h3>Growth-cycle reference</h3>

    <p>
      ${escapeHTML(
        rangeText(crop.gmin, crop.gmax, "days")
      )}.
      Interpretation differs between annual and perennial plants.
      This is not a guaranteed planting-to-harvest duration.
    </p>

    <h3>Before planting</h3>

    <ul>
      <li>
        Check the local variety and planting calendar.
      </li>
      <li>
        Check irrigation, seasonal rainfall, and extreme weather.
      </li>
      <li>
        Test soil pH, drainage, salinity, and root-zone conditions.
      </li>
      <li>
        Review pests, diseases, and previous crops with local guidance.
      </li>
    </ul>

    <h3>Database record</h3>

    <p>
      Family:
      ${escapeHTML(crop.family || "Unavailable")}
      <br>
      Category:
      ${escapeHTML(crop.category || "Unavailable")}
      <br>
      Lifespan:
      ${escapeHTML(crop.lifespan || "Unavailable")}
    </p>

    <p class="note">
      Source: FAO EcoCrop via
      <a
        href="https://github.com/OpenCLIM/ecocrop"
        target="_blank"
        rel="noopener"
      >OpenCLIM</a>.
      Record collection/update dates are not provided here.
      Missing values are not filled with guesses.
    </p>
  `;

  if (!$("cropDialog").open) {
    $("cropDialog").showModal();
  }

  $("cropDialog").scrollTop = 0;

  loadPhoto(crop);
}

$("cropDetailsButton").onclick = () => {
  if (selectedCrop) {
    openCrop(selectedCrop);
  }
};

// =====================================================
// CROP PHOTOGRAPHS
// =====================================================

let photoRequest;
let photoVersion = 0;

const photoCache = new Map();

function safeURL(value) {
  try {
    const url = new URL(value);

    return url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function creditLink(parent, label, address) {
  const url = safeURL(address);

  if (!url) return;

  const link = document.createElement("a");

  link.href = url;
  link.textContent = label;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  parent.appendChild(link);
}

function showPhoto(photo, version, crop) {
  if (
    version !== photoVersion ||
    !$("cropDialog").open
  ) return;

  const image = $("profilePhoto");

  image.onload = () => {
    if (version !== photoVersion) return;

    image.hidden = false;
    $("profileIcon").hidden = true;
  };

  image.onerror = () => {
    if (version !== photoVersion) return;

    image.hidden = true;
    $("profileIcon").hidden = false;

    $("photoCredit").textContent =
      "Photo unavailable.";
  };

  image.alt =
    `${crop.scientific} — ${photo.title}`;

  image.src = photo.url;

  const credit = $("photoCredit");
  credit.replaceChildren();

  credit.appendChild(
    document.createTextNode(
      (
        photo.verified
          ? ""
          : "Reference photo; verify identification. "
      ) +
      `Photo: ${photo.artist}. `
    )
  );

  creditLink(
    credit,
    "Source",
    photo.page
  );

  credit.appendChild(
    document.createTextNode(" · ")
  );

  creditLink(
    credit,
    photo.license || "License",
    photo.licenseURL
  );
}

async function loadPhoto(crop) {
  if (photoRequest) {
    photoRequest.abort();
  }

  const version = ++photoVersion;
  const image = $("profilePhoto");

  image.onload = null;
  image.onerror = null;
  image.removeAttribute("src");
  image.hidden = true;

  $("profileIcon").hidden = false;

  $("photoCredit").textContent =
    "Loading reference photograph…";

  if (photoCache.has(crop.scientific)) {
    showPhoto(
      photoCache.get(crop.scientific),
      version,
      crop
    );

    return;
  }

  if (crop.id === "rice") {
    const photo = {
      url:
        "https://upload.wikimedia.org/wikipedia/commons/" +
        "4/4d/Rice_plant_%28Oryza_sativa%29.jpg",

      title:
        "Rice plant (Oryza sativa)",

      artist:
        "Kalaiyarasiselvam",

      page:
        "https://commons.wikimedia.org/wiki/" +
        "File:Rice_plant_(Oryza_sativa).jpg",

      license:
        "CC BY-SA 4.0",

      licenseURL:
        "https://creativecommons.org/licenses/by-sa/4.0/",

      verified: true
    };

    photoCache.set(
      crop.scientific,
      photo
    );

    showPhoto(
      photo,
      version,
      crop
    );

    return;
  }

  const request = new AbortController();
  photoRequest = request;

  const timeout = setTimeout(() => {
    request.abort();
  }, 18000);

  try {
    const url = new URL(
      "https://commons.wikimedia.org/w/api.php"
    );

    const parameters = {
      action: "query",
      format: "json",
      origin: "*",
      generator: "search",
      gsrsearch: `"${crop.scientific}" filetype:bitmap`,
      gsrnamespace: "6",
      gsrlimit: "1",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "900"
    };

    Object.entries(parameters).forEach(([key, value]) =>
      url.searchParams.set(key, value)
    );

    const response = await fetch(url, {
      signal: request.signal
    });

    if (!response.ok) {
      throw new Error("Photo request failed");
    }

    const data = await response.json();

    const page = Object.values(
      data.query?.pages || {}
    )[0];

    const info = page?.imageinfo?.[0];

    if (!info) {
      throw new Error("No photograph");
    }

    const metadata = info.extmetadata || {};

    const photo = {
      url: safeURL(
        info.thumburl || info.url
      ),

      page: safeURL(
        info.descriptionurl
      ),

      title: String(
        page.title || ""
      ).replace(/^File:/, ""),

      artist:
        cleanText(metadata.Artist?.value) ||
        "See source",

      license:
        cleanText(metadata.LicenseShortName?.value),

      licenseURL:
        metadata.LicenseUrl?.value,

      verified: false
    };

    if (!photo.url) {
      throw new Error("Invalid photo URL");
    }

    photoCache.set(
      crop.scientific,
      photo
    );

    showPhoto(
      photo,
      version,
      crop
    );
  } catch {
    if (version === photoVersion) {
      $("photoCredit").textContent =
        "No reference photo could load. " +
        "Crop information remains available.";
    }
  } finally {
    clearTimeout(timeout);
  }
}

$("cropDialog").addEventListener(
  "close",
  () => {
    photoVersion++;

    if (photoRequest) {
      photoRequest.abort();
    }
  }
);

// =====================================================
// PREVIOUS-CROP PICKER
// =====================================================

function invalidatePlan() {
  $("rotationSummary").replaceChildren();
  $("rotationResults").replaceChildren();
}

function renderPreviousCrops() {
  const tags = $("previousCropTags");
  const matchesBox = $("previousCropMatches");

  tags.replaceChildren();
  matchesBox.replaceChildren();

  const previous = crops.filter(crop =>
    previousCropIds.has(crop.id)
  );

  for (const crop of previous) {
    const tag = document.createElement("button");

    tag.className = "tag";
    tag.type = "button";

    tag.textContent =
      `${crop.icon} ${crop.name} ×`;

    tag.setAttribute(
      "aria-label",
      `Remove ${crop.name}`
    );

    tag.onclick = () => {
      previousCropIds.delete(crop.id);
      invalidatePlan();
      renderPreviousCrops();
    };

    tags.appendChild(tag);
  }

  const query = $("previousCropSearch")
    .value
    .trim()
    .toLowerCase();

  if (!query) {
    $("previousCropHint").textContent =
      previousCropIds.size
        ? `${previousCropIds.size} previous crops selected. ` +
          "Search to add more."
        : "Search to add crops. Leave empty if crop history is unknown.";

    return;
  }

  const matches = crops.filter(crop =>
    !previousCropIds.has(crop.id) &&
    `${crop.name} ${crop.scientific} ${crop.aliases}`
      .toLowerCase()
      .includes(query)
  ).sort((a, b) =>
    Number(b.name.toLowerCase() === query) -
    Number(a.name.toLowerCase() === query) ||
    a.name.localeCompare(b.name)
  );

  $("previousCropHint").textContent =
    matches.length
      ? `${matches.length} matches. Click to add.`
      : "No matching record. Try another spelling or scientific name.";

  for (const crop of matches) {
    const button = document.createElement("button");

    button.className = "suggestion";
    button.type = "button";

    button.textContent =
      `${crop.icon} ${crop.name} — ${crop.scientific}`;

    button.onclick = () => {
      previousCropIds.add(crop.id);

      $("previousCropSearch").value = "";

      invalidatePlan();
      renderPreviousCrops();

      $("previousCropSearch").focus();
    };

    matchesBox.appendChild(button);
  }
}

$("previousCropSearch").addEventListener(
  "input",
  renderPreviousCrops
);

$("openRotation").onclick = () => {
  $("rotationLocation").textContent =
    selectedLocation
      ? `${selectedLocation.name} · ` +
        `${selectedLocation.latitude.toFixed(4)}, ` +
        `${selectedLocation.longitude.toFixed(4)}`
      : "Select a location first.";

  $("previousCropSearch").value = "";

  renderPreviousCrops();
  invalidatePlan();

  $("rotationDialog").showModal();
};

for (const id of [
  "plantingMonth",
  "waterSupply",
  "farmerPriority"
]) {
  $(id).addEventListener(
    "change",
    invalidatePlan
  );
}

// =====================================================
// NEXT-CROP EXPLORATION
// =====================================================

$("compareRotation").onclick = () => {
  invalidatePlan();

  const summary = $("rotationSummary");
  const list = $("rotationResults");

  if (!selectedLocation || !climate) {
    paragraph(
      summary,
      "Select a location and wait for NASA climate data."
    );

    return;
  }

  const month = $("plantingMonth").value;

  const previous = crops.filter(crop =>
    previousCropIds.has(crop.id)
  );

  const previousFamilies = previous.map(crop =>
    crop.family.trim().toLowerCase()
  );

  const ph =
    soilState === "loaded" &&
    Number.isFinite(soil?.phh2o)
      ? soil.phh2o
      : null;

  let missingClimate = 0;
  const candidates = [];

  for (const crop of crops) {
    if (previousCropIds.has(crop.id)) continue;

    const result = compareCrop(
      crop,
      month
    );

    const levels = [
      result.temperature.level,
      result.rainfall.level
    ];

    if (levels.includes(null)) {
      missingClimate++;
      continue;
    }

    if (levels.includes(0)) continue;

    const phResult =
      ph === null
        ? null
        : compareRange(
            ph,
            crop.phmin,
            crop.phoptmin,
            crop.phoptmax,
            crop.phmax
          );

    if (phResult?.level === 0) continue;

    const family =
      crop.family.trim().toLowerCase();

    candidates.push({
      crop,
      result,
      phResult,

      score:
        levels[0] + levels[1],

      sameFamily: Boolean(
        family &&
        previousFamilies.includes(family)
      ),

      familyComplete: Boolean(
        family &&
        previousFamilies.length &&
        previousFamilies.every(Boolean)
      )
    });
  }

  candidates.sort((a, b) =>
    b.score - a.score ||
    a.crop.name.localeCompare(b.crop.name)
  );

  paragraph(
    summary,
    `${candidates.length} candidates found. ` +
    `${missingClimate} records lacked complete valid climate ranges.`
  );

  paragraph(
    summary,
    `${month === "ANN" ? "Annual" : month} mean temperature ` +
    "+ annual rainfall. The full growing season is not assessed."
  );

  paragraph(
    summary,
    `Context: ${$("waterSupply").value}; ` +
    `priority: ${$("farmerPriority").value}. ` +
    "These choices do not change ranking yet."
  );

  paragraph(
    summary,
    "Order: climate range match, then alphabetical. " +
    "Available soil pH outside recorded limits is excluded; " +
    "missing pH compatibility stays unknown."
  );

  if (!candidates.length) {
    paragraph(
      list,
      "No alternatives passed this limited screen. " +
      "This does not mean no crops can grow here."
    );
  }

  for (const item of candidates) {
    const card = document.createElement("section");
    card.className = "metric-card";

    const heading = document.createElement("h3");

    heading.textContent =
      `${item.crop.icon} ${item.crop.name}`;

    card.appendChild(heading);

    paragraph(
      card,
      `Temperature: ${item.result.temperature.label}.`,
      item.result.temperature.className
    );

    paragraph(
      card,
      `Annual rainfall: ${item.result.rainfall.label}.`,
      item.result.rainfall.className
    );

    paragraph(
      card,
      ph === null
        ? "Soil pH: location estimate unavailable; not checked."
        : item.phResult.level === null
          ? "Soil pH: crop reference missing or needs review."
          : `Estimated soil pH: ${item.phResult.label}.`
    );

    if (!previous.length) {
      paragraph(
        card,
        "Previous crop unknown; rotation relationship not checked."
      );
    } else if (item.sameFamily) {
      paragraph(
        card,
        "Same recorded family as at least one previous crop. " +
        "Review shared pests and diseases with local guidance.",
        "warning"
      );
    } else if (!item.familyComplete) {
      paragraph(
        card,
        "Family records incomplete; rotation relationship needs review."
      );
    } else {
      paragraph(
        card,
        "Different recorded family from the selected previous crops. " +
        "This alone does not establish a suitable rotation."
      );
    }

    const inspect =
      document.createElement("button");

    inspect.type = "button";
    inspect.textContent = "Inspect this crop ↗";

    inspect.onclick = () => {
      $("rotationDialog").close();
      openCrop(item.crop);
    };

    card.appendChild(inspect);
    list.appendChild(card);
  }

  list.scrollTop = 0;
};

// =====================================================
// LOCAL CULTIVATION: MAPSPAM 2020
// =====================================================

let localTimer;
let localVersion = 0;
let localImagePromise;
let localRecords = null;

const localCache = new Map();

const localSpecies = {
  whea: ["Triticum aestivum"],
  rice: ["Oryza sativa"],
  maiz: ["Zea mays"],
  barl: ["Hordeum vulgare"],
  pmil: ["Pennisetum glaucum", "Cenchrus americanus"],
  sorg: ["Sorghum bicolor"],
  pota: ["Solanum tuberosum"],
  swpo: ["Ipomoea batatas"],
  cass: ["Manihot esculenta"],
  chic: ["Cicer arietinum"],
  cowp: ["Vigna unguiculata"],
  pige: ["Cajanus cajan"],
  lent: ["Lens culinaris"],
  soyb: ["Glycine max"],
  grou: ["Arachis hypogaea"],
  cnut: ["Cocos nucifera"],
  oilp: ["Elaeis guineensis"],
  sunf: ["Helianthus annuus"],
  sesa: ["Sesamum indicum"],
  sugc: ["Saccharum officinarum"],
  sugb: ["Beta vulgaris"],
  coff: ["Coffea arabica"],
  rcof: ["Coffea canephora"],
  coco: ["Theobroma cacao"],
  teas: ["Camellia sinensis"],
  toma: [
    "Solanum lycopersicum",
    "Lycopersicon esculentum"
  ],
  onio: ["Allium cepa"],
  rubb: ["Hevea brasiliensis"]
};

function loadGeoTIFF() {
  if (window.GeoTIFF) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script =
      document.createElement("script");

    script.src =
      "https://cdn.jsdelivr.net/npm/" +
      "geotiff@3.0.4/dist-browser/geotiff.js";

    script.onload = () => {
      if (window.GeoTIFF) {
        resolve();
      } else {
        reject(
          new Error("Map reader did not initialize")
        );
      }
    };

    script.onerror = () => {
      script.remove();

      reject(
        new Error("Could not load map reader")
      );
    };

    document.head.appendChild(script);
  });
}

async function getLocalImage() {
  if (!localImagePromise) {
    localImagePromise = (async () => {
      await loadGeoTIFF();

      const tiff = await GeoTIFF.fromUrl(
        "https://digital-atlas.s3.amazonaws.com/cdh/data/" +
        "mapspam2020-v2r2/cog/spam2020-harvested_area-all.tif",
        {
          allowFullFile: false,
          cacheSize: 50
        }
      );

      const image = await tiff.getImage();

      if (
        image.getGeoKeys().GeographicTypeGeoKey !== 4326
      ) {
        throw new Error(
          "Unexpected crop-map projection"
        );
      }

      const metadata = [];

      // Sequential reads preserve the band descriptions.
      for (
        let index = 0;
        index < image.getSamplesPerPixel();
        index++
      ) {
        metadata.push(
          await image.getGDALMetadata(index)
        );
      }

      if (
        !metadata.every(item =>
          item?.DESCRIPTION &&
          String(item.UNITTYPE).toLowerCase() === "ha"
        )
      ) {
        throw new Error(
          "Missing crop codes or unexpected units"
        );
      }

      return {
        image,
        metadata
      };
    })().catch(error => {
      localImagePromise = null;
      throw error;
    });
  }

  return localImagePromise;
}

function scheduleLocalCrops() {
  clearTimeout(localTimer);

  const version = ++localVersion;
  const location = selectedLocation;

  localRecords = null;

  $("localCropList").replaceChildren();

  $("retryLocalCrops").hidden = true;

  $("localCropStatus").textContent =
    "Loading cultivation estimates… " +
    "The first lookup may take a while.";

  localTimer = setTimeout(async () => {
    try {
      const {
        image,
        metadata
      } = await getLocalImage();

      if (version !== localVersion) return;

      const origin = image.getOrigin();
      const resolution = image.getResolution();

      const x = Math.floor(
        (location.longitude - origin[0]) /
        resolution[0]
      );

      const y = Math.floor(
        (location.latitude - origin[1]) /
        resolution[1]
      );

      if (
        x < 0 ||
        y < 0 ||
        x >= image.getWidth() ||
        y >= image.getHeight()
      ) {
        throw new Error(
          "Outside cultivation map"
        );
      }

      const key = `${x},${y}`;

      if (localCache.has(key)) {
        localRecords = localCache.get(key);
      } else {
        const values = await image.readRasters({
          window: [
            x,
            y,
            x + 1,
            y + 1
          ]
        });

        if (version !== localVersion) return;

        localRecords = metadata.map(
          (item, index) => ({
            code: String(
              item.DESCRIPTION
            ).trim().toLowerCase(),

            name: String(
              item.long_name ||
              item.DESCRIPTION
            ),

            area: Number(
              values[index][0]
            )
          })
        ).filter(item =>
          Number.isFinite(item.area) &&
          item.area > 0
        ).sort((a, b) =>
          b.area - a.area
        );

        localCache.set(
          key,
          localRecords
        );
      }

      renderLocalCrops(localRecords);
    } catch (error) {
      if (version !== localVersion) return;

      $("localCropStatus").textContent =
        "Cultivation data unavailable. " +
        "No local-popularity ranking assigned.";

      $("retryLocalCrops").hidden = false;

      console.error(
        "Local cultivation:",
        error
      );
    }
  }, 800);
}

function renderLocalCrops(records) {
  const list = $("localCropList");
  list.replaceChildren();

  if (!records.length) {
    $("localCropStatus").textContent =
      "No positive harvested-area estimates returned for this cell. " +
      "Missing values do not prove that crops are absent.";

    return;
  }

  $("localCropStatus").textContent =
    `${records.length} crop categories with positive estimates. ` +
    "★ marks the five largest among available categories.";

  records.forEach((record, index) => {
    const species =
      localSpecies[record.code] || [];

    const crop = crops.find(item =>
      species.includes(item.scientific)
    );

    const card =
      document.createElement("section");

    card.className = "metric-card";

    const heading =
      document.createElement("h3");

    heading.textContent =
      `${index < 5 ? "★ " : ""}${record.name}`;

    card.appendChild(heading);

    paragraph(
      card,
      "Estimated harvested area: " +
      `${formatValue(record.area, "ha", 1)} · 2020`
    );

    if (crop && climate) {
      const result = compareCrop(crop);

      const levels = [
        result.temperature.level,
        result.rainfall.level
      ];

      paragraph(
        card,
        levels.includes(0)
          ? "⚠ Current climate screen flags a reference-range limit. " +
            "Cultivation does not guarantee suitability."
          : levels.includes(null)
            ? "Climate compatibility is not fully assessed."
            : "Both climate values pass the current tolerance screen. " +
              "Soil, season, and irrigation still matter."
      );
    } else {
      paragraph(
        card,
        "Not assessed against a specific crop record."
      );
    }

    if (crop) {
      const inspect =
        document.createElement("button");

      inspect.type = "button";
      inspect.textContent = "Inspect this crop ↗";

      inspect.onclick = () => {
        openCrop(crop);
      };

      card.appendChild(inspect);
    }

    list.appendChild(card);
  });
}

$("retryLocalCrops").onclick = () => {
  if (selectedLocation) {
    scheduleLocalCrops();
  }
};

// =====================================================
// RIGHT-CLICK CAMERA CONTROLS
// =====================================================

(() => {
  let drag = null;

  const ROTATE_SPEED = 0.18;
  const TILT_SPEED = 0.14;

  function isOnMap(event) {
    return map &&
      event.composedPath().includes(map);
  }

  function endDrag() {
    if (!drag) return;

    const previous = drag;
    drag = null;

    previous.map.gestureHandling =
      previous.gestures;

    previous.map.style.cursor =
      previous.cursor;

    try {
      previous.map.releasePointerCapture(
        previous.pointerId
      );
    } catch {}

    const tilted =
      previous.map.tilt > 5;

    $("tiltButton").classList.toggle(
      "active",
      tilted
    );

    $("tiltButton").setAttribute(
      "aria-pressed",
      String(tilted)
    );
  }

  window.addEventListener(
    "contextmenu",
    event => {
      if (isOnMap(event)) {
        event.preventDefault();
      }
    },
    true
  );

  window.addEventListener(
    "pointerdown",
    event => {
      if (
        event.button !== 2 ||
        !isOnMap(event)
      ) return;

      endDrag();

      drag = {
        map,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        gestures:
          map.gestureHandling || "GREEDY",
        cursor:
          map.style.cursor
      };

      map.gestureHandling = "NONE";
      map.style.cursor = "grabbing";

      map.stopCameraAnimation?.();

      try {
        map.setPointerCapture(
          event.pointerId
        );
      } catch {}

      event.preventDefault();
      event.stopImmediatePropagation();
    },
    {
      capture: true,
      passive: false
    }
  );

  window.addEventListener(
    "pointermove",
    event => {
      if (
        !drag ||
        event.pointerId !== drag.pointerId
      ) return;

      if (!(event.buttons & 2)) {
        endDrag();
        return;
      }

      const dx =
        event.clientX - drag.x;

      const dy =
        event.clientY - drag.y;

      drag.x = event.clientX;
      drag.y = event.clientY;

      const camera = drag.map;

      camera.heading =
        (
          (
            Number(camera.heading || 0) -
            dx * ROTATE_SPEED
          ) % 360 + 360
        ) % 360;

      camera.tilt = Math.max(
        0,
        Math.min(
          80,
          Number(camera.tilt || 0) -
          dy * TILT_SPEED
        )
      );

      camera.roll = 0;

      event.preventDefault();
      event.stopImmediatePropagation();
    },
    {
      capture: true,
      passive: false
    }
  );

  window.addEventListener(
    "pointerup",
    event => {
      if (
        !drag ||
        event.pointerId !== drag.pointerId
      ) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      endDrag();
    },
    {
      capture: true,
      passive: false
    }
  );

  window.addEventListener(
    "pointercancel",
    endDrag,
    true
  );

  window.addEventListener(
    "blur",
    endDrag
  );
})();

// =====================================================
// START
// =====================================================

renderLibrary();
renderSavedPlaces();
renderPreviousCrops();
renderAssessment();

loadCatalog();

if (GOOGLE_MAPS_API_KEY.trim()) {
  initializeMap(
    GOOGLE_MAPS_API_KEY.trim()
  );
}
// =====================================================
// SIMPLER WORDING
// Changes the wording, not the calculations.
// =====================================================

(() => {
  if (window.cropAtlasSimpleWords) return;
  window.cropAtlasSimpleWords = true;

  // Keep the original comparison rules.
  const originalCompareRange = compareRange;

  compareRange = function (...values) {
    const result = originalCompareRange(...values);

    const labels = {
      "Not enough data":
        "No data to compare",

      "Reference range needs review":
        "Crop data needs checking",

      "Below recorded range":
        "Below the crop’s listed range",

      "Above recorded range":
        "Above the crop’s listed range",

      "Within preferred range":
        "In the crop’s preferred range",

      "Within tolerance; outside preferred range":
        "Within listed limits, but outside its preferred range"
    };

    return {
      ...result,
      label: labels[result.label] || result.label
    };
  };

  // Shorter cards, with detailed ranges available on demand.
  metricCard = function (
    title,
    value,
    result,
    preferred,
    tolerance
  ) {
    const simplerTitle = title
      .replace(
        "🌡️ Average temperature · annual",
        "🌡️ Average temperature"
      )
      .replace(
        "🌧️ Rainfall · annual total",
        "🌧️ Rainfall per year"
      )
      .replace(
        "🪨 Estimated soil pH · in water",
        "🪨 Soil pH · estimate"
      );

    const symbol = !result
      ? ""
      : result.level === 2
        ? "✓"
        : result.level === null
          ? "?"
          : "!";

    return `
      <section class="metric-card">
        <div class="metric-title">
          ${escapeHTML(simplerTitle)}
        </div>

        <div class="metric-value">
          ${escapeHTML(value)}
        </div>

        ${result ? `
          <div class="metric-status ${result.className}">
            ${symbol} ${escapeHTML(result.label)}
          </div>

          <details>
            <summary>More details</summary>

            <div class="metric-range">
              Preferred range:
              ${escapeHTML(preferred)}
              <br>
              Listed limits:
              ${escapeHTML(tolerance)}
            </div>
          </details>
        ` : ""}
      </section>
    `;
  };

  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function simplifyText(parent, replacements) {
    if (!parent) return;

    const walker = document.createTreeWalker(
      parent,
      NodeFilter.SHOW_TEXT
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      let text = node.textContent;

      for (const [before, after] of replacements) {
        text = text.split(before).join(after);
      }

      node.textContent = text;
    }
  }

  // Clearer comparison messages.
  const originalAssessment = renderAssessment;

  renderAssessment = function () {
    originalAssessment();

    simplifyText(
      document.getElementById("climateMatch"),
      [
        ["Choose a location", "Choose a place"],
        ["Loading climate data…", "Checking the climate…"],
        ["Climate data unavailable", "Climate data could not load"],
        ["Climate loaded · choose a crop", "Choose a crop to compare"],
        ["⚠ Climate limits to check", "⚠ Some conditions need checking"],
        ["? More data needed", "? Not enough data"],
        ["✓ Both within preferred ranges", "✓ Temperature and rain match preferred ranges"],
        ["! Within tolerance ranges", "! Within listed limits, but not both preferred"]
      ]
    );

    const note = document.querySelector("#assessment > .note");

    if (note) {
      note.textContent =
        "This checks temperature and rain. " +
        "Soil, water supply, planting season and crop variety " +
        "also affect what grows well.";
    }
  };

  // Clearer crop suggestion descriptions.
  const originalRecommendations = renderRecommendations;

  renderRecommendations = function () {
    originalRecommendations();

    simplifyText(
      document.getElementById("recommendationStatus"),
      [
        ["climate-range matches", "crops to explore"],
        [
          "Ordered by range match, then alphabetically.",
          "Closer climate matches appear first."
        ],
        [
          "Using starter records while the catalog loads.",
          "More crops appear when the full list loads."
        ],
        [
          "Suggestions appear when climate data loads.",
          "Choose a place and wait for its climate data."
        ]
      ]
    );

    simplifyText(
      document.getElementById("recommendations"),
      [
        [
          "✓ Both climate values within preferred ranges",
          "✓ Temperature and rain match preferred ranges"
        ],
        [
          "Both within tolerance; at least one outside preferred range",
          "Within listed limits, but not both preferred"
        ],
        [
          "No crops with complete valid ranges passed this screen. " +
          "This does not mean no crops can grow here.",
          "No matches found with the available data. " +
          "Other crops may still grow here."
        ]
      ]
    );
  };

  // Simpler soil descriptions.
  const originalSoil = renderSoil;

  renderSoil = function () {
    originalSoil();

    simplifyText(
      document.getElementById("soilAssessment"),
      [
        ["Select a location.", "Choose a place."],
        [
          "Loading mapped soil estimates…",
          "Loading soil information…"
        ],
        [
          "Estimated soil composition",
          "Sand, silt and clay"
        ],
        [
          "Only pH is compared automatically here.",
          "Only soil pH is checked against the crop here."
        ],
        [
          "No mapped soil values were returned. Some cities, " +
          "water bodies, and other areas have no estimates.",
          "No soil data is available for this point. " +
          "Try a nearby point on land."
        ]
      ]
    );
  };

  // Simpler section names.
  const headingChanges = new Map([
    ["Other climate matches", "Crops to explore here"],
    ["Crops with climate matches", "Crops to explore here"],
    ["★ Crops grown nearby", "★ Crops grown in this region"],
    ["Monthly climate averages", "Typical weather by month"],
    ["Sources & limitations", "About this data"],
    ["Data sources & what results mean", "About this data"],
    ["🪨 Soil at this location", "🪨 Soil at this place"],
    ["Soil estimates at this point", "Soil at this place"]
  ]);

  document.querySelectorAll(
    ".inspector h2, .inspector h3, .inspector summary"
  ).forEach(element => {
    const replacement = headingChanges.get(
      element.textContent.trim()
    );

    if (replacement) element.textContent = replacement;
  });

  setText("cropDetailsButton", "Learn about this crop ↗");
  setText("openRotation", "What could I grow next?");
  setText("compareRotation", "Show crops to consider");

  const rotationHeading = document.querySelector(
    "#rotationDialog .dialog-top h2"
  );

  if (rotationHeading) {
    rotationHeading.textContent = "What could I grow next?";
  }

  const cropSearch = document.getElementById("cropSearch");

  if (cropSearch) {
    cropSearch.placeholder = "Find a crop…";
  }

  const previousSearch = document.getElementById(
    "previousCropSearch"
  );

  if (previousSearch) {
    previousSearch.placeholder = "What did you grow before?";
  }

  const temperatureLabel = document.querySelector(
    'label[for="climateMonth"]'
  );

  if (temperatureLabel) {
    temperatureLabel.textContent = "Which month?";
  }

  const plantingLabel = document.querySelector(
    'label[for="plantingMonth"]'
  );

  if (plantingLabel) {
    plantingLabel.textContent = "When do you want to plant?";
  }

  // Apply the new wording to results already on screen.
  refreshComparisons();
})();