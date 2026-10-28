import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Staff = { id: number; name: string; role: string; shift: string; status?: 'Present' | 'Off' }
type DailySummary = { firstIn: string; lastOut: string }
type MonthlyDay = { date: string; firstIn: string | null; lastOut: string | null; totalMinutes: number | null }
type TreatmentLine = { name: string; amount: number; staff: string }
type Service = { id: number; client: string; phone: string; treatments: TreatmentLine[]; staff: string; amount: number; remarks: string; googleReview: boolean; date: string; time: string }
type Expense = { id: number; label: string; category: string; amount: number; date: string }
type ClientSummary = { key: string; name: string; phone: string; visitCount: number; totalSpent: number; lastVisitDate: string }
type DayEdit = { staffId: number; date: string; checkIn: string; checkOut: string }
type Appointment = { id: number; client: string; date: string; time: string; service: string }

const localISODate = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const expenseCategories = ['Rent', 'Salary', 'Products', 'Utilities', 'Marketing', 'Maintenance', 'Other']
const blankService = () => ({ client: '', phone: '', serviceRows: [{ name: '', amount: '', staff: '' }], remarks: '', googleReview: false, date: '' })
const blankExpense = () => ({ label: '', category: 'Rent', amount: '', date: localISODate() })
const blankAppointment = () => ({ client: '', service: '', date: localISODate(), time: '' })
const sortAppointments = (list: Appointment[]) => [...list].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id - b.id)
const toSummaryMap = (rows: { staffId: number; firstIn: string | null; lastOut: string | null }[]) => {
  const map: Record<number, DailySummary> = {}
  for (const row of rows) map[row.staffId] = { firstIn: row.firstIn ?? '', lastOut: row.lastOut ?? '' }
  return map
}
const TOKEN_KEY = 'salonAdminToken'
let adminToken: string | null = sessionStorage.getItem(TOKEN_KEY)
let onUnauthorized: () => void = () => {}
const setAdminToken = (token: string | null) => {
  adminToken = token
  if (token) sessionStorage.setItem(TOKEN_KEY, token)
  else sessionStorage.removeItem(TOKEN_KEY)
}
const authFetch = async (url: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  if (adminToken) headers.set('Authorization', `Bearer ${adminToken}`)
  const res = await fetch(url, { ...init, headers })
  if (res.status === 401 && adminToken) {
    setAdminToken(null)
    onUnauthorized()
  }
  return res
}
const postJson = (url: string, method: string, data: unknown) => authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
const failureMessage = async (res: Response, fallback: string) => ((await res.json().catch(() => null)) as { error?: string } | null)?.error || fallback

function App() {
  const [activeView, setActiveView] = useState('Attendance')
  const [staff, setStaff] = useState<Staff[]>([])
  const [todaySummary, setTodaySummary] = useState<Record<number, DailySummary>>({})
  const [services, setServices] = useState<Service[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [showStaffForm, setShowStaffForm] = useState(false)
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null)
  const [showServiceForm, setShowServiceForm] = useState(false)
  const [newStaff, setNewStaff] = useState({ name: '', role: 'Beautician', shift: '10:00 - 19:30' })
  const [useCustomShift, setUseCustomShift] = useState(false)
  const [customShiftRange, setCustomShiftRange] = useState({ start: '10:00', end: '19:30' })
  const [newService, setNewService] = useState(blankService())
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null)
  const [serviceError, setServiceError] = useState('')
  const [checkPopup, setCheckPopup] = useState<{ staffId: number; type: 'in' | 'out' } | null>(null)
  const [clockOffset, setClockOffset] = useState(0)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [monthlyStaffId, setMonthlyStaffId] = useState<number | null>(null)
  const [monthlyMonth, setMonthlyMonth] = useState(() => localISODate().slice(0, 7))
  const [monthlyData, setMonthlyData] = useState<{ key: string; days: MonthlyDay[]; total: number | null } | null>(null)
  const [monthlyRefresh, setMonthlyRefresh] = useState(0)
  const [editingDay, setEditingDay] = useState<DayEdit | null>(null)
  const [servicePeriodType, setServicePeriodType] = useState<'week' | 'month'>('week')
  const [serviceAnchorDate, setServiceAnchorDate] = useState(() => localISODate())
  const [serviceStaffFilter, setServiceStaffFilter] = useState('')
  const [serviceView, setServiceView] = useState<'records' | 'team'>('records')
  const [viewingService, setViewingService] = useState<Service | null>(null)
  const [viewingClientKey, setViewingClientKey] = useState<string | null>(null)
  const [expenseMonth, setExpenseMonth] = useState(() => localISODate().slice(0, 7))
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null)
  const [newExpense, setNewExpense] = useState(blankExpense())
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [appointmentView, setAppointmentView] = useState<'upcoming' | 'past'>('upcoming')
  const [showAppointmentForm, setShowAppointmentForm] = useState(false)
  const [editingAppointmentId, setEditingAppointmentId] = useState<number | null>(null)
  const [newAppointment, setNewAppointment] = useState(blankAppointment())
  const [unlocked, setUnlocked] = useState(false)
  const [pinSet, setPinSet] = useState(true)
  const [pinInput, setPinInput] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinError, setPinError] = useState('')
  const [showPinPrompt, setShowPinPrompt] = useState(false)
  const attendanceDate = localISODate()
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const guarded = <A extends unknown[]>(action: (...args: A) => Promise<void>) => async (...args: A) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await action(...args)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/staff').then((res) => res.json()),
      fetch(`/api/attendance/summary?date=${attendanceDate}`).then((res) => res.json()),
      fetch('/api/services').then((res) => res.json()),
      fetch('/api/expenses').then((res) => res.json()),
      fetch('/api/appointments').then((res) => res.json()),
      authFetch('/api/admin/status').then((res) => res.json()) as Promise<{ pinSet: boolean; authenticated: boolean }>,
    ]).then(([staffData, summaryData, servicesData, expensesData, appointmentsData, status]) => {
      if (cancelled) return
      setStaff(staffData)
      setTodaySummary(toSummaryMap(summaryData))
      setServices(servicesData)
      setExpenses(expensesData)
      setAppointments(appointmentsData)
      setPinSet(status.pinSet)
      if (status.authenticated) setUnlocked(true)
      else setAdminToken(null)
      setLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!monthlyStaffId) return
    let cancelled = false
    authFetch(`/api/attendance/monthly?staffId=${monthlyStaffId}&month=${monthlyMonth}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { days: MonthlyDay[]; totalMinutes: number | null } | null) => {
        if (cancelled || !data) return
        setMonthlyData({ key: `${monthlyStaffId}|${monthlyMonth}`, days: data.days, total: data.totalMinutes })
      })
    return () => { cancelled = true }
  }, [monthlyStaffId, monthlyMonth, monthlyRefresh])
  const monthlyReady = monthlyData !== null && monthlyData.key === `${monthlyStaffId}|${monthlyMonth}`
  const monthlyDays = monthlyReady ? monthlyData.days : []
  const monthlyTotal = monthlyReady ? monthlyData.total : null

  useEffect(() => {
    if (!checkPopup) return
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [checkPopup])

  const getSummary = (staffId: number): DailySummary => todaySummary[staffId] || { firstIn: '', lastOut: '' }
  const refreshTodaySummary = async () => {
    const res = await fetch(`/api/attendance/summary?date=${attendanceDate}`)
    if (res.ok) setTodaySummary(toSummaryMap(await res.json()))
  }
  const lockAdmin = () => {
    setAdminToken(null)
    setUnlocked(false)
    setMonthlyStaffId(null)
    setEditingDay(null)
    setShowStaffForm(false)
  }
  useEffect(() => { onUnauthorized = lockAdmin })
  const openPinPrompt = () => {
    setPinError('')
    setPinInput('')
    setPinConfirm('')
    setShowPinPrompt(true)
  }
  const logoutAdmin = async () => {
    await authFetch('/api/admin/logout', { method: 'POST' })
    lockAdmin()
  }
  const submitPin = guarded(async (event: React.FormEvent) => {
    event.preventDefault()
    setPinError('')
    if (!pinSet) {
      if (!/^\d{4,8}$/.test(pinInput)) { setPinError('The PIN must be 4 to 8 digits.'); return }
      if (pinInput !== pinConfirm) { setPinError('The two PINs do not match.'); return }
    }
    const res = await fetch(pinSet ? '/api/admin/login' : '/api/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pinInput }) })
    const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
    if (!res.ok || !data.token) {
      setPinError(data.error || 'Could not unlock. Please try again.')
      setPinInput('')
      return
    }
    setAdminToken(data.token)
    setPinSet(true)
    setPinInput('')
    setPinConfirm('')
    setShowPinPrompt(false)
    setUnlocked(true)
  })
  const formatTime12 = (value: string | null) => {
    if (!value) return '--:--'
    const [hoursStr, minutesStr] = value.split(':')
    const hours = Number(hoursStr)
    const period = hours >= 12 ? 'PM' : 'AM'
    const displayHours = hours % 12 === 0 ? 12 : hours % 12
    return `${displayHours}:${minutesStr} ${period}`
  }
  const formatDuration = (minutes: number | null) => {
    if (minutes === null) return '--'
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  }
  const formatDayLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const formatShiftRange = (shift: string) => {
    const [start, end] = shift.split(' - ')
    return `${formatTime12(start)} - ${formatTime12(end)}`
  }
  const formatShortDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const formatFullDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const getWeekRange = (value: string) => {
    const date = new Date(`${value}T12:00:00`)
    const diffToMonday = (date.getDay() + 6) % 7
    const monday = new Date(date)
    monday.setDate(date.getDate() - diffToMonday)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { start: localISODate(monday), end: localISODate(sunday) }
  }
  const shiftServicePeriod = (direction: 1 | -1) => {
    const date = new Date(`${serviceAnchorDate}T12:00:00`)
    if (servicePeriodType === 'week') date.setDate(date.getDate() + 7 * direction)
    else date.setMonth(date.getMonth() + direction)
    setServiceAnchorDate(localISODate(date))
  }
  const openCheckPopup = async (staffId: number, type: 'in' | 'out') => {
    try {
      const { timestamp } = (await (await fetch('/api/now')).json()) as { timestamp: number }
      setClockOffset(timestamp - Date.now())
    } catch {
      setClockOffset(0)
    }
    setNowTick(Date.now())
    setCheckPopup({ staffId, type })
  }
  const popupTime = (() => {
    const d = new Date(nowTick + clockOffset)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })()
  const confirmCheck = guarded(async () => {
    if (!checkPopup) return
    const { staffId, type } = checkPopup
    const res = await postJson('/api/attendance/events', 'POST', { staffId, type })
    if (res.ok) {
      const saved = (await res.json()) as { time: string }
      setTodaySummary((current) => {
        const existing = current[staffId] || { firstIn: '', lastOut: '' }
        const updated = type === 'in' ? { ...existing, firstIn: existing.firstIn || saved.time } : { ...existing, lastOut: saved.time }
        return { ...current, [staffId]: updated }
      })
    } else {
      alert(await failureMessage(res, 'Could not record attendance. Please try again.'))
      await refreshTodaySummary()
    }
    setCheckPopup(null)
  })
  const saveDay = guarded(async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingDay) return
    const res = await postJson('/api/attendance/day', 'PUT', editingDay)
    if (!res.ok) {
      alert(await failureMessage(res, 'Could not save this day.'))
      return
    }
    await finishDayEdit()
  })
  const clearDay = guarded(async () => {
    if (!editingDay || !window.confirm('Clear the check-in and check-out for this day?')) return
    const res = await postJson('/api/attendance/day', 'PUT', { ...editingDay, checkIn: '', checkOut: '' })
    if (!res.ok) {
      alert(await failureMessage(res, 'Could not clear this day.'))
      return
    }
    await finishDayEdit()
  })
  const finishDayEdit = async () => {
    const editedToday = editingDay?.date === attendanceDate
    setEditingDay(null)
    setMonthlyRefresh((count) => count + 1)
    if (editedToday) await refreshTodaySummary()
  }
  const todayRecords = staff.map((member) => ({ member, summary: getSummary(member.id) }))
  const presentCount = todayRecords.filter(({ summary }) => summary.firstIn).length
  const revenue = useMemo(() => services.reduce((sum, item) => sum + item.amount, 0), [services])
  const spend = useMemo(() => expenses.reduce((sum, item) => sum + item.amount, 0), [expenses])
  const serviceWeekRange = useMemo(() => getWeekRange(serviceAnchorDate), [serviceAnchorDate])
  const serviceMonth = serviceAnchorDate.slice(0, 7)
  const serviceStaffOptions = useMemo(() => Array.from(new Set(services.flatMap((item) => item.treatments.map((line) => line.staff)).filter(Boolean))).sort(), [services])
  const filteredServices = useMemo(() => {
    const inPeriod = servicePeriodType === 'week'
      ? services.filter((item) => item.date >= serviceWeekRange.start && item.date <= serviceWeekRange.end)
      : services.filter((item) => item.date.startsWith(serviceMonth))
    if (!serviceStaffFilter) return inPeriod
    return inPeriod.filter((item) => item.treatments.some((line) => line.staff === serviceStaffFilter))
  }, [services, servicePeriodType, serviceWeekRange, serviceMonth, serviceStaffFilter])
  // with a team member picked, only the lines they did count towards the amount shown
  const shownAmount = (service: Service) => serviceStaffFilter ? service.treatments.filter((line) => line.staff === serviceStaffFilter).reduce((sum, line) => sum + line.amount, 0) : service.amount
  const periodTotal = filteredServices.reduce((sum, item) => sum + shownAmount(item), 0)
  const teamBreakdown = useMemo(() => {
    const inPeriod = servicePeriodType === 'week'
      ? services.filter((item) => item.date >= serviceWeekRange.start && item.date <= serviceWeekRange.end)
      : services.filter((item) => item.date.startsWith(serviceMonth))
    const totals = new Map<string, { name: string; count: number; revenue: number; visits: Set<number> }>()
    for (const service of inPeriod) for (const line of service.treatments) {
      const entry = totals.get(line.staff) ?? { name: line.staff, count: 0, revenue: 0, visits: new Set<number>() }
      entry.count += 1; entry.revenue += line.amount; entry.visits.add(service.id)
      totals.set(line.staff, entry)
    }
    const rows = Array.from(totals.values()).map((entry) => ({ ...entry, visits: entry.visits.size }))
    const all = rows.reduce((sum, row) => sum + row.revenue, 0)
    return { rows: rows.sort((a, b) => (a.name === '' ? 1 : b.name === '' ? -1 : b.revenue - a.revenue)), all }
  }, [services, servicePeriodType, serviceWeekRange, serviceMonth])
  const periodLabel = servicePeriodType === 'week'
    ? `${formatShortDate(serviceWeekRange.start)} - ${formatShortDate(serviceWeekRange.end)}`
    : new Date(`${serviceMonth}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const clientKeyFor = (service: Service) => (service.phone && service.phone.trim()) || service.client.trim().toLowerCase()
  const clientSummaries = useMemo(() => {
    const map = new Map<string, ClientSummary>()
    for (const service of services) {
      const key = clientKeyFor(service)
      const existing = map.get(key)
      if (existing) {
        existing.visitCount += 1
        existing.totalSpent += service.amount
        if (service.date > existing.lastVisitDate) existing.lastVisitDate = service.date
      } else {
        map.set(key, { key, name: service.client.trim(), phone: service.phone, visitCount: 1, totalSpent: service.amount, lastVisitDate: service.date })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lastVisitDate.localeCompare(a.lastVisitDate))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services])
  const selectedClient = clientSummaries.find((client) => client.key === viewingClientKey) || null
  const clientServiceHistory = useMemo(
    () => viewingClientKey ? services.filter((service) => clientKeyFor(service) === viewingClientKey) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, viewingClientKey],
  )
  const profit = revenue - spend
  const revenueShare = Math.round((revenue / Math.max(revenue + spend, 1)) * 100)
  const initials = (name: string) => name.split(' ').map((part) => part[0]).join('').slice(0, 2)
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()
  const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const greeting = (() => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  })()
  const salonHours = useMemo(() => {
    const ranges = staff.map((member) => member.shift.split(' - ')).filter((parts) => parts.length === 2)
    if (ranges.length === 0) return 'No shifts yet'
    const earliest = ranges.map(([start]) => start).sort()[0]
    const latest = ranges.map(([, end]) => end).sort().at(-1)
    return `${earliest} - ${latest}`
  }, [staff])

  const shiftPresets = ['10:00 - 19:30', '11:30 - 20:15', '12:00 - 21:30', '12:00 - 21:00', '11:00 - 20:00']
  const openAddStaff = () => {
    setEditingStaffId(null)
    setNewStaff({ name: '', role: 'Beautician', shift: '10:00 - 19:30' })
    setUseCustomShift(false)
    setCustomShiftRange({ start: '10:00', end: '19:30' })
    setShowStaffForm(true)
  }
  const openEditStaff = (member: Staff) => {
    setEditingStaffId(member.id)
    setNewStaff({ name: member.name, role: member.role, shift: member.shift })
    if (shiftPresets.includes(member.shift)) {
      setUseCustomShift(false)
    } else {
      const [start, end] = member.shift.split(' - ')
      setUseCustomShift(true)
      setCustomShiftRange({ start, end })
    }
    setShowStaffForm(true)
  }
  const submitStaff = guarded(async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newStaff.name.trim()) return
    const res = editingStaffId
      ? await postJson(`/api/staff/${editingStaffId}`, 'PATCH', newStaff)
      : await postJson('/api/staff', 'POST', newStaff)
    if (!res.ok) {
      alert(await failureMessage(res, 'Could not save this team member.'))
      return
    }
    const saved = (await res.json()) as Staff
    setStaff(editingStaffId ? staff.map((member) => member.id === editingStaffId ? saved : member) : [...staff, saved])
    setNewStaff({ name: '', role: 'Beautician', shift: '10:00 - 19:30' })
    setUseCustomShift(false)
    setCustomShiftRange({ start: '10:00', end: '19:30' })
    setEditingStaffId(null)
    setShowStaffForm(false)
  })
  const addServiceRow = () => { setServiceError(''); setNewService((current) => ({ ...current, serviceRows: [...current.serviceRows, { name: '', amount: '', staff: '' }] })) }
  const removeServiceRow = (index: number) => setNewService((current) => ({ ...current, serviceRows: current.serviceRows.filter((_, i) => i !== index) }))
  const updateServiceRow = (index: number, patch: Partial<{ name: string; amount: string; staff: string }>) => {
    setServiceError('')
    setNewService((current) => ({ ...current, serviceRows: current.serviceRows.map((row, i) => i === index ? { ...row, ...patch } : row) }))
  }
  const serviceRowsTotal = newService.serviceRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  const openAddService = () => {
    setServiceError('')
    setEditingServiceId(null)
    setNewService(blankService())
    setShowServiceForm(true)
  }
  const openEditService = (service: Service) => {
    setServiceError('')
    setEditingServiceId(service.id)
    setNewService({
      client: service.client,
      phone: service.phone,
      serviceRows: service.treatments.map((line) => ({ name: line.name, amount: String(line.amount), staff: line.staff })),
      remarks: service.remarks,
      googleReview: service.googleReview,
      date: service.date,
    })
    setViewingService(null)
    setShowServiceForm(true)
  }
  const submitService = guarded(async (event: React.FormEvent) => {
    event.preventDefault()
    const filledRows = newService.serviceRows.filter((row) => row.name.trim() || row.amount.trim())
    const validRows = filledRows.filter((row) => row.name.trim() && Number(row.amount) > 0)
    if (!newService.client.trim()) return
    if (validRows.length === 0) { setServiceError('Add at least one service with a name and an amount.'); return }
    if (validRows.length !== filledRows.length) { setServiceError('Every service needs both a name and an amount above zero. Fix or remove the incomplete line.'); return }
    const payload = {
      client: newService.client,
      phone: newService.phone,
      treatments: validRows.map((row) => ({ name: row.name.trim(), amount: Number(row.amount), staff: row.staff })),
      remarks: newService.remarks,
      googleReview: newService.googleReview,
      ...(editingServiceId && newService.date ? { date: newService.date } : {}),
    }
    const res = editingServiceId
      ? await postJson(`/api/services/${editingServiceId}`, 'PATCH', payload)
      : await postJson('/api/services', 'POST', payload)
    if (!res.ok) {
      alert(await failureMessage(res, 'Could not save this service. Please check the details.'))
      return
    }
    const saved = (await res.json()) as Service
    setServices(editingServiceId ? services.map((item) => item.id === saved.id ? saved : item) : [saved, ...services])
    setEditingServiceId(null)
    setNewService(blankService())
    setShowServiceForm(false)
  })
  const deleteService = guarded(async (service: Service) => {
    if (!window.confirm(`Delete the service record for ${service.client}? This cannot be undone.`)) return
    const res = await authFetch(`/api/services/${service.id}`, { method: 'DELETE' })
    if (!res.ok) {
      alert(await failureMessage(res, 'Could not delete this record.'))
      return
    }
    setServices(services.filter((item) => item.id !== service.id))
    setViewingService(null)
  })

  const shiftExpenseMonth = (direction: 1 | -1) => {
    const [year, month] = expenseMonth.split('-').map(Number)
    setExpenseMonth(localISODate(new Date(year, month - 1 + direction, 1)).slice(0, 7))
  }
  const openAddExpense = () => {
    setEditingExpenseId(null)
    setNewExpense({ ...blankExpense(), date: expenseMonth === localISODate().slice(0, 7) ? localISODate() : `${expenseMonth}-01` })
    setShowExpenseForm(true)
  }
  const openEditExpense = (expense: Expense) => {
    setEditingExpenseId(expense.id)
    setNewExpense({ label: expense.label, category: expense.category, amount: String(expense.amount), date: expense.date })
    setShowExpenseForm(true)
  }
  const submitExpense = guarded(async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newExpense.label.trim() || !(Number(newExpense.amount) > 0) || !newExpense.date) return
    const payload = { label: newExpense.label, category: newExpense.category, amount: Number(newExpense.amount), date: newExpense.date }
    const res = editingExpenseId
      ? await postJson(`/api/expenses/${editingExpenseId}`, 'PATCH', payload)
      : await postJson('/api/expenses', 'POST', payload)
    if (!res.ok) {
      alert(await failureMessage(res, 'Could not save this expense.'))
      return
    }
    const saved = (await res.json()) as Expense
    const next = editingExpenseId ? expenses.map((item) => item.id === saved.id ? saved : item) : [saved, ...expenses]
    setExpenses([...next].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id))
    setExpenseMonth(saved.date.slice(0, 7))
    setEditingExpenseId(null)
    setShowExpenseForm(false)
  })
  const deleteExpense = guarded(async (expense: Expense) => {
    if (!window.confirm(`Delete "${expense.label}"? This cannot be undone.`)) return
    const res = await authFetch(`/api/expenses/${expense.id}`, { method: 'DELETE' })
    if (!res.ok) {
      alert(await failureMessage(res, 'Could not delete this expense.'))
      return
    }
    setExpenses(expenses.filter((item) => item.id !== expense.id))
  })
  const monthExpenses = expenses.filter((item) => item.date.startsWith(expenseMonth))
  const monthSpend = monthExpenses.reduce((sum, item) => sum + item.amount, 0)
  const monthRevenue = services.filter((item) => item.date.startsWith(expenseMonth)).reduce((sum, item) => sum + item.amount, 0)
  const expenseMonthLabel = new Date(`${expenseMonth}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const openAddAppointment = () => {
    setEditingAppointmentId(null)
    setNewAppointment(blankAppointment())
    setShowAppointmentForm(true)
  }
  const openEditAppointment = (appointment: Appointment) => {
    setEditingAppointmentId(appointment.id)
    setNewAppointment({ client: appointment.client, service: appointment.service, date: appointment.date, time: appointment.time })
    setShowAppointmentForm(true)
  }
  const submitAppointment = guarded(async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newAppointment.client.trim() || !newAppointment.service.trim() || !newAppointment.date || !newAppointment.time) return
    const res = editingAppointmentId
      ? await postJson(`/api/appointments/${editingAppointmentId}`, 'PATCH', newAppointment)
      : await postJson('/api/appointments', 'POST', newAppointment)
    if (!res.ok) {
      alert(await failureMessage(res, 'Could not save this appointment.'))
      return
    }
    const saved = (await res.json()) as Appointment
    setAppointments(sortAppointments(editingAppointmentId ? appointments.map((item) => item.id === saved.id ? saved : item) : [...appointments, saved]))
    setAppointmentView(saved.date >= attendanceDate ? 'upcoming' : 'past')
    setEditingAppointmentId(null)
    setShowAppointmentForm(false)
  })
  const cancelAppointment = guarded(async (appointment: Appointment) => {
    if (!window.confirm(`Cancel the appointment for ${appointment.client} on ${formatShortDate(appointment.date)} at ${formatTime12(appointment.time)}?`)) return
    const res = await authFetch(`/api/appointments/${appointment.id}`, { method: 'DELETE' })
    if (!res.ok) {
      alert(await failureMessage(res, 'Could not cancel this appointment.'))
      return
    }
    setAppointments(appointments.filter((item) => item.id !== appointment.id))
  })
  const upcomingAppointments = appointments.filter((item) => item.date >= attendanceDate)
  const pastAppointments = appointments.filter((item) => item.date < attendanceDate).sort((a, b) => b.date.localeCompare(a.date) || a.time.localeCompare(b.time))
  const todayAppointmentCount = appointments.filter((item) => item.date === attendanceDate).length
  const shownAppointments = appointmentView === 'upcoming' ? upcomingAppointments : pastAppointments
  const appointmentGroups = shownAppointments.reduce<{ date: string; items: Appointment[] }[]>((groups, item) => {
    const last = groups[groups.length - 1]
    if (last && last.date === item.date) last.items.push(item)
    else groups.push({ date: item.date, items: [item] })
    return groups
  }, [])
  const tomorrowISO = (() => { const d = new Date(`${attendanceDate}T12:00:00`); d.setDate(d.getDate() + 1); return localISODate(d) })()
  const appointmentDayHeading = (date: string) => date === attendanceDate ? `Today · ${formatDayLabel(date)}` : date === tomorrowISO ? `Tomorrow · ${formatDayLabel(date)}` : formatFullDate(date)
  const topAction = activeView === 'Team & shifts' ? (unlocked ? { label: 'Add team member', run: openAddStaff } : null)
    : activeView === 'Expenses' ? { label: 'Add expense', run: openAddExpense }
    : activeView === 'Appointments' ? { label: 'New appointment', run: openAddAppointment }
    : activeView === 'Services' || activeView === 'Clients' ? { label: 'New service', run: openAddService }
    : null
  const renderPinForm = (inPopup: boolean) => (
    <form className="modal lock-form" onSubmit={submitPin}>
      {inPopup && <button type="button" className="modal-close" onClick={() => setShowPinPrompt(false)}>x</button>}
      <p className="eyebrow">ADMIN ONLY</p>
      <h2>{pinSet ? 'Enter admin PIN' : 'Create admin PIN'}</h2>
      <p className="modal-copy">
        {pinSet
          ? (inPopup ? 'Revenue, profit and spending totals are hidden from staff. Enter the admin PIN to view them.' : 'Enter the admin PIN to manage staff details and attendance records. Everything else stays open.')
          : 'Choose a 4 to 8 digit PIN. It protects revenue and profit totals, staff details, monthly attendance and time corrections.'}
      </p>
      <label>{pinSet ? 'PIN' : 'New PIN'}<input type="password" inputMode="numeric" autoComplete="off" maxLength={8} autoFocus value={pinInput} onChange={(event) => setPinInput(event.target.value.replace(/\D/g, ''))} placeholder="••••" /></label>
      {!pinSet && <label>Confirm PIN<input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pinConfirm} onChange={(event) => setPinConfirm(event.target.value.replace(/\D/g, ''))} placeholder="••••" /></label>}
      {pinError && <p className="form-error">{pinError}</p>}
      <button className="primary-button modal-submit" disabled={busy}>{pinSet ? 'Unlock' : 'Create PIN and unlock'}</button>
    </form>
  )
  const revealButton = <button type="button" className="reveal-button" onClick={openPinPrompt}>Enter PIN to view</button>
  const navigation = ['Attendance', 'Team & shifts', 'Clients', 'Appointments', 'Services', 'Expenses']

  if (loading) {
    return <div className="app-shell loading-shell"><img src="/logo.png" alt="Elixir salon" /><p>Loading salon data...</p></div>
  }

  return (
    <div className="app-shell">
      <aside className="sidebar"><div className="brand"><img className="brand-logo" src="/logo.png" alt="Elixir salon" /><img className="brand-icon" src="/favicon.png" alt="Elixir salon" /></div><div className="workspace-label">ADMIN WORKSPACE</div><nav>{navigation.map((item) => <button key={item} className={activeView === item ? 'nav-item active' : 'nav-item'} onClick={() => { setActiveView(item); setMonthlyStaffId(null); setViewingClientKey(null) }}><span className="nav-icon">{item === 'Overview' ? '◈' : item === 'Attendance' ? '◷' : item === 'Team & shifts' ? '♧' : item === 'Clients' ? '◑' : item === 'Appointments' ? '▦' : item === 'Services' ? '✦' : '◌'}</span>{item}</button>)}</nav><div className="sidebar-bottom"><div className="today-card"><span className="pulse"></span><div><strong>Open today</strong><small>{salonHours}</small></div><span className="more">•••</span></div>{unlocked && <button type="button" className="lock-button" onClick={logoutAdmin}>Lock admin</button>}<div className="user-chip"><div className="avatar owner">A</div><div><strong>Admin</strong><small>Admin account</small></div><span className="more">⌄</span></div></div></aside>
      <main className="main-content"><header className="topbar"><div className="mobile-brand"><img src="/logo.png" alt="Elixir salon" /></div><div className="breadcrumb">Admin workspace <span>/</span> <strong>{activeView}</strong></div><div className="top-actions"><button className="icon-button" aria-label="Notifications">♢<span className="notification-dot"></span></button><button className="help-button">? <span>Help center</span></button><span className="admin-badge">ADMIN</span><div className="avatar owner">A</div></div></header>
        <div className="page-content"><div className="page-heading"><div><p className="eyebrow">{todayLabel}</p><h1>{activeView === 'Overview' ? greeting : activeView}</h1><p className="subheading">Here&apos;s what&apos;s happening at your salon today.</p></div>{topAction && <button className="primary-button" onClick={topAction.run}><span>＋</span>{topAction.label}</button>}</div>
          {activeView === 'Overview' && <><section className="metrics-grid"><div className="metric-card accent"><div className="metric-top"><span>Revenue this month</span><span className="metric-icon">↗</span></div><strong>₹{revenue.toLocaleString()}</strong><p>{services.length} services logged</p></div><div className="metric-card"><div className="metric-top"><span>Services completed</span><span className="metric-icon lavender">✦</span></div><strong>{services.length}</strong><p>this month</p></div><div className="metric-card"><div className="metric-top"><span>Team attendance</span><span className="metric-icon peach">♧</span></div><strong>{presentCount}<small>/{staff.length}</small></strong><p><span className="positive">{Math.round((presentCount / Math.max(staff.length, 1)) * 100)}%</span> <span>on shift today</span></p><div className="attendance-track"><span style={{ width: `${(presentCount / Math.max(staff.length, 1)) * 100}%` }}></span></div></div><div className="metric-card"><div className="metric-top"><span>Estimated profit</span><span className="metric-icon mint">◌</span></div><strong>₹{profit.toLocaleString()}</strong><p>₹{spend.toLocaleString()} in expenses</p></div></section><section className="dashboard-grid"><div className="panel attendance-panel"><div className="panel-heading"><div><h2>Today&apos;s attendance</h2><p>{presentCount} team members currently on shift</p></div><button className="text-button" onClick={() => setActiveView('Attendance')}>View attendance <span>→</span></button></div><div className="staff-list">{todayRecords.map(({ member, summary }) => <div className="staff-row" key={member.id}><div className="avatar" style={{ background: member.id % 2 ? '#e8e0d5' : '#dbe5dc' }}>{initials(member.name)}</div><div className="staff-info"><strong>{member.name}</strong><span>{member.role}</span></div><div className="shift-time"><span className={`status-dot ${summary.firstIn ? 'on' : ''}`}></span>{summary.firstIn ? formatTime12(summary.firstIn) : formatShiftRange(member.shift)}</div><button className="row-menu" onClick={() => setActiveView('Attendance')}>{summary.firstIn ? 'Edit' : 'Mark'}</button></div>)}</div></div><div className="panel goal-panel"><div className="panel-heading"><div><h2>Revenue vs expenses</h2><p>{monthLabel}</p></div><button className="kebab">•••</button></div><div className="goal-circle" style={{ background: `radial-gradient(circle at center, #fff 58%, transparent 59%), conic-gradient(#879b80 0 ${revenueShare}%, #edf0eb ${revenueShare}% 100%)` }}><div><strong>{revenueShare}<small>%</small></strong><span>revenue share</span></div></div><div className="goal-legend"><div><span className="legend-dot revenue-dot"></span><span>Revenue</span><strong>₹{revenue.toLocaleString()}</strong></div><div><span className="legend-dot expense-dot"></span><span>Expenses</span><strong>₹{spend.toLocaleString()}</strong></div></div><div className="goal-foot">Net profit <strong>₹{profit.toLocaleString()}</strong></div></div></section><section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent services</h2><p>Latest client appointments and payments</p></div><button className="text-button" onClick={() => setActiveView('Services')}>View all <span>→</span></button></div><div className="service-table"><div className="table-head"><span>CLIENT</span><span>SERVICE</span><span>TEAM MEMBER</span><span>AMOUNT</span><span></span></div>{services.slice(0, 4).map((service) => <div className="table-row" key={service.id} onClick={() => setViewingService(service)}><div className="client-cell"><div className="avatar mini">{initials(service.client)}</div><div><strong>{service.client}</strong>{service.phone && <span className="client-phone">{service.phone}</span>}</div></div><span>{service.treatments.map((line) => line.name).join(', ')}</span><span>{service.staff || '—'}</span><strong>₹{service.amount}{service.googleReview && <span className="review-badge" title="Google review taken">★</span>}</strong><span className="time-cell">{formatTime12(service.time)}</span></div>)}</div></section></>}
          {!unlocked && activeView === 'Team & shifts' && <section className="panel full-panel lock-panel">{renderPinForm(false)}</section>}
          {activeView === 'Attendance' && <section className="panel full-panel checkin-panel"><div className="panel-heading"><div><h2>Staff check-in</h2><p>Tap check in when someone arrives, check out when they leave.</p></div></div><div className="checkin-grid">{todayRecords.map(({ member, summary }) => <div className="checkin-card" key={member.id}><div className="checkin-person"><div className="avatar mini">{initials(member.name)}</div><div><strong>{member.name}</strong><span>{member.role}</span></div></div><div className="checkin-times"><div><span>Check in</span><strong>{formatTime12(summary.firstIn)}</strong></div><div><span>Check out</span><strong>{formatTime12(summary.lastOut)}</strong></div></div><div className="checkin-actions"><button className="checkin-button in" disabled={!!summary.firstIn} onClick={() => openCheckPopup(member.id, 'in')}>{summary.firstIn ? `Checked in · ${formatTime12(summary.firstIn)}` : 'Check in'}</button><button className="checkin-button out" disabled={!summary.firstIn || !!summary.lastOut} title={!summary.firstIn ? 'Check in first' : undefined} onClick={() => openCheckPopup(member.id, 'out')}>{summary.lastOut ? `Checked out · ${formatTime12(summary.lastOut)}` : 'Check out'}</button></div></div>)}</div></section>}
          {unlocked && activeView === 'Team & shifts' && (monthlyStaffId ? <section className="panel full-panel monthly-panel"><div className="panel-heading"><div><button className="text-button back-button" onClick={() => setMonthlyStaffId(null)}>← Back to team</button><h2>{staff.find((member) => member.id === monthlyStaffId)?.name}&apos;s monthly attendance</h2><p>First check-in, last check-out, and total hours per day.</p></div><label className="date-picker">Month<input type="month" value={monthlyMonth} onChange={(event) => setMonthlyMonth(event.target.value)} /></label></div><div className="monthly-summary"><span>Total this month</span><strong>{formatDuration(monthlyTotal)}</strong></div><div className="monthly-table"><div className="monthly-table-head"><span>DATE</span><span>CHECK IN</span><span>CHECK OUT</span><span>TOTAL</span><span></span></div>{!monthlyReady && <p className="empty-note">Loading attendance...</p>}{monthlyDays.map((day) => <div className="monthly-table-row" key={day.date}><span>{formatDayLabel(day.date)}</span><span>{formatTime12(day.firstIn)}</span><span>{formatTime12(day.lastOut)}</span><strong>{formatDuration(day.totalMinutes)}</strong><button type="button" className="row-edit" onClick={() => setEditingDay({ staffId: monthlyStaffId, date: day.date, checkIn: day.firstIn ?? '', checkOut: day.lastOut ?? '' })}>Edit</button></div>)}</div></section> : <section className="panel full-panel"><div className="panel-heading"><div><h2>Team members</h2><p>Admin-managed staff profiles, shifts, and attendance. This is a single-user admin app.</p></div><span className="access-badge">Admin only</span></div><div className="team-cards">{staff.map((member) => <div className="team-card" key={member.id}><div className="team-card-top"><div className="avatar large">{initials(member.name)}</div><span className="status-label">Default shift</span></div><h3>{member.name}</h3><p>{member.role}</p><div className="team-shift"><span>Shift</span><strong>{formatShiftRange(member.shift)}</strong></div><div className="team-card-actions"><button className="secondary-button" onClick={() => openEditStaff(member)}>Edit</button><button className="secondary-button" onClick={() => setMonthlyStaffId(member.id)}>Monthly attendance</button></div></div>)}</div></section>)}
          {activeView === 'Clients' && (viewingClientKey ? <section className="panel full-panel monthly-panel"><div className="panel-heading"><div><button className="text-button back-button" onClick={() => setViewingClientKey(null)}>← Back to clients</button><h2>{selectedClient?.name}</h2><p>{selectedClient?.phone || 'No phone on file'}</p></div></div><div className="monthly-summary"><span>{selectedClient?.visitCount} visit{selectedClient?.visitCount === 1 ? '' : 's'}</span>{unlocked ? <strong>₹{selectedClient?.totalSpent.toLocaleString()}</strong> : revealButton}</div><div className="service-table client-history"><div className="table-head"><span>DATE</span><span>SERVICE</span><span>TEAM MEMBER</span><span>AMOUNT</span></div>{clientServiceHistory.map((service) => <div className="table-row" key={service.id} onClick={() => setViewingService(service)}><span>{formatShortDate(service.date)}</span><span>{service.treatments.map((line) => line.name).join(', ')}</span><span>{service.staff || '—'}</span><strong>₹{service.amount}{service.googleReview && <span className="review-badge" title="Google review taken">★</span>}</strong></div>)}</div></section> : <section className="panel full-panel"><div className="panel-heading"><div><h2>Clients</h2><p>Every customer who has visited, with their full service history.</p></div></div><div className="service-table client-list"><div className="table-head"><span>CLIENT</span><span>VISITS</span><span>TOTAL SPENT</span><span>LAST VISIT</span></div>{clientSummaries.map((client) => <div className="table-row" key={client.key} onClick={() => setViewingClientKey(client.key)}><div className="client-cell"><div className="avatar mini">{initials(client.name)}</div><div><strong>{client.name}</strong>{client.phone && <span className="client-phone">{client.phone}</span>}</div></div><span>{client.visitCount}</span>{unlocked ? <strong>₹{client.totalSpent.toLocaleString()}</strong> : <strong className="masked" title="Enter the admin PIN to see this">••••</strong>}<span>{formatShortDate(client.lastVisitDate)}</span></div>)}{clientSummaries.length === 0 && <p className="empty-note">No client visits recorded yet.</p>}</div></section>)}
          {activeView === 'Appointments' && <section className="panel full-panel"><div className="panel-heading"><div><h2>Appointments</h2><p>Bookings for clients who are coming in. Change or cancel them any time.</p></div></div><div className="period-toolbar"><div className="period-toggle"><button type="button" className={appointmentView === 'upcoming' ? 'active' : ''} onClick={() => setAppointmentView('upcoming')}>Upcoming</button><button type="button" className={appointmentView === 'past' ? 'active' : ''} onClick={() => setAppointmentView('past')}>Past</button></div></div><div className="monthly-summary"><span>{appointmentView === 'upcoming' ? `Upcoming appointments (${todayAppointmentCount} today)` : 'Past appointments'}</span><strong>{shownAppointments.length}</strong></div><div className="scroll-area">{appointmentGroups.map((group) => <div className="appointment-day" key={group.date}><p className="appointment-day-heading">{appointmentDayHeading(group.date)}</p>{group.items.map((item) => <div className="appointment-row" key={item.id}><strong className="appointment-time">{formatTime12(item.time)}</strong><div className="appointment-main"><strong>{item.client}</strong><span>{item.service}</span></div><div className="expense-actions"><button type="button" className="row-edit" onClick={() => openEditAppointment(item)}>Edit</button><button type="button" className="row-edit danger" onClick={() => cancelAppointment(item)}>Cancel</button></div></div>)}</div>)}{shownAppointments.length === 0 && <p className="empty-note">{appointmentView === 'upcoming' ? 'No upcoming appointments. Use "New appointment" to add one.' : 'No past appointments.'}</p>}</div></section>}
          {activeView === 'Services' && <section className="panel full-panel"><div className="panel-heading"><div><h2>Service records</h2><p>Track every client visit and the team member who delivered it.</p></div></div><div className="period-toolbar"><div className="period-toggle"><button type="button" className={servicePeriodType === 'week' ? 'active' : ''} onClick={() => setServicePeriodType('week')}>Week</button><button type="button" className={servicePeriodType === 'month' ? 'active' : ''} onClick={() => setServicePeriodType('month')}>Month</button></div><div className="period-nav"><button type="button" onClick={() => shiftServicePeriod(-1)}>←</button><span>{periodLabel}</span><button type="button" onClick={() => shiftServicePeriod(1)}>→</button></div><div className="period-toggle view-toggle"><button type="button" className={serviceView === 'records' ? 'active' : ''} onClick={() => setServiceView('records')}>Records</button><button type="button" className={serviceView === 'team' ? 'active' : ''} onClick={() => setServiceView('team')}>By team member</button></div>{serviceView === 'records' && <label className="date-picker staff-filter">Team member<select value={serviceStaffFilter} onChange={(event) => setServiceStaffFilter(event.target.value)}><option value="">All team members</option>{serviceStaffOptions.map((name) => <option key={name}>{name}</option>)}</select></label>}</div><div className="monthly-summary"><span>{filteredServices.length} service{filteredServices.length === 1 ? '' : 's'} in this {servicePeriodType}{serviceStaffFilter ? ` for ${serviceStaffFilter}` : ''}</span>{unlocked ? <strong>₹{periodTotal.toLocaleString()}</strong> : revealButton}</div>{serviceView === 'team' ? <div className="service-table team-breakdown"><div className="table-head"><span>TEAM MEMBER</span><span>SERVICES</span><span>REVENUE</span><span>SHARE</span><span>AVG / SERVICE</span></div>{teamBreakdown.rows.map((row) => <div className="table-row" key={row.name || 'none'}><div className="client-cell"><div className="avatar mini">{row.name ? initials(row.name) : '?'}</div><strong>{row.name || 'Not assigned'}</strong></div><span>{row.count}<small className="line-by"> in {row.visits} visit{row.visits === 1 ? '' : 's'}</small></span>{unlocked ? <><strong>₹{row.revenue.toLocaleString()}</strong><span>{Math.round((row.revenue / Math.max(teamBreakdown.all, 1)) * 100)}%</span><span>₹{Math.round(row.revenue / row.count).toLocaleString()}</span></> : <><strong className="masked" title="Enter the admin PIN to see this">••••</strong><span className="masked">••</span><span className="masked">••••</span></>}</div>)}{teamBreakdown.rows.length === 0 && <p className="empty-note">No services recorded for this {servicePeriodType}.</p>}{!unlocked && teamBreakdown.rows.length > 0 && <p className="empty-note">{revealButton} to see each person&apos;s revenue.</p>}</div> : <div className="service-table"><div className="table-head"><span>CLIENT</span><span>SERVICE</span><span>TEAM MEMBER</span><span>AMOUNT</span><span>TIME</span></div>{filteredServices.map((service) => <div className="table-row" key={service.id} onClick={() => setViewingService(service)}><div className="client-cell"><div className="avatar mini">{initials(service.client)}</div><div><strong>{service.client}</strong>{service.phone && <span className="client-phone">{service.phone}</span>}</div></div><span>{service.treatments.map((line) => line.name).join(', ')}</span><span>{service.staff || '—'}</span><strong>₹{shownAmount(service)}{service.googleReview && <span className="review-badge" title="Google review taken">★</span>}</strong><span className="time-cell">{formatTime12(service.time)}</span></div>)}{filteredServices.length === 0 && <p className="empty-note">No service records for this {servicePeriodType}{serviceStaffFilter ? ` for ${serviceStaffFilter}` : ''}.</p>}</div>}</section>}
          {activeView === 'Expenses' && <section className="panel full-panel"><div className="panel-heading"><div><h2>Expenses</h2><p>Record what the salon spends and see the profit for each month.</p></div></div><div className="period-toolbar"><div className="period-nav"><button type="button" onClick={() => shiftExpenseMonth(-1)}>←</button><span>{expenseMonthLabel}</span><button type="button" onClick={() => shiftExpenseMonth(1)}>→</button></div></div><div className="monthly-summary"><span>Spent this month ({monthExpenses.length} expense{monthExpenses.length === 1 ? '' : 's'})</span>{unlocked ? <strong>₹{monthSpend.toLocaleString()}</strong> : revealButton}</div><div className="monthly-summary"><span>{unlocked ? `Estimated profit (revenue ₹${monthRevenue.toLocaleString()} − expenses)` : 'Estimated profit'}</span>{unlocked ? <strong>₹{(monthRevenue - monthSpend).toLocaleString()}</strong> : revealButton}</div><div className="expense-list">{monthExpenses.map((expense) => <div className="expense-row" key={expense.id}><div className="expense-icon">◌</div><div><strong>{expense.label}</strong><span>{expense.category} · {formatShortDate(expense.date)}</span></div><strong>₹{expense.amount.toLocaleString()}</strong><div className="expense-actions"><button type="button" className="row-edit" onClick={() => openEditExpense(expense)}>Edit</button><button type="button" className="row-edit danger" onClick={() => deleteExpense(expense)}>Delete</button></div></div>)}{monthExpenses.length === 0 && <p className="empty-note">No expenses recorded for this month.</p>}</div></section>}
        </div>
      </main>
      {showStaffForm && <div className="modal-backdrop"><form className="modal" onSubmit={submitStaff}><button type="button" className="modal-close" onClick={() => setShowStaffForm(false)}>x</button><p className="eyebrow">TEAM DIRECTORY</p><h2>{editingStaffId ? 'Edit team member' : 'Add team member'}</h2><p className="modal-copy">{editingStaffId ? "Update this team member's profile and default shift." : 'Add a profile and default shift for your salon team.'}</p><label>Full name *<input required maxLength={80} pattern=".*\S.*" title="Please enter a value (not just spaces)" autoFocus value={newStaff.name} onChange={(event) => setNewStaff({ ...newStaff, name: event.target.value })} placeholder="e.g. Priya Shah" /></label><label>Role<select value={newStaff.role} onChange={(event) => setNewStaff({ ...newStaff, role: event.target.value })}><option>Beautician</option><option>Senior Beautician</option><option>Male Hairdresser</option><option>Unisex Senior Hairdresser</option><option>Nail Artist</option></select></label><label>Default shift<select value={useCustomShift ? 'custom' : newStaff.shift} onChange={(event) => { if (event.target.value === 'custom') { setUseCustomShift(true); setNewStaff({ ...newStaff, shift: `${customShiftRange.start} - ${customShiftRange.end}` }) } else { setUseCustomShift(false); setNewStaff({ ...newStaff, shift: event.target.value }) } }}><option value="10:00 - 19:30">10:00 AM - 7:30 PM</option><option value="11:30 - 20:15">11:30 AM - 8:15 PM</option><option value="12:00 - 21:30">12:00 PM - 9:30 PM</option><option value="12:00 - 21:00">12:00 PM - 9:00 PM</option><option value="11:00 - 20:00">11:00 AM - 8:00 PM</option><option value="custom">Custom...</option></select></label>{useCustomShift && <div className="form-row"><label>Start<input type="time" value={customShiftRange.start} onChange={(event) => { const start = event.target.value; setCustomShiftRange((current) => ({ ...current, start })); setNewStaff({ ...newStaff, shift: `${start} - ${customShiftRange.end}` }) }} /></label><label>End<input type="time" value={customShiftRange.end} onChange={(event) => { const end = event.target.value; setCustomShiftRange((current) => ({ ...current, end })); setNewStaff({ ...newStaff, shift: `${customShiftRange.start} - ${end}` }) }} /></label></div>}<button className="primary-button modal-submit" disabled={busy}>{editingStaffId ? 'Save changes' : 'Add member'}</button></form></div>}
      {showServiceForm && <div className="modal-backdrop"><form className="modal service-modal" onSubmit={submitService}>
        <div className="sm-head"><button type="button" className="modal-close" onClick={() => setShowServiceForm(false)}>x</button><p className="eyebrow">SERVICE LOG</p><h2>{editingServiceId ? 'Edit service' : 'Record a service'}</h2><p className="modal-copy">{editingServiceId ? 'Correct any detail of this visit.' : 'Add the client, what they had done, and who did it.'}</p></div>
        <div className="sm-body">
          <div className="form-row"><label>Client name *<input required maxLength={100} pattern=".*\S.*" title="Please enter a value (not just spaces)" autoFocus value={newService.client} onChange={(event) => setNewService({ ...newService, client: event.target.value })} placeholder="e.g. Anika Mehta" /></label><label>Phone number<input type="tel" inputMode="numeric" maxLength={10} pattern="\d{10}" title="Enter a 10-digit phone number" value={newService.phone} onChange={(event) => setNewService({ ...newService, phone: event.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10 digits" /></label></div>
          <div className="sm-section"><p className="sm-section-title">Services taken *</p>
            <div className="sm-lines-head"><span>Service</span><span>Done by <em>optional</em></span><span>Amount</span><span></span></div>
            <div className="service-rows">{newService.serviceRows.map((row, index) => <div className="service-row-input" key={index}><input required={index === 0} maxLength={100} value={row.name} onChange={(event) => updateServiceRow(index, { name: event.target.value })} placeholder="e.g. Haircut" aria-label={`Service ${index + 1} name`} /><select className="line-staff" aria-label={`Team member for service ${index + 1}`} value={row.staff} onChange={(event) => updateServiceRow(index, { staff: event.target.value })}><option value="">Not recorded</option>{staff.map((member) => <option key={member.id}>{member.name}</option>)}{row.staff && !staff.some((member) => member.name === row.staff) && <option>{row.staff}</option>}</select><div className="amount-field"><span>₹</span><input required={index === 0} type="text" inputMode="numeric" maxLength={8} value={row.amount} onChange={(event) => updateServiceRow(index, { amount: event.target.value.replace(/\D/g, '') })} placeholder="0" aria-label={`Service ${index + 1} amount`} /></div>{newService.serviceRows.length > 1 ? <button type="button" className="row-remove" aria-label={`Remove service ${index + 1}`} onClick={() => removeServiceRow(index)}>×</button> : <span></span>}</div>)}</div>
            <button type="button" className="add-row-button" onClick={addServiceRow}>+ Add another service</button>
          </div>
          <div className="form-row"><label>Remarks<input maxLength={500} value={newService.remarks} onChange={(event) => setNewService({ ...newService, remarks: event.target.value })} placeholder="Optional notes" /></label>{editingServiceId && <label>Date<input type="date" value={newService.date} max={localISODate()} onChange={(event) => setNewService({ ...newService, date: event.target.value })} /></label>}</div>
          <label className="checkbox-label review-check"><input type="checkbox" checked={newService.googleReview} onChange={(event) => setNewService({ ...newService, googleReview: event.target.checked })} /> Google review taken ★</label>
          {serviceError && <p className="form-error">{serviceError}</p>}
        </div>
        <div className="sm-foot"><div className="service-total"><span>Total</span><strong>₹{serviceRowsTotal.toLocaleString()}</strong></div><button className="primary-button modal-submit" disabled={busy}>{editingServiceId ? 'Save changes' : 'Save service'}</button></div>
      </form></div>}
      {checkPopup && <div className="modal-backdrop"><div className="modal checkin-modal"><button type="button" className="modal-close" onClick={() => setCheckPopup(null)}>x</button><p className="eyebrow">{checkPopup.type === 'in' ? 'CHECK IN' : 'CHECK OUT'}</p><h2>{staff.find((member) => member.id === checkPopup.staffId)?.name}</h2><p className="modal-copy">The {checkPopup.type === 'in' ? 'check-in' : 'check-out'} is recorded at the exact moment you confirm.</p><div className="checkin-time-display">{formatTime12(popupTime)}</div><button className="primary-button modal-submit" disabled={busy} onClick={confirmCheck}>Confirm {checkPopup.type === 'in' ? 'check-in' : 'check-out'}</button></div></div>}
      {viewingService && <div className="modal-backdrop" onClick={() => setViewingService(null)}><div className="modal service-detail-modal" onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setViewingService(null)}>x</button><p className="eyebrow">SERVICE DETAILS</p><h2>{viewingService.client}</h2>{viewingService.phone && <p className="modal-copy">{viewingService.phone}</p>}<div className="detail-grid"><div><span>Date</span><strong>{formatFullDate(viewingService.date)}</strong></div><div><span>Time</span><strong>{formatTime12(viewingService.time)}</strong></div><div><span>Team member</span><strong>{viewingService.staff || 'Not assigned'}</strong></div><div><span>Google review</span><strong>{viewingService.googleReview ? 'Yes ★' : 'No'}</strong></div></div><div className="detail-services"><p className="detail-label">Services taken</p>{viewingService.treatments.map((line, index) => <div className="detail-service-row" key={index}><span>{line.name}{line.staff && <small className="line-by"> · {line.staff}</small>}</span><strong>₹{line.amount.toLocaleString()}</strong></div>)}<div className="detail-service-row total"><span>Total</span><strong>₹{viewingService.amount.toLocaleString()}</strong></div></div>{viewingService.remarks && <div className="detail-remarks"><p className="detail-label">Remarks</p><p>{viewingService.remarks}</p></div>}<div className="detail-actions"><button type="button" className="secondary-button" onClick={() => openEditService(viewingService)}>Edit</button><button type="button" className="secondary-button danger-button" onClick={() => deleteService(viewingService)}>Delete</button></div></div></div>}
      {showPinPrompt && !unlocked && <div className="modal-backdrop">{renderPinForm(true)}</div>}
      {editingDay && <div className="modal-backdrop"><form className="modal" onSubmit={saveDay}><button type="button" className="modal-close" onClick={() => setEditingDay(null)}>x</button><p className="eyebrow">ATTENDANCE CORRECTION</p><h2>{staff.find((member) => member.id === editingDay.staffId)?.name}</h2><p className="modal-copy">{formatFullDate(editingDay.date)}</p><div className="form-row"><label>Check in<input type="time" value={editingDay.checkIn} onChange={(event) => setEditingDay({ ...editingDay, checkIn: event.target.value })} /></label><label>Check out<input type="time" value={editingDay.checkOut} onChange={(event) => setEditingDay({ ...editingDay, checkOut: event.target.value })} /></label></div><button className="primary-button modal-submit" disabled={busy}>Save</button><button type="button" className="secondary-button danger-button" onClick={clearDay}>Clear this day</button></form></div>}
      {showAppointmentForm && <div className="modal-backdrop"><form className="modal" onSubmit={submitAppointment}><button type="button" className="modal-close" onClick={() => setShowAppointmentForm(false)}>x</button><p className="eyebrow">APPOINTMENT</p><h2>{editingAppointmentId ? 'Edit appointment' : 'New appointment'}</h2><p className="modal-copy">Fields marked * are required.</p><label>Client name *<input required maxLength={100} pattern=".*\S.*" title="Please enter a value (not just spaces)" autoFocus value={newAppointment.client} onChange={(event) => setNewAppointment({ ...newAppointment, client: event.target.value })} placeholder="e.g. Anika Mehta" /></label><label>Service wanted *<input required maxLength={100} pattern=".*\S.*" title="Please enter a value (not just spaces)" value={newAppointment.service} onChange={(event) => setNewAppointment({ ...newAppointment, service: event.target.value })} placeholder="e.g. Haircut and facial" /></label><div className="form-row"><label>Date *<input required type="date" min={editingAppointmentId ? undefined : attendanceDate} value={newAppointment.date} onChange={(event) => setNewAppointment({ ...newAppointment, date: event.target.value })} /></label><label>Time *<input required type="time" value={newAppointment.time} onChange={(event) => setNewAppointment({ ...newAppointment, time: event.target.value })} /></label></div><button className="primary-button modal-submit" disabled={busy}>{editingAppointmentId ? 'Save changes' : 'Book appointment'}</button></form></div>}
      {showExpenseForm && <div className="modal-backdrop"><form className="modal" onSubmit={submitExpense}><button type="button" className="modal-close" onClick={() => setShowExpenseForm(false)}>x</button><p className="eyebrow">EXPENSE</p><h2>{editingExpenseId ? 'Edit expense' : 'Add expense'}</h2><p className="modal-copy">Record what the salon spent. Fields marked * are required.</p><label>Description *<input required maxLength={100} pattern=".*\S.*" title="Please enter a value (not just spaces)" autoFocus value={newExpense.label} onChange={(event) => setNewExpense({ ...newExpense, label: event.target.value })} placeholder="e.g. Shop rent" /></label><label>Category *<select value={newExpense.category} onChange={(event) => setNewExpense({ ...newExpense, category: event.target.value })}>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></label><div className="form-row"><label>Amount (₹) *<input required type="text" inputMode="numeric" maxLength={8} value={newExpense.amount} onChange={(event) => setNewExpense({ ...newExpense, amount: event.target.value.replace(/\D/g, '') })} placeholder="0" /></label><label>Date *<input required type="date" value={newExpense.date} max={localISODate()} onChange={(event) => setNewExpense({ ...newExpense, date: event.target.value })} /></label></div><button className="primary-button modal-submit" disabled={busy}>{editingExpenseId ? 'Save changes' : 'Add expense'}</button></form></div>}
    </div>
  )
}

export default App
