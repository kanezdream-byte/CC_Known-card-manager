// ==UserScript==
// @name         코코포리아 알고있었어 카드 관리 매니저
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  둘이서 수사 알고있었어 카드 관리 플러그인
// @author       힐에블
// @match        https://ccfolia.com/rooms/*
// @exclude      https://ccfolia.com/rooms/*/chat
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // 카드 관리자 시작

    // ==================== 핵심 상태 관리 ====================
    const CardManager = {
        // 데이터
        cards: [],
        cardCounter: 0,
        isVisible: false,
        viewMode: 'collection', // 'collection' | 'focus'
        focusedCardId: null,


        // 폴더 관리
        folders: [
            { id: 'default', name: '기본 폴더', color: '#8B6F47', isDefault: true }
        ],
        selectedFolderId: 'default',



        // 성능 최적화를 위한 캐시
        _caches: {
            folderCardCounts: new Map(),
            filteredCards: new Map(),
            keywordNumbers: new Map(),
            lastCacheUpdate: 0
        },

        // 설정
        settings: {
            autoNumber: true,
            defaultExpanded: true,
            autoSave: true,
            // 따옴표 트리거 기능 제거됨 - 키워드 목록에서 직접 관리
            opacity: {
                default: 100,  // 기본 모드 투명도 (10-100%)
                focus: 100     // 집중 모드 투명도 (10-100%)
            },
            focusMode: {
                fontSize: 16,  // 기본 글자 크기 (12-24px)
                fontFamily: 'default',  // 기본 폰트
                lineHeight: 1.8, // 줄 간격 (1.4-2.4)
                letterSpacing: 0.3, // 자간 (px)
                wordSpacing: 0.2, // 어간 (em)
                textAlign: 'left', // 정렬 ('left', 'justify', 'center')
                fontWeight: 400, // 폰트 두께 (300-700)
                keywordListCollapsed: false // 키워드 목록 접기 상태
            },
            // 높이를 조절하는 코드
            buttonPosition: {
                top: 50  // 버튼 위치 (0-100%)
            },
            // 폴더 사이드바 접기 상태
            folderSidebarCollapsed: false,
            // 메인 패널 카드 레이아웃 설정
            cardLayout: {
                cardsPerRow: 2  // 1-3 카드 배치 (기본값: 2)
            }
        },

        // 집중 모드 상태
        focus: {
            searchQuery: '',
            memoContent: ''
        },

        // 새로운 키워드 관리 시스템
        keywordDatabase: {
            // 전역 키워드 데이터베이스: { id: string, name: string, type: 'normal'|'important', folderId: string, state: { visible: boolean, completed: boolean } }
        },

        // 카드별 키워드 참조 시스템
        cardKeywords: {
            // 카드ID -> [키워드ID 배열]
        },

        // TODO 키워드 패널 상태
        todoKeyword: {
            isVisible: false,
            searchQuery: '',
            autoDetect: true
        },

        // 주사위 업적 시스템
        diceAchievements: {
            unlocked: [], // 달성한 업적 배열 (1~10)
            firstAchievement: null, // 최초 달성 시간
            achievementCounts: {} // 각 숫자별 달성 횟수
        }
    };

    // ==================== 고급 드래그 시스템 (전면 리팩토링) ====================
    const AdvancedDragSystem = {
        // 등록된 드래그 인스턴스들 추적
        instances: new Map(),
        globalListeners: {
            mousemove: null,
            mouseup: null,
            registered: false
        },
        
        // 글로벌 이벤트 리스너 등록 (한 번만)
        initGlobalListeners() {
            if (this.globalListeners.registered) return;
            
            this.globalListeners.mousemove = (e) => {
                // 모든 활성 드래그 인스턴스에 이벤트 전달
                this.instances.forEach(instance => {
                    if (instance.isActive) {
                        instance.handleMouseMove(e);
                    }
                });
            };
            
            this.globalListeners.mouseup = (e) => {
                // 모든 활성 드래그 인스턴스에 이벤트 전달
                this.instances.forEach(instance => {
                    if (instance.isActive) {
                        instance.handleMouseUp(e);
                    }
                });
            };
            
            document.addEventListener('mousemove', this.globalListeners.mousemove, { passive: false });
            document.addEventListener('mouseup', this.globalListeners.mouseup, { passive: false });
            
            this.globalListeners.registered = true;
        },
        
        // 드래그 인스턴스 생성
        createInstance(element, handle, options = {}) {
            // 기존 인스턴스가 있다면 제거
            this.removeInstance(element);
            
            const instanceId = this.generateId();
            const instance = new DragInstance(instanceId, element, handle, options);
            
            this.instances.set(element, instance);
            this.initGlobalListeners();
            
            return instance;
        },
        
        // 드래그 인스턴스 제거
        removeInstance(element) {
            const instance = this.instances.get(element);
            if (instance) {
                instance.destroy();
                this.instances.delete(element);
            }
        },
        
        // 모든 인스턴스 정리
        cleanup() {
            this.instances.forEach(instance => instance.destroy());
            this.instances.clear();
            
            if (this.globalListeners.registered) {
                document.removeEventListener('mousemove', this.globalListeners.mousemove);
                document.removeEventListener('mouseup', this.globalListeners.mouseup);
                this.globalListeners.registered = false;
            }
        },
        
        // ID 생성
        generateId() {
            return 'drag_' + Math.random().toString(36).substr(2, 9);
        }
    };
    
    // 개별 드래그 인스턴스 클래스
    class DragInstance {
        constructor(id, element, handle, options = {}) {
            this.id = id;
            this.element = element;
            this.handle = handle;
            this.options = {
                dragThreshold: 5,
                clickTimeThreshold: 200,
                enableClick: true,
                preventContextMenu: true,
                ...options
            };
            
            // 상태 변수
            this.isActive = false;
            this.isDragging = false;
            this.hasMoved = false;
            this.startX = 0;
            this.startY = 0;
            this.dragStartTime = 0;
            this.initialElementRect = null;
            
            // 바인딩된 이벤트 핸들러들
            this.boundMouseDown = this.handleMouseDown.bind(this);
            this.boundClick = this.handleClick.bind(this);
            this.boundContextMenu = this.handleContextMenu.bind(this);
            
            this.init();
        }
        
        init() {
            // 핸들에 이벤트 등록
            this.handle.addEventListener('mousedown', this.boundMouseDown);
            this.handle.addEventListener('click', this.boundClick);
            
            if (this.options.preventContextMenu) {
                this.handle.addEventListener('contextmenu', this.boundContextMenu);
            }
            
            // 스타일 설정
            this.handle.style.cursor = 'grab';
            this.handle.style.userSelect = 'none';
        }
        
        handleMouseDown(e) {
            // 우클릭 무시
            if (e.button !== 0) return;
            
            this.isActive = true;
            this.isDragging = false;
            this.hasMoved = false;
            this.dragStartTime = Date.now();
            
            this.startX = e.clientX;
            this.startY = e.clientY;
            
            // 요소의 초기 위치 저장
            this.initialElementRect = this.element.getBoundingClientRect();
            
            // 중앙 정렬 스타일이 있다면 제거하고 절대 위치로 변경
            this.prepareForDrag();
        }
        
        handleMouseMove(e) {
            if (!this.isActive) return;
            
            const deltaX = e.clientX - this.startX;
            const deltaY = e.clientY - this.startY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            
            // 임계값을 넘으면 드래그 시작
            if (distance > this.options.dragThreshold && !this.isDragging) {
                this.startDrag();
            }
            
            // 드래그 중이면 위치 업데이트
            if (this.isDragging) {
                this.updatePosition(e);
            }
        }
        
        handleMouseUp(e) {
            if (!this.isActive) return;
            
            const clickDuration = Date.now() - this.dragStartTime;
            const isClick = !this.hasMoved && clickDuration < this.options.clickTimeThreshold;
            
            if (this.isDragging) {
                this.endDrag();
            }
            
            this.resetState();
        }
        
        handleClick(e) {
            // 드래그 후 클릭은 무시
            if (this.hasMoved) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
        
        handleContextMenu(e) {
            // 우클릭 메뉴 방지
            e.preventDefault();
        }
        
        startDrag() {
            this.isDragging = true;
            this.hasMoved = true;
            
            // 커서 변경
            document.body.style.cursor = 'grabbing';
            this.handle.style.cursor = 'grabbing';
            
            // 텍스트 선택 방지
            document.body.style.userSelect = 'none';
        }
        
        updatePosition(e) {
            // 시작점부터의 총 이동 거리
            const totalDeltaX = e.clientX - this.startX;
            const totalDeltaY = e.clientY - this.startY;
            
            // 새 위치 계산 (초기 위치 + 이동 거리)
            const newLeft = this.initialElementRect.left + totalDeltaX;
            const newTop = this.initialElementRect.top + totalDeltaY;
            
            // 화면 경계 제한 (선택사항)
            const boundedLeft = Math.max(0, Math.min(newLeft, window.innerWidth - this.element.offsetWidth));
            const boundedTop = Math.max(0, Math.min(newTop, window.innerHeight - this.element.offsetHeight));
            
            // 위치 적용
            this.element.style.left = boundedLeft + 'px';
            this.element.style.top = boundedTop + 'px';
        }
        
        endDrag() {
            // 커서 복원
            document.body.style.cursor = '';
            this.handle.style.cursor = 'grab';
            document.body.style.userSelect = '';
        }
        
        prepareForDrag() {
            const computedStyle = window.getComputedStyle(this.element);
            
            // transform이 있으면 제거하고 절대 위치로 변경
            if (computedStyle.transform && computedStyle.transform !== 'none') {
                this.element.style.transform = 'none';
            }
            
            // position이 absolute나 fixed가 아니면 변경
            if (!['absolute', 'fixed'].includes(computedStyle.position)) {
                this.element.style.position = 'absolute';
            }
            
            // 현재 위치를 left, top으로 설정
            this.element.style.left = this.initialElementRect.left + 'px';
            this.element.style.top = this.initialElementRect.top + 'px';
            this.element.style.margin = '0';
        }
        
        resetState() {
            this.isActive = false;
            this.isDragging = false;
            this.hasMoved = false;
            this.dragStartTime = 0;
            this.initialElementRect = null;
        }
        
        destroy() {
            // 이벤트 리스너 제거
            this.handle.removeEventListener('mousedown', this.boundMouseDown);
            this.handle.removeEventListener('click', this.boundClick);
            this.handle.removeEventListener('contextmenu', this.boundContextMenu);
            
            // 상태 초기화
            this.resetState();
            
            // 커서 복원
            if (this.handle.style.cursor === 'grabbing') {
                this.handle.style.cursor = 'grab';
            }
        }
    }
    
    // 하위 호환성을 위한 기존 DragUtils 인터페이스
    const DragUtils = {
        makeDraggable(element, handle, options = {}) {
            const instance = AdvancedDragSystem.createInstance(element, handle, options);
            
            // 이전 API와의 호환성을 위해 정리 함수 반환
            return () => {
                AdvancedDragSystem.removeInstance(element);
            };
        }
    };

    // ==================== 성능 최적화 유틸리티 ====================
    const PerformanceUtils = {
        // 캐시 무효화
        invalidateCache() {
            CardManager._caches.folderCardCounts.clear();
            CardManager._caches.filteredCards.clear();
            CardManager._caches.keywordNumbers.clear();
            CardManager._caches.lastCacheUpdate = Date.now();
        },

        // 폴더별 카드 수 캐싱
        getFolderCardCount(folderId) {
            const cache = CardManager._caches.folderCardCounts;
            if (!cache.has(folderId)) {
                cache.set(folderId, CardManager.cards.filter(card => card.folderId === folderId).length);
            }
            return cache.get(folderId);
        },

        // 필터된 카드 캐싱
        getFilteredCards(folderId) {
            const cache = CardManager._caches.filteredCards;
            if (!cache.has(folderId)) {
                cache.set(folderId, CardManager.cards.filter(card => card.folderId === folderId));
            }
            return cache.get(folderId);
        },

        // ID 생성 최적화 (crypto API 사용)
        generateId() {
            if (crypto && crypto.getRandomValues) {
                return crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
            }
            return Math.random().toString(36).substr(2, 9);
        },

        // DocumentFragment를 사용한 DOM 일괄 업데이트
        createElementsFromHTML(html) {
            const template = document.createElement('template');
            template.innerHTML = html;
            return template.content;
        }
    };

    // ==================== 유틸리티 함수 ====================
    const Utils = {
        // 정규식 특수문자 이스케이핑
        escapeRegex(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        },

        // 숫자를 원형 표시로 변환
        toCircleNumber(num, isImportant = false) {
            const normalCircles = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
                '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
            const importantCircles = ['❶', '❷', '❸', '❹', '❺', '❻', '❼', '❽', '❾', '❿',
                '⓫', '⓬', '⓭', '⓮', '⓯', '⓰', '⓱', '⓲', '⓳', '⓴'];

            const circles = isImportant ? importantCircles : normalCircles;

            if (num >= 1 && num <= 20) {
                return circles[num - 1];
            } else if (num > 20) {
                // 20을 넘으면 숫자 그대로 표시하되 원형 스타일로
                return isImportant ? `❉${num}` : `◯${num}`;
            } else {
                return num.toString();
            }
        },

        // 디버깅용 로그 제거 - 프로덕션에서는 제거
        convertKeywords(text, folderId = null) {
            if (!text) return text;

            const currentFolderId = folderId || CardManager.selectedFolderId;

            // [1], #1, 1 형태 키워드 번호 참조를 실제 키워드로 변환
            text = this.convertNumberReferences(text, currentFolderId);

            // 원형 숫자 키워드 직접 입력 인식 (「①」,『⑤』 등)
            text = this.convertCircleNumberKeywords(text, currentFolderId);

            // 따옴표 변환 기능 제거됨 - 키워드 목록에서 직접 관리

            return text;
        },

        // 번호 참조를 실제 키워드로 변환 ([1], #1, 1 등)
        convertNumberReferences(text, folderId) {
            if (!text) return text;

            // [1] 형태 변환
            text = text.replace(/\[(\d+)\]/g, (match, number) => {
                const keyword = KeywordManager.getKeywordByNumber(folderId, parseInt(number));
                if (keyword) {
                    return keyword.type === 'important' ? `『${keyword.name}』` : `「${keyword.name}」`;
                }
                return match;
            });

            // #1, 카드#1 형태 변환
            text = text.replace(/(?:카드\s*#|#)(\d+)/g, (match, number) => {
                const keyword = KeywordManager.getKeywordByNumber(folderId, parseInt(number));
                if (keyword) {
                    return keyword.type === 'important' ? `『${keyword.name}』` : `「${keyword.name}」`;
                }
                return match;
            });


            return text;
        },

        // 원형 숫자 키워드 직접 입력 인식 (「①」,『⑤』 등)
        convertCircleNumberKeywords(text, folderId) {
            if (!text) return text;

            // 일반 키워드 형태의 원형 숫자 변환 「①」
            text = text.replace(/「([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿])」/g, (match, circleNumber) => {
                const number = this.circleNumberToInt(circleNumber);
                if (number) {
                    const keyword = KeywordManager.getKeywordByNumber(folderId, number);
                    if (keyword) {
                        return `「${keyword.name}」`;
                    }
                }
                return match;
            });

            // 중요 키워드 형태의 원형 숫자 변환 『⑤』
            text = text.replace(/『([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿])』/g, (match, circleNumber) => {
                const number = this.circleNumberToInt(circleNumber);
                if (number) {
                    const keyword = KeywordManager.getKeywordByNumber(folderId, number);
                    if (keyword) {
                        return `『${keyword.name}』`;
                    }
                }
                return match;
            });

            return text;
        },

        // 원형 숫자를 정수로 변환
        circleNumberToInt(circleNumber) {
            const circleMap = {
                '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
                '⑪': 11, '⑫': 12, '⑬': 13, '⑭': 14, '⑮': 15, '⑯': 16, '⑰': 17, '⑱': 18, '⑲': 19, '⑳': 20,
                '㉑': 21, '㉒': 22, '㉓': 23, '㉔': 24, '㉕': 25, '㉖': 26, '㉗': 27, '㉘': 28, '㉙': 29, '㉚': 30,
                '㉛': 31, '㉜': 32, '㉝': 33, '㉞': 34, '㉟': 35, '㊱': 36, '㊲': 37, '㊳': 38, '㊴': 39, '㊵': 40,
                '㊶': 41, '㊷': 42, '㊸': 43, '㊹': 44, '㊺': 45, '㊻': 46, '㊼': 47, '㊽': 48, '㊾': 49, '㊿': 50
            };
            return circleMap[circleNumber] || null;
        },


        // 링크를 클릭 가능한 형태로 변환
        convertLinksToClickable(text) {
            if (!text) return text;

            // URL 패턴 정의 (더 정밀한 패턴)
            const urlPattern = /(https?:\/\/(?:[-\w.])+(?::[0-9]+)?(?:\/(?:[\w\/_.])*)?(?:\?(?:[\w&%_.=])*)?(?:#(?:[\w-.])*)?)/gi;
            
            // URL을 클릭 가능한 링크로 변환
            const convertedText = text.replace(urlPattern, (match) => {
                // URL의 최대 표시 길이 제한 (60자)
                const displayUrl = match.length > 60 ? match.substring(0, 57) + '...' : match;
                
                return `<a href="${match}" target="_blank" rel="noopener noreferrer" 
                          style="color: #0066cc; text-decoration: underline; cursor: pointer;"
                          onclick="event.stopPropagation();"
                          title="새 탭에서 열기: ${match}">
                    ${displayUrl}
                </a>`;
            });

            return convertedText;
        },

        // 키워드 파싱 (HTML 변환) - 폴더별 상태 반영
        parseKeywords(text, folderId = null) {
            if (!text) return '';

            let processedText = this.convertKeywords(text, folderId);
            const currentFolderId = folderId || CardManager.selectedFolderId;

            // 🚫 키워드 자동 등록 기능 제거됨
            // 카드 패널에서는 키워드를 등록할 수 없음
            // 키워드 패널에서만 키워드 등록 가능

            // [1], #1, 1 형태 키워드 번호 참조를 실제 키워드로 변환
            // (따옴표 변환 기능 제거됨 - 오직 번호 참조만 지원)

            // HTML 변환 부분은 동일하게 유지하되, null 체크 추가
            if (document.querySelector('.ccfolia-focus-panel')) {
                processedText = processedText.replace(/『([^』]+)』/g, (match, keyword) => {
                    const keywordNumber = KeywordManager.getKeywordNumber(currentFolderId, keyword);
                    if (keywordNumber === null) return match; // 번호가 없으면 그대로 반환

                    const keywordId = `important_${keyword}_${currentFolderId}_${Math.random().toString(36).substr(2, 9)}`;
                    const isHidden = NewKeywordManager.isKeywordHidden(currentFolderId, keyword);
                    const displayText = isHidden ? `『${Utils.toCircleNumber(keywordNumber, true)}』` : keyword;
                    const hiddenClass = isHidden ? ' hidden' : '';
                    return `<span class="keyword-important${hiddenClass}" data-keyword-id="${keywordId}" data-original-text="${keyword}" data-keyword-number="${keywordNumber}" data-folder-id="${currentFolderId}" data-keyword-type="important" onclick="event.stopPropagation(); UI.toggleFolderKeyword('${currentFolderId}', '${keyword}')">${displayText}</span>`;
                });

                // 일반 키워드도 동일하게 처리
                processedText = processedText.replace(/「([^」]+)」/g, (match, keyword) => {
                    const keywordNumber = KeywordManager.getKeywordNumber(currentFolderId, keyword);
                    if (keywordNumber === null) return match;

                    const keywordId = `normal_${keyword}_${currentFolderId}_${Math.random().toString(36).substr(2, 9)}`;
                    const isHidden = NewKeywordManager.isKeywordHidden(currentFolderId, keyword);
                    const displayText = isHidden ? `「${Utils.toCircleNumber(keywordNumber, false)}」` : keyword;
                    const hiddenClass = isHidden ? ' hidden' : '';
                    return `<span class="keyword-normal${hiddenClass}" data-keyword-id="${keywordId}" data-original-text="${keyword}" data-keyword-number="${keywordNumber}" data-folder-id="${currentFolderId}" data-keyword-type="normal" onclick="event.stopPropagation(); UI.toggleFolderKeyword('${currentFolderId}', '${keyword}')">${displayText}</span>`;
                });
            } else {
                // 컬렉션 모드도 동일하게 처리
                processedText = processedText.replace(/『([^』]+)』/g, (match, keyword) => {
                    const keywordNumber = KeywordManager.getKeywordNumber(currentFolderId, keyword);
                    if (keywordNumber === null) return match;

                    const keywordId = `important_${keyword}_${currentFolderId}_${Math.random().toString(36).substr(2, 9)}`;
                    const isHidden = NewKeywordManager.isKeywordHidden(currentFolderId, keyword);
                    const displayText = isHidden ? `『${Utils.toCircleNumber(keywordNumber, true)}』` : keyword;
                    const hiddenClass = isHidden ? ' hidden' : '';
                    return `<span class="keyword-important${hiddenClass}" data-keyword-id="${keywordId}" data-original-text="${keyword}" data-keyword-number="${keywordNumber}" data-folder-id="${currentFolderId}" data-keyword-type="important" onclick="event.stopPropagation(); UI.toggleFolderKeyword('${currentFolderId}', '${keyword}')">${displayText}</span>`;
                });


                processedText = processedText.replace(/「([^」]+)」/g, (match, keyword) => {
                    const keywordNumber = KeywordManager.getKeywordNumber(currentFolderId, keyword);
                    if (keywordNumber === null) return match;

                    const keywordId = `normal_${keyword}_${currentFolderId}_${Math.random().toString(36).substr(2, 9)}`;
                    const isHidden = NewKeywordManager.isKeywordHidden(currentFolderId, keyword);
                    const displayText = isHidden ? `「${Utils.toCircleNumber(keywordNumber, false)}」` : keyword;
                    const hiddenClass = isHidden ? ' hidden' : '';
                    return `<span class="keyword-normal${hiddenClass}" data-keyword-id="${keywordId}" data-original-text="${keyword}" data-keyword-number="${keywordNumber}" data-folder-id="${currentFolderId}" data-keyword-type="normal" onclick="event.stopPropagation(); UI.toggleFolderKeyword('${currentFolderId}', '${keyword}')">${displayText}</span>`;
                });
            }

            return processedText;
        },

        // 집중 패널 전용 키워드 파싱 (항상 클릭 가능한 키워드 생성)
        parseFocusKeywords(text, folderId = null) {
            if (!text) return '';

            // Ensure line breaks are preserved by normalizing different line break formats
            let normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

            let processedText = this.convertKeywords(normalizedText, folderId);
            const currentFolderId = folderId || CardManager.selectedFolderId;

            // 🚫 키워드 자동 등록 기능 제거됨
            // 카드 패널에서는 키워드를 등록할 수 없음
            // 키워드 패널에서만 키워드 등록 가능

            // [1], #1, 1 형태 키워드 번호 참조를 실제 키워드로 변환
            // (따옴표 변환 기능 제거됨 - 오직 번호 참조만 지원)

            // 집중 모드 전용: 항상 클릭 가능한 키워드 생성
            processedText = processedText.replace(/『([^』]+)』/g, (match, keyword) => {
                const keywordNumber = KeywordManager.getKeywordNumber(currentFolderId, keyword);
                if (keywordNumber === null) return match; // 번호가 없으면 그대로 반환

                const keywordId = `important_${keyword}_${currentFolderId}_${Math.random().toString(36).substr(2, 9)}`;
                const isHidden = NewKeywordManager.isKeywordHidden(currentFolderId, keyword);
                const displayText = isHidden ? `『${Utils.toCircleNumber(keywordNumber, true)}』` : keyword;
                const hiddenClass = isHidden ? ' hidden' : '';
                return `<span class="keyword-important${hiddenClass}" data-keyword-id="${keywordId}" data-original-text="${keyword}" data-keyword-number="${keywordNumber}" data-folder-id="${currentFolderId}" data-keyword-type="important" onclick="event.stopPropagation(); UI.toggleFolderKeyword('${currentFolderId}', '${keyword}')">${displayText}</span>`;
            });

            processedText = processedText.replace(/「([^」]+)」/g, (match, keyword) => {
                const keywordNumber = KeywordManager.getKeywordNumber(currentFolderId, keyword);
                if (keywordNumber === null) return match; // 번호가 없으면 그대로 반환

                const keywordId = `normal_${keyword}_${currentFolderId}_${Math.random().toString(36).substr(2, 9)}`;
                const isHidden = NewKeywordManager.isKeywordHidden(currentFolderId, keyword);
                const displayText = isHidden ? `「${Utils.toCircleNumber(keywordNumber, false)}」` : keyword;
                const hiddenClass = isHidden ? ' hidden' : '';
                return `<span class="keyword-normal${hiddenClass}" data-keyword-id="${keywordId}" data-original-text="${keyword}" data-keyword-number="${keywordNumber}" data-folder-id="${currentFolderId}" data-keyword-type="normal" onclick="event.stopPropagation(); UI.toggleFolderKeyword('${currentFolderId}', '${keyword}')">${displayText}</span>`;
            });

            // 줄바꿈을 <br> 태그로 변환 (키워드와 함께 HTML로 처리되므로 필요)
            processedText = processedText.replace(/\n/g, '<br>');

            // 문단 구분을 위해 연속된 <br>을 <p> 태그로 변환
            // <br><br> -> </p><p>
            processedText = `<p>${processedText.replace(/(<br>\s*){2,}/g, '</p><p>')}</p>`;

            return processedText;
        },

        // 키워드 통계
        getKeywordStats(text) {
            if (!text) return { normal: 0, important: 0, total: 0 };

            const convertedText = this.convertKeywords(text);
            const normal = (convertedText.match(/「[^」]+」/g) || []).length;
            const important = (convertedText.match(/『[^』]+』/g) || []).length;

            return { normal, important, total: normal + important };
        },

        // 알림 표시
        // 투명도 적용
        applyOpacity(element, mode = 'default') {
            if (!element || !CardManager.settings.opacity) return;

            const opacity = CardManager.settings.opacity[mode] || 100;
            const opacityValue = Math.max(0.1, Math.min(1, opacity / 100)); // 10%-100% 범위
            element.style.opacity = opacityValue.toString();
        },

        // 현재 모드에 따른 투명도 가져오기
        getCurrentOpacity() {
            const mode = CardManager.viewMode === 'focus' ? 'focus' : 'default';
            return CardManager.settings.opacity[mode] || 100;
        },

        // 텍스트를 키워드 형태로 복사 (클립보드용) - 숨김 상태 자동 인식
        copyTextWithKeywords(text, notification = true, cardName = null, folderId = null) {
            if (!text) return false;

            // 트리거 문자를 키워드 괄호로 변환
            let convertedText = this.convertKeywords(text, folderId);

            // 숨겨진 키워드들을 숨김 형태로 변환
            convertedText = this.convertToHiddenKeywordsBasedOnState(convertedText, folderId);

            // 카드 이름이 있으면 포함하여 복사
            let finalText = convertedText;
            if (cardName) {
                finalText = `[ ${cardName} ]\n${convertedText}`;
            }

            return navigator.clipboard.writeText(finalText).then(() => {
                return true;
            }).catch((error) => {
                console.error('❌ 클립보드 복사 실패:', error);
                return false;
            });
        },

        // 키워드를 숨겨진 형태(원형 숫자)로 변환
        convertToHiddenKeywords(text, folderId = null) {
            if (!text) return text;

            const currentFolderId = folderId || CardManager.selectedFolderId;

            // 중요 키워드를 숨겨진 형태로 변환
            text = text.replace(/『([^』]+)』/g, (match, keyword) => {
                const keywordNumber = KeywordManager.getKeywordNumber(currentFolderId, keyword);
                return `『${this.toCircleNumber(keywordNumber, true)}』`;
            });

            // 일반 키워드를 숨겨진 형태로 변환
            text = text.replace(/「([^」]+)」/g, (match, keyword) => {
                const keywordNumber = KeywordManager.getKeywordNumber(currentFolderId, keyword);
                return `「${this.toCircleNumber(keywordNumber, false)}」`;
            });

            return text;
        },

        // 숨김 상태를 기반으로 키워드를 숨김 형태로 변환
        convertToHiddenKeywordsBasedOnState(text, folderId = null) {
            if (!text) return text;

            const currentFolderId = folderId || CardManager.selectedFolderId;

            // 중요 키워드 처리 - 숨김 상태인 경우만 숨김 형태로 변환
            text = text.replace(/『([^』]+)』/g, (match, keyword) => {
                const isHidden = NewKeywordManager.isKeywordHidden(currentFolderId, keyword);
                if (isHidden) {
                    const keywordNumber = KeywordManager.getKeywordNumber(currentFolderId, keyword);
                    return `『${this.toCircleNumber(keywordNumber, true)}』`;
                }
                return `『${keyword}』`;
            });

            // 일반 키워드 처리 - 숨김 상태인 경우만 숨김 형태로 변환
            text = text.replace(/「([^」]+)」/g, (match, keyword) => {
                const isHidden = NewKeywordManager.isKeywordHidden(currentFolderId, keyword);
                if (isHidden) {
                    const keywordNumber = KeywordManager.getKeywordNumber(currentFolderId, keyword);
                    return `「${this.toCircleNumber(keywordNumber, false)}」`;
                }
                return `「${keyword}」`;
            });

            return text;
        },

        // 원본 텍스트를 그대로 복사 (트리거 문자 유지)
        copyRawText(text, notification = true) {
            if (!text) return false;

            return navigator.clipboard.writeText(text).then(() => {
                return true;
            }).catch((error) => {
                console.error('❌ 클립보드 복사 실패:', error);
                return false;
            });
        },

        // 오피스 스타일 중앙 하단 알림
        showOfficeNotification(message) {
            // 기존 알림이 있으면 제거
            const existingNotification = document.querySelector('.office-notification');
            if (existingNotification) {
                existingNotification.remove();
            }

            const notification = document.createElement('div');
            notification.className = 'office-notification';
            notification.style.cssText = `
                position: fixed;
                bottom: 60px;
                left: 50%;
                transform: translateX(-50%);
                background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                color: #495057;
                padding: 12px 24px;
                border-radius: 6px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                font-size: 14px;
                font-weight: 500;
                box-shadow:
                    0 4px 12px rgba(0, 0, 0, 0.15),
                    0 2px 4px rgba(0, 0, 0, 0.1),
                    inset 0 1px 0 rgba(255, 255, 255, 0.8);
                border: 1px solid rgba(0, 0, 0, 0.1);
                z-index: 999999;
                opacity: 0;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                backdrop-filter: blur(10px);
                min-width: 200px;
                text-align: center;
                letter-spacing: 0.3px;
            `;

            notification.textContent = message;
            document.body.appendChild(notification);

            // 애니메이션으로 표시
            requestAnimationFrame(() => {
                notification.style.animation = 'officeSlideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards';
            });

            // 2초 후 사라짐
            setTimeout(() => {
                notification.style.animation = 'officeSlideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }, 2000);
        }
    };

    // ==================== 데이터 관리 ====================
    const DataManager = {
        save() {
            try {
                // 데이터 변경 시 캐시 무효화
                PerformanceUtils.invalidateCache();

                const data = {
                    cards: CardManager.cards,
                    cardCounter: CardManager.cardCounter,
                    settings: CardManager.settings,
                    focus: CardManager.focus,
                    folders: CardManager.folders,
                    selectedFolderId: CardManager.selectedFolderId,
                    // 새로운 키워드 시스템
                    keywordDatabase: CardManager.keywordDatabase,
                    cardKeywords: CardManager.cardKeywords,
                    todoKeyword: CardManager.todoKeyword,
                    // 주사위 업적 데이터
                    diceAchievements: CardManager.diceAchievements,
                    savedAt: Date.now(),
                };
                localStorage.setItem('ccfolia-card-manager', JSON.stringify(data));
                // 데이터 저장 완료
            } catch (error) {
                console.error('❌ 저장 실패:', error);
            }
        },

        load() {
            try {
                const data = localStorage.getItem('ccfolia-card-manager');
                if (data) {
                    const parsed = JSON.parse(data);
                    CardManager.cards = parsed.cards || [];
                    CardManager.cardCounter = parsed.cardCounter || 0;
                    CardManager.settings = { ...CardManager.settings, ...parsed.settings };
                    
                    // 🔧 키워드 트리거 설정 완전 제거 (이전 데이터 정리)
                    if (CardManager.settings.normalKeywordTrigger !== undefined) {
                        delete CardManager.settings.normalKeywordTrigger;
                        console.log('🧹 normalKeywordTrigger 설정 제거됨');
                    }
                    if (CardManager.settings.importantKeywordTrigger !== undefined) {
                        delete CardManager.settings.importantKeywordTrigger;
                        console.log('🧹 importantKeywordTrigger 설정 제거됨');
                    }
                    CardManager.focus = { ...CardManager.focus, ...parsed.focus };

                    // 폴더 데이터 로드 (기본 폴더는 항상 유지)
                    if (parsed.folders && parsed.folders.length > 0) {
                        CardManager.folders = parsed.folders;
                    }
                    CardManager.selectedFolderId = parsed.selectedFolderId || 'default';

                    // 새로운 키워드 시스템 로드
                    CardManager.keywordDatabase = parsed.keywordDatabase || {};
                    CardManager.cardKeywords = parsed.cardKeywords || {};

                    // TODO 키워드 패널 상태 로드
                    if (parsed.todoKeyword) {
                        CardManager.todoKeyword = { ...CardManager.todoKeyword, ...parsed.todoKeyword };
                    }
                    
                    // 주사위 업적 데이터 로드
                    if (parsed.diceAchievements) {
                        CardManager.diceAchievements = { ...CardManager.diceAchievements, ...parsed.diceAchievements };
                    }

                    // 카드 데이터 마이그레이션 수행
                    this.migrateCardData();
                    
                    // 트리거 설정 제거 후 즉시 저장
                    this.save();

                    console.log('📂 데이터 로드 완료:', CardManager.cards.length, '개 카드,', CardManager.folders.length, '개 폴더');
                }
            } catch (error) {
                console.error('❌ 로드 실패:', error);
            }
        },



        // 카드 데이터 마이그레이션 (필수 필드 보완)
        migrateCardData() {
            let migratedCount = 0;

            CardManager.cards.forEach((card, index) => {
                let needsSave = false;

                // folderId 보완
                if (!card.folderId) {
                    card.folderId = 'default';
                    needsSave = true;
                }

                // 카드 이름 보완
                if (!card.name) {
                    // 폴더 내 카드 번호 보완
                    if (!card.folderCardNumber) {
                        const folderCards = CardManager.cards.filter(c => c.folderId === card.folderId);
                        const existingNumbers = folderCards
                            .filter(c => c.folderCardNumber && c.id !== card.id)
                            .map(c => c.folderCardNumber);

                        let nextNumber = 1;
                        while (existingNumbers.includes(nextNumber)) {
                            nextNumber++;
                        }
                        card.folderCardNumber = nextNumber;
                    }

                    // 기본 이름 생성
                    const folder = CardManager.folders.find(f => f.id === card.folderId);
                    const folderName = folder ? folder.name : '폴더';
                    card.name = `${folderName} #${card.folderCardNumber}`;
                    needsSave = true;
                }

                if (needsSave) {
                    migratedCount++;
                }
            });

            if (migratedCount > 0) {
                console.log(`🔧 ${migratedCount}개의 카드 데이터가 보완되었습니다.`);
                DataManager.save(); // 마이그레이션 후 즉시 저장
            }
        },

        // ==================== Export System ====================

        exportFolder(folderId) {
            try {
                console.log('📤 폴더 내보내기 시작:', folderId);

                const folder = CardManager.folders.find(f => f.id === folderId);
                if (!folder) {
                    return;
                }

                const cards = CardManager.cards.filter(c => c.folderId === folderId);
                console.log('📊 내보내기 대상:', {
                    folder: folder.name,
                    cardCount: cards.length
                });

                const exportData = this.createExportData(folder, cards);
                this.downloadFile(exportData, folder);

            } catch (error) {
                console.error('❌ 폴더 내보내기 실패:', error);
            }
        },

        createExportData(folder, cards) {
            // 모든 폴더 키워드 수집 (카드에 연결되지 않은 키워드 포함)
            const folderKeywords = {};
            Object.values(CardManager.keywordDatabase)
                .filter(keyword => keyword.folderId === folder.id)
                .forEach(keyword => {
                    folderKeywords[keyword.id] = keyword;
                });

            // 카드-키워드 매핑 수집
            const cardKeywordMappings = {};
            cards.forEach(card => {
                if (CardManager.cardKeywords[card.id]?.length) {
                    cardKeywordMappings[card.id] = CardManager.cardKeywords[card.id];
                }
            });

            console.log('📊 내보내기 데이터 수집 완료:', {
                keywordCount: Object.keys(folderKeywords).length,
                cardKeywordMappings: Object.keys(cardKeywordMappings).length
            });

            return {
                type: 'folder',
                version: '3.0',
                exportedAt: new Date().toISOString(),
                exportedBy: 'CardManager',
                data: {
                    folder,
                    cards,
                    keywords: folderKeywords,
                    cardKeywords: cardKeywordMappings
                }
            };
        },

        downloadFile(data, folder) {
            const filename = this.generateFileName(folder.name);
            const jsonString = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setTimeout(() => URL.revokeObjectURL(url), 1000);

            console.log('✅ 파일 다운로드 완료:', filename);
        },

        generateFileName(folderName) {
            const safeName = folderName.replace(/[<>:"/\\|?*]/g, '_').substring(0, 20);
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').substring(0, 8);
            return `folder_${safeName}_${timestamp}.json`;
        },

        // ==================== Import System ====================

        handleImport(type) {
            try {
                console.log('📥 폴더 가져오기 시작');

                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.style.display = 'none';

                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        this.processImportFile(file, type);
                    }
                    document.body.removeChild(input);
                };

                document.body.appendChild(input);
                input.click();

            } catch (error) {
                console.error('❌ 파일 선택 실패:', error);
            }
        },

        processImportFile(file, type) {
            console.log('📄 파일 처리 시작:', file.name);

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    this.importFolderData(data);
                } catch (error) {
                    console.error('❌ JSON 파싱 실패:', error);
                }
            };

            reader.onerror = () => {
                console.error('❌ 파일 읽기 실패');
            };

            reader.readAsText(file);
        },

        importFolderData(importData) {
            try {
                // 데이터 유효성 검사
                if (!this.validateImportData(importData)) {
                    return;
                }

                const { folder, cards, keywords, cardKeywords } = importData.data;
                console.log('📊 가져오기 데이터 분석:', {
                    folderName: folder.name,
                    cardCount: cards.length,
                    keywordCount: keywords ? Object.keys(keywords).length : 0
                });

                // 폴더 생성
                const newFolder = this.createImportFolder(folder);
                CardManager.folders.push(newFolder);
                console.log('✅ 폴더 생성:', newFolder.name);

                // 키워드 매핑 테이블 생성
                const keywordIdMapping = this.createKeywordMapping(keywords, newFolder.id);
                console.log('✅ 키워드 매핑 생성:', Object.keys(keywordIdMapping).length);

                // 카드 가져오기
                const importedCards = this.importCards(cards, newFolder.id);
                console.log('✅ 카드 가져오기 완료:', importedCards.length);

                // 카드-키워드 연결 복원
                this.restoreCardKeywordLinks(cardKeywords, importedCards, cards, keywordIdMapping);
                console.log('✅ 카드-키워드 연결 복원 완료');

                // 완료 처리
                CardManager.selectedFolderId = newFolder.id;
                DataManager.save();
                UI.renderFolders();
                UI.renderCards();

            } catch (error) {
                console.error('❌ 폴더 가져오기 실패:', error);
            }
        },

        validateImportData(data) {
            if (!data || data.type !== 'folder') {
                return false;
            }

            if (!data.data || !data.data.folder || !Array.isArray(data.data.cards)) {
                return false;
            }

            return true;
        },

        createImportFolder(folderData) {
            let folderName = folderData.name || '이름없는 폴더';
            let counter = 1;

            // 중복된 폴더명 처리
            const originalName = folderName;
            while (CardManager.folders.find(f => f.name === folderName)) {
                folderName = `${originalName} (${counter++})`;
            }

            return {
                ...folderData,
                id: `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: folderName,
                importedAt: Date.now()
            };
        },

        createKeywordMapping(keywords, newFolderId) {
            const mapping = {};

            if (!keywords) return mapping;

            Object.entries(keywords).forEach(([oldId, keyword]) => {
                const newId = `keyword-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                mapping[oldId] = newId;

                // 새로운 키워드 데이터베이스에 추가
                CardManager.keywordDatabase[newId] = {
                    ...keyword,
                    id: newId,
                    folderId: newFolderId,
                    importedAt: Date.now()
                };
            });

            return mapping;
        },

        importCards(cards, folderId) {
            return cards.map((cardData, index) => {
                const newCard = {
                    ...cardData,
                    id: `card-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
                    number: ++CardManager.cardCounter,
                    folderId: folderId,
                    folderCardNumber: index + 1,
                    importedAt: Date.now()
                };

                CardManager.cards.push(newCard);
                return newCard;
            });
        },

        restoreCardKeywordLinks(cardKeywords, importedCards, originalCards, keywordIdMapping) {
            if (!cardKeywords) return;

            importedCards.forEach((newCard, index) => {
                const originalCard = originalCards[index];
                if (originalCard && cardKeywords[originalCard.id]) {
                    // 기존 키워드 ID를 새로운 키워드 ID로 매핑
                    const newKeywordIds = cardKeywords[originalCard.id]
                        .map(oldKeywordId => keywordIdMapping[oldKeywordId])
                        .filter(Boolean); // 매핑되지 않은 키워드 제외

                    if (newKeywordIds.length > 0) {
                        CardManager.cardKeywords[newCard.id] = newKeywordIds;
                    }
                }
            });
        }

    };

    // ==================== UI 관리 ====================
    const UI = {
        // 트리거 버튼 생성
        createTriggerButton() {
            // 기존 버튼 제거
            document.querySelectorAll('.ccfolia-card-trigger').forEach(btn => btn.remove());

            const button = document.createElement('div');
            button.className = 'ccfolia-card-trigger';
            button.innerHTML = '🃏<br>카드';
            button.title = '알고있었어 카드 관리자';
            button.setAttribute('data-ccfolia-button', 'true');

            // 강력한 스타일 적용
            // 높이를 조절하는 코드 - 설정값 적용
            const topPosition = CardManager.settings.buttonPosition ? CardManager.settings.buttonPosition.top : 50;

            button.style.cssText = `
                position: fixed !important;
                left: 0 !important;
                top: ${topPosition}% !important;
                transform: translateY(-50%) !important;
                z-index: 2147483647 !important;
                width: 60px !important;
                height: 80px !important;
                background: linear-gradient(135deg, #4A2C17, #5D3F1A) !important;
                color: white !important;
                display: flex !important;
                visibility: visible !important;
                opacity: 1 !important;
                align-items: center !important;
                justify-content: center !important;
                text-align: center !important;
                font-size: 12px !important;
                font-weight: bold !important;
                font-family: Arial, sans-serif !important;
                cursor: pointer !important;
                border: none !important;
                border-radius: 0 12px 12px 0 !important;
                box-shadow: 0 4px 20px rgba(139, 111, 71, 0.3) !important;
                user-select: none !important;
                transition: all 0.3s ease !important;
                pointer-events: auto !important;
                margin: 0 !important;
                padding: 0 !important;
            `;

            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🎯 트리거 버튼 클릭됨');
                this.togglePanel();
            });

            button.addEventListener('mouseenter', () => {
                button.style.transform = 'translateY(-50%) translateX(8px) !important';
                button.style.background = 'linear-gradient(135deg, #5D3F1A, #6D4F2A) !important';
            });

            button.addEventListener('mouseleave', () => {
                button.style.transform = 'translateY(-50%) !important';
                button.style.background = 'linear-gradient(135deg, #4A2C17, #5D3F1A) !important';
            });

            // DOM에 안전하게 추가
            if (document.body) {
                document.body.appendChild(button);
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    document.body.appendChild(button);
                });
            }

            // 버튼 가시성 확인
            setTimeout(() => {
                const addedButton = document.querySelector('.ccfolia-card-trigger');
                if (addedButton) {
                    console.log('✅ 트리거 버튼이 생성되었습니다:', {
                        position: addedButton.style.position,
                        zIndex: addedButton.style.zIndex,
                        display: addedButton.style.display,
                        visibility: addedButton.style.visibility,
                        opacity: addedButton.style.opacity
                    });
                    // 버튼을 웹사이트 높이 중앙으로 설정
                    UI.setButtonToCenter();
                } else {
                    console.warn('⚠️ 트리거 버튼을 찾을 수 없습니다!');
                }
            }, 100);

            // 트리거 버튼 생성 완료
        },


        // 패널 토글
        togglePanel() {
            const panel = document.querySelector('.ccfolia-card-panel') || this.createPanel();

            if (CardManager.isVisible) {
                // 패널을 숨길 때 드래그 인스턴스 정리
                AdvancedDragSystem.removeInstance(panel);
                
                panel.style.display = 'none';
                CardManager.isVisible = false;
            } else {
                panel.style.display = 'flex';
                CardManager.isVisible = true;

                // 현재 카드 레이아웃에 맞는 패널 넓이 조정
                this.adjustPanelWidth(CardManager.settings.cardLayout.cardsPerRow);

                this.renderFolders();
                this.renderCards();

                // 저장된 폴더 사이드바 상태 복원
                this.restoreFolderSidebarState();

                // 메인 컨텐츠 클릭 이벤트 추가 (이미 있는 패널에도 적용)
                this.addMainContentClickListener(panel);

                // 패널에 드래그 기능 추가
                const header = panel.querySelector('.panel-header');
                if (header) {
                    AdvancedDragSystem.createInstance(panel, header);
                } else {
                    console.error('❌ 메인 패널 헤더를 찾을 수 없음!');
                }
            }
        },

        // 메인 패널 생성
        createPanel() {
            const panel = document.createElement('div');
            panel.className = 'ccfolia-card-panel';
            // 현재 카드 레이아웃에 따른 초기 넓이 설정
            const cardsPerRow = CardManager.settings.cardLayout.cardsPerRow;
            let initialWidth, initialMaxWidth;

            switch (cardsPerRow) {
                case 1:
                    initialWidth = '50vw';
                    initialMaxWidth = '600px';
                    break;
                case 2:
                    initialWidth = '75vw';
                    initialMaxWidth = '900px';
                    break;
                case 3:
                    initialWidth = '90vw';
                    initialMaxWidth = '1200px';
                    break;
                default:
                    initialWidth = '75vw';
                    initialMaxWidth = '900px';
            }

            panel.style.cssText = `
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                width: ${initialWidth};
                max-width: ${initialMaxWidth};
                height: 80vh;
                background: #FFFBF5;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(44, 24, 16, 0.15);
                border: 1px solid rgba(139, 111, 71, 0.2);
                z-index: 999998;
                display: none;
                flex-direction: column;
                overflow: hidden;
                font-family: 'Paperozi', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Malgun Gothic', sans-serif;
            `;

            panel.innerHTML = `
                <!-- 간결한 헤더 -->
                <div class="panel-header" style="
                    background: var(--detective-dark);
                    color: var(--detective-paper);
                    padding: 12px 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid rgba(139, 111, 71, 0.2);
                ">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.1em;">🔍</span>
                        <h2 style="
                            margin: 0;
                            font-size: 1.1em;
                            font-weight: 600;
                        ">케이스 파일 매니저</h2>
                    </div>

                    <div style="display: flex; gap: 8px;">
                        <button onclick="UI.togglePanel()" style="
                            background: #dc3545;
                            color: white;
                            border: none;
                            width: 24px;
                            height: 24px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 12px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        " onmouseover="this.style.background='#c82333'"
                           onmouseout="this.style.background='#dc3545'">
                            ×
                        </button>
                    </div>
                </div>

                <!-- 간결한 패널 컨텐츠 -->
                <div class="panel-content" style="flex: 1; display: flex; overflow: hidden;">
                    <!-- 간결한 폴더 사이드바 -->
                    <div class="folder-sidebar" style="
                        width: 240px;
                        background: #F8F4ED;
                        border-right: 1px solid rgba(139, 111, 71, 0.2);
                        padding: 16px;
                        overflow-y: auto;
                    ">
                        <div style="
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            margin-bottom: 16px;
                            padding-bottom: 12px;
                            border-bottom: 1px solid rgba(139, 111, 71, 0.2);
                        ">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 16px;">📁</span>
                                <h3 style="
                                    margin: 0;
                                    color: var(--detective-dark);
                                    font-size: 14px;
                                    font-weight: 600;
                                ">케이스 폴더</h3>
                            </div>
                            <div style="display: flex; gap: 4px;">
                                <button onclick="FolderManager.createFolder()" style="
                                    background: var(--detective-accent);
                                    color: white;
                                    border: none;
                                    width: 24px;
                                    height: 24px;
                                    border-radius: 4px;
                                    cursor: pointer;
                                    font-size: 12px;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                " onmouseover="this.style.background='var(--detective-medium)'"
                                   onmouseout="this.style.background='var(--detective-accent)'"
                                   title="새 폴더 생성">+</button>
                                <button onclick="window.UI.toggleFolderSidebar()" style="
                                    background: transparent;
                                    color: var(--detective-medium);
                                    border: 1px solid rgba(139, 111, 71, 0.3);
                                    width: 24px;
                                    height: 24px;
                                    border-radius: 4px;
                                    cursor: pointer;
                                    font-size: 10px;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                " onmouseover="this.style.background='rgba(139, 111, 71, 0.1)'"
                                   onmouseout="this.style.background='transparent'"
                                   title="폴더 패널 접기">◀</button>
                            </div>
                        </div>
                        <div class="folder-list"></div>
                    </div>

                    <!-- 간결한 메인 컨텐츠 -->
                    <div class="main-content" style="
                        flex: 1;
                        padding: 0;
                        overflow-y: auto;
                        background: #FFFBF5;
                        position: relative;
                    ">
                        <!-- 폴더 토글 버튼 (사이드바가 숨겨졌을 때만 표시) -->
                        <div class="folder-toggle-tab" style="
                            position: fixed;
                            left: 0;
                            top: 0;
                            bottom: 0;
                            width: 8px;
                            height: 100vh;
                            background: transparent;
                            border-radius: 0 4px 4px 0;
                            border-top: 1px solid transparent;
                            border-right: 1px solid transparent;
                            border-bottom: 1px solid transparent;
                            box-shadow: none;
                            display: none;
                            align-items: center;
                            justify-content: center;
                            font-size: 8px;
                            color: transparent;
                            cursor: pointer;
                            z-index: 9999;
                            transition: all 0.3s ease;
                            user-select: none;
                            text-shadow: none;
                            writing-mode: vertical-rl;
                            text-orientation: mixed;
                            letter-spacing: 0.5px;
                            font-weight: 400;
                        " onclick="window.UI.toggleFolderSidebar()" title="폴더 패널 열기" onmouseover="this.style.width='16px'; this.style.background='#654321'; this.style.borderTop='1px solidrgb(40, 26, 13)'; this.style.borderRight='1px solidrgb(30, 18, 8)'; this.style.borderBottom='1px solidrgb(35, 22, 10)'; this.style.boxShadow='1px 0 4px rgba(80, 50, 20, 0.4), inset 1px 0 0 rgba(120, 60, 30, 0.4)'; this.style.color='#F5DEB3'; this.style.textShadow='0 1px 1px rgba(0, 0, 0, 0.6)';" onmouseout="this.style.width='10px'; this.style.background='transparent'; this.style.borderTop='1px solid transparent'; this.style.borderRight='1px solid transparent'; this.style.borderBottom='1px solid transparent'; this.style.boxShadow='none'; this.style.color='transparent'; this.style.textShadow='none';">
                        </div>

                        <!-- 간결한 컨트롤 바 -->
                        <div style="
                            background: white;
                            border-bottom: 1px solid rgba(139, 111, 71, 0.2);
                            padding: 16px 20px;
                        ">
                            <div style="
                                display: flex;
                                gap: 10px;
                                flex-wrap: wrap;
                                align-items: center;
                                justify-content: space-between;
                            ">
                                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                    <button onclick="CardActions.createCard()" style="
                                        background: var(--detective-dark);
                                        color: white;
                                        border: none;
                                        padding: 10px 16px;
                                        border-radius: 4px;
                                        cursor: pointer;
                                        font-size: 13px;
                                        font-weight: 600;
                                    " onmouseover="this.style.background='var(--detective-medium)'"
                                       onmouseout="this.style.background='var(--detective-dark)'">➕ 새 카드</button>

                                    <button onclick="UI.expandAllCards()" style="
                                        background: transparent;
                                        color: var(--detective-medium);
                                        border: 1px solid rgba(139, 111, 71, 0.3);
                                        padding: 8px 12px;
                                        border-radius: 4px;
                                        cursor: pointer;
                                        font-size: 12px;
                                    " onmouseover="this.style.background='rgba(139, 111, 71, 0.1)'"
                                       onmouseout="this.style.background='transparent'">📂 모두 펼치기</button>
                                    <button onclick="UI.collapseAllCards()" style="
                                        background: transparent;
                                        color: var(--detective-medium);
                                        border: 1px solid rgba(139, 111, 71, 0.3);
                                        padding: 8px 12px;
                                        border-radius: 4px;
                                        cursor: pointer;
                                        font-size: 12px;
                                    " onmouseover="this.style.background='rgba(139, 111, 71, 0.1)'"
                                       onmouseout="this.style.background='transparent'">📁 모두 접기</button>
                                </div>

                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <button onclick="DataManager.handleImport('folder')" style="
                                        background: #4A7C3A;
                                        color: white;
                                        border: none;
                                        padding: 8px 12px;
                                        border-radius: 4px;
                                        cursor: pointer;
                                        font-size: 12px;
                                    " onmouseover="this.style.background='#3D6B2F'"
                                       onmouseout="this.style.background='#4A7C3A'"
                                       title="폴더 가져오기">📥 가져오기</button>

                                    <button onclick="UI.showKeywordManagementPanel()" style="
                                        background: transparent;
                                        color: var(--detective-medium);
                                        border: 1px solid rgba(139, 111, 71, 0.3);
                                        padding: 8px 12px;
                                        border-radius: 4px;
                                        cursor: pointer;
                                        font-size: 12px;
                                    " onmouseover="this.style.background='rgba(139, 111, 71, 0.1)'"
                                       onmouseout="this.style.background='transparent'"
                                       title="키워드 관리">📌 키워드</button>

                                    <button onclick="UI.showSettingsPanel()" style="
                                        background: transparent;
                                        color: var(--detective-medium);
                                        border: 1px solid rgba(139, 111, 71, 0.3);
                                        padding: 8px 12px;
                                        border-radius: 4px;
                                        cursor: pointer;
                                        font-size: 12px;
                                    " onmouseover="this.style.background='rgba(139, 111, 71, 0.1)'"
                                       onmouseout="this.style.background='transparent'"
                                       title="설정">⚙️ 설정</button>
                                </div>
                            </div>
                        </div>

                        <!-- 카드 컨테이너 -->
                        <div class="cards-container" style="padding: 20px;"></div>
                    </div>
                </div>
            `;

            document.body.appendChild(panel);

            // 드래그 기능 활성화
            const header = panel.querySelector('.panel-header');
            AdvancedDragSystem.createInstance(panel, header);

            // 투명도 적용
            Utils.applyOpacity(panel, 'default');

            // 패널 상태 복원 (약간의 지연 후)
            setTimeout(() => {
                this.restoreFolderSidebarState();
                // 메인 컨텐츠 클릭 이벤트 추가 (메모리 요구사항)
                this.addMainContentClickListener(panel);
            }, 150);

            return panel;
        },

        // 메인 컨텐츠 클릭 이벤트 리스너 추가
        addMainContentClickListener(panel) {
            const mainContent = panel.querySelector('.main-content');
            if (!mainContent) {
                console.warn('⚠️ 메인 컨텐츠를 찾을 수 없어 클릭 이벤트를 추가할 수 없습니다.');
                return;
            }

            mainContent.addEventListener('click', (e) => {
                // 왼쪽 40px 영역에서만 클릭 인식
                const rect = mainContent.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;
                const elementHeight = rect.height;

                // X 좌표가 40px 이내이고, Y 좌표가 중앙 50% 영역(25%~75%)에 있을 때만 반응
                if (clickX <= 40 && 
                    clickY >= elementHeight * 0.25 && 
                    clickY <= elementHeight * 0.75) {
                    
                    // 폴더 사이드바가 숨겨진 상태에서만 동작
                    if (CardManager.settings.folderSidebarCollapsed) {
                        console.log('📝 메인 컨텐츠 왼쪽 영역 클릭 감지 - 폴더 토글 실행');
                        this.toggleFolderSidebar();
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }
            });

            console.log('📝 메인 컨텐츠 클릭 이벤트 리스너가 추가되었습니다.');
        },

        // 폴더 렌더링 (캐시 최적화)
        renderFolders() {
            const folderList = document.querySelector('.folder-list');
            if (!folderList) return;

            const foldersHtml = CardManager.folders.map(folder => {
                const cardCount = PerformanceUtils.getFolderCardCount(folder.id);
                const isSelected = CardManager.selectedFolderId === folder.id;

                return `
                    <div class="folder-item ${isSelected ? 'selected' : ''}"
                         style="
                            padding: 10px 12px;
                            margin-bottom: 6px;
                            border-radius: 6px;
                            cursor: pointer;
                            background: ${isSelected ? 'var(--detective-accent)' : 'white'};
                            color: ${isSelected ? 'white' : 'var(--detective-text)'};
                            border: 1px solid ${isSelected ? 'var(--detective-accent)' : 'rgba(44, 24, 16, 0.1)'};
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            transition: all 0.2s ease;
                         "
                         onmouseover="if(!${isSelected}) { this.style.background='var(--detective-light)'; this.style.borderColor='var(--detective-accent)'; }"
                         onmouseout="if(!${isSelected}) { this.style.background='white'; this.style.borderColor='rgba(44, 24, 16, 0.1)'; }"
                         onclick="FolderManager.selectFolder('${folder.id}')">
                        <span style="
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            font-size: 14px;
                            font-weight: ${isSelected ? '600' : '400'};
                        ">
                            <span style="opacity: 0.8;">📁</span>
                            ${folder.name}
                            <span style="
                                background: ${isSelected ? 'rgba(255,255,255,0.2)' : 'var(--detective-light)'};
                                padding: 2px 6px;
                                border-radius: 10px;
                                font-size: 11px;
                            ">${cardCount}</span>
                        </span>
                        <button onclick="event.stopPropagation(); FolderManager.showFolderMenu('${folder.id}', event)" style="
                            background: none;
                            border: none;
                            color: ${isSelected ? 'rgba(255,255,255,0.7)' : 'var(--detective-text-light)'};
                            cursor: pointer;
                            padding: 4px;
                            border-radius: 3px;
                            transition: all 0.2s ease;
                        " onmouseover="this.style.background='rgba(0,0,0,0.1)'"
                           onmouseout="this.style.background='none'">⋮</button>
                    </div>
                `;
            }).join('');

            // DocumentFragment 사용으로 DOM 업데이트 최적화
            const fragment = PerformanceUtils.createElementsFromHTML(foldersHtml);
            folderList.innerHTML = '';
            folderList.appendChild(fragment);
        },

        // 카드 렌더링
        renderCards() {
            const container = document.querySelector('.cards-container');
            if (!container) return;

            // 집중 모드인 경우
            if (CardManager.viewMode === 'focus') {
                this.renderFocusMode();
                return;
            }

            // 현재 선택된 폴더의 카드만 필터링 (캐시 사용)
            const filteredCards = PerformanceUtils.getFilteredCards(CardManager.selectedFolderId);

            if (filteredCards.length === 0) {
                const selectedFolder = CardManager.folders.find(f => f.id === CardManager.selectedFolderId);
                container.innerHTML = `
                    <div style="text-align: center; padding: 60px; color: #6D4C2F;">
                        <div style="font-size: 4em; margin-bottom: 20px;">🃏</div>
                        <h3>${selectedFolder?.name || '현재 폴더'}에 카드가 없습니다</h3>
                        <p>위의 "새 카드" 버튼을 클릭해서 카드를 만들어보세요!</p>
                        <div style="margin-top: 20px; font-size: 0.9em; color: #6D4C2F;">
                            💡 키워드 사용법:<br>
                            • 번호 참조: [1], #1 → 해당 번호의 키워드가 표시됩니다<br>
                            • 키워드는 키워드 목록에서 직접 관리합니다
                        </div>
                    </div>
                `;
                return;
            }

            const cardsHtml = filteredCards.map(card => {
                const stats = Utils.getKeywordStats(card.content);
                const previewText = card.content ? card.content.substring(0, 100) + (card.content.length > 100 ? '...' : '') : '내용이 없습니다.';

                return `
                    <div class="card-item" style="
                        background: var(--detective-paper);
                        border-radius: 8px;
                        box-shadow:
                            0 2px 8px rgba(44, 24, 16, 0.08),
                            0 0 0 1px rgba(44, 24, 16, 0.06);
                        overflow: hidden;
                        transition: all 0.3s ease;
                        cursor: pointer;
                        display: flex;
                        flex-direction: column;
                        height: ${card.isExpanded ? 'auto' : 'fit-content'};
                        min-height: 280px;
                    " onmouseover="
                        this.style.transform='translateY(-2px)';
                        this.style.boxShadow='0 4px 16px rgba(44, 24, 16, 0.12), 0 0 0 1px var(--detective-accent)';
                    "
                    onmouseout="
                        this.style.transform='translateY(0)';
                        this.style.boxShadow='0 2px 8px rgba(44, 24, 16, 0.08), 0 0 0 1px rgba(44, 24, 16, 0.06)';
                    "
                    onclick="if (!event.target.closest('button')) UI.toggleCard('${card.id}')">

                        <!-- 카드 헤더 -->
                        <div class="card-header" style="
                            background: linear-gradient(135deg, var(--detective-medium), var(--detective-accent));
                            color: var(--detective-paper);
                            padding: 14px 16px;
                            position: relative;
                            flex-shrink: 0;
                        ">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <h4 style="
                                        margin: 0;
                                        font-size: 15px;
                                        font-weight: 600;
                                        display: flex;
                                        align-items: center;
                                        gap: 6px;
                                    ">
                                        <span style="
                                            background: rgba(255,255,255,0.2);
                                            padding: 2px 8px;
                                            border-radius: 4px;
                                            font-size: 12px;
                                        ">
                                            #${card.folderCardNumber || card.number}
                                        </span>
                                        ${card.name || '제목 없음'}
                                    </h4>
                                    ${stats.total > 0 ? `
                                        <span style="
                                            opacity: 0.9;
                                            font-size: 12px;
                                            margin-top: 2px;
                                            display: inline-block;
                                        ">
                                            키워드 ${stats.total}개 (일반 ${stats.normal}, 중요 ${stats.important})
                                        </span>
                                    ` : ''}
                                </div>
                                <span style="font-size: 16px; opacity: 0.9;">
                                    ${card.isExpanded ? '📂' : '📁'}
                                </span>
                            </div>
                        </div>

                        <!-- 카드 내용 미리보기 (버튼 제외) -->
                        <div class="card-preview" style="
                            flex: 1;
                            padding: 16px;
                            display: ${card.isExpanded ? 'none' : 'block'};
                            min-height: 120px;
                        ">
                            <div style="
                                background: var(--detective-light);
                                border-radius: 6px;
                                padding: 12px;
                                font-size: 14px;
                                line-height: 1.7;
                                color: var(--detective-text);
                                border: 1px solid rgba(44, 24, 16, 0.05);
                                word-break: keep-all;
                                white-space: pre-line;
                                overflow-wrap: break-word;
                                text-rendering: optimizeLegibility;
                                max-height: 150px;
                                overflow: hidden;
                                position: relative;
                            ">
                                ${NewKeywordManager.renderCardContent(card.id, previewText) || '내용이 없습니다.'}
                                ${card.content && card.content.length > 100 ?
                        '<div style="position: absolute; bottom: 0; left: 0; right: 0; height: 30px; background: linear-gradient(to bottom, transparent, var(--detective-light)); pointer-events: none;"></div>' : ''}
                            </div>
                        </div>

                        <!-- 액션 버튼들 (접혔을 때도 항상 표시) -->
                        <div class="card-actions" style="
                            padding: 12px 16px;
                            background: linear-gradient(to bottom, rgba(44, 24, 16, 0.02), rgba(44, 24, 16, 0.05));
                            border-top: 1px solid rgba(44, 24, 16, 0.08);
                            display: flex;
                            gap: 6px;
                            flex-wrap: wrap;
                            justify-content: space-between;
                            align-items: center;
                            margin-top: auto;
                        ">
                            <div style="display: flex; gap: 6px; flex: 1;">
                                <button onclick="event.stopPropagation(); window.UI && window.UI.activateFocusMode('${card.id}')"
                                        title="집중 모드"
                                        style="
                                            background: var(--detective-accent);
                                            color: white;
                                            border: none;
                                            padding: 6px 12px;
                                            border-radius: 4px;
                                            cursor: pointer;
                                            font-size: 12px;
                                            font-weight: 500;
                                            transition: all 0.2s ease;
                                            flex: 1;
                                            max-width: 70px;
                                        "
                                        onmouseover="this.style.background='var(--detective-medium)'; this.style.transform='translateY(-1px)'"
                                        onmouseout="this.style.background='var(--detective-accent)'; this.style.transform='translateY(0)'">
                                    🔎
                                </button>
                                <button onclick="event.stopPropagation(); UI.showKeywordManagementPanel()"
                                        title="키워드 관리"
                                        style="
                                            background: var(--detective-medium);
                                            color: white;
                                            border: none;
                                            padding: 6px 12px;
                                            border-radius: 4px;
                                            cursor: pointer;
                                            font-size: 12px;
                                            font-weight: 500;
                                            transition: all 0.2s ease;
                                            flex: 1;
                                            max-width: 70px;
                                        "
                                        onmouseover="this.style.background='var(--detective-accent)'; this.style.transform='translateY(-1px)'"
                                        onmouseout="this.style.background='var(--detective-medium)'; this.style.transform='translateY(0)'">
                                    📌
                                </button>
                                <button onclick="event.stopPropagation(); CardActions.copyCardText('${card.id}')"
                                        title="텍스트 복사"
                                        style="
                                            background: var(--detective-dark);
                                            color: white;
                                            border: none;
                                            padding: 6px 12px;
                                            border-radius: 4px;
                                            cursor: pointer;
                                            font-size: 12px;
                                            font-weight: 500;
                                            transition: all 0.2s ease;
                                            flex: 1;
                                            max-width: 70px;
                                        "
                                        onmouseover="this.style.opacity='0.8'; this.style.transform='translateY(-1px)'"
                                        onmouseout="this.style.opacity='1'; this.style.transform='translateY(0)'">
                                    📋
                                </button>
                            </div>

                            <!-- 펼치기/접기 인디케이터 -->
                            <div style="
                                display: flex;
                                align-items: center;
                                gap: 4px;
                                color: var(--detective-text-light);
                                font-size: 11px;
                            ">
                                <span>${card.isExpanded ? '접기' : '펼치기'}</span>
                                <span style="font-size: 14px; transition: transform 0.3s ease; transform: rotate(${card.isExpanded ? '180deg' : '0'});">▼</span>
                            </div>
                        </div>

                        <div class="card-expanded-content" style="display: ${card.isExpanded ? 'block' : 'none'}; padding: 16px; background: #F5F0E8;">
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; margin-bottom: 6px; font-weight: bold; color: #2C1810; font-size: 12px;">📝 카드 이름</label>
                                <input type="text"
                                       value="${card.name || `카드 #${card.number}`}"
                                       onchange="CardActions.updateCardName('${card.id}', this.value)"
                                       onclick="event.stopPropagation()"
                                       placeholder="카드 이름을 입력하세요"
                                       style="width: calc(100% - 8px); border: 1px solid #D4C4B8; border-radius: 6px; padding: 8px 12px; font-size: 13px; font-weight: 600; box-sizing: border-box;">
                            </div>
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; margin-bottom: 6px; font-weight: bold; color: #2C1810; font-size: 12px;">📄 카드 내용</label>
                                <textarea
                                    style="width: calc(100% - 8px); min-height: 120px; border: 1px solid #D4C4B8; border-radius: 8px; padding: 12px; font-family: inherit; resize: vertical; font-size: 14px; line-height: 1.6; box-sizing: border-box; word-break: keep-all; overflow-wrap: break-word;"
                                    placeholder="카드 내용을 입력하세요...&#10;번호 참조: [1], #1"
                                    onchange="CardActions.updateCard('${card.id}', this.value)"
                                    onclick="event.stopPropagation()"
                                >${card.content || ''}</textarea>
                            </div>
                            <div style="background: #E8DDD0; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
                                <label style="display: block; margin-bottom: 6px; font-weight: bold; color: #2C1810; font-size: 12px;">👁️ 미리보기</label>
                                <div style="line-height: 1.8; color: #2C1810; font-size: 14px; word-break: keep-all; white-space: pre-line; overflow-wrap: break-word;">
                                    ${NewKeywordManager.renderCardContent(card.id, card.content) || '내용이 없습니다.'}
                                </div>
                            </div>
                            <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
                                <select onchange="CardActions.moveCardToFolder('${card.id}', this.value)"
                                        onclick="event.stopPropagation()"
                                        style="border: 1px solid #D4C4B8; border-radius: 4px; padding: 6px; font-size: 12px; max-width: 140px;">
                                    ${CardManager.folders.map(folder => `<option value="${folder.id}" ${card.folderId === folder.id ? 'selected' : ''}>${folder.name}</option>`).join('')}
                                </select>
                                <button onclick="event.stopPropagation(); window.UI && window.UI.activateFocusMode('${card.id}')"
                                        title="집중 모드"
                                        style="background: #5D3F1A; color: #F5F0E8; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
                                    🎯 집중
                                </button>
                                <button onclick="event.stopPropagation(); UI.showKeywordManagementPanel()"
                                        title="키워드 관리 (폴더 공용)"
                                        style="background: #5D3F1A; color: #F5F0E8; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
                                    🏷️ 키워드
                                </button>
                                <button onclick="event.stopPropagation(); CardActions.copyCard('${card.id}')"
                                        title="카드 복사 (새 카드 생성)"
                                        style="background:  #5D3F1A;color: #F5F0E8; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
                                    🗂️ 카드복사
                                </button>
                                <button onclick="event.stopPropagation(); CardActions.copyCardText('${card.id}')"
                                        title="텍스트 복사 (트리거 문자를 키워드로 변환하여 복사, 숨김 키워드는 번호로 복사됨)"
                                        style="background: #5D3F1A; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
                                    📋 텍스트복사
                                </button>
                                <button onclick="event.stopPropagation(); CardActions.deleteCard('${card.id}')"
                                        title="카드 삭제"
                                        style="background: #5D3F1A; color: #F5F0E8; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
                                    🗑️ 삭제
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            const layoutClass = `layout-${CardManager.settings.cardLayout.cardsPerRow}`;
            container.innerHTML = `
                <div class="cards-grid ${layoutClass}">${cardsHtml}</div>
            `;
        },

        // 카드 토글
        toggleCard(cardId) {
            const card = CardManager.cards.find(c => c.id === cardId);
            if (card) {
                card.isExpanded = !card.isExpanded;
                this.renderCards();
                DataManager.save();
            }
        },


        // 집중 모드 활성화 (새로운 함수)
        activateFocusMode(cardId) {
            // 집중 모드 활성화 시도

            if (!cardId) {
                console.error('❌ 카드 ID가 없습니다.');
                return;
            }

            const card = CardManager.cards.find(c => c.id === cardId);
            if (!card) {
                console.error(`❌ 카드를 찾을 수 없습니다: ${cardId}`);
                return;
            }

            // 집중된 카드 ID 설정
            CardManager.focusedCardId = cardId;

            // 집중 패널 생성
            this.createFocusPanel();

            // 데이터 저장
            DataManager.save();
        },

        // 집중 모드 진입 (기존 키워드 상태 유지)
        enterFocusMode(cardId) {
            CardManager.focusedCardId = cardId;

            const focusedCard = CardManager.cards.find(card => card.id === cardId);
            if (focusedCard) {
                console.log(`🎯 집중 모드 진입: "${focusedCard.name}" (기존 키워드 상태 유지)`);
            }

            // 집중 모드 패널 생성 (기존 키워드 상태를 변경하지 않음)
            this.createFocusPanel();

            DataManager.save();
        },

        // 독립된 집중 모드 패널 생성
        createFocusPanel() {
            // 기존 집중 패널이 있으면 제거
            const existingPanel = document.querySelector('.ccfolia-focus-panel');
            if (existingPanel) {
                existingPanel.remove();
            }

            const focusedCard = CardManager.cards.find(card => card.id === CardManager.focusedCardId);
            if (!focusedCard) {
                console.error('❌ 집중된 카드를 찾을 수 없음');
                return;
            }

            const focusPanel = document.createElement('div');
            focusPanel.className = 'ccfolia-focus-panel';
            // 🔧 집중 모드 패널 크기 사용자 정의 가이드
            //
            // 1. 사용자 정의 크기: 사용자가 직접 조절한 너비(customWidth)와 높이(customHeight)가 최우선으로 적용됩니다.
            // 2. 프리셋 크기: '크기 조절' 버튼으로 선택한 'small', 'medium', 'large' 크기가 다음으로 적용됩니다.
            // 3. 기본값: 위 설정이 모두 없으면 'medium' 크기가 기본으로 사용됩니다.
            //
            // 📐 기본 크기 설정:
            // - width: 650px (패널의 기본 너비, 원하는 픽셀값으로 변경 가능)
            // - max-width: 90vw (화면 너비의 90%, 50vw~95vw 사이 추천)
            // - max-height: 80vh (화면 높이의 80%, 60vh~90vh 사이 추천)
            //
            // 📱 반응형 설정 옵션:
            // - 작은 화면용: width: 400px, max-width: 95vw
            // - 큰 화면용: width: 800px, max-width: 85vw
            // - 전체화면용: width: 90vw, max-height: 90vh
            //
            // 🎨 테두리와 그림자 사용자 정의:
            // - border-radius: 20px (모서리 둥글기, 0~30px 추천)
            // - box-shadow: 그림자 효과 (0 10px 30px rgba(0,0,0,0.1) 등으로 변경 가능)
            //
            // 저장된 패널 크기 설정 적용 (사용자 정의 크기 우선)
            const customWidth = CardManager.settings.focusMode?.customWidth;
            const customHeight = CardManager.settings.focusMode?.customHeight;
            const savedPanelSize = CardManager.settings.focusMode?.panelSize || 'medium';
            const sizes = {
                small: { width: '800px', maxHeight: '70vh' },
                medium: { width: '1000px', maxHeight: '80vh' },
                large: { width: '1200px', maxHeight: '85vh' }
            };
            const currentSize = sizes[savedPanelSize] || sizes.medium;

            const focusSettings = CardManager.settings.focusMode;
            focusPanel.style.cssText = `
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                width: ${customWidth ? customWidth + 'px' : currentSize.width};
                height: ${customHeight ? customHeight + 'px' : currentSize.maxHeight};
                max-width: 95vw;
                max-height: 90vh;
                z-index: 999999;
                backdrop-filter: blur(8px);
            `;

            const processedContent = Utils.parseFocusKeywords(focusedCard.content, focusedCard.folderId);
            const isKeywordCollapsed = CardManager.settings.focusMode?.keywordListCollapsed;

            focusPanel.innerHTML = `
                <!-- 사이드바: 키워드 및 설정 (설정에 따라 표시/비표시) -->
                ${!isKeywordCollapsed ? `
                <div class="focus-sidebar">
                    <div class="focus-sidebar-header">
                        <div class="sidebar-header-content">
                            <div class="sidebar-title-section">
                                <button id="keyword-collapse-btn" class="collapse-btn" onclick="window.UI.toggleKeywordListCollapse()" title="키워드 목록 제거">
                                    ×
                                </button>
                                <h3 class="focus-sidebar-title">키워드 목록</h3>
                            </div>
                            <div class="focus-sidebar-controls">
                                <button onclick="window.UI.showAllKeywords()" title="전체 표시" class="control-btn">👁️</button>
                                <button onclick="window.UI.hideAllKeywords()" title="전체 숨김" class="control-btn">🙈</button>
                            </div>
                        </div>
                    </div>
                    <div class="focus-keyword-list" id="focus-keyword-list">
                        <!-- 키워드 목록이 여기에 렌더링됩니다 -->
                    </div>
                    <div class="focus-sidebar-footer">
                        <button onclick="window.UI.showFocusSettingsPanel()" class="text-settings-btn"
                                title="집중 모드 설정">
                            ⚙️ 설정
                        </button>
                    </div>
                </div>
                ` : ''}

                <!-- 메인 콘텐츠 영역 -->
                <div class="focus-main${isKeywordCollapsed ? ' sidebar-hidden' : ''}">
                    <div class="focus-panel-header">
                        <div class="focus-title-area">
                            <span class="focus-title-text">
                                🎯 ${focusedCard.name || `카드 #${focusedCard.number}`}
                            </span>
                        </div>
                        <div class="focus-header-controls">
                            <button onclick="window.UI.copyFocusPanelContent()" title="내용 복사" class="focus-header-btn">📋</button>
                            <button onclick="window.UI.showFocusSettingsPanel()" title="설정" class="focus-header-btn">⚙️</button>
                            <button onclick="window.UI.closeFocusPanel()" title="닫기" class="focus-header-btn focus-close-btn">×</button>
                        </div>
                    </div>

                    <div class="focus-panel-content focus-content-typography" id="focus-content-area">
                        <div class="focus-content-readable">
                            ${processedContent || '<div class="focus-empty-state"><div class="icon">📝</div><div class="title">아직 내용이 없습니다.</div><div class="subtitle">이 카드에 대한 정보를 기록해보세요.</div></div>'}
                        </div>
                    </div>
                </div>

                <!-- UI 요소들 -->
                <div class="focus-resize-handle">
                    <svg viewBox="0 0 12 12"><path d="M 8 4 L 4 8 M 10 6 L 6 10"></path></svg>
                </div>

                <button id="floating-collapse-btn" class="floating-collapse-btn"
                        onclick="window.UI.toggleKeywordListCollapse()"
                        title="키워드 목록 생성"
                        style="display: ${isKeywordCollapsed ? 'block' : 'none'};">
                    +
                </button>
            `;




            // 포스트잇 스타일 애니메이션 및 프리텐다드 폰트 CSS 추가
            const focusStyleElement = document.getElementById('focus-panel-styles') || document.createElement('style');
            focusStyleElement.id = 'focus-panel-styles';
            focusStyleElement.textContent = `
                /* 프리텐다드 폰트 로딩 */
                @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.8/dist/web/static/pretendard.css');

                /* =================  집중 패널 레이아웃 및 기본 스타일 ================= */
                .ccfolia-focus-panel {
                    --sidebar-width: 320px;
                    --panel-border-radius: 12px;
                    --panel-shadow: 0 8px 32px rgba(44, 24, 16, 0.1);
                    --content-max-width: 85ch;
                    --content-padding: 40px;

                    background: var(--detective-paper, #FFFBF0);
                    border-radius: var(--panel-border-radius);
                    box-shadow: var(--panel-shadow);
                    border: 1px solid rgba(44, 24, 16, 0.1);
                    overflow: hidden;
                    font-family: 'Paperozi', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Malgun Gothic', sans-serif;
                    position: relative;
                    /* Flex 대신 상대 위치 사용으로 크기 고정 */
                }

                /* =================  사이드바 레이아웃 (절대 위치) ================= */
                .focus-sidebar {
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: var(--sidebar-width);
                    height: 100%;
                    background: linear-gradient(180deg, #FAF8F5, #F5F0E8);
                    border-right: 1px solid rgba(44, 24, 16, 0.1);
                    display: flex;
                    flex-direction: column;
                    min-height: 0;
                    z-index: 2;
                }

                /* 키워드 사이드바 공간 플레이스홀더 제거 (더 이상 사용하지 않음) */

                .sidebar-header-content {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    width: 100%;
                }

                .sidebar-title-section {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .collapse-btn {
                    background: none;
                    border: none;
                    color: var(--detective-text);
                    cursor: pointer;
                    font-size: 14px;
                    padding: 2px;
                    transition: transform 0.2s ease;
                }

                .collapse-btn:hover {
                    transform: scale(1.1);
                }

                .control-btn {
                    background: rgba(44, 24, 16, 0.08);
                    border: none;
                    width: 24px;
                    height: 24px;
                    border-radius: 4px;
                    cursor: pointer;
                    color: var(--detective-text-light);
                    font-size: 12px;
                    transition: background 0.2s ease;
                }

                .control-btn:hover {
                    background: rgba(44, 24, 16, 0.15);
                }

                .text-settings-btn {
                    width: 100%;
                    background: var(--detective-accent);
                    color: white;
                    border: none;
                    padding: 10px;
                    border-radius: 6px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s ease;
                }

                .text-settings-btn:hover {
                    background: var(--detective-medium);
                }

                /* =================  메인 영역 레이아웃 (독립적 크기) ================= */
                .focus-main {
                    position: absolute;
                    left: var(--sidebar-width); /* 사이드바가 있을 때 */
                    top: 0;
                    right: 0;
                    bottom: 0;
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }

                /* 사이드바가 없을 때 메인 영역이 전체 너비 차지 */
                .focus-main.sidebar-hidden {
                    left: 0;
                }

                /* =================  콘텐츠 영역 스타일 ================= */
                .focus-content-typography {
                    line-height: var(--focus-line-height, 1.8);
                    font-size: var(--focus-font-size, 16px);
                    font-family: var(--focus-font-family, 'Paperozi', 'Pretendard', sans-serif);
                    letter-spacing: var(--focus-letter-spacing, 0.3px);
                    word-spacing: var(--focus-word-spacing, 0.2em);
                    text-align: var(--focus-text-align, left);
                    font-weight: var(--focus-font-weight, 400);
                }

                /* =================  UI 요소들 ================= */
                .floating-collapse-btn {
                    position: absolute;
                    left: 0;
                    top: 50%;
                    transform: translateY(-50%);
                    background: rgba(74, 52, 38, 0.9);
                    color: white;
                    border: none;
                    width: 32px;
                    height: 48px;
                    border-radius: 0 12px 12px 0;
                    cursor: pointer;
                    font-size: 16px;
                    z-index: 1002;
                    box-shadow: 2px 0 12px rgba(0,0,0,0.15);
                    display: none;
                }

                .floating-collapse-btn:hover {
                    background: rgba(74, 52, 38, 1);
                    box-shadow: 2px 0 16px rgba(0,0,0,0.25);
                }

                /* 기본 메인 컨텐츠 스타일 */
                .ccfolia-card-panel .main-content {
                    transition: padding-left 0.2s ease !important;
                }

                /* 폴더 사이드바가 있을 때 - padding 없음 */
                .ccfolia-card-panel .folder-sidebar:not([style*="display: none"]) ~ .main-content {
                    padding-left: 0 !important;
                }

                /* 폴더 사이드바가 숨겨질 때의 스타일 - ::before 코드 제거됨 */
                }

                /* 극도로 얇은 파일철 스타일 폴더 토글 탭 */
                .folder-toggle-tab {
                    /* 극미니멀한 디자인 - 카드를 방해하지 않도록 */
                }

                .folder-toggle-tab:hover {
                    width: 12px !important;
                    background: #A0522D !important;
                    box-shadow: 
                        1px 0 4px rgba(101, 67, 33, 0.25),
                        inset 1px 0 0 rgba(210, 105, 30, 0.3) !important;
                }

                .ccfolia-card-panel .folder-text {
                    font-size: 11px !important;
                    font-weight: 700 !important;
                    color: #FFFFFF !important;
                    text-shadow:
                        0 1px 3px rgba(0, 0, 0, 0.8),
                        0 0 6px rgba(255, 255, 255, 0.3) !important;
                    letter-spacing: 0.5px !important;
                    writing-mode: vertical-rl !important; /* 세로 텍스트 */
                    text-orientation: upright !important;
                    white-space: nowrap !important;
                    transform: rotate(180deg) !important; /* 텍스트를 올바른 방향으로 */
                }

                /* 호버 효과 - 세로 배치 전용 */
                .ccfolia-card-panel .folder-side-tab-panel:hover {
                    width: 50px !important;
                    height: 220px !important;
                    background:
                        linear-gradient(to bottom,
                            #FF8C42 0%,
                            #FFB347 20%,
                            #FFC971 40%,
                            #FFB347 60%,
                            #FF8C42 80%,
                            #F7931E 100%
                        ) !important;
                    border-right: 4px solid #E55A2B !important;
                    border-top: 3px solid #E55A2B !important;
                    border-bottom: 3px solid #E55A2B !important;
                    box-shadow:
                        4px 0 25px rgba(255, 107, 53, 0.6),
                        inset 2px 0 0 rgba(255, 201, 113, 0.8),
                        inset -1px 0 0 rgba(229, 90, 43, 0.9),
                        0 0 35px rgba(255, 140, 66, 0.5) !important;
                    transform: translateY(-50%) translateX(3px) !important;
                }

                .ccfolia-card-panel .folder-toggle-btn:hover {
                    background: transparent !important;
                }

                /* 호버 시 아이콘 및 텍스트 효과 */
                .ccfolia-card-panel .folder-toggle-btn:hover .folder-icon {
                    transform: scale(1.2) rotate(10deg) !important;
                    filter:
                        drop-shadow(0 3px 6px rgba(0, 0, 0, 0.8)),
                        drop-shadow(0 0 15px rgba(255, 201, 113, 0.8)),
                        brightness(1.3) !important;
                }

                .ccfolia-card-panel .folder-toggle-btn:hover .folder-text {
                    color: #FFFEF0 !important;
                    text-shadow:
                        0 2px 4px rgba(0, 0, 0, 0.9),
                        0 0 8px rgba(255, 255, 255, 0.5) !important;
                    transform: rotate(180deg) scale(1.1) !important;
                }

                /* 책갈피 클릭 효과 */
                .ccfolia-card-panel .folder-toggle-btn:active .folder-icon {
                    transform: scale(1.05) !important;
                    color: #F0F0F0 !important;
                    text-shadow:
                        0 1px 3px rgba(29, 19, 12, 1),
                        0 0 5px rgba(139, 111, 71, 0.3) !important;
                }

                /* 포커스 효과 (접근성) */
                .ccfolia-card-panel .folder-toggle-btn:focus {
                    outline: 2px solid rgba(139, 111, 71, 0.6) !important;
                    outline-offset: -2px !important;
                }

                /* 로딩 애니메이션 */
                @keyframes folderPulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }

                /* folderGlow 애니메이션 제거됨 - 더 이상 사용되지 않음 */

                .ccfolia-card-panel .folder-side-tab-panel.loading .folder-icon {
                    animation: folderPulse 1.5s ease-in-out infinite !important;
                }

                /* 다크모드 지원 */
                @media (prefers-color-scheme: dark) {
                    .ccfolia-card-panel .folder-side-tab-panel {
                        background: linear-gradient(135deg, #2D1B0F 0%, #3A2317 50%, #4A3426 100%) !important;
                        border-right-color: rgba(139, 111, 71, 0.4) !important;
                    }

                    .ccfolia-card-panel .folder-icon {
                        color: #E8DDD0 !important;
                    }
                }

                /* 고대비 모드 지원 */
                @media (prefers-contrast: high) {
                    .ccfolia-card-panel .folder-side-tab-panel {
                        border-right: 3px solid #8B6F47 !important;
                    }

                    .ccfolia-card-panel .folder-icon {
                        color: #FFFFFF !important;
                        text-shadow: 0 0 4px rgba(0, 0, 0, 0.8) !important;
                    }
                }

                /* =================  헤더 스타일 ================= */
                .focus-panel-header {
                    background: var(--detective-dark, #4A3426);
                    color: var(--detective-paper, white);
                    padding: 12px 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                    cursor: grab;
                    flex-shrink: 0;
                }

                .focus-title-text {
                    font-size: 1.0em;
                    font-weight: 700;
                }

                .focus-header-controls {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .focus-header-btn {
                    background: rgba(255,255,255,0.1);
                    border: none;
                    color: white;
                    width: 30px;
                    height: 30px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    transition: background 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .focus-header-btn:hover {
                    background: rgba(255,255,255,0.2) !important;
                }

                .focus-close-btn:hover {
                    background: rgba(220, 53, 69, 0.8) !important;
                    color: white;
                }

                /* =================  콘텐츠 영역 스타일 ================= */
                .focus-panel-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 28px 0;
                    color: var(--detective-text, #2C1810);
                    background-image: linear-gradient(rgba(44, 24, 16, 0.04) 1px, transparent 1px);
                    background-size: 100% calc(1em * var(--line-height, 1.8)); /* JS에서 line-height 값을 CSS 변수로 전달 */
                }

                .focus-content-readable {
                    max-width: var(--content-max-width);
                    margin: 0 auto;
                    padding: 0 var(--content-padding);
                    line-height: 1.8;
                    word-break: keep-all;
                    overflow-wrap: break-word;
                }

                .focus-panel-content p {
                    margin-bottom: 1em; /* 문단 간격 */
                }

                .focus-panel-content::-webkit-scrollbar {
                    width: 8px;
                }

                .focus-panel-content::-webkit-scrollbar-track {
                    background: rgba(44, 24, 16, 0.05);
                    border-radius: 4px;
                }

                .focus-panel-content::-webkit-scrollbar-thumb {
                    background: rgba(44, 24, 16, 0.3);
                    border-radius: 4px;
                }

                .focus-panel-content::-webkit-scrollbar-thumb:hover {
                    background: var(--detective-medium);
                }

                /* =================  사이드바 스타일 ================= */
                .focus-sidebar-header {
                    padding: 12px 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid rgba(44, 24, 16, 0.1);
                    flex-shrink: 0;
                }
                .focus-sidebar-title {
                    margin: 0;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--detective-dark);
                }
                .focus-sidebar-controls { display: flex; gap: 4px; }
                .focus-sidebar-controls button {
                    background: rgba(44, 24, 16, 0.08);
                    border: none;
                    width: 24px; height: 24px;
                    border-radius: 4px;
                    cursor: pointer;
                    color: var(--detective-text-light);
                    font-size: 12px;
                }
                .focus-sidebar-controls button:hover { background: rgba(44, 24, 16, 0.15); }

                .focus-keyword-list {
                    flex: 1;
                    overflow-y: auto;
                    padding: 8px;
                }

                .focus-sidebar-footer {
                    padding: 12px;
                    border-top: 1px solid rgba(44, 24, 16, 0.1);
                    flex-shrink: 0;
                }
                .focus-sidebar-footer button {
                    width: 100%;
                    background: var(--detective-accent);
                    color: white;
                    border: none;
                    padding: 10px;
                    border-radius: 6px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .focus-sidebar-footer button:hover { background: var(--detective-medium); }




                /* 리사이즈 핸들 - 패널 전체 기준 절대 위치 */
                .focus-resize-handle {
                    position: absolute;
                    bottom: 0;
                    right: 0;
                    width: 20px;
                    height: 20px;
                    cursor: nwse-resize;
                    z-index: 1003;
                }
                .focus-resize-handle svg {
                    width: 100%; height: 100%; fill: none; stroke: rgba(44, 24, 16, 0.4); stroke-width: 1.5; stroke-linecap: round;
                }

                /* 텍스트 설정 UI 스타일 */
                .focus-text-tab label {
                    display: block; margin-bottom: 8px; font-size: 12px; color: #495057; font-weight: 500;
                }
                .focus-setting-item {
                    display: flex; align-items: center; gap: 10px;
                }
                .focus-setting-item input[type="range"] {
                    flex: 1;
                }
                .focus-setting-item span {
                    font-weight: bold; color: #6c757d; min-width: 50px; text-align: right; font-size: 12px;
                }
                .focus-text-tab select {
                    width: 100%; padding: 8px; border: 1px solid #dee2e6; border-radius: 4px; font-size: 13px; background: white;
                }
                .focus-align-group {
                    display: flex; border: 1px solid #dee2e6; border-radius: 6px; overflow: hidden;
                }
                .align-btn {
                    flex: 1; background: white; border: none; padding: 8px; cursor: pointer; color: #495057;
                    border-right: 1px solid #dee2e6;
                }
                .align-btn:last-child { border-right: none; }
                .align-btn.active { background: var(--detective-accent); color: white; font-weight: bold; }
                .align-btn:nth-child(1) { text-align: left; }
                .align-btn:nth-child(2) { text-align: justify; }
                .align-btn:nth-child(3) { text-align: center; }

                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                @keyframes slideUp {
                    from { opacity: 1; transform: translateY(0); max-height: 500px; }
                    to { opacity: 0; transform: translateY(-10px); max-height: 0; }
                }

                @keyframes slideInLeft {
                    from { opacity: 0; transform: translateX(-100%); width: 0px; }
                    to { opacity: 1; transform: translateX(0); width: 280px; }
                }

                @keyframes slideOutLeft {
                    from { opacity: 1; transform: translateX(0); width: 280px; }
                    to { opacity: 0; transform: translateX(-100%); width: 0px; }
                }

                @keyframes slideInRight {
                    from { opacity: 0; transform: translateX(-100%); }
                    to { opacity: 1; transform: translateX(0); }
                }

                @keyframes slideInFromRight {
                    from { opacity: 0; transform: translateX(100%); }
                    to { opacity: 1; transform: translateX(0); }
                }

                @keyframes slideOutToRight {
                    from { opacity: 1; transform: translateX(0); }
                    to { opacity: 0; transform: translateX(100%); }
                }

                .focus-empty-state {
                    text-align: center;
                    color: #B8860B;
                    font-style: italic;
                    padding: 60px 30px;
                    background: rgba(139, 111, 71, 0.05);
                    border-radius: 12px;
                    margin: 40px 20px;
                    border: 2px dashed rgba(139, 111, 71, 0.2);
                    font-family: "Paperozi", "Pretendard", sans-serif;
                }

                .focus-empty-state .icon {
                    font-size: 2.5em;
                    margin-bottom: 16px;
                    opacity: 0.6;
                }

                .focus-empty-state .title {
                    font-size: 1.1em;
                    font-weight: 600;
                    margin-bottom: 8px;
                }

                .focus-empty-state .subtitle {
                    font-size: 0.9em;
                    opacity: 0.7;
                }
            `;
            if (!document.getElementById('focus-panel-styles')) {
                document.head.appendChild(focusStyleElement);
            }

            // CSS 변수로 타이포그래피 설정 적용
            this.applyFocusTypographySettings(focusPanel, focusSettings);

            document.body.appendChild(focusPanel);

            // 패널이 제대로 추가되었는지 확인
            const addedPanel = document.querySelector('.ccfolia-focus-panel');
            if (!addedPanel) {
                console.error('❌ 집중 패널 DOM 추가 실패!');
                return;
            }

            // 드래그 기능 추가 (제목 영역으로 드래그 가능)
            const header = focusPanel.querySelector('.focus-panel-header');
            
            if (header) {
                AdvancedDragSystem.createInstance(focusPanel, header);
            } else {
                console.error('❌ 집중 패널 헤더를 찾을 수 없음!');
                console.log('🔍 focusPanel 내부 HTML:', focusPanel.innerHTML);
            }


            // 탭 기능 초기화
            // this.initializeFocusTabs(focusPanel); // 탭이 하나이므로 초기화 불필요

            // 투명도 적용
            Utils.applyOpacity(focusPanel, 'focus');

            // 키워드 편집기 초기화
            this.refreshFocusKeywordEditor(focusPanel);

            // 키워드 목록 새로고침 (사이드바가 있는 경우에만)
            if (!CardManager.settings.focusMode?.keywordListCollapsed) {
                this.refreshFocusKeywordEditor(focusPanel);
            }

            // 리사이즈 기능 활성화
            this.makeResizable(focusPanel);
        },

        // 탭 기능 초기화

        // 통합 편집기 토글

        // 패널 리사이즈 기능
        makeResizable(panel) {
            const handle = panel.querySelector('.focus-resize-handle');
            if (!handle) return;

            let isResizing = false;
            let lastX, lastY;

            // 이벤트 핸들러를 명시적으로 정의 (이전 핸들러 제거를 위해)
            const startResize = (e) => {
                isResizing = true;
                lastX = e.clientX;
                lastY = e.clientY;
                document.body.style.cursor = 'nwse-resize';
                panel.style.userSelect = 'none'; // 리사이즈 중 텍스트 선택 방지
                e.preventDefault();
                e.stopPropagation(); // 이벤트 전파 중단
            };

            const doResize = (e) => {
                if (!isResizing) return;

                const dx = e.clientX - lastX;
                const dy = e.clientY - lastY;

                const rect = panel.getBoundingClientRect();
                let newWidth = rect.width + dx;
                let newHeight = rect.height + dy;

                // 최소 크기 제한
                if (newWidth < 400) newWidth = 400;
                if (newHeight < 300) newHeight = 300;

                // 최대 크기 제한 (화면 크기를 넘어가지 않도록)
                const maxWidth = window.innerWidth * 0.95; // 화면 너비의 95%로 제한
                const maxHeight = window.innerHeight * 0.90; // 화면 높이의 90%로 제한
                if (newWidth > maxWidth) newWidth = maxWidth;
                if (newHeight > maxHeight) newHeight = maxHeight;

                panel.style.width = `${newWidth}px`;
                panel.style.height = `${newHeight}px`;

                lastX = e.clientX;
                lastY = e.clientY;

                e.preventDefault();
                e.stopPropagation(); // 이벤트 전파 중단
            };

            const stopResize = (e) => {
                if (!isResizing) return;
                isResizing = false;
                document.body.style.cursor = '';
                panel.style.userSelect = '';
                // 변경된 크기 저장
                CardManager.settings.focusMode.customWidth = parseInt(panel.style.width);
                CardManager.settings.focusMode.customHeight = parseInt(panel.style.height);
                DataManager.save();

                e?.preventDefault();
                e?.stopPropagation(); // 이벤트 전파 중단
            };

            // 기존 이벤트 리스너가 있다면 제거 (중복 방지)
            if (panel._resizeHandlers) {
                handle.removeEventListener('mousedown', panel._resizeHandlers.startResize);
                document.removeEventListener('mousemove', panel._resizeHandlers.doResize);
                document.removeEventListener('mouseup', panel._resizeHandlers.stopResize);
            }

            // 새 이벤트 리스너 등록
            handle.addEventListener('mousedown', startResize);
            document.addEventListener('mousemove', doResize);
            document.addEventListener('mouseup', stopResize);

            // 패널에 핸들러 참조 저장 (나중에 제거를 위해)
            panel._resizeHandlers = {
                startResize,
                doResize,
                stopResize
            };
        },

        // 집중 패널 타이포그래피 CSS 변수 적용
        applyFocusTypographySettings(panel, settings) {
            const root = panel;
            root.style.setProperty('--focus-line-height', settings.lineHeight);
            root.style.setProperty('--focus-font-size', `${settings.fontSize}px`);
            root.style.setProperty('--focus-font-family',
                settings.fontFamily === 'default' ?
                    "'Paperozi', 'Pretendard', sans-serif" :
                    `"${settings.fontFamily}", 'Paperozi', 'Pretendard', sans-serif`
            );
            root.style.setProperty('--focus-letter-spacing', `${settings.letterSpacing}px`);
            root.style.setProperty('--focus-word-spacing', `${settings.wordSpacing}em`);
            root.style.setProperty('--focus-text-align', settings.textAlign);
            root.style.setProperty('--focus-font-weight', settings.fontWeight);
        },

        // 집중 패널 닫기
        closeFocusPanel() {
            const focusPanel = document.querySelector('.ccfolia-focus-panel');
            if (focusPanel) {
                // 드래그 인스턴스 제거
                AdvancedDragSystem.removeInstance(focusPanel);
                
                // 리사이즈 이벤트 리스너 제거 (메모리 누수 및 이벤트 충돌 방지)
                if (focusPanel._resizeHandlers) {
                    const handle = focusPanel.querySelector('.focus-resize-handle');
                    if (handle) {
                        handle.removeEventListener('mousedown', focusPanel._resizeHandlers.startResize);
                    }
                    document.removeEventListener('mousemove', focusPanel._resizeHandlers.doResize);
                    document.removeEventListener('mouseup', focusPanel._resizeHandlers.stopResize);
                    
                    // 참조 제거
                    delete focusPanel._resizeHandlers;
                }
                
                // 패널 제거
                focusPanel.remove();
            }
            
            // 집중 상태 재설정
            CardManager.focusedCardId = null;
            DataManager.save();
        },

        // 개별 키워드 표시/숨김 토글 - 폴더별 시스템 사용
        toggleIndividualKeyword(keyword) {
            const focusedCard = CardManager.cards.find(card => card.id === CardManager.focusedCardId);
            if (!focusedCard) {
                console.warn('⚠️ 집중된 카드를 찾을 수 없음');
                return;
            }

            console.log(`🔄 개별 키워드 토글: [${focusedCard.folderId}] "${keyword}"`);
            const newState = NewKeywordManager.toggleKeyword(focusedCard.folderId, keyword);

            this.updateFocusContent();
            this.refreshFocusKeywordEditor();
        },

        // 집중 모드 키워드 편집기 새로고침
        refreshFocusKeywordEditor(panel = document) {
            const focusedCard = CardManager.cards.find(card => card.id === CardManager.focusedCardId);
            if (!focusedCard) return;

            const keywordList = panel.querySelector('.focus-keyword-list');
            if (!keywordList) return;

            // 현재 카드에 실제로 존재하는 키워드만 가져오기
            const keywords = KeywordManager.getCardKeywords(focusedCard.id);

            if (keywords.length === 0) {
                keywordList.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #8D6E63; font-style: italic; font-size: 13px;">
                        키워드가 없습니다.
                    </div>
                `;
                return;
            }

            const keywordsHtml = keywords.map(({ keyword, number, type }) => {
                // 폴더별 키워드 상태 확인
                const isHidden = NewKeywordManager.isKeywordHidden(focusedCard.folderId, keyword);

                const typeLabel = type === 'important' ? '『중요』' : '「일반」';
                const typeBadgeColor = type === 'important' ? '#b8a082' : '#8e94a0';
                const itemStyle = isHidden ? 'background: rgba(44, 24, 16, 0.05); opacity: 0.7;' : 'background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.04);';
                const toggleIcon = isHidden ? '👁️' : '🙈';
                const toggleTitle = isHidden ? '표시' : '숨김';

                return `
                    <div class="keyword-item" style="${itemStyle} border-radius: 8px; padding: 10px; margin-bottom: 6px; font-size: 13px; border: 1px solid rgba(44, 24, 16, 0.1);">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="background: ${typeBadgeColor}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">${typeLabel}</span>
                                <span style="font-weight: 600; color: #333;">[${number}] ${keyword}</span>
                            </div>
                            <div style="display: flex; gap: 4px;">
                                <button onclick="window.UI.toggleIndividualKeyword('${keyword}')" title="${toggleTitle}"
                                        style="background: #8ba8b5; color: white; border: none; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; font-size: 11px;">${toggleIcon}</button>
                                <button onclick="KeywordEditor.deleteKeyword('${focusedCard.folderId}', '${keyword}'); window.UI.refreshFocusKeywordEditor(); window.UI.updateFocusContent();" title="삭제"
                                        style="background: #c5877f; color: white; border: none; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; font-size: 11px;">🗑️</button>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="number" min="1" max="999" value="${number}"
                                   onchange="KeywordEditor.updateNumber('${focusedCard.folderId}', '${keyword}', this.value); window.UI.refreshFocusKeywordEditor(); window.UI.updateFocusContent();"
                                   style="border: 1px solid #ced4da; border-radius: 4px; padding: 4px 6px; width: 50px; font-size: 12px;">
                            <span style="font-size: 11px; color: #8D6E63;">번호 변경</span>
                        </div>
                    </div>
                `;
            }).join('');

            keywordList.innerHTML = keywordsHtml;

        },

        // 집중 모드 내용 업데이트
        updateFocusContent() {
            const focusedCard = CardManager.cards.find(card => card.id === CardManager.focusedCardId);
            if (!focusedCard) return;

            const contentElement = document.querySelector('.focus-content-readable');
            if (contentElement) {
                const processedContent = Utils.parseFocusKeywords(focusedCard.content, focusedCard.folderId);
                contentElement.innerHTML = processedContent || '<div style="text-align: center; color: #8D6E63; font-style: italic; padding: 20px;">내용이 없습니다.</div>';
            }
        },

        // 집중 모드 렌더링 (기존 함수 - 이제 사용하지 않음)
        renderFocusMode() {
            const container = document.querySelector('.cards-container');
            if (!container) return;

            const focusedCard = CardManager.cards.find(card => card.id === CardManager.focusedCardId);
            if (!focusedCard) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 60px; color: #6D4C2F;">
                        <div style="font-size: 4em; margin-bottom: 20px;">🎯</div>
                        <h3>집중할 카드를 선택해주세요</h3>
                        <button onclick="CardManager.viewMode = 'collection'; UI.renderCards();" style="background: #8e94a0; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">목록으로 돌아가기</button>
                    </div>
                `;
                return;
            }

            const processedContent = Utils.parseFocusKeywords(focusedCard.content, focusedCard.folderId);

            container.innerHTML = `
                <div class="focus-mode" style="max-width: 800px; margin: 0 auto;">
                    <div class="focus-card" style="position: relative; background: white; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.05); overflow: hidden; border: 1px solid #D4C4D8;">
                        <div class="focus-card-header" style="background: linear-gradient(135deg, #8e94a0 0%, #9da1a9 100%); color: white; padding: 20px; text-align: center;">
                            <h2 style="margin: 0 0 10px 0; font-size: 1.4em; pointer-events: none;">🎯 ${focusedCard.name || `카드 #${focusedCard.number}`}</h2>
                            <div style="display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; pointer-events: auto;">
                                <button onclick="window.UI.copyCardContent('${focusedCard.id}')" title="텍스트 복사 (키워드 변환, 숨김 키워드는 번호로 복사됨)" style="background: rgba(255,255,255,0.15); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px;">📋 복사</button>
                                <button onclick="window.UI.showAllKeywords()" style="background: rgba(255,255,255,0.15); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px;">👁️ 모두보기</button>
                                <button onclick="window.UI.hideAllKeywords()" style="background: rgba(255,255,255,0.15); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px;">🙈 모두숨기기</button>
                                <button onclick="window.UI.toggleKeywordEditor()" style="background: rgba(255,255,255,0.15); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px;">⚙️ 키워드편집</button>
                            </div>
                        </div>

                        <div class="focus-card-content" style="padding: 25px; line-height: 1.8; font-size: 16px; color: #2C1810; min-height: 200px; word-break: keep-all; white-space: pre-line; overflow-wrap: break-word; text-rendering: optimizeLegibility;">
                            ${processedContent || '<div style="text-align: center; color: #8D6E63; font-style: italic; padding: 40px;">내용이 없습니다.</div>'}
                        </div>

                        <div class="focus-card-footer" style="padding: 15px 25px; background: #F5F0F5; border-top: 1px solid #D4C4D8; text-align: center;">
                            <button onclick="CardManager.viewMode = 'collection'; CardManager.focusedCardId = null; UI.renderCards();" style="background: #5D4037; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 13px;">← 목록으로 돌아가기</button>
                        </div>
                    </div>

                    <div class="keyword-editor-panel" style="max-width: 800px; margin: 20px auto 0; background: #E8DDD4; border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); display: none;">
                        <h3 style="margin: 0 0 15px 0; color: #2C1810; display: flex; align-items: center; justify-content: space-between;">
                            ⚙️ 키워드 편집
                            <button onclick="window.UI.toggleKeywordEditor()" style="background: none; border: none; font-size: 18px; cursor: pointer;">×</button>
                        </h3>
                        <div class="keyword-list" style="max-height: 300px; overflow-y: auto;"></div>
                        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #dee2e6;">
                            <button onclick="window.UI.refreshKeywordEditor()" style="background: #94a89a; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; width: 100%; font-size: 12px;">🔄 새로고침</button>
                        </div>
                    </div>
                </div>
            `;

            // 집중 모드 카드에 드래그 기능 추가
            setTimeout(() => {
                const focusCard = document.querySelector('.focus-card');
                const focusHeader = document.querySelector('.focus-card-header');
                if (focusCard && focusHeader) {
                    AdvancedDragSystem.createInstance(focusCard, focusHeader);
                }
            }, 100);
        },

        // 폴더별 키워드 토글 (집중 모드용)
        toggleFolderKeyword(folderId, keyword) {
            console.log(`🔄 키워드 토글 요청: [${folderId}] "${keyword}"`);
            const newState = NewKeywordManager.toggleKeyword(folderId, keyword);

            // 집중 패널이 있으면 업데이트
            const focusPanel = document.querySelector('.ccfolia-focus-panel');
            if (focusPanel) {
                this.updateFocusContent();
                this.refreshFocusKeywordEditor();
            } else {
                this.renderCards();
            }

            // TODO 키워드 패널이 열려있다면 새로고침
            if (CardManager.todoKeyword.isVisible) {
                this.refreshTodoKeywordList();
            }
        },


        // 카드 내용 복사 (집중 모드용)
        copyCardContent(cardId) {
            const card = CardManager.cards.find(c => c.id === cardId);
            if (card && card.content) {
                const cardName = card.name || `카드 #${card.number}`;
                Utils.copyTextWithKeywords(card.content, false, cardName, card.folderId).then((success) => {
                    if (success) {
                        Utils.showOfficeNotification('텍스트가 복사되었습니다.');
                    }
                });
            } else {
                Utils.showOfficeNotification('복사할 텍스트가 없습니다.');
            }
        },


        // 모든 키워드 보기 (집중 모드용) - 폴더의 모든 키워드 표시
        showAllKeywords() {
            const focusedCard = CardManager.cards.find(card => card.id === CardManager.focusedCardId);
            if (!focusedCard) {
                console.warn('⚠️ 집중된 카드를 찾을 수 없음');
                return;
            }

            console.log(`🔍 폴더 ${focusedCard.folderId}의 모든 키워드 표시 시작`);

            // 🚫 카드 콘텐츠 파싱으로 키워드 자동 등록 제거
            // 키워드 패널에서만 키워드 등록 가능

            // 폴더의 모든 키워드를 직접 찾아서 표시 상태로 변경
            const folderKeywords = Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === focusedCard.folderId);

            console.log(`📋 폴더에서 ${folderKeywords.length}개 키워드 발견:`, folderKeywords.map(kw => kw.name));

            if (folderKeywords.length === 0) {
                Utils.showNotification('⚠️ 이 폴더에 등록된 키워드가 없습니다.');
                return;
            }

            folderKeywords.forEach(kw => {
                if (!kw.state) {
                    kw.state = { visible: true, completed: false };
                } else {
                    kw.state.visible = true;
                }
                console.log(`👁️ 키워드 "${kw.name}" 표시됨`);
            });

            DataManager.save();

            // 집중 패널이 있으면 업데이트
            const focusPanel = document.querySelector('.ccfolia-focus-panel');
            if (focusPanel) {
                this.updateFocusContent();
                this.refreshFocusKeywordEditor();
            } else {
                this.renderCards();
            }

            // TODO 키워드 패널이 열려있다면 새로고침
            if (CardManager.todoKeyword.isVisible) {
                this.refreshTodoKeywordList();
            }
        },

        // 모든 키워드 숨기기 (집중 모드용) - 현재 카드의 키워드만 대상
        hideAllKeywords() {
            const focusedCard = CardManager.cards.find(card => card.id === CardManager.focusedCardId);
            if (!focusedCard) {
                console.warn('⚠️ 집중된 카드를 찾을 수 없음');
                return;
            }

            console.log(`🔍 폴더 ${focusedCard.folderId}의 모든 키워드 숨김 시작`);

            // 🚫 카드 콘텐츠 파싱으로 키워드 자동 등록 제거
            // 키워드 패널에서만 키워드 등록 가능

            // 폴더의 모든 키워드를 직접 찾아서 숨김 상태로 변경
            const folderKeywords = Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === focusedCard.folderId);

            console.log(`📋 폴더에서 ${folderKeywords.length}개 키워드 발견:`, folderKeywords.map(kw => kw.name));

            if (folderKeywords.length === 0) {
                Utils.showNotification('⚠️ 이 폴더에 등록된 키워드가 없습니다.');
                return;
            }

            folderKeywords.forEach(kw => {
                if (!kw.state) {
                    kw.state = { visible: false, completed: false };
                } else {
                    kw.state.visible = false;
                }
                console.log(`🙈 키워드 "${kw.name}" 숨겨짐`);
            });

            DataManager.save();

            // 집중 패널이 있으면 업데이트
            const focusPanel = document.querySelector('.ccfolia-focus-panel');
            if (focusPanel) {
                this.updateFocusContent();
                this.refreshFocusKeywordEditor();
            } else {
                this.renderCards();
            }

            // TODO 키워드 패널이 열려있다면 새로고침
            if (CardManager.todoKeyword.isVisible) {
                this.refreshTodoKeywordList();
            }
        },




        // 집중 패널 내용 복사 (개선된 버전)
        copyFocusPanelContent() {
            const focusedCard = CardManager.cards.find(card => card.id === CardManager.focusedCardId);
            if (!focusedCard || !focusedCard.content) {
                return;
            }

            // 기존 copyCardContent 함수 활용 (카드 이름 포함)
            this.copyCardContent(focusedCard.id);
        },

        // 집중 모드 설정 패널 표시
        showFocusSettingsPanel() {
            // 기존 설정 패널 제거
            const existingPanel = document.querySelector('.focus-settings-panel');
            if (existingPanel) {
                existingPanel.remove();
                return;
            }

            const settingsPanel = document.createElement('div');
            settingsPanel.className = 'focus-settings-panel';
            settingsPanel.style.cssText = `
                position: fixed;
                right: 20px;
                top: 50%;
                transform: translateY(-50%);
                width: 350px;
                max-height: 80vh;
                background: white;
                border-radius: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.15);
                z-index: 1000001;
                font-family: Arial, sans-serif;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            `;

            const focusSettings = CardManager.settings.focusMode;
            const currentSize = CardManager.settings.focusMode?.panelSize || 'medium';

            settingsPanel.innerHTML = `
                <div class="settings-header" style="background: linear-gradient(135deg, #4A3426, #6D4C2F); color: white; padding: 16px; text-align: center;">
                    <h3 style="margin: 0; font-size: 1.2em;">🎯 집중 모드 설정</h3>
                </div>

                <div class="settings-content" style="padding: 20px; overflow-y: auto; flex: 1;">
                    <!-- 패널 크기 설정 -->
                    <div class="setting-group" style="margin-bottom: 25px;">
                        <h4 style="margin: 0 0 12px 0; color: #495057; font-size: 14px;">📐 패널 크기</h4>
                        <div class="size-buttons" style="display: flex; gap: 8px; margin-bottom: 12px;">
                            <button onclick="window.UI.setFocusPanelSize('small')" class="size-btn ${currentSize === 'small' ? 'active' : ''}"
                                    style="flex: 1; padding: 8px; border: 1px solid #dee2e6; border-radius: 6px; background: ${currentSize === 'small' ? '#6D4C2F' : 'white'}; color: ${currentSize === 'small' ? 'white' : '#495057'}; cursor: pointer; font-size: 12px;">작게</button>
                            <button onclick="window.UI.setFocusPanelSize('medium')" class="size-btn ${currentSize === 'medium' ? 'active' : ''}"
                                    style="flex: 1; padding: 8px; border: 1px solid #dee2e6; border-radius: 6px; background: ${currentSize === 'medium' ? '#6D4C2F' : 'white'}; color: ${currentSize === 'medium' ? 'white' : '#495057'}; cursor: pointer; font-size: 12px;">보통</button>
                            <button onclick="window.UI.setFocusPanelSize('large')" class="size-btn ${currentSize === 'large' ? 'active' : ''}"
                                    style="flex: 1; padding: 8px; border: 1px solid #dee2e6; border-radius: 6px; background: ${currentSize === 'large' ? '#6D4C2F' : 'white'}; color: ${currentSize === 'large' ? 'white' : '#495057'}; cursor: pointer; font-size: 12px;">크게</button>
                        </div>
                    </div>

                    <!-- 폰트 크기 설정 -->
                    <div class="setting-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #495057; font-weight: 600;">🔤 글자 크기</label>
                        <div class="focus-setting-item" style="display: flex; align-items: center; gap: 10px;">
                            <input type="range" id="focus-font-size" min="12" max="24" value="${focusSettings.fontSize}"
                                   style="flex: 1; height: 6px; border-radius: 3px; background: #e9ecef; outline: none; appearance: none;"
                                   oninput="window.UI.updateFocusTextSetting('fontSize', this.value + 'px')">
                            <span id="focus-font-size-value" style="font-weight: bold; color: #6c757d; min-width: 40px; text-align: right; font-size: 12px;">${focusSettings.fontSize}px</span>
                        </div>
                    </div>

                    <!-- 줄 간격 설정 -->
                    <div class="setting-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #495057; font-weight: 600;">📏 줄 간격</label>
                        <div class="focus-setting-item">
                            <input type="range" id="focus-line-height" min="1.4" max="2.4" step="0.1" value="${focusSettings.lineHeight}"
                                   style="flex: 1; height: 6px; border-radius: 3px; background: #e9ecef; outline: none; appearance: none;"
                                   oninput="window.UI.updateFocusTextSetting('lineHeight', this.value)">
                            <span id="focus-line-height-value" style="font-weight: bold; color: #6c757d; min-width: 40px; text-align: right; font-size: 12px;">${focusSettings.lineHeight}</span>
                        </div>
                    </div>

                    <!-- 텍스트 정렬 -->
                    <div class="setting-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #495057; font-weight: 600;">📄 텍스트 정렬</label>
                        <div class="focus-align-group" style="display: flex; border: 1px solid #dee2e6; border-radius: 6px; overflow: hidden;">
                            <button onclick="window.UI.updateFocusTextSetting('textAlign', 'left')" class="align-btn ${focusSettings.textAlign === 'left' ? 'active' : ''}"
                                    style="flex: 1; background: ${focusSettings.textAlign === 'left' ? '#6D4C2F' : 'white'}; border: none; padding: 8px; cursor: pointer; color: ${focusSettings.textAlign === 'left' ? 'white' : '#495057'}; border-right: 1px solid #dee2e6; font-size: 12px;">왼쪽</button>
                            <button onclick="window.UI.updateFocusTextSetting('textAlign', 'justify')" class="align-btn ${focusSettings.textAlign === 'justify' ? 'active' : ''}"
                                    style="flex: 1; background: ${focusSettings.textAlign === 'justify' ? '#6D4C2F' : 'white'}; border: none; padding: 8px; cursor: pointer; color: ${focusSettings.textAlign === 'justify' ? 'white' : '#495057'}; border-right: 1px solid #dee2e6; font-size: 12px;">양쪽</button>
                            <button onclick="window.UI.updateFocusTextSetting('textAlign', 'center')" class="align-btn ${focusSettings.textAlign === 'center' ? 'active' : ''}"
                                    style="flex: 1; background: ${focusSettings.textAlign === 'center' ? '#6D4C2F' : 'white'}; border: none; padding: 8px; cursor: pointer; color: ${focusSettings.textAlign === 'center' ? 'white' : '#495057'}; font-size: 12px;">가운데</button>
                        </div>
                    </div>

                    <!-- 자간 설정 -->
                    <div class="setting-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #495057; font-weight: 600;">📐 자간</label>
                        <div class="focus-setting-item">
                            <input type="range" id="focus-letter-spacing" min="0" max="1" step="0.1" value="${focusSettings.letterSpacing}"
                                   style="flex: 1; height: 6px; border-radius: 3px; background: #e9ecef; outline: none; appearance: none;"
                                   oninput="window.UI.updateFocusTextSetting('letterSpacing', this.value + 'px')">
                            <span id="focus-letter-spacing-value" style="font-weight: bold; color: #6c757d; min-width: 40px; text-align: right; font-size: 12px;">${focusSettings.letterSpacing}px</span>
                        </div>
                    </div>

                    <!-- 폰트 두께 설정 -->
                    <div class="setting-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #495057; font-weight: 600;">🔤 폰트 두께</label>
                        <div class="focus-setting-item">
                            <input type="range" id="focus-font-weight" min="300" max="700" step="100" value="${focusSettings.fontWeight}"
                                   style="flex: 1; height: 6px; border-radius: 3px; background: #e9ecef; outline: none; appearance: none;"
                                   oninput="window.UI.updateFocusTextSetting('fontWeight', this.value)">
                            <span id="focus-font-weight-value" style="font-weight: bold; color: #6c757d; min-width: 40px; text-align: right; font-size: 12px;">${focusSettings.fontWeight}</span>
                        </div>
                    </div>

                    <!-- 폰트 패밀리 -->
                    <div class="setting-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #495057; font-weight: 600;">🎨 폰트</label>
                        <select id="focus-font-family" onchange="UI.updateFocusTextSetting('fontFamily', this.value)"
                                style="width: 100%; padding: 8px; border: 1px solid #dee2e6; border-radius: 6px; font-size: 13px; background: white;">
                            <option value="default" ${focusSettings.fontFamily === 'default' ? 'selected' : ''}>기본 (Paperozi)</option>
                            <option value="Paperozi" ${focusSettings.fontFamily === 'Paperozi' ? 'selected' : ''}>Paperozi</option>
                            <option value="serif" ${focusSettings.fontFamily === 'serif' ? 'selected' : ''}>명조 (Serif)</option>
                            <option value="BookkMyungjo-Bd" ${focusSettings.fontFamily === 'BookkMyungjo-Bd' ? 'selected' : ''}>북크명조</option>
                            <option value="Ownglyph_ParkDaHyun" ${focusSettings.fontFamily === 'Ownglyph_ParkDaHyun' ? 'selected' : ''}>온글리프 박다현</option>
                            <option value="DungGeunMo" ${focusSettings.fontFamily === 'DungGeunMo' ? 'selected' : ''}>둥근모꼴</option>
                        </select>
                    </div>
                </div>

                <div class="settings-footer" style="padding: 16px; background: #f8f9fa; border-top: 1px solid #e9ecef; display: flex; gap: 8px; justify-content: flex-end;">
                    <button onclick="window.UI.resetFocusSettings()" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">초기화</button>
                    <button onclick="window.UI.closeFocusSettingsPanel()" style="background: #6D4C2F; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">닫기</button>
                </div>
            `;

            document.body.appendChild(settingsPanel);

            // 드래그 기능 추가
            const header = settingsPanel.querySelector('.settings-header');
            AdvancedDragSystem.createInstance(settingsPanel, header);
        },

        // 집중 모드 설정 패널 닫기
        closeFocusSettingsPanel() {
            const settingsPanel = document.querySelector('.focus-settings-panel');
            if (settingsPanel) {
                // 드래그 인스턴스 제거
                AdvancedDragSystem.removeInstance(settingsPanel);
                
                settingsPanel.remove();
            }
        },

        // 패널 크기 설정
        setFocusPanelSize(size) {
            CardManager.settings.focusMode.panelSize = size;
            DataManager.save();

            const focusPanel = document.querySelector('.ccfolia-focus-panel');
            if (focusPanel) {
                const sizes = {
                    small: { width: '800px', maxHeight: '70vh' },
                    medium: { width: '1000px', maxHeight: '80vh' },
                    large: { width: '1200px', maxHeight: '85vh' }
                };
                const currentSize = sizes[size] || sizes.medium;

                focusPanel.style.width = currentSize.width;
                focusPanel.style.height = currentSize.maxHeight;

                // CSS 변수도 업데이트
                focusPanel.style.setProperty('--content-max-width', size === 'small' ? '75ch' : size === 'large' ? '95ch' : '85ch');
                focusPanel.style.setProperty('--content-padding', size === 'small' ? '32px' : size === 'large' ? '48px' : '40px');
            }

            // 설정 패널의 버튼 상태 업데이트
            const settingsPanel = document.querySelector('.focus-settings-panel');
            if (settingsPanel) {
                settingsPanel.querySelectorAll('.size-btn').forEach(btn => {
                    btn.style.background = 'white';
                    btn.style.color = '#495057';
                });
                const activeBtn = settingsPanel.querySelector(`button[onclick="UI.setFocusPanelSize('${size}')"`);
                if (activeBtn) {
                    activeBtn.style.background = '#6D4C2F';
                    activeBtn.style.color = 'white';
                }
            }
        },

        // 텍스트 설정 업데이트
        updateFocusTextSetting(property, value) {
            CardManager.settings.focusMode[property] = value;
            DataManager.save();

            // 즉시 적용
            const contentArea = document.querySelector('#focus-content-area');
            if (contentArea) {
                contentArea.style[property] = value;

                // 폰트 패밀리 특별 처리
                if (property === 'fontFamily') {
                    const fontMap = {
                        'default': '"Pretendard", sans-serif',
                        'serif': 'serif',
                        'BookkMyungjo-Bd': '"BookkMyungjo-Bd", serif',
                        'Ownglyph_ParkDaHyun': '"Ownglyph_ParkDaHyun", sans-serif',
                        'DungGeunMo': '"DungGeunMo", monospace'
                    };
                    contentArea.style.fontFamily = fontMap[value] || fontMap['default'];
                }

                // 줄간격 변경 시 배경 줄무늬도 업데이트
                if (property === 'lineHeight') {
                    contentArea.style.backgroundSize = `100% calc(1em * ${value})`;
                    // CSS 변수로도 전달
                    contentArea.style.setProperty('--line-height', value);
                }
            }

            // 설정 패널의 값 표시 업데이트
            const valueSpan = document.querySelector(`#focus-${property.replace(/([A-Z])/g, '-$1').toLowerCase()}-value`);
            if (valueSpan) {
                valueSpan.textContent = property.includes('Size') ? value : value;
            }

            // 정렬 버튼 상태 업데이트
            if (property === 'textAlign') {
                const settingsPanel = document.querySelector('.focus-settings-panel');
                if (settingsPanel) {
                    settingsPanel.querySelectorAll('.align-btn').forEach(btn => {
                        btn.style.background = 'white';
                        btn.style.color = '#495057';
                    });
                    const activeBtn = settingsPanel.querySelector(`button[onclick="UI.updateFocusTextSetting('textAlign', '${value}')"`);
                    if (activeBtn) {
                        activeBtn.style.background = '#6D4C2F';
                        activeBtn.style.color = 'white';
                    }
                }
            }
        },

        // 집중 모드 설정 초기화
        resetFocusSettings() {
            const defaultSettings = {
                fontSize: 16,
                fontFamily: 'default',
                lineHeight: 1.8,
                letterSpacing: 0.3,
                wordSpacing: 0.2,
                textAlign: 'left',
                fontWeight: 400,
                panelSize: 'medium',
                keywordListCollapsed: false
            };

            CardManager.settings.focusMode = { ...CardManager.settings.focusMode, ...defaultSettings };
            DataManager.save();

            // 즉시 적용
            const contentArea = document.querySelector('#focus-content-area');
            if (contentArea) {
                contentArea.style.fontSize = defaultSettings.fontSize + 'px';
                contentArea.style.fontFamily = '"Pretendard", sans-serif';
                contentArea.style.lineHeight = defaultSettings.lineHeight;
                contentArea.style.letterSpacing = defaultSettings.letterSpacing + 'px';
                contentArea.style.wordSpacing = defaultSettings.wordSpacing + 'em';
                contentArea.style.textAlign = defaultSettings.textAlign;
                contentArea.style.fontWeight = defaultSettings.fontWeight;
            }

            // 설정 패널 다시 열기
            this.closeFocusSettingsPanel();
            setTimeout(() => this.showFocusSettingsPanel(), 100);
        },



        // 키워드 목록 사이드바 생성/제거 토글 (완전히 독립적)
        toggleKeywordListCollapse() {
            const focusPanel = document.querySelector('.ccfolia-focus-panel');
            const sidebar = document.querySelector('.focus-sidebar');
            const mainArea = document.querySelector('.focus-main');
            const floatingBtn = document.querySelector('#floating-collapse-btn');

            if (!focusPanel || !mainArea) return;

            const sidebarExists = sidebar !== null;

            if (!sidebarExists) {
                // 사이드바 생성 (펼치기)
                this.createKeywordSidebar(focusPanel);

                // 메인 영역에서 sidebar-hidden 클래스 제거
                mainArea.classList.remove('sidebar-hidden');

                // 플로팅 버튼 숨김
                if (floatingBtn) {
                    floatingBtn.style.display = 'none';
                }

                // 설정 저장
                CardManager.settings.focusMode.keywordListCollapsed = false;
            } else {
                // 사이드바 완전 제거 (접기)
                sidebar.remove();

                // 메인 영역에 sidebar-hidden 클래스 추가
                mainArea.classList.add('sidebar-hidden');

                // 플로팅 버튼 표시
                if (floatingBtn) {
                    floatingBtn.style.display = 'block';
                }

                // 설정 저장
                CardManager.settings.focusMode.keywordListCollapsed = true;
            }

            DataManager.save();
        },

        // 키워드 사이드바 생성
        createKeywordSidebar(focusPanel) {
            const focusedCard = CardManager.cards.find(card => card.id === CardManager.focusedCardId);
            if (!focusedCard) return;

            const sidebar = document.createElement('div');
            sidebar.className = 'focus-sidebar';
            sidebar.innerHTML = `
                <div class="focus-sidebar-header">
                    <div class="sidebar-header-content">
                        <div class="sidebar-title-section">
                            <button id="keyword-collapse-btn" class="collapse-btn" onclick="UI.toggleKeywordListCollapse()" title="키워드 목록 제거">
                                ×
                            </button>
                            <h3 class="focus-sidebar-title">키워드 목록</h3>
                        </div>
                        <div class="focus-sidebar-controls">
                            <button onclick="window.UI.showAllKeywords()" title="전체 표시" class="control-btn">👁️</button>
                            <button onclick="window.UI.hideAllKeywords()" title="전체 숨김" class="control-btn">🙈</button>
                        </div>
                    </div>
                </div>
                <div class="focus-keyword-list" id="focus-keyword-list">
                    <!-- 키워드 목록이 여기에 렌더링됩니다 -->
                </div>
                <div class="focus-sidebar-footer">
                    <button onclick="UI.showFocusSettingsPanel()" class="text-settings-btn" title="집중 모드 설정">
                        ⚙️ 설정
                    </button>
                </div>
            `;

            // 사이드바를 메인 요소 앞에 삽입
            const focusMain = focusPanel.querySelector('.focus-main');
            if (focusMain) {
                focusPanel.insertBefore(sidebar, focusMain);
                // 메인 영역에서 sidebar-hidden 클래스 제거
                focusMain.classList.remove('sidebar-hidden');
            }

            // 키워드 목록 새로고침
            this.refreshFocusKeywordEditor(focusPanel);
        },


        // 키워드 편집기 토글
        toggleKeywordEditor() {
            const panel = document.querySelector('.keyword-editor-panel');
            if (panel) {
                const isVisible = panel.style.display !== 'none';
                panel.style.display = isVisible ? 'none' : 'block';

                if (!isVisible) {
                    this.refreshKeywordEditor();
                }
            }
        },

        // 키워드 편집기 새로고침
        refreshKeywordEditor() {
            const focusedCard = CardManager.cards.find(card => card.id === CardManager.focusedCardId);
            if (!focusedCard) return;

            const keywordList = document.querySelector('.keyword-list');
            if (!keywordList) return;

            const keywords = KeywordManager.getFolderKeywords(focusedCard.folderId);

            if (keywords.length === 0) {
                keywordList.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #6c757d; font-style: italic;">
                        이 폴더에는 아직 키워드가 없습니다.
                    </div>
                `;
                return;
            }

            const keywordsHtml = keywords.map(({ keyword, number }) => `
                <div class="keyword-editor-item" style="background: white; border: 1px solid #dee2e6; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <span style="font-weight: bold; color: #495057;">[${number}] ${keyword}</span>
                        <button onclick="KeywordEditor.deleteKeyword('${focusedCard.folderId}', '${keyword}')"
                                style="background: #c5877f; color: white; border: none; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 12px;">×</button>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="number" min="1" max="999" value="${number}"
                               onchange="KeywordEditor.updateNumber('${focusedCard.folderId}', '${keyword}', this.value)"
                               style="border: 1px solid #ced4da; border-radius: 4px; padding: 4px 6px; width: 60px; font-size: 12px;">
                        <span style="font-size: 12px; color: #6c757d;">번호 변경</span>
                    </div>
                </div>
            `).join('');

            keywordList.innerHTML = keywordsHtml;
        },

        // 설정 패널 표시
        showSettingsPanel() {
            // 기존 설정 패널 제거
            const existingPanel = document.querySelector('.ccfolia-settings-panel');
            if (existingPanel) {
                existingPanel.remove();
                return;
            }

            const settingsPanel = document.createElement('div');
            settingsPanel.className = 'ccfolia-settings-panel';
            settingsPanel.style.cssText = `
                position: fixed;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                width: 500px;
                max-height: 80vh;
                background: white;
                border-radius: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.05);
                z-index: 1000000;
                font-family: Arial, sans-serif;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            `;

            settingsPanel.innerHTML = `
                <div class="settings-header" style="background: linear-gradient(135deg, #8ba8b5 0%, #94a89a 100%); color: white; padding: 20px; text-align: center;">
                    <h2 style="margin: 0; font-size: 1.3em;">⚙️ 설정</h2>
                </div>

                <div class="settings-content" style="padding: 25px; overflow-y: auto;">
                    <div class="setting-group" style="margin-bottom: 25px;">
                        <h3 style="margin: 0 0 15px 0; color: #495057; font-size: 1.1em;">📝 키워드 사용법</h3>
                        <p style="margin: 0 0 15px 0; color: #6c757d; font-size: 13px; line-height: 1.5;">
                            키워드는 키워드 목록에서 직접 정의하고 관리할 수 있습니다.<br>
                            번호 참조: [1], #1 등의 형태로 입력하면 해당 번호의 키워드가 표시됩니다.
                        </p>
                    </div>
                </div>
            `;

            settingsPanel.innerHTML = `
                <div class="settings-header" style="background: linear-gradient(135deg, #8ba8b5 0%, #94a89a 100%); color: white; padding: 20px; text-align: center;">
                    <h2 style="margin: 0; font-size: 1.3em;">⚙️ 설정</h2>
                </div>

                <div class="settings-content" style="padding: 25px; overflow-y: auto;">
                    <div class="setting-group" style="margin-bottom: 25px;">
                        <h3>📝 키워드 사용법</h3>
                        <p>키워드는 키워드 목록에서 직접 정의하고 관리할 수 있습니다.<br>
                        번호 참조: [1], #1 등의 형태로 입력하면 해당 번호의 키워드가 표시됩니다.</p>
                    </div>

                    <div class="setting-group" style="margin-bottom: 25px;">
                        <h3 style="margin: 0 0 15px 0; color: #495057; font-size: 1.1em;">🎨 카드 레이아웃</h3>
                        <p style="margin: 0 0 15px 0; color: #6c757d; font-size: 13px; line-height: 1.5;">
                            메인 패널에서 한 줄에 표시할 카드 개수를 설정하세요.<br>
                            <span style="color: #8B6F47; font-weight: 500;">💡 1장 설정 시 패널 넓이가 컴팩트하게 조정됩니다.</span>
                        </p>
                        <div class="layout-buttons" style="display: flex; gap: 8px; margin-bottom: 16px;">
                            <button onclick="UI.setCardLayout(1)" class="layout-btn ${CardManager.settings.cardLayout.cardsPerRow === 1 ? 'active' : ''}"
                                    style="flex: 1; padding: 10px 12px; border: 1px solid ${CardManager.settings.cardLayout.cardsPerRow === 1 ? '#8B6F47' : '#D4C4A8'}; border-radius: 4px; background: ${CardManager.settings.cardLayout.cardsPerRow === 1 ? '#8B6F47' : 'white'}; color: ${CardManager.settings.cardLayout.cardsPerRow === 1 ? 'white' : '#5A3E28'}; cursor: pointer; font-size: 13px; font-weight: 500;">
                                1장 (컴팩트)
                            </button>
                            <button onclick="UI.setCardLayout(2)" class="layout-btn ${CardManager.settings.cardLayout.cardsPerRow === 2 ? 'active' : ''}"
                                    style="flex: 1; padding: 10px 12px; border: 1px solid ${CardManager.settings.cardLayout.cardsPerRow === 2 ? '#8B6F47' : '#D4C4A8'}; border-radius: 4px; background: ${CardManager.settings.cardLayout.cardsPerRow === 2 ? '#8B6F47' : 'white'}; color: ${CardManager.settings.cardLayout.cardsPerRow === 2 ? 'white' : '#5A3E28'}; cursor: pointer; font-size: 13px; font-weight: 500;">
                                2장 (기본)
                            </button>
                            <button onclick="UI.setCardLayout(3)" class="layout-btn ${CardManager.settings.cardLayout.cardsPerRow === 3 ? 'active' : ''}"
                                    style="flex: 1; padding: 10px 12px; border: 1px solid ${CardManager.settings.cardLayout.cardsPerRow === 3 ? '#8B6F47' : '#D4C4A8'}; border-radius: 4px; background: ${CardManager.settings.cardLayout.cardsPerRow === 3 ? '#8B6F47' : 'white'}; color: ${CardManager.settings.cardLayout.cardsPerRow === 3 ? 'white' : '#5A3E28'}; cursor: pointer; font-size: 13px; font-weight: 500;">
                                3장 (넓게)
                            </button>
                        </div>
                    </div>

                    <div class="setting-group" style="margin-bottom: 25px;">
                        <h3 style="margin: 0 0 15px 0; color: #495057; font-size: 1.1em;">📋 일반 설정</h3>

                        <div style="display: flex; align-items: center; margin-bottom: 12px;">
                            <input type="checkbox" id="autoNumber" ${CardManager.settings.autoNumber ? 'checked' : ''}
                                   style="margin-right: 8px; width: 16px; height: 16px;">
                            <label for="autoNumber" style="color: #495057; font-size: 13px;">자동 번호 매기기</label>
                        </div>

                        <div style="display: flex; align-items: center; margin-bottom: 12px;">
                            <input type="checkbox" id="defaultExpanded" ${CardManager.settings.defaultExpanded ? 'checked' : ''}
                                   style="margin-right: 8px; width: 16px; height: 16px;">
                            <label for="defaultExpanded" style="color: #495057; font-size: 13px;">새 카드 기본 펼치기</label>
                        </div>

                        <div style="display: flex; align-items: center; margin-bottom: 12px;">
                            <input type="checkbox" id="autoSave" ${CardManager.settings.autoSave ? 'checked' : ''}
                                   style="margin-right: 8px; width: 16px; height: 16px;">
                            <label for="autoSave" style="color: #495057; font-size: 13px;">자동 저장</label>
                        </div>
                    </div>

                    <!-- 투명도 설정 -->
                    <div class="setting-group" style="margin-bottom: 25px;">
                        <h3 style="margin: 0 0 15px 0; color: #495057; font-size: 1.1em;">⚪ 투명도 설정</h3>

                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #495057; font-size: 13px;">📋 기본 모드 투명도</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="range" id="defaultOpacity" min="10" max="100" value="${CardManager.settings.opacity.default}"
                                       style="flex: 1; height: 6px; border-radius: 3px; background: #e9ecef; outline: none; appearance: none;">
                                <span id="defaultOpacityValue" style="font-weight: bold; color: #8e94a0; min-width: 40px; font-size: 12px;">${CardManager.settings.opacity.default}%</span>
                            </div>
                        </div>

                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #495057; font-size: 13px;">🎯 집중 모드 투명도</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="range" id="focusOpacity" min="10" max="100" value="${CardManager.settings.opacity.focus}"
                                       style="flex: 1; height: 6px; border-radius: 3px; background: #e9ecef; outline: none; appearance: none;">
                                <span id="focusOpacityValue" style="font-weight: bold; color: #8e94a0; min-width: 40px; font-size: 12px;">${CardManager.settings.opacity.focus}%</span>
                            </div>
                        </div>

                        <button onclick="UI.resetOpacitySettings()" style="width: 100%; background: #9da1a9; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-top: 5px;">투명도 초기화</button>
                    </div>

                    <!-- 버튼 위치 설정 -->
                    <div class="setting-group" style="margin-bottom: 25px;">
                        <h3 style="margin: 0 0 15px 0; color: #495057; font-size: 1.1em;">📍 버튼 위치 설정</h3>

                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #495057; font-size: 13px;">트리거 버튼 위치 (세로)</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="range" id="buttonTopPosition" min="5" max="95" value="${CardManager.settings.buttonPosition?.top || 50}"
                                       style="flex: 1; height: 6px; border-radius: 3px; background: #e9ecef; outline: none; appearance: none;">
                                <span id="buttonTopValue" style="font-weight: bold; color: #8e94a0; min-width: 40px; font-size: 12px;">${CardManager.settings.buttonPosition?.top || 50}%</span>
                            </div>
                            <div style="margin-top: 8px; font-size: 11px; color: #666; line-height: 1.3;">
                                5% = 화면 상단 근처, 50% = 중앙, 95% = 하단 근처<br>
                                <span style="color: #e74c3c; font-weight: 500;">[※ 새로고침 부탁드립니다!]</span>
                            </div>
                        </div>

                        <button onclick="UI.resetPositionSettings()" style="width: 100%; background: #9da1a9; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">버튼 위치 초기화</button>
                    </div>
                </div>

                <div class="settings-footer" style="padding: 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                    <!-- 숨겨진 이스터 에그 버튼 -->
                    <div style="text-align: center; margin-bottom: 15px;">
                        <button onclick="UI.rollDiceEasterEgg()" style="background: transparent; border: none; color: #ccc; font-size: 10px; cursor: pointer; padding: 2px 6px; opacity: 0.3;" 
                                onmouseover="this.style.opacity='0.6'" onmouseout="this.style.opacity='0.3'">🎲🎲🎲</button>
                        <!-- 주사위 결과 표시 영역 -->
                        <div id="diceResultText" style="font-size: 11px; color: #666; margin-top: 5px; min-height: 14px;"></div>
                        
                        <!-- 업적 버튼 (최초 성공 후 표시) -->
                        <div id="achievementButtonContainer" style="margin-top: 10px; display: none;">
                            <button onclick="UI.showAchievementsPanel()" style="background: linear-gradient(135deg, #8B6F47, #A0522D); color: #F5DEB3; border: 1px solid #654321; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold;">
                                🏆 업적
                            </button>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button onclick="UI.closeSettingsPanel()" style="background: #9da1a9; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer;">취소</button>
                        <button onclick="UI.saveSettings()" style="background: #94a89a; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer;">저장</button>
                    </div>
                </div>
            `;

            document.body.appendChild(settingsPanel);

            // 드래그 기능 추가
            const header = settingsPanel.querySelector('.settings-header');
            AdvancedDragSystem.createInstance(settingsPanel, header);
            
            // 슬라이더 이벤트 추가 (실시간 업데이트)
            const defaultSlider = settingsPanel.querySelector('#defaultOpacity');
            const defaultValue = settingsPanel.querySelector('#defaultOpacityValue');
            const focusSlider = settingsPanel.querySelector('#focusOpacity');
            const focusValue = settingsPanel.querySelector('#focusOpacityValue');
            const positionSlider = settingsPanel.querySelector('#buttonTopPosition');
            const positionValue = settingsPanel.querySelector('#buttonTopValue');

            // 투명도 슬라이더 이벤트
            defaultSlider.oninput = function () {
                const value = this.value;
                defaultValue.textContent = value + '%';
                CardManager.settings.opacity.default = parseInt(value);
                UI.updatePanelOpacity();
                DataManager.save();
            };

            focusSlider.oninput = function () {
                const value = this.value;
                focusValue.textContent = value + '%';
                CardManager.settings.opacity.focus = parseInt(value);
                UI.updatePanelOpacity();
                DataManager.save();
            };

            // 버튼 위치 슬라이더 이벤트
            positionSlider.oninput = function () {
                let value = parseInt(this.value);
                
                // 5~95% 범위로 제한
                value = Math.max(5, Math.min(95, value));
                
                positionValue.textContent = value + '%';
                
                // 설정값 업데이트
                if (!CardManager.settings.buttonPosition) {
                    CardManager.settings.buttonPosition = {};
                }
                CardManager.settings.buttonPosition.top = value;
                
                // 버튼 위치 업데이트
                UI.updateButtonPosition();
                
                // 설정 저장
                DataManager.save();
            };
            
            // 업적 버튼 가시성 챌크
            this.checkAchievementButtonVisibility();
        },

        // 설정 패널 닫기
        closeSettingsPanel() {
            const settingsPanel = document.querySelector('.ccfolia-settings-panel');
            if (settingsPanel) {
                // 드래그 인스턴스 제거
                AdvancedDragSystem.removeInstance(settingsPanel);
                
                // 주사위 결과 텍스트 초기화
                const resultText = document.getElementById('diceResultText');
                if (resultText) {
                    resultText.textContent = '';
                }
                
                settingsPanel.remove();
            }
        },

        // 이스터 에그: 1d10 주사위 3개 굴리기
        rollDiceEasterEgg() {
            // 1d10 주사위 3개 굴리기 (각각 1~10 범위)
            const dice1 = this.roll1d10();
            const dice2 = this.roll1d10();
            const dice3 = this.roll1d10();
            
            console.log(`🎲 주사위 결과: ${dice1}, ${dice2}, ${dice3}`);
            
            // 3개 모두 같은 숫자인지 확인
            if (dice1 === dice2 && dice2 === dice3) {
                // 특별한 메시지 박스 표시
                this.showEasterEggMessage(dice1);
            } else {
                // 일반 결과 메시지
                this.showDiceResult(dice1, dice2, dice3);
            }
        },

        // 1d10 주사위 굴리기 (1~10)
        roll1d10() {
            return Math.floor(Math.random() * 10) + 1;
        },

        // 이스터 에그 메시지 박스 (모든 주사위가 같을 때)
        showEasterEggMessage(number) {
            // 업적 달성 처리
            this.unlockDiceAchievement(number);
            
            // 1d10 결과별 메시지와 캐릭터 이미지
            const easterEggData = {
                1: {
                    message: "🎉 대실패는 세션의 묘미죠! 코딩은... 슬프더라구요.",
                    image: "https://drive.google.com/uc?id=1I93c1BpjB-mBFogbNIlEcuOLqodpzbPX" // 1번 캐릭터 이미지
                },
                2: {
                    message: "✨ 둘수사를 두 번 가는 날! 둘수사를 두 번 가는 날!",
                    image: "https://drive.google.com/uc?id=1I93c1BpjB-mBFogbNIlEcuOLqodpzbPX" // 2번 캐릭터 이미지
                },
                3: {
                    message: "🍀 언젠가 프로그램을 만들면 이스터에그를 남겨보고 싶었어요.",
                    image: "https://drive.google.com/uc?id=1I93c1BpjB-mBFogbNIlEcuOLqodpzbPX" // 3번 캐릭터 이미지
                },
                4: {
                    message: " 틈새 * https://kre.pe/HxFH * 홍보 ",
                    image: "https://drive.google.com/uc?id=1I93c1BpjB-mBFogbNIlEcuOLqodpzbPX" // 4번 캐릭터 이미지
                },
                5: {
                    message: "🌈 둘수사 서플 발매 기원중...",
                    image: "https://drive.google.com/uc?id=1I93c1BpjB-mBFogbNIlEcuOLqodpzbPX" // 5번 캐릭터 이미지
                },
                6: {
                    message: "왼쪽의 토큰이 멋지고 예쁘고 훌륭한가요? 언제든 신청 가능! https://kre.pe/l6pR",
                    image: "https://drive.google.com/uc?id=1I93c1BpjB-mBFogbNIlEcuOLqodpzbPX" // 6번 캐릭터 이미지
                },
                7: {
                    message: "🌟 즐거운 세션을 같이할 상대만큼의 행운이 탐정님에게 찾아오길.",
                    image: "https://drive.google.com/uc?id=1I93c1BpjB-mBFogbNIlEcuOLqodpzbPX" // 7번 캐릭터 이미지
                },
                8: {
                    message: "💫 https://kre.pe/cB0r 짜잔 커미션 항상 오픈!",
                    image: "https://drive.google.com/uc?id=1I93c1BpjB-mBFogbNIlEcuOLqodpzbPX" // 8번 캐릭터 이미지
                },
                9: {
                    message: "🎯 추가적인 배포및 안내 사항은 https://www.postype.com/@bysmile 를 참조해주세요. ",
                    image: "https://drive.google.com/uc?id=1I93c1BpjB-mBFogbNIlEcuOLqodpzbPX" // 9번 캐릭터 이미지
                },
                10: {
                    message: "🎊 축하드립니다! 그리고 감사합니다! 세션이 도움 되는 프로그램이었길 바랍니다!",
                    image: "https://drive.google.com/uc?id=1I93c1BpjB-mBFogbNIlEcuOLqodpzbPX" // 10번 캐릭터 이미지
                }
            };
            
            const data = easterEggData[number] || { 
                message: "🎉 놀라운 결과입니다!", 
                image: "https://drive.google.com/uc?id=1I93c1BpjB-mBFogbNIlEcuOLqodpzbPX" 
            };
            
            // 각 결과별 확률 계산 (1d10 3개가 모두 같을 확률)
            const probabilities = {
                1: 1/1000,   // (1/10)^3
                2: 1/1000,   // (1/10)^3
                3: 1/1000,   // (1/10)^3
                4: 1/1000,   // (1/10)^3
                5: 1/1000,   // (1/10)^3
                6: 1/1000,   // (1/10)^3
                7: 1/1000,   // (1/10)^3
                8: 1/1000,   // (1/10)^3
                9: 1/1000,   // (1/10)^3
                10: 1/1000   // (1/10)^3
            };
            
            const probability = probabilities[number] || 0;
            const percentageText = (probability * 100).toFixed(4) + '%';
            
            // 언더테일 스타일의 메시지 박스 생성
            const easterEggBox = document.createElement('div');
            easterEggBox.style.cssText = `
                position: fixed;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                width: 480px;
                background: #000;
                border: 4px solid #fff;
                border-radius: 0;
                box-shadow: 
                    0 0 0 2px #000,
                    8px 8px 0 #333,
                    inset 0 0 20px rgba(255, 255, 255, 0.1);
                z-index: 9999999;
                font-family: 'Determination Mono', 'Courier New', monospace;
                color: #fff;
                overflow: hidden;
                animation: undertaleAppear 0.5s ease-out;
            `;
            
            easterEggBox.innerHTML = `
                <div style="position: relative; padding: 20px; background: linear-gradient(45deg, #000 25%, #111 25%, #111 50%, #000 50%, #000 75%, #111 75%); background-size: 8px 8px;">
                    <!-- 캐릭터 이미지 -->
                    <div style="position: absolute; left: 15px; top: 15px; width: 80px; height: 80px; border: 2px solid #fff; background: #222; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                        <img src="${data.image}" 
                             style="width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated;"
                             onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=&quot;color: #ffff00; font-size: 16px; text-align: center; font-weight: bold;&quot;>&#127922;</div>';"
                             alt="캐릭터">
                    </div>
                    
                    <!-- 메시지 영역 -->
                    <div style="margin-left: 100px; min-height: 80px; display: flex; flex-direction: column; justify-content: center;">
                        <!-- 주사위 결과 -->
                        <div style="font-size: 20px; margin-bottom: 12px; color: #ffff00; text-shadow: 2px 2px 0 #000; letter-spacing: 1px; font-weight: bold;">
                            🎲 ${number} - ${number} - ${number} 🎲
                        </div>
                        
                        <!-- 메시지 텍스트 -->
                        <div style="font-size: 14px; line-height: 1.4; color: #fff; text-shadow: 1px 1px 0 #000; letter-spacing: 0.5px;">
                            ${Utils.convertLinksToClickable(data.message)}
                        </div>
                        
                        <!-- 확률 정보 -->
                        <div style="font-size: 10px; color: #aaa; margin-top: 8px; text-shadow: 1px 1px 0 #000;">
                            * 확률: ${percentageText}
                        </div>
                    </div>
                    
                    <!-- 하단 버튼 영역 -->
                    <div style="margin-top: 15px; text-align: center; border-top: 2px solid #fff; padding-top: 15px;">
                        <button onclick="this.parentElement.parentElement.remove()" 
                                style="background: #fff; color: #000; border: 2px solid #000; padding: 8px 20px; font-family: inherit; font-size: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; transition: all 0.1s ease;"
                                onmouseover="this.style.background='#ffff00'; this.style.transform='scale(1.05)';" 
                                onmouseout="this.style.background='#fff'; this.style.transform='scale(1)';">
                            ✧ CONTINUE ✧
                        </button>
                    </div>
                </div>
            `;
            
            // 언더테일 스타일 CSS 애니메이션 추가
            if (!document.querySelector('#undertaleStyles')) {
                const style = document.createElement('style');
                style.id = 'undertaleStyles';
                style.textContent = `
                    @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
                    
                    @keyframes undertaleAppear {
                        0% { 
                            opacity: 0; 
                            transform: translate(-50%, -50%) scale(0.8);
                            filter: blur(2px);
                        }
                        50% {
                            opacity: 1;
                            transform: translate(-50%, -50%) scale(1.05);
                            filter: blur(0);
                        }
                        100% { 
                            opacity: 1; 
                            transform: translate(-50%, -50%) scale(1);
                            filter: blur(0);
                        }
                    }
                    
                    @keyframes undertaleGlow {
                        0%, 100% { text-shadow: 1px 1px 0 #000, 0 0 5px #ffff00; }
                        50% { text-shadow: 1px 1px 0 #000, 0 0 15px #ffff00, 0 0 25px #ffff00; }
                    }
                `;
                document.head.appendChild(style);
            }
            
            document.body.appendChild(easterEggBox);
            
            // 10초 후 자동으로 닫기
            setTimeout(() => {
                if (easterEggBox.parentNode) {
                    easterEggBox.style.animation = 'undertaleAppear 0.3s ease-in reverse';
                    setTimeout(() => {
                        if (easterEggBox.parentNode) {
                            easterEggBox.remove();
                        }
                    }, 300);
                }
            }, 10000);
        },

        // 일반 주사위 결과 표시
        showDiceResult(dice1, dice2, dice3) {
            const resultText = document.getElementById('diceResultText');
            if (resultText) {
                // 같은 숫자가 나왔는지 확인
                const allSame = (dice1 === dice2 && dice2 === dice3);
                
                // 표시 형식 설정
                if (allSame) {
                    // 같은 숫자이면 볼드 처리
                    resultText.innerHTML = `🎲 <strong>${dice1}-${dice2}-${dice3}</strong> 🎲`;
                    resultText.style.fontWeight = '500';
                } else {
                    // 다른 숫자이면 일반 표시
                    resultText.textContent = `🎲 ${dice1}-${dice2}-${dice3} 🎲`;
                    resultText.style.fontWeight = '500';
                }
                
                resultText.style.color = '#8B6F47';
                
                // 3초 후 사라지기
                setTimeout(() => {
                    if (resultText) {
                        resultText.textContent = '';
                        resultText.style.color = '#666';
                        resultText.style.fontWeight = 'normal';
                    }
                }, 3000);
            }
        },

        // 주사위 업적 달성 처리
        unlockDiceAchievement(number) {
            const achievements = CardManager.diceAchievements;
            
            // 이미 달성한 업적인지 확인
            if (!achievements.unlocked.includes(number)) {
                achievements.unlocked.push(number);
                
                // 최초 업적이면 시간 기록
                if (!achievements.firstAchievement) {
                    achievements.firstAchievement = {
                        number: number,
                        timestamp: Date.now(),
                        date: new Date().toLocaleDateString('ko-KR')
                    };
                    
                    // 업적 버튼 표시
                    this.showAchievementButton();
                }
            }
            
            // 달성 횟수 증가
            if (!achievements.achievementCounts[number]) {
                achievements.achievementCounts[number] = 0;
            }
            achievements.achievementCounts[number]++;
            
            // 데이터 저장
            DataManager.save();
            
            console.log(`🏆 업적 달성: ${number} (총 ${achievements.achievementCounts[number]}회)`);
        },

        // 업적 버튼 표시
        showAchievementButton() {
            const container = document.getElementById('achievementButtonContainer');
            if (container) {
                container.style.display = 'block';
            }
        },

        // 업적 패널 표시
        showAchievementsPanel() {
            // 기존 패널 제거
            const existingPanel = document.querySelector('.achievements-panel');
            if (existingPanel) {
                existingPanel.remove();
                return;
            }

            const achievementsPanel = document.createElement('div');
            achievementsPanel.className = 'achievements-panel';
            achievementsPanel.style.cssText = `
                position: fixed;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                width: 500px;
                max-height: 70vh;
                background: white;
                border-radius: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.15);
                z-index: 1000001;
                font-family: Arial, sans-serif;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            `;

            const achievements = CardManager.diceAchievements;
            const totalAchievements = achievements.unlocked.length;
            const allNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            
            let achievementsList = '';
            allNumbers.forEach(num => {
                const isUnlocked = achievements.unlocked.includes(num);
                const count = achievements.achievementCounts[num] || 0;
                const probability = this.getDiceProbability(num);
                
                achievementsList += `
                    <div style="display: flex; align-items: center; padding: 12px; border-bottom: 1px solid #eee; ${isUnlocked ? 'background: #f0f8f0;' : 'background: #f8f8f8; opacity: 0.6;'}">
                        <div style="font-size: 24px; margin-right: 15px;">${isUnlocked ? '🏆' : '🔒'}</div>
                        <div style="flex: 1;">
                            <div style="font-weight: bold; color: ${isUnlocked ? '#2d5a2d' : '#999'}; margin-bottom: 4px;">
                                모든 주사위가 ${num}!
                            </div>
                            <div style="font-size: 11px; color: #666;">
                                확률: ${probability}% ${isUnlocked ? `| 달성 ${count}회` : ''}
                            </div>
                        </div>
                        <div style="font-size: 12px; color: ${isUnlocked ? '#2d5a2d' : '#ccc'}; font-weight: bold;">
                            ${isUnlocked ? '달성!' : '미달성'}
                        </div>
                    </div>
                `;
            });

            achievementsPanel.innerHTML = `
                <div class="achievements-header" style="background: linear-gradient(135deg, #8B6F47, #A0522D); color: white; padding: 20px; text-align: center;">
                    <h2 style="margin: 0; font-size: 1.3em;">🏆 주사위 업적</h2>
                    <div style="font-size: 13px; margin-top: 8px; opacity: 0.9;">
                        달성: ${totalAchievements}/10 업적
                        ${achievements.firstAchievement ? `| 최초 달성: ${achievements.firstAchievement.date}` : ''}
                    </div>
                </div>

                <div class="achievements-content" style="flex: 1; overflow-y: auto; max-height: 400px;">
                    ${achievementsList}
                </div>

                <div class="achievements-footer" style="padding: 15px; background: #f8f9fa; border-top: 1px solid #eee; text-align: center;">
                    <button onclick="this.parentElement.parentElement.remove()" style="background: #8B6F47; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">닫기</button>
                </div>
            `;

            document.body.appendChild(achievementsPanel);

            // 드래그 기능 추가
            const header = achievementsPanel.querySelector('.achievements-header');
            AdvancedDragSystem.createInstance(achievementsPanel, header);
        },

        // 주사위 확률 계산 (1d10 시스템용)
        getDiceProbability(number) {
            // 1d10 주사위 3개가 모두 같을 확률: 1/1000 = 0.1%
            return 0.1;
        },

        // 업적 버튼 가시성 확인
        checkAchievementButtonVisibility() {
            const container = document.getElementById('achievementButtonContainer');
            if (container && CardManager.diceAchievements.firstAchievement) {
                container.style.display = 'block';
            }
        },

        // 설정 저장
        saveSettings() {
            const autoNumber = document.getElementById('autoNumber').checked;
            const defaultExpanded = document.getElementById('defaultExpanded').checked;
            const autoSave = document.getElementById('autoSave').checked;
            
            // 투명도 설정
            const defaultOpacity = parseInt(document.getElementById('defaultOpacity').value);
            const focusOpacity = parseInt(document.getElementById('focusOpacity').value);
            
            // 버튼 위치 설정
            const buttonPosition = parseInt(document.getElementById('buttonTopPosition').value);

            // 설정 업데이트
            CardManager.settings.autoNumber = autoNumber;
            CardManager.settings.defaultExpanded = defaultExpanded;
            CardManager.settings.autoSave = autoSave;
            
            // 투명도 설정 업데이트
            CardManager.settings.opacity.default = defaultOpacity;
            CardManager.settings.opacity.focus = focusOpacity;
            
            // 버튼 위치 설정 업데이트 (5~95% 범위 제한)
            const clampedPosition = Math.max(5, Math.min(95, buttonPosition));
            if (!CardManager.settings.buttonPosition) {
                CardManager.settings.buttonPosition = {};
            }
            CardManager.settings.buttonPosition.top = clampedPosition;

            // 저장
            DataManager.save();
            
            // UI 업데이트
            this.updatePanelOpacity();
            this.updateButtonPosition();

            // 패널 닫기
            this.closeSettingsPanel();

            // 알림
            Utils.showNotification(`⚙️ 설정이 저장되었습니다!`);

            console.log('✅ 설정 업데이트:', CardManager.settings);
        },

        // 모든 콘텐츠 새로고침 (설정 변경 후)
        refreshAllContent() {
            // 메인 패널 카드들 새로고침
            this.renderCards();

            // 집중 모드 패널이 열려있다면 새로고침
            const focusPanel = document.querySelector('.ccfolia-focus-panel');
            if (focusPanel) {
                this.updateFocusContent();
                this.refreshFocusKeywordEditor();
            }

            console.log('🔄 모든 콘텐츠가 새로고침되었습니다.');
        },

        // 모든 카드 펼치기
        expandAllCards() {
            const currentFolderCards = CardManager.cards.filter(card => card.folderId === CardManager.selectedFolderId);
            currentFolderCards.forEach(card => {
                card.isExpanded = true;
            });
            this.renderCards();
            DataManager.save();
            Utils.showNotification(`📂 ${currentFolderCards.length}개 카드가 모두 펼쳐졌습니다.`);
        },

        // 모든 카드 접기
        collapseAllCards() {
            const currentFolderCards = CardManager.cards.filter(card => card.folderId === CardManager.selectedFolderId);
            currentFolderCards.forEach(card => {
                card.isExpanded = false;
            });
            this.renderCards();
            DataManager.save();
            Utils.showNotification(`📁 ${currentFolderCards.length}개 카드가 모두 접혔습니다.`);
        },

        // 투명도 설정 창 표시
        showOpacitySettings() {
            // 기존 설정창이 있으면 제거
            const existingSettings = document.querySelector('.opacity-settings-panel');
            if (existingSettings) {
                existingSettings.remove();
                return;
            }

            const settingsPanel = document.createElement('div');
            settingsPanel.className = 'opacity-settings-panel';
            settingsPanel.style.cssText = `
                position: fixed;
                right: 20px;
                top: 50%;
                transform: translateY(-50%);
                width: 300px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.05);
                z-index: 1000000;
                font-family: Arial, sans-serif;
                overflow: hidden;
            `;

            settingsPanel.innerHTML = `
                <div class="settings-header" style="background: linear-gradient(135deg, #8e94a0, #9da1a9); color: white; padding: 15px; text-align: center;">
                    <h3 style="margin: 0; font-size: 1.1em;">⚪ 투명도 설정</h3>
                </div>
                <div class="settings-content" style="padding: 20px;">
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #495057;">📋 기본 모드 투명도</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="range" id="defaultOpacity" min="10" max="100" value="${CardManager.settings.opacity.default}"
                                   style="flex: 1; height: 6px; border-radius: 3px; background: #e9ecef; outline: none; appearance: none;">
                            <span id="defaultOpacityValue" style="font-weight: bold; color: #8e94a0; min-width: 40px;">${CardManager.settings.opacity.default}%</span>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #495057;">🎯 집중 모드 투명도</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="range" id="focusOpacity" min="10" max="100" value="${CardManager.settings.opacity.focus}"
                                   style="flex: 1; height: 6px; border-radius: 3px; background: #e9ecef; outline: none; appearance: none;">
                            <span id="focusOpacityValue" style="font-weight: bold; color: #8e94a0; min-width: 40px;">${CardManager.settings.opacity.focus}%</span>
                        </div>
                    </div>

                    <div style="display: flex; gap: 8px; margin-top: 20px;">
                        <button onclick="UI.resetOpacitySettings()" style="flex: 1; background: #9da1a9; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">초기화</button>
                        <button onclick="UI.closeOpacitySettings()" style="flex: 1; background: #8e94a0; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">확인</button>
                    </div>
                </div>
            `;

            document.body.appendChild(settingsPanel);

            // 슬라이더 이벤트 추가
            const defaultSlider = settingsPanel.querySelector('#defaultOpacity');
            const defaultValue = settingsPanel.querySelector('#defaultOpacityValue');
            const focusSlider = settingsPanel.querySelector('#focusOpacity');
            const focusValue = settingsPanel.querySelector('#focusOpacityValue');

            defaultSlider.oninput = function () {
                const value = this.value;
                defaultValue.textContent = value + '%';
                CardManager.settings.opacity.default = parseInt(value);
                UI.updatePanelOpacity();
                DataManager.save();
            };

            focusSlider.oninput = function () {
                const value = this.value;
                focusValue.textContent = value + '%';
                CardManager.settings.opacity.focus = parseInt(value);
                UI.updatePanelOpacity();
                DataManager.save();
            };
        },

        // 투명도 설정 창 닫기
        closeOpacitySettings() {
            const settingsPanel = document.querySelector('.opacity-settings-panel');
            if (settingsPanel) {
                settingsPanel.remove();
            }
        },




        // 버튼 위치 설정 창 표시
        showPositionSettings() {
            // 기존 설정창이 있으면 제거
            const existingSettings = document.querySelector('.position-settings-panel');
            if (existingSettings) {
                existingSettings.remove();
                return;
            }

            // 현재 설정값 확인 및 범위 조정
            let currentTop = CardManager.settings.buttonPosition?.top || 50;
            
            // 5~95% 범위로 제한
            currentTop = Math.max(5, Math.min(95, currentTop));
            
            // 제한된 값으로 설정값 업데이트
            if (CardManager.settings.buttonPosition.top !== currentTop) {
                CardManager.settings.buttonPosition.top = currentTop;
                DataManager.save();
                console.log(`🔧 버튼 위치를 유효 범위로 조정: ${currentTop}%`);
            }
            
            console.log(`🔍 현재 버튼 위치 설정: ${currentTop}% (유효 범위: 5-95%)`);

            const settingsPanel = document.createElement('div');
            settingsPanel.className = 'position-settings-panel';
            settingsPanel.style.cssText = `
                position: fixed;
                right: 20px;
                top: 50%;
                transform: translateY(-50%);
                width: 300px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.05);
                z-index: 1000000;
                font-family: Arial, sans-serif;
                overflow: hidden;
            `;

            settingsPanel.innerHTML = `
                <div class="settings-header" style="background: linear-gradient(135deg, #8e94a0, #9da1a9); color: white; padding: 15px; text-align: center;">
                    <h3 style="margin: 0; font-size: 1.1em;">📍 버튼 위치 설정</h3>
                </div>
                <div class="settings-content" style="padding: 20px;">
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #495057;">🎯 높이를 조절하는 코드</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="range" id="buttonTopPosition" min="5" max="95" value="${currentTop}"
                                   style="flex: 1; height: 6px; border-radius: 3px; background: #e9ecef; outline: none; appearance: none;">
                            <span id="buttonTopValue" style="font-weight: bold; color: #8e94a0; min-width: 40px;">${currentTop}%</span>
                        </div>
                        <div style="margin-top: 8px; font-size: 11px; color: #666;">
                            5% = 화면 상단 근처, 50% = 중앙, 95% = 하단 근처
                            [※ 새로고침 부탁드립니다!]
                        </div>
                    </div>

                    <div style="display: flex; gap: 8px; margin-top: 20px;">
                        <button onclick="UI.resetPositionSettings()" style="flex: 1; background: #9da1a9; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">초기화</button>
                        <button onclick="UI.closePositionSettings()" style="flex: 1; background: #8e94a0; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">확인</button>
                    </div>
                </div>
            `;

            document.body.appendChild(settingsPanel);

            // 슬라이더 이벤트 추가
            const positionSlider = settingsPanel.querySelector('#buttonTopPosition');
            const positionValue = settingsPanel.querySelector('#buttonTopValue');

            positionSlider.oninput = function () {
                let value = parseInt(this.value);
                
                // 5~95% 범위로 제한
                value = Math.max(5, Math.min(95, value));
                
                positionValue.textContent = value + '%';
                
                // 설정값 업데이트
                CardManager.settings.buttonPosition.top = value;
                
                // 즉시 버튼 위치 업데이트
                UI.updateButtonPosition();
                
                // 설정 저장
                DataManager.save();
                
                // 디버깅 로그
                console.log(`🎯 슬라이더로 버튼 위치 변경: ${value}% (유효 범위: 5-95%)`);
            };
        },

        // 버튼 위치 설정 창 닫기
        closePositionSettings() {
            const settingsPanel = document.querySelector('.position-settings-panel');
            if (settingsPanel) {
                settingsPanel.remove();
            }
        },

        // 버튼 위치 설정 초기화
        resetPositionSettings() {
            // 설정값을 50%로 초기화
            CardManager.settings.buttonPosition.top = 50;

            // UI 업데이트
            const positionSlider = document.querySelector('#buttonTopPosition');
            const positionValue = document.querySelector('#buttonTopValue');

            if (positionSlider) positionSlider.value = 50;
            if (positionValue) positionValue.textContent = '50%';

            // 버튼 위치 업데이트
            UI.updateButtonPosition();
            
            // 설정 저장
            DataManager.save();
            
            // 알림 메시지
            Utils.showNotification('버튼 위치가 중앙(50%)으로 초기화되었습니다.');
            
            console.log('🔄 버튼 위치 설정 초기화 완료: 50%');
        },

        // 투명도 설정 초기화
        resetOpacitySettings() {
            CardManager.settings.opacity.default = 100;
            CardManager.settings.opacity.focus = 100;

            const defaultSlider = document.querySelector('#defaultOpacity');
            const defaultValue = document.querySelector('#defaultOpacityValue');
            const focusSlider = document.querySelector('#focusOpacity');
            const focusValue = document.querySelector('#focusOpacityValue');

            if (defaultSlider) {
                defaultSlider.value = 100;
                defaultValue.textContent = '100%';
            }
            if (focusSlider) {
                focusSlider.value = 100;
                focusValue.textContent = '100%';
            }

            this.updatePanelOpacity();
            DataManager.save();
            Utils.showNotification('투명도 설정이 초기화되었습니다.');
        },

        // 패널 투명도 업데이트
        updatePanelOpacity() {
            const mainPanel = document.querySelector('.ccfolia-card-panel');
            const focusPanel = document.querySelector('.ccfolia-focus-panel');

            if (mainPanel) {
                Utils.applyOpacity(mainPanel, 'default');
            }
            if (focusPanel) {
                Utils.applyOpacity(focusPanel, 'focus');
            }
        },

        // 버튼 위치 업데이트 함수
        updateButtonPosition() {
            const button = document.querySelector('.ccfolia-card-trigger');
            if (button && CardManager.settings.buttonPosition) {
                let topValue = CardManager.settings.buttonPosition.top;
                
                // 5~95% 범위로 제한
                topValue = Math.max(5, Math.min(95, topValue));
                
                // 제한된 값으로 설정값 업데이트
                if (CardManager.settings.buttonPosition.top !== topValue) {
                    CardManager.settings.buttonPosition.top = topValue;
                    DataManager.save();
                }
                
                button.style.setProperty('top', `${topValue}%`, 'important');
                button.style.setProperty('transform', 'translateY(-50%)', 'important');
                button.style.setProperty('position', 'fixed', 'important');
                button.style.setProperty('left', '0', 'important');
                console.log(`🔄 버튼 위치 업데이트: ${topValue}% (유효 범위: 5-95%)`);
            }
        },
        
        // 버튼을 웹사이트 높이 중앙으로 설정
        setButtonToCenter() {
            const button = document.querySelector('.ccfolia-card-trigger');
            if (button) {
                // 직접 스타일 설정으로 강제 적용
                button.style.setProperty('top', '50%', 'important');
                button.style.setProperty('transform', 'translateY(-50%)', 'important');
                button.style.setProperty('position', 'fixed', 'important');
                button.style.setProperty('left', '0', 'important');
                
                console.log('🎯 버튼 위치를 50%로 강제 설정했습니다');
            }
            
            // 설정값을 50%로 업데이트
            if (CardManager.settings.buttonPosition) {
                CardManager.settings.buttonPosition.top = 50;
            }
            // 설정 저장
            DataManager.save();
        },

        // ==================== 키워드 관리 패널 관련 ====================

        // 키워드 관리 패널 표시
        showKeywordManagementPanel() {
            // 기존 패널 제거
            const existingPanel = document.querySelector('.keyword-management-panel');
            if (existingPanel) {
                existingPanel.remove();
                return;
            }

            const currentFolderId = CardManager.selectedFolderId;
            const currentFolder = CardManager.folders.find(f => f.id === currentFolderId);

            const panel = document.createElement('div');
            panel.className = 'keyword-management-panel';
            panel.style.cssText = `
                position: fixed;
                right: 20px;
                top: 50%;
                transform: translateY(-50%);
                width: 450px;
                height: 700px;
                background: linear-gradient(145deg, #E8DDD0, #F5F0E8);
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.08);
                z-index: 1000000;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                font-family: Arial, sans-serif;
            `;

            panel.innerHTML = `
                <!-- 헤더 -->
                <div class="panel-header" style="background: linear-gradient(135deg, #3D2916, #5D4037); color: white; padding: 16px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <h2 style="margin: 0; font-size: 1.2em; font-weight: 600;">🏷️ 키워드 관리</h2>
                        <div class="folder-badge" style="font-size: 11px; opacity: 0.85; background: rgba(255,255,255,0.15); padding: 4px 8px; border-radius: 10px;">${currentFolder ? currentFolder.name : '알 수 없음'}</div>
                    </div>
                    <button onclick="UI.closeKeywordManagementPanel()" style="background: rgba(255,255,255,0.15); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 14px;">×</button>
                </div>

                <!-- 키워드 추가 영역 -->
                <div style="background: #f8f9fa; padding: 16px; border-bottom: 1px solid #e9ecef;">
                    <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                        <input type="text"
                               id="new-keyword-name"
                               placeholder="키워드 이름..."
                               style="flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;"
                               onkeypress="if(event.key==='Enter') UI.addNewKeyword()">
                        <select id="new-keyword-type" style="padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
                            <option value="normal">일반</option>
                            <option value="important">중요</option>
                        </select>
                        <button onclick="UI.addNewKeyword()"
                                style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">
                            추가
                        </button>
                    </div>
                    <div style="font-size: 12px; color: #6c757d;">
                        💡 폴더 내 모든 카드에서 공용으로 사용됩니다.
                    </div>
                </div>

                <!-- 키워드 목록 -->
                <div class="keyword-content" style="flex: 1; padding: 16px; overflow-y: auto; background: #fafbfc;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <h4 style="margin: 0; color: #495057; font-size: 14px;">📋 키워드 목록</h4>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button onclick="UI.reorderCurrentFolderKeywords()"
                                    style="background: #6c757d; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;"
                                    title="번호 재정렬">🔢</button>
                            <span class="keyword-count" style="font-size: 12px; color: #6c757d;">총 0개</span>
                        </div>
                    </div>

                    <!-- 검색 -->
                    <input type="text" id="keyword-search" placeholder="키워드 검색..."
                           style="width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px; margin-bottom: 12px; box-sizing: border-box;"
                           onkeyup="UI.filterKeywords(this.value)">

                    <!-- 키워드 리스트 -->
                    <div class="keyword-list" id="keyword-list-container">
                        <!-- 키워드들이 동적으로 생성됩니다 -->
                    </div>
                </div>
            `;

            document.body.appendChild(panel);

            // 드래그 기능 추가
            const header = panel.querySelector('.panel-header');
            AdvancedDragSystem.createInstance(panel, header);
            Utils.applyOpacity(panel, 'default');

            // 초기 키워드 목록 렌더링
            this.refreshKeywordList();

            return panel;
        },

        // 키워드 관리 패널 닫기
        closeKeywordManagementPanel() {
            const panel = document.querySelector('.keyword-management-panel');
            if (panel) {
                // 드래그 인스턴스 제거
                AdvancedDragSystem.removeInstance(panel);
                panel.remove();
            }
        },

        // 새 키워드 추가
        addNewKeyword() {
            const nameInput = document.getElementById('new-keyword-name');
            const typeSelect = document.getElementById('new-keyword-type');

            if (!nameInput || !typeSelect) return;

            const name = nameInput.value.trim();
            const type = typeSelect.value;

            if (!name) {
                Utils.showNotification('키워드 이름을 입력해주세요.', true);
                return;
            }

            const currentFolderId = CardManager.selectedFolderId;

            // 중복 체크
            const existingKeywords = Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === currentFolderId);

            if (existingKeywords.some(kw => kw.name === name)) {
                Utils.showNotification('이미 존재하는 키워드입니다.', true);
                return;
            }

            // 키워드 생성
            const keywordId = NewKeywordManager.createKeyword(name, type, currentFolderId);

            // 입력 필드 초기화
            nameInput.value = '';
            nameInput.focus();

            // 목록 새로고침
            this.refreshKeywordList();

            const typeText = type === 'important' ? '중요' : '일반';
            Utils.showNotification(`${typeText} 키워드 "${name}"이 추가되었습니다.`);
        },

        // 키워드 목록 새로고침
        refreshKeywordList() {
            const container = document.getElementById('keyword-list-container');
            const countElement = document.querySelector('.keyword-count');
            if (!container || !countElement) return;

            const currentFolderId = CardManager.selectedFolderId;
            const folderKeywords = Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === currentFolderId)
                .sort((a, b) => (a.number || 0) - (b.number || 0));

            container.innerHTML = folderKeywords.map((keyword, index) => {
                const typeIcon = keyword.type === 'important' ? '『』' : '「」';
                const typeColor = keyword.type === 'important' ? '#c5877f' : '#94a89a';
                const typeBadge = keyword.type === 'important' ? '중요' : '일반';

                return `
                    <div class="keyword-item"
                         draggable="true"
                         data-keyword-id="${keyword.id}"
                         data-keyword-number="${keyword.number || index + 1}"
                         style="display: flex; align-items: center; margin-bottom: 10px; padding: 12px; background: white; border-radius: 8px; border: 1px solid #e9ecef; cursor: move;"
                         onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'"
                         onmouseout="this.style.boxShadow='none'"
                         ondragstart="UI.handleKeywordDragStart(event)"
                         ondragover="UI.handleKeywordDragOver(event)"
                         ondrop="UI.handleKeywordDrop(event)"
                         ondragend="UI.handleKeywordDragEnd(event)">
                        <div style="display: flex; align-items: center; margin-right: 12px;">
                            <div style="width: 8px; height: 30px; background: #dee2e6; border-radius: 3px; margin-right: 8px; display: flex; flex-direction: column; justify-content: center; cursor: grab;" title="드래그해서 순서 변경">
                                <div style="width: 100%; height: 2px; background: #6c757d; margin: 1px 0;"></div>
                                <div style="width: 100%; height: 2px; background: #6c757d; margin: 1px 0;"></div>
                                <div style="width: 100%; height: 2px; background: #6c757d; margin: 1px 0;"></div>
                            </div>
                            <div style="width: 40px; height: 30px; background: ${typeColor}; color: white; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 13px;">
                                ${keyword.number || index + 1}
                            </div>
                        </div>
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                <span style="font-weight: 500; font-size: 14px;">${keyword.name}</span>
                                <span style="background: ${typeColor}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px;">${typeBadge}</span>
                            </div>
                            <div style="font-size: 11px; color: #6c757d;">
                                호출: ${keyword.number}, [${keyword.number}], #${keyword.number}
                            </div>
                        </div>
                        <div style="display: flex; gap: 4px;">
                            <button onclick="UI.editKeywordName('${keyword.id}')"
                                    style="background: #17a2b8; color: white; border: none; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;"
                                    title="이름 수정">✏️</button>
                            <button onclick="UI.toggleKeywordTypeInPanel('${keyword.id}')"
                                    style="background: #ffc107; color: black; border: none; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;"
                                    title="타입 변경">${typeIcon}</button>
                            <button onclick="UI.deleteKeywordFromPanel('${keyword.id}')"
                                    style="background: #c5877f; color: white; border: none; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;"
                                    title="삭제">🗑️</button>
                        </div>
                    </div>
                `;
            }).join('');

            countElement.textContent = `총 ${folderKeywords.length}개`;
        },

        // 키워드 이름 수정
        editKeywordName(keywordId) {
            const keyword = CardManager.keywordDatabase[keywordId];
            if (!keyword) return;

            const newName = prompt('키워드 이름을 수정하세요:', keyword.name);
            if (newName && newName.trim() && newName.trim() !== keyword.name) {
                const trimmedName = newName.trim();

                // 중복 체크
                const existingKeywords = Object.values(CardManager.keywordDatabase)
                    .filter(kw => kw.folderId === keyword.folderId && kw.id !== keywordId);

                if (existingKeywords.some(kw => kw.name === trimmedName)) {
                    Utils.showNotification('이미 존재하는 키워드 이름입니다.', true);
                    return;
                }

                // 키워드 수정
                NewKeywordManager.updateKeyword(keywordId, { name: trimmedName });
                this.refreshKeywordList();
                Utils.showNotification(`키워드가 "${trimmedName}"로 수정되었습니다.`);
            }
        },

        // 키워드 타입 토글 (패널용)
        toggleKeywordTypeInPanel(keywordId) {
            const keyword = CardManager.keywordDatabase[keywordId];
            if (!keyword) return;

            const newType = keyword.type === 'important' ? 'normal' : 'important';
            NewKeywordManager.updateKeyword(keywordId, { type: newType });
            this.refreshKeywordList();

            const typeText = newType === 'important' ? '중요' : '일반';
            Utils.showNotification(`"${keyword.name}" 키워드가 ${typeText} 타입으로 변경되었습니다.`);
        },

        // 키워드 삭제 (패널용)
        deleteKeywordFromPanel(keywordId) {
            const keyword = CardManager.keywordDatabase[keywordId];
            if (!keyword) return;

            if (confirm(`"${keyword.name}" 키워드를 삭제하시겠습니까?\n\n⚠️ 이 키워드를 사용하는 모든 카드에서도 제거되고, 번호가 재정렬됩니다.`)) {
                const keywordName = keyword.name;
                NewKeywordManager.deleteKeyword(keywordId);
                this.refreshKeywordList();

                // 카드 미리보기도 업데이트 (키워드 번호가 변경되었을 수 있음)
                setTimeout(() => UI.renderCards(), 100);

                Utils.showNotification(`"${keywordName}" 키워드가 삭제되었습니다. 번호가 재정렬되었습니다.`);
            }
        },

        // 키워드 필터링
        filterKeywords(searchTerm) {
            const items = document.querySelectorAll('.keyword-item');
            const term = searchTerm.toLowerCase();

            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(term) ? 'flex' : 'none';
            });
        },

        // 현재 폴더의 키워드 번호 재정렬
        reorderCurrentFolderKeywords() {
            const currentFolderId = CardManager.selectedFolderId;
            const folderKeywords = Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === currentFolderId);

            if (folderKeywords.length === 0) {
                Utils.showNotification('재정렬할 키워드가 없습니다.', true);
                return;
            }

            if (confirm(`현재 폴더의 ${folderKeywords.length}개 키워드 번호를 순차적으로 재정렬하시겠습니까?\n\n기존 참조([1], [2] 등)가 변경될 수 있습니다.`)) {
                NewKeywordManager.reorderFolderKeywords(currentFolderId);
                this.refreshKeywordList();

                // 카드 미리보기도 업데이트
                setTimeout(() => UI.renderCards(), 100);

                Utils.showNotification('키워드 번호가 순차적으로 재정렬되었습니다.');
            }
        },

        // ==================== 드래그 앤 드롭 기능 ====================

        // 드래그 시작
        handleKeywordDragStart(event) {
            const item = event.target.closest('.keyword-item');
            if (!item) return;

            // 드래그되는 요소 정보 저장
            event.dataTransfer.setData('text/plain', item.dataset.keywordId);
            event.dataTransfer.effectAllowed = 'move';

            // 드래그 중인 요소 스타일 변경
            item.style.opacity = '0.5';
            item.style.transform = 'scale(0.95)';

            // 전역 변수에 드래그 중인 요소 저장
            this.draggedElement = item;
        },

        // 드래그 오버 (드래그된 요소가 다른 요소 위를 지날 때)
        handleKeywordDragOver(event) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';

            const item = event.target.closest('.keyword-item');
            if (!item || item === this.draggedElement) return;

            // 드롭 존 표시
            item.style.borderTop = '2px solid #007bff';
        },

        // 드래그 드롭
        handleKeywordDrop(event) {
            event.preventDefault();

            const dropTarget = event.target.closest('.keyword-item');
            if (!dropTarget || dropTarget === this.draggedElement) return;

            const draggedKeywordId = event.dataTransfer.getData('text/plain');
            const targetKeywordId = dropTarget.dataset.keywordId;

            // 키워드 순서 변경
            this.reorderKeywords(draggedKeywordId, targetKeywordId);

            // 스타일 리셋
            dropTarget.style.borderTop = '';
        },

        // 드래그 종료
        handleKeywordDragEnd(event) {
            const item = event.target.closest('.keyword-item');
            if (!item) return;

            // 드래그 중인 요소 스타일 복원
            item.style.opacity = '';
            item.style.transform = '';

            // 모든 드롭 존 표시 제거
            document.querySelectorAll('.keyword-item').forEach(el => {
                el.style.borderTop = '';
            });

            this.draggedElement = null;
        },

        // 키워드 순서 변경
        reorderKeywords(draggedKeywordId, targetKeywordId) {
            const draggedKeyword = CardManager.keywordDatabase[draggedKeywordId];
            const targetKeyword = CardManager.keywordDatabase[targetKeywordId];

            if (!draggedKeyword || !targetKeyword) return;

            const currentFolderId = CardManager.selectedFolderId;
            const folderKeywords = Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === currentFolderId)
                .sort((a, b) => (a.number || 0) - (b.number || 0));

            // 드래그된 키워드와 타겟 키워드의 인덱스 찾기
            const draggedIndex = folderKeywords.findIndex(kw => kw.id === draggedKeywordId);
            const targetIndex = folderKeywords.findIndex(kw => kw.id === targetKeywordId);

            if (draggedIndex === -1 || targetIndex === -1) return;

            // 배열에서 드래그된 요소 제거하고 새 위치에 삽입
            const [movedKeyword] = folderKeywords.splice(draggedIndex, 1);
            folderKeywords.splice(targetIndex, 0, movedKeyword);

            // 새로운 번호로 업데이트
            folderKeywords.forEach((keyword, index) => {
                NewKeywordManager.updateKeyword(keyword.id, { number: index + 1 });
            });

            // UI 새로고침
            this.refreshKeywordList();
            setTimeout(() => UI.renderCards(), 100);

            Utils.showNotification(`"${draggedKeyword.name}" 키워드 순서가 변경되었습니다.`);
        },

        // TODO 키워드 패널 생성
        createTodoKeywordPanel() {
            const panel = document.createElement('div');
            panel.className = 'ccfolia-todokeyword-panel';
            panel.style.cssText = `
                position: fixed;
                right: 20px;
                top: 50%;
                transform: translateY(-50%);
                width: 400px;
                height: 600px;
                background: linear-gradient(145deg, #E8DDD0, #F5F0E8);
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.08);
                z-index: 1000000;
                display: none;
                flex-direction: column;
                overflow: hidden;
                font-family: Arial, sans-serif;
            `;

            panel.innerHTML = `
                <!-- 헤더 -->
                <div class="panel-header" style="background: linear-gradient(135deg, #3D2916, #5D4037); color: white; padding: 16px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <h2 style="margin: 0; font-size: 1.1em; font-weight: 600;">📋 키워드 상태</h2>
                        <div class="progress-summary" style="font-size: 11px; opacity: 0.85; background: rgba(255,255,255,0.15); padding: 3px 8px; border-radius: 10px;"></div>
                    </div>
                    <button onclick="UI.toggleTodoKeywordPanel()" style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 14px;">×</button>
                </div>

                <!-- 폴더 선택 바 -->
                <div style="background: #f8f9fa; padding: 12px 16px; border-bottom: 1px solid #e9ecef; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 13px; color: #6c757d; font-weight: 500;">폴더:</span>
                    <select id="keyword-folder-selector" onchange="UI.changeKeywordFolder(this.value)" style="flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: white;">
                        <!-- 폴더 옵션들이 동적으로 추가됩니다 -->
                    </select>
                    <div class="folder-info" style="font-size: 11px; color: #6c757d; white-space: nowrap;"></div>
                </div>

                <!-- 키워드 목록 -->
                <div class="keyword-section" style="flex: 1; padding: 12px; overflow-y: auto; background: #fafbfc;">
                    <!-- 간단한 컨트롤 -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 0 4px;">
                        <span style="font-size: 12px; color: #6c757d; font-weight: 500;">📋 TODO 키워드</span>
                        <div style="display: flex; gap: 6px;">
                            <button onclick="UI.markAllTodoKeywordsInProgress()"
                                    style="background: #d4b896; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 500; box-shadow: 0 2px 4px rgba(0,0,0,0.05);"
                                    title="모든 키워드를 진행중으로 표시"
                                    onmouseover="this.style.transform='translateY(-1px)'"
                                    onmouseout="this.style.transform='translateY(0)'">
                                ⏳ 전체진행중
                            </button>
                            <button onclick="UI.markAllTodoKeywordsCompleted()"
                                    style="background: #94a89a; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 500; box-shadow: 0 2px 4px rgba(0,0,0,0.05);"
                                    title="모든 키워드를 완료로 표시"
                                    onmouseover="this.style.transform='translateY(-1px)'"
                                    onmouseout="this.style.transform='translateY(0)'">
                                ✅ 전체완료
                            </button>
                        </div>
                    </div>

                    <!-- 검색 -->
                    <input type="text" id="todokeyword-search" placeholder="키워드 검색..." style="width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px; margin-bottom: 12px; box-sizing: border-box;" onkeyup="UI.filterTodoKeywords(this.value)">

                    <!-- 키워드 리스트 -->
                    <div class="todokeyword-list"></div>
                </div>
            `;

            document.body.appendChild(panel);

            // 드래그 기능 추가
            const header = panel.querySelector('.panel-header');
            AdvancedDragSystem.createInstance(panel, header);
            Utils.applyOpacity(panel, 'default');

            return panel;
        },

        // TODO 키워드 패널 새로고침
        refreshTodoKeywordPanel() {
            this.refreshFolderSelector();
            this.refreshCurrentFolderDisplay();
            this.refreshTodoKeywordList();
        },

        // 폴더 선택기 새로고침
        refreshFolderSelector() {
            try {
                const selector = document.querySelector('#keyword-folder-selector');
                if (!selector) {
                    console.warn('⚠️ 폴더 선택기 요소를 찾을 수 없습니다.');
                    return;
                }

                console.log('📁 폴더 목록:', CardManager.folders);
                console.log('📁 현재 선택된 폴더:', CardManager.selectedFolderId);

                // 폴더 옵션 생성
                const options = CardManager.folders.map(folder =>
                    `<option value="${folder.id}" ${folder.id === CardManager.selectedFolderId ? 'selected' : ''}>
                        ${folder.name}
                    </option>`
                ).join('');

                selector.innerHTML = options;
                console.log('📁 폴더 선택기 새로고침 완료');
            } catch (error) {
                console.error('❌ 폴더 선택기 새로고침 오류:', error);
            }
        },

        // 현재 폴더 표시 새로고침
        refreshCurrentFolderDisplay() {
            const currentFolderDisplay = document.querySelector('.current-folder-display');
            const progressSummary = document.querySelector('.progress-summary');
            const folderInfo = document.querySelector('.folder-info');

            const currentFolder = CardManager.folders.find(f => f.id === CardManager.selectedFolderId);
            if (currentFolder) {
                const folderKeywords = Object.values(CardManager.keywordDatabase).filter(kw => kw.folderId === currentFolder.id);
                const keywords = folderKeywords.map(kw => kw.name);
                const completedCount = keywords.filter(keyword =>
                    CardManager.todoKeyword.completedKeywords[`${currentFolder.id}_${keyword}`]
                ).length;
                const totalCount = keywords.length;

                // 키워드 패널의 폴더 표시 업데이트
                if (currentFolderDisplay) {
                    currentFolderDisplay.textContent = `${currentFolder.name}`;
                }

                // 폴더 정보 표시 업데이트
                if (folderInfo) {
                    const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
                    folderInfo.textContent = `키워드: ${totalCount}개 | 완료: ${completedCount}개 (${progressPercent}%)`;
                }

                // 헤더의 진행률 요약 업데이트
                if (progressSummary) {
                    const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
                    progressSummary.textContent = `완료: ${completedCount}/${totalCount} (${progressPercent}%)`;
                }
            }
        },

        // 집중 모드 텍스트 설정 업데이트 (통합)
        updateFocusTextSetting(key, value) {
            // 숫자형 값 변환
            if (key === 'fontSize' || key === 'lineHeight' || key === 'letterSpacing' || key === 'wordSpacing') {
                value = parseFloat(value);
            }

            // 설정 저장
            CardManager.settings.focusMode[key] = value;

            // UI 업데이트
            const contentArea = document.querySelector('.focus-panel-content');
            const previewArea = document.getElementById('focus-text-preview');

            if (contentArea && key === 'lineHeight') {
                contentArea.style.setProperty('--line-height', value);
            }

            const styleProperty = {
                fontSize: 'fontSize',
                lineHeight: 'lineHeight',
                letterSpacing: 'letterSpacing',
                wordSpacing: 'wordSpacing',
                textAlign: 'textAlign',
                fontWeight: 'fontWeight',
                fontFamily: 'fontFamily'
            }[key];

            const styleValue = {
                fontSize: `${value}px`,
                lineHeight: value,
                letterSpacing: `${value}px`,
                wordSpacing: `${value}em`,
                textAlign: value,
                fontWeight: value,
                fontFamily: value === 'default' ? '"Pretendard", sans-serif' : `"${value}", "Pretendard", sans-serif`
            }[key];

            if (contentArea) contentArea.style[styleProperty] = styleValue;
            if (previewArea) previewArea.style[styleProperty] = styleValue;

            // 값 표시 업데이트
            const valueElement = document.getElementById(`focus-${key.toLowerCase()}-value`);
            if (valueElement) {
                const unit = { fontSize: 'px', letterSpacing: 'px', wordSpacing: 'em' }[key] || '';
                valueElement.textContent = `${value}${unit}`;
            }

            // 정렬 버튼 활성 상태 업데이트
            if (key === 'textAlign') {
                document.querySelectorAll('.align-btn').forEach(btn => btn.classList.remove('active'));
                document.querySelector(`.align-btn[onclick*="'${value}'"]`)?.classList.add('active');
            }

            DataManager.save();
        },

        // TODO 키워드 목록 새로고침
        refreshTodoKeywordList() {
            const keywordList = document.querySelector('.todokeyword-list');
            if (!keywordList) return;

            const folderId = CardManager.selectedFolderId;
            const folderKeywords = Object.values(CardManager.keywordDatabase).filter(kw => kw.folderId === folderId);
            const keywords = folderKeywords.map(kw => [kw.name, kw.number]);

            if (keywords.length === 0) {
                keywordList.innerHTML = `
                    <div style="text-align: center; color: #6c757d; padding: 20px;">
                        <p>이 폴더에는 키워드가 없습니다.</p>
                        <p style="font-size: 12px; opacity: 0.8;">카드에서 키워드를 사용하면 자동으로 표시됩니다.</p>
                    </div>
                `;
                return;
            }

            const keywordsHtml = keywords
                .filter(([keyword]) => !CardManager.todoKeyword.searchQuery || keyword.includes(CardManager.todoKeyword.searchQuery))
                .sort((a, b) => a[1] - b[1])
                .map(([keyword, number]) => {
                    const isHidden = !NewKeywordManager.isKeywordVisible(folderId, keyword);
                    const isCompleted = NewKeywordManager.isKeywordCompleted(folderId, keyword);

                    // 키워드가 실제로 사용되는 카드들 찾기
                    const usingCards = CardManager.cards.filter(card =>
                        card.folderId === folderId &&
                        (card.content.includes(`【${keyword}】`) || card.content.includes(`『${keyword}』`))
                    );

                    // 상태에 따른 스타일
                    // 투두키워드는 진행중/완료 상태만 관리
                    const completionIcon = isCompleted ? '✅' : '⏳';
                    const completionColor = isCompleted ? '#28a745' : '#ffc107';
                    const completionText = isCompleted ? '완료' : '진행중';

                    const itemOpacity = isCompleted ? '0.8' : '1';
                    const textDecoration = isCompleted ? 'line-through' : 'none';
                    const itemBackground = isCompleted ? '#f8f9fa' : 'white';

                    return `
                        <div class="todokeyword-item" style="
                            background: ${itemBackground};
                            border: 1px solid ${isCompleted ? '#28a745' : '#e9ecef'};
                            border-radius: 6px;
                            padding: 10px 12px;
                            margin-bottom: 6px;
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            opacity: ${itemOpacity};
                            transition: all 0.2s ease;
                        " onmouseover="this.style.borderColor='${isCompleted ? '#28a745' : '#007bff'}'" onmouseout="this.style.borderColor='${isCompleted ? '#28a745' : '#e9ecef'}'">

                            <!-- 키워드 정보 -->
                            <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
                                <span style="font-weight: 600; color: #495057; font-size: 12px; width: 26px; text-align: center; background: ${completionColor}20; color: ${completionColor}; border-radius: 4px; padding: 3px 2px;">[${number}]</span>
                                <span style="color: #495057; font-size: 14px; text-decoration: ${textDecoration}; font-weight: ${isCompleted ? 'normal' : '500'};">${keyword}</span>
                                <span style="font-size: 10px; color: #6c757d; background: #f8f9fa; padding: 2px 6px; border-radius: 8px;">${usingCards.length}개</span>

                                <!-- 상태 표시 -->
                                <div style="margin-left: auto;">
                                    <span style="font-size: 11px; padding: 4px 10px; border-radius: 12px; background: ${completionColor}; color: white; font-weight: 600;">${completionText}</span>
                                </div>
                            </div>

                            <!-- 완료 토글 버튼 -->
                            <div style="margin-left: 12px;">
                                <button onclick="UI.toggleKeywordCompletion('${folderId}', '${keyword}')"
                                        style="background: ${completionColor}; color: white; border: none; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);"
                                        title="${isCompleted ? '완료를 취소하고 진행중으로 변경' : '완료로 표시하기'}"
                                        onmouseover="this.style.transform='scale(1.05)'"
                                        onmouseout="this.style.transform='scale(1)'">
                                    ${completionIcon}
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

            keywordList.innerHTML = keywordsHtml;
        },

        // TODO 키워드 검색 필터
        filterTodoKeywords(query) {
            CardManager.todoKeyword.searchQuery = query;
            this.refreshTodoKeywordList();
        },

        // 폴더 사이드바 토글
        toggleFolderSidebar() {
            const panel = document.querySelector('.ccfolia-card-panel');
            if (!panel) {
                console.warn('⚠️ 메인 패널이 없습니다. 집중 모드에서는 폴더 토글을 사용할 수 없습니다.');
                Utils.showNotification('폴더 패널은 메인 화면에서만 사용할 수 있습니다.', true);
                return; // 패널이 없으면 실행하지 않음
            }

            const sidebar = panel.querySelector('.folder-sidebar');
            const mainContent = panel.querySelector('.main-content');
            const toggleTab = panel.querySelector('.folder-toggle-tab');

            if (!sidebar || !mainContent) {
                console.warn('⚠️ 폴더 사이드바 또는 메인 컨텐츠를 찾을 수 없습니다.');
                return;
            }

            const isCollapsed = CardManager.settings.folderSidebarCollapsed;

            if (isCollapsed) {
                // 사이드바 펼치기
                sidebar.style.display = 'block';
                sidebar.style.width = '240px';
                if (toggleTab) {
                    toggleTab.style.display = 'none';
                }
                mainContent.style.paddingLeft = '0';
                CardManager.settings.folderSidebarCollapsed = false;
                Utils.showNotification('📁 폴더 패널이 펼쳐졌습니다.');
            } else {
                // 사이드바 접기
                sidebar.style.display = 'none';
                if (toggleTab) {
                    toggleTab.style.display = 'flex';
                }
                mainContent.style.paddingLeft = '0';
                CardManager.settings.folderSidebarCollapsed = true;
                Utils.showNotification('📁 폴더 패널이 접혔습니다.');
            }

            DataManager.save();
        },

        // 폴더 사이드바 상태 복원
        restoreFolderSidebarState() {
            setTimeout(() => {
                const panel = document.querySelector('.ccfolia-card-panel');
                if (!panel) {
                    console.log('📝 메인 패널이 없어 폴더 사이드바 상태를 복원할 수 없습니다.');
                    return; // 패널이 없으면 실행하지 않음
                }

                const sidebar = panel.querySelector('.folder-sidebar');
                const mainContent = panel.querySelector('.main-content');
                const toggleTab = panel.querySelector('.folder-toggle-tab');

                if (!sidebar || !mainContent || !toggleTab) {
                    console.warn('⚠️ 폴더 UI 요소를 찾을 수 없어 상태 복원을 건너뜩니다.');
                    return;
                }

                if (CardManager.settings.folderSidebarCollapsed) {
                    // 사이드바 숨기고 토글 버튼 표시
                    sidebar.style.display = 'none';
                    toggleTab.style.display = 'flex';
                    mainContent.style.paddingLeft = '0';
                    console.log('📁 폴더 사이드바 접힌 상태로 복원되었습니다.');
                } else {
                    // 사이드바 표시하고 토글 버튼 숨김
                    sidebar.style.display = 'block';
                    toggleTab.style.display = 'none';
                    mainContent.style.paddingLeft = '0';
                    console.log('📁 폴더 사이드바 펼쳐진 상태로 복원되었습니다.');
                }
            }, 100);
        },

        // 카드 레이아웃 설정
        setCardLayout(cardsPerRow) {
            CardManager.settings.cardLayout.cardsPerRow = cardsPerRow;
            DataManager.save();

            // 즉시 카드 레이아웃 적용
            this.renderCards();

            // 패널 넓이 동적 조정
            this.adjustPanelWidth(cardsPerRow);

            // 폴더 사이드바 상태 복원 (레이아웃 변경 후 토글 버튼 상태 유지)
            this.restoreFolderSidebarState();

            // 설정 패널의 버튼 상태 업데이트
            const settingsPanel = document.querySelector('.ccfolia-settings-panel');
            if (settingsPanel) {
                settingsPanel.querySelectorAll('.layout-btn').forEach(btn => {
                    btn.style.background = 'white';
                    btn.style.color = '#5A3E28';
                    btn.style.border = '1px solid #D4C4A8';
                });

                const activeBtn = settingsPanel.querySelector(`button[onclick="UI.setCardLayout(${cardsPerRow})"]`);
                if (activeBtn) {
                    activeBtn.style.background = '#8B6F47';
                    activeBtn.style.color = 'white';
                    activeBtn.style.border = '1px solid #8B6F47';
                }
            }

            const layoutNames = { 1: '컴팩트', 2: '기본', 3: '넓게' };
            const widthInfo = cardsPerRow === 1 ? ' - 패널 넓이도 컴팩트하게 조정됨' : '';
            Utils.showNotification(`🎨 카드 레이아웃이 ${cardsPerRow}장 (${layoutNames[cardsPerRow]})으로 변경되었습니다${widthInfo}`);
        },

        // 패널 넓이 동적 조정
        adjustPanelWidth(cardsPerRow) {
            const panel = document.querySelector('.ccfolia-card-panel');
            if (!panel) return;

            let newWidth, maxWidth;

            switch (cardsPerRow) {
                case 1:
                    // 1장: 컴팩트한 넓이 (카드 1장 + 여백)
                    newWidth = '50vw';
                    maxWidth = '600px';
                    break;
                case 2:
                    // 2장: 기본 넓이 (카드 2장 + 여백)
                    newWidth = '75vw';
                    maxWidth = '900px';
                    break;
                case 3:
                    // 3장: 넓은 넓이 (카드 3장 + 여백)
                    newWidth = '90vw';
                    maxWidth = '1200px';
                    break;
                default:
                    newWidth = '75vw';
                    maxWidth = '900px';
            }

            // 간단한 애니메이션과 함께 넓이 조정
            panel.style.transition = 'width 0.3s ease, max-width 0.3s ease';
            panel.style.width = newWidth;
            panel.style.maxWidth = maxWidth;

            // 애니메이션 완료 후 transition 제거
            setTimeout(() => {
                panel.style.transition = '';
            }, 300);
        },

        // 키워드 패널에서 폴더 변경
        changeKeywordFolder(folderId) {
            if (folderId === CardManager.selectedFolderId) return;

            const oldFolder = CardManager.folders.find(f => f.id === CardManager.selectedFolderId);
            const newFolder = CardManager.folders.find(f => f.id === folderId);

            if (!newFolder) return;

            CardManager.selectedFolderId = folderId;

            // 키워드 패널 새로고침
            this.refreshTodoKeywordPanel();

            // 메인 패널도 새로고침 (폴더가 변경되었으므로)
            if (CardManager.isVisible) {
                this.renderFolders();
                this.renderCards();
            }

            DataManager.save();

            Utils.showNotification(`📁 "${newFolder.name}" 폴더로 변경되었습니다.`);
        },

        // 키워드 완료 상태 토글 (통합 시스템 사용)
        toggleKeywordCompletion(folderId, keyword) {
            const newCompleted = NewKeywordManager.toggleKeywordCompletion(folderId, keyword);

            this.refreshTodoKeywordPanel();
            // 집중 모드가 활성화된 경우 내용 업데이트
            if (CardManager.focusedCardId) {
                this.updateFocusContent();
            }
            this.renderCards();

            Utils.showNotification(`${newCompleted ? '✅ 완료 표시' : '⬜ 진행중으로 변경'}: "${keyword}"`);
        },

        // 키워드 집중 선택 토글
        toggleKeywordSelection(folderId, keyword) {
            const key = `${folderId}_${keyword}`;
            const index = CardManager.todoKeyword.selectedKeywords.indexOf(key);

            if (index > -1) {
                CardManager.todoKeyword.selectedKeywords.splice(index, 1);
                Utils.showNotification(`🔍 "${keyword}" 집중 해제`);
            } else {
                CardManager.todoKeyword.selectedKeywords.push(key);
                Utils.showNotification(`🎯 "${keyword}" 집중 선택`);
            }

            this.refreshTodoKeywordPanel();
            DataManager.save();
        },


        // 모든 TODO 키워드를 진행중으로 표시 (통합 시스템 사용)
        markAllTodoKeywordsInProgress() {
            const folderId = CardManager.selectedFolderId;
            NewKeywordManager.markAllInProgress(folderId);

            this.refreshTodoKeywordPanel();
            // 집중 모드가 활성화된 경우 내용 업데이트
            if (CardManager.focusedCardId) {
                this.updateFocusContent();
            }
            this.renderCards();

            const folderKeywords = Object.values(CardManager.keywordDatabase).filter(kw => kw.folderId === folderId);
            const keywords = folderKeywords.map(kw => kw.name);
            Utils.showNotification(`⏳ ${keywords.length}개 키워드를 모두 진행중으로 변경했습니다.`);
        },

        // 모든 TODO 키워드를 완료로 표시 (통합 시스템 사용)
        markAllTodoKeywordsCompleted() {
            const folderId = CardManager.selectedFolderId;
            NewKeywordManager.markAllCompleted(folderId);

            this.refreshTodoKeywordPanel();
            // 집중 모드가 활성화된 경우 내용 업데이트
            if (CardManager.focusedCardId) {
                this.updateFocusContent();
            }
            this.renderCards();

            const folderKeywords = Object.values(CardManager.keywordDatabase).filter(kw => kw.folderId === folderId);
            const keywords = folderKeywords.map(kw => kw.name);
            Utils.showNotification(`✅ ${keywords.length}개 키워드를 모두 완료로 변경했습니다.`);
        },

        // 키워드 관리자 UI 표시
        showKeywordManager(cardId) {
            // 기존 키워드 관리자가 있으면 제거
            const existingManager = document.querySelector('.keyword-manager-panel');
            if (existingManager) {
                existingManager.remove();
            }

            const card = CardManager.cards.find(c => c.id === cardId);
            if (!card) return;

            const manager = document.createElement('div');
            manager.className = 'keyword-manager-panel';
            manager.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 600px;
                max-height: 80vh;
                background: white;
                border-radius: 12px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.08);
                z-index: 1000001;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                font-family: Arial, sans-serif;
            `;

            const keywords = NewKeywordManager.getCardKeywords(cardId);
            const folderKeywords = NewKeywordManager.getFolderKeywords(card.folderId);

            manager.innerHTML = `
                <div class="manager-header" style="background: linear-gradient(135deg, #fd7e14, #f59e0b); color: white; padding: 20px; display: flex; justify-content: space-between; align-items: center;">
                    <h2 style="margin: 0; font-size: 1.3em;">🏷️ 키워드 관리: ${card.name}</h2>
                    <button onclick="this.closest('.keyword-manager-panel').remove()" style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer;">×</button>
                </div>

                <div class="manager-content" style="flex: 1; padding: 20px; overflow-y: auto;">
                    <!-- 카드 키워드 목록 -->
                    <div class="card-keywords-section" style="margin-bottom: 24px;">
                        <h3 style="margin: 0 0 12px 0; color: #495057; font-size: 1.1em;">📝 카드 키워드 (텍스트에서 [1], [2] 형식으로 사용)</h3>
                        <div class="card-keywords-list" style="background: #f8f9fa; border-radius: 8px; padding: 12px; min-height: 80px;">
                            ${keywords.length === 0 ?
                    '<div style="text-align: center; color: #6c757d; font-style: italic;">키워드가 없습니다. 아래에서 추가하세요.</div>' :
                    keywords.map((keyword, index) => `
                                    <div class="keyword-item" style="background: white; border: 1px solid #e9ecef; border-radius: 6px; padding: 8px 12px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                                        <div style="display: flex; align-items: center; gap: 8px;">
                                            <span style="font-weight: 600; color: #495057; font-size: 12px; background: #f1f3f4; padding: 2px 6px; border-radius: 4px;">[${index + 1}]</span>
                                            <span style="font-size: 14px; color: #495057;">${keyword.name}</span>
                                            <span style="font-size: 10px; padding: 2px 6px; border-radius: 8px; background: ${keyword.type === 'important' ? '#c5877f' : '#8e94a0'}; color: white;">${keyword.type === 'important' ? '중요' : '일반'}</span>
                                        </div>
                                        <div style="display: flex; gap: 4px;">
                                            <button onclick="UI.removeKeywordFromCard('${cardId}', '${keyword.id}')" style="background: #c5877f; color: white; border: none; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px;">×</button>
                                        </div>
                                    </div>
                                `).join('')
                }
                        </div>
                    </div>

                    <!-- 새 키워드 추가 -->
                    <div class="add-keyword-section" style="margin-bottom: 24px; padding: 16px; background: #e8f5e8; border-radius: 8px;">
                        <h4 style="margin: 0 0 12px 0; color: #495057;">➕ 새 키워드 추가</h4>
                        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                            <input type="text" id="new-keyword-name" placeholder="키워드 이름" style="flex: 1; padding: 8px 12px; border: 1px solid #ced4da; border-radius: 4px; font-size: 14px;">
                            <select id="new-keyword-type" style="padding: 8px 12px; border: 1px solid #ced4da; border-radius: 4px;">
                                <option value="normal">일반</option>
                                <option value="important">중요</option>
                            </select>
                            <button onclick="UI.addNewKeywordToCard('${cardId}')" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">추가</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(manager);
        },

        // 카드에 새 키워드 추가
        addNewKeywordToCard(cardId) {
            const nameInput = document.getElementById('new-keyword-name');
            const typeSelect = document.getElementById('new-keyword-type');

            const name = nameInput.value.trim();
            const type = typeSelect.value;

            if (!name) {
                Utils.showNotification('❌ 키워드 이름을 입력하세요.');
                return;
            }

            const card = CardManager.cards.find(c => c.id === cardId);
            if (!card) return;

            // 키워드 생성
            const keywordId = NewKeywordManager.createKeyword(name, type, card.folderId);

            // 카드에 추가
            NewKeywordManager.addKeywordToCard(cardId, keywordId);

            // UI 새로고침
            this.showKeywordManager(cardId);
            this.renderCards();

            Utils.showNotification(`✅ 키워드 "${name}"가 추가되었습니다.`);
        },

        // 카드에서 키워드 제거
        removeKeywordFromCard(cardId, keywordId) {
            NewKeywordManager.removeKeywordFromCard(cardId, keywordId);
            this.showKeywordManager(cardId);
            this.renderCards();
            const keyword = CardManager.keywordDatabase[keywordId];
            Utils.showNotification(`🗑️ 키워드 "${keyword.name}"가 제거되었습니다.`);
        },

        // 집중 모드 텍스트 설정 초기화
        resetFocusTextSettings() {
            const defaultSettings = {
                fontSize: 16,
                fontFamily: 'default',
                lineHeight: 1.8,
                letterSpacing: 0.3,
                wordSpacing: 0.2,
                textAlign: 'left',
                fontWeight: 400
            };
            CardManager.settings.focusMode = { ...defaultSettings };

            // 모든 설정 UI 업데이트
            Object.entries(defaultSettings).forEach(([key, value]) => {
                this.updateFocusTextSetting(key, value);

                // 슬라이더 및 선택박스 값도 초기화
                const inputEl = document.getElementById(`focus-${key.toLowerCase()}`);
                if (inputEl) {
                    if (key === 'lineHeight' || key === 'letterSpacing' || key === 'wordSpacing') {
                        inputEl.value = (value * 10).toFixed(0);
                    } else {
                        inputEl.value = value;
                    }
                }
            });

            // 설정 패널이 열려있다면 UI 즉시 업데이트
            const settingsPanel = document.querySelector('.focus-settings-panel');
            if (settingsPanel) {
                this.closeFocusSettingsPanel();
                setTimeout(() => this.showFocusSettingsPanel(), 100);
            }

            Utils.showNotification('🔄 텍스트 설정이 초기화되었습니다.');
            DataManager.save();
        },

    };

    // ==================== 카드 액션 ====================
    const CardActions = {
        // 카드 기본 이름 생성
        generateDefaultCardName(folderId, cardNumber) {
            const folder = CardManager.folders.find(f => f.id === folderId);
            const folderName = folder ? folder.name : '폴더';
            return `${folderName} #${cardNumber}`;
        },

        // 폴더 내 카드 번호 계산
        getNextCardNumberInFolder(folderId) {
            const folderCards = CardManager.cards.filter(card => card.folderId === folderId);
            const numbers = folderCards.map(card => card.folderCardNumber || 0);
            return Math.max(0, ...numbers) + 1;
        },

        createCard() {
            const folderCardNumber = this.getNextCardNumberInFolder(CardManager.selectedFolderId);
            const defaultName = this.generateDefaultCardName(CardManager.selectedFolderId, folderCardNumber);

            const newCard = {
                id: `card-${Date.now()}`,
                number: ++CardManager.cardCounter, // 전역 카드 번호 (기존 호환성)
                folderCardNumber: folderCardNumber, // 폴더 내 카드 번호
                name: defaultName, // 카드 이름
                content: '',
                folderId: CardManager.selectedFolderId,
                isExpanded: CardManager.settings.defaultExpanded,
                createdAt: Date.now()
            };

            CardManager.cards.push(newCard);
            UI.renderFolders();
            UI.renderCards();
            DataManager.save();
            Utils.showNotification(`"${newCard.name}" 카드가 생성되었습니다.`);
        },

        // 카드 이름 업데이트
        updateCardName(cardId, newName) {
            const card = CardManager.cards.find(c => c.id === cardId);
            if (card && newName.trim()) {
                card.name = newName.trim();
                DataManager.save();
                UI.renderCards();
                Utils.showNotification(`카드 이름이 "${card.name}"로 변경되었습니다.`);
            }
        },

        moveCardToFolder(cardId, folderId) {
            const card = CardManager.cards.find(c => c.id === cardId);
            const folder = CardManager.folders.find(f => f.id === folderId);

            if (card && folder) {
                const oldFolderId = card.folderId;
                card.folderId = folderId;

                // 폴더가 변경되면 폴더 카드 번호 재할당
                if (oldFolderId !== folderId) {
                    card.folderCardNumber = this.getNextCardNumberInFolder(folderId);
                    // 기본 이름을 사용하는 카드라면 새 폴더 이름으로 업데이트
                    const oldFolder = CardManager.folders.find(f => f.id === oldFolderId);
                    const oldDefaultName = oldFolder ? `${oldFolder.name} #${card.folderCardNumber}` : card.name;
                    if (card.name === oldDefaultName || card.name.startsWith(oldFolder?.name || '')) {
                        card.name = this.generateDefaultCardName(folderId, card.folderCardNumber);
                    }
                }

                UI.renderFolders();
                UI.renderCards();
                DataManager.save();
                Utils.showNotification(`"${card.name}"이 "${folder.name}" 폴더로 이동되었습니다.`);
            }
        },

        updateCard(cardId, content) {
            const card = CardManager.cards.find(c => c.id === cardId);
            if (card) {
                card.content = content;
                card.lastModified = Date.now();
                DataManager.save();

                // 미리보기 업데이트
                setTimeout(() => UI.renderCards(), 100);
            }
        },

        // 카드 복사 (카드 자체를 복제)
        copyCard(cardId) {
            const card = CardManager.cards.find(c => c.id === cardId);
            if (card) {
                const folderCardNumber = this.getNextCardNumberInFolder(card.folderId);
                const defaultName = this.generateDefaultCardName(card.folderId, folderCardNumber);

                const newCard = {
                    id: `card-${Date.now()}`,
                    number: ++CardManager.cardCounter,
                    folderCardNumber: folderCardNumber,
                    name: `${card.name} (복사)` || defaultName,
                    content: card.content,
                    folderId: card.folderId,
                    isExpanded: CardManager.settings.defaultExpanded,
                    createdAt: Date.now()
                };

                CardManager.cards.push(newCard);
                UI.renderFolders();
                UI.renderCards();
                DataManager.save();
                Utils.showOfficeNotification('카드가 복사되었습니다.');
            }
        },

        // 텍스트 복사 (카드 내용을 클립보드에 복사)
        copyCardText(cardId) {
            const card = CardManager.cards.find(c => c.id === cardId);
            if (card && card.content) {
                const cardName = card.name || `카드 #${card.number}`;
                Utils.copyTextWithKeywords(card.content, false, cardName, card.folderId).then((success) => {
                    if (success) {
                        Utils.showOfficeNotification('텍스트가 복사되었습니다.');
                    }
                });
            } else {
                Utils.showOfficeNotification('복사할 텍스트가 없습니다.');
            }
        },


        deleteCard(cardId) {
            const card = CardManager.cards.find(c => c.id === cardId);
            if (card && confirm(`"${card.name || `카드 #${card.number}`}"를 삭제하시겠습니까?`)) {
                CardManager.cards = CardManager.cards.filter(c => c.id !== cardId);
                UI.renderFolders();
                UI.renderCards();
                DataManager.save();
                Utils.showNotification(`"${card.name || `카드 #${card.number}`}"가 삭제되었습니다.`);
            }
        }
    };

    // ==================== 새로운 키워드 관리 시스템 ====================
    const NewKeywordManager = {
        // 폴더의 키워드 번호를 순차적으로 재정렬
        reorderFolderKeywords(folderId) {
            const folderKeywords = Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === folderId)
                .sort((a, b) => (a.number || 0) - (b.number || 0));

            // 순차적으로 1, 2, 3... 번호 재할당
            folderKeywords.forEach((keyword, index) => {
                keyword.number = index + 1;
            });

            DataManager.save();
        },

        // 모든 폴더의 키워드 번호를 재정렬 (초기화용)
        reorderAllKeywords() {
            const folderIds = [...new Set(Object.values(CardManager.keywordDatabase).map(kw => kw.folderId))];

            folderIds.forEach(folderId => {
                this.reorderFolderKeywords(folderId);
            });

            console.log(`✅ ${folderIds.length}개 폴더의 키워드 번호가 재정렬되었습니다.`);
            Utils.showNotification('모든 키워드 번호가 순차적으로 재정렬되었습니다.');
        },

        // 키워드 생성
        createKeyword(name, type, folderId) {
            const id = PerformanceUtils.generateId();

            // 해당 폴더의 키워드 개수 확인하여 다음 번호 할당
            const folderKeywords = Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === folderId);
            const nextNumber = folderKeywords.length + 1;

            CardManager.keywordDatabase[id] = {
                id,
                name: name.trim(),
                type: type, // 'normal' | 'important'
                folderId,
                number: nextNumber, // 순차적 번호 할당
                state: {
                    visible: true,
                    completed: false
                },
                createdAt: Date.now()
            };

            DataManager.save();
            return id;
        },

        // 키워드 수정
        updateKeyword(keywordId, updates) {
            if (CardManager.keywordDatabase[keywordId]) {
                CardManager.keywordDatabase[keywordId] = {
                    ...CardManager.keywordDatabase[keywordId],
                    ...updates,
                    updatedAt: Date.now()
                };
                DataManager.save();
                return true;
            }
            return false;
        },

        // 키워드 삭제
        deleteKeyword(keywordId) {
            if (CardManager.keywordDatabase[keywordId]) {
                const keyword = CardManager.keywordDatabase[keywordId];
                const folderId = keyword.folderId;

                // 모든 카드에서 이 키워드 제거
                Object.keys(CardManager.cardKeywords).forEach(cardId => {
                    CardManager.cardKeywords[cardId] = CardManager.cardKeywords[cardId]?.filter(id => id !== keywordId) || [];
                });

                // 키워드 데이터 삭제
                delete CardManager.keywordDatabase[keywordId];

                // 폴더의 키워드 번호 재정렬
                this.reorderFolderKeywords(folderId);

                return true;
            }
            return false;
        },

        // 카드에 키워드 추가
        addKeywordToCard(cardId, keywordId) {
            if (!CardManager.cardKeywords[cardId]) {
                CardManager.cardKeywords[cardId] = [];
            }

            if (!CardManager.cardKeywords[cardId].includes(keywordId)) {
                CardManager.cardKeywords[cardId].push(keywordId);
                DataManager.save();
                return true;
            }
            return false;
        },

        // 카드에서 키워드 제거
        removeKeywordFromCard(cardId, keywordId) {
            if (CardManager.cardKeywords[cardId]) {
                CardManager.cardKeywords[cardId] = CardManager.cardKeywords[cardId].filter(id => id !== keywordId);
                DataManager.save();
                return true;
            }
            return false;
        },

        // 카드의 키워드 목록 가져오기 (콘텐츠에서 직접 추출)
        getCardKeywords(cardId) {
            const card = CardManager.cards.find(c => c.id === cardId);
            if (!card || !card.content) {
                console.log(`⚠️ 카드 ${cardId}를 찾을 수 없거나 내용이 없습니다.`);
                return [];
            }

            // 카드 콘텐츠에서 키워드 추출
            const keywords = [];
            const convertedText = Utils.convertKeywords(card.content, card.folderId);

            // 중요 키워드 추출
            const importantMatches = convertedText.match(/『([^』]+)』/g);
            if (importantMatches) {
                importantMatches.forEach(match => {
                    const keyword = match.replace(/[『』]/g, '');
                    const keywordObj = this.getKeywordByName(card.folderId, keyword);
                    if (keywordObj) {
                        keywords.push(keywordObj);
                    }
                });
            }

            // 일반 키워드 추출
            const normalMatches = convertedText.match(/「([^」]+)」/g);
            if (normalMatches) {
                normalMatches.forEach(match => {
                    const keyword = match.replace(/[「」]/g, '');
                    const keywordObj = this.getKeywordByName(card.folderId, keyword);
                    if (keywordObj) {
                        keywords.push(keywordObj);
                    }
                });
            }

            console.log(`🔍 카드 ${cardId}에서 ${keywords.length}개 키워드 발견:`, keywords.map(k => k.name));
            return keywords;
        },

        // 폴더의 모든 키워드 가져오기
        getFolderKeywords(folderId) {
            return Object.values(CardManager.keywordDatabase).filter(keyword => keyword.folderId === folderId);
        },

        // 키워드 이름으로 키워드 객체 찾기
        getKeywordByName(folderId, keywordName) {
            return Object.values(CardManager.keywordDatabase).find(
                keyword => keyword.folderId === folderId && keyword.name === keywordName
            );
        },

        // 키워드 상태 관리
        setKeywordState(keywordId, state) {
            if (!CardManager.keywordDatabase[keywordId]) return;
            if (!CardManager.keywordDatabase[keywordId].state) {
                CardManager.keywordDatabase[keywordId].state = { visible: true, completed: false };
            }
            CardManager.keywordDatabase[keywordId].state = { ...CardManager.keywordDatabase[keywordId].state, ...state };
            DataManager.save();
        },

        getKeywordState(keywordId) {
            return CardManager.keywordDatabase[keywordId]?.state || { visible: true, completed: false };
        },

        // 키워드 표시/숨김 토글
        toggleKeywordVisibility(keywordId) {
            const state = this.getKeywordState(keywordId);
            this.setKeywordState(keywordId, { visible: !state.visible });
            return !state.visible;
        },

        // 폴더의 모든 키워드 표시
        showAllKeywordsInFolder(folderId) {
            const folderKeywords = Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === folderId);
            folderKeywords.forEach(kw => {
                this.setKeywordState(kw.id, { visible: true });
            });
            DataManager.save();
            console.log(`👁️ 폴더 ${folderId}의 모든 키워드 표시`);
        },

        // 폴더의 모든 키워드 숨김
        hideAllKeywordsInFolder(folderId) {
            const folderKeywords = Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === folderId);
            folderKeywords.forEach(kw => {
                this.setKeywordState(kw.id, { visible: false });
            });
            DataManager.save();
            console.log(`🙈 폴더 ${folderId}의 모든 키워드 숨김`);
        },

        // 키워드 상태 설정 (ID 기반)
        setKeywordState(keywordId, state) {
            if (CardManager.keywordDatabase[keywordId]) {
                CardManager.keywordDatabase[keywordId].state = { ...CardManager.keywordDatabase[keywordId].state, ...state };
                DataManager.save();
            }
        },

        // 키워드 완료 상태 토글
        toggleKeywordCompletion(keywordId) {
            const state = this.getKeywordState(keywordId);
            const newCompleted = !state.completed;

            // 완료된 키워드는 자동으로 표시 상태로
            this.setKeywordState(keywordId, {
                completed: newCompleted,
                visible: newCompleted ? true : state.visible
            });
            return newCompleted;
        },

        // 카드 내용에서 [숫자] 패턴을 키워드로 변환
        renderCardContent(cardId, content) {
            if (!content) return content;

            // 카드의 폴더 ID 가져오기
            const card = CardManager.cards.find(c => c.id === cardId);
            const folderId = card ? card.folderId : CardManager.selectedFolderId;

            // 키워드 콘텐츠 파싱
            return Utils.parseKeywords(content, folderId);
        },

        // ==================== 키워드 상태 관리 기능 ====================

        // 키워드 상태 가져오기
        getKeywordState(folderId, keyword) {
            const keywordObj = Object.values(CardManager.keywordDatabase).find(kw => kw.folderId === folderId && kw.name === keyword);
            return keywordObj?.state || { visible: true, completed: false };
        },

        // 키워드 상태 설정
        setKeywordState(folderId, keyword, state) {
            const keywordObj = Object.values(CardManager.keywordDatabase).find(kw => kw.folderId === folderId && kw.name === keyword);
            if (keywordObj) {
                keywordObj.state = { ...keywordObj.state, ...state };
                DataManager.save();
            }
        },

        // 키워드 표시 여부 확인
        isKeywordVisible(folderId, keyword) {
            return this.getKeywordState(folderId, keyword).visible;
        },

        // 키워드 숨김 여부 확인 (호환성)
        isKeywordHidden(folderId, keyword) {
            return !this.isKeywordVisible(folderId, keyword);
        },

        // 키워드 완료 여부 확인
        isKeywordCompleted(folderId, keyword) {
            return this.getKeywordState(folderId, keyword).completed;
        },

        // 키워드 표시/숨김 토글
        toggleKeywordVisibility(folderId, keyword) {
            const currentState = this.getKeywordState(folderId, keyword);
            const newVisible = !currentState.visible;
            this.setKeywordState(folderId, keyword, { visible: newVisible });
            return newVisible;
        },

        // 키워드 상태 토글 (호환성 - 반환값 반전)
        toggleKeyword(folderId, keyword) {
            // 키워드가 등록되지 않은 경우 자동 등록하지 않음
            if (!KeywordManager.isKeywordRegistered(folderId, keyword)) {
                console.log(`⚠️ 등록되지 않은 키워드 토글 시도 무시: [${folderId}] "${keyword}"`);
                return false;
            }
            
            return !this.toggleKeywordVisibility(folderId, keyword);
        },

        // 키워드 완료 상태 토글
        toggleKeywordCompletion(folderId, keyword) {
            const currentState = this.getKeywordState(folderId, keyword);
            const newCompleted = !currentState.completed;
            this.setKeywordState(folderId, keyword, { completed: newCompleted });
            return newCompleted;
        },

        // 키워드 숨김 상태 설정 (호환성)
        setKeywordHidden(folderId, keyword, isHidden) {
            this.setKeywordState(folderId, keyword, { visible: !isHidden });
            console.log(`🔄 키워드 상태 변경: [${folderId}] "${keyword}" -> ${isHidden ? '숨김' : '표시'}`);
        },

        // 키워드 표시
        showKeyword(folderId, keyword) {
            this.setKeywordHidden(folderId, keyword, false);
        },

        // 키워드 숨김
        hideKeyword(folderId, keyword) {
            this.setKeywordHidden(folderId, keyword, true);
        },

        // 카드의 모든 키워드 표시
        showAllKeywordsInCard(cardId) {
            const keywords = this.getCardKeywords(cardId);
            const card = CardManager.cards.find(c => c.id === cardId);
            if (!card || !keywords || keywords.length === 0) {
                console.log(`⚠️ 카드 ${cardId}에 키워드가 없습니다.`);
                return;
            }

            keywords.forEach(keywordObj => {
                if (keywordObj && keywordObj.id) {
                    this.setKeywordState(keywordObj.id, { visible: true });
                }
            });
            console.log(`👁️ 카드 ${cardId}의 모든 키워드 표시 (${keywords.length}개)`);
            DataManager.save();
        },

        // 카드의 모든 키워드 숨김
        hideAllKeywordsInCard(cardId) {
            const keywords = this.getCardKeywords(cardId);
            const card = CardManager.cards.find(c => c.id === cardId);
            if (!card || !keywords || keywords.length === 0) {
                console.log(`⚠️ 카드 ${cardId}에 키워드가 없습니다.`);
                return;
            }

            keywords.forEach(keywordObj => {
                if (keywordObj && keywordObj.id) {
                    this.setKeywordState(keywordObj.id, { visible: false });
                }
            });
            console.log(`🙈 카드 ${cardId}의 모든 키워드 숨김 (${keywords.length}개)`);
            DataManager.save();
        },

        // 카드의 키워드 상태 초기화
        resetCardKeywordStates(cardId) {
            const keywords = this.getCardKeywords(cardId);
            const card = CardManager.cards.find(c => c.id === cardId);
            if (!card || !keywords) return;

            keywords.forEach(keywordObj => {
                this.setKeywordState(keywordObj.id, { visible: true, completed: false });
            });
            console.log(`🔄 카드 ${cardId}의 키워드 상태 초기화`);
            DataManager.save();
        },

        // 폴더의 모든 키워드를 진행 중으로 설정
        markAllInProgress(folderId) {
            Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === folderId)
                .forEach(kw => {
                    kw.state = { ...kw.state, completed: false };
                });
            DataManager.save();
            console.log(`⏳ 폴더 ${folderId}의 모든 키워드를 진행 중으로 설정`);
        },

        // 폴더의 모든 키워드를 완료로 설정
        markAllCompleted(folderId) {
            Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === folderId)
                .forEach(kw => {
                    kw.state = { ...kw.state, completed: true };
                });
            DataManager.save();
            console.log(`✅ 폴더 ${folderId}의 모든 키워드를 완료로 설정`);
        },

        // 폴더 상태 삭제
        deleteFolderStates(folderId) {
            Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === folderId)
                .forEach(kw => {
                    kw.state = { visible: true, completed: false };
                });
            DataManager.save();
            console.log(`🗑️ 폴더 ${folderId}의 모든 키워드 상태 초기화`);
        }
    };



    // ==================== 키워드 관리 ====================
    const KeywordManager = {
        // 키워드 번호 가져오기 (자동 생성 없이)
        getKeywordNumber(folderId, keyword) {
            // 새 키워드 시스템에서 먼저 찾기
            const dbKeyword = Object.values(CardManager.keywordDatabase).find(kw =>
                kw.folderId === folderId && kw.name === keyword
            );

            if (dbKeyword) {
                return dbKeyword.number;
            }


            // 번호가 없으면 null 반환 (자동 생성하지 않음)
            return null;
        },

        // 키워드가 등록되어 있는지 확인
        isKeywordRegistered(folderId, keyword) {
            // 새 시스템에서 확인
            const dbKeyword = Object.values(CardManager.keywordDatabase).find(kw =>
                kw.folderId === folderId && kw.name === keyword
            );
            return !!dbKeyword;
        },

        // 키워드 자동 등록 (기능 비활성화됨)
        autoRegisterKeyword(folderId, keyword, type = 'normal') {
            // 🚫 자동 등록 기능 비활성화
            // 카드 패널에서는 키워드를 등록할 수 없음
            // 키워드 패널에서만 키워드 등록 가능
            console.log(`🚫 자동 키워드 등록 차단: "${keyword}" (키워드 패널에서만 등록 가능)`);
            return null; // 등록하지 않음
        },

        getKeywordByNumber(folderId, number) {
            // 새 시스템에서 찾기
            const keyword = Object.values(CardManager.keywordDatabase).find(kw =>
                kw.folderId === folderId && kw.number === number
            );

            return keyword || null;
        },

        getFolderKeywords(folderId) {
            // 새 시스템의 키워드들
            const dbKeywords = Object.values(CardManager.keywordDatabase)
                .filter(kw => kw.folderId === folderId)
                .map(kw => ({ keyword: kw.name, number: kw.number, type: kw.type }));

            // 번호순 정렬
            return dbKeywords.sort((a, b) => a.number - b.number);
        },

        getCardKeywords(cardId) {
            const card = CardManager.cards.find(c => c.id === cardId);
            if (!card || !card.content) {
                return [];
            }

            const folderId = card.folderId;
            const convertedText = Utils.convertKeywords(card.content, folderId);
            const cardKeywords = [];

            // 중요 키워드 추출
            const importantMatches = convertedText.match(/『([^』]+)』/g);
            if (importantMatches) {
                importantMatches.forEach(match => {
                    const keyword = match.replace(/[『』]/g, '');
                    const number = this.getKeywordNumber(folderId, keyword);
                    if (number !== null) {
                        cardKeywords.push({ keyword, number, type: 'important' });
                    }
                });
            }

            // 일반 키워드 추출
            const normalMatches = convertedText.match(/「([^」]+)」/g);
            if (normalMatches) {
                normalMatches.forEach(match => {
                    const keyword = match.replace(/[「」]/g, '');
                    const number = this.getKeywordNumber(folderId, keyword);
                    if (number !== null) {
                        cardKeywords.push({ keyword, number, type: 'normal' });
                    }
                });
            }

            // 중복 제거 및 정렬
            const uniqueKeywords = Array.from(new Map(
                cardKeywords.map(item => [`${item.keyword}_${item.type}`, item])
            ).values());

            return uniqueKeywords.sort((a, b) => a.number - b.number);
        },

        updateKeywordNumber(folderId, keyword, newNumber) {
            // 새 시스템에서 키워드 찾기
            const dbKeyword = Object.values(CardManager.keywordDatabase).find(kw =>
                kw.folderId === folderId && kw.name === keyword
            );

            if (dbKeyword) {
                const oldNumber = dbKeyword.number;

                // 새 번호가 이미 사용 중인지 확인
                const existingKeyword = Object.values(CardManager.keywordDatabase).find(kw =>
                    kw.folderId === folderId && kw.number === newNumber && kw.id !== dbKeyword.id
                );

                if (existingKeyword) {
                    // 번호 교환
                    existingKeyword.number = oldNumber;
                }

                dbKeyword.number = newNumber;
                DataManager.save();
                return true;
            }

            return false;
        },

        // 키워드 삭제
        deleteKeyword(folderId, keyword) {
            const keywordToDelete = Object.values(CardManager.keywordDatabase).find(kw => kw.folderId === folderId && kw.name === keyword);
            if (keywordToDelete) {
                delete CardManager.keywordDatabase[keywordToDelete.id];
                DataManager.save();
                return true;
            }
            return false;
        },

        // 폴더 삭제 시 키워드 매핑도 삭제
        deleteFolderMappings(folderId) {
            Object.values(CardManager.keywordDatabase).filter(kw => kw.folderId === folderId).forEach(kw => {
                delete CardManager.keywordDatabase[kw.id];
            });
            DataManager.save();
        }
    };

    // ==================== 폴더 관리 ====================
    const FolderManager = {
        selectFolder(folderId) {
            CardManager.selectedFolderId = folderId;
            UI.renderFolders();
            UI.renderCards();

            // TODO 키워드 패널이 열려있다면 새로고침
            if (CardManager.todoKeyword.isVisible) {
                UI.refreshTodoKeywordPanel();
            }

            DataManager.save();
        },

        createFolder() {
            const name = prompt('새 폴더 이름을 입력하세요:');
            if (name && name.trim()) {
                const colors = ['#D8C3E3', '#C8B5D1', '#F4CCCD', '#F8D7C7', '#B5D6F0', '#B8E6E6', '#C9E4C9', '#E6F0C7', '#F4E4B8', '#F0D4C7'];
                const newFolder = {
                    id: `folder-${Date.now()}`,
                    name: name.trim(),
                    color: colors[Math.floor(Math.random() * colors.length)],
                    isDefault: false
                };

                CardManager.folders.push(newFolder);
                UI.renderFolders();

                // TODO 키워드 패널이 열려있다면 새로고침
                if (CardManager.todoKeyword.isVisible) {
                    UI.refreshTodoKeywordPanel();
                }

                DataManager.save();
                Utils.showNotification(`폴더 "${name}"가 생성되었습니다.`);
            }
        },

        showFolderMenu(folderId, event) {
            event.preventDefault();
            event.stopPropagation();

            const folder = CardManager.folders.find(f => f.id === folderId);
            if (!folder) return;

            const menu = document.createElement('div');
            menu.style.cssText = `
                position: fixed;
                background: white;
                border: 1px solid #ccc;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                padding: 8px 0;
                z-index: 1000000;
                left: ${event.pageX}px;
                top: ${event.pageY}px;
                font-family: Arial, sans-serif;
                min-width: 120px;
            `;

            // 기본 폴더인 경우 삭제 기능만 제외
            if (folder.isDefault) {
                menu.innerHTML = `
                    <div onclick="DataManager.exportFolder('${folderId}')" style="padding: 8px 16px; cursor: pointer; transition: background 0.2s ease;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='transparent'">📤 내보내기</div>
                `;
            } else {
                menu.innerHTML = `
                    <div onclick="FolderManager.renameFolder('${folderId}')" style="padding: 8px 16px; cursor: pointer; transition: background 0.2s ease;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='transparent'">✏️ 이름 변경</div>
                    <div onclick="DataManager.exportFolder('${folderId}')" style="padding: 8px 16px; cursor: pointer; transition: background 0.2s ease;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='transparent'">📤 내보내기</div>
                    <div onclick="FolderManager.deleteFolder('${folderId}')" style="padding: 8px 16px; cursor: pointer; color: #c5877f; transition: background 0.2s ease;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='transparent'">🗑️ 삭제</div>
                `;
            }

            menu.addEventListener('mouseleave', () => menu.remove());
            menu.addEventListener('click', () => menu.remove());

            document.body.appendChild(menu);

            // 화면 밖으로 나가지 않도록 조정
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                menu.style.left = (event.pageX - rect.width) + 'px';
            }
            if (rect.bottom > window.innerHeight) {
                menu.style.top = (event.pageY - rect.height) + 'px';
            }
        },

        renameFolder(folderId) {
            const folder = CardManager.folders.find(f => f.id === folderId);
            if (!folder) return;

            const newName = prompt('새 폴더 이름을 입력하세요:', folder.name);
            if (newName && newName.trim()) {
                folder.name = newName.trim();
                UI.renderFolders();
                DataManager.save();
                Utils.showNotification(`폴더 이름이 "${newName}"로 변경되었습니다.`);
            }
        },

        deleteFolder(folderId) {
            const folder = CardManager.folders.find(f => f.id === folderId);
            if (!folder || folder.isDefault) return;

            const cardsInFolder = CardManager.cards.filter(card => card.folderId === folderId);
            let confirmMessage = `폴더 "${folder.name}"를 삭제하시겠습니까?`;

            if (cardsInFolder.length > 0) {
                confirmMessage += `\n폴더 안의 ${cardsInFolder.length}개 카드는 기본 폴더로 이동됩니다.`;
            }

            if (confirm(confirmMessage)) {
                // 폴더 안의 카드들을 기본 폴더로 이동
                cardsInFolder.forEach(card => {
                    card.folderId = 'default';
                });

                // 폴더의 키워드 매핑 삭제
                KeywordManager.deleteFolderMappings(folderId);

                // 폴더의 키워드 상태 삭제
                NewKeywordManager.deleteFolderStates(folderId);

                // 폴더 삭제
                CardManager.folders = CardManager.folders.filter(f => f.id !== folderId);

                // 삭제된 폴더가 현재 선택된 폴더면 기본 폴더로 변경
                if (CardManager.selectedFolderId === folderId) {
                    CardManager.selectedFolderId = 'default';
                }

                UI.renderFolders();
                UI.renderCards();

                // TODO 키워드 패널이 열려있다면 새로고침
                if (CardManager.todoKeyword.isVisible) {
                    UI.refreshTodoKeywordPanel();
                }

                DataManager.save();
                Utils.showNotification(`폴더 "${folder.name}"가 삭제되었습니다.`);
            }
        }
    };

    // ==================== 키워드 편집기 ====================
    const KeywordEditor = {
        // 키워드 번호 업데이트
        updateNumber(folderId, keyword, newNumber) {
            const num = parseInt(newNumber);
            if (isNaN(num) || num < 1 || num > 999) {
                Utils.showNotification('번호는 1-999 사이의 숫자여야 합니다.', true);
                UI.refreshKeywordEditor();
                return;
            }

            if (KeywordManager.updateKeywordNumber(folderId, keyword, num)) {
                UI.renderCards();
                UI.refreshKeywordEditor();
                Utils.showNotification(`키워드 "${keyword}"의 번호가 ${num}으로 변경되었습니다.`);
            }
        },

        // 키워드 삭제
        deleteKeyword(folderId, keyword) {
            if (confirm(`키워드 "${keyword}"를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
                if (KeywordManager.deleteKeyword(folderId, keyword)) {
                    UI.renderCards();
                    UI.refreshKeywordEditor();
                    Utils.showNotification(`키워드 "${keyword}"가 삭제되었습니다.`);
                }
            }
        }
    };

    // ==================== CSS 스타일 주입 ====================
    function injectStyles() {
        const style = document.createElement('style');
        style.setAttribute('data-ccfolia-styles', 'true');
        style.textContent = `
            /* ==================== 🕵️ 탐정 테마 색상 시스템 ==================== */
            :root {
                /* 메인 색상 - 가독성 중심 */
                --detective-dark: #2C1810;          /* 진한 브라운 (헤더, 강조) */
                --detective-medium: #4A3426;        /* 중간 브라운 (버튼, 테두리) */
                --detective-accent: #8B6F47;        /* 황동색 (포인트) */
                --detective-light: #F5F0E8;         /* 따뜻한 베이지 (배경) */
                --detective-paper: #FFFBF5;         /* 따뜻한 아이보리 (카드 배경) */
                --detective-text: #2C1810;          /* 본문 텍스트 */
                --detective-text-light: #5C4A3A;    /* 보조 텍스트 */

                /* 키워드 색상 - 가독성 우선 */
                --keyword-normal-bg: #E8F0E3;       /* 연한 녹색 배경 */
                --keyword-normal-border: #7A8F70;   /* 진한 녹색 테두리 */
                --keyword-normal-text: #2B3A26;     /* 진한 녹색 텍스트 */
                --keyword-normal-underline: rgba(122, 143, 112, 0.5);

                --keyword-important-bg: #F5E6E6;    /* 연한 빨간 배경 */
                --keyword-important-border: #A85454; /* 진한 빨간 테두리 */
                --keyword-important-text: #6B2C2C;   /* 진한 빨간 텍스트 */

                /* 상태 색상 */
                --state-hidden: #6C757D;            /* 숨김 상태 */
                --state-completed: #5C7C5C;         /* 완료 상태 */
                --state-hover: rgba(139, 111, 71, 0.1); /* 호버 배경 */
            }

            /* ==================== 트리거 버튼 강력한 가시성 스타일 ==================== */
            .ccfolia-card-trigger {
                position: fixed !important;
                left: 0 !important;
                top: 50% !important;
                z-index: 2147483647 !important;
                width: 60px !important;
                height: 80px !important;
                display: flex !important;
                visibility: visible !important;
                opacity: 1 !important;
                pointer-events: auto !important;
                background: linear-gradient(135deg, #4A2C17, #5D3F1A) !important;
                color: white !important;
                border: none !important;
                border-radius: 0 12px 12px 0 !important;
                box-shadow: 0 4px 20px rgba(139, 111, 71, 0.3) !important;
                cursor: pointer !important;
                user-select: none !important;
                transition: all 0.3s ease !important;
                align-items: center !important;
                justify-content: center !important;
                text-align: center !important;
                font-size: 12px !important;
                font-weight: bold !important;
                font-family: 'Paperozi', Arial, sans-serif !important;
                margin: 0 !important;
                padding: 0 !important;
                transform: translateY(-50%) !important;
            }

            /* 코코포리아 사이트의 다른 요소에 의한 간섭 방지 */
            .ccfolia-card-trigger[data-ccfolia-button="true"] {
                all: unset !important;
                position: fixed !important;
                left: 0 !important;
                top: 50% !important;
                z-index: 2147483647 !important;
                width: 60px !important;
                height: 80px !important;
                background: linear-gradient(135deg, #4A2C17, #5D3F1A) !important;
                color: white !important;
                display: flex !important;
                visibility: visible !important;
                opacity: 1 !important;
                align-items: center !important;
                justify-content: center !important;
                text-align: center !important;
                font-size: 12px !important;
                font-weight: bold !important;
                font-family: 'Paperozi', Arial, sans-serif !important;
                cursor: pointer !important;
                border-radius: 0 12px 12px 0 !important;
                box-shadow: 0 4px 20px rgba(139, 111, 71, 0.3) !important;
                user-select: none !important;
                transition: all 0.3s ease !important;
                pointer-events: auto !important;
                transform: translateY(-50%) !important;
            }

            /* 호버 효과 */
            .ccfolia-card-trigger:hover {
                background: linear-gradient(135deg, #5D3F1A, #6D4F2A) !important;
                transform: translateY(-50%) translateX(8px) !important;
            }

            /* CCFolia 사이트의 CSS Reset 방지 */
            body .ccfolia-card-trigger {
                position: fixed !important;
                top: 50% !important;
                z-index: 2147483647 !important;
                display: flex !important;
                visibility: visible !important;
                opacity: 1 !important;
            }

            /* CCFolia에서 사용하는 일반적인 이름들에 대한 보호 */
            div.ccfolia-card-trigger,
            .widget.ccfolia-card-trigger,
            .component.ccfolia-card-trigger {
                position: fixed !important;
                left: 0 !important;
                top: 50% !important;
                z-index: 2147483647 !important;
                display: flex !important;
                visibility: visible !important;
                opacity: 1 !important;
            }

            /* 최상위 컨테이너에서도 보이도록 */
            html > body > .ccfolia-card-trigger {
                position: fixed !important;
                top: 50% !important;
                z-index: 2147483647 !important;
                display: flex !important;
                visibility: visible !important;
                opacity: 1 !important;
            }

            /* ==================== 키워드 스타일 (가독성 중심) ==================== */

            /* 일반 키워드 - 기존 스타일 유지, 색상만 변경 */
            .keyword-normal {
                background: var(--keyword-normal-bg);
                color: var(--keyword-normal-text);
                padding: 4px 8px;
                border-radius: 6px;
                font-weight: 600;
                font-size: 14px;
                border: 1.5px solid var(--keyword-normal-border);
                display: inline-block;
                margin: 2px 3px;
                cursor: pointer;
                transition: all 0.2s ease;
                line-height: 1.4;
                text-decoration: underline;
                text-decoration-color: var(--keyword-normal-underline);
            }

            .keyword-normal:hover {
                transform: translateY(-1px) scale(1.05);
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                background: var(--keyword-normal-border);
                color: white;
            }

            /* 중요 키워드 - 더 강한 강조 */
            .keyword-important {
                background: var(--keyword-important-bg);
                color: var(--keyword-important-text);
                padding: 5px 10px;
                border-radius: 8px;
                font-weight: 700;
                font-size: 15px;
                border: 2px solid var(--keyword-important-border);
                display: inline-block;
                margin: 2px 3px;
                cursor: pointer;
                transition: all 0.2s ease;
                line-height: 1.4;
                box-shadow: 0 2px 4px rgba(168, 84, 84, 0.15);
                text-decoration: underline;
                text-decoration-color: var(--keyword-important-border);
            }

            .keyword-important:hover {
                transform: translateY(-1px) scale(1.05);
                box-shadow: 0 4px 12px rgba(168, 84, 84, 0.25);
                background: var(--keyword-important-border);
                color: white;
            }

            /* 숨김 키워드 - 회색 처리 */
            .keyword-normal.hidden, .keyword-important.hidden {
                background: var(--state-hidden);
                color: white;
                border-color: var(--state-hidden);
                opacity: 0.8;
                font-style: italic;
            }

            .keyword-normal.hidden:hover, .keyword-important.hidden:hover {
                opacity: 1;
                transform: scale(1.05);
            }

            /* 새로운 키워드 시스템 스타일 */
            .keyword-hidden {
                background: var(--state-hidden);
                color: white;
                padding: 2px 6px;
                border-radius: 4px;
                font-weight: 600;
                font-size: 12px;
                display: inline-block;
                margin: 1px 2px;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .keyword-hidden.important {
                background: var(--keyword-important-border);
            }

            /* 완료된 키워드 - 탐정 테마에 맞는 완료 표시 */
            .keyword-normal.completed {
                background: linear-gradient(135deg, #E8F0E3, #D4E6D4);
                color: var(--state-completed);
                border-color: var(--state-completed);
                text-decoration: line-through;
                opacity: 0.8;
                position: relative;
            }

            .keyword-normal.completed::before {
                content: '✓ ';
                color: var(--state-completed);
                font-weight: bold;
            }

            .keyword-important.completed {
                background: linear-gradient(135deg, #E8F0E3, #D4E6D4);
                color: var(--state-completed);
                border-color: var(--state-completed);
                text-decoration: line-through;
                opacity: 0.8;
                box-shadow: 0 2px 4px rgba(92, 124, 92, 0.2);
                position: relative;
            }

            .keyword-important.completed::before {
                content: '✓ ';
                color: var(--state-completed);
                font-weight: bold;
            }

            /* ==================== 탐정 테마 버튼 스타일 ==================== */

            /* 기본 버튼 스타일 */
            .detective-btn {
                background: var(--detective-accent);
                color: white;
                border: 1px solid transparent;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                font-family: 'Paperozi', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                transition: all 0.2s ease;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }

            .detective-btn:hover {
                background: var(--detective-medium);
                transform: translateY(-1px);
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            }

            .detective-btn:active {
                transform: translateY(0);
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }

            /* 보조 버튼 */
            .detective-btn-secondary {
                background: transparent;
                color: var(--detective-medium);
                border: 1px solid var(--detective-medium);
            }

            .detective-btn-secondary:hover {
                background: var(--detective-medium);
                color: white;
            }

            /* 위험 버튼 */
            .detective-btn-danger {
                background: #C05050;
                color: white;
            }

            .detective-btn-danger:hover {
                background: #A04040;
            }

            /* 소형 버튼 */
            .detective-btn-sm {
                padding: 6px 12px;
                font-size: 12px;
            }

            /* 대형 버튼 */
            .detective-btn-lg {
                padding: 12px 24px;
                font-size: 14px;
            }

            /* 카드 그리드 - 간결한 레이아웃 */
            .cards-grid {
                display: grid;
                gap: 20px;
                padding: 10px 0;
                align-items: start;
                grid-auto-rows: minmax(280px, auto);
            }

            /* 카드 레이아웃 설정별 그리드 - 브라운 디자인 최적화 */
            .cards-grid.layout-1 {
                grid-template-columns: 1fr;
                max-width: 420px;
                margin: 0 auto;
                gap: 25px;
                padding: 20px 15px;
            }

            .cards-grid.layout-2 {
                grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
                max-width: none;
                gap: 24px;
            }

            .cards-grid.layout-3 {
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                max-width: none;
                gap: 20px;
            }

            /* 카드 아이템 높이 관리 */
            .card-item {
                display: flex;
                flex-direction: column;
                height: 100%;
            }

            /* 빈 공간 채우기 위한 데코레이션 (선택사항) */
            .cards-grid::after {
                content: '';
                grid-column: 1 / -1;
                height: 0;
            }

            /* Masonry 레이아웃 효과 (선택사항) */
            @supports (grid-template-rows: masonry) {
                .cards-grid {
                    grid-template-rows: masonry;
                }
            }

            /* 반응형 디자인 개선 */
            @media (max-width: 768px) {
                .ccfolia-card-panel {
                    width: 95vw !important;
                    height: 90vh !important;
                    border-radius: 12px !important;
                }

                .panel-header {
                    padding: 14px 16px !important;
                    flex-direction: column !important;
                    gap: 12px !important;
                }

                .panel-header h2 {
                    font-size: 1.2em !important;
                }

                .folder-sidebar {
                    width: 200px !important;
                    padding: 12px !important;
                }

                .main-content .controls {
                    flex-direction: column !important;
                    gap: 8px !important;
                }

                .cards-grid {
                    grid-template-columns: 1fr !important;
                    gap: 15px !important;
                    padding: 16px 0 !important;
                }

                .card-item {
                    height: auto !important;
                    min-height: 200px !important;
                }
            }

            @media (max-width: 480px) {
                .ccfolia-card-panel {
                    width: 98vw !important;
                    height: 95vh !important;
                    border-radius: 8px !important;
                }

                .folder-sidebar {
                    display: none !important;
                }

                .folder-side-tab-panel {
                    width: 28px !important;
                    height: 100% !important;
                    background:
                        radial-gradient(ellipse at 30% 20%, rgba(93, 63, 26, 0.7) 0%, transparent 50%),
                        radial-gradient(ellipse at 70% 80%, rgba(139, 111, 71, 0.5) 0%, transparent 50%),
                        linear-gradient(135deg, #3D2817 0%, #4A2F1A 25%, #5D3F1A 50%, #4A2F1A 75%, #3D2817 100%) !important;
                    border-right: 2px solid #8B6F47 !important;
                    border-left: 1px solid rgba(29, 19, 12, 0.7) !important;
                    box-shadow:
                        2px 0 16px rgba(29, 19, 12, 0.3),
                        inset 1px 0 0 rgba(139, 111, 71, 0.2),
                        inset -1px 0 0 rgba(29, 19, 12, 0.5) !important;
                }

                .folder-toggle-btn {
                    height: 50px !important;
                    border-radius: 0 8px 8px 0 !important;
                    background:
                        radial-gradient(ellipse at 40% 30%, rgba(93, 63, 26, 0.2) 0%, transparent 60%),
                        rgba(61, 40, 23, 0.15) !important;
                    box-shadow:
                        inset 1px 1px 2px rgba(139, 111, 71, 0.15),
                        inset -1px -1px 2px rgba(29, 19, 12, 0.25) !important;
                }

                .folder-icon {
                    font-size: 16px !important;
                }

                .folder-side-tab-panel:hover {
                    width: 32px !important;
                    background:
                        radial-gradient(ellipse at 30% 20%, rgba(139, 111, 71, 0.8) 0%, transparent 50%),
                        radial-gradient(ellipse at 70% 80%, rgba(160, 132, 90, 0.6) 0%, transparent 50%),
                        linear-gradient(135deg, #4A2F1A 0%, #5D3F1A 25%, #6D4C2F 50%, #5D3F1A 75%, #4A2F1A 100%) !important;
                    border-right: 3px solid #A0845A !important;
                    box-shadow:
                        3px 0 18px rgba(29, 19, 12, 0.4),
                        inset 2px 0 0 rgba(160, 132, 90, 0.3),
                        inset -1px 0 0 rgba(29, 19, 12, 0.6) !important;
                }

                .folder-toggle-btn:hover .folder-icon {
                    transform: scale(1.1) !important;
                    color: #F5F0E8 !important;
                    text-shadow: 0 1px 4px rgba(29, 19, 12, 0.7) !important;
                }
            }

            @media (min-width: 769px) and (max-width: 1200px) {
                .cards-grid {
                    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                    gap: 18px;
                }
            }

            @media (min-width: 1201px) {
                .cards-grid {
                    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
                    gap: 20px;
                }
            }

            /* 간결한 카드 애니메이션 */
            .card-item {
                transition: all 0.2s ease;
            }

            .card-item:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(44, 24, 16, 0.15);
            }

            /* 스크롤바 스타일링 */
            .folder-sidebar::-webkit-scrollbar,
            .main-content::-webkit-scrollbar {
                width: 6px;
            }

            .folder-sidebar::-webkit-scrollbar-track,
            .main-content::-webkit-scrollbar-track {
                background: rgba(139, 111, 71, 0.05);
                border-radius: 3px;
            }

            .folder-sidebar::-webkit-scrollbar-thumb,
            .main-content::-webkit-scrollbar-thumb {
                background: rgba(139, 111, 71, 0.2);
                border-radius: 3px;
            }

            .folder-sidebar::-webkit-scrollbar-thumb:hover,
            .main-content::-webkit-scrollbar-thumb:hover {
                background: rgba(139, 111, 71, 0.3);
            }

            @keyframes slideIn {
                from { transform: translateX(400px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }

            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(400px); opacity: 0; }
            }

            /* 폰트 정의 */
            @font-face {
                font-family: 'Paperozi';
                src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-1Thin.woff2') format('woff2');
                font-weight: 100;
                font-display: swap;
            }

            @font-face {
                font-family: 'Paperozi';
                src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-2ExtraLight.woff2') format('woff2');
                font-weight: 200;
                font-display: swap;
            }

            @font-face {
                font-family: 'Paperozi';
                src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-3Light.woff2') format('woff2');
                font-weight: 300;
                font-display: swap;
            }

            @font-face {
                font-family: 'Paperozi';
                src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-4Regular.woff2') format('woff2');
                font-weight: 400;
                font-display: swap;
            }

            @font-face {
                font-family: 'Paperozi';
                src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-5Medium.woff2') format('woff2');
                font-weight: 500;
                font-display: swap;
            }

            @font-face {
                font-family: 'Paperozi';
                src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-6SemiBold.woff2') format('woff2');
                font-weight: 600;
                font-display: swap;
            }

            @font-face {
                font-family: 'Paperozi';
                src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-7Bold.woff2') format('woff2');
                font-weight: 700;
                font-display: swap;
            }

            @font-face {
                font-family: 'Paperozi';
                src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-8ExtraBold.woff2') format('woff2');
                font-weight: 800;
                font-display: swap;
            }

            @font-face {
                font-family: 'Paperozi';
                src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-9Black.woff2') format('woff2');
                font-weight: 900;
                font-display: swap;
            }

            @font-face {
                font-family: 'Ownglyph_ParkDaHyun';
                src: url('https://fastly.jsdelivr.net/gh/projectnoonnu/2411-3@1.0/Ownglyph_ParkDaHyun.woff2') format('woff2');
                font-weight: normal;
                font-style: normal;
                font-display: swap;
            }

            @font-face {
                font-family: 'BookkMyungjo-Bd';
                src: url('https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_2302@1.0/BookkMyungjo-Bd.woff2') format('woff2');
                font-weight: 700;
                font-style: normal;
                font-display: swap;
            }

            @font-face {
                font-family: 'DungGeunMo';
                src: url('https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_six@1.2/DungGeunMo.woff') format('woff');
                font-weight: normal;
                font-style: normal;
                font-display: swap;
            }

            /* ==================== 오피스 스타일 알림 ==================== */
            .office-notification {
                font-family: 'Paperozi', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Roboto', 'Helvetica Neue', Arial, sans-serif !important;
                user-select: none;
                pointer-events: none;
            }

            .office-notification::before {
                content: '✓';
                display: inline-block;
                margin-right: 8px;
                color: #28a745;
                font-weight: bold;
                font-size: 16px;
            }

            /* 오피스 알림 애니메이션 */
            @keyframes officeSlideUp {
                0% {
                    opacity: 0;
                    transform: translateX(-50%) translateY(20px);
                }
                100% {
                    opacity: 1;
                    transform: translateX(-50%) translateY(-10px);
                }
            }

            @keyframes officeSlideDown {
                0% {
                    opacity: 1;
                    transform: translateX(-50%) translateY(-10px);
                }
                100% {
                    opacity: 0;
                    transform: translateX(-50%) translateY(20px);
                }
            }
        `;
        document.head.appendChild(style);

        // 추가 폰트 import 적용
        const fontImports = document.createElement('link');
        fontImports.rel = 'stylesheet';
        fontImports.crossOrigin = 'anonymous'; // CORS 정책에 따른 로딩 최적화
        fontImports.href = 'https://cdn.rawgit.com/moonspam/NanumSquare/master/nanumsquare.css';
        document.head.appendChild(fontImports);

        const nanumGothic = document.createElement('link');
        nanumGothic.rel = 'stylesheet';
        nanumGothic.crossOrigin = 'anonymous';
        nanumGothic.href = 'https://fonts.googleapis.com/earlyaccess/nanumgothic.css';
        document.head.appendChild(nanumGothic);
    }

    // ==================== 초기화 ====================
    function initialize() {
        console.log('🚀 카드 관리자 초기화 시작');

        try {
            // 1. 스타일 주입
            injectStyles();

            // 2. 데이터 로드
            DataManager.load();

            // 3. UI 생성 (더 안전하게)
            createButtonWithRetry();

            // 4. 전역 함수 노출
            window.UI = UI;
            console.log('✅ UI 객체가 window에 노출됨:', !!window.UI);
            console.log('✅ activateFocusMode 함수 확인:', typeof window.UI.activateFocusMode);
            window.CardActions = CardActions;
            window.CardManager = CardManager;
            window.DataManager = DataManager;
            window.FolderManager = FolderManager;
            window.KeywordManager = KeywordManager;
            window.KeywordEditor = KeywordEditor;



            console.log('✅ 카드 관리자 초기화 완료');
            Utils.showNotification('🃏 카드 관리자가 로드되었습니다!');

        } catch (error) {
            console.error('❌ 초기화 실패:', error);
            Utils.showNotification('초기화 실패: ' + error.message, true);
        }
    }

    // 버튼 생성 재시도 함수
    function createButtonWithRetry(retryCount = 0) {
        const maxRetries = 5;
        const retryDelay = 500; // 0.5초

        try {
            UI.createTriggerButton();
            
            // 버튼이 제대로 생성되었는지 확인
            setTimeout(() => {
                const button = document.querySelector('.ccfolia-card-trigger');
                if (!button && retryCount < maxRetries) {
                    console.warn(`⚠️ 버튼 생성 실패, 재시도 ${retryCount + 1}/${maxRetries}`);
                    setTimeout(() => createButtonWithRetry(retryCount + 1), retryDelay);
                } else if (!button) {
                    console.error('❌ 버튼 생성 최종 실패');
                    Utils.showNotification('버튼 생성에 실패했습니다. 페이지를 새로고침해주세요.', true);
                } else {
                    console.log('✅ 버튼 생성 성공!');
                    // 버튼 위치를 중앙으로 강제 설정
                    UI.setButtonToCenter();
                }
            }, 100);
        } catch (error) {
            console.error('❌ 버튼 생성 오류:', error);
            if (retryCount < maxRetries) {
                setTimeout(() => createButtonWithRetry(retryCount + 1), retryDelay);
            }
        }
    }

    // ==================== 실행 ====================
    // 즉시 실행
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // 추가 안전장치
    setTimeout(initialize, 1000);

    // 페이지 내비게이션 감지 및 버튼 재생성 (최적화됨)
    let lastUrl = location.href;
    let pageCheckTimer = null;
    let buttonCheckInterval = null;
    
    // 디바운스된 MutationObserver (과도한 호출 방지)
    const debouncedButtonCheck = (() => {
        let timeout;
        return () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                const button = document.querySelector('.ccfolia-card-trigger');
                if (!button) {
                    console.log('🔎 버튼이 없음, 재생성 시도');
                    createButtonWithRetry();
                } else {
                    // 버튼이 있어도 위치가 잘못되었을 수 있으므로 중앙으로 재설정
                    const currentTop = CardManager.settings.buttonPosition?.top || 50;
                    const buttonTop = button.style.top;
                    const expectedTop = `${currentTop}%`;
                    
                    if (buttonTop !== expectedTop) {
                        console.log('🔧 버튼 위치 재조정:', buttonTop, '->', expectedTop);
                        UI.updateButtonPosition();
                    }
                }
            }, 1000); // 1초 디바운스
        };
    })();
    
    const pageObserver = new MutationObserver(() => {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            console.log('🔄 페이지 변경 감지:', currentUrl);
            
            // 페이지 변경 시 500ms 후 버튼 체크
            clearTimeout(pageCheckTimer);
            pageCheckTimer = setTimeout(debouncedButtonCheck, 500);
        }
    });
    
    // Observer 시작 (더 제한된 범위로 감시)
    pageObserver.observe(document.head, { 
        childList: true, 
        subtree: false // head만 감시하여 성능 최적화
    });

    // 주기적 버튼 체크 (간격 증가: 10초 -> 30초)
    buttonCheckInterval = setInterval(() => {
        const button = document.querySelector('.ccfolia-card-trigger');
        if (!button) {
            console.log('⚠️ 주기적 체크: 버튼이 없음, 재생성');
            createButtonWithRetry();
        }
    }, 30000); // 30초마다 체크 (기존 10초에서 증가)

    // 메모리 누수 방지를 위한 정리 함수
    function cleanup() {
        console.log('🧽 리소스 정리 시작');
        
        // 타이머 정리
        if (window.cardManagerCleanupTimer) {
            clearTimeout(window.cardManagerCleanupTimer);
            window.cardManagerCleanupTimer = null;
        }
        if (window.cardNotificationTimer) {
            clearTimeout(window.cardNotificationTimer);
            window.cardNotificationTimer = null;
        }
        
        // 새로 추가된 타이머들 정리
        if (pageCheckTimer) {
            clearTimeout(pageCheckTimer);
            pageCheckTimer = null;
        }
        if (buttonCheckInterval) {
            clearInterval(buttonCheckInterval);
            buttonCheckInterval = null;
        }
        
        // Observer 정리
        if (pageObserver) {
            pageObserver.disconnect();
        }

        // 캐시 정리
        PerformanceUtils.invalidateCache();

        // 고급 드래그 시스템 정리
        AdvancedDragSystem.cleanup();

        // DOM 요소 정리
        document.querySelectorAll('.ccfolia-card-trigger, .ccfolia-card-panel, .ccfolia-focus-panel').forEach(el => {
            // 이벤트 리스너 제거
            if (el._dragHandlers) {
                delete el._dragHandlers;
            }
            if (el._resizeHandlers) {
                delete el._resizeHandlers;
            }
            
            if (el.parentNode) el.parentNode.removeChild(el);
        });
        
        console.log('✅ 리소스 정리 완료');
    }

    // 페이지 언로드 시 정리
    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('unload', cleanup);

    console.log('코코포리아 알고있었어 카드 로드 성공');

})();