/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NHOST_PROXY_BASE: string
  readonly VITE_NHOST_GRAPHQL_WS_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}