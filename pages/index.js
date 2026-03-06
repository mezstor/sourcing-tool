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
    if (!confirm('Weet je zeker? Dit delete project + alle suppliers + chats.')) return

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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-2">
            Sourcing Intelligence War Room
          </h1>
          <p className="text-xl text-gray-600">
            Manage your 1688.com suppliers with AI-powered auditing
          </p>
        </div>

        {/* Create Project Form */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Create New Project</h2>
          <div className="space-y-4">
            {/* Project Name Input */}
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g., Black Jiggler with logo"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {/* MOQ Input - MANDATORY */}
            <input
              type="number"
              value={moq}
              onChange={(e) => setMoq(e.target.value)}
              placeholder="Minimum Order Quantity (e.g., 250)"
              min="1"
              className="w-full px-4 py-3 border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 font-semibold"
            />
            <p className="text-sm text-red-600 -mt-3">⚠️ Verplicht - AI moet MOQ kennen voor correcte vragen</p>

            {/* Specifications Input */}
            <textarea
              value={specifications}
              onChange={(e) => setSpecifications(e.target.value)}
              placeholder="Specifications (comma-separated). e.g., Material: stainless steel, Color: black, Size: 10cm"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 h-24 resize-none"
            />

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => handleCreateProject(false)}
                disabled={loading || !projectName.trim()}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader className="animate-spin" size={20} /> : <Plus size={20} />}
                Create
              </button>
              <button
                onClick={() => handleCreateProject(true)}
                disabled={loading || !projectName.trim()}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader className="animate-spin" size={20} /> : <Zap size={20} />}
                Create with AI
              </button>
            </div>
          </div>
        </div>

        {/* Projects List */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Your Projects</h2>
          {projects.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <p className="text-gray-600">No projects yet. Create one to get started!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project) => (
                <div key={project.id} className="relative group bg-white rounded-lg shadow hover:shadow-lg transition overflow-hidden">
                  <Link href={`/project/${project.id}`}>
                    <a className="block p-6 cursor-pointer">
                      <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
                      <p className="text-sm text-gray-500 mt-2">
                        Created: {new Date(project.created_at).toLocaleDateString()}
                      </p>
                    </a>
                  </Link>
                  <button
                    onClick={() => handleDeleteProject(project.id)}
                    className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition"
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
