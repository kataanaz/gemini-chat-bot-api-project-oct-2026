const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const chatBox = document.getElementById('chat-box');
const resetBtn = document.getElementById('reset-btn');

// Inisialisasi atau ambil sessionId unik dari sessionStorage
let sessionId = sessionStorage.getItem('kma_session_id');
if (!sessionId) {
  sessionId = 'sess-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();
  sessionStorage.setItem('kma_session_id', sessionId);
}

// Riwayat percakapan untuk dikirimkan ke model Gemini
let conversationHistory = [];

const INITIAL_GREETING_HTML = `
  <p>Halo kak! Selamat datang di <strong>Toko Kue Mas Aniz</strong> 🧁</p>
  <p>Saya asisten pelayan toko yang siap bantu kakak memilih kue terlaris, cek stok & alergen, atau langsung mencatat pesanan kakak. Mau coba kue manis atau gurih hari ini kak?</p>
`;

/**
 * Menambahkan pesan ke chat box
 */
function appendMessage(sender, content, isHtml = false) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('message-wrapper', sender);

  const messageElement = document.createElement('div');
  messageElement.classList.add('message', sender);

  if (isHtml) {
    messageElement.innerHTML = content;
  } else {
    messageElement.textContent = content;
  }

  wrapper.appendChild(messageElement);
  chatBox.appendChild(wrapper);
  chatBox.scrollTop = chatBox.scrollHeight;

  return messageElement;
}

/**
 * Parsing Markdown ke HTML menggunakan marked.js
 */
function renderMarkdown(text) {
  if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
    return marked.parse(text);
  }
  return text.replace(/\n/g, '<br>');
}

// Template animasi bouncing dots
const TYPING_INDICATOR_HTML = `
  <div class="typing-indicator" aria-label="Pelayan sedang menyiapkan jawaban...">
    <span></span>
    <span></span>
    <span></span>
  </div>
`;

// Event submit form chat
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const messageText = userInput.value.trim();
  if (!messageText) return;

  // Validasi batas maksimal 500 karakter di sisi client
  if (messageText.length > 500) {
    alert('Pesan terlalu panjang kak (maksimal 500 karakter). Silakan persingkat pertanyaan Anda.');
    return;
  }

  // 1. Tampilkan pesan user ke chat box & bersihkan input
  appendMessage('user', messageText, false);
  userInput.value = '';

  // Nonaktifkan form saat menunggu respons
  const submitButton = chatForm.querySelector('button[type="submit"]');
  userInput.disabled = true;
  if (submitButton) submitButton.disabled = true;

  // 2. Tampilkan animasi loading
  const botMessageElement = appendMessage('bot', TYPING_INDICATOR_HTML, true);

  // Simpan giliran pesan user
  conversationHistory.push({ role: 'user', text: messageText });

  try {
    // 3. Kirim request ke backend dengan conversation dan sessionId
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation: conversationHistory,
        sessionId: sessionId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Server status: ${response.status}`);
    }

    // 4. Ganti animasi loading dengan respons AI
    if (data && data.result) {
      botMessageElement.innerHTML = renderMarkdown(data.result);
      conversationHistory.push({ role: 'model', text: data.result });
    } else {
      botMessageElement.textContent = 'Maaf kak, belum ada respon yang diterima.';
      conversationHistory.pop();
    }
  } catch (error) {
    console.error('Chat error:', error);
    botMessageElement.textContent = error.message || 'Maaf kak, gagal terhubung ke server toko.';
    conversationHistory.pop();
  } finally {
    // Aktifkan kembali input form
    userInput.disabled = false;
    if (submitButton) submitButton.disabled = false;
    userInput.focus();
    chatBox.scrollTop = chatBox.scrollHeight;
  }
});

// Event tombol Mulai Ulang / Pesanan Baru
if (resetBtn) {
  resetBtn.addEventListener('click', async () => {
    const confirmReset = confirm('Apakah kakak ingin mengulang percakapan dan mengosongkan keranjang belanja?');
    if (!confirmReset) return;

    try {
      await fetch('/api/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId }),
      });
    } catch (err) {
      console.warn('Gagal mereset sesi di server:', err);
    }

    // Reset riwayat lokal & chat box
    conversationHistory = [];
    chatBox.innerHTML = '';
    appendMessage('bot', INITIAL_GREETING_HTML, true);
    userInput.value = '';
    userInput.focus();
  });
}
