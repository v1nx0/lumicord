# Lumicord

A tiny Discord desktop client mod, written from scratch.

> Client mods break Discord's Terms of Service. Use at your own risk.

## Install
1. Quit Discord completely (also from the tray).
2. `node install.js`
3. Open Discord, press **Ctrl+Shift+L** for the Lumicord panel.

Uninstall: `node install.js uninstall`. Discord updates undo the install, so run it again after one.

## Where to find it
Open Discord **User Settings**: a **Lumicord** section (Plugins, Themes, Marketplace) is added to the sidebar.
**Ctrl+Shift+L** opens the same pages anywhere, even if Discord changes its settings layout.

## Plugins
Files in `plugins/` load by name:

| File | Format |
|------|--------|
| `*.plugin.js` | BetterDiscord plugins (`BdApi`: Webpack, Patcher, Data, DOM, UI, Utils, legacy calls) |
| `*.vc.js` | Vencord-style plain JS plugins (`definePlugin`, `definePluginSettings`, `OptionType`). `start`/`stop` and settings work; webpack `patches` do not. |
| other `*.js` | Lumicord: `({ name, description, start(api) {}, stop() {} })`, `api.addCSS(css)` returns a remover |

## Themes
Any `.css` in `themes/`, including BetterDiscord `.theme.css` files. Get them from the Themes Marketplace tab, or drop files into the folder, then toggle them on the Themes page.

## Marketplace
Browses and installs plugins and themes from the public BetterDiscord catalog.

Settings live in `settings.json`, plugin data in `data/`. Press Ctrl+R in Discord to reload.
