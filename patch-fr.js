const fs = require('fs');
let c = fs.readFileSync('pages/index.js', 'utf8');

// Add FindReplace component before DetailPage
const comp = `
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

  const handleFindChange = (val) => {
    setFind(val); setCount(null)
    if (!contentRef.current) return
    // clear first
    const base = contentRef.current.innerHTML.replace(/<mark class="fr-hl">(.*?)<\/mark>/g, '$1')
    if (!val) { contentRef.current.innerHTML = base; return }
    const safe = val.replace(/[.*+?^${}()|[\]\\\\]/g, '\\\\$&')
    const re = new RegExp(safe, 'gi')
    const matches = (base.replace(/<[^>]+>/g, '').match(re) || []).length
    setCount(matches)
    contentRef.current.innerHTML = base.replace(re, m => '<mark class="fr-hl">' + m + '</mark>')
  }

  const handleReplaceAll = () => {
    if (!contentRef.current || !find) return
    clearHL()
    const safe = find.replace(/[.*+?^${}()|[\]\\\\]/g, '\\\\$&')
    const re = new RegExp(safe, 'gi')
    const walker = document.createTreeWalker(contentRef.current, NodeFilter.SHOW_TEXT)
    const nodes = []; let node
    while ((node = walker.nextNode())) nodes.push(node)
    let total = 0
    nodes.forEach(n => {
      const matches = n.textContent.match(re)
      if (matches) { total += matches.length; n.textContent = n.textContent.replace(re, replace) }
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
        <input className="fr-input" value={replace} onChange={e => setReplace(e.target.value)} placeholder="取代為…" onKeyDown={e => e.key === 'Enter' && handleReplaceAll()} />
        <button className="fr-btn" onClick={handleReplaceAll} disabled={!find}>全部取代</button>
      </div>
      <button className="fr-close" onClick={() => { clearHL(); onClose() }}>✕</button>
    </div>
  )
}

`;

c = c.replace('// ── Detail Page ─────────────────────────────────────────', comp + '// ── Detail Page ─────────────────────────────────────────');

// Add state
c = c.replace(
  '  const [exporting, setExporting] = useState(false)',
  '  const [exporting, setExporting] = useState(false)\n  const [showFR, setShowFR] = useState(false)'
);

// Add keyboard shortcut
c = c.replace(
  '  useEffect(() => {\n    if (!initial.title) {',
  `  useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'h') { e.preventDefault(); setShowFR(v => !v) } }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    if (!initial.title) {`
);

// Add button to toolbar
c = c.replace(
  '<button className="btn-save" style={{background:saveBg}} onClick={doSave}>{saveLabel}</button>',
  '<button className="btn-find" onClick={() => setShowFR(v => !v)} title="尋找/取代 (Cmd+H)">尋找／取代</button>\n        <button className="btn-save" style={{background:saveBg}} onClick={doSave}>{saveLabel}</button>'
);

// Add FindReplace below topbar
c = c.replace(
  '        {record.unknownPersons?.length > 0 && <UnknownPersonsBanner persons={record.unknownPersons} />}',
  '        {showFR && <FindReplace contentRef={contentRef} onClose={() => setShowFR(false)} />}\n        {record.unknownPersons?.length > 0 && <UnknownPersonsBanner persons={record.unknownPersons} />}'
);

fs.writeFileSync('pages/index.js', c);
console.log('done');
