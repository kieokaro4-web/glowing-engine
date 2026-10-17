import { Account, Channel, Client, ID, Permission, Query, Realtime, Role, TablesDB } from 'appwrite'

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID

if (!endpoint || !projectId) {
  throw new Error('Appwrite is not configured. Start the local stack and set the VITE_APPWRITE_* values in .env.local.')
}

export const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)

export const databases = new TablesDB(client)
export const account = new Account(client)
export const realtime = new Realtime(client)

export const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID
export const TABLE_ID = import.meta.env.VITE_APPWRITE_TABLE_ID

export { ID, Permission, Query, Role, Channel }

export type Todo = {
  $id: string
  title: string
  completed: boolean
  $createdAt: string
}
