// Usage: node release.js 1.1.0
// Sets the version, rebuilds the installer, and writes dist/lumicord-update.json (what the in-Discord updater downloads).
// Then publish a GitHub release named v1.1.0 with dist/lumicord-update.json and dist/LumicordInstaller.exe attached.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || "")) { console.error("Usage: node release.js <major.minor.patch>, e.g. 1.1.0"); process.exit(1); }

const root = __dirname;
const vPath = path.join(root, "version.json");
const v = JSON.parse(fs.readFileSync(vPath, "utf8"));
v.version = version;
fs.writeFileSync(vPath, JSON.stringify(v, null, 2) + "\n");

// The same files the updater is allowed to replace (see updatableFile in src/preload.js).
const list = ["version.json",
    ...fs.readdirSync(path.join(root, "src")).filter(f => f.endsWith(".js")).map(f => "src/" + f),
    ...fs.readdirSync(path.join(root, "vencord")).filter(f => /\.(js|css|txt)$/.test(f) || f === "LICENSE").map(f => "vencord/" + f)];
const files = {};
for (const rel of list) {
    const data = fs.readFileSync(path.join(root, ...rel.split("/")));
    files[rel] = { sha256: crypto.createHash("sha256").update(data).digest("hex"), data: data.toString("base64") };
}

const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "lumicord-update.json"), JSON.stringify({ version, files }));
execSync(`"${path.join(root, "installer", "build.cmd")}"`, { stdio: "inherit", shell: true });
fs.copyFileSync(path.join(root, "LumicordInstaller.exe"), path.join(dist, "LumicordInstaller.exe"));

console.log(`\nLumicord v${version} is ready in dist/ (${list.length} files in the update).`);
console.log(`Publish: create a GitHub release with tag v${version} and attach both files in dist/.`);
console.log(`With the GitHub CLI: gh release create v${version} dist/lumicord-update.json dist/LumicordInstaller.exe --title "Lumicord v${version}" --notes "What changed..."`);
