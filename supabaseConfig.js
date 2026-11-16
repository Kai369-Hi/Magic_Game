// ☁️ Supabase 的连线资料
//
// 这两样放在公开的网页里没问题：
//   PUBLISHABLE_KEY 只能做数据库安全规则（RLS，见 supabase/schema.sql）允许的事
//   → 投进“待审核”的模板、读取“已通过”的模板
// ⚠️ 绝对不要把 sb_secret_ 开头的 Secret key 放进任何文件！

export const SUPABASE_URL = "https://jmocnhcvclretaaqwzlc.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_va6bgZrTh1aReCVnYKUc7Q_Yvppwq-x";
