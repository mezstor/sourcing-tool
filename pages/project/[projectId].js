import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { Plus, ArrowLeft, Loader } from 'lucide-react'
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

  useEffect(() => {
    console.log('Project page - router query:', router.query)
    if (projectId) {
      console.log('Project ID available:', projectId)
      fetchProject()
    }
  }, [projectId])

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
    } catch (error) {
      console.error('Error fetching project:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddSupplier = async (e) => {
    e.preventDefault()
    if (!newSupplierName.trim() || !newSupplierUrl.trim()) return

    setSaving(true)
    try {
      const { data } = await supabase
        .from('suppliers')
        .insert([{
          project_id: projectId,
          nickname: newSupplierName,
          url: newSupplierUrl,
          total_score: 0
        }])
        .select()

      setSuppliers([...suppliers, data[0]])
      setNewSupplierName('')
      setNewSupplierUrl('')
    } catch (error) {
      console.error('Error adding supplier:', error)
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
                  <div key={req.id} className="p-2 bg-gray-100 rounded text-sm text-gray-700">
                    {req.label}
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
            />
          </div>
        </div>
      </div>
    </div>
  )
}
