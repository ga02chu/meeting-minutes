export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const url = process.env.GA_ASSISTANT_SAVE_URL || "https://ga02-assistant.vercel.app/api/meetings/save";
  const token = process.env.GA_ASSISTANT_SAVE_TOKEN;
  if (!token) return res.status(500).json({ error: "GA_ASSISTANT_SAVE_TOKEN not set" });

  const m = req.body?.meeting;
  if (!m || !m.date) {
    return res.status(400).json({ error: "meeting with date required" });
  }

  const payload = {
    meeting_date: m.date,
    subtitle: m.subtitle ?? m.title ?? null,
    unknown_persons: m.unknownPersons ?? [],
    actions: m.actions ?? [],
    html: m.html ?? null,
    raw_transcript: m.rawTranscript ?? null,
    source: "meeting-minutes",
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({ error: data.error || `HTTP ${r.status}` });
    }
    return res.json({ ok: true, saved: data.saved });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
