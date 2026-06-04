/**
 * 専門2年生 JavaScript制作課題
 * K-POP CARD GAME - メインロジック（完全クラッシュガード＆ログアウト保障版）
 * enableAdmin()
 * disableAdmin()
 */

// ==========================================
// 1. アプリケーションの状態管理
// ==========================================
const gameState = {
    allCards: [],      // JSONから読み込んだすべてのカードデータ
    quizzes: {},       // JSONから読み込んだすべてのクイズデータ
    currentUser: null,  // ログイン中のユーザーデータ
    currentQuiz: null,  // 現在挑戦中のクイズ情報
    isAdmin: false,     // 👑 管理者権限フラグ
    
    // 🔍 図鑑の多機能フィルタ・ソート状態
    collectionFilter: {
        rarity: 'ALL',
        group: 'ALL',
        sort: 'input'   // input(入手順), rarity(レア度順), group(グループ順), count(枚数順)
    },

    // 🎯 クイズのグループ選択状態
    quizGroupFilter: 'MY_OSHI',

    // ⚔️ 本格ローカルバトル用の独立した状態管理オブジェクト
    battle: {
        p1: { name: "", icon: "🎤", deck: [], active: [], side: [], usedSkills: new Set() },
        p2: { name: "Player 2", icon: "🎵", deck: [], active: [], side: [], usedSkills: new Set() },
        selectedCards: { p1: [], p2: [] }, 
        phase: "setup",  
        turn: "p1",      
        selectedSlot: null, 
        p1Kills: 0,
        p2Kills: 0
    },

    // 🌐 部屋番号オンライン対戦用の状態管理オブジェクト
    onlineBattle: {
        roomNo: "",
        role: "",         // "HOST" または "GUEST"
        status: "idle",   // idle, waiting, playing, ended
        p1Name: "", p1Icon: "", p1Active: [],
        p2Name: "", p2Icon: "", p2Active: [],
        turn: "HOST",     
        selectedSlot: null,
        log: ""
    }
};

// ガチャの確率設定 (SSR: 5%, SR: 15%, R: 30%, N: 50%)
const RARITY_PROBABILITY = { SSR: 0.05, SR: 0.15, R: 0.30, N: 0.50 };

// 必殺技発動モードのフラグ
let isSkillMode = false;

// ==========================================
// 2. 初期化処理
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. AJAXによるJSONデータの非同期読み込み
    initGameData();
    // 2. ボタン等のイベントリスナーを登録
    setupEventListeners();
    // 3. ログアウトボタンの強制保険紐付け
    bindLogoutButtonsForce();
});

async function initGameData() {
    try {
        const response = await fetch('data.json');
        
        if (!response.ok) {
            throw new Error(`サーバーエラー: ${response.status}`);
        }
        
        const data = await response.json();
        gameState.allCards = data.cards || [];
        gameState.quizzes = data.quizzes || {};
        console.log('【成功】JSONデータの非同期読み込み（AJAX）が完了しました。');

        // 自動ログイン処理（セッション維持）
        const savedSession = localStorage.getItem('kpop_game_current_session');
        if (savedSession) {
            console.log(`【セッション】前回のユーザー「${savedSession}」で自動ログインします。`);
            loginUser(savedSession);
            showMainScreen();
        }
    } catch (error) {
        console.error('【例外発生】データの読み込みに失敗しました:', error.message);
        alert('ゲームに必要なデータ（data.json）の読み込みに失敗しました。ファイルが存在するか確認してください。');
    }
}

// ==========================================
// 3. 認証・ユーザーデータ管理
// ==========================================
function loginUser(nickname) {
    let userData = localStorage.getItem(`kpop_user_${nickname}`);
    
    if (!userData) {
        const newUser = {
            nickname: nickname,
            icon: "🦖",
            oshiGroup: "TWICE",
            lastDrawTime: null,
            missionCleared: false,
            collection: [],
            deck: [],
            clearedQuizIds: [] 
        };
        localStorage.setItem(`kpop_user_${nickname}`, JSON.stringify(newUser));
        gameState.currentUser = newUser;
        console.log(`【登録】新規ユーザー「${nickname}」を作成しました。`);
    } else {
        gameState.currentUser = JSON.parse(userData);
        if (!gameState.currentUser.deck) gameState.currentUser.deck = [];
        if (!gameState.currentUser.clearedQuizIds) gameState.currentUser.clearedQuizIds = [];
        console.log(`【ログイン】ユーザー「${nickname}」のデータをロードしました。`);
    }

    localStorage.setItem('kpop_game_current_session', nickname);

    // 各種UIの同期・初期表示
    updateHeaderUI();
    createSettingButtonInHeader();
    setupFilterEventListeners(); 
    initQuizGroupSelect();       
    
    startTimerInterval();
}

window.login = function() {
    const inputEl = document.getElementById('input-nickname');
    if (!inputEl) return;
    const nickname = inputEl.value.trim();
    if (!nickname) { alert('ニックネームを入力してください。'); return; }
    loginUser(nickname);
    showMainScreen();
};

// 🚪 ログアウト処理の共通コアロジック
window.logout = function() {
    if (confirm('ログアウトしますか？（セッションデータがクリアされます）')) {
        localStorage.removeItem('kpop_game_current_session');
        alert('ログアウトしました。ログイン画面に戻ります。');
        location.reload(); 
    }
};

// 🔒 HTML側にどんなログアウトボタンがあっても強制フックする保険関数
function bindLogoutButtonsForce() {
    const logoutIdentifiers = ['logout', 'btn-logout', 'logout-btn', 'btn-logout-pack'];
    logoutIdentifiers.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.removeAttribute('onclick');
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                window.logout();
            });
        }
    });
    
    // クラス名やテキストに「ログアウト」が含まれる要素もスキャン
    document.querySelectorAll('button, a').forEach(el => {
        if (el.textContent.includes('ログアウト') || el.className.includes('logout')) {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                window.logout();
            });
        }
    });
}

function saveUserData() {
    if (gameState.currentUser) {
        localStorage.setItem(`kpop_user_${gameState.currentUser.nickname}`, JSON.stringify(gameState.currentUser));
        console.log('【保存】ユーザーデータをLocalStorageに同期しました。');
    }
}

function updateHeaderUI() {
    if (!gameState.currentUser) return;
    const nameDisp = document.getElementById('user-name-display');
    const iconDisp = document.getElementById('user-icon-display');
    const oshiDisp = document.getElementById('user-oshi-display');
    
    if (nameDisp) nameDisp.textContent = gameState.currentUser.nickname;
    if (oshiDisp) oshiDisp.textContent = gameState.currentUser.oshiGroup;

    if (iconDisp) {
        const icon = gameState.currentUser.icon;
        if (icon && icon.startsWith('data:')) {
            // 画像アイコン
            iconDisp.innerHTML = '';
            iconDisp.style.cssText = 'width:28px; height:28px; border-radius:50%; overflow:hidden; flex-shrink:0; border:1px solid #ff477e;';
            const img = document.createElement('img');
            img.src = icon;
            img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
            iconDisp.appendChild(img);
        } else {
            iconDisp.style.cssText = '';
            iconDisp.textContent = icon || '🎤';
        }
    }
}

// ==========================================
// 4. ガチャシステム
// ==========================================
function startTimerInterval() {
    const timerElement = document.getElementById('pack-timer');
    if (!timerElement) return;

    const updateTimer = () => {
        if (!gameState.currentUser) return;
        const drawBtn = document.getElementById('btn-draw-pack');

        if (gameState.isAdmin) {
            timerElement.textContent = '👑 管理者権限: いつでも開封可能';
            if (drawBtn) drawBtn.disabled = false;
            return;
        }

        if (gameState.currentUser.missionCleared) {
            timerElement.textContent = '🔥 ミッションクリア特典！即時開封可能！';
            if (drawBtn) drawBtn.disabled = false;
            return;
        }

        if (!gameState.currentUser.lastDrawTime) {
            timerElement.textContent = '今すぐパックを開封できます！';
            if (drawBtn) drawBtn.disabled = false;
            return;
        }

        const nextAvailableTime = gameState.currentUser.lastDrawTime + (12 * 60 * 60 * 1000); 
        const timeLeft = nextAvailableTime - Date.now();

        if (timeLeft <= 0) {
            timerElement.textContent = '今すぐパックを開封できます！';
            if (drawBtn) drawBtn.disabled = false;
        } else {
            const hours = Math.floor(timeLeft / (60 * 60 * 1000));
            const minutes = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
            const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

            timerElement.textContent = `次のパックまで: ${hours}時間${minutes}分${seconds}秒`;
            if (drawBtn) drawBtn.disabled = true;
        }
    };

    updateTimer();
    setInterval(updateTimer, 1000);
}

function drawPack() {
    console.log('【ガチャ】パック開封ロジックを実行します。');
    const packResult = [];

    for (let i = 0; i < 5; i++) {
        const card = determineCardByRarity();
        const userCard = {
            ...card,
            id: `card_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            obtainedAt: Date.now() + i 
        };
        packResult.push(userCard);
        gameState.currentUser.collection.push(userCard);
    }

    if (!gameState.isAdmin) {
        if (gameState.currentUser.missionCleared) {
            gameState.currentUser.missionCleared = false; 
        } else {
            gameState.currentUser.lastDrawTime = Date.now(); 
        }
    }

    saveUserData();
    showGachaAnimation(packResult);
}

function determineCardByRarity() {
    const rand = Math.random();
    let selectedRarity = 'N';

    if (rand < RARITY_PROBABILITY.SSR) {
        selectedRarity = 'SSR';
    } else if (rand < RARITY_PROBABILITY.SSR + RARITY_PROBABILITY.SR) {
        selectedRarity = 'SR';
    } else if (rand < RARITY_PROBABILITY.SSR + RARITY_PROBABILITY.SR + RARITY_PROBABILITY.R) {
        selectedRarity = 'R';
    }

    const matchingCards = gameState.allCards.filter(card => card.rarity === selectedRarity);
    if (matchingCards.length === 0) {
        return gameState.allCards[0] || { name: "ノーマルカード", rarity: "N", hp: 100, atk: 20, group: "TWICE" }; 
    }

    const randomIndex = Math.floor(Math.random() * matchingCards.length);
    return matchingCards[randomIndex];
}

function showGachaAnimation(cards) {
    const overlay = document.getElementById('gacha-overlay');
    const resultDisplay = document.getElementById('gacha-result-display');
    const closeBtn = document.getElementById('btn-close-gacha');

    if (!overlay || !resultDisplay || !closeBtn) return;

    resultDisplay.innerHTML = `<div class="pack-animation">K-POP PACK</div>`;
    closeBtn.classList.add('hidden');
    overlay.classList.add('active');

    setTimeout(() => {
        overlay.classList.add('flash-effect');
        setTimeout(() => overlay.classList.remove('flash-effect'), 300);

        resultDisplay.innerHTML = ''; 

        cards.forEach((card, index) => {
            setTimeout(() => {
                const cardEl = document.createElement('div');
                cardEl.className = `card ${card.rarity}`;
                if (card.img) {
                    cardEl.style.backgroundImage = `url(${card.img})`;
                }
                
                cardEl.innerHTML = `
                    <div class="card-rarity">${card.rarity}</div>
                    <div class="card-info-box">
                        <h3>${card.name}</h3>
                        <p>HP:${card.hp} ATK:${card.atk}</p>
                    </div>
                `;
                
                resultDisplay.appendChild(cardEl);

                if (index === cards.length - 1) {
                    closeBtn.classList.remove('hidden');
                }
            }, index * 250); 
        });

    }, 1200);
}

// ==========================================
// 5. クイズミッションシステム
// ==========================================
function initQuizGroupSelect() {
    const quizTab = document.getElementById('mission-tab');
    if (!quizTab) return;

    if (document.getElementById('quiz-group-select')) return;

    const filterZone = document.createElement('div');
    filterZone.className = 'filter-zone';
    filterZone.style.marginBottom = '12px';
    filterZone.innerHTML = `
        <div class="filter-row">
            <label style="font-size:12px; color:#aaa; margin-right:6px;">グループ:</label>
            <select id="quiz-group-select" style="flex:1; padding:6px; font-size:12px;">
                <option value="MY_OSHI">🌟自分の推しグループ</option>
                <option value="TWICE">TWICE</option>
                <option value="BTS">BTS</option>
                <option value="NewJeans">NewJeans</option>
                <option value="IVE">IVE</option>
                <option value="AESPA">aespa</option>
            </select>
        </div>
    `;

    const quizContainer = document.getElementById('quiz-container');
    if (quizContainer) {
        quizTab.insertBefore(filterZone, quizContainer);
    } else {
        quizTab.appendChild(filterZone);
    }

    const quizGroupSelect = document.getElementById('quiz-group-select');
    if (quizGroupSelect) {
        quizGroupSelect.addEventListener('change', (e) => {
            gameState.quizGroupFilter = e.target.value;
            renderMission();
        });
    }
}

function renderMission() {
    const container = document.getElementById('quiz-container');
    if (!container) return;
    container.innerHTML = '';

    if (!gameState.currentUser) return;

    if (gameState.currentUser.missionCleared) {
        container.innerHTML = `
            <div style="text-align:center; padding:30px 10px;">
                <p style="color:#4cd964; font-weight:bold; font-size:15px; margin-bottom:10px;">🎉 クイズ特典を獲得中！</p>
                <p style="color:#eee; font-size:12px;">ガチャ画面からすぐにパックを1つ開封することができます！消費後に次の問題に挑戦可能です。</p>
            </div>
        `;
        return;
    }

    let targetGroup = gameState.quizGroupFilter;
    if (targetGroup === 'MY_OSHI') {
        targetGroup = gameState.currentUser.oshiGroup;
    }

    const groupQuizzes = gameState.quizzes[targetGroup] || [];
    const unreadQuizzes = groupQuizzes.filter(quiz => {
        return !gameState.currentUser.clearedQuizIds.includes(quiz.id);
    });

    if (unreadQuizzes.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:30px 10px; color:#aaa;">
                <p style="font-size:14px; font-weight:bold; color:#ff477e; margin-bottom:8px;">🏆 全問正解完了！</p>
                <p style="font-size:12px;">【${targetGroup}】のすべてのクイズをクリアしました！<br>他のグループを選んでみましょう！</p>
            </div>
        `;
        return;
    }

    const randomQuiz = unreadQuizzes[Math.floor(Math.random() * unreadQuizzes.length)];
    gameState.currentQuiz = randomQuiz;

    const quizBox = document.createElement('div');
    quizBox.className = 'quiz-box';
    quizBox.innerHTML = `
        <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:10px; color:#aaa;">
            <span>カテゴリ: <b>${targetGroup}</b></span>
            <span style="margin-left:auto;">残り: ${unreadQuizzes.length}問</span>
        </div>
        <p style="font-size:14px; font-weight:bold; line-height:1.5; margin-bottom:15px;">${randomQuiz.question}</p>
        <div id="quiz-choices" style="display:flex; flex-direction:column; gap:8px;"></div>
    `;
    container.appendChild(quizBox);

    randomQuiz.choices.forEach((choice, index) => {
        const choiceBtn = document.createElement('button');
        choiceBtn.className = 'btn-choice';
        choiceBtn.textContent = choice;
        choiceBtn.style.textAlign = 'left';
        choiceBtn.style.padding = '10px 12px';
        choiceBtn.style.fontSize = '13px';
        choiceBtn.style.background = '#2a2a2a';

        choiceBtn.addEventListener('click', () => {
            if (index === gameState.currentQuiz.answer) {
                alert('✨ 正解です！即時パック開封特典を付与しました！');
                if (!gameState.currentUser.clearedQuizIds.includes(gameState.currentQuiz.id)) {
                    gameState.currentUser.clearedQuizIds.push(gameState.currentQuiz.id);
                }
                gameState.currentUser.missionCleared = true;
                saveUserData();
                renderMission(); 
            } else {
                alert('❌ 残念！不正解です。もう一度チャレンジしてみましょう。');
            }
        });

        const choicesContainer = document.getElementById('quiz-choices');
        if (choicesContainer) choicesContainer.appendChild(choiceBtn);
    });
}

// ==========================================
// 6. 図鑑表示システム（安全ガード付き）
// ==========================================
function setupFilterEventListeners() {
    const colTab = document.getElementById('collection-tab');
    if (!colTab) return;

    if (document.getElementById('collection-filter-zone')) return;

    const filterZoneHtml = document.createElement('div');
    filterZoneHtml.id = 'collection-filter-zone';
    filterZoneHtml.className = 'filter-zone';
    filterZoneHtml.style.padding = '10px';
    filterZoneHtml.style.background = '#222';
    filterZoneHtml.style.borderRadius = '8px';
    filterZoneHtml.style.marginBottom = '12px';
    filterZoneHtml.innerHTML = `
        <div class="filter-row" style="display:flex; gap:6px; margin-bottom:8px;">
            <select id="col-filter-rarity" style="flex:1; padding:6px; font-size:11px;">
                <option value="ALL">✨ すべてのレア度</option>
                <option value="N">N</option>
                <option value="R">R</option>
                <option value="SR">SR</option>
                <option value="SSR">SSR</option>
            </select>
            <select id="col-filter-group" style="flex:1; padding:6px; font-size:11px;">
                <option value="ALL">🎤 すべてのグループ</option>
                <option value="TWICE">TWICE</option>
                <option value="BTS">BTS</option>
                <option value="NewJeans">NewJeans</option>
                <option value="IVE">IVE</option>
                <option value="AESPA">aespa</option>
            </select>
        </div>
        <div class="filter-row">
            <select id="col-sort-type" style="width:100%; padding:6px; font-size:11px; background:#2d2d2d;">
                <option value="input">⏳ 入手順（新しい順）</option>
                <option value="rarity">💎 レアリティ強度順</option>
                <option value="group">🗂️ グループ名順 (A-Z)</option>
                <option value="count">🃏 取得枚数順（重複の多い順）</option>
            </select>
        </div>
    `;

    const collectionList = document.getElementById('collection-list');
    if (collectionList && collectionList.parentNode) {
        collectionList.parentNode.insertBefore(filterZoneHtml, collectionList);
    } else {
        colTab.appendChild(filterZoneHtml);
    }

    // 🔒 安全ガード節の徹底
    const fRarity = document.getElementById('col-filter-rarity');
    if (fRarity) {
        fRarity.addEventListener('change', (e) => {
            gameState.collectionFilter.rarity = e.target.value;
            renderCollection();
        });
    }

    const fGroup = document.getElementById('col-filter-group');
    if (fGroup) {
        fGroup.addEventListener('change', (e) => {
            gameState.collectionFilter.group = e.target.value;
            renderCollection();
        });
    }

    const sType = document.getElementById('col-sort-type');
    if (sType) {
        sType.addEventListener('change', (e) => {
            gameState.collectionFilter.sort = e.target.value;
            renderCollection();
        });
    }
}

function renderCollection() {
    const listElement = document.getElementById('collection-list');
    if (!listElement) return;
    listElement.innerHTML = '';

    if (!gameState.currentUser) return;
    const collection = gameState.currentUser.collection || [];

    if (collection.length === 0) {
        listElement.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #888; padding: 40px 0;">まだカードを所持していません。<br>パックを開封しましょう！</p>';
        return;
    }

    const cardCounts = {};
    collection.forEach(card => {
        if (!card || !card.name) return;
        cardCounts[card.name] = (cardCounts[card.name] || 0) + 1;
    });

    let displayCards = [];
    const uniqueNamesTracker = new Set();

    collection.forEach(card => {
        if (!card || !card.name) return;
        if (!uniqueNamesTracker.has(card.name)) {
            uniqueNamesTracker.add(card.name);
            displayCards.push({ ...card }); 
        }
    });

    const currentFilter = gameState.collectionFilter;
    if (currentFilter.rarity !== 'ALL') {
        displayCards = displayCards.filter(c => c.rarity === currentFilter.rarity);
    }
    if (currentFilter.group !== 'ALL') {
        displayCards = displayCards.filter(c => c.group === currentFilter.group);
    }

    if (currentFilter.sort === 'input') {
        displayCards.sort((a, b) => (b.obtainedAt || 0) - (a.obtainedAt || 0));
    } else if (currentFilter.sort === 'rarity') {
        const rarityWeights = { SSR: 4, SR: 3, R: 2, N: 1 };
        displayCards.sort((a, b) => rarityWeights[b.rarity] - rarityWeights[a.rarity]);
    } else if (currentFilter.sort === 'group') {
        displayCards.sort((a, b) => a.group.localeCompare(b.group));
    } else if (currentFilter.sort === 'count') {
        displayCards.sort((a, b) => (cardCounts[b.name] || 0) - (cardCounts[a.name] || 0));
    }

    displayCards.forEach(card => {
        const totalOwnedCount = cardCounts[card.name] || 1;
        const isCurrentlyInDeck = gameState.currentUser.deck.includes(card.id);

        const cardEl = document.createElement('div');
        cardEl.className = `card ${card.rarity}`;
        if (card.img) {
            cardEl.style.backgroundImage = `url(${card.img})`;
        }

        cardEl.innerHTML = `
            ${isCurrentlyInDeck ? '<div class="deck-badge" style="position:absolute; top:4px; right:4px; background:#4cd964; color:white; font-size:8px; padding:2px 4px; border-radius:4px; font-weight:bold; z-index:10;">編成中</div>' : ''}
            <div class="card-rarity">${card.rarity}</div>
            <div class="card-info-box">
                <h3>${card.name}</h3>
                <p>${card.group} / HP:${card.hp}</p>
            </div>
            <div class="card-count-badge" style="position:absolute; bottom:4px; right:4px; background:rgba(0,0,0,0.7); color:#fff; font-size:9px; padding:1px 5px; border-radius:10px; border:1px solid #444;">${totalOwnedCount}枚</div>
        `;

        // 長押しで詳細表示（バトル中も共通）
        addLongPress(cardEl, () => openCardDetailModal(card));
        cardEl.addEventListener('click', () => {
            openCardDetailModal(card);
        });

        listElement.appendChild(cardEl);
    });
}

/**
 * 長押し（500ms）でコールバック実行するユーティリティ
 * クリックとの誤発火を防ぐため、長押し判定時はclickを抑制する
 */
function addLongPress(el, callback) {
    let timer = null;
    let fired = false;

    const start = (e) => {
        fired = false;
        timer = setTimeout(() => {
            fired = true;
            callback();
        }, 500);
    };
    const cancel = () => {
        clearTimeout(timer);
    };
    // 長押しが発火した場合はclickを無効化
    el.addEventListener('click', (e) => {
        if (fired) { e.stopImmediatePropagation(); fired = false; }
    }, true);

    el.addEventListener('mousedown', start);
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchcancel', cancel);
}

function openCardDetailModal(card) {
    const overlay = document.getElementById('detail-modal-overlay');
    if (!overlay) return;

    const mName = document.getElementById('modal-card-name');
    const mGroup = document.getElementById('modal-card-group');
    const mStats = document.getElementById('modal-card-stats');
    const mSkill = document.getElementById('modal-card-skill');

    if (mName) mName.textContent = card.name;
    if (mGroup) mGroup.textContent = `所属グループ: ${card.group} [${card.rarity}]`;
    if (mStats) mStats.innerHTML = `❤️ 体力 (HP): ${card.hp} <br>⚔️ 攻撃 (ATK): ${card.atk}`;
    const sName = (card.skill && card.skill.name) ? card.skill.name : (card.skillName || '通常ビート');
    const sDesc = (card.skill && card.skill.desc) ? card.skill.desc : (card.skillDesc || '基本スキル。');
    if (mSkill) mSkill.innerHTML = `✨ 必殺技: <b>【${sName}】</b><br><span style="font-size:11px; color:#aaa;">${sDesc}</span>`;

    const previewContainer = document.getElementById('modal-card-container');
    if (previewContainer) {
        previewContainer.innerHTML = '';
        const visualCard = document.createElement('div');
        visualCard.className = `card ${card.rarity}`;
        if (card.img) visualCard.style.backgroundImage = `url(${card.img})`;
        visualCard.style.width = '120px';
        visualCard.style.height = '168px';
        visualCard.innerHTML = `<div class="card-rarity">${card.rarity}</div>`;
        previewContainer.appendChild(visualCard);

        // 画像クリックで拡大
        previewContainer.addEventListener('click', () => {
            if (!card.img) return;
            const zoomOverlay = document.getElementById('zoom-overlay');
            const zoomImg = document.getElementById('zoom-img');
            if (zoomOverlay && zoomImg) {
                zoomImg.src = card.img;
                zoomOverlay.style.display = 'flex';
            }
        });
    }

    // 削除ボタン
    const deleteBtn = document.getElementById('modal-btn-delete');
    if (deleteBtn) {
        const freshDelete = deleteBtn.cloneNode(true);
        deleteBtn.parentNode.replaceChild(freshDelete, deleteBtn);
        freshDelete.addEventListener('click', () => {
            if (!confirm(`「${card.name}」を1枚削除しますか？`)) return;
            const col = gameState.currentUser.collection;
            // 同名カードを1枚だけ削除
            const delIndex = col.findIndex(c => c.name === card.name);
            if (delIndex !== -1) {
                const removedId = col[delIndex].id;
                col.splice(delIndex, 1);
                // デッキからも除去
                gameState.currentUser.deck = gameState.currentUser.deck.filter(id => id !== removedId);
            }
            saveUserData();
            overlay.classList.remove('active');
            renderCollection();
            alert(`「${card.name}」を1枚削除しました。`);
        });
    }

    const deckButton = document.getElementById('modal-btn-deck');
    if (deckButton) {
        const isAlreadyInDeck = gameState.currentUser.deck.includes(card.id);

        if (isAlreadyInDeck) {
            deckButton.textContent = '❌ デッキから外す';
            deckButton.className = 'btn-danger';
        } else {
            deckButton.textContent = '👑 デッキに編成する';
            deckButton.className = '';
        }

        const freshDeckButton = deckButton.cloneNode(true);
        deckButton.parentNode.replaceChild(freshDeckButton, deckButton);

        freshDeckButton.addEventListener('click', () => {
            if (isAlreadyInDeck) {
                gameState.currentUser.deck = gameState.currentUser.deck.filter(id => id !== card.id);
                alert('バトルデッキから外しました。');
            } else {
                if (gameState.currentUser.deck.length >= 5) {
                    alert('デッキに編成できるのは最大5枚までです！');
                    return;
                }
                gameState.currentUser.deck.push(card.id);
                alert('バトルデッキに編成しました！');
            }
            
            saveUserData();
            overlay.classList.remove('active'); 
            renderCollection(); 
        });
    }

    overlay.classList.add('active');
}

// ==========================================
// 7. オンライン対戦 ＆ ローカルバトル統合UI
// ==========================================
function initBattleSetup() {
    const setupZone = document.getElementById('battle-setup-zone');
    const battleField = document.getElementById('battle-field');
    
    if (battleField) battleField.classList.add('hidden');
    if (!setupZone) return;
    setupZone.classList.remove('hidden');

    if (!gameState.currentUser) return;
    const userDeckIds = gameState.currentUser.deck || [];
    
    // ガード: 最低限カードが足りているかチェック
    if (userDeckIds.length < 3) {
        setupZone.innerHTML = `
            <div style="text-align:center; padding:30px 15px; color:#aaa;">
                <p style="font-weight:bold; font-size:14px; color:#ff477e; margin-bottom:10px;">⚠️ デッキが不足しています</p>
                <p style="font-size:12px; line-height:1.6;">対戦を行うには、図鑑でカードを<b>3枚以上</b>「バトルデッキ」に登録する必要があります。（現在: ${userDeckIds.length}枚）</p>
            </div>
        `;
        return;
    }

    setupZone.innerHTML = `
        <div style="text-align:center; margin-bottom:15px;">
            <button id="btn-start-local-battle" style="background:linear-gradient(135deg, #ff477e, #ff80a0); width:100%; padding:12px; font-weight:bold;">⚔️ CPUローカルバトル開始 (5vs5)</button>
        </div>
        
        <div class="online-setup-box" style="background:#222; padding:15px; border-radius:10px; text-align:center; border:1px solid #333;">
            <h3 style="color:#22b8cf; font-size:14px; margin-bottom:6px;">🌐 部屋番号 1vs1 オンライン対戦</h3>
            <p style="font-size:11px; color:#aaa; margin-bottom:12px;">共通の4桁の部屋番号を入力して、リアルタイムで友達と対戦可能！</p>
            
            <div style="margin-bottom:12px;">
                <input type="number" id="online-room-input" placeholder="4桁の部屋番号" style="width:100%; text-align:center; font-weight:bold; padding:8px; background:#111; border:1px solid #444; color:#fff; border-radius:6px;">
            </div>
            <div style="display:flex; gap:8px;">
                <button id="btn-create-room" style="flex:1; font-size:11px; padding:10px 0; background:#2d2d2d;">部屋作成 (HOST)</button>
                <button id="btn-join-room" style="flex:1; font-size:11px; padding:10px 0; background:linear-gradient(135deg, #22b8cf, #11999e);">部屋参戦 (GUEST)</button>
            </div>
            
            <div id="online-wait-status" class="hidden" style="margin-top:15px; border-top:1px dashed #444; padding-top:15px;">
                <div class="status-badge" id="room-badge-txt" style="background:#ff9500; font-size:11px; padding:3px 8px; display:inline-block; border-radius:4px; color:#fff;">通信待機中...</div>
                <p id="room-info-log" style="font-size:12px; margin:8px 0; color:#eee;"></p>
                <button id="btn-cancel-room" style="font-size:11px; padding:5px 10px; width:auto; background:#444;">マッチングを解除</button>
            </div>
        </div>
    `;

    // イベントの紐付け
    const localBtn = document.getElementById('btn-start-local-battle');
    if (localBtn) localBtn.addEventListener('click', startBattle);

    const cRoomBtn = document.getElementById('btn-create-room');
    if (cRoomBtn) cRoomBtn.addEventListener('click', () => startOnlineMatchmaking(true));

    const jRoomBtn = document.getElementById('btn-join-room');
    if (jRoomBtn) jRoomBtn.addEventListener('click', () => startOnlineMatchmaking(false));
}

let onlinePollingInterval = null; 

function startOnlineMatchmaking(isHost) {
    const roomInputEl = document.getElementById('online-room-input');
    if (!roomInputEl) return;
    
    const roomInput = roomInputEl.value.trim();
    if (!roomInput || roomInput.length < 4) {
        return alert('対戦部屋を識別するため、4桁の部屋番号を入力してください。');
    }

    const b = gameState.onlineBattle;
    b.roomNo = roomInput;
    b.role = isHost ? "HOST" : "GUEST";
    b.status = "waiting";

    const myFullDeck = gameState.currentUser.deck.map(id => {
        return gameState.currentUser.collection.find(c => c.id === id);
    }).filter(Boolean);

    const sessionKey = `online_room_${b.roomNo}`;
    let roomData = JSON.parse(localStorage.getItem(sessionKey)) || {};

    if (isHost) {
        roomData = {
            roomNo: b.roomNo,
            hostConnected: true,
            guestConnected: false,
            hostData: { name: gameState.currentUser.nickname, icon: gameState.currentUser.icon, deck: myFullDeck },
            guestData: null,
            turn: "HOST",
            actionSignal: null
        };
    } else {
        if (!roomData.hostConnected) {
            return alert('指定された部屋のホストが見つかりません。お友達に先に「部屋を作成」してもらってください。');
        }
        roomData.guestConnected = true;
        roomData.guestData = { name: gameState.currentUser.nickname, icon: gameState.currentUser.icon, deck: myFullDeck };
    }

    localStorage.setItem(sessionKey, JSON.stringify(roomData));

    const crBtn = document.getElementById('btn-create-room');
    const jrBtn = document.getElementById('btn-join-room');
    if (crBtn) crBtn.disabled = true;
    if (jrBtn) jrBtn.disabled = true;

    const waitStatus = document.getElementById('online-wait-status');
    if (waitStatus) waitStatus.classList.remove('hidden');

    const cancelBtn = document.getElementById('btn-cancel-room');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            clearInterval(onlinePollingInterval);
            localStorage.removeItem(sessionKey);
            initBattleSetup();
        });
    }

    onlinePollingInterval = setInterval(() => {
        pollOnlineRoomStatus(sessionKey);
    }, 500);
}

function pollOnlineRoomStatus(sessionKey) {
    const roomData = JSON.parse(localStorage.getItem(sessionKey));
    const b = gameState.onlineBattle;
    if (!roomData) return;

    if (b.status === "waiting") {
        const logEl = document.getElementById('room-info-log');
        if (logEl) logEl.innerHTML = `部屋 <b>${b.roomNo}</b> で接続を待機中...<br><span style="color:#aaa;">スロット: ${b.role}</span>`;
        
        if (roomData.hostConnected && roomData.guestConnected) {
            b.status = "playing";
            clearInterval(onlinePollingInterval); 
            
            const setupZone = document.getElementById('battle-setup-zone');
            const bField = document.getElementById('battle-field');
            if (setupZone) setupZone.classList.add('hidden');
            if (bField) bField.classList.remove('hidden');

            b.p1Name = roomData.hostData.name;
            b.p1Icon = roomData.hostData.icon;
            b.p1Active = JSON.parse(JSON.stringify(roomData.hostData.deck.slice(0, 3)));

            b.p2Name = roomData.guestData.name;
            b.p2Icon = roomData.guestData.icon;
            b.p2Active = JSON.parse(JSON.stringify(roomData.guestData.deck.slice(0, 3)));

            b.turn = roomData.turn;
            b.log = "🌐 オンラインマッチング成立！<br>バトルステージへ移行します。";
            
            const bfLog = document.getElementById('battle-field-log');
            if (bfLog) bfLog.innerHTML = b.log;

            updateOnlineBattleUI();

            onlinePollingInterval = setInterval(() => {
                listenOnlineActions(sessionKey);
            }, 500);
        }
    }
}

function updateOnlineBattleUI() {
    const b = gameState.onlineBattle;
    
    renderOnlineSlots('p1-slots', b.p1Active, "HOST");
    renderOnlineSlots('p2-slots', b.p2Active, "GUEST");

    const actionZone = document.getElementById('battle-actions');
    if (!actionZone) return;
    actionZone.innerHTML = '';

    const isMyTurn = (b.turn === b.role);
    const activePlayerName = (b.turn === "HOST") ? b.p1Name : b.p2Name;

    if (!isMyTurn) {
        actionZone.innerHTML = `<p style="text-align:center; width:100%; font-size:12px; color:#aaa;">⌛ 相手（${activePlayerName}）の手番を待っています...</p>`;
    } else {
        if (b.selectedSlot === null) {
            actionZone.innerHTML = `<p style="text-align:center; width:100%; font-size:12px; color:#ff477e; font-weight:bold;">あなたのターン！<br>行動する自軍のカードをタップ選択してください。</p>`;
        } else {
            const attackBtn = document.createElement('button');
            attackBtn.textContent = `🎯 選択したカードで攻撃アタック`;
            attackBtn.style.width = '100%';
            attackBtn.addEventListener('click', () => {
                const bfLog = document.getElementById('battle-field-log');
                if (bfLog) bfLog.innerHTML = `<span style="color:#ff477e; font-weight:bold;">👉 攻撃対象とする「敵のカード」を上から選んでタップしてください！</span>`;
            });
            actionZone.appendChild(attackBtn);
        }
    }
}

function renderOnlineSlots(containerId, activeList, slotRole) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const b = gameState.onlineBattle;

    activeList.forEach((card, idx) => {
        if (!card) return;
        const isSelected = (b.turn === slotRole && b.selectedSlot === idx);
        
        const cardEl = document.createElement('div');
        cardEl.className = `card ${card.rarity} ${isSelected ? 'selected-target' : ''}`;
        if (card.img) cardEl.style.backgroundImage = `url(${card.img})`;

        cardEl.innerHTML = `
            <div class="card-rarity">${card.rarity}</div>
            <div class="card-info-box">
                <h3>${card.name}</h3>
                <p>HP: <span style="color:#ff477e; font-weight:bold;">${card.hp}</span> / ATK:${card.atk}</p>
            </div>
        `;

        cardEl.addEventListener('click', () => {
            if (b.status !== "playing") return;

            if (b.turn !== b.role) {
                if (b.selectedSlot !== null && slotRole !== b.role) {
                    sendOnlineAction(b.selectedSlot, idx);
                }
            } else {
                if (slotRole === b.role) {
                    b.selectedSlot = idx;
                    updateOnlineBattleUI();
                }
            }
        });

        container.appendChild(cardEl);
    });
}

function sendOnlineAction(myIdx, enemyIdx) {
    const b = gameState.onlineBattle;
    const sessionKey = `online_room_${b.roomNo}`;
    
    const actionPayload = {
        sender: b.role,
        myIdx: myIdx,
        enemyIdx: enemyIdx,
        timestamp: Date.now()
    };

    const roomData = JSON.parse(localStorage.getItem(sessionKey));
    if (!roomData) return;
    roomData.actionSignal = actionPayload;
    roomData.turn = (b.role === "HOST") ? "GUEST" : "HOST";
    localStorage.setItem(sessionKey, JSON.stringify(roomData));

    b.selectedSlot = null;
    b.turn = roomData.turn;
    updateOnlineBattleUI();
}

function listenOnlineActions(sessionKey) {
    const roomData = JSON.parse(localStorage.getItem(sessionKey));
    if (!roomData) return;
    const b = gameState.onlineBattle;

    if (roomData.actionSignal && roomData.actionSignal.sender !== b.role) {
        const act = roomData.actionSignal;
        let attacker, target;

        if (act.sender === "HOST") {
            attacker = b.p1Active[act.myIdx];
            target = b.p2Active[act.enemyIdx];
            if (attacker && target) {
                target.hp -= attacker.atk;
                b.log = `⚔️ [${b.p1Name}]の[${attacker.name}]のアタック！<br>[${b.p2Name}]の[${target.name}]に ${attacker.atk} ダメージ！`;
            }
        } else {
            attacker = b.p2Active[act.myIdx];
            target = b.p1Active[act.enemyIdx];
            if (attacker && target) {
                target.hp -= attacker.atk;
                b.log = `⚔️ [${b.p2Name}]の[${attacker.name}]のアタック！<br>[${b.p1Name}]の[${target.name}]に ${attacker.atk} ダメージ！`;
            }
        }

        const bfLog = document.getElementById('battle-field-log');
        if (bfLog) bfLog.innerHTML = b.log;

        checkOnlineFaint();

        roomData.actionSignal = null;
        localStorage.setItem(sessionKey, JSON.stringify(roomData));

        b.turn = roomData.turn;
        b.selectedSlot = null;
        updateOnlineBattleUI();
    } else {
        if (b.turn !== roomData.turn) {
            b.turn = roomData.turn;
            updateOnlineBattleUI();
        }
    }
}

function checkOnlineFaint() {
    const b = gameState.onlineBattle;
    b.p1Active = b.p1Active.filter(card => card.hp > 0);
    b.p2Active = b.p2Active.filter(card => card.hp > 0);

    if (b.p1Active.length === 0 || b.p2Active.length === 0) {
        clearInterval(onlinePollingInterval);
        localStorage.removeItem(`online_room_${b.roomNo}`);
        b.status = "ended";

        if (b.p1Active.length === 0 && b.p2Active.length === 0) {
            alert('⚖️ 引き分けです！');
        } else if (b.p1Active.length === 0) {
            alert(`🏆 [${b.p2Name}] の勝利！！`);
        } else {
            alert(`🏆 [${b.p1Name}] の勝利！！`);
        }
        initBattleSetup(); 
    }
}

// ==========================================
// 8. ローカルバトルCPUモード
// ==========================================
function startBattle() {
    const bState = gameState.battle;
    if (!gameState.currentUser) return;
    
    bState.p1.name = gameState.currentUser.nickname;
    bState.p1.icon = gameState.currentUser.icon;

    const userDeck = gameState.currentUser.deck.map(id => {
        return gameState.currentUser.collection.find(c => c.id === id);
    }).filter(Boolean);

    if (userDeck.length < 3) {
        alert("バトルを行うにはデッキ編成が必要です。");
        return;
    }

    bState.p1.deck = JSON.parse(JSON.stringify(userDeck));
    const templates = gameState.allCards.sort(() => 0.5 - Math.random()).slice(0, bState.p1.deck.length);
    bState.p2.deck = JSON.parse(JSON.stringify(templates));
    bState.p2.name = "ライバルP";
    bState.p2.icon = "👑";

    bState.p1.active = bState.p1.deck.slice(0, 3);
    bState.p1.side = bState.p1.deck.slice(3, 5);
    bState.p2.active = bState.p2.deck.slice(0, 3);
    bState.p2.side = bState.p2.deck.slice(3, 5);

    bState.p1.usedSkills = new Set();
    bState.p2.usedSkills = new Set();
    bState.p1Kills = 0;
    bState.p2Kills = 0;
    bState.phase = "fight";
    bState.turn = "p1";
    bState.selectedSlot = null;
    isSkillMode = false;

    const setupZone = document.getElementById('battle-setup-zone');
    const bField = document.getElementById('battle-field');
    if (setupZone) setupZone.classList.add('hidden');
    if (bField) bField.classList.remove('hidden');

    const bfLog = document.getElementById('battle-field-log');
    if (bfLog) bfLog.innerHTML = "⚔️ ローカルバトル開始！先攻はあなたです！";
    updateBattleUI();
}

function updateBattleUI() {
    const bState = gameState.battle;
    renderBattleSlots('p1-slots', bState.p1.active, 'p1');
    renderBattleSlots('p2-slots', bState.p2.active, 'p2');

    const nameP1 = document.getElementById('bf-p1-name');
    const nameP2 = document.getElementById('bf-p2-name');
    if (nameP1) nameP1.textContent = `${bState.p1.icon} ${bState.p1.name} (控え:${bState.p1.side.length})`;
    if (nameP2) nameP2.textContent = `${bState.p2.icon} ${bState.p2.name} (控え:${bState.p2.side.length})`;

    const actionZone = document.getElementById('battle-actions');
    if (!actionZone) return;
    actionZone.innerHTML = '';

    if (bState.turn === 'p2') {
        actionZone.innerHTML = `<p style="text-align:center; width:100%; color:#aaa; font-size:12px;">⌛ ライバルの手番をシミュレート中...</p>`;
        setTimeout(executeCPUTurn, 1200);
        return;
    }

    if (bState.selectedSlot === null) {
        actionZone.innerHTML = `<p style="text-align:center; width:100%; color:#ff477e; font-size:12px; font-weight:bold;">あなたのターン！行動するカードを選択してください。</p>`;
    } else {
        const attackerCard = bState.p1.active[bState.selectedSlot];
        if (!attackerCard) return;

        const normalAtkBtn = document.createElement('button');
        normalAtkBtn.textContent = `⚔️ 通常攻撃 (${attackerCard.atk})`;
        normalAtkBtn.addEventListener('click', () => {
            isSkillMode = false;
            const bfLog = document.getElementById('battle-field-log');
            if (bfLog) bfLog.innerHTML = `👉 対象にする「敵のカード」を上からタップしてください。`;
        });
        actionZone.appendChild(normalAtkBtn);

        const skillBtn = document.createElement('button');
        const hasUsedSkill = bState.p1.usedSkills.has(attackerCard.id);
        const skillName = (attackerCard.skill && attackerCard.skill.name) ? attackerCard.skill.name : (attackerCard.skillName || '特大ビート');
        const skillDesc = (attackerCard.skill && attackerCard.skill.desc) ? attackerCard.skill.desc : (attackerCard.skillDesc || '');
        skillBtn.textContent = `✨ 必殺技: ${skillName}`;
        
        if (hasUsedSkill) {
            skillBtn.textContent += " (使用済)";
            skillBtn.disabled = true;
            skillBtn.style.opacity = "0.5";
        }

        skillBtn.addEventListener('click', () => {
            isSkillMode = true;
            const bfLog = document.getElementById('battle-field-log');
            if (bfLog) bfLog.innerHTML = `🌟 必殺パワー充填！敵のカードを選んでください！`;
        });
        actionZone.appendChild(skillBtn);
    }
}

function renderBattleSlots(containerId, activeList, side) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const bState = gameState.battle;

    activeList.forEach((card, index) => {
        if (!card) return;
        const isSelected = (side === 'p1' && bState.turn === 'p1' && bState.selectedSlot === index);

        const cardEl = document.createElement('div');
        cardEl.className = `card ${card.rarity} ${isSelected ? 'selected-target' : ''}`;
        if (card.img) cardEl.style.backgroundImage = `url(${card.img})`;

        cardEl.innerHTML = `
            <div class="card-rarity">${card.rarity}</div>
            <div class="card-info-box">
                <h3>${card.name}</h3>
                <p>HP: <span style="color:#ff477e; font-weight:bold;">${card.hp}</span> / ATK:${card.atk}</p>
            </div>
        `;

        // 長押しで詳細確認
        addLongPress(cardEl, () => openCardDetailModal(card));

        cardEl.addEventListener('click', () => {
            if (bState.turn === 'p2') return;

            if (side === 'p1') {
                bState.selectedSlot = index;
                isSkillMode = false;
                updateBattleUI();
            } else if (side === 'p2' && bState.selectedSlot !== null) {
                executePlayerAction(bState.selectedSlot, index);
            }
        });

        container.appendChild(cardEl);
    });
}

function executePlayerAction(myIndex, enemyIndex) {
    const bState = gameState.battle;
    const attacker = bState.p1.active[myIndex];
    const target = bState.p2.active[enemyIndex];
    if (!attacker || !target) return;

    let damage = attacker.atk;
    let logMsg = "";

    if (gameState.currentUser && attacker.group === gameState.currentUser.oshiGroup) {
        damage = Math.floor(damage * 1.2);
        logMsg += `✨ 推し補正！1.2倍！<br>`;
    }

    if (isSkillMode) {
        damage = Math.floor(damage * 1.5);
        bState.p1.usedSkills.add(attacker.id);
        logMsg += `🌟 必殺技発動！<br>`;
    }

    target.hp -= damage;
    logMsg += `💥 [${attacker.name}] の攻撃！ [${target.name}] に ${damage} ダメージ！`;
    
    const bfLog = document.getElementById('battle-field-log');
    if (bfLog) bfLog.innerHTML = logMsg;

    checkFaint();
    switchTurn();
}

function executeCPUTurn() {
    const bState = gameState.battle;
    if (bState.p2.active.length === 0 || bState.p1.active.length === 0) return;

    const myRandomIndex = Math.floor(Math.random() * bState.p2.active.length);
    const enemyRandomIndex = Math.floor(Math.random() * bState.p1.active.length);

    const attacker = bState.p2.active[myRandomIndex];
    const target = bState.p1.active[enemyRandomIndex];
    if (!attacker || !target) return;

    let damage = attacker.atk;
    let logMsg = "";

    const useSkillRand = Math.random() < 0.25;
    if (useSkillRand && !bState.p2.usedSkills.has(attacker.id)) {
        damage = Math.floor(damage * 1.5);
        bState.p2.usedSkills.add(attacker.id);
        logMsg += `👑 CPUが必殺スキルを発動！<br>`;
    }

    target.hp -= damage;
    logMsg += `🤖 相手の [${attacker.name}] の反撃！ [${target.name}] に ${damage} ダメージ！`;
    
    const bfLog = document.getElementById('battle-field-log');
    if (bfLog) bfLog.innerHTML = logMsg;

    checkFaint();
    switchTurn();
}

function checkFaint() {
    const bState = gameState.battle;

    ['p1', 'p2'].forEach(sideKey => {
        const enemyKey = sideKey === 'p1' ? 'p2' : 'p1';
        bState[sideKey].active = bState[sideKey].active.filter(card => {
            if (card.hp <= 0) {
                bState[enemyKey + 'Kills']++;
                
                if (bState[sideKey].side.length > 0) {
                    const nextCard = bState[sideKey].side.shift();
                    bState[sideKey].active.push(nextCard);
                    const bfLog = document.getElementById('battle-field-log');
                    if (bfLog) bfLog.innerHTML += `<br>🏃 控えから [${nextCard.name}] がステージに出陣！`;
                }
                return false;
            }
            return true;
        });
    });

    if (bState.p1Kills >= 3 || bState.p1.active.length === 0) {
        if (bState.p1Kills >= bState.p2Kills) {
            alert(`🎉 あなたの勝利です！！！`);
        } else {
            alert(`😭 ライバルに敗北しました...`);
        }
        initBattleSetup();
    }
}

function switchTurn() {
    const bState = gameState.battle;
    bState.turn = bState.turn === 'p1' ? 'p2' : 'p1';
    bState.selectedSlot = null;
    isSkillMode = false;
    updateBattleUI();
}

// ==========================================
// 9. ダイナミックDOM生成（アカウント設定等）
// ==========================================
function createDetailModalDOM() {
    if (document.getElementById('detail-modal-overlay')) return;
    const modalHtml = document.createElement('div');
    modalHtml.id = 'detail-modal-overlay';
    modalHtml.className = 'modal-overlay';
    modalHtml.innerHTML = `
        <div class="modal-content">
            <h2 id="modal-card-name" style="font-size:16px; margin-bottom:4px; color:#ff477e;">カード名</h2>
            <p id="modal-card-group" style="font-size:11px; color:#aaa; margin-bottom:12px;">所属グループ</p>
            <div id="modal-card-container" style="display:flex; justify-content:center; margin-bottom:12px; cursor:zoom-in;" title="タップで拡大"></div>
            <p id="modal-card-stats" style="font-size:12px; background:#1e1e1e; padding:8px; border-radius:6px; line-height:1.6; margin-bottom:10px; border:1px solid #333;"></p>
            <p id="modal-card-skill" style="font-size:12px; background:#1e1e1e; padding:8px; border-radius:6px; line-height:1.4; margin-bottom:15px; border:1px solid #333; text-align:left;"></p>
            <div class="modal-buttons">
                <button id="modal-btn-deck">👑 デッキに編成する</button>
                <button id="modal-btn-delete" class="btn-danger" style="margin-top:6px;">🗑️ このカードを1枚削除</button>
                <button id="modal-btn-close" class="btn-secondary" style="margin-top:6px;">閉じる</button>
            </div>
        </div>
    `;
    document.body.appendChild(modalHtml);
    document.getElementById('modal-btn-close').addEventListener('click', () => {
        modalHtml.classList.remove('active');
    });

    // 画像拡大オーバーレイ
    const zoomOverlay = document.createElement('div');
    zoomOverlay.id = 'zoom-overlay';
    zoomOverlay.style.cssText = `
        position:fixed; top:0; left:0; width:100%; height:100%;
        background:rgba(0,0,0,0.92); z-index:2000;
        display:flex; align-items:center; justify-content:center;
        display:none; cursor:zoom-out;
    `;
    zoomOverlay.innerHTML = `<img id="zoom-img" style="max-width:90%; max-height:90vh; border-radius:12px; box-shadow:0 0 40px rgba(255,71,126,0.4);">`;
    zoomOverlay.addEventListener('click', () => { zoomOverlay.style.display = 'none'; });
    document.body.appendChild(zoomOverlay);
}

function createSettingModalDOM() {
    if (document.getElementById('setting-modal-overlay')) return;
    const modalHtml = document.createElement('div');
    modalHtml.id = 'setting-modal-overlay';
    modalHtml.className = 'modal-overlay';
    modalHtml.innerHTML = `
        <div class="modal-content" style="text-align: left;">
            <h2 style="font-size:16px; margin-bottom:15px; text-align:center; color:#ff477e; border-bottom:1px solid #333; padding-bottom:8px;">⚙️ アカウント詳細設定</h2>
            <div class="setting-group" style="margin-bottom:12px;">
                <label style="display:block; font-size:11px; color:#aaa; margin-bottom:4px;">ニックネーム変更</label>
                <input type="text" id="setting-input-name" style="width:100%; padding:6px; background:#111; border:1px solid #444; color:#fff; border-radius:4px;">
            </div>
            <div class="setting-group" style="margin-bottom:12px;">
                <label style="display:block; font-size:11px; color:#aaa; margin-bottom:4px;">プロフィールアイコン</label>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                    <div id="setting-icon-preview" style="width:48px; height:48px; border-radius:50%; border:2px solid #ff477e; display:flex; align-items:center; justify-content:center; font-size:24px; background:#222; overflow:hidden; flex-shrink:0;">🎤</div>
                    <div style="flex:1;">
                        <p style="font-size:11px; color:#aaa; margin-bottom:4px;">絵文字から選ぶ</p>
                        <select id="setting-select-icon" style="width:100%; padding:6px; background:#111; border:1px solid #444; color:#fff; border-radius:4px;">
                            <option value="🦖">🦖 恐竜</option>
                            <option value="👑">👑 王冠</option>
                            <option value="🐱">🐱 ねこ</option>
                            <option value="🎤">🎤 マイク</option>
                            <option value="🔥">🔥 炎</option>
                            <option value="🌸">🌸 桜</option>
                            <option value="⭐">⭐ スター</option>
                        </select>
                    </div>
                </div>
                <p style="font-size:11px; color:#aaa; margin-bottom:4px;">または画像からアップロード</p>
                <input type="file" id="setting-icon-file" accept="image/*" style="width:100%; font-size:11px; color:#aaa; background:#111; border:1px solid #444; border-radius:4px; padding:4px;">
            </div>
            <div class="setting-group" style="margin-bottom:15px;">
                <label style="display:block; font-size:11px; color:#aaa; margin-bottom:4px;">推しグループ</label>
                <select id="setting-select-oshi" style="width:100%; padding:6px; background:#111; border:1px solid #444; color:#fff; border-radius:4px;">
                    <option value="TWICE">TWICE</option>
                    <option value="BTS">BTS</option>
                    <option value="NewJeans">NewJeans</option>
                    <option value="IVE">IVE</option>
                    <option value="AESPA">aespa</option>
                </select>
            </div>
            <div class="modal-buttons" style="display:flex; gap:8px;">
                <button id="setting-btn-save" style="flex:1;">保存</button>
                <button id="setting-btn-close" class="btn-secondary" style="flex:1;">閉じる</button>
            </div>
        </div>
    `;
    document.body.appendChild(modalHtml);

    // アイコンプレビュー：絵文字select変更時
    document.getElementById('setting-modal-overlay').addEventListener('change', (e) => {
        if (e.target.id === 'setting-select-icon') {
            const preview = document.getElementById('setting-icon-preview');
            if (preview) {
                preview.style.backgroundImage = '';
                preview.style.backgroundSize = '';
                preview.textContent = e.target.value;
            }
        }
        if (e.target.id === 'setting-icon-file') {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const preview = document.getElementById('setting-icon-preview');
                if (preview) {
                    preview.textContent = '';
                    preview.style.backgroundImage = `url(${ev.target.result})`;
                    preview.style.backgroundSize = 'cover';
                    preview.style.backgroundPosition = 'center';
                }
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('setting-btn-close').addEventListener('click', () => {
        modalHtml.classList.remove('active');
    });

    document.getElementById('setting-btn-save').addEventListener('click', () => {
        const newName = document.getElementById('setting-input-name').value.trim();
        const newOshi = document.getElementById('setting-select-oshi').value;

        if (!newName) {
            alert('ニックネームを入力してください。');
            return;
        }

        const saveIconAndFinish = (iconValue) => {
            const oldName = gameState.currentUser.nickname;
            gameState.currentUser.nickname = newName;
            gameState.currentUser.icon = iconValue;
            gameState.currentUser.oshiGroup = newOshi;

            localStorage.setItem(`kpop_user_${newName}`, JSON.stringify(gameState.currentUser));
            localStorage.setItem('kpop_game_current_session', newName);

            if (oldName !== newName) {
                localStorage.removeItem(`kpop_user_${oldName}`);
            }

            updateHeaderUI();
            modalHtml.classList.remove('active');
            alert('情報を更新しました！');
            renderMission();
            renderCollection();
        };

        // 画像ファイルが選択されているか確認
        const fileInput = document.getElementById('setting-icon-file');
        if (fileInput && fileInput.files.length > 0) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                saveIconAndFinish(ev.target.result); // base64をiconとして保存
            };
            reader.readAsDataURL(fileInput.files[0]);
        } else {
            const newIcon = document.getElementById('setting-select-icon').value;
            saveIconAndFinish(newIcon);
        }
    });
}

function createSettingButtonInHeader() {
    const header = document.querySelector('.user-info-bar');
    if (!header || document.getElementById('btn-open-settings')) return;

    const setBtn = document.createElement('button');
    setBtn.id = 'btn-open-settings';
    setBtn.innerHTML = '⚙️ 設定';
    setBtn.style.padding = '4px 8px';
    setBtn.style.fontSize = '11px';
    setBtn.style.width = 'auto';
    setBtn.style.background = '#333';
    setBtn.style.marginLeft = 'auto';

    setBtn.addEventListener('click', () => {
        if (!gameState.currentUser) return;
        document.getElementById('setting-input-name').value = gameState.currentUser.nickname;
        document.getElementById('setting-select-oshi').value = gameState.currentUser.oshiGroup;

        const icon = gameState.currentUser.icon;
        const preview = document.getElementById('setting-icon-preview');
        const iconSelect = document.getElementById('setting-select-icon');
        if (preview) {
            if (icon && icon.startsWith('data:')) {
                preview.textContent = '';
                preview.style.backgroundImage = `url(${icon})`;
                preview.style.backgroundSize = 'cover';
                preview.style.backgroundPosition = 'center';
            } else {
                preview.style.backgroundImage = '';
                preview.textContent = icon || '🎤';
                if (iconSelect) iconSelect.value = icon || '🎤';
            }
        }

        document.getElementById('setting-modal-overlay').classList.add('active');
    });

    header.appendChild(setBtn);
}

function setupEventListeners() {
    // 📱 下部フッターナビゲーションのタブ切り替えイベント
    const navButtons = document.querySelectorAll('.nav-item');
    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetTab = e.currentTarget.getAttribute('data-tab');
            
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
            navButtons.forEach(b => b.classList.remove('active'));

            const targetElement = document.getElementById(`${targetTab}-tab`);
            if (targetElement) {
                targetElement.classList.remove('hidden');
            }
            e.currentTarget.classList.add('active');

            if (targetTab === 'collection') {
                renderCollection();
            } else if (targetTab === 'mission') {
                renderMission();
            } else if (targetTab === 'battle') {
                initBattleSetup();
            }
        });
    });

    // 🎁 ガチャパック開封ボタン
    const drawBtn = document.getElementById('btn-draw-pack');
    if (drawBtn) {
        drawBtn.addEventListener('click', () => {
            drawPack();
        });
    }

    // ❌ ガチャ画面を閉じるボタン
    const closeGachaBtn = document.getElementById('btn-close-gacha');
    if (closeGachaBtn) {
        closeGachaBtn.addEventListener('click', () => {
            const gachaOverlay = document.getElementById('gacha-overlay');
            if (gachaOverlay) gachaOverlay.classList.remove('active');
            renderCollection(); 
        });
    }

    // 🔑 認証画面のボタン類
    const btnRegister = document.getElementById('btn-register');
    if (btnRegister) {
        btnRegister.addEventListener('click', () => {
            const nicknameEl = document.getElementById('reg-nickname');
            const groupEl = document.getElementById('reg-group');
            if (!nicknameEl) return;
            const nickname = nicknameEl.value.trim();
            if (!nickname) { alert('ニックネームを入力してください。'); return; }

            // 新規ユーザー作成
            const oshiGroup = groupEl ? groupEl.value : 'TWICE';
            const icons = ['🎤','🦋','⭐','🌸','🔥'];
            const newUser = {
                nickname, icon: icons[Math.floor(Math.random()*icons.length)],
                oshiGroup,
                lastDrawTime: null, missionCleared: false,
                collection: [], deck: [], clearedQuizIds: []
            };
            localStorage.setItem(`kpop_user_${nickname}`, JSON.stringify(newUser));
            localStorage.setItem('kpop_game_current_session', nickname);
            loginUser(nickname);
            showMainScreen();
        });
    }

    const btnLoginSubmit = document.getElementById('btn-login-submit');
    if (btnLoginSubmit) {
        btnLoginSubmit.addEventListener('click', () => {
            const nicknameEl = document.getElementById('input-nickname');
            if (!nicknameEl) return;
            const nickname = nicknameEl.value.trim();
            if (!nickname) { alert('ニックネームを入力してください。'); return; }
            loginUser(nickname);
            showMainScreen();
        });
    }

    const goToLogin = document.getElementById('go-to-login');
    if (goToLogin) {
        goToLogin.addEventListener('click', () => {
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
        });
    }

    const goToRegister = document.getElementById('go-to-register');
    if (goToRegister) {
        goToRegister.addEventListener('click', () => {
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.remove('hidden');
        });
    }

    createDetailModalDOM();
    createSettingModalDOM();
}

function showMainScreen() {
    const authScreen = document.getElementById('auth-screen');
    const mainScreen = document.getElementById('main-screen');
    if (authScreen) authScreen.classList.add('hidden');
    if (mainScreen) mainScreen.classList.remove('hidden');
}

// ==========================================
// 👑 10. 管理者用デバッグコマンド
// ==========================================
window.enableAdmin = function() {
    gameState.isAdmin = true;
    alert("管理者権限が有効になりました！");
    startTimerInterval();
};

window.disableAdmin = function() {
    gameState.isAdmin = false;
    alert("管理者権限を解除しました。");
    startTimerInterval();
};