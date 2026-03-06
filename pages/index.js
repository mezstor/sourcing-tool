import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Loader, Zap, Trash2 } from 'lucide-react'
import Link from 'next/link'

export default function Home() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [moq, setMoq] = useState('')
  const [specifications, setSpecifications] = useState('')
  const [userId] = useState('demo-user') // In production, use auth

  useEffect(() => {
    fetchProjects()
  }, [])

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setProjects(data || [])
    } catch (error) {
      console.error('Error fetching projects:', error)
      setProjects([])
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteProject = async (projectId) => {
    if (!confirm('Are you sure? This will delete the project + all suppliers + chats.')) return

    try {
      // Delete all suppliers + their chats
      const { data: suppliers } = await supabase
        .from('suppliers')
        .select('id')
        .eq('project_id', projectId)

      if (suppliers && suppliers.length > 0) {
        for (const supplier of suppliers) {
          await supabase.from('chats').delete().eq('supplier_id', supplier.id)
        }
        await supabase.from('suppliers').delete().eq('project_id', projectId)
      }

      // Delete all master requirements
      await supabase.from('master_requirements').delete().eq('project_id', projectId)

      // Delete project
      await supabase.from('projects').delete().eq('id', projectId)

      setProjects(projects.filter(p => p.id !== projectId))
    } catch (error) {
      console.error('Error deleting project:', error)
      alert('Error deleting project')
    }
  }

  const handleCreateProject = async (useAI = false) => {
    if (!projectName.trim() || !moq.trim()) {
      alert('Project name and MOQ are required!')
      return
    }

    // Clear inputs immediately for faster UX feedback
    const projectNameCopy = projectName
    const moqCopy = moq
    const specificationsCopy = specifications
    setProjectName('')
    setMoq('')
    setSpecifications('')

    setLoading(true)
    try {
      // Parse specifications from comma-separated input
      let specsList = (specificationsCopy || '')
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)

      // If using AI, generate and combine specifications (parallel with project creation)
      let aiSpecsPromise = Promise.resolve([])
      if (useAI) {
        aiSpecsPromise = fetch('/api/generate-specs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectName: projectNameCopy })
        })
          .then(response => response.json())
          .then(({ specifications: aiSpecs }) => aiSpecs || [])
          .catch(error => {
            console.error('Error generating specs with AI:', error)
            return []
          })
      }

      // Parse MOQ safely
      const moqValue = parseInt(moqCopy, 10)
      if (isNaN(moqValue) || moqValue <= 0) {
        throw new Error('MOQ must be a positive number')
      }

      // Create the project
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .insert([{
          user_id: userId,
          name: projectNameCopy,
          moq: moqValue
        }])
        .select()

      if (projectError) throw projectError
      if (!projectData || !projectData[0]) throw new Error('Failed to create project')

      const newProject = projectData[0]

      // Get AI specs if any
      const aiSpecs = await aiSpecsPromise
      specsList = [...specsList, ...aiSpecs]

      // Prepare master requirements - ALWAYS include these base requirements
      const masterRequirements = [
        {
          project_id: newProject.id,
          label: 'Images/Product Photos',
          status: 'missing'
        },
        {
          project_id: newProject.id,
          label: `MOQ: ${moqCopy} units`,
          status: 'pending'
        },
        {
          project_id: newProject.id,
          label: 'Prototype/Sample capability (1-2 units)',
          status: 'missing'
        },
        {
          project_id: newProject.id,
          label: 'Prototype/Sample price & lead time',
          status: 'missing'
        },
        ...specsList.map((spec) => ({
          project_id: newProject.id,
          label: spec,
          status: 'missing'
        }))
      ]

      // Update UI immediately with new project
      setProjects([newProject, ...projects])

      // Insert requirements in background (non-blocking)
      if (masterRequirements.length > 0) {
        // Fire and forget - don't wait for this
        supabase
          .from('master_requirements')
          .insert(masterRequirements)
          .then(() => {
            console.log('Requirements inserted successfully')
          })
          .catch(error => {
            console.error('Error inserting requirements:', error)
          })
      }
    } catch (error) {
      console.error('Error creating project:', error)
      alert('Error creating project: ' + error.message)
      // Restore inputs on error
      setProjectName(projectNameCopy)
      setMoq(moqCopy)
      setSpecifications(specificationsCopy)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-16 animate-fade-in">
          <div className="mb-4">
            <div className="inline-block px-4 py-2 rounded-full bg-blue-100 text-blue-700 text-sm font-semibold mb-4">
              ✨ Sourcing Intelligence Platform
            </div>
          </div>
          <h1 className="text-6xl md:text-7xl font-bold text-slate-900 mb-3 leading-tight">
            Supplier Management
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-600">
              Reimagined
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-600 max-w-2xl leading-relaxed">
            AI-powered supplier auditing and management for 1688.com with intelligent requirements tracking
          </p>
        </div>

        {/* Create Project Form */}
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-card p-8 mb-16 border border-white/20 animate-slide-up">
          <div className="mb-6">
            <h2 className="text-3xl font-bold text-slate-900">Create New Project</h2>
            <p className="text-slate-600 mt-2">Set up a new supplier management project with AI-powered insights</p>
          </div>
          <div className="space-y-5">
            {/* Project Name Input */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g., Black Jiggler with logo"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50/50 hover:bg-slate-50 transition-colors"
              />
            </div>

            {/* MOQ Input - MANDATORY */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="block text-sm font-semibold text-slate-700">Minimum Order Quantity</label>
                <span className="px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold">Required</span>
              </div>
              <input
                type="number"
                value={moq}
                onChange={(e) => setMoq(e.target.value)}
                placeholder="e.g., 250"
                min="1"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50/50 hover:bg-slate-50 transition-colors"
              />
              <p className="text-xs text-slate-600 mt-2">⚠️ AI needs this to generate accurate follow-up questions</p>
            </div>

            {/* Specifications Input */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Specifications</label>
              <textarea
                value={specifications}
                onChange={(e) => setSpecifications(e.target.value)}
                placeholder="e.g., Material: stainless steel, Color: black, Size: 10cm"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50/50 hover:bg-slate-50 transition-colors h-20 resize-none"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => handleCreateProject(false)}
                disabled={loading || !projectName.trim()}
                className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-soft hover:shadow-card"
              >
                {loading ? <Loader className="animate-spin" size={20} /> : <Plus size={20} />}
                Create
              </button>
              <button
                onClick={() => handleCreateProject(true)}
                disabled={loading || !projectName.trim()}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white px-6 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-soft hover:shadow-card"
              >
                {loading ? <Loader className="animate-spin" size={20} /> : <Zap size={20} />}
                Create with AI
              </button>
            </div>
          </div>
        </div>

        {/* Projects List */}
        <div className="animate-fade-in">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-slate-900">Your Projects</h2>
            <p className="text-slate-600 mt-2">Manage your active sourcing projects</p>
          </div>
          {projects.length === 0 ? (
            <div className="bg-white/50 backdrop-blur-xl rounded-2xl border border-white/20 p-12 text-center">
              <div className="mb-4 text-4xl">📦</div>
              <p className="text-slate-600 text-lg">No projects yet. Create one above to get started!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project) => (
                <div key={project.id} className="relative group">
                  <Link href={`/project/${project.id}`}>
                    <a className="block bg-white/70 backdrop-blur-xl rounded-xl shadow-soft hover:shadow-hover border border-white/20 hover:border-white/40 p-6 cursor-pointer transition-all">
                      <h3 className="text-xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{project.name}</h3>
                      <p className="text-sm text-slate-600 mt-3">
                        📅 {new Date(project.created_at).toLocaleDateString()}
                      </p>
                      <div className="mt-4 pt-4 border-t border-slate-200/50 flex items-center gap-2 text-blue-600 group-hover:gap-3 transition-all">
                        <span className="text-sm font-semibold">View Project</span>
                        <span>→</span>
                      </div>
                    </a>
                  </Link>
                  <button
                    onClick={() => handleDeleteProject(project.id)}
                    className="absolute top-3 right-3 bg-red-500/20 hover:bg-red-500 text-red-600 hover:text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all backdrop-blur"
                    title="Delete project"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
