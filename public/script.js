const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const chatBox = document.getElementById('chat-box');

// Maintains multi-turn conversation history with Gemini roles ('user' and 'model')
const conversationHistory = [];

/**
 * Appends a message to the chat box.
 * @param {'user' | 'bot'} sender - Message sender type
 * @param {string} content - Message text or HTML
 * @param {boolean} isHtml - Whether content should be rendered as HTML
 * @returns {HTMLDivElement} The message bubble element
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
 * Parses markdown to HTML using marked.js if available, with plain text fallback.
 * @param {string} text - Raw markdown text
 * @returns {string} Formatted HTML
 */
function renderMarkdown(text) {
  if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
    return marked.parse(text);
  }
  // Fallback simple line-break conversion if marked is not loaded
  return text.replace(/\n/g, '<br>');
}

// Typing loading animation template
const TYPING_INDICATOR_HTML = `
  <div class="typing-indicator" aria-label="Sedang mengetik...">
    <span></span>
    <span></span>
    <span></span>
  </div>
`;

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const messageText = userInput.value.trim();
  if (!messageText) return;

  // 1. Tambahkan pesan user ke chat box & reset input
  appendMessage('user', messageText, false);
  userInput.value = '';

  // Nonaktifkan form saat menunggu balasan AI
  const submitButton = chatForm.querySelector('button[type="submit"]');
  userInput.disabled = true;
  if (submitButton) submitButton.disabled = true;

  // 2. Tampilkan animasi loading indikator untuk bot
  const botMessageElement = appendMessage('bot', TYPING_INDICATOR_HTML, true);

  // Simpan riwayat percakapan
  conversationHistory.push({ role: 'user', text: messageText });

  try {
    // 3. Kirim POST request ke /api/chat
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation: conversationHistory,
      }),
    });

    if (!response.ok) {
      throw new Error(`Server returned status: ${response.status}`);
    }

    const data = await response.json();

    // 4. Ganti animasi loading dengan respon AI yang diformat dari Markdown ke HTML
    if (data && data.result) {
      botMessageElement.innerHTML = renderMarkdown(data.result);
      conversationHistory.push({ role: 'model', text: data.result });
    } else {
      botMessageElement.textContent = 'Sorry, no response received.';
      conversationHistory.pop(); // Hapus pesan user yang tidak terjawab dari riwayat
    }
  } catch (error) {
    console.error('Chat error:', error);
    // 5. Penanganan error jika server bermasalah / gagal terhubung
    botMessageElement.textContent = 'Failed to get response from server.';
    conversationHistory.pop(); // Hapus pesan user yang tidak terjawab dari riwayat
  } finally {
    // Aktifkan kembali input form dan scroll ke bawah
    userInput.disabled = false;
    if (submitButton) submitButton.disabled = false;
    userInput.focus();
    chatBox.scrollTop = chatBox.scrollHeight;
  }
});
