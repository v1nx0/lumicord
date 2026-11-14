// node test.js — checks the installer on a fake Discord folder.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { findResources, install, uninstall } = require("./install");

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
