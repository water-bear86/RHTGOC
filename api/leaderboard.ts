import type { VercelRequest, VercelResponse } from "@vercel/node"
import postgres from "postgres"

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL
const sql = connectionString ? postgres(connectionString, { max: 1, idle_timeout: 10 }) : null

async function ensureSchema(): Promise<void> {
  if (!sql) throw new Error("Leaderboard database is not configured")
  await sql`
    create table if not exists leaderboard_entries (
      id uuid primary key,
      player_name varchar(20) not null,
      character_id varchar(16) not null check (character_id in ('robin', 'marian')),
      score integer not null check (score >= 0),
      grade char(1) not null check (grade in ('S', 'A', 'B', 'C', 'D')),
      mission_seconds integer not null check (mission_seconds > 0),
      delivered integer not null check (delivered >= 0),
      verified boolean not null default false,
      created_at timestamptz not null default now()
    )
  `
  await sql`create index if not exists leaderboard_score_idx on leaderboard_entries (verified desc, score desc, created_at asc)`
}

function setHeaders(response: VercelResponse): void {
  response.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=60")
  response.setHeader("Content-Type", "application/json; charset=utf-8")
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  setHeaders(response)
  if (!sql) {
    response.status(503).json({ error: "Leaderboard database is not configured" })
    return
  }

  try {
    await ensureSchema()
    if (request.method === "GET") {
      const rows = await sql`
        select id, player_name, character_id, score, grade, mission_seconds, delivered, verified, created_at
        from leaderboard_entries
        order by verified desc, score desc, created_at asc
        limit 50
      `
      response.status(200).json({
        entries: rows.map((row) => ({
          id: row.id,
          playerName: row.player_name,
          characterId: row.character_id,
          score: row.score,
          grade: row.grade,
          missionSeconds: row.mission_seconds,
          delivered: row.delivered,
          verified: row.verified,
          createdAt: row.created_at,
        })),
      })
      return
    }

    if (request.method === "POST") {
      const body = request.body as Record<string, unknown>
      const playerName = String(body.playerName ?? "").replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 20)
      const characterId = body.characterId === "marian" ? "marian" : "robin"
      const score = Math.max(0, Math.min(100000, Number(body.score) || 0))
      const grade = ["S", "A", "B", "C", "D"].includes(String(body.grade)) ? String(body.grade) : "D"
      const missionSeconds = Math.max(1, Math.min(86400, Math.round(Number(body.missionSeconds) || 0)))
      const delivered = Math.max(0, Math.min(1000000, Math.round(Number(body.delivered) || 0)))
      if (!playerName) {
        response.status(400).json({ error: "A display name is required" })
        return
      }
      const id = crypto.randomUUID()
      const [entry] = await sql`
        insert into leaderboard_entries (id, player_name, character_id, score, grade, mission_seconds, delivered, verified)
        values (${id}, ${playerName}, ${characterId}, ${score}, ${grade}, ${missionSeconds}, ${delivered}, false)
        returning id, player_name, character_id, score, grade, mission_seconds, delivered, verified, created_at
      `
      response.status(201).json({
        id: entry.id,
        playerName: entry.player_name,
        characterId: entry.character_id,
        score: entry.score,
        grade: entry.grade,
        missionSeconds: entry.mission_seconds,
        delivered: entry.delivered,
        verified: entry.verified,
        createdAt: entry.created_at,
      })
      return
    }

    response.setHeader("Allow", "GET, POST")
    response.status(405).json({ error: "Method not allowed" })
  } catch (error) {
    console.error("leaderboard request failed", error)
    response.status(500).json({ error: "Leaderboard temporarily unavailable" })
  }
}
