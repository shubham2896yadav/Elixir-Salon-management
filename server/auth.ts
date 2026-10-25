import crypto from 'node:crypto'
import type { Express, RequestHandler } from 'express'
import { db } from './db.js'

const SESSION_MS = 12 * 60 * 60 * 1000
const MAX_FAILURES = 5
const LOCKOUT_MS = 60 * 1000
const PIN_PATTERN = /^\d{4,8}$/

type Session = { expiresAt: number; pinHash: string }
const sessions = new Map<string, Session>()
let failures: number[] = []

const getPinHash = () => (db.prepare(`SELECT value FROM settings WHERE key = 'admin_pin'`).get() as { value: string } | undefined)?.value ?? null

const hashPin = (pin: string) => {
  const salt = crypto.randomBytes(16)
  return `${salt.toString('hex')}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`
}

const pinMatches = (pin: string, stored: string) => {
  const [saltHex, hashHex] = stored.split(':')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = crypto.scryptSync(pin, Buffer.from(saltHex, 'hex'), 32)
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

const tokenFrom = (header: string | undefined) => (header?.startsWith('Bearer ') ? header.slice(7) : '')

const validSession = (token: string) => {
  const session = sessions.get(token)
  if (!session) return false
  if (session.expiresAt < Date.now() || session.pinHash !== getPinHash()) {
    sessions.delete(token)
    return false
  }
  session.expiresAt = Date.now() + SESSION_MS
  return true
}

const startSession = (pinHash: string) => {
  const token = crypto.randomBytes(32).toString('hex')
  sessions.set(token, { expiresAt: Date.now() + SESSION_MS, pinHash })
  return token
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!validSession(tokenFrom(req.headers.authorization))) {
    res.status(401).json({ error: 'Admin PIN required' })
    return
  }
  next()
}

export function registerAuthRoutes(app: Express) {
  app.get('/api/admin/status', (req, res) => {
    res.json({ pinSet: getPinHash() !== null, authenticated: validSession(tokenFrom(req.headers.authorization)) })
  })

  app.post('/api/admin/setup', (req, res) => {
    const { pin } = req.body as { pin?: string }
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
      res.status(400).json({ error: 'The PIN must be 4 to 8 digits.' })
      return
    }
    const stored = hashPin(pin)
    const result = db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_pin', ?) ON CONFLICT(key) DO NOTHING`).run(stored)
    if (result.changes === 0) {
      res.status(409).json({ error: 'An admin PIN is already set.' })
      return
    }
    res.status(201).json({ token: startSession(stored) })
  })

  app.post('/api/admin/login', (req, res) => {
    const stored = getPinHash()
    if (!stored) {
      res.status(409).json({ error: 'No admin PIN has been created yet.' })
      return
    }
    const now = Date.now()
    failures = failures.filter((time) => now - time < LOCKOUT_MS)
    if (failures.length >= MAX_FAILURES) {
      const retryAfter = Math.ceil((failures[0] + LOCKOUT_MS - now) / 1000)
      res.status(429).json({ error: `Too many wrong attempts. Try again in ${retryAfter} seconds.`, retryAfter })
      return
    }
    const { pin } = req.body as { pin?: string }
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin) || !pinMatches(pin, stored)) {
      failures.push(now)
      res.status(401).json({ error: 'Wrong PIN.' })
      return
    }
    failures = []
    res.json({ token: startSession(stored) })
  })

  app.post('/api/admin/logout', (req, res) => {
    sessions.delete(tokenFrom(req.headers.authorization))
    res.json({ ok: true })
  })
}
