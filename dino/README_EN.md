# Dino Run (恐龙快跑)

<p align="center">
  <img src="../assets/images/dino.svg" alt="Dino Run" width="200">
</p>

A pixel-style dino runner game inspired by the Chrome offline easter egg, built with modern web technologies. Control the little dinosaur to jump over cacti and dodge pterodactyls while the speed keeps increasing — see how far you can run!

[中文说明/Chinese Documentation](README.md)

## 🎮 About the Game

Dino Run recreates the core feel of Google Chrome's famous offline mini-game (T-Rex Runner): a pixel dinosaur runs endlessly through the desert while the player dodges obstacles by jumping and ducking. The game uses the same physics constants and fairness rules as the original Chromium build, delivering an authentic running experience.

## ✨ Features

- 🦖 **Authentic feel**: physics constants matching the original Chromium build (gravity, jump initial velocity, speed curve, spacing rules) — full-height jumps
- 🌓 **Day/night cycle**: night mode kicks in every 700 points (color inversion + moon and stars) and reverts after 12 seconds
- 🎯 **Fair spawning**: 3 seconds of clear track at the start; obstacle gaps scale with speed; the same obstacle type never appears more than 2 times in a row; pterodactyls only appear at higher speeds
- 💾 **Score tracking**: high scores saved separately per difficulty — challenge yourself
- 🎚️ **Three difficulty levels**: Easy / Normal / Hard, each with different starting speed and acceleration
- 🔊 **Synthesized sound effects**: jump/score/death sounds synthesized in real time via WebAudio, with one-click mute
- 📱 **Full-device support**: PC keyboard + mouse, plus mobile touch (jump/duck split control bar) — covers everything from 320px small screens to landscape
- ⏸️ **Pause anytime**: press P to pause, or auto-pause when the tab loses focus
- 🎨 **Theme sync**: follows the site's light/dark theme, with canvas colors switching automatically

## 🎯 How to Play

1. **Basic rules**:
   - The dinosaur runs forward automatically, gradually speeding up over time (6 → 13 px/frame, reaching the cap after about two minutes)
   - Hitting a cactus or a pterodactyl ends the game
   - There is no finish line — it's all about how long and how far you last

2. **Obstacle types**:
   - Small cacti: clusters of 1–3, dodge by jumping
   - Large cacti: appear at higher speeds, dodge by jumping
   - Pterodactyls (bird obstacles): appear at higher speeds, at three heights — low (jump), mid (duck or jump), high (standing still passes safely)

3. **Scoring system**:
   - Score = distance run × 0.025
   - The score flashes with a beep every 100 points
   - High scores are saved automatically (recorded separately per difficulty)

## 🕹 Controls

### Keyboard Controls

| Key | Action |
|------|------|
| Space / ↑ / W | Start / Jump |
| ↓ / S | Duck (hold to stay low) |
| P | Pause / Resume |
| Space after game over | Restart immediately |

### Touch Controls

| Gesture | Action |
|------|------|
| Jump zone (left) | Start / Jump / Restart |
| Duck zone (right) | Hold to duck, release to stand |
| Tap the screen | Start / Jump |

## 🔧 Technical Implementation

- Pure Canvas 2D rendering; sprites are drawn from pixel-matrix code (zero external assets)
- Delta-time driven (60 FPS baseline) — consistent speed on high-refresh-rate displays
- Multiple hitbox collision detection (three boxes for the dino + one box per obstacle, for forgiving contour-fitting collisions)
- Logical canvas of 760×220, scaled proportionally to the container width to fit any screen
- Physics parameters matching the original Chromium build: gravity 0.6, jump initial velocity -10 (fine-tuned with speed), spacing factor 0.6, night interval 700 points / 12 seconds

## 🌐 Browser Compatibility

Works in all modern browsers (Chrome / Firefox / Safari / Edge), running smoothly on both mobile and desktop.
