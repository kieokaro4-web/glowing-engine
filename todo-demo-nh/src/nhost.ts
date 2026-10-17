import { createClient } from '@nhost/nhost-js'

const base = import.meta.env.VITE_NHOST_PROXY_BASE

export const nhost = createClient({
  authUrl: `${base}/auth/v1`,
  graphqlUrl: `${base}/graphql/v1`,
  storageUrl: `${base}/storage/v1`,
  functionsUrl: `${base}/functions/v1`,
})

export type Todo = {
  id: number
  title: string
  completed: boolean
  created_at: string
}