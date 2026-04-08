/**
 * Far & Fair — Google Geocoding (course proxy) + Frankfurter + localStorage
 */

/** Course proxy: `?address=` forward geocode, `?latlng=` reverse geocode. */
const GEOCODE_BASE = "https://cse2004.com/api/geocode";
/* api.frankfurter.dev — v1/currencies is ~30 codes; v2/currencies lists all supported currencies. */
const FRANKFURTER_CURRENCIES = "https://api.frankfurter.dev/v2/currencies";
const FRANKFURTER_RATES = "https://api.frankfurter.dev/v2/rates";

const STORAGE_KEY = "farAndFair:v1";

/** @type {{ home: { lat: number; lon: number; label: string } | null; saved: Array<{ id: string; name: string; lat: number; lon: number; country?: string }>; fromCurrency: string; toCurrency: string; amount: string }} */
const defaultState = () => ({
  home: null,
  saved: [],
  fromCurrency: "USD",
  toCurrency: "EUR",
  amount: "100",
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed,
      saved: Array.isArray(parsed.saved) ? parsed.saved : [],
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    setLocationStatus(
      "Could not save to local storage (private mode or quota). Your session still works.",
      false
    );
  }
}

let state = loadState();

// --- DOM ---
const el = {
  btnUseLocation: document.getElementById("btn-use-location"),
  locationStatus: document.getElementById("location-status"),
  formHomeCity: document.getElementById("form-home-city"),
  inputHomeCity: document.getElementById("input-home-city"),
  coordsReadout: document.getElementById("coords-readout"),
  formDestination: document.getElementById("form-destination"),
  inputDestination: document.getElementById("input-destination"),
  destinationError: document.getElementById("destination-error"),
  distanceResult: document.getElementById("distance-result"),
  distanceValue: document.getElementById("distance-value"),
  distanceSub: document.getElementById("distance-sub"),
  btnSavePlace: document.getElementById("btn-save-place"),
  formCurrency: document.getElementById("form-currency"),
  selectFrom: document.getElementById("select-from"),
  selectTo: document.getElementById("select-to"),
  inputAmount: document.getElementById("input-amount"),
  currencyError: document.getElementById("currency-error"),
  currencyResult: document.getElementById("currency-result"),
  currencyValue: document.getElementById("currency-value"),
  currencySub: document.getElementById("currency-sub"),
  savedList: document.getElementById("saved-list"),
  emptySaved: document.getElementById("empty-saved"),
};

/** @type {{ name: string; lat: number; lon: number; country?: string } | null} */
let lastDestination = null;

function setLocationStatus(message, isError) {
  el.locationStatus.textContent = message;
  el.locationStatus.classList.toggle("status--error", Boolean(isError));
}

function hideDestinationError() {
  el.destinationError.hidden = true;
  el.destinationError.textContent = "";
}

function showDestinationError(msg) {
  el.destinationError.hidden = false;
  el.destinationError.textContent = msg;
}

function hideCurrencyError() {
  el.currencyError.hidden = true;
  el.currencyError.textContent = "";
  el.currencyError.classList.remove("status--error");
}

function showCurrencyError(msg) {
  el.currencyError.hidden = false;
  el.currencyError.textContent = msg;
  el.currencyError.classList.add("status--error");
}

/**
 * @param {object} result One item from Google Geocoding `results[]`
 * @returns {{ name: string; lat: number; lon: number; country: string } | null}
 */
function parseGoogleGeocodeResult(result) {
  if (!result || !result.geometry || !result.geometry.location) return null;
  const loc = result.geometry.location;
  const lat = typeof loc.lat === "function" ? loc.lat() : Number(loc.lat);
  const lng = typeof loc.lng === "function" ? loc.lng() : Number(loc.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  let country = "";
  const comps = result.address_components;
  if (Array.isArray(comps)) {
    for (const c of comps) {
      if (c.types && c.types.includes("country")) {
        country = c.long_name || "";
        break;
      }
    }
  }
  const name = result.formatted_address || country || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  return { name, lat, lon: lng, country };
}

/**
 * Build a short "City, ST" (or similar) label from Google `address_components`.
 * @param {object} result One Geocoder `results[]` item
 * @returns {string}
 */
function extractCityLabelFromGoogleResult(result) {
  if (!result || !Array.isArray(result.address_components)) {
    return "";
  }
  let locality = "";
  let postalTown = "";
  let admin1 = "";
  let admin2 = "";
  for (const c of result.address_components) {
    const types = c.types || [];
    if (types.includes("locality")) locality = c.long_name || "";
    if (types.includes("postal_town")) postalTown = c.long_name || "";
    if (types.includes("sublocality") || types.includes("sublocality_level_1")) {
      if (!locality) locality = c.long_name || "";
    }
    if (types.includes("administrative_area_level_1")) admin1 = c.short_name || c.long_name || "";
    if (types.includes("administrative_area_level_2")) admin2 = c.long_name || "";
  }
  const city = locality || postalTown || "";
  if (city && admin1) return `${city}, ${admin1}`;
  if (city) return city;
  if (admin2 && admin1) return `${admin2}, ${admin1}`;
  if (result.formatted_address) {
    const parts = result.formatted_address.split(",");
    if (parts.length >= 2) {
      return `${parts[0].trim()}, ${parts[1].trim()}`;
    }
    return parts[0].trim();
  }
  return "";
}

/**
 * Reverse geocode coordinates via the same course proxy (`latlng=`).
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<object | null>} Raw first `results[]` item, or null
 */
async function reverseGeocode(lat, lon) {
  const url = new URL(GEOCODE_BASE);
  url.searchParams.set("latlng", `${lat},${lon}`);
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }
    if (data.status && data.status !== "OK") {
      return null;
    }
    return data.results[0];
  } catch {
    return null;
  }
}

/**
 * Forward geocode via course Google Geocoding proxy.
 * @param {string} query
 * @returns {Promise<{ name: string; lat: number; lon: number; country: string } | null>}
 */
async function geocode(query) {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const url = new URL(GEOCODE_BASE);
  url.searchParams.set("address", trimmed);
  let res;
  try {
    res = await fetch(url.toString());
  } catch {
    throw new Error("Network error while looking up that place. Check your connection.");
  }
  if (!res.ok) {
    throw new Error("Geocoding service returned an error. Try again in a moment.");
  }
  const data = await res.json();
  if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
    return null;
  }
  if (data.status && data.status !== "OK") {
    if (data.status === "ZERO_RESULTS") return null;
    throw new Error(data.error_message || `Geocoding failed (${data.status}).`);
  }
  return parseGoogleGeocodeResult(data.results[0]);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function kmToMi(km) {
  return km * 0.621371;
}

/**
 * Show distance using known coordinates (after geocoding or loading a saved place).
 * @param {{ name: string; lat: number; lon: number; country?: string }} place
 */
function applyDestinationResult(place) {
  if (!state.home) {
    showDestinationError("Set your position first (location button or your city).");
    return;
  }
  const km = haversineKm(state.home.lat, state.home.lon, place.lat, place.lon);
  const mi = kmToMi(km);
  lastDestination = place;
  el.distanceValue.textContent = `${km.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })} km · ${mi.toLocaleString(undefined, { maximumFractionDigits: 0 })} mi`;
  el.distanceSub.textContent = place.name;
  el.distanceResult.hidden = false;
  hideDestinationError();
}

function updateCoordsReadout() {
  if (!state.home) {
    el.coordsReadout.hidden = true;
    el.coordsReadout.textContent = "";
    return;
  }
  el.coordsReadout.hidden = false;
  el.coordsReadout.textContent = `Home: ${state.home.label} · ${state.home.lat.toFixed(
    4
  )}°, ${state.home.lon.toFixed(4)}°`;
}

function applyHomeFromGeocode(place) {
  state.home = { lat: place.lat, lon: place.lon, label: place.name };
  saveState(state);
  updateCoordsReadout();
  setLocationStatus("Home position set. You can measure distance to any city.", false);
}

el.btnUseLocation.addEventListener("click", () => {
  setLocationStatus("Requesting location…", false);
  if (!navigator.geolocation) {
    setLocationStatus(
      "This browser does not support geolocation. Use “your city” below instead.",
      true
    );
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      state.home = {
        lat,
        lon,
        label: `${lat.toFixed(3)}°, ${lon.toFixed(3)}° (from device)`,
      };
      saveState(state);
      updateCoordsReadout();
      setLocationStatus("Finding your city…", false);
      void (async () => {
        const raw = await reverseGeocode(lat, lon);
        const cityLabel = raw ? extractCityLabelFromGoogleResult(raw) : "";
        if (cityLabel) {
          el.inputHomeCity.value = cityLabel;
          state.home.label = `${cityLabel} (from device)`;
          saveState(state);
          updateCoordsReadout();
        }
        setLocationStatus(
          "Location saved for this session. Measuring distance uses these coordinates.",
          false
        );
      })();
    },
    (err) => {
      const messages = {
        1: "Location access was denied. Enter your city below — we only use it to compute distance.",
        2: "Position unavailable. Try again or enter your city below.",
        3: "Location request timed out. Try again or enter your city below.",
      };
      setLocationStatus(messages[err.code] || "Could not read location. Enter your city below.", true);
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 }
  );
});

el.formHomeCity.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = el.inputHomeCity.value;
  setLocationStatus("Looking up your city…", false);
  try {
    const place = await geocode(q);
    if (!place) {
      setLocationStatus("No match for that city. Check spelling or try a larger nearby city.", true);
      return;
    }
    applyHomeFromGeocode(place);
    el.inputHomeCity.value = "";
  } catch (err) {
    setLocationStatus(err instanceof Error ? err.message : "Something went wrong.", true);
  }
});

el.formDestination.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideDestinationError();
  el.distanceResult.hidden = true;
  lastDestination = null;

  if (!state.home) {
    showDestinationError("Set your position first (location button or your city).");
    return;
  }

  const q = el.inputDestination.value;
  if (!q.trim()) {
    showDestinationError("Enter a city or place name.");
    return;
  }

  try {
    const place = await geocode(q);
    if (!place) {
      showDestinationError("No results for that search. Try another spelling or name.");
      return;
    }
    applyDestinationResult(place);
  } catch (err) {
    showDestinationError(err instanceof Error ? err.message : "Could not look up that place.");
  }
});

el.btnSavePlace.addEventListener("click", () => {
  if (!lastDestination) return;
  const id = `${lastDestination.lat.toFixed(4)}_${lastDestination.lon.toFixed(4)}`;
  const exists = state.saved.some((s) => s.id === id);
  if (exists) {
    setLocationStatus("That place is already in your saved list.", false);
    return;
  }
  state.saved.push({
    id,
    name: lastDestination.name,
    lat: lastDestination.lat,
    lon: lastDestination.lon,
    country: lastDestination.country,
  });
  saveState(state);
  renderSavedList();
  setLocationStatus("Saved to this browser.", false);
});

function renderSavedList() {
  el.savedList.innerHTML = "";
  el.emptySaved.hidden = state.saved.length > 0;
  for (const s of state.saved) {
    const li = document.createElement("li");
    const left = document.createElement("div");
    left.className = "saved-place";
    const nameEl = document.createElement("span");
    nameEl.className = "place-name";
    nameEl.textContent = s.name;
    const meta = document.createElement("div");
    meta.className = "place-meta";
    meta.textContent = `${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°`;
    left.append(nameEl, meta);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn--remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      state.saved = state.saved.filter((x) => x.id !== s.id);
      saveState(state);
      renderSavedList();
    });
    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "btn";
    useBtn.textContent = "Load";
    useBtn.addEventListener("click", () => {
      hideDestinationError();
      el.distanceResult.hidden = true;
      lastDestination = null;
      el.inputDestination.value = s.name;
      const place = {
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        country: s.country,
      };
      applyDestinationResult(place);
    });
    const actions = document.createElement("div");
    actions.className = "saved-actions";
    actions.append(useBtn, removeBtn);
    li.append(left, actions);
    el.savedList.append(li);
  }
}

function fillCurrencySelects(data) {
  const codes = Object.keys(data).sort();
  el.selectFrom.innerHTML = "";
  el.selectTo.innerHTML = "";
  for (const code of codes) {
    const name = data[code];
    const label = `${code} (${name})`;
    const o1 = document.createElement("option");
    o1.value = code;
    o1.textContent = label;
    o1.title = name;
    el.selectFrom.append(o1);
    const o2 = document.createElement("option");
    o2.value = code;
    o2.textContent = label;
    o2.title = name;
    el.selectTo.append(o2);
  }
  if (codes.includes(state.fromCurrency)) el.selectFrom.value = state.fromCurrency;
  if (codes.includes(state.toCurrency)) el.selectTo.value = state.toCurrency;
}

async function loadCurrencies() {
  el.selectFrom.innerHTML = "";
  el.selectTo.innerHTML = "";
  let res;
  try {
    res = await fetch(FRANKFURTER_CURRENCIES);
  } catch {
    showCurrencyError(
      "Could not load currencies. Check your network connection and try refreshing the page."
    );
    return;
  }
  if (!res.ok) {
    showCurrencyError(
      "The exchange-rate service did not respond. Try again in a few minutes or refresh the page."
    );
    return;
  }
  let data;
  try {
    data = await res.json();
  } catch {
    showCurrencyError("Received an invalid response from the exchange-rate service. Try refreshing.");
    return;
  }
  /** v2 returns `[{ iso_code, name, ... }, ...]`; v1 was `{ USD: "..." }`. */
  let map = null;
  if (Array.isArray(data)) {
    map = {};
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const code = row.iso_code;
      const name = row.name;
      if (typeof code === "string" && /^[A-Z]{3}$/.test(code) && typeof name === "string") {
        map[code] = name;
      }
    }
  } else if (data && typeof data === "object" && !Array.isArray(data)) {
    map = {};
    for (const k of Object.keys(data)) {
      if (/^[A-Z]{3}$/.test(k) && typeof data[k] === "string") {
        map[k] = data[k];
      }
    }
  }
  if (!map || Object.keys(map).length === 0) {
    showCurrencyError(
      "The exchange-rate service returned an error instead of a currency list. Try again later."
    );
    return;
  }
  fillCurrencySelects(map);
  hideCurrencyError();
}

el.formCurrency.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideCurrencyError();
  el.currencyResult.hidden = true;

  if (el.selectFrom.options.length === 0) {
    showCurrencyError(
      "Currencies are not loaded yet or the list failed to load. Fix the error above or refresh the page."
    );
    return;
  }

  const from = el.selectFrom.value;
  const to = el.selectTo.value;
  const amount = parseFloat(el.inputAmount.value, 10);

  state.fromCurrency = from;
  state.toCurrency = to;
  state.amount = el.inputAmount.value;
  saveState(state);

  if (from === to) {
    el.currencyValue.textContent = `${amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${to}`;
    el.currencySub.textContent = "Same currency — no conversion needed.";
    el.currencyResult.hidden = false;
    return;
  }

  if (Number.isNaN(amount) || amount < 0) {
    showCurrencyError("Enter a valid non-negative amount.");
    return;
  }

  const url = new URL(FRANKFURTER_RATES);
  url.searchParams.set("base", from);
  url.searchParams.set("quotes", to);

  let res;
  try {
    res = await fetch(url.toString());
  } catch {
    showCurrencyError("Network error. Check your connection and try again.");
    return;
  }
  if (!res.ok) {
    showCurrencyError("Could not fetch rates. The service may be busy — try again.");
    return;
  }
  const payload = await res.json();
  const rows = Array.isArray(payload) ? payload : [];
  const row = rows.find((r) => r && r.quote === to) || rows[0];
  const rate = row && typeof row.rate === "number" ? row.rate : null;
  if (rate == null) {
    showCurrencyError("No rate returned for that pair. Pick another currency.");
    return;
  }
  const converted = amount * rate;
  el.currencyValue.textContent = `${converted.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${to}`;
  const date = row.date || "";
  el.currencySub.textContent = `1 ${from} = ${rate} ${to}${date ? ` (${date})` : ""}`;
  el.currencyResult.hidden = false;
});

function init() {
  el.inputAmount.value = state.amount || "100";
  updateCoordsReadout();
  if (state.home) {
    setLocationStatus("Loaded your saved home position from this browser.", false);
  }
  renderSavedList();
  loadCurrencies();
}

init();
