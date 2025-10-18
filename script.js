// Handle file upload
document.getElementById("fileInput").addEventListener("change", handleFileUpload);

let currentJsonFileName = null;
let currentJsonFileSize = null;
let currentJsonFileModified = null;
const CHUNK_SIZE = 50;
let renderedMessages = new Map();
let observer = null;

// Storage wrapper: namespace keys and fallback to cookies if localStorage unavailable
const STORAGE_PREFIX = 'fmjv_' + (window.location.hostname || 'local') + '_';

function setCookie(name, value, days = 365) {
    try {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/';
    } catch(e) {}
}

function getCookie(name) {
    try {
        const cookies = document.cookie ? document.cookie.split('; ') : [];
        for (let c of cookies) {
            const [k,v] = c.split('=');
            if (decodeURIComponent(k) === name) return decodeURIComponent(v || '');
        }
    } catch(e) {}
    return null;
}

function storageSet(key, value) {
    const k = STORAGE_PREFIX + key;
    try { localStorage.setItem(k, String(value)); return; } catch(e) {}
    try { setCookie(k, String(value)); } catch(e) {}
}

function storageGet(key) {
    const k = STORAGE_PREFIX + key;
    try { const v = localStorage.getItem(k); if (v !== null) return v; } catch(e) {}
    try { const v = getCookie(k); if (v !== null) return v; } catch(e) {}
    return null;
}

function storageRemove(key) {
    const k = STORAGE_PREFIX + key;
    try { localStorage.removeItem(k); } catch(e) {}
    try { setCookie(k, '', -1); } catch(e) {}
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // If a different file (by name, size or modified time) is selected, clear previous search index.
    // Do NOT clear uploaded media here so a single uploaded media folder can be reused across multiple JSON files.
    if (currentJsonFileName && (currentJsonFileName !== file.name || currentJsonFileSize !== file.size || currentJsonFileModified !== file.lastModified)) {
        try { __searchIndex = null; } catch(e){}
        try { if (searchInput) searchInput.value = ''; } catch(e){}
        try { if (searchResultsEl) searchResultsEl.innerHTML = ''; } catch(e){}
        try {
            if (searchProgress) {
                searchProgress.querySelector('.fill').style.width = '0%';
                searchProgress.querySelector('.progress-text').innerText = 'Idle';
                searchProgress.style.display = 'none';
            }
        } catch(e){}
    }

    currentJsonFileName = file.name;
    currentJsonFileSize = file.size;
    currentJsonFileModified = file.lastModified;

    const options = document.getElementsByClassName("options")[0];
    const loading = document.getElementById("loading");
    const chatContainer = document.getElementById("chat");

    options.style.display = "block";
    loading.innerHTML = "Loading...";
    loading.style.display = "flex";
    chatContainer.scrollTop = 0;
    chatContainer.innerHTML = "";

    const reader = new FileReader();
    reader.onload = (e) => processFileContent(e.target.result);
    reader.readAsText(file, 'utf-8');
}

function processFileContent(content) {
    try {
        let data;
        const isThreadPathFormat = content.includes('"thread_path"');

        if (isThreadPathFormat) {
            const replaced = content.replace(/\\u00([a-f0-9]{2})|\\u([a-f0-9]{4})/gi, (match, p1, p2) => {
                const code = p1 ? parseInt(p1, 16) : parseInt(p2, 16);
                return String.fromCharCode(code);
            });
            const decoded = decodeURIComponent(escape(replaced));
            data = JSON.parse(decoded);
            data.messages = data.messages.reverse();
        } else {
            data = JSON.parse(content);
        }
        setupChatInterface(data);
    } catch (error) {
        alert("Invalid JSON file!");
    }
}

function setupChatInterface(data) {
    window.currentChatData = data;
    // reset search index for new chat
    __searchIndex = null;

    const participants = data.participants.map(p => (typeof p === 'string' ? p : p.name));
    const threadName = data.threadName || data.title || data.threadPath || "Untitled";

    document.getElementById("threadName").innerText = threadName;
    setupRadioButtons(participants);

    // after building radios, determine selected
    let selectedValue = (document.querySelector('input[name="choice"]:checked') || {}).value;

    setupCheckboxListeners();
    // render using the selected perspective
    renderMessages(data, selectedValue);
}

function setupRadioButtons(participants) {
    const radioForm = document.getElementById("radioForm");
    radioForm.innerHTML = "";
    const saved = (storageGet('selectedPerspective') || null);
    participants.forEach((participant, index) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        
        input.type = "radio";
        input.name = "choice";
        input.id = `option${index + 1}`;
        input.value = participant;
        // restore saved selection if it matches, otherwise keep default on first
        if (saved && saved === participant) input.checked = true;
        else if (!saved && index === 0) input.checked = true;

        // when changed, persist and re-render using current chat data (if present)
        input.addEventListener('change', () => {
            try { storageSet('selectedPerspective', input.value); } catch(e){}
            if (window.currentChatData) renderMessages(window.currentChatData, input.value);
        });

        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${participant}`));
        
        radioForm.appendChild(label);
    });
}

function setupCheckboxListeners() {
    const checkboxConfig = [
        { id: "showTime", class: ".timestamp" },
        { id: "showMyName", class: ".from-me .sender-name" },
        { id: "showTheirName", class: ".from-them .sender-name" },
        { id: "showReacts", class: ".reaction" }
    ];

    checkboxConfig.forEach(({ id, class: className }) => {
        const input = document.getElementById(id);
        if (!input) return;
        // restore saved state
        try {
            const saved = storageGet('ui_' + id);
            if (saved !== null) {
                input.checked = saved === '1';
            }
        } catch(e) {}

        // listener to apply and persist
        input.addEventListener("change", function() {
            const elements = document.querySelectorAll(className);
            elements.forEach(el => el.style.display = this.checked ? "block" : "none");
            try { storageSet('ui_' + id, this.checked ? '1' : '0'); } catch(e){}
        });

        // trigger change once to apply initial visibility
        input.dispatchEvent(new Event('change'));
    });
}

function renderMessages(data, selectedValue) {
    const chatContainer = document.getElementById("chat");
    const loading = document.getElementById("loading");
    
    chatContainer.style.display = "none";
    loading.innerHTML = "Loading messages...";
    loading.style.display = "flex";
    
    if (observer) {
        observer.disconnect();
    }
    
    renderedMessages.clear();
    chatContainer.innerHTML = "";
    
    if (!data.messages.length) {
        loading.innerHTML = "No messages";
        chatContainer.style.display = "block";
        return;
    }

    const messageChunks = chunkArray(data.messages, CHUNK_SIZE);
    
    messageChunks.forEach((chunk, index) => {
        const chunkContainer = document.createElement("div");
        chunkContainer.classList.add("message-chunk");
        chunkContainer.dataset.chunkIndex = index;
        chatContainer.appendChild(chunkContainer);
    });

    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const chunkIndex = parseInt(entry.target.dataset.chunkIndex);
                renderChunk(chunkIndex, messageChunks[chunkIndex], selectedValue);
            }
        });
    }, {
        root: chatContainer,
        threshold: 0.1,
        rootMargin: "200px"
    });

    document.querySelectorAll(".message-chunk").forEach(chunk => {
        observer.observe(chunk);
    });

    setTimeout(() => {
        loading.style.display = "none";
        chatContainer.style.display = "block";
    }, 100);
}

// Media handling
let mediaFiles = {};
let mediaTypes = {};
const mediaFolderInput = document.getElementById("mediaFolder");

mediaFolderInput.addEventListener("change", function(event) {
    const files = event.target.files;
    if (!files.length) {
        return;
    }

    const chatContainer = document.getElementById("chat");
    const loading = document.getElementById("loading");
    chatContainer.style.display = "none";
    loading.innerHTML = "Processing media...";
    loading.style.display = "flex";

    processMediaFiles(files).then(() => {
        if (window.currentChatData) {
            renderMessages(window.currentChatData, 
                document.querySelector('input[name="choice"]:checked').value);
            loading.style.display = "none";
            chatContainer.style.display = "block";
        }
    });
});

async function processMediaFiles(files) {
    const BATCH_SIZE = 20;
    const fileArray = Array.from(files);
    
    resetMedia();
    
    for (let i = 0; i < fileArray.length; i += BATCH_SIZE) {
        const batch = fileArray.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(file => {
            return new Promise(resolve => {
                const fileURL = URL.createObjectURL(file);
                const relativePath = file.webkitRelativePath || file.name; // Preserve folder structure if available
                mediaFiles[relativePath] = fileURL;
                mediaTypes[relativePath] = getMediaType(file.name);
                resolve();
            });
        }));
    }
    console.log("Media files processed:", Object.keys(mediaFiles));
}

function resetMedia() {
    Object.values(mediaFiles).forEach(url => URL.revokeObjectURL(url));
    mediaFiles = {};
    mediaTypes = {};
}

function getMediaType(filename) {
    const extension = filename.split('.').pop().toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(extension)) return "image";
    if (["mp4", "webm", "ogg"].includes(extension)) return "video";
    if (["mp3", "wav", "aac", "ogg"].includes(extension)) return "audio";
    return "unknown";
}

// Highlight helpers: diacritic-insensitive matching by building a normalized mapping
function buildNormalizedMap(original) {
    const mapping = []; // mapping[normalizedPos] = originalIndex
    let normalized = '';
    for (let i = 0; i < original.length; i++) {
        const ch = original[i];
        const n = ch.normalize('NFD').replace(/\p{Diacritic}/gu, '');
        for (let k = 0; k < n.length; k++) {
            mapping.push(i);
            normalized += n[k];
        }
    }
    return { normalized: normalized.toLowerCase(), mapping };
}

function findRangesForToken(original, tokenNorm) {
    const { normalized, mapping } = buildNormalizedMap(original);
    const token = tokenNorm;
    const ranges = [];
    let start = 0;
    while (true) {
        const idx = normalized.indexOf(token, start);
        if (idx === -1) break;
        const origStart = mapping[idx];
        const origEnd = mapping[idx + token.length - 1] + 1; // exclusive
        ranges.push([origStart, origEnd]);
        start = idx + token.length;
    }
    return ranges;
}

function mergeRanges(ranges) {
    if (!ranges.length) return [];
    ranges.sort((a,b)=>a[0]-b[0]);
    const out = [ranges[0].slice()];
    for (let i = 1; i < ranges.length; i++) {
        const cur = ranges[i];
        const last = out[out.length-1];
        if (cur[0] <= last[1]) {
            last[1] = Math.max(last[1], cur[1]);
        } else out.push(cur.slice());
    }
    return out;
}

function highlightText(original, query) {
    if (!query || !original) return escapeHtml(original);
    const qNorm = normalizeForSearch(query);
    const tokens = qNorm.split(' ').filter(Boolean);
    if (!tokens.length) return escapeHtml(original);

    let allRanges = [];
    for (const t of tokens) {
        const ranges = findRangesForToken(original, t);
        allRanges = allRanges.concat(ranges);
    }
    if (!allRanges.length) return escapeHtml(original);
    const merged = mergeRanges(allRanges);
    // build HTML with <strong>
    let out = '';
    let lastIdx = 0;
    for (const [s,e] of merged) {
        out += escapeHtml(original.slice(lastIdx, s));
        out += '<strong>' + escapeHtml(original.slice(s, e)) + '</strong>';
        lastIdx = e;
    }
    out += escapeHtml(original.slice(lastIdx));
    return out;
}

function createMessageHTML(msg, highlightQuery) {
    const sender = msg.senderName || msg.sender_name || "Unknown";
    const rawText = msg.text || msg.content || "";
    const text = highlightQuery ? highlightText(String(rawText), highlightQuery) : escapeHtml(String(rawText));
    const timestamp = msg.timestamp || msg.timestamp_ms || 0;
    // Combine all possible media arrays
    const mediaItems = [].concat(
        msg.media || [],
        msg.photos || [],
        msg.videos || [],
        msg.audio || [],
        msg.audio_files || [], // Add support for audio_files
        msg.gifs || []
    );

    return `
        <div class="sender-name">${escapeHtml(sender)}</div>
        <div class="message-content">
            ${text}
            ${mediaItems.map(media => {
                const fileName = media.uri.split(/[\\\/]/).pop().toLowerCase(); // Normalize to lowercase
                const matchingFile = Object.keys(mediaFiles).find(f => f.toLowerCase().endsWith(fileName));
                const fileURL = matchingFile ? mediaFiles[matchingFile] : null;
                // Determine media type based on file extension, overriding JSON context if needed
                const extension = fileName.split('.').pop().toLowerCase();
                const mediaType = extension === "mp4" ? "video" : (matchingFile ? mediaTypes[matchingFile] : getMediaType(fileName));

                if (mediaType === "image") {
                    return fileURL 
                        ? `<a href="${fileURL}" target="_blank" class="media-preview"><img src="${fileURL}" alt="Image" class="preview"></a>`
                        : `[ Image not found ]`;
                } else if (mediaType === "video") {
                    return fileURL
                        ? `<a href="${fileURL}" target="_blank" class="media-preview"><video controls class="preview-video"><source src="${fileURL}" type="video/mp4"></video></a>`
                        : `[ Video not found ]`;
                } else if (mediaType === "audio") {
                    return fileURL
                        ? `<audio controls><source src="${fileURL}" type="audio/mpeg"></audio>`
                        : `[ Audio not found ]`;
                }
                return `[ Media not found ]`;
            }).join("")}
            ${msg.reactions?.length ? `<div class="reaction">${msg.reactions.map(r => `${escapeHtml(r.actor)}: ${escapeHtml(r.reaction)}`).join(", ")}</div>` : ""}
            <div class="timestamp">${new Date(timestamp).toLocaleString()}</div>
        </div>
    `;
}

function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

window.addEventListener("beforeunload", () => {
    if (observer) observer.disconnect();
    Object.values(mediaFiles).forEach(url => URL.revokeObjectURL(url));
    renderedMessages.clear();
});

// ------------------ Search implementation ------------------
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchResultsEl = document.getElementById('searchResults');
const searchProgress = document.getElementById('searchProgress');

// hide results by default until an explicit search runs
if (searchResultsEl) searchResultsEl.style.display = 'none';

// Small utility: normalize strings (lowercase, remove diacritics, collapse whitespace)
function normalizeForSearch(str) {
    if (!str) return '';
    // Unicode normalize and remove diacritics
    const normalized = str.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return normalized.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Build a lightweight search index when messages are loaded
function buildSearchIndex(messages) {
    // index: array of { text, normalized, sender, timestamp, idx }
    const idx = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const parts = [];
        if (m.text) parts.push(typeof m.text === 'string' ? m.text : (m.content || ''));
        if (m.content) parts.push(m.content);
        if (m.senderName) parts.push(m.senderName);
        // include reactions summary
        if (m.reactions && m.reactions.length) parts.push(m.reactions.map(r => r.reaction + ' ' + (r.actor||'')).join(' '));
        // include media filenames
        const mediaItems = [].concat(m.media || [], m.photos || [], m.videos || [], m.audio || [], m.audio_files || [], m.gifs || []);
        mediaItems.forEach(mi => { if (mi && mi.uri) parts.push(mi.uri); });

        const text = parts.join(' ');
        idx.push({ text, normalized: normalizeForSearch(text), sender: m.senderName || m.sender_name || 'Unknown', timestamp: m.timestamp || m.timestamp_ms || 0, idx: i });
    }
    return idx;
}

// Simple fuzzy scoring: combination of substring match, token overlap, and Levenshtein distance on small strings
function fuzzyScore(query, target) {
    if (!query || !target) return 0;
    if (target.includes(query)) return 100 + Math.min(50, query.length); // strong boost for substring

    // token overlap
    const qTokens = query.split(' ');
    const tTokens = target.split(' ');
    let overlap = 0;
    for (const qt of qTokens) {
        for (const tt of tTokens) {
            if (tt.includes(qt) || qt.includes(tt)) { overlap += 1; break; }
        }
    }
    const tokenScore = overlap * 10;

    // small Levenshtein distance for short tokens (cheap implementation)
    function lev(a,b){
        const m=a.length,n=b.length; if(m*n===0) return m+n; const dp = Array(m+1).fill(0).map(()=>Array(n+1).fill(0));
        for(let i=0;i<=m;i++) dp[i][0]=i; for(let j=0;j<=n;j++) dp[0][j]=j;
        for(let i=1;i<=m;i++) for(let j=1;j<=n;j++) dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+1);
        return dp[m][n];
    }

    const shortQuery = query.length > 30 ? query.slice(0,30) : query;
    const dist = lev(shortQuery, target.slice(0, shortQuery.length+10));
    const distScore = Math.max(0, 30 - dist);

    return tokenScore + distScore;
}

// Asynchronous batched search to keep UI responsive and report progress
async function performSearch(query, index, onProgress) {
    const results = [];
    const normalizedQuery = normalizeForSearch(query);
    if (!normalizedQuery) return results;

    const BATCH = 500; // tuned for responsiveness
    for (let i = 0; i < index.length; i += BATCH) {
        const batch = index.slice(i, i + BATCH);
        for (const item of batch) {
            const score = fuzzyScore(normalizedQuery, item.normalized);
            if (score > 0) results.push({ score, item });
        }
        if (onProgress) onProgress(Math.min(100, Math.round(((i + BATCH) / index.length) * 100)));
        // yield to UI
        await new Promise(r => setTimeout(r, 0));
    }
    results.sort((a,b) => b.score - a.score);
    return results;
}

// Global search index
let __searchIndex = null;

// Hook up search actions
searchBtn?.addEventListener('click', startSearch);
searchInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') startSearch(); });
const clearSearchBtn = document.getElementById('clearSearchBtn');
clearSearchBtn?.addEventListener('click', clearSearch);

// Update highlights live when user edits the search box (but debounce)
let _highlightTimeout = null;
searchInput?.addEventListener('input', () => {
    clearTimeout(_highlightTimeout);
    _highlightTimeout = setTimeout(() => {
        const q = (searchInput.value || '').trim();
        // if input cleared, hide results box
        if (!q) {
            if (searchResultsEl) searchResultsEl.style.display = 'none';
        }
        updateHighlightsAcrossDOM(q);
    }, 250);
});

async function startSearch() {
    const q = searchInput.value || '';
    if (!window.currentChatData || !window.currentChatData.messages) return;

    // build index lazily
    if (!__searchIndex) {
        searchProgress.style.display = 'flex';
        searchProgress.querySelector('.progress-text').innerText = 'Indexing...';
        await new Promise(r => setTimeout(r, 0));
        __searchIndex = buildSearchIndex(window.currentChatData.messages);
    }

    // perform search
    searchProgress.style.display = 'flex';
    searchProgress.querySelector('.fill').style.width = '0%';
    searchProgress.querySelector('.progress-text').innerText = 'Searching...';
    searchResultsEl.innerHTML = '';
    if (searchResultsEl) searchResultsEl.style.display = 'block';

    const results = await performSearch(q, __searchIndex, (p) => {
        searchProgress.querySelector('.fill').style.width = p + '%';
        searchProgress.querySelector('.progress-text').innerText = `Searching ${p}%`;
    });

    // done
    searchProgress.querySelector('.fill').style.width = '100%';
    searchProgress.querySelector('.progress-text').innerText = `Found ${results.length} matches`;
    setTimeout(()=>{ searchProgress.style.display = 'none'; }, 800);

    // show top results
    if (!results.length) {
        searchResultsEl.innerHTML = '<div class="search-result-item">No results</div>';
        return;
    }

    const maxResults = Math.min(50, results.length);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < maxResults; i++) {
        const r = results[i];
        const el = document.createElement('div');
        el.className = 'search-result-item';
        el.dataset.idx = r.item.idx;
        const time = new Date(r.item.timestamp).toLocaleString();
        // Use the original message text/content for snippet (avoid sender/reactions that were added to the index)
        const originalMsg = (window.currentChatData && window.currentChatData.messages && window.currentChatData.messages[r.item.idx]) || null;
        const rawText = originalMsg ? (originalMsg.text || originalMsg.content || '') : (r.item.text || '');
        const rawSnippet = String(rawText).slice(0, 240);
        const highlightedSnippet = highlightText(rawSnippet, q);
    el.innerHTML = `<div class="snippet">${highlightedSnippet}</div><div class="meta">${escapeHtml(r.item.sender)} • ${time}</div>`;
        el.addEventListener('click', () => jumpToMessage(r.item.idx));
        frag.appendChild(el);
    }
    searchResultsEl.appendChild(frag);

    // Also update currently rendered chunks to show highlights for the active query
    updateHighlightsAcrossDOM(q);
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;" })[c]); }

// Jump to message index: ensure its chunk is rendered, scroll into view and highlight transiently
async function jumpToMessage(messageIndex) {
    const chatContainer = document.getElementById('chat');
    // compute which chunk
    const chunkIndex = Math.floor(messageIndex / CHUNK_SIZE);

    // render that chunk synchronously if not yet rendered
    const chunkContainer = document.querySelector(`.message-chunk[data-chunk-index="${chunkIndex}"]`);
    if (chunkContainer && !renderedMessages.has(chunkIndex)) {
        // find data.messages slice
        const start = chunkIndex * CHUNK_SIZE;
        const msgs = window.currentChatData.messages.slice(start, start + CHUNK_SIZE);
        renderChunk(chunkIndex, msgs, document.querySelector('input[name="choice"]:checked').value);
    }

    // small timeout to allow DOM update
    await new Promise(r => setTimeout(r, 20));

    // select the message element within the chunk
    // messages are appended in order; find the Nth message within earlier chunks
    let cumulative = 0;
    for (let i = 0; i <= chunkIndex; i++) {
        const c = document.querySelector(`.message-chunk[data-chunk-index="${i}"]`);
        if (!c) continue;
        const count = c.querySelectorAll('.message').length;
        cumulative += count;
    }

    // Find the global message element by data attribute: we'll mark message elements with data-msg-index when rendering
    const msgEl = document.querySelector(`.message[data-msg-index="${messageIndex}"]`);
    if (!msgEl) {
        // try to search inside chunk by approximate position
        const chunk = document.querySelector(`.message-chunk[data-chunk-index="${chunkIndex}"]`);
        if (chunk) {
            const children = Array.from(chunk.querySelectorAll('.message'));
            const localIdx = messageIndex - chunkIndex * CHUNK_SIZE;
            const candidate = children[localIdx] || children[Math.max(0, localIdx-1)];
            if (candidate) {
                await scrollAndHighlight(candidate);
                return;
            }
        }
        return;
    }
    await scrollAndHighlight(msgEl);
}

function clearSearch() {
    if (searchInput) searchInput.value = '';
    searchResultsEl.innerHTML = '';
    if (searchResultsEl) searchResultsEl.style.display = 'none';
    if (searchProgress) {
        searchProgress.querySelector('.fill').style.width = '0%';
        searchProgress.querySelector('.progress-text').innerText = 'Idle';
        searchProgress.style.display = 'none';
    }
    updateHighlightsAcrossDOM('');
}

// Re-render highlights inside already-rendered message DOM nodes without reconstructing everything
function updateHighlightsAcrossDOM(query) {
    // For each rendered .message, find its text node(s) inside .message-content and replace innerHTML accordingly
    const msgEls = document.querySelectorAll('.message');
    const q = query || '';
    msgEls.forEach(el => {
        // find original text: try to reconstruct from dataset or fallback to current textContent
        // We didn't store raw text per element, so safely re-extract from the current DOM but first strip existing <strong>
        const contentEl = el.querySelector('.message-content');
        if (!contentEl) return;
        // Build a plain-text by cloning and removing strong tags
        const clone = contentEl.cloneNode(true);
    // remove media previews and reactions/timestamp to preserve them
    // note: do NOT remove <video> separately because videos are wrapped in .media-preview anchors;
    // removing both the anchor and video then re-inserting both causes duplication.
    const mediaEls = clone.querySelectorAll('.media-preview, audio, .preview, .reaction, .timestamp');
        mediaEls.forEach(n => n.remove());
        // remove strong tags
        const strongs = clone.querySelectorAll('strong');
        strongs.forEach(s => {
            const txt = document.createTextNode(s.textContent);
            s.parentNode.replaceChild(txt, s);
        });
        const plain = clone.textContent || '';
        // Highlight plain text
        const newHTML = highlightText(plain, q);
        // Rebuild content area: keep media/reactions/timestamp from original content
        // Get original extras
        const originalContent = contentEl;
        const extras = [];
        // Collect only top-level media containers (exclude inner .preview img to avoid duplication)
        const seen = new Set();
        // collect only top-level media containers (anchors .media-preview) and audio/reaction/timestamp
        originalContent.querySelectorAll('.media-preview, audio, .reaction, .timestamp').forEach(n => {
            const html = n.outerHTML;
            if (!seen.has(html)) {
                seen.add(html);
                extras.push(html);
            }
        });
        // Set new HTML
        originalContent.innerHTML = newHTML + extras.join('');
    });
}

function scrollIntoViewWithPadding(container, element, padding = 60) {
    const containerRect = container.getBoundingClientRect();
    const elRect = element.getBoundingClientRect();
    const offset = (elRect.top - containerRect.top) - padding;
    container.scrollTop += offset;
}

async function scrollAndHighlight(el) {
    const chatContainer = document.getElementById('chat');
    // ensure surrounding messages visible: scroll so that target is centered
    scrollIntoViewWithPadding(chatContainer, el, 120);

    // add highlight classes
    el.classList.add('highlight-target');
    el.classList.add('temporary-highlight');
    // remove temporary after animation
    setTimeout(() => { el.classList.remove('temporary-highlight'); }, 2200);
    // ensure still visible
    await new Promise(r => setTimeout(r, 300));
}

// Mark messages with data-msg-index during renderChunk
const originalRenderChunk = renderChunk;
function renderChunk(chunkIndex, messages, selectedValue) {
    // delegate to original but we need to set data-msg-index on each message element
    const chunkContainer = document.querySelector(`.message-chunk[data-chunk-index="${chunkIndex}"]`);
    if (!chunkContainer || renderedMessages.has(chunkIndex)) return;

    const highlightQuery = (searchInput && searchInput.value) ? searchInput.value : '';
    messages.forEach((msg, localIdx) => {
        const globalIdx = chunkIndex * CHUNK_SIZE + localIdx;
        const div = document.createElement("div");
        const sender = msg.senderName || msg.sender_name || "Unknown";
        div.classList.add("message", sender === selectedValue ? "from-me" : "from-them");
        div.dataset.msgIndex = globalIdx;
        // attach raw message object for reliable re-rendering later
        try { div.__rawMessage = msg; } catch(e) { /* ignore */ }
        div.innerHTML = createMessageHTML(msg, highlightQuery);
        chunkContainer.appendChild(div);
    });

    renderedMessages.set(chunkIndex, true);
    ["showTime", "showMyName", "showTheirName", "showReacts"].forEach(id => {
        document.getElementById(id).dispatchEvent(new Event("change"));
    });
}

// Replace previous declaration by ensuring we don't double-define if hot-reloaded
try { window.__hasSearchPatch = true; } catch(e){}

// ------------------ Help tooltip & modal ------------------
const helpTexts = {
    perspective: {
        title: 'Góc nhìn (Perspective)',
        short: 'Chọn người mà giao diện sẽ hiển thị như thể bạn là người đó.',
        long: `Chọn một người tham gia để xem cuộc trò chuyện dưới góc nhìn của họ. Khi chọn, các tin nhắn của người đó sẽ được đánh dấu là "from-me" và tin nhắn còn lại là "from-them". Hữu ích khi bạn muốn đọc lại cuộc hội thoại như thể bạn đang ở vị trí một trong những người tham gia.`
    },
    customization: {
        title: 'Tùy chỉnh hiển thị',
        short: 'Bật/tắt tên, thời gian và biểu cảm (reactions).',
        long: `Sử dụng các checkbox để điều khiển việc hiển thị: tên người gửi, dấu thời gian và tóm tắt biểu cảm. "Hiện tên của tôi" sẽ hiển thị tên với các tin nhắn từ góc nhìn đã chọn; "Hiện tên họ" sẽ hiển thị tên người khác. "Hiện thời gian" và "Hiện biểu cảm" lần lượt bật/tắt thời gian và phần vòng biểu cảm.`
    },
    download: {
        title: 'Tải JSON từ Messenger',
        short: 'Cách xuất file JSON từ Facebook để mở bằng công cụ này.',
        long: `Để xuất cuộc trò chuyện, vào trang "Download Your Information" trên Facebook và chọn mục Messages trong phần dữ liệu cần tải. Sau khi Facebook hoàn tất, bạn sẽ nhận được file ZIP chứa JSON. Giải nén và chọn file JSON tương ứng để mở trong ứng dụng này. Lưu ý: một vài cuộc trò chuyện mã hoá đầu-cuối có thể yêu cầu thao tác đặc biệt.`
    }
};

const helpModal = document.getElementById('helpModal');
const helpBody = document.getElementById('helpBody');
const helpTitle = document.getElementById('helpTitle');
const helpClose = document.getElementById('helpClose');

function showHelpModal(key) {
    const info = helpTexts[key] || { title: 'Help', long: 'No help available.' };
    helpTitle.innerText = info.title;
    // Build a clearer modal body with a short summary and detailed paragraph
    const short = info.short ? `<p style="font-weight:600;margin-bottom:8px;">${escapeHtml(info.short)}</p>` : '';
    const long = info.long ? `<p>${escapeHtml(info.long)}</p>` : '';
    helpBody.innerHTML = short + long + `<div class="help-actions"><button class="secondary" onclick="closeHelpModal()">Đóng</button></div>`;
    if (helpModal) helpModal.setAttribute('aria-hidden', 'false');
}

function closeHelpModal() {
    if (helpModal) helpModal.setAttribute('aria-hidden', 'true');
}

helpClose?.addEventListener('click', closeHelpModal);
helpModal?.addEventListener('click', (e) => { if (e.target === helpModal) closeHelpModal(); });

// Tooltip behavior: show on hover, and on long-press for touch devices
let tooltipEl = null;
let longPressTimer = null;

function createTooltip(text) {
    if (tooltipEl) tooltipEl.remove();
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'help-tooltip';
    tooltipEl.innerText = text;
    document.body.appendChild(tooltipEl);
}

function positionTooltip(target) {
    if (!tooltipEl) return;
    const rect = target.getBoundingClientRect();
    tooltipEl.style.top = (rect.bottom + window.scrollY + 8) + 'px';
    tooltipEl.style.left = (rect.left + window.scrollX) + 'px';
}

document.querySelectorAll('.help-btn').forEach(btn => {
    const key = btn.dataset.help;
    const info = helpTexts[key];
    if (!info) return;

    btn.addEventListener('mouseenter', (e) => {
        createTooltip(info.short);
        positionTooltip(btn);
    });
    btn.addEventListener('mouseleave', () => { if (tooltipEl) tooltipEl.remove(); tooltipEl = null; clearTimeout(longPressTimer); });

    // touch/long-press support
    btn.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => { createTooltip(info.short); positionTooltip(btn); }, 600);
    }, { passive: true });
    btn.addEventListener('touchend', (e) => { clearTimeout(longPressTimer); if (tooltipEl) tooltipEl.remove(); tooltipEl = null; });

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        showHelpModal(key);
    });
});

// --- Global settings button and dark mode ---
const globalSettingsBtn = document.getElementById('globalSettingsBtn');
const globalSettingsMenu = document.getElementById('globalSettingsMenu');
const darkModeToggle = document.getElementById('darkModeToggle');

function setDarkMode(enabled, persist = true) {
    if (enabled) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    if (persist) storageSet('darkMode', enabled ? '1' : '0');
    if (darkModeToggle) darkModeToggle.checked = !!enabled;
}

globalSettingsBtn?.addEventListener('click', (e) => {
    const isOpen = globalSettingsMenu && globalSettingsMenu.getAttribute('aria-hidden') === 'false';
    if (globalSettingsMenu) globalSettingsMenu.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
    if (globalSettingsBtn) globalSettingsBtn.classList.toggle('open', !isOpen);
    if (!isOpen) { globalSettingsBtn.setAttribute('aria-expanded', 'true'); }
    else { globalSettingsBtn.setAttribute('aria-expanded', 'false'); }
});

// dark mode toggle
darkModeToggle?.addEventListener('change', (e) => { setDarkMode(e.target.checked, true); });

// initialize from localStorage
try {
    const pref = storageGet('darkMode');
    if (pref === '1') setDarkMode(true, false);
} catch(e) {}

// ------------------ Trust / Privacy modal logic ------------------
const trustModal = document.getElementById('trustModal');
const trustClose = document.getElementById('trustClose');
const trustCloseAlt = document.getElementById('trustCloseAlt');
const dontShowAgain = document.getElementById('dontShowAgain');
const trustBackdrop = document.querySelector('.trust-backdrop');

function showTrustModalIfNeeded() {
    try {
    const skip = storageGet('dontShowTrustModal');
        if (skip === '1') return;
    } catch(e) {}
    if (!trustModal) return;
    trustModal.setAttribute('aria-hidden', 'false');
    // focus the primary button for keyboard users
    setTimeout(() => { try { trustClose.focus(); } catch(e){} }, 60);
}

function closeTrustModal() {
    if (!trustModal) return;
    if (dontShowAgain && dontShowAgain.checked) {
    try { storageSet('dontShowTrustModal', '1'); } catch(e){}
    }
    trustModal.setAttribute('aria-hidden', 'true');
}

trustClose?.addEventListener('click', closeTrustModal);
trustCloseAlt?.addEventListener('click', closeTrustModal);
trustBackdrop?.addEventListener('click', closeTrustModal);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && trustModal && trustModal.getAttribute('aria-hidden') === 'false') {
        closeTrustModal();
    }
});

// Run on load
try { showTrustModalIfNeeded(); } catch(e) {}
