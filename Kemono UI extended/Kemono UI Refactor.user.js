// ==UserScript==
// @name         Kemono UI Refactor
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  FIX: Rewrote the embed link processing function to be less destructive. It no longer strips all <br> tags from the post content, preserving original text formatting and line breaks.
// @author       Gemini (AI Developer) & bropines
// @icon         https://kemono.cr/static/favicon.ico
// @match        *://kemono.cr/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_getResourceText
// @require      https://cdn.plyr.io/3.7.8/plyr.js
// @resource     plyrCSS https://cdn.plyr.io/3.7.8/plyr.css
// ==/UserScript==

(function () {
	"use strict";

	// --- MODULE: STATE & CONSTANTS --- //
	const SELECTORS = {
		mainContent: "main#main",
		sidebarCommunitySection: "div.global-sidebar-entry.stuck-bottom",
		postGridContainer: ".card-list--legacy .card-list__items",
		postCard: "article.post-card",
		postLink: "article.post-card > a.fancy-link",
		postPageContainer: "section.site-section--post",
		postBody: "div.post__body",
		postContent: ".post__content",
		postFilesContainer: ".post__files",
		postComments: "footer.post__footer",
		userHeaderName: "h1.user-header__name",
		videoSection: ".kui-video-section",
	};
	const STORAGE_KEY_POSTS = "kemono_viewed_posts";
	const STORAGE_KEY_GRID_SIZE = "kemono_grid_size";
	const STORAGE_KEY_DEBUG_MODE = "kui_debug_mode";
	const STORAGE_KEY_EMBED_RULES = "kui_embed_rules";
	const STORAGE_KEY_VERBOSE_DEBUG = "kui_verbose_debug";
	const STORAGE_KEY_SESSION_KEY = "kui_session_key";
	const STORAGE_KEY_PRELOAD_IMAGES = "kui_preload_images";

	let isDebugModeEnabled = GM_getValue(STORAGE_KEY_DEBUG_MODE, false);
	let isVerboseDebugEnabled = GM_getValue(STORAGE_KEY_VERBOSE_DEBUG, false);
	let isPreloadEnabled = GM_getValue(STORAGE_KEY_PRELOAD_IMAGES, false);
	let isPostPageModuleActive = false;
	let embedRules = GM_getValue(STORAGE_KEY_EMBED_RULES, {});
	let sessionKey = GM_getValue(STORAGE_KEY_SESSION_KEY, "");

	// --- MODULE: DEBUGGER --- //
	const debugModule = {
		init() {
			if (document.getElementById("kui-debugger")) return;
			const debuggerOverlay = document.createElement("div");
			debuggerOverlay.id = "kui-debugger";
			GM_addStyle(`
                #kui-debugger { display: none; position: fixed; bottom: 10px; left: 10px; background-color: rgba(0,0,0,0.7); color: white; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 12px; z-index: 99999; pointer-events: none; line-height: 1.5; }
                #kui-debugger.kui-active { display: block; }
            `);
			document.body.appendChild(debuggerOverlay);
			if (isDebugModeEnabled) this.show();
		},
		update(data) {
			if (!isDebugModeEnabled) return;
			const overlay = document.getElementById("kui-debugger");
			if (!overlay) return;
			let content = "--- KUI DEBUGGER ---<br>";
			for (const key in data) {
				content += `${key.padEnd(18, " ")}: ${data[key]}<br>`;
			}
			overlay.innerHTML = content;
		},
		hide() {
			const overlay = document.getElementById("kui-debugger");
			if (overlay) overlay.classList.remove("kui-active");
		},
		show() {
			const overlay = document.getElementById("kui-debugger");
			if (overlay) overlay.classList.add("kui-active");
		},
	};

	// --- MODULE: LIGHTBOX (SELF-CONTAINED) --- //
	const lightboxModule = {
		lightbox: null,
		imgContainer: null,
		canvas: null,
		lightboxImg: null,
		btnClose: null,
		btnPrev: null,
		btnNext: null,
		btnLens: null,
		isActive: false,
		currentImages: [],
		currentIndex: 0,
		scale: 1,
		panning: false,
		pointX: 0,
		pointY: 0,
		start: {
			x: 0,
			y: 0
		},
		naturalWidth: 0,
		naturalHeight: 0,
		touchStartX: 0,
		touchPanning: false,
		initialDistance: 0,
		create() {
			const lightboxEl = document.createElement("div");
			lightboxEl.id = "kui-lightbox";
			lightboxEl.innerHTML = `
                <div class="kui-lightbox-top-actions">
                    <a id="kui-lightbox-lens-btn" href="#" target="_blank" rel="noopener noreferrer" title="Искать в Google Lens">
                        <svg viewBox="0 0 24 24"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12H18A6,6 0 0,0 12,6V4M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"></path></svg>
                    </a>
                    <button id="kui-lightbox-close">×</button>
                </div>
                <button class="kui-lightbox-nav prev">‹</button>
                <div id="kui-lightbox-img-container">
                    <div id="kui-image-canvas">
                        <img id="kui-lightbox-img" src="">
                    </div>
                </div>
                <button class="kui-lightbox-nav next">›</button>
            `;
			document.body.appendChild(lightboxEl);
		},
		init() {
			if (document.getElementById("kui-lightbox")) return;
			this.create();
			this.lightbox = document.getElementById("kui-lightbox");
			this.imgContainer = document.getElementById("kui-lightbox-img-container");
			this.canvas = document.getElementById("kui-image-canvas");
			this.lightboxImg = document.getElementById("kui-lightbox-img");
			this.btnClose = document.getElementById("kui-lightbox-close");
			this.btnPrev = this.lightbox.querySelector(".prev");
			this.btnNext = this.lightbox.querySelector(".next");
			this.btnLens = document.getElementById("kui-lightbox-lens-btn");
			this.bindEvents();
		},
		bindEvents() {
			this.handleKeydown = this.handleKeydown.bind(this);
			this.handleMouseUp = this.handleMouseUp.bind(this);
			this.handleMouseMove = this.handleMouseMove.bind(this);
			this.handleTouchStart = this.handleTouchStart.bind(this);
			this.handleTouchMove = this.handleTouchMove.bind(this);
			this.handleTouchEnd = this.handleTouchEnd.bind(this);
			this.btnClose.addEventListener("click", () => this.close());
			this.lightbox.addEventListener("click", (e) => {
				if (e.target !== this.canvas && e.target !== this.lightboxImg)
					this.close();
			});
			this.btnPrev.addEventListener("click", (e) => {
				e.stopPropagation();
				this.navigate(-1);
			});
			this.btnNext.addEventListener("click", (e) => {
				e.stopPropagation();
				this.navigate(1);
			});
			this.canvas.addEventListener("mousedown", (e) => this.handleMouseDown(e));
			this.imgContainer.addEventListener("wheel", (e) => this.handleWheel(e));
			this.imgContainer.addEventListener("touchstart", this.handleTouchStart, {
				passive: false,
			});
			this.imgContainer.addEventListener("touchmove", this.handleTouchMove, {
				passive: false,
			});
			this.imgContainer.addEventListener("touchend", this.handleTouchEnd);
			window.addEventListener("mousemove", this.handleMouseMove);
			window.addEventListener("mouseup", this.handleMouseUp);
		},
		loadImage: (src) =>
			new Promise((resolve, reject) => {
				const img = new Image();
				img.onload = () => resolve(img);
				img.onerror = reject;
				img.src = src;
			}),
		updateTransform() {
			this.canvas.style.transform = `translate(${this.pointX}px, ${this.pointY}px) scale(${this.scale})`;
		},
		requestUpdate() {
			requestAnimationFrame(() => this.updateTransform());
		},
		async open(images, index) {
			if (!images || images.length === 0) return;
			this.currentImages = images;
			this.isActive = true;
			if (isDebugModeEnabled) debugModule.show();
			this.lightbox.classList.add("kui-active");
			document.addEventListener("keydown", this.handleKeydown, true);
			this.displayImage(index);
		},
		async displayImage(index) {
			this.currentIndex =
				(index + this.currentImages.length) % this.currentImages.length;
			this.canvas.style.opacity = 0;
			try {
				const imageSrc = this.currentImages[this.currentIndex].href;
				const originalLink =
					this.currentImages[this.currentIndex].dataset.originalPath ||
					imageSrc;

				this.btnLens.href = `https://lens.google.com/v3/upload?url=${encodeURIComponent(originalLink)}`;
				this.btnLens.title = "Search in Google Lens";

				const img = await this.loadImage(imageSrc);
				this.naturalWidth = img.naturalWidth;
				this.naturalHeight = img.naturalHeight;
				this.canvas.style.width = this.naturalWidth + "px";
				this.canvas.style.height = this.naturalHeight + "px";
				requestAnimationFrame(() => {
					this.resetToFit();
					this.lightboxImg.src = img.src;
					this.canvas.style.opacity = 1;
				});
			} catch (error) {
				console.error("KUI: Image failed to load.", error);
				this.close();
			}
		},
		close() {
			if (!this.isActive) return;
			this.isActive = false;
			this.lightbox.classList.remove("kui-active");
			document.removeEventListener("keydown", this.handleKeydown, true);
			this.lightboxImg.src = "about:blank";
			if (isDebugModeEnabled) debugModule.hide();
		},
		resetToFit() {
			if (!this.naturalWidth || !this.naturalHeight) return;
			const containerWidth = this.imgContainer.clientWidth;
			const containerHeight = this.imgContainer.clientHeight;
			this.scale = Math.min(
				containerWidth / this.naturalWidth,
				containerHeight / this.naturalHeight,
				1,
			);
			this.pointX = (containerWidth - this.naturalWidth * this.scale) / 2;
			this.pointY = (containerHeight - this.naturalHeight * this.scale) / 2;
			this.updateTransform();
		},
		navigate(direction) {
			this.displayImage(this.currentIndex + direction);
		},
		handleKeydown(e) {
			if (e.key === "Escape") this.close();
			if (e.key === "ArrowLeft") {
				e.preventDefault();
				e.stopImmediatePropagation();
				this.navigate(-1);
			}
			if (e.key === "ArrowRight") {
				e.preventDefault();
				e.stopImmediatePropagation();
				this.navigate(1);
			}
		},
		handleMouseDown(e) {
			if (e.button !== 0) return;
			e.preventDefault();
			this.panning = true;
			this.start = {
				pointX: this.pointX,
				pointY: this.pointY,
				clientX: e.clientX,
				clientY: e.clientY,
			};
		},
		handleMouseMove(e) {
			if (!this.panning) return;
			e.preventDefault();
			this.pointX = this.start.pointX + (e.clientX - this.start.clientX);
			this.pointY = this.start.pointY + (e.clientY - this.start.clientY);
			this.requestUpdate();
		},
		handleMouseUp() {
			this.panning = false;
		},
		zoom(delta, x, y) {
			const xs = (x - this.pointX) / this.scale,
				ys = (y - this.pointY) / this.scale;
			this.scale = Math.min(Math.max(0.1, this.scale * delta), 20);
			this.pointX = x - xs * this.scale;
			this.pointY = y - ys * this.scale;
			this.requestUpdate();
		},
		handleWheel(e) {
			e.preventDefault();
			const rect = this.imgContainer.getBoundingClientRect();
			const x = e.clientX - rect.left,
				y = e.clientY - rect.top;
			const delta = e.deltaY > 0 ? 0.8 : 1.25;
			this.zoom(delta, x, y);
		},
		handleTouchStart(e) {
			e.preventDefault();
			this.touchPanning = true;
			if (e.touches.length === 1) {
				this.start = {
					pointX: this.pointX,
					pointY: this.pointY,
					clientX: e.touches[0].clientX,
					clientY: e.touches[0].clientY,
				};
				this.touchStartX = e.touches[0].clientX;
			} else if (e.touches.length === 2) {
				this.initialDistance = Math.hypot(
					e.touches[0].clientX - e.touches[1].clientX,
					e.touches[0].clientY - e.touches[1].clientY,
				);
			}
		},
		handleTouchMove(e) {
			if (!this.touchPanning) return;
			e.preventDefault();
			if (e.touches.length === 1) {
				this.pointX =
					this.start.pointX + (e.touches[0].clientX - this.start.clientX);
				this.pointY =
					this.start.pointY + (e.touches[0].clientY - this.start.clientY);
				this.requestUpdate();
			} else if (e.touches.length === 2) {
				const newDist = Math.hypot(
					e.touches[0].clientX - e.touches[1].clientX,
					e.touches[0].clientY - e.touches[1].clientY,
				);
				const rect = this.imgContainer.getBoundingClientRect();
				const x = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
				const y = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
				const delta = newDist / this.initialDistance;
				this.zoom(delta, x, y);
				this.initialDistance = newDist;
			}
		},
		handleTouchEnd(e) {
			this.touchPanning = false;
			if (e.changedTouches.length === 1 && this.scale <= 1.1) {
				const touchEndX = e.changedTouches[0].clientX;
				const deltaX = touchEndX - this.touchStartX;
				if (Math.abs(deltaX) > 50) {
					this.navigate(deltaX < 0 ? 1 : -1);
				}
			}
		},
	};

	// --- MODULE: STYLE INJECTION --- //
	function injectStyles() {
		const plyrStyles = GM_getResourceText('plyrCSS');
		GM_addStyle(plyrStyles);
		GM_addStyle(`
        /* Основные стили */
        #kui-settings-btn-sidebar { cursor: pointer; }
        #kui-settings-panel { position: fixed; top: 0; right: 0; width: 300px; height: 100%; background-color: #2e2e2e; border-left: 1px solid #444; box-shadow: -5px 0 15px rgba(0,0,0,0.3); z-index: 10000; transform: translateX(100%); transition: transform 0.3s ease-in-out; padding: 20px; box-sizing: border-box; color: #f0f0f0; font-family: sans-serif; display: flex; flex-direction: column; }
        #kui-settings-panel.kui-panel-active { transform: translateX(0); }
        .kui-settings-content { flex-grow: 1; overflow-y: auto; padding-right: 5px; }
        .kui-setting { margin-top: 20px; } .kui-setting label { display: block; margin-bottom: 8px; }
        .kui-setting input[type="text"] { width: 100%; box-sizing: border-box; background-color: #444; border: 1px solid #666; color: white; padding: 8px; border-radius: 4px; }
        .kui-setting small { color: #999; margin-top: 5px; display: block; }
        .kui-grid-size-control { display: flex; align-items: center; gap: 10px; }
        .kui-toggle-switch { display: flex; align-items: center; justify-content: space-between; }
        .kui-switch { position: relative; display: inline-block; width: 50px; height: 26px; }
        .kui-switch input { opacity: 0; width: 0; height: 0; }
        .kui-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #555; transition: .4s; border-radius: 26px; }
        .kui-slider:before { position: absolute; content: ""; height: 20px; width: 20px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .kui-slider { background-color: #3b82f6; }
        input:checked + .kui-slider:before { transform: translateX(24px); }
        .kui-viewed { opacity: 0.5; }
        .post__content > ._content_59c5c91 { margin-top: 0 !important; padding-top: 0 !important; }

        /* Стили для кнопки копирования ника */
        h1.user-header__name { display: flex; align-items: center; }
        #kui-copy-username-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; margin-left: 10px; background-color: #374151; border: 1px solid #4b5563; color: #d1d5db; border-radius: 5px; cursor: pointer; font-size: 14px; transition: all 0.2s ease; vertical-align: middle; }
        #kui-copy-username-btn:hover { background-color: #4b5563; color: #f9fafb; }
        #kui-copy-username-btn:active { transform: scale(0.95); }

        /* Стили для галереи изображений (С АДАПТИВОМ!) */
        .kui-post-section { background-color: rgba(30, 30, 30, 0.5); border: 1px solid #444; border-radius: 8px; padding: 15px; margin-top: 20px; }
        .kui-post-section h2 { margin-top: 0 !important; margin-bottom: 15px !important; padding-bottom: 10px !important; border-bottom: 1px solid #555 !important; }
        .kui-gallery-layout { display: flex; gap: 15px; align-items: flex-start; max-height: 85vh; height: 85vh; }
        .kui-gallery-thumbnails { width: 200px; flex-shrink: 0; height: 100%; overflow-y: auto; padding-right: 5px; transition: width 0.3s ease, opacity 0.3s ease, margin-left 0.3s ease, padding 0.3s ease; }
        .kui-gallery-thumbnails.kui-collapsed { width: 0; opacity: 0; margin-left: -15px; padding-right: 0; pointer-events: none; }
        .kui-gallery-thumbnails a { display: block; margin-bottom: 10px; border: 2px solid transparent; border-radius: 4px; }
        .kui-gallery-thumbnails img { width: 100%; display: block; border-radius: 2px; }
        .kui-thumb-active { border-color: #3b82f6 !important; }
        .kui-gallery-preview { flex-grow: 1; display: flex; align-items: center; justify-content: center; position: relative; height: 100%; min-width: 0; }
        .kui-gallery-preview-image { max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in; touch-action: pan-y; }
        .kui-gallery-thumb-toggle { position: absolute; top: 10px; right: 10px; z-index: 10; cursor: pointer; background-color: rgba(58, 58, 58, 0.8); border: 1px solid #555; color: white; border-radius: 4px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 20px; transition: transform 0.2s ease, background-color 0.2s; }
        .kui-gallery-thumb-toggle:hover { transform: scale(1.1); background-color: rgba(80, 80, 80, 0.9); }
        .kui-gallery-thumb-toggle:after { content: '✕'; }
        .kui-gallery-thumbnails.kui-collapsed ~ .kui-gallery-preview .kui-gallery-thumb-toggle:after { content: '☰'; }
        /* --- ↓↓↓ НОВЫЕ СТИЛИ ДЛЯ КНОПОК НА ПРЕВЬЮ ↓↓↓ --- */
        .kui-thumb-wrapper { position: relative; }
        .kui-thumb-actions { position: absolute; top: 4px; right: 4px; z-index: 2; display: flex; gap: 4px; }
        .kui-thumb-actions a { display: flex; align-items: center; justify-content: center; background-color: rgba(20, 20, 20, 0.7); color: #f0f0f0 !important; text-decoration: none !important; width: 24px; height: 24px; border-radius: 4px; font-size: 16px; line-height: 1; border: 1px solid rgba(255,255,255,0.2); transition: background-color 0.2s, color 0.2s; }
        .kui-thumb-actions a:hover { background-color: #3b82f6; color: white !important; }
        .kui-lens-btn svg { width: 16px; height: 16px; fill: currentColor; }
        /* --- ↑↑↑ КОНЕЦ НОВЫХ СТИЛЕЙ --- */
        @media (max-width: 768px) {
            .kui-gallery-layout { flex-direction: column; height: auto; max-height: none; }
            .kui-gallery-preview { height: 60vh; order: 1; }
            .kui-gallery-thumbnails { order: 2; width: 100%; height: 120px; overflow-y: hidden; overflow-x: auto; display: flex; flex-direction: row; gap: 10px; padding-right: 0; }
            .kui-gallery-thumbnails a { margin-bottom: 0; flex-shrink: 0; width: 100px; }
            .kui-gallery-thumb-toggle { display: none; }
                        .kui-thumb-actions {
                flex-direction: column; /* Ставим кнопки друг под другом */
                gap: 2px;               /* Уменьшаем отступ между ними */
            }
            .kui-thumb-actions a {
                width: 22px;            /* Делаем их чуть компактнее */
                height: 22px;
                font-size: 14px;        /* Уменьшаем иконку-шрифт */
            }
            .kui-lens-btn svg {
                width: 14px;            /* Уменьшаем SVG-иконку */
                height: 14px;
            }
        }

        /* Стили для видеогалереи */
        .kui-video-gallery-layout { display: flex; gap: 10px; align-items: flex-start; }
        .kui-video-list { width: 300px; flex-shrink: 0; max-height: 60vh; overflow-y: auto; padding-right: 5px; transition: width 0.3s ease, opacity 0.3s ease, margin-left 0.3s ease; margin-left: 0; }
        .kui-video-list.kui-collapsed { width: 0; opacity: 0; margin-left: -10px; pointer-events: none; }
        .kui-video-list-item { padding: 10px; background-color: #3a3a3a; border-radius: 4px; margin-bottom: 8px; cursor: pointer; transition: background-color 0.2s; border: 1px solid #555; user-select: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .kui-video-item-active { background-color: #3b82f6; }
        .kui-video-player-area { flex-grow: 1; min-width: 0; max-width: 100%; }
        .kui-video-player-container { position: relative; width: 100%; background-color: black; border-radius: 4px; overflow: hidden; aspect-ratio: 16 / 9; }
        #kui-main-video-player { width: 100% !important; height: 100% !important; object-fit: contain; }
        .kui-video-playlist-toggle { position: absolute; top: 10px; right: 10px; z-index: 10; cursor: pointer; background-color: rgba(58, 58, 58, 0.8); border: 1px solid #555; color: white; border-radius: 4px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 20px; transition: transform 0.2s ease, background-color 0.2s; }
        .kui-video-playlist-toggle:hover { transform: scale(1.1); background-color: rgba(80, 80, 80, 0.9); }
        .kui-video-playlist-toggle:after { content: '✕'; }
        .kui-video-list.kui-collapsed ~ .kui-video-player-area .kui-video-playlist-toggle:after { content: '☰'; }

        /* Стили для Embed-кнопок и контента */
        .kui-embed-container { display: flex; flex-wrap: wrap; gap: 10px; padding-bottom: 15px; margin-bottom: 15px; border-bottom: 1px solid #555; }
        .kui-embed-button { display: inline-flex; align-items: center; padding: 6px 12px; background-color: #374151; color: #f3f4f6 !important; text-decoration: none !important; border-radius: 5px; font-size: 14px; transition: background-color 0.2s; border: 1px solid #4b5563; }
        .kui-embed-button:hover { background-color: #4b5563; }
        .kui-embed-button img { width: 16px; height: 16px; margin-right: 8px; border-radius: 2px; }
        .kui-embed-button span { line-height: 1; }

        /* Стили для настроек Embed */
        .kui-rule-input-group { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
        .kui-rule-input-group input, .kui-rule-input-group select, .kui-rule-input-group button { width: 100%; box-sizing: border-box; background-color: #444; border: 1px solid #666; color: white; padding: 8px; border-radius: 4px; }
        .kui-rule-input-group button { background-color: #3b82f6; border-color: #3b82f6; cursor: pointer; font-size: 18px; line-height: 1; }
        #kui-rules-container { margin-top: 15px; display: flex; flex-wrap: wrap; gap: 8px; }
        .kui-rule-tag { display: inline-flex; align-items: center; background-color: #4b5563; padding: 5px 10px; border-radius: 4px; font-size: 13px; }
        .kui-rule-tag-action { font-style: italic; color: #ccc; margin-right: 8px; cursor: pointer; user-select: none; }
        .kui-rule-tag-delete { margin-left: 8px; color: #ef4444; font-weight: bold; cursor: pointer; user-select: none; }
        #kui-save-rules-btn { width: 100%; padding: 10px; margin-top: 20px; background-color: #16a34a; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 16px; }
        #kui-save-toast { position: fixed; bottom: 20px; right: 20px; background-color: #16a34a; color: white; padding: 10px 20px; border-radius: 5px; z-index: 10001; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
        #kui-save-toast.show { opacity: 1; }

        /* Стили для кастомного скроллбара */
        .kui-gallery-thumbnails::-webkit-scrollbar, .kui-video-list::-webkit-scrollbar { width: 8px; height: 8px; }
        .kui-gallery-thumbnails::-webkit-scrollbar-track, .kui-video-list::-webkit-scrollbar-track { background: #2a2a2a; border-radius: 10px; }
        .kui-gallery-thumbnails::-webkit-scrollbar-thumb, .kui-video-list::-webkit-scrollbar-thumb { background: #555; border-radius: 10px; }
        .kui-gallery-thumbnails::-webkit-scrollbar-thumb:hover, .kui-video-list::-webkit-scrollbar-thumb:hover { background: #777; }

        /* Стили для Лайтбокса */
        #kui-lightbox { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.9); z-index: 10001; opacity: 0; visibility: hidden; transition: opacity 0.2s, visibility 0.2s; }
        #kui-lightbox.kui-active { opacity: 1; visibility: visible; }
        /* --- ↓↓↓ НОВЫЕ СТИЛИ ДЛЯ КНОПОК В ЛАЙТБОКСЕ ↓↓↓ --- */
        .kui-lightbox-top-actions { position: fixed; top: 15px; right: 15px; z-index: 2; display: flex; gap: 10px; }
        .kui-lightbox-top-actions a, .kui-lightbox-top-actions button { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: rgba(0,0,0,0.4); color: white; border: none; font-size: 24px; cursor: pointer; text-decoration: none !important; }
        #kui-lightbox-lens-btn svg { width: 22px; height: 22px; fill: currentColor; }
        /* --- ↑↑↑ КОНЕЦ НОВЫХ СТИЛЕЙ --- */
        #kui-lightbox-img-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden; touch-action: none; }
        #kui-image-canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; cursor: grab; transition: opacity 0.2s linear; }
        #kui-image-canvas:active { cursor: grabbing; }
        #kui-lightbox-img { width: 100%; height: 100%; display: block; }
        .kui-lightbox-nav { position: fixed; top: 50%; transform: translateY(-50%); width: 50px; height: 80px; background: rgba(0,0,0,0.4); color: white; border: none; font-size: 32px; cursor: pointer; z-index: 2; }
        .kui-lightbox-nav.prev { left: 15px; }
        .kui-lightbox-nav.next { right: 15px; }
        #kui-lightbox-close { /* Этот селектор больше не используется для позиционирования, только для JS */ }
    `);
	}

	// --- MODULE: UI INJECTION --- //
	function injectUI() {
		const settingsPanel = document.createElement("div");
		settingsPanel.id = "kui-settings-panel";
		settingsPanel.innerHTML = `
        <div class="kui-settings-content">
            <h2>Настройки UI</h2>
            <div class="kui-setting">
                <label for="sessionKeyInput">Ключ сессии (Session Key)</label>
                <input type="text" id="sessionKeyInput" placeholder="Оставьте пустым для авто-режима">
                <small>Запасной вариант, если автоматическое получение файлов не работает. Вставьте сюда значение cookie 'session'.</small>
            </div>
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
                        <input type="checkbox" id="debugModeToggle"><span class="kui-slider"></span>
                    </label>
                </div>
            </div>
            <div class="kui-setting">
                <div class="kui-toggle-switch">
                    <label for="verboseDebugToggle">Подробная отладка (в консоли F12)</label>
                    <label class="kui-switch">
                        <input type="checkbox" id="verboseDebugToggle"><span class="kui-slider"></span>
                    </label>
                </div>
            </div>
            <div class="kui-setting">
                <div class="kui-toggle-switch">
                    <label for="preloadImagesToggle">Предзагрузка изображений в галерее</label>
                    <label class="kui-switch">
                        <input type="checkbox" id="preloadImagesToggle"><span class="kui-slider"></span>
                    </label>
                </div>
                <small>Включает фоновую загрузку всех изображений поста при открытии галереи. Может потреблять много трафика.</small>
            </div>
            <div class="kui-setting">
                <label>Правила для Embed-ссылок</label>
                <div class="kui-rule-input-group">
                    <input type="text" id="kui-rule-domain-input" placeholder="например, *.mega.nz">
                    <select id="kui-rule-action-select">
                        <option value="button">Преобразовать</option>
                        <option value="hide">Скрыть</option>
                    </select>
                    <button id="kui-add-rule-btn">+</button>
                </div>
                <div id="kui-rules-container"></div>
            </div>
        </div>
        <div class="kui-settings-footer">
            <button id="kui-save-rules-btn">Сохранить</button>
        </div>
    `;
		document.body.appendChild(settingsPanel);
		const toast = document.createElement("div");
		toast.id = "kui-save-toast";
		toast.textContent = "Сохранено!";
		document.body.appendChild(toast);

		let tempEmbedRules = JSON.parse(JSON.stringify(embedRules));
		let panelMousedownTarget = null;

		const domainInput = document.getElementById("kui-rule-domain-input");
		const actionSelect = document.getElementById("kui-rule-action-select");
		const addBtn = document.getElementById("kui-add-rule-btn");
		const rulesContainer = document.getElementById("kui-rules-container");
		const saveBtn = document.getElementById("kui-save-rules-btn");
		const sessionKeyInput = document.getElementById("sessionKeyInput");

		sessionKeyInput.value = sessionKey;

		const renderRules = (rules) => {
			rulesContainer.innerHTML = "";
			for (const domain in rules) {
				const action = rules[domain];
				const tag = document.createElement("div");
				tag.className = "kui-rule-tag";
				tag.innerHTML = `
                <span class="kui-rule-tag-action" data-domain="${domain}">${action === "button" ? "Кнопка" : "Скрыть"}</span>:
                <span>${domain}</span>
                <span class="kui-rule-tag-delete" data-domain="${domain}">×</span>
            `;
				rulesContainer.appendChild(tag);
			}
		};

		const addRule = () => {
			const domain = domainInput.value.trim().toLowerCase();
			if (!domain) return;
			tempEmbedRules[domain] = actionSelect.value;
			renderRules(tempEmbedRules);
			domainInput.value = "";
		};

		addBtn.addEventListener("click", addRule);
		domainInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") addRule();
		});

		rulesContainer.addEventListener("click", (e) => {
			const domain = e.target.dataset.domain;
			if (!domain) return;
			if (e.target.classList.contains("kui-rule-tag-delete")) {
				delete tempEmbedRules[domain];
			} else if (e.target.classList.contains("kui-rule-tag-action")) {
				tempEmbedRules[domain] =
					tempEmbedRules[domain] === "button" ? "hide" : "button";
			}
			renderRules(tempEmbedRules);
		});

		saveBtn.addEventListener("click", () => {
			sessionKey = sessionKeyInput.value.trim();
			GM_setValue(STORAGE_KEY_SESSION_KEY, sessionKey);
			embedRules = JSON.parse(JSON.stringify(tempEmbedRules));
			GM_setValue(STORAGE_KEY_EMBED_RULES, embedRules);
			toast.classList.add("show");
			setTimeout(() => toast.classList.remove("show"), 2000);
			if (isPostPageModuleActive) {
				postPageModule.refreshContent();
				postPageModule.initializeImageGallery();
			}
		});

		document.addEventListener("mousedown", (e) => {
			panelMousedownTarget = e.target;
		});

		document.addEventListener("mouseup", (e) => {
			const sidebarButton = document.getElementById("kui-settings-btn-sidebar");
			if (
				settingsPanel.classList.contains("kui-panel-active") &&
				!settingsPanel.contains(panelMousedownTarget) &&
				!settingsPanel.contains(e.target) &&
				!sidebarButton?.contains(e.target) &&
				!sidebarButton?.contains(panelMousedownTarget)
			) {
				settingsPanel.classList.remove("kui-panel-active");
				tempEmbedRules = JSON.parse(JSON.stringify(embedRules));
				renderRules(tempEmbedRules);
			}
			panelMousedownTarget = null;
		});

		const debugToggle = document.getElementById("debugModeToggle");
		debugToggle.checked = isDebugModeEnabled;
		debugToggle.addEventListener("change", () => {
			isDebugModeEnabled = debugToggle.checked;
			GM_setValue(STORAGE_KEY_DEBUG_MODE, isDebugModeEnabled);
			isDebugModeEnabled ? debugModule.show() : debugModule.hide();
		});

		const verboseDebugToggle = document.getElementById("verboseDebugToggle");
		verboseDebugToggle.checked = isVerboseDebugEnabled;
		verboseDebugToggle.addEventListener("change", () => {
			isVerboseDebugEnabled = verboseDebugToggle.checked;
			GM_setValue(STORAGE_KEY_VERBOSE_DEBUG, isVerboseDebugEnabled);
		});

		const preloadImagesToggle = document.getElementById("preloadImagesToggle");
		preloadImagesToggle.checked = isPreloadEnabled;
		preloadImagesToggle.addEventListener("change", () => {
			isPreloadEnabled = preloadImagesToggle.checked;
			GM_setValue(STORAGE_KEY_PRELOAD_IMAGES, isPreloadEnabled);
		});

		renderRules(tempEmbedRules);

		const uiInterval = setInterval(() => {
			const communitySection = document.querySelector(
				SELECTORS.sidebarCommunitySection,
			);
			if (
				communitySection &&
				!document.getElementById("kui-settings-btn-sidebar")
			) {
				clearInterval(uiInterval);
				const settingsEntry = document.createElement("div");
				settingsEntry.className = "global-sidebar-entry";
				settingsEntry.innerHTML = `<a id="kui-settings-btn-sidebar" class="global-sidebar-entry-item" href="#">UI Настройки</a>`;
				communitySection.parentNode.insertBefore(
					settingsEntry,
					communitySection,
				);
				document
					.getElementById("kui-settings-btn-sidebar")
					.addEventListener("click", (e) => {
						e.preventDefault();
						settingsPanel.classList.toggle("kui-panel-active");
					});
			}
		}, 500);
	}

	// --- MODULE: USER PAGE LOGIC --- //
	const userPageModule = {
		init() {
			if (document.getElementById("kui-copy-username-btn")) {
				return;
			}

			const nameContainer = document.querySelector(SELECTORS.userHeaderName);
			const nameSpan = nameContainer?.querySelector('[itemprop="name"]');

			if (!nameContainer || !nameSpan) {
				console.warn("[KUI] Не удалось найти контейнер с именем автора.");
				return;
			}

			const username = nameSpan.textContent.trim();
			if (!username) return;

			const copyButton = document.createElement("button");
			copyButton.id = "kui-copy-username-btn";
			copyButton.title = "Скопировать ник";
			copyButton.innerHTML = "📋";

			copyButton.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();

				navigator.clipboard
					.writeText(username)
					.then(() => {
						copyButton.innerHTML = "✅";
						setTimeout(() => {
							copyButton.innerHTML = "📋";
						}, 1500);
					})
					.catch((err) => {
						console.error("[KUI] Не удалось скопировать текст: ", err);
						copyButton.innerHTML = "❌";
						setTimeout(() => {
							copyButton.innerHTML = "📋";
						}, 1500);
					});
			});

			nameContainer.appendChild(copyButton);
		},
		cleanup() {
		},
	};

	// --- MODULE: MAIN PAGE LOGIC --- //
	function setupGridControls() {
		const slider = document.getElementById("gridSizeSlider");
		const numberInput = document.getElementById("gridSizeInput");
		if (!slider || !numberInput) return;
		const updateGridSize = (value) => {
			const container = document.querySelector(SELECTORS.postGridContainer);
			if (!container) return;
			const safeValue = Math.max(120, Math.min(400, value));
			container.style.setProperty("--card-size", `${safeValue}px`);
			if (document.activeElement !== slider) slider.value = safeValue;
			if (document.activeElement !== numberInput) numberInput.value = safeValue;
		};
		const savedSize = GM_getValue(STORAGE_KEY_GRID_SIZE, "180");
		updateGridSize(savedSize);
		slider.addEventListener("input", () => updateGridSize(slider.value));
		numberInput.addEventListener("input", () =>
			updateGridSize(numberInput.value),
		);
		const saveValue = (e) => GM_setValue(STORAGE_KEY_GRID_SIZE, e.target.value);
		slider.addEventListener("change", saveValue);
		numberInput.addEventListener("change", saveValue);
	}

	function markViewedPosts() {
		const viewedPosts = GM_getValue(STORAGE_KEY_POSTS, {});
		document.querySelectorAll(SELECTORS.postCard).forEach((card) => {
			const postId = card.getAttribute("data-id");
			if (postId && viewedPosts[postId]) {
				card.classList.add("kui-viewed");
			}
		});
	}

	function setupGlobalClickListener() {
		document.body.addEventListener(
			"click",
			(e) => {
				const link = e.target.closest(SELECTORS.postLink);
				if (!link) return;
				const card = link.closest(SELECTORS.postCard);
				const postId = card?.getAttribute("data-id");
				if (!postId) return;
				const viewedPosts = GM_getValue(STORAGE_KEY_POSTS, {});
				viewedPosts[postId] = true;
				GM_setValue(STORAGE_KEY_POSTS, viewedPosts);
				card.classList.add("kui-viewed");
			},
			true,
		);
	}

	// --- MODULE: POST PAGE LOGIC --- //
	const postPageModule = {
		originalContentHTML: null,
		init() {
			const content = document.querySelector(SELECTORS.postContent);
			if (content) {
				this.originalContentHTML = content.innerHTML;
			}
			this.restructureLayout();
			this.initializeImageGallery();
			this.initializeVideoGallery();
			document.addEventListener("keydown", this.handleGlobalKeys, true);
			isPostPageModuleActive = true;
		},
		cleanup() {
			document.removeEventListener("keydown", this.handleGlobalKeys, true);
			const galleryLayout = document.querySelector(".kui-gallery-layout");
			if (galleryLayout) galleryLayout.remove();

			document
				.querySelectorAll(
					".kui-post-section, .kui-video-gallery-layout, .kui-embed-container",
				)
				.forEach((el) => el.remove());

			const processedElements = document.querySelectorAll(
				".kui-processed, .kui-gallery-processed, .kui-video-gallery-processed, .kui-embed-processed",
			);
			processedElements.forEach((el) => {
				el.classList.remove(
					"kui-processed",
					"kui-gallery-processed",
					"kui-video-gallery-processed",
					"kui-embed-processed",
				);
				if (el.style.display === "none") el.style.display = "";
			});
			this.originalContentHTML = null;
			isPostPageModuleActive = false;
		},
		refreshContent() {
			const content = document.querySelector(SELECTORS.postContent);
			if (content && this.originalContentHTML) {
				content.innerHTML = this.originalContentHTML;
				content.classList.remove("kui-embed-processed");
				const embedContainer = content.querySelector(".kui-embed-container");
				if (embedContainer) embedContainer.remove();
				this.processEmbeds();
			}
		},
		handleGlobalKeys(e) {
			// Эта часть остается без изменений
			if (lightboxModule.isActive || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
				return;
			}

			// --- НАЧАЛО ИЗМЕНЕНИЙ ---
			// Проверяем, находится ли фокус внутри плеера Plyr.
			// Плеер всегда имеет класс '.plyr', что делает проверку надежной.
			const activeElement = document.activeElement;
			if (activeElement && activeElement.closest('.plyr')) {
				// Если да, то ничего не делаем и позволяем плееру самому обработать нажатие.
				return;
			}
			// --- КОНЕЦ ИЗМЕНЕНИЙ ---

			// Эта логика для галереи изображений теперь будет срабатывать,
			// только если фокус НЕ на видеоплеере.
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

		processEmbeds() {
			const content = document.querySelector(SELECTORS.postContent);
			if (!content || content.classList.contains("kui-embed-processed")) return;

			if (isVerboseDebugEnabled) {
				console.group("[KUI] Обработка Embed-ссылок");
				console.log("Активные правила:", embedRules);
			}

			const links = Array.from(content.querySelectorAll("a[href]"));
			const linkActions = new Map();
			const elementsToRemove = new Set();

			links.forEach((link) => {
				try {
					if (!link.href || !link.protocol.startsWith("http")) return;

					const url = new URL(link.href);
					const linkHostname = url.hostname.replace(/^www\./, "");
					let bestMatch = null;

					if (isVerboseDebugEnabled)
						console.groupCollapsed(`-> Анализ ссылки: ${link.href}`);

					const domainParts = linkHostname.split(".");
					const domainsToCheck = [];
					domainsToCheck.push(linkHostname);
					if (domainParts.length > 2) {
						for (let i = 1; i < domainParts.length - 1; i++) {
							const parentDomain = domainParts.slice(i).join(".");
							domainsToCheck.push("*." + parentDomain);
							domainsToCheck.push(parentDomain);
						}
					}

					if (isVerboseDebugEnabled)
						console.log(`   - Домены для проверки (от спец. к общ.):`, [
							...new Set(domainsToCheck),
						]);

					for (const domain of [...new Set(domainsToCheck)]) {
						if (embedRules[domain]) {
							bestMatch = {
								domain: domain,
								action: embedRules[domain],
							};
							if (isVerboseDebugEnabled)
								console.log(
									`[+] Найдено самое точное совпадение с правилом: "${domain}"`,
								);
							break;
						}
					}

					if (bestMatch) {
						if (isVerboseDebugEnabled)
							console.log(
								`[✓] ИТОГОВОЕ РЕШЕНИЕ: Применить действие "${bestMatch.action}" от правила "${bestMatch.domain}"`,
							);
						elementsToRemove.add(link);
						if (!linkActions.has(link.href)) {
							linkActions.set(link.href, bestMatch.action);
						}
					} else {
						if (isVerboseDebugEnabled)
							console.log(
								`[✗] ИТОГОВОЕ РЕШЕНИЕ: Нет подходящих правил, игнорируем ссылку.`,
							);
					}
					if (isVerboseDebugEnabled) console.groupEnd();
				} catch (e) {
					if (isVerboseDebugEnabled) {
						console.warn(`Ошибка парсинга URL: ${link.href}`, e);
						console.groupEnd();
					}
				}
			});

			const urlsToConvert = [];
			linkActions.forEach((action, url) => {
				if (action === "button") {
					urlsToConvert.push(url);
				}
			});

			if (urlsToConvert.length > 0) {
				const buttonContainer = document.createElement("div");
				buttonContainer.className = "kui-embed-container";
				urlsToConvert.forEach((url) => {
					try {
						const urlObject = new URL(url);
						const button = document.createElement("a");
						button.href = url;
						button.className = "kui-embed-button";
						button.target = "_blank";
						button.rel = "noopener noreferrer";
						const favicon = document.createElement("img");
						favicon.src = `https://www.google.com/s2/favicons?sz=64&domain_url=${urlObject.origin}`;
						favicon.onerror = () => {
							favicon.style.display = "none";
						};
						const text = document.createElement("span");
						text.textContent = urlObject.hostname;
						button.appendChild(favicon);
						button.appendChild(text);
						buttonContainer.appendChild(button);
					} catch (e) {
					}
				});
				content.prepend(buttonContainer);
			}

			elementsToRemove.forEach((link) => {
				const parent = link.parentElement;
				if (
					parent &&
					(parent.tagName === "P" || parent.tagName === "DIV") &&
					parent.textContent.trim() === link.textContent.trim()
				) {
					parent.remove();
				} else {
					link.remove();
				}
			});

			let changed;
			do {
				changed = false;
				content.querySelectorAll("p, div, h3").forEach((el) => {
					if (
						el.innerHTML.trim() === "" ||
						el.innerHTML.trim().toLowerCase() === "<br>"
					) {
						el.remove();
						changed = true;
					}
				});
			} while (changed);
			content.querySelectorAll("br").forEach((br) => br.remove());
			content.classList.add("kui-embed-processed");
			if (isVerboseDebugEnabled) console.groupEnd();
		},
		restructureLayout() {
			const postBody = document.querySelector(SELECTORS.postBody);
			if (!postBody || postBody.classList.contains("kui-processed")) return;
			const findNextProperSibling = (element) => {
				let sibling = element.nextElementSibling;
				while (sibling) {
					if (sibling.tagName !== "SCRIPT") return sibling;
					sibling = sibling.nextElementSibling;
				}
				return null;
			};
			const wrapGroup = (h2, content, customClass = "") => {
				if (
					h2 &&
					content &&
					!h2.parentNode.classList.contains("kui-post-section")
				) {
					const wrapper = document.createElement("div");
					wrapper.className = `kui-post-section ${customClass}`.trim();
					h2.parentNode.insertBefore(wrapper, h2);
					wrapper.appendChild(h2);
					wrapper.appendChild(content);
				}
			};
			postBody.querySelectorAll("h2").forEach((h2) => {
				const title = h2.textContent.trim().toLowerCase();
				const content = findNextProperSibling(h2);
				if (!content) return;
				if (title === "downloads" && content.matches(".post__attachments"))
					wrapGroup(h2, content);
				else if (
					title === "content" &&
					content.matches(SELECTORS.postContent)
				) {
					wrapGroup(h2, content);
					this.processEmbeds();
				} else if (
					title === "files" &&
					content.matches(SELECTORS.postFilesContainer)
				)
					wrapGroup(h2, content);
				else if (title === "videos" && content.tagName === "UL")
					wrapGroup(h2, content, "kui-video-section");
			});
			const comments = document.querySelector(SELECTORS.postComments);
			if (comments && !comments.closest(".kui-post-section")) {
				const wrapper = document.createElement("div");
				wrapper.className = "kui-post-section";
				comments.parentNode.insertBefore(wrapper, comments);
				wrapper.appendChild(comments);
			}
			postBody.classList.add("kui-processed");
		},
		async initializeVideoGallery() {
			const videoSection = document.querySelector(SELECTORS.videoSection);
			if (!videoSection || videoSection.classList.contains('kui-video-gallery-processed')) return;
			const originalList = videoSection.querySelector('ul');
			if (!originalList) return;
			const videosData = Array.from(originalList.querySelectorAll('li')).map(item => ({
				title: item.querySelector('summary')?.textContent || 'Untitled Video',
				src: item.querySelector('video > source')?.src
			})).filter(video => video.src);

			if (videosData.length === 0) return;

			videoSection.classList.add('kui-video-gallery-processed');
			const galleryLayout = document.createElement('div');
			galleryLayout.className = 'kui-video-gallery-layout';
			const videoList = document.createElement('div');
			videoList.className = 'kui-video-list';
			const playerArea = document.createElement('div');
			playerArea.className = 'kui-video-player-area';
			const playerContainer = document.createElement('div');
			playerContainer.className = 'kui-video-player-container';

			// Создаем стандартный <video> элемент, как и раньше
			const mainPlayerElement = document.createElement('video');
			mainPlayerElement.id = 'kui-main-video-player';
			mainPlayerElement.preload = 'metadata';
			// Атрибут 'controls' теперь будет управляться плеером Plyr, но его можно оставить для совместимости

			const playlistToggle = document.createElement('div');
			playlistToggle.className = 'kui-video-playlist-toggle';
			playlistToggle.addEventListener('click', () => {
				videoList.classList.toggle('kui-collapsed');
			});

			playerContainer.appendChild(mainPlayerElement); // Сначала добавляем элемент в DOM
			playerContainer.appendChild(playlistToggle);
			playerArea.appendChild(playerContainer);
			galleryLayout.appendChild(videoList);
			galleryLayout.appendChild(playerArea);
			if (videosData.length <= 1) {
				videoList.classList.add('kui-collapsed');
			}

			// --- ИЗМЕНЕНИЕ 1: Инициализация Plyr ---
			// Теперь, когда элемент <video> в документе, инициализируем Plyr
			// Мы передаем вторым аргументом объект с настройками, если нужно.
			const player = new Plyr(mainPlayerElement, {
				// Пример настроек:
				tooltips: { controls: true, seek: true },
				keyboard: { focused: true, global: true },
				storage: { enabled: true, key: 'kui_plyr' } // Запоминать громкость
			});

			// --- ИЗМЕНЕНИЕ 2: Адаптация функции смены видео ---
			let listItems = []; // Перенесли объявление сюда
			const setActiveVideo = (index) => {
				// Вместо прямого изменения .src, мы используем API плеера Plyr
				player.source = {
					type: 'video',
					title: videosData[index].title,
					sources: [{
						src: videosData[index].src,
						type: 'video/mp4' // Желательно указать тип, если он известен
					}],
				};

				// Остальная логика остается прежней
				listItems.forEach((item, idx) => item.classList.toggle('kui-video-item-active', idx === index));
			};

			videosData.forEach((video, index) => {
				const listItem = document.createElement('div');
				listItem.className = 'kui-video-list-item';
				listItem.textContent = video.title;
				listItem.title = video.title;
				listItem.addEventListener('click', () => setActiveVideo(index));
				videoList.appendChild(listItem);
				listItems.push(listItem);
			});

			videoSection.appendChild(galleryLayout);
			originalList.style.display = 'none';
			setActiveVideo(0); // Запускаем первое видео
		},

		async initializeImageGallery() {
			const oldGallery = document.querySelector(".kui-gallery-layout");
			if (oldGallery) oldGallery.remove();

			const originalFilesContainer = document.querySelector(
				SELECTORS.postFilesContainer,
			);
			if (
				!originalFilesContainer ||
				originalFilesContainer.classList.contains("kui-gallery-processed")
			)
				return;

			const imageLinks = Array.from(
				originalFilesContainer.querySelectorAll("a.fileThumb"),
			);
			if (imageLinks.length === 0) return;

			const urlMatch = window.location.pathname.match(
				/\/(?<service>[^/]+)\/user\/(?<creator_id>[^/]+)\/post\/(?<post_id>[^/]+)/,
			);
			let fileDataMap = new Map();
			if (urlMatch) {
				const {
					service,
					creator_id,
					post_id
				} = urlMatch.groups;
				const apiUrl = `/api/v1/${service}/user/${creator_id}/post/${post_id}`;
				const fetchOptions = {
					headers: {}
				};
				if (sessionKey) {
					fetchOptions.headers["Cookie"] = `session=${sessionKey}`;
				} else {
					fetchOptions.credentials = "include";
				}
				try {
					const response = await fetch(apiUrl, fetchOptions);
					if (!response.ok)
						throw new Error(`API request failed: ${response.status}`);
					const postData = await response.json();
					const allFiles = [
						...(postData.post?.file ? [postData.post.file] : []),
						...(postData.post?.attachments ?? []),
					];
					allFiles.forEach(
						(file) =>
							file?.name && file.path && fileDataMap.set(file.name, file.path),
					);
				} catch (error) {
					console.error(
						"[KUI] Ошибка при получении данных о файлах из API.",
						error,
					);
				}
			}

			originalFilesContainer.classList.add("kui-gallery-processed");
			const galleryLayout = document.createElement("div");
			galleryLayout.className = "kui-gallery-layout";
			const thumbList = document.createElement("div");
			thumbList.className = "kui-gallery-thumbnails";
			const previewContainer = document.createElement("div");
			previewContainer.className = "kui-gallery-preview";
			const previewImage = document.createElement("img");
			previewImage.className = "kui-gallery-preview-image";
			const thumbToggle = document.createElement("div");
			thumbToggle.className = "kui-gallery-thumb-toggle";
			thumbToggle.addEventListener("click", () =>
				thumbList.classList.toggle("kui-collapsed"),
			);

			previewContainer.appendChild(previewImage);
			previewContainer.appendChild(thumbToggle);
			galleryLayout.appendChild(thumbList);
			galleryLayout.appendChild(previewContainer);
			originalFilesContainer
				.closest(".kui-post-section")
				?.appendChild(galleryLayout);
			originalFilesContainer.style.display = "none";

			let currentIndex = 0;
			const setActive = (index) => {
				currentIndex = (index + imageLinks.length) % imageLinks.length;
				const activeThumbLink = thumbLinks[currentIndex];
				const originalPageLink = imageLinks[currentIndex];
				if (!activeThumbLink || !originalPageLink) return;
				const previewSrc = originalPageLink.querySelector("img").src;
				if (previewImage.src !== previewSrc) {
					previewImage.src = previewSrc;
				}
				thumbLinks.forEach((link) => link.classList.remove("kui-thumb-active"));
				activeThumbLink.classList.add("kui-thumb-active");
				activeThumbLink.scrollIntoView({
					behavior: "smooth",
					block: "nearest",
				});
			};

			galleryLayout.navigate = (direction) =>
				setActive(currentIndex + direction);

			let touchStartX = 0;
			previewImage.addEventListener("touchstart", (e) => {
				touchStartX = e.changedTouches[0].clientX;
			});
			previewImage.addEventListener("touchend", (e) => {
				const touchEndX = e.changedTouches[0].clientX;
				const deltaX = touchEndX - touchStartX;
				if (Math.abs(deltaX) > 40) {
					galleryLayout.navigate(deltaX < 0 ? 1 : -1);
				}
			});

			const thumbLinks = imageLinks.map((thumbLink, index) => {
				const wrapper = document.createElement("div");
				wrapper.className = "kui-thumb-wrapper";
				const newThumb = thumbLink.querySelector("img").cloneNode(true);
				const newThumbLink = document.createElement("a");
				newThumbLink.href = "#";
				newThumbLink.addEventListener("click", (e) => {
					e.preventDefault();
					setActive(index);
				});
				newThumbLink.appendChild(newThumb);
				wrapper.appendChild(newThumbLink);
				const fileName = thumbLink.getAttribute("download");
				const relativePath = fileDataMap.get(fileName);

				if (relativePath) {
					const fullOriginalPath = `https://kemono.cr/data${relativePath}`;

					thumbLink.dataset.originalPath = fullOriginalPath;
					const actionsContainer = document.createElement("div");
					actionsContainer.className = "kui-thumb-actions";

					const originalLinkBtn = document.createElement("a");
					originalLinkBtn.href = fullOriginalPath;
					originalLinkBtn.innerHTML = "⤓";
					originalLinkBtn.title = "Скачать оригинал";
					originalLinkBtn.target = "_blank";
					originalLinkBtn.rel = "noopener noreferrer";
					originalLinkBtn.addEventListener("click", (e) => e.stopPropagation());
					actionsContainer.appendChild(originalLinkBtn);

					const lensLink = `https://lens.google.com/v3/upload?url=${encodeURIComponent(fullOriginalPath)}`;

					const lensBtn = document.createElement("a");
					lensBtn.href = lensLink;
					lensBtn.title = "Искать в Google Lens";
					lensBtn.className = "kui-lens-btn";
					lensBtn.target = "_blank";
					lensBtn.rel = "noopener noreferrer";
					lensBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12H18A6,6 0 0,0 12,6V4M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"></path></svg>`;
					lensBtn.addEventListener("click", (e) => e.stopPropagation());
					actionsContainer.appendChild(lensBtn);
					wrapper.appendChild(actionsContainer);
				}
				thumbList.appendChild(wrapper);
				return newThumbLink;
			});

			if (isPreloadEnabled) {
				imageLinks.forEach((link, i) => {
					const urlToPreload = link.dataset.originalPath || link.href;
					if (i > 0) {
						const img = new Image();
						img.src = urlToPreload;
					}
				});
			}

			previewImage.addEventListener("click", () => {
				lightboxModule.open(imageLinks, currentIndex);
			});
			setActive(0);
		},
	};

	// --- MODULE: SPA ENGINE & INITIALIZATION --- //
	const observer = new MutationObserver(() => {
		runPageLogic();
	});

	function runPageLogic() {
		const isOnPostPage = !!document.querySelector(SELECTORS.postPageContainer);
		const isOnUserPage = !!document.querySelector(SELECTORS.userHeaderName);
		if (isOnPostPage) {
			if (!isPostPageModuleActive) {
				postPageModule.init();
			}
		} else {
			if (isPostPageModuleActive) {
				postPageModule.cleanup();
			}
		}
		if (isOnUserPage) {
			userPageModule.init();
		}
		if (document.querySelector(SELECTORS.postGridContainer)) {
			setupGridControls();
			markViewedPosts();
		}
	}

	function startApp() {
		debugModule.init();
		injectStyles();
		injectUI();
		lightboxModule.init();
		setupGlobalClickListener();
		const mainContent = document.querySelector(SELECTORS.mainContent);
		if (mainContent) {
			runPageLogic();
			observer.observe(mainContent, {
				childList: true,
				subtree: true,
			});
		} else {
			const fallbackInterval = setInterval(() => {
				const mainContent = document.querySelector(SELECTORS.mainContent);
				if (mainContent) {
					clearInterval(fallbackInterval);
					runPageLogic();
					observer.observe(mainContent, {
						childList: true,
						subtree: true,
					});
				}
			}, 250);
		}
	}

	startApp();
})();