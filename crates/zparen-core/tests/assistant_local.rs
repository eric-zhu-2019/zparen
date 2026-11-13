use axum::Router;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use zparen_core::assistant::{AssistantConfig, AssistantEvent, Provider};
use zparen_core::session::SessionConfig;
use zparen_core::workbench::{AppEvent, Request, Response, Workbench};

type Seen = Arc<Mutex<Vec<(HeaderMap, Value)>>>;

fn sse(chunks: &[Value]) -> String {
    chunks.iter().map(|c| format!("data: {c}\n\n")).chain(["data: [DONE]\n\n".to_string()]).collect()
}

async fn models() -> String {
    json!({"object":"list","data":[{"id":"qwen3:8b","object":"model"},{"id":"gemma:2b","object":"model"}]}).to_string()
}

/// Asks to evaluate (+ 1 2) with a tool, then answers. `gemma:2b` cannot call tools, as Ollama says.
async fn completions(State(seen): State<Seen>, headers: HeaderMap, body: String) -> impl IntoResponse {
    let body: Value = serde_json::from_str(&body).unwrap();
    seen.lock().unwrap().push((headers, body.clone()));
    if body["model"] == "gemma:2b" && body.get("tools").is_some() {
        let error = json!({"error":{"message":"registry.ollama.ai/library/gemma:2b does not support tools","type":"api_error"}});
        return (StatusCode::BAD_REQUEST, error.to_string());
    }
    let answered = body["messages"].as_array().unwrap().last().unwrap()["role"] == "tool";
    let chunks = if body["model"] == "gemma:2b" {
        vec![json!({"choices":[{"index":0,"delta":{"content":"Plain 3."},"finish_reason":"stop"}]})]
    } else if answered {
        vec![
            json!({"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"It printed 3."}}]}),
            json!({"choices":[{"index":0,"delta":{"content":"It is "}}]}),
            json!({"choices":[{"index":0,"delta":{"content":"3."},"finish_reason":"stop"}]}),
        ]
    } else {
        vec![
            json!({"choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_7","type":"function","function":{"name":"eval","arguments":""}}]}}]}),
            json!({"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"form\": \"(+ 1 2)\"}"}}]}}]}),
            json!({"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}),
        ]
    };
    (StatusCode::OK, sse(&chunks))
}

async fn turn(wb: &Arc<Workbench>, rx: &mut tokio::sync::broadcast::Receiver<AppEvent>, text: &str) -> (String, String) {
    wb.handle(Request::AssistantSend { text: text.into(), context: None }).await.unwrap();
    let (mut said, mut thought) = (String::new(), String::new());
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            if let AppEvent::Assistant { event } = rx.recv().await.unwrap() {
                match event {
                    AssistantEvent::Text { text } => said.push_str(&text),
                    AssistantEvent::Thinking { text } => thought.push_str(&text),
                    AssistantEvent::ToolFinished { ok, output, .. } => assert!(ok && output.contains('3'), "{output}"),
                    AssistantEvent::Error { message } => panic!("{message}"),
                    AssistantEvent::TurnFinished { stop_reason } => return assert_eq!(stop_reason, "end_turn"),
                    _ => {}
                }
            }
        }
    })
    .await
    .expect("turn finishes");
    (said, thought)
}

#[tokio::test]
async fn a_local_server_lists_its_models_and_runs_tools() {
    let seen = Seen::default();
    let app = Router::new().route("/v1/models", get(models)).route("/v1/chat/completions", post(completions)).with_state(seen.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../resources");
    let mut cfg = SessionConfig::new(resources);
    cfg.data_dir = std::env::temp_dir().join(format!("zparen-assistant-local-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&cfg.data_dir);
    let wb = Workbench::new(cfg);
    let mut rx = wb.subscribe();

    let Ok(Response::Assistant(status)) = wb.handle(Request::AssistantStatus).await else { panic!("status") };
    assert!(!status.local.configured && status.local.note.as_deref().unwrap().contains("Ollama"), "no address yet: {:?}", status.local);

    // An address with nothing listening says so.
    let closed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap();
    let config = AssistantConfig { provider: Provider::Local, local_url: closed.to_string(), ..Default::default() };
    let Ok(Response::Assistant(status)) = wb.handle(Request::AssistantConfigure { config }).await else { panic!("status") };
    assert!(!status.local.configured);
    assert!(status.local.note.as_deref().unwrap().starts_with(&format!("Could not reach http://{closed}/v1")), "{:?}", status.local.note);

    // The address as typed: a host and port.
    let config = AssistantConfig { provider: Provider::Local, local_url: addr.to_string(), local_model: "qwen3:8b".into(), ..Default::default() };
    let Ok(Response::Assistant(status)) = wb.handle(Request::AssistantConfigure { config: config.clone() }).await else { panic!("status") };
    assert_eq!(status.config, config);
    assert!(status.local.configured, "{:?}", status.local);
    assert_eq!(status.local.models, ["gemma:2b", "qwen3:8b"]);

    let (said, thought) = turn(&wb, &mut rx, "What is (+ 1 2)?").await;
    assert_eq!((said.as_str(), thought.as_str()), ("It is 3.", "It printed 3."));
    {
        let s = seen.lock().unwrap();
        let (headers, first) = &s[0];
        assert!(!headers.contains_key("authorization"), "no key, no header");
        assert_eq!(first["model"], "qwen3:8b");
        assert_eq!(first["stream"], true);
        assert!(first.get("max_tokens").is_none(), "the server's own limit applies");
        assert!(first["tools"].as_array().unwrap().iter().any(|t| t["type"] == "function" && t["function"]["name"] == "eval"));
        let messages = first["messages"].as_array().unwrap();
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1], json!({"role":"user","content":"What is (+ 1 2)?"}));
        let second = s[1].1["messages"].as_array().unwrap();
        assert_eq!(second[2]["tool_calls"][0]["id"], "call_7");
        assert_eq!(second[2]["tool_calls"][0]["function"]["arguments"], "{\"form\":\"(+ 1 2)\"}");
        assert_eq!(second[3]["role"], "tool");
        assert_eq!(second[3]["tool_call_id"], "call_7");
        assert!(second[3]["content"].as_str().unwrap().contains('3'));
    }

    // A saved key goes with each request.
    wb.handle(Request::AssistantSetKey { provider: Provider::Local, key: "local-key".into() }).await.unwrap();
    // A model that cannot call tools answers without them, and says so.
    let plain = AssistantConfig { local_model: "gemma:2b".into(), ..config };
    wb.handle(Request::AssistantConfigure { config: plain }).await.unwrap();
    let (said, _) = turn(&wb, &mut rx, "And without tools?").await;
    assert!(said.starts_with("_gemma:2b cannot call tools") && said.ends_with("Plain 3."), "{said}");
    {
        let s = seen.lock().unwrap();
        let (headers, retried) = s.last().unwrap();
        assert_eq!(headers["authorization"], "Bearer local-key");
        assert!(retried.get("tools").is_none());
        assert!(retried["messages"].to_string().contains("It is 3."), "the same conversation continues");
    }
    wb.stop().await;
}
