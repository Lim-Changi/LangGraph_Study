import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LangGraphModule } from './langgraph/langgraph.module';
import { RagModule } from './rag/rag.module';

@Module({
  imports: [LangGraphModule, RagModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
