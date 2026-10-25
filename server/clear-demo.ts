import { db } from './db.js'

// Removes only what `npm run seed-demo` created. Anything you entered yourself is left alone.

const row = db.prepare(`SELECT value FROM settings WHERE key = 'demo_ids'`).get() as { value: string } | undefined
if (!row) {
  console.log('There is no sample data to remove.')
  process.exit(0)
}
const ids = JSON.parse(row.value) as { staff: number[]; services: number[]; expenses: number[]; appointments: number[] }

const removed = { services: 0, expenses: 0, appointments: 0, attendance: 0, staff: 0 }
db.transaction(() => {
  const del = (table: string, list: number[]) => list.reduce((n, id) => n + db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes, 0)
  removed.services = del('services', ids.services)
  removed.expenses = del('expenses', ids.expenses)
  removed.appointments = del('appointments', ids.appointments)
  removed.attendance = ids.staff.reduce((n, id) => n + db.prepare('DELETE FROM attendance_events WHERE staff_id = ?').run(id).changes, 0)
  removed.staff = del('staff', ids.staff)
  db.prepare(`DELETE FROM settings WHERE key = 'demo_ids'`).run()
})()

console.log(`Sample data removed: ${removed.staff} team members, ${removed.attendance} attendance entries, ${removed.services} services, ${removed.expenses} expenses, ${removed.appointments} appointments.`)
console.log('Anything you entered yourself was not touched.')
