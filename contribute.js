// 🤝 贡献模式：一步一步教玩家录制模板，录好后上传到 Supabase（等你审核）
//
// 流程（每一步都要玩家“真的做到”才会往下走 → 互动式教学 interactive onboarding）：
//   ⓪ 同意书：说清楚收集什么、不收集什么（只有第一次会问）
//   ① 摆手势：系统真的看到“只伸食指”才打勾
//   ② 选形状：9 张卡片，显示“已交 2/5”
//   ③ 看示范：画法动画 + 文字说明
//   ④ 画画看：用游戏原本的状态机来画（同一套规则，资料才会跟真实玩的时候一样）
//   ⑤ 检查：示范和你画的并排，加上“系统认为这是什么、相似度多少”
//   ⑥ 上传：显示 3/5，可以再画一个、换形状或结束
//
// main.js 会问这个模组：
//   active        → 现在是不是在贡献模式
//   wantsDrawing  → 现在要不要让状态机跑（只有第 ④ 步要）
//   pendingPoints → 等待检查的那一笔（画面上要一直显示着）
//   status        → 画面上方的提示文字

import { fetchMyCounts, submitTemplate } from "./cloudTemplates.js";
import { DEMO_PATHS, DETAILS, DEMO_SIZE, CYCLE, toPixels, drawDemo } from "./spellBook.js";

const MAX_PER_SHAPE = 5; // 每个形状最多交几个（数据库那边也会挡）
const POSE_HOLD_MS = 600; // 第 ① 步：食指要连续伸着多久才算“看到了”
const CONSENT_KEY = "magicGame.contributeConsent";
const COUNTS_KEY = "magicGame.contributeCounts"; // 连不上服务器时，用这台电脑记的数量

// 上方的步骤条
const STEPS = [
  { id: "pose", zh: "手势", en: "Pose" },
  { id: "pick", zh: "选形状", en: "Shape" },
  { id: "demo", zh: "示范", en: "Watch" },
  { id: "draw", zh: "画画", en: "Draw" },
  { id: "review", zh: "检查", en: "Review" },
  { id: "upload", zh: "上传", en: "Upload" },
];

// 小工具：一段中英双语的文字（中文在上，英文小字在下）
const bi = (zh, en, cls = "") => `<div class="bi ${cls}">${zh}<span class="en">${en}</span></div>`;

// localStorage 有时候不能用（无痕模式、被封锁），所以一律包在 try/catch 里
function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不了也没关系，只是下次要重新问
  }
}

// SPELLS 里的 shape 是“符号 + 空格 + 名字”，例如 "★ 五角星" → ["★", "五角星"]
function splitShape(text) {
  const [symbol, ...rest] = text.split(" ");
  return { symbol, name: rest.join(" ") };
}

export function createContributeMode({ container, spells, recognize, onEnter, onExit, onStartDrawing }) {
  // ===== 画面上的元素 =====

  // 右下角的按钮（左下角是咒语书）
  const button = document.createElement("button");
  button.id = "contributeBtn";
  button.title = "贡献模式 Contribute";
  button.innerHTML = `<span class="contrib-icon">🤝</span><span class="book-label">贡献模式<br>Contribute</span>`;
  container.appendChild(button);

  // 右边的教学面板
  const panel = document.createElement("aside");
  panel.id = "contribPanel";
  panel.hidden = true;
  container.appendChild(panel);

  // 同意书（盖在画面正中间）
  const consent = document.createElement("div");
  consent.id = "contribConsent";
  consent.hidden = true;
  consent.innerHTML = `
    <div class="consent-card" role="dialog" aria-modal="true">
      <h2>🤝 加入贡献模式<span class="en">Join Contribute Mode</span></h2>
      ${bi("你画的形状会帮助游戏认得更多人的笔迹。", "Your drawings help the game recognise more people's handwriting.", "consent-lead")}
      <ul>
        <li>${bi("✅ <b>我们会收集：</b>你画的轨迹座标（一串 x、y 数字）、系统当下的识别结果，以及一个随机产生的匿名编号",
                 "We collect: the path coordinates of your drawing (a list of x, y numbers), the recognition result at that moment, and a randomly generated anonymous ID")}</li>
        <li>${bi("❌ <b>我们不会收集：</b>摄像头画面、照片、你的名字或任何个人资料",
                 "We never collect: camera video, photos, your name or any personal information")}</li>
        <li>${bi("👀 每一笔都会经过人工审核，通过后才会加进所有玩家的游戏，也会用在这个项目的研究分析",
                 "Every stroke is reviewed by a person before it's added to everyone's game, and approved strokes are also used for this project's research analysis")}</li>
      </ul>
      <div class="contrib-actions">
        <button data-act="decline" class="ghost">${bi("取消", "Cancel")}</button>
        <button data-act="agree" class="primary">${bi("我同意，开始", "I agree — start")}</button>
      </div>
    </div>`;
  container.appendChild(consent);

  // ===== 状态 =====
  let active = false;
  let step = null; // 现在在哪一步（STEPS 的 id）
  let shape = null; // 选了哪个形状
  let counts = {}; // 每个形状已经交了几个
  let offline = false; // 是不是连不上服务器
  let pending = null; // { points, result }：等待检查的那一笔
  let uploadState = null; // null / "uploading" / "ok" / "limit" / "error"
  let poseSince = 0; // 第 ① 步：从什么时候开始看到“只伸食指”
  let poseDone = false;
  let demoStart = performance.now();

  const demoPaths = {};
  for (const key of Object.keys(spells)) demoPaths[key] = toPixels(DEMO_PATHS[key], DEMO_SIZE);

  // ===== 进入 / 离开 =====
  button.addEventListener("click", () => {
    if (active) return exit();
    if (load(CONSENT_KEY, false)) enter();
    else consent.hidden = false;
  });

  consent.addEventListener("click", (event) => {
    const act = event.target.closest("button")?.dataset.act;
    if (act === "agree") {
      save(CONSENT_KEY, true);
      consent.hidden = true;
      enter();
    } else if (act === "decline") {
      consent.hidden = true;
    }
  });

  async function enter() {
    active = true;
    container.classList.add("contributing"); // CSS 会把咒语书藏起来，画面比较干净
    button.classList.add("open");
    panel.hidden = false;
    onEnter?.();
    goTo("pose");
    // 在背景问服务器“我交了几个”，问到了再更新卡片上的数字
    counts = load(COUNTS_KEY, {});
    const fromServer = await fetchMyCounts();
    offline = fromServer === null;
    if (!offline) {
      counts = fromServer;
      save(COUNTS_KEY, counts);
    }
    if (step === "pick") render();
  }

  function exit() {
    active = false;
    step = null;
    pending = null;
    container.classList.remove("contributing");
    button.classList.remove("open");
    panel.hidden = true;
    onExit?.();
  }

  function goTo(next) {
    step = next;
    if (next === "pose") {
      poseSince = 0;
      poseDone = false;
    }
    if (next === "demo" || next === "draw") demoStart = performance.now();
    if (next === "draw") {
      pending = null;
      onStartDrawing?.(); // 状态机归零，重新开始一笔
    }
    render();
  }

  // ===== 画出面板 =====
  function render() {
    if (!active) return;
    const index = STEPS.findIndex((s) => s.id === step);
    const bar = STEPS.map(
      (s, i) => `<li class="${i < index ? "done" : i === index ? "now" : ""}">
          <span class="dot">${i < index ? "✓" : i + 1}</span>
          <span class="lbl">${s.zh}<span class="en">${s.en}</span></span>
        </li>`
    ).join("");

    panel.innerHTML = `
      <header>
        <div class="title">🤝 贡献模式<span class="en">Contribute Mode</span></div>
        <button class="close" data-act="exit" title="离开 Exit">✕</button>
      </header>
      <ol class="steps">${bar}</ol>
      <section class="body">${bodyHtml()}</section>`;

    // 第 ③、④、⑤ 步有示范画布，要设定好大小
    for (const canvas of panel.querySelectorAll("canvas.contrib-demo")) setupCanvas(canvas);
    if (step === "review") drawReviewThumbs();
  }

  const stepTitle = (n, zh, en) => `<h3>第 ${n} 步：${zh}<span class="en">Step ${n}: ${en}</span></h3>`;

  function bodyHtml() {
    const s = shape ? spells[shape] : null;
    const shapeLabel = s ? `${s.shape}` : "";
    const shapeLabelEn = s ? s.shapeEn : "";

    switch (step) {
      case "pose":
        return `
          ${stepTitle(1, "只伸出食指", "Raise only your index finger")}
          <div class="pose-icon ${poseDone ? "ok" : ""}">☝️</div>
          ${bi("把手举到镜头前，只伸出<b>食指</b>，其他手指收起来。这就是你的“魔杖”。",
               "Hold your hand up to the camera with only your <b>index finger</b> raised and the other fingers folded. This is your “wand”.")}
          <div class="pose-check ${poseDone ? "ok" : ""}">
            ${poseDone ? bi("✔ 看到了！", "Got it!") : bi("⏳ 等待中…", "Waiting…")}
          </div>`;

      case "pick": {
        const cards = Object.keys(spells)
          .map((key) => {
            const { symbol, name } = splitShape(spells[key].shape);
            const n = counts[key] || 0;
            const full = n >= MAX_PER_SHAPE;
            return `<button class="shape-card ${full ? "full" : ""}" data-shape="${key}" ${full ? "disabled" : ""}>
                <span class="sym">${symbol}</span>
                <span class="nm">${name}</span>
                <span class="en">${spells[key].shapeEn}</span>
                <span class="cnt">${full ? "✓ 已完成 Done" : `${n} / ${MAX_PER_SHAPE}`}</span>
              </button>`;
          })
          .join("");
        const allDone = Object.keys(spells).every((key) => (counts[key] || 0) >= MAX_PER_SHAPE);
        return `
          ${stepTitle(2, "选一个形状", "Choose a shape")}
          ${bi(`每个形状最多可以贡献 ${MAX_PER_SHAPE} 个，数字是你已经交了几个。`,
               `You can contribute up to ${MAX_PER_SHAPE} of each shape. The number shows how many you've sent.`, "hint")}
          ${offline ? bi("⚠️ 暂时连不上服务器，上传可能会失败。", "Can't reach the server right now — uploads may fail.", "warn") : ""}
          ${allDone ? bi("🎉 你已经把 9 个形状都交满了，谢谢你！", "🎉 You've completed all 9 shapes — thank you!", "good") : ""}
          <div class="shape-grid">${cards}</div>`;
      }

      case "demo":
        return `
          ${stepTitle(3, `看示范：${shapeLabel}`, `Watch: ${shapeLabelEn}`)}
          <canvas class="contrib-demo"></canvas>
          ${bi(DETAILS[shape].tip, DETAILS[shape].tipEn, "tip")}
          ${bi("🟢 绿点是起点。照着动画的方向画，系统才认得出来。",
               "🟢 The green dot is where you start. Follow the same direction so the game can recognise it.", "hint")}
          <div class="contrib-actions">
            <button data-act="pick" class="ghost">${bi("← 换形状", "Change shape")}</button>
            <button data-act="draw" class="primary">${bi("我准备好了 →", "I'm ready")}</button>
          </div>`;

      case "draw":
        return `
          ${stepTitle(4, `画一个 ${shapeLabel}`, `Draw a ${shapeLabelEn}`)}
          <ol class="howto">
            <li>${bi("只伸出食指，金色光点出现就开始画", "Raise only your index finger — start when the golden dot appears")}</li>
            <li>${bi("照着示范，一笔画完", "Follow the demo and draw it in one stroke")}</li>
            <li>${bi("画完后<b>停住不动</b>，白色圈圈画满就完成", "When you finish, <b>hold still</b> until the white ring fills up")}</li>
          </ol>
          <canvas class="contrib-demo small"></canvas>
          <div class="contrib-actions">
            <button data-act="demo" class="ghost">${bi("← 再看一次示范", "Watch the demo again")}</button>
          </div>`;

      case "review":
        return `
          ${stepTitle(5, "检查你画的", "Check your drawing")}
          <div class="compare">
            <figure><canvas class="thumb" data-thumb="demo"></canvas><figcaption>${bi("示范", "Demo")}</figcaption></figure>
            <figure><canvas class="thumb" data-thumb="mine"></canvas><figcaption>${bi("你画的", "Yours")}</figcaption></figure>
          </div>
          ${verdictHtml()}
          ${bi("只会上传轨迹座标，不会上传摄像头画面。", "Only the path coordinates are uploaded — never the camera image.", "hint")}
          <div class="contrib-actions">
            <button data-act="redraw" class="ghost">${bi("🔄 重画", "Redraw")}<kbd>Backspace</kbd></button>
            <button data-act="upload" class="primary">${bi("✅ 上传", "Upload")}<kbd>Enter</kbd></button>
          </div>`;

      case "upload":
        return uploadHtml(shapeLabel, shapeLabelEn);
    }
    return "";
  }

  // ⑤ 系统认为这是什么？（玩家可以参考，但最后还是由玩家决定要不要上传）
  function verdictHtml() {
    const r = pending?.result;
    if (!r) return bi("（还没有可以比对的模板）", "(No templates to compare with yet)", "hint");
    const guess = spells[r.name];
    const percent = Math.round(r.score * 100);
    if (r.name === shape && r.score >= 0.75) {
      return bi(`🎯 系统认为这是 <b>${guess.shape}</b>，相似度 <b>${percent}%</b>。画得很好！`,
                `🎯 The game thinks this is a <b>${guess.shapeEn}</b> — <b>${percent}%</b> similar. Nicely done!`, "verdict good");
    }
    if (r.name === shape) {
      return bi(`🤔 系统认得出是 <b>${guess.shape}</b>，但相似度只有 <b>${percent}%</b>。可以上传，也可以照示范再画一次。`,
                `🤔 The game recognises a <b>${guess.shapeEn}</b>, but it's only <b>${percent}%</b> similar. You can upload it, or try again following the demo.`, "verdict mid");
    }
    return bi(`⚠️ 系统认为这比较像 <b>${guess.shape}</b>（${percent}%），和你选的 <b>${spells[shape].shape}</b> 不一样。建议重画。`,
              `⚠️ The game thinks this looks more like a <b>${guess.shapeEn}</b> (${percent}%), not the <b>${spells[shape].shapeEn}</b> you chose. We suggest redrawing.`, "verdict bad");
  }

  function uploadHtml(label, labelEn) {
    const n = counts[shape] || 0;
    const canMore = n < MAX_PER_SHAPE;
    const title = stepTitle(6, "上传", "Upload");
    if (uploadState === "uploading") {
      return `${title}<div class="big-state">⏳</div>${bi("上传中…", "Uploading…")}`;
    }
    if (uploadState === "ok") {
      return `${title}
        <div class="big-state">✅</div>
        ${bi(`上传成功！${label}：<b>${n} / ${MAX_PER_SHAPE}</b>`, `Uploaded! ${labelEn}: <b>${n} / ${MAX_PER_SHAPE}</b>`, "good")}
        ${bi("审核通过后，所有玩家的游戏都会学到你的这一笔。", "Once approved, everyone's game will learn from your stroke.", "hint")}
        <div class="contrib-actions">
          ${canMore ? `<button data-act="draw" class="primary">${bi("再画一个", "Draw another")}</button>` : ""}
          <button data-act="pick" class="${canMore ? "ghost" : "primary"}">${bi("换一个形状", "Choose another shape")}</button>
          <button data-act="exit" class="ghost">${bi("完成", "Finish")}</button>
        </div>`;
    }
    if (uploadState === "limit") {
      return `${title}
        <div class="big-state">🙌</div>
        ${bi(`${label} 你已经交满 ${MAX_PER_SHAPE} 个了，谢谢！`, `You've already sent ${MAX_PER_SHAPE} ${labelEn} drawings — thank you!`)}
        <div class="contrib-actions">
          <button data-act="pick" class="primary">${bi("换一个形状", "Choose another shape")}</button>
        </div>`;
    }
    return `${title}
      <div class="big-state">❌</div>
      ${bi("上传失败，请检查网络后再试一次。", "Upload failed — please check your connection and try again.", "warn")}
      <div class="contrib-actions">
        <button data-act="redraw" class="ghost">${bi("重画", "Redraw")}</button>
        <button data-act="retry" class="primary">${bi("再试一次", "Try again")}</button>
      </div>`;
  }

  // ===== 按钮 =====
  panel.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.shape) {
      shape = target.dataset.shape;
      return goTo("demo");
    }
    switch (target.dataset.act) {
      case "exit":
        return exit();
      case "pick":
        return goTo("pick");
      case "demo":
        return goTo("demo");
      case "draw":
      case "redraw":
        return goTo("draw");
      case "upload":
      case "retry":
        return upload();
    }
  });

  // 键盘：第 ⑤ 步 Enter = 上传，Backspace = 重画；Esc = 关掉同意书
  document.addEventListener("keydown", (event) => {
    if (!consent.hidden && event.key === "Escape") consent.hidden = true;
    if (!active || step !== "review") return;
    if (event.key === "Enter") {
      event.preventDefault();
      upload();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      goTo("draw");
    }
  });

  async function upload() {
    if (!pending || uploadState === "uploading") return;
    step = "upload";
    uploadState = "uploading";
    render();
    const outcome = await submitTemplate({
      shape,
      points: pending.points,
      recognizedAs: pending.result?.name,
      score: pending.result?.score,
    });
    if (!active) return; // 上传途中玩家已经离开了
    if (outcome === "ok") {
      counts[shape] = (counts[shape] || 0) + 1;
      save(COUNTS_KEY, counts);
      pending = null;
    } else if (outcome === "limit") {
      counts[shape] = MAX_PER_SHAPE;
      save(COUNTS_KEY, counts);
      pending = null;
    }
    uploadState = outcome;
    render();
  }

  // ===== 示范动画 =====
  const dpr = window.devicePixelRatio || 1;
  function setupCanvas(canvas) {
    const size = canvas.classList.contains("small") ? 110 : DEMO_SIZE;
    canvas.width = DEMO_SIZE * dpr;
    canvas.height = DEMO_SIZE * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function animate(now) {
    if (active && shape && (step === "demo" || step === "draw")) {
      const t = ((now - demoStart) / 1000) % CYCLE;
      for (const canvas of panel.querySelectorAll("canvas.contrib-demo")) {
        drawDemo(canvas.getContext("2d"), demoPaths[shape], DETAILS[shape].ink, t);
      }
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // ⑤ 并排的两张小图：示范 vs 你画的
  function drawReviewThumbs() {
    const demoCanvas = panel.querySelector('[data-thumb="demo"]');
    const mineCanvas = panel.querySelector('[data-thumb="mine"]');
    // 示范：本来就是画面座标
    drawThumb(demoCanvas, demoPaths[shape].points, DETAILS[shape].ink, false);
    // 你画的：摄像头画面是镜像显示的，所以 x 要左右翻转，看起来才会跟你画的方向一样
    drawThumb(mineCanvas, pending.points, "#f9a825", true);
  }

  function drawThumb(canvas, points, color, mirror) {
    const size = 100;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (points.length < 2) return;

    // 把整笔缩放到小图里（保持长宽比例，置中）
    const xs = points.map((p) => (mirror ? -p.x : p.x));
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(...xs) - minX || 1;
    const h = Math.max(...ys) - minY || 1;
    const pad = 14;
    const scale = (size - pad * 2) / Math.max(w, h);
    const ox = (size - w * scale) / 2;
    const oy = (size - h * scale) / 2;
    const at = (i) => ({ x: ox + (xs[i] - minX) * scale, y: oy + (ys[i] - minY) * scale });

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((_, i) => {
      const p = at(i);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    // 起点（绿点）
    const start = at(0);
    ctx.fillStyle = "#2e7d32";
    ctx.beginPath();
    ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ===== 给 main.js 用的 =====
  return {
    get active() {
      return active;
    },
    // 只有第 ④ 步才让状态机跑
    get wantsDrawing() {
      return active && step === "draw";
    },
    // 第 ⑤、⑥ 步：画面上一直显示刚画的那一笔
    get pendingPoints() {
      return active && pending ? pending.points : null;
    },
    get shape() {
      return shape;
    },
    // 画面上方的提示
    get status() {
      const s = shape ? spells[shape] : null;
      switch (step) {
        case "pose":
          return ["🤝 贡献模式：只伸出食指", "Contribute: raise only your index finger"];
        case "pick":
          return ["🤝 贡献模式：在右边选一个形状", "Contribute: choose a shape on the right"];
        case "demo":
          return ["🤝 贡献模式：先看右边的示范", "Contribute: watch the demo on the right"];
        case "review":
          return ["🤝 检查你画的这一笔", "Check your drawing"];
        case "upload":
          return ["🤝 上传", "Upload"];
        default:
          return [`🤝 画一个 ${s?.shape ?? ""}（只伸食指开始）`, `Draw a ${s?.shapeEn ?? ""} (raise only your index finger to start)`];
      }
    },

    // 每一帧都会被叫：第 ① 步在这里检查手势
    onFrame({ now, pointing }) {
      if (!active || step !== "pose" || poseDone) return;
      if (pointing) {
        poseSince ||= now;
        if (now - poseSince >= POSE_HOLD_MS) {
          poseDone = true;
          render();
          setTimeout(() => {
            if (active && step === "pose") goTo("pick");
          }, 800); // 让玩家看到打勾，再自动进到下一步
        }
      } else {
        poseSince = 0;
      }
    },

    // 第 ④ 步画完一笔：交给这里，进入第 ⑤ 步
    handleStroke(stroke) {
      const result = recognize(stroke);
      pending = { points: stroke.map((p) => ({ x: p.x, y: p.y })), result };
      uploadState = null;
      goTo("review");
    },
  };
}
