export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const baseUrl = process.env.GA_ASSISTANT_SAVE_URL || "https://ga02-assistant.vercel.app/api/meetings/save";
  // /api/meetings/save → /api/meetings/delete
  const delUrl = baseUrl.replace(/\/save$/, "/delete");
  const token = process.env.GA_ASSISTANT_SAVE_TOKEN;
  if (!token) return res.status(500).json({ error: "GA_ASSISTANT_SAVE_TOKEN not set" });

  const externalId = req.body?.external_id || req.body?.id;
  if (!externalId) return res.status(400).json({ error: "external_id required" });

  try {
    const r = await fetch(delUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ external_id: externalId }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data.error || `HTTP ${r.status}` });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
