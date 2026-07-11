import type { Session } from "@supabase/supabase-js"
import { getSupabase } from "./supabase"
import type { CharacterId } from "../shared/protocol"

export interface SocialProfile {
  user_id: string
  display_name: string
  friend_code: string
  presence_enabled: boolean
  presence_status: "offline" | "available" | "in-band"
  active_room_code: string | null
  last_seen_at: string
}

export interface SocialFriend {
  profile: SocialProfile
  requestedByMe: boolean
  accepted: boolean
}

export interface DirectInvite {
  id: string
  sender_id: string
  recipient_id: string
  room_code: string
  character_hint: CharacterId | null
  expires_at: string
  status: string
}

export interface SocialState {
  session: Session | null
  profile: SocialProfile | null
  friends: SocialFriend[]
  incomingRequests: SocialFriend[]
  invites: DirectInvite[]
  recentPlayers: SocialProfile[]
}

function client(): any {
  const value = getSupabase()
  if (!value) throw new Error("Social service is not configured")
  return value
}

export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await client().auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}${location.pathname}` } })
  if (error) throw error
}

export async function signOutSocial(): Promise<void> {
  const { error } = await client().auth.signOut()
  if (error) throw error
}

export async function registerSocialProfile(displayName: string): Promise<SocialProfile> {
  const { data, error } = await client().rpc("register_social_profile", { p_display_name: displayName })
  if (error) throw error
  return data as SocialProfile
}

export async function loadSocialState(): Promise<SocialState> {
  const db = client()
  const { data: { session } } = await db.auth.getSession()
  if (!session) return { session: null, profile: null, friends: [], incomingRequests: [], invites: [], recentPlayers: [] }
  const userId = session.user.id
  const [{ data: own }, { data: relationships, error: relationshipError }, { data: invites, error: inviteError }, { data: recent, error: recentError }] = await Promise.all([
    db.from("player_social_profiles").select("*").eq("user_id", userId).maybeSingle(),
    db.from("player_friendships").select("*").or(`user_low.eq.${userId},user_high.eq.${userId}`),
    db.from("direct_band_invites").select("*").eq("recipient_id", userId).eq("status", "pending").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(10),
    db.from("recent_band_players").select("other_id,last_played_at").eq("owner_id",userId).order("last_played_at",{ascending:false}).limit(8),
  ])
  if (relationshipError) throw relationshipError
  if (inviteError) throw inviteError
  if (recentError) throw recentError
  const rows = (relationships ?? []) as Array<{ user_low: string; user_high: string; requested_by: string; status: string }>
  const recentIds = ((recent ?? []) as Array<{other_id:string}>).map((row) => row.other_id)
  const otherIds = [...new Set([...rows.map((row) => row.user_low === userId ? row.user_high : row.user_low), ...recentIds])]
  const { data: profiles, error: profileError } = otherIds.length > 0
    ? await db.from("player_social_profiles").select("*").in("user_id", otherIds)
    : { data: [], error: null }
  if (profileError) throw profileError
  const profileById = new Map<string, SocialProfile>(((profiles ?? []) as SocialProfile[]).map((profile) => [profile.user_id, profile]))
  const mapped = rows.flatMap((row) => {
    const otherId = row.user_low === userId ? row.user_high : row.user_low
    const profile = profileById.get(otherId)
    return profile ? [{ profile, requestedByMe: row.requested_by === userId, accepted: row.status === "accepted" }] : []
  })
  return {
    session,
    profile: own as SocialProfile | null,
    friends: mapped.filter((friend) => friend.accepted),
    incomingRequests: mapped.filter((friend) => !friend.accepted && !friend.requestedByMe),
    invites: (invites ?? []) as DirectInvite[],
    recentPlayers: recentIds.flatMap((id) => profileById.get(id) ? [profileById.get(id)!] : []),
  }
}

async function rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client().rpc(name, params)
  if (error) throw error
  return data
}

export const sendFriendRequest = (friendCode: string): Promise<unknown> => rpc("send_friend_request", { p_friend_code: friendCode.trim().toUpperCase() })
export const respondFriendRequest = (userId: string, accept: boolean): Promise<unknown> => rpc("respond_friend_request", { p_other_user_id: userId, p_accept: accept })
export const removeFriend = (userId: string): Promise<unknown> => rpc("remove_friend", { p_other_user_id: userId })
export const blockSocialPlayer = (userId: string): Promise<unknown> => rpc("block_player", { p_other_user_id: userId })
export const updateSocialPresence = (enabled: boolean, status: "offline" | "available" | "in-band", roomCode: string | null): Promise<unknown> => rpc("update_social_presence", { p_enabled: enabled, p_status: status, p_room_code: roomCode })
export const sendDirectInvite = (userId: string, roomCode: string, characterHint: CharacterId): Promise<unknown> => rpc("send_direct_band_invite", { p_recipient_id: userId, p_room_code: roomCode, p_character_hint: characterHint })
export const respondDirectInvite = (inviteId: string, accept: boolean): Promise<string | null> => rpc("respond_direct_band_invite", { p_invite_id: inviteId, p_accept: accept }) as Promise<string | null>
