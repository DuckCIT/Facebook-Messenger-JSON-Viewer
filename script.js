// Scroll the page when clicking the settings icon
document.getElementById("settingsIcon").addEventListener("click", () => {
    const currentScroll = window.scrollY || document.documentElement.scrollTop;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const target = currentScroll + 10 >= maxScroll ? 0 : maxScroll;
    window.scrollTo({ top: target, behavior: "smooth" });
});

// Handle file upload
document.getElementById("fileInput").addEventListener("change", handleFileUpload);

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    resetMedia();

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

    const participants = data.participants.map(p => (typeof p === 'string' ? p : p.name));
    const threadName = data.threadName || data.title || data.threadPath || "Untitled";

    document.getElementById("threadName").innerText = threadName;
    setupRadioButtons(participants);

    let selectedValue = document.querySelector('input[name="choice"]:checked').value;

    setupCheckboxListeners();
    renderMessages(data, selectedValue);

    document.getElementById("radioForm").addEventListener("change", () => {
        selectedValue = document.querySelector('input[name="choice"]:checked').value;
        renderMessages(data, selectedValue);
    });
}

function setupRadioButtons(participants) {
    const radioForm = document.getElementById("radioForm");
    radioForm.innerHTML = "";

    participants.forEach((participant, index) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        
        input.type = "radio";
        input.name = "choice";
        input.id = `option${index + 1}`;
        input.value = participant;
        if (index === 0) input.checked = true;

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
        document.getElementById(id).addEventListener("change", function() {
            const elements = document.querySelectorAll(className);
            elements.forEach(el => el.style.display = this.checked ? "block" : "none");
        });
    });
}

function renderMessages(data, selectedValue) {
    const chatContainer = document.getElementById("chat");
    const loading = document.getElementById("loading");
    chatContainer.innerHTML = "";

    if (!data.messages.length) {
        loading.innerHTML = "No messages";
        return;
    }
    loading.style.display = "none";

    data.messages.forEach(msg => {
        const div = document.createElement("div");
        const sender = msg.senderName || msg.sender_name || "Unknown";
        div.classList.add("message", sender === selectedValue ? "from-me" : "from-them");
        div.innerHTML = createMessageHTML(msg);
        chatContainer.appendChild(div);
    });

    ["showTime", "showMyName", "showTheirName", "showReacts"].forEach(id => {
        document.getElementById(id).dispatchEvent(new Event("change"));
    });
}

// Media handling
document.getElementById("showMedia").addEventListener("change", function() {
    if (this.checked) {
        document.getElementById("mediaFolder").click();
    } else {
        mediaFiles = {};
    }
});

let mediaFiles = {};
let mediaTypes = {};

const showMediaCheckbox = document.getElementById("showMedia");
const mediaFolderInput = document.getElementById("mediaFolder");

showMediaCheckbox.addEventListener("change", function(event) {
    if (this.checked) {
        this.checked = false;
    }
});

mediaFolderInput.addEventListener("change", function(event) {
    const files = event.target.files;

    if (!files.length) {
        showMediaCheckbox.checked = false;
        return;
    }

    mediaFiles = {};
    mediaTypes = {};

    Array.from(files).forEach(file => {
        const fileURL = URL.createObjectURL(file);
        const fileName = file.name;
        mediaFiles[fileName] = fileURL;
        mediaTypes[fileName] = getMediaType(fileName);
    });

    showMediaCheckbox.checked = true;

    if (window.currentChatData) {
        renderMessages(window.currentChatData, document.querySelector('input[name="choice"]:checked').value);
    }
});

function resetMedia() {
    const showMediaCheckbox = document.getElementById("showMedia");
    showMediaCheckbox.checked = false;

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

function createMessageHTML(msg) {
    const sender = msg.senderName || msg.sender_name || "Unknown";
    const text = msg.text || msg.content || "";
    const timestamp = msg.timestamp || msg.timestamp_ms || 0;
    const mediaItems = msg.media || msg.photos || msg.videos || msg.audio || msg.gifs || [];

    return `
        <div class="sender-name">${sender}</div>
        <div class="message-content">
            ${text}
            ${mediaItems.map(media => {
                const fileName = media.uri.split(/[\\/]/).pop();
                const fileURL = mediaFiles[fileName];
                const mediaType = mediaTypes[fileName] || getMediaType(fileName);

                if (mediaType === "image") {
                    return fileURL 
                        ? `<a href="${fileURL}" target="_blank" class="media-preview"><img src="${fileURL}" alt="Image" class="preview"></a>`
                        : `<div class="placeholder">Image not found</div>`;
                } else if (mediaType === "video") {
                    return fileURL
                        ? `<a href="${fileURL}" target="_blank" class="media-preview"><video controls class="preview-video"><source src="${fileURL}" type="video/mp4"></video></a>`
                        : `<div class="placeholder">Video not found</div>`;
                } else if (mediaType === "audio") {
                    return fileURL
                        ? `<audio controls><source src="${fileURL}" type="audio/mpeg"></audio>`
                        : `<div class="placeholder">Audio not found</div>`;
                }
                return `<div class="placeholder">File not found</div>`;
            }).join("")}
            ${msg.reactions?.length ? `<div class="reaction">${msg.reactions.map(r => `${r.actor}: ${r.reaction}`).join(", ")}</div>` : ""}
            <div class="timestamp">${new Date(timestamp).toLocaleString()}</div>
        </div>
    `;
}

window.addEventListener("beforeunload", () => {
    Object.values(mediaFiles).forEach(url => URL.revokeObjectURL(url));
});