/**
 * K-POP CARD GAME - メインロジック（全機能改修版）
 * 変更点:
 *  - パスワードによる認証（新規登録・ログイン）
 *  - 新規登録後すぐメイン画面へ
 *  - ログアウトはダブルクリック確認
 *  - パックを最大2個ストック（12時間ごと）
 *  - レアリティを6段階に拡張 (N/R/SR/SSR/HR/UR)
 *  - URカードのみ必殺技あり（スキルが機能するように修正）
 *  - バトルにバトル場＆ベンチの概念を追加
 *  - バトル開始時にバトル場カードを選択
 *  - ターン中にベンチと交換可能
 *  - ミッション: 1日1回CPUと対戦するとパックがもらえる
 *  - クイズ正解済みはアカウントに永続保存（再ログインしても復活しない）
 *  - クイズは全問題を表示し、完了したものは永続非表示
 *  - グループ別パック（そのグループのカードのみ、確率低め）
 *  - 部屋番号1vs1バグ修正
 *  - 画面拡大縮小を無効化（上下スクロールのみ）
 *  - enableAdmin() / disableAdmin() デバッグ関数あり
 */

// ==========================================
// 1. 定数・設定
// ==========================================
// レアリティ確率（通常パック）
const RARITY_PROB_NORMAL = { LR: 0.01, UR: 0.03, HR: 0.06, SSR: 0.1, SR: 0.2, R: 0.25, N: 0.35 };
// グループパック確率（低め）
const RARITY_PROB_GROUP  = { LR: 0, UR: 0.02, HR: 0.05, SSR: 0.13, SR: 0.2, R: 0.3, N: 0.5 };
const RARITY_ORDER = ['LR','UR','HR','SSR','SR','R','N'];
const RARITY_WEIGHTS = { LR: 7, UR: 6, HR: 5, SSR: 4, SR: 3, R: 2, N: 1 };

const MAX_PACKS = 2;          // 最大ストック数
const PACK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12時間
const FIELD_SLOTS = 3;
const BENCH_SLOTS = 2;
const BATTLE_DECK_SIZE = 5;   // バトルに持ち込む枚数（場3+ベンチ2）
const DECK_MAX = 10;          // デッキ編成最大枚数
const GROUP_PACK_GROUPS = ['IVE', 'TWICE', 'NewJeans', 'aespa', 'LE SSERAFIM', 'BLACKPINK', 'NiziU', 'BABYMONSTER', 'ILLIT', 'MISAMO'];

let isSkillMode = false;
let logoutClickCount = 0;
let logoutClickTimer = null;
let onlinePollingInterval = null;
let battleFxLocked = false;
let cpuTurnTimer = null;

const GACHA_RARITY_META = {
    LR:  { label: '🌈 LR LEGENDARY！', color: '#00ffcc', delay: 1200, opening: '🌈 伝説を超えた存在が…！' },
    UR:  { label: '✨ UR 超激レア！', color: '#ff00ff', delay: 900,  opening: '🌟 伝説のカードが…！' },
    HR:  { label: '🔥 HR 激レア！',   color: '#ff6600', delay: 750,  opening: '🔥 激レア出現の予感…！' },
    SSR: { label: '⭐ SSR レア！',    color: '#ffcc00', delay: 600,  opening: '⭐ レアカード接近…！' },
    SR:  { label: '💜 SR',           color: '#bf5af2', delay: 450,  opening: '💫 カードを開封中…' },
    R:   { label: '💙 R',            color: '#0a84ff', delay: 350,  opening: '📦 パック開封！' },
    N:   { label: '⚪ N',            color: '#888888', delay: 280,  opening: '📦 パック開封！' }
};

// ==========================================
// 2. アプリ状態管理
// ==========================================
const gameState = {
    allCards: [],
    quizzes: {},
    currentUser: null,
    currentQuiz: null,
    isAdmin: false,

    collectionFilter: { rarity: 'ALL', group: 'ALL', sort: 'input' },
    quizGroupFilter: 'MY_OSHI',

    battle: {
        mode: 'cpu',
        p1: { name: '', icon: '🎤', field: [null, null, null], bench: [null, null], usedSkills: new Set() },
        p2: { name: 'ライバルP', icon: '👑', field: [null, null, null], bench: [null, null], usedSkills: new Set() },
        phase: 'setup',
        turn: 'p1',
        attackerFieldIdx: null,
        actionStep: null
    },

    onlineBattle: {
        roomNo: '', role: '', status: 'idle',
        p1Name: '', p1Icon: '', p2Name: '', p2Icon: '',
        myField: [null, null, null], myBench: [null, null],
        enemyField: [null, null, null], enemyBench: [null, null],
        turn: 'HOST', usedSkills: new Set(),
        attackerFieldIdx: null, actionStep: null
    }
};

// ==========================================
// 3. 初期化
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // ピンチズームを無効化（スクロールは許可）
    document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());

    initGameData();
    setupEventListeners();
    bindLogoutButtonsForce();
});

async function initGameData() {
    try {
        const response = await fetch('data.json');
        if (!response.ok) throw new Error(`サーバーエラー: ${response.status}`);
        const data = await response.json();
        gameState.allCards = data.cards || [];
        // クイズにIDを付与
        Object.keys(data.quizzes || {}).forEach(group => {
            (data.quizzes[group] || []).forEach((q, i) => {
                if (!q.id) q.id = `${group}_${i}`;
            });
        });
        gameState.quizzes = data.quizzes || {};
        console.log('【成功】JSONデータ読み込み完了（AJAX）');

        const savedSession = localStorage.getItem('kpop_game_current_session');
        if (savedSession) {
            const userData = localStorage.getItem(`kpop_user_${savedSession}`);
            if (userData) {
                loginUserByData(JSON.parse(userData));
                showMainScreen();
            } else {
                localStorage.removeItem('kpop_game_current_session');
            }
        }
    } catch (error) {
        console.error('【例外発生】データ読み込み失敗:', error.message);
        alert('data.json の読み込みに失敗しました。');
    }
}

// ==========================================
// 4. 認証・ユーザーデータ管理
// ==========================================
function loginUserByData(userData) {
    gameState.currentUser = userData;
    // 後方互換性のためフィールド保証
    if (!gameState.currentUser.deck)            gameState.currentUser.deck = [];
    if (!gameState.currentUser.clearedQuizIds)  gameState.currentUser.clearedQuizIds = [];
    if (gameState.currentUser.packStock == null) gameState.currentUser.packStock = 1;
    if (gameState.currentUser.bonusPackStock == null) gameState.currentUser.bonusPackStock = 0;
    if (!gameState.currentUser.lastPackGrantTime) gameState.currentUser.lastPackGrantTime = Date.now();
    if (!gameState.currentUser.lastBattleMissionDate) gameState.currentUser.lastBattleMissionDate = null;
    migrateMissionClearedToBonus();

    localStorage.setItem('kpop_game_current_session', userData.nickname);
    updateHeaderUI();
    createSettingButtonInHeader();
    setupFilterEventListeners();
    initQuizGroupSelect();
    startTimerInterval();
    console.log(`【ログイン】ユーザー「${userData.nickname}」をロード`);
}

function saveUserData() {
    if (gameState.currentUser) {
        localStorage.setItem(`kpop_user_${gameState.currentUser.nickname}`, JSON.stringify(gameState.currentUser));
        console.log('【保存】ユーザーデータを同期');
    }
}

function updateHeaderUI() {
    if (!gameState.currentUser) return;
    const u = gameState.currentUser;
    const nameDisp = document.getElementById('user-name-display');
    const iconDisp = document.getElementById('user-icon-display');
    const oshiDisp = document.getElementById('user-oshi-display');
    if (nameDisp) nameDisp.textContent = u.nickname;
    if (oshiDisp)  oshiDisp.textContent = u.oshiGroup;
    if (iconDisp) {
        if (u.icon && u.icon.startsWith('data:')) {
            iconDisp.innerHTML = '';
            iconDisp.style.cssText = 'width:28px;height:28px;border-radius:50%;overflow:hidden;flex-shrink:0;border:1px solid #ff477e;';
            const img = document.createElement('img');
            img.src = u.icon;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
            iconDisp.appendChild(img);
        } else {
            iconDisp.style.cssText = '';
            iconDisp.textContent = u.icon || '🎤';
        }
    }
}

// ダブルクリック確認ログアウト
window.logout = function() {
    logoutClickCount++;
    if (logoutClickTimer) clearTimeout(logoutClickTimer);
    if (logoutClickCount === 1) {
        const btn = document.getElementById('btn-logout');
        if (btn) btn.textContent = 'もう一度押してログアウト';
        logoutClickTimer = setTimeout(() => {
            logoutClickCount = 0;
            const btn2 = document.getElementById('btn-logout');
            if (btn2) btn2.textContent = 'ログアウト';
        }, 2000);
    } else if (logoutClickCount >= 2) {
        logoutClickCount = 0;
        clearTimeout(logoutClickTimer);
        localStorage.removeItem('kpop_game_current_session');
        location.reload();
    }
};

function bindLogoutButtonsForce() {
    const btn = document.getElementById('btn-logout');
    if (btn) {
        btn.removeAttribute('onclick');
        btn.addEventListener('click', (e) => { e.preventDefault(); window.logout(); });
    }
}

// ==========================================
// 5. パックストックシステム（最大2個、12時間ごと）
// ==========================================
function getPackStock(u) { return u.packStock ?? 0; }
function getBonusPackStock(u) { return u.bonusPackStock ?? 0; }
function getTotalOpenablePacks(u) { return getPackStock(u) + getBonusPackStock(u); }
function consumeOnePack(u) {
    if (getBonusPackStock(u) > 0) { u.bonusPackStock--; return 'bonus'; }
    if (getPackStock(u) > 0) { u.packStock--; return 'normal'; }
    return null;
}
function migrateMissionClearedToBonus() {
    const u = gameState.currentUser;
    if (!u || !u.missionCleared) return;
    u.bonusPackStock = (u.bonusPackStock ?? 0) + 1;
    u.missionCleared = false;
    saveUserData();
}

function updatePackStock() {
    if (!gameState.currentUser || gameState.isAdmin) return;
    const u = gameState.currentUser;
    if (!u.lastPackGrantTime) {
        u.lastPackGrantTime = Date.now();
        if (u.packStock == null) u.packStock = 1;
        saveUserData();
        return;
    }
    const elapsed = Date.now() - u.lastPackGrantTime;
    const packsToGrant = Math.floor(elapsed / PACK_INTERVAL_MS);
    if (packsToGrant > 0) {
        const added = Math.min(packsToGrant, MAX_PACKS - getPackStock(u));
        if (added > 0) {
            u.packStock = Math.min(getPackStock(u) + added, MAX_PACKS);
            u.lastPackGrantTime += packsToGrant * PACK_INTERVAL_MS;
            saveUserData();
        }
    }
}

function startTimerInterval() {
    const timerEl = document.getElementById('pack-timer');
    if (!timerEl) return;

    const update = () => {
        if (!gameState.currentUser) return;
        const drawBtn = document.getElementById('btn-draw-pack');
        const u = gameState.currentUser;

        if (gameState.isAdmin) {
            timerEl.textContent = '👑 管理者権限: いつでも開封可能';
            if (drawBtn) drawBtn.disabled = false;
            return;
        }

        updatePackStock();

        const total = getTotalOpenablePacks(u);
        const stock = getPackStock(u);
        const bonus = getBonusPackStock(u);

        if (total > 0) {
            const bonusTxt = bonus > 0 ? `（特典${bonus}）` : '';
            timerEl.textContent = `📦 ストック: ${total}パック開封可能！${bonusTxt}`;
            if (drawBtn) drawBtn.disabled = false;
        } else {
            const nextTime = (u.lastPackGrantTime || Date.now()) + PACK_INTERVAL_MS;
            const left = nextTime - Date.now();
            if (left <= 0 && stock < MAX_PACKS) {
                timerEl.textContent = 'パック付与中...';
                if (drawBtn) drawBtn.disabled = true;
            } else {
                const h = Math.floor(left / 3600000);
                const m = Math.floor((left % 3600000) / 60000);
                const s = Math.floor((left % 60000) / 1000);
                timerEl.textContent = `次のパックまで: ${h}時間${m}分${s}秒 (ストック0)`;
                if (drawBtn) drawBtn.disabled = true;
            }
        }
    };

    update();
    setInterval(update, 1000);
}

// ==========================================
// 6. ガチャ
// ==========================================
function drawPack(groupFilter = null) {
    const u = gameState.currentUser;
    if (!u) return;

    updatePackStock();

    if (!gameState.isAdmin && getTotalOpenablePacks(u) === 0) {
        alert('開封できるパックがありません。');
        return;
    }

    const packResult = [];
    const probTable = groupFilter ? RARITY_PROB_GROUP : RARITY_PROB_NORMAL;

    for (let i = 0; i < 5; i++) {
        const card = determineCardByRarity(probTable, groupFilter);
        const userCard = {
            ...card,
            id: `card_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,
            obtainedAt: Date.now() + i
        };
        packResult.push(userCard);
        u.collection.push(userCard);
    }

    if (!gameState.isAdmin) consumeOnePack(u);

    saveUserData();
    showGachaAnimation(packResult);
}

function determineCardByRarity(probTable, groupFilter) {
    // グループパック時: 指定グループのみ（SPECIALは除外）
    // 通常パック時: SPECIAL含む全カード対象
    const candidatePool = groupFilter
        ? gameState.allCards.filter(c => c.group === groupFilter && c.group !== 'SPECIAL')
        : gameState.allCards; // 通常パックはSPECIALも出る

    if (candidatePool.length === 0) {
        // フォールバック：全カードから
        return gameState.allCards[Math.floor(Math.random() * gameState.allCards.length)];
    }

    // そのプール内に存在するレアリティのみを対象に確率を正規化して抽選
    const availableRarities = [...new Set(candidatePool.map(c => c.rarity))];
    const filteredProb = {};
    let total = 0;
    for (const rarity of RARITY_ORDER) {
        if (availableRarities.includes(rarity)) {
            filteredProb[rarity] = probTable[rarity] || 0;
            total += filteredProb[rarity];
        }
    }
    // 合計が0なら均等分配
    if (total === 0) {
        availableRarities.forEach(r => { filteredProb[r] = 1 / availableRarities.length; total += filteredProb[r]; });
    }

    const rand = Math.random() * total;
    let cum = 0;
    let selectedRarity = availableRarities[availableRarities.length - 1];
    for (const rarity of RARITY_ORDER) {
        if (!filteredProb[rarity]) continue;
        cum += filteredProb[rarity];
        if (rand < cum) { selectedRarity = rarity; break; }
    }

    const pool = candidatePool.filter(c => c.rarity === selectedRarity);
    return pool[Math.floor(Math.random() * pool.length)];
}

function getHighestRarity(cards) {
    let best = 'N';
    let bestW = 0;
    cards.forEach(c => {
        const w = RARITY_WEIGHTS[c.rarity] || 0;
        if (w > bestW) { bestW = w; best = c.rarity; }
    });
    return best;
}

function showGachaAnimation(cards) {
    const overlay = document.getElementById('gacha-overlay');
    const resultDisplay = document.getElementById('gacha-result-display');
    const effectZone = document.getElementById('gacha-effect-zone');
    const closeBtn = document.getElementById('btn-close-gacha');
    if (!overlay || !resultDisplay || !closeBtn) return;

    const packTopRarity = getHighestRarity(cards);
    const packMeta = GACHA_RARITY_META[packTopRarity] || GACHA_RARITY_META.N;

    closeBtn.classList.add('hidden');
    overlay.classList.add('active');
    overlay.scrollTop = 0; // 開く時は先頭へ
    resultDisplay.innerHTML = `<div class="pack-animation">K-POP PACK</div>`;
    if (effectZone) {
        effectZone.innerHTML = `<div class="gacha-opening-text" style="color:${packMeta.color}">${packMeta.opening}</div>`;
    }

    setTimeout(() => {
        overlay.classList.add('flash-effect');
        setTimeout(() => overlay.classList.remove('flash-effect'), 280);
        resultDisplay.innerHTML = '';
        if (effectZone) effectZone.innerHTML = '';

        let cumulative = 0;
        cards.forEach((card, index) => {
            const meta = GACHA_RARITY_META[card.rarity] || GACHA_RARITY_META.N;
            cumulative += meta.delay;
            setTimeout(() => revealGachaCard(card, resultDisplay, overlay), cumulative);
            if (index === cards.length - 1) {
                setTimeout(() => {
                    closeBtn.classList.remove('hidden');
                    // 全カード表示後、閉じるボタンが見えるよう一番下までスクロール
                    overlay.scrollTop = overlay.scrollHeight;
                }, cumulative + 400);
            }
        });
    }, 1000);
}

// ガチャ結果画面内カード詳細ポップアップ（オーバーレイ内に表示するため z-index 問題を回避）
function showGachaCardDetail(card, overlayEl) {
    const existing = overlayEl.querySelector('#gacha-card-detail-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'gacha-card-detail-popup';
    popup.style.cssText = `
        position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
        background:#222; border:1px solid #444; border-radius:14px;
        padding:20px; width:88%; max-width:320px;
        box-shadow:0 8px 32px rgba(0,0,0,0.9);
        z-index:9999;
        text-align:center;
    `;

    const rarityColors = { LR:'#00ffcc', UR:'#ff00ff', HR:'#ff6600', SSR:'#ffcc00', SR:'#bf5af2', R:'#0a84ff', N:'#888' };
    const col = rarityColors[card.rarity] || '#888';

    const cardPreview = document.createElement('div');
    cardPreview.className = `card ${card.rarity}`;
    cardPreview.style.cssText = `width:120px;height:168px;margin:0 auto 12px;flex-shrink:0;background-size:cover;background-position:center;`;
    if (card.img) cardPreview.style.backgroundImage = `url(${card.img})`;
    cardPreview.innerHTML = `<div class="card-rarity">${card.rarity}</div>`;

    const skillHTML = (['UR','LR'].includes(card.rarity) && card.skill)
        ? `<div style="background:#1e1e1e;border:1px solid #333;border-radius:8px;padding:8px;margin-top:8px;text-align:left;">
               <p style="font-size:12px;color:#ff477e;font-weight:bold;margin-bottom:4px;">✨ 必殺技【${card.skill.name}】</p>
               <p style="font-size:11px;color:#aaa;">${card.skill.desc}</p>
           </div>`
        : '';

    popup.innerHTML = `
        <p style="font-size:16px;font-weight:bold;color:${col};margin-bottom:4px;">${card.name}</p>
        <p style="font-size:12px;color:#aaa;margin-bottom:12px;">${card.group} [<span style="color:${col}">${card.rarity}</span>]</p>
    `;
    popup.insertBefore(cardPreview, popup.firstChild);

    const stats = document.createElement('div');
    stats.style.cssText = 'background:#1e1e1e;border:1px solid #333;border-radius:8px;padding:8px;margin-top:8px;text-align:left;';
    stats.innerHTML = `<p style="font-size:13px;line-height:1.8;">❤️ HP: ${card.hp}<br>⚔️ ATK: ${card.atk}</p>`;
    popup.appendChild(stats);

    if (skillHTML) {
        const skillDiv = document.createElement('div');
        skillDiv.innerHTML = skillHTML;
        popup.appendChild(skillDiv.firstChild);
    }

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '閉じる';
    closeBtn.style.cssText = 'margin-top:14px;width:100%;padding:10px;background:linear-gradient(45deg,#ff477e,#ff758f);border:none;border-radius:8px;color:#fff;font-weight:bold;cursor:pointer;font-size:14px;';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); popup.remove(); });
    popup.appendChild(closeBtn);

    // オーバーレイ外タップで閉じる用の背景
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9998;';
    backdrop.addEventListener('click', () => { popup.remove(); backdrop.remove(); });

    document.body.appendChild(backdrop);
    document.body.appendChild(popup);
}

function revealGachaCard(card, container, overlay) {
    const meta = GACHA_RARITY_META[card.rarity] || GACHA_RARITY_META.N;
    const wrap = document.createElement('div');
    wrap.className = `gacha-card-reveal rarity-${card.rarity}`;

    const burst = document.createElement('div');
    burst.className = 'gacha-rarity-burst';
    wrap.appendChild(burst);

    const label = document.createElement('span');
    label.className = 'gacha-rarity-label';
    label.textContent = meta.label;
    label.style.background = meta.color;
    label.style.color = '#fff';
    wrap.appendChild(label);

    const cardEl = createCardElement(card);
    addLongPress(cardEl, () => showGachaCardDetail(card, overlay));
    cardEl.addEventListener('click', () => {
        if (!wrap.classList.contains('is-shown')) return;
    });
    wrap.appendChild(cardEl);
    container.appendChild(wrap);

    if (['LR', 'UR', 'HR', 'SSR'].includes(card.rarity) && overlay) {
        overlay.classList.remove('rarity-flash-UR', 'rarity-flash-HR', 'rarity-flash-SSR');
        void overlay.offsetWidth;
        overlay.classList.add(`rarity-flash-${card.rarity}`);
    }

    const effectZoneEl = document.getElementById('gacha-effect-zone');
    if (effectZoneEl) {
        effectZoneEl.innerHTML =
            `<div class="gacha-opening-text" style="color:${meta.color}">${meta.label}</div>`;
    }

    requestAnimationFrame(() => wrap.classList.add('is-shown'));
}

// ==========================================
// 7. クイズシステム（全問表示・永続クリア）
// ==========================================
function initQuizGroupSelect() {
    const quizTab = document.getElementById('mission-tab');
    if (!quizTab || document.getElementById('quiz-group-select')) return;

    const filterZone = document.createElement('div');
    filterZone.style.marginBottom = '12px';
    filterZone.innerHTML = `
        <div class="filter-row">
            <label style="font-size:12px;color:#aaa;margin-right:6px;">グループ:</label>
            <select id="quiz-group-select" style="flex:1;padding:6px;font-size:12px;background:#252525;border:1px solid #333;color:#fff;border-radius:6px;">
                <option value="MY_OSHI">🌟自分の推しグループ</option>
                ${GROUP_PACK_GROUPS.map(g => `<option value="${g}">${g}</option>`).join('')}
                <option value="SPECIAL">⭐ SPECIAL</option>
            </select>
        </div>`;

    const quizContainer = document.getElementById('quiz-container');
    if (quizContainer) quizTab.insertBefore(filterZone, quizContainer);
    else quizTab.appendChild(filterZone);

    document.getElementById('quiz-group-select').addEventListener('change', (e) => {
        gameState.quizGroupFilter = e.target.value;
        renderMission();
    });
}

function renderMission() {
    const container = document.getElementById('quiz-container');
    if (!container || !gameState.currentUser) return;
    container.innerHTML = '';

    const u = gameState.currentUser;

    // バトルミッション表示
    const missionBox = document.createElement('div');
    missionBox.style.cssText = 'background:#1e1e2e;border:1px solid #333;border-radius:10px;padding:14px;margin-bottom:14px;';
    const today = new Date().toDateString();
    const battleDone = u.lastBattleMissionDate === today;
    missionBox.innerHTML = `
        <p style="font-size:13px;font-weight:bold;margin-bottom:6px;">⚔️ デイリーバトルミッション</p>
        <p style="font-size:11px;color:#aaa;margin-bottom:8px;">1日1回CPUと対戦するとパック1個獲得！</p>
        <p style="font-size:12px;color:${battleDone ? '#4cd964' : '#ff9500'};">${battleDone ? '✅ 本日クリア済み！' : '🔴 未クリア（バトルタブで対戦しよう！）'}</p>
    `;
    container.appendChild(missionBox);

    if (getBonusPackStock(u) > 0) {
        const bonus = document.createElement('div');
        bonus.style.cssText = 'text-align:center;padding:12px;background:#1e2e1e;border:1px solid #2a4a2a;border-radius:10px;margin-bottom:14px;';
        bonus.innerHTML = `<p style="color:#4cd964;font-weight:bold;">🎉 特典パック ${getBonusPackStock(u)}個ストック中！ガチャから開封できます</p>`;
        container.appendChild(bonus);
    }

    // クイズ表示
    let targetGroup = gameState.quizGroupFilter === 'MY_OSHI' ? u.oshiGroup : gameState.quizGroupFilter;
    const allGroupQuizzes = gameState.quizzes[targetGroup] || [];

    if (allGroupQuizzes.length === 0) {
        container.innerHTML += `<p style="color:#aaa;text-align:center;padding:20px;">このグループのクイズはまだありません。</p>`;
        return;
    }

    const uncleared = allGroupQuizzes.filter(q => !u.clearedQuizIds.includes(q.id));
    const cleared = allGroupQuizzes.filter(q => u.clearedQuizIds.includes(q.id));

    if (uncleared.length === 0) {
        container.innerHTML += `
            <div style="text-align:center;padding:20px;color:#aaa;">
                <p style="color:#ff477e;font-weight:bold;font-size:14px;">🏆 全問正解！</p>
                <p style="font-size:12px;">${targetGroup} のクイズは全問クリア済みです。</p>
            </div>`;
    } else {
        // 全未正解クイズを表示
        uncleared.forEach(quiz => {
            renderSingleQuiz(container, quiz);
        });
    }

    // クリア済み（折りたたみ表示）
    if (cleared.length > 0) {
        const clearedSection = document.createElement('div');
        clearedSection.style.marginTop = '12px';
        clearedSection.innerHTML = `<p style="font-size:11px;color:#666;margin-bottom:6px;">✅ クリア済み (${cleared.length}問)</p>`;
        cleared.forEach(quiz => {
            const row = document.createElement('div');
            row.style.cssText = 'font-size:11px;color:#555;padding:4px 8px;background:#181818;border-radius:6px;margin-bottom:4px;';
            row.textContent = '✓ ' + quiz.question;
            clearedSection.appendChild(row);
        });
        container.appendChild(clearedSection);
    }
}

function renderSingleQuiz(container, quiz) {
    const u = gameState.currentUser;
    const quizBox = document.createElement('div');
    quizBox.className = 'quiz-box';
    quizBox.style.marginBottom = '12px';
    quizBox.innerHTML = `<p style="font-size:14px;font-weight:bold;line-height:1.5;margin-bottom:12px;">${quiz.question}</p>
        <div class="quiz-choices-${quiz.id}" style="display:flex;flex-direction:column;gap:8px;"></div>`;
    container.appendChild(quizBox);

    const choicesDiv = quizBox.querySelector(`.quiz-choices-${quiz.id}`);
    quiz.choices.forEach((choice, idx) => {
        const btn = document.createElement('button');
        btn.className = 'btn-choice';
        btn.textContent = choice;
        btn.style.cssText = 'text-align:left;padding:10px 12px;font-size:13px;background:#2a2a2a;';
        btn.addEventListener('click', () => {
            if (idx === quiz.answer) {
                btn.style.background = '#1e3a1e';
                btn.style.borderColor = '#4cd964';
                // 正解：永続保存
                if (!u.clearedQuizIds.includes(quiz.id)) {
                    u.clearedQuizIds.push(quiz.id);
                }
                u.bonusPackStock = (u.bonusPackStock ?? 0) + 1;
                saveUserData();
                setTimeout(() => renderMission(), 600);
                alert('✨ 正解！特典パックを1個ストックに追加しました！');
            } else {
                btn.style.background = '#3a1e1e';
                btn.style.borderColor = '#ff3b30';
                // 正解を光らせる
                const allBtns = choicesDiv.querySelectorAll('button');
                allBtns[quiz.answer].style.background = '#1e3a1e';
                allBtns.forEach(b => b.disabled = true);
            }
        });
        choicesDiv.appendChild(btn);
    });
}

// ==========================================
// 8. 図鑑・コレクション
// ==========================================
function setupFilterEventListeners() {
    const colTab = document.getElementById('collection-tab');
    if (!colTab || document.getElementById('collection-filter-zone')) return;

    const fz = document.createElement('div');
    fz.id = 'collection-filter-zone';
    fz.style.cssText = 'padding:10px;background:#222;border-radius:8px;margin-bottom:12px;';
    fz.innerHTML = `
        <div style="display:flex;gap:6px;margin-bottom:8px;">
            <select id="col-filter-rarity" style="flex:1;padding:6px;font-size:11px;background:#252525;border:1px solid #333;color:#fff;border-radius:6px;">
                <option value="ALL">✨ 全レア度</option>
                ${RARITY_ORDER.map(r=>`<option value="${r}">${r}</option>`).join('')}
            </select>
            <select id="col-filter-group" style="flex:1;padding:6px;font-size:11px;background:#252525;border:1px solid #333;color:#fff;border-radius:6px;">
                <option value="ALL">🎤 全グループ</option>
                ${GROUP_PACK_GROUPS.map(g => `<option value="${g}">${g}</option>`).join('')}
                <option value="SPECIAL">⭐ SPECIAL</option>
            </select>
        </div>
        <select id="col-sort-type" style="width:100%;padding:6px;font-size:11px;background:#2d2d2d;border:1px solid #333;color:#fff;border-radius:6px;">
            <option value="input">⏳ 入手順</option>
            <option value="rarity">💎 レアリティ順</option>
            <option value="group">🗂️ グループ順</option>
            <option value="count">🃏 枚数順</option>
        </select>`;

    const collectionList = document.getElementById('collection-list');
    if (collectionList) colTab.insertBefore(fz, collectionList);

    document.getElementById('col-filter-rarity').addEventListener('change', e => { gameState.collectionFilter.rarity = e.target.value; renderCollection(); });
    document.getElementById('col-filter-group').addEventListener('change', e => { gameState.collectionFilter.group = e.target.value; renderCollection(); });
    document.getElementById('col-sort-type').addEventListener('change', e => { gameState.collectionFilter.sort = e.target.value; renderCollection(); });
}

function renderCollection() {
    const listEl = document.getElementById('collection-list');
    if (!listEl || !gameState.currentUser) return;
    listEl.innerHTML = '';

    const collection = gameState.currentUser.collection || [];
    if (collection.length === 0) {
        listEl.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#888;padding:40px 0;">まだカードがありません。パックを開封しましょう！</p>';
        return;
    }

    // 同名でもレアリティが違えば別カードとしてカウント
    const cardCounts = {};
    collection.forEach(c => {
        if (c && c.name) {
            const key = `${c.name}__${c.rarity}`;
            cardCounts[key] = (cardCounts[key] || 0) + 1;
        }
    });

    // 重複排除キーを name + rarity にする（同名異レアを別エントリとして表示）
    const seen = new Set();
    let display = [];
    collection.forEach(c => {
        if (c && c.name) {
            const key = `${c.name}__${c.rarity}`;
            if (!seen.has(key)) { seen.add(key); display.push({...c}); }
        }
    });

    const f = gameState.collectionFilter;
    if (f.rarity !== 'ALL') display = display.filter(c => c.rarity === f.rarity);
    if (f.group !== 'ALL')  display = display.filter(c => c.group === f.group);

    if (f.sort === 'input')  display.sort((a,b) => (b.obtainedAt||0)-(a.obtainedAt||0));
    if (f.sort === 'rarity') display.sort((a,b) => (RARITY_WEIGHTS[b.rarity]||0)-(RARITY_WEIGHTS[a.rarity]||0));
    if (f.sort === 'group')  display.sort((a,b) => a.group.localeCompare(b.group));
    if (f.sort === 'count')  display.sort((a,b) => (cardCounts[b.name]||0)-(cardCounts[a.name]||0));

    display.forEach(card => {
        const inDeck = gameState.currentUser.deck.includes(card.id);
        const countKey = `${card.name}__${card.rarity}`;
        const cardEl = createCardElement(card, inDeck, cardCounts[countKey]);
        addLongPress(cardEl, () => openCardDetailModal(card));
        cardEl.addEventListener('click', () => openCardDetailModal(card));
        listEl.appendChild(cardEl);
    });
}

function createCardElement(card, inDeck, count) {
    const el = document.createElement('div');
    el.className = `card ${card.rarity}`;
    if (card.img) el.style.backgroundImage = `url(${card.img})`;

    const skillTag = ['UR','LR'].includes(card.rarity) && card.skill
        ? `<div style="position:absolute;top:6px;right:6px;background:#9b59b6;color:#fff;font-size:8px;padding:1px 4px;border-radius:3px;z-index:2;">必殺技</div>`
        : '';
    const deckBadge = inDeck
        ? `<div style="position:absolute;top:4px;right:4px;background:#4cd964;color:#fff;font-size:8px;padding:2px 4px;border-radius:4px;font-weight:bold;z-index:10;">編成中</div>`
        : '';
    const countBadge = count
        ? `<div class="card-count-badge" style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;font-size:9px;padding:1px 5px;border-radius:10px;border:1px solid #444;">${count}枚</div>`
        : '';

    el.innerHTML = `
        ${deckBadge}${skillTag}
        <div class="card-rarity">${card.rarity}</div>
        <div class="card-info-box">
            <h3>${card.name}</h3>
            <p>${card.group} / HP:${card.hp}</p>
        </div>
        ${countBadge}`;
    return el;
}

function addLongPress(el, callback, duration = 500) {
    let timer = null;
    let fired = false;
    const start = () => {
        fired = false;
        timer = setTimeout(() => { fired = true; callback(); }, duration);
    };
    const cancel = () => { if (timer) clearTimeout(timer); };
    el.addEventListener('mousedown', start);
    el.addEventListener('touchstart', start, { passive: true });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => el.addEventListener(ev, cancel));
    el.addEventListener('click', e => {
        if (fired) { e.stopImmediatePropagation(); fired = false; }
    }, true);
}

function openCardDetailModal(card, options = {}) {
    const overlay = document.getElementById('detail-modal-overlay');
    if (!overlay) return;
    const readOnly = !!options.readOnly;
    overlay.classList.toggle('battle-readonly', readOnly);

    document.getElementById('modal-card-name').textContent = card.name;
    document.getElementById('modal-card-group').textContent = `${card.group} [${card.rarity}]`;
    document.getElementById('modal-card-stats').innerHTML = `❤️ HP: ${card.hp}<br>⚔️ ATK: ${card.atk}`;

    // URのみ必殺技あり
    const skillEl = document.getElementById('modal-card-skill');
    if (['UR','LR'].includes(card.rarity) && card.skill) {
        skillEl.innerHTML = `✨ 必殺技: <b>【${card.skill.name}】</b><br><span style="font-size:11px;color:#aaa;">${card.skill.desc}</span>`;
        skillEl.style.display = '';
    } else if (card.skill && !['UR','LR'].includes(card.rarity)) {
        skillEl.innerHTML = `<span style="font-size:11px;color:#555;">必殺技はURカードのみ使用可能です。</span>`;
        skillEl.style.display = '';
    } else {
        skillEl.style.display = 'none';
    }

    const preview = document.getElementById('modal-card-container');
    if (preview) {
        preview.innerHTML = '';
        const vc = document.createElement('div');
        vc.className = `card ${card.rarity}`;
        if (card.img) vc.style.backgroundImage = `url(${card.img})`;
        const previewW = readOnly ? 168 : 120;
        const previewH = readOnly ? 235 : 168;
        vc.style.cssText += `width:${previewW}px;height:${previewH}px;`;
        vc.innerHTML = `<div class="card-rarity">${card.rarity}</div>`;
        preview.appendChild(vc);
        preview.onclick = () => {
            if (!card.img) return;
            const zo = document.getElementById('zoom-overlay');
            const zi = document.getElementById('zoom-img');
            if (zo && zi) { zi.src = card.img; zo.style.display='flex'; }
        };
    }

    const deleteBtn = document.getElementById('modal-btn-delete');
    if (deleteBtn) deleteBtn.style.display = readOnly ? 'none' : '';

    // 削除ボタン
    if (deleteBtn && !readOnly) {
        const fresh = deleteBtn.cloneNode(true);
        deleteBtn.parentNode.replaceChild(fresh, deleteBtn);
        fresh.addEventListener('click', () => {
            if (!confirm(`「${card.name}」を1枚削除しますか？`)) return;
            const col = gameState.currentUser.collection;
            const idx = col.findIndex(c => c.name === card.name);
            if (idx !== -1) {
                const rmId = col[idx].id;
                col.splice(idx, 1);
                gameState.currentUser.deck = gameState.currentUser.deck.filter(id => id !== rmId);
            }
            saveUserData();
            overlay.classList.remove('active');
            renderCollection();
        });
    }

    const deckBtn = document.getElementById('modal-btn-deck');
    if (deckBtn) deckBtn.style.display = readOnly ? 'none' : '';

    // デッキボタン
    if (deckBtn && !readOnly) {
        const inDeck = gameState.currentUser.deck.includes(card.id);
        deckBtn.textContent = inDeck ? '❌ デッキから外す' : '👑 デッキに編成する';
        deckBtn.className = inDeck ? 'btn-danger' : '';
        const fresh = deckBtn.cloneNode(true);
        deckBtn.parentNode.replaceChild(fresh, deckBtn);
        fresh.addEventListener('click', () => {
            if (inDeck) {
                gameState.currentUser.deck = gameState.currentUser.deck.filter(id => id !== card.id);
                alert('デッキから外しました。');
            } else {
                if (gameState.currentUser.deck.length >= DECK_MAX) { alert(`デッキは最大${DECK_MAX}枚です！`); return; }
                gameState.currentUser.deck.push(card.id);
                alert('デッキに編成しました！');
            }
            saveUserData();
            overlay.classList.remove('active');
            renderCollection();
        });
    }

    overlay.classList.add('active');
}

// ==========================================
// 9. バトルシステム（バトル場3 + ベンチ2）
// ==========================================
function emptyField() { return [null, null, null]; }
function emptyBench() { return [null, null]; }

function cloneBattleCard(card) {
    return JSON.parse(JSON.stringify(card));
}

function isCardAlive(card) { return card && card.hp > 0; }

function countAliveField(field) {
    return field.filter(isCardAlive).length;
}

function playerHasAnyCard(player) {
    return countAliveField(player.field) > 0 || player.bench.some(isCardAlive);
}

function getAliveFieldIndices(field) {
    return field.map((c, i) => (isCardAlive(c) ? i : -1)).filter(i => i >= 0);
}

function promoteBenchToField(player, fieldIdx) {
    const benchIdx = player.bench.findIndex(isCardAlive);
    if (benchIdx < 0) {
        player.field[fieldIdx] = null;
        return false;
    }
    player.field[fieldIdx] = player.bench[benchIdx];
    player.bench[benchIdx] = null;
    return true;
}

function autoFormation(deck5) {
    const cards = deck5.map(cloneBattleCard);
    return {
        field: [cards[0], cards[1], cards[2]],
        bench: [cards[3], cards[4]]
    };
}

function findBattleCardWrap(player, zone, idx) {
    return document.querySelector(
        `.battle-card-wrap[data-battle-player="${player}"][data-battle-zone="${zone}"][data-battle-idx="${idx}"]`
    );
}

function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function playBattleActionFx(opts) {
    const {
        attackerPlayer, attackerIdx, targetPlayer, targetIdx,
        damage = 0, kind = 'attack', bannerText = null, skillName = null
    } = opts;

    return new Promise(resolve => {
        const layer = document.getElementById('battle-fx-layer');
        const atkWrap = findBattleCardWrap(attackerPlayer, 'field', attackerIdx);
        const tgtWrap = findBattleCardWrap(targetPlayer, 'field', targetIdx);

        if (layer) {
            const flash = document.createElement('div');
            flash.className = 'battle-fx-flash' + (kind === 'skill' ? ' skill' : kind === 'heal' ? ' heal' : '');
            layer.appendChild(flash);
            setTimeout(() => flash.remove(), 400);
        }

        if (layer && bannerText) {
            const banner = document.createElement('div');
            banner.className = `battle-banner-fx ${kind === 'skill' ? 'skill' : kind === 'swap' ? 'swap' : kind === 'cpu' ? 'cpu' : 'attack'}`;
            banner.textContent = bannerText;
            layer.appendChild(banner);
            setTimeout(() => banner.remove(), 900);
        }

        if (atkWrap) {
            atkWrap.classList.remove('fx-attacker');
            void atkWrap.offsetWidth;
            atkWrap.classList.add('fx-attacker');
            setTimeout(() => atkWrap.classList.remove('fx-attacker'), 500);
        }

        setTimeout(() => {
            if (tgtWrap) {
                tgtWrap.classList.remove('fx-target-hit');
                void tgtWrap.offsetWidth;
                tgtWrap.classList.add('fx-target-hit');
                setTimeout(() => tgtWrap.classList.remove('fx-target-hit'), 520);

                if (damage > 0 || kind === 'heal') {
                    const float = document.createElement('div');
                    float.className = 'damage-float' + (kind === 'skill' ? ' skill' : kind === 'heal' ? ' heal' : '');
                    if (damage === 0 && kind !== 'heal') float.classList.add('zero');
                    float.textContent = kind === 'heal' ? `+${damage}` : kind === 'skill' && skillName ? skillName : `-${damage}`;
                    tgtWrap.appendChild(float);
                    setTimeout(() => float.remove(), 950);
                }
            }
            setTimeout(resolve, 580);
        }, 280);
    });
}

function playBattleSwapFx(player, fieldIdx) {
    const wrap = findBattleCardWrap(player, 'field', fieldIdx);
    return playBattleActionFx({
        attackerPlayer: player,
        attackerIdx: fieldIdx,
        targetPlayer: player,
        targetIdx: fieldIdx,
        damage: 0,
        kind: 'swap',
        bannerText: '🔄 ベンチと交換！'
    });
}

function initGroupPackButtons() {
    const gpContainer = document.getElementById('group-pack-buttons');
    if (!gpContainer || gpContainer.dataset.bound === '1') return;
    gpContainer.dataset.bound = '1';
    gpContainer.innerHTML = '';
    GROUP_PACK_GROUPS.forEach(g => {
        const btn = document.createElement('button');
        btn.textContent = g;
        btn.addEventListener('click', () => {
            const u = gameState.currentUser;
            if (!u) return;
            updatePackStock();
            if (!gameState.isAdmin && getTotalOpenablePacks(u) === 0) {
                alert('開封できるパックがありません。');
                return;
            }
            if (confirm(`【${g}】グループパックを開封しますか？\n※通常より出現率が低くなります`)) {
                drawPack(g);
            }
        });
        gpContainer.appendChild(btn);
    });
}

function initBattleSetup() {
    const setupZone = document.getElementById('battle-setup-zone');
    const battleField = document.getElementById('battle-field');
    if (battleField) battleField.classList.add('hidden');
    if (!setupZone) return;
    setupZone.classList.remove('hidden');
    if (!gameState.currentUser) return;

    const userDeckIds = gameState.currentUser.deck || [];
    if (userDeckIds.length < BATTLE_DECK_SIZE) {
        setupZone.innerHTML = `
            <div style="text-align:center;padding:30px 15px;color:#aaa;">
                <p style="font-weight:bold;font-size:14px;color:#ff477e;margin-bottom:10px;">⚠️ デッキが不足しています</p>
                <p style="font-size:12px;line-height:1.6;">対戦にはデッキを<b>${BATTLE_DECK_SIZE}枚以上</b>編成してください（現在: ${userDeckIds.length}枚／最大${DECK_MAX}枚）</p>
            </div>`;
        return;
    }

    setupZone.innerHTML = `
        <div style="text-align:center;margin-bottom:15px;">
            <button id="btn-start-local-battle" style="background:linear-gradient(135deg,#ff477e,#ff80a0);width:100%;padding:12px;font-weight:bold;">⚔️ CPUバトル開始</button>
        </div>
        <div style="background:#222;padding:15px;border-radius:10px;border:1px solid #333;">
            <h3 style="color:#22b8cf;font-size:14px;margin-bottom:6px;">🌐 部屋番号 1vs1 対戦</h3>
            <p style="font-size:11px;color:#aaa;margin-bottom:12px;">共通の4桁部屋番号で友達と対戦！（デッキ5枚・場3+ベンチ2）</p>
            <input type="number" id="online-room-input" placeholder="4桁の部屋番号"
                style="width:100%;text-align:center;font-weight:bold;padding:8px;background:#111;border:1px solid #444;color:#fff;border-radius:6px;margin-bottom:12px;">
            <div style="display:flex;gap:8px;">
                <button id="btn-create-room" style="flex:1;font-size:11px;padding:10px 0;background:#2d2d2d;">部屋作成 (HOST)</button>
                <button id="btn-join-room" style="flex:1;font-size:11px;padding:10px 0;background:linear-gradient(135deg,#22b8cf,#11999e);">参戦 (GUEST)</button>
            </div>
            <div id="online-wait-status" class="hidden" style="margin-top:15px;border-top:1px dashed #444;padding-top:15px;text-align:center;">
                <p id="room-info-log" style="font-size:12px;color:#eee;margin-bottom:8px;"></p>
                <button id="btn-cancel-room" style="font-size:11px;padding:5px 10px;width:auto;background:#444;">キャンセル</button>
            </div>
        </div>`;

    document.getElementById('btn-start-local-battle').addEventListener('click', startBattle);
    document.getElementById('btn-create-room').addEventListener('click', () => startOnlineMatchmaking(true));
    document.getElementById('btn-join-room').addEventListener('click', () => startOnlineMatchmaking(false));
}

function startBattle() {
    const u = gameState.currentUser;
    if (!u) return;
    const fullDeck = u.deck.map(id => u.collection.find(c => c.id === id)).filter(Boolean);
    if (fullDeck.length < BATTLE_DECK_SIZE) {
        alert(`バトルにはデッキ${BATTLE_DECK_SIZE}枚以上が必要です。`);
        return;
    }
    // デッキ全枚数（最大DECK_MAX）からバトルに持ち込む5枚を選ぶ
    showBattleFormationSelect(fullDeck, (formation) => {
        beginCpuBattle(u, formation);
    });
}

function showBattleFormationSelect(deck5, callback) {
    const existing = document.getElementById('card-select-overlay');
    if (existing) existing.remove();

    const formation = { field: emptyField(), bench: emptyBench() };
    let nextSlot = { type: 'field', idx: 0 };
    const remaining = [...deck5];

    const overlay = document.createElement('div');
    overlay.id = 'card-select-overlay';
    overlay.className = 'card-select-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:800;display:flex;flex-direction:column;padding:16px;overflow-y:auto;touch-action:pan-y;-webkit-overflow-scrolling:touch;';

    const statusEl = document.createElement('p');
    statusEl.style.cssText = 'font-size:12px;color:#aaa;text-align:center;margin-bottom:10px;';

    const updateStatus = () => {
        if (nextSlot.type === 'field') {
            statusEl.textContent = `バトル場 ${nextSlot.idx + 1} / ${FIELD_SLOTS} に配置するカードをタップ`;
        } else {
            statusEl.textContent = `ベンチ ${nextSlot.idx + 1} / ${BENCH_SLOTS} に配置するカードをタップ`;
        }
    };

    overlay.innerHTML = `
        <h2 style="color:#ff477e;font-size:15px;text-align:center;margin-bottom:4px;">出陣カードを選択（${FIELD_SLOTS}＋${BENCH_SLOTS}枚）</h2>
        <p style="font-size:11px;color:#888;text-align:center;margin-bottom:6px;">デッキ${deck5.length}枚から場${FIELD_SLOTS}体＋ベンチ${BENCH_SLOTS}体を選ぶ</p>`;
    overlay.appendChild(statusEl);
    const grid = document.createElement('div');
    grid.id = 'card-select-grid';
    overlay.appendChild(grid);
    const autoBtn = document.createElement('button');
    autoBtn.textContent = 'おまかせ配置';
    autoBtn.style.marginTop = '12px';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.style.marginTop = '8px';
    overlay.appendChild(autoBtn);
    overlay.appendChild(cancelBtn);
    document.body.appendChild(overlay);

    const renderGrid = () => {
        grid.innerHTML = '';
        remaining.forEach((card, i) => {
            const el = createCardElement(card);
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                if (nextSlot.type === 'field') formation.field[nextSlot.idx] = cloneBattleCard(card);
                else formation.bench[nextSlot.idx] = cloneBattleCard(card);
                remaining.splice(i, 1);

                // 場3体＋ベンチ2体の計5枚が揃ったら終了
                const fieldFull = formation.field.every(c => c !== null);
                const benchFull = formation.bench.every(c => c !== null);
                if (fieldFull && benchFull) {
                    overlay.remove();
                    callback(formation);
                    return;
                }

                if (nextSlot.type === 'field') {
                    if (nextSlot.idx < FIELD_SLOTS - 1) nextSlot.idx++;
                    else nextSlot = { type: 'bench', idx: 0 };
                } else {
                    nextSlot.idx++;
                }
                updateStatus();
                renderGrid();
            });
            grid.appendChild(el);
        });
    };

    autoBtn.addEventListener('click', () => {
        overlay.remove();
        callback(autoFormation(deck5));
    });
    cancelBtn.addEventListener('click', () => overlay.remove());
    updateStatus();
    renderGrid();
}

function beginCpuBattle(u, formation) {
    const bState = gameState.battle;
    bState.mode = 'cpu';
    bState.p1.name = u.nickname;
    bState.p1.icon = u.icon || '🎤';
    bState.p1.field = formation.field;
    bState.p1.bench = formation.bench;
    bState.p1.usedSkills = new Set();

    const cpuCards = gameState.allCards.sort(() => 0.5 - Math.random()).slice(0, BATTLE_DECK_SIZE);
    const cpuForm = autoFormation(cpuCards);
    bState.p2.name = 'ライバルP';
    bState.p2.icon = '👑';
    bState.p2.field = cpuForm.field;
    bState.p2.bench = cpuForm.bench;
    bState.p2.usedSkills = new Set();

    bState.phase = 'fight';
    bState.turn = 'p1';
    bState.attackerFieldIdx = null;
    bState.actionStep = 'pick_attacker';
    bState.p1Kills = 0;
    bState.p2Kills = 0;
    isSkillMode = false;

    document.getElementById('battle-setup-zone').classList.add('hidden');
    document.getElementById('battle-field').classList.remove('hidden');
    document.getElementById('battle-field-log').innerHTML = '⚔️ バトル開始！場のカードをタップして攻撃！';
    updateBattleUI();
}

function renderSlotsRow(container, cards, options = {}) {
    if (!container) return;
    const player = options.battlePlayer || '';
    const zone = options.battleZone || 'field';
    container.innerHTML = '';

    cards.forEach((card, idx) => {
        const wrap = document.createElement('div');
        wrap.className = 'battle-card-wrap';
        wrap.dataset.battlePlayer = player;
        wrap.dataset.battleZone = zone;
        wrap.dataset.battleIdx = String(idx);

        if (!card) {
            wrap.classList.add('slot-empty');
            wrap.textContent = '—';
            container.appendChild(wrap);
            return;
        }

        const el = createCardElement(card);
        if (options.isMine) el.style.border = '2px solid #4cd964';
        if (options.selectableAttacker) el.classList.add('selectable-attacker');
        if (options.selectableTarget) el.classList.add('selectable-target');
        if (options.attackerSelectedIdx != null && idx === options.attackerSelectedIdx) el.classList.add('attacker-selected');
        if (!isCardAlive(card)) el.style.opacity = '0.35';

        addLongPress(el, () => openCardDetailModal(card, { readOnly: true }));

        if (options.onClick) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => options.onClick(idx, card));
        }

        wrap.appendChild(el);
        container.appendChild(wrap);
    });
}

function renderBattleField() {
    const bState = gameState.battle;
    const p2Field = document.getElementById('p2-field');
    const p2Bench = document.getElementById('p2-bench');
    const p1Field = document.getElementById('p1-field');
    const p1Bench = document.getElementById('p1-bench');

    const p2Opts = {};
    const p1Opts = { isMine: true };

    if (bState.turn === 'p1' && bState.actionStep === 'pick_target') {
        p2Opts.selectableTarget = true;
        p2Opts.onClick = (idx) => {
            if (!isCardAlive(bState.p2.field[idx])) return;
            executePlayerAction(bState.attackerFieldIdx, idx);
        };
    }
    if (bState.turn === 'p1' && bState.actionStep === 'pick_attacker') {
        p1Opts.selectableAttacker = true;
        p1Opts.onClick = (idx) => {
            if (!isCardAlive(bState.p1.field[idx])) return;
            bState.attackerFieldIdx = idx;
            bState.actionStep = 'pick_target';
            updateBattleUI();
        };
    }
    if (bState.attackerFieldIdx != null) p1Opts.attackerSelectedIdx = bState.attackerFieldIdx;

    p2Opts.battlePlayer = 'p2';
    p2Opts.battleZone = 'field';
    p1Opts.battlePlayer = 'p1';
    p1Opts.battleZone = 'field';

    renderSlotsRow(p2Field, bState.p2.field, p2Opts);
    renderSlotsRow(p2Bench, bState.p2.bench, { battlePlayer: 'p2', battleZone: 'bench' });
    renderSlotsRow(p1Field, bState.p1.field, p1Opts);
    renderSlotsRow(p1Bench, bState.p1.bench, { isMine: true, battlePlayer: 'p1', battleZone: 'bench' });
}

function clearCpuTurnTimer() {
    if (cpuTurnTimer) {
        clearTimeout(cpuTurnTimer);
        cpuTurnTimer = null;
    }
}

function scheduleCpuTurn() {
    if (cpuTurnTimer || battleFxLocked) return;
    const bState = gameState.battle;
    if (bState.turn !== 'p2' || bState.phase !== 'fight') return;
    cpuTurnTimer = setTimeout(async () => {
        cpuTurnTimer = null;
        if (gameState.battle.turn === 'p2' && gameState.battle.phase === 'fight') {
            await executeCPUTurn();
        }
    }, 1400);
}

function updateBattleUI(options = {}) {
    const bState = gameState.battle;
    renderBattleField();

    const nameP1 = document.getElementById('bf-p1-name');
    const nameP2 = document.getElementById('bf-p2-name');
    if (nameP1) nameP1.textContent = `${bState.p1.icon} ${bState.p1.name}`;
    if (nameP2) nameP2.textContent = `${bState.p2.icon} ${bState.p2.name}`;

    const actionZone = document.getElementById('battle-actions');
    if (!actionZone) return;
    actionZone.innerHTML = '';

    if (bState.turn === 'p2') {
        actionZone.innerHTML = `<p style="text-align:center;color:#aaa;font-size:12px;">⌛ ライバルのターン...</p>`;
        if (!options.skipCpuSchedule) scheduleCpuTurn();
        return;
    }

    clearCpuTurnTimer();

    if (!playerHasAnyCard(bState.p1)) {
        actionZone.innerHTML = `<p style="text-align:center;color:#ff477e;font-size:12px;">バトル場にカードがいません！</p>`;
        return;
    }

    if (bState.actionStep === 'pick_attacker') {
        actionZone.innerHTML = `<p style="text-align:center;color:#4cd964;font-size:12px;font-weight:bold;">攻撃するカード（場）をタップ</p>
            <p class="battle-hint">長押しでカード詳細</p>`;
    } else if (bState.actionStep === 'pick_target') {
        const atk = bState.p1.field[bState.attackerFieldIdx];
        actionZone.innerHTML = `<p style="text-align:center;color:#ff477e;font-size:12px;font-weight:bold;">攻撃対象をタップ（${atk ? atk.name : ''}）</p>`;
        if (atk && ['UR','LR'].includes(atk.rarity) && atk.skill && !bState.p1.usedSkills.has(atk.id)) {
            const skillBtn = document.createElement('button');
            skillBtn.textContent = `✨ 必殺技: ${atk.skill.name}`;
            skillBtn.style.background = 'linear-gradient(45deg,#9b59b6,#8e44ad)';
            skillBtn.style.marginTop = '8px';
            skillBtn.addEventListener('click', () => {
                isSkillMode = true;
                document.getElementById('battle-field-log').innerHTML = `🌟 必殺技「${atk.skill.name}」を選択中。対象をタップ！`;
            });
            actionZone.appendChild(skillBtn);
        }
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '攻撃者を選び直す';
        cancelBtn.className = 'btn-secondary';
        cancelBtn.style.marginTop = '6px';
        cancelBtn.addEventListener('click', () => {
            bState.attackerFieldIdx = null;
            bState.actionStep = 'pick_attacker';
            isSkillMode = false;
            updateBattleUI();
        });
        actionZone.appendChild(cancelBtn);
    }

    if (bState.p1.bench.some(isCardAlive)) {
        const swapBtn = document.createElement('button');
        swapBtn.textContent = '🔄 ベンチと交換（ターン消費）';
        swapBtn.style.background = '#2d5a2d';
        swapBtn.style.marginTop = '8px';
        swapBtn.addEventListener('click', () => showSwapBenchUI());
        actionZone.appendChild(swapBtn);
    }
}

function showSwapBenchUI() {
    const bState = gameState.battle;
    const benchAlive = bState.p1.bench.map((c, i) => ({ c, i })).filter(x => isCardAlive(x.c));
    if (benchAlive.length === 0) { alert('ベンチにカードがいません。'); return; }

    const overlay = document.createElement('div');
    overlay.id = 'swap-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:900;display:flex;flex-direction:column;padding:20px;overflow-y:auto;touch-action:pan-y;-webkit-overflow-scrolling:touch;';
    overlay.innerHTML = `
        <h2 style="color:#4cd964;font-size:15px;text-align:center;">交換する場のスロットを選ぶ</h2>
        <p style="font-size:11px;color:#aaa;text-align:center;margin:12px 0;">場のスロット → ベンチのカード</p>
        <div id="swap-field-pick" style="display:flex;gap:8px;justify-content:center;margin-bottom:12px;"></div>
        <div id="swap-grid"></div>
        <button id="swap-cancel" class="btn-secondary" style="margin-top:12px;">キャンセル</button>`;
    document.body.appendChild(overlay);

    let pickedFieldIdx = null;
    const fieldPick = document.getElementById('swap-field-pick');
    const grid = document.getElementById('swap-grid');

    bState.p1.field.forEach((card, fi) => {
        const btn = document.createElement('button');
        btn.className = 'formation-slot-btn' + (isCardAlive(card) ? ' filled' : '');
        btn.textContent = card ? card.name : `空き${fi + 1}`;
        btn.addEventListener('click', () => {
            pickedFieldIdx = fi;
            fieldPick.querySelectorAll('button').forEach(b => b.style.outline = '');
            btn.style.outline = '2px solid #4cd964';
            grid.innerHTML = '';
            benchAlive.forEach(({ c, i }) => {
                const el = createCardElement(c);
                el.addEventListener('click', async () => {
                    const old = bState.p1.field[fi];
                    bState.p1.field[fi] = c;
                    bState.p1.bench[i] = old;
                    overlay.remove();
                    isSkillMode = false;
                    updateBattleUI();
                    await playBattleSwapFx('p1', fi);
                    document.getElementById('battle-field-log').innerHTML =
                        `🔄 [${old ? old.name : '空'}] ↔ [${c.name}] 交換！`;
                    switchTurn();
                });
                grid.appendChild(el);
            });
        });
        fieldPick.appendChild(btn);
    });

    document.getElementById('swap-cancel').addEventListener('click', () => overlay.remove());
}

// 場＋ベンチ全カードが同じグループかチェック
function isFullTeamSameGroup(player) {
    const allCards = [...player.field, ...player.bench].filter(c => c && isCardAlive(c));
    if (allCards.length <= 1) return false;
    const g = allCards[0].group;
    return allCards.every(c => c.group === g);
}

// 攻撃ダメージにチーム補正を適用
function applyTeamBonus(attacker, baseDmg, player) {
    const u = gameState.currentUser;
    let dmg = baseDmg;
    let log = '';
    // 推し補正1.2倍
    if (u && attacker.group === u.oshiGroup) {
        dmg = Math.floor(dmg * 1.2);
        log += '✨ 推し補正1.2倍！<br>';
    }
    // 全チーム統一補正1.1倍
    if (isFullTeamSameGroup(player)) {
        dmg = Math.floor(dmg * 1.1);
        log += `🤝 全チーム[${attacker.group}]補正1.1倍！<br>`;
    }
    return { dmg, log };
}

async function executePlayerAction(attackerIdx, targetIdx) {
    if (battleFxLocked) return;
    const bState = gameState.battle;
    const attacker = bState.p1.field[attackerIdx];
    const target = bState.p2.field[targetIdx];
    if (!attacker || !target || !isCardAlive(attacker) || !isCardAlive(target)) return;

    battleFxLocked = true;
    let logMsg = '';
    let fxKind = 'attack';
    let skillName = null;
    let actualDmg = 0;

    if (isSkillMode && ['UR','LR'].includes(attacker.rarity) && attacker.skill) {
        const skill = attacker.skill;
        fxKind = 'skill';
        skillName = skill.name;
        logMsg += `🌟 必殺技【${skill.name}】発動！<br>`;
        bState.p1.usedSkills.add(attacker.id);
        isSkillMode = false;

        switch (skill.type) {
            case 'atk1': {
                // 特定の敵1体に固定ダメージ
                const { dmg, log } = applyTeamBonus(attacker, skill.value, bState.p1);
                logMsg += log;
                const sh = target._shield || 0;
                const d = Math.max(0, dmg - sh);
                target._shield = Math.max(0, sh - dmg);
                target.hp -= d; actualDmg = d;
                logMsg += `💥 [${target.name}] に ${d} ダメージ！`;
                break;
            }
            case 'atk2': {
                // 相手バトル場全体に25ダメージ
                logMsg += '💥 相手バトル場全体攻撃！<br>';
                bState.p2.field.forEach(c => {
                    if (!c || !isCardAlive(c)) return;
                    const sh = c._shield || 0;
                    const d = Math.max(0, skill.value - sh);
                    c._shield = Math.max(0, sh - skill.value);
                    c.hp -= d;
                    logMsg += `[${c.name}]に${d}ダメ `;
                });
                actualDmg = skill.value;
                fxKind = 'attack';
                break;
            }
            case 'heal': {
                // 自分バトル場全体を20回復
                logMsg += '💚 自分バトル場全体を回復！<br>';
                bState.p1.field.forEach(c => {
                    if (!c || !isCardAlive(c)) return;
                    const before = c.hp;
                    c.hp = Math.min(c.hp + skill.value, c.maxHp || c.hp + skill.value);
                    logMsg += `[${c.name}]+${c.hp - before} `;
                });
                actualDmg = skill.value; fxKind = 'heal';
                break;
            }
            case 'heal2': {
                // 自分1体を60回復
                const before = attacker.hp;
                attacker.hp += skill.value;
                actualDmg = attacker.hp - before;
                logMsg += `💚 [${attacker.name}]のHPを${actualDmg}回復！`;
                fxKind = 'heal';
                break;
            }
            case 'defense': {
                // 自分バトル場全体にシールド
                bState.p1.field.forEach(c => {
                    if (!c || !isCardAlive(c)) return;
                    c._shield = (c._shield || 0) + skill.value;
                });
                logMsg += `🛡️ 自分バトル場全体にシールド+${skill.value}！(70未満は完全防御)`;
                actualDmg = 0; fxKind = 'defense';
                break;
            }
            case 'revival': {
                // 倒されたカードをHP80で1体復活（キルカウントはそのまま）
                const deadInBench = bState.p1.bench.findIndex(c => c && !isCardAlive(c));
                const deadInField = bState.p1.field.findIndex(c => !c || !isCardAlive(c));
                let revived = false;
                if (deadInBench >= 0) {
                    bState.p1.bench[deadInBench].hp = 80;
                    bState.p1.bench[deadInBench]._shield = 0;
                    logMsg += `✨ [${bState.p1.bench[deadInBench].name}]をHP80で復活！`;
                    revived = true;
                } else if (deadInField >= 0 && bState.p1.field[deadInField]) {
                    bState.p1.field[deadInField].hp = 80;
                    bState.p1.field[deadInField]._shield = 0;
                    logMsg += `✨ [${bState.p1.field[deadInField].name}]をHP80で復活！`;
                    revived = true;
                }
                if (!revived) logMsg += '復活できるカードがいません。';
                actualDmg = 0; fxKind = 'heal';
                break;
            }
            case 'poison': {
                // 毒：相手バトル場全体に毎ターン10ダメージを3ターン付与
                bState.p2.field.forEach(c => {
                    if (!c || !isCardAlive(c)) return;
                    c._poison = (c._poison || 0) + 1;
                });
                logMsg += `☠️ 相手バトル場全体に毒を付与！3ターン毎ターン10ダメージ！`;
                actualDmg = 0; fxKind = 'attack';
                break;
            }
            case 'drain': {
                // 吸収：相手1体にATKダメージ＆そのダメージ分自分を回復
                const { dmg: drainDmg, log: drainLog } = applyTeamBonus(attacker, attacker.atk, bState.p1);
                logMsg += drainLog;
                const drainSh = target._shield || 0;
                const drainActual = Math.max(0, drainDmg - drainSh);
                target._shield = Math.max(0, drainSh - drainDmg);
                target.hp -= drainActual;
                attacker.hp += drainActual;
                actualDmg = drainActual;
                logMsg += `🩸 吸収！[${target.name}]に${drainActual}ダメージ→[${attacker.name}]が${drainActual}回復！`;
                break;
            }
            case 'timelock': {
                // 封印：相手バトル場でHPが最も低い敵を1ターン行動不能に
                const weakest = bState.p2.field
                    .map((c, i) => ({ c, i }))
                    .filter(x => x.c && isCardAlive(x.c))
                    .sort((a, b) => a.c.hp - b.c.hp)[0];
                if (weakest) {
                    weakest.c._sealed = 1;
                    logMsg += `⏳ 封印！[${weakest.c.name}]を次のターン行動不能に！`;
                } else {
                    logMsg += '対象なし';
                }
                actualDmg = 0; fxKind = 'attack';
                break;
            }
            case 'reflect': {
                // 反射：次に受けるダメージを攻撃者に跳ね返すマークを自分全体に付与
                bState.p1.field.forEach(c => {
                    if (!c || !isCardAlive(c)) return;
                    c._reflect = true;
                });
                logMsg += `🪞 反射！次に攻撃してきた敵にダメージを跳ね返す！`;
                actualDmg = 0; fxKind = 'defense';
                break;
            }
            case 'lifelink': {
                // 生命共鳴：自分の場全員のHPを平均値に統一
                const alive = bState.p1.field.filter(isCardAlive);
                if (alive.length > 1) {
                    const avg = Math.floor(alive.reduce((s, c) => s + c.hp, 0) / alive.length);
                    alive.forEach(c => { c.hp = avg; });
                    logMsg += `💫 生命共鳴！場のHP平均${avg}に統一！`;
                } else {
                    logMsg += '効果なし（カードが1体以下）';
                }
                actualDmg = 0; fxKind = 'heal';
                break;
            }
            case 'counter': {
                // カウンター：相手の場で最もHPが高い敵に attacker.atk×2 ダメージ
                const strongest = bState.p2.field
                    .map((c, i) => ({ c, i }))
                    .filter(x => x.c && isCardAlive(x.c))
                    .sort((a, b) => b.c.hp - a.c.hp)[0];
                if (strongest) {
                    const { dmg, log } = applyTeamBonus(attacker, attacker.atk * 2, bState.p1);
                    logMsg += log;
                    const sh = strongest.c._shield || 0;
                    const d = Math.max(0, dmg - sh);
                    strongest.c._shield = Math.max(0, sh - dmg);
                    strongest.c.hp -= d; actualDmg = d;
                    logMsg += `🎯 カウンター！最強の敵[${strongest.c.name}]に${d}ダメージ！`;
                } else {
                    logMsg += '対象なし';
                }
                break;
            }
            case 'encore': {
                // アンコール：このターン終了後、もう1ターン連続行動できる
                bState._encoreTurn = true;
                logMsg += `🎤 アンコール！もう1回行動できる！`;
                actualDmg = 0; fxKind = 'heal';
                break;
            }
            // =========================================
            // 新規17種
            // =========================================
            case 'burst': {
                // 爆発：自分のATK×3の大ダメージを与えるが、自分も自分のATK分のダメージを受ける
                const { dmg: burstDmg, log: burstLog } = applyTeamBonus(attacker, attacker.atk * 3, bState.p1);
                logMsg += burstLog;
                const burstSh = target._shield || 0;
                const burstActual = Math.max(0, burstDmg - burstSh);
                target._shield = Math.max(0, burstSh - burstDmg);
                target.hp -= burstActual;
                attacker.hp -= attacker.atk; // 自分もダメージ
                actualDmg = burstActual;
                logMsg += `💣 爆発！[${target.name}]に${burstActual}ダメージ！でも[${attacker.name}]も${attacker.atk}のダメージ！`;
                break;
            }
            case 'snipe': {
                // 狙撃：相手のベンチ含む全カードの中で最もHPが低いカードに75ダメージ
                const allEnemy = [...bState.p2.field, ...bState.p2.bench].filter(c => c && isCardAlive(c));
                const snipeTarget = allEnemy.sort((a, b) => a.hp - b.hp)[0];
                if (snipeTarget) {
                    snipeTarget.hp -= skill.value;
                    actualDmg = skill.value;
                    logMsg += `🎯 狙撃！最もHPが低い[${snipeTarget.name}]に${skill.value}ダメージ（ベンチも対象）！`;
                }
                break;
            }
            case 'quake': {
                // 地震：相手の場＋ベンチ全体に15ダメージ
                let quakeTargets = [...bState.p2.field, ...bState.p2.bench].filter(c => c && isCardAlive(c));
                quakeTargets.forEach(c => { c.hp -= skill.value; });
                actualDmg = skill.value;
                logMsg += `🌍 地震！相手全員（場＋ベンチ）に${skill.value}ダメージ！`;
                break;
            }
            case 'blizzard': {
                // 吹雪：相手バトル場全体を2ターン凍結（行動不能）
                bState.p2.field.forEach(c => { if (c && isCardAlive(c)) c._sealed = 2; });
                logMsg += `❄️ 吹雪！相手バトル場全体を2ターン凍結！`;
                actualDmg = 0; fxKind = 'attack';
                break;
            }
            case 'curse': {
                // 呪い：相手バトル場全体のATKを半分にする（永続）
                bState.p2.field.forEach(c => { if (c && isCardAlive(c)) c.atk = Math.floor(c.atk / 2); });
                logMsg += `🔮 呪い！相手バトル場全体のATKを半分に！`;
                actualDmg = 0; fxKind = 'attack';
                break;
            }
            case 'swap': {
                // 入替：相手バトル場の先頭とベンチの先頭を強制交換
                if (bState.p2.bench.length > 0 && bState.p2.field.length > 0) {
                    const swapIdx = bState.p2.field.findIndex(c => c && isCardAlive(c));
                    const swapBench = bState.p2.bench.findIndex(c => c && isCardAlive(c));
                    if (swapIdx >= 0 && swapBench >= 0) {
                        [bState.p2.field[swapIdx], bState.p2.bench[swapBench]] = [bState.p2.bench[swapBench], bState.p2.field[swapIdx]];
                        logMsg += `🔀 入替！相手の[${bState.p2.field[swapIdx].name}]を強制的にベンチへ、[${bState.p2.bench[swapBench].name}]が場に！`;
                    }
                } else { logMsg += '入替対象がいません。'; }
                actualDmg = 0; fxKind = 'attack';
                break;
            }
            case 'clone': {
                // 分身：このターン攻撃を2回行う（通常攻撃をもう1回）
                const { dmg: cloneDmg, log: cloneLog } = applyTeamBonus(attacker, attacker.atk, bState.p1);
                logMsg += cloneLog;
                const cloneSh = target._shield || 0;
                const cloneActual = Math.max(0, cloneDmg - cloneSh);
                target._shield = Math.max(0, cloneSh - cloneDmg);
                target.hp -= cloneActual;
                actualDmg = cloneActual;
                logMsg += `👥 分身！[${target.name}]に${cloneActual}の追加攻撃！（計2回攻撃）`;
                break;
            }
            case 'shield_break': {
                // 鎧砕き：相手バトル場全体のシールドを無効化＆ATK分のダメージ
                bState.p2.field.forEach(c => { if (c && isCardAlive(c)) { c._shield = 0; c._reflect = false; } });
                const { dmg: sbDmg } = applyTeamBonus(attacker, attacker.atk, bState.p1);
                const sbSh = target._shield || 0;
                const sbActual = Math.max(0, sbDmg - sbSh);
                target.hp -= sbActual; actualDmg = sbActual;
                logMsg += `⚒️ 鎧砕き！相手の防御を全解除＆[${target.name}]に${sbActual}ダメージ！`;
                break;
            }
            case 'berserker': {
                // 狂戦士：自分のHPが50%以下なら攻撃力2倍、それ以外は1.5倍
                const maxHp = attacker.maxHp || attacker.hp;
                const mult = attacker.hp <= maxHp * 0.5 ? 2.0 : 1.5;
                const { dmg: bsDmg, log: bsLog } = applyTeamBonus(attacker, Math.floor(attacker.atk * mult), bState.p1);
                logMsg += bsLog;
                const bsSh = target._shield || 0;
                const bsActual = Math.max(0, bsDmg - bsSh);
                target._shield = Math.max(0, bsSh - bsDmg);
                target.hp -= bsActual; actualDmg = bsActual;
                logMsg += `😤 狂戦士(${mult}倍)！[${target.name}]に${bsActual}ダメージ！`;
                break;
            }
            case 'last_stand': {
                // 瀕死の一撃：自分のHPが10以下なら150ダメージ、そうでなければ30ダメージ
                const lsDmg = attacker.hp <= 10 ? 150 : 30;
                const lsSh = target._shield || 0;
                const lsActual = Math.max(0, lsDmg - lsSh);
                target._shield = Math.max(0, lsSh - lsDmg);
                target.hp -= lsActual; actualDmg = lsActual;
                logMsg += attacker.hp <= 10
                    ? `💀 瀕死の一撃！[${target.name}]に${lsActual}の大ダメージ！`
                    : `💀 瀕死の一撃（HP十分）[${target.name}]に${lsActual}ダメージ`;
                break;
            }
            case 'sacrifice': {
                // 犠牲：自分を倒す代わりに相手バトル場全体に100ダメージ
                attacker.hp = 0;
                bState.p2.field.forEach(c => { if (c && isCardAlive(c)) c.hp -= skill.value; });
                actualDmg = skill.value;
                logMsg += `💔 犠牲！[${attacker.name}]が自らを犠牲に相手全体に${skill.value}ダメージ！`;
                break;
            }
            case 'chain': {
                // 連鎖：相手バトル場の全カードに順番に攻撃（ダメージが減衰：1体目100%→2体目60%→3体目30%）
                const chainRates = [1.0, 0.6, 0.3];
                let chainLog = '⛓️ 連鎖攻撃！ ';
                bState.p2.field.forEach((c, i) => {
                    if (!c || !isCardAlive(c)) return;
                    const { dmg: cDmg } = applyTeamBonus(attacker, Math.floor(attacker.atk * (chainRates[i] || 0.2)), bState.p1);
                    const cSh = c._shield || 0;
                    const cActual = Math.max(0, cDmg - cSh);
                    c._shield = Math.max(0, cSh - cDmg);
                    c.hp -= cActual;
                    chainLog += `[${c.name}]:${cActual} `;
                });
                logMsg += chainLog; actualDmg = attacker.atk;
                break;
            }
            case 'gravity': {
                // 重力：相手バトル場全体の移動を禁止（ベンチ交換できなくなる）2ターン
                bState.p2._gravityTurn = 2;
                logMsg += `🌑 重力！相手は2ターンベンチ交換不能！`;
                actualDmg = 0; fxKind = 'attack';
                break;
            }
            case 'overload': {
                // オーバーロード：自分の全カードのATKを+10（永続）するが自分全体に10ダメージ
                bState.p1.field.forEach(c => { if (c && isCardAlive(c)) { c.atk += 10; c.hp -= 10; } });
                bState.p1.bench.forEach(c => { if (c && isCardAlive(c)) c.atk += 10; });
                logMsg += `⚡ オーバーロード！自分全カードATK+10！でも場のカードに10ダメージ！`;
                actualDmg = 0; fxKind = 'attack';
                break;
            }
            case 'mirror': {
                // 鏡写し：相手の最後の攻撃ダメージを相手にそのまま返す
                const lastDmg = bState._lastEnemyDmg || 20;
                const mirSh = target._shield || 0;
                const mirActual = Math.max(0, lastDmg - mirSh);
                target._shield = Math.max(0, mirSh - lastDmg);
                target.hp -= mirActual; actualDmg = mirActual;
                logMsg += `🪞 鏡写し！相手の前回ダメージ${lastDmg}を[${target.name}]に返した！`;
                break;
            }
            case 'regen': {
                // 再生：自分のバトル場全体に毎ターン+15HPの再生効果を3ターン付与
                bState.p1.field.forEach(c => { if (c && isCardAlive(c)) c._regen = (c._regen || 0) + 1; });
                logMsg += `🌿 再生！自分バトル場全体に3ターン間毎ターン15HP回復！`;
                actualDmg = 0; fxKind = 'heal';
                break;
            }
            case 'rampage': {
                // 暴走：ATK×2で相手全体を攻撃するが対象がランダム（自分の場に当たることも）
                const allTargets = [
                    ...bState.p2.field.filter(c => c && isCardAlive(c)).map(c => ({ c, side: 'enemy' })),
                    ...bState.p1.field.filter(c => c && isCardAlive(c)).map(c => ({ c, side: 'ally' }))
                ];
                if (allTargets.length > 0) {
                    const { dmg: rDmg } = applyTeamBonus(attacker, attacker.atk * 2, bState.p1);
                    const rTarget = allTargets[Math.floor(Math.random() * allTargets.length)];
                    const rSh = rTarget.c._shield || 0;
                    const rActual = Math.max(0, rDmg - rSh);
                    rTarget.c._shield = Math.max(0, rSh - rDmg);
                    rTarget.c.hp -= rActual; actualDmg = rActual;
                    logMsg += `🌀 暴走！${rTarget.side === 'ally' ? '⚠️味方' : '敵'}[${rTarget.c.name}]に${rActual}ダメージ！`;
                }
                break;
            }
            default: {
                // 旧来の attack/heal/defense フォールバック
                if (skill.type === 'attack') {
                    const { dmg, log } = applyTeamBonus(attacker, skill.value, bState.p1);
                    logMsg += log;
                    const sh = target._shield || 0;
                    const d = Math.max(0, dmg - sh);
                    target._shield = Math.max(0, sh - dmg); target.hp -= d; actualDmg = d;
                    logMsg += `💥 [${target.name}] に ${d} ダメージ！`;
                } else if (skill.type === 'heal') {
                    attacker.hp += skill.value; actualDmg = skill.value; fxKind = 'heal';
                    logMsg += `💚 HP+${skill.value}！`;
                } else if (skill.type === 'defense') {
                    attacker._shield = (attacker._shield || 0) + skill.value; actualDmg = 0;
                    logMsg += `🛡️ シールド+${skill.value}！`;
                }
            }
        }
    } else {
        // 通常攻撃
        isSkillMode = false;
        const { dmg, log } = applyTeamBonus(attacker, attacker.atk, bState.p1);
        logMsg += log;
        const sh = target._shield || 0;
        actualDmg = Math.max(0, dmg - sh);
        target._shield = Math.max(0, sh - dmg);

        // 反射チェック
        if (target._reflect) {
            delete target._reflect;
            attacker.hp -= actualDmg;
            logMsg += `🪞 反射！${actualDmg}ダメージが[${attacker.name}]に跳ね返った！`;
            actualDmg = 0;
        } else {
            target.hp -= actualDmg;
            logMsg += `💥 [${attacker.name}] → [${target.name}] に ${actualDmg} ダメージ！`;
        }
        bState._lastPlayerDmg = actualDmg; // mirror用に記録
    }

    const fxTargetPlayer = fxKind === 'heal' || fxKind === 'defense' ? 'p1' : 'p2';
    const fxTargetIdx = fxKind === 'heal' || fxKind === 'defense' ? attackerIdx : targetIdx;

    await playBattleActionFx({
        attackerPlayer: 'p1', attackerIdx,
        targetPlayer: fxTargetPlayer, targetIdx: fxTargetIdx,
        damage: actualDmg, kind: fxKind,
        bannerText: skillName ? `✨ ${skillName}` : fxKind === 'heal' ? '💚 回復！' : fxKind === 'defense' ? '🛡️ 防御！' : '⚔️ 攻撃！',
        skillName
    });

    document.getElementById('battle-field-log').innerHTML = logMsg;
    bState.attackerFieldIdx = null;
    bState.actionStep = null;
    processFaintForPlayer(bState.p2, true);
    processFaintForPlayer(bState.p1, false);
    battleFxLocked = false;
    if (checkBattleEnd()) return;

    // アンコール処理：もう1ターン自分のターンを続ける
    if (bState._encoreTurn) {
        bState._encoreTurn = false;
        bState.actionStep = 'pick_attacker';
        document.getElementById('battle-field-log').innerHTML += '<br>🎤 アンコール！もう1回攻撃どうぞ！';
        updateBattleUI();
        return;
    }

    switchTurn();
}

// 3本先取: 倒したカード数をカウントし3体倒したら勝利
const KILLS_TO_WIN = 3;

function processFaintForPlayer(player, isEnemy) {
    player.field.forEach((card, idx) => {
        if (card && card.hp <= 0) {
            const name = card.name;
            // キルカウント加算（isEnemy=trueならp1がキル、falseならp2がキル）
            const bState = gameState.battle;
            if (isEnemy) {
                bState.p1Kills = (bState.p1Kills || 0) + 1;
            } else {
                bState.p2Kills = (bState.p2Kills || 0) + 1;
            }
            if (promoteBenchToField(player, idx)) {
                document.getElementById('battle-field-log').innerHTML +=
                    `<br>🏃 [${name}] が倒れ、[${player.field[idx].name}] が繰り上がり！`;
            } else {
                player.field[idx] = null;
            }
        }
    });
}

function checkBattleEnd() {
    const bState = gameState.battle;
    const p1Kills = bState.p1Kills || 0;
    const p2Kills = bState.p2Kills || 0;

    // 3本先取チェック
    const p1Won = p1Kills >= KILLS_TO_WIN || !playerHasAnyCard(bState.p2);
    const p2Won = p2Kills >= KILLS_TO_WIN || !playerHasAnyCard(bState.p1);

    if (p1Won) {
        bState.phase = 'ended';
        const u = gameState.currentUser;
        const today = new Date().toDateString();
        if (u && u.lastBattleMissionDate !== today) {
            u.lastBattleMissionDate = today;
            // packStock に直接加算（上限MAX_PACKS）
            u.packStock = Math.min((u.packStock ?? 0) + 1, MAX_PACKS);
            saveUserData();
            alert(`🎉 勝利！(${p1Kills}体撃破)\nデイリーミッション達成！パックを1個ストックに追加しました！`);
        } else {
            alert(`🎉 あなたの勝利！(${p1Kills}体撃破)`);
        }
        resetBattleScreen();
        return true;
    }
    if (p2Won) {
        bState.phase = 'ended';
        alert(`😭 ライバルに敗北しました...(相手${p2Kills}体撃破)`);
        resetBattleScreen();
        return true;
    }
    return false;
}

function resetBattleScreen() {
    clearCpuTurnTimer();
    battleFxLocked = false;
    document.getElementById('battle-field').classList.add('hidden');
    initBattleSetup();
}

async function executeCPUTurn() {
    if (battleFxLocked) return;
    const bState = gameState.battle;
    const atkIndices = getAliveFieldIndices(bState.p2.field);
    const tgtIndices = getAliveFieldIndices(bState.p1.field);
    if (atkIndices.length === 0 || tgtIndices.length === 0) {
        switchTurn();
        return;
    }

    battleFxLocked = true;
    const ai = atkIndices[Math.floor(Math.random() * atkIndices.length)];
    const ti = tgtIndices[Math.floor(Math.random() * tgtIndices.length)];
    const attacker = bState.p2.field[ai];
    const target = bState.p1.field[ti];

    let damage = attacker.atk;
    let logMsg = '';
    let fxKind = 'attack';
    let skillName = null;
    const useSkill = Math.random() < 0.25 && ['UR','LR'].includes(attacker.rarity) && attacker.skill && !bState.p2.usedSkills.has(attacker.id);
    if (useSkill) {
        const skill = attacker.skill;
        fxKind = 'skill'; skillName = skill.name;
        bState.p2.usedSkills.add(attacker.id);
        logMsg += `👑 CPU必殺技【${skill.name}】！<br>`;
        switch (skill.type) {
            case 'atk1': damage = skill.value; break;
            case 'atk2':
                bState.p1.field.forEach(c => { if(c&&isCardAlive(c)){const sh=c._shield||0;const d=Math.max(0,skill.value-sh);c._shield=Math.max(0,sh-skill.value);c.hp-=d;} });
                damage = 0; break;
            case 'heal':
                bState.p2.field.forEach(c => { if(c&&isCardAlive(c))c.hp+=skill.value; });
                damage = 0; fxKind='heal'; break;
            case 'heal2': attacker.hp+=skill.value; damage=0; fxKind='heal'; break;
            case 'defense':
                bState.p2.field.forEach(c => { if(c&&isCardAlive(c))c._shield=(c._shield||0)+skill.value; });
                damage = 0; break;
            case 'revival': {
                const dead=bState.p2.bench.findIndex(c=>c&&!isCardAlive(c));
                if(dead>=0){bState.p2.bench[dead].hp=80;bState.p2.bench[dead]._shield=0;}
                damage=0; fxKind='heal'; break;
            }
            case 'poison':
                bState.p1.field.forEach(c=>{if(c&&isCardAlive(c))c._poison=(c._poison||0)+1;});
                damage=0; break;
            case 'drain': {
                const d=attacker.atk; const sh=target._shield||0; const actual=Math.max(0,d-sh);
                target._shield=Math.max(0,sh-d); target.hp-=actual; attacker.hp+=actual; damage=actual; break;
            }
            case 'timelock': {
                const w=bState.p1.field.map((c,i)=>({c,i})).filter(x=>x.c&&isCardAlive(x.c)).sort((a,b)=>a.c.hp-b.c.hp)[0];
                if(w) w.c._sealed=1; damage=0; break;
            }
            case 'reflect':
                bState.p2.field.forEach(c=>{if(c&&isCardAlive(c))c._reflect=true;});
                damage=0; break;
            case 'lifelink': {
                const alive=bState.p2.field.filter(isCardAlive);
                if(alive.length>1){const avg=Math.floor(alive.reduce((s,c)=>s+c.hp,0)/alive.length);alive.forEach(c=>c.hp=avg);}
                damage=0; fxKind='heal'; break;
            }
            case 'counter': {
                const strongest=bState.p1.field.map((c,i)=>({c,i})).filter(x=>x.c&&isCardAlive(x.c)).sort((a,b)=>b.c.hp-a.c.hp)[0];
                if(strongest){const d=attacker.atk*2;const sh=strongest.c._shield||0;const actual=Math.max(0,d-sh);strongest.c._shield=Math.max(0,sh-d);strongest.c.hp-=actual;damage=actual;}
                else damage=0; break;
            }
            case 'encore': bState._cpuEncoreTurn=true; damage=0; fxKind='heal'; break;
            // 新規17種（CPU版）
            case 'burst': { const bd=attacker.atk*3; const bsh=target._shield||0; const ba=Math.max(0,bd-bsh); target._shield=Math.max(0,bsh-bd); target.hp-=ba; attacker.hp-=attacker.atk; damage=ba; break; }
            case 'snipe': { const sa=[...bState.p1.field,...bState.p1.bench].filter(c=>c&&isCardAlive(c)).sort((a,b)=>a.hp-b.hp)[0]; if(sa){sa.hp-=skill.value;damage=skill.value;} break; }
            case 'quake': { [...bState.p1.field,...bState.p1.bench].filter(c=>c&&isCardAlive(c)).forEach(c=>c.hp-=skill.value); damage=0; break; }
            case 'blizzard': { bState.p1.field.forEach(c=>{if(c&&isCardAlive(c))c._sealed=2;}); damage=0; break; }
            case 'curse': { bState.p1.field.forEach(c=>{if(c&&isCardAlive(c))c.atk=Math.floor(c.atk/2);}); damage=0; break; }
            case 'swap': { if(bState.p1.bench.length>0){const si=bState.p1.field.findIndex(c=>c&&isCardAlive(c));const sb=bState.p1.bench.findIndex(c=>c&&isCardAlive(c));if(si>=0&&sb>=0)[bState.p1.field[si],bState.p1.bench[sb]]=[bState.p1.bench[sb],bState.p1.field[si]];} damage=0; break; }
            case 'clone': { const cs=target._shield||0; const ca=Math.max(0,attacker.atk-cs); target._shield=Math.max(0,cs-attacker.atk); target.hp-=ca; damage=ca; break; }
            case 'shield_break': { bState.p1.field.forEach(c=>{if(c&&isCardAlive(c)){c._shield=0;c._reflect=false;}}); const sbsh=target._shield||0; const sba=Math.max(0,attacker.atk-sbsh); target.hp-=sba; damage=sba; break; }
            case 'berserker': { const maxhp=attacker.maxHp||attacker.hp; const mult=attacker.hp<=maxhp*0.5?2.0:1.5; const berd=Math.floor(attacker.atk*mult); const bersh=target._shield||0; const bera=Math.max(0,berd-bersh); target._shield=Math.max(0,bersh-berd); target.hp-=bera; damage=bera; break; }
            case 'last_stand': { const lsd=attacker.hp<=10?150:30; const lssh=target._shield||0; const lsa=Math.max(0,lsd-lssh); target._shield=Math.max(0,lssh-lsd); target.hp-=lsa; damage=lsa; break; }
            case 'sacrifice': { attacker.hp=0; bState.p1.field.forEach(c=>{if(c&&isCardAlive(c))c.hp-=skill.value;}); damage=skill.value; break; }
            case 'chain': { const cr=[1.0,0.6,0.3]; bState.p1.field.forEach((c,i)=>{if(!c||!isCardAlive(c))return; const cd=Math.floor(attacker.atk*(cr[i]||0.2)); const csh=c._shield||0; const ca=Math.max(0,cd-csh); c._shield=Math.max(0,csh-cd); c.hp-=ca;}); damage=attacker.atk; break; }
            case 'gravity': { bState.p1._gravityTurn=2; damage=0; break; }
            case 'overload': { bState.p2.field.forEach(c=>{if(c&&isCardAlive(c)){c.atk+=10;c.hp-=10;}}); bState.p2.bench.forEach(c=>{if(c&&isCardAlive(c))c.atk+=10;}); damage=0; break; }
            case 'mirror': { const md=bState._lastPlayerDmg||20; const msh=target._shield||0; const ma=Math.max(0,md-msh); target._shield=Math.max(0,msh-md); target.hp-=ma; damage=ma; break; }
            case 'regen': { bState.p2.field.forEach(c=>{if(c&&isCardAlive(c))c._regen=(c._regen||0)+1;}); damage=0; fxKind='heal'; break; }
            case 'rampage': { const rall=[...bState.p1.field,...bState.p2.field].filter(c=>c&&isCardAlive(c)); if(rall.length>0){const rt=rall[Math.floor(Math.random()*rall.length)]; const rd=attacker.atk*2; const rsh=rt._shield||0; const ra=Math.max(0,rd-rsh); rt._shield=Math.max(0,rsh-rd); rt.hp-=ra; damage=ra;} break; }
            default: if(skill.type==='attack')damage=skill.value; else damage=Math.floor(damage*1.5);
        }
    }

    // CPU通常攻撃にもチーム補正
    if (damage > 0 && !useSkill) {
        if (isFullTeamSameGroup(bState.p2)) damage = Math.floor(damage * 1.1);
    }

    if (Math.random() < 0.2) {
        const benchIdx = bState.p2.bench.findIndex(isCardAlive);
        const fieldIdx = bState.p2.field.findIndex(c => !c || !isCardAlive(c));
        const swapField = fieldIdx >= 0 ? fieldIdx : 0;
        if (benchIdx >= 0) {
            const old = bState.p2.field[swapField];
            bState.p2.field[swapField] = bState.p2.bench[benchIdx];
            bState.p2.bench[benchIdx] = old;
            renderBattleField();
            await playBattleSwapFx('p2', swapField);
            document.getElementById('battle-field-log').innerHTML = `🔄 CPUがベンチと交換！`;
            battleFxLocked = false;
            switchTurn();
            return;
        }
    }

    const shield = target._shield || 0;
    let actualDmg = Math.max(0, damage - shield);
    target._shield = Math.max(0, shield - damage);

    // 封印チェック（封印中のカードは攻撃できない）
    if (attacker._sealed && attacker._sealed > 0) {
        attacker._sealed--;
        logMsg += `⏳ [${attacker.name}]は封印中で行動不能！<br>`;
        battleFxLocked = false;
        switchTurn();
        return;
    }

    // 反射チェック（攻撃対象に反射マークがあればダメージを跳ね返す）
    if (target._reflect) {
        delete target._reflect;
        attacker.hp -= actualDmg;
        logMsg += `🪞 反射！${actualDmg}ダメージが[${attacker.name}]に跳ね返った！<br>`;
        actualDmg = 0;
    } else {
        target.hp -= actualDmg;
    }
    bState._lastEnemyDmg = actualDmg; // mirror用に記録

    logMsg += `🤖 [${attacker.name}] → [${target.name}] に ${actualDmg} ダメージ！`;

    await playBattleActionFx({
        attackerPlayer: 'p2',
        attackerIdx: ai,
        targetPlayer: 'p1',
        targetIdx: ti,
        damage: actualDmg,
        kind: fxKind,
        bannerText: fxKind === 'skill' ? `👑 ${skillName}` : '🤖 相手の攻撃！',
        skillName
    });

    document.getElementById('battle-field-log').innerHTML = logMsg;
    processFaintForPlayer(bState.p1, false);  // p1が倒れた = p2のキル
    processFaintForPlayer(bState.p2, true);   // p2が倒れた = p1のキル
    battleFxLocked = false;
    if (checkBattleEnd()) return;
    switchTurn();
}

function switchTurn() {
    const bState = gameState.battle;
    bState.turn = bState.turn === 'p1' ? 'p2' : 'p1';
    isSkillMode = false;

    // 毒ダメージ処理（p1ターン開始時 = 1ラウンド完了）
    if (bState.turn === 'p1') {
        bState.attackerFieldIdx = null;
        bState.actionStep = 'pick_attacker';
        let poisonLog = '';
        // 毒ダメージ・再生・重力カウントダウン
        [...bState.p1.field, ...bState.p2.field].forEach(c => {
            if (!c || !isCardAlive(c)) return;
            // 毒
            if (c._poison) {
                c.hp -= 10; c._poison--; if (c._poison <= 0) delete c._poison;
                poisonLog += `☠️ [${c.name}]毒ダメ10 `;
            }
            // 再生
            if (c._regen) {
                c.hp += 15; c._regen--; if (c._regen <= 0) delete c._regen;
                poisonLog += `🌿 [${c.name}]再生+15HP `;
            }
        });
        // 重力カウントダウン
        if (bState.p1._gravityTurn > 0) bState.p1._gravityTurn--;
        if (bState.p2._gravityTurn > 0) bState.p2._gravityTurn++; // CPU側は使わない
        if (poisonLog) {
            const logEl = document.getElementById('battle-field-log');
            if (logEl) logEl.innerHTML += `<br>${poisonLog}`;
            processFaintForPlayer(bState.p2, true);
            processFaintForPlayer(bState.p1, false);
            if (checkBattleEnd()) return;
        }
    }

    updateBattleUI();
}

// ==========================================
// 10. オンライン1vs1（Firebase Realtime Database）
// ==========================================
const FIREBASE_URL = 'https://kstar-game-default-rtdb.firebaseio.com';

// Firebase REST API ラッパー
async function fbGet(path) {
    try {
        const res = await fetch(`${FIREBASE_URL}/${path}.json`);
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}
async function fbSet(path, data) {
    try {
        await fetch(`${FIREBASE_URL}/${path}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch(e) { console.error('fbSet error:', e); }
}
async function fbUpdate(path, data) {
    try {
        await fetch(`${FIREBASE_URL}/${path}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch(e) { console.error('fbUpdate error:', e); }
}
async function fbDelete(path) {
    try {
        await fetch(`${FIREBASE_URL}/${path}.json`, { method: 'DELETE' });
    } catch(e) { console.error('fbDelete error:', e); }
}

function serializeBattle(player) {
    return { field: player.field, bench: player.bench };
}

function startOnlineMatchmaking(isHost) {
    const roomInputEl = document.getElementById('online-room-input');
    if (!roomInputEl) return;
    const roomInput = roomInputEl.value.trim();
    if (!roomInput || !/^\d{4}$/.test(roomInput)) {
        return alert('4桁の数字で部屋番号を入力してください。');
    }

    const u = gameState.currentUser;
    const myFullDeck = u.deck.map(id => u.collection.find(c => c.id === id)).filter(Boolean);
    if (myFullDeck.length < BATTLE_DECK_SIZE) {
        alert(`オンライン対戦にはデッキ${BATTLE_DECK_SIZE}枚以上が必要です。`);
        return;
    }

    // GUESTは先に部屋確認
    if (!isHost) {
        fbGet(`rooms/${roomInput}`).then(existing => {
            if (!existing || !existing.hostConnected) {
                alert('部屋が見つかりません。\nHOSTに先に「部屋作成」してもらい、同じ4桁を入力してください。');
                return;
            }
            if (existing.guestConnected) {
                alert('この部屋はすでに満員です。別の部屋番号を使ってください。');
                return;
            }
            _doMatchmaking(isHost, roomInput, myFullDeck);
        });
    } else {
        _doMatchmaking(isHost, roomInput, myFullDeck);
    }
}

function _doMatchmaking(isHost, roomInput, myFullDeck) {
    showBattleFormationSelect(myFullDeck, async (formation) => {
        const b = gameState.onlineBattle;
        b.roomNo = roomInput;
        b.role = isHost ? 'HOST' : 'GUEST';
        b.status = 'waiting';
        b.myFormation = formation;
        b.usedSkills = new Set();
        b.myKills = 0;
        b.enemyKills = 0;
        b.skillModeOnline = false;

        const u = gameState.currentUser;
        const battlePayload = serializeBattle({ field: formation.field, bench: formation.bench });
        const path = `rooms/${roomInput}`;

        if (isHost) {
            await fbSet(path, {
                roomNo: roomInput,
                hostConnected: true,
                guestConnected: false,
                hostData: { name: u.nickname, icon: u.icon || '🎤', battle: battlePayload },
                guestData: null,
                turn: 'HOST',
                actionSignal: null,
                createdAt: Date.now()
            });
        } else {
            await fbUpdate(path, {
                guestConnected: true,
                'guestData/name': u.nickname,
                'guestData/icon': u.icon || '🎤',
                'guestData/battle': battlePayload
            });
        }

        const crBtn = document.getElementById('btn-create-room');
        const jrBtn = document.getElementById('btn-join-room');
        if (crBtn) crBtn.disabled = true;
        if (jrBtn) jrBtn.disabled = true;
        document.getElementById('online-wait-status').classList.remove('hidden');

        // キャンセルボタン
        const oldCancel = document.getElementById('btn-cancel-room');
        if (oldCancel) {
            const freshCancel = oldCancel.cloneNode(true);
            oldCancel.parentNode.replaceChild(freshCancel, oldCancel);
            freshCancel.addEventListener('click', async () => {
                clearInterval(onlinePollingInterval);
                if (isHost) await fbDelete(path);
                initBattleSetup();
            });
        }

        onlinePollingInterval = setInterval(() => pollOnlineRoomStatus(path), 800);
    });
}

function loadOnlineBattleState(roomData) {
    const b = gameState.onlineBattle;
    const hostB = roomData.hostData.battle;
    const guestB = roomData.guestData.battle;

    b.p1Name = roomData.hostData.name;
    b.p1Icon = roomData.hostData.icon || '👑';
    b.p2Name = roomData.guestData.name;
    b.p2Icon = roomData.guestData.icon || '👑';
    b.turn = roomData.turn;

    if (b.role === 'HOST') {
        b.myField   = JSON.parse(JSON.stringify(hostB.field));
        b.myBench   = JSON.parse(JSON.stringify(hostB.bench || []));
        b.enemyField = JSON.parse(JSON.stringify(guestB.field));
        b.enemyBench = JSON.parse(JSON.stringify(guestB.bench || []));
    } else {
        b.myField   = JSON.parse(JSON.stringify(guestB.field));
        b.myBench   = JSON.parse(JSON.stringify(guestB.bench || []));
        b.enemyField = JSON.parse(JSON.stringify(hostB.field));
        b.enemyBench = JSON.parse(JSON.stringify(hostB.bench || []));
    }
    b.attackerFieldIdx = null;
    b.actionStep = 'pick_attacker';
}

async function syncOnlineBattleToRoom(path) {
    const b = gameState.onlineBattle;
    let payload;
    if (b.role === 'HOST') {
        payload = { 'hostData/battle': serializeBattle({ field: b.myField, bench: b.myBench }) };
    } else {
        payload = { 'guestData/battle': serializeBattle({ field: b.myField, bench: b.myBench }) };
    }
    await fbUpdate(path, payload);
}

async function pollOnlineRoomStatus(path) {
    const roomData = await fbGet(path);
    const b = gameState.onlineBattle;
    if (!roomData) return;

    const logEl = document.getElementById('room-info-log');
    if (logEl) logEl.innerHTML = `部屋 <b>${b.roomNo}</b> で待機中... [${b.role}]`;

    if (b.status === 'waiting' && roomData.hostConnected && roomData.guestConnected && roomData.guestData?.battle) {
        b.status = 'playing';
        clearInterval(onlinePollingInterval);
        loadOnlineBattleState(roomData);
        document.getElementById('battle-setup-zone').classList.add('hidden');
        document.getElementById('battle-field').classList.remove('hidden');
        document.getElementById('battle-field-log').innerHTML = '🌐 マッチング成立！バトル開始！';
        updateOnlineBattleUI();
        onlinePollingInterval = setInterval(() => listenOnlineActions(path), 300);
    }
}

function onlinePlayerAlive(field, bench) {
    return [...(field||[]), ...(bench||[])].some(c => c && isCardAlive(c));
}

function updateOnlineBattleUI() {
    const b = gameState.onlineBattle;
    const isMyTurn = b.turn === b.role;

    // フィールド描画
    renderOnlineSlotsRow('p2-field', b.enemyField, false, false);
    renderOnlineSlotsRow('p2-bench', b.enemyBench, false, false);
    renderOnlineSlotsRow('p1-field', b.myField, isMyTurn && b.actionStep === 'pick_target', true);
    renderOnlineSlotsRow('p1-bench', b.myBench, false, false);

    const n1 = document.getElementById('bf-p1-name');
    const n2 = document.getElementById('bf-p2-name');
    if (n1) n1.textContent = `${b.role==='HOST'?b.p1Icon:b.p2Icon} ${b.role==='HOST'?b.p1Name:b.p2Name}`;
    if (n2) n2.textContent = `${b.role==='HOST'?b.p2Icon:b.p1Icon} ${b.role==='HOST'?b.p2Name:b.p1Name}`;

    const az = document.getElementById('battle-actions');
    if (!az) return;
    az.innerHTML = '';

    if (!isMyTurn) {
        az.innerHTML = `<p style="text-align:center;color:#aaa;font-size:12px;">⌛ 相手のターンを待っています...</p>`;
        return;
    }

    if (b.actionStep === 'pick_attacker') {
        az.innerHTML = `<p style="text-align:center;color:#4cd964;font-size:12px;font-weight:bold;">攻撃カードをタップしてください</p>`;
    } else if (b.actionStep === 'pick_target') {
        const atk = b.myField[b.attackerFieldIdx];
        az.innerHTML = `<p style="text-align:center;color:#ff477e;font-size:12px;font-weight:bold;">攻撃対象をタップ（${atk ? atk.name : ''}）</p>`;

        // UR必殺技ボタン
        if (atk && ['UR','LR'].includes(atk.rarity) && atk.skill) {
            if (!b.usedSkills) b.usedSkills = new Set();
            if (!b.usedSkills.has(atk.id)) {
                const skillBtn = document.createElement('button');
                skillBtn.textContent = `✨ 必殺技: ${atk.skill.name}`;
                skillBtn.style.cssText = 'background:linear-gradient(45deg,#9b59b6,#8e44ad);margin-top:6px;';
                skillBtn.addEventListener('click', () => {
                    b.skillModeOnline = true;
                    document.getElementById('battle-field-log').innerHTML = `🌟 必殺技「${atk.skill.name}」選択！対象をタップ！`;
                });
                az.appendChild(skillBtn);
            }
        }

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '攻撃者を選び直す';
        cancelBtn.className = 'btn-secondary';
        cancelBtn.style.marginTop = '6px';
        cancelBtn.addEventListener('click', () => {
            b.attackerFieldIdx = null;
            b.actionStep = 'pick_attacker';
            b.skillModeOnline = false;
            updateOnlineBattleUI();
        });
        az.appendChild(cancelBtn);
    }
}

function renderOnlineSlotsRow(elId, cards, isTargetable, isAttacker) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = '';
    const b = gameState.onlineBattle;
    (cards || []).forEach((card, idx) => {
        if (!card) return;
        const cardEl = createCardElement(card, { showHp: true });
        addLongPress(cardEl, () => showGachaCardDetail(card, document.body));
        if (isAttacker && b.actionStep === 'pick_attacker' && isCardAlive(card)) {
            cardEl.style.cursor = 'pointer';
            cardEl.addEventListener('click', () => {
                b.attackerFieldIdx = idx;
                b.actionStep = 'pick_target';
                updateOnlineBattleUI();
            });
        }
        if (isTargetable && isCardAlive(card)) {
            cardEl.style.cursor = 'pointer';
            cardEl.classList.add('targetable');
            cardEl.addEventListener('click', () => sendOnlineAttack(b.attackerFieldIdx, idx));
        }
        if (!isCardAlive(card)) cardEl.style.opacity = '0.35';
        el.appendChild(cardEl);
    });
}

async function sendOnlineAttack(attackerIdx, targetIdx) {
    if (battleFxLocked) return;
    const b = gameState.onlineBattle;
    const path = `rooms/${b.roomNo}`;
    const attacker = b.myField[attackerIdx];
    const target = b.enemyField[targetIdx];
    if (!attacker || !target || !isCardAlive(attacker) || !isCardAlive(target)) return;

    battleFxLocked = true;
    let damage = attacker.atk;
    let logMsg = '';
    let fxKind = 'attack';
    let skillName = null;

    const u = gameState.currentUser;
    if (u && attacker.group === u.oshiGroup) { damage = Math.floor(damage * 1.2); logMsg += '✨ 推し補正！<br>'; }

    // 必殺技処理
    if (b.skillModeOnline && ['UR','LR'].includes(attacker.rarity) && attacker.skill) {
        const skill = attacker.skill;
        fxKind = 'skill'; skillName = skill.name;
        if (!b.usedSkills) b.usedSkills = new Set();
        b.usedSkills.add(attacker.id);
        logMsg += `🌟 必殺技【${skill.name}】！<br>`;
        switch (skill.type) {
            case 'atk1': damage = skill.value; break;
            case 'atk2': b.enemyField.forEach(c=>{if(c&&isCardAlive(c)){const sh=c._shield||0;const d=Math.max(0,skill.value-sh);c._shield=Math.max(0,sh-skill.value);c.hp-=d;}}); damage=0; break;
            case 'heal': b.myField.forEach(c=>{if(c&&isCardAlive(c))c.hp+=skill.value;}); damage=0; fxKind='heal'; break;
            case 'heal2': attacker.hp+=skill.value; damage=0; fxKind='heal'; break;
            case 'defense': b.myField.forEach(c=>{if(c&&isCardAlive(c))c._shield=(c._shield||0)+skill.value;}); damage=0; break;
            case 'revival': { const dead=b.myBench.findIndex(c=>c&&!isCardAlive(c)); if(dead>=0){b.myBench[dead].hp=80;b.myBench[dead]._shield=0;} damage=0; fxKind='heal'; break; }
            case 'poison': b.enemyField.forEach(c=>{if(c&&isCardAlive(c))c._poison=(c._poison||0)+1;}); damage=0; break;
            case 'drain': { const sh=target._shield||0; const a=Math.max(0,damage-sh); target._shield=Math.max(0,sh-damage); target.hp-=a; attacker.hp+=a; damage=a; break; }
            case 'timelock': { const w=b.enemyField.map((c,i)=>({c,i})).filter(x=>x.c&&isCardAlive(x.c)).sort((a,b)=>a.c.hp-b.c.hp)[0]; if(w)w.c._sealed=1; damage=0; break; }
            case 'reflect': b.myField.forEach(c=>{if(c&&isCardAlive(c))c._reflect=true;}); damage=0; break;
            case 'counter': { const s=b.enemyField.map((c,i)=>({c,i})).filter(x=>x.c&&isCardAlive(x.c)).sort((a,b)=>b.c.hp-a.c.hp)[0]; if(s){const sh=s.c._shield||0;const a=Math.max(0,attacker.atk*2-sh);s.c._shield=Math.max(0,sh-attacker.atk*2);s.c.hp-=a;damage=a;} break; }
            default: damage = skill.value || attacker.atk;
        }
        b.skillModeOnline = false;
    }

    if (damage > 0) {
        if (target._reflect) { delete target._reflect; attacker.hp -= damage; logMsg += `🪞 反射！${damage}ダメが返った！`; damage = 0; }
        else { const sh = target._shield||0; const a = Math.max(0,damage-sh); target._shield=Math.max(0,sh-damage); target.hp -= a; damage = a; }
        if (damage > 0) logMsg += `💥 [${attacker.name}]→[${target.name}]に${damage}ダメ！`;
    }

    document.getElementById('battle-field-log').innerHTML = logMsg;

    // Firebaseに書き込み
    const newTurn = b.role === 'HOST' ? 'GUEST' : 'HOST';
    const updateData = {
        turn: newTurn,
        actionSignal: {
            sender: b.role,
            log: logMsg,
            timestamp: Date.now()
        }
    };
    if (b.role === 'HOST') updateData['hostData/battle'] = serializeBattle({ field: b.myField, bench: b.myBench });
    else updateData['guestData/battle'] = serializeBattle({ field: b.myField, bench: b.myBench });

    // 相手のフィールドも書き込む
    if (b.role === 'HOST') updateData['guestData/battle'] = serializeBattle({ field: b.enemyField, bench: b.enemyBench });
    else updateData['hostData/battle'] = serializeBattle({ field: b.enemyField, bench: b.enemyBench });

    await fbUpdate(path, updateData);
    b.turn = newTurn;
    b.attackerFieldIdx = null;
    b.actionStep = null;
    battleFxLocked = false;
    checkOnlineFaint(path);
    updateOnlineBattleUI();
}

async function listenOnlineActions(path) {
    const roomData = await fbGet(path);
    if (!roomData) return;
    const b = gameState.onlineBattle;

    // 同じ actionSignal を2回処理しない
    const sigTs = roomData.actionSignal?.timestamp || 0;
    if (sigTs && sigTs === b._lastProcessedSignalTs) return;

    // 相手のターンから自分のターンに変わった
    if (roomData.turn === b.role && b.turn !== b.role) {
        b.turn = b.role;
        if (sigTs) b._lastProcessedSignalTs = sigTs;

        // 最新データで状態更新
        const hostB = roomData.hostData?.battle;
        const guestB = roomData.guestData?.battle;
        if (b.role === 'HOST') {
            b.myField    = JSON.parse(JSON.stringify(hostB?.field  || b.myField));
            b.myBench    = JSON.parse(JSON.stringify(hostB?.bench  || b.myBench));
            b.enemyField = JSON.parse(JSON.stringify(guestB?.field || b.enemyField));
            b.enemyBench = JSON.parse(JSON.stringify(guestB?.bench || b.enemyBench));
        } else {
            b.myField    = JSON.parse(JSON.stringify(guestB?.field || b.myField));
            b.myBench    = JSON.parse(JSON.stringify(guestB?.bench || b.myBench));
            b.enemyField = JSON.parse(JSON.stringify(hostB?.field  || b.enemyField));
            b.enemyBench = JSON.parse(JSON.stringify(hostB?.bench  || b.enemyBench));
        }
        if (roomData.actionSignal?.log) {
            document.getElementById('battle-field-log').innerHTML = '⚔️ 相手: ' + roomData.actionSignal.log;
        }
        b.attackerFieldIdx = null;
        b.actionStep = 'pick_attacker';
        checkOnlineFaint(path);
        updateOnlineBattleUI();
    }
}

function checkOnlineFaint(path) {
    const b = gameState.onlineBattle;
    if (!b.myKills) b.myKills = 0;
    if (!b.enemyKills) b.enemyKills = 0;

    b.enemyField.forEach((card, idx) => {
        if (card && !isCardAlive(card)) {
            b.myKills++;
            const bench = b.enemyBench.findIndex(c => c && isCardAlive(c));
            if (bench >= 0) { b.enemyField[idx] = b.enemyBench[bench]; b.enemyBench[bench] = null; }
            else b.enemyField[idx] = null;
        }
    });
    b.myField.forEach((card, idx) => {
        if (card && !isCardAlive(card)) {
            b.enemyKills++;
            const bench = b.myBench.findIndex(c => c && isCardAlive(c));
            if (bench >= 0) { b.myField[idx] = b.myBench[bench]; b.myBench[bench] = null; }
            else b.myField[idx] = null;
        }
    });

    const myWon  = b.myKills >= KILLS_TO_WIN || !onlinePlayerAlive(b.enemyField, b.enemyBench);
    const enWon  = b.enemyKills >= KILLS_TO_WIN || !onlinePlayerAlive(b.myField, b.myBench);
    if (myWon) endOnlineBattle(path, true);
    else if (enWon) endOnlineBattle(path, false);
}

async function endOnlineBattle(path, won) {
    clearInterval(onlinePollingInterval);
    await fbDelete(path);
    gameState.onlineBattle.status = 'ended';
    alert(won ? '🏆 あなたの勝利！' : '😭 敗北しました...');
    resetBattleScreen();
}
// 11. UI・モーダル生成
// ==========================================
function createDetailModalDOM() {
    if (document.getElementById('detail-modal-overlay')) return;
    const modalHtml = document.createElement('div');
    modalHtml.id = 'detail-modal-overlay';
    modalHtml.className = 'modal-overlay';
    modalHtml.innerHTML = `
        <div class="modal-content">
            <h2 id="modal-card-name" style="font-size:16px;margin-bottom:4px;color:#ff477e;">カード名</h2>
            <p id="modal-card-group" style="font-size:11px;color:#aaa;margin-bottom:12px;"></p>
            <div id="modal-card-container" style="display:flex;justify-content:center;margin-bottom:12px;cursor:zoom-in;" title="タップで拡大"></div>
            <p id="modal-card-stats" style="font-size:12px;background:#1e1e1e;padding:8px;border-radius:6px;line-height:1.6;margin-bottom:10px;border:1px solid #333;"></p>
            <p id="modal-card-skill" style="font-size:12px;background:#1e1e1e;padding:8px;border-radius:6px;line-height:1.4;margin-bottom:15px;border:1px solid #333;text-align:left;"></p>
            <div class="modal-buttons">
                <button id="modal-btn-deck">👑 デッキに編成する</button>
                <button id="modal-btn-delete" class="btn-danger" style="margin-top:6px;">🗑️ このカードを1枚削除</button>
                <button id="modal-btn-close" class="btn-secondary" style="margin-top:6px;">閉じる</button>
            </div>
        </div>`;
    document.body.appendChild(modalHtml);
    document.getElementById('modal-btn-close').addEventListener('click', () => modalHtml.classList.remove('active'));

    const zoomOverlay = document.createElement('div');
    zoomOverlay.id = 'zoom-overlay';
    zoomOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:4000;display:none;align-items:center;justify-content:center;cursor:zoom-out;';
    zoomOverlay.innerHTML = `<img id="zoom-img" style="max-width:90%;max-height:90vh;border-radius:12px;">`;
    zoomOverlay.addEventListener('click', () => { zoomOverlay.style.display='none'; });
    document.body.appendChild(zoomOverlay);
}

function createSettingModalDOM() {
    if (document.getElementById('setting-modal-overlay')) return;
    const modalHtml = document.createElement('div');
    modalHtml.id = 'setting-modal-overlay';
    modalHtml.className = 'modal-overlay';
    modalHtml.innerHTML = `
        <div class="modal-content" style="text-align:left;">
            <h2 style="font-size:16px;margin-bottom:15px;text-align:center;color:#ff477e;border-bottom:1px solid #333;padding-bottom:8px;">⚙️ アカウント設定</h2>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:11px;color:#aaa;margin-bottom:4px;">ニックネーム</label>
                <input type="text" id="setting-input-name" style="width:100%;padding:6px;background:#111;border:1px solid #444;color:#fff;border-radius:4px;">
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:11px;color:#aaa;margin-bottom:4px;">プロフィールアイコン</label>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                    <div id="setting-icon-preview" style="width:48px;height:48px;border-radius:50%;border:2px solid #ff477e;display:flex;align-items:center;justify-content:center;font-size:24px;background:#222;overflow:hidden;flex-shrink:0;">🎤</div>
                    <select id="setting-select-icon" style="flex:1;padding:6px;background:#111;border:1px solid #444;color:#fff;border-radius:4px;">
                        <option value="🦖">🦖 恐竜</option><option value="👑">👑 王冠</option>
                        <option value="🐱">🐱 ねこ</option><option value="🎤">🎤 マイク</option>
                        <option value="🔥">🔥 炎</option><option value="🌸">🌸 桜</option>
                        <option value="⭐">⭐ スター</option>
                    </select>
                </div>
                <input type="file" id="setting-icon-file" accept="image/*" style="width:100%;font-size:11px;color:#aaa;background:#111;border:1px solid #444;border-radius:4px;padding:4px;">
            </div>
            <div style="margin-bottom:15px;">
                <label style="display:block;font-size:11px;color:#aaa;margin-bottom:4px;">推しグループ</label>
                <select id="setting-select-oshi" style="width:100%;padding:6px;background:#111;border:1px solid #444;color:#fff;border-radius:4px;">
                    ${GROUP_PACK_GROUPS.map(g => `<option value="${g}">${g}</option>`).join('')}
                    <option value="SPECIAL">⭐ SPECIAL</option>
                </select>
            </div>
            <div style="display:flex;gap:8px;">
                <button id="setting-btn-save" style="flex:1;">保存</button>
                <button id="setting-btn-close" class="btn-secondary" style="flex:1;">閉じる</button>
            </div>
        </div>`;
    document.body.appendChild(modalHtml);

    modalHtml.addEventListener('change', e => {
        if (e.target.id === 'setting-select-icon') {
            const p = document.getElementById('setting-icon-preview');
            if (p) { p.style.backgroundImage=''; p.textContent=e.target.value; }
        }
        if (e.target.id === 'setting-icon-file') {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                const p = document.getElementById('setting-icon-preview');
                if (p) { p.textContent=''; p.style.backgroundImage=`url(${ev.target.result})`; p.style.backgroundSize='cover'; }
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('setting-btn-close').addEventListener('click', () => modalHtml.classList.remove('active'));
    document.getElementById('setting-btn-save').addEventListener('click', () => {
        const newName = document.getElementById('setting-input-name').value.trim();
        const newOshi = document.getElementById('setting-select-oshi').value;
        if (!newName) { alert('ニックネームを入力してください。'); return; }

        const save = (iconVal) => {
            const oldName = gameState.currentUser.nickname;
            gameState.currentUser.nickname = newName;
            gameState.currentUser.icon = iconVal;
            gameState.currentUser.oshiGroup = newOshi;
            localStorage.setItem(`kpop_user_${newName}`, JSON.stringify(gameState.currentUser));
            localStorage.setItem('kpop_game_current_session', newName);
            if (oldName !== newName) localStorage.removeItem(`kpop_user_${oldName}`);
            updateHeaderUI();
            modalHtml.classList.remove('active');
            alert('情報を更新しました！');
        };

        const fileInput = document.getElementById('setting-icon-file');
        if (fileInput && fileInput.files.length > 0) {
            const reader = new FileReader();
            reader.onload = ev => save(ev.target.result);
            reader.readAsDataURL(fileInput.files[0]);
        } else {
            save(document.getElementById('setting-select-icon').value);
        }
    });
}

function createSettingButtonInHeader() {
    const header = document.querySelector('.user-info-bar');
    if (!header || document.getElementById('btn-open-settings')) return;
    const setBtn = document.createElement('button');
    setBtn.id = 'btn-open-settings';
    setBtn.innerHTML = '⚙️';
    setBtn.style.cssText = 'padding:4px 8px;font-size:11px;width:auto;background:#333;';
    setBtn.addEventListener('click', () => {
        if (!gameState.currentUser) return;
        document.getElementById('setting-input-name').value = gameState.currentUser.nickname;
        document.getElementById('setting-select-oshi').value = gameState.currentUser.oshiGroup;
        document.getElementById('setting-modal-overlay').classList.add('active');
    });
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) header.insertBefore(setBtn, logoutBtn);
    else header.appendChild(setBtn);
}

// ==========================================
// 12. イベントリスナー設定
// ==========================================
function setupEventListeners() {
    // タブナビ
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', e => {
            const tab = e.currentTarget.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            const target = document.getElementById(`${tab}-tab`);
            if (target) target.classList.remove('hidden');
            e.currentTarget.classList.add('active');
            if (tab === 'collection') renderCollection();
            else if (tab === 'mission') renderMission();
            else if (tab === 'battle') initBattleSetup();
            else if (tab === 'deck') renderDeckEditor();
        });
    });

    // ガチャ開封ボタン
    const drawBtn = document.getElementById('btn-draw-pack');
    if (drawBtn) drawBtn.addEventListener('click', () => drawPack(null));

    // ガチャ閉じる
    const closeGacha = document.getElementById('btn-close-gacha');
    if (closeGacha) closeGacha.addEventListener('click', () => {
        document.getElementById('gacha-overlay').classList.remove('active');
        renderCollection();
    });

    // 新規登録
    const btnReg = document.getElementById('btn-register');
    if (btnReg) {
        btnReg.addEventListener('click', () => {
            const nicknameEl = document.getElementById('reg-nickname');
            const passwordEl = document.getElementById('reg-password');
            const groupEl = document.getElementById('reg-group');
            if (!nicknameEl || !passwordEl) return;
            const nickname = nicknameEl.value.trim();
            const password = passwordEl.value.trim();
            if (!nickname) { alert('ニックネームを入力してください。'); return; }
            if (!password || password.length < 4) { alert('パスワードは4文字以上で入力してください。'); return; }
            if (localStorage.getItem(`kpop_user_${nickname}`)) {
                alert('このニックネームは既に使われています。別の名前を入力してください。');
                return;
            }
            const oshiGroup = groupEl ? groupEl.value : 'TWICE';
            const icons = ['🎤','🦋','⭐','🌸','🔥'];
            const newUser = {
                nickname, password,
                icon: icons[Math.floor(Math.random()*icons.length)],
                oshiGroup,
                packStock: 1,
                bonusPackStock: 0,
                lastPackGrantTime: Date.now(),
                lastBattleMissionDate: null,
                collection: [], deck: [], clearedQuizIds: []
            };
            localStorage.setItem(`kpop_user_${nickname}`, JSON.stringify(newUser));
            loginUserByData(newUser);
            showMainScreen();
        });
    }

    // ログイン
    const btnLogin = document.getElementById('btn-login-submit');
    if (btnLogin) {
        btnLogin.addEventListener('click', () => {
            const nicknameEl = document.getElementById('input-nickname');
            const passwordEl = document.getElementById('input-password');
            if (!nicknameEl || !passwordEl) return;
            const nickname = nicknameEl.value.trim();
            const password = passwordEl.value.trim();
            if (!nickname || !password) { alert('ニックネームとパスワードを入力してください。'); return; }
            const stored = localStorage.getItem(`kpop_user_${nickname}`);
            if (!stored) { alert('このニックネームは登録されていません。新規登録してください。'); return; }
            const userData = JSON.parse(stored);
            if (userData.password !== password) { alert('パスワードが違います。'); return; }
            loginUserByData(userData);
            showMainScreen();
        });
    }

    // フォーム切り替え
    const goLogin = document.getElementById('go-to-login');
    if (goLogin) goLogin.addEventListener('click', () => {
        document.getElementById('register-form').classList.add('hidden');
        document.getElementById('login-form').classList.remove('hidden');
    });
    const goReg = document.getElementById('go-to-register');
    if (goReg) goReg.addEventListener('click', () => {
        document.getElementById('login-form').classList.add('hidden');
        document.getElementById('register-form').classList.remove('hidden');
    });

    createDetailModalDOM();
    createSettingModalDOM();
    initGroupPackButtons();
}

function showMainScreen() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
}

// ==========================================
// 14. カード編成タブ
// ==========================================
function renderDeckEditor() {
    const tab = document.getElementById('deck-tab');
    if (!tab || !gameState.currentUser) return;
    const u = gameState.currentUser;
    const col = u.collection || [];
    const deck = u.deck || [];

    tab.innerHTML = `
        <h2 style="font-size:18px;margin-bottom:6px;">🃏 カード編成</h2>
        <p style="font-size:12px;color:#aaa;margin-bottom:12px;">デッキに入れるカードを選択（最大${DECK_MAX}枚・バトルは5枚を選んで出陣）</p>

        <div style="background:#1e1e2e;border:1px solid #333;border-radius:10px;padding:12px;margin-bottom:14px;">
            <p style="font-size:13px;font-weight:bold;margin-bottom:8px;">📋 現在のデッキ <span id="deck-count-label" style="color:#ff477e;">${deck.length}/${DECK_MAX}</span></p>
            <div id="deck-current-list" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;min-height:40px;"></div>
            <p style="font-size:11px;color:#888;margin-top:8px;">※ カードをタップするとデッキから外せます</p>
        </div>

        <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
            <select id="deck-filter-rarity" style="flex:1;min-width:100px;padding:6px;font-size:11px;background:#252525;border:1px solid #333;color:#fff;border-radius:6px;">
                <option value="ALL">✨ 全レア度</option>
                ${RARITY_ORDER.map(r => `<option value="${r}">${r}</option>`).join('')}
            </select>
            <select id="deck-filter-group" style="flex:1;min-width:100px;padding:6px;font-size:11px;background:#252525;border:1px solid #333;color:#fff;border-radius:6px;">
                <option value="ALL">🎤 全グループ</option>
                ${GROUP_PACK_GROUPS.map(g => `<option>${g}</option>`).join('')}
                <option value="SPECIAL">⭐ SPECIAL</option>
            </select>
        </div>

        <p style="font-size:12px;color:#aaa;margin-bottom:8px;">コレクションからデッキに追加（タップで追加）</p>
        <div id="deck-card-pool" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;"></div>
    `;

    // フィルター変更
    document.getElementById('deck-filter-rarity').addEventListener('change', () => refreshDeckPool());
    document.getElementById('deck-filter-group').addEventListener('change', () => refreshDeckPool());

    refreshDeckCurrent();
    refreshDeckPool();
}

function refreshDeckCurrent() {
    const u = gameState.currentUser; if (!u) return;
    const el = document.getElementById('deck-current-list'); if (!el) return;
    const countLabel = document.getElementById('deck-count-label');
    if (countLabel) countLabel.textContent = `${u.deck.length}/${DECK_MAX}`;
    el.innerHTML = '';

    if (u.deck.length === 0) {
        el.innerHTML = '<p style="font-size:12px;color:#666;grid-column:1/-1;">デッキにカードがありません</p>';
        return;
    }

    u.deck.forEach(id => {
        const card = u.collection.find(c => c.id === id);
        if (!card) return;
        const cardEl = createCardElement(card);
        cardEl.style.cursor = 'pointer';
        // タップでデッキから外す
        cardEl.addEventListener('click', () => {
            u.deck = u.deck.filter(did => did !== id);
            saveUserData();
            refreshDeckCurrent();
            refreshDeckPool();
        });
        // バツ印
        const rm = document.createElement('div');
        rm.style.cssText = 'position:absolute;top:2px;right:2px;background:#ff3b30;color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;z-index:10;';
        rm.textContent = '×';
        cardEl.appendChild(rm);
        el.appendChild(cardEl);
    });
}

function refreshDeckPool() {
    const u = gameState.currentUser; if (!u) return;
    const pool = document.getElementById('deck-card-pool'); if (!pool) return;

    const rarityF = document.getElementById('deck-filter-rarity')?.value || 'ALL';
    const groupF  = document.getElementById('deck-filter-group')?.value  || 'ALL';

    // コレクションから重複なし（name+rarity キー）
    const seen = new Set();
    let cards = [];
    u.collection.forEach(c => {
        if (!c || !c.name) return;
        const key = `${c.name}__${c.rarity}`;
        if (!seen.has(key)) { seen.add(key); cards.push(c); }
    });

    if (rarityF !== 'ALL') cards = cards.filter(c => c.rarity === rarityF);
    if (groupF  !== 'ALL') cards = cards.filter(c => c.group === groupF);

    pool.innerHTML = '';
    if (cards.length === 0) {
        pool.innerHTML = '<p style="font-size:12px;color:#666;grid-column:1/-1;text-align:center;padding:20px;">条件に合うカードがありません</p>';
        return;
    }

    cards.forEach(card => {
        const inDeck = u.deck.includes(card.id);
        const cardEl = createCardElement(card);
        cardEl.style.cursor = inDeck ? 'default' : 'pointer';
        if (inDeck) {
            cardEl.style.opacity = '0.45';
            const badge = document.createElement('div');
            badge.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(76,217,100,0.85);color:#fff;font-size:10px;padding:3px 6px;border-radius:4px;font-weight:bold;z-index:5;';
            badge.textContent = '✓ 編成済み';
            cardEl.appendChild(badge);
        } else {
            cardEl.addEventListener('click', () => {
                if (u.deck.length >= DECK_MAX) { alert(`デッキは最大${DECK_MAX}枚です！`); return; }
                u.deck.push(card.id);
                saveUserData();
                refreshDeckCurrent();
                refreshDeckPool();
            });
        }
        pool.appendChild(cardEl);
    });
}

// ==========================================
// 13. 管理者デバッグ
// ==========================================
window.enableAdmin = function() {
    gameState.isAdmin = true;
    alert('管理者権限ON');
    startTimerInterval();
};
window.disableAdmin = function() {
    gameState.isAdmin = false;
    alert('管理者権限OFF');
    startTimerInterval();
};