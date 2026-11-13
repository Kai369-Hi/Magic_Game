// ✨ 特效引擎 (Effect Engine)
//
// 特效画在独立的一层画布 (#fx) 上，用 requestAnimationFrame 跟着“屏幕”刷新：
//   - 手部追踪：跟着摄像头，每秒约 30 次（每张照片只算一次）
//   - 特效动画：跟着屏幕，每秒 60 到 144 次（动画才会顺）
//
// 每个特效都有同样的三个部分（像一份“合约”）：
//   update(dt) → 往前推进 dt 秒（粒子移动、变老）
//   draw(ctx)  → 画出现在的样子
//   done       → 播完了没有（播完就从列表移除）
//
// 📌 粒子系统 (Particle System)：火焰、烟、火星都是由很多“小点”组成，
//    每个小点有自己的位置、速度、寿命。几百个小点一起动，看起来就像一团火。

// ===== 小工具 =====
const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3); // 一开始快、后来慢
const lerp = (a, b, t) => a + (b - a) * t; // 从 a 走到 b 的 t 比例处

// ===== 特效管理员：负责“谁在播、播完收掉、每一帧叫大家画” =====
export class EffectManager {
  constructor(canvas, shakeTarget) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.shakeTarget = shakeTarget; // 画面震动时要移动的元素
    this.effects = [];
    this.shakeUntil = 0;
    this.shakeStrength = 0;
    this.lastTime = performance.now();

    requestAnimationFrame(this.loop);
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  // 施法成功时叫这个：shape = "triangle" / "circle" / "lightning"
  // info = { bounds: 外框, end: 一笔的最后一点, getTip: 取得目前指尖位置的函数 }
  spawn(shape, info) {
    const common = { ...info, canvas: this.canvas, shake: (s, d) => this.shake(s, d) };
    if (shape === "triangle") this.effects.push(new FireEffect(common));
    else if (shape === "circle") this.effects.push(new LightEffect(common));
    else if (shape === "lightning") this.effects.push(new LightningEffect(common));
    else if (shape === "star") this.effects.push(new StarRushEffect(common)); // 🌟 星光冲击
    else if (shape === "spiral") this.effects.push(new TornadoEffect(common)); // 🌪️ 龙卷风
    else if (shape === "fizzle") this.effects.push(new SmokeEffect(common)); // 💨 施法失败
  }

  // 画面震动：strength 像素，持续 duration 秒
  shake(strength, duration) {
    this.shakeStrength = strength;
    this.shakeUntil = performance.now() + duration * 1000;
  }

  // 箭头函数：this 才会指向 EffectManager（交给 requestAnimationFrame 时不会跑掉）
  loop = (now) => {
    // dt：距离上一帧过了几秒。最多算 0.05 秒，避免切换分页回来时一次跳太多
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const effect of this.effects) {
      effect.update(dt);
      effect.draw(this.ctx);
    }
    this.effects = this.effects.filter((e) => !e.done); // 播完的收掉

    this.applyShake(now);
    requestAnimationFrame(this.loop);
  };

  applyShake(now) {
    if (now < this.shakeUntil) {
      const remaining = (this.shakeUntil - now) / 1000;
      const s = this.shakeStrength * Math.min(1, remaining * 4); // 越到后面越轻
      this.shakeTarget.style.transform = `translate(${rand(-s, s)}px, ${rand(-s, s)}px)`;
    } else {
      this.shakeTarget.style.transform = "";
    }
  }
}

// =====================================================================
// 🔥 火焰弹：① 蓄力 → ② 往前丢 → ③ 爆炸
//    火焰的形状和颜色跟之前一样（同一套粒子），只是“火源”会移动、变大或变小
// =====================================================================

// 🎛️ 丢出去的方式（改这一行就能切换）：
//   "toward" = 往前丢，飞向镜头：越来越大，最后“撞上屏幕”炸开（预设）
//   "away"   = 丢向远方：越来越小，在远处炸开
const THROW_STYLE = "toward";

const CHARGE_TIME = 0.35; // ① 蓄力多久（秒）

class FireEffect {
  constructor({ bounds, canvas, shake }) {
    this.scale = clamp(bounds.size / 200, 0.5, 2.5); // 三角形越大，火越大
    this.shake = shake;

    // 起点：三角形中心（稍微低一点，火才会往上烧）
    this.origin = { x: bounds.centerX, y: bounds.centerY + bounds.size * 0.15 };
    const o = this.origin;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    if (THROW_STYLE === "toward") {
      // 飞向镜头：稍微往画面中间靠（瞄准镜头），大小急速变大
      this.flightTime = 0.45;
      this.endSize = 6;
      this.target = { x: lerp(o.x, cx, 0.5), y: lerp(o.y, cy, 0.5) };
      this.control = { x: lerp(o.x, this.target.x, 0.5), y: Math.min(o.y, this.target.y) - canvas.height * 0.08 };
    } else {
      // 飞向远方：往画面中间偏上（远处的地平线）靠，越来越小
      this.flightTime = 0.7;
      this.endSize = 0.3;
      this.target = { x: lerp(o.x, cx, 0.6), y: lerp(o.y, canvas.height * 0.35, 0.6) };
      this.control = { x: lerp(o.x, this.target.x, 0.5), y: Math.min(o.y, this.target.y) - canvas.height * 0.15 };
    }

    this.pos = { ...o }; // 火球现在的位置
    this.ballSize = 0; // 火球大小比例：蓄力时 0 → 1，飞行时 1 → endSize
    this.age = 0;
    this.particles = [];
    this.spawnCarry = 0; // 累积“还没冒出来的半个粒子”
    this.exploded = false;
    this.explodeAge = 0; // 爆炸后过了几秒（爆炸闪光用）
    this.impactSize = 1; // 爆炸时火球有多大（近 = 炸得大，远 = 炸得小）
    this.impactRadius = 0; // 爆炸那一刻火球光晕的半径（闪光从这么大开始）
    this.canvasW = canvas.width;
    this.canvasH = canvas.height;
  }

  get phase() {
    if (this.age < CHARGE_TIME) return "charge";
    if (this.age < CHARGE_TIME + this.flightTime) return "flight";
    return "explode";
  }

  get done() {
    return this.exploded && this.particles.length === 0;
  }

  update(dt) {
    this.age += dt;

    if (this.phase === "charge") {
      // ① 蓄力：火越烧越旺
      this.ballSize = easeOutCubic(this.age / CHARGE_TIME);
      this.emit(dt, 300, "flame");
    } else if (this.phase === "flight") {
      // ② 飞行：沿着“二次贝兹曲线”移动（t 从 0 到 1）
      const t = (this.age - CHARGE_TIME) / this.flightTime;
      const u = 1 - t;
      const o = this.origin;
      const c = this.control;
      const g = this.target;
      this.pos = {
        x: u * u * o.x + 2 * u * t * c.x + t * t * g.x,
        y: u * u * o.y + 2 * u * t * c.y + t * t * g.y,
      };
      // 远近感：飞向镜头时“越来越快地变大”（t²），飞向远方时“先快后慢地变小”
      const k = THROW_STYLE === "toward" ? t * t : easeOutCubic(t);
      this.ballSize = 1 + (this.endSize - 1) * k;
      this.emit(dt, 360, "trail");
    } else if (!this.exploded) {
      // ③ 爆炸（只做一次）
      this.explode();
    } else {
      this.explodeAge += dt;
    }

    for (const p of this.particles) {
      p.age += dt;
      if (p.kind === "flame" && !p.isSpark) {
        p.vx += (p.anchorX - p.x) * 1.5 * dt; // 往中间收，火才会是“尖尖”的形状
        p.vx += rand(-60, 60) * dt; // 随机晃动 = 火焰闪烁
      } else if (p.kind === "burst") {
        p.vx *= 1 - 2.5 * dt; // 爆炸的碎片慢慢减速
        p.vy *= 1 - 2.5 * dt;
        p.vy -= 40 * this.scale * dt; // 热气往上飘
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  // 以每秒 rate 个（× 大小比例）的速度冒出粒子
  emit(dt, rate, kind) {
    this.spawnCarry += dt * rate * this.scale;
    while (this.spawnCarry >= 1) {
      this.spawnParticle(kind);
      this.spawnCarry--;
    }
  }

  spawnParticle(kind) {
    const isSpark = Math.random() < 0.08; // 8% 是火星
    // 粒子大小跟着火球大小走（但不要大过 2.5 倍，不然尾巴会糊成一片）
    const s = this.scale * clamp(this.ballSize, 0.25, 2.5);

    if (kind === "flame") {
      // 蓄力时的火焰：和原本的火一样往上烧
      this.particles.push({
        kind,
        isSpark,
        anchorX: this.pos.x,
        x: this.pos.x + rand(-45, 45) * s,
        y: this.pos.y + rand(-8, 8) * s,
        vx: rand(-20, 20) * s,
        vy: isSpark ? rand(-320, -200) * s : rand(-240, -120) * s, // 负数 = 往上
        r: isSpark ? rand(1.5, 3) : rand(12, 24) * s,
        life: isSpark ? rand(0.6, 1.0) : rand(0.6, 1.1),
        age: 0,
      });
    } else {
      // 飞行时的尾巴：留在原地慢慢往上飘、比较短命
      this.particles.push({
        kind,
        isSpark,
        x: this.pos.x + rand(-12, 12) * s,
        y: this.pos.y + rand(-12, 12) * s,
        vx: rand(-30, 30) * s,
        vy: rand(-90, -30) * s,
        r: isSpark ? rand(1.5, 3) : rand(10, 20) * s,
        life: rand(0.3, 0.6),
        age: 0,
      });
    }
  }

  explode() {
    this.exploded = true;
    // 近的爆炸比较大、比较震；远的比较小
    this.impactSize = clamp(this.ballSize, 0.4, 3);
    this.impactRadius = 26 * this.scale * this.ballSize * 1.8; // 和火球光晕一样大
    const k = this.impactSize;
    this.shake(THROW_STYLE === "toward" ? 16 : 5, THROW_STYLE === "toward" ? 0.35 : 0.2);

    const count = Math.round(200 * this.scale);
    for (let i = 0; i < count; i++) {
      const isSpark = Math.random() < 0.2;
      const angle = rand(0, Math.PI * 2); // 往四面八方
      const speed = rand(150, 520) * this.scale * Math.sqrt(k);
      this.particles.push({
        kind: "burst",
        isSpark,
        x: this.pos.x,
        y: this.pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: isSpark ? rand(2, 4) * k : rand(14, 28) * this.scale * 0.7 * k,
        life: rand(0.5, 0.9),
        age: 0,
      });
    }
  }

  draw(ctx) {
    ctx.save();
    // "lighter"：重叠的地方颜色相加，变得更亮（发光的感觉）
    ctx.globalCompositeOperation = "lighter";

    for (const p of this.particles) {
      const t = p.age / p.life; // 0（刚出生）到 1（快消失）

      if (p.isSpark) {
        ctx.fillStyle = `rgba(255, 230, 150, ${1 - t})`;
      } else {
        // 色相 50（黄）→ 0（红）；越老越暗、越透明
        const hue = 50 - 50 * t;
        const light = 65 - 25 * t;
        ctx.fillStyle = `hsla(${hue}, 100%, ${light}%, ${0.45 * (1 - t)})`;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 - t * 0.7), 0, Math.PI * 2); // 越往上越小 → 尖尖的火舌
      ctx.fill();
    }

    // 💥 爆炸闪光：从“火球最后的大小”开始，再胀大一倍后消失（0.25 秒）
    //    爆炸那一刻应该是最大的，不能比火球本身还小
    if (this.exploded && this.explodeAge < 0.25) {
      const k = this.explodeAge / 0.25;
      const R = Math.max(this.impactRadius, 30 * this.scale) * (1 + 1.2 * k);
      const flash = ctx.createRadialGradient(this.pos.x, this.pos.y, 0, this.pos.x, this.pos.y, R);
      flash.addColorStop(0, `rgba(255, 255, 230, ${0.9 * (1 - k)})`);
      flash.addColorStop(0.4, `rgba(255, 190, 80, ${0.6 * (1 - k)})`);
      flash.addColorStop(1, "rgba(255, 100, 20, 0)");
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.arc(this.pos.x, this.pos.y, R, 0, Math.PI * 2);
      ctx.fill();
    }

    // 🖥️ 往前丢时：撞上屏幕的瞬间，整个画面闪一下橘光（0.3 秒）
    if (this.exploded && THROW_STYLE === "toward" && this.explodeAge < 0.3) {
      ctx.fillStyle = `rgba(255, 140, 40, ${0.35 * (1 - this.explodeAge / 0.3)})`;
      ctx.fillRect(0, 0, this.canvasW, this.canvasH);
    }

    // 火球的核心：中心白热，往外变黄、变橘、变透明
    if (!this.exploded && this.ballSize > 0) {
      const R = 26 * this.scale * this.ballSize;
      const core = ctx.createRadialGradient(this.pos.x, this.pos.y, 0, this.pos.x, this.pos.y, R * 1.8);
      core.addColorStop(0, "rgba(255, 255, 240, 0.95)");
      core.addColorStop(0.35, "rgba(255, 220, 120, 0.8)");
      core.addColorStop(1, "rgba(255, 120, 30, 0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(this.pos.x, this.pos.y, R * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

// =====================================================================
// ⭕ 光圈（蓝白色）：向外扩散的光环 + 波纹 + 绕圈的光点，并跟着手移动（像照明咒）
// =====================================================================
class LightEffect {
  constructor({ bounds, end, getTip }) {
    this.x = bounds.centerX;
    this.y = bounds.centerY;
    this.maxR = clamp(bounds.size * 0.6, 60, 260);
    this.getTip = getTip;
    // 记住“光圈中心”和“指尖”的相对位置：手移动时，光圈跟着一起平移
    this.offsetX = bounds.centerX - end.x;
    this.offsetY = bounds.centerY - end.y;
    this.age = 0;
    this.duration = 2.2;
    this.waveDelays = [0, 0.12, 0.24]; // 三圈波纹，一圈接一圈
    this.sparkles = Array.from({ length: 24 }, () => ({
      angle: rand(0, Math.PI * 2),
      speed: rand(0.8, 2.0) * (Math.random() < 0.5 ? -1 : 1),
      r: rand(0.6, 1.1),
    }));
  }

  get done() {
    return this.age >= this.duration;
  }

  update(dt) {
    this.age += dt;

    // 跟着手走：每一帧往“目标位置”靠近一点（平滑跟随，不会一下子跳过去）
    const tip = this.getTip();
    if (tip) {
      const k = 1 - Math.exp(-dt * 8);
      this.x += (tip.x + this.offsetX - this.x) * k;
      this.y += (tip.y + this.offsetY - this.y) * k;
    }
  }

  draw(ctx) {
    const fade = this.age > this.duration - 0.6 ? (this.duration - this.age) / 0.6 : 1;
    const grow = easeOutCubic(Math.min(1, this.age / 0.4)); // 0.4 秒内展开
    const R = this.maxR * grow * (1 + 0.04 * Math.sin(this.age * 10)); // 轻轻“呼吸”

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // ① 中间的光晕：中心最亮，往外渐渐透明
    const glow = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, R * 1.3 + 1);
    glow.addColorStop(0, `rgba(235, 248, 255, ${0.55 * fade})`); // 中心：接近白色
    glow.addColorStop(0.5, `rgba(120, 180, 255, ${0.25 * fade})`); // 中间：冰蓝色
    glow.addColorStop(1, "rgba(80, 140, 255, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(this.x, this.y, R * 1.3 + 1, 0, Math.PI * 2);
    ctx.fill();

    // ② 主光环
    ctx.strokeStyle = `rgba(200, 230, 255, ${fade})`;
    ctx.lineWidth = 6;
    ctx.shadowColor = "#64b5f6";
    ctx.shadowBlur = 25;
    ctx.beginPath();
    ctx.arc(this.x, this.y, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ③ 向外扩散的波纹
    for (const delay of this.waveDelays) {
      const a = this.age - delay;
      if (a > 0 && a < 0.8) {
        ctx.strokeStyle = `rgba(170, 210, 255, ${(1 - a / 0.8) * 0.6})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.maxR * (0.5 + a * 2.2), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ④ 绕着光环转的小光点
    ctx.fillStyle = `rgba(230, 245, 255, ${fade})`;
    for (const s of this.sparkles) {
      const angle = s.angle + this.age * s.speed;
      ctx.beginPath();
      ctx.arc(this.x + Math.cos(angle) * R * s.r, this.y + Math.sin(angle) * R * s.r, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

// =====================================================================
// ⚡ 闪电：从指尖往上劈到画面顶端，锯齿 + 分叉，快速闪几下，画面闪白 + 震动
// =====================================================================
class LightningEffect {
  constructor({ bounds, end, canvas, shake }) {
    this.start = { x: end.x, y: end.y }; // 从指尖（一笔的最后一点）出发
    this.end = { x: end.x + rand(-0.12, 0.12) * canvas.width, y: -20 }; // 画面顶端
    this.width = canvas.width;
    this.height = canvas.height;
    this.thickness = clamp(bounds.size / 200, 0.7, 1.8);
    this.age = 0;
    this.duration = 0.7;
    this.nextStrike = 0;
    this.bolts = [];
    shake(14, 0.35);
  }

  get done() {
    return this.age >= this.duration;
  }

  update(dt) {
    this.age += dt;
    // 前 0.45 秒，每 0.09 秒重新生成一次形状 → 看起来像连续劈好几下
    if (this.age >= this.nextStrike && this.age < 0.45) {
      this.bolts = this.makeBolts();
      this.nextStrike += 0.09;
    }
  }

  // 主干 + 2 到 3 条分叉
  makeBolts() {
    const main = jagged(this.start, this.end, distance(this.start, this.end) * 0.18);
    const bolts = [{ points: main, width: 1 }];

    const branchCount = Math.floor(rand(2, 4));
    for (let i = 0; i < branchCount; i++) {
      const from = main[Math.floor(rand(0.25, 0.75) * main.length)];
      const angle = Math.atan2(this.end.y - this.start.y, this.end.x - this.start.x) + rand(0.35, 0.7) * (Math.random() < 0.5 ? -1 : 1);
      const length = distance(this.start, this.end) * rand(0.15, 0.3);
      const to = { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
      bolts.push({ points: jagged(from, to, length * 0.2), width: 0.5 });
    }
    return bolts;
  }

  draw(ctx) {
    const fade = 1 - this.age / this.duration;

    ctx.save();
    // ① 画面闪白：一开始最亮，0.25 秒内消失
    if (this.age < 0.25) {
      ctx.fillStyle = `rgba(255, 255, 255, ${((0.25 - this.age) / 0.25) * 0.55})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // ② 每条闪电画三层：外层光晕（粗、淡蓝）→ 中层 → 核心（细、纯白）
    for (const bolt of this.bolts) {
      const layers = [
        [20, `rgba(140, 170, 255, ${0.3 * fade})`],
        [9, `rgba(200, 220, 255, ${0.6 * fade})`],
        [4, `rgba(255, 255, 255, ${fade})`],
      ];
      for (const [w, color] of layers) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w * bolt.width * this.thickness;
        ctx.beginPath();
        ctx.moveTo(bolt.points[0].x, bolt.points[0].y);
        for (const p of bolt.points) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// =====================================================================
// 💨 施法失败的烟雾：一团灰色粒子，慢慢变大、往上飘散
//    和火焰用同一套“粒子系统”的想法，只是颜色是灰的、比较慢、比较大、比较淡
// =====================================================================
class SmokeEffect {
  constructor({ bounds }) {
    this.x = bounds.centerX;
    this.y = bounds.centerY;
    this.scale = clamp(bounds.size / 200, 0.5, 2);
    this.age = 0;
    this.emitTime = 0.3; // 前 0.3 秒持续冒烟
    this.particles = [];
    this.spawnCarry = 0;
    for (let i = 0; i < 25 * this.scale; i++) this.spawnParticle(); // 一开始先“噗”一下
  }

  get done() {
    return this.age > this.emitTime && this.particles.length === 0;
  }

  spawnParticle() {
    const s = this.scale;
    this.particles.push({
      x: this.x + rand(-30, 30) * s,
      y: this.y + rand(-20, 20) * s,
      vx: rand(-25, 25) * s,
      vy: rand(-70, -30) * s, // 慢慢往上飘
      r: rand(14, 26) * s,
      grow: rand(20, 40) * s, // 每秒变大多少（烟会散开）
      shade: rand(110, 170), // 深浅不同的灰
      life: rand(1.0, 1.6),
      age: 0,
    });
  }

  update(dt) {
    this.age += dt;
    if (this.age < this.emitTime) {
      this.spawnCarry += dt * 80 * this.scale;
      while (this.spawnCarry >= 1) {
        this.spawnParticle();
        this.spawnCarry--;
      }
    }
    for (const p of this.particles) {
      p.age += dt;
      p.vx *= 1 - 0.8 * dt; // 横向慢慢停下来
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.grow * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  draw(ctx) {
    ctx.save();
    // 烟是“遮住”东西的，不是“发光”的，所以不用 lighter
    for (const p of this.particles) {
      const t = p.age / p.life;
      const fadeIn = Math.min(1, p.age * 6); // 刚出现时快速淡入，才不会“啪”一下跳出来
      ctx.fillStyle = `rgba(${p.shade}, ${p.shade}, ${p.shade}, ${0.35 * (1 - t) * fadeIn})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// =====================================================================
// 🌟 星光冲击：大量亮黄色的星星从你画的位置喷出，高速冲向镜头
//    “冲向镜头” = 越飞越快、越飞越大、往四周散开（像开车时迎面而来的雨滴）
// =====================================================================
class StarRushEffect {
  constructor({ bounds, canvas, shake }) {
    this.origin = { x: bounds.centerX, y: bounds.centerY };
    this.scale = clamp(bounds.size / 200, 0.6, 2);
    this.reach = Math.hypot(canvas.width, canvas.height) * 0.55; // 星星最远飞多远（飞出画面）
    this.age = 0;
    this.emitTime = 0.8; // 前 0.8 秒持续喷出星星
    this.stars = [];
    this.spawnCarry = 0;
    this.shake = shake;
    shake(5, 0.6); // 连续的轻微震动：一大群东西冲过来的感觉
  }

  get done() {
    return this.age > this.emitTime && this.stars.length === 0;
  }

  spawnStar() {
    const angle = rand(0, Math.PI * 2); // 往四面八方
    this.stars.push({
      angle,
      offset: rand(0, 25) * this.scale, // 出发点稍微散开
      life: rand(0.45, 0.7), // 多久冲出画面（越短越快）
      age: 0,
      r: rand(5, 9) * this.scale, // 最小时的大小
      spin: rand(-10, 10),
      tilt: rand(0, Math.PI * 2),
    });
  }

  // 星星现在在哪里、多大：t = 0（刚出发）到 1（冲出画面）
  //   距离用 t³：一开始慢、越来越快 → 迎面冲来的速度感
  //   大小用 1 + 5t²：越靠近镜头越大
  starState(s, t) {
    const dist = s.offset + this.reach * t * t * t;
    return {
      x: this.origin.x + Math.cos(s.angle) * dist,
      y: this.origin.y + Math.sin(s.angle) * dist,
      r: s.r * (1 + 5 * t * t),
    };
  }

  update(dt) {
    this.age += dt;
    if (this.age < this.emitTime) {
      this.spawnCarry += dt * 90; // 每秒喷出约 90 颗
      while (this.spawnCarry >= 1) {
        this.spawnStar();
        this.spawnCarry--;
      }
    }
    for (const s of this.stars) s.age += dt;
    this.stars = this.stars.filter((s) => s.age < s.life);
  }

  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // 中心的光：喷发的源头一直亮着
    if (this.age < this.emitTime + 0.2) {
      const fade = this.age < this.emitTime ? 1 : 1 - (this.age - this.emitTime) / 0.2;
      const R = 60 * this.scale;
      const g = ctx.createRadialGradient(this.origin.x, this.origin.y, 0, this.origin.x, this.origin.y, R);
      g.addColorStop(0, `rgba(255, 255, 220, ${0.9 * fade})`);
      g.addColorStop(0.4, `rgba(255, 230, 60, ${0.5 * fade})`);
      g.addColorStop(1, "rgba(255, 200, 0, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.origin.x, this.origin.y, R, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const s of this.stars) {
      const t = s.age / s.life;
      const now = this.starState(s, t);
      const before = this.starState(s, Math.max(0, t - 0.12));

      // ① 速度线：从“刚才的位置”拉到“现在的位置”，越快越长
      //    用渐层：靠近星星那头是亮黄白色，尾巴慢慢变透明
      const trail = ctx.createLinearGradient(before.x, before.y, now.x, now.y);
      trail.addColorStop(0, "rgba(255, 230, 80, 0)");
      trail.addColorStop(1, "rgba(255, 245, 160, 0.9)");
      ctx.strokeStyle = trail;
      ctx.lineWidth = now.r * 0.7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(before.x, before.y);
      ctx.lineTo(now.x, now.y);
      ctx.stroke();

      // ② 星星本体：三层叠起来 → 外层光晕（大、淡）、亮黄色本体、接近白色的中心
      //    （不用 shadowBlur：它很耗效能，几十颗星星一起用会卡）
      const angle = s.tilt + s.spin * s.age;
      ctx.fillStyle = "rgba(255, 220, 40, 0.35)";
      drawStarShape(ctx, now.x, now.y, now.r * 1.7, angle);
      ctx.fillStyle = "rgba(255, 235, 59, 1)";
      drawStarShape(ctx, now.x, now.y, now.r, angle);
      ctx.fillStyle = "rgba(255, 255, 220, 0.9)";
      drawStarShape(ctx, now.x, now.y, now.r * 0.5, angle);
    }
    ctx.restore();
  }
}

// 画一颗五角星：外圈 5 个尖角、内圈 5 个凹角，交替连起来
function drawStarShape(ctx, x, y, r, angle) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const a = angle - Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
  }
  ctx.closePath();
  ctx.fill();
}

// =====================================================================
// 🌪️ 龙卷风：上宽下窄的发光漏斗，一圈圈霓虹蓝的光带螺旋往上转，
//    里面有闪电劈来劈去，碎石被卷起来绕着飞，底部发出白蓝色的光
//
//    “假 3D”：
//      - 圆圈压扁成椭圆 → 像从侧面看
//      - 转到后半圈的东西比较淡，前半圈的比较亮
// =====================================================================
class TornadoEffect {
  constructor({ bounds, canvas, shake }) {
    this.homeX = bounds.centerX; // 出发的位置（左右来回移动的中心）
    this.baseY = Math.min(canvas.height - 20, bounds.centerY + bounds.size * 0.6); // 漏斗底部
    this.height = clamp(bounds.size * 2.6, 260, canvas.height * 0.9);
    this.topRadius = clamp(bounds.size * 0.8, 90, 280); // 顶部有多宽
    this.age = 0;
    this.duration = 4.0;
    shake(4, 3.6); // 持续的低沉震动

    // ↔️ 左右来回移动：最多移动画面宽度的 22%，但离边缘近的话就移少一点，不要跑出画面
    const margin = this.topRadius * 0.5;
    this.travel = Math.max(60, Math.min(canvas.width * 0.22, this.homeX - margin, canvas.width - this.homeX - margin));
    this.travelSpeed = 2.4; // 来回的速度（越大越快）

    // 光带：22 条螺旋，每条的起始角度、粗细、亮度都不一样
    this.bands = Array.from({ length: 22 }, () => ({
      phase: rand(0, Math.PI * 2),
      twist: rand(5, 8), // 从下到上绕几弧度（越大绕越多圈）
      speed: rand(5, 8), // 转多快
      width: rand(0.6, 1.4),
      hue: rand(195, 215), // 蓝色到青蓝色
      light: rand(55, 75),
    }));

    // 碎石：绕着漏斗外面飞
    this.debris = Array.from({ length: 36 }, () => this.newDebris(rand(0, 1)));
    this.bolts = []; // 漏斗里的闪电
    this.nextBolt = 0;
  }

  newDebris(h) {
    return {
      h,
      theta: rand(0, Math.PI * 2),
      spin: rand(3, 6),
      rise: rand(0.15, 0.3),
      out: rand(1.15, 1.6), // 离漏斗多远（比漏斗半径大一点）
      size: rand(3, 8),
      rot: rand(0, Math.PI * 2),
    };
  }

  get done() {
    return this.age >= this.duration;
  }

  // 整体强度：0.5 秒内长出来，最后 0.6 秒消失
  get strength() {
    if (this.age < 0.5) return this.age / 0.5;
    if (this.age > this.duration - 0.6) return Math.max(0, (this.duration - this.age) / 0.6);
    return 1;
  }

  // ↔️ 漏斗现在的中心位置：用 sin 波来回摆动（像钟摆）
  get cx() {
    return this.homeX + this.travel * Math.sin(this.age * this.travelSpeed);
  }

  // 现在往哪边移、移多快（sin 的变化率就是 cos）：正数 = 往右，负数 = 往左
  get velocity() {
    return this.travel * this.travelSpeed * Math.cos(this.age * this.travelSpeed);
  }

  radiusAt(h) {
    return this.topRadius * (0.1 + 0.9 * Math.pow(h, 1.3)); // 底部很尖、往上张开
  }

  swayAt(h) {
    const wobble = Math.sin(this.age * 2.2 + h * 2) * 22 * h; // 自己的扭动，越上面摆越多
    const lean = -this.velocity * 0.12 * h; // 🌪️ 移动时上半部落后 → 往反方向倾斜
    return wobble + lean;
  }

  // 漏斗表面上的一点（h = 高度 0 到 1，theta = 绕着的角度）
  point(h, theta, out = 1) {
    const r = this.radiusAt(h) * out;
    return {
      x: this.cx + this.swayAt(h) + r * Math.cos(theta),
      y: this.baseY - h * this.height + r * 0.22 * Math.sin(theta),
      front: (Math.sin(theta) + 1) / 2, // 0 = 后面，1 = 前面
    };
  }

  update(dt) {
    this.age += dt;

    for (const d of this.debris) {
      d.theta += d.spin * dt;
      d.h += d.rise * dt;
      d.rot += 4 * dt;
      if (d.h > 1.05) Object.assign(d, this.newDebris(0)); // 飞到顶了，从底部重新来
    }

    // 每 0.12 秒换一次闪电的形状
    if (this.age >= this.nextBolt) {
      this.nextBolt = this.age + 0.12;
      this.bolts = Array.from({ length: 2 }, () => {
        const h1 = rand(0.15, 0.7);
        const a = this.point(h1, rand(0, Math.PI * 2), 0.7);
        const b = this.point(h1 + rand(0.15, 0.3), rand(0, Math.PI * 2), 0.7);
        return jagged(a, b, Math.hypot(b.x - a.x, b.y - a.y) * 0.25);
      });
    }
  }

  draw(ctx) {
    const s = this.strength;
    if (s <= 0) return;
    const grow = easeOutCubic(Math.min(1, this.age / 0.5)); // 从底部往上长出来
    const topH = grow; // 现在长到多高

    ctx.save();

    // ① 碎石（后半圈）：先画，才会被光带盖住
    this.drawDebris(ctx, s, topH, false);

    ctx.globalCompositeOperation = "lighter";

    // ② 漏斗中心的光柱：沿着中轴，一团团青蓝色的光
    for (let h = 0.05; h <= topH; h += 0.12) {
      const p = this.point(h, 0, 0);
      const R = this.radiusAt(h) * 0.9;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      g.addColorStop(0, `rgba(160, 230, 255, ${0.16 * s})`);
      g.addColorStop(1, "rgba(40, 120, 255, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, R, R * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ③ 漏斗的身体：用左右两边的轮廓围成一个形状，填上半透明的蓝色 → 有“体积”
    ctx.fillStyle = `rgba(30, 110, 255, ${0.16 * s})`;
    ctx.beginPath();
    for (let h = 0; h <= topH; h += 0.05) {
      const c = this.point(h, 0, 0);
      ctx.lineTo(c.x - this.radiusAt(h), c.y);
    }
    for (let h = topH; h >= 0; h -= 0.05) {
      const c = this.point(h, 0, 0);
      ctx.lineTo(c.x + this.radiusAt(h), c.y);
    }
    ctx.closePath();
    ctx.fill();

    // ④ 螺旋光带：每条都是从底部绕到顶部的螺旋线
    //    画两次：先把整条画成暗蓝色（后半圈的样子），
    //    再把“在前半圈的那几段”用亮白蓝色重画一次
    //    （每一段连成一条完整的线来画，才不会像一颗颗珠子）
    const SEGMENTS = 40;
    ctx.lineJoin = "round";
    ctx.lineCap = "butt";
    for (const band of this.bands) {
      const pts = [];
      for (let i = 0; i <= SEGMENTS; i++) {
        const h = (i / SEGMENTS) * topH;
        const theta = band.phase + band.twist * h + band.speed * this.age;
        pts.push({ ...this.point(h, theta), h });
      }
      const width = (3 + 14 * topH) * band.width;

      // 第一次：整条，暗蓝色
      ctx.strokeStyle = `hsla(${band.hue}, 100%, ${band.light - 15}%, ${0.14 * s})`;
      ctx.lineWidth = width;
      strokeRun(ctx, pts, 0, pts.length - 1);

      // 第二次：只画前半圈的段落，亮白蓝色
      ctx.strokeStyle = `hsla(${band.hue}, 100%, ${band.light + 18}%, ${0.42 * s})`;
      ctx.lineWidth = width * 0.8;
      let runStart = -1;
      for (let i = 0; i < pts.length; i++) {
        const inFront = pts[i].front > 0.5;
        if (inFront && runStart < 0) runStart = i;
        if ((!inFront || i === pts.length - 1) && runStart >= 0) {
          strokeRun(ctx, pts, Math.max(0, runStart - 1), i);
          runStart = -1;
        }
      }
    }

    // ⑤ 闪电：在漏斗里面劈来劈去（外层蓝紫光晕 + 白色核心）
    ctx.lineJoin = "round";
    for (const bolt of this.bolts) {
      for (const [w, color] of [
        [8, `rgba(170, 140, 255, ${0.35 * s})`],
        [2.5, `rgba(255, 255, 255, ${0.95 * s})`],
      ]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(bolt[0].x, bolt[0].y);
        for (const p of bolt) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }

    // ⑥ 底部的光：白蓝色，像能量打在地上
    const base = ctx.createRadialGradient(this.cx, this.baseY, 0, this.cx, this.baseY, this.topRadius * 0.7);
    base.addColorStop(0, `rgba(230, 250, 255, ${0.8 * s})`);
    base.addColorStop(0.3, `rgba(90, 190, 255, ${0.45 * s})`);
    base.addColorStop(1, "rgba(30, 90, 255, 0)");
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.ellipse(this.cx, this.baseY, this.topRadius * 0.7, this.topRadius * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";

    // ⑦ 碎石（前半圈）：最后画，盖在光带前面
    this.drawDebris(ctx, s, topH, true);

    ctx.restore();
  }

  drawDebris(ctx, s, topH, front) {
    for (const d of this.debris) {
      if (d.h > topH) continue;
      const p = this.point(d.h, d.theta, d.out);
      if ((p.front > 0.5) !== front) continue; // 只画这一半的
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(d.rot);
      ctx.fillStyle = `rgba(20, 30, 55, ${0.85 * s})`;
      ctx.beginPath(); // 不规则的四边形 = 碎石
      ctx.moveTo(-d.size, -d.size * 0.4);
      ctx.lineTo(d.size * 0.3, -d.size * 0.7);
      ctx.lineTo(d.size, d.size * 0.3);
      ctx.lineTo(-d.size * 0.4, d.size * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

// 把 pts[from] 到 pts[to] 连成一条完整的线画出来
function strokeRun(ctx, pts, from, to) {
  if (to <= from) return;
  ctx.beginPath();
  ctx.moveTo(pts[from].x, pts[from].y);
  for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

// 锯齿线：中点位移法 (Midpoint Displacement)
//   把一条直线从中间切开，中点往旁边随机推一下；
//   两半再各自切开、推一下……推的幅度越来越小，就变成自然的锯齿
function jagged(a, b, displacement) {
  if (displacement < 3) return [a, b];

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const offset = rand(-displacement, displacement);
  const mid = {
    x: (a.x + b.x) / 2 + (-dy / len) * offset, // 往“垂直于线”的方向推
    y: (a.y + b.y) / 2 + (dx / len) * offset,
  };

  const left = jagged(a, mid, displacement / 2);
  const right = jagged(mid, b, displacement / 2);
  return [...left, ...right.slice(1)]; // 中点不要重复
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
