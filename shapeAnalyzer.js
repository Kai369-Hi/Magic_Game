// 📐 形状分析：算出一笔画的“外框” (Bounding Box)
//
// 生活例子：包礼物 🎁——找“刚好能装下这个形状的最小盒子”
//
//   最左 minX ──────── 最右 maxX
//   │                          │  ← 最上 minY
//   │        ● 中心点          │
//   │                          │  ← 最下 maxY
//   └──────────────────────────┘
//
// 特效会用到：
//   中心点 (centerX, centerY) → 特效出现在哪里
//   size = max(宽, 高)        → 特效要多大（用“比较大的那一边”，
//                               又扁又宽或又高又瘦的形状都能反映“画得多大”）

export function getBounds(points) {
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

  const width = maxX - minX;
  const height = maxY - minY;

  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    size: Math.max(width, height),
  };
}
