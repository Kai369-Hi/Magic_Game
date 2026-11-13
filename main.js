// 里程碑 ⑧：施法失败的烟雾 💨 + 咒语书 📖（外框计算和 3 种特效来自里程碑 ⑦）
//
// 这个文件负责“眼睛”（MediaPipe）、“画笔”（画面）和把各个模块接起来：
//   handPose.js          → 判断是不是只伸食指
//   spellStateMachine.js → 施法规则（状态机）
//   recognizer.js        → $1 识别器（双向比对）
//   templateStore.js     → 读取 / 储存 templates.json
//   shapeAnalyzer.js     → 算出一笔画的外框（中心点、大小）
//   effects.js           → 特效引擎
//   spellBook.js         → 左下角的咒语书
//
// 🧪 不用画也能看特效：在 Console 输入 testSpell("triangle")、
//    testSpell("circle")、testSpell("lightning")、testSpell("star")、
//    testSpell("spiral") 或 testSpell("fizzle")（烟雾）

// 从 CDN 载入 MediaPipe（固定版本号，避免以后自动更新导致坏掉）
import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import { isPointingPose } from "./handPose.js";
import { SpellStateMachine, State } from "./spellStateMachine.js";
import { prepareTemplate, recognize } from "./recognizer.js";
import { loadTemplatesFromFile, saveTemplatesToFile } from "./templateStore.js";
import { getBounds } from "./shapeAnalyzer.js";
import { EffectManager } from "./effects.js";
import { createSpellBook } from "./spellBook.js";

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d"); // ctx = 画笔
const statusEl = document.getElementById("status");
const debugEl = document.getElementById("debug");

// 🛠️ 开发者模式：显示“录制模板工具列”和“测量面板”
//   - 在自己电脑上（localhost）开 → 自动打开
//   - 部署后的网站 → 隐藏，画面干净；网址后面加 ?dev 才会显示
const DEV_MODE =
  new URLSearchParams(location.search).has("dev") ||
  ["localhost", "127.0.0.1"].includes(location.hostname);
if (!DEV_MODE) {
  document.getElementById("toolbar").hidden = true;
  debugEl.hidden = true;
}
const bannerEl = document.getElementById("banner");

let handLandmarker; // 👁️ 系统的“眼睛”

// MediaPipe 的 21 个点都有编号：0 是手腕，8 是食指指尖
const INDEX_FINGER_TIP = 8;

// ===== 可以调的参数 =====
const SMOOTHING_WINDOW = 5; // 平均最近几帧：越大越平滑，但越慢半拍

let recentTips = []; // 最近几帧的“原始”指尖位置，用来算平均
let latestTip = null; // 🆕 最新的指尖位置（像素），光圈跟着手走时会用到

// ✨ 特效引擎：画在 #fx 画布上；闪电的震动会让整个 #stage 晃动
const effects = new EffectManager(
  document.getElementById("fx"),
  document.getElementById("stage")
);

// 🆕 施法成功 → 算外框 → 放出对应的特效
function castEffect(shape, stroke) {
  const bounds = getBounds(stroke);
  console.log(`📐 外框：中心 (${Math.round(bounds.centerX)}, ${Math.round(bounds.centerY)})，大小 ${Math.round(bounds.size)}`);
  effects.spawn(shape, {
    bounds,
    end: stroke[stroke.length - 1], // 一笔的最后一点（闪电从这里出发）
    getTip: () => latestTip,
  });
}

// 🧪 测试用：不用画，直接在画面中间放特效（在 Console 输入 testSpell("triangle")）
window.testSpell = (shape = "triangle", size = 250) => {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const half = size / 2;
  castEffect(shape, [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy + half },
  ]);
};

// ===== 🪄 咒语表 =====
const SPELLS = {
  triangle: { shape: "△ 三角形", shapeEn: "Triangle", spell: "🔥 火焰弹", spellEn: "Fireball" },
  circle: { shape: "○ 圆形", shapeEn: "Circle", spell: "⭕ 光圈", spellEn: "Light Ring" },
  lightning: { shape: "⚡ 闪电", shapeEn: "Lightning", spell: "⚡ 闪电", spellEn: "Lightning" },
  star: { shape: "★ 五角星", shapeEn: "Star", spell: "🌟 星光冲击", spellEn: "Star Rush" },
  spiral: { shape: "🌀 螺旋", shapeEn: "Spiral", spell: "🌪️ 龙卷风", spellEn: "Tornado" },
};

// 📖 咒语书：左下角，点开可以看每个咒语怎么画（和咒语表用同一份资料）
const spellBook = createSpellBook(document.getElementById("stage"), SPELLS);

// 🌐 上方的状态提示：第一行中文，第二行英文（小字、灰色）
//    用 createElement 而不是 innerHTML：文字只会被当成文字，不会被当成 HTML 执行
let lastStatus = "";
function setStatus(zh, en) {
  const key = zh + "|" + en;
  if (key === lastStatus) return; // 一样的话就不用重画（每秒会被叫 30 次）
  lastStatus = key;
  const enSpan = document.createElement("span");
  enSpan.className = "en";
  enSpan.textContent = en;
  statusEl.replaceChildren(document.createTextNode(zh), document.createElement("br"), enSpan);
}

// ===== 📝 模板 =====
// templates.json 是唯一的数据来源：开网页时读取，按 💾 储存时写回去
let templates = []; // 原始轨迹（存档用）
let normalizedTemplates = []; // 公平化之后（比对用，含正反两个方向）
let recordingShape = null; // 正在录制哪个形状；null = 没在录制
let pendingStroke = null; // 🆕 刚录好、等你决定“保留还是丢掉”的那一笔
let unsavedChanges = 0; // 🆕 有几个变更还没储存到 templates.json

function setTemplates(list) {
  templates = list;
  normalizedTemplates = list.map(prepareTemplate);
  updateToolbar();
}

function addTemplate(shape, stroke) {
  const template = {
    name: shape,
    points: stroke.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    createdAt: new Date().toISOString(),
  };
  templates.push(template);
  normalizedTemplates.push(prepareTemplate(template));
  unsavedChanges++;
  updateToolbar();
}

function countTemplates(shape) {
  return templates.filter((t) => t.name === shape).length;
}

// 🧠 每画完一笔，状态机就会叫这个函数
function recognizeStroke(stroke) {
  // 🆕 录制模式：先不存，交给你检查
  if (recordingShape) {
    pendingStroke = { shape: recordingShape, points: [...stroke] };
    reviewEl.classList.add("show");
    return {
      recorded: true,
      name: `📝 这个 ${SPELLS[recordingShape].shape} 要保留吗？<br><small>Keep this ${SPELLS[recordingShape].shapeEn}?</small>`,
      confidence: 1,
    };
  }

  if (normalizedTemplates.length === 0) {
    return { confidence: 0, reason: "还没有模板，请先用下方按钮录制<br>No templates yet — record some below" };
  }

  const result = recognize(stroke, normalizedTemplates);
  const percent = Math.round(result.score * 100);

  // 在 console 印出每种形状的分数，方便之后调门槛
  console.table(
    result.ranking.map((r) => ({ 形状: SPELLS[r.name].shape, 相似度: `${Math.round(r.score * 100)}%` }))
  );

  return {
    shape: result.name,
    name: `${SPELLS[result.name].spell} ${SPELLS[result.name].spellEn}<br><small>相似度 Similarity ${percent}%</small>`,
    confidence: result.score,
    reason: `最像 ${SPELLS[result.name].shape}，但相似度只有 ${percent}%<br>Closest: ${SPELLS[result.name].shapeEn}, only ${percent}% similar`,
  };
}

// ===== 🆕 检查面板：保留或丢掉 =====
const reviewEl = document.getElementById("review");

function keepPending() {
  if (!pendingStroke) return;
  addTemplate(pendingStroke.shape, pendingStroke.points);
  closeReview();
}

function discardPending() {
  if (!pendingStroke) return;
  closeReview();
}

function closeReview() {
  pendingStroke = null;
  reviewEl.classList.remove("show");
  hideBanner();
}

document.getElementById("keepStroke").addEventListener("click", keepPending);
document.getElementById("discardStroke").addEventListener("click", discardPending);

// 键盘快捷键：Enter = 保留，Backspace / Delete = 丢掉
document.addEventListener("keydown", (event) => {
  if (!pendingStroke) return;
  if (event.key === "Enter") {
    event.preventDefault();
    keepPending();
  } else if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    discardPending();
  }
});

// ===== 🧰 工具列按钮 =====
const toolbarEl = document.getElementById("toolbar");
const saveStatusEl = document.getElementById("saveStatus");

// 🆕 录制按钮由咒语表自动产生：之后加新咒语，不用再改 HTML
for (const [key, s] of Object.entries(SPELLS)) {
  const button = document.createElement("button");
  button.dataset.shape = key;
  button.innerHTML = `${s.shape} ${s.shapeEn} <span class="count">0</span>`;
  toolbarEl.insertBefore(button, document.getElementById("stopRecord"));
}

for (const button of toolbarEl.querySelectorAll("button[data-shape]")) {
  button.addEventListener("click", () => {
    recordingShape = button.dataset.shape;
    button.blur(); // 让按钮失去焦点，Enter 键才不会又“按”到这个按钮
    updateToolbar();
  });
}

document.getElementById("stopRecord").addEventListener("click", () => {
  recordingShape = null;
  updateToolbar();
});

document.getElementById("clearTemplates").addEventListener("click", () => {
  // 删除是不能复原的动作，先确认（Nielsen #5：防止错误）
  if (confirm("确定要清空全部模板吗？（按 💾 储存之前，templates.json 文件不会改变）\n\nClear all templates? (templates.json will not change until you press 💾 Save)")) {
    setTemplates([]);
    unsavedChanges++;
    updateToolbar();
  }
});

// 💾 储存：把目前所有模板一次写进 templates.json
document.getElementById("saveTemplates").addEventListener("click", async () => {
  try {
    const outcome = await saveTemplatesToFile(templates);
    if (outcome === "cancelled") return;
    unsavedChanges = 0;
    updateToolbar();
    saveStatusEl.textContent =
      outcome === "saved"
        ? `✅ 已储存 ${templates.length} 个模板 · Saved ${templates.length} templates`
        : `⬇️ 已下载，请把 templates.json 放进 Magic_Game 文件夹 · Downloaded — move templates.json into the Magic_Game folder`;
  } catch (error) {
    console.error("❌ 储存失败：", error);
    saveStatusEl.textContent = "❌ 储存失败 Save failed: " + error.message;
  }
});

// 更新按钮上的数量、正在录制的按钮（红框），以及储存状态
function updateToolbar() {
  for (const button of toolbarEl.querySelectorAll("button[data-shape]")) {
    const shape = button.dataset.shape;
    button.querySelector(".count").textContent = countTemplates(shape);
    button.classList.toggle("recording", shape === recordingShape);
  }
  if (unsavedChanges > 0) {
    saveStatusEl.textContent = `● 有 ${unsavedChanges} 个未储存的变更 · ${unsavedChanges} unsaved change(s)`;
    saveStatusEl.className = "dirty";
  } else {
    saveStatusEl.className = "clean";
  }
}

// 有未储存的变更时，关掉或刷新网页前先提醒（Nielsen #5：防止错误）
window.addEventListener("beforeunload", (event) => {
  if (unsavedChanges > 0) {
    event.preventDefault();
    event.returnValue = "";
  }
});

// 🚦 状态机：状态一改变，就在 console 记录，并更新画面中间的大字
const machine = new SpellStateMachine({
  recognize: recognizeStroke,
  onTransition: (from, to, info) => {
    console.log(`🚦 ${from} → ${to}`, info ?? "");

    if (to === State.CAST && info.recorded) {
      showBanner(info.name, "record");
    } else if (to === State.CAST) {
      showBanner(`✨ ${info.name}`, "cast");
      castEffect(info.shape, machine.stroke); // 放特效
      spellBook.highlight(info.shape); // 🆕 咒语书发出那个魔法颜色的光
    } else if (to === State.FIZZLE) {
      showBanner(`💨 施法失败 Spell Failed<br><small>${info.reason}</small>`, "fizzle");
      // 🆕 从画的位置冒出烟雾（至少要有两个点才算得出外框）
      if (machine.stroke.length > 1) castEffect("fizzle", machine.stroke);
    } else if (to === State.IDLE) {
      hideBanner();
    }
  },
});

// 📊 测量用的计数器（每 1 秒结算一次）
let statFrames = 0;
let statHandFrames = 0;
let statStart = performance.now();

// ① 打开摄像头
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720 },
    audio: false,
  });
  video.srcObject = stream;

  // 等第一帧画面到了，才知道画面的真实宽高
  await new Promise((resolve) => {
    video.onloadeddata = resolve;
  });

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  effects.resize(video.videoWidth, video.videoHeight); // 🆕 特效画布也一样大
}

// ② 载入手部模型
async function loadModel() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU", // 用显卡加速
    },
    runningMode: "VIDEO", // 连续影片模式
    numHands: 1, // 只追踪一只手（施法只需要一只）
  });
}

// ③ 平滑处理：移动平均 (Moving Average)
function smoothPoint(rawPoint) {
  recentTips.push(rawPoint);
  if (recentTips.length > SMOOTHING_WINDOW) {
    recentTips.shift();
  }

  let sumX = 0;
  let sumY = 0;
  for (const p of recentTips) {
    sumX += p.x;
    sumY += p.y;
  }
  return { x: sumX / recentTips.length, y: sumY / recentTips.length };
}

// ===== 🎨 画笔 =====

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// 画出整笔魔力轨迹（曲线）。opacity：0 到 1，冷却时用来淡出
function drawStroke(points, opacity) {
  if (points.length < 2) return;

  ctx.save(); // 先存下画笔设定，画完再还原（就不用一项项关掉了）
  ctx.globalAlpha = opacity;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#ffd54f";
  ctx.shadowColor = "#ffd54f";
  ctx.shadowBlur = 15;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const mid = midpoint(points[i - 1], points[i]);
    ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, mid.x, mid.y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();

  ctx.restore();
}

// 画 21 个淡蓝色的小点（背景参考）
function drawHandPoints(hand) {
  ctx.fillStyle = "rgba(0, 229, 255, 0.4)";
  for (const point of hand) {
    ctx.beginPath();
    ctx.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 画魔杖尖。active = true 时是发光的金色，否则是暗淡的灰色
function drawWandTip(tip, active) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, active ? 12 : 8, 0, Math.PI * 2);
  ctx.fillStyle = active ? "#ffd54f" : "rgba(200, 200, 200, 0.6)";
  if (active) {
    ctx.shadowColor = "#ffd54f";
    ctx.shadowBlur = 20;
  }
  ctx.fill();
  ctx.restore();
}

// 🆕 “停住”进度圈：绕着指尖慢慢画满一圈，满了就结束这一笔
function drawStillRing(tip, progress) {
  if (progress <= 0.05) return;

  ctx.save();
  ctx.beginPath();
  // 从 12 点钟方向（-90 度）开始，顺时针画 progress 那么多
  ctx.arc(tip.x, tip.y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

// 画面中间的大字（用 HTML 而不是 canvas，因为 canvas 是镜像的，字会左右相反）
function showBanner(html, type) {
  bannerEl.innerHTML = html;
  bannerEl.className = `show ${type}`;
}

function hideBanner() {
  bannerEl.className = "";
}

// ===== ⑦ 每一帧要做的事 =====
function processFrame(result, now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // --- 1. 整理这一帧看到的东西 ---
  let hand = null;
  let tip = null;
  let pointing = false;

  if (result.landmarks.length > 0) {
    hand = result.landmarks[0];
    const smoothTip = smoothPoint(hand[INDEX_FINGER_TIP]);
    tip = { x: smoothTip.x * canvas.width, y: smoothTip.y * canvas.height };
    pointing = isPointingPose(hand, canvas.width, canvas.height);
  } else {
    // 没看到手：清掉平均用的记录，找回手时才不会和旧位置混在一起
    recentTips = [];
  }
  latestTip = tip; // 🆕 给特效用（没看到手时是 null，光圈就停在原地）

  // 🆕 正在等你决定“保留还是丢掉”：暂停状态机，画面保留那一笔
  if (pendingStroke) {
    if (hand) drawHandPoints(hand);
    drawStroke(pendingStroke.points, 1);
    setStatus("📝 这一笔要保留吗？按 ✅ 保留（Enter）或 ❌ 丢掉（Backspace）", "Keep this stroke? ✅ Keep (Enter) or ❌ Discard (Backspace)");
    return;
  }

  // --- 2. 交给状态机判断 ---
  machine.update({ now, hasHand: hand !== null, tip, pointing });

  // --- 3. 按照现在的状态来画 ---
  if (hand) drawHandPoints(hand);

  switch (machine.state) {
    case State.IDLE:
      if (tip) drawWandTip(tip, pointing);
      if (recordingShape) {
        setStatus(
          `📝 录制模式：画一个 ${SPELLS[recordingShape].shape}（只伸食指开始）`,
          `Recording: draw a ${SPELLS[recordingShape].shapeEn} (raise only your index finger to start)`
        );
      } else {
        if (hand) {
          setStatus("☝️ 只伸出食指（其他手指收起来）就能开始画", "Raise only your index finger to start drawing");
        } else {
          setStatus("✋ 把手举到镜头前", "Show your hand to the camera");
        }
      }
      break;

    case State.DRAWING:
      drawStroke(machine.stroke, 1);
      if (tip) {
        drawWandTip(tip, true);
        drawStillRing(tip, machine.stillProgress(now));
        // 轨迹还很短：代表玩家只是准备好了，还没开始画
        if (machine.pathLength < machine.config.MIN_PATH_PX) {
          setStatus("☝️ 准备好了，开始画吧！", "Ready — start drawing!");
        } else {
          setStatus("✍️ 画画中…画完后停住不动", "Drawing… hold still to finish");
        }
      } else {
        setStatus("⚠️ 跟丢了，动作慢一点…", "Lost tracking — move a bit slower…");
      }
      break;

    case State.COOLDOWN:
      // 刚画的那一笔慢慢淡出
      drawStroke(machine.stroke, machine.cooldownRemaining(now));
      if (tip) drawWandTip(tip, false);
      setStatus("⏳ 冷却中…", "Cooling down…");
      break;
  }
}

// 📊 测量：每 1 秒算一次帧率和识别率
function updateStats(result, now) {
  statFrames++;
  if (result.landmarks.length > 0) statHandFrames++;

  const elapsed = now - statStart;
  if (elapsed >= 1000) {
    const fps = (statFrames * 1000) / elapsed;
    const detectRate = (statHandFrames / statFrames) * 100;
    debugEl.textContent =
      `📊 摄像头 Camera FPS: ${fps.toFixed(0)}  ｜  识别率 Detection: ${detectRate.toFixed(0)}%  ｜  状态 State: ${machine.state}`;

    statFrames = 0;
    statHandFrames = 0;
    statStart = now;
  }
}

// ⑧ 主循环：摄像头每送来一张“新照片”，才处理一次（🔔 门铃）
function onVideoFrame(now) {
  const result = handLandmarker.detectForVideo(video, now);
  processFrame(result, now);
  updateStats(result, now);

  video.requestVideoFrameCallback(onVideoFrame);
}

// 备用方案：少数旧浏览器没有 requestVideoFrameCallback，就退回旧做法
let lastVideoTime = -1;
function fallbackLoop() {
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const now = performance.now();
    const result = handLandmarker.detectForVideo(video, now);
    processFrame(result, now);
    updateStats(result, now);
  }
  requestAnimationFrame(fallbackLoop);
}

function startLoop() {
  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    video.requestVideoFrameCallback(onVideoFrame);
  } else {
    console.warn("⚠️ 浏览器不支持 requestVideoFrameCallback，改用备用方案");
    fallbackLoop();
  }
}

// 启动顺序：摄像头 → 模型 → 开始循环
async function main() {
  try {
    setStatus("正在读取 templates.json…", "Loading templates…");
    setTemplates(await loadTemplatesFromFile());
    console.log(`📂 读取了 ${templates.length} 个模板`);

    setStatus("正在开启摄像头…", "Starting camera…");
    await startCamera();

    setStatus("正在载入手部模型…（第一次会比较久）", "Loading hand model… (may take a while the first time)");
    await loadModel();

    startLoop();
  } catch (error) {
    console.error("❌ 出错了：", error);
    setStatus("❌ 出错了：" + error.message, "Error: " + error.message);
  }
}

main();
