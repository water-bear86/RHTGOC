import { createClient } from "@supabase/supabase-js"
import type { CharacterId, MerryBandState, MissionResult, VillageState, VoteChoice } from "../shared/protocol"

interface RpcResult {
  data: unknown
  error: { message: string } | null
}

export interface RpcClient {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<RpcResult>
}

export interface CompletedBandMission {
  bandId: string
  actorUserId: string | null
  missionId: string
  missionSlug: string
  seed: number
  status: "succeeded" | "failed"
  result: MissionResult | null
  allocationChoice: VoteChoice | null
  allocationCoin: number
}

export interface PersistentBandRecord {
  state: MerryBandState
  village: VillageState
  actorUserId: string
  members: Array<{ userId: string; membershipRole: "leader" | "member"; heroRole: CharacterId | null }>
}

export interface BandMissionWriteResult {
  recorded: boolean
  progressed: boolean
  band: PersistentBandRecord
}

function recordFromRpc(value: unknown): PersistentBandRecord {
  if (!value || typeof value !== "object") throw new Error("BAND_STATE_FAILED: missing band state")
  const data = value as Record<string, unknown>
  const camp = data.camp as Record<string, unknown> | undefined
  const village = data.village as Record<string, unknown> | undefined
  const members = Array.isArray(data.members) ? data.members : []
  if (typeof data.id !== "string" || typeof data.name !== "string" || typeof data.bannerId !== "string" || typeof data.actorUserId !== "string" || !camp || !village) throw new Error("BAND_STATE_FAILED: invalid band state")
  if (!(["oak", "fox", "arrow", "stag"] as const).includes(data.bannerId as "oak" | "fox" | "arrow" | "stag")) throw new Error("BAND_STATE_FAILED: invalid banner")
  return {
    state: {
      id: data.id,
      name: data.name,
      bannerId: data.bannerId as MerryBandState["bannerId"],
      camp: {
        hearth: Number(camp.hearth ?? 0),
        workbench: Number(camp.workbench ?? 0),
        stores: Number(camp.stores ?? 0),
      },
      progressionVersion: Number(data.progressionVersion ?? 1),
      missionCount: Number(data.missionCount ?? 0),
      memberCount: Number(data.memberCount ?? members.length),
    },
    village: {
      granary: Number(village.granary ?? 0),
      infirmary: Number(village.infirmary ?? 0),
      watchtower: Number(village.watchtower ?? 0),
    },
    actorUserId: data.actorUserId,
    members: members.flatMap((member) => {
      if (!member || typeof member !== "object") return []
      const value = member as Record<string, unknown>
      if (typeof value.userId !== "string" || (value.membershipRole !== "leader" && value.membershipRole !== "member")) return []
      const heroRole = typeof value.heroRole === "string" && (["robin", "marian", "little-john", "much"] as const).includes(value.heroRole as CharacterId) ? value.heroRole as CharacterId : null
      return [{ userId: value.userId, membershipRole: value.membershipRole, heroRole }]
    }),
  }
}

export class SupabaseBandStore {
  constructor(private readonly client: RpcClient) {}

  async createBand(name: string, bannerId: "oak" | "fox" | "arrow" | "stag", creatorUserId: string): Promise<string> {
    const { data, error } = await this.client.rpc("create_merry_band", {
      p_name: name,
      p_banner_id: bannerId,
      p_creator_user_id: creatorUserId,
    })
    if (error) throw new Error(`BAND_CREATE_FAILED: ${error.message}`)
    if (typeof data !== "string") throw new Error("BAND_CREATE_FAILED: missing band id")
    return data
  }

  async ensureBand(creatorUserId: string, displayName: string, heroRole: CharacterId): Promise<PersistentBandRecord> {
    const { data, error } = await this.client.rpc("ensure_merry_band", {
      p_creator_user_id: creatorUserId,
      p_display_name: displayName,
      p_hero_role: heroRole,
    })
    if (error) throw new Error(`BAND_ENSURE_FAILED: ${error.message}`)
    return { ...recordFromRpc(data), actorUserId: creatorUserId }
  }

  async loadBand(bandId: string): Promise<PersistentBandRecord> {
    const { data, error } = await this.client.rpc("get_merry_band_state", { p_band_id: bandId })
    if (error) throw new Error(`BAND_LOAD_FAILED: ${error.message}`)
    return recordFromRpc(data)
  }

  async addMember(bandId: string, actorUserId: string, memberUserId: string, heroRole: CharacterId): Promise<PersistentBandRecord> {
    const { data, error } = await this.client.rpc("add_merry_band_member", { p_band_id: bandId, p_actor_user_id: actorUserId, p_member_user_id: memberUserId, p_hero_role: heroRole })
    if (error) throw new Error(`BAND_MEMBER_ADD_FAILED: ${error.message}`)
    return { ...recordFromRpc(data), actorUserId }
  }

  async removeMember(bandId: string, actorUserId: string, memberUserId: string): Promise<PersistentBandRecord> {
    const { data, error } = await this.client.rpc("remove_merry_band_member", { p_band_id: bandId, p_actor_user_id: actorUserId, p_member_user_id: memberUserId })
    if (error) throw new Error(`BAND_MEMBER_REMOVE_FAILED: ${error.message}`)
    return { ...recordFromRpc(data), actorUserId }
  }

  async updateIdentity(bandId: string, actorUserId: string, name: string, bannerId: MerryBandState["bannerId"]): Promise<PersistentBandRecord> {
    const { data, error } = await this.client.rpc("update_merry_band_identity", { p_band_id: bandId, p_actor_user_id: actorUserId, p_name: name, p_banner_id: bannerId })
    if (error) throw new Error(`BAND_IDENTITY_UPDATE_FAILED: ${error.message}`)
    return { ...recordFromRpc(data), actorUserId }
  }

  async setHeroRole(bandId: string, userId: string, heroRole: CharacterId): Promise<PersistentBandRecord> {
    const { data, error } = await this.client.rpc("set_merry_band_hero_role", { p_band_id: bandId, p_user_id: userId, p_hero_role: heroRole })
    if (error) throw new Error(`BAND_ROLE_UPDATE_FAILED: ${error.message}`)
    return recordFromRpc(data)
  }

  async recordMission(input: CompletedBandMission): Promise<BandMissionWriteResult> {
    const { data, error } = await this.client.rpc("record_band_mission_outcome", {
      p_band_id: input.bandId,
      p_actor_user_id: input.actorUserId,
      p_mission_id: input.missionId,
      p_mission_slug: input.missionSlug,
      p_seed: input.seed,
      p_status: input.status,
      p_result: input.result,
      p_allocation_choice: input.allocationChoice,
      p_allocation_coin: input.allocationCoin,
    })
    if (error) throw new Error(`BAND_REWARD_FAILED: ${error.message}`)
    if (!data || typeof data !== "object") throw new Error("BAND_REWARD_FAILED: missing result")
    const value = data as Record<string, unknown>
    return { recorded: value.recorded === true, progressed: value.progressed === true, band: recordFromRpc(value.band) }
  }
}

export function createBandStoreFromEnv(): SupabaseBandStore | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return new SupabaseBandStore(client as unknown as RpcClient)
}
