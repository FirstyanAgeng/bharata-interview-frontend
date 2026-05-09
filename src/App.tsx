import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { io } from 'socket.io-client'
import {
  buildApiUrl,
  getApiBase,
  getSocketBase,
  loadSession,
  request,
  saveSession,
} from './api'
import type { AuthSession, Dashboard, Item, Transaction, TransactionType, User } from './types'
import './App.css'

type TabKey = 'barang' | 'transaksi' | 'users'
type NoticeKind = 'success' | 'error' | 'info'

type Notice = {
  kind: NoticeKind
  text: string
}

type ItemForm = {
  nama: string
  kode: string
  stok: string
  lokasi_rak: string
}

type TransactionForm = {
  id_barang: string
  jumlah: string
  tipe_transaksi: TransactionType
  tanggal: string
  catatan: string
}

type UserForm = {
  name: string
  username: string
  password: string
  role: 'admin' | 'operator'
}

const LOW_STOCK_LIMIT = 10

const emptyItemForm: ItemForm = {
  nama: '',
  kode: '',
  stok: '0',
  lokasi_rak: '',
}

const emptyTransactionForm: TransactionForm = {
  id_barang: '',
  jumlah: '1',
  tipe_transaksi: 'barang masuk',
  tanggal: new Date().toISOString().slice(0, 16),
  catatan: '',
}

const emptyUserForm: UserForm = {
  name: '',
  username: '',
  password: '',
  role: 'operator',
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('id-ID').format(value)
}

function getErrorText(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Terjadi kesalahan'
}

function isItemObject(value: unknown): value is Item {
  return Boolean(value && typeof value === 'object' && '_id' in value && 'nama' in value)
}

function isUserObject(value: unknown): value is User {
  return Boolean(value && typeof value === 'object' && '_id' in value && 'username' in value)
}

function App() {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession())
  const [me, setMe] = useState<User | null>(session?.user ?? null)
  const [activeTab, setActiveTab] = useState<TabKey>('barang')
  const [items, setItems] = useState<Item[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm)
  const [transactionForm, setTransactionForm] = useState<TransactionForm>(emptyTransactionForm)
  const [userForm, setUserForm] = useState<UserForm>(emptyUserForm)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [loginForm, setLoginForm] = useState({ username: 'admin', password: 'admin123' })
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [socketReady, setSocketReady] = useState(false)

  const token = session?.token || null
  const apiBase = useMemo(() => getApiBase() || buildApiUrl('/api/health').replace('/api/health', ''), [])

  const isAdmin = me?.role === 'admin'

  function notify(kind: NoticeKind, text: string) {
    setNotice({ kind, text })
  }

  async function refreshDashboard(tokenValue = token) {
    if (!tokenValue) return
    const data = await request<Dashboard>('/api/dashboard', { token: tokenValue })
    setDashboard(data)
  }

  async function refreshItems(tokenValue = token) {
    if (!tokenValue) return
    const data = await request<{ items: Item[] }>('/api/items', { token: tokenValue })
    setItems(data.items)
  }

  async function refreshTransactions(tokenValue = token) {
    if (!tokenValue) return
    const data = await request<{ transactions: Transaction[] }>('/api/transactions', {
      token: tokenValue,
    })
    setTransactions(data.transactions)
  }

  async function refreshUsers(tokenValue = token) {
    if (!tokenValue || !isAdmin) return
    const data = await request<{ users: User[] }>('/api/users', { token: tokenValue })
    setUsers(data.users)
  }

  async function refreshEverything(tokenValue = token, includeUsers = isAdmin) {
    if (!tokenValue) return
    await Promise.all([refreshDashboard(tokenValue), refreshItems(tokenValue), refreshTransactions(tokenValue)])
    if (includeUsers) {
      await refreshUsers(tokenValue)
    }
  }

  useEffect(() => {
    if (!token) {
      setMe(session?.user ?? null)
      setDashboard(null)
      setItems([])
      setTransactions([])
      setUsers([])
      return
    }

    let cancelled = false
    setLoading(true)

    request<{ user: User }>('/api/auth/me', { token })
      .then(({ user }) => {
        if (cancelled) return
        setMe(user)
        setSession((prev) => {
          const next = prev ? { ...prev, user } : { token, user }
          saveSession(next)
          return next
        })
        return refreshEverything(token, user.role === 'admin')
      })
      .catch((error) => {
        if (cancelled) return
        notify('error', getErrorText(error))
        saveSession(null)
        setSession(null)
        setMe(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (!token) return

    const socket = io(getSocketBase(), {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket'],
    })

    socket.on('connect', () => setSocketReady(true))
    socket.on('disconnect', () => setSocketReady(false))
    socket.on('inventory:changed', () => {
      void refreshEverything(token, isAdmin)
    })

    return () => {
      socket.disconnect()
    }
  }, [token, isAdmin])

  useEffect(() => {
    if (notice) {
      const timer = window.setTimeout(() => setNotice(null), 4000)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [notice])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)

    try {
      const data = await request<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginForm),
      })
      const nextSession = { token: data.token, user: data.user }
      saveSession(nextSession)
      setSession(nextSession)
      setMe(data.user)
      notify('success', `Login berhasil sebagai ${data.user.role}`)
      await refreshEverything(data.token, data.user.role === 'admin')
      setActiveTab(data.user.role === 'admin' ? 'users' : 'barang')
    } catch (error) {
      notify('error', getErrorText(error))
    } finally {
      setLoading(false)
    }
  }

  function logout() {
    saveSession(null)
    setSession(null)
    setMe(null)
    setSocketReady(false)
    setItems([])
    setTransactions([])
    setUsers([])
    setDashboard(null)
    setItemForm(emptyItemForm)
    setTransactionForm(emptyTransactionForm)
    setUserForm(emptyUserForm)
    setEditingItemId(null)
    setEditingTransactionId(null)
    setEditingUserId(null)
  }

  function resetItemForm() {
    setItemForm(emptyItemForm)
    setEditingItemId(null)
  }

  function resetTransactionForm() {
    setTransactionForm((current) => ({
      ...emptyTransactionForm,
      id_barang: items[0]?._id || '',
      tanggal: current.tanggal || emptyTransactionForm.tanggal,
    }))
    setEditingTransactionId(null)
  }

  function resetUserForm() {
    setUserForm(emptyUserForm)
    setEditingUserId(null)
  }

  async function handleItemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return

    const payload = {
      nama: itemForm.nama,
      kode: itemForm.kode,
      stok: Number(itemForm.stok),
      lokasi_rak: itemForm.lokasi_rak,
    }

    try {
      if (editingItemId) {
        await request(`/api/items/${editingItemId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
          token,
        })
        notify('success', 'Barang berhasil diperbarui')
      } else {
        await request('/api/items', {
          method: 'POST',
          body: JSON.stringify(payload),
          token,
        })
        notify('success', 'Barang berhasil ditambahkan')
      }
      resetItemForm()
      await refreshEverything(token)
    } catch (error) {
      notify('error', getErrorText(error))
    }
  }

  async function handleItemDelete(itemId: string) {
    if (!token) return
    if (!window.confirm('Hapus barang ini?')) return

    try {
      await request(`/api/items/${itemId}`, { method: 'DELETE', token })
      notify('success', 'Barang dihapus')
      await refreshEverything(token)
    } catch (error) {
      notify('error', getErrorText(error))
    }
  }

  async function handleTransactionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return

    const payload = {
      id_barang: transactionForm.id_barang,
      jumlah: Number(transactionForm.jumlah),
      tipe_transaksi: transactionForm.tipe_transaksi,
      tanggal: new Date(transactionForm.tanggal).toISOString(),
      catatan: transactionForm.catatan,
    }

    try {
      if (editingTransactionId) {
        await request(`/api/transactions/${editingTransactionId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
          token,
        })
        notify('success', 'Transaksi berhasil diperbarui')
      } else {
        await request('/api/transactions', {
          method: 'POST',
          body: JSON.stringify(payload),
          token,
        })
        notify('success', 'Transaksi berhasil disimpan')
      }
      resetTransactionForm()
      await refreshEverything(token)
    } catch (error) {
      notify('error', getErrorText(error))
    }
  }

  async function handleTransactionDelete(transactionId: string) {
    if (!token) return
    if (!window.confirm('Hapus transaksi ini? Stok akan dikembalikan.')) return

    try {
      await request(`/api/transactions/${transactionId}`, { method: 'DELETE', token })
      notify('success', 'Transaksi dihapus')
      await refreshEverything(token)
    } catch (error) {
      notify('error', getErrorText(error))
    }
  }

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return

    try {
      if (editingUserId) {
        await request(`/api/users/${editingUserId}`, {
          method: 'PUT',
          body: JSON.stringify(userForm),
          token,
        })
        notify('success', 'User berhasil diperbarui')
      } else {
        await request('/api/users', {
          method: 'POST',
          body: JSON.stringify(userForm),
          token,
        })
        notify('success', 'User berhasil ditambahkan')
      }
      resetUserForm()
      await refreshUsers(token)
      await refreshDashboard(token)
    } catch (error) {
      notify('error', getErrorText(error))
    }
  }

  async function handleUserDelete(userId: string) {
    if (!token) return
    if (!window.confirm('Hapus user ini?')) return

    try {
      await request(`/api/users/${userId}`, { method: 'DELETE', token })
      notify('success', 'User dihapus')
      await refreshUsers(token)
      await refreshDashboard(token)
    } catch (error) {
      notify('error', getErrorText(error))
    }
  }

  function beginEditItem(item: Item) {
    setEditingItemId(item._id)
    setItemForm({
      nama: item.nama,
      kode: item.kode,
      stok: String(item.stok),
      lokasi_rak: item.lokasi_rak,
    })
    setActiveTab('barang')
  }

  function beginEditTransaction(transaction: Transaction) {
    setEditingTransactionId(transaction._id)
    setTransactionForm({
      id_barang: isItemObject(transaction.id_barang) ? transaction.id_barang._id : '',
      jumlah: String(transaction.jumlah),
      tipe_transaksi: transaction.tipe_transaksi,
      tanggal: new Date(transaction.tanggal).toISOString().slice(0, 16),
      catatan: transaction.catatan || '',
    })
    setActiveTab('transaksi')
  }

  function beginEditUser(user: User) {
    setEditingUserId(user._id)
    setUserForm({
      name: user.name,
      username: user.username,
      password: '',
      role: user.role,
    })
    setActiveTab('users')
  }

  const itemsSorted = useMemo(() => [...items].sort((a, b) => a.nama.localeCompare(b.nama)), [items])
  const transactionCount = transactions.length

  if (!token || !me) {
    return (
      <div className="login-shell">
        <div className="login-hero">
          <span className="eyebrow">Dashboard stok barang</span>
          <h1>Kelola barang, transaksi, dan user dari satu layar.</h1>
          <p>
            Login admin dan operator, update stok realtime, serta lindungi stok dari race
            condition dengan transaksi atomik di backend.
          </p>
          <div className="login-points">
            <span>CRUD barang</span>
            <span>CRUD transaksi</span>
            <span>Realtime socket</span>
            <span>Stok rendah &lt; 10</span>
          </div>
          <div className="seed-card">
            <strong>Default login</strong>
            <span>admin / admin123</span>
            <span>operator / operator123</span>
          </div>
        </div>

        <form className="panel login-card" onSubmit={handleLogin}>
          <h2>Masuk ke sistem</h2>
          <p>Gunakan akun admin atau operator yang sudah dibuat.</p>

          <label>
            Username
            <input
              value={loginForm.username}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, username: event.target.value }))
              }
              autoComplete="username"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, password: event.target.value }))
              }
              autoComplete="current-password"
            />
          </label>

          <button type="submit" disabled={loading}>
            {loading ? 'Memproses...' : 'Login'}
          </button>

          <div className="login-footer">
            <span>Backend: {apiBase || 'relative /api'}</span>
            <span>Socket: {socketReady ? 'connected' : 'offline'}</span>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar panel">
        <div>
          <span className="eyebrow">Realtime inventory</span>
          <h1>Stok Control</h1>
          <p>Operator fokus ke barang dan transaksi. Admin mengelola semua user.</p>
        </div>

        <div className="sidebar-card">
          <div>
            <span>Login aktif</span>
            <strong>{me.name}</strong>
          </div>
          <div>
            <span>Role</span>
            <strong className={`role-badge role-${me.role}`}>{me.role}</strong>
          </div>
          <div>
            <span>Socket</span>
            <strong className={socketReady ? 'status-on' : 'status-off'}>
              {socketReady ? 'connected' : 'connecting'}
            </strong>
          </div>
        </div>

        <nav className="tab-list">
          <button
            type="button"
            className={activeTab === 'barang' ? 'tab active' : 'tab'}
            onClick={() => setActiveTab('barang')}
          >
            Barang
          </button>
          <button
            type="button"
            className={activeTab === 'transaksi' ? 'tab active' : 'tab'}
            onClick={() => setActiveTab('transaksi')}
          >
            Transaksi
          </button>
          {isAdmin && (
            <button
              type="button"
              className={activeTab === 'users' ? 'tab active' : 'tab'}
              onClick={() => setActiveTab('users')}
            >
              User
            </button>
          )}
        </nav>

        <button type="button" className="ghost-button" onClick={logout}>
          Logout
        </button>
      </aside>

      <main className="content">
        {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

        <section className="hero-card panel">
          <div>
            <span className="eyebrow">Ringkasan</span>
            <h2>{loading ? 'Memuat data...' : 'Dashboard stok barang sederhana'}</h2>
            <p>
              Data di-refresh otomatis setiap ada transaksi atau perubahan barang. Cocok untuk
              skenario stok dengan banyak operator.
            </p>
          </div>

          <div className="hero-meta">
            <div>
              <span>Total barang</span>
              <strong>{dashboard?.stats.totalBarang ?? items.length}</strong>
            </div>
            <div>
              <span>Stok rendah</span>
              <strong>{dashboard?.stats.lowStock ?? items.filter((item) => item.stok < LOW_STOCK_LIMIT).length}</strong>
            </div>
            <div>
              <span>Transaksi</span>
              <strong>{dashboard?.stats.totalTransaksi ?? transactionCount}</strong>
            </div>
          </div>
        </section>

        <section className="stats-grid">
          <article className="stat-card panel">
            <span>Total barang</span>
            <strong>{dashboard?.stats.totalBarang ?? items.length}</strong>
          </article>
          <article className="stat-card panel warning">
            <span>Stok kurang dari 10</span>
            <strong>{dashboard?.stats.lowStock ?? items.filter((item) => item.stok < LOW_STOCK_LIMIT).length}</strong>
          </article>
          <article className="stat-card panel">
            <span>Total transaksi</span>
            <strong>{dashboard?.stats.totalTransaksi ?? transactionCount}</strong>
          </article>
          {isAdmin && (
            <article className="stat-card panel">
              <span>Total user</span>
              <strong>{dashboard?.stats.totalUser ?? users.length}</strong>
            </article>
          )}
        </section>

        {activeTab === 'barang' && (
          <section className="section-grid">
            <form className="panel form-card" onSubmit={handleItemSubmit}>
              <div className="panel-head">
                <div>
                  <span className="eyebrow">Master barang</span>
                  <h3>{editingItemId ? 'Edit barang' : 'Tambah barang'}</h3>
                </div>
                {editingItemId && (
                  <button type="button" className="ghost-button small" onClick={resetItemForm}>
                    Batal
                  </button>
                )}
              </div>

              <label>
                Nama barang
                <input
                  value={itemForm.nama}
                  onChange={(event) =>
                    setItemForm((current) => ({ ...current, nama: event.target.value }))
                  }
                  placeholder="Contoh: Kabel HDMI"
                />
              </label>

              <label>
                Kode barang
                <input
                  value={itemForm.kode}
                  onChange={(event) =>
                    setItemForm((current) => ({ ...current, kode: event.target.value }))
                  }
                  placeholder="HDMI-01"
                />
              </label>

              <div className="field-row">
                <label>
                  Stok
                  <input
                    type="number"
                    min="0"
                    value={itemForm.stok}
                    onChange={(event) =>
                      setItemForm((current) => ({ ...current, stok: event.target.value }))
                    }
                  />
                </label>

                <label>
                  Lokasi rak
                  <input
                    value={itemForm.lokasi_rak}
                    onChange={(event) =>
                      setItemForm((current) => ({ ...current, lokasi_rak: event.target.value }))
                    }
                    placeholder="Rak A3"
                  />
                </label>
              </div>

              <button type="submit">{editingItemId ? 'Update barang' : 'Simpan barang'}</button>
            </form>

            <div className="panel table-card">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">Daftar barang</span>
                  <h3>{itemsSorted.length} item</h3>
                </div>
                <button type="button" className="ghost-button small" onClick={() => refreshItems(token)}>
                  Refresh
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Kode</th>
                      <th>Stok</th>
                      <th>Rak</th>
                      <th>Status</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsSorted.map((item) => (
                      <tr key={item._id}>
                        <td>{item.nama}</td>
                        <td>{item.kode}</td>
                        <td>{formatNumber(item.stok)}</td>
                        <td>{item.lokasi_rak}</td>
                        <td>
                          <span className={item.stok < LOW_STOCK_LIMIT ? 'pill low' : 'pill'}>
                            {item.stok < LOW_STOCK_LIMIT ? 'stok rendah' : 'aman'}
                          </span>
                        </td>
                        <td className="row-actions">
                          <button type="button" onClick={() => beginEditItem(item)}>
                            Edit
                          </button>
                          <button type="button" className="danger" onClick={() => handleItemDelete(item._id)}>
                            Hapus
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!itemsSorted.length && (
                      <tr>
                        <td colSpan={6} className="empty-state">
                          Belum ada barang.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'transaksi' && (
          <section className="section-grid">
            <form className="panel form-card" onSubmit={handleTransactionSubmit}>
              <div className="panel-head">
                <div>
                  <span className="eyebrow">Transaksi</span>
                  <h3>{editingTransactionId ? 'Edit transaksi' : 'Barang masuk / keluar'}</h3>
                </div>
                {editingTransactionId && (
                  <button type="button" className="ghost-button small" onClick={resetTransactionForm}>
                    Batal
                  </button>
                )}
              </div>

              <label>
                Barang
                <select
                  value={transactionForm.id_barang}
                  onChange={(event) =>
                    setTransactionForm((current) => ({ ...current, id_barang: event.target.value }))
                  }
                >
                  <option value="">Pilih barang</option>
                  {itemsSorted.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.nama} - {item.kode} (stok {item.stok})
                    </option>
                  ))}
                </select>
              </label>

              <div className="field-row">
                <label>
                  Tipe transaksi
                  <select
                    value={transactionForm.tipe_transaksi}
                    onChange={(event) =>
                      setTransactionForm((current) => ({
                        ...current,
                        tipe_transaksi: event.target.value as TransactionType,
                      }))
                    }
                  >
                    <option value="barang masuk">Barang masuk</option>
                    <option value="barang keluar">Barang keluar</option>
                  </select>
                </label>

                <label>
                  Jumlah
                  <input
                    type="number"
                    min="1"
                    value={transactionForm.jumlah}
                    onChange={(event) =>
                      setTransactionForm((current) => ({ ...current, jumlah: event.target.value }))
                    }
                  />
                </label>
              </div>

              <label>
                Tanggal
                <input
                  type="datetime-local"
                  value={transactionForm.tanggal}
                  onChange={(event) =>
                    setTransactionForm((current) => ({ ...current, tanggal: event.target.value }))
                  }
                />
              </label>

              <label>
                Catatan
                <textarea
                  rows={3}
                  value={transactionForm.catatan}
                  onChange={(event) =>
                    setTransactionForm((current) => ({ ...current, catatan: event.target.value }))
                  }
                  placeholder="Opsional"
                />
              </label>

              <button type="submit">
                {editingTransactionId ? 'Update transaksi' : 'Simpan transaksi'}
              </button>
            </form>

            <div className="panel table-card">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">Riwayat transaksi</span>
                  <h3>{transactions.length} transaksi</h3>
                </div>
                <button type="button" className="ghost-button small" onClick={() => refreshTransactions(token)}>
                  Refresh
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Barang</th>
                      <th>Tipe</th>
                      <th>Jumlah</th>
                      <th>User</th>
                      <th>Stok</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction) => (
                      <tr key={transaction._id}>
                        <td>{formatDateTime(transaction.tanggal)}</td>
                        <td>
                          {isItemObject(transaction.id_barang)
                            ? transaction.id_barang.nama
                            : 'Barang dihapus'}
                        </td>
                        <td>
                          <span
                            className={
                              transaction.tipe_transaksi === 'barang masuk'
                                ? 'pill income'
                                : 'pill outcome'
                            }
                          >
                            {transaction.tipe_transaksi}
                          </span>
                        </td>
                        <td>{formatNumber(transaction.jumlah)}</td>
                        <td>
                          {isUserObject(transaction.id_user) ? transaction.id_user.username : '-'}
                        </td>
                        <td>
                          {formatNumber(transaction.stok_sebelum)} {'->'} {formatNumber(transaction.stok_sesudah)}
                        </td>
                        <td className="row-actions">
                          <button type="button" onClick={() => beginEditTransaction(transaction)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleTransactionDelete(transaction._id)}
                          >
                            Hapus
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!transactions.length && (
                      <tr>
                        <td colSpan={7} className="empty-state">
                          Belum ada transaksi.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'users' && isAdmin && (
          <section className="section-grid">
            <form className="panel form-card" onSubmit={handleUserSubmit}>
              <div className="panel-head">
                <div>
                  <span className="eyebrow">User operator</span>
                  <h3>{editingUserId ? 'Edit user' : 'Tambah user'}</h3>
                </div>
                {editingUserId && (
                  <button type="button" className="ghost-button small" onClick={resetUserForm}>
                    Batal
                  </button>
                )}
              </div>

              <label>
                Nama
                <input
                  value={userForm.name}
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>

              <label>
                Username
                <input
                  value={userForm.username}
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, username: event.target.value }))
                  }
                />
              </label>

              <div className="field-row">
                <label>
                  Password
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(event) =>
                      setUserForm((current) => ({ ...current, password: event.target.value }))
                    }
                    placeholder={editingUserId ? 'Kosongkan jika tidak berubah' : 'Password baru'}
                  />
                </label>

                <label>
                  Role
                  <select
                    value={userForm.role}
                    onChange={(event) =>
                      setUserForm((current) => ({
                        ...current,
                        role: event.target.value as 'admin' | 'operator',
                      }))
                    }
                  >
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              </div>

              <button type="submit">{editingUserId ? 'Update user' : 'Simpan user'}</button>
            </form>

            <div className="panel table-card">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">Daftar user</span>
                  <h3>{users.length} user</h3>
                </div>
                <button type="button" className="ghost-button small" onClick={() => refreshUsers(token)}>
                  Refresh
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user._id}>
                        <td>{user.name}</td>
                        <td>{user.username}</td>
                        <td>
                          <span className={`pill role-${user.role}`}>{user.role}</span>
                        </td>
                        <td className="row-actions">
                          <button type="button" onClick={() => beginEditUser(user)}>
                            Edit
                          </button>
                          <button type="button" className="danger" onClick={() => handleUserDelete(user._id)}>
                            Hapus
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!users.length && (
                      <tr>
                        <td colSpan={4} className="empty-state">
                          Belum ada user tambahan.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        <section className="panel footer-card">
          <div>
            <strong>Realtime endpoint</strong>
            <p>{apiBase || 'relative /api'} dan socket.io path /socket.io</p>
          </div>
          <div>
            <strong>Catatan stok aman</strong>
            <p>
              Pengurangan stok dilakukan secara atomik di backend untuk menahan race condition
              saat banyak user submit transaksi bersamaan.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
