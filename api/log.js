// Vercel Serverless Function  →  POST /api/log   body: { "entry": "<teks log>" }
// Environment Variables:
//   GH_TOKEN        token fine-grained, Contents: Read and write, khusus repo log
//   GH_OWNER        username GitHub
//   GH_REPO         nama repo PRIVATE untuk log
//   GH_BRANCH       opsional, default "main"
//   ALLOWED_ORIGIN  opsional, mis. https://nama-project.vercel.app

const LOG_FILE = "log.txt";
const SEP = "----------------------------------------";
const HEADER = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} WIB\] File (has been upload|failed to upload)$/;
const LINE = /^(Status|Nama|Format|Ukuran|Link|Error|Server|Durasi|Bahasa|Perangkat) *: .{0,250}$/;

const toB64 = s => Buffer.from(s, "utf8").toString("base64");
const fromB64 = s => Buffer.from(s.replace(/\s/g, ""), "base64").toString("utf8");

// hanya terima entri yang bentuknya persis format log, supaya tidak bisa menyisipkan teks bebas
function clean(entry) {
  if (typeof entry !== "string" || entry.length > 1800) return null;
  const lines = entry.replace(/\r/g, "").trim().split("\n");
  if (lines.length < 6 || lines.length > 12) return null;
  if (!HEADER.test(lines[0])) return null;
  if (!lines.slice(1).every(l => LINE.test(l))) return null;
  return lines.join("\n") + "\n" + SEP + "\n";
}

async function appendLog(text, tries = 3) {
  const { GH_TOKEN, GH_OWNER, GH_REPO } = process.env;
  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) return false;
  const branch = process.env.GH_BRANCH || "main";
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${LOG_FILE}`;
  const h = { Authorization: "Bearer " + GH_TOKEN, Accept: "application/vnd.github+json", "User-Agent": "uploader-log" };
  for (let i = 0; i < tries; i++) {
    let sha, old = "=== UPLOAD LOG ===\n" + SEP + "\n";
    const g = await fetch(`${url}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`, { headers: h });
    if (g.ok) {
      const j = await g.json();
      sha = j.sha;
      old = j.content ? fromB64(j.content) : await (await fetch(j.download_url)).text();
    } else if (g.status !== 404) return false;
    const body = { message: "log upload", content: toB64(old + text), branch };
    if (sha) body.sha = sha;
    const p = await fetch(url, { method: "PUT", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (p.ok) return true;
    if (p.status !== 409 && p.status !== 422) return false; // ulang hanya kalau bentrok versi
    await new Promise(r => setTimeout(r, 400 * (i + 1)));
  }
  return false;
}

module.exports = async function handler(req, res) {
  const send = (code, obj) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
  if (req.method !== "POST") return send(405, { ok: false, message: "gunakan POST" });
  if (process.env.ALLOWED_ORIGIN && req.headers.origin !== process.env.ALLOWED_ORIGIN)
    return send(403, { ok: false, message: "origin tidak diizinkan" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const text = clean(body && body.entry);
  if (!text) return send(400, { ok: false, message: "format log tidak valid" });

  try {
    const ok = await appendLog(text); // harus di-await, Vercel membekukan fungsi setelah respons
    return send(ok ? 200 : 502, { ok });
  } catch (e) {
    return send(502, { ok: false, message: e.message });
  }
};

