const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ─── CORS — разрешаем запросы из игры ────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-DA-Secret');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));

// ============================================================
// НАСТРОЙКИ — замени на свои!
// ============================================================
const DA_SECRET_KEY   = process.env.DA_SECRET  || '';      // Секретный ключ из DonationAlerts
const ADMIN_PASSWORD  = process.env.ADMIN_PASS || 'admin123';
const DA_URL          = process.env.DA_URL     || '';      // Ссылка на страницу доната
// ============================================================

// ─── Хранилище ────────────────────────────────────────────
// Vercel KV (если подключён в дашборде) → файл → память.
// На Vercel без KV данные живут только до перезапуска — подключи KV!
const DB_KEY = 'fantazia_shop_users';
const KV_ON = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
let kv = null, kvTried = false;
async function kvLoad() {
  if (!KV_ON || kvTried) return kv;
  kvTried = true;
  try { kv = require('@vercel/kv').kv || null; }
  catch (e1) {
    try { kv = (await import('@vercel/kv')).kv || null; }
    catch (e2) { console.log('KV unavailable:', e2.message); }
  }
  return kv;
}
function pickWritableFile() {
  const cands = [path.join(__dirname, 'users.json'), path.join('/tmp', 'fantazia-users.json')];
  for (const f of cands) {
    try { fs.appendFileSync(f, ''); return f; } catch (e) {}
  }
  return null;
}
const DB_FILE = pickWritableFile();
let memDB = {};
async function loadDB() {
  if (kv) { try { return (await kv.get(DB_KEY)) || {}; } catch (e) {} }
  if (DB_FILE) { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { return {}; } }
  return memDB;
}
async function saveDB(db) {
  const k = await kvLoad();
  if (k) { try { await k.set(DB_KEY, db); return; } catch (e) {} }
  if (DB_FILE) { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); return; } catch (e) {} }
  memDB = db;
}
async function getOrCreateUser(nick) {
  const db = await loadDB();
  const key = String(nick || '').toLowerCase().trim();
  if (!db[key]) db[key] = { gems: 0, pendingGems: 0, donations: [], items: [], equippedItems: {} };
  return { db, key };
}
// Обёртка для async-роутов (express 4 не ловит reject сам)
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ─── Маппинг: предмет магазина → свойства персонажа ──────
// Эти цвета/аксессуары применяются к персонажу в игре
const ITEM_GAME_MAP = {
  'Кожаная куртка':        { shirtColor: '#1a1a1a' },
  'Кимоно Тёмной Луны':    { shirtColor: '#2E0A5A', pantsColor: '#0A0A2E' },
  'Уличный худи':          { shirtColor: '#3D3D3D' },
  'Деловой костюм':        { shirtColor: '#1C2B4A', pantsColor: '#1C2B4A' },
  'Неоновый топ':          { shirtColor: '#FF00DD' },
  'Шарф Арктики':          { shirtColor: '#DDEEFF' },
  'Камуфляжные штаны':     { pantsColor: '#4A5340' },
  'Платье Звёздной ночи':  { shirtColor: '#0A0A4A', pantsColor: '#0A0A4A' },
  'Корона Королей':        { accessory: 'crown' },
  'Тёмные очки':           { accessory: 'glasses' },
  'Золотые часы':          { accessory: 'chain' },
  'Ожерелье Дракона':      { accessory: 'chain' },
  'Цилиндр джентльмена':   { accessory: 'tophat' },
  'Кольцо силы':           { accessory: 'halo' },
  'Маска Тени':            { accessory: 'mask' },
  'Перчатки ниндзя':       { accessory: 'cap' },
  'Шляпа ковбоя':          { accessory: 'cap' },
  'Бронежилет':            { shirtColor: '#3A3A3A' },
  // Предметы из бокса
  'Кепка':                 { accessory: 'cap' },
  'Мини-корона':           { accessory: 'crown' },
};

// ─── Пакеты кристаллов ────────────────────────────────────
const PACKS = [
  { priceRub: 59,   gems: 60   },
  { priceRub: 139,  gems: 150  },
  { priceRub: 269,  gems: 320  },
  { priceRub: 549,  gems: 700  },
  { priceRub: 999,  gems: 1500 },
  { priceRub: 1999, gems: 3500 },
];

function calcGems(amount) {
  const rubles = Math.round(parseFloat(amount));
  const exact = PACKS.find(p => p.priceRub === rubles);
  return exact ? exact.gems : Math.max(1, Math.floor(rubles * 1.75));
}

// ─── ВЕБХУК DonationAlerts ────────────────────────────────
// Настрой: DA → Настройки → Интеграции → Custom Webhook
// URL: https://ТВОЙ-ПРОЕКТ.vercel.app/webhook/da
// Secret Key: тот же что в DA_SECRET
app.post('/webhook/da', ah(async (req, res) => {
  try {
    // Проверка секретного ключа (если настроен)
    if (DA_SECRET_KEY) {
      const incoming = req.headers['x-da-secret'] || (req.body && req.body.secret);
      if (incoming !== DA_SECRET_KEY) {
        console.log('⚠️ Неверный секретный ключ вебхука!');
        return res.status(403).json({ ok: false, error: 'wrong secret' });
      }
    }

    const { username, message, amount, alert_type } = req.body || {};
    console.log('🔔 DA Webhook:', JSON.stringify(req.body));

    if (alert_type && alert_type !== 1) return res.json({ ok: true, skip: true });
    if (!message || !amount) return res.json({ ok: false, error: 'no message/amount' });

    // Формат сообщения: "NICKNAME | Название пакета"
    const nick = String(message).split('|')[0].trim();
    if (!nick || nick.length < 1) return res.json({ ok: false, error: 'no nick' });

    const gems = calcGems(amount);
    const { db, key } = await getOrCreateUser(nick);
    db[key].pendingGems = (db[key].pendingGems || 0) + gems;
    db[key].donations.push({
      gems, amount: parseFloat(amount),
      daUser: username || '?', message,
      date: new Date().toISOString(), verified: true
    });
    await saveDB(db);

    console.log(`✅ РЕАЛЬНЫЙ ДОНАТ: ${gems} кристаллов → ${nick} (${amount}₽ от ${username})`);
    res.json({ ok: true, nick, gems });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
}));

// ─── API: конфиг магазина (пакеты + ссылка DA) ────────────
app.get('/api/config', (req, res) => {
  res.json({ ok: true, packs: PACKS, daUrl: DA_URL });
});

// ─── API: данные пользователя ─────────────────────────────
app.get('/api/user/:nick', ah(async (req, res) => {
  const { db, key } = await getOrCreateUser(req.params.nick);
  const u = db[key];
  res.json({
    gems: u.gems || 0,
    pendingGems: u.pendingGems || 0,
    items: u.items || [],
    equippedItems: u.equippedItems || {}
  });
}));

// ─── API: получить вид персонажа для игры ────────────────
// Игра запрашивает это при старте и применяет к персонажу
app.get('/api/user/:nick/appearance', ah(async (req, res) => {
  const { db, key } = await getOrCreateUser(req.params.nick);
  const u = db[key];
  const ownedItems = (u.items || []).map(i => i.name);
  const equipped = u.equippedItems || {};

  // Собираем внешний вид из экипированных предметов
  let appearance = {};
  if (equipped.shirt && ITEM_GAME_MAP[equipped.shirt]) {
    Object.assign(appearance, ITEM_GAME_MAP[equipped.shirt]);
  }
  if (equipped.pants && ITEM_GAME_MAP[equipped.pants]) {
    Object.assign(appearance, ITEM_GAME_MAP[equipped.pants]);
  }
  if (equipped.accessory && ITEM_GAME_MAP[equipped.accessory]) {
    Object.assign(appearance, ITEM_GAME_MAP[equipped.accessory]);
  }

  res.json({ ok: true, appearance, ownedItems, equippedItems: equipped });
}));

// ─── API: забрать ожидающие кристаллы ────────────────────
app.post('/api/user/:nick/claim', ah(async (req, res) => {
  const { db, key } = await getOrCreateUser(req.params.nick);
  const pending = db[key].pendingGems || 0;
  if (pending <= 0) return res.json({ ok: true, added: 0, gems: db[key].gems || 0 });
  db[key].gems = (db[key].gems || 0) + pending;
  db[key].pendingGems = 0;
  await saveDB(db);
  console.log(`💎 ${key} забрал ${pending} кристаллов. Итого: ${db[key].gems}`);
  res.json({ ok: true, added: pending, gems: db[key].gems });
}));

// ─── API: экипировать предмет ─────────────────────────────
app.post('/api/user/:nick/equip', ah(async (req, res) => {
  const { itemName, slot } = req.body; // slot: 'shirt'|'pants'|'accessory'|'fx'
  const { db, key } = await getOrCreateUser(req.params.nick);
  if (!db[key].equippedItems) db[key].equippedItems = {};
  // Снятие предмета
  if (itemName === '__none__') {
    delete db[key].equippedItems[slot];
    await saveDB(db);
    return res.json({ ok: true, equippedItems: db[key].equippedItems });
  }
  const owned = (db[key].items || []).map(i => i.name);
  if (!owned.includes(itemName)) return res.json({ ok: false, error: 'not owned' });

  db[key].equippedItems[slot] = itemName;
  await saveDB(db);
  res.json({ ok: true, equippedItems: db[key].equippedItems });
}));

// ─── API: потратить кристаллы ─────────────────────────────
app.post('/api/user/:nick/spend', ah(async (req, res) => {
  const { amount, item } = req.body;
  const { db, key } = await getOrCreateUser(req.params.nick);
  if ((db[key].gems || 0) < amount) return res.json({ ok: false, error: 'not_enough' });
  db[key].gems -= amount;
  if (item) {
    if (!db[key].items) db[key].items = [];
    if (!db[key].items.find(i => i.name === item.name)) {
      db[key].items.push({ ...item, date: new Date().toISOString() });
    }
  }
  await saveDB(db);
  res.json({ ok: true, gems: db[key].gems });
}));

// ─── ADMIN: ручная выдача ────────────────────────────────
app.post('/api/admin/give', ah(async (req, res) => {
  const { pass, nick, gems } = req.body;
  if (pass !== ADMIN_PASSWORD) return res.status(403).json({ ok: false });
  const { db, key } = await getOrCreateUser(nick);
  db[key].pendingGems = (db[key].pendingGems || 0) + parseInt(gems);
  await saveDB(db);
  res.json({ ok: true, nick, gems: parseInt(gems) });
}));

// ─── Страницы ─────────────────────────────────────────────
// Docker: public/fantazia-shop.html · Vercel/локально: корень
function shopPage(req, res) {
  const p1 = path.join(__dirname, 'public', 'fantazia-shop.html');
  const p2 = path.join(__dirname, 'fantazia-shop.html');
  res.sendFile(fs.existsSync(p1) ? p1 : p2);
}
app.get('/shop', shopPage);
app.get('/', shopPage);

// ─── Ошибки ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('API error:', err);
  res.status(500).json({ ok: false, error: 'internal' });
});

// Локально/Docker — слушаем порт. На Vercel файл подключается как модуль.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Fantazia сервер запущен на порту ${PORT}`);
    console.log(`📡 Вебхук DA: POST /webhook/da`);
    console.log(`🎮 Игра: GET /api/user/:nick/appearance`);
    console.log(`💾 База: ${kv ? 'Vercel KV' : (DB_FILE || 'память (не сохраняется!)')}`);
  });
}

module.exports = app;
