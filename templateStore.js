// 💾 模板的读取与储存：以 Magic_Game 文件夹里的 templates.json 为准
//
// 📌 存的是“原始轨迹”（没有 normalize 过的点）：
//    以后换识别方法（例如 Phase 2 自己训练模型），原始数据还能重新使用。
//
// 格式：[{ name: "triangle", points: [{x, y}, ...], createdAt: "..." }, ...]

const FILE_NAME = "templates.json";

// 记住“写到哪个文件”：第一次储存时选好，之后就直接写同一个文件
let fileHandle = null;

// 开网页时读取 templates.json；没有这个文件就从空的开始
export async function loadTemplatesFromFile() {
  try {
    // cache: "no-store"：每次都拿最新的，不要用浏览器缓存的旧版本
    const response = await fetch(FILE_NAME, { cache: "no-store" });
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.warn("⚠️ 读取 templates.json 失败：", error);
    return [];
  }
}

// 储存到 templates.json
// 回传："saved"（直接写进文件）、"downloaded"（改用下载）、"cancelled"（使用者取消）
export async function saveTemplatesToFile(templates) {
  const json = JSON.stringify(templates, null, 2);

  // Chrome / Edge 支持 File System Access API：网页可以直接写文件
  if ("showSaveFilePicker" in window) {
    try {
      if (!fileHandle) {
        // 第一次储存：跳出窗口，让使用者选位置（选 Magic_Game 文件夹）
        fileHandle = await window.showSaveFilePicker({
          suggestedName: FILE_NAME,
          types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
        });
      }
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      return "saved";
    } catch (error) {
      if (error.name === "AbortError") return "cancelled"; // 使用者按了取消
      throw error;
    }
  }

  // 其他浏览器：退回“下载文件”的做法
  downloadJson(json);
  return "downloaded";
}

function downloadJson(json) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = FILE_NAME;
  link.click();
  URL.revokeObjectURL(url);
}
