# LangGraph Study

NestJS 기반의 LangGraph와 RAG(Retrieval-Augmented Generation) 시스템 구현 프로젝트

## 기능

### LangGraph API

- **Chat**: 기본 메시지 처리
- **RAG Chat**: 문서 기반 대화 시스템
- **Workflow**: 체인 워크플로우 처리

### RAG System

- **문서 업로드**: PDF, TXT, CSV 파일 지원
- **문서 검색**: 벡터 기반 의미 검색
- **CSV 분석**: CSV 파일 데이터 분석
- **컬렉션 관리**: 문서 컬렉션 리셋 기능

## 바이브 코딩

- **Claud Code**: 프로젝트 셋업
- **Cursor AI**: 에러 디버깅 및 추가 기능 개발

## 기술 스택

- **Backend**: NestJS, TypeScript
- **AI/ML**: LangChain, LangGraph, Anthropic Claude
- **Vector Store**: ChromaDB
- **File Processing**: Multer, pdf-parse

## API 엔드포인트

### LangGraph (`/langgraph`)

- `POST /chat` - 기본 채팅
- `POST /rag-chat` - RAG 기반 채팅
- `POST /workflow` - 워크플로우 처리

### RAG (`/rag`)

- `POST /upload` - 문서 업로드
- `POST /query` - RAG 질의
- `GET /search` - 문서 검색
- `POST /csv-query` - CSV 데이터 질의

## 실행 방법

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run start:dev

# 프로덕션 빌드
npm run build
npm run start:prod
```

## 환경 설정

환경 변수를 설정하여 AI 모델 API 키를 구성하세요.
