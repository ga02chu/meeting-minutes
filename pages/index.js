import { useState, useRef, useCallback, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'

const FONTS = 'https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;500;700&family=Noto+Sans+TC:wght@300;400;500&display=swap'

// 總部核心成員（夥伴進度只顯示這些人）
const HQ_TEAM_ORDER = ['闆娘', '韋豪', '郁潔', 'Hank', '小拉', 'Apple']
const HQ_TEAM = HQ_TEAM_ORDER

const PROGRESS_STEPS = [
  '正在識別出席人員⋯⋯',
  '正在整理各門市事項⋯⋯',
  '正在整理行銷與文宣⋯⋯',
  '正在彙整決議事項⋯⋯',
  '正在建立行動清單⋯⋯',
  '最後確認與潤色⋯⋯',
]

// ── Storage ───────────────────────────────────────────────
// ── Supabase ─────────────────────────────────────────────
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const store = {
  _sb: null,
  sb() {
    if (!this._sb && SUPA_URL && SUPA_KEY) {
      this._sb = createClient(SUPA_URL, SUPA_KEY)
      console.log('Supabase client created:', SUPA_URL.slice(0,30))
    }
    return this._sb
  },
  get: () => { try { return JSON.parse(localStorage.getItem('mtg_v3') || '[]') } catch { return [] } },
  save: async (m) => {
    const list = store.get(); const i = list.findIndex(x => x.id === m.id)
    if (i >= 0) list[i] = m; else list.unshift(m)
    localStorage.setItem('mtg_v3', JSON.stringify(list))
    const sb = store.sb()
    if (sb) {
      try {
        const res = await sb.from('meetings').upsert({ id: m.id, data: m, updated_at: new Date().toISOString() })
        console.log('Supabase upsert result:', res)
      } catch(e) { console.error('Supabase save error:', e) }
    } else { console.warn('Supabase not initialized, SUPA_URL:', SUPA_URL) }
  },
  del: async (id) => {
    localStorage.setItem('mtg_v3', JSON.stringify(store.get().filter(m => m.id !== id)))
    const sb = store.sb()
    if (sb) { try { await sb.from('meetings').delete().eq('id', id) } catch(e) { console.warn('Supabase del:', e) } }
  },
  toggleAction: (mid, aid) => {
    const list = store.get(); const m = list.find(x => x.id === mid)
    if (m) {
      const a = m.actions?.find(x => x.id === aid)
      if (a) { a.done = !a.done; a.completedAt = a.done ? new Date().toISOString() : null }
    }
    localStorage.setItem('mtg_v3', JSON.stringify(list))
    const sb = store.sb()
    if (sb && m) { try { sb.from('meetings').upsert({ id: mid, data: m, updated_at: new Date().toISOString() }) } catch(e) {} }
  },
  syncFromCloud: async () => {
    const sb = store.sb()
    if (!sb) return null
    try {
      const { data, error } = await sb.from('meetings').select('data').order('updated_at', { ascending: false })
      if (error || !data) return null
      const cloud = data.map(r => r.data).filter(Boolean)
      const local = store.get()
      const merged = [...cloud]
      local.forEach(m => { if (!merged.find(x => x.id === m.id)) merged.push(m) })
      localStorage.setItem('mtg_v3', JSON.stringify(merged))
      return merged
    } catch(e) { console.warn('Supabase sync:', e); return null }
  }
}


// ── Meeting tag presets ───────────────────────────────────
const TAG_PRESETS = ['例行會議', '緊急會議', '內場', '外場', '行銷', '正職大會']

// ── Backup ───────────────────────────────────────────────
function exportBackup() {
  const data = { version: 1, exportedAt: new Date().toISOString(), meetings: store.get() }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url
  a.download = 'meeting-minutes-backup-' + new Date().toISOString().slice(0,10) + '.json'
  a.click(); URL.revokeObjectURL(url)
}

function importBackup(file, onDone) {
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result)
      const meetings = data.meetings || data
      if (!Array.isArray(meetings)) throw new Error('格式錯誤')
      const existing = store.get()
      const merged = [...meetings]
      existing.forEach(m => { if (!merged.find(x => x.id === m.id)) merged.push(m) })
      merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      localStorage.setItem('mtg_v3', JSON.stringify(merged))
      onDone(merged.length)
    } catch(e) { alert('匯入失敗：' + e.message) }
  }
  reader.readAsText(file)
}

// ── Helpers ───────────────────────────────────────────────
function inRange(dateStr, filter, customMonth) {
  const d = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (filter === 'all') return true
  if (filter === 'custom') return customMonth ? dateStr?.startsWith(customMonth) : true
  if (filter === 'today') return d >= today && d < new Date(today.getTime() + 86400000)
  if (filter === 'week') {
    const day = today.getDay() || 7; const mon = new Date(today); mon.setDate(today.getDate() - day + 1)
    return d >= mon && d < new Date(mon.getTime() + 7 * 86400000)
  }
  if (filter === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  if (filter === 'prev') { const pm = new Date(now.getFullYear(), now.getMonth() - 1); return d.getFullYear() === pm.getFullYear() && d.getMonth() === pm.getMonth() }
  return true
}

function parseDeadline(str) {
  if (!str || str === '—') return null
  const now = new Date()
  // M/D or MM/DD
  const md = str.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (md) return new Date(now.getFullYear(), parseInt(md[1]) - 1, parseInt(md[2]))
  // YYYY/M/D or YYYY-M-D
  const full = str.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (full) return new Date(parseInt(full[1]), parseInt(full[2]) - 1, parseInt(full[3]))
  return null
}

function daysUntil(task) {
  const dl = parseDeadline(task.deadline)
  if (!dl) return null
  const today = new Date(); today.setHours(0,0,0,0)
  return Math.ceil((dl - today) / 86400000)
}

function deadlineStatus(task) {
  if (task.done) return 'done'
  const d = daysUntil(task)
  if (d === null) return 'none'
  if (d < 0) return 'overdue'       // 已逾期
  if (d <= 3) return 'urgent'       // 3天內 🔴
  if (d <= 7) return 'warning'      // 7天內 🟡
  return 'ok'
}

function isOverdue(task) { return deadlineStatus(task) === 'overdue' }
function daysOverdue(task) {
  const d = daysUntil(task); return d !== null && d < 0 ? Math.abs(d) : 0
}

function updateHtmlDate(html, newDate) {
  return html.replace(/(<h1[^>]*>會議記錄｜)[^<]*(頭目會議<\/h1>)/, `$1${newDate} $2`)
}

// ── Icons ─────────────────────────────────────────────────
const IconHistory = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
const IconTasks = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
const IconStats = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
const IconStore = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>

// ── Sidebar ───────────────────────────────────────────────
function Sidebar({ view, onNav, onUpload, onExport, onImport }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-name">料韓男總部</div>
        <div className="sidebar-brand-sub">會議記錄系統</div>
      </div>
      <nav className="sidebar-nav">
        <div className="sidebar-section">功能</div>
        <div className={`sidebar-item ${view === 'history' ? 'active' : ''}`} onClick={() => onNav('history')}>
          <IconHistory /><span>會議記錄</span>
        </div>
        <div className={`sidebar-item ${view === 'tasks' ? 'active' : ''}`} onClick={() => onNav('tasks')}>
          <IconTasks /><span>待辦追蹤</span>
        </div>
        <div className={`sidebar-item ${view === 'stats' ? 'active' : ''}`} onClick={() => onNav('stats')}>
          <IconStats /><span>月報統計</span>
        </div>
        <div className={`sidebar-item ${view === 'stores' ? 'active' : ''}`} onClick={() => onNav('stores')}>
          <IconStore /><span>分店總覽</span>
        </div>

      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-upload-btn" onClick={onUpload}>＋ 上傳新記錄</button>
        <div className="sidebar-backup-row">
          <button className="sidebar-backup-btn" onClick={onExport}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            匯出備份
          </button>
          <button className="sidebar-backup-btn" onClick={onImport}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            匯入備份
          </button>
        </div>
      </div>
    </aside>
  )
}

// ── Progress Loader ───────────────────────────────────────
function ProgressLoader() {
  const [step, setStep] = useState(0)
  const [dots, setDots] = useState(0)
  useEffect(() => {
    const s = setInterval(() => setStep(v => Math.min(v + 1, PROGRESS_STEPS.length - 1)), 11000)
    const d = setInterval(() => setDots(v => (v + 1) % 4), 500)
    return () => { clearInterval(s); clearInterval(d) }
  }, [])
  return (
    <div className="progress-loader">
      <div className="progress-spinner" />
      <div className="progress-steps">
        {PROGRESS_STEPS.map((s, i) => (
          <div key={i} className={`progress-step ${i < step ? 'done' : i === step ? 'active' : 'pending'}`}>
            <span className="step-icon">{i < step ? '✓' : i === step ? '◉' : '○'}</span>
            <span>{s}{i === step ? '.'.repeat(dots) : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}


// ── Unknown Persons Modal ────────────────────────────────
const ALL_STAFF = ['韋豪','郁潔','筱庭','顯耀','姵妤','曜綸','吏伸','耀恩','唯恩','皇旭','嘉德','祐呈','嘉良','廷曜','彥錞','翰剛','宸維','宜珊','羽宣','嘉玟','嘉妤','碩安','倚瑄','怡君','柏凱','孟強','閎鈞','瑄倢','譯尹','啟岷','祈福','郁萱','立愷','文勝','明臻','亞熾','羽萱','瀚文','梓彥','冠達','秉承','瑞翔','湘芸','若文','采盈','心瑜','慧麗','秉祥','智雄','晨屹','宣蓉','芷瑢','煒綸','睿辰','聖棠','杰廷','昱勳','思穎','心怡','亭姗','闆娘']

function getContext(html, name) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const idx = text.indexOf(name)
  if (idx === -1) return ''
  const start = Math.max(0, idx - 60)
  const end = Math.min(text.length, idx + name.length + 60)
  return (start > 0 ? '⋯' : '') + text.slice(start, end) + (end < text.length ? '⋯' : '')
}

function UnknownPersonsModal({ persons, html, onApply, onClose }) {
  // Only show persons that actually appear in the HTML text
  const plainText = html.replace(/<[^>]+>/g, ' ')
  const visiblePersons = persons.filter(p => plainText.includes(p))
  const [remaining, setRemaining] = useState(visiblePersons)
  const [mappings, setMappings] = useState(() =>
    Object.fromEntries(visiblePersons.map(p => [p, '']))
  )
  // If nothing to show, apply immediately
  if (visiblePersons.length === 0) { onApply(html); return null }
  const handleApply = () => {
    let newHtml = html
    Object.entries(mappings).forEach(([orig, mapped]) => {
      if (mapped.trim()) {
        const re = new RegExp(orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
        newHtml = newHtml.replace(re, mapped.trim())
      }
    })
    onApply(newHtml)
  }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="up-modal">
        <div className="up-modal-header">
          <div className="up-modal-title">⚠ 確認未知名字</div>
          <div className="up-modal-sub">以下名字無法對應員工名單，請輸入正確名字，或點「保留原名」維持原本辨識結果</div>
        </div>
        <div className="up-modal-body">
          {remaining.map(p => (
            <div key={p} className="up-person-row">
              <div className="up-person-top">
                <div className="up-orig-name">「{p}」</div>
                <span className="up-arrow">→</span>
                <div className="up-input-wrap">
                  <input
                    className="up-input"
                    list={`staff-list-${p}`}
                    value={mappings[p]}
                    onChange={e => setMappings(m => ({...m, [p]: e.target.value}))}
                    placeholder="輸入正確名字或從清單選擇…"
                  />
                  <datalist id={`staff-list-${p}`}>
                    {ALL_STAFF.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <button className="up-skip-btn" onClick={() => {
                  setRemaining(r => r.filter(x => x !== p))
                  setMappings(m => { const n = {...m}; delete n[p]; return n })
                }}>保留原名</button>
              </div>
              {getContext(html, p) && (
                <div className="up-context">{getContext(html, p)}</div>
              )}
            </div>
          ))}
        </div>
        <div className="up-modal-footer">
          <button className="up-cancel-btn" onClick={onClose}>取消</button>
          {remaining.length === 0
            ? <button className="up-apply-btn" onClick={() => onApply(html)}>關閉</button>
            : <button className="up-apply-btn" onClick={handleApply}>套用並關閉</button>
          }
        </div>
      </div>
    </div>
  )
}

// ── Unknown Persons Banner ────────────────────────────────
function UnknownPersonsBanner({ persons }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || !persons?.length) return null
  return (
    <div className="unknown-banner">
      <span className="unknown-icon">⚠</span>
      <div className="unknown-content">
        <strong>以下名字無法對應員工名單，請手動確認並編輯：</strong>
        <span className="unknown-names">{persons.join('、')}</span>
      </div>
      <button className="unknown-dismiss" onClick={() => setDismissed(true)}>✕</button>
    </div>
  )
}

// ── Upload Modal ──────────────────────────────────────────
function UploadModal({ onClose, onResult }) {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedTags, setSelectedTags] = useState([])
  const toggleTag = (t) => setSelectedTags(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const handleFile = useCallback((f) => {
    if (!f) return
    if (!f.name.endsWith('.txt') && f.type !== 'text/plain') { setError('請上傳 .txt 格式'); return }
    setFile(f); setError(null)
  }, [])

  const handleProcess = async () => {
    if (!file) return
    setLoading(true); setError(null)
    try {
      const text = await file.text()
      const res = await fetch('/api/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: text }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '處理失敗')
      const id = Date.now().toString()
      const now = new Date().toISOString()
      const actions = (data.actions || []).map((a, i) => ({ ...a, id: `${id}_${i}`, done: false, completedAt: null }))
      onResult({ id, html: data.html, subtitle: data.subtitle || '', date: data.date || now.slice(0, 10), unknownPersons: data.unknownPersons || [], actions, createdAt: now })
    } catch (e) { setError(e.message || '發生錯誤'); setLoading(false) }
  }

  return (
    <div className="upload-overlay" onClick={e => e.target === e.currentTarget && !loading && onClose()}>
      <div className="upload-modal">
        {!loading && <button className="modal-close" onClick={onClose}>×</button>}
        <div className="modal-title">上傳會議逐字稿</div>
        {loading ? <ProgressLoader /> : (
          <>
            <div className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
              onClick={() => fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" accept=".txt,text/plain" onChange={e => handleFile(e.target.files[0])} style={{ display: 'none' }} />
              <svg className="upload-icon" viewBox="0 0 48 48" fill="none">
                <rect x="8" y="6" width="32" height="36" rx="2" stroke="#993556" strokeWidth="2" fill="none"/>
                <path d="M16 18h16M16 24h16M16 30h10" stroke="#993556" strokeWidth="2" strokeLinecap="round"/>
                <path d="M30 2v10h10M30 2l10 10" stroke="#993556" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <p className="upload-label">點擊或拖曳上傳逐字稿</p>
              <p className="upload-hint">支援 .txt 文字檔案</p>
            </div>
            {file && <div className="file-selected"><span>📄</span><div><div style={{fontWeight:500}}>{file.name}</div><div style={{fontSize:11,opacity:.7}}>{(file.size/1024).toFixed(1)} KB</div></div></div>}
            {error && <div className="error-msg">⚠ {error}</div>}
            <button className="btn-process" onClick={handleProcess} disabled={!file}>開始整理會議記錄</button>
          </>
        )}
      </div>
    </div>
  )
}


// ── Search snippet helper ─────────────────────────────────
function getStructuredSnippets(html, keyword) {
  if (!keyword || !html) return []
  const safe = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(safe, 'gi')
  const results = []
  // Parse sections: find h2 and their li/p children
  const sectionRe = /<(?:div[^>]*section[^>]*|div[^>]*)>\s*<h2[^>]*>(.*?)<\/h2>([\s\S]*?)<\/div>/gi
  let secMatch
  while ((secMatch = sectionRe.exec(html)) !== null) {
    const heading = secMatch[1].replace(/<[^>]+>/g, '').trim()
    const body = secMatch[2]
    // Find matching li or p items
    const itemRe = /<(?:li|p)[^>]*>([\s\S]*?)<\/(?:li|p)>/gi
    let itemMatch
    const matchedItems = []
    while ((itemMatch = itemRe.exec(body)) !== null) {
      const text = itemMatch[1].replace(/<[^>]+>/g, '').trim()
      if (re.test(text)) {
        re.lastIndex = 0
        matchedItems.push(text)
      }
      re.lastIndex = 0
    }
    if (matchedItems.length > 0) results.push({ heading, items: matchedItems })
  }
  return results
}

function highlightKeyword(text, keyword) {
  const safe = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp('(' + safe + ')', 'gi'))
  return parts.map((p, i) =>
    p.toLowerCase() === keyword.toLowerCase()
      ? <mark key={i} className="snippet-hl">{p}</mark>
      : <span key={i}>{p}</span>
  )
}

// ── History Page ──────────────────────────────────────────
function HistoryPage({ onOpen }) {
  const [meetings, setMeetings] = useState([])
  const [filter, setFilter] = useState('all')
  const [dateMode, setDateMode] = useState('upload')
  const [customMonth, setCustomMonth] = useState('')
  const [search, setSearch] = useState('')
  const [dragId, setDragId] = useState(null)
  const [sortOrder, setSortOrder] = useState(null)
  const [tagFilter, setTagFilter] = useState(null)

  useEffect(() => { setMeetings(store.get()) }, [])

  const handleDragStart = (id) => setDragId(id)
  const handleDragOver = (e, id) => {
    e.preventDefault()
    if (!dragId || dragId === id) return
    setMeetings(prev => {
      const list = [...prev]
      const fromIdx = list.findIndex(m => m.id === dragId)
      const toIdx = list.findIndex(m => m.id === id)
      if (fromIdx < 0 || toIdx < 0) return prev
      const [moved] = list.splice(fromIdx, 1)
      list.splice(toIdx, 0, moved)
      localStorage.setItem('mtg_v3', JSON.stringify(list))
      return list
    })
  }
  const handleDragEnd = () => setDragId(null)

  const [pendingDeletes, setPendingDeletes] = useState({})

  const handleDelete = (id) => {
    const timer = setTimeout(() => {
      store.del(id)
      setMeetings(store.get())
      setPendingDeletes(p => { const n = {...p}; delete n[id]; return n })
    }, 5000)
    setPendingDeletes(p => ({ ...p, [id]: timer }))
  }

  const handleUndoDelete = (id) => {
    clearTimeout(pendingDeletes[id])
    setPendingDeletes(p => { const n = {...p}; delete n[id]; return n })
  }

  const displayMeetings = sortOrder
    ? [...meetings].sort((a, b) => {
        const da = new Date(a.date || a.createdAt)
        const db = new Date(b.date || b.createdAt)
        return sortOrder === 'asc' ? da - db : db - da
      })
    : meetings

  const allTags = [...new Set(meetings.flatMap(m => m.tags || []))]
  const filtered = displayMeetings.filter(m => {
    const refDate = dateMode === 'upload' ? m.createdAt : m.date
    const matchTime = inRange(refDate, filter, customMonth)
    const matchSearch = !search || (m.title || '').includes(search) || (m.subtitle || '').includes(search) || (m.html || '').replace(/<[^>]+>/g, '').includes(search)
    const matchTag = !tagFilter || (m.tags || []).includes(tagFilter)
    return matchTime && matchSearch && matchTag
  })

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">歷史記錄</span>
        <div className="topbar-filters">
          {[['all','全部'],['today','今天'],['week','本週'],['month','本月'],['prev','上個月'],['custom','自訂']].map(([k,v]) => (
            <button key={k} className={`tf-btn ${filter===k?'active':''}`} onClick={() => setFilter(k)}>{v}</button>
          ))}
          {filter === 'custom' && <input type="month" className="custom-month-input" value={customMonth} onChange={e => setCustomMonth(e.target.value)} />}
          <span className="date-mode-sep">｜</span>
          <button className={`tf-btn-sm ${dateMode==='upload'?'active':''}`} onClick={() => setDateMode('upload')}>依上傳</button>
          <button className={`tf-btn-sm ${dateMode==='meeting'?'active':''}`} onClick={() => setDateMode('meeting')}>依會議日期</button>
        </div>
        <div className="sort-btns">
          <button className={`sort-btn ${sortOrder === 'desc' ? 'active' : ''}`} onClick={() => setSortOrder(s => s === 'desc' ? null : 'desc')} title="最新在前">↓ 日期</button>
          <button className={`sort-btn ${sortOrder === 'asc' ? 'active' : ''}`} onClick={() => setSortOrder(s => s === 'asc' ? null : 'asc')} title="最舊在前">↑ 日期</button>
        </div>
        {allTags.length > 0 && (
          <div className="tag-filter-row">
            {allTags.map(t => (
              <button key={t} className={`tag-filter-btn ${tagFilter === t ? 'active' : ''}`}
                onClick={() => setTagFilter(f => f === t ? null : t)}>{t}</button>
            ))}
          </div>
        )}
        <div className="topbar-search">
          <span style={{fontSize:13,opacity:.5}}>🔍</span>
          <input placeholder="搜尋⋯⋯" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="page-content">
        {filtered.length === 0 ? (
          <div className="empty-state">{meetings.length === 0 ? '還沒有任何儲存的會議記錄，點左側「上傳新記錄」開始' : '找不到符合的記錄'}</div>
        ) : (
          <div className="meetings-grid">
            {filtered.map(m => (
              <div key={m.id}
                draggable
                onDragStart={() => handleDragStart(m.id)}
                onDragOver={e => handleDragOver(e, m.id)}
                onDragEnd={handleDragEnd}
                className={`meeting-card ${pendingDeletes[m.id] ? 'card-pending-delete' : ''} ${dragId === m.id ? 'card-dragging' : ''}`}
                onClick={() => !pendingDeletes[m.id] && !dragId && onOpen(m)}>
                <div className="meeting-card-left">
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                    <span className="drag-handle" title="拖拉排序">⠿</span>
                    <div className="meeting-date-badge">{m.date || '—'}</div>
                    {(m.tags||[]).map(t => <span key={t} className="tag-chip">{t}</span>)}
                  </div>
                  <div className="meeting-card-title">{m.title || `${m.date} 頭目會議`}</div>
                  {m.subtitle && <div className="meeting-card-sub">{m.subtitle}</div>}
                  {search && (() => {
                    const snippets = getStructuredSnippets(m.html, search)
                    return snippets.length > 0 ? (
                      <div className="search-snippets">
                        {snippets.map((s, i) => (
                          <div key={i} className="snippet-group">
                            <div className="snippet-heading">{s.heading}</div>
                            {s.items.map((item, j) => (
                              <div key={j} className="snippet-item">
                                <span className="snippet-bullet">•</span>
                                <span>{highlightKeyword(item, search)}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : null
                  })()}
                  {!pendingDeletes[m.id] && <div className="meeting-card-tags">
                    {m.actions?.filter(a => !a.done).length > 0 && <span className="tag tag-pending">{m.actions.filter(a=>!a.done).length} 項待處理</span>}
                    {m.actions?.filter(a => a.done).length > 0 && <span className="tag tag-done">{m.actions.filter(a=>a.done).length} 項已完成</span>}
                    {m.actions?.some(isOverdue) && <span className="tag tag-overdue">⚠ 有逾期項目</span>}
                    {m.unknownPersons?.length > 0 && <span className="tag tag-warn">？ {m.unknownPersons.length} 個未確認名字</span>}
                  </div>}
                  {pendingDeletes[m.id] && <div className="delete-pending-msg">即將刪除⋯ 5 秒內可復原</div>}
                  <div className="meeting-upload-date">上傳於 {m.createdAt?.slice(0,10) || '—'}</div>
                </div>
                {pendingDeletes[m.id]
                  ? <button className="btn-undo-card" onClick={e => { e.stopPropagation(); handleUndoDelete(m.id) }}>復原</button>
                  : <button className="btn-sm btn-sm-danger" onClick={e => { e.stopPropagation(); handleDelete(m.id) }}>刪除</button>
                }
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}



// ── Meeting Tags ─────────────────────────────────────────
function MeetingTags({ tags = [], onChange }) {
  const toggle = (tag) => tags.includes(tag)
    ? onChange(tags.filter(t => t !== tag))
    : onChange([...tags, tag])
  return (
    <div className="tags-editor">
      {TAG_PRESETS.map(p => (
        <button key={p}
          className={`tag-toggle ${tags.includes(p) ? 'tag-toggle-on' : ''}`}
          onClick={() => toggle(p)}>
          {p}
        </button>
      ))}
    </div>
  )
}

// ── Find & Replace ───────────────────────────────────────
function FindReplace({ contentRef, onClose }) {
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [count, setCount] = useState(null)
  const findRef = useRef(null)

  useEffect(() => {
    findRef.current?.focus()
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const clearHL = () => {
    if (!contentRef.current) return
    contentRef.current.innerHTML = contentRef.current.innerHTML
      .replace(/<mark class="fr-hl">(.*?)<\/mark>/g, '$1')
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const handleFindChange = (val) => {
    setFind(val); setCount(null)
    if (!contentRef.current) return
    const base = contentRef.current.innerHTML.replace(/<mark class="fr-hl">(.*?)<\/mark>/g, '$1')
    if (!val) { contentRef.current.innerHTML = base; return }
    const re = new RegExp(escapeRe(val), 'gi')
    const matches = (base.replace(/<[^>]+>/g, '').match(re) || []).length
    setCount(matches)
    contentRef.current.innerHTML = base.replace(re, m => '<mark class="fr-hl">' + m + '</mark>')
  }

  const handleReplaceAll = () => {
    if (!contentRef.current || !find) return
    clearHL()
    const re = new RegExp(escapeRe(find), 'gi')
    const walker = document.createTreeWalker(contentRef.current, NodeFilter.SHOW_TEXT)
    const nodes = []; let node
    while ((node = walker.nextNode())) nodes.push(node)
    let total = 0
    nodes.forEach(n => {
      const m = n.textContent.match(re)
      if (m) { total += m.length; n.textContent = n.textContent.replace(re, replace) }
    })
    setFind(''); setReplace(''); setCount(null)
    alert(total > 0 ? '已取代 ' + total + ' 處' : '找不到符合的文字')
  }

  return (
    <div className="find-replace-bar">
      <div className="fr-row">
        <span className="fr-label">尋找</span>
        <input ref={findRef} className="fr-input" value={find} onChange={e => handleFindChange(e.target.value)} placeholder="輸入要尋找的文字…" />
        {count !== null && <span className="fr-count">{count > 0 ? count + ' 處' : '找不到'}</span>}
      </div>
      <div className="fr-row">
        <span className="fr-label">取代</span>
        <input className="fr-input" value={replace} onChange={e => setReplace(e.target.value)} placeholder="取代為…" />
        <button className="fr-btn" onClick={handleReplaceAll} disabled={!find}>全部取代</button>
      </div>
      <button className="fr-close" onClick={() => { clearHL(); onClose() }}>✕</button>
    </div>
  )
}

// ── Detail Page ───────────────────────────────────────────
function DetailPage({ record: initial, onBack, onUnsavedChange }) {
  const [record, setRecord] = useState(initial)
  const [saveStatus, setSaveStatus] = useState(initial.title ? 'saved' : 'unsaved')
  const [exporting, setExporting] = useState(false)
  const [showFR, setShowFR] = useState(false)
  const [actionSort, setActionSort] = useState(null)
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [showLinks, setShowLinks] = useState(!!(initial.links?.length))
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')
  const savedRange = useRef(null)
  const [showUnknownModal, setShowUnknownModal] = useState(!!(initial.unknownPersons?.length))
  const lastSavedHtml = useRef(initial.html || "")
  const contentRef = useRef(null)

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); doSave() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'h') { e.preventDefault(); setShowFR(v => !v) }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
          savedRange.current = sel.getRangeAt(0).cloneRange()
          setLinkText(sel.toString())
        }
        setShowLinkModal(true)
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    const warn = (e) => {
      if (saveStatus === 'unsaved') { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveStatus])

  useEffect(() => {
    if (!initial.title) {
      const m = initial.html?.match(/會議記錄｜([^<\n]+)/)
      if (m) setRecord(r => ({ ...r, title: m[1].trim() }))
    }
  }, [])

  useEffect(() => {
    if (saveStatus !== 'unsaved') return
    const t = setTimeout(() => { doSave(); }, 30000)
    return () => clearTimeout(t)
  }, [saveStatus, record])

  useEffect(() => {
    if (onUnsavedChange) onUnsavedChange(saveStatus === 'unsaved')
  }, [saveStatus])

  const doSave = useCallback(async () => {
    const html = contentRef.current?.innerHTML || record.html
    const m = { ...record, html, title: record.title || `${record.date} 頭目會議` }
    await store.save(m)
    setSaveStatus('saved')
    lastSavedHtml.current = html
    // Don't call setRecord here - would reset contentEditable cursor
  }, [record])

  const handleUndo = () => {
    if (!confirm('確定要復原到上次儲存的版本？目前未儲存的變更將會消失。')) return
    if (contentRef.current) contentRef.current.innerHTML = lastSavedHtml.current
    setSaveStatus('saved')
  }

  const handleDateChange = (newDate) => {
    const newTitle = `${newDate} 頭目會議`
    const newHtml = updateHtmlDate(record.html, newDate)
    setRecord(r => ({ ...r, date: newDate, title: newTitle, html: newHtml }))
    if (contentRef.current) {
      const h1 = contentRef.current.querySelector('h1')
      if (h1) h1.textContent = `會議記錄｜${newTitle}`
    }
    setSaveStatus('unsaved')
  }

  const toggleAction = (id) => {
    const now = new Date().toISOString()
    setRecord(r => ({ ...r, actions: r.actions.map(a => a.id === id ? { ...a, done: !a.done, completedAt: !a.done ? now : null } : a) }))
    setSaveStatus('unsaved')
  }

  const updateAction = (id, field, value) => {
    setRecord(r => ({ ...r, actions: r.actions.map(a => a.id === id ? { ...a, [field]: value } : a) }))
    setSaveStatus('unsaved')
  }

  const addAction = () => {
    const newAction = { id: `${record.id}_${Date.now()}`, person: '', task: '', deadline: '', done: false, completedAt: null, note: '', isManual: true }
    setRecord(r => ({ ...r, actions: [...(r.actions || []), newAction] }))
    setSaveStatus('unsaved')
  }

  const [pendingDeletes, setPendingDeletes] = useState({}) // {id: timeoutId}

  const removeAction = (id) => {
    // Soft delete: mark pending, auto-confirm after 5s
    const timer = setTimeout(() => {
      setRecord(r => ({ ...r, actions: r.actions.filter(a => a.id !== id) }))
      setPendingDeletes(p => { const n = {...p}; delete n[id]; return n })
      setSaveStatus('unsaved')
    }, 5000)
    setPendingDeletes(p => ({ ...p, [id]: timer }))
  }

  const undoDelete = (id) => {
    clearTimeout(pendingDeletes[id])
    setPendingDeletes(p => { const n = {...p}; delete n[id]; return n })
  }

  const toggleNote = (id) => {
    setRecord(r => ({ ...r, actions: r.actions.map(a => a.id === id ? { ...a, _showNote: !a._showNote } : a) }))
  }

  const handleExportDocx = async () => {
    setExporting(true)
    try {
      const html = contentRef.current?.innerHTML || record.html
      const res = await fetch('/api/export-docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...record, html }) })
      if (!res.ok) throw new Error('匯出失敗')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `${record.date || 'meeting'}_頭目會議.docx`
      a.click(); URL.revokeObjectURL(url)
    } catch (e) { alert(e.message) }
    finally { setExporting(false) }
  }

  const saveBg = saveStatus === 'saved' ? 'var(--green)' : saveStatus === 'saving' ? 'var(--gold)' : 'var(--accent)'
  const saveLabel = saveStatus === 'saved' ? '✓ 已儲存' : saveStatus === 'saving' ? '儲存中⋯' : '儲存記錄'

  return (
    <>
      <div className="detail-topbar">
        <button className="btn-back-sm" onClick={() => { if (saveStatus === 'unsaved' && !confirm('有未儲存的變更，確定要離開嗎？')) return; onBack() }}>← 返回</button>
        <div className="detail-inputs">
          <input className="title-input" value={record.title || ''} placeholder={`${record.date} 頭目會議`}
            onChange={e => { setRecord(r => ({ ...r, title: e.target.value })); setSaveStatus('unsaved') }} />
          <input className="date-input" type="date" value={record.date || ''} onChange={e => handleDateChange(e.target.value)} />
        </div>
        <button className="btn-find" onClick={() => {
          const sel = window.getSelection()
          if (sel && sel.rangeCount > 0) {
            savedRange.current = sel.getRangeAt(0).cloneRange()
            setLinkText(sel.toString())
          }
          setShowLinkModal(true)
        }} title="插入連結 (Cmd+K)">🔗 連結</button>
        <button className="btn-find" onClick={() => setShowFR(v => !v)} title="尋找/取代 (Cmd+H)">尋找／取代</button>
        <button className="btn-undo" onClick={handleUndo} title="復原到上次儲存">復原</button>
        <button className="btn-save" style={{background:saveBg}} onClick={doSave}>{saveLabel}</button>
        <button className="btn-export" onClick={handleExportDocx} disabled={exporting}>{exporting ? '匯出中⋯' : '匯出 Word'}</button>
        <button className="btn-print" onClick={() => window.print()}>列印 / PDF</button>
      </div>
      <div className="page-content">
        {showFR && <FindReplace contentRef={contentRef} onClose={() => setShowFR(false)} />}
        {showLinkModal && (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowLinkModal(false)}>
            <div className="link-modal">
              <div className="link-modal-title">🔗 插入連結</div>
              <div className="link-field">
                <label>顯示文字</label>
                <input className="fr-input" value={linkText} onChange={e => setLinkText(e.target.value)} placeholder="連結文字…" autoFocus />
              </div>
              <div className="link-field">
                <label>網址</label>
                <input className="fr-input" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      if (!linkUrl) return
                      contentRef.current?.focus()
                      const sel = window.getSelection()
                      if (savedRange.current) { sel.removeAllRanges(); sel.addRange(savedRange.current) }
                      const a = `<a href="${linkUrl}" target="_blank" class="inline-link">${linkText || linkUrl}</a>`
                      document.execCommand('insertHTML', false, a)
                      setShowLinkModal(false); setLinkUrl(''); setLinkText('')
                      setSaveStatus('unsaved')
                    }
                  }} />
              </div>
              <div className="link-modal-footer">
                <button className="up-cancel-btn" onClick={() => { setShowLinkModal(false); setLinkUrl(''); setLinkText('') }}>取消</button>
                <button className="up-apply-btn" onClick={() => {
                  if (!linkUrl) return
                  contentRef.current?.focus()
                  const sel = window.getSelection()
                  if (savedRange.current) { sel.removeAllRanges(); sel.addRange(savedRange.current) }
                  const a = `<a href="${linkUrl}" target="_blank" class="inline-link">${linkText || linkUrl}</a>`
                  document.execCommand('insertHTML', false, a)
                  setShowLinkModal(false); setLinkUrl(''); setLinkText('')
                  setSaveStatus('unsaved')
                }}>插入</button>
              </div>
            </div>
          </div>
        )}
        {record.unknownPersons?.length > 0 && !showUnknownModal && (
          <div className="unknown-banner">
            <span className="unknown-icon">⚠</span>
            <div className="unknown-content">
              <strong>有未確認的名字：</strong>
              <span className="unknown-names">{record.unknownPersons.join('、')}</span>
            </div>
            <button className="unknown-review-btn" onClick={() => setShowUnknownModal(true)}>點此確認</button>
            <button className="unknown-dismiss" onClick={() => setRecord(r => ({...r, unknownPersons: []}))}>✕</button>
          </div>
        )}
        {showUnknownModal && record.unknownPersons?.length > 0 && (
          <UnknownPersonsModal
            persons={record.unknownPersons}
            html={contentRef.current?.innerHTML || record.html}
            onApply={(newHtml) => {
              if (contentRef.current) contentRef.current.innerHTML = newHtml
              setRecord(r => ({...r, html: newHtml, unknownPersons: []}))
              setShowUnknownModal(false)
              setSaveStatus('unsaved')
            }}
            onClose={() => setShowUnknownModal(false)}
          />
        )}
        {record.subtitle && <div className="subtitle-banner"><span className="subtitle-label">AI 摘要</span><span className="subtitle-text">{record.subtitle}</span></div>}
        <div className="tags-section">
          <MeetingTags tags={record.tags || []} onChange={tags => { setRecord(r => ({...r, tags})); setSaveStatus('unsaved') }} />
        </div>
        <div className="agenda-links-section">
          <div className="agenda-links-header" onClick={() => setShowLinks(v => !v)}>
            <span className="agenda-links-title">📎 相關連結</span>
            <span className="agenda-links-toggle">{showLinks ? '▲' : '▼'}</span>
          </div>
          {showLinks && (
            <div className="agenda-links-body">
              {(record.links || []).map((lk, i) => (
                <div key={i} className="agenda-link-row">
                  <a href={lk.url} target="_blank" rel="noreferrer" className="agenda-link-item">
                    🔗 {lk.title || lk.url}
                  </a>
                  <button className="agenda-link-remove" onClick={() => {
                    const links = (record.links || []).filter((_, j) => j !== i)
                    setRecord(r => ({...r, links})); setSaveStatus('unsaved')
                  }}>✕</button>
                </div>
              ))}
              <div className="agenda-link-add-row">
                <input className="agenda-link-input" placeholder="標題（選填）"
                  id="al-title" />
                <input className="agenda-link-input" placeholder="網址 https://…"
                  id="al-url"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const url = document.getElementById('al-url').value.trim()
                      const title = document.getElementById('al-title').value.trim()
                      if (!url) return
                      const links = [...(record.links || []), { title, url }]
                      setRecord(r => ({...r, links})); setSaveStatus('unsaved')
                      document.getElementById('al-url').value = ''
                      document.getElementById('al-title').value = ''
                    }
                  }} />
                <button className="agenda-link-add-btn" onClick={() => {
                  const url = document.getElementById('al-url').value.trim()
                  const title = document.getElementById('al-title').value.trim()
                  if (!url) return
                  const links = [...(record.links || []), { title, url }]
                  setRecord(r => ({...r, links})); setSaveStatus('unsaved')
                  document.getElementById('al-url').value = ''
                  document.getElementById('al-title').value = ''
                }}>＋ 新增</button>
              </div>
            </div>
          )}
        </div>
        {saveStatus === 'unsaved' && <div className="autosave-hint">● 有未儲存的變更（30 秒後自動儲存）</div>}
        <div className="edit-hint">💡 點擊任何內容可直接編輯，修改日期會同步更新標題</div>
        <div className="minutes-wrapper">
          <div className="minutes-inner" ref={contentRef} contentEditable suppressContentEditableWarning
            onInput={() => setSaveStatus('unsaved')} dangerouslySetInnerHTML={{ __html: record.html }} />
          <div className="action-section">
              <div className="action-section-title">行動清單</div>
              <table className="action-table-full">
                <thead><tr>
                  <th style={{width:36}}>完成</th>
                  <th style={{width:72}}>負責人</th>
                  <th>事項</th>
                  <th style={{width:130}}>期限</th>
                  <th style={{width:88}}>完成時間</th>
                  <th style={{width:36,textAlign:"center",fontSize:11}}>刪除</th>
                </tr></thead>
                <tbody>
                  {(actionSort
                    ? [...(record.actions || [])].sort((a, b) => {
                        if (actionSort === 'person') return (a.person||'').localeCompare(b.person||'')
                        if (actionSort === 'deadline') {
                          const da = parseDeadline(a.deadline); const db = parseDeadline(b.deadline)
                          if (da && db) return da - db
                          if (da) return -1; if (db) return 1; return 0
                        }
                        if (actionSort === 'urgency') {
                          const order = {overdue:0,urgent:1,warning:2,ok:3,none:4,done:5}
                          return (order[deadlineStatus(a)]||4) - (order[deadlineStatus(b)]||4)
                        }
                        return 0
                      })
                    : (record.actions || [])
                  ).map(a => {
                    const status = deadlineStatus(a)
                    const isPendingDelete = !!pendingDeletes[a.id]
                    const rowClass = isPendingDelete ? 'action-pending-delete' : a.done ? 'action-done' : status === 'overdue' ? 'action-overdue' : status === 'urgent' ? 'action-urgent' : status === 'warning' ? 'action-warning' : ''
                    const d = daysUntil(a)
                    return (
                      <tr key={a.id} className={rowClass}>
                        <td style={{textAlign:'center'}}><input type="checkbox" className="action-checkbox" checked={!!a.done} onChange={() => toggleAction(a.id)} /></td>
                        <td contentEditable suppressContentEditableWarning className="editable-cell" onBlur={e => updateAction(a.id, 'person', e.target.innerText.trim())}>{a.person}</td>
                        <td className="task-note-cell">
                          <div contentEditable suppressContentEditableWarning className="task-text-edit" onBlur={e => updateAction(a.id, 'task', e.target.innerText.replace(/逾期.*天|緊急.*天|.*天後/g,'').trim())}>
                            {a.task}
                            {status === 'overdue' && <span className="dl-badge dl-overdue">逾期 {daysOverdue(a)} 天</span>}
                            {status === 'urgent' && <span className="dl-badge dl-urgent">緊急 {d} 天</span>}
                            {status === 'warning' && <span className="dl-badge dl-warning">{d} 天後</span>}
                          </div>
                          <div className="inline-note-wrap">
                            <div contentEditable suppressContentEditableWarning className="inline-note" data-placeholder="＋ 備註…" onBlur={e => updateAction(a.id, 'note', e.target.innerText.trim())}>
                              {a.note ? `(${a.note})` : ''}
                            </div>

                          </div>
                        </td>
                        <td><input type="date" className="deadline-input" value={a.deadline || ''} onChange={e => updateAction(a.id, 'deadline', e.target.value)} /></td>
                        <td style={{fontSize:11,color:'var(--green)',textAlign:'center'}}>{a.completedAt ? a.completedAt.slice(0,10) : '—'}</td>
                        <td style={{textAlign:'center',minWidth:60}}>
                          {pendingDeletes[a.id]
                            ? <button className="undo-delete-btn" onClick={() => undoDelete(a.id)}>復原</button>
                            : <button className="delete-action-btn" onClick={() => removeAction(a.id)} title="刪除">✕</button>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <button className="add-action-btn" onClick={addAction}>＋ 新增事項</button>
            </div>
        </div>
      </div>
    </>
  )
}

// ── Tasks Page ────────────────────────────────────────────
function TasksPage() {
  const [meetings, setMeetings] = useState([])
  const [showDone, setShowDone] = useState(false)
  const [personFilter, setPersonFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState('all')
  const [customMonth, setCustomMonth] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => { setMeetings(store.get()) }, [])

  const toggle = (mid, aid) => { store.toggleAction(mid, aid); setMeetings(store.get()) }

  const isHQ = (name) => HQ_TEAM_ORDER.some(h => name === h || name.includes(h) || h.includes(name))
  const allTasks = meetings
    .filter(m => inRange(m.createdAt, timeFilter, customMonth))
    .flatMap(m => (m.actions || []).map(a => ({
      ...a, meetingId: m.id, meetingTitle: m.title || `${m.date} 頭目會議`, meetingDate: m.date
    })))

  const people = [...new Set(allTasks.map(a => a.person).filter(Boolean))].sort()
  const filtered = allTasks.filter(a => personFilter === 'all' || (personFilter === '其他夥伴' ? (a.person && !isHQ(a.person)) : a.person === personFilter))
  const statusFiltered = statusFilter === 'all' ? filtered
    : statusFilter === 'overdue' ? filtered.filter(a => !a.done && deadlineStatus(a) === 'overdue')
    : statusFilter === 'urgent' ? filtered.filter(a => !a.done && deadlineStatus(a) === 'urgent')
    : statusFilter === 'warning' ? filtered.filter(a => !a.done && deadlineStatus(a) === 'warning')
    : statusFilter === 'normal' ? filtered.filter(a => !a.done && (deadlineStatus(a) === 'ok' || deadlineStatus(a) === 'none'))
    : statusFilter === 'done' ? filtered.filter(a => a.done)
    : filtered
  // Overview stats: always full picture (not affected by statusFilter)
  const allPending = filtered.filter(a => !a.done)
  const allDone = filtered.filter(a => a.done)
  const overdue = allPending.filter(a => deadlineStatus(a) === "overdue")
  const urgent = allPending.filter(a => deadlineStatus(a) === "urgent")
  const warning = allPending.filter(a => deadlineStatus(a) === "warning")
  const total = filtered.length
  const pct = total > 0 ? Math.round((allDone.length / total) * 100) : 0

  // List stats: affected by statusFilter (for display only)
  const pending = statusFiltered.filter(a => !a.done).sort((a, b) => {
    const da = parseDeadline(a.deadline); const db = parseDeadline(b.deadline)
    if (da && db) return da - db
    if (da) return -1; if (db) return 1
    return 0
  })
  const done = statusFiltered.filter(a => a.done)

  // Per-person stats
  // Build HQ stats in fixed order
  const hqStats = HQ_TEAM_ORDER.map(h => {
    const tasks = filtered.filter(a => HQ_TEAM_ORDER.some(hq => hq === h && (a.person?.includes(hq) || hq.includes(a.person))))
    const doneCnt = tasks.filter(a => a.done).length
    const overdueCnt = tasks.filter(a => !a.done && deadlineStatus(a) === 'overdue').length
    const urgentCnt = tasks.filter(a => !a.done && deadlineStatus(a) === 'urgent').length
    return { name: h, total: tasks.length, done: doneCnt, overdue: overdueCnt, urgent: urgentCnt, pct: tasks.length > 0 ? Math.round(doneCnt / tasks.length * 100) : 0 }
  }).filter(s => s.total > 0)
  // Other 其他夥伴
  const otherTasks = filtered.filter(a => a.person && !isHQ(a.person))
  const otherDone = otherTasks.filter(a => a.done).length
  const otherOverdue = otherTasks.filter(a => !a.done && deadlineStatus(a) === 'overdue').length
  const otherUrgent = otherTasks.filter(a => !a.done && deadlineStatus(a) === 'urgent').length
  const otherStat = otherTasks.length > 0 ? { name: '其他夥伴', total: otherTasks.length, done: otherDone, overdue: otherOverdue, urgent: otherUrgent, pct: Math.round(otherDone / otherTasks.length * 100), isOther: true } : null
  const personStats = [...hqStats, ...(otherStat ? [otherStat] : [])]

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">任務總表</span>
        <div className="topbar-filters" style={{flexWrap:'wrap',gap:6}}>
          {[['all','全部'],['today','今天'],['week','本週'],['month','本月'],['prev','上個月'],['custom','自訂']].map(([k,v]) => (
            <button key={k} className={`tf-btn ${timeFilter===k?'active':''}`} onClick={() => setTimeFilter(k)}>{v}</button>
          ))}
          {timeFilter === 'custom' && <input type="month" className="custom-month-input" value={customMonth} onChange={e => setCustomMonth(e.target.value)} />}
        </div>
      </div>
      <div className="page-content">
        <div className="tasks-layout"><div className="tasks-wrapper">

          {/* ── Overview stats ── */}
          <div className="tasks-overview">
            <div className="overview-main">
              <div className="overview-pct">{pct}%</div>
              <div className="overview-label">整體完成率</div>
              <div className="overview-bar-wrap">
                <div className="overview-bar" style={{width: `${pct}%`}} />
              </div>
              <div className="overview-sub">{allDone.length} / {total} 項完成{overdue.length > 0 && <span className="overdue-alert">・{overdue.length} 逾期</span>}{urgent.length > 0 && <span className="urgent-alert">・{urgent.length} 緊急</span>}{warning.length > 0 && <span className="warning-alert">・{warning.length} 即將到期</span>}</div>
            </div>
            <div className="overview-cards">
              <div className="stat-card"><div className="stat-label">全部任務</div><div className="stat-num">{total}</div></div>
              <div className="stat-card accent"><div className="stat-label">待處理</div><div className="stat-num">{allPending.length}</div></div>
              <div className="stat-card red"><div className="stat-label">⛔ 逾期</div><div className="stat-num">{overdue.length}</div></div>
              <div className="stat-card orange"><div className="stat-label">🔴 3天內</div><div className="stat-num">{urgent.length}</div></div>
              <div className="stat-card green"><div className="stat-label">已完成</div><div className="stat-num">{allDone.length}</div></div>
            </div>
          </div>

          {/* ── Per person progress ── */}
          {personStats.length > 0 && (
            <div className="person-progress-section">
              <div className="section-label">夥伴完成進度</div>
              {personFilter !== 'all' && (
              <div className="filter-active-bar">
                <span>篩選中：{personFilter} 的任務</span>
                <button className="clear-filter-btn" onClick={() => setPersonFilter('all')}>× 清除篩選</button>
              </div>
            )}
            <div className="person-progress-grid">
                {personStats.map(s => (
                  <div key={s.name} className={`person-card ${s.isOther ? 'other-card' : ''} ${personFilter === s.name ? 'selected' : ''}`} onClick={() => setPersonFilter(p => p === s.name ? 'all' : s.name)}>
                    <div className="person-card-top">
                      <span className="person-name-tag">{s.name}</span>
                      <span className="person-pct">{s.pct}%</span>
                      {s.overdue > 0 && <span className="person-overdue-dot" title={`${s.overdue} 項逾期`}>!</span>}
                    </div>
                    <div className="person-bar-wrap">
                      <div className="person-bar" style={{width:`${s.pct}%`, background: s.overdue > 0 ? 'var(--red)' : s.pct === 100 ? 'var(--green)' : 'var(--accent)'}} />
                    </div>
                    <div className="person-card-sub">{s.done}/{s.total} 項完成{s.overdue > 0 && <span style={{color:"var(--red)",marginLeft:6}}>逾期 {s.overdue}</span>}{s.urgent > 0 && <span style={{color:"var(--orange)",marginLeft:6}}>緊急 {s.urgent}</span>}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Deadline alerts ── */}
          {filtered.filter(a => !a.done && deadlineStatus(a) === 'overdue').length > 0 && (
            <div className="overdue-section">
              <div className="tasks-section-header overdue">⛔ 已逾期（{filtered.filter(a => !a.done && deadlineStatus(a) === 'overdue').length}）</div>
              {filtered.filter(a => !a.done && deadlineStatus(a) === 'overdue').map(a => <TaskRow key={a.id} task={a} onToggle={() => toggle(a.meetingId, a.id)} />)}
            </div>
          )}
          {filtered.filter(a => !a.done && deadlineStatus(a) === 'urgent').length > 0 && (
            <div className="overdue-section">
              <div className="tasks-section-header urgent">🔴 緊急（3天內，{filtered.filter(a => !a.done && deadlineStatus(a) === 'urgent').length}）</div>
              {filtered.filter(a => !a.done && deadlineStatus(a) === 'urgent').map(a => <TaskRow key={a.id} task={a} onToggle={() => toggle(a.meetingId, a.id)} />)}
            </div>
          )}
          {filtered.filter(a => !a.done && deadlineStatus(a) === 'warning').length > 0 && (
            <div className="overdue-section">
              <div className="tasks-section-header warning">🟡 即將到期（7天內，{filtered.filter(a => !a.done && deadlineStatus(a) === 'warning').length}）</div>
              {filtered.filter(a => !a.done && deadlineStatus(a) === 'warning').map(a => <TaskRow key={a.id} task={a} onToggle={() => toggle(a.meetingId, a.id)} />)}
            </div>
          )}

          {/* ── Pending ── */}
          <div className="tasks-section-header pending">一般待處理（{pending.filter(a => deadlineStatus(a) === "ok" || deadlineStatus(a) === "none").length}）</div>
          {pending.filter(a => deadlineStatus(a) === "ok" || deadlineStatus(a) === "none").length === 0
            ? <div style={{padding:'12px 0',color:'var(--ink-light)',fontSize:13}}>🎉 目前沒有待處理事項</div>
            : pending.filter(a => deadlineStatus(a) === "ok" || deadlineStatus(a) === "none").map(a => <TaskRow key={a.id} task={a} onToggle={() => toggle(a.meetingId, a.id)} />)}

          {/* ── Done ── */}
          <button className="btn-show-done" onClick={() => setShowDone(v => !v)}>
            {showDone ? '▲ 隱藏已完成' : `▼ 顯示已完成（${done.length}）`}
          </button>
          {showDone && <>
            <div className="tasks-section-header done">已完成（{done.length}）</div>
            {done.map(a => <TaskRow key={a.id} task={a} onToggle={() => toggle(a.meetingId, a.id)} />)}
          </>}
        </div>
        <div className="status-filter-panel">
          <div className="sfp-title">狀態篩選{statusFilter !== 'all' && <span className="sfp-active-dot" />}</div>
          {[
            { key: 'all', label: '全部任務', count: total, color: 'var(--ink)' }, // overview
            { key: 'overdue', label: '⛔ 已逾期', count: overdue.length, color: 'var(--red)' },
            { key: 'urgent', label: '🔴 緊急（3天內）', count: urgent.length, color: '#f43f5e' },
            { key: 'warning', label: '🟡 即將到期（7天內）', count: warning.length, color: 'var(--gold)' },
            { key: 'normal', label: '○ 一般待處理', count: filtered.filter(a => !a.done && (deadlineStatus(a) === 'ok' || deadlineStatus(a) === 'none')).length, color: 'var(--ink-light)' },
            { key: 'done', label: '✓ 已完成', count: filtered.filter(a => a.done).length, color: 'var(--green)' },
          ].map(s => (
            <button key={s.key}
              className={`sfp-item ${statusFilter === s.key ? 'sfp-active' : ''}`}
              onClick={() => setStatusFilter(s.key)}>
              <span className="sfp-label">{s.label}</span>
              <span className="sfp-count" style={{color: statusFilter === s.key ? '#fff' : s.color}}>{s.count}</span>
            </button>
          ))}
        </div>
      </div>
      </div>
    </>
  )
}

function TaskRow({ task, onToggle }) {
  const status = deadlineStatus(task)
  const d = daysUntil(task)
  const rowCls = task.done ? 'done' : status === 'overdue' ? 'overdue' : status === 'urgent' ? 'urgent' : status === 'warning' ? 'warning' : ''
  return (
    <div className={`task-row ${rowCls}`} data-person={task.person}>
      <input type="checkbox" className="action-checkbox" checked={!!task.done} onChange={onToggle} />
      <div className="task-info">
        <div className="task-main">
          <span className="task-person">{task.person}</span>
          <span className="task-cell-wrap"><span className="task-text">{task.task}</span>{task.note && <span className="task-note-inline">📝 {task.note}</span>}</span>
          {task.deadline && (
            <span className={`task-deadline ${status === 'overdue' ? 'dl-overdue' : status === 'urgent' ? 'dl-urgent' : status === 'warning' ? 'dl-warning' : ''}`}>
              {task.deadline}
              {status === 'overdue' && ` (逾期${daysOverdue(task)}天)`}
              {status === 'urgent' && ` (${d}天後)`}
              {status === 'warning' && ` (${d}天後)`}
            </span>
          )}
        </div>
        <div className="task-source">
          {task.isManual ? '手動新增' : `${task.meetingDate} · ${task.meetingTitle}`}
          {task.completedAt && <span style={{marginLeft:10,color:'var(--green)'}}>✓ {task.completedAt.slice(0,10)}</span>}
          {task.note && <span style={{marginLeft:10,color:'var(--ink-light)'}}>📝 {task.note}</span>}
        </div>
      </div>
    </div>
  )
}



// ── Store Overview Page ───────────────────────────────────
const STORES = [
  { name: '明曜店', keywords: ['明曜店', '明曜'] },
  { name: '品概店', keywords: ['品概店', '品概', '仁愛店', '仁愛'] },
  { name: '台中店', keywords: ['台中店', '臺中店', '台中', '臺中'] },
  { name: '桃園店', keywords: ['桃園店', '桃園'] },
  { name: '英洙家', keywords: ['英洙家'] },
]

function extractStoreSections(html, keywords) {
  // Extract items grouped by their section heading
  const sections = []
  const sectionRe = /<div class="section[^"]*">\s*<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)<\/div>/gi
  let sec
  while ((sec = sectionRe.exec(html)) !== null) {
    const heading = sec[1].replace(/<[^>]+>/g, '').replace(/✓/g,'').trim()
    const body = sec[2]
    const itemRe = /<(?:li|p)[^>]*>([\s\S]*?)<\/(?:li|p)>/gi
    let item; const items = []
    while ((item = itemRe.exec(body)) !== null) {
      const text = item[1].replace(/<[^>]+>/g, '').trim()
      if (text && keywords.some(k => text.includes(k))) items.push(text)
    }
    if (items.length > 0) sections.push({ heading, items })
  }
  return sections
}

function StoreOverviewPage() {
  const now = new Date()
  const defaultMonth = now.toISOString().slice(0,7)
  const [timeFilter, setTimeFilter] = useState('custom')
  const [customMonth, setCustomMonth] = useState(defaultMonth)
  const meetings = store.get().filter(m => inRange(m.createdAt, timeFilter, customMonth))

  const storeData = STORES.map(s => {
    const allSections = {}
    meetings.forEach(m => {
      const secs = extractStoreSections(m.html || '', s.keywords)
      secs.forEach(sec => {
        if (!allSections[sec.heading]) allSections[sec.heading] = { items: [], meetings: new Set() }
        sec.items.forEach(item => {
          allSections[sec.heading].items.push({ text: item, meeting: m.title || m.date + ' 頭目會議' })
          allSections[sec.heading].meetings.add(m.id)
        })
      })
    })
    const totalItems = Object.values(allSections).reduce((acc, s) => acc + s.items.length, 0)
    return { ...s, sections: allSections, totalItems }
  })

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">分店總覽</span>
        <div className="topbar-filters">
          {[['month','本月'],['prev','上個月'],['custom','指定月份']].map(([k,v]) => (
            <button key={k} className={`tf-btn ${timeFilter===k?'active':''}`} onClick={() => setTimeFilter(k)}>{v}</button>
          ))}
          {(timeFilter === 'custom') && <input type="month" className="custom-month-input" value={customMonth} onChange={e => setCustomMonth(e.target.value)} />}
        </div>
      </div>
      <div className="page-content">
        {meetings.length === 0 ? (
          <div className="empty-state">此時間段沒有會議記錄</div>
        ) : (
          <div className="store-overview-grid">
            {storeData.map(s => (
              <div key={s.name} className={`store-card ${s.totalItems === 0 ? 'store-card-empty' : ''}`}>
                <div className="store-card-header">
                  <span className="store-card-name">{s.name}</span>
                  {s.totalItems > 0 && <span className="store-card-count">{s.totalItems} 則</span>}
                </div>
                {s.totalItems === 0 ? (
                  <div className="store-empty-msg">本期無相關記錄</div>
                ) : (
                  <div className="store-card-body">
                    {Object.entries(s.sections).map(([heading, data], i) => (
                      <div key={i} className="store-section-group">
                        <div className="store-section-heading">{heading}</div>
                        {data.items.map((item, j) => (
                          <div key={j} className="store-item-row">
                            <span className="store-item-bullet">•</span>
                            <div className="store-item-content">
                              <div className="store-item-text">{
                                (() => {
                                  let t = item.text
                                  s.keywords.forEach(k => {
                                    t = t.replace(new RegExp('^' + k + '[：:、，,\s]*', ''), '')
                                         .replace(new RegExp(k + '[：:、，,\s]*', 'g'), '')
                                  })
                                  return t.trim() || item.text
                                })()
                              }</div>
                              <div className="store-item-source">{item.meeting}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ── Stats Page ────────────────────────────────────────────
function StatsPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0,7))
  const meetings = store.get()

  const inMonth = (m) => (m.date || m.createdAt || '').startsWith(month)
  const monthMeetings = meetings.filter(inMonth)
  const allActions = monthMeetings.flatMap(m => m.actions || [])
  const done = allActions.filter(a => a.done)
  const overdue = allActions.filter(a => !a.done && isOverdue(a))
  const pct = allActions.length > 0 ? Math.round(done.length / allActions.length * 100) : 0

  // Per-person stats
  const people = [...new Set(allActions.map(a => a.person).filter(Boolean))]
  const personStats = people.map(p => {
    const tasks = allActions.filter(a => a.person === p)
    return { name: p, total: tasks.length, done: tasks.filter(a => a.done).length }
  }).sort((a, b) => b.total - a.total).slice(0, 8)

  // Tag distribution
  const tagCounts = {}
  monthMeetings.forEach(m => (m.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1 }))
  const tags = Object.entries(tagCounts).sort((a,b) => b[1]-a[1])

  // All months for selector
  const months = [...new Set(meetings.map(m => (m.date||m.createdAt||'').slice(0,7)).filter(Boolean))].sort().reverse()

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">月報統計</span>
        <div className="topbar-filters">
          <select className="month-select" value={month} onChange={e => setMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{m.replace('-',' 年 ')} 月</option>)}
          </select>
        </div>
      </div>
      <div className="page-content">
        <div className="stats-page">
          {/* Overview */}
          <div className="stats-overview-grid">
            <div className="stats-big-card">
              <div className="stats-big-num">{monthMeetings.length}</div>
              <div className="stats-big-label">本月會議次數</div>
            </div>
            <div className="stats-big-card">
              <div className="stats-big-num">{allActions.length}</div>
              <div className="stats-big-label">本月行動清單總數</div>
            </div>
            <div className="stats-big-card accent">
              <div className="stats-big-num">{pct}%</div>
              <div className="stats-big-label">任務完成率</div>
              <div className="stats-mini-bar-wrap"><div className="stats-mini-bar" style={{width: pct+'%'}} /></div>
            </div>
            <div className="stats-big-card red">
              <div className="stats-big-num">{overdue.length}</div>
              <div className="stats-big-label">逾期未完成</div>
            </div>
          </div>

          <div className="stats-two-col">
            {/* Person workload */}
            <div className="stats-card">
              <div className="stats-card-title">夥伴任務量</div>
              {personStats.length === 0 ? <div className="empty-state" style={{padding:'20px 0',fontSize:13}}>本月無資料</div> :
                personStats.map(s => (
                  <div key={s.name} className="person-stat-row">
                    <span className="person-stat-name">{s.name}</span>
                    <div className="person-stat-bar-wrap">
                      <div className="person-stat-bar" style={{width: personStats[0].total > 0 ? (s.total/personStats[0].total*100)+'%' : '0%'}} />
                    </div>
                    <span className="person-stat-num">{s.done}/{s.total}</span>
                  </div>
                ))
              }
            </div>

            {/* Meetings list */}
            <div className="stats-card">
              <div className="stats-card-title">本月會議列表</div>
              {monthMeetings.length === 0 ? <div className="empty-state" style={{padding:'20px 0',fontSize:13}}>本月無會議記錄</div> :
                monthMeetings.map(m => (
                  <div key={m.id} className="stats-meeting-row">
                    <div className="stats-meeting-date">{m.date}</div>
                    <div className="stats-meeting-title">{m.title || m.date + ' 頭目會議'}</div>
                    <div className="stats-meeting-tags">{(m.tags||[]).map(t => <span key={t} className="tag-pill-sm">{t}</span>)}</div>
                    <div className="stats-meeting-meta">{(m.actions||[]).filter(a=>a.done).length}/{(m.actions||[]).length} 完成</div>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="stats-card" style={{marginTop:16}}>
              <div className="stats-card-title">本月標籤分布</div>
              <div className="tags-dist">
                {tags.map(([t, n]) => (
                  <div key={t} className="tag-dist-row">
                    <span className="tag-pill">{t}</span>
                    <div className="tag-dist-bar-wrap"><div className="tag-dist-bar" style={{width: (n/tags[0][1]*100)+'%'}} /></div>
                    <span className="tag-dist-num">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── App ───────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('history')
  const unsavedRef = useRef(false)
  const [synced, setSynced] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [detailRecord, setDetailRecord] = useState(null)

  useEffect(() => {
    store.syncFromCloud().then(merged => {
      if (merged) setSynced(true)
    })
  }, [])

  const handleResult = async (r) => {
    // Auto-save immediately so it appears in list
    const title = (() => {
      const m = r.html?.match(/會議記錄｜([^<\n]+)/)
      return m ? m[1].trim() : r.date + ' 頭目會議'
    })()
    const saved = { ...r, title }
    await store.save(saved)
    setShowUpload(false); setDetailRecord(saved); setView('detail')
  }
  const handleOpen = (m) => { setDetailRecord(m); setView('detail') }
  const handleBack = () => { setDetailRecord(null); setView('history') }
  const isDetail = view === 'detail'
  const importRef = useRef(null)
  const handleExport = () => exportBackup()
  const handleImport = () => importRef.current?.click()
  const handleImportFile = (e) => {
    const f = e.target.files[0]; if (!f) return
    importBackup(f, (count) => { alert(`匯入成功！共 ${count} 筆記錄`); e.target.value = '' })
  }

  return (
    <>
      <Head>
        <title>會議記錄系統 ｜ 料韓男總部</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={FONTS} rel="stylesheet" />
      </Head>
      <div className="app-layout">
        <Sidebar
          view={isDetail ? 'history' : view}
          onNav={v => {
            if (isDetail && unsavedRef.current) {
              if (!confirm('有未儲存的變更，確定要離開嗎？')) return
            }
            setView(v); setDetailRecord(null)
          }}
          onUpload={() => {
            if (isDetail && unsavedRef.current) {
              if (!confirm('有未儲存的變更，確定要離開嗎？')) return
            }
            setShowUpload(true)
          }}
          onExport={handleExport}
          onImport={handleImport}
        />
        <input ref={importRef} type="file" accept=".json" style={{display:'none'}} onChange={handleImportFile} />
        <div className="main-area">
          {view === 'history' && !isDetail && <HistoryPage onOpen={handleOpen} />}
          {view === 'tasks' && <TasksPage />}
          {view === 'stats' && <StatsPage />}
          {view === 'stores' && <StoreOverviewPage />}
          {isDetail && detailRecord && <DetailPage record={detailRecord} onBack={handleBack} onUnsavedChange={v => { unsavedRef.current = v }} />}
        </div>
      </div>
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onResult={handleResult} />}
    </>
  )
}