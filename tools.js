import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Muat data katalog
const katalogPath = path.join(__dirname, 'data', 'katalog.json');
const rawKatalog = JSON.parse(fs.readFileSync(katalogPath, 'utf8'));

// Pastikan data katalog aman dan tidak menyertakan properti 'satuan'
export const katalog = {
  produk: rawKatalog.produk.map(({ satuan, ...rest }) => ({ ...rest })),
  paket: rawKatalog.paket.map(({ satuan, ...rest }) => ({ ...rest }))
};

/**
 * 5. inisialisasiStok(): Membuat object deep-copy stok produk saat ini dari katalog.
 */
export function inisialisasiStok() {
  const stokMap = {};
  for (const item of katalog.produk) {
    stokMap[item.nama] = item.stok;
  }
  return stokMap;
}

/**
 * Helper untuk normalisasi teks (trim & lowercase)
 */
function normalizeText(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 1. cariProduk({ kata_kunci, kategori, maks_harga }):
 * Mencari kue & paket, case-insensitive, toleran spasi.
 */
export function cariProduk({ kata_kunci, kategori, maks_harga } = {}) {
  const query = normalizeText(kata_kunci);
  const kat = normalizeText(kategori);
  const maxPrice = typeof maks_harga === 'number' ? maks_harga : (maks_harga ? Number(maks_harga) : null);

  const hasilProduk = katalog.produk.filter((p) => {
    if (kat && normalizeText(p.kategori) !== kat) {
      return false;
    }
    if (maxPrice !== null && !isNaN(maxPrice) && p.harga > maxPrice) {
      return false;
    }
    if (query) {
      const matchNama = normalizeText(p.nama).includes(query);
      const matchDeskripsi = normalizeText(p.deskripsi).includes(query);
      const matchKategori = normalizeText(p.kategori).includes(query);
      const matchAlergen = Array.isArray(p.alergen) && p.alergen.some((a) => normalizeText(a).includes(query));
      if (!matchNama && !matchDeskripsi && !matchKategori && !matchAlergen) {
        return false;
      }
    }
    return true;
  }).map((p) => ({
    nama: p.nama,
    kategori: p.kategori,
    harga: p.harga,
    sebutan: p.sebutan,
    alergen: p.alergen,
    deskripsi: p.deskripsi,
    terlaris: p.terlaris
  }));

  const hasilPaket = katalog.paket.filter((pkt) => {
    if (kat && kat !== 'paket') {
      return false;
    }
    if (maxPrice !== null && !isNaN(maxPrice) && pkt.harga > maxPrice) {
      return false;
    }
    if (query) {
      const matchNama = normalizeText(pkt.nama).includes(query);
      const matchIsi = pkt.isi.some((item) => normalizeText(item.produk).includes(query));
      if (!matchNama && !matchIsi && query !== 'paket') {
        return false;
      }
    }
    return true;
  }).map((pkt) => {
    const isiDeskripsi = pkt.isi.map((i) => `${i.jumlah} ${i.produk}`).join(' + ');
    return {
      nama: pkt.nama,
      kategori: 'paket',
      harga: pkt.harga,
      sebutan: pkt.sebutan,
      deskripsi: `Paket hemat berisi: ${isiDeskripsi}.`,
      isi: pkt.isi
    };
  });

  return {
    total_ditemukan: hasilProduk.length + hasilPaket.length,
    produk: hasilProduk,
    paket: hasilPaket
  };
}

/**
 * 2. cekStok({ nama }): Cek stok produk atau paket (stok paket = minimum stok produk penyusunnya).
 */
export function cekStok(sessionOrParams, maybeParams) {
  let session = null;
  let params = {};

  if (maybeParams !== undefined) {
    session = sessionOrParams;
    params = maybeParams || {};
  } else if (sessionOrParams && typeof sessionOrParams === 'object') {
    if (sessionOrParams.nama) {
      params = sessionOrParams;
    } else {
      session = sessionOrParams;
    }
  }

  const namaQuery = normalizeText(params.nama);
  if (!namaQuery) {
    return { error: 'Nama produk atau paket harus disertakan.' };
  }

  const stokAktif = (session && session.stok) ? session.stok : inisialisasiStok();

  // Cek apakah produk biasa
  const prod = katalog.produk.find((p) => normalizeText(p.nama) === namaQuery || normalizeText(p.nama).includes(namaQuery));
  if (prod) {
    const stokSaatIni = stokAktif[prod.nama] ?? 0;
    return {
      nama: prod.nama,
      kategori: prod.kategori,
      stok: stokSaatIni,
      sebutan: prod.sebutan,
      tersedia: stokSaatIni > 0,
      harga: prod.harga
    };
  }

  // Cek apakah paket
  const pkt = katalog.paket.find((p) => normalizeText(p.nama) === namaQuery || normalizeText(p.nama).includes(namaQuery));
  if (pkt) {
    let minStokPaket = Infinity;
    const rincianBahan = [];

    for (const item of pkt.isi) {
      const s = stokAktif[item.produk] ?? 0;
      const kapasitas = Math.floor(s / item.jumlah);
      if (kapasitas < minStokPaket) {
        minStokPaket = kapasitas;
      }
      rincianBahan.push({
        produk: item.produk,
        stok_tersedia: s,
        butuh_per_paket: item.jumlah
      });
    }

    if (minStokPaket === Infinity) minStokPaket = 0;

    return {
      nama: pkt.nama,
      kategori: 'paket',
      stok: minStokPaket,
      sebutan: pkt.sebutan,
      tersedia: minStokPaket > 0,
      harga: pkt.harga,
      rincian_bahan: rincianBahan
    };
  }

  return { error: `Produk atau paket "${params.nama}" tidak ditemukan di katalog.` };
}

/**
 * 3. infoAlergen({ nama }): Cek alergen resmi sesuai data katalog.
 */
export function infoAlergen({ nama } = {}) {
  const namaQuery = normalizeText(nama);
  if (!namaQuery) {
    return { error: 'Nama kue harus disertakan untuk memeriksa alergen.' };
  }

  // Cek produk biasa
  const prod = katalog.produk.find((p) => normalizeText(p.nama) === namaQuery || normalizeText(p.nama).includes(namaQuery));
  if (prod) {
    return {
      nama: prod.nama,
      alergen: prod.alergen || [],
      informasi: prod.alergen && prod.alergen.length > 0
        ? `Kue ${prod.nama} mengandung alergen: ${prod.alergen.join(', ')}.`
        : `Kue ${prod.nama} tidak memiliki catatan alergen khusus.`
    };
  }

  // Cek paket (gabungan alergen produk penyusunnya)
  const pkt = katalog.paket.find((p) => normalizeText(p.nama) === namaQuery || normalizeText(p.nama).includes(namaQuery));
  if (pkt) {
    const setAlergen = new Set();
    for (const item of pkt.isi) {
      const pFound = katalog.produk.find((pr) => pr.nama.toLowerCase() === item.produk.toLowerCase());
      if (pFound && Array.isArray(pFound.alergen)) {
        pFound.alergen.forEach((a) => setAlergen.add(a));
      }
    }
    const listAlergen = Array.from(setAlergen);
    return {
      nama: pkt.nama,
      alergen: listAlergen,
      informasi: `Paket ${pkt.nama} secara keseluruhan mengandung alergen: ${listAlergen.join(', ')}.`
    };
  }

  return { error: `Kue "${nama}" tidak ditemukan di katalog.` };
}

/**
 * 4. daftarTerlaris(): Menampilkan produk yang bertanda terlaris: true.
 */
export function daftarTerlaris() {
  const terlaris = katalog.produk
    .filter((p) => p.terlaris)
    .map((p) => ({
      nama: p.nama,
      kategori: p.kategori,
      harga: p.harga,
      sebutan: p.sebutan,
      deskripsi: p.deskripsi
    }));

  return {
    pesan: 'Berikut adalah menu kue terlaris di Toko Kue Mas Aniz:',
    produk: terlaris
  };
}

/**
 * 6. tambahKeKeranjang(session, { nama, jumlah }):
 * Validasi jumlah (1-20), cek kecukupan stok sesi, masukkan ke keranjang belanja pelanggan, dan kurangi stok aktif sesi.
 */
export function tambahKeKeranjang(session, { nama, jumlah } = {}) {
  if (!session) {
    return { status: 'gagal', pesan: 'Sesi pelanggan tidak valid.' };
  }

  const qty = Number(jumlah);
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
    return { status: 'gagal', pesan: 'Jumlah pemesanan harus berupa angka bulat antara 1 sampai 20.' };
  }

  session.stok = session.stok || inisialisasiStok();
  session.keranjang = session.keranjang || [];

  const namaQuery = normalizeText(nama);
  if (!namaQuery) {
    return { status: 'gagal', pesan: 'Nama kue atau paket harus diisi.' };
  }

  // 1. Cek apakah produk biasa
  const prod = katalog.produk.find((p) => normalizeText(p.nama) === namaQuery || normalizeText(p.nama).includes(namaQuery));
  if (prod) {
    const sisaStok = session.stok[prod.nama] ?? 0;
    if (sisaStok < qty) {
      return {
        status: 'gagal',
        pesan: `Maaf kak, stok ${prod.nama} tidak mencukupi. Sisa stok saat ini hanya tersisa ${sisaStok} ${prod.sebutan}.`
      };
    }

    // Kurangi stok aktif sesi
    session.stok[prod.nama] -= qty;

    // Masukkan ke keranjang
    const existing = session.keranjang.find((k) => k.nama === prod.nama);
    if (existing) {
      existing.jumlah += qty;
      existing.subtotal = existing.jumlah * existing.harga_satuan;
    } else {
      session.keranjang.push({
        nama: prod.nama,
        jumlah: qty,
        sebutan: prod.sebutan,
        harga_satuan: prod.harga,
        subtotal: prod.harga * qty
      });
    }

    const totalHargaKeranjang = session.keranjang.reduce((sum, item) => sum + item.subtotal, 0);

    return {
      status: 'sukses',
      pesan: `Berhasil menambahkan ${qty} ${prod.sebutan} ${prod.nama} ke keranjang belanja.`,
      item_ditambahkan: {
        nama: prod.nama,
        jumlah: qty,
        sebutan: prod.sebutan,
        subtotal: prod.harga * qty
      },
      sisa_stok: session.stok[prod.nama],
      total_pembayaran_sementara: totalHargaKeranjang
    };
  }

  // 2. Cek apakah paket
  const pkt = katalog.paket.find((p) => normalizeText(p.nama) === namaQuery || normalizeText(p.nama).includes(namaQuery));
  if (pkt) {
    // Validasi stok semua penyusun
    for (const item of pkt.isi) {
      const butuh = item.jumlah * qty;
      const s = session.stok[item.produk] ?? 0;
      if (s < butuh) {
        return {
          status: 'gagal',
          pesan: `Maaf kak, stok bahan untuk ${pkt.nama} tidak mencukupi karena ${item.produk} hanya tersisa ${s}.`
        };
      }
    }

    // Kurangi stok semua penyusun
    for (const item of pkt.isi) {
      session.stok[item.produk] -= (item.jumlah * qty);
    }

    // Masukkan paket ke keranjang
    const existing = session.keranjang.find((k) => k.nama === pkt.nama);
    if (existing) {
      existing.jumlah += qty;
      existing.subtotal = existing.jumlah * existing.harga_satuan;
    } else {
      session.keranjang.push({
        nama: pkt.nama,
        jumlah: qty,
        sebutan: pkt.sebutan,
        harga_satuan: pkt.harga,
        subtotal: pkt.harga * qty
      });
    }

    const totalHargaKeranjang = session.keranjang.reduce((sum, item) => sum + item.subtotal, 0);

    return {
      status: 'sukses',
      pesan: `Berhasil menambahkan ${qty} ${pkt.sebutan} ${pkt.nama} ke keranjang belanja.`,
      item_ditambahkan: {
        nama: pkt.nama,
        jumlah: qty,
        sebutan: pkt.sebutan,
        subtotal: pkt.harga * qty
      },
      total_pembayaran_sementara: totalHargaKeranjang
    };
  }

  return { status: 'gagal', pesan: `Kue atau paket "${nama}" tidak ditemukan di katalog.` };
}

/**
 * 7. hapusDariKeranjang(session, { nama }):
 * Mengembalikan stok aktif sesi dan menghapus kue dari keranjang.
 */
export function hapusDariKeranjang(session, { nama } = {}) {
  if (!session || !Array.isArray(session.keranjang)) {
    return { status: 'gagal', pesan: 'Keranjang belanja masih kosong.' };
  }

  const namaQuery = normalizeText(nama);
  const index = session.keranjang.findIndex((item) => normalizeText(item.nama) === namaQuery || normalizeText(item.nama).includes(namaQuery));

  if (index === -1) {
    return { status: 'gagal', pesan: `Item "${nama}" tidak ditemukan di keranjang belanja.` };
  }

  const itemDihapus = session.keranjang[index];
  session.stok = session.stok || inisialisasiStok();

  // Kembalikan stok
  const pkt = katalog.paket.find((p) => p.nama === itemDihapus.nama);
  if (pkt) {
    for (const bahan of pkt.isi) {
      session.stok[bahan.produk] = (session.stok[bahan.produk] ?? 0) + (bahan.jumlah * itemDihapus.jumlah);
    }
  } else {
    session.stok[itemDihapus.nama] = (session.stok[itemDihapus.nama] ?? 0) + itemDihapus.jumlah;
  }

  session.keranjang.splice(index, 1);

  return {
    status: 'sukses',
    pesan: `Berhasil menghapus ${itemDihapus.nama} (${itemDihapus.jumlah} ${itemDihapus.sebutan}) dari keranjang.`,
    isi_keranjang: session.keranjang,
    total_harga: session.keranjang.reduce((sum, item) => sum + item.subtotal, 0)
  };
}

/**
 * 8. lihatKeranjang(session):
 * Menampilkan rincian isi keranjang belanja pelanggan, subtotal, dan total harga.
 */
export function lihatKeranjang(session) {
  if (!session || !Array.isArray(session.keranjang) || session.keranjang.length === 0) {
    return {
      status: 'sukses',
      keranjang: [],
      total_item: 0,
      total_harga: 0,
      pesan: 'Keranjang belanja Anda saat ini masih kosong.'
    };
  }

  const total_harga = session.keranjang.reduce((sum, item) => sum + item.subtotal, 0);
  const total_item = session.keranjang.reduce((sum, item) => sum + item.jumlah, 0);

  return {
    status: 'sukses',
    keranjang: session.keranjang.map((i) => ({
      nama: i.nama,
      jumlah: i.jumlah,
      sebutan: i.sebutan,
      harga_satuan: i.harga_satuan,
      subtotal: i.subtotal
    })),
    total_item,
    total_harga
  };
}

/**
 * 9. ringkasPesanan(session):
 * Merangkum pesanan sebelum dikonfirmasi pelanggan.
 */
export function ringkasPesanan(session) {
  const info = lihatKeranjang(session);
  if (info.keranjang.length === 0) {
    return {
      status: 'kosong',
      pesan: 'Keranjang belanja masih kosong, silakan pilih kue terlebih dahulu sebelum membuat ringkasan pesanan.'
    };
  }

  return {
    status: 'siap_konfirmasi',
    rincian_pesanan: info.keranjang,
    total_item: info.total_item,
    total_harga: info.total_harga,
    instruksi: 'Tampilkan rincian pesanan dan total harga di atas dengan ramah kepada pelanggan, lalu minta konfirmasi apakah pelanggan ingin langsung mengirim pesanan ke kasir.'
  };
}

/**
 * 10. kirimKeKasir(session):
 * Mengonfirmasi pesanan, membuat nomor pesanan (format KMA-XXXX), dan mengosongkan keranjang untuk pesanan baru.
 */
export function kirimKeKasir(session) {
  if (!session || !Array.isArray(session.keranjang) || session.keranjang.length === 0) {
    return {
      status: 'gagal',
      pesan: 'Tidak dapat mengirim pesanan ke kasir karena keranjang belanja masih kosong.'
    };
  }

  const nomorPesanan = `KMA-${Math.floor(1000 + Math.random() * 9000)}`;
  const pesananFinal = session.keranjang.map((item) => ({ ...item }));
  const totalPembayaran = pesananFinal.reduce((sum, item) => sum + item.subtotal, 0);

  // Kosongkan keranjang untuk pesanan baru
  session.keranjang = [];

  return {
    status: 'sukses',
    nomor_pesanan: nomorPesanan,
    total_pembayaran: totalPembayaran,
    rincian_pesanan: pesananFinal,
    pesan: `Pesanan berhasil dikonfirmasi dan dikirim ke kasir dengan nomor pesanan ${nomorPesanan}. Total pembayaran: Rp${totalPembayaran.toLocaleString('id-ID')}. Silakan tunjukkan nomor pesanan ini ke kasir untuk proses pembayaran.`
  };
}

