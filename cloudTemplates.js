// ☁️ 共享模板：跟 Supabase 沟通的地方
//
// 不用额外的套件，直接用浏览器内建的 fetch 呼叫 Supabase 的 REST API
//   生活例子：REST API 就像餐厅的点餐窗口——
//     GET  = “请给我看菜单”（读取资料）
//     POST = “我要点这个”（新增资料）
//   每次都要出示 apikey（publishable key），窗口才会理你
//
// 📌 连不上 Supabase（没网络、项目被暂停…）时，一律安静地失败，
//    游戏照样只用 templates.json 继续玩，不会坏掉

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabaseConfig.js";

const TIMEOUT_MS = 6000; // 等太久就放弃，不要让游戏一直卡着

// 共用的“出示 apikey 去窗口办事”
async function rest(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    // 有些请求（例如新增）不会回传内容
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  } finally {
    clearTimeout(timer);
  }
}

// 读取所有“已通过审核”的模板
//   回传格式跟 templates.json 一样：[{ name, points, playerId }, ...]
//   失败时回传 null（代表“连不上”，跟“有连上但是 0 个”不一样）
export async function fetchApprovedTemplates() {
  try {
    const rows = await rest("/rest/v1/shared_templates?select=shape,points,player_id&status=eq.approved");
    return rows.map((row) => ({ name: row.shape, points: row.points, playerId: row.player_id }));
  } catch (error) {
    console.warn("☁️ 读取共享模板失败，先只用 templates.json：", error.message);
    return null;
  }
}

// ===== 🤝 贡献模式用的 =====

// 匿名玩家编号：第一次来时随机产生一个，存在这台电脑的浏览器里
//   生活例子：像排队的号码牌——只知道你是“第 a3f9 号”，不知道你是谁
const PLAYER_ID_KEY = "magicGame.playerId";
let memoryPlayerId = null; // 浏览器不让存的时候（例如无痕模式），就先记在记忆体里

export function getPlayerId() {
  try {
    let id = localStorage.getItem(PLAYER_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PLAYER_ID_KEY, id);
    }
    return id;
  } catch {
    memoryPlayerId ??= crypto.randomUUID();
    return memoryPlayerId;
  }
}

// 查询“我每个形状已经交了几个”（被拒绝的不算）
//   回传 { star: 3, circle: 1, ... }；连不上时回传 null
export async function fetchMyCounts() {
  try {
    const rows = await rest("/rest/v1/rpc/get_contribution_counts", {
      method: "POST",
      body: JSON.stringify({ p_player: getPlayerId() }),
    });
    const counts = {};
    for (const row of rows) counts[row.shape] = Number(row.count);
    return counts;
  } catch (error) {
    console.warn("☁️ 查询贡献数量失败：", error.message);
    return null;
  }
}

// 上传一笔：状态一律是 pending（待审核），由数据库规则保证
//   回传 "ok" / "limit"（这个形状已经交满 5 个）/ "error"
export async function submitTemplate({ shape, points, recognizedAs, score }) {
  try {
    await rest("/rest/v1/shared_templates", {
      method: "POST",
      // return=minimal：新增完不用把资料传回来（玩家本来就看不到 pending 的资料）
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        shape,
        points: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
        player_id: getPlayerId(),
        recognized_as: recognizedAs ?? null,
        score: score == null ? null : Math.round(score * 1000) / 1000,
      }),
    });
    return "ok";
  } catch (error) {
    console.warn("☁️ 上传失败：", error.message);
    return error.message.includes("LIMIT_REACHED") ? "limit" : "error";
  }
}
