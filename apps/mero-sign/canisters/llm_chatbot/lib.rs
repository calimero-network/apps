use ic_cdk::update;
use ic_llm::{chat, ChatMessage, Model};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct FormattedResponse {
    answer: String,
    confidence_score: String,
    reference_quote: String,
}

#[update]
async fn get_rag_response(prompt: String, context: String, history: Vec<ChatMessage>) -> String {
    let system_prompt = format!(
        r#"You are a specialized legal assistant. Your task is to answer the user's question based ONLY on the provided context.
        Format your response as a single, clean JSON object with three keys: "answer", "confidence_score", and "reference_quote".
        - "answer": A direct, conversational answer to the user's question.
        - "confidence_score": Your confidence that the answer is fully contained in the context. Must be one of: "High", "Medium", or "Low".
        - "reference_quote": A single, direct quote from the context that best supports your answer.
        If the answer is not in the context, set "answer" to a clarifying statement, "confidence_score" to "None", and "reference_quote" to an empty string.

        ---
        CONTEXT:
        {}
        ---"#,
        context
    );

    let mut messages = vec![ChatMessage::System {
        content: system_prompt,
    }];
    messages.extend(history);
    messages.push(ChatMessage::User { content: prompt });

    let response = chat(Model::Llama3_1_8B)
        .with_messages(messages)
        .send()
        .await;

    let llm_content = response.message.content.unwrap_or_default();

    match serde_json::from_str::<FormattedResponse>(&llm_content) {
        Ok(_) => llm_content,
        Err(_) => {
            let fallback = FormattedResponse {
                answer: llm_content,
                confidence_score: "Uncertain".to_string(),
                reference_quote: "N/A".to_string(),
            };

            serde_json::to_string(&fallback).unwrap_or_else(|_| "{\"answer\":\"Failed to serialize fallback response.\",\"confidence_score\":\"None\",\"reference_quote\":\"\"}".to_string())
        }
    }
}

#[update]
async fn prompt_model(prompt_text: String) -> String {
    ic_llm::prompt(Model::Llama3_1_8B, prompt_text).await
}

ic_cdk::export_candid!();
