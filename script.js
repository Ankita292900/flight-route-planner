const API_BASE = 'http://127.0.0.1:5000/api';
let map, airportLayer, routeLayer, planeMarker;
let airportsData = [];
let currentPriority = 'time';

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    lucide.createIcons();
    initMap();
    await fetchAirports();
    setupEventListeners();
}

function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([30, 10], 2);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);

    airportLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
}

async function fetchAirports() {
    try {
        const res = await fetch(`${API_BASE}/airports`);
        if (!res.ok) throw new Error("API Offline");
        
        airportsData = await res.json();
        
        const sourceSelect = document.getElementById('sourceSelect');
        const destSelect = document.getElementById('destSelect');

        // Clear existing to avoid duplicates on refresh
        sourceSelect.innerHTML = '<option value="">Select Origin</option>';
        destSelect.innerHTML = '<option value="">Select Arrival</option>';

        airportsData.forEach(airport => {
            const opt = `<option value="${airport.code}">${airport.city} (${airport.code})</option>`;
            sourceSelect.innerHTML += opt;
            destSelect.innerHTML += opt;

        // Custom Airport Marker (Heatmap style)
        const heatColor = airport.congestionLevel > 7 ? '#ef4444' : airport.congestionLevel > 4 ? '#f59e0b' : '#0ea5e9';
        
        L.circleMarker([airport.lat, airport.lon], {
            radius: 5 + (airport.congestionLevel / 2),
            fillColor: heatColor,
            color: "#fff",
            weight: 1,
            fillOpacity: 0.6
        }).bindTooltip(`<b>${airport.name}</b><br>Congestion: ${airport.congestionLevel}/10`, { permanent: false, direction: 'top' }).addTo(airportLayer);
    });
    console.log("✈️ Airports Layer Updated:", airportsData.length);
    } catch (err) {
        console.error("❌ Failed to load airports:", err);
        alert("System Offline: Ensure backend is running at http://localhost:5000");
    }
}

function setupEventListeners() {
    document.getElementById('timeBtn').onclick = () => setPriority('time');
    document.getElementById('fuelBtn').onclick = () => setPriority('fuel');
    document.getElementById('safetyBtn').onclick = () => setPriority('safety');
    document.getElementById('planBtn').onclick = planRoute;

    // Theme Toggle Logic
    document.getElementById('themeToggle').onclick = () => {
        const body = document.body;
        const icon = document.getElementById('themeIcon');
        body.classList.toggle('light-mode');
        
        const isLight = body.classList.contains('light-mode');
        icon.setAttribute('data-lucide', isLight ? 'moon' : 'sun');
        lucide.createIcons();
    };
}

function setPriority(p) {
    currentPriority = p;
    ['timeBtn', 'fuelBtn', 'safetyBtn'].forEach(id => {
        document.getElementById(id).classList.toggle('active', id.startsWith(p));
    });
}

async function planRoute() {
    const source = document.getElementById('sourceSelect').value;
    const dest = document.getElementById('destSelect').value;

    if (!source || !dest) return;

    const btn = document.getElementById('planBtn');
    btn.innerHTML = '<span>Simulating...</span><i class="animate-spin" data-lucide="loader-2"></i>';
    lucide.createIcons();

    try {
        const res = await fetch(`${API_BASE}/plan-route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source, destination: dest, priority: currentPriority })
        });

        const data = await res.json();

        if (data.status === 'success') {
            displayResults(data);
            await animateFlight(data.path);
        } else {
            alert("No viable flight path exists for the current constraints.");
        }
    } catch (err) {
        console.error(err);
    } finally {
        btn.innerHTML = '<span>Initialize Flight</span><i data-lucide="play"></i>';
        lucide.createIcons();
    }
}

function displayResults(data) {
    document.getElementById('resultCard').classList.remove('hidden');
    document.getElementById('distVal').innerText = data.metrics.distance;
    document.getElementById('fuelVal').innerText = data.metrics.fuel;
    document.getElementById('timeVal').innerText = data.metrics.time;
    document.getElementById('congVal').innerText = data.metrics.avg_congestion;
    
    const weatherVal = document.getElementById('weatherVal');
    weatherVal.innerText = data.metrics.avg_weather;
    const weatherImpact = document.getElementById('weatherImpact');
    
    if(data.metrics.avg_weather === 'High') {
        weatherImpact.style.background = 'rgba(239, 68, 68, 0.2)';
        weatherImpact.style.color = '#ef4444';
    } else {
        weatherImpact.style.background = 'rgba(245, 158, 11, 0.1)';
        weatherImpact.style.color = '#f59e0b';
    }
}

async function animateFlight(pathCodes) {
    routeLayer.clearLayers();
    if (planeMarker) map.removeLayer(planeMarker);

    const latlngs = pathCodes.map(code => {
        const a = airportsData.find(ap => ap.code === code);
        return [a.lat, a.lon];
    });

    // Draw Static Path
    const polyline = L.polyline(latlngs, {
        color: '#0ea5e9',
        weight: 3,
        opacity: 0.5,
        dashArray: '5, 10'
    }).addTo(routeLayer);

    map.fitBounds(polyline.getBounds(), { padding: [100, 100] });

    // Plane Marker Initialization
    const planeIcon = L.divIcon({
        className: 'plane-marker',
        html: '<div style="transform: rotate(45deg);"><i data-lucide="plane" style="color: #fff; width: 28px; height: 28px; filter: drop-shadow(0 0 8px #0ea5e9);"></i></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    planeMarker = L.marker(latlngs[0], { icon: planeIcon }).addTo(map);
    lucide.createIcons();

    // Flight Animation (Segment by Segment)
    for (let i = 0; i < latlngs.length - 1; i++) {
        await moveSegment(latlngs[i], latlngs[i+1]);
    }
}

function moveSegment(start, end) {
    return new Promise(resolve => {
        const duration = 2000; // 2 seconds per segment
        const startTime = performance.now();

        function step(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Linear interpolation
            const currentLat = start[0] + (end[0] - start[0]) * progress;
            const currentLng = start[1] + (end[1] - start[1]) * progress;

            planeMarker.setLatLng([currentLat, currentLng]);

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                resolve();
            }
        }
        requestAnimationFrame(step);
    });
}

init();
