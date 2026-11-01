# Royal Kludge Lighting Protocol

This document describes the classic RK lighting protocol as this app implements it. Sources are the official RK software configuration files in `public/rk/Dev/`, the [Rangoli](https://github.com/rnayabed/rangoli) project, and the physical observations recorded below.

It separates three things:

- **Wire facts**: report layouts the app sends (`src/models/LightingCodec.ts`).
- **App behavior**: when the app sends them (staged edits, explicit Apply).
- **Evidence**: what is source-derived versus physically observed, per exact variant.

## When the app sends lighting

Nothing is sent on connect, page load, tab change, slider movement or draft edits. Lighting edits are staged in a draft and leave the browser only when the user presses **Apply** (or an explicit resend, below) on the Lighting pane. Key Mapping has its own separate Apply, and a lighting send never sends keymap reports or touches pending keymap edits.

One lighting send transmits exactly one of these, in order, through the serialized write queue:

| Draft | Reports sent |
|---|---|
| Any mode other than the variant's custom mode | 1 global lighting report |
| The variant's established custom mode, with per-key colors | 1 global lighting report (mode set to the custom mode), then the 7 per-key color reports, buffers 1 to 7 |

Per-key colors are sent only together with the variant's custom mode. Colors painted while another mode is selected stay in the draft and are not sent. After a fully successful transfer, the app stores the applied lighting and per-key colors in browser localStorage, in logical RGB. If a transfer fails part-way, the keyboard may be partly updated. There is no readback or rollback; **Retry Apply** resends after a failure.

Because the keyboard can't be read back, lighting changed outside the app (Fn shortcuts, a native keyboard reset, RK's software) can be resent unchanged. When nothing is pending or failed, the Lighting bar offers **Resend lighting** if the shown settings match this browser's saved record, or **Send shown lighting** if there is no record and the shown settings are app defaults. Either sends the same 1 or 8 (1 + 7) reports as an Apply of the shown settings. The keymap has no such resend: a whole-map write has side effects (see the README), so it is sent only with pending key edits or as a retry after a failed transfer, and always after a confirmation.

## Configuration files

### KB.ini: mode definitions

Located at `/rk/Dev/{PID}/KB.ini`, the `[OPT]` section defines:

```ini
[OPT]
RGBKb=0              # 0 = single-color backlit, 1 = RGB
LayoutKeyNum=100
KbLayout=7

; Lighting mode definitions (up to 21 modes)
; Format: animation, speed, brightness, direction, random, colorpicker
LedOpt1=0,0,1,0,0,0  # Mode 1: brightness control only
LedOpt2=0,1,0,0,0,0  # Mode 2: speed control only
LedOpt3=0,0,0,0,0,0  # Mode 3: no controls (OFF)
```

`RGBKb=1` means the keyboard has RGB LEDs and RGB mode names. **It does not by itself mean the keyboard supports per-key custom colors**, and it does not identify which mode index is the custom mode. See [Custom mode is per-variant metadata](#custom-mode-is-per-variant-metadata).

#### LedOpt flag meanings

Each `LedOpt` entry has 6 flags that control which UI elements are shown:

| Position | Flag | Meaning | UI control |
|----------|------|---------|------------|
| 1 | animation | Unknown/reserved | 0 in every shipped `KB.ini` |
| 2 | speed | Animation speed slider | 1-5 slider (Very Slow → Very Fast) |
| 3 | brightness | Light brightness slider | 1-5 slider |
| 4 | direction | Direction control | 0=none, 1=left/right only, 2=up/down only |
| 5 | random | Random color mode | Toggle |
| 6 | colorpicker | Color selection | RGB color picker |

- **Speed values**: 1=Very Slow, 2=Slow, 3=Normal, 4=Fast, 5=Very Fast (default 3)
- **Brightness values**: 1-5 (exact labels unknown; default 5)
- **Sleep default**: 5 (off)

### led.xml: mode names

Located at `/rk/Dev/{PID}/en/led.xml` when present, otherwise the global `/rk/Dev/en/led.xml`. Files are UTF-16 LE with CRLF line endings.

The file holds **separate name tables**, and the table depends on the keyboard's lighting type:

| Lighting type | Tag prefix | Example from global `en/led.xml` |
|---|---|---|
| RGB (`RGBKb=1`) | `tc_led_mode1`–`tc_led_mode21` | `tc_led_mode2` = Ripples Shining, `tc_led_mode14` = Customize |
| Single-color backlit | `tc_led1`–`tc_led20` | `tc_led2` = Customize, `tc_led14` = Marquee Effect |
| Per-key reactive effects | `tc_eft1`–`tc_eft19` | |

The same number means different modes in different tables (for example `tc_led14` is not `tc_led_mode14`). The parser lives in `src/utils/ledXmlParser.ts` and `src/utils/buildLedManifest.ts`.

### Mode resolution

```
KB.ini: LedOpt{n}=flags
   ↓
led.xml: name from the table for this lighting type (tc_led_mode{n} for RGB)
   ↓
Mode index n → byte [5] of the global lighting report
```

Mode indices are opaque firmware values per variant. A translated label is display text, not protocol evidence.

## WebHID interface

All lighting and keymap reports are HID feature reports with ID `0x0A` and a 64-byte payload (65 bytes including the report ID in the buffers below). The app writes only when the device exposes that report on an accepted configuration collection **and** a shipped configuration exists for the exact VID/PID (`src/constants/deviceCapabilities.ts`).

- **Default for classic configurations**: the configuration collection is usage page `0x0001`, usage `0x0080`. This remains the assumed interface for every classic configuration without variant-specific evidence.
- **Exact `258A:0055` (RK61, USB)**: Chrome WebHID showed no `0001:0080` collection on 2026-11-01. The 64-byte feature report `0x0A` sits on a vendor-defined `FF00:0001` application collection, and the app also accepts that collection for this PID only. This is descriptor evidence, not proof of feature behavior.

Other RK protocol families (different report IDs or sizes) are refused before anything is sent.

## Report layouts (wire facts)

Based on [Rangoli's keyboardconfiguratorcontroller.cpp](https://github.com/rnayabed/rangoli/blob/master/src/keyboardconfiguratorcontroller.cpp), as implemented in `LightingCodec.ts`.

### Global lighting (1 report)

```
Buffer size: 65 bytes

[0] = 0x0a       # Report ID
[1] = 0x01       # Number of buffers
[2] = 0x01       # Buffer index
[3] = 0x02       # Sub-command
[4] = 0x29       # Sub-command parameter
[5] = mode       # Mode index from LedOpt{n} (1-21)
[6] = 0x00       # Reserved
[7] = speed      # 1-5
[8] = brightness # 0-5
[9] = red        # 0-255, zero when random
[10] = green     # 0-255, zero when random
[11] = blue      # 0-255, zero when random
[12] = random    # 0x01 = random colors, 0x00 = fixed color
[13] = sleep     # 1-5, see below
[14-64] = 0x00   # Padding
```

The global color is sent in **R, G, B order**. No channel swap has been observed for the global report, and the app does not apply one.

**Sleep values** (from Rangoli `KeyboardConfigurator.qml`): 1 = 5 min, 2 = 10 min, 3 = 20 min, 4 = 30 min, 5 = off. Zero is not valid.

### Per-key colors (7 reports)

```
7 buffers of 65 bytes each

[0] = 0x0a              # Report ID
[1] = 0x07              # Total number of buffers
[2] = buffer_index      # 1-7
[3] = 0x03              # Buffer 1 only
[4] = 0x7e              # Buffer 1 only
[5] = 0x01              # Buffer 1 only
[6-64] / [3-64]         # Color data: buffer 1 from byte 6 (59 bytes), buffers 2-7 from byte 3 (62 bytes)
```

The color data is one continuous stream split across the seven buffers. Each key occupies 3 bytes at stream offset `key.bIndex * 3`, in **wire order G, R, B**:

```
[offset + 0] = green
[offset + 1] = red
[offset + 2] = blue
```

The app, its draft and its localStorage record keep colors as logical RGB. Only the per-key encoder (`LightingCodec.encodeCustomRGB`) reorders them to G, R, B on the wire.

## Custom mode is per-variant metadata

The app offers per-key painting only for variants listed in `CLASSIC_VARIANT_METADATA` (`src/constants/deviceCapabilities.ts`), each with an explicit custom mode index. It never infers a custom mode from `RGBKb=1`, from a model name, or from a translated label such as "Customize".

| Variant | Custom mode | Basis |
|---|---|---|
| `258A:0055` RK61 | 14 | `KB.ini` `RGBKb=1` with `LedOpt14`; global `en/led.xml` `tc_led_mode14` = Customize |

The `LedOpt` flags do not mark a custom mode: `0055`'s `LedOpt14=0,1,1,0,1,1` looks like any other RGB mode. Every other RGB variant gets global lighting only until matching evidence is recorded for that exact variant. Feature evidence levels (config file only, experimental/source-checked, verified) live in `src/constants/deviceEvidence.ts`.

## Physical observations

Recorded observations. Global lighting and per-key colors are verified for `258A:0055` over USB only, from the observations below.

- **2026-11-01, `258A:0055` RK61 over USB, custom mode 14 (owner observation):** with the per-key stream written in R, G, B order, logical red on all keys displayed green. Targets Q = red, W = green, E = blue displayed green, red and blue respectively. So the firmware reads the first two bytes of each key as G, R.
- **2026-11-01, same unit, after the encoder switched to G, R, B:** the owner confirmed an exact match for Q red / W green / E blue / rest white, and for the complete WASD-blue/rest-white palette. Each Apply sent 8 reports (global plus 7).
- **2026-11-01, same unit, lighting after a native keyboard reset:** a lighting-only send of the original settings (1 report, 0 keymap reports) restored the owner's lighting and left the keymap and Mac modifier positions unchanged.
- **2026-11-02, same unit, final run:** the WASD-blue/rest-white palette still matched after a power cycle, and again after a keymap send and a second power cycle. A native reset (Fn+Space, then Fn+S) changed the lighting; a lighting-only send of the original settings then restored it exactly, with the Mac modifier positions and factory keys unchanged.

Keymap behavior, including the Mac-mode finding, is documented in the README under "Before you write a keymap".

Other variants have no recorded channel-order observation. Extend the G, R, B finding to another variant only with its own physical evidence.

## Mode index references

Rangoli's `modemodel.cpp` lists its own RGB mode numbering (for example 0x00 Custom, 0x01 Ambilight). The app does **not** use that numbering. It sends the `LedOpt{n}` index from the variant's `KB.ini`, and for `0055` custom mode is 14, not 0. Treat mode indices as opaque per-variant values.

## Examples

### F68 (single-color backlit)

```ini
[OPT]
RGBKb=0
LedOpt1=0,0,1,0,0,0  # Steady: brightness only
LedOpt2=0,1,0,0,0,0  # Breathing: speed only
LedOpt3=0,0,0,0,0,0  # OFF: no controls
```

Names come from the `tc_led{n}` table. Lighting Apply sends one global report.

### RK61 `0055` (RGB with established custom mode)

Mode names come from the `tc_led_mode{n}` table (mode 2 = Ripples Shining, mode 14 = Customize). Applying a normal mode sends one global report. Applying mode 14 with painted colors sends the global report with mode 14, then the 7 per-key reports in G, R, B wire order.

## Open research

- [x] Sleep timer mapping: 1=5min, 2=10min, 3=20min, 4=30min, 5=off
- [x] Direction flag: 0=none, 1=left/right, 2=up/down
- [x] Lighting readback: none found; keyboards appear write-only
- [x] `0055` per-key channel order: firmware reads G, R, B (observed 2026-11-01)
- [x] Corrected `0055` per-key colors: owner-confirmed QWE targets and WASD palette (2026-11-01)
- [x] `0055` per-key colors after power cycle: palette retained (2026-11-02)
- [x] Resending lighting after changes made outside the app: explicit lighting-only resend
- [ ] Custom mode index and channel order for other RGB variants
- [ ] Exact brightness level labels (1-5)

## References

- [Rangoli](https://github.com/rnayabed/rangoli): C++/Qt desktop app with RGB support
- RK software configuration files in `public/rk/Dev/`
- [WebHID API](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API)
