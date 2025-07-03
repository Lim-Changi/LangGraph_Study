import { Injectable } from '@nestjs/common';
import { ChromaClient } from 'chromadb';
import * as fs from 'fs';
import * as path from 'path';
import * as pdfParse from 'pdf-parse';
import * as Papa from 'papaparse';
import * as iconv from 'iconv-lite';
import { ChatAnthropic } from '@langchain/anthropic';
import { StateGraph, END } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';

interface RAGState {
  messages: HumanMessage[];
  context?: string;
  query?: string;
}

@Injectable()
export class RagService {
  private chroma: ChromaClient;
  private model: ChatAnthropic;
  private collectionName = 'documents';

  constructor() {
    this.chroma = new ChromaClient();
    this.model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-haiku-20240307',
      maxTokens: 1000,
      temperature: 0,
    });
  }

  async initializeCollection() {
    try {
      await this.chroma.getCollection({ name: this.collectionName });
    } catch {
      // 기존 컬렉션이 없으면 새로 생성 (임베딩 함수 없이)
      await this.chroma.createCollection({
        name: this.collectionName,
        metadata: { description: 'Document collection for RAG' },
      });
    }
  }

  async resetCollection() {
    try {
      // 기존 컬렉션이 있으면 삭제
      await this.chroma.deleteCollection({ name: this.collectionName });
      console.log('🗑️ 기존 컬렉션 삭제 완료');
    } catch (error) {
      console.log('기존 컬렉션이 없습니다.');
    }

    // 새 컬렉션 생성 (임베딩 함수 없이)
    await this.chroma.createCollection({
      name: this.collectionName,
      metadata: { description: 'Document collection for RAG' },
    });
    console.log('✅ 새 컬렉션 생성 완료');
  }

  async addDocument(filePath: string, fileName: string): Promise<string> {
    try {
      console.log(`📄 문서 추가 시작: ${fileName} (경로: ${filePath})`);

      // 파일 존재 확인
      if (!fs.existsSync(filePath)) {
        throw new Error(`파일이 존재하지 않습니다: ${filePath}`);
      }

      const fileStats = fs.statSync(filePath);
      console.log(`📊 파일 크기: ${fileStats.size} bytes`);

      await this.initializeCollection();

      let content = '';
      const fileExtension = path.extname(fileName).toLowerCase();
      console.log(`🔍 파일 확장자: ${fileExtension}`);

      if (fileExtension === '.pdf') {
        console.log('📄 PDF 파일 처리 시작...');
        try {
          const pdfBuffer = fs.readFileSync(filePath);
          console.log(`📄 PDF 버퍼 크기: ${pdfBuffer.length} bytes`);

          // PDF 버전 및 메타데이터 확인
          const pdfHeader = pdfBuffer.toString('ascii', 0, 1024);
          console.log(`📄 PDF 헤더: ${pdfHeader.substring(0, 100)}...`);

          const pdfData = (await pdfParse(pdfBuffer, {
            // PDF 파싱 옵션 추가
            max: 0, // 모든 페이지 파싱
            version: 'v2.0.550',
          })) as any;

          console.log(
            `📄 PDF 파싱 완료. 텍스트 길이: ${pdfData.text?.length || 0} characters`,
          );
          console.log(`📄 PDF 페이지 수: ${pdfData.numpages || '알 수 없음'}`);
          console.log(`📄 PDF 정보:`, {
            info: pdfData.info,
            metadata: pdfData.metadata,
            version: pdfData.version,
          });

          if (!pdfData.text || pdfData.text.trim().length === 0) {
            // 텍스트가 없는 경우 대안적인 처리
            console.log(
              '⚠️ PDF에서 텍스트를 추출할 수 없습니다. 대안적인 처리 시도...',
            );

            if (pdfData.info && Object.keys(pdfData.info).length > 0) {
              // 메타데이터에서 정보 추출
              content = `PDF 문서 정보:\n`;
              Object.entries(pdfData.info).forEach(([key, value]) => {
                if (value && value.toString().trim()) {
                  content += `${key}: ${value}\n`;
                }
              });
              console.log('✅ PDF 메타데이터에서 정보 추출');
            } else {
              throw new Error(
                'PDF에서 텍스트를 추출할 수 없습니다. 이미지 기반 PDF이거나 텍스트가 없는 PDF일 수 있습니다.',
              );
            }
          } else {
            content = pdfData.text as string;
            console.log(
              `✅ PDF 텍스트 추출 성공: ${content.substring(0, 100)}...`,
            );
          }
        } catch (pdfError: any) {
          console.error('❌ PDF 처리 오류:', pdfError);

          // 구체적인 에러 메시지 제공
          let errorMessage = 'PDF 처리 실패';
          if (pdfError.message.includes('Invalid PDF')) {
            errorMessage =
              '유효하지 않은 PDF 파일입니다. 파일이 손상되었을 수 있습니다.';
          } else if (pdfError.message.includes('password')) {
            errorMessage = '비밀번호로 보호된 PDF 파일입니다.';
          } else if (pdfError.message.includes('corrupt')) {
            errorMessage = '손상된 PDF 파일입니다.';
          } else {
            errorMessage = `PDF 처리 실패: ${pdfError.message}`;
          }

          throw new Error(errorMessage);
        }
      } else if (fileExtension === '.txt') {
        console.log('📝 TXT 파일 처리 시작...');
        content = this.readFileWithEncoding(filePath);
        console.log(`✅ TXT 파일 읽기 성공: ${content.substring(0, 100)}...`);
      } else if (fileExtension === '.csv') {
        console.log('📊 CSV 파일 처리 시작...');
        content = await this.processCSVFile(filePath);
        console.log(`✅ CSV 파일 처리 성공: ${content.substring(0, 100)}...`);
      } else {
        throw new Error(
          '지원하지 않는 파일 형식입니다. PDF, TXT, CSV 파일만 지원됩니다.',
        );
      }

      if (!content || content.trim().length === 0) {
        throw new Error('파일에서 내용을 추출할 수 없습니다.');
      }

      console.log(`✂️ 텍스트 청킹 시작... (원본 길이: ${content.length})`);
      const chunks = this.splitText(content, 1000);
      console.log(`✅ ${chunks.length}개의 청크로 분할 완료`);

      const collection = await this.chroma.getCollection({
        name: this.collectionName,
      });

      console.log('🧠 임베딩 생성 시작...');
      const embeddings = this.generateEmbeddings(chunks);
      console.log(`✅ ${embeddings.length}개의 임베딩 생성 완료`);

      const ids = chunks.map((_, index) => `${fileName}_chunk_${index}`);
      const metadatas = chunks.map((chunk, index) => ({
        source: fileName,
        original_filename: fileName,
        chunk_index: index,
        chunk_text: chunk.substring(0, 100),
        file_size: fileStats.size,
        upload_timestamp: new Date().toISOString(),
      }));

      console.log('💾 ChromaDB에 저장 시작...');
      await collection.add({
        ids,
        embeddings,
        documents: chunks,
        metadatas,
      });
      console.log('✅ ChromaDB 저장 완료');

      return `성공적으로 ${chunks.length}개의 청크를 ${fileName}에서 추가했습니다`;
    } catch (error: any) {
      console.error('❌ 문서 추가 실패:', error);
      throw new Error(`문서 추가 실패: ${error?.message || '알 수 없는 오류'}`);
    }
  }

  async searchDocuments(query: string, topK: number = 5): Promise<any[]> {
    try {
      await this.initializeCollection();
      const collection = await this.chroma.getCollection({
        name: this.collectionName,
      });

      const queryEmbedding = this.generateEmbeddings([query]);

      const results = await collection.query({
        queryEmbeddings: queryEmbedding,
        nResults: topK,
        include: ['documents', 'metadatas', 'distances'],
      });

      return (results.documents?.[0] || []).map((doc: any, index: number) => ({
        content: doc,
        metadata: results.metadatas?.[0]?.[index],
        distance: results.distances?.[0]?.[index],
      }));
    } catch (error: any) {
      throw new Error(
        `Failed to search documents: ${error?.message || 'Unknown error'}`,
      );
    }
  }

  async ragQuery(question: string): Promise<string> {
    try {
      const relevantDocs = await this.searchDocuments(question, 3);

      const context = relevantDocs.map((doc) => doc.content).join('\n\n');

      const prompt = `다음 문서들을 참고하여 질문에 답변해주세요:

문서 내용:
${context}

질문: ${question}

답변:`;

      const response = await this.model.invoke([new HumanMessage(prompt)]);
      return response.content as string;
    } catch (error: any) {
      throw new Error(
        `Failed to generate RAG response: ${error?.message || 'Unknown error'}`,
      );
    }
  }

  private splitText(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];

    // 한국어 문장 분할 패턴 (마침표, 느낌표, 물음표, 줄바꿈)
    const sentencePattern = /[.!?。！？\n]+/;
    const sentences = text
      .split(sentencePattern)
      .filter((s) => s.trim().length > 0);

    let currentChunk = '';

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) continue;

      if (
        currentChunk.length + trimmedSentence.length > chunkSize &&
        currentChunk.length > 0
      ) {
        chunks.push(currentChunk.trim());
        currentChunk = trimmedSentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  private generateEmbeddings(texts: string[]): number[][] {
    const embeddings: number[][] = [];

    for (const text of texts) {
      // 한국어 토큰화 개선
      const tokens = this.tokenizeKorean(text);
      const embedding = new Array(384).fill(0) as number[];

      for (let i = 0; i < tokens.length && i < 384; i++) {
        const hash = this.simpleHash(tokens[i]);
        embedding[i % 384] += hash;
      }

      const norm = Math.sqrt(
        embedding.reduce((sum, val) => sum + val * val, 0),
      );
      const normalizedEmbedding = embedding.map((val) => val / (norm || 1));

      embeddings.push(normalizedEmbedding);
    }

    return embeddings;
  }

  private tokenizeKorean(text: string): string[] {
    // 한국어 토큰화: 음절 단위로 분할하고 의미있는 단위로 그룹화
    const tokens: string[] = [];
    const syllables = text.split('');

    let currentToken = '';

    for (let i = 0; i < syllables.length; i++) {
      const char = syllables[i];
      const charCode = char.charCodeAt(0);

      // 한글 범위 (가-힣: 44032-55203)
      const isKorean = charCode >= 44032 && charCode <= 55203;
      // 한글 자모 범위 (ㄱ-ㅎ: 12593-12643, ㅏ-ㅣ: 12623-12643)
      const isKoreanJamo = charCode >= 12593 && charCode <= 12643;
      // 영문, 숫자, 공백
      const isAlphanumeric = /[a-zA-Z0-9\s]/.test(char);

      if (isKorean || isKoreanJamo) {
        currentToken += char;
      } else if (isAlphanumeric) {
        if (currentToken) {
          tokens.push(currentToken);
          currentToken = '';
        }
        if (char.trim()) {
          tokens.push(char);
        }
      } else {
        // 특수문자나 다른 문자
        if (currentToken) {
          tokens.push(currentToken);
          currentToken = '';
        }
      }
    }

    if (currentToken) {
      tokens.push(currentToken);
    }

    return tokens.filter((token) => token.trim().length > 0);
  }

  private readFileWithEncoding(filePath: string): string {
    try {
      // 먼저 UTF-8로 시도
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.removeBOM(content);
    } catch (error) {
      try {
        // UTF-8 실패시 binary로 읽어서 인코딩 추정
        const buffer = fs.readFileSync(filePath);
        return this.detectAndDecode(buffer);
      } catch (error2) {
        // 마지막으로 ASCII로 시도
        return fs.readFileSync(filePath, 'ascii');
      }
    }
  }

  private detectAndDecode(buffer: Buffer): string {
    // BOM 확인
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xef &&
      buffer[1] === 0xbb &&
      buffer[2] === 0xbf
    ) {
      return buffer.slice(3).toString('utf-8');
    }

    // UTF-8로 디코딩 시도
    try {
      const utf8Result = buffer.toString('utf-8');
      // UTF-8이 유효한지 확인 (깨진 문자가 있는지)
      if (this.isValidUTF8(utf8Result)) {
        return utf8Result;
      }
    } catch {
      // UTF-8 디코딩 실패
    }

    // EUC-KR로 시도 (한국어 파일에서 자주 사용)
    try {
      const euckrResult = iconv.decode(buffer, 'euc-kr');
      if (this.isValidKorean(euckrResult)) {
        return euckrResult;
      }
    } catch {
      // EUC-KR 디코딩 실패
    }

    // CP949로 시도 (Windows에서 자주 사용하는 한국어 인코딩)
    try {
      const cp949Result = iconv.decode(buffer, 'cp949');
      if (this.isValidKorean(cp949Result)) {
        return cp949Result;
      }
    } catch {
      // CP949 디코딩 실패
    }

    // 마지막 수단으로 ASCII
    return buffer.toString('ascii');
  }

  private isValidUTF8(text: string): boolean {
    // UTF-8 유효성 검사: 깨진 문자가 있는지 확인
    try {
      return text.length > 0 && !text.includes('');
    } catch {
      return false;
    }
  }

  private isValidKorean(text: string): boolean {
    // 한국어 텍스트 유효성 검사: 한글이 포함되어 있는지 확인
    const koreanPattern = /[가-힣]/;
    return koreanPattern.test(text);
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash / 1000000;
  }

  private removeBOM(content: string): string {
    // UTF-8 BOM 제거
    if (content.charCodeAt(0) === 0xfeff) {
      return content.slice(1);
    }
    return content;
  }

  async listDocuments(): Promise<{
    totalDocuments: number;
    totalChunks: number;
    documents: string[];
    documentDetails: Array<{
      filename: string;
      originalName: string;
      chunks: number;
      size: number;
      uploadTime: string;
    }>;
  }> {
    try {
      await this.initializeCollection();
      const collection = await this.chroma.getCollection({
        name: this.collectionName,
      });

      const results = await collection.get({
        include: ['metadatas'],
      });

      // 파일별로 그룹화
      const fileGroups = new Map<string, any[]>();

      (results.metadatas || []).forEach((meta: any) => {
        if (meta?.source) {
          if (!fileGroups.has(meta.source)) {
            fileGroups.set(meta.source, []);
          }
          fileGroups.get(meta.source)!.push(meta);
        }
      });

      const documentDetails = Array.from(fileGroups.entries()).map(
        ([source, metas]) => {
          const firstMeta = metas[0];
          return {
            filename: source,
            originalName: firstMeta.original_filename || source,
            chunks: metas.length,
            size: firstMeta.file_size || 0,
            uploadTime: firstMeta.upload_timestamp || new Date().toISOString(),
          };
        },
      );

      const sources = Array.from(fileGroups.keys());

      return {
        totalDocuments: sources.length,
        totalChunks: results.metadatas?.length || 0,
        documents: sources,
        documentDetails,
      };
    } catch (error: any) {
      throw new Error(
        `문서 목록 조회 실패: ${error?.message || '알 수 없는 오류'}`,
      );
    }
  }

  private async processCSVFile(filePath: string): Promise<string> {
    // CSV 파일의 경우 더 강력한 인코딩 감지 필요
    const buffer = fs.readFileSync(filePath);
    const csvContent = this.detectCSVEncoding(buffer);

    return new Promise((resolve, reject) => {
      Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        encoding: 'utf-8',
        complete: (result: any) => {
          try {
            const processedContent = this.convertCSVToText(
              result.data,
              result.meta.fields,
            );
            resolve(processedContent);
          } catch (error) {
            reject(error);
          }
        },
        error: (error: any) => {
          reject(new Error(`CSV parsing error: ${error.message}`));
        },
      });
    });
  }

  private detectCSVEncoding(buffer: Buffer): string {
    console.log('🔍 CSV 인코딩 감지 시작...');

    // CSV 파일 전용 인코딩 감지
    const encodings = [
      { name: 'utf-8', bom: [0xef, 0xbb, 0xbf] },
      { name: 'utf-16le', bom: [0xff, 0xfe] },
      { name: 'utf-16be', bom: [0xfe, 0xff] },
      { name: 'utf-32le', bom: [0xff, 0xfe, 0x00, 0x00] },
      { name: 'utf-32be', bom: [0x00, 0x00, 0xfe, 0xff] },
    ];

    // BOM 확인
    for (const encoding of encodings) {
      if (this.hasBOM(buffer, encoding.bom)) {
        console.log(`✅ BOM 감지됨: ${encoding.name}`);
        return iconv.decode(buffer.slice(encoding.bom.length), encoding.name);
      }
    }

    console.log('❌ BOM이 없습니다. 인코딩 추정을 시작합니다...');

    // BOM이 없는 경우 인코딩 추정
    const sampleText = buffer
      .slice(0, Math.min(1000, buffer.length))
      .toString('utf-8');
    console.log('📝 샘플 텍스트 (UTF-8):', sampleText.substring(0, 100));

    // 깨진 문자가 있는지 확인
    if (this.hasBrokenCharacters(sampleText)) {
      console.log('⚠️ 깨진 문자 감지됨. 다른 인코딩을 시도합니다...');

      // EUC-KR 시도
      try {
        const euckrResult = iconv.decode(buffer, 'euc-kr');
        console.log('🇰🇷 EUC-KR 결과:', euckrResult.substring(0, 100));
        if (
          this.isValidKorean(euckrResult) &&
          !this.hasBrokenCharacters(euckrResult)
        ) {
          console.log('✅ EUC-KR 인코딩 사용');
          return euckrResult;
        }
      } catch (error) {
        console.log('❌ EUC-KR 디코딩 실패:', error.message);
      }

      // CP949 시도
      try {
        const cp949Result = iconv.decode(buffer, 'cp949');
        console.log('🇰🇷 CP949 결과:', cp949Result.substring(0, 100));
        if (
          this.isValidKorean(cp949Result) &&
          !this.hasBrokenCharacters(cp949Result)
        ) {
          console.log('✅ CP949 인코딩 사용');
          return cp949Result;
        }
      } catch (error) {
        console.log('❌ CP949 디코딩 실패:', error.message);
      }

      // ISO-8859-1 시도 (Windows-1252와 유사)
      try {
        const isoResult = iconv.decode(buffer, 'iso-8859-1');
        console.log('🌍 ISO-8859-1 결과:', isoResult.substring(0, 100));
        if (!this.hasBrokenCharacters(isoResult)) {
          console.log('✅ ISO-8859-1 인코딩 사용');
          return isoResult;
        }
      } catch (error) {
        console.log('❌ ISO-8859-1 디코딩 실패:', error.message);
      }
    } else {
      console.log('✅ UTF-8 인코딩이 유효합니다');
    }

    // 마지막 수단으로 UTF-8
    console.log('🔄 UTF-8 인코딩 사용 (기본값)');
    return buffer.toString('utf-8');
  }

  private hasBOM(buffer: Buffer, bom: number[]): boolean {
    if (buffer.length < bom.length) return false;
    return bom.every((byte, index) => buffer[index] === byte);
  }

  private hasBrokenCharacters(text: string): boolean {
    // 깨진 문자 패턴 확인 ( 문자나 이상한 유니코드 문자)
    const brokenPatterns = [
      /\uFFFD/g, // Replacement character
      /[\u0000-\u001F\u007F-\u009F]/g, // Control characters
    ];

    return brokenPatterns.some((pattern) => pattern.test(text));
  }

  private convertCSVToText(data: any[], headers: string[]): string {
    let textContent = '';

    // 헤더 정보 추가
    textContent += `데이터셋 정보:\n`;
    textContent += `총 ${data.length}개의 레코드가 있습니다.\n`;
    textContent += `컬럼: ${headers.join(', ')}\n\n`;

    // 각 행을 자연어 형태로 변환
    data.forEach((row, index) => {
      textContent += `레코드 ${index + 1}:\n`;

      headers.forEach((header) => {
        if (row[header] && row[header].toString().trim() !== '') {
          textContent += `- ${header}: ${row[header]}\n`;
        }
      });

      textContent += '\n';
    });

    // 통계 정보 추가
    textContent += this.generateCSVStatistics(data, headers);

    return textContent;
  }

  private generateCSVStatistics(data: any[], headers: string[]): string {
    let statsContent = '\n=== 데이터 통계 ===\n';

    headers.forEach((header) => {
      const values = data
        .map((row) => row[header])
        .filter((val) => val && val.toString().trim() !== '');

      statsContent += `\n${header} 컬럼:\n`;
      statsContent += `- 총 ${values.length}개의 값\n`;

      // 숫자형 데이터인지 확인
      const numericValues = values
        .map((val) => parseFloat(val.toString().replace(/,/g, '')))
        .filter((val) => !isNaN(val));

      if (numericValues.length > 0 && numericValues.length === values.length) {
        const sum = numericValues.reduce((a, b) => a + b, 0);
        const avg = sum / numericValues.length;
        const min = Math.min(...numericValues);
        const max = Math.max(...numericValues);

        statsContent += `- 평균: ${avg.toLocaleString()}\n`;
        statsContent += `- 최소값: ${min.toLocaleString()}\n`;
        statsContent += `- 최대값: ${max.toLocaleString()}\n`;
      } else {
        // 카테고리형 데이터 통계
        const uniqueValues = [...new Set(values)];
        statsContent += `- 고유값 개수: ${uniqueValues.length}\n`;

        if (uniqueValues.length <= 10) {
          const valueCounts = uniqueValues.map((val) => ({
            value: val,
            count: values.filter((v) => v === val).length,
          }));

          valueCounts.sort((a, b) => b.count - a.count);
          statsContent += `- 값별 빈도:\n`;
          valueCounts.forEach((item) => {
            statsContent += `  ${item.value}: ${item.count}회\n`;
          });
        }
      }
    });

    return statsContent;
  }

  async getCSVAnalysis(fileName: string): Promise<any> {
    try {
      await this.initializeCollection();
      const collection = await this.chroma.getCollection({
        name: this.collectionName,
      });

      const results = await collection.get({
        include: ['metadatas', 'documents'],
        where: { source: fileName },
      });

      if (!results.documents || results.documents.length === 0) {
        throw new Error('CSV 파일을 찾을 수 없습니다.');
      }

      // CSV 관련 청크들에서 통계 정보 추출
      const statsChunk = results.documents.find((doc: string) =>
        doc.includes('=== 데이터 통계 ==='),
      );

      return {
        fileName,
        totalChunks: results.documents?.length || 0,
        hasStatistics: !!statsChunk,
        preview:
          results.documents?.[0]?.substring(0, 500) + '...' ||
          'No preview available',
      };
    } catch (error: any) {
      throw new Error(`CSV 분석 실패: ${error?.message || 'Unknown error'}`);
    }
  }
}
