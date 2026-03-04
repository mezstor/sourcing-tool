import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Loader, Zap } from 'lucide-react'
import Link from 'next/link'

export default function Home() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [specifications, setSpecifications] = useState('')
  const [userId] = useState('demo-user') // In production, use auth

  useEffect(() => {
    fetchProjects()
  }, [])

  const fetchProjects = async () => {
    try {
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', userId)
      
      setProjects(data || [])
    } catch (error) {
      console.error('Error fetching projects:', error)
    }
  }

  const handleCreateProject = async (useAI = false) => {
    if (!projectName.trim()) return

    setLoading(true)
    try {
      // Parse specifications from comma-separated input
      let specsList = specifications
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)

      // If using AI, generate specifications using OpenAI
      if (useAI && specsList.length === 0) {
        try {
          const response = await fetch('/api/generate-specs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectName })
          })
          const { specifications: aiSpecs } = await response.json()
          specsList = aiSpecs
        } catch (error) {
          console.error('Error generating specs with AI:', error)
          // Fallback: continue without specs
        }
      }

      // Create the project first
      const { data: projectData } = await supabase
        .from('projects')
        .insert([{
          user_id: userId,
          name: projectName
        }])
        .select()

      const newProject = projectData[0]

      // Create master requirements from specifications
      if (specsList.length > 0) {
        const masterRequirements = specsList.map((spec) => ({
          project_id: newProject.id,
          label: spec,
          status: 'missing'
        }))

        await supabase
          .from('master_requirements')
          .insert(masterRequirements)
      }

      setProjects([...projects, newProject])
      setProjectName('')
      setSpecifications('')
    } catch (error) {
      console.error('Error creating project:', error)
      alert('Error creating project: ' + error.message)
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
            <div className="grid gap-4">
              {projects.map((project) => (
                <Link key={project.id} href={`/project/${project.id}`}>
                  <a className="block bg-white rounded-lg shadow hover:shadow-lg transition p-6 cursor-pointer">
                    <h3 className="text-xl font-semibold text-gray-900">{project.name}</h3>
                    <p className="text-sm text-gray-500 mt-2">
                      Created: {new Date(project.created_at).toLocaleDateString()}
                    </p>
                  </a>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
