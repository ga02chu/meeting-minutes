export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const baseUrl = process.env.GA_ASSISTANT_SAVE_URL || "https://ga02-assistant.vercel.app/api/meetings/save";
  // /api/meetings/save → /api/meetings/list
  const listUrl = baseUrl.replace(/\/save$/, "/list");
  const token = process.env.GA_ASSISTANT_SAVE_TOKEN;
  if (!token) return res.status(500).json({ error: "GA_ASSISTANT_SAVE_TOKEN not set" });

  try {
    const r = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data.error || `HTTP ${r.status}` });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
