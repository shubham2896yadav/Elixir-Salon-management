import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.SALON_DB_PATH || path.join(__dirname, 'salon.db')

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    shift TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Off'
  );

  CREATE TABLE IF NOT EXISTS attendance_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('in', 'out')),
    time TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attendance_events_staff_date ON attendance_events (staff_id, date);

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY,
    client TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    service TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments (date, time);
`)

function ensureExpensesDateColumn() {
  const columns = db.prepare(`PRAGMA table_info(expenses)`).all() as { name: string }[]
  if (columns.some((column) => column.name === 'date')) return
  db.exec(`ALTER TABLE expenses ADD COLUMN date TEXT NOT NULL DEFAULT ''`)
  const rows = db.prepare('SELECT id FROM expenses').all() as { id: number }[]
  const update = db.prepare('UPDATE expenses SET date = ? WHERE id = ?')
  for (const row of rows) {
    const created = new Date(row.id)
    const pad = (value: number) => String(value).padStart(2, '0')
    update.run(`${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}`, row.id)
  }
}

ensureExpensesDateColumn()

function migrateLegacyAttendanceTable() {
  const legacyTable = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attendance'`).get()
  if (!legacyTable) return

  const legacyRows = db.prepare('SELECT staff_id, date, clock_in, clock_out FROM attendance').all() as {
    staff_id: number
    date: string
    clock_in: string
    clock_out: string
  }[]
  const insertEvent = db.prepare('INSERT INTO attendance_events (staff_id, date, type, time) VALUES (?, ?, ?, ?)')
  const migrate = db.transaction((rows: typeof legacyRows) => {
    for (const row of rows) {
      if (row.clock_in) insertEvent.run(row.staff_id, row.date, 'in', row.clock_in)
      if (row.clock_out) insertEvent.run(row.staff_id, row.date, 'out', row.clock_out)
    }
  })
  migrate(legacyRows)
  db.exec('DROP TABLE attendance')
}

migrateLegacyAttendanceTable()

const SERVICES_SCHEMA = `
  CREATE TABLE services (
    id INTEGER PRIMARY KEY,
    client TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    treatments TEXT NOT NULL,
    staff TEXT NOT NULL,
    amount REAL NOT NULL,
    remarks TEXT NOT NULL DEFAULT '',
    google_review INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    time TEXT NOT NULL
  )
`

const TIME_PATTERN = /^\d{2}:\d{2}$/
const dateAndTimeFromId = (id: number, existingTime: string) => {
  const created = new Date(id)
  const date = created.toISOString().slice(0, 10)
  const time = TIME_PATTERN.test(existingTime)
    ? existingTime
    : `${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`
  return { date, time }
}

function ensureServicesTable() {
  const columns = db.prepare(`PRAGMA table_info(services)`).all() as { name: string }[]
  if (columns.length === 0) {
    db.exec(SERVICES_SCHEMA)
    return
  }
  const columnNames = columns.map((column) => column.name)

  if (!columnNames.includes('treatments')) {
    const legacyRows = db.prepare('SELECT id, client, treatment, staff, amount, time FROM services').all() as {
      id: number
      client: string
      treatment: string
      staff: string
      amount: number
      time: string
    }[]
    db.exec('DROP TABLE services')
    db.exec(SERVICES_SCHEMA)
    const insertService = db.prepare(`
      INSERT INTO services (id, client, phone, treatments, staff, amount, remarks, google_review, date, time)
      VALUES (@id, @client, '', @treatments, @staff, @amount, '', 0, @date, @time)
    `)
    const migrate = db.transaction((rows: typeof legacyRows) => {
      for (const row of rows) {
        const { date, time } = dateAndTimeFromId(row.id, row.time)
        insertService.run({ ...row, treatments: JSON.stringify([{ name: row.treatment, amount: row.amount }]), date, time })
      }
    })
    migrate(legacyRows)
    return
  }

  if (!columnNames.includes('date')) {
    db.exec(`ALTER TABLE services ADD COLUMN date TEXT NOT NULL DEFAULT ''`)
    const rows = db.prepare('SELECT id, time FROM services').all() as { id: number; time: string }[]
    const update = db.prepare('UPDATE services SET date = ?, time = ? WHERE id = ?')
    const backfill = db.transaction((serviceRows: typeof rows) => {
      for (const row of serviceRows) {
        const { date, time } = dateAndTimeFromId(row.id, row.time)
        update.run(date, time, row.id)
      }
    })
    backfill(rows)
  }
}

ensureServicesTable()
