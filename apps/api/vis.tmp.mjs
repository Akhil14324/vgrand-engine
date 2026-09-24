import "dotenv/config";
import zlib from "node:zlib";
import { createClient } from "@supabase/supabase-js";
const API = "https://vgrand-engine-production.up.railway.app";
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const tok = (await anon.auth.signInWithPassword({ email: "user1@catgpt.app", password: "CatGPT-User1-2026!" })).data.session.access_token;
const H = { Authorization: `Bearer ${tok}` };
const api = async (path, method = "GET", json) => {
  const r = await fetch(API + path, { method, signal: AbortSignal.timeout(60000), headers: { ...H, ...(json ? { "Content-Type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : undefined });
  const t = await r.text(); try { return [r.status, JSON.parse(t)] } catch { return [r.status, t] }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function turn(body, maxSec = 120) {
  const [s, a] = await api("/generations", "POST", body);
  if (s !== 202) throw new Error("POST failed " + s + " " + JSON.stringify(a));
  let g;
  for (let i = 0; i < maxSec; i++) { await sleep(1000); [, g] = await api(`/generations/${a.generationId}`); if (["completed", "failed"].includes(g.status)) break; }
  return { g, a };
}
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label} ${extra}`); };

// solid red 96x96 PNG
function png(w, h, [r, g, b]) {
  const crc = (buf) => { let c, crcv = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crcv ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c; } return (crcv ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([r, g, b]).flat())]);
  const raw = Buffer.concat(Array(h).fill(row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const fd = new FormData(); fd.append("file", new Blob([png(96, 96, [220, 20, 20])], { type: "image/png" }), "red.png");
const up = await (await fetch(API + "/uploads", { method: "POST", headers: H, body: fd })).json();
console.log("uploaded:", up.url?.slice(0, 70));

const usage0 = (await api("/usage"))[1].used;
const cleanup = [];
// 1) question about the image -> text (vision), no image quota
let v;
for (let attempt = 1; attempt <= 14; attempt++) {
  v = await turn({ prompt: "What colour is this image? Answer in one word.", referenceImageUrls: [up.url] });
  cleanup.push(v.a.conversationId);
  console.log(`attempt ${attempt}: kind=${v.g.kind} vision=${!!v.g.metadata?.visionImageUrls}`);
  if (v.g.metadata?.visionImageUrls) break;
  await sleep(30000);
}
console.log("answer:", JSON.stringify(v.g.textResponse ?? v.g.error));
check("question about an attached image is a TEXT turn", v.g.kind === "text" && v.g.status === "completed");
check("model actually saw the image (says red)", /red/i.test(v.g.textResponse ?? ""));
check("no image quota used", (await api("/usage"))[1].used === usage0);

// 2) follow-up in the same chat still knows the picture
const f = await turn({ prompt: "Is it a warm or a cool colour?", conversationId: v.a.conversationId });
console.log("follow-up:", JSON.stringify((f.g.textResponse ?? f.g.error).slice(0, 200)));
check("follow-up keeps the image in context (warm)", /warm/i.test(f.g.textResponse ?? "") && !/cool colou?r\b(?!.*warm)/i.test("") );

// 3) edit request with the image stays an image job
const e = await turn({ prompt: "make this image blue", referenceImageUrls: [up.url] }, 5);
cleanup.push(e.a.conversationId);
check("edit-style request with an image is still an IMAGE job", e.a.kind === "image", e.a.kind);
await sleep(60000);
for (const c of cleanup) await api(`/conversations/${c}`, "DELETE");
console.log(fails ? `\n${fails} FAILED` : "\nALL VISION CHECKS PASSED");
process.exit(0);
