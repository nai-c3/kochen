import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { firebaseConfig, FAMILY_EMAIL, FUNCTIONS_REGION } from "./firebase-config.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s || "").toLowerCase().normalize("NFC").trim();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const STAR = (on, size = 18) => `<svg class="star${on ? " on" : ""}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>`;
const S = {
  recipes: [], status: "loading", q: "", kind: "alle", tags: new Set(), ings: [],
  sort: store.get("kb.sort") || "neu", favOnly: false, canWrite: false, db: null, ai: null, maxImages: 4,
  photos: new Map(), detail: null, lastRandom: [], form: null, draft: null,
};

/* ---------- Mengen ---------- */
const FR = { "½": .5, "¼": .25, "¾": .75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": .125 };
const UNITS = ["g", "kg", "mg", "ml", "cl", "dl", "l", "EL", "TL", "Msp.", "Msp", "Prise", "Prisen", "Stück", "Stk.", "Stk", "Dose", "Dosen", "Bund", "Pck.", "Pck", "Päckchen", "Packung", "Packungen", "Becher", "Tasse", "Tassen", "Zehe", "Zehen", "Scheibe", "Scheiben", "Glas", "Gläser", "Handvoll", "Würfel", "Stange", "Stangen", "Blatt", "Blätter", "Zweig", "Zweige", "Liter", "Spritzer", "Schuss", "Tropfen", "Kopf", "Knolle", "Knollen", "Rolle", "Tüte", "Beutel", "Flasche", "Portion", "Portionen", "Tafel", "Kugel", "Kugeln"];
const UNIT_MAP = new Map(UNITS.map(u => [u.toLowerCase(), u]));
const num = v => { const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".")); return isFinite(n) && n > 0 ? n : null; };

function parseIngLine(line) {
  let s = line.replace(/^[\s•\-–*]+/, "").trim();
  if (!s) return null;
  if (/:$/.test(s)) return { h: true, n: s.slice(0, -1).trim() };
  let a = null, m;
  if ((m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)\s*/))) a = +m[1] + m[2] / m[3];
  else if ((m = s.match(/^(\d+)\s*\/\s*(\d+)\s*/))) a = m[1] / m[2];
  else if ((m = s.match(/^(\d+(?:[.,]\d+)?)\s*([½¼¾⅓⅔⅛])?\s*/))) a = parseFloat(m[1].replace(",", ".")) + (m[2] ? FR[m[2]] : 0);
  else if ((m = s.match(/^([½¼¾⅓⅔⅛])\s*/))) a = FR[m[1]];
  if (m) s = s.slice(m[0].length).replace(/^[-–]\s*[\d.,½¼¾]+\s*/, "");
  let u = "";
  const um = s.match(/^([A-Za-zÄÖÜäöüß.]+)\s+(.+)$/);
  if (um && UNIT_MAP.has(um[1].toLowerCase())) { u = UNIT_MAP.get(um[1].toLowerCase()); s = um[2]; }
  return { a: a || null, u, n: s.trim() };
}
function fmtAmount(x, u) {
  if (x == null || !isFinite(x)) return "";
  if (/^(g|ml)$/i.test(u) && x >= 50) return String(Math.round(x / 5) * 5);
  if (x >= 20) return String(Math.round(x));
  const w = Math.floor(x), f = x - w;
  const opts = [[0, ""], [.25, "¼"], [1 / 3, "⅓"], [.5, "½"], [2 / 3, "⅔"], [.75, "¾"], [1, ""]];
  let best = opts[0];
  for (const o of opts) if (Math.abs(f - o[0]) < Math.abs(f - best[0])) best = o;
  if (Math.abs(f - best[0]) > .06) return (Math.round(x * 10) / 10).toString().replace(".", ",");
  const W = w + (best[0] === 1 ? 1 : 0);
  if (!best[1]) return String(W);
  return (W ? W : "") + best[1];
}
const rawAmount = a => a == null ? "" : String(+a.toFixed(3)).replace(".", ",");
const ingToLine = i => i.h ? i.n + ":" : [rawAmount(i.a), i.u, i.n].filter(Boolean).join(" ");
const ingNames = r => (r.ingredients || []).filter(i => !i.h).map(i => norm(i.n));

/* ---------- Filtern ---------- */
function matches(r, ignoreKind) {
  if (!ignoreKind && S.kind !== "alle" && r.kind !== S.kind) return false;
  if (S.favOnly && !r.fav) return false;
  for (const t of S.tags) if (!(r.tags || []).includes(t)) return false;
  const names = ingNames(r);
  for (const f of S.ings) if (!names.some(n => n.includes(f))) return false;
  const q = norm(S.q);
  if (q) {
    const hay = [norm(r.title), ...(r.tags || []).map(norm), ...names].join(" | ");
    if (!hay.includes(q)) return false;
  }
  return true;
}
function sorter() {
  if (S.sort === "az") return (a, b) => String(a.title).localeCompare(String(b.title), "de");
  if (S.sort === "selten") return (a, b) => (a.lastCooked || 0) - (b.lastCooked || 0) || String(a.title).localeCompare(String(b.title), "de");
  return (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
}
const filtered = () => S.recipes.filter(r => matches(r)).sort(sorter());
function allTags() {
  const c = new Map();
  for (const r of S.recipes) for (const t of r.tags || []) c.set(t, (c.get(t) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).map(e => e[0]);
}
function allIngredients() {
  const c = new Map();
  for (const r of S.recipes) for (const n of new Set(ingNames(r))) c.set(n, (c.get(n) || 0) + 1);
  return c;
}

/* ---------- Hauptliste ---------- */
function metaLine(r) {
  const p = [];
  if (r.time) p.push(r.time + " Min.");
  if (r.servings) p.push(r.servings + " Portionen");
  return p.join(" · ");
}
function thumbHTML(r, cls = "thumb") {
  const k = r.kind === "süß" ? "süß" : "herzhaft";
  if (r.thumb) return `<div class="${cls} ${k}"><img src="${esc(r.thumb)}" alt=""></div>`;
  return `<div class="${cls} ${k}" aria-hidden="true">${esc((r.title || "?").trim().charAt(0).toUpperCase())}</div>`;
}

function render() {
  const list = filtered();
  const base = S.recipes.filter(r => matches(r, true));
  $("#count").textContent = S.status === "ready" ? `${S.recipes.length} ${S.recipes.length === 1 ? "Rezept" : "Rezepte"}` : "";
  for (const k of ["alle", "herzhaft", "süß"]) {
    $("#n-" + k).textContent = S.status === "ready" ? (k === "alle" ? base.length : base.filter(r => r.kind === k).length) : "";
  }
  $$(".top .seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.kind === S.kind)));

  const tags = allTags();
  const favCount = S.recipes.filter(r => r.fav).length;
  $("#tagrow").innerHTML = `<button type="button" class="chip fav" data-action="favfilter" aria-pressed="${S.favOnly}">${STAR(S.favOnly || favCount > 0, 14)} Favoriten${favCount ? ` <small>${favCount}</small>` : ""}</button>` + tags.map(t => `<button type="button" class="chip" data-tag="${esc(t)}" aria-pressed="${S.tags.has(t)}">#${esc(t)}</button>`).join("");
  $("#tagrow").hidden = S.status !== "ready" || !S.recipes.length;

  // Zutaten-Vorschläge zur Sucheingabe
  const q = norm(S.q);
  const sg = $("#suggest");
  if (q.length >= 2) {
    const ing = [...allIngredients().entries()].filter(([n]) => n.includes(q) && n !== q).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    const chips = [q, ...ing].filter(n => !S.ings.includes(n));
    sg.innerHTML = chips.map((n, i) => `<button type="button" class="chip ing" data-addIng="${esc(n)}">${i === 0 ? "Alles mit <b>" + esc(n) + "</b>" : "Zutat: " + esc(n)}</button>`).join("");
    sg.hidden = !chips.length;
  } else sg.hidden = true;

  const act = $("#active");
  const anyFilter = S.ings.length || S.tags.size || S.kind !== "alle" || q || S.favOnly;
  act.innerHTML = S.ings.map(n => `<button type="button" class="chip ing" aria-pressed="true" data-rmIng="${esc(n)}">mit ${esc(n)} ×</button>`).join("")
    + (anyFilter ? `<button type="button" class="reset" id="resetall">Filter zurücksetzen</button>` : "");
  act.hidden = !anyFilter;

  $("#listtitle").textContent = anyFilter ? (list.length === 1 ? "1 passendes Rezept" : `${list.length} passende Rezepte`) : "Alle Rezepte";
  $("#sort").value = S.sort;

  const dice = $("#dice");
  dice.disabled = S.status !== "ready" || !list.length;
  if (!dice.classList.contains("rolling")) {
    $("#dicesub").textContent = !S.recipes.length ? "Sobald Rezepte da sind" : !list.length ? "Kein Rezept passt zum Filter" : anyFilter ? `Zufällig aus ${list.length} passenden` : `Zufällig aus ${list.length} Rezepten`;
  }

  $("#list").innerHTML = list.map(r => `
    <button type="button" class="card" data-open="${esc(r.id)}">
      ${thumbHTML(r)}
      <div class="body">
        <h3>${r.fav ? `<span class="favmark" aria-label="Favorit">${STAR(true, 15)}</span>` : ""}${esc(r.title)}</h3>
        <div class="meta"><span class="kind-dot ${r.kind === "süß" ? "süß" : ""}"></span>${esc(r.kind === "süß" ? "Süß" : "Herzhaft")}${metaLine(r) ? " · " + esc(metaLine(r)) : ""}</div>
        ${(r.tags || []).length ? `<div class="tags">${r.tags.slice(0, 4).map(t => `<span>#${esc(t)}</span>`).join("")}</div>` : ""}
      </div>
    </button>`).join("");

  const eb = $("#emptybox");
  if (S.status === "loading") eb.innerHTML = `<div class="empty"><div class="spin"></div><p>Rezepte werden geladen …</p></div>`;
  else if (S.status === "nodb") eb.innerHTML = `<div class="notice">Die Seite ist noch nicht mit der Datenbank verbunden. Trage die Firebase-Daten in <b>firebase-config.js</b> ein (siehe SETUP.md).</div>`;
  else if (S.status === "error") eb.innerHTML = `<div class="notice">Die Rezepte konnten nicht geladen werden. Prüfe die Internetverbindung und lade die Seite neu.</div>`;
  else if (!S.recipes.length) eb.innerHTML = `<div class="empty">
      <h2>Noch keine Rezepte</h2>
      <p>Fotografiere ein Rezept aus dem Kochbuch, lade einen Screenshot hoch, füge Text oder einen Link ein. Die KI macht daraus ein fertiges Rezept mit Zutaten und Kategorien.</p>
      ${S.canWrite ? `<button class="btn" type="button" data-action="add">Erstes Rezept hinzufügen</button>` : ""}
    </div>`;
  else if (!list.length) eb.innerHTML = `<div class="empty"><p>Kein Rezept passt zu diesen Filtern.</p><button class="btn ghost sm" type="button" data-action="reset">Filter zurücksetzen</button></div>`;
  else eb.innerHTML = "";

  $("#fab").hidden = !(S.canWrite && S.status === "ready");
  if (S.detail && !$("#detail").hidden) renderDetail();
}

/* ---------- Blätter ---------- */
function openSheet(id) {
  const el = $("#" + id);
  el.hidden = false; el.scrollTop = 0;
  document.body.style.overflow = "hidden";
}
function closeSheet(id) {
  $("#" + id).hidden = true;
  if ($$(".sheet").every(s => s.hidden)) document.body.style.overflow = "";
  if (id === "detail") { S.detail = null; releaseWake(); }
  if (id === "add" && S.draft) S.draft.token = null;
}
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600);
}
let wake = null;
async function holdWake() { try { wake = await navigator.wakeLock?.request("screen"); } catch {} }
function releaseWake() { try { wake?.release(); } catch {} wake = null; }

/* ---------- Rezept ansehen ---------- */
function openDetail(id, fromRandom = false) {
  loadJsPdf().catch(() => {});
  S.detail = { id, servings: null, fromRandom, doneI: new Set(), doneS: new Set(), confirmDel: false };
  renderDetail();
  openSheet("detail");
  loadPhoto(id);
  holdWake();
}
async function loadPhoto(id) {
  const r = S.recipes.find(x => x.id === id);
  if (!r?.hasPhoto || S.photos.has(id) || !S.db) return;
  try {
    const snap = await S.db.doc("photos/" + id).get();
    if (snap.exists) { S.photos.set(id, snap.data().src); if (S.detail?.id === id) renderDetail(); }
  } catch {}
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }
function ago(ts) {
  const d = Math.floor((Date.now() - ts) / 864e5);
  if (d <= 0) return "heute";
  if (d === 1) return "gestern";
  if (d < 30) return `vor ${d} Tagen`;
  const m = Math.round(d / 30);
  return m <= 1 ? "vor einem Monat" : `vor ${m} Monaten`;
}
function renderDetail() {
  const D = S.detail, el = $("#detail");
  const r = S.recipes.find(x => x.id === D.id);
  if (!r) { closeSheet("detail"); return; }
  const baseServ = r.servings || 4;
  const serv = D.servings ?? baseServ;
  const f = serv / baseServ;
  const k = r.kind === "süß" ? "süß" : "herzhaft";
  const photo = S.photos.get(r.id) || r.thumb;
  const keepScroll = el.scrollTop;
  el.innerHTML = `
    <div class="bar">
      <button class="iconbtn" type="button" data-close="detail" aria-label="Zurück">←</button>
      <div style="display:flex;gap:6px;align-items:center">
        ${D.fromRandom ? `<button class="btn sm sun" type="button" data-action="reroll">Nochmal würfeln</button>` : ""}
        ${S.canWrite ? `<button class="iconbtn favbtn" type="button" data-action="fav" aria-pressed="${!!r.fav}" aria-label="${r.fav ? "Aus Favoriten entfernen" : "Als Favorit merken"}">${STAR(!!r.fav, 22)}</button>` : ""}
      </div>
    </div>
    <div class="inner">
      <div class="hero ${k}${photo ? "" : " nophoto"}">${photo ? `<img src="${esc(photo)}" alt="${esc(r.title)}">` : esc((r.title || "?").charAt(0).toUpperCase())}</div>
      <div class="dtitle">
        <h2>${esc(r.title)}</h2>
        <div class="facts">
          <span><span class="kind-dot ${k === "süß" ? "süß" : ""}"></span>${k === "süß" ? "Süß" : "Herzhaft"}</span>
          ${r.time ? `<span>${r.time} Min.</span>` : ""}
          ${r.cookCount ? `<span>${r.cookCount}× gekocht, zuletzt ${ago(r.lastCooked)}</span>` : ""}
        </div>
        ${(r.tags || []).length ? `<div class="tags">${r.tags.map(t => `<span>#${esc(t)}</span>`).join("")}</div>` : ""}
        ${r.source ? `<p class="source" style="margin:0">Quelle: ${/^https?:\/\//i.test(r.source) ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(hostOf(r.source))}</a>` : esc(r.source)}</p>` : ""}
      </div>
      <div class="section">
        <h3>Zutaten
          <span class="stepper">
            <button type="button" data-serv="-1" aria-label="Weniger Portionen">−</button>
            <span aria-live="polite">${serv} ${serv === 1 ? "Portion" : "Portionen"}</span>
            <button type="button" data-serv="1" aria-label="Mehr Portionen">+</button>
          </span>
        </h3>
        <ul class="ings">
          ${(r.ingredients || []).map((i, n) => i.h
            ? `<li class="grp">${esc(i.n)}</li>`
            : `<li data-ing="${n}" class="${D.doneI.has(n) ? "done" : ""}"><span class="amt">${esc([fmtAmount(i.a != null ? i.a * f : null, i.u), i.u].filter(Boolean).join(" "))}</span><span>${esc(i.n)}</span></li>`).join("")}
        </ul>
        ${f !== 1 ? `<p class="hint">Mengen für ${serv} statt ${baseServ} Portionen umgerechnet.</p>` : `<p class="hint">Tippe auf eine Zutat, um sie abzuhaken.</p>`}
      </div>
      ${(r.steps || []).length ? `<div class="section">
        <h3>Zubereitung</h3>
        <ol class="steps">${r.steps.map((s, n) => `<li data-step="${n}" class="${D.doneS.has(n) ? "done" : ""}"><span>${esc(s)}</span></li>`).join("")}</ol>
      </div>` : ""}
      ${r.note ? `<div class="section"><h3>Notiz</h3><div class="note">${esc(r.note)}</div></div>` : ""}
      <div class="section actions">
        <button class="btn sun" type="button" data-action="share">Rezept teilen (PDF)</button>
      </div>
      ${S.canWrite ? `<div class="section actions">
        <button class="btn" type="button" data-action="cooked">Heute gekocht</button>
        <button class="btn ghost" type="button" data-action="edit">Bearbeiten</button>
        ${D.confirmDel
          ? `<button class="btn warn" type="button" data-action="delete-yes">Wirklich löschen</button><button class="btn ghost" type="button" data-action="delete-no">Behalten</button>`
          : `<button class="btn ghost" type="button" data-action="delete">Löschen</button>`}
      </div>` : ""}
    </div>`;
  el.scrollTop = keepScroll;
}

/* ---------- Zufall ---------- */
function pickRandom() {
  const list = filtered();
  if (!list.length) return null;
  const recent = Date.now() - 4 * 864e5;
  let pool = list.filter(r => !S.lastRandom.includes(r.id) && !(r.lastCooked > recent));
  if (!pool.length) pool = list.filter(r => r.id !== S.lastRandom[S.lastRandom.length - 1]);
  if (!pool.length) pool = list;
  const r = pool[Math.floor(Math.random() * pool.length)];
  S.lastRandom.push(r.id);
  S.lastRandom = S.lastRandom.slice(-Math.min(5, Math.max(1, list.length - 1)));
  return r;
}
function roll() {
  const list = filtered();
  const r = pickRandom();
  if (!r) return;
  const dice = $("#dice");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || list.length < 2) { openDetail(r.id, true); return; }
  dice.classList.add("rolling");
  const sub = $("#dicesub");
  let n = 0;
  const iv = setInterval(() => {
    sub.textContent = list[Math.floor(Math.random() * list.length)].title;
    if (++n > 7) {
      clearInterval(iv);
      sub.textContent = r.title;
      setTimeout(() => { dice.classList.remove("rolling"); openDetail(r.id, true); render(); }, 220);
    }
  }, 70);
}

/* ---------- Bilder ---------- */
async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode(); return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}
function toJpeg(bmp, maxSide, quality, square) {
  const w = bmp.width, h = bmp.height;
  const c = document.createElement("canvas");
  let sx = 0, sy = 0, sw = w, sh = h;
  if (square) { const s = Math.min(w, h); sx = (w - s) / 2; sy = (h - s) / 2; sw = sh = s; }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  c.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
async function makePhoto(file) {
  const bmp = await loadBitmap(file);
  let src = toJpeg(bmp, 1000, .72), q = .72, side = 1000;
  while (src.length > 220000 && side > 400) { side -= 150; q = Math.max(.5, q - .06); src = toJpeg(bmp, side, q); }
  const thumb = toJpeg(bmp, 200, .62, true);
  return { src, thumb };
}

/* ---------- Hinzufügen: Eingabe ---------- */
function openAdd() {
  S.draft = { mode: S.ai ? "bild" : "manual", images: [], text: "", url: "", busy: false, error: "" };
  renderAdd();
  openSheet("add");
}
const isUrl = v => /^https?:\/\/\S+$/i.test(String(v).trim());
function renderAdd() {
  const D = S.draft, box = $("#addinner");
  if (D.busy) {
    box.innerHTML = `<div class="working"><div class="spin"></div><strong>${D.mode === "link" ? "Die Seite wird gelesen …" : "Die KI liest das Rezept …"}</strong><p class="hint">Das dauert meist 10 bis 40 Sekunden.</p><button class="btn ghost sm" type="button" data-action="stop">Abbrechen</button></div>`;
    return;
  }
  if (!S.ai) {
    box.innerHTML = `<div class="notice">Die KI-Erkennung ist noch nicht eingerichtet (siehe SETUP.md). Du kannst Rezepte von Hand eintragen.</div>
      <button class="btn" type="button" data-action="manual">Von Hand eintragen</button>`;
    return;
  }
  let body = "";
  if (D.mode === "bild") body = `
      <div class="drop" id="drop">
        ${D.images.length ? `<div class="previews">${D.images.map((im, i) => `<div><img src="${im.url}" alt="Bild ${i + 1}"><button type="button" data-rmimg="${i}" aria-label="Bild entfernen">×</button></div>`).join("")}</div>` : `<strong class="lab" style="font-size:.85rem">Bilder vom Rezept</strong><span class="hint" style="margin:0">Bis zu ${S.maxImages} Bilder, z. B. Zutatenseite und Zubereitung. Ein Foto vom fertigen Gericht wird als Rezeptbild übernommen.</span>`}
        ${D.images.length < S.maxImages ? `<label class="btn ${D.images.length ? "ghost sm" : ""}" for="addfiles">${D.images.length ? "Weiteres Bild" : "Foto aufnehmen oder auswählen"}</label>` : ""}
        <input id="addfiles" class="vh" type="file" accept="image/*" multiple>
      </div>
      <div class="field">
        <label for="addhint">Zusatzinfo (optional)</label>
        <input id="addhint" type="text" value="${esc(D.text)}" placeholder="z. B. Wir machen es immer mit Reis statt Nudeln">
      </div>`;
  else if (D.mode === "text") body = `
      <div class="field">
        <label for="addtext">Rezepttext</label>
        <textarea id="addtext" rows="10" placeholder="Rezept hier einfügen: Zutaten und Zubereitung. Du kannst auch einfach aufschreiben, wie ihr es kocht.">${esc(D.text)}</textarea>
      </div>`;
  else body = `
      <div class="field">
        <label for="addurl">Link zum Rezept</label>
        <input id="addurl" type="url" inputmode="url" value="${esc(D.url)}" placeholder="https://www.chefkoch.de/rezepte/…" autocomplete="off">
      </div>
      <div class="field">
        <label for="addurlnote">Zusatzinfo (optional)</label>
        <input id="addurlnote" type="text" value="${esc(D.text)}" placeholder="z. B. Mit halber Zuckermenge">
      </div>
      <p class="hint" style="margin:0">Die Seite wird abgerufen, das Rezept mit Zutaten, Schritten, Kategorien und Foto übernommen. Danach kannst du alles prüfen.</p>`;
  box.innerHTML = `
    <div class="tabs" role="group" aria-label="Quelle">
      <button type="button" class="tab" data-mode="bild" aria-pressed="${D.mode === "bild"}">Foto<small>Kochbuch, Zettel, Screenshot</small></button>
      <button type="button" class="tab" data-mode="text" aria-pressed="${D.mode === "text"}">Text<small>Kopiert oder selbst geschrieben</small></button>
      <button type="button" class="tab" data-mode="link" aria-pressed="${D.mode === "link"}">Link<small>Rezept-Website</small></button>
    </div>
    ${body}
    ${D.error ? `<p class="err">${esc(D.error)}</p>` : ""}
    <button class="btn" type="button" data-action="recognize">${D.mode === "link" ? "Rezept übernehmen" : "Rezept erkennen"}</button>
    <button class="btn ghost" type="button" data-action="manual">Von Hand eintragen</button>`;
}
function stashDraft() {
  const D = S.draft;
  if ($("#addtext")) D.text = $("#addtext").value;
  if ($("#addhint")) D.text = $("#addhint").value;
  if ($("#addurl")) { D.url = $("#addurl").value; D.text = $("#addurlnote").value; }
}
function addFiles(files) {
  const D = S.draft;
  for (const f of files) {
    if (!f.type.startsWith("image/") || D.images.length >= S.maxImages) continue;
    D.images.push({ file: f, url: URL.createObjectURL(f) });
  }
  D.error = ""; renderAdd();
}

async function toApiImage(file) {
  const bmp = await loadBitmap(file);
  const data = toJpeg(bmp, 1568, .85).split(",")[1];
  return { type: "image/jpeg", data };
}
function base64ToBlob(b64, type) {
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
const AI_ERR = {
  "functions/unauthenticated": "Du bist nicht angemeldet. Lade die Seite neu und gib das Familien-Passwort ein.",
  "functions/permission-denied": "Du bist nicht angemeldet. Lade die Seite neu und gib das Familien-Passwort ein.",
  "functions/resource-exhausted": "Gerade laufen zu viele Anfragen oder das API-Guthaben ist aufgebraucht. Versuch es später noch einmal.",
  "functions/deadline-exceeded": "Das hat zu lange gedauert. Versuch es noch einmal.",
  "functions/internal": "Die Erkennung hat nicht geklappt. Versuch es noch einmal oder trage das Rezept von Hand ein.",
};

async function recognize() {
  const D = S.draft;
  stashDraft();
  const payload = { knownTags: allTags().slice(0, 60) };
  if (D.mode === "text" && isUrl(D.text)) { D.mode = "link"; D.url = D.text.trim(); D.text = ""; }
  let imgs = [];
  if (D.mode === "bild") {
    imgs = D.images.map(i => i.file);
    if (!imgs.length) { D.error = "Wähle zuerst mindestens ein Bild aus."; return renderAdd(); }
    payload.hint = D.text.trim();
  } else if (D.mode === "text") {
    if (D.text.trim().length < 10) { D.error = "Füge zuerst den Rezepttext ein."; return renderAdd(); }
    payload.text = D.text.trim().slice(0, 60000);
  } else {
    const url = D.url.trim();
    if (!isUrl(url)) { D.error = "Das sieht nicht nach einem Link aus. Er muss mit https:// beginnen."; return renderAdd(); }
    const dup = S.recipes.find(r => r.source === url);
    if (dup) { D.error = `Dieses Rezept gibt es schon: ${dup.title}`; return renderAdd(); }
    payload.url = url; payload.hint = D.text.trim();
  }
  D.busy = true; D.error = ""; const token = D.token = {}; renderAdd();
  try {
    if (imgs.length) payload.images = await Promise.all(imgs.map(toApiImage));
    const { data } = await S.ai(payload);
    if (D.token !== token || $("#add").hidden) return;
    D.busy = false;
    const res = data?.recipe;
    if (!res || typeof res !== "object") throw { code: "functions/internal" };
    if (res.error && !res.title) { D.error = "Kein Rezept erkannt: " + res.error; renderAdd(); return; }
    const ingredients = [];
    let g = null;
    for (const i of Array.isArray(res.ingredients) ? res.ingredients : []) {
      if (!i || !i.name) continue;
      if (i.group && i.group !== g) { ingredients.push({ h: true, n: String(i.group).replace(/:$/, "") }); g = i.group; }
      ingredients.push({ a: num(i.amount), u: UNIT_MAP.get(String(i.unit || "").toLowerCase()) || String(i.unit || ""), n: String(i.name) });
    }
    let photo = null;
    try {
      if (data.image?.data) photo = await makePhoto(base64ToBlob(data.image.data, data.image.type || "image/jpeg"));
      else if (Number.isInteger(res.dishPhoto) && imgs[res.dishPhoto]) photo = await makePhoto(imgs[res.dishPhoto]);
    } catch {}
    closeSheet("add");
    openForm({
      title: String(res.title || ""), kind: res.kind === "süß" ? "süß" : "herzhaft",
      servings: num(res.servings) ? Math.round(num(res.servings)) : 4, time: num(res.time) ? Math.round(num(res.time)) : null,
      tags: cleanTags(Array.isArray(res.tags) ? res.tags : []), ingredients,
      steps: (Array.isArray(res.steps) ? res.steps : []).map(String).filter(Boolean), note: res.note ? String(res.note) : "",
      source: payload.url || (res.source ? String(res.source) : ""),
    }, { photo, fromKI: true });
  } catch (e) {
    if (D.token !== token) return;
    D.busy = false;
    const code = e?.code || "";
    D.error = ["functions/invalid-argument", "functions/failed-precondition", "functions/not-found", "functions/unavailable"].includes(code) && e.message
      ? e.message
      : AI_ERR[code] || "Die Erkennung hat nicht geklappt. Prüfe die Internetverbindung und versuch es noch einmal.";
    renderAdd();
  }
}
function cleanTags(arr) {
  const out = [];
  for (let t of arr) {
    t = norm(String(t).replace(/^#/, "")).replace(/\s+/g, "-");
    if (t && t !== "süß" && t !== "herzhaft" && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 10);
}

/* ---------- Formular ---------- */
function openForm(r, { photo = null, fromKI = false, id = null } = {}) {
  const existingPhoto = id ? (S.photos.get(id) || null) : null;
  S.form = { id, photo: photo?.src || existingPhoto, thumb: photo?.thumb || r.thumb || null, photoChanged: !!photo, hadPhoto: !!r.hasPhoto, kind: r.kind || "herzhaft" };
  $("#formtitle").textContent = id ? "Rezept bearbeiten" : fromKI ? "Erkanntes Rezept prüfen" : "Neues Rezept";
  $("#f-title").value = r.title || "";
  $("#f-servings").value = r.servings || 4;
  $("#f-time").value = r.time || "";
  $("#f-tags").value = (r.tags || []).join(", ");
  $("#f-ings").value = (r.ingredients || []).map(ingToLine).join("\n");
  $("#f-steps").value = (r.steps || []).join("\n");
  $("#f-note").value = r.note || "";
  $("#f-source").value = r.source || "";
  $("#f-err").hidden = true;
  $("#f-save").disabled = false;
  renderFormBits();
  openSheet("form");
  if (id && r.hasPhoto && !existingPhoto) loadPhoto(id).then(() => { if (S.form?.id === id && !S.form.photoChanged) { S.form.photo = S.photos.get(id) || null; } });
}
function renderFormBits() {
  const F = S.form;
  $$("#f-kind button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === F.kind)));
  const p = $("#f-photo");
  p.className = "thumb " + F.kind;
  p.innerHTML = F.thumb ? `<img src="${esc(F.thumb)}" alt="">` : esc(($("#f-title").value || "?").charAt(0).toUpperCase());
  $("#f-photodel").hidden = !F.thumb;
  const cur = cleanTags($("#f-tags").value.split(/[,;\n]/));
  const sugg = allTags().filter(t => !cur.includes(t)).slice(0, 30);
  $("#f-tagsugg").innerHTML = sugg.map(t => `<button type="button" class="chip" data-addtag="${esc(t)}">#${esc(t)}</button>`).join("");
  $("#f-tagsugg").hidden = !sugg.length;
}
async function saveForm(ev) {
  ev.preventDefault();
  const F = S.form, err = $("#f-err");
  const title = $("#f-title").value.trim();
  if (!title) { err.textContent = "Gib dem Rezept einen Namen."; err.hidden = false; $("#f-title").focus(); return; }
  const ingredients = $("#f-ings").value.split("\n").map(parseIngLine).filter(Boolean);
  const steps = $("#f-steps").value.split("\n").map(s => s.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim()).filter(Boolean);
  const old = F.id ? S.recipes.find(x => x.id === F.id) : null;
  const hasPhoto = !!F.thumb;
  const data = {
    title, kind: F.kind,
    servings: Math.max(1, Math.round(num($("#f-servings").value) || 4)),
    time: num($("#f-time").value) ? Math.round(num($("#f-time").value)) : null,
    tags: cleanTags($("#f-tags").value.split(/[,;\n]/)),
    ingredients, steps, note: $("#f-note").value.trim(), source: $("#f-source").value.trim(),
    thumb: F.thumb || null, hasPhoto,
    createdAt: old?.createdAt || Date.now(), updatedAt: Date.now(),
    lastCooked: old?.lastCooked || null, cookCount: old?.cookCount || 0, fav: !!old?.fav,
  };
  $("#f-save").disabled = true; err.hidden = true;
  try {
    const ref = F.id ? S.db.doc("recipes/" + F.id) : S.db.collection("recipes").doc();
    if (F.photoChanged && F.photo) { await S.db.doc("photos/" + ref.id).set({ src: F.photo }); S.photos.set(ref.id, F.photo); }
    await ref.set(data);
    if (!hasPhoto && F.hadPhoto) { await S.db.doc("photos/" + ref.id).delete().catch(() => {}); S.photos.delete(ref.id); }
    closeSheet("form");
    toast(F.id ? "Gespeichert" : "Rezept hinzugefügt");
    if (!F.id) openDetail(ref.id);
  } catch (e) {
    $("#f-save").disabled = false;
    err.textContent = e?.code === "quota_exceeded" ? "Der Speicher ist voll. Lösche alte Rezepte oder Fotos." : e?.code === "invalid_argument" ? "Du darfst hier leider keine Rezepte speichern. Bitte den Besitzer der Seite, dich als Mitwirkenden einzuladen." : "Speichern hat nicht geklappt. Versuch es noch einmal.";
    err.hidden = false;
  }
}

/* ---------- Teilen als PDF ---------- */
let jsPdfPromise = null;
function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  jsPdfPromise ??= new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "vendor/jspdf.umd.min.js";
    sc.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error("jspdf"));
    sc.onerror = () => { jsPdfPromise = null; reject(new Error("jspdf")); };
    document.head.append(sc);
  });
  return jsPdfPromise;
}
// Die PDF-Standardschrift kennt nur Westeuropäisch (WinAnsi): Brüche und Sonderzeichen umschreiben.
const PDF_MAP = { "⅓": " 1/3", "⅔": " 2/3", "⅛": " 1/8", "✓": "", "→": "->", "×": "x", "−": "-" };
const pdfText = s => String(s ?? "").replace(/[⅓⅔⅛✓→×−]/g, c => PDF_MAP[c]).replace(/^ /, "")
  .replace(/[^\x09\x0A\x0D\x20-\xFF–—‘’‚“”„•…€]/g, "").replace(/(\d) (1\/[38]|2\/3)/g, "$1 $2");
function imageSize(src) {
  return new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = src; });
}
async function buildRecipePdf(r, serv) {
  const jsPDF = await loadJsPdf();
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 16, BOTTOM = H - 16;
  const C = { ultra: [63, 55, 255], cobalt: [2, 63, 165], mid: [36, 13, 87], violet: [89, 39, 149], sun: [251, 197, 7], paper: [236, 237, 223], muted: [110, 100, 130], line: [214, 212, 225] };
  const pt = n => n * 0.3528;
  const fill = c => pdf.setFillColor(...c), ink = c => pdf.setTextColor(...c);
  const font = (style, size) => { pdf.setFont("helvetica", style); pdf.setFontSize(size); };
  const sweet = r.kind === "süß";
  const baseServ = r.servings || 4, f = serv / baseServ;
  pdf.setProperties({ title: pdfText(r.title), subject: "Rezept", creator: "Nikikis Kochbuch" });

  // Kopf: Farbfeld mit Halftone-Raster, Titel in Versalien
  font("bold", 24);
  const titleLines = pdf.splitTextToSize(pdfText(r.title).toUpperCase(), W - 2 * M - 10);
  const lhTitle = pt(24) * 1.05;
  const bandH = 16 + titleLines.length * lhTitle + 14;
  fill(sweet ? C.violet : C.ultra); pdf.rect(0, 0, W, bandH, "F");
  fill(sweet ? C.mid : C.cobalt);
  for (let y = 3; y < bandH; y += 4) for (let x = W - 3; x > W - 90; x -= 4) {
    const d = Math.hypot((W - x) / 90, y / bandH);
    const rad = 1.3 * (1 - d / 1.05);
    if (rad > 0.15) pdf.circle(x, y, rad, "F");
  }
  ink(sweet ? C.sun : C.paper); font("bold", 24);
  pdf.text(titleLines, M, 16, { baseline: "top", lineHeightFactor: 1.05 });
  const meta = [sweet ? "Süß" : "Herzhaft", r.time ? `${r.time} Min.` : "", `${serv} ${serv === 1 ? "Portion" : "Portionen"}`].filter(Boolean).join("  ·  ");
  ink(C.sun); font("bold", 10);
  pdf.text(pdfText(meta).toUpperCase(), M, 16 + titleLines.length * lhTitle + 4, { baseline: "top" });

  let y = bandH + 10, page = 1;
  const footer = () => {
    font("normal", 8); ink(C.muted);
    pdf.text(pdfText("Aus Nikikis Kochbuch"), M, H - 9);
    pdf.text(`Seite ${page}`, W - M, H - 9, { align: "right" });
  };
  const ensure = h => { if (y + h > BOTTOM) { footer(); pdf.addPage(); page++; y = M; } };

  if ((r.tags || []).length) {
    font("bold", 9); ink(C.ultra);
    const tl = pdf.splitTextToSize(pdfText(r.tags.map(t => "#" + t.toUpperCase()).join("   ")), W - 2 * M);
    pdf.text(tl, M, y, { baseline: "top" }); y += tl.length * pt(9) * 1.3 + 6;
  }

  // Foto rechts, Zutaten links
  const photo = S.photos.get(r.id) || r.thumb;
  let photoBottom = y, colW = W - 2 * M;
  if (photo) {
    const size = await imageSize(photo);
    if (size) {
      const box = 68, ratio = size.w / size.h;
      const pw = ratio >= 1 ? box : box * ratio, ph = ratio >= 1 ? box / ratio : box;
      try { pdf.addImage(photo, "JPEG", W - M - pw, y, pw, ph); photoBottom = y + ph; colW = W - 2 * M - box - 8; } catch {}
    }
  }
  font("bold", 13); ink(C.mid);
  pdf.text("ZUTATEN", M, y, { baseline: "top" });
  font("normal", 9); ink(C.muted);
  pdf.text(f !== 1 ? `für ${serv} Portionen (Original: ${baseServ})` : `für ${serv} ${serv === 1 ? "Portion" : "Portionen"}`, M, y + pt(13) * 1.3, { baseline: "top" });
  y += pt(13) * 1.3 + pt(9) * 1.3 + 4;
  const amtW = 24;
  for (const i of r.ingredients || []) {
    if (i.h) {
      ensure(10); y += 2;
      font("bold", 8.5); ink(C.muted);
      pdf.text(pdfText(i.n).toUpperCase(), M, y, { baseline: "top" }); y += pt(8.5) * 1.4 + 1;
      continue;
    }
    const w = y < photoBottom ? colW : W - 2 * M;
    font("normal", 11);
    const lines = pdf.splitTextToSize(pdfText(i.n), w - amtW - 3);
    const h = lines.length * pt(11) * 1.25 + 2.6;
    ensure(h);
    const amt = pdfText([fmtAmount(i.a != null ? i.a * f : null, i.u), i.u].filter(Boolean).join(" "));
    font("bold", 10.5); ink(C.ultra);
    if (amt) pdf.text(amt, M + amtW, y, { baseline: "top", align: "right" });
    font("normal", 11); ink(C.mid);
    pdf.text(lines, M + amtW + 3, y, { baseline: "top", lineHeightFactor: 1.25 });
    y += h;
    pdf.setDrawColor(...C.line); pdf.setLineWidth(0.2); pdf.line(M, y - 1.3, M + w, y - 1.3);
  }
  y = Math.max(y, photoBottom) + 10;

  // Zubereitung mit Zahlen-Badges
  if ((r.steps || []).length) {
    ensure(20);
    font("bold", 13); ink(C.mid);
    pdf.text("ZUBEREITUNG", M, y, { baseline: "top" }); y += pt(13) * 1.3 + 4;
    r.steps.forEach((st, n) => {
      font("normal", 11);
      const lines = pdf.splitTextToSize(pdfText(st), W - 2 * M - 12);
      const h = Math.max(8, lines.length * pt(11) * 1.3) + 4;
      ensure(h);
      fill(C.mid); pdf.roundedRect(M, y, 8, 8, 1.8, 1.8, "F");
      font("bold", 10); ink(C.sun);
      pdf.text(String(n + 1), M + 4, y + 4, { align: "center", baseline: "middle" });
      font("normal", 11); ink(C.mid);
      pdf.text(lines, M + 12, y + 1.2, { baseline: "top", lineHeightFactor: 1.3 });
      y += h;
    });
    y += 4;
  }

  if (r.note) {
    font("normal", 10.5);
    const lines = pdf.splitTextToSize(pdfText(r.note), W - 2 * M - 10);
    const h = lines.length * pt(10.5) * 1.3 + 14;
    ensure(h);
    fill(C.paper); pdf.rect(M, y, W - 2 * M, h, "F");
    font("bold", 8.5); ink(C.muted); pdf.text("NOTIZ", M + 5, y + 4, { baseline: "top" });
    font("normal", 10.5); ink(C.mid); pdf.text(lines, M + 5, y + 9, { baseline: "top", lineHeightFactor: 1.3 });
    y += h + 6;
  }
  if (r.source) {
    font("normal", 9); ink(C.muted);
    const lines = pdf.splitTextToSize(pdfText("Quelle: " + r.source), W - 2 * M);
    ensure(lines.length * 4 + 2);
    pdf.text(lines, M, y, { baseline: "top" });
  }
  footer();
  return pdf.output("blob");
}
const pdfName = t => (norm(t).replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rezept") + ".pdf";
let shareCache = null;
async function shareRecipe() {
  const D = S.detail, r = S.recipes.find(x => x.id === D?.id);
  if (!r) return;
  const serv = D.servings ?? (r.servings || 4);
  const key = `${r.id}|${serv}|${r.updatedAt || ""}|${S.photos.has(r.id)}`;
  let file = shareCache?.key === key ? shareCache.file : null;
  if (!file) {
    toast("PDF wird erstellt …");
    try { file = new File([await buildRecipePdf(r, serv)], pdfName(r.title), { type: "application/pdf" }); }
    catch { toast("Das PDF konnte nicht erstellt werden."); return; }
    shareCache = { key, file };
  }
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: r.title, text: `Rezept: ${r.title}` }); return; }
    catch (e) {
      if (e?.name === "AbortError") return;
      if (e?.name === "NotAllowedError") { toast("PDF ist fertig. Tippe noch einmal auf Teilen."); return; }
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("PDF gespeichert");
}

/* ---------- Aktionen ---------- */
async function markCooked() {
  const r = S.recipes.find(x => x.id === S.detail?.id);
  if (!r) return;
  try { await S.db.doc("recipes/" + r.id).update({ lastCooked: Date.now(), cookCount: (r.cookCount || 0) + 1 }); toast("Als heute gekocht gemerkt"); }
  catch { toast("Konnte nicht gespeichert werden"); }
}
async function deleteRecipe() {
  const id = S.detail?.id;
  if (!id) return;
  try {
    await S.db.doc("recipes/" + id).delete();
    await S.db.doc("photos/" + id).delete().catch(() => {});
    closeSheet("detail"); toast("Rezept gelöscht");
  } catch { toast("Löschen hat nicht geklappt"); }
}
function resetFilters() { S.q = ""; $("#q").value = ""; $("#qclear").hidden = true; S.kind = "alle"; S.tags.clear(); S.ings = []; S.favOnly = false; render(); }
async function toggleFav() {
  const r = S.recipes.find(x => x.id === S.detail?.id);
  if (!r) return;
  try { await S.db.doc("recipes/" + r.id).update({ fav: !r.fav }); toast(r.fav ? "Aus Favoriten entfernt" : "Zu Favoriten hinzugefügt"); }
  catch { toast("Konnte nicht gespeichert werden"); }
}

document.addEventListener("click", e => {
  const t = e.target.closest("button, [data-open]");
  if (!t) return;
  const d = t.dataset;
  if (d.open) return openDetail(d.open);
  if (d.close) return closeSheet(d.close);
  if (d.kind) { S.kind = d.kind; return render(); }
  if (d.tag) { S.tags.has(d.tag) ? S.tags.delete(d.tag) : S.tags.add(d.tag); return render(); }
  if (d.addIng !== undefined || t.hasAttribute("data-adding")) {
    const n = t.getAttribute("data-adding");
    if (!S.ings.includes(n)) S.ings.push(n);
    S.q = ""; $("#q").value = ""; $("#qclear").hidden = true; return render();
  }
  if (t.hasAttribute("data-rming")) { const n = t.getAttribute("data-rming"); S.ings = S.ings.filter(x => x !== n); return render(); }
  if (t.id === "resetall" || d.action === "reset") return resetFilters();
  if (d.serv && S.detail) {
    const r = S.recipes.find(x => x.id === S.detail.id);
    S.detail.servings = Math.min(50, Math.max(1, (S.detail.servings ?? (r?.servings || 4)) + +d.serv));
    return renderDetail();
  }
  if (d.mode) { stashDraft(); S.draft.mode = d.mode; S.draft.error = ""; return renderAdd(); }
  if (d.rmimg) { const im = S.draft.images.splice(+d.rmimg, 1)[0]; if (im) URL.revokeObjectURL(im.url); return renderAdd(); }
  if (d.addtag) {
    const cur = cleanTags($("#f-tags").value.split(/[,;\n]/));
    cur.push(d.addtag); $("#f-tags").value = cur.join(", "); return renderFormBits();
  }
  if (d.k && S.form) { S.form.kind = d.k; return renderFormBits(); }
  switch (d.action) {
    case "add": return openAdd();
    case "settings": $("#importmsg").textContent = ""; return openSheet("settings");
    case "logout": return signOut(auth).then(() => location.reload());
    case "export": return exportAll();
    case "manual": closeSheet("add"); return openForm({ kind: S.kind === "süß" ? "süß" : "herzhaft", servings: 4 });
    case "recognize": return recognize();
    case "stop": S.draft.token = null; S.draft.busy = false; return renderAdd();
    case "reroll": { const r = pickRandom(); if (r) { S.detail = { id: r.id, servings: null, fromRandom: true, doneI: new Set(), doneS: new Set(), confirmDel: false }; renderDetail(); $("#detail").scrollTop = 0; loadPhoto(r.id); } return; }
    case "cooked": return markCooked();
    case "fav": return toggleFav();
    case "favfilter": S.favOnly = !S.favOnly; return render();
    case "share": return shareRecipe();
    case "edit": { const r = S.recipes.find(x => x.id === S.detail.id); if (r) openForm(r, { id: r.id }); return; }
    case "delete": S.detail.confirmDel = true; return renderDetail();
    case "delete-no": S.detail.confirmDel = false; return renderDetail();
    case "delete-yes": return deleteRecipe();
  }
});
// Zutaten und Schritte abhaken
$("#detail").addEventListener("click", e => {
  const li = e.target.closest("li[data-ing], li[data-step]");
  if (!li || !S.detail) return;
  const set = li.dataset.ing != null ? S.detail.doneI : S.detail.doneS;
  const n = +(li.dataset.ing ?? li.dataset.step);
  set.has(n) ? set.delete(n) : set.add(n);
  li.classList.toggle("done");
});

$("#dice").addEventListener("click", roll);
$("#fab").addEventListener("click", openAdd);
$("#q").addEventListener("input", e => { S.q = e.target.value; $("#qclear").hidden = !S.q; render(); });
$("#q").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    const q = norm(S.q);
    if (q && S.recipes.some(r => ingNames(r).some(n => n.includes(q))) && !S.recipes.some(r => norm(r.title).includes(q))) {
      S.ings.push(q); S.q = ""; e.target.value = ""; $("#qclear").hidden = true; render();
    }
    e.target.blur();
  }
});
$("#qclear").addEventListener("click", () => { S.q = ""; $("#q").value = ""; $("#qclear").hidden = true; render(); $("#q").focus(); });
$("#sort").addEventListener("change", e => { S.sort = e.target.value; store.set("kb.sort", S.sort); render(); });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  for (const id of ["form", "add", "detail"]) if (!$("#" + id).hidden) return closeSheet(id);
});

// Hinzufügen: Dateien und Einfügen
$("#add").addEventListener("change", e => { if (e.target.id === "addfiles") addFiles(e.target.files); });
$("#add").addEventListener("dragover", e => { if (S.draft?.mode === "bild") { e.preventDefault(); $("#drop")?.classList.add("over"); } });
$("#add").addEventListener("drop", e => { if (S.draft?.mode === "bild") { e.preventDefault(); addFiles(e.dataTransfer.files); } });
$("#add").addEventListener("paste", e => {
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
  if (files.length && S.ai) { e.preventDefault(); S.draft.mode = "bild"; addFiles(files); }
});

// Formular
$("#recipeform").addEventListener("submit", saveForm);
$("#f-tags").addEventListener("input", () => renderFormBits());
$("#f-title").addEventListener("input", () => { if (!S.form?.thumb) renderFormBits(); });
$("#f-photofile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try { const p = await makePhoto(f); Object.assign(S.form, { photo: p.src, thumb: p.thumb, photoChanged: true }); renderFormBits(); }
  catch { toast("Dieses Bild konnte nicht gelesen werden"); }
});
$("#f-photodel").addEventListener("click", () => { Object.assign(S.form, { photo: null, thumb: null, photoChanged: false }); renderFormBits(); });

/* ---------- Sichern und Importieren ---------- */
async function exportAll() {
  const out = { version: 1, exportedAt: new Date().toISOString(), recipes: [] };
  for (const r of S.recipes) {
    const { id, ...data } = r;
    let photo = S.photos.get(id) || null;
    if (!photo && r.hasPhoto) { try { const p = await getDoc(doc(fs, "photos", id)); photo = p.exists() ? p.data().src : null; } catch {} }
    out.recipes.push({ id, data, photo });
  }
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kochbuch-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("#importfile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  const msg = $("#importmsg");
  if (!f) return;
  try {
    const json = JSON.parse(await f.text());
    const list = Array.isArray(json.recipes) ? json.recipes : [];
    let n = 0;
    for (const item of list) {
      const id = String(item.id || "").replace(/[^A-Za-z0-9_-]/g, "") || doc(collection(fs, "recipes")).id;
      const data = item.data && typeof item.data === "object" ? item.data : null;
      if (!data?.title) continue;
      const batch = writeBatch(fs);
      if (item.photo) batch.set(doc(fs, "photos", id), { src: item.photo });
      batch.set(doc(fs, "recipes", id), { ...data, hasPhoto: !!(item.photo || data.hasPhoto) });
      await batch.commit();
      n++;
    }
    msg.textContent = n ? `${n} ${n === 1 ? "Rezept" : "Rezepte"} importiert.` : "In der Datei wurden keine Rezepte gefunden.";
  } catch {
    msg.textContent = "Die Datei konnte nicht gelesen werden. Wähle eine Sicherungsdatei des Kochbuchs.";
  }
});

/* ---------- Start ---------- */
const wrapDoc = ref => ({
  id: ref.id,
  get: async () => { const s = await getDoc(ref); return { exists: s.exists(), data: () => s.data() }; },
  set: data => setDoc(ref, data),
  update: data => updateDoc(ref, data),
  delete: () => deleteDoc(ref),
});
let fs, auth;
const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("HIER");
render();
if (!configured) {
  S.status = "nodb"; render();
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  S.db = {
    doc: path => wrapDoc(doc(fs, path)),
    collection: name => ({ doc: id => wrapDoc(id ? doc(fs, name, id) : doc(collection(fs, name))) }),
  };
  S.ai = httpsCallable(getFunctions(app, FUNCTIONS_REGION), "recognizeRecipe", { timeout: 180000 });
  let unsub = null;
  onAuthStateChanged(auth, user => {
    $("#gate").hidden = !!user;
    if (!user) { unsub?.(); unsub = null; setTimeout(() => $("#gatepw").focus(), 50); return; }
    S.canWrite = true;
    if (!unsub) unsub = onSnapshot(collection(fs, "recipes"), snap => {
      S.recipes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      S.status = "ready";
      render();
    }, () => { S.status = S.recipes.length ? "ready" : "error"; render(); });
  });
  $("#gateform").addEventListener("submit", async e => {
    e.preventDefault();
    const pw = $("#gatepw").value, err = $("#gateerr");
    if (!pw) return;
    $("#gatebtn").disabled = true; err.hidden = true;
    try { await signInWithEmailAndPassword(auth, FAMILY_EMAIL, pw); $("#gatepw").value = ""; }
    catch (ex) {
      const c = ex?.code || "";
      err.textContent = ["auth/invalid-credential", "auth/wrong-password", "auth/invalid-login-credentials"].includes(c) ? "Das Passwort stimmt nicht."
        : c === "auth/user-not-found" ? "Das Familienkonto familie@kochbuch.example gibt es in Firebase noch nicht."
        : c === "auth/operation-not-allowed" ? "In Firebase ist die Anmeldung mit E-Mail/Passwort noch nicht eingeschaltet."
        : c === "auth/too-many-requests" ? "Zu viele Versuche. Warte ein paar Minuten und versuch es dann noch einmal."
        : c === "auth/network-request-failed" ? "Keine Internetverbindung."
        : `Anmeldung fehlgeschlagen (${c || "unbekannter Fehler"}).`;
      err.hidden = false;
    } finally { $("#gatebtn").disabled = false; }
  });
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
