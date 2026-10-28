import { db } from './db.js'
import { localDate } from './validate.js'

// Loads realistic sample data so every screen has something to show.
// Everything it creates is remembered, so `npm run clear-demo` removes only these records.

if (db.prepare(`SELECT 1 FROM settings WHERE key = 'demo_ids'`).get()) {
  console.log('Sample data is already loaded. Run "npm run clear-demo" first if you want to load it again.')
  process.exit(0)
}

let seed = 20261025
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min
const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)]
const chance = (p: number) => random() < p
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
const toMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m }
const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return localDate(d) }

const today = localDate(new Date())
const startOfLastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1, 12)
const backMax = Math.round((new Date(`${today}T12:00:00`).getTime() - startOfLastMonth.getTime()) / 86400000)   // data covers last month and this month in full
const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes()
const usedIds = new Set<number>()
const idFor = (date: string, time: string, offset = 0) => {
  let id = new Date(`${date}T${time}:00`).getTime() + offset
  while (usedIds.has(id)) id += 1
  usedIds.add(id)
  return id
}

const existingNames = new Set((db.prepare('SELECT lower(name) AS n FROM staff').all() as { n: string }[]).map((r) => r.n))
const STAFF = [
  { name: 'Kavita Desai', role: 'Senior Beautician', shift: '10:00 - 19:30', skills: ['skin'], off: 1 },
  { name: 'Pooja Nair', role: 'Beautician', shift: '11:00 - 20:00', skills: ['skin', 'nails'], off: 3 },
  { name: 'Rohan Mehta', role: 'Male Hairdresser', shift: '10:00 - 19:30', skills: ['hair'], off: 2 },
  { name: 'Imran Shaikh', role: 'Unisex Senior Hairdresser', shift: '12:00 - 21:00', skills: ['hair'], off: 4 },
  { name: 'Sunita Patil', role: 'Nail Artist', shift: '11:30 - 20:15', skills: ['nails'], off: 5 },
]
const clash = STAFF.find((s) => existingNames.has(s.name.toLowerCase()))
if (clash) { console.error(`A team member called "${clash.name}" already exists, so the sample data was not loaded.`); process.exit(1) }

const PRICES: Record<string, [string, number, number][]> = {
  hair: [['Beard trim', 150, 300], ['Blow dry', 350, 600], ['Haircut', 400, 700], ['Hair spa', 900, 1500], ['Hair colour', 2200, 4000], ['Keratin treatment', 4500, 6500]],
  skin: [['Threading', 100, 250], ['De-tan', 700, 1100], ['Cleanup', 800, 1200], ['Waxing', 400, 1200], ['Facial', 1200, 2200], ['Bridal makeup', 6000, 9000]],
  nails: [['Nail art', 400, 900], ['Manicure', 500, 900], ['Pedicure', 700, 1200], ['Gel nails', 1500, 2200]],
}
const FIRST = ['Anika', 'Priya', 'Neha', 'Riya', 'Sneha', 'Isha', 'Meera', 'Tanvi', 'Divya', 'Kritika', 'Aditi', 'Pallavi', 'Shruti', 'Nidhi', 'Ritu', 'Swati', 'Komal', 'Ayesha', 'Farah', 'Zoya', 'Arjun', 'Karan', 'Vikram', 'Rahul', 'Aman', 'Nikhil', 'Sameer', 'Yash']
const LAST = ['Mehta', 'Shah', 'Kapoor', 'Verma', 'Iyer', 'Gupta', 'Joshi', 'Khan', 'Patel', 'Reddy', 'Sharma', 'Bose', 'Malhotra', 'Singh']
const CLIENTS = Array.from({ length: 46 }, (_, i) => ({ name: `${FIRST[i % FIRST.length]} ${LAST[(i * 5 + 3) % LAST.length]}`, phone: `9${String(between(100000000, 999999999))}` }))
const REMARKS = ['Prefers evening slots', 'Allergic to ammonia colour', 'Referred by a friend', 'Bridal package enquiry', 'Likes a quieter chair', 'Pays by UPI', 'Birthday month, offer a small discount']

const staffIds: number[] = []
const serviceIds: number[] = []
const expenseIds: number[] = []
const appointmentIds: number[] = []
const counts = { events: 0 }

const seedAll = db.transaction(() => {
  const insertStaff = db.prepare('INSERT INTO staff (id, name, role, shift, status) VALUES (?, ?, ?, ?, ?)')
  const staffBase = Date.now()
  STAFF.forEach((s, i) => { const id = staffBase + i; usedIds.add(id); staffIds.push(id); insertStaff.run(id, s.name, s.role, s.shift, 'Off') })

  // ---- attendance: last month and this month, plus whoever has already arrived today ----
  const insertEvent = db.prepare('INSERT INTO attendance_events (staff_id, date, type, time) VALUES (?, ?, ?, ?)')
  const worked = new Map<string, number[]>()           // date -> indexes of staff who worked
  for (let back = backMax; back >= 0; back--) {
    const date = addDays(today, -back)
    const weekday = new Date(`${date}T12:00:00`).getDay()
    const present: number[] = []
    STAFF.forEach((s, i) => {
      if (weekday === s.off) return                    // weekly off
      const [start, end] = s.shift.split(' - ').map(toMinutes)
      if (back === 0) {                                // today: only if their start time has passed
        const arrived = start + between(-8, 20)
        if (arrived + 5 < nowMinutes && !chance(0.15)) { insertEvent.run(staffIds[i], date, 'in', hhmm(arrived)); counts.events++; present.push(i) }
        return
      }
      if (chance(0.06)) return                         // an absence
      present.push(i)
      insertEvent.run(staffIds[i], date, 'in', hhmm(start + between(-12, 25))); counts.events++
      if (!chance(0.07)) { insertEvent.run(staffIds[i], date, 'out', hhmm(end + between(-20, 45))); counts.events++ }   // sometimes forgets to check out
    })
    worked.set(date, present)
  }

  // ---- services: about 4 a weekday, 7 at weekends, regulars come back ----
  const insertService = db.prepare('INSERT INTO services (id, client, phone, treatments, staff, amount, remarks, google_review, date, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (let back = backMax; back >= 0; back--) {
    const date = addDays(today, -back)
    const weekday = new Date(`${date}T12:00:00`).getDay()
    let visits = weekday === 0 || weekday === 6 ? between(6, 9) : between(3, 5)
    if (back === 0) visits = nowMinutes > 11 * 60 ? between(2, 3) : 0
    const present = worked.get(date) ?? []
    const team = present
    if (team.length === 0) continue
    for (let v = 0; v < visits; v++) {
      const staffIndex = pick(team)
      const member = STAFF[staffIndex]
      const [start, end] = member.shift.split(' - ').map(toMinutes)
      const latest = back === 0 ? Math.min(end - 60, nowMinutes - 10) : end - 60
      if (latest <= start + 30) continue
      const time = hhmm(between(start + 30, latest))
      const lines = Array.from({ length: chance(0.35) ? between(2, 3) : 1 }, () => {
        const skill = pick(member.skills)
        const menu = PRICES[skill]
        const [name, low, high] = menu[Math.floor(random() * random() * menu.length)]   // cheaper services are booked more often
        const helper = chance(0.15) ? pick(STAFF.filter((other) => other.skills.includes(skill))) : member   // sometimes a colleague does one of the services
        return { name, amount: Math.round(between(low, high) / 50) * 50, staff: chance(0.07) ? '' : helper.name }
      })
      const client = chance(0.4) ? CLIENTS[between(0, 13)] : pick(CLIENTS)
      const id = idFor(date, time, v)
      serviceIds.push(id)
      insertService.run(id, client.name, client.phone, JSON.stringify(lines), Array.from(new Set(lines.map((l) => l.staff).filter(Boolean))).join(', '), lines.reduce((sum, l) => sum + l.amount, 0), chance(0.18) ? pick(REMARKS) : '', chance(0.3) ? 1 : 0, date, time)
    }
  }

  // ---- expenses: last month and this month, the usual bills ----
  const insertExpense = db.prepare('INSERT INTO expenses (id, label, category, amount, date) VALUES (?, ?, ?, ?, ?)')
  const first = new Date(`${today}T12:00:00`)
  for (let m = 1; m >= 0; m--) {
    const month = new Date(first.getFullYear(), first.getMonth() - m, 1)
    const stamp = (day: number) => localDate(new Date(month.getFullYear(), month.getMonth(), day, 12))
    const bills: [number, string, string, number][] = [
      [1, 'Shop rent', 'Rent', 25000], [1, 'Staff salaries', 'Salary', 58000], [7, 'Electricity bill', 'Utilities', between(6000, 8200)], [9, 'Internet and phone', 'Utilities', 1499],
      [12, 'Hair and skin products restock', 'Products', between(13000, 16500)], [15, 'Instagram promotion', 'Marketing', 3500],
      [18, chance(0.5) ? 'AC servicing' : 'Chair and mirror repair', 'Maintenance', between(1800, 3200)], [24, 'Nail and wax supplies', 'Products', between(8500, 10500)],
      [26, 'Laundry service', 'Other', 1800],
    ]
    for (const [day, label, category, amount] of bills) {
      const date = stamp(day)
      if (date > today) continue
      const id = idFor(date, '09:00')
      expenseIds.push(id)
      insertExpense.run(id, label, category, amount, date)
    }
  }

  // ---- appointments: today, the next two weeks, and a few that already happened ----
  const insertAppointment = db.prepare('INSERT INTO appointments (id, client, date, time, service) VALUES (?, ?, ?, ?, ?)')
  const bookings: [number, string, string][] = [
    [0, '11:00', 'Haircut and beard trim'], [0, '15:00', 'Facial and cleanup'], [0, '17:30', 'Hair colour touch-up'],
    [1, '10:30', 'Bridal makeup trial'], [1, '12:00', 'Hair spa'], [1, '16:00', 'Manicure and pedicure'],
    [2, '11:00', 'Keratin treatment'], [3, '14:30', 'Gel nails'], [5, '10:00', 'Haircut and styling'], [6, '15:30', 'De-tan and facial'],
    [9, '12:30', 'Bridal makeup'], [13, '17:00', 'Hair colour'],
    [-1, '11:00', 'Haircut'], [-2, '14:00', 'Facial'], [-4, '16:30', 'Pedicure'], [-6, '10:30', 'Hair spa'], [-9, '13:00', 'Waxing'],
  ]
  for (const [offset, time, service] of bookings) {
    const date = addDays(today, offset)
    const id = idFor(date, time)
    appointmentIds.push(id)
    insertAppointment.run(id, pick(CLIENTS).name, date, time, service)
  }

  db.prepare(`INSERT INTO settings (key, value) VALUES ('demo_ids', ?)`).run(JSON.stringify({ staff: staffIds, services: serviceIds, expenses: expenseIds, appointments: appointmentIds }))
})
seedAll()

console.log('Sample data loaded:')
console.log(`  ${staffIds.length} team members, ${counts.events} attendance entries (since the start of last month)`)
console.log(`  ${serviceIds.length} service records since the start of last month, ${new Set(db.prepare('SELECT phone FROM services').all().map((r) => (r as { phone: string }).phone)).size} different clients`)
console.log(`  ${expenseIds.length} expenses for last month and this month, ${appointmentIds.length} appointments (upcoming and past)`)
console.log('Refresh the app to see it. To remove only this sample data later: npm run clear-demo')
