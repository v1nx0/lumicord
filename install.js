// Usage: node install.js            -> install Lumicord into Discord
//        node install.js uninstall  -> restore stock Discord
// Close Discord fully (tray too) first. Re-run after Discord updates.
const fs = require("fs");
const path = require("path");

function findResources(discordDir) {
    const apps = fs.readdirSync(discordDir).filter(d => /^app-\d/.test(d))
        .sort((a, b) => a.slice(4).localeCompare(b.slice(4), undefined, { numeric: true }));
    if (!apps.length) throw new Error(`No app-* folder in ${discordDir}`);
    return path.join(discordDir, apps.at(-1), "resources");
}

// profile: optional Discord folder name ("DiscordPTB"...) to give this version its own plugins/themes/settings.
function install(res, patcher, profile) {
    const asar = path.join(res, "app.asar"), orig = path.join(res, "_app.asar"), app = path.join(res, "app");
    // Discord replaced its own app.asar while ours is still around: the new one is the real one.
    if (fs.existsSync(orig) && fs.existsSync(asar)) fs.rmSync(orig);
    if (!fs.existsSync(orig) && !fs.existsSync(asar)) throw new Error("app.asar not found");
    // Loader first, rename last (undo the loader if the rename fails), so Discord can always start.
    fs.mkdirSync(app, { recursive: true });
    try {
        fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "discord", main: "index.js" }));
        const profileLine = profile ? `process.env.LUMICORD_PROFILE = ${JSON.stringify(profile)};\n` : "";
        fs.writeFileSync(path.join(app, "index.js"), `${profileLine}require(${JSON.stringify(patcher)});\n`);
        if (!fs.existsSync(orig)) fs.renameSync(asar, orig);
    } catch (e) {
        if (!fs.existsSync(orig)) fs.rmSync(app, { recursive: true, force: true });
        throw e;
    }
}

function uninstall(res) {
    // Restore the archive first; remove the loader only once Discord's own app.asar is back.
    const orig = path.join(res, "_app.asar"), asar = path.join(res, "app.asar");
    if (fs.existsSync(orig)) { if (fs.existsSync(asar)) fs.rmSync(asar); fs.renameSync(orig, asar); }
    fs.rmSync(path.join(res, "app"), { recursive: true, force: true });
}

module.exports = { findResources, install, uninstall };

if (require.main === module) {
    const discordDir = path.join(process.env.LOCALAPPDATA, "Discord");
    const res = findResources(discordDir);
    if (process.argv[2] === "uninstall") { uninstall(res); console.log("Lumicord removed from", res); }
    else { install(res, path.join(__dirname, "src", "patcher.js")); console.log("Lumicord installed into", res); }
}
