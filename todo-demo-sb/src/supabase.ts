import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase is not configured. Start the local stack and set the VITE_SUPABASE_* values.')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

export type Todo = {
  id: number
  title: string
  completed: boolean
  created_at: string
}