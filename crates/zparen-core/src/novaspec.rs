//! The Common Lisp Nova Spec, read online from novaspec.org. Its index,
//! `apropos.js`, names each symbol's page. ZParen fetches a page when the Docs
//! panel shows it, removes the site's scripts and search box, and links
//! ZParen's own stylesheet, nova.css. The pages are served under `nova/` in the
//! clhs: scheme, so the webview itself never loads novaspec.org. Nothing is
//! stored on disk: when the site cannot be reached, the Docs panel shows the
//! Community Spec the app carries.

use std::collections::HashMap;
use std::path::{Component, Path};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const BASE: &str = "https://novaspec.org/cl/";
/// What the Docs panel calls it.
pub const NAME: &str = "Nova Spec";
/// After a failed fetch of the index, how long to use the Community Spec before trying again.
const RETRY: Duration = Duration::from_secs(120);
/// Pages kept in memory, so going back and forth fetches nothing.
const KEEP: usize = 200;

/// When a name has several pages, as `function` and `nil` do, the first of these kinds wins.
const KINDS: [&str; 15] = [
    "Function",
    "Macro",
    "Special Operator",
    "Accessor",
    "Standard Generic Function",
    "Local Macro",
    "Local Function",
    "Variable",
    "Constant Variable",
    "Declaration",
    "Type Specifier",
    "Type",
    "Class",
    "System Class",
    "Condition Type",
];

/// Symbols with no entry of their own, sent where the standard defines them, as the HyperSpec does.
const DEFINED_IN: [(&str, &[&str]); 5] = [
    ("3_4_Lambda_Lists#sec_3_4_1", &["&ALLOW-OTHER-KEYS", "&AUX", "&BODY", "&ENVIRONMENT", "&KEY", "&OPTIONAL", "&REST", "&WHOLE"]),
    ("m_optimize", &["COMPILATION-SPEED", "DEBUG", "SAFETY", "SPACE", "SPEED"]),
    ("f_documentation", &["COMPILER-MACRO", "STRUCTURE", "VARIABLE"]),
    ("f_case", &["OTHERWISE"]),
    ("7_6_Generic_Functions_and_Methods#sec_7_6_6_2", &["STANDARD"]),
];

enum State {
    Unknown,
    Loaded(Arc<HashMap<String, String>>),
    Failed(Instant),
}

static INDEX: tokio::sync::Mutex<State> = tokio::sync::Mutex::const_new(State::Unknown);
static PAGES: Mutex<Option<HashMap<String, Arc<Vec<u8>>>>> = Mutex::new(None);

fn client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(6))
            .connect_timeout(Duration::from_secs(4))
            .user_agent(concat!("ZParen/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default()
    })
}

async fn get(path: &str) -> Option<Vec<u8>> {
    let response = client().get(format!("{BASE}{path}")).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.bytes().await.ok().map(|b| b.to_vec())
}

/// The index, fetched once. `None` while the site cannot be reached.
async fn index() -> Option<Arc<HashMap<String, String>>> {
    let mut state = INDEX.lock().await;
    match &*state {
        State::Loaded(index) => return Some(index.clone()),
        State::Failed(at) if at.elapsed() < RETRY => return None,
        _ => {}
    }
    let index = get("apropos.js").await.map(|js| parse_index(&String::from_utf8_lossy(&js))).filter(|i| !i.is_empty());
    *state = match &index {
        Some(index) => State::Loaded(Arc::new(index.clone())),
        None => State::Failed(Instant::now()),
    };
    index.map(Arc::new)
}

/// Reads `apropos.js`: `var apropos = [["mapcar, Function", "f_mapc"], …]`.
/// Gives upper-case symbol names and their pages.
pub fn parse_index(js: &str) -> HashMap<String, String> {
    let rank = |kind: &str| KINDS.iter().position(|k| *k == kind).unwrap_or(KINDS.len());
    let mut best: HashMap<String, (usize, String)> = HashMap::new();
    for line in js.lines() {
        let Some(entry) = line.trim().trim_start_matches("var apropos = ").trim_start_matches('[').strip_prefix('"') else { continue };
        let Some((term, rest)) = entry.split_once("\", \"") else { continue };
        let Some(page) = rest.split('"').next() else { continue };
        let term = term.replace("\\\"", "\"").replace("\\\\", "\\");
        let Some((name, kind)) = term.rsplit_once(", ") else { continue };
        if name.is_empty() || name.contains(' ') || !page.chars().all(|c| c.is_ascii_alphanumeric() || "_-#".contains(c)) {
            continue;
        }
        let key = name.to_uppercase();
        let r = rank(kind);
        if best.get(&key).is_none_or(|(seen, _)| r < *seen) {
            best.insert(key, (r, page.to_string()));
        }
    }
    let mut index: HashMap<String, String> = best.into_iter().map(|(k, (_, page))| (k, page)).collect();
    if !index.is_empty() {
        for (page, names) in DEFINED_IN {
            for name in names {
                index.entry(name.to_string()).or_insert_with(|| page.to_string());
            }
        }
    }
    index
}

/// The page for a Common Lisp symbol, as a path under the clhs: scheme, such
/// as `nova/f_mapc`, or `nova/3_4_Lambda_Lists#sec_3_4_1` for a section. It
/// is fetched now, so a page that cannot be reached falls back to the
/// Community Spec. A package prefix such as `cl:` is ignored.
pub async fn page(symbol: &str) -> Option<String> {
    let name = symbol.rsplit(':').next().unwrap_or(symbol).to_uppercase();
    let page = index().await?.get(&name)?.clone();
    read(page.split('#').next().unwrap_or_default()).await?;
    Some(format!("nova/{page}"))
}

/// A file under `nova/`: ZParen's stylesheet, or a page of the site made to
/// use it. Only plain page names are fetched.
pub async fn read(path: &str) -> Option<(Vec<u8>, &'static str)> {
    if path == "nova.css" {
        return Some((include_bytes!("nova.css").to_vec(), "text/css"));
    }
    if !Path::new(path).components().all(|c| matches!(c, Component::Normal(_))) || !path.chars().all(|c| c.is_ascii_alphanumeric() || "_-".contains(c)) {
        return None;
    }
    if let Some(page) = PAGES.lock().unwrap().as_ref().and_then(|p| p.get(path)) {
        return Some((page.to_vec(), "text/html; charset=utf-8"));
    }
    let html = get(path).await?;
    let page = Arc::new(restyle(&String::from_utf8_lossy(&html)).into_bytes());
    let mut pages = PAGES.lock().unwrap();
    let pages = pages.get_or_insert_with(HashMap::new);
    if pages.len() >= KEEP {
        pages.clear();
    }
    pages.insert(path.to_string(), page.clone());
    Some((page.to_vec(), "text/html; charset=utf-8"))
}

/// A page of the site, without its scripts, its search box and its
/// stylesheet, and with ZParen's. Links stay relative, under `nova/`.
pub fn restyle(html: &str) -> String {
    let mut out = remove_elements(html, "<script", "</script");
    out = remove_tag(&out, "<link", "stylesheet");
    out = remove_div(&out, "class=\"apropos\"");
    out = out.replace(BASE, "").replace("AUTOFOCUS=\"AUTOFOCUS\"", "");
    out = out.replacen("<META CHARSET=\"US-ASCII\"", "<META CHARSET=\"utf-8\"", 1);
    match find_ci(&out, "</head", 0) {
        Some(at) => out.insert_str(at, "<link rel=\"stylesheet\" href=\"nova.css\">"),
        None => out.insert_str(0, "<link rel=\"stylesheet\" href=\"nova.css\">"),
    }
    out
}

/// Where `needle`, in lower case, first is in `hay` at or after `from`, in any case.
fn find_ci(hay: &str, needle: &str, from: usize) -> Option<usize> {
    let bytes = hay.as_bytes();
    let n = needle.as_bytes();
    (from..bytes.len().checked_sub(n.len())? + 1).find(|&i| bytes[i..i + n.len()].eq_ignore_ascii_case(n))
}

/// Removes each element from its open tag through its close tag, such as a script.
fn remove_elements(html: &str, open: &str, close: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut at = 0;
    while let Some(start) = find_ci(html, open, at) {
        let Some(end) = find_ci(html, close, start).and_then(|c| html[c..].find('>').map(|g| c + g + 1)) else { break };
        out.push_str(&html[at..start]);
        at = end;
    }
    out.push_str(&html[at..]);
    out
}

/// Removes each single tag that starts with `open` and contains `marker`, such as a stylesheet link.
fn remove_tag(html: &str, open: &str, marker: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut at = 0;
    let mut from = 0;
    while let Some(start) = find_ci(html, open, from) {
        let Some(end) = html[start..].find('>').map(|g| start + g + 1) else { break };
        if find_ci(&html[start..end], marker, 0).is_some() {
            out.push_str(&html[at..start]);
            at = end;
        }
        from = end;
    }
    out.push_str(&html[at..]);
    out
}

/// Removes the first div whose open tag contains `marker`, with everything in it.
fn remove_div(html: &str, marker: &str) -> String {
    let Some(m) = find_ci(html, marker, 0) else { return html.to_string() };
    let Some(start) = html[..m].to_ascii_lowercase().rfind("<div") else { return html.to_string() };
    let mut depth = 0;
    let mut at = start;
    loop {
        let open = find_ci(html, "<div", at);
        let Some(close) = find_ci(html, "</div", at) else { return html.to_string() };
        match open {
            Some(o) if o < close => {
                depth += 1;
                at = o + 4;
            }
            _ => {
                depth -= 1;
                let Some(end) = html[close..].find('>').map(|g| close + g + 1) else { return html.to_string() };
                if depth == 0 {
                    return format!("{}{}", &html[..start], &html[end..]);
                }
                at = end;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_index_and_prefers_the_operator() {
        let js = r#"var apropos = [["*, Variable", "v__star"],
 ["*, Function", "f__star"],
 ["mapcar, Function", "f_mapc"],
 ["function, System Class", "t_fn"],
 ["function, Special Operator", "f_fn"],
 ["lambda list keywords, Glossary", "26_1_Glossary"],
 ["\"\", Reader Macro", "2_4_5"],
 ["t, Constant Variable", "v_t"],
 ["t, System Class", "t_t"],
 ["case, Macro", "f_case"]];"#;
        let index = parse_index(js);
        assert_eq!(index.get("MAPCAR").map(String::as_str), Some("f_mapc"));
        assert_eq!(index.get("*").map(String::as_str), Some("f__star"));
        assert_eq!(index.get("FUNCTION").map(String::as_str), Some("f_fn"));
        assert_eq!(index.get("T").map(String::as_str), Some("v_t"));
        assert!(!index.contains_key("LAMBDA LIST KEYWORDS"), "only symbols");
        assert_eq!(index.get("OTHERWISE").map(String::as_str), Some("f_case"), "where the standard defines it");
        assert_eq!(index.get("&KEY").map(String::as_str), Some("3_4_Lambda_Lists#sec_3_4_1"));
        assert!(parse_index("").is_empty(), "no index, no pages");
    }

    #[test]
    fn a_page_loses_the_site_scripts_search_and_stylesheet() {
        let html = r#"<!DOCTYPE HTML>
<HTML LANG="en-us"
><HEAD
><TITLE
>mapc | Common Lisp Nova Spec</TITLE
><META CHARSET="US-ASCII"
><LINK REL="canonical" HREF="https://novaspec.org/cl/f_mapc"
><LINK REL="STYLESHEET" HREF="dpans.css?3968410258"
><SCRIPT SRC="dpans.js?3968410258"
></SCRIPT
></HEAD
><BODY
><DIV CLASS="topnav"
><DIV CLASS="apropos"
><DIV CLASS="apropos-io"
><INPUT ID="apropos" AUTOFOCUS="AUTOFOCUS"
></DIV
><DIV ID="apropos-res"
></DIV
></DIV
></DIV
><DIV CLASS="matter"
><A HREF="f_acons">acons</A></DIV
><SCRIPT>domReady();</SCRIPT></BODY></HTML>"#;
        let page = restyle(html);
        assert!(!page.to_lowercase().contains("<script"), "{page}");
        assert!(!page.contains("dpans.css"));
        assert!(!page.contains("apropos"), "{page}");
        assert!(page.contains(r#"<link rel="stylesheet" href="nova.css"></HEAD"#), "{page}");
        assert!(page.contains(r#"<DIV CLASS="topnav"
></DIV"#), "the search box goes, with its divs only: {page}");
        assert!(page.contains(r#"<DIV CLASS="matter"
><A HREF="f_acons">acons</A></DIV"#));
        assert!(page.contains(r#"HREF="f_mapc""#), "links to the site become relative");
        assert!(page.contains(r#"<META CHARSET="utf-8""#));
    }

    #[tokio::test]
    async fn fetches_only_plain_page_names() {
        assert!(read("../etc/passwd").await.is_none());
        assert!(read("/etc/passwd").await.is_none());
        assert!(read("f_mapc?x=1").await.is_none());
        assert!(read("https:").await.is_none());
        assert_eq!(read("nova.css").await.unwrap().1, "text/css");
    }
}
