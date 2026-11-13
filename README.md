# 🪄 Magic Gesture Game · 手势魔法游戏

用手指在空中画出形状，就能施放魔法。
Draw a shape in the air with your finger to cast a spell.

**▶ 立即试玩 Play now:** https://kai369-hi.github.io/Magic_Game/
（需要电脑和摄像头 · Requires a computer with a webcam）

## 🎮 怎么玩 How to play

1. 允许网页使用摄像头 · Allow camera access
2. 只伸出食指，其他手指收起来 · Raise only your index finger
3. 在空中画一个形状，画完停住不动 · Draw a shape in the air, then hold still

| 形状 Shape | 魔法 Spell |
|---|---|
| △ 三角形 Triangle | 🔥 火焰弹 Fireball |
| ○ 圆形 Circle | ⭕ 光圈 Light Ring |
| ⚡ 闪电 Lightning | ⚡ 闪电 Lightning |
| ★ 五角星 Star | 🌟 星光冲击 Star Rush |
| 🌀 螺旋 Spiral | 🌪️ 龙卷风 Tornado |

不知道怎么画？点左下角的 📖 咒语书。
Not sure how to draw? Open the 📖 Spellbook in the bottom-left corner.

## 🧠 技术 How it works

```
摄像头 Camera → 手部追踪 Hand tracking → 状态机 State machine → 形状识别 Recognition → 特效 Effects
```

| 部分 Part | 技术 Technology |
|---|---|
| 手部追踪 Hand tracking | Google MediaPipe Hand Landmarker (21 landmarks) |
| 形状识别 Recognition | $1 Unistroke Recognizer, with bidirectional matching |
| 施法流程 Casting flow | Finite state machine (IDLE → DRAWING → CAST / FIZZLE → COOLDOWN) |
| 特效 Effects | HTML Canvas particle system |

所有处理都在浏览器里完成，不会上传任何影像。
Everything runs in your browser. No video is uploaded anywhere.

## 💻 在自己电脑上执行 Run locally

用 VS Code 的 Live Server 打开 `index.html`（摄像头只能在 `localhost` 或 `https` 下使用）。
Open `index.html` with VS Code's Live Server (the camera only works on `localhost` or `https`).

在 `localhost` 会自动开启开发者模式（录制模板、测量面板）；线上网站在网址后加 `?dev` 也能开启。
Developer mode (template recording and stats) is on automatically on `localhost`; add `?dev` to the URL to enable it online.

## 🙏 致谢 Credits

- [MediaPipe Hand Landmarker](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) — Google
- Wobbrock, J. O., Wilson, A. D., & Li, Y. (2007). *Gestures without libraries, toolkits or training: A $1 recognizer for user interface prototypes.* UIST '07.
