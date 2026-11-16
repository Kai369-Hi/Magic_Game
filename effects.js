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
const easeOutQuad = (t) => 1 - (1 - t) * (1 - t); // 比 easeOutCubic 温和一点的减速

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

  // 施法成功时叫这个：shape = 咒语表里的名字（"triangle"、"circle"…）
  // info = { bounds: 外框, end: 一笔的最后一点, getTip: 取得目前指尖位置的函数 }
  spawn(shape, info) {
    const common = { ...info, canvas: this.canvas, shake: (s, d) => this.shake(s, d) };
    if (shape === "triangle") this.effects.push(new FireEffect(common));
    else if (shape === "circle") this.effects.push(new LightEffect(common));
    else if (shape === "lightning") this.effects.push(new LightningEffect(common));
    else if (shape === "star") this.effects.push(new StarRushEffect(common)); // 🌟 星光冲击
    else if (shape === "spiral") this.effects.push(new TornadoEffect(common)); // 🌪️ 龙卷风
    else if (shape === "wave") this.effects.push(new WaveEffect(common)); // 🐉 水龙
    else if (shape === "mshape") this.effects.push(new RockfallEffect(common)); // ⛰️ 落石
    else if (shape === "infinity") this.effects.push(new FreezeEffect(common)); // ❄️ 冰冻
    else if (shape === "loop") this.effects.push(new ButterflyEffect(common)); // 🦋 蝴蝶
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

// =====================================================================
// 🐉 水龙：暗夜中，一股水流从画面边缘冲进来，打 3 个越来越大的螺旋圈，
//    最后凝聚成一条咆哮的东方水龙，在画面中游动
//
//   画风：普鲁士蓝 + 青色的水，粗细不一的黑色“毛笔墨线”，尖锐的白色爪状浪花
//   龙身：一层层半圆弧（类似“青海波”纹样）
//   摄影机：画面慢慢放大 + 轻微旋转，模拟推进的感觉（2D 画布没有真正的 3D 摄影机）
// =====================================================================
const DRAGON = {
  bands: ["#071f4f", "#0f3f8f", "#1a8fd0", "#62d6ee", "#e8fbff"], // 从外侧到内侧：深 → 浅
  ink: "#05070c", // 墨线
  foam: "#ffffff",
};

const smoothstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t); // 慢慢开始、慢慢停
};

// 固定的“随机数”：同一个 i 每次都得到同一个值（墨线粗细、浪花形状每一帧才不会乱跳）
function stableRandom(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// 一簇尖锐的白色爪状浪花（3 根尖端往回卷的手指），黑色墨线勾边
//   (x, y) = 根部；(nx, ny) = 往外的方向；(tx, ty) = 沿着水流的方向
function drawInkClaw(ctx, x, y, nx, ny, tx, ty, size, seed) {
  for (let f = 0; f < 3; f++) {
    const s = size * (0.7 + 0.6 * stableRandom(seed * 3 + f));
    const bx = x + tx * (f - 1) * size * 0.45;
    const by = y + ty * (f - 1) * size * 0.45;
    const tipX = bx + nx * s - tx * s * 0.45; // 指尖：往外、往后甩
    const tipY = by + ny * s - ty * s * 0.45;
    ctx.beginPath();
    ctx.moveTo(bx + tx * s * 0.25, by + ty * s * 0.25);
    ctx.quadraticCurveTo(bx + nx * s * 0.8 + tx * s * 0.1, by + ny * s * 0.8 + ty * s * 0.1, tipX, tipY);
    ctx.quadraticCurveTo(tipX - tx * s * 0.15 - nx * s * 0.35, tipY - ty * s * 0.15 - ny * s * 0.35, bx - tx * s * 0.2, by - ty * s * 0.2);
    ctx.closePath();
    ctx.fillStyle = DRAGON.foam;
    ctx.fill();
    ctx.strokeStyle = DRAGON.ink;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// 沿着一串点（中心线）画一条“水做的带子”：条纹 + 毛笔墨线 + 爪状浪花 + （可选）青海波纹样
//   pts 里每个点要有：x, y, hw（半宽）
function drawWaterBody(ctx, pts, opts = {}) {
  if (pts.length < 2) return;
  // 法线、切线
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    pts[i].tx = (b.x - a.x) / len;
    pts[i].ty = (b.y - a.y) / len;
    pts[i].nx = -pts[i].ty;
    pts[i].ny = pts[i].tx;
  }
  const side = (p, o) => ({ x: p.x + p.nx * p.hw * o, y: p.y + p.ny * p.hw * o });
  const edges = [-1, -0.55, -0.1, 0.35, 0.7, 1];

  // ① 条纹
  for (let b = 0; b < edges.length - 1; b++) {
    ctx.beginPath();
    for (const p of pts) {
      const q = side(p, edges[b]);
      ctx.lineTo(q.x, q.y);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const q = side(pts[i], edges[b + 1]);
      ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    ctx.fillStyle = DRAGON.bands[b];
    ctx.fill();
  }

  // ② 青海波纹样：一层层半圆弧，开口朝向尾巴
  if (opts.scales) {
    ctx.lineWidth = 1.8;
    for (let i = 3; i < pts.length - 2; i += 3) {
      const p = pts[i];
      const angle = Math.atan2(p.ty, p.tx);
      for (const [k, color] of [[0.85, DRAGON.ink], [0.62, "rgba(232, 251, 255, 0.85)"], [0.38, "rgba(232, 251, 255, 0.6)"]]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.hw * k, angle + Math.PI / 2, angle + (Math.PI * 3) / 2);
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    }
  }

  // ③ 毛笔墨线：两侧轮廓，每一小段的粗细都不一样
  ctx.strokeStyle = DRAGON.ink;
  ctx.lineCap = "round";
  for (const o of [-1, 1]) {
    for (let i = 1; i < pts.length; i++) {
      const a = side(pts[i - 1], o);
      const b = side(pts[i], o);
      ctx.lineWidth = 2.5 + 4.5 * stableRandom(i * 7 + (o > 0 ? 1 : 0)) * Math.min(1, pts[i].hw / 25);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // ④ 外侧（o = -1 那一边）长出尖锐的爪状浪花
  const every = opts.clawEvery || 5;
  for (let i = every; i < pts.length - 2; i += every) {
    const p = pts[i];
    if (p.hw < 6) continue;
    const q = side(p, -1);
    drawInkClaw(ctx, q.x, q.y, -p.nx, -p.ny, p.tx, p.ty, p.hw * 0.55, i + (opts.seed || 0));
  }
}

class WaveEffect {
  constructor({ bounds, canvas, shake }) {
    this.W = canvas.width;
    this.H = canvas.height;
    this.shake = shake;
    this.age = 0;
    this.duration = 5.0;
    this.roared = false;

    // ① 螺旋水流：从靠近你画的那一侧的边缘，冲向画面中心
    this.dir = bounds.centerX < this.W / 2 ? 1 : -1; // 1 = 从左边冲进来
    const start = { x: this.dir > 0 ? -80 : this.W + 80, y: this.H * 0.78 };
    const end = { x: this.W / 2, y: this.H * 0.62 };
    const loops = 3;
    this.spiral = [];
    const N = 300;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const theta = s * Math.PI * 2 * loops;
      const r = 30 + (this.H * 0.3 - 30) * s; // 每一圈都更大
      const lx = start.x + (end.x - start.x) * s;
      const ly = start.y + (end.y - start.y) * s;
      this.spiral.push({
        x: lx + this.dir * r * Math.sin(theta),
        y: ly - r * (1 - Math.cos(theta)) * 0.9, // 往上卷
        s,
      });
    }

    // ② 水龙：龙头沿着“8 字形”游动，身体跟着龙头走过的路线
    this.trail = []; // 龙头走过的位置（越前面越新）
    this.dragonMaxLen = this.W * 0.95; // 龙身最长多长
    this.dragonWidth = this.H * 0.1; // 龙身最粗的半宽

    this.foam = []; // 飞溅的水珠
    shake(4, 2.2);
  }

  get done() {
    return this.age >= this.duration;
  }

  get darkness() {
    // 背景暗下来：0.3 秒内变黑，最后 0.6 秒恢复
    return smoothstep(this.age / 0.3) * (1 - smoothstep((this.age - 4.4) / 0.6));
  }

  // 龙头在时间 τ 的位置（8 字形 / lemniscate）
  dragonHead(tau) {
    const w = 1.6;
    return {
      x: this.W / 2 + this.dir * this.W * 0.36 * Math.sin(w * tau),
      y: this.H * 0.48 + this.H * 0.24 * Math.sin(2 * w * tau),
    };
  }

  update(dt) {
    this.age += dt;

    // 水龙开始游动（2.0 秒之后）：记录龙头走过的位置
    if (this.age >= 2.0) {
      const tau = this.age - 2.0;
      this.trail.unshift(this.dragonHead(tau));
      // 只保留“龙身那么长”的路线
      const maxLen = this.dragonMaxLen * smoothstep(tau / 0.8); // 0.8 秒内长出来
      let len = 0;
      for (let i = 1; i < this.trail.length; i++) {
        len += Math.hypot(this.trail[i].x - this.trail[i - 1].x, this.trail[i].y - this.trail[i - 1].y);
        if (len > maxLen) {
          this.trail.length = i + 1;
          break;
        }
      }

      // 龙咆哮（2.8 秒）：重震 + 龙头炸出水珠
      if (!this.roared && this.age >= 2.8) {
        this.roared = true;
        this.shake(14, 0.45);
        const h = this.trail[0];
        for (let i = 0; i < 40; i++) {
          const a = rand(0, Math.PI * 2);
          const sp = rand(200, 520);
          this.foam.push({ x: h.x, y: h.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(3, 7), age: 0, life: rand(0.5, 1.0) });
        }
      }
    }

    // 螺旋水流的头部，沿路甩出水珠
    const head = this.spiralHead();
    if (head && this.age < 2.4) {
      for (let i = 0; i < 2; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(120, 300);
        this.foam.push({ x: head.x, y: head.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(2, 5), age: 0, life: rand(0.4, 0.8) });
      }
    }

    for (const f of this.foam) {
      f.age += dt;
      f.vy += 500 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    this.foam = this.foam.filter((f) => f.age < f.life);
  }

  // 螺旋水流的头、尾在路径的哪里（0 到 1）
  get spiralHeadT() {
    return easeOutQuad(clamp((this.age - 0.2) / 2.2, 0, 1));
  }
  get spiralTailT() {
    return Math.max(0, this.spiralHeadT - 0.45);
  }
  spiralHead() {
    if (this.age < 0.2) return null;
    return this.spiral[Math.round(this.spiralHeadT * (this.spiral.length - 1))];
  }

  draw(ctx) {
    // ① 暗夜背景（不跟着摄影机动，永远盖满画面）
    ctx.save();
    ctx.fillStyle = `rgba(2, 4, 10, ${0.93 * this.darkness})`;
    ctx.fillRect(0, 0, this.W, this.H);

    // ② 摄影机：画面慢慢放大 + 轻微左右旋转 → 推进、环绕的感觉
    const zoom = 1 + 0.15 * smoothstep(this.age / 4.5);
    const rot = 0.05 * Math.sin(this.age * 1.4);
    ctx.translate(this.W / 2, this.H / 2);
    ctx.scale(zoom, zoom);
    ctx.rotate(rot);
    ctx.translate(-this.W / 2, -this.H / 2);

    const fadeOut = 1 - smoothstep((this.age - 4.4) / 0.6);

    // ③ 螺旋水流（2.2 ~ 2.8 秒慢慢淡去，变成水龙）
    const spiralAlpha = (1 - smoothstep((this.age - 2.2) / 0.6)) * fadeOut;
    if (spiralAlpha > 0 && this.age >= 0.2) {
      const i0 = Math.round(this.spiralTailT * (this.spiral.length - 1));
      const i1 = Math.round(this.spiralHeadT * (this.spiral.length - 1));
      const pts = [];
      for (let i = i0; i <= i1; i += 2) {
        const p = this.spiral[i];
        const u = (i - i0) / Math.max(1, i1 - i0); // 0 = 尾，1 = 头
        const taper = Math.pow(Math.sin(Math.PI * Math.min(0.999, Math.max(0.001, u))), 0.5);
        pts.push({ x: p.x, y: p.y, hw: (14 + 60 * p.s) * taper }); // 越往后的圈越粗
      }
      ctx.globalAlpha = spiralAlpha;
      drawWaterBody(ctx, pts, { clawEvery: 4, seed: 0 });
    }

    // ④ 水龙
    if (this.trail.length > 2) {
      ctx.globalAlpha = fadeOut * smoothstep((this.age - 2.0) / 0.4);
      this.drawDragon(ctx);
    }

    // ⑤ 水珠：白色，黑色墨线
    ctx.lineWidth = 1.5;
    for (const f of this.foam) {
      ctx.globalAlpha = fadeOut * (1 - f.age / f.life);
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = DRAGON.foam;
      ctx.fill();
      ctx.strokeStyle = DRAGON.ink;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawDragon(ctx) {
    // 把龙头走过的路线，平均取 70 个点当龙身（0 = 龙头，70 = 尾巴）
    const trail = this.trail;
    const lengths = [0];
    for (let i = 1; i < trail.length; i++) lengths.push(lengths[i - 1] + Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y));
    const total = lengths[lengths.length - 1];
    if (total < 10) return;
    const S = 70;
    const pts = [];
    let j = 0;
    for (let i = 0; i <= S; i++) {
      const d = (i / S) * total;
      while (j < lengths.length - 2 && lengths[j + 1] < d) j++;
      const k = (d - lengths[j]) / ((lengths[j + 1] - lengths[j]) || 1);
      const u = i / S; // 0 = 龙头，1 = 尾巴
      // 龙身：头后面最粗，往尾巴慢慢变细
      const hw = this.dragonWidth * (u < 0.12 ? 0.75 + 2 * u : Math.max(0.06, 1 - (u - 0.12) * 1.05));
      pts.push({ x: trail[j].x + (trail[j + 1].x - trail[j].x) * k, y: trail[j].y + (trail[j + 1].y - trail[j].y) * k, hw });
    }
    drawRaggedWater(ctx, pts, this.age);
    this.drawHead(ctx, pts[0], pts[2]);
  }

  // 龙头：由尖刺状的水花组成——张开的上下颚、一排往后甩的长尖刺（鬃毛）
  drawHead(ctx, head, neck) {
    const angle = Math.atan2(head.y - neck.y, head.x - neck.x); // 龙头朝向
    const S = this.dragonWidth * 2.8; // 龙头大小
    const roar = this.age >= 2.8 ? Math.max(0, 1 - (this.age - 2.8) / 0.8) : 0;
    const jaw = 0.22 + 0.5 * roar + 0.06 * Math.sin(this.age * 8); // 嘴巴张开的角度
    const flick = Math.floor(this.age * 14); // 尖刺每秒变化 14 次 → 水花在“跳动”

    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(angle);

    // ① 鬃毛：头后面一排往后、往上甩的长尖刺（先画，才会在头的后面）
    for (let k = 0; k < 7; k++) {
      const baseX = -S * (0.05 + 0.1 * k);
      const baseY = -S * (0.28 - 0.02 * k);
      const len = S * (0.4 + 0.35 * stableRandom(k * 3 + flick)); // 鬃毛长度（太长会冲出画面）
      const lift = 0.45 + 0.5 * stableRandom(k * 5 + 1);
      ctx.beginPath();
      ctx.moveTo(baseX + S * 0.08, baseY + S * 0.04);
      ctx.quadraticCurveTo(baseX - len * 0.4, baseY - len * lift * 0.6, baseX - len, baseY - len * lift);
      ctx.quadraticCurveTo(baseX - len * 0.5, baseY - len * lift * 0.3, baseX - S * 0.08, baseY + S * 0.06);
      ctx.closePath();
      ctx.fillStyle = k % 2 === 0 ? RAGGED.foam : RAGGED.light;
      ctx.fill();
      ctx.strokeStyle = RAGGED.line;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }

    // ② 下颚（绕着嘴角旋转 = 张嘴），下缘有往下的尖刺
    ctx.save();
    ctx.translate(0, S * 0.06);
    ctx.rotate(jaw);
    const lower = [[-0.25, -0.02], [0.82, 0.02], [0.9, 0.07]];
    for (let x = 0.8, k = 0; x > -0.25; x -= 0.13, k++) {
      lower.push([x, 0.16 + 0.05 * (1 - x)]);
      lower.push([x - 0.06, 0.24 + 0.14 * stableRandom(k + flick + 40) + 0.05 * (1 - x)]); // 往下的尖刺
    }
    lower.push([-0.3, 0.2]);
    fillRaggedPart(ctx, lower, S, 7);
    // 下排牙齿
    ctx.fillStyle = RAGGED.foam;
    for (let t = 0.15; t < 0.8; t += 0.15) {
      ctx.beginPath();
      ctx.moveTo(S * t, -S * 0.01);
      ctx.lineTo(S * (t + 0.05), -S * 0.005);
      ctx.lineTo(S * (t + 0.025), -S * 0.1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // ③ 上颚 + 头顶：上缘有一排往后翘的尖刺，前面是尖尖的吻部
    const upper = [[-0.35, 0.06], [-0.4, -0.25]];
    for (let x = -0.3, k = 0; x < 0.95; x += 0.12, k++) {
      const y = -0.36 + 0.3 * ((x + 0.3) / 1.25); // 从头顶往吻部斜下来
      upper.push([x, y]);
      upper.push([x - 0.09, y - 0.1 - 0.12 * stableRandom(k + flick)]); // 往后上方翘的尖刺
    }
    upper.push([1.08, -0.02]); // 吻部尖端
    upper.push([0.85, 0.06]);
    upper.push([0.0, 0.08]);
    fillRaggedPart(ctx, upper, S, 3);
    // 上排牙齿
    ctx.fillStyle = RAGGED.foam;
    for (let t = 0.2; t < 0.9; t += 0.15) {
      ctx.beginPath();
      ctx.moveTo(S * t, S * 0.07);
      ctx.lineTo(S * (t + 0.05), S * 0.065);
      ctx.lineTo(S * (t + 0.025), S * 0.17);
      ctx.closePath();
      ctx.fill();
    }

    // ④ 眼睛：细长的白色眼缝，深蓝色勾边
    ctx.beginPath();
    ctx.moveTo(S * 0.18, -S * 0.2);
    ctx.quadraticCurveTo(S * 0.3, -S * 0.28, S * 0.42, -S * 0.2);
    ctx.quadraticCurveTo(S * 0.3, -S * 0.17, S * 0.18, -S * 0.2);
    ctx.fillStyle = RAGGED.foam;
    ctx.fill();
    ctx.strokeStyle = RAGGED.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }
}

// ---------------------------------------------------------------------
// 参考图风格的“水做的身体”：亮青色、参差不齐的边缘、往后甩的尖刺、
// 一块块白色泡沫、沿着水流方向的深蓝色细线
// ---------------------------------------------------------------------
const RAGGED = {
  main: "#45bfe8", // 主体的亮青色
  light: "#9ee8f8", // 中间比较亮的部分
  foam: "#ffffff", // 白色泡沫
  line: "#1b4f8f", // 细细的深蓝色勾线
};

// 用一串“比例座标”画出一块参差不齐的水（龙头的上颚、下颚）
//   points = [[x, y], ...]（以 S 为单位）；seed = 让白色泡沫的位置不一样
function fillRaggedPart(ctx, points, S, seed) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * S, y * S) : ctx.lineTo(x * S, y * S)));
  ctx.closePath();
  ctx.fillStyle = RAGGED.main;
  ctx.fill();
  ctx.save();
  ctx.clip(); // 下面的泡沫和细线只画在这块形状里面
  // 白色泡沫块
  ctx.fillStyle = RAGGED.foam;
  for (let k = 0; k < 4; k++) {
    const cx = (-0.2 + 1.0 * stableRandom(seed * 10 + k)) * S;
    const cy = (-0.25 + 0.3 * stableRandom(seed * 10 + k + 5)) * S;
    const r = S * (0.08 + 0.1 * stableRandom(seed * 10 + k + 9));
    ctx.beginPath();
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const rr = r * (0.6 + 0.6 * stableRandom(seed * 100 + k * 8 + a));
      a === 0 ? ctx.moveTo(cx + Math.cos(ang) * rr * 1.6, cy + Math.sin(ang) * rr) : ctx.lineTo(cx + Math.cos(ang) * rr * 1.6, cy + Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  // 深蓝色细线
  ctx.strokeStyle = RAGGED.line;
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 3; k++) {
    const y = (-0.25 + 0.12 * k) * S;
    ctx.beginPath();
    ctx.moveTo(-0.3 * S, y);
    ctx.lineTo(0.2 * S, y + S * 0.03);
    ctx.lineTo(0.7 * S, y + S * 0.06 * stableRandom(seed + k));
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = RAGGED.line;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.stroke();
}

// 龙身：pts 从龙头（0）排到尾巴；每个点要有 x, y, hw（半宽）
function drawRaggedWater(ctx, pts, age) {
  const flick = Math.floor(age * 14); // 边缘的尖刺每秒变化 14 次 → 水在“流动”
  // 切线（从龙头往尾巴的方向）和法线
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    pts[i].tx = (b.x - a.x) / len;
    pts[i].ty = (b.y - a.y) / len;
    pts[i].nx = -pts[i].ty;
    pts[i].ny = pts[i].tx;
  }

  // 一条参差不齐、带尖刺的边缘（o = -1 或 1 代表哪一边；width = 占半宽的比例）
  const raggedEdge = (o, width, spiky) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const jag = 0.85 + 0.3 * stableRandom(i * 13 + (o > 0 ? 7 : 3) + flick * 31);
      out.push({ x: p.x + p.nx * p.hw * width * o * jag, y: p.y + p.ny * p.hw * width * o * jag });
      // 往外、往尾巴方向甩出去的尖刺
      if (spiky && i % 2 === 0 && i < pts.length - 3 && stableRandom(i * 5 + (o > 0 ? 1 : 2) + flick * 17) > 0.45) {
        const reach = p.hw * (1.3 + 0.8 * stableRandom(i * 9 + flick));
        out.push({ x: p.x + p.nx * reach * o + p.tx * p.hw * 0.9, y: p.y + p.ny * reach * o + p.ty * p.hw * 0.9 });
      }
    }
    return out;
  };

  const shape = (width, spiky) => {
    const a = raggedEdge(-1, width, spiky);
    const b = raggedEdge(1, width, spiky).reverse();
    ctx.beginPath();
    [...a, ...b].forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.closePath();
  };

  // ① 主体：亮青色，边缘有尖刺
  shape(1, true);
  ctx.fillStyle = RAGGED.main;
  ctx.fill();
  ctx.strokeStyle = RAGGED.line;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  // ② 中间比较亮的一条
  shape(0.45, false);
  ctx.fillStyle = RAGGED.light;
  ctx.fill();

  // ③ 一块块白色泡沫（跟着龙身走，位置固定在身体上）
  ctx.fillStyle = RAGGED.foam;
  ctx.strokeStyle = RAGGED.line;
  ctx.lineWidth = 1;
  for (let i = 2; i < pts.length - 4; i += 3) {
    if (stableRandom(i * 3.7) < 0.35) continue;
    const p = pts[i];
    const off = (stableRandom(i * 1.3) * 1.4 - 0.7) * p.hw; // 在身体的哪个位置（偏左或偏右）
    const cx = p.x + p.nx * off;
    const cy = p.y + p.ny * off;
    const along = p.hw * (0.5 + 0.7 * stableRandom(i * 2.1)); // 沿着身体方向比较长
    const across = p.hw * (0.2 + 0.25 * stableRandom(i * 4.3));
    ctx.beginPath();
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * Math.PI * 2;
      const k = 0.65 + 0.5 * stableRandom(i * 10 + a); // 凹凸不平的边
      const lx = Math.cos(ang) * along * k;
      const ly = Math.sin(ang) * across * k;
      const x = cx + p.tx * lx + p.nx * ly;
      const y = cy + p.ty * lx + p.ny * ly;
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // ④ 沿着水流方向的深蓝色细线（时有时断，像速写的笔触）
  ctx.strokeStyle = RAGGED.line;
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  for (let k = 0; k < 5; k++) {
    const o = -0.7 + 0.35 * k;
    for (let i = 1; i < pts.length - 2; i++) {
      if (stableRandom(i * 11 + k * 3) < 0.45) continue; // 断开的地方
      const a = pts[i - 1];
      const b = pts[i];
      ctx.beginPath();
      ctx.moveTo(a.x + a.nx * a.hw * o, a.y + a.ny * a.hw * o);
      ctx.lineTo(b.x + b.nx * b.hw * o, b.y + b.ny * b.hw * o);
      ctx.stroke();
    }
  }
}

// =====================================================================
// ⛰️ 落石：一大群圆滚滚、凹凸不平的土黄色巨石，从画面上方接连砸下来（像山崩）
//    落地：画面震动、扬起尘土、溅出碎石，巨石弹一下再停住，堆在一起，最后淡出
// =====================================================================
class RockfallEffect {
  constructor({ bounds, canvas, shake }) {
    this.shake = shake;
    this.scale = clamp(bounds.size / 200, 0.6, 1.6);
    this.age = 0;
    this.duration = 3.2;
    const spread = clamp(bounds.size * 1.6, 200, canvas.width * 0.6);
    const groundY = Math.min(canvas.height - 20, bounds.centerY + bounds.size * 0.5);

    // 16 颗石头，大小不一，一颗接一颗落下
    this.rocks = Array.from({ length: 16 }, (_, i) => {
      const r = rand(20, 46) * this.scale;
      return {
        delay: i * 0.06 + rand(0, 0.08),
        x: bounds.centerX + rand(-0.5, 0.5) * spread,
        y: -r - rand(0, 120), // 从画面上方外面开始，高度错开
        r,
        vx: rand(-40, 40),
        vy: rand(100, 250),
        angle: rand(0, Math.PI * 2),
        spin: rand(-4, 4),
        groundY: groundY - rand(0, 0.8) * r, // 落地高度稍微不同 → 看起来像堆在一起
        // 凹凸不平的外形：18 个点，每个点离中心的距离都差一点点
        outline: Array.from({ length: 18 }, () => rand(0.88, 1.06)),
        // 表面的深色斑点
        spots: Array.from({ length: Math.floor(rand(3, 6)) }, () => ({
          a: rand(0, Math.PI * 2),
          d: rand(0.15, 0.6),
          s: rand(0.1, 0.2),
        })),
        bounces: 0,
        landed: false,
      };
    });
    this.dust = [];
    this.chips = [];
  }

  get done() {
    return this.age >= this.duration && this.dust.length === 0 && this.chips.length === 0;
  }

  land(rock) {
    this.shake(rock.bounces === 0 ? 7 : 3, 0.15); // 第一次落地震比较大
    const n = rock.bounces === 0 ? 6 : 2;
    for (let i = 0; i < n; i++) {
      this.dust.push({
        x: rock.x + rand(-rock.r, rock.r),
        y: rock.groundY + rock.r * 0.7,
        vx: rand(-140, 140) * this.scale,
        vy: rand(-50, -10),
        r: rand(12, 22) * this.scale,
        grow: rand(30, 60) * this.scale,
        age: 0,
        life: rand(0.8, 1.3),
      });
      const a = rand(Math.PI * 1.1, Math.PI * 1.9);
      const speed = rand(150, 350) * this.scale;
      this.chips.push({
        x: rock.x,
        y: rock.groundY + rock.r * 0.5,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: rand(3, 6) * this.scale,
        age: 0,
        life: rand(0.6, 1.0),
      });
    }
  }

  update(dt) {
    this.age += dt;

    for (const rock of this.rocks) {
      if (this.age < rock.delay || rock.landed) continue;
      rock.vy += 1500 * dt; // 很重 → 掉得很快
      rock.x += rock.vx * dt;
      rock.y += rock.vy * dt;
      rock.angle += rock.spin * dt;

      if (rock.y >= rock.groundY && rock.vy > 0) {
        rock.y = rock.groundY;
        this.land(rock);
        rock.bounces++;
        if (rock.bounces >= 2) {
          rock.landed = true; // 弹过一次之后就停住
        } else {
          rock.vy = -rock.vy * 0.3; // 弹一下
          rock.vx *= 0.6;
          rock.spin *= 0.5;
        }
      }
    }

    for (const p of this.dust) {
      p.age += dt;
      p.vx *= 1 - 2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.grow * dt;
    }
    this.dust = this.dust.filter((p) => p.age < p.life);

    for (const c of this.chips) {
      c.age += dt;
      c.vy += 900 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
    }
    this.chips = this.chips.filter((c) => c.age < c.life);
  }

  draw(ctx) {
    const fade = this.age > this.duration - 0.5 ? Math.max(0, (this.duration - this.age) / 0.5) : 1;
    ctx.save();

    // ① 尘土（画在石头后面）
    for (const p of this.dust) {
      ctx.fillStyle = `rgba(175, 145, 95, ${0.4 * (1 - p.age / p.life)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ② 石头：先画大的、后画小的，小石头才不会被大石头盖住
    const order = this.rocks.filter((r) => this.age >= r.delay).sort((a, b) => b.r - a.r);
    ctx.globalAlpha = fade;
    for (const rock of order) drawBoulder(ctx, rock);
    ctx.globalAlpha = 1;

    // ③ 碎石
    for (const c of this.chips) {
      ctx.globalAlpha = 1 - c.age / c.life;
      ctx.fillStyle = "#b5801f";
      ctx.strokeStyle = "#3b2608";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

// 画一颗圆滚滚的巨石：凹凸的外形 + 立体渐层 + 深色斑点 + 亮面 + 粗轮廓
function drawBoulder(ctx, rock) {
  const { r } = rock;
  ctx.save();
  ctx.translate(rock.x, rock.y);
  ctx.rotate(rock.angle);

  // 外形：用“中点 + 曲线”把 18 个点连成圆滑但凹凸的形状
  const pts = rock.outline.map((d, k) => {
    const a = (k / rock.outline.length) * Math.PI * 2;
    return { x: Math.cos(a) * r * d, y: Math.sin(a) * r * d };
  });
  ctx.beginPath();
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const start = mid(pts[pts.length - 1], pts[0]);
  ctx.moveTo(start.x, start.y);
  for (let k = 0; k < pts.length; k++) {
    const m = mid(pts[k], pts[(k + 1) % pts.length]);
    ctx.quadraticCurveTo(pts[k].x, pts[k].y, m.x, m.y);
  }
  ctx.closePath();

  // 光从左上方来：左上亮黄、中间土黄、右下深褐
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r * 1.1);
  g.addColorStop(0, "#e8bb55");
  g.addColorStop(0.55, "#b5801f");
  g.addColorStop(1, "#6b4510");
  ctx.fillStyle = g;
  ctx.fill();

  // 深色斑点（坑洞）
  ctx.save();
  ctx.clip(); // 斑点只画在石头里面
  ctx.fillStyle = "rgba(110, 70, 15, 0.55)";
  for (const s of rock.spots) {
    ctx.beginPath();
    ctx.ellipse(Math.cos(s.a) * r * s.d, Math.sin(s.a) * r * s.d, r * s.s, r * s.s * 0.75, s.a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = "#3b2608";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  // 亮面：不跟着石头旋转（光一直从左上方来）
  ctx.save();
  ctx.fillStyle = "rgba(255, 240, 190, 0.45)";
  ctx.beginPath();
  ctx.ellipse(rock.x - r * 0.35, rock.y - r * 0.4, r * 0.25, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// =====================================================================
// ❄️ 冰冻：纯场景特效
//   深海蓝的画面 → 羽毛状、蕨叶状的冰花从四周“分形生长”，慢慢往中心爬
//   冰花上有钻石般的闪光；空气里有流动的白色冰雾和成千上万颗冰尘
//   镜头极慢地往前推，带一点点因为冷气造成的颤动
// =====================================================================
const ICE = {
  bgCenter: "#041a3a", // 画面中间：深海蓝
  bgEdge: "#0d4f8a", // 画面边缘：青蓝
  stem: "rgba(240, 252, 255, 0.95)", // 冰花主干：亮白
  leaf: "rgba(170, 225, 255, 0.85)", // 冰花叶子：浅青蓝
  barb: "rgba(120, 190, 240, 0.7)", // 最细的冰针
};

class FreezeEffect {
  constructor({ canvas, shake }) {
    this.canvas = canvas;
    this.shake = shake;
    this.W = canvas.width;
    this.H = canvas.height;
    this.age = 0;
    this.duration = 6;
    this.drawnUntil = 0; // 冰花已经画到第几秒的部分

    // 冰花画在一张“离屏画布”上，长出来的部分只要画一次，之后整张贴上去就好
    //   生活例子：像在玻璃上慢慢结霜，已经结好的霜不用每一帧重新结一次
    this.layer = document.createElement("canvas");
    this.layer.width = this.W;
    this.layer.height = this.H;
    this.lctx = this.layer.getContext("2d");
    this.lctx.lineCap = "round";
    // 发光用的小画布（1/4 大小）：缩小再放大，边缘自然变柔 → 便宜的光晕
    this.bloom = document.createElement("canvas");
    this.bloom.width = Math.ceil(this.W / 4);
    this.bloom.height = Math.ceil(this.H / 4);
    this.bctx = this.bloom.getContext("2d");
    this.bloomDirty = false; // 冰花有长新的部分，光晕才需要重算

    // 背景（中间深海蓝、四周青蓝）不会变，先画好一次
    this.bg = document.createElement("canvas");
    this.bg.width = this.W;
    this.bg.height = this.H;
    const bgc = this.bg.getContext("2d");
    const bg = bgc.createRadialGradient(this.W / 2, this.H / 2, 0, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.65);
    bg.addColorStop(0, ICE.bgCenter);
    bg.addColorStop(1, ICE.bgEdge);
    bgc.fillStyle = bg;
    bgc.fillRect(0, 0, this.W, this.H);

    // 把整片冰花拆成一小段一小段，每段记下“第几秒长出来”
    this.segments = [];
    this.glints = []; // 可以闪光的位置（叶子尖端）
    const min = Math.min(this.W, this.H);
    for (let i = 0; i < 34; i++) {
      // 从四条边上随机挑起点，朝中心长（角度稍微偏一点才自然）
      const side = i % 4;
      const t = rand(0, 1);
      const start = [
        { x: t * this.W, y: -10 },
        { x: this.W + 10, y: t * this.H },
        { x: t * this.W, y: this.H + 10 },
        { x: -10, y: t * this.H },
      ][side];
      const angle = Math.atan2(this.H / 2 - start.y, this.W / 2 - start.x) + rand(-0.7, 0.7);
      this.growFern(start.x, start.y, angle, min * rand(0.28, 0.5), 2, rand(0, 1.2), rand(-0.012, 0.012));
    }
    // 最后再从边上补一些短的，让边缘更密
    for (let i = 0; i < 30; i++) {
      const side = i % 4;
      const t = rand(0, 1);
      const start = [
        { x: t * this.W, y: -5 },
        { x: this.W + 5, y: t * this.H },
        { x: t * this.W, y: this.H + 5 },
        { x: -5, y: t * this.H },
      ][side];
      const angle = Math.atan2(this.H / 2 - start.y, this.W / 2 - start.x) + rand(-1, 1);
      this.growFern(start.x, start.y, angle, min * rand(0.12, 0.22), 1, rand(0.8, 2.5), rand(-0.02, 0.02));
    }
    this.segments.sort((a, b) => a.t - b.t);
    this.nextSeg = 0;

    this.dust = []; // 冰尘
    this.mist = Array.from({ length: 10 }, () => ({
      x: rand(0, this.W),
      y: rand(0, this.H),
      r: rand(120, 260),
      vx: rand(-25, 25),
      vy: rand(-12, 12),
    }));
  }

  // 🌿 蕨叶状的冰花（分形）：
  //   一根弯弯的主干，每走一步就往左右各长出一片“叶子”，
  //   叶子本身又是一根小主干（depth 减 1），一样往两边长更小的冰针
  //   t0 = 开始长的时间；bend = 主干每一步弯多少
  growFern(x, y, angle, length, depth, t0, bend) {
    const steps = depth === 2 ? 26 : depth === 1 ? 12 : 5;
    const stepLen = length / steps;
    const stepTime = (depth === 2 ? 2.6 : depth === 1 ? 0.9 : 0.35) / steps; // 越小的枝长得越快
    let a = angle;
    for (let i = 0; i < steps; i++) {
      const nx = x + Math.cos(a) * stepLen;
      const ny = y + Math.sin(a) * stepLen;
      const t = t0 + i * stepTime;
      this.segments.push({ x1: x, y1: y, x2: nx, y2: ny, t, depth });
      // 每一步都往两边长出一片叶子，越靠近尖端越短（像羽毛）
      if (depth > 0 && i > 1) {
        const taper = 1 - i / steps;
        for (const side of [-1, 1]) {
          const leafLen = length * (depth === 2 ? 0.32 : 0.4) * taper * rand(0.7, 1.1);
          if (leafLen < 3) continue;
          this.growFern(nx, ny, a + side * rand(0.75, 1.0), leafLen, depth - 1, t + rand(0, 0.08), -side * 0.03);
        }
      } else if (depth === 0 && i === steps - 1 && Math.random() < 0.08) {
        this.glints.push({ x: nx, y: ny, t, phase: rand(0, Math.PI * 2), speed: rand(3, 7) });
      }
      x = nx;
      y = ny;
      a += bend + rand(-0.05, 0.05);
    }
  }

  get done() {
    return this.age >= this.duration;
  }

  // 整个画面的淡入 / 淡出（0 到 1）
  get envelope() {
    return clamp(this.age / 0.5, 0, 1) * clamp((this.duration - this.age) / 1.0, 0, 1);
  }

  update(dt) {
    this.age += dt;

    // 把这段时间“长出来”的冰花画到离屏画布上（同一种粗细的一起画，比较快）
    const lc = this.lctx;
    const styles = [
      [ICE.barb, 0.8],
      [ICE.leaf, 1.4],
      [ICE.stem, 2.6],
    ];
    const batch = [[], [], []];
    while (this.nextSeg < this.segments.length && this.segments[this.nextSeg].t <= this.age) {
      const s = this.segments[this.nextSeg++];
      batch[s.depth].push(s);
      this.bloomDirty = true;
    }
    batch.forEach((list, d) => {
      if (!list.length) return;
      lc.strokeStyle = styles[d][0];
      lc.lineWidth = styles[d][1];
      lc.beginPath();
      for (const s of list) {
        lc.moveTo(s.x1, s.y1);
        lc.lineTo(s.x2, s.y2);
      }
      lc.stroke();
    });

    // 冰尘：从边缘冒出来，绕着画面中心慢慢盘旋、飘散
    const cx = this.W / 2;
    const cy = this.H / 2;
    if (this.age < this.duration - 1) {
      for (let k = 0; k < 6; k++) {
        const a = rand(0, Math.PI * 2);
        const r = Math.max(this.W, this.H) * rand(0.3, 0.6);
        this.dust.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.6, life: rand(1.5, 3), maxLife: 3, size: rand(0.8, 2.4), star: Math.random() < 0.05 });
      }
    }
    for (const d of this.dust) {
      const dx = d.x - cx;
      const dy = d.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      // 绕中心转（切线方向）+ 一点点往内飘
      d.x += (-dy / dist) * 40 * dt - (dx / dist) * 12 * dt;
      d.y += (dx / dist) * 40 * dt - (dy / dist) * 12 * dt - 6 * dt;
      d.life -= dt;
    }
    this.dust = this.dust.filter((d) => d.life > 0);

    for (const m of this.mist) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
  }

  draw(ctx) {
    const W = this.W;
    const H = this.H;
    const env = this.envelope;
    // 镜头：极慢地往前推（放大 8%），再加上冷气造成的微弱颤动
    const zoom = 1 + 0.08 * (this.age / this.duration);
    const jx = Math.sin(this.age * 37) * 0.8 + Math.sin(this.age * 23) * 0.6;
    const jy = Math.cos(this.age * 31) * 0.8;

    ctx.save();
    ctx.globalAlpha = env;
    // ① 背景：中间深海蓝、四周青蓝
    ctx.drawImage(this.bg, 0, 0);

    ctx.translate(W / 2 + jx, H / 2 + jy);
    ctx.scale(zoom, zoom);
    ctx.translate(-W / 2, -H / 2);

    // ② 流动的白色冰雾（柔光贴图，叠加发光）
    ctx.globalCompositeOperation = "lighter";
    const mistSprite = getGlowSprite("rgba(170, 215, 255, 0.5)");
    for (const m of this.mist) {
      ctx.globalAlpha = 0.18 * env;
      ctx.drawImage(mistSprite, m.x - m.r, m.y - m.r * 0.6, m.r * 2, m.r * 1.2);
    }

    // ③ 冰花的光晕：把冰花缩小到 1/4 再放大贴回来
    if (this.bloomDirty) {
      this.bloomDirty = false;
      this.bctx.clearRect(0, 0, this.bloom.width, this.bloom.height);
      this.bctx.drawImage(this.layer, 0, 0, this.bloom.width, this.bloom.height);
    }
    ctx.globalAlpha = 0.9 * env;
    ctx.drawImage(this.bloom, 0, 0, W, H);

    // ④ 冰花本体
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = env;
    ctx.drawImage(this.layer, 0, 0);

    // ⑤ 钻石般的闪光：已经长出来的叶尖，随机一闪一闪（十字星芒）
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.2;
    for (const g of this.glints) {
      if (g.t > this.age) continue;
      const tw = Math.sin(this.age * g.speed + g.phase);
      if (tw < 0.75) continue; // 大部分时间是暗的，只有偶尔一闪
      const r = 9 * (tw - 0.75) * 4;
      ctx.globalAlpha = env * (tw - 0.75) * 4;
      ctx.beginPath();
      ctx.moveTo(g.x - r, g.y);
      ctx.lineTo(g.x + r, g.y);
      ctx.moveTo(g.x, g.y - r);
      ctx.lineTo(g.x, g.y + r);
      ctx.stroke();
    }

    // ⑥ 冰尘：细碎的亮点，有些带星芒和淡淡的拖尾
    const dustSprite = getGlowSprite("rgba(220, 245, 255, 1)");
    for (const d of this.dust) {
      const a = env * Math.min(1, d.life / 0.6) * Math.min(1, (d.maxLife - d.life) / 0.3 + 0.3);
      ctx.globalAlpha = a;
      const r = d.size * 3;
      ctx.drawImage(dustSprite, d.x - r, d.y - r, r * 2, r * 2);
      if (d.star) {
        ctx.globalAlpha = a * 0.7;
        ctx.beginPath();
        ctx.moveTo(d.x - r * 2, d.y);
        ctx.lineTo(d.x + r * 2, d.y);
        ctx.moveTo(d.x, d.y - r * 2);
        ctx.lineTo(d.x, d.y + r * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// =====================================================================
// 🦋 蝴蝶：夜晚的日式庭院，淡黄色的凤蝶在淡紫色的丝带烟雾之间飞舞
//   ① 3D 空间：每只蝴蝶都有深度 z，镜头慢慢往前推 → 近大远小、从身边飞过
//   ② 丝带：S 形、会扭转的半透明淡紫色缎带，慢慢游走、最后散掉
//   ③ 金色鳞粉：被翅膀扇起的气流带着，螺旋往上飘
// =====================================================================

// 发光的“贴图”：先在小画布上画好一次柔光，之后直接贴上去（比 shadowBlur 快很多）
const glowSprites = new Map();
function getGlowSprite(color) {
  if (!glowSprites.has(color)) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowSprites.set(color, c);
  }
  return glowSprites.get(color);
}

const SWALLOWTAIL = {
  wing: "#fbf1c2", // 淡黄色翅膀
  ink: "#15151f", // 黑色斑纹、勾线
  blue: "#6f9fd8", // 后翅的蓝色斑点
  orange: "#e98a4a", // 尾巴旁边的橘色斑点
};

class ButterflyEffect {
  constructor({ canvas }) {
    this.W = canvas.width;
    this.H = canvas.height;
    this.age = 0;
    this.duration = 6.5;
    this.camZ = 0; // 镜头往前推进了多少
    this.focal = this.H * 0.75; // 焦距：决定近大远小的程度

    // 蝴蝶：放在镜头前方 0.4 到 3.4 的深度之间
    this.butterflies = Array.from({ length: 42 }, () => this.makeButterfly(rand(0.4, 3.4)));

    // 丝带：5 条，每条有自己的方向、高度、卷曲的位置
    //   丝带是一段会“游过”画面的缎带：头往前走，尾巴跟在后面，两端变细
    this.ribbons = Array.from({ length: 5 }, (_, i) => {
      const fromLeft = i % 2 === 0;
      return {
        y0: this.H * (0.15 + i * 0.17 + rand(-0.05, 0.05)), // 起点高度
        y1: this.H * (0.15 + ((i + 2) % 5) * 0.17 + rand(-0.05, 0.05)), // 终点高度 → 斜斜地穿过画面
        dir: fromLeft ? 1 : -1,
        amp: this.H * rand(0.04, 0.08), // S 形起伏的大小
        k: rand(1.2, 2), // 有几个弯
        width: this.H * rand(0.025, 0.04),
        phase: rand(0, Math.PI * 2),
        curlAt: rand(0.35, 0.65), // 在哪里卷一个圈
        curlR: this.H * rand(0.1, 0.13),
        delay: i * 0.35 + rand(0, 0.2),
        travel: rand(0.28, 0.36), // 每秒往前游多少（以整条路线为 1）
        length: rand(0.55, 0.75), // 看得到的那一段有多长
      };
    });

    this.dust = []; // 金色鳞粉
    this.wisps = []; // 从丝带飘散出去的淡紫色烟

    // 背景（夜空 + 庭院剪影）不会变，先画好一次，之后每帧只要贴上去
    this.garden = document.createElement("canvas");
    this.garden.width = this.W;
    this.garden.height = this.H;
    this.paintGarden(this.garden.getContext("2d"));
  }

  makeButterfly(z) {
    return {
      x: rand(-1.4, 1.4), // 3D 空间里的左右位置（-1 到 1 大约是画面宽度）
      y: rand(-0.9, 0.7), // 上下位置
      z: this.camZ + z,
      size: rand(0.06, 0.09), // 3D 空间里的大小
      flap: rand(5, 8), // 每秒拍几次（每只不一样 → 错落有致）
      phase: rand(0, Math.PI * 2),
      glide: Math.random() < 0.4, // 有些在滑翔，翅膀只是微微颤
      drift: rand(0, Math.PI * 2),
      vx: rand(-0.12, 0.12),
    };
  }

  get done() {
    return this.age >= this.duration;
  }

  get envelope() {
    return clamp(this.age / 0.6, 0, 1) * clamp((this.duration - this.age) / 1.2, 0, 1);
  }

  // 3D → 画面座标：离镜头越近（dz 越小），放得越大、越往外
  project(x, y, z) {
    const dz = z - this.camZ;
    const s = this.focal / dz;
    return { x: this.W / 2 + x * s * (this.W / this.H) * 0.5, y: this.H / 2 + y * s * 0.5, s, dz };
  }

  update(dt) {
    this.age += dt;
    this.camZ += 0.22 * dt; // 镜头慢慢往前推

    for (const b of this.butterflies) {
      b.drift += dt * 1.3;
      b.x += (b.vx + Math.sin(b.drift) * 0.08) * dt;
      b.y += (Math.cos(b.drift * 1.3) * 0.06 - 0.03) * dt;
      // 飞到镜头后面了 → 放回远方（镜头才能一直在蝶群里穿行）
      if (b.z - this.camZ < 0.25) Object.assign(b, this.makeButterfly(rand(3, 3.4)));
      // 翅膀往下扇时，扇起一点金色鳞粉
      if (Math.random() < 3 * dt) {
        const p = this.project(b.x, b.y, b.z);
        this.dust.push({ x: p.x, y: p.y, cx: p.x, r: rand(4, 20), a: rand(0, 6.28), life: rand(1.5, 2.5), size: rand(1, 2.2) * Math.min(2, p.s / 300) });
      }
    }
    // 整个画面里也有到处飘的金色光点
    if (this.age < this.duration - 1.2) {
      for (let k = 0; k < 4; k++) {
        const x = rand(0, this.W);
        this.dust.push({ x, y: rand(this.H * 0.2, this.H * 1.05), cx: x, r: rand(5, 30), a: rand(0, 6.28), life: rand(2, 3.5), size: rand(0.8, 2) });
      }
    }
    // 丝带一边游、一边像香气一样飘散：从丝带上随机的位置“散”出一小团淡紫色的烟
    for (const r of this.ribbons) {
      const head = (this.age - r.delay) * r.travel;
      if (head <= 0 || head - r.length >= 1 || this.age > this.duration - 0.8) continue;
      if (Math.random() < 14 * dt) {
        // 越靠近尾巴（越旧的部分）越容易散开
        const t = Math.random() ** 1.8; // 0 = 尾巴
        const u = head - r.length + t * r.length;
        if (u < 0 || u > 1) continue;
        const p = this.ribbonPoint(r, u);
        this.wisps.push({ x: p.x, y: p.y, vx: rand(-15, 15), vy: rand(-30, -10), r: r.width * rand(0.8, 1.6), grow: rand(20, 40), life: rand(1.2, 2), maxLife: 2 });
      }
    }
    for (const w of this.wisps) {
      w.x += w.vx * dt + Math.sin(this.age * 1.5 + w.y * 0.02) * 12 * dt; // 被气流带着轻轻摆动
      w.y += w.vy * dt;
      w.r += w.grow * dt; // 越飘越散开
      w.life -= dt;
    }
    this.wisps = this.wisps.filter((w) => w.life > 0);

    for (const d of this.dust) {
      d.a += dt * 2.5; // 螺旋：一边转圈
      d.y -= 28 * dt; // 一边往上飘
      d.x = d.cx + Math.cos(d.a) * d.r;
      d.life -= dt;
    }
    this.dust = this.dust.filter((d) => d.life > 0);
  }

  draw(ctx) {
    const env = this.envelope;
    ctx.save();
    ctx.globalAlpha = env;
    this.drawGarden(ctx);

    // 远的先画、近的后画（近的才会盖住远的）
    const sorted = [...this.butterflies].sort((a, b) => b.z - a.z);
    const far = sorted.filter((b) => b.z - this.camZ > 1.4);
    const near = sorted.filter((b) => b.z - this.camZ <= 1.4);

    for (const b of far) this.drawButterfly(ctx, b, env);
    this.drawRibbons(ctx, env); // 丝带在中间那一层：远的蝴蝶在后面、近的在前面
    this.drawDust(ctx, env);
    for (const b of near) this.drawButterfly(ctx, b, env);
    ctx.restore();
  }

  // 背景随镜头推进稍微放大（远的东西放大得很少 → 有纵深感）
  drawGarden(ctx) {
    const zoom = 1 + this.camZ * 0.05;
    const w = this.W * zoom;
    const h = this.H * zoom;
    ctx.drawImage(this.garden, (this.W - w) / 2, this.H * 0.7 - h * 0.7, w, h);
  }

  // 背景：深蓝紫色的夜空 + 庭院的树丛剪影（只在一开始画一次）
  paintGarden(ctx) {
    const W = this.W;
    const H = this.H;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#1b1745");
    sky.addColorStop(0.55, "#2a2357");
    sky.addColorStop(1, "#0a1a17");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    // 树丛：一排深绿色的圆形树冠
    ctx.fillStyle = "#0b1712";
    for (let i = 0; i < 18; i++) {
      const x = (i / 17) * W * 1.1 - W * 0.05;
      const r = H * (0.08 + 0.07 * stableRandom(i * 3));
      ctx.beginPath();
      ctx.arc(x, H * 0.58 - r * 0.3 * stableRandom(i), r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 草地
    ctx.fillStyle = "#0d1f17";
    ctx.fillRect(0, H * 0.6, W, H * 0.45);
    ctx.restore();
  }

  // 丝带路线上第 u 个位置（u = 0 到 1）
  ribbonPoint(r, u) {
    const W = this.W;
    let x = r.dir > 0 ? -W * 0.1 + u * W * 1.2 : W * 1.1 - u * W * 1.2;
    let y = lerp(r.y0, r.y1, u) + Math.sin(u * Math.PI * 2 * r.k + r.phase + this.age * 0.7) * r.amp;
    // 卷一个圈：在 curlAt 前后一小段，加上一个“往回绕一圈”的偏移
    //   往回绕的速度比往前走还快 → 路线就会真的绕出一个圈
    const d = (u - r.curlAt) / 0.12; // -1 到 1 之间才有圈
    if (Math.abs(d) < 1) {
      const ang = (d + 1) * Math.PI; // 0 → 2π：绕一整圈
      const fade = 0.5 * (1 + Math.cos(Math.PI * d)); // 圈的前后平滑地接回去
      x -= r.dir * Math.sin(ang) * r.curlR * fade;
      y -= (1 - Math.cos(ang)) * r.curlR * 0.8 * fade;
    }
    return { x, y };
  }

  // 丝带：半透明淡紫色缎带，宽度随“扭转”变化（宽度 × cos）→ 像缎带翻面
  drawRibbons(ctx, env) {
    const vanish = clamp((this.duration - this.age) / 2, 0, 1); // 最后 2 秒慢慢散掉
    for (const r of this.ribbons) {
      const head = (this.age - r.delay) * r.travel; // 丝带的头走到哪里了
      const tail = head - r.length;
      if (head <= 0 || tail >= 1) continue;
      const N = 90;
      const mid = [];
      for (let i = 0; i <= N; i++) {
        const u = tail + (i / N) * r.length;
        if (u < 0 || u > 1) continue;
        const p = this.ribbonPoint(r, u);
        const t = i / N; // 0 = 尾巴，1 = 头
        // 两端变细（sin 曲线），中间最宽；扭转让宽度忽宽忽窄
        const twist = 0.3 + 0.7 * Math.abs(Math.cos(u * Math.PI * 3 + this.age * 0.9));
        // 越往尾巴越散开（变宽），也越被气流吹得歪歪扭扭
        const spread = 1 + (1 - t) * 1.2;
        // 头是尖的（sin 走到 π = 0）；尾巴还开着、往外散
        const w = r.width * Math.sin(Math.PI * (0.15 + 0.85 * t)) ** 0.6 * twist * spread * (1 + (1 - vanish) * 0.6);
        const wob = Math.sin(u * 25 + this.age * 2.5) * r.width * 0.8 * (1 - t);
        mid.push({ x: p.x, y: p.y + wob, w });
      }
      if (mid.length < 3) continue;
      // 法线
      for (let i = 0; i < mid.length; i++) {
        const a = mid[Math.max(0, i - 1)];
        const b = mid[Math.min(mid.length - 1, i + 1)];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        mid[i].nx = -(b.y - a.y) / len;
        mid[i].ny = (b.x - a.x) / len;
      }
      const alpha = env * vanish;

      // 渐层：尾巴完全透明 → 往头慢慢变实（尾巴像香气一样慢慢淡掉）
      const tailP = mid[0];
      const headP = mid[mid.length - 1];
      const grad = (a) => {
        const g = ctx.createLinearGradient(tailP.x, tailP.y, headP.x, headP.y);
        g.addColorStop(0, "rgba(217, 194, 255, 0)");
        g.addColorStop(0.3, `rgba(217, 194, 255, ${a * 0.75})`);
        g.addColorStop(1, `rgba(225, 205, 255, ${a})`);
        return g;
      };
      // 同一条丝带画 3 层：外层最宽最淡、内层最窄最亮 → 边缘柔柔的，没有硬边
      for (const [scale, a] of [[1.7, 0.22], [1.1, 0.45], [0.55, 0.45]]) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = grad(a);
        ctx.beginPath();
        mid.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x + p.nx * p.w * scale, p.y + p.ny * p.w * scale) : ctx.lineTo(p.x + p.nx * p.w * scale, p.y + p.ny * p.w * scale)));
        for (let i = mid.length - 1; i >= 0; i--) ctx.lineTo(mid[i].x - mid[i].nx * mid[i].w * scale, mid[i].y - mid[i].ny * mid[i].w * scale);
        ctx.closePath();
        ctx.fill();
      }

      // 丝绸的细纹：淡淡的白线，也是尾巴透明、头比较清楚
      const lineGrad = ctx.createLinearGradient(tailP.x, tailP.y, headP.x, headP.y);
      lineGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
      lineGrad.addColorStop(0.4, "rgba(255, 255, 255, 0)"); // 尾巴散开的地方没有细纹
      lineGrad.addColorStop(1, "rgba(255, 255, 255, 0.4)");
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (const o of [-0.4, 0, 0.4]) {
        mid.forEach((p, i) => {
          const x = p.x + p.nx * p.w * o;
          const y = p.y + p.ny * p.w * o;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
      }
      ctx.stroke();
    }

    // 飘散出去的淡紫色烟（柔光贴图，越飘越大、越淡）
    const sprite = getGlowSprite("rgba(210, 185, 255, 1)");
    for (const w of this.wisps) {
      const k = w.life / w.maxLife;
      ctx.globalAlpha = env * 0.3 * k * Math.min(1, (1 - k) * 6);
      ctx.drawImage(sprite, w.x - w.r, w.y - w.r * 0.7, w.r * 2, w.r * 1.4);
    }
  }

  drawDust(ctx, env) {
    ctx.globalCompositeOperation = "lighter";
    const sprite = getGlowSprite("rgba(255, 200, 80, 1)");
    for (const d of this.dust) {
      const a = env * Math.min(1, d.life / 0.5);
      const r = d.size * 4;
      ctx.globalAlpha = a * 0.8;
      ctx.drawImage(sprite, d.x - r, d.y - r, r * 2, r * 2);
      ctx.globalAlpha = a;
      ctx.fillStyle = "#fff4c8";
      ctx.fillRect(d.x - d.size * 0.5, d.y - d.size * 0.5, d.size, d.size);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // 一只凤蝶（正面朝镜头，背部朝上）
  drawButterfly(ctx, b, env) {
    const p = this.project(b.x, b.y, b.z);
    const s = b.size * p.s; // 画面上的大小（像素）
    if (s < 2 || p.x < -s * 3 || p.x > this.W + s * 3 || p.y < -s * 3 || p.y > this.H + s * 3) return;
    // 景深：太近的蝴蝶变淡（假装“失焦”），远的也稍微淡一点（空气感）
    const focus = p.dz < 0.7 ? clamp((p.dz - 0.25) / 0.45, 0.15, 1) : clamp(1.3 - p.dz * 0.18, 0.55, 1);
    // 振翅：滑翔的只是微微颤动；拍翅的会大幅开合
    const beat = Math.cos(this.age * b.flap * Math.PI * 2 * 0.5 + b.phase);
    const open = b.glide ? 0.85 + 0.12 * beat : 0.2 + 0.8 * Math.abs(beat);

    ctx.save();
    ctx.globalAlpha = env * focus;
    // 后面的柔光
    ctx.globalCompositeOperation = "lighter";
    const glow = getGlowSprite("rgba(255, 240, 180, 0.6)");
    ctx.drawImage(glow, p.x - s * 2, p.y - s * 2, s * 4, s * 4);
    ctx.globalCompositeOperation = "source-over";

    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(b.drift) * 0.25); // 飞的时候身体微微摆动
    // 翅膀用预先画好的贴图（一开始画一次），每帧只要缩放、翻转贴上去 → 快很多
    const sprite = getWingSprite();
    const k = s / WING_SPRITE_S;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side * open * k, k);
      ctx.drawImage(sprite, -WING_SPRITE_PAD, -WING_SPRITE_S - WING_SPRITE_PAD);
      ctx.restore();
    }
    const simple = s < 10;
    // 身体
    ctx.fillStyle = SWALLOWTAIL.ink;
    ctx.beginPath();
    ctx.ellipse(0, s * 0.05, s * 0.06, s * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!simple) {
      ctx.strokeStyle = SWALLOWTAIL.ink;
      ctx.lineWidth = Math.max(1, s * 0.02);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.35);
      ctx.quadraticCurveTo(-s * 0.1, -s * 0.6, -s * 0.22, -s * 0.72);
      ctx.moveTo(0, -s * 0.35);
      ctx.quadraticCurveTo(s * 0.1, -s * 0.6, s * 0.22, -s * 0.72);
      ctx.stroke();
    }
    ctx.restore();
  }

}

// 单边翅膀的贴图：画在 s = 100 的大小，之后缩放使用
const WING_SPRITE_S = 100;
const WING_SPRITE_PAD = 6;
let wingSprite = null;
function getWingSprite() {
  if (!wingSprite) {
    const S = WING_SPRITE_S;
    const P = WING_SPRITE_PAD;
    wingSprite = document.createElement("canvas");
    wingSprite.width = S * 1.1 + P * 2;
    wingSprite.height = S * 1.95 + P * 2;
    const g = wingSprite.getContext("2d");
    g.translate(P, S + P); // 让 (0, 0) = 身体的位置
    drawSwallowtailWing(g, S);
  }
  return wingSprite;
}

// 单边的翅膀（往右长；左边用 scale(-1) 翻过来）
function drawSwallowtailWing(ctx, s) {
  // 前翅：从身体往右上方伸出去，尖尖的翼端
  const fore = new Path2D();
  fore.moveTo(s * 0.04, -s * 0.3);
  fore.bezierCurveTo(s * 0.35, -s * 0.75, s * 0.85, -s * 0.95, s * 1.05, -s * 0.85);
  fore.bezierCurveTo(s * 0.95, -s * 0.45, s * 0.75, -s * 0.1, s * 0.45, 0);
  fore.lineTo(s * 0.04, s * 0.02);
  fore.closePath();
  // 后翅：圆圆的，下面拖着一条“燕尾”
  const hind = new Path2D();
  hind.moveTo(s * 0.04, -s * 0.02);
  hind.bezierCurveTo(s * 0.55, -s * 0.05, s * 0.75, s * 0.3, s * 0.55, s * 0.55);
  hind.lineTo(s * 0.42, s * 0.9); // 燕尾
  hind.lineTo(s * 0.32, s * 0.6);
  hind.bezierCurveTo(s * 0.2, s * 0.65, s * 0.06, s * 0.5, s * 0.03, s * 0.25);
  hind.closePath();

  ctx.fillStyle = SWALLOWTAIL.wing;
  ctx.fill(hind);
  ctx.fill(fore);

  {
    // 斑纹只画在翅膀里面（clip = 只在这个形状里面画）
    ctx.save();
    ctx.clip(fore);
    ctx.strokeStyle = SWALLOWTAIL.ink;
    // 前翅：几条从前缘往下的黑色粗条纹
    ctx.lineWidth = s * 0.08;
    ctx.beginPath();
    for (const t of [0.2, 0.42, 0.62]) {
      ctx.moveTo(s * (0.15 + t), -s * (0.45 + t * 0.5));
      ctx.lineTo(s * (0.05 + t * 0.6), -s * 0.05);
    }
    ctx.stroke();
    // 外缘的黑色宽边
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    ctx.moveTo(s * 1.05, -s * 0.85);
    ctx.bezierCurveTo(s * 0.95, -s * 0.45, s * 0.75, -s * 0.1, s * 0.45, 0);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.clip(hind);
    // 后翅外缘的黑边，里面有一排蓝色斑点
    ctx.strokeStyle = SWALLOWTAIL.ink;
    ctx.lineWidth = s * 0.22;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, -s * 0.05);
    ctx.bezierCurveTo(s * 0.8, s * 0.25, s * 0.6, s * 0.6, s * 0.2, s * 0.62);
    ctx.stroke();
    ctx.fillStyle = SWALLOWTAIL.blue;
    for (const [x, y] of [[0.62, 0.2], [0.6, 0.38], [0.48, 0.52], [0.32, 0.58]]) {
      ctx.beginPath();
      ctx.arc(s * x, s * y, s * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    // 靠近身体的橘色斑点
    ctx.fillStyle = SWALLOWTAIL.orange;
    ctx.beginPath();
    ctx.arc(s * 0.15, s * 0.5, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 黑色细线勾边（手绘感）
  ctx.strokeStyle = SWALLOWTAIL.ink;
  ctx.lineWidth = Math.max(0.8, s * 0.025);
  ctx.lineJoin = "round";
  ctx.stroke(fore);
  ctx.stroke(hind);
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
