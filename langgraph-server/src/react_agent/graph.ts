import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { ChromaClient } from "chromadb";

import { ConfigurationSchema, ensureConfiguration } from "./configuration.js";
import { TOOLS } from "./tools.js";
import { loadChatModel } from "./utils.js";

// Extended state annotation with routing information
const RouterStateAnnotation = Annotation.Root({
  messages: Annotation<any[]>,
  routingDecision: Annotation<"llm" | "vectordb" | "websearch" | null>,
  vectorContext: Annotation<string>,
  searchResults: Annotation<string>,
  finalResponse: Annotation<string>,
  isAccurate: Annotation<boolean>,
});

// ChromaDB client for vector search
const chromaClient = new ChromaClient({
  path: "http://localhost:8000",
});

// Simple embedding generation for vector search
function generateSimpleEmbedding(text: string): number[] {
  const embedding = new Array(384).fill(0);

  for (let i = 0; i < text.length && i < 384; i++) {
    const charCode = text.charCodeAt(i);
    embedding[i % 384] += charCode / 1000;
  }

  const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map((val) => val / (norm || 1));
}

// Route message to appropriate handler based on LLM analysis
async function routeMessage(
  state: typeof RouterStateAnnotation.State,
  config: RunnableConfig
): Promise<typeof RouterStateAnnotation.Update> {
  const configuration = ensureConfiguration(config);
  const model = await loadChatModel(configuration.model);

  const lastMessage = state.messages[state.messages.length - 1];
  const messageContent =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : lastMessage.content.toString();

  // Use LLM to analyze the message and decide routing
  const routingPrompt = `당신은 사용자 메시지를 분석하여 적절한 처리 방법을 결정하는 라우터입니다.

사용자 메시지: "${messageContent}"

다음 옵션 중 가장 적절한 하나를 선택하세요:

1. "llm": 일반적인 질문, 대화, 설명, 추천 등에 대한 답변
2. "vectordb": 문서, 파일, 업로드된 자료, 저장된 데이터, 특정 지식베이스 검색이 필요한 질문
3. "websearch": 최신 정보, 뉴스, 실시간 데이터, 웹에서 검색이 필요한 질문

JSON 형태로만 응답하세요:
{"decision": "선택한_옵션", "reason": "선택 이유"}`;

  try {
    const response = await model.invoke([new HumanMessage(routingPrompt)]);

    const responseContent = response.content as string;
    const parsedResponse = JSON.parse(responseContent);

    const routingDecision = parsedResponse.decision as
      | "llm"
      | "vectordb"
      | "websearch";
    const reason = parsedResponse.reason || "No reason provided";

    console.log(`🔀 Message routed to: ${routingDecision}`);
    console.log(`📝 Reason: ${reason}`);
    console.log(`📝 Message content: ${messageContent.substring(0, 100)}...`);

    return { routingDecision };
  } catch (error) {
    console.error("Routing decision error:", error);
    console.log("🔄 Falling back to LLM routing");
    return { routingDecision: "llm" };
  }
}

// Handle LLM-based responses
async function handleLLMResponse(
  state: typeof RouterStateAnnotation.State,
  config: RunnableConfig
): Promise<typeof RouterStateAnnotation.Update> {
  const configuration = ensureConfiguration(config);
  const model = await loadChatModel(configuration.model);

  const response = await model.invoke([
    {
      role: "system",
      content: `You are a helpful AI assistant. Answer questions directly and concisely. Current time: ${new Date().toISOString()}`,
    },
    ...state.messages,
  ]);

  const finalResponse = response.content as string;
  console.log(`🤖 LLM Response: ${finalResponse.substring(0, 100)}...`);

  return { finalResponse, messages: [...state.messages, response] };
}

// Handle VectorDB search and response
async function handleVectorDBResponse(
  state: typeof RouterStateAnnotation.State,
  config: RunnableConfig
): Promise<typeof RouterStateAnnotation.Update> {
  try {
    const lastMessage = state.messages[state.messages.length - 1];
    const query =
      typeof lastMessage.content === "string"
        ? lastMessage.content
        : lastMessage.content.toString();

    console.log("📚 Attempting to search in vector database...");

    let vectorContext = "";

    try {
      // Get all collections
      const collections = await chromaClient.listCollections();
      console.log(
        `📚 Available collections: ${collections.map((c: any) => c.name).join(", ")}`
      );

      if (collections.length === 0) {
        console.log("📚 No collections found in ChromaDB");
        vectorContext = "문서 컬렉션이 없습니다. 먼저 문서를 업로드해주세요.";
      } else {
        // Use the first collection for search
        const collectionName = (collections[0] as any).name;
        console.log(`📚 Searching in collection: ${collectionName}`);

        // Generate embedding for the query
        const queryEmbedding = generateSimpleEmbedding(query);

        // Try to get collection and search
        try {
          const collection = await chromaClient.getCollection({
            name: collectionName,
          } as any);

          // Search in the collection
          const searchResults = await collection.query({
            queryEmbeddings: [queryEmbedding],
            nResults: 5,
          });

          if (
            searchResults.documents &&
            searchResults.documents[0] &&
            searchResults.documents[0].length > 0
          ) {
            const documents = searchResults.documents[0];
            const metadatas = searchResults.metadatas?.[0] || [];
            const distances = searchResults.distances?.[0] || [];

            console.log(`📚 Found ${documents.length} relevant documents`);

            // Combine documents with metadata and distance information
            const contextParts = documents.map((doc, index) => {
              const metadata = metadatas[index] || {};
              const distance = distances[index] || 0;
              const source = metadata.source || "Unknown";
              const page = metadata.page || "";

              return `[문서 ${index + 1}] (유사도: ${(1 - distance).toFixed(3)}, 출처: ${source}${page ? `, 페이지: ${page}` : ""})
${doc}`;
            });

            vectorContext = contextParts.join("\n\n");
          } else {
            console.log("📚 No relevant documents found");
            vectorContext =
              "관련된 문서를 찾을 수 없습니다. 다른 키워드로 검색해보세요.";
          }
        } catch (collectionError) {
          console.error("Collection access error:", collectionError);
          vectorContext =
            "컬렉션에 접근할 수 없습니다. ChromaDB 설정을 확인해주세요.";
        }
      }
    } catch (chromaError) {
      console.error("ChromaDB connection error:", chromaError);
      vectorContext =
        "ChromaDB 연결에 실패했습니다. localhost:8000에서 ChromaDB가 실행 중인지 확인해주세요.";
    }

    console.log(
      `📚 Vector search completed for query: ${query.substring(0, 50)}...`
    );

    // Generate response using LLM with context
    const configuration = ensureConfiguration(config);
    const model = await loadChatModel(configuration.model);

    const contextPrompt =
      vectorContext &&
      !vectorContext.includes("실패") &&
      !vectorContext.includes("없습니다")
        ? `다음 문서들을 참고하여 사용자의 질문에 답변해주세요:

참고 문서:
${vectorContext}

사용자 질문: ${query}

답변:`
        : `문서 검색 결과: ${vectorContext}

사용자 질문: ${query}

위의 상황을 고려하여 답변해주세요.`;

    const response = await model.invoke([new HumanMessage(contextPrompt)]);

    const finalResponse = response.content as string;
    console.log(`📚 VectorDB Response: ${finalResponse.substring(0, 100)}...`);

    return {
      vectorContext,
      finalResponse,
      messages: [...state.messages, response],
    };
  } catch (error) {
    console.error("VectorDB search error:", error);
    const errorResponse =
      "문서 검색 중 오류가 발생했습니다. 다시 시도해주세요.";
    return {
      vectorContext: "",
      finalResponse: errorResponse,
      messages: [...state.messages, new AIMessage(errorResponse)],
    };
  }
}

// Handle web search and response
async function handleWebSearchResponse(
  state: typeof RouterStateAnnotation.State,
  config: RunnableConfig
): Promise<typeof RouterStateAnnotation.Update> {
  try {
    console.log(state);
    const lastMessage = state.messages[state.messages.length - 1];
    const query =
      typeof lastMessage.content === "string"
        ? lastMessage.content
        : lastMessage.content.toString();

    // Use Tavily search tool
    const searchTool = TOOLS.find((tool) => tool.name === "tavily_search");

    let searchResults = "";

    if (searchTool) {
      const searchResult = await searchTool.invoke({ query });
      searchResults =
        typeof searchResult === "string"
          ? searchResult
          : JSON.stringify(searchResult);
    }

    console.log(`🔍 Web search completed for: ${query}`);

    // Generate response using LLM with search results
    const configuration = ensureConfiguration(config);
    const model = await loadChatModel(configuration.model);

    const searchPrompt = searchResults
      ? `Based on the following web search results, please answer the user's question:

Search Results:
${searchResults}

Question: ${query}

Answer:`
      : `I couldn't perform a web search for: ${query}. Please try rephrasing your question.`;

    const response = await model.invoke([new HumanMessage(searchPrompt)]);

    const finalResponse = response.content as string;
    console.log(
      `🔍 Web Search Response: ${finalResponse.substring(0, 100)}...`
    );

    return {
      searchResults,
      finalResponse,
      messages: [...state.messages, response],
    };
  } catch (error) {
    console.error("Web search error:", error);
    const errorResponse = "웹 검색 중 오류가 발생했습니다. 다시 시도해주세요.";
    return {
      searchResults: "",
      finalResponse: errorResponse,
      messages: [...state.messages, new AIMessage(errorResponse)],
    };
  }
}

// 웹 검색 결과의 정확성 판단 노드
async function judgeWebSearchResult(
  state: typeof RouterStateAnnotation.State,
  config: RunnableConfig
): Promise<typeof RouterStateAnnotation.Update> {
  const configuration = ensureConfiguration(config);
  const model = await loadChatModel(configuration.model);

  const judgePrompt = `아래는 웹 검색 결과와 그에 대한 답변입니다.\n이 답변이 사용자의 질문에 대해 충분히 정확하고 신뢰할 수 있는지 \"yes\" 또는 \"no\"로만 답변하세요.\n\n질문: ${state.messages[0].content}\n웹 검색 결과: ${state.searchResults}\n답변: ${state.finalResponse}\n\n정확합니까? {\"result\": \"yes\" 또는 \"no\", \"reason\": \"간단한 이유\"}`;

  try {
    const response = await model.invoke([new HumanMessage(judgePrompt)]);
    const parsed = JSON.parse(response.content as string);
    const isAccurate = parsed.result === "yes";
    return { isAccurate };
  } catch (e) {
    // 실패 시 기본적으로 정확하지 않다고 판단
    return { isAccurate: false };
  }
}

// 정확성에 따라 분기하는 함수
function judgeWebSearchEdge(state: typeof RouterStateAnnotation.State): string {
  return state.isAccurate ? "__end__" : "router";
}

// Route to appropriate handler based on routing decision
function routeToHandler(state: typeof RouterStateAnnotation.State): string {
  const decision = state.routingDecision;

  switch (decision) {
    case "vectordb":
      return "vectordb_handler";
    case "websearch":
      return "websearch_handler";
    case "llm":
    default:
      return "llm_handler";
  }
}

// Define the new routing graph with multiple response handlers
const workflow = new StateGraph(RouterStateAnnotation, ConfigurationSchema)
  // Add routing node as entry point
  .addNode("router", routeMessage)

  // Add handler nodes for different response types
  .addNode("llm_handler", handleLLMResponse)
  .addNode("vectordb_handler", handleVectorDBResponse)
  .addNode("websearch_handler", handleWebSearchResponse)
  .addNode("judge_websearch_result", judgeWebSearchResult)

  // Set the entrypoint as router
  .addEdge("__start__", "router")

  // Add conditional edges from router to appropriate handlers
  .addConditionalEdges("router", routeToHandler)

  // All handlers lead to end, 단 websearch는 judge로
  .addEdge("llm_handler", "__end__")
  .addEdge("vectordb_handler", "__end__")
  .addEdge("websearch_handler", "judge_websearch_result")
  .addConditionalEdges("judge_websearch_result", judgeWebSearchEdge);

// Export the compiled graph
export const graph = workflow.compile({
  interruptBefore: [],
  interruptAfter: [],
});
