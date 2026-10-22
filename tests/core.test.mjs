import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zoneOf, newMatch, teamStats, score, scoreByHalf, insights, encodeMatch, decodeMatch, formatClock, clockSeconds,
} from '../core.js';

const shot = (team, player, x, y, result, kind = 'set', target = null, half = 1) => ({
  id: Math.random().toString(), type: 'shot', team, player, x, y, result, kind, target, half, t: 0, zone: zoneOf(x, y, kind),
});

test('zoneOf: 位置からエリアを判定する', () => {
  assert.equal(zoneOf(1, 1, 'set'), 'LW');
  assert.equal(zoneOf(19, 1, 'set'), 'RW');
  assert.equal(zoneOf(10, 7, 'set'), 'PV');
  assert.equal(zoneOf(10, 10, 'set'), 'CB');
  assert.equal(zoneOf(5, 10, 'set'), 'LB');
  assert.equal(zoneOf(15, 10, 'set'), 'RB');
  assert.equal(zoneOf(3, 5, '7m'), '7M');
});

test('score と scoreByHalf', () => {
  const ev = [shot('us', '7', 10, 10, 'goal'), shot('them', '3', 10, 10, 'goal', 'set', null, 2), shot('us', '7', 10, 10, 'save')];
  assert.deepEqual(score(ev), { us: 1, them: 1 });
  assert.deepEqual(scoreByHalf(ev), { 1: { us: 1, them: 0 }, 2: { us: 0, them: 1 } });
});

test('teamStats: シュート率・エリア・選手・GK', () => {
  const ev = [
    shot('us', '7', 10, 10, 'goal', 'set', 0),
    shot('us', '7', 10, 10, 'save', 'set', 4),
    shot('us', '9', 1, 1, 'miss'),
    shot('them', '3', 10, 10, 'goal', 'fast', 2),
    shot('them', '3', 10, 10, 'save', 'set', 2),
    shot('them', '5', 10, 10, 'miss'),
    { type: 'turnover', team: 'us', player: '9', half: 1, t: 0 },
    { type: 'suspension', team: 'us', player: '7', half: 1, t: 0 },
  ];
  const s = teamStats(ev, 'us');
  assert.equal(s.total.shots, 3);
  assert.equal(s.total.goals, 1);
  assert.equal(s.shotPct, 1 / 3);
  assert.equal(s.byZone.CB.shots, 2);
  assert.equal(s.byZone.LW.misses, 1);
  assert.equal(s.byTarget[0].goals, 1);
  assert.equal(s.turnovers, 1);
  assert.equal(s.suspensions, 1);
  const p7 = s.players.find((p) => p.num === '7');
  assert.deepEqual([p7.shots, p7.goals, p7.suspensions], [2, 1, 1]);
  // GKは枠内2本（得点1、セーブ1）
  assert.equal(s.gk.onTarget, 2);
  assert.equal(s.gk.savePct, 0.5);
  assert.equal(s.gkByTarget[2].shots, 2);
  assert.equal(s.fastBreakGoalsAgainst, 1);
});

test('insights: 弱点と強みを見つける', () => {
  const ev = [
    // 左45度: 1/5
    shot('us', '7', 5, 10, 'goal'), shot('us', '7', 5, 10, 'save'), shot('us', '7', 5, 10, 'save'),
    shot('us', '7', 5, 10, 'miss'), shot('us', '7', 5, 10, 'save'),
    // 右サイド: 4/4
    shot('us', '11', 19, 1, 'goal'), shot('us', '11', 19, 1, 'goal'), shot('us', '11', 19, 1, 'goal'), shot('us', '11', 19, 1, 'goal'),
    // 相手の速攻3得点
    shot('them', '3', 10, 10, 'goal', 'fast'), shot('them', '3', 10, 10, 'goal', 'fast'), shot('them', '3', 10, 10, 'goal', 'fast'),
  ];
  const { weak, strong } = insights(ev, 'us');
  assert.ok(weak.some((w) => w.includes('左45度')), weak.join('\n'));
  assert.ok(weak.some((w) => w.includes('速攻で3失点')), weak.join('\n'));
  assert.ok(weak.some((w) => w.includes('#7')), weak.join('\n'));
  assert.ok(strong.some((w) => w.includes('右サイド')), strong.join('\n'));
});

test('encodeMatch / decodeMatch で試合が復元できる', async () => {
  const m = newMatch({ opponent: '○○高校', ourRoster: [{ n: '7', name: '山田' }], theirRoster: [{ n: '3', name: '' }] });
  m.events = [
    shot('us', '7', 5.3, 10.2, 'goal', 'set', 3),
    shot('them', null, 10, 7, 'save', '7m'),
    { id: 'x', type: 'turnover', team: 'us', player: '7', half: 2, t: 1234 },
  ];
  const code = await encodeMatch(m);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const back = await decodeMatch(code);
  assert.equal(back.opponent, '○○高校');
  assert.deepEqual(back.roster.us, [{ n: '7', name: '山田' }]);
  assert.equal(back.events.length, 3);
  assert.deepEqual(
    back.events.map(({ id, ...rest }) => rest),
    m.events.map(({ id, ...rest }) => rest),
  );
});

test('時計の表示', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(1805), '30:05');
  assert.equal(clockSeconds({ elapsed: 10, runningSince: 1000 }, 6000), 15);
  assert.equal(clockSeconds({ elapsed: 10, runningSince: null }, 6000), 10);
});

import { keyPlayers, scoutingMatches, scoutingTeams } from '../core.js';

test('keyPlayers: 得点源とお気に入りのエリア・コース、7mの担当', () => {
  const ev = [
    shot('them', '8', 19, 1, 'goal', 'set', 2),
    shot('them', '8', 19, 1, 'goal', 'set', 2),
    shot('them', '8', 5, 10, 'save', 'set', 0),
    shot('them', '8', 10, 7, 'goal', '7m', 6),
    shot('them', '3', 10, 10, 'goal'),
    shot('them', '5', 10, 7, 'save', '7m'),
    shot('them', null, 10, 10, 'goal'),
    shot('us', '7', 10, 10, 'goal'),
  ];
  const { scorers, sevenTakers } = keyPlayers(ev, 'them');
  assert.deepEqual(scorers.map((p) => p.num), ['8', '3', '5']);
  assert.equal(scorers[0].goals, 3);
  assert.equal(scorers[0].favZone, 'RW');
  assert.equal(scorers[0].favTarget, 2);
  assert.deepEqual(sevenTakers.map((p) => [p.num, p.sevenGoals, p.sevenShots]), [['8', 1, 1], ['5', 0, 1]]);
});

test('scoutingMatches: 自チームの試合とスカウティングの両方から対象チームを集める', () => {
  const own = newMatch({ opponent: '青葉高校' });
  const scout = newMatch({ opponent: '青葉高校', ourName: '緑山高校', kind: 'scout' });
  const other = newMatch({ opponent: '紅陵高校' });
  assert.deepEqual(scoutingMatches([own, scout, other], '青葉高校').map((m) => m.id), [own.id, scout.id]);
  assert.deepEqual(scoutingTeams([own, scout, other]), ['紅陵高校', '青葉高校'].sort((a, b) => a.localeCompare(b, 'ja')));
});

test('スカウティングの種類も共有リンクで復元される', async () => {
  const m = newMatch({ opponent: '青葉高校', ourName: '緑山高校', kind: 'scout' });
  assert.equal((await decodeMatch(await encodeMatch(m))).kind, 'scout');
  const own = newMatch({ opponent: '青葉高校' });
  assert.equal((await decodeMatch(await encodeMatch(own))).kind, 'own');
});

import { localDate } from '../core.js';

test('localDate は端末の日付を使う', () => {
  // 2026-10-20 00:30（端末の時刻）
  assert.equal(localDate(new Date(2026, 9, 20, 0, 30)), '2026-10-20');
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
