// 🪄 咒语表：每个形状对应哪个魔法（中英双语）
//   游戏（main.js）和审核页（admin.js）都用这一份 → 改名字只要改这里
//   key（triangle、circle…）要跟数据库 supabase/schema.sql 里允许的形状一样

export const SPELLS = {
  triangle: { shape: "△ 三角形", shapeEn: "Triangle", spell: "🔥 火焰弹", spellEn: "Fireball" },
  circle: { shape: "○ 圆形", shapeEn: "Circle", spell: "⭕ 光圈", spellEn: "Light Ring" },
  lightning: { shape: "⚡ 闪电", shapeEn: "Lightning", spell: "⚡ 闪电", spellEn: "Lightning" },
  star: { shape: "★ 五角星", shapeEn: "Star", spell: "🌟 星光冲击", spellEn: "Star Rush" },
  spiral: { shape: "🌀 螺旋", shapeEn: "Spiral", spell: "🌪️ 龙卷风", spellEn: "Tornado" },
  wave: { shape: "~ 波浪", shapeEn: "Wave", spell: "🐉 水龙", spellEn: "Water Dragon" },
  mshape: { shape: "M 字", shapeEn: "M Shape", spell: "⛰️ 落石", spellEn: "Rockfall" },
  infinity: { shape: "∞ 无限", shapeEn: "Infinity", spell: "❄️ 冰冻", spellEn: "Freeze" },
  loop: { shape: "ℓ 小圈尾巴", shapeEn: "Loop", spell: "🦋 蝴蝶", spellEn: "Butterflies" },
};
