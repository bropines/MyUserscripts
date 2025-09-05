// ==UserScript==
// @name          Kemono Download Button DEV
// @namespace     http://tampermonkey.net/
// @version       5.21
// @description   Add free translators and improved bulk download logic
// @author        hoami_523 + Gemini (based on user's request) + bropines
// @match         https://kemono.cr/*
// @icon          https://kemono.cr/static/favicon.ico
// @grant         GM_download
// @grant         GM_xmlhttpRequest
// @grant         GM_setValue
// @grant         GM_getValue
// @grant         GM_addStyle
// @grant         GM_registerMenuCommand
// @grant         GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    // --- CONFIGURATION & STATE START --- //
    const DEFAULT_SETTINGS = {
        savePostTags: true,
        savePostComments: false,
        sessionCookie: "",
        enableAPIFetch: !0,
        enableDebugLogging: !1,
        savePostContentAsText: !0,
        maxConcurrentFileDownloadsInZip: 5,
        maxConcurrentOperations: 1,
        showZipButton: !0,
        showImagesButton: !0,
        showFilesButton: !0,
        showCopyLinksButton: !0,
        showShareButton: !0,
        showTranslateButton: !0,
        translationProvider: "none",
        translationLanguage: "Russian",
        geminiApiKey: "",
        translationModelName: "gemini-1.5-flash-latest",
        deeplApiKey: "",
        deeplApiTier: "free",
        maxConcurrentIndividualDownloads: 4,
        enableDownloadRetries: !0,
        downloadRetryCount: 2,
        downloadRetryDelay: 2e3,
        zipFileDownloadTimeout: 6e4,
        addMetadataFile: !0,
        fileNameTemplate: "{post_date}_{author_name}_{post_title}_{post_id}/{file_index}_{file_name}"
    };
    let settings = {},
        settingsLoadPromise = null,
        jszipLoadPromise = null,
        globalMediaCounter = 0,
        cachedPostFiles = null,
        originalPostContentHTML = null;
    const downloadQueue = [];
    let isQueueProcessing = !1,
        activeOperations = 0,
        queueIndicatorElement, settingsModalElement, settingsOverlayElement, progressContainer;
    const selectedPostIds = new Set,
        translationCache = {};
    // --- CONFIGURATION & STATE END --- //

    // --- STYLING START --- //
    GM_addStyle(`
    #kemono-download-message-box{position:fixed;top:20px;right:20px;padding:10px 20px;background-color:#333;color:#fff;border-radius:5px;z-index:10001;opacity:0;transition:opacity .5s ease-in-out,transform .3s ease-in-out;box-shadow:0 2px 10px rgba(0,0,0,.2);transform:translateX(110%)}.post-card{position:relative}.post-card .post-card-download-controls{position:absolute;top:5px;right:5px;display:none;flex-direction:column;gap:4px;background-color:rgba(40,40,40,.85);padding:5px;border-radius:4px;z-index:10;border:1px solid rgba(255,255,255,.1)}.post-card:hover .post-card-download-controls{display:flex}.post-card .post-card-download-controls button{padding:4px 8px;font-size:.8em;min-width:65px;margin:0;border:none;border-radius:3px;color:#fff;cursor:pointer;text-align:center;opacity:.9;transition:opacity .2s,background-color .2s}.post-card .post-card-download-controls button:hover{opacity:1}.post-card .post-card-dl-zip{background-color:#28a745}.post-card .post-card-dl-zip:hover{background-color:#218838}.post-card .post-card-dl-img{background-color:#007bff}.post-card .post-card-dl-img:hover{background-color:#0069d9}.post-card .post-card-dl-att{background-color:#ffc107;color:#212529!important}.post-card .post-card-dl-att:hover{background-color:#e0a800}.post-card .post-card-dl-pick{background-color:#6f42c1}.post-card .post-card-dl-pick:hover{background-color:#5a32a3}
    .post-card .post-card-dl-info{background-color:#6c757d}.post-card .post-card-dl-info:hover{background-color:#5a6268}
    .post-card .post-card-download-controls button:disabled,.post__actions button[data-is-downloading=true],.post__actions button[data-is-queued=true]{opacity:.6!important;cursor:not-allowed!important}.post-card .post-card-download-controls button[data-is-queued=true],.post__actions button[data-is-queued=true]{background-color:#fd7e14!important}.post-card .post-card-download-controls button[data-is-downloading=true],.post__actions button[data-is-downloading=true]{background-color:#6c757d!important}.post__actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-top:5px}.post__actions>*{margin:0!important}#kdl-fixed-controls{position:fixed;bottom:15px;right:15px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;z-index:9998}#kdl-queue-indicator{background-color:rgba(0,0,0,.7);color:#fff;padding:5px 10px;border-radius:5px;font-size:.9em;box-shadow:0 1px 5px rgba(0,0,0,.3)}#kdl-settings-btn{background-color:#007bff;color:#fff;border:none;padding:8px;border-radius:50%;cursor:pointer;font-size:1.2em;line-height:1;width:40px;height:40px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 5px rgba(0,0,0,.3)}#kdl-settings-btn:hover{background-color:#0056b3}#kdl-settings-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,.5);display:none;justify-content:center;align-items:center;z-index:10000;backdrop-filter:blur(7px)}
    #kdl-settings-modal{background-color:#333;color:#f0f0f0;border-radius:8px;box-shadow:0 5px 20px rgba(0,0,0,.4);width:500px;max-width:95vw;display:flex;flex-direction:column;max-height:85vh}#kdl-settings-modal-content{overflow-y:auto;padding:0 25px}#kdl-settings-modal h2{margin-top:25px;margin-bottom:25px;padding-bottom:10px;color:#00aeff;border-bottom:1px solid #555;text-align:center}#kdl-settings-modal h3{margin-top:20px;margin-bottom:10px;color:#f0f0f0;border-bottom:1px solid #444;padding-bottom:8px}#kdl-settings-modal label{display:block;margin-top:15px;margin-bottom:5px;font-weight:700}#kdl-settings-modal input[type=checkbox]{margin-right:8px;vertical-align:middle}#kdl-settings-modal input[type=number],#kdl-settings-modal input[type=text],#kdl-settings-modal input[type=password],#kdl-settings-modal select{width:100%;padding:8px 10px;border-radius:4px;border:1px solid #555;background-color:#444;color:#f0f0f0;box-sizing:border-box}#kdl-settings-modal input[type=number]{width:80px}#kdl-settings-modal small{display:block;font-size:0.8em;color:#aaa;margin-top:4px;font-weight:normal}.kdl-settings-actions{text-align:right;padding:15px 25px;background-color:#3a3a3a;border-top:1px solid #444;margin-top:auto;position:sticky;bottom:0}#kdl-settings-modal button{padding:10px 18px;border:none;border-radius:4px;cursor:pointer;margin-left:10px;font-weight:700}#kdl-settings-modal button.kdl-save{background-color:#28a745;color:#fff}#kdl-settings-modal button.kdl-save:hover{background-color:#218838}#kdl-settings-modal button.kdl-close{background-color:#6c757d;color:#fff}#kdl-settings-modal button.kdl-close:hover{background-color:#5a6268}#kdl-settings-modal .kdl-setting-item{margin-bottom:10px}
    #kdl-progress-container{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:80vw;max-width:800px;max-height:40vh;overflow-y:auto;z-index:10002;display:flex;flex-direction:column-reverse;gap:8px;padding-bottom:10px}.kdl-progress-task{background-color:rgba(40,43,48,0.9);backdrop-filter:blur(5px);color:#f0f0f0;border-radius:6px;padding:8px 12px;box-shadow:0 2px 8px rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);display:flex;flex-direction:column;gap:5px}.kdl-task-header{display:flex;justify-content:space-between;align-items:center;font-weight:bold}.kdl-task-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.95em}.kdl-task-status{font-size:.85em;color:#ccc}.kdl-task-files{max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding-right:5px}.kdl-progress-bar-wrapper{width:100%}.kdl-progress-bar-label{color:#ddd;font-size:.8em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}.kdl-progress-bar-label.kdl-success{color:#28a745}.kdl-progress-bar-label.kdl-error{color:#dc3545}.kdl-progress-bar{width:100%;height:8px;background-color:#555;border-radius:4px;overflow:hidden}.kdl-progress-bar-inner{width:0%;height:100%;background-color:#007bff;transition:width .1s linear,background-color .3s}.kdl-progress-bar-inner.kdl-success{background-color:#28a745!important}.kdl-progress-bar-inner.kdl-error{background-color:#dc3545!important}
    #kdl-bulk-panel{position:sticky;top:10px;background-color:rgba(40,40,40,0.9);padding:10px;border-radius:8px;z-index:800;display:flex;gap:10px;align-items:center;justify-content:center;border:1px solid #555;backdrop-filter:blur(5px);margin-bottom:10px}
    #kdl-bulk-panel button{padding:8px 12px;border:none;border-radius:4px;cursor:pointer;font-size:.9em;color:#fff}
    #kdl-bulk-download-btn{background-color:#28a745} #kdl-bulk-download-btn:disabled{background-color:#6c757d;cursor:not-allowed}
    #kdl-bulk-select-all{background-color:#007bff} #kdl-bulk-deselect-all{background-color:#dc3545}
    .kdl-post-checkbox{position:absolute;top:5px;left:5px;z-index:11;width:20px;height:20px;cursor:pointer;padding:5px;margin:0;background-clip:content-box}
    #kdl-file-picker-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,.7);display:flex;justify-content:center;align-items:center;z-index:10003;backdrop-filter:blur(5px)}
    #kdl-file-picker-modal{background-color:#2b2b2b;color:#f0f0f0;border-radius:8px;padding:20px;width:600px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 5px 20px rgba(0,0,0,.3);border:1px solid #555}
    #kdl-file-picker-modal h4{margin:0 0 15px 0;color:#00aeff;border-bottom:1px solid #444;padding-bottom:10px;text-align:center}
    #kdl-file-picker-list{overflow-y:auto;list-style:none;padding:0;margin:0}
    #kdl-file-picker-list li{margin-bottom:5px}
    #kdl-file-picker-list a{display:block;padding:8px 12px;background-color:#3a3a3a;border-radius:4px;color:#e0e0e0;text-decoration:none;transition:background-color .2s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #kdl-file-picker-list a:hover{background-color:#4a4a4a;color:#fff}
    .kdl-post-info-tooltip {position: absolute;bottom: 100%;right: 0;background-color: #1a1a1a;color: #f0f0f0;padding: 8px;border-radius: 5px;border: 1px solid #555;z-index: 801;width: 200px;font-size: 0.85em;display: none;pointer-events: none;box-shadow: 0 3px 10px rgba(0,0,0,0.5);}
`);
    // --- STYLING END --- //


    // --- PROGRESS MANAGER START --- //
    const progressManager = {
        tasks: new Map(),
        initContainer() {
            if (!progressContainer) {
                progressContainer = document.createElement('div');
                progressContainer.id = 'kdl-progress-container';
                document.body.appendChild(progressContainer);
            }
        },
        createTask(id, title) {
            this.initContainer();
            const taskElement = document.createElement('div');
            taskElement.className = 'kdl-progress-task';
            taskElement.dataset.taskId = id;
            taskElement.innerHTML = `<div class="kdl-task-header"><span class="kdl-task-title">${title}</span><span class="kdl-task-status">Initializing...</span></div><div class="kdl-task-files"></div>`;
            progressContainer.appendChild(taskElement);
            const files = new Map();
            const task = {
                element: taskElement,
                statusEl: taskElement.querySelector('.kdl-task-status'),
                filesContainer: taskElement.querySelector('.kdl-task-files'),
                updateStatus: (text) => {
                    task.statusEl.textContent = text;
                },
                addFile: (fileId, fileName, withBar = true) => {
                    const fileWrapper = document.createElement('div');
                    fileWrapper.className = 'kdl-progress-bar-wrapper';
                    fileWrapper.dataset.fileId = fileId;
                    let barHtml = '';
                    if (withBar) barHtml = '<div class="kdl-progress-bar"><div class="kdl-progress-bar-inner"></div></div>';
                    fileWrapper.innerHTML = `<div class="kdl-progress-bar-label">${sanitizeFilename(fileName)}</div>${barHtml}`;
                    task.filesContainer.appendChild(fileWrapper);
                    const fileObj = {
                        element: fileWrapper,
                        label: fileWrapper.querySelector('.kdl-progress-bar-label'),
                        bar: withBar ? fileWrapper.querySelector('.kdl-progress-bar-inner') : null
                    };
                    files.set(fileId, fileObj);
                    return fileObj;
                },
                updateFileProgress: (fileId, percent) => {
                    const file = files.get(fileId);
                    if (file?.bar) file.bar.style.width = `${percent}%`;
                },
                markFileComplete: (fileId, success = true) => {
                    const file = files.get(fileId);
                    if (!file) return;
                    if (file.bar) {
                        file.bar.style.width = '100%';
                        file.bar.classList.add(success ? 'kdl-success' : 'kdl-error');
                    } else if (file.label) {
                        file.label.classList.add(success ? 'kdl-success' : 'kdl-error');
                    }
                },
                finish: (delay = 5000) => {
                    setTimeout(() => {
                        taskElement.style.transition = 'opacity 0.5s';
                        taskElement.style.opacity = '0';
                        setTimeout(() => {
                            taskElement.remove();
                            progressManager.tasks.delete(id);
                        }, 500);
                    }, delay);
                }
            };
            this.tasks.set(id, task);
            return task;
        }
    };
    // --- PROGRESS MANAGER END --- //


    // --- CORE HELPERS & UTILITIES START --- //
    function debugLog(...args) {
        if (settings.enableDebugLogging) console.log("[Kemono DL Debug]", ...args);
    }

    function loadJSZip() {
        if (jszipLoadPromise) return jszipLoadPromise;
        if (typeof JSZip !== 'undefined') return Promise.resolve();
        return jszipLoadPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    function getFullUrl(p) {
        return p.startsWith('/') ? window.location.origin + p : p;
    }

    function sanitizeFilename(f) {
        return String(f || "untitled").replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || "untitled";
    }

    function showMessage(m, t = 'info') {
        let b = document.getElementById('kemono-download-message-box');
        if (!b) {
            b = document.createElement('div');
            b.id = 'kemono-download-message-box';
            document.body.appendChild(b);
        }
        b.textContent = m;
        b.style.backgroundColor = t === 'error' ? '#dc3545' : (t === 'warning' ? '#ffc107' : '#007bff');
        b.style.color = t === 'warning' ? '#000' : '#fff';
        b.style.opacity = '1';
        b.style.transform = 'translateX(0)';
        setTimeout(() => {
            b.style.opacity = '0';
            b.style.transform = 'translateX(110%)';
        }, 4000);
    }

    function resetMediaCounter() {
        globalMediaCounter = 0;
    }

    function htmlToFormattedText(html) {
        if (!html) return "";
        let processedHtml = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n\s*\n/g, '\n\n');
        const textarea = document.createElement('textarea');
        textarea.innerHTML = processedHtml;
        return textarea.value.trim();
    }

    function generateRandomId(length) {
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }
    async function gmXmlhttpRequestWithRetries(details) {
        await getSettings();
        const attempts = settings.enableDownloadRetries ? (settings.downloadRetryCount + 1) : 1;
        for (let i = 0; i < attempts; i++) {
            try {
                return await new Promise((resolve, reject) => {
                    const headers = {
                        ...(details.headers || {}),
                        'Accept': 'text/css'
                    };

                    if (settings.sessionCookie) {
                        headers['Cookie'] = `session=${settings.sessionCookie}`;
                    }

                    const requestDetails = {
                        ...details,
                        headers: headers,
                        onload: r => (r.status >= 200 && r.status < 300) ? resolve(r) : reject(new Error(`Status ${r.status}`)),
                        onerror: () => reject(new Error('Network error')),
                        ontimeout: () => reject(new Error('Timeout'))
                    };
                    debugLog("Sending request to", requestDetails.url, "with headers:", requestDetails.headers); // Полезно для отладки
                    GM_xmlhttpRequest(requestDetails);
                });
            } catch (error) {
                debugLog(`Attempt ${i + 1}/${attempts} failed for ${details.url}:`, error.message);
                if (i === attempts - 1) throw error;
                if (settings.downloadRetryDelay > 0) await new Promise(res => setTimeout(res, settings.downloadRetryDelay));
            }
        }
    }

    function waitForElement(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);

            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout: Element ${selector} not found`));
            }, timeout);
        });
    }
    // --- CORE HELPERS & UTILITIES END --- //


    // --- SETTINGS MANAGEMENT START --- //
    async function _loadSettingsAsync() {
        const loadedSettings = {};
        const keys = Object.keys(DEFAULT_SETTINGS);
        const values = await Promise.all(keys.map(key => GM_getValue(key, DEFAULT_SETTINGS[key])));
        for (let i = 0; i < keys.length; i++) {
            loadedSettings[keys[i]] = values[i];
        }
        settings = loadedSettings;
        debugLog("Settings loaded:", settings);
    }

    function getSettings() {
        if (!settingsLoadPromise) {
            settingsLoadPromise = _loadSettingsAsync();
        }
        return settingsLoadPromise;
    }
    async function saveSettingsFromModal() {
        await getSettings();
        for (const key in DEFAULT_SETTINGS) {
            const element = document.getElementById(`kdl-setting-${key}`);
            if (element) {
                let value;
                if (element.type === 'checkbox') value = element.checked;
                else if (element.type === 'number') value = parseInt(element.value, 10) || DEFAULT_SETTINGS[key];
                else value = element.value || DEFAULT_SETTINGS[key];
                await GM_setValue(key, value);
                settings[key] = value;
            }
        }
        settingsLoadPromise = null;
        await getSettings();
        showMessage('Settings saved!', 'info');
        toggleSettingsModal(false);
        await handlePageContent();
    }
    // --- SETTINGS MANAGEMENT END --- //

    // --- DATA FETCHING & PROCESSING START --- //
    function getPostDetailsFromPage() {
        const t = document.querySelector("h1.post__title"),
            e = document.querySelector("a.post__user-name"),
            o = document.querySelector(".post__user-name"),
            n = document.querySelector("a.post__view"),
            s = window.location.pathname.match(/\/([^/]+)\/user\/([^/]+)\/post\/(\d+)/) || window.location.pathname.match(/\/post\/(\d+)/),
            i = t ? sanitizeFilename(t.textContent.trim()) : "UnknownTitle";
        let a = o ? sanitizeFilename(o.textContent.trim()) : "UnknownAuthor",
            l = "UnknownService",
            r = "UnknownUserID",
            c = "UnknownPostID";
        if (e?.href) {
            const t = new URL(e.href).pathname.match(/^\/([^/]+)\/user\/([^/]+)/);
            t && (l = t[1], r = t[2], "UnknownAuthor" === a && r && (a = sanitizeFilename(r)))
        }
        if (n?.href) {
            const t = new URL(n.href).pathname.match(/\/post\/(\d+)/);
            t && (c = t[1])
        }
        if ("UnknownPostID" === c && s)
            if (4 === s.length) l = s[1], r = s[2], c = s[3];
            else if (2 === s.length) c = s[1];
        if (window.location.pathname.includes(`/${l}/user/${r}`) && ("UnknownAuthor" === a || a === sanitizeFilename(r))) {
            const t = document.querySelector('.user-header__name span[itemprop="name"]');
            t?.textContent.trim() && (a = sanitizeFilename(t.textContent.trim()))
        } else "UnknownAuthor" === a && "UnknownUserID" !== r && (a = sanitizeFilename(r));
        return {
            postTitle: i,
            authorName: a,
            service: l,
            userID: r,
            postID: c
        }
    }

    function getPostCardDetails(t, e) {
        let o = t.querySelector(".post-card__header")?.textContent.trim() || `Post_${t.dataset.id||"UnknownPostID"}`;
        return o = sanitizeFilename(o), {
            postTitle: o,
            authorName: e && "UnknownAuthor" !== e ? sanitizeFilename(e) : sanitizeFilename(t.dataset.user || "UnknownUserID"),
            service: t.dataset.service || "UnknownService",
            userID: t.dataset.user || "UnknownUserID",
            postID: t.dataset.id || "UnknownPostID"
        }
    }

    function formatNameFromTemplate(t, e) {
        let o = t;
        for (const t in e) {
            const n = String(e[t] || "");
            o = o.replace(new RegExp(`{${t}}`, "g"), n)
        }
        return o.split("/").map((t => sanitizeFilename(t))).join("/")
    }

    function generateFilePath(t, e, o) {
        const n = e.name || "",
            s = n.lastIndexOf("."),
            i = -1 !== s ? n.substring(s + 1) : "",
            a = -1 !== s ? n.substring(0, s) : n;
        return formatNameFromTemplate(t, {
            author_name: o.authorName,
            post_title: o.postTitle,
            post_id: o.postID,
            user_id: o.userID,
            service: o.service,
            post_date: o.postDate,
            file_name: n,
            file_name_no_ext: a,
            file_ext: i,
            file_index: String(e.index || "0").padStart(3, "0"),
            bulk_post_index: String(o.bulk_post_index || "0").padStart(2, "0"),
            bulk_file_index: String(o.bulk_file_index || "0").padStart(4, "0")
        })
    }

    async function fetchPostDataFromAPI(t, e, o) {
        if ("UnknownService" === t || "UnknownUserID" === e || "UnknownPostID" === o || !settings.enableAPIFetch) return null;
        try {
            return (await gmXmlhttpRequestWithRetries({
                method: "GET",
                url: `https://kemono.cr/api/v1/${t}/user/${e}/post/${o}`,
                responseType: "json",
                timeout: 3e4
            })).response
        } catch (t) {
            return console.error(`API fetch failed for ${t}/${e}/${o}:`, t), null
        }
    }
    async function collectFilesForPost(t, options = {}) {
        debugLog("Collecting files for post:", t.postID, "with options:", options);
        await getSettings();

        if (!options.isBulk) {
            resetMediaCounter();
        }
        let postSpecificMediaCounter = 0;

        const e = [];

        try {
            const o = await fetchPostDataFromAPI(t.service, t.userID, t.postID);
            const n = o?.post || (Array.isArray(o) ? o[0] : o);
            if (!n) throw new Error("API did not return valid post data.");

            const s = n.published ? new Date(n.published) : new Date;
            const i = s.toISOString().split("T")[0];
            const a = {
                ...t,
                postTitle: sanitizeFilename(n.title || t.postTitle),
                authorName: sanitizeFilename("UnknownAuthor" === t.authorName ? t.userID : t.authorName),
                postDate: i,
                bulk_post_index: options.bulk_post_index,
            };

            if (settings.savePostTags) {
                try {
                    const tagsResponse = await gmXmlhttpRequestWithRetries({
                        method: "GET",
                        url: `https://kemono.cr/api/v1/${t.service}/user/${t.userID}/tags`,
                        responseType: "json",
                        timeout: 15000
                    });
                    if (tagsResponse.response && tagsResponse.response.length > 0) {
                        const tagsText = tagsResponse.response.map(tag => tag.name).join('\n');
                        e.push({
                            name: generateFilePath(settings.fileNameTemplate, {
                                name: "tags.txt",
                                index: 0
                            }, a),
                            source: "text",
                            data: tagsText,
                            isMedia: !1
                        });
                    }
                } catch (tagError) {
                    console.error(`Failed to fetch tags for ${t.userID}:`, tagError);
                }
            }

            if (settings.savePostComments) {
                try {
                    const commentsResponse = await gmXmlhttpRequestWithRetries({
                        method: "GET",
                        url: `https://kemono.cr/api/v1/${t.service}/user/${t.userID}/post/${t.postID}/comments`,
                        responseType: "json",
                        timeout: 15000
                    });
                    if (commentsResponse.response && commentsResponse.response.length > 0) {
                        const commentsText = commentsResponse.response.map(c =>
                            `User: ${c.user}\nDate: ${new Date(c.date).toLocaleString()}\n\n${htmlToFormattedText(c.message)}\n\n--------------------\n`
                        ).join('');
                        e.push({
                            name: generateFilePath(settings.fileNameTemplate, {
                                name: "comments.txt",
                                index: 0
                            }, a),
                            source: "text",
                            data: commentsText,
                            isMedia: !1
                        });
                    }
                } catch (commentError) {
                    console.error(`Failed to fetch comments for post ${t.postID}:`, commentError);
                }
            }

            const l = [];
            n.file?.path && l.push({
                name: n.file.name,
                path: n.file.path
            });
            Array.isArray(n.attachments) && n.attachments.forEach((t => {
                t.path && l.push({
                    name: t.name,
                    path: t.path
                })
            }));

            l.forEach((t => {
                globalMediaCounter++;
                postSpecificMediaCounter++;
                const o = /(jpe?g|png|gif|bmp|webp|mp4|webm|mov|avi|mkv|flv|wmv)$/i.test(t.name || "");
                const fileDetails = {
                    ...a,
                    bulk_file_index: globalMediaCounter
                };
                const n = generateFilePath(settings.fileNameTemplate, {
                    name: t.name,
                    index: postSpecificMediaCounter
                }, fileDetails);
                e.push({
                    name: n,
                    source: "url",
                    data: getFullUrl(t.path),
                    isMedia: o
                });
            }));

            settings.savePostContentAsText && htmlToFormattedText(n.content) && e.push({
                name: generateFilePath(settings.fileNameTemplate, {
                    name: "content.txt",
                    index: 0
                }, a),
                source: "text",
                data: htmlToFormattedText(n.content),
                isMedia: !1
            });
            settings.addMetadataFile && e.push({
                name: generateFilePath(settings.fileNameTemplate, {
                    name: "metadata.json",
                    index: 0
                }, a),
                source: "text",
                data: JSON.stringify(o, null, 2),
                isMedia: !1
            });

            return {
                files: e,
                originalHTML: n.content
            };

        } catch (t) {
            console.error("Failed to collect files:", t);
            return {
                files: [],
                originalHTML: ""
            };
        }
    }


    async function fetchAndCachePostData() {
        if (cachedPostFiles || !window.location.pathname.includes("/post/")) return;
        const {
            files: t,
            originalHTML: e
        } = await collectFilesForPost(getPostDetailsFromPage(), {
            isBulk: false
        });
        cachedPostFiles = t, originalPostContentHTML = e, originalPostContentHTML || (document.querySelector(".post__content") ? (originalPostContentHTML = document.querySelector(".post__content").innerHTML, debugLog("API did not provide post content. Using content from the page as a fallback.")) : debugLog("Failed to get post content from API and page.")), debugLog(`Page data cached with ${t.length} file entries. Content available: ${!!originalPostContentHTML}`)
    }
    // --- DATA FETCHING & PROCESSING END --- //

    // --- DOWNLOAD & ACTION LOGIC START --- //

    const langCodeMap = {
        'auto': 'auto',
        'russian': 'ru',
        'english': 'en',
        'chinese': 'zh',
        'japanese': 'ja',
        'korean': 'ko',
        'vietnamese': 'vi',
        'czech': 'cs',
        'dutch': 'nl',
        'french': 'fr',
        'german': 'de',
        'hungarian': 'hu',
        'italian': 'it',
        'polish': 'pl',
        'portuguese': 'pt',
        'romanian': 'ro',
        'spanish': 'es',
        'turkish': 'tr',
        'arabic': 'ar',
        'malayalam': 'ml',
        'tamil': 'ta',
        'hindi': 'hi'
    };

    async function executeTranslation(t) {
        await getSettings();
        const e = document.querySelector(".post__content");
        if (!e || !originalPostContentHTML) return void showMessage("Content not found for translation.", "error");
        const o = getPostDetailsFromPage(),
            n = o.postID;
        if ("true" === e.dataset.isTranslated) return e.innerHTML = originalPostContentHTML, t.textContent = "Translate 📝", void(e.dataset.isTranslated = "false");
        if (translationCache[n]) return debugLog(`Using cached translation for post ${n}.`), e.innerHTML = `<p>${translationCache[n].replace(/\n/g,"<br>")}</p>`, t.textContent = "Show Original ⏪", void(e.dataset.isTranslated = "true");
        const s = htmlToFormattedText(originalPostContentHTML);
        if (!s) return void showMessage("No text to translate.", "warning");
        t.textContent = "Translating...", t.disabled = !0;
        try {
            let translatedText;
            const targetLangKey = settings.translationLanguage.toLowerCase().trim();
            const targetLangCode = langCodeMap[targetLangKey] || 'en';
            const linesToTranslate = s.split('\n');

            if ("gemini" === settings.translationProvider || "deepl" === settings.translationProvider) {
                if ("gemini" === settings.translationProvider) translatedText = await executeGeminiTranslation(s);
                if ("deepl" === settings.translationProvider) translatedText = await executeDeepLTranslation(s);
            } else {
                let translatedLines = [];
                if ("yandex" === settings.translationProvider) {
                    debugLog(`Translating with Yandex to ${targetLangCode}`);
                    translatedLines = await yandexFreeTranslator.translate(linesToTranslate, targetLangCode);
                } else if ("google" === settings.translationProvider) {
                    debugLog(`Translating with Google to ${targetLangCode}`);
                    const nonEmptyLines = linesToTranslate.map((line, index) => ({
                            line,
                            index
                        }))
                        .filter(item => item.line.trim() !== '');
                    const linesForApi = nonEmptyLines.map(item => item.line);

                    const apiResult = await googleFreeTranslator.translate(linesForApi, targetLangCode);

                    translatedLines = Array(linesToTranslate.length).fill("");
                    nonEmptyLines.forEach((item, i) => {
                        if (apiResult[i]) {
                            translatedLines[item.index] = apiResult[i];
                        }
                    });
                } else {
                    throw new Error("No active translator selected.");
                }
                translatedText = translatedLines.join('\n');
            }

            if (typeof translatedText !== 'string') throw new Error("Translation result is not a string.");

            translationCache[n] = translatedText, debugLog(`Translation for post ${n} cached.`), e.innerHTML = `<p>${translatedText.replace(/\n/g,"<br>")}</p>`, t.textContent = "Show Original ⏪", e.dataset.isTranslated = "true"
        } catch (e) {
            console.error("Translation failed:", e), showMessage(`Translation failed: ${e.message}`, "error"), t.textContent = "Translate 📝"
        } finally {
            t.disabled = !1
        }
    }

    async function executeGeminiTranslation(t) {
        const e = await gmXmlhttpRequestWithRetries({
                method: "POST",
                url: `https://generativelanguage.googleapis.com/v1beta/models/${settings.translationModelName}:generateContent?key=${settings.geminiApiKey}`,
                headers: {
                    "Content-Type": "application/json"
                },
                data: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `You are a professional translator. Translate the following text to ${settings.translationLanguage}. If the text is duplicated in different languages, provide only one version in the target language. Provide only the translated text, without any additional comments or explanations.\n\n${t}`
                        }]
                    }]
                })
            }),
            o = JSON.parse(e.responseText)?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!o) throw new Error("Invalid response structure from Gemini.");
        return o
    }
    async function executeDeepLTranslation(t) {
        const e = "pro" === settings.deeplApiTier ? "https://api.deepl.com/v2/translate" : "https://api-free.deepl.com/v2/translate",
            o = {
                russian: "RU",
                english: "EN-GB",
                japanese: "JA",
                korean: "KO",
                chinese: "ZH"
            } [settings.translationLanguage.toLowerCase()] || settings.translationLanguage.toUpperCase(),
            n = await gmXmlhttpRequestWithRetries({
                method: "POST",
                url: e,
                headers: {
                    Authorization: `DeepL-Auth-Key ${settings.deeplApiKey}`,
                    "Content-Type": "application/json"
                },
                data: JSON.stringify({
                    text: [t],
                    target_lang: o
                })
            }),
            s = JSON.parse(n.responseText)?.translations?.[0]?.text;
        if (!s) throw new Error("Invalid response structure from DeepL.");
        return s
    }
    async function executeZipDownload(t) {
        activeOperations++;
        const e = progressManager.createTask(`zip-${t.postID}`, `ZIP: ${t.postTitle}`);
        try {
            const o = window.location.pathname.includes("/post/"),
                {
                    files: n
                } = o && cachedPostFiles ? {
                    files: cachedPostFiles
                } : await collectFilesForPost(t);
            if (0 === n.length) throw new Error("No content to ZIP.");
            await loadJSZip();
            let s = 0,
                i = 0;
            const a = n.filter((t => "url" === t.source)),
                l = a.length;
            e.updateStatus(`Downloading ${l} files...`);
            const r = new JSZip;
            n.forEach((t => {
                "text" === t.source && r.file(t.name, t.data)
            }));
            const c = [];
            let d = 0;
            for (const [o, u] of a.entries()) c.push((async () => {
                for (; d >= settings.maxConcurrentFileDownloadsInZip;) await new Promise((t => setTimeout(t, 200)));
                d++;
                const n = `${t.postID}-${o}`;
                e.addFile(n, u.name);
                try {
                    const t = await gmXmlhttpRequestWithRetries({
                        method: "GET",
                        url: u.data,
                        responseType: "arraybuffer",
                        timeout: settings.zipFileDownloadTimeout,
                        onprogress: t => {
                            (t.lengthComputable && e.updateFileProgress(n, t.loaded / t.total * 100))
                        }
                    });
                    r.file(u.name, t.response), e.markFileComplete(n, !0)
                } catch (t) {
                    i++, e.markFileComplete(n, !1), r.file(`failed_${u.name.split("/").pop()}`, `Failed to download file.\nURL: ${u.data}\nError: ${t.message}`)
                } finally {
                    s++, d--, e.updateStatus(`Downloading... ${s}/${l} done`)
                }
            })());
            if (await Promise.all(c), l > 0 && i === l) throw new Error("All file downloads failed");
            e.updateStatus("Zipping...");
            const u = `${t.authorName}_${t.postTitle}_${t.postID}_${generateRandomId(6)}.zip`,
                p = await r.generateAsync({
                    type: "blob"
                }, (t => e.updateStatus(`Zipping ${t.percent.toFixed(0)}%`)));
            if (!(p.size > 0)) throw new Error("Generated ZIP is empty.");
            GM_download({
                url: URL.createObjectURL(p),
                name: u,
                saveAs: !1
            }), e.updateStatus(`Complete! ${i>0?`(${i} fails)`:""}`)
        } catch (t) {
            e.updateStatus(`Error: ${t.message}`), console.error("ZIP process error:", t);
            throw t
        } finally {
            e.finish()
        }
    }
    async function executeIndividualDownload(t, e) {
        activeOperations++, await getSettings();
        const o = progressManager.createTask(`${t}-${e.postID}`, `${t}: ${e.postTitle}`);
        try {
            const n = window.location.pathname.includes("/post/"),
                {
                    files: s
                } = n && cachedPostFiles ? {
                    files: cachedPostFiles
                } : await collectFilesForPost(e);
            let i;
            if ("Images" === t) i = s.filter((t => t.isMedia && "url" === t.source));
            else if ("Attachments" === t) i = s.filter((t => !t.isMedia && "url" === t.source));
            else i = s.filter((t => "url" === t.source));
            if (0 === i.length) throw new Error(`No ${t.toLowerCase()} found.`);
            const a = i.map(((t, e) => ({
                ...t,
                index: e
            })));
            let l = 0,
                r = 0;
            const c = a.length;
            a.forEach((t => o.addFile(`${e.postID}-${t.index}`, t.name.split("/").pop(), !1)));
            const d = () => o.updateStatus(`Completed: ${l} / Failed: ${r} / Total: ${c}`);
            d();
            const u = async t => {
                const e = settings.enableDownloadRetries ? settings.downloadRetryCount + 1 : 1;
                for (let o = 0; o < e; o++) {
                    try {
                        return await new Promise(((e, o) => {
                            GM_download({
                                url: t.data,
                                name: t.name,
                                saveAs: !1,
                                onload: e,
                                onerror: t => o(new Error(t.error)),
                                ontimeout: () => o(new Error("Timeout"))
                            })
                        })), {
                            success: !0
                        }
                    } catch (n) {
                        if (debugLog(`Attempt ${o+1}/${e} for ${t.name} failed: ${n.message}`), o < e - 1) {
                            if (settings.downloadRetryDelay > 0) await new Promise((t => setTimeout(t, settings.downloadRetryDelay)))
                        } else return {
                            success: !1,
                            error: n
                        }
                    }
                }
            }, m = async () => {
                for (; a.length > 0;) {
                    const t = a.shift();
                    if (t) {
                        const n = await u(t);
                        n.success ? (l++, o.markFileComplete(`${e.postID}-${t.index}`, !0)) : (r++, o.markFileComplete(`${e.postID}-${t.index}`, !1)), d()
                    }
                }
            };
            const p = [];
            const f = Math.max(1, settings.maxConcurrentIndividualDownloads);
            for (let t = 0; t < f; t++) p.push(m());
            await Promise.all(p)
        } catch (t) {
            o.updateStatus(`Error: ${t.message}`);
            throw t
        } finally {
            o.finish()
        }
    }
    async function executeLinkAction(t, e, o, n) {
        const s = window.location.pathname.includes("/post/"),
            {
                files: i
            } = s && cachedPostFiles ? {
                files: cachedPostFiles
            } : await collectFilesForPost(e),
            a = i.filter((t => "url" === t.source));
        if (0 === a.length) return void showMessage("No links found.", "warning");
        o.textContent = "Working...";
        try {
            if ("copy-aria" === t) {
                const t = a.map((t => `${t.data}\n  out=${t.name}`)).join("\n");
                GM_setClipboard(t, "text"), showMessage(`Copied ${a.length} links for aria2c/IDM.`, "info"), o.textContent = "Copied!"
            } else if ("download-txt" === t) {
                const t = a.map((t => t.data)).join("\n"),
                    s = new Blob([t], {
                        type: "text/plain;charset=utf-8"
                    }),
                    i = `${e.authorName}_${e.postTitle}_links.txt`;
                GM_download(URL.createObjectURL(s), i), showMessage("Link file for ADM started.", "info"), o.textContent = "File Saved!"
            } else if ("share" === t && navigator.share) {
                const t = a.map((t => t.data)).join("\n");
                await navigator.share({
                    title: `Links for ${e.postTitle}`,
                    text: t
                }), o.textContent = "Shared!"
            }
        } catch (t) {
            "AbortError" !== t.name ? (console.error("Link Action Error:", t), showMessage("Action failed.", "error"), o.textContent = "Error!") : o.textContent = n
        } finally {
            o.textContent !== n && setTimeout((() => {
                o.textContent = n
            }), 3e3)
        }
    }

    async function executeBulkDownload() {
        const t = document.getElementById("kdl-bulk-download-btn");
        if (0 === selectedPostIds.size) return void showMessage("No posts selected.", "warning");
        activeOperations++, t.disabled = !0;

        const sortOrder = document.getElementById('kdl-bulk-sort-order').value;
        let postIdsToDownload = Array.from(selectedPostIds);

        if (sortOrder === 'oldest') {
            postIdsToDownload.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
        } else if (sortOrder === 'newest') {
            postIdsToDownload.sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
        }

        const e = postIdsToDownload;
        const o = document.querySelector('.user-header__name span[itemprop="name"]')?.textContent.trim() || "UnknownAuthor";
        const n = progressManager.createTask(`bulk-zip-${Date.now()}`, `Bulk Download (${e.length} Posts)`);

        resetMediaCounter();

        try {
            await loadJSZip();
            const s = new JSZip;
            for (let i = 0; i < e.length; i++) {
                const a = e[i],
                    l = document.querySelector(`article.post-card[data-id="${a}"]`);
                if (!l) continue;
                const r = getPostCardDetails(l, o);
                n.updateStatus(`[${i+1}/${e.length}] Fetching: ${r.postTitle}`);

                const {
                    files: c
                } = await collectFilesForPost(r, {
                    isBulk: true,
                    bulk_post_index: i + 1,
                });

                if (0 === c.length) continue;
                c.forEach((t => {
                    "text" === t.source && s.file(t.name, t.data)
                }));
                const d = c.filter((t => "url" === t.source));
                if (d.length > 0) {
                    n.updateStatus(`[${i+1}/${e.length}] Downloading ${d.length} files for ${r.postTitle}`);
                    const t = [];
                    let o = 0;
                    for (const [a, l] of d.entries()) t.push((async () => {
                        for (; o >= settings.maxConcurrentFileDownloadsInZip;) await new Promise((t => setTimeout(t, 200)));
                        o++;
                        const e = `bulk-${i}-${a}`;
                        n.addFile(e, l.name);
                        try {
                            const t = await gmXmlhttpRequestWithRetries({
                                method: "GET",
                                url: l.data,
                                responseType: "arraybuffer",
                                timeout: settings.zipFileDownloadTimeout,
                                onprogress: t => {
                                    (t.lengthComputable && n.updateFileProgress(e, t.loaded / t.total * 100))
                                }
                            });
                            s.file(l.name, t.response), n.markFileComplete(e, !0)
                        } catch (t) {
                            n.markFileComplete(e, !1), s.file(`failed_${l.name.split("/").pop()}`, `Failed to download file.\nURL: ${l.data}\nError: ${t.message}`)
                        } finally {
                            o--, n.updateStatus(`[${i+1}/${e.length}] Downloading... ${a+1}/${d.length} done`)
                        }
                    })());
                    await Promise.all(t)
                }
            }
            n.updateStatus(`Zipping ${e.length} Posts...`);
            const i = `${sanitizeFilename(o)}_Selected_${e.length}_Posts_${generateRandomId(6)}.zip`,
                a = await s.generateAsync({
                    type: "blob"
                }, (t => n.updateStatus(`Generating final ZIP: ${t.percent.toFixed(0)}%`)));
            GM_download({
                url: URL.createObjectURL(a),
                name: i,
                saveAs: !1
            }), n.updateStatus("Complete!")
        } catch (t) {
            console.error("Bulk download failed:", t), n.updateStatus(`Error: ${t.message}`)
        } finally {
            n.finish(), activeOperations--, t && (t.textContent = "Download Selected (0)", t.disabled = !0), document.querySelectorAll(".kdl-post-checkbox").forEach((t => t.checked = !1)), selectedPostIds.clear()
        }
    }

    async function showFilePickerModal(t) {
        const e = document.createElement("div");
        e.id = "kdl-file-picker-overlay";
        const o = document.createElement("div");
        o.id = "kdl-file-picker-modal", e.appendChild(o), o.innerHTML = "<h4>Loading attachments...</h4>", document.body.appendChild(e), e.addEventListener("click", (t => {
            t.target === e && e.remove()
        }));
        try {
            const {
                files: n
            } = await collectFilesForPost(t), s = n.filter((t => !t.isMedia && "url" === t.source));
            if (0 === s.length) return void(o.innerHTML = "<h4>No attachments found for this post.</h4>");
            o.innerHTML = '<h4>Select an attachment to download</h4><ul id="kdl-file-picker-list"></ul>';
            const i = o.querySelector("#kdl-file-picker-list");
            s.forEach((t => {
                const e = document.createElement("li"),
                    o = document.createElement("a");
                o.href = "#", o.textContent = t.name.split("/").pop(), o.dataset.url = t.data, o.dataset.name = t.name, e.appendChild(o), i.appendChild(e)
            })), i.addEventListener("click", (t => {
                t.preventDefault();
                const o = t.target.closest("a");
                o && (showMessage(`Starting download for ${o.dataset.name.split("/").pop()}`, "info"), GM_download({
                    url: o.dataset.url,
                    name: o.dataset.name,
                    saveAs: !1
                }), e.remove())
            }))
        } catch (t) {
            console.error("Error showing file picker:", t), o.innerHTML = `<h4>Failed to load attachments.</h4><p style="color:#ccc;font-size:0.9em;">${t.message}</p>`
        }
    }
    // --- DOWNLOAD & ACTION LOGIC END --- //

    // --- QUEUE MANAGEMENT START --- //
    function updateQueueIndicator() {
        if (queueIndicatorElement) queueIndicatorElement.textContent = `Active: ${activeOperations} / Queue: ${downloadQueue.length}`;
    }
    async function processQueue() {
        await getSettings();
        updateQueueIndicator();
        if (activeOperations >= settings.maxConcurrentOperations || downloadQueue.length === 0) {
            isQueueProcessing = activeOperations > 0;
            return;
        }
        isQueueProcessing = true;
        const task = downloadQueue.shift();
        updateQueueIndicator();
        if (task.buttonElement) {
            delete task.buttonElement.dataset.isQueued;
            task.buttonElement.dataset.isDownloading = 'true';
            task.buttonElement.textContent = "Working...";
        }
        debugLog(`Processing task for post ${task.postDetails.postID}, type: ${task.type}.`);
        try {
            await task.action(task.postDetails, task.buttonElement, task.buttonElement.dataset.originalText);
        } catch (error) {
            console.error("Error processing queued task:", error, task);
        } finally {
            if (task.buttonElement) {
                setTimeout(() => {
                    task.buttonElement.textContent = task.buttonElement.dataset.originalText;
                    task.buttonElement.disabled = false;
                    delete task.buttonElement.dataset.isDownloading;
                }, 3000);
            }
            activeOperations--;
            isQueueProcessing = false;
            processQueue();
        }
    }

    function addTaskToQueue(type, action, postDetails, buttonElement, originalButtonText) {
        if (buttonElement.dataset.isDownloading === 'true' || buttonElement.dataset.isQueued === 'true') {
            return;
        }
        buttonElement.dataset.isQueued = 'true';
        buttonElement.dataset.originalText = originalButtonText;
        buttonElement.textContent = "Queued";
        buttonElement.disabled = true;
        downloadQueue.push({
            type,
            action,
            postDetails,
            buttonElement
        });
        updateQueueIndicator();
        if (!isQueueProcessing) processQueue();
    }
    // --- QUEUE MANAGEMENT END --- //

    // --- UI CREATION & INJECTION START --- //
    async function handlePageContent() {
        try {
            await getSettings();
            await loadJSZip();
            cachedPostFiles = null;
            originalPostContentHTML = null;
            selectedPostIds.clear();
            document.querySelectorAll('.kdl-button, .post-card-download-controls, #kdl-bulk-panel, .kdl-post-checkbox').forEach(el => el.remove());

            if (window.location.pathname.includes('/post/')) {
                const actionsDiv = document.querySelector('.post__actions') || document.querySelector('.post__header').appendChild(Object.assign(document.createElement('div'), {
                    className: 'post__actions'
                }));
                const favButton = Array.from(actionsDiv.querySelectorAll('button, a')).find(b => b.textContent.includes('Favorite'));
                createAndInsertPostPageButtons(actionsDiv, favButton);
                fetchAndCachePostData();
            } else if (window.location.pathname.includes('/user/')) {
                createBulkDownloadPanel();
                const pageAuthorName = document.querySelector('.user-header__name span[itemprop="name"]')?.textContent.trim() || 'UnknownAuthor';

                document.querySelectorAll('article.post-card[data-id]').forEach(card => {
                    injectPostCardButtons(card, pageAuthorName);
                    injectCheckbox(card);

                    card.addEventListener('click', (event) => {
                        if (event.ctrlKey) {
                            event.preventDefault();
                            event.stopPropagation();
                            const checkbox = card.querySelector('.kdl-post-checkbox');
                            if (checkbox) {
                                checkbox.click();
                            }
                        }
                    });
                });
            }
        } catch (error) {
            console.error("Error during page content handling:", error);
        }
    }
    async function createAndInsertPostPageButtons(container, referenceElement) {
        await getSettings();
        document.querySelectorAll('.kdl-button').forEach(el => el.remove());
        const btnStyle = {
            padding: '8px 12px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.9em',
            color: '#fff',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
        };
        const postDetails = getPostDetailsFromPage();
        const fragment = document.createDocumentFragment();
        const createButton = (text, ariaLabel, style, clickHandler, contextMenuHandler) => {
            const btn = document.createElement('button');
            btn.textContent = text;
            btn.classList.add('kdl-button');
            if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
            Object.assign(btn.style, btnStyle, style);
            if (clickHandler) btn.addEventListener('click', clickHandler);
            if (contextMenuHandler) btn.addEventListener('contextmenu', contextMenuHandler);
            return btn;
        };

        if (settings.showTranslateButton && settings.translationProvider !== 'none' && (settings.geminiApiKey || settings.deeplApiKey)) {
            fragment.appendChild(createButton("Translate 📝", "Translate", {
                backgroundColor: '#5856d6'
            }, (e) => executeTranslation(e.target)));
        }
        if (settings.showCopyLinksButton) {
            const btn = createButton("Copy Links", "Copy Links", {
                backgroundColor: '#17a2b8'
            }, (e) => executeLinkAction('copy-aria', postDetails, e.target, "Copy Links"), (e) => {
                e.preventDefault();
                executeLinkAction('download-txt', postDetails, e.target, "Copy Links");
            });
            btn.title = "Left-click: Copy for aria2c/IDM. Right-click: Get .txt for ADM.";
            fragment.appendChild(btn);
        }
        if (settings.showShareButton && navigator.share) {
            const btn = createButton("Share Links", "Share Links", {
                backgroundColor: '#6f42c1'
            }, (e) => executeLinkAction('share', postDetails, e.target, "Share Links"));
            fragment.appendChild(btn);
        }
        if (settings.showImagesButton) {
            const btn = createButton("Download Images", "Download Images", {
                backgroundColor: '#007bff'
            }, (e) => addTaskToQueue('Images', (pd) => executeIndividualDownload('Images', pd), postDetails, e.target, "Download Images"));
            fragment.appendChild(btn);
        }
        if (settings.showFilesButton) {
            const btn = createButton("Download Attachments", "Download Attachments", {
                backgroundColor: '#ffc107',
                color: '#212529'
            }, (e) => addTaskToQueue('Attachments', (pd) => executeIndividualDownload('Attachments', pd), postDetails, e.target, "Download Attachments"));
            fragment.appendChild(btn);
        }
        if (settings.showZipButton) {
            const btn = createButton("Download (ZIP)", "Download (ZIP)", {
                backgroundColor: '#28a745'
            }, (e) => addTaskToQueue('ZIP', executeZipDownload, postDetails, e.target, "Download (ZIP)"));
            fragment.appendChild(btn);
        }
        container.insertBefore(fragment, referenceElement ? referenceElement.nextSibling : container.firstChild);
    }

    async function injectPostCardButtons(postCardNode, pageAuthorName) {
        await getSettings();
        if (postCardNode.querySelector('.post-card-download-controls')) return;
        const details = getPostCardDetails(postCardNode, pageAuthorName);
        if (details.postID === 'UnknownPostID') return;

        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'post-card-download-controls';

        const createMiniButton = (text, title, className, clickHandler) => {
            const btn = document.createElement('button');
            btn.innerHTML = text;
            btn.title = title;
            btn.className = className;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                clickHandler(btn);
            });
            controlsContainer.appendChild(btn);
        };

        if (settings.showZipButton) {
            createMiniButton('ZIP', 'Download ZIP', 'post-card-dl-zip', (btn) => addTaskToQueue('ZIP', executeZipDownload, details, btn, 'ZIP'));
        }
        if (settings.showImagesButton) {
            createMiniButton('Imgs', 'Download Images', 'post-card-dl-img', (btn) => addTaskToQueue('Images', (pd) => executeIndividualDownload('Images', pd), details, btn, 'Imgs'));
        }
        if (settings.showFilesButton) {
            createMiniButton('Attach.', 'Download Attachments', 'post-card-dl-att', (btn) => addTaskToQueue('Attachments', (pd) => executeIndividualDownload('Attachments', pd), details, btn, 'Attach.'));
            createMiniButton('📎', 'Pick & Download Attachment', 'post-card-dl-pick', () => showFilePickerModal(details));
        }

        if (controlsContainer.hasChildNodes()) {
            const tooltip = document.createElement('div');
            tooltip.className = 'kdl-post-info-tooltip';
            postCardNode.appendChild(tooltip);

            const infoBtn = document.createElement('button');
            infoBtn.innerHTML = 'ℹ️';
            infoBtn.title = 'Show post info';
            infoBtn.className = 'post-card-dl-info';

            let isFetching = false;

            infoBtn.addEventListener('mouseover', async () => {
                tooltip.style.display = 'block';
                if (postCardNode.dataset.postInfo) {
                    tooltip.innerHTML = postCardNode.dataset.postInfo;
                    return;
                }
                if (isFetching) return;
                isFetching = true;
                tooltip.innerHTML = '<em>Loading...</em>';

                try {
                    const apiResponse = await fetchPostDataFromAPI(details.service, details.userID, details.postID);
                    const post = apiResponse?.post || (Array.isArray(apiResponse) ? apiResponse[0] : apiResponse);
                    if (!post) throw new Error("No post data");

                    const fileCount = (post.file ? 1 : 0);
                    const attachmentCount = (post.attachments ? post.attachments.length : 0);
                    const totalFiles = fileCount + attachmentCount;

                    const infoHTML = `
                    <b>Title:</b> ${post.title}<br>
                    <b>Published:</b> ${new Date(post.published).toLocaleDateString()}<br>
                    <b>Total Files:</b> ${totalFiles}<br>
                    <em>(${attachmentCount} attachments, ${fileCount} main file)</em>
                `;
                    tooltip.innerHTML = infoHTML;
                    postCardNode.dataset.postInfo = infoHTML;
                } catch (err) {
                    const errorHTML = '<em>Failed to load info.</em>';
                    tooltip.innerHTML = errorHTML;
                    postCardNode.dataset.postInfo = errorHTML;
                } finally {
                    isFetching = false;
                }
            });

            infoBtn.addEventListener('mouseout', () => {
                tooltip.style.display = 'none';
            });

            controlsContainer.appendChild(infoBtn);
        }

        if (controlsContainer.hasChildNodes()) postCardNode.appendChild(controlsContainer);
    }

    function createBulkDownloadPanel() {
        if (document.getElementById('kdl-bulk-panel')) return;
        const cardList = document.querySelector('.card-list');
        if (!cardList) return;
        const panel = document.createElement('div');
        panel.id = 'kdl-bulk-panel';

        const sortLabel = document.createElement('label');
        sortLabel.textContent = 'Order: ';
        sortLabel.style.color = '#fff';
        sortLabel.style.fontSize = '0.9em';

        const sortSelect = document.createElement('select');
        sortSelect.id = 'kdl-bulk-sort-order';
        sortSelect.innerHTML = `
        <option value="selection">By Selection</option>
        <option value="oldest">Oldest First</option>
        <option value="newest">Newest First</option>
    `;
        sortSelect.style.backgroundColor = '#444';
        sortSelect.style.color = '#fff';
        sortSelect.style.border = '1px solid #555';
        sortSelect.style.borderRadius = '4px';
        sortSelect.style.padding = '4px';

        const downloadBtn = document.createElement('button');
        downloadBtn.id = 'kdl-bulk-download-btn';
        downloadBtn.textContent = 'Download Selected (0)';
        downloadBtn.disabled = true;
        downloadBtn.addEventListener('click', executeBulkDownload);

        const selectAllBtn = document.createElement('button');
        selectAllBtn.id = 'kdl-bulk-select-all';
        selectAllBtn.textContent = 'Select All';
        selectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('article.post-card[data-id] .kdl-post-checkbox:not(:checked)').forEach(cb => {
                cb.click();
            });
        });

        const deselectAllBtn = document.createElement('button');
        deselectAllBtn.id = 'kdl-bulk-deselect-all';
        deselectAllBtn.textContent = 'Deselect All';
        deselectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('article.post-card[data-id] .kdl-post-checkbox:checked').forEach(cb => {
                cb.click();
            });
        });

        panel.append(selectAllBtn, deselectAllBtn, sortLabel, sortSelect, downloadBtn);
        cardList.parentElement.insertBefore(panel, cardList);
    }

    function injectCheckbox(postCardNode) {
        if (postCardNode.querySelector('.kdl-post-checkbox')) return;
        const postId = postCardNode.dataset.id;
        if (!postId) return;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'kdl-post-checkbox';
        checkbox.dataset.id = postId;
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                selectedPostIds.add(postId);
            } else {
                selectedPostIds.delete(postId);
            }
            const btn = document.getElementById('kdl-bulk-download-btn');
            if (btn) {
                btn.textContent = `Download Selected (${selectedPostIds.size})`;
                btn.disabled = selectedPostIds.size === 0;
            }
        });
        postCardNode.appendChild(checkbox);
    }

    function createFixedControls() {
        if (document.getElementById('kdl-fixed-controls')) return;
        const c = document.createElement('div');
        c.id = 'kdl-fixed-controls';
        queueIndicatorElement = document.createElement('div');
        queueIndicatorElement.id = 'kdl-queue-indicator';
        updateQueueIndicator();
        const s = document.createElement('button');
        s.id = 'kdl-settings-btn';
        s.innerHTML = '⚙️';
        s.title = 'Kemono Downloader Settings';
        s.addEventListener('click', () => toggleSettingsModal());
        c.appendChild(queueIndicatorElement);
        c.appendChild(s);
        document.body.appendChild(c);
    }
    async function toggleSettingsModal(forceShow) {
        await getSettings();
        if (!settingsModalElement) {
            createSettingsModal();
        }
        const isCurrentlyHidden = settingsOverlayElement.style.display === 'none' || !settingsOverlayElement.style.display;
        const displayState = (typeof forceShow === 'boolean') ? forceShow : isCurrentlyHidden;

        if (displayState) {
            updateSettingsModalUI();
            settingsOverlayElement.style.display = 'flex';
        } else {
            settingsOverlayElement.style.display = 'none';
        }
    }

    function createSettingsModal() {
        if (settingsModalElement) return;
        settingsOverlayElement = document.createElement('div');
        settingsOverlayElement.id = 'kdl-settings-overlay';
        settingsModalElement = document.createElement('div');
        settingsModalElement.id = 'kdl-settings-modal';

        const languageOptions = Object.entries(langCodeMap)
            .map(([name, code]) => `<option value="${name}">${name.charAt(0).toUpperCase() + name.slice(1)}</option>`)
            .join('');

        // ИЗМЕНЕНИЕ: Обновляем описание для fileNameTemplate
        settingsModalElement.innerHTML = `
<div id="kdl-settings-modal-content">
    <h2>Downloader Settings</h2>

    <h3>General</h3>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-enableAPIFetch"> Enable Site API Fetching</label></div>
    <div class="kdl-setting-item"><label>Session Cookie <input type="password" id="kdl-setting-sessionCookie" placeholder="Paste session cookie here"></label><small>Needed for API requests that require login.</small></div>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-savePostContentAsText"> Save Post Content as .txt in ZIP</label></div>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-addMetadataFile"> Add metadata.json to ZIP</label></div>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-savePostTags"> Add tags.txt to ZIP</label></div>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-savePostComments"> Add comments.txt to ZIP</label></div>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-enableDebugLogging"> Enable Debug Logging (Console)</label></div>

    <h3>File Naming</h3>
    <div class="kdl-setting-item">
        <label for="kdl-setting-fileNameTemplate">File & Folder Name Template</label>
        <input type="text" id="kdl-setting-fileNameTemplate">
        <small><b>Placeholders:</b> {author_name}, {post_title}, {post_id}, {user_id}, {service}, {post_date}, {file_name}, {file_ext}, {file_name_no_ext}<br>
               <b>Counters:</b> {file_index} (per post), {bulk_post_index} (post # in batch), {bulk_file_index} (file # in batch)</small>
    </div>

    <h3>Visible Buttons</h3>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-showZipButton"> Download (ZIP)</label></div>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-showImagesButton"> Download Images</label></div>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-showFilesButton"> Download Attachments</label></div>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-showCopyLinksButton"> Copy Links</label></div>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-showShareButton"> Share Links (Mobile)</label></div>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-showTranslateButton"> Translate Button</label></div>

    <h3>Downloads</h3>
    <div class="kdl-setting-item"><label for="kdl-setting-maxConcurrentIndividualDownloads">Max Concurrent "Images/Files" Downloads</label><input type="number" id="kdl-setting-maxConcurrentIndividualDownloads" min="1" max="10"></div>
    <div class="kdl-setting-item"><label for="kdl-setting-zipFileDownloadTimeout">File Timeout in ZIP (ms)</label><input type="number" id="kdl-setting-zipFileDownloadTimeout" min="10000" step="1000"><small>Time to wait for a single file before retrying.</small></div>
    <div class="kdl-setting-item"><label><input type="checkbox" id="kdl-setting-enableDownloadRetries"> Enable Download Retries on Failure</label></div>
    <div class="kdl-setting-item" id="kdl-retry-count-setting"><label for="kdl-setting-downloadRetryCount">Number of Retries</label><input type="number" id="kdl-setting-downloadRetryCount" min="0" max="5"></div>
    <div class="kdl-setting-item" id="kdl-retry-delay-setting"><label for="kdl-setting-downloadRetryDelay">Delay Between Retries (ms)</label><input type="number" id="kdl-setting-downloadRetryDelay" min="500" step="500"></div>

    <h3>Translation</h3>
    <div class="kdl-setting-item">
        <label for="kdl-setting-translationProvider">Translation Provider</label>
        <select id="kdl-setting-translationProvider">
            <option value="none">None</option>
            <option value="gemini">Gemini</option>
            <option value="deepl">DeepL</option>
            <option value="yandex">Yandex (Free)</option>
            <option value="google">Google (Free)</option>
        </select>
    </div>
    <div class="kdl-setting-item">
        <label for="kdl-setting-translationLanguage">Translate to Language</label>
        <select id="kdl-setting-translationLanguage">${languageOptions}</select>
    </div>
    <div id="kdl-gemini-settings" style="display:none;"><h4>Gemini Settings</h4><div class="kdl-setting-item"><label for="kdl-setting-geminiApiKey">Gemini API Key</label><input type="password" id="kdl-setting-geminiApiKey" placeholder="Paste your API key here"></div><div class="kdl-setting-item"><label for="kdl-setting-translationModelName">Model Name</label><input type="text" id="kdl-setting-translationModelName"></div></div>
    <div id="kdl-deepl-settings" style="display:none;"><h4>DeepL Settings</h4><div class="kdl-setting-item"><label for="kdl-setting-deeplApiKey">DeepL API Key</label><input type="password" id="kdl-setting-deeplApiKey" placeholder="Paste your API key here"></div><div class="kdl-setting-item"><label for="kdl-setting-deeplApiTier">API Tier</label><select id="kdl-setting-deeplApiTier"><option value="free">Free</option><option value="pro">Pro</option></select></div></div>
</div>
<div class="kdl-settings-actions"><button class="kdl-close">Close</button><button class="kdl-save">Save</button></div>
`;

        settingsOverlayElement.appendChild(settingsModalElement);
        document.body.appendChild(settingsOverlayElement);
        settingsModalElement.querySelector('.kdl-save').addEventListener('click', saveSettingsFromModal);
        settingsModalElement.querySelector('.kdl-close').addEventListener('click', () => toggleSettingsModal(false));
        settingsOverlayElement.addEventListener('click', (e) => {
            if (e.target === settingsOverlayElement) toggleSettingsModal(false);
        });
        document.getElementById('kdl-setting-translationProvider').addEventListener('change', toggleTranslatorSettingsVisibility);
        document.getElementById('kdl-setting-enableDownloadRetries').addEventListener('change', toggleRetrySettingsVisibility);
    }

    function updateSettingsModalUI() {
        if (!settingsModalElement) return;
        for (const key in settings) {
            const element = document.getElementById(`kdl-setting-${key}`);
            if (element) {
                if (element.type === 'checkbox') element.checked = settings[key];
                else element.value = settings[key];
            }
        }
        toggleTranslatorSettingsVisibility();
        toggleRetrySettingsVisibility();
    }

    function toggleTranslatorSettingsVisibility() {
        if (!document.getElementById('kdl-setting-translationProvider')) return;
        const provider = document.getElementById('kdl-setting-translationProvider').value;
        document.getElementById('kdl-gemini-settings').style.display = provider === 'gemini' ? 'block' : 'none';
        document.getElementById('kdl-deepl-settings').style.display = provider === 'deepl' ? 'block' : 'none';
    }

    const yandexFreeTranslator = {
        session_data: null,
        api_url_base: "https://translate.yandex.net/api/v1/tr.json",
        origin: "https://translate.yandex.ru",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36",
            "Referer": "https://translate.yandex.ru",
            "Origin": "https://translate.yandex.ru",
        },

        _getTimestampSeconds: () => Math.floor(Date.now() / 1000),
        _genUid: () => String(Math.floor(Math.random() * 10 ** 19)),
        _genMetrikaUid: () => String(Date.now() * 1000000),

        _getSecure: function (srv) {
            return `srv=${srv}&yu=${this._genUid()}&yum=${this._genMetrikaUid()}`;
        },

        _createSession: async function () {
            const paramsStr = this._getSecure("tr-text");
            const response = await gmXmlhttpRequestWithRetries({
                method: "POST",
                url: `https://translate.yandex.ru/props/api/v1.0/sessions?${paramsStr}`,
                responseType: "json"
            });
            const data = response.response;
            if (!data || !data.session || !data.session.id) throw new Error("Yandex: Failed to create session");
            this.session_data = {
                id: data.session.id,
                creation_timestamp: this._getTimestampSeconds(),
                max_age: data.session.maxAge,
            };
            return this.session_data;
        },

        getSession: async function () {
            if (this.session_data) {
                const isExpired = (this.session_data.creation_timestamp + this.session_data.max_age - 60) <= this._getTimestampSeconds();
                if (!isExpired) return this.session_data;
            }
            return await this._createSession();
        },

        translate: async function (textLines, targetLang, sourceLang = 'auto') {
            const session = await this.getSession();
            const sid = `${session.id}-5-0`;
            const langPair = sourceLang !== 'auto' ? `${sourceLang}-${targetLang}` : targetLang;

            const urlParams = new URLSearchParams({
                sid: sid,
                source_lang: sourceLang === 'auto' ? '' : sourceLang,
                target_lang: targetLang,
                reason: "paste",
                format: "text",
                strategy: "0",
                disable_cache: "false",
                ajax: "1"
            });

            const securityParams = this._getSecure("tr-text");
            const fullUrl = `${this.api_url_base}/translate?${urlParams.toString()}&${securityParams}`;

            const bodyParams = new URLSearchParams();
            bodyParams.append("options", "1");
            textLines.forEach(line => bodyParams.append("text", line));

            const response = await gmXmlhttpRequestWithRetries({
                method: "POST",
                url: fullUrl,
                headers: this.headers,
                data: bodyParams.toString(),
                responseType: "json"
            });
            const data = response.response;
            if (!data || !Array.isArray(data.text)) {
                throw new Error(`Yandex: Invalid response structure: ${JSON.stringify(data)}`);
            }
            return data.text;
        }
    };

    const googleFreeTranslator = {
        API_KEY: "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520",
        API_URL: "https://translate-pa.googleapis.com/v1/translateHtml",
        headers: {
            "Content-Type": "application/json+protobuf",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36"
        },

        _unescapeHtml: function (html) {
            const el = document.createElement("div");
            el.innerHTML = html;
            return el.textContent || el.innerText || "";
        },

        translate: async function (textLines, targetLang, sourceLang = 'auto') {
            const translatedLines = [];

            for (const line of textLines) {
                if (!line.trim()) {
                    translatedLines.push("");
                    continue;
                }

                const payload = [
                    [
                        [line], sourceLang, targetLang
                    ],
                    "wt_lib"
                ];

                try {
                    const response = await gmXmlhttpRequestWithRetries({
                        method: "POST",
                        url: this.API_URL,
                        headers: {
                            ...this.headers,
                            "X-Goog-API-Key": this.API_KEY
                        },
                        data: JSON.stringify(payload),
                        responseType: "json"
                    });

                    const data = response.response;
                    let translatedText = "";
                    if (data && data[0] && data[0][0]) {
                        translatedText = Array.isArray(data[0][0]) ? data[0][0][0] : data[0][0];
                    }

                    if (translatedText) {
                        translatedLines.push(this._unescapeHtml(translatedText));
                    } else {
                        translatedLines.push("");
                    }
                } catch (error) {
                    console.error("Google Translate sub-request failed for a line:", error);
                    translatedLines.push("");
                }
            }

            return translatedLines;
        }

    };

    function toggleRetrySettingsVisibility() {
        if (!document.getElementById('kdl-setting-enableDownloadRetries')) return;
        const enabled = document.getElementById('kdl-setting-enableDownloadRetries').checked;
        document.getElementById('kdl-retry-count-setting').style.display = enabled ? 'block' : 'none';
        document.getElementById('kdl-retry-delay-setting').style.display = enabled ? 'block' : 'none';
    }
    // --- UI CREATION & INJECTION END --- //

    // --- INITIALIZATION & OBSERVER START --- //
    GM_registerMenuCommand("Kemono Downloader Settings", () => toggleSettingsModal(true));

    let lastUrl = "";
    let isInitializing = false;


    const runInitializationLogic = async () => {
        if (isInitializing) {
            debugLog("Initialization already in progress, skipping.");
            return;
        }

        const currentUrl = window.location.href;
        const isPostPage = currentUrl.includes('/post/');
        const isUserPage = currentUrl.includes('/user/');

        if (!isPostPage && !isUserPage) {
            lastUrl = currentUrl;
            return;
        }

        const buttonsExist = isPostPage ? document.querySelector('.kdl-button') : document.querySelector('#kdl-bulk-panel');
        if (buttonsExist && currentUrl === lastUrl) {
            return;
        }

        isInitializing = true;
        debugLog(`Running initialization for: ${currentUrl}`);

        try {
            if (isPostPage) {
                await waitForElement('.post__actions');
            } else if (isUserPage) {
                await waitForElement('.card-list');
            }

            await handlePageContent();
            lastUrl = currentUrl;

        } catch (e) {
            console.error("Initialization failed:", e);
        } finally {
            isInitializing = false;
        }
    };

    const observer = new MutationObserver(() => {
        runInitializationLogic();
    });

    window.addEventListener('load', () => {
        getSettings().then(() => {
            createFixedControls();
            runInitializationLogic();
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    });

    window.addEventListener('popstate', () => {
        runInitializationLogic();
    });
    // --- INITIALIZATION & OBSERVER END --- //

})();