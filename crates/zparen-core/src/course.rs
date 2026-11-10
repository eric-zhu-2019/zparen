//! The Lisp course's project and the git steps the Learn panel takes in it.
//!
//! The lessons, and so the files each one writes, belong to the interface; this
//! module makes the project folder, pins FiveAM with ocicl, and runs git. Git
//! is the course's only record of progress: a branch per lesson, a commit per
//! passed exercise, and a merge into `main` per finished lesson.

use crate::project;
use crate::session::CA_BUNDLES;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use ts_rs::TS;

/// Marks a folder as a course project; the Learn panel's git steps run only in one.
pub const MARKER: &str = ".zparen-course";

/// Who commits when git has no identity set up, as on a new Mac.
const FALLBACK_NAME: &str = "Lisp Learner";
const FALLBACK_EMAIL: &str = "learner@localhost";

/// A file the interface writes into a new course project, relative to its root.
#[derive(Debug, Clone, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CourseFile {
    pub path: String,
    pub content: String,
}

/// The course's progress as git records it.
#[derive(Debug, Clone, Serialize, TS, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CourseState {
    /// The branch checked out; none when git is detached or missing.
    pub branch: Option<String>,
    /// Whether git can be run at all.
    pub git: bool,
    /// Changed or untracked files in the working tree.
    pub dirty: bool,
    /// A merge stopped on a conflict and waits to be finished or aborted.
    pub merging: bool,
    /// The files a stopped merge left in conflict, relative to the root.
    pub conflicts: Vec<String>,
    /// Every `lesson/*` branch.
    pub branches: Vec<String>,
    /// The `Lesson:` trailers of the merges on `main`, such as "03": the finished lessons.
    pub finished: Vec<String>,
    /// The `Exercise:` trailers of every commit on `main` and the lesson branches, such as "03/1".
    pub passed: Vec<String>,
}

/// A git step the Learn panel takes.
#[derive(Debug, Clone, Deserialize, Serialize, TS, PartialEq)]
#[serde(tag = "op", rename_all = "camelCase")]
#[ts(export)]
pub enum CourseGitOp {
    State,
    /// Checks out BRANCH, first making it from `main` when CREATE is set.
    #[serde(rename_all = "camelCase")]
    Switch { branch: String, create: bool },
    /// Commits PATHS, relative to the root, or every change when PATHS is empty.
    /// With ALLOW_EMPTY it commits even when they hold no change, so a record
    /// such as a passed exercise's trailer is never lost.
    #[serde(rename_all = "camelCase")]
    Commit {
        message: String,
        paths: Vec<String>,
        #[serde(default)]
        allow_empty: bool,
    },
    /// Merges BRANCH into the branch checked out, always with a merge commit.
    #[serde(rename_all = "camelCase")]
    Merge { branch: String, message: String },
    AbortMerge,
    /// The history of every branch, as a graph.
    Log,
}

/// What a git step answers.
#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum CourseGitReply {
    State(CourseState),
    #[serde(rename_all = "camelCase")]
    Committed { committed: bool },
    #[serde(rename_all = "camelCase")]
    Log { text: String },
    Done,
}

fn git_cmd(root: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root);
    cmd
}

/// Runs git, answering its output, or its error message when it fails. Another
/// git, such as an editor's status check, may hold the index for a moment, so a
/// step that finds it locked waits and tries again.
fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut tries = 0;
    loop {
        let out = git_cmd(root).args(args).output().map_err(|e| format!("git did not run: {e}"))?;
        if out.status.success() {
            return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
        }
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        tries += 1;
        if err.contains("index.lock") && tries < 20 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            continue;
        }
        let msg = if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err };
        return Err(format!("git {}: {msg}", args.first().copied().unwrap_or_default()));
    }
}

fn lines(text: &str) -> Vec<String> {
    text.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect()
}

/// Commits with the user's own identity, or a stand-in when git has none.
fn commit_staged(root: &Path, message: &str) -> Result<bool, String> {
    commit_staged_or_empty(root, message, false)
}

fn commit_staged_or_empty(root: &Path, message: &str, allow_empty: bool) -> Result<bool, String> {
    // Nothing staged: the change is already in history.
    let empty = git_cmd(root).args(["diff", "--cached", "--quiet"]).status().map(|s| s.success()).unwrap_or(false);
    if empty && !allow_empty {
        return Ok(false);
    }
    let mut args = identity(root);
    args.extend(["commit".into(), "--quiet".into(), "-m".into(), message.into()]);
    if empty {
        args.push("--allow-empty".into());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    git(root, &refs)?;
    Ok(true)
}

/// Git options that give a stand-in identity when git has none, so commits and
/// merges work without `user.name` and `user.email`.
fn identity(root: &Path) -> Vec<String> {
    let named = git(root, &["config", "user.email"]).is_ok_and(|e| !e.trim().is_empty());
    if named {
        return Vec::new();
    }
    vec!["-c".into(), format!("user.name={FALLBACK_NAME}"), "-c".into(), format!("user.email={FALLBACK_EMAIL}")]
}

/// A relative path that stays inside the project.
fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.components().all(|c| matches!(c, Component::Normal(_))) {
        Ok(root.join(p))
    } else {
        Err(format!("{rel} is not a path inside the project"))
    }
}

pub fn is_course(root: &Path) -> bool {
    root.join(MARKER).is_file()
}

/// Makes a course project: the interface's FILES, FiveAM pinned with ocicl, and a
/// git repository whose first commit on `main` holds them all.
pub fn create(parent: &Path, name: &str, files: &[CourseFile]) -> Result<PathBuf, String> {
    if !project::valid_name(name) {
        return Err("project names use lowercase letters, digits and dashes".into());
    }
    if project::ocicl_runtime().is_none() {
        return Err(project::OCICL_MISSING.into());
    }
    let root = parent.join(name);
    if root.exists() {
        return Err(format!("{} already exists", root.display()));
    }
    let write = |rel: &str, body: &str| -> Result<(), String> {
        let path = inside(&root, rel)?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        }
        std::fs::write(&path, body).map_err(|e| format!("{}: {e}", path.display()))
    };
    for f in files {
        write(&f.path, &f.content)?;
    }
    for (rel, body) in [(MARKER, "{\"version\": 1}\n"), (".gitignore", "*.fasl\nocicl/\n"), ("ocicl.csv", "")] {
        if !root.join(rel).exists() {
            write(rel, body)?;
        }
    }
    // FiveAM is pinned now, so the first commit records its version. Offline, the
    // ocicl runtime fetches it when the tests first load instead.
    let mut install = Command::new("ocicl");
    install.args(["install", "fiveam"]).current_dir(&root);
    // ocicl looks for a Linux CA bundle unless told where macOS keeps one.
    if std::env::var_os("SSL_CERT_FILE").is_none() {
        if let Some(bundle) = CA_BUNDLES.iter().find(|b| Path::new(b).is_file()) {
            install.env("SSL_CERT_FILE", bundle);
        }
    }
    let _ = install.output();
    git(&root, &["init", "--quiet", "--initial-branch=main"])?;
    git(&root, &["add", "-A"])?;
    commit_staged(&root, "Start the Lisp course, with lesson 1")?;
    Ok(root)
}

pub fn state(root: &Path) -> CourseState {
    let Ok(_) = git(root, &["rev-parse", "--git-dir"]) else {
        return CourseState::default();
    };
    let branch = git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok().map(|b| b.trim().to_string());
    let dirty = git(root, &["status", "--porcelain"]).is_ok_and(|s| !s.trim().is_empty());
    let merging = git(root, &["rev-parse", "--quiet", "--verify", "MERGE_HEAD"]).is_ok();
    let conflicts = if merging { git(root, &["diff", "--name-only", "--diff-filter=U"]).map(|s| lines(&s)).unwrap_or_default() } else { Vec::new() };
    let list = |extra: &[&str]| {
        let mut args = vec!["branch", "--list", "lesson/*", "--format=%(refname:short)"];
        args.extend_from_slice(extra);
        git(root, &args).map(|s| lines(&s)).unwrap_or_default()
    };
    let branches = list(&[]);
    // A branch made from main counts as merged into it before it has a commit,
    // so a finished lesson is known by the trailer its merge carries.
    let trailers = |key: &str, refs: &[&str]| {
        let format = format!("--format=%(trailers:key={key},valueonly,separator=%x0A)");
        let mut args = vec!["log"];
        args.extend_from_slice(refs);
        args.push(&format);
        git(root, &args).map(|s| lines(&s)).unwrap_or_default()
    };
    let has_main = git(root, &["rev-parse", "--quiet", "--verify", "main"]).is_ok();
    let finished = if has_main { trailers("Lesson", &["main"]) } else { Vec::new() };
    let passed = if has_main { trailers("Exercise", &["main", "--branches=lesson/*"]) } else { trailers("Exercise", &["--branches=lesson/*"]) };
    CourseState { branch, git: true, dirty, merging, conflicts, branches, finished, passed }
}

pub fn run(root: &Path, op: &CourseGitOp) -> Result<CourseGitReply, String> {
    if !is_course(root) {
        return Err("this is not a course project".into());
    }
    match op {
        CourseGitOp::State => Ok(CourseGitReply::State(state(root))),
        CourseGitOp::Switch { branch, create } => {
            if !branch.starts_with("lesson/") && branch != "main" {
                return Err(format!("the course only switches to main and lesson branches, not {branch}"));
            }
            if *create {
                git(root, &["switch", "--quiet", "-c", branch, "main"])?;
            } else {
                git(root, &["switch", "--quiet", branch])?;
            }
            Ok(CourseGitReply::Done)
        }
        CourseGitOp::Commit { message, paths, allow_empty } => {
            if paths.is_empty() {
                git(root, &["add", "-A"])?;
            } else {
                for p in paths {
                    inside(root, p)?;
                }
                let mut args = vec!["add", "--"];
                args.extend(paths.iter().map(String::as_str));
                git(root, &args)?;
            }
            Ok(CourseGitReply::Committed { committed: commit_staged_or_empty(root, message, *allow_empty)? })
        }
        CourseGitOp::Merge { branch, message } => {
            let mut args = identity(root);
            args.extend(["merge", "--no-ff", "--quiet", "-m", message, branch].map(String::from));
            git(root, &args.iter().map(String::as_str).collect::<Vec<_>>())?;
            Ok(CourseGitReply::Done)
        }
        CourseGitOp::AbortMerge => {
            git(root, &["merge", "--abort"])?;
            Ok(CourseGitReply::Done)
        }
        CourseGitOp::Log => Ok(CourseGitReply::Log { text: git(root, &["log", "--graph", "--oneline", "--decorate", "--all"])? }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("zparen-course-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join(MARKER), "{}").unwrap();
        std::fs::write(root.join("src/01-forms.lisp"), "(defun twice (x) (not-written-yet 'twice))\n").unwrap();
        git(&root, &["init", "--quiet", "--initial-branch=main"]).unwrap();
        git(&root, &["add", "-A"]).unwrap();
        commit_staged(&root, "Start").unwrap();
        root
    }

    fn commit(root: &Path, message: &str, paths: &[&str]) -> bool {
        let op = CourseGitOp::Commit { message: message.into(), paths: paths.iter().map(|p| p.to_string()).collect(), allow_empty: false };
        matches!(run(root, &op).unwrap(), CourseGitReply::Committed { committed: true })
    }

    #[test]
    fn a_lesson_branch_records_passes_and_merges_into_main() {
        let root = repo("flow");
        run(&root, &CourseGitOp::Switch { branch: "lesson/01-forms".into(), create: true }).unwrap();
        std::fs::write(root.join("src/01-forms.lisp"), "(defun twice (x) (* 2 x))\n").unwrap();
        assert!(commit(&root, "Pass 1.1: Twice\n\nExercise: 01/1", &["src/01-forms.lisp"]));
        // Nothing new to commit is not an error.
        assert!(!commit(&root, "Pass 1.1: Twice\n\nExercise: 01/1", &["src/01-forms.lisp"]));
        // A pass whose code an earlier pass already committed still records its trailer.
        let op = CourseGitOp::Commit { message: "Pass 1.2: Square\n\nExercise: 01/2".into(), paths: vec!["src/01-forms.lisp".into()], allow_empty: true };
        assert!(matches!(run(&root, &op).unwrap(), CourseGitReply::Committed { committed: true }));
        let s = state(&root);
        assert_eq!(s.branch.as_deref(), Some("lesson/01-forms"));
        assert_eq!(s.passed, vec!["01/2", "01/1"]);
        assert!(s.finished.is_empty(), "a branch is not finished just because main contains it");

        run(&root, &CourseGitOp::Switch { branch: "main".into(), create: false }).unwrap();
        run(&root, &CourseGitOp::Merge { branch: "lesson/01-forms".into(), message: "Finish lesson 1\n\nLesson: 01".into() }).unwrap();
        let s = state(&root);
        assert_eq!(s.finished, vec!["01"]);
        assert_eq!(s.passed, vec!["01/2", "01/1"]);
        assert!(!s.dirty && !s.merging);
        let CourseGitReply::Log { text } = run(&root, &CourseGitOp::Log).unwrap() else { panic!() };
        assert!(text.contains("Finish lesson 1") && text.contains("Pass 1.1"), "{text}");
    }

    #[test]
    fn a_conflicting_merge_stops_and_can_be_aborted() {
        let root = repo("conflict");
        run(&root, &CourseGitOp::Switch { branch: "lesson/01-forms".into(), create: true }).unwrap();
        std::fs::write(root.join("src/01-forms.lisp"), "(defun twice (x) (* 2 x))\n").unwrap();
        commit(&root, "Pass", &[]);
        run(&root, &CourseGitOp::Switch { branch: "main".into(), create: false }).unwrap();
        std::fs::write(root.join("src/01-forms.lisp"), "(defun twice (x) (+ x x))\n").unwrap();
        commit(&root, "Edit on main", &[]);
        let err = run(&root, &CourseGitOp::Merge { branch: "lesson/01-forms".into(), message: "Finish".into() });
        assert!(err.is_err());
        let s = state(&root);
        assert!(s.merging);
        assert_eq!(s.conflicts, vec!["src/01-forms.lisp"]);
        run(&root, &CourseGitOp::AbortMerge).unwrap();
        assert!(!state(&root).merging);
    }

    #[test]
    fn steps_stay_in_course_projects_and_on_course_branches() {
        let root = repo("guard");
        assert!(run(&root, &CourseGitOp::Switch { branch: "my-idea".into(), create: true }).is_err());
        assert!(run(&root, &CourseGitOp::Commit { message: "x".into(), paths: vec!["../outside".into()], allow_empty: false }).is_err());
        std::fs::remove_file(root.join(MARKER)).unwrap();
        assert!(run(&root, &CourseGitOp::State).is_err());
    }
}
