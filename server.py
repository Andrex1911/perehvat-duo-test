"""PEREHVAT v2.1 FastAPI backend; demo is enabled by default.

Production requirements: HTTPS, real YooKassa credentials, sale terms, 54-FZ receipt
settings and durable server storage/backup. This source contains no credentials.
"""
from __future__ import annotations

import hmac
import os
import re
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from story import EPISODES, get_catalog, get_nodes, PRICES, ALL6, BUNDLES, SEASONS
from duo_api import router as duo_router

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / '.env')
MODE = os.getenv('PAYMENT_MODE', 'demo').strip().lower()
SHOP = os.getenv('YOOKASSA_SHOP_ID', '').strip()
SECRET = os.getenv('YOOKASSA_SECRET_KEY', '').strip()
# Public URL is auto-detected for Railway HTTPS deployments. Explicit override wins.
PUBLIC_DOMAIN = os.getenv('RAILWAY_PUBLIC_DOMAIN', '').strip()
BASE_URL = (os.getenv('PUBLIC_BASE_URL', '').strip() or
            (f'https://{PUBLIC_DOMAIN}' if PUBLIC_DOMAIN else 'http://127.0.0.1:8000')).rstrip('/')
INCLUDE_RECEIPT = os.getenv('YOOKASSA_INCLUDE_RECEIPT', 'true').strip().lower() == 'true'
VAT_CODE = int(os.getenv('YOOKASSA_VAT_CODE', '1'))
DB_FILE = BASE / 'data' / 'perehvat.sqlite3'
DB_FILE.parent.mkdir(parents=True, exist_ok=True)
SESSION_COOKIE = 'perehvat_v2_session'  # Retained for v2.0 existing visitors.
COOKIE_MAX_AGE = 90 * 86400

if MODE not in ('demo', 'yookassa'):
    raise RuntimeError('PAYMENT_MODE must be demo or yookassa')
if MODE == 'yookassa' and not (SHOP and SECRET and BASE_URL.startswith('https://')):
    raise RuntimeError('YooKassa mode requires HTTPS PUBLIC_BASE_URL and valid credentials')

app = FastAPI(title='PEREHVAT', version='7.6.0', docs_url=None, redoc_url=None)
app.include_router(duo_router)
app.mount('/static', StaticFiles(directory=BASE / 'static'), name='static')


def now():
    return datetime.now(timezone.utc).isoformat()


def connect():
    c = sqlite3.connect(DB_FILE, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    return c


def init_db():
    with connect() as c:
        c.execute('''CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY, created_at TEXT NOT NULL,
            last_theme TEXT NOT NULL DEFAULT 'color')''')
        c.execute('''CREATE TABLE IF NOT EXISTS entitlements (
            sid TEXT NOT NULL, product_id TEXT NOT NULL, created_at TEXT NOT NULL,
            PRIMARY KEY(sid, product_id))''')
        c.execute('''CREATE TABLE IF NOT EXISTS payments (
            sid TEXT NOT NULL, product_id TEXT NOT NULL, payment_id TEXT,
            order_id TEXT, confirmation_url TEXT,
            succeeded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
            PRIMARY KEY(sid, product_id))''')
        c.execute('''CREATE TABLE IF NOT EXISTS progress (
            sid TEXT NOT NULL, episode_id TEXT NOT NULL,
            node_id TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(sid, episode_id))''')
        c.execute('CREATE INDEX IF NOT EXISTS payments_pid ON payments(payment_id)')


init_db()


def find_session(request: Request):
    sid = request.cookies.get(SESSION_COOKIE, '')
    if not sid or len(sid) > 128:
        return None
    with connect() as c:
        row = c.execute('SELECT * FROM sessions WHERE sid=?', (sid,)).fetchone()
    return dict(row) if row else None


def require_session(request: Request):
    row = find_session(request)
    if row is None:
        raise HTTPException(401, 'Сессия не найдена. Обновите страницу.')
    return row


def get_entitlements(sid: str):
    with connect() as c:
        rows = c.execute('SELECT product_id FROM entitlements WHERE sid=?', (sid,)).fetchall()
    return {r['product_id'] for r in rows}


def episode_unlocked(epid: str, entitlements: set[str]) -> bool:
    if epid in entitlements:
        return True
    for b in BUNDLES + SEASONS:
        if b['id'] in entitlements and epid in b['episode_ids']:
            return True
    return False


def visible_status(row):
    return {
        'demo': MODE == 'demo', 'mode': MODE,
        'theme': (row['last_theme'] or 'color') if row else 'color',
        'entitlements': sorted(get_entitlements(row['sid'])) if row else [],
        'prices': PRICES,
    }


def progress_for(sid):
    with connect() as c:
        rows = c.execute('SELECT episode_id,node_id,completed,updated_at FROM progress WHERE sid=?', (sid,)).fetchall()
    return {r['episode_id']: dict(r) for r in rows}


def product_payload(pid):
    duo_cases={
        'duo_room_zero':'ПЕРЕХВАТ DUO — Квартира 0',
        'duo_scarlet_letter':'ПЕРЕХВАТ DUO — Алое письмо',
        'duo_white_route':'ПЕРЕХВАТ DUO — Белый рейс',
    }
    if pid in duo_cases:
        return duo_cases[pid], 99
    if pid == 'duo_bundle3':
        return 'ПЕРЕХВАТ DUO — 3 расследования для двоих', 259
    if pid == 'duo_season':
        return 'ПЕРЕХВАТ DUO — сезонный доступ к 3 расследованиям', 499
    if pid in EPISODES:
        return f"ПЕРЕХВАТ: {EPISODES[pid]['meta']['title']}", PRICES['episode']
    for b in BUNDLES + SEASONS:
        if b['id'] == pid:
            return f"ПЕРЕХВАТ: {b['title']}", b['price_rub']
    raise HTTPException(404, 'Продукт не найден')


def owned_product(pid, entitlements):
    if pid in EPISODES:
        return episode_unlocked(pid, entitlements)
    return pid in entitlements


@app.middleware('http')
async def security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    resp.headers['X-Frame-Options'] = 'DENY'
    resp.headers['Permissions-Policy'] = 'camera=(self), microphone=(), geolocation=()'
    if request.url.path.startswith('/api/'):
        resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.get('/')
def home():
    return FileResponse(BASE / 'static' / 'duo.html')


@app.get('/duo')
def duo_home():
    return FileResponse(BASE / 'static' / 'duo.html')


@app.get('/classic')
def classic_home():
    return FileResponse(BASE / 'static' / 'index.html')


@app.get('/legal')
def legal():
    return FileResponse(BASE / 'static' / 'legal.html')


@app.get('/offline')
def offline():
    return FileResponse(BASE / 'static' / 'offline.html')


@app.get('/manifest.webmanifest')
def manifest():
    return FileResponse(BASE / 'static' / 'manifest.webmanifest', media_type='application/manifest+json')


@app.get('/service-worker.js')
def service_worker():
    response = FileResponse(BASE / 'static' / 'service-worker.js', media_type='application/javascript')
    response.headers['Service-Worker-Allowed'] = '/'
    return response


@app.get('/health')
def health():
    return {'ok': True, 'app': 'PEREHVAT', 'version': '7.4.0'}


@app.post('/api/session')
def session(request: Request):
    row = find_session(request)
    resp = JSONResponse({'status': visible_status(row)})
    if row is None:
        sid = secrets.token_urlsafe(36)
        with connect() as c:
            c.execute('INSERT INTO sessions (sid, created_at) VALUES (?,?)', (sid, now()))
        resp.set_cookie(SESSION_COOKIE, sid, max_age=COOKIE_MAX_AGE,
                        secure=BASE_URL.startswith('https://'), httponly=True,
                        samesite='lax', path='/')
    return resp


@app.get('/api/catalog')
def catalog(request: Request):
    row = require_session(request)
    ent = get_entitlements(row['sid'])
    data = get_catalog()
    progress = progress_for(row['sid'])
    for ep in data['episodes']:
        ep['unlocked'] = episode_unlocked(ep['id'], ent)
        ep['price_rub'] = PRICES['episode']
        ep['progress'] = progress.get(ep['id'])
    for b in data['bundles'] + data['seasons']:
        b['owned'] = b['id'] in ent
    data['all6'] = next(s for s in data['seasons'] if s['id'] == 'all6')
    data['status'] = visible_status(row)
    return data


@app.get('/api/story/{episode_id}')
def story(episode_id: str, request: Request):
    if episode_id not in EPISODES:
        raise HTTPException(404, 'Эпизод не найден')
    row = require_session(request)
    unlocked = episode_unlocked(episode_id, get_entitlements(row['sid']))
    return {
        'episode': EPISODES[episode_id]['meta'],
        'nodes': get_nodes(episode_id, unlocked),
        'unlocked': unlocked,
        'status': visible_status(row),
        'progress': progress_for(row['sid']).get(episode_id),
        'prices': PRICES,
    }


class ProgressUpdate(BaseModel):
    node_id: str = Field(min_length=1, max_length=40)


@app.post('/api/progress/{episode_id}')
def save_progress(episode_id: str, body: ProgressUpdate, request: Request):
    if episode_id not in EPISODES:
        raise HTTPException(404, 'Эпизод не найден')
    row = require_session(request)
    unlocked = episode_unlocked(episode_id, get_entitlements(row['sid']))
    nodes = {n['id']: n for n in get_nodes(episode_id, unlocked)}
    if body.node_id not in nodes:
        raise HTTPException(403, 'Сцена заблокирована или отсутствует')
    node = nodes[body.node_id]
    with connect() as c:
        c.execute('''INSERT INTO progress (sid,episode_id,node_id,completed,updated_at)
            VALUES (?,?,?,?,?) ON CONFLICT(sid,episode_id)
            DO UPDATE SET node_id=excluded.node_id,
            completed=MAX(progress.completed, excluded.completed), updated_at=excluded.updated_at''',
            (row['sid'], episode_id, body.node_id, int(node['kind']=='ending'), now()))
    return {'ok': True, 'node_id': body.node_id, 'completed': node['kind']=='ending'}


class ThemeBody(BaseModel):
    theme: str = Field(pattern='^(classic|color)$')


@app.post('/api/theme')
def set_theme(body: ThemeBody, request: Request):
    row = require_session(request)
    with connect() as c:
        c.execute('UPDATE sessions SET last_theme=? WHERE sid=?', (body.theme, row['sid']))
    return {'ok': True, 'theme': body.theme}


class DemoUnlockBody(BaseModel):
    product_id: str = Field(min_length=1, max_length=50)


@app.post('/api/demo-unlock')
def demo_unlock(body: DemoUnlockBody, request: Request):
    if MODE != 'demo':
        raise HTTPException(403, 'Бесплатная разблокировка доступна только в деморежиме')
    row = require_session(request)
    product_payload(body.product_id)
    with connect() as c:
        c.execute('INSERT OR IGNORE INTO entitlements VALUES (?,?,?)',
                  (row['sid'], body.product_id, now()))
    return {'ok': True, 'entitlements': sorted(get_entitlements(row['sid']))}


class CheckoutBody(BaseModel):
    product_id: str = Field(min_length=1, max_length=50)
    email: str = Field(default='', max_length=254)


def email_ok(s):
    return bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', s))


def payment_request(path, *, payload=None, key=None):
    headers = {'Accept': 'application/json'}
    if key:
        headers['Idempotence-Key'] = key
    with httpx.Client(timeout=15.0, follow_redirects=False) as client:
        params = {'auth': (SHOP, SECRET), 'headers': headers}
        if payload is not None:
            params['json'] = payload
        resp = client.request('POST' if payload is not None else 'GET',
                              'https://api.yookassa.ru/v3' + path, **params)
        resp.raise_for_status()
        return resp.json()


def confirm_payment(session_row, payment_row):
    """Never unlock based on a user callback or webhook body without a fresh provider GET."""
    if not payment_row or MODE != 'yookassa' or not payment_row['payment_id']:
        return False
    pay = payment_request('/payments/' + payment_row['payment_id'])
    _, price = product_payload(payment_row['product_id'])
    amount = pay.get('amount') or {}
    meta = pay.get('metadata') or {}
    verified = (
        pay.get('id') == payment_row['payment_id']
        and pay.get('status') == 'succeeded'
        and pay.get('paid') is True
        and amount.get('value') == f'{price:.2f}'
        and amount.get('currency') == 'RUB'
        and hmac.compare_digest(str(meta.get('order_id', '')), str(payment_row['order_id']))
        and hmac.compare_digest(str(meta.get('product_id', '')), payment_row['product_id'])
    )
    if verified:
        with connect() as c:
            c.execute('UPDATE payments SET succeeded=1 WHERE sid=? AND product_id=? AND payment_id=?',
                      (session_row['sid'], payment_row['product_id'], payment_row['payment_id']))
            c.execute('INSERT OR IGNORE INTO entitlements VALUES (?,?,?)',
                      (session_row['sid'], payment_row['product_id'], now()))
    return verified


@app.post('/api/checkout')
def checkout(body: CheckoutBody, request: Request):
    row = require_session(request)
    title, price = product_payload(body.product_id)
    if owned_product(body.product_id, get_entitlements(row['sid'])):
        return {'unlocked': True}
    if MODE != 'yookassa':
        raise HTTPException(409, 'Платежи отключены. Доступен только деморежим.')
    if not email_ok(body.email):
        raise HTTPException(422, 'Укажите корректный email для чека.')
    with connect() as c:
        prev = c.execute('SELECT * FROM payments WHERE sid=? AND product_id=?',
                         (row['sid'], body.product_id)).fetchone()
        prev = dict(prev) if prev else None
    if prev and not prev['succeeded']:
        try:
            pay = payment_request('/payments/' + prev['payment_id'])
            if pay.get('status') == 'succeeded':
                confirm_payment(row, prev)
                return {'unlocked': True}
            if pay.get('status') == 'pending' and prev['confirmation_url']:
                return {'url': prev['confirmation_url'], 'pending': True}
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(503, 'Платёжная система временно недоступна') from exc
    order_id = 'ph21-' + uuid.uuid4().hex
    amount = f'{price:.2f}'
    payload = {
        'amount': {'value': amount, 'currency': 'RUB'}, 'capture': True,
        'confirmation': {'type': 'redirect', 'return_url': BASE_URL + ('/duo?payment=return' if body.product_id.startswith('duo_') else '/classic?payment=return')},
        'description': title[:128],
        'metadata': {'order_id': order_id, 'product_id': body.product_id},
    }
    if INCLUDE_RECEIPT:
        payload['receipt'] = {'customer': {'email': body.email}, 'items': [{
            'description': title[:128], 'quantity': '1.00',
            'amount': {'value': amount, 'currency': 'RUB'},
            'vat_code': VAT_CODE, 'payment_mode': 'full_payment', 'payment_subject': 'service',
        }]}
    try:
        pay = payment_request('/payments', payload=payload, key=order_id)
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(503, 'Не удалось создать платёж') from exc
    pay_id = pay.get('id', '')
    url = (pay.get('confirmation') or {}).get('confirmation_url', '')
    if not pay_id or not url or urlparse(url).scheme != 'https' or not (urlparse(url).hostname or '').endswith('.yookassa.ru') and urlparse(url).hostname != 'yookassa.ru':
        raise HTTPException(502, 'Некорректный ответ платёжного сервиса')
    with connect() as c:
        c.execute('''INSERT INTO payments (sid,product_id,payment_id,order_id,confirmation_url,succeeded,created_at)
            VALUES (?,?,?,?,?,0,?) ON CONFLICT(sid,product_id)
            DO UPDATE SET payment_id=excluded.payment_id, order_id=excluded.order_id,
            confirmation_url=excluded.confirmation_url, succeeded=0, created_at=excluded.created_at''',
            (row['sid'], body.product_id, pay_id, order_id, url, now()))
    return {'url': url, 'pending': True}


@app.post('/api/payment/verify')
def verify(request: Request):
    row = require_session(request)
    if MODE != 'yookassa':
        return {'checked': 0, 'unlocked': sorted(get_entitlements(row['sid']))}
    with connect() as c:
        rows = [dict(x) for x in c.execute('SELECT * FROM payments WHERE sid=? AND succeeded=0',
                                           (row['sid'],)).fetchall()]
    checked = 0
    for pr in rows[:24]:
        try:
            if confirm_payment(row, pr):
                checked += 1
        except (httpx.HTTPError, ValueError):
            continue
    return {'checked': checked, 'unlocked': sorted(get_entitlements(row['sid']))}


@app.post('/api/webhooks/yookassa')
async def webhook(request: Request):
    if MODE != 'yookassa':
        raise HTTPException(404)
    try:
        obj = await request.json()
        pay_id = (obj.get('object') or {}).get('id', '')
        event = obj.get('event')
    except (ValueError, AttributeError):
        raise HTTPException(400, 'Некорректное уведомление')
    if event != 'payment.succeeded' or not isinstance(pay_id, str) or not 0 < len(pay_id) < 128:
        return {'accepted': True}
    with connect() as c:
        row = c.execute('SELECT * FROM payments WHERE payment_id=?', (pay_id,)).fetchone()
        pr = dict(row) if row else None
    if pr:
        try:
            confirm_payment({'sid': pr['sid']}, pr)
        except (httpx.HTTPError, ValueError):
            raise HTTPException(503, 'Временная ошибка проверки платежа')
    return {'accepted': True}

@app.get('/api/duo/premium-art/{case_id}')
def premium_art(case_id: str, request: Request):
    """Deliver the paid extra only to the Premium collection owner."""
    if case_id not in ('room_zero', 'scarlet_letter', 'white_route'):
        raise HTTPException(404, 'Набор не найден')
    row = require_session(request)
    if 'duo_season' not in get_entitlements(row['sid']):
        raise HTTPException(403, 'Доступно только в Premium-коллекции')
    path = BASE / 'private' / f'{case_id}.jpg'
    return FileResponse(path, media_type='image/jpeg', filename=f'PEREHVAT_DUO_{case_id}_wallpaper.jpg',
                        headers={'Cache-Control': 'private, no-store'})
