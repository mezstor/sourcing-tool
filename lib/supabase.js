import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables!', {
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseAnonKey
  })
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Helper functions
export async function createProject(userId, projectName) {
  const { data, error } = await supabase
    .from('projects')
    .insert([{ user_id: userId, name: projectName }])
    .select()
  
  if (error) throw error
  return data[0]
}

export async function getProjects(userId) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', userId)
  
  if (error) throw error
  return data
}

export async function getProject(projectId) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()
  
  if (error) throw error
  return data
}

export async function createMasterRequirement(projectId, label, isCritical = false) {
  const { data, error } = await supabase
    .from('master_requirements')
    .insert([{ 
      project_id: projectId, 
      label, 
      status: 'pending',
      is_critical: isCritical 
    }])
    .select()
  
  if (error) throw error
  return data[0]
}

export async function getMasterRequirements(projectId) {
  const { data, error } = await supabase
    .from('master_requirements')
    .select('*')
    .eq('project_id', projectId)
  
  if (error) throw error
  return data
}

export async function createSupplier(projectId, nickname, url) {
  const { data, error } = await supabase
    .from('suppliers')
    .insert([{ 
      project_id: projectId, 
      nickname, 
      url,
      total_score: 0 
    }])
    .select()
  
  if (error) throw error
  return data[0]
}

export async function getSuppliers(projectId) {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('project_id', projectId)
  
  if (error) throw error
  return data
}

export async function addChat(supplierId, rawPayload) {
  const { data, error } = await supabase
    .from('chats')
    .insert([{ supplier_id: supplierId, raw_payload: rawPayload }])
    .select()
  
  if (error) throw error
  return data[0]
}

export async function getChats(supplierId) {
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('supplier_id', supplierId)
  
  if (error) throw error
  return data
}
