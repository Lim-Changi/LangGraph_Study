class ChatBot {
    constructor() {
        this.currentMode = 'chat';
        this.apiBaseUrl = window.location.origin;
        this.isTyping = false;
        
        this.initializeElements();
        this.bindEvents();
        this.loadDocuments();
        this.setCurrentTime();
    }

    initializeElements() {
        // Mode elements
        this.modeButtons = document.querySelectorAll('.mode-btn');
        this.chatModeIndicator = document.getElementById('chatModeIndicator');
        
        // Chat elements
        this.chatMessages = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.clearChatBtn = document.getElementById('clearChatBtn');
        this.charCounter = document.getElementById('charCounter');
        this.typingIndicator = document.getElementById('typingIndicator');
        
        // Upload elements
        this.uploadArea = document.getElementById('uploadArea');
        this.fileInput = document.getElementById('fileInput');
        this.uploadStatus = document.getElementById('uploadStatus');
        
        // Documents elements
        this.documentsList = document.getElementById('documentsList');
        this.refreshDocsBtn = document.getElementById('refreshDocsBtn');
    }

    bindEvents() {
        // Mode selection
        this.modeButtons.forEach(btn => {
            btn.addEventListener('click', () => this.changeMode(btn.dataset.mode));
        });

        // Chat input
        this.messageInput.addEventListener('input', () => this.handleInputChange());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        this.sendButton.addEventListener('click', () => this.sendMessage());
        this.clearChatBtn.addEventListener('click', () => this.clearChat());

        // File upload
        this.uploadArea.addEventListener('click', () => this.fileInput.click());
        this.uploadArea.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.uploadArea.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.uploadArea.addEventListener('drop', (e) => this.handleDrop(e));
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Documents
        this.refreshDocsBtn.addEventListener('click', () => this.loadDocuments());
    }

    changeMode(mode) {
        this.currentMode = mode;
        
        // Update active button
        this.modeButtons.forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-mode="${mode}"]`).classList.add('active');
        
        // Update mode indicator
        const modeNames = {
            'chat': '💬 기본 채팅 모드',
            'rag-chat': '🧠 RAG 채팅 모드',
            'workflow': '⚙️ 워크플로우 모드',
            'csv-query': '📊 CSV 질의 모드'
        };
        
        this.chatModeIndicator.textContent = modeNames[mode];
        
        // Add mode-specific message
        const modeMessages = {
            'chat': '기본 채팅 모드로 전환되었습니다.',
            'rag-chat': 'RAG 채팅 모드로 전환되었습니다. 업로드된 문서를 참조하여 답변합니다.',
            'workflow': '워크플로우 모드로 전환되었습니다. 3단계 분석을 통해 답변합니다.',
            'csv-query': 'CSV 질의 모드로 전환되었습니다. CSV 데이터를 분석하여 답변합니다.'
        };
        
        this.addBotMessage(modeMessages[mode]);
        
        // RAG 채팅 모드일 때 문서 상태 확인
        if (mode === 'rag-chat') {
            this.checkDocumentStatus();
        }
    }

    async checkDocumentStatus() {
        try {
            const response = await fetch(this.apiBaseUrl + '/rag/documents');
            const result = await response.json();

            if (response.ok && result.documents && result.documents.length > 0) {
                this.addBotMessage(`📚 현재 ${result.documents.length}개의 문서가 업로드되어 있습니다. 이 문서들을 참조하여 답변드리겠습니다.`);
            } else {
                this.addBotMessage(`📝 아직 업로드된 문서가 없습니다. RAG 채팅을 효과적으로 사용하려면 문서를 업로드해주세요. (PDF, TXT, CSV 파일 지원)`);
            }
        } catch (error) {
            console.error('문서 상태 확인 실패:', error);
        }
    }

    handleInputChange() {
        const length = this.messageInput.value.length;
        this.charCounter.textContent = `${length}/500`;
        this.sendButton.disabled = length === 0 || this.isTyping;
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || this.isTyping) return;

        // Add user message to chat
        this.addUserMessage(message);
        this.messageInput.value = '';
        this.handleInputChange();
        
        // Show typing indicator
        this.showTyping();

        try {
            const response = await this.callAPI(message);
            this.hideTyping();
            
            // RAG 채팅 모드에서 참조된 문서 정보 표시
            if (this.currentMode === 'rag-chat' && response.referencedDocuments) {
                this.addRAGResponse(response.response, response.referencedDocuments);
            } else {
                this.addBotMessage(response.response || response.answer || response.final || 'Sorry, I could not process your request.');
            }
            
            // Show workflow steps if available
            if (response.workflow) {
                this.addWorkflowResponse(response.workflow);
            }
        } catch (error) {
            this.hideTyping();
            this.addBotMessage('죄송합니다. 오류가 발생했습니다: ' + error.message);
        }
    }

    async callAPI(message) {
        const endpoints = {
            'chat': '/langgraph/chat',
            'rag-chat': '/langgraph/rag-chat',
            'workflow': '/langgraph/workflow',
            'csv-query': '/rag/csv-query'
        };

        const response = await fetch(this.apiBaseUrl + endpoints[this.currentMode], {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                question: message
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }

    addUserMessage(message) {
        const messageDiv = this.createMessage(message, 'user');
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addBotMessage(message) {
        const messageDiv = this.createMessage(message, 'bot');
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addRAGResponse(response, referencedDocuments) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message bot-message';
        
        let documentsHtml = '';
        if (referencedDocuments && referencedDocuments.length > 0) {
            documentsHtml = `
                <div style="margin-top: 15px; padding: 10px; background: rgba(76, 175, 80, 0.1); border-radius: 8px; border-left: 4px solid #4CAF50;">
                    <div style="font-weight: 500; margin-bottom: 8px; color: #2E7D32;">📚 참조된 문서:</div>
                    ${referencedDocuments.map((doc, index) => `
                        <div style="margin-bottom: 8px; font-size: 0.9em;">
                            <div style="font-weight: 500; color: #1976D2;">📄 ${doc.source}</div>
                            <div style="color: #666; font-size: 0.85em; margin-top: 2px;">${doc.content}</div>
                            <div style="color: #999; font-size: 0.8em; margin-top: 2px;">관련성: ${Math.round(doc.relevance * 100)}%</div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            documentsHtml = `
                <div style="margin-top: 15px; padding: 10px; background: rgba(255, 152, 0, 0.1); border-radius: 8px; border-left: 4px solid #FF9800;">
                    <div style="font-weight: 500; color: #E65100;">⚠️ 관련 문서를 찾을 수 없어 일반적인 지식으로 답변했습니다.</div>
                </div>
            `;
        }
        
        messageDiv.innerHTML = `
            <div class="message-avatar">🤖</div>
            <div class="message-content">
                <p>${this.formatMessage(response)}</p>
                ${documentsHtml}
                <span class="message-time">${this.getCurrentTime()}</span>
            </div>
        `;
        
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addWorkflowResponse(workflow) {
        const workflowDiv = document.createElement('div');
        workflowDiv.className = 'message bot-message';
        workflowDiv.innerHTML = `
            <div class="message-avatar">⚙️</div>
            <div class="message-content">
                <div style="margin-bottom: 10px;"><strong>🔍 1단계 분석:</strong></div>
                <p style="margin-bottom: 15px; padding: 10px; background: rgba(102, 126, 234, 0.1); border-radius: 8px;">${workflow.step1}</p>
                
                <div style="margin-bottom: 10px;"><strong>📊 2단계 정리:</strong></div>
                <p style="margin-bottom: 15px; padding: 10px; background: rgba(102, 126, 234, 0.1); border-radius: 8px;">${workflow.step2}</p>
                
                <div style="margin-bottom: 10px;"><strong>✅ 최종 답변:</strong></div>
                <p style="padding: 10px; background: rgba(102, 126, 234, 0.2); border-radius: 8px; font-weight: 500;">${workflow.final}</p>
                
                <span class="message-time">${this.getCurrentTime()}</span>
            </div>
        `;
        this.chatMessages.appendChild(workflowDiv);
        this.scrollToBottom();
    }

    createMessage(content, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        const avatar = type === 'user' ? '👤' : '🤖';
        messageDiv.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-content">
                <p>${this.formatMessage(content)}</p>
                <span class="message-time">${this.getCurrentTime()}</span>
            </div>
        `;
        
        return messageDiv;
    }

    formatMessage(content) {
        // Basic formatting for URLs and line breaks
        return content
            .replace(/\n/g, '<br>')
            .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    }

    showTyping() {
        this.isTyping = true;
        this.typingIndicator.style.display = 'flex';
        this.sendButton.disabled = true;
    }

    hideTyping() {
        this.isTyping = false;
        this.typingIndicator.style.display = 'none';
        this.handleInputChange();
    }

    clearChat() {
        // Keep only the welcome message
        const welcomeMessage = this.chatMessages.querySelector('.message');
        this.chatMessages.innerHTML = '';
        this.chatMessages.appendChild(welcomeMessage);
    }

    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    getCurrentTime() {
        return new Date().toLocaleTimeString('ko-KR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }

    setCurrentTime() {
        const timeElement = document.querySelector('.message-time');
        if (timeElement) {
            timeElement.textContent = this.getCurrentTime();
        }
    }

    // File Upload Methods
    handleDragOver(e) {
        e.preventDefault();
        this.uploadArea.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        this.uploadArea.classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        this.uploadArea.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            console.log('📁 드롭된 파일:', file.name);
            
            // 파일명이 깨진 경우 즉시 수정
            if (this.isBrokenFileName(file.name)) {
                console.log('⚠️ 깨진 파일명 감지, 수정 시도...');
                const fixedFile = this.createFixedFile(file);
                this.uploadFile(fixedFile);
            } else {
                this.uploadFile(file);
            }
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            console.log('📁 파일 선택됨:', file.name);
            
            // 파일명이 깨진 경우 즉시 수정
            if (this.isBrokenFileName(file.name)) {
                console.log('⚠️ 깨진 파일명 감지, 수정 시도...');
                const fixedFile = this.createFixedFile(file);
                this.uploadFile(fixedFile);
            } else {
                this.uploadFile(file);
            }
        }
    }

    // 깨진 파일명 감지
    isBrokenFileName(fileName) {
        const brokenPatterns = [
            /á\\x[0-9a-fA-F]{2}/g, // á\x 형태의 패턴
            /\\x[0-9a-fA-F]{2}/g, // \x 형태의 패턴
        ];
        
        return brokenPatterns.some(pattern => pattern.test(fileName));
    }

    // 수정된 파일 객체 생성
    createFixedFile(originalFile) {
        const fixedFileName = this.fixKoreanFileName(originalFile.name);
        console.log('🔧 파일명 수정:', originalFile.name, '→', fixedFileName);
        
        // 파일명이 여전히 깨진 경우 사용자에게 입력받기
        if (this.isStillBroken(fixedFileName)) {
            console.log('⚠️ 파일명이 여전히 깨져있음, 사용자 입력 요청');
            return this.requestFileNameFromUser(originalFile);
        }
        
        return new File([originalFile], fixedFileName, {
            type: originalFile.type,
            lastModified: originalFile.lastModified
        });
    }

    // 파일명이 여전히 깨져있는지 확인
    isStillBroken(fileName) {
        const brokenPatterns = [
            /á\\x[0-9a-fA-F]{2}/g,
            /\\x[0-9a-fA-F]{2}/g,
            /á/g
        ];
        
        return brokenPatterns.some(pattern => pattern.test(fileName));
    }

    // 사용자에게 파일명 입력받기
    requestFileNameFromUser(originalFile) {
        const originalExt = originalFile.name.split('.').pop();
        const suggestedName = `복구된_파일.${originalExt}`;
        
        const fileName = prompt(
            `파일명이 깨져서 인식할 수 없습니다.\n원본 파일명: ${originalFile.name}\n\n올바른 파일명을 입력해주세요:`,
            suggestedName
        );
        
        if (fileName && fileName.trim()) {
            let finalName = fileName.trim();
            
            // 확장자가 없으면 추가
            if (!finalName.includes('.')) {
                finalName += '.' + originalExt;
            }
            
            console.log('✅ 사용자 입력 파일명:', finalName);
            
            return new File([originalFile], finalName, {
                type: originalFile.type,
                lastModified: originalFile.lastModified
            });
        } else {
            // 사용자가 취소한 경우 기본 파일명 사용
            console.log('⚠️ 사용자가 파일명 입력을 취소함, 기본 파일명 사용');
            return new File([originalFile], suggestedName, {
                type: originalFile.type,
                lastModified: originalFile.lastModified
            });
        }
    }

    async uploadFile(file) {
        const allowedTypes = ['application/pdf', 'text/plain', 'text/csv'];
        if (!allowedTypes.includes(file.type)) {
            this.showUploadStatus('지원하지 않는 파일 형식입니다. PDF, TXT, CSV 파일만 업로드할 수 있습니다.', 'error');
            return;
        }

        // 파일 크기 확인 (50MB 제한)
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (file.size > maxSize) {
            this.showUploadStatus('파일 크기가 너무 큽니다. 50MB 이하의 파일만 업로드할 수 있습니다.', 'error');
            return;
        }

        console.log('📤 업로드할 파일:', file.name);

        const formData = new FormData();
        formData.append('file', file);

        this.showUploadStatus(`"${file.name}" 업로드 중...`, 'loading');

        try {
            console.log(`📤 파일 업로드 시작: ${file.name} (${file.size} bytes, ${file.type})`);
            
            const response = await fetch(this.apiBaseUrl + '/rag/upload', {
                method: 'POST',
                body: formData
            });

            console.log(`📥 서버 응답 상태: ${response.status}`);
            
            const result = await response.json();
            console.log('📄 서버 응답:', result);

            if (response.ok) {
                this.showUploadStatus(`✅ "${file.name}" 업로드 완료!`, 'success');
                this.loadDocuments();
                this.addBotMessage(`문서 "${file.name}"이 성공적으로 업로드되었습니다. 이제 이 문서에 대해 질문하실 수 있습니다.`);
            } else {
                let errorMessage = '업로드에 실패했습니다.';
                
                if (result.error) {
                    errorMessage = result.error;
                }
                
                if (result.details) {
                    errorMessage += ` (${result.details})`;
                }
                
                console.error('❌ 업로드 실패:', result);
                this.showUploadStatus(`❌ ${errorMessage}`, 'error');
            }
        } catch (error) {
            console.error('❌ 업로드 중 네트워크 오류:', error);
            this.showUploadStatus(`❌ 업로드 중 오류 발생: ${error.message}`, 'error');
        }

        // Clear file input
        this.fileInput.value = '';
    }

    // 강화된 파일명 복구 함수
    fixKoreanFileName(fileName) {
        try {
            console.log('🔍 한글 파일명 복구 시작:', fileName);
            
            // 실제 깨진 패턴 분석
            // á\x84\x8Bá\x85¢á\x84\x83á\x85³... 형태의 패턴을 한글로 변환
            let fixedName = fileName;
            
            // UTF-8 바이트 시퀀스를 한글로 변환하는 시도
            const bytePattern = /á\\x([0-9a-fA-F]{2})/g;
            const bytes = [];
            
            let match;
            while ((match = bytePattern.exec(fileName)) !== null) {
                bytes.push(parseInt(match[1], 16));
            }
            
            if (bytes.length > 0) {
                console.log('🔍 발견된 바이트:', bytes);
                
                // UTF-8 바이트를 문자열로 변환 시도
                try {
                    const uint8Array = new Uint8Array(bytes);
                    const decoder = new TextDecoder('utf-8');
                    const decodedString = decoder.decode(uint8Array);
                    console.log('🔓 디코딩된 문자열:', decodedString);
                    
                    if (decodedString && decodedString.trim()) {
                        // 원본 파일명에서 깨진 부분을 찾아 교체
                        const originalExt = fileName.split('.').pop();
                        fixedName = decodedString.trim();
                        
                        if (originalExt && !fixedName.includes('.')) {
                            fixedName += '.' + originalExt;
                        }
                        
                        console.log('✅ 한글 파일명 복구 성공:', fixedName);
                        return fixedName;
                    }
                } catch (decodeError) {
                    console.log('⚠️ UTF-8 디코딩 실패:', decodeError);
                }
            }
            
            // 대안적인 복구 방법 - 실제 패턴에 맞춘 복구
            return this.advancedFixFileName(fileName);
            
        } catch (error) {
            console.error('❌ 한글 파일명 복구 실패:', error);
            return this.simpleFixFileName(fileName);
        }
    }

    // 고급 파일명 복구 함수
    advancedFixFileName(fileName) {
        try {
            console.log('🔧 고급 파일명 복구 시작:', fileName);
            
            // 실제 패턴: (á\x84\x8Bá\x85¢á\x84\x83á\x85³á\x84\x90á\x85¡á\x84\x8Bá\x85µá\x86¸) á\x84\x83á\x85¦á\x84\x8Bá\x85µá\x84\x90á\x85¥á\x84\x80á\x85µá\x84\x87á\x85¡á\x86« á\x84\x8Bá\x85©á\x86¨á\x84\x8Bá\x85¬á\x84\x80á\x85ªá\x86¼á\x84\x80á\x85©-á\x84\x90á\x85¡á\x84\x80á\x85¦á\x86ºá\x84\x8Bá\x85©á\x84\x83á\x85µá\x84\x8Bá\x85¥á\x86«á\x84\x89á\x85³á\x84\x85á\x85³á\x86¯ á\x84\x8Eá\x85¡á\x86½á\x84\x8Bá\x85¡á\x84\x82á\x85¢á\x84\x82á\x85³á\x86« á\x84\x80á\x85ªá\x84\x92á\x85¡á\x86¨.pdf
            
            // 1단계: 괄호 안의 내용과 괄호 밖의 내용 분리
            const bracketMatch = fileName.match(/\((.*?)\)\s*(.*)/);
            if (bracketMatch) {
                const bracketContent = bracketMatch[1];
                const mainContent = bracketMatch[2];
                
                console.log('🔍 괄호 내용:', bracketContent);
                console.log('🔍 메인 내용:', mainContent);
                
                // 2단계: 각 부분을 개별적으로 복구
                const fixedBracket = this.decodeBytes(bracketContent);
                const fixedMain = this.decodeBytes(mainContent);
                
                console.log('🔧 복구된 괄호 내용:', fixedBracket);
                console.log('🔧 복구된 메인 내용:', fixedMain);
                
                // 3단계: 조합
                let result = '';
                if (fixedBracket) {
                    result += `(${fixedBracket}) `;
                }
                if (fixedMain) {
                    result += fixedMain;
                }
                
                if (result.trim()) {
                    console.log('✅ 최종 복구 결과:', result);
                    return result.trim();
                }
            }
            
            // 괄호가 없는 경우 전체를 복구
            return this.decodeBytes(fileName) || this.simpleFixFileName(fileName);
            
        } catch (error) {
            console.error('❌ 고급 파일명 복구 실패:', error);
            return this.simpleFixFileName(fileName);
        }
    }

    // 바이트 디코딩 함수
    decodeBytes(text) {
        try {
            // á\x 형태의 패턴을 찾아서 바이트로 변환
            const bytePattern = /á\\x([0-9a-fA-F]{2})/g;
            const bytes = [];
            
            let match;
            while ((match = bytePattern.exec(text)) !== null) {
                bytes.push(parseInt(match[1], 16));
            }
            
            if (bytes.length > 0) {
                console.log('🔍 추출된 바이트:', bytes);
                
                // UTF-8 디코딩
                const uint8Array = new Uint8Array(bytes);
                const decoder = new TextDecoder('utf-8');
                const decodedString = decoder.decode(uint8Array);
                
                console.log('🔓 디코딩 결과:', decodedString);
                return decodedString.trim();
            }
            
            return null;
        } catch (error) {
            console.error('❌ 바이트 디코딩 실패:', error);
            return null;
        }
    }

    // 간단한 파일명 수정 함수
    simpleFixFileName(fileName) {
        // 깨진 문자들을 제거하고 기본적인 정리
        let fixedName = fileName
            .replace(/á\\x[0-9a-fA-F]{2}/g, '') // á\x 형태 제거
            .replace(/\\x[0-9a-fA-F]{2}/g, '') // \x 형태 제거
            .replace(/á/g, '') // 남은 á 제거
            .replace(/\s+/g, ' ') // 연속된 공백을 하나로
            .trim();
        
        // 파일 확장자 확인
        if (!fixedName.includes('.')) {
            const originalExt = fileName.split('.').pop();
            if (originalExt) {
                fixedName += '.' + originalExt;
            }
        }
        
        return fixedName || 'unnamed_file';
    }

    showUploadStatus(message, type) {
        this.uploadStatus.textContent = message;
        this.uploadStatus.className = `upload-status ${type}`;
        
        if (type === 'success' || type === 'error') {
            setTimeout(() => {
                this.uploadStatus.textContent = '';
                this.uploadStatus.className = 'upload-status';
            }, 3000);
        }
    }

    async loadDocuments() {
        try {
            const response = await fetch(this.apiBaseUrl + '/rag/documents');
            const result = await response.json();

            if (response.ok && result.documents && result.documents.length > 0) {
                this.displayDocuments(result.documentDetails || result.documents, result.totalChunks);
            } else {
                this.documentsList.innerHTML = '<p class="no-documents">업로드된 문서가 없습니다.</p>';
            }
        } catch (error) {
            console.error('문서 목록 로드 실패:', error);
            this.documentsList.innerHTML = '<p class="no-documents">문서 목록을 불러올 수 없습니다.</p>';
        }
    }

    displayDocuments(documents, totalChunks) {
        this.documentsList.innerHTML = '';
        
        const summary = document.createElement('div');
        summary.className = 'document-item';
        summary.style.background = '#e3f2fd';
        summary.style.borderLeftColor = '#2196f3';
        summary.innerHTML = `📊 총 ${documents.length}개 문서, ${totalChunks}개 청크`;
        this.documentsList.appendChild(summary);

        documents.forEach(doc => {
            const docItem = document.createElement('div');
            docItem.className = 'document-item';
            
            // 문서 정보 처리
            let fileName, extension, icon;
            
            if (typeof doc === 'string') {
                // 기존 형식 지원
                fileName = doc;
                extension = doc.split('.').pop().toLowerCase();
            } else {
                // 새로운 상세 정보 형식
                fileName = doc.originalName || doc.filename;
                extension = fileName.split('.').pop().toLowerCase();
                
                // 파일 크기 포맷팅
                const size = doc.size ? this.formatFileSize(doc.size) : '';
                const chunks = doc.chunks ? ` (${doc.chunks}청크)` : '';
                
                docItem.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            ${this.getFileIcon(extension)} ${fileName}
                            <br><small style="color: #666;">${size}${chunks}</small>
                        </div>
                        <small style="color: #999;">${this.formatDate(doc.uploadTime)}</small>
                    </div>
                `;
                this.documentsList.appendChild(docItem);
                return;
            }
            
            // 기존 형식 처리
            icon = this.getFileIcon(extension);
            docItem.innerHTML = `${icon} ${fileName}`;
            this.documentsList.appendChild(docItem);
        });
    }

    getFileIcon(extension) {
        switch (extension) {
            case 'pdf': return '📄';
            case 'csv': return '📊';
            case 'txt': return '📝';
            default: return '📄';
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('ko-KR', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

// Initialize the chatbot when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChatBot();
});