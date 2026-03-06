import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../../../lib/supabase'
import { analyzeChat } from '../../../../lib/openai'
import { ArrowLeft, Loader, Copy } from 'lucide-react'
import Link from 'next/link'

export default function SupplierAuditPage() {
  const router = useRouter()
  const { projectId, supplierId } = router.query
  const [supplier, setSupplier] = useState(null)
  const [chats, setChats] = useState([])
  const [requirements, setRequirements] = useState([])
  const [chatText, setChatText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [cumulativeAnalysis, setCumulativeAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [manualOverrides, setManualOverrides] = useState({})
  const [openStatusMenu, setOpenStatusMenu] = useState(null)
  const [lastQuestion, setLastQuestion] = useState({ english: '', chinese: '' })

  useEffect(() => {
    if (router.query.projectId && router.query.supplierId) {
      fetchData()
    }
  }, [router.query])

  // Fuzzy string matcher for requirement labels (works with English and Chinese)
  const fuzzyMatch = (str1, str2) => {
    // For exact match (includes Chinese exact match)
    if (str1 === str2) return 100

    // Normalize for Latin text (lowercase, remove punctuation/numbers)
    const normalizeLatin = (s) => s.toLowerCase().replace(/[^a-z\u4E00-\u9FFF\s]/g, '').trim()
    const s1 = normalizeLatin(str1)
    const s2 = normalizeLatin(str2)

    // Case-insensitive exact match
    if (s1 === s2) return 100

    // Debug: Log matches that score >60
    const debugMatch = (score, reason) => {
      if (score > 60) {
        console.log(`FUZZY MATCH: "${str1}" <-> "${str2}" = ${score} (${reason})`)
      }
      return score
    }

    // Check if one contains the other (works for both languages)
    if (s1.includes(s2) && s2.length > 1) return debugMatch(85, 'contains')
    if (s2.includes(s1) && s1.length > 1) return debugMatch(85, 'contained_by')

    // For Latin: word overlap
    const latinWords1 = s1.match(/[a-z]+/g) || []
    const latinWords2 = s2.match(/[a-z]+/g) || []
    if (latinWords1.length > 0 && latinWords2.length > 0) {
      const overlap = latinWords1.filter(w => latinWords2.includes(w)).length
      if (overlap > 0) {
        const score = (overlap / Math.max(latinWords1.length, latinWords2.length)) * 80
        if (score > 40) return debugMatch(score, `word_overlap: ${overlap}/${Math.max(latinWords1.length, latinWords2.length)}`)
      }
    }

    // For Chinese: character overlap
    const chineseChars1 = s1.match(/[\u4E00-\u9FFF]/g) || []
    const chineseChars2 = s2.match(/[\u4E00-\u9FFF]/g) || []
    if (chineseChars1.length > 0 && chineseChars2.length > 0) {
      const overlap = chineseChars1.filter(c => chineseChars2.includes(c)).length
      if (overlap > 0) {
        const score = (overlap / Math.max(chineseChars1.length, chineseChars2.length)) * 80
        if (score > 40) return debugMatch(score, `char_overlap: ${overlap}/${Math.max(chineseChars1.length, chineseChars2.length)}`)
      }
    }

    // Levenshtein distance for mixed content (LOWERED THRESHOLD from 40 to 35 for better matching)
    const levenshteinScore = (1 - levenshteinDistance(s1, s2) / Math.max(s1.length, s2.length)) * 70
    if (levenshteinScore > 35) return debugMatch(levenshteinScore, `levenshtein: ${levenshteinScore.toFixed(1)}`)

    return 0
  }

  // Helper: Levenshtein distance algorithm (works for both languages)
  const levenshteinDistance = (a, b) => {
    const matrix = []
    for (let i = 0; i <= b.length; i++) matrix[i] = [i]
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          )
        }
      }
    }
    return matrix[b.length][a.length]
  }

  // Calculate cumulative analysis from all chats
  const calculateCumulativeAnalysis = (allChats, allRequirements) => {
    if (!allChats || allChats.length === 0) return null

    // Start with all requirements as missing
    const cumulativeReqs = allRequirements.map(req => ({
      id: req.id,
      label: req.label,
      status: 'missing',
      evidence: ''
    }))

    // Process each chat's analysis
    allChats.forEach(chat => {
      if (!chat.ai_analysis || !chat.ai_analysis.requirements) return

      chat.ai_analysis.requirements.forEach(chatReq => {
        // Find best matching requirement using fuzzy matching
        let bestMatch = -1
        let bestScore = 0

        cumulativeReqs.forEach((req, idx) => {
          const score = fuzzyMatch(req.label, chatReq.label)
          if (score > bestScore) {
            bestScore = score
            bestMatch = idx
          }
        })

        // Only match if confidence is high (>50% - lowered from 60% to catch more matches)
        if (bestMatch !== -1 && bestScore > 50) {
          const reqIndex = bestMatch
          // Priority: confirmed > partial > conflict > missing
          const statusPriority = { confirmed: 4, partial: 3, conflict: 2, missing: 1 }
          const currentPriority = statusPriority[cumulativeReqs[reqIndex].status] || 0
          const newPriority = statusPriority[chatReq.status] || 0

          // Update if new status is higher priority, or same priority (for more recent evidence)
          if (newPriority >= currentPriority) {
            cumulativeReqs[reqIndex].status = chatReq.status
            cumulativeReqs[reqIndex].evidence = chatReq.evidence
            console.log(`✅ MATCHED: AI req "${chatReq.label}" (${chatReq.status}) -> Master req "${cumulativeReqs[reqIndex].label}" [score: ${bestScore.toFixed(1)}]`)
          }
        } else if (bestMatch === -1) {
          console.log(`❌ NO MATCH for AI req: "${chatReq.label}" - would need score > 50`)
        } else {
          console.log(`⚠️ LOW SCORE for "${chatReq.label}": ${bestScore.toFixed(1)} (need > 50)`)
        }
      })
    })

    // Build cumulative analysis
    const cumulative = {
      requirements: cumulativeReqs,
      next_question_chinese: '',
      next_question_english: '',
      supplier_notes: ''
    }

    // Get next_question from the MOST RECENT chat that has one
    // (chats array is sorted newest-first, so index 0 is the latest)
    for (let i = 0; i < allChats.length; i++) {
      if (allChats[i].ai_analysis?.next_question_chinese) {
        cumulative.next_question_chinese = allChats[i].ai_analysis.next_question_chinese
        cumulative.next_question_english = allChats[i].ai_analysis.next_question_english || ''
        break
      }
    }

    // Collect supplier notes from all chats
    const notesList = []
    allChats.forEach(chat => {
      if (chat.ai_analysis?.supplier_notes && !notesList.includes(chat.ai_analysis.supplier_notes)) {
        notesList.push(chat.ai_analysis.supplier_notes)
      }
    })
    if (notesList.length > 0) {
      cumulative.supplier_notes = notesList.join(' | ')
    }

    return cumulative
  }

  const fetchData = async () => {
    // Safety check
    if (!supplierId || !projectId) {
      setError('Missing supplier or project ID')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      // Fetch all data in parallel for faster loading
      const [supplierRes, chatsRes, requirementsRes, suppliersRes] = await Promise.all([
        supabase.from('suppliers').select('*').eq('id', supplierId).single(),
        supabase.from('chats').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: false }),
        supabase.from('master_requirements').select('*').eq('project_id', projectId),
        supabase.from('suppliers').select('*').eq('project_id', projectId)
      ])

      if (supplierRes.error) throw supplierRes.error
      if (chatsRes.error) throw chatsRes.error
      if (requirementsRes.error) throw requirementsRes.error
      if (suppliersRes.error) throw suppliersRes.error

      const supplierData = supplierRes.data
      const chatsData = chatsRes.data
      const requirementsData = requirementsRes.data
      const suppliersData = suppliersRes.data

      // Split chats: real chats vs override entry
      const realChats = (chatsData || []).filter(c => c.raw_payload !== '__MANUAL_OVERRIDE__')
      const overrideEntry = (chatsData || []).find(c => c.raw_payload === '__MANUAL_OVERRIDE__')
      const savedOverrides = overrideEntry?.ai_analysis?.overrides || {}

      setSupplier(supplierData)
      setChats(realChats)
      setRequirements(requirementsData || [])
      setSuppliers(suppliersData || [])
      setManualOverrides(savedOverrides)

      // Calculate cumulative analysis from all real chats + apply overrides
      const cumulativeBase = realChats.length > 0 && requirementsData
        ? calculateCumulativeAnalysis(realChats, requirementsData)
        : requirementsData
          ? { requirements: requirementsData.map(r => ({ id: r.id, label: r.label, status: 'missing', evidence: '' })), next_question_chinese: '', next_question_english: '', supplier_notes: '' }
          : null

      if (cumulativeBase) {
        // Apply saved overrides
        if (Object.keys(savedOverrides).length > 0) {
          cumulativeBase.requirements = cumulativeBase.requirements.map(req => {
            if (savedOverrides[req.label]) {
              return { ...req, status: savedOverrides[req.label] }
            }
            return req
          })
        }
        setCumulativeAnalysis(cumulativeBase)

        // Initialize lastQuestion from the most recent chat that has one
        if (cumulativeBase.next_question_english || cumulativeBase.next_question_chinese) {
          setLastQuestion({
            english: cumulativeBase.next_question_english || '',
            chinese: cumulativeBase.next_question_chinese || ''
          })
        }
      } else {
        setCumulativeAnalysis(null)
      }
    } catch (err) {
      console.error('Error fetching data:', err)
      setError(err.message || 'Failed to load supplier data')
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyzeChat = async (e) => {
    e.preventDefault()
    if (!chatText.trim()) return

    // Safety check: ensure supplierId is available
    if (!supplierId) {
      alert('Supplier ID not loaded. Please refresh the page.')
      return
    }

    setAnalyzing(true)
    try {
      const result = await analyzeChat(chatText, requirements, cumulativeAnalysis, lastQuestion.english || lastQuestion.chinese ? lastQuestion : null)
      setAnalysis(result)

      // Save chat with explicit supplierId check
      const { data, error } = await supabase
        .from('chats')
        .insert([{
          supplier_id: supplierId,
          raw_payload: chatText,
          ai_analysis: result
        }])
        .select()

      if (error) throw error
      if (!data || !data[0]) throw new Error('Chat save failed')

      const newChats = [data[0], ...chats]
      setChats(newChats)

      // Update cumulative analysis and re-apply overrides
      const cumulative = calculateCumulativeAnalysis(newChats, requirements)
      if (Object.keys(manualOverrides).length > 0) {
        cumulative.requirements = cumulative.requirements.map(req =>
          manualOverrides[req.label] ? { ...req, status: manualOverrides[req.label] } : req
        )
      }
      setCumulativeAnalysis(cumulative)

      // Store this question as the last question for the next analysis round
      if (result.next_question_english || result.next_question_chinese) {
        setLastQuestion({
          english: result.next_question_english || '',
          chinese: result.next_question_chinese || ''
        })
      }

      setChatText('')
    } catch (error) {
      console.error('Error analyzing chat:', error)
      alert('Error analyzing chat: ' + error.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
  }

  const handleStatusChange = async (requirementLabel, newStatus) => {
    const newOverrides = { ...manualOverrides, [requirementLabel]: newStatus }

    // Update local state immediately
    setManualOverrides(newOverrides)
    if (cumulativeAnalysis) {
      setCumulativeAnalysis({
        ...cumulativeAnalysis,
        requirements: cumulativeAnalysis.requirements.map(req =>
          req.label === requirementLabel ? { ...req, status: newStatus } : req
        )
      })
    }

    // Save to chats table as a special override entry (no schema changes needed)
    try {
      const { data: existing } = await supabase
        .from('chats')
        .select('id')
        .eq('supplier_id', supplierId)
        .eq('raw_payload', '__MANUAL_OVERRIDE__')
        .maybeSingle()

      if (existing) {
        await supabase
          .from('chats')
          .update({ ai_analysis: { overrides: newOverrides } })
          .eq('id', existing.id)
      } else {
        await supabase
          .from('chats')
          .insert([{ supplier_id: supplierId, raw_payload: '__MANUAL_OVERRIDE__', ai_analysis: { overrides: newOverrides } }])
      }
    } catch (err) {
      console.error('Error saving override:', err)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader className="animate-spin text-blue-600 mx-auto mb-4" size={40} />
          <p className="text-slate-600 font-medium">Loading supplier details...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 p-6 md:p-8">
        <div className="max-w-4xl mx-auto">
          <Link href={`/project/${projectId}`}>
            <a className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold mb-6 transition-colors">
              <ArrowLeft size={18} /> Back to Project
            </a>
          </Link>
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-card border border-white/20 p-8 text-center">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold text-red-600 mb-3">Error Loading Supplier</h2>
            <p className="text-slate-600 mb-6">{error}</p>
            <button
              onClick={() => router.reload()}
              className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-3 rounded-lg font-semibold transition-all"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!supplier) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 p-6 md:p-8">
        <div className="max-w-4xl mx-auto">
          <Link href={`/project/${projectId}`}>
            <a className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold mb-6 transition-colors">
              <ArrowLeft size={18} /> Back to Project
            </a>
          </Link>
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-card border border-white/20 p-8 text-center">
            <div className="text-4xl mb-4">🔍</div>
            <p className="text-slate-600 text-lg">Supplier not found</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 p-6 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-10 animate-fade-in">
          <Link href={`/project/${projectId}`}>
            <a className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold mb-4 transition-colors">
              <ArrowLeft size={18} /> Back to Project
            </a>
          </Link>
          <h1 className="text-5xl md:text-6xl font-bold text-slate-900">{supplier.nickname}</h1>
        </div>

        {/* Supplier Info */}
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-card p-6 mb-6 border border-white/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-600 text-sm font-semibold mb-2">SUPPLIER URL</p>
              <a href={supplier.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 font-medium break-all transition-colors">
                {supplier.url}
              </a>
            </div>
            <button
              onClick={() => window.open(supplier.url, '_blank')}
              className="ml-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold text-sm transition-all"
            >
              Open ↗
            </button>
          </div>
        </div>

        {/* Quick Manufacturer Switcher */}
        {suppliers.length > 1 && (
          <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-2xl shadow-card p-5 mb-8 border border-blue-200/50">
            <p className="text-sm font-bold text-slate-700 mb-4">🏭 Other Suppliers in Project:</p>
            <div className="flex flex-wrap gap-3">
              {suppliers.map((s) => (
                <Link key={s.id} href={`/project/${projectId}/supplier/${s.id}`}>
                  <a
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                      s.id === supplierId
                        ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg cursor-default'
                        : 'bg-white text-blue-600 border border-blue-300 hover:shadow-md hover:border-blue-400'
                    }`}
                  >
                    {s.nickname}
                  </a>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Chat Input */}
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-card p-6 mb-8 border border-white/20 animate-slide-up">
          <div className="mb-5">
            <h2 className="text-3xl font-bold text-slate-900">💬 Analyze Chat Log</h2>
            <p className="text-slate-600 mt-2">Paste supplier communication to analyze requirements</p>
          </div>
          <form onSubmit={handleAnalyzeChat} className="space-y-4">
            <textarea
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="Paste the supplier chat here..."
              className="w-full h-32 px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50/50 hover:bg-slate-50 transition-colors font-mono text-sm resize-none"
            />
            <button
              type="submit"
              disabled={analyzing}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 shadow-soft hover:shadow-card transition-all"
            >
              {analyzing ? <Loader className="animate-spin" size={20} /> : '🔍 Analyze Chat'}
            </button>
          </form>
        </div>

        {/* Analysis Result - Cumulative from all chats */}
        {cumulativeAnalysis && (
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-card p-6 mb-8 border border-white/20 animate-slide-up">
            <div className="mb-6">
              <h2 className="text-3xl font-bold text-slate-900">📊 Analysis Results</h2>
              <p className="text-slate-600 mt-2">Cumulative analysis from all chat logs</p>
            </div>

            {/* Requirements Status */}
            <div className="mb-8">
              <h3 className="text-lg font-bold text-slate-900 mb-4">✅ Requirements Status (Click to Change)</h3>
              <div className="grid gap-3">
                {cumulativeAnalysis.requirements?.map((req, idx) => {
                  const statusKey = `${supplierId}_${req.label}`
                  const displayStatus = manualOverrides[statusKey] || req.status
                  const isOpen = openStatusMenu === idx

                  return (
                    <div key={idx} className="flex items-center gap-3 p-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-lg relative group hover:shadow-soft transition-shadow border border-slate-200/50">
                      <div className="relative">
                        <button
                          onClick={() => setOpenStatusMenu(isOpen ? null : idx)}
                          className={`w-8 h-8 rounded-full cursor-pointer transition hover:scale-125 hover:shadow-lg flex-shrink-0 ${
                            displayStatus === 'confirmed'
                              ? 'bg-gradient-to-br from-emerald-400 to-emerald-500 shadow-lg shadow-emerald-500/30'
                              : displayStatus === 'partial'
                              ? 'bg-gradient-to-br from-amber-400 to-amber-500 shadow-lg shadow-amber-500/30'
                              : displayStatus === 'conflict'
                              ? 'bg-gradient-to-br from-red-400 to-red-500 shadow-lg shadow-red-500/30'
                              : 'bg-gradient-to-br from-slate-300 to-slate-400 shadow-lg shadow-slate-400/20'
                          }`}
                          title="Click to change status"
                        />

                        {isOpen && (
                          <div className="absolute top-10 left-0 bg-white border border-slate-200 rounded-lg shadow-hover z-50 w-48 overflow-hidden">
                            {['confirmed', 'partial', 'conflict', 'missing'].map(status => (
                              <button
                                key={status}
                                onClick={() => {
                                  handleStatusChange(req.label, status)
                                  setOpenStatusMenu(null)
                                }}
                                className={`w-full text-left px-4 py-3 text-sm hover:bg-blue-50 flex items-center gap-3 border-b border-slate-100 last:border-b-0 transition-colors ${
                                  displayStatus === status ? 'bg-blue-100 font-semibold text-blue-900' : 'text-slate-700'
                                }`}
                              >
                                <div className={`w-3 h-3 rounded-full ${
                                  status === 'confirmed' ? 'bg-emerald-500' :
                                  status === 'partial' ? 'bg-amber-500' :
                                  status === 'conflict' ? 'bg-red-500' :
                                  'bg-slate-400'
                                }`} />
                                {status.charAt(0).toUpperCase() + status.slice(1)}
                                {displayStatus === status && '✓'}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{req.label}</p>
                        {req.evidence && <p className="text-sm text-slate-600 mt-1">"{req.evidence}"</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Next Question */}
            {cumulativeAnalysis.next_question_chinese && (
              <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200/50 rounded-xl p-5 mb-6">
                <h3 className="text-lg font-bold text-slate-900 mb-4">❓ Next Question to Ask</h3>

                {/* Chinese Version */}
                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xl">🇨🇳</span>
                    <h4 className="text-sm font-bold text-slate-700">Chinese (Copy & Paste)</h4>
                  </div>
                  <p className="text-slate-800 mb-4 p-4 bg-white rounded-lg border border-blue-200 font-medium leading-relaxed">{cumulativeAnalysis.next_question_chinese}</p>
                  <button
                    onClick={() => copyToClipboard(cumulativeAnalysis.next_question_chinese)}
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-soft hover:shadow-card"
                  >
                    <Copy size={16} /> Copy
                  </button>
                </div>

                {/* English Translation */}
                {cumulativeAnalysis.next_question_english && (
                  <div className="pt-5 border-t border-blue-200/50">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">🇬🇧</span>
                      <h4 className="text-sm font-bold text-slate-700">English (Reference)</h4>
                    </div>
                    <p className="text-slate-700 italic leading-relaxed">{cumulativeAnalysis.next_question_english}</p>
                  </div>
                )}
              </div>
            )}

            {/* Supplier Notes */}
            {cumulativeAnalysis.supplier_notes && (
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-5 border border-amber-200/50">
                <h3 className="text-lg font-bold text-slate-900 mb-3">📝 Supplier Notes</h3>
                <p className="text-slate-700 leading-relaxed">{cumulativeAnalysis.supplier_notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Chat History with Analysis */}
        {chats.length > 0 && (
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-card p-6 border border-white/20 animate-slide-up">
            <div className="mb-6">
              <h2 className="text-3xl font-bold text-slate-900">💭 Chat History</h2>
              <p className="text-slate-600 mt-2">All analyzed supplier communications</p>
            </div>
            <div className="space-y-6">
              {chats.map((chat, idx) => (
                <div key={chat.id} className="border-l-4 border-blue-400 pl-6 pb-6 last:pb-0 last:border-l-0 relative">
                  {/* Timeline dot */}
                  <div className="absolute -left-2.5 top-0 w-5 h-5 bg-gradient-to-br from-blue-400 to-blue-500 rounded-full shadow-lg border-4 border-white"></div>

                  {/* Date */}
                  <p className="text-sm font-bold text-slate-600 mb-3">
                    📅 {new Date(chat.created_at).toLocaleString()}
                  </p>

                  {/* Original Chat Text - PROMINENT */}
                  <div className="bg-gradient-to-r from-yellow-50 to-orange-50 rounded-xl p-4 mb-4 border-2 border-yellow-200/50">
                    <h5 className="text-xs font-bold text-yellow-900 mb-3 uppercase tracking-wider">📝 Original Chat (Raw Input)</h5>
                    <p className="text-slate-800 text-sm whitespace-pre-wrap font-mono bg-white p-3 rounded-lg border border-yellow-100 bg-opacity-50">{chat.raw_payload}</p>
                  </div>

                  {/* Analysis if exists */}
                  {chat.ai_analysis && (
                    <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl p-5 border border-blue-200/50">
                      <h4 className="font-bold text-slate-900 mb-4">🔍 AI Analysis</h4>

                      {/* Requirements Status */}
                      {chat.ai_analysis.requirements && (
                        <div className="mb-5">
                          <h5 className="text-sm font-bold text-slate-800 mb-3">✓ Requirements Matched:</h5>
                          <div className="space-y-2">
                            {chat.ai_analysis.requirements.map((req, reqIdx) => (
                              <div key={reqIdx} className="flex items-start gap-3 text-sm p-3 bg-white rounded-lg border border-blue-100">
                                <div
                                  className={`w-4 h-4 rounded-full flex-shrink-0 mt-0.5 ${
                                    req.status === 'confirmed'
                                      ? 'bg-emerald-500'
                                      : req.status === 'partial'
                                      ? 'bg-amber-500'
                                      : req.status === 'conflict'
                                      ? 'bg-red-500'
                                      : 'bg-slate-400'
                                  }`}
                                />
                                <div className="flex-1">
                                  <p className="font-semibold text-slate-900">{req.label}</p>
                                  <div className="flex items-center gap-2 mt-1 text-xs">
                                    <span className="font-bold text-slate-600">{req.status === 'confirmed' ? '✅ CONFIRMED' : req.status === 'partial' ? '🟠 PARTIAL' : req.status === 'conflict' ? '❌ CONFLICT' : '⏳ MISSING'}</span>
                                  </div>
                                  {req.evidence && <p className="text-slate-700 italic mt-2">💡 "{req.evidence}"</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Next Question */}
                      {chat.ai_analysis.next_question_chinese && (
                        <div className="bg-white rounded-lg p-4 mb-4 border border-blue-100">
                          <p className="text-xs font-bold text-slate-700 mb-2">🇨🇳 Next Question (Chinese):</p>
                          <p className="text-sm text-slate-800 font-medium leading-relaxed">{chat.ai_analysis.next_question_chinese}</p>
                          {chat.ai_analysis.next_question_english && (
                            <>
                              <p className="text-xs font-bold text-slate-700 mt-3 mb-2">🇬🇧 English:</p>
                              <p className="text-sm text-slate-700 italic">{chat.ai_analysis.next_question_english}</p>
                            </>
                          )}
                        </div>
                      )}

                      {/* Notes */}
                      {chat.ai_analysis.supplier_notes && (
                        <div className="bg-white rounded-lg p-4 text-sm border border-blue-100">
                          <p className="text-xs font-bold text-slate-700 mb-2">📝 Notes:</p>
                          <p className="text-slate-700 leading-relaxed">{chat.ai_analysis.supplier_notes}</p>
                          {chat.ai_analysis.supplier_notes_english && chat.ai_analysis.supplier_notes_english !== chat.ai_analysis.supplier_notes && (
                            <>
                              <p className="text-xs font-bold text-slate-700 mt-3 mb-2">🇨🇳 Chinese:</p>
                              <p className="text-slate-700">{chat.ai_analysis.supplier_notes_english}</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
