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

  useEffect(() => {
    if (router.query.projectId && router.query.supplierId) {
      fetchData()
    }
  }, [router.query])

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
        const reqIndex = cumulativeReqs.findIndex(r => r.label === chatReq.label)
        if (reqIndex !== -1) {
          // Prefer confirmed > conflict > missing
          if (chatReq.status === 'confirmed' || cumulativeReqs[reqIndex].status === 'missing') {
            cumulativeReqs[reqIndex].status = chatReq.status
            cumulativeReqs[reqIndex].evidence = chatReq.evidence
          } else if (chatReq.status === 'conflict' && cumulativeReqs[reqIndex].status !== 'confirmed') {
            cumulativeReqs[reqIndex].status = chatReq.status
            cumulativeReqs[reqIndex].evidence = chatReq.evidence
          }
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

    // Get next_question from the last chat that has one
    for (let i = allChats.length - 1; i >= 0; i--) {
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

      const { data: supplierData, error: supplierError } = await supabase
        .from('suppliers')
        .select('*')
        .eq('id', supplierId)
        .single()

      if (supplierError) throw supplierError

      const { data: chatsData, error: chatsError } = await supabase
        .from('chats')
        .select('*')
        .eq('supplier_id', supplierId)
        .order('created_at', { ascending: true })

      if (chatsError) throw chatsError

      const { data: requirementsData, error: requirementsError } = await supabase
        .from('master_requirements')
        .select('*')
        .eq('project_id', projectId)

      if (requirementsError) throw requirementsError

      const { data: suppliersData, error: suppliersError } = await supabase
        .from('suppliers')
        .select('*')
        .eq('project_id', projectId)

      if (suppliersError) throw suppliersError

      setSupplier(supplierData)
      setChats(chatsData || [])
      setRequirements(requirementsData || [])
      setSuppliers(suppliersData || [])

      // Calculate cumulative analysis from all chats
      if (chatsData && chatsData.length > 0 && requirementsData) {
        const cumulative = calculateCumulativeAnalysis(chatsData, requirementsData)
        setCumulativeAnalysis(cumulative)
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
      const result = await analyzeChat(chatText, requirements, cumulativeAnalysis)
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

      const newChats = [...chats, data[0]]
      setChats(newChats)

      // Update cumulative analysis with the new chat
      const cumulative = calculateCumulativeAnalysis(newChats, requirements)
      setCumulativeAnalysis(cumulative)

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
    alert('Copied to clipboard!')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <Loader className="animate-spin text-indigo-600" size={40} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8 flex items-center gap-4">
            <Link href={`/project/${projectId}`}>
              <a className="text-indigo-600 hover:text-indigo-700 flex items-center gap-2">
                <ArrowLeft size={20} /> Back
              </a>
            </Link>
          </div>
          <div className="bg-white rounded-lg shadow-lg p-6 text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-4">Error Loading Supplier</h2>
            <p className="text-gray-700 mb-4">{error}</p>
            <button
              onClick={() => router.reload()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-semibold"
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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8 flex items-center gap-4">
            <Link href={`/project/${projectId}`}>
              <a className="text-indigo-600 hover:text-indigo-700 flex items-center gap-2">
                <ArrowLeft size={20} /> Back
              </a>
            </Link>
          </div>
          <div className="bg-white rounded-lg shadow-lg p-6 text-center">
            <p className="text-gray-600">Supplier not found</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <Link href={`/project/${projectId}`}>
            <a className="text-indigo-600 hover:text-indigo-700 flex items-center gap-2">
              <ArrowLeft size={20} /> Back
            </a>
          </Link>
          <h1 className="text-4xl font-bold text-gray-900">{supplier.nickname}</h1>
        </div>

        {/* Supplier Info */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <p className="text-gray-600">
            URL: <a href={supplier.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
              {supplier.url}
            </a>
          </p>
        </div>

        {/* Quick Manufacturer Switcher */}
        {suppliers.length > 1 && (
          <div className="bg-indigo-50 rounded-lg shadow-lg p-4 mb-6 border border-indigo-200">
            <p className="text-sm font-semibold text-gray-700 mb-3">Switch to other manufacturers:</p>
            <div className="flex flex-wrap gap-2">
              {suppliers.map((s) => (
                <Link key={s.id} href={`/project/${projectId}/supplier/${s.id}`}>
                  <a
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                      s.id === supplierId
                        ? 'bg-indigo-600 text-white cursor-default'
                        : 'bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-100'
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
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Paste Chat Log</h2>
          <form onSubmit={handleAnalyzeChat} className="space-y-4">
            <textarea
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="Paste the supplier chat here..."
              className="w-full h-32 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={analyzing}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {analyzing ? <Loader className="animate-spin" size={20} /> : 'Analyze Chat'}
            </button>
          </form>
        </div>

        {/* Analysis Result - Cumulative from all chats */}
        {cumulativeAnalysis && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Analysis Result</h2>

            {/* Requirements Status */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Requirements Status</h3>
              <div className="grid gap-2">
                {cumulativeAnalysis.requirements?.map((req, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded">
                    <div
                      className={`w-4 h-4 rounded-full ${
                        req.status === 'confirmed'
                          ? 'bg-green-500'
                          : req.status === 'conflict'
                          ? 'bg-red-500'
                          : 'bg-gray-400'
                      }`}
                    />
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{req.label}</p>
                      <p className="text-sm text-gray-600">{req.evidence}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Next Question */}
            {cumulativeAnalysis.next_question_chinese && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Next Question to Ask Supplier</h3>

                {/* Chinese Version */}
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">🇨🇳 Chinese (Copy this)</h4>
                  <p className="text-gray-700 mb-3 p-3 bg-white rounded border border-blue-200 font-medium">{cumulativeAnalysis.next_question_chinese}</p>
                  <button
                    onClick={() => copyToClipboard(cumulativeAnalysis.next_question_chinese)}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm"
                  >
                    <Copy size={16} /> Copy Chinese Question
                  </button>
                </div>

                {/* English Translation */}
                {cumulativeAnalysis.next_question_english && (
                  <div className="pt-4 border-t border-blue-200">
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">🇬🇧 English (For reference only)</h4>
                    <p className="text-gray-600 italic">{cumulativeAnalysis.next_question_english}</p>
                  </div>
                )}
              </div>
            )}

            {/* Supplier Notes */}
            {cumulativeAnalysis.supplier_notes && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Supplier Notes</h3>
                <p className="text-gray-700">{cumulativeAnalysis.supplier_notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Chat History with Analysis */}
        {chats.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Chat History</h2>
            <div className="space-y-6">
              {chats.map((chat) => (
                <div key={chat.id} className="border-l-4 border-indigo-500 pl-4 pb-6 last:pb-0 last:border-b-0">
                  {/* Date */}
                  <p className="text-sm font-semibold text-gray-600 mb-2">
                    📅 {new Date(chat.created_at).toLocaleString()}
                  </p>

                  {/* Chat Text */}
                  <div className="bg-gray-50 rounded p-3 mb-3">
                    <p className="text-gray-700 text-sm whitespace-pre-wrap">{chat.raw_payload}</p>
                  </div>

                  {/* Analysis if exists */}
                  {chat.ai_analysis && (
                    <div className="bg-blue-50 rounded-lg p-4 mt-3 border border-blue-200">
                      <h4 className="font-semibold text-gray-900 mb-3">AI Analysis</h4>

                      {/* Requirements Status */}
                      {chat.ai_analysis.requirements && (
                        <div className="mb-4">
                          <h5 className="text-sm font-semibold text-gray-700 mb-2">Requirements:</h5>
                          <div className="space-y-1">
                            {chat.ai_analysis.requirements.map((req, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-sm">
                                <div
                                  className={`w-3 h-3 rounded-full flex-shrink-0 ${
                                    req.status === 'confirmed'
                                      ? 'bg-green-500'
                                      : req.status === 'conflict'
                                      ? 'bg-red-500'
                                      : 'bg-gray-400'
                                  }`}
                                />
                                <span className="text-gray-700">{req.label}: <span className="text-gray-600 italic">{req.evidence}</span></span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Next Question */}
                      {chat.ai_analysis.next_question_chinese && (
                        <div className="bg-white rounded p-3 mb-3">
                          <p className="text-xs font-semibold text-gray-600 mb-1">🇨🇳 Next Question (Chinese):</p>
                          <p className="text-sm text-gray-800 font-medium">{chat.ai_analysis.next_question_chinese}</p>
                          {chat.ai_analysis.next_question_english && (
                            <>
                              <p className="text-xs font-semibold text-gray-600 mt-2 mb-1">🇬🇧 English:</p>
                              <p className="text-sm text-gray-700">{chat.ai_analysis.next_question_english}</p>
                            </>
                          )}
                        </div>
                      )}

                      {/* Notes */}
                      {chat.ai_analysis.supplier_notes && (
                        <div className="bg-white rounded p-3 text-sm">
                          <p className="text-xs font-semibold text-gray-600 mb-1">📝 Notes:</p>
                          <p className="text-gray-700">{chat.ai_analysis.supplier_notes}</p>
                          {chat.ai_analysis.supplier_notes_english && chat.ai_analysis.supplier_notes_english !== chat.ai_analysis.supplier_notes && (
                            <>
                              <p className="text-xs font-semibold text-gray-600 mt-2 mb-1">🇨🇳 Chinese:</p>
                              <p className="text-gray-700">{chat.ai_analysis.supplier_notes_english}</p>
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
