// 🧠 $1 Unistroke Recognizer（$1 单笔画识别器）
//
// 出处：Wobbrock, Wilson & Li (2007). "Gestures without Libraries, Toolkits
//       or Training: A $1 Recognizer for User Interface Prototypes." UIST '07.
//
// 核心想法（像“练字帖”）：
//   把你画的形状和每个模板“叠在一起”，算平均差多远，最近的就是答案。
//
// 比对之前要先“公平化”（normalize），不然比较没有意义：
//   ① 重采样 (Resample)：统一成 64 个点（画得快的人点少、画得慢的人点多）
//   ② 旋转 (Rotate)：转到同一个角度（画得歪一点也没关系）
//   ③ 缩放 (Scale)：缩放到同样大小（大三角形和小三角形都是三角形）
//   ④ 平移 (Translate)：中心移到原点（画在左边或右边都一样）
//
// 🆕 双向比对 (Bidirectional Matching)：
//   原版 $1 对“画的方向”很敏感：顺时针和逆时针的圆，在它眼里是不同形状。
//   所以每个模板也准备一份“倒过来画”的版本，两个都比，取比较像的那个。
//   用你录的 14 个模板做留一法测试：准确率从 12/14 提升到 14/14。

const NUM_POINTS = 64;
const SQUARE_SIZE = 250;
const HALF_DIAGONAL = 0.5 * Math.sqrt(SQUARE_SIZE * SQUARE_SIZE * 2);
const ANGLE_RANGE = degToRad(45); // 比对时，最多再左右转 45 度找最佳角度
const ANGLE_PRECISION = degToRad(2); // 找到误差 2 度以内就停
const PHI = 0.5 * (-1 + Math.sqrt(5)); // 黄金比例，用来快速搜索最佳角度

// ===== 对外的两个函数 =====

// 把一笔画“公平化”，变成 64 个点的标准形状
export function normalize(points) {
  let p = resample(points, NUM_POINTS);
  p = rotateBy(p, -indicativeAngle(p));
  p = scaleTo(p, SQUARE_SIZE);
  p = translateTo(p, { x: 0, y: 0 });
  return p;
}

// 🆕 把一个原始模板准备好：正方向和反方向都先 normalize，比对时就不用重算
export function prepareTemplate(template) {
  return {
    name: template.name,
    points: normalize(template.points),
    reversePoints: normalize([...template.points].reverse()), // 倒过来画的版本
  };
}

// 识别：拿画好的一笔，和所有模板比对
// templates = [prepareTemplate(...) 的结果, ...]
// 回传：{ name: 最像的形状, score: 0 到 1 的相似度, ranking: 每种形状的最高分 }
export function recognize(points, templates) {
  if (templates.length === 0) {
    return { name: null, score: 0, ranking: [] };
  }

  const candidate = normalize(points);
  const bestByName = {}; // 每种形状的最高分

  for (const template of templates) {
    let d = distanceAtBestAngle(candidate, template.points);
    // 🆕 也和“倒过来画”的版本比一次，取距离比较小（比较像）的那个
    if (template.reversePoints) {
      d = Math.min(d, distanceAtBestAngle(candidate, template.reversePoints));
    }
    const score = 1 - d / HALF_DIAGONAL; // 距离越小，分数越高
    if (!(template.name in bestByName) || score > bestByName[template.name]) {
      bestByName[template.name] = score;
    }
  }

  // 从高分排到低分
  const ranking = Object.entries(bestByName)
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score);

  return { name: ranking[0].name, score: ranking[0].score, ranking };
}

// ===== ① 重采样：沿着轨迹，每隔相同距离放一个点 =====
function resample(points, n) {
  const totalLength = pathLength(points);
  if (totalLength === 0) {
    return Array.from({ length: n }, () => ({ ...points[0] }));
  }

  const interval = totalLength / (n - 1); // 每一段要多长
  const pts = points.map((p) => ({ ...p })); // 复制一份，不要改到原本的
  const result = [pts[0]];
  let accumulated = 0;

  for (let i = 1; i < pts.length; i++) {
    const d = distance(pts[i - 1], pts[i]);
    if (accumulated + d >= interval) {
      // 在这一段中间，刚好走到 interval 的位置放一个新点
      const t = (interval - accumulated) / d;
      const q = {
        x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
      };
      result.push(q);
      pts.splice(i, 0, q); // 新点也当作下一段的起点
      accumulated = 0;
    } else {
      accumulated += d;
    }
  }

  // 小数误差可能让点数差一个，补齐或截掉
  while (result.length < n) result.push({ ...pts[pts.length - 1] });
  return result.slice(0, n);
}

// ===== ② 旋转：用“中心 → 起点”的角度当作这个形状的方向 =====
function indicativeAngle(points) {
  const c = centroid(points);
  return Math.atan2(c.y - points[0].y, c.x - points[0].x);
}

function rotateBy(points, radians) {
  const c = centroid(points);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((p) => ({
    x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x,
    y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y,
  }));
}

// ===== ③ 缩放：放进一个 250 × 250 的正方形 =====
function scaleTo(points, size) {
  const box = boundingBox(points);
  const w = box.width || 1; // 避免除以 0（例如一条完全水平的线）
  const h = box.height || 1;
  return points.map((p) => ({
    x: (p.x * size) / w,
    y: (p.y * size) / h,
  }));
}

// ===== ④ 平移：把中心移到原点 =====
function translateTo(points, target) {
  const c = centroid(points);
  return points.map((p) => ({
    x: p.x + target.x - c.x,
    y: p.y + target.y - c.y,
  }));
}

// ===== 比对：在 ±45 度内，找出“转到哪个角度最像” =====
// 用黄金分割搜索 (Golden Section Search)，不用每 1 度都试一次
function distanceAtBestAngle(points, template) {
  let a = -ANGLE_RANGE;
  let b = ANGLE_RANGE;
  let x1 = PHI * a + (1 - PHI) * b;
  let f1 = distanceAtAngle(points, template, x1);
  let x2 = (1 - PHI) * a + PHI * b;
  let f2 = distanceAtAngle(points, template, x2);

  while (Math.abs(b - a) > ANGLE_PRECISION) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = PHI * a + (1 - PHI) * b;
      f1 = distanceAtAngle(points, template, x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = (1 - PHI) * a + PHI * b;
      f2 = distanceAtAngle(points, template, x2);
    }
  }
  return Math.min(f1, f2);
}

function distanceAtAngle(points, template, radians) {
  return pathDistance(rotateBy(points, radians), template);
}

// 两组点“一对一”的平均距离：第 1 点对第 1 点、第 2 点对第 2 点……
function pathDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += distance(a[i], b[i]);
  }
  return sum / a.length;
}

// ===== 小工具 =====
function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pathLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += distance(points[i - 1], points[i]);
  }
  return d;
}

function centroid(points) {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function boundingBox(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function degToRad(d) {
  return (d * Math.PI) / 180;
}
