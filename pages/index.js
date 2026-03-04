import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Loader } from 'lucide-react'
import Link from 'next/link'

export default function Home() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [projectName, setProjectName] = useState('')
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

  const handleCreateProject = async (e) => {
    e.preventDefault()
    if (!projectName.trim()) return

    setLoading(true)
    try {
      const { data } = await supabase
        .from('projects')
        .insert([{ user_id: userId, name: projectName }])
        .select()

      setProjects([...projects, data[0]])
      setProjectName('')
    } catch (error) {
      console.error('Error creating project:', error)
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
          <form onSubmit={handleCreateProject} className="flex gap-3">
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g., Black Jiggler with logo"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-semibold flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader className="animate-spin" size={20} /> : <Plus size={20} />}
              Create
            </button>
          </form>
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
