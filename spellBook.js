// 📖 咒语书：告诉玩家“有哪些魔法、要怎么画”
//
// 来自 Nielsen 原则 #6：识别优于回忆 (Recognition rather than Recall)
//   生活例子：餐厅菜单有照片，客人不用背菜名，看一眼就会点
//
// 两层：
//   ① 目录：每页 3 列 × 3 行 = 9 格，一格一个咒语（左页放满了才排到右页）
//          还没有咒语的位置显示虚线空格，像一本“收集册”
//   ② 详情：左页 = 咒语是什么、什么形状、描述；右页 = 示范动画教你怎么画
//   点格子 → 往前翻页到详情；点“← 目录” → 往回翻页
//
// 其他：
//   点左下角的书 → 打开 / 合上（每次打开都从目录开始）
//   施法成功 → 书发出那个魔法颜色的光（在目录页的话，那一格也会亮）

// 示范用的路径（0 到 1 的比例座标，左上角是 (0, 0)）
// 画法参考你录的模板：三角形从顶点开始、闪电从右上开始往下折 3 段
const DEMO_PATHS = {
  triangle: [
    [0.5, 0.08],
    [0.08, 0.9],
    [0.92, 0.9],
    [0.5, 0.08],
  ],
  // 圆形：从最上面开始，顺时针绕一圈（用 40 个点组成）
  circle: Array.from({ length: 41 }, (_, i) => {
    const a = -Math.PI / 2 + (i / 40) * Math.PI * 2;
    return [0.5 + 0.42 * Math.cos(a), 0.5 + 0.42 * Math.sin(a)];
  }),
  lightning: [
    [0.72, 0.05],
    [0.3, 0.45],
    [0.7, 0.52],
    [0.25, 0.95],
  ],
};

// 每个咒语的详细资料
//   ink  = 书页上示范线条的颜色（纸是浅色的，所以用深一点的颜色）
//   glow = 施法成功时，书发光的颜色
const DETAILS = {
  triangle: {
    ink: "#d84315",
    glow: "rgba(255, 140, 40, 0.9)",
    description: "凝聚火焰成一颗火球，往前方掷出，命中时猛烈爆炸。",
    descriptionEn: "Gathers flames into a fireball and hurls it forward. It bursts on impact.",
    tip: "从上面的角开始，一笔画出三个尖角",
    tipEn: "Start at the top corner and draw three sharp corners in one stroke",
  },
  circle: {
    ink: "#1e88e5",
    glow: "rgba(100, 180, 255, 0.9)",
    description: "召唤一圈冰蓝色的光环，它会跟着你的手移动，照亮四周。",
    descriptionEn: "Summons an ice-blue ring of light that follows your hand.",
    tip: "从边上开始绕一圈，顺时针或逆时针都可以",
    tipEn: "Start on the edge and go all the way around (either direction)",
  },
  lightning: {
    ink: "#f9a825",
    glow: "rgba(255, 235, 120, 0.9)",
    description: "从指尖召唤一道雷电劈向天空，伴随强烈的闪光与震动。",
    descriptionEn: "Calls a bolt of lightning from your fingertip into the sky, with a flash and a shake.",
    tip: "从右上开始，往下折三段",
    tipEn: "Start at the top right and zigzag down in three strokes",
  },
};

const GRID_COLUMNS = 3; // 每页几列
const GRID_ROWS = 3; // 每页几行
const CELLS_PER_PAGE = GRID_COLUMNS * GRID_ROWS; // 每页几格

// 动画时间（秒）：画 1.2 秒 → 停 0.6 秒 → 淡出 0.3 秒 → 下一轮
const DRAW_TIME = 1.2;
const HOLD_TIME = 0.6;
const FADE_TIME = 0.3;
const CYCLE = DRAW_TIME + HOLD_TIME + FADE_TIME;

const DEMO_SIZE = 160; // 示范画布的大小（像素）

// 书的图案（原创：紫色封面、金色边框、星星）
const BOOK_SVG = `
  <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
    <defs>
      <linearGradient id="bookCover" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7b3399" />
        <stop offset="1" stop-color="#3a1550" />
      </linearGradient>
    </defs>
    <rect x="14" y="10" width="38" height="46" rx="3" fill="#f3e7cc" />
    <rect x="10" y="6" width="40" height="48" rx="4" fill="url(#bookCover)" stroke="#d4a64a" stroke-width="1.5" />
    <rect x="10" y="6" width="7" height="48" rx="3" fill="#4a1f5c" />
    <circle cx="33" cy="28" r="10" fill="none" stroke="#f5d27a" stroke-width="1.5" />
    <path d="M33 19 L35.5 26 L42 28 L35.5 30 L33 37 L30.5 30 L24 28 L30.5 26 Z" fill="#f5d27a" />
  </svg>`;

// 建立咒语书，放进 container 里
// spells = main.js 的咒语表 SPELLS（单一来源：改名字只要改一个地方）
export function createSpellBook(container, spells) {
  // ----- 左下角的书（开关） -----
  const button = document.createElement("button");
  button.id = "spellBookBtn";
  button.title = "咒语书 Spellbook";
  button.innerHTML = `${BOOK_SVG}<span class="book-label">咒语书<br>Spellbook</span>`;
  container.appendChild(button);

  // ----- 打开后的书本：左右两页 -----
  const book = document.createElement("div");
  book.id = "spellBook";
  book.innerHTML = `
    <div class="book-page side-left" data-page="left"></div>
    <div class="book-page side-right" data-page="right"></div>`;
  container.appendChild(book);

  const leftPage = book.querySelector('[data-page="left"]');
  const rightPage = book.querySelector('[data-page="right"]');

  // ===== 每一页的内容（HTML） =====

  // 目录页：把咒语切成每页 9 个，排成 3 × 3 的格子
  const keys = Object.keys(spells);
  function indexPageHtml(pageNumber) {
    const pageKeys = keys.slice(pageNumber * CELLS_PER_PAGE, (pageNumber + 1) * CELLS_PER_PAGE);
    const header =
      pageNumber === 0
        ? `<div class="book-title">📖 咒语书 <span class="book-en">Spellbook</span></div>`
        : `<div class="book-title">&nbsp;</div>`;

    const slots = [];
    for (let i = 0; i < CELLS_PER_PAGE; i++) {
      const key = pageKeys[i];
      if (key) {
        // SPELLS 里的名字是“图标 + 空格 + 名字”，例如 "🔥 火焰弹"，拆成两半
        const [icon, ...name] = spells[key].spell.split(" ");
        slots.push(`
          <button class="spell-cell" data-shape="${key}" title="${spells[key].spell} ${spells[key].spellEn}">
            <span class="cell-icon">${icon}</span>
            <span class="cell-name">${name.join(" ")}</span>
            <span class="cell-en">${spells[key].spellEn}</span>
          </button>`);
      } else {
        slots.push(`<div class="empty-slot"></div>`); // 还没有咒语的位置
      }
    }

    // 最后一页的空位很多时，在下面提示“还有更多”
    const note =
      pageKeys.length < CELLS_PER_PAGE
        ? `<div class="coming-note">✨ 更多咒语，敬请期待 · More spells coming soon</div>`
        : "";
    return `${header}<div class="cell-grid">${slots.join("")}</div>${pageNumber === 1 ? note : ""}`;
  }

  // 详情页左边：是什么、什么形状、描述
  function detailLeftHtml(key) {
    const s = spells[key];
    const d = DETAILS[key];
    return `
      <div class="detail-title">${s.spell}</div>
      <div class="book-en detail-title-en">${s.spellEn}</div>
      <div class="detail-shape">形状 Shape：<b>${s.shape}</b> <span class="book-en-inline">${s.shapeEn}</span></div>
      <p class="detail-desc">${d.description}</p>
      <p class="detail-desc book-en">${d.descriptionEn}</p>
      <button class="book-back">← 目录 Contents</button>`;
  }

  // 详情页右边：示范动画 + 怎么画
  function detailRightHtml(key) {
    const d = DETAILS[key];
    return `
      <div class="detail-howto">✍️ 怎么画 <span class="book-en-inline">How to draw</span></div>
      <canvas class="book-demo"></canvas>
      <div class="detail-tip">${d.tip}</div>
      <div class="book-en">${d.tipEn}</div>`;
  }

  // ===== 示范动画 =====
  const dpr = window.devicePixelRatio || 1; // 高解析度屏幕要画得更细，才不会糊
  const paths = {};
  for (const key of keys) paths[key] = toPixels(DEMO_PATHS[key], DEMO_SIZE);

  let demo = null; // { ctx, key, start }：目前右页上的示范（没有就是 null）

  // 右页的内容换掉之后，如果里面有示范画布，就把它准备好
  function setupDemo(key) {
    const canvas = rightPage.querySelector(".book-demo");
    if (!canvas) {
      demo = null;
      return;
    }
    canvas.width = DEMO_SIZE * dpr;
    canvas.height = DEMO_SIZE * dpr;
    canvas.style.width = `${DEMO_SIZE}px`;
    canvas.style.height = `${DEMO_SIZE}px`;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    demo = { ctx, key, start: performance.now() };
  }

  function animate(now) {
    // 书合上、或右页不是示范页时，不画（省电）
    if (demo && book.classList.contains("open")) {
      const t = ((now - demo.start) / 1000) % CYCLE;
      drawDemo(demo.ctx, paths[demo.key], DETAILS[demo.key].ink, t);
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // ===== 📖 翻页动画 =====
  //
  // 做法：做一张“纸”，正面印“被翻走的那一页”、背面印“翻过来的新页”，
  //       以书脊为轴转 180 度。
  //
  //   往前翻（目录 → 详情）：纸盖在右页上，往左翻
  //     正面 = 旧的右页，背面 = 新的左页
  //   往回翻（详情 → 目录）：纸盖在左页上，往右翻
  //     正面 = 旧的左页，背面 = 新的右页
  //
  // 被纸盖住的那一页，一开始就先换成新内容（反正看不到）；
  // 另一页等纸翻过去、把它盖住之后再换。
  let flipping = false;

  function flip(direction, newLeftHtml, newRightHtml, demoKey) {
    if (flipping) return;
    flipping = true;

    const sheet = document.createElement("div");
    sheet.className = `flip-sheet ${direction}`;
    const front = document.createElement("div");
    const back = document.createElement("div");

    if (direction === "forward") {
      front.className = "flip-face flip-front book-page side-right";
      back.className = "flip-face flip-back book-page side-left";
      front.innerHTML = rightPage.innerHTML;
      back.innerHTML = newLeftHtml;
      rightPage.innerHTML = newRightHtml; // 被纸盖住，先换
      setupDemo(demoKey);
    } else {
      front.className = "flip-face flip-front book-page side-left";
      back.className = "flip-face flip-back book-page side-right";
      front.innerHTML = leftPage.innerHTML;
      back.innerHTML = newRightHtml;
      leftPage.innerHTML = newLeftHtml; // 被纸盖住，先换
    }

    sheet.append(front, back);
    book.appendChild(sheet);

    sheet.addEventListener(
      "animationend",
      () => {
        // 纸翻过去了，换掉另一页，再把纸拿掉
        if (direction === "forward") {
          leftPage.innerHTML = newLeftHtml;
        } else {
          rightPage.innerHTML = newRightHtml;
          setupDemo(demoKey);
        }
        sheet.remove();
        flipping = false;
      },
      { once: true }
    );
  }

  function showIndex() {
    leftPage.innerHTML = indexPageHtml(0);
    rightPage.innerHTML = indexPageHtml(1);
    setupDemo(null);
  }

  // ===== 点击 =====
  // 用“事件委派”：只在整本书上放一个监听器，再看点到的是什么
  // （页面内容会一直换，这样就不用每次重新绑定）
  book.addEventListener("click", (event) => {
    const cell = event.target.closest(".spell-cell");
    const backButton = event.target.closest(".book-back");

    if (cell && !cell.closest(".flip-sheet")) {
      const key = cell.dataset.shape;
      flip("forward", detailLeftHtml(key), detailRightHtml(key), key);
    } else if (backButton && !backButton.closest(".flip-sheet")) {
      flip("backward", indexPageHtml(0), indexPageHtml(1), null);
    }
    // 失去焦点：之后按 Enter 保留模板时，才不会又“按”到这里
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

  // 点书：打开 / 合上（每次打开都从目录开始）
  button.addEventListener("click", () => {
    const open = !book.classList.contains("open");
    if (open) showIndex();
    book.classList.toggle("open", open);
    button.classList.toggle("open", open);
    button.blur();
  });

  showIndex();

  // ----- 施法成功：书发光（在目录页的话，那一格也亮一下） -----
  return {
    highlight(key) {
      const d = DETAILS[key];
      if (!d) return;
      button.style.setProperty("--glow", d.glow);
      restartAnimation(button, "glow");

      const cell = book.querySelector(`[data-page] .spell-cell[data-shape="${key}"]`);
      if (cell) {
        cell.style.setProperty("--glow", d.glow);
        restartAnimation(cell, "lit");
      }
    },
  };
}

// 小技巧：先移除 class，强迫浏览器重新计算，再加回去 → CSS 动画会从头播一次
function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

// 把 0 到 1 的比例座标换成画布上的像素，并算好每一段的累积长度
function toPixels(path, size) {
  const pad = 14;
  const inner = size - pad * 2;
  const points = path.map(([x, y]) => ({ x: pad + x * inner, y: pad + y * inner }));

  let total = 0;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(total);
  }
  return { points, lengths, total };
}

// 画一格示范动画。time = 这一轮已经播了几秒
function drawDemo(ctx, path, color, time) {
  ctx.clearRect(0, 0, DEMO_SIZE, DEMO_SIZE);

  // 淡淡的完整形状（让玩家先看到全貌）
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  strokeUntil(ctx, path, path.total);
  ctx.restore();

  // 画到哪里了：0 → 1
  const progress = Math.min(1, time / DRAW_TIME);
  const fade = time > DRAW_TIME + HOLD_TIME ? 1 - (time - DRAW_TIME - HOLD_TIME) / FADE_TIME : 1;

  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokeUntil(ctx, path, progress * path.total);

  // 起点（绿点）：告诉玩家从哪里开始画
  const start = path.points[0];
  ctx.fillStyle = "#2e7d32";
  ctx.beginPath();
  ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
  ctx.fill();

  // 笔尖（模拟魔杖尖）
  if (progress < 1) {
    const head = pointAt(path, progress * path.total);
    ctx.fillStyle = "#4a3420";
    ctx.beginPath();
    ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 沿着路径画到 distance 那么长
function strokeUntil(ctx, path, distance) {
  const { points, lengths } = path;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    if (lengths[i] <= distance) {
      ctx.lineTo(points[i].x, points[i].y);
    } else {
      const head = pointAt(path, distance);
      ctx.lineTo(head.x, head.y);
      break;
    }
  }
  ctx.stroke();
}

// 路径上“走了 distance 那么远”的那一点
function pointAt({ points, lengths }, distance) {
  for (let i = 1; i < points.length; i++) {
    if (lengths[i] >= distance) {
      const segment = lengths[i] - lengths[i - 1] || 1;
      const t = (distance - lengths[i - 1]) / segment;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
  }
  return points[points.length - 1];
}
