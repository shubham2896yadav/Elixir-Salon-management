const pad = (value: number) => String(value).padStart(2, '0')

export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const SHIFT_PATTERN = /^([01]\d|2[0-3]):[0-5]\d - ([01]\d|2[0-3]):[0-5]\d$/
const PHONE_PATTERN = /^\d{10}$/

export const LIMITS = {
  name: 80,
  role: 60,
  client: 100,
  line: 100,
  service: 100,
  remarks: 500,
  label: 100,
  category: 40,
  maxLines: 20,
  maxAmount: 10_000_000,
}

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export const cleanText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 && text.length <= max ? text : null
}

export const optionalText = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length <= max ? text : null
}

export const isRealDate = (value: unknown): value is string =>
  typeof value === 'string' && DATE_PATTERN.test(value) && localDate(new Date(`${value}T12:00:00`)) === value

export const isTodayOrEarlier = (date: string) => date <= localDate(new Date())

export const isValidShift = (value: unknown): value is string => {
  if (typeof value !== 'string' || !SHIFT_PATTERN.test(value)) return false
  const [start, end] = value.split(' - ')
  return minutesOf(end) > minutesOf(start)
}

export const isValidPhone = (value: unknown) => value === undefined || value === null || value === '' || (typeof value === 'string' && PHONE_PATTERN.test(value))

export const parseAmount = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 && amount <= LIMITS.maxAmount ? Math.round(amount * 100) / 100 : null
}
