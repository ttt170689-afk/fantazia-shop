const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// НАСТРОЙКИ — замени на свои значения
// ============================================================
const DA_SECRET_KEY = process.env.DA_SECRET || ''; // секрет из DA (необязательно)
const ADMIN_PASSWORD = process.env.ADMIN_PASS || 'admin123'; // пароль для ручной выдачи
// ============================================================

const DB_FILE = './users.json';

// Пакеты кристаллов (цена → кристаллы)
const PACKS = [
  { priceRub: 59,   gems: 60   },
  { priceRub: 139,  gems: 150  },
  { priceRub: 269,  gems: 320  },
  { priceRub: 549,  gems: 700  },
  { priceRub: 999,  gems: 1500 },
  { priceRub: 1999, gems: 3500 },
];

// ─── БД (простой JSON файл) ───────────────────────────────
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return {}; }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function getOrCreateUser(nick) {
  const db = loadDB();
  const key = nick.toLowerCase().trim();
  if (!db[key]) db[key] = { gems: 0, pendingGems: 0, donations: [], items: [] };
  return { db, key };
}

// ─── Считаем кристаллы по сумме доната ───────────────────
function calcGems(amount) {
  const rubles = Math.round(parseFloat(amount));
  const exact = PACKS.find(p => p.priceRub === rubles);
  if (exact) return exact.gems;
  // Если сумма не совпадает с пакетом — выдаём пропорционально
  return Math.max(1, Math.floor(rubles * 1.75));
}

// ─── ВЕБХУК от DonationAlerts ─────────────────────────────
// Настрой в DA: Настройки → Интеграции → Custom webhook
// URL: https://ТВОй-СЕРВЕР.onrender.com/webhook/da
app.post('/webhook/da', (req, res) => {
  try {
    console.log('🔔 DA Webhook получен:', JSON.stringify(req.body));
    const { username, message, amount, alert_type } = req.body;

    // Принимаем только донаты (alert_type = 1)
    if (alert_type && alert_type !== 1) return res.json({ ok: true, skip: true });
    if (!message || !amount) return res.json({ ok: false, error: 'no message/amount' });

    // Формат сообщения: "NICKNAME | Название пакета"
    const parts = message.split('|');
    const nick = parts[0].trim();
    if (!nick) return res.json({ ok: false, error: 'no nick in message' });

    const gems = calcGems(amount);
    const { db, key } = getOrCreateUser(nick);

    db[key].pendingGems = (db[key].pendingGems || 0) + gems;
    db[key].donations.push({
      gems,
      amount: parseFloat(amount),
      daUser: username || '?',
      message,
      date: new Date().toISOString()
    });
    saveDB(db);

    console.log(`✅ ${gems} кристаллов → ${nick} (ожидает получения)`);
    res.json({ ok: true, nick, gems });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── API: получить данные пользователя ───────────────────
app.get('/api/user/:nick', (req, res) => {
  const { db, key } = getOrCreateUser(req.params.nick);
  const u = db[key];
  res.json({
    gems: u.gems || 0,
    pendingGems: u.pendingGems || 0,
    items: u.items || []
  });
});

// ─── API: забрать ожидающие кристаллы ────────────────────
app.post('/api/user/:nick/claim', (req, res) => {
  const { db, key } = getOrCreateUser(req.params.nick);
  const pending = db[key].pendingGems || 0;
  if (pending <= 0) return res.json({ ok: true, added: 0, gems: db[key].gems || 0 });

  db[key].gems = (db[key].gems || 0) + pending;
  db[key].pendingGems = 0;
  saveDB(db);

  console.log(`💎 ${key} забрал ${pending} кристаллов. Итого: ${db[key].gems}`);
  res.json({ ok: true, added: pending, gems: db[key].gems });
});

// ─── API: потратить кристаллы (покупка предмета) ─────────
app.post('/api/user/:nick/spend', (req, res) => {
  const { amount, item } = req.body;
  const { db, key } = getOrCreateUser(req.params.nick);

  if ((db[key].gems || 0) < amount) {
    return res.json({ ok: false, error: 'not_enough' });
  }
  db[key].gems -= amount;
  if (item) {
    if (!db[key].items) db[key].items = [];
    db[key].items.push({ ...item, date: new Date().toISOString() });
  }
  saveDB(db);
  res.json({ ok: true, gems: db[key].gems });
});

// ─── ADMIN: ручная выдача кристаллов ─────────────────────
// POST /api/admin/give  { pass, nick, gems }
app.post('/api/admin/give', (req, res) => {
  const { pass, nick, gems } = req.body;
  if (pass !== ADMIN_PASSWORD) return res.status(403).json({ ok: false, error: 'wrong password' });
  if (!nick || !gems) return res.json({ ok: false, error: 'need nick and gems' });

  const { db, key } = getOrCreateUser(nick);
  db[key].pendingGems = (db[key].pendingGems || 0) + parseInt(gems);
  saveDB(db);

  console.log(`👑 Ручная выдача: ${gems} кристаллов → ${nick}`);
  res.json({ ok: true, nick, gems: parseInt(gems) });
});

// ─── Страницы ─────────────────────────────────────────────
app.get('/shop', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fantazia-shop.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fantazia-shop.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Fantazia сервер запущен на порту ${PORT}`);
  console.log(`📡 Вебхук DA: /webhook/da`);
  console.log(`🎮 Игра: /`);
  console.log(`🛒 Магазин: /shop`);
});
