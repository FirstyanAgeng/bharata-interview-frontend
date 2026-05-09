export type Role = 'admin' | 'operator'

export type User = {
  _id: string
  name: string
  username: string
  role: Role
}

export type Item = {
  _id: string
  nama: string
  kode: string
  stok: number
  lokasi_rak: string
  createdAt?: string
  updatedAt?: string
}

export type TransactionType = 'barang masuk' | 'barang keluar'

export type Transaction = {
  _id: string
  id_barang: Item | null
  id_user: User | null
  tanggal: string
  tipe_transaksi: TransactionType
  jumlah: number
  catatan?: string
  stok_sebelum: number
  stok_sesudah: number
}

export type Dashboard = {
  stats: {
    totalBarang: number
    totalUser: number
    totalTransaksi: number
    lowStock: number
  }
  lowStockItems: Item[]
  recentTransactions: Transaction[]
}

export type AuthSession = {
  token: string
  user: User
}
