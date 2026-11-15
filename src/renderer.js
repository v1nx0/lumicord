// Runs inside the Discord page.
// - Loads plugins in three formats: BetterDiscord (*.plugin.js), Vencord-style (*.vc.js), Lumicord (*.js)
// - Loads themes (*.css, including BetterDiscord *.theme.css)
// - Adds a "Lumicord" section to Discord's settings sidebar (Plugins / Themes / Marketplace). Ctrl+Shift+L opens it anywhere.
//
// This file runs BEFORE Discord's own scripts, so it can rewrite Discord's webpack modules as they load.
// Discord's new settings screen is a tree of layout nodes; the root one ("$Root") has a buildLayout() that
// returns the sidebar sections. We wrap that call and insert our own section, so Discord draws it natively.
(() => {
    if (window.Lumicord || window.__lumicordEarly) return;
    window.__lumicordEarly = true;

    // ---------------------------------------------------------------- early: webpack module rewriting
    const IDENT = "[A-Za-z_$][\\w$]*";
    const MODULE_PATCHES = [{
        find: ".buildLayout().map",
        match: new RegExp(`(${IDENT})\\.buildLayout\\(\\)(?=\\.map)`),
        replace: "window.__lumicordBuildLayout($1)",
    }];
    const PATCHED = Symbol("lumicordPatched");
    const rlog = (...a) => { try { console.log("[Lumicord]", ...a); window.LumicordNative && window.LumicordNative.log(...a.map(String)); } catch { } };
    rlog("renderer start, webpack array present:", !!window.webpackChunkdiscord_app);

    // Error capture: React reports render crashes through console.error; uncaught ones through window events.
    let sectionInsertedAt = 0;
    // Discord logs many errors; write at most 30 per minute to the log file (each write is a disk write).
    let logWindow = 0, logCount = 0;
    const onCrash = text => {
        const now = Date.now();
        if (now - logWindow > 60000) { logWindow = now; logCount = 0; }
        if (++logCount <= 30) rlog("ERROR", text.slice(0, 4000));
        else if (logCount === 31) rlog("ERROR", "(more errors this minute are not logged)");
        // Crash guard: an error right after our section was drawn disables the native section for the next start.
        // Only real render crashes count (React's crash report, or anything naming Lumicord) — Vencord logs
        // harmless errors on purpose (e.g. "Sentry successfully disabled", updater failures).
        // Plugin errors don't count either: their stacks contain "lumicord:///plugins/..." and used to trip this,
        // hiding the Lumicord section because some plugin had a bug.
        const isCrash = /The above error occurred|Minified React error/i.test(text) && !/lumicord:\/\/\/plugins\//.test(text);
        if (isCrash && sectionInsertedAt && Date.now() - sectionInsertedAt < 8000 && window.LumicordNative) {
            const s = window.LumicordNative.getSettings();
            if (s.nativeSidebar !== false) { s.nativeSidebar = false; window.LumicordNative.setSettings(s); rlog("crash guard: native settings section disabled for next start"); }
        }
    };
    const origError = console.error;
    console.error = function (...a) {
        try { onCrash(a.map(x => x instanceof Error ? x.stack : typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(" ")); } catch { }
        return origError.apply(this, a);
    };
    window.addEventListener("error", e => onCrash("uncaught: " + (e.error && e.error.stack || e.message)));
    window.addEventListener("unhandledrejection", e => onCrash("unhandled rejection: " + (e.reason && e.reason.stack || e.reason)));
    const nativeSidebarOn = () => { try { return window.LumicordNative.getSettings().nativeSidebar !== false; } catch { return true; } };

    const patchFactory = (factory, id) => {
        if (typeof factory !== "function" || factory[PATCHED]) return factory;
        let src;
        try { src = Function.prototype.toString.call(factory); } catch { return factory; }
        let out = src;
        for (const p of MODULE_PATCHES) if (out.includes(p.find)) out = out.replace(p.match, p.replace);
        if (out === src) return factory;
        // Module factories can be written as `123(e,t,n){...}` (method shorthand); turn that into a function expression.
        if (!/^(function\b|async\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(out)) out = out.replace(/^[^(]*/, "function");
        try {
            const patched = (0, eval)(`0,(${out})\n//# sourceURL=lumicord-patched-module-${String(id)}`);
            patched[PATCHED] = true;
            rlog("patched webpack module", id);
            return patched;
        } catch (e) {
            rlog("could not patch module", id, e && e.message);
            return factory;
        }
    };
    // Discord's build does not expose webpack's module cache (__webpack_require__.c), so keep our own:
    // every module factory is wrapped to record its module object once it has run (like Vencord does).
    const moduleCache = {};
    let hasModules = false;
    let capturedRequire = null;
    const WRAPPED = Symbol("lumicordWrapped");
    const wrapFactory = (factory, id) => {
        if (typeof factory !== "function" || factory[WRAPPED]) return factory;
        const wrapped = function (module, exports, require) {
            if (!capturedRequire && typeof require === "function") capturedRequire = require;
            try { return factory.call(this, module, exports, require); }
            finally { hasModules = true; moduleCache[id] = module; }
        };
        wrapped[WRAPPED] = true;
        wrapped.toString = () => Function.prototype.toString.call(factory); // Discord and plugins read factory source
        return wrapped;
    };
    const patchChunk = chunk => {
        const mods = chunk && chunk[1];
        if (mods && typeof mods === "object")
            for (const id in mods) if (!(mods[id] && mods[id][WRAPPED])) mods[id] = wrapFactory(patchFactory(mods[id], id), id);
    };
    // Webpack replaces array.push with its own loader that calls the previous push; each wrapper keeps the push
    // that existed when it was created, so the chain stays finite.
    const hookChunkArray = arr => {
        if (!arr || arr.__lumicordHooked) return;
        Object.defineProperty(arr, "__lumicordHooked", { value: true });
        arr.forEach(patchChunk);
        let current = arr.push;
        Object.defineProperty(arr, "push", {
            configurable: true,
            get() { const target = current; return function (...chunks) { chunks.forEach(patchChunk); return target.apply(this, chunks); }; },
            set(v) { current = v; },
        });
    };
    // With Vencord loaded, Vencord owns webpack patching; only one of us may rewrite module factories.
    const withVencord = !!window.__lumicordWithVencord;
    rlog("Vencord mode:", withVencord);
    if (!withVencord) {
        let chunkArray = window.webpackChunkdiscord_app;
        hookChunkArray(chunkArray);
        Object.defineProperty(window, "webpackChunkdiscord_app", {
            configurable: true,
            get: () => chunkArray,
            set: v => { chunkArray = v; hookChunkArray(v); },
        });
    }

    // Called by Discord's (rewritten) settings code. The section itself is built once the UI code below has loaded.
    window.__lumicordBuildLayout = builder => {
        const layout = builder.buildLayout();
        if (builder.key === "$Root") rlog("settings root built; sections:", Array.isArray(layout) ? layout.map(s => s && s.key).join(",") : typeof layout, "| section ready:", !!window.__lumicordSection);
        try {
            if (builder.key === "$Root" && Array.isArray(layout) && window.__lumicordSection && nativeSidebarOn() && !layout.some(s => s && s.key === "lumicord_section")) {
                const at = layout.findIndex(s => s && s.key === "billing_section"); // like Vencord's default: above Nitro
                layout.splice(at === -1 ? Math.min(2, layout.length) : at, 0, window.__lumicordSection());
                window.__lumicordLayoutHooked = true;
                sectionInsertedAt = Date.now();
                rlog("section inserted at index", at === -1 ? 2 : at);
            }
        } catch (e) { rlog("settings layout error", e && e.stack); }
        return layout;
    };

    const start = () => { try { init(); rlog("UI ready"); } catch (e) { rlog("init FAILED", e && e.stack); } };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();

    function init() {
    if (window.Lumicord) return;
    const N = window.LumicordNative;
    const settings = N.getSettings();
    settings.plugins = settings.plugins || {};
    settings.themes = settings.themes || {};
    // Merge into the file instead of overwriting it, so edits made elsewhere (another window, dev flags) survive.
    const save = () => { const cur = N.getSettings(); cur.plugins = settings.plugins; cur.themes = settings.themes; N.setSettings(cur); };
    const log = (...a) => console.log("%c[Lumicord]", "color:#b9a3ff;font-weight:bold", ...a);

    // ---------------------------------------------------------------- DOM helpers
    const h = (tag, props, ...kids) => {
        const el = document.createElement(tag);
        for (const k in props || {}) {
            if (k === "style" && typeof props[k] === "object") Object.assign(el.style, props[k]);
            else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), props[k]);
            else if (k === "class") el.className = props[k];
            else el[k] = props[k];
        }
        for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
        return el;
    };
    const styles = {};
    const addStyle = (id, css) => {
        let el = styles[id];
        if (!el) { el = styles[id] = h("style", { id: "lumi-" + id.replace(/\W/g, "_") }); document.head.append(el); }
        el.textContent = css;
    };
    const removeStyle = id => { if (styles[id]) { styles[id].remove(); delete styles[id]; } };

    // Themes must come AFTER Discord's CSS, which Discord keeps adding to <head> as parts of the app (e.g. the
    // settings screen) load. Keep theme styles in a container that is always the last child of <html>.
    const themeHost = document.createElement("lumicord-themes");
    const keepThemesLast = () => { if (document.documentElement.lastElementChild !== themeHost) document.documentElement.append(themeHost); };
    keepThemesLast();
    new MutationObserver(keepThemesLast).observe(document.documentElement, { childList: true });
    const themeStyles = {};
    const setThemeStyle = (file, css) => {
        if (css == null) { if (themeStyles[file]) { themeStyles[file].remove(); delete themeStyles[file]; } return; }
        let el = themeStyles[file];
        if (!el) { el = themeStyles[file] = document.createElement("style"); el.setAttribute("data-theme", file); }
        el.textContent = css;
        themeHost.insertBefore(el, styles["lumicord-usercss"] || null);
    };

    // ---------------------------------------------------------------- toasts & modals
    let toastBox;
    const toast = (msg, opts) => {
        const type = (opts && opts.type) || "info";
        if (!toastBox || !toastBox.isConnected) { toastBox = h("div", { class: "lumi-toasts" }); document.body.append(toastBox); }
        const c = (N.getSettings().custom || {}), pos = /^(bottom|top)-(left|right)$/.test(c.toastPosition) ? c.toastPosition : "bottom-right";
        toastBox.className = "lumi-toasts lumi-toast-" + pos;
        const t = h("div", { class: "lumi-toast lumi-" + type }, String(msg));
        toastBox.append(t);
        setTimeout(() => { t.classList.add("lumi-out"); setTimeout(() => t.remove(), 300); }, (opts && opts.timeout) || Number(c.toastDuration) || 3000);
    };

    // Sticky "restart needed" bar (like Vencord's), shown after installing plugins.
    let restartBar;
    function showRestartBar(text) {
        if (restartBar && restartBar.isConnected) { restartBar.querySelector(".lumi-rb-text").textContent = text; restartBar.classList.remove("lumi-rb-bump"); void restartBar.offsetWidth; restartBar.classList.add("lumi-rb-bump"); return; }
        restartBar = h("div", { class: "lumi-restart-bar" },
            h("div", { class: "lumi-rb-icon" }, "⟳"),
            h("div", { class: "lumi-rb-text" }, text),
            h("button", { class: "lumi-btn lumi-rb-later", onClick: () => { restartBar.classList.add("lumi-out"); setTimeout(() => restartBar.remove(), 250); } }, "Later"),
            h("button", { class: "lumi-btn lumi-primary", onClick: () => { restartBar.querySelector(".lumi-rb-text").textContent = "Restarting Discord…"; N.relaunch(); } }, "Restart Discord"));
        document.body.append(restartBar);
    }

    // Renders a string, DOM node, React element or React component into a container.
    const renderInto = (box, content) => {
        if (content == null) return;
        if (typeof content === "string") { box.append(content); return; }
        if (content instanceof Node) { box.append(content); return; }
        const R = Webpack.React(), RD = Webpack.ReactDOM();
        if (!R || !RD) { box.append("This content needs React, which was not found."); return; }
        const el = typeof content === "function" ? R.createElement(content) : content;
        if (RD.createRoot) { const root = RD.createRoot(box); root.render(el); box._lumiUnmount = () => root.unmount(); }
        else RD.render(el, box);
    };

    const modal = (title, content, buttons, onClose) => {
        // Clicking outside or pressing Escape counts as Cancel: plugins rely on their onCancel running (e.g. BDFDB's download prompt).
        const cancelBtn = (buttons || []).find(b => !b.primary && !b.danger);
        const cancel = () => { close(); if (cancelBtn && cancelBtn.onClick) cancelBtn.onClick(); };
        const back = h("div", { class: "lumi-backdrop", onClick: e => { if (e.target === back) cancel(); } });
        const body = h("div", { class: "lumi-modal-body" });
        // only the top-most modal reacts to Escape
        const onKey = e => { if (e.key === "Escape" && [...document.querySelectorAll(".lumi-backdrop")].pop() === back) { e.stopImmediatePropagation(); e.preventDefault(); cancel(); } };
        document.addEventListener("keydown", onKey, true);
        let closed = false;
        const close = () => {
            if (closed) return; closed = true;
            document.removeEventListener("keydown", onKey, true);
            if (body._lumiUnmount) body._lumiUnmount(); back.remove();
            if (onClose) try { onClose(); } catch (e) { console.error("[Lumicord] modal onClose", e); }
        };
        const foot = h("div", { class: "lumi-modal-foot" }, (buttons || [{ label: "Okay", primary: true }]).map(b =>
            h("button", { class: "lumi-btn" + (b.primary ? " lumi-primary" : "") + (b.danger ? " lumi-danger" : ""), onClick: () => { close(); if (b.onClick) b.onClick(); } }, b.label)));
        back.append(h("div", { class: "lumi-modal" }, h("h2", null, title), body, foot));
        document.documentElement.append(back); // not <body>: a transform on body (themes, Discord layers) would break centering
        renderInto(body, content);
        return close;
    };

    // ---------------------------------------------------------------- Discord's webpack
    // Our own module cache (filled by wrapFactory above), shaped like webpack's require: { c: modules, m: factories }.
    const getWreq = () => {
        const V = window.Vencord && window.Vencord.Webpack;
        if (withVencord && V && V.wreq) return { c: V.cache || V.wreq.c || {}, m: V.wreq.m || {}, require: V.wreq };
        return hasModules ? { c: moduleCache, m: (capturedRequire && capturedRequire.m) || {}, require: capturedRequire } : null;
    };
    // Filters and search follow BetterDiscord's webpack/filter.ts + searching.ts. Key checks use `in`, not
    // `m[k] !== undefined`: Discord has Proxy modules that return a function for ANY property name.
    const srcOf = id => { try { const r = getWreq(); return r && r.m && r.m[id] ? r.m[id].toString() : ""; } catch { return ""; } };
    const Filters = {
        byKeys: (...keys) => m => { if (!m || (typeof m !== "object" && typeof m !== "function")) return false; for (const k of keys) if (!(k in m)) return false; return true; },
        byPrototypeKeys: (...keys) => m => { if (!m || (typeof m !== "object" && typeof m !== "function") || !m.prototype) return false; for (const k of keys) if (!(k in m.prototype)) return false; return true; },
        byRegex: (re, f = m => m) => m => { const x = f(m); if (!x) return false; let str = ""; try { str = x.toString([]); } catch { str = String(x); } return str.search(re) !== -1; },
        // bySource matches the MODULE's factory source (not the export), like BD
        bySource: (...searches) => (e, module, id) => {
            const src = srcOf(module && module.id != null ? module.id : id); if (!src) return false;
            return searches.every(q => typeof q === "string" ? src.includes(q) : q.test(src));
        },
        byStrings: (...strs) => m => { if (typeof m !== "function") return false; try { const str = String(m); return strs.every(x => str.includes(x)); } catch { return false; } },
        byDisplayName: name => m => m != null && m.displayName === name,
        byStoreName: name => m => !!(m && m._dispatchToken && typeof m.getName === "function" && m.getName() === name),
        // shortcut: checks the names appear in a destructuring pattern somewhere in the function, enough for real plugins
        byDestructure: (...props) => m => { if (typeof m !== "function") return false; const str = String(m); return props.every(p => new RegExp("[{,]\\s*" + p.replace(/[$]/g, "\\$") + "\\s*[:,}=]").test(str)); },
        byComponentType: f => m => { let c = m; while (c && typeof c === "object" && c.type) c = c.type; return typeof c === "function" && f(c); },
        combine: (...fs) => (e, m, id) => fs.every(f => f(e, m, id)),
        not: f => (e, m, id) => !f(e, m, id),
    };
    Filters.byProps = Filters.byKeys;
    Filters.byPrototypeFields = Filters.byPrototypeKeys;
    const TypedArray = Object.getPrototypeOf(Uint8Array);
    const shouldSkip = e => {
        if (!e || (typeof e !== "object" && typeof e !== "function")) return true;
        try {
            if (e === window || e === document.documentElement || e === Symbol || e instanceof Window || e instanceof TypedArray) return true;
            if (e[Symbol.toStringTag] === "DOMTokenList" || e.TypedArray) return true;
            if ((e.$$loader && e.$$baseObject) || (e.Z && e.Z.$$loader && e.Z.$$baseObject)) return true;
        } catch { return true; }
        return false;
    };
    // BD never hands token/storage modules to filters
    const guard = filter => (e, m, id) => {
        try {
            const d = e && e.default;
            if (d && d.remove && d.set && d.clear && d.get && !d.sort) return false;
            if (e.remove && e.set && e.clear && e.get && !e.sort) return false;
            if ((d && (d.getToken || d.getEmail || d.showToken)) || e.getToken || e.getEmail || e.showToken) return false;
            return !!filter(e, m, id);
        } catch { return false; }
    };
    const defaultKey = e => { try { if ("A" in e) return "A"; if ("Ay" in e) return "Ay"; if (e.__esModule && "default" in e) return "default"; } catch { } };
    // One module -> matched value (or undefined), same rules as BD's getMatched
    const matchModule = (mod, id, filter, o) => {
        const e = mod && mod.exports;
        if (shouldSkip(e)) return;
        if (filter(e, mod, id)) return o.raw ? mod : o.withKey ? [mod, "exports"] : e;
        if (!o.searchExports && !o.searchDefault) return;
        let dk; const keys = [];
        if (o.searchExports) { try { keys.push(...Object.keys(e)); } catch { } }
        else if (o.searchDefault && (dk = defaultKey(e))) keys.push(dk);
        for (const k of keys) {
            let x; try { x = e[k]; } catch { continue; }
            if (shouldSkip(x) || !filter(x, mod, id)) continue;
            if (o.raw) return mod;
            if (!o.defaultExport && dk === k) return o.withKey ? [mod, "exports"] : e;
            return o.withKey ? [e, k] : x;
        }
    };
    const getModule = (filter, opts) => {
        const o = Object.assign({ first: true, searchExports: false, searchDefault: true, defaultExport: true, raw: false, withKey: false, fatal: false }, opts);
        const r = getWreq(), out = [], f = guard(filter);
        if (r && r.c) for (const id of Object.keys(r.c)) {
            const hit = matchModule(r.c[id], id, f, o);
            if (hit === undefined) continue;
            if (o.first) return hit;
            out.push(hit);
        }
        if (o.fatal && (o.first || !out.length)) throw new Error("Module search failed!");
        return o.first ? undefined : out;
    };
    // BD lets the last argument be an options object: getByKeys("a", "b", { searchExports: true })
    const splitOpts = args => (args.length && args[args.length - 1] && typeof args[args.length - 1] === "object" && !(args[args.length - 1] instanceof RegExp)) ? [args.slice(0, -1), args[args.length - 1]] : [args, {}];
    let react; // found once, then reused
    const Webpack = {
        Filters,
        getModule,
        getByKeys: (...a) => { const [k, o] = splitOpts(a); return getModule(Filters.byKeys(...k), o); },
        getByStrings: (...a) => { const [k, o] = splitOpts(a); return getModule(Filters.byStrings(...k), o); },
        getByPrototypeKeys: (...a) => { const [k, o] = splitOpts(a); return getModule(Filters.byPrototypeKeys(...k), o); },
        getBySource: (...a) => { const [k, o] = splitOpts(a); return getModule(Filters.bySource(...k), o); },
        getAllByKeys: (...a) => { const [k, o] = splitOpts(a); return getModule(Filters.byKeys(...k), Object.assign({}, o, { first: false })); },
        getAllByStrings: (...a) => { const [k, o] = splitOpts(a); return getModule(Filters.byStrings(...k), Object.assign({}, o, { first: false })); },
        getAllBySource: (...a) => { const [k, o] = splitOpts(a); return getModule(Filters.bySource(...k), Object.assign({}, o, { first: false })); },
        getAllByPrototypeKeys: (...a) => { const [k, o] = splitOpts(a); return getModule(Filters.byPrototypeKeys(...k), Object.assign({}, o, { first: false })); },
        getByRegex: (re, o) => getModule(Filters.byRegex(re), o),
        getAllByRegex: (re, o) => getModule(Filters.byRegex(re), Object.assign({}, o, { first: false })),
        getModules: (filter, o) => getModule(filter, Object.assign({}, o, { first: false })),
        getWithKey: (filter, o) => getModule(filter, Object.assign({}, o, { withKey: true, first: true })),
        getById: (id, o) => { const r = getWreq(), m = r && r.c && r.c[id]; if (!m) { if (o && o.fatal) throw new Error("Module search failed!"); return; } return o && o.raw ? m : m.exports; },
        // getMangled(filter | source string/regex/array | id, { name: exportFilter }) -> { name: export }
        getMangled: (filter, mangled, o) => {
            o = Object.assign({}, o, { raw: true });
            const mod = typeof filter === "number" ? Webpack.getById(filter, { raw: true })
                : typeof filter === "function" ? getModule(filter, o)
                : getModule(Filters.bySource(...[].concat(filter)), o);
            const out = {}; if (!mod || !mod.exports) return out;
            const e = mod.exports;
            for (const name in mangled) for (const k in e) { let x; try { x = e[k]; } catch { continue; } try { if (mangled[name](x)) { out[name] = x; break; } } catch { } }
            return out;
        },
        getBulk: (...queries) => queries.map(q => { try { return getModule(q.filter, q); } catch { return undefined; } }),
        getBulkKeyed: queries => { const out = {}; for (const k in queries) { try { out[k] = getModule(queries[k].filter, queries[k]); } catch { } } return out; },
        // BD resolves when the module loads; polling is enough here. Honors options.signal like BD.
        waitForModule: (filter, opts) => new Promise((res, rej) => {
            const first = getModule(filter, opts); if (first) return res(first);
            const t = setInterval(() => { const m = getModule(filter, opts); if (m) { clearInterval(t); res(m); } }, 200);
            const sig = opts && opts.signal; if (sig) sig.addEventListener("abort", () => { clearInterval(t); rej(new Error("Aborted")); }, { once: true });
        }),
        get modules() { const r = getWreq(); return r ? r.m : {}; },
        get require() { const r = getWreq(); return r && r.require; },
        // Discord has wrapper modules that also expose createElement/useState; plugins that `extends React.Component`
        // need the real thing, so prefer Vencord's verified copy and otherwise require React's full shape.
        React: () => {
            const V = window.Vencord && window.Vencord.Webpack && window.Vencord.Webpack.Common;
            if (V && V.React && typeof V.React.Component === "function" && V.React.Component.prototype && V.React.Component.prototype.setState) return V.React;
            return react || (react = getModule(m => typeof m.createElement === "function" && typeof m.useState === "function" && typeof m.version === "string"
                && typeof m.Component === "function" && m.Component.prototype && typeof m.Component.prototype.setState === "function"));
        },
        ReactDOM: () => {
            if (Webpack._reactDOM) return Webpack._reactDOM;
            const dom = getModule(m => typeof m.createPortal === "function" && typeof m.flushSync === "function");
            const client = getModule(m => typeof m.createRoot === "function" && typeof m.hydrateRoot === "function");
            if (!dom && !client) return undefined;
            // BetterDiscord's ReactDOM offers both the react-dom API and createRoot in one object
            return (Webpack._reactDOM = Object.assign({}, dom, client && { createRoot: client.createRoot, hydrateRoot: client.hydrateRoot }));
        },
    };
    Webpack.getByProps = Webpack.getByKeys;
    // Flux stores by name (BdApi.Webpack.getStore("UserStore")), and a lazy map of them (BdApi.Webpack.Stores.UserStore).
    const isStore = m => m && typeof m.getName === "function" && typeof m.addChangeListener === "function";
    const fluxStores = new Map(); // only hits are cached: a store may load later
    Webpack.getStore = name => {
        if (fluxStores.has(name)) return fluxStores.get(name);
        // BD: ask Flux for all stores (fast, exact); fall back to a module search
        let s;
        try { const Flux = getModule(m => m.Store && typeof m.Store.getAll === "function"); if (Flux) s = Flux.Store.getAll().find(x => x && typeof x.getName === "function" && x.getName() === name); } catch { }
        if (!s) s = getModule(m => isStore(m) && m.getName() === name, { searchExports: true });
        if (s) fluxStores.set(name, s);
        return s;
    };
    Webpack.Stores = new Proxy({}, { get: (_, name) => typeof name === "string" ? Webpack.getStore(name) : undefined });
    Webpack.getAllByProps = Webpack.getAllByKeys;

    // ---------------------------------------------------------------- Patcher
    const patchMap = new Map();
    const PATCH_NEXT = Symbol("lumicordPatchNext");
    const REPLACE_PATCH_NEXT = Symbol("lumicordReplacePatchNext");
    const patch = (type, caller, obj, method, cb) => {
        if (!obj || typeof obj[method] !== "function") return null;
        const orig = obj[method];
        let next = orig;
        // Strict mode keeps `this` undefined for plain function calls (React function components). In sloppy
        // mode it becomes `window`, and plugins like BDFDB then read `window.props` and crash.
        const wrapped = function () {
            "use strict";
            const args = Array.prototype.slice.call(arguments);
            if (type === "before") { cb(this, args); return next.apply(this, args); }
            if (type === "instead") return cb(this, args, (...a) => next.apply(this, a));
            const ret = next.apply(this, args);
            const r = cb(this, args, ret);
            return r === undefined ? ret : r;
        };
        Object.assign(wrapped, orig);
        wrapped.toString = () => orig.toString();
        wrapped[PATCH_NEXT] = () => next;
        wrapped[REPLACE_PATCH_NEXT] = fn => { next = fn; };
        try { obj[method] = wrapped; } catch (e) { log("Could not patch", method, e); return () => { }; }
        const un = () => {
            if (obj[method] === wrapped) return void (obj[method] = next);
            for (let current = obj[method]; current && current[PATCH_NEXT]; current = current[PATCH_NEXT]())
                if (current[PATCH_NEXT]() === wrapped) return current[REPLACE_PATCH_NEXT](next);
        };
        if (!patchMap.has(caller)) patchMap.set(caller, []);
        patchMap.get(caller).push(un);
        return un;
    };
    const Patcher = {
        before: (c, o, m, cb) => patch("before", c, o, m, cb),
        after: (c, o, m, cb) => patch("after", c, o, m, cb),
        instead: (c, o, m, cb) => patch("instead", c, o, m, cb),
        unpatchAll: c => { (patchMap.get(c) || []).reverse().forEach(u => u()); patchMap.delete(c); },
        getPatchesByCaller: c => patchMap.get(c) || [],
    };

    // ---------------------------------------------------------------- plugin data
    const dataCache = {};
    const Data = {
        load: (p, k) => { const d = dataCache[p] || (dataCache[p] = N.loadData(p)); return d[k]; },
        save: (p, k, v) => { const d = dataCache[p] || (dataCache[p] = N.loadData(p)); d[k] = v === undefined ? undefined : JSON.parse(JSON.stringify(v)); N.saveData(p, d); },
        delete: (p, k) => { const d = dataCache[p] || (dataCache[p] = N.loadData(p)); delete d[k]; N.saveData(p, d); },
        recache: async p => { delete dataCache[p]; dataCache[p] = N.loadData(p); return true; },
    };

    // ---------------------------------------------------------------- addons registry
    const addons = { plugin: [], theme: [] };
    const parseMeta = src => {
        const m = /^\s*\/\*\*([\s\S]*?)\*\//.exec(src), meta = {};
        if (m) m[1].split("\n").forEach(l => { const r = /@(\w+)\s+(.+)/.exec(l); if (r) meta[r[1]] = r[2].trim(); });
        return meta;
    };

    // ---------------------------------------------------------------- BdApi
    const addonApi = type => ({
        isEnabled: n => { const a = findAddon(type, n); return !!(a && a.enabled); },
        enable: n => { const a = findAddon(type, n); if (a) setEnabled(a, true); },
        disable: n => { const a = findAddon(type, n); if (a) setEnabled(a, false); },
        toggle: n => { const a = findAddon(type, n); if (a) setEnabled(a, !a.enabled); },
        reload: n => { const a = findAddon(type, n); if (a && a.enabled) { setEnabled(a, false); setEnabled(a, true); } },
        get: n => { const a = findAddon(type, n); return a && Object.assign({ instance: a.instance, filename: a.file }, a.meta); },
        getAll: () => addons[type].map(a => Object.assign({ instance: a.instance, filename: a.file }, a.meta)),
        openSettings: n => {
            const a = findAddon(type, n);
            if (!a || !a.enabled || !a.instance || typeof a.instance.getSettingsPanel !== "function") return false;
            openAddonSettings(a);
            return true;
        },
        folder: N.folders[type],
    });
    const findAddon = (type, n) => addons[type].find(a => a.name === n || a.file === n || (a.meta && a.meta.name === n));

    // ---------------------------------------------------------------- BdApi.ContextMenu (built on Vencord's API)
    // BetterDiscord: patch(navId, (tree, props) => tree.props.children.push(item)). Vencord calls its patches with
    // (children, props) for the same navIds, using Discord's real Menu components (Vencord.Webpack.Common.Menu).
    // shortcut: needs Vencord (always bundled with Lumicord); without it, patch() is a no-op with a log line.
    function contextMenuApi() {
        const vcApi = () => window.Vencord && window.Vencord.Api && window.Vencord.Api.ContextMenu;
        const menu = () => (window.Vencord && window.Vencord.Webpack && window.Vencord.Webpack.Common && window.Vencord.Webpack.Common.Menu) || {};
        const wrappers = new Map(); // navId -> Map(callback -> Set(Vencord patch functions))
        const slug = s => String(s || "item").toLowerCase().replace(/[^\w]+/g, "-");
        const removePatch = (navId, callback, wrapper) => {
            const api = vcApi(), m = wrappers.get(navId), set = m && m.get(callback);
            if (!set) return;
            for (const w of wrapper ? [wrapper] : [...set]) if (set.delete(w) && api) api.removeContextMenuPatch(navId, w);
            if (!set.size) { m.delete(callback); if (!m.size) wrappers.delete(navId); }
        };

        const buildItem = props => {
            const R = Webpack.React(), M = menu();
            if (!props || !R) return null;
            const type = props.type;
            if (type === "separator") return M.MenuSeparator ? R.createElement(M.MenuSeparator, { key: props.id || "separator-" + Math.random() }) : null;
            if (type === "group") return M.MenuGroup ? R.createElement(M.MenuGroup, { key: props.id || slug(props.label), label: props.label }, buildMenuChildren(props.items || props.children || [])) : null;
            const id = props.id || slug(props.label);
            const common = {
                key: id, id, label: props.label, subtext: props.subtext, icon: props.icon, disabled: props.disabled,
                color: props.danger ? "danger" : props.color, action: props.action || props.onClick,
            };
            if (type === "toggle" && M.MenuCheckboxItem) return R.createElement(M.MenuCheckboxItem, Object.assign(common, { checked: props.checked != null ? props.checked : props.active }));
            if (type === "radio" && M.MenuRadioItem) return R.createElement(M.MenuRadioItem, Object.assign(common, { checked: props.checked != null ? props.checked : props.active, group: props.group || id }));
            if (type === "control" && M.MenuControlItem) return R.createElement(M.MenuControlItem, Object.assign(common, { control: props.control }));
            const kids = props.children || (props.items ? buildMenuChildren(props.items) : undefined);
            return M.MenuItem ? R.createElement(M.MenuItem, common, kids) : null;
        };
        const buildMenuChildren = items => (Array.isArray(items) ? items : [items]).map(buildItem).filter(Boolean);

        return {
            get CheckboxItem() { return menu().MenuCheckboxItem; },
            get ControlItem() { return menu().MenuControlItem; },
            get Group() { return menu().MenuGroup; },
            get Item() { return menu().MenuItem; },
            get Menu() { return menu().Menu; },
            get RadioItem() { return menu().MenuRadioItem; },
            get Separator() { return menu().MenuSeparator; },
            patch(navId, callback) {
                const api = vcApi();
                if (!api || typeof callback !== "function") { log("ContextMenu.patch needs Vencord's context menu API"); return () => { }; }
                const wrapper = (children, ...args) => {
                    const tree = { props: { navId, children } };
                    try { callback(tree, args[0] || {}); } catch (e) { console.error("[Lumicord] context menu patch failed", e); }
                    // the plugin may replace the children array instead of changing it in place
                    if (tree.props.children !== children) children.splice(0, children.length, ...[].concat(tree.props.children).filter(x => x != null));
                };
                api.addContextMenuPatch(navId, wrapper);
                if (!wrappers.has(navId)) wrappers.set(navId, new Map());
                const m = wrappers.get(navId);
                if (!m.has(callback)) m.set(callback, new Set());
                m.get(callback).add(wrapper);
                return () => removePatch(navId, callback, wrapper);
            },
            unpatch: (navId, callback) => removePatch(navId, callback),
            buildItem,
            buildMenuChildren,
            buildMenu: items => function LumicordMenu(props) {
                const R = Webpack.React(), M = menu();
                return R.createElement(M.Menu, Object.assign({ navId: "lumicord-menu", onClose: () => { } }, props), buildMenuChildren(items));
            },
            open(event, MenuComponent, config) {
                const C = window.Vencord && window.Vencord.Webpack.Common.ContextMenuApi;
                if (C) return C.openContextMenu(event, p => Webpack.React().createElement(MenuComponent, p), config);
            },
            close() { const C = window.Vencord && window.Vencord.Webpack.Common.ContextMenuApi; if (C) C.closeContextMenu(); },
        };
    }

    // ---------------------------------------------------------------- BdApi.UI.buildSettingsPanel
    // BetterDiscord's settings builder: { settings: [{ type, id, name, note, value, ... }], onChange(category, id, value) }.
    // Types: switch, dropdown, text, number, slider, radio, color, category (nested settings). Returns a DOM element.
    function buildSettingsPanel(opts) {
        const onChange = (opts && opts.onChange) || (() => { });
        const row = (s, control, block) => h("div", { class: "lumi-sp-row" + (block ? " lumi-sp-block" : "") },
            h("div", { class: "lumi-sp-text" }, h("div", { class: "lumi-name" }, s.name || s.id), s.note && h("div", { class: "lumi-desc" }, s.note)),
            control);
        const build = (s, cat) => {
            const set = v => { s.value = v; try { onChange(cat, s.id, v); } catch (e) { console.error("[Lumicord] settings onChange", e); } };
            switch (s.type) {
                case "category": {
                    const inner = h("div", { class: "lumi-sp-cat-body" }, (s.settings || []).map(x => build(x, s.id)));
                    const head = h("button", { class: "lumi-sp-cat" + (s.collapsible === false || s.shown ? " open" : ""), onClick: () => head.classList.toggle("open") }, s.name || s.id);
                    return h("div", { class: "lumi-sp-category" }, head, inner);
                }
                case "switch": {
                    const sw = toggle(!!s.value, v => { sw.classList.toggle("on", v); set(v); });
                    return row(s, sw);
                }
                case "dropdown": case "select": {
                    const opts = s.options || [];
                    return row(s, dropdown(opts.map((o, i) => [i, o.label]), Math.max(0, opts.findIndex(o => o.value === s.value)), i => set(opts[i].value)));
                }
                case "radio": {
                    const name = "lumi-r-" + Math.random().toString(36).slice(2);
                    return row(s, h("div", { class: "lumi-sp-radio" }, (s.options || []).map(o => h("label", null,
                        h("input", { type: "radio", name, checked: o.value === s.value, onChange: () => set(o.value) }), " " + (o.name || o.label)))), true);
                }
                case "slider": {
                    const out = h("span", { class: "lumi-sp-val" }, String(s.value));
                    const input = fillRange(h("input", { type: "range", class: "lumi-sp-slider", min: s.min != null ? s.min : 0, max: s.max != null ? s.max : 100,
                        step: s.step != null ? s.step : ((s.max - s.min) <= 10 ? 0.1 : 1), value: s.value,
                        onInput: e => { out.textContent = e.target.value; }, onChange: e => set(Number(e.target.value)) }));
                    return row(s, h("div", { class: "lumi-sp-slide" }, input, out), true);
                }
                case "number":
                    return row(s, h("input", { class: "lumi-input", type: "number", value: s.value, min: s.min, max: s.max, onChange: e => set(Number(e.target.value)) }));
                case "color":
                    return row(s, colorPicker(/^#[0-9a-f]{6}$/i.test(s.value) ? s.value : "#000000", v => set(v)));
                default: // text and anything unknown
                    return row(s, h("input", { class: "lumi-input", type: "text", value: s.value == null ? "" : s.value, placeholder: s.placeholder || "", onChange: e => set(e.target.value) }));
            }
        };
        return h("div", { class: "lumi-settings-panel" }, ((opts && opts.settings) || []).map(s => build(s, null)));
    }

    const commandCallers = new Map();
    const commandTypes = { OptionTypes: {}, CommandTypes: {}, InputTypes: {}, MessageEmbedTypes: {} };
    const Commands = {
        Types: commandTypes,
        register(caller, command) {
            if (caller === "BetterDiscord") throw new Error("Plugins cannot register commands as BetterDiscord");
            if (typeof caller !== "string" || !command || !command.id || !command.name || typeof command.execute !== "function") return;
            if (!commandCallers.has(caller)) commandCallers.set(caller, new Map());
            commandCallers.get(caller).set(command.id, command);
            return () => Commands.unregister(caller, command.id);
        },
        unregister: (caller, id) => { const commands = commandCallers.get(caller); if (commands) { commands.delete(id); if (!commands.size) commandCallers.delete(caller); } },
        unregisterAll: caller => commandCallers.delete(caller),
        getCommandsByCaller: caller => [...(commandCallers.get(caller) || new Map()).values()],
    };
    const boundCommands = name => ({ Types: commandTypes, register: command => Commands.register(name, command), unregister: id => Commands.unregister(name, id), unregisterAll: () => Commands.unregisterAll(name), getCommandsByCaller: () => Commands.getCommandsByCaller(name) });
    const boundHooks = name => Object.assign({}, BdApi.Hooks, { useData: key => Data.load(name, key) });

    function BdApi(name) {
        if (!(this instanceof BdApi)) return new BdApi(name);
        // Bound API: plugin name is filled in automatically.
        this.Patcher = { before: (...a) => Patcher.before(name, ...a), after: (...a) => Patcher.after(name, ...a), instead: (...a) => Patcher.instead(name, ...a), unpatchAll: () => Patcher.unpatchAll(name), getPatchesByCaller: () => Patcher.getPatchesByCaller(name) };
        this.Data = { load: k => Data.load(name, k), save: (k, v) => Data.save(name, k, v), delete: k => Data.delete(name, k), recache: () => Data.recache(name) };
        this.DOM = Object.assign({}, BdApi.DOM, { addStyle: (id, css) => css === undefined ? addStyle(name, id) : addStyle(name + "-" + id, css), removeStyle: id => removeStyle(id ? name + "-" + id : name) });
        this.Logger = { log: (...a) => console.log(`[${name}]`, ...a), info: (...a) => console.info(`[${name}]`, ...a), warn: (...a) => console.warn(`[${name}]`, ...a), error: (...a) => console.error(`[${name}]`, ...a), debug: (...a) => console.debug(`[${name}]`, ...a), stacktrace: (m, e) => console.error(`[${name}] ${m}`, e) };
        this.Commands = boundCommands(name);
        this.Hooks = boundHooks(name);
        for (const k of ["React", "ReactDOM", "Webpack", "UI", "Utils", "Plugins", "Themes", "Net", "version", "Components", "ContextMenu", "ReactUtils"]) Object.defineProperty(this, k, { get: () => BdApi[k] });
    }
    Object.defineProperty(BdApi, "React", { get: Webpack.React });
    Object.defineProperty(BdApi, "ReactDOM", { get: Webpack.ReactDOM });
    Object.assign(BdApi, {
        version: "1.12.0",
        Webpack, Patcher, Data, Commands,
        DOM: {
            get screenWidth() { return Math.max(document.documentElement.clientWidth, window.innerWidth || 0); },
            get screenHeight() { return Math.max(document.documentElement.clientHeight, window.innerHeight || 0); },
            addStyle, removeStyle,
            createElement: (tag, opts, ...kids) => h(tag, opts && opts.className ? Object.assign({}, opts, { class: opts.className }) : opts, ...kids),
            parseHTML: (html, fragment = false) => {
                const t = document.createElement("template"); t.innerHTML = html;
                return fragment ? t.content : t.content.childNodes.length === 1 ? t.content.firstChild : t.content.childNodes;
            },
            onRemoved: (node, cb) => { const o = new MutationObserver(() => { if (!node.isConnected) { o.disconnect(); cb(); } }); o.observe(document.body, { childList: true, subtree: true }); return () => o.disconnect(); },
            onAdded: (selector, cb) => { const o = new MutationObserver(() => { const n = document.querySelector(selector); if (n) { o.disconnect(); cb(n); } }); o.observe(document.body, { childList: true, subtree: true }); const n = document.querySelector(selector); if (n) { o.disconnect(); cb(n); } return () => o.disconnect(); },
            animate: (update, duration, o = {}) => { let stopped = false, start; const tick = now => { if (stopped) return; start ??= now; const p = Math.min(1, (now - start) / duration); update((o.timing || (x => x))(p)); if (p < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return () => { stopped = true; }; },
        },
        UI: {
            showToast: toast,
            createTooltip: (node, content) => { node.title = typeof content === "string" ? content : content && content.textContent || ""; return node; },
            // Sticky notice with optional buttons ({ label, onClick }); returns a function that closes it.
            showNotice: (content, o) => {
                o = o || {};
                const close = () => { bar.classList.add("lumi-out"); setTimeout(() => bar.remove(), 250); };
                const bar = h("div", { class: "lumi-restart-bar lumi-notice" },
                    h("div", { class: "lumi-rb-text" }, typeof content === "string" ? content : (content && content.textContent) || ""),
                    (o.buttons || []).map(b => h("button", { class: "lumi-btn lumi-primary", onClick: () => { try { b.onClick && b.onClick(); } finally { close(); } } }, b.label)),
                    h("button", { class: "lumi-btn lumi-rb-later", onClick: close }, "Dismiss"));
                document.body.append(bar);
                if (o.timeout) setTimeout(close, o.timeout);
                return close;
            },
            // BetterDiscord desktop notification card; shown as a toast with the title.
            showNotification: n => { n = n || {}; toast((n.title ? n.title + ": " : "") + (typeof n.content === "string" ? n.content : ""), { type: n.type || "info", timeout: n.duration || 5000 }); return { close: () => { } }; },
            showChangelogModal: o => modal((o && o.title) || "Changelog", (o && o.subtitle) || ""),
            showInviteModal: code => modal("Join Server", "Invite: " + code),
            openDialog: o => N.openDialog ? N.openDialog(o) : Promise.reject(new Error("Native dialogs are unavailable")),
            openFloatingWindow: o => { if (!o || typeof o.id !== "string") throw new Error("Floating window requires id"); const close = modal(o.title || o.id, o.children || o.content); return { close, isOpened: () => !!document.querySelector(".lumi-backdrop") }; },
            buildSettingsPanel: buildSettingsPanel,
            buildSettingItem: setting => buildSettingsPanel({ settings: [setting] }).firstChild,
            alert: (title, content) => modal(title, content),
            showConfirmationModal: (title, content, o) => {
                o = o || {};
                return modal(title, content, [
                    { label: o.cancelText || "Cancel", onClick: o.onCancel },
                    { label: o.confirmText || "Okay", primary: !o.danger, danger: !!o.danger, onClick: o.onConfirm },
                ], o.onClose);
            },
        },
        Utils: {
            findInTree: (tree, filter, { walkable = null, ignore = [] } = {}) => {
                const seen = new Set();
                const walk = n => {
                    if (!n || typeof n !== "object" || seen.has(n)) return undefined;
                    seen.add(n);
                    try { if (filter(n)) return n; } catch { }
                    const keys = walkable || Object.keys(n);
                    for (const k of keys) { if (ignore.includes(k)) continue; let r; try { r = walk(n[k]); } catch { } if (r !== undefined) return r; }
                    return undefined;
                };
                return walk(tree);
            },
            debounce: (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
            escapeHTML: s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
            className: (...a) => { const out = []; const add = x => { if (!x) return; if (typeof x === "string" || typeof x === "number") out.push(x); else if (Array.isArray(x)) x.forEach(add); else if (typeof x === "object") Object.keys(x).forEach(k => x[k] && out.push(k)); }; a.forEach(add); return out.join(" "); },
            extend: (target, ...sources) => { for (const s of sources) for (const k in s || {}) if (s[k] && typeof s[k] === "object" && !Array.isArray(s[k])) target[k] = BdApi.Utils.extend(target[k] && typeof target[k] === "object" ? target[k] : {}, s[k]); else target[k] = s[k]; return target; },
            getNestedValue: (o, path) => String(path).split(".").reduce((v, k) => v == null ? undefined : v[k], o),
        },
        Net: { fetch: (...a) => netFetch(...a) }, // netFetch is defined further down
        // Discord components exposed by Vencord (Tooltip is what plugins use most).
        Components: {
            get Tooltip() { const C = window.Vencord && window.Vencord.Webpack.Common; return C && C.Tooltip; },
            get Text() { const C = window.Vencord && window.Vencord.Webpack.Common; return C && C.Text; },
            get Flex() { const C = window.Vencord && window.Vencord.Webpack.Common; return C && C.Flex; },
            get Button() { const C = window.Vencord && window.Vencord.Webpack.Common; return C && C.Button; },
            get Spinner() { const C = window.Vencord && window.Vencord.Webpack.Common; return C && C.Spinner; },
        },
        Hooks: {
            // re-renders the component whenever one of the stores changes; prefers Discord's own hook (via Vencord)
            useStateFromStores(stores, getState, deps, areEqual) {
                const C = window.Vencord && window.Vencord.Webpack.Common;
                if (C && typeof C.useStateFromStores === "function") return C.useStateFromStores(stores, getState, deps, areEqual);
                const R = Webpack.React();
                const [state, setState] = R.useState(getState);
                R.useEffect(() => {
                    const update = () => setState(getState());
                    stores.forEach(s => s.addChangeListener(update));
                    update();
                    return () => stores.forEach(s => s.removeChangeListener(update));
                }, deps || []);
                return state;
            },
            useForceUpdate() { const R = Webpack.React(); const [, set] = R.useState(0); return () => set(x => x + 1); },
            useData(p, k) { return Data.load(p, k); },
        },
        ReactUtils: {
            get rootInstance() { const r = document.getElementById("app-mount"); return r && r._reactRootContainer && r._reactRootContainer._internalRoot && r._reactRootContainer._internalRoot.current; },
            getInternalInstance: el => { if (!el) return undefined; const k = Object.keys(el).find(x => x.startsWith("__reactFiber$") || x.startsWith("__reactInternalInstance$")); return k ? el[k] : undefined; },
            getOwnerInstance(el) {
                for (let f = BdApi.ReactUtils.getInternalInstance(el); f; f = f.return) if (f.stateNode && typeof f.stateNode.forceUpdate === "function") return f.stateNode;
                return undefined;
            },
            wrapElement: element => () => element,
            wrapInHooks: component => component,
            getType: component => component && (component.type || component.render || component),
            rerenderComponent: () => { },
            createNodePatcher: () => ({ patch: () => () => { }, unpatchAll: () => { } }),
        },
        ContextMenu: contextMenuApi(),
        Plugins: addonApi("plugin"),
        Themes: addonApi("theme"),
    });
    // Legacy global API used by older plugins.
    Object.assign(BdApi, {
        settings: [], // BetterDiscord's own settings list; Lumicord has none of them
        isSettingEnabled: () => false, enableSetting: () => { }, disableSetting: () => { },
        injectCSS: addStyle, clearCSS: removeStyle,
        loadData: Data.load, saveData: Data.save, deleteData: Data.delete,
        showToast: toast, alert: BdApi.UI.alert, showConfirmationModal: BdApi.UI.showConfirmationModal,
        findModule: f => getModule(f), findAllModules: f => getModule(f, { first: false }),
        findModuleByProps: (...p) => Webpack.getByKeys(...p), findModuleByPrototypes: (...p) => Webpack.getByPrototypeKeys(...p),
        findModuleByDisplayName: n => getModule(Filters.byDisplayName(n)),
        // Legacy monkeyPatch: the callback gets { thisObject, methodArguments, returnValue, callOriginalMethod }.
        // Changes to methodArguments/returnValue are honoured, and callOriginalMethod really calls the original.
        monkeyPatch: (obj, method, o) => {
            const orig = obj && obj[method];
            if (typeof orig !== "function") return () => { };
            const wrapped = function () {
                const d = { thisObject: this, methodArguments: Array.prototype.slice.call(arguments), returnValue: undefined };
                d.callOriginalMethod = () => (d.returnValue = orig.apply(d.thisObject, d.methodArguments));
                d.originalMethod = orig;
                if (o.instead) { const r = o.instead(d); return r !== undefined ? r : d.returnValue; }
                if (o.before) o.before(d);
                d.callOriginalMethod();
                if (o.after) o.after(d);
                return d.returnValue;
            };
            Object.assign(wrapped, orig);
            wrapped.toString = () => orig.toString();
            obj[method] = wrapped;
            const unpatch = () => { if (obj[method] === wrapped) obj[method] = orig; };
            if (!patchMap.has("legacy")) patchMap.set("legacy", []);
            patchMap.get("legacy").push(unpatch);
            return unpatch;
        },
    });
    window.BdApi = BdApi;

    // ---------------------------------------------------------------- Vencord-style globals
    const OptionType = { STRING: 0, NUMBER: 1, BIGINT: 2, BOOLEAN: 3, SELECT: 4, SLIDER: 5, COMPONENT: 6, CUSTOM: 7 };
    const Devs = new Proxy({}, { get: (_, k) => ({ name: String(k), id: 0n }) });
    const makeVcSettings = name => defs => {
        const saved = () => Data.load("vc-" + name, "settings") || {};
        const store = new Proxy({}, {
            get: (_, k) => { const s = saved(); return k in s ? s[k] : (defs[k] && defs[k].default); },
            set: (_, k, v) => { const s = saved(); s[k] = v; Data.save("vc-" + name, "settings", s); return true; },
        });
        return { def: defs, store, plain: store, use: () => store, withPrivateSettings: () => ({ def: defs, store }) };
    };

    // ---------------------------------------------------------------- loading plugins
    // Turns `import x from "..."` / `export default` into something new Function can run.
    const stripEsm = src => src
        .replace(/^\s*import\s[^;]*?from\s*["'][^"']+["'];?\s*$/gm, "")
        .replace(/^\s*import\s*["'][^"']+["'];?\s*$/gm, "")
        .replace(/^\s*export\s+default\s+/m, "module.exports.default = ")
        .replace(/^\s*export\s+(const|let|var|function|class)\s/gm, "$1 ");

    // ---------------------------------------------------------------- Node shims for BetterDiscord plugins
    // Writes go through the preload, which only allows Lumicord's plugins/themes/data folders.
    const pathShim = {
        sep: "\\",
        join: (...p) => p.filter(x => x != null && x !== "").join("\\").replace(/[\\/]+/g, "\\"),
        basename: (p, ext) => { let b = String(p).split(/[\\/]/).pop(); if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length); return b; },
        dirname: p => String(p).replace(/[\\/][^\\/]*$/, ""),
        extname: p => { const m = /\.[^.\\/]*$/.exec(String(p)); return m ? m[0] : ""; },
    };
    pathShim.resolve = pathShim.normalize = (...p) => pathShim.join(...p);
    const toText = d => typeof d === "string" ? d : (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) ? new TextDecoder().decode(d) : String(d);
    const inFolder = (p, folder) => String(p).toLowerCase().replace(/\//g, "\\").startsWith(folder.toLowerCase() + "\\");
    // Like Node: no encoding gives bytes (a Buffer-like Uint8Array whose toString() is the text), an encoding gives text.
    const wantsText = o => typeof o === "string" || !!(o && o.encoding);
    const readAny = (p, o) => {
        if (wantsText(o)) return N.fs.read(p);
        const b = N.fs.readBytes(p);
        b.toString = function (enc) { return new TextDecoder(enc && enc !== "utf8" && enc !== "utf-8" ? enc : "utf-8").decode(this); };
        return b;
    };
    const fsShim = {
        writeFileSync(p, d) {
            if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) {
                const bytes = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
                const file = N.fs.writeBytes(p, bytes);
                // addon files are text: still let the app pick up a plugin/theme written as bytes
                if ((inFolder(p, N.folders.plugin) && file.endsWith(".js")) || (inFolder(p, N.folders.theme) && file.endsWith(".css"))) {
                    const text = toText(bytes);
                    setTimeout(() => onAddonFileAdded(file.endsWith(".js") ? "plugin" : "theme", file, text));
                }
                return;
            }
            const text = toText(d);
            const file = N.fs.write(p, text);
            if (inFolder(p, N.folders.plugin) && file.endsWith(".js")) setTimeout(() => onAddonFileAdded("plugin", file, text));
            else if (inFolder(p, N.folders.theme) && file.endsWith(".css")) setTimeout(() => onAddonFileAdded("theme", file, text));
        },
        writeFile(p, d, o, cb) { cb = typeof o === "function" ? o : cb; try { fsShim.writeFileSync(p, d); if (cb) cb(null); } catch (e) { if (cb) cb(e); } },
        readFileSync: (p, o) => readAny(p, o),
        readFile(p, o, cb) { const enc = typeof o === "function" ? null : o; cb = typeof o === "function" ? o : cb; let r; try { r = readAny(p, enc); } catch (e) { return cb(e); } cb(null, r); },
        existsSync: p => N.fs.exists(p),
        readdirSync: p => N.fs.list(p),
        unlinkSync: p => N.fs.remove(p),
        unlink(p, cb) { try { N.fs.remove(p); if (cb) cb(null); } catch (e) { if (cb) cb(e); } },
        mkdirSync: p => N.fs.mkdir(p),
        statSync: p => { const d = N.fs.isDir(p); return { isDirectory: () => d, isFile: () => !d }; },
    };
    fsShim.promises = { writeFile: async (p, d) => fsShim.writeFileSync(p, d), readFile: async (p, o) => readAny(p, o) };
    // Which plugin is calling, for the "wants to connect to a local address" dialog. Just a label: the dialog itself
    // is shown by Discord's main process, so a plugin cannot answer it.
    const callerName = () => {
        const m = /lumicord:\/\/\/plugins\/([^\s:)]+)/.exec(new Error().stack || "");
        if (!m) return "A plugin";
        const a = addons.plugin.find(x => x.file === decodeURIComponent(m[1]));
        return a ? a.name : decodeURIComponent(m[1]);
    };
    const netFetch = async (url, opts) => {
        const r = await N.fetch(String(url && url.url || url), Object.assign({}, opts, { who: callerName() }));
        const headers = {};
        for (const k in r.headers || {}) if (typeof r.headers[k] === "string") headers[k] = r.headers[k];
        return new Response(r.body, { status: r.status || 503, statusText: r.statusText || "", headers });
    };
    // legacy require("request")(url, cb) used by older plugins
    const requestShim = (opts, cb) => {
        const url = typeof opts === "string" ? opts : opts.url || opts.uri;
        N.fetch(url, { who: callerName() }).then(r => cb(r.status ? null : new Error(r.statusText), { statusCode: r.status, headers: r.headers }, r.body), e => cb(e));
    };
    requestShim.get = requestShim;
    const fakeRequire = mod => {
        if (mod === "fs" || mod === "original-fs") return fsShim;
        if (mod === "path") return pathShim;
        if (mod === "request") return requestShim;
        if (mod === "electron") return { shell: { openExternal: u => window.open(u, "_blank") } };
        log(`a plugin asked for require("${mod}"), which is not available`);
        return {};
    };

    // A plugin (e.g. a BDFDB plugin) saved a file into the addon folders: load it, turn it on, offer a restart.
    function onAddonFileAdded(type, file, text) {
        const old = addons[type].find(x => x.file === file);
        if (old && old.enabled) setEnabled(old, false); // replacing a running copy: stop it first
        const a = type === "theme" ? loadTheme(file, text) : loadPlugin(file, text);
        if (!a.error) setEnabled(a, true);
        // A library just arrived: plugins evaluated before it existed turned into "library missing" stubs,
        // so evaluate every other BetterDiscord plugin again now that the library is running.
        if (type === "plugin" && a.kind === "bd" && !a.error)
            addons.plugin.filter(x => x !== a && x.kind === "bd").forEach(reloadPlugin);
        toast(`${a.name} was added and enabled`, { type: a.error ? "error" : "success" });
        showRestartBar(`${a.name} was installed. Restart Discord to finish setting it up.`);
    }

    function loadPlugin(file, source) {
        const a = { type: "plugin", file, source, name: file, meta: {}, enabled: false, instance: null, error: null, kind: "lumicord" };
        try {
            if (file.endsWith(".plugin.js")) {
                a.kind = "bd"; a.meta = parseMeta(source); a.name = a.meta.name || file;
                const module = { exports: {} };
                new Function("module", "exports", "require", "BdApi", "global", source + "\n//# sourceURL=lumicord:///plugins/" + file)(module, module.exports, fakeRequire, BdApi, window);
                let P = module.exports;
                if (P && typeof P !== "function" && P.default) P = P.default;
                if (typeof P !== "function") throw new Error("Plugin does not export a class or function");
                a.instance = P.prototype ? new P(a.meta) : P(a.meta);
                if (!a.instance || typeof a.instance.start !== "function" || typeof a.instance.stop !== "function") throw new Error("Missing start or stop function");
                for (const key of ["name", "author", "description", "version"]) {
                    if (!a.meta[key] && typeof a.instance["get" + key[0].toUpperCase() + key.slice(1)] === "function") a.meta[key] = String(a.instance["get" + key[0].toUpperCase() + key.slice(1)]());
                }
                a.name = a.meta.name || a.name;
                // BetterDiscord runs load() when the plugin is loaded, even if it stays disabled
                if (a.instance && typeof a.instance.load === "function") { try { a.instance.load(); } catch (e) { console.error("[Lumicord]", a.name, "load() failed", e); } a.loaded = true; }
            } else if (file.endsWith(".vc.js")) {
                a.kind = "vencord";
                const module = { exports: {} };
                const ret = new Function("module", "exports", "definePlugin", "definePluginSettings", "OptionType", "Devs", "require",
                    stripEsm(source) + "\n//# sourceURL=lumicord:///plugins/" + file)(module, module.exports, p => p, makeVcSettings(file), OptionType, Devs, fakeRequire);
                const p = module.exports.default || (module.exports.name ? module.exports : ret);
                if (!p || !p.name) throw new Error("No definePlugin({ name, ... }) found");
                a.instance = p; a.name = p.name;
                a.meta = { name: p.name, description: p.description || "", author: (p.authors || []).map(x => x.name).join(", "), version: p.version || "" };
                if (p.patches && p.patches.length) a.warning = "Uses webpack patches, which Lumicord does not support. Only start()/stop() run.";
            } else {
                a.instance = (0, eval)(source + "\n//# sourceURL=lumicord:///plugins/" + file);
                a.name = a.instance.name || file;
                a.meta = { name: a.name, description: a.instance.description || "", author: a.instance.author || "", version: a.instance.version || "" };
            }
            if (!a.meta.description && a.instance && a.instance.description) a.meta.description = a.instance.description;
        } catch (e) { a.error = e; console.error("[Lumicord] failed to load", file, e); }
        addons.plugin = addons.plugin.filter(x => x.file !== file).concat(a);
        return a;
    }

    function loadTheme(file, source) {
        const meta = parseMeta(source);
        const a = { type: "theme", file, source, name: meta.name || file.replace(/(\.theme)?\.css$/, ""), meta, enabled: false, kind: file.endsWith(".theme.css") ? "bd" : "lumicord" };
        addons.theme = addons.theme.filter(x => x.file !== file).concat(a);
        return a;
    }

    // Stop, evaluate the file again, and start it again if it was on (or is set to be on).
    function reloadPlugin(a) {
        const wasOn = a.enabled || !!settings.plugins[a.file];
        if (a.enabled) setEnabled(a, false);
        const fresh = loadPlugin(a.file, a.source);
        if (wasOn && !fresh.error) setEnabled(fresh, true);
        return fresh;
    }

    function setEnabled(a, on) {
        if (a.error) return toast(`${a.name} failed to load: ${a.error.message}`, { type: "error" });
        // Never start (or stop) twice: a second start() makes libraries like BDFDB hook functions twice and crash.
        if (!!a.enabled === !!on) { (a.type === "theme" ? settings.themes : settings.plugins)[a.file] = !!on; save(); return; }
        try {
            if (a.type === "theme") setThemeStyle(a.file, on ? a.source : null);
            else {
                const i = a.instance;
                if (on) {
                    if (a.kind === "bd") i.start && i.start(); // load() already ran in loadPlugin
                    else if (a.kind === "vencord") i.start && i.start();
                    else i.start && i.start(api);
                } else {
                    try { i.stop && i.stop(); }
                    finally { Patcher.unpatchAll(a.name); Commands.unregisterAll(a.name); }
                }
            }
            a.enabled = on;
        } catch (e) {
            console.error("[Lumicord]", a.name, e);
            toast(`${a.name} ${on ? "failed to start" : "failed to stop"}: ${e.message}`, { type: "error" });
            a.enabled = false;
            // a plugin that crashed halfway through start() may already have patched Discord: undo that
            if (on && a.type === "plugin") { Patcher.unpatchAll(a.name); try { a.instance && a.instance.stop && a.instance.stop(); } catch { } }
            // keep the user's choice saved; a temporary failure must not turn it off for good
            if (on) { (a.type === "theme" ? settings.themes : settings.plugins)[a.file] = true; save(); return; }
        }
        (a.type === "theme" ? settings.themes : settings.plugins)[a.file] = a.enabled;
        save();
    }
    const api = { addCSS: (css, id) => { id = id || "native-" + Math.random().toString(36).slice(2); addStyle(id, css); return () => removeStyle(id); } };

    const notifyPlugins = method => addons.plugin.forEach(a => {
        if (!a.enabled || !a.instance || typeof a.instance[method] !== "function") return;
        try { a.instance[method](); } catch (e) { console.error("[Lumicord]", a.name, method + "() failed", e); }
    });
    const pluginObserver = new MutationObserver(mutations => mutations.forEach(m => addons.plugin.forEach(a => {
        if (!a.enabled || !a.instance || typeof a.instance.observer !== "function") return;
        try { a.instance.observer(m); } catch (e) { console.error("[Lumicord]", a.name, "observer() failed", e); }
    })));
    pluginObserver.observe(document, { childList: true, subtree: true });
    window.addEventListener("popstate", () => notifyPlugins("onSwitch"));
    window.addEventListener("hashchange", () => notifyPlugins("onSwitch"));
    if (window.navigation && window.navigation.addEventListener) window.navigation.addEventListener("navigate", () => notifyPlugins("onSwitch"));

    const { plugins, themes } = N.listAddons();
    themes.sort((x, y) => x.file.localeCompare(y.file, "en")).forEach(t => { const a = loadTheme(t.file, t.source); if (settings.themes[t.file]) setEnabled(a, true); });
    // Like BetterDiscord: evaluate and start plugins one by one in file-name order, once Discord's modules are ready.
    // Libraries ("0BDFDB.plugin.js", "0PluginLibrary...") sort first, so they are running before the plugins that
    // check for them when their file is evaluated.
    const startEnabled = () => plugins
        .sort((x, y) => x.file.localeCompare(y.file, "en"))
        .forEach(p => { const a = loadPlugin(p.file, p.source); if (settings.plugins[p.file] && !a.error) setEnabled(a, true); }) || corePlugins.forEach(a => { if (settings.plugins[a.file]) setEnabled(a, true); });
    let tries = 0;
    const waitReady = setInterval(() => {
        const ready = getWreq() && Webpack.React();
        if (!ready && ++tries === 150) toast("Lumicord: Discord is slow to load, plugins will start when it is ready", { type: "warning" });
        if (ready) {
            clearInterval(waitReady); startEnabled(); log("ready", addons);
            // dev only: evaluate an expression from settings.json and log the result (for diagnosing plugins)
            if (settings.dev && settings.devEval) setTimeout(() => {
                try { rlog("devEval:", String((0, eval)(settings.devEval)).slice(0, 3000)); } catch (e) { rlog("devEval error:", e && e.stack); }
            }, settings.devEvalDelay || 3000);
        }
    }, 200);

    // ---------------------------------------------------------------- settings UI
    const ICONS = {
        plugins: '<path fill="currentColor" d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5Z"/>',
        themes: '<path fill="currentColor" d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3a2 2 0 0 1 1.5-3.3H17a5 5 0 0 0 5-5C22 5.9 17.5 2 12 2ZM6.5 13a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/>',
        market: '<path fill="currentColor" d="M4 4h16l1 5a3 3 0 0 1-5 2.2A3 3 0 0 1 12 11a3 3 0 0 1-4-.8A3 3 0 0 1 3 9l1-5Zm1 9.5V20a1 1 0 0 0 1 1h4v-5h4v5h4a1 1 0 0 0 1-1v-6.5a5 5 0 0 1-3-.2 5 5 0 0 1-4 .7 5 5 0 0 1-4-.7 5 5 0 0 1-3 .2Z"/>',
        sparkle: '<path fill="currentColor" d="M12 1.5c.5 5.6 4.9 10 10.5 10.5-5.6.5-10 4.9-10.5 10.5C11.5 16.9 7.1 12.5 1.5 12 7.1 11.5 11.5 7.1 12 1.5Z"/>',
        folder: '<path fill="currentColor" d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"/>',
        gear: '<path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7 7 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7 7 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7 7 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7 7 0 0 0 1.7-1l2.5 1 2-3.4-2.1-1.6ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/>',
        trash: '<path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z"/>',
        code: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
        info: '<path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z"/>',
        update: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    };
    const svg = (name, size) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size || 20); s.setAttribute("height", size || 20); s.innerHTML = ICONS[name]; return s; };

    const toggle = (on, onChange) => {
        const t = h("button", { class: "lumi-switch" + (on ? " on" : ""), role: "switch", ariaChecked: String(on) });
        t.addEventListener("click", () => { const next = !t.classList.contains("on"); t.classList.toggle("on", next); t.setAttribute("aria-checked", String(next)); onChange(next); });
        return t;
    };
    // Our own dropdown: the native <select> list is drawn by Windows and can't be styled. btn.value and a "change"
    // event mimic a <select>, so code written for one keeps working.
    function dropdown(options, value, onChange) {
        const label = v => (options.find(o => String(o[0]) === String(v)) || options[0] || [, ""])[1];
        const btn = h("button", { class: "lumi-input lumi-dd", type: "button", ariaHasPopup: "listbox" }, label(value));
        btn.value = String(value);
        const choose = v => { value = v; btn.value = String(v); btn.textContent = label(v); if (onChange) onChange(v); btn.dispatchEvent(new Event("change")); };
        btn.addEventListener("click", e => {
            e.preventDefault(); e.stopPropagation();
            const open = document.querySelector(".lumi-dd-menu"); if (open) { open.close(); if (open.owner === btn) return; }
            const items = options.map(([v, text]) => h("button", { class: "lumi-dd-item" + (String(v) === String(value) ? " on" : ""), type: "button", role: "option",
                onClick: () => { menu.close(); choose(v); } }, text));
            const menu = h("div", { class: "lumi-dd-menu", role: "listbox" }, items);
            menu.owner = btn;
            const r = btn.getBoundingClientRect(), up = r.bottom + options.length * 36 + 16 > innerHeight;
            Object.assign(menu.style, { minWidth: r.width + "px", left: Math.max(8, r.right - Math.max(r.width, 150)) + "px", [up ? "bottom" : "top"]: (up ? innerHeight - r.top + 6 : r.bottom + 6) + "px" });
            const outside = ev => { if (!menu.contains(ev.target) && ev.target !== btn) menu.close(); };
            const keys = ev => {
                const i = items.indexOf(document.activeElement);
                if (ev.key === "Escape") { ev.stopImmediatePropagation(); menu.close(); btn.focus(); }
                else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); items[(i + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
            };
            menu.close = () => { menu.remove(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", keys, true); };
            document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", keys, true);
            document.body.append(menu);
            (items.find(x => x.classList.contains("on")) || items[0]).focus();
        });
        return btn;
    }
    // Range sliders: fill the track up to the knob.
    const fillRange = el => { const f = () => el.style.setProperty("--fill", ((el.value - el.min) / ((el.max - el.min) || 1) * 100) + "%"); el.addEventListener("input", f); f(); return el; };

    // Where an addon comes from, as plain gray text (no colored badges).
    const badge = kind => custom().showSources !== false && h("span", { class: "lumi-source" }, { bd: "BetterDiscord", vencord: "Vencord", lumicord: "Lumicord" }[kind] + " addon");

    function pluginSettingsPanel(a) {
        const i = a.instance;
        if (a.kind === "bd" && i && typeof i.getSettingsPanel === "function") {
            let panel; try { panel = i.getSettingsPanel(); } catch (e) { return toast(e.message, { type: "error" }); }
            if (typeof panel === "string") panel = BdApi.DOM.parseHTML(panel);
            return modal(a.name + " settings", panel, [{ label: "Done", primary: true }]);
        }
        if (a.kind === "vencord" && i && i.settings && i.settings.def) {
            const box = h("div", { class: "lumi-form" });
            for (const [k, d] of Object.entries(i.settings.def)) {
                const cur = i.settings.store[k];
                let input;
                if (d.type === OptionType.BOOLEAN) input = toggle(!!cur, v => { i.settings.store[k] = v; input.classList.toggle("on", v); });
                else if (d.type === OptionType.SELECT) {
                    const opts = d.options || [], at = opts.findIndex(o => o.value === cur || (cur === undefined && o.default));
                    input = dropdown(opts.map((o, n) => [n, o.label]), Math.max(0, at), n => { i.settings.store[k] = opts[n].value; });
                } else input = h("input", { class: "lumi-input", value: cur == null ? "" : cur, type: d.type === OptionType.NUMBER || d.type === OptionType.SLIDER ? "number" : "text", onChange: e => { i.settings.store[k] = d.type === OptionType.STRING ? e.target.value : Number(e.target.value); } });
                box.append(h("label", { class: "lumi-row" }, h("div", null, h("div", { class: "lumi-name" }, k), h("div", { class: "lumi-desc" }, d.description || "")), input));
            }
            return modal(a.name + " settings", box, [{ label: "Done", primary: true }]);
        }
        if (i && typeof i.settingsAbout === "string") return modal(a.name, i.settingsAbout);
    }

    function openAddonSettings(a) {
        openPage(a.type === "plugin" ? "plugins" : "themes");
    }
    const hasSettings = a => a.instance && ((a.kind === "bd" && typeof a.instance.getSettingsPanel === "function") || (a.kind === "vencord" && a.instance.settings && a.instance.settings.def));

    // ---------------------------------------------------------------- built-in Lumicord plugins (Vencord-style, no BD files)
    const cssPlugin = css => function () { return { start() { addStyle("core-" + this.id, css); }, stop() { removeStyle("core-" + this.id); } }; };
    const coreDefs = [
        { id: "ClearURLs", description: "Removes tracking parameters (utm_, fbclid, si…) from links before you send them.", make() {
            const clean = t => t.replace(/https?:\/\/[^\s<>]+/g, u => { try { const x = new URL(u); [...x.searchParams.keys()].filter(k => /^(utm_|fbclid|gclid|mc_eid|igshid|si$|ref_src|ref$)/i.test(k)).forEach(k => x.searchParams.delete(k)); return x.toString() === u ? u : x.toString().replace(/\?$/, ""); } catch { return u; } });
            return { start() { const M = Webpack.getByKeys("sendMessage", "editMessage"); if (!M) throw new Error("Message module not found");
                Patcher.before("ClearURLs", M, "sendMessage", (_, a) => { if (a[1] && typeof a[1].content === "string") a[1].content = clean(a[1].content); });
                Patcher.before("ClearURLs", M, "editMessage", (_, a) => { if (a[2] && typeof a[2].content === "string") a[2].content = clean(a[2].content); }); }, stop() { } };
        }, clean: null },
        { id: "SilentTyping", description: "Others won't see \"is typing…\" when you type.", make() {
            return { start() { const M = Webpack.getByKeys("startTyping", "stopTyping"); if (!M) throw new Error("Typing module not found"); Patcher.instead("SilentTyping", M, "startTyping", () => { }); }, stop() { } };
        } },
        { id: "CopyCodeBlocks", description: "Adds a Copy button to code blocks in messages.", make() {
            let mo; const add = root => root.querySelectorAll && root.querySelectorAll("pre > code:not([data-lumi-copy])").forEach(c => {
                c.dataset.lumiCopy = "1"; const pre = c.parentNode; pre.style.position = "relative";
                pre.append(h("button", { class: "lumi-codecopy", onClick: e => { navigator.clipboard.writeText(c.textContent); e.currentTarget.textContent = "Copied"; } }, "Copy"));
            });
            return { start() { addStyle("core-copycode", ".lumi-codecopy{position:absolute;top:6px;right:6px;padding:2px 8px;font-size:12px;border:0;border-radius:4px;background:var(--background-secondary,#2b2d31);color:var(--text-normal,#dbdee1);cursor:pointer;opacity:0;transition:opacity .15s}pre:hover>.lumi-codecopy{opacity:1}");
                add(document); mo = new MutationObserver(m => m.forEach(r => r.addedNodes.forEach(add))); mo.observe(document.body, { childList: true, subtree: true }); },
                stop() { mo && mo.disconnect(); removeStyle("core-copycode"); document.querySelectorAll(".lumi-codecopy").forEach(b => b.remove()); document.querySelectorAll("[data-lumi-copy]").forEach(c => delete c.dataset.lumiCopy); } };
        } },
        { id: "QuickRestart", description: "Press Ctrl+Shift+R to restart Discord.", make() {
            const key = e => { if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === "KeyR") { e.preventDefault(); e.stopPropagation(); N.relaunch(); } };
            return { start() { window.addEventListener("keydown", key, true); }, stop() { window.removeEventListener("keydown", key, true); } };
        } },
        { id: "HideGiftButton", description: "Hides the gift and sticker buttons in the message bar.", make: cssPlugin('button[aria-label="Send a gift"],div:has(>button[aria-label="Send a gift"]),button[aria-label="Open sticker picker"]{display:none!important}') },
        { id: "HideNitroUpsells", description: "Hides the Nitro and Shop links in your DM list.", make: cssPlugin('li:has(a[href="/store"]),li:has(a[href="/shop"]),[class*="channel"]:has(>[class*="interactive"] a[href="/store"]),[class*="channel"]:has(>[class*="interactive"] a[href="/shop"]){display:none!important}') },
        { id: "SquareAvatars", description: "Shows avatars with slightly rounded square corners.", make: cssPlugin('[class*="avatar"] img,img[class*="avatar"],foreignObject[mask*="avatar"]{border-radius:22%!important}foreignObject[mask*="avatar"]{mask:none!important}') },
        { id: "NoReplyMention", description: "Replies don't ping the person you reply to by default.", make() {
            return { start() { const M = Webpack.getByKeys("createPendingReply"); if (!M) throw new Error("Reply module not found"); Patcher.before("NoReplyMention", M, "createPendingReply", (_, a) => { if (a[0] && typeof a[0] === "object") a[0].shouldMention = false; }); }, stop() { } };
        } },
    ];
    const corePlugins = coreDefs.map(d => {
        const a = { type: "plugin", kind: "core", file: "core:" + d.id, name: d.id, meta: { name: d.id, description: d.description, author: "Lumicord" }, enabled: false, error: null };
        a.instance = d.make.call({ id: d.id }); if (a.instance.start) { const s = a.instance.start; a.instance.start = () => s.call({ id: d.id }); }
        if (a.instance.stop) { const s = a.instance.stop; a.instance.stop = () => s.call({ id: d.id }); }
        return a;
    });

    function corePage() {
        const q = h("input", { class: "lumi-input lumi-search", placeholder: "Search Lumicord plugins…" });
        const list = h("div", { class: "lumi-list" });
        const draw = () => {
            list.textContent = "";
            const items = corePlugins.filter(a => (a.name + " " + a.meta.description).toLowerCase().includes(q.value.toLowerCase()));
            if (!items.length) list.append(h("div", { class: "lumi-empty" }, "Nothing matches your search."));
            items.forEach((a, n) => {
                let card; const sw = toggle(a.enabled, v => { setEnabled(a, v); sw.classList.toggle("on", a.enabled); card.classList.toggle("lumi-on", a.enabled); });
                list.append(card = h("div", { class: "lumi-card lumi-anim" + (a.enabled ? " lumi-on" : ""), style: { animationDelay: Math.min(n * 30, 300) + "ms" } },
                    h("div", { class: "lumi-card-top" }, h("div", { class: "lumi-card-title" }, h("span", { class: "lumi-name" }, a.name)), sw),
                    h("div", { class: "lumi-desc" }, a.meta.description)));
            });
        };
        q.addEventListener("input", draw); draw();
        return h("div", null, h("div", { class: "lumi-note" }, "Plugins built into Lumicord. They apply right away, no restart needed."), h("div", { class: "lumi-toolbar" }, q), list);
    }

    function addonList(type, rerender) {
        const q = h("input", { class: "lumi-input lumi-search", placeholder: `Search ${type}s…` });
        const show = dropdown([["all", "All"], ["on", "Enabled"], ["off", "Disabled"]], "all");
        const list = h("div", { class: "lumi-list" });
        const draw = () => {
            list.textContent = "";
            const items = addons[type].filter(a => show.value === "all" || (show.value === "on") === !!a.enabled).filter(a => (a.name + " " + (a.meta.description || "")).toLowerCase().includes(q.value.toLowerCase()))
                .sort((x, y) => custom().addonSort === "enabled" ? Number(y.enabled) - Number(x.enabled) || x.name.localeCompare(y.name) : x.name.localeCompare(y.name));
            if (!items.length) list.append(h("div", { class: "lumi-empty" }, addons[type].length ? "Nothing matches your search or filter." : `No ${type}s yet. Get some from the Marketplace tab, or drop files into the ${type}s folder.`));
            let n = 0;
            for (const a of items) {
                let card;
                const sw = toggle(a.enabled, v => {
                    setEnabled(a, v); sw.classList.toggle("on", a.enabled); card.classList.toggle("lumi-on", a.enabled);
                    const gear = card.querySelector(".lumi-gear"); if (gear) gear.style.display = a.enabled ? "" : "none";
                    // Like Vencord: plugins hook Discord as it loads, so offer a restart after turning one on or off.
                    // (Themes are plain CSS and apply instantly, so they don't need it.)
                    if (type === "plugin" && a.enabled === v)
                        showRestartBar(`${a.name} was turned ${v ? "on" : "off"}. Restart Discord to apply it fully.`);
                });
                // BetterDiscord-style card: title line + switch, description, footer with source and actions.
                const link = a.meta.source || a.meta.website;
                const btns = h("div", { class: "lumi-actions" },
                    link && h("button", { class: "lumi-icon-btn", title: "Source", onClick: () => window.open(link, "_blank") }, svg("code", 18)),
                    // like BetterDiscord: settings only while the plugin is on (many plugins load their settings in start())
                    hasSettings(a) && h("button", { class: "lumi-icon-btn lumi-gear", title: "Settings", style: { display: a.enabled ? "" : "none" }, onClick: () => pluginSettingsPanel(a) }, svg("gear", 18)),
                    h("button", { class: "lumi-icon-btn lumi-del", title: "Delete", onClick: () => {
                        const remove = () => { if (a.enabled) setEnabled(a, false); N.deleteAddon(type, a.file); addons[type] = addons[type].filter(x => x !== a); draw(); };
                        if (custom().confirmDelete === false) return remove();
                        modal("Delete " + a.name + "?", "This removes the file " + a.file + ".", [
                        { label: "Cancel" },
                        { label: "Delete", danger: true, onClick: remove },
                    ]);
                    } }, svg("trash", 18)));
                list.append(card = h("div", { class: "lumi-card lumi-anim" + (a.enabled ? " lumi-on" : "") + (a.error ? " lumi-broken" : ""), style: { animationDelay: Math.min(n++ * 30, 300) + "ms" } },
                    h("div", { class: "lumi-card-top" },
                        h("div", { class: "lumi-card-title" },
                            h("span", { class: "lumi-name" }, a.name),
                            a.meta.version && h("span", { class: "lumi-ver" }, "v" + a.meta.version),
                            a.meta.author && h("span", { class: "lumi-author" }, "by " + a.meta.author)),
                        sw),
                    h("div", { class: "lumi-desc" }, a.error ? "Failed to load: " + a.error.message : (a.meta.description || "No description.")),
                    a.warning && h("div", { class: "lumi-warn" }, a.warning),
                    h("div", { class: "lumi-card-foot" }, badge(a.kind), btns)));
            }
        };
        q.addEventListener("input", draw); show.addEventListener("change", draw);
        draw();
        return h("div", null,
            h("div", { class: "lumi-toolbar" }, q, show, h("button", { class: "lumi-btn", onClick: () => N.openFolder(type) }, svg("folder", 16), " Open folder")),
            list);
    }

    const storeCache = {};
    // fixedType: show only plugins or only themes (used inside the Plugins / Themes pages).
    function marketplace(fixedType) {
        let type = fixedType || "plugin";
        const tabs = h("div", { class: "lumi-tabs" });
        const q = h("input", { class: "lumi-input lumi-search", placeholder: "Search the marketplace…" });
        const sort = dropdown([["downloads", "Most downloaded"], ["likes", "Most liked"], ["name", "Name"]], "downloads");
        sort.classList.add("lumi-sort");
        const grid = h("div", { class: "lumi-mgrid" }); // compact card grid, like the BetterDiscord store
        const draw = () => {
            grid.textContent = "";
            const data = storeCache[type];
            if (!data) { for (let i = 0; i < 6; i++) grid.append(h("div", { class: "lumi-mcard lumi-skeleton" })); return; }
            if (data instanceof Error) { grid.append(h("div", { class: "lumi-empty" }, "Could not load the marketplace: " + data.message)); return; }
            const s = q.value.toLowerCase();
            const items = data.filter(a => (a.name + " " + a.description + " " + a.author + " " + a.tags.join(" ")).toLowerCase().includes(s))
                .sort((x, y) => sort.value === "name" ? x.name.localeCompare(y.name) : y[sort.value] - x[sort.value]).slice(0, 120);
            let n = 0;
            for (const a of items) {
                const installed = addons[type].some(x => x.name === a.name);
                const btn = h("button", { class: "lumi-btn lumi-primary", disabled: installed }, installed ? "Installed" : "Install");
                btn.addEventListener("click", async () => {
                    btn.disabled = true; btn.classList.add("lumi-loading"); btn.textContent = "Installing";
                    try {
                        const r = await N.install(a.id, type);
                        const added = type === "theme" ? loadTheme(r.file, r.source) : loadPlugin(r.file, r.source);
                        // look the addon up again when clicked: a reinstall may have replaced this object since
                        const current = () => addons[type].find(x => x.file === r.file) || added;
                        btn.classList.remove("lumi-loading"); btn.classList.add("lumi-done"); btn.textContent = "✓ Installed";
                        toast(`${a.name} installed`, { type: "success" });
                        if (!added.error) modal(a.name + " installed", type === "plugin"
                            ? "Turn it on now? Some plugins only work fully after Discord restarts."
                            : "Turn this theme on now?", [
                            { label: "Later" },
                            { label: "Enable", primary: type === "theme", onClick: () => setEnabled(current(), true) },
                            type === "plugin" && { label: "Enable & Restart", primary: true, onClick: () => { setEnabled(current(), true); N.relaunch(); } },
                        ].filter(Boolean));
                        if (type === "plugin") showRestartBar(`${a.name} was installed. Restart Discord to load it cleanly.`);
                    } catch (e) { btn.disabled = false; btn.classList.remove("lumi-loading"); btn.textContent = "Install"; toast("Install failed: " + e.message, { type: "error" }); }
                });
                // Same card layout as the installed list: title line + action, description, footer.
                const preview = custom().showThumbnails !== false && a.thumbnail && h("button", { class: "lumi-icon-btn", title: "Preview", onClick: () => {
                    const img = h("img", { src: a.thumbnail, alt: a.name + " preview", class: "lumi-preview-img" });
                    img.onerror = () => img.replaceWith("No preview image available.");
                    modal(a.name, img, [{ label: "Close" }]);
                } }, svg("themes", 18));
                // BetterDiscord-store style card: small thumbnail on top, name/author, 2-line description, stats + action
                const thumb = custom().showThumbnails !== false && a.thumbnail
                    ? h("div", { class: "lumi-mthumb", title: "Preview", onClick: () => preview && preview.click() }, h("img", { src: a.thumbnail, alt: "", loading: "lazy", onError: e => { e.currentTarget.parentNode.classList.add("lumi-mthumb-none"); e.currentTarget.remove(); } }))
                    : h("div", { class: "lumi-mthumb lumi-mthumb-none" }, svg(type === "theme" ? "themes" : "plugins", 28));
                grid.append(h("div", { class: "lumi-mcard lumi-anim", style: { animationDelay: Math.min(n++ * 20, 300) + "ms" } },
                    thumb,
                    h("div", { class: "lumi-mbody" },
                        h("div", { class: "lumi-mname", title: a.name }, a.name, a.version && h("span", { class: "lumi-ver" }, " v" + a.version)),
                        h("div", { class: "lumi-mauthor" }, "by " + a.author),
                        h("div", { class: "lumi-mdesc" }, a.description || "No description.")),
                    h("div", { class: "lumi-mfoot" },
                        h("span", { class: "lumi-mstats" }, svg("update", 13), " " + a.downloads.toLocaleString(), h("span", { class: "lumi-mheart" }, " ♥ " + a.likes.toLocaleString())),
                        btn)));
            }
            if (!items.length) grid.append(h("div", { class: "lumi-empty" }, "Nothing matches your search."));
        };
        const load = () => {
            draw();
            const t = type; // the user may switch tabs before this finishes
            if (!storeCache[t]) N.store(t).then(d => { storeCache[t] = d; }, e => { storeCache[t] = e; }).then(() => { if (type === t) draw(); });
        };
        const tabBtn = (t, label) => {
            const b = h("button", { class: "lumi-tab" + (t === type ? " active" : ""), onClick: () => { type = t; [...tabs.children].forEach(x => x.classList.toggle("active", x === b)); load(); } }, label);
            return b;
        };
        tabs.append(tabBtn("plugin", "Plugins"), tabBtn("theme", "Themes"));
        q.placeholder = fixedType === "theme" ? "Search themes…" : fixedType === "plugin" ? "Search plugins…" : "Search the marketplace…";
        q.addEventListener("input", draw); sort.addEventListener("change", draw);
        load();
        return h("div", null,
            h("div", { class: "lumi-note" }, type === "theme" && fixedType
                ? "Themes from the public BetterDiscord catalog. These CSS themes also work in Vencord."
                : "Addons come from the public BetterDiscord catalog. They run with full access to Discord, so only install ones you trust."),
            !fixedType && tabs, h("div", { class: "lumi-toolbar" }, q, sort), grid);
    }

    // Plugins / Themes pages: "Installed" and "Marketplace" tabs above the search box.
    function tabbedPage(type) {
        const body = h("div", { class: "lumi-tab-body" });
        const tabs = h("div", { class: "lumi-seg" });
        const ink = h("span", { class: "lumi-seg-ink" });
        const views = [["installed", "Installed", () => addonList(type)], ["market", type === "theme" ? "Themes Marketplace" : "Plugins Marketplace", () => marketplace(type)]];
        const placeInk = () => {
            const btn = tabs.querySelector("button.active");
            if (btn && btn.offsetWidth) { ink.style.width = btn.offsetWidth + "px"; ink.style.transform = `translateX(${btn.offsetLeft}px)`; }
        };
        // the page may be laid out after we first measure (settings panel animating in), so measure again on resize
        if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (!tabs.isConnected && started) return ro.disconnect(); placeInk(); }); ro.observe(tabs); }
        let started = false;
        const show = (i, btn) => {
            [...tabs.querySelectorAll("button")].forEach(b => b.classList.toggle("active", b === btn));
            placeInk();
            const view = h("div", { class: "lumi-fade" }, views[i][2]());
            body.textContent = ""; body.append(view);
        };
        tabs.append(ink);
        views.forEach(([, label], i) => { const b = h("button", { onClick: () => show(i, b) }, label); tabs.append(b); });
        const on = addons[type].filter(a => a.enabled).length;
        const stats = h("div", { class: "lumi-stats" },
            h("span", { class: "lumi-chip" }, h("b", null, String(addons[type].length)), " installed"),
            h("span", { class: "lumi-chip lumi-chip-on" }, h("b", null, String(on)), " enabled"));
        // first paint needs layout to size the ink, so select the first tab on the next frame
        requestAnimationFrame(() => { started = true; show(0, tabs.querySelector("button")); });
        return h("div", null, h("div", { class: "lumi-pagebar" }, tabs, stats), body);
    }

    // ---------------------------------------------------------------- updater
    async function runUpdate(btn) {
        if (btn) { btn.disabled = true; btn.classList.add("lumi-loading"); btn.textContent = "Updating"; }
        try {
            const r = await N.applyUpdate();
            toast(`Lumicord updated to v${r.to}`, { type: "success" });
            showRestartBar(`Lumicord was updated to v${r.to}. Restart Discord to use the new version.`);
            if (btn) { btn.classList.remove("lumi-loading"); btn.textContent = "Updated"; }
        } catch (e) {
            toast("Update failed: " + e.message, { type: "error" });
            if (btn) { btn.disabled = false; btn.classList.remove("lumi-loading"); btn.textContent = "Update"; }
        }
    }

    function updaterPage() {
        const status = h("div", { class: "lumi-desc" }, "Checking for updates…");
        const notes = h("div", { class: "lumi-notes" });
        const updateBtn = h("button", { class: "lumi-btn lumi-primary", style: { display: "none" } }, "Update");
        const checkBtn = h("button", { class: "lumi-btn" }, "Check for updates");
        updateBtn.addEventListener("click", () => runUpdate(updateBtn));
        const check = async manual => {
            checkBtn.disabled = true; status.textContent = "Checking for updates…"; notes.textContent = ""; updateBtn.style.display = "none";
            // Manual check: a "please wait" dialog that stays at least 2 seconds, so the scan is visible.
            const closeWait = manual ? modal("Checking for updates", h("div", { class: "lumi-checking" }, h("span", { class: "lumi-spinner" }), "Checking for updates, please wait…"), []) : null;
            const minWait = new Promise(r => setTimeout(r, manual ? 2000 : 0));
            try {
                const i = await Promise.all([N.checkUpdate(), minWait]).then(x => x[0]);
                if (closeWait) closeWait();
                if (manual) {
                    if (i.available) modal(`Update available: v${i.latest}`, h("div", null,
                        h("div", { class: "lumi-desc" }, `You have v${i.current}. Update now to get the latest version.`),
                        i.notes && h("div", { class: "lumi-notes" }, i.notes)),
                        [{ label: "Later" }, { label: "Update now", primary: true, onClick: () => runUpdate(updateBtn) }]);
                    else modal("You're up to date", i.note || `Lumicord v${i.current} is the latest version.`, [{ label: "Okay", primary: true }]);
                }
                if (i.available) {
                    status.textContent = `Version ${i.latest} is available. You have ${i.current}.`;
                    notes.textContent = i.notes || "No release notes.";
                    updateBtn.style.display = "";
                } else status.textContent = i.note || `You're up to date (v${i.current}).`;
            } catch (e) {
                await minWait; if (closeWait) closeWait();
                status.textContent = "Could not check for updates: " + e.message;
                if (manual) modal("Could not check for updates", e.message, [{ label: "Okay", primary: true }]);
            }
            checkBtn.disabled = false;
        };
        checkBtn.addEventListener("click", () => check(true));
        check(false);
        return h("div", null,
            h("div", { class: "lumi-card" },
                h("div", { class: "lumi-card-top" },
                    h("div", { class: "lumi-card-title" }, h("span", { class: "lumi-name" }, "Lumicord"), h("span", { class: "lumi-ver" }, "v" + N.version())),
                    h("div", { class: "lumi-actions" }, checkBtn, updateBtn)),
                status, notes,
                h("div", { class: "lumi-card-foot" }, h("span", { class: "lumi-source" }, "Updates come from github.com/v1nx0/lumicord releases"), h("span"))));
    }

    // Custom update card (bottom-right): versions, release notes, Update/Later, progress, then Restart.
    function showUpdateCard(i) {
        const old = document.querySelector(".lumi-update-card");
        if (old) old.remove();
        const status = h("div", { class: "lumi-uc-status" });
        const later = h("button", { class: "lumi-btn lumi-rb-later" }, "Later");
        const go = h("button", { class: "lumi-btn lumi-primary" }, "Update now");
        const card = h("div", { class: "lumi-update-card" },
            h("div", { class: "lumi-uc-head" },
                h("div", { class: "lumi-uc-icon" }, svg("update", 18)),
                h("div", null,
                    h("div", { class: "lumi-uc-title" }, "Lumicord update available"),
                    h("div", { class: "lumi-uc-ver" }, h("span", null, "v" + i.current), h("span", { class: "lumi-uc-arrow" }, "→"), h("b", null, "v" + i.latest))),
                h("button", { class: "lumi-uc-x", title: "Close", onClick: () => close() }, "✕")),
            h("div", { class: "lumi-uc-notes" }, i.notes || "No release notes."),
            status,
            h("div", { class: "lumi-uc-actions" }, later, go));
        const close = () => { card.classList.add("lumi-out"); setTimeout(() => card.remove(), 220); };
        later.addEventListener("click", close);
        go.addEventListener("click", async () => {
            later.disabled = true; go.disabled = true; go.classList.add("lumi-loading"); go.textContent = "Updating";
            status.textContent = "Downloading and checking the update…";
            try {
                const r = await N.applyUpdate();
                go.classList.remove("lumi-loading");
                status.textContent = `Updated to v${r.to}. Restart Discord to start using it.`;
                card.classList.add("lumi-uc-done");
                go.disabled = false; go.textContent = "Restart Discord";
                go.onclick = () => { status.textContent = "Restarting Discord…"; N.relaunch(); };
                later.disabled = false; later.textContent = "Later";
            } catch (e) {
                go.classList.remove("lumi-loading"); go.disabled = false; later.disabled = false; go.textContent = "Try again";
                status.textContent = "Update failed: " + e.message + " (your current version was kept)";
                card.classList.add("lumi-uc-error");
            }
        });
        document.body.append(card);
    }

    // Automatic checks use the selected interval; each new version is offered once per session.
    let offeredVersion = null;
    const autoCheck = () => N.checkUpdate().then(i => {
        if (!i.available || i.latest === offeredVersion) return;
        offeredVersion = i.latest;
        showUpdateCard(i);
    }, e => log("update check failed:", e.message));
    const custom = () => { const c = N.getSettings().custom; return c && typeof c === "object" && !Array.isArray(c) ? c : {}; };
    const autoCheckIfOn = () => { if (custom().autoUpdate !== false) autoCheck(); };
    let autoCheckTimer;
    const scheduleAutoCheck = () => {
        clearInterval(autoCheckTimer);
        const hours = [1, 6, 24].includes(Number(custom().updateInterval)) ? Number(custom().updateInterval) : 6;
        autoCheckTimer = setInterval(autoCheckIfOn, hours * 60 * 60 * 1000);
    };
    setTimeout(autoCheckIfOn, 10000);
    scheduleAutoCheck();

    // ---------------------------------------------------------------- Lumicord settings (settings.json "custom")
    const DEFAULT_CUSTOM = { accent: "#ec4899", hover: "#f063a9", radius: 8, fontScale: 100, pageWidth: "normal", density: "comfortable", animations: true, showSources: true, showThumbnails: true, addonSort: "name", confirmDelete: true, toastPosition: "bottom-right", toastDuration: 3000, autoUpdate: true, updateInterval: 6, showMarketplace: true, customCSS: "" };
    const ACCENTS = ["#ec4899", "#9b7bff", "#5865f2", "#23a55a", "#f0b232", "#f23f43", "#00a8fc"];
    const color = v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
    const normalizeCustom = value => {
        const v = value && typeof value === "object" && !Array.isArray(value) ? value : {}, out = {};
        for (const k in DEFAULT_CUSTOM) {
            const x = v[k], d = DEFAULT_CUSTOM[k];
            if (x !== undefined && ((typeof d === "boolean" && typeof x === "boolean") || (typeof d === "string" && typeof x === "string") || (typeof d === "number" && typeof x === "number" && Number.isFinite(x)))) out[k] = x;
        }
        if (out.accent && !color(out.accent)) delete out.accent;
        if (out.hover && !color(out.hover)) delete out.hover;
        if (out.radius != null) out.radius = Math.max(0, Math.min(16, out.radius));
        if (out.fontScale != null) out.fontScale = Math.max(80, Math.min(125, out.fontScale));
        if (out.toastDuration != null) out.toastDuration = Math.max(1000, Math.min(10000, out.toastDuration));
        if (out.updateInterval != null && ![1, 6, 24].includes(out.updateInterval)) delete out.updateInterval;
        for (const [k, allowed] of Object.entries({ pageWidth: ["narrow", "normal", "wide"], density: ["comfortable", "compact"], addonSort: ["name", "enabled"], toastPosition: ["bottom-right", "bottom-left", "top-right", "top-left"] })) if (out[k] && !allowed.includes(out[k])) delete out[k];
        return out;
    };
    const customValues = () => ({ ...DEFAULT_CUSTOM, ...normalizeCustom(custom()) });
    function applyCustom() {
        const c = customValues();
        const accent = /^#[0-9a-f]{6}$/i.test(c.accent) ? c.accent : DEFAULT_CUSTOM.accent;
        const hover = color(c.hover) ? c.hover : accent + "cc";
        const r = Math.max(0, Math.min(16, Number(c.radius) || 0));
        addStyle("lumicord-custom", `:root{--lumi-accent:${accent};--lumi-accent-hover:${hover}}
          .lumi-card,.lumi-btn,.lumi-input,.lumi-modal,.lumi-toast{border-radius:${r}px!important}
          .lumi-page{max-width:${({ narrow: 620, normal: 760, wide: 1040 }[c.pageWidth] || 760)}px;font-size:${Math.max(80, Math.min(125, Number(c.fontScale) || 100))}%}
          ${c.density === "compact" ? ".lumi-card{padding:10px 12px 0}.lumi-card-foot{margin:0 -12px;padding:6px 8px 6px 12px}.lumi-desc{margin:5px 0 9px}" : ""}
          ${c.showSources ? "" : ".lumi-source{display:none!important}"}
          ${c.animations ? "" : ".lumi-page,.lumi-page *,.lumi-modal,.lumi-modal *,.lumi-toast,.lumi-toast *{animation:none!important;transition:none!important}"}`);
        addStyle("lumicord-usercss", c.customCSS);
        themeHost.append(styles["lumicord-usercss"]); // after themes, so user CSS wins
    }
    const setCustom = patch => { const cur = N.getSettings(); cur.custom = Object.assign({}, cur.custom, normalizeCustom(patch)); N.setSettings(cur); applyCustom(); if (patch.updateInterval != null) scheduleAutoCheck(); };

    // Our own color picker: the native <input type=color> popup is drawn by Windows and can't be styled.
    const hex2hsv = hex => {
        const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
        const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
        const hue = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return [hue * 60, max ? d / max : 0, max];
    };
    const hsv2hex = (hh, ss, vv) => {
        const f = k => { const x = (k + hh / 60) % 6; return Math.round((vv - vv * ss * Math.max(0, Math.min(x, 4 - x, 1))) * 255); };
        return "#" + [f(5), f(3), f(1)].map(x => x.toString(16).padStart(2, "0")).join("");
    };
    function colorPicker(value, onChange) {
        const btn = h("button", { class: "lumi-swatch lumi-swatch-solid", title: "Pick a color", style: { background: value } });
        btn.addEventListener("click", e => {
            e.stopPropagation();
            if (document.querySelector(".lumi-cp")) return document.querySelector(".lumi-cp").remove();
            let [hu, sa, va] = hex2hsv(btn.dataset.value || value);
            const knob = h("div", { class: "lumi-cp-knob" }), area = h("div", { class: "lumi-cp-area" }, knob);
            const hue = h("input", { type: "range", class: "lumi-cp-hue", min: 0, max: 359, value: Math.round(hu) });
            const hex = h("input", { class: "lumi-input lumi-cp-hex", maxLength: 7, spellcheck: false });
            const preview = h("div", { class: "lumi-cp-preview" });
            const draw = (fromHex) => {
                const v = hsv2hex(hu, sa, va);
                area.style.background = `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${hu},100%,50%))`;
                knob.style.left = sa * 100 + "%"; knob.style.top = (1 - va) * 100 + "%"; knob.style.background = v;
                preview.style.background = v; btn.style.background = v; btn.dataset.value = v;
                if (!fromHex) hex.value = v;
                onChange(v);
            };
            const drag = ev => { const r = area.getBoundingClientRect(); sa = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); va = 1 - Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)); draw(); };
            area.addEventListener("pointerdown", ev => { area.setPointerCapture(ev.pointerId); drag(ev); area.onpointermove = drag; });
            area.addEventListener("pointerup", () => { area.onpointermove = null; });
            hue.addEventListener("input", () => { hu = Number(hue.value); draw(); });
            hex.addEventListener("input", () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { [hu, sa, va] = hex2hsv(hex.value); hue.value = Math.round(hu); draw(true); } });
            const pop = h("div", { class: "lumi-cp" }, area, h("div", { class: "lumi-cp-row" }, preview, hue), h("div", { class: "lumi-cp-row" }, hex,
                h("div", { class: "lumi-cp-presets" }, ACCENTS.map(a => h("button", { class: "lumi-cp-preset", style: { background: a }, onClick: () => { [hu, sa, va] = hex2hsv(a); hue.value = Math.round(hu); draw(); } })))));
            const r = btn.getBoundingClientRect();
            Object.assign(pop.style, { top: Math.min(r.bottom + 8, innerHeight - 300) + "px", left: Math.max(8, r.right - 240) + "px" });
            document.body.append(pop); draw();
            const close = ev => { if (!pop.contains(ev.target) && ev.target !== btn) { pop.remove(); document.removeEventListener("pointerdown", close, true); } };
            document.addEventListener("pointerdown", close, true);
        });
        return btn;
    }

    function aboutPage() {
        const link = (text, url) => h("a", { class: "lumi-link", href: url, onClick: e => { e.preventDefault(); window.open(url, "_blank"); } }, text);
        const credit = (name, by, repo, license, what) => h("div", { class: "lumi-card lumi-set-card" },
            h("div", { class: "lumi-set-title" }, name),
            h("div", { class: "lumi-desc" }, what),
            h("div", { class: "lumi-about-links" }, h("span", null, "By "), ...by.flatMap(([n, u], i) => [i ? ", " : "", link(n, u)]),
                h("span", { class: "lumi-about-sep" }, "·"), link("GitHub", repo), h("span", { class: "lumi-about-sep" }, "·"), license));
        return h("div", null,
            h("div", { class: "lumi-card lumi-set-card" },
                h("div", { class: "lumi-set-title" }, "Lumicord v" + N.version()),
                h("div", { class: "lumi-desc" }, "A Discord client mod that runs BetterDiscord plugins and themes, and includes Vencord."),
                h("div", { class: "lumi-about-links" }, link("GitHub", "https://github.com/v1nx0/lumicord"), h("span", { class: "lumi-about-sep" }, "·"), "GPL-3.0")),
            h("div", { class: "lumi-about-head" }, "Credits"),
            credit("Vencord", [["Vendicated", "https://github.com/Vendicated"]], "https://github.com/Vendicated/Vencord", "GPL-3.0",
                "Lumicord ships Vencord and its plugins."),
            credit("BetterDiscord", [["Jiiks", "https://github.com/Jiiks"], ["Zerebos", "https://github.com/zerebos"], ["contributors", "https://github.com/BetterDiscord/BetterDiscord/graphs/contributors"]],
                "https://github.com/BetterDiscord/BetterDiscord", "Apache-2.0",
                "Lumicord runs BetterDiscord plugins and themes through its own reimplementation of BdApi."),
            h("div", { class: "lumi-desc lumi-about-note" }, "Lumicord is not affiliated with Vencord, BetterDiscord or Discord. Thank you to everyone who builds these projects."));
    }

    // Profiles: named snapshots of customization + which addons are on. "Minimal" and "Full" are built in.
    const PROFILE_PRESETS = { Minimal: { custom: { animations: false, density: "compact", showThumbnails: false } }, Full: { custom: { animations: true, density: "comfortable", showThumbnails: true } } };
    const snapshot = () => ({ custom: { ...custom() }, plugins: { ...settings.plugins }, themes: { ...settings.themes } });
    function applyProfile(p) {
        const all = addons.plugin.concat(addons.theme, corePlugins);
        if (p.plugins || p.themes) for (const a of all) { const want = !!((a.type === "theme" ? p.themes : p.plugins) || {})[a.file]; if (!!a.enabled !== want) setEnabled(a, want); }
        const cur = N.getSettings(); cur.custom = normalizeCustom(p.custom); N.setSettings(cur); applyCustom(); scheduleAutoCheck();
    }
    function profilesSection(row, rerender) {
        const saved = () => { const v = N.getSettings().profiles; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
        const store = v => { const cur = N.getSettings(); cur.profiles = v; N.setSettings(cur); };
        const box = h("div", null);
        const draw = () => {
            box.textContent = "";
            const use = (name, p) => { applyProfile(p); toast(`Switched to ${name}`, { type: "success" }); rerender(); };
            for (const [name, p] of Object.entries(PROFILE_PRESETS)) box.append(row(name, "Built-in. Changes appearance only.", h("button", { class: "lumi-btn", onClick: () => use(name, p) }, "Use")));
            for (const [name, p] of Object.entries(saved())) box.append(row(name, "Saved profile: settings and enabled addons.", h("div", { class: "lumi-actions" },
                h("button", { class: "lumi-btn", onClick: () => use(name, p) }, "Use"),
                h("button", { class: "lumi-btn", title: "Overwrite with current setup", onClick: () => { store({ ...saved(), [name]: snapshot() }); toast(`${name} updated`); } }, "Save here"),
                h("button", { class: "lumi-icon-btn lumi-del", title: "Delete", onClick: () => { const v = saved(); delete v[name]; store(v); draw(); } }, svg("trash", 18)))));
            const input = h("input", { class: "lumi-input", placeholder: "Profile name", maxLength: 40 });
            const add = () => { const n = input.value.trim(); if (!n) return; if (PROFILE_PRESETS[n]) return toast("That name is built in", { type: "warning" }); store({ ...saved(), [n]: snapshot() }); toast(`Saved ${n}`, { type: "success" }); draw(); };
            input.addEventListener("keydown", e => { if (e.key === "Enter") add(); });
            box.append(row("Save current setup", "Stores your settings and which plugins and themes are on.", h("div", { class: "lumi-actions" }, input, h("button", { class: "lumi-btn lumi-primary", onClick: add }, "Save"))));
        };
        draw();
        return box;
    }

    function settingsPage() {
        const c = customValues();
        const row = (name, desc, control) => h("div", { class: "lumi-row" }, h("div", null, h("div", { class: "lumi-name" }, name), desc && h("div", { class: "lumi-desc" }, desc)), control);
        const sw = (on, fn) => toggle(on, fn);
        let nth = 0;
        const section = (title, ...rows) => h("div", { class: "lumi-card lumi-set-card", style: { animationDelay: (nth++ * 45) + "ms" } }, h("div", { class: "lumi-set-title" }, title), ...rows);
        const select = (value, options, key) => dropdown(options, value, v => setCustom({ [key]: v }));

        const mark = a => [...swatches.children].forEach(b => b.classList.toggle("on", b.title === a));
        const custom1 = colorPicker(c.accent, v => { mark(v); setCustom({ accent: v }); });
        custom1.classList.add("lumi-swatch-custom");
        const pick = a => { custom1.dataset.value = a; custom1.style.background = ""; mark(a); setCustom({ accent: a }); };
        const swatches = h("div", { class: "lumi-swatches" }, ACCENTS.map(a => h("button", { class: "lumi-swatch" + (a === c.accent ? " on" : ""), title: a, style: { background: a }, onClick: () => pick(a) })), custom1);
        if (ACCENTS.includes(c.accent)) custom1.style.background = "";
        const radiusVal = h("span", { class: "lumi-sp-val" }, c.radius + "px");
        const radius = h("input", { type: "range", class: "lumi-sp-slider", min: 0, max: 16, value: c.radius, onInput: e => { radiusVal.textContent = e.target.value + "px"; setCustom({ radius: Number(e.target.value) }); } });
        const scaleVal = h("span", { class: "lumi-sp-val" }, c.fontScale + "%");
        const scale = h("input", { type: "range", class: "lumi-sp-slider", min: 80, max: 125, value: c.fontScale, onInput: e => { scaleVal.textContent = e.target.value + "%"; setCustom({ fontScale: Number(e.target.value) }); } });
        fillRange(radius); fillRange(scale);

        const css = h("textarea", { class: "lumi-input lumi-css", spellcheck: false, placeholder: "/* Your CSS, applied live on top of Discord and themes */", value: c.customCSS,
            onInput: e => setCustom({ customCSS: e.target.value }) });

        const net = h("div", null);
        const drawNet = async () => {
            net.textContent = "";
            if (!N.localAccess) return net.append(h("div", { class: "lumi-desc" }, "Restart Discord to manage saved choices."));
            const state = await N.localAccess.state().catch(() => ({ allowAll: false }));
            let all;
            all = sw(!!state.allowAll, async v => { const ok = await N.localAccess.allowAll(v).catch(() => false); all.classList.toggle("on", ok && v); if (!ok && v) toast("Local network access was not enabled", { type: "warning" }); });
            net.append(row("Let all plugins use the local network without asking", "Requires a native confirmation. Saved Deny choices still block that host.", all));
            const list = Object.entries(await N.localAccess.list().catch(() => ({})));
            if (!list.length) return net.append(h("div", { class: "lumi-desc" }, "No saved per-host choices. Plugins that try to reach your local network will ask first."));
            list.forEach(([host, ok]) => net.append(row(host, ok ? "Allowed" : "Denied",
                h("button", { class: "lumi-btn", onClick: () => N.localAccess.forget(host).then(drawNet) }, "Forget"))));
            net.append(h("button", { class: "lumi-btn", style: { marginTop: "10px" }, onClick: () => N.localAccess.forget("*").then(drawNet) }, "Forget all"));
        };
        drawNet();

        const sidebarSwitch = sw(N.getSettings().nativeSidebar !== false, v => { const cur = N.getSettings(); cur.nativeSidebar = v; N.setSettings(cur); });
        const updateSwitch = sw(c.autoUpdate, v => setCustom({ autoUpdate: v }));
        const resetSwitch = (t, on) => { t.classList.toggle("on", on); t.setAttribute("aria-checked", String(on)); };
        const page = h("div", null,
            section("Appearance",
                row("Accent color", "Used for buttons, switches and highlights in Lumicord.", swatches),
                row("Hover color", "Used when hovering Lumicord controls.", colorPicker(c.hover, v => setCustom({ hover: v }))),
                row("Corner roundness", null, h("div", { class: "lumi-set-slider" }, radius, radiusVal)),
                row("Font size", "Scale Lumicord pages only.", h("div", { class: "lumi-set-slider" }, scale, scaleVal)),
                row("Page width", null, select(c.pageWidth, [["narrow", "Narrow"], ["normal", "Normal"], ["wide", "Wide"]], "pageWidth")),
                row("Card density", null, select(c.density, [["comfortable", "Comfortable"], ["compact", "Compact"]], "density")),
                row("Animations", "Turn off for a calmer, faster feel.", sw(c.animations, v => setCustom({ animations: v }))),
                row("Show addon source labels", null, sw(c.showSources, v => setCustom({ showSources: v }))),
                row("Show Marketplace thumbnails", null, sw(c.showThumbnails, v => setCustom({ showThumbnails: v })))),
            section("Profiles", profilesSection(row, () => page.replaceWith(settingsPage()))),
            section("Custom CSS", h("div", { class: "lumi-desc" }, "Small tweaks without making a theme. Saved automatically."), css),
            section("Behavior",
                row("Default addon sort", null, select(c.addonSort, [["name", "Name"], ["enabled", "Enabled first"]], "addonSort")),
                row("Confirm before deleting addons", null, sw(c.confirmDelete, v => setCustom({ confirmDelete: v }))),
                row("Toast position", null, select(c.toastPosition, [["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["top-right", "Top right"], ["top-left", "Top left"]], "toastPosition")),
                row("Toast duration", null, select(c.toastDuration, [[1000, "1 second"], [3000, "3 seconds"], [5000, "5 seconds"], [10000, "10 seconds"]], "toastDuration"))),
            section("Sidebar & updates",
                row("Lumicord in the settings sidebar", "Show the Lumicord section in Discord's settings list. Takes effect after a restart.",
                    sidebarSwitch),
                row("Show Marketplace page", "Takes effect when Lumicord navigation is next opened.", sw(c.showMarketplace, v => setCustom({ showMarketplace: v }))),
                row("Check for updates automatically", null, updateSwitch),
                row("Update check interval", null, select(c.updateInterval, [[1, "Every hour"], [6, "Every 6 hours"], [24, "Every 24 hours"]], "updateInterval")),
                row("Addon folders", null, h("div", { class: "lumi-actions" },
                    h("button", { class: "lumi-btn", onClick: () => N.openFolder("plugin") }, "Plugins folder"),
                    h("button", { class: "lumi-btn", onClick: () => N.openFolder("theme") }, "Themes folder")))),
            section("Local network access", h("div", { class: "lumi-desc" }, "Choices you saved with \"Remember my choice\"."), net),
            section("Import & export", row("Export settings", "Download your Lumicord customization.", h("button", { class: "lumi-btn", onClick: () => { const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(Object.assign({}, DEFAULT_CUSTOM, custom()), null, 2)], { type: "application/json" })), download: "lumicord-settings.json" }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 0); } }, "Export")),
                row("Import settings", "Only recognized, valid settings are applied.", (() => { const input = h("input", { type: "file", accept: "application/json", style: { display: "none" } }); const b = h("button", { class: "lumi-btn", onClick: () => input.click() }, "Import"); input.onchange = () => { const f = input.files[0]; if (!f) return; f.text().then(JSON.parse).then(v => { const clean = normalizeCustom(v); if (!Object.keys(clean).length && Object.keys(v || {}).length) throw new Error("No valid settings found"); const cur = N.getSettings(); cur.custom = Object.assign({}, cur.custom, clean); N.setSettings(cur); applyCustom(); scheduleAutoCheck(); toast("Settings imported", { type: "success" }); }).catch(e => toast("Import failed: " + e.message, { type: "error" })); }; return h("div", null, input, b); })())),
            h("button", { class: "lumi-btn", onClick: () => BdApi.UI.showConfirmationModal("Reset settings", "Reset appearance, custom CSS and general options to their defaults?", { danger: true, confirmText: "Reset",
                onConfirm: () => { const cur = N.getSettings(); delete cur.custom; delete cur.nativeSidebar; N.setSettings(cur); applyCustom(); scheduleAutoCheck(); page.replaceWith(settingsPage()); toast("Settings reset"); } }) }, "Reset to defaults"));
        return page;
    }

    const PAGES = {
        plugins: { label: "Plugins", icon: "plugins", render: () => tabbedPage("plugin") },
        core: { label: "Lumicord Plugins", icon: "plugins", render: corePage },
        themes: { label: "Themes", icon: "themes", render: () => tabbedPage("theme") },
        marketplace: { label: "Marketplace", icon: "market", render: () => marketplace() },
        updater: { label: "Updater", icon: "update", render: updaterPage },
        settings: { label: "Settings", icon: "gear", render: settingsPage },
        about: { label: "About", icon: "info", render: aboutPage },
    };
    const visiblePages = () => Object.keys(PAGES).filter(k => k !== "marketplace" || custom().showMarketplace !== false);
    const pageContent = key => h("div", { class: "lumi-page" }, h("h1", { class: "lumi-h1" }, PAGES[key].label), PAGES[key].render());

    // ---------------------------------------------------------------- sidebar injection
    // Discord class names are hashed and change often, so find the sidebar by its English item labels
    // and copy a real item's markup so our entries match Discord's look.
    const ANCHORS = ["Appearance", "Accessibility", "Voice & Video", "Notifications", "Keybinds", "Advanced", "Language & Time", "Chat"];
    let overlay = null, activeKey = null;

    const findItem = () => {
        for (const label of ANCHORS) {
            const r = document.evaluate(`//*[not(ancestor::*[@data-lumicord])][normalize-space(text())=${JSON.stringify(label)}]`, document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < r.snapshotLength; i++) {
                const textEl = r.snapshotItem(i);
                let item = textEl;
                while (item && item !== document.body && !item.querySelector("svg")) item = item.parentElement;
                if (!item || item === document.body) continue;
                // the item's parent should hold several sibling items (a sidebar list)
                const sibs = [...item.parentElement.children].filter(c => c.querySelector && c.querySelector("svg"));
                if (sibs.length >= 2 && item.getAttribute("aria-selected") !== "true") return { item, textEl, label };
            }
        }
        return null;
    };

    function closeOverlay() {
        if (overlay) { overlay.remove(); overlay = null; }
        activeKey = null;
        document.querySelectorAll("[data-lumicord-item]").forEach(e => e.classList.remove("lumi-selected"));
    }

    function openPage(key, anchorEl) {
        closeOverlay();
        activeKey = key;
        document.querySelectorAll(`[data-lumicord-item]`).forEach(e => e.classList.toggle("lumi-selected", e.dataset.lumicordItem === key));
        // place the page over Discord's settings content area, to the right of the sidebar
        let sidebar = anchorEl;
        while (sidebar && sidebar.parentElement && sidebar.parentElement.getBoundingClientRect().width < window.innerWidth * 0.5) sidebar = sidebar.parentElement;
        const sb = sidebar ? sidebar.getBoundingClientRect() : null;
        const host = sidebar && sidebar.parentElement ? sidebar.parentElement.getBoundingClientRect() : null;
        overlay = h("div", { class: "lumi-overlay", "data-lumicord": "1" });
        overlay.setAttribute("data-lumicord", "1");
        if (sb && host && sb.right < window.innerWidth - 200) Object.assign(overlay.style, { left: sb.right + "px", top: host.top + "px", width: (host.right - sb.right) + "px", height: host.height + "px" });
        else overlay.classList.add("lumi-full");
        overlay.append(h("button", { class: "lumi-close", title: "Close (Esc)", onClick: closeOverlay }, "✕"), pageContent(key));
        document.body.append(overlay);
    }

    // Fallback only: used when the native layout hook above did not run (e.g. Discord changed its settings code).
    function inject() {
        if (window.__lumicordLayoutHooked || document.querySelector("[data-lumicord-section]")) return;
        const found = findItem();
        if (!found) return;
        const { item, textEl, label } = found;
        const list = item.parentElement;
        const section = h("div", { "data-lumicord": "1" });
        section.setAttribute("data-lumicord-section", "1");
        section.setAttribute("data-lumicord", "1");
        // copy a nearby section header (short text, no icon) if there is one
        let header = list.previousElementSibling;
        if (header && !header.querySelector("svg") && header.textContent.trim().length < 30) {
            const hc = header.cloneNode(true);
            const walker = document.createTreeWalker(hc, NodeFilter.SHOW_TEXT);
            let t, first = true; while ((t = walker.nextNode())) { if (t.nodeValue.trim()) { t.nodeValue = first ? "Lumicord" : ""; first = false; } }
            section.append(hc);
        } else section.append(h("div", { class: "lumi-sidebar-header" }, "Lumicord"));
        const textPath = [];
        for (let n = textEl; n && n !== item; n = n.parentElement) textPath.unshift([...n.parentElement.childNodes].indexOf(n));
        const itemsBox = list.cloneNode(false);
        for (const key of visiblePages()) {
            const c = item.cloneNode(true);
            c.removeAttribute("id"); c.removeAttribute("aria-controls"); c.setAttribute("aria-selected", "false");
            c.className = String(c.className).split(" ").filter(x => !/selected|active/i.test(x)).join(" ");
            c.querySelectorAll("[id]").forEach(x => x.removeAttribute("id"));
            let t = c; for (const idx of textPath) t = t && t.childNodes[idx];
            if (t) t.textContent = PAGES[key].label;
            const old = c.querySelector("svg");
            if (old) { const ns = svg(PAGES[key].icon, old.getAttribute("width") || 20); ns.setAttribute("class", old.getAttribute("class") || ""); old.replaceWith(ns); }
            c.dataset.lumicordItem = key;
            c.classList.add("lumi-side-item");
            c.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); openPage(key, c); }, true);
            itemsBox.append(c);
        }
        section.append(itemsBox);
        // put our section right after the section that holds the anchor item
        const after = header && header.parentElement === list.parentElement ? list : list;
        after.after(section);
        // clicking a real Discord item closes our page
        list.parentElement.addEventListener("click", e => { if (!e.target.closest("[data-lumicord]")) closeOverlay(); }, true);
        log("added settings section next to", label);
    }

    // Fallback sidebar injection + closing the overlay when settings close. Discord mutates the DOM constantly, so
    // run at most once per frame, and stop entirely once the native settings hook is working (it never needs this).
    let scheduled = false;
    const sidebarObserver = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            const present = !!document.querySelector("[data-lumicord-section]");
            if (overlay && overlay.classList.contains("lumi-full") === false && !present) closeOverlay(); // settings closed
            if (window.__lumicordLayoutHooked && !overlay) { sidebarObserver.disconnect(); return; }
            if (!present) inject();
        });
    });
    sidebarObserver.observe(document.body, { childList: true, subtree: true });

    // Ctrl+Shift+L: open Lumicord anywhere (works even if Discord changes its settings layout).
    function openStandalone(key) {
        closeOverlay();
        activeKey = key || "plugins";
        overlay = h("div", { class: "lumi-overlay lumi-full" });
        overlay.setAttribute("data-lumicord", "1");
        const nav = h("div", { class: "lumi-nav" }, h("div", { class: "lumi-brand" }, svg("sparkle", 22), " Lumicord"));
        const main = h("div", { class: "lumi-main" });
        const show = k => {
            activeKey = k; main.textContent = ""; main.append(pageContent(k));
            [...nav.querySelectorAll(".lumi-nav-item")].forEach(b => b.classList.toggle("active", b.dataset.k === k));
        };
        for (const k of visiblePages()) { const b = h("button", { class: "lumi-nav-item", onClick: () => show(k) }, svg(PAGES[k].icon, 18), PAGES[k].label); b.dataset.k = k; nav.append(b); }
        overlay.append(h("button", { class: "lumi-close", title: "Close (Esc)", onClick: closeOverlay }, "✕"), h("div", { class: "lumi-shell" }, nav, main));
        document.body.append(overlay);
        show(activeKey);
    }
    document.addEventListener("keydown", e => {
        if (e.ctrlKey && e.shiftKey && e.code === "KeyL") { e.preventDefault(); overlay ? closeOverlay() : openStandalone(); }
        else if (e.key === "Escape" && overlay && !document.querySelector(".lumi-backdrop")) { e.stopPropagation(); closeOverlay(); }
    }, true);

    // ---------------------------------------------------------------- styles (Discord CSS variables, with fallbacks)
    addStyle("lumicord-ui", `
      .lumi-overlay{position:fixed;z-index:1000;background:var(--background-primary,var(--bg-base-primary,#313338));color:var(--text-normal,var(--text-default,#dbdee1));overflow:auto;font-family:var(--font-primary,"gg sans","Segoe UI",sans-serif)}
      .lumi-overlay.lumi-full{inset:0}
      .lumi-page{max-width:760px;padding:60px 40px 80px}
      .lumi-h1{font-size:20px;font-weight:600;margin:0 0 20px;color:var(--header-primary,var(--text-strong,#f2f3f5))}
      .lumi-close{position:absolute;top:56px;right:28px;width:36px;height:36px;border-radius:50%;border:2px solid var(--interactive-normal,#b5bac1);background:none;color:var(--interactive-normal,#b5bac1);font-size:16px;cursor:pointer}
      .lumi-close:hover{color:var(--interactive-hover,#fff);border-color:var(--interactive-hover,#fff)}
      .lumi-toolbar{display:flex;gap:10px;margin-bottom:16px}
      .lumi-input{background:var(--input-background,var(--background-tertiary,#1e1f22));color:inherit;border:1px solid var(--border-subtle,#0003);border-radius:8px;padding:9px 12px;font:inherit;font-size:14px;outline:none}
      .lumi-input:focus{border-color:var(--brand-500,#9b7bff)}
      .lumi-search{flex:1}
      .lumi-btn{display:inline-flex;align-items:center;gap:6px;background:var(--button-secondary-background,#4e5058);color:#fff;border:0;border-radius:8px;padding:8px 14px;font:inherit;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap}
      .lumi-btn:hover{filter:brightness(1.1)} .lumi-btn:disabled{opacity:.55;cursor:default;filter:none}
      .lumi-primary{background:linear-gradient(90deg,#9b7bff,#ff7ac8)} .lumi-danger{background:#da373c}
      .lumi-list{display:flex;flex-direction:column;gap:10px}
      .lumi-card{background:var(--background-secondary,var(--bg-base-secondary,#2b2d31));border:1px solid var(--border-subtle,#0002);border-radius:10px;padding:14px 16px}
      .lumi-card.lumi-broken{border-color:#da373c88}
      .lumi-card-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .lumi-card-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
      .lumi-name{font-weight:600;font-size:15px;color:var(--header-primary,var(--text-strong,#f2f3f5))}
      .lumi-ver{font-size:12px;opacity:.6}
      .lumi-author{font-size:12px;opacity:.7;margin-top:2px}
      .lumi-desc{font-size:14px;opacity:.85;margin-top:6px;line-height:1.35}
      .lumi-clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .lumi-warn{font-size:12px;margin-top:8px;color:#f0b232}
      .lumi-note{font-size:13px;opacity:.75;margin-bottom:14px}
      .lumi-empty{opacity:.7;padding:30px;text-align:center;grid-column:1/-1}
      .lumi-badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:2px 6px;border-radius:4px}
      .lumi-badge-bd{background:#3e82e533;color:#6ea8ff} .lumi-badge-vencord{background:#eb93c233;color:#f5a6d0} .lumi-badge-lumicord{background:#9b7bff33;color:#c2b0ff}
      .lumi-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
      .lumi-icon-btn{background:none;border:0;color:var(--interactive-normal,#b5bac1);cursor:pointer;padding:4px;border-radius:6px;display:flex}
      .lumi-icon-btn:hover{color:var(--interactive-hover,#fff);background:#ffffff14} .lumi-del:hover{color:#f23f43}
      .lumi-switch{width:40px;height:24px;border-radius:12px;border:0;background:#80848e;position:relative;cursor:pointer;transition:background .2s;flex-shrink:0}
      .lumi-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s}
      .lumi-switch.on{background:#9b7bff} .lumi-switch.on::after{transform:translateX(16px)}
      .lumi-tabs{display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid var(--border-subtle,#ffffff14)}
      .lumi-tab{background:none;border:0;border-bottom:2px solid transparent;color:var(--interactive-normal,#b5bac1);padding:8px 14px;font:inherit;font-size:15px;font-weight:500;cursor:pointer}
      .lumi-tab.active{color:var(--header-primary,#fff);border-bottom-color:#9b7bff}
      .lumi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
      .lumi-store-card{display:flex;flex-direction:column;padding:0;overflow:hidden}
      .lumi-store-card>*:not(.lumi-thumb){margin-left:14px;margin-right:14px}
      .lumi-thumb{height:110px;background:linear-gradient(135deg,#9b7bff55,#ff7ac855);display:flex;align-items:center;justify-content:center;color:#fff9;position:relative;margin-bottom:10px}
      .lumi-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
      .lumi-store-foot{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding:12px 0 14px}
      .lumi-stat{font-size:12px;opacity:.7}
      .lumi-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid #ffffff0f}
      .lumi-form .lumi-input{min-width:160px}
      .lumi-side-item.lumi-selected{background:var(--background-modifier-selected,#4e50588c);color:var(--interactive-active,#fff)}
      .lumi-sidebar-header{font-size:12px;font-weight:600;text-transform:none;padding:16px 10px 6px;color:var(--text-muted,#949ba4)}
      .lumi-shell{display:flex;min-height:100%}
      .lumi-nav{width:220px;flex-shrink:0;background:var(--background-secondary,#2b2d31);padding:60px 10px 20px;display:flex;flex-direction:column;gap:2px}
      .lumi-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:16px;padding:0 10px 14px;color:#ff7ac8}
      .lumi-nav-item{display:flex;align-items:center;gap:10px;background:none;border:0;color:var(--interactive-normal,#b5bac1);padding:9px 10px;border-radius:6px;font:inherit;font-size:15px;cursor:pointer;text-align:left}
      .lumi-nav-item:hover{background:#ffffff0d;color:var(--interactive-hover,#fff)} .lumi-nav-item.active{background:#ffffff17;color:#fff}
      .lumi-main{flex:1;min-width:0}
      .lumi-backdrop{position:fixed;inset:0;width:100vw;height:100vh;z-index:1002;background:#000a;display:flex;align-items:center;justify-content:center}
      .lumi-modal{background:var(--modal-background,var(--background-primary,#313338));color:var(--text-normal,#dbdee1);border-radius:12px;width:min(520px,92vw);max-height:85vh;display:flex;flex-direction:column;box-shadow:0 10px 40px #0008}
      .lumi-modal h2{margin:0;padding:18px 20px 8px;font-size:20px;color:var(--header-primary,#f2f3f5)}
      .lumi-modal-body{padding:4px 20px 16px;overflow:auto;font-size:14px;line-height:1.4}
      .lumi-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;background:var(--modal-footer-background,#2b2d31);border-radius:0 0 12px 12px}
      .lumi-toasts{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:1003;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
      .lumi-toast{background:#111214;color:#fff;padding:10px 16px;border-radius:8px;font-size:14px;box-shadow:0 4px 16px #0006;border-left:4px solid #9b7bff;animation:lumi-in .2s ease-out;transition:opacity .3s,transform .3s}
      .lumi-toast.lumi-success{border-left-color:#23a55a} .lumi-toast.lumi-error{border-left-color:#f23f43} .lumi-toast.lumi-warning{border-left-color:#f0b232}
      .lumi-toast.lumi-out{opacity:0;transform:translateY(8px)}
      @keyframes lumi-in{from{opacity:0;transform:translateY(8px)}}
    `);

    // ---------------------------------------------------------------- native settings section (used by __lumicordBuildLayout)
    // Node types Discord uses in its settings layout tree; read from Discord when possible, these are fallbacks.
    // Only accept Discord's numeric enum (ROOT=0, SECTION=1, SIDEBAR_ITEM=2, ...). Discord also has string-keyed
    // objects with the same property names; picking one of those makes Discord crash on an unknown node type.
    const layoutTypes = () => {
        const f = getModule(m => m.SECTION === 1 && m.SIDEBAR_ITEM === 2 && typeof m.PANEL === "number" && typeof m.CUSTOM === "number", { searchExports: true });
        const t = f ? { SECTION: f.SECTION, SIDEBAR_ITEM: f.SIDEBAR_ITEM, PANEL: f.PANEL, CATEGORY: typeof f.CATEGORY === "number" ? f.CATEGORY : 5, CUSTOM: f.CUSTOM }
            : { SECTION: 1, SIDEBAR_ITEM: 2, PANEL: 3, CATEGORY: 5, CUSTOM: 19 }; // values read from Discord's code
        rlog("layout types", JSON.stringify(t), f ? "(from Discord)" : "(fallback)");
        return t;
    };
    // Discord's real React: the module that has hooks, Component and a version string.
    const realReact = () => getModule(m => typeof m.useRef === "function" && typeof m.createElement === "function" && typeof m.Component === "function" && typeof m.version === "string");
    let Boundary;
    const boundary = R => Boundary || (Boundary = class LumicordBoundary extends R.Component {
        constructor(p) { super(p); this.state = { error: null }; }
        static getDerivedStateFromError(error) { return { error }; }
        componentDidCatch(error) { rlog("page crashed (contained)", error && error.stack); }
        render() { return this.state.error ? R.createElement("div", { style: { color: "#f23f43", padding: 16 } }, "Lumicord page error: " + this.state.error.message) : this.props.children; }
    });
    // Components are created once per page: a component type defined inside render would be new on every render,
    // so React would remount it and the page (tab, search, scroll) would reset whenever settings re-render.
    const pageComponents = {};
    const pageComponent = key => {
        if (pageComponents[key]) return pageComponents[key];
        function LumicordPageInner() {
            const R = realReact();
            const ref = R.useRef(null);
            R.useEffect(() => {
                const el = h("div", { class: "lumi-embedded" }, PAGES[key].render());
                ref.current.append(el);
                return () => el.remove();
            }, []);
            return R.createElement("div", { ref });
        }
        return (pageComponents[key] = function LumicordPage() {
            const R = realReact();
            return R.createElement(boundary(R), null, R.createElement(LumicordPageInner));
        });
    };
    window.__lumicordSection = () => {
        const T = layoutTypes(), R = realReact();
        rlog("building section with React", R && R.version);
        const entry = key => {
            const p = PAGES[key];
            const panel = {
                key: `lumicord_${key}_panel`, type: T.PANEL, useTitle: () => p.label,
                buildLayout: () => [{
                    key: `lumicord_${key}_category`, type: T.CATEGORY,
                    buildLayout: () => [{ key: `lumicord_${key}_custom`, type: T.CUSTOM, Component: pageComponent(key), useSearchTerms: () => [p.label, "Lumicord"] }],
                }],
            };
            return {
                key: `lumicord_${key}`, type: T.SIDEBAR_ITEM, useTitle: () => p.label,
                icon: () => R.createElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, dangerouslySetInnerHTML: { __html: ICONS[p.icon] } }),
                buildLayout: () => [panel],
            };
        };
        return { key: "lumicord_section", type: T.SECTION, useTitle: () => "Lumicord", buildLayout: () => visiblePages().map(entry) };
    };
    // With Vencord: its Settings plugin already rewrote Discord's settings code to call its own buildLayout.
    // Wrap that method so our section is added next to Vencord's.
    if (withVencord) {
        let tries = 0;
        const hookVencordSettings = setInterval(() => {
            const S = window.Vencord && window.Vencord.Plugins && window.Vencord.Plugins.plugins && window.Vencord.Plugins.plugins.Settings;
            if (S && typeof S.buildLayout === "function" && !S.__lumicordWrapped) {
                clearInterval(hookVencordSettings);
                const orig = S.buildLayout;
                S.buildLayout = function (builder) {
                    const layout = orig.call(this, builder);
                    return window.__lumicordBuildLayout({ key: builder && builder.key, buildLayout: () => layout });
                };
                S.__lumicordWrapped = true;
                rlog("hooked Vencord settings layout");
            } else if (++tries > 150) { clearInterval(hookVencordSettings); rlog("Vencord Settings plugin not found"); }
        }, 100);
    }

    addStyle("lumicord-embedded", `.lumi-embedded{color:var(--text-normal,var(--text-default,#dbdee1));font-family:var(--font-primary,"gg sans",sans-serif)}`);
    addStyle("lumicord-anim", `
      @keyframes lumi-rise{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
      @keyframes lumi-fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      @keyframes lumi-pop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
      @keyframes lumi-spin{to{transform:rotate(360deg)}}
      @keyframes lumi-shimmer{from{background-position:-400px 0}to{background-position:400px 0}}
      @keyframes lumi-check{0%{transform:scale(.8)}60%{transform:scale(1.08)}100%{transform:scale(1)}}
      .lumi-anim{animation:lumi-rise .38s cubic-bezier(.2,.8,.2,1) both}
      .lumi-fade{animation:lumi-fadein .28s ease-out both}
      .lumi-card{transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s,border-color .2s,background .2s}
      .lumi-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px #0005;border-color:#9b7bff55}
      .lumi-store-card .lumi-thumb img{transition:transform .4s cubic-bezier(.2,.8,.2,1)}
      .lumi-store-card:hover .lumi-thumb img{transform:scale(1.06)}
      .lumi-btn{transition:transform .12s,filter .15s,background-position .5s}
      .lumi-btn:active:not(:disabled){transform:scale(.95)}
      .lumi-primary{background:linear-gradient(90deg,#9b7bff,#ff7ac8,#9b7bff);background-size:200% 100%}
      .lumi-primary:hover:not(:disabled){background-position:100% 0}
      .lumi-loading::after{content:"";width:12px;height:12px;border:2px solid #fff6;border-top-color:#fff;border-radius:50%;animation:lumi-spin .7s linear infinite}
      .lumi-done{background:#23a55a!important;opacity:1!important;animation:lumi-check .35s ease-out}
      .lumi-switch{transition:background .25s}
      .lumi-switch::after{transition:transform .3s cubic-bezier(.5,1.7,.4,.8),width .15s}
      .lumi-switch:active::after{width:22px}
      .lumi-switch.on:active::after{transform:translateX(12px)}
      .lumi-icon-btn{transition:color .15s,background .15s,transform .2s}
      .lumi-icon-btn[title=Settings]:hover svg{transform:rotate(60deg);transition:transform .35s}
      .lumi-del:hover{transform:scale(1.1)}
      .lumi-skeleton{height:236px;border:0;background:linear-gradient(90deg,#ffffff08 25%,#ffffff14 50%,#ffffff08 75%);background-size:800px 100%;animation:lumi-shimmer 1.2s linear infinite}
      .lumi-backdrop{animation:lumi-fadein .18s ease-out}
      .lumi-modal{animation:lumi-pop .22s cubic-bezier(.2,.8,.2,1)}
      .lumi-input{transition:border-color .15s,box-shadow .15s}
      .lumi-input:focus{box-shadow:0 0 0 3px #9b7bff33}
      .lumi-seg{position:relative;display:inline-flex;gap:2px;padding:4px;margin-bottom:18px;border-radius:10px;background:var(--background-tertiary,var(--bg-base-tertiary,#1e1f22))}
      .lumi-seg button{position:relative;z-index:1;background:none;border:0;padding:8px 16px;border-radius:7px;font:inherit;font-size:14px;font-weight:600;color:var(--interactive-normal,#b5bac1);cursor:pointer;transition:color .2s}
      .lumi-seg button:hover{color:var(--interactive-hover,#fff)} .lumi-seg button.active{color:#fff}
      .lumi-seg-ink{position:absolute;top:4px;left:4px;bottom:4px;border-radius:7px;background:linear-gradient(90deg,#9b7bff,#ff7ac8);box-shadow:0 2px 10px #9b7bff55;transition:transform .35s cubic-bezier(.2,.8,.2,1),width .35s cubic-bezier(.2,.8,.2,1)}
      .lumi-tab{transition:color .2s,border-color .25s}
      .lumi-pagebar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px}
      .lumi-pagebar .lumi-seg{margin-bottom:0}
      .lumi-stats{display:flex;gap:8px}
      .lumi-chip{font-size:12px;padding:5px 10px;border-radius:999px;background:#ffffff0d;color:var(--text-muted,#b5bac1);border:1px solid #ffffff12}
      .lumi-chip b{color:var(--header-primary,#fff);margin-right:2px}
      .lumi-chip-on{background:#9b7bff1f;border-color:#9b7bff44} .lumi-chip-on b{color:#c8b6ff}
      .lumi-card{position:relative;overflow:hidden}
      .lumi-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;opacity:0;transition:opacity .25s;background:#9b7bff}
      .lumi-kind-bd::before{background:#5b8def} .lumi-kind-vencord::before{background:#eb93c2}
      .lumi-card:hover::before,.lumi-card.lumi-on::before{opacity:1}
      .lumi-card.lumi-on{background:linear-gradient(90deg,#9b7bff14,transparent 60%),var(--background-secondary,#2b2d31);border-color:#9b7bff40}
      .lumi-card.lumi-on .lumi-name{color:#fff}
      .lumi-restart-bar{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:1004;display:flex;align-items:center;gap:12px;padding:10px 12px 10px 14px;border-radius:14px;
        background:rgba(24,22,33,.82);backdrop-filter:blur(14px) saturate(1.4);border:1px solid #9b7bff55;box-shadow:0 12px 40px #0009,0 0 0 1px #ffffff08 inset;
        color:#ecebf5;font-size:14px;max-width:min(680px,92vw);animation:lumi-barin .45s cubic-bezier(.2,1.2,.3,1) both;transition:opacity .25s,transform .25s}
      .lumi-restart-bar.lumi-out{opacity:0;transform:translate(-50%,16px)}
      .lumi-rb-icon{width:30px;height:30px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;color:#fff;background:linear-gradient(135deg,#9b7bff,#ff7ac8);animation:lumi-spin 3s linear infinite}
      .lumi-rb-text{flex:1;line-height:1.3}
      .lumi-rb-later{background:#ffffff14}
      .lumi-rb-bump{animation:lumi-bump .4s ease}
      @keyframes lumi-barin{from{opacity:0;transform:translate(-50%,30px) scale(.95)}to{opacity:1;transform:translate(-50%,0)}}
      @keyframes lumi-bump{30%{transform:translate(-50%,-6px)}60%{transform:translate(-50%,2px)}}
      @media (prefers-reduced-motion:reduce){.lumi-restart-bar,.lumi-rb-icon{animation:none!important}}
      @media (prefers-reduced-motion:reduce){.lumi-anim,.lumi-fade,.lumi-modal,.lumi-backdrop,.lumi-skeleton{animation:none!important}.lumi-card,.lumi-seg-ink,.lumi-switch::after{transition:none!important}}
    `);

    // Dev loop (only when settings.json has "dev": true): reload when "devReload" changes, optionally open
    // settings and log what the sidebar shows, so changes can be tested without touching Discord by hand.
    if (settings.dev) {
        const startTag = settings.devReload;
        setInterval(() => { try { if (N.getSettings().devReload !== startTag) location.reload(); } catch { } }, 1000);
        if (settings.devOpenSettings) setTimeout(() => {
            const gear = document.querySelector('[aria-label="User Settings"]');
            rlog("dev: settings gear found:", !!gear);
            if (gear) gear.click();
            setTimeout(() => {
                const text = document.body.innerText;
                const i = text.indexOf("Billing");
                rlog("dev: sidebar has Lumicord:", text.includes("Marketplace"), "| near Billing:", JSON.stringify(text.slice(Math.max(0, i - 400), i + 100)));
            }, 3000);
        }, 6000);
    }

    // Flat, BetterDiscord-like look: Discord's own surfaces + ONE accent (blue) + grays. Loaded last, so it
    // overrides the earlier gradients, glows and colored badges.
    addStyle("lumicord-flat", `
      :root{--lumi-accent:#ec4899;--lumi-accent-hover:#f063a9}
      /* Vencord's settings pages use Discord's components, which read Discord's brand (blurple) variables.
         Re-point those variables to pink only inside Vencord's containers, so the rest of Discord is unchanged. */
      .vc-settings-tab,[class*="vc-settings-modal"],[class*="vc-plugins-"],[class*="vc-addon-"],.vc-settings-tab-bar{
        --brand-500:#ec4899;--brand-560:#db2777;--brand-600:#be185d;--brand-360:#f9a8d4;--brand-400:#f472b6;
        --brand-experiment:#ec4899;--brand-experiment-560:#db2777;--brand-experiment-600:#be185d;
        --control-brand-foreground:#ec4899;--control-brand-foreground-new:#ec4899;
        --button-filled-brand-background:#ec4899;--button-filled-brand-background-hover:#db2777;--button-filled-brand-background-active:#be185d;
        --button-filled-brand-border:#ec4899;--text-link:#f472b6;--text-brand:#f472b6;--focus-primary:#ec4899;
        --redesign-button-primary-background:#ec4899;--redesign-button-primary-hover-background:#db2777;--redesign-button-primary-pressed-background:#be185d}
      .lumi-primary,.lumi-primary:hover:not(:disabled){background:var(--lumi-accent)!important;background-size:auto!important;box-shadow:none}
      .lumi-primary:hover:not(:disabled){background:var(--lumi-accent-hover)!important}
      .lumi-done{background:var(--lumi-accent)!important}
      .lumi-btn{border-radius:4px}
      .lumi-input:focus{border-color:var(--lumi-accent);box-shadow:none}
      .lumi-switch.on{background:var(--lumi-accent)}
      /* tabs: flat, accent underline on the active one */
      .lumi-seg{background:none;padding:0;gap:22px;border-radius:0;border-bottom:1px solid var(--border-subtle,#ffffff14)}
      .lumi-seg button{padding:10px 0;border-radius:0;font-size:15px;font-weight:500;color:var(--interactive-normal,#b5bac1)}
      .lumi-seg button.active{color:var(--interactive-active,#fff)}
      .lumi-seg-ink{top:auto;bottom:-1px;left:0;height:2px;border-radius:2px;background:var(--lumi-accent);box-shadow:none}
      .lumi-pagebar{align-items:flex-end}
      .lumi-chip,.lumi-chip-on{background:none;border:0;padding:0 0 10px;font-size:13px;color:var(--text-muted,#949ba4)}
      .lumi-chip b,.lumi-chip-on b{color:var(--header-primary,#f2f3f5)}
      /* addon cards */
      .lumi-card{border-radius:8px;border:1px solid var(--border-subtle,#ffffff0f);padding:16px 16px 0}
      .lumi-card::before{display:none}
      .lumi-card:hover{transform:none;box-shadow:none;border-color:var(--border-strong,#ffffff24)}
      .lumi-card.lumi-on{background:var(--background-secondary,#2b2d31);border-color:var(--border-subtle,#ffffff0f)}
      .lumi-card.lumi-broken{border-color:#da373c80}
      .lumi-card-title{gap:6px;align-items:baseline}
      .lumi-name{font-size:16px}
      .lumi-ver,.lumi-author{font-size:13px;opacity:1;color:var(--text-muted,#949ba4);margin:0}
      .lumi-desc{margin:8px 0 14px;font-size:14px;opacity:1;color:var(--text-normal,#dbdee1)}
      .lumi-card-foot{display:flex;align-items:center;justify-content:space-between;margin:0 -16px;padding:8px 10px 8px 16px;
        border-top:1px solid var(--border-subtle,#ffffff0f);background:var(--background-secondary-alt,rgba(0,0,0,.12));border-radius:0 0 8px 8px}
      .lumi-source{font-size:12px;color:var(--text-muted,#949ba4)}
      .lumi-warn{color:var(--text-muted,#949ba4);margin:-6px 0 12px}
      .lumi-icon-btn{color:var(--interactive-normal,#b5bac1)} .lumi-icon-btn:hover{background:var(--background-modifier-hover,#ffffff10);color:var(--interactive-hover,#fff)}
      .lumi-icon-btn[title=Settings]:hover svg{transform:none}
      .lumi-del:hover{color:#da373c;transform:none}
      /* marketplace */
      .lumi-store-card{padding:0}
      .lumi-store-card:hover .lumi-thumb img{transform:none}
      .lumi-thumb{background:var(--background-tertiary,#1e1f22);color:var(--text-muted,#949ba4)}
      .lumi-note{color:var(--text-muted,#949ba4);opacity:1}
      .lumi-tab.active{border-bottom-color:var(--lumi-accent)}
      .lumi-skeleton{height:118px;background:linear-gradient(90deg,#ffffff06 25%,#ffffff0e 50%,#ffffff06 75%);background-size:800px 100%}
      .lumi-preview-img{display:block;max-width:100%;border-radius:6px}
      .lumi-market-thumb{display:block;width:100%;max-height:180px;object-fit:cover;margin:12px 0 0;border-radius:6px}
      .lumi-settings-panel{display:flex;flex-direction:column}
      .lumi-sp-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--border-subtle,#ffffff0f)}
      .lumi-sp-row.lumi-sp-block{flex-direction:column;align-items:stretch}
      .lumi-sp-text{min-width:0} .lumi-sp-text .lumi-desc{margin:4px 0 0}
      .lumi-sp-row .lumi-input{min-width:180px}
      .lumi-sp-slide{display:flex;align-items:center;gap:10px}
      .lumi-sp-slider{flex:1;accent-color:var(--lumi-accent)}
      .lumi-sp-val{min-width:42px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text-muted,#949ba4)}
      .lumi-sp-radio{display:flex;flex-direction:column;gap:6px} .lumi-sp-radio input{accent-color:var(--lumi-accent)}
      .lumi-sp-cat{display:block;width:100%;text-align:left;background:none;border:0;padding:12px 0;font:inherit;font-weight:600;color:var(--header-primary,#f2f3f5);cursor:pointer;border-bottom:1px solid var(--border-subtle,#ffffff0f)}
      .lumi-sp-cat::before{content:"▸ ";color:var(--text-muted,#949ba4)} .lumi-sp-cat.open::before{content:"▾ "}
      .lumi-sp-cat:not(.open)+.lumi-sp-cat-body{display:none} .lumi-sp-cat-body{padding-left:12px}
      .lumi-notice{bottom:84px}
      .lumi-notes{white-space:pre-wrap;font-size:13px;color:var(--text-muted,#949ba4);margin:-6px 0 14px;max-height:260px;overflow:auto}
      .lumi-notes:empty{display:none}
      .lumi-update-card{position:fixed;right:22px;bottom:22px;z-index:1005;width:340px;max-width:calc(100vw - 44px);
        background:var(--background-floating,#111214);color:var(--text-normal,#dbdee1);border:1px solid var(--border-subtle,#ffffff14);
        border-top:3px solid var(--lumi-accent);border-radius:10px;box-shadow:0 12px 36px #000a;padding:14px 14px 12px;
        font-family:var(--font-primary,"gg sans",sans-serif);animation:lumi-ucin .35s cubic-bezier(.2,1.1,.3,1) both;transition:opacity .2s,transform .2s}
      .lumi-update-card.lumi-out{opacity:0;transform:translateY(12px)}
      @keyframes lumi-ucin{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}
      .lumi-uc-head{display:flex;align-items:center;gap:10px}
      .lumi-uc-icon{width:34px;height:34px;flex-shrink:0;border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--lumi-accent);color:#fff}
      .lumi-uc-title{font-weight:600;font-size:15px;color:var(--header-primary,#f2f3f5)}
      .lumi-uc-ver{font-size:13px;color:var(--text-muted,#949ba4);display:flex;gap:6px;align-items:center}
      .lumi-uc-ver b{color:var(--lumi-accent)}
      .lumi-uc-arrow{opacity:.7}
      .lumi-uc-x{margin-left:auto;align-self:flex-start;background:none;border:0;color:var(--interactive-normal,#b5bac1);cursor:pointer;font-size:13px;padding:2px 4px;border-radius:4px}
      .lumi-uc-x:hover{color:var(--interactive-hover,#fff);background:var(--background-modifier-hover,#ffffff10)}
      .lumi-uc-notes{margin:12px 0 0;padding:10px;max-height:150px;overflow:auto;white-space:pre-wrap;font-size:13px;line-height:1.4;
        background:var(--background-secondary,#2b2d31);border-radius:6px;color:var(--text-normal,#dbdee1)}
      .lumi-uc-status{font-size:12px;color:var(--text-muted,#949ba4);margin-top:8px;min-height:0}
      .lumi-uc-status:empty{display:none}
      .lumi-uc-done .lumi-uc-status{color:var(--lumi-accent)} .lumi-uc-error .lumi-uc-status{color:#f23f43}
      .lumi-uc-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
      /* thin pink scrollbars everywhere Lumicord scrolls (update card, notes, pop-ups, pages), like the installer */
      .lumi-uc-notes,.lumi-notes,.lumi-modal-body,.lumi-overlay,.lumi-main,.lumi-settings-panel{scrollbar-width:thin;scrollbar-color:#ec4899aa transparent}
      .lumi-uc-notes::-webkit-scrollbar,.lumi-notes::-webkit-scrollbar,.lumi-modal-body::-webkit-scrollbar,.lumi-overlay::-webkit-scrollbar,.lumi-main::-webkit-scrollbar{width:6px;height:6px}
      .lumi-uc-notes::-webkit-scrollbar-track,.lumi-notes::-webkit-scrollbar-track,.lumi-modal-body::-webkit-scrollbar-track,.lumi-overlay::-webkit-scrollbar-track,.lumi-main::-webkit-scrollbar-track{background:#ffffff0e;border-radius:3px}
      .lumi-uc-notes::-webkit-scrollbar-thumb,.lumi-notes::-webkit-scrollbar-thumb,.lumi-modal-body::-webkit-scrollbar-thumb,.lumi-overlay::-webkit-scrollbar-thumb,.lumi-main::-webkit-scrollbar-thumb{background:#ec489999;border-radius:3px}
      .lumi-uc-notes::-webkit-scrollbar-thumb:hover,.lumi-notes::-webkit-scrollbar-thumb:hover,.lumi-modal-body::-webkit-scrollbar-thumb:hover,.lumi-overlay::-webkit-scrollbar-thumb:hover,.lumi-main::-webkit-scrollbar-thumb:hover{background:#ec4899}
      .lumi-uc-notes::-webkit-scrollbar-button,.lumi-notes::-webkit-scrollbar-button,.lumi-modal-body::-webkit-scrollbar-button,.lumi-overlay::-webkit-scrollbar-button,.lumi-main::-webkit-scrollbar-button{display:none}
      /* restart bar + toasts + modals */
      .lumi-restart-bar{background:var(--background-floating,#111214);backdrop-filter:none;border:1px solid var(--border-subtle,#ffffff14);box-shadow:0 8px 24px #0008;border-radius:8px}
      .lumi-rb-icon{background:var(--lumi-accent);animation:none}
      .lumi-toast{border-left-color:var(--lumi-accent)} .lumi-toast.lumi-success{border-left-color:var(--lumi-accent)}
      .lumi-brand{color:var(--header-primary,#f2f3f5)}
      .lumi-nav-item.active{background:var(--background-modifier-selected,#4e50588c)}
    `);

    addStyle("lumicord-settings", `
      @keyframes lumi-set-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
      .lumi-set-card{margin-bottom:16px;padding:18px 20px 6px!important;animation:lumi-set-in .4s cubic-bezier(.2,.8,.2,1) both;
        border:1px solid var(--border-subtle,#ffffff12)!important;transform:none!important}
      .lumi-set-title{font-size:16px;font-weight:600;color:var(--header-primary,#fff);margin:0 0 6px;padding-bottom:10px;border-bottom:1px solid var(--border-subtle,#ffffff12)}
      .lumi-set-card .lumi-row{padding:12px 8px;margin:0 -8px;border-radius:8px;transition:background .18s}
      .lumi-set-card .lumi-row:hover{background:#ffffff08}
      .lumi-set-card .lumi-row:last-child{border-bottom:0}
      .lumi-set-card .lumi-desc{margin:3px 0 0;font-size:13px;color:var(--text-muted,#949ba4)}
      .lumi-swatches{display:flex;gap:8px;align-items:center;flex-shrink:0}
      .lumi-swatch{position:relative;width:24px;height:24px;border-radius:50%!important;border:0;cursor:pointer;padding:0;
        box-shadow:inset 0 0 0 1px #0003;transition:transform .2s cubic-bezier(.3,1.6,.5,1),box-shadow .2s}
      .lumi-swatch:hover{transform:scale(1.18)}
      .lumi-swatch.on{box-shadow:0 0 0 2px var(--background-secondary,#2b2d31),0 0 0 4px currentColor;color:#fff;transform:scale(1.05)}
      .lumi-swatch.on::after{content:"";position:absolute;inset:7px;border-radius:50%;background:#fff;animation:lumi-pop .25s both}
      .lumi-swatch-custom{display:grid;place-items:center;overflow:hidden;background:conic-gradient(#f23f43,#f0b232,#23a55a,#00a8fc,#9b7bff,#ec4899,#f23f43)}
      .lumi-swatch-solid{width:32px;height:32px}
      .lumi-color{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
      .lumi-set-slider{display:flex;gap:12px;align-items:center;width:240px;flex-shrink:0}
      .lumi-set-slider .lumi-sp-val{min-width:44px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:var(--header-primary,#fff)}
      .lumi-link{color:var(--lumi-accent);text-decoration:none;font-weight:500;cursor:pointer}.lumi-link:hover{text-decoration:underline}
      .lumi-about-links{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:10px 0 14px;font-size:14px;color:var(--text-muted,#949ba4)}
      .lumi-about-sep{opacity:.6}
      .lumi-about-head{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#949ba4);margin:22px 0 10px}
      .lumi-about-note{margin:6px 2px 0!important;font-size:13px}
      .lumi-tip{position:fixed;z-index:10001;pointer-events:none;padding:6px 10px;border-radius:6px;background:var(--background-floating,#111214);
        color:var(--text-normal,#dbdee1);font-size:13px;font-weight:500;box-shadow:0 6px 18px #0008;border:1px solid var(--border-subtle,#ffffff14);animation:lumi-pop .12s ease-out both}
      .lumi-embedded ::-webkit-scrollbar,.lumi-overlay ::-webkit-scrollbar,.lumi-modal ::-webkit-scrollbar,.lumi-dd-menu::-webkit-scrollbar{width:8px;height:8px}
      .lumi-embedded ::-webkit-scrollbar-thumb,.lumi-overlay ::-webkit-scrollbar-thumb,.lumi-modal ::-webkit-scrollbar-thumb{background:#ffffff26;border-radius:4px}
      .lumi-embedded ::-webkit-scrollbar-track,.lumi-overlay ::-webkit-scrollbar-track,.lumi-modal ::-webkit-scrollbar-track{background:transparent}
      .lumi-dd-menu{max-height:min(320px,60vh);overflow:auto}
      .lumi-dd-item:focus-visible{outline:none;background:#ffffff14;color:#fff}
      input.lumi-input[type=number]::-webkit-inner-spin-button,input.lumi-input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
      .lumi-sp-radio input[type=radio]{-webkit-appearance:none;appearance:none;width:18px;height:18px;margin:0 6px 0 0;vertical-align:-4px;border-radius:50%;
        border:2px solid var(--interactive-normal,#b5bac1);cursor:pointer;transition:border-color .15s,box-shadow .15s}
      .lumi-sp-radio input[type=radio]:checked{border-color:var(--lumi-accent);box-shadow:inset 0 0 0 3px var(--background-secondary,#2b2d31),inset 0 0 0 9px var(--lumi-accent)}
      .lumi-sp-slider{-webkit-appearance:none;appearance:none;height:6px;border-radius:3px;cursor:pointer;
        background:linear-gradient(90deg,var(--lumi-accent) var(--fill,50%),#ffffff1f var(--fill,50%))}
      .lumi-sp-slider::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 2px 6px #0006;transition:transform .15s}
      .lumi-sp-slider:hover::-webkit-slider-thumb{transform:scale(1.15)}
      .lumi-set-card input[type=range]{-webkit-appearance:none;appearance:none;flex:1;height:6px;border-radius:3px;cursor:pointer;
        background:linear-gradient(90deg,var(--lumi-accent) var(--fill,50%),#ffffff1f var(--fill,50%))}
      .lumi-set-card input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;
        box-shadow:0 0 0 4px color-mix(in srgb,var(--lumi-accent) 30%,transparent),0 2px 6px #0006;transition:transform .15s,box-shadow .2s}
      .lumi-set-card input[type=range]:hover::-webkit-slider-thumb{transform:scale(1.15);box-shadow:0 0 0 7px color-mix(in srgb,var(--lumi-accent) 25%,transparent),0 2px 6px #0006}
      .lumi-dd{text-align:left;min-width:150px;padding-right:34px;cursor:pointer;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='%23b5bac1' stroke-width='3' d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
        background-repeat:no-repeat;background-position:right 12px center;transition:border-color .15s,box-shadow .15s}
      .lumi-dd:hover{border-color:#ffffff30}
      .lumi-dd-menu{position:fixed;z-index:10000;padding:6px;border-radius:8px;background:var(--background-floating,#111214);
        border:1px solid var(--border-subtle,#ffffff14);box-shadow:0 10px 30px #0008;animation:lumi-pop .14s ease-out both;display:flex;flex-direction:column;gap:2px}
      .lumi-dd-item{background:none;border:0;border-radius:5px;padding:8px 10px;text-align:left;font:inherit;font-size:14px;cursor:pointer;
        color:var(--interactive-normal,#b5bac1);transition:background .12s,color .12s}
      .lumi-dd-item:hover{background:#ffffff0d;color:var(--interactive-hover,#fff)}
      .lumi-dd-item.on{background:var(--lumi-accent);color:#fff}
      .lumi-set-card .lumi-input:focus{border-color:var(--lumi-accent)!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--lumi-accent) 25%,transparent)!important}
      .lumi-css{width:100%;min-height:170px;margin:10px 0 14px;font-family:Consolas,"Cascadia Code",monospace;font-size:13px;line-height:1.55;
        resize:vertical;box-sizing:border-box;tab-size:2;transition:border-color .15s,box-shadow .15s}
      .lumi-swatch-custom:not([style*=background]){background:conic-gradient(#f23f43,#f0b232,#23a55a,#00a8fc,#9b7bff,#ec4899,#f23f43)}
      .lumi-cp{position:fixed;z-index:10000;width:240px;padding:12px;border-radius:10px;background:var(--background-floating,#111214);
        border:1px solid var(--border-subtle,#ffffff14);box-shadow:0 10px 30px #0008;animation:lumi-pop .16s ease-out both;display:flex;flex-direction:column;gap:10px}
      .lumi-cp-area{position:relative;height:140px;border-radius:8px;cursor:crosshair;touch-action:none}
      .lumi-cp-knob{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px #000a;pointer-events:none}
      .lumi-cp-row{display:flex;gap:10px;align-items:center}
      .lumi-cp-preview{width:28px;height:28px;border-radius:50%;flex-shrink:0;box-shadow:inset 0 0 0 1px #0004}
      .lumi-cp-hue{-webkit-appearance:none;appearance:none;flex:1;height:10px;border-radius:5px;cursor:pointer;
        background:linear-gradient(90deg,red,#ff0,lime,cyan,blue,#f0f,red)}
      .lumi-cp-hue::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#fff;border:0;box-shadow:0 1px 4px #000a}
      .lumi-cp-hex{width:86px;min-width:0!important;padding:6px 8px!important;font-family:Consolas,monospace;text-transform:uppercase}
      .lumi-cp-presets{display:flex;gap:4px;flex-wrap:wrap}
      .lumi-cp-preset{width:16px;height:16px;border-radius:50%;border:0;padding:0;cursor:pointer;transition:transform .15s}.lumi-cp-preset:hover{transform:scale(1.2)}`);
    applyCustom();

    // Native title tooltips are drawn by Windows; show our own for Lumicord's UI instead.
    let tip;
    document.addEventListener("mouseover", e => {
        const el = e.target.closest && e.target.closest(".lumi-embedded [title],.lumi-overlay [title],.lumi-modal [title],.lumi-uc [title],[data-lumi-tip]");
        if (!el) return;
        if (el.title) { el.dataset.lumiTip = el.title; el.removeAttribute("title"); if (!el.ariaLabel) el.ariaLabel = el.dataset.lumiTip; }
        if (tip) tip.remove();
        tip = h("div", { class: "lumi-tip" }, el.dataset.lumiTip);
        document.body.append(tip);
        const r = el.getBoundingClientRect(), w = tip.offsetWidth;
        Object.assign(tip.style, { left: Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + "px", top: (r.top - tip.offsetHeight - 8 < 0 ? r.bottom + 8 : r.top - tip.offsetHeight - 8) + "px" });
        el.addEventListener("mouseleave", () => { if (tip) { tip.remove(); tip = null; } }, { once: true });
    });

    addStyle("lumicord-market", `
      .lumi-checking{display:flex;align-items:center;gap:12px;font-size:15px;padding:6px 0}
      .lumi-spinner{width:22px;height:22px;border-radius:50%;border:3px solid #ffffff26;border-top-color:var(--lumi-accent);animation:lumi-spin .8s linear infinite;flex-shrink:0}
      .lumi-mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
      .lumi-mcard{display:flex;flex-direction:column;min-height:250px;border-radius:8px;overflow:hidden;background:var(--background-secondary,#2b2d31);
        border:1px solid var(--border-subtle,#ffffff12);transition:transform .18s,border-color .18s,box-shadow .18s}
      .lumi-mcard:hover{transform:translateY(-2px);border-color:#ffffff26;box-shadow:0 6px 18px #0005}
      .lumi-mcard.lumi-skeleton{min-height:250px}
      .lumi-mthumb{aspect-ratio:16/9;background:var(--background-tertiary,#1e1f22);overflow:hidden;cursor:zoom-in;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--text-muted,#949ba4)}
      .lumi-mthumb img{width:100%;height:100%;object-fit:cover;display:block}
      .lumi-mthumb-none{cursor:default}
      .lumi-mbody{padding:10px 12px 0;flex:1;min-width:0}
      .lumi-mname{font-weight:600;font-size:15px;color:var(--header-primary,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .lumi-mname .lumi-ver{font-weight:400;font-size:12px;color:var(--text-muted,#949ba4)}
      .lumi-mauthor{font-size:12px;color:var(--text-muted,#949ba4);margin-top:1px}
      .lumi-mdesc{font-size:13px;line-height:1.35;color:var(--text-normal,#dbdee1);margin-top:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .lumi-mfoot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px}
      .lumi-mstats{display:flex;align-items:center;gap:3px;font-size:12px;color:var(--text-muted,#949ba4);white-space:nowrap;overflow:hidden}
      .lumi-mheart{margin-left:6px}
      .lumi-mfoot .lumi-btn{padding:5px 12px;font-size:13px;flex-shrink:0}`);

    window.Lumicord = { addons, settings, BdApi, Webpack, Patcher, open: openStandalone, setEnabled, loadPlugin, loadTheme };
    log("loaded", addons.plugin.length, "plugins,", addons.theme.length, "themes");
    }
})();
