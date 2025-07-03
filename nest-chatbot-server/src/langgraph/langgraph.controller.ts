import { Controller, Post, Body, Get } from '@nestjs/common';
import { LangGraphService } from './langgraph.service';
import { RagService } from '../rag/rag.service';

@Controller('langgraph')
export class LangGraphController {
  constructor(
    private readonly langGraphService: LangGraphService,
    private readonly ragService: RagService,
  ) {}

  @Get()
  getHello(): string {
    return 'LangGraph NestJS API with Claude is running!';
  }

  @Post('chat')
  async chat(@Body('message') message: string) {
    if (!message) {
      return { error: 'Message is required' };
    }

    try {
      const response = await this.langGraphService.processMessage(message);
      return {
        message,
        response,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: 'Failed to process message',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Post('rag-chat')
  async ragChat(@Body('message') message: string) {
    if (!message) {
      return { error: 'Message is required' };
    }

    try {
      const result = await this.langGraphService.processRAGMessage(message);
      return {
        message,
        response: result.response,
        referencedDocuments: result.referencedDocuments,
        type: 'rag-chat',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: 'Failed to process RAG message',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Post('rag-query')
  async ragQuery(@Body('question') question: string) {
    if (!question) {
      return { error: 'Question is required' };
    }

    try {
      const answer = await this.ragService.ragQuery(question);
      return {
        question,
        answer,
        type: 'rag-simple',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: 'Failed to process RAG query',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Post('workflow')
  async chainedWorkflow(@Body('message') message: string) {
    if (!message) {
      return { error: 'Message is required' };
    }

    try {
      const result =
        await this.langGraphService.processChainedWorkflow(message);
      return {
        message,
        workflow: result,
        type: 'chained-workflow',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: 'Failed to process chained workflow',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
