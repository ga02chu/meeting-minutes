// 一次性救援 endpoint：用 transcript 重跑後的 actions 覆蓋指定會議的 actions 欄位
// 用法：POST { meetingId, actions, key } — key 須等於 CRON_SECRET
// 只覆蓋 record.actions，html / title / 其他欄位完全不動
// 動作完成後請刪除這支檔案

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  // 一次性 token：用完即刪整個檔案（CRON_SECRET 因為 vercel env pull 拉不到值，所以不用）
  const ONE_SHOT = 'ba430bcdea24540174d6f5ff0ecd282b'
  const key = req.body?.key || req.query?.key
  if (key !== ONE_SHOT) return res.status(401).json({ error: 'bad key' })

  const { meetingId, actions } = req.body || {}
  if (!meetingId || !Array.isArray(actions) || actions.length === 0) {
    return res.status(400).json({ error: 'meetingId + actions[] required' })
  }

  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ error: 'supabase env missing' })

  try {
    const sb = createClient(SUPA_URL, SUPA_KEY)
    const { data: row, error: e1 } = await sb.from('meetings').select('data').eq('id', meetingId).single()
    if (e1) return res.status(404).json({ error: 'meeting not found', detail: e1.message })

    const rec = row?.data || {}
    const rnd = () => Math.random().toString(36).slice(2, 8)
    const newActions = actions.map((a, i) => ({
      id: `${meetingId}_a${i}_${rnd()}`,
      person: a.person || '',
      task: a.task || '',
      deadline: a.deadline || '',
      done: false,
      completedAt: null,
      note: a.note || '',
    }))

    const newRec = { ...rec, actions: newActions }
    const { error: e2 } = await sb.from('meetings').upsert({
      id: meetingId, data: newRec, updated_at: new Date().toISOString(),
    })
    if (e2) return res.status(500).json({ error: 'upsert failed', detail: e2.message })

    return res.json({ ok: true, replaced: newActions.length, oldCount: (rec.actions || []).length })
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) })
  }
}
