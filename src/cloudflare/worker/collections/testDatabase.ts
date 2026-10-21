import { discoveryFixture as baseFixture } from '../runs/discoveryTestDatabase';
export function discoveryFixtureWithCollections() {
  const f = baseFixture();
  for (const [target, cell] of [['native', '8,0'], ['course:legacy', '10,0']]) f.sqlite.prepare(
    'INSERT INTO playable_content_index_members(target_key,room_id,room_version) VALUES (?,?,1)').run(`expanded_room:${target}`, cell);
  const wallet = '0x1111111111111111111111111111111111111111';
  f.sqlite.prepare("UPDATE users SET wallet_address=?,display_name='Collector One' WHERE id='p1'").run(wallet);
  f.sqlite.prepare("UPDATE users SET display_name='Original builder' WHERE id='builder'").run();
  f.sqlite.prepare("UPDATE playable_content_index SET builder_display_name='Original builder' WHERE builder_user_id='builder'").run();
  for (const id of ['1,0','8,0','9,0','10,0']) f.sqlite.prepare(`UPDATE rooms SET minted_chain_id=8453,
    minted_contract_address=?,minted_token_id='42',minted_owner_wallet_address=?,minted_owner_synced_at='2026-10-21T00:00:00.000Z' WHERE id=?`).run(wallet,wallet,id);
  return f;
}
export { discoveryFixtureWithCollections as discoveryFixture };
