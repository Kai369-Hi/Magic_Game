// 🔍 审核页：看玩家贡献的每一笔，决定通过 ✅ 或拒绝 ❌
//
// 跟 Supabase 的沟通分两种身份：
//   ① 没登入：只带 publishable key（apikey）→ 什么都改不了
//   ② 登入后：再多带一张“通行证”（access token，放在 Authorization）
//      数据库看到通行证，查 admins 名单，确认你是管理员，才让你看全部、改状态
//   生活例子：apikey 像是进商场的门；access token 像员工证，有了才能进仓库

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabaseConfig.js";
import { SPELLS } from "./spells.js";
import { DEMO_PATHS } from "./spellBook.js";

const SESSION_KEY = "magicGame.adminSession"; // 存在 sessionStorage：关掉分页就登出
const $ = (id) => document.getElementById(id);

// ===== 🔐 登入 / 通行证 =====
let session = loadSession(); // { access_token, refresh_token, expires_at, email }

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}
function saveSession(s) {
  session = s;
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 存不了就只放在记忆体，重新整理后要再登入一次
  }
}

// 向 Supabase Auth 换通行证（grant_type = password 用密码换；refresh_token 用旧的换新的）
async function getToken(grantType, body) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.msg || data.error || `HTTP ${response.status}`);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    email: data.user?.email,
  };
}

// 通行证快过期了（剩不到 1 分钟）就先换一张新的
async function ensureFreshToken() {
  if (!session) throw new Error("NOT_SIGNED_IN");
  if (Date.now() < session.expires_at - 60_000) return;
  try {
    saveSession({ ...(await getToken("refresh_token", { refresh_token: session.refresh_token })), email: session.email });
  } catch {
    saveSession(null);
    throw new Error("NOT_SIGNED_IN");
  }
}

// 带着通行证去呼叫 REST API
async function api(path, options = {}) {
  await ensureFreshToken();
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    saveSession(null);
    throw new Error("NOT_SIGNED_IN");
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginMsg").textContent = "⏳ 登入中… Signing in…";
  try {
    saveSession(await getToken("password", { email: $("email").value.trim(), password: $("password").value }));
    $("password").value = "";
    await start();
  } catch (error) {
    $("loginMsg").textContent = `❌ 登入失败 Sign-in failed: ${error.message}`;
  }
});

async function signOut() {
  try {
    if (session) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` },
      });
    }
  } finally {
    saveSession(null);
    showLogin();
  }
}

function showLogin(message = "") {
  $("app").hidden = true;
  $("login").hidden = false;
  $("who").innerHTML = "";
  $("loginMsg").textContent = message;
}

// ===== 📦 资料 =====
let rows = []; // 全部的贡献（管理员看得到全部）
let filter = "pending"; // 现在显示哪一种
const selected = new Set(); // 勾选了哪些（id）

const STATUS = {
  pending: { zh: "待审核", en: "Pending", icon: "⏳" },
  approved: { zh: "已通过", en: "Approved", icon: "✅" },
  rejected: { zh: "已拒绝", en: "Rejected", icon: "❌" },
  all: { zh: "全部", en: "All", icon: "📋" },
};

async function start() {
  if (!session) return showLogin();
  try {
    // 先确认这个账号真的是管理员（数据库里的 is_admin()）
    const admin = await api("/rest/v1/rpc/is_admin", { method: "POST", body: "{}" });
    if (!admin) {
      await signOut();
      return showLogin("⛔ 这个账号不是管理员 · This account is not an admin");
    }
    $("login").hidden = true;
    $("app").hidden = false;
    $("who").innerHTML = `<span>👤 ${escapeHtml(session.email ?? "")}</span> <button id="logout">登出 <span class="en-inline">Sign out</span></button>`;
    $("logout").addEventListener("click", signOut);
    await reload();
  } catch (error) {
    handleError(error);
  }
}

async function reload() {
  $("appMsg").textContent = "⏳ 读取中… Loading…";
  try {
    rows = await api("/rest/v1/shared_templates?select=*&order=created_at.desc");
    // 已经不存在的勾选拿掉
    for (const id of [...selected]) if (!rows.some((r) => r.id === id)) selected.delete(id);
    $("appMsg").textContent = "";
    render();
  } catch (error) {
    handleError(error);
  }
}

// 改状态：一次可以改好几笔（id=in.(a,b,c)）
async function setStatus(ids, status) {
  if (ids.length === 0) return;
  try {
    await api(`/rest/v1/shared_templates?id=in.(${ids.join(",")})`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status }),
    });
    for (const row of rows) if (ids.includes(row.id)) row.status = status;
    for (const id of ids) selected.delete(id);
    render();
  } catch (error) {
    handleError(error);
  }
}

function handleError(error) {
  if (error.message === "NOT_SIGNED_IN") return showLogin("🔐 请重新登入 · Please sign in again");
  console.error(error);
  $("appMsg").textContent = `❌ 出错了 Something went wrong: ${error.message}`;
}

// ===== 🖼️ 画面 =====
function render() {
  renderStats();
  renderFilters();
  renderGroups();
  updateSelectionBar();
}

function renderStats() {
  const head = `<tr><th>形状 <span class="en-inline">Shape</span></th>
    <th>⏳ 待审核<span class="en">Pending</span></th><th>✅ 已通过<span class="en">Approved</span></th>
    <th>❌ 已拒绝<span class="en">Rejected</span></th><th>👥 通过的玩家数<span class="en">Approved players</span></th></tr>`;
  const line = (label, list) => {
    const c = (s) => list.filter((r) => r.status === s).length;
    const players = new Set(list.filter((r) => r.status === "approved").map((r) => r.player_id)).size;
    return `<tr><td>${label}</td><td>${c("pending")}</td><td>${c("approved")}</td><td>${c("rejected")}</td><td>${players}</td></tr>`;
  };
  const body = Object.keys(SPELLS)
    .map((key) => line(`${SPELLS[key].shape} <span class="en-inline">${SPELLS[key].shapeEn}</span>`, rows.filter((r) => r.shape === key)))
    .join("");
  $("stats").innerHTML = `<table>${head}${body}<tfoot>${line("<b>合计 Total</b>", rows)}</tfoot></table>`;
}

function renderFilters() {
  $("filters").innerHTML = Object.entries(STATUS)
    .map(([key, s]) => {
      const n = key === "all" ? rows.length : rows.filter((r) => r.status === key).length;
      return `<button data-filter="${key}" class="${key === filter ? "on" : ""}">${s.icon} ${s.zh} <span class="en-inline">${s.en}</span> (${n})</button>`;
    })
    .join("");
}

function renderGroups() {
  const visible = rows.filter((r) => filter === "all" || r.status === filter);
  if (visible.length === 0) {
    $("groups").innerHTML = `<p class="empty">🎉 这里没有资料 · Nothing here</p>`;
    return;
  }
  // 按形状分组
  const html = Object.keys(SPELLS)
    .map((key) => {
      const list = visible.filter((r) => r.shape === key);
      if (list.length === 0) return "";
      return `<section class="group" data-shape="${key}">
          <div class="group-head">
            <canvas class="demo" data-demo="${key}" title="示范 Demo"></canvas>
            <h3>${SPELLS[key].shape}<span class="en">${SPELLS[key].shapeEn} · ${list.length}</span></h3>
            <button data-select-group="${key}">☑️ 全选这组 <span class="en-inline">Select group</span></button>
          </div>
          <div class="grid">${list.map(cardHtml).join("")}</div>
        </section>`;
    })
    .join("");
  $("groups").innerHTML = html;

  for (const canvas of document.querySelectorAll("canvas[data-demo]")) {
    const key = canvas.dataset.demo;
    drawPath(canvas, DEMO_PATHS[key].map(([x, y]) => ({ x, y })), "#8a6a48", false, 56);
  }
  for (const canvas of document.querySelectorAll("canvas[data-id]")) {
    const row = rows.find((r) => r.id === canvas.dataset.id);
    // 玩家看到的画面是镜像的，所以左右翻转，才会跟玩家当时看到的一样
    drawPath(canvas, row.points, "#f9a825", true, 150);
  }
}

function cardHtml(row) {
  const s = STATUS[row.status];
  const match = row.recognized_as === row.shape;
  const guess = row.recognized_as ? SPELLS[row.recognized_as] : null;
  const score = row.score == null ? "–" : `${Math.round(row.score * 100)}%`;
  const verdict = !guess
    ? `<span class="muted">没有识别结果 · No recognition</span>`
    : match
      ? `<span class="${row.score >= 0.75 ? "good" : "mid"}">🎯 ${guess.shape} ${score}</span>`
      : `<span class="bad">⚠️ 像 ${guess.shape} · looks like ${guess.shapeEn} ${score}</span>`;
  const time = new Date(row.created_at).toLocaleString();
  return `<article class="item ${row.status} ${selected.has(row.id) ? "sel" : ""}">
      <label class="pick"><input type="checkbox" data-select="${row.id}" ${selected.has(row.id) ? "checked" : ""}></label>
      <span class="badge ${row.status}">${s.icon} ${s.zh} ${s.en}</span>
      <canvas data-id="${row.id}"></canvas>
      <div class="meta">
        <div>${verdict}</div>
        <div class="muted">👤 ${row.player_id.slice(0, 8)} · ${row.points.length} 点 points</div>
        <div class="muted">🕒 ${time}</div>
      </div>
      <div class="actions">
        <button class="ok" data-set="approved" data-id-btn="${row.id}" ${row.status === "approved" ? "disabled" : ""}>✅ 通过 <span class="en-inline">Approve</span></button>
        <button class="no" data-set="rejected" data-id-btn="${row.id}" ${row.status === "rejected" ? "disabled" : ""}>❌ 拒绝 <span class="en-inline">Reject</span></button>
      </div>
    </article>`;
}

// 把一笔画进小画布：保持长宽比例、置中，绿点是起点
function drawPath(canvas, points, color, mirror, size) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!points || points.length < 2) return;
  const xs = points.map((p) => (mirror ? -p.x : p.x));
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX || 1;
  const h = Math.max(...ys) - minY || 1;
  const pad = size * 0.1;
  const scale = (size - pad * 2) / Math.max(w, h);
  const ox = (size - w * scale) / 2;
  const oy = (size - h * scale) / 2;
  const at = (i) => [ox + (xs[i] - minX) * scale, oy + (ys[i] - minY) * scale];
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size / 40);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((_, i) => (i === 0 ? ctx.moveTo(...at(0)) : ctx.lineTo(...at(i))));
  ctx.stroke();
  ctx.fillStyle = "#2e7d32";
  ctx.beginPath();
  ctx.arc(...at(0), Math.max(3, size / 30), 0, Math.PI * 2);
  ctx.fill();
}

function updateSelectionBar() {
  const n = selected.size;
  $("selCount").textContent = n ? `已选 ${n} 个 · ${n} selected` : "";
  $("approveSel").disabled = n === 0;
  $("rejectSel").disabled = n === 0;
}

// ===== 🖱️ 按钮（用“事件委派”：在外层听一次，就能处理里面所有按钮）=====
$("filters").addEventListener("click", (event) => {
  const key = event.target.closest("button")?.dataset.filter;
  if (!key) return;
  filter = key;
  selected.clear();
  render();
});

$("groups").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button?.dataset.set) return setStatus([button.dataset.idBtn], button.dataset.set);
  if (button?.dataset.selectGroup) {
    const shape = button.dataset.selectGroup;
    const ids = rows.filter((r) => r.shape === shape && (filter === "all" || r.status === filter)).map((r) => r.id);
    const allOn = ids.every((id) => selected.has(id));
    for (const id of ids) allOn ? selected.delete(id) : selected.add(id);
    return render();
  }
});

$("groups").addEventListener("change", (event) => {
  const id = event.target.dataset.select;
  if (!id) return;
  event.target.checked ? selected.add(id) : selected.delete(id);
  event.target.closest(".item").classList.toggle("sel", event.target.checked);
  updateSelectionBar();
});

$("approveSel").addEventListener("click", () => setStatus([...selected], "approved"));
$("rejectSel").addEventListener("click", () => setStatus([...selected], "rejected"));
$("refresh").addEventListener("click", reload);

// ⬇️ 导出：把所有“已通过”的模板下载成 JSON（之后训练模型、做评估用）
//   格式跟 templates.json 一样，再多带 playerId → 可以“按人来分”训练集和测试集
$("export").addEventListener("click", () => {
  const approved = rows
    .filter((r) => r.status === "approved")
    .map((r) => ({
      name: r.shape,
      points: r.points,
      playerId: r.player_id,
      recognizedAs: r.recognized_as,
      score: r.score,
      createdAt: r.created_at,
    }));
  const blob = new Blob([JSON.stringify(approved, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `shared_templates_approved_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  $("appMsg").textContent = `⬇️ 已导出 ${approved.length} 个 · Exported ${approved.length}`;
});

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

start();
