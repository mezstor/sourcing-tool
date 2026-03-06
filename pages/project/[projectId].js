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

    // Process each chat's analysis
    supplierChats.forEach(chat => {
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

  // Refresh analysis when returning from supplier page
  useEffect(() => {
    if (projectId && router.asPath && !router.asPath.includes('/supplier/')) {
      // Slight delay to ensure we're back on the project page
      const timer = setTimeout(() => {
        if (suppliers.length > 0 && requirements.length > 0) {
          refreshSupplierAnalysis()
        }
      }, 100)
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.asPath, projectId])

  const fetchProject = async () => {
    try {
      setLoading(true)
      const { data: projectData } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single()

      const { data: suppliersData } = await supabase
        .from('suppliers')
        .select('*')
        .eq('project_id', projectId)

      const { data: requirementsData } = await supabase
        .from('master_requirements')
        .select('*')
        .eq('project_id', projectId)

      setProject(projectData)
      setSuppliers(suppliersData || [])
      setRequirements(requirementsData || [])

      // Fetch chats for each supplier and calculate cumulative analysis
      if (suppliersData && requirementsData) {
        const analysisMap = {}
        for (const supplier of suppliersData) {
          const { data: chatsData } = await supabase
            .from('chats')
            .select('*')
            .eq('supplier_id', supplier.id)

          if (chatsData && chatsData.length > 0) {
            // Split real chats from override entry
            const realChats = chatsData.filter(c => c.raw_payload !== '__MANUAL_OVERRIDE__')
            const overrideEntry = chatsData.find(c => c.raw_payload === '__MANUAL_OVERRIDE__')
            const savedOverrides = overrideEntry?.ai_analysis?.overrides || {}

            // Base analysis from real chats, or all-missing if no chats
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
              analysisMap[supplier.id] = cumulativeReqs
            }
          }
        }
        setSupplierCumulativeAnalysis(analysisMap)
      }
    } catch (error) {
      console.error('Error fetching project:', error)
    } finally {
      setLoading(false)
    }
  }

  const refreshSupplierAnalysis = async () => {
    try {
      // Recalculate cumulative analysis for all suppliers
      const analysisMap = {}
      for (const supplier of suppliers) {
        const { data: chatsData } = await supabase
          .from('chats')
          .select('*')
          .eq('supplier_id', supplier.id)

        if (chatsData && chatsData.length > 0) {
          // Split real chats from override entry
          const realChats = chatsData.filter(c => c.raw_payload !== '__MANUAL_OVERRIDE__')
          const overrideEntry = chatsData.find(c => c.raw_payload === '__MANUAL_OVERRIDE__')
          const savedOverrides = overrideEntry?.ai_analysis?.overrides || {}

          // Base analysis from real chats, or all-missing if no chats
          let cumulativeReqs = realChats.length > 0
            ? calculateCumulativeAnalysis(realChats, requirements)
            : requirements.map(r => ({ id: r.id, label: r.label, status: 'missing', evidence: '' }))

          // Apply saved manual overrides
          if (Object.keys(savedOverrides).length > 0) {
            cumulativeReqs = cumulativeReqs.map(req =>
              savedOverrides[req.label] ? { ...req, status: savedOverrides[req.label] } : req
            )
          }

          if (realChats.length > 0 || Object.keys(savedOverrides).length > 0) {
            analysisMap[supplier.id] = cumulativeReqs
          }
        }
      }
      setSupplierCumulativeAnalysis(analysisMap)
    } catch (error) {
      console.error('Error refreshing supplier analysis:', error)
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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <Loader className="animate-spin text-indigo-600" size={40} />
      </div>
    )
  }

  if (!project) {
    return <div>Project not found</div>
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <Link href="/">
            <a className="text-indigo-600 hover:text-indigo-700 flex items-center gap-2">
              <ArrowLeft size={20} /> Back
            </a>
          </Link>
          <h1 className="text-4xl font-bold text-gray-900">{project.name}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Add Supplier & Requirements */}
          <div className="lg:col-span-1 space-y-6">
            {/* Add Supplier */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Add Supplier</h2>
              <form onSubmit={handleAddSupplier} className="space-y-3">
                <input
                  type="text"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  placeholder="Supplier nickname"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <input
                  type="url"
                  value={newSupplierUrl}
                  onChange={(e) => setNewSupplierUrl(e.target.value)}
                  placeholder="1688.com URL"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {saving ? <Loader className="animate-spin" size={16} /> : <Plus size={16} />}
                  Add Supplier
                </button>
              </form>
            </div>

            {/* Add Requirement */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Master Requirements</h2>
              <form onSubmit={handleAddRequirement} className="space-y-3">
                <input
                  type="text"
                  value={newRequirement}
                  onChange={(e) => setNewRequirement(e.target.value)}
                  placeholder="e.g., 304 Steel, Logo Engraving"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {saving ? <Loader className="animate-spin" size={16} /> : <Plus size={16} />}
                  Add Requirement
                </button>
              </form>

              {/* Requirements List */}
              <div className="mt-4 space-y-2">
                {requirements.map((req) => (
                  <div key={req.id} className="p-2 bg-gray-100 rounded text-sm text-gray-700 flex items-center justify-between group hover:bg-gray-200">
                    <span>{req.label}</span>
                    <button
                      onClick={() => handleDeleteRequirement(req.id)}
                      className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition"
                      title="Delete requirement"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
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
