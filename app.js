'use strict';

// ===== IndexedDB 保存先の準備 =====
const DB_NAME = 'memo-library-db';
const DB_VERSION = 1;
const STORE_NAME = 'appData';

function openMemoDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

// ===== IndexedDBからデータを読み込む =====
async function loadDataFromIndexedDB() {
  const db = await openMemoDB();

  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get('main');

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

// ===== IndexedDBにデータを保存する =====
async function saveDataToIndexedDB(newData) {
  let db;

  try {
    db = await openMemoDB();

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);

      tx.objectStore(STORE_NAME).put(newData, 'main');
    });

    return true;

  } catch (error) {
    console.error('IndexedDB保存エラー:', error);
    return false;

  } finally {
    if (db) db.close();
  }
}

// ===== 既存データの安全な移行 =====
async function migrateLocalData() {
  try {
    // IndexedDBに既存データがあれば上書きしない
    const existing = await loadDataFromIndexedDB();

    if (existing !== undefined) {
      if (
        !Array.isArray(existing.themes) ||
        !Array.isArray(existing.notes)
      ) {
        throw new Error('IndexedDBの既存データが不正です');
      }

      console.log('IndexedDBに既存データがあります。移行は不要です。');
      return true;
    }

    // localStorageのデータを取得
    const json = localStorage.getItem(KEY);

    if (!json) {
      console.log('移行する既存データはありません');
      return true;
    }

    const original = JSON.parse(json);

    if (
      !Array.isArray(original.themes) ||
      !Array.isArray(original.notes)
    ) {
      throw new Error('localStorageのデータ形式が不正です');
    }

    // IndexedDBにコピー
    const saved = await saveDataToIndexedDB(original);

    if (!saved) {
      throw new Error('IndexedDBへの保存に失敗しました');
    }

    // コピー後に読み直して内容を照合
    const copied = await loadDataFromIndexedDB();

    if (JSON.stringify(original) !== JSON.stringify(copied)) {
      throw new Error('コピー後のデータが一致しません');
    }

    console.log('IndexedDBへの移行と照合が成功しました', {
      テーマ数: copied.themes.length,
      メモ数: copied.notes.length
    });

    return true;

  } catch (error) {
    console.error('データ移行エラー:', error);
    return false;
  }
}

// ===== IndexedDBの保存順序を管理 =====
let storageSaveQueue = Promise.resolve();
let lastSavedData = null;

function queueIndexedDBSave(snapshot) {
  const task = storageSaveQueue.then(() => {
    return saveDataToIndexedDB(snapshot);
  });

  // 保存に失敗しても、次の保存を実行できるようにする
  storageSaveQueue = task.catch(error => {
    console.error('保存キューエラー:', error);
  });

  return task;
}

// ===== 最後に保存できたデータへ戻す =====
function restoreLastSavedData() {
  if (!lastSavedData) {
    console.error('復元できるデータがありません');
    return false;
  }

  try {
    data = structuredClone(lastSavedData);
    return true;
  } catch (error) {
    console.error('データの復元に失敗:', error);
    return false;
  }
}

// ===== IndexedDB用の安全な保存処理 =====
async function saveToNewStorage() {
  if (!storageReady || storageError) {
    alert('保存の準備が完了していません。');
    return false;
  }

  // 保存する瞬間のデータをコピー
  let snapshot;

  try {
    snapshot = structuredClone(data);
  } catch (error) {
    console.error('保存データのコピーに失敗:', error);
    alert('保存データを準備できませんでした。');
    return false;
  }

  // 保存処理を順番に実行
    const success = await queueIndexedDBSave(snapshot);

  if (!success) {
    alert(
      'データを保存できませんでした。\n' +
      'バックアップを確認してから、もう一度お試しください。'
    );
    return false;
  }

  lastSavedData = snapshot;

  return true;
}

// ===== アプリ共通の保存処理 =====
async function save() {
  return await saveToNewStorage();
}

// ===== IndexedDBへの切り替え状態 =====
let storageReady = false;
let storageError = false;

// ===== IndexedDBを使った起動準備 =====
async function initializeIndexedDBStorage() {
  storageReady = false;
  storageError = false;

  try {
    // 既存データを安全に移行する
    const migrated = await migrateLocalData();

    if (!migrated) {
      throw new Error('既存データの移行に失敗しました');
    }

    // IndexedDBからデータを読み込む
    const loaded = await loadDataFromIndexedDB();

    if (loaded !== undefined) {
      if (
        !Array.isArray(loaded.themes) ||
        !Array.isArray(loaded.notes)
      ) {
        throw new Error('保存データの形式が正しくありません');
      }

      data = loaded;
    } else {
      // 新規利用時だけ初期データを用意する
      data = structuredClone(initial);
    }

    const homeSectionsCreated = await initializeHomeSections();

    if (homeSectionsCreated || loaded === undefined) {
      const saved = await saveDataToIndexedDB(data);

      if (!saved) {
        throw new Error('初期データの保存に失敗しました');
      }
    }

    lastSavedData = structuredClone(data);

    storageReady = true;

    console.log('IndexedDB起動準備完了', {
      テーマ数: data.themes.length,
      メモ数: data.notes.length
    });

    return true;

  } catch (error) {
    storageError = true;
    console.error('IndexedDB起動準備エラー:', error);
    return false;
  }
}

const KEY = 'memo-library-data-v1'; const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36); const initial = { themes: [{ id: 't1', name: '旅行の記録', desc: '旅の計画と思い出をまとめる場所', image: '', favorite: true }, { id: 't2', name: '日々の記録', desc: '毎日の小さな発見', image: '', favorite: false }], notes: [{ id: 'n1', themeId: 't1', title: '京都で行きたい場所', body: '清水寺\n鴨川沿いの散歩\n喫茶店めぐり', image: '', favorite: true, updated: Date.now() }, { id: 'n2', themeId: 't1', title: 'ホテル候補まとめ', body: '駅から近いホテルを探す。', image: '', favorite: false, updated: Date.now() - 86400000 }, { id: 'n3', themeId: 't2', title: '今日の出来事', body: '今日の出来事をここに書こう。', image: '', favorite: true, updated: Date.now() }] };
let data = null;
let view = { page: 'home', id: null, tab: 'home', query: '' }; const $ = id => document.getElementById(id); const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); const find = (type, id) => data[type].find(x => x.id === id);
const nav = (page, id = null) => { view = { ...view, page, id }; render(); window.scrollTo(0, 0) }; const img = (url, cls = 'thumb', symbol = '✎') => url ? `<img class="${cls}" src="${esc(url)}" alt="">` : `<div class="${cls} placeholder">${symbol}</div>`; const section = (name, extra = '') => `<div class="section"><h2>${esc(name)}</h2>${extra}</div>`; const row = (item, kind) => `
  <div class="listrow"
    role="button"
    tabindex="0"
    data-open="${kind}"
    data-id="${esc(item.id)}">

    ${img(item.image, 'thumb', kind === 'note' ? '✎' : '♫')}

    <div class="rowtext">
      <div class="name">${esc(item.title || item.name)}</div>

      <div class="muted">
        ${kind === 'note'
    ? 'メモ · ' + new Date(item.updated).toLocaleDateString('ja-JP')
    : data.notes.filter(n => n.themeId === item.id).length + '件のメモ'
  }
      </div>
    </div>

    <button class="more"
      data-edit="${kind}"
      data-id="${esc(item.id)}"
      aria-label="編集">•••</button>

  </div>
`;
const tile = (item, kind) => `<div class="tile" role="button" tabindex="0" data-open="${kind}" data-id="${esc(item.id)}">${img(item.image, 'cover', '♫')}<div class="name">${esc(item.name)}</div>
<div class="muted">${item.themeDate ? esc(item.themeDate.slice(0, 4)) + '年' : ''}</div>
</div>`; const tabs = () => `<div class="tabbar"><div class="tabs"><button class="tab ${view.tab === 'home' ? 'active' : ''}" data-tab="home"><span>⌂</span>ホーム</button><button class="tab ${view.tab === 'library' ? 'active' : ''}" data-tab="library"><span>▦</span>ライブラリ</button><button class="tab" data-new="note"><span style="color:#ff375f">⊕</span>新規メモ</button><button class="tab ${view.tab === 'search' ? 'active' : ''}" data-tab="search"><span>⌕</span>検索</button><button class="tab ${view.tab === 'settings' ? 'active' : ''}" data-tab="settings"><span>⚙</span>設定</button></div></div>`;
const header = (title = '', back = false) => `<div class="topbar">${back ? `<button class="navback" data-back="1">‹ 戻る</button>` : `<strong>${esc(title)}</strong>`}<div><button class="iconbtn" ${view.page === 'home' ? 'data-add-section="1"' : `data-new="${view.page === 'theme' ? 'note' : 'theme'}"`} aria-label="追加">＋</button></div></div>`;

// ===== ホーム画面の大項目 =====

// ===== ホーム画面の大項目を初期設定 =====
async function initializeHomeSections() {
  if (!Array.isArray(data.homeSections)) {
    data.homeSections = [
      {
        id: uid(),
        name: 'アルバム',
        themeIds: data.themes.map(t => t.id)
      }
    ];

    // IndexedDBへの保存準備が整うまでは、
    // 起動処理側でまとめて保存する
    return true;
  }

  return false;
}

// IndexedDBへの切り替え時に、読み込み完了後に実行する
// initializeHomeSections();

// ===== トップのメモ：4件ずつ横スクロール =====
function topNotesSection() {
  // 最初は最近更新したメモを表示
  const notes = Array.isArray(data.topNoteIds)
    ? data.topNoteIds
      .map(id => find('notes', id))
      .filter(Boolean)
      .slice(0, 20)
    : data.notes.slice()
      .sort((a, b) => b.updated - a.updated)
      .slice(0, 20);

  // 4件ずつに分ける
  const pages = [];

  for (let i = 0; i < notes.length; i += 4) {
    pages.push(notes.slice(i, i + 4));
  }

  return `
    ${section('トップソング', '<button data-edit-topnotes="1">編集</button>')}
    <div class="topnotes-scroll">
      ${pages.map(page => `
        <div class="topnotes-page">
          ${page.map(n => {
    const theme = find('themes', n.themeId);

    return `
              <div
                class="topnotes-row"
                role="button"
                tabindex="0"
                data-open="note"
                data-id="${esc(n.id)}"
              >
                ${img(n.image || theme?.image, 'topnotes-cover', '✎')}

                <div class="topnotes-info">
                  <div class="topnotes-title">${esc(n.title)}</div>
                  <div class="topnotes-subtitle">
  ${esc(theme?.name || '未分類')}${theme?.themeDate ? '・' + esc(theme.themeDate.slice(0, 4)) + '年' : ''}
</div>
                </div>

                <button
                  class="topnotes-more"
                  data-edit="note"
                  data-id="${esc(n.id)}"
                  aria-label="メモを編集"
                >•••</button>
              </div>
            `;
  }).join('')}
        </div>
      `).join('') || '<p class="muted">まだメモがありません</p>'}
    </div>
  `;
}

// ===== ホーム画面の大きなカバー画像 =====
function homeHero() {
  const image = data.homeHeroImage || '';

  return `
    <div class="home-hero">
      ${image
      ? `<img class="home-hero-image" src="${esc(image)}" alt="">`
      : `<div class="home-hero-placeholder">♫</div>`
    }

      <div class="home-hero-shade"></div>

      <h1 class="home-hero-title">ライブラリ</h1>

      <button
        class="home-hero-edit"
        type="button"
        data-edit-hero="1"
      >
        画像を変更
      </button>
    </div>
  `;
}

function render() {
  let out = '';

  if (view.page === 'home') {
    let ts = data.themes.slice().sort((a, b) => {
      const dateA = a.themeDate || '';
      const dateB = b.themeDate || '';

      // 日付が新しい順
      const dateCompare = dateB.localeCompare(dateA);
      if (dateCompare !== 0) return dateCompare;

      // 同じ日付なら作成時刻が新しい順
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    out =
      header('Memo Library') +

      // 大きなカバー画像
      homeHero() +

      // トップのメモ
      topNotesSection() +

      // テーマ一覧
      data.homeSections.map(s => {
        const themes = s.themeIds
          .map(id => ts.find(t => t.id === id))
          .filter(Boolean)
          .sort((a, b) => {
            const dateCompare = (b.themeDate || '').localeCompare(a.themeDate || '');

            if (dateCompare !== 0) return dateCompare;

            return (b.createdAt || 0) - (a.createdAt || 0);
          });

        return (
          section(
            s.name,
            `
  <button
  type="button"
  data-open-section="${esc(s.id)}"
  style="
    font-size: 32px;
    font-weight: bold;
    line-height: 1;
    padding: 0 8px;
  "
>
  ›
</button>

    <button
      type="button"
      data-edit-section="${esc(s.id)}"
    >
      名前変更
    </button>
  `
          ) +
          `<div class="cardgrid">
      ${themes.map(t => tile(t, 'theme')).join('')}
    </div>`
        );
      }).join('');
  }
  else if (view.page === 'homeSection') {
    const s = data.homeSections.find(x => x.id === view.id);

    if (!s) {
      out = header('大項目', true) +
        '<p class="muted">大項目が見つかりません</p>';
    } else {
      const themes = s.themeIds
        .map(id => find('themes', id))
        .filter(Boolean)
        .sort((a, b) => {
          const dateCompare = (b.themeDate || '').localeCompare(a.themeDate || '');

          if (dateCompare !== 0) return dateCompare;

          return (b.createdAt || 0) - (a.createdAt || 0);
        });

      out =
        header(s.name, true) +
        `<h1 class="title">${esc(s.name)}</h1>` +
        section(
          'テーマ',
          `<button
      type="button"
      data-new-section-theme="${esc(s.id)}"
    >＋ テーマを追加</button>`
        ) +
        `<div class="cardgrid" style="
  display: grid;
grid-template-columns: repeat(2, minmax(0, 1fr));
gap: 16px 10px;
overflow: visible;
">
  ${themes.map(t => tile(t, 'theme')).join('')}
</div>`;
    }
  }
  else if (view.page === 'library') {
    out = header('ライブラリ') + `<h1 class="title">すべてのテーマ</h1>` + data.themes.slice().sort((a, b) => {
      const dateCompare = (b.themeDate || '').localeCompare(a.themeDate || '');
      if (dateCompare !== 0) return dateCompare;
      return (b.createdAt || 0) - (a.createdAt || 0);
    }).map(t => row(t, 'theme')).join('') + `<div class="content"><button class="outline" data-new="theme">＋ テーマを追加</button></div>`
  }
  else if (view.page === 'theme') {
    const t = find('themes', view.id);
    if (!t) return nav('home');

    const ns = orderedNotes(t.id);

    out = `
    <div class="album-page">

      <div class="album-header">
        <button class="album-back" data-back="1" aria-label="戻る">‹</button>
        <button class="album-menu" data-edit="theme" data-id="${esc(t.id)}">•••</button>
      </div>

      <div class="album-cover">
        ${img(t.image, 'cover', '♫')}
      </div>

      <div class="album-info">
        <h1 class="album-title">${esc(t.name)}</h1>
        <p class="album-description">${esc(t.desc)}</p>
        <p class="muted">${ns.length}件のメモ</p>
      </div>

      <div class="album-actions">
        <button class="album-round" data-fav="theme" data-id="${esc(t.id)}"
          aria-label="お気に入り">
          ${t.favorite ? '★' : '☆'}
        </button>

        <button class="album-primary" data-new="note">
          ＋ メモを追加
        </button>
      </div>

      <div class="album-notes">
        ${ns.length
        ? ns.map((n, i) => `
              <div class="album-note" data-sort-id="${esc(n.id)}">

  <span class="album-number">${i + 1}</span>

  <div class="album-note-title"
    role="button"
    tabindex="0"
    data-open="note"
    data-id="${esc(n.id)}">
    ${esc(n.title)}
  </div>

  <button class="album-note-menu"
    data-edit="note"
    data-id="${esc(n.id)}"
    aria-label="メモを編集">•••</button>

</div>
            `).join('')
        : '<div class="empty">まだメモがありません</div>'
      }
      </div>

       <div class="album-release-date" style="
margin: 0 20px 24px;
padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.15);
  color: #aaa;
  font-size: 14px;
">
        ${t.themeDate
        ? new Date(t.themeDate + 'T00:00:00').toLocaleDateString('ja-JP', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
        : ''}
      </div>

    </div>
  `;
  }
  else if (view.page === 'note') { let n = find('notes', view.id); if (!n) return nav('home'); out = header('', true) + `<div class="content" style="padding-top:20px">${n.image ? `<img src="${esc(n.image)}" style="width:100%;max-height:330px;object-fit:cover;border-radius:14px">` : ''}<h1>${esc(n.title)}</h1><div class="muted">${new Date(n.updated).toLocaleString('ja-JP')}</div><p class="desc" style="color:#eee;font-size:17px;min-height:100px">${esc(n.body)}</p><button class="action" data-edit="note" data-id="${n.id}">編集する</button> <button class="pill" data-fav="note" data-id="${n.id}">${n.favorite ? '★' : '☆'} お気に入り</button></div>` }
  else if (view.page === 'search') {
    let q = view.query.toLowerCase();

    let match = x =>
      [x.name, x.title, x.desc, x.body]
        .some(v => String(v || '').toLowerCase().includes(q));

    out = header('検索') +
      `<h1 class="title">検索</h1>
     <input
       class="field search"
       id="searchInput"
       placeholder="テーマ、メモを検索"
       value="${esc(view.query)}"
     >` +
      (q
        ? section('テーマ') +
        data.themes.filter(match).map(t => row(t, 'theme')).join('') +
        section('メモ') +
        data.notes.filter(match).map(n => row(n, 'note')).join('')
        : '<div class="empty">キーワードを入力して検索</div>');
  }
  else if (view.page === 'settings') { out = header('設定') + `<h1 class="title">設定</h1><div class="content"><p>メモはこの端末のブラウザ内に保存されます。消失に備えて定期的にバックアップしてください。</p><button class="action" id="export">バックアップを書き出す</button><p><label class="outline">バックアップを読み込む<input type="file" id="import" accept="application/json" hidden></label></p><p class="hint">読み込みは現在のデータを置き換えます。Safariとホーム画面アプリでは保存領域が別になる場合があります。</p></div>` }
  $('app').innerHTML = out + tabs();// テーマ詳細画面の背景色を更新
  if (view.page === 'theme') {
    const theme = find('themes', view.id);
    const page = document.querySelector('.album-page');

    if (theme && page) {
      getAlbumColor(theme.image).then(color => {
        if (page.isConnected) {
          page.style.setProperty('--album-color', color);
        }
      });
    }
  }

  if (view.page === 'search') {
    const inp = $('searchInput');

    if (inp) {
      let composing = false;

      const updateSearch = () => {
        const pos = inp.selectionStart;
        view.query = inp.value;

        render();

        const newInp = $('searchInput');

        if (newInp) {
          newInp.focus();

          if (pos !== null) {
            newInp.setSelectionRange(pos, pos);
          }
        }
      };

      // 日本語の変換開始
      inp.addEventListener('compositionstart', () => {
        composing = true;
      });

      // 日本語の変換確定
      inp.addEventListener('compositionend', () => {
        composing = false;
        updateSearch();
      });

      // 通常の文字入力
      inp.addEventListener('input', e => {
        if (composing || e.isComposing) return;

        updateSearch();
      });
    }
  }

  if (view.page === 'settings') {
    $('export').onclick = () => { let b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = 'memo-library-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000) }; $('import').onchange = async e => {
      let f = e.target.files[0]; if (!f) return; try {
        let d = JSON.parse(await f.text()); if (!Array.isArray(d.themes) || !Array.isArray(d.notes)) throw Error(); if (confirm('現在のメモをバックアップの内容で置き換えますか？')) {
                    const previousData = data;

          try {
            // 大項目の形式も確認する
            if (
              d.homeSections !== undefined &&
              (
                !Array.isArray(d.homeSections) ||
                !d.homeSections.every(s =>
                  s &&
                  typeof s.id === 'string' &&
                  typeof s.name === 'string' &&
                  Array.isArray(s.themeIds)
                )
              )
            ) {
              throw new Error('大項目のデータ形式が正しくありません');
            }

            data = d;

            // 古いバックアップに大項目がない場合は補う
            await initializeHomeSections();

            if (!(await save())) {
              data = previousData;
              return;
            }

            render();

          } catch (error) {
            data = previousData;
            console.error('バックアップ読み込みエラー:', error);
            alert('バックアップの読み込みに失敗しました。');
          }
        }
      } catch { alert('正しいバックアップファイルではありません') }
    }
  }
}

// 今日の日付を YYYY-MM-DD 形式で取得
function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function form(kind, id) {
  // テーマとメモだけを扱う
  if (kind !== 'theme' && kind !== 'note') return;

  const type = kind === 'theme' ? 'themes' : 'notes';
  const obj = id ? find(type, id) : null;

  const tid =
    obj?.themeId ||
    (view.page === 'theme' ? view.id : '') ||
    data.themes[0]?.id ||
    '';

  const title = kind === 'theme' ? 'テーマ' : 'メモ';

  $('modal').innerHTML = `
    <div class="sheetback" id="shade">
      <div class="sheet">
        <h2>${id ? '編集' : '新規' + title}</h2>

        <form id="editForm">

          <label class="fieldlabel">
            ${kind === 'note' ? 'タイトル' : '名前'}
          </label>

          <input
            class="field"
            name="name"
            maxlength="100"
            required
            value="${esc(obj?.title || obj?.name || '')}"
            placeholder="${title}の名前"
          >

         ${kind === 'theme' ? `
  <label class="fieldlabel">説明</label>
  <textarea class="field" name="desc">${esc(obj?.desc || '')}</textarea>

  <label class="fieldlabel">日付</label>
  <input
    class="field"
    type="date"
    name="themeDate"
    required
    value="${esc(obj?.themeDate || todayString())}"
  >
` : `
            <label class="fieldlabel">本文</label>
            <textarea class="field" name="body">${esc(obj?.body || '')}</textarea>

            <label class="fieldlabel">テーマ</label>
            <select class="field" name="themeId">
              ${data.themes.map(t => `
                <option
                  value="${esc(t.id)}"
                  ${t.id === tid ? 'selected' : ''}
                >
                  ${esc(t.name)}
                </option>
              `).join('')}
            </select>
          `}

          <label class="fieldlabel">カバー画像（任意）</label>

          <input
            class="field"
            type="file"
            name="image"
            accept="image/*"
          >

          <p class="hint">
            写真は小さく圧縮して端末内に保存します。
            大切なデータはバックアップしてください。
          </p>

          <div class="sheetactions">

            ${id ? `
              <button
                type="button"
                class="outline"
                style="color:#ff657b"
                id="delete"
              >
                削除
              </button>
            ` : ''}

            <button
              type="button"
              class="outline"
              id="cancel"
            >
              キャンセル
            </button>

            <button class="action" type="submit">
              保存
            </button>

          </div>
        </form>
      </div>
    </div>
  `;

  const f = $('editForm');

  // キャンセル
  $('cancel').onclick = () => {
    $('modal').innerHTML = '';
  };

  // 背景タップで閉じる
  $('shade').onclick = e => {
    if (e.target.id === 'shade') {
      $('modal').innerHTML = '';
    }
  };

  // 削除
  if (id) {
    $('delete').onclick = async () => {
      if (!confirm(
        kind === 'theme'
          ? 'このテーマと、その中のメモをすべて削除しますか？'
          : 'このメモを削除しますか？'
      )) return;

      if (kind === 'theme') {
        data.notes = data.notes.filter(n => n.themeId !== id);
      }

      data[type] = data[type].filter(x => x.id !== id);

      if (!(await save())) {
        restoreLastSavedData();
        return;
      }

      $('modal').innerHTML = '';
      nav('home');
    };
  }

  // 保存
  f.onsubmit = async e => {
    e.preventDefault();

    const v = f.elements;

    let image = obj?.image || '';

    if (v.image.files[0]) {
      image = await compress(v.image.files[0]);
    }

    let item;

    if (kind === 'note') {
      item = {
        id: id || uid(),
        title: v.name.value.trim(),
        body: v.body.value,
        themeId: v.themeId.value,
        image,
        favorite: obj?.favorite || false,
        updated: Date.now(),
        order: obj?.order
      };
    } else {
      item = {
        id: id || uid(),
        name: v.name.value.trim(),
        desc: v.desc.value,
        themeDate: v.themeDate.value,
        createdAt: obj?.createdAt || Date.now(),
        image,
        favorite: obj?.favorite || false
      };
    }
    if (!item.title && !item.name) return;

    if (id) {
      Object.assign(obj, item);
    } else {
      data[type].push(item);
    }

    // 大項目の中から新しく作ったテーマを登録
    if (kind === 'theme' && !id && window.creatingSectionId) {
      const s = data.homeSections.find(
        x => x.id === window.creatingSectionId
      );

      if (s && !s.themeIds.includes(item.id)) {
        s.themeIds.unshift(item.id);
      }
    }

    // テーマと大項目の情報をまとめて保存
    if (!(await save())) {
      restoreLastSavedData();
      return;
    }

    // 保存成功後に作成先の記憶を消す
    if (kind === 'theme' && !id) {
      window.creatingSectionId = null;
    }

    $('modal').innerHTML = '';

    nav(kind, item.id);
  };
}

// ===== カバー画像から背景色を取得 =====

function getAlbumColor(imageUrl) {
  return new Promise(resolve => {
    if (!imageUrl) {
      resolve('65, 75, 105');
      return;
    }

    const image = new Image();

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;

        const ctx = canvas.getContext('2d', {
          willReadFrequently: true
        });

        ctx.drawImage(image, 0, 0, 24, 24);

        const pixels = ctx.getImageData(0, 0, 24, 24).data;

        let r = 0, g = 0, b = 0, count = 0;

        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] < 128) continue;

          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          count++;
        }

        if (!count) {
          resolve('65, 75, 105');
          return;
        }

        // 暗めに調整して文字を読みやすくする
        const darken = value =>
          Math.round((value / count) * 0.55);

        resolve(
          `${darken(r)}, ${darken(g)}, ${darken(b)}`
        );
      } catch {
        resolve('65, 75, 105');
      }
    };

    image.onerror = () => resolve('65, 75, 105');
    image.src = imageUrl;
  });
}

// ===== メモの並び順 =====

// テーマ内のメモを保存済みの順番で取得
function orderedNotes(themeId) {
  return data.notes
    .filter(n => n.themeId === themeId)
    .sort((a, b) => {
      const ao = Number.isFinite(a.order) ? a.order : -a.updated;
      const bo = Number.isFinite(b.order) ? b.order : -b.updated;
      return ao - bo;
    });
}

// メモを上下に移動
async function moveNote(noteId, direction) {
  const note = find('notes', noteId);
  if (!note) return;

  const notes = orderedNotes(note.themeId);
  const index = notes.findIndex(n => n.id === noteId);
  const next = index + direction;

  if (next < 0 || next >= notes.length) return;

  [notes[index], notes[next]] = [notes[next], notes[index]];

  notes.forEach((n, i) => {
    n.order = i;
  });

  if (!(await save())) {
    restoreLastSavedData();
    render();
    return;
  }

  render();
}

function compress(file) { return new Promise((resolve, reject) => { let r = new FileReader(); r.onload = () => { let i = new Image(); i.onload = () => { let scale = Math.min(1, 800 / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(i.width * scale)); c.height = Math.max(1, Math.round(i.height * scale)); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', .68)) }; i.onerror = reject; i.src = r.result }; r.onerror = reject; r.readAsDataURL(file) }) }

// ===== トップのメモ：編集画面 =====
function editTopNotes() {
  // 保存済みの選択があれば使う
  const selected = Array.isArray(data.topNoteIds)
    ? data.topNoteIds.filter(id => data.notes.some(n => n.id === id)).slice(0, 20)
    : [];

  const notes = data.notes.slice()
    .sort((a, b) => b.updated - a.updated);

  const modal = $('modal');

  modal.innerHTML = `
    <div class="sheetback" id="topnotes-shade">
  <div class="sheet">
      <h2>トップのメモを編集</h2>
      <p class="muted">表示するメモを最大20件まで選んでください。</p>

      <div class="topnotes-picker">
        ${notes.map(n => {
    const theme = find('themes', n.themeId);

    return `
            <label class="topnotes-choice">
              <input
                type="checkbox"
                value="${esc(n.id)}"
                ${selected.includes(n.id) ? 'checked' : ''}
              >
             <span>
  <strong>${esc(n.title || '無題のメモ')}</strong>
  <small>${esc(theme?.name || '未分類')}</small>
</span>

<input
  type="number"
  class="topnotes-order"
  min="1"
  max="20"
  placeholder="順番"
  value="${selected.includes(n.id) ? selected.indexOf(n.id) + 1 : ''}"
  style="width:65px;padding:8px;border-radius:8px;
         border:1px solid #555;background:#222;color:#fff;
         text-align:center;"
>
            </label>
          `;
  }).join('') || '<p class="muted">メモがありません</p>'}
      </div>

      <button type="button" class="primary" data-save-topnotes="1">
        保存する
      </button>

            <button type="button" data-close-topnotes="1">
        キャンセル
      </button>
    </div>
</div>
  `;

  // 番号入力欄の操作でチェックボックスが切り替わるのを防ぐ
  modal.querySelectorAll('.topnotes-order').forEach(input => {
    input.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  // チェックした順番を記録
  let chosen = [...selected];

  modal.querySelectorAll('.topnotes-choice input').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) {
        if (chosen.length >= 20) {
          input.checked = false;
          alert('トップのメモは最大20件までです。');
          return;
        }
        chosen.push(input.value);
      } else {
        chosen = chosen.filter(id => id !== input.value);
      }
    });
  });

  modal.querySelector('[data-save-topnotes]').addEventListener('click', async () => {

    const selectedNotes = [];

    modal.querySelectorAll('.topnotes-choice').forEach(row => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      const orderInput = row.querySelector('.topnotes-order');

      if (!checkbox.checked) return;

      const order = Number(orderInput.value);

      selectedNotes.push({
        id: checkbox.value,
        order
      });
    });

    // 最大20件
    if (selectedNotes.length > 20) {
      alert('トップのメモは最大20件までです。');
      return;
    }

    // 番号が1〜20の整数か確認
    if (selectedNotes.some(n =>
      !Number.isInteger(n.order) ||
      n.order < 1 ||
      n.order > 20
    )) {
      alert('選択したメモには1〜20の番号を入力してください。');
      return;
    }

    // 同じ番号がないか確認
    const orders = selectedNotes.map(n => n.order);

    if (new Set(orders).size !== orders.length) {
      alert('同じ番号は使えません。');
      return;
    }

    // 番号の小さい順に並べる
    selectedNotes.sort((a, b) => a.order - b.order);

    // 並び順を保存
    data.topNoteIds = selectedNotes.map(n => n.id);

    if (!(await save())) {
      restoreLastSavedData();
      return;
    }

    modal.innerHTML = '';
    render();
  });
  // キャンセルボタンを押したときだけ閉じる
  modal.querySelector('[data-close-topnotes]').addEventListener('click', () => {
    modal.innerHTML = '';
  });

  // 編集画面の外側を押したときだけ閉じる
  modal.querySelector('#topnotes-shade').addEventListener('click', e => {
    if (e.target.id === 'topnotes-shade') {
      modal.innerHTML = '';
    }
  });
}

// ===== メモ並べ替えボタン =====
document.addEventListener('click', e => {
  const button = e.target.closest('[data-move]');
  if (!button) return;

  e.preventDefault();
  e.stopPropagation();

  moveNote(button.dataset.id, Number(button.dataset.move));
});

// ===== メモの長押しドラッグ並べ替え：安定版 =====

let sortTimer = null;
let sortRow = null;
let sortPointerId = null;
let sortStartX = 0;
let sortStartY = 0;
let sortCurrentY = 0;
let sortTargetIndex = -1;
let sortPositions = [];
let blockNoteClickUntil = 0;

// ドラッグ状態を解除する
function clearSortState() {
  clearTimeout(sortTimer);
  sortTimer = null;

  if (sortRow) {
    sortRow.classList.remove('dragging');
    sortRow.style.removeProperty('--drag-y');
  }

  document.querySelectorAll('.album-note').forEach(row => {
    row.classList.remove(
      'drag-over',
      'sort-shift-up',
      'sort-shift-down'
    );
  });

  sortRow = null;
  sortPointerId = null;
  sortTargetIndex = -1;
  sortPositions = [];
}

// 長押し開始
document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button')) return;

  const row = e.target.closest('.album-note[data-sort-id]');
  if (!row) return;

  clearSortState();

  sortPointerId = e.pointerId;
  sortStartX = e.clientX;
  sortStartY = e.clientY;
  sortCurrentY = e.clientY;

  sortTimer = setTimeout(() => {
    sortTimer = null;

    if (!row.isConnected) {
      clearSortState();
      return;
    }

    sortRow = row;

    // アニメーションが始まる前の位置を記録する
    sortPositions = [
      ...document.querySelectorAll('.album-note[data-sort-id]')
    ].map(item => {
      const rect = item.getBoundingClientRect();

      return {
        id: item.dataset.sortId,
        centerY: rect.top + rect.height / 2
      };
    });

    sortTargetIndex = sortPositions.findIndex(
      item => item.id === row.dataset.sortId
    );

    row.style.setProperty('--drag-y', '0px');
    row.classList.add('dragging');

    navigator.vibrate?.(30);
  }, 450);
});

// ドラッグ中
document.addEventListener('pointermove', e => {
  if (e.pointerId !== sortPointerId) return;

  sortCurrentY = e.clientY;

  if (!sortRow) {
    if (
      Math.abs(e.clientY - sortStartY) > 8 ||
      Math.abs(e.clientX - sortStartX) > 8
    ) {
      clearSortState();
    }
    return;
  }

  // ドラッグ中のメモをマウスに追従させる
  sortRow.style.setProperty(
    '--drag-y',
    `${e.clientY - sortStartY}px`
  );

  const rows = [
    ...document.querySelectorAll('.album-note[data-sort-id]')
  ];

  const from = rows.indexOf(sortRow);
  if (from < 0) return;

  // 動く前に記録した位置から移動先を計算する
  let to = from;

  for (let i = 0; i < sortPositions.length; i++) {
    if (i > from && e.clientY > sortPositions[i].centerY) {
      to = i;
    }

    if (i < from && e.clientY < sortPositions[i].centerY) {
      to = i;
      break;
    }
  }

  sortTargetIndex = to;

  // 周囲のメモを移動させる
  rows.forEach((row, index) => {
    row.classList.remove(
      'sort-shift-up',
      'sort-shift-down',
      'drag-over'
    );

    if (row === sortRow) return;

    if (from < to && index > from && index <= to) {
      row.classList.add('sort-shift-up');
    }

    if (from > to && index >= to && index < from) {
      row.classList.add('sort-shift-down');
    }
  });
});

// ドラッグ終了
document.addEventListener('pointerup', async e => {
  if (e.pointerId !== sortPointerId) return;

  if (!sortRow) {
    clearSortState();
    return;
  }

  const sourceId = sortRow.dataset.sortId;
  const targetId = sortPositions[sortTargetIndex]?.id;

  blockNoteClickUntil = Date.now() + 600;

  clearSortState();

  if (!targetId || targetId === sourceId) return;

  const note = find('notes', sourceId);
  if (!note) return;

  const notes = orderedNotes(note.themeId);

  const from = notes.findIndex(n => n.id === sourceId);
  const to = notes.findIndex(n => n.id === targetId);

  if (from < 0 || to < 0) return;

  // メモの順番を変更する
  const [moved] = notes.splice(from, 1);
  notes.splice(to, 0, moved);

  // 新しい順番を保存する
  notes.forEach((n, i) => {
    n.order = i;
  });

  if (!(await save())) {
    restoreLastSavedData();
    render();
    return;
  }

  render();
});

// ドラッグがキャンセルされた場合
document.addEventListener('pointercancel', clearSortState);

// ドラッグ直後にメモが開くのを防ぐ
document.addEventListener('click', e => {
  if (
    Date.now() < blockNoteClickUntil &&
    e.target.closest('.album-note')
  ) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

// ===== 新しい大項目を追加 =====
async function addHomeSection() {
  const name = prompt('新しい大項目の名前を入力してください');

  // キャンセルした場合
  if (name === null) return;

  // 空欄の場合
  if (!name.trim()) {
    alert('名前を入力してください。');
    return;
  }

  const newSection = {
    id: uid(),
    name: name.trim(),
    themeIds: []
  };

  data.homeSections.push(newSection);

  if (!(await save())) {
    restoreLastSavedData();
    return;
  }

  render();
}

// ===== 大項目に表示するテーマを選択 =====
function selectSectionThemes(id) {
  const s = data.homeSections.find(x => x.id === id);
  if (!s) return;

  const modal = $('modal');

  modal.innerHTML = `
    <div class="sheetback" id="section-theme-shade">
      <div class="sheet">
        <h2>${esc(s.name)} のテーマを選択</h2>
        <p class="muted">表示したいテーマにチェックを入れてください。</p>

        <div class="topnotes-picker">
          ${data.themes.map(t => `
            <label class="topnotes-choice">
              <input
                type="checkbox"
                value="${esc(t.id)}"
                ${s.themeIds.includes(t.id) ? 'checked' : ''}
              >
              <span>
                <strong>${esc(t.name)}</strong>
              </span>
            </label>
          `).join('') || '<p class="muted">テーマがありません</p>'}
        </div>

        <button type="button" class="primary" data-save-section-themes="1">
          保存する
        </button>

        <button type="button" data-close-section-themes="1">
          キャンセル
        </button>
      </div>
    </div>
  `;

  // 保存
  modal.querySelector('[data-save-section-themes]').addEventListener('click', async () => {
    const oldIds = [...s.themeIds];

    s.themeIds = [
      ...modal.querySelectorAll('.topnotes-choice input:checked')
    ].map(input => input.value);

    if (!(await save())) {
      restoreLastSavedData();
      return;
    }

    modal.innerHTML = '';
    render();
  });

  // キャンセル
  modal.querySelector('[data-close-section-themes]').addEventListener('click', () => {
    modal.innerHTML = '';
  });

  // 背景を押したら閉じる
  modal.querySelector('#section-theme-shade').addEventListener('click', e => {
    if (e.target.id === 'section-theme-shade') {
      modal.innerHTML = '';
    }
  });
}

// ===== 大項目の名前を編集 =====
async function editHomeSection(id) {
  const s = data.homeSections.find(x => x.id === id);
  if (!s) return;

  const action = prompt(
    `「${s.name}」を編集します。\n\n名前を変更する場合：新しい名前を入力\n削除する場合：「削除」と入力`,
    s.name
  );

  if (action === null) return;

  if (action.trim() === '削除') {
    const confirmed = confirm(
      `「${s.name}」を削除しますか？\n\nこの大項目に含まれるテーマとメモもすべて削除されます。\nこの操作は取り消せません。`
    );

    if (!confirmed) return;

    const themeIds = new Set(s.themeIds);

    const oldSections = data.homeSections;
    const oldThemes = data.themes;
    const oldNotes = data.notes;

    data.homeSections = data.homeSections.filter(x => x.id !== id);
    data.themes = data.themes.filter(t => !themeIds.has(t.id));
    data.notes = data.notes.filter(n => !themeIds.has(n.themeId));

    if (!(await save())) {
      data.homeSections = oldSections;
      data.themes = oldThemes;
      data.notes = oldNotes;
      return;
    }

    render();
    return;
  }

  const newName = action;

  // キャンセルした場合
  if (newName === null) return;

  // 空欄の場合
  if (!newName.trim()) {
    alert('名前を入力してください。');
    return;
  }

  const oldName = s.name;
  s.name = newName.trim();

  if (!(await save())) {
    s.name = oldName;
    return;
  }

  render();
}

// ===== ホームカバー画像の変更 =====
function editHomeHero() {
  const input = document.createElement('input');

  input.type = 'file';
  input.accept = 'image/*';

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    try {
      const image = await compress(file);

      const previousImage = data.homeHeroImage || '';

      data.homeHeroImage = image;

      if (!(await save())) {
        data.homeHeroImage = previousImage;
        return;
      }

      render();
    } catch (error) {
      alert('画像を読み込めませんでした。別の画像を試してください。');
    }
  };

  input.click();
}

document.addEventListener('click', async e => {
  // 大項目の中から新しいテーマを作成
  const newSectionThemeButton = e.target.closest('[data-new-section-theme]');

  if (newSectionThemeButton) {
    const sectionId = newSectionThemeButton.dataset.newSectionTheme;

    // 作成先の大項目が存在するか確認
    const section = data.homeSections.find(s => s.id === sectionId);

    if (!section) {
      alert('大項目が見つかりません。');
      return;
    }

    // 作成先を記憶
    window.creatingSectionId = sectionId;

    form('theme');
    return;
  }

  // 大項目の専用ページを開く
  const openSectionButton = e.target.closest('[data-open-section]');

  if (openSectionButton) {
    nav('homeSection', openSectionButton.dataset.openSection);
    return;
  }

  // 大項目のテーマ選択
  const selectButton = e.target.closest('[data-select-section-themes]');

  if (selectButton) {
    selectSectionThemes(selectButton.dataset.selectSectionThemes);
    return;
  }

  // 大項目を追加
  if (e.target.closest('[data-add-section]')) {
    addHomeSection();
    return;
  }

  // 大項目の編集ボタン
  const sectionButton = e.target.closest('[data-edit-section]');

  if (sectionButton) {
    editHomeSection(sectionButton.dataset.editSection);
    return;
  }

  // ホームの大きなカバー画像を変更
  if (e.target.closest('[data-edit-hero]')) {
    editHomeHero();
    return;
  }

  // トップのメモの編集ボタン
  if (e.target.closest('[data-edit-topnotes]')) {
    editTopNotes();
    return;
  }

  let x = e.target.closest('[data-tab],[data-open],[data-new],[data-edit],[data-fav],[data-back]');
  if (!x) return;

  // タブ切り替え
  if (x.dataset.tab) {
    view.tab = x.dataset.tab;
    nav(x.dataset.tab === 'home' ? 'home' : x.dataset.tab);
  }

  // テーマ・メモを開く
  else if (x.dataset.open) {
    nav(x.dataset.open, x.dataset.id);
  }

  // 新規作成
  else if (x.dataset.new) {
    let kind = x.dataset.new;

    if (kind === 'note' && !data.themes.length) {
      return alert('先にテーマを作成してください');
    }

    form(kind);
  }

  // 編集
  else if (x.dataset.edit) {
    e.stopPropagation();
    form(x.dataset.edit, x.dataset.id);
  }

  // お気に入り
  else if (x.dataset.fav) {
    let type = x.dataset.fav === 'theme' ? 'themes' : 'notes';
    let obj = find(type, x.dataset.id);

    if (!obj) return;


    obj.favorite = !obj.favorite;

    if (!(await save())) {
      restoreLastSavedData();
      render();
      return;
    }

    render();
  }

  // 戻る
  else if (x.dataset.back) {
    if (view.page === 'note') {
      let n = find('notes', view.id);

      // コレクションではなく、所属テーマに戻る
      nav(n?.themeId ? 'theme' : 'home', n?.themeId || null);
    } else {
      nav('home');
    }
  }
}); document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open]')) { e.preventDefault(); nav(e.target.dataset.open, e.target.dataset.id) } });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => { });
}

// IndexedDBの読み込み完了後にアプリを表示する
async function bootApp() {
  const ok = await initializeIndexedDBStorage();

  if (!ok) {
    document.getElementById('app').innerHTML =
      '<div class="content">データを読み込めませんでした。ページを再読み込みしてください。</div>';
    return;
  }

  render();
}

bootApp();