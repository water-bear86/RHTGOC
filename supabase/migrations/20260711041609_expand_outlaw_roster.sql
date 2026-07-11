alter table public.leaderboard_entries
  drop constraint if exists leaderboard_entries_character_id_check;

alter table public.leaderboard_entries
  add constraint leaderboard_entries_character_id_check
  check (character_id in ('robin', 'marian', 'little-john', 'much'));
