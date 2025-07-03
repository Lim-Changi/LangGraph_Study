import { Module } from '@nestjs/common';
import { LangGraphService } from './langgraph.service';
import { LangGraphController } from './langgraph.controller';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [RagModule],
  controllers: [LangGraphController],
  providers: [LangGraphService],
  exports: [LangGraphService],
})
export class LangGraphModule {}
