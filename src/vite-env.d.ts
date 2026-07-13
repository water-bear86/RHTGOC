/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_ROOM_SERVER_URL?: string
  readonly VITE_REOWN_PROJECT_ID?: string
  readonly VITE_ROBINHOOD_CHAIN?: "mainnet" | "testnet"
  readonly VITE_BUILD_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
