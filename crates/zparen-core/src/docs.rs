//! The Common Lisp standard's pages for the Docs panel: the Nova Spec online
//! (see novaspec.rs), the Common Lisp Community Spec the app carries, or a
//! HyperSpec the user has, such as Quicklisp's "clhs" release. The HyperSpec's license allows only complete,
//! unmodified copies, so ZParen serves its pages as they are. The Community
//! Spec is MIT licensed, and scripts/clcs-pages.mjs made its pages small.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// LispWorks' Common Lisp HyperSpec: `Front`, `Body` and `Data`, indexed by `Data/Map_Sym.txt`.
    HyperSpec,
    /// The Common Lisp Community Spec, as scripts/clcs-pages.mjs makes it: `pages`, indexed by `symbols.json`.
    CommunitySpec,
}

impl Kind {
    fn of(root: &Path) -> Option<Kind> {
        if root.join("Data/Map_Sym.txt").is_file() {
            Some(Kind::HyperSpec)
        } else if root.join("symbols.json").is_file() {
            Some(Kind::CommunitySpec)
        } else {
            None
        }
    }

    /// What the Docs panel calls it.
    pub fn name(self) -> &'static str {
        match self {
            Kind::HyperSpec => "HyperSpec",
            Kind::CommunitySpec => "Community Spec",
        }
    }
}

pub struct Spec {
    pub root: PathBuf,
    pub kind: Kind,
    /// Upper-case symbol names to their page, relative to `root`, such as `Body/f_car.htm`.
    symbols: HashMap<String, String>,
}

impl Spec {
    pub fn load(root: PathBuf) -> Option<Spec> {
        let kind = Kind::of(&root)?;
        let symbols = match kind {
            Kind::HyperSpec => {
                let index = std::fs::read_to_string(root.join("Data/Map_Sym.txt")).ok()?;
                let mut lines = index.lines();
                let mut symbols = HashMap::new();
                while let (Some(name), Some(page)) = (lines.next(), lines.next()) {
                    symbols.insert(name.trim().to_string(), page.trim().trim_start_matches("../").to_string());
                }
                symbols
            }
            Kind::CommunitySpec => serde_json::from_slice(&std::fs::read(root.join("symbols.json")).ok()?).ok()?,
        };
        Some(Spec { root, kind, symbols })
    }

    /// The page for a Common Lisp symbol. A package prefix such as `cl:` is ignored.
    pub fn page(&self, symbol: &str) -> Option<&str> {
        let name = symbol.rsplit(':').next().unwrap_or(symbol).to_uppercase();
        self.symbols.get(&name).map(String::as_str)
    }

    /// A file of the spec, for display. Paths that leave it are refused.
    pub fn read(&self, path: &str) -> Option<(Vec<u8>, &'static str)> {
        let rel = Path::new(path.trim_start_matches('/'));
        if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
            return None;
        }
        // ZParen's stylesheet, which every page links: in place of the HyperSpec's own, and the Community Spec's only one.
        match (self.kind, rel.to_str()) {
            (Kind::HyperSpec, Some("Data/clhs.css")) => return Some((include_bytes!("clhs.css").to_vec(), "text/css")),
            (Kind::CommunitySpec, Some("clcs.css")) => return Some((include_bytes!("clcs.css").to_vec(), "text/css")),
            _ => {}
        }
        let bytes = std::fs::read(self.root.join(rel)).ok()?;
        let mime = match (self.kind, rel.extension().and_then(|e| e.to_str()).unwrap_or_default()) {
            (Kind::HyperSpec, "htm" | "html") => "text/html; charset=iso-8859-1",
            (Kind::CommunitySpec, "htm" | "html") => "text/html; charset=utf-8",
            (_, "gif") => "image/gif",
            (_, "txt" | "text") => "text/plain; charset=iso-8859-1",
            (_, "css") => "text/css",
            (_, "json") => "application/json",
            _ => "application/octet-stream",
        };
        Some((bytes, mime))
    }
}

static BUNDLED: OnceLock<PathBuf> = OnceLock::new();

/// The Community Spec the app carries. The app sets it once, at startup.
pub fn set_bundled(root: PathBuf) {
    let _ = BUNDLED.set(root);
}

/// Where the spec may be: `$ZPAREN_HYPERSPEC`, then the Community Spec the
/// app carries, then a HyperSpec from Quicklisp, for a build without the
/// Community Spec.
pub fn find_root() -> Option<PathBuf> {
    find_root_in(std::env::var_os("ZPAREN_HYPERSPEC").map(PathBuf::from), BUNDLED.get().map(PathBuf::as_path), std::env::var_os("HOME").map(PathBuf::from))
}

fn find_root_in(env: Option<PathBuf>, bundled: Option<&Path>, home: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(p) = env {
        return Kind::of(&p).is_some().then_some(p);
    }
    bundled.filter(|b| Kind::of(b).is_some()).map(Path::to_path_buf).or_else(|| quicklisp_hyperspec(home))
}

/// The newest HyperSpec among Quicklisp's clhs releases.
fn quicklisp_hyperspec(home: Option<PathBuf>) -> Option<PathBuf> {
    let home = home?;
    let dists = ["quicklisp", ".quicklisp", ".roswell/lisp/quicklisp"].map(|q| home.join(q).join("dists/quicklisp/software"));
    let mut found: Vec<PathBuf> = dists
        .iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("clhs-")))
        .map(|p| p.join("HyperSpec-7-0/HyperSpec"))
        .filter(|p| p.join("Data/Map_Sym.txt").is_file())
        .collect();
    // The newest release sorts last.
    found.sort();
    found.pop()
}

/// What the Docs panel shows for a Common Lisp symbol: the Nova Spec's page
/// when novaspec.org answers, else the spec on disk. `$ZPAREN_HYPERSPEC` names
/// the spec on disk, and then only it is used.
pub struct Lookup {
    pub installed: bool,
    pub page: Option<String>,
    pub name: Option<&'static str>,
}

pub async fn lookup(symbol: &str) -> Lookup {
    if std::env::var_os("ZPAREN_HYPERSPEC").is_none()
        && let Some(page) = crate::novaspec::page(symbol).await
    {
        return Lookup { installed: true, page: Some(page), name: Some(crate::novaspec::NAME) };
    }
    match spec() {
        Some(spec) => Lookup { installed: true, page: spec.page(symbol).map(String::from), name: Some(spec.kind.name()) },
        None => Lookup { installed: false, page: None, name: None },
    }
}

/// A file for the clhs: scheme: a Nova Spec page under `nova/`, or a file of the spec on disk.
pub async fn read(path: &str) -> Option<(Vec<u8>, &'static str)> {
    match path.trim_start_matches('/').strip_prefix("nova/") {
        Some(rest) => crate::novaspec::read(rest).await,
        None => spec()?.read(path),
    }
}

static LOADED: OnceLock<std::sync::Mutex<Option<std::sync::Arc<Spec>>>> = OnceLock::new();

/// The spec, looked for again until one is found, so installing the HyperSpec
/// while ZParen runs takes effect at once.
pub fn spec() -> Option<std::sync::Arc<Spec>> {
    let cell = LOADED.get_or_init(Default::default);
    let mut slot = cell.lock().unwrap();
    if slot.is_none() {
        *slot = find_root().and_then(Spec::load).map(std::sync::Arc::new);
    }
    slot.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> (PathBuf, Spec) {
        let root = std::env::temp_dir().join(format!("zparen-clhs-{}", std::process::id()));
        std::fs::create_dir_all(root.join("Data")).unwrap();
        std::fs::create_dir_all(root.join("Body")).unwrap();
        std::fs::write(root.join("Data/Map_Sym.txt"), "CAR\n../Body/f_car_c.htm\nMAPCAR\n../Body/f_mapc_.htm\n").unwrap();
        std::fs::write(root.join("Body/f_car_c.htm"), "<html>car</html>").unwrap();
        let hs = Spec::load(root.clone()).unwrap();
        (root, hs)
    }

    #[test]
    fn finds_pages_by_symbol_in_any_case_and_package() {
        let (_, hs) = sample();
        assert_eq!(hs.page("mapcar"), Some("Body/f_mapc_.htm"));
        assert_eq!(hs.page("cl:car"), Some("Body/f_car_c.htm"));
        assert_eq!(hs.page("my-function"), None);
    }

    fn community_spec() -> PathBuf {
        let root = std::env::temp_dir().join(format!("zparen-clcs-{}", std::process::id()));
        std::fs::create_dir_all(root.join("pages")).unwrap();
        std::fs::write(root.join("symbols.json"), r#"{"NCONC":"pages/nconc.html","FUNCTION":"pages/function-_0028Special-Operator_0029.html"}"#).unwrap();
        std::fs::write(root.join("pages/nconc.html"), "<main>nconc ⇒</main>").unwrap();
        root
    }

    #[test]
    fn reads_the_community_spec_with_its_own_stylesheet() {
        let cs = Spec::load(community_spec()).unwrap();
        assert_eq!(cs.kind, Kind::CommunitySpec);
        assert_eq!(cs.page("cl:nconc"), Some("pages/nconc.html"));
        assert_eq!(cs.page("function"), Some("pages/function-_0028Special-Operator_0029.html"));
        let (bytes, mime) = cs.read("pages/nconc.html").unwrap();
        assert_eq!((String::from_utf8(bytes).unwrap().as_str(), mime), ("<main>nconc ⇒</main>", "text/html; charset=utf-8"));
        assert_eq!(cs.read("/clcs.css").unwrap().1, "text/css", "ZParen's stylesheet");
        assert!(cs.read("Data/clhs.css").is_none(), "the HyperSpec's is not served for it");
    }

    #[test]
    fn the_community_spec_comes_before_a_hyperspec_from_quicklisp() {
        let bundled = community_spec();
        let home = std::env::temp_dir().join(format!("zparen-clhs-home-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        assert_eq!(find_root_in(None, Some(&bundled), Some(home.clone())), Some(bundled.clone()), "without Quicklisp's, the app's own");
        let ql = home.join(".quicklisp/dists/quicklisp/software/clhs-0.6.3/HyperSpec-7-0/HyperSpec");
        std::fs::create_dir_all(ql.join("Data")).unwrap();
        std::fs::write(ql.join("Data/Map_Sym.txt"), "").unwrap();
        assert_eq!(find_root_in(None, Some(&bundled), Some(home.clone())), Some(bundled.clone()), "the app's own, though Quicklisp's is there");
        assert_eq!(find_root_in(None, Some(&home.join("missing")), Some(home.clone())), Some(ql), "a build without it uses Quicklisp's");
        assert_eq!(find_root_in(Some(bundled.clone()), None, None), Some(bundled), "$ZPAREN_HYPERSPEC may name either kind");
        assert_eq!(find_root_in(Some(home.join("missing")), None, Some(home)), None, "$ZPAREN_HYPERSPEC is the only place looked when set");
    }

    #[test]
    fn serves_only_its_own_files() {
        let (_, hs) = sample();
        let (bytes, mime) = hs.read("Body/f_car_c.htm").unwrap();
        assert_eq!((bytes.as_slice(), mime), (&b"<html>car</html>"[..], "text/html; charset=iso-8859-1"));
        assert!(hs.read("../Data/Map_Sym.txt").is_none());
        assert!(hs.read("/etc/passwd").is_none(), "an absolute path stays inside the HyperSpec");
    }
}
