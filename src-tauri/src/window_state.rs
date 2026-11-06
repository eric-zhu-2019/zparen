//! The main window opens at the size and place it had when ZParen last quit.
//! The window is made here, not from the config at startup, so it never shows
//! at the default size first.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, Runtime, Window, WindowEvent};

/// A window's outer top-left corner and inner size, in points.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Frame {
    /// Whether 100 points of the title bar are on one of `screens`, so the
    /// window can be seen and dragged. A screen is a frame too.
    pub fn reachable(&self, screens: &[Frame]) -> bool {
        let y = self.y + 10.0;
        screens.iter().any(|s| {
            let shown = (self.x + self.width).min(s.x + s.width) - self.x.max(s.x);
            shown >= 100.0_f64.min(self.width) && y >= s.y && y < s.y + s.height
        })
    }

    fn sane(&self) -> bool {
        [self.x, self.y, self.width, self.height].iter().all(|v| v.is_finite()) && self.width >= 100.0 && self.height >= 100.0
    }
}

/// The frame saved in `path`, if it holds a usable one.
pub fn load(path: &Path) -> Option<Frame> {
    let frame: Frame = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    frame.sane().then_some(frame)
}

pub fn save(path: &Path, frame: Frame) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string(&frame) {
        let _ = std::fs::write(path, text);
    }
}

/// The window's last frame while it was neither full screen, zoomed nor
/// minimized, and the file it is saved to when ZParen quits.
pub struct LastFrame {
    path: PathBuf,
    frame: Mutex<Option<Frame>>,
}

impl LastFrame {
    pub fn save(&self) {
        if let Some(frame) = *self.frame.lock().unwrap() {
            save(&self.path, frame);
        }
    }
}

fn frame_of<R: Runtime>(window: &Window<R>) -> Option<Frame> {
    if window.is_fullscreen().ok()? || window.is_maximized().ok()? || window.is_minimized().ok()? {
        return None;
    }
    let scale = window.scale_factor().ok()?;
    let at = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Frame { x: at.x, y: at.y, width: size.width, height: size.height })
}

/// Makes the main window from the config, at the saved frame when there is one.
pub fn create_main_window<R: Runtime>(app: &tauri::App<R>, data_dir: &Path) -> tauri::Result<()> {
    let path = data_dir.join("window.json");
    let saved = load(&path);
    let config = app.config().app.windows.first().cloned().unwrap_or_default();
    let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
    if let Some(f) = saved {
        builder = builder.inner_size(f.width, f.height);
        let screens: Vec<Frame> = app
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(|m| {
                let at = m.position().to_logical::<f64>(m.scale_factor());
                let size = m.size().to_logical::<f64>(m.scale_factor());
                Frame { x: at.x, y: at.y, width: size.width, height: size.height }
            })
            .collect();
        // A screen that was unplugged would leave the window out of sight; the system then places it.
        if f.reachable(&screens) {
            builder = builder.position(f.x, f.y);
        }
    }
    let window = builder.build()?;
    // Where the window opened, which differs from the saved frame when the system placed it.
    let opened = frame_of(&window.as_ref().window()).or(saved);
    app.manage(LastFrame { path, frame: Mutex::new(opened) });
    Ok(())
}

/// Keeps the frame of the main window up to date as it moves and resizes.
pub fn track<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != "main" || !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
        return;
    }
    if let (Some(frame), Some(last)) = (frame_of(window), window.try_state::<LastFrame>()) {
        *last.frame.lock().unwrap() = Some(frame);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Frame = Frame { x: 0.0, y: 0.0, width: 1512.0, height: 982.0 };

    #[test]
    fn a_saved_frame_reads_back() {
        let dir = std::env::temp_dir().join(format!("zparen-window-{}", std::process::id()));
        let path = dir.join("window.json");
        let frame = Frame { x: 40.0, y: 60.0, width: 1200.0, height: 800.0 };
        save(&path, frame);
        assert_eq!(load(&path), Some(frame));
        std::fs::write(&path, "{\"x\":1}").unwrap();
        assert_eq!(load(&path), None, "a file that is not a frame is ignored");
        std::fs::write(&path, "{\"x\":0,\"y\":0,\"width\":10,\"height\":10}").unwrap();
        assert_eq!(load(&path), None, "and so is a window too small to use");
        assert_eq!(load(&dir.join("missing.json")), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_frame_is_reachable_when_its_title_bar_is_on_a_screen() {
        assert!(Frame { x: 40.0, y: 60.0, width: 1200.0, height: 800.0 }.reachable(&[SCREEN]));
        assert!(Frame { x: -1000.0, y: 60.0, width: 1200.0, height: 800.0 }.reachable(&[SCREEN]), "the left part sticks out");
        assert!(!Frame { x: 1600.0, y: 60.0, width: 1200.0, height: 800.0 }.reachable(&[SCREEN]), "on a screen no longer there");
        assert!(!Frame { x: 1450.0, y: 60.0, width: 1200.0, height: 800.0 }.reachable(&[SCREEN]), "with too little of it left to drag");
        assert!(!Frame { x: 40.0, y: 2000.0, width: 1200.0, height: 800.0 }.reachable(&[SCREEN]), "below the screen");
        let left = Frame { x: -1920.0, y: 0.0, width: 1920.0, height: 1080.0 };
        assert!(Frame { x: -1800.0, y: 100.0, width: 1200.0, height: 800.0 }.reachable(&[SCREEN, left]));
        assert!(!Frame { x: 40.0, y: 60.0, width: 1200.0, height: 800.0 }.reachable(&[]));
    }
}
