// gen-templates.ts — hasilkan konstanta template URL pencarian dari capture
// (debug/search-rpc.json) → debug/tpl-init.txt & debug/tpl-pagi.txt
// Jalankan ulang kapan saja setelah capture baru: bun gen-templates.ts
const j = await Bun.file("debug/search-rpc.json").json();
const TOK = "AAfake0session0token0X";

// INIT: REQ0 — slot {Q} untuk query, token sesi diganti placeholder
let init = j.requests[0].url;
init = init
  .replace(/q=[^&]+/, "q={Q}")
  .replace(/!1s[^!]+!7i20/, "!1s{Q}!7i20")
  .replace(/uxrIasrOM73rg8UPxbGn-Ao/g, TOK);

// PAGI: REQ1 — buang psi/tch/ech, blok chip filter (berisi sig sesi) → versi
// polos, slot {SPAN}/{LNG}/{LAT}/{OFFSET}/{Q}, token sesi → placeholder
let pagi = j.requests[1].url.split("&psi=")[0];
const chipsRe = /!50m25!(?:(?!59BQ2dBd0Fn)[\s\S])*?!59BQ2dBd0Fn/;
if (!chipsRe.test(pagi)) {
  console.error("PERINGATAN: regex blok chip tidak match — template PAGI tetap memuat sig sesi!");
} else {
  pagi = pagi.replace(chipsRe, "!50m3!2e2!3m1!3b1");
}
pagi = pagi
  .replace(/!1d[\d.]+!2d[\d.-]+!3d[\d.-]+/, "!1d{SPAN}!2d{LNG}!3d{LAT}")
  .replace(/!8i\d+!/, "!8i{OFFSET}!")
  .replace(/&q=[^&]+/, "&q={Q}")
  .replace(/uxrIasrOM73rg8UPxbGn-Ao/g, TOK);

console.log("INIT: slot Q x" + (init.match(/\{Q\}/g) || []).length + " | len " + init.length + " | sig chip: " + init.includes("2ahUKE"));
console.log("PAGI: slot " + ["{SPAN}", "{LNG}", "{LAT}", "{OFFSET}", "{Q}"].map((s) => (pagi.includes(s) ? "ok" : "MISSING-" + s)).join(",") + " | len " + pagi.length + " | sig chip: " + pagi.includes("2ahUKE"));
console.log("PAGI: chip polos 50m3: " + pagi.includes("!50m3!2e2!3m1!3b1"));
await Bun.write("debug/tpl-init.txt", init);
await Bun.write("debug/tpl-pagi.txt", pagi);
console.log("→ debug/tpl-init.txt, debug/tpl-pagi.txt");
