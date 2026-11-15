// node test.js — checks the installer on a fake Discord folder.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const { findResources, install, uninstall } = require("./install");

// Local-access management lists and forgets remembered choices without granting access.
{
    const patcher = fs.readFileSync(path.join(__dirname, "src", "patcher.js"), "utf8");
    const start = patcher.indexOf("const accessFile = path.join(__dirname, \"..\", \"local-access.json\");");
    const end = patcher.indexOf("// Discord's page Content-Security-Policy", start);
    const handlers = {};
    const writes = [];
    vm.runInNewContext(`(() => {${patcher.slice(start, end)}; })()`, {
        __dirname: "root/src", path: { join: (...parts) => parts.join("/") },
        fs: { readFileSync: () => '{"router":true,"nas":false,"__proto__":true,"constructor":false}', writeFileSync: (_file, value) => writes.push(JSON.parse(value)) },
        electron: { ipcMain: { handle: (name, fn) => { handlers[name] = fn; } } }, log: () => { }, Map,
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(handlers.LUMICORD_LOCAL_ACCESS_LIST())), JSON.parse('{"router":true,"nas":false,"__proto__":true,"constructor":false}'));
    assert.strictEqual(handlers.LUMICORD_LOCAL_ACCESS_FORGET(null, "router"), true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(handlers.LUMICORD_LOCAL_ACCESS_LIST())), JSON.parse('{"nas":false,"__proto__":true,"constructor":false}'));
    assert.strictEqual(handlers.LUMICORD_LOCAL_ACCESS_FORGET(null, "__proto__"), true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(handlers.LUMICORD_LOCAL_ACCESS_LIST())), { nas: false, constructor: false });
    assert.strictEqual(handlers.LUMICORD_LOCAL_ACCESS_FORGET(null, "*"), true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(handlers.LUMICORD_LOCAL_ACCESS_LIST())), {});
    assert.deepStrictEqual(writes, [JSON.parse('{"nas":false,"__proto__":true,"constructor":false}'), { nas: false, constructor: false }, {}]);
    console.log("local access management test passed");
}

// Failed local-access writes must not leave a changed in-memory permission behind.
{
    const patcher = fs.readFileSync(path.join(__dirname, "src", "patcher.js"), "utf8");
    const start = patcher.indexOf("const accessFile = path.join(__dirname, \"..\", \"local-access.json\");");
    const end = patcher.indexOf("// Discord's page Content-Security-Policy", start);
    const handlers = {};
    vm.runInNewContext(`(() => {${patcher.slice(start, end)}; })()`, {
        __dirname: "root/src", path: { join: (...parts) => parts.join("/") },
        fs: { readFileSync: () => '{"router":true}', writeFileSync: () => { throw new Error("disk full"); } },
        electron: { ipcMain: { handle: (name, fn) => { handlers[name] = fn; } } }, log: () => { }, Map,
    });
    assert.strictEqual(handlers.LUMICORD_LOCAL_ACCESS_FORGET(null, "router"), false);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(handlers.LUMICORD_LOCAL_ACCESS_LIST())), { router: true });
    console.log("local access write failure test passed");
}

// Allow-all needs the native confirmation, and an explicit Deny still wins.
{
    const patcher = fs.readFileSync(path.join(__dirname, "src", "patcher.js"), "utf8");
    const start = patcher.indexOf("const accessFile = path.join(__dirname, \"..\", \"local-access.json\");");
    const end = patcher.indexOf("// Discord's page Content-Security-Policy", start);
    const handlers = {};
    let dialogResponse = 0;
    vm.runInNewContext(`(() => {${patcher.slice(start, end)}; })()`, {
        __dirname: "root/src", path: { join: (...parts) => parts.join("/") },
        fs: { readFileSync: () => '{"nas2":false}', writeFileSync: () => { } },
        electron: { ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, BrowserWindow: { fromWebContents: () => ({}) }, dialog: { showMessageBox: () => Promise.resolve({ response: dialogResponse, checkboxChecked: true }) } }, log: () => { }, Map,
    });
    handlers.LUMICORD_LOCAL_ACCESS_ALLOW_ALL({ sender: {} }, true).then(ok => {
        assert.strictEqual(ok, true, "allow-all only enables after native confirmation");
        assert.strictEqual(handlers.LUMICORD_LOCAL_ACCESS_STATE().allowAll, true);
        return Promise.all([
            handlers.LUMICORD_LOCAL_ACCESS({ sender: {} }, "nas2", "test"),
            handlers.LUMICORD_LOCAL_ACCESS({ sender: {} }, "newhost", "test"),
        ]);
    }).then(([denied, allowed]) => {
        assert.strictEqual(denied, false, "explicit deny wins over allow-all");
        assert.strictEqual(allowed, true);
        return handlers.LUMICORD_LOCAL_ACCESS_ALLOW_ALL({ sender: {} }, false);
    }).then(() => {
        assert.strictEqual(handlers.LUMICORD_LOCAL_ACCESS_STATE().allowAll, false, "allow-all can be disabled without confirmation");
        dialogResponse = 1;
        return handlers.LUMICORD_LOCAL_ACCESS_ALLOW_ALL({ sender: {} }, true);
    }).then(ok => {
        assert.strictEqual(ok, false, "cancelling the native warning does not enable allow-all");
        assert.strictEqual(handlers.LUMICORD_LOCAL_ACCESS_STATE().allowAll, false);
        assert.strictEqual(handlers.LUMICORD_LOCAL_ACCESS_FORGET(null, "*"), true);
        assert.deepStrictEqual(JSON.parse(JSON.stringify(handlers.LUMICORD_LOCAL_ACCESS_LIST())), {});
        console.log("local access allow-all test passed");
    }).catch(e => { process.exitCode = 1; throw e; });
}

// Import accepts only recognized custom settings with valid values.
{
    const renderer = fs.readFileSync(path.join(__dirname, "src", "renderer.js"), "utf8");
    const start = renderer.indexOf("    const DEFAULT_CUSTOM = ");
    const end = renderer.indexOf("    function applyCustom()", start);
    const normalizeCustom = vm.runInNewContext(`(() => {${renderer.slice(start, end)}return normalizeCustom; })()`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(normalizeCustom({ accent: "#123456", updateInterval: 24, unknown: true }))), { accent: "#123456", updateInterval: 24 });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(normalizeCustom({ accent: "red", toastDuration: "fast", pageWidth: "huge" }))), {});
    console.log("custom settings import validation test passed");
}

// Run the renderer's actual Patcher in isolation: out-of-order unpatching must not revive a stopped plugin.
{
    const renderer = fs.readFileSync(path.join(__dirname, "src", "renderer.js"), "utf8");
    const start = renderer.indexOf("    const patchMap = new Map();");
    const end = renderer.indexOf("    // ---------------------------------------------------------------- plugin data", start);
    const Patcher = vm.runInNewContext(`(() => { const log = () => {};${renderer.slice(start, end)}return Patcher; })()`);
    const target = { method: n => n };
    Patcher.after("first", target, "method", (_this, _args, ret) => ret + 1);
    Patcher.after("second", target, "method", (_this, _args, ret) => ret * 2);
    assert.strictEqual(target.method(1), 4);
    Patcher.unpatchAll("first");
    assert.strictEqual(target.method(1), 2, "stopping an inner patch removes it even while a later patch remains");
    Patcher.unpatchAll("second");
    assert.strictEqual(target.method(1), 1);
    assert.strictEqual(Patcher.before("bad", {}, "missing", () => { }), null);
    console.log("patcher test passed");
}

// The same ContextMenu callback can be registered more than once; unpatch must remove every registration.
{
    const renderer = fs.readFileSync(path.join(__dirname, "src", "renderer.js"), "utf8");
    const start = renderer.indexOf("    function contextMenuApi() {");
    const end = renderer.indexOf("\n    // ---------------------------------------------------------------- BdApi.UI.buildSettingsPanel", start);
    const added = [], removed = [];
    const context = {
        log: () => { }, Webpack: { React: () => ({ createElement: () => ({}) }) },
        window: { Vencord: { Api: { ContextMenu: {
            addContextMenuPatch: (nav, fn) => added.push([nav, fn]),
            removeContextMenuPatch: (nav, fn) => removed.push([nav, fn]),
        } }, Webpack: { Common: { Menu: { MenuItem: "item", MenuGroup: "group", MenuSeparator: "separator" } } } } },
    };
    const ContextMenu = vm.runInNewContext(`(() => {${renderer.slice(start, end)}return contextMenuApi; })()`, context)();
    const callback = () => { };
    ContextMenu.patch("test", callback);
    ContextMenu.patch("test", callback);
    ContextMenu.unpatch("test", callback);
    assert.strictEqual(added.length, 2);
    assert.deepStrictEqual(removed, added, "unpatch removes all duplicate callback registrations");
    assert.strictEqual(ContextMenu.Item, "item");
    assert.strictEqual(ContextMenu.Group, "group");
    assert.strictEqual(ContextMenu.Separator, "separator");
    console.log("context menu test passed");
}

// SvelteKit encodes optional catalog fields as -1; the marketplace decoder must restore undefined, not -1.
{
    const preload = fs.readFileSync(path.join(__dirname, "src", "preload.js"), "utf8");
    const start = preload.indexOf("function decodeSvelte(json) {");
    const end = preload.indexOf("\n// File access", start);
    const decodeSvelte = vm.runInNewContext(`(() => {${preload.slice(start, end)}return decodeSvelte; })()`);
    const addons = decodeSvelte({ nodes: [{ data: [{ addons: 1 }, [2], { name: 3, thumbnailId: -1 }, "Optional field"] }] });
    assert.strictEqual(addons[0].thumbnailId, undefined);
    console.log("store decode test passed");
}

// searchExports must inspect properties attached to a function export, as BetterDiscord does.
{
    const renderer = fs.readFileSync(path.join(__dirname, "src", "renderer.js"), "utf8");
    const start = renderer.indexOf("    const getModule = (filter, opts) => {");
    const end = renderer.indexOf("    Webpack.getByProps = Webpack.getByKeys;", start);
    const exported = Object.assign(() => { }, { target: { found: true } });
    const getModule = vm.runInNewContext(`(() => {${renderer.slice(start, end)}return getModule; })()`, {
        getWreq: () => ({ c: { one: { exports: exported } } }), Filters: {}, window: {},
    });
    assert.strictEqual(getModule(x => x && x.found, { searchExports: true }), exported.target);
    console.log("webpack export search test passed");
}

// A plugin that throws in stop() must still have every Patcher hook removed.
{
    const renderer = fs.readFileSync(path.join(__dirname, "src", "renderer.js"), "utf8");
    const start = renderer.indexOf("    function setEnabled(a, on) {");
    const end = renderer.indexOf("    const api = {", start);
    const calls = [];
    const setEnabled = vm.runInNewContext(`(() => {${renderer.slice(start, end)}return setEnabled; })()`, {
        toast: () => { }, console: { error: () => { } }, Patcher: { unpatchAll: name => calls.push(name) },
        settings: { plugins: {}, themes: {} }, save: () => { }, setThemeStyle: () => { }, api: {},
    });
    const addon = { type: "plugin", kind: "bd", name: "ThrowsOnStop", file: "throws.plugin.js", enabled: true, instance: { stop: () => { throw new Error("stop failed"); } } };
    setEnabled(addon, false);
    assert.deepStrictEqual(calls, ["ThrowsOnStop"]);
    assert.strictEqual(addon.enabled, false);
    console.log("plugin stop cleanup test passed");
}

// parseHTML follows BetterDiscord's single-node, node-list, and explicit-fragment return shapes.
{
    const renderer = fs.readFileSync(path.join(__dirname, "src", "renderer.js"), "utf8");
    const match = /parseHTML: \(html, fragment = false\) => \{([\s\S]*?)\n            \},/.exec(renderer);
    assert.ok(match, "parseHTML implementation found");
    const parseHTML = vm.runInNewContext(`(html, fragment = false) => {${match[1]}\n}` , {
        document: { createElement: () => {
            const content = { childNodes: [], marker: "fragment" };
            return { content, set innerHTML(html) { content.childNodes = html === "one" ? ["one-node"] : ["first", "second"]; content.firstChild = content.childNodes[0]; } };
        } },
    });
    assert.strictEqual(parseHTML("one"), "one-node");
    assert.deepStrictEqual(parseHTML("many"), ["first", "second"]);
    assert.strictEqual(parseHTML("many", true).marker, "fragment");
    console.log("parse HTML test passed");
}

const d = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-"));
for (const v of ["app-1.0.9", "app-1.0.10"]) fs.mkdirSync(path.join(d, v, "resources"), { recursive: true });
const res = findResources(d);
assert.ok(res.includes("app-1.0.10"), "picks newest version numerically");

fs.writeFileSync(path.join(res, "app.asar"), "stock");
install(res, "C:\\x\\patcher.js");
install(res, "C:\\x\\patcher.js"); // re-run must not break
assert.ok(fs.existsSync(path.join(res, "_app.asar")) && !fs.existsSync(path.join(res, "app.asar")));
assert.match(fs.readFileSync(path.join(res, "app", "index.js"), "utf8"), /C:\\\\x\\\\patcher\.js/);

uninstall(res);
assert.strictEqual(fs.readFileSync(path.join(res, "app.asar"), "utf8"), "stock");
assert.ok(!fs.existsSync(path.join(res, "app")));
fs.rmSync(d, { recursive: true });
console.log("all tests passed");

// Discord updated while Lumicord was installed: uninstall must keep the newer app.asar, not roll it back.
{
    const d4 = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-"));
    const r4 = path.join(d4, "app-1.0.1", "resources"); fs.mkdirSync(r4, { recursive: true });
    fs.writeFileSync(path.join(r4, "_app.asar"), "old"); fs.writeFileSync(path.join(r4, "app.asar"), "new");
    fs.mkdirSync(path.join(r4, "app"));
    uninstall(r4);
    assert.strictEqual(fs.readFileSync(path.join(r4, "app.asar"), "utf8"), "new", "uninstall keeps Discord's newer archive");
    assert.ok(!fs.existsSync(path.join(r4, "_app.asar")) && !fs.existsSync(path.join(r4, "app")));
    fs.rmSync(d4, { recursive: true });
    console.log("uninstall update test passed");
}

// Discord replaced app.asar while Lumicord was installed: Repair must use the new archive.
{
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-"));
    const r2 = path.join(d2, "app-1.0.1", "resources"); fs.mkdirSync(r2, { recursive: true });
    fs.writeFileSync(path.join(r2, "_app.asar"), "old"); fs.writeFileSync(path.join(r2, "app.asar"), "new");
    install(r2, "C:/x/patcher.js");
    assert.strictEqual(fs.readFileSync(path.join(r2, "_app.asar"), "utf8"), "new", "repair keeps Discord's newer archive");
    assert.ok(!fs.existsSync(path.join(r2, "app.asar")));
    fs.rmSync(d2, { recursive: true });
    console.log("repair test passed");
}

// "Don't share" option: the loader names the profile.
{
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-"));
    const r3 = path.join(d3, "app-1.0.1", "resources"); fs.mkdirSync(r3, { recursive: true });
    fs.writeFileSync(path.join(r3, "app.asar"), "x");
    install(r3, "C:/x/patcher.js", "DiscordPTB");
    assert.match(fs.readFileSync(path.join(r3, "app", "index.js"), "utf8"), /LUMICORD_PROFILE = "DiscordPTB"/);
    fs.rmSync(d3, { recursive: true });
    console.log("profile test passed");
}

// fs shim: no encoding returns bytes (toString gives text), an encoding returns text; binary writes stay bytes.
{
    const renderer = fs.readFileSync(path.join(__dirname, "src", "renderer.js"), "utf8").replace(/\r/g, "");
    const src = /(const wantsText = [\s\S]*?\n    };)\n/.exec(renderer)[1];
    const N = { fs: { read: () => "héllo", readBytes: () => new Uint8Array(Buffer.from("héllo")) } };
    const readAny = vm.runInNewContext(`${src}; readAny`, { N, TextDecoder, Uint8Array });
    assert.strictEqual(readAny("x", "utf8"), "héllo");
    assert.strictEqual(readAny("x", { encoding: "utf8" }), "héllo");
    const b = readAny("x");
    assert.ok(b instanceof Uint8Array && b.length === 6, "bytes without encoding");
    assert.strictEqual(String(b), "héllo");
    assert.strictEqual(JSON.parse(readAny.call(null, "x").toString().replace("héllo", '"ok"')), "ok");
    console.log("fs binary test passed");
}
