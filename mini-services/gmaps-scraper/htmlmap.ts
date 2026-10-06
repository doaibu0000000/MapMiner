// Peta HTML interaktif — standalone file. Leaflet + MarkerCluster DI-EMBED penuh
// (file bisa dibuka offline; hanya tile peta yang butuh internet).
// Marker diberi warna sesuai status prospek, popup berisi detail lengkap,
// pencarian live + LEGENDA INTERAKTIF (klik status utk menyaring marker).

import type { ScrapeJob, Place } from "./types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** aset Leaflet dibaca sekali dari folder assets/ lalu di-inline ke setiap export */
const ASSETS: Record<string, string> = {};
function asset(name: string): string {
  if (!ASSETS[name]) {
    try {
      ASSETS[name] = readFileSync(join(import.meta.dir, "assets", name), "utf8");
    } catch {
      ASSETS[name] = ""; // fallback: biarkan kosong (peta tak render, data tetap ada)
    }
  }
  return ASSETS[name];
}

const LEAD_META: Record<string, { label: string; color: string }> = {
  "baru": { label: "Baru", color: "#a1a1aa" },
  "dihubungi": { label: "Dihubungi", color: "#fbbf24" },
  "prospek": { label: "Prospek", color: "#a78bfa" },
  "deal": { label: "Deal", color: "#34d399" },
  "tidak-tertarik": { label: "Tidak Tertarik", color: "#fb7185" },
};

function waNumber(digits: string): string | null {
  if (!digits) return null;
  const d = digits.replace(/\D/g, "");
  if (d.startsWith("62")) return d;
  if (d.startsWith("8")) return "62" + d;
  if (d.startsWith("0")) return "62" + d.slice(1);
  return null;
}

function escAttr(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function buildJobHtmlMap(job: ScrapeJob): string {
  const places = job.places;

  // data ringkas untuk client (ukuran lebih kecil)
  const data = places.map((p: Place) => ({
    n: p.name,
    c: p.categories.slice(0, 3),
    a: p.fullAddress,
    ph: p.phoneIntl || p.phone,
    wa: waNumber(p.phoneDigits),
    web: p.website,
    em: p.email,
    ig: p.instagram || "",
    fb: p.facebook || "",
    tt: p.tiktok || "",
    r: p.rating,
    rv: p.reviewsCount,
    h: p.hoursText,
    st: p.businessStatus,
    lat: p.lat,
    lng: p.lng,
    gm: p.mapsUrl,
    lead: p.leadStatus ?? "baru",
  }));

  const withCoords = data.filter((p) => p.lat != null && p.lng != null).length;
  const withPhone = places.filter((p) => p.phoneDigits).length;
  const withEmail = places.filter((p) => p.email).length;
  const withSocial = places.filter((p) => p.instagram || p.facebook || p.tiktok).length;
  const withIg = places.filter((p) => p.instagram).length;
  const ratings = places.filter((p) => p.rating != null).map((p) => p.rating!);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : "–";

  const leadCounts: Record<string, number> = { baru: 0, dihubungi: 0, prospek: 0, deal: 0, "tidak-tertarik": 0 };
  for (const p of places) leadCounts[p.leadStatus ?? "baru"] = (leadCounts[p.leadStatus ?? "baru"] ?? 0) + 1;

  const legendHtml = Object.entries(LEAD_META)
    .map(([k, m]) => `<button type="button" class="lg on" data-lead="${k}" title="Klik untuk menyaring status ${m.label}"><i style="background:${m.color}"></i>${m.label} <b>${leadCounts[k] ?? 0}</b></button>`)
    .join("");

  const title = `${job.keyword} — ${job.city}`;
  const generatedAt = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

  // aman untuk embedding dalam <script>: escape `<` agar tidak menutup tag
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escAttr(title)} — Peta KlienFlow</title>
<style>${asset("leaflet.css")}</style>
<style>${asset("markercluster.css")}</style>
<style>
  :root { --bg:#fafafa; --card:#ffffff; --text:#18181b; --muted:#71717a; --border:#e4e4e7; --accent:#059669; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#09090b; --card:#18181b; --text:#fafafa; --muted:#a1a1aa; --border:#27272a; --accent:#34d399; }
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { height:100%; font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--text); }
  #app { display:flex; flex-direction:column; height:100%; }
  header { background:var(--card); border-bottom:1px solid var(--border); padding:12px 16px; display:flex; flex-wrap:wrap; align-items:center; gap:10px 18px; z-index:1000; }
  .offline-note { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); z-index:800; font-size:11px; color:var(--muted); background:var(--card); border:1px solid var(--border); border-radius:999px; padding:4px 12px; box-shadow:0 4px 14px rgba(0,0,0,.12); white-space:nowrap; display:none; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; }
  .brand .logo { width:32px; height:32px; border-radius:9px; background:linear-gradient(135deg,#10b981,#0d9488); display:flex; align-items:center; justify-content:center; }
  .brand .logo svg { width:18px; height:18px; }
  .brand small { display:block; font-weight:400; color:var(--muted); font-size:11px; }
  .stats { display:flex; flex-wrap:wrap; gap:6px; }
  .stat { background:color-mix(in srgb, var(--accent) 9%, transparent); border:1px solid color-mix(in srgb, var(--accent) 25%, transparent); color:var(--accent); border-radius:999px; padding:4px 11px; font-size:12px; font-weight:600; white-space:nowrap; }
  .stat b { font-variant-numeric:tabular-nums; }
  .legend { display:flex; flex-wrap:wrap; gap:4px 10px; margin-left:auto; }
  .lg { font-size:11px; color:var(--muted); display:inline-flex; align-items:center; gap:5px; white-space:nowrap; background:none; border:1px solid transparent; border-radius:8px; padding:3px 8px; cursor:pointer; transition:all .15s; font-family:inherit; }
  .lg:hover { border-color:var(--border); color:var(--text); }
  .lg i { width:9px; height:9px; border-radius:999px; display:inline-block; }
  .lg b { color:var(--text); }
  .lg:not(.on) { opacity:.35; }
  .lg:not(.on) i { background:var(--muted) !important; }
  #map { flex:1; min-height:200px; background:var(--bg); }
  .search-wrap { position:absolute; top:12px; left:12px; z-index:1000; display:flex; gap:8px; align-items:center; }
  .search-wrap input { width:250px; max-width:60vw; padding:9px 12px 9px 34px; border:1px solid var(--border); border-radius:10px; background:var(--card); color:var(--text); font-size:13px; box-shadow:0 4px 14px rgba(0,0,0,.12); outline:none; }
  .search-wrap input:focus { border-color:var(--accent); }
  .search-wrap .icon { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--muted); }
  .count { font-size:11px; color:var(--muted); background:var(--card); border:1px solid var(--border); border-radius:999px; padding:4px 10px; box-shadow:0 4px 14px rgba(0,0,0,.12); white-space:nowrap; }
  footer { background:var(--card); border-top:1px solid var(--border); color:var(--muted); font-size:11px; padding:8px 16px; display:flex; flex-wrap:wrap; gap:4px 16px; justify-content:space-between; }
  /* popup */
  .leaflet-popup-content { margin:14px 16px; font-size:13px; }
  .pp { min-width:230px; max-width:290px; }
  .pp h4 { font-size:14.5px; line-height:1.35; margin-bottom:4px; padding-right:18px; }
  .pp .cats { color:var(--muted); font-size:11px; margin-bottom:8px; }
  .pp .row { display:flex; align-items:center; gap:6px; font-size:12.5px; margin:5px 0; flex-wrap:wrap; }
  .pp .rate { font-weight:700; }
  .pp .reviews { color:var(--muted); font-size:11px; }
  .pp a { color:#059669; text-decoration:none; font-weight:600; }
  .pp a:hover { text-decoration:underline; }
  .pp .wa { display:inline-flex; align-items:center; gap:4px; background:#059669; color:#fff !important; border-radius:6px; padding:3px 9px; font-size:11.5px; }
  .pp .wa:hover { background:#047857; text-decoration:none; }
  .pp .socmed a { display:inline-flex; align-items:center; gap:3px; border:1px solid var(--border); border-radius:999px; padding:2px 9px; font-size:11px; font-weight:600; }
  .pp .chip { display:inline-block; border-radius:999px; padding:2px 9px; font-size:10.5px; font-weight:600; border:1px solid var(--border); }
  .pp .addr { color:var(--muted); font-size:11.5px; line-height:1.45; margin-top:6px; }
  .pp .hours { color:var(--muted); font-size:10.5px; margin-top:6px; max-height:52px; overflow:hidden; position:relative; }
  .pp .hours.open { max-height:none; }
  .pp .more { background:none; border:none; color:#059669; font-size:10.5px; cursor:pointer; padding:0; font-weight:600; }
  .pp .maps-link { margin-top:8px; display:inline-flex; align-items:center; gap:4px; font-size:12px; }
  .marker-pin { border-radius:999px; }
  .leaflet-marker-icon.pp-pin { border-radius:999px; }
  .cluster-cust { text-align:center; }
  .cluster-cust span { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:999px; background:rgba(5,150,105,.85); color:#fff; font-weight:700; font-size:12.5px; border:2.5px solid rgba(255,255,255,.9); box-shadow:0 2px 8px rgba(0,0,0,.3); }
</style>
</head>
<body>
<div id="app">
  <header>
    <div class="brand">
      <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></div>
      <div>
        ${escAttr(title)}
        <small>KlienFlow Peta · ${places.length} tempat · dibuat ${escAttr(generatedAt)}</small>
      </div>
    </div>
    <div class="stats">
      <span class="stat"><b>${places.length}</b> tempat</span>
      <span class="stat"><b>${withPhone}</b> telepon</span>
      ${withEmail > 0 ? `<span class="stat"><b>${withEmail}</b> email</span>` : ""}
      ${withSocial > 0 ? `<span class="stat"><b>${withIg}</b> Instagram · <b>${withSocial}</b> sosmed</span>` : ""}
      <span class="stat">★ <b>${avg}</b></span>
      ${withCoords < places.length ? `<span class="stat"><b>${places.length - withCoords}</b> tanpa koordinat</span>` : ""}
    </div>
    <div class="legend" id="legend">${legendHtml}</div>
  </header>
  <div id="map">
    <div class="search-wrap">
      <span class="icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></span>
      <input id="q" type="search" placeholder="Cari nama, kategori, telepon…">
      <span class="count" id="count"></span>
    </div>
  </div>
  <footer>
    <span>🟢 Data 100% dari Google Maps — via KlienFlow · <b>file mandiri</b> (Leaflet ter-embed)</span>
    <span>Klik titik utk detail · klik legenda utk menyaring · gunakan pencarian</span>
  </footer>
</div>
<div class="offline-note" id="offlineNote">⚠ Mode offline — tile peta tidak dimuat, marker tetap tampil</div>

<script>${asset("leaflet.js")}</script>
<script>${asset("markercluster.js")}</script>
<script>
(function () {
  var DATA = ${dataJson};
  var LEAD_COLORS = ${JSON.stringify(Object.fromEntries(Object.entries(LEAD_META).map(([k, m]) => [k, m.color])))};
  var LEAD_LABELS = ${JSON.stringify(Object.fromEntries(Object.entries(LEAD_META).map(([k, m]) => [k, m.label])))};
  var escHtml = function (s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

  var map = L.map("map", { zoomControl: true });
  var tiles = L.tileLayer(dark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a> · data Google Maps',
    maxZoom: 19,
  }).addTo(map);
  // deteksi offline: bila tile tak bisa dimuat, tampilkan catatan (marker tetap render)
  var tileErrors = 0;
  tiles.on("tileerror", function () {
    tileErrors++;
    if (tileErrors >= 3) document.getElementById("offlineNote").style.display = "block";
  });

  var cluster = L.markerClusterGroup({
    iconCreateFunction: function (c) {
      return L.divIcon({ html: '<div class="cluster-cust"><span>' + c.getChildCount() + "</span></div>", className: "", iconSize: L.point(34, 34) });
    },
    showCoverageOnHover: false,
    maxClusterRadius: 44,
  });

  var allMarkers = [];

  function popupHtml(p) {
    var h = '<div class="pp"><h4>' + escHtml(p.n);
    if (p.st === "Tutup Permanen") h += ' <span class="chip" style="color:#e11d48;border-color:#fecdd3;background:#fff1f2;">Tutup Permanen</span>';
    h += "</h4>";
    if (p.c && p.c.length) h += '<div class="cats">' + escHtml(p.c.join(" · ")) + "</div>";
    if (p.r != null) h += '<div class="row"><span class="rate">★ ' + p.r.toFixed(1) + "</span>" + (p.rv != null ? '<span class="reviews">(' + p.rv + " ulasan)</span>" : "") + "</div>";
    if (p.ph) {
      h += '<div class="row">📞 <a href="tel:' + escHtml(String(p.ph).replace(/\\D/g, "")) + '">' + escHtml(p.ph) + "</a>";
      if (p.wa) h += ' <a class="wa" target="_blank" rel="noopener" href="https://wa.me/' + p.wa + '">✉ Chat WA</a>';
      h += "</div>";
    }
    if (p.em) h += '<div class="row">📧 <a href="mailto:' + escHtml(String(p.em).split(";")[0].trim()) + '">' + escHtml(p.em) + "</a></div>";
    if (p.ig || p.fb || p.tt) {
      h += '<div class="row socmed">';
      if (p.ig) h += '<a target="_blank" rel="noopener" href="' + escHtml(p.ig) + '">📷 Instagram</a>';
      if (p.fb) h += ' <a target="_blank" rel="noopener" href="' + escHtml(p.fb) + '">👍 Facebook</a>';
      if (p.tt) h += ' <a target="_blank" rel="noopener" href="' + escHtml(p.tt) + '">🎵 TikTok</a>';
      h += "</div>";
    }
    if (p.web) h += '<div class="row">🌐 <a target="_blank" rel="noopener" href="' + escHtml(p.web) + '">' + escHtml(String(p.web).replace(/^https?:\\/\\//, "").slice(0, 42)) + "</a></div>";
    h += '<div class="addr">📍 ' + escHtml(p.a || "-") + "</div>";
    if (p.h) h += '<div class="hours" id="hrs">🕒 ' + escHtml(p.h) + '</div><button class="more" onclick="var e=document.getElementById(\\'hrs\\');e.classList.toggle(\\'open\\');this.textContent=e.classList.contains(\\'open\\')?\\'sembunyikan\\':\\'selengkapnya…\\'">selengkapnya…</button>';
    h += '<div class="row" style="margin-top:8px;"><span class="chip" style="color:' + LEAD_COLORS[p.lead] + ";border-color:" + LEAD_COLORS[p.lead] + '55;">● ' + LEAD_LABELS[p.lead] + "</span>";
    if (p.gm) h += ' <a class="maps-link" target="_blank" rel="noopener" href="' + escHtml(p.gm) + '">Buka di Maps ↗</a>';
    h += "</div></div>";
    return h;
  }

  var bounds = L.latLngBounds();
  for (var i = 0; i < DATA.length; i++) {
    var p = DATA[i];
    if (p.lat == null || p.lng == null) continue;
    var latlng = [p.lat, p.lng];
    bounds.extend(latlng);
    var color = LEAD_COLORS[p.lead] || LEAD_COLORS.baru;
    var icon = L.divIcon({
      className: "pp-pin",
      html: '<div class="marker-pin" style="width:15px;height:15px;background:' + color + ';border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35);"></div>',
      iconSize: [15, 15],
      iconAnchor: [7.5, 7.5],
      popupAnchor: [0, -9],
    });
    var m = L.marker(latlng, { icon: icon, title: p.n });
    m.bindPopup(popupHtml(p), { maxWidth: 320, autoPanPadding: [24, 24] });
    m._p = p;
    cluster.addLayer(m);
    allMarkers.push(m);
  }
  map.addLayer(cluster);

  if (allMarkers.length > 0) {
    map.fitBounds(bounds.pad(0.08));
  } else {
    map.setView([-2.5, 118], 5);
  }

  // pencarian + filter legenda (klik status utk menyaring marker)
  var q = document.getElementById("q");
  var countEl = document.getElementById("count");
  var activeLeads = {}; // true = status tampil
  var legendBtns = document.querySelectorAll("#legend .lg");
  for (var li = 0; li < legendBtns.length; li++) {
    activeLeads[legendBtns[li].getAttribute("data-lead")] = true;
    (function (btn) {
      btn.addEventListener("click", function () {
        var k = btn.getAttribute("data-lead");
        activeLeads[k] = !activeLeads[k];
        btn.classList.toggle("on", activeLeads[k]);
        applyFilter();
      });
    })(legendBtns[li]);
  }
  function applyFilter() {
    var s = q.value.trim().toLowerCase();
    var shown = 0;
    for (var i = 0; i < allMarkers.length; i++) {
      var m = allMarkers[i];
      var p = m._p;
      var hay = (p.n + " " + (p.c || []).join(" ") + " " + (p.ph || "") + " " + (p.em || "") + " " + (p.a || "")).toLowerCase();
      var ok = (!s || hay.indexOf(s) >= 0) && activeLeads[p.lead] !== false;
      if (ok) { if (!map.hasLayer(cluster) || !cluster.hasLayer(m)) cluster.addLayer(m); shown++; }
      else if (cluster.hasLayer(m)) cluster.removeLayer(m);
    }
    countEl.textContent = shown + "/" + allMarkers.length + " tempat";
  }
  var t = null;
  q.addEventListener("input", function () { clearTimeout(t); t = setTimeout(applyFilter, 120); });
  countEl.textContent = allMarkers.length + "/" + allMarkers.length + " tempat";
})();
</script>
</body>
</html>`;
}
