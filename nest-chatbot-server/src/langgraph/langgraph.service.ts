import { Injectable } from '@nestjs/common';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage } from '@langchain/core/messages';
import { RagService } from '../rag/rag.service';

@Injectable()
export class LangGraphService {
  private model: ChatAnthropic;

  constructor(private readonly ragService: RagService) {
    this.model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-haiku-20240307',
      maxTokens: 1000,
      temperature: 0,
    });
  }

  async processMessage(message: string): Promise<string> {
    try {
      const response = await this.model.invoke([new HumanMessage(message)]);
      return response.content as string;
    } catch (error) {
      throw new Error(`Failed to process message: ${error}`);
    }
  }

  async processRAGMessage(message: string): Promise<{
    response: string;
    referencedDocuments?: Array<{
      source: string;
      content: string;
      relevance: number;
    }>;
  }> {
    try {
      // 업로드된 문서에서 관련 정보 검색
      const relevantDocs = await this.ragService.searchDocuments(message, 3);

      if (relevantDocs.length === 0) {
        // 관련 문서가 없는 경우 일반 답변
        const noContextPrompt = `다음은 사용자의 질문입니다: ${message}
        
업로드된 문서에서 관련 정보를 찾을 수 없습니다. 일반적인 지식으로 답변해드리겠습니다.`;

        const response = await this.model.invoke([
          new HumanMessage(noContextPrompt),
        ]);
        return {
          response: response.content as string,
          referencedDocuments: [],
        };
      }

      // 관련 문서 내용을 컨텍스트로 구성
      const context = relevantDocs
        .map((doc, index) => `[문서 ${index + 1}] ${doc.content}`)
        .join('\n\n');

      const ragPrompt = `다음은 업로드된 문서들의 내용입니다:

${context}

이 문서들을 참고하여 다음 질문에 답변해주세요:

질문: ${message}

답변 시 다음 사항을 고려해주세요:
1. 제공된 문서 내용을 기반으로 정확한 답변을 제공하세요
2. 문서에 없는 내용은 일반적인 지식으로 보완할 수 있습니다
3. 답변의 출처가 되는 문서를 명시해주세요
4. 문서 내용을 그대로 복사하지 말고 이해한 내용을 바탕으로 답변해주세요

답변:`;

      const response = await this.model.invoke([new HumanMessage(ragPrompt)]);

      // 참조한 문서 정보 구성
      const referencedDocuments = relevantDocs.map((doc, index) => ({
        source: doc.metadata?.source || `문서 ${index + 1}`,
        content:
          doc.content.substring(0, 200) +
          (doc.content.length > 200 ? '...' : ''),
        relevance: doc.distance ? 1 - doc.distance : 0.8, // 거리를 관련성 점수로 변환
      }));

      return {
        response: response.content as string,
        referencedDocuments,
      };
    } catch (error) {
      throw new Error(`Failed to process RAG message: ${error}`);
    }
  }

  async processChainedWorkflow(message: string): Promise<{
    step1: string;
    step2: string;
    final: string;
  }> {
    try {
      const step1Prompt = `첫 번째 단계: 다음 질문을 분석하고 핵심 키워드를 추출해주세요: ${message}`;
      const step1Response = await this.model.invoke([
        new HumanMessage(step1Prompt),
      ]);

      const step2Prompt = `두 번째 단계: 다음 키워드를 바탕으로 관련 정보를 정리해주세요: ${step1Response.content}`;
      const step2Response = await this.model.invoke([
        new HumanMessage(step2Prompt),
      ]);

      const finalPrompt = `최종 단계: 다음 정보를 종합하여 원래 질문에 대한 완성된 답변을 제공해주세요.
      
원래 질문: ${message}
분석된 키워드: ${step1Response.content}
관련 정보: ${step2Response.content}`;

      const finalResponse = await this.model.invoke([
        new HumanMessage(finalPrompt),
      ]);

      return {
        step1: step1Response.content as string,
        step2: step2Response.content as string,
        final: finalResponse.content as string,
      };
    } catch (error) {
      throw new Error(`Failed to process chained workflow: ${error}`);
    }
  }
}
