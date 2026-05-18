import { createClient } from '@supabase/supabase-js'

const TPE_OFFSET_MS = 8 * 60 * 60 * 1000

function parseDeadline(str, todayTpe) {
  if (!str || str === '—') return null
  const md = str.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (md) {
    return new Date(Date.UTC(todayTpe.getUTCFullYear(), parseInt(md[1]) - 1, parseInt(md[2])))
  }
  const full = str.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (full) {
    return new Date(Date.UTC(parseInt(full[1]), parseInt(full[2]) - 1, parseInt(full[3])))
  }
  return null
}

function daysUntil(deadlineStr, todayTpe) {
  const d = parseDeadline(deadlineStr, todayTpe)
  if (!d) return null
  return Math.ceil((d - todayTpe) / 86400000)
}

function formatMessage(overdue, urgent, todayStr) {
  const lines = [`🔔 頭目會議行動提醒（${todayStr}）`, '']

  if (overdue.length > 0) {
    lines.push(`⚠️ 已逾期 ${overdue.length} 項`)
    for (const a of overdue) {
      const days = Math.abs(a._days)
      const person = a.person || '未指派'
      const dl = a.deadline || '—'
      lines.push(`• [${person}] ${a.task}（逾期 ${days} 天・${dl}）`)
    }
    lines.push('')
  }

  if (urgent.length > 0) {
    lines.push(`⏰ ${urgent.length} 項 3 天內到期`)
    for (const a of urgent) {
      const days = a._days
      const when = days === 0 ? '今天' : days === 1 ? '明天' : `${days} 天後`
      const person = a.person || '未指派'
      const dl = a.deadline || '—'
      lines.push(`• [${person}] ${a.task}（${when}・${dl}）`)
    }
    lines.push('')
  }

  lines.push('別忘了去系統勾完成 ✅')
  return lines.join('\n')
}

async function pushToLine(token, groupId, text) {
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: groupId,
      messages: [{ type: 'text', text: text.slice(0, 4990) }],
    }),
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`LINE push failed ${r.status}: ${body}`)
  }
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.authorization || ''
  const queryKey = req.query.key || ''
  if (secret && auth !== `Bearer ${secret}` && queryKey !== secret) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const LINE_TOKEN = process.env.LINE_TOKEN
  const GROUP_ID = process.env.MEETING_GROUP_ID

  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ error: 'Supabase env missing' })
  if (!LINE_TOKEN || !GROUP_ID) return res.status(500).json({ error: 'LINE env missing' })

  try {
    const sb = createClient(SUPA_URL, SUPA_KEY)
    const { data: rows, error } = await sb.from('meetings').select('data')
    if (error) throw error

    const nowUtc = new Date()
    const todayTpe = new Date(Math.floor((nowUtc.getTime() + TPE_OFFSET_MS) / 86400000) * 86400000)

    const overdue = []
    const urgent = []
    for (const row of rows || []) {
      const m = row.data
      for (const a of m?.actions || []) {
        if (a.done) continue
        const d = daysUntil(a.deadline, todayTpe)
        if (d === null) continue
        const withDays = { ...a, _days: d, _meetingDate: m.date }
        if (d < 0) overdue.push(withDays)
        else if (d <= 3) urgent.push(withDays)
      }
    }

    overdue.sort((a, b) => a._days - b._days)
    urgent.sort((a, b) => a._days - b._days)

    if (req.query.debug === '1') {
      const all = []
      for (const row of rows || []) {
        const m = row.data
        for (const a of m?.actions || []) {
          all.push({
            meetingDate: m.date,
            person: a.person,
            task: (a.task || '').slice(0, 60),
            deadline: a.deadline,
            done: !!a.done,
            completedAt: a.completedAt || null,
          })
        }
      }
      return res.json({
        ok: true,
        totalMeetings: (rows || []).length,
        totalActions: all.length,
        doneCount: all.filter(x => x.done).length,
        undoneCount: all.filter(x => !x.done).length,
        all,
      })
    }

    if (overdue.length === 0 && urgent.length === 0) {
      return res.json({ ok: true, sent: false, reason: 'no pending items' })
    }

    const todayStr = new Date(todayTpe.getTime()).toISOString().slice(0, 10)
    const message = formatMessage(overdue, urgent, todayStr)

    if (req.query.dry === '1') {
      return res.json({ ok: true, dry: true, message, counts: { overdue: overdue.length, urgent: urgent.length } })
    }

    await pushToLine(LINE_TOKEN, GROUP_ID, message)
    return res.json({ ok: true, sent: true, counts: { overdue: overdue.length, urgent: urgent.length } })
  } catch (e) {
    console.error('remind-actions error:', e)
    return res.status(500).json({ error: e?.message || String(e) })
  }
}
