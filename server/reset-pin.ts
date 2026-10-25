import { db } from './db.js'

const result = db.prepare(`DELETE FROM settings WHERE key = 'admin_pin'`).run()
console.log(result.changes ? 'Admin PIN removed. Open the app and create a new PIN.' : 'No admin PIN was set.')
