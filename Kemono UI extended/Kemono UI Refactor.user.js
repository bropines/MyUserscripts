// ==UserScript==
// @name         Kemono UI Refactor
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Architecture overhaul for SPA environments. Implemented cleanup logic to prevent state leaks between pages and fixed render race condition with requestAnimationFrame.
// @author       Gemini (AI Developer) & User
// @match        *://kemono.cr/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    // --- MODULE: STATE & CONSTANTS --- //
    const SELECTORS = {
        mainContent: 'main#main',
        sidebarCommunitySection: 'div.global-sidebar-entry.stuck-bottom',
        postGridContainer: '.card-list--legacy .card-list__items',
        postCard: 'article.post-card',
        postLink: 'article.post-card > a.fancy-link',
        postPageContainer: 'section.site-section--post',
        postBody: 'div.post__body',
        postContent: '.post__content',
        postFilesContainer: '.post__files',
        postComments: 'footer.post__footer',
        videoSection: '.kui-video-section',
    };
    const STORAGE_KEY_POSTS = 'kemono_viewed_posts';
    const STORAGE_KEY_GRID_SIZE = 'kemono_grid_size';
    const STORAGE_KEY_DEBUG_MODE = 'kui_debug_mode';

    let isDebugModeEnabled = GM_getValue(STORAGE_KEY_DEBUG_MODE, false);
    let isPostPageModuleActive = false; // Флаг, который отслеживает, активна ли наша галерея

    // --- MODULE: DEBUGGER --- //
    const debugModule = {
        init() {
            if (document.getElementById('kui-debugger')) return;
            const debuggerOverlay = document.createElement('div');
            debuggerOverlay.id = 'kui-debugger';
            GM_addStyle(`
                #kui-debugger { display: none; position: fixed; bottom: 10px; left: 10px; background-color: rgba(0,0,0,0.7); color: white; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 12px; z-index: 99999; pointer-events: none; line-height: 1.5; }
                #kui-debugger.kui-active { display: block; }
            `);
            document.body.appendChild(debuggerOverlay);
            if (isDebugModeEnabled) this.show();
        },
        update(data) {
            if (!isDebugModeEnabled) return;
            const overlay = document.getElementById('kui-debugger');
            if (!overlay) return;
            let content = '--- KUI DEBUGGER ---<br>';
            for (const key in data) {
                content += `${key.padEnd(18, ' ')}: ${data[key]}<br>`;
            }
            overlay.innerHTML = content;
            console.log('KUI DEBUGGER:', data);
        },
        hide() {
            const overlay = document.getElementById('kui-debugger');
            if (overlay) overlay.classList.remove('kui-active');
        },
        show() {
            const overlay = document.getElementById('kui-debugger');
            if (overlay) overlay.classList.add('kui-active');
        }
    };

    // --- MODULE: STYLE INJECTION --- //
    function injectStyles() {
        GM_addStyle(`
            /* --- Основные стили --- */
            #kui-settings-btn-sidebar { cursor: pointer; }
            #kui-settings-panel { position: fixed; top: 0; right: 0; width: 300px; height: 100%; background-color: #2e2e2e; border-left: 1px solid #444; box-shadow: -5px 0 15px rgba(0,0,0,0.3); z-index: 10000; transform: translateX(100%); transition: transform 0.3s ease-in-out; padding: 20px; box-sizing: border-box; color: #f0f0f0; font-family: sans-serif; }
            #kui-settings-panel.kui-panel-active { transform: translateX(0); }
            #kui-settings-panel h2 { margin-top: 0; border-bottom: 1px solid #555; padding-bottom: 10px; }
            .kui-setting { margin-top: 20px; } .kui-setting label { display: block; margin-bottom: 8px; }
            .kui-grid-size-control { display: flex; align-items: center; gap: 10px; }
            .kui-grid-size-control input[type="range"] { flex-grow: 1; }
            .kui-grid-size-control input[type="number"] { width: 60px; background-color: #3a3a3a; border: 1px solid #555; color: white; border-radius: 4px; padding: 5px; }
            .kui-viewed { opacity: 0.5; transition: opacity 0.3s ease; } .kui-viewed:hover { opacity: 0.9; }
            .kui-toggle-switch { display: flex; align-items: center; justify-content: space-between; }
            .kui-switch { position: relative; display: inline-block; width: 50px; height: 26px; }
            .kui-switch input { opacity: 0; width: 0; height: 0; }
            .kui-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #555; transition: .4s; border-radius: 26px; }
            .kui-slider:before { position: absolute; content: ""; height: 20px; width: 20px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
            input:checked + .kui-slider { background-color: #3b82f6; }
            input:checked + .kui-slider:before { transform: translateX(24px); }
            .kui-post-section { background-color: rgba(30, 30, 30, 0.5); border: 1px solid #444; border-radius: 8px; padding: 15px; margin-top: 20px; }
            .kui-post-section h2 { margin-top: 0 !important; margin-bottom: 15px !important; padding-bottom: 10px !important; border-bottom: 1px solid #555 !important; }
            .kui-gallery-layout { display: flex; gap: 15px; align-items: flex-start; max-height: 85vh; height: 85vh; }
            .kui-gallery-thumbnails { width: 200px; flex-shrink: 0; overflow-y: auto; height: 100%; padding-right: 10px; box-sizing: content-box; }
            .kui-gallery-thumbnails a { display: block; margin-bottom: 10px; border: 2px solid transparent; border-radius: 4px; transition: border-color 0.2s; }
            .kui-gallery-thumbnails a:hover img { filter: brightness(1.2); }
            .kui-gallery-thumbnails img { width: 100%; height: auto; display: block; border-radius: 2px; }
            .kui-thumb-active { border-color: #3b82f6 !important; }
            .kui-gallery-preview { flex-grow: 1; display: flex; align-items: center; justify-content: center; position: relative; background-color: transparent; border-radius: 4px; height: 100%; min-width: 0; }
            .kui-gallery-preview-image { max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in; }
            .kui-video-gallery-layout { display: flex; gap: 20px; align-items: flex-start; }
            .kui-video-list { width: 300px; flex-shrink: 0; max-height: 500px; overflow-y: auto; }
            .kui-video-list-item { padding: 10px; background-color: #3a3a3a; border-radius: 4px; margin-bottom: 8px; cursor: pointer; transition: background-color 0.2s; border: 1px solid #555; user-select: none; }
            .kui-video-list-item:hover { background-color: #4f4f4f; }
            .kui-video-item-active { background-color: #3b82f6; color: white; border-color: #3b82f6; }
            .kui-video-player-area { flex-grow: 1; min-width: 0; }
            .kui-video-player-container { position: relative; width: 100%; background-color: black; border-radius: 4px; overflow: hidden; aspect-ratio: 16 / 9; }
            #kui-main-video-player { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
            #kui-lightbox { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.85); z-index: 10001; overflow: hidden; opacity: 0; visibility: hidden; transition: opacity 0.2s, visibility 0.2s; }
            #kui-lightbox.kui-active { opacity: 1; visibility: visible; }
            #kui-lightbox-img-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
            #kui-lightbox-img { position: absolute; top: 0; left: 0; transform-origin: 0 0; cursor: grab; transition: opacity 0.15s linear; }
            #kui-lightbox-img:active { cursor: grabbing; }
            .kui-lightbox-nav { position: fixed; top: 50%; transform: translateY(-50%); width: 50px; height: 80px; background: rgba(0,0,0,0.4); color: white; border: none; font-size: 32px; cursor: pointer; z-index: 2; }
            .kui-lightbox-nav.prev { left: 15px; }
            .kui-lightbox-nav.next { right: 15px; }
            #kui-lightbox-close { position: fixed; top: 15px; right: 15px; width: 40px; height: 40px; background: rgba(0,0,0,0.4); color: white; border: none; font-size: 24px; cursor: pointer; z-index: 2; }
        `);
    }

    // --- MODULE: UI INJECTION --- //
    function injectUI() {
        const settingsPanel = document.createElement('div');
        settingsPanel.id = 'kui-settings-panel';
        settingsPanel.innerHTML = `
            <h2>Настройки UI</h2>
            <div class="kui-setting">
                <label>Размер карточек</label>
                <div class="kui-grid-size-control">
                    <input type="range" id="gridSizeSlider" min="120" max="400">
                    <input type="number" id="gridSizeInput" min="120" max="400">
                </div>
            </div>
            <div class="kui-setting">
                <div class="kui-toggle-switch">
                    <label for="debugModeToggle">Режим отладки</label>
                    <label class="kui-switch">
                        <input type="checkbox" id="debugModeToggle">
                        <span class="kui-slider"></span>
                    </label>
                </div>
            </div>
        `;
        document.body.appendChild(settingsPanel);

        const debugToggle = document.getElementById('debugModeToggle');
        debugToggle.checked = isDebugModeEnabled;
        debugToggle.addEventListener('change', () => {
            isDebugModeEnabled = debugToggle.checked;
            GM_setValue(STORAGE_KEY_DEBUG_MODE, isDebugModeEnabled);
            isDebugModeEnabled ? debugModule.show() : debugModule.hide();
        });

        const uiInterval = setInterval(() => {
            const communitySection = document.querySelector(SELECTORS.sidebarCommunitySection);
            if (communitySection && !document.getElementById('kui-settings-btn-sidebar')) {
                clearInterval(uiInterval);
                const settingsEntry = document.createElement('div');
                settingsEntry.className = 'global-sidebar-entry';
                settingsEntry.innerHTML = `<a id="kui-settings-btn-sidebar" class="global-sidebar-entry-item" href="#">UI Настройки</a>`;
                communitySection.parentNode.insertBefore(settingsEntry, communitySection);
                document.getElementById('kui-settings-btn-sidebar').addEventListener('click', e => {
                    e.preventDefault();
                    settingsPanel.classList.toggle('kui-panel-active');
                });
            }
        }, 500);

        document.addEventListener('click', e => {
            const sidebarButton = document.getElementById('kui-settings-btn-sidebar');
            if (sidebarButton && settingsPanel.classList.contains('kui-panel-active') && !settingsPanel.contains(e.target) && !sidebarButton.contains(e.target)) {
                settingsPanel.classList.remove('kui-panel-active');
            }
        });

        const lightbox = document.createElement('div');
        lightbox.id = 'kui-lightbox';
        lightbox.innerHTML = `
            <button id="kui-lightbox-close">×</button>
            <button class="kui-lightbox-nav prev">‹</button>
            <div id="kui-lightbox-img-container"><img id="kui-lightbox-img" src=""></div>
            <button class="kui-lightbox-nav next">›</button>
        `;
        document.body.appendChild(lightbox);
    }

    // --- MODULE: MAIN PAGE LOGIC --- //
    function setupGridControls() {
        const slider = document.getElementById('gridSizeSlider');
        const numberInput = document.getElementById('gridSizeInput');
        if (!slider) return;

        const updateGridSize = value => {
            const container = document.querySelector(SELECTORS.postGridContainer);
            if (!container) return;
            const safeValue = Math.max(120, Math.min(400, value));
            container.style.setProperty('--card-size', `${safeValue}px`);
            if (document.activeElement !== slider) slider.value = safeValue;
            if (document.activeElement !== numberInput) numberInput.value = safeValue;
        };
        const savedSize = GM_getValue(STORAGE_KEY_GRID_SIZE, '180');
        updateGridSize(savedSize);

        slider.addEventListener('input', () => updateGridSize(slider.value));
        numberInput.addEventListener('input', () => updateGridSize(numberInput.value));
        const saveValue = e => GM_setValue(STORAGE_KEY_GRID_SIZE, e.target.value);
        slider.addEventListener('change', saveValue);
        numberInput.addEventListener('change', saveValue);
    }

    function markViewedPosts() {
        const viewedPosts = GM_getValue(STORAGE_KEY_POSTS, {});
        document.querySelectorAll(SELECTORS.postCard).forEach(card => {
            const postId = card.getAttribute('data-id');
            if (postId && viewedPosts[postId]) {
                card.classList.add('kui-viewed');
            }
        });
    }

    function setupGlobalClickListener() {
        document.body.addEventListener('click', e => {
            const link = e.target.closest(SELECTORS.postLink);
            if (!link) return;
            const card = link.closest(SELECTORS.postCard);
            const postId = card?.getAttribute('data-id');
            if (!postId) return;
            const viewedPosts = GM_getValue(STORAGE_KEY_POSTS, {});
            viewedPosts[postId] = true;
            GM_setValue(STORAGE_KEY_POSTS, viewedPosts);
            card.classList.add('kui-viewed');
        }, true);
    }

    // --- MODULE: POST PAGE LOGIC --- //
    const postPageModule = {
        init() {
            this.restructureLayout();
            this.initializeImageGallery();
            this.initializeVideoGallery();
            document.addEventListener('keydown', this.handleGlobalKeys, true);
        },
        cleanup() {
            document.removeEventListener('keydown', this.handleGlobalKeys, true);
            const galleryLayout = document.querySelector('.kui-gallery-layout');
            if (galleryLayout) galleryLayout.remove();
            const originalFiles = document.querySelector(SELECTORS.postFilesContainer);
            if (originalFiles) originalFiles.style.display = '';
            // Сбрасываем флаги обработки, чтобы можно было запустить init заново
            const processedElements = document.querySelectorAll('.kui-processed, .kui-gallery-processed, .kui-video-gallery-processed');
            processedElements.forEach(el => el.classList.remove('kui-processed', 'kui-gallery-processed', 'kui-video-gallery-processed'));
            console.log('KUI: Post page module cleaned up.');
        },
        handleGlobalKeys(e) {
            const lightbox = document.getElementById('kui-lightbox');
            if (lightbox.classList.contains('kui-active') || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
                return;
            }
            const gallery = document.querySelector('.kui-gallery-layout');
            if (gallery && typeof gallery.navigate === 'function') {
                let direction = 0;
                if (e.key === 'ArrowLeft') direction = -1;
                if (e.key === 'ArrowRight') direction = 1;

                if (direction !== 0) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    gallery.navigate(direction);
                }
            }
        },
        restructureLayout() {
            const postBody = document.querySelector(SELECTORS.postBody);
            if (!postBody || postBody.classList.contains('kui-processed')) return;
            const findNextProperSibling = (element) => {
                let sibling = element.nextElementSibling;
                while (sibling) {
                    if (sibling.tagName !== 'SCRIPT') return sibling;
                    sibling = sibling.nextElementSibling;
                }
                return null;
            };
            const wrapGroup = (h2, content, customClass = '') => {
                if (h2 && content && !h2.parentNode.classList.contains('kui-post-section')) {
                    const wrapper = document.createElement('div');
                    wrapper.className = `kui-post-section ${customClass}`.trim();
                    h2.parentNode.insertBefore(wrapper, h2);
                    wrapper.appendChild(h2);
                    wrapper.appendChild(content);
                }
            };
            postBody.querySelectorAll('h2').forEach(h2 => {
                const title = h2.textContent.trim().toLowerCase();
                const content = findNextProperSibling(h2);
                if (!content) return;
                if (title === 'downloads' && content.matches('.post__attachments')) wrapGroup(h2, content);
                else if (title === 'content' && content.matches(SELECTORS.postContent)) wrapGroup(h2, content);
                else if (title === 'files' && content.matches(SELECTORS.postFilesContainer)) wrapGroup(h2, content);
                else if (title === 'videos' && content.tagName === 'UL') wrapGroup(h2, content, 'kui-video-section');
            });
            const comments = document.querySelector(SELECTORS.postComments);
            if (comments && !comments.closest('.kui-post-section')) {
                const wrapper = document.createElement('div');
                wrapper.className = 'kui-post-section';
                comments.parentNode.insertBefore(wrapper, comments);
                wrapper.appendChild(comments);
            }
            postBody.classList.add('kui-processed');
        },
        initializeVideoGallery() {
            const videoSection = document.querySelector(SELECTORS.videoSection);
            if (!videoSection || videoSection.classList.contains('kui-video-gallery-processed')) return;
            const originalList = videoSection.querySelector('ul');
            if (!originalList) return;
            const videosData = Array.from(originalList.querySelectorAll('li')).map(item => ({
                title: item.querySelector('summary')?.textContent || 'Untitled Video',
                src: item.querySelector('video > source')?.src
            })).filter(video => video.src);
            if (videosData.length <= 1) return;
            videoSection.classList.add('kui-video-gallery-processed');
            const galleryLayout = document.createElement('div');
            galleryLayout.className = 'kui-video-gallery-layout';
            const videoList = document.createElement('div');
            videoList.className = 'kui-video-list';
            const playerArea = document.createElement('div');
            playerArea.className = 'kui-video-player-area';
            const playerContainer = document.createElement('div');
            playerContainer.className = 'kui-video-player-container';
            const mainPlayer = document.createElement('video');
            mainPlayer.id = 'kui-main-video-player';
            mainPlayer.controls = true;
            mainPlayer.preload = 'metadata';
            playerContainer.appendChild(mainPlayer);
            playerArea.appendChild(playerContainer);
            galleryLayout.appendChild(videoList);
            galleryLayout.appendChild(playerArea);
            const listItems = [];
            const setActiveVideo = (index) => {
                mainPlayer.src = videosData[index].src;
                mainPlayer.load();
                listItems.forEach((item, idx) => item.classList.toggle('kui-video-item-active', idx === index));
            };
            videosData.forEach((video, index) => {
                const listItem = document.createElement('div');
                listItem.className = 'kui-video-list-item';
                listItem.textContent = video.title;
                listItem.addEventListener('click', () => setActiveVideo(index));
                videoList.appendChild(listItem);
                listItems.push(listItem);
            });
            videoSection.appendChild(galleryLayout);
            originalList.style.display = 'none';
            setActiveVideo(0);
        },
        initializeImageGallery() {
            const originalFilesContainer = document.querySelector(SELECTORS.postFilesContainer);
            if (!originalFilesContainer || originalFilesContainer.classList.contains('kui-gallery-processed')) return;
            const thumbnails = Array.from(originalFilesContainer.querySelectorAll('a.fileThumb'));
            if (thumbnails.length === 0) return;
            originalFilesContainer.classList.add('kui-gallery-processed');
            const galleryLayout = document.createElement('div');
            galleryLayout.className = 'kui-gallery-layout';
            const thumbList = document.createElement('div');
            thumbList.className = 'kui-gallery-thumbnails';
            const previewContainer = document.createElement('div');
            previewContainer.className = 'kui-gallery-preview';
            const previewImage = document.createElement('img');
            previewImage.className = 'kui-gallery-preview-image';
            previewContainer.appendChild(previewImage);
            galleryLayout.appendChild(thumbList);
            galleryLayout.appendChild(previewContainer);
            originalFilesContainer.closest('.kui-post-section')?.appendChild(galleryLayout);
            originalFilesContainer.style.display = 'none';
            let currentIndex = 0;
            const setActive = (index) => {
                currentIndex = (index + thumbnails.length) % thumbnails.length;
                const activeLink = thumbLinks[currentIndex];
                if (!activeLink) return;
                previewImage.src = thumbnails[currentIndex].querySelector('img').src;
                thumbLinks.forEach(link => link.classList.remove('kui-thumb-active'));
                activeLink.classList.add('kui-thumb-active');
                activeLink.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest'
                });
            };
            galleryLayout.navigate = (direction) => setActive(currentIndex + direction);
            const thumbLinks = thumbnails.map((thumbLink, index) => {
                const newThumb = thumbLink.querySelector('img').cloneNode(true);
                const newThumbLink = document.createElement('a');
                newThumbLink.href = '#';
                newThumbLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    setActive(index);
                });
                newThumbLink.appendChild(newThumb);
                thumbList.appendChild(newThumbLink);
                return newThumbLink;
            });
            const lightboxModule = (() => {
                const lightbox = document.getElementById('kui-lightbox');
                const imgContainer = document.getElementById('kui-lightbox-img-container');
                const lightboxImg = document.getElementById('kui-lightbox-img');
                const btnClose = document.getElementById('kui-lightbox-close');
                const btnPrev = lightbox.querySelector('.prev');
                const btnNext = lightbox.querySelector('.next');
                let scale = 1,
                    panning = false,
                    pointX = 0,
                    pointY = 0,
                    start = {
                        x: 0,
                        y: 0
                    };
                let naturalWidth = 0,
                    naturalHeight = 0;
                let animationFrameId = null;
                const updateTransform = () => {
                    lightboxImg.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
                    animationFrameId = null;
                };
                const requestUpdate = () => {
                    if (!animationFrameId) animationFrameId = requestAnimationFrame(updateTransform);
                };
                const open = (index) => {
                    setActive(index);
                    if (isDebugModeEnabled) debugModule.show();
                    debugModule.update({
                        event: "open sequence start"
                    });
                    lightboxImg.style.transform = '';
                    lightboxImg.style.opacity = 0;
                    lightbox.classList.add('kui-active');
                    document.addEventListener('keydown', handleKeydown, true);
                    const img = new Image();
                    img.onload = () => {
                        naturalWidth = img.naturalWidth;
                        naturalHeight = img.naturalHeight;
                        lightboxImg.src = img.src;
                        requestAnimationFrame(() => {
                            resetToFit();
                            lightboxImg.style.opacity = 1;
                        });
                    };
                    img.src = thumbnails[currentIndex].href;
                };
                const close = () => {
                    lightbox.classList.remove('kui-active');
                    document.removeEventListener('keydown', handleKeydown, true);
                    lightboxImg.src = 'about:blank'; // Предотвращаем показ старого кадра
                    if (isDebugModeEnabled) debugModule.hide();
                };
                const resetToFit = () => {
                    if (!naturalWidth || !naturalHeight) return;
                    const containerWidth = imgContainer.clientWidth;
                    const containerHeight = imgContainer.clientHeight;
                    scale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight, 1);
                    pointX = (containerWidth - naturalWidth * scale) / 2;
                    pointY = (containerHeight - naturalHeight * scale) / 2;
                    debugModule.update({
                        event: "resetToFit calculated",
                        naturalW: naturalWidth,
                        naturalH: naturalHeight,
                        containerW: containerWidth,
                        containerH: containerHeight,
                        scale: scale.toFixed(4),
                        pointX: pointX.toFixed(2),
                        pointY: pointY.toFixed(2),
                    });
                    requestUpdate();
                };
                const navigateLightbox = (direction) => open(currentIndex + direction);
                const handleKeydown = (e) => {
                    if (e.key === 'Escape') close();
                    if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        navigateLightbox(-1);
                    }
                    if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        navigateLightbox(1);
                    }
                };
                btnClose.addEventListener('click', close);
                lightbox.addEventListener('click', (e) => {
                    if (e.target === lightbox) close();
                });
                btnPrev.addEventListener('click', (e) => {
                    e.stopPropagation();
                    navigateLightbox(-1);
                });
                btnNext.addEventListener('click', (e) => {
                    e.stopPropagation();
                    navigateLightbox(1);
                });
                imgContainer.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    panning = true;
                    start = {
                        x: e.clientX - pointX,
                        y: e.clientY - pointY
                    };
                    lightboxImg.style.cursor = 'grabbing';
                });
                window.addEventListener('mouseup', () => {
                    panning = false;
                    lightboxImg.style.cursor = 'grab';
                });
                window.addEventListener('mousemove', (e) => {
                    if (!panning) return;
                    e.preventDefault();
                    pointX = e.clientX - start.x;
                    pointY = e.clientY - start.y;
                    requestUpdate();
                });
                imgContainer.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    const rect = imgContainer.getBoundingClientRect();
                    const xs = (e.clientX - rect.left - pointX) / scale;
                    const ys = (e.clientY - rect.top - pointY) / scale;
                    const delta = -e.deltaY;
                    const factor = delta > 0 ? 1.1 : 1 / 1.1;
                    scale = Math.min(Math.max(0.1, scale * factor), 20);
                    pointX = (e.clientX - rect.left) - xs * scale;
                    pointY = (e.clientY - rect.top) - ys * scale;
                    requestUpdate();
                });
                return {
                    open
                };
            })();
            previewImage.addEventListener('click', () => lightboxModule.open(currentIndex));
            setActive(0);
        }
    };

    // --- MODULE: SPA ENGINE & INITIALIZATION --- //
    const observer = new MutationObserver(() => {
        runPageLogic();
    });

    function runPageLogic() {
        const isOnPostPage = !!document.querySelector(SELECTORS.postPageContainer);

        if (isOnPostPage) {
            if (!isPostPageModuleActive) {
                postPageModule.init();
                isPostPageModuleActive = true;
            }
        } else {
            if (isPostPageModuleActive) {
                postPageModule.cleanup();
                isPostPageModuleActive = false;
            }
        }

        // Логика для главной страницы/списка постов
        if (document.querySelector(SELECTORS.postGridContainer)) {
            setupGridControls();
            markViewedPosts();
        }
    }

    function startApp() {
        debugModule.init();
        injectStyles();
        injectUI();
        setupGlobalClickListener();

        const mainInterval = setInterval(() => {
            const mainContent = document.querySelector(SELECTORS.mainContent);
            if (mainContent) {
                clearInterval(mainInterval);
                runPageLogic(); // Первый запуск
                observer.observe(mainContent, {
                    childList: true,
                    subtree: true
                });
            }
        }, 200);
    }

    startApp();

})();