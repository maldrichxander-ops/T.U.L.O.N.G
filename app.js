// 1. DATA (The "Memory")

const x0 = [
    { id: "ceb-1", name: "BFP - Regional Office VII", number: "(032) 517 9027", lat: 10.2979, lng: 123.8922, type: "bfp" },
    { id: "ceb-11", name: "Cebu Filipino-Chinese Volunteer", number: "(032) 254 0200", lat: 10.3105, lng: 123.8891, type: "volunteer" },
    // ... add the rest of your stations here
];

// 2. CONNECT TO SERVER
const socket = io("http://localhost:3000");

// 3. INIT MAP
const map = L.map("map").setView([10.3157, 123.8854], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

// 4. ICONS
const fireIcon = L.icon({ iconUrl: "fireStation1.png", iconSize: [25, 25] });
const volunteerIcon = L.icon({ iconUrl: "volunteerStation1.png", iconSize: [25, 25] });

// 5. RENDER STATIONS
x0.forEach(station => {
    const icon = station.type === "bfp" ? fireIcon : volunteerIcon;
    L.marker([station.lat, station.lng], { icon })
        .addTo(map)
        .bindPopup(`<b>${station.name}</b><br>📞 ${station.number || "No contact"}`);
});

// 6. REAL-TIME TRACKING
let markers = {};
socket.on("vehiclesUpdate", (vehicles) => {
    Object.values(vehicles).forEach(v => {
        if (!markers[v.id]) {
            markers[v.id] = L.marker([v.lat, v.lng]).addTo(map).bindPopup(`🚑 Vehicle: ${v.id}`);
        } else {
            markers[v.id].setLatLng([v.lat, v.lng]);
        }
    });
    function attemptLogin() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;

    // Simple check (Replace with your actual logic)
    if (user === "admin" && pass === "1234") {
        // 1. Set the "Lock" to open
        localStorage.setItem('tulong_auth', 'true');
        localStorage.setItem('dispatcher_name', user);
        
        // 2. Redirect to the Dashboard
        window.location.href = "dashboard.html"; 
    } else {
        alert("ACCESS DENIED: Invalid Credentials");
    }
}// SECURITY GATE
if (localStorage.getItem('tulong_auth') !== 'true') {
    // If no active session, redirect to landing page
    window.location.href = 'index.html'; 
}

// OPTIONAL: Display the dispatcher's name
const activeUser = localStorage.getItem('dispatcher_name');
console.log("System Active: Welcome, " + activeUser);function logout() {
    // Clear the security token
    localStorage.removeItem('tulong_auth');
    localStorage.removeItem('dispatcher_name');
    
    // Return to landing page
    window.location.href = 'login.html';
    document.getElementById('user-display').innerText = `OPERATOR: ${currentUser.toUpperCase()}`;
}
});import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const auth = getAuth();
onAuthStateChanged(auth, (user) => {
  if (!user) {
    // If not logged in, kick them back to login page
    window.location.href = 'login.html';
  }
  
  
});
