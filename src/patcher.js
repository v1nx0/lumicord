// Runs in Discord's main (Node) process. Adds our preload to the main window, then boots the real Discord app.
const electron = require("electron");
const path = require("path");
const fs = require("fs");

// Every stage writes here so a failed injection can be diagnosed without devtools.
const logPath = path.join(__dirname, "..", "lumicord.log");
const log = (...a) => { try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] [main] ${a.join(" ")}\n`); } catch { } };
// Keep earlier runs (a crash is usually followed by a restart); only start over when the file gets big.
try { if (fs.statSync(logPath).size > 512 * 1024) fs.writeFileSync(logPath, ""); } catch { }
log("patcher start, electron", process.versions.electron, "exe", process.execPath);

const ourPreload = path.join(__dirname, "preload.js");

try {
    class BrowserWindow extends electron.BrowserWindow {
        constructor(opts) {
            // The main Discord window is the one with a title and its own preload; leave popouts/overlays alone.
            if (opts && opts.webPreferences && opts.webPreferences.preload && opts.title) {
                log("main window:", opts.title, "original preload", opts.webPreferences.preload);
                process.env.LUMICORD_ORIGINAL_PRELOAD = opts.webPreferences.preload;
                opts.webPreferences.preload = ourPreload;
                opts.webPreferences.sandbox = false; // our preload needs fs
            } else log("other window:", opts && opts.title);
            super(opts);
            this.webContents.on("preload-error", (_e, p, err) => log("PRELOAD ERROR", p, err && err.stack));
        }
    }
    // Discord's Electron build looks windows up by class name and static members, so look exactly like the original.
    Object.assign(BrowserWindow, electron.BrowserWindow);
    Object.defineProperty(BrowserWindow, "name", { value: "BrowserWindow", configurable: true });

    // electron's exports are read-only getters, so swap the whole cached module.
    const electronPath = require.resolve("electron");
    const cached = require.cache[electronPath];
    if (!cached) throw new Error("electron is not in require.cache (" + electronPath + ")");
    delete cached.exports;
    cached.exports = Object.assign({}, electron, { BrowserWindow });
    log("BrowserWindow replaced; check:", require("electron").BrowserWindow === BrowserWindow);
} catch (e) { log("FAILED to patch BrowserWindow:", e && e.stack); }

// "Restart Discord" button: fully relaunch the app (a page reload does not restart the main process).
try { electron.ipcMain.handle("LUMICORD_RELAUNCH", () => { electron.app.relaunch(); electron.app.exit(0); }); }
catch (e) { log("relaunch handler failed", e && e.message); }

// A plugin wants to reach this PC or the local network (e.g. a music app's local server). Ask with a native dialog
// the page cannot fake or click for itself; remember the answer per address in local-access.json (outside the
// folders plugins can write).
const accessFile = path.join(__dirname, "..", "local-access.json");
const readAccess = () => { try { const access = JSON.parse(fs.readFileSync(accessFile, "utf8")); return access && typeof access === "object" && !Array.isArray(access) ? access : {}; } catch { return {}; } };
let access = readAccess();
const writeAccess = () => fs.writeFileSync(accessFile, JSON.stringify(access, null, 2));
const asking = new Map(); // one dialog per address, even if a plugin fires many requests
try {
    electron.ipcMain.handle("LUMICORD_LOCAL_ACCESS", (e, host, who) => {
        host = String(host).slice(0, 200).toLowerCase(); who = String(who || "A plugin").slice(0, 80);
        const known = access[host];
        if (known !== undefined) return known === true;
        // A remembered Deny always wins over the global allow-all switch.
        if (access["*"] === true) return true;
        if (asking.has(host)) return asking.get(host);
        const win = electron.BrowserWindow.fromWebContents(e.sender);
        const p = electron.dialog.showMessageBox(win, {
            type: "question", buttons: ["Allow", "Deny"], defaultId: 1, cancelId: 1, noLink: true, title: "Lumicord",
            message: `${who} wants to connect to ${host}`,
            detail: "This address is on your computer or local network (router, other devices, local apps). Allow only if you trust this plugin and expect it to talk to a local app.",
            checkboxLabel: "Remember my choice", checkboxChecked: true,
        }).then(r => {
            const ok = r.response === 0;
            if (r.checkboxChecked) { access[host] = ok; writeAccess(); }
            log("local access", host, who, ok ? "allowed" : "denied");
            return ok;
        }).finally(() => asking.delete(host));
        asking.set(host, p);
        return p;
    });
    electron.ipcMain.handle("LUMICORD_LOCAL_ACCESS_LIST", () => {
        const list = Object.assign({}, access); delete list["*"]; return list;
    });
    electron.ipcMain.handle("LUMICORD_LOCAL_ACCESS_STATE", () => ({ allowAll: access["*"] === true }));
    electron.ipcMain.handle("LUMICORD_LOCAL_ACCESS_ALLOW_ALL", (e, on) => {
        if (!on) { delete access["*"]; writeAccess(); return true; }
        const win = electron.BrowserWindow.fromWebContents(e.sender);
        return electron.dialog.showMessageBox(win, {
            type: "warning", buttons: ["Allow all plugins", "Cancel"], defaultId: 1, cancelId: 1, noLink: true, title: "Lumicord",
            message: "Allow every plugin to use your local network?",
            detail: "Plugins will be able to connect to local apps, routers, and other devices without asking. Only enable this if you trust every installed plugin.",
        }).then(r => {
            if (r.response !== 0) return false;
            access["*"] = true; writeAccess(); log("local access allow-all enabled"); return true;
        });
    });
    electron.ipcMain.handle("LUMICORD_LOCAL_ACCESS_FORGET", (_e, host) => {
        if (typeof host !== "string") return false;
        if (host === "*") { access = {}; writeAccess(); return true; }
        host = host.slice(0, 200).toLowerCase();
        if (Object.prototype.hasOwnProperty.call(access, host)) { delete access[host]; writeAccess(); }
        return true;
    });
} catch (e) { log("local access handler failed", e && e.message); }

// Discord's page Content-Security-Policy blocks eval (needed to load rewritten webpack modules) and outside images
// (marketplace thumbnails). Strip it from Discord's main page only. Electron allows a single onHeadersReceived
// listener per session, so listeners registered later (Discord's, Vencord's) are chained after ours instead of
// replacing it: each one sees the headers the previous one returned.
// shortcut: their URL filters are ignored (they see every response); fine unless one starts relying on it.
electron.app.on("session-created", session => {
    const wr = session.webRequest;
    const register = wr.onHeadersReceived.bind(wr);
    const chain = [];
    const run = (i, details, done) => {
        if (i >= chain.length) return done({ cancel: false, responseHeaders: details.responseHeaders });
        try {
            chain[i](details, res => {
                if (res && res.cancel) return done(res);
                if (res && res.responseHeaders) details.responseHeaders = res.responseHeaders;
                run(i + 1, details, done);
            });
        } catch (e) { log("header listener error", e && e.stack); run(i + 1, details, done); }
    };
    register((details, done) => {
        if (details.resourceType === "mainFrame" && details.responseHeaders && /^https:\/\/((ptb|canary)\.)?discord\.com\//.test(details.url))
            for (const k of Object.keys(details.responseHeaders)) if (/^content-security-policy/i.test(k)) delete details.responseHeaders[k];
        run(0, details, done);
    });
    wr.onHeadersReceived = (filterOrListener, maybeListener) => {
        const l = typeof filterOrListener === "function" ? filterOrListener : maybeListener;
        if (typeof l === "function") chain.push(l);
    };
});

// Boot the original Discord app (renamed to _app.asar by the installer).
const asar = path.join(path.dirname(process.execPath), "resources", "_app.asar");
const vencordPatcher = path.join(__dirname, "..", "vencord", "patcher.js");
if (fs.existsSync(vencordPatcher)) {
    // Vencord (GPL-3.0, https://github.com/Vendicated/Vencord) boots Discord itself. It finds Discord's archive from
    // require.main: "<dir>/app.asar/..." means "use <dir>/_app.asar", which is where ours is.
    const resources = path.dirname(asar);
    require.main.filename = path.join(resources, "app.asar", "index.js");
    require.main.path = path.join(resources, "app.asar");
    process.env.DISABLE_UPDATER_AUTO_PATCHING = "1"; // Lumicord handles Discord updates (installer Repair), not Vencord
    log("starting Vencord from", vencordPatcher);
    try { require(vencordPatcher); }
    catch (e) {
        log("Vencord FAILED, starting plain Discord:", e && e.stack);
        const pkg = require(path.join(asar, "package.json"));
        require.main.filename = path.join(asar, pkg.main);
        electron.app.setAppPath(asar);
        require(require.main.filename);
    }
} else {
    try {
        const pkg = require(path.join(asar, "package.json"));
        require.main.filename = path.join(asar, pkg.main);
        electron.app.setAppPath(asar);
        log("starting Discord from", asar);
        require(require.main.filename);
    } catch (e) {
        // e.g. _app.asar missing after a half-finished uninstall: say so instead of dying silently
        log("FAILED to start Discord:", e && e.stack);
        electron.dialog.showErrorBox("Lumicord", "Discord could not be started (" + (e && e.message) + ").\nRun the Lumicord installer and choose Repair or Uninstall.");
        electron.app.exit(1);
    }
}
