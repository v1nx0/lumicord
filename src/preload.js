// Runs in the Discord window before the page. Gives the page a small file/network API, then loads our renderer.
const { contextBridge, webFrame, shell, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const root = path.join(__dirname, "..");
const logLine = (where, ...a) => { try { fs.appendFileSync(path.join(root, "lumicord.log"), `[${new Date().toISOString()}] [${where}] ${a.join(" ")}\n`); } catch { } };
logLine("preload", "start", location.href, "profile:", process.env.LUMICORD_PROFILE || "(shared)");
// "Don't share" option: the installer's loader sets LUMICORD_PROFILE (e.g. "DiscordPTB") so this Discord version
// gets its own plugins, themes, data and settings under profiles\<name>. Without it, all versions share one set.
const profile = /^[\w-]{1,40}$/.test(process.env.LUMICORD_PROFILE || "") ? process.env.LUMICORD_PROFILE : null;
const addonRoot = profile ? path.join(root, "profiles", profile) : root;
const dirs = { plugin: path.join(addonRoot, "plugins"), theme: path.join(addonRoot, "themes") };
const dataDir = path.join(addonRoot, "data");
const settingsPath = path.join(addonRoot, "settings.json");
for (const d of [...Object.values(dirs), dataDir]) fs.mkdirSync(d, { recursive: true });

const readJSON = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
// Write to a temp file and rename over the target, so a crash mid-write never leaves a half-written JSON file.
const writeJSON = (p, obj) => { const tmp = p + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, p); };
// Names come from the page or the network: allow only plain file names with the right extension.
const safeName = (name, type) => {
    const base = path.basename(String(name));
    const ok = type === "theme" ? /^[\w.\- ]+\.css$/ : /^[\w.\- ]+\.js$/;
    if (!ok.test(base)) throw new Error("Bad file name: " + base);
    return base;
};
const dataFile = name => path.join(dataDir, String(name).replace(/[^\w.\-]/g, "_") + ".json");

// Plugin fetches to this machine or the local network (router pages, localhost services...) need the user's OK.
const dns = require("dns");
const net = require("net");
const privateIp = ip => {
    ip = String(ip).replace(/^\[|\]$/g, "").toLowerCase();
    const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
    if (net.isIPv4(v4)) {
        const [a, b] = v4.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128);
    }
    return ip === "::" || ip === "::1" || /^(fc|fd|fe[89ab]|ff)/.test(ip);
};
const blocked = () => new Error("Lumicord: access to this local address was denied");
// Local addresses need the user's OK (a native dialog in the main process, remembered per address).
const localOk = (u, who) => ipcRenderer.invoke("LUMICORD_LOCAL_ACCESS", u.host, who).catch(() => false);
const guardedLookup = (u, who) => (host, o, cb) => dns.lookup(host, o, (err, addr, fam) => {
    if (err) return cb(err);
    const list = Array.isArray(addr) ? addr.map(a => a.address) : [addr];
    if (!list.some(privateIp)) return cb(null, addr, fam);
    localOk(u, who).then(ok => ok ? cb(null, addr, fam) : cb(blocked()));
});

// HTTP(S) request with redirects and a timeout. Resolves for any status; get() below requires 200.
// opts.publicOnly: local/private addresses need the user's OK, on every redirect too (opts.who names the plugin).
function request(url, opts = {}, redirects = 5) {
    const u0 = new URL(url);
    if (opts.publicOnly && (privateIp(u0.hostname) || /^localhost$|\.localhost$/i.test(u0.hostname)) && !opts._localOk)
        return localOk(u0, opts.who).then(ok => { if (!ok) throw blocked(); return request(url, Object.assign({}, opts, { _localOk: u0.host }), redirects); });
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = u.protocol === "http:" ? http : u.protocol === "https:" ? https : null;
        if (!lib) return reject(new Error("Only http(s) URLs"));
        const req = lib.request(u, { method: opts.method || "GET", headers: Object.assign({ "User-Agent": "Lumicord" }, opts.headers), lookup: opts.publicOnly && opts._localOk !== u.host ? guardedLookup(u, opts.who) : undefined }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
                res.resume();
                const next = new URL(res.headers.location, url);
                // like browsers: 303 becomes a plain GET; another host never gets our headers or body
                const keep = res.statusCode !== 303 && next.host === u.host;
                return resolve(request(next.href, keep ? opts : { publicOnly: opts.publicOnly, timeout: opts.timeout, who: opts.who }, redirects - 1));
            }
            const chunks = []; res.on("data", c => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, statusText: res.statusMessage || "", body: Buffer.concat(chunks), headers: res.headers }));
        });
        req.setTimeout(opts.timeout || 30000, () => req.destroy(new Error("Request timed out")));
        req.on("error", reject);
        if (opts.body != null) req.write(typeof opts.body === "string" ? opts.body : Buffer.from(opts.body));
        req.end();
    });
}
const get = async url => { const r = await request(url); if (r.status !== 200) throw new Error("HTTP " + r.status); return r; };

// betterdiscord.app pages are SvelteKit; __data.json stores objects as index references into one flat array.
function decodeSvelte(json) {
    const node = json.nodes.find(n => n && n.data && n.data[0] && "addons" in n.data[0]);
    if (!node) throw new Error("Store format changed");
    const d = node.data, seen = new Map();
    const h = i => {
        if (i === -1) return undefined; // SvelteKit's encoded undefined sentinel
        if (typeof i !== "number" || i < 0) return i;
        if (seen.has(i)) return seen.get(i);
        const v = d[i];
        if (Array.isArray(v)) { const a = []; seen.set(i, a); v.forEach(x => a.push(h(x))); return a; }
        if (v && typeof v === "object") { const o = {}; seen.set(i, o); for (const k in v) o[k] = h(v[k]); return o; }
        return v;
    };
    return h(0).addons;
}

// File access for BetterDiscord plugins' require("fs"): only inside Lumicord's plugins, themes and data folders.
const allowed = [dirs.plugin, dirs.theme, dataDir].map(d => path.resolve(d).toLowerCase() + path.sep);
const safePath = p => {
    const full = path.resolve(String(p));
    if (!allowed.some(a => (full.toLowerCase() + path.sep).startsWith(a))) throw new Error("Lumicord: access outside the addon folders is blocked: " + full);
    return full;
};

// ---------------------------------------------------------------- updater
// A release on GitHub carries "lumicord-update.json": { version, files: { "src/x.js": { sha256, data(base64) } } }.
// Only files under src/ and vencord/ may be replaced; each is checked against its sha256 before anything is written.
const crypto = require("crypto");
const versionPath = path.join(root, "version.json");
const versionInfo = () => readJSON(versionPath, { version: "0.0.0", repo: "v1nx0/lumicord" });
const newer = (a, b) => { // is version a newer than b?
    const pa = String(a).replace(/^v/, "").split(".").map(Number), pb = String(b).replace(/^v/, "").split(".").map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
    return false;
};
// Updates must be signed with Lumicord's private key (kept off GitHub), so a changed release asset is refused.
const UPDATE_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEALwP4iDIxeZdJr2TlK4POZhjDZEwzjCgECXeAV94ffPI=\n-----END PUBLIC KEY-----\n";
// keep in sync with release.js
const signedText = (version, files) => "lumicord-update\n" + version + "\n" + Object.keys(files).sort().map(k => k + " " + files[k].sha256).join("\n");
const updatableFile = rel => /^(src\/[\w.\-]+\.js|vencord\/[\w.\-]+\.(js|css|txt)|vencord\/LICENSE|version\.json)$/.test(rel);

async function checkUpdate() {
    const { version, repo } = versionInfo();
    if (!/^[\w.\-]+\/[\w.\-]+$/.test(repo)) throw new Error("Bad repo in version.json");
    const r = await request(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (r.status === 404) return { current: version, available: false, note: "No releases published yet" };
    if (r.status !== 200) throw new Error("GitHub said HTTP " + r.status);
    const rel = JSON.parse(r.body.toString("utf8"));
    const asset = (rel.assets || []).find(a => a.name === "lumicord-update.json");
    const latest = String(rel.tag_name || "").replace(/^v/, "");
    return {
        current: version, latest, available: !!asset && newer(latest, version),
        notes: String(rel.body || "").slice(0, 4000), name: rel.name || ("v" + latest), url: rel.html_url,
        assetUrl: asset && asset.browser_download_url,
    };
}

let updating = null; // one update at a time: a second click gets the same in-flight result
const applyUpdate = () => updating || (updating = applyUpdateNow().finally(() => { updating = null; }));
async function applyUpdateNow() {
    const info = await checkUpdate();
    if (!info.available) throw new Error("Already up to date");
    if (!/^https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+\/releases\/download\//.test(info.assetUrl)) throw new Error("Unexpected download location");
    const bundle = JSON.parse((await get(info.assetUrl)).body.toString("utf8"));
    if (String(bundle.version) !== info.latest) throw new Error("Update file version does not match the release");
    let signed = false;
    try { signed = crypto.verify(null, Buffer.from(signedText(String(bundle.version), bundle.files || {})), UPDATE_KEY, Buffer.from(String(bundle.signature), "base64")); } catch { }
    if (!signed) throw new Error("Update is not signed by Lumicord, refusing to install it");
    // verify everything before touching any file
    const files = Object.entries(bundle.files || {}).map(([rel, f]) => {
        if (!updatableFile(rel)) throw new Error("Update contains a file it may not change: " + rel);
        const data = Buffer.from(String(f.data), "base64");
        if (crypto.createHash("sha256").update(data).digest("hex") !== f.sha256) throw new Error("Checksum mismatch for " + rel);
        const dest = path.join(root, ...rel.split("/"));
        return { rel, data, dest, existed: fs.existsSync(dest) };
    });
    if (!files.some(f => f.rel === "src/renderer.js")) throw new Error("Update is incomplete");
    // back up the current files, then swap each new file in via temp file + rename; restore on any failure
    const backupDir = path.join(root, "backup", info.current);
    const done = [];
    try {
        for (const f of files) {
            fs.mkdirSync(path.dirname(f.dest), { recursive: true });
            if (fs.existsSync(f.dest)) { const b = path.join(backupDir, ...f.rel.split("/")); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(f.dest, b); }
        }
        for (const f of files) { fs.writeFileSync(f.dest + ".new", f.data); fs.renameSync(f.dest + ".new", f.dest); done.push(f); }
        // keep the repo setting even if the bundle's version.json omits it
        const v = readJSON(versionPath, {}); v.version = info.latest; v.repo = v.repo || versionInfo().repo; writeJSON(versionPath, v);
        logLine("updater", "updated", info.current, "->", info.latest, files.length, "files");
        return { from: info.current, to: info.latest };
    } catch (e) {
        for (const f of done) { const b = path.join(backupDir, ...f.rel.split("/")); try { if (!f.existed) fs.rmSync(f.dest, { force: true }); else if (fs.existsSync(b)) fs.copyFileSync(b, f.dest); } catch { } }
        logLine("updater", "FAILED, restored previous files:", e && e.stack);
        throw e;
    }
}

// Only Discord's own pages get Lumicord: another site loaded in this window gets nothing.
const isDiscord = () => /^https:\/\/((ptb|canary)\.)?discord\.com$/.test(location.origin);
const gate = o => {
    const out = {};
    for (const k in o) out[k] = typeof o[k] === "function"
        ? (...a) => { if (!isDiscord()) throw new Error("Lumicord: not available on " + location.origin); return o[k](...a); }
        : o[k] && typeof o[k] === "object" ? gate(o[k]) : o[k];
    return out;
};
if (isDiscord()) contextBridge.exposeInMainWorld("LumicordNative", gate({
    version: () => versionInfo().version,
    checkUpdate,
    applyUpdate,
    folders: { plugin: dirs.plugin, theme: dirs.theme, data: dataDir },
    fs: {
        write: (p, text) => { const f = safePath(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(text)); return path.basename(f); },
        read: p => fs.readFileSync(safePath(p), "utf8"),
        // binary files (images, caches): bytes in and out, so nothing is mangled by text decoding
        readBytes: p => new Uint8Array(fs.readFileSync(safePath(p))),
        writeBytes: (p, bytes) => { const f = safePath(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(bytes)); return path.basename(f); },
        exists: p => { try { return fs.existsSync(safePath(p)); } catch { return false; } },
        list: p => fs.readdirSync(safePath(p)),
        remove: p => fs.unlinkSync(safePath(p)),
        isDir: p => fs.statSync(safePath(p)).isDirectory(),
        mkdir: p => { fs.mkdirSync(safePath(p), { recursive: true }); },
    },
    // Page fetch is subject to CORS; plugins (e.g. BDFDB library downloads) fetch through here instead.
    fetch: async (url, opts) => {
        const o = opts && typeof opts === "object" ? opts : {};
        const headers = {};
        if (o.headers && typeof o.headers === "object") for (const k in o.headers) if (typeof o.headers[k] === "string") headers[k] = o.headers[k];
        const r = await request(String(url), { method: typeof o.method === "string" ? o.method : "GET", headers, body: typeof o.body === "string" ? o.body : null, timeout: o.timeout, publicOnly: true, who: typeof o.who === "string" ? o.who : "A plugin" })
            .catch(e => ({ error: e }));
        if (r.error) return { status: 0, statusText: String(r.error.message), headers: {}, body: "" };
        return { status: r.status, statusText: r.statusText, headers: r.headers, body: r.body.toString("utf8") };
    },
    relaunch: () => ipcRenderer.invoke("LUMICORD_RELAUNCH").catch(() => location.reload()),
    localAccess: {
        list: () => ipcRenderer.invoke("LUMICORD_LOCAL_ACCESS_LIST"),
        forget: host => ipcRenderer.invoke("LUMICORD_LOCAL_ACCESS_FORGET", String(host)),
    },
    log: (...a) => logLine("renderer", ...a.map(x => typeof x === "string" ? x : JSON.stringify(x))),
    getSettings: () => { const s = readJSON(settingsPath, {}); return s && typeof s === "object" && !Array.isArray(s) ? s : {}; },
    setSettings: s => { if (s && typeof s === "object" && !Array.isArray(s)) writeJSON(settingsPath, s); },
    loadData: name => readJSON(dataFile(name), {}),
    saveData: (name, obj) => { if (obj && typeof obj === "object") writeJSON(dataFile(name), obj); },

    listAddons: () => {
        const read = (type, ext) => fs.readdirSync(dirs[type]).filter(f => f.endsWith(ext))
            .map(f => ({ file: f, source: fs.readFileSync(path.join(dirs[type], f), "utf8") }));
        return { plugins: read("plugin", ".js"), themes: read("theme", ".css") };
    },
    deleteAddon: (type, file) => fs.unlinkSync(path.join(dirs[type], safeName(file, type))),
    openFolder: type => shell.openPath(dirs[type] || root),

    // Marketplace: the public BetterDiscord addon catalog.
    store: async type => {
        const { body } = await get(`https://betterdiscord.app/${type === "theme" ? "themes" : "plugins"}/__data.json`);
        return decodeSvelte(JSON.parse(body.toString("utf8"))).map(a => ({
            id: a.id, name: a.name, description: a.description || "", downloads: a.downloads || 0, likes: a.likes || 0,
            author: (a.author && a.author.login && a.author.login.displayName) || (a.author && a.author.githubName) || "Unknown",
            version: (a.latestRelease && a.latestRelease.version) || "", tags: a.tags || [],
            thumbnail: Number.isInteger(a.thumbnailId) ? "https://betterdiscord.app/image/" + a.thumbnailId : "",
        }));
    },
    install: async (id, type) => {
        if (!Number.isInteger(id)) throw new Error("Bad id");
        if (!dirs[type]) throw new Error("Bad addon type");
        const { body, headers } = await get("https://betterdiscord.app/download?id=" + id);
        // plain filename= parameter (not filename*=UTF-8''...)
        const m = /(?:^|;)\s*filename="?([^";]+)"?/i.exec(headers["content-disposition"] || "");
        if (!m) throw new Error("No file name in download");
        const file = safeName(m[1], type);
        fs.writeFileSync(path.join(dirs[type], file), body);
        return { file, source: body.toString("utf8") };
    },
}));

// Keep Discord working: run its own preload too.
try {
    if (process.env.LUMICORD_ORIGINAL_PRELOAD) require(process.env.LUMICORD_ORIGINAL_PRELOAD);
    logLine("preload", "Discord preload loaded:", process.env.LUMICORD_ORIGINAL_PRELOAD);
} catch (e) { logLine("preload", "Discord preload FAILED:", e && e.stack); }

// Run now, before Discord's scripts, so the renderer can hook webpack as modules load (it waits for the DOM itself).
// When Vencord is loaded too, its preload is the "original" one and it has already hooked webpack.
const withVencord = /[\\/]vencord[\\/]/i.test(process.env.LUMICORD_ORIGINAL_PRELOAD || "");
logLine("preload", "Vencord present:", withVencord);
if (isDiscord()) webFrame.executeJavaScript((withVencord ? "window.__lumicordWithVencord = true;\n" : "") + fs.readFileSync(path.join(__dirname, "renderer.js"), "utf8"))
    .then(() => logLine("preload", "renderer injected"), e => logLine("preload", "renderer FAILED:", e && e.stack));
