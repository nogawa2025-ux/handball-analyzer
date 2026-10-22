// ハンドボール分析: データモデル・集計・共有用エンコード（UIに依存しない純粋なロジック）
//
// コート座標: 半面コートをメートルで表す。x = 0..20（左→右、攻撃側から見て）、
// y = ゴールラインからの距離 0..20。ゴールは x = 8.5..11.5, y = 0。

export const TEAMS = ['us', 'them'];
export const other = (team) => (team === 'us' ? 'them' : 'us');

export const ZONES = [
  { id: 'LW', label: '左サイド' },
  { id: 'LB', label: '左45度' },
  { id: 'CB', label: 'センター' },
  { id: 'RB', label: '右45度' },
  { id: 'RW', label: '右サイド' },
  { id: 'PV', label: '6m（ポスト）' },
  { id: '7M', label: '7mスロー' },
];
export const zoneLabel = (id) => ZONES.find((z) => z.id === id)?.label ?? id;

export const KINDS = [
  { id: 'set', label: 'セット' },
  { id: 'fast', label: '速攻' },
  { id: '7m', label: '7m' },
];
export const kindLabel = (id) => KINDS.find((k) => k.id === id)?.label ?? id;

export const RESULTS = [
  { id: 'goal', label: '得点' },
  { id: 'save', label: 'GKセーブ' },
  { id: 'miss', label: '枠外・ブロック' },
];

// ゴールを3×3に分けたコース。シューター側から見た位置。
export const TARGETS = ['左上', '中上', '右上', '左中', '中央', '右中', '左下', '中下', '右下'];

export const SEVEN_M_SPOT = { x: 10, y: 7 };

// ゴールエリア（ゴールポスト間の線分）までの距離
export function distanceToGoal(x, y) {
  const cx = Math.min(Math.max(x, 8.5), 11.5);
  return Math.hypot(x - cx, y);
}

export function zoneOf(x, y, kind) {
  if (kind === '7m') return '7M';
  // ゴール中央から見た角度。0 = 正面、マイナス = 左
  const angle = (Math.atan2(x - 10, Math.max(y, 0.01)) * 180) / Math.PI;
  if (angle <= -55) return 'LW';
  if (angle >= 55) return 'RW';
  if (distanceToGoal(x, y) <= 8) return 'PV';
  if (angle < -20) return 'LB';
  if (angle > 20) return 'RB';
  return 'CB';
}

// 端末のタイムゾーンでの日付（toISOString はUTCなので日本では朝9時まで前日になる）
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

let idCounter = 0;
export function newId() {
  idCounter += 1;
  return Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
}

// kind: 'own' = 自チームの試合、'scout' = スカウティング。
// スカウティングでは分析するチームを常に 'them'（opponent）に置き、その対戦相手を 'us'（ourName）に置く。
// こうすると、自チームの試合とスカウティングを同じ形で合算できる。
export function newMatch({ date, opponent, ourName = '自チーム', halfMinutes = 30, ourRoster = [], theirRoster = [], kind = 'own' } = {}) {
  return {
    id: newId(),
    kind,
    date: date ?? localDate(),
    ourName,
    opponent: opponent || '相手チーム',
    halfMinutes,
    roster: { us: ourRoster.map((p) => ({ ...p })), them: theirRoster.map((p) => ({ ...p })) },
    clock: { half: 1, elapsed: 0, runningSince: null },
    events: [],
  };
}

// 時計: elapsed は現在のハーフの経過秒（停止中の累計）
export function clockSeconds(clock, now = Date.now()) {
  const running = clock.runningSince ? (now - clock.runningSince) / 1000 : 0;
  return Math.floor(clock.elapsed + running);
}

export function formatClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function playerLabel(match, team, num) {
  if (num == null || num === '') return '不明';
  const p = match.roster[team].find((r) => r.n === num);
  return p?.name ? `${num} ${p.name}` : `#${num}`;
}

// ---------- 集計 ----------

const pct = (a, b) => (b > 0 ? a / b : null);

function emptyShotBucket() {
  return { shots: 0, goals: 0, saves: 0, misses: 0 };
}

function addShot(bucket, ev) {
  bucket.shots += 1;
  if (ev.result === 'goal') bucket.goals += 1;
  else if (ev.result === 'save') bucket.saves += 1;
  else bucket.misses += 1;
}

export function score(events) {
  const s = { us: 0, them: 0 };
  for (const ev of events) if (ev.type === 'shot' && ev.result === 'goal') s[ev.team] += 1;
  return s;
}

export function scoreByHalf(events) {
  const out = { 1: { us: 0, them: 0 }, 2: { us: 0, them: 0 } };
  for (const ev of events) {
    if (ev.type === 'shot' && ev.result === 'goal') {
      const h = ev.half === 2 ? 2 : 1;
      out[h][ev.team] += 1;
    }
  }
  return out;
}

// team の攻撃・選手スタッツ、および team のGKが相手シュートをどれだけ止めたか
export function teamStats(events, team) {
  const shots = events.filter((e) => e.type === 'shot' && e.team === team);
  const against = events.filter((e) => e.type === 'shot' && e.team === other(team));

  const total = emptyShotBucket();
  const byZone = Object.fromEntries(ZONES.map((z) => [z.id, emptyShotBucket()]));
  const byKind = Object.fromEntries(KINDS.map((k) => [k.id, emptyShotBucket()]));
  const byTarget = TARGETS.map(() => emptyShotBucket());
  const players = {};
  const player = (num) => {
    const key = num ?? '';
    players[key] ??= { num: key, ...emptyShotBucket(), turnovers: 0, suspensions: 0 };
    return players[key];
  };

  for (const ev of shots) {
    addShot(total, ev);
    addShot(byZone[ev.zone] ?? (byZone[ev.zone] = emptyShotBucket()), ev);
    addShot(byKind[ev.kind] ?? byKind.set, ev);
    if (ev.target != null) addShot(byTarget[ev.target], ev);
    addShot(player(ev.player), ev);
  }
  let turnovers = 0;
  let suspensions = 0;
  for (const ev of events) {
    if (ev.team !== team) continue;
    if (ev.type === 'turnover') {
      turnovers += 1;
      player(ev.player).turnovers += 1;
    } else if (ev.type === 'suspension') {
      suspensions += 1;
      player(ev.player).suspensions += 1;
    }
  }

  // GK: 枠内シュート（得点+セーブ）に対するセーブ率
  const gk = emptyShotBucket();
  const gkByTarget = TARGETS.map(() => emptyShotBucket());
  for (const ev of against) {
    if (ev.result === 'miss') continue;
    addShot(gk, ev);
    if (ev.target != null) addShot(gkByTarget[ev.target], ev);
  }

  return {
    team,
    total,
    shotPct: pct(total.goals, total.shots),
    byZone,
    byKind,
    byTarget,
    players: Object.values(players).sort((a, b) => b.goals - a.goals || b.shots - a.shots),
    turnovers,
    suspensions,
    gk: { onTarget: gk.shots, saves: gk.saves, goalsAgainst: gk.goals, savePct: pct(gk.saves, gk.shots) },
    gkByTarget,
    fastBreakGoalsAgainst: against.filter((e) => e.kind === 'fast' && e.result === 'goal').length,
  };
}

export function matchStats(events) {
  return { us: teamStats(events, 'us'), them: teamStats(events, 'them'), score: score(events) };
}

// ---------- 強み・弱点の自動抽出 ----------

const fmtPct = (p) => `${Math.round(p * 100)}%`;
const frac = (b) => `${b.goals}/${b.shots}`;

// 返り値: { weak: string[], strong: string[] }（攻撃・守備の両面）
// nameOf(team, num) で選手名を表示用に変換する
export function insights(events, team, nameOf = (t, n) => (n ? `#${n}` : '不明')) {
  const s = teamStats(events, team);
  const weak = [];
  const strong = [];
  const base = s.shotPct ?? 0;

  // エリア別のシュート率
  for (const z of ZONES) {
    if (z.id === '7M') continue;
    const b = s.byZone[z.id];
    if (b.shots < 3) continue;
    const p = b.goals / b.shots;
    if (p <= base - 0.15 || p < 0.35) weak.push(`${z.label}からのシュート率が低い（${frac(b)}、${fmtPct(p)}）`);
    else if (p >= base + 0.15 && p >= 0.6) strong.push(`${z.label}からのシュートが好調（${frac(b)}、${fmtPct(p)}）`);
  }

  const seven = s.byKind['7m'];
  if (seven.shots >= 2 && seven.goals / seven.shots < 0.6) weak.push(`7mスローの成功率が低い（${frac(seven)}）`);

  const fast = s.byKind.fast;
  if (fast.shots >= 3 && fast.goals / fast.shots >= 0.7) strong.push(`速攻の決定率が高い（${frac(fast)}）`);
  if (fast.shots >= 3 && fast.goals / fast.shots < 0.5) weak.push(`速攻を決めきれていない（${frac(fast)}）`);

  // 選手別
  for (const p of s.players) {
    if (p.shots >= 4 && p.goals / p.shots < 0.35) weak.push(`${nameOf(team, p.num)}のシュート率が低い（${frac(p)}）`);
    else if (p.shots >= 4 && p.goals / p.shots >= 0.7) strong.push(`${nameOf(team, p.num)}がよく決めている（${frac(p)}）`);
    if (p.turnovers >= 3) weak.push(`${nameOf(team, p.num)}のターンオーバーが多い（${p.turnovers}回）`);
  }
  if (s.turnovers >= 6) weak.push(`チーム全体でターンオーバーが多い（${s.turnovers}回）`);
  if (s.suspensions >= 3) weak.push(`2分間退場が多い（${s.suspensions}回）`);

  // 守備
  if (s.fastBreakGoalsAgainst >= 3) weak.push(`速攻で${s.fastBreakGoalsAgainst}失点している（戻りの遅れ）`);
  const conceded = teamStats(events, other(team)).byZone;
  for (const z of ZONES) {
    if (z.id === '7M') continue;
    const b = conceded[z.id];
    if (b.shots >= 4 && b.goals / b.shots >= 0.7) weak.push(`守備: ${z.label}から決められている（${frac(b)}）`);
  }

  // GK
  if (s.gk.onTarget >= 8) {
    const sp = s.gk.savePct;
    if (sp < 0.25) weak.push(`GKのセーブ率が低い（${s.gk.saves}/${s.gk.onTarget}、${fmtPct(sp)}）`);
    else if (sp >= 0.4) strong.push(`GKがよく止めている（${s.gk.saves}/${s.gk.onTarget}、${fmtPct(sp)}）`);
  }
  s.gkByTarget.forEach((b, i) => {
    if (b.goals >= 2 && b.goals / b.shots >= 0.75) weak.push(`GK: ゴールの${TARGETS[i]}を破られている（${b.goals}/${b.shots}）`);
  });

  return { weak, strong };
}

// ---------- 試合前の相手レポート ----------

// よく打つ・よく決める選手。お気に入りのエリア（本数最多）とコース（得点最多）つき
export function keyPlayers(events, team, limit = 5) {
  const map = {};
  for (const ev of events) {
    if (ev.type !== 'shot' || ev.team !== team || !ev.player) continue;
    const p = (map[ev.player] ??= { num: ev.player, ...emptyShotBucket(), zones: {}, targets: {}, sevenShots: 0, sevenGoals: 0 });
    addShot(p, ev);
    if (ev.kind === '7m') {
      p.sevenShots += 1;
      if (ev.result === 'goal') p.sevenGoals += 1;
    } else {
      p.zones[ev.zone] = (p.zones[ev.zone] ?? 0) + 1;
    }
    if (ev.result === 'goal' && ev.target != null) p.targets[ev.target] = (p.targets[ev.target] ?? 0) + 1;
  }
  const top = (obj) => {
    const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    return entries.length ? entries[0][0] : null;
  };
  const all = Object.values(map).map((p) => {
    const t = top(p.targets);
    return { ...p, favZone: top(p.zones), favTarget: t == null ? null : Number(t) };
  });
  return {
    scorers: [...all].sort((a, b) => b.goals - a.goals || b.shots - a.shots).slice(0, limit),
    sevenTakers: all.filter((p) => p.sevenShots > 0).sort((a, b) => b.sevenShots - a.sevenShots || b.sevenGoals - a.sevenGoals),
  };
}

// teamName の試合をすべて集める。自チームの試合でもスカウティングでも、対象チームは 'them'
export function scoutingMatches(matches, teamName) {
  return matches.filter((m) => m.opponent === teamName);
}

export function scoutingTeams(matches) {
  return [...new Set(matches.map((m) => m.opponent))].sort((a, b) => a.localeCompare(b, 'ja'));
}

// ---------- 共有用エンコード（URLに入れる） ----------

const TEAM_CODE = { us: 0, them: 1 };
const TYPE_CODE = { shot: 0, turnover: 1, suspension: 2 };
const RESULT_CODE = { goal: 0, save: 1, miss: 2 };
const KIND_CODE = { set: 0, fast: 1, '7m': 2 };
const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));

function compact(match) {
  return {
    v: 1,
    k: match.kind === 'scout' ? 1 : 0,
    d: match.date,
    o: match.opponent,
    u: match.ourName,
    h: match.halfMinutes,
    r: [match.roster.us.map((p) => [p.n, p.name ?? '']), match.roster.them.map((p) => [p.n, p.name ?? ''])],
    e: match.events.map((e) => {
      const row = [TEAM_CODE[e.team], TYPE_CODE[e.type], e.half, e.t, e.player ?? ''];
      if (e.type === 'shot') {
        row.push(Math.round(e.x * 10), Math.round(e.y * 10), RESULT_CODE[e.result], KIND_CODE[e.kind], e.target ?? -1);
      }
      return row;
    }),
  };
}

function expand(c) {
  if (c.v !== 1) throw new Error('対応していない形式です');
  const team = invert(TEAM_CODE);
  const type = invert(TYPE_CODE);
  const result = invert(RESULT_CODE);
  const kind = invert(KIND_CODE);
  const m = newMatch({
    date: c.d,
    opponent: c.o,
    ourName: c.u,
    halfMinutes: c.h,
    kind: c.k === 1 ? 'scout' : 'own',
    ourRoster: c.r[0].map(([n, name]) => ({ n, name })),
    theirRoster: c.r[1].map(([n, name]) => ({ n, name })),
  });
  m.events = c.e.map((row) => {
    const ev = { id: newId(), team: team[row[0]], type: type[row[1]], half: row[2], t: row[3], player: row[4] === '' ? null : row[4] };
    if (ev.type === 'shot') {
      ev.x = row[5] / 10;
      ev.y = row[6] / 10;
      ev.result = result[row[7]];
      ev.kind = kind[row[8]];
      ev.target = row[9] === -1 ? null : row[9];
      ev.zone = zoneOf(ev.x, ev.y, ev.kind);
    }
    return ev;
  });
  m.clock = { half: 2, elapsed: m.halfMinutes * 60, runningSince: null };
  return m;
}

function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeMatch(match) {
  const json = new TextEncoder().encode(JSON.stringify(compact(match)));
  return bytesToBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeMatch(code) {
  const bytes = await pipe(base64UrlToBytes(code), new DecompressionStream('deflate-raw'));
  return expand(JSON.parse(new TextDecoder().decode(bytes)));
}
