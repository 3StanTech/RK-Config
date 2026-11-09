# RK Configurator

**Unofficial browser-based key remapper and lighting editor for Royal Kludge keyboards**

RK Configurator is a modified version of [KludgeKnight](https://github.com/vinc3m1/kludgeknight) by Vince Mi (upstream project). It runs in your browser and talks to the keyboard over WebHID, and nothing is sent to a keyboard until you press **Apply**.

**Live site: [rk-config.pages.dev](https://rk-config.pages.dev)**

Source for this modified version: [github.com/3StanTech/RK-Config](https://github.com/3StanTech/RK-Config).

> ⚠️ **Disclaimer**: This is unofficial software and is not affiliated with, endorsed by, or connected to Royal Kludge in any way. Use at your own risk.

> **Status**: First-release candidate. Key mapping, global lighting and per-key colors are verified on one RK61 (`258A:0055`) over USB only; no other model or connection is verified (see [Feature evidence](#feature-evidence)). It is hosted at [rk-config.pages.dev](https://rk-config.pages.dev), and its source is public at [3StanTech/RK-Config](https://github.com/3StanTech/RK-Config).

## ✨ What this version adds

Compared with upstream KludgeKnight:

1. **Per-key colors**: paint individual keys, fill or clear them, on models with an established custom lighting mode.
2. **Built-in palettes**: two starting arrangements (WASD blue with the rest white; alternating cyan/purple columns). You can edit every color.
3. **Modifier chords**: map a key to left/right Control, Shift, Option/Alt and Command/Win plus a base key (for example ⌘ Command + C).
4. **Staged changes with Apply**: edits stay pending until you press Apply. Key Mapping and Lighting each have their own Apply and Discard, so applying one never sends the other's pending edits. Every keymap send asks for confirmation first, and lighting can be resent on purpose when nothing is pending.
5. **Remembered per-key colors**: the last successfully applied keymap, lighting and per-key colors are kept in this browser.
6. **Feature evidence labels**: each model shows how well each feature is actually backed, so a model listed in RK's files is not presented as proven.
7. **Keyboards drawn in code**: each model's keyboard is drawn from its own key data in RK's configuration files (two models whose key data this app can't read show a note instead), snapped to an even key grid (with the L-shaped Enter on ISO boards), instead of RK's product photos.

Kept from upstream: global lighting (mode, brightness, speed, sleep, color), a demo mode, and keyboard configurations taken from the official RK Windows software.

## 🚀 Using it

### Requirements

- **Browser**: desktop Chrome, Edge or Opera (WebHID). Firefox, Safari and mobile browsers do not support WebHID.
- **Connection**: USB cable. Bluetooth and 2.4 GHz are not supported.
- **Keyboard**: a model with a shipped RK configuration that exposes the classic RK configuration report (feature report `0x0A`, 64-byte payload) on an accepted collection. The default is usage page `0x0001` / usage `0x0080`. The RK61 `258A:0055` puts it on a vendor-defined `FF00:0001` collection instead, which is accepted for that model only. Keyboards using other or newer RK protocols are refused before anything is sent; use RK's own software for those.

### Steps

1. Open the app at [rk-config.pages.dev](https://rk-config.pages.dev), or run it locally (see [For developers](#-for-developers)).
2. Click **Connect keyboard** and pick the keyboard in the browser dialog. Connecting sends nothing.
3. Stage edits on the **Key Mapping** or **Lighting** tab. On Key Mapping, pick a key on the keyboard and set its new key or chord in the panel beside it; on Lighting, choose a mode and settings there, or paint key colors with the tools beside the keyboard. The floating Apply bar under the keyboard shows how many changes are waiting and what Apply sends.
4. Press **Apply to keyboard** in that tab's Apply bar, or **Discard** to drop its pending edits without sending anything. Key Mapping then asks you to confirm: **Cancel** (focused first, also Escape) sends nothing and keeps your edits pending; **Send keymap (9 reports)** sends the whole map.

Resetting a key or all keys to default is also staged; it only reaches the keyboard after Apply and the same confirmation. "Default" means the layout from RK's configuration file, sent as a normal whole-map write. It is not the keyboard's own hardware factory reset.

**Resending lighting:** when no lighting edits are pending, the Lighting tab's Apply bar offers **Resend lighting** (the shown settings match what this browser last sent) or **Send shown lighting** (nothing was sent from this browser yet, so the shown settings are app defaults). Use it when the keyboard's lighting was changed elsewhere, for example by Fn shortcuts or a keyboard reset. It sends 1 report, or 8 (1 + 7) when the shown mode is the model's custom per-key mode, and never sends the keymap or touches pending key edits. Key Mapping has no equivalent: a keymap is sent only when key edits are pending or as **Retry Apply** after a failed transfer, always with confirmation.

**Try without a keyboard:** choose **Try the demo** (or **Try in demo** on any row of the model catalog) to explore a listed model; in the demo, **Switch keyboard** opens the same picker. Apply is only simulated there: nothing is written to hardware or saved in the browser, and a demo apply never counts as evidence that a model works.

### What Apply sends

- **Key Mapping Apply replaces the whole keymap.** This app writes keymaps with the classic RK report format, which only carries a complete map and cannot read the keyboard back, so every Apply sends the full map (nine reports), including keys you didn't touch. Whether a given firmware has some other update method is unknown; this app doesn't use one.
- **Lighting Apply** sends one global lighting report. In the model's custom per-key mode it sends the global report first, then seven per-key color reports. Per-key colors painted while another mode is selected are not sent.
- Colors are stored as ordinary RGB. On the RK61 `0055` the per-key reports put each key's bytes in G, R, B order, because the keyboard was observed reading them that way. The global lighting color stays R, G, B. Details are in [`docs/lighting-protocol.md`](docs/lighting-protocol.md).
- Chord modifier bits are sent exactly as chosen. There is no automatic Mac/Windows swap.
- If a transfer fails part-way, the keyboard may be partly updated. There is no rollback, so apply again. The app saves only the area that was sent successfully.

### Before you write a keymap: tested RK61 `258A:0055` findings

These were observed on one RK61 (`258A:0055`, USB, macOS) on 2026-11-01 and 2026-11-02. They are not known to apply to other models, and the firmware mechanism behind them is unknown.

- **Any keymap send turns off the keyboard's native Mac mode.** The app sends the whole map, using the Windows-style modifier positions from RK's configuration for every key you didn't change. On the tested unit, a send that changed only CapsLock → Escape also swapped left Win/Alt: the keys that sent `AltLeft`/`MetaLeft` (Option/Command) before now sent `MetaLeft`/`AltLeft`. The app doesn't swap modifiers automatically.
- **Fn+S, unplugging and resending the default layout did not bring Mac mode back.** Fn+S alone, app Disconnect then Fn+S, and power-cycle then Fn+S all still produced the swapped positions. Sending the app's default layout restored CapsLock but not the Mac positions.
- **What a keymap send did, tested:** CapsLock → Escape and Menu → ⌘ Command + C both worked, untouched keys such as A were unchanged, Fn+1 still produced F1, and everything (plus a per-key palette) was the same after a power cycle. Only these keys and this one chord were checked, not every Fn function, chord or key.
- **Recovery that worked on this unit:** RK's native reset (hold Fn+Space until the backlight flashes), then Fn+S, per the [official RK61 shortcut guide](https://rkgamingstore.com/blogs/community/rk61-key-combinations). This was observed to remove both custom remaps (CapsLock and Menu back to normal), restore left Option/Command, and change the lighting. It may also clear other onboard settings or pairing information. No other way of getting native Mac mode back was found.
- **Restoring lighting afterwards:** resending only the original lighting (one report, no keymap) brought the lighting back and kept the Mac positions and normal keys. Use **Resend lighting** for this; don't send a keymap, because any keymap send turns Mac mode off again.
- **The app still shows the old keymap after a native reset.** Its saved record is what this browser last sent, not a reading of the keyboard, so after a reset it can show remaps the keyboard no longer has. That is expected; there is nothing to fix by resending it.

## ⚠️ Limitations

**This app has no configuration readback.** No readback method is established for its classic driver. The editor starts from what this browser last applied successfully, or from defaults if it never applied anything. Neither is a reading of the keyboard. Settings made in RK's software, in another browser or by a keyboard reset won't appear here, and the next Key Mapping Apply overwrites the whole keymap. Lighting shown here can be pushed again with **Resend lighting**.

**Browser storage only.** There is one record per keyboard holding the last applied keymap, lighting and per-key colors. There are no named profiles, settings files or import/export. The record:

- belongs to one browser and one site address (origin). Another browser, a cleared browser profile, or the app served from a different address (for example `localhost` vs. a public domain) starts from defaults;
- keeps the upstream storage key format, so records from upstream on the same address stay readable;
- may fail to save if storage is full. The Apply still reaches the keyboard; the app tells you it wasn't remembered.

Applied keymap and lighting live in the keyboard's own memory until overwritten or cleared by a keyboard reset. On the tested RK61 they survived a power cycle. Upstream reports that they work on other computers without the app; this version has not re-tested that.

## Feature evidence

Each model in the app's catalog carries a label per feature:

- **Config file only**: listed in RK's configuration files, untested with this app.
- **Experimental · source-checked**: configuration and protocol checked from source, not yet confirmed on hardware.
- **Verified**: physically confirmed with this app for that feature and connection.

Nothing is labelled verified without a recorded hardware run. Verified so far, on the RK61 `258A:0055` over USB only:

- **Key mapping:** CapsLock → Escape and Menu → ⌘ Command + C worked, an untouched key and Fn+1 → F1 were unchanged, and all survived a power cycle. Mind the Mac-mode side effect in [Before you write a keymap](#before-you-write-a-keymap-tested-rk61-258a0055-findings).
- **Global lighting:** the owner's original mode, speed, brightness, sleep and color were restored exactly by a lighting-only send.
- **Per-key colors:** Q red / W green / E blue / rest white and the complete WASD-blue/rest-white palette matched exactly, and the palette survived a power cycle.

This does not cover other models, Bluetooth or 2.4 GHz, every Fn function, every chord or key, or keeping the keyboard's native Mac mode. The upstream project reports testing key mapping and global lighting on the RK F68 and S70 Split; this version has not re-tested those. Per-key colors and palettes are offered only where a custom mode is established for the exact model. Currently that is the RK61 (PID `0055`, Customize mode 14), taken from its configuration files. Other RGB models get global lighting only.

The bundled catalog in `public/rk/` comes from the official RK Windows software (October 2025). The app's **Model Catalog** lists every model and its label. A listed model can be opened in demo mode, but that doesn't mean it works with this app.

## Not included

- Named profiles, settings files and import/export
- Macros. The RK macro protocol has not been reverse engineered. Use OS-level tools instead: [AutoHotkey](https://www.autohotkey.com/) (Windows), [AutoKey](https://github.com/autokey/autokey) (Linux), [Karabiner-Elements](https://karabiner-elements.pqrs.org/) (macOS).
- Reading the current configuration from the keyboard
- Live lighting preview on the keyboard (changes are sent only on Apply)
- Newer or other RK protocol families, Bluetooth and 2.4 GHz
- Firmware updates or flashing

## 🔒 Privacy

The app is a static site with no backend, accounts, analytics or uploads. Configuration goes directly from the browser to the keyboard over WebHID, and only when you press Apply. Settings stay in browser localStorage. Theme fonts other than the bundled Inter are fetched from Google Fonts when you select such a theme.

## 🐛 Troubleshooting

**Keyboard not detected or refused?**
- Use desktop Chrome, Edge or Opera, connected by USB (not Bluetooth/2.4 GHz)
- Try a different USB port or cable
- A refusal message means the model or its protocol is not supported by this app

**Changes not taking effect?**
- Check the Apply bar and its error or status message after Apply
- After a failed transfer, use **Retry Apply**; if lighting was changed on the keyboard itself, use **Resend lighting**

## 👨‍💻 For developers

Requires [Bun](https://bun.sh/).

```bash
# Install exactly the locked dependencies
bun install --frozen-lockfile

# Dev server on http://127.0.0.1:5173 (loopback only)
bun run dev

# Lint, typecheck, test and build
bun run validate

# Static build into dist/
bun run build
```

Local builds emit no canonical or structured-data URLs; those are added only when `SITE_URL` is set at build time to a site you own.

### Hosting

The public site is the static build served by Cloudflare Pages (project `rk-config`). Pages is connected to this repository: every push to `main` builds the site with `bun run build` and publishes `dist/`. The production build variable is `SITE_URL=https://rk-config.pages.dev`; Node.js and Bun use the versions pinned in `.node-version` and `package.json`. No server-side rendering, Pages Functions, database or other backend is involved.

To deploy by hand instead, for example from a local checkout:

```bash
SITE_URL=https://rk-config.pages.dev bun run build
npx --yes wrangler@4 pages deploy ./dist --project-name rk-config --branch main
```

The GitHub Pages workflow (`.github/workflows/deploy.yml`) is an unused alternative, not the current host; it runs only on manual dispatch and validates before deploying. Pull requests are checked by `pr-check.yml`.

## 📄 License

```
Kludge Knight - Browser-based Software for Royal Kludge Keyboards
Copyright (C) 2025 Vince Mi (vinc3m1)

RK Configurator is a modified version of Kludge Knight (2026),
distributed under the same license.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.
```

The full license text is in [`LICENSE`](LICENSE). Anyone distributing this modified version, including hosting it publicly, must also make its corresponding source available under the GPL. This modified version's corresponding source is at [github.com/3StanTech/RK-Config](https://github.com/3StanTech/RK-Config). The original KludgeKnight source is upstream at [github.com/vinc3m1/kludgeknight](https://github.com/vinc3m1/kludgeknight).

## 🙏 Acknowledgments

- [KludgeKnight](https://github.com/vinc3m1/kludgeknight) by Vince Mi, the upstream project this version modifies.
- [Rangoli](https://github.com/rnayabed/rangoli) by Debayan Sutradhar, which inspired upstream. The protocol understanding and WebHID connection parameters came from studying it.

**Derivative work:** `src/models/BufferCodec.ts` contains code ported from Rangoli's `keyboardconfiguratorcontroller.cpp`.
