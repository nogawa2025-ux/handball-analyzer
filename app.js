import * as C from './core.js';

const STORAGE_KEY = 'hb-analyzer-v1';
const root = document.getElementById('app');

// ---------- 保存 ----------

function loadDb() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (d && Array.isArray(d.matches)) return d;
  } catch { /* 壊れたデータは無視して初期化 */ }
  return { settings: { ourName: '自チーム', halfMinutes: 30, roster: [] }, matches: [] };
}
let db = loadDb();
const saveDb = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(db));

// ---------- 画面の状態 ----------

const ui = {
  view: 'home', // home | setup | record | analysis | settings
  matchId: null,
  shared: null, // 共有リンクから開いた試合（未保存）
  combined: null, // 通算分析: { opponent: '' }
  report: null, // 試合前の相手レポート: { team: '学校名' }
  setupKind: 'own', // 新しい試合の種類: own | scout
  tab: 'overview',
  team: 'us',
  attack: 'us', // 記録画面で今攻撃しているチーム
  sheet: null, // 入力中のシート
};

const currentMatch = () => ui.shared ?? db.matches.find((m) => m.id === ui.matchId);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const pctText = (p) => (p == null ? '–' : `${Math.round(p * 100)}%`);
const teamName = (m, team) => (team === 'us' ? m.ourName : m.opponent);
const nameOf = (m) => (team, num) => (num ? C.playerLabel(m, team, num) : '番号不明');

function go(view, patch = {}) {
  Object.assign(ui, { view, sheet: null }, patch);
  render();
  window.scrollTo(0, 0);
}

// ---------- コート図 ----------

const toSvg = (v) => v * 10;

function courtSvg(inner, { act = '', id = '' } = {}) {
  return `
  <svg class="court" viewBox="-10 -18 220 228" ${act ? `data-act="${act}"` : ''} ${id ? `id="${id}"` : ''} role="img" aria-label="ハーフコート">
    <defs><clipPath id="courtClip"><rect x="0" y="0" width="200" height="200"/></clipPath></defs>
    <rect class="court-floor" x="0" y="0" width="200" height="200" rx="2"/>
    <rect class="court-goal" x="85" y="-12" width="30" height="12"/>
    <g clip-path="url(#courtClip)">
      <path class="court-area" d="M25 0 A60 60 0 0 0 85 60 L115 60 A60 60 0 0 0 175 0 Z"/>
      <path class="court-line dashed" d="M-5 0 A90 90 0 0 0 85 90 L115 90 A90 90 0 0 0 205 0"/>
    </g>
    <line class="court-line" x1="95" y1="70" x2="105" y2="70"/>
    <line class="court-line" x1="98" y1="40" x2="102" y2="40"/>
    <line class="court-line" x1="0" y1="0" x2="200" y2="0"/>
    ${inner}
  </svg>`;
}

function svgPointFromEvent(svg, ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const clamp = (v) => Math.min(20, Math.max(0, v / 10));
  return { x: Math.round(clamp(p.x) * 10) / 10, y: Math.round(clamp(p.y) * 10) / 10 };
}

// 結果を形で表す: 得点 = 塗り丸、セーブ = 白抜き丸、枠外 = ×
function shotMark(ev, team, extra = '') {
  const x = toSvg(ev.x);
  const y = toSvg(ev.y);
  const cls = `mark ${team}`;
  const title = `<title>${esc(C.kindLabel(ev.kind))} ${esc(C.RESULTS.find((r) => r.id === ev.result)?.label)}</title>`;
  if (ev.result === 'goal') return `<g ${extra}>${title}<circle class="${cls} filled" cx="${x}" cy="${y}" r="5"/></g>`;
  if (ev.result === 'save') return `<g ${extra}>${title}<circle class="${cls} hollow" cx="${x}" cy="${y}" r="4.5"/></g>`;
  return `<g ${extra}>${title}<path class="${cls} cross" d="M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}"/></g>`;
}

// ---------- ホーム ----------

function viewHome() {
  const list = [...db.matches].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  const cards = list.map((m) => {
    const s = C.score(m.events);
    const scout = m.kind === 'scout';
    const res = scout ? '' : s.us > s.them ? 'win' : s.us < s.them ? 'lose' : 'draw';
    return `
    <button class="match-card ${scout ? 'scout' : ''}" data-act="openMatch" data-id="${m.id}">
      <div class="match-meta">${esc(m.date)}${scout ? ` <span class="badge">スカウティング: ${esc(m.opponent)}</span>` : ''}${m.finished ? '' : ' <span class="live">記録中</span>'}</div>
      <div class="match-row">
        <span class="match-team">${esc(m.ourName)}</span>
        <span class="match-score ${m.finished ? res : ''}">${s.us} - ${s.them}</span>
        <span class="match-team right">${esc(m.opponent)}</span>
      </div>
    </button>`;
  }).join('');
  const ownCount = db.matches.filter((m) => m.kind !== 'scout').length;

  return `
  <header class="topbar"><span></span><h1>ハンドボール分析</h1><button class="icon-btn" data-act="go" data-view="settings" aria-label="設定">⚙</button></header>
  <main class="page">
    <button class="btn primary big" data-act="go" data-view="setup">＋ 新しい試合を記録</button>
    ${db.matches.length ? '<button class="btn" data-act="openReport">🔍 相手チーム分析（試合前）</button>' : ''}
    ${ownCount > 1 ? '<button class="btn" data-act="openCombined">📊 通算分析（自チームの複数試合）</button>' : ''}
    <h2 class="section-title">試合</h2>
    ${cards || '<p class="empty">まだ試合がありません。「新しい試合を記録」から始めましょう。<br>最初に⚙設定で自チームの選手を登録しておくと記録が速くなります。</p>'}
  </main>`;
}

// ---------- 試合の準備 ----------

function viewSetup() {
  const s = db.settings;
  const scout = ui.setupKind === 'scout';
  // 表記ゆれで別チーム扱いにならないよう、これまでの学校名を候補に出す
  const names = [...new Set(db.matches.flatMap((m) => [m.opponent, m.kind === 'scout' ? m.ourName : null]).filter(Boolean))];
  const fields = scout ? `
      <label>分析するチーム<input name="opponent" list="teamNames" placeholder="例: 青葉高校（次の対戦相手）" required></label>
      <label>その対戦相手<input name="otherTeam" list="teamNames" placeholder="例: 緑山高校" required></label>
      <label>分析するチームの背番号（任意・スペース区切り）<input name="theirNums" inputmode="numeric" placeholder="例: 1 3 5 7 9 10 11"></label>
      <p class="hint">分析するチームの攻撃だけ記録してもOK。GKの傾向も見たいときは、もう一方のチームのシュートも記録してください。</p>` : `
      <label>対戦相手<input name="opponent" list="teamNames" placeholder="例: ○○高校" required></label>
      <label>相手の背番号（任意・スペース区切り）<input name="theirNums" inputmode="numeric" placeholder="例: 1 3 5 7 9 10 11"></label>
      <p class="hint">自チームの選手: ${s.roster.length ? s.roster.map((p) => esc(p.n)).join(', ') : '<b>未登録</b>（⚙設定から登録できます）'}</p>`;
  return `
  <header class="topbar"><button class="icon-btn" data-act="go" data-view="home" aria-label="戻る">←</button><h1>新しい試合</h1><span></span></header>
  <main class="page">
    <div class="attack-toggle small" role="radiogroup" aria-label="試合の種類">
      <button class="seg us ${!scout ? 'on' : ''}" data-act="setSetupKind" data-kind="own">自チームの試合</button>
      <button class="seg them ${scout ? 'on' : ''}" data-act="setSetupKind" data-kind="scout">スカウティング</button>
    </div>
    <form data-form="setup" class="form">
      <label>日付<input type="date" name="date" value="${C.localDate()}" required></label>
      ${fields}
      <label>前後半の時間（分）<input type="number" name="halfMinutes" min="5" max="40" value="${s.halfMinutes}"></label>
      <datalist id="teamNames">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <button class="btn primary big" type="submit">記録を始める</button>
    </form>
  </main>`;
}

// ---------- 記録画面 ----------

function viewRecord() {
  const m = currentMatch();
  const s = C.score(m.events);
  const running = !!m.clock.runningSince;
  const marks = m.events.filter((e) => e.type === 'shot' && e.team === ui.attack).slice(-6)
    .map((e) => shotMark(e, e.team, 'class="recent"')).join('');
  const pending = ui.sheet?.type === 'shot' && ui.sheet.kind !== '7m'
    ? `<circle class="pending" cx="${toSvg(ui.sheet.x)}" cy="${toSvg(ui.sheet.y)}" r="7"/>` : '';

  const log = [...m.events].reverse().slice(0, 30).map((e) => `
    <li class="log-item">
      <span class="dot ${e.team}"></span>
      <span class="log-time">${e.half === 2 ? '後' : '前'} ${C.formatClock(e.t)}</span>
      <span class="log-text">${esc(describeEvent(m, e))}</span>
      <button class="icon-btn small" data-act="deleteEvent" data-id="${e.id}" aria-label="削除">✕</button>
    </li>`).join('');

  return `
  <header class="topbar"><button class="icon-btn" data-act="go" data-view="home" aria-label="戻る">←</button><h1>${m.kind === 'scout' ? `${esc(m.ourName)} vs ${esc(m.opponent)}` : `vs ${esc(m.opponent)}`}</h1><button class="icon-btn" data-act="toAnalysis" aria-label="分析">📊</button></header>
  <main class="page record">
    <section class="scoreboard">
      <div class="sb-team us">${esc(m.ourName)}</div>
      <div class="sb-score">${s.us}<span>-</span>${s.them}</div>
      <div class="sb-team them">${esc(m.opponent)}</div>
      <div class="sb-clock">
        <span class="half">${m.clock.half === 2 ? '後半' : '前半'}</span>
        <span id="clock">${C.formatClock(C.clockSeconds(m.clock))}</span>
        <button class="btn tiny" data-act="toggleClock">${running ? '⏸ 停止' : '▶ 開始'}</button>
        ${m.clock.half === 1 ? '<button class="btn tiny" data-act="secondHalf">後半へ</button>' : ''}
      </div>
    </section>

    <div class="attack-toggle" role="radiogroup" aria-label="攻撃中のチーム">
      <button class="seg us ${ui.attack === 'us' ? 'on' : ''}" data-act="setAttack" data-team="us">${esc(m.ourName)}の攻撃</button>
      <button class="seg them ${ui.attack === 'them' ? 'on' : ''}" data-act="setAttack" data-team="them">${esc(m.opponent)}の攻撃</button>
    </div>

    <p class="hint center">シュートした場所をタップ</p>
    ${courtSvg(marks + pending, { act: 'courtTap', id: 'recordCourt' })}

    <div class="quick-row">
      <button class="btn" data-act="openSheet" data-type="7m">7mスロー</button>
      <button class="btn" data-act="openSheet" data-type="turnover">ターンオーバー</button>
      <button class="btn" data-act="openSheet" data-type="suspension">2分退場</button>
      <button class="btn" data-act="undo" ${m.events.length ? '' : 'disabled'}>↶ 取消</button>
    </div>

    <h2 class="section-title">記録（新しい順）</h2>
    <ul class="log">${log || '<li class="empty">まだ記録がありません</li>'}</ul>
    <button class="btn primary big" data-act="finish">${m.finished ? '分析を見る' : '試合終了・分析を見る'}</button>
  </main>
  ${ui.sheet ? viewSheet(m) : ''}`;
}

function describeEvent(m, e) {
  const who = e.player ? C.playerLabel(m, e.team, e.player) : '番号不明';
  if (e.type === 'turnover') return `${who} ターンオーバー`;
  if (e.type === 'suspension') return `${who} 2分退場`;
  const res = C.RESULTS.find((r) => r.id === e.result)?.label;
  const where = e.kind === '7m' ? '7mスロー' : `${C.zoneLabel(e.zone)}${e.kind === 'fast' ? '（速攻）' : ''}`;
  return `${who} ${where} → ${res}${e.target != null ? `［${C.TARGETS[e.target]}］` : ''}`;
}

function playerButtons(m, team, selected) {
  const nums = m.roster[team].map((p) => p.n);
  const btns = nums.map((n) => {
    const p = m.roster[team].find((r) => r.n === n);
    return `<button class="num ${selected === n ? 'on' : ''}" data-act="pickPlayer" data-num="${esc(n)}">${esc(n)}${p.name ? `<small>${esc(p.name)}</small>` : ''}</button>`;
  }).join('');
  return `<div class="num-grid">
    ${btns}
    <button class="num ${selected === null ? 'on' : ''}" data-act="pickPlayer" data-num="">?<small>不明</small></button>
    <button class="num add" data-act="addPlayer">＋<small>番号追加</small></button>
  </div>`;
}

function viewSheet(m) {
  const sh = ui.sheet;
  const team = sh.team;
  const title = sh.type === 'shot' ? `シュート（${esc(teamName(m, team))}）`
    : sh.type === 'turnover' ? `ターンオーバー（${esc(teamName(m, team))}）`
      : `2分退場 — どちらのチーム？`;

  let body;
  if (sh.type === 'shot') {
    const kinds = C.KINDS.map((k) => `<button class="chip ${sh.kind === k.id ? 'on' : ''}" data-act="setKind" data-kind="${k.id}">${k.label}</button>`).join('');
    const goal = C.TARGETS.map((t, i) => `<button class="goal-cell ${sh.target === i ? 'on' : ''}" data-act="setTarget" data-i="${i}" aria-label="${t}">${sh.target === i ? '●' : ''}</button>`).join('');
    body = `
      <div class="chips">${kinds}</div>
      <div class="sheet-label">選手</div>
      ${playerButtons(m, team, sh.player)}
      <div class="sheet-label">コース（任意・シューター側から見て）</div>
      <div class="goal-grid">${goal}</div>
      <div class="result-row">
        <button class="btn result goal" data-act="saveShot" data-result="goal">得点</button>
        <button class="btn result save" data-act="saveShot" data-result="save">GKセーブ</button>
        <button class="btn result miss" data-act="saveShot" data-result="miss">枠外・ブロック</button>
      </div>`;
  } else {
    const teamTabs = `<div class="attack-toggle small">
        <button class="seg us ${team === 'us' ? 'on' : ''}" data-act="sheetTeam" data-team="us">${esc(m.ourName)}</button>
        <button class="seg them ${team === 'them' ? 'on' : ''}" data-act="sheetTeam" data-team="them">${esc(m.opponent)}</button>
      </div>`;
    body = `${teamTabs}<div class="sheet-label">選手をタップすると記録されます</div>${playerButtons(m, team, undefined)}`;
  }
  return `
  <div class="sheet-backdrop" data-act="closeSheet"></div>
  <section class="sheet" role="dialog" aria-label="${title}">
    <div class="sheet-head"><h2>${title}</h2><button class="icon-btn" data-act="closeSheet" aria-label="閉じる">✕</button></div>
    ${body}
  </section>`;
}

// ---------- 分析画面 ----------

function analysisContext() {
  if (ui.combined) {
    const ms = db.matches.filter((m) => m.kind !== 'scout' && (!ui.combined.opponent || m.opponent === ui.combined.opponent));
    const events = ms.flatMap((m) => m.events);
    // 名前表示用に全試合の選手を合わせる
    const merged = { ...C.newMatch({ ourName: db.settings.ourName, opponent: ui.combined.opponent || '相手チーム（合計）' }) };
    for (const m of ms) {
      for (const t of C.TEAMS) for (const p of m.roster[t]) if (!merged.roster[t].some((r) => r.n === p.n)) merged.roster[t].push(p);
    }
    return { m: merged, events, count: ms.length };
  }
  const m = currentMatch();
  return { m, events: m.events, count: 1 };
}

function viewAnalysis() {
  const { m, events, count } = analysisContext();
  const stats = C.matchStats(events);
  const half = C.scoreByHalf(events);
  const tabs = [['overview', '概要'], ['shots', 'シュート'], ['players', '選手'], ['gk', 'GK・コース'], ['weak', '弱点']];

  let head;
  if (ui.combined) {
    const opponents = [...new Set(db.matches.filter((x) => x.kind !== 'scout').map((x) => x.opponent))];
    head = `
    <section class="score-card">
      <div class="sc-meta">通算 ${count}試合</div>
      <label class="combo">相手で絞り込み
        <select data-change="combinedOpponent">
          <option value="">すべての試合</option>
          ${opponents.map((o) => `<option ${o === ui.combined.opponent ? 'selected' : ''}>${esc(o)}</option>`).join('')}
        </select>
      </label>
      <div class="sc-row"><span class="sc-team">${esc(m.ourName)}</span><span class="sc-score">${stats.score.us}<span>-</span>${stats.score.them}</span><span class="sc-team">${esc(m.opponent)}</span></div>
    </section>`;
  } else {
    head = `
    <section class="score-card">
      <div class="sc-meta">${esc(m.date)}${m.kind === 'scout' ? ` ・ <span class="badge">スカウティング: ${esc(m.opponent)}</span>` : ''}</div>
      <div class="sc-row"><span class="sc-team">${esc(m.ourName)}</span><span class="sc-score">${stats.score.us}<span>-</span>${stats.score.them}</span><span class="sc-team">${esc(m.opponent)}</span></div>
      <div class="sc-meta">前半 ${half[1].us}-${half[1].them} ／ 後半 ${half[2].us}-${half[2].them}</div>
    </section>`;
  }

  const teamToggle = `<div class="attack-toggle small">
      <button class="seg us ${ui.team === 'us' ? 'on' : ''}" data-act="setTeam" data-team="us">${esc(m.ourName)}</button>
      <button class="seg them ${ui.team === 'them' ? 'on' : ''}" data-act="setTeam" data-team="them">${esc(m.opponent)}</button>
    </div>`;

  let body = '';
  if (ui.tab === 'overview') body = viewOverview(m, stats);
  else if (ui.tab === 'shots') body = teamToggle + viewShots(m, events, stats[ui.team]);
  else if (ui.tab === 'players') body = teamToggle + viewPlayers(m, stats[ui.team]);
  else if (ui.tab === 'gk') body = teamToggle + viewGoal(m, stats);
  else body = teamToggle + viewWeak(m, events);

  const back = ui.shared || ui.combined ? 'home' : 'record';
  const actions = ui.shared
    ? `<div class="banner">LINEなどで共有された試合です。<button class="btn primary" data-act="saveShared">この端末に保存</button></div>`
    : ui.combined ? '' : `
      <div class="action-row">
        <button class="btn primary" data-act="share">📤 LINEなどで共有</button>
        <button class="btn" data-act="go" data-view="record">記録に戻る</button>
      </div>`;

  return `
  <header class="topbar"><button class="icon-btn" data-act="${back === 'home' ? 'goHome' : 'go'}" data-view="${back}" aria-label="戻る">←</button><h1>${ui.combined ? '通算分析' : '試合分析'}</h1>${!ui.shared && !ui.combined ? '<button class="icon-btn" data-act="deleteMatch" aria-label="試合を削除">🗑</button>' : '<span></span>'}</header>
  <main class="page">
    ${actions}
    ${head}
    <nav class="tabs">${tabs.map(([id, label]) => `<button class="tab ${ui.tab === id ? 'on' : ''}" data-act="setTab" data-tab="${id}">${label}</button>`).join('')}</nav>
    ${body}
  </main>`;
}

// 両チーム比較の1行（FotMob風の左右バー）
function compareRow(label, a, b, fmt = (v) => v, higherIsBetter = true) {
  const av = a ?? 0;
  const bv = b ?? 0;
  const max = Math.max(av, bv) || 1;
  const better = av === bv ? '' : (av > bv) === higherIsBetter ? 'us' : 'them';
  return `
  <div class="cmp">
    <div class="cmp-vals"><span class="${better === 'us' ? 'lead us' : ''}">${fmt(a)}</span><span class="cmp-label">${label}</span><span class="${better === 'them' ? 'lead them' : ''}">${fmt(b)}</span></div>
    <div class="cmp-bars">
      <div class="bar-track left"><div class="bar us" style="width:${(av / max) * 100}%"></div></div>
      <div class="bar-track"><div class="bar them" style="width:${(bv / max) * 100}%"></div></div>
    </div>
  </div>`;
}

function viewOverview(m, { us, them }) {
  const frac = (b) => `${b.goals}/${b.shots}`;
  const rows = [
    compareRow('シュート率', us.shotPct, them.shotPct, pctText),
    compareRow('シュート数', us.total.shots, them.total.shots),
    compareRow('GKセーブ率', us.gk.savePct, them.gk.savePct, pctText),
    compareRow('GKセーブ数', us.gk.saves, them.gk.saves),
    compareRow('速攻での得点', us.byKind.fast.goals, them.byKind.fast.goals),
    compareRow('7mスロー成功', us.byKind['7m'].goals, them.byKind['7m'].goals),
    compareRow('ターンオーバー', us.turnovers, them.turnovers, (v) => v, false),
    compareRow('2分退場', us.suspensions, them.suspensions, (v) => v, false),
  ].join('');
  return `
  <section class="card">
    <div class="legend-row"><span><i class="sw us"></i>${esc(m.ourName)}</span><span><i class="sw them"></i>${esc(m.opponent)}</span></div>
    ${rows}
    <p class="hint">速攻 ${frac(us.byKind.fast)} vs ${frac(them.byKind.fast)} ／ 7m ${frac(us.byKind['7m'])} vs ${frac(them.byKind['7m'])}</p>
  </section>`;
}

function zoneBars(s) {
  return C.ZONES.map((z) => {
    const b = s.byZone[z.id];
    const p = b.shots ? b.goals / b.shots : null;
    return `
    <div class="zrow" title="${z.label}: ${b.goals}/${b.shots}（セーブ${b.saves}・枠外${b.misses}）">
      <span class="zlabel">${z.label}</span>
      <div class="ztrack"><div class="bar ${s.team}" style="width:${(p ?? 0) * 100}%"></div></div>
      <span class="zval">${b.shots ? `${pctText(p)} <small>${b.goals}/${b.shots}</small>` : '<small>なし</small>'}</span>
    </div>`;
  }).join('');
}

function viewShots(m, events, s) {
  const shots = events.filter((e) => e.type === 'shot' && e.team === s.team && e.kind !== '7m');
  const marks = shots.map((e) => shotMark(e, e.team)).join('');
  return `
  <section class="card">
    <h3>シュートマップ（${esc(teamName(m, s.team))}）</h3>
    <div class="legend-row">
      <span><svg width="14" height="14" viewBox="-7 -7 14 14"><circle class="mark ${s.team} filled" r="5"/></svg>得点</span>
      <span><svg width="14" height="14" viewBox="-7 -7 14 14"><circle class="mark ${s.team} hollow" r="4.5"/></svg>GKセーブ</span>
      <span><svg width="14" height="14" viewBox="-7 -7 14 14"><path class="mark ${s.team} cross" d="M-4 -4 L4 4 M4 -4 L-4 4"/></svg>枠外・ブロック</span>
    </div>
    ${courtSvg(marks)}
    <p class="hint">7mスローは地図に含めず、下の表に表示しています。</p>
  </section>
  <section class="card">
    <h3>エリア別シュート率</h3>
    ${zoneBars(s)}
    <div class="kpis">
      ${C.KINDS.map((k) => { const b = s.byKind[k.id]; return `<div class="kpi"><div class="kpi-v">${b.goals}/${b.shots}</div><div class="kpi-l">${k.label}</div></div>`; }).join('')}
    </div>
  </section>`;
}

function viewPlayers(m, s) {
  const rows = s.players.map((p) => `
    <tr>
      <td>${esc(p.num || '?')}</td>
      <td class="name">${esc(m.roster[s.team].find((r) => r.n === p.num)?.name || '')}</td>
      <td>${p.goals}/${p.shots}</td>
      <td>${p.shots ? pctText(p.goals / p.shots) : '–'}</td>
      <td>${p.saves}</td>
      <td>${p.turnovers}</td>
      <td>${p.suspensions}</td>
    </tr>`).join('');
  return `
  <section class="card table-card">
    <table class="ptable">
      <thead><tr><th>#</th><th class="name">名前</th><th>得点/本</th><th>率</th><th>被セーブ</th><th>TO</th><th>退場</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty">記録がありません</td></tr>'}</tbody>
    </table>
    <p class="hint">TO = ターンオーバー（パス・キャッチミスなどでボールを失った回数）</p>
  </section>`;
}

// 3×3のゴール図。rate が高いほど濃く塗る
function goalGrid(cells, team, rateOf, label) {
  return `<div class="goal-heat">${cells.map((b, i) => {
    const r = b.shots ? rateOf(b) : null;
    const mix = r == null ? 0 : 12 + r * 78;
    const dark = mix > 55;
    return `<div class="heat-cell ${dark ? 'dark' : ''}" style="--mix:${mix}%" data-team="${team}" title="${C.TARGETS[i]}: ${label(b)}">
      <b>${b.shots ? label(b) : '–'}</b><small>${b.shots ? pctText(r) : ''}</small>
    </div>`;
  }).join('')}</div>`;
}

function viewGoal(m, stats) {
  const s = stats[ui.team];
  const opp = C.other(ui.team);
  return `
  <section class="card">
    <h3>${esc(teamName(m, ui.team))}のシュートコース</h3>
    <p class="hint">シューター側から見た図。数字は 得点/枠内シュート、濃いほど決まっている。</p>
    ${goalGrid(s.byTarget.map((b) => ({ ...b, shots: b.goals + b.saves })), ui.team, (b) => b.goals / b.shots, (b) => `${b.goals}/${b.shots}`)}
  </section>
  <section class="card">
    <h3>${esc(teamName(m, ui.team))}のGK</h3>
    <div class="kpis">
      <div class="kpi"><div class="kpi-v">${pctText(s.gk.savePct)}</div><div class="kpi-l">セーブ率</div></div>
      <div class="kpi"><div class="kpi-v">${s.gk.saves}/${s.gk.onTarget}</div><div class="kpi-l">セーブ/枠内</div></div>
      <div class="kpi"><div class="kpi-v">${stats[opp].byKind['7m'].goals}/${stats[opp].byKind['7m'].shots}</div><div class="kpi-l">7m 被得点</div></div>
    </div>
    <p class="hint">${esc(teamName(m, opp))}のシュートが決まったコース（シューター側から見た図）。濃いほど破られている。</p>
    ${goalGrid(s.gkByTarget, opp, (b) => b.goals / b.shots, (b) => `${b.goals}/${b.shots}`)}
  </section>`;
}

function viewWeak(m, events) {
  const { weak, strong } = C.insights(events, ui.team, nameOf(m));
  const li = (arr, cls, icon) => arr.map((t) => `<li class="${cls}"><span class="ico" aria-hidden="true">${icon}</span>${esc(t)}</li>`).join('');
  return `
  <section class="card">
    <h3>${esc(teamName(m, ui.team))}の弱点</h3>
    <ul class="insights">${li(weak, 'weak', '⚠') || '<li class="empty">目立った弱点は見つかっていません</li>'}</ul>
  </section>
  <section class="card">
    <h3>${esc(teamName(m, ui.team))}の強み</h3>
    <ul class="insights">${li(strong, 'strong', '✓') || '<li class="empty">目立った強みは見つかっていません</li>'}</ul>
  </section>
  <p class="hint">データが少ないと傾向は出ません（目安: 各エリア3本以上、選手は4本以上）。通算分析で複数試合を合わせると見つけやすくなります。</p>`;
}

// ---------- 試合前の相手レポート ----------

function viewReport() {
  const teams = C.scoutingTeams(db.matches);
  const team = teams.includes(ui.report.team) ? ui.report.team : teams[0];
  const ms = C.scoutingMatches(db.matches, team).sort((a, b) => b.date.localeCompare(a.date));
  const events = ms.flatMap((m) => m.events);
  // 対象チームはどの試合でも 'them'。背番号と名前を全試合ぶん合わせる
  const pseudo = C.newMatch({ opponent: team, ourName: '対戦相手' });
  for (const m of ms) for (const p of m.roster.them) if (!pseudo.roster.them.some((r) => r.n === p.n)) pseudo.roster.them.push(p);
  const label = nameOf(pseudo);
  const s = C.teamStats(events, 'them');
  const { scorers, sevenTakers } = C.keyPlayers(events, 'them');
  const { weak, strong } = C.insights(events, 'them', label);
  const few = s.total.shots < 30;
  const avgGoals = ms.length ? (s.total.goals / ms.length).toFixed(1) : '–';
  const fastShare = s.total.shots ? s.byKind.fast.shots / s.total.shots : null;
  const nameFor = (num) => esc(pseudo.roster.them.find((r) => r.n === num)?.name || '');

  const matchRows = ms.map((m) => {
    const sc = C.score(m.events);
    const type = m.kind === 'scout' ? 'スカウティング' : '自チームの試合';
    return `<li><span class="log-time">${esc(m.date)}</span> vs ${esc(m.ourName)} <b>${sc.them}-${sc.us}</b> <small class="hint">${type}</small></li>`;
  }).join('');

  const playerRows = scorers.map((p) => `
    <tr>
      <td>${esc(p.num)}</td>
      <td class="name">${nameFor(p.num)}</td>
      <td>${p.goals}/${p.shots}</td>
      <td>${pctText(p.goals / p.shots)}</td>
      <td class="name">${p.favZone ? C.zoneLabel(p.favZone) : '–'}</td>
      <td class="name">${p.favTarget != null ? C.TARGETS[p.favTarget] : '–'}</td>
    </tr>`).join('');

  const li = (arr, cls, icon) => arr.map((t) => `<li class="${cls}"><span class="ico" aria-hidden="true">${icon}</span>${esc(t)}</li>`).join('');
  const marks = events.filter((e) => e.type === 'shot' && e.team === 'them' && e.kind !== '7m').map((e) => shotMark(e, 'them')).join('');

  return `
  <header class="topbar"><button class="icon-btn" data-act="goHome" aria-label="戻る">←</button><h1>相手チーム分析</h1><span></span></header>
  <main class="page">
    <section class="score-card">
      <label class="combo">分析するチーム
        <select data-change="reportTeam">${teams.map((t) => `<option ${t === team ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      </label>
      <div class="sc-meta">${ms.length}試合のデータ（シュート${s.total.shots}本）</div>
      <ul class="match-list">${matchRows}</ul>
    </section>
    ${few ? '<div class="banner">⚠ データが少ないので参考程度に見てください（目安: シュート30本以上）。</div>' : ''}

    <section class="card">
      <h3>警戒すること（相手の強み）</h3>
      <ul class="insights">${li(strong, 'strong', '!') || '<li class="empty">目立った強みは見つかっていません</li>'}</ul>
      <h3>狙いどころ（相手の弱点）</h3>
      <ul class="insights">${li(weak, 'weak', '◎') || '<li class="empty">目立った弱点は見つかっていません</li>'}</ul>
    </section>

    <section class="card table-card">
      <h3>要注意選手</h3>
      <table class="ptable">
        <thead><tr><th>#</th><th class="name">名前</th><th>得点/本</th><th>率</th><th class="name">よく打つエリア</th><th class="name">よく決めるコース</th></tr></thead>
        <tbody>${playerRows || '<tr><td colspan="6" class="empty">背番号つきのシュート記録がありません</td></tr>'}</tbody>
      </table>
      <p class="hint">7mスロー: ${sevenTakers.length ? sevenTakers.map((p) => `#${esc(p.num)}（${p.sevenGoals}/${p.sevenShots}）`).join('、') : '記録なし'}　／ コースはシューター側から見た位置</p>
    </section>

    <section class="card">
      <h3>攻撃の傾向</h3>
      <div class="kpis">
        <div class="kpi"><div class="kpi-v">${pctText(s.shotPct)}</div><div class="kpi-l">シュート率</div></div>
        <div class="kpi"><div class="kpi-v">${avgGoals}</div><div class="kpi-l">1試合の平均得点</div></div>
        <div class="kpi"><div class="kpi-v">${pctText(fastShare)}</div><div class="kpi-l">速攻の割合</div></div>
      </div>
      ${courtSvg(marks)}
      ${zoneBars(s)}
    </section>

    <section class="card">
      <h3>GK</h3>
      ${s.gk.onTarget ? `
      <div class="kpis">
        <div class="kpi"><div class="kpi-v">${pctText(s.gk.savePct)}</div><div class="kpi-l">セーブ率</div></div>
        <div class="kpi"><div class="kpi-v">${s.gk.saves}/${s.gk.onTarget}</div><div class="kpi-l">セーブ/枠内</div></div>
        <div class="kpi"><div class="kpi-v">${s.gk.goalsAgainst}</div><div class="kpi-l">失点</div></div>
      </div>
      <p class="hint">${esc(team)}のGKが破られたコース（シューター側から見た図）。濃いほど決まりやすい＝狙い目。</p>
      ${goalGrid(s.gkByTarget, 'us', (b) => b.goals / b.shots, (b) => `${b.goals}/${b.shots}`)}`
    : '<p class="empty">GKのデータがありません（対戦相手のシュートも記録すると表示されます）</p>'}
    </section>
  </main>`;
}

// ---------- 設定 ----------

function viewSettings() {
  const s = db.settings;
  const rosterText = s.roster.map((p) => `${p.n} ${p.name ?? ''}`.trim()).join('\n');
  return `
  <header class="topbar"><button class="icon-btn" data-act="go" data-view="home" aria-label="戻る">←</button><h1>設定</h1><span></span></header>
  <main class="page">
    <form data-form="settings" class="form">
      <label>自チーム名<input name="ourName" value="${esc(s.ourName)}" required></label>
      <label>前後半の時間（分）<input type="number" name="halfMinutes" min="5" max="40" value="${s.halfMinutes}"></label>
      <label>自チームの選手（1行に「背番号 名前」）
        <textarea name="roster" rows="10" placeholder="1 田中&#10;7 山田&#10;10 佐藤">${esc(rosterText)}</textarea>
      </label>
      <button class="btn primary big" type="submit">保存</button>
    </form>
    <h2 class="section-title">データのバックアップ</h2>
    <div class="action-row">
      <button class="btn" data-act="exportData">書き出し（ファイル）</button>
      <label class="btn">読み込み<input type="file" accept="application/json" data-change="importData" hidden></label>
    </div>
    <p class="hint">データはこのスマホのブラウザ内に保存されています。機種変更の前などに書き出してください。</p>
  </main>`;
}

// ---------- 描画 ----------

function render() {
  const views = { home: viewHome, setup: viewSetup, record: viewRecord, analysis: viewAnalysis, report: viewReport, settings: viewSettings };
  root.innerHTML = views[ui.view]();
}

// ---------- 操作 ----------

function addEvent(m, ev) {
  m.events.push({ id: C.newId(), half: m.clock.half, t: C.clockSeconds(m.clock), ...ev });
  saveDb();
}

function closeSheetAndSwitch(switchAttack) {
  if (switchAttack) ui.attack = C.other(ui.attack);
  ui.sheet = null;
  render();
}

const actions = {
  go: (d) => go(d.view),
  goHome: () => { ui.shared = null; ui.combined = null; ui.report = null; history.replaceState(null, '', location.pathname); go('home'); },
  openMatch: (d) => {
    const m = db.matches.find((x) => x.id === d.id);
    // スカウティングでは分析対象（'them'）を最初に表示する
    const focus = m.kind === 'scout' ? 'them' : 'us';
    go(m.finished ? 'analysis' : 'record', { matchId: d.id, tab: 'overview', team: focus, attack: focus, shared: null, combined: null });
  },
  openReport: () => go('report', { report: { team: '' }, shared: null, combined: null }),
  setSetupKind: (d) => { ui.setupKind = d.kind; render(); },
  openCombined: () => go('analysis', { combined: { opponent: '' }, shared: null, tab: 'overview', team: 'us' }),
  toAnalysis: () => go('analysis', { tab: 'overview', team: currentMatch().kind === 'scout' ? 'them' : 'us' }),
  finish: () => {
    const m = currentMatch();
    m.finished = true;
    if (m.clock.runningSince) actions.toggleClock({}, true);
    saveDb();
    go('analysis', { tab: 'overview', team: currentMatch().kind === 'scout' ? 'them' : 'us' });
  },
  setTab: (d) => { ui.tab = d.tab; render(); },
  setTeam: (d) => { ui.team = d.team; render(); },
  setAttack: (d) => { ui.attack = d.team; render(); },

  toggleClock: (_d, silent) => {
    const m = currentMatch();
    const c = m.clock;
    if (c.runningSince) {
      c.elapsed += (Date.now() - c.runningSince) / 1000;
      c.runningSince = null;
    } else {
      c.runningSince = Date.now();
      requestWakeLock();
    }
    saveDb();
    if (!silent) render();
  },
  secondHalf: () => {
    if (!confirm('後半に切り替えますか？（時計は0:00に戻ります）')) return;
    const m = currentMatch();
    m.clock = { half: 2, elapsed: 0, runningSince: null };
    saveDb();
    render();
  },

  courtTap: (_d, _x, ev) => {
    const svg = document.getElementById('recordCourt');
    const { x, y } = svgPointFromEvent(svg, ev);
    ui.sheet = { type: 'shot', team: ui.attack, x, y, kind: 'set', player: null, target: null };
    render();
  },
  openSheet: (d) => {
    if (d.type === '7m') {
      ui.sheet = { type: 'shot', team: ui.attack, ...C.SEVEN_M_SPOT, kind: '7m', player: null, target: null };
    } else {
      // ターンオーバーは攻撃中のチーム、退場は守備側が多い
      ui.sheet = { type: d.type, team: d.type === 'suspension' ? C.other(ui.attack) : ui.attack };
    }
    render();
  },
  closeSheet: () => { ui.sheet = null; render(); },
  sheetTeam: (d) => { ui.sheet.team = d.team; render(); },
  setKind: (d) => {
    ui.sheet.kind = d.kind;
    if (d.kind === '7m') Object.assign(ui.sheet, C.SEVEN_M_SPOT);
    render();
  },
  setTarget: (d) => { const i = Number(d.i); ui.sheet.target = ui.sheet.target === i ? null : i; render(); },
  pickPlayer: (d) => {
    const num = d.num === '' ? null : d.num;
    const m = currentMatch();
    if (ui.sheet.type === 'shot') { ui.sheet.player = num; render(); return; }
    addEvent(m, { type: ui.sheet.type, team: ui.sheet.team, player: num });
    closeSheetAndSwitch(ui.sheet.type === 'turnover');
  },
  addPlayer: () => {
    const n = (prompt('背番号を入力') ?? '').trim();
    if (!n) return;
    const m = currentMatch();
    const list = m.roster[ui.sheet.team];
    if (!list.some((p) => p.n === n)) {
      list.push({ n, name: '' });
      list.sort((a, b) => Number(a.n) - Number(b.n) || a.n.localeCompare(b.n));
      saveDb();
    }
    actions.pickPlayer({ num: n });
  },
  saveShot: (d) => {
    const m = currentMatch();
    const sh = ui.sheet;
    addEvent(m, {
      type: 'shot', team: sh.team, player: sh.player, x: sh.x, y: sh.y,
      kind: sh.kind, result: d.result, target: sh.target, zone: C.zoneOf(sh.x, sh.y, sh.kind),
    });
    closeSheetAndSwitch(true);
  },
  undo: () => {
    const m = currentMatch();
    const last = m.events.pop();
    if (last) { ui.attack = last.team; saveDb(); }
    render();
  },
  deleteEvent: (d) => {
    if (!confirm('この記録を削除しますか？')) return;
    const m = currentMatch();
    m.events = m.events.filter((e) => e.id !== d.id);
    saveDb();
    render();
  },
  deleteMatch: () => {
    const m = currentMatch();
    if (!confirm(`vs ${m.opponent}（${m.date}）を削除しますか？元に戻せません。`)) return;
    db.matches = db.matches.filter((x) => x.id !== m.id);
    saveDb();
    go('home');
  },

  share: async () => {
    const m = currentMatch();
    const code = await C.encodeMatch(m);
    const url = `${location.origin}${location.pathname}#m=${code}`;
    const s = C.score(m.events);
    const text = `${m.date} ${m.ourName} ${s.us}-${s.them} ${m.opponent} の分析`;
    if (location.protocol === 'file:') alert('注意: このアプリがWeb上に公開されていないため、他の人はこのリンクを開けません。');
    if (navigator.share) {
      try { await navigator.share({ title: 'ハンドボール分析', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      alert('リンクをコピーしました。LINEに貼り付けて送ってください。');
    } catch {
      prompt('このリンクをコピーして送ってください', url);
    }
  },
  saveShared: () => {
    const m = ui.shared;
    m.finished = true;
    db.matches.push(m);
    saveDb();
    history.replaceState(null, '', location.pathname);
    ui.shared = null;
    ui.matchId = m.id;
    alert('保存しました');
    render();
  },

  exportData: () => {
    const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `handball-backup-${C.localDate()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

const changes = {
  combinedOpponent: (el) => { ui.combined.opponent = el.value; render(); },
  reportTeam: (el) => { ui.report.team = el.value; render(); },
  importData: async (el) => {
    const file = el.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.matches)) throw new Error('形式が違います');
      const known = new Set(db.matches.map((m) => m.id));
      const added = data.matches.filter((m) => !known.has(m.id));
      db.matches.push(...added);
      if (!db.settings.roster.length && data.settings) db.settings = data.settings;
      saveDb();
      alert(`${added.length}試合を読み込みました`);
      go('home');
    } catch (e) {
      alert(`読み込めませんでした: ${e.message}`);
    }
  },
};

const forms = {
  setup: (f) => {
    const s = db.settings;
    const theirRoster = f.theirNums.value.split(/[\s,、]+/).filter(Boolean).map((n) => ({ n, name: '' }));
    const scout = ui.setupKind === 'scout';
    const m = C.newMatch({
      kind: scout ? 'scout' : 'own',
      date: f.date.value,
      opponent: f.opponent.value.trim(),
      ourName: scout ? f.otherTeam.value.trim() : s.ourName,
      halfMinutes: Number(f.halfMinutes.value) || s.halfMinutes,
      ourRoster: scout ? [] : s.roster,
      theirRoster,
    });
    db.matches.push(m);
    saveDb();
    const focus = scout ? 'them' : 'us';
    go('record', { matchId: m.id, attack: focus, team: focus, shared: null, combined: null, report: null });
  },
  settings: (f) => {
    const roster = f.roster.value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [n, ...rest] = line.split(/\s+/);
      return { n, name: rest.join(' ') };
    });
    db.settings = { ourName: f.ourName.value.trim() || '自チーム', halfMinutes: Number(f.halfMinutes.value) || 30, roster };
    saveDb();
    alert('保存しました');
    go('home');
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) {
    ev.preventDefault();
    fn(el.dataset, el, ev);
  }
});
document.addEventListener('change', (ev) => {
  const fn = changes[ev.target.dataset?.change];
  if (fn) fn(ev.target);
});
document.addEventListener('submit', (ev) => {
  const fn = forms[ev.target.dataset.form];
  if (fn) {
    ev.preventDefault();
    fn(ev.target);
  }
});

// 時計の表示だけを更新する（入力中の画面を作り直さない）
setInterval(() => {
  if (ui.view !== 'record') return;
  const el = document.getElementById('clock');
  const m = currentMatch();
  if (el && m) el.textContent = C.formatClock(C.clockSeconds(m.clock));
}, 500);

let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* 非対応の端末では何もしない */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ui.view === 'record' && currentMatch()?.clock.runningSince) requestWakeLock();
});

// ---------- 起動 ----------

async function start() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const code = hash.get('m');
  if (code) {
    try {
      ui.shared = await C.decodeMatch(code);
      ui.view = 'analysis';
    } catch {
      alert('共有リンクを読み込めませんでした');
    }
  }
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
start();
