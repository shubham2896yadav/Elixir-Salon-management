import express, { type ErrorRequestHandler } from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerAuthRoutes, requireAdmin } from './auth.js'
import { db } from './db.js'
import {
  LIMITS, MONTH_PATTERN, TIME_PATTERN,
  cleanText, isRealDate, isTodayOrEarlier, isValidPhone, isValidShift, localDate, localTime, optionalText, parseAmount,
} from './validate.js'

type DaySummaryRow = {
  staff_id: number
  first_in: string | null
  last_out: string | null
}

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

const durationMinutes = (firstIn: string | null, lastOut: string | null) => {
  if (!firstIn || !lastOut) return null
  const minutes = toMinutes(lastOut) - toMinutes(firstIn)
  return minutes > 0 ? minutes : null
}

const daysInMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber, 0).getDate()
}

let lastId = 0
const nextId = () => {
  lastId = Math.max(Date.now(), lastId + 1)
  return lastId
}

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  if (!req.body || typeof req.body !== 'object') req.body = {}
  next()
})
registerAuthRoutes(app)

app.get('/api/now', (_req, res) => {
  const now = new Date()
  res.json({ date: localDate(now), time: localTime(now), timestamp: now.getTime() })
})

app.get('/api/staff', (_req, res) => {
  res.json(db.prepare('SELECT * FROM staff ORDER BY id').all())
})

type StaffInput = { name: string; role: string; shift: string }

const parseStaffInput = (body: Record<string, unknown>, selfId = 0): { value: StaffInput } | { error: string; status: number } => {
  const name = cleanText(body.name, LIMITS.name)
  const role = cleanText(body.role, LIMITS.role)
  if (!name) return { error: `Name is required (up to ${LIMITS.name} characters)`, status: 400 }
  if (!role) return { error: `Role is required (up to ${LIMITS.role} characters)`, status: 400 }
  if (!isValidShift(body.shift)) return { error: 'Shift must look like 10:00 - 19:30 and end after it starts', status: 400 }
  if (db.prepare('SELECT 1 FROM staff WHERE lower(name) = lower(?) AND id != ?').get(name, selfId)) {
    return { error: 'A team member with this name already exists', status: 409 }
  }
  return { value: { name, role, shift: body.shift } }
}

app.post('/api/staff', requireAdmin, (req, res) => {
  const parsed = parseStaffInput(req.body)
  if ('error' in parsed) {
    res.status(parsed.status).json({ error: parsed.error })
    return
  }
  const { name, role, shift } = parsed.value
  const id = nextId()
  db.prepare('INSERT INTO staff (id, name, role, shift, status) VALUES (?, ?, ?, ?, ?)').run(id, name, role, shift, 'Off')
  res.status(201).json({ id, name, role, shift, status: 'Off' })
})

app.patch('/api/staff/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as { id: number; name: string; role: string; shift: string; status: string } | undefined
  if (!existing) {
    res.status(404).json({ error: 'Staff member not found' })
    return
  }
  const parsed = parseStaffInput(req.body, id)
  if ('error' in parsed) {
    res.status(parsed.status).json({ error: parsed.error })
    return
  }
  const { name, role, shift } = parsed.value
  db.prepare('UPDATE staff SET name = ?, role = ?, shift = ? WHERE id = ?').run(name, role, shift, id)
  res.json({ ...existing, name, role, shift })
})

app.post('/api/attendance/events', (req, res) => {
  const { staffId, type } = req.body as { staffId?: number; type?: string }
  if (!Number.isInteger(staffId) || (type !== 'in' && type !== 'out')) {
    res.status(400).json({ error: 'staffId and type ("in" or "out") are required' })
    return
  }
  if (!db.prepare('SELECT 1 FROM staff WHERE id = ?').get(staffId)) {
    res.status(404).json({ error: 'Staff member not found' })
    return
  }
  const now = new Date()
  const date = localDate(now)
  const time = localTime(now)
  if (type === 'out' && !db.prepare("SELECT 1 FROM attendance_events WHERE staff_id = ? AND date = ? AND type = 'in'").get(staffId, date)) {
    res.status(409).json({ error: 'Check in before checking out' })
    return
  }
  const already = db.prepare('SELECT 1 FROM attendance_events WHERE staff_id = ? AND date = ? AND type = ?').get(staffId, date, type)
  if (already) {
    res.status(409).json({ error: type === 'in' ? 'Already checked in today' : 'Already checked out today' })
    return
  }
  db.prepare('INSERT INTO attendance_events (staff_id, date, type, time) VALUES (?, ?, ?, ?)').run(staffId, date, type, time)
  res.status(201).json({ staffId, date, type, time })
})

app.put('/api/attendance/day', requireAdmin, (req, res) => {
  const { staffId, date, checkIn, checkOut } = req.body as { staffId?: number; date?: string; checkIn?: string | null; checkOut?: string | null }
  if (!Number.isInteger(staffId) || !isRealDate(date)) {
    res.status(400).json({ error: 'staffId and a real date ("YYYY-MM-DD") are required' })
    return
  }
  if (!isTodayOrEarlier(date)) {
    res.status(400).json({ error: 'Attendance cannot be recorded for a future date' })
    return
  }
  if (!db.prepare('SELECT 1 FROM staff WHERE id = ?').get(staffId)) {
    res.status(404).json({ error: 'Staff member not found' })
    return
  }
  const inTime = checkIn || ''
  const outTime = checkOut || ''
  if ((inTime && !TIME_PATTERN.test(inTime)) || (outTime && !TIME_PATTERN.test(outTime))) {
    res.status(400).json({ error: 'Times must look like HH:MM' })
    return
  }
  if (outTime && !inTime) {
    res.status(400).json({ error: 'Add a check-in time before a check-out time' })
    return
  }
  if (inTime && outTime && toMinutes(outTime) <= toMinutes(inTime)) {
    res.status(400).json({ error: 'Check-out must be after check-in' })
    return
  }
  const replaceDay = db.transaction(() => {
    db.prepare('DELETE FROM attendance_events WHERE staff_id = ? AND date = ?').run(staffId, date)
    const insert = db.prepare('INSERT INTO attendance_events (staff_id, date, type, time) VALUES (?, ?, ?, ?)')
    if (inTime) insert.run(staffId, date, 'in', inTime)
    if (outTime) insert.run(staffId, date, 'out', outTime)
  })
  replaceDay()
  res.json({ staffId, date, firstIn: inTime || null, lastOut: outTime || null })
})

app.get('/api/attendance/summary', (req, res) => {
  const { date } = req.query as { date?: string }
  if (!isRealDate(date)) {
    res.status(400).json({ error: 'date must be a real date like 2026-11-05' })
    return
  }
  const rows = db.prepare(`
    SELECT staff_id,
      MIN(CASE WHEN type = 'in' THEN time END) as first_in,
      MAX(CASE WHEN type = 'out' THEN time END) as last_out
    FROM attendance_events
    WHERE date = ?
    GROUP BY staff_id
  `).all(date) as DaySummaryRow[]
  res.json(rows.map((row) => ({ staffId: row.staff_id, firstIn: row.first_in, lastOut: row.last_out })))
})

app.get('/api/attendance/monthly', requireAdmin, (req, res) => {
  const { staffId, month } = req.query as { staffId?: string; month?: string }
  if (!/^\d+$/.test(staffId ?? '') || !MONTH_PATTERN.test(month ?? '')) {
    res.status(400).json({ error: 'staffId and month ("YYYY-MM") are required' })
    return
  }
  const rows = db.prepare(`
    SELECT date,
      MIN(CASE WHEN type = 'in' THEN time END) as first_in,
      MAX(CASE WHEN type = 'out' THEN time END) as last_out
    FROM attendance_events
    WHERE staff_id = ? AND date LIKE ?
    GROUP BY date
  `).all(Number(staffId), `${month}-%`) as { date: string; first_in: string | null; last_out: string | null }[]
  const byDate = new Map(rows.map((row) => [row.date, row]))

  let totalMinutes = 0
  const days = Array.from({ length: daysInMonth(month as string) }, (_, index) => {
    const date = `${month as string}-${String(index + 1).padStart(2, '0')}`
    const row = byDate.get(date)
    const firstIn = row?.first_in ?? null
    const lastOut = row?.last_out ?? null
    const minutes = durationMinutes(firstIn, lastOut)
    if (minutes) totalMinutes += minutes
    return { date, firstIn, lastOut, totalMinutes: minutes }
  })

  res.json({ days, totalMinutes })
})

type ServiceRow = {
  id: number
  client: string
  phone: string
  treatments: string
  staff: string
  amount: number
  remarks: string
  google_review: number
  date: string
  time: string
}

type TreatmentLine = { name: string; amount: number }

const toService = (row: ServiceRow) => ({
  id: row.id,
  client: row.client,
  phone: row.phone,
  treatments: JSON.parse(row.treatments) as TreatmentLine[],
  staff: row.staff,
  amount: row.amount,
  remarks: row.remarks,
  googleReview: Boolean(row.google_review),
  date: row.date,
  time: row.time,
})

app.get('/api/services', (_req, res) => {
  const rows = db.prepare('SELECT * FROM services ORDER BY id DESC').all() as ServiceRow[]
  res.json(rows.map(toService))
})

const parseServiceInput = (body: Record<string, unknown>, unchangedStaff?: string) => {
  const client = cleanText(body.client, LIMITS.client)
  const staff = cleanText(body.staff, LIMITS.name)
  const remarks = optionalText(body.remarks, LIMITS.remarks)
  const lines = Array.isArray(body.treatments) ? body.treatments : null
  if (!client) return { error: `Client name is required (up to ${LIMITS.client} characters)` }
  if (!staff) return { error: 'Team member is required' }
  if (!isValidPhone(body.phone)) return { error: 'Phone number must be exactly 10 digits' }
  if (remarks === null) return { error: `Remarks can be up to ${LIMITS.remarks} characters` }
  if (!lines || lines.length === 0 || lines.length > LIMITS.maxLines) return { error: `Add between 1 and ${LIMITS.maxLines} services` }
  const treatments: TreatmentLine[] = []
  for (const line of lines as { name?: unknown; amount?: unknown }[]) {
    const name = cleanText(line?.name, LIMITS.line)
    const amount = parseAmount(line?.amount)
    if (!name || amount === null) return { error: 'Each service needs a name and an amount above zero (up to ₹1,00,00,000)' }
    treatments.push({ name, amount })
  }
  const date = body.date
  if (date !== undefined && !isRealDate(date)) return { error: 'date must be a real date like 2026-11-05' }
  if (typeof date === 'string' && !isTodayOrEarlier(date)) return { error: 'A service cannot be dated in the future' }
  if (staff !== unchangedStaff && !db.prepare('SELECT 1 FROM staff WHERE name = ?').get(staff)) return { error: 'That team member does not exist' }
  return {
    value: {
      client,
      phone: typeof body.phone === 'string' ? body.phone : '',
      treatments,
      staff,
      amount: Math.round(treatments.reduce((sum, line) => sum + line.amount, 0) * 100) / 100,
      remarks,
      googleReview: body.googleReview === true,
      date: typeof date === 'string' ? date : undefined,
    },
  }
}

app.post('/api/services', (req, res) => {
  const parsed = parseServiceInput(req.body)
  if (!parsed.value) {
    res.status(400).json({ error: parsed.error })
    return
  }
  const { client, phone, treatments, staff, amount, remarks, googleReview } = parsed.value
  const now = new Date()
  const id = nextId()
  const date = localDate(now)
  const time = localTime(now)
  db.prepare(`
    INSERT INTO services (id, client, phone, treatments, staff, amount, remarks, google_review, date, time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, client, phone, JSON.stringify(treatments), staff, amount, remarks, googleReview ? 1 : 0, date, time)
  res.status(201).json({ id, client, phone, treatments, staff, amount, remarks, googleReview, date, time })
})

app.patch('/api/services/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as ServiceRow | undefined
  if (!existing) {
    res.status(404).json({ error: 'Service record not found' })
    return
  }
  const parsed = parseServiceInput(req.body, existing.staff)
  if (!parsed.value) {
    res.status(400).json({ error: parsed.error })
    return
  }
  const { client, phone, treatments, staff, amount, remarks, googleReview, date } = parsed.value
  const nextDate = date ?? existing.date
  db.prepare(`
    UPDATE services SET client = ?, phone = ?, treatments = ?, staff = ?, amount = ?, remarks = ?, google_review = ?, date = ?
    WHERE id = ?
  `).run(client, phone, JSON.stringify(treatments), staff, amount, remarks, googleReview ? 1 : 0, nextDate, id)
  res.json({ id, client, phone, treatments, staff, amount, remarks, googleReview, date: nextDate, time: existing.time })
})

app.delete('/api/services/:id', (req, res) => {
  const result = db.prepare('DELETE FROM services WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) {
    res.status(404).json({ error: 'Service record not found' })
    return
  }
  res.json({ id: Number(req.params.id) })
})

type ExpenseRow = { id: number; label: string; category: string; amount: number; date: string }

const parseExpenseInput = (body: Record<string, unknown>) => {
  const label = cleanText(body.label, LIMITS.label)
  const category = cleanText(body.category, LIMITS.category)
  const amount = parseAmount(body.amount)
  if (!label) return { error: `Description is required (up to ${LIMITS.label} characters)` }
  if (!category) return { error: 'Category is required' }
  if (amount === null) return { error: 'Amount must be above zero (up to ₹1,00,00,000)' }
  const date = body.date
  if (date !== undefined && !isRealDate(date)) return { error: 'date must be a real date like 2026-11-05' }
  if (typeof date === 'string' && !isTodayOrEarlier(date)) return { error: 'An expense cannot be dated in the future' }
  return { value: { label, category, amount, date: typeof date === 'string' ? date : undefined } }
}

app.get('/api/expenses', (_req, res) => {
  res.json(db.prepare('SELECT * FROM expenses ORDER BY date DESC, id DESC').all() as ExpenseRow[])
})

app.post('/api/expenses', (req, res) => {
  const parsed = parseExpenseInput(req.body)
  if (!parsed.value) {
    res.status(400).json({ error: parsed.error })
    return
  }
  const { label, category, amount } = parsed.value
  const id = nextId()
  const date = parsed.value.date ?? localDate(new Date())
  db.prepare('INSERT INTO expenses (id, label, category, amount, date) VALUES (?, ?, ?, ?, ?)').run(id, label, category, amount, date)
  res.status(201).json({ id, label, category, amount, date })
})

app.patch('/api/expenses/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseRow | undefined
  if (!existing) {
    res.status(404).json({ error: 'Expense not found' })
    return
  }
  const parsed = parseExpenseInput(req.body)
  if (!parsed.value) {
    res.status(400).json({ error: parsed.error })
    return
  }
  const { label, category, amount } = parsed.value
  const date = parsed.value.date ?? existing.date
  db.prepare('UPDATE expenses SET label = ?, category = ?, amount = ?, date = ? WHERE id = ?').run(label, category, amount, date, id)
  res.json({ id, label, category, amount, date })
})

app.delete('/api/expenses/:id', (req, res) => {
  const result = db.prepare('DELETE FROM expenses WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) {
    res.status(404).json({ error: 'Expense not found' })
    return
  }
  res.json({ id: Number(req.params.id) })
})

type AppointmentRow = { id: number; client: string; date: string; time: string; service: string }

const parseAppointmentInput = (body: Record<string, unknown>) => {
  const client = cleanText(body.client, LIMITS.client)
  const service = cleanText(body.service, LIMITS.service)
  if (!client) return { error: `Client name is required (up to ${LIMITS.client} characters)` }
  if (!service) return { error: `Service wanted is required (up to ${LIMITS.service} characters)` }
  if (!isRealDate(body.date)) return { error: 'date must be a real date like 2026-11-05' }
  if (typeof body.time !== 'string' || !TIME_PATTERN.test(body.time)) return { error: 'time must look like HH:MM' }
  return { value: { client, service, date: body.date, time: body.time } }
}

app.get('/api/appointments', (_req, res) => {
  res.json(db.prepare('SELECT * FROM appointments ORDER BY date, time, id').all() as AppointmentRow[])
})

app.post('/api/appointments', (req, res) => {
  const parsed = parseAppointmentInput(req.body)
  if (!parsed.value) {
    res.status(400).json({ error: parsed.error })
    return
  }
  const { client, service, date, time } = parsed.value
  if (date < localDate(new Date())) {
    res.status(400).json({ error: 'An appointment cannot be booked for a past date' })
    return
  }
  const id = nextId()
  db.prepare('INSERT INTO appointments (id, client, date, time, service) VALUES (?, ?, ?, ?, ?)').run(id, client, date, time, service)
  res.status(201).json({ id, client, date, time, service })
})

app.patch('/api/appointments/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as AppointmentRow | undefined
  if (!existing) {
    res.status(404).json({ error: 'Appointment not found' })
    return
  }
  const parsed = parseAppointmentInput(req.body)
  if (!parsed.value) {
    res.status(400).json({ error: parsed.error })
    return
  }
  const { client, service, date, time } = parsed.value
  if (date !== existing.date && date < localDate(new Date())) {
    res.status(400).json({ error: 'An appointment cannot be moved to a past date' })
    return
  }
  db.prepare('UPDATE appointments SET client = ?, date = ?, time = ?, service = ? WHERE id = ?').run(client, date, time, service, id)
  res.json({ id, client, date, time, service })
})

app.delete('/api/appointments/:id', (req, res) => {
  const result = db.prepare('DELETE FROM appointments WHERE id = ?').run(Number(req.params.id))
  if (result.changes === 0) {
    res.status(404).json({ error: 'Appointment not found' })
    return
  }
  res.json({ id: Number(req.params.id) })
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const hasBuiltApp = fs.existsSync(path.join(distDir, 'index.html'))
if (hasBuiltApp) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method !== 'GET') {
      next()
      return
    }
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = Number(err?.status ?? err?.statusCode) || 500
  if (status === 413) {
    res.status(413).json({ error: 'That request is too large' })
    return
  }
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: 'That request could not be understood' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Something went wrong on the server' })
}
app.use(errorHandler)

const PORT = Number(process.env.PORT) || 4000
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`)
  if (hasBuiltApp) {
    console.log('Salon app is being served from the built files.')
    const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    for (const address of lan) console.log(`Open from other devices on this network: http://${address!.address}:${PORT}`)
  }
})
