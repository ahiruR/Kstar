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
const RARITY_PROB_NORMAL = { UR: 0.01, HR: 0.03, SSR: 0.06, SR: 0.15, R: 0.30, N: 0.45 };
// グループパック確率（低め）
const RARITY_PROB_GROUP  = { UR: 0.005, HR: 0.015, SSR: 0.04, SR: 0.10, R: 0.25, N: 0.59 };
const RARITY_ORDER = ['UR','HR','SSR','SR','R','N'];
const RARITY_WEIGHTS = { UR: 6, HR: 5, SSR: 4, SR: 3, R: 2, N: 1 };

const MAX_PACKS = 2;          // 最大ストック数
const PACK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12時間
const FIELD_SLOTS = 3;
const BENCH_SLOTS = 2;
const BATTLE_DECK_SIZE = 5;
const GROUP_PACK_GROUPS = ['IVE', 'TWICE', 'NewJeans', 'aespa', 'LE SSERAFIM'];

let isSkillMode = false;
let logoutClickCount = 0;
let logoutClickTimer = null;
let onlinePollingInterval = null;
let battleFxLocked = false;
let cpuTurnTimer = null;

const GACHA_RARITY_META = {
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
    // グループフィルターがある場合、そのグループのカードのみで確率を再抽選する
    const candidatePool = groupFilter
        ? gameState.allCards.filter(c => c.group === groupFilter)
        : gameState.allCards;

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
                setTimeout(() => closeBtn.classList.remove('hidden'), cumulative + 400);
            }
        });
    }, 1000);
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
    wrap.appendChild(cardEl);
    container.appendChild(wrap);

    if (['UR', 'HR', 'SSR'].includes(card.rarity) && overlay) {
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
                <option value="IVE">IVE</option>
                <option value="aespa">aespa</option>
                <option value="NewJeans">NewJeans</option>
                <option value="TWICE">TWICE</option>
                <option value="LE SSERAFIM">LE SSERAFIM</option>
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
                <option value="IVE">IVE</option>
                <option value="TWICE">TWICE</option>
                <option value="NewJeans">NewJeans</option>
                <option value="aespa">aespa</option>
                <option value="LE SSERAFIM">LE SSERAFIM</option>
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

    const skillTag = card.rarity === 'UR' && card.skill
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
    if (card.rarity === 'UR' && card.skill) {
        skillEl.innerHTML = `✨ 必殺技: <b>【${card.skill.name}】</b><br><span style="font-size:11px;color:#aaa;">${card.skill.desc}</span>`;
        skillEl.style.display = '';
    } else if (card.skill && card.rarity !== 'UR') {
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
                if (gameState.currentUser.deck.length >= 6) { alert('デッキは最大6枚です！'); return; }
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
                <p style="font-size:12px;line-height:1.6;">対戦にはデッキを<b>${BATTLE_DECK_SIZE}枚</b>編成してください（現在: ${userDeckIds.length}枚）</p>
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
        alert(`バトルにはデッキ${BATTLE_DECK_SIZE}枚が必要です。`);
        return;
    }
    showBattleFormationSelect(fullDeck.slice(0, BATTLE_DECK_SIZE), (formation) => {
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
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:800;display:flex;flex-direction:column;padding:16px;overflow-y:auto;';

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
        <h2 style="color:#ff477e;font-size:15px;text-align:center;margin-bottom:6px;">編成（場3＋ベンチ2）</h2>`;
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
                if (nextSlot.type === 'field') {
                    if (nextSlot.idx < FIELD_SLOTS - 1) nextSlot.idx++;
                    else nextSlot = { type: 'bench', idx: 0 };
                } else if (nextSlot.idx < BENCH_SLOTS - 1) nextSlot.idx++;
                if (remaining.length === 0) {
                    overlay.remove();
                    callback(formation);
                    return;
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
        if (atk && atk.rarity === 'UR' && atk.skill && !bState.p1.usedSkills.has(atk.id)) {
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
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:900;display:flex;flex-direction:column;padding:20px;overflow-y:auto;';
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

async function executePlayerAction(attackerIdx, targetIdx) {
    if (battleFxLocked) return;
    const bState = gameState.battle;
    const attacker = bState.p1.field[attackerIdx];
    const target = bState.p2.field[targetIdx];
    if (!attacker || !target || !isCardAlive(attacker) || !isCardAlive(target)) return;

    battleFxLocked = true;
    let damage = attacker.atk;
    let logMsg = '';
    let fxKind = 'attack';
    let skillName = null;
    const u = gameState.currentUser;
    if (u && attacker.group === u.oshiGroup) {
        damage = Math.floor(damage * 1.2);
        logMsg += '✨ 推し補正！<br>';
    }

    if (isSkillMode && attacker.rarity === 'UR' && attacker.skill) {
        const skill = attacker.skill;
        fxKind = 'skill';
        skillName = skill.name;
        if (skill.type === 'attack') {
            damage = skill.value;
            logMsg += `🌟 必殺技【${skill.name}】！<br>`;
        } else if (skill.type === 'heal') {
            logMsg += `💚 必殺技でHP+${skill.value}！<br>`;
            damage = 0;
        } else if (skill.type === 'defense') {
            attacker._shield = (attacker._shield || 0) + skill.value;
            logMsg += `🛡️ 必殺技でシールド+${skill.value}！<br>`;
            damage = 0;
        }
        bState.p1.usedSkills.add(attacker.id);
        isSkillMode = false;
    }

    let actualDmg = 0;
    if (damage > 0 && fxKind !== 'heal') {
        const shield = target._shield || 0;
        actualDmg = Math.max(0, damage - shield);
        target._shield = Math.max(0, shield - damage);
        target.hp -= actualDmg;
        logMsg += `💥 [${attacker.name}] → [${target.name}] に ${actualDmg} ダメージ！`;
    } else if (fxKind === 'skill' && attacker.skill?.type === 'heal') {
        attacker.hp += attacker.skill.value;
        actualDmg = attacker.skill.value;
        fxKind = 'heal';
    }

    const fxTargetPlayer = fxKind === 'heal' ? 'p1' : 'p2';
    const fxTargetIdx = fxKind === 'heal' ? attackerIdx : targetIdx;

    await playBattleActionFx({
        attackerPlayer: 'p1',
        attackerIdx,
        targetPlayer: fxTargetPlayer,
        targetIdx: fxTargetIdx,
        damage: actualDmg,
        kind: fxKind,
        bannerText: fxKind === 'skill' ? `✨ ${skillName}` : fxKind === 'heal' ? '💚 回復！' : '⚔️ 攻撃！',
        skillName
    });

    document.getElementById('battle-field-log').innerHTML = logMsg;
    bState.attackerFieldIdx = null;
    bState.actionStep = null;
    processFaintForPlayer(bState.p2, true);   // p2が倒れた = p1のキル
    processFaintForPlayer(bState.p1, false);  // p1が倒れた = p2のキル
    battleFxLocked = false;
    if (checkBattleEnd()) return;
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
            u.bonusPackStock = (u.bonusPackStock ?? 0) + 1;
            saveUserData();
            alert(`🎉 勝利！(${p1Kills}体撃破)\nデイリーミッション達成！特典パックを1個ストックに追加！`);
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
    const useSkill = Math.random() < 0.25 && attacker.rarity === 'UR' && attacker.skill && !bState.p2.usedSkills.has(attacker.id);
    if (useSkill) {
        const skill = attacker.skill;
        fxKind = 'skill';
        skillName = skill.name;
        if (skill.type === 'attack') damage = skill.value;
        else damage = Math.floor(damage * 1.5);
        bState.p2.usedSkills.add(attacker.id);
        logMsg += `👑 CPU必殺技【${skill.name}】！<br>`;
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
    const actualDmg = Math.max(0, damage - shield);
    target._shield = Math.max(0, shield - damage);
    target.hp -= actualDmg;
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
    if (bState.turn === 'p1') {
        bState.attackerFieldIdx = null;
        bState.actionStep = 'pick_attacker';
    }
    updateBattleUI();
}

// ==========================================
// 10. オンライン1vs1（場3+ベンチ2）
// ==========================================
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
        alert(`オンライン対戦にはデッキ${BATTLE_DECK_SIZE}枚が必要です。`);
        return;
    }

    showBattleFormationSelect(myFullDeck.slice(0, BATTLE_DECK_SIZE), (formation) => {
        const b = gameState.onlineBattle;
        b.roomNo = roomInput;
        b.role = isHost ? 'HOST' : 'GUEST';
        b.status = 'waiting';
        b.myFormation = formation;
        b.usedSkills = new Set();

        const sessionKey = `online_room_${b.roomNo}`;
        const battlePayload = serializeBattle({ field: formation.field, bench: formation.bench });

        if (isHost) {
            const roomData = {
                roomNo: b.roomNo,
                hostConnected: true,
                guestConnected: false,
                hostData: { name: u.nickname, icon: u.icon, battle: battlePayload },
                guestData: null,
                turn: 'HOST',
                actionSignal: null,
                createdAt: Date.now()
            };
            localStorage.setItem(sessionKey, JSON.stringify(roomData));
        } else {
            const existing = JSON.parse(localStorage.getItem(sessionKey));
            if (!existing || !existing.hostConnected) {
                return alert('部屋が見つかりません。HOSTに先に部屋作成してもらってください。');
            }
            if (existing.guestConnected) {
                return alert('この部屋は満員です。');
            }
            existing.guestConnected = true;
            existing.guestData = { name: u.nickname, icon: u.icon, battle: battlePayload };
            localStorage.setItem(sessionKey, JSON.stringify(existing));
        }

        const crBtn = document.getElementById('btn-create-room');
        const jrBtn = document.getElementById('btn-join-room');
        if (crBtn) crBtn.disabled = true;
        if (jrBtn) jrBtn.disabled = true;
        document.getElementById('online-wait-status').classList.remove('hidden');

        document.getElementById('btn-cancel-room').onclick = () => {
            clearInterval(onlinePollingInterval);
            if (isHost) localStorage.removeItem(sessionKey);
            initBattleSetup();
        };

        onlinePollingInterval = setInterval(() => pollOnlineRoomStatus(sessionKey), 500);
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
        b.myField = JSON.parse(JSON.stringify(hostB.field));
        b.myBench = JSON.parse(JSON.stringify(hostB.bench));
        b.enemyField = JSON.parse(JSON.stringify(guestB.field));
        b.enemyBench = JSON.parse(JSON.stringify(guestB.bench));
    } else {
        b.myField = JSON.parse(JSON.stringify(guestB.field));
        b.myBench = JSON.parse(JSON.stringify(guestB.bench));
        b.enemyField = JSON.parse(JSON.stringify(hostB.field));
        b.enemyBench = JSON.parse(JSON.stringify(hostB.bench));
    }
    b.attackerFieldIdx = null;
    b.actionStep = b.turn === b.role ? 'pick_attacker' : null;
}

function syncOnlineBattleToRoom(sessionKey) {
    const roomData = JSON.parse(localStorage.getItem(sessionKey));
    if (!roomData) return;
    const b = gameState.onlineBattle;
    const payload = { field: b.myField, bench: b.myBench };
    if (b.role === 'HOST') roomData.hostData.battle = payload;
    else roomData.guestData.battle = payload;
    localStorage.setItem(sessionKey, JSON.stringify(roomData));
}

function pollOnlineRoomStatus(sessionKey) {
    const roomData = JSON.parse(localStorage.getItem(sessionKey));
    const b = gameState.onlineBattle;
    if (!roomData) return;

    const logEl = document.getElementById('room-info-log');
    if (logEl) logEl.innerHTML = `部屋 <b>${b.roomNo}</b> 待機中 [${b.role}]`;

    if (b.status === 'waiting' && roomData.hostConnected && roomData.guestConnected && roomData.guestData?.battle) {
        b.status = 'playing';
        clearInterval(onlinePollingInterval);
        document.getElementById('battle-setup-zone').classList.add('hidden');
        document.getElementById('battle-field').classList.remove('hidden');
        loadOnlineBattleState(roomData);
        document.getElementById('battle-field-log').innerHTML = '🌐 マッチング成立！場のカードをタップして攻撃！';
        updateOnlineBattleUI();
        onlinePollingInterval = setInterval(() => listenOnlineActions(sessionKey), 500);
    }
}

function onlinePlayerAlive(field, bench) {
    return countAliveField(field) > 0 || bench.some(isCardAlive);
}

function updateOnlineBattleUI() {
    const b = gameState.onlineBattle;
    const isHostView = b.role === 'HOST';

    const bfP1 = document.getElementById('bf-p1-name');
    const bfP2 = document.getElementById('bf-p2-name');
    if (bfP1) bfP1.textContent = isHostView ? `${b.p1Icon} ${b.p1Name} (あなた)` : `${b.p2Icon} ${b.p2Name}`;
    if (bfP2) bfP2.textContent = isHostView ? `${b.p2Icon} ${b.p2Name}` : `${b.p1Icon} ${b.p1Name} (あなた)`;

    const p1FieldEl = document.getElementById('p1-field');
    const p1BenchEl = document.getElementById('p1-bench');
    const p2FieldEl = document.getElementById('p2-field');
    const p2BenchEl = document.getElementById('p2-bench');

    const enemyOpts = buildOnlineEnemyOpts(b);
    enemyOpts.battlePlayer = 'p2';
    enemyOpts.battleZone = 'field';
    const mineOpts = buildOnlineMineOpts(b);
    mineOpts.battlePlayer = 'p1';
    mineOpts.battleZone = 'field';

    renderSlotsRow(p2FieldEl, b.enemyField, enemyOpts);
    renderSlotsRow(p2BenchEl, b.enemyBench, { battlePlayer: 'p2', battleZone: 'bench' });
    renderSlotsRow(p1FieldEl, b.myField, mineOpts);
    renderSlotsRow(p1BenchEl, b.myBench, { isMine: true, battlePlayer: 'p1', battleZone: 'bench' });

    const actionZone = document.getElementById('battle-actions');
    if (!actionZone) return;
    actionZone.innerHTML = '';

    if (b.turn !== b.role) {
        actionZone.innerHTML = `<p style="text-align:center;color:#aaa;font-size:12px;">⌛ 相手のターン...</p>`;
        return;
    }

    if (!onlinePlayerAlive(b.myField, b.myBench)) {
        actionZone.innerHTML = `<p style="text-align:center;color:#ff477e;">場にカードがありません</p>`;
        return;
    }

    if (b.actionStep === 'pick_attacker') {
        actionZone.innerHTML = `<p style="text-align:center;color:#4cd964;font-size:12px;font-weight:bold;">攻撃カードをタップ</p>
            <p class="battle-hint">長押しでカード詳細</p>`;
    } else if (b.actionStep === 'pick_target') {
        const atk = b.myField[b.attackerFieldIdx];
        actionZone.innerHTML = `<p style="text-align:center;color:#ff477e;font-size:12px;font-weight:bold;">攻撃対象をタップ（${atk ? atk.name : ''}）</p>`;

        // URカード必殺技ボタン（オンライン）
        if (atk && atk.rarity === 'UR' && atk.skill) {
            if (!b.usedSkills) b.usedSkills = new Set();
            if (!b.usedSkills.has(atk.id)) {
                const skillBtn = document.createElement('button');
                skillBtn.textContent = `✨ 必殺技: ${atk.skill.name}`;
                skillBtn.style.background = 'linear-gradient(45deg,#9b59b6,#8e44ad)';
                skillBtn.style.marginTop = '8px';
                skillBtn.addEventListener('click', () => {
                    b.skillModeOnline = true;
                    document.getElementById('battle-field-log').innerHTML =
                        `🌟 必殺技「${atk.skill.name}」を選択！対象をタップ！`;
                });
                actionZone.appendChild(skillBtn);
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
        actionZone.appendChild(cancelBtn);
    }
}

function buildOnlineMineOpts(b) {
    const opts = { isMine: true };
    if (b.actionStep === 'pick_attacker') {
        opts.selectableAttacker = true;
        opts.onClick = (idx) => {
            if (!isCardAlive(b.myField[idx])) return;
            b.attackerFieldIdx = idx;
            b.actionStep = 'pick_target';
            updateOnlineBattleUI();
        };
    }
    if (b.attackerFieldIdx != null) opts.attackerSelectedIdx = b.attackerFieldIdx;
    return opts;
}

function buildOnlineEnemyOpts(b) {
    const opts = {};
    if (b.actionStep === 'pick_target') {
        opts.selectableTarget = true;
        opts.onClick = (idx) => {
            if (!isCardAlive(b.enemyField[idx])) return;
            sendOnlineAttack(b.attackerFieldIdx, idx);
        };
    }
    return opts;
}

async function sendOnlineAttack(attackerIdx, targetIdx) {
    if (battleFxLocked) return;
    const b = gameState.onlineBattle;
    const sessionKey = `online_room_${b.roomNo}`;
    const attacker = b.myField[attackerIdx];
    const target = b.enemyField[targetIdx];
    if (!attacker || !target) return;

    battleFxLocked = true;
    let damage = attacker.atk;
    let fxKind = 'attack';
    let skillName = null;
    let logMsg = '';
    const u = gameState.currentUser;
    if (u && attacker.group === u.oshiGroup) {
        damage = Math.floor(damage * 1.2);
        logMsg += '✨ 推し補正！<br>';
    }

    // 必殺技処理（オンライン）
    if (b.skillModeOnline && attacker.rarity === 'UR' && attacker.skill) {
        const skill = attacker.skill;
        fxKind = 'skill';
        skillName = skill.name;
        if (!b.usedSkills) b.usedSkills = new Set();
        b.usedSkills.add(attacker.id);
        if (skill.type === 'attack') {
            damage = skill.value;
            logMsg += `🌟 必殺技【${skill.name}】！<br>`;
        } else if (skill.type === 'heal') {
            attacker.hp += skill.value;
            logMsg += `💚 必殺技【${skill.name}】でHP+${skill.value}！<br>`;
            damage = 0;
        } else if (skill.type === 'defense') {
            attacker._shield = (attacker._shield || 0) + skill.value;
            logMsg += `🛡️ 必殺技【${skill.name}】でシールド+${skill.value}！<br>`;
            damage = 0;
        }
        b.skillModeOnline = false;
    }

    const shield = target._shield || 0;
    const actualDmg = Math.max(0, damage - shield);
    target._shield = Math.max(0, shield - damage);
    if (damage > 0) target.hp -= actualDmg;
    logMsg += damage > 0
        ? `💥 [${attacker.name}] → [${target.name}] に ${actualDmg} ダメージ！`
        : '';

    await playBattleActionFx({
        attackerPlayer: 'p1',
        attackerIdx,
        targetPlayer: 'p2',
        targetIdx,
        damage: actualDmg,
        kind: fxKind,
        bannerText: fxKind === 'skill' ? `✨ ${skillName}` : '⚔️ 攻撃！',
        skillName
    });

    const roomData = JSON.parse(localStorage.getItem(sessionKey));
    if (!roomData) { battleFxLocked = false; return; }

    if (b.role === 'HOST') {
        roomData.hostData.battle = { field: b.myField, bench: b.myBench };
        roomData.guestData.battle = { field: b.enemyField, bench: b.enemyBench };
    } else {
        roomData.guestData.battle = { field: b.myField, bench: b.myBench };
        roomData.hostData.battle = { field: b.enemyField, bench: b.enemyBench };
    }

    roomData.turn = b.role === 'HOST' ? 'GUEST' : 'HOST';
    roomData.actionSignal = {
        sender: b.role,
        attackerIdx,
        targetIdx,
        damage: actualDmg,
        attackerName: attacker.name,
        targetName: target.name,
        timestamp: Date.now()
    };
    localStorage.setItem(sessionKey, JSON.stringify(roomData));

    b.turn = roomData.turn;
    b.attackerFieldIdx = null;
    b.actionStep = null;
    b.skillModeOnline = false;
    document.getElementById('battle-field-log').innerHTML = logMsg ||
        `💥 [${attacker.name}] → [${target.name}] に ${actualDmg} ダメージ！`;
    battleFxLocked = false;
    checkOnlineFaint(sessionKey);
    updateOnlineBattleUI();
}

function listenOnlineActions(sessionKey) {
    const roomData = JSON.parse(localStorage.getItem(sessionKey));
    if (!roomData) return;
    const b = gameState.onlineBattle;

    if (roomData.actionSignal && roomData.actionSignal.sender !== b.role) {
        const sig = roomData.actionSignal;
        loadOnlineBattleState(roomData);
        updateOnlineBattleUI();

        if (!battleFxLocked) {
            battleFxLocked = true;
            playBattleActionFx({
                attackerPlayer: 'p2',
                attackerIdx: sig.attackerIdx ?? 0,
                targetPlayer: 'p1',
                targetIdx: sig.targetIdx ?? 0,
                damage: sig.damage ?? 0,
                kind: 'attack',
                bannerText: '⚔️ 相手の攻撃！'
            }).then(() => {
                document.getElementById('battle-field-log').innerHTML =
                    `⚔️ [${sig.attackerName}] → [${sig.targetName}] に ${sig.damage} ダメージ！`;
                battleFxLocked = false;
            });
        }

        roomData.actionSignal = null;
        roomData.turn = b.role;
        localStorage.setItem(sessionKey, JSON.stringify(roomData));
        b.turn = b.role;
        b.actionStep = 'pick_attacker';

        checkOnlineFaint(sessionKey);
        updateOnlineBattleUI();
    } else if (roomData.turn !== b.turn) {
        b.turn = roomData.turn;
        loadOnlineBattleState(roomData);
        b.actionStep = b.turn === b.role ? 'pick_attacker' : null;
        updateOnlineBattleUI();
    }
}

function checkOnlineFaint(sessionKey) {
    const b = gameState.onlineBattle;
    if (!b.myKills) b.myKills = 0;
    if (!b.enemyKills) b.enemyKills = 0;

    // 倒れたカードをカウントしてベンチ補充
    b.myField.forEach((card, idx) => {
        if (card && card.hp <= 0) {
            b.enemyKills++;
            const benchIdx = b.myBench.findIndex(isCardAlive);
            if (benchIdx >= 0) { b.myField[idx] = b.myBench[benchIdx]; b.myBench[benchIdx] = null; }
            else b.myField[idx] = null;
        }
    });
    b.enemyField.forEach((card, idx) => {
        if (card && card.hp <= 0) {
            b.myKills++;
            const benchIdx = b.enemyBench.findIndex(isCardAlive);
            if (benchIdx >= 0) { b.enemyField[idx] = b.enemyBench[benchIdx]; b.enemyBench[benchIdx] = null; }
            else b.enemyField[idx] = null;
        }
    });

    syncOnlineBattleToRoom(sessionKey);

    // 3本先取チェック
    const myWon  = b.myKills >= KILLS_TO_WIN  || !onlinePlayerAlive(b.enemyField, b.enemyBench);
    const enWon  = b.enemyKills >= KILLS_TO_WIN || !onlinePlayerAlive(b.myField, b.myBench);
    if (myWon) endOnlineBattle(sessionKey, true);
    else if (enWon) endOnlineBattle(sessionKey, false);
}

function processFaintSlots(field, bench) {
    field.forEach((card, idx) => {
        if (card && card.hp <= 0) {
            const benchIdx = bench.findIndex(isCardAlive);
            if (benchIdx >= 0) {
                field[idx] = bench[benchIdx];
                bench[benchIdx] = null;
            } else field[idx] = null;
        }
    });
}

function endOnlineBattle(sessionKey, won) {
    clearInterval(onlinePollingInterval);
    localStorage.removeItem(sessionKey);
    gameState.onlineBattle.status = 'ended';
    alert(won ? '🏆 あなたの勝利！' : '😭 敗北しました...');
    resetBattleScreen();
}
// ==========================================
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
    zoomOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:2000;display:none;align-items:center;justify-content:center;cursor:zoom-out;';
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
                    <option value="TWICE">TWICE</option><option value="IVE">IVE</option>
                    <option value="NewJeans">NewJeans</option><option value="aespa">aespa</option>
                    <option value="LE SSERAFIM">LE SSERAFIM</option>
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