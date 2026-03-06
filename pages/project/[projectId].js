import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { Plus, ArrowLeft, Loader, Trash2 } from 'lucide-react'
import Link from 'next/link'
import SupplierMatrix from '../../components/SupplierMatrix'

export default function ProjectPage() {
  const router = useRouter()
  const { projectId } = router.query
  const [project, setProject] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [requirements, setRequirements] = useState([])
  const [newSupplierName, setNewSupplierName] = useState('')
  const [newSupplierUrl, setNewSupplierUrl] = useState('')
  const [newRequirement, setNewRequirement] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [supplierCumulativeAnalysis, setSupplierCumulativeAnalysis] = useState({})

  // Fuzzy string matcher for requirement labels
  const fuzzyMatch = (str1, str2) => {
    if (str1 === str2) return 100
    const normalize = (s) => s.toLowerCase().replace(/[^a-z\u4E00-\u9FFF\s]/g, '').trim()
    const s1 = normalize(str1)
    const s2 = normalize(str2)
    if (s1 === s2) return 100
    if (s1.includes(s2) && s2.length > 1) return 85
    if (s2.includes(s1) && s1.length > 1) return 85
    const words1 = s1.match(/[a-z]+/g) || []
    const words2 = s2.match(/[a-z]+/g) || []
    if (words1.length > 0 && words2.length > 0) {
      const overlap = words1.filter(w => words2.includes(w)).length
      if (overlap > 0) {
        const score = (overlap / Math.max(words1.length, words2.length)) * 80
        if (score > 40) return score
      }
    }
    return 0
  }

  // Calculate cumulative analysis from all chats for a supplier
  const calculateCumulativeAnalysis = (supplierChats, allRequirements) => {
    if (!supplierChats || supplierChats.length === 0) return null

    // Start with all requirements as missing
    const cumulativeReqs = allRequirements.map(req => ({
      id: req.id,
      label: req.label,
      status: 'missing',
      evidence: ''
    }))

    // Process oldest-first so newer chats correctly override older ones with >= priority
    ;[...supplierChats].reverse().forEach(chat => {
      if (!chat.ai_analysis || !chat.ai_analysis.requirements) return

      chat.ai_analysis.requirements.forEach(chatReq => {
        // Use fuzzy matching (same as supplier page) instead of exact match
        let bestMatch = -1
        let bestScore = 0
        cumulativeReqs.forEach((req, idx) => {
          const score = fuzzyMatch(req.label, chatReq.label)
          if (score > bestScore) {
            bestScore = score
            bestMatch = idx
          }
        })

        if (bestMatch !== -1 && bestScore > 50) {
          const statusPriority = { confirmed: 4, partial: 3, conflict: 2, missing: 1 }
          const currentPriority = statusPriority[cumulativeReqs[bestMatch].status] || 0
          const newPriority = statusPriority[chatReq.status] || 0
          if (newPriority >= currentPriority) {
            cumulativeReqs[bestMatch].status = chatReq.status
            cumulativeReqs[bestMatch].evidence = chatReq.evidence
          }
        }
      })
    })

    return cumulativeReqs
  }

  useEffect(() => {
    if (projectId) {
      fetchProject()
    }
  }, [projectId])

  const fetchProject = async () => {
    try {
      setLoading(true)

      // Fetch project, suppliers, and requirements in parallel
      const [projectRes, suppliersRes, requirementsRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase.from('suppliers').select('*').eq('project_id', projectId),
        supabase.from('master_requirements').select('*').eq('project_id', projectId)
      ])

      const projectData = projectRes.data
      const suppliersData = suppliersRes.data || []
      const requirementsData = requirementsRes.data || []

      setProject(projectData)
      setSuppliers(suppliersData)
      setRequirements(requirementsData)

      // Fetch all supplier chats in parallel
      if (suppliersData.length > 0 && requirementsData.length > 0) {
        const chatResults = await Promise.all(
          suppliersData.map(supplier =>
            supabase.from('chats').select('*').eq('supplier_id', supplier.id)
              .then(res => ({ supplierId: supplier.id, chats: res.data || [] }))
          )
        )

        const analysisMap = {}
        chatResults.forEach(({ supplierId, chats }) => {
          if (chats.length === 0) return

          const realChats = chats.filter(c => c.raw_payload !== '__MANUAL_OVERRIDE__')
          const overrideEntry = chats.find(c => c.raw_payload === '__MANUAL_OVERRIDE__')
          const savedOverrides = overrideEntry?.ai_analysis?.overrides || {}

          let cumulativeReqs = realChats.length > 0
            ? calculateCumulativeAnalysis(realChats, requirementsData)
            : requirementsData.map(r => ({ id: r.id, label: r.label, status: 'missing', evidence: '' }))

          // Apply saved manual overrides
          if (Object.keys(savedOverrides).length > 0) {
            cumulativeReqs = cumulativeReqs.map(req =>
              savedOverrides[req.label] ? { ...req, status: savedOverrides[req.label] } : req
            )
          }

          if (realChats.length > 0 || Object.keys(savedOverrides).length > 0) {
            analysisMap[supplierId] = cumulativeReqs
          }
        })

        setSupplierCumulativeAnalysis(analysisMap)
      }
    } catch (error) {
      console.error('Error fetching project:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSupplier = async (supplierId) => {
    if (!confirm('Are you sure? This will delete the supplier + all chats.')) return

    try {
      // Delete all chats for this supplier
      await supabase.from('chats').delete().eq('supplier_id', supplierId)

      // Delete supplier
      await supabase.from('suppliers').delete().eq('id', supplierId)

      setSuppliers(suppliers.filter(s => s.id !== supplierId))
    } catch (error) {
      console.error('Error deleting supplier:', error)
      alert('Error deleting supplier')
    }
  }

  const handleAddSupplier = async (e) => {
    e.preventDefault()
    if (!newSupplierName.trim() || !newSupplierUrl.trim()) return

    setSaving(true)

    // Clear inputs immediately for better UX
    const supplierName = newSupplierName
    const supplierUrl = newSupplierUrl
    setNewSupplierName('')
    setNewSupplierUrl('')

    try {
      const { data, error } = await supabase
        .from('suppliers')
        .insert([{
          project_id: projectId,
          nickname: supplierName,
          url: supplierUrl,
          total_score: 0
        }])
        .select()

      if (error) throw error

      // Update suppliers list
      if (data && data[0]) {
        setSuppliers([...suppliers, data[0]])
      }
    } catch (error) {
      console.error('Error adding supplier:', error)
      alert('Error adding supplier: ' + error.message)
      // Reset inputs on error
      setNewSupplierName(supplierName)
      setNewSupplierUrl(supplierUrl)
    } finally {
      setSaving(false)
    }
  }

  const handleAddRequirement = async (e) => {
    e.preventDefault()
    if (!newRequirement.trim()) return

    setSaving(true)
    try {
      const { data } = await supabase
        .from('master_requirements')
        .insert([{
          project_id: projectId,
          label: newRequirement,
          status: 'pending',
          is_critical: false
        }])
        .select()

      setRequirements([...requirements, data[0]])
      setNewRequirement('')
    } catch (error) {
      console.error('Error adding requirement:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRequirement = async (requirementId) => {
    if (!confirm('Are you sure you want to delete this requirement?')) return

    try {
      const { error } = await supabase
        .from('master_requirements')
        .delete()
        .eq('id', requirementId)

      if (error) throw error
      setRequirements(requirements.filter(r => r.id !== requirementId))
    } catch (error) {
      console.error('Error deleting requirement:', error)
      alert('Error deleting requirement')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader className="animate-spin text-blue-600 mx-auto mb-4" size={40} />
          <p className="text-slate-600 font-medium">Loading project...</p>
        </div>
      </div>
    )
  }

  if (!project) {
    return <div>Project not found</div>
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-10 animate-fade-in">
          <Link href="/">
            <a className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold mb-4 transition-colors">
              <ArrowLeft size={18} /> Back to Projects
            </a>
          </Link>
          <h1 className="text-5xl md:text-6xl font-bold text-slate-900 mb-2">{project.name}</h1>
          <div className="flex items-center gap-3">
            <span className="text-slate-600">MOQ: <span className="font-bold text-slate-900">{project.moq}</span> units</span>
            <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
            <span className="text-slate-600">Created {new Date(project.created_at).toLocaleDateString()}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Add Supplier & Requirements */}
          <div className="lg:col-span-1 space-y-6 animate-slide-up">
            {/* Add Supplier */}
            <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-card p-6 border border-white/20">
              <h2 className="text-2xl font-bold text-slate-900 mb-5">➕ Add Supplier</h2>
              <form onSubmit={handleAddSupplier} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Nickname</label>
                  <input
                    type="text"
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    placeholder="e.g., Factory A"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50/50 hover:bg-slate-50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">1688.com URL</label>
                  <input
                    type="url"
                    value={newSupplierUrl}
                    onChange={(e) => setNewSupplierUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50/50 hover:bg-slate-50 transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-4 py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 shadow-soft hover:shadow-card transition-all"
                >
                  {saving ? <Loader className="animate-spin" size={16} /> : <Plus size={16} />}
                  Add Supplier
                </button>
              </form>
            </div>

            {/* Add Requirement */}
            <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-card p-6 border border-white/20">
              <h2 className="text-2xl font-bold text-slate-900 mb-5">📋 Master Requirements</h2>
              <form onSubmit={handleAddRequirement} className="space-y-4 mb-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Add Requirement</label>
                  <input
                    type="text"
                    value={newRequirement}
                    onChange={(e) => setNewRequirement(e.target.value)}
                    placeholder="e.g., 304 Steel"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50/50 hover:bg-slate-50 transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white px-4 py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 shadow-soft hover:shadow-card transition-all"
                >
                  {saving ? <Loader className="animate-spin" size={16} /> : <Plus size={16} />}
                  Add Requirement
                </button>
              </form>

              {/* Requirements List */}
              <div className="space-y-2">
                {requirements.length === 0 ? (
                  <p className="text-slate-500 text-sm italic">No requirements yet</p>
                ) : (
                  requirements.map((req) => (
                    <div key={req.id} className="p-3 bg-gradient-to-r from-slate-50 to-slate-100 rounded-lg text-sm text-slate-700 flex items-center justify-between group hover:from-slate-100 hover:to-slate-100 transition-colors border border-slate-200/50">
                      <span className="font-medium">{req.label}</span>
                      <button
                        onClick={() => handleDeleteRequirement(req.id)}
                        className="text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                        title="Delete requirement"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right: Supplier Matrix */}
          <div className="lg:col-span-2">
            <SupplierMatrix
              suppliers={suppliers}
              requirements={requirements}
              projectId={projectId}
              onDeleteSupplier={handleDeleteSupplier}
              supplierCumulativeAnalysis={supplierCumulativeAnalysis}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
