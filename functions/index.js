// Server-Funktion für die KI-Erkennung: Foto, Text oder Link → strukturiertes Rezept.
// Der Claude-API-Schlüssel liegt als Secret ANTHROPIC_API_KEY in Firebase, nie im Browser.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const FAMILY_EMAIL = "familie@kochbuch.example";
const MODEL = "claude-opus-5-5";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const nullable = type => ({ anyOf: [{ type }, { type: "null" }] });
const RECIPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "kind", "servings", "time", "tags", "ingredients", "steps", "note", "source", "dishPhoto", "error"],
  properties: {
    title: { type: "string" },
    kind: { type: "string", enum: ["herzhaft", "süß"] },
    servings: { type: "number" },
    time: nullable("number"),
    tags: { type: "array", items: { type: "string" } },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["amount", "unit", "name", "group"],
        properties: { amount: nullable("number"), unit: { type: "string" }, name: { type: "string" }, group: nullable("string") },
      },
    },
    steps: { type: "array", items: { type: "string" } },
    note: nullable("string"),
    source: nullable("string"),
    dishPhoto: nullable("integer"),
    error: nullable("string"),
  },
};

function rules(knownTags, withImages) {
  return `Regeln:
- Alles auf Deutsch (übersetzen, falls nötig). Titel kurz und natürlich.
- kind: "süß" für Kuchen, Desserts, Süßspeisen, süßes Frühstück; sonst "herzhaft".
- servings: Portionen laut Rezept; wenn nicht angegeben, sinnvoll schätzen (meist 4). time: Gesamtzeit in Minuten oder null.
- ingredients: amount als Zahl (½ = 0.5, "1-2" = 1.5), sonst null (z. B. "Salz nach Geschmack"). unit kurz: g, kg, ml, l, EL, TL, Prise, Stück, Dose, Bund, Pck., Zehe, Scheibe, Becher – oder "" wenn keine. name ohne Menge, z. B. "Hähnchenbrustfilet", "Zwiebel, fein gewürfelt". group: Zwischenüberschrift wie "Für den Teig", sonst null.
- steps: klare, kurze Arbeitsschritte ohne Nummerierung.
- tags: 3 bis 6 Kategorien, klein geschrieben, ohne #, ohne "süß"/"herzhaft". Nimm vorhandene Kategorien, wenn sie passen: ${knownTags.length ? knownTags.join(", ") : "(noch keine)"}. Weitere typische: vegetarisch, vegan, fleisch, hähnchen, fisch, nudeln, reis, kartoffeln, suppe, salat, auflauf, eintopf, ofen, schnell, kuchen, backen, dessert, frühstück, asiatisch, italienisch, kinderliebling, meal-prep.
- note: wichtige Tipps oder Varianten aus der Vorlage, sonst null.
- source: Name des Kochbuchs, der Website oder des Autors, falls erkennbar, sonst null.
- dishPhoto: ${withImages ? "0-basierter Index des Bildes, das das fertige Gericht als Foto zeigt (nicht nur Text). Wenn keines, null." : "null"}
- Wenn kein Rezept erkennbar ist: "error" mit kurzer Erklärung auf Deutsch, title leer, Listen leer.`;
}

/* ---------- Link: Seite laden ---------- */
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function findRecipe(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n); if (r) return r; } return null; }
  const t = node["@type"];
  if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return node;
  return findRecipe(node["@graph"]) || null;
}
function imageUrlOf(img) {
  if (!img) return null;
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return imageUrlOf(img[img.length - 1]);
  return img.url || img.contentUrl || null;
}
async function fetchWithTimeout(url, ms, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal, redirect: "follow", headers: { "User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9", ...(opts.headers || {}) } }); }
  finally { clearTimeout(t); }
}
async function loadPage(url) {
  const res = await fetchWithTimeout(url, 15000, { headers: { Accept: "text/html,application/xhtml+xml" } });
  if (!res.ok) throw new Error("status " + res.status);
  const html = (await res.text()).slice(0, 3_000_000);
  let recipe = null;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { recipe = findRecipe(JSON.parse(m[1].trim())); } catch {}
    if (recipe) break;
  }
  const og = html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  let imageUrl = imageUrlOf(recipe?.image) || (og ? decodeEntities(og[1]) : null);
  if (imageUrl) { try { imageUrl = new URL(imageUrl, res.url).href; } catch { imageUrl = null; } }
  let content;
  if (recipe) {
    const pick = ["name", "description", "author", "recipeYield", "totalTime", "prepTime", "cookTime", "recipeCategory", "recipeCuisine", "keywords", "recipeIngredient", "recipeInstructions"];
    content = "Strukturierte Rezeptdaten (schema.org) der Seite:\n" + JSON.stringify(Object.fromEntries(pick.filter(k => recipe[k] != null).map(k => [k, recipe[k]]))).slice(0, 60000);
  } else {
    const text = decodeEntities(html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text.length < 200) throw new Error("too little text");
    content = "Text der Seite:\n" + text.slice(0, 60000);
  }
  return { content, imageUrl, finalUrl: res.url };
}
async function loadImage(url) {
  if (!url) return null;
  try {
    const res = await fetchWithTimeout(url, 10000, { headers: { Accept: "image/*" } });
    const type = (res.headers.get("content-type") || "").split(";")[0];
    if (!res.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 6_000_000) return null;
    return { type, data: buf.toString("base64") };
  } catch { return null; }
}

/* ---------- Claude ---------- */
function readJson(response) {
  if (response.stop_reason === "refusal") throw new HttpsError("invalid-argument", "Dieses Rezept konnte nicht verarbeitet werden.");
  const text = response.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new HttpsError("internal", "Die Antwort der KI war unvollständig. Versuch es noch einmal.");
}
async function extract(client, content) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: RECIPE_SCHEMA } },
    messages: [{ role: "user", content }],
  });
  return readJson(response);
}
// Wenn eine Seite den direkten Abruf blockiert: Claude holt sie über das Web-Fetch-Werkzeug.
async function extractViaWebFetch(client, url, prompt) {
  const messages = [{ role: "user", content: `${prompt}\n\nRufe diese Seite mit dem Web-Fetch-Werkzeug ab und lies das Rezept: ${url}\n\nAntworte am Ende NUR mit dem JSON-Objekt. Zusätzliches Feld "imageUrl": URL des Hauptfotos des Gerichts, falls auf der Seite erkennbar, sonst null.` }];
  for (let i = 0; i < 4; i++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 }],
      messages,
    });
    if (response.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: response.content }); continue; }
    return readJson(response);
  }
  throw new HttpsError("deadline-exceeded", "Die Seite konnte nicht rechtzeitig gelesen werden.");
}

export const recognizeRecipe = onCall(
  { region: "europe-west3", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 180, memory: "512MiB", maxInstances: 5 },
  async request => {
    if (request.auth?.token?.email !== FAMILY_EMAIL) throw new HttpsError("permission-denied", "Nicht angemeldet.");
    const key = ANTHROPIC_API_KEY.value();
    if (!key) throw new HttpsError("failed-precondition", "Der Claude-API-Schlüssel fehlt noch (siehe SETUP.md).");
    const client = new Anthropic({ apiKey: key });

    const d = request.data || {};
    const knownTags = (Array.isArray(d.knownTags) ? d.knownTags : []).map(String).slice(0, 60);
    const hint = typeof d.hint === "string" ? d.hint.slice(0, 500) : "";
    const images = (Array.isArray(d.images) ? d.images : []).slice(0, 4)
      .filter(i => i && typeof i.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(i.type));
    const intro = "Du hilfst einer Familie, ihr Kochbuch zu pflegen. Lies das Rezept und gib es als JSON zurück.";
    const hintLine = hint ? `\n\nHinweis der Familie: ${hint}` : "";

    try {
      if (images.length) {
        const content = [
          ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.type, data: i.data } })),
          { type: "text", text: `${intro} Du bekommst ${images.length} Bild(er) (Fotos oder Screenshots) eines Rezepts.\n\n${rules(knownTags, true)}${hintLine}` },
        ];
        return { recipe: await extract(client, content) };
      }
      if (typeof d.text === "string" && d.text.trim()) {
        return { recipe: await extract(client, `${intro} Du bekommst einen Rezepttext.\n\n${rules(knownTags, false)}${hintLine}\n\nRezepttext:\n"""\n${d.text.slice(0, 60000)}\n"""`) };
      }
      if (typeof d.url === "string" && /^https?:\/\//i.test(d.url)) {
        const url = d.url.trim();
        let page = null;
        try { page = await loadPage(url); } catch {}
        let recipe, imageUrl = page?.imageUrl || null;
        if (page) {
          recipe = await extract(client, `${intro} Du bekommst den Inhalt einer Rezept-Website (${url}).\n\n${rules(knownTags, false)}${hintLine}\n\n${page.content}`);
        } else {
          recipe = await extractViaWebFetch(client, url, `${intro}\n\nGib ein JSON-Objekt mit genau diesen Feldern zurück: title, kind, servings, time, tags, ingredients (amount, unit, name, group), steps, note, source, dishPhoto, error.\n\n${rules(knownTags, false)}${hintLine}`);
          imageUrl = typeof recipe.imageUrl === "string" ? recipe.imageUrl : null;
          delete recipe.imageUrl;
        }
        if (!recipe.source) { try { recipe.source = new URL(url).hostname.replace(/^www\./, ""); } catch {} }
        return { recipe, image: await loadImage(imageUrl) };
      }
      throw new HttpsError("invalid-argument", "Es wurde kein Bild, Text oder Link übergeben.");
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new HttpsError("failed-precondition", "Der Claude-API-Schlüssel ist ungültig (siehe SETUP.md).");
      if (e instanceof Anthropic.RateLimitError) throw new HttpsError("resource-exhausted", "Gerade zu viele Anfragen. Versuch es in einer Minute noch einmal.");
      if (e instanceof Anthropic.BadRequestError && /credit/i.test(e.message)) throw new HttpsError("resource-exhausted", "Das Guthaben des Claude-API-Kontos ist aufgebraucht.");
      if (e instanceof Anthropic.APIError) { console.error("Claude API", e.status, e.message); throw new HttpsError("unavailable", "Die KI ist gerade nicht erreichbar. Versuch es gleich noch einmal."); }
      console.error(e);
      throw new HttpsError("internal", "Die Erkennung hat nicht geklappt.");
    }
  }
);
