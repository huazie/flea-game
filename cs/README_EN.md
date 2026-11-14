# Counter Assault (反恐突袭)

<p align="center">
  <img src="../assets/images/cs.svg" alt="Counter Assault" width="200">
</p>

A zero-dependency browser tactical shooter: hand-written perspective projection on Canvas 2D, with one-key first/third-person switching over a shared scene and a shared hitscan ray. Clear three waves; win through cover and precise aiming.

[中文说明/Chinese Documentation](README.md)

## 🎮 About the Game

Clear waves of local AI bots in a single map built from axis-aligned boxes. There is no WebGL, no texture pack and no 3D engine — everything is flat color polygons drawn with a hand-written perspective projection and the painter's algorithm. Hits are resolved by an instant ray (walls first, then bots); there are no travelling projectiles. FPS and TPS differ only in camera position and the visibility of your own model: FOV, damage, spread and the ray itself are identical, so switching views is an observation tool, not a power switch.

## ✨ Features

- 🎯 **Instant hitscan**: nearest wall AABB first, then bot billboard rectangles — no projectile physics
- 🦘 **Jump & crouch**: Space to jump (4.5 m/s take-off, ±12° air spread), hold Ctrl/C to crouch (eye height eases 1.60→1.05 m); air / landing / crouch each carry a spread cost, so jumping is a purely tactical loss
- 🔭 **One-key view switch, one shared scene**: V toggles FPS / TPS with shared geometry, yaw/pitch and all numbers
- 🧱 **Cover is the tactic**: 12 non-intersecting walls block rays; flanking for line of sight and reloading behind cover matter
- 🎛 **Controllable spread**: 0° stationary / ±1.0° crouch-walking / ±3.0° walking / 0° with Shift (movement capped at 1.8 m/s); landing adds ±10° decaying linearly over 0.30 s
- 🔫 **Reload is a real window**: 8-round magazine, 1.4 s reload; wave 3 (5 bots) forces at least one reload
- 🔩 **Weapon viewmodel**: a screen-space 5-polygon geometric gun with movement sway, look lag, recoil with a real +1.2° view kick, a reload animation and muzzle flash — zero 3D face-pool usage
- 🎨 **Render upgrade**: 4 procedural textures (brick / concrete / crate / ground, cached per theme) + fake lighting + distance fog + sky gradient; below 45 fps it automatically falls back to flat-shaded rendering
- 💥 **Effects & audio**: bullet-hole decals (FIFO 32), hit particles (pool 64), ejected shells (pool 8) and muzzle flash, all pre-allocated; an in-game WebAudio mini-synthesizer (shot / footstep / jump / landing / hits), zero audio files
- 🤖 **Cheap bot FSM**: patrol → acquire sight, stop and fire → re-pick a waypoint after 2 s without sight; at most 2 bots fire simultaneously
- 🌗 **Theme sync**: follows the site light/dark theme; canvas colors are read from CSS variables, cached, and refreshed on theme change
- 📱 **Full-device support**: PC mouse + Pointer Lock; mobile joystick + drag-to-look + hold-to-fire + jump/crouch buttons, with reduced internal resolution on low-end devices
- 💾 **Score record**: Score = 100 × kills + 10 × hits; high score saved to localStorage

## 🎯 How to Play

1. **Win / lose**: destroy all bots across 3 waves (3 / 4 / 5) to complete the mission; HP ≤ 0 means failure.
2. **Between waves**: a 2.0 s intermission refills the magazine and restores +20 HP (cap 100); your position is **not** reset.
3. **Numbers**: player 100 HP, 40 damage per shot; bots 80 HP (2 shots), 8 damage per hit, 1.2 s fire interval, accuracy 0.35 / 0.45 / 0.55 by wave.
4. **Line of sight**: a bot only stops and fires when there is no wall in the way, distance ≤ 18 m, and the player is inside its 120° view cone.
5. **Edge cases**: an empty magazine does not fire or consume ammo, flashes red and auto-reloads; repeated inputs during reload are not queued; blur / background / Pointer Lock loss auto-pauses and freezes timing; the TPS camera retracts along its backward ray when a wall is near (minimum 0.3 m) and the player model turns translucent.

## 🕹 Controls

### Keyboard / Mouse

| Input | Action |
|------|------|
| W / A / S / D | Move forward / left / back / right relative to camera yaw |
| Mouse move | Rotate yaw / pitch (click the canvas to request Pointer Lock; pitch clamped to ±60°) |
| Hold left button | Fire, limited by the 0.20 s interval (each shot kicks the view up +1.2°, pull down to compensate) |
| Space | Jump (×0.85 while crouched; ±12° air spread, Shift is ignored mid-air) |
| Hold Ctrl / C | Crouch: 2.0 m/s movement, eye height eases 1.60→1.05 m over 0.15 s (C is recommended — Ctrl+W closing the tab cannot be intercepted) |
| R | Reload (ignored when the magazine is full; reloading mid-jump is allowed and keeps timing) |
| V | Toggle FPS / TPS |
| Hold Shift | Steady aim: movement capped at 1.8 m/s and spread forced to 0° |
| P / Esc | Pause / resume |

### Touch

| Control | Action |
|------|------|
| Bottom-left joystick | Move (48 logical px radius; centered means stationary and zero spread) |
| Drag on right half | Rotate yaw / pitch |
| Bottom-right "Fire" | Hold to fire continuously |
| "Jump" button | Above the fire button, 44 logical px |
| "Crouch" button | Left of the jump button, toggle-style (tap again to stand) |
| Reload / View / Pause | Small buttons |

After pausing you must actively press "Continue" (which re-locks the mouse on PC); no accumulated large dt is replayed.

## 🔧 Technical Implementation

- Pure Canvas 2D hand-written perspective: camera basis → camera space → **0.1 m near clip plane** (Sutherland-Hodgman clipping) → perspective divide
- Painter's algorithm sorts faces by distance from the camera to face center, descending; ≤ 80 visible faces per frame, with pre-allocated face pool, vertex buffers and sort indices — zero per-frame object allocation
- Renderer abstraction `Renderer{beginFrame, submitFace, drawBillboard, drawViewmodel, endFrame}`: `Renderer2D` (procedural textures + fake lighting + distance fog + sky gradient) and `Renderer2DFlat` (flat-color fallback, auto-switched below 45 fps) share the same interface
- The player has a y-axis: 4.5 m/s jump take-off, 12 m/s² gravity, eye height varies with jump/crouch while the hit ray always starts from the actual eye position, fully decoupled from the camera; jump/crouch never change x/z collision
- All timers use accumulated dt (capped at 0.05 s), independent of refresh rate; frames stop while paused or unfocused
- Movement collision is a circle r=0.4 m against AABBs with axis-separated sliding; plain ordered `<script>` tags, isolated `CS` global namespace, no build step, no ES modules, no runtime dependencies

See the [architecture ADR](docs/architecture.md) for decisions.

## 🌐 Browser Compatibility

Works in all modern browsers (Chrome / Firefox / Safari / Edge). Desktop browsers with Pointer Lock give the best experience; mobile automatically falls back to touch controls.
