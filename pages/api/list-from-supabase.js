import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ error: 'Supabase env missing' })

  try {
    const sb = createClient(SUPA_URL, SUPA_KEY)
    const { data, error } = await sb
      .from('meetings')
      .select('data')
      .order('updated_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    const meetings = (data || []).map(r => r.data).filter(Boolean)
    return res.json({ ok: true, count: meetings.length, meetings })
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) })
  }
}
