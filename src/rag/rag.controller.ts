import {
  Controller,
  Post,
  Get,
  Body,
  UploadedFile,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { RagService } from './rag.service';
import * as fs from 'fs';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Get()
  getInfo(): string {
    return 'RAG (Retrieval-Augmented Generation) API with CSV support is running!';
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
      }),
      fileFilter: (req, file, cb) => {
        if (
          file.mimetype === 'application/pdf' ||
          file.mimetype === 'text/plain' ||
          file.mimetype === 'text/csv'
        ) {
          cb(null, true);
        } else {
          cb(new Error('PDF, TXT, CSV 파일만 업로드할 수 있습니다!'), false);
        }
      },
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB 제한
      },
    }),
  )
  async uploadDocument(@UploadedFile() file: Express.Multer.File) {
    console.log('📤 파일 업로드 요청 처리 시작');

    if (!file) {
      console.log('❌ 업로드된 파일이 없습니다');
      return { error: '업로드된 파일이 없습니다' };
    }

    const decodedName = Buffer.from(file.originalname, 'latin1').toString(
      'utf8',
    );
    try {
      const result = await this.ragService.addDocument(file.path, decodedName);

      console.log(`✅ 문서 처리 성공: ${decodedName}`);
      return {
        message: result,
        filename: decodedName,
        size: file.size,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error(`❌ 문서 처리 실패: ${decodedName}`, error);

      // 파일 정리 (실패한 경우)
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
          console.log(`🗑️ 임시 파일 삭제: ${file.path}`);
        }
      } catch (cleanupError) {
        console.error('파일 정리 실패:', cleanupError);
      }

      return {
        error: '문서 처리에 실패했습니다',
        details: error instanceof Error ? error.message : '알 수 없는 오류',
        filename: decodedName,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Post('query')
  async ragQuery(@Body('question') question: string) {
    if (!question) {
      return { error: 'Question is required' };
    }

    try {
      const answer = await this.ragService.ragQuery(question);
      console.log(answer);
      return {
        question,
        answer,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: 'Failed to process RAG query',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Get('search')
  async searchDocuments(
    @Query('query') query: string,
    @Query('topK') topK?: string,
  ) {
    if (!query) {
      return { error: 'Query is required' };
    }

    try {
      const results = await this.ragService.searchDocuments(
        query,
        topK ? parseInt(topK) : 5,
      );
      return {
        query,
        results,
        count: results.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: 'Failed to search documents',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Get('documents')
  async listDocuments() {
    try {
      return await this.ragService.listDocuments();
    } catch (error: any) {
      return {
        error: 'Failed to list documents',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Get('csv-analysis')
  async getCSVAnalysis(@Query('fileName') fileName: string) {
    if (!fileName) {
      return { error: 'File name is required' };
    }

    try {
      const analysis = await this.ragService.getCSVAnalysis(fileName);
      return analysis;
    } catch (error: any) {
      return {
        error: 'Failed to analyze CSV file',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Post('reset-collection')
  async resetCollection() {
    try {
      await this.ragService.resetCollection();
      return {
        message: '컬렉션이 성공적으로 리셋되었습니다.',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: '컬렉션 리셋에 실패했습니다',
        details: error instanceof Error ? error.message : '알 수 없는 오류',
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Post('csv-query')
  async csvQuery(
    @Body('question') question: string,
    @Body('fileName') fileName?: string,
  ) {
    if (!question) {
      return { error: 'Question is required' };
    }

    try {
      let searchQuery = question;
      if (fileName) {
        searchQuery = `파일 ${fileName}에서 ${question}`;
      }

      const results = await this.ragService.searchDocuments(searchQuery, 5);
      const csvResults = results.filter((result) =>
        result.metadata?.source?.toLowerCase().endsWith('.csv'),
      );

      if (csvResults.length === 0) {
        return {
          error: 'No CSV data found for this query',
          suggestion: 'Try uploading a CSV file first or check your query',
        };
      }

      const answer = await this.ragService.ragQuery(question);

      return {
        question,
        answer,
        csvSources: csvResults.map((r) => r.metadata?.source).filter(Boolean),
        type: 'csv-query',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: 'Failed to process CSV query',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// 파일명 처리를 위한 헬퍼 함수들
function createSafeFileName(originalName: string): string {
  try {
    // 파일명 디코딩 시도
    let decodedName = originalName;

    // URL 디코딩 시도
    try {
      decodedName = decodeURIComponent(originalName);
    } catch {
      // URL 디코딩 실패시 원본 사용
    }

    // 한글 파일명이 깨진 경우 복구 시도
    if (isBrokenKorean(decodedName)) {
      console.log('⚠️ 깨진 한글 파일명 감지, 복구 시도...');
      decodedName = fixKoreanFileName(decodedName);
    }

    // 특수문자 제거 및 안전한 파일명 생성
    const safeName = decodedName
      .replace(/[<>:"/\\|?*]/g, '_') // Windows에서 사용할 수 없는 문자 제거
      .replace(/\s+/g, '_') // 공백을 언더스코어로 변경
      .replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ._-]/g, '_') // 한글, 영문, 숫자, 일부 특수문자만 허용
      .replace(/_+/g, '_') // 연속된 언더스코어를 하나로
      .replace(/^_|_$/g, ''); // 앞뒤 언더스코어 제거

    return safeName || 'unnamed_file';
  } catch (error) {
    console.error('파일명 처리 오류:', error);
    return 'unnamed_file';
  }
}

// 깨진 한글 파일명 감지
function isBrokenKorean(text: string): boolean {
  // 깨진 한글 패턴 확인
  const brokenPatterns = [
    /\uFFFD/g, // Replacement character
    /[^\x00-\x7F가-힣ㄱ-ㅎㅏ-ㅣ\s._-]/g, // ASCII, 한글, 공백, 일부 특수문자 외
  ];

  return brokenPatterns.some((pattern) => pattern.test(text));
}

// 한글 파일명 복구 시도
function fixKoreanFileName(text: string): string {
  // 일반적인 한글 파일명 패턴으로 복구 시도
  const commonPatterns = [
    /\([^)]*\)/g, // 괄호 안의 내용
    /[가-힣]+/g, // 한글 단어
    /[ㄱ-ㅎㅏ-ㅣ]+/g, // 한글 자모
  ];

  let fixedName = '';
  for (const pattern of commonPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      fixedName += matches.join('_');
    }
  }

  return fixedName || text;
}
