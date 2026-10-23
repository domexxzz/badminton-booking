// The same answers, checked on both sides.
//
// The room shows what a game is worth before it is played (src/lib/party.ts), and the
// database writes what it is actually worth (party_elo_delta, migration 0029). Two
// implementations of one formula drift, and the one the player sees would be the one
// that lies. test/party.test.ts checks the TypeScript against this table and
// scripts/sandbox.mjs checks the SQL against it, so neither can move alone.
//
// [winner rating, loser rating, points the winner takes]
export const ELO_GRID = [
  [1000, 1000, 12],
  [1000, 1400, 22],
  [1400, 1000, 2],
  [1200, 1000, 6],
  [1000, 1200, 18],
  [1000, 1050, 14],
  [3000, 100, 1],
];
