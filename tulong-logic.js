import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ============================================================
// FIREBASE AUTH
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyDtYoKpqYE8MDc1dbZANQWwLxpp-heTBr8",
    authDomain: "tulongtech-7de22.firebaseapp.com",
    projectId: "tulongtech-7de22",
    storageBucket: "tulongtech-7de22.firebasestorage.app",
    messagingSenderId: "924023247315",
    appId: "1:924023247315:web:45f4d22dc0e6c8436f1f26",
    measurementId: "G-9MZ3JX8J7N"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
window.firebaseSignOut = () => signOut(auth);
onAuthStateChanged(auth, (user) => {
    if (!user) window.location.href = 'login.html';
});

// ============================================================
// BLYNK CONFIGURATION
// ============================================================
const BLYNK_SERVER = "https://blynk.cloud/external/api";

const BLYNK_DEVICES = {
    "A-001": {
        token: "HKEGX3vYVEzqoEv5plTw5tU-7ITdnmlJ",
        type: "ambulance",
        label: "AMBULANCE A-001",
        gpsPin: "V7",     // Virtual pin for GPS (lat,lng string or separate pins)
        latPin: "V1",     // Latitude pin
        lngPin: "V2",     // Longitude pin
        statusPin: "V3",  // Status pin (0=STANDBY, 1=RESPONDING, 2=ARRIVED)
        color: "#4da3ff"
    },
    "F-001": {
        token: "DQ8eqlsc7wjL4A7M540oteHKRw-HWBYS",
        type: "truck",
        label: "FIRETRUCK F-001",
        gpsPin: "V7",
        latPin: "V1",
        lngPin: "V2",
        statusPin: "V3",
        color: "#ff4d4d"
    }
};

// Status definitions
const UNIT_STATUSES = {
    STANDBY: { label: "STANDBY", color: "#00c853", bg: "rgba(0,200,83,0.15)", border: "#00c853", value: "0" },
    RESPONDING: { label: "RESPONDING", color: "#ff9800", bg: "rgba(255,152,0,0.15)", border: "#ff9800", value: "1" },
    ARRIVED: { label: "ARRIVED (10-23)", color: "#ff4d4d", bg: "rgba(255,77,77,0.15)", border: "#ff4d4d", value: "2" }
};

// ============================================================
// MAP INITIALIZATION
// ============================================================
const map = L.map('map').setView([10.3157, 123.8854], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

const cebuBounds = L.latLngBounds([9.390, 123.230], [11.350, 124.150]);

const geocoder = L.Control.geocoder({
    defaultMarkGeocode: false,
    placeholder: "Search Cebu/Mactan streets...",
    errorMessage: "Location not found in service area.",
    geocoder: L.Control.Geocoder.nominatim({
        geocodingQueryParams: { viewbox: '123.230,9.390,124.150,11.350', bounded: 1 }
    })
}).on('markgeocode', function(e) {
    const center = e.geocode.center;
    if (cebuBounds.contains(center)) {
        map.flyTo(center, 18);
        const searchMarker = L.circle(center, { color: '#4da3ff', fillColor: '#4da3ff', fillOpacity: 0.2, radius: 50 }).addTo(map);
        setTimeout(() => map.removeLayer(searchMarker), 5000);
    } else {
        alert("Search result is outside the T.U.L.O.N.G. coverage area.");
    }
}).addTo(map);

// ============================================================
// ICONS
// ============================================================
const fireIcon = L.icon({ iconUrl: "fireStation1.png", iconSize: [30, 30] });
const volunteerIcon = L.icon({ iconUrl: "volunteerStation1.png", iconSize: [30, 30] });
const truckIcon = L.icon({ iconUrl: "firetruck.png", iconSize: [25, 25] });
const ambulanceIcon = L.icon({ iconUrl: "ambulance.png", iconSize: [35, 35] });

// ============================================================
// STATE
// ============================================================
let isReporting = false;
let incidentCounts = { fire: 0, med: 0 };
let liveUnitCounts = { trucks: 0, ambs: 0 };
let activeIncidentMarkers = {};
let dailyReportLog = [];
let incidentCounter = 1;
let lastResetDate = new Date().toDateString();

// Blynk live unit tracking
const blynkUnitState = {
    "A-001": { lat: null, lng: null, status: null, marker: null, lastSeen: null },
    "F-001": { lat: null, lng: null, status: null, marker: null, lastSeen: null }
};

// ============================================================
// MAP OVERLAY COUNTER
// ============================================================
const infoCounter = L.control({ position: 'topright' });
infoCounter.onAdd = function() {
    this._div = L.DomUtil.create('div', 'map-counter-overlay');
    this.update();
    return this._div;
};
infoCounter.update = function() {
    this._div.innerHTML = `
        <div style="font-size:10px; color:#888; text-align:center; margin-bottom:8px;">LIVE TRACKING</div>
        <div class="map-counter-item"><span>🚒 FIRETRUCKS</span><span class="count-val-red">${liveUnitCounts.trucks}</span></div>
        <div class="map-counter-item"><span>🚑 AMBULANCES</span><span class="count-val-blue">${liveUnitCounts.ambs}</span></div>
        <hr style="border:0; border-top:1px solid #4da3ff; margin:10px 0;">
        <div style="font-size:10px; color:#ffcc00; text-align:center; margin-bottom:8px;">ACTIVE INCIDENTS</div>
        <div class="map-counter-item"><span>🔥 FIRE</span><span class="count-val-yellow">${incidentCounts.fire}</span></div>
        <div class="map-counter-item"><span>⚕️ MEDICAL</span><span class="count-val-yellow">${incidentCounts.med}</span></div>
    `;
};
infoCounter.addTo(map);

// ============================================================
// BLYNK — FETCH GPS & STATUS
// ============================================================
async function blynkGet(token, pin) {
    try {
        const res = await fetch(`${BLYNK_SERVER}/get?token=${token}&pin=${pin}`);
        if (!res.ok) return null;
        const data = await res.json();
        // Blynk returns array like ["value"] or just a number string
        return Array.isArray(data) ? data[0] : data;
    } catch (e) {
        console.warn(`Blynk GET failed for pin ${pin}:`, e);
        return null;
    }
}

async function blynkSet(token, pin, value) {
    try {
        const res = await fetch(`${BLYNK_SERVER}/update?token=${token}&pin=${pin}&value=${value}`);
        return res.ok;
    } catch (e) {
        console.warn(`Blynk SET failed for pin ${pin}:`, e);
        return false;
    }
}

async function fetchBlynkUnit(unitId) {
    const cfg = BLYNK_DEVICES[unitId];
    const state = blynkUnitState[unitId];

    const [latRaw, lngRaw, statusRaw] = await Promise.all([
        blynkGet(cfg.token, cfg.latPin),
        blynkGet(cfg.token, cfg.lngPin),
        blynkGet(cfg.token, cfg.statusPin)
    ]);

    const lat = parseFloat(latRaw);
    const lng = parseFloat(lngRaw);
    const statusVal = statusRaw !== null ? String(statusRaw).trim() : null;

    // Resolve status string
    let statusKey = "STANDBY";
    if (statusVal === "1") statusKey = "RESPONDING";
    else if (statusVal === "2") statusKey = "ARRIVED";

    const validPos = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

    if (validPos) {
        state.lat = lat;
        state.lng = lng;
        state.lastSeen = new Date();

        const icon = cfg.type === "ambulance" ? ambulanceIcon : truckIcon;
        const popupContent = buildUnitPopup(unitId);

        if (!state.marker) {
            state.marker = L.marker([lat, lng], { icon })
                .addTo(map)
                .bindPopup(popupContent);
        } else {
            state.marker.setLatLng([lat, lng]);
            if (state.marker.isPopupOpen()) {
                state.marker.getPopup().setContent(buildUnitPopup(unitId));
            }
        }

        // Bind fresh popup on click
        state.marker.off('click').on('click', () => {
            state.marker.bindPopup(buildUnitPopup(unitId)).openPopup();
        });
    }

    // Only update status if we got a valid value back
    if (statusVal !== null) {
        const prevStatus = state.status;
        state.status = statusKey;
        if (prevStatus !== statusKey) {
            // Push status change to timeline/log if there's an active incident nearby
            console.log(`[${unitId}] Status changed: ${prevStatus} → ${statusKey}`);
        }
    }

    // Update live counts
    liveUnitCounts.trucks = Object.entries(blynkUnitState)
        .filter(([id]) => BLYNK_DEVICES[id].type === "truck" && blynkUnitState[id].lat !== null).length;
    liveUnitCounts.ambs = Object.entries(blynkUnitState)
        .filter(([id]) => BLYNK_DEVICES[id].type === "ambulance" && blynkUnitState[id].lat !== null).length;

    document.getElementById('active-vehicles').innerText = liveUnitCounts.trucks + liveUnitCounts.ambs;
    infoCounter.update();
    updateUnitPanel();
}

async function fetchAllBlynkUnits() {
    await Promise.all(Object.keys(BLYNK_DEVICES).map(id => fetchBlynkUnit(id)));
}

// Poll every 5 seconds
fetchAllBlynkUnits();
setInterval(fetchAllBlynkUnits, 5000);

// ============================================================
// UNIT STATUS — SET via Blynk
// ============================================================
window.setUnitStatus = async function(unitId, statusKey) {
    const cfg = BLYNK_DEVICES[unitId];
    const state = blynkUnitState[unitId];
    const statusDef = UNIT_STATUSES[statusKey];

    const success = await blynkSet(cfg.token, cfg.statusPin, statusDef.value);
    if (success) {
        state.status = statusKey;
        updateUnitPanel();

        // Refresh marker popup if open
        if (state.marker && state.marker.isPopupOpen()) {
            state.marker.getPopup().setContent(buildUnitPopup(unitId));
        }
        console.log(`[${unitId}] Status set to ${statusKey}`);
    } else {
        alert(`Failed to update status for ${unitId}. Check connection.`);
    }
};

// ============================================================
// BUILD UNIT POPUP (map marker popup)
// ============================================================
function buildUnitPopup(unitId) {
    const cfg = BLYNK_DEVICES[unitId];
    const state = blynkUnitState[unitId];
    const currentStatus = state.status || "STANDBY";
    const statusDef = UNIT_STATUSES[currentStatus];
    const lastSeen = state.lastSeen ? state.lastSeen.toLocaleTimeString() : "—";
    const lat = state.lat ? state.lat.toFixed(5) : "—";
    const lng = state.lng ? state.lng.toFixed(5) : "—";

    let buttons = Object.entries(UNIT_STATUSES).map(([key, def]) => `
        <button onclick="setUnitStatus('${unitId}', '${key}')"
            style="
                background: ${currentStatus === key ? def.color : 'rgba(255,255,255,0.1)'};
                color: ${currentStatus === key ? '#000' : def.color};
                border: 1.5px solid ${def.color};
                padding: 6px 8px; margin: 2px; cursor: pointer;
                border-radius: 4px; font-size: 10px; font-weight: bold;
                width: 100%;
            ">
            ${def.label}
        </button>
    `).join('');

    return `
        <div style="color:black; min-width:210px;">
            <div style="
                background: ${cfg.color}22;
                border-left: 3px solid ${cfg.color};
                padding: 6px 10px; margin-bottom: 8px; border-radius: 3px;
            ">
                <b style="color:${cfg.color}; font-size:13px;">${cfg.label}</b><br>
                <span style="font-size:10px; color:#555;">📍 ${lat}, ${lng}</span><br>
                <span style="font-size:10px; color:#555;">🕐 Last ping: ${lastSeen}</span>
            </div>
            <div style="
                background: ${statusDef.bg};
                border: 1px solid ${statusDef.border};
                padding: 5px 10px; border-radius: 4px;
                text-align:center; font-weight:bold;
                color: ${statusDef.color}; font-size:12px; margin-bottom:8px;
            ">
                ● ${statusDef.label}
            </div>
            <div style="font-size:10px; color:#888; margin-bottom:5px; text-transform:uppercase;">Change Status:</div>
            ${buttons}
            <button onclick="flyToUnit('${unitId}')"
                style="background:#022649; color:#4da3ff; border:1px solid #4da3ff; padding:6px; width:100%; margin-top:6px; cursor:pointer; font-size:10px; font-weight:bold; border-radius:4px;">
                🗺️ CENTER ON MAP
            </button>
        </div>
    `;
}

// ============================================================
// UNIT PANEL in SIDEBAR
// ============================================================
function buildUnitPanel() {
    const sidebar = document.querySelector('.sidebar');

    // Remove old panel if exists
    const existing = document.getElementById('blynk-unit-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'blynk-unit-panel';
    panel.style.cssText = `
        margin-top: 5px;
        border-top: 1px solid #043a6d;
        padding-top: 10px;
    `;
    panel.innerHTML = `
        <div style="color:#4da3ff; font-size:11px; font-weight:bold; letter-spacing:1px; margin-bottom:8px; text-transform:uppercase;">
            ⚡ Live Units (Blynk)
        </div>
        <div id="unit-cards-container"></div>
    `;

    // Insert before station-list
    const stationList = document.getElementById('station-container');
    sidebar.insertBefore(panel, stationList);
}

function updateUnitPanel() {
    const container = document.getElementById('unit-cards-container');
    if (!container) return;

    container.innerHTML = Object.entries(BLYNK_DEVICES).map(([unitId, cfg]) => {
        const state = blynkUnitState[unitId];
        const currentStatus = state.status || "STANDBY";
        const statusDef = UNIT_STATUSES[currentStatus];
        const online = state.lastSeen && (new Date() - state.lastSeen) < 15000;
        const lastSeen = state.lastSeen ? state.lastSeen.toLocaleTimeString() : "No signal";

        const buttons = Object.entries(UNIT_STATUSES).map(([key, def]) => `
            <button onclick="setUnitStatus('${unitId}', '${key}')"
                title="${def.label}"
                style="
                    background: ${currentStatus === key ? def.color : 'transparent'};
                    color: ${currentStatus === key ? '#000' : def.color};
                    border: 1px solid ${def.color};
                    padding: 3px 5px; cursor: pointer;
                    border-radius: 3px; font-size: 9px; font-weight: bold;
                    flex: 1; white-space: nowrap; overflow: hidden;
                    text-overflow: ellipsis;
                ">
                ${key === 'ARRIVED' ? '10-23' : key}
            </button>
        `).join('');

        return `
            <div style="
                background: #0a0a1a;
                border: 1px solid ${online ? statusDef.border : '#333'};
                border-radius: 6px;
                padding: 8px;
                margin-bottom: 8px;
                transition: border-color 0.3s;
            ">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <span style="font-weight:bold; font-size:12px; color:${cfg.color};">
                        ${cfg.type === 'ambulance' ? '🚑' : '🚒'} ${unitId}
                    </span>
                    <span style="
                        font-size:9px; padding:2px 6px; border-radius:10px;
                        background:${online ? 'rgba(0,200,83,0.15)' : 'rgba(100,100,100,0.2)'};
                        color:${online ? '#00c853' : '#666'};
                        border:1px solid ${online ? '#00c853' : '#444'};
                    ">
                        ${online ? '● ONLINE' : '○ OFFLINE'}
                    </span>
                </div>

                <div style="
                    font-size:10px; font-weight:bold;
                    color:${statusDef.color};
                    background:${statusDef.bg};
                    border:1px solid ${statusDef.border};
                    padding:3px 6px; border-radius:3px;
                    text-align:center; margin-bottom:6px;
                ">
                    ● ${statusDef.label}
                </div>

                <div style="font-size:9px; color:#555; margin-bottom:6px;">
                    📍 ${state.lat ? `${state.lat.toFixed(4)}, ${state.lng.toFixed(4)}` : 'No GPS'}<br>
                    🕐 ${lastSeen}
                </div>

                <div style="display:flex; gap:3px; margin-bottom:5px;">
                    ${buttons}
                </div>

                <button onclick="flyToUnit('${unitId}')"
                    style="
                        width:100%; background:transparent; color:#4da3ff;
                        border:1px solid #043a6d; padding:3px; cursor:pointer;
                        font-size:9px; border-radius:3px;
                    ">
                    🗺️ FLY TO UNIT
                </button>
            </div>
        `;
    }).join('');
}

window.flyToUnit = function(unitId) {
    const state = blynkUnitState[unitId];
    if (state.lat && state.lng) {
        map.flyTo([state.lat, state.lng], 17);
        if (state.marker) {
            state.marker.bindPopup(buildUnitPopup(unitId)).openPopup();
        }
    } else {
        alert(`No GPS data yet for ${unitId}.`);
    }
};

// Build the panel once DOM is ready
buildUnitPanel();
updateUnitPanel();

// ============================================================
// ADDRESS REVERSE GEOCODE
// ============================================================
async function getAddress(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        const addr = data.address;
        const area = addr.quarter || addr.suburb || addr.village || addr.neighbourhood || "Unknown Area";
        const city = addr.city || addr.town || "Cebu";
        return `Brgy ${area}, ${city}`;
    } catch (e) { return "Address Unavailable"; }
}

// ============================================================
// INCIDENT REPORTING
// ============================================================
const reportBtn = document.getElementById('report-toggle');
reportBtn.onclick = () => {
    isReporting = !isReporting;
    reportBtn.innerText = isReporting ? "Click map location..." : "⚠️ Report Emergency";
    reportBtn.classList.toggle('report-active');
    map.getContainer().style.cursor = isReporting ? 'crosshair' : '';
};

map.on('click', async function(e) {
    if (!isReporting) return;
    const address = await getAddress(e.latlng.lat, e.latlng.lng);
    const popupHTML = `
        <div style="text-align:center; color:black;">
            <b>NEW EMERGENCY</b><br><small>${address}</small><br>
            <button onclick="placeIncident('fire', ${e.latlng.lat}, ${e.latlng.lng}, '${address}')" style="background:#ff4d4d; color:white; border:none; padding:8px; margin:5px; cursor:pointer; font-weight:bold;">🔥 FIRE</button>
            <button onclick="placeIncident('med', ${e.latlng.lat}, ${e.latlng.lng}, '${address}')" style="background:#4da3ff; color:white; border:none; padding:8px; margin:5px; cursor:pointer; font-weight:bold;">⚕️ MEDICAL</button>
        </div>
    `;
    L.popup().setLatLng(e.latlng).setContent(popupHTML).openOn(map);
    isReporting = false;
    reportBtn.innerText = "⚠️ Report Emergency";
    reportBtn.classList.remove('report-active');
    map.getContainer().style.cursor = '';
});

window.placeIncident = function(type, lat, lng, address) {
    const iconEmoji = type === 'fire' ? '🔥' : '⚕️';
    const now = new Date();
    const currentDateString = now.toDateString();

    if (currentDateString !== lastResetDate) {
        incidentCounter = 1;
        lastResetDate = currentDateString;
    }

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const formattedDate = `${year}${month}${day}`;
    const paddedCount = String(incidentCounter).padStart(5, '0');
    const id = `INC-${formattedDate}-${paddedCount}`;
    incidentCounter++;

    const marker = L.marker([lat, lng], {
        icon: L.divIcon({
            html: `<div id="icon-inner-${id}" style="text-align:center;">
                    <div style="font-size:30px;">${iconEmoji}</div>
                    <div id="label-${id}" style="background:rgba(0,0,0,0.8); color:white; font-size:10px; font-weight:bold; padding:2px 4px; border-radius:3px; white-space:nowrap; display:none; border:1px solid #4da3ff;"></div>
                   </div>`,
            className: 'incident-marker',
            iconSize: [40, 50],
            iconAnchor: [20, 25]
        })
    }).addTo(map);

    activeIncidentMarkers[id] = {
        marker, type, lat, lng, address,
        startTime: now,
        timeline: [`[${now.toLocaleTimeString()}] For Verification`],
        status: "For Verification",
        alarm: "N/A",
        isResolved: false
    };

    if (type === 'fire') incidentCounts.fire++; else incidentCounts.med++;
    updateGlobalStats();
    updatePopup(id);
};

window.updatePopup = function(id) {
    const data = activeIncidentMarkers[id];
    if (data.isResolved) {
        data.marker.bindPopup(`<div style="color:black;"><b>RESOLVED ${data.type.toUpperCase()}</b><br><small>${data.address}</small><hr>Type: ${data.status}</div>`).openPopup();
        return;
    }

    let content = `<div style="color:black; min-width:220px;"><b style="text-transform:uppercase;">${data.type} INCIDENT</b><hr>`;

    if (data.type === 'fire') {
        const classifications = ["For Verification","False Alarm","Rubbish Fire","Post Fire","Vehicle fire","Grass fire","Residential","Commercial"];
        content += `<label style="font-size:10px;">Classification:</label><select id="status-${id}" class="status-select" onchange="handleStatusChange('${id}')">`;
        classifications.forEach(opt => content += `<option value="${opt}" ${data.status === opt ? 'selected' : ''}>${opt}</option>`);
        content += `</select>`;
        const alarms = ["Fire out upon arrival","Fire on Progress","1st Alarm","2nd Alarm","3rd Alarm","4th Alarm","5th Alarm","Task Force Alpha","Task Force Bravo","Task Force Charlie","Task Force Delta","Task Force Echo","Task Force Hotel","Task Force India","General Alarm","Under Control","Fire Out"];
        content += `<div style="margin-top:10px;"><label style="font-size:10px;">Alarm Level:</label><select id="alarm-${id}" class="status-select" onchange="logAlarm('${id}')">`;
        alarms.forEach(alrm => content += `<option value="${alrm}" ${data.alarm === alrm ? 'selected' : ''}>${alrm}</option>`);
        content += `</select></div>`;
    } else {
        const medOptions = ["For Verification","Suspected Heart Attack / Cardiac Arrest","Suspected Stroke","Vehicular Accident","Drowning","Possible Suicide","Falling Incident","Fire Incident","Electrocution","Other"];
        content += `<label style="font-size:10px;">Medical Emergency Type:</label><select id="status-${id}" class="status-select" onchange="handleMedicalStatusChange('${id}')">`;
        medOptions.forEach(opt => content += `<option value="${opt}" ${data.status.startsWith(opt) ? 'selected' : ''}>${opt}</option>`);
        content += `</select>`;
        content += `<div id="other-input-div-${id}" style="display:${data.status.startsWith('Other') ? 'block' : 'none'}; margin-top:10px;">
            <input type="text" id="other-text-${id}" placeholder="Type specific emergency..." style="width:100%; padding:5px; color:black; border:1px solid #ccc;" oninput="updateOtherMedicalText('${id}')">
        </div>`;
    }

    content += `<br><br>
        <button onclick="resolveIncident('${id}')" style="background:#217346; color:white; border:none; padding:8px; width:100%; cursor:pointer; font-weight:bold;">RESOLVE & SAVE</button>
        <button onclick="deleteIncident('${id}')" style="background:#ff0000; color:white; border:none; padding:8px; width:100%; margin-top:5px; cursor:pointer;">DELETE</button>
    </div>`;

    data.marker.bindPopup(content).openPopup();
};

window.handleStatusChange = function(id) {
    const statusVal = document.getElementById(`status-${id}`).value;
    const data = activeIncidentMarkers[id];
    if (data.status !== statusVal) {
        data.status = statusVal;
        data.timeline.push(`[${new Date().toLocaleTimeString()}] Status changed to: ${statusVal}`);
        updatePopup(id);
    }
};

window.handleMedicalStatusChange = function(id) {
    const statusVal = document.getElementById(`status-${id}`).value;
    const data = activeIncidentMarkers[id];
    const labelEl = document.getElementById(`label-${id}`);
    const otherDiv = document.getElementById(`other-input-div-${id}`);
    data.status = statusVal;
    if (otherDiv) otherDiv.style.display = statusVal === 'Other' ? 'block' : 'none';
    if (labelEl) {
        if (statusVal === "For Verification" || statusVal === "Other") {
            labelEl.style.display = "none";
        } else {
            labelEl.innerText = statusVal.toUpperCase();
            labelEl.style.display = "inline-block";
            labelEl.style.color = "#4da3ff";
        }
    }
    data.timeline.push(`[${new Date().toLocaleTimeString()}] Type: ${statusVal}`);
};

window.updateOtherMedicalText = function(id) {
    const textVal = document.getElementById(`other-text-${id}`).value;
    const data = activeIncidentMarkers[id];
    const labelEl = document.getElementById(`label-${id}`);
    if (textVal.trim() !== "") {
        data.status = "Other: " + textVal;
        if (labelEl) { labelEl.innerText = textVal.toUpperCase(); labelEl.style.display = "inline-block"; }
    } else {
        if (labelEl) labelEl.style.display = "none";
    }
};

window.logAlarm = function(id) {
    const alarmVal = document.getElementById(`alarm-${id}`).value;
    const data = activeIncidentMarkers[id];
    const labelEl = document.getElementById(`label-${id}`);
    const tacticalAlarms = ["Fire on Progress","1st Alarm","2nd Alarm","3rd Alarm","4th Alarm","5th Alarm","Task Force Alpha","Task Force Bravo","Task Force Charlie","Task Force Delta","Task Force Echo","Task Force Hotel","Task Force India","General Alarm"];
    if (data.alarm !== alarmVal) {
        if (tacticalAlarms.includes(data.alarm)) data.lastTacticalLevel = data.alarm;
        const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        data.alarm = alarmVal;
        data.timeline.push(`${currentTime} - ${alarmVal}`);
        if (labelEl) {
            if (alarmVal === "Fire Out") {
                const finalDisplayAlarm = data.lastTacticalLevel || "Verified";
                labelEl.innerText = `FIRE OUT (${finalDisplayAlarm})`;
                labelEl.style.display = "inline-block";
                setTimeout(() => resolveIncident(id), 500);
            } else if (tacticalAlarms.includes(alarmVal)) {
                labelEl.innerText = alarmVal;
                labelEl.style.display = "inline-block";
            } else {
                labelEl.style.display = "none";
            }
        }
    }
};

window.deleteIncident = function(id) {
    const data = activeIncidentMarkers[id];
    if (data) {
        map.removeLayer(data.marker);
        if (!data.isResolved) {
            if (data.type === 'fire') incidentCounts.fire = Math.max(0, incidentCounts.fire - 1);
            else incidentCounts.med = Math.max(0, incidentCounts.med - 1);
        }
        delete activeIncidentMarkers[id];
        updateGlobalStats();
    }
};

window.resolveIncident = function(id) {
    const data = activeIncidentMarkers[id];
    if (!data || data.isResolved) return;

    const endTime = new Date();
    const diffMs = endTime - data.startTime;
    const durationStr = `${Math.floor(diffMs / 60000)}m ${Math.floor((diffMs % 60000) / 1000)}s`;
    const fullTimeline = data.timeline.join(" \n ");

    dailyReportLog.push({
        "Incident ID": id,
        "Initial Type": data.type.toUpperCase() === "FIRE" ? "FIRE" : "MED",
        "Specific Location": data.address || "Unknown Location",
        "Reported": data.startTime.toLocaleTimeString(),
        "Resolved": endTime.toLocaleTimeString(),
        "Duration": durationStr,
        "Classification": data.status,
        "Final Alarm": data.alarm || "N/A",
        "Progression Timeline": fullTimeline
    });

    if (data.type === 'fire') incidentCounts.fire--; else incidentCounts.med--;
    data.isResolved = true;
    const iconInner = document.getElementById(`icon-inner-${id}`);
    if (iconInner) iconInner.style.filter = "grayscale(100%) opacity(0.6)";
    map.closePopup();
    updateGlobalStats();
};

// ============================================================
// EXPORT
// ============================================================
window.exportToExcel = function() {
    if (dailyReportLog.length === 0) return alert("No reports to export.");
    const wb = XLSX.utils.book_new();
    const fireData = dailyReportLog.filter(i => i["Initial Type"] === "FIRE").map(item => ({
        "Incident ID": item["Incident ID"],
        "Initial Type": item["Initial Type"],
        "Barangay": item["Specific Location"] || item["Barangay"],
        "Reported": item["Reported"],
        "Resolved": item["Resolved"],
        "Duration": item["Duration"],
        "Classification": item["Classification"],
        "Final Alarm": item["Final Alarm"] || "N/A",
        "Progression Timeline": item["Progression Timeline"]
    }));
    const medData = dailyReportLog.filter(i => i["Initial Type"] === "MED").map(item => ({
        "Incident ID": item["Incident ID"],
        "Initial Type": item["Initial Type"],
        "Specific Location": item["Specific Location"],
        "Medical Emergency Type": item["Classification"],
        "Reported": item["Reported"],
        "Resolved": item["Resolved"],
        "Duration": item["Duration"]
    }));
    if (fireData.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fireData), "Fire Incidents");
    if (medData.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(medData), "Medical Incidents");
    XLSX.writeFile(wb, `TULONG_Report_${new Date().toLocaleDateString()}.xlsx`);
};

window.wipeMapAndExport = function() {
    if (confirm("⚠️ ARE YOU SURE TO WIPE MAP?")) {
        exportToExcel();
        for (let id in activeIncidentMarkers) map.removeLayer(activeIncidentMarkers[id].marker);
        activeIncidentMarkers = {};
        dailyReportLog = [];
        incidentCounts = { fire: 0, med: 0 };
        updateGlobalStats();
    }
};

function updateGlobalStats() {
    document.getElementById('total-incidents').innerText = incidentCounts.fire + incidentCounts.med;
    infoCounter.update();
}

// ============================================================
// FIRE STATIONS
// ============================================================
const x0 = [
    { id: "ceb-1", name: "Bureau of Fire Protection - Regional Office VII", number: "(032) 517 9027", lat: 10.2979789, lng: 123.8922118, type: "bfp" },
    { id: "ceb-2", name: "Cebu City Fire Station (Pari-an)", number: "(032) 255 0785", lat: 10.2993222, lng: 123.9034484, type: "bfp" },
    { id: "ceb-3", name: "Labangon Fire Station", number: "(032) 261 0911", lat: 10.2991806, lng: 123.8810782, type: "bfp" },
    { id: "ceb-4", name: "Guadalupe Fire Sub-Station", number: "+63 947 523 6144", lat: 10.3225746, lng: 123.8840113, type: "bfp" },
    { id: "ceb-5", name: "Lahug Fire Sub-Station", number: "(032) 256 0541", lat: 10.3243147, lng: 123.8985383, type: "bfp" },
    { id: "ceb-6", name: "Apas Fire Sub-Station", number: "(032) 416 5103", lat: 10.3371357, lng: 123.9048811, type: "bfp" },
    { id: "ceb-7", name: "Mabolo Fire Sub-Station", number: null, lat: 10.3122927, lng: 123.9159289, type: "bfp" },
    { id: "ceb-8", name: "Cebu Business Park Fire Sub-Station", number: "0917 505 1100", lat: 10.3138334, lng: 123.9083305, type: "bfp" },
    { id: "ceb-9", name: "BFP R7 Mandaue City Fire Station", number: "(032) 344 4747", lat: 10.3230721, lng: 123.9412341, type: "bfp" },
    { id: "llc-1", name: "BFP Gun-Ob (Main/COMMEL)", number: "(032) 340-0252 / 0956-501-0897", lat: 10.3019, lng: 123.9512, type: "bfp" },
    { id: "llc-2", name: "Lapu-Lapu City Fire Station 1", number: "0999 972 1111", lat: 10.30525, lng: 123.958844, type: "bfp" },
    { id: "llc-3", name: "Poblacion Sub-Station (Stn 2)", number: "(032) 326-4638 / 0909-408-3068", lat: 10.313143, lng: 123.948846, type: "bfp" },
    { id: "llc-4", name: "Babag Sub-Station (Stn 3)", number: "(032) 410-8229 / 0981-262-5090", lat: 10.28666, lng: 123.944331, type: "bfp" },
    { id: "llc-5", name: "Marigondon Sub-Station (Stn 4)", number: "(032) 328-0917 / 0967-991-1356", lat: 10.27591, lng: 123.975443, type: "bfp" },
    { id: "llc-6", name: "Mactan Sub-Station (Stn 5)", number: "(032) 342-8508 / 0981-740-5865", lat: 10.309056, lng: 124.01114, type: "bfp" },
    { id: "llc-7", name: "Olango Island Fire Station (Stn 6)", number: "0923-815-7696 / (032) 511 5171", lat: 10.271054, lng: 124.060161, type: "bfp" },
    { id: "ceb-22a", name: "TINAGO Fire Brigade", number: null, lat: 10.297175400366998, lng: 123.90882481339237, type: "volunteer" },
    { id: "ceb-22b", name: "LAHUG Fire Brigade", number: null, lat: 10.324467490309958, lng: 123.89855545767162, type: "volunteer" },
    { id: "ceb-11", name: "Cebu Filipino-Chinese Volunteer Fire Brigade", number: "(032) 254 0200", lat: 10.310547, lng: 123.8891627, type: "volunteer" },
    { id: "ceb-12", name: "NARF Rescue and Fire Brigade", number: null, lat: 10.3159419, lng: 123.8959584, type: "volunteer" },
    { id: "ceb-13", name: "Cebu Chamber Volunteer Fire Brigade", number: "(032) 254 0200", lat: 10.3009152, lng: 123.9012345, type: "volunteer" },
    { id: "ceb-14", name: "Emergency Rescue Unit Foundation Fire Brigade", number: "0918 921 0000", lat: 10.2964812, lng: 123.9029182, type: "volunteer" },
    { id: "llc-V1", name: "ERUF Lapu-Lapu", number: "(032) 340-2994 / 161", lat: 10.317454, lng: 123.963162, type: "volunteer" },
    { id: "ceb-014", name: "Naga City Fire Station", number: "(032) 272 6410", lat: 10.2080, lng: 123.7580, type: "bfp" },
    { id: "ceb-012", name: "Talisay City Fire Station", number: "(032) 272 8277", lat: 10.2450, lng: 123.8490, type: "bfp" },
    { id: "ceb-013", name: "Minglanilla Fire Station", number: "(032) 273 2830", lat: 10.2440, lng: 123.7960, type: "bfp" },
    { id: "ceb-015", name: "Liloan Fire Station", number: "(032) 564 3781", lat: 10.3990, lng: 123.9990, type: "bfp" },
    { id: "ceb-016", name: "Argao Fire Station", number: "(032) 367 7680", lat: 9.8790, lng: 123.5950, type: "bfp" },
    { id: "ceb-017", name: "Bogo City Fire Station", number: "(032) 434 8575", lat: 11.0506, lng: 124.0048, type: "bfp" },
    { id: "ceb-018", name: "Danao City Fire Station", number: "(032) 200 4000", lat: 10.5233, lng: 124.0300, type: "bfp" },
    { id: "ceb-019", name: "Toledo City Fire Station", number: "(032) 322 5755", lat: 10.3789, lng: 123.6386, type: "bfp" },
    { id: "ceb-021", name: "Consolacion Fire Station", number: "(032) 423 3037", lat: 10.3794, lng: 123.9535, type: "bfp" }
];

const stationContainer = document.getElementById('station-container');
document.getElementById('station-count').innerText = x0.length;
x0.forEach(station => {
    const icon = station.type === "bfp" ? fireIcon : volunteerIcon;
    L.marker([station.lat, station.lng], { icon }).addTo(map).bindPopup(`<b>${station.name}</b><br>📞 ${station.number || "N/A"}`);
    const div = document.createElement('div');
    div.className = 'station-item';
    div.innerHTML = `<div><b>${station.type.toUpperCase()}</b>: ${station.name}</div>`;
    div.onclick = () => map.flyTo([station.lat, station.lng], 16);
    stationContainer.appendChild(div);
});

// ============================================================
// LOGOUT
// ============================================================
document.getElementById('logout-trigger').addEventListener('click', function() {
    if (confirm("CONFIRM SYSTEM LOGOUT?\nPLEASE DOWNLOAD EOD REPORT")) {
        window.firebaseSignOut().then(() => {
            window.location.href = 'login.html';
        }).catch(err => console.error(err));
    }
});

setTimeout(() => map.invalidateSize(), 500);