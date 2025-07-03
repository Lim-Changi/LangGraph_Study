# LangGraph.js 라우터 및 ReAct 에이전트

이 프로젝트는 LangGraph.js를 사용하여 사용자의 질문 의도를 파악하고, 적절한 도구(LLM, 벡터 DB, 웹 검색)로 라우팅하는 ReAct(Reason + Act) 기반 에이전트를 구현합니다.

![LangGraph Studio UI](./static/studio_ui.png)

## 주요 기능

`src/react_agent/graph.ts`에 정의된 핵심 로직은 다음과 같은 단계로 동작합니다.

1.  **라우팅 (Routing):** 사용자의 질문을 LLM으로 분석하여 다음 세 가지 경로 중 하나를 결정합니다.
    *   `llm`: 일반적인 대화나 정보 요청
    *   `vectordb`: 로컬 ChromaDB에 저장된 특정 문서나 지식 기반에 대한 질문
    *   `websearch`: 최신 정보나 실시간 데이터가 필요한 질문

2.  **처리 (Handling):** 각 경로에 따라 지정된 핸들러가 작업을 수행합니다.
    *   `handleLLMResponse`: LLM을 통해 직접 답변을 생성합니다.
    *   `handleVectorDBResponse`: ChromaDB에서 관련 문서를 검색하고, 그 내용을 바탕으로 LLM이 답변을 생성합니다.
    *   `handleWebSearchResponse`: Tavily API로 웹을 검색하고, 검색 결과를 바탕으로 LLM이 답변을 생성합니다.

3.  **결과 검증 (Judging):** 웹 검색(`websearch`)의 경우, 생성된 답변이 질문에 대해 충분히 정확한지 LLM을 통해 한 번 더 검증합니다. 만약 부정확하다고 판단되면, 다시 라우팅 단계를 거쳐 다른 도구를 사용하도록 유도합니다.

## 시작하기

LangGraph Studio를 사용하여 이 프로젝트를 실행하고 테스트할 수 있습니다.

1.  **.env 파일 설정:**

    ```bash
    cp .env.example .env
    ```

2.  **API 키 설정:**
    `.env` 파일에 사용하려는 LLM(Anthropic, OpenAI 등)과 Tavily의 API 키를 추가합니다.

    ```
    # 예시: Anthropic과 Tavily 사용 시
    ANTHROPIC_API_KEY=your-anthropic-api-key
    TAVILY_API_KEY=your-tavily-api-key
    ```

3.  **ChromaDB 실행:**
    벡터 DB 검색 기능을 사용하려면 로컬 환경에서 ChromaDB 서버가 실행 중이어야 합니다. (기본 포트: `8000`)

    ```bash
    # Docker를 사용하는 경우
    docker run -p 8000:8000 chromadb/chroma
    ```

4.  **LangGraph Studio에서 열기:**
    설정이 완료되면, LangGraph Studio에서 이 프로젝트 폴더를 열어 그래프의 동작을 시각적으로 확인하고 직접 실행해볼 수 있습니다.

## 커스터마이징

-   **도구 추가:** `src/react_agent/tools.ts`에 새로운 도구를 추가하여 에이전트의 기능을 확장할 수 있습니다.
-   **모델 변경:** `langgraph.json` 파일이나 LangGraph Studio의 설정 UI에서 다른 언어 모델로 변경할 수 있습니다.
-   **그래프 로직 수정:** `src/react_agent/graph.ts` 파일의 노드와 엣지를 수정하여 에이전트의 동작 흐름을 자유롭게 변경할 수 있습니다.