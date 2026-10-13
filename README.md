# 💎 Fantazia Shop — магазин кристаллов

Отдельный сервер магазина для Fantazia RP: пакеты кристаллов за рубли (DonationAlerts), 24 предмета (одежда, аксессуары, анимированные FX), админ-выдача. Купленный вид персонажа игра забирает через API.

## Запуск

```bash
npm install
node server.js
```

Магазин: http://localhost:3000 (или `/shop`)

## Настройка доната (DonationAlerts)

```bash
DA_SECRET=твой_секрет DA_URL=https://www.donationalerts.com/r/твой_ник node server.js
```

- В DA: Настройки → Интеграции → Custom Webhook → URL `http(s)://твой-сервер:3000/webhook/da`, Secret Key = `DA_SECRET`.
- Донатер в сообщении пишет: `НИК_ИЗ_ИГРЫ | 150 кристаллов`
- Пакеты: 59₽→60 · 139₽→150 · 269₽→320 · 549₽→700 · 999₽→1500 · 1999₽→3500 (своя сумма = 1.75 gems/₽)

## API

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/config` | пакеты + ссылка DA |
| GET | `/api/user/:nick` | баланс, предметы, экипировка |
| GET | `/api/user/:nick/appearance` | **вид для игры** (цвета + аксессуар) |
| POST | `/api/user/:nick/claim` | забрать ожидающие кристаллы |
| POST | `/api/user/:nick/spend` | купить (`{amount, item}`) |
| POST | `/api/user/:nick/equip` | надеть (`{itemName, slot}`), снять (`{itemName:'__none__', slot}`) |
| POST | `/api/admin/give` | выдача (`{pass, nick, gems}`, пароль `ADMIN_PASS` / `admin123`) |
| POST | `/webhook/da` | вебхук DonationAlerts |

## Docker

```bash
docker build -t fantazia-shop .
docker run -p 3000:3000 -e DA_SECRET=... -e DA_URL=... fantazia-shop
```
