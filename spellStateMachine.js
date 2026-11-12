// 🚦 施法状态机 (State Machine)
//
// 😴 IDLE（等待）
//    │ 连续几帧都是“只伸食指”
//    ▼
// ✍️ DRAWING（画画中）
//    ├─ 手消失超过宽限期 → 💨 FIZZLE（施法失败）
//    │ 停住 0.6 秒
//    ├─ 轨迹太短 → 直接丢掉，回到 IDLE（什么都不做）
//    ▼
// 🧠 RECOGNIZING（识别中）
//    ├─ 置信度够高 → ✨ CAST（施法成功）
//    └─ 置信度太低 → 💨 FIZZLE（施法失败）
//    ▼
// ⏳ COOLDOWN（冷却 1 秒）→ 回到 IDLE
//
// 注意：RECOGNIZING、CAST、FIZZLE 都是“一瞬间”的状态，
//       会马上接着进入 COOLDOWN。特效在冷却期间播放。
//
// 这个文件只负责“规则”，不负责画画，所以可以单独测试。

export const State = Object.freeze({
  IDLE: "IDLE",
  DRAWING: "DRAWING",
  RECOGNIZING: "RECOGNIZING",
  CAST: "CAST",
  FIZZLE: "FIZZLE",
  COOLDOWN: "COOLDOWN",
});

// ===== 可以调的参数 =====
export const CONFIG = Object.freeze({
  START_FRAMES: 3, // 连续几帧“只伸食指”才开始画（防止一闪而过的误判）
  CANCEL_FRAMES: 8, // 还没开始移动时，连续几帧“放下食指”才算取消（约 0.27 秒）
  STILL_RADIUS_PX: 20, // 指尖在这个范围内晃动，都算“停住”
  STILL_TIME_MS: 600, // 停住多久算画完
  MIN_PATH_PX: 200, // 轨迹总长度至少要多长，太短就丢掉
  GRACE_PERIOD_MS: 300, // 宽限期：跟丢多久才算手真的离开
  COOLDOWN_MS: 1000, // 冷却时间
  MAX_POINTS: 600, // 一笔最多几个点（约 20 秒），防止无限画下去
  MIN_CONFIDENCE: 0.75, // 识别的置信度门槛（模拟测试：正确形状 85% 以上，乱划 68% 以下）
});

// 里程碑 ⑥ 之前的“假识别器”：不管画什么都当作成功
function placeholderRecognize() {
  return { name: "（识别功能在里程碑 ⑥）", confidence: 1 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class SpellStateMachine {
  constructor({
    config = CONFIG,
    recognize = placeholderRecognize,
    onTransition = () => {},
  } = {}) {
    this.config = config;
    this.recognize = recognize; // 🧠 识别器（之后换成真的）
    this.onTransition = onTransition; // 状态改变时通知外面（画面、console）

    this.state = State.IDLE;
    this.poseFrames = 0; // 连续几帧“只伸食指”
    this.notPointingFrames = 0; // 画画中，连续几帧“没有只伸食指”
    this.stroke = []; // 这一笔的所有点（像素）
    this.pathLength = 0; // 这一笔的总长度
    this.result = null; // 施法结果

    this.lastSeenTime = 0; // 最后一次看到手的时间
    this.missedFrames = 0; // 连续跟丢几帧（补点用）
    this.anchor = null; // 判断“停住”的基准点
    this.stillSince = 0; // 从什么时候开始停住
    this.cooldownUntil = 0; // 冷却到什么时候结束
  }

  // 每一帧都调用一次
  // frame = { now: 时间, hasHand: 有没有手, tip: 指尖{x,y}, pointing: 是否只伸食指 }
  update(frame) {
    switch (this.state) {
      case State.IDLE:
        this.updateIdle(frame);
        break;
      case State.DRAWING:
        this.updateDrawing(frame);
        break;
      case State.COOLDOWN:
        this.updateCooldown(frame);
        break;
    }
  }

  // 😴 IDLE：等玩家伸出食指
  updateIdle({ now, hasHand, tip, pointing }) {
    if (hasHand && pointing) {
      this.poseFrames++;
    } else {
      this.poseFrames = 0;
    }

    if (this.poseFrames >= this.config.START_FRAMES) {
      this.startDrawing(now, tip);
    }
  }

  startDrawing(now, tip) {
    this.stroke = [tip];
    this.pathLength = 0;
    this.notPointingFrames = 0;
    this.lastSeenTime = now;
    this.missedFrames = 0;
    this.anchor = tip;
    this.stillSince = now;
    this.transition(State.DRAWING);
  }

  // ✍️ DRAWING：记录轨迹，判断什么时候结束
  updateDrawing({ now, hasHand, tip, pointing }) {
    // --- 没看到手 ---
    if (!hasHand) {
      this.missedFrames++;
      if (now - this.lastSeenTime > this.config.GRACE_PERIOD_MS) {
        this.fizzle(now, "手离开了画面 · Hand left the frame");
      }
      return;
    }

    // --- 看到手 ---
    // 刚从跟丢恢复：先补点
    if (this.missedFrames > 0) {
      this.fillGap(this.stroke[this.stroke.length - 1], tip, this.missedFrames);
    }
    this.missedFrames = 0;
    this.lastSeenTime = now;
    this.addPoint(tip);

    const notStartedYet = this.pathLength < this.config.MIN_PATH_PX;

    // 还没开始移动，就放下食指 → 当作取消，回到 IDLE
    // 🆕 只在“还没开始移动”时检查：手在移动时，手势判断本来就不稳，
    //    一旦开始画，就不再管手势，避免画到一半被误判成取消
    const hasStartedMoving = this.pathLength > this.config.STILL_RADIUS_PX * 2;
    if (!hasStartedMoving) {
      this.notPointingFrames = pointing ? 0 : this.notPointingFrames + 1;
      if (this.notPointingFrames >= this.config.CANCEL_FRAMES) {
        this.clearStroke();
        this.transition(State.IDLE, { reason: "放下食指，取消" });
        return;
      }
    } else {
      this.notPointingFrames = 0; // 已经在画了：计数归零
    }

    // 判断“停住”：离开基准点太远，就重新计时
    if (distance(tip, this.anchor) > this.config.STILL_RADIUS_PX) {
      this.anchor = tip;
      this.stillSince = now;
    } else if (now - this.stillSince >= this.config.STILL_TIME_MS) {
      if (notStartedYet) {
        // 🆕 只是指着不动：不要退回 IDLE（会造成闪烁），
        //    而是把起点移到现在的位置，继续等玩家开始画
        this.stroke = [tip];
        this.pathLength = 0;
        this.stillSince = now;
      } else {
        this.endStroke(now);
        return;
      }
    }

    // 画太久了，强制结束
    if (this.stroke.length >= this.config.MAX_POINTS) {
      this.endStroke(now);
    }
  }

  addPoint(point) {
    const last = this.stroke[this.stroke.length - 1];
    this.pathLength += distance(last, point);
    this.stroke.push(point);
  }

  // 补点：跟丢了几帧，就在两点之间平均插入几个点
  fillGap(from, to, count) {
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      this.addPoint({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      });
    }
  }

  // 一笔画完了
  endStroke(now) {
    // 太短：当作不小心的乱动，安静地丢掉
    if (this.pathLength < this.config.MIN_PATH_PX) {
      this.clearStroke();
      this.transition(State.IDLE, { reason: "轨迹太短，丢掉" });
      return;
    }

    // 🧠 识别
    this.transition(State.RECOGNIZING);
    const result = this.recognize(this.stroke);

    if (result && result.confidence >= this.config.MIN_CONFIDENCE) {
      this.result = { success: true, ...result };
      this.transition(State.CAST, this.result);
      this.startCooldown(now);
    } else {
      // 识别器有提供原因就用它的，没有就用预设的
      this.fizzle(now, result?.reason ?? "认不出这个形状 · Shape not recognized");
    }
  }

  // 💨 施法失败
  fizzle(now, reason) {
    this.result = { success: false, reason };
    this.transition(State.FIZZLE, this.result);
    this.startCooldown(now);
  }

  startCooldown(now) {
    this.cooldownUntil = now + this.config.COOLDOWN_MS;
    this.transition(State.COOLDOWN);
  }

  // ⏳ COOLDOWN：时间到就回到 IDLE
  updateCooldown({ now }) {
    if (now >= this.cooldownUntil) {
      this.clearStroke();
      this.result = null;
      this.transition(State.IDLE);
    }
  }

  clearStroke() {
    this.stroke = [];
    this.pathLength = 0;
    this.poseFrames = 0;
  }

  transition(to, info) {
    const from = this.state;
    this.state = to;
    this.onTransition(from, to, info);
  }

  // ===== 给画面用的小工具 =====

  // 停住的进度：0 到 1（画面上的“进度圈”会用到）
  stillProgress(now) {
    if (this.state !== State.DRAWING) return 0;
    if (this.pathLength < this.config.MIN_PATH_PX) return 0; // 太短的话停住也没用，不显示
    return Math.min(1, (now - this.stillSince) / this.config.STILL_TIME_MS);
  }

  // 冷却还剩几成：1（刚开始）到 0（结束）
  cooldownRemaining(now) {
    if (this.state !== State.COOLDOWN) return 0;
    return Math.max(0, (this.cooldownUntil - now) / this.config.COOLDOWN_MS);
  }
}
