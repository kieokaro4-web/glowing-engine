// Idempotent schema + permission bootstrap for the local Directus demo.
// Runs with `bun scripts/directus-bootstrap.ts` (the start script wires this in).
// The admin token is only used server-side by this script; the browser never sees it.

const directusUrl = process.env.DIRECTUS_URL ?? 'http://127.0.0.1:8055'
const adminToken = process.env.DIRECTUS_ADMIN_TOKEN ?? 'local-demo-admin-token'
const adminEmail = process.env.DIRECTUS_ADMIN_EMAIL ?? 'admin@example.com'
const adminPassword = process.env.DIRECTUS_ADMIN_PASSWORD ?? 'admin-demo-password'

// Directus ships this built-in "Public" policy on every instance (no login
// required users). Look it up by icon/name and only fall back to the constant.
const PUBLIC_POLICY_FALLBACK_ID = 'abf8a154-5b1c-4a46-ac9c-7300570f4f17'

async function getAdminToken(): Promise<string> {
  const staticProbe = await fetch(`${directusUrl}/server/info`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  if (staticProbe.ok) return adminToken

  const login = await fetch(`${directusUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  })
  if (!login.ok) {
    throw new Error(`Admin auth failed: static token rejected and login returned ${login.status}`)
  }
  const payload = await login.json() as { data?: { access_token?: string } }
  if (!payload.data?.access_token) throw new Error('Login succeeded but returned no access_token')
  return payload.data.access_token
}

async function findPublicPolicyId(token: string): Promise<string> {
  const response = await fetch(`${directusUrl}/policies?fields=id,name,icon&limit=-1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`GET /policies returned ${response.status}`)
  const policies = await response.json() as { data: { id: string; name: string | null; icon: string | null }[] }
  const publicPolicy = policies.data.find((policy) => policy.icon === 'public')
    ?? policies.data.find((policy) => policy.name === '$t:public_label' || policy.name === 'Public')
  return publicPolicy?.id ?? PUBLIC_POLICY_FALLBACK_ID
}

const todosCollection = {
  collection: 'todos',
  meta: { icon: 'check_circle', note: 'Local todo demo items' },
  schema: {},
  fields: [
    {
      field: 'id',
      type: 'integer',
      schema: { is_primary_key: true, has_auto_increment: true },
      meta: { interface: 'primarykey', readonly: true },
    },
    {
      field: 'title',
      type: 'string',
      schema: { max_length: 255, is_nullable: false },
      meta: { interface: 'input', required: true },
    },
    {
      field: 'completed',
      type: 'boolean',
      schema: { default_value: false, is_nullable: false },
      meta: { interface: 'boolean', default_value: false },
    },
    {
      field: 'created_at',
      type: 'timestamp',
      schema: null,
      meta: { special: ['date-created'], interface: 'datetime', readonly: true },
    },
  ],
}

async function ensureCollection(token: string): Promise<string> {
  const existing = await fetch(`${directusUrl}/collections/todos`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (existing.ok) return 'already present'

  const created = await fetch(`${directusUrl}/collections`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(todosCollection),
  })
  if (!created.ok) {
    throw new Error(`POST /collections failed with ${created.status}: ${await created.text()}`)
  }
  return 'created'
}

async function ensurePermissions(token: string, policyId: string): Promise<string> {
  const response = await fetch(
    `${directusUrl}/permissions?filter[collection][_eq]=todos&filter[policy][_eq]=${policyId}&fields=action&limit=-1`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.ok) throw new Error(`GET /permissions returned ${response.status}`)
  const existing = await response.json() as { data: { action: string }[] }
  const have = new Set(existing.data.map((row) => row.action))
  const missing = (['create', 'read', 'update', 'delete'] as const).filter((action) => !have.has(action))
  if (missing.length === 0) return 'already present'

  const rows = missing.map((action) => ({
    policy: policyId,
    collection: 'todos',
    action,
    permissions: null,
    validation: null,
    presets: null,
    fields: ['*'],
  }))
  const created = await fetch(`${directusUrl}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(rows),
  })
  if (!created.ok) {
    throw new Error(`POST /permissions failed with ${created.status}: ${await created.text()}`)
  }
  return `granted ${missing.join(', ')}`
}

const token = await getAdminToken()
const policyId = await findPublicPolicyId(token)
const collectionResult = await ensureCollection(token)
const permissionsResult = await ensurePermissions(token, policyId)

console.log(`Directus bootstrap at ${directusUrl}:`)
console.log(`  collection todos: ${collectionResult}`)
console.log(`  public policy ${policyId}: ${permissionsResult}`)
