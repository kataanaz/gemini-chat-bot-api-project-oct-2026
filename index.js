import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import * as tools from './tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const PRIMARY_MODEL = 'gemini-3.5-flash-lite';
const FALLBACK_MODEL = 'gemini-2.5-flash';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Penyimpanan sesi di memori server (session-based cart & stock)
const sessions = new Map();

function getOrCreateSession(sessionId) {
  const id = sessionId || 'default-session';
  if (!sessions.has(id)) {
    sessions.set(id, {
      id,
      stok: tools.inisialisasiStok(),
      keranjang: []
    });
  }
  return sessions.get(id);
}

// System Instruction Persona Toko Kue Mas Aniz
const SYSTEM_INSTRUCTION = `
Anda adalah asisten pelayan on-site toko "Kue Mas Aniz".
Tugas utama Anda adalah menyapa pelanggan, membantu memilih kue, mengecek stok, menjelaskan informasi alergen, mengelola keranjang belanja pelanggan, dan membantu proses konfirmasi ke kasir.

PANDUAN & ATURAN BERKOMUNIKASI:
1. Panggil pelanggan dengan sapaan hangat "kak".
2. Gaya bicara santai, ramah, sopan, dan hangat layaknya pelayan toko kue yang sigap melayani.
3. Maksimal 1 emoji per pesan agar tetap rapi dan profesional.
4. DILARANG KERAS menyebut kata "pcs". Selalu gunakan kolom 'sebutan' dari produk/paket (seperti: potong, bungkus, buah, atau paket).
5. Hanya bahas seputar menu kue, paket, stok, alergen, harga, dan pesanan toko Kue Mas Aniz. Tolak topik di luar kue (seperti cuaca, politik, coding, dll) dengan sopan dan arahkan kembali ke kue toko Mas Aniz.
6. JANGAN PERNAH membocorkan resep atau komposisi rahasia toko kepada pelanggan.
7. JANGAN PERNAH memberikan diskon. Jika pelanggan menawar atau meminta diskon, jawab dengan halus bahwa diskon diadakan pada hari acak dan kebetulan hari ini belum ada promo/diskon.
8. Semua informasi harga, stok, ketersediaan, isi keranjang, dan total pesanan WAJIB berasal dari hasil pemanggilan function/tools. DILARANG KERAS mengarang, berhalusinasi, atau menebak angka.
9. Sebelum mengirim pesanan ke kasir (kirim_ke_kasir), Anda WAJIB memanggil ringkas_pesanan dan menampilkan rincian pesanan untuk meminta konfirmasi akhir dari pelanggan.
`;

// Deklarasi Tools Gemini
const toolsDeclarations = [
  {
    name: 'cari_produk',
    description: 'Mencari daftar kue dan paket di katalog Toko Kue Mas Aniz berdasarkan kata kunci nama/bahan, kategori (cake, donat, roti, kue tradisional, asin, paket), atau batas harga maksimum.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        kata_kunci: { type: Type.STRING, description: 'Kata kunci pencarian nama atau bahan kue (misal: cokelat, keju, pandan, donat).' },
        kategori: { type: Type.STRING, description: 'Kategori kue: cake, donat, roti, kue tradisional, asin, paket.' },
        maks_harga: { type: Type.NUMBER, description: 'Batas harga maksimal dalam rupiah.' }
      }
    }
  },
  {
    name: 'cek_stok',
    description: 'Mengecek ketersediaan stok kue atau paket tertentu saat ini di toko.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nama: { type: Type.STRING, description: 'Nama kue atau paket yang ingin dicek stoknya.' }
      },
      required: ['nama']
    }
  },
  {
    name: 'info_alergen',
    description: 'Melihat informasi kandungan alergen resmi pada kue atau paket tertentu.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nama: { type: Type.STRING, description: 'Nama kue atau paket.' }
      },
      required: ['nama']
    }
  },
  {
    name: 'daftar_terlaris',
    description: 'Menampilkan daftar kue terlaris (best seller) di toko Kue Mas Aniz.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'tambah_ke_keranjang',
    description: 'Menambahkan kue atau paket ke keranjang belanja pelanggan dan memotong stok aktif sesi pelanggan.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nama: { type: Type.STRING, description: 'Nama kue atau paket yang ingin dibeli.' },
        jumlah: { type: Type.INTEGER, description: 'Jumlah yang ingin dipesan (angka bulat antara 1 sampai 20).' }
      },
      required: ['nama', 'jumlah']
    }
  },
  {
    name: 'hapus_dari_keranjang',
    description: 'Menghapus kue atau paket dari keranjang belanja pelanggan dan mengembalikan stoknya ke toko.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nama: { type: Type.STRING, description: 'Nama kue atau paket yang ingin dihapus dari keranjang.' }
      },
      required: ['nama']
    }
  },
  {
    name: 'lihat_keranjang',
    description: 'Melihat seluruh isi keranjang belanja pelanggan saat ini beserta subtotal dan total harga.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'ringkas_pesanan',
    description: 'Merangkum rincian seluruh pesanan di keranjang belanja sebelum dikonfirmasi oleh pelanggan untuk diteruskan ke kasir.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'kirim_ke_kasir',
    description: 'Mengonfirmasi pesanan final pelanggan, meneruskan pesanan ke kasir, membuat nomor pesanan (format KMA-XXXX), dan mengosongkan keranjang belanja.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  }
];

// Whitelist fungsi murni tanpa eval() / exec()
const functionWhitelist = {
  cari_produk: (args) => tools.cariProduk(args),
  cek_stok: (args, session) => tools.cekStok(session, args),
  info_alergen: (args) => tools.infoAlergen(args),
  daftar_terlaris: () => tools.daftarTerlaris(),
  tambah_ke_keranjang: (args, session) => tools.tambahKeKeranjang(session, args),
  hapus_dari_keranjang: (args, session) => tools.hapusDariKeranjang(session, args),
  lihat_keranjang: (args, session) => tools.lihatKeranjang(session),
  ringkas_pesanan: (args, session) => tools.ringkasPesanan(session),
  kirim_ke_kasir: (args, session) => tools.kirimKeKasir(session)
};

// Endpoint Chat dengan Tool Calling Loop
app.post('/api/chat', async (req, res) => {
  const { conversation, sessionId } = req.body;

  try {
    if (!Array.isArray(conversation) || conversation.length === 0) {
      return res.status(400).json({ error: 'Conversation must be a non-empty array' });
    }

    const lastMessage = conversation[conversation.length - 1];
    if (lastMessage.role === 'user' && typeof lastMessage.text === 'string') {
      if (lastMessage.text.length > 500) {
        return res.status(400).json({
          error: 'Pesan pelanggan terlalu panjang (maksimal 500 karakter). Silakan persingkat pertanyaan Anda, kak.'
        });
      }
    }

    const session = getOrCreateSession(sessionId);

    // Siapkan struktur contents untuk model Gemini
    const contents = conversation.map(({ role, text }) => ({
      role,
      parts: [{ text }]
    }));

    const config = {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ functionDeclarations: toolsDeclarations }]
    };

    let targetModel = PRIMARY_MODEL;
    let loopCount = 0;
    const MAX_LOOPS = 5;

    while (loopCount < MAX_LOOPS) {
      loopCount++;

      let response;
      try {
        response = await ai.models.generateContent({
          model: targetModel,
          contents,
          config
        });
      } catch (modelError) {
        console.warn(`Model ${targetModel} error: ${modelError.message}. Trying fallback ${FALLBACK_MODEL}...`);
        targetModel = FALLBACK_MODEL;
        response = await ai.models.generateContent({
          model: targetModel,
          contents,
          config
        });
      }

      const functionCalls = response.functionCalls;

      // Jika model tidak memanggil function, berarti respon akhir berupa teks sudah siap
      if (!functionCalls || functionCalls.length === 0) {
        return res.status(200).json({ result: response.text });
      }

      // Model meminta eksekusi function: tambahkan parts model ke riwayat contents
      const modelParts = response.candidates?.[0]?.content?.parts || [];
      contents.push({
        role: 'model',
        parts: modelParts
      });

      // Jalankan fungsi dari whitelist lokal
      const functionResponseParts = [];
      for (const call of functionCalls) {
        const { name, args, id } = call;
        const fn = functionWhitelist[name];

        let fnResult;
        if (fn) {
          try {
            fnResult = await fn(args || {}, session);
          } catch (fnErr) {
            console.error(`Error executing ${name}:`, fnErr);
            fnResult = { error: `Terjadi kendala saat menjalankan fungsi ${name}: ${fnErr.message}` };
          }
        } else {
          fnResult = { error: `Fungsi '${name}' tidak terdaftar dalam whitelist sistem.` };
        }

        functionResponseParts.push({
          functionResponse: {
            name,
            id,
            response: { output: fnResult }
          }
        });
      }

      // Kembalikan hasil fungsi ke model sebagai input bagian 'user'
      contents.push({
        role: 'user',
        parts: functionResponseParts
      });
    }

    // Jika melebihi loop batas
    res.status(200).json({
      result: 'Maaf kak, proses pencarian membutuhkan waktu lebih lama. Ada yang bisa saya bantu lagi?'
    });
  } catch (e) {
    console.error('Chat endpoint error:', e);
    res.status(500).json({ error: e.message || 'Terjadi kesalahan pada server.' });
  }
});

// Endpoint Reset Sesi & Keranjang
app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body || {};
  const id = sessionId || 'default-session';

  sessions.set(id, {
    id,
    stok: tools.inisialisasiStok(),
    keranjang: []
  });

  res.status(200).json({
    status: 'sukses',
    message: 'Sesi percakapan dan keranjang belanja berhasil direset.'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Toko Kue Mas Aniz siap di http://localhost:${PORT}`));
